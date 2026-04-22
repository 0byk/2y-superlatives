// =============================================================================
// autocomplete.js — Classmate picker with keyboard navigation
// =============================================================================

const MAX_DROPDOWN_RESULTS = 6;
const MIN_QUERY_LENGTH     = 1;

/**
 * Create an autocomplete input bound to the CLASSMATES array.
 *
 * @param {HTMLElement} container  - The element to render the input + dropdown into.
 * @param {object}      opts
 *   @param {string}    opts.placeholder  - Input placeholder text.
 *   @param {string}    opts.label        - Visible label (optional).
 *   @param {Function}  opts.onSelect     - Called with { name, isWriteIn } when a choice is made.
 *   @param {Function}  opts.onClear      - Called when the selection is cleared.
 *   @param {string}    opts.inputId      - ID for the <input> element (for a11y).
 *
 * @returns {{ getValue, setValue, clear, destroy }}
 */
function createAutocomplete(container, opts = {}) {
  const { placeholder = "Start typing a name…", label, onSelect, onClear, inputId } = opts;

  // ── DOM ────────────────────────────────────────────────────────────────────

  const wrapper = document.createElement("div");
  wrapper.className = "ac-wrapper";

  if (label) {
    const lbl = document.createElement("label");
    lbl.className = "ac-label";
    lbl.textContent = label;
    if (inputId) lbl.htmlFor = inputId;
    wrapper.appendChild(lbl);
  }

  const inputWrap = document.createElement("div");
  inputWrap.className = "ac-input-wrap";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "ac-input";
  input.placeholder = placeholder;
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.spellcheck = false;
  if (inputId) input.id = inputId;
  // Safari ignores autocomplete="off" for name-like inputs and shows the
  // Contacts autofill bar. The only reliable fix: start the input as readonly
  // (Safari never offers autofill on readonly inputs), then remove readonly
  // on focus so the user can type. Blur restores readonly while unlocked.
  input.setAttribute("readonly", "");

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ac-clear";
  clearBtn.innerHTML = "&#x2715;"; // ×
  clearBtn.setAttribute("aria-label", "Clear selection");
  clearBtn.style.display = "none";

  inputWrap.appendChild(input);
  inputWrap.appendChild(clearBtn);

  const dropdown = document.createElement("ul");
  dropdown.className = "ac-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";

  wrapper.appendChild(inputWrap);
  wrapper.appendChild(dropdown);
  container.appendChild(wrapper);

  // ── State ──────────────────────────────────────────────────────────────────

  let selectedValue  = null; // { name, isWriteIn }
  let activeIndex    = -1;
  let currentResults = [];
  let isLocked       = false; // True after a selection is confirmed.

  // ── Search logic ───────────────────────────────────────────────────────────

  function search(query) {
    if (!query || query.length < MIN_QUERY_LENGTH) return [];

    const q     = query.toLowerCase().trim();
    const exact = [];  // starts-with first name OR last name
    const fuzzy = [];  // contains anywhere in display name

    for (const c of CLASSMATES) {
      const display = c.display.toLowerCase();
      const first   = c.first.toLowerCase();
      const last    = c.last.toLowerCase();

      if (first.startsWith(q) || last.startsWith(q)) {
        exact.push({ name: c.display, isWriteIn: false });
      } else if (display.includes(q)) {
        fuzzy.push({ name: c.display, isWriteIn: false });
      }
    }

    const combined = [...exact, ...fuzzy];
    const overflow = combined.length > MAX_DROPDOWN_RESULTS
      ? combined.length - MAX_DROPDOWN_RESULTS
      : 0;
    const shown = combined.slice(0, MAX_DROPDOWN_RESULTS);

    // If no matches (with ≥2 chars), offer write-in.
    if (combined.length === 0 && query.trim().length >= 2) {
      shown.push({ name: query.trim(), isWriteIn: true, isWriteInOption: true });
    }

    return { shown, overflow };
  }

  // ── Render dropdown ────────────────────────────────────────────────────────

  function renderDropdown(results, overflow) {
    dropdown.innerHTML = "";
    activeIndex = -1;
    currentResults = results;

    if (results.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    results.forEach((r, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = "ac-option" + (r.isWriteInOption ? " ac-option--writein" : "");
      li.dataset.index = i;

      if (r.isWriteInOption) {
        li.innerHTML = 'Add \u201C' + escapeHtml(r.name) + '\u201D as a write-in';
      } else {
        // Highlight matching portion.
        const q   = input.value.trim();
        li.innerHTML = highlightMatch(r.name, q);
      }

      li.addEventListener("mousedown", e => {
        e.preventDefault(); // Don't blur the input before we process the click.
        selectResult(r);
      });

      dropdown.appendChild(li);
    });

    if (overflow > 0) {
      const more = document.createElement("li");
      more.className = "ac-option ac-option--more";
      more.setAttribute("role", "presentation");
      more.textContent = `…and ${overflow} more`;
      dropdown.appendChild(more);
    }

    dropdown.style.display = "block";
  }

  function closeDropdown() {
    dropdown.style.display = "none";
    activeIndex = -1;
    currentResults = [];
    dropdown.innerHTML = "";
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function selectResult(r) {
    selectedValue = { name: r.name, isWriteIn: r.isWriteIn };
    input.value   = r.name;
    isLocked      = true;
    input.readOnly = true;
    clearBtn.style.display = "block";
    inputWrap.classList.add("ac-input-wrap--selected");
    closeDropdown();
    if (onSelect) onSelect(selectedValue);
  }

  function clearSelection() {
    selectedValue  = null;
    input.value    = "";
    isLocked       = false;
    // Don't set readOnly here — the focus handler removes it when input.focus() fires.
    clearBtn.style.display = "none";
    inputWrap.classList.remove("ac-input-wrap--selected");
    closeDropdown();
    input.focus();
    if (onClear) onClear();
  }

  // ── Active item (keyboard nav) ─────────────────────────────────────────────

  function setActiveIndex(newIndex) {
    const items = dropdown.querySelectorAll(".ac-option:not(.ac-option--more)");
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].classList.remove("ac-option--active");
    }
    activeIndex = newIndex;
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].classList.add("ac-option--active");
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  input.addEventListener("input", () => {
    if (isLocked) return;
    const q = input.value.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      closeDropdown();
      return;
    }
    const { shown, overflow } = search(q);
    renderDropdown(shown, overflow);
  });

  input.addEventListener("keydown", e => {
    if (isLocked) return;

    const items = currentResults.filter(r => !r.isMorePlaceholder);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (dropdown.style.display === "none") {
          // Re-open if there's a query.
          const { shown, overflow } = search(input.value.trim());
          renderDropdown(shown, overflow);
        }
        setActiveIndex(Math.min(activeIndex + 1, items.length - 1));
        break;

      case "ArrowUp":
        e.preventDefault();
        setActiveIndex(Math.max(activeIndex - 1, -1));
        break;

      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) {
          selectResult(items[activeIndex]);
        } else if (items.length === 1) {
          // Auto-select when there's only one result.
          selectResult(items[0]);
        }
        break;

      case "Escape":
        closeDropdown();
        break;
    }
  });

  input.addEventListener("blur", () => {
    // Short delay so mousedown on a dropdown option fires first.
    setTimeout(() => {
      closeDropdown();
      // Restore readonly when not locked so Safari never sees a
      // writable name-like input at rest (prevents Contacts autofill).
      if (!isLocked) input.setAttribute("readonly", "");
    }, 150);
  });

  input.addEventListener("focus", () => {
    if (isLocked) return;
    // Remove readonly so the user can type.
    input.removeAttribute("readonly");
    const q = input.value.trim();
    if (q.length >= MIN_QUERY_LENGTH) {
      const { shown, overflow } = search(q);
      renderDropdown(shown, overflow);
    }
  });

  clearBtn.addEventListener("click", clearSelection);

  // ── Utilities ──────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightMatch(name, query) {
    if (!query) return escapeHtml(name);
    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(name);
    return (
      escapeHtml(name.slice(0, idx)) +
      '<span class="ac-hl">' + escapeHtml(name.slice(idx, idx + query.length)) + '</span>' +
      escapeHtml(name.slice(idx + query.length))
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    getValue()           { return selectedValue; },
    setValue(name, isWriteIn = false) {
      selectResult({ name, isWriteIn });
    },
    clear()              { clearSelection(); },
    destroy()            { wrapper.remove(); },
    getInputEl()         { return input; },
  };
}
