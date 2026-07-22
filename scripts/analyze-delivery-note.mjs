/**
 * Szállítólevél elemzés egy megrendelő PDF-ből.
 * node scripts/analyze-delivery-note.mjs "path\to\megrendelo.pdf"
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

const pdfPath = process.argv[2];
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error("Használat: node scripts/analyze-delivery-note.mjs <pdf-path>");
  process.exit(1);
}

require(path.join(root, "divian-cabinet-codes.js"));
require(path.join(root, "divian-megrendelo-import.js"));
require(path.join(root, "partial-invoice-view.js"));

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
globalThis.pdfjsLib = pdfjs;

const buf = fs.readFileSync(pdfPath);
const payload = await globalThis.MegrendeloImport.parseMegrendeloPdfBuffer(
  buf,
  path.basename(pdfPath)
);
const lines = payload?.snapshot?.lines || [];
const dn = globalThis.PartialInvoiceView.buildDeliveryNoteData(
  Object.assign({}, payload, { _megrendeloImport: true, _fromMegrendeloPdf: true })
);

console.log("=== Megrendelő PDF ===");
console.log("Ajánlat:", payload?.quoteNumber || "—");
console.log("Sorok a PDF-ben:", lines.length);
console.log("");
console.log("=== Szállítólevél összesítő ===");
console.log("Konyhabútor db:", dn.cabinetDbTotal);
console.log("Munkalap darab:", dn.worktopPieceCount);
console.log("Fali panel darab:", dn.wallPanelPieceCount || 0);
console.log("Magas álló elem:", dn.tallCabinetDbTotal);
console.log("Nagyker tételek:", dn.nagykerRows?.length || 0);
console.log("");
console.log("--- Összesítő sorok ---");
(dn.summaryRows || []).forEach((r) => {
  console.log(`  ${r.megnevezes}: ${r.qty} ${r.unit}`);
});
if (dn.nagykerRows?.length) {
  console.log("");
  console.log("--- Nagyker ---");
  dn.nagykerRows.forEach((r) => {
    console.log(`  ${r.megnevezes}: ${r.qty} ${r.unit}`);
  });
}

console.log("");
console.log("=== PDF tételek (kóddal) ===");
const cabinetCodes = globalThis.DivianCabinetCodes || {};
const isCabinet =
  typeof cabinetCodes.isOfficialCabinetCode === "function"
    ? cabinetCodes.isOfficialCabinetCode
    : () => false;

let cabinetLineTotal = 0;
const counted = [];
const skipped = [];
lines.forEach((l, i) => {
  const code = String(l.code || "").trim().toUpperCase();
  const name = String(l.name || "").trim();
  const qty = Math.max(0, Number(l.qty) || 0);
  if (!code && !qty && !name) return;
  const lineObj = { code: l.code, name: l.name, qty: l.qty, category: l.category };
  const PIV = globalThis.PartialInvoiceView;
  const countable =
    PIV &&
    typeof PIV.buildDeliveryNoteData === "function" &&
    code &&
    globalThis.DivianCabinetCodes?.isFurnitureElementCode?.(code);
  const isLot = /^LOT\d/i.test(code);
  const entry = `${String(i + 1).padStart(2)}. ${code || "—"} x${qty} ${name.slice(0, 55)}`;
  if (countable && !isLot) {
    cabinetLineTotal += qty;
    counted.push(entry);
  } else {
    skipped.push(entry + (isLot ? " [LOT kieg.]" : code ? "" : " [nincs kód]"));
  }
});
console.log("");
console.log("=== Számított bútor elemek (13 várható) ===");
counted.forEach((e) => console.log(" ", e));
console.log("");
console.log("=== NEM bútor db-be (kiegészítő / munkalap / láb) ===");
skipped.forEach((e) => console.log(" ", e));
console.log("");
console.log("Cabinet qty sum (kódlista):", cabinetLineTotal);
