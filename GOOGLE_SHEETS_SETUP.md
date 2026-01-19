# How to Enable "Save to Google Sheet"

Writing data back to a Google Sheet requires a small script because Google doesn't allow public writing for security reasons.

## Step 1: Add the Script to your Google Sheet
1. Open your Google Sheet.
2. Go to **Extensions** > **Apps Script**.
3. Delete any code there and paste the code below:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1"); // Function assumes 'Sheet1'
  const data = JSON.parse(e.postData.contents);
  
  // Clear existing content (optional, or just overwrite)
  // sheet.clear(); 
  
  // header row is usually row 1
  // data.rows is an array of arrays [[val, val], [val, val]]
  
  // We want to update specifically from the second row onwards, or the whole sheet
  // Let's assume we replace the whole table for consistency with the preview
  
  const rows = data.rows;
  
  if (rows && rows.length > 0) {
    // Write data starting at A1 (or A2 if you want to keep headers separate, but the app sends headers too)
    // The App sends headers as the first row in 'rows'
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ "status": "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Step 2: Deploy as a Web App
1. Click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon (Select type) > **Web app**.
3. Description: "Scheduler API".
4. **Execute as**: Me (your email).
5. **Who has access**: **Anyone** (This is crucial so the website can talk to it).
6. Click **Deploy**.
7. **Copy the "Web App URL"**.

## Step 3: Connect to the Dashboard
1. Go back to the Admin Dashboard > Settings (הגדרות).
2. Paste the **Web App URL** into the new "Save URL / API Endpoint" field.
3. Now the "Save" button will update your sheet directly!
