-- Divian asztalos megrendelő + szállítás-kezelő
-- SQLite 3.x — futtatás: node db/init-db.js
--
-- Forrás: Megrendelő (Mentett megrendelők / collectQuotePayload JSON)
-- Dinamikus bővítés: order_items sorok bármikor hozzáadhatók (import, kézi, sync)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Lookup: tétel kategóriák (fix, bővíthető seed-del)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_categories (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  label_hu      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- Lookup: műhely státuszok (status_muhely)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_muhely (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  label_hu      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_terminal   INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- Lookup: helyszín / szállítás státuszok (status_helyszin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_helyszin (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  label_hu      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_terminal   INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- Megrendelés fej (ügyfél + projekt + határidők)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number            TEXT NOT NULL UNIQUE,
  quote_date              TEXT,
  store_key               TEXT NOT NULL DEFAULT 'vaci'
                            CHECK (store_key IN ('vaci', 'budaors')),

  -- Ügyfél
  customer_name           TEXT NOT NULL DEFAULT '',
  customer_address        TEXT NOT NULL DEFAULT '',
  customer_phone          TEXT NOT NULL DEFAULT '',
  customer_email          TEXT NOT NULL DEFAULT '',

  -- Konyha / projekt (Megrendelő kitchen blokk)
  kitchen_type            TEXT NOT NULL DEFAULT '',
  kitchen_family          TEXT NOT NULL DEFAULT '',
  korpusz_color           TEXT NOT NULL DEFAULT '',
  kamra_upper_front       TEXT NOT NULL DEFAULT '',
  lower_front             TEXT NOT NULL DEFAULT '',
  upper_front             TEXT NOT NULL DEFAULT '',
  worktop_style           TEXT NOT NULL DEFAULT '',
  handle_style            TEXT NOT NULL DEFAULT '',
  designer_name           TEXT NOT NULL DEFAULT '',
  designer_phone          TEXT NOT NULL DEFAULT '',

  -- Határidők / workflow
  deadline_type           TEXT NOT NULL DEFAULT '',
  deadline_date           TEXT,
  promised_delivery_date  TEXT,
  installation_date       TEXT,
  felmeres_requested      INTEGER NOT NULL DEFAULT 0 CHECK (felmeres_requested IN (0, 1)),
  installation_requested  INTEGER NOT NULL DEFAULT 0 CHECK (installation_requested IN (0, 1)),

  -- Megrendelő forrás (szinkron / audit)
  source_kind             TEXT NOT NULL DEFAULT 'manual'
                            CHECK (source_kind IN ('manual', 'megrendelo_json', 'megrendelo_pdf', 'arajanlat_sync')),
  source_payload_path     TEXT,
  source_payload_hash     TEXT,
  megrendelo_imported_at  TEXT,

  order_status            TEXT NOT NULL DEFAULT 'active'
                            CHECK (order_status IN (
                              'draft', 'active', 'in_workshop', 'ready_to_ship',
                              'on_truck', 'delivered', 'closed', 'cancelled'
                            )),

  note                    TEXT NOT NULL DEFAULT '',
  internal_note           TEXT NOT NULL DEFAULT '',

  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_name ON orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_orders_deadline_date ON orders(deadline_date);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_store_key ON orders(store_key);

-- ---------------------------------------------------------------------------
-- Megrendelés tételek (dinamikusan bővülő lista)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id                INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  category_id             INTEGER NOT NULL REFERENCES item_categories(id),
  source_line_key         TEXT NOT NULL,
  source_type             TEXT NOT NULL DEFAULT 'manual'
                            CHECK (source_type IN (
                              'selected_cabinet', 'hardware', 'worktop', 'wall_panel',
                              'kiadvany_extra', 'nagyker_catalog', 'manual', 'other'
                            )),

  code                    TEXT NOT NULL DEFAULT '',
  name                    TEXT NOT NULL,
  qty                     REAL NOT NULL DEFAULT 1 CHECK (qty >= 0),
  qty_unit                TEXT NOT NULL DEFAULT 'db',

  band                    TEXT NOT NULL DEFAULT ''
                            CHECK (band IN ('', 'floor', 'wall', 'tall', 'extra')),
  sort_index              INTEGER,
  manual_order            INTEGER,

  color_note              TEXT NOT NULL DEFAULT '',
  legs_qty                INTEGER,
  metadata_json           TEXT NOT NULL DEFAULT '{}',

  status_muhely_id        INTEGER REFERENCES status_muhely(id),
  status_helyszin_id      INTEGER REFERENCES status_helyszin(id),
  status_muhely_at        TEXT,
  status_helyszin_at      TEXT,
  status_muhely_note      TEXT NOT NULL DEFAULT '',
  status_helyszin_note    TEXT NOT NULL DEFAULT '',

  is_active               INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (order_id, source_line_key)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_category_id ON order_items(category_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status_muhely ON order_items(status_muhely_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status_helyszin ON order_items(status_helyszin_id);
CREATE INDEX IF NOT EXISTS idx_order_items_code ON order_items(code);

-- ---------------------------------------------------------------------------
-- Státusz változás napló (műhely + helyszín)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_item_status_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id     INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  status_scope      TEXT NOT NULL CHECK (status_scope IN ('muhely', 'helyszin')),
  old_status_id     INTEGER,
  new_status_id     INTEGER,
  changed_by        TEXT NOT NULL DEFAULT '',
  note              TEXT NOT NULL DEFAULT '',
  changed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_status_log_item ON order_item_status_log(order_item_id);
CREATE INDEX IF NOT EXISTS idx_status_log_changed_at ON order_item_status_log(changed_at);

-- ---------------------------------------------------------------------------
-- Megrendelés eseménynapló (import, megjegyzés, szállítás)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);

-- ---------------------------------------------------------------------------
-- Nézet: összesítő státusz számlálók megrendelésenként
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_order_item_status_summary AS
SELECT
  o.id AS order_id,
  o.quote_number,
  ic.code AS category_code,
  ic.label_hu AS category_label,
  sm.code AS status_muhely_code,
  sm.label_hu AS status_muhely_label,
  sh.code AS status_helyszin_code,
  sh.label_hu AS status_helyszin_label,
  COUNT(*) AS item_count
FROM orders o
JOIN order_items oi ON oi.order_id = o.id AND oi.is_active = 1
JOIN item_categories ic ON ic.id = oi.category_id
LEFT JOIN status_muhely sm ON sm.id = oi.status_muhely_id
LEFT JOIN status_helyszin sh ON sh.id = oi.status_helyszin_id
GROUP BY o.id, ic.id, sm.id, sh.id;

-- ---------------------------------------------------------------------------
-- Seed: kategóriák
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO item_categories (id, code, label_hu, sort_order) VALUES
  (1, 'butortest_lap',       'Bútortestek és lapok',     10),
  (2, 'vasalat_kiegeszito',  'Vasalatok és kiegészítők', 20),
  (3, 'gyari_tartozek',      'Gyári tartozékok',         30),
  (4, 'beepitheto_gep',      'Beépíthető gépek',         40);

-- ---------------------------------------------------------------------------
-- Seed: műhely státuszok
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO status_muhely (id, code, label_hu, sort_order, is_terminal) VALUES
  (1, 'nincs',              '— (nincs)',              0,  0),
  (2, 'varakozik',          'Várakozik',              10, 0),
  (3, 'elokeszitve',         'Előkészítve',            20, 0),
  (4, 'gyartas_alatt',       'Gyártás alatt',          30, 0),
  (5, 'kesz',                'Kész (műhelyben)',       40, 0),
  (6, 'felrakva_kocsira',    'Felrakva a kocsira',     50, 1);

-- ---------------------------------------------------------------------------
-- Seed: helyszín státuszok
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO status_helyszin (id, code, label_hu, sort_order, is_terminal) VALUES
  (1, 'nincs',              '— (nincs)',              0,  0),
  (2, 'utvon',              'Úton',                   10, 0),
  (3, 'kiszallitva',         'Kiszállítva',            20, 0),
  (4, 'atadva',              'Átadva',                 30, 1),
  (5, 'serult',              'Sérült',                 40, 1),
  (6, 'hianyzik',            'Hiányzik',               50, 1);

-- ---------------------------------------------------------------------------
-- Trigger: orders.updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_orders_updated_at
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
  UPDATE orders SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_items_updated_at
AFTER UPDATE ON order_items
FOR EACH ROW
BEGIN
  UPDATE order_items SET updated_at = datetime('now') WHERE id = OLD.id;
END;
