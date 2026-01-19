# How to Enable "Save to Google Sheet"

Writing data back to a Google Sheet requires a small script because Google doesn't allow public writing for security reasons.

## Step 1: Add the Script to your Google Sheet
1. Open your Google Sheet.
2. Go to **Extensions** > **Apps Script**.
3. Delete any code there and paste the **UPDATED** code below (this version is smarter!):

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
  
  // Write data WITHOUT clearing standard formatting
  // We assume the first row (headers) is already there and stylized.
  // We also assume the first column (Team Names) is stylized.
  
  const rows = data.rows;
  
  if (rows && rows.length > 0) {
    // Check if we should update headers or just data
    // Usually it's safer to skip the header row to preserve its formatting
    // But since the app might change team order, we need to be careful.
    
    // Strategy: Update values ONLY. Do not use clear() which wipes formatting.
    // We will update the whole range matching the data size.
    
    // If you want to skip the first row (headers) to be absolutely safe about header colors:
    // const dataBody = rows.slice(1);
    // sheet.getRange(2, 1, dataBody.length, dataBody[0].length).setValues(dataBody);
    
    // However, if teams changed, we need to update everything.
    // setValues() updates text but KEEPS cell formatting (background color, borders, font).
    
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ "status": "success", "sheetUsed": sheet.getName() }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Step 2: Deploy as a Web App
1. Click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon (Select type) > **Web app**.
3. Description: "Scheduler API v3".
4. **Execute as**: Me (your email).
5. **Who has access**: **Anyone** (This is crucial!).
6. Click **Deploy**.
7. **Copy the "Web App URL"** (it must end in `/exec`).

## Step 3: Connect to the Dashboard
1. Go back to the Admin Dashboard > Settings.
2. Paste the URL into the "API URL" field.
3. **Important**: Check the "Sheet Name" field in the settings. If your tab is named "גיליון1", write "גיליון1" there!
