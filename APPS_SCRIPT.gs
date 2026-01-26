function doPost(e) {
  const sheetName = "Sheet1"; // Default, can be overridden by params
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    const data = JSON.parse(e.postData.contents);
    const targetSheetName = data.sheetName || sheetName;
    let sheet = ss.getSheetByName(targetSheetName);
    
    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(targetSheetName);
    }
    
    const rows = data.rows; // Array of arrays
    
    if (!rows || rows.length === 0) {
      return ContentService.createTextOutput("No data provided").setMimeType(ContentService.MimeType.TEXT);
    }
    
    // Clear existing content safely? 
    // Usually we want to overwrite the schedule part.
    // For this MVP, we will clear and rewrite the range derived from data size.
    // Be careful not to delete formulas if used elsewhere, but here we rewrite the whole exported grid.
    
    sheet.clear(); // Simple approach: Clear everything and paste fresh
    
    // Set values
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    
    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
    
  } catch (err) {
    return ContentService.createTextOutput("Error: " + err.toString()).setMimeType(ContentService.MimeType.TEXT);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Service is running. Use POST to update data.").setMimeType(ContentService.MimeType.TEXT);
}
