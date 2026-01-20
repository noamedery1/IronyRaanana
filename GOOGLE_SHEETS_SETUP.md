# How to Enable "Save to Google Sheet"

Writing data back to a Google Sheet requires a small script because Google doesn't allow public writing for security reasons.

## Step 1: Add the Script to your Google Sheet
1. Open your Google Sheet.
2. Go to **Extensions** > **Apps Script**.
3. **Delete everything** currently in the script editor.
4. Copy and paste the code below **exactly as is**:

```javascript
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "Invalid JSON" }));
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet;

  // 1. Try to find sheet by name
  if (data.sheetName) {
    sheet = ss.getSheetByName(data.sheetName);
  }

  // 2. Fallback: Use the FIRST visible sheet
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  
  if (!sheet) {
     return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "No sheet found" }));
  }
  
  // Write data
  var rows = data.rows;
  
  if (rows && rows.length > 0) {
    // Define the range dimensions
    var numRows = rows.length;
    var numCols = rows[0].length;
    
    // Get the range
    var range = sheet.getRange(1, 1, numRows, numCols);
    
    // 1. Update Values
    range.setValues(rows);
    
    // 2. Enforce Formatting (Fix for large/messy fonts)
    range.setFontSize(11);               // Standard readable size
    range.setVerticalAlignment("middle");
    range.setHorizontalAlignment("center");
    range.setWrap(true);                 // Wrap text if too long
    
    // Optional: Make the first row (Headers) bold and slightly larger
    var headerRange = sheet.getRange(1, 1, 1, numCols);
    headerRange.setFontWeight("bold");
    headerRange.setFontSize(12);
    
    // Optional: Make the first column (Team Names) bold and align right (Hebrew)
    var teamColRange = sheet.getRange(1, 1, numRows, 1);
    teamColRange.setFontWeight("bold");
    teamColRange.setHorizontalAlignment("right"); 
  }
  
  return ContentService.createTextOutput(JSON.stringify({ "status": "success", "sheetUsed": sheet.getName() }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Step 2: Deploy as a Web App (Crucial!)
1. Click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon (Select type) > **Web app**.
3. Description: "Scheduler API v4".
4. **Execute as**: Me (your email).
5. **Who has access**: **Anyone** (This is crucial!).
6. Click **Deploy**.
7. **Copy the "Web App URL"** (it must end in `/exec`).

## Step 3: Connect to the Dashboard
1. Go back to the Admin Dashboard > Settings.
2. Paste the URL into the "API URL" field.
3. **Important**: Check the "Sheet Name" field in the settings. If your tab is named "גיליון1", write "גיליון1" there!
