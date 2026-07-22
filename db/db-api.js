"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DB_PATH = path.join(__dirname, "divian-asztalos.db");

const CATEGORY = {
  BUTORTEST: 1,
  VASALAT: 2,
  GYARI: 3,
  GEP: 4
};

const STATUS_MUHELY_NINCS = 1;
const STATUS_HELYSZIN_NINCS = 1;

function openDb(dbPath) {
  const p = dbPath || process.env.DIVIAN_ASZTALOS_DB || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new DatabaseSync(p);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

function ensureSchema(db) {
  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) throw new Error("Hiányzik db/schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
}

function slugSourceKey(parts) {
  return parts.filter(Boolean).join("|").slice(0, 240);
}

function inferCategoryFromLine(line, sourceType) {
  const kind = String(line?.kind || "").toLowerCase();
  const name = String(line?.name || line?.megnevezes || "").toLowerCase();
  const code = String(line?.code || "").toUpperCase();

  if (sourceType === "hardware") return CATEGORY.VASALAT;
  if (sourceType === "worktop" || sourceType === "wall_panel") return CATEGORY.BUTORTEST;
  if (sourceType === "selected_cabinet") return CATEGORY.BUTORTEST;

  if (kind === "appliance" || kind === "beepitheto_gep") return CATEGORY.GEP;
  if (kind === "bundle" || kind === "gyari_tartozek") return CATEGORY.GYARI;
  if (kind === "tap" || kind === "traydivian" || kind === "trayblanco") return CATEGORY.GYARI;

  if (/^(WHP-|BSH-|EVI-|BOSCH)/.test(code)) return CATEGORY.GEP;
  if (/^(TBL-|BL-|TRAY)/.test(code)) return CATEGORY.GYARI;

  if (/^(whirlpool|bosch|evido|gép|sütő|hűt|mosogat|főző|mikró|pára)/i.test(name)) return CATEGORY.GEP;
  if (/csap|tálca|blanco|szett|tartozék/i.test(name)) return CATEGORY.GYARI;
  if (/vasalat|foganty|pánt|kiegészítő/i.test(name)) return CATEGORY.VASALAT;

  return CATEGORY.BUTORTEST;
}

function collectItemsFromPayload(payload) {
  const st = payload?.state && typeof payload.state === "object" ? payload.state : {};
  const out = [];
  const seenCodes = new Set();

  function rememberCode(code) {
    const c = String(code || "").trim().toUpperCase();
    if (c) seenCodes.add(c);
  }

  function hasCode(code) {
    const c = String(code || "").trim().toUpperCase();
    return c ? seenCodes.has(c) : false;
  }

  const selected = Array.isArray(st.selected) ? st.selected : [];
  selected.forEach((entry, idx) => {
    const line = Array.isArray(entry) ? entry[1] : entry;
    if (!line || typeof line !== "object") return;
    const key = line.code || entry[0] || "cab-" + idx;
    rememberCode(line.code || key);
    out.push({
      source_line_key: slugSourceKey(["cab", key, idx]),
      source_type: "selected_cabinet",
      category_id: CATEGORY.BUTORTEST,
      code: String(line.code || key || ""),
      name: String(line.name || line.code || "Bútorelem"),
      qty: Number(line.qty) || 1,
      qty_unit: "db",
      band: String(line.band || "").toLowerCase(),
      sort_index: line.sortIndex != null ? Number(line.sortIndex) : idx,
      manual_order: line.manualOrder != null ? Number(line.manualOrder) : null,
      color_note: String(line.neededColor || ""),
      legs_qty: line.legs != null ? Number(line.legs) : null,
      metadata_json: JSON.stringify({ source: "state.selected" })
    });
  });

  (st.hardwareLines || []).forEach((line, idx) => {
    rememberCode(line.code);
    out.push({
      source_line_key: slugSourceKey(["hw", line.code, idx]),
      source_type: "hardware",
      category_id: CATEGORY.VASALAT,
      code: String(line.code || ""),
      name: String(line.name || line.code || "Vasalat"),
      qty: Number(line.qty) || 1,
      qty_unit: "db",
      band: "extra",
      sort_index: idx,
      metadata_json: JSON.stringify({ source: "state.hardwareLines", unitPrice: line.unit })
    });
  });

  (st.worktopLines || []).forEach((line, idx) => {
    const cmPart =
      line.adjustedCm != null
        ? line.adjustedCm + " cm"
        : line.cm != null
          ? line.cm + " cm"
          : "";
    const label = [
      "Munkalap",
      String(line.size || "").trim(),
      String(line.name || "").trim(),
      cmPart
    ]
      .filter(Boolean)
      .join(" · ");
    out.push({
      source_line_key: slugSourceKey(["wt", line.size, line.name, line.cm, line.adjustedCm, idx]),
      source_type: "worktop",
      category_id: CATEGORY.BUTORTEST,
      code: String(line.code || ""),
      name: label || "Munkalap",
      qty: Number(line.fm || line.qty) || 1,
      qty_unit: line.fm != null ? "fm" : "db",
      band: "extra",
      sort_index: idx,
      metadata_json: JSON.stringify({
        source: "state.worktopLines",
        cm: line.cm,
        adjustedCm: line.adjustedCm
      })
    });
  });

  (st.customWorktopLines || []).forEach((line, idx) => {
    const label =
      "Bútorlap — " +
      String(line.boardName || "egyedi").trim() +
      (line.lengthCm && line.widthCm
        ? " (" + line.lengthCm + " × " + line.widthCm + " cm)"
        : "");
    out.push({
      source_line_key: slugSourceKey([
        "cwt",
        line.boardId,
        line.lengthCm,
        line.widthCm,
        line.neededColor,
        idx
      ]),
      source_type: "worktop",
      category_id: CATEGORY.BUTORTEST,
      code: String(line.code || ""),
      name: label.trim() || "Egyedi bútorlap",
      qty: Number(line.qty) || 1,
      qty_unit: "db",
      band: "extra",
      sort_index: idx,
      color_note: String(line.neededColor || ""),
      metadata_json: JSON.stringify({ source: "state.customWorktopLines" })
    });
  });

  (st.wallPanelLines || []).forEach((line, idx) => {
    out.push({
      source_line_key: slugSourceKey(["wp", line.sizeLabel, line.color, idx]),
      source_type: "wall_panel",
      category_id: CATEGORY.BUTORTEST,
      code: "",
      name: "Fali panel " + String(line.sizeLabel || ""),
      qty: Number(line.qty) || 1,
      qty_unit: "db",
      band: "wall",
      sort_index: idx,
      color_note: String(line.color || ""),
      metadata_json: JSON.stringify({ source: "state.wallPanelLines" })
    });
  });

  // Kiadvány (gépek, tálca, csap) — elsődleges forrás
  (st.kiadvanyExtrasLines || []).forEach((line, idx) => {
    rememberCode(line.code);
    out.push({
      source_line_key: slugSourceKey(["kia", line.kind, line.code, idx]),
      source_type: "kiadvany_extra",
      category_id: inferCategoryFromLine(line, "kiadvany_extra"),
      code: String(line.code || ""),
      name: String(line.name || line.code || "Kiadvány tétel"),
      qty: Number(line.qty) || 1,
      qty_unit: "db",
      band: "extra",
      sort_index: idx,
      color_note: String(line.color || ""),
      metadata_json: JSON.stringify({ source: "state.kiadvanyExtrasLines", kind: line.kind })
    });
  });

  // Nagyker — csak ha ugyanez a kód még NINCS a kiadvány / bútor tételek között
  (payload.nagykerCatalogLines || []).forEach((line, idx) => {
    const code = String(line.code || "").trim();
    if (code && hasCode(code)) return;
    rememberCode(code);
    out.push({
      source_line_key: slugSourceKey(["nk", line.code, line.megnevezes, idx]),
      source_type: "nagyker_catalog",
      category_id: inferCategoryFromLine(line, "nagyker_catalog"),
      code,
      name: String(line.megnevezes || line.name || "Nagyker tétel"),
      qty: Number(line.qty) || 1,
      qty_unit: "db",
      band: "extra",
      sort_index: idx,
      metadata_json: JSON.stringify({ source: "nagykerCatalogLines" })
    });
  });

  return out;
}

function upsertOrderFromPayload(db, payload, meta) {
  meta = meta || {};
  const quoteNumber = String(payload?.quoteNumber || "").trim().toUpperCase();
  if (!quoteNumber) throw new Error("Hiányzó quoteNumber a payload-ban");

  const customer = payload.customer || {};
  const kitchen = payload.kitchen || {};
  const st = payload.state || {};

  db.prepare(`
    INSERT INTO orders (
      quote_number, quote_date, store_key,
      customer_name, customer_address, customer_phone, customer_email,
      kitchen_type, kitchen_family, korpusz_color, kamra_upper_front,
      lower_front, upper_front, worktop_style, handle_style,
      designer_name, designer_phone,
      deadline_type, deadline_date,
      felmeres_requested, installation_requested,
      source_kind, source_payload_path, source_payload_hash, megrendelo_imported_at,
      note
    ) VALUES (
      @quote_number, @quote_date, @store_key,
      @customer_name, @customer_address, @customer_phone, @customer_email,
      @kitchen_type, @kitchen_family, @korpusz_color, @kamra_upper_front,
      @lower_front, @upper_front, @worktop_style, @handle_style,
      @designer_name, @designer_phone,
      @deadline_type, @deadline_date,
      @felmeres_requested, @installation_requested,
      @source_kind, @source_payload_path, @source_payload_hash, @megrendelo_imported_at,
      @note
    )
    ON CONFLICT(quote_number) DO UPDATE SET
      quote_date = excluded.quote_date,
      store_key = excluded.store_key,
      customer_name = excluded.customer_name,
      customer_address = excluded.customer_address,
      customer_phone = excluded.customer_phone,
      customer_email = excluded.customer_email,
      kitchen_type = excluded.kitchen_type,
      kitchen_family = excluded.kitchen_family,
      korpusz_color = excluded.korpusz_color,
      kamra_upper_front = excluded.kamra_upper_front,
      lower_front = excluded.lower_front,
      upper_front = excluded.upper_front,
      worktop_style = excluded.worktop_style,
      handle_style = excluded.handle_style,
      designer_name = excluded.designer_name,
      designer_phone = excluded.designer_phone,
      deadline_type = excluded.deadline_type,
      deadline_date = excluded.deadline_date,
      felmeres_requested = excluded.felmeres_requested,
      installation_requested = excluded.installation_requested,
      source_kind = excluded.source_kind,
      source_payload_path = excluded.source_payload_path,
      source_payload_hash = excluded.source_payload_hash,
      megrendelo_imported_at = excluded.megrendelo_imported_at,
      note = excluded.note,
      updated_at = datetime('now')
  `).run({
    quote_number: quoteNumber,
    quote_date: String(payload.quoteDate || "").slice(0, 10),
    store_key: kitchen.store === "budaors" ? "budaors" : "vaci",
    customer_name: String(customer.name || ""),
    customer_address: String(customer.address || ""),
    customer_phone: String(customer.phone || ""),
    customer_email: String(customer.email || ""),
    kitchen_type: String(kitchen.kitchenType || ""),
    kitchen_family: String(kitchen.family || ""),
    korpusz_color: String(kitchen.korpuszColor || ""),
    kamra_upper_front: String(kitchen.kamraUpperFront || ""),
    lower_front: String(kitchen.lowerFront || ""),
    upper_front: String(kitchen.upperFront || ""),
    worktop_style: String(kitchen.worktopStyle || ""),
    handle_style: String(kitchen.handleStyle || ""),
    designer_name: String(kitchen.designer || ""),
    designer_phone: String(kitchen.designerPhone || ""),
    deadline_type: String(st.deadlineType || st.deadline || ""),
    deadline_date: String(st.deadlineDate || "").slice(0, 10) || null,
    felmeres_requested: st.felmeresRequested ? 1 : 0,
    installation_requested: st.installationRequested ? 1 : 0,
    source_kind: meta.sourceKind || "megrendelo_json",
    source_payload_path: meta.sourcePayloadPath || null,
    source_payload_hash: meta.sourcePayloadHash || null,
    megrendelo_imported_at: new Date().toISOString(),
    note: String(payload.note || "")
  });

  const orderRow = db.prepare("SELECT id FROM orders WHERE quote_number = ?").get(quoteNumber);
  const orderId = orderRow.id;
  const items = collectItemsFromPayload(payload);

  const upsertItem = db.prepare(`
    INSERT INTO order_items (
      order_id, category_id, source_line_key, source_type,
      code, name, qty, qty_unit, band, sort_index, manual_order,
      color_note, legs_qty, metadata_json,
      status_muhely_id, status_helyszin_id
    ) VALUES (
      @order_id, @category_id, @source_line_key, @source_type,
      @code, @name, @qty, @qty_unit, @band, @sort_index, @manual_order,
      @color_note, @legs_qty, @metadata_json,
      @status_muhely_id, @status_helyszin_id
    )
    ON CONFLICT(order_id, source_line_key) DO UPDATE SET
      category_id = excluded.category_id,
      source_type = excluded.source_type,
      code = excluded.code,
      name = excluded.name,
      qty = excluded.qty,
      qty_unit = excluded.qty_unit,
      band = excluded.band,
      sort_index = excluded.sort_index,
      manual_order = excluded.manual_order,
      color_note = excluded.color_note,
      legs_qty = excluded.legs_qty,
      metadata_json = excluded.metadata_json,
      is_active = 1,
      updated_at = datetime('now')
  `);

  let inserted = 0;
  let updated = 0;
  const keepKeys = new Set(items.map((r) => r.source_line_key));
  db.exec("BEGIN");
  try {
    for (const row of items) {
      const existed = db
        .prepare("SELECT id FROM order_items WHERE order_id = ? AND source_line_key = ?")
        .get(orderId, row.source_line_key);
      upsertItem.run({
        order_id: orderId,
        category_id: row.category_id,
        source_line_key: row.source_line_key,
        source_type: row.source_type,
        code: row.code,
        name: row.name,
        qty: row.qty,
        qty_unit: row.qty_unit || "db",
        band: ["floor", "wall", "tall", "extra"].includes(row.band) ? row.band : "",
        sort_index: row.sort_index ?? null,
        manual_order: row.manual_order ?? null,
        color_note: row.color_note || "",
        legs_qty: row.legs_qty ?? null,
        metadata_json: row.metadata_json || "{}",
        status_muhely_id: STATUS_MUHELY_NINCS,
        status_helyszin_id: STATUS_HELYSZIN_NINCS
      });
      if (existed) updated++;
      else inserted++;
    }

    // Régi / duplikált tételek kikapcsolása (pl. nagyker + kiadvány ugyanaz)
    const existingRows = db
      .prepare("SELECT id, source_line_key FROM order_items WHERE order_id = ? AND is_active = 1")
      .all(orderId);
    const deactivate = db.prepare(
      "UPDATE order_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
    );
    for (const row of existingRows) {
      if (!keepKeys.has(row.source_line_key)) deactivate.run(row.id);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  db.prepare(
    `INSERT INTO order_events (order_id, event_type, payload_json, created_by)
     VALUES (?, 'megrendelo_import', ?, 'import-megrendelo.js')`
  ).run(orderId, JSON.stringify({ itemCount: items.length, source: meta.sourceKind }));

  return { orderId, quoteNumber, itemCount: items.length, inserted, updated };
}

function setItemStatus(db, itemId, scope, statusCode, opts) {
  opts = opts || {};
  const table = scope === "muhely" ? "status_muhely" : "status_helyszin";
  const statusRow = db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(statusCode);
  if (!statusRow) throw new Error("Ismeretlen státusz: " + statusCode);

  const item = db.prepare("SELECT * FROM order_items WHERE id = ?").get(itemId);
  if (!item) throw new Error("Nincs ilyen tétel: " + itemId);

  if (scope === "muhely") {
    db.prepare(
      `UPDATE order_items SET status_muhely_id = ?, status_muhely_at = datetime('now'),
       status_muhely_note = COALESCE(?, status_muhely_note) WHERE id = ?`
    ).run(statusRow.id, opts.note || null, itemId);
  } else {
    db.prepare(
      `UPDATE order_items SET status_helyszin_id = ?, status_helyszin_at = datetime('now'),
       status_helyszin_note = COALESCE(?, status_helyszin_note) WHERE id = ?`
    ).run(statusRow.id, opts.note || null, itemId);
  }

  const oldId = scope === "muhely" ? item.status_muhely_id : item.status_helyszin_id;
  db.prepare(
    `INSERT INTO order_item_status_log (order_item_id, status_scope, old_status_id, new_status_id, changed_by, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(itemId, scope, oldId, statusRow.id, opts.changedBy || "", opts.note || "");

  const updated = getOrderItemById(db, itemId);
  return {
    itemId,
    scope,
    statusCode,
    orderId: item.order_id,
    item: updated
  };
}

function normalizeDeliveryId(raw) {
  let s = String(raw || "").trim();
  // "MRDH-VACI-26-0555(Csobádi Ákos)" vagy "MRDH-VACI-26-0555 — Csobádi" → csak az ajánlatszám
  s = s.replace(/\s*[\(\[\{].*$/, "");
  s = s.replace(/\s*[—–\-]\s+[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű].*$/u, "");
  s = s.split(/\s+/)[0] || s;
  return s.toUpperCase().replace(/\s+/g, "");
}

function getOrderByDeliveryId(db, deliveryId) {
  const id = normalizeDeliveryId(deliveryId);
  if (!id) return null;
  return db
    .prepare(
      `SELECT id, quote_number, quote_date, store_key,
              customer_name, customer_address, customer_phone, customer_email,
              kitchen_type, kitchen_family, order_status, deadline_date,
              promised_delivery_date, installation_date, note
       FROM orders WHERE quote_number = ?`
    )
    .get(id);
}

function mapItemRow(row) {
  if (!row) return null;
  const muhelyCode = row.status_muhely_code || "nincs";
  const helyszinCode = row.status_helyszin_code || "nincs";
  return {
    id: row.id,
    orderId: row.order_id,
    categoryCode: row.category_code,
    categoryLabel: row.category_label,
    code: row.code,
    name: row.name,
    qty: row.qty,
    qtyUnit: row.qty_unit,
    band: row.band,
    colorNote: row.color_note,
    statusMuhely: {
      code: muhelyCode,
      label: row.status_muhely_label || "— (nincs)",
      at: row.status_muhely_at
    },
    statusHelyszin: {
      code: helyszinCode,
      label: row.status_helyszin_label || "— (nincs)",
      at: row.status_helyszin_at
    },
    uiClass: resolveItemUiClass(muhelyCode, helyszinCode)
  };
}

function resolveItemUiClass(muhelyCode, helyszinCode) {
  if (helyszinCode === "hianyzik" || helyszinCode === "serult") return "missing";
  if (muhelyCode === "felrakva_kocsira" || helyszinCode === "kiszallitva" || helyszinCode === "atadva") {
    return "ok";
  }
  if (helyszinCode === "utvon") return "in-transit";
  return "pending";
}

function getOrderItemById(db, itemId) {
  const row = db
    .prepare(
      `SELECT oi.*,
              ic.code AS category_code, ic.label_hu AS category_label,
              sm.code AS status_muhely_code, sm.label_hu AS status_muhely_label,
              sh.code AS status_helyszin_code, sh.label_hu AS status_helyszin_label
       FROM order_items oi
       JOIN item_categories ic ON ic.id = oi.category_id
       LEFT JOIN status_muhely sm ON sm.id = oi.status_muhely_id
       LEFT JOIN status_helyszin sh ON sh.id = oi.status_helyszin_id
       WHERE oi.id = ? AND oi.is_active = 1`
    )
    .get(itemId);
  return mapItemRow(row);
}

function listDeliveryItems(db, deliveryId) {
  const order = getOrderByDeliveryId(db, deliveryId);
  if (!order) return null;
  const rows = db
    .prepare(
      `SELECT oi.*,
              ic.code AS category_code, ic.label_hu AS category_label,
              sm.code AS status_muhely_code, sm.label_hu AS status_muhely_label,
              sh.code AS status_helyszin_code, sh.label_hu AS status_helyszin_label
       FROM order_items oi
       JOIN item_categories ic ON ic.id = oi.category_id
       LEFT JOIN status_muhely sm ON sm.id = oi.status_muhely_id
       LEFT JOIN status_helyszin sh ON sh.id = oi.status_helyszin_id
       WHERE oi.order_id = ? AND oi.is_active = 1
       ORDER BY ic.sort_order, oi.sort_index, oi.id`
    )
    .all(order.id);
  return {
    deliveryId: order.quote_number,
    order: {
      id: order.id,
      quoteNumber: order.quote_number,
      quoteDate: order.quote_date,
      customerName: order.customer_name,
      customerAddress: order.customer_address,
      customerPhone: order.customer_phone,
      kitchenType: order.kitchen_type,
      orderStatus: order.order_status,
      deadlineDate: order.deadline_date
    },
    items: rows.map(mapItemRow)
  };
}

function listStatusLookups(db) {
  const muhely = db
    .prepare(
      `SELECT code, label_hu AS label, sort_order AS sortOrder, is_terminal AS isTerminal
       FROM status_muhely WHERE is_active = 1 ORDER BY sort_order`
    )
    .all();
  const helyszin = db
    .prepare(
      `SELECT code, label_hu AS label, sort_order AS sortOrder, is_terminal AS isTerminal
       FROM status_helyszin WHERE is_active = 1 ORDER BY sort_order`
    )
    .all();
  return { muhely, helyszin };
}

function listActiveDeliveries(db) {
  const orders = db
    .prepare(
      `SELECT id, quote_number, customer_name, customer_address, order_status,
              deadline_date, updated_at
       FROM orders
       WHERE order_status NOT IN ('closed', 'cancelled', 'draft')
       ORDER BY updated_at DESC, id DESC`
    )
    .all();

  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN sm.code = 'felrakva_kocsira' THEN 1 ELSE 0 END) AS loaded,
      SUM(CASE WHEN sh.code IN ('atadva', 'kiszallitva') THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN sh.code IN ('hianyzik', 'serult') THEN 1 ELSE 0 END) AS issues
    FROM order_items oi
    LEFT JOIN status_muhely sm ON sm.id = oi.status_muhely_id
    LEFT JOIN status_helyszin sh ON sh.id = oi.status_helyszin_id
    WHERE oi.order_id = ? AND oi.is_active = 1
  `);

  return orders.map((order) => {
    const stats = statsStmt.get(order.id) || {};
    const total = Number(stats.total) || 0;
    const loaded = Number(stats.loaded) || 0;
    const delivered = Number(stats.delivered) || 0;
    const issues = Number(stats.issues) || 0;
    return {
      deliveryId: order.quote_number,
      orderId: order.id,
      customerName: order.customer_name,
      customerAddress: order.customer_address,
      orderStatus: order.order_status,
      deadlineDate: order.deadline_date,
      updatedAt: order.updated_at,
      itemCount: total,
      loadedCount: loaded,
      loadedPercent: total ? Math.round((loaded / total) * 100) : 0,
      deliveredCount: delivered,
      deliveredPercent: total ? Math.round((delivered / total) * 100) : 0,
      issueCount: issues
    };
  });
}

function searchOrdersByQuery(db, query) {
  const q = String(query || "").trim();
  if (!q || q.length < 2) return [];
  const like = "%" + q.replace(/%/g, "") + "%";
  const rows = db
    .prepare(
      `SELECT id, quote_number, customer_name, customer_address, order_status, updated_at
       FROM orders
       WHERE order_status NOT IN ('closed', 'cancelled', 'draft')
         AND (
           customer_name LIKE ? COLLATE NOCASE
           OR quote_number LIKE ? COLLATE NOCASE
           OR customer_address LIKE ? COLLATE NOCASE
         )
       ORDER BY
         CASE WHEN customer_name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 30`
    )
    .all(like, like, like, like);

  return rows.map((order) => ({
    deliveryId: order.quote_number,
    orderId: order.id,
    customerName: order.customer_name,
    customerAddress: order.customer_address,
    orderStatus: order.order_status,
    updatedAt: order.updated_at,
    source: "db"
  }));
}

module.exports = {
  DEFAULT_DB_PATH,
  CATEGORY,
  openDb,
  ensureSchema,
  collectItemsFromPayload,
  upsertOrderFromPayload,
  setItemStatus,
  normalizeDeliveryId,
  getOrderByDeliveryId,
  getOrderItemById,
  listDeliveryItems,
  listActiveDeliveries,
  searchOrdersByQuery,
  listStatusLookups,
  resolveItemUiClass,
  mapItemRow
};
