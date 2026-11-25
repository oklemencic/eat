// SQLite-Zugriff (node:sqlite), Schema und Migrationen.
// Bewusst kein WAL-Modus: So besteht die Datenbank aus einer einzigen Datei (Backup = Dateikopie).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const TABLES = [
  'photos',
  'dishes',
  'products',
  'meal_entries',
  'workouts',
  'workout_sets',
  'weights',
  'settings',
];

// Ausgangsschema (Migration 1); exportiert, damit der Test eine Einzelnutzer-Datenbank nachbauen kann
export const SCHEMA = `
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE dishes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL,
  fat REAL,
  favorite INTEGER NOT NULL DEFAULT 0,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL
);
-- kcal/protein/carbs/fat gelten pro Portion; Summen = Wert * portion
CREATE TABLE meal_entries (
  id INTEGER PRIMARY KEY,
  eaten_at TEXT NOT NULL,
  date TEXT NOT NULL,
  dish_id INTEGER REFERENCES dishes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT,
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL,
  fat REAL,
  portion REAL NOT NULL DEFAULT 1,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  note TEXT
);
CREATE INDEX idx_meal_entries_date ON meal_entries(date);
CREATE TABLE workouts (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX idx_workouts_date ON workouts(date);
CREATE TABLE workout_sets (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL,
  sets INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight_kg REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_workout_sets_workout ON workout_sets(workout_id);
CREATE TABLE weights (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  kg REAL NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Richtwerte; Nährwerte sind Schätzungen und können in der App angepasst werden.
const SEED_DISHES = [
  ['Haferflocken mit Milch und Banane', 'Frühstück', 550, 20, 85, 14],
  ['Vollkornbrot mit Käse (2 Scheiben)', 'Frühstück', 420, 22, 42, 18],
  ['Rührei (3 Eier) mit Brot', 'Frühstück', 480, 28, 25, 28],
  ['Spaghetti Bolognese', 'Warme Mahlzeit', 750, 38, 90, 24],
  ['Hühnerreis mit Gemüse', 'Warme Mahlzeit', 700, 45, 80, 20],
  ['Skyr natur (250 g)', 'Snack', 160, 27, 10, 1],
  ['Nüsse (50 g)', 'Snack', 310, 10, 8, 27],
  ['Erdnussbutter-Brot', 'Snack', 380, 14, 35, 20],
  ['Schokolade (100 g)', 'Süßes', 540, 7, 57, 31],
  ['Protein-Shake mit Milch', 'Shake/Getränk', 350, 35, 25, 10],
];

// Beispielgerichte für einen neuen Benutzer
export function seedDishes(db, userId) {
  const insert = db.prepare(
    'INSERT INTO dishes (user_id, name, category, kcal, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const d of SEED_DISHES) insert.run(userId, ...d);
}

// Mehrbenutzerbetrieb. Jede Datentabelle bekommt user_id; Löschen eines Benutzers löscht seine Daten.
// workout_sets gehört über workouts zum Benutzer. Bestehende Daten (aus der Einzelnutzer-Zeit und die
// Beispielgerichte einer neuen Datenbank) bleiben mit user_id NULL liegen, bis der erste Benutzer angelegt
// wird und sie übernimmt (claimLegacyData). Abfragen filtern immer auf user_id, NULL-Zeilen sind unsichtbar.
const MULTI_USER = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE photos ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE dishes ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE meal_entries ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE workouts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
DROP INDEX idx_meal_entries_date;
DROP INDEX idx_workouts_date;
CREATE INDEX idx_photos_user ON photos(user_id);
CREATE INDEX idx_dishes_user ON dishes(user_id);
CREATE INDEX idx_meal_entries_user_date ON meal_entries(user_id, date);
CREATE INDEX idx_workouts_user_date ON workouts(user_id, date);

CREATE TABLE weights_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kg REAL NOT NULL,
  UNIQUE (user_id, date)
);
INSERT INTO weights_new (id, date, kg) SELECT id, date, kg FROM weights;
DROP TABLE weights;
ALTER TABLE weights_new RENAME TO weights;

CREATE TABLE settings_new (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO settings_new (key, value) SELECT key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
`;

// Ordnet alle noch keinem Benutzer gehörenden Daten dem Benutzer zu (nur beim ersten Benutzer aufrufen)
export function claimLegacyData(db, userId) {
  for (const t of ['photos', 'dishes', 'meal_entries', 'workouts', 'weights', 'settings']) {
    db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(userId);
  }
}

// Jeder Eintrag läuft genau einmal (user_version). Ein Eintrag ist SQL oder eine Funktion.
// Eintrag 2 (Beispielgerichte) darf nicht mehr geändert werden, bestehende Datenbanken haben ihn schon gesehen.
function seedLegacy(db) {
  const insert = db.prepare(
    'INSERT INTO dishes (name, category, kcal, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const d of SEED_DISHES) insert.run(...d);
}

// Allgemeine Werte der App (z. B. der Signaturschlüssel für Sessions); nie Teil von Export/Import
const APP_META = `
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Produkte (per Barcode erfasste Lebensmittel). Nährwerte gelten pro 100 g. Der Barcode ist normalisiert
// (nur Ziffern ohne führende Nullen, siehe normalizeBarcode in routes/products.js) und je Benutzer eindeutig.
const PRODUCTS = `
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  kcal_100 REAL NOT NULL,
  protein_100 REAL NOT NULL DEFAULT 0,
  carbs_100 REAL,
  fat_100 REAL,
  serving_g REAL,
  UNIQUE (user_id, barcode)
);
`;

const MIGRATIONS = [SCHEMA, seedLegacy, MULTI_USER, APP_META, PRODUCTS];

// Signaturschlüssel für Session-Cookies: beim ersten Start zufällig erzeugt und in der Datenbank abgelegt,
// damit Sessions Neustarts überstehen und niemand einen Wert anlegen muss.
export function sessionSecret(db) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'session_secret'").get();
  if (row) return row.value;
  const value = randomBytes(48).toString('base64url');
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('session_secret', ?)").run(value);
  return value;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      const step = MIGRATIONS[v];
      if (typeof step === 'function') step(db);
      else db.exec(step);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function openDb(dataDir) {
  mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'eat.db'));
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}
