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
    element.innerHTML = text;
    element.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function paymentStatusLabel(status) {
    const value = String(status || "").trim().toLowerCase();
    if (value === "paid") return { text: "Paid <span class='badge-hi'>/ पैसे मिल गए</span>", className: "paid" };
    if (value === "partially paid" || value === "partial") {
      return { text: "Partial <span class='badge-hi'>/ थोड़े पैसे मिले</span>", className: "partial" };
    }
    return { text: "Unpaid <span class='badge-hi'>/ बाकी पेमेंट</span>", className: "unpaid" };
  }

  // ============================================================================
  // SPEECH RECOGNITION (🎤 AUDIO INPUT) UTILITY
  // ============================================================================

  const numberWordsMap = {
    // English words
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    // Hindi words
    "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4",
    "पांच": "5", "पाँच": "5", "छह": "6", "छः": "6", "सात": "7", "आठ": "8", "नौ": "9",
    // Hinglish words
    "shunya": "0", "ek": "1", "do": "2", "teen": "3", "char": "4", "chaar": "4",
    "panch": "5", "paanch": "5", "chhe": "6", "che": "6", "chhah": "6", "saat": "7", "aath": "8", "nau": "9"
  };

  function parseSpokenPhoneNumber(text) {
    let cleaned = String(text || "").toLowerCase();
    
    // Replace spoken word digits
    Object.keys(numberWordsMap).forEach((word) => {
      const isEnglish = /^[a-z]+$/i.test(word);
      const pattern = isEnglish ? `\\b${word}\\b` : word;
      const reg = new RegExp(pattern, "g");
      cleaned = cleaned.replace(reg, numberWordsMap[word]);
    });
    
    // Strip non-digits and limit to 10
    return cleaned.replace(/\D/g, "").slice(-10);
  }

  function setupSpeechInput(inputElement, micButtonElement, isPhoneNumber = false) {
    if (!inputElement || !micButtonElement) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micButtonElement.style.display = "none"; // Hide button if Speech Recognition is not supported
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "hi-IN"; // Hindi voice recognition fits both Hindi and English accents perfectly

    let isListening = false;

    micButtonElement.addEventListener("click", () => {
      if (isListening) {
        recognition.stop();
      } else {
        try {
          recognition.start();
        } catch (err) {
          console.warn("Speech recognition already started:", err);
        }
      }
    });

    recognition.onstart = () => {
      isListening = true;
      micButtonElement.classList.add("listening");
      micButtonElement.title = "Listening... Speak now!";
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (isPhoneNumber) {
        inputElement.value = parseSpokenPhoneNumber(transcript);
      } else {
        // Capitalize names / items slightly for a clean look
        inputElement.value = String(transcript || "").trim().replace(/^\w/, (c) => c.toUpperCase());
      }
      
      // Trigger native input event so other listeners notice the change
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
      isListening = false;
      micButtonElement.classList.remove("listening");
      micButtonElement.title = "Speak to input";
    };
  }

  // ============================================================================
  // INTELLIGENT AI VOICE ORDER ASSISTANT LOGIC
  // ============================================================================

  const wordToDigits = {
    // English
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "first": 1, "second": 2, "third": 3, "single": 1, "double": 2,
    // Hindi
    "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
    // Hinglish
    "shunya": 0, "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "panch": 5, "paanch": 5, "chhe": 6, "che": 6, "chhah": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10
  };

  const numberMultipliers = {
    "hundred": 100, "thousand": 1000,
    "सौ": 100, "हजार": 1000, "हज़ार": 1000
  };

  function parseIntelligentVoiceOrder(text) {
    const raw = String(text || "").toLowerCase();
    console.log("🎙️ AI Parser - Raw Spoken Text:", raw);

    // 1. NORMALIZE TEXT & EXPAND DOUBLE/TRIPLE
    let normalized = raw.trim();

    // Expand double/triple spoken digits (e.g. "double nine" -> "9 9", "डबल 9" -> "9 9")
    const doubleTripleRegex = /(?:double|triple|डबल|ट्रिपल)\s+(zero|one|two|three|four|five|six|seven|eight|nine|शून्य|एक|दो|तीन|चार|पांच|पाँच|छह|छः|सात|आठ|नौ|\d)/gi;
    normalized = normalized.replace(doubleTripleRegex, (match, val) => {
      const isDouble = match.toLowerCase().startsWith("double") || match.startsWith("डबल");
      const count = isDouble ? 2 : 3;
      let digit = val;
      if (numberWordsMap[val.toLowerCase()]) {
        digit = numberWordsMap[val.toLowerCase()];
      }
      return (digit + " ").repeat(count).trim();
    });

    // Replace all digit words with digit characters
    Object.keys(numberWordsMap).forEach((word) => {
      const isEnglish = /^[a-z]+$/i.test(word);
      const pattern = isEnglish ? `\\b${word}\\b` : word;
      const reg = new RegExp(pattern, "g");
      normalized = normalized.replace(reg, numberWordsMap[word]);
    });

    console.log("🎙️ AI Parser - Digitized Text:", normalized);

    // 2. EXTRACT & REMOVE PHONE NUMBER (Avoids digits mixing with quantities/prices)
    let phone = "";
    // Match a phone number: 10 to 12 digits, optionally separated by spaces, dashes, or parentheses.
    // Optionally preceded by country code (+91 or 91)
    const phoneRegex = /(?:\+?91[\s\(\)-]*)?(?:\d[\s\(\)-]*){10,12}/g;
    const phoneMatch = normalized.match(phoneRegex);
    if (phoneMatch) {
      for (const m of phoneMatch) {
        const digits = m.replace(/\D/g, "");
        if (digits.length >= 10) {
          phone = digits.slice(-10);
          normalized = normalized.replace(m, " ");
          break;
        }
      }
    }

    // Clean up remaining phone-related prefix labels
    const phoneLabelRegex = /(?:phone|mobile|number|foni?|फोन|मोबाइल|नंबर|नम्बर)\s*/gi;
    normalized = normalized.replace(phoneLabelRegex, " ");

    console.log("🎙️ AI Parser - Cleaned Text (Phone Removed):", normalized);

    // 3. CUSTOMER NAME
    let name = "";
    const nameText = normalized.replace(/[,.]/g, " ");
    
    // Hindi/Hinglish patterns
    const hiNameMatch = nameText.match(/\b([a-z\u0900-\u097F]+)\s+(?:ke\s+liye|के\s+लिए|ka\s+order|का\s+ऑर्डर|ki\s+silai|की\s+सिलाई)\b/i);
    // English patterns
    const enNameMatch = nameText.match(/\b(?:for|to|customer|order\s+of|order\s+for|ऑर्डर\s+फॉर)\s+([a-z\u0900-\u097F]+)\b/i);
    // Possessive patterns (e.g. pooja's order)
    const possessiveMatch = nameText.match(/\b([a-z\u0900-\u097F]+)'s\s+(?:order|clothes|garments)\b/i);

    if (hiNameMatch) {
      name = hiNameMatch[1];
    } else if (enNameMatch) {
      name = enNameMatch[1];
    } else if (possessiveMatch) {
      name = possessiveMatch[1];
    } else {
      // Check for name followed by "ko" or "को"
      const koMatch = nameText.match(/\b([a-z\u0900-\u097F]+)\s+(?:ko|को)\b/i);
      if (koMatch) {
        name = koMatch[1];
      }
    }

    if (name) {
      const forbiddenNames = ["phone", "mobile", "number", "due", "date", "order", "sau", "hazar", "rs", "rupees", "rupaye", "blouse", "suit", "saree", "lehenga", "kurti", "salwar", "ek", "do", "teen", "char", "panch", "chhe", "saat", "aath", "nau", "das"];
      if (forbiddenNames.includes(name.toLowerCase())) {
        name = "";
      } else {
        name = name.trim().replace(/^\w/, (c) => c.toUpperCase());
      }
    }

    // 4. DUE DATE
    let dueDate = "";
    const today = new Date();

    if (normalized.includes("today") || normalized.includes("आज") || normalized.includes("aaj")) {
      dueDate = today.toISOString().slice(0, 10);
    } else if (normalized.includes("tomorrow") || normalized.includes("कल") || normalized.includes("kal")) {
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      dueDate = tomorrow.toISOString().slice(0, 10);
    } else if (normalized.includes("day after tomorrow") || normalized.includes("परसों") || normalized.includes("parso") || normalized.includes("parson")) {
      const dayAfter = new Date();
      dayAfter.setDate(today.getDate() + 2);
      dueDate = dayAfter.toISOString().slice(0, 10);
    } else {
      // Look for "[number] days" or "[number] din" or "[number] day"
      const daysMatch = normalized.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)\s*(?:days?|din|दिन|day)/i);
      if (daysMatch) {
        const daysWord = daysMatch[1];
        const daysNum = wordToDigits[daysWord] || Number(daysWord) || 0;
        if (daysNum > 0) {
          const offsetDate = new Date();
          offsetDate.setDate(today.getDate() + daysNum);
          dueDate = offsetDate.toISOString().slice(0, 10);
        }
      } else {
        const hiWeekdays = {
          "सोमवार": 1, "सोम": 1, "मंगलवार": 2, "मंगल": 2, "बुधवार": 3, "बुध": 3, "गुरुवार": 4, "गुरु": 4, "वीरवार": 4, "शुक्रवार": 5, "शुक्र": 5, "शनिवार": 6, "शनि": 6, "रविवार": 0, "रवि": 0
        };
        const enWeekdays = {
          "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "sunday": 0,
          "somvar": 1, "mangalvar": 2, "budhvar": 3, "guruvar": 4, "shukravar": 5, "shanivar": 6, "ravivar": 0
        };
        
        let weekdayIndex = -1;
        
        Object.keys(enWeekdays).forEach(day => {
          if (normalized.includes(day)) weekdayIndex = enWeekdays[day];
        });
        Object.keys(hiWeekdays).forEach(day => {
          if (normalized.includes(day)) weekdayIndex = hiWeekdays[day];
        });

        if (weekdayIndex !== -1) {
          const nextWeekday = new Date();
          const currentDay = nextWeekday.getDay();
          let distance = weekdayIndex - currentDay;
          if (distance <= 0) distance += 7;
          nextWeekday.setDate(today.getDate() + distance);
          dueDate = nextWeekday.toISOString().slice(0, 10);
        }
      }
    }

    // 5. GARMENT-ANCHORED VICINITY PARSING
    const garmentsMap = {
      blouse: "Blouse", "ब्लाउज": "Blouse", "ब्लाउज़": "Blouse",
      suit: "Suit", "सूट": "Suit",
      saree: "Saree", "साड़ी": "Saree", "साड़ी": "Saree",
      lehenga: "Lehenga", "लहंगा": "Lehenga",
      kurti: "Kurti", "कुर्ती": "Kurti",
      salwar: "Salwar", "सलवार": "Salwar"
    };

    // Find all keyword occurrences in the text
    const occurrences = [];
    Object.keys(garmentsMap).forEach((keyword) => {
      let idx = normalized.indexOf(keyword);
      while (idx !== -1) {
        occurrences.push({
          keyword,
          canonicalName: garmentsMap[keyword],
          index: idx,
          endIndex: idx + keyword.length
        });
        idx = normalized.indexOf(keyword, idx + 1);
      }
    });

    // Sort by occurrence starting index
    occurrences.sort((a, b) => a.index - b.index);

    const foundItems = [];

    occurrences.forEach((occ, i) => {
      const prevEnd = i > 0 ? occurrences[i - 1].endIndex : 0;
      const nextStart = i < occurrences.length - 1 ? occurrences[i + 1].index : normalized.length;

      // Extract left and right context blocks
      const leftContext = normalized.substring(prevEnd, occ.index);
      const rightContext = normalized.substring(occ.endIndex, nextStart);

      // --- PARSE QUANTITY ---
      let quantity = 1;

      // Check left context for immediate quantity (with up to 2 intervening adjectives)
      const leftQtyMatch = leftContext.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)\s*(?:[a-z\u0900-\u097F]+\s+){0,2}$/i);
      if (leftQtyMatch) {
        const val = leftQtyMatch[1].toLowerCase();
        quantity = wordToDigits[val] || Number(val) || 1;
      } else {
        // Fallback: search for any number in the entire left context block
        const allLeftNums = leftContext.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)\b/g);
        if (allLeftNums && allLeftNums.length > 0) {
          const val = allLeftNums[allLeftNums.length - 1].toLowerCase();
          quantity = wordToDigits[val] || Number(val) || 1;
        } else {
          // Check right context for things like "blouse 2 piece"
          const rightQtyMatch = rightContext.match(/^\s*(?:[a-z\u0900-\u097F]+\s+){0,1}(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)\s*(?:piece|pcs|pieces|नग|पीस)/i);
          if (rightQtyMatch) {
            const val = rightQtyMatch[1].toLowerCase();
            quantity = wordToDigits[val] || Number(val) || 1;
          }
        }
      }

      // --- PARSE PRICE/AMOUNT ---
      let amount = 0;

      // Inner helper to extract price from a context block
      function extractPriceFromBlock(context) {
        let resolved = context;
        // Resolve multiplier words (e.g. "3 sau" -> "300")
        const multiplierRegex = /(\d+)\s*(?:sau|hundred|सौ|hazar|hazaar|thousand|हजार|हज़ार)/gi;
        let multMatch;
        while ((multMatch = multiplierRegex.exec(context)) !== null) {
          const baseNum = Number(multMatch[1]);
          const multWord = multMatch[0].replace(String(baseNum), "").trim().toLowerCase();
          
          let multiplier = 1;
          if (multWord.includes("hundred") || multWord.includes("sau") || multWord.includes("सौ")) {
            multiplier = 100;
          } else if (multWord.includes("thousand") || multWord.includes("hazar") || multWord.includes("hazaar") || multWord.includes("हजार") || multWord.includes("हज़ार")) {
            multiplier = 1000;
          }
          resolved = resolved.replace(multMatch[0], String(baseNum * multiplier));
        }

        // Search with explicit currency labels
        const priceRegex = /(?:rs|amount|price|₹|rupees|rupaye|rupya|रुपये|रुपया)\s*(\d+)|(\d+)\s*(?:rs|₹|rupees|rupaye|rupya|रुपये|रुपया)/gi;
        let match;
        const prices = [];
        while ((match = priceRegex.exec(resolved)) !== null) {
          const val = match[1] || match[2];
          if (val) prices.push(Number(val));
        }

        if (prices.length > 0) return prices[0];

        // Fallback: search for any 3 to 4 digit number in the block (excluding year 2026)
        const genericPriceRegex = /\b(\d{3,4})\b/g;
        let genMatch;
        while ((genMatch = genericPriceRegex.exec(resolved)) !== null) {
          const val = Number(genMatch[1]);
          if (val !== 2026) return val;
        }
        return 0;
      }

      // Read price from right context first
      amount = extractPriceFromBlock(rightContext);
      // Fallback to left context if right context has no price
      if (amount === 0) {
        amount = extractPriceFromBlock(leftContext);
      }

      foundItems.push({
        itemName: occ.canonicalName,
        quantity,
        amount
      });
    });

    // Final fallback: if no items detected but there is a price in the text, assume Custom Item
    if (!foundItems.length) {
      let resolved = normalized;
      const multiplierRegex = /(\d+)\s*(?:sau|hundred|सौ|hazar|hazaar|thousand|हजार|हज़ार)/gi;
      let multMatch;
      while ((multMatch = multiplierRegex.exec(normalized)) !== null) {
        const baseNum = Number(multMatch[1]);
        const multWord = multMatch[0].replace(String(baseNum), "").trim().toLowerCase();
        let multiplier = 1;
        if (multWord.includes("hundred") || multWord.includes("sau") || multWord.includes("सौ")) {
          multiplier = 100;
        } else if (multWord.includes("thousand") || multWord.includes("hazar") || multWord.includes("hazaar") || multWord.includes("हजार") || multWord.includes("हज़ार")) {
          multiplier = 1000;
        }
        resolved = resolved.replace(multMatch[0], String(baseNum * multiplier));
      }

      const genericPriceRegex = /\b(\d{3,4})\b/g;
      let genMatch;
      let backupPrice = 0;
      while ((genMatch = genericPriceRegex.exec(resolved)) !== null) {
        const val = Number(genMatch[1]);
        if (val !== 2026) {
          backupPrice = val;
          break;
        }
      }

      if (backupPrice > 0) {
        foundItems.push({
          itemName: "Custom Item",
          quantity: 1,
          amount: backupPrice
        });
      }
    }

    return {
      name,
      phone,
      dueDate,
      items: foundItems
    };
  }

  function fillFormWithParsedOrder(parsedData) {
    if (!parsedData) return;

    const nameInput = document.getElementById("custName");
    const phoneInput = document.getElementById("custPhone");
    const dueDateInput = document.getElementById("dueDate");

    // Set customer fields
    if (parsedData.name) nameInput.value = parsedData.name;
    if (parsedData.phone) phoneInput.value = parsedData.phone;
    if (parsedData.dueDate) dueDateInput.value = parsedData.dueDate;

    // Set items in dynamic items stack
    if (parsedData.items && parsedData.items.length > 0) {
      const itemsList = document.getElementById("itemsList");
      itemsList.innerHTML = ""; // Clear existing rows

      parsedData.items.forEach((item, index) => {
        const row = createItemRow(index);
        
        const typeSelect = row.querySelector(".orderTypeSelect");
        const customInput = row.querySelector(".customItem");
        const qtyInput = row.querySelector(".quantity");
        const amountInput = row.querySelector(".amount");

        // Match option dropdown or write to custom textbox
        const hasOption = typeSelect.querySelector(`option[value="${item.itemName}"]`);
        if (hasOption) {
          typeSelect.value = item.itemName;
        } else {
          typeSelect.value = "";
          customInput.value = item.itemName;
        }

        qtyInput.value = item.quantity;
        amountInput.value = item.amount;

        itemsList.append(row);
      });
    }
  }

  function setupIntelligentVoiceAssistant() {
    const assistantBtn = document.getElementById("assistantMicBtn");
    const statusText = document.getElementById("assistantStatusText");

    if (!assistantBtn || !statusText) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      assistantBtn.style.display = "none";
      statusText.textContent = "AI Intelligent Voice Order Assistant is not supported in this browser.";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "hi-IN"; // hindi-english dictation

    let isListening = false;

    assistantBtn.addEventListener("click", () => {
      if (isListening) {
        recognition.stop();
      } else {
        try {
          recognition.start();
        } catch (err) {
          console.warn("Intelligent voice assistant speech already started:", err);
        }
      }
    });

    recognition.onstart = () => {
      isListening = true;
      assistantBtn.classList.add("listening");
      statusText.textContent = "🎙️ Listening... Dictate your full order now!";
      statusText.style.color = "var(--danger)";
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      statusText.textContent = "✅ Processing order details...";
      statusText.style.color = "var(--success)";

      try {
        const parsedData = parseIntelligentVoiceOrder(transcript);
        console.log("🎙️ AI Parsed Data Result:", parsedData);
        
        fillFormWithParsedOrder(parsedData);

        const summary = [];
        if (parsedData.name) summary.push(`Name: ${parsedData.name}`);
        if (parsedData.phone) summary.push(`Phone: ${parsedData.phone}`);
        if (parsedData.dueDate) summary.push(`Due: ${parsedData.dueDate}`);
        if (parsedData.items.length) {
          summary.push(`Items: ${parsedData.items.map(i => `${i.itemName} (Qty: ${i.quantity}, ₹${i.amount})`).join(" + ")}`);
        }

        statusText.textContent = `🎉 Filled! Found: ${summary.join(" | ")}`;
      } catch (err) {
        console.error("Order parsing failed:", err);
        statusText.textContent = "⚠️ Could not parse order clearly. Try speaking again!";
        statusText.style.color = "var(--danger)";
      }
    };

    recognition.onerror = (event) => {
      console.error("Intelligent voice assistant error:", event.error);
      statusText.textContent = "⚠️ Error listening. Try speaking again.";
      statusText.style.color = "var(--danger)";
    };

    recognition.onend = () => {
      isListening = false;
      assistantBtn.classList.remove("listening");
      if (!statusText.textContent.startsWith("🎉") && !statusText.textContent.startsWith("⚠️")) {
        statusText.textContent = "Tap the microphone to speak a whole order sentence!";
        statusText.style.color = "var(--accent)";
      }
    };
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
    title.textContent = "Choose Message Type / संदेश का प्रकार चुनें";
    title.style.cssText = "margin: 0 0 20px 0; font-size: 18px; color: #333;";

    const description = document.createElement("p");
    description.textContent = `Which message would you like to send for ${orderGroup.orderId}? / आप ${orderGroup.orderId} के लिए कौन सा मैसेज भेजना चाहते हैं?`;
    description.style.cssText = "margin: 0 0 25px 0; color: #666; font-size: 14px;";

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = "display: flex; gap: 12px; justify-content: space-between;";

    const orderReadyBtn = document.createElement("button");
    orderReadyBtn.innerHTML = `<div style="font-size: 24px; margin-bottom: 8px;">📸</div><strong>Order Ready <span class="btn-hi">/ ऑर्डर तैयार है</span></strong><div style="font-size: 12px; color: #666; margin-top: 4px;">Focus on completion / काम पूरा हो गया</div>`;
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
    paymentBtn.innerHTML = `<div style="font-size: 24px; margin-bottom: 8px;">💰</div><strong>Payment Reminder <span class="btn-hi">/ पेमेंट याद दिलाएं</span></strong><div style="font-size: 12px; color: #666; margin-top: 4px;">Focus on payment / पैसे याद दिलाएं</div>`;
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
  // AUTOMATED DIGITAL RECEIPT IMAGE GENERATION & EXPORT
  // ============================================================================

  async function generateReceiptImage(orderGroup, redirect = true) {
    console.log("📸 Generating receipt image for:", orderGroup.orderId);

    // 1. Populate metadata
    const rOrderIdEl = document.getElementById("rOrderId");
    if (rOrderIdEl) rOrderIdEl.textContent = orderGroup.orderId;
    const rDateEl = document.getElementById("rDate");
    if (rDateEl) rDateEl.textContent = window.SeemaSheets.formatDate(orderGroup.orderDate || new Date().toISOString());
    const rCustNameEl = document.getElementById("rCustName");
    if (rCustNameEl) rCustNameEl.textContent = orderGroup.customerName;
    const rPhoneEl = document.getElementById("rPhone");
    if (rPhoneEl) rPhoneEl.textContent = orderGroup.customerPhone || "-";
    
    // Populate Order Status dynamically
    const statusMap = {
      "Ordered": "Order Placed / नया ऑर्डर",
      "Order Placed": "Order Placed / नया ऑर्डर",
      "Cutting": "Cutting / कपड़े कटिंग जारी",
      "In Progress": "In Progress / सिलाई जारी है",
      "Completed": "Completed / तैयार है",
      "Ready": "Ready / तैयार है",
      "Delivered": "Delivered / दे दिया"
    };
    const rStatusEl = document.getElementById("rStatus");
    if (rStatusEl) {
      const statusValue = orderGroup.orderStatus || "Ordered";
      rStatusEl.textContent = statusMap[statusValue] || statusValue;
    }

    // 2. Populate items list table
    const tbody = document.getElementById("rItemsBody");
    if (tbody) {
      tbody.innerHTML = "";

      orderGroup.items.forEach((item) => {
        const tr = document.createElement("tr");
        const qtyText = item.notes && item.notes.includes("Qty:") ? item.notes.replace("Qty:", "").trim() : "1";
        tr.innerHTML = `
          <td align="left" style="padding: 8px 0; border-bottom: 1px dashed rgba(123, 77, 43, 0.1);">${item.orderType}</td>
          <td align="center" style="padding: 8px 0; border-bottom: 1px dashed rgba(123, 77, 43, 0.1);">${qtyText}</td>
          <td align="right" style="padding: 8px 0; border-bottom: 1px dashed rgba(123, 77, 43, 0.1);">${window.SeemaSheets.formatAmount(item.amount)}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // 3. Populate totals
    const rTotalAmountEl = document.getElementById("rTotalAmount");
    if (rTotalAmountEl) rTotalAmountEl.textContent = window.SeemaSheets.formatAmount(orderGroup.totalAmount);
    const rPaidAmountEl = document.getElementById("rPaidAmount");
    if (rPaidAmountEl) rPaidAmountEl.textContent = window.SeemaSheets.formatAmount(orderGroup.totalAmountPaid);
    const rBalanceDueEl = document.getElementById("rBalanceDue");
    if (rBalanceDueEl) rBalanceDueEl.textContent = window.SeemaSheets.formatAmount(orderGroup.totalBalanceDue);

    // 4. QR Code & UPI ID
    const upiId = getCurrentUpi();
    const rUpiIdEl = document.getElementById("rUpiId");
    if (rUpiIdEl) rUpiIdEl.textContent = upiId;

    // Dynamic QR URL using QRServer API
    const qrParams = new URLSearchParams({
      pa: upiId,
      pn: "Seema Silai Centre",
      am: String(orderGroup.totalBalanceDue),
      cu: "INR",
      tn: `Order ${orderGroup.orderId}`
    });
    const qrUrlString = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`upi://pay?${qrParams.toString()}`)}`;

    const qrImg = document.getElementById("rQrImage");
    qrImg.src = qrUrlString;

    // Wait for the QR code image to fully load before capturing
    await new Promise((resolve) => {
      qrImg.onload = () => resolve();
      qrImg.onerror = () => resolve();
      setTimeout(resolve, 1500); // safety fallback
    });

    // 5. Render to Canvas using html2canvas
    const template = document.getElementById("receiptCaptureTemplate");

    // Call html2canvas
    const canvas = await html2canvas(template, {
      scale: 2, // high-res crisp canvas
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true
    });

    // 6. Convert canvas to PNG blob
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not create receipt image.");

    // 7. Trigger dynamic download to device
    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = `receipt-${orderGroup.orderId}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    // 8. Attempt Copy Image to Clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob
          })
        ]);
        console.log("📋 Receipt image copied to clipboard successfully!");
      }
    } catch (clipErr) {
      console.warn("Could not copy receipt image to clipboard:", clipErr);
    }

    // 9. Redirect to WhatsApp chat
    if (redirect) {
      const phone = String(orderGroup.customerPhone || "").replace(/\D/g, "");
      if (phone) {
        const whatsappUrl = `https://wa.me/91${phone}`;
        window.open(whatsappUrl, "_blank");
      }
    }
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
      createButton("Mark Paid <span class=\"btn-hi\">/ पैसे मिल गए</span>", "btn btn-primary btn-compact", async () => {
        try {
          setMessage(pendingMsg, "Marking as paid... / पेमेंट दर्ज हो रहा है...");
          await window.SeemaSheets.updatePaymentStatus(
            orderGroup.orderId,
            "Paid",
            orderGroup.totalAmount,
            ""
          );
          setMessage(pendingMsg, `Order ${orderGroup.orderId} marked as paid / पैसे मिल गए!`);
          await refreshDashboard();
        } catch (error) {
          setMessage(pendingMsg, `Failed to update payment / पेमेंट फेल: ${error.message || ""}`, true);
        }
      })
    );

    // Partial payment button
    actions.append(
      createButton("Partial <span class=\"btn-hi\">/ थोड़े पैसे मिले</span>", "btn btn-secondary btn-compact", async () => {
        const input = window.prompt("Enter amount received / मिले हुए पैसे दर्ज करें:", String(orderGroup.totalAmountPaid || 0));
        if (input === null) return;

        const amountPaid = Number(input);
        if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > orderGroup.totalAmount) {
          setMessage(pendingMsg, "Enter a valid amount / सही राशि दर्ज करें।", true);
          return;
        }

        try {
          const status = amountPaid >= orderGroup.totalAmount ? "Paid" : "Partially Paid";
          await window.SeemaSheets.updatePaymentStatus(orderGroup.orderId, status, amountPaid, "");
          await refreshDashboard();
        } catch (error) {
          setMessage(pendingMsg, `Failed to update payment / पेमेंट फेल: ${error.message || ""}`, true);
        }
      })
    );

    // Reminder buttons
    const reminderSection = document.createElement("div");
    reminderSection.className = "reminder-section";

    reminderSection.append(
      createButton("Reminder <span class=\"btn-hi\">/ रिमाइंडर</span>", "btn btn-ghost btn-compact", async () => {
        showMessageTypeDialog(orderGroup, async (messageType) => {
          try {
            const text = getReminderText(orderGroup, messageType);
            await navigator.clipboard.writeText(text);
            setMessage(pendingMsg, `Reminder copied for ${orderGroup.orderId} / रिमाइंडर कॉपी हो गया।`);
          } catch (error) {
            setMessage(pendingMsg, `Could not copy / कॉपी नहीं हुआ: ${error.message || ""}`, true);
          }
        });
      })
    );

    const whatsappBtn = document.createElement("button");
    whatsappBtn.type = "button";
    whatsappBtn.className = "btn btn-whatsapp btn-compact";
    whatsappBtn.title = "Send Receipt via WhatsApp / व्हाट्सएप पर रसीद भेजें";
    whatsappBtn.innerHTML = "📱 Send Receipt <span class=\"btn-hi\">/ रसीद भेजें</span>";
    whatsappBtn.addEventListener("click", async () => {
      try {
        setMessage(pendingMsg, "🔄 Generating receipt image... / रसीद तैयार हो रही है...");
        await generateReceiptImage(orderGroup, true);
        setMessage(pendingMsg, `✅ Receipt copied to clipboard! Paste (Ctrl+V) in WhatsApp. / रसीद कॉपी हो गई है! व्हाट्सएप पर पेस्ट करें।`);
      } catch (err) {
        console.error("Receipt generation failed:", err);
        setMessage(pendingMsg, `⚠️ Error generating receipt / रसीद नहीं बन सकी: ${err.message || ""}`, true);
      }
    });

    reminderSection.append(whatsappBtn);

    // Status dropdown
    const statusSection = document.createElement("div");
    statusSection.className = "status-dropdown-section";
    
    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Status / स्टेटस";
    statusLabel.className = "status-label";
    
    const statusSelect = document.createElement("select");
    statusSelect.className = "status-select";

    const statuses = [
      { val: "Ordered", text: "Ordered / नया ऑर्डर" },
      { val: "In Progress", text: "In Progress / सिलाई जारी है" },
      { val: "Completed", text: "Completed / तैयार है" },
      { val: "Delivered", text: "Delivered / दे दिया" }
    ];
    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status.val;
      option.textContent = status.text;
      statusSelect.append(option);
    });

    // Set value AFTER all options are added
    statusSelect.value = orderGroup.orderStatus;

    statusSelect.addEventListener("change", async () => {
      const newStatus = statusSelect.value;
      const previousStatus = orderGroup.orderStatus;
      
      try {
        setMessage(pendingMsg, `⏳ Updating ${orderGroup.orderId} to ${newStatus}... / स्टेटस बदला जा रहा है...`);
        
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
        
        setMessage(pendingMsg, `✅ Updated ${orderGroup.orderId}. Refreshing... / स्टेटस बदल गया है, रिफ्रेश हो रहा है...`);
        
        // Wait to ensure Google Sheets write completes
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Refresh dashboard (this will re-fetch and re-render all cards)
        await refreshDashboard();
        
        console.log(`✅ Dashboard refreshed after status update to ${newStatus}`);
        setMessage(pendingMsg, `✅ ${orderGroup.orderId} is now ${newStatus}! / स्टेटस बदल गया है!`);
      } catch (error) {
        console.error("❌ Status update failed:", error);
        setMessage(pendingMsg, `⚠️ Failed / फेल: ${error.message || "Could not update status."}`, true);
        
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

    const deleteBtn = createButton("🗑️ Delete Order <span class=\"btn-hi\">/ ऑर्डर डिलीट करें</span>", "btn btn-danger btn-compact", async () => {
      const confirmed = confirm(`⚠️ Delete order ${orderGroup.orderId} and ALL its items? This cannot be undone!\n\n⚠️ क्या आप ऑर्डर ${orderGroup.orderId} और उसके सभी सामान डिलीट करना चाहते हैं? यह वापस नहीं हो सकता!`);
      if (!confirmed) return;

      try {
        setMessage(pendingMsg, `🗑️ Deleting ${orderGroup.orderId}... / डिलीट हो रहा है...`);
        await window.SeemaSheets.deleteOrder(orderGroup.orderId);
        setMessage(pendingMsg, `✅ Order ${orderGroup.orderId} deleted successfully! / ऑर्डर डिलीट हो गया!`);
        
        // Refresh dashboard after deletion
        await new Promise(resolve => setTimeout(resolve, 800));
        await refreshDashboard();
      } catch (error) {
        console.error("❌ Delete failed:", error);
        setMessage(pendingMsg, `⚠️ Failed to delete / डिलीट नहीं हुआ: ${error.message || "Unknown error"}`, true);
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
    button.innerHTML = label;
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
      setMessage(pendingMsg, "No pending payments. / कोई बाकी पेमेंट नहीं है।");
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
      setMessage(completedMsg, "No completed orders yet. / कोई पूरा ऑर्डर नहीं मिला।");
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
        `Total / कुल: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}`,
        `Paid / तारीख: ${window.SeemaSheets.formatDate(orderGroup.orderDate)}`
      ].join(" · ");

      card.innerHTML = `
        <div class="order-top">
          <div>
            <p class="order-id">${orderGroup.orderId}</p>
            <h3>${orderGroup.customerName}</h3>
            <p class="order-meta">${summaryLine}${orderGroup.customerPhone ? ` · ${orderGroup.customerPhone}` : ""}</p>
          </div>
          <span class="status-chip paid">Paid <span class="badge-hi">/ पूरे पैसे मिले</span>: ${window.SeemaSheets.formatAmount(orderGroup.totalAmount)}</span>
        </div>
      `;

      completedList.append(card);
    });
  }

  async function refreshDashboard() {
    setMessage(pendingMsg, "🔄 Loading orders... / ऑर्डर्स लोड हो रहे हैं...");
    
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
      setMessage(pendingMsg, error.message || "Could not load dashboard / डैशबोर्ड लोड नहीं हो सका।", true);
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
        <option value="">Select Item / सामान चुनें</option>
        <option value="Blouse">Blouse / ब्लाउज</option>
        <option value="Suit">Suit / सूट</option>
        <option value="Saree">Saree / साड़ी</option>
        <option value="Lehenga">Lehenga / लहंगा</option>
        <option value="Kurti">Kurti / कुर्ती</option>
        <option value="Salwar">Salwar / सलवार</option>
      </select>
      <div class="input-with-mic">
        <input type="text" class="customItem" placeholder="Or type custom item / या दूसरा सामान लिखें">
        <button type="button" class="btn-mic customItemMic" title="Speak item name (Hindi/English)">🎤</button>
      </div>
      <input type="number" class="quantity" min="1" value="1" placeholder="Qty / मात्रा">
      <input type="number" class="amount" min="0" placeholder="Amount (₹) / रुपये (₹)">
      <button type="button" class="removeItemBtn">✕</button>
    `;

    const removeBtn = row.querySelector(".removeItemBtn");
    removeBtn.addEventListener("click", () => row.remove());

    // Wire up speech input for the dynamic row's custom item input
    const customItemInput = row.querySelector(".customItem");
    const micBtn = row.querySelector(".customItemMic");
    setupSpeechInput(customItemInput, micBtn, false);

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
    setMessage(addMsg, "Saving order... / ऑर्डर सेव हो रहा है...");

    const formData = new FormData(addOrderForm);
    const customerName = String(formData.get("customerName") || "").trim();
    const customerPhone = String(formData.get("customerPhone") || "").trim();
    const dueDate = String(formData.get("dueDate") || "").trim();

    // Validate customer info
    if (!customerName || !customerPhone || !dueDate) {
      setMessage(addMsg, "Fill customer info and due date / कस्टमर का नाम, फ़ोन नंबर और डिलीवरी की तारीख भरें।", true);
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
      setMessage(addMsg, "Add at least one item with amount / कम से कम एक सामान और उसकी रेट दर्ज करें।", true);
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
      setMessage(addMsg, `Order #${orderId} created successfully! / ऑर्डर #${orderId} सफलतापूर्वक सेव हो गया है!`);
      
      // Refresh after a short delay
      setTimeout(() => refreshDashboard(), 500);
    } catch (error) {
      setMessage(addMsg, (error.message || "") + " Failed to save order / ऑर्डर सेव नहीं हो सका।", true);
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
      setMessage(pendingMsg, (error.message || "") + " Failed to export CSV / CSV डाउनलोड नहीं हो सका।", true);
    }
  }

  function unlockAdmin() {
    if (pinInput.value.trim() !== getCurrentPin()) {
      setMessage(pinError, "Incorrect PIN / गलत पिन डाला है।", true);
      return;
    }

    setMessage(pinError, "Unlocked / अनलॉक हो गया!");
    pinOverlay.classList.add("hidden");
    mainContent.classList.remove("hidden");
    refreshDashboard();
  }

  function saveNewPin() {
    const nextPin = newPinInput.value.trim();
    const confirmPin = confirmPinInput.value.trim();

    if (!nextPin || nextPin.length < 4) {
      setMessage(pinChangeMsg, "Enter a PIN with at least 4 digits / कम से कम 4 अंकों का नया पिन डालें।", true);
      return;
    }

    if (nextPin !== confirmPin) {
      setMessage(pinChangeMsg, "PINs do not match / दोनों पिन मेल नहीं खा रहे हैं।", true);
      return;
    }

    localStorage.setItem(pinStorageKey, nextPin);
    setMessage(pinChangeMsg, "PIN updated / पिन बदल गया है।");
    newPinInput.value = "";
    confirmPinInput.value = "";
  }

  function resetPin() {
    localStorage.removeItem(pinStorageKey);
    setMessage(pinChangeMsg, `PIN reset to default / पिन रीसेट हो गया है!`);
    newPinInput.value = "";
    confirmPinInput.value = "";
  }

  function saveUpi() {
    const nextUpi = upiInput.value.trim();

    if (!nextUpi) {
      setMessage(upiMsg, "Enter a UPI ID / UPI आईडी दर्ज करें।", true);
      return;
    }

    localStorage.setItem(upiStorageKey, nextUpi);
    window.SEEMA_CONFIG.UPI_ID = nextUpi;
    setMessage(upiMsg, "UPI saved / UPI आईडी सेव हो गई।");
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

  // Initialize speech recognition for customer info inputs
  setupSpeechInput(document.getElementById("custName"), document.getElementById("custNameMic"), false);
  setupSpeechInput(document.getElementById("custPhone"), document.getElementById("custPhoneMic"), true);

  // Initialize the Single-Mic Intelligent Voice Assistant
  setupIntelligentVoiceAssistant();

  // Expose setLang globally
  window.setLang = function (l) {
    localStorage.setItem("seemaAdminLang", l);
    const bEn = document.getElementById("bEn");
    const bHi = document.getElementById("bHi");
    if (bEn) bEn.classList.toggle("on", l === "en");
    if (bHi) bHi.classList.toggle("on", l === "hi");

    const lbn = document.getElementById("lbn");
    if (lbn) {
      lbn.textContent = l === "en" ? "Merchant admin" : "मर्चेंट एडमिन पोर्टल";
    }

    document.querySelectorAll("[data-en]").forEach((el) => {
      const val = el.getAttribute("data-" + l);
      if (val) el.innerHTML = val;
    });
  };

  // Set default language on page load (defaults to Hindi)
  const defaultLang = localStorage.getItem("seemaAdminLang") || "hi";
  window.setLang(defaultLang);

  renderItemsList();
  upiInput.value = getCurrentUpi();
  pinInput.focus();
})();
