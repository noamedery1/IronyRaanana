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
  if (action === 'trainerAuth') return handleTrainerAuth(postData);
  if (action === 'getTrainers') return handleGetTrainers(postData);
  if (action === 'sendTrainerPush') return handleSendTrainerPush(postData);
  if (action === 'submitRequest') return handleSubmitRequest(postData);
  if (action === 'registerSubscriber') return handleRegisterSubscriber(postData);
  if (action === 'registerPushSubscription') return handleRegisterPushSubscription(postData);
  if (action === 'unregisterSubscriber') return handleUnregisterSubscriber(postData);
  if (action === 'unregisterPushSubscription') return handleUnregisterPushSubscription(postData);

  return createErrorResponse("Unknown action: " + action);
}

// ===== Web Push config =====
// Node backend that actually delivers the push (holds the VAPID private key).
const NODE_PUSH_URL = 'https://ironyraanana-production.up.railway.app/api/push/send';
// Shared secret — must match the PUSH_SECRET env var on the Node server.
// Set it in: Project Settings → Script Properties → key "PUSH_SECRET". Never hardcode it here.
function getPushSecret() {
  return PropertiesService.getScriptProperties().getProperty('PUSH_SECRET') || '';
}

// 1. SAVE SCHEDULE
function handleSaveSchedule(data) {
  let ss;
  if (data.sheetId) {
    try {
      ss = SpreadsheetApp.openById(data.sheetId);
    } catch (e) {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  
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
    replyTo: data.email || "",
    subject: "New Feedback: " + (data.name || "Anon"),
    body: "Name: " + (data.name || "Anon") + 
          "\nEmail: " + (data.email || "Not provided") + 
          "\n\nMessage:\n" + data.message
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

// ===== Trainer self-service (Section 5) =====
// Trainers sheet columns: Name(0), Code(1), Teams(2), Color(3), Token(4).
const TRAINER_COLORS = ['#FCE5CD', '#D9EAD3', '#CFE2F3', '#F4CCCC', '#FFF2CC', '#D9D2E9', '#D0E0E3', '#EAD1DC'];

function getTrainersSheet(ss) {
  let sheet = ss.getSheetByName("Trainers");
  if (!sheet) {
    sheet = ss.insertSheet("Trainers");
    sheet.appendRow(["Name", "Code", "Teams", "Color", "Token"]);
  }
  return sheet;
}

// Ensures a trainer row has a color + token; assigns and persists if missing. Returns the trainer object.
function trainerFromRow(sheet, rowValues, rowIndex) {
  let color = (rowValues[3] || "").toString().trim();
  let token = (rowValues[4] || "").toString().trim();
  if (!color) {
    color = TRAINER_COLORS[(rowIndex - 1) % TRAINER_COLORS.length];
    sheet.getRange(rowIndex + 1, 4).setValue(color); // col 4 (1-based), rowIndex is 0-based data index
  }
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
    sheet.getRange(rowIndex + 1, 5).setValue(token);
  }
  const teams = (rowValues[2] || "").toString().split(/[,;\n]/).map(t => t.trim()).filter(Boolean);
  return { name: (rowValues[0] || "").toString(), teams: teams, color: color, token: token };
}

// Authenticate by token (personal link) or name+code; auto-assigns color/token on first use.
function handleTrainerAuth(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getTrainersSheet(ss);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const byToken = data.token && (row[4] || "").toString().trim() === data.token.toString().trim();
    const byCreds = data.name && data.code &&
      (row[0] || "").toString().trim().toLowerCase() === data.name.toString().trim().toLowerCase() &&
      (row[1] || "").toString().trim() === data.code.toString().trim();
    if (byToken || byCreds) {
      const t = trainerFromRow(sheet, row, i);
      return createSuccessResponse({ valid: true, trainerName: t.name, teams: t.teams, color: t.color, token: t.token });
    }
  }
  return createSuccessResponse({ valid: false });
}

// Returns the list of trainer names (for the manager's broadcast picker).
function handleGetTrainers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getTrainersSheet(ss);
  const values = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < values.length; i++) {
    const n = (values[i][0] || '').toString().trim();
    if (n) names.push(n);
  }
  return createSuccessResponse({ trainers: names });
}

// Sends a free-text push to all trainers ('all') or a selected subset (array of names).
// Optional guard: Script Property MANAGER_PUSH_PW (leave unset to allow without a password).
function handleSendTrainerPush(data) {
  const pw = PropertiesService.getScriptProperties().getProperty('MANAGER_PUSH_PW') || '';
  if (pw && (data.password || '').toString() !== pw) return createErrorResponse("Wrong manager password");

  const title = data.title || "הודעה מהנהלת המועדון";
  const body = (data.body || '').toString();
  if (!body.trim()) return createErrorResponse("Empty message");

  const url = '/raanana/trainer';
  const icon = '/icons/trainer-192.png';
  const targets = data.targets;
  if (targets === 'all' || !Array.isArray(targets) || !targets.length) {
    sendPushForTeam('__TRAINER__:', title, body, url, icon); // prefix matches every trainer
  } else {
    targets.forEach(function (name) { sendPushForTeam('__TRAINER__:' + name, title, body, url, icon); });
  }
  return createSuccessResponse({ ok: true });
}

// 4. SUBMIT REQUEST
function handleSubmitRequest(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Requests");
  
  if (!sheet) {
    sheet = ss.insertSheet("Requests");
    // Added NewDay to headers
    sheet.appendRow(["Timestamp", "Trainer", "Day", "Original", "Team", "Type", "NewTime", "NewLoc", "NewDay", "Reason", "Status", "Row", "Col"]);
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
    data.newDay || "", // Store the new day for MOVE requests
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
  
  let detailsHtml = `<p><strong>Team:</strong> ${data.team}</p>
                     <p><strong>Type:</strong> ${data.type}</p>`;
  
  if (data.type === 'MOVE') {
      detailsHtml += `<p><strong>Move To:</strong> ${data.newDay} at ${data.newTime} (${data.newLocation})</p>`;
  } else if (data.type === 'CHANGE') {
      detailsHtml += `<p><strong>Change To:</strong> ${data.newTime} (${data.newLocation})</p>`;
  }

  MailApp.sendEmail({
    to: adminEmail,
    subject: `Request: ${data.trainerName} - ${data.type}`,
    htmlBody: `
      <h3>Request from ${data.trainerName}</h3>
      ${detailsHtml}
      <p><strong>Reason:</strong> ${data.reason}</p>
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
  if (action === 'unsubscribe') {
    handleUnregisterSubscriber({ email: e.parameter.email, team: e.parameter.team });
    return HtmlService.createHtmlOutput(
      "<div style='font-family:sans-serif;direction:rtl;text-align:center;padding:40px'>" +
      "<h2>הוסרת מרשימת התפוצה ✅</h2><p>לא תקבל יותר עדכוני מייל לקבוצה זו.</p></div>");
  }

  return ContentService.createTextOutput("Unknown action");
}

function handleApprove(reqRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  
  if (reqRow < 2 || reqRow > reqSheet.getLastRow()) return HtmlService.createHtmlOutput("<h3>Invalid Request ID</h3>");

  // Schema: Time(0), Trainer(1), Day(2), Orig(3), Team(4), Type(5), NewTime(6), NewLoc(7), NewDay(8), Reason(9), Status(10), Row(11), Col(12)
  const dataRange = reqSheet.getRange(reqRow, 1, 1, 13);
  const data = dataRange.getDisplayValues()[0]; 
  
  const status = data[10]; // Index 10 is Status
  if (status !== 'PENDING') return HtmlService.createHtmlOutput("<h3>Already processed: " + status + "</h3>");

  const targetRow = Number(data[11]); // Index 11 is Row
  if (isNaN(targetRow) || targetRow < 2) return HtmlService.createHtmlOutput("<h3 style='color:red'>Invalid Row.</h3>");

  // ROBUST SHEET FINDING: Find the sheet that actually contains the schedule
  const oldDayName = data[2]; // e.g. "ראשון"
  
  const scheduleInfo = findScheduleSheetAndCol(ss, oldDayName);
  if (!scheduleInfo) {
      return HtmlService.createHtmlOutput("<h3 style='color:red'>Could not find Schedule Sheet containing: " + oldDayName + "</h3>");
  }
  
  const mainSheet = scheduleInfo.sheet;
  const oldDayCol = scheduleInfo.col; // Dynamically found column index (1-based)

  const cell = mainSheet.getRange(targetRow, oldDayCol);
  const currentVal = cell.getValue().toString();
  
  const type = data[5];
  let newTime = data[6];
  const newLoc = data[7];
  const newDay = data[8]; // New Day Name

  // Normalize time
  if (newTime) {
      newTime = newTime.toString().replace(/\b([0-1][0-9]|2[0-3])([0-5][0-9])\b/g, "$1:$2");
  }
  
  if (type === 'CANCEL') {
      if (!currentVal.toUpperCase().includes('XXX')) {
          cell.setValue("XXX " + currentVal);
          cell.setBackground('#F4CCCC');
      }
  } 
  else if (type === 'CHANGE') {
      const newVal = constructNewVal(currentVal, newTime, newLoc);
      cell.setValue(newVal);
      cell.setBackground('#FFF2CC');
  }
  else if (type === 'MOVE') {
      // 1. Mark Old Cell
      if (!currentVal.includes('moved') && !currentVal.includes('הוזז')) {
           cell.setValue("XXX (הוזז) " + currentVal);
           cell.setBackground('#F4CCCC');
      }
      
      // 2. Find New Cell Column
      const newDayCol = findColumnForDayInSheet(mainSheet, newDay);
      if (newDayCol === -1) {
          return HtmlService.createHtmlOutput("<h3 style='color:red'>Could not find column for NEW day: " + newDay + "</h3>");
      }
      
      // 3. Update New Cell
      const newCell = mainSheet.getRange(targetRow, newDayCol);
      // Construct move string - ensuring newTime is a string
      const moveVal = newTime.toString() + " " + (newLoc || "");
      newCell.setValue(moveVal);
      newCell.setBackground('#D9EAD3');
  }

  reqSheet.getRange(reqRow, 11).setValue("APPROVED"); // Status is at col 11 (1-based)
  
  // Notify Subscribers
  const team = data[4];
  let msgDesc = "";
  if (type === 'CANCEL') msgDesc = "האימון ב" + oldDayName + " בוטל/נמחק.";
  else if (type === 'CHANGE') msgDesc = `האימון ב${oldDayName} שונה ל: ${newTime} ב-${newLoc}.`;
  else if (type === 'MOVE') msgDesc = `האימון שהיה ב${oldDayName} הוזז ליום ${newDay}, שעה ${newTime}, ${newLoc}.`;
  
  notifySubscribers(team, "שים לב! בוצע שינוי בלוח הזמנים של הקבוצה:<br/>" + msgDesc);
  sendPushForTeam(team, "עדכון לו\"ז — " + team, msgDesc);

  return HtmlService.createHtmlOutput("<h1 style='color:green'>Request Approved & Updated!</h1>");
}

function handleReject(reqRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  reqSheet.getRange(reqRow, 11).setValue("REJECTED");
  return HtmlService.createHtmlOutput("<h1 style='color:red'>Request Rejected.</h1>");
}

// Helper to construct new string preserving context
function constructNewVal(currentVal, newTime, newLoc) {
    let cleanCurrent = currentVal
          .replace(/x|בוטל|canceled|cancelled|⚠️|!|שינוי|CHANGE/gi, '')
          .replace(/\b(?:\d{1,2}:\d{2}|\d{3,4})(?:\s*[-–]\s*(?:\d{1,2}:\d{2}|\d{3,4}))?\b/g, '') 
          .replace(/\s+/g, ' ')
          .trim();
      
    if (newLoc && newLoc.toString().trim() !== "") {
        return newTime + " " + newLoc;
    } else {
        return newTime + (cleanCurrent ? " " + cleanCurrent : "");
    }
}




function findScheduleSheetAndCol(ss, dayName) {
    if (!dayName) return null;
    const sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        const name = sheet.getName();
        // Skip non-schedule tabs and weekly backups, so approval always edits the live
        // schedule (גיליון1) and never a backup_week_* copy if tab order changes.
        if (name === "Requests" || name === "Trainers" || name === "SavedRules" ||
            name === "Subscribers" || name === "PushSubs" || name.indexOf("backup_") === 0) continue;

        const col = findColumnForDayInSheet(sheet, dayName);
        if (col !== -1) {
            return { sheet: sheet, col: col };
        }
    }
    return null;
}

function findColumnForDayInSheet(sheet, dayName) {
    if (!dayName) return -1;
    // Match on the day NAME only (first token), ignoring any trailing date. The client sends
    // headers like "שבת 20/6"; by approval time the sheet's date may differ, so comparing the
    // full string is fragile — compare just "שבת".
    const dayToken = dayName.toString().trim().split(/\s+/)[0];
    if (!dayToken) return -1;
    // Search first 20 rows, all columns
    const lastCol = sheet.getLastColumn();
    // Optimization: limit to 30 columns if lastCol is huge
    const searchCols = lastCol > 30 ? 30 : lastCol; 
    
    if (searchCols < 1) return -1;

    const range = sheet.getRange(1, 1, 20, searchCols);
    // Use display values: some day headers (e.g. שבת) are real Date cells formatted to show
    // "שבת 20/6". getValues() would return the raw Date and never match the day name.
    const values = range.getDisplayValues();
    
    for (let r = 0; r < values.length; r++) {
        // First check if this row looks like a header (contains "ראשון" or "Day")
        // But dayName itself is "ראשון", so just look for dayName.
        const row = values[r];
        for (let c = 0; c < row.length; c++) {
            if (row[c] && row[c].toString().trim().split(/\s+/)[0] === dayToken) {
                return c + 1; // 1-based
            }
        }
    }
    return -1;
}

function handleRegisterSubscriber(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Subscribers");
  if (!sheet) {
    sheet = ss.insertSheet("Subscribers");
    sheet.appendRow(["Timestamp", "Name", "Email", "Team"]);
  }
  
  if (!data.email || !data.team) {
      return createErrorResponse("Missing email or team");
  }
  
  // Check if already registered
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][2].toString().toLowerCase() === data.email.toLowerCase() &&
        values[i][3].toString() === data.team) {
        return createErrorResponse("Email already registered for this team");
    }
  }
  
  sheet.appendRow([new Date(), data.name || "", data.email, data.team]);
  return createSuccessResponse("Registered successfully");
}

// Stores a Web Push subscription for a team (one row per device/endpoint).
function handleRegisterPushSubscription(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("PushSubs");
  if (!sheet) {
    sheet = ss.insertSheet("PushSubs");
    sheet.appendRow(["Timestamp", "Team", "Endpoint", "Subscription"]);
  }

  if (!data.subscription || !data.subscription.endpoint || !data.team) {
    return createErrorResponse("Missing subscription or team");
  }

  const endpoint = data.subscription.endpoint.toString();
  const team = data.team.toString();

  // Skip if this exact endpoint is already registered for this team.
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][2].toString() === endpoint && values[i][1].toString() === team) {
      return createSuccessResponse("Already registered");
    }
  }

  sheet.appendRow([new Date(), team, endpoint, JSON.stringify(data.subscription)]);
  return createSuccessResponse("Push subscription registered");
}

// Remove an email from the Subscribers list (one team, or all teams if team omitted).
function handleUnregisterSubscriber(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Subscribers");
  if (!sheet || !data.email) return createSuccessResponse("Nothing to remove");

  const email = data.email.toString().toLowerCase().trim();
  const team = data.team ? data.team.toString().trim() : null;
  const values = sheet.getDataRange().getValues();
  let removed = 0;
  // Delete bottom-up so row indexes stay valid.
  for (let i = values.length - 1; i >= 1; i--) {
    const rowEmail = (values[i][2] || "").toString().toLowerCase().trim();
    const rowTeam = (values[i][3] || "").toString().trim();
    if (rowEmail === email && (!team || rowTeam === team)) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  return createSuccessResponse("Removed " + removed);
}

// Remove a push subscription by its endpoint (this device).
function handleUnregisterPushSubscription(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PushSubs");
  const endpoint = data.subscription && data.subscription.endpoint
    ? data.subscription.endpoint.toString()
    : (data.endpoint || "").toString();
  if (!sheet || !endpoint) return createSuccessResponse("Nothing to remove");

  const values = sheet.getDataRange().getValues();
  let removed = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    if ((values[i][2] || "").toString() === endpoint) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  return createSuccessResponse("Removed " + removed);
}

// Reads stored push subscriptions for a team and asks the Node backend to deliver the push.
// Prunes any endpoints the backend reports as expired (404/410).
function sendPushForTeam(team, title, body, url, icon) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PushSubs");
  if (!sheet) return;

  const values = sheet.getDataRange().getValues();
  const normalizedTeam = (team || "").toString().trim();
  const subscriptions = [];
  const rowByEndpoint = {};

  for (let i = 1; i < values.length; i++) {
    const sheetTeam = (values[i][1] || "").toString().trim();
    if ((sheetTeam === normalizedTeam || sheetTeam.startsWith(normalizedTeam)) && values[i][3]) {
      try {
        const sub = JSON.parse(values[i][3]);
        subscriptions.push(sub);
        rowByEndpoint[sub.endpoint] = i + 1; // 1-based sheet row
      } catch (e) { /* skip malformed row */ }
    }
  }

  if (subscriptions.length === 0) return;

  try {
    const resp = UrlFetchApp.fetch(NODE_PUSH_URL, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        secret: getPushSecret(),
        title: title || "עירוני רעננה כדורסל",
        body: body || "",
        url: url || "/",
        icon: icon || "/pwa-192x192.png",
        subscriptions: subscriptions
      })
    });

    const result = JSON.parse(resp.getContentText() || "{}");
    // Remove dead subscriptions (delete bottom-up so row indexes stay valid).
    if (result.expired && result.expired.length) {
      const rows = result.expired.map(ep => rowByEndpoint[ep]).filter(Boolean).sort((a, b) => b - a);
      rows.forEach(r => sheet.deleteRow(r));
    }
  } catch (e) {
    Logger.log("Push send failed: " + e);
  }
}

function notifySubscribers(team, message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Subscribers");
  if (!sheet) return;
  
  const values = sheet.getDataRange().getValues();
  const bccEmails = [];
  
  const normalizedTeam = (team || "").toString().trim();
  
  for (let i = 1; i < values.length; i++) {
    const sheetTeam = (values[i][3] || "").toString().trim();
    // Allow matching either exact label "Team - Coach" or just "Team" (for older requests)
    if ((sheetTeam === normalizedTeam || sheetTeam.startsWith(normalizedTeam)) && values[i][2]) {
        bccEmails.push(values[i][2].toString().trim());
    }
  }
  
  if (bccEmails.length > 0) {
      const htmlBodyContent = `
            <!DOCTYPE html>
            <html dir="rtl" lang="he">
            <head>
              <meta charset="utf-8">
              <style>
                body {
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                  background-color: #f3f4f6;
                  margin: 0;
                  padding: 20px;
                  color: #333;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  border-radius: 12px;
                  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                  overflow: hidden;
                }
                .header {
                  background-color: #2563eb;
                  color: #ffffff;
                  padding: 20px;
                  text-align: center;
                  font-size: 24px;
                  font-weight: bold;
                }
                .content {
                  padding: 30px;
                  line-height: 1.6;
                  font-size: 16px;
                }
                .team-name {
                  color: #2563eb;
                  font-size: 20px;
                  font-weight: bold;
                  margin-bottom: 15px;
                  padding-bottom: 15px;
                  border-bottom: 2px solid #f3f4f6;
                }
                .message-box {
                  background-color: #fef2f2;
                  border-right: 4px solid #ef4444;
                  padding: 15px;
                  margin: 20px 0;
                  border-radius: 4px;
                }
                .footer {
                  background-color: #f9fafb;
                  padding: 20px;
                  text-align: center;
                  font-size: 13px;
                  color: #6b7280;
                  border-top: 1px solid #e5e7eb;
                }
                .link-btn {
                  display: inline-block;
                  background-color: #2563eb;
                  color: white;
                  text-decoration: none;
                  padding: 10px 20px;
                  border-radius: 6px;
                  margin-top: 20px;
                  font-weight: bold;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  🏀 מכבי עירוני רעננה
                </div>
                <div class="content">
                  <div class="team-name">עדכון לגבי קבוצת: ${team}</div>
                  
                  <div class="message-box">
                    <strong>${message}</strong>
                  </div>
                  
                  <p>נא לשים לב לשינויים בלוח הזמנים. לפרטים נוספים וצפייה בלוח המלא, ניתן להיכנס לאתר.</p>
                  
                  <div style="text-align: center; margin-top: 30px; margin-bottom: 10px;">
                    <a href="https://ironyraanana-production.up.railway.app/" class="link-btn">מעבר ללוח הזמנים המלא &larr;</a>
                  </div>
                </div>
                <div class="footer">
                  <p>הודעה זו נשלחה אוטומטית ממערכת עירוני רעננה כדורסל בעקבות רישומך לקבלת עדכונים לקבוצה זו.</p>
                  <p>במידה ואינך מעוניין לקבל עדכונים נוספים, <a href="{{UNSUB_LINK}}" style="color:#2563eb">לחץ כאן להסרה מרשימת התפוצה</a>.</p>
                </div>
              </div>
            </body>
            </html>
          `;

      // Loop through and send email individually to each registered user (personalized unsubscribe link).
      const serviceUrl = ScriptApp.getService().getUrl();
      bccEmails.forEach(userEmail => {
          const unsub = serviceUrl + "?action=unsubscribe&email=" + encodeURIComponent(userEmail) + "&team=" + encodeURIComponent(normalizedTeam);
          MailApp.sendEmail({
              to: userEmail,
              subject: "מערכת רעננה כדורסל: עדכון לו\"ז לקבוצת " + normalizedTeam,
              htmlBody: htmlBodyContent.replace("{{UNSUB_LINK}}", unsub)
          });
      });
  }
}

function createSuccessResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({error: msg})).setMimeType(ContentService.MimeType.JSON);
}
