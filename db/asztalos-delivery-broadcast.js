"use strict";

/**
 * Közös Socket.io broadcast minden Divian kliensnek.
 */
function broadcastAppChange(io, eventName, payload, meta) {
  if (!io) return;
  const envelope = {
    source: (meta && meta.source) || "asztalos-delivery",
    event: eventName,
    payload: payload || {},
    title: (meta && meta.title) || "",
    body: (meta && meta.body) || "",
    level: (meta && meta.level) || "info",
    at: new Date().toISOString()
  };

  io.emit(eventName, payload);
  io.to("office").emit(eventName, payload);
  io.to("all").emit(eventName, payload);
  io.emit("app:change", envelope);
  io.to("office").emit("app:change", envelope);
  io.to("all").emit("app:change", envelope);
}

function describeItemStatusUpdate(payload) {
  const name = payload?.item?.name || "Tétel";
  const label = payload?.statusLabel || payload?.statusCode || "frissítve";
  const deliveryId = payload?.deliveryId || "";
  const ui = payload?.uiClass || "";
  const level = ui === "missing" ? "error" : ui === "ok" ? "ok" : "info";
  return {
    title: ui === "missing" ? "Szállítás — probléma" : "Szállítás frissült",
    body: name + " → " + label + (deliveryId ? " · " + deliveryId : ""),
    level
  };
}

function describeOrderSaved(payload) {
  return {
    title: "Új / frissített szállítás",
    body:
      (payload?.deliveryId || payload?.quoteNumber || "Megrendelés") +
      (payload?.itemCount != null ? " · " + payload.itemCount + " tétel" : ""),
    level: "info"
  };
}

module.exports = {
  broadcastAppChange,
  describeItemStatusUpdate,
  describeOrderSaved
};
