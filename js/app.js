// =============================================================================
// app.js — Main ballot logic
// =============================================================================
// Set APPS_SCRIPT_URL to your deployed Apps Script web app URL.
// =============================================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzmYywPG0sEYaoEOY2uD0Y8VvB7Gpm9cTcVNNCWDL2ikhW8NXecBNU9fiEIB0YYPn6mUA/exec";

// Voting closed April 30, 2026 at 11:59pm ET (UTC-4 in April).
const VOTING_DEADLINE = new Date("2026-04-30T00:00:00Z");

// localStorage keys.
const LS_DRAFT     = "superlatives_draft";
const LS_SUBMITTED = "ballot_submitted";

// ── State ──────────────────────────────────────────────────────────────────────

let _votes         = {}; // { [superlativeId]: { nomineeName, isWriteIn } | { nomineeName1, nomineeName2, isWriteIn } }
let _autocompletes = {}; // { [superlativeId]: autocomplete instance(s) }
let _jumpItems     = {}; // { [superlativeId]: HTMLButtonElement }

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Closed state takes priority over everything.
  if (isVotingClosed()) {
    showView("closed");
    return;
  }

  // Already submitted on this device — show the done screen.
  if (localStorage.getItem(LS_SUBMITTED) === "true") {
    showView("already-voted");
    return;
  }

  // Otherwise show the landing page.
  showView("landing");

  document.getElementById("start-voting-btn").addEventListener("click", () => {
    loadDraftFromStorage();
    renderBallot();
    showView("ballot");
  });

  // Submit modal listeners.
  document.getElementById("submit-btn").addEventListener("click", openConfirmModal);
  document.getElementById("confirm-submit-btn").addEventListener("click", submitBallot);
  document.getElementById("cancel-submit-btn").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-modal").addEventListener("click", e => {
    if (e.target === document.getElementById("confirm-modal")) closeConfirmModal();
  });

  // Jump sheet listeners.
  document.getElementById("dock-jump-btn").addEventListener("click", openJumpSheet);
  document.getElementById("jump-sheet-close").addEventListener("click", closeJumpSheet);
  document.getElementById("jump-sheet-backdrop").addEventListener("click", closeJumpSheet);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeJumpSheet();
  });
});

// ── Views ──────────────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("view--active"));
  const el = document.getElementById("view-" + name);
  if (el) el.classList.add("view--active");
  // Show the bottom dock only during the ballot view.
  const dock = document.getElementById("bottom-dock");
  if (dock) dock.style.display = name === "ballot" ? "" : "none";
}

// ── Ballot rendering ──────────────────────────────────────────────────────────

function renderBallot() {
  const container = document.getElementById("ballot-cards");
  container.innerHTML = "";
  _autocompletes = {};
  _jumpItems = {};

  SUPERLATIVES.forEach((sup, idx) => {
    const card = document.createElement("div");
    card.className = "ballot-card";
    card.id = "card-" + sup.id;
    card.dataset.id = sup.id;

    const num = document.createElement("div");
    num.className = "ballot-card__num";
    num.textContent = idx + 1;

    const body = document.createElement("div");
    body.className = "ballot-card__body";

    const title = document.createElement("h3");
    title.className = "ballot-card__title";
    title.textContent = sup.title;

    const desc = document.createElement("p");
    desc.className = "ballot-card__desc";
    desc.textContent = sup.description;

    const fields = document.createElement("div");
    fields.className = "ballot-card__fields";

    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(fields);
    card.appendChild(num);
    card.appendChild(body);
    container.appendChild(card);

    const saved = _votes[sup.id];

    if (sup.type === "duo") {
      _autocompletes[sup.id] = { person1: null, person2: null };

      const wrap1 = document.createElement("div");
      wrap1.className = "ballot-card__ac";
      const wrap2 = document.createElement("div");
      wrap2.className = "ballot-card__ac";

      const ac1 = createAutocomplete(wrap1, {
        label: "Person 1",
        placeholder: "Start typing…",
        inputId: sup.id + "_1",
        onSelect: (val) => {
          _votes[sup.id] = { ..._votes[sup.id], nomineeName1: val.name, isWriteIn: val.isWriteIn };
          saveDraftToStorage();
          updateCardState(card, sup);
          updateProgress();
          updateSubmitButton();
          updatePairWarning(sup.id);
          updateJumpSheet(sup.id);
        },
        onClear: () => {
          if (_votes[sup.id]) delete _votes[sup.id].nomineeName1;
          if (!_votes[sup.id]?.nomineeName1 && !_votes[sup.id]?.nomineeName2) delete _votes[sup.id];
          saveDraftToStorage();
          updateCardState(card, sup);
          updateProgress();
          updateSubmitButton();
          updatePairWarning(sup.id);
          updateJumpSheet(sup.id);
        },
      });

      const ac2 = createAutocomplete(wrap2, {
        label: "Person 2",
        placeholder: "Start typing…",
        inputId: sup.id + "_2",
        onSelect: (val) => {
          _votes[sup.id] = { ..._votes[sup.id], nomineeName2: val.name, isWriteIn: val.isWriteIn };
          saveDraftToStorage();
          updateCardState(card, sup);
          updateProgress();
          updateSubmitButton();
          updatePairWarning(sup.id);
          updateJumpSheet(sup.id);
        },
        onClear: () => {
          if (_votes[sup.id]) delete _votes[sup.id].nomineeName2;
          if (!_votes[sup.id]?.nomineeName1 && !_votes[sup.id]?.nomineeName2) delete _votes[sup.id];
          saveDraftToStorage();
          updateCardState(card, sup);
          updateProgress();
          updateSubmitButton();
          updatePairWarning(sup.id);
          updateJumpSheet(sup.id);
        },
      });

      _autocompletes[sup.id].person1 = ac1;
      _autocompletes[sup.id].person2 = ac2;

      if (saved?.nomineeName1) ac1.setValue(saved.nomineeName1, saved.isWriteIn);
      if (saved?.nomineeName2) ac2.setValue(saved.nomineeName2, saved.isWriteIn);

      fields.appendChild(wrap1);
      fields.appendChild(wrap2);

      // Pair warning (shown when exactly one of the two fields is filled).
      const pairWarn = document.createElement("p");
      pairWarn.className = "pair-warning";
      pairWarn.id = "pair-warn-" + sup.id;
      pairWarn.textContent = "Add a second name for this to count.";
      body.appendChild(pairWarn);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "ballot-card__ac";

      const ac = createAutocomplete(wrap, {
        placeholder: "Search classmates…",
        inputId: sup.id,
        onSelect: (val) => {
          _votes[sup.id] = { nomineeName: val.name, isWriteIn: val.isWriteIn };
          saveDraftToStorage();
          updateCardState(card, sup);
          updateProgress();
          updateSubmitButton();
          updateJumpSheet(sup.id);
          scrollToNextCard(sup.id);
        },
        onClear: () => {
          delete _votes[sup.id];
          saveDraftToStorage();
          updateCardState(card, sup);
          updateProgress();
          updateSubmitButton();
          updateJumpSheet(sup.id);
        },
      });

      _autocompletes[sup.id] = ac;

      if (saved?.nomineeName) ac.setValue(saved.nomineeName, saved.isWriteIn);

      fields.appendChild(wrap);
    }

    updateCardState(card, sup);
  });

  buildJumpSheet();
  updateProgress();
  updateSubmitButton();
}

function updateCardState(card, sup) {
  const vote = _votes[sup.id];
  const filled = sup.type === "duo"
    ? !!(vote?.nomineeName1 && vote?.nomineeName2)
    : !!vote?.nomineeName;
  card.classList.toggle("ballot-card--filled", filled);
}

function scrollToNextCard(currentId) {
  const currentIndex = SUPERLATIVES.findIndex(s => s.id === currentId);
  for (let i = currentIndex + 1; i < SUPERLATIVES.length; i++) {
    const next = SUPERLATIVES[i];
    if (!_votes[next.id]) {
      const nextCard = document.getElementById("card-" + next.id);
      if (nextCard) {
        setTimeout(() => {
          nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      }
      return;
    }
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────

function updateProgress() {
  const filled = countFilledVotes();
  const total  = SUPERLATIVES.length;
  // Dock progress bar + count.
  const dockBar   = document.getElementById("dock-bar-fill");
  const dockCount = document.getElementById("dock-count");
  if (dockBar)   dockBar.style.width = Math.round((filled / total) * 100) + "%";
  if (dockCount) dockCount.textContent = `${filled} of ${total} filled`;
}

function countFilledVotes() {
  return SUPERLATIVES.filter(sup => {
    const vote = _votes[sup.id];
    if (sup.type === "duo") return !!(vote?.nomineeName1 && vote?.nomineeName2);
    return !!vote?.nomineeName;
  }).length;
}

// ── Submit button ─────────────────────────────────────────────────────────────

function updateSubmitButton() {
  const btn     = document.getElementById("submit-btn");
  const jumpBtn = document.getElementById("dock-jump-btn");
  if (!btn) return;
  const filled = countFilledVotes();
  btn.disabled = filled === 0;
  btn.textContent = filled === 0
    ? "Fill in at least one category to submit"
    : "Submit My Ballot";
  // Show jump button only when at least one category is filled.
  if (jumpBtn) jumpBtn.style.display = filled > 0 ? "block" : "none";
}

// ── Submit flow ───────────────────────────────────────────────────────────────

function countHalfFilledPairs() {
  return SUPERLATIVES.filter(sup => {
    if (sup.type !== "duo") return false;
    const vote = _votes[sup.id];
    const has1 = !!(vote && vote.nomineeName1);
    const has2 = !!(vote && vote.nomineeName2);
    return has1 !== has2; // exactly one of the two is filled
  }).length;
}

function openConfirmModal() {
  const filled     = countFilledVotes();
  const skipped    = SUPERLATIVES.length - filled;
  const halfPairs  = countHalfFilledPairs();

  document.getElementById("modal-filled-count").textContent  = filled;
  document.getElementById("modal-total-count").textContent   = SUPERLATIVES.length;
  document.getElementById("modal-skipped-count").textContent = skipped;

  // Show pair warning if any pair categories are half-filled.
  const pairWarn  = document.getElementById("modal-pair-warning");
  const pairCount = document.getElementById("modal-pair-count");
  if (pairWarn && pairCount) {
    if (halfPairs > 0) {
      pairCount.textContent = halfPairs === 1
        ? "1 pair category only has one name filled"
        : `${halfPairs} pair categories only have one name filled`;
      pairWarn.style.display = "block";
    } else {
      pairWarn.style.display = "none";
    }
  }

  document.getElementById("confirm-modal").classList.add("modal--open");
  document.body.style.overflow = "hidden";
}

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.remove("modal--open");
  document.body.style.overflow = "";
}

async function submitBallot() {
  closeConfirmModal();

  if (isVotingClosed()) {
    showView("closed");
    return;
  }

  const btn = document.getElementById("submit-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

  // Build votes payload.
  const votesPayload = [];
  for (const sup of SUPERLATIVES) {
    const vote = _votes[sup.id];
    if (!vote) continue;

    if (sup.type === "duo") {
      if (vote.nomineeName1 && vote.nomineeName2) {
        votesPayload.push({
          categoryId:   sup.id,
          nomineeName1: vote.nomineeName1,
          nomineeName2: vote.nomineeName2,
          isWriteIn:    !!vote.isWriteIn,
        });
      }
    } else {
      if (vote.nomineeName) {
        votesPayload.push({
          categoryId:  sup.id,
          nomineeName: vote.nomineeName,
          isWriteIn:   !!vote.isWriteIn,
        });
      }
    }
  }

  try {
    const res = await apiFetch({ action: "submit_ballot", votes: votesPayload });

    if (!res.ok) {
      showError(res.error || "Submission failed. Please try again.");
      if (btn) { btn.disabled = false; btn.textContent = "Submit My Ballot"; }
      return;
    }

    // Mark as submitted in localStorage — this is the duplicate-prevention gate.
    localStorage.setItem(LS_SUBMITTED, "true");
    // Clear the in-progress draft.
    localStorage.removeItem(LS_DRAFT);

    runCelebration(() => showView("confirmation"));

  } catch (err) {
    console.error(err);
    showError("Network error — please check your connection and try again.");
    if (btn) { btn.disabled = false; btn.textContent = "Submit My Ballot"; }
  }
}

function showError(msg) {
  console.error("[submitBallot error]", msg);
  const el = document.getElementById("submit-error");
  if (el) {
    el.textContent = msg;
    el.style.display = "block";
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { el.style.display = "none"; }, 10000);
  } else {
    // Fallback if element isn't in DOM for any reason.
    alert(msg);
  }
}

// ── LocalStorage draft ────────────────────────────────────────────────────────

function saveDraftToStorage() {
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(_votes)); } catch {}
}

function loadDraftFromStorage() {
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    if (raw) _votes = JSON.parse(raw);
  } catch { _votes = {}; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function apiFetch(body) {
  // text/plain avoids CORS preflight (OPTIONS) that Apps Script can't handle.
  // AbortController gives us a 20s timeout so the button never gets stuck.
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 20000);

  let text = "";
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    clearTimeout(timeoutId);
    text = await res.text();
    console.log("[apiFetch] status:", res.status, "| body:", text.slice(0, 300));
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Request timed out — please check your connection and try again.");
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Unexpected server response: " + text.slice(0, 150));
  }
}

function isVotingClosed() {
  return Date.now() > VOTING_DEADLINE.getTime();
}

// ── Celebration animation ─────────────────────────────────────────────────────

function runCelebration(onComplete) {
  // Respect prefers-reduced-motion — skip straight to confirmation.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onComplete();
    return;
  }

  const overlay = document.getElementById("celebration-overlay");
  if (!overlay) { onComplete(); return; }

  overlay.classList.add("celebration--active");

  const palette = ["#990000", "#D4A574", "#F5F0E8"];
  const particles = [];

  // 20 🎓 emoji particles.
  for (let i = 0; i < 20; i++) {
    const el = document.createElement("span");
    el.className = "confetti-particle";
    el.textContent = "🎓";
    el.style.left = (5 + Math.random() * 90) + "vw";
    const dur = 1800 + Math.random() * 1400;
    const delay = Math.random() * 600;
    el.style.animation = `fall ${dur}ms ease-in ${delay}ms both`;
    overlay.appendChild(el);
    particles.push(el);
  }

  // 10 colored squares.
  for (let i = 0; i < 10; i++) {
    const el = document.createElement("div");
    el.className = "confetti-square";
    el.style.left = (5 + Math.random() * 90) + "vw";
    el.style.background = palette[i % palette.length];
    const dur = 1800 + Math.random() * 1400;
    const delay = Math.random() * 600;
    el.style.animation = `fall ${dur}ms ease-in ${delay}ms both`;
    overlay.appendChild(el);
    particles.push(el);
  }

  // After 2400ms, fade out then call onComplete.
  setTimeout(() => {
    overlay.style.transition = "opacity 350ms ease";
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.classList.remove("celebration--active");
      overlay.style.transition = "";
      overlay.style.opacity = "";
      // Remove particles.
      particles.forEach(p => p.remove());
      onComplete();
    }, 350);
  }, 2400);
}

// ── Pair warning ──────────────────────────────────────────────────────────────

function updatePairWarning(supId) {
  const vote = _votes[supId];
  const warn = document.getElementById("pair-warn-" + supId);
  if (!warn) return;
  const has1 = !!(vote && vote.nomineeName1);
  const has2 = !!(vote && vote.nomineeName2);
  // XOR: show when exactly one is filled.
  warn.style.display = (has1 !== has2) ? "block" : "none";
}

// ── Jump sheet ────────────────────────────────────────────────────────────────

function buildJumpSheet() {
  const list = document.getElementById("jump-sheet-list");
  if (!list) return;
  list.innerHTML = "";
  _jumpItems = {};

  SUPERLATIVES.forEach((sup, idx) => {
    const btn = document.createElement("button");
    btn.className = "jump-item";
    btn.type = "button";
    btn.setAttribute("data-sup-id", sup.id);

    const num = document.createElement("span");
    num.className = "jump-item__num";
    num.textContent = idx + 1;

    const title = document.createElement("span");
    title.className = "jump-item__title";
    title.textContent = sup.title;

    const check = document.createElement("span");
    check.className = "jump-item__check";
    check.textContent = "✓";

    btn.appendChild(num);
    btn.appendChild(title);
    btn.appendChild(check);

    btn.addEventListener("click", () => {
      closeJumpSheet();
      const card = document.getElementById("card-" + sup.id);
      if (card) {
        setTimeout(() => {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    });

    list.appendChild(btn);
    _jumpItems[sup.id] = btn;
  });

  // Sync initial filled states (for draft restore).
  SUPERLATIVES.forEach(sup => updateJumpSheet(sup.id));
}

function updateJumpSheet(supId) {
  const btn = _jumpItems[supId];
  if (!btn) return;
  const sup = SUPERLATIVES.find(s => s.id === supId);
  if (!sup) return;
  const vote = _votes[supId];
  const filled = sup.type === "duo"
    ? !!(vote?.nomineeName1 && vote?.nomineeName2)
    : !!vote?.nomineeName;
  btn.classList.toggle("jump-item--filled", filled);
}

function openJumpSheet() {
  const sheet = document.getElementById("jump-sheet");
  if (!sheet) return;
  sheet.classList.add("jump-sheet--open");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeJumpSheet() {
  const sheet = document.getElementById("jump-sheet");
  if (!sheet) return;
  sheet.classList.remove("jump-sheet--open");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
