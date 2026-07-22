"use strict";

const {
  openDb,
  ensureSchema,
  upsertOrderFromPayload,
  setItemStatus,
  listDeliveryItems,
  getOrderItemById,
  listStatusLookups,
  listActiveDeliveries,
  searchOrdersByQuery,
  normalizeDeliveryId
} = require("./db-api");

const STATUS_ALIASES = {
  felrakva: { scope: "muhely", code: "felrakva_kocsira" },
  "felrakva kocsira": { scope: "muhely", code: "felrakva_kocsira" },
  felrakva_kocsira: { scope: "muhely", code: "felrakva_kocsira" },
  kesz: { scope: "muhely", code: "kesz" },
  hianyzik: { scope: "helyszin", code: "hianyzik" },
  "hiányzik": { scope: "helyszin", code: "hianyzik" },
  hiányzik: { scope: "helyszin", code: "hianyzik" },
  kiszallitva: { scope: "helyszin", code: "kiszallitva" },
  kiszállítva: { scope: "helyszin", code: "kiszallitva" },
  utvon: { scope: "helyszin", code: "utvon" },
  "úton": { scope: "helyszin", code: "utvon" },
  atadva: { scope: "helyszin", code: "atadva" },
  "átadva": { scope: "helyszin", code: "atadva" },
  serult: { scope: "helyszin", code: "serult" },
  "sérült": { scope: "helyszin", code: "serult" }
};

let sharedDb = null;

function getDb() {
  if (!sharedDb) {
    sharedDb = openDb();
    ensureSchema(sharedDb);
  }
  return sharedDb;
}

function normalizeStatusInput(body) {
  const scopeRaw = String(body?.scope || body?.statusScope || "").trim().toLowerCase();
  const codeRaw = String(body?.statusCode || body?.status || body?.statusLabel || "")
    .trim()
    .toLowerCase();

  if (!codeRaw) {
    throw new Error("Hiányzó státusz (statusCode / status)");
  }

  const alias = STATUS_ALIASES[codeRaw];
  if (alias) {
    return {
      scope: scopeRaw && ["muhely", "helyszin"].includes(scopeRaw) ? scopeRaw : alias.scope,
      statusCode: alias.code
    };
  }

  const scope = scopeRaw === "muhely" || scopeRaw === "helyszin" ? scopeRaw : "helyszin";
  return { scope, statusCode: codeRaw.replace(/\s+/g, "_") };
}

function saveOrderFromPayload(payload, meta) {
  const db = getDb();
  const result = upsertOrderFromPayload(db, payload, meta);
  const delivery = listDeliveryItems(db, result.quoteNumber);
  return { ...result, delivery };
}

function hashPayloadText(text) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function currentOrderHash(db, quoteNumber) {
  try {
    const row = db
      .prepare("SELECT source_payload_hash FROM orders WHERE quote_number = ?")
      .get(String(quoteNumber || "").trim().toUpperCase());
    return row?.source_payload_hash || "";
  } catch (_e) {
    return "";
  }
}

async function tryImportFromSavedOrders(deliveryId, opts) {
  const force = !!(opts && opts.force);
  const id = normalizeDeliveryId(deliveryId);
  if (!id) return null;
  let resolveQuoteJsonFromDisk;
  try {
    ({ resolveQuoteJsonFromDisk } = require("../divian-saved-orders"));
  } catch (_e) {
    return null;
  }
  const hit = await resolveQuoteJsonFromDisk(id);
  if (!hit || !hit.jsonText) return null;
  let payload;
  try {
    payload = JSON.parse(hit.jsonText);
  } catch (_e) {
    return null;
  }
  if (!payload.quoteNumber) payload.quoteNumber = id;
  const db = getDb();
  const nextHash = hashPayloadText(hit.jsonText);
  const prevHash = currentOrderHash(db, id);
  const existed = !!listDeliveryItems(db, id);
  if (existed && !force && prevHash && prevHash === nextHash) {
    return { skipped: true, quoteNumber: id, unchanged: true };
  }
  const result = saveOrderFromPayload(payload, {
    sourceKind: "megrendelo_json",
    sourcePayloadPath: hit.fileName || null,
    sourcePayloadHash: nextHash
  });
  return Object.assign({}, result, {
    refreshed: true,
    changed: !existed || prevHash !== nextHash
  });
}

async function fetchDeliveryItems(deliveryId) {
  const id = normalizeDeliveryId(deliveryId);
  const db = getDb();
  let refreshed = false;
  let changed = false;
  try {
    const importResult = await tryImportFromSavedOrders(id, { force: false });
    if (importResult?.refreshed) {
      refreshed = true;
      changed = !!importResult.changed;
    }
  } catch (importErr) {
    console.warn("[asztalos-delivery] megrendelő frissítés hiba:", importErr?.message || importErr);
  }
  let data = listDeliveryItems(db, id);
  if (!data) {
    const err = new Error(
      "Nincs ilyen szállítási azonosító: " +
        id +
        ". Írd be csak az ajánlatszámot (pl. MRDH-VACI-26-0555), ügyfélnév nélkül."
    );
    err.code = "delivery-not-found";
    throw err;
  }
  return Object.assign({}, data, { refreshed, changed });
}

function updateItemStatus(itemId, body) {
  const db = getDb();
  const parsed = normalizeStatusInput(body || {});
  const result = setItemStatus(db, Number(itemId), parsed.scope, parsed.statusCode, {
    note: body?.note || "",
    changedBy: body?.changedBy || body?.courierName || "mobile"
  });
  const item = getOrderItemById(db, result.itemId);
  const orderRow = db.prepare("SELECT quote_number FROM orders WHERE id = ?").get(item.orderId);
  return {
    itemId: result.itemId,
    scope: result.scope,
    statusCode: result.statusCode,
    deliveryId: orderRow?.quote_number || "",
    item,
    changedBy: body?.changedBy || body?.courierName || "mobile",
    changedAt: new Date().toISOString()
  };
}

function fetchStatusLookups() {
  return listStatusLookups(getDb());
}

function fetchActiveDeliveries() {
  return listActiveDeliveries(getDb());
}

async function searchDeliveries(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const dbHits = searchOrdersByQuery(getDb(), q);
  const seen = new Set(dbHits.map((h) => String(h.deliveryId || "").toUpperCase()));

  // Mentett megrendelők mappa — ha még nincs az SQLite-ban
  try {
    const { scanOrderSaveDirEnriched } = require("../divian-saved-orders");
    const rows = await scanOrderSaveDirEnriched();
    const qLower = q.toLowerCase();
    for (const row of rows || []) {
      const name = String(row.customerName || "").toLowerCase();
      const quote = String(row.quoteNumber || "").toUpperCase();
      if (!quote || seen.has(quote)) continue;
      if (
        name.includes(qLower) ||
        quote.includes(q.toUpperCase()) ||
        String(row.fileName || "").toLowerCase().includes(qLower)
      ) {
        seen.add(quote);
        dbHits.push({
          deliveryId: quote,
          orderId: null,
          customerName: row.customerName || "",
          customerAddress: "",
          orderStatus: "disk",
          source: "disk"
        });
      }
      if (dbHits.length >= 30) break;
    }
  } catch (_e) {}

  return dbHits.slice(0, 30);
}

function buildSocketPayload(updateResult) {
  const item = updateResult.item;
  return {
    itemId: updateResult.itemId,
    orderId: item?.orderId,
    deliveryId: updateResult.deliveryId,
    scope: updateResult.scope,
    statusCode: updateResult.statusCode,
    statusLabel:
      updateResult.scope === "muhely"
        ? item?.statusMuhely?.label
        : item?.statusHelyszin?.label,
    uiClass: item?.uiClass || "pending",
    item,
    changedBy: updateResult.changedBy,
    changedAt: updateResult.changedAt
  };
}

module.exports = {
  getDb,
  saveOrderFromPayload,
  tryImportFromSavedOrders,
  fetchDeliveryItems,
  updateItemStatus,
  fetchStatusLookups,
  fetchActiveDeliveries,
  searchDeliveries,
  buildSocketPayload,
  normalizeStatusInput
};
