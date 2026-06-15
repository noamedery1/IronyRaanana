/* ADMIN DASHBOARD SCRIPT - FINAL VERSION
   Supports:
   1. Saving Schedule (preserving format)
   2. Saving Rules (to 'SavedRules' sheet)
   3. Loading Rules (via GET)
   4. Trainer schedule PROPOSALS (proposeSlots) — written colored into the board
      and marked "(הצעה)" for the manager to approve/relocate.
*/

function doGet(e) {
  const sheetName = e.parameter.sheet || "SavedRules";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    // If sheet doesn't exist, return empty JSON array
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }

  // Return all data as JSON (display values so dates show as the trainer sees them)
  const data = sheet.getDataRange().getDisplayValues();
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const defaultSheet = "Sheet1";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    const data = JSON.parse(e.postData.contents);

    // NEW: trainer proposals branch (the dashboard save has no 'action' field, so it falls through).
    if (data.action === 'proposeSlots') {
      return handleProposeSlots(data, ss);
    }

    const targetSheetName = data.sheetName || defaultSheet;
    let sheet = ss.getSheetByName(targetSheetName);

    // Create sheet if missing
    if (!sheet) {
      sheet = ss.insertSheet(targetSheetName);
    }

    const rows = data.rows; // Array of arrays

    if (!rows || rows.length === 0) {
      return ContentService.createTextOutput("No data provided").setMimeType(ContentService.MimeType.TEXT);
    }

    // Clear and Write
    sheet.clearContents();
    if (rows.length > 0) {
        const range = sheet.getRange(1, 1, rows.length, rows[0].length);
        range.setValues(rows);
    }

    // === FORMATTING LOGIC ===

    /* Apply formatting ONLY for the main schedule sheets (not the Rules sheet) */
    if (targetSheetName !== "SavedRules") {
        // 1. Header (Row 1)
        const headerRange = sheet.getRange(1, 1, 1, rows[0].length);
        headerRange.setFontWeight("bold");
        headerRange.setHorizontalAlignment("center");
        headerRange.setFontSize(12);
        headerRange.setBackground("#e6e6e6");

        // 2. Data Rows
        if (rows.length > 1) {
           const dataRange = sheet.getRange(2, 1, rows.length - 1, rows[0].length);
           dataRange.setHorizontalAlignment("center");
           dataRange.setVerticalAlignment("middle");
           dataRange.setWrap(true);
           dataRange.setFontSize(11);
        }
    }

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    return ContentService.createTextOutput("Error: " + err.toString()).setMimeType(ContentService.MimeType.TEXT);
  }
}

// ===== Trainer proposals =====
// Writes each proposed slot into (row, day-column) of the manager's schedule sheet,
// colored by the trainer and marked "(הצעה)". The manager then approves or relocates.
function handleProposeSlots(data, ss) {
  const sheetName = data.sheetName || "Sheet1";
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return jsonOut({ error: "Sheet not found: " + sheetName });

  const targetRow = Number(data.row);
  if (isNaN(targetRow) || targetRow < 2) return jsonOut({ error: "Invalid row" });
  if (!Array.isArray(data.slots) || !data.slots.length) return jsonOut({ error: "No slots" });

  const color = (data.color || "#FFF2CC").toString();
  let written = 0;

  data.slots.forEach(function (slot) {
    if (!slot.day) return;
    const value = (slot.time || "").toString().trim() + (slot.location ? " " + slot.location.toString().trim() : "");
    if (!value.trim()) return;
    const col = findColumnForDayInSheet(sheet, slot.day);
    if (col === -1) return;
    const cell = sheet.getRange(targetRow, col);
    cell.setValue(value + " (הצעה)");
    cell.setBackground(color);
    written++;
  });

  return jsonOut({ ok: true, written: written });
}

// Find a day's column by matching the day NAME only (first token), ignoring trailing dates.
function findColumnForDayInSheet(sheet, dayName) {
  if (!dayName) return -1;
  const dayToken = dayName.toString().trim().split(/\s+/)[0];
  if (!dayToken) return -1;

  const lastCol = sheet.getLastColumn();
  const searchCols = lastCol > 30 ? 30 : lastCol;
  if (searchCols < 1) return -1;

  const values = sheet.getRange(1, 1, Math.min(20, sheet.getLastRow()), searchCols).getDisplayValues();
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] && row[c].toString().trim().split(/\s+/)[0] === dayToken) {
        return c + 1; // 1-based
      }
    }
  }
  return -1;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
