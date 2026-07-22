/**
 * Irodai webes felület — valós idejű szállítási státusz frissítések (Socket.io).
 * Használat: <script src="/socket.io/socket.io.js"></script>
 *           <script src="asztalos-delivery-office.js"></script>
 */
(function (global) {
  "use strict";

  const UI_CLASS = {
    ok: "delivery-item--ok",
    missing: "delivery-item--missing",
    "in-transit": "delivery-item--transit",
    pending: "delivery-item--pending"
  };

  function applyItemUpdate(root, payload) {
    if (!root || !payload?.itemId) return;
    const el =
      root.querySelector('[data-item-id="' + payload.itemId + '"]') ||
      root.querySelector("#item-" + payload.itemId);
    if (!el) return;

    Object.values(UI_CLASS).forEach((cls) => el.classList.remove(cls));
    const uiClass = payload.uiClass || payload.item?.uiClass || "pending";
    if (UI_CLASS[uiClass]) el.classList.add(UI_CLASS[uiClass]);

    const statusEl = el.querySelector("[data-delivery-status]");
    if (statusEl) {
      statusEl.textContent =
        payload.statusLabel ||
        payload.item?.statusHelyszin?.label ||
        payload.item?.statusMuhely?.label ||
        "";
    }
    el.dataset.deliveryUiClass = uiClass;
  }

  function createOfficeSocket(opts) {
    opts = opts || {};
    if (typeof global.io !== "function") {
      throw new Error("socket.io kliens hiányzik — töltsd be /socket.io/socket.io.js");
    }
    const socket = global.io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      query: { role: opts.role || "office" }
    });

    socket.on("connect", () => {
      socket.emit("joinOffice");
      if (opts.deliveryId) socket.emit("joinOrder", { deliveryId: opts.deliveryId });
      if (typeof opts.onConnect === "function") opts.onConnect(socket);
    });

    socket.on("item:statusUpdated", (payload) => {
      if (typeof opts.onItemStatusUpdated === "function") {
        opts.onItemStatusUpdated(payload);
      }
      if (opts.rootEl) applyItemUpdate(opts.rootEl, payload);
    });

    socket.on("order:saved", (payload) => {
      if (typeof opts.onOrderSaved === "function") opts.onOrderSaved(payload);
    });

    return socket;
  }

  global.DivianDeliveryOffice = {
    UI_CLASS,
    applyItemUpdate,
    createOfficeSocket
  };
})(typeof window !== "undefined" ? window : globalThis);
