#!/usr/bin/env node
"use strict";

/**
 * Megrendelő JSON → SQLite order + order_items import.
 *
 * Futtatás:
 *   node db/import-megrendelo.js path/to/MRDH-VACI-26-0123.json
 *   node db/import-megrendelo.js --quote MRDH-VACI-26-0123  (Mentett megrendelők mappából)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { openDb, upsertOrderFromPayload } = require("./db-api");

const ORDER_SAVE_DIR = process.env.DIVIAN_ORDER_SAVE_DIR
  ? path.resolve(process.env.DIVIAN_ORDER_SAVE_DIR)
  : path.join(require("os").homedir(), "Desktop", "Mentett megrendelők");

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function findJsonByQuote(quoteNumber) {
  const q = String(quoteNumber || "").trim().toUpperCase();
  if (!q || !fs.existsSync(ORDER_SAVE_DIR)) return null;
  for (const name of fs.readdirSync(ORDER_SAVE_DIR)) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    if (name.toUpperCase().includes(q)) {
      return path.join(ORDER_SAVE_DIR, name);
    }
  }
  for (const dirName of fs.readdirSync(ORDER_SAVE_DIR)) {
    const full = path.join(ORDER_SAVE_DIR, dirName);
    if (!fs.statSync(full).isDirectory()) continue;
    if (!dirName.toUpperCase().includes(q)) continue;
    for (const name of fs.readdirSync(full)) {
      if (name.toLowerCase().endsWith(".json")) {
        return path.join(full, name);
      }
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  let jsonPath = "";
  if (args[0] === "--quote" && args[1]) {
    jsonPath = findJsonByQuote(args[1]) || "";
    if (!jsonPath) {
      console.error("Nem található JSON ehhez a sorszámhoz:", args[1]);
      process.exit(1);
    }
  } else if (args[0]) {
    jsonPath = path.resolve(args[0]);
  } else {
    console.error("Használat: node db/import-megrendelo.js <fájl.json> | --quote MRDH-…");
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  const payload = JSON.parse(raw);
  const db = openDb();
  const result = upsertOrderFromPayload(db, payload, {
    sourceKind: payload._fromMegrendeloPdf ? "megrendelo_pdf" : "megrendelo_json",
    sourcePayloadPath: jsonPath,
    sourcePayloadHash: sha256(raw)
  });
  db.close();

  console.log("");
  console.log("  Import kész");
  console.log("  Megrendelés ID:", result.orderId);
  console.log("  Sorszám:", result.quoteNumber);
  console.log("  Tételek:", result.itemCount, "(új:", result.inserted, ", frissítve:", result.updated, ")");
  console.log("");
}

main();
