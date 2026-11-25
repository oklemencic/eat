import { Router } from 'express';
import { body, num, isoDate, parseId, notFound, round } from '../http.js';
import { addDays, daysBetween } from '../dates.js';

// Zielkorridor der Gewichtszunahme (kg pro Woche)
export const GAIN_MIN = 0.25;
export const GAIN_MAX = 0.5;

// Gleitender 7-Tage-Durchschnitt: Mittel aller Messwerte der Tage [date-6, date]. rows aufsteigend nach Datum.
export function withAverages(rows) {
  return rows.map((r) => {
    const start = addDays(r.date, -6);
    const window = rows.filter((x) => x.date >= start && x.date <= r.date);
    const avg = window.reduce((s, x) => s + x.kg, 0) / window.length;
    return { ...r, avg7: round(avg, 2) };
  });
}

// Veränderung des 7-Tage-Durchschnitts zwischen dem letzten Wert und dem letzten Wert, der
// mindestens 7 Tage davor liegt, hochgerechnet auf kg pro Woche. Ohne ausreichende Daten: null.
export function trend(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const cutoff = addDays(last.date, -7);
  const base = [...rows].reverse().find((r) => r.date <= cutoff);
  if (!base) return null;
  const perWeek = ((last.avg7 - base.avg7) * 7) / daysBetween(base.date, last.date);
  const status = perWeek < GAIN_MIN ? 'too_slow' : perWeek > GAIN_MAX ? 'too_fast' : 'on_track';
  return {
    kg_per_week: round(perWeek, 2),
    status,
    target_min: GAIN_MIN,
    target_max: GAIN_MAX,
    since: base.date,
  };
}

export default function weightsRouter(db) {
  const r = Router();

  // Alle Werte (oder ?from/?to) aufsteigend, mit avg7 je Eintrag und Trend zum letzten Wert.
  // Der Durchschnitt wird immer über alle Werte berechnet; from/to filtern nur die Ausgabe.
  r.get('/', (req, res) => {
    const from = req.query.from !== undefined ? isoDate(req.query.from, 'from') : '0000-01-01';
    const to = req.query.to !== undefined ? isoDate(req.query.to, 'to') : '9999-12-31';
    const all = withAverages(db.prepare('SELECT id, date, kg FROM weights WHERE user_id = ? ORDER BY date').all(req.user.id));
    res.json({
      entries: all.filter((e) => e.date >= from && e.date <= to),
      trend: trend(all),
    });
  });

  // Ein Wert pro Tag: vorhandener Tageswert wird überschrieben
  r.post('/', (req, res) => {
    const b = body(req);
    const date = isoDate(b.date);
    const kg = num(b.kg, 'kg', { min: 20, max: 400 });
    db.prepare(
      'INSERT INTO weights (user_id, date, kg) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET kg = excluded.kg',
    ).run(req.user.id, date, kg);
    res.status(201).json(db.prepare('SELECT id, date, kg FROM weights WHERE user_id = ? AND date = ?').get(req.user.id, date));
  });

  r.delete('/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM weights WHERE id = ? AND user_id = ?').run(parseId(req.params.id), req.user.id);
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return r;
}
