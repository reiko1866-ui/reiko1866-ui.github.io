/**
 * DivianRealtimeNotify — böngésző + in-app értesítés Socket.io változásokra.
 * Használat: DivianRealtimeNotify.start({ role: "office" })
 */
(function (global) {
  "use strict";

  const LS_PERM_ASKED = "divian_realtime_notify_asked_v1";
  let socket = null;
  let toastHost = null;
  let opts = {
    role: "office",
    browser: true,
    inApp: true,
    autoAskPermission: true,
    ignoreSelfCourier: false
  };

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureToastHost() {
    if (toastHost) return toastHost;
    toastHost = document.createElement("div");
    toastHost.id = "divianRealtimeToastHost";
    toastHost.setAttribute("aria-live", "polite");
    toastHost.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);top:calc(0.75rem + env(safe-area-inset-top));z-index:99999;display:grid;gap:0.5rem;width:min(26rem,calc(100vw - 1.5rem));pointer-events:none";
    document.body.appendChild(toastHost);
    return toastHost;
  }

  function showInApp(title, body, level) {
    if (!opts.inApp) return;
    const host = ensureToastHost();
    const border =
      level === "error"
        ? "border-color:rgba(239,68,68,0.55);background:#450a0a;color:#fecaca"
        : level === "ok"
          ? "border-color:rgba(34,197,94,0.45);background:#052e16;color:#bbf7d0"
          : "border-color:rgba(245,158,11,0.45);background:#1c1917;color:#fde68a";
    const el = document.createElement("div");
    el.style.cssText =
      "pointer-events:auto;border:1px solid;border-radius:14px;padding:0.85rem 1rem;box-shadow:0 10px 28px rgba(0,0,0,0.35);font:600 0.9rem/1.4 system-ui,sans-serif;" +
      border;
    el.innerHTML =
      "<div style='font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;margin-bottom:0.25rem'>" +
      escapeHtml(title) +
      "</div><div style='font-weight:500'>" +
      escapeHtml(body) +
      "</div>";
    host.prepend(el);
    window.setTimeout(() => el.remove(), 8000);
  }

  function showBrowser(title, body, tag) {
    if (!opts.browser) return;
    if (!("Notification" in global)) return;
    if (Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, {
        body: body,
        tag: tag || "divian-" + Date.now(),
        renotify: true
      });
      window.setTimeout(() => {
        try {
          n.close();
        } catch (_e) {}
      }, 10000);
    } catch (_e) {}
  }

  function notify(title, body, level, tag) {
    showInApp(title, body, level || "info");
    showBrowser(title, body, tag);
  }

  async function ensurePermission() {
    if (!("Notification" in global)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    if (!opts.autoAskPermission) return "default";
    if (localStorage.getItem(LS_PERM_ASKED) === "1") return Notification.permission;
    localStorage.setItem(LS_PERM_ASKED, "1");
    try {
      return await Notification.requestPermission();
    } catch (_e) {
      return "denied";
    }
  }

  function handleAppChange(envelope) {
    if (!envelope) return;
    // Saját courier státusz: a helyi UI már frissült — toast kihagyása
    if (
      opts.ignoreSelfCourier &&
      opts.role === "courier" &&
      envelope.source === "asztalos-delivery" &&
      envelope.event === "item:statusUpdated" &&
      typeof opts.shouldIgnoreChange === "function" &&
      opts.shouldIgnoreChange(envelope)
    ) {
      if (typeof opts.onChange === "function") opts.onChange(envelope);
      return;
    }
    const title = envelope.title || "Divian frissítés";
    const body = envelope.body || envelope.event || "Változás történt";
    const level = envelope.level || "info";
    const tag = "divian-" + (envelope.event || "change") + "-" + (envelope.at || Date.now());
    notify(title, body, level, tag);
    if (typeof opts.onChange === "function") opts.onChange(envelope);
  }

  function handleItemStatus(payload) {
    if (typeof opts.onItemStatusUpdated === "function") opts.onItemStatusUpdated(payload);
  }

  function handleOrderSaved(payload) {
    if (typeof opts.onOrderSaved === "function") opts.onOrderSaved(payload);
  }

  function start(userOpts) {
    opts = Object.assign({}, opts, userOpts || {});
    if (typeof global.io !== "function") {
      console.warn("[DivianRealtimeNotify] socket.io kliens hiányzik");
      return null;
    }
    ensurePermission();

    if (socket) {
      try {
        socket.disconnect();
      } catch (_e) {}
      socket = null;
    }

    socket = opts.url
      ? global.io(opts.url, {
          path: "/socket.io",
          transports: ["websocket", "polling"],
          query: { role: opts.role || "office" }
        })
      : global.io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
          query: { role: opts.role || "office" }
        });

    socket.on("connect", () => {
      socket.emit("joinAll");
      socket.emit("joinOffice");
      if (opts.deliveryId) socket.emit("joinOrder", { deliveryId: opts.deliveryId });
      if (typeof opts.onConnect === "function") opts.onConnect(socket);
    });

    socket.on("app:change", handleAppChange);
    socket.on("item:statusUpdated", handleItemStatus);
    socket.on("order:saved", handleOrderSaved);

    return socket;
  }

  function joinOrder(deliveryId) {
    if (socket && deliveryId) socket.emit("joinOrder", { deliveryId: deliveryId });
  }

  function stop() {
    if (socket) {
      try {
        socket.disconnect();
      } catch (_e) {}
      socket = null;
    }
  }

  global.DivianRealtimeNotify = {
    start,
    stop,
    joinOrder,
    ensurePermission,
    notify
  };
})(typeof window !== "undefined" ? window : globalThis);
