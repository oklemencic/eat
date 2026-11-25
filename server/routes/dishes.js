import { Router } from 'express';
import { body, reqString, optString, num, bool, parseId, photoRef, notFound } from '../http.js';

const toApi = (row) => ({ ...row, favorite: !!row.favorite });

function parse(db, req) {
  const uid = req.user.id;
  const b = body(req);
  return {
    name: reqString(b.name, 'name'),
    category: optString(b.category, 'category', 50),
    kcal: num(b.kcal, 'kcal', { max: 10000 }),
    protein: num(b.protein ?? 0, 'protein', { max: 1000 }),
    carbs: num(b.carbs, 'carbs', { max: 1000, required: false }),
    fat: num(b.fat, 'fat', { max: 1000, required: false }),
    favorite: bool(b.favorite) ? 1 : 0,
    photo_id: photoRef(db, uid, b.photo_id),
  };
}

export default function dishesRouter(db) {
  const r = Router();

  // ?favorite=1 und ?q=Suchtext (optional)
  r.get('/', (req, res) => {
    const where = ['user_id = @uid'];
    const params = { uid: req.user.id };
    if (bool(req.query.favorite)) where.push('favorite = 1');
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      where.push("name LIKE @q ESCAPE '\\'");
      params.q = `%${req.query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    }
    const sql = `SELECT * FROM dishes WHERE ${where.join(' AND ')}
                 ORDER BY favorite DESC, name COLLATE NOCASE`;
    res.json(db.prepare(sql).all(params).map(toApi));
  });

  // "Zuletzt gegessen": Gerichte, sortiert nach letztem Eintrag
  r.get('/recent', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const rows = db
      .prepare(
        `SELECT d.*, MAX(m.eaten_at) AS last_eaten_at
         FROM dishes d JOIN meal_entries m ON m.dish_id = d.id
         WHERE d.user_id = ?
         GROUP BY d.id ORDER BY last_eaten_at DESC LIMIT ?`,
      )
      .all(req.user.id, limit);
    res.json(rows.map(toApi));
  });

  r.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM dishes WHERE id = ? AND user_id = ?').get(parseId(req.params.id), req.user.id);
    if (!row) throw notFound();
    res.json(toApi(row));
  });

  r.post('/', (req, res) => {
    const d = parse(db, req);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO dishes (user_id, name, category, kcal, protein, carbs, fat, favorite, photo_id)
         VALUES (@user_id, @name, @category, @kcal, @protein, @carbs, @fat, @favorite, @photo_id)`,
      )
      .run({ ...d, user_id: req.user.id });
    res.status(201).json(toApi(db.prepare('SELECT * FROM dishes WHERE id = ?').get(lastInsertRowid)));
  });

  r.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const d = parse(db, req);
    const { changes } = db
      .prepare(
        `UPDATE dishes SET name=@name, category=@category, kcal=@kcal, protein=@protein,
           carbs=@carbs, fat=@fat, favorite=@favorite, photo_id=@photo_id WHERE id=@id AND user_id=@user_id`,
      )
      .run({ ...d, id, user_id: req.user.id });
    if (!changes) throw notFound();
    res.json(toApi(db.prepare('SELECT * FROM dishes WHERE id = ?').get(id)));
  });

  // Bestehende Essens-Einträge bleiben erhalten (dish_id wird NULL).
  r.delete('/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM dishes WHERE id = ? AND user_id = ?').run(parseId(req.params.id), req.user.id);
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return r;
}
