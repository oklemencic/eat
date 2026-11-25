import { Router } from 'express';
import { body, num, reqString, bad } from '../http.js';

// Platzhalter-Defaults; werden in der App an Körpergewicht und Ziel angepasst
// (Richtwerte laut Plan: Überschuss +300 bis 500 kcal, Protein 1,6–2,2 g/kg).
export const DEFAULTS = {
  kcal_goal: 3000,
  protein_goal: 140,
  target_weight: null,
  meal_categories: ['Frühstück', 'Warme Mahlzeit', 'Snack', 'Süßes', 'Shake/Getränk'],
};

const VALIDATORS = {
  kcal_goal: (v) => num(v, 'kcal_goal', { min: 500, max: 10000 }),
  protein_goal: (v) => num(v, 'protein_goal', { min: 10, max: 500 }),
  target_weight: (v) => num(v, 'target_weight', { min: 20, max: 400, required: false }),
  meal_categories: (v) => {
    if (!Array.isArray(v) || v.length > 30) throw bad('meal_categories must be an array (max 30)');
    return v.map((c) => reqString(c, 'meal_categories[]', 50));
  },
};

export function readSettings(db, userId) {
  const out = { ...DEFAULTS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId)) {
    if (key in DEFAULTS) out[key] = JSON.parse(value);
  }
  return out;
}

export default function settingsRouter(db) {
  const r = Router();

  r.get('/', (req, res) => res.json(readSettings(db, req.user.id)));

  // Teil-Update: nur mitgesendete, bekannte Felder werden geändert
  r.put('/', (req, res) => {
    const b = body(req);
    const unknown = Object.keys(b).filter((k) => !(k in VALIDATORS));
    if (unknown.length) throw bad(`unknown setting: ${unknown[0]}`);
    const upsert = db.prepare(
      'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
    );
    const values = Object.entries(b).map(([k, v]) => [k, VALIDATORS[k](v)]);
    for (const [k, v] of values) upsert.run(req.user.id, k, JSON.stringify(v));
    res.json(readSettings(db, req.user.id));
  });

  return r;
}
