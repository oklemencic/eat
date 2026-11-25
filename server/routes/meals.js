import { Router } from 'express';
import {
  HttpError, body, reqString, optString, num, isoDate, isoDateTime, parseId, photoRef, notFound, round,
} from '../http.js';
import { nowMinute } from '../dates.js';

// Gespeicherte Werte gelten pro Portion; *_total = Wert * Portionsfaktor.
function toApi(row) {
  const scale = (v) => (v === null ? null : round(v * row.portion, 1));
  return {
    ...row,
    kcal_total: scale(row.kcal),
    protein_total: scale(row.protein),
    carbs_total: scale(row.carbs),
    fat_total: scale(row.fat),
  };
}

function totals(entries) {
  const sum = (key) => round(entries.reduce((s, e) => s + (e[key] ?? 0), 0), 1);
  return { kcal: sum('kcal_total'), protein: sum('protein_total'), carbs: sum('carbs_total'), fat: sum('fat_total') };
}

function parse(db, req) {
  const uid = req.user.id;
  const b = body(req);

  // Werte aus dem Gericht übernehmen, einzelne Felder dürfen überschrieben werden
  let dish = null;
  if (b.dish_id !== undefined && b.dish_id !== null) {
    const dishId = Number(b.dish_id);
    dish = Number.isSafeInteger(dishId)
      ? db.prepare('SELECT * FROM dishes WHERE id = ? AND user_id = ?').get(dishId, uid)
      : null;
    if (!dish) throw new HttpError(400, 'dish_id does not exist');
  }
  const pick = (key) => (b[key] !== undefined ? b[key] : dish?.[key]);

  const eatenAt = b.eaten_at !== undefined ? isoDateTime(b.eaten_at) : nowMinute();
  return {
    eaten_at: eatenAt,
    date: eatenAt.slice(0, 10),
    dish_id: dish?.id ?? null,
    name: reqString(pick('name'), 'name'),
    category: optString(pick('category'), 'category', 50),
    kcal: num(pick('kcal'), 'kcal', { max: 10000 }),
    protein: num(pick('protein') ?? 0, 'protein', { max: 1000 }),
    carbs: num(pick('carbs'), 'carbs', { max: 1000, required: false }),
    fat: num(pick('fat'), 'fat', { max: 1000, required: false }),
    portion: num(b.portion ?? 1, 'portion', { min: 0.05, max: 20 }),
    photo_id: photoRef(db, uid, b.photo_id !== undefined ? b.photo_id : dish?.photo_id),
    note: optString(b.note, 'note', 1000),
  };
}

export default function mealsRouter(db) {
  const r = Router();

  // ?date=YYYY-MM-DD oder ?from=...&to=...
  r.get('/', (req, res) => {
    let from;
    let to;
    if (req.query.date !== undefined) {
      from = to = isoDate(req.query.date);
    } else if (req.query.from !== undefined && req.query.to !== undefined) {
      from = isoDate(req.query.from, 'from');
      to = isoDate(req.query.to, 'to');
    } else {
      throw new HttpError(400, 'date or from/to is required');
    }
    const entries = db
      .prepare('SELECT * FROM meal_entries WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY eaten_at, id')
      .all(req.user.id, from, to)
      .map(toApi);
    res.json({ entries, totals: totals(entries) });
  });

  r.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM meal_entries WHERE id = ? AND user_id = ?').get(parseId(req.params.id), req.user.id);
    if (!row) throw notFound();
    res.json(toApi(row));
  });

  r.post('/', (req, res) => {
    const m = parse(db, req);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO meal_entries
           (user_id, eaten_at, date, dish_id, name, category, kcal, protein, carbs, fat, portion, photo_id, note)
         VALUES (@user_id, @eaten_at, @date, @dish_id, @name, @category, @kcal, @protein, @carbs, @fat,
                 @portion, @photo_id, @note)`,
      )
      .run({ ...m, user_id: req.user.id });
    res.status(201).json(toApi(db.prepare('SELECT * FROM meal_entries WHERE id = ?').get(lastInsertRowid)));
  });

  r.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const m = parse(db, req);
    const { changes } = db
      .prepare(
        `UPDATE meal_entries SET eaten_at=@eaten_at, date=@date, dish_id=@dish_id, name=@name,
           category=@category, kcal=@kcal, protein=@protein, carbs=@carbs, fat=@fat,
           portion=@portion, photo_id=@photo_id, note=@note WHERE id=@id AND user_id=@user_id`,
      )
      .run({ ...m, id, user_id: req.user.id });
    if (!changes) throw notFound();
    res.json(toApi(db.prepare('SELECT * FROM meal_entries WHERE id = ?').get(id)));
  });

  r.delete('/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM meal_entries WHERE id = ? AND user_id = ?').run(parseId(req.params.id), req.user.id);
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return r;
}
