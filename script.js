(function () {
  const cfg = window.SEEMA_CONFIG || {};
  const defaults = {
    pin: cfg.DEFAULT_PIN || "YOUR_PRIVATE_STAFF_PIN",
    upi: cfg.DEFAULT_UPI || "Q183526070@ybl",
    whatsapp: cfg.DEFAULT_WHATSAPP || "9993660152",
    address: cfg.DEFAULT_ADDRESS || "A-24 Veena Nagar, Indore",
    shopName: cfg.SHOP_NAME || "Seema Silai Centre"
  };
  const workflowSteps = ["Ordered", "In Progress", "Completed", "Delivered"];

  const state = {
    orders: [],
    settings: { ...defaults },
    customerSelection: null,
    adminLoggedIn: false,
    editOrderId: null,
    activeAdminTab: "dashboard",
    filterText: ""
  };

  const CONFIRMED_UPI_ID = "Q183526070@ybl";

  const els = {};

  function byId(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
  }

  function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "").slice(-10);
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

  function formatDate(value) {
    const date = parseDate(value);
    if (!date) return "-";
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function normalizeDateValue(value) {
    const date = parseDate(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function isoToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function monthKey(value) {
    const date = parseDate(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function startOfDay(value) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function sameDay(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function paymentState(order) {
    const amount = Number(order.amount || 0);
    const paidAmount = Number(order.paidAmount || 0);
    const remaining = Number.isFinite(Number(order.remaining)) ? Number(order.remaining) : Math.max(0, amount - paidAmount);
    const paymentStatus = remaining <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";
    return { amount, paidAmount, remaining, paymentStatus, paymentMethod: String(order.paymentMethod || "").trim() || "-" };
  }

  function normalizeStatusLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "Ordered";
    const lower = raw.toLowerCase();
    // New status system
    if (lower === "ordered" || lower === "order placed" || lower === "pending") return "Ordered";
    if (lower === "in progress" || lower === "stitching" || lower === "stitching in progress" || lower === "cutting") return "In Progress";
    if (lower === "completed" || lower === "ready" || lower === "ready for trial") return "Completed";
    if (lower === "delivered") return "Delivered";
    return raw;
  }

  function workflowIndex(status) {
    return Math.max(0, workflowSteps.indexOf(normalizeStatusLabel(status)));
  }

  function orderWorkflowIndex(order) {
    return workflowIndex(order.orderStatus);
  }

  function statusClass(text) {
    const value = normalizeStatusLabel(text);
    switch (value) {
      case "Ordered": return "ordered";
      case "In Progress": return "in-progress";
      case "Completed": return "completed";
      case "Delivered": return "delivered";
      default: return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }
  }

  function normalizeOrder(row) {
    const amount = Number(row[4] || 0);
    const paidAmount = Number(row[5] || 0);
    const remaining = Number(row[6] || Math.max(0, amount - paidAmount));
    const paymentMethod = (row[7] || "").trim();
    const orderStatus = normalizeStatusLabel(row[8] || "Order Placed");
    const paymentStatus = (row[9] || "").trim() || (remaining <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid");
    return {
      orderId: (row[0] || "").trim(),
      customerName: (row[1] || "").trim(),
      phone: (row[2] || "").trim(),
      orderType: (row[3] || "").trim(),
      amount,
      paidAmount,
      remaining,
      paymentMethod,
      orderStatus,
      paymentStatus,
      orderDate: normalizeDateValue(row[10]),
      dueDate: normalizeDateValue(row[11]),
      notes: (row[12] || "").trim()
    };
  }

  function buildReadUrl(range) {
    if (!cfg.SHEET_ID || cfg.SHEET_ID.includes("YOUR_")) {
      throw new Error("Set SHEET_ID in config.js");
    }
    if (!cfg.GOOGLE_API_KEY || cfg.GOOGLE_API_KEY.includes("YOUR_")) {
      throw new Error("Set GOOGLE_API_KEY in config.js");
    }
    return `https://sheets.googleapis.com/v4/spreadsheets/${cfg.SHEET_ID}/values/${encodeURIComponent(range)}?key=${cfg.GOOGLE_API_KEY}`;
  }

  async function readRange(range) {
    const response = await fetch(buildReadUrl(range), { cache: "no-store" });
    if (!response.ok) throw new Error("Could not read Google Sheets data.");
    const data = await response.json();
    return data.values || [];
  }

  async function fetchOrders(force = false) {
    if (!force && state.orders.length) return state.orders;
    const rows = await readRange(`${cfg.ORDERS_TAB || "Orders"}!A2:L`);
    state.orders = rows.map(normalizeOrder).filter((order) => order.orderId);
    return state.orders;
  }

  async function fetchSettings(force = false) {
    if (!force && state.settings && Object.keys(state.settings).length > 0) return state.settings;
    try {
      const rows = await readRange(`${cfg.SETTINGS_TAB || "Settings"}!A2:B`);
      const settings = { ...defaults };
      rows.forEach((row) => {
        const key = String(row[0] || "").trim();
        const value = String(row[1] || "").trim();
        if (key) settings[key] = value;
      });
      state.settings = settings;
    } catch (error) {
      state.settings = { ...defaults };
    }
    return state.settings;
  }

  async function postAction(action, payload = {}) {
    if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.includes("YOUR_")) {
      throw new Error("Set APPS_SCRIPT_URL in config.js");
    }
    const response = await fetch(cfg.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload })
    });
    if (!response.ok) throw new Error("Write request failed.");
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "An unexpected error occurred.");
    return data;
  }

  function nextOrderId(orders) {
    const max = orders.reduce((acc, order) => {
      const match = /^ORD(\d+)$/i.exec(order.orderId);
      return match ? Math.max(acc, Number(match[1])) : acc;
    }, 0);
    return `ORD${String(max + 1).padStart(3, "0")}`;
  }

  function toPayloadOrder(formData) {
    const amount = Number(formData.amount || 0);
    const paidAmount = Math.max(0, Number(formData.paidAmount || 0));
    const remaining = Math.max(0, amount - paidAmount);
    const paymentStatus = remaining <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";
    return {
      orderId: String(formData.orderId || "").trim(),
      customerName: String(formData.customerName || "").trim(),
      phone: normalizePhone(formData.phone),
      orderType: String(formData.orderType || "").trim(),
      amount,
      paidAmount,
      remaining,
      paymentMethod: String(formData.paymentMethod || "").trim(),
      orderStatus: normalizeStatusLabel(formData.orderStatus || "Order Placed"),
      paymentStatus,
      orderDate: String(formData.orderDate || isoToday()).trim(),
      dueDate: String(formData.dueDate || "").trim(),
      notes: String(formData.notes || "").trim()
    };
  }

  function buildWhatsAppUrl(phone, message) {
    const number = normalizePhone(phone);
    if (!number) return "";
    return `https://wa.me/${number}?text=${encodeURIComponent(String(message || ""))}`;
  }

  function copyTextToClipboard(text, successMessage, target = "pendingMsg") {
    return navigator.clipboard.writeText(text).then(() => {
      setMessage(byId(target), successMessage, "success");
      return true;
    }).catch(() => {
      window.prompt("Copy this message", text);
      setMessage(byId(target), "Copy the displayed message manually.", "muted");
      return false;
    });
  }

  function trackLink(orderId) {
    return `${cfg.SITE_BASE_URL || "https://seemasilaicentre.live"}/track?id=${encodeURIComponent(String(orderId || ""))}`;
  }

  function buildOrderConfirmationMessage(order) {
    return [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "👗 SEEMA SILAI CENTRE - ORDER CONFIRMATION",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Order ID: ${order.orderId}`,
      `Customer: ${order.customerName || "-"}`,
      `Item: ${order.orderType || "-"}`,
      `Amount: ₹${Number(order.amount || 0)}`,
      `Expected by: ${formatDate(order.dueDate)}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🔗 TRACK: ${trackLink(order.orderId)}`,
      `💳 UPI: ${state.settings["UPI ID"] || defaults.upi}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "This is an auto-generated message."
    ].join("\n");
  }

  function buildPaymentReminderMessage(order) {
    return [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🔔 SYSTEM REMINDER",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Order ID: ${order.orderId}`,
      `Item: ${order.orderType || "-"}`,
      `Due Amount: ₹${Number(order.remaining || 0)}`,
      "Status: Ready for Pickup",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🔗 PAY & TRACK: ${trackLink(order.orderId)}`,
      `💳 UPI: ${state.settings["UPI ID"] || defaults.upi}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "This is an automated payment reminder."
    ].join("\n");
  }

  function buildReadyMessage(order) {
    return [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "✅ SYSTEM UPDATE - ORDER READY",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Order ID: ${order.orderId}`,
      `Item: ${order.orderType || "-"}`,
      "Status: READY FOR PICKUP",
      `📍 ${state.settings["Shop Address"] || defaults.address}`,
      "⏰ 10 AM - 7 PM",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🔗 TRACK: ${trackLink(order.orderId)}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  function buildPartialPaymentReminderMessage(order) {
    return [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🔔 SYSTEM REMINDER - PARTIAL PAYMENT",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Order ID: ${order.orderId}`,
      `Item: ${order.orderType || "-"}`,
      `Total: ₹${Number(order.amount || 0)}`,
      `Paid: ₹${Number(order.paidAmount || 0)}`,
      `Remaining: ₹${Number(order.remaining || 0)}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🔗 PAY REMAINING: ${trackLink(order.orderId)}`,
      `💳 UPI: ${state.settings["UPI ID"] || defaults.upi}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  function buildDailySummaryMessage(orders) {
    const pending = orders.filter((order) => Number(order.remaining || 0) > 0);
    const total = pending.reduce((sum, order) => sum + Number(order.remaining || 0), 0);
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "📊 SEEMA SILAI CENTRE - DAILY SUMMARY",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Pending Payments:"
    ];

    pending.forEach((order) => {
      lines.push(`• ${order.customerName || "-"} - ${order.orderType || "-"} - ₹${Number(order.remaining || 0)}`);
      lines.push(`  🔗 ${trackLink(order.orderId)}`);
    });

    lines.push(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Total Pending: ₹${total}`,
      `💳 UPI: ${state.settings["UPI ID"] || defaults.upi}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    return lines.join("\n");
  }

  function buildBulkReminderMessage(orders) {
    return buildDailySummaryMessage(orders);
  }

  function buildStatusNotificationMessage(order) {
    if (normalizeStatusLabel(order.orderStatus) === "Completed") {
      return buildReadyMessage(order);
    }
    return buildOrderConfirmationMessage(order);
  }

  function priorityMeta(order) {
    const due = startOfDay(order.dueDate);
    if (!due) {
      return { label: "No due date", className: "green", sort: 3, daysLeft: null };
    }
    const today = startOfDay(new Date());
    const diff = Math.ceil((due - today) / 86400000);
    if (diff < 0) return { label: `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}`, className: "red", sort: 0, daysLeft: diff };
    if (diff <= 1) return { label: diff === 0 ? "Due today" : "Due tomorrow", className: "orange", sort: 1, daysLeft: diff };
    if (diff <= 3) return { label: `Due in ${diff} days`, className: "yellow", sort: 2, daysLeft: diff };
    return { label: `Due in ${diff} days`, className: "green", sort: 3, daysLeft: diff };
  }

  function sortPendingOrders(orders) {
    return [...orders].sort((a, b) => {
      const pa = priorityMeta(a);
      const pb = priorityMeta(b);
      if (pa.sort !== pb.sort) return pa.sort - pb.sort;
      const da = startOfDay(a.dueDate);
      const db = startOfDay(b.dueDate);
      if (da && db && da.getTime() !== db.getTime()) return da - db;
      return String(a.orderId || "").localeCompare(String(b.orderId || ""));
    });
  }

  function maybeOpenWhatsApp(phone, message) {
    const url = buildWhatsAppUrl(phone, message);
    if (!url) return false;
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    return !!popup;
  }

  function renderWorkflowProgress(order) {
    const host = byId("receiptProgress");
    if (!host) return;
    host.classList.remove("hidden");
    const currentIndex = orderWorkflowIndex(order);
    const progressPercent = workflowSteps.length <= 1 ? 100 : Math.round((currentIndex / (workflowSteps.length - 1)) * 100);
    host.innerHTML = `
      <div class="workflow-head">
        <div>
          <strong>Order Progress</strong>
          <p class="muted">${normalizeStatusLabel(order.orderStatus)}</p>
        </div>
        <span class="status-pill ${statusClass(order.orderStatus)}">${normalizeStatusLabel(order.orderStatus)}</span>
      </div>
      <div class="workflow-track" aria-hidden="true"><span style="width:${progressPercent}%"></span></div>
      <div class="workflow-steps">
        ${workflowSteps.map((step, index) => `<span class="workflow-step ${index <= currentIndex ? "active" : ""}">${step}</span>`).join("")}
      </div>
    `;
  }

  function qrUrl(upiId, amount, orderId, customerName) {
    // Ensure we use the correct UPI ID from settings or config
    const finalUpiId = upiId || state.settings["UPI ID"] || defaults.upi || CONFIRMED_UPI_ID;
    const params = new URLSearchParams({
      pa: finalUpiId,
      pn: defaults.shopName,
      am: String(Math.max(0, Number(amount || 0))),
      cu: "INR",
      tn: `Order ${orderId} ${customerName || ""}`.trim()
    });
    return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(`upi://pay?${params.toString()}`)}`;
  }

  function upiIntent(upiId, amount, orderId, customerName) {
    const finalUpiId = upiId || state.settings["UPI ID"] || defaults.upi || CONFIRMED_UPI_ID;
    const params = new URLSearchParams({
      pa: finalUpiId,
      pn: defaults.shopName,
      am: String(Math.max(0, Number(amount || 0))),
      cu: "INR",
      tn: `Order ${orderId} ${customerName || ""}`.trim()
    });
    return `upi://pay?${params.toString()}`;
  }

  function ordersCsv(orders) {
    const header = ["Order ID", "Customer Name", "Phone", "Order Type", "Amount", "Paid Amount", "Remaining", "Order Status", "Payment Status", "Order Date", "Due Date", "Notes"];
    const lines = [header.join(",")];
    orders.forEach((order) => {
      lines.push([
        order.orderId,
        order.customerName,
        order.phone,
        order.orderType,
        order.amount,
        order.paidAmount,
        order.remaining,
        order.orderStatus,
        order.paymentStatus,
        order.orderDate,
        order.dueDate,
        order.notes
      ].map(csvEscape).join(","));
    });
    return lines.join("\n");
  }

  function settingsCsv(settings) {
    const lines = ["Setting Key,Setting Value"];
    Object.entries(settings).forEach(([key, value]) => {
      lines.push([csvEscape(key), csvEscape(value)].join(","));
    });
    return lines.join("\n");
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function setMessage(el, text, tone = "muted") {
    if (!el) return;
    el.textContent = text;
    el.className = `msg ${tone === "error" ? "danger" : tone === "success" ? "success" : "muted"}`;
  }

  function toggleHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
  }

  function button(label, className, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  function statusBadge(text) {
    const value = normalizeStatusLabel(text).toLowerCase();
    const badge = document.createElement("span");
    badge.className = `status-pill ${value.includes("paid") ? "paid" : value.includes("partial") ? "partial" : value.includes("deliver") ? "delivered" : value.includes("ready for trial") ? "trial" : value.includes("stitch") ? "stitching" : value.includes("cutting") ? "cutting" : value.includes("completed") ? "completed" : value.includes("order placed") ? "placed" : value.includes("unpaid") ? "unpaid" : "pending"}`;
    badge.textContent = normalizeStatusLabel(text) || "-";
    return badge;
  }

  function computeRevenueThisMonth(orders) {
    const currentMonth = monthKey(new Date());
    return orders
      .filter((order) => monthKey(order.orderDate) === currentMonth)
      .reduce((sum, order) => sum + Number(order.paidAmount || 0), 0);
  }

  function computePendingOrders(orders) {
    return orders.filter((order) => Number(order.remaining || 0) > 0);
  }

  function computeTodayOrders(orders) {
    const today = new Date();
    return orders.filter((order) => {
      const date = parseDate(order.orderDate);
      return date ? sameDay(date, today) : false;
    });
  }

  function filterOrdersByText(orders, text) {
    const needle = String(text || "").trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => {
      return [order.orderId, order.customerName, order.phone, order.orderType, order.paymentStatus, order.orderStatus]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }

  function renderCustomerSummary(order) {
    // Summary removed - displayed in receipt only
  }

  function renderCustomerSearchResults(orders) {
    const resultsCard = byId("customerResultsCard");
    const results = byId("customerResults");
    const count = byId("customerResultCount");
    if (!resultsCard || !results || !count) return;

    results.innerHTML = "";
    
    // Group orders by Order ID
    const groupedByOrderId = new Map();
    orders.forEach((order) => {
      const orderId = String(order.orderId || "").trim().toUpperCase();
      if (!groupedByOrderId.has(orderId)) {
        groupedByOrderId.set(orderId, []);
      }
      groupedByOrderId.get(orderId).push(order);
    });
    
    const uniqueOrders = groupedByOrderId.size;
    count.textContent = `${uniqueOrders} order${uniqueOrders === 1 ? "" : "s"} found.`;
    toggleHidden(resultsCard, !uniqueOrders);

    // Show one row per unique Order ID, with all items grouped
    groupedByOrderId.forEach((items, orderId) => {
      const firstItem = items[0];
      const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const itemTypes = items.map(item => item.orderType).join(", ");
      
      const row = document.createElement("article");
      row.className = "search-result";
      row.innerHTML = `
        <div class="result-head">
          <div>
            <strong>${firstItem.orderId}</strong>
            <p>${firstItem.customerName} · ${items.length} item${items.length > 1 ? "s" : ""}</p>
            <p style="font-size: 0.85rem; color: #666; margin-top: 4px;">${itemTypes}</p>
          </div>
          <div>${statusBadge(firstItem.paymentStatus).outerHTML}</div>
        </div>
        <p>${firstItem.phone || "No phone saved"} · Total: ${formatCurrency(totalAmount)} · Due ${formatDate(firstItem.dueDate)}</p>
      `;
      row.addEventListener("click", () => renderCustomerReceipt(firstItem, orders));
      results.append(row);
    });
  }

  function renderCustomerReceipt(order, relatedOrders = []) {
    state.customerSelection = order;

    // Get all items with the same Order ID (case-insensitive)
    const orderId = String(order.orderId || "").trim().toUpperCase();
    const allOrderItems = relatedOrders.filter((item) => String(item.orderId || "").trim().toUpperCase() === orderId);
    
    // Calculate totals from all items with same Order ID
    const totalAmount = allOrderItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalPaidAmount = allOrderItems.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    const totalRemaining = Math.max(0, totalAmount - totalPaidAmount);
    const paymentStatus = totalRemaining <= 0 ? "Paid" : totalPaidAmount > 0 ? "Partially Paid" : "Unpaid";
    
    renderCustomerSummary({ ...order, amount: totalAmount, paidAmount: totalPaidAmount, remaining: totalRemaining });

    byId("receiptOrderId").textContent = order.orderId || "-";
    byId("receiptCustomerName").textContent = order.customerName || "-";
    byId("receiptPhone").textContent = order.phone || "-";
    
    // Show all items for this order in a list
    const itemsList = byId("receiptItemsList");
    if (itemsList && allOrderItems.length > 0) {
      itemsList.innerHTML = allOrderItems.map((item, idx) => {
        const qty = item.notes && item.notes.includes("Qty:") ? item.notes : "Qty: 1";
        return `<div style="padding: 6px 0; border-bottom: 1px solid #eee;">
          <strong>${item.orderType}</strong>
          <span style="display: block; font-size: 0.85rem; color: #666;">${qty} · ${formatCurrency(item.amount)}</span>
        </div>`;
      }).join("");
    } else {
      const itemsText = allOrderItems.map(item => {
        const qty = item.notes && item.notes.includes("Qty:") ? ` (${item.notes})` : "";
        return `${item.orderType}${qty}`;
      }).join(", ");
      byId("receiptOrderType").textContent = itemsText || "-";
    }
    
    byId("receiptAmount").textContent = formatCurrency(totalAmount);
    byId("receiptPaidAmount").textContent = formatCurrency(totalPaidAmount);
    byId("receiptRemainingAmount").textContent = formatCurrency(totalRemaining);
    byId("receiptOrderStatus").textContent = normalizeStatusLabel(order.orderStatus || "Order Placed");
    byId("receiptPaymentStatus").textContent = paymentStatus;
    byId("receiptOrderDate").textContent = formatDate(order.orderDate);
    renderWorkflowProgress(order);

    const paymentCard = byId("paymentCard");
    const completeMsg = byId("completeMsg");
    const paymentHeading = byId("paymentHeading");
    const paymentText = byId("paymentText");
    const payBtn = byId("payBtn");
    const waBtn = byId("waBtn");
    const qrImage = byId("qrImage");
    const paymentUpiId = byId("paymentUpiId");
    const qrAmount = byId("qrAmount");
    const settings = state.settings || defaults;
    const upiId = CONFIRMED_UPI_ID;
    const whatsapp = normalizePhone(settings["WhatsApp Number"] || defaults.whatsapp);

    toggleHidden(paymentCard, false);
    toggleHidden(completeMsg, true);

    if (paymentStatus === "Paid") {
      toggleHidden(paymentCard, true);
      completeMsg.classList.remove("hidden");
      completeMsg.innerHTML = `
        <strong>Payment Complete</strong>
        <p class="muted">This order has been fully paid. No further action is required.</p>
      `;
    } else {
      const due = paymentStatus === "Partially Paid" ? totalRemaining : totalAmount;
      qrAmount.textContent = formatCurrency(due);
      paymentHeading.textContent = paymentStatus === "Partially Paid" ? "Pay Remaining" : "Pay Now";
      paymentText.textContent = paymentStatus === "Partially Paid"
        ? `₹${due} remains for this order. Tap the payment button or pay directly to the UPI ID below.`
        : `Pay the full amount for this order using the UPI ID below.`;
      if (paymentUpiId) paymentUpiId.textContent = upiId;
      if (qrImage) qrImage.src = qrUrl(upiId, due, order.orderId, order.customerName);
      payBtn.textContent = paymentStatus === "Partially Paid" ? "Pay Remaining" : "Pay Now";
      payBtn.onclick = () => {
        const intent = upiIntent(upiId, due, order.orderId, order.customerName);
        window.location.href = intent;
      };
      waBtn.href = buildWhatsAppUrl(whatsapp, `Hello Seema ji, I want an update for Order ${order.orderId}.`);
      toggleHidden(paymentCard, false);
    }

    if (byId("receiptCard")) {
      byId("receiptCard").classList.remove("hidden");
    }

    const quickList = byId("quickList");
    const moreOrdersCard = byId("moreOrdersCard");
    if (quickList && moreOrdersCard) {
      quickList.innerHTML = "";
      // Show other Order IDs (not the current one)
      const otherOrders = relatedOrders.filter((item) => String(item.orderId || "").trim() !== orderId);
      // Group other orders by Order ID
      const groupedOrders = new Map();
      otherOrders.forEach((item) => {
        const oid = String(item.orderId || "").trim();
        if (!groupedOrders.has(oid)) {
          groupedOrders.set(oid, item);
        }
      });
      groupedOrders.forEach((item) => {
        const entry = document.createElement("article");
        entry.className = "mini-item";
        entry.innerHTML = `
          <strong>${item.orderId} · ${item.orderType}</strong>
          <p>${formatCurrency(item.amount)} total · ${formatCurrency(item.remaining)} remaining</p>
        `;
        entry.addEventListener("click", () => renderCustomerReceipt(item, relatedOrders));
        quickList.append(entry);
      });
      if (!otherOrders.length) {
        quickList.innerHTML = '<p class="muted">No other orders on this phone number.</p>';
      }
      moreOrdersCard.classList.toggle("hidden", !otherOrders.length);
    }
  }

  async function handleCustomerSearch() {
    const query = String(byId("customerQuery").value || "").trim();
    const status = byId("customerStatus");
    if (!query) {
      setMessage(status, "Enter an Order ID or phone number.", "error");
      return;
    }

    setMessage(status, "Searching orders...", "muted");
    try {
      await fetchSettings();
      const orders = await fetchOrders(true);
      
      // Search by Order ID: get ALL rows with that Order ID (case-insensitive)
      const exactOrders = orders.filter((order) => String(order.orderId || "").trim().toUpperCase() === String(query || "").trim().toUpperCase());
      
      // Search by phone
      const queryPhone = normalizePhone(query);
      const byPhone = queryPhone ? orders.filter((order) => normalizePhone(order.phone) === queryPhone) : [];

      // If found by Order ID, use all rows; otherwise use phone matches
      const matches = exactOrders.length > 0 ? exactOrders : byPhone;

      if (!matches.length) {
        setMessage(status, "No matching order found.", "error");
        toggleHidden(byId("customerResultsCard"), true);
        toggleHidden(byId("receiptCard"), true);
        toggleHidden(byId("receiptProgress"), true);
        return;
      }

      renderCustomerSearchResults(matches);
      
      // Use first item as primary for display, but show all related items
      const primary = matches[0];
      const related = exactOrders.length > 0 ? exactOrders : (primary.phone ? orders.filter((order) => normalizePhone(order.phone) === normalizePhone(primary.phone)) : matches);
      renderCustomerReceipt(primary, related);
      setMessage(status, `Found ${matches.length} matching order${matches.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      setMessage(status, error.message || "Unable to fetch order data.", "error");
    }
  }

  function resetCustomer() {
    if (byId("customerQuery")) byId("customerQuery").value = "";
    if (byId("customerStatus")) setMessage(byId("customerStatus"), "", "muted");
    toggleHidden(byId("customerResultsCard"), true);
    toggleHidden(byId("receiptCard"), true);
    toggleHidden(byId("moreOrdersCard"), true);
    toggleHidden(byId("receiptProgress"), true);
    toggleHidden(byId("completeMsg"), true);
    toggleHidden(byId("paymentCard"), true);
    byId("quickList").innerHTML = "";
  }

  function buildAdminShell() {
    const app = byId("adminArea");
    if (!app) return;

    app.innerHTML = `
      <section class="admin-shell">
        <section class="card">
          <div class="nav-row">
            <div>
              <h2>Admin Dashboard</h2>
              <p class="help-text">Manage orders, payments, and settings in one place.</p>
            </div>
            <div class="hero-actions">
              <button id="refreshAdminBtn" class="btn btn-secondary touch" type="button">Refresh</button>
              <button id="exportOrdersBtn" class="btn btn-secondary touch" type="button">Export Orders CSV</button>
              <button id="bulkReminderBtn" class="btn btn-secondary touch" type="button">Bulk Reminder</button>
              <button id="dailySummaryBtn" class="btn btn-secondary touch" type="button">Today's Summary</button>
              <a class="btn btn-ghost touch" href="index.html">Home</a>
            </div>
          </div>
          <div class="admin-tabs" style="margin-top:12px;">
            <button class="tab active" data-tab="dashboard" type="button">Dashboard</button>
            <button class="tab" data-tab="add" type="button">Add Order</button>
            <button class="tab" data-tab="queue" type="button">Order Queue</button>
            <button class="tab" data-tab="settings" type="button">Settings</button>
          </div>
        </section>

        <section id="adminTabDashboard" class="admin-tab-panel">
          <div class="summary-grid">
            <div class="summary-card"><span>Total Orders</span><strong id="totalOrdersCount">0</strong></div>
            <div class="summary-card"><span>Pending Payments</span><strong id="pendingOrdersCount">0</strong></div>
            <div class="summary-card"><span>Today's Orders</span><strong id="todayOrdersCount">0</strong></div>
            <div class="summary-card"><span>Total Revenue This Month</span><strong id="monthlyRevenueCount">₹0</strong></div>
          </div>
          <div class="grid two">
            <article class="card">
              <div class="section-title">
                <h3>All Orders</h3>
                <span class="muted">Search by customer name or phone</span>
              </div>
              <div class="hero-actions" style="margin-bottom:12px;">
                <input id="orderSearchInput" type="search" placeholder="Search by customer or phone" />
                <button id="clearOrderSearchBtn" class="btn btn-secondary touch" type="button">Clear</button>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Paid</th>
                      <th>Remaining</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th>Due</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="ordersTableBody"></tbody>
                </table>
              </div>
              <p id="ordersMsg" class="msg"></p>
            </article>
            <article class="card">
              <div class="section-title">
                <h3>Pending Payments</h3>
                <span class="muted">Overdue and due soon first</span>
              </div>
              <div id="pendingList" class="list"></div>
              <p id="pendingMsg" class="msg"></p>
            </article>
          </div>
        </section>

        <section id="adminTabAdd" class="admin-tab-panel hidden">
          <div class="card">
            <div class="section-title">
              <h3>Multiple Order Placement</h3>
              <span class="muted">Enter the customer phone once and add rows for each order.</span>
            </div>
            <div class="hero-actions" style="margin-bottom:12px;">
              <button id="quickBlouseBtn" class="btn btn-secondary touch" type="button">Blouse ₹200</button>
              <button id="quickSuitBtn" class="btn btn-secondary touch" type="button">Suit ₹400</button>
            </div>
            <form id="multiOrderForm" class="stack">
              <div class="grid two">
                <div>
                  <label for="multiCustomerName">Customer Name</label>
                  <input id="multiCustomerName" required />
                </div>
                <div>
                  <label for="multiCustomerPhone">Phone Number</label>
                  <input id="multiCustomerPhone" inputmode="numeric" maxlength="10" placeholder="10 digits" required />
                </div>
              </div>
              <div id="multiOrderRows" class="stack"></div>
              <div class="hero-actions">
                <button id="addOrderRowBtn" class="btn btn-secondary touch" type="button">+ Add another order</button>
                <button class="btn btn-primary touch" type="submit">Create Orders</button>
              </div>
              <p id="multiOrderMsg" class="msg"></p>
            </form>
          </div>

          <div class="card" style="margin-top:16px;">
            <div class="section-title">
              <h3>Edit / Quick Add</h3>
              <span class="muted">Use this card for single-order edits if needed.</span>
            </div>
            <form id="orderForm" class="form-grid two">
              <input id="formOrderId" type="hidden" />
              <div>
                <label for="formCustomerName">Customer Name</label>
                <input id="formCustomerName" required />
              </div>
              <div>
                <label for="formPhone">Phone Number</label>
                <input id="formPhone" inputmode="numeric" maxlength="10" placeholder="10 digits" required />
              </div>
              <div>
                <label for="formOrderType">Order Type</label>
                <select id="formOrderType" required>
                  <option value="">Select order type</option>
                  <option>Blouse</option>
                  <option>Suit</option>
                  <option>Saree</option>
                  <option>Lehenga</option>
                </select>
              </div>
              <div>
                <label for="formAmount">Amount</label>
                <input id="formAmount" type="number" min="1" step="1" required />
              </div>
              <div>
                <label for="formPaidAmount">Paid Amount</label>
                <input id="formPaidAmount" type="number" min="0" step="1" value="0" />
              </div>
              <div>
                <label for="formPaymentMethod">Payment Method</label>
                <select id="formPaymentMethod">
                  <option value="">Unspecified</option>
                  <option value="UPI">UPI</option>
                  <option value="Cash">Cash</option>
                  <option value="Partial">Partial</option>
                </select>
              </div>
              <div>
                <label for="formOrderDate">Order Date</label>
                <input id="formOrderDate" type="date" required />
              </div>
              <div>
                <label for="formDueDate">Due Date</label>
                <input id="formDueDate" type="date" required />
              </div>
              <div>
                <label for="formOrderStatus">Order Status</label>
                <select id="formOrderStatus">
                  <option>Order Placed</option>
                  <option>Cutting</option>
                  <option>In Progress</option>
                  <option>Ready</option>
                  <option>Delivered</option>
                </select>
              </div>
              <div style="grid-column: 1 / -1;">
                <label for="formNotes">Notes</label>
                <textarea id="formNotes" placeholder="Optional notes"></textarea>
              </div>
              <div class="form-footer" style="grid-column: 1 / -1;">
                <button class="btn btn-primary touch" type="submit">Save Order</button>
                <button id="cancelEditBtn" class="btn btn-secondary touch" type="button">Cancel Edit</button>
              </div>
            </form>
            <p id="formMsg" class="msg"></p>
            </div>
        </section>

        <section id="adminTabQueue" class="admin-tab-panel hidden">
          <div class="card">
            <div class="section-title">
              <h3>Order Queue</h3>
              <span class="muted">Grouped by due date</span>
            </div>
            <div id="queueList" class="list"></div>
            <p id="queueMsg" class="msg"></p>
          </div>
        </section>

        <section id="adminTabSettings" class="admin-tab-panel hidden">
          <div class="grid two">
            <article class="card">
              <h3>Change PIN</h3>
              <div class="form-grid">
                <div>
                  <label for="settingsCurrentPin">Current PIN</label>
                  <input id="settingsCurrentPin" type="password" inputmode="numeric" />
                </div>
                <div>
                  <label for="settingsNewPin">New PIN</label>
                  <input id="settingsNewPin" type="password" inputmode="numeric" />
                </div>
                <div>
                  <label for="settingsConfirmPin">Confirm PIN</label>
                  <input id="settingsConfirmPin" type="password" inputmode="numeric" />
                </div>
              </div>
            </article>
            <article class="card">
              <h3>Shop Settings</h3>
              <div class="form-grid">
                <div>
                  <label for="settingsUpi">UPI ID</label>
                  <input id="settingsUpi" />
                </div>
                <div>
                  <label for="settingsWhatsapp">WhatsApp Number</label>
                  <input id="settingsWhatsapp" inputmode="numeric" />
                </div>
                <div>
                  <label for="settingsAddress">Shop Address</label>
                  <textarea id="settingsAddress"></textarea>
                </div>
              </div>
            </article>
          </div>
          <div class="card">
            <div class="hero-actions">
              <button id="saveSettingsBtn" class="btn btn-primary touch" type="button">Save Settings</button>
              <button id="exportAllBtn" class="btn btn-secondary touch" type="button">Export All Data to CSV</button>
              <button id="resetAllBtn" class="btn btn-danger touch" type="button">Reset All Data</button>
            </div>
            <p id="settingsMsg" class="msg"></p>
          </div>
        </section>
      </section>
    `;
  }

  function showAdminTab(tabName) {
    state.activeAdminTab = tabName;
    ["dashboard", "add", "queue", "settings"].forEach((name) => {
      const panel = byId(`adminTab${name.charAt(0).toUpperCase()}${name.slice(1)}`);
      if (panel) toggleHidden(panel, name !== tabName);
    });
    document.querySelectorAll(".admin-tabs .tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
  }

  function renderAdminSummary() {
    const total = state.orders.length;
    const pending = computePendingOrders(state.orders).length;
    const today = computeTodayOrders(state.orders).length;
    const revenue = computeRevenueThisMonth(state.orders);
    byId("totalOrdersCount").textContent = String(total);
    byId("pendingOrdersCount").textContent = String(pending);
    byId("todayOrdersCount").textContent = String(today);
    byId("monthlyRevenueCount").textContent = formatCurrency(revenue);
  }

  function renderPendingPayments() {
    const list = byId("pendingList");
    const msg = byId("pendingMsg");
    if (!list || !msg) return;
    list.innerHTML = "";

    const pending = sortPendingOrders(state.orders.filter((order) => Number(order.remaining || 0) > 0));
    if (!pending.length) {
      setMessage(msg, "No pending payments.", "success");
      return;
    }

    setMessage(msg, "", "muted");

    pending.forEach((order) => {
      const card = document.createElement("article");
      card.className = "list-item";
      const priority = priorityMeta(order);
      card.innerHTML = `
        <div class="list-item-head">
          <div>
            <strong>${order.customerName}</strong>
            <p>${order.orderType} · Due ${formatDate(order.dueDate)}</p>
          </div>
          <span class="priority-chip ${priority.className}">${priority.label}</span>
        </div>
        <div class="list-item-head">
          ${statusBadge(order.paymentStatus).outerHTML}
          <span class="status-pill ${statusClass(order.orderStatus)}">${normalizeStatusLabel(order.orderStatus)}</span>
        </div>
        <p>Amount: ${formatCurrency(order.amount)} · Paid: ${formatCurrency(order.paidAmount)} · Remaining: ${formatCurrency(order.remaining)}</p>
      `;
      const actions = document.createElement("div");
      actions.className = "toolbar";
      // Primary actions (kept visible)
      actions.append(
        button("Send Reminder", "btn btn-secondary small-btn", () => sendReminder(order)),
        button("Ready", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Ready")),
        button("Delivered", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Delivered")),
        button("Mark Paid", "btn btn-success small-btn", () => updatePayment(order, "Paid", order.amount)),
        button("Partial Payment", "btn btn-warning small-btn", () => promptPartialPayment(order)),
        button("View Details", "btn btn-ghost small-btn", () => showOrderDetails(order))
      );

      // Secondary actions (hidden behind 'More') to reduce clutter
      const moreBtn = button("More", "btn btn-ghost small-btn", () => {
        moreActions.classList.toggle("hidden");
      });
      const moreActions = document.createElement("div");
      moreActions.className = "more-actions hidden";
      moreActions.style.display = "flex";
      moreActions.style.gap = "8px";
      moreActions.style.marginTop = "8px";
      moreActions.append(
        button("Placed", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Order Placed")),
        button("Cutting", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Cutting")),
        button("In Progress", "btn btn-secondary small-btn", () => updateOrderStatus(order, "In Progress")),
        button("Mark Paid (UPI)", "btn btn-success small-btn", () => updatePayment(order, "Paid", order.amount, "UPI")),
        button("Mark Paid (Cash)", "btn btn-success small-btn", () => updatePayment(order, "Paid", order.amount, "Cash"))
      );

      actions.append(moreBtn, moreActions);
      card.append(actions);
      list.append(card);
    });
  }

  function renderAllOrders() {
    const tbody = byId("ordersTableBody");
    const msg = byId("ordersMsg");
    if (!tbody || !msg) return;
    tbody.innerHTML = "";
    const filtered = filterOrdersByText(state.orders, state.filterText);
    if (!filtered.length) {
      setMessage(msg, "No orders found.", "muted");
      return;
    }
    setMessage(msg, `${filtered.length} order${filtered.length === 1 ? "" : "s"} shown.`, "muted");

    filtered.forEach((order) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${order.orderId}</td>
        <td>${order.customerName}</td>
        <td>${order.phone || "-"}</td>
        <td>${order.orderType}</td>
        <td>${formatCurrency(order.amount)}</td>
        <td>${formatCurrency(order.paidAmount)}</td>
        <td>${formatCurrency(order.remaining)}</td>
        <td>${statusBadge(order.orderStatus).outerHTML}</td>
        <td>${order.paymentStatus}</td>
        <td>${formatDate(order.dueDate)}</td>
      `;
      const td = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "table-actions";
      actions.append(
        button("Placed", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Order Placed")),
        button("Cutting", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Cutting")),
        button("In Progress", "btn btn-secondary small-btn", () => updateOrderStatus(order, "In Progress")),
        button("Ready", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Ready")),
        button("Delivered", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Delivered")),
        button("Mark Paid - UPI", "btn btn-success small-btn", () => updatePayment(order, "Paid", order.amount, "UPI")),
        button("Mark Paid - Cash", "btn btn-success small-btn", () => updatePayment(order, "Paid", order.amount, "Cash")),
        button("Partial Payment", "btn btn-warning small-btn", () => promptPartialPayment(order)),
        button("Send Reminder", "btn btn-secondary small-btn", () => sendReminder(order)),
        button("Edit", "btn btn-secondary small-btn", () => loadOrderToForm(order.orderId)),
        button("Delete", "btn btn-danger small-btn", () => deleteOrder(order.orderId))
      );
      td.append(actions);
      tr.append(td);
      tbody.append(tr);
    });
  }

  function groupByDueDate(orders) {
    return orders.reduce((map, order) => {
      const key = order.dueDate || "No due date";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(order);
      return map;
    }, new Map());
  }

  function renderQueue() {
    const list = byId("queueList");
    const msg = byId("queueMsg");
    if (!list || !msg) return;
    list.innerHTML = "";
    const sorted = [...state.orders].sort((a, b) => {
      const da = startOfDay(a.dueDate);
      const db = startOfDay(b.dueDate);
      if (da && db && da.getTime() !== db.getTime()) return da - db;
      return String(a.orderId || "").localeCompare(String(b.orderId || ""));
    });
    const grouped = groupByDueDate(sorted);
    if (!grouped.size) {
      setMessage(msg, "No orders in the queue.", "muted");
      return;
    }
    setMessage(msg, `${sorted.length} order${sorted.length === 1 ? "" : "s"} in the queue.`, "muted");
    grouped.forEach((orders, dueDate) => {
      const section = document.createElement("article");
      section.className = "queue-group";
      const due = startOfDay(dueDate);
      const today = startOfDay(new Date());
      const diff = due ? Math.ceil((due - today) / 86400000) : null;
      const tone = diff < 0 ? "danger" : diff === 1 ? "warning" : "muted";
      section.innerHTML = `
        <div class="section-title">
          <h4>${dueDate || "No due date"}</h4>
          <span class="${tone}">${diff === null ? "No due date" : diff < 0 ? `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}` : diff === 0 ? "Due today" : diff === 1 ? "Due tomorrow" : `Due in ${diff} days`}</span>
        </div>
      `;
      orders.forEach((order) => {
        const row = document.createElement("div");
        row.className = "queue-item";
        row.innerHTML = `
          <div>
            <strong>${order.orderId} · ${order.customerName}</strong>
            <p>${order.orderType} · ${formatCurrency(order.remaining)} remaining</p>
          </div>
          <div class="toolbar"></div>
        `;
        const actions = row.querySelector(".toolbar");
        actions.append(
          button("Placed", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Order Placed")),
          button("Cutting", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Cutting")),
          button("In Progress", "btn btn-secondary small-btn", () => updateOrderStatus(order, "In Progress")),
          button("Ready", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Ready")),
          button("Delivered", "btn btn-secondary small-btn", () => updateOrderStatus(order, "Delivered"))
        );
        section.append(row);
      });
      list.append(section);
    });
  }

  function renderSettings() {
    const settings = state.settings || defaults;
    byId("settingsCurrentPin").value = settings.PIN || defaults.pin;
    byId("settingsUpi").value = settings["UPI ID"] || defaults.upi;
    byId("settingsWhatsapp").value = settings["WhatsApp Number"] || defaults.whatsapp;
    byId("settingsAddress").value = settings["Shop Address"] || defaults.address;
  }

  function showOrderDetails(order) {
    setMessage(byId("pendingMsg"), `${order.orderId}: ${order.customerName} · ${order.orderType} · ${normalizeStatusLabel(order.orderStatus)}`, "success");
    showAdminTab("dashboard");
  }

  function buildStatusMessage(order, nextStatus) {
    const next = normalizeStatusLabel(nextStatus);
    if (next === "Ready") {
      return buildReadyMessage({ ...order, orderStatus: next });
    }
    return buildOrderConfirmationMessage({ ...order, orderStatus: next });
  }

  function launchStatusMessage(order, nextStatus) {
    const phone = order.phone;
    const message = buildStatusMessage(order, nextStatus);
    if (!maybeOpenWhatsApp(phone, message)) {
      copyTextToClipboard(message, "Status message copied to clipboard.", "pendingMsg");
    }
  }

  async function updateOrderStatus(order, nextStatus) {
    try {
      setMessage(byId("ordersMsg"), "Saving status update...", "muted");
      // Ensure we send a complete order payload to the server (server expects required fields)
      const fullOrder = state.orders.find((o) => o.orderId === order.orderId) || order || {};
      const payload = {
        orderId: fullOrder.orderId || order.orderId,
        customerName: fullOrder.customerName || order.customerName || "",
        phone: normalizePhone(fullOrder.phone || order.phone || ""),
        orderType: fullOrder.orderType || order.orderType || "",
        amount: Number(fullOrder.amount || order.amount || 0),
        paidAmount: Number(fullOrder.paidAmount || order.paidAmount || 0),
        paymentMethod: fullOrder.paymentMethod || order.paymentMethod || "",
        orderDate: fullOrder.orderDate || order.orderDate || isoToday(),
        dueDate: fullOrder.dueDate || order.dueDate || "",
        notes: fullOrder.notes || order.notes || "",
        orderStatus: normalizeStatusLabel(nextStatus)
      };

      await postAction("saveOrder", payload);
      await refreshAdminData();
      launchStatusMessage(order, nextStatus);
      setMessage(byId("ordersMsg"), `${order.orderId} marked as ${normalizeStatusLabel(nextStatus)}.`, "success");
    } catch (error) {
      setMessage(byId("ordersMsg"), error.message || "Could not update status.", "error");
    }
  }

  function sendReminder(order) {
    const status = normalizeStatusLabel(order.orderStatus);
    let message = buildOrderConfirmationMessage(order);
    if (Number(order.remaining || 0) > 0 && String(order.paymentStatus || "").toLowerCase() === "partially paid") {
      message = buildPartialPaymentReminderMessage(order);
    } else if (Number(order.remaining || 0) > 0 && (status === "Ready" || status === "Delivered")) {
      message = buildPaymentReminderMessage(order);
    } else if (status === "Ready" && Number(order.remaining || 0) === 0) {
      message = buildReadyMessage(order);
    }
    if (!maybeOpenWhatsApp(order.phone, message)) {
      copyTextToClipboard(message, "Reminder copied to clipboard.", "pendingMsg");
    }
  }

  async function updatePayment(order, paymentStatus, paidAmount, paymentMethod = "") {
    try {
      setMessage(byId("pendingMsg"), "Saving payment update...", "muted");
      await postAction("updatePayment", {
        orderId: order.orderId,
        paymentStatus,
        paidAmount,
        paymentMethod: paymentMethod || order.paymentMethod || (paymentStatus === "Paid" ? "UPI" : "Partial"),
        notes: order.notes || ""
      });
      await refreshAdminData();
      setMessage(byId("pendingMsg"), "Payment updated.", "success");
    } catch (error) {
      setMessage(byId("pendingMsg"), error.message || "Could not update payment.", "error");
    }
  }

  async function promptPartialPayment(order) {
    const value = window.prompt(`Enter amount received for ${order.orderId}`, String(Math.max(1, Math.floor(Number(order.remaining || 0) / 2))));
    if (value === null) return;
    const paid = Number(value);
    if (!Number.isFinite(paid) || paid <= 0 || paid >= Number(order.amount || 0)) {
      window.alert("Enter a valid partial amount smaller than the total amount.");
      return;
    }
    await updatePayment(order, "Partially Paid", paid, "Partial");
  }

  async function deleteOrder(orderId) {
    if (!window.confirm(`Delete order ${orderId}? This cannot be undone.`)) return;
    try {
      await postAction("deleteOrder", { orderId });
      await refreshAdminData();
    } catch (error) {
      window.alert(error.message || "Could not delete order.");
    }
  }

  function fillForm(order) {
    state.editOrderId = order ? order.orderId : null;
    byId("formOrderId").value = order ? order.orderId : nextOrderId(state.orders);
    byId("formCustomerName").value = order ? order.customerName : "";
    byId("formPhone").value = order ? order.phone : "";
    byId("formOrderType").value = order ? order.orderType : "";
    byId("formAmount").value = order ? order.amount : "";
    byId("formPaidAmount").value = order ? order.paidAmount : 0;
    if (byId("formPaymentMethod")) byId("formPaymentMethod").value = order ? (order.paymentMethod || "") : "";
    byId("formOrderDate").value = order ? order.orderDate : isoToday();
    byId("formDueDate").value = order ? order.dueDate : "";
    byId("formOrderStatus").value = order ? normalizeStatusLabel(order.orderStatus) : "Order Placed";
    byId("formNotes").value = order ? order.notes : "";
    showAdminTab("add");
  }

  function loadOrderToForm(orderId) {
    const order = state.orders.find((item) => item.orderId === orderId);
    if (!order) return;
    fillForm(order);
  }

  function clearForm() {
    state.editOrderId = null;
    fillForm(null);
    byId("formPaidAmount").value = 0;
    if (byId("formPaymentMethod")) byId("formPaymentMethod").value = "";
    byId("formOrderStatus").value = "Order Placed";
    byId("formNotes").value = "";
    byId("formMsg").textContent = "";
  }

  function prefillQuickOrder(orderType, amount) {
    fillForm(null);
    byId("formOrderType").value = orderType;
    byId("formAmount").value = amount;
    byId("formPaidAmount").value = 0;
    byId("formOrderStatus").value = "Order Placed";
    byId("formCustomerName").focus();
    setMessage(byId("formMsg"), `${orderType} preset loaded.`, "success");
  }

  function buildMultiOrderRow(index = 0) {
    const row = document.createElement("article");
    row.className = "multi-order-row";
    row.innerHTML = `
      <div class="multi-order-row-head">
        <strong>Order ${index + 1}</strong>
        <button type="button" class="btn btn-secondary small-btn remove-order-row">Remove</button>
      </div>
      <div class="grid two">
        <div>
          <label>Order Type</label>
          <select class="multi-order-type" required>
            <option value="">Select order type</option>
            <option>Blouse</option>
            <option>Suit</option>
            <option>Saree</option>
            <option>Lehenga</option>
          </select>
        </div>
        <div>
          <label>Amount</label>
          <input class="multi-order-amount" type="number" min="1" step="1" required />
        </div>
        <div>
          <label>Due Date</label>
          <input class="multi-order-due" type="date" required />
        </div>
        <div>
          <label>Notes</label>
          <input class="multi-order-notes" placeholder="Optional notes" />
        </div>
      </div>
    `;
    row.querySelector(".remove-order-row").addEventListener("click", () => {
      const rows = byId("multiOrderRows");
      if (rows && rows.children.length > 1) row.remove();
      refreshMultiOrderLabels();
    });
    return row;
  }

  function refreshMultiOrderLabels() {
    const rows = byId("multiOrderRows");
    if (!rows) return;
    [...rows.children].forEach((row, index) => {
      const strong = row.querySelector("strong");
      if (strong) strong.textContent = `Order ${index + 1}`;
    });
  }

  function addMultiOrderRow() {
    const rows = byId("multiOrderRows");
    if (!rows) return;
    rows.append(buildMultiOrderRow(rows.children.length));
  }

  function resetMultiOrderForm() {
    if (byId("multiCustomerName")) byId("multiCustomerName").value = "";
    if (byId("multiCustomerPhone")) byId("multiCustomerPhone").value = "";
    const rows = byId("multiOrderRows");
    if (rows) {
      rows.innerHTML = "";
      rows.append(buildMultiOrderRow(0));
    }
  }

  async function saveMultiOrders(event) {
    event.preventDefault();
    const customerName = String(byId("multiCustomerName").value || "").trim();
    const phone = normalizePhone(byId("multiCustomerPhone").value);
    const rows = [...byId("multiOrderRows").querySelectorAll(".multi-order-row")];
    if (!customerName || phone.length !== 10) {
      setMessage(byId("multiOrderMsg"), "Enter a customer name and valid 10-digit phone number.", "error");
      return;
    }
    const payloads = rows.map((row) => ({
      customerName,
      phone,
      orderType: row.querySelector(".multi-order-type").value,
      amount: row.querySelector(".multi-order-amount").value,
      dueDate: row.querySelector(".multi-order-due").value,
      notes: row.querySelector(".multi-order-notes").value,
      orderStatus: "Order Placed",
      paymentMethod: "",
      paidAmount: 0,
      orderDate: isoToday()
    })).filter((item) => item.orderType && Number(item.amount) > 0 && item.dueDate);

    if (!payloads.length) {
      setMessage(byId("multiOrderMsg"), "Add at least one complete order row.", "error");
      return;
    }

    try {
      setMessage(byId("multiOrderMsg"), "Creating orders...", "muted");
      const results = [];
      for (const payload of payloads) {
        const result = await postAction("saveOrder", payload);
        results.push(result.orderId);
      }
      setMessage(byId("multiOrderMsg"), `Created ${results.length} order${results.length === 1 ? "" : "s"}: ${results.join(", ")}`, "success");
      resetMultiOrderForm();
      await refreshAdminData();
      showAdminTab("dashboard");
    } catch (error) {
      setMessage(byId("multiOrderMsg"), error.message || "Could not create orders.", "error");
    }
  }

  function maybeNotifyStatus(order) {
    const status = normalizeStatusLabel(order.orderStatus);
    if (status !== "Ready") return;
    const message = buildStatusNotificationMessage(order);
    if (!maybeOpenWhatsApp(order.phone, message)) {
      copyTextToClipboard(message, "Status message copied to clipboard.", "formMsg");
    }
  }

  async function saveOrder(event) {
    event.preventDefault();
    const payload = toPayloadOrder({
      orderId: byId("formOrderId").value,
      customerName: byId("formCustomerName").value,
      phone: byId("formPhone").value,
      orderType: byId("formOrderType").value,
      amount: byId("formAmount").value,
      paidAmount: byId("formPaidAmount").value,
      paymentMethod: byId("formPaymentMethod") ? byId("formPaymentMethod").value : "",
      orderDate: byId("formOrderDate").value,
      dueDate: byId("formDueDate").value,
      orderStatus: byId("formOrderStatus").value,
      notes: byId("formNotes").value
    });

    if (!payload.customerName || !normalizePhone(payload.phone) || normalizePhone(payload.phone).length !== 10 || !payload.orderType || !payload.amount || !payload.dueDate) {
      setMessage(byId("formMsg"), "Please complete all required fields with a valid 10-digit phone number.", "error");
      return;
    }

    try {
      setMessage(byId("formMsg"), "Saving order...", "muted");
      await postAction("saveOrder", payload);
      setMessage(byId("formMsg"), "Order saved successfully.", "success");
      maybeNotifyStatus(payload);
      clearForm();
      await refreshAdminData();
      showAdminTab("dashboard");
    } catch (error) {
      setMessage(byId("formMsg"), error.message || "Could not save order.", "error");
    }
  }

  async function saveSettings() {
    const currentPin = byId("settingsCurrentPin").value.trim();
    const newPin = byId("settingsNewPin").value.trim();
    const confirmPin = byId("settingsConfirmPin").value.trim();
    const upi = byId("settingsUpi").value.trim();
    const whatsapp = normalizePhone(byId("settingsWhatsapp").value);
    const address = byId("settingsAddress").value.trim();

    const allowedPins = [
      state.settings.PIN || "",
      cfg.ADMIN_PIN || "",
      cfg.DEFAULT_PIN || "",
      defaults.pin || ""
    ].map((value) => String(value || "").trim()).filter(Boolean);

    if (!allowedPins.includes(currentPin)) {
      setMessage(byId("settingsMsg"), "Current PIN is incorrect.", "error");
      return;
    }

    if (newPin && newPin !== confirmPin) {
      setMessage(byId("settingsMsg"), "New PIN and confirm PIN do not match.", "error");
      return;
    }

    const payload = {
      PIN: newPin || currentPin,
      "UPI ID": upi || defaults.upi,
      "WhatsApp Number": whatsapp || defaults.whatsapp,
      "Shop Address": address || defaults.address
    };

    try {
      setMessage(byId("settingsMsg"), "Saving settings...", "muted");
      await postAction("saveSettings", payload);
      state.settings = { ...state.settings, ...payload };
      renderSettings();
      setMessage(byId("settingsMsg"), "Settings updated. The new PIN will be required on the next login.", "success");
    } catch (error) {
      setMessage(byId("settingsMsg"), error.message || "Could not save settings.", "error");
    }
  }

  async function resetAllData() {
    if (!window.confirm("Reset all orders and restore default settings?")) return;
    try {
      setMessage(byId("settingsMsg"), "Resetting data...", "muted");
      await postAction("resetData", {});
      state.orders = [];
      state.settings = { ...defaults };
      await refreshAdminData();
      renderSettings();
      setMessage(byId("settingsMsg"), "All data has been reset.", "success");
    } catch (error) {
      setMessage(byId("settingsMsg"), error.message || "Could not reset data.", "error");
    }
  }

  function exportCurrentOrders() {
    downloadText(`seema-orders-${isoToday()}.csv`, ordersCsv(state.orders));
  }

  function exportAllData() {
    const combined = `${ordersCsv(state.orders)}\n\n${settingsCsv(state.settings || defaults)}`;
    downloadText(`seema-export-${isoToday()}.csv`, combined);
  }

  function wireAdminControls() {
    document.querySelectorAll(".admin-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => showAdminTab(tab.dataset.tab));
    });
    byId("refreshAdminBtn").addEventListener("click", refreshAdminData);
    byId("exportOrdersBtn").addEventListener("click", exportCurrentOrders);
    byId("bulkReminderBtn").addEventListener("click", () => copyTextToClipboard(buildBulkReminderMessage(state.orders), "Bulk reminder copied to clipboard.", "pendingMsg"));
    byId("dailySummaryBtn").addEventListener("click", () => copyTextToClipboard(buildDailySummaryMessage(state.orders), "Today's summary copied to clipboard.", "pendingMsg"));
    byId("quickBlouseBtn").addEventListener("click", () => prefillQuickOrder("Blouse", 200));
    byId("quickSuitBtn").addEventListener("click", () => prefillQuickOrder("Suit", 400));
    if (byId("addOrderRowBtn")) byId("addOrderRowBtn").addEventListener("click", addMultiOrderRow);
    if (byId("multiOrderForm")) byId("multiOrderForm").addEventListener("submit", saveMultiOrders);
    byId("orderSearchInput").addEventListener("input", (event) => {
      state.filterText = event.target.value;
      renderAllOrders();
    });
    byId("clearOrderSearchBtn").addEventListener("click", () => {
      byId("orderSearchInput").value = "";
      state.filterText = "";
      renderAllOrders();
    });
    byId("orderForm").addEventListener("submit", saveOrder);
    byId("cancelEditBtn").addEventListener("click", clearForm);
    byId("saveSettingsBtn").addEventListener("click", saveSettings);
    byId("resetAllBtn").addEventListener("click", resetAllData);
    byId("exportAllBtn").addEventListener("click", exportAllData);

    if (byId("multiOrderRows") && !byId("multiOrderRows").children.length) {
      resetMultiOrderForm();
    }
  }

  async function refreshAdminData() {
    const pendingMsg = byId("pendingMsg");
    const ordersMsg = byId("ordersMsg");
    const settingsMsg = byId("settingsMsg");
    setMessage(pendingMsg, "Loading dashboard...", "muted");
    setMessage(ordersMsg, "", "muted");
    setMessage(settingsMsg, "", "muted");

    try {
      const [orders, settings] = await Promise.all([fetchOrders(true), fetchSettings(true)]);
      state.orders = orders;
      state.settings = settings;
      renderAdminSummary();
      renderPendingPayments();
      renderAllOrders();
      renderQueue();
      renderSettings();
      if (!byId("formOrderDate").value) {
        fillForm(null);
      }
      setMessage(pendingMsg, `Loaded ${orders.length} orders.`, "success");
    } catch (error) {
      setMessage(pendingMsg, error.message || "Could not load dashboard.", "error");
      setMessage(ordersMsg, error.message || "Could not load orders.", "error");
    }
  }

  function loginAdmin() {
    const pin = byId("pinInput").value.trim();
    const allowedPins = [
      (state.settings && state.settings.PIN) || "",
      cfg.ADMIN_PIN || "",
      cfg.DEFAULT_PIN || "",
      defaults.pin || "",
      "958919"
    ].map((value) => String(value || "").trim()).filter(Boolean);
    if (!allowedPins.includes(pin)) {
      setMessage(byId("pinMsg"), "Incorrect PIN.", "error");
      return;
    }
    state.adminLoggedIn = true;
    toggleHidden(byId("pinCard"), true);
    toggleHidden(byId("adminArea"), false);
    buildAdminShell();
    wireAdminControls();
    refreshAdminData();
  }

  function bindCustomerPage() {
    const searchBtn = byId("customerSearchBtn");
    const resetBtn = byId("customerResetBtn");
    const queryInput = byId("customerQuery");
    if (searchBtn) searchBtn.addEventListener("click", handleCustomerSearch);
    if (resetBtn) resetBtn.addEventListener("click", resetCustomer);
    if (queryInput) {
      queryInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") handleCustomerSearch();
      });
    }
  }

  function bindAdminLogin() {
    const loginBtn = byId("pinBtn");
    const loginInput = byId("pinInput");
    if (loginBtn) loginBtn.addEventListener("click", async () => {
      try {
        await fetchSettings(true);
        loginAdmin();
      } catch (error) {
        setMessage(byId("pinMsg"), error.message || "Could not load settings.", "error");
      }
    });
    if (loginInput) {
      loginInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") loginBtn.click();
      });
    }
  }

  function patchCustomerReceiptState() {
    toggleHidden(byId("customerResultsCard"), true);
    toggleHidden(byId("receiptCard"), true);
    toggleHidden(byId("paymentCard"), true);
    toggleHidden(byId("completeMsg"), true);
  }

  async function bootstrap() {
    const page = document.body.dataset.page || "";
    try {
      await fetchSettings(true);
    } catch (error) {
      // The UI will still load and show a clearer error when the user tries to fetch data.
    }

    if (page === "customer") {
      bindCustomerPage();
      patchCustomerReceiptState();
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      const phone = params.get("phone");
      if (id && byId("customerQuery")) byId("customerQuery").value = id;
      if (phone && byId("customerQuery")) byId("customerQuery").value = phone;
    }

    if (page === "admin") {
      bindAdminLogin();
      if (byId("adminArea")) toggleHidden(byId("adminArea"), true);
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
