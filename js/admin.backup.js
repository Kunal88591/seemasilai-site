// Simplified admin dashboard for fast payment updates and order entry.
(function () {
  const pinOverlay = document.getElementById("pinOverlay");
  const mainContent = document.getElementById("mainContent");
  const pinInput = document.getElementById("pinInput");
  const pinBtn = document.getElementById("pinBtn");
  const pinError = document.getElementById("pinError");

  const refreshBtn = document.getElementById("refreshBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const exportCsvBtnInline = document.getElementById("exportCsvBtnInline");

  const totalOrders = document.getElementById("totalOrders");
  const totalPending = document.getElementById("totalPending");
  const todayOrders = document.getElementById("todayOrders");

  const pendingList = document.getElementById("pendingList");
  const pendingMsg = document.getElementById("pendingMsg");

  const completedList = document.getElementById("completedList");
  const completedMsg = document.getElementById("completedMsg");

  const addOrderForm = document.getElementById("addOrderForm");
  const addMsg = document.getElementById("addMsg");

  const newPinInput = document.getElementById("newPin");
  const confirmPinInput = document.getElementById("confirmPin");
  const savePinBtn = document.getElementById("savePinBtn");
  const resetPinBtn = document.getElementById("resetPinBtn");
  const pinChangeMsg = document.getElementById("pinChangeMsg");

  const upiInput = document.getElementById("upiId");
  const updateUpiBtn = document.getElementById("updateUpiBtn");
  const upiMsg = document.getElementById("upiMsg");

  const pinStorageKey = "seemaStaffPin";
  const upiStorageKey = "seemaStaffUpiId";

  let ordersCache = [];

  function toDayStamp(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function sameDay(dateA, dateB) {
    return toDayStamp(dateA) === toDayStamp(dateB);
  }

  function getCurrentPin() {
    return localStorage.getItem(pinStorageKey) || window.SEEMA_CONFIG.ADMIN_PIN;
  }

  function getCurrentUpi() {
    const saved = String(localStorage.getItem(upiStorageKey) || "").trim();
    const canonical = String(window.SEEMA_CONFIG.UPI_ID || "Q183526070@ybl").trim();
    if (!saved) return canonical;
    if (!/^[a-z0-9._-]{2,}@[a-z]{2,}$/i.test(saved)) return canonical;
    return saved;
  }

  function setMessage(element, text, isError = false) {
    if (!element) return;
    element.textContent = text;
    element.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function paymentStatusLabel(status) {
    const value = String(status || "").trim().toLowerCase();

    if (value === "paid") return { text: "Paid", className: "paid" };
    if (value === "partially paid" || value === "partial" || value === "partial paid") {
      return { text: "Partial", className: "partial" };
    }

    return { text: "Unpaid", className: "unpaid" };
  }

  function getReminderText(order, allOrders = [], messageType = "default") {
    const trackUrl = `${window.SEEMA_CONFIG.SITE_BASE_URL}/track?id=${order.orderId}`;
    const upiId = window.SEEMA_CONFIG.UPI_ID;
    const status = order.orderStatus || "Ordered";
    
    // Get all rows with same Order ID to show complete order
    const orderRows = allOrders.filter(
      o => String(o.orderId || "").trim().toUpperCase() === String(order.orderId || "").trim().toUpperCase()
    );
    
    let itemsText = "";
    let totalAmount = 0;
    
    if (orderRows.length > 1) {
      // Multiple items in this order
      itemsText = orderRows
        .map(row => {
          const qty = row.notes && row.notes.includes("Qty:") ? row.notes : "";
          return `• ${row.orderType} - ${window.SeemaSheets.formatAmount(row.amount)} ${qty}`;
        })
        .join("\n");
      totalAmount = orderRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    } else {
      // Single item
      itemsText = order.orderType;
      totalAmount = Number(order.amount || 0);
    }
    
    // Customize messages based on order status
    if (status === "Ordered") {
      return `🎉 Order Confirmation - Seema Silai Centre
[Auto-Generated Reminder]

Order ID: ${order.orderId}
Customer: ${order.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(totalAmount)}

Your order has been placed successfully!
We will start working on it soon.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount Due: ${window.SeemaSheets.formatAmount(totalAmount)}

Pay now using:
📱 UPI: ${upiId}
Or use the payment link: ${trackUrl}

Thank you for choosing Seema Silai Centre!`;
    } else if (status === "In Progress") {
      return `🧵 Order Update - In Progress
[Auto-Generated Reminder]

Order ID: ${order.orderId}
Customer: ${order.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(totalAmount)}

Good news! Your order is now being tailored by our expert craftspeople.
We're working hard to make it perfect for you.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount Due: ${window.SeemaSheets.formatAmount(totalAmount)}

📱 UPI: ${upiId}
Track: ${trackUrl}

We appreciate your patience!`;
    } else if (status === "Completed") {
      // Two variants for Completed status
      if (messageType === "order-ready") {
        // Order-ready message: leads with completion, payment secondary
        const itemType = orderRows.length > 0 ? orderRows[0].orderType : order.orderType;
        const paidAmount = Number(order.paidAmount || 0);
        const balanceAmount = Math.max(0, totalAmount - paidAmount);
        
        return `📸 Your ${itemType} is ready for fitting!
[Auto-Generated Reminder]

Order ID: ${order.orderId}
Customer: ${order.customerName}

Great news! Your order is complete and ready to be tried on.
Visit us at A-24 Veena Nagar, Indore for fitting and final adjustments.

We're excited to show you the final result! 🌟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Items:
${itemsText}

Track & Payment: ${trackUrl}

${balanceAmount > 0 ? `Balance: ₹${balanceAmount} (can pay at pickup)` : `✅ Payment Complete`}

See you soon! 👋`;
      } else {
        // Default: Payment reminder for completed orders
        return `✨ Ready for Pickup - Seema Silai Centre
[Auto-Generated Reminder]

Order ID: ${order.orderId}
Customer: ${order.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(totalAmount)}

Excellent! Your order is now complete and ready for pickup.
Come visit us at A-24 Veena Nagar, Indore to collect your beautiful piece!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 FINAL PAYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please pay remaining amount:
📱 UPI: ${upiId}
Or visit: ${trackUrl}

We can't wait to show you the final result!`;
      }
    } else if (status === "Delivered") {
      return `🎁 Order Delivered - Thank You!
[Auto-Generated Reminder]

Order ID: ${order.orderId}
Customer: ${order.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(totalAmount)}

Your order has been delivered! We hope you love it.
Thank you for choosing Seema Silai Centre.

We appreciate your business and hope to see you again soon!

📱 Any questions? Contact us
UPI: ${upiId}
More details: ${trackUrl}

With gratitude,
Seema Silai Centre Team`;
    } else if (order.balanceDue > 0) {
      // Payment reminder for pending orders
      let statusLine = "Status: Awaiting payment";
      if (order.paymentStatus === "Partially Paid") {
        statusLine = `Status: Partial payment received
Amount Received: ${window.SeemaSheets.formatAmount(order.amountPaid || 0)}
Remaining Due: ${window.SeemaSheets.formatAmount(order.balanceDue)}`;
      }
      
      return `🔔 Payment Reminder from Seema Silai Centre
[Auto-Generated Reminder]

Order ID: ${order.orderId}
Customer: ${order.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(totalAmount)}
${statusLine}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 HOW TO PAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount to Pay: ${window.SeemaSheets.formatAmount(order.balanceDue || totalAmount)}

Option 1: UPI (Recommended)
📱 Send to: ${upiId}

Option 2: Online
🔗 Pay & Track: ${trackUrl}

Questions? Reply to this message

This is an automated reminder. Thank you!`;
    }
  }

  function createButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function showMessageTypeDialog(order, allOrders, onConfirm) {
    // Only show dialog for Completed orders
    if (order.orderStatus !== "Completed") {
      onConfirm("default");
      return;
    }

    // Create modal overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 30px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      animation: slideUp 0.3s ease-out;
    `;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.append(style);

    const title = document.createElement("h3");
    title.textContent = "Choose Message Type";
    title.style.cssText = "margin: 0 0 20px 0; font-size: 18px; color: #333;";

    const description = document.createElement("p");
    description.textContent = `Which message would you like to send for ${order.orderId}?`;
    description.style.cssText = "margin: 0 0 25px 0; color: #666; font-size: 14px;";

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = "display: flex; gap: 12px; justify-content: space-between;";

    // Order Ready Button
    const orderReadyBtn = document.createElement("button");
    orderReadyBtn.innerHTML = `<div style="font-size: 24px; margin-bottom: 8px;">📸</div><strong>Order Ready</strong><div style="font-size: 12px; color: #666; margin-top: 4px;">Focus on completion</div>`;
    orderReadyBtn.style.cssText = `
      flex: 1;
      padding: 16px;
      border: 2px solid #e0e0e0;
      background: #fafafa;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    `;
    orderReadyBtn.addEventListener("mouseover", () => {
      orderReadyBtn.style.borderColor = "#4CAF50";
      orderReadyBtn.style.background = "#f1f8f4";
    });
    orderReadyBtn.addEventListener("mouseout", () => {
      orderReadyBtn.style.borderColor = "#e0e0e0";
      orderReadyBtn.style.background = "#fafafa";
    });
    orderReadyBtn.addEventListener("click", () => {
      overlay.remove();
      style.remove();
      onConfirm("order-ready");
    });

    // Payment Reminder Button
    const paymentBtn = document.createElement("button");
    paymentBtn.innerHTML = `<div style="font-size: 24px; margin-bottom: 8px;">💰</div><strong>Payment Reminder</strong><div style="font-size: 12px; color: #666; margin-top: 4px;">Focus on payment</div>`;
    paymentBtn.style.cssText = `
      flex: 1;
      padding: 16px;
      border: 2px solid #e0e0e0;
      background: #fafafa;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    `;
    paymentBtn.addEventListener("mouseover", () => {
      paymentBtn.style.borderColor = "#FF9800";
      paymentBtn.style.background = "#fff3e0";
    });
    paymentBtn.addEventListener("mouseout", () => {
      paymentBtn.style.borderColor = "#e0e0e0";
      paymentBtn.style.background = "#fafafa";
    });
    paymentBtn.addEventListener("click", () => {
      overlay.remove();
      style.remove();
      onConfirm("default");
    });

    buttonContainer.append(orderReadyBtn, paymentBtn);

    // Cancel on overlay click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        style.remove();
      }
    });

    modal.append(title, description, buttonContainer);
    overlay.append(modal);
    document.body.append(overlay);
  }

  function createOrderCard(order, allOrders = []) {
    const card = document.createElement("article");
    card.className = "order-card";

    // Get all items with same Order ID
    const orderId = String(order.orderId || "").trim();
    const allOrderItems = allOrders.filter(
      (item) => String(item.orderId || "").trim() === orderId
    );
    
    // Calculate totals from all items
    const totalAmount = allOrderItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalPaidAmount = allOrderItems.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    const totalBalanceDue = Math.max(0, totalAmount - totalPaidAmount);

    const label = paymentStatusLabel(order.paymentStatus);
    const dueDateLabel = window.SeemaSheets.formatDate(order.dueDate);
    const phoneLabel = String(order.customerPhone || "").trim();

    // Enhanced status text for partial payments
    let statusText = label.text;
    if (label.className === "partial") {
      statusText = `Partial: ${window.SeemaSheets.formatAmount(totalPaidAmount)}`;
    }

    // Show all items for this order
    const itemsDisplay = allOrderItems.map(item => {
      const qty = item.notes && item.notes.includes("Qty:") ? ` (${item.notes})` : "";
      return `${item.orderType}${qty}`;
    }).join(", ");

    card.innerHTML = `
      <div class="order-top">
        <div>
          <p class="order-id">${order.orderId}</p>
          <h3>${order.customerName}</h3>
          <p class="order-meta">${itemsDisplay}${phoneLabel ? ` · ${phoneLabel}` : ""}</p>
          <div class="order-detail-grid">
            <span class="order-detail-pill">Total ${window.SeemaSheets.formatAmount(totalAmount)}</span>
            <span class="order-detail-pill">Paid ${window.SeemaSheets.formatAmount(totalPaidAmount)}</span>
            <span class="order-detail-pill">Due ${window.SeemaSheets.formatAmount(totalBalanceDue)}</span>
            <span class="order-detail-pill">Due Date ${dueDateLabel}</span>
          </div>
        </div>
        <span class="status-chip ${label.className}">${statusText}</span>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    actions.append(
      createButton("Mark Paid", "btn btn-primary btn-compact", async () => {
        await updatePayment(order, "Paid", totalAmount);
      }),
      createButton("Partial", "btn btn-secondary btn-compact", async () => {
        const input = window.prompt("Enter amount received", String(totalPaidAmount || 0));
        if (input === null) return;

        const amountPaid = Number(input);
        if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > totalAmount) {
          setMessage(pendingMsg, "Enter a valid partial amount.", true);
          return;
        }

        const status = amountPaid >= totalAmount ? "Paid" : amountPaid > 0 ? "Partially Paid" : "Unpaid";
        await updatePayment(order, status, amountPaid);
      })
    );

    // Reminder buttons section
    const reminderSection = document.createElement("div");
    reminderSection.className = "reminder-section";

    const copyReminderBtn = createButton("Reminder", "btn btn-ghost btn-compact", async () => {
      showMessageTypeDialog(order, allOrders, async (messageType) => {
        try {
          const text = getReminderText(order, allOrders, messageType);
          await navigator.clipboard.writeText(text);
          setMessage(pendingMsg, `Reminder copied for ${order.orderId}.`);
        } catch (error) {
          setMessage(pendingMsg, error.message || "Could not copy reminder.", true);
        }
      });
    });

    const whatsappBtn = document.createElement("button");
    whatsappBtn.type = "button";
    whatsappBtn.className = "btn-whatsapp";
    whatsappBtn.title = "Send on WhatsApp";
    whatsappBtn.innerHTML = "📱";
    whatsappBtn.addEventListener("click", async () => {
      showMessageTypeDialog(order, allOrders, (messageType) => {
        const message = getReminderText(order, allOrders, messageType);
        const phone = String(order.customerPhone || "").replace(/\D/g, "");
        const whatsappUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, "_blank");
      });
    });

    reminderSection.append(copyReminderBtn, whatsappBtn);
    
    card.append(actions);
    card.append(reminderSection);

    // Status dropdown section
    const statusSection = document.createElement("div");
    statusSection.className = "status-dropdown-section";
    
    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Status";
    statusLabel.className = "status-label";
    
    const statusSelect = document.createElement("select");
    statusSelect.className = "status-select";

    const statuses = ["Ordered", "In Progress", "Completed", "Delivered"];
    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusSelect.append(option);
    });

    const rawStatus = String(order.orderStatus || "").trim().toLowerCase();
    const normalizedStatus = rawStatus === "order placed" || rawStatus === "pending"
      ? "Ordered"
      : rawStatus === "ready" || rawStatus === "ready for trial"
        ? "Completed"
        : rawStatus === "stitching" || rawStatus === "cutting"
          ? "In Progress"
          : statuses.find((status) => status.toLowerCase() === rawStatus) || "Ordered";
    statusSelect.value = normalizedStatus;
    
    statusSelect.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      await updateOrderStatus(order, newStatus);
    });
    
    statusSection.append(statusLabel, statusSelect);
    card.append(statusSection);
    return card;
  }

  async function updateOrderStatus(order, newStatus) {
    try {
      setMessage(pendingMsg, "Updating status...");
      await window.SeemaSheets.updateOrderStatus(order.orderId, newStatus);
      // Optimistic update avoids Google Sheets read-after-write lag showing old status.
      order.orderStatus = newStatus;
      setMessage(pendingMsg, `Status updated to ${newStatus}.`);
      window.setTimeout(() => {
        refreshDashboard().catch(() => {});
      }, 1200);
    } catch (error) {
      setMessage(pendingMsg, error.message || "Failed to update status.", true);
    }
  }

  function renderStats(orders) {
    const pending = orders.filter((order) => Number(order.balanceDue || 0) > 0);
    const dueSum = pending.reduce((sum, order) => sum + Number(order.balanceDue || 0), 0);

    const today = new Date();
    const todayCount = orders.filter((order) => {
      const orderDate = window.SeemaSheets.parseDate(order.orderDate);
      return orderDate ? sameDay(orderDate, today) : false;
    }).length;

    totalOrders.textContent = String(orders.length);
    totalPending.textContent = window.SeemaSheets.formatAmount(dueSum);
    todayOrders.textContent = String(todayCount);
  }

  function renderPendingOrders(orders) {
    pendingList.innerHTML = "";

    const pending = orders
      .filter((order) => Number(order.balanceDue || 0) > 0 || String(order.paymentStatus || "").trim().toLowerCase() !== "paid")
      .sort((a, b) => {
        const dateA = window.SeemaSheets.parseDate(a.dueDate)?.getTime() || 0;
        const dateB = window.SeemaSheets.parseDate(b.dueDate)?.getTime() || 0;
        return dateA - dateB;
      });

    if (!pending.length) {
      setMessage(pendingMsg, "No pending payments.");
      return;
    }

    setMessage(pendingMsg, "");

    // Group by Order ID to avoid duplicate cards/reminders for multi-item orders
    const groupedByOrderId = new Map();
    pending.forEach((order) => {
      const orderId = String(order.orderId || "").trim();
      if (!groupedByOrderId.has(orderId)) {
        groupedByOrderId.set(orderId, order); // Keep first row as representative
      }
    });

    // Show one card per unique Order ID
    groupedByOrderId.forEach((order) => {
      pendingList.append(createOrderCard(order, pending));
    });
  }

  function renderCompletedOrders(orders) {
    completedList.innerHTML = "";

    const completed = orders
      .filter((order) => Number(order.balanceDue || 0) === 0 && String(order.paymentStatus || "").trim().toLowerCase() === "paid")
      .sort((a, b) => {
        const dateA = window.SeemaSheets.parseDate(a.orderDate)?.getTime() || 0;
        const dateB = window.SeemaSheets.parseDate(b.orderDate)?.getTime() || 0;
        return dateB - dateA; // Most recent first
      });

    if (!completed.length) {
      setMessage(completedMsg, "No completed orders yet.");
      return;
    }

    setMessage(completedMsg, "");

    // Group by Order ID to avoid duplicate cards for multi-item orders
    const groupedByOrderId = new Map();
    completed.forEach((order) => {
      const orderId = String(order.orderId || "").trim();
      if (!groupedByOrderId.has(orderId)) {
        groupedByOrderId.set(orderId, order); // Keep first row as representative
      }
    });

    // Show one card per unique Order ID
    groupedByOrderId.forEach((order) => {
      const card = document.createElement("article");
      card.className = "order-card completed";

      // Get all items with same Order ID
      const orderId = String(order.orderId || "").trim();
      const allOrderItems = completed.filter(
        (item) => String(item.orderId || "").trim() === orderId
      );
      
      // Calculate totals from all items
      const totalAmount = allOrderItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      
      // Show all items for this order
      const itemsDisplay = allOrderItems.map(item => {
        const qty = item.notes && item.notes.includes("Qty:") ? ` (${item.notes})` : "";
        return `${item.orderType}${qty}`;
      }).join(", ");

      const summaryLine = [
        itemsDisplay,
        `Total ${window.SeemaSheets.formatAmount(totalAmount)}`,
        `Paid on ${window.SeemaSheets.formatDate(order.orderDate)}`
      ].join(" · ");

      card.innerHTML = `
        <div class="order-top">
          <div>
            <p class="order-id">${order.orderId}</p>
            <h3>${order.customerName}</h3>
            <p class="order-meta">${summaryLine}${order.customerPhone ? ` · ${order.customerPhone}` : ""}</p>
          </div>
          <span class="status-chip paid">Paid: ${window.SeemaSheets.formatAmount(totalAmount)}</span>
        </div>
      `;

      completedList.append(card);
    });
  }

  async function refreshDashboard() {
    setMessage(pendingMsg, "Loading orders...");

    try {
      ordersCache = await window.SeemaSheets.fetchOrders();
      renderStats(ordersCache);
      renderPendingOrders(ordersCache);
      renderCompletedOrders(ordersCache);
    } catch (error) {
      setMessage(pendingMsg, error.message || "Could not load dashboard.", true);
    }
  }

  async function updatePayment(order, paymentStatus, amountPaid) {
    try {
      await window.SeemaSheets.updatePaymentStatus(order.orderId, paymentStatus, amountPaid, "");
      await refreshDashboard();
    } catch (error) {
      setMessage(pendingMsg, error.message || "Failed to update payment.", true);
    }
  }

  function unlockAdmin() {
    if (pinInput.value.trim() !== getCurrentPin()) {
      setMessage(pinError, "Incorrect PIN.", true);
      return;
    }

    setMessage(pinError, "Unlocked.");
    pinOverlay.classList.add("hidden");
    mainContent.classList.remove("hidden");
    refreshDashboard();
  }

  function saveNewPin() {
    const nextPin = newPinInput.value.trim();
    const confirmPin = confirmPinInput.value.trim();

    if (!nextPin || nextPin.length < 4) {
      setMessage(pinChangeMsg, "Enter a PIN with at least 4 digits.", true);
      return;
    }

    if (nextPin !== confirmPin) {
      setMessage(pinChangeMsg, "PINs do not match.", true);
      return;
    }

    localStorage.setItem(pinStorageKey, nextPin);
    setMessage(pinChangeMsg, "PIN updated.");
    newPinInput.value = "";
    confirmPinInput.value = "";
  }

  function resetPin() {
    localStorage.removeItem(pinStorageKey);
    setMessage(pinChangeMsg, `PIN reset to default ${window.SEEMA_CONFIG.ADMIN_PIN}.`);
    newPinInput.value = "";
    confirmPinInput.value = "";
  }

  function saveUpi() {
    const nextUpi = upiInput.value.trim();

    if (!nextUpi) {
      setMessage(upiMsg, "Enter a UPI ID.", true);
      return;
    }

    localStorage.setItem(upiStorageKey, nextUpi);
    window.SEEMA_CONFIG.UPI_ID = nextUpi;
    setMessage(upiMsg, "UPI saved.");
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  async function exportCsv() {
    try {
      if (!ordersCache.length) {
        ordersCache = await window.SeemaSheets.fetchOrders();
      }

      const rows = [
        ["Order ID", "Customer Name", "Phone", "Order Type", "Amount", "Order Date", "Due Date", "Status", "Payment Status", "Amount Paid", "Balance Due", "Notes"],
        ...ordersCache.map((order) => [
          order.orderId,
          order.customerName,
          order.customerPhone,
          order.orderType,
          order.amount,
          order.orderDate,
          order.dueDate,
          order.status,
          order.paymentStatus,
          order.amountPaid,
          order.balanceDue,
          order.notes
        ])
      ];

      const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "seema-silai-orders.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(pendingMsg, "CSV exported.");
    } catch (error) {
      setMessage(pendingMsg, error.message || "Could not export CSV.", true);
    }
  }

  function createItemRow(index) {
    const div = document.createElement("div");
    div.className = "item-row stack";
    div.dataset.index = index;
    div.style.cssText = "border: 1px solid rgba(201,147,58,.15); padding: 12px; border-radius: 6px; background: rgba(245,236,215,.2);";
    
    div.innerHTML = `
      <div style="display: grid; gap: 12px; grid-template-columns: 2fr 1fr 1fr auto;">
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; font-weight: 500;">Item</label>
          <select class="orderTypeSelect" name="orderType" style="width: 100%; padding: 8px; border: 1px solid rgba(201,147,58,.25); border-radius: 4px; font: inherit; background: white;">
            <option value="">Select type</option>
            <option value="Blouse">Blouse</option>
            <option value="Suit">Suit</option>
            <option value="Saree">Saree</option>
            <option value="Lehenga">Lehenga</option>
            <option value="Kurti">Kurti</option>
            <option value="Salwar">Salwar</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; font-weight: 500;">Qty</label>
          <input type="number" class="quantity" min="1" value="1" style="width: 100%; padding: 8px; border: 1px solid rgba(201,147,58,.25); border-radius: 4px; font: inherit;" />
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; font-weight: 500;">Amount (₹)</label>
          <input type="number" class="amount" min="1" placeholder="0" style="width: 100%; padding: 8px; border: 1px solid rgba(201,147,58,.25); border-radius: 4px; font: inherit;" />
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; font-weight: 500;">&nbsp;</label>
          <button type="button" class="removeItemBtn" style="width: 100%; padding: 8px; background: #c94d2f; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">✕</button>
        </div>
      </div>
      <div>
        <label style="display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; font-weight: 500;">Or type custom item</label>
        <input type="text" class="customItem" placeholder="E.g. Palazzo Pants, Dupatta, etc." style="width: 100%; padding: 8px; border: 1px solid rgba(201,147,58,.25); border-radius: 4px; font: inherit;" />
      </div>
    `;
    
    div.querySelector(".removeItemBtn").addEventListener("click", () => div.remove());
    return div;
  }

  function renderItemsList() {
    const itemsList = document.getElementById("itemsList");
    if (!itemsList.children.length) {
      itemsList.append(createItemRow(0));
    }
  }

  async function onAddOrder(event) {
    event.preventDefault();
    setMessage(addMsg, "Saving order...");

    const formData = new FormData(addOrderForm);
    const customerName = String(formData.get("customerName") || "").trim();
    const customerPhone = String(formData.get("customerPhone") || "").trim();
    const dueDate = String(formData.get("dueDate") || "").trim();

    if (!customerName || !customerPhone || !dueDate) {
      setMessage(addMsg, "Fill customer info and due date.", true);
      return;
    }

    const itemRows = document.querySelectorAll(".item-row");
    const items = [];

    itemRows.forEach((row) => {
      const dropdownValue = row.querySelector(".orderTypeSelect").value.trim();
      const customValue = row.querySelector(".customItem").value.trim();
      const itemName = customValue || dropdownValue;
      const quantity = Number(row.querySelector(".quantity").value) || 1;
      const amount = Number(row.querySelector(".amount").value) || 0;

      if (!itemName || !amount) return;

      items.push({
        itemName,
        quantity,
        amount,
        total: amount * quantity
      });
    });

    if (!items.length) {
      setMessage(addMsg, "Add at least one item with amount.", true);
      return;
    }

    try {
      if (!ordersCache.length) {
        ordersCache = await window.SeemaSheets.fetchOrders();
      }

      const orderId = window.SeemaSheets.nextOrderId(ordersCache);
      const itemDescriptions = [];

      // Send all items in a single batch request
      const itemsPayload = items.map(item => ({
        orderId,
        customerName,
        customerPhone,
        phone: customerPhone,
        orderType: item.itemName,
        amount: item.total,
        dueDate,
        orderStatus: "Ordered",
        notes: item.quantity > 1 ? `Qty: ${item.quantity}` : ""
      }));

      // Add all items at once with the same Order ID
      for (const itemData of itemsPayload) {
        await window.SeemaSheets.addOrder(itemData);
        itemDescriptions.push(`${itemData.orderType} (Qty: ${items[itemsPayload.indexOf(itemData)].quantity}, ₹${items[itemsPayload.indexOf(itemData)].amount})`);
      }

      addOrderForm.reset();
      renderItemsList();
      setMessage(addMsg, `Order #${orderId} created. Items: ${itemDescriptions.join(" + ")}`);
      await refreshDashboard();
    } catch (error) {
      setMessage(addMsg, error.message || "Failed to save order.", true);
    }
  }

  const addItemBtn = document.getElementById("addItemBtn");
  addItemBtn.addEventListener("click", () => {
    const itemsList = document.getElementById("itemsList");
    const nextIndex = itemsList.children.length;
    itemsList.append(createItemRow(nextIndex));
  });

  pinBtn.addEventListener("click", unlockAdmin);
  pinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlockAdmin();
  });

  refreshBtn.addEventListener("click", refreshDashboard);
  exportCsvBtn.addEventListener("click", exportCsv);
  if (exportCsvBtnInline) exportCsvBtnInline.addEventListener("click", exportCsv);
  addOrderForm.addEventListener("submit", onAddOrder);
  savePinBtn.addEventListener("click", saveNewPin);
  resetPinBtn.addEventListener("click", resetPin);
  updateUpiBtn.addEventListener("click", saveUpi);

  renderItemsList();
  upiInput.value = getCurrentUpi();
  pinInput.focus();
})();
