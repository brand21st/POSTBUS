export const GOOGLE_SHEETS_HEADERS = [
  "External ID",
  "Customer Name",
  "Phone Number",
  "Full Address",
  "City",
  "State",
  "Pincode",
  "Product Name",
  "Quantity",
  "Order Amount",
  "Payment",
  "Weight",
  "PostBus Order ID",
  "AWB",
  "Tracking URL",
  "Last Error",
] as const;

export const GOOGLE_SHEETS_HEADER_ROW = GOOGLE_SHEETS_HEADERS.join("\t");

/** Copy into Extensions → Apps Script. Secrets stay in Script properties, never in cells. */
export const GOOGLE_APPS_SCRIPT_SOURCE = `var COLUMN_MAP = {
  external_order_id: "External ID",
  customer_name: "Customer Name",
  phone: "Phone Number",
  line1: "Full Address",
  city: "City",
  state: "State",
  pincode: "Pincode",
  product_name: "Product Name",
  quantity: "Quantity",
  unit_price: "Order Amount",
  payment_status: "Payment",
  weight_grams: "Weight",
  postbus_order_id: "PostBus Order ID",
  awb: "AWB",
  tracking_url: "Tracking URL",
  last_error: "Last Error"
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("PostBus")
    .addItem("Write column headers", "setupHeaders")
    .addItem("Import orders", "importOrders")
    .addSeparator()
    .addItem("Book pending rows", "bookPending")
    .addItem("Sync tracking", "syncTracking")
    .addToUi();
}

function setupHeaders() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var headers = [
    COLUMN_MAP.external_order_id,
    COLUMN_MAP.customer_name,
    COLUMN_MAP.phone,
    COLUMN_MAP.line1,
    COLUMN_MAP.city,
    COLUMN_MAP.state,
    COLUMN_MAP.pincode,
    COLUMN_MAP.product_name,
    COLUMN_MAP.quantity,
    COLUMN_MAP.unit_price,
    COLUMN_MAP.payment_status,
    COLUMN_MAP.weight_grams,
    COLUMN_MAP.postbus_order_id,
    COLUMN_MAP.awb,
    COLUMN_MAP.tracking_url,
    COLUMN_MAP.last_error
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function postbusProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    key: p.getProperty("POSTBUS_API_KEY"),
    base: p.getProperty("POSTBUS_API_BASE") || "https://www.postbus.in/api/merchant/v1"
  };
}

function postbusFetch_(path, method, body, idempotencyKey) {
  var props = postbusProps_();
  if (!props.key) throw new Error("Set POSTBUS_API_KEY in Project Settings → Script properties.");
  var headers = {
    Authorization: "Bearer " + props.key,
    "Content-Type": "application/json"
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  var options = { method: method, headers: headers, muteHttpExceptions: true };
  if (body) options.payload = JSON.stringify(body);
  var wait = 1000;
  for (var attempt = 0; attempt < 5; attempt++) {
    var response = UrlFetchApp.fetch(props.base + path, options);
    var code = response.getResponseCode();
    if (code === 429) {
      Utilities.sleep(wait);
      wait *= 2;
      continue;
    }
    var text = response.getContentText();
    var json = text ? JSON.parse(text) : {};
    if (code >= 400) {
      var message = json.error && json.error.message ? json.error.message : text;
      throw new Error(message);
    }
    return json.data;
  }
  throw new Error("Rate limited. Try later.");
}

function headerIndex_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (name, i) { map[String(name)] = i; });
  return map;
}

function cell_(row, indexMap, header) {
  var i = indexMap[header];
  return i == null ? "" : row[i];
}

function importOrders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var sheet = SpreadsheetApp.getActiveSheet();
    var indexMap = headerIndex_(sheet);
    var last = sheet.getLastRow();
    if (last < 2) return;
    var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (row, offset) {
      var sheetRow = offset + 2;
      var existing = cell_(row, indexMap, COLUMN_MAP.postbus_order_id);
      if (existing) return;
      var phone = String(cell_(row, indexMap, COLUMN_MAP.phone) || "").replace(/\\D/g, "").slice(-10);
      var externalId = String(cell_(row, indexMap, COLUMN_MAP.external_order_id) || ("SHEET-" + sheet.getSheetId() + "-" + sheetRow));
      try {
        var created = postbusFetch_("/orders", "post", {
          external_order_id: externalId,
          customer: {
            name: String(cell_(row, indexMap, COLUMN_MAP.customer_name)),
            phone: phone
          },
          shipping_address: {
            line1: String(cell_(row, indexMap, COLUMN_MAP.line1)),
            city: String(cell_(row, indexMap, COLUMN_MAP.city)),
            state: String(cell_(row, indexMap, COLUMN_MAP.state)),
            pincode: String(cell_(row, indexMap, COLUMN_MAP.pincode))
          },
          payment_status: String(cell_(row, indexMap, COLUMN_MAP.payment_status) || "COD"),
          line_items: [{
            title: String(cell_(row, indexMap, COLUMN_MAP.product_name) || "Item"),
            quantity: Number(cell_(row, indexMap, COLUMN_MAP.quantity) || 1),
            unit_price: Number(cell_(row, indexMap, COLUMN_MAP.unit_price) || 0),
            weight_grams: Number(cell_(row, indexMap, COLUMN_MAP.weight_grams) || 0) || undefined
          }]
        }, "create:" + externalId);
        if (indexMap[COLUMN_MAP.postbus_order_id] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.postbus_order_id] + 1).setValue(created.id);
        }
        if (indexMap[COLUMN_MAP.external_order_id] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.external_order_id] + 1).setValue(externalId);
        }
        if (indexMap[COLUMN_MAP.last_error] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.last_error] + 1).setValue("");
        }
      } catch (error) {
        if (indexMap[COLUMN_MAP.last_error] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.last_error] + 1).setValue(String(error));
        }
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function bookPending() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var sheet = SpreadsheetApp.getActiveSheet();
    var indexMap = headerIndex_(sheet);
    var last = sheet.getLastRow();
    if (last < 2) return;
    var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (row, offset) {
      var sheetRow = offset + 2;
      var orderId = cell_(row, indexMap, COLUMN_MAP.postbus_order_id);
      var awb = cell_(row, indexMap, COLUMN_MAP.awb);
      if (!orderId || awb) return;
      try {
        postbusFetch_("/orders/" + orderId + "/book", "post", {}, "book:" + orderId);
        if (indexMap[COLUMN_MAP.last_error] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.last_error] + 1).setValue("");
        }
      } catch (error) {
        if (indexMap[COLUMN_MAP.last_error] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.last_error] + 1).setValue(String(error));
        }
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function syncTracking() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var sheet = SpreadsheetApp.getActiveSheet();
    var indexMap = headerIndex_(sheet);
    var last = sheet.getLastRow();
    if (last < 2) return;
    var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (row, offset) {
      var orderId = cell_(row, indexMap, COLUMN_MAP.postbus_order_id);
      if (!orderId) return;
      var sheetRow = offset + 2;
      try {
        var order = postbusFetch_("/orders/" + orderId, "get");
        var shipment = order.shipments && order.shipments[0];
        if (!shipment || !shipment.id) return;
        var tracking = postbusFetch_("/shipments/" + shipment.id + "/tracking", "get");
        if (indexMap[COLUMN_MAP.awb] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.awb] + 1).setValue(tracking.awb || shipment.barcode || "");
        }
        if (indexMap[COLUMN_MAP.tracking_url] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.tracking_url] + 1).setValue(tracking.tracking_url || "");
        }
        if (indexMap[COLUMN_MAP.last_error] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.last_error] + 1).setValue("");
        }
      } catch (error) {
        if (indexMap[COLUMN_MAP.last_error] != null) {
          sheet.getRange(sheetRow, indexMap[COLUMN_MAP.last_error] + 1).setValue(String(error));
        }
      }
    });
  } finally {
    lock.releaseLock();
  }
}
`;
