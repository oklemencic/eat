import { Router } from 'express';
import { tx } from '../db.js';
import {
  HttpError, body, reqString, optString, num, int, isoDate, parseId, notFound, bad,
} from '../http.js';

function parse(req) {
  const b = body(req);
  const sets = b.sets ?? [];
  if (!Array.isArray(sets) || sets.length > 100) throw bad('sets must be an array (max 100)');
  return {
    workout: {
      date: isoDate(b.date),
      category: reqString(b.category, 'category', 50),
      duration_min: int(b.duration_min, 'duration_min', { min: 1, max: 1440 }),
      note: optString(b.note, 'note', 1000),
    },
    sets: sets.map((s, i) => {
      if (s === null || typeof s !== 'object') throw bad(`sets[${i}] must be an object`);
      return {
        exercise: reqString(s.exercise, `sets[${i}].exercise`, 100),
        sets: int(s.sets, `sets[${i}].sets`, { min: 1, max: 100 }),
        reps: int(s.reps, `sets[${i}].reps`, { min: 1, max: 1000 }),
        weight_kg: num(s.weight_kg ?? 0, `sets[${i}].weight_kg`, { max: 1000 }),
      };
    }),
  };
}

export default function workoutsRouter(db) {
  const r = Router();

  const setsFor = db.prepare(
    'SELECT id, exercise, sets, reps, weight_kg FROM workout_sets WHERE workout_id = ? ORDER BY id',
  );
  const load = (row) => ({ ...row, sets: setsFor.all(row.id) });

  function saveSets(workoutId, sets) {
    db.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(workoutId);
    const insert = db.prepare(
      'INSERT INTO workout_sets (workout_id, exercise, sets, reps, weight_kg) VALUES (?, ?, ?, ?, ?)',
    );
    for (const s of sets) insert.run(workoutId, s.exercise, s.sets, s.reps, s.weight_kg);
  }

  // ?from=...&to=... (optional); neueste zuerst
  r.get('/', (req, res) => {
    const from = req.query.from !== undefined ? isoDate(req.query.from, 'from') : '0000-01-01';
    const to = req.query.to !== undefined ? isoDate(req.query.to, 'to') : '9999-12-31';
    const rows = db
      .prepare('SELECT * FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC')
      .all(req.user.id, from, to);
    res.json(rows.map(load));
  });

  // Bestleistung je Übung: höchstes Gewicht (bei Gleichstand mehr Wiederholungen, dann früher)
  r.get('/records', (req, res) => {
    const rows = db
      .prepare(
        `SELECT exercise, weight_kg, reps, date FROM (
           SELECT s.exercise, s.weight_kg, s.reps, w.date,
                  ROW_NUMBER() OVER (PARTITION BY s.exercise
                                     ORDER BY s.weight_kg DESC, s.reps DESC, w.date ASC) AS rn
           FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
           WHERE w.user_id = ?)
         WHERE rn = 1 ORDER BY exercise COLLATE NOCASE`,
      )
      .all(req.user.id);
    res.json(rows);
  });

  r.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(parseId(req.params.id), req.user.id);
    if (!row) throw notFound();
    res.json(load(row));
  });

  r.post('/', (req, res) => {
    const { workout, sets } = parse(req);
    const id = tx(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO workouts (user_id, date, category, duration_min, note) VALUES (@user_id, @date, @category, @duration_min, @note)')
        .run({ ...workout, user_id: req.user.id });
      saveSets(lastInsertRowid, sets);
      return lastInsertRowid;
    });
    res.status(201).json(load(db.prepare('SELECT * FROM workouts WHERE id = ?').get(id)));
  });

  // Ersetzt Training und alle Sätze
  r.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const { workout, sets } = parse(req);
    tx(db, () => {
      const { changes } = db
        .prepare('UPDATE workouts SET date=@date, category=@category, duration_min=@duration_min, note=@note WHERE id=@id AND user_id=@user_id')
        .run({ ...workout, id, user_id: req.user.id });
      if (!changes) throw notFound();
      saveSets(id, sets);
    });
    res.json(load(db.prepare('SELECT * FROM workouts WHERE id = ?').get(id)));
  });

  r.delete('/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?').run(parseId(req.params.id), req.user.id);
    if (!changes) throw new HttpError(404, 'not found');
    res.status(204).end();
  });

  return r;
}
