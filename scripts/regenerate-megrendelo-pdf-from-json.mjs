/**
 * Mentett JSON → megrendelő PDF (arajanlat.html export logika + Playwright).
 * Usage: node scripts/regenerate-megrendelo-pdf-from-json.mjs "path/to/MRDH-....json"
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = path.resolve(process.argv[2] || "");
if (!jsonPath) {
  console.error("Usage: node scripts/regenerate-megrendelo-pdf-from-json.mjs <json-path>");
  process.exit(1);
}

const payload = JSON.parse(await fs.readFile(jsonPath, "utf8"));
const quoteNumber = String(payload.quoteNumber || "").trim();
const outPdf = path.join(
  path.dirname(jsonPath),
  quoteNumber ? quoteNumber + "_megrendelo.pdf" : "megrendelo.pdf"
);

async function renderHtmlToPdf(browser, htmlText, fullPath) {
  const page = await browser.newPage();
  try {
    const html = String(htmlText || "");
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.emulateMedia({ media: "print" });
    if (html.includes("pdf-sheet-bg")) {
      await page
        .waitForFunction(
          () => {
            const img = document.querySelector(".pdf-sheet-bg img");
            return Boolean(img && img.complete && img.naturalWidth > 0);
          },
          { timeout: 8000 }
        )
        .catch(() => {});
    }
    await page.waitForTimeout(1500);
    const client = await page.context().newCDPSession(page);
    const pdf = await client.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      scale: 1
    });
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.from(pdf.data, "base64"));
    return fullPath;
  } finally {
    await page.close().catch(() => {});
  }
}

const CHROME_EXECUTABLE_CANDIDATES = [
  process.env.DIVIAN_CHROME_PATH,
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
]
  .map((p) => String(p || "").trim())
  .filter(Boolean);

async function resolvePlaywrightLaunchOptions() {
  if (process.env.DIVIAN_PLAYWRIGHT_NO_CHANNEL === "1") {
    return { headless: true, args: ["--disable-dev-shm-usage"] };
  }
  for (const executablePath of CHROME_EXECUTABLE_CANDIDATES) {
    try {
      await fs.access(executablePath);
      return { headless: true, executablePath, args: ["--disable-dev-shm-usage"] };
    } catch (_err) {
      /* try next */
    }
  }
  return { headless: true, channel: "chrome", args: ["--disable-dev-shm-usage"] };
}

const base = "http://localhost:17321";
let bundle = null;
const browser = await chromium.launch(await resolvePlaywrightLaunchOptions());

try {
  const page = await browser.newPage();
  try {
    await page.goto(base + "/arajanlat.html", { waitUntil: "networkidle", timeout: 180000 });
    await page.waitForFunction(() => typeof exportQuotePdf === "function", { timeout: 120000 });
    bundle = await page.evaluate(async (p) => {
      applyImportedQuote(p);
      const snap = p?.snapshot || {};
      return {
        bundle: await exportQuotePdf(null, { buildOnly: true, payload: p, documentKind: "megrendelo" }),
        totals: {
          finalTotal: snap.finalTotal,
          kitchenDiscountedTotal: snap.kitchenDiscountedTotal,
          discountHuf: snap.discountHuf,
          anchorFinal: quoteSnapshotAnchor?.finalTotal
        }
      };
    }, payload);
    console.log("Snapshot totals:", bundle.totals);
    bundle = bundle.bundle;
  } finally {
    await page.close().catch(() => {});
  }

  if (!bundle?.html) throw new Error("PDF HTML build failed");
  const htmlPath = outPdf.replace(/\.pdf$/i, "_regen.html");
  await fs.writeFile(htmlPath, bundle.html, "utf8");
  const hasNew = bundle.html.includes("1 617 740") || bundle.html.includes("1617740");
  const hasOld = bundle.html.includes("1 619 130") || bundle.html.includes("1619130");
  console.log("HTML check:", { hasNew, hasOld, htmlPath });
  const saved = await renderHtmlToPdf(browser, bundle.html, outPdf);
  console.log("OK:", saved);
} finally {
  await browser.close().catch(() => {});
}
