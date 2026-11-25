import { Router } from 'express';
import { isoDate, round } from '../http.js';
import { today, addDays } from '../dates.js';

export default function statsRouter(db) {
  const r = Router();

  // Woche = 7 Tage bis einschließlich ?end (Standard: heute).
  // Durchschnitte beziehen sich auf Tage mit mindestens einem Eintrag.
  r.get('/week', (req, res) => {
    const end = req.query.end !== undefined ? isoDate(req.query.end, 'end') : today();
    const start = addDays(end, -6);

    const perDay = new Map(
      db
        .prepare(
          `SELECT date, SUM(kcal * portion) AS kcal, SUM(protein * portion) AS protein
           FROM meal_entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date`,
        )
        .all(req.user.id, start, end)
        .map((d) => [d.date, d]),
    );
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      const d = perDay.get(date);
      return { date, kcal: round(d?.kcal ?? 0, 0), protein: round(d?.protein ?? 0, 0), logged: !!d };
    });
    const logged = days.filter((d) => d.logged);
    const avg = (key) => (logged.length ? round(logged.reduce((s, d) => s + d[key], 0) / logged.length, 0) : null);

    const { n: trainingDays } = db
      .prepare('SELECT COUNT(DISTINCT date) AS n FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ?')
      .get(req.user.id, start, end);

    const weights = db
      .prepare('SELECT date, kg FROM weights WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date')
      .all(req.user.id, start, end);
    const weight =
      weights.length >= 2
        ? {
            first: weights[0].kg,
            last: weights.at(-1).kg,
            change: round(weights.at(-1).kg - weights[0].kg, 2),
          }
        : null;

    res.json({
      start,
      end,
      days,
      days_logged: logged.length,
      avg_kcal: avg('kcal'),
      avg_protein: avg('protein'),
      training_days: trainingDays,
      weight,
    });
  });

  return r;
}
