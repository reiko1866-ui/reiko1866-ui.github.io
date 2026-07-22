/**
 * Könnyű helyi szerver — Playwright / Chrome nélkül.
 * Számlázz.hu teszthez és kalkulátor böngészőből: http://localhost:17321/arajanlat.html
 *
 * Indítás: node divian-static-server.js
 * Vagy: inditas-teszt.bat
 */
const http = require("http");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const {
  ORDER_SAVE_DIR,
  scanOrderSaveDir,
  readOrderSaveFile,
  resolveQuoteJsonFromDisk,
  saveOrderJsonToDesktop
} = require("./divian-saved-orders");

let cynclyBridge = null;
function getCynclyBridge() {
  if (!cynclyBridge) cynclyBridge = require("./divian-cyncly-bridge");
  return cynclyBridge;
}

function handleSzamlazzRequest(body) {
  const { handleSzamlazzRequest: fn } = require("./szamlazz-integration");
  return fn(body);
}

const CYNCLY_DEFAULT_URL =
  "https://planner.cyncly-idealspaces.com/hu/design/Draft?partnership=divian";
const CYNCLY_PLANNER_URL_FILE = path.join(__dirname, "divian-planner-url.txt");

const PORT = Number(process.env.DIVIAN_STATIC_PORT || 17321);
const HOST = process.env.DIVIAN_STATIC_HOST && String(process.env.DIVIAN_STATIC_HOST).trim()
  ? String(process.env.DIVIAN_STATIC_HOST).trim()
  : "127.0.0.1";
const STATIC_HTTP_HOST = process.env.DIVIAN_STATIC_BROWSER_HOST && String(process.env.DIVIAN_STATIC_BROWSER_HOST).trim()
  ? String(process.env.DIVIAN_STATIC_BROWSER_HOST).trim()
  : "localhost";
const STATIC_ROOT = __dirname;

function envFlag(name, defaultTrue) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return defaultTrue;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function isValidCynclyPlannerUrl(url) {
  const u = String(url || "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.hostname !== "planner.cyncly-idealspaces.com") return false;
    if (parsed.searchParams.get("partnership") !== "divian") return false;
    const pathname = String(parsed.pathname || "").toLowerCase();
    if (pathname.includes("/hu/design/")) return true;
    if (/^\/hu\/[^/]+\/edit\/?$/i.test(pathname)) return true;
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
  } catch (_err) {
    /* ignore */
  }
  return "";
}

function resolveCynclyPlannerUrl() {
  const fromEnv =
    process.env.CYNCLY_PLANNER_URL && String(process.env.CYNCLY_PLANNER_URL).trim();
  if (fromEnv && isValidCynclyPlannerUrl(fromEnv)) return fromEnv;
  const fromFile = readPlannerUrlFromFile();
  if (fromFile) return fromFile;
  return CYNCLY_DEFAULT_URL;
}

function openUrlInDefaultBrowser(url) {
  const target = String(url || "").trim();
  if (!target) return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

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
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk || "");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizePathname(reqUrl) {
  let pathname = (() => {
    const u = String(reqUrl || "");
    const q = u.indexOf("?");
    return (q === -1 ? u : u.slice(0, q)) || "/";
  })();
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

const ajanlatUrl = "http://" + STATIC_HTTP_HOST + ":" + PORT + "/arajanlat.html";
const plannerUrl = resolveCynclyPlannerUrl();

function openStartupBrowserTabs() {
  if (!envFlag("DIVIAN_OPEN_BROWSER", true)) return;
  const openPlanner = envFlag("DIVIAN_OPEN_PLANNER", true);
  setImmediate(() => {
    try {
      if (openPlanner) {
        console.log("[static-server] Böngésző: Cyncly + árajánlat");
        openUrlInDefaultBrowser(plannerUrl);
        setTimeout(() => openUrlInDefaultBrowser(ajanlatUrl), 400);
      } else {
        console.log("[static-server] Böngésző: árajánlat");
        openUrlInDefaultBrowser(ajanlatUrl);
      }
    } catch (err) {
      console.warn(
        "[static-server] Böngésző megnyitás sikertelen — nyisd kézzel: " +
          ajanlatUrl +
          " (" +
          String(err?.message || err) +
          ")"
      );
    }
  });
}

process.on("uncaughtException", (err) => {
  console.error("[static-server] FATAL:", err?.stack || err?.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[static-server] FATAL promise:", reason);
});

const server = http.createServer(async (req, res) => {
  try {
    const pathname = normalizePathname(req.url);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          mode: "static-only",
          playwright: false,
          cynclyLiveImport: false,
          cynclyBridge: "on-demand-cli",
          routes: [
            "/health GET",
            "/saved-orders/list GET",
            "/saved-orders/read GET",
            "/saved-orders/resolve GET",
            "/saved-orders/save POST",
            "/planner-items POST",
            "/screenshot POST",
            "/szamlazz/issue POST",
            "/* GET statikus fájlok"
          ],
          ajanlatUrl,
          plannerUrl,
          orderSaveDir: ORDER_SAVE_DIR,
          staticRoot: STATIC_ROOT,
          szamlazzSandbox: String(process.env.SZAMLAZZ_USE_SANDBOX || "true"),
          szamlazzLocalOnly: (() => {
            try {
              const { isLocalOnlyMode } = require("./szamlazz-integration");
              return isLocalOnlyMode();
            } catch (_e) {
              return true;
            }
          })()
        })
      );
      return;
    }

    if (pathname === "/planner-items" && req.method === "POST") {
      const body = await readRequestBody(req);
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (_err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
        return;
      }
      const plannerUrl = String(parsed.plannerUrl || "").trim();
      if (!plannerUrl) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "missing-plannerUrl" }));
        return;
      }
      try {
        const payload = await getCynclyBridge().fetchPlannerItems(plannerUrl);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: String(err?.message || err),
            hint: "Megnyílik egy Playwright ablak — jelentkezz be a Cyncly-be, ha kell."
          })
        );
      }
      return;
    }

    if (pathname === "/screenshot" && req.method === "POST") {
      const body = await readRequestBody(req);
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (_err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
        return;
      }
      const plannerUrl = String(parsed.plannerUrl || "").trim();
      const label = String(parsed.label || "HD render").trim();
      if (!plannerUrl) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "missing-plannerUrl" }));
        return;
      }
      try {
        const payload = await getCynclyBridge().captureScreenshot(plannerUrl, label);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: String(err?.message || err),
            hint: "HD render 1–3 perc — ne zárd be a Playwright ablakot."
          })
        );
      }
      return;
    }

    if (pathname === "/szamlazz/issue" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await handleSzamlazzRequest(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === "/saved-orders/list" && req.method === "GET") {
      const rows = await scanOrderSaveDir();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, rows, folder: ORDER_SAVE_DIR }));
      return;
    }

    if (pathname === "/saved-orders/read" && req.method === "GET") {
      const u = new URL(req.url || "", "http://localhost");
      const file = String(u.searchParams.get("file") || "").trim();
      const result = await readOrderSaveFile(file);
      res.writeHead(result.ok ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
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
      const hit = await resolveQuoteJsonFromDisk(quote);
      if (!hit) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "json-not-found",
            quote,
            folder: ORDER_SAVE_DIR
          })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...hit, folder: ORDER_SAVE_DIR }));
      return;
    }

    if (pathname === "/saved-orders/save" && req.method === "POST") {
      const body = await readRequestBody(req);
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (_err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
        return;
      }
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
      return;
    }

    if (await tryServeStaticFile(req, res, pathname)) return;

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "not-found",
        path: pathname,
        hint: "Statikus: " + ajanlatUrl + " · API: POST /szamlazz/issue"
      })
    );
  } catch (err) {
    console.error("[static-server] hiba:", err?.message || err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      "[static-server] HIBA: a " +
        PORT +
        " port foglalt (pl. fut még a divian-playwright-forwarder.js)."
    );
    console.error("[static-server] Zárd be a régi ablakot, vagy: taskkill /F /IM node.exe");
    process.exit(1);
  }
  console.error("[static-server] HIBA:", err?.message || err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const fast = envFlag("DIVIAN_FAST_START", false);
  if (fast) {
    console.log("[static-server] Kesz: " + ajanlatUrl);
  } else {
    console.log("[static-server] Playwright nelkuli mod");
    console.log("[static-server] Arajanlat: " + ajanlatUrl);
    console.log("[static-server] Mentett megrendelok: " + ORDER_SAVE_DIR);
  }
  try {
    const { logSzamlazzStartupMode } = require("./szamlazz-integration");
    logSzamlazzStartupMode("[static-server]");
  } catch (_err) {
    /* lazy */
  }
  openStartupBrowserTabs();
});
