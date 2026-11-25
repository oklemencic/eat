// Export (JSON, CSV) und Import (JSON) der Daten des angemeldeten Benutzers. Foto-Dateien sind nicht Teil des
// Exports; sie werden über eine Kopie von data/photos gesichert. Die Export-Datei enthält weder user_id noch
// andere Benutzer; beim Import werden die IDs neu vergeben (sie sind in der Datenbank für alle Benutzer eindeutig).

import { Router } from 'express';
import { TABLES, tx } from '../db.js';
import { bad, body } from '../http.js';
import { PHOTO_ID, PHOTO_FILE } from './photos.js';

const FORMAT_VERSION = 1;

// Spalten ohne user_id (der Besitzer ist immer der angemeldete Benutzer)
function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => c !== 'user_id');
}

// Nur die Zeilen des Benutzers; workout_sets gehören über ihr Training dazu
const OWN_ROWS = {
  photos: 'SELECT * FROM photos WHERE user_id = ? ORDER BY created_at, id',
  dishes: 'SELECT * FROM dishes WHERE user_id = ? ORDER BY id',
  products: 'SELECT * FROM products WHERE user_id = ? ORDER BY id',
  meal_entries: 'SELECT * FROM meal_entries WHERE user_id = ? ORDER BY id',
  workouts: 'SELECT * FROM workouts WHERE user_id = ? ORDER BY id',
  workout_sets:
    'SELECT s.* FROM workout_sets s JOIN workouts w ON w.id = s.workout_id WHERE w.user_id = ? ORDER BY s.id',
  weights: 'SELECT * FROM weights WHERE user_id = ? ORDER BY id',
  settings: 'SELECT * FROM settings WHERE user_id = ? ORDER BY key',
};

function ownRows(db, table, userId) {
  const cols = columnsOf(db, table);
  return db.prepare(OWN_ROWS[table]).all(userId).map((row) => Object.fromEntries(cols.map((c) => [c, row[c]])));
}

// Zellen, die eine Tabellenkalkulation als Formel deuten würde, entschärfen
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function exchangeRouter(db) {
  const r = Router();

  // ?format=json (Standard) oder ?format=csv&table=<Tabelle>
  r.get('/export', (req, res) => {
    const format = req.query.format ?? 'json';
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const table = req.query.table;
      if (!TABLES.includes(table)) throw bad(`table must be one of: ${TABLES.join(', ')}`);
      const cols = columnsOf(db, table);
      const rows = ownRows(db, table, req.user.id);
      const lines = [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))];
      res
        .type('text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="eat-${table}-${stamp}.csv"`)
        .send(`\uFEFF${lines.join('\r\n')}\r\n`); // BOM: Excel erkennt UTF-8
      return;
    }
    if (format !== 'json') throw bad('format must be json or csv');

    const tables = Object.fromEntries(TABLES.map((t) => [t, ownRows(db, t, req.user.id)]));
    res
      .set('Content-Disposition', `attachment; filename="eat-export-${stamp}.json"`)
      .json({ app: 'eat', version: FORMAT_VERSION, exported_at: new Date().toISOString(), tables });
  });

  // Ersetzt ALLE Daten des angemeldeten Benutzers (die anderer Benutzer bleiben unberührt).
  // Muss mit ?confirm=replace bestätigt werden; alles oder nichts.
  r.post('/import', (req, res) => {
    if (req.query.confirm !== 'replace') {
      throw bad('import replaces all data; confirm with ?confirm=replace');
    }
    const b = body(req);
    if (b.app !== 'eat' || b.version !== FORMAT_VERSION || !b.tables || typeof b.tables !== 'object') {
      throw bad('not an eat export (app/version/tables)');
    }
    const uid = req.user.id;

    const counts = {};
    try {
      tx(db, () => {
        // workout_sets verschwinden mit ihren Trainings (ON DELETE CASCADE)
        for (const t of [...TABLES].reverse()) {
          if (t !== 'workout_sets') db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid);
        }

        // Alte ID -> neue ID, damit Verweise innerhalb der Datei erhalten bleiben
        const newIds = { dishes: new Map(), workouts: new Map() };
        const photoIds = new Set();
        const remap = (map, value, what) => {
          const id = map.get(String(value));
          if (id === undefined) throw bad(`import contains broken references (${what})`);
          return id;
        };

        for (const table of TABLES) {
          const rows = b.tables[table] ?? [];
          if (!Array.isArray(rows)) throw bad(`tables.${table} must be an array`);
          const known = columnsOf(db, table);
          for (const row of rows) {
            if (row === null || typeof row !== 'object') throw bad(`tables.${table}: row must be an object`);
            // Fotos behalten ihre ID (sie steckt im Dateinamen); sonst vergibt die Datenbank neue IDs
            const cols = Object.keys(row).filter((c) => known.includes(c) && (c !== 'id' || table === 'photos'));
            if (!cols.length) throw bad(`tables.${table}: row has no known columns`);
            for (const c of cols) {
              const v = row[c];
              if (v !== null && typeof v !== 'string' && typeof v !== 'number') {
                throw bad(`tables.${table}.${c}: unsupported value`);
              }
            }
            const values = { ...row };
            if (table === 'photos') {
              // Dateiname muss zur ID gehören, sonst ließe sich eine fremde Datei einbinden
              if (!(PHOTO_ID.test(row.id) && PHOTO_FILE.test(row.file) && row.file.startsWith(row.id))) {
                throw bad('tables.photos: invalid id or file');
              }
              photoIds.add(row.id);
            }
            if ((table === 'dishes' || table === 'meal_entries') && values.photo_id != null && !photoIds.has(values.photo_id)) {
              throw bad(`import contains broken references (${table}.photo_id)`);
            }
            if (table === 'meal_entries' && values.dish_id != null) {
              values.dish_id = remap(newIds.dishes, values.dish_id, 'meal_entries.dish_id');
            }
            if (table === 'workout_sets') {
              values.workout_id = remap(newIds.workouts, values.workout_id, 'workout_sets.workout_id');
            }

            // workout_sets haben keine eigene user_id
            const owner = table === 'workout_sets' ? [] : ['user_id'];
            const names = [...owner, ...cols];
            const args = [...(owner.length ? [uid] : []), ...cols.map((c) => values[c])];
            const { lastInsertRowid } = db
              .prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
              .run(...args);
            if (newIds[table] && row.id !== undefined && row.id !== null) {
              newIds[table].set(String(row.id), Number(lastInsertRowid));
            }
          }
          counts[table] = rows.length;
        }
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length) throw bad('import contains broken references');
      });
    } catch (err) {
      if (err.status) throw err;
      // SQLite-Fehler (NOT NULL, UNIQUE, ...): Daten unverändert, Import abgelehnt
      throw bad(`import rejected, data unchanged: ${err.message}`);
    }
    res.json({ imported: counts });
  });

  return r;
}
