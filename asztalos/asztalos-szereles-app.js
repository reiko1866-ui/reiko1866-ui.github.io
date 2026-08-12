(function () {
  "use strict";

  const APP_VERSION = "20260812felmeres";
  const LS_PIN = "divian_szereles_pin";
  const LS_NAME = "divian_szereles_name";
  const LS_CREW_ID = "divian_szereles_crew_id";
  const LS_CREW_NAME = "divian_szereles_crew_name";
  const LS_API = "divian_szereles_api";
  const LS_API_MANUAL = "divian_szereles_api_manual";
  const LS_JOBS_CACHE = "divian_szereles_jobs_cache_v1";
  const LS_IS_ADMIN = "divian_szereles_is_admin";
  const LS_ADMIN_CENTER_URL = "divian_szereles_admin_center_url";
  const LS_NOTIFY_SEEN = "divian_szereles_notify_seen_v1";
  const LS_NOTIFY_WATERMARK = "divian_szereles_notify_watermark_v1";
  const SS_OWNER_KEY = "divian_szereles_owner_key";
  const OFFLINE_DB = "divian_szereles_offline_v1";
  const OFFLINE_DB_VERSION = 2;
  const STORE_PHOTOS = "pendingPhotos";
  const STORE_CLOSES = "pendingCloses";
  const STORE_JOBS = "cachedJobDetails";
  const PHOTO_KIND = {
    installation: "installation",
    signedDocument: "signed-document",
    survey: "survey"
  };

  let currentJob = null;
  let uploading = false;
  let jobsPollTimer = null;
  let syncPollTimer = null;
  let notifyPollTimer = null;
  let syncInFlight = false;
  let notifyToastHost = null;
  const NOTIFY_POLL_SECONDS = 20;

  function loadNotifySeen() {
    try {
      const raw = localStorage.getItem(LS_NOTIFY_SEEN);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) {
      return {};
    }
  }

  function saveNotifySeen(map) {
    try {
      localStorage.setItem(LS_NOTIFY_SEEN, JSON.stringify(map || {}));
    } catch (_e) {}
  }

  function ensureNotifyToastHost() {
    if (notifyToastHost) return notifyToastHost;
    notifyToastHost = document.createElement("div");
    notifyToastHost.id = "crewNotifyHost";
    notifyToastHost.setAttribute("aria-live", "polite");
    notifyToastHost.style.cssText =
      "position:fixed;left:1rem;right:1rem;top:calc(0.75rem + env(safe-area-inset-top));z-index:99999;display:grid;gap:0.5rem;pointer-events:none;max-width:520px;margin:0 auto";
    document.body.appendChild(notifyToastHost);
    return notifyToastHost;
  }

  function showCrewNotifyToast(title, body, onClick) {
    const host = ensureNotifyToastHost();
    const card = document.createElement("button");
    card.type = "button";
    card.style.cssText =
      "pointer-events:auto;text-align:left;width:100%;background:#1a222c;border:1px solid rgba(201,162,39,0.45);color:#f2f4f7;border-radius:14px;padding:0.85rem 1rem;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-size:0.9rem;line-height:1.4;cursor:pointer";
    card.innerHTML =
      "<strong style='display:block;color:#c9a227;margin-bottom:0.25rem'>" +
      escapeHtml(title) +
      "</strong><span style='color:#9aa5b1;white-space:pre-line'>" +
      escapeHtml(body) +
      "</span>";
    card.addEventListener("click", () => {
      if (typeof onClick === "function") onClick();
      card.remove();
    });
    host.appendChild(card);
    window.setTimeout(() => card.remove(), 12000);
  }

  async function requestNotifyPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      return await Notification.requestPermission();
    } catch (_e) {
      return "denied";
    }
  }

  function showCrewBrowserNotify(item) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = String(item?.title || "Új munka");
    const body = String(item?.body || item?.customerName || "").replace(/\n/g, " · ");
    try {
      const n = new Notification(title, {
        body,
        tag: "crew-" + String(item?.id || item?.jobId || Date.now()),
        renotify: true
      });
      n.onclick = () => {
        window.focus?.();
        if (item?.jobId) openJob(item.jobId);
        n.close();
      };
    } catch (_e) {}
  }

  function shouldShowCrewNotify(item) {
    const id = String(item?.id || "");
    if (!id) return false;
    const seen = loadNotifySeen();
    return seen[id] !== String(item?.createdAt || "1");
  }

  function markCrewNotifySeen(item) {
    const id = String(item?.id || "");
    if (!id) return;
    const seen = loadNotifySeen();
    seen[id] = String(item?.createdAt || "");
    saveNotifySeen(seen);
  }

  async function pollCrewNotifications(opts) {
    const silent = !!(opts && opts.silent);
    if (!pin() || !apiBase() || !isOnline()) return;
    try {
      const watermark = String(localStorage.getItem(LS_NOTIFY_WATERMARK) || "").trim();
      const url =
        "/api/crew-notifications?pin=" +
        encodeURIComponent(pin()) +
        (watermark ? "&since=" + encodeURIComponent(watermark) : "");
      const json = await apiJson(url);
      const list = Array.isArray(json.notifications) ? json.notifications.slice().reverse() : [];
      let fresh = 0;
      list.forEach((item) => {
        if (!shouldShowCrewNotify(item)) return;
        markCrewNotifySeen(item);
        fresh++;
        showCrewBrowserNotify(item);
        showCrewNotifyToast(item.title || "Új munka", item.body || entryNotifyLabel(item), () => {
          if (item.jobId) openJob(item.jobId);
        });
      });
      if (fresh && isListPanelVisible()) {
        loadJobs({ silent: true });
      }
    } catch (_e) {}
  }

  function updateNotifyPermissionUi() {
    const btn = $("enableNotifyBtn");
    if (!btn) return;
    const show =
      isListPanelVisible() &&
      "Notification" in window &&
      Notification.permission !== "granted";
    btn.classList.toggle("hidden", !show);
  }

  function entryNotifyLabel(item) {
    const name = String(item?.customerName || "Ügyfél").trim();
    const quote = String(item?.quoteNumber || "").trim();
    const dl = String(item?.deadlineLabel || "").trim();
    let text = quote ? name + " · " + quote : name;
    if (dl && dl !== "—") text += "\nHatáridő: " + dl;
    if (item?.customerAddress) text += "\n" + item.customerAddress;
    return text;
  }

  function stopNotifyPolling() {
    if (notifyPollTimer) {
      clearInterval(notifyPollTimer);
      notifyPollTimer = null;
    }
  }

  function startNotifyPolling() {
    stopNotifyPolling();
    notifyPollTimer = setInterval(() => pollCrewNotifications({ silent: true }), NOTIFY_POLL_SECONDS * 1000);
  }


  function $(id) {
    return document.getElementById(id);
  }

  function isFetchError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || err?.code === "tunnel-reminder";
  }

  async function upgradeAppShell() {
    let needsUpgrade = false;
    try {
      needsUpgrade = localStorage.getItem("divian_szereles_app_ver") !== APP_VERSION;
      if (needsUpgrade) localStorage.setItem("divian_szereles_app_ver", APP_VERSION);
    } catch (_e) {}

    if (!needsUpgrade) return;

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => !k.includes("divian-szereles-v5")).map((k) => caches.delete(k)));
      }
    } catch (_e) {}
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("asztalos-szereles-sw.js?v=20260715b");
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg.update?.();
    } catch (_e) {}
  }

  function ensureLinkUploadUi() {
    if ($("linkSetupBox")) return;
    const host = $("loginPanel")?.parentElement || document.querySelector(".app");
    if (!host) return;

    const style = document.createElement("style");
    style.id = "divian-link-upload-fallback";
    style.textContent =
      ".link-upload-box{border:2px dashed rgba(201,162,39,.55);border-radius:14px;padding:1rem;text-align:center;margin-bottom:1rem}" +
      ".link-upload-box strong{display:block;color:#c9a227;margin-bottom:.35rem}" +
      "#apiBase{width:100%;min-height:4rem;padding:.75rem;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:#0c1015;color:#f2f4f7;resize:vertical}" +
      ".link-actions{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.75rem}" +
      ".saved-link-bar{border:1px solid rgba(62,207,142,.35);background:rgba(62,207,142,.08);border-radius:12px;padding:.85rem;margin-bottom:1rem}";
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "serverLinkPanel";
    panel.className = "panel";
    panel.innerHTML =
      '<div id="linkSetupBox" class="link-upload-box">' +
      "<strong>🔗 Link feltöltése</strong>" +
      '<p style="color:#9aa5b1;font-size:.88rem;margin:.35rem 0 .75rem">Az irodától kapott HTTPS linket illeszd be ide.</p>' +
      '<textarea id="apiBase" rows="3" placeholder="https://….trycloudflare.com/asztalos-szereles.html" spellcheck="false"></textarea>' +
      '<div class="link-actions">' +
      '<button type="button" id="pasteLinkBtn" class="btn btn-secondary">Beillesztés</button>' +
      '<button type="button" id="saveLinkBtn" class="btn btn-primary">Link mentése</button>' +
      "</div>" +
      '<div id="linkStatus" class="status"></div>' +
      "</div>" +
      '<div id="savedLinkBar" class="saved-link-bar hidden">' +
      '<div id="savedLinkText" style="word-break:break-all;font-size:.88rem;margin-bottom:.5rem"></div>' +
      '<button type="button" id="editLinkBtn" class="btn btn-secondary btn-small">Link módosítása</button>' +
      "</div>";
    const login = $("loginPanel");
    if (login) host.insertBefore(panel, login);
    else host.prepend(panel);

    const oldWrap = document.getElementById("apiBaseWrap");
    if (oldWrap) oldWrap.remove();
    else {
      document.querySelectorAll("#apiBase").forEach((el) => {
        if (!el.closest("#linkSetupBox")) el.remove();
      });
    }
  }

  function isOnline() {
    return navigator.onLine !== false;
  }

  function defaultApiBase() {
    try {
      const loc = window.location;
      const host = String(loc.hostname || "").toLowerCase();
      // GitHub Pages / statikus tükör → élő Fly API
      if (
        host.endsWith(".github.io") ||
        host.endsWith(".pages.dev") ||
        host.endsWith(".workers.dev")
      ) {
        return "https://divian-asztalos.fly.dev";
      }
      if (loc.protocol === "https:") return loc.origin;
      if (loc.protocol === "http:" && (loc.port === "17321" || loc.port === "17322")) {
        return loc.origin;
      }
    } catch (_e) {}
    return "";
  }

  async function readTextUrl(path) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) return "";
      const raw = String(await res.text());
      const line = raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s && !s.startsWith("#"));
      return line || "";
    } catch (_e) {
      return "";
    }
  }

  function normalizeServerLink(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    s = s.replace(/\/+$/, "");
    s = s.replace(/\/asztalos-szereles\.html$/i, "");
    if (!/^https?:\/\//i.test(s) && /[.:]/.test(s)) s = "https://" + s;
    return s.replace(/\/+$/, "");
  }

  function isTrustedCloudOrigin(origin) {
    const o = String(origin || "").toLowerCase();
    return (
      o.includes("divian-asztalos.fly.dev") ||
      /\.fly\.dev$/i.test(o.replace(/^https?:\/\//, "").split("/")[0] || "") ||
      o.includes("trycloudflare.com")
    );
  }

  async function resolveApiBase() {
    const fromOrigin = defaultApiBase();
    // Élő HTTPS / Fly origin mindig elsőbbséget élvez a régi mentett tunnel linkkel szemben.
    if (fromOrigin && (String(window.location.protocol) === "https:" || isTrustedCloudOrigin(fromOrigin))) {
      try {
        localStorage.setItem(LS_API, fromOrigin);
        localStorage.removeItem(LS_API_MANUAL);
      } catch (_e) {}
      return fromOrigin;
    }

    const manualSaved = localStorage.getItem(LS_API_MANUAL) === "1";
    const saved = normalizeServerLink(localStorage.getItem(LS_API));
    if (manualSaved && saved) {
      // Ha a mentett link régi loca.lt / elavult tunnel, ne ragadjon be.
      if (/loca\.lt|trycloudflare\.com|ngrok/i.test(saved) && fromOrigin && isTrustedCloudOrigin(fromOrigin)) {
        return fromOrigin;
      }
      return saved;
    }

    if (fromOrigin) return fromOrigin;
    if (saved) return saved;

    const manual = normalizeServerLink(await readTextUrl("/divian-asztalos-public-url.txt"));
    if (manual.startsWith("http")) return manual;

    try {
      const res = await fetch("/api/public-url", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        const url = normalizeServerLink(json.publicUrl || "");
        if (url) return url;
      }
    } catch (_e) {}

    return "";
  }

  function apiBase() {
    return normalizeServerLink($("apiBase")?.value);
  }

  function pin() {
    return String($("carpenterPin")?.value || localStorage.getItem(LS_PIN) || "").trim();
  }

  function isValidPin(value) {
    const s = String(value || "").trim();
    return /^\d{4}$/.test(s) || /^\d{6}$/.test(s);
  }

  function isAdminSession() {
    return localStorage.getItem(LS_IS_ADMIN) === "1";
  }

  const CREW_LABELS = { "1": "Misi", "2": "Balázs", "3": "Gombás" };
  let crewOptions = [
    { id: "1", name: "Misi" },
    { id: "2", name: "Balázs" },
    { id: "3", name: "Gombás" }
  ];

  function crewLabelForJob(job) {
    const id = String(job?.installationCrew || "").trim();
    const hit = crewOptions.find((c) => String(c.id) === id);
    return (hit && hit.name) || CREW_LABELS[id] || id || "—";
  }

  function setCrewOptions(list) {
    if (!Array.isArray(list) || !list.length) return;
    crewOptions = list
      .map((c) => ({ id: String(c.id || ""), name: String(c.name || c.id || "") }))
      .filter((c) => c.id);
    try {
      localStorage.setItem("divian_szereles_crews", JSON.stringify(crewOptions));
    } catch (_e) {}
    syncAdminCrewSelectOptions();
  }

  function loadCachedCrewOptions() {
    try {
      const raw = JSON.parse(localStorage.getItem("divian_szereles_crews") || "[]");
      if (Array.isArray(raw) && raw.length) setCrewOptions(raw);
    } catch (_e) {}
  }

  function syncAdminCrewSelectOptions(selected) {
    const sel = $("adminCrewSelect");
    if (!sel) return;
    const cur = selected != null ? String(selected || "") : String(sel.value || "");
    sel.innerHTML =
      '<option value="">— Asztalos —</option>' +
      crewOptions
        .map(
          (c) =>
            '<option value="' +
            escapeHtml(c.id) +
            '">' +
            escapeHtml(c.name || c.id) +
            "</option>"
        )
        .join("");
    sel.value = cur;
  }

  function carpenterName() {
    return String(localStorage.getItem(LS_CREW_NAME) || localStorage.getItem(LS_NAME) || "").trim();
  }

  function applyAuthSession(json) {
    if (json?.crewId) localStorage.setItem(LS_CREW_ID, String(json.crewId));
    if (json?.crewName) {
      localStorage.setItem(LS_CREW_NAME, String(json.crewName));
      localStorage.setItem(LS_NAME, String(json.crewName));
    }
    if (json?.isAdmin) {
      localStorage.setItem(LS_IS_ADMIN, "1");
    } else {
      localStorage.removeItem(LS_IS_ADMIN);
    }
    if (Array.isArray(json?.crews) && json.crews.length) setCrewOptions(json.crews);
    updateCrewHeader(json?.crewName, !!json?.isAdmin);
    updateAdminBar(!!json?.isAdmin);
  }

  async function rememberAdminCenterUrls() {
    const base = apiBase();
    if (!base) return;
    try {
      const res = await fetch(base + "/health", {
        cache: "no-store",
        headers: { "Bypass-Tunnel-Reminder": "1", "X-Divian-Asztalos": "1" }
      });
      if (!res.ok) return;
      const json = await res.json();
      const url =
        String(json.adminCenterPublicUrl || json.adminCenterLanUrl || "").trim() ||
        "";
      if (url) localStorage.setItem(LS_ADMIN_CENTER_URL, url);
    } catch (_e) {}
  }

  function updateAdminBar(isAdmin) {
    const bar = $("adminBar");
    if (!bar) return;
    if (!isAdmin) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      return;
    }
    bar.classList.remove("hidden");
    const adminUrl = String(localStorage.getItem(LS_ADMIN_CENTER_URL) || "").trim();
    const base = apiBase();
    const quoteUrl = base ? base + "/arajanlat.html#beallitasok" : "";
    const lanHint = adminUrl
      ? '<a class="admin-bar-link" href="' +
        escapeHtml(adminUrl) +
        '" target="_blank" rel="noopener">Admin központ</a>'
      : "<span>Admin: Wi‑Fi-n 192.168.3.128:17321/admin-center.html</span>";
    const dbHint = quoteUrl
      ? ' · <a class="admin-bar-link" href="' +
        escapeHtml(quoteUrl) +
        '" target="_blank" rel="noopener">Excel adatbázis</a>'
      : "";
    bar.innerHTML =
      "<strong>Admin</strong> · " + lanHint + dbHint;
  }

  function setStatus(el, msg, tone) {
    if (!el) return;
    el.textContent = String(msg || "");
    el.classList.remove("is-err", "is-ok");
    if (tone === "err") el.classList.add("is-err");
    if (tone === "ok") el.classList.add("is-ok");
  }

  async function countPendingSync() {
    try {
      const photos = await idbAll(STORE_PHOTOS);
      const closes = await idbAll(STORE_CLOSES);
      return photos.length + closes.length;
    } catch (_e) {
      return 0;
    }
  }

  function updateAppChrome(activePanel) {
    const loggedIn = activePanel === "listPanel" || activePanel === "detailPanel";
    $("appHeader")?.classList.toggle("is-minimal", loggedIn);
    if (loggedIn && apiBase()) {
      $("serverLinkPanel")?.classList.add("hidden");
    } else {
      updateLinkDisplay();
    }
  }

  async function updateNetworkBanner() {
    const box = $("networkBanner");
    if (!box) return;
    const pending = await countPendingSync();
    const loggedIn =
      !($("listPanel")?.classList.contains("hidden")) ||
      !($("detailPanel")?.classList.contains("hidden"));
    box.classList.remove("is-offline", "is-pending", "is-ok", "is-compact", "hidden");

    if (!isOnline()) {
      box.classList.add("is-offline");
      box.textContent = pending
        ? "Offline · " + pending + " tétel vár feltöltésre"
        : "Offline mód";
      return;
    }
    if (!apiBase()) {
      box.classList.add("is-offline");
      box.textContent = pending
        ? "Nincs szerver link · " + pending + " tétel vár"
        : "Nincs szerver link";
      return;
    }
    if (pending) {
      box.classList.add("is-pending");
      box.textContent = "Szinkron… " + pending + " tétel feltöltés alatt";
      return;
    }
    if (loggedIn) {
      box.classList.add("hidden");
      return;
    }
    box.classList.add("is-ok", "is-compact");
    box.textContent = "Online · szinkronban";
  }

  function stopSyncPolling() {
    if (syncPollTimer) {
      clearInterval(syncPollTimer);
      syncPollTimer = null;
    }
  }

  function startSyncPolling() {
    stopSyncPolling();
    syncPollTimer = setInterval(async () => {
      if (!pin()) return;
      const pending = await countPendingSync();
      if (!pending && isOnline() && apiBase()) return;
      await runSyncCycle({ silent: true });
    }, 20000);
  }

  async function runSyncCycle(opts) {
    const silent = !!(opts && opts.silent);
    if (syncInFlight) return null;
    syncInFlight = true;
    try {
      const result = await syncOfflineQueue();
      await updateNetworkBanner();
      if ((result.photos || result.closes) && pin()) {
        if ($("detailPanel") && !($("detailPanel").classList.contains("hidden")) && currentJob) {
          await openJob(currentJob.id);
        } else if (!silent || isListPanelVisible()) {
          await loadJobs({ silent: true });
        }
      }
      return result;
    } finally {
      syncInFlight = false;
    }
  }
  function isListPanelVisible() {
    const panel = $("listPanel");
    return !!(panel && !panel.classList.contains("hidden"));
  }

  function stopJobsPolling() {
    if (jobsPollTimer) {
      clearInterval(jobsPollTimer);
      jobsPollTimer = null;
    }
  }

  function startJobsPolling() {
    stopJobsPolling();
    jobsPollTimer = setInterval(() => {
      if (!pin() || !apiBase() || !isOnline() || !isListPanelVisible()) return;
      loadJobs({ silent: true });
    }, 30000);
  }

  function showPanel(id) {
    ["loginPanel", "listPanel", "detailPanel"].forEach((pid) => {
      $(pid)?.classList.toggle("hidden", pid !== id);
    });
    updateAppChrome(id);
    updateNotifyPermissionUi();
    if (id === "listPanel" && pin()) {
      startJobsPolling();
      startSyncPolling();
      startNotifyPolling();
      pollCrewNotifications({ silent: true });
    } else {
      stopJobsPolling();
      stopSyncPolling();
      stopNotifyPolling();
    }
  }

  function openOfflineDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
          db.createObjectStore(STORE_PHOTOS, { keyPath: "localId" });
        }
        if (!db.objectStoreNames.contains(STORE_CLOSES)) {
          db.createObjectStore(STORE_CLOSES, { keyPath: "localId" });
        }
        if (!db.objectStoreNames.contains(STORE_JOBS)) {
          db.createObjectStore(STORE_JOBS, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexeddb-failed"));
    });
  }

  async function idbAll(storeName) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(storeName, row) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(row);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(storeName, key) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function countLocalPhotos(jobId, photoKind) {
    const rows = await idbAll(STORE_PHOTOS);
    return rows.filter(
      (r) =>
        String(r.jobId) === String(jobId) &&
        String(r.photoKind || PHOTO_KIND.installation) === String(photoKind || PHOTO_KIND.installation)
    ).length;
  }

  async function listLocalPhotos(jobId, photoKind) {
    const rows = await idbAll(STORE_PHOTOS);
    return rows.filter(
      (r) =>
        String(r.jobId) === String(jobId) &&
        String(r.photoKind || PHOTO_KIND.installation) === String(photoKind || PHOTO_KIND.installation)
    );
  }

  function serverPhotosByKind(job, kind) {
    const key =
      kind === PHOTO_KIND.survey
        ? "surveyPhotos"
        : kind === PHOTO_KIND.signedDocument
          ? "signedDocumentPhotos"
          : "installationPhotos";
    if (Array.isArray(job?.[key]) && job[key].length) return job[key];
    const photos = Array.isArray(job?.photos) ? job.photos : [];
    return photos.filter((p) => String(p.kind || PHOTO_KIND.installation) === kind);
  }

  function photoGridHtml(serverList, localList, emptyText) {
    const serverHtml = (serverList || [])
      .map(
        (p) =>
          '<img src="' + escapeHtml(apiBase() + p.url) + '" alt="Fénykép" loading="lazy" />'
      )
      .join("");
    const localHtml = (localList || [])
      .map(
        (p) =>
          '<img src="' +
          escapeHtml(p.imageBase64) +
          '" alt="Helyi fénykép" loading="lazy" class="is-local" />'
      )
      .join("");
    if (!serverHtml && !localHtml) {
      return '<p class="photo-empty">' + escapeHtml(emptyText) + "</p>";
    }
    return serverHtml + localHtml;
  }

  function statusPill(text, tone) {
    const cls =
      tone === "ok" ? " is-ok" : tone === "gold" ? " is-gold" : tone === "warn" ? " is-warn" : "";
    return '<span class="status-pill' + cls + '">' + escapeHtml(text) + "</span>";
  }

  function setMediaCount(el, count) {
    if (!el) return;
    const n = Math.max(0, Number(count) || 0);
    el.textContent = n + " db";
    el.classList.toggle("is-ok", n > 0);
  }

  function setChecklistItem(el, done, showMissing) {
    if (!el) return;
    el.classList.toggle("is-done", !!done);
    el.classList.toggle("is-missing", !!showMissing && !done);
  }

  function ownerKey() {
    try {
      return String(sessionStorage.getItem(SS_OWNER_KEY) || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function ensureOwnerKeyForPages() {
    if (ownerKey()) return ownerKey();
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      if (
        !(
          host.endsWith(".github.io") ||
          host.endsWith(".pages.dev") ||
          host.endsWith(".workers.dev")
        )
      ) {
        return "";
      }
      const typed = window.prompt(
        "Tulajdonosi jelszó (egyszer, amíg a lap nyitva van) — a Fly API eléréséhez kell:"
      );
      const key = String(typed || "").trim();
      if (!key) return "";
      sessionStorage.setItem(SS_OWNER_KEY, key);
      return key;
    } catch (_e) {
      return "";
    }
  }

  async function apiJson(path, opts) {
    const base = apiBase();
    if (!base) throw new Error("Nincs szerver cím — kérj linket az irodától.");
    const headers = Object.assign(
      {
        "Bypass-Tunnel-Reminder": "1",
        "X-Divian-Asztalos": "1"
      },
      opts && opts.headers ? opts.headers : {}
    );
    let key = ownerKey() || ensureOwnerKeyForPages();
    if (key) headers["X-Divian-Owner-Key"] = key;

    async function doFetch(hdrs) {
      let res;
      try {
        res = await fetch(base + path, Object.assign({}, opts || {}, { headers: hdrs }));
      } catch (e) {
        throw new Error(String(e && (e.message || e)) + " — API: " + base);
      }
      const ct = String(res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        if (res.status === 401 || /text\/html/i.test(ct)) {
          const err = new Error("Tulajdonosi belépés kell a felhő API-hoz.");
          err.code = "locked";
          throw err;
        }
        const err = new Error(
          "A szerver nem válaszol rendesen. Ha loca.lt link: nyisd meg böngészőben, kattints a „Folytatás / Click to Continue” gombra, majd próbáld újra."
        );
        err.code = "tunnel-reminder";
        throw err;
      }
      const json = await res.json().catch(() => ({}));
      return { res, json };
    }

    let { res, json } = await doFetch(headers);
    if ((!res.ok || json.ok === false) && String(json.error || "") === "locked") {
      try {
        sessionStorage.removeItem(SS_OWNER_KEY);
      } catch (_e) {}
      const again = ensureOwnerKeyForPages();
      if (again) {
        headers["X-Divian-Owner-Key"] = again;
        ({ res, json } = await doFetch(headers));
      }
    }
    if (!res.ok || json.ok === false) {
      const code = String(json.error || "");
      const hu = {
        locked: "Tulajdonosi belépés kell a felhő API-hoz.",
        "invalid-pin": "Hibás PIN kód.",
        forbidden: "Ez a munka nem a te részedhez tartozik.",
        "not-found": "A munka nem található.",
        "not-installation-job": "Ez nem szerelési munka.",
        "already-closed": "Ez a szerelés már le van zárva.",
        "photo-required":
          json.message ||
          "Legalább egy szerelés fénykép kell a lezáráshoz (és fel kell mennie a szerverre).",
        "signed-document-required":
          json.message ||
          "Kötelező az aláírt beszerelési nyilatkozat fényképe a lezáráshoz.",
        "survey-photo-required":
          json.message || "Legalább egy felmérés fénykép kell a lezáráshoz.",
        "survey-form-required":
          json.message || "Legalább egy felmérés adatlap kell — fotózd le a helyszínen.",
        "tunnel-reminder":
          "A szerver nem válaszol rendesen. Nyisd meg a linket böngészőben, majd próbáld újra."
      };
      const err = new Error(hu[code] || json.message || json.error || "HTTP " + res.status);
      err.code = code || json.error;
      throw err;
    }
    return json;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function saveServerLink() {
    const url = normalizeServerLink($("apiBase")?.value);
    if (!url || !/^https?:\/\//i.test(url)) {
      setStatus($("linkStatus"), "Érvénytelen link — https://… formátum kell.", "err");
      return;
    }
    $("apiBase").value = url;
    localStorage.setItem(LS_API, url);
    localStorage.setItem(LS_API_MANUAL, "1");
    setStatus($("linkStatus"), "Kapcsolat ellenőrzése…", "");
    try {
      const res = await fetch(url + "/health", {
        cache: "no-store",
        headers: { "Bypass-Tunnel-Reminder": "1", "X-Divian-Asztalos": "1" }
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setStatus($("linkStatus"), "Link mentve — szerver elérhető ✓", "ok");
      updateLinkDisplay();
    } catch (err) {
      setStatus(
        $("linkStatus"),
        "Link mentve, de a szerver nem válaszol: " + String(err.message || err),
        "err"
      );
      updateLinkDisplay();
    }
  }

  async function pasteServerLink() {
    try {
      const text = await navigator.clipboard.readText();
      const url = normalizeServerLink(text);
      if (!url) {
        setStatus($("linkStatus"), "A vágólapon nincs érvényes link.", "err");
        return;
      }
      $("apiBase").value = url;
      setStatus($("linkStatus"), "Link beillesztve — kattints a Mentés gombra.", "ok");
    } catch (_err) {
      setStatus($("linkStatus"), "Nem sikerült beilleszteni — tartsd nyomva a mezőt, majd Illesztés.", "err");
    }
  }

  function updateLinkDisplay() {
    const configured = !!apiBase();
    const setupBox = $("linkSetupBox");
    const savedBar = $("savedLinkBar");
    const loginPanel = $("loginPanel");
    const linkPanel = $("serverLinkPanel");
    const loggedIn =
      !($("listPanel")?.classList.contains("hidden")) ||
      !($("detailPanel")?.classList.contains("hidden"));

    if (configured) {
      setupBox?.classList.add("hidden");
      savedBar?.classList.remove("hidden");
      if ($("savedLinkText")) $("savedLinkText").textContent = apiBase();
      loginPanel?.classList.remove("hidden");
      if (loggedIn) {
        linkPanel?.classList.add("hidden");
      } else {
        linkPanel?.classList.remove("hidden");
      }
    } else {
      setupBox?.classList.remove("hidden");
      savedBar?.classList.add("hidden");
      loginPanel?.classList.add("hidden");
      linkPanel?.classList.remove("hidden");
    }
  }

  function showLinkEditor() {
    $("linkSetupBox")?.classList.remove("hidden");
    $("savedLinkBar")?.classList.add("hidden");
    $("serverLinkPanel")?.classList.remove("hidden");
    const current = apiBase() || normalizeServerLink(localStorage.getItem(LS_API));
    if (current && $("apiBase")) $("apiBase").value = current;
    $("apiBase")?.focus();
    setStatus($("linkStatus"), "", "");
  }

  async function verifyServerReachable() {
    const base = apiBase();
    if (!base) {
      updateLinkDisplay();
      return false;
    }
    if (!isOnline()) {
      updateLinkDisplay();
      return true;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(base + "/health", {
        cache: "no-store",
        signal: ctrl.signal,
        headers: { "Bypass-Tunnel-Reminder": "1", "X-Divian-Asztalos": "1" }
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      updateLinkDisplay();
      return true;
    } catch (_err) {
      if (localStorage.getItem(LS_API_MANUAL) === "1") {
        localStorage.removeItem(LS_API_MANUAL);
        localStorage.removeItem(LS_API);
        if ($("apiBase")) $("apiBase").value = "";
      }
      showLinkEditor();
      $("loginPanel")?.classList.add("hidden");
      setStatus(
        $("linkStatus"),
        "A szerver nem válaszol — illeszd be az új linket az irodától, majd mentsd.",
        "err"
      );
      return false;
    }
  }

  async function initApiBase() {
    const resolved = await resolveApiBase();
    const saved = normalizeServerLink(localStorage.getItem(LS_API));
    if ($("apiBase")) $("apiBase").value = resolved || saved || "";
    if (resolved && localStorage.getItem(LS_API_MANUAL) !== "1") {
      localStorage.setItem(LS_API, resolved);
    }
    await verifyServerReachable();
  }

  function restoreSession() {
    const savedPin = localStorage.getItem(LS_PIN);
    if (savedPin && $("carpenterPin")) $("carpenterPin").value = savedPin;
  }

  function showBootError(msg) {
    const box = document.createElement("div");
    box.style.cssText =
      "margin:1rem;padding:1rem;border-radius:12px;background:#5c1f1f;color:#ffd7d7;font-family:system-ui,sans-serif";
    box.textContent = String(msg || "Ismeretlen hiba");
    document.body.prepend(box);
  }

  function persistSession() {
    const prevPin = localStorage.getItem(LS_PIN);
    const nextPin = pin();
    if (prevPin && prevPin !== nextPin) {
      try {
        localStorage.removeItem(LS_JOBS_CACHE);
        localStorage.removeItem(LS_CREW_ID);
        localStorage.removeItem(LS_CREW_NAME);
      } catch (_e) {}
    }
    try {
      localStorage.setItem(LS_PIN, nextPin);
      if (apiBase()) localStorage.setItem(LS_API, apiBase());
    } catch (_e) {}
  }

  function updateCrewHeader(crewName, isAdmin) {
    const el = $("crewBadge");
    if (!el) return;
    const label = String(crewName || localStorage.getItem(LS_CREW_NAME) || "").trim();
    el.textContent = isAdmin || isAdminSession() ? "Admin — minden munka" : label;
    el.classList.toggle("hidden", !label && !isAdmin && !isAdminSession());
    el.classList.toggle("is-admin", !!(isAdmin || isAdminSession()));
  }

  function cacheJobs(jobs, crewMeta) {
    try {
      const crewId = crewMeta?.crewId || localStorage.getItem(LS_CREW_ID) || "";
      localStorage.setItem(
        LS_JOBS_CACHE,
        JSON.stringify({ at: Date.now(), crewId, jobs: jobs || [] })
      );
    } catch (_e) {}
  }

  function readCachedJobs() {
    try {
      const raw = localStorage.getItem(LS_JOBS_CACHE);
      const parsed = raw ? JSON.parse(raw) : null;
      const crewId = String(parsed?.crewId || "");
      const currentCrewId = String(localStorage.getItem(LS_CREW_ID) || "");
      if (crewId && currentCrewId && crewId !== currentCrewId) return [];
      return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    } catch (_e) {
      return [];
    }
  }

  async function cacheJobDetail(job) {
    if (!job?.id) return;
    try {
      await idbPut(STORE_JOBS, {
        id: String(job.id),
        job,
        at: Date.now()
      });
    } catch (_e) {}
  }

  async function readCachedJobDetail(jobId) {
    try {
      const db = await openOfflineDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_JOBS, "readonly");
        const req = tx.objectStore(STORE_JOBS).get(String(jobId));
        req.onsuccess = () => resolve(req.result?.job || null);
        req.onerror = () => resolve(null);
      });
    } catch (_e) {
      return null;
    }
  }

  async function enrichJobsWithLocalCounts(jobs) {
    const list = Array.isArray(jobs) ? jobs.slice() : [];
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      const localInstall = await countLocalPhotos(id, PHOTO_KIND.installation);
      const localSigned = await countLocalPhotos(id, PHOTO_KIND.signedDocument);
      const localSurvey = await countLocalPhotos(id, PHOTO_KIND.survey);
      list[i].installationPhotoCount =
        (list[i].installationPhotoCount || 0) + localInstall;
      list[i].signedDocumentCount = (list[i].signedDocumentCount || 0) + localSigned;
      list[i].surveyPhotoCount = (list[i].surveyPhotoCount || 0) + localSurvey;
      list[i].photoCount =
        (list[i].photoCount || 0) + localInstall + localSigned + localSurvey;
      list[i].hasLocalPhotos = localInstall + localSigned + localSurvey > 0;
    }
    return list;
  }

  function renderCustomerHead(job, opts) {
    if (typeof DivianCustomerBanner !== "undefined" && DivianCustomerBanner.renderCustomerHead) {
      return DivianCustomerBanner.renderCustomerHead(job, opts || {});
    }
    return (
      '<div class="customer-head"><h3 class="customer-head-name">' +
      escapeHtml(job.customerName || "Ügyfél") +
      '</h3><p class="customer-head-line">' +
      escapeHtml(job.quoteNumber || "—") +
      "</p></div>"
    );
  }

  function renderJobList(jobs) {
    const box = $("jobList");
    if (!box) return;
    const crewName = String(localStorage.getItem(LS_CREW_NAME) || "").trim();
    if (!jobs.length) {
      const admin = isAdminSession();
      box.innerHTML =
        '<div class="empty-jobs">' +
        "<strong>" +
        (admin ? "Nincs nyitott munka" : "Nincs hozzád rendelt munka") +
        "</strong>" +
        "<p>" +
        (admin
          ? "Ellenőrizd a Kanban táblán az asztalos hozzárendelést."
          : "Az iroda osztja ki a munkákat. Ha várható munka van, kérdezd az irodát.") +
        "</p>" +
        (crewName ? "<p>Bejelentkezve: <strong>" + escapeHtml(crewName) + "</strong></p>" : "") +
        "</div>";
      return;
    }
    box.innerHTML = jobs
      .map((job) => {
        const drawings = job.drawingCount || (job.drawings || []).length || 0;
        const pills = [];
        const crewId = String(job.installationCrew || "").trim();
        if (isAdminSession()) {
          pills.push(
            crewId
              ? statusPill(crewLabelForJob(job), "gold")
              : statusPill("Nincs kiosztva", "warn")
          );
        }
        if (job.felmeresRequested && !job.felmeresDone) {
          if (job.felmeresScheduledDate) {
            pills.push(statusPill("Felmérés: " + formatHuDate(job.felmeresScheduledDate), "gold"));
          } else {
            pills.push(statusPill("Felmérés · nincs dátum", "warn"));
          }
          pills.push(statusPill((job.surveyPhotoCount || 0) + " fotó", "gold"));
        } else if (job.felmeresDone) {
          pills.push(statusPill("Felmérés kész", "ok"));
        }
        if (job.installationScheduledDate && !job.installationClosed) {
          pills.push(statusPill("Szerelés: " + formatHuDate(job.installationScheduledDate), "ok"));
        } else if (!job.installationClosed) {
          pills.push(statusPill("Szerelés · nincs dátum", "warn"));
        }
        if (job.installationClosed) {
          pills.push(statusPill("Szerelés kész", "ok"));
        } else {
          pills.push(
            statusPill(
              (job.installationPhotoCount || 0) + " szerelés · " + (job.signedDocumentCount || 0) + " dok.",
              "gold"
            )
          );
        }
        if (drawings) pills.push(statusPill(drawings + " rajz", ""));
        if (job.hasLocalPhotos) pills.push(statusPill("Szinkron vár", "warn"));
        const pillsHtml = pills.length
          ? '<div class="job-card-status">' + pills.join("") + "</div>"
          : "";
        const assignHtml = isAdminSession()
          ? '<div class="job-card-assign" data-stop="1">' +
            '<select class="list-crew-select" data-id="' +
            escapeHtml(job.id) +
            '">' +
            '<option value="">— Asztalos —</option>' +
            crewOptions
              .map((c) => {
                const sel = crewId === String(c.id) ? " selected" : "";
                return (
                  '<option value="' +
                  escapeHtml(c.id) +
                  '"' +
                  sel +
                  ">" +
                  escapeHtml(c.name || c.id) +
                  "</option>"
                );
              })
              .join("") +
            "</select></div>"
          : "";
        return (
          '<article class="job-card" data-id="' +
          escapeHtml(job.id) +
          '">' +
          renderCustomerHead(job, { compact: true, showContact: false }) +
          pillsHtml +
          assignHtml +
          "</article>"
        );
      })
      .join("");
  }

  async function renderJobDetail(job) {
    const box = $("jobDetail");
    if (!box || !job) return;

    const banner = $("customerBanner");
    if (banner) {
      banner.innerHTML = renderCustomerHead(job, {
        compact: false,
        showContact: true,
        showActions: true,
        linkPhone: true,
        linkEmail: true,
        linkAddress: true
      });
    }

    const showSurvey = !!job.felmeresRequested && !job.felmeresDone;
    const showInstall = !job.installationClosed;
    $("surveySection")?.classList.toggle("hidden", !showSurvey);
    $("installSection")?.classList.toggle("hidden", !showInstall);
    $("surveySection")?.classList.toggle("is-done", !!job.felmeresDone);
    $("installSection")?.classList.toggle("is-done", !!job.installationClosed);
    syncScheduleUi(job);
    syncFelmeresScheduleUi(job);

    const localInstall = await listLocalPhotos(job.id, PHOTO_KIND.installation);
    const localSigned = await listLocalPhotos(job.id, PHOTO_KIND.signedDocument);
    const localSurvey = await listLocalPhotos(job.id, PHOTO_KIND.survey);

    $("installPhotos").innerHTML = photoGridHtml(
      serverPhotosByKind(job, PHOTO_KIND.installation),
      localInstall,
      "Még nincs szerelés fénykép."
    );
    $("signedDocPhotos").innerHTML = photoGridHtml(
      serverPhotosByKind(job, PHOTO_KIND.signedDocument),
      localSigned,
      "Még nincs aláírt dokumentum fénykép."
    );
    $("surveyPhotos").innerHTML = photoGridHtml(
      serverPhotosByKind(job, PHOTO_KIND.survey),
      localSurvey,
      "Még nincs felmérés fénykép."
    );

    function renderDrawingGroup(title, list) {
      if (!list.length) return "";
      return (
        '<div class="drawing-group"><span class="drawing-group-title">' +
        escapeHtml(title) +
        '</span><div class="drawing-list">' +
        list
          .map((d) => {
            const href = apiBase() + d.url;
            const label = escapeHtml(d.label || d.originalName || "PDF megnyitása");
            const isImage = String(d.mimeType || "").indexOf("image/") === 0;
            const preview = isImage
              ? '<img class="drawing-preview" src="' + escapeHtml(href) + '" alt="' + label + '" loading="lazy" />'
              : "";
            return (
              '<a class="drawing-link" href="' +
              escapeHtml(href) +
              '" target="_blank" rel="noopener"><span>📄</span><span>' +
              label +
              "</span></a>" +
              preview
            );
          })
          .join("") +
        "</div></div>"
      );
    }

    function renderOrderItemGroup(title, list) {
      if (!list || !list.length) return "";
      return (
        '<div class="order-items-group"><span class="drawing-group-title">' +
        escapeHtml(title) +
        '</span><ul class="order-items-list">' +
        list
          .map((row) => {
            const qty = Number(row.qty) || 1;
            const unit = escapeHtml(row.qtyUnit || "db");
            const code = escapeHtml(row.code || "");
            const name = escapeHtml(row.name || "");
            return (
              "<li><strong>" +
              (code || "—") +
              "</strong> · " +
              name +
              ' <span class="order-item-qty">' +
              qty +
              " " +
              unit +
              "</span></li>"
            );
          })
          .join("") +
        "</ul></div>"
      );
    }

    const drawings = Array.isArray(job.drawings) ? job.drawings : [];
    const kitchenPlans = drawings.filter((d) => String(d.kind || "") === "kitchen-plan");
    const installDrawings = drawings.filter((d) => String(d.kind || "") === "installation-drawing" || !d.kind);
    const felmeresForms = drawings.filter((d) => String(d.kind || "") === "felmeres-adatlap");
    const otherDocs = drawings.filter((d) => String(d.kind || "") === "other-document");

    let drawingsHtml = "";
    if (drawings.length) {
      drawingsHtml =
        renderDrawingGroup("Felmérés adatlap", felmeresForms) +
        renderDrawingGroup("Konyha kinézet", kitchenPlans) +
        renderDrawingGroup("Szerelési rajz", installDrawings) +
        renderDrawingGroup("Egyéb dokumentum", otherDocs);
    } else {
      drawingsHtml =
        '<p class="muted" style="margin:0 0 .75rem;opacity:.75">Még nincs feltöltött rajz / terv ehhez a munkához.</p>';
    }

    const oi = job.orderItems || { floor: [], wall: [], extras: [], totalCount: 0 };
    let orderHtml = "";
    if (oi.totalCount > 0) {
      orderHtml =
        '<div class="order-items-block"><span class="drawing-group-title">Megrendelő elemek (árak nélkül)</span>' +
        renderOrderItemGroup("Földön / alsó / magas", oi.floor) +
        renderOrderItemGroup("Fali / felső", oi.wall) +
        renderOrderItemGroup("Kiegészítők", oi.extras) +
        "</div>";
    } else {
      orderHtml =
        '<div class="order-items-block"><span class="drawing-group-title">Megrendelő elemek (árak nélkül)</span>' +
        '<p class="muted" style="margin:0;opacity:.75">Nincs betölthető tétellista a mentett megrendelőből.</p></div>';
    }

    box.innerHTML = orderHtml + drawingsHtml;

    const surveyFormsEl = $("surveyForms");
    if (surveyFormsEl) {
      if (!felmeresForms.length) {
        surveyFormsEl.innerHTML = '<p class="muted" style="margin:0;opacity:.7">Még nincs feltöltött adatlap.</p>';
      } else {
        surveyFormsEl.innerHTML = felmeresForms
          .map((d) => {
            const href = apiBase() + d.url;
            const label = escapeHtml(d.label || d.originalName || "Felmérés adatlap");
            return (
              '<a class="drawing-link" href="' +
              escapeHtml(href) +
              '" target="_blank" rel="noopener"><span>📄</span><span>' +
              label +
              "</span></a>"
            );
          })
          .join("");
      }
    }

    const installCount =
      serverPhotosByKind(job, PHOTO_KIND.installation).length + localInstall.length;
    const signedCount =
      serverPhotosByKind(job, PHOTO_KIND.signedDocument).length + localSigned.length;
    const surveyCount = serverPhotosByKind(job, PHOTO_KIND.survey).length + localSurvey.length;

    const canCloseInstall = installCount >= 1 && signedCount >= 1 && showInstall;
    const canCloseSurvey = surveyCount >= 1 && felmeresForms.length >= 1 && showSurvey;

    setMediaCount($("installPhotoCount"), installCount);
    setMediaCount($("signedDocCount"), signedCount);
    setMediaCount($("surveyPhotoCount"), surveyCount);
    setMediaCount($("surveyFormCount"), felmeresForms.length);

    setChecklistItem($("installReqPhoto"), installCount >= 1, showInstall && !canCloseInstall);
    setChecklistItem($("installReqDoc"), signedCount >= 1, showInstall && !canCloseInstall);
    setChecklistItem($("surveyReqPhoto"), surveyCount >= 1, showSurvey && !canCloseSurvey);
    setChecklistItem($("surveyReqForm"), felmeresForms.length >= 1, showSurvey && !canCloseSurvey);

    if ($("closeJobBtn")) {
      $("closeJobBtn").disabled = !canCloseInstall;
      $("closeJobBtn").classList.toggle("hidden", !showInstall);
    }
    if ($("closeSurveyBtn")) {
      $("closeSurveyBtn").disabled = !canCloseSurvey;
    }
    if ($("deleteJobBtn")) {
      $("deleteJobBtn").classList.toggle("hidden", !isAdminSession());
    }
    const assignCard = $("adminAssignCard");
    if (assignCard) {
      const showAssign = isAdminSession();
      assignCard.classList.toggle("hidden", !showAssign);
      if (showAssign) {
        syncAdminCrewSelectOptions(job.installationCrew || "");
      }
    }
  }

  async function assignCrewAsAdmin(jobId, crew, statusEl) {
    const id = String(jobId || "").trim();
    if (!id) return;
    if (!isAdminSession()) throw new Error("Csak admin oszthat ki.");
    if (!isOnline() || !apiBase()) throw new Error("Online kapcsolat kell a kiosztáshoz.");
    const crewId = String(crew || "").trim();
    const patch = { installationCrew: crewId || null };
    if (crewId) {
      patch.installationRequested = true;
      patch.felmeresRequested = true;
      patch.installationAssignedAt = new Date().toISOString();
    }
    await apiJson("/api/felmeres-queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, patch, pin: pin() })
    });
    const msg = crewId
      ? "Kiosztva: " + crewLabelForJob({ installationCrew: crewId }) + " ✓"
      : "Kiosztás törölve ✓";
    setStatus(statusEl || $("detailStatus") || $("listStatus"), msg, "ok");
    if (currentJob && String(currentJob.id) === id) {
      currentJob.installationCrew = crewId || null;
      if (crewId) {
        currentJob.installationRequested = true;
        currentJob.felmeresRequested = true;
      }
      syncAdminCrewSelectOptions(crewId);
    }
    await loadJobs({ silent: true });
  }

  async function syncOfflineQueue() {
    const pendingStart = await countPendingSync();
    if (!pin()) return { photos: 0, closes: 0, pending: pendingStart, waiting: false, errors: [] };
    if (!isOnline() || !apiBase()) {
      return { photos: 0, closes: 0, pending: pendingStart, waiting: true, errors: [] };
    }
    let uploaded = 0;
    let closed = 0;
    const errors = [];
    const pendingPhotos = await idbAll(STORE_PHOTOS);
    for (let i = 0; i < pendingPhotos.length; i++) {
      const row = pendingPhotos[i];
      try {
        await apiJson("/api/szereles-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: row.jobId,
            pin: pin(),
            carpenterName: row.carpenterName || carpenterName(),
            imageBase64: row.imageBase64,
            photoKind: row.photoKind || PHOTO_KIND.installation
          })
        });
        await idbDelete(STORE_PHOTOS, row.localId);
        uploaded++;
      } catch (err) {
        errors.push("Fénykép: " + String(err?.message || err));
      }
    }
    const pendingCloses = await idbAll(STORE_CLOSES);
    for (let j = 0; j < pendingCloses.length; j++) {
      const row = pendingCloses[j];
      try {
        const closeKind = String(row.closeKind || "installation");
        if (closeKind === "survey") {
          await apiJson("/api/felmeres-close", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: row.jobId,
              pin: pin(),
              carpenterName: row.carpenterName || carpenterName()
            })
          });
        } else {
          await apiJson("/api/szereles-close", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: row.jobId,
              pin: pin(),
              carpenterName: row.carpenterName || carpenterName()
            })
          });
        }
        await idbDelete(STORE_CLOSES, row.localId);
        closed++;
      } catch (err) {
        errors.push("Lezárás: " + String(err?.message || err));
      }
    }
    const pendingEnd = await countPendingSync();
    return { photos: uploaded, closes: closed, pending: pendingEnd, waiting: false, errors };
  }

  async function loadJobs(opts) {
    const silent = !!(opts && opts.silent);
    if (!silent) setStatus($("listStatus"), "Betöltés…", "");
    if (!silent) await updateNetworkBanner();
    try {
      if (isOnline() && apiBase()) {
        if (!silent) await runSyncCycle({ silent: false });
        else await syncOfflineQueue();
        const json = await apiJson(
          "/api/szereles-jobs?scope=open&pin=" + encodeURIComponent(pin())
        );
        applyAuthSession(json);
        const jobs = await enrichJobsWithLocalCounts(json.jobs || []);
        cacheJobs(jobs, { crewId: json.crewId });
        cachedOpenJobs = jobs;
        for (let i = 0; i < jobs.length; i++) {
          await cacheJobDetail(jobs[i]);
        }
        renderCalendar();
        renderJobList(jobs);
        const crewLabel = json.crewName ? " · " + json.crewName : "";
        const pending = await countPendingSync();
        const syncNote = pending ? " · " + pending + " vár szinkronra" : "";
        const statusText = (jobs.length || 0) + " nyitott szerelés" + crewLabel + syncNote;
        if (!silent) {
          setStatus($("listStatus"), statusText, jobs.length ? "ok" : "");
        } else if (jobs.length) {
          setStatus($("listStatus"), statusText, "ok");
        }
      } else {
        throw new Error("offline-or-no-server");
      }
    } catch (err) {
      if (silent && err?.message !== "offline-or-no-server") return;
      const cached = await enrichJobsWithLocalCounts(readCachedJobs());
      if (cached.length) {
        cachedOpenJobs = cached;
        renderCalendar();
        renderJobList(cached);
        const pending = await countPendingSync();
        setStatus(
          $("listStatus"),
          "Offline / szerver nem elérhető — mentett lista (" +
            cached.length +
            " munka" +
            (pending ? ", " + pending + " vár feltöltésre" : "") +
            ")",
          "err"
        );
      } else if (!silent) {
        setStatus($("listStatus"), String(err.message || err), "err");
      }
      if (err.code === "invalid-pin") {
        showPanel("loginPanel");
        setStatus($("loginStatus"), "Hibás PIN — minden asztalosnak saját 4 számjegyű kódja van (pl. Misi: 6236).", "err");
      }
    }
    await updateNetworkBanner();
  }

  async function openJob(jobId) {
    setStatus($("detailStatus"), "", "");
    try {
      if (isOnline() && apiBase()) {
        const json = await apiJson(
          "/api/szereles-jobs/" + encodeURIComponent(jobId) + "?pin=" + encodeURIComponent(pin())
        );
        currentJob = json.job;
        await cacheJobDetail(currentJob);
      } else {
        const cached =
          readCachedJobs().find((j) => String(j.id) === String(jobId)) ||
          (await readCachedJobDetail(jobId));
        currentJob = cached || { id: jobId, customerName: "Offline munka", quoteNumber: "—" };
      }
      await renderJobDetail(currentJob);
      showPanel("detailPanel");
    } catch (err) {
      const cached =
        readCachedJobs().find((j) => String(j.id) === String(jobId)) ||
        (await readCachedJobDetail(jobId));
      if (cached) {
        currentJob = cached;
        await renderJobDetail(currentJob);
        showPanel("detailPanel");
        setStatus($("detailStatus"), "Offline — mentett munka adatok", "err");
        return;
      }
      setStatus($("listStatus"), String(err.message || err), "err");
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("read-failed"));
      reader.readAsDataURL(file);
    });
  }

  let installSignPad = null;
  let cachedOpenJobs = [];
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth(); // 0-11
  let calSelectedDate = "";

  function formatHuDate(iso) {
    const s = String(iso || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s || "—";
    return Number(m[1]) + ". " + Number(m[2]) + ". " + Number(m[3]) + ".";
  }

  function eventsOnDate(isoDate) {
    const key = String(isoDate || "").trim();
    const out = [];
    (cachedOpenJobs || []).forEach((j) => {
      if (String(j.felmeresScheduledDate || "").trim() === key && !j.felmeresDone) {
        out.push({ job: j, kind: "felmeres", label: "Felmérés" });
      }
      if (String(j.installationScheduledDate || "").trim() === key && !j.installationClosed) {
        out.push({ job: j, kind: "install", label: "Szerelés" });
      }
    });
    return out;
  }

  function jobsOnDate(isoDate) {
    const seen = new Set();
    return eventsOnDate(isoDate)
      .map((e) => e.job)
      .filter((j) => {
        const id = String(j.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  function renderCalendar() {
    const grid = $("calendarGrid");
    const label = $("calMonthLabel");
    if (!grid) return;
    const monthNames = [
      "január",
      "február",
      "március",
      "április",
      "május",
      "június",
      "július",
      "augusztus",
      "szeptember",
      "október",
      "november",
      "december"
    ];
    if (label) label.textContent = calYear + ". " + monthNames[calMonth];

    const first = new Date(calYear, calMonth, 1);
    const startPad = (first.getDay() + 6) % 7; // hétfő=0
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = new Date();
    const todayKey =
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");

    const dows = ["H", "K", "Sz", "Cs", "P", "Szo", "V"];
    let html = dows.map((d) => '<div class="cal-dow">' + d + "</div>").join("");
    for (let i = 0; i < startPad; i++) html += '<div class="cal-day is-muted"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const key =
        calYear +
        "-" +
        String(calMonth + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");
      const count = eventsOnDate(key).length;
      const cls = [
        "cal-day",
        key === todayKey ? "is-today" : "",
        count ? "has-jobs" : "",
        key === calSelectedDate ? "is-selected" : ""
      ]
        .filter(Boolean)
        .join(" ");
      html +=
        '<button type="button" class="' +
        cls +
        '" data-date="' +
        key +
        '"><span>' +
        day +
        "</span>" +
        (count ? '<span class="cal-dot" title="' + count + ' esemény"></span>' : "") +
        "</button>";
    }
    grid.innerHTML = html;

    const list = $("calendarDayList");
    if (!list) return;
    if (!calSelectedDate) {
      list.innerHTML = '<p class="media-hint" style="margin:0">Koppints egy napra a részletekhez.</p>';
      return;
    }
    const rows = eventsOnDate(calSelectedDate);
    if (!rows.length) {
      list.innerHTML =
        "<p class=\"media-hint\" style=\"margin:0\">" +
        formatHuDate(calSelectedDate) +
        " — nincs ütemezett felmérés / szerelés.</p>";
      return;
    }
    list.innerHTML =
      '<p class="media-hint" style="margin:0 0 0.35rem">' +
      formatHuDate(calSelectedDate) +
      " · " +
      rows.length +
      " esemény</p>" +
      rows
        .map(
          (e) =>
            '<button type="button" data-open-job="' +
            escapeHtml(e.job.id) +
            '"><strong>' +
            escapeHtml(e.label) +
            " · " +
            escapeHtml(e.job.customerName || "Vevő") +
            "</strong><br/><span style=\"opacity:.75\">" +
            escapeHtml(e.job.quoteNumber || "") +
            " · " +
            escapeHtml(e.job.customerAddress || "") +
            "</span></button>"
        )
        .join("");
  }

  function todayIsoDate() {
    const today = new Date();
    return (
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0")
    );
  }

  function syncScheduleUi(job) {
    const input = $("installScheduleDate");
    const hint = $("scheduleSavedHint");
    if (input) {
      input.value = String(job?.installationScheduledDate || "").trim();
      input.min = todayIsoDate();
    }
    if (hint) {
      if (job?.installationScheduledDate) {
        hint.textContent =
          "Szerelés napja: " +
          formatHuDate(job.installationScheduledDate) +
          (job.installationScheduledBy ? " · " + job.installationScheduledBy : "");
      } else {
        hint.textContent = "Még nincs dátum — válaszd ki, mikor tudod elvállalni.";
      }
    }
  }

  function syncFelmeresScheduleUi(job) {
    const input = $("felmeresScheduleDate");
    const hint = $("felmeresScheduleSavedHint");
    if (input) {
      input.value = String(job?.felmeresScheduledDate || "").trim();
      input.min = todayIsoDate();
    }
    if (hint) {
      if (job?.felmeresScheduledDate) {
        hint.textContent =
          "Felmérés napja: " +
          formatHuDate(job.felmeresScheduledDate) +
          (job.felmeresScheduledBy ? " · " + job.felmeresScheduledBy : "");
      } else {
        hint.textContent = "Még nincs felmérés dátum — írd be, mikor lesz.";
      }
    }
  }

  async function saveInstallSchedule() {
    if (!currentJob || uploading) return;
    const date = String($("installScheduleDate")?.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setStatus($("detailStatus"), "Válassz dátumot a naptárból.", "err");
      return;
    }
    if (!isOnline() || !apiBase()) {
      setStatus($("detailStatus"), "Ütemezéshez internet kell.", "err");
      return;
    }
    uploading = true;
    setStatus($("detailStatus"), "Szerelés nap mentése…", "");
    try {
      const json = await apiJson("/api/szereles-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentJob.id,
          pin: pin(),
          carpenterName: carpenterName(),
          installationScheduledDate: date
        })
      });
      currentJob = json.entry || currentJob;
      cachedOpenJobs = (cachedOpenJobs || []).map((j) =>
        String(j.id) === String(currentJob.id) ? Object.assign({}, j, currentJob) : j
      );
      syncScheduleUi(currentJob);
      renderCalendar();
      setStatus($("detailStatus"), "Szerelés napja: " + formatHuDate(date) + " ✓", "ok");
    } catch (err) {
      setStatus($("detailStatus"), String(err?.message || err), "err");
    } finally {
      uploading = false;
    }
  }

  async function saveFelmeresSchedule() {
    if (!currentJob || uploading) return;
    const date = String($("felmeresScheduleDate")?.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setStatus($("detailStatus"), "Válassz dátumot a felméréshez.", "err");
      return;
    }
    if (!isOnline() || !apiBase()) {
      setStatus($("detailStatus"), "Ütemezéshez internet kell.", "err");
      return;
    }
    uploading = true;
    setStatus($("detailStatus"), "Felmérés nap mentése…", "");
    try {
      let entry = null;
      // 1) dedikált schedule API (ha már ismeri a felmérés mezőt)
      try {
        const json = await apiJson("/api/szereles-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentJob.id,
            pin: pin(),
            carpenterName: carpenterName(),
            felmeresScheduledDate: date,
            kind: "felmeres"
          })
        });
        entry = json.entry || null;
        if (entry && !entry.felmeresScheduledDate) entry = null;
      } catch (_e) {
        entry = null;
      }
      // 2) várólista PATCH — ugyanaz a mező mentés, mint a kiosztásnál
      if (!entry) {
        const json = await apiJson("/api/felmeres-queue", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentJob.id,
            pin: pin(),
            patch: {
              felmeresScheduledDate: date,
              felmeresScheduledBy: carpenterName() || null,
              felmeresScheduledAt: new Date().toISOString()
            }
          })
        });
        entry = json.entry || null;
        if (entry && String(entry.felmeresScheduledDate || "").trim() !== date) {
          entry = null;
        }
      }
      if (!entry || String(entry.felmeresScheduledDate || "").trim() !== date) {
        throw new Error(
          "A szerver nem mentette a felmérés dátumát. Az iroda a munkaszervezésből (admin PIN) be tudja írni."
        );
      }
      currentJob = entry;
      cachedOpenJobs = (cachedOpenJobs || []).map((j) =>
        String(j.id) === String(currentJob.id) ? Object.assign({}, j, currentJob) : j
      );
      syncFelmeresScheduleUi(currentJob);
      renderCalendar();
      setStatus($("detailStatus"), "Felmérés napja: " + formatHuDate(date) + " ✓", "ok");
    } catch (err) {
      setStatus($("detailStatus"), String(err?.message || err), "err");
    } finally {
      uploading = false;
    }
  }

  function docApi() {
    return window.DivianBeszerelesDokumentum || null;
  }

  function setSignPanelOpen(open) {
    const panel = $("signPanel");
    if (!panel) return;
    panel.classList.toggle("hidden", !open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) {
      installSignPad = null;
      return;
    }
    const api = docApi();
    const job = currentJob || {};
    const f = api && api.jobFields ? api.jobFields(Object.assign({}, job, { carpenterName: carpenterName() })) : {};
    if ($("signJobMeta")) {
      $("signJobMeta").textContent =
        (f.quoteNumber || "—") + " · " + (f.customerName || "—") + " · " + (f.customerAddress || "");
    }
    const designer = "a Divian konyhatervező / tervező";
    const company = "Divian";
    const points =
      api && api.liabilityPoints
        ? api.liabilityPoints(designer, company)
        : [];
    if ($("signLiability")) {
      $("signLiability").innerHTML =
        "<p><strong>Átvétel + tervezői felelősségkorlátozás</strong></p><ol>" +
        points
          .map(function (p) {
            return "<li>" + escapeHtml(p) + "</li>";
          })
          .join("") +
        "</ol>";
    }
    const labels = (api && api.CHECK_LABELS) || [];
    if ($("signChecks")) {
      $("signChecks").innerHTML = labels
        .map(function (label, i) {
          return (
            '<label><input type="checkbox" id="signCheck' +
            i +
            '" /> <span>' +
            escapeHtml(label) +
            "</span></label>"
          );
        })
        .join("");
    }
    if ($("signNotes")) $("signNotes").value = "nincs";
    setStatus($("signStatus"), "", "");
    window.requestAnimationFrame(function () {
      const canvas = $("installSignCanvas");
      if (!canvas || !api || typeof api.createSignaturePad !== "function") return;
      installSignPad = api.createSignaturePad(canvas, { strokeStyle: "#111111", lineWidth: 2.5 });
    });
  }

  function openBeszerelesDokumentum() {
    if (!currentJob) return;
    if (!docApi()) {
      setStatus($("detailStatus"), "Hiányzik a beszerelési dokumentum modul.", "err");
      return;
    }
    setSignPanelOpen(true);
  }

  function printBeszerelesDokumentum() {
    if (!currentJob) return;
    const api = docApi();
    if (!api || typeof api.openPrintWindow !== "function") {
      setStatus($("detailStatus"), "Hiányzik a beszerelési dokumentum modul.", "err");
      return;
    }
    const result = api.openPrintWindow(
      Object.assign({}, currentJob, { carpenterName: carpenterName() }),
      { companyName: "Divian", designerName: "a Divian konyhatervező / tervező" }
    );
    if (!result.ok) {
      setStatus($("detailStatus"), result.message || "Nem sikerült megnyitni.", "err");
      return;
    }
    setStatus($("detailStatus"), "Nyomtatási nézet megnyitva.", "ok");
  }

  async function saveDigitalInstallSignature() {
    if (!currentJob || uploading) return;
    const api = docApi();
    if (!api || !installSignPad) {
      setStatus($("signStatus"), "Aláírómező nem kész — zárd be és nyisd újra.", "err");
      return;
    }
    if (installSignPad.isEmpty()) {
      setStatus($("signStatus"), "Kérjük az ügyfél aláírását!", "err");
      return;
    }
    const checks = ((api.CHECK_LABELS || []).map(function (_l, i) {
      return !!$("signCheck" + i)?.checked;
    }));
    if (checks.some(function (c) {
      return !c;
    })) {
      setStatus($("signStatus"), "Minden pipát be kell jelölni az átvételhez.", "err");
      return;
    }
    const notes = String($("signNotes")?.value || "").trim() || "nincs";
    if (!isOnline() || !apiBase()) {
      setStatus($("signStatus"), "Digitális aláíráshoz internet kell.", "err");
      return;
    }

    uploading = true;
    setStatus($("signStatus"), "Aláírt nyilatkozat mentése…", "");
    try {
      const signaturePng = installSignPad.toDataURL();
      const imageBase64 = await api.renderSignedPng(
        Object.assign({}, currentJob, { carpenterName: carpenterName() }),
        {
          companyName: "Divian",
          designerName: "a Divian konyhatervező / tervező",
          signaturePng,
          notes,
          checks
        }
      );
      const json = await apiJson("/api/szereles-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentJob.id,
          pin: pin(),
          carpenterName: carpenterName(),
          imageBase64,
          photoKind: PHOTO_KIND.signedDocument,
          note: "digitális aláírás · " + notes
        })
      });
      currentJob = json.entry || currentJob;
      try {
        localStorage.setItem(
          "divian_beszereles_sign_" + currentJob.id,
          JSON.stringify({
            jobId: currentJob.id,
            quoteNumber: currentJob.quoteNumber,
            customerName: currentJob.customerName,
            carpenterName: carpenterName(),
            completedAt: new Date().toISOString(),
            notes,
            checks,
            signaturePng
          })
        );
      } catch (_e) {}
      setSignPanelOpen(false);
      setStatus($("detailStatus"), "Digitális átvétel mentve ✓", "ok");
      await renderJobDetail(currentJob);
    } catch (err) {
      setStatus($("signStatus"), String(err?.message || err), "err");
    } finally {
      uploading = false;
    }
  }

  async function uploadDrawing(file, drawingKind) {
    if (!currentJob || uploading) return;
    if (!isOnline() || !apiBase()) {
      setStatus($("detailStatus"), "Dokumentum feltöltéshez internet kell.", "err");
      return;
    }
    const kind = String(drawingKind || "felmeres-adatlap");
    const labels = {
      "felmeres-adatlap": "Felmérés adatlap",
      "other-document": "Dokumentum",
      "kitchen-plan": "Konyha terv",
      "installation-drawing": "Szerelési rajz"
    };
    uploading = true;
    setStatus($("detailStatus"), (labels[kind] || "Dokumentum") + " feltöltése…", "");
    try {
      const fileBase64 = await readFileAsDataUrl(file);
      await apiJson("/api/szereles-drawing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentJob.id,
          fileBase64,
          fileName: file.name,
          mimeType: file.type,
          uploadedBy: carpenterName() || "asztalos",
          kind,
          label: labels[kind] || "Dokumentum"
        })
      });
      setStatus($("detailStatus"), (labels[kind] || "Dokumentum") + " feltöltve ✓", "ok");
      await openJob(currentJob.id);
    } catch (err) {
      setStatus($("detailStatus"), String(err?.message || err), "err");
    } finally {
      uploading = false;
      if ($("surveyFormInput")) $("surveyFormInput").value = "";
      if ($("surveyFormCameraInput")) $("surveyFormCameraInput").value = "";
    }
  }

  async function uploadPhoto(file, photoKind) {
    if (!currentJob || uploading) return;
    const kind = String(photoKind || PHOTO_KIND.installation);
    uploading = true;
    const labels = {
      [PHOTO_KIND.installation]: "Szerelés fénykép",
      [PHOTO_KIND.signedDocument]: "Aláírt dokumentum",
      [PHOTO_KIND.survey]: "Felmérés fénykép"
    };
    setStatus($("detailStatus"), (labels[kind] || "Fénykép") + " mentése…", "");
    try {
      const imageBase64 = await readFileAsDataUrl(file);
      if (isOnline() && apiBase()) {
        const json = await apiJson("/api/szereles-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentJob.id,
            pin: pin(),
            carpenterName: carpenterName(),
            imageBase64,
            photoKind: kind
          })
        });
        currentJob = json.entry || currentJob;
        setStatus($("detailStatus"), (labels[kind] || "Fénykép") + " feltöltve ✓", "ok");
      } else {
        await idbPut(STORE_PHOTOS, {
          localId: "lp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          jobId: currentJob.id,
          imageBase64,
          photoKind: kind,
          carpenterName: carpenterName(),
          takenAt: new Date().toISOString()
        });
        setStatus($("detailStatus"), (labels[kind] || "Fénykép") + " elmentve offline ✓", "ok");
      }
      await renderJobDetail(currentJob);
      await updateNetworkBanner();
      if (isOnline() && apiBase()) runSyncCycle({ silent: true });
    } catch (err) {
      setStatus($("detailStatus"), String(err.message || err), "err");
    } finally {
      uploading = false;
      if (kind === PHOTO_KIND.survey && $("surveyCameraInput")) $("surveyCameraInput").value = "";
      if (kind === PHOTO_KIND.signedDocument && $("signedDocInput")) $("signedDocInput").value = "";
      if (kind === PHOTO_KIND.installation && $("cameraInput")) $("cameraInput").value = "";
    }
  }

  async function closeSurveyJob() {
    if (!currentJob) return;
    if (!confirm("Biztosan lezárod a felmérést? Kell legalább 1 fénykép és 1 felmérés adatlap.")) return;
    setStatus($("detailStatus"), "Felmérés lezárása…", "");
    try {
      if (isOnline() && apiBase()) {
        await syncOfflineQueue();
        const json = await apiJson("/api/felmeres-close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentJob.id,
            pin: pin(),
            carpenterName: carpenterName()
          })
        });
        currentJob = json.entry || currentJob;
        setStatus($("detailStatus"), "Felmérés lezárva ✓", "ok");
      } else {
        const surveyCount =
          serverPhotosByKind(currentJob, PHOTO_KIND.survey).length +
          (await countLocalPhotos(currentJob.id, PHOTO_KIND.survey));
        if (surveyCount < 1) throw new Error("Legalább egy felmérés fénykép kötelező.");
        const formCount = (Array.isArray(currentJob.drawings) ? currentJob.drawings : []).filter(
          (d) => String(d.kind || "") === "felmeres-adatlap"
        ).length;
        if (formCount < 1) throw new Error("Legalább egy felmérés adatlap kötelező (fotózd le).");
        await idbPut(STORE_CLOSES, {
          localId: "lc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          jobId: currentJob.id,
          closeKind: "survey",
          carpenterName: carpenterName(),
          createdAt: new Date().toISOString()
        });
        setStatus($("detailStatus"), "Felmérés lezárás elmentve offline ✓", "ok");
      }
      await renderJobDetail(currentJob);
      if (!currentJob.installationClosed) {
        setTimeout(() => loadJobs({ silent: true }), 600);
      } else {
        setTimeout(() => {
          currentJob = null;
          showPanel("listPanel");
          loadJobs();
        }, 900);
      }
    } catch (err) {
      setStatus($("detailStatus"), String(err.message || err), "err");
    }
  }

  async function closeJob() {
    if (!currentJob) return;
    if (
      !confirm(
        "Biztosan lezárod a szerelést? Kell legalább 1 szerelés fénykép és 1 aláírt beszerelési nyilatkozat."
      )
    )
      return;
    setStatus($("detailStatus"), "Szerelés lezárása…", "");
    try {
      if (isOnline() && apiBase()) {
        const sync = await syncOfflineQueue();
        if (sync.errors && sync.errors.length) {
          setStatus(
            $("detailStatus"),
            "Szinkron figyelmeztetés: " + sync.errors[0] + " — próbálom a lezárást…",
            "err"
          );
        }
        const json = await apiJson("/api/szereles-close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentJob.id,
            pin: pin(),
            carpenterName: carpenterName()
          })
        });
        currentJob = json.entry || currentJob;
        setStatus(
          $("detailStatus"),
          json.alreadyClosed ? "Szerelés már korábban lezárva ✓" : "Szerelés lezárva ✓",
          "ok"
        );
      } else {
        const installCount =
          serverPhotosByKind(currentJob, PHOTO_KIND.installation).length +
          (await countLocalPhotos(currentJob.id, PHOTO_KIND.installation));
        const signedCount =
          serverPhotosByKind(currentJob, PHOTO_KIND.signedDocument).length +
          (await countLocalPhotos(currentJob.id, PHOTO_KIND.signedDocument));
        if (installCount < 1 || signedCount < 1) {
          throw new Error("Kell szerelés fénykép és aláírt dokumentum is.");
        }
        await idbPut(STORE_CLOSES, {
          localId: "lc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          jobId: currentJob.id,
          closeKind: "installation",
          carpenterName: carpenterName(),
          createdAt: new Date().toISOString()
        });
        setStatus($("detailStatus"), "Szerelés lezárás elmentve offline ✓", "ok");
      }
      if (currentJob.felmeresRequested && !currentJob.felmeresDone) {
        await renderJobDetail(currentJob);
        setTimeout(() => loadJobs({ silent: true }), 600);
      } else {
        setTimeout(() => {
          currentJob = null;
          showPanel("listPanel");
          loadJobs();
        }, 900);
      }
    } catch (err) {
      setStatus($("detailStatus"), String(err.message || err), "err");
    }
  }

  async function deleteJobAsAdmin() {
    if (!currentJob || !isAdminSession()) return;
    const label =
      String(currentJob.customerName || "").trim() ||
      String(currentJob.quoteNumber || "").trim() ||
      currentJob.id;
    if (
      !confirm(
        "Biztosan TÖRLÖD ezt a munkát a listából?\n\n" +
          label +
          "\n\nEz nem visszavonható. Az asztalosoknál is eltűnik."
      )
    ) {
      return;
    }
    setStatus($("detailStatus"), "Törlés…", "");
    try {
      if (!isOnline() || !apiBase()) {
        throw new Error("Törléshez online kapcsolat kell.");
      }
      await apiJson(
        "/api/felmeres-queue?id=" +
          encodeURIComponent(currentJob.id) +
          "&pin=" +
          encodeURIComponent(pin()),
        { method: "DELETE" }
      );
      setStatus($("detailStatus"), "Munka törölve ✓", "ok");
      currentJob = null;
      setTimeout(() => {
        showPanel("listPanel");
        loadJobs();
      }, 500);
    } catch (err) {
      setStatus($("detailStatus"), String(err.message || err), "err");
    }
  }

  async function login() {
    if (!isValidPin(pin())) {
      setStatus($("loginStatus"), "Add meg a 4 jegyű asztalos PIN-t (vagy 6 jegyű admin kódot).", "err");
      return;
    }
    persistSession();
    setStatus($("loginStatus"), "Belépés…", "");
    try {
      if (isOnline() && apiBase()) {
        const json = await apiJson("/api/szereles-jobs?scope=open&pin=" + encodeURIComponent(pin()));
        applyAuthSession(json);
        await rememberAdminCenterUrls();
      } else if (!readCachedJobs().length) {
        if (!apiBase()) {
          setStatus($("loginStatus"), "Nincs szerver cím — kérj nyilvános linket az irodától, vagy használd a korábban mentett munkát.", "err");
          return;
        }
        throw new Error("offline-no-cache");
      }
      setStatus($("loginStatus"), "", "");
      try {
        localStorage.setItem(LS_NOTIFY_WATERMARK, new Date().toISOString());
      } catch (_e) {}
      showPanel("listPanel");
      await requestNotifyPermission();
      updateNotifyPermissionUi();
      await loadJobs();
      await pollCrewNotifications({ silent: false });
      startRealtimeDeliveryNotify();
    } catch (err) {
      if (readCachedJobs().length) {
        showPanel("listPanel");
        await loadJobs();
        startRealtimeDeliveryNotify();
        return;
      }
      if (isFetchError(err)) {
        showLinkEditor();
        $("loginPanel")?.classList.add("hidden");
        setStatus(
          $("linkStatus"),
          "A szerver nem elérhető — illeszd be az új linket az irodától, vagy lépj be offline a mentett munkákkal.",
          "err"
        );
      }
      if (err.code === "invalid-pin") {
        setStatus(
          $("loginStatus"),
          "Hibás PIN — asztalos: 4 számjegy (pl. Misi: 6236). Admin: 6 számjegy (Beállítások).",
          "err"
        );
      } else if (err.message !== "offline-no-cache") {
        setStatus($("loginStatus"), String(err.message || err), "err");
      }
    }
  }

  async function wire() {
    try {
      await upgradeAppShell();
      ensureLinkUploadUi();
      restoreSession();
      loadCachedCrewOptions();
      const serverOk = await initApiBase();
      updateNetworkBanner();
      if (localStorage.getItem(LS_IS_ADMIN) === "1") updateAdminBar(true);
    window.addEventListener("online", () => {
      updateNetworkBanner();
      if (pin()) {
        runSyncCycle({ silent: false }).then(() => loadJobs());
        pollCrewNotifications({ silent: false });
      }
    });
    window.addEventListener("offline", updateNetworkBanner);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && pin()) {
        pollCrewNotifications({ silent: true });
        if (isListPanelVisible()) loadJobs({ silent: true });
      }
    });

    await registerServiceWorker();

    $("loginBtn")?.addEventListener("click", login);
    $("saveLinkBtn")?.addEventListener("click", saveServerLink);
    $("pasteLinkBtn")?.addEventListener("click", pasteServerLink);
    $("editLinkBtn")?.addEventListener("click", showLinkEditor);
    $("apiBase")?.addEventListener("blur", () => {
      const n = normalizeServerLink($("apiBase")?.value);
      if (n) $("apiBase").value = n;
    });
    $("refreshBtn")?.addEventListener("click", () => runSyncCycle({ silent: false }).then(() => loadJobs()));
    $("logoutBtn")?.addEventListener("click", () => {
      localStorage.removeItem(LS_IS_ADMIN);
      localStorage.removeItem(LS_ADMIN_CENTER_URL);
      showPanel("loginPanel");
      updateLinkDisplay();
      updateAdminBar(false);
      setStatus($("loginStatus"), "", "");
    });
    $("backBtn")?.addEventListener("click", () => {
      currentJob = null;
      showPanel("listPanel");
      loadJobs();
    });
    $("jobList")?.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-stop], select, button, a")) return;
      const card = ev.target.closest(".job-card");
      if (!card) return;
      openJob(card.getAttribute("data-id"));
    });
    $("jobList")?.addEventListener("change", async (ev) => {
      const sel = ev.target.closest("select.list-crew-select");
      if (!sel) return;
      ev.stopPropagation();
      const id = sel.getAttribute("data-id");
      const crew = String(sel.value || "").trim();
      sel.disabled = true;
      try {
        await assignCrewAsAdmin(id, crew, $("listStatus"));
      } catch (err) {
        setStatus($("listStatus"), String(err.message || err), "err");
        await loadJobs({ silent: true });
      } finally {
        sel.disabled = false;
      }
    });
    $("adminAssignBtn")?.addEventListener("click", async () => {
      if (!currentJob) return;
      const crew = String($("adminCrewSelect")?.value || "").trim();
      const btn = $("adminAssignBtn");
      if (btn) btn.disabled = true;
      try {
        await assignCrewAsAdmin(currentJob.id, crew, $("detailStatus"));
      } catch (err) {
        setStatus($("detailStatus"), String(err.message || err), "err");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    $("adminCrewSelect")?.addEventListener("change", async () => {
      if (!currentJob || !isAdminSession()) return;
      const crew = String($("adminCrewSelect")?.value || "").trim();
      try {
        await assignCrewAsAdmin(currentJob.id, crew, $("detailStatus"));
      } catch (err) {
        setStatus($("detailStatus"), String(err.message || err), "err");
      }
    });
    $("cameraInput")?.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) uploadPhoto(file, PHOTO_KIND.installation);
    });
    $("signedDocInput")?.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) uploadPhoto(file, PHOTO_KIND.signedDocument);
    });
    $("saveScheduleBtn")?.addEventListener("click", () => {
      void saveInstallSchedule();
    });
    $("saveFelmeresScheduleBtn")?.addEventListener("click", () => {
      void saveFelmeresSchedule();
    });
    $("calPrevBtn")?.addEventListener("click", () => {
      calMonth -= 1;
      if (calMonth < 0) {
        calMonth = 11;
        calYear -= 1;
      }
      renderCalendar();
    });
    $("calNextBtn")?.addEventListener("click", () => {
      calMonth += 1;
      if (calMonth > 11) {
        calMonth = 0;
        calYear += 1;
      }
      renderCalendar();
    });
    $("calendarGrid")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-date]");
      if (!btn) return;
      calSelectedDate = btn.getAttribute("data-date") || "";
      renderCalendar();
    });
    $("calendarDayList")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-open-job]");
      if (!btn) return;
      openJob(btn.getAttribute("data-open-job"));
    });
    $("openInstallDocBtn")?.addEventListener("click", openBeszerelesDokumentum);
    $("printInstallDocBtn")?.addEventListener("click", printBeszerelesDokumentum);
    $("signCloseBtn")?.addEventListener("click", () => setSignPanelOpen(false));
    $("signClearBtn")?.addEventListener("click", () => {
      if (installSignPad) installSignPad.clear();
      setStatus($("signStatus"), "", "");
    });
    $("signSaveBtn")?.addEventListener("click", () => {
      void saveDigitalInstallSignature();
    });
    $("surveyCameraInput")?.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) uploadPhoto(file, PHOTO_KIND.survey);
    });
    $("surveyFormCameraInput")?.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) uploadDrawing(file, "felmeres-adatlap");
    });
    $("surveyFormInput")?.addEventListener("change", async (ev) => {
      const files = Array.from(ev.target.files || []);
      for (const file of files) {
        await uploadDrawing(file, "felmeres-adatlap");
      }
    });
    $("closeJobBtn")?.addEventListener("click", closeJob);
    $("deleteJobBtn")?.addEventListener("click", () => void deleteJobAsAdmin());
    $("closeSurveyBtn")?.addEventListener("click", closeSurveyJob);
    $("enableNotifyBtn")?.addEventListener("click", async () => {
      const perm = await requestNotifyPermission();
      updateNotifyPermissionUi();
      if (perm === "granted") setStatus($("listStatus"), "Értesítések bekapcsolva ✓", "ok");
      else if (perm === "denied") {
        setStatus($("listStatus"), "Az értesítés le van tiltva a telefon beállításaiban.", "err");
      }
    });

    if (window.location.protocol === "file:") {
      showLinkEditor();
      setStatus(
        $("linkStatus"),
        "Először illeszd be az iroda által küldött HTTPS linket, majd mentsd.",
        "err"
      );
    } else if (isValidPin(pin()) && (apiBase() || readCachedJobs().length)) {
      updateCrewHeader(localStorage.getItem(LS_CREW_NAME));
      showPanel("listPanel");
      updateNotifyPermissionUi();
      loadJobs();
      startSyncPolling();
      startRealtimeDeliveryNotify();
    }
    } catch (err) {
      showBootError("Az app nem tudott elindulni: " + String(err?.message || err));
    }
  }

  function realtimeNotifyServerUrl() {
    try {
      const base = apiBase() || window.location.origin;
      const u = new URL(base, window.location.href);
      if (u.port === "17322") u.port = "17321";
      return u.origin;
    } catch (_e) {
      return String(window.location.origin || "").replace(/:17322$/, ":17321");
    }
  }

  function startRealtimeDeliveryNotify() {
    if (typeof DivianRealtimeNotify === "undefined") return;
    DivianRealtimeNotify.start({
      role: "szereles",
      url: realtimeNotifyServerUrl(),
      autoAskPermission: true,
      onChange: (envelope) => {
        const event = String(envelope?.event || "").toLowerCase();
        if (
          event.indexOf("szereles") >= 0 ||
          event.indexOf("order") >= 0 ||
          event.indexOf("megrendelo") >= 0 ||
          event.indexOf("felmeres") >= 0
        ) {
          if (currentJob?.id) {
            openJob(currentJob.id).catch(() => {});
          } else if (isListPanelVisible()) {
            loadJobs({ silent: true }).catch(() => {});
          }
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
