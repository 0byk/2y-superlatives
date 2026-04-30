// =============================================================================
// 2Y Send-Off Superlatives — Google Apps Script Backend
// =============================================================================
// Deploy as: Execute as → Me | Who has access → Anyone
// After editing this file, ALWAYS create a New Deployment — Apps Script serves
// the last deployed version, not the saved file.
// =============================================================================

// ── CONFIGURE THESE BEFORE DEPLOYING ─────────────────────────────────────────

var ADMIN_PASSWORD = "2Y2026!";

// Closed April 30 2026 — deadline set to past to lock submissions.
var VOTING_DEADLINE_MS = Date.UTC(2026, 3, 30, 0, 0, 0); // month is 0-indexed

// Sheet tab names — must match exactly (lowercase, no spaces).
var SUBMISSIONS_SHEET = "submissions";
var VOTES_SHEET       = "votes";

// =============================================================================
// ENTRY POINT
// =============================================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respond({ ok: false, error: "Empty request body." });
    }

    var body   = JSON.parse(e.postData.contents);
    var action = body.action;

    var result;
    if (action === "submit_ballot") {
      result = handleSubmitBallot(body);
    } else if (action === "admin_stats") {
      result = handleAdminStats(body);
    } else if (action === "admin_export") {
      result = handleAdminExport(body);
    } else {
      result = { ok: false, error: "Unknown action: " + action };
    }

    return respond(result);
  } catch (err) {
    return respond({ ok: false, error: "Server error: " + err.message });
  }
}

// GET handler — lets you test the URL in a browser to confirm it's deployed.
function doGet(e) {
  return respond({ ok: true, message: "2Y Superlatives API is running." });
}

// =============================================================================
// HANDLERS
// =============================================================================

function handleSubmitBallot(body) {
  // Server-side deadline check.
  if (Date.now() > VOTING_DEADLINE_MS) {
    return { ok: false, error: "Voting has closed." };
  }

  var votes = body.votes;
  if (!votes || !votes.length) {
    return { ok: false, error: "No votes provided." };
  }

  // Generate a random UUID as ballot_id.
  // This lives ONLY in the votes sheet — never written to submissions.
  var ballotId = generateUUID();

  // Build vote rows. Each single vote = 1 row. Each duo = 2 rows.
  var voteRows = [];
  for (var i = 0; i < votes.length; i++) {
    var vote = votes[i];
    if (!vote.categoryId) continue;

    if (vote.nomineeName1 && vote.nomineeName2) {
      voteRows.push([ballotId, vote.categoryId, vote.nomineeName1, vote.isWriteIn ? "TRUE" : "FALSE"]);
      voteRows.push([ballotId, vote.categoryId, vote.nomineeName2, vote.isWriteIn ? "TRUE" : "FALSE"]);
    } else if (vote.nomineeName) {
      voteRows.push([ballotId, vote.categoryId, vote.nomineeName, vote.isWriteIn ? "TRUE" : "FALSE"]);
    }
  }

  if (!voteRows.length) {
    return { ok: false, error: "No valid votes found." };
  }

  // CRITICAL: Shuffle vote rows before writing so row order doesn't reveal
  // submission order, which would allow de-anonymization via timing.
  shuffleArray(voteRows);

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Write votes (no timestamp here).
  var votesSheet = ss.getSheetByName(VOTES_SHEET);
  if (!votesSheet) return { ok: false, error: "Sheet '" + VOTES_SHEET + "' not found. Check tab name." };
  var lastVoteRow = votesSheet.getLastRow();
  votesSheet.getRange(lastVoteRow + 1, 1, voteRows.length, 4).setValues(voteRows);

  // Append one timestamp to submissions sheet.
  // No ballot_id here — there is no link between submissions and votes.
  var submissionsSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
  if (!submissionsSheet) return { ok: false, error: "Sheet '" + SUBMISSIONS_SHEET + "' not found. Check tab name." };
  submissionsSheet.appendRow([new Date().toISOString()]);

  return { ok: true };
}

function handleAdminStats(body) {
  if (body.password !== ADMIN_PASSWORD) return { ok: false, error: "Invalid admin password." };

  var ss              = SpreadsheetApp.getActiveSpreadsheet();
  var submissionsSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
  var votesSheet       = ss.getSheetByName(VOTES_SHEET);

  var totalBallots  = submissionsSheet ? Math.max(0, submissionsSheet.getLastRow() - 1) : 0;
  var totalEligible = 75;
  var allVoteRows   = getSheetData(votesSheet);
  var tallies       = buildCategoryTallies(allVoteRows);

  return {
    ok:           true,
    totalBallots: totalBallots,
    totalEligible: totalEligible,
    percentVoted: totalEligible > 0 ? Math.round((totalBallots / totalEligible) * 100) : 0,
    votingOpen:   Date.now() < VOTING_DEADLINE_MS,
    deadlineISO:  new Date(VOTING_DEADLINE_MS).toISOString(),
    categories:   tallies,
  };
}

function handleAdminExport(body) {
  if (body.password !== ADMIN_PASSWORD) return { ok: false, error: "Invalid admin password." };

  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var votesSheet = ss.getSheetByName(VOTES_SHEET);
  var tallies    = buildCategoryTallies(getSheetData(votesSheet));

  var lines = ["category_id,rank,nominee_name,votes,is_write_in"];
  for (var i = 0; i < tallies.length; i++) {
    var cat = tallies[i];
    for (var j = 0; j < cat.topNominees.length; j++) {
      var nominee = cat.topNominees[j];
      lines.push([
        csvEscape(cat.categoryId),
        j + 1,
        csvEscape(nominee.name),
        nominee.votes,
        nominee.isWriteIn ? "TRUE" : "FALSE",
      ].join(","));
    }
  }

  return { ok: true, csv: lines.join("\n") };
}

// =============================================================================
// HELPERS
// =============================================================================

function getSheetData(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var rows    = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return rows;
}

function buildCategoryTallies(voteRows) {
  var byCategory    = {};
  var ballotCatGroups = {};

  for (var i = 0; i < voteRows.length; i++) {
    var row      = voteRows[i];
    var ballotId = row["ballot_id"]    || "";
    var catId    = row["category_id"]  || "";
    var name     = row["nominee_name"] || "";
    var isWriteIn = (row["is_write_in"] || "").toString().toUpperCase() === "TRUE";

    if (!catId || !name) continue;

    // Single-nominee tallies.
    if (!byCategory[catId]) byCategory[catId] = {};
    if (!byCategory[catId][name]) byCategory[catId][name] = { votes: 0, isWriteIn: isWriteIn };
    byCategory[catId][name].votes++;

    // Duo pair detection: group by (ballot_id, category_id).
    if (ballotId) {
      var key = ballotId + "||" + catId;
      if (!ballotCatGroups[key]) ballotCatGroups[key] = { catId: catId, names: [], isWriteIn: isWriteIn };
      ballotCatGroups[key].names.push(name);
    }
  }

  // Build duo tallies for (ballot_id, category_id) groups with exactly 2 names.
  var duoCats    = {};
  var duoTallies = {};
  var keys = Object.keys(ballotCatGroups);
  for (var k = 0; k < keys.length; k++) {
    var group = ballotCatGroups[keys[k]];
    if (group.names.length === 2) {
      duoCats[group.catId] = true;
      var pairKey = group.names.slice().sort().join(" + ");
      if (!duoTallies[group.catId]) duoTallies[group.catId] = {};
      if (!duoTallies[group.catId][pairKey]) {
        duoTallies[group.catId][pairKey] = { votes: 0, isWriteIn: group.isWriteIn };
      }
      duoTallies[group.catId][pairKey].votes++;
    }
  }

  // Build result array — one entry per category.
  var seen    = {};
  var catIds  = [];
  for (var r = 0; r < voteRows.length; r++) {
    var cid = voteRows[r]["category_id"] || "";
    if (cid && !seen[cid]) { seen[cid] = true; catIds.push(cid); }
  }

  return catIds.map(function(catId) {
    var isDuo = !!duoCats[catId];
    var topNominees;

    if (isDuo && duoTallies[catId]) {
      topNominees = Object.keys(duoTallies[catId]).map(function(pairKey) {
        return { name: pairKey, votes: duoTallies[catId][pairKey].votes, isWriteIn: duoTallies[catId][pairKey].isWriteIn };
      });
    } else {
      var nominees = byCategory[catId] || {};
      topNominees = Object.keys(nominees).map(function(name) {
        return { name: name, votes: nominees[name].votes, isWriteIn: nominees[name].isWriteIn };
      });
    }

    topNominees.sort(function(a, b) { return b.votes - a.votes; });

    return {
      categoryId:  catId,
      isDuo:       isDuo,
      totalVotes:  topNominees.reduce(function(s, n) { return s + n.votes; }, 0),
      topNominees: topNominees,
    };
  });
}

function shuffleArray(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function csvEscape(val) {
  var s = String(val === null || val === undefined ? "" : val);
  if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function respond(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
