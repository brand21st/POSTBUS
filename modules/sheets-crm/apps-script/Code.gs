/**
 * PostBus Super Admin CRM receiver.
 *
 * Deploy:
 * 1. Create a Google Sheet for the CRM.
 * 2. Extensions → Apps Script, paste this file, and save.
 * 3. Project Settings → Script properties:
 *    POSTBUS_CRM_SECRET = the same secret saved in PostBus Super Admin
 *    SPREADSHEET_ID = the spreadsheet id from its URL
 * 4. Deploy → New deployment → Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 5. Copy the Web App URL into Super Admin → Integrations → Google Sheets CRM.
 *    Do not put the URL or secret in merchant-facing pages.
 *
 * doPost reads JSON from e.postData.contents. The shared secret is in that
 * body because Web App requests do not reliably expose custom HTTP headers.
 */
var SHEET_NAMES_ = ["All Signups", "Workspaces", "Abandoned Clients", "Active Clients", "Sync Logs"];

var SIGNUP_HEADERS_ = [
  "Customer ID", "Full Name", "Email Address", "Phone Number", "Signup Date & Time",
  "Signup Source", "Workspace ID", "Workspace Name", "Account Status", "Onboarding Status",
  "Last Active Date", "Last Updated"
];
var WORKSPACE_HEADERS_ = [
  "Workspace ID", "Customer ID", "Owner Name", "Email", "Phone Number", "Business Name",
  "Workspace Created Date", "India Post Connected", "Shopify Connected", "WooCommerce Connected",
  "Subscription Plan", "Trial Status", "Workspace Status", "Last Activity"
];
var ABANDONED_HEADERS_ = [
  "Customer ID", "Customer Name", "Phone Number", "Email", "Signup Date", "Workspace Name",
  "Last Completed Onboarding Step", "India Post Connection Status", "Store Integration Status",
  "Last Activity", "Abandonment Reason", "Days Inactive", "Lead Status", "Last Updated"
];
var ACTIVE_HEADERS_ = [
  "Customer ID", "Full Name", "Email Address", "Phone Number", "Workspace ID", "Workspace Name",
  "Subscription Plan", "Trial Status", "India Post Connected", "Shopify Connected",
  "WooCommerce Connected", "Last Activity", "Onboarding Completed At", "Account Status"
];
var LOG_HEADERS_ = ["Event ID", "Event Type", "Customer ID", "Sync Timestamp", "Sync Status", "Retry Count", "Error Details"];

function doGet() {
  return json_({ ok: false, code: "method_not_allowed" });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "");
  } catch (err) {
    return json_({ ok: false, code: "malformed" });
  }
  if (!body || typeof body !== "object") return json_({ ok: false, code: "malformed" });
  var expected = PropertiesService.getScriptProperties().getProperty("POSTBUS_CRM_SECRET") || "";
  if (!expected || !secretsMatch_(String(body.secret || ""), expected)) {
    return json_({ ok: false, code: "unauthorized" });
  }
  if (body.test === true) return json_({ ok: true, test: true });
  if (!Array.isArray(body.events)) return json_({ ok: false, code: "malformed" });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, code: "busy" });
  try {
    var spreadsheet = openSpreadsheet_();
    ensureSheets_(spreadsheet);
    var processed = [];
    var duplicates = [];
    var errors = [];
    var events = body.events.slice(0, 50);
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var eventId = event && event.eventId ? String(event.eventId) : "";
      if (!eventId || !event.customerId) {
        errors.push({ eventId: eventId, code: "malformed", message: "Event is missing an id or customer id." });
        continue;
      }
      if (seenEvent_(eventId)) {
        duplicates.push(eventId);
        appendLog_(spreadsheet, event, "DUPLICATE", "");
        continue;
      }
      try {
        applyEvent_(spreadsheet, event);
        rememberEvent_(eventId);
        processed.push(eventId);
        appendLog_(spreadsheet, event, "SUCCEEDED", "");
      } catch (writeError) {
        errors.push({ eventId: eventId, message: "Could not write the row." });
      }
    }
    if (body.events.length > 50) {
      for (var extra = 50; extra < body.events.length; extra++) {
        var overflow = body.events[extra];
        errors.push({
          eventId: overflow && overflow.eventId ? String(overflow.eventId) : "",
          message: "Batch was over the 50 event limit."
        });
      }
    }
    return json_({ ok: errors.length === 0, processed: processed, duplicates: duplicates, errors: errors });
  } finally {
    lock.releaseLock();
  }
}

function openSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("missing spreadsheet");
  return SpreadsheetApp.openById(id);
}

function ensureSheets_(spreadsheet) {
  ensureSheet_(spreadsheet, "All Signups", SIGNUP_HEADERS_);
  ensureSheet_(spreadsheet, "Workspaces", WORKSPACE_HEADERS_);
  ensureSheet_(spreadsheet, "Abandoned Clients", ABANDONED_HEADERS_);
  ensureSheet_(spreadsheet, "Active Clients", ACTIVE_HEADERS_);
  ensureSheet_(spreadsheet, "Sync Logs", LOG_HEADERS_);
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  var width = Math.max(sheet.getLastColumn(), headers.length);
  var current = width ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  var same = current.length >= headers.length;
  for (var i = 0; same && i < headers.length; i++) {
    if (String(current[i]) !== headers[i]) same = false;
  }
  if (!same) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function applyEvent_(spreadsheet, event) {
  if (event.signup) upsertBy_(spreadsheet.getSheetByName("All Signups"), SIGNUP_HEADERS_, "Customer ID", [event.signup], false);
  if (Array.isArray(event.workspaces)) {
    upsertBy_(spreadsheet.getSheetByName("Workspaces"), WORKSPACE_HEADERS_, "Workspace ID", event.workspaces, false);
  }
  if (event.abandoned) {
    var recovered = String(event.abandoned["Lead Status"] || "") === "Recovered";
    upsertBy_(spreadsheet.getSheetByName("Abandoned Clients"), ABANDONED_HEADERS_, "Customer ID", [event.abandoned], recovered);
  }
  if (event.clearActive) deleteBy_(spreadsheet.getSheetByName("Active Clients"), "Customer ID", String(event.customerId));
  if (event.active) upsertBy_(spreadsheet.getSheetByName("Active Clients"), ACTIVE_HEADERS_, "Customer ID", [event.active], false);
}

function upsertBy_(sheet, headers, keyHeader, rows, skipInsertIfMissing) {
  if (!sheet || !rows) return;
  var keyIndex = headers.indexOf(keyHeader);
  var last = sheet.getLastRow();
  var existing = {};
  if (last > 1) {
    var keys = sheet.getRange(2, keyIndex + 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) existing[String(keys[i][0])] = i + 2;
  }
  var append = [];
  for (var r = 0; r < rows.length; r++) {
    var record = rows[r];
    if (!record) continue;
    var key = String(record[keyHeader] || "");
    if (!key) continue;
    var values = headers.map(function (header) { return safeCell_(record[header]); });
    if (existing[key]) sheet.getRange(existing[key], 1, 1, headers.length).setValues([values]);
    else if (!skipInsertIfMissing) append.push(values);
  }
  if (append.length) sheet.getRange(sheet.getLastRow() + 1, 1, append.length, headers.length).setValues(append);
}

function deleteBy_(sheet, keyHeader, key) {
  if (!sheet || !key) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyIndex = headers.indexOf(keyHeader);
  if (keyIndex < 0) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  var keys = sheet.getRange(2, keyIndex + 1, last - 1, 1).getValues();
  for (var i = keys.length - 1; i >= 0; i--) {
    if (String(keys[i][0]) === key) sheet.deleteRow(i + 2);
  }
}

function appendLog_(spreadsheet, event, status, error) {
  var sheet = spreadsheet.getSheetByName("Sync Logs");
  if (!sheet) return;
  sheet.appendRow([
    safeCell_(event.eventId),
    safeCell_(event.eventType),
    safeCell_(event.customerId),
    new Date().toISOString(),
    status,
    "",
    safeCell_(error)
  ]);
}

function safeCell_(value) {
  var text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function secretsMatch_(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function seenEvent_(eventId) {
  var ids = recentIds_();
  return ids.indexOf(eventId) !== -1;
}

function rememberEvent_(eventId) {
  var ids = recentIds_();
  ids.push(eventId);
  if (ids.length > 200) ids = ids.slice(ids.length - 200);
  PropertiesService.getScriptProperties().setProperty("RECENT_EVENT_IDS", JSON.stringify(ids));
}

function recentIds_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("RECENT_EVENT_IDS") || "[]";
    var ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch (err) {
    return [];
  }
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
