const ORDERS_SHEET = "Orders";
const SETTINGS_SHEET = "Settings";
const ORDER_HEADERS = ["Order ID", "Customer Name", "Phone", "Order Type", "Amount", "Paid Amount", "Remaining", "Payment Method", "Order Status", "Payment Status", "Order Date", "Due Date", "Notes"];
const SETTINGS_DEFAULTS = {
  PIN: "958919",
  "UPI ID": "Q183526070@ybl",
  "WhatsApp Number": "919993660152",
  "Shop Address": "A-24 Veena Nagar, Indore"
};

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(payload.action || "").trim();

    if (action === "read") return jsonResponse(readRange_(payload));
    if (action === "saveOrder") return jsonResponse(saveOrder_(payload));
    if (action === "updatePayment") return jsonResponse(updatePayment_(payload));
    if (action === "updateOrderStatus") return jsonResponse(updateOrderStatus_(payload));
    if (action === "deleteOrder") return jsonResponse(deleteOrder_(String(payload.orderId || "").trim()));
    if (action === "saveSettings") return jsonResponse(saveSettings_(payload));
    if (action === "resetData") return jsonResponse(resetData_());

    return jsonResponse({ ok: false, error: "Unsupported action." });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function readRange_(payload) {
  const range = String(payload.range || "").trim();
  const sheetName = range.includes("!") ? range.split("!")[0] : range;
  const sheet = getSheet_(sheetName);

  let values = [];
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const numCols = sheetName === ORDERS_SHEET ? 13 : sheetName === SETTINGS_SHEET ? 2 : sheet.getLastColumn() || 13;
    values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  }

  // Convert Date objects to ISO strings
  values = values.map(row => row.map(cell => {
    if (cell instanceof Date) {
      return Utilities.formatDate(cell, Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd");
    }
    return cell;
  }));

  return { ok: true, values: values };
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`${name} sheet not found.`);
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const mismatch = headers.some((header, index) => String(firstRow[index] || "").trim() !== header);
  if (mismatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function ensureSettingsDefaults_() {
  const sheet = getSheet_(SETTINGS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Setting Key", "Setting Value"]);
    Object.keys(SETTINGS_DEFAULTS).forEach((key) => sheet.appendRow([key, SETTINGS_DEFAULTS[key]]));
    return sheet;
  }

  const data = sheet.getDataRange().getValues();
  const existing = new Map();
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0] || "").trim();
    if (key) existing.set(key, i + 1);
  }

  Object.entries(SETTINGS_DEFAULTS).forEach(([key, value]) => {
    if (existing.has(key)) {
      sheet.getRange(existing.get(key), 2).setValue(sheet.getRange(existing.get(key), 2).getValue() || value);
    } else {
      sheet.appendRow([key, value]);
    }
  });

  return sheet;
}

function computeOrder_(order) {
  const amount = Number(order.amount || 0);
  const paidAmount = Math.max(0, Number(order.paidAmount || 0));
  const remaining = Math.max(0, amount - paidAmount);
  const paymentStatus = remaining <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";
  return {
    orderId: String(order.orderId || "").trim(),
    customerName: String(order.customerName || "").trim(),
    phone: String(order.phone || "").replace(/\D/g, "").slice(-10),
    orderType: String(order.orderType || "").trim(),
    amount,
    paidAmount,
    remaining,
    paymentMethod: String(order.paymentMethod || "").trim(),
    orderStatus: String(order.orderStatus || "Order Placed").trim(),
    paymentStatus: String(order.paymentStatus || paymentStatus).trim() || paymentStatus,
    orderDate: String(order.orderDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd")).trim(),
    dueDate: String(order.dueDate || "").trim(),
    notes: String(order.notes || "").trim()
  };
}

function nextOrderId_(sheet) {
  const values = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < values.length; i++) {
    const match = String(values[i][0] || "").trim().match(/^ORD(\d+)$/i);
    if (match) maxNum = Math.max(maxNum, Number(match[1]));
  }
  return `ORD${String(maxNum + 1).padStart(3, "0")}`;
}

function findOrderRow_(sheet, orderId) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim().toUpperCase() === String(orderId || "").trim().toUpperCase()) {
      return i + 1;
    }
  }
  return 0;
}

function saveOrder_(payload) {
  const sheet = getSheet_(ORDERS_SHEET);
  ensureHeaders_(sheet, ORDER_HEADERS);

  const orderData = payload.order || payload;
  const order = computeOrder_({
    orderId: orderData.orderId,
    customerName: orderData.customerName,
    phone: orderData.customerPhone || orderData.phone,
    orderType: orderData.orderType,
    amount: orderData.amount,
    paidAmount: orderData.paidAmount || orderData.amountPaid || 0,
    paymentMethod: orderData.paymentMethod,
    orderStatus: orderData.orderStatus || "Order Placed",
    paymentStatus: orderData.paymentStatus,
    orderDate: orderData.orderDate,
    dueDate: orderData.dueDate,
    notes: orderData.notes
  });

  // Detailed validation with specific error messages
  if (!order.customerName) throw new Error("Customer name is required.");
  if (!order.phone) throw new Error("Phone number is required.");
  if (order.phone.length !== 10) throw new Error("Phone must be 10 digits (got " + order.phone + ").");
  if (!order.orderType) throw new Error("Order type is required.");
  if (!order.amount || order.amount <= 0) throw new Error("Amount must be greater than 0.");
  if (!order.dueDate) throw new Error("Due date is required.");

  order.orderId = order.orderId || nextOrderId_(sheet);
  const row = [
    order.orderId,
    order.customerName,
    order.phone,
    order.orderType,
    order.amount,
    order.paidAmount,
    order.remaining,
    order.paymentMethod || (order.paymentStatus === "Paid" ? "UPI" : order.paymentStatus === "Partially Paid" ? "Partial" : ""),
    order.orderStatus,
    order.paymentStatus,
    order.orderDate,
    order.dueDate,
    order.notes
  ];

  // Always append new row, never update existing
  sheet.appendRow(row);

  return { ok: true, orderId: order.orderId, order };
}

function updatePayment_(payload) {
  const orderId = String(payload.orderId || "").trim();
  if (!orderId) throw new Error("orderId is required.");

  const sheet = getSheet_(ORDERS_SHEET);
  ensureHeaders_(sheet, ORDER_HEADERS);
  
  // Find ALL rows with this Order ID
  const values = sheet.getDataRange().getValues();
  const rowsToUpdate = [];
  const allOrderRows = [];
  
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim().toUpperCase() === String(orderId || "").trim().toUpperCase()) {
      rowsToUpdate.push(i + 1);
      allOrderRows.push(values[i]);
    }
  }
  
  if (!rowsToUpdate.length) throw new Error("Order ID not found.");

  // Calculate TOTAL for this entire order (sum of all items)
  const totalOrderAmount = allOrderRows.reduce((sum, row) => sum + Number(row[4] || 0), 0);
  const totalAlreadyPaid = allOrderRows.reduce((sum, row) => sum + Number(row[5] || 0), 0);
  
  const paymentStatus = String(payload.paymentStatus || "").trim();
  let totalNewPayment = Number(payload.paidAmount);
  
  // Determine the total to be paid for entire order
  let finalTotalPaid = totalNewPayment;
  if (!Number.isFinite(totalNewPayment)) finalTotalPaid = totalAlreadyPaid;
  if (paymentStatus === "Paid") finalTotalPaid = totalOrderAmount;
  if (paymentStatus === "Unpaid") finalTotalPaid = 0;
  
  const totalRemaining = Math.max(0, totalOrderAmount - finalTotalPaid);
  
  // Distribute payment proportionally across all items
  rowsToUpdate.forEach((rowNumber, index) => {
    const row = allOrderRows[index];
    const current = computeOrder_({
      orderId: row[0],
      customerName: row[1],
      phone: row[2],
      orderType: row[3],
      amount: row[4],
      paidAmount: row[5],
      remaining: row[6],
      paymentMethod: row[7],
      orderStatus: row[8],
      paymentStatus: row[9],
      orderDate: row[10],
      dueDate: row[11],
      notes: row[12]
    });

    // Calculate this item's proportion of total
    const itemProportion = current.amount / totalOrderAmount;
    
    // Distribute payment proportionally to this item
    let itemPaid = finalTotalPaid * itemProportion;
    
    // Round to 2 decimals and handle edge cases
    itemPaid = Math.round(itemPaid * 100) / 100;
    
    // Ensure item payment doesn't exceed item amount
    itemPaid = Math.min(itemPaid, current.amount);
    
    const itemRemaining = Math.max(0, current.amount - itemPaid);
    
    // Determine if this item is fully paid, partially paid, or unpaid
    let itemPaymentStatus = "Unpaid";
    if (itemRemaining <= 0 && itemPaid > 0) {
      itemPaymentStatus = "Paid";
    } else if (itemPaid > 0 && itemRemaining > 0) {
      itemPaymentStatus = "Partially Paid";
    }

    const nextRow = [
      current.orderId,
      current.customerName,
      current.phone,
      current.orderType,
      current.amount,
      itemPaid,
      itemRemaining,
      String(payload.paymentMethod || current.paymentMethod || (itemPaymentStatus === "Paid" ? "UPI" : itemPaymentStatus === "Unpaid" ? "" : "Partial")).trim(),
      String(payload.orderStatus || current.orderStatus).trim(),
      itemPaymentStatus,
      current.orderDate,
      current.dueDate,
      String(payload.notes || current.notes).trim()
    ];

    sheet.getRange(rowNumber, 1, 1, nextRow.length).setValues([nextRow]);
  });
  
  return { ok: true, orderId, totalOrderAmount, finalTotalPaid, totalRemaining, paymentStatus, updatedRows: rowsToUpdate.length };
}

function updateOrderStatus_(payload) {
  const orderId = String(payload.orderId || "").trim();
  if (!orderId) throw new Error("orderId is required.");

  const sheet = getSheet_(ORDERS_SHEET);
  ensureHeaders_(sheet, ORDER_HEADERS);
  
  // Find ALL rows with this Order ID (not just first one)
  const values = sheet.getDataRange().getValues();
  const rowsToUpdate = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim().toUpperCase() === String(orderId || "").trim().toUpperCase()) {
      rowsToUpdate.push(i + 1); // Google Sheets rows are 1-indexed
    }
  }
  
  if (!rowsToUpdate.length) throw new Error("Order ID not found.");

  const orderStatus = String(payload.orderStatus || "").trim();
  
  if (!["Ordered", "In Progress", "Completed", "Delivered"].includes(orderStatus)) {
    throw new Error("Invalid order status. Must be one of: Ordered, In Progress, Completed, Delivered");
  }

  // Update ALL rows with this Order ID
  rowsToUpdate.forEach((rowNumber) => {
    sheet.getRange(rowNumber, 9).setValue(orderStatus);
  });
  
  return { ok: true, orderId, orderStatus, updatedRows: rowsToUpdate.length };
}

function deleteOrder_(orderId) {
  if (!orderId) throw new Error("orderId is required.");
  const sheet = getSheet_(ORDERS_SHEET);
  ensureHeaders_(sheet, ORDER_HEADERS);
  
  // Find ALL rows with this Order ID (not just the first one)
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim().toUpperCase() === String(orderId || "").trim().toUpperCase()) {
      rowsToDelete.push(i + 1); // Sheet rows are 1-indexed, data array is 0-indexed
    }
  }
  
  if (rowsToDelete.length === 0) {
    throw new Error("Order ID not found.");
  }
  
  // Delete from bottom to top to avoid row number shifting
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  return { ok: true, deleted: true, orderId, deletedRows: rowsToDelete.length };
}

function saveSettings_(payload) {
  const sheet = getSheet_(SETTINGS_SHEET);
  ensureSettingsDefaults_();
  const updates = {
    PIN: String(payload.PIN || SETTINGS_DEFAULTS.PIN).trim(),
    "UPI ID": String(payload["UPI ID"] || SETTINGS_DEFAULTS["UPI ID"]).trim(),
    "WhatsApp Number": String(payload["WhatsApp Number"] || SETTINGS_DEFAULTS["WhatsApp Number"]).trim(),
    "Shop Address": String(payload["Shop Address"] || SETTINGS_DEFAULTS["Shop Address"]).trim()
  };

  const values = sheet.getDataRange().getValues();
  const index = new Map();
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || "").trim();
    if (key) index.set(key, i + 1);
  }

  Object.entries(updates).forEach(([key, value]) => {
    if (index.has(key)) {
      sheet.getRange(index.get(key), 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  });

  return { ok: true, settings: updates };
}

function resetData_() {
  const ordersSheet = getSheet_(ORDERS_SHEET);
  ensureHeaders_(ordersSheet, ORDER_HEADERS);
  const lastRow = ordersSheet.getLastRow();
  if (lastRow > 1) {
    ordersSheet.getRange(2, 1, lastRow - 1, ORDER_HEADERS.length).clearContent();
  }

  const settingsSheet = getSheet_(SETTINGS_SHEET);
  settingsSheet.clearContents();
  settingsSheet.appendRow(["Setting Key", "Setting Value"]);
  Object.entries(SETTINGS_DEFAULTS).forEach(([key, value]) => settingsSheet.appendRow([key, value]));

  return { ok: true, reset: true };
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
