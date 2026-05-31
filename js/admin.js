// Complete rewrite of admin dashboard with proper multi-item order logic
(function () {
  // ============================================================================
  // DOM ELEMENTS
  // ============================================================================
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

  let allOrdersCache = [];

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  
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
    if (value === "partially paid" || value === "partial") {
      return { text: "Partial", className: "partial" };
    }
    return { text: "Unpaid", className: "unpaid" };
  }

  // ============================================================================
  // CORE: GROUP ORDERS BY ID WITH COMPLETE TOTALS
  // ============================================================================
  
  function groupOrdersByIdWithTotals(orders) {
    /**
     * Groups all order rows by orderId and calculates totals for the entire order.
     * Returns a Map where:
     *   key = orderId
     *   value = {
     *     orderId,
     *     customerName,
     *     customerPhone,
     *     orderDate,
     *     dueDate,
     *     totalAmount (sum of all items),
     *     totalAmountPaid (sum of paid for all items),
     *     totalBalanceDue (totalAmount - totalAmountPaid),
     *     allItems (array of all rows with this orderId),
     *     paymentStatus (calculated from totals),
     *     primaryRow (first row as representative)
     *   }
     */
    const grouped = new Map();

    orders.forEach((order) => {
      const orderId = String(order.orderId || "").trim().toUpperCase();
      if (!orderId) return;

      if (!grouped.has(orderId)) {
        grouped.set(orderId, {
          orderId,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          orderDate: order.orderDate,
          dueDate: order.dueDate,
          items: []
        });
      }

      grouped.get(orderId).items.push(order);
    });

    // Calculate totals for each order
    grouped.forEach((orderGroup) => {
      const items = orderGroup.items;
      
      const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const totalAmountPaid = items.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
      const totalBalanceDue = Math.max(0, totalAmount - totalAmountPaid);

      // Determine overall payment status from totals
      let paymentStatus = "Unpaid";
      if (totalBalanceDue <= 0 && totalAmountPaid > 0) {
        paymentStatus = "Paid";
      } else if (totalAmountPaid > 0 && totalBalanceDue > 0) {
        paymentStatus = "Partially Paid";
      }

      // Determine overall order status (most recent status if mixed)
      const uniqueStatuses = [...new Set(items.map(i => i.orderStatus || "Ordered"))];
      
      const statusPriority = {
        "Delivered": 4,
        "Completed": 3,
        "In Progress": 2,
        "Ordered": 1
      };
      const orderStatus = uniqueStatuses.sort(
        (a, b) => (statusPriority[b] || 0) - (statusPriority[a] || 0)
      )[0] || "Ordered";

      orderGroup.totalAmount = totalAmount;
      orderGroup.totalAmountPaid = totalAmountPaid;
      orderGroup.totalBalanceDue = totalBalanceDue;
      orderGroup.paymentStatus = paymentStatus;
      orderGroup.orderStatus = orderStatus;
      orderGroup.primaryRow = items[0];
    });

    return grouped;
  }

  // ============================================================================
  // FILTERING LOGIC FOR PENDING/COMPLETED
  // ============================================================================

  function getPendingOrders(groupedOrders) {
    /**
     * Returns pending orders where:
     * - totalBalanceDue > 0 (still owe money)
     */
    const pending = Array.from(groupedOrders.values()).filter(
      order => Number(order.totalBalanceDue || 0) > 0
    );

    // Sort by due date
    return pending.sort((a, b) => {
      const dateA = window.SeemaSheets.parseDate(a.dueDate)?.getTime() || Number.MAX_VALUE;
      const dateB = window.SeemaSheets.parseDate(b.dueDate)?.getTime() || Number.MAX_VALUE;
      return dateA - dateB;
    });
  }

  function getCompletedOrders(groupedOrders) {
    /**
     * Returns completed orders where:
     * - totalBalanceDue = 0 (fully paid)
     * - paymentStatus = "Paid"
     */
    const completed = Array.from(groupedOrders.values()).filter(
      order => Number(order.totalBalanceDue || 0) === 0 && order.paymentStatus === "Paid"
    );

    // Sort by order date (newest first)
    return completed.sort((a, b) => {
      const dateA = window.SeemaSheets.parseDate(a.orderDate)?.getTime() || 0;
      const dateB = window.SeemaSheets.parseDate(b.orderDate)?.getTime() || 0;
      return dateB - dateA;
    });
  }

  // ============================================================================
  // REMINDER MESSAGE LOGIC
  // ============================================================================

  function getReminderText(orderGroup, messageType = "default") {
    const trackUrl = `${window.SEEMA_CONFIG.SITE_BASE_URL}/track?id=${orderGroup.orderId}`;
    const upiId = getCurrentUpi();
    const status = orderGroup.orderStatus || "Ordered";

    // Build items text from all items in the order
    let itemsText = "";
    if (orderGroup.items.length > 1) {
      itemsText = orderGroup.items
        .map(item => {
          const qty = item.notes && item.notes.includes("Qty:") ? item.notes : "";
          return `• ${item.orderType} - ${window.SeemaSheets.formatAmount(item.amount)} ${qty}`;
        })
        .join("\n");
    } else if (orderGroup.items.length === 1) {
      itemsText = orderGroup.items[0].orderType;
    }

    // Customize by order status
    if (status === "Ordered") {
      return `🎉 Order Confirmation - Seema Silai Centre
[Auto-Generated Reminder]

Order ID: ${orderGroup.orderId}
Customer: ${orderGroup.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}

Your order has been placed successfully!
We will start working on it soon.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount Due: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}

Pay now using:
📱 UPI: ${upiId}
Or use the payment link: ${trackUrl}

Thank you for choosing Seema Silai Centre!`;
    } else if (status === "In Progress") {
      return `🧵 Order Update - In Progress
[Auto-Generated Reminder]

Order ID: ${orderGroup.orderId}
Customer: ${orderGroup.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}

We're working hard to make it perfect for you!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount Due: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}

📱 UPI: ${upiId}
Track: ${trackUrl}

We appreciate your patience!`;
    } else if (status === "Completed") {
      if (messageType === "order-ready") {
        const itemType = orderGroup.items[0]?.orderType || "order";
        return `📸 Your ${itemType} is ready for fitting!
[Auto-Generated Reminder]

Order ID: ${orderGroup.orderId}
Customer: ${orderGroup.customerName}

Great news! Your order is complete and ready to be tried on.
Visit us at A-24 Veena Nagar, Indore for fitting and final adjustments.

We're excited to show you the final result! 🌟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Items:
${itemsText}

${orderGroup.totalBalanceDue > 0 ? `Balance: ₹${orderGroup.totalBalanceDue} (can pay at pickup)` : `✅ Payment Complete`}

Track: ${trackUrl}

See you soon! 👋`;
      } else {
        return `✨ Ready for Pickup - Seema Silai Centre
[Auto-Generated Reminder]

Order ID: ${orderGroup.orderId}
Customer: ${orderGroup.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}

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

Order ID: ${orderGroup.orderId}
Customer: ${orderGroup.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}

Your order has been delivered! We hope you love it.
Thank you for choosing Seema Silai Centre.

We appreciate your business and hope to see you again soon!

📱 Any questions? Contact us
UPI: ${upiId}
More details: ${trackUrl}

With gratitude,
Seema Silai Centre Team`;
    } else if (orderGroup.totalBalanceDue > 0) {
      let statusLine = "Status: Awaiting payment";
      if (orderGroup.paymentStatus === "Partially Paid") {
        statusLine = `Status: Partial payment received
Amount Received: ${window.SeemaSheets.formatAmount(orderGroup.totalAmountPaid)}
Remaining Due: ${window.SeemaSheets.formatAmount(orderGroup.totalBalanceDue)}`;
      }
      
      return `🔔 Payment Reminder from Seema Silai Centre
[Auto-Generated Reminder]

Order ID: ${orderGroup.orderId}
Customer: ${orderGroup.customerName}
Items:
${itemsText}
Total Amount: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}
${statusLine}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 HOW TO PAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount to Pay: ${window.SeemaSheets.formatAmount(orderGroup.totalBalanceDue || orderGroup.totalAmount)}

Option 1: UPI (Recommended)
📱 Send to: ${upiId}

Option 2: Online
🔗 Pay & Track: ${trackUrl}

Questions? Reply to this message

This is an automated reminder. Thank you!`;
    }
  }

  function showMessageTypeDialog(orderGroup, onConfirm) {
    if (orderGroup.orderStatus !== "Completed") {
      onConfirm("default");
      return;
    }

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
    description.textContent = `Which message would you like to send for ${orderGroup.orderId}?`;
    description.style.cssText = "margin: 0 0 25px 0; color: #666; font-size: 14px;";

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = "display: flex; gap: 12px; justify-content: space-between;";

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

  // ============================================================================
  // CARD CREATION
  // ============================================================================

  function createOrderCard(orderGroup, allOrders) {
    const card = document.createElement("article");
    card.className = "order-card";

    const items = orderGroup.items;
    const label = paymentStatusLabel(orderGroup.paymentStatus);
    const dueDateLabel = window.SeemaSheets.formatDate(orderGroup.dueDate);
    const phoneLabel = String(orderGroup.customerPhone || "").trim();

    let statusText = label.text;
    if (label.className === "partial") {
      statusText = `Partial: ${window.SeemaSheets.formatAmount(orderGroup.totalAmountPaid)}`;
    }

    // Display all items in order
    const itemsDisplay = items.map(item => {
      const qty = item.notes && item.notes.includes("Qty:") ? ` (${item.notes})` : "";
      return `${item.orderType}${qty}`;
    }).join(", ");

    card.innerHTML = `
      <div class="order-top">
        <div>
          <p class="order-id">${orderGroup.orderId}</p>
          <h3>${orderGroup.customerName}</h3>
          <p class="order-meta">${itemsDisplay}${phoneLabel ? ` · ${phoneLabel}` : ""}</p>
          <div class="order-detail-grid">
            <span class="order-detail-pill">Total ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}</span>
            <span class="order-detail-pill">Paid ${window.SeemaSheets.formatAmount(orderGroup.totalAmountPaid)}</span>
            <span class="order-detail-pill">Due ${window.SeemaSheets.formatAmount(orderGroup.totalBalanceDue)}</span>
            <span class="order-detail-pill">Due Date ${dueDateLabel}</span>
          </div>
        </div>
        <span class="status-chip ${label.className}">${statusText}</span>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    // Mark Paid button
    actions.append(
      createButton("Mark Paid", "btn btn-primary btn-compact", async () => {
        try {
          setMessage(pendingMsg, "Marking as paid...");
          await window.SeemaSheets.updatePaymentStatus(
            orderGroup.orderId,
            "Paid",
            orderGroup.totalAmount,
            ""
          );
          setMessage(pendingMsg, `${orderGroup.orderId} marked as paid.`);
          await refreshDashboard();
        } catch (error) {
          setMessage(pendingMsg, error.message || "Failed to update payment.", true);
        }
      })
    );

    // Partial payment button
    actions.append(
      createButton("Partial", "btn btn-secondary btn-compact", async () => {
        const input = window.prompt("Enter amount received", String(orderGroup.totalAmountPaid || 0));
        if (input === null) return;

        const amountPaid = Number(input);
        if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > orderGroup.totalAmount) {
          setMessage(pendingMsg, "Enter a valid amount.", true);
          return;
        }

        try {
          const status = amountPaid >= orderGroup.totalAmount ? "Paid" : "Partially Paid";
          await window.SeemaSheets.updatePaymentStatus(orderGroup.orderId, status, amountPaid, "");
          await refreshDashboard();
        } catch (error) {
          setMessage(pendingMsg, error.message || "Failed to update payment.", true);
        }
      })
    );

    // Reminder buttons
    const reminderSection = document.createElement("div");
    reminderSection.className = "reminder-section";

    reminderSection.append(
      createButton("Reminder", "btn btn-ghost btn-compact", async () => {
        showMessageTypeDialog(orderGroup, async (messageType) => {
          try {
            const text = getReminderText(orderGroup, messageType);
            await navigator.clipboard.writeText(text);
            setMessage(pendingMsg, `Reminder copied for ${orderGroup.orderId}.`);
          } catch (error) {
            setMessage(pendingMsg, error.message || "Could not copy reminder.", true);
          }
        });
      })
    );

    const whatsappBtn = document.createElement("button");
    whatsappBtn.type = "button";
    whatsappBtn.className = "btn-whatsapp";
    whatsappBtn.title = "Send on WhatsApp";
    whatsappBtn.innerHTML = "📱";
    whatsappBtn.addEventListener("click", async () => {
      showMessageTypeDialog(orderGroup, (messageType) => {
        const message = getReminderText(orderGroup, messageType);
        const phone = String(orderGroup.customerPhone || "").replace(/\D/g, "");
        const whatsappUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, "_blank");
      });
    });

    reminderSection.append(whatsappBtn);

    // Status dropdown
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

    // Set value AFTER all options are added
    statusSelect.value = orderGroup.orderStatus;

    statusSelect.addEventListener("change", async () => {
      const newStatus = statusSelect.value;
      const previousStatus = orderGroup.orderStatus;
      
      try {
        setMessage(pendingMsg, `⏳ Updating ${orderGroup.orderId} to ${newStatus}...`);
        
        // Disable dropdown while updating
        statusSelect.disabled = true;
        statusSelect.style.opacity = "0.6";
        
        // Send update to backend
        const response = await window.SeemaSheets.updateOrderStatus(orderGroup.orderId, newStatus);
        console.log("✅ Backend response:", { orderId: orderGroup.orderId, newStatus, response });
        
        // Verify backend response confirms update
        if (!response || !response.ok) {
          throw new Error("Backend did not confirm status update");
        }
        
        setMessage(pendingMsg, `✅ Updated ${orderGroup.orderId}. Refreshing...`);
        
        // Wait to ensure Google Sheets write completes
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Refresh dashboard (this will re-fetch and re-render all cards)
        await refreshDashboard();
        
        console.log(`✅ Dashboard refreshed after status update to ${newStatus}`);
        setMessage(pendingMsg, `✅ ${orderGroup.orderId} is now ${newStatus}!`);
      } catch (error) {
        console.error("❌ Status update failed:", error);
        setMessage(pendingMsg, `⚠️ Failed: ${error.message || "Could not update status."}`, true);
        
        // Revert dropdown to previous value
        statusSelect.value = previousStatus;
      } finally {
        // Re-enable dropdown
        statusSelect.disabled = false;
        statusSelect.style.opacity = "1";
      }
    });

    statusSection.append(statusLabel, statusSelect);

    // Delete button section
    const deleteSection = document.createElement("div");
    deleteSection.className = "delete-section";
    deleteSection.style.cssText = "margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(201,147,58,.1);";

    const deleteBtn = createButton("🗑️ Delete Order", "btn btn-danger btn-compact", async () => {
      const confirmed = confirm(`⚠️ Delete order ${orderGroup.orderId} and ALL its items? This cannot be undone!`);
      if (!confirmed) return;

      try {
        setMessage(pendingMsg, `🗑️ Deleting ${orderGroup.orderId}...`);
        await window.SeemaSheets.deleteOrder(orderGroup.orderId);
        setMessage(pendingMsg, `✅ Order ${orderGroup.orderId} deleted successfully!`);
        
        // Refresh dashboard after deletion
        await new Promise(resolve => setTimeout(resolve, 800));
        await refreshDashboard();
      } catch (error) {
        console.error("❌ Delete failed:", error);
        setMessage(pendingMsg, `⚠️ Failed to delete: ${error.message || "Unknown error"}`, true);
      }
    });

    deleteSection.append(deleteBtn);

    card.append(actions, reminderSection, statusSection, deleteSection);
    return card;
  }

  function createButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  // ============================================================================
  // RENDERING
  // ============================================================================

  function renderStats(allOrders) {
    const grouped = groupOrdersByIdWithTotals(allOrders);
    const pending = getPendingOrders(grouped);
    
    const dueSum = pending.reduce((sum, order) => sum + Number(order.totalBalanceDue || 0), 0);

    const today = new Date();
    const todayCount = Array.from(grouped.values()).filter((order) => {
      const orderDate = window.SeemaSheets.parseDate(order.orderDate);
      return orderDate ? sameDay(orderDate, today) : false;
    }).length;

    totalOrders.textContent = String(grouped.size);
    totalPending.textContent = window.SeemaSheets.formatAmount(dueSum);
    todayOrders.textContent = String(todayCount);
  }

  function renderPendingOrders(allOrders) {
    pendingList.innerHTML = "";

    const grouped = groupOrdersByIdWithTotals(allOrders);
    const pending = getPendingOrders(grouped);

    if (!pending.length) {
      setMessage(pendingMsg, "No pending payments.");
      return;
    }

    setMessage(pendingMsg, "");

    pending.forEach((orderGroup) => {
      pendingList.append(createOrderCard(orderGroup, allOrders));
    });
  }

  function renderCompletedOrders(allOrders) {
    completedList.innerHTML = "";

    const grouped = groupOrdersByIdWithTotals(allOrders);
    const completed = getCompletedOrders(grouped);

    if (!completed.length) {
      setMessage(completedMsg, "No completed orders yet.");
      return;
    }

    setMessage(completedMsg, "");

    completed.forEach((orderGroup) => {
      const card = document.createElement("article");
      card.className = "order-card completed";

      const items = orderGroup.items;
      const itemsDisplay = items.map(item => {
        const qty = item.notes && item.notes.includes("Qty:") ? ` (${item.notes})` : "";
        return `${item.orderType}${qty}`;
      }).join(", ");

      const summaryLine = [
        itemsDisplay,
        `Total ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}`,
        `Paid on ${window.SeemaSheets.formatDate(orderGroup.orderDate)}`
      ].join(" · ");

      card.innerHTML = `
        <div class="order-top">
          <div>
            <p class="order-id">${orderGroup.orderId}</p>
            <h3>${orderGroup.customerName}</h3>
            <p class="order-meta">${summaryLine}${orderGroup.customerPhone ? ` · ${orderGroup.customerPhone}` : ""}</p>
          </div>
          <span class="status-chip paid">Paid: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}</span>
        </div>
      `;

      completedList.append(card);
    });
  }

  async function refreshDashboard() {
    setMessage(pendingMsg, "🔄 Loading orders...");
    
    console.log("🔄 refreshDashboard() called - fetching latest data from Google Sheets");

    try {
      allOrdersCache = await window.SeemaSheets.fetchOrders();
      console.log(`📊 Loaded ${allOrdersCache.length} total order rows`);
      
      renderStats(allOrdersCache);
      renderPendingOrders(allOrdersCache);
      renderCompletedOrders(allOrdersCache);
      
      console.log("✅ Dashboard fully refreshed and rendered");
    } catch (error) {
      console.error("❌ Dashboard refresh failed:", error);
      setMessage(pendingMsg, error.message || "Could not load dashboard.", true);
    }
  }

  // ============================================================================
  // DEBUG HELPERS - Available as window.SeemaDebug.* in console
  // ============================================================================

  window.SeemaDebug = {
    checkOrderStatus(orderId) {
      const rows = allOrdersCache.filter(
        r => String(r.orderId || "").trim().toUpperCase() === String(orderId || "").trim().toUpperCase()
      );
      
      if (!rows.length) {
        console.error(`❌ Order ${orderId} not found in cache`);
        return;
      }

      console.group(`📋 Order Status Check: ${orderId}`);
      console.log(`Total rows: ${rows.length}`);
      
      const statuses = rows.map(r => r.orderStatus);
      const uniqueStatuses = [...new Set(statuses)];
      
      console.log("Rows:");
      rows.forEach((r, i) => {
        console.log(`  [Row ${i + 1}] ${r.orderType} - Status: "${r.orderStatus}" - Amount: ${r.amount}`);
      });
      
      if (uniqueStatuses.length > 1) {
        console.warn(`⚠️ MISMATCH DETECTED: Statuses are: ${uniqueStatuses.join(", ")}`);
        console.log("Run this command to refresh and check again:");
        console.log(`    window.SeemaDebug.forceRefresh("${orderId}")`);
      } else {
        console.log(`✅ All rows have matching status: "${uniqueStatuses[0]}"`);
      }
      
      console.groupEnd();
    },

    async forceRefresh(orderId) {
      console.log(`🔄 Refreshing dashboard to get latest data...`);
      await refreshDashboard();
      
      const rows = allOrdersCache.filter(
        r => String(r.orderId || "").trim().toUpperCase() === String(orderId || "").trim().toUpperCase()
      );
      
      if (!rows.length) {
        console.error(`❌ Order ${orderId} not found after refresh`);
        return;
      }
      
      const statuses = [...new Set(rows.map(r => r.orderStatus))];
      if (statuses.length === 1) {
        console.log(`✅ Order is now synced! Status: "${statuses[0]}"`);
      } else {
        console.error(`❌ Still has mismatched statuses:`, statuses);
        rows.forEach((r, i) => {
          console.log(`  [Row ${i + 1}] ${r.orderType} - Status: "${r.orderStatus}"`);
        });
      }
    }
  };

  // ============================================================================
  // FORM LOGIC
  // ============================================================================

  function createItemRow(index) {
    const row = document.createElement("div");
    row.className = "item-row";

    row.innerHTML = `
      <select class="orderTypeSelect">
        <option value="">Select Item</option>
        <option value="Blouse">Blouse</option>
        <option value="Suit">Suit</option>
        <option value="Saree">Saree</option>
        <option value="Lehenga">Lehenga</option>
        <option value="Kurti">Kurti</option>
        <option value="Salwar">Salwar</option>
      </select>
      <input type="text" class="customItem" placeholder="Or type custom item">
      <input type="number" class="quantity" min="1" value="1" placeholder="Qty">
      <input type="number" class="amount" min="0" placeholder="Amount (₹)">
      <button type="button" class="removeItemBtn">✕</button>
    `;

    const removeBtn = row.querySelector(".removeItemBtn");
    removeBtn.addEventListener("click", () => row.remove());

    return row;
  }

  function renderItemsList() {
    const itemsList = document.getElementById("itemsList");
    if (itemsList.children.length === 0) {
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

    // Validate customer info
    if (!customerName || !customerPhone || !dueDate) {
      setMessage(addMsg, "Fill customer info and due date.", true);
      return;
    }

    // Collect items
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
      // Fetch latest orders to get next ID
      if (!allOrdersCache.length) {
        allOrdersCache = await window.SeemaSheets.fetchOrders();
      }

      const orderId = window.SeemaSheets.nextOrderId(allOrdersCache);
      const itemDescriptions = [];

      // Add each item with same Order ID
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await window.SeemaSheets.addOrder({
          orderId,
          customerName,
          customerPhone,
          phone: customerPhone,
          orderType: item.itemName,
          amount: item.total,
          dueDate,
          orderStatus: "Ordered",
          notes: item.quantity > 1 ? `Qty: ${item.quantity}` : ""
        });
        itemDescriptions.push(`${item.itemName} (Qty: ${item.quantity}, ₹${item.amount})`);
      }

      addOrderForm.reset();
      renderItemsList();
      setMessage(addMsg, `Order #${orderId} created with ${items.length} item${items.length > 1 ? "s" : ""}: ${itemDescriptions.join(" + ")}`);
      
      // Refresh after a short delay
      setTimeout(() => refreshDashboard(), 500);
    } catch (error) {
      setMessage(addMsg, error.message || "Failed to save order.", true);
    }
  }

  // ============================================================================
  // EXPORT & PIN MANAGEMENT
  // ============================================================================

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  async function exportCsv() {
    try {
      if (!allOrdersCache.length) {
        allOrdersCache = await window.SeemaSheets.fetchOrders();
      }

      const grouped = groupOrdersByIdWithTotals(allOrdersCache);
      const rows = [
        ["Order ID", "Customer Name", "Phone", "Items", "Total Amount", "Amount Paid", "Balance Due", "Order Date", "Due Date", "Status", "Payment Status"]
      ];

      grouped.forEach((orderGroup) => {
        const itemsText = orderGroup.items.map(i => i.orderType).join(" + ");
        rows.push([
          orderGroup.orderId,
          orderGroup.customerName,
          orderGroup.customerPhone,
          itemsText,
          orderGroup.totalAmount,
          orderGroup.totalAmountPaid,
          orderGroup.totalBalanceDue,
          orderGroup.orderDate,
          orderGroup.dueDate,
          orderGroup.orderStatus,
          orderGroup.paymentStatus
        ]);
      });

      const csvContent = rows.map(row => row.map(csvCell).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seema-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(pendingMsg, error.message || "Failed to export CSV.", true);
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

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

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
