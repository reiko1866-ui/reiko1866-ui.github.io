/**
 * Megrendelőlap PDF import — közös modul (arajanlat.html, szamla-eloreszlet.html).
 */
(function (global) {
  function extractQuoteNumberFromText(text) {
    const m = String(text || "").match(/MRDH-[A-Z]+-\d{2}-\d+/i);
    return m ? m[0].toUpperCase() : "";
  }

  function parseHufNumberCell(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    return Math.max(0, Math.round(Number(digits) || 0));
  }

  function parseQtyCell(value) {
    const m = String(value || "").match(/[\d]+(?:[.,]\d+)?/);
    if (!m) return 1;
    return Math.max(0, Number(String(m[0]).replace(",", ".")) || 0) || 1;
  }

  function parseDotsDateToIso(value) {
    const m = String(value || "")
      .trim()
      .match(/^(\d{4})\.(\d{2})\.(\d{2})\.?/);
    if (!m) return String(value || "").trim();
    return m[1] + "-" + m[2] + "-" + m[3];
  }

  function normalizeMegrendeloLabel(value) {
    return String(value || "")
      .trim()
      .replace(/:+$/, "")
      .replace(/\s+/g, " ");
  }

  function emptyMegrendeloSummary() {
    return {
      grossTotal: 0,
      finalTotal: 0,
      kitchenTotal: 0,
      grandTotal: 0,
      shippingFee: 0,
      assemblyFee: 0,
      discountPct: 0,
      discountHuf: 0,
      fromFooter: false
    };
  }

  function finalizeMegrendeloSummary(summary) {
    const ship = Math.max(0, summary.shippingFee || 0);
    const asm = Math.max(0, summary.assemblyFee || 0);
    const kitchen = Math.max(0, summary.kitchenTotal || 0);
    const grand = Math.max(0, summary.grandTotal || 0);

    if (kitchen > 0) {
      if (grand > 0 && asm > 0 && Math.abs(grand - kitchen - asm) <= 1000) {
        summary.finalTotal = kitchen + ship;
      } else if (grand > 0 && ship > 0 && Math.abs(grand - kitchen - ship) <= 1000) {
        summary.finalTotal = grand;
      } else if (grand > 0 && grand >= kitchen) {
        summary.finalTotal = grand;
      } else {
        summary.finalTotal = kitchen + ship;
      }
    } else if (grand > 0) {
      summary.finalTotal = Math.max(0, grand - asm);
    } else {
      summary.finalTotal = 0;
    }
    if (summary.grossTotal <= 0 && summary.finalTotal > 0 && summary.discountHuf > 0) {
      summary.grossTotal = summary.finalTotal + Math.max(0, summary.discountHuf);
    }
    return summary;
  }

  function parseMegrendeloSummaryFromText(text) {
    const summary = emptyMegrendeloSummary();
    const t = String(text || "");
    const pick = (re) => {
      const m = t.match(re);
      return m ? parseHufNumberCell(m[1]) : 0;
    };
    const ship = pick(/(?:Szállítási|Kiszállítási)\s*díj[:\s]*([\d\s.,]+)/i);
    if (ship) summary.shippingFee = ship;
    const asm = pick(/Szerel(?:és|ési\s*díj)[:\s]*([\d\s.,]+)/i);
    if (asm) summary.assemblyFee = asm;
    const kitchen = pick(/Összesen\s*konyhabútor\s*és\s*kiegészítők[:\s]*([\d\s.,]+)/i);
    if (kitchen) summary.kitchenTotal = kitchen;
    const grand =
      pick(/Végösszeg\s*\(?\s*bruttó\s*\)?[:\s]*([\d\s.,]+)/i) ||
      pick(/Végösszeg\s*Szállítással[:\s]*([\d\s.,]+)/i);
    if (grand) summary.grandTotal = grand;
    const gross =
      pick(/Kedvezmény\s*nélküli\s*összeg[:\s]*([\d\s.,]+)/i) ||
      pick(/Listaár\s*összesen[:\s]*([\d\s.,]+)/i);
    if (gross) summary.grossTotal = gross;
    const disc = pick(/Kedvezmény\s*összege[:\s]*([\d\s.,]+)/i);
    if (disc) summary.discountHuf = disc;
    const pctM = t.match(/(\d{1,2})\s*%\s*kedvezmény/i);
    if (pctM) summary.discountPct = Number(pctM[1]);
    if (summary.shippingFee || summary.kitchenTotal || summary.grandTotal) {
      summary.fromFooter = true;
    }
    return finalizeMegrendeloSummary(summary);
  }

  function customerNameFromOrderFolder(folder) {
    const seg = String(folder || "").trim();
    const m = seg.match(/^(.+?)\s*[—–-]\s*MRDH-/i);
    return m && m[1] ? m[1].trim() : "";
  }

  function extractCustomerFromMegrendeloFileName(fileName) {
    if (typeof PartialInvoiceView !== "undefined" && PartialInvoiceView.extractCustomerHintFromImportPath) {
      return PartialInvoiceView.extractCustomerHintFromImportPath(fileName);
    }
    const m = String(fileName || "").match(/\(([^)]+)\)\s*$/);
    if (m && m[1].trim()) return m[1].trim();
    const segments = String(fileName || "").split(/[/\\]/);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = String(segments[i] || "").trim();
      const folderM = seg.match(/^(.+?)\s*[—–-]\s*MRDH-/i);
      if (folderM && folderM[1].trim()) return folderM[1].trim();
    }
    return "";
  }

  function isMegrendeloCustomerFieldLabel(rawLabel) {
    const label = normalizeMegrendeloLabel(rawLabel).toLowerCase();
    return (
      label === "név" ||
      label === "vevő neve" ||
      label === "cím" ||
      label === "cim" ||
      label === "vevő címe" ||
      label === "telefon" ||
      label === "e-mail" ||
      label === "email" ||
      label === "email cím" ||
      label === "email cim"
    );
  }

  function isMegrendeloKitchenGridValue(value) {
    const v = String(value || "")
      .trim()
      .toLowerCase();
    if (!v || v === "-") return true;
    if (/^korpusz\s*\(/i.test(v)) return true;
    if (/^(felső|alsó|also|felso)\s+front/i.test(v)) return true;
    if (/^munkalap/i.test(v)) return true;
    if (/^fogantyú/i.test(v) || /^fogantyu/i.test(v)) return true;
    if (/^falipanel/i.test(v)) return true;
    if (/^konyha\s*típus/i.test(v)) return true;
    return false;
  }

  function isPlausibleMegrendeloCustomerName(value) {
    const v = String(value || "").trim();
    if (!v || v === "-") return false;
    if (isMegrendeloKitchenGridValue(v)) return false;
    const low = v.toLowerCase();
    if (/megrendel[oő]lap/.test(low)) return false;
    if (/divian/i.test(low) && /konyha|megrendel/i.test(low)) return false;
    if (
      typeof PartialInvoiceView !== "undefined" &&
      PartialInvoiceView.isDeliveryInvalidCustomerName &&
      PartialInvoiceView.isDeliveryInvalidCustomerName(v)
    ) {
      return false;
    }
    return true;
  }

  function isPlausibleMegrendeloCustomerAddress(value) {
    if (typeof PartialInvoiceView !== "undefined" && PartialInvoiceView.isPlausibleCustomerAddress) {
      return PartialInvoiceView.isPlausibleCustomerAddress(value);
    }
    const v = String(value || "").trim();
    if (!v || v === "-" || v === "—") return false;
    if (isMegrendeloKitchenGridValue(v)) return false;
    if (/^10\d{2}\s+(felső|alsó|also|felso)\s+front/i.test(v)) return false;
    if (/^[\d\s/+-]+$/.test(v)) return false;
    return true;
  }

  function cleanupMegrendeloCustomer(customer) {
    if (!customer || typeof customer !== "object") return;
    if (!isPlausibleMegrendeloCustomerName(customer.name)) customer.name = "";
    if (!isPlausibleMegrendeloCustomerAddress(customer.address)) customer.address = "";
    if (!customer.name && customer.email && !customer.address && !customer.phone) {
      const inferred =
        typeof PartialInvoiceView !== "undefined" && PartialInvoiceView.inferCustomerNameFromEmail
          ? PartialInvoiceView.inferCustomerNameFromEmail(customer.email)
          : "";
      if (inferred) customer.name = inferred;
    }
  }

  function isMegrendeloKitchenFieldLabel(rawLabel) {
    const label = normalizeMegrendeloLabel(rawLabel).toLowerCase();
    return (
      label.startsWith("korpusz") ||
      label === "felső front" ||
      label === "alsó front" ||
      label === "also front" ||
      label === "felso front" ||
      label === "kamra felső front" ||
      label === "munkalap" ||
      label.startsWith("fogantyú") ||
      label.startsWith("fogantyu") ||
      label === "falipanel" ||
      label.startsWith("konyha típus") ||
      label.startsWith("konyha tipus")
    );
  }

  function sanitizeImportedKitchenStyleValue(raw) {
    let s = String(raw || "")
      .trim()
      .replace(/^:+\s*/, "");
    if (!s || s === "-") return "";
    if (/\bFt\b/i.test(s)) return "";
    if (/^[\d\s\u00a0.,/+-]+$/.test(s)) return "";
    if (/@/.test(s)) return "";
    if (/^(e-?mail|email cím|email cim|telefon|vevő neve|név|cím)\s*:?\s*$/i.test(s)) return "";
    s = s.replace(/^[\w.+-]+@[\w.-]+\.\w+\s+/i, "").trim();
    s = s
      .replace(/^(?:e-?mail cím|email cím|telefon|felső front|alsó front|also front|felso front)\s*:?\s*/gi, "")
      .trim();
    if (/^(?:e-?mail|telefon|felső front|alsó front)\s*:?\s*$/i.test(s)) return "";
    if (isMegrendeloKitchenGridValue(s)) return "";
    if (/^(?:e-?mail|telefon)\s/i.test(s)) return "";
    if (/^\(\s*kamra/i.test(s)) return "";
    if (/kamra\s*\/\s*kamra/i.test(s) && !/\)\s*$/.test(s)) return "";
    return s;
  }

  function applyMegrendeloKitchenField(kitchen, rawLabel, rawValue) {
    if (!kitchen || typeof kitchen !== "object") return;
    if (!isMegrendeloKitchenFieldLabel(rawLabel)) return;
    const label = normalizeMegrendeloLabel(rawLabel).toLowerCase();
    const value = sanitizeImportedKitchenStyleValue(rawValue);
    if (!value) return;
    if (label.startsWith("korpusz")) {
      if (label.includes("bútor") || label.includes("butor")) {
        kitchen.korpuszColor = value;
        return;
      }
      if (!kitchen.korpuszColor) kitchen.korpuszColor = value;
      return;
    }
    if (label === "felső front" || label === "felso front") {
      if (!kitchen.upperFront) kitchen.upperFront = value;
      return;
    }
    if (label === "alsó front" || label === "also front") {
      if (!kitchen.lowerFront) kitchen.lowerFront = value;
      return;
    }
    if (label === "kamra felső front") {
      if (!kitchen.kamraUpperFront) kitchen.kamraUpperFront = value;
      return;
    }
    if (label === "munkalap") {
      if (!kitchen.worktopStyle) kitchen.worktopStyle = value;
      return;
    }
    if (label.startsWith("fogantyú") || label.startsWith("fogantyu")) {
      if (!kitchen.handleStyle) kitchen.handleStyle = value;
      return;
    }
    if (label === "falipanel") {
      if (!kitchen.wallPanelStyle) kitchen.wallPanelStyle = value;
      return;
    }
    if (label.startsWith("konyha típus") || label.startsWith("konyha tipus")) {
      if (!kitchen.kitchenType) kitchen.kitchenType = value;
    }
  }

  function enrichKitchenFromMegrendeloPdfLines(kitchen, pdfLines) {
    if (!kitchen || typeof kitchen !== "object") return;
    const lines = pdfLines || [];
    for (let i = 0; i < lines.length; i++) {
      const parts = Array.isArray(lines[i].parts) ? lines[i].parts : [];
      for (let p = 0; p < parts.length - 1; p++) {
        applyMegrendeloKitchenField(kitchen, parts[p].str, parts[p + 1].str);
      }
      const t = String(lines[i].text || "").trim();
      const kitchenInline = [
        [/^(Korpusz\s*\([^)]+\))\s*:?\s+(.+)$/i, "korpuszColor"],
        [/^(Felső front|Felso front)\s*:?\s+(.+)$/i, "upperFront"],
        [/^(Alsó front|Also front)\s*:?\s+(.+)$/i, "lowerFront"],
        [/^(Kamra felső front)\s*:?\s+(.+)$/i, "kamraUpperFront"],
        [/^(Munkalap)\s*:?\s+(.+)$/i, "worktopStyle"],
        [/^(Falipanel)\s*:?\s+(.+)$/i, "wallPanelStyle"],
        [/^(Fogantyú[^:]*|Fogantyu[^:]*)\s*:?\s+(.+)$/i, "handleStyle"],
        [/^(Konyha\s*Típus|Konyha tipus)\s*:?\s+(.+)$/i, "kitchenType"]
      ];
      kitchenInline.forEach(([re, field]) => {
        const m = t.match(re);
        if (!m || !m[2]) return;
        const val = sanitizeImportedKitchenStyleValue(m[2]);
        if (!val) return;
        if (!kitchen[field]) kitchen[field] = val;
      });
    }
    kitchen.upperFront = sanitizeImportedKitchenStyleValue(kitchen.upperFront);
    kitchen.lowerFront = sanitizeImportedKitchenStyleValue(kitchen.lowerFront);
    kitchen.korpuszColor = sanitizeImportedKitchenStyleValue(kitchen.korpuszColor);
    kitchen.kamraUpperFront = sanitizeImportedKitchenStyleValue(kitchen.kamraUpperFront);
    kitchen.worktopStyle = sanitizeImportedKitchenStyleValue(kitchen.worktopStyle);
    kitchen.handleStyle = sanitizeImportedKitchenStyleValue(kitchen.handleStyle);
    if (kitchen.kitchenType) {
      kitchen.kitchenType = String(kitchen.kitchenType).replace(/Mennyiség.*/i, "").trim();
    }
  }

  function isInferredEmailLocalName(name, email) {
    const n = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9áéíóöőúüű]/g, "");
    const e = String(email || "")
      .trim()
      .toLowerCase();
    if (!n || !e || !e.includes("@")) return false;
    const local = e.split("@")[0].replace(/[^a-z0-9áéíóöőúüű]/g, "");
    return n === local || n.startsWith(local) || local.startsWith(n);
  }

  function applyMegrendeloCustomerField(customer, rawLabel, rawValue) {
    if (!isMegrendeloCustomerFieldLabel(rawLabel)) return;
    const label = normalizeMegrendeloLabel(rawLabel).toLowerCase();
    let value = String(rawValue || "")
      .trim()
      .replace(/^:+\s*/, "");
    if (!value || value === "-") return;
    if (isMegrendeloKitchenFieldLabel(value) || isMegrendeloKitchenGridValue(value)) return;
    if (isMegrendeloCustomerFieldLabel(value)) return;
      if (label === "név" || label === "vevő neve") {
        if (
          !customer.name ||
          isInferredEmailLocalName(customer.name, customer.email)
        ) {
          if (isPlausibleMegrendeloCustomerName(value)) customer.name = value;
        }
        return;
      }
      if (label === "cím" || label === "cim" || label === "vevő címe") {
        if (!customer.address && isPlausibleMegrendeloCustomerAddress(value)) customer.address = value;
        return;
      }
    if (label === "telefon") {
      if (!customer.phone) customer.phone = value;
      return;
    }
    if (label === "e-mail" || label === "email" || label === "email cím" || label === "email cim") {
      if (!customer.email) customer.email = value;
    }
  }

  /** Megrendelő Excel sor — vevő mezők B/C oszlopban (Név:, Cím:, …) és inline címkékkel. */
  function applyMegrendeloCustomerFieldsFromExcelRow(customer, cells) {
    if (!customer || typeof customer !== "object") return;
    const row = (cells || []).map((c) => String(c ?? "").trim());
    if (row[0]) {
      applyMegrendeloCustomerField(customer, row[0], row[1]);
      const inlineHead = String(row[0] || "").match(
        /^(Vevő neve|Név|Vevő címe|Cím|Telefon|E-?mail|Email cím)\s*:\s*(.+)$/i
      );
      if (inlineHead) applyMegrendeloCustomerField(customer, inlineHead[1], inlineHead[2]);
    }
    for (let c = 0; c < row.length; c++) {
      applyMegrendeloCustomerField(customer, row[c], row[c + 1]);
    }
  }

  function findNextMegrendeloPdfValueLine(pdfLines, startIdx) {
    for (let i = startIdx; i < (pdfLines || []).length; i++) {
      const t = String(pdfLines[i].text || "").trim();
      if (!t) continue;
      if (/^(Vevő|Telefon|E-?mail|Konyha|Mennyiség|Ajánlat|Áruház|Korpusz|Alsó|Felső|Munkalap|Fogantyú)/i.test(t)) {
        return "";
      }
      if (isMegrendeloKitchenGridValue(t)) return "";
      if (/^[\d\s]+Ft$/i.test(t)) return "";
      if (/^MRDH-/i.test(t)) return "";
      return t;
    }
    return "";
  }

  function detectMegrendeloPdfKitchenColumnX(pdfLines) {
    const xs = [];
    (pdfLines || []).forEach((line) => {
      (line.parts || []).forEach((p) => {
        const s = String(p.str || "").trim();
        if (/^Korpusz\s*\(/i.test(s) || /^Felső front:/i.test(s) || /^Alsó front:/i.test(s)) {
          xs.push(p.x);
        }
      });
    });
    if (xs.length) return Math.min(...xs) - 24;
    return 280;
  }

  function megrendeloPdfCustomerLeftText(line, kitchenColumnX) {
    const limit = Number(kitchenColumnX) || 280;
    return (line?.parts || [])
      .filter((p) => p.x < limit)
      .sort((a, b) => a.x - b.x)
      .map((p) => String(p.str || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function megrendeloPdfCustomerValueAtColumn(line, kitchenColumnX) {
    const limit = Number(kitchenColumnX) || 280;
    const VAL_X_MIN = 55;
    for (const p of line?.parts || []) {
      if (p.x < VAL_X_MIN || p.x >= limit) continue;
      const v = String(p.str || "").trim();
      if (!v || v === "-") continue;
      if (isMegrendeloCustomerFieldLabel(v)) continue;
      if (isMegrendeloKitchenFieldLabel(v)) continue;
      if (isMegrendeloKitchenGridValue(v)) continue;
      return v;
    }
    return "";
  }

  function applyMegrendeloPdfCustomerFieldValue(customer, field, value) {
    const v = String(value || "").trim();
    if (!v || v === "-" || v === ":" || v.length < 2) return;
    if (field === "name") {
      if (!isPlausibleMegrendeloCustomerName(v)) return;
      if (isPlausibleMegrendeloCustomerAddress(v) && /\b(utca|út|u\.|tér|köz|körút)\b/i.test(v)) {
        return;
      }
      customer.name = v;
      return;
    }
    if (field === "address") {
      if (!isPlausibleMegrendeloCustomerAddress(v)) return;
      if (!customer.address) customer.address = v;
      return;
    }
    if (field === "phone" && !customer.phone) customer.phone = v;
    if (field === "email" && !customer.email && /@/.test(v)) customer.email = v;
  }

  function megrendeloPdfCustomerValueOnlyLine(line, kitchenColumnX) {
    const leftText = megrendeloPdfCustomerLeftText(line, kitchenColumnX);
    const valueCol = megrendeloPdfCustomerValueAtColumn(line, kitchenColumnX);
    if (!valueCol || leftText !== valueCol) return "";
    if (isMegrendeloCustomerFieldLabel(valueCol)) return "";
    return valueCol;
  }

  /** PDF bal felső sarok — oszlop-alapú (vevő x≈94, konyha x≈344), nem szomszédos part párok. */
  function enrichCustomerFromMegrendeloPdfLines(customer, pdfLines) {
    if (!customer || typeof customer !== "object") return;
    const lines = pdfLines || [];
    const kitchenColumnX = detectMegrendeloPdfKitchenColumnX(lines);

    const fieldSpecs = [
      {
        field: "name",
        labelRe: /^N[eé]v\s*:?\s*(.+)$/i,
        labelOnlyRe: /^N[eé]v\s*:?\s*$/i
      },
      {
        field: "address",
        labelRe: /^C[ií]m\s*:?\s*(.+)$/i,
        labelOnlyRe: /^C[ií]m\s*:?\s*$/i
      },
      {
        field: "phone",
        labelRe: /^Telefon\s*:?\s*(.+)$/i,
        labelOnlyRe: /^Telefon\s*:?\s*$/i
      },
      {
        field: "email",
        labelRe: /^(?:E-?mail|Email c[ií]m)\s*:?\s*(.+)$/i,
        labelOnlyRe: /^(?:E-?mail|Email c[ií]m)\s*:?\s*$/i
      }
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const leftText = megrendeloPdfCustomerLeftText(line, kitchenColumnX);
      if (!leftText) continue;

      for (let s = 0; s < fieldSpecs.length; s++) {
        const spec = fieldSpecs[s];
        if (!spec.labelOnlyRe.test(leftText) && !spec.labelRe.test(leftText)) continue;

        let value = "";
        const inline = leftText.match(spec.labelRe);
        if (inline && String(inline[1] || "").trim()) {
          value = String(inline[1]).trim();
        }
        if (!value) {
          value =
            megrendeloPdfCustomerValueAtColumn(line, kitchenColumnX) ||
            megrendeloPdfCustomerValueAtColumn(lines[i + 1], kitchenColumnX);
        }
        if (spec.field === "email" && value && !/@/.test(value)) value = "";
        applyMegrendeloPdfCustomerFieldValue(customer, spec.field, value);
        break;
      }
    }

    lines.forEach((line) => {
      const orphan = megrendeloPdfCustomerValueOnlyLine(line, kitchenColumnX);
      if (!orphan || /@/.test(orphan) || orphan.length < 3 || orphan === ":") return;
      const addrLike =
        /\b(utca|út|u\.|tér|köz|körút|hrsz)\b/i.test(orphan) || /^\d{4}\s/.test(orphan);
      if (!customer.name && !addrLike && isPlausibleMegrendeloCustomerName(orphan)) {
        applyMegrendeloPdfCustomerFieldValue(customer, "name", orphan);
        return;
      }
      if (!customer.address && addrLike && isPlausibleMegrendeloCustomerAddress(orphan)) {
        applyMegrendeloPdfCustomerFieldValue(customer, "address", orphan);
      }
    });
  }

  function normalizeMegrendeloLineText(name) {
    return String(name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeMegrendeloLineDescriptionForCode(name) {
    let s = String(name || "").trim();
    if (!s) return "";
    s = s.replace(/^([A-Z]{2,6})\s+(\d{1,3})\b/i, "$1$2");
    s = s.replace(/^([A-Z]{2,6}\d{0,3}[A-Z0-9]{0,4})\s+([BJK])\b/i, "$1_$2");
    s = s.replace(/^AS110\s+(?:VT\s+)?(?:VASALATHOZ|SAROK)/i, "AS110VT");
    s = s.replace(/^AS110\s+SAROK\s+ELEM/i, "AS110VT");
    s = s.replace(/^(F60E)([BJK])\b/i, "$1_$2");
    s = s.replace(/^F60E(B|J)\b/i, "F60E_$1");
    s = s.replace(/^F45(B|J)\b/i, "F45_$1");
    s = s.replace(/^F55(B|J)\b/i, "F55_$1");
    s = s.replace(/^KTB\s*60\s*(BALOS|BAL|JOBB|J|B)\b/i, (_, side) =>
      "KTB60_" + (/^J/.test(side) ? "J" : "B")
    );
    s = s.replace(/^(F45)([BJK])\b/i, "$1_$2");
    s = s.replace(/^(F45)(JOBB|JOBBOS|J)\b/i, "$1_J");
    s = s.replace(/^(F45)(BALOS|BAL|B)\b/i, "$1_B");
    s = s.replace(/^(AML\s*\d{1,3})\s+(JOBB|JOBBOS|J|BALOS|BAL|B)\b/i, (_, head, dir) => {
      const code = head.replace(/\s+/g, "").toUpperCase();
      const side = /^J/.test(dir) ? "_J" : "_B";
      return code + side;
    });
    return s.trim();
  }

  function isMegrendeloIntegratedCabinetDescription(name) {
    const normalized = normalizeMegrendeloLineDescriptionForCode(name);
    if (/^(AR20|AS110VT?|ASZB|AF\d|AML|AMO|ASM|FKF|FFZ|FSL|F\d|F60E|KTB|EF60|AKL|LTFK|ATF|FFM|MO\d)/i.test(normalized)) {
      return true;
    }
    return isMegrendeloKitchenCabinetElementName(name);
  }

  function isMegrendeloKitchenCabinetElementName(name) {
    const t = normalizeMegrendeloLineText(name);
    if (!t) return false;
    if (/\b(also|felso|magas)\s+elem\b/.test(t)) return true;
    if (/\bmosogatos?\s+elem\b/.test(t)) return true;
    if (/\bmosogato\s+tarto\b/.test(t)) return true;
    if (/\bsarokelem\b/.test(t)) return true;
    if (/\bfozolaphoz\b/.test(t) && /\belem\b/.test(t)) return true;
    if (/\bbeepitett\s+suto/.test(t) || (/\bsutohoz\b/.test(t) && t.includes("kamra"))) return true;
    if (t.includes("hulladektarolos")) return true;
    if (/\belszivos?\s+elem\b/.test(t)) return true;
    if (/\bkamra\s+sarok\b/.test(t)) return true;
    if (/\bkamra\s*felnyilo/.test(t)) return true;
    if (/\bfali\s+(elem|sarok|felnyilo)/.test(t)) return true;
    if (/\bjolly\b/.test(t) && /\b(elem|also|alsoelem)\b/.test(t)) return true;
    if (/\bkihuzhato\b/.test(t) && /\b(elem|racs)\b/.test(t)) return true;
    if (/\bpolcos\b/.test(t) && /\belem\b/.test(t)) return true;
    if (/\bjolly\s+kosaras\b/.test(t)) return true;
    if (/\bfio\s*kos\s*aras\b/.test(t) && t.includes("also")) return true;
    if (/^ar20\b/.test(t)) return true;
    return false;
  }

  function extractLeadingCabinetCodeFromDescription(name) {
    const s = normalizeMegrendeloLineDescriptionForCode(name);
    if (!s) return "";
    const m = s.match(/^([A-Z]{2,6}\d{1,3}[A-Z0-9]{0,6}(?:_\d{1,2})?(?:_[JBK])?)/i);
    if (!m) return "";
    const raw = String(m[1]).replace(/\s+/g, "").toUpperCase();
    try {
      const api = global.DivianCabinetCodes;
      if (api && typeof api.normalizeCabinetCode === "function") {
        const normalized = api.normalizeCabinetCode(raw);
        if (typeof api.isFurnitureElementCode === "function" && api.isFurnitureElementCode(normalized)) {
          return normalized;
        }
        if (/^[A-Z]{2,6}\d/.test(normalized)) return normalized;
      }
    } catch (_e) {
      /* ignore */
    }
    return raw.replace(/_[JBK]$/i, "");
  }

  function formatMegrendeloQuoteSequence(seq) {
    const n = Number(String(seq || "").trim());
    if (!Number.isFinite(n) || n <= 0) return String(seq || "").trim();
    if (n < 1000) return String(n);
    return String(n).padStart(4, "0");
  }

  function resolveMegrendeloSnapLineCode(line) {
    const name = String(line?.name || "").trim();
    let code = String(line?.code || "").trim() || extractCodeFromMegrendeloLineDescription(name);
    if (!code) code = extractLeadingCabinetCodeFromDescription(name);
    if (
      !code &&
      typeof PartialInvoiceView !== "undefined" &&
      PartialInvoiceView.isInvoiceCabinetModuleLine &&
      PartialInvoiceView.isInvoiceCabinetModuleLine({ code: "", name, qty: line?.qty || 1 })
    ) {
      code = extractLeadingCabinetCodeFromDescription(name);
    }
    return String(code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function isMegrendeloAccessoryLineName(name) {
    if (isMegrendeloIntegratedCabinetDescription(name)) return false;
    const t = normalizeMegrendeloLineText(name);
    if (!t) return false;
    if (t.includes("vagasi") || t.includes("vagas dij")) return true;
    if (t === "szerel" || t.startsWith("szerel ")) return true;
    if (/\b(szett|csomag)\b/.test(t) || t.includes("divian szett") || t.includes("led szett")) return true;
    if (/^szett\s*[·•\-]/.test(t)) return true;
    if (t.includes("csaptelep") || (t.includes("csap") && t.includes("telep"))) return true;
    if (t.includes("talca") || t.includes("mosogato") || t.includes("mosogatogep")) return true;
    if (/\bwhp\b/.test(t) || t.includes("whirlpool")) return true;
    if (t.includes("suto") || t.includes("fozolap") || t.includes("parael") || t.includes("mikro")) {
      return true;
    }
    if (
      t.includes("vasalat") ||
      t.includes("fiokrendez") ||
      t.includes("labpedal") ||
      t.includes("konzol") ||
      t.includes("asztallab") ||
      t.includes("hetich") ||
      t.includes("blanco") ||
      t.includes("bosch") ||
      t.includes("evido")
    ) {
      return true;
    }
    if (t.includes("oldaltakaro") || t.includes("falipanel")) return true;
    if (/^(lab|láb)$/i.test(String(name || "").trim()) || t.includes("labelo") || t.includes("labazati")) {
      return true;
    }
    return false;
  }

  function extractCodeFromMegrendeloLineDescription(name) {
    const s = normalizeMegrendeloLineDescriptionForCode(name);
    if (!s) return "";
    if (isMegrendeloIntegratedCabinetDescription(name)) {
      const lead = extractLeadingCabinetCodeFromDescription(name);
      if (lead) return lead;
    }
    if (isMegrendeloAccessoryLineName(name)) return "";
    const lower = normalizeMegrendeloLineText(s);
    if (
      lower.startsWith("lot") ||
      lower.includes("takaro") ||
      /^lab$/.test(lower) ||
      lower.includes("labelo") ||
      lower.includes("labazati") ||
      lower.includes("szilikon") ||
      lower.includes("butorlapbol")
    ) {
      return "";
    }
    const patterns = [
      /^(SET_[A-Z0-9_]+)/i,
      /^(LED_SET_[A-Z0-9_]+)/i,
      /^(BOS-SZETT-\d+)/i,
      /^(EVI-SZETT-\d+)/i,
      /^(DIV-CSOM-[A-Z0-9-]+)/i,
      /^(DIV-CSAP-[A-Z0-9-]+)/i,
      /^(TDIV-[A-Z0-9-]+)/i,
      /^(MO\d+_\d+)/i,
      /^(AR20)\b/i,
      /^(AS110VT(?:_[JBK])?)/i,
      /^(AS110P(?:_[JBK])?)/i,
      /^(AS110(?:MAGIC)?(?:_[JBK])?)/i,
      /^(ASZB\d+)/i,
      /^(AS95(?:_[JBK])?)/i,
      /^(EF60(?:_\d+)?(?:_[JBK])?)/i,
      /^(KTB60(?:_[JBK])?)/i,
      /^(KMTBH\d+)/i,
      /^(FMFSL\d+)/i,
      /^(FMF\d+)/i,
      /^(FSL\d+(?:_[JBK])?)/i,
      /^(FFZ\d+)/i,
      /^(LTFK)\b/i,
      /^(KMT[BS]\d+)/i,
      /^(EFT\d+F?)/i,
      /^(F30(?:_[JBK])?)/i,
      /^(F35(?:_[JBK])?)/i,
      /^(F40(?:_[JBK])?)/i,
      /^(F50(?:_[JBK])?)/i,
      /^(F60E)\b/i,
      /^(ASM\d+)/i,
      /^(AF\d+)/i,
      /^(AML\d+P?)/i,
      /^(AKL)\b/i,
      /^(KMTH\d+W?)/i,
      /^(FKF\d+(?:\s+SZ)?)/i,
      /^(FFM\d+)/i,
      /^(FK\d+)/i,
      /^(ATF\d+)/i,
      /^([A-Z]{1,4}\d{1,3}[A-Z]?)\b/i
    ];
    for (const p of patterns) {
      const m = s.match(p);
      if (m) {
        const raw = String(m[1]).replace(/\s+/g, "").toUpperCase();
        try {
          const api = global.DivianCabinetCodes;
          if (api && typeof api.normalizeCabinetCode === "function") {
            return api.normalizeCabinetCode(raw);
          }
        } catch (_e) {
          /* ignore */
        }
        return raw.replace(/_[JBK]$/i, "");
      }
    }
    const lead = extractLeadingCabinetCodeFromDescription(s);
    if (lead) return lead;
    return "";
  }

  const WORKTOP_EXTRA_CM = 10;
  const WORKTOP_TURNER_UNIT_DEFAULT = 2890;

  function normalizeImportedWorktopSizeKey(size) {
    const s = String(size || "")
      .trim()
      .toLowerCase();
    if (!s) return "";
    if (s.includes("920") || s === "92") return "92";
    if (s.includes("90")) return "90";
    if (s.includes("60")) return "60";
    const n = parseInt(s, 10);
    if (n === 920) return "92";
    if (n === 60 || n === 90 || n === 92) return String(n);
    return String(size || "").trim();
  }

  function parseWorktopLengthFmFromSnapName(name) {
    const raw = String(name || "").trim();
    const cmMatch = raw.match(/\(\s*(\d{2,4})\s*cm\b/i);
    if (cmMatch) return Math.max(0, Number(cmMatch[1]) || 0) / 100;
    return 0;
  }

  function isMegrendeloWorktopSnapLine(line) {
    const name = String(line?.name || "").trim();
    if (!name) return false;
    const low = normalizeMegrendeloLineText(name);
    if (!low.startsWith("munkalap") && !low.startsWith("munkapult")) return false;
    if (low.includes("fordito") || low.includes("vagasi") || low.includes("vagas dij")) return false;
    return true;
  }

  function parseWorktopSnapLineName(name) {
    if (typeof PartialInvoiceView !== "undefined" && PartialInvoiceView.parseWorktopSnapshotName) {
      const rawName = String(name || "").trim();
      const cmMatch = rawName.match(/\(\s*(\d{2,4})\s*cm\b/i);
      const p = PartialInvoiceView.parseWorktopSnapshotName(rawName);
      if (cmMatch && !p.color) {
        return {
          size: normalizeImportedWorktopSizeKey(p.size),
          name: rawName.replace(/^Munkalap(?:ult)?\s*/i, "").trim()
        };
      }
      return {
        size: normalizeImportedWorktopSizeKey(p.size),
        name: String(p.color || "").trim()
      };
    }
    const raw = String(name || "")
      .replace(/^Munkalap\s*[—–-]\s*/i, "")
      .replace(/^Munkalap\s*·\s*/i, "")
      .trim();
    const dot = raw.indexOf("·");
    if (dot >= 0) {
      return {
        size: normalizeImportedWorktopSizeKey(raw.slice(0, dot).trim()),
        name: raw.slice(dot + 1).trim()
      };
    }
    return { size: normalizeImportedWorktopSizeKey(raw), name: "" };
  }

  function worktopLineFromSnapLine(line) {
    if (!isMegrendeloWorktopSnapLine(line)) return null;
    const parsed = parseWorktopSnapLineName(line.name);
    let unit = Math.max(0, Math.round(Number(line.unit) || 0));
    let fm = Math.max(0, Number(line.qty) || 0);
    const total = Math.max(0, Math.round(Number(line.total) || 0));
    const fmFromName = parseWorktopLengthFmFromSnapName(line.name);
    if (fmFromName > 0) fm = fmFromName;
    if (!fm && total > 0 && unit > 0) fm = total / unit;
    if (!unit && fm > 0 && total > 0) unit = Math.round(total / fm);
    if (fm <= 0 || unit <= 0) return null;
    const adjustedCm = Math.round(fm * 1000) / 10;
    const cm = Math.max(0, Math.round((adjustedCm - WORKTOP_EXTRA_CM) * 10) / 10);
    return {
      size: parsed.size,
      name: parsed.name,
      cm,
      adjustedCm,
      fm,
      unit
    };
  }

  function extractWorktopStateFromSnapLines(snapLines) {
    const worktopLines = [];
    let worktopTurnerQty = 0;
    let worktopTurnerUnitPrice = 0;

    (snapLines || []).forEach((line) => {
      const wt = worktopLineFromSnapLine(line);
      if (wt) {
        worktopLines.push(wt);
        return;
      }
      const low = normalizeMegrendeloLineText(line?.name);
      if (low.startsWith("munkalap") && (low.includes("fordito") || low.includes("fordító"))) {
        worktopTurnerQty = Math.max(0, Math.floor(Number(line.qty) || 0));
        worktopTurnerUnitPrice = Math.max(
          0,
          Math.round(Number(line.unit) || 0) || WORKTOP_TURNER_UNIT_DEFAULT
        );
      }
    });

    return {
      worktopLines,
      worktopTurnerQty,
      worktopTurnerUnitPrice: worktopTurnerUnitPrice || WORKTOP_TURNER_UNIT_DEFAULT
    };
  }

  function isMegrendeloNonCabinetFillLine(line) {
    const code = String(line?.code || "")
      .trim()
      .toUpperCase();
    const t = normalizeMegrendeloLineText(line?.name);
    if (/^LOT\d/i.test(code) || t.startsWith("lot")) return true;
    if (t.includes("mennyezeti takarolec")) return true;
    if (t.includes("szabott butorlap")) return true;
    return false;
  }

  function isMegrendeloHardwareSnapLine(line) {
    if (isMegrendeloIntegratedCabinetDescription(line?.name)) return false;
    if (
      typeof PartialInvoiceView !== "undefined" &&
      PartialInvoiceView.isInvoiceHardwareSnapshotLine
    ) {
      return PartialInvoiceView.isInvoiceHardwareSnapshotLine(line);
    }
    if (isMegrendeloKitchenCabinetElementName(line?.name)) return false;
    const t = (
      normalizeMegrendeloLineText(line?.name) + " " + normalizeMegrendeloLineText(line?.code)
    ).trim();
    if (/\bsarokelem\b/.test(t) && t.includes("vasalat")) return false;
    return t.includes("vasalat");
  }

  function extractHardwareLinesFromSnapLines(snapLines) {
    if (typeof PartialInvoiceView !== "undefined" && PartialInvoiceView.hardwareLinesFromSnapshot) {
      return PartialInvoiceView.hardwareLinesFromSnapshot({ lines: snapLines });
    }
    const out = [];
    (snapLines || []).forEach((line) => {
      if (!isMegrendeloHardwareSnapLine(line)) return;
      const total = Math.max(0, Math.round(Number(line.total) || 0));
      const qty = Math.max(1, Math.floor(Number(line.qty) || 0) || 1);
      const unit =
        Math.max(0, Math.round(Number(line.unit) || 0)) ||
        (total > 0 ? Math.round(total / qty) : 0);
      if (total <= 0 && unit <= 0) return;
      let name = String(line.name || "").trim();
      name = name.replace(/^[A-Z0-9][A-Z0-9_./-]*\s*-\s*Vasalat\s*-\s*/i, "").trim();
      name = name.replace(/^Vasalat\s*[—–-]\s*/i, "").trim() || String(line.code || "").trim();
      out.push({
        name,
        code: line.code,
        qty,
        unit
      });
    });
    return out;
  }

  function buildMegrendeloPayloadFromParts(parts, fileName) {
    const snapLines = (parts.snapLines || []).map((line) => {
      const name = String(line.name || "").trim();
      const code = resolveMegrendeloSnapLineCode(Object.assign({}, line, { name }));
      const qty = Math.max(0, Number(line.qty) || 0);
      const unit = Math.max(0, Math.round(Number(line.unit) || 0));
      const total = Math.max(0, Math.round(Number(line.total) || 0)) || unit * qty;
      return { code, name, qty, unit, total };
    });

    const selected = [];
    const kiadvanyExtrasLines = [];
    const worktopState = extractWorktopStateFromSnapLines(snapLines);
    const hardwareLinesImported = extractHardwareLinesFromSnapLines(snapLines);
    snapLines.forEach((line, idx) => {
      if (isMegrendeloWorktopSnapLine(line)) return;
      if (isMegrendeloNonCabinetFillLine(line)) return;
      if (isMegrendeloHardwareSnapLine(line)) return;
      const isKiadvany =
        typeof PartialInvoiceView !== "undefined" &&
        PartialInvoiceView.isInvoiceKiadvanyLine &&
        PartialInvoiceView.isInvoiceKiadvanyLine(line);
      if (isKiadvany) {
        const kind =
          typeof PartialInvoiceView.inferKiadvanyLineKind === "function"
            ? PartialInvoiceView.inferKiadvanyLineKind(line)
            : "";
        kiadvanyExtrasLines.push({
          code: line.code,
          name: line.name,
          qty: line.qty,
          unit: line.unit,
          ...(kind ? { kind } : {})
        });
        return;
      }
      if (!line.code) {
        if (
          typeof PartialInvoiceView !== "undefined" &&
          PartialInvoiceView.isInvoiceCabinetModuleLine &&
          PartialInvoiceView.isInvoiceCabinetModuleLine(line)
        ) {
          const fallbackCode = extractLeadingCabinetCodeFromDescription(line.name) || "XL" + idx;
          const key = String(fallbackCode).toUpperCase() + "#" + idx;
          selected.push([key, { code: fallbackCode, name: line.name, qty: line.qty }]);
        }
        return;
      }
      const key = String(line.code || "XL" + idx).toUpperCase() + "#" + idx;
      selected.push([key, { code: line.code, name: line.name, qty: line.qty }]);
    });

    let quoteNumber = String(parts.quoteNumber || "").trim();
    if (!quoteNumber && fileName) quoteNumber = extractQuoteNumberFromText(fileName);
    if (!quoteNumber && parts.sourceFolder) quoteNumber = extractQuoteNumberFromText(parts.sourceFolder);

    const kitchen = Object.assign(
      {
        kitchenType: "",
        korpuszColor: "",
        upperFront: "",
        lowerFront: "",
        worktopStyle: "",
        wallPanelStyle: "",
        handleStyle: "",
        store: "vaci"
      },
      parts.kitchen || {}
    );
    if (quoteNumber.toUpperCase().includes("BUD")) kitchen.store = "budaors";

    const summary = parts.summary || emptyMegrendeloSummary();

    return {
      quoteNumber,
      quoteDate: String(parts.quoteDate || "").trim(),
      customer: parts.customer || {},
      _importFileName: String(fileName || "").trim(),
      _importFullText: String(parts.importFullText || "").trim(),
      kitchen,
      note: String(parts.note || "").trim(),
      snapshot: {
        lines: snapLines,
        grossTotal: summary.grossTotal || 0,
        finalTotal: summary.finalTotal || 0,
        grandTotal: summary.grandTotal || 0,
        kitchenDiscountedTotal: summary.kitchenTotal || 0,
        shippingFee: summary.shippingFee || 0,
        assemblyFee: summary.assemblyFee || 0,
        discountPct: summary.discountPct || 0,
        discountHuf: summary.discountHuf || 0
      },
      state: {
        selected,
        hardwareLines: hardwareLinesImported,
        kiadvanyExtrasLines,
        worktopLines: worktopState.worktopLines,
        worktopTurnerQty: worktopState.worktopTurnerQty || 0,
        worktopTurnerUnitPrice: worktopState.worktopTurnerUnitPrice || WORKTOP_TURNER_UNIT_DEFAULT,
        shippingFee: summary.shippingFee || 0,
        assemblyFee: summary.assemblyFee || 0,
        discount: summary.discountPct || 0
      },
      _megrendeloImport: true,
      _fromMegrendeloPdf: !!parts.fromPdf,
      _summaryFromFooter: !!summary.fromFooter
    };
  }

  /** Megrendelő PDF 1. oldal — kicsinyített előnézet (szállítólevél melléklet). */
  async function renderMegrendeloPdfPreviewDataUrl(arrayBuffer, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const maxWidth = Math.max(320, Math.floor(Number(options.maxWidth) || 680));
    if (typeof document === "undefined" || !arrayBuffer) return "";
    try {
      const pdfjs = await ensurePdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const page = await doc.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, maxWidth / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/jpeg", 0.82);
    } catch (_e) {
      return "";
    }
  }

  let pdfJsLoadPromise = null;

  function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") {
      return Promise.resolve(pdfjsLib);
    }
    try {
      if (typeof require !== "undefined") {
        const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
        globalThis.pdfjsLib = pdfjs;
        return Promise.resolve(pdfjs);
      }
    } catch (_nodePdf) {
      /* browser fallback below */
    }
    if (!pdfJsLoadPromise) {
      pdfJsLoadPromise = new Promise((resolve, reject) => {
        if (typeof document === "undefined" || !document.head) {
          reject(new Error("PDF.js nem tölthető be."));
          return;
        }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
        s.onload = () => {
          try {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
              "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
          } catch (_e) {
            /* ignore */
          }
          resolve(pdfjsLib);
        };
        s.onerror = () => reject(new Error("PDF.js betöltése sikertelen."));
        document.head.appendChild(s);
      });
    }
    return pdfJsLoadPromise;
  }

  async function extractPdfStructuredLines(arrayBuffer) {
    const pdfjs = await ensurePdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const buckets = new Map();
      content.items.forEach((it) => {
        const y = Math.round(it.transform[5]);
        if (!buckets.has(y)) buckets.set(y, []);
        buckets.get(y).push({ x: it.transform[4], str: String(it.str || "") });
      });
      [...buckets.keys()]
        .sort((a, b) => b - a)
        .forEach((y) => {
          const parts = buckets
            .get(y)
            .sort((a, b) => a.x - b.x)
            .filter((pt) => pt.str.trim());
          if (!parts.length) return;
          out.push({ y, parts, text: parts.map((pt) => pt.str).join(" ").replace(/\s+/g, " ").trim() });
        });
    }
    return out;
  }

  function isMegrendeloPdfItemsHeaderLine(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!t) return false;
    if (/mennyis[eé]g/.test(t) && (/le[ií]r[aá]s/.test(t) || /megnevez/.test(t))) return true;
    if (/mennyis[eé]g/.test(t) && /t[eé]tel/.test(t) && /egys[eé]g[aá]r/.test(t)) return true;
    return false;
  }

  function parseHufPricePairFromLineEnd(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    // Ár csak szóköz után (ne keverje a termékkód számát: F90, FMFSL60, MO72_45).
    const priceRe = /(?:^|\s)(\d{1,3}(?:\s\d{3})+|\d{3,4})\s*Ft/gi;
    const hits = [...t.matchAll(priceRe)];
    if (hits.length < 2) return null;
    const totalHit = hits[hits.length - 1];
    const unitHit = hits[hits.length - 2];
    const tail = t.slice(totalHit.index + totalHit[0].length).trim();
    if (tail) return null;
    return {
      unit: parseHufNumberCell(unitHit[1]),
      total: parseHufNumberCell(totalHit[1]),
      before: t.slice(0, unitHit.index).trim()
    };
  }

  function isPdfOrphanPriceOnlyLine(text) {
    const prices = parseHufPricePairFromLineEnd(text);
    if (!prices) return false;
    const before = String(prices.before || "").trim();
    if (!before) return true;
    return /^\d+(?:[.,]\d+)?$/.test(before);
  }

  function isPdfItemOrphanPriceFragment(text) {
    const s = String(text || "").trim();
    return !s || /^[\d\s.,]+$/.test(s);
  }

  function stripLeadingPdfQty(text) {
    const t = String(text || "").trim();
    const m = t.match(/^(\d+(?:[.,]\d+)?)(?:\s+(?:db|szett|fm|m2|m²)\b)?\s+(.+)$/i);
    if (!m) return { qty: null, text: t };
    return { qty: parseQtyCell(m[1]), text: m[2].trim() };
  }

  function isMegrendeloPdfDescriptionOnlyLine(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t || /Ft/i.test(t)) return false;
    if (isMegrendeloPdfItemsHeaderLine(t)) return false;
    if (/^Előleg:/i.test(t) || /Végösszeg/i.test(t) || /Az árajánlat/i.test(t) || /Az ajánlat/i.test(t)) {
      return false;
    }
    return true;
  }

  function resolvePdfItemNameFromNeighborRows(rawRows, priceIdx, consumed) {
    const prevIdx = priceIdx - 1;
    const nextIdx = priceIdx + 1;
    const prevOk =
      prevIdx >= 0 && !consumed.has(prevIdx) && isMegrendeloPdfDescriptionOnlyLine(rawRows[prevIdx]);
    const nextOk =
      nextIdx < rawRows.length &&
      !consumed.has(nextIdx) &&
      isMegrendeloPdfDescriptionOnlyLine(rawRows[nextIdx]);
    if (nextOk) return { idx: nextIdx, text: rawRows[nextIdx] };
    if (prevOk) return { idx: prevIdx, text: rawRows[prevIdx] };
    return null;
  }

  function pushMegrendeloPdfSnapLine(snapLines, item) {
    if (!item || !item.name) return;
    snapLines.push({
      code: extractCodeFromMegrendeloLineDescription(item.name),
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      total: item.total > 0 ? item.total : item.unit * item.qty
    });
  }

  /** Tételsorok — egy sorban vagy szétvált leírás/ár párokból (PDF sortörés). */
  function collectMegrendeloPdfSnapLines(pdfLines) {
    const snapLines = [];
    let inItems = false;
    const rawRows = [];

    for (const line of pdfLines) {
      const t = String(line.text || "").replace(/\s+/g, " ").trim();
      if (isMegrendeloPdfItemsHeaderLine(t)) {
        inItems = true;
        continue;
      }
      if (!inItems) continue;
      if (/Az árajánlat/i.test(t) || /Az ajánlat/i.test(t)) break;
      if (/^Előleg:/i.test(t) || /Végösszeg/i.test(t)) break;
      rawRows.push(t);
    }

    const consumed = new Set();

    for (let i = 0; i < rawRows.length; i++) {
      if (consumed.has(i)) continue;
      const t = rawRows[i];

      if (isMegrendeloPdfDescriptionOnlyLine(t)) {
        const nextIdx = i + 1;
        if (nextIdx < rawRows.length && !consumed.has(nextIdx) && isPdfOrphanPriceOnlyLine(rawRows[nextIdx])) {
          const prices = parseHufPricePairFromLineEnd(rawRows[nextIdx]);
          if (prices) {
            const stripped = stripLeadingPdfQty(t);
            pushMegrendeloPdfSnapLine(snapLines, {
              qty: stripped.qty != null ? stripped.qty : 1,
              name: stripped.text,
              unit: prices.unit,
              total: prices.total
            });
            consumed.add(i);
            consumed.add(nextIdx);
          }
        }
        continue;
      }

      const prices = parseHufPricePairFromLineEnd(t);
      if (!prices) continue;

      let qty = 1;
      let name = "";
      if (prices.before) {
        const head = prices.before.match(/^(\d+(?:[.,]\d+)?)(?:\s+(?:db|szett|fm|m2|m²)\b)?\s+(.+)$/i);
        if (head) {
          qty = parseQtyCell(head[1]);
          name = String(head[2] || "").trim();
        } else {
          name = prices.before;
        }
      }
      if (isPdfItemOrphanPriceFragment(name)) name = "";

      if (!name) {
        const neighbor = resolvePdfItemNameFromNeighborRows(rawRows, i, consumed);
        if (neighbor) {
          const stripped = stripLeadingPdfQty(neighbor.text);
          if (stripped.qty != null && qty === 1) qty = stripped.qty;
          name = stripped.text;
          consumed.add(neighbor.idx);
        }
      }

      if (!name) continue;
      pushMegrendeloPdfSnapLine(snapLines, {
        qty,
        name,
        unit: prices.unit,
        total: prices.total
      });
      consumed.add(i);
    }

    return snapLines;
  }

  function tryParsePdfItemLine(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t || !/Ft/i.test(t)) return null;

    const prices = parseHufPricePairFromLineEnd(t);
    if (!prices) return null;

    let qty = 1;
    let name = "";
    if (prices.before) {
      const head = prices.before.match(/^(\d+(?:[.,]\d+)?)(?:\s+(?:db|szett|fm|m2|m²)\b)?\s+(.+)$/i);
      if (head) {
        qty = parseQtyCell(head[1]);
        name = String(head[2] || "").trim();
      } else {
        name = prices.before;
      }
    }
    if (isPdfItemOrphanPriceFragment(name)) return null;
    return {
      qty,
      name,
      unit: prices.unit,
      total: prices.total
    };
  }

  function parseMegrendeloPdfFieldBlock(fullText, fileName) {
    const text = String(fullText || "");
    const customer = { name: "", address: "", phone: "", email: "" };
    const kitchen = {
      kitchenType: "",
      korpuszColor: "",
      upperFront: "",
      lowerFront: "",
      worktopStyle: "",
      wallPanelStyle: "",
      kamraUpperFront: "",
      handleStyle: ""
    };

    let quoteNumber = extractQuoteNumberFromText(text) || extractQuoteNumberFromText(fileName);
    const qSplit = text.match(/(MRDH-[A-Z]+-\d{2})[\s-]+(\d{3,4})/i);
    if (qSplit) quoteNumber = (qSplit[1] + "-" + formatMegrendeloQuoteSequence(qSplit[2])).toUpperCase();

    let quoteDate = "";
    const dateM = text.match(/Ajánlatadás dátuma:\s*(\d{4}\.\d{2}\.\d{2}\.?)/i);
    if (dateM) quoteDate = parseDotsDateToIso(dateM[1]);
    if (!quoteDate) {
      const anyDate = text.match(/\b(\d{4}\.\d{2}\.\d{2})\.?/);
      if (anyDate) quoteDate = parseDotsDateToIso(anyDate[1]);
    }

    const emailM = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailM) customer.email = emailM[0];

    const phoneM = text.match(/\b\d{2}\/\d{3}-\d{4}\b/);
    if (phoneM) customer.phone = phoneM[0];

    const pick = (re) => {
      const m = text.match(re);
      return m ? String(m[1]).trim() : "";
    };
    const sanitizeImportedWorktopStyle = (raw) => sanitizeImportedKitchenStyleValue(raw);
    const frontStop = String.raw`(?=\s*(?:Alsó front|Also front|Felső front|Felso front|Email|E-?mail|Telefon|Munkalap|Fogantyú|Fogantyu|Konyha|Mennyiség|$))`;
    customer.name =
      pick(/Vevő\s+neve\s*:?\s*([^\n|]+?)(?=\s{2,}|Vevő\s+címe|Telefon|E-?mail|Konyha|$)/i) ||
      pick(/Vevő neve\s+([^\n]+)/i) ||
      pick(/Név\s*:?\s*([^\n|]+?)(?=\s{2,}|Cím|Telefon|E-?mail|Korpusz|Konyha|$)/i) ||
      pick(/Vásárló\s+neve\s*:?\s*([^\n|]+)/i) ||
      customer.name;
    const labeledAddress =
      pick(/Vevő\s+címe\s*:?\s*([^\n|]+?)(?=\s{2,}|Telefon|E-?mail|Konyha|Korpusz|$)/i) ||
      pick(/Vevő címe\s+([^\n]+)/i) ||
      pick(/Cím\s*:?\s*([^\n|]+?)(?=\s{2,}|Telefon|E-?mail|Korpusz|Konyha|$)/i) ||
      pick(/Vásárló\s+címe\s*:?\s*([^\n|]+)/i);
    if (labeledAddress && isPlausibleMegrendeloCustomerAddress(labeledAddress)) {
      customer.address = labeledAddress;
    } else if (
      !customer.address &&
      typeof PartialInvoiceView !== "undefined" &&
      PartialInvoiceView.extractAddressFromFreeText
    ) {
      customer.address = PartialInvoiceView.extractAddressFromFreeText(text);
    }
    kitchen.korpuszColor = sanitizeImportedKitchenStyleValue(
      pick(/Korpusz\s*\(\s*bútor\s*\)\s*:?\s*([^|\n]+?)(?=\s{2,}|$)/i)
    );
    kitchen.upperFront = sanitizeImportedKitchenStyleValue(
      pick(new RegExp("Felső front:?\\s*([^|\\n]+?)" + frontStop, "i"))
    );
    kitchen.lowerFront = sanitizeImportedKitchenStyleValue(
      pick(new RegExp("Alsó front:?\\s*([^|\\n]+?)" + frontStop, "i"))
    );
    kitchen.kamraUpperFront = sanitizeImportedKitchenStyleValue(
      pick(/Kamra felső front:?\s*([^|\n]+)/i)
    );
    kitchen.worktopStyle = sanitizeImportedWorktopStyle(
      pick(/Munkalap:?\s*([^|\n]+?)(?=\s+Falipanel:|$)/i)
    );
    kitchen.wallPanelStyle = sanitizeImportedKitchenStyleValue(
      pick(/Falipanel:?\s*([^|\n]+?)(?=\s*(?:Konyha|Fogantyú|Fogantyu|Mennyiség|$))/i)
    );
    kitchen.handleStyle = sanitizeImportedKitchenStyleValue(
      pick(/Fogantyú[^:]*:?\s*([^|\n]+)/i)
    );

    const ktM = text.match(/Konyha\s*Típus:\s*([^\n]+)/i);
    if (ktM) {
      kitchen.kitchenType = ktM[1]
        .replace(/\s+Foganty[uú].*$/i, "")
        .replace(/Mennyiség.*/i, "")
        .trim();
    } else {
      const selectM = text.match(/(Select\s+[^\n]+?)(?:\s+Konyha\s*Típus:|$)/i);
      if (selectM) kitchen.kitchenType = selectM[1].trim();
    }

    if (text.includes("Vevő neve") || text.includes("Név") || text.includes("Vásárló")) {
      kitchen.kitchenType =
        sanitizeImportedKitchenStyleValue(
          pick(/Konyha\s+típus\s+([^\n]+?)(?=\s+Foganty[uú]|\s+Korpusz|\s+Munkalap|\s+Mennyiség|$)/i)
        ) || kitchen.kitchenType;
      kitchen.korpuszColor =
        sanitizeImportedKitchenStyleValue(
          pick(/Korpusz\s+(?:\([^)]+\)\s*)?:?\s*([^|\n]+?)(?=\s*(?:Felső|Alsó|Felso|Also|Munkalap|$))/i)
        ) || kitchen.korpuszColor;
      kitchen.worktopStyle =
        sanitizeImportedWorktopStyle(pick(/Munkalap\s+([^\n]+?)(?=\s*(?:Falipanel|Fogantyú|Mennyiség|$))/i)) ||
        kitchen.worktopStyle;
      kitchen.wallPanelStyle =
        sanitizeImportedKitchenStyleValue(
          pick(/Falipanel\s+([^\n]+?)(?=\s*(?:Konyha|Fogantyú|Fogantyu|Mennyiség|$))/i)
        ) || kitchen.wallPanelStyle;
      kitchen.handleStyle =
        sanitizeImportedKitchenStyleValue(
          pick(/Fogantyú\s+([^\n]+?)(?=\s*(?:Mennyiség|Konyha|$))/i)
        ) || kitchen.handleStyle;
      const aruhaz = pick(/Áruház\s+([^\n]+)/i);
      if (aruhaz.toLowerCase().includes("buda")) kitchen.store = "budaors";
    }

    if (!customer.name) customer.name = extractCustomerFromMegrendeloFileName(fileName);
    if (
      customer.name &&
      !isPlausibleMegrendeloCustomerName(customer.name)
    ) {
      customer.name = "";
    }

    return { quoteNumber, quoteDate, customer, kitchen };
  }

  function supplementMegrendeloPdfCustomerFromFullText(customer, fullText) {
    if (!customer || typeof customer !== "object") return;
    const text = String(fullText || "");
    if (!text) return;
    if (!customer.name || isInferredEmailLocalName(customer.name, customer.email)) {
      const nameM = text.match(/N[eé]v\s*:?[^\n]*\n\s*([^\n|]+)/i);
      if (nameM && nameM[1]) {
        const v = String(nameM[1]).trim();
        if (
          isPlausibleMegrendeloCustomerName(v) &&
          !/\b(utca|út|u\.|tér|köz|körút)\b/i.test(v)
        ) {
          customer.name = v;
        }
      }
    }
    if (!customer.address) {
      const addrM = text.match(/C[ií]m\s*:?[^\n]*\n\s*([^\n|]+)/i);
      if (addrM && addrM[1]) {
        const v = String(addrM[1]).trim();
        if (isPlausibleMegrendeloCustomerAddress(v)) customer.address = v;
      }
    }
  }

  function parseMegrendeloPdfLines(pdfLines, fileName) {
    const fullText = pdfLines.map((l) => l.text).join("\n");
    const meta = parseMegrendeloPdfFieldBlock(fullText, fileName);
    enrichCustomerFromMegrendeloPdfLines(meta.customer, pdfLines);
    supplementMegrendeloPdfCustomerFromFullText(meta.customer, fullText);
    enrichKitchenFromMegrendeloPdfLines(meta.kitchen, pdfLines);
    cleanupMegrendeloCustomer(meta.customer);
    const snapLines = collectMegrendeloPdfSnapLines(pdfLines);

    const summary = parseMegrendeloSummaryFromText(fullText);
    const payload = buildMegrendeloPayloadFromParts(
      Object.assign({}, meta, { snapLines, summary, importFullText: fullText, fromPdf: true }),
      fileName
    );
    if (!payload) return null;
    if (!snapLines.length && !meta.customer.name && !meta.kitchen.kitchenType) return null;
    return payload;
  }

  async function parseMegrendeloPdfBuffer(arrayBuffer, fileName) {
    const lines = await extractPdfStructuredLines(arrayBuffer);
    return parseMegrendeloPdfLines(lines, fileName);
  }

  const api = {
    customerNameFromOrderFolder,
    extractCustomerFromMegrendeloFileName,
    extractQuoteNumberFromText,
    extractWorktopStateFromSnapLines,
    extractHardwareLinesFromSnapLines,
    isMegrendeloHardwareSnapLine,
    isMegrendeloWorktopSnapLine,
    parseMegrendeloPdfBuffer,
    parseMegrendeloPdfLines,
    renderMegrendeloPdfPreviewDataUrl,
    extractPdfStructuredLines,
    parseMegrendeloSummaryFromText,
    finalizeMegrendeloSummary,
    formatMegrendeloQuoteSequence,
    resolveMegrendeloSnapLineCode,
    extractLeadingCabinetCodeFromDescription,
    applyMegrendeloKitchenField,
    applyMegrendeloCustomerField,
    applyMegrendeloCustomerFieldsFromExcelRow,
    cleanupMegrendeloCustomer,
    sanitizeImportedKitchenStyleValue,
    buildMegrendeloPayloadFromParts
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.MegrendeloImport = api;
})(typeof window !== "undefined" ? window : globalThis);
