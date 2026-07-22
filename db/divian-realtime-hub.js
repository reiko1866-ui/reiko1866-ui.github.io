"use strict";

const { broadcastAppChange } = require("./asztalos-delivery-broadcast");

let ioRef = null;

function setRealtimeIo(io) {
  ioRef = io || null;
}

function getRealtimeIo() {
  return ioRef;
}

/**
 * Közös értesítés minden csatlakozott kliensnek (app:change).
 * @param {object} opts
 * @param {string} [opts.event]
 * @param {object} [opts.payload]
 * @param {string} [opts.source]
 * @param {string} [opts.title]
 * @param {string} [opts.body]
 * @param {string} [opts.level]
 */
function emitAppChange(opts) {
  const o = opts || {};
  const eventName = String(o.event || "app:update").trim() || "app:update";
  broadcastAppChange(ioRef, eventName, o.payload || {}, {
    source: o.source || "divian",
    title: o.title || "Divian frissítés",
    body: o.body || "Változás történt",
    level: o.level || "info"
  });
}

function emitAppChangeSafe(opts) {
  try {
    emitAppChange(opts);
  } catch (err) {
    console.warn("[realtime-hub] emit hiba:", err?.message || err);
  }
}

/**
 * Távoli / helyi szerverek (pl. 17322) POST-olhatnak ide.
 * Body: { event, title, body, level, source, payload }
 */
function parseNotifyBody(body) {
  const o = body && typeof body === "object" ? body : {};
  return {
    event: String(o.event || "app:update").trim() || "app:update",
    title: String(o.title || "Divian frissítés").trim(),
    body: String(o.body || o.message || "Változás történt").trim(),
    level: String(o.level || "info").trim() || "info",
    source: String(o.source || "api").trim() || "api",
    payload: o.payload && typeof o.payload === "object" ? o.payload : {}
  };
}

async function postNotifyToMainServer(opts) {
  const port = Number(process.env.DIVIAN_MAIN_PORT || process.env.SCREENSHOT_API_PORT || 17321);
  const host = process.env.DIVIAN_MAIN_HOST || "127.0.0.1";
  const url = "http://" + host + ":" + port + "/api/realtime/notify";
  const payload = parseNotifyBody(opts);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn("[realtime-hub] notify HTTP", res.status, url);
    }
  } catch (err) {
    console.warn("[realtime-hub] notify sikertelen:", err?.message || err);
  }
}

module.exports = {
  setRealtimeIo,
  getRealtimeIo,
  emitAppChange,
  emitAppChangeSafe,
  parseNotifyBody,
  postNotifyToMainServer,
  broadcastAppChange
};
