const { chromium } = require("playwright");
const http = require("http");
const { handleSzamlazzRequest, verifyModuleLoads } = require("./szamlazz-integration");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");
const {
  ORDER_SAVE_DIR,
  saveOrderJsonToDesktop,
  scanOrderSaveDir,
  scanOrderSaveDirEnriched,
  readOrderSaveFile,
  resolveQuoteJsonFromDisk,
  readOrderSavePdfBuffer,
  resolveOrderSaveTargetAsync
} = require("./divian-saved-orders");
const { resolveDeliveryNotePdfTarget } = require("./divian-order-folder");
const {
  isDeliveryNoteDisabled,
  deliveryNoteDisabledError,
  getFeatureFlagsSnapshot
} = require("./divian-feature-flags");

function loadMegrendeloImportModule() {
  if (loadMegrendeloImportModule._api) return loadMegrendeloImportModule._api;
  try {
    require("./divian-cabinet-codes.js");
    require("./divian-megrendelo-import.js");
    loadMegrendeloImportModule._api = global.MegrendeloImport || globalThis.MegrendeloImport || null;
  } catch (err) {
    console.warn("[Init] MegrendeloImport betöltés hiba:", err?.message || err);
    loadMegrendeloImportModule._api = null;
  }
  return loadMegrendeloImportModule._api;
}

async function parseMegrendeloPdfPayloadFromDisk(quoteNumberOrText) {
  const quote = String(quoteNumberOrText || "").trim();
  if (!quote) return { ok: false, error: "missing-quote" };
  const hit = await readOrderSavePdfBuffer(quote);
  if (!hit.ok || !hit.buffer) {
    return {
      ok: false,
      error: hit.error || "pdf-not-found",
      quote,
      fileName: hit.fileName || null,
      folder: ORDER_SAVE_DIR
    };
  }
  const mi = loadMegrendeloImportModule();
  if (!mi || typeof mi.parseMegrendeloPdfBuffer !== "function") {
    return { ok: false, error: "import-module-missing", quote, fileName: hit.fileName || null };
  }
  const fileName =
    String(hit.fileName || "")
      .split(/[/\\]/)
      .pop() || quote + "_megrendelo.pdf";
  const payload = await mi.parseMegrendeloPdfBuffer(hit.buffer, fileName);
  if (!payload) {
    return {
      ok: false,
      error: "parse-null",
      quote: hit.quoteNumber || quote,
      fileName: hit.fileName || fileName,
      byteLength: hit.byteLength || hit.buffer.length
    };
  }
  const lineCount = Array.isArray(payload.snapshot?.lines) ? payload.snapshot.lines.length : 0;
  return {
    ok: true,
    quoteNumber: hit.quoteNumber || quote,
    fileName: hit.fileName || fileName,
    orderFolder: hit.orderFolder || null,
    lineCount,
    payload
  };
}

const {
  readFelmeresQueue,
  writeFelmeresQueue,
  appendFelmeresEntry,
  updateFelmeresEntry,
  deleteFelmeresEntry,
  applySzerelesSchedule,
  preserveScheduleFields,
  QUEUE_FILE
} = require("./divian-felmeres-queue");
const { readAdminSettings, writeAdminSettings, SETTINGS_FILE } = require("./divian-admin-settings");
const {
  buildDivianIcsFeed,
  verifyCalendarToken,
  mergeCalendarSettings
} = require("./divian-calendar-ics");
const { handleCrmApi } = require("./divian-crm");
const { handleMiniCrmApi } = require("./divian-minicrm-api");
const {
  resolvePublicBaseUrl,
  asztalosAppUrl,
  writeActiveTunnelUrl,
  writeManualPublicUrl,
  adminCenterLanUrl,
  readAdminPublicUrl
} = require("./divian-public-url");
const {
  authenticateCarpenter,
  assertCarpenterJobAccess,
  listOpenSzerelesJobs,
  listAllSzerelesJobs,
  jobSummary,
  addSzerelesPhoto,
  addSzerelesDrawing,
  closeSzerelesJob,
  closeFelmeresJob,
  resolvePhotoPath,
  resolveDrawingPath,
  drawingContentType,
  validateFelmeresPatch,
  normalizeInstallationCrew,
  prepareFelmeresPatch,
  findJobById: findSzerelesJobById
} = require("./divian-szereles-app");

const TARGET_HINT = "item-lists";
const FORWARD_ENDPOINT = "http://localhost/sajat_program/api_fogado.php";
/** Cyncly tervező induló oldal (partnership=divian). Ha nincs még session, a szolgáltató a bejelentkezésre irányít.) */
const CYNCLY_START_URL =
  "https://planner.cyncly-idealspaces.com/hu/design/Draft?partnership=divian";
const CYNCLY_DRAFT_URL = CYNCLY_START_URL;
const CYNCLY_PLANNER_URL_FILE = path.join(__dirname, "divian-planner-url.txt");
function isValidCynclyPlannerUrl(url) {
  const u = String(url || "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.hostname !== "planner.cyncly-idealspaces.com") return false;
    if (parsed.searchParams.get("partnership") !== "divian") return false;
    const path = String(parsed.pathname || "").toLowerCase();
    if (path.includes("/hu/design/")) return true;
    if (/^\/hu\/[^/]+\/edit\/?$/i.test(path)) return true;
    return false;
  } catch (_err) {
    return false;
  }
}

function readPlannerUrlFromFile() {
  try {
    const raw = fs.readFileSync(CYNCLY_PLANNER_URL_FILE, "utf8");
    const line = String(raw || "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .find((x) => x && !x.startsWith("#"));
    if (line && isValidCynclyPlannerUrl(line)) return line;
  } catch (_err) {}
  return "";
}

function resolveCynclyPlannerUrl(override) {
  const o = String(override || "").trim();
  if (o && isValidCynclyPlannerUrl(o)) return o;
  const fromEnv = process.env.CYNCLY_PLANNER_URL && String(process.env.CYNCLY_PLANNER_URL).trim();
  if (fromEnv && isValidCynclyPlannerUrl(fromEnv)) return fromEnv;
  const fromFile = readPlannerUrlFromFile();
  if (fromFile) return fromFile;
  return CYNCLY_DRAFT_URL;
}

function plannerProjectKey(url) {
  try {
    const path = String(new URL(String(url || "")).pathname || "");
    let m = path.match(/\/hu\/design\/([^/]+)/i);
    if (m) return m[1].toLowerCase();
    m = path.match(/\/hu\/([^/]+)\/edit/i);
    if (m) return m[1].toLowerCase();
    return "";
  } catch (_err) {
    return "";
  }
}

function isCynclyAuthUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.includes("b2clogin.com") || u.includes("login.cyncly") || u.includes("login.cyndly.com");
}

function isPlannerAppUrl(url) {
  return String(url || "").includes("planner.cyncly-idealspaces.com");
}

const ARAJANLAT_URL_FILE = path.join(__dirname, "divian-arajanlat-url.txt");

function pathToArajanlatFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function fileUrlToLocalPath(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    if (/^file:/i.test(s)) return fileURLToPath(s);
  } catch (_err) {
    /* */
  }
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\")) return path.resolve(s);
  return "";
}

function isExistingFilePath(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

function readArajanlatUrlFromTxtFile() {
  try {
    const raw = fs.readFileSync(ARAJANLAT_URL_FILE, "utf8");
    return (
      String(raw || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#")) || ""
    );
  } catch (_err) {
    return "";
  }
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SCREENSHOT_API_PORT = 17321;

function readLanHostFromFile() {
  try {
    const lanFile = path.join(__dirname, "divian-lan-host.txt");
    const ip = fs.readFileSync(lanFile, "utf8").trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  } catch (_err) {}
  return "";
}

const LAN_HOST_FROM_FILE = readLanHostFromFile();
/** Alap 127.0.0.1; ha van divian-lan-host.txt → 0.0.0.0 (telefon / LAN). Felülírás: SCREENSHOT_API_HOST */
const SCREENSHOT_API_HOST =
  process.env.SCREENSHOT_API_HOST && String(process.env.SCREENSHOT_API_HOST).trim()
    ? String(process.env.SCREENSHOT_API_HOST).trim()
    : LAN_HOST_FROM_FILE
      ? "0.0.0.0"
      : "127.0.0.1";
/** Playwright / helyi böngésző — mindig localhost (ne divian-lan-host.txt, az más gép IP-je lehet). */
const STATIC_BROWSER_HOST =
  process.env.DIVIAN_STATIC_BROWSER_HOST && String(process.env.DIVIAN_STATIC_BROWSER_HOST).trim()
    ? String(process.env.DIVIAN_STATIC_BROWSER_HOST).trim()
    : "localhost";
const STATIC_ROOT = __dirname;

const STATIC_MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".bat": "text/plain; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12"
};

function buildLocalArajanlatHttpUrl(fileName) {
  const name = String(fileName || "arajanlat.html").replace(/^[/\\]+/, "");
  return "http://" + STATIC_BROWSER_HOST + ":" + SCREENSHOT_API_PORT + "/" + name;
}

/** Telefon / másik gép ugyanazon Wi‑Fi-n — divian-lan-host.txt IP (ha van). */
function buildLanHttpUrl(fileName) {
  const name = String(fileName || "arajanlat.html").replace(/^[/\\]+/, "");
  const host = LAN_HOST_FROM_FILE || STATIC_BROWSER_HOST;
  return "http://" + host + ":" + SCREENSHOT_API_PORT + "/" + name;
}

/** Helyi arajanlat → http://localhost:17321/… (statikus szerver); env/txt csak http(s) felülírás. */
function resolveArajanlatUrl() {
  const localHtmlCandidates = [
    path.join(__dirname, "arajanlat.html"),
    path.join(__dirname, "..", "arajanlat.html")
  ];
  const fromTxt = readArajanlatUrlFromTxtFile();
  const fromEnv = process.env.ARAJANLAT_URL && String(process.env.ARAJANLAT_URL).trim();
  const remoteCandidates = [fromTxt, fromEnv].filter(Boolean);

  for (const cand of remoteCandidates) {
    const low = cand.toLowerCase();
    if (low.startsWith("http://") || low.startsWith("https://")) {
      console.log("[Init] ARAJANLAT_URL (http felülírás):", cand);
      return cand;
    }
  }

  for (const fp of localHtmlCandidates) {
    if (isExistingFilePath(fp)) {
      const href = buildLocalArajanlatHttpUrl(path.basename(fp));
      console.log("[Init] ARAJANLAT_URL (helyi HTTP szerver):", href);
      return href;
    }
  }

  for (const cand of remoteCandidates) {
    const disk = fileUrlToLocalPath(cand);
    if (isExistingFilePath(disk)) {
      const href = buildLocalArajanlatHttpUrl(path.basename(disk));
      console.log("[Init] ARAJANLAT_URL:", href);
      return href;
    }
    console.warn(
      "[Init] Érvénytelen ARAJANLAT_URL (fájl nem létezik ezen a gépen), kihagyva:",
      cand.slice(0, 160)
    );
  }

  const fallback = path.join(__dirname, "arajanlat.html");
  console.warn("[Init] arajanlat.html nem található, alapértelmezett URL:", buildLocalArajanlatHttpUrl());
  return buildLocalArajanlatHttpUrl();
}
const ARAJANLAT_URL = resolveArajanlatUrl();

/** Playwright / parancspult induló lap — alapból dashboard (beágyazott árajánlat szinkron). */
function resolveQuoteUiUrl() {
  const fromEnv = process.env.DIVIAN_QUOTE_UI_URL && String(process.env.DIVIAN_QUOTE_UI_URL).trim();
  if (fromEnv) {
    const low = fromEnv.toLowerCase();
    if (low.startsWith("http://") || low.startsWith("https://")) return fromEnv;
  }
  if (envFlagForwarder("DIVIAN_USE_DASHBOARD", true)) {
    const dashPath = path.join(__dirname, "dashboard.html");
    if (isExistingFilePath(dashPath)) {
      return buildLocalArajanlatHttpUrl("dashboard.html");
    }
  }
  return ARAJANLAT_URL;
}

const QUOTE_UI_URL = resolveQuoteUiUrl();
const SZAMLA_ELORESZLET_URL = buildLocalArajanlatHttpUrl("szamla-eloreszlet.html");

function resolveStaticFilePath(urlPathname) {
  let decoded = decodeURIComponent(String(urlPathname || ""));
  if (decoded === "/" || decoded === "") decoded = "/arajanlat.html";
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const relative = normalized.replace(/^[/\\]+/, "");
  if (!relative) return null;
  const abs = path.resolve(STATIC_ROOT, relative);
  const rel = path.relative(STATIC_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

async function tryServeStaticFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const filePath = resolveStaticFilePath(pathname);
  if (!filePath) return false;
  let st;
  try {
    st = await fsPromises.stat(filePath);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_MIME_TYPES[ext] || "application/octet-stream";
  const body = await fsPromises.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache"
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
  return true;
}
const DESKTOP_DIR = path.join(process.env.USERPROFILE || os.homedir(), "Desktop");
const QUOTE_EXCEL_DIR = process.env.DIVIAN_QUOTE_EXCEL_DIR
  ? path.resolve(String(process.env.DIVIAN_QUOTE_EXCEL_DIR))
  : path.join(DESKTOP_DIR, "Megrendelőlap Excel");
const DELIVERY_NOTE_EXCEL_DIR = process.env.DIVIAN_DELIVERY_NOTE_EXCEL_DIR
  ? path.resolve(String(process.env.DIVIAN_DELIVERY_NOTE_EXCEL_DIR))
  : path.join(DESKTOP_DIR, "Szállítólevelek Excel");
const DELIVERY_NOTE_PDF_DIR = process.env.DIVIAN_DELIVERY_NOTE_PDF_DIR
  ? path.resolve(String(process.env.DIVIAN_DELIVERY_NOTE_PDF_DIR))
  : path.join(DESKTOP_DIR, "Szállítólevelek PDF");
const NAGYKER_EXCEL_DIR = process.env.DIVIAN_NAGYKER_EXCEL_DIR
  ? path.resolve(String(process.env.DIVIAN_NAGYKER_EXCEL_DIR))
  : path.join(DESKTOP_DIR, "Divian Nagyker");
/** Közös profil: deploy bundle és fő mappa ugyanazt a Cyncly sessiont és üzleti fióklistát használja. */
const DIVIAN_USER_DATA_ROOT = process.env.DIVIAN_USER_DATA_DIR
  ? path.resolve(String(process.env.DIVIAN_USER_DATA_DIR))
  : path.join(process.env.USERPROFILE || os.homedir(), ".divian-kalkulator");
const AUTH_ACCOUNTS_FILE = path.join(DIVIAN_USER_DATA_ROOT, "divian-auth-accounts.json");

function ensureDivianUserDataRoot() {
  fs.mkdirSync(DIVIAN_USER_DATA_ROOT, { recursive: true });
}

function resolvePlaywrightUserDataDir() {
  ensureDivianUserDataRoot();
  const sharedDir = path.join(DIVIAN_USER_DATA_ROOT, "pw-user-data");
  const localDir = path.join(__dirname, "pw-user-data");
  try {
    if (!fs.existsSync(sharedDir) && fs.existsSync(localDir)) {
      console.log("[Init] Cyncly session másolása közös profilba:", sharedDir);
      fs.cpSync(localDir, sharedDir, { recursive: true });
    }
  } catch (copyErr) {
    console.warn("[Init] pw-user-data másolás sikertelen:", copyErr?.message || copyErr);
  }
  return sharedDir;
}

function clearChromeProfileLock(userDataDir) {
  const names = ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"];
  let removed = 0;
  for (const name of names) {
    try {
      const filePath = path.join(userDataDir, name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removed += 1;
        console.log("[Init] Chrome lock törölve:", name);
      }
    } catch (_err) {}
  }
  return removed;
}

function isChromeProfileLockError(err) {
  const msg = String(err?.message || err || "");
  return /exitCode=21|ProcessSingleton|has been closed|profile appears to be in use/i.test(msg);
}

async function launchPlaywrightContext(userDataDir, launchOpts) {
  clearChromeProfileLock(userDataDir);
  try {
    return await chromium.launchPersistentContext(userDataDir, launchOpts);
  } catch (err) {
    if (!isChromeProfileLockError(err)) throw err;
    console.warn("[Init] Chrome nem indult (profil zárolt?) — lock törlés + újrapróbálás…");
    clearChromeProfileLock(userDataDir);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return chromium.launchPersistentContext(userDataDir, launchOpts);
  }
}

function normalizeAuthAccountsList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((acc) => ({
      email: String(acc?.email || "")
        .trim()
        .toLowerCase(),
      password: String(acc?.password || "")
    }))
    .filter((acc) => acc.email && acc.email.includes("@") && acc.password);
}

function readAuthAccountsFromFile() {
  try {
    if (!fs.existsSync(AUTH_ACCOUNTS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(AUTH_ACCOUNTS_FILE, "utf8"));
    return normalizeAuthAccountsList(parsed?.accounts || parsed);
  } catch (_err) {
    return [];
  }
}

function writeAuthAccountsToFile(accounts) {
  ensureDivianUserDataRoot();
  const cleaned = normalizeAuthAccountsList(accounts);
  fs.writeFileSync(
    AUTH_ACCOUNTS_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), accounts: cleaned }, null, 2),
    "utf8"
  );
  return cleaned;
}

function safeString(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function parseCommercialQty(value) {
  const cleaned = String(value ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.floor(n));
}

function normalizeDishwasherFrontCode(code) {
  const up = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\uFEFF/g, "");
  const legacy = up.match(/^LMO(\d+_\d+)$/);
  if (legacy) return "MO" + legacy[1];
  const direct = up.match(/^(MO\d+_\d+)$/);
  if (direct) return direct[1];
  return up;
}

/** Cyncly terméklista: ezek ne menjenek az árajánlat átkérésébe. */
function isPlannerTransferExcluded(rawCode, rawName) {
  const code = String(rawCode || "")
    .trim()
    .toUpperCase()
    .replace(/\uFEFF/g, "");
  const base = code.split("_")[0].toUpperCase();
  const name = String(rawName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/^GEN[_-]?/i.test(code) || /^GEN[_-]?/i.test(base)) return true;
  if (/\bminta\b/.test(name) && /\b(mikro|suto|huto|gep|oven|fridge|hood)\b/.test(name)) return true;

  if (base === "MPF" || code.startsWith("MPF_")) return true;
  if (/\bfalipanel\b/.test(name)) return true;

  if (/^LE\d+/.test(base) || /^LE\d+/.test(code)) return true;
  if (/\b(labazat|labelo|toekick|plinth|kickboard)\b/.test(name)) return true;

  if (/^PFL/.test(base) || /^PFL/.test(code)) return true;
  if (/\b(muanyag\s*lab|butorlab)\b/.test(name)) return true;
  if (/^M\d{1,3}$/.test(base) && /\b(lab|labak)\b/.test(name)) return true;

  if (/^(KANFF|LIF)$/i.test(base) || /^(KANFF|LIF)$/i.test(code)) return true;
  if (/^(KANFF|LIF)_/i.test(code)) return true;

  if (/^LTF\d/i.test(base) || /^LTF\d/i.test(code)) return true;
  if (base === "MKP" || code === "MKP" || /^MKP[_-]/i.test(code)) return true;
  if (/\b(kitolto|kitöltő|takaropanel|filler|blokk|omsz)\b/.test(name)) return true;

  return false;
}

function extractCommercialCode(item) {
  const manufCode = String(item?.refCodes?.manufCode ?? "")
    .trim()
    .replace(/\uFEFF/g, "");
  const primaryGuess = String(item?.primaryRefCode ?? item?.articleNumber ?? "")
    .trim()
    .replace(/\uFEFF/g, "");
  const preferManufForDishwasher =
    /^MO\d+_\d+$/i.test(normalizeDishwasherFrontCode(primaryGuess)) &&
    /^LMO\d+_\d+$/i.test(manufCode);
  const raw = preferManufForDishwasher
    ? manufCode
    : item?.primaryRefCode ??
      item?.articleNumber ??
      item?.refCodes?.manufCode ??
      item?.refCodes?.others?.userCode ??
      item?.refCodes?.others?.cic ??
      item?.sku ??
      item?.itemNumber ??
      item?.name ??
      item?.description;
  let code = String(raw || "")
    .trim()
    .replace(/\uFEFF/g, "");
  if (!code) return null;
  const lead = code.match(/^([A-Za-z]{1,6}[A-Za-z0-9]{0,18})(?:\s*[-·–—]\s*|\s+|$)/);
  if (lead) code = lead[1];
  code = code.replace(/\s+/g, "").replace(/-+/g, "");
  const wall = code.match(/^([A-Za-z][A-Za-z0-9]*?)_([BJ])$/i);
  if (wall) code = wall[1] + "_" + wall[2].toUpperCase();
  const m = code.match(/[A-Za-z][A-Za-z0-9_]*/);
  if (!m) return null;
  code = m[0].replace(/_K$/i, "");
  return normalizeDishwasherFrontCode(code);
}

function isCommercialItemLike(item) {
  if (!item || typeof item !== "object") return false;
  return !!(
    item.primaryRefCode ||
    item.articleNumber ||
    item.refCodes ||
    item.sku ||
    item.itemNumber ||
    item.quantity != null ||
    item.qty != null ||
    item.mennyiseg != null
  );
}

function findCommercialItemsArray(parsedJson, maxNodes = 8000) {
  if (!parsedJson || typeof parsedJson !== "object") return null;
  const queue = [parsedJson];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const cur = queue.shift();
    visited += 1;
    if (!cur || (typeof cur !== "object" && typeof cur !== "function")) continue;
    if (typeof cur === "object" && seen.has(cur)) continue;
    if (typeof cur === "object") seen.add(cur);
    if (Array.isArray(cur)) {
      if (cur.length && cur.every((x) => isCommercialItemLike(x))) return cur;
      for (let i = 0; i < cur.length; i += 1) queue.push(cur[i]);
      continue;
    }
    const keys = Object.keys(cur);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (k === "commercialItems" && Array.isArray(cur[k])) {
        const arr = cur[k];
        if (arr.length && arr.every((x) => isCommercialItemLike(x))) return arr;
      }
    }
    for (let i = 0; i < keys.length; i += 1) {
      const v = cur[keys[i]];
      if (v && (typeof v === "object" || Array.isArray(v))) queue.push(v);
    }
  }
  return null;
}

function extractCommercialItemsFromJson(json) {
  const direct = Array.isArray(json?.commercialItems) ? json.commercialItems : [];
  if (direct.length) return direct;
  const found = findCommercialItemsArray(json, 8000);
  return Array.isArray(found) ? found : [];
}

let lastItemListsRequestUrl = "";

async function deliverPlannerItemsPayload(context, items, requestUrl) {
  if (!Array.isArray(items) || !items.length) return 0;
  const payload = buildQtyOnlyPayload(items, requestUrl);
  await forwardPayload(payload);
  return await postMessageToAjanlatPages(context, payload);
}

function normalizePlannerBandHint(item) {
  const hay = String(
    [
      item?.name,
      item?.description,
      item?.label,
      item?.group?.name,
      item?.groupName,
      item?.roomName,
      item?.areaName,
      item?.installationType,
      item?.catalog?.name
    ]
      .filter(Boolean)
      .join(" ")
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (hay.includes("sziget") || hay.includes("island")) return "island";
  if (
    hay.includes("magas") ||
    hay.includes("tall") ||
    hay.includes("torony") ||
    (hay.includes("kamra") && !hay.includes("vasalat"))
  ) {
    return "tall";
  }
  if (hay.includes("felso") || hay.includes("upper")) return "upper";
  if (hay.includes("also") || hay.includes("lower")) return "lower";
  return "";
}

/** Térbeli sorrend: X (bal→jobb), nem alsó/felső csoportosítás. */
function computeWallOrderRank(item, fallbackIndex) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const x =
    num(item?.position?.x) ??
    num(item?.posX) ??
    num(item?.locationX) ??
    num(item?.transform?.x) ??
    num(item?.coordinates?.x);
  const seq =
    num(item?.sequence) ??
    num(item?.sortOrder) ??
    num(item?.displayOrder) ??
    num(item?.installationSequence);
  if (x != null) return x * 1000 + (num(item?.position?.y) ?? num(item?.posY) ?? 0);
  if (seq != null) return seq;
  return fallbackIndex;
}

function normalizeItems(commercialItems) {
  // Divian 5 lépés / 1. lépés: sortIndex = fal menti bal→jobb sorrend (alsó/felső keverve marad).
  const ranked = commercialItems
    .map((item, idx) => ({
      item,
      rank: computeWallOrderRank(item, idx)
    }))
    .sort((a, b) => a.rank - b.rank);
  return ranked
    .map(({ item }, sortIndex) => {
      const rawCode =
        item?.primaryRefCode ??
        item?.articleNumber ??
        item?.refCodes?.manufCode ??
        item?.refCodes?.others?.userCode ??
        item?.refCodes?.others?.cic ??
        item?.sku ??
        item?.itemNumber ??
        item?.name;
      const cikkszam = extractCommercialCode(item);
      const nev = safeString(
        item?.name ?? item?.description ?? item?.label ?? item?.refCodes?.others?.userCode
      );
      if (isPlannerTransferExcluded(cikkszam || rawCode, nev)) return null;
      const band = normalizePlannerBandHint(item);
      return {
        cikkszam,
        rawCode: safeString(rawCode),
        nev,
        mennyiseg: parseCommercialQty(item?.quantity ?? item?.mennyiseg ?? item?.qty ?? 1),
        sortIndex,
        wallOrder: sortIndex,
        band: band || undefined
      };
    })
    .filter((row) => row && row.cikkszam && row.mennyiseg > 0);
}

function buildQtyOnlyPayload(items, requestUrl) {
  return {
    type: "divian-playwright-items",
    source: "divian-playwright-forwarder",
    capturedAt: new Date().toISOString(),
    requestUrl,
    itemCount: items.length,
    // Csak cikkszam + mennyiseg megy tovabb, semmilyen ar vagy egyeb mezo nem.
    items: items.map((item) => ({
      cikkszam: safeString(item?.cikkszam),
      mennyiseg: Number(item?.mennyiseg ?? 0),
      sortIndex: typeof item?.sortIndex === "number" ? item.sortIndex : undefined,
      wallOrder: typeof item?.wallOrder === "number" ? item.wallOrder : undefined,
      band: item?.band || undefined,
      rawCode: safeString(item?.rawCode)
    }))
  };
}

async function forwardPayload(payload) {
  try {
    const res = await fetch(FORWARD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await res.text();
    console.log(`[Forward OK] status=${res.status} items=${payload.itemCount} response=${body.slice(0, 180)}`);
  } catch (err) {
    console.error("[Forward ERROR]", err.message);
  }
}

function isAjanlatPage(url) {
  const normalized = String(url || "").toLowerCase();
  return normalized.includes("arajanlat.html") || normalized.includes("dashboard.html");
}

function isArajanlatDedicatedPage(url) {
  const normalized = String(url || "").toLowerCase();
  return normalized.includes("arajanlat.html") && !normalized.includes("dashboard.html");
}

function listQuoteRelayPages(context) {
  const dedicated = context.pages().filter((page) => !page.isClosed() && isArajanlatDedicatedPage(page.url()));
  if (dedicated.length) return dedicated;
  return context.pages().filter((page) => !page.isClosed() && isAjanlatPage(page.url()));
}

function findArajanlatDedicatedPageInContext(context) {
  return context.pages().find((page) => !page.isClosed() && isArajanlatDedicatedPage(page.url())) || null;
}

async function openStartupCompanionPages(context, focusPage) {
  const quoteIsDashboard = String(QUOTE_UI_URL || "").toLowerCase().includes("dashboard.html");
  const targets = [
    { url: buildLocalArajanlatHttpUrl("arajanlat.html"), needle: "arajanlat.html", skip: quoteIsDashboard },
    { url: SZAMLA_ELORESZLET_URL, needle: "szamla-eloreszlet.html", skip: false }
  ];
  for (const target of targets) {
    if (target.skip) {
      console.log("[Init] társoldal kihagyva (már a parancspultban):", target.needle);
      continue;
    }
    const existing = context.pages().find((page) => {
      if (page.isClosed()) return false;
      return String(page.url() || "").toLowerCase().includes(target.needle);
    });
    if (existing) continue;
    try {
      const page = await context.newPage();
      await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 120000 });
      console.log("[Init] társoldal megnyitva:", target.url);
    } catch (err) {
      console.warn("[Init] társoldal hiba:", target.url, String(err?.message || err));
    }
  }
  if (focusPage && !focusPage.isClosed()) {
    await focusPage.bringToFront();
  }
}

async function readPendingScreenshotRequest(page) {
  return page.evaluate(() => {
    if (window.__divianPendingScreenshotRequest) return window.__divianPendingScreenshotRequest;
    const frame = document.getElementById("quoteSyncFrame");
    try {
      return frame?.contentWindow?.__divianPendingScreenshotRequest || null;
    } catch (_e) {
      return null;
    }
  });
}

async function postMessageToQuotePage(page, payload) {
  await page.evaluate((messagePayload) => {
    window.postMessage(messagePayload, "*");
    const frame = document.getElementById("quoteSyncFrame");
    try {
      frame?.contentWindow?.postMessage(messagePayload, "*");
    } catch (_e) {
      /* cross-origin */
    }
  }, payload);
}

async function clearPendingScreenshotRequest(page) {
  await page.evaluate(() => {
    window.__divianPendingScreenshotRequest = null;
    const frame = document.getElementById("quoteSyncFrame");
    try {
      if (frame?.contentWindow) frame.contentWindow.__divianPendingScreenshotRequest = null;
    } catch (_e) {
      /* ignore */
    }
  });
}

async function postMessageToAjanlatPages(context, payload) {
  const pages = listQuoteRelayPages(context);
  if (!pages.length) return 0;
  let sentCount = 0;
  await Promise.all(
    pages.map(async (page) => {
      try {
        await postMessageToQuotePage(page, payload);
        sentCount += 1;
      } catch (err) {
        console.error("[postMessage ERROR]", err.message);
      }
    })
  );
  return sentCount;
}

function envFlagForwarder(name, defaultVal) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return defaultVal;
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return defaultVal;
}

let activePublicTunnel = null;

async function maybeStartPublicTunnel() {
  if (!envFlagForwarder("DIVIAN_PUBLIC_TUNNEL", false)) return null;
  if (activePublicTunnel) return activePublicTunnel;
  try {
    const localtunnel = require("localtunnel");
    const subdomain = String(process.env.DIVIAN_TUNNEL_SUBDOMAIN || "").trim();
    const opts = { port: SCREENSHOT_API_PORT };
    if (subdomain) opts.subdomain = subdomain;
    const tunnel = await localtunnel(opts);
    activePublicTunnel = tunnel;
    const url = String(tunnel.url || "").replace(/\/+$/, "");
    writeActiveTunnelUrl(url);
    writeManualPublicUrl(url);
    console.log("[Init] nyilvános tunnel (távoli asztalosok):", url);
    console.log("[Init] asztalos app link:", asztalosAppUrl(url));
    tunnel.on("close", () => {
      activePublicTunnel = null;
      writeActiveTunnelUrl("");
    });
    return tunnel;
  } catch (err) {
    console.error("[Init] public tunnel hiba:", err?.message || err);
    return null;
  }
}

function buildPlaywrightLaunchOptions() {
  const opts = {
    headless: false,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--enable-automation"],
    locale: "hu-HU",
    viewport: null,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process,ThirdPartyCookieBlocking,TrackingProtection3pcd,Translate",
      "--start-maximized",
      "--use-fake-ui-for-media-stream",
      "--enable-speech-input",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  };
  const useBundled =
    envFlagForwarder("DIVIAN_PLAYWRIGHT_NO_CHANNEL", false) ||
    String(process.env.DIVIAN_PLAYWRIGHT_CHANNEL || "").toLowerCase() === "bundled";
  if (!useBundled) {
    opts.channel = process.env.DIVIAN_PLAYWRIGHT_CHANNEL || "chrome";
  }
  return opts;
}

async function start() {
  const userDataDir = resolvePlaywrightUserDataDir();
  console.log("[Init] Playwright profil:", userDataDir);
  console.log("[Init] Üzleti fiókok fájl:", AUTH_ACCOUNTS_FILE);
  const launchOpts = buildPlaywrightLaunchOptions();
  if (launchOpts.channel) {
    console.log("[Init] Playwright böngésző csatorna:", launchOpts.channel);
  } else {
    console.log("[Init] Playwright beépített Chromium (nem a rendszer Chrome)");
  }
  const context = await launchPlaywrightContext(userDataDir, launchOpts).catch(async (err) => {
    const msg = String(err?.message || err);
    if (!launchOpts.channel && /executable doesn't exist/i.test(msg)) {
      console.warn("[Init] Beepitett Chromium hianyzik — rendszer Chrome (channel: chrome)…");
      const fallback = { ...launchOpts, channel: process.env.DIVIAN_PLAYWRIGHT_CHANNEL || "chrome" };
      delete fallback.executablePath;
      return launchPlaywrightContext(userDataDir, fallback);
    }
    throw err;
  });

  console.log("Playwright figyeles elindult. Jelentkezz be a Cyncly oldalra ebben az ablakban.");

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    try {
      window.chrome = window.chrome || { runtime: {} };
    } catch (_e) {}
  });

  let cynclyPage = null;
  let cynclyPlannerFrame = null;
  let plannerEnsureInFlight = null;

  function isPlannerTargetClosed(target) {
    if (!target) return true;
    if (typeof target.isClosed === "function") return target.isClosed();
    if (typeof target.isDetached === "function") return target.isDetached();
    return false;
  }

  function getCynclyPlannerSurface() {
    return cynclyPlannerFrame || cynclyPage;
  }

  function getPlannerHostPage() {
    if (cynclyPage && !cynclyPage.isClosed()) return cynclyPage;
    return context.pages().find((page) => isAjanlatPage(page.url())) || null;
  }

  function findArajanlatDedicatedPage() {
    return findArajanlatDedicatedPageInContext(context);
  }

  async function ensureArajanlatDedicatedTab(options = {}) {
    const focus = options.focus === true;
    const targetUrl = buildLocalArajanlatHttpUrl("arajanlat.html");
    let page = findArajanlatDedicatedPage();
    if (!page) {
      page = await context.newPage();
      console.log("[Árajánlat] Külön lap megnyitása:", targetUrl);
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      } catch (_navErr) {
        await page.goto(targetUrl, { waitUntil: "commit", timeout: 120000 }).catch(() => {});
      }
    }
    if (focus) await page.bringToFront().catch(() => {});
    return page;
  }

  async function readDashboardDataFromArajanlat() {
    const page = findArajanlatDedicatedPage();
    if (!page) {
      return { ok: false, error: "arajanlat-missing", message: "Árajánlat lap nincs megnyitva" };
    }
    try {
      return await page.evaluate(() => {
        const api = window.DivianQuoteWorkflow;
        if (!api || typeof api.getDashboardData !== "function") {
          return { ok: false, error: "api-missing", message: "Árajánlat még tölt…" };
        }
        return { ok: true, data: api.getDashboardData() };
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async function pushDashboardSyncToArajanlat(sync) {
    const page = findArajanlatDedicatedPage();
    if (!page) return { ok: false, error: "arajanlat-missing" };
    const payload = sync && typeof sync === "object" ? sync : {};
    try {
      return await page.evaluate((body) => {
        try {
          localStorage.setItem("divian_dashboard_to_quote_sync_v1", JSON.stringify(body));
        } catch (_e) {}
        const api = window.DivianQuoteWorkflow;
        if (api && typeof api.applyDashboardSync === "function") {
          return api.applyDashboardSync(body);
        }
        return { ok: true, deferred: true };
      }, payload);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async function runQuoteWorkflowAction(action, extra) {
    const page = findArajanlatDedicatedPage();
    if (!page) return { ok: false, error: "arajanlat-missing" };
    try {
      return await page.evaluate(
        ({ actionName, actionExtra }) => {
          const api = window.DivianQuoteWorkflow;
          if (!api) return { ok: false, error: "api-missing" };
          if (actionName === "confirmWall" && typeof api.confirmWallSequence === "function") {
            return api.confirmWallSequence(actionExtra || { source: "dashboard" });
          }
          return { ok: false, error: "unknown-action" };
        },
        { actionName: action, actionExtra: extra || {} }
      );
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  function findCynclyDedicatedPage() {
    return (
      context.pages().find((page) => {
        if (page.isClosed() || isAjanlatPage(page.url())) return false;
        const url = String(page.url() || "");
        return isPlannerAppUrl(url) || isCynclyAuthUrl(url);
      }) || null
    );
  }

  async function ensureCynclyDedicatedPlannerTab(targetUrl, options = {}) {
    const focus = options.focus === true;
    const targetKey = plannerProjectKey(targetUrl);
    let page = findCynclyDedicatedPage();
    if (!page) {
      page = await context.newPage();
      console.log("[Cyncly] Tervező lap megnyitása:", targetUrl);
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      } catch (_navErr) {
        await page.goto(targetUrl, { waitUntil: "commit", timeout: 120000 }).catch(() => {});
      }
    } else {
      const currentKey = plannerProjectKey(page.url());
      const onAuth = isCynclyAuthUrl(page.url());
      const onPlanner = isPlannerAppUrl(page.url());
      if (!onAuth && (!onPlanner || (targetKey && currentKey !== targetKey))) {
        console.log("[Cyncly] Tervező lap navigálás:", targetUrl);
        try {
          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
        } catch (_navErr) {
          await page.goto(targetUrl, { waitUntil: "commit", timeout: 120000 }).catch(() => {});
        }
      }
    }
    if (focus) await page.bringToFront().catch(() => {});
    cynclyPage = page;
    cynclyPlannerFrame = null;
    return page;
  }

  async function getCynclyPlannerStatus() {
    const page = findCynclyDedicatedPage();
    if (!page || page.isClosed()) {
      return { ok: true, state: "missing", message: "Tervező lap nincs megnyitva — kattints: Tervező megnyitása" };
    }
    const url = String(page.url() || "");
    if (isCynclyAuthUrl(url)) {
      return {
        ok: true,
        state: "login",
        url,
        message: "Jelentkezz be a Cyncly Chrome fülön (vaciut@divian.hu)"
      };
    }
    if (!isPlannerAppUrl(url)) {
      return { ok: true, state: "unknown", url, message: "Tervező lap betöltése…" };
    }
    try {
      const probe = await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return { hasCanvas: false, ready: false };
        const r = canvas.getBoundingClientRect();
        return { hasCanvas: true, ready: r.width > 40 && r.height > 40 };
      });
      if (!probe.hasCanvas) {
        return { ok: true, state: "loading", url, message: "Tervező tölt… (várj pár másodpercet)" };
      }
      return {
        ok: true,
        state: probe.ready ? "ready" : "loading",
        url,
        message: probe.ready ? "Tervező kész — tervezz a Cyncly fülön" : "Tervező tölt…"
      };
    } catch (_e) {
      return { ok: true, state: "loading", url, message: "Tervező ellenőrzése…" };
    }
  }

  async function syncDashboardPlannerIframe(dashPage, targetUrl) {
    await dashPage.evaluate((url) => {
      const el = document.getElementById("plannerFrame");
      if (!el || el.hidden || el.classList.contains("is-hidden")) return;
      const cur = String(el.src || "");
      if (cur && cur.includes(url.split("/design/")[1]?.split("/")[0] || "___")) return;
      el.src = url;
      try {
        localStorage.setItem("divian_cyncly_planner_url_v1", url);
      } catch (_e) {}
      const hint = document.getElementById("plannerUrlHint");
      if (hint && url) {
        hint.textContent = "· " + String(url).replace(/^https?:\/\//, "").slice(0, 52) + "…";
      }
    }, targetUrl);
  }

  function findDashboardPlannerFrame(dashboardPage) {
    return (
      dashboardPage
        .frames()
        .find((f) => !f.isDetached() && isPlannerAppUrl(f.url())) || null
    );
  }

  function dashboardPlannerAuthPending(dashboardPage) {
    return dashboardPage.frames().some((f) => !f.isDetached() && isCynclyAuthUrl(f.url()));
  }

  async function readDashboardPlannerIframeState(dashboardPage) {
    return dashboardPage.evaluate(() => {
      const el = document.getElementById("plannerFrame");
      const src = el ? String(el.src || el.getAttribute("src") || "") : "";
      return { hasFrame: !!el, src };
    });
  }

  async function waitForPlannerIframe(dashboardPage, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = findDashboardPlannerFrame(dashboardPage);
      if (frame) return frame;
      if (dashboardPlannerAuthPending(dashboardPage)) {
        await dashboardPage.waitForTimeout(900);
        continue;
      }
      await dashboardPage.waitForTimeout(450);
    }
    return null;
  }

  async function ensureCynclyPlannerPage(plannerUrlOverride, options = {}) {
    if (plannerEnsureInFlight) return plannerEnsureInFlight;
    plannerEnsureInFlight = ensureCynclyPlannerPageInner(plannerUrlOverride, options).finally(() => {
      plannerEnsureInFlight = null;
    });
    return plannerEnsureInFlight;
  }

  async function ensureCynclyPlannerPageInner(plannerUrlOverride, options = {}) {
    const targetUrl = resolveCynclyPlannerUrl(plannerUrlOverride);
    const focus = options.focus === true;
    const dashPage = context.pages().find((page) => isAjanlatPage(page.url()));

    const dedicatedPage = await ensureCynclyDedicatedPlannerTab(targetUrl, { focus });
    if (dashPage && !dashPage.isClosed()) {
      try {
        await syncDashboardPlannerIframe(dashPage, targetUrl);
      } catch (_e) {
        console.warn("[Cyncly] iframe szinkron hiba");
      }
    }

    try {
      await dedicatedPage.waitForSelector("canvas", { timeout: focus ? 45000 : 120000 });
    } catch (_e) {
      console.warn("[Cyncly] canvas timeout a dedikált tervező lapon");
    }
    await waitForPlannerSceneReady(dedicatedPage, focus ? 30000 : 90000);
    return targetUrl;
  }

  async function waitForPlannerSceneReady(page, maxMs = 60000) {
    const stepMs = 850;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 6 || r.height < 6) return false;
          const st = window.getComputedStyle(el);
          return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity || 1) > 0.06;
        }
        const spinners = Array.from(
          document.querySelectorAll(
            '[class*="loading" i], [class*="spinner" i], [class*="loader" i], [aria-busy="true"], progress, svg[class*="spin" i]'
          )
        ).filter(isVisible);
        const blockingSpinner = spinners.some((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 260 && r.height < 260;
        });
        if (blockingSpinner) return { ready: false, reason: "spinner" };

        const canvases = Array.from(document.querySelectorAll("canvas")).filter(isVisible);
        for (const canvas of canvases) {
          const r = canvas.getBoundingClientRect();
          if (r.width < 300 || r.height < 180) continue;
          try {
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx || canvas.width < 64 || canvas.height < 64) continue;
            const sx = Math.floor(canvas.width * 0.18);
            const sy = Math.floor(canvas.height * 0.18);
            const sw = Math.max(48, Math.floor(canvas.width * 0.64));
            const sh = Math.max(48, Math.floor(canvas.height * 0.64));
            const data = ctx.getImageData(sx, sy, sw, sh).data;
            let nonWhite = 0;
            let pixels = 0;
            for (let i = 0; i < data.length; i += 16) {
              pixels++;
              const rv = data[i];
              const gv = data[i + 1];
              const bv = data[i + 2];
              if (rv < 228 || gv < 228 || bv < 228) nonWhite++;
            }
            if (pixels > 0 && nonWhite / pixels >= 0.055) {
              return { ready: true, reason: "canvas", ratio: nonWhite / pixels };
            }
          } catch (_canvasErr) {
            /* WebGL – spinner alapú várakozás */
          }
        }
        return { ready: false, reason: "empty" };
      });
      if (state.ready) {
        console.log(
          "[Screenshot] terv kész:",
          state.reason,
          state.ratio != null ? (state.ratio * 100).toFixed(1) + "% tartalom" : ""
        );
        await page.waitForTimeout(700);
        return true;
      }
      await page.waitForTimeout(stepMs);
    }
    console.warn("[Screenshot] várakozás lejárt – később így is készül kép");
    return false;
  }

  async function isPlannerClipMostlyBlank(page, clip) {
    return page.evaluate((c) => {
      function sampleCanvas(canvas) {
        try {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx || canvas.width < 40 || canvas.height < 40) return null;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let nonWhite = 0;
          let pixels = 0;
          for (let i = 0; i < data.length; i += 20) {
            pixels++;
            if (data[i] < 228 || data[i + 1] < 228 || data[i + 2] < 228) nonWhite++;
          }
          return pixels ? nonWhite / pixels : 0;
        } catch (_e) {
          return null;
        }
      }
      const canvases = Array.from(document.querySelectorAll("canvas"));
      let best = 0;
      for (const canvas of canvases) {
        const r = canvas.getBoundingClientRect();
        const overlaps =
          r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height;
        if (!overlaps || r.width < 200) continue;
        const ratio = sampleCanvas(canvas);
        if (ratio != null) best = Math.max(best, ratio);
      }
      return best < 0.05;
    }, clip);
  }

  /** Egy Cyncly gomb / fül megnyomása több lehetséges felirattal. */
  async function clickPlannerControl(page, patterns, opts = {}) {
    const timeout = opts.timeout || 2500;
    const settleMs = opts.settleMs || 900;
    for (const pat of patterns) {
      const rx = pat instanceof RegExp ? pat : new RegExp(String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const locators = [
        () => page.getByRole("button", { name: rx }).first(),
        () => page.getByRole("tab", { name: rx }).first(),
        () => page.getByLabel(rx).first(),
        () => page.getByText(rx).first()
      ];
      for (const mk of locators) {
        try {
          const loc = mk();
          await loc.click({ timeout });
          await page.waitForTimeout(settleMs);
          console.log("[HD render] kattintás: " + String(pat));
          return true;
        } catch (_e) {
          /* következő */
        }
      }
    }
    return false;
  }

  async function pageShowsPreviewGenerating(page) {
    return page
      .evaluate(() => {
        const t = String(document.body?.innerText || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        return (
          t.includes("elonezet letrehozasa zajlik") ||
          t.includes("preview creation in progress") ||
          /\belonezet\b[^\n]{0,40}\bzajlik\b/.test(t)
        );
      })
      .catch(() => false);
  }

  /** Várakozás, amíg a Cyncly „Előnézet létrehozása zajlik” állapot le nem jár. */
  async function waitForCynclyPreviewGeneration(page, maxMs = 240000) {
    const stepMs = 1800;
    const deadline = Date.now() + maxMs;
    let sawBusy = false;
    while (Date.now() < deadline) {
      const busy = await pageShowsPreviewGenerating(page);
      if (busy) sawBusy = true;
      if (sawBusy && !busy) {
        console.log("[HD render] Előnézet kész (a „zajlik” állapot eltűnt)");
        await page.waitForTimeout(2000);
        await waitForPlannerSceneReady(page, 45000);
        return true;
      }
      await page.waitForTimeout(stepMs);
    }
    console.warn("[HD render] előnézet-várakozás lejárt — kép így is készül");
    return false;
  }

  async function activateCynclyHdMode(page) {
    let hdOk = await clickPlannerControl(page, [/^HD$/i, "HD render", "HD Render"], {
      settleMs: 2000,
      timeout: 2500
    });
    if (hdOk) return true;
    hdOk = await page
      .evaluate(() => {
        function norm(s) {
          return String(s || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
        }
        function vis(el) {
          if (!el || !(el instanceof Element)) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 10 || r.left > window.innerWidth * 0.42) return false;
          const st = window.getComputedStyle(el);
          return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) > 0.05;
        }
        const nodes = Array.from(
          document.querySelectorAll("button,[role='button'],a,span,div,label")
        );
        for (const el of nodes) {
          if (!vis(el)) continue;
          const t = norm(el.textContent);
          const aria = norm(el.getAttribute("aria-label") || el.getAttribute("title") || "");
          if (t === "hd" || aria === "hd" || aria.includes("hd render")) {
            el.click();
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
    if (hdOk) {
      console.log("[HD render] HD ikon (DOM) aktiválva");
      await page.waitForTimeout(2000);
    }
    return hdOk;
  }

  async function clickCreatePreviewButton(page) {
    return clickPlannerControl(
      page,
      [
        "Előnézet létrehozása",
        "Elonezet letrehozasa",
        /^(?!.*zajlik).*előnézet létrehozása/i,
        /^(?!.*zajlik).*elonezet letrehozasa/i
      ],
      { settleMs: 600, timeout: 5000 }
    );
  }

  /**
   * Cyncly HD előnézet: Nézet/Render → HD → „Előnézet létrehozása” → „zajlik” végéig vár → előnézet megnyitás.
   * (pl. Csernus 1.5: …/hu/design/25124ff4-…/edit?partnership=divian)
   */
  async function runCynclyHdPreviewPipeline(page) {
    console.log("[HD render] Nézet/Render + HD + előnézet létrehozása…");

    const entryMenus = ["Nézet", "Nezet", "Render"];
    let createClicked = false;

    for (const menu of entryMenus) {
      await clickPlannerControl(page, [menu], { settleMs: 1500, timeout: 3000 });
      await activateCynclyHdMode(page);
      createClicked = await clickCreatePreviewButton(page);
      if (createClicked) {
        console.log("[HD render] belépés: " + menu);
        break;
      }
    }

    if (createClicked) {
      console.log("[HD render] Előnézet generálás fut — várakozás (akár 2–3 perc)…");
      await waitForCynclyPreviewGeneration(page, 240000);
      await waitForPlannerSceneReady(page, 90000);
      await page.waitForTimeout(1500);
      await clickPlannerControl(
        page,
        [
          "Előnézet megtekintése",
          "Elonezet megtekintese",
          /^Előnézet$/i,
          /^Elonezet$/i,
          /előnézet megtekintése/i
        ],
        { settleMs: 2000, timeout: 3000 }
      );
    } else {
      console.warn(
        '[HD render] „Előnézet létrehozása” gomb nem található — nyisd meg a Nézet vagy Render panelt a Cyncly-ben.'
      );
    }
  }

  const renderNetworkImages = [];
  let renderCollectorInstalled = false;

  function resetRenderNetworkCollector() {
    renderNetworkImages.length = 0;
  }

  function isRenderCandidateUrl(url) {
    const u = String(url || "").toLowerCase();
    if (!u || u.startsWith("data:")) return false;
    if (/favicon|\.svg(\?|$)|sprite|\/icon|font|woff|logo|avatar|thumb\/\d/i.test(u)) return false;
    if (/\.(png|jpe?g|webp)(\?|$)/i.test(u)) return true;
    if (/render|preview|snapshot|export|download|idealspaces|cyncly|blob\.core|cloudfront|amazonaws/i.test(u)) {
      return true;
    }
    return false;
  }

  function installRenderNetworkCollector(page) {
    if (renderCollectorInstalled) return;
    renderCollectorInstalled = true;
    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!isRenderCandidateUrl(url)) return;
        const status = response.status();
        if (status < 200 || status >= 400) return;
        const ct = String(response.headers()["content-type"] || "").toLowerCase();
        if (!/image\/(png|jpe?g|webp|octet-stream)/i.test(ct) && !/application\/octet-stream/i.test(ct)) {
          return;
        }
        const body = await response.body();
        if (!body || body.length < 60000) return;
        renderNetworkImages.push({
          url,
          size: body.length,
          contentType: ct,
          t: Date.now()
        });
      } catch (_e) {
        /* ignore */
      }
    });
  }

  function pickBestRenderNetworkUrl(sinceMs) {
    const pool = renderNetworkImages.filter((x) => x.t >= sinceMs && x.size >= 60000);
    if (!pool.length) return null;
    pool.sort((a, b) => b.size - a.size);
    return pool[0].url;
  }

  async function findRenderImageUrlInDom(page) {
    return page
      .evaluate(() => {
        function norm(v) {
          return String(v || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
        }
        function vis(el) {
          if (!el || !(el instanceof Element)) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 24) return false;
          const st = window.getComputedStyle(el);
          return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) > 0.04;
        }
        const links = Array.from(document.querySelectorAll("a[href]")).filter((el) => {
          if (!vis(el)) return false;
          const t = norm(el.textContent);
          const href = String(el.href || "");
          if (!href || href.startsWith("javascript:")) return false;
          if (el.hasAttribute("download")) return true;
          if (t.includes("letolt") || t === "download") return true;
          return /\.(png|jpe?g|webp)(\?|$)/i.test(href);
        });
        for (const a of links) {
          const href = String(a.href || "");
          if (/\.(png|jpe?g|webp)(\?|$)/i.test(href)) return href;
        }
        const imgs = Array.from(document.querySelectorAll("img[src]"))
          .filter((el) => {
            if (!vis(el)) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 420 || r.height < 280) return false;
            const src = String(el.currentSrc || el.src || "");
            if (!src || src.startsWith("data:image/svg")) return false;
            if (/icon|logo|thumb|avatar|sprite/i.test(src)) return false;
            return true;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { src: String(el.currentSrc || el.src || ""), area: r.width * r.height };
          })
          .sort((a, b) => b.area - a.area);
        return imgs.length ? imgs[0].src : "";
      })
      .catch(() => "");
  }

  async function tryDownloadRenderFile(page) {
    const patterns = ["letöltés", "letoltes", /^download$/i, /letöltés/i];
    for (const pat of patterns) {
      try {
        const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
        const clicked = await clickPlannerControl(page, [pat], { timeout: 2500, settleMs: 400 });
        if (!clicked) continue;
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        if (!stream) continue;
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf.length >= 60000) {
          console.log("[Render] letöltés fájl:", buf.length, "bájt");
          return buf;
        }
      } catch (_e) {
        /* következő */
      }
    }
    return null;
  }

  async function fetchRenderBuffer(page, imageUrl) {
    const response = await page.request.get(imageUrl, { timeout: 120000 });
    if (!response.ok()) throw new Error("render-fetch-http-" + response.status());
    const buf = await response.body();
    if (!buf || buf.length < 60000) throw new Error("render-fetch-too-small");
    return { buf, contentType: String(response.headers()["content-type"] || "image/png") };
  }

  function bufferToImageDataUrl(buf, contentType) {
    const ct = String(contentType || "image/png").split(";")[0].trim() || "image/png";
    return `data:${ct};base64,${buf.toString("base64")}`;
  }

  async function fetchCynclyRenderImage(page, sinceMs) {
    await clickPlannerControl(page, ["Render", "Képek", "Előnézetek", "Renderek"], {
      settleMs: 1200,
      timeout: 3000
    });
    await page.waitForTimeout(1200);

    let buf = await tryDownloadRenderFile(page);
    if (buf) return { buf, contentType: "image/png", source: "download" };

    let imageUrl = await findRenderImageUrlInDom(page);
    if (!imageUrl) imageUrl = pickBestRenderNetworkUrl(sinceMs);
    if (!imageUrl) return null;

    console.log("[Render] kép URL:", imageUrl.slice(0, 160));
    const fetched = await fetchRenderBuffer(page, imageUrl);
    return { buf: fetched.buf, contentType: fetched.contentType, source: "url", imageUrl };
  }

  async function ingestItemListsJson(json, requestUrl) {
    const commercialItems = extractCommercialItemsFromJson(json);
    if (!commercialItems.length) {
      console.warn("[item-lists] üres lista:", String(requestUrl || "").slice(0, 140));
      return 0;
    }
    if (String(requestUrl || "").includes(TARGET_HINT)) {
      lastItemListsRequestUrl = String(requestUrl);
    }
    const items = normalizeItems(commercialItems);
    if (!items.length) {
      console.warn("[item-lists] normalizálás után 0 tétel");
      return 0;
    }
    console.log(`[Captured] ${items.length} tetel: ${requestUrl}`);
    const sentPages = await deliverPlannerItemsPayload(context, items, requestUrl);
    if (sentPages > 0) {
      console.log(`[postMessage OK] ${sentPages} arajanlat oldal frissitve.`);
    }
    return sentPages;
  }

  async function fetchPlannerItemsForPage(target, opts = {}) {
    if (!target || isPlannerTargetClosed(target)) return 0;
    const triggerClick = opts.triggerClick !== false;
    if (triggerClick) {
      const waitPromise = target
        .waitForResponse(
          (resp) => resp.url().includes(TARGET_HINT) && resp.status() >= 200 && resp.status() < 400,
          { timeout: 40000 }
        )
        .catch(() => null);
      await clickPlannerControl(
        target,
        [
          "Terméklista",
          "Termeklista",
          /term[eé]k\s*lista/i,
          "Product list",
          "Tételek",
          "Items",
          "Lista",
          "Árucikkek",
          "Commercial"
        ],
        { settleMs: 2800, timeout: 8000 }
      );
      const resp = await waitPromise;
      if (resp) {
        try {
          const json = await resp.json();
          const sent = await ingestItemListsJson(json, resp.url());
          if (sent > 0) return sent;
        } catch (_respErr) {
          /* következő próba */
        }
      }
    }
    if (lastItemListsRequestUrl) {
      try {
        const json = await target.evaluate(async (url) => {
          const r = await fetch(url, { credentials: "include" });
          if (!r.ok) return null;
          return r.json();
        }, lastItemListsRequestUrl);
        if (json) return await ingestItemListsJson(json, lastItemListsRequestUrl);
      } catch (_refetchErr) {
        /* pass */
      }
    }
    return 0;
  }

async function capturePlannerScreenshotPayload(label = "Aktuális nézet", plannerUrlOverride) {
  const plannerUrlUsed = await ensureCynclyPlannerPage(plannerUrlOverride);
    const surface = getCynclyPlannerSurface();
    const hostPage = getPlannerHostPage();
    if (!surface || isPlannerTargetClosed(surface)) {
      throw new Error("Cyncly tervező nem található (parancspult iframe vagy külön lap)");
    }

    try {
      const synced = await fetchPlannerItemsForPage(surface, { triggerClick: true });
      if (synced > 0) console.log("[item-lists] tételek szinkronizálva áthozás előtt");
    } catch (syncErr) {
      console.warn("[item-lists] szinkron hiba:", String(syncErr?.message || syncErr));
    }

    console.log("[Render] projekt link:", plannerUrlUsed);
    const renderTarget = hostPage || surface;
    installRenderNetworkCollector(renderTarget);
    resetRenderNetworkCollector();
    const collectSince = Date.now();

    await runCynclyHdPreviewPipeline(surface);

    let renderResult = await fetchCynclyRenderImage(surface, collectSince);
    if (!renderResult) {
      const waitHost = hostPage && !hostPage.isClosed() ? hostPage : surface;
      if (typeof waitHost.waitForTimeout === "function") await waitHost.waitForTimeout(4000);
      renderResult = await fetchCynclyRenderImage(surface, collectSince);
    }
    if (!renderResult) {
      throw new Error(
        "Nem található Cyncly render kép (letöltés / URL). Ellenőrizd, hogy az előnézet elkészült-e."
      );
    }

    const imageDataUrl = bufferToImageDataUrl(renderResult.buf, renderResult.contentType);
    return {
      type: "divian-planner-screenshot",
      source: "cyncly-render",
      captureMode: "render-download",
      renderSource: renderResult.source,
      renderImageUrl: renderResult.imageUrl || null,
      capturedAt: new Date().toISOString(),
      label,
      plannerUrl: plannerUrlUsed,
      plannerProject: plannerProjectKey(plannerUrlUsed),
      imageDataUrl
    };
  }

  function sanitizeFileName(fileName, fallbackName) {
    const safeFileName = String(fileName || fallbackName)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim();
    return safeFileName || fallbackName;
  }

  async function removeNagykerExcelNameVariants(dir, finalName) {
    const stem = String(finalName || "")
      .replace(/\.xlsx$/i, "")
      .trim();
    if (!stem) return;
    let names = [];
    try {
      names = await fsPromises.readdir(dir);
    } catch {
      return;
    }
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const variantRe = new RegExp("^" + escaped + "(?:\\s*\\((\\d+)\\))?\\.xlsx$", "i");
    for (const name of names) {
      if (!variantRe.test(name)) continue;
      try {
        await fsPromises.unlink(path.join(dir, name));
      } catch (_unlinkErr) {}
    }
  }

  async function saveNagykerExcelToDesktop(fileName, base64Data) {
    const safeFileName = sanitizeFileName(fileName, "nagyker.xlsx");
    const finalName = safeFileName.toLowerCase().endsWith(".xlsx") ? safeFileName : safeFileName + ".xlsx";
    await fsPromises.mkdir(NAGYKER_EXCEL_DIR, { recursive: true });
    await removeNagykerExcelNameVariants(NAGYKER_EXCEL_DIR, finalName);
    const fullPath = path.join(NAGYKER_EXCEL_DIR, finalName);
    let existed = false;
    try {
      await fsPromises.access(fullPath);
      existed = true;
    } catch (_missing) {}
    try {
      await fsPromises.unlink(fullPath);
    } catch (_unlinkErr) {}
    await fsPromises.writeFile(fullPath, Buffer.from(String(base64Data || ""), "base64"));
    return { savedPath: fullPath, overwritten: existed };
  }

  function findThunderbirdExecutable() {
    const candidates = [
      process.env.THUNDERBIRD_EXE,
      "C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe",
      "C:\\Program Files (x86)\\Mozilla Thunderbird\\thunderbird.exe"
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (_err) {}
    }
    return "";
  }

  function escapeThunderbirdComposeValue(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");
  }

  function formatThunderbirdAttachmentPath(filePath) {
    return path.normalize(String(filePath || "").trim());
  }

  /** Thunderbird Windows alatt gyakran elhasal ékezetes asztali útvonalon — temp másolat. */
  async function stageAttachmentForThunderbird(sourcePath, tempDir) {
    const src = path.resolve(String(sourcePath || ""));
    await fsPromises.access(src, fs.constants.R_OK);
    const safeName = sanitizeFileName(path.basename(src), "csatolmany.pdf");
    const dest = path.join(tempDir, safeName);
    if (path.resolve(dest) !== src) {
      await fsPromises.copyFile(src, dest);
    }
    return dest;
  }

  async function launchThunderbirdCompose(opts) {
    const exe = findThunderbirdExecutable();
    if (!exe) throw new Error("thunderbird-not-found");
    const parts = [];
    if (opts.to) parts.push("to='" + escapeThunderbirdComposeValue(opts.to) + "'");
    if (opts.from) parts.push("from='" + escapeThunderbirdComposeValue(opts.from) + "'");
    if (opts.subject) parts.push("subject='" + escapeThunderbirdComposeValue(opts.subject) + "'");
    if (opts.body) parts.push("body='" + escapeThunderbirdComposeValue(opts.body) + "'");
    const attachPaths = Array.isArray(opts.attachPaths) ? opts.attachPaths.filter(Boolean) : [];
    if (attachPaths.length) {
      const joined = attachPaths
        .map(
          (p) =>
            "'" + escapeThunderbirdComposeValue(formatThunderbirdAttachmentPath(p)) + "'"
        )
        .join(",");
      parts.push("attachment=" + joined);
    }
    const composeArg = parts.join(",");
    await new Promise((resolve, reject) => {
      const child = spawn(exe, ["-compose", composeArg], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.on("error", reject);
      child.unref();
      setTimeout(resolve, 400);
    });
    return { ok: true, attachmentCount: attachPaths.length };
  }

  async function handleThunderbirdComposeRequest(bodyText) {
    let parsed = {};
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch (_err) {
      throw new Error("invalid-json");
    }
    const tempDir = path.join(os.tmpdir(), "divian-mail-" + Date.now());
    await fsPromises.mkdir(tempDir, { recursive: true });
    const attachPaths = [];
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    for (const att of attachments) {
      const b64 = String(att?.base64 || "").trim();
      if (!b64) continue;
      const safeName = sanitizeFileName(String(att.fileName || "csatolmany.jpg"), "csatolmany.jpg");
      const fullPath = path.join(tempDir, safeName);
      await fsPromises.writeFile(fullPath, Buffer.from(b64, "base64"));
      attachPaths.push(fullPath);
    }
    const pdfHtml = String(parsed.pdfHtml || "");
    if (pdfHtml) {
      const pdfName = sanitizeFileName(String(parsed.pdfFileName || "arajanlat.pdf"), "arajanlat.pdf");
      const isDeliveryNote =
        String(parsed.pdfKind || "").trim() === "deliveryNote" ||
        /_szallitolevel\.pdf$/i.test(pdfName);
      const savedDesktopPath = isDeliveryNote
        ? (await saveDeliveryNotePdfToDesktop({
            fileName: pdfName,
            htmlText: pdfHtml,
            customerName: parsed.customerName,
            quoteNumber: parsed.quoteNumber
          })).savedPath
        : await saveQuotePdfToDesktop({
            fileName: pdfName,
            htmlText: pdfHtml,
            customerName: parsed.customerName,
            quoteNumber: parsed.quoteNumber
          });
      const attachPath = await stageAttachmentForThunderbird(savedDesktopPath, tempDir);
      attachPaths.push(attachPath);
    }
    await launchThunderbirdCompose({
      to: String(parsed.to || ""),
      from: String(parsed.from || ""),
      subject: String(parsed.subject || "Árajánlat"),
      body: String(parsed.body || ""),
      attachPaths
    });
    return { ok: true, attachmentCount: attachPaths.length, tempDir };
  }

  async function renderHtmlToPdfOnDisk(htmlText, fileName, targetDir, fallbackName) {
    const safeFileName = sanitizeFileName(fileName, fallbackName || "dokumentum.pdf");
    const finalName = safeFileName.toLowerCase().endsWith(".pdf") ? safeFileName : safeFileName + ".pdf";
    await fsPromises.mkdir(targetDir, { recursive: true });
    const fullPath = path.join(targetDir, finalName);
    const pdfPage = await context.newPage();
    try {
      const html = String(htmlText || "");
      await pdfPage.setContent(html, { waitUntil: "load" });
      await pdfPage.emulateMedia({ media: "print" });
      if (html.includes("pdf-sheet-bg")) {
        await pdfPage
          .waitForFunction(
            () => {
              const img = document.querySelector(".pdf-sheet-bg img");
              return Boolean(img && img.complete && img.naturalWidth > 0);
            },
            { timeout: 20000 }
          )
          .catch(() => {});
      }
      const client = await context.newCDPSession(pdfPage);
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
      await fsPromises.writeFile(fullPath, Buffer.from(pdf.data, "base64"));
      return fullPath;
    } finally {
      await pdfPage.close().catch(() => {});
    }
  }

  async function saveQuotePdfToDesktop(args) {
    const a = args && typeof args === "object" ? args : {};
    const fileName = String(a.fileName || "megrendelo.pdf");
    const htmlText = String(a.htmlText || "");
    const target = await resolveOrderSaveTargetAsync(ORDER_SAVE_DIR, {
      fileName,
      customerName: a.customerName,
      quoteNumber: a.quoteNumber
    });
    return renderHtmlToPdfOnDisk(htmlText, fileName, target.dir, "megrendelo.pdf");
  }

  async function saveDeliveryNotePdfToDesktop(args) {
    const a = args && typeof args === "object" ? args : {};
    const fileName = String(a.fileName || "szallitolevel.pdf");
    const htmlText = String(a.htmlText || "");
    const target = resolveDeliveryNotePdfTarget(DELIVERY_NOTE_PDF_DIR, {
      fileName,
      customerName: a.customerName,
      quoteNumber: a.quoteNumber
    });
    const savedPath = await renderHtmlToPdfOnDisk(
      htmlText,
      fileName,
      target.dir,
      "szallitolevel.pdf"
    );
    return { savedPath, folder: target.dir, folderLabel: target.folderLabel };
  }

  async function saveOrderDocumentPdfToDesktop(args) {
    const a = args && typeof args === "object" ? args : {};
    const fileName = String(a.fileName || "dokumentum.pdf");
    const htmlText = String(a.htmlText || "");
    const fallback = fileName.toLowerCase().includes("dijbekero") ? "dijbekero.pdf" : "dokumentum.pdf";
    const target = await resolveOrderSaveTargetAsync(ORDER_SAVE_DIR, {
      fileName,
      customerName: a.customerName,
      quoteNumber: a.quoteNumber
    });
    return renderHtmlToPdfOnDisk(htmlText, fileName, target.dir, fallback);
  }

  async function handleDeliveryNoteSavePdfRequest(bodyText) {
    if (isDeliveryNoteDisabled()) {
      return deliveryNoteDisabledError();
    }
    let parsed = {};
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch (_err) {
      throw new Error("invalid-json");
    }
    const htmlText = String(parsed.htmlText || "");
    if (!htmlText) throw new Error("missing-htmlText");
    const fileName = sanitizeFileName(String(parsed.fileName || "szallitolevel.pdf"), "szallitolevel.pdf");
    const saved = await saveDeliveryNotePdfToDesktop({
      fileName,
      htmlText,
      customerName: parsed.customerName,
      quoteNumber: parsed.quoteNumber
    });
    return {
      ok: true,
      savedPath: saved.savedPath,
      folder: saved.folder || DELIVERY_NOTE_PDF_DIR,
      folderLabel: saved.folderLabel || ""
    };
  }

  await context.exposeBinding("divianRequestPlannerScreenshot", async (_source, args) => {
    const label = String(args?.label || "Aktuális nézet");
    const plannerUrl = String(args?.plannerUrl || "").trim();
    const payload = await capturePlannerScreenshotPayload(label, plannerUrl || undefined);
    await postMessageToAjanlatPages(context, payload);
    return payload;
  });

  await context.exposeBinding("divianSaveOrderFile", async (_source, args) => {
    const savedPath = await saveOrderJsonToDesktop(args || {});
    return { ok: true, savedPath };
  });

  await context.exposeBinding("divianScanSavedOrdersDir", async () => {
    return await scanOrderSaveDir();
  });

  await context.exposeBinding("divianReadOrderSaveFile", async (_source, args) => {
    return await readOrderSaveFile(String(args?.fileName || "").trim());
  });

  async function saveQuoteExcelToDesktop(fileName, base64Data, meta) {
    const safeFileName = sanitizeFileName(fileName, "megrendelo.xlsx");
    const finalName = safeFileName.toLowerCase().endsWith(".xlsx") ? safeFileName : safeFileName + ".xlsx";
    const m = meta && typeof meta === "object" ? meta : {};
    const target = await resolveOrderSaveTargetAsync(ORDER_SAVE_DIR, {
      fileName: finalName,
      customerName: m.customerName,
      quoteNumber: m.quoteNumber
    });
    await fsPromises.mkdir(target.dir, { recursive: true });
    const fullPath = path.join(target.dir, finalName);
    await fsPromises.writeFile(fullPath, Buffer.from(String(base64Data || ""), "base64"));
    return fullPath;
  }

  async function saveDeliveryNoteExcelToDesktop(fileName, base64Data, meta) {
    const safeFileName = sanitizeFileName(fileName, "szallitolevel.xlsx");
    const finalName = safeFileName.toLowerCase().endsWith(".xlsx") ? safeFileName : safeFileName + ".xlsx";
    const m = meta && typeof meta === "object" ? meta : {};
    const target = await resolveOrderSaveTargetAsync(ORDER_SAVE_DIR, {
      fileName: finalName,
      customerName: m.customerName,
      quoteNumber: m.quoteNumber
    });
    await fsPromises.mkdir(target.dir, { recursive: true });
    const fullPath = path.join(target.dir, finalName);
    await fsPromises.writeFile(fullPath, Buffer.from(String(base64Data || ""), "base64"));
    return fullPath;
  }

  await context.exposeBinding("divianSaveQuotePdf", async (_source, args) => {
    const savedPath = await saveQuotePdfToDesktop(args || {});
    return { ok: true, savedPath };
  });

  await context.exposeBinding("divianSaveQuoteExcel", async (_source, args) => {
    const fileName = String(args?.fileName || "megrendelo.xlsx");
    const base64 = String(args?.base64 || "");
    if (!base64) return { ok: false, error: "missing base64" };
    try {
      const savedPath = await saveQuoteExcelToDesktop(fileName, base64, {
        customerName: args?.customerName,
        quoteNumber: args?.quoteNumber
      });
      return { ok: true, savedPath };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  await context.exposeBinding("divianSaveDeliveryNoteExcel", async (_source, args) => {
    const fileName = String(args?.fileName || "szallitolevel.xlsx");
    const base64 = String(args?.base64 || "");
    if (!base64) return { ok: false, error: "missing base64" };
    try {
      const savedPath = await saveDeliveryNoteExcelToDesktop(fileName, base64, {
        customerName: args?.customerName,
        quoteNumber: args?.quoteNumber
      });
      return { ok: true, savedPath };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  await context.exposeBinding("divianSaveOrderDocumentPdf", async (_source, args) => {
    const a = args || {};
    const htmlText = String(a.htmlText || "");
    if (!htmlText) return { ok: false, error: "missing htmlText" };
    try {
      const savedPath = await saveOrderDocumentPdfToDesktop(a);
      return { ok: true, savedPath };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  await context.exposeBinding("divianSaveDeliveryNotePdf", async (_source, args) => {
    const a = args || {};
    const htmlText = String(a.htmlText || "");
    if (!htmlText) return { ok: false, error: "missing htmlText" };
    try {
      const saved = await saveDeliveryNotePdfToDesktop(a);
      return { ok: true, savedPath: saved.savedPath, folderLabel: saved.folderLabel || "" };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  await context.exposeBinding("divianSaveNagykerExcel", async (_source, args) => {
    const fileName = String(args?.fileName || "nagyker.xlsx");
    const base64 = String(args?.base64 || "");
    if (!base64) return { ok: false, error: "missing base64" };
    const result = await saveNagykerExcelToDesktop(fileName, base64);
    return { ok: true, savedPath: result.savedPath, overwritten: !!result.overwritten };
  });

  const screenshotApiServer = http.createServer(async (req, res) => {
    try {
      let pathname = (() => {
        const u = String(req.url || "");
        const q = u.indexOf("?");
        return (q === -1 ? u : u.slice(0, q)) || "/";
      })();
      if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.replace(/\/+$/, "") || "/";
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname === "/health" && req.method === "GET") {
        const szInfo = (() => {
          try {
            const { describeSzamlazzStartupMode } = require("./szamlazz-integration");
            return describeSzamlazzStartupMode();
          } catch (_e) {
            return null;
          }
        })();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            mode: "playwright-forwarder",
            playwright: true,
            cynclyLiveImport: true,
            szamlazzLocalOnly: szInfo ? szInfo.mode === "local" : false,
            szamlazzDraftOnly: !!(szInfo && szInfo.draftOnly),
            szamlazzLiveAllowed: !!(szInfo && szInfo.liveAllowed),
            szamlazzHasAuth: !!(szInfo && szInfo.hasAuth),
            szamlazzMode: szInfo ? szInfo.mode : "unknown",
            szamlazzLabel: szInfo ? szInfo.label : "",
            szamlazzViewHint: szInfo ? szInfo.viewHint || "" : "",
            szamlazzAccountUrl: szInfo ? szInfo.accountUrl || "" : "",
            szamlazzDebugSave: !!(szInfo && szInfo.debugSave),
            routes: [
              "/health GET",
              "/screenshot POST",
              "/planner-items POST",
              "/thunderbird-compose POST",
              "/delivery-note/save-pdf POST",
              "/szamlazz/issue POST",
              "/saved-orders/resolve GET",
              "/saved-orders/save POST",
              "/saved-orders/save-pdf POST",
              "/api/felmeres-queue GET",
              "/api/felmeres-queue POST",
              "/api/crm/overview GET",
              "/api/crm/today GET",
              "/api/crm/search GET",
              "/api/crm/tasks GET|POST|PATCH|DELETE",
              "/api/crm/contacts POST|PATCH",
              "/api/crm/project PATCH",
              "/api/minicrm/status GET",
              "/api/minicrm/today GET",
              "/api/minicrm/projects GET",
              "/api/minicrm/project GET",
              "/api/szereles-jobs GET",
              "/api/szereles-schedule POST",
              "/api/szereles-photo POST",
              "/api/szereles-close POST",
              "/api/felmeres-close POST",
              "/api/szereles-photo/:jobId/:photoId GET",
              "/api/public-url GET",
              "/api/feature-flags GET",
              "/auth-accounts GET",
              "/auth-accounts POST",
              "/* GET statikus fájlok (kalkulátor mappa)"
            ],
            ajanlatUrl: ARAJANLAT_URL,
            quoteUiUrl: QUOTE_UI_URL,
            dashboardUrl: buildLocalArajanlatHttpUrl("dashboard.html"),
            staticRoot: STATIC_ROOT,
            staticHttpOrigin: "http://" + STATIC_BROWSER_HOST + ":" + SCREENSHOT_API_PORT,
            divianRender: "browser-local",
            userDataRoot: DIVIAN_USER_DATA_ROOT,
            authAccountsFile: AUTH_ACCOUNTS_FILE,
            screenshotApiHost: SCREENSHOT_API_HOST,
            screenshotApiPort: SCREENSHOT_API_PORT
          })
        );
        return;
      }
      if (pathname === "/auth-accounts" && req.method === "GET") {
        const accounts = readAuthAccountsFromFile();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, accounts, file: AUTH_ACCOUNTS_FILE }));
        return;
      }
      if (pathname === "/auth-accounts" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const saved = writeAuthAccountsToFile(parsed.accounts || parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, accounts: saved, file: AUTH_ACCOUNTS_FILE }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/list" && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const enriched = String(u.searchParams.get("enriched") || "") === "1";
        try {
          const rows = enriched ? await scanOrderSaveDirEnriched() : await scanOrderSaveDir();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, rows, folder: ORDER_SAVE_DIR }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/read" && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const file = String(u.searchParams.get("file") || "").trim();
        try {
          const result = await readOrderSaveFile(file);
          res.writeHead(result.ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/read-pdf" && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const quote = String(u.searchParams.get("quote") || u.searchParams.get("number") || "").trim();
        if (!quote) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "missing quote parameter" }));
          return;
        }
        try {
          const result = await readOrderSavePdfBuffer(quote);
          if (!result.ok || !result.buffer) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                ok: false,
                error: result.error || "pdf-not-found",
                quote,
                folder: ORDER_SAVE_DIR
              })
            );
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition":
              'inline; filename="' + String(result.fileName || "megrendelo.pdf").split("/").pop() + '"',
            "X-Divian-Quote-Number": String(result.quoteNumber || "")
          });
          res.end(result.buffer);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/parse-megrendelo-pdf" && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const quote = String(u.searchParams.get("quote") || u.searchParams.get("number") || "").trim();
        if (!quote) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "missing quote parameter" }));
          return;
        }
        try {
          const result = await parseMegrendeloPdfPayloadFromDisk(quote);
          if (!result.ok) {
            res.writeHead(result.error === "pdf-not-found" ? 404 : 422, {
              "Content-Type": "application/json"
            });
            res.end(JSON.stringify(result));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/resolve" && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const quote = String(u.searchParams.get("quote") || u.searchParams.get("number") || "").trim();
        if (!quote) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "missing quote parameter" }));
          return;
        }
        try {
          const hit = await resolveQuoteJsonFromDisk(quote);
          if (!hit) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                ok: false,
                error: "json-not-found",
                quote,
                hint:
                  "A Mentett megrendelők mappában nincs ehhez a számhoz .json — mentéskor automatikusan készül."
              })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, ...hit }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/save" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const fileName = String(parsed.fileName || "megrendeles.json").trim();
          const jsonText = String(parsed.jsonText || "");
          const savedPath = await saveOrderJsonToDesktop({
            fileName,
            jsonText,
            customerName: parsed.customerName,
            quoteNumber: parsed.quoteNumber
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, savedPath, folder: ORDER_SAVE_DIR }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/saved-orders/save-pdf" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const htmlText = String(parsed.htmlText || "");
          if (!htmlText) throw new Error("missing-htmlText");
          const savedPath = await saveQuotePdfToDesktop({
            fileName: parsed.fileName,
            htmlText,
            customerName: parsed.customerName,
            quoteNumber: parsed.quoteNumber
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, savedPath, folder: ORDER_SAVE_DIR }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/felmeres-queue" && req.method === "GET") {
        try {
          const rows = await readFelmeresQueue();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, rows, file: QUEUE_FILE }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/felmeres-queue" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          if (Array.isArray(parsed.rows)) {
            const result = await writeFelmeresQueue(parsed.rows);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }
          const result = await appendFelmeresEntry(parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/felmeres-queue" && req.method === "PATCH") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const rows = await readFelmeresQueue();
          const entry = rows.find((r) => String(r?.id || "") === String(parsed.id || ""));
          const rawPatch =
            parsed.patch && typeof parsed.patch === "object" ? parsed.patch : {};
          const patch = preserveScheduleFields(
            prepareFelmeresPatch(entry, rawPatch),
            rawPatch
          );
          if (entry) {
            const validation = validateFelmeresPatch(entry, patch);
            if (!validation.ok) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify(validation));
              return;
            }
          }
          const result = await updateFelmeresEntry(parsed.id, patch);
          res.writeHead(result.ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/felmeres-queue" && req.method === "DELETE") {
        const u = new URL(req.url || "", "http://localhost");
        const id = String(u.searchParams.get("id") || "").trim();
        try {
          const result = await deleteFelmeresEntry(id);
          res.writeHead(result.ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/szereles-schedule" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const pin = String(parsed.pin || parsed.carpenterPin || "").trim();
          const auth = await authenticateCarpenter(pin);
          if (!auth.ok) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-pin" }));
            return;
          }
          const jobId = String(parsed.id || parsed.jobId || "").trim();
          const entry = await findSzerelesJobById(jobId);
          if (!entry) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not-found" }));
            return;
          }
          const access = await assertCarpenterJobAccess(entry, pin);
          if (!access.ok) {
            res.writeHead(access.error === "forbidden" ? 403 : 401, {
              "Content-Type": "application/json"
            });
            res.end(JSON.stringify(access));
            return;
          }
          const result = await applySzerelesSchedule(jobId, {
            kind: parsed.kind,
            felmeresScheduledDate: parsed.felmeresScheduledDate,
            installationScheduledDate: parsed.installationScheduledDate,
            carpenterName: parsed.carpenterName || auth.crewName || null
          });
          res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/szereles-jobs" && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const scope = String(u.searchParams.get("scope") || "open").toLowerCase();
        const pin = String(u.searchParams.get("pin") || u.searchParams.get("carpenterPin") || "").trim();
        try {
          const auth = await authenticateCarpenter(pin);
          if (!auth.ok) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-pin" }));
            return;
          }
          const jobs =
            scope === "all"
              ? await listAllSzerelesJobs(auth.crewId)
              : await listOpenSzerelesJobs(auth.crewId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              jobs,
              count: jobs.length,
              crewId: auth.crewId,
              crewName: auth.crewName
            })
          );
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      const szerelesJobMatch = pathname.match(/^\/api\/szereles-jobs\/([^/]+)$/);
      if (szerelesJobMatch && req.method === "GET") {
        const u = new URL(req.url || "", "http://localhost");
        const pin = String(u.searchParams.get("pin") || "").trim();
        try {
          const auth = await authenticateCarpenter(pin);
          if (!auth.ok) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-pin" }));
            return;
          }
          const entry = await findSzerelesJobById(decodeURIComponent(szerelesJobMatch[1]));
          if (!entry) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not-found" }));
            return;
          }
          const access = await assertCarpenterJobAccess(entry, pin);
          if (!access.ok) {
            res.writeHead(access.error === "forbidden" ? 403 : 401, { "Content-Type": "application/json" });
            res.end(JSON.stringify(access));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, job: jobSummary(entry) }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/szereles-photo" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const auth = await authenticateCarpenter(parsed.pin || parsed.carpenterPin);
          if (!auth.ok) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-pin" }));
            return;
          }
          const result = await addSzerelesPhoto(parsed.id || parsed.jobId, parsed);
          res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/szereles-close" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const auth = await authenticateCarpenter(parsed.pin || parsed.carpenterPin);
          if (!auth.ok) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-pin" }));
            return;
          }
          const result = await closeSzerelesJob(parsed.id || parsed.jobId, parsed);
          res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/felmeres-close" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const auth = await authenticateCarpenter(parsed.pin || parsed.carpenterPin);
          if (!auth.ok) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-pin" }));
            return;
          }
          const result = await closeFelmeresJob(parsed.id || parsed.jobId, parsed);
          res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      const szerelesPhotoGet = pathname.match(/^\/api\/szereles-photo\/([^/]+)\/([^/]+)$/);
      if (szerelesPhotoGet && req.method === "GET") {
        try {
          const jobId = decodeURIComponent(szerelesPhotoGet[1]);
          const photoId = decodeURIComponent(szerelesPhotoGet[2]);
          const absPath = await resolvePhotoPath(jobId, photoId);
          if (!absPath) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not-found" }));
            return;
          }
          const buf = await fsPromises.readFile(absPath);
          res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" });
          res.end(buf);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/szereles-drawing" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const result = await addSzerelesDrawing(parsed.id || parsed.jobId, parsed);
          res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      const szerelesDrawingGet = pathname.match(/^\/api\/szereles-drawing\/([^/]+)\/([^/]+)$/);
      if (szerelesDrawingGet && req.method === "GET") {
        try {
          const jobId = decodeURIComponent(szerelesDrawingGet[1]);
          const drawingId = decodeURIComponent(szerelesDrawingGet[2]);
          const resolved = await resolveDrawingPath(jobId, drawingId);
          if (!resolved?.absPath) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not-found" }));
            return;
          }
          const buf = await fsPromises.readFile(resolved.absPath);
          res.writeHead(200, {
            "Content-Type": drawingContentType(resolved.drawing),
            "Cache-Control": "private, max-age=3600"
          });
          res.end(buf);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/planner-url" && req.method === "GET") {
        const url = resolveCynclyPlannerUrl();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, url, file: CYNCLY_PLANNER_URL_FILE }));
        return;
      }
      if (pathname === "/api/public-url" && req.method === "GET") {
        const publicUrl = resolvePublicBaseUrl();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            publicUrl,
            asztalosAppUrl: asztalosAppUrl(publicUrl),
            adminCenterLanUrl: adminCenterLanUrl(SCREENSHOT_API_PORT),
            adminCenterPublicUrl: readAdminPublicUrl()
              ? readAdminPublicUrl() + "/admin-center.html"
              : "",
            localUrl: buildLanHttpUrl("asztalos-szereles.html")
          })
        );
        return;
      }
      if (pathname === "/api/feature-flags" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        });
        res.end(JSON.stringify(getFeatureFlagsSnapshot()));
        return;
      }
      if (pathname === "/api/asztalos-public-url" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        req.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(body || "{}");
          } catch (_err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
            return;
          }
          const url = String(parsed.url || parsed.publicUrl || "")
            .trim()
            .replace(/\/+$/, "");
          if (!url.startsWith("http")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-url" }));
            return;
          }
          writeManualPublicUrl(url);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              publicUrl: url,
              asztalosAppUrl: asztalosAppUrl(url)
            })
          );
        });
        return;
      }
      if (pathname.startsWith("/api/minicrm/")) {
        const mcUrl = new URL(req.url || "/", "http://localhost");
        if (req.method !== "GET") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
          return;
        }
        try {
          const mcResult = await handleMiniCrmApi(pathname, req.method, {}, mcUrl.searchParams);
          if (!mcResult) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "minicrm-route-not-found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(mcResult));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname.startsWith("/api/crm/")) {
        const crmUrl = new URL(req.url || "/", "http://localhost");
        let crmBody = {};
        if (req.method === "GET") {
          if (pathname === "/api/crm/search") {
            crmBody = { q: crmUrl.searchParams.get("q") || "" };
          }
        } else if (req.method === "DELETE") {
          crmBody = { id: crmUrl.searchParams.get("id") || "" };
        } else {
          let raw = "";
          req.on("data", (chunk) => {
            raw += String(chunk || "");
          });
          await new Promise((resolve) => req.on("end", resolve));
          try {
            crmBody = raw ? JSON.parse(raw) : {};
          } catch (_err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
            return;
          }
        }
        try {
          const crmResult = await handleCrmApi(pathname, req.method, crmBody);
          if (!crmResult) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "crm-route-not-found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(crmResult));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/admin-settings" && req.method === "GET") {
        try {
          const settings = await readAdminSettings();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, settings, file: SETTINGS_FILE }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/calendar/divian.ics" && req.method === "GET") {
        try {
          const u = new URL(req.url || "", "http://localhost");
          const token = String(u.searchParams.get("token") || "").trim();
          const settings = await readAdminSettings();
          const cal = mergeCalendarSettings(settings);
          if (!cal.enabled) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Calendar feed disabled");
            return;
          }
          const okToken = await verifyCalendarToken(token);
          if (!okToken) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Invalid calendar token");
            return;
          }
          const ics = await buildDivianIcsFeed(cal);
          res.writeHead(200, {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="divian.ics"',
            "Cache-Control": "no-cache, max-age=300"
          });
          res.end(ics);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("ICS error: " + String(err?.message || err));
        }
        return;
      }
      if (pathname === "/api/admin-settings" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const result = await writeAdminSettings(parsed.settings || parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/thunderbird-compose" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        try {
          const result = await handleThunderbirdComposeRequest(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/delivery-note/save-pdf" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        try {
          const result = await handleDeliveryNoteSavePdfRequest(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/szamlazz/issue" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        try {
          const result = await handleSzamlazzRequest(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/workflow/confirm-wall" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        const snapshot = Array.isArray(parsed.snapshot) ? parsed.snapshot : [];
        console.log(
          "[workflow] confirm-wall:",
          snapshot.length,
          "elem,",
          snapshot
            .slice(0, 8)
            .map((r) => r?.code)
            .filter(Boolean)
            .join(" → ")
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            phase: "accessories_auto",
            itemCount: snapshot.length,
            confirmedAt: parsed.confirmedAt || new Date().toISOString()
          })
        );
        return;
      }
      if (pathname === "/api/dashboard-data" && req.method === "GET") {
        try {
          const result = await readDashboardDataFromArajanlat();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/dashboard-sync-push" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const result = await pushDashboardSyncToArajanlat(parsed.sync || parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/quote-action" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const result = await runQuoteWorkflowAction(String(parsed.action || ""), parsed.extra || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/arajanlat-focus" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          parsed = {};
        }
        try {
          const page = await ensureArajanlatDedicatedTab({ focus: parsed.focus !== false });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, url: page.url() }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/cyncly-status" && req.method === "GET") {
        try {
          const status = await getCynclyPlannerStatus();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/api/cyncly-focus" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        try {
          const plannerUrl = String(parsed?.plannerUrl || "").trim() || undefined;
          await ensureCynclyPlannerPage(plannerUrl, { focus: true });
          const page = findCynclyDedicatedPage();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              url: page && !page.isClosed() ? page.url() : resolveCynclyPlannerUrl(plannerUrl)
            })
          );
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
        return;
      }
      if (pathname === "/planner-items" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
          return;
        }
        const plannerUrl = String(parsed?.plannerUrl || "").trim();
        await ensureCynclyPlannerPage(plannerUrl || undefined);
        const surface = getCynclyPlannerSurface();
        if (!surface || isPlannerTargetClosed(surface)) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "cyncly-page-missing" }));
          return;
        }
        await fetchPlannerItemsForPage(surface, { triggerClick: true });
        const hostPage = getPlannerHostPage();
        if (hostPage && !hostPage.isClosed()) await hostPage.waitForTimeout(1200);
        let payload = null;
        for (let attempt = 0; attempt < 4 && (!payload || !payload.items?.length); attempt++) {
          if (attempt > 0) {
            if (hostPage && !hostPage.isClosed()) await hostPage.waitForTimeout(1800);
            await fetchPlannerItemsForPage(surface, { triggerClick: attempt < 2 });
          }
          if (lastItemListsRequestUrl) {
            try {
              const json = await surface.evaluate(async (url) => {
                const r = await fetch(url, { credentials: "include" });
                if (!r.ok) return null;
                return r.json();
              }, lastItemListsRequestUrl);
              if (json) {
                const commercialItems = extractCommercialItemsFromJson(json);
                const items = normalizeItems(commercialItems);
                if (items.length) payload = buildQtyOnlyPayload(items, lastItemListsRequestUrl);
              }
            } catch (_buildErr) {
              /* pass */
            }
          }
        }
        if (!payload || !payload.items?.length) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: "no-items",
              hint: "Nyisd meg a Cyncly Terméklista nézetet, majd próbáld újra."
            })
          );
          return;
        }
        await postMessageToAjanlatPages(context, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      if (pathname === "/screenshot" && req.method === "POST") {
        console.log("[Screenshot API] screenshot request received");
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk || "");
        });
        await new Promise((resolve) => req.on("end", resolve));
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (_err) {}
        const payload = await capturePlannerScreenshotPayload(String(parsed?.label || "Aktuális nézet"), parsed?.plannerUrl);
        await postMessageToAjanlatPages(context, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      if (await tryServeStaticFile(req, res, pathname)) return;
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "not-found",
          path: pathname,
          hint:
            "Ismeretlen útvonal. API: /health, /screenshot. Statikus: " +
            buildLocalArajanlatHttpUrl("arajanlat.html") +
            " · parancspult: /dashboard.html"
        })
      );
    } catch (err) {
      console.error("[Screenshot API] request failed:", err?.message || err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  });
  screenshotApiServer.listen(SCREENSHOT_API_PORT, SCREENSHOT_API_HOST, () => {
    console.log(
      `[Init] helyi szerver (API + statikus): http://${STATIC_BROWSER_HOST}:${SCREENSHOT_API_PORT}`
    );
    console.log(`[Init] árajánlat: ${ARAJANLAT_URL}`);
    console.log(`[Init] parancspult: ${buildLocalArajanlatHttpUrl("dashboard.html")}`);
    if (LAN_HOST_FROM_FILE && LAN_HOST_FROM_FILE !== STATIC_BROWSER_HOST) {
      console.log(
        `[Init] LAN (telefon / másik gép): http://${LAN_HOST_FROM_FILE}:${SCREENSHOT_API_PORT}/`
      );
    }
    try {
      const { logSzamlazzStartupMode } = require("./szamlazz-integration");
      logSzamlazzStartupMode("[Init]");
    } catch (_err) {
      /* lazy */
    }
    const configuredPublic = resolvePublicBaseUrl();
    if (configuredPublic) {
      console.log("[Init] asztalos app (beállított nyilvános):", asztalosAppUrl(configuredPublic));
    } else if (LAN_HOST_FROM_FILE) {
      console.log(
        `[Init] asztalos app (helyi LAN): http://${LAN_HOST_FROM_FILE}:${SCREENSHOT_API_PORT}/asztalos-szereles.html`
      );
    }
    maybeStartPublicTunnel().catch((err) => {
      console.error("[Init] tunnel indítás sikertelen:", err?.message || err);
    });
  });

  context.on("response", async (response) => {
    const url = response.url();
    if (!url.includes(TARGET_HINT)) return;

    const status = response.status();
    if (status < 200 || status >= 400) {
      let bodySnippet = "";
      try {
        bodySnippet = (await response.text()).slice(0, 500);
      } catch (_e) {
        bodySnippet = "";
      }
      console.error(`[item-lists] HTTP ${status}`, url.slice(0, 200), bodySnippet.slice(0, 160));
      const sentErr = await postMessageToAjanlatPages(context, {
        type: "divian-planner-api-error",
        status,
        url,
        bodySnippet,
        capturedAt: new Date().toISOString()
      });
      if (sentErr > 0) {
        console.log(`[item-lists] HTTP ${status} — értesítve: ${sentErr} arajanlat lap.`);
      }
      return;
    }

    try {
      const json = await response.json();
      await ingestItemListsJson(json, url);
    } catch (_err) {
      console.error("[item-lists] JSON / feldolgozás hiba:", url.slice(0, 160), String(_err?.message || _err));
    }
  });

  let ajanlatPage = context.pages().find((page) => isAjanlatPage(page.url()));
  if (!ajanlatPage) {
    ajanlatPage = await context.newPage();
  }

  const initPlannerUrl = resolveCynclyPlannerUrl();
  try {
    await ensureCynclyDedicatedPlannerTab(initPlannerUrl, { focus: true });
    console.log("");
    console.log("=== CYNCLY BEJELENTKEZÉS ===");
    console.log("1) A Chrome-ban megnyílt egy Cyncly fül");
    console.log("2) Jelentkezz be: vaciut@divian.hu");
    console.log("3) Utána válts vissza a Divian parancspult fülre");
    console.log("============================");
    console.log("");
  } catch (plannerErr) {
    console.warn("[Init] Cyncly tervező lap:", String(plannerErr?.message || plannerErr));
  }

  try {
    await ajanlatPage.goto(QUOTE_UI_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  } catch (gotoErr) {
    throw new Error(
      "parancspult nem nyitható: " + String(gotoErr?.message || gotoErr) + " (" + QUOTE_UI_URL + ")"
    );
  }
  await ajanlatPage.bringToFront();
  console.log("[Init] Parancspult →", QUOTE_UI_URL);

  try {
    await ensureArajanlatDedicatedTab({ focus: false });
    console.log("[Init] Árajánlat külön lap megnyitva");
  } catch (quoteErr) {
    console.warn("[Init] Árajánlat lap:", String(quoteErr?.message || quoteErr));
  }

  ensureCynclyPlannerPage(initPlannerUrl, { focus: false })
    .then(() => console.log("[Init] Cyncly tervező háttér ellenőrzés kész"))
    .catch((plannerErr) => console.warn("[Init] Cyncly háttér:", String(plannerErr?.message || plannerErr)));

  if (envFlagForwarder("DIVIAN_FAST_START", false)) {
    console.log("[Init] gyors indulás — társoldalak (számla) kihagyva");
  } else {
    console.log("[Init] Társoldalak:", SZAMLA_ELORESZLET_URL);
    await openStartupCompanionPages(context, ajanlatPage);
  }

  // Fallback: API/fetch nelkul kezeli a kepkerest az arajanlat oldalrol.
  let lastHandledScreenshotRequestId = null;
  setInterval(async () => {
    try {
      const pages = listQuoteRelayPages(context);
      for (const page of pages) {
        const pending = await readPendingScreenshotRequest(page);
        const requestId = pending && pending.id ? String(pending.id) : null;
        const requestLabel = String(pending && pending.label ? pending.label : "Aktuális nézet");
        if (!requestId || requestId === lastHandledScreenshotRequestId) continue;
        lastHandledScreenshotRequestId = requestId;
        const payload = await capturePlannerScreenshotPayload(requestLabel, pending?.plannerUrl);
        await postMessageToQuotePage(page, payload);
        await clearPendingScreenshotRequest(page);
        console.log("[Screenshot Bridge] screenshot request served:", requestId);
      }
    } catch (_err) {
      // keep polling
    }
  }, 1000);
}

start().catch((err) => {
  console.error("Fatal error:", err);
  if (isChromeProfileLockError(err)) {
    console.error("");
    console.error("=== Chrome profil zárolva (exitCode=21) ===");
    console.error("1) Zárd be a régi Divian/Cyncly Chrome ablakokat");
    console.error("2) Futtasd: leallitas-17321.bat");
    console.error("3) Futtasd: node tools\\clear-chrome-profile-lock.js");
    console.error("4) Indítsd újra: inditas-teszt-tervezo.bat");
  }
  process.exit(1);
});
