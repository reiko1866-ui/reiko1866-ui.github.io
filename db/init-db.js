#!/usr/bin/env node
"use strict";

/**
 * SQLite adatbázis inicializálás — asztalos megrendelő + szállítás.
 * Futtatás: node db/init-db.js
 * Opcionális: node db/init-db.js --path C:\data\divian-asztalos.db
 *             node db/init-db.js --force
 *
 * Node.js 22+ (beépített node:sqlite modul).
 */

const fs = require("fs");
const path = require("path");
const { openDb, ensureSchema, DEFAULT_DB_PATH } = require("./db-api");

function parseArgs(argv) {
  const out = { dbPath: DEFAULT_DB_PATH, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.force = true;
    else if (a === "--path" && argv[i + 1]) {
      out.dbPath = path.resolve(argv[++i]);
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);

  if (opts.force && fs.existsSync(opts.dbPath)) {
    fs.unlinkSync(opts.dbPath);
    console.log("[init-db] Régi adatbázis törölve:", opts.dbPath);
  }

  const db = openDb(opts.dbPath);
  ensureSchema(db);

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((r) => r.name);

  const counts = {
    categories: db.prepare("SELECT COUNT(*) AS n FROM item_categories").get().n,
    status_muhely: db.prepare("SELECT COUNT(*) AS n FROM status_muhely").get().n,
    status_helyszin: db.prepare("SELECT COUNT(*) AS n FROM status_helyszin").get().n
  };

  db.close();

  console.log("");
  console.log("  Divian asztalos DB — kész");
  console.log("  Fájl:", opts.dbPath);
  console.log("  Táblák:", tables.join(", "));
  console.log(
    "  Seed:",
    counts.categories,
    "kategória,",
    counts.status_muhely,
    "műhely,",
    counts.status_helyszin,
    "helyszín státusz"
  );
  console.log("");
}

main();
