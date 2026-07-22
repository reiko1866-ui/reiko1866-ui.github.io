/**
 * Batch: 2026 megrendelőlap mappa → szállítólevél ellenőrzés
 * Usage: node scripts/batch-delivery-note-megrendelo-2026.mjs [root-folder]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import XLSX from "xlsx";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

global.window = global;
global.DivianCabinetCodes = require(path.join(root, "divian-cabinet-codes.js"));
require(path.join(root, "divian-extras-kiadvany.js"));
require(path.join(root, "partial-invoice-view.js"));
const MegrendeloImport = require(path.join(root, "divian-megrendelo-import.js"));
const PartialInvoiceView = global.PartialInvoiceView;

const scanRoot =
  process.argv[2] ||
  "F:/Budapest Váci út közös mappa/Megrendelőlapok/2026";

function parseHufNumberCell(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return Math.max(0, Math.round(Number(digits) || 0));
}

function parseQtyCell(value) {
  const m = String(value || "").match(/[\d]+(?:[.,]\d+)?/);
  if (!m) return 1;
  return Math.max(0, Number(String(m[0]).replace(",", ".")) || 0) || 1;
}

function normalizeMegrendeloLabel(value) {
  return String(value || "")
    .trim()
    .replace(/:+$/, "")
    .replace(/\s+/g, " ");
}

function cell(row, col) {
  return col >= 0 ? String(row[col] ?? "").trim() : "";
}

function isMegrendeloExcelAoA(aoa) {
  if (!Array.isArray(aoa) || !aoa.length) return false;
  return aoa.some((row) => {
    const joined = (row || []).map((c) => String(c ?? "")).join(" ");
    return joined.includes("MEGRENDEL") || String(row[0] || "").includes("Megrendelés száma");
  });
}

function findMegrendeloItemTableColumns(aoa) {
  for (let i = 0; i < aoa.length; i++) {
    const cells = (aoa[i] || []).map((c) => normalizeMegrendeloLabel(c));
    const qtyCol = cells.findIndex((c) => c === "Mennyiség" || c.startsWith("Mennyiség"));
    const descCol = cells.findIndex((c) => c === "Leírás");
    if (qtyCol >= 0 && descCol >= 0) {
      const unitCol = cells.findIndex((c) => c.includes("Egységár"));
      const totalCol = cells.findIndex((c) => c.includes("Összeg"));
      return { headerRow: i, qtyCol, descCol, unitCol, totalCol };
    }
  }
  return null;
}

function isMegrendeloItemStopRow(labelCells) {
  const joined = labelCells.join(" ").toLowerCase();
  if (!joined.trim()) return false;
  if (joined.includes("az ajánlat") || joined.includes("az árajánlat")) return true;
  if (joined.startsWith("előleg")) return true;
  if (joined.startsWith("szállítási díj")) return true;
  if (joined.includes("végösszeg")) return true;
  return false;
}

function parseMegrendeloExcelAoA(aoa, fileName, sourceFolder) {
  if (!isMegrendeloExcelAoA(aoa)) return null;

  let quotePrefix = "";
  let quoteSeq = "";
  let quoteNumber = "";
  const customer = { name: "", address: "", phone: "", email: "" };
  const kitchen = {
    kitchenType: "",
    korpuszColor: "",
    upperFront: "",
    lowerFront: "",
    worktopStyle: "",
    handleStyle: ""
  };
  const snapLines = [];
  const itemCols = findMegrendeloItemTableColumns(aoa);

  for (const row of aoa) {
    const cells = (row || []).map((c) => String(c ?? "").trim());
    MegrendeloImport.applyMegrendeloCustomerFieldsFromExcelRow?.(customer, cells);
    const full = cells.join(" ");
    const fullQuote = full.match(/(MRDH-[A-Z]+-\d{2}-\d{3,4})/i);
    if (fullQuote) quoteNumber = fullQuote[1].toUpperCase();
    for (let c = 0; c < cells.length; c++) {
      const label = normalizeMegrendeloLabel(cells[c]);
      const value = String(cells[c + 1] ?? "").trim();
      if (/^MRDH-[A-Z]+-\d{2}$/i.test(label) && /^\d+$/.test(value)) {
        quotePrefix = label.toUpperCase();
        quoteSeq = value;
      }
      if (label.startsWith("Konyha Típus") && value) kitchen.kitchenType = value;
      if (label.includes("Korpusz") && label.includes("bútor") && value) kitchen.korpuszColor = value;
      if (label === "Munkalap" && value) kitchen.worktopStyle = value;
    }
  }

  if (!quoteNumber && quotePrefix && quoteSeq) {
    quoteNumber = quotePrefix + "-" + MegrendeloImport.formatMegrendeloQuoteSequence(quoteSeq);
  }

  if (itemCols) {
    for (let i = itemCols.headerRow + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const labels = row.map((c) => String(c ?? "").trim());
      if (isMegrendeloItemStopRow(labels)) break;
      const qtyRaw = cell(row, itemCols.qtyCol);
      const name = cell(row, itemCols.descCol);
      if (!name) continue;
      const qty = parseQtyCell(qtyRaw);
      const unitGross = itemCols.unitCol >= 0 ? parseHufNumberCell(cell(row, itemCols.unitCol)) : 0;
      const totalGross = itemCols.totalCol >= 0 ? parseHufNumberCell(cell(row, itemCols.totalCol)) : 0;
      snapLines.push({
        code: "",
        name,
        qty,
        unit: unitGross,
        total: totalGross > 0 ? totalGross : unitGross * qty
      });
    }
  }

  if (!customer.name && fileName) {
    customer.name = MegrendeloImport.extractCustomerFromMegrendeloFileName(fileName);
  }

  const summary = MegrendeloImport.parseMegrendeloSummaryFromText(
    aoa.map((r) => (r || []).join(" ")).join("\n")
  );
  return MegrendeloImport.buildMegrendeloPayloadFromParts(
    { quoteNumber, customer, kitchen, snapLines, summary, sourceFolder: sourceFolder || "" },
    fileName
  );
}

function pickMegrendeloXlsx(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath).filter((f) => /\.xlsx$/i.test(f));
  if (!files.length) return null;
  const valtozatott = files.filter((f) => /változtatott|valtoztatott/i.test(f));
  const pick = valtozatott.sort().pop() || files.sort().pop();
  return path.join(dirPath, pick);
}

function looksLikeKitchenCabinetLine(name) {
  const t = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/^(af|aml|amo|asm|aszb|f\d|ffz|fkf|fsl|mo\d|ktb|as110|ef60|ar20|akl|ltfk)/i.test(t)) return true;
  if (/\b(also|felso)\s+elem\b/.test(t)) return true;
  if (/\bmosogatos?\s+elem\b/.test(t)) return true;
  if (/\bsarokelem\b/.test(t)) return true;
  if (/\bfozolaphoz\b/.test(t)) return true;
  if (/\bbeepitett\s+suto/.test(t)) return true;
  return false;
}

function analyzeOrder(dirPath, xlsxPath) {
  const fileName = path.basename(xlsxPath);
  const wb = XLSX.readFile(xlsxPath);
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const payload = parseMegrendeloExcelAoA(aoa, fileName, dirPath);
  if (!payload) return { ok: false, reason: "parse-fail", folder: path.basename(dirPath), file: fileName };

  const dn = PartialInvoiceView.buildDeliveryNoteData(payload);
  const snap = payload.snapshot?.lines || [];
  const selected = (payload.state?.selected || []).map(([, l]) => l);
  const kiadvany = payload.state?.kiadvanyExtrasLines || [];

  const cabinetLikeSnap = snap.filter((l) => looksLikeKitchenCabinetLine(l.name));
  const cabinetLikeNoCode = cabinetLikeSnap.filter((l) => !String(l.code || "").trim());
  const lotInSelected = selected.filter((l) => /^LOT\d/i.test(String(l.code || "")));
  const genericTap = (dn.nagykerRows || []).filter((r) => /^Csaptelep$/i.test(String(r.megnevezes || "").trim()));
  const taps = (dn.nagykerRows || []).filter((r) => /csaptelep|DIV-CSOM|vegasi|estell|nook|linea|csomag:/i.test(r.megnevezes));
  const missingFromSelected = cabinetLikeSnap.filter((line) => {
    const code = String(line.code || "").trim().toUpperCase();
    const name = String(line.name || "").trim().toLowerCase();
    return !selected.some((s) => {
      const sc = String(s.code || "").trim().toUpperCase();
      const sn = String(s.name || "").trim().toLowerCase();
      return (code && sc === code) || sn === name;
    });
  });

  const issues = [];
  if (/MRDH-[A-Z]+-\d{2}-0\d{3}$/.test(payload.quoteNumber || "")) {
    issues.push("quote-padded-0");
  }
  if (cabinetLikeSnap.length > 0 && dn.cabinetDbTotal <= 0) issues.push("zero-cabinet-db");
  if (cabinetLikeNoCode.length > 0) issues.push("cabinet-no-code:" + cabinetLikeNoCode.length);
  if (lotInSelected.length > 0) issues.push("lot-in-selected:" + lotInSelected.length);
  if (missingFromSelected.length > 0) issues.push("missing-selected:" + missingFromSelected.length);
  if (genericTap.length > 0) issues.push("generic-csaptelep");
  if (snap.length === 0) issues.push("empty-snap");

  return {
    ok: true,
    folder: path.basename(dirPath),
    quote: payload.quoteNumber || "?",
    customer: payload.customer?.name || MegrendeloImport.extractCustomerFromMegrendeloFileName(fileName),
    file: fileName,
    snapLines: snap.length,
    cabinetDb: dn.cabinetDbTotal,
    tallDb: dn.tallCabinetDbTotal,
    worktopPieces: dn.worktopPieceCount,
    nagyker: dn.nagykerRows?.length || 0,
    taps: taps.map((r) => r.megnevezes),
    kiadvany: kiadvany.length,
    issues,
    missingFromSelected: missingFromSelected.map((l) => l.name).slice(0, 5)
  };
}

const dirs = fs
  .readdirSync(scanRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(scanRoot, d.name));

const results = [];
const skipped = [];

for (const dir of dirs.sort()) {
  const xlsx = pickMegrendeloXlsx(dir);
  if (!xlsx) {
    skipped.push(path.basename(dir));
    continue;
  }
  try {
    results.push(analyzeOrder(dir, xlsx));
  } catch (e) {
    results.push({
      ok: false,
      folder: path.basename(dir),
      reason: String(e.message || e),
      file: path.basename(xlsx)
    });
  }
}

const withIssues = results.filter((r) => r.ok && r.issues?.length > 0);
const failed = results.filter((r) => !r.ok);
const ok = results.filter((r) => r.ok && (!r.issues || r.issues.length === 0));

console.log("=== BATCH SZÁLLÍTÓLEVÉL — 2026 megrendelőlapok ===");
console.log("Mappa:", scanRoot);
console.log("Mappák:", dirs.length);
console.log("Feldolgozva (xlsx):", results.length);
console.log("Xlsx nélkül:", skipped.length);
console.log("Sikeres, nincs jelzés:", ok.length);
console.log("Sikeres, van jelzés:", withIssues.length);
console.log("Hiba:", failed.length);

if (failed.length) {
  console.log("\n--- HIBÁK ---");
  failed.slice(0, 30).forEach((r) => console.log(r.folder, "|", r.reason, "|", r.file));
  if (failed.length > 30) console.log("... +" + (failed.length - 30) + " további");
}

const issueCounts = {};
withIssues.forEach((r) => {
  r.issues.forEach((i) => {
    const key = i.split(":")[0];
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  });
});

console.log("\n--- JELZÉS TÍPUSOK ---");
Object.entries(issueCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(" ", k + ":", v));

console.log("\n--- ÉRINTETT MEGRENDELÉSEK (első 40) ---");
withIssues.slice(0, 40).forEach((r) => {
  console.log(
    r.quote,
    "|",
    r.customer?.slice(0, 28),
    "| db:",
    r.cabinetDb,
    "| mlap:",
    r.worktopPieces,
    "|",
    r.issues.join(", ")
  );
  if (r.missingFromSelected?.length) {
    console.log("   hiányzik:", r.missingFromSelected.join(" | "));
  }
  if (r.taps?.length) console.log("   csap:", r.taps.join(" | "));
});

const tapOrders = results.filter((r) => r.ok && r.taps?.length);
console.log("\n--- CSAPTELEP / CSOMAG SOROK (" + tapOrders.length + ") ---");
tapOrders.forEach((r) => console.log(r.quote, "->", r.taps.join(" | ")));

console.log("\n--- ÖSSZESÍTŐ (minden sikeres) ---");
const totals = results.filter((r) => r.ok);
console.log(
  "Átlag bútor db:",
  (totals.reduce((s, r) => s + r.cabinetDb, 0) / Math.max(1, totals.length)).toFixed(1)
);
console.log(
  "Munkalap >0:",
  totals.filter((r) => r.worktopPieces > 0).length,
  "/",
  totals.length
);
