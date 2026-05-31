(function () {
  const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  });

  const dateFormatter = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });

  function normalizeRow(row) {
    // Columns from Google Apps Script: 
    // 0: Order ID, 1: Customer Name, 2: Phone, 3: Order Type, 4: Amount
    // 5: Paid Amount, 6: Remaining, 7: Payment Method, 8: Order Status, 9: Payment Status
    // 10: Order Date, 11: Due Date, 12: Notes
    const amount = Number(row[4] || 0);
    const amountPaid = Number(row[5] || 0);
    const balanceDue = Number(row[6] || Math.max(0, amount - amountPaid));
    
    // Always compute payment status from amounts (matches Apps Script logic)
    const paymentStatus = balanceDue <= 0 ? "Paid" : amountPaid > 0 ? "Partially Paid" : "Unpaid";

    return {
      orderId: String(row[0] || "").trim(),
      customerName: String(row[1] || "").trim(),
      customerPhone: String(row[2] || "").trim(),
      orderType: String(row[3] || "").trim(),
      amount,
      amountPaid,
      balanceDue,
      paymentMethod: String(row[7] || "").trim(),
      orderStatus: String(row[8] || "Ordered").trim(),
      paymentStatus: paymentStatus,
      orderDate: String(row[10] || "").trim(),
      dueDate: String(row[11] || "").trim(),
      notes: String(row[12] || "").trim()
    };
  }

  function parseDate(value) {
    if (!value) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatAmount(amount) {
    return currencyFormatter.format(Number(amount || 0));
  }

  function formatDate(value) {
    const date = parseDate(value);
    return date ? dateFormatter.format(date) : "-";
  }

  function buildSheetsReadUrl() {
    const cfg = window.SEEMA_CONFIG;

    if (!cfg.SHEET_ID || cfg.SHEET_ID.includes("YOUR_")) {
      throw new Error("Set SHEET_ID in js/config.js");
    }

    if (!cfg.GOOGLE_API_KEY || cfg.GOOGLE_API_KEY.includes("YOUR_")) {
      throw new Error("Set GOOGLE_API_KEY in js/config.js");
    }

    const sheetTab = cfg.SHEET_TAB_NAME || cfg.ORDERS_TAB || "Orders";
    const encodedRange = encodeURIComponent(`${sheetTab}!A2:L`);
    return `https://sheets.googleapis.com/v4/spreadsheets/${cfg.SHEET_ID}/values/${encodedRange}?key=${cfg.GOOGLE_API_KEY}`;
  }

  async function fetchOrders() {
    const cfg = window.SEEMA_CONFIG;

    // 1. Try reading via Apps Script Web App first (no API key required)
    if (cfg.APPS_SCRIPT_URL && !cfg.APPS_SCRIPT_URL.includes("YOUR_")) {
      try {
        const sheetTab = cfg.SHEET_TAB_NAME || cfg.ORDERS_TAB || "Orders";
        const data = await postToAppsScript({ action: "read", range: `${sheetTab}!A2:L` });
        if (data && Array.isArray(data.values)) {
          return data.values.map(normalizeRow).filter((order) => order.orderId);
        }
      } catch (err) {
        console.warn("Apps Script read failed, trying Sheets API:", err);
      }
    }

    // 2. Fallback to direct Sheets API v4
    const response = await fetch(buildSheetsReadUrl(), { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Could not load orders from Google Sheets.");
    }

    const data = await response.json();
    const rows = data.values || [];
    return rows.map(normalizeRow).filter((order) => order.orderId);
  }

  async function fetchOrderById(orderId) {
    const orders = await fetchOrders();
    return orders.find((order) => order.orderId.toUpperCase() === orderId.toUpperCase()) || null;
  }

  function nextOrderId(orders) {
    const maxId = orders.reduce((max, order) => {
      const match = /^ORD(\d+)$/i.exec(order.orderId);
      if (!match) return max;
      return Math.max(max, Number(match[1]));
    }, 0);

    return `ORD${String(maxId + 1).padStart(3, "0")}`;
  }

  async function postToAppsScript(payload) {
    const cfg = window.SEEMA_CONFIG;

    if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.includes("YOUR_")) {
      throw new Error("Set APPS_SCRIPT_URL in js/config.js");
    }

    const response = await fetch(cfg.APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("Apps Script request failed.");
    }

    const data = await response.json();

    if (data.ok !== true) {
      throw new Error(data.error || "Apps Script returned an error.");
    }

    return data;
  }

  function shouldRetryLegacy(error) {
    const message = String((error && error.message) || error || "").toLowerCase();
    return message.includes("unsupported action") || message.includes("required order fields");
  }

  async function addOrder(order) {
    const normalized = {
      orderId: order.orderId,  // Explicitly preserve orderId first
      ...order,
      phone: order.phone || order.customerPhone,
      customerPhone: order.customerPhone || order.phone,
      paidAmount: Number(order.paidAmount || order.amountPaid || 0),
      amountPaid: Number(order.amountPaid || order.paidAmount || 0),
      orderStatus: order.orderStatus || "Ordered"
    };

    try {
      return await postToAppsScript({ action: "saveOrder", order: normalized });
    } catch (error) {
      if (!shouldRetryLegacy(error)) throw error;
    }

    try {
      return await postToAppsScript({ action: "saveOrder", ...normalized });
    } catch (error) {
      if (!shouldRetryLegacy(error)) throw error;
    }

    return postToAppsScript({ action: "addOrder", ...normalized });
  }

  async function markPaid(orderId) {
    return updatePaymentStatus(orderId, "Paid");
  }

  async function updatePaymentStatus(orderId, paymentStatus, amountPaid, notes) {
    return postToAppsScript({
      action: "updatePayment",
      orderId,
      paymentStatus,
      paidAmount: amountPaid,
      notes
    });
  }

  async function updateOrderStatus(orderId, orderStatus) {
    // Most broadly compatible path: many deployments accept orderStatus via updatePayment.
    try {
      return await postToAppsScript({
        action: "updatePayment",
        orderId,
        orderStatus,
        status: orderStatus
      });
    } catch (error) {}

    try {
      return await postToAppsScript({
        action: "updateOrderStatus",
        orderId,
        orderStatus
      });
    } catch (error) {}

    return postToAppsScript({
      action: "updatePaymentStatus",
      orderId,
      orderStatus,
      status: orderStatus
    });
  }

  async function deleteOrder(orderId) {
    if (!orderId) throw new Error("Order ID is required.");
    
    return postToAppsScript({
      action: "deleteOrder",
      orderId
    });
  }

  window.SeemaSheets = {
    fetchOrders,
    fetchOrderById,
    addOrder,
    markPaid,
    updatePaymentStatus,
    updateOrderStatus,
    deleteOrder,
    nextOrderId,
    parseDate,
    formatAmount,
    formatDate
  };
})();
