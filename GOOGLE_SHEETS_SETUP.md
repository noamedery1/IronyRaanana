# How to Enable "Save to Google Sheet"

Writing data back to a Google Sheet requires a small script because Google doesn't allow public writing for security reasons.

## Step 1: Add the Script to your Google Sheet
1. Open your Google Sheet.
2. Go to **Extensions** > **Apps Script**.
3. Delete any code there and paste the **UPDATED** code below (this version is smarter!):

```javascript
function doPost(e) {
  var data;
  
  // Try to parse the data
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    // If simple parse fails (sometimes happens with different content-types), try to just grab the raw string
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "Invalid JSON" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet;

  // 1. Try to find sheet by name (if provided)
  if (data.sheetName) {
    sheet = ss.getSheetByName(data.sheetName);
  }

  // 2. If no name provided or not found, default to the FIRST visible sheet
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  
  if (!sheet) {
     return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "No sheet found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const rows = data.rows;
  
  if (rows && rows.length > 0) {
    // Clear the existing data to avoid leftovers
    // sheet.clearContents(); 
    
    // Write new data
    // We assume row 1 is headers, so we write from A1
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ "status": "success", "sheetUsed": sheet.getName() }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Step 2: Deploy as a Web App
1. Click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon (Select type) > **Web app**.
3. Description: "Scheduler API v2".
4. **Execute as**: Me (your email).
5. **Who has access**: **Anyone** (This is crucial!).
6. Click **Deploy**.
7. **Copy the "Web App URL"** (it must end in `/exec`).

## Step 3: Connect to the Dashboard
1. Go back to the Admin Dashboard > Settings.
2. Paste the URL into the "API URL" field.
3. **Important**: Check the "Sheet Name" field in the settings. If your tab is named "גיליון1", write "גיליון1" there!
