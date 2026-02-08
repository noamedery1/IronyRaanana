function doPost(e) {
  var postData;
  try {
    postData = JSON.parse(e.postData.contents);
  } catch (err) {
    return createErrorResponse("Invalid JSON payload");
  }

  const action = postData.action || 'saveSchedule'; 
  
  if (action === 'saveSchedule') return handleSaveSchedule(postData);
  if (action === 'sendFeedback') return handleSendFeedback(postData);
  if (action === 'trainerLogin') return handleTrainerLogin(postData);
  if (action === 'submitRequest') return handleSubmitRequest(postData);
  
  return createErrorResponse("Unknown action: " + action);
}

// 1. SAVE SCHEDULE
function handleSaveSchedule(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(data.sheetName || "Sheet1");
  if (!sheet) sheet = ss.insertSheet(data.sheetName || "Sheet1");
  
  const rows = data.rows;
  if (!rows || !rows.length) return createErrorResponse("No data");

  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  return createSuccessResponse("Saved");
}

// 2. SEND FEEDBACK
function handleSendFeedback(data) {
  const adminEmail = "Dani.tankel@gmail.com"; 
  MailApp.sendEmail({
    to: adminEmail,
    subject: "New Feedback",
    body: "Name: " + (data.name || "Anon") + "\nMessage:\n" + data.message
  });
  return createSuccessResponse("Sent");
}

// 3. TRAINER LOGIN
function handleTrainerLogin(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Trainers");
  if (!sheet) {
    sheet = ss.insertSheet("Trainers");
    sheet.appendRow(["Name", "Code"]);
    sheet.appendRow(["Coach Demo", "1234"]); 
    sheet.hideSheet();
  }
  
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === data.name.trim().toLowerCase() && 
        values[i][1].toString().trim() == data.code.toString().trim()) {
      return createSuccessResponse({ valid: true, trainerName: values[i][0] });
    }
  }
  return createSuccessResponse({ valid: false });
}

// 4. SUBMIT REQUEST 
function handleSubmitRequest(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Requests");
  
  if (!sheet) {
    sheet = ss.insertSheet("Requests");
    sheet.appendRow(["Timestamp", "Trainer", "Day", "Original", "Team", "Type", "NewTime", "NewLoc", "Reason", "Status", "Row", "Col"]);
  }

  const timestamp = new Date();
  const rowIndex = sheet.getLastRow() + 1; 

  const rowData = [
    timestamp,
    data.trainerName,
    data.day,
    data.time, 
    data.team,
    data.type,      
    data.newTime || "",
    data.newLocation || "",
    data.reason || "",
    "PENDING",
    data.row, 
    data.col  
  ];

  sheet.appendRow(rowData);

  const serviceUrl = ScriptApp.getService().getUrl();
  const approveLink = serviceUrl + "?action=approve&reqId=" + rowIndex;
  const rejectLink = serviceUrl + "?action=reject&reqId=" + rowIndex;

  const adminEmail = "Dani.tankel@gmail.com";
  MailApp.sendEmail({
    to: adminEmail,
    subject: "Request: " + data.trainerName,
    htmlBody: `
      <h3>Request from ${data.trainerName}</h3>
      <p><strong>Team:</strong> ${data.team}</p>
      <p><strong>Change:</strong> ${data.type} (${data.day})</p>
      <p><strong>Details:</strong> ${data.details}</p>
      <br/>
      <a href="${approveLink}" style="background:green;color:white;padding:10px;text-decoration:none;border-radius:5px;">✅ APPROVE</a>
      &nbsp;&nbsp;
      <a href="${rejectLink}" style="background:red;color:white;padding:10px;text-decoration:none;border-radius:5px;">❌ REJECT</a>
    `
  });

  return createSuccessResponse("Submitted");
}

// 5. HANDLING CLICKS (GET)
function doGet(e) {
  if (!e.parameter || !e.parameter.action) return ContentService.createTextOutput("App is running");

  const action = e.parameter.action;
  const reqId = Number(e.parameter.reqId); 
  
  if (action === 'approve') return handleApprove(reqId);
  if (action === 'reject') return handleReject(reqId);
  
  return ContentService.createTextOutput("Unknown action");
}

function handleApprove(reqRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  
  // Safety check range
  if (reqRow < 2 || reqRow > reqSheet.getLastRow()) return HtmlService.createHtmlOutput("<h3>Invalid Request ID</h3>");

  const data = reqSheet.getRange(reqRow, 1, 1, 12).getValues()[0]; 
  
  const status = data[9];
  if (status !== 'PENDING') return HtmlService.createHtmlOutput("<h3>Already processed: " + status + "</h3>");

  const targetRow = data[10];
  const targetCol = data[11]; // 0-based col index from frontend
  
  const sheetRow = Number(targetRow); 
  // Safety check for invalid rows (e.g. 0 or 1 if header)
  if (isNaN(sheetRow) || sheetRow < 2) return HtmlService.createHtmlOutput("<h3 style='color:red'>Invalid Schedule Row Index. Cancelled to protect sheet.</h3>");

  const sheetCol = Number(targetCol) + 1; 

  const mainSheet = ss.getSheets()[0]; 
  const cell = mainSheet.getRange(sheetRow, sheetCol);
  const currentVal = cell.getValue().toString();
  
  const type = data[5];
  let newTime = data[6];
  const newLoc = data[7];

  // Normalize time to HH:MM format (e.g. 1630 -> 16:30) to match parsing logic
  if (newTime) {
      newTime = newTime.toString().replace(/\b([0-1][0-9]|2[0-3])([0-5][0-9])\b/g, "$1:$2");
  }
  
  let newVal = "";
  if (type === 'CANCEL') {
      let original = currentVal;
      if (!original.toUpperCase().includes('XXX')) {
          newVal = "XXX " + original;
      } else {
          newVal = original;
      }
  } else { // CHANGE
      // Clean currentVal of old times AND status markers
      let cleanCurrent = currentVal
          .replace(/x|בוטל|canceled|cancelled|⚠️|!|שינוי|CHANGE/gi, '')
          // Support HH:MM and HHMM formats (with or without dashes)
          .replace(/\b(?:\d{1,2}:\d{2}|\d{3,4})(?:\s*[-–]\s*(?:\d{1,2}:\d{2}|\d{3,4}))?\b/g, '') 
          .replace(/\s+/g, ' ')
          .trim();
      
      if (newLoc && newLoc.toString().trim() !== "") {
          newVal = newTime + " " + newLoc;
      } else {
          // Keep old context (Loc + Match + etc)
          newVal = newTime + (cleanCurrent ? " " + cleanCurrent : "");
      }
  }

  cell.setValue(newVal);
  if (type === 'CHANGE') cell.setBackground('#FFF2CC');
  if (type === 'CANCEL') cell.setBackground('#F4CCCC');
  
  reqSheet.getRange(reqRow, 10).setValue("APPROVED");
  return HtmlService.createHtmlOutput("<h1 style='color:green'>Request Approved & Updated!</h1>");
}

function handleReject(reqRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  reqSheet.getRange(reqRow, 10).setValue("REJECTED");
  return HtmlService.createHtmlOutput("<h1 style='color:red'>Request Rejected.</h1>");
}

function createSuccessResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({error: msg})).setMimeType(ContentService.MimeType.JSON);
}
