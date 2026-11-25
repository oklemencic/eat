// Produkte: per Barcode erfasste Lebensmittel mit Nährwerten pro 100 g (je Benutzer).
// Unbekannte Barcodes kann der Server als Vorschlag in Open Food Facts nachschlagen (GET /lookup/:code, siehe lookup.js);
// gespeichert wird erst, wenn der Benutzer den Vorschlag bestätigt. Über POST /batch lassen sich viele Produkte auf einmal anlegen.

import { Router } from 'express';
import { body, bad, reqString, optString, num, parseId, notFound, HttpError } from '../http.js';
import { LookupError } from '../lookup.js';

const MAX_BATCH = 100;

// Barcodes sind 6 bis 14 Ziffern (EAN-8, UPC-A, EAN-13, ITF-14). Gespeichert wird ohne führende Nullen,
// damit ein UPC-A-Code (12 Stellen) und derselbe Code als EAN-13 (mit vorangestellter 0) dasselbe Produkt sind.
export function normalizeBarcode(v) {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^\d{6,14}$/.test(s.trim())) throw bad('barcode must be 6 to 14 digits');
  return s.trim().replace(/^0+/, '') || '0';
}

function parse(b) {
  return {
    barcode: normalizeBarcode(b.barcode),
    name: reqString(b.name, 'name'),
    brand: optString(b.brand, 'brand', 100),
    kcal_100: num(b.kcal_100, 'kcal_100', { max: 1000 }),
    protein_100: num(b.protein_100 ?? 0, 'protein_100', { max: 100 }),
    carbs_100: num(b.carbs_100, 'carbs_100', { max: 100, required: false }),
    fat_100: num(b.fat_100, 'fat_100', { max: 100, required: false }),
    serving_g: num(b.serving_g, 'serving_g', { min: 1, max: 5000, required: false }),
  };
}

export default function productsRouter(db, { lookup = null } = {}) {
  const r = Router();

  const byId = (id, uid) => db.prepare('SELECT * FROM products WHERE id = ? AND user_id = ?').get(id, uid);
  const byBarcode = (code, uid) => db.prepare('SELECT * FROM products WHERE barcode = ? AND user_id = ?').get(code, uid);
  const conflict = () => new HttpError(409, 'barcode already registered');

  // ?q=Suchtext (Name oder Marke, optional)
  r.get('/', (req, res) => {
    const where = ['user_id = @uid'];
    const params = { uid: req.user.id };
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      where.push("(name LIKE @q ESCAPE '\\' OR brand LIKE @q ESCAPE '\\')");
      params.q = `%${req.query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    }
    res.json(db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`).all(params));
  });

  // Nachschlagen per Barcode; 404, wenn der Benutzer das Produkt noch nicht angelegt hat
  r.get('/barcode/:code', (req, res) => {
    const row = byBarcode(normalizeBarcode(req.params.code), req.user.id);
    if (!row) throw notFound();
    res.json(row);
  });

  // Vorschlag aus Open Food Facts zu einem Barcode, den der Benutzer noch nicht angelegt hat.
  // 404: unbekannt (oder Abfrage abgeschaltet), 502: Dienst nicht erreichbar. Der Client fällt in beiden Fällen auf manuelle Eingabe zurück.
  // Reihenfolge: vor /:id
  r.get('/lookup/:code', async (req, res) => {
    const code = normalizeBarcode(req.params.code);
    if (byBarcode(code, req.user.id)) throw conflict();
    if (!lookup) throw notFound();
    let suggestion;
    try {
      suggestion = await lookup(code);
    } catch (e) {
      if (e instanceof LookupError) throw new HttpError(502, e.message);
      throw e;
    }
    if (!suggestion) throw notFound();
    res.json(suggestion);
  });

  // Mehrere Produkte auf einmal anlegen: { products: [...] } (gleiche Felder wie POST /).
  // Jedes Produkt wird einzeln geprüft; ungültige oder schon vorhandene blockieren die übrigen nicht.
  // Antwort: { results: [{ barcode, status: 'created' | 'exists' | 'invalid', product?, error? }] } in Eingabereihenfolge.
  r.post('/batch', (req, res) => {
    const { products } = body(req);
    if (!Array.isArray(products) || !products.length) throw bad('products must be a non-empty array');
    if (products.length > MAX_BATCH) throw bad(`at most ${MAX_BATCH} products per request`);
    const insert = db.prepare(
      `INSERT INTO products (user_id, barcode, name, brand, kcal_100, protein_100, carbs_100, fat_100, serving_g)
       VALUES (@user_id, @barcode, @name, @brand, @kcal_100, @protein_100, @carbs_100, @fat_100, @serving_g)`,
    );
    const results = [];
    db.exec('BEGIN');
    try {
      for (const item of products) {
        const shown = typeof item?.barcode === 'string' || typeof item?.barcode === 'number' ? String(item.barcode) : null;
        let p;
        try {
          p = parse(item && typeof item === 'object' ? item : {});
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
          results.push({ barcode: shown, status: 'invalid', error: e.message });
          continue;
        }
        const existing = byBarcode(p.barcode, req.user.id);
        if (existing) {
          results.push({ barcode: p.barcode, status: 'exists', product: existing });
          continue;
        }
        const { lastInsertRowid } = insert.run({ ...p, user_id: req.user.id });
        results.push({ barcode: p.barcode, status: 'created', product: db.prepare('SELECT * FROM products WHERE id = ?').get(lastInsertRowid) });
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json({ results });
  });

  r.get('/:id', (req, res) => {
    const row = byId(parseId(req.params.id), req.user.id);
    if (!row) throw notFound();
    res.json(row);
  });

  r.post('/', (req, res) => {
    const p = parse(body(req));
    if (byBarcode(p.barcode, req.user.id)) throw conflict();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO products (user_id, barcode, name, brand, kcal_100, protein_100, carbs_100, fat_100, serving_g)
         VALUES (@user_id, @barcode, @name, @brand, @kcal_100, @protein_100, @carbs_100, @fat_100, @serving_g)`,
      )
      .run({ ...p, user_id: req.user.id });
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(lastInsertRowid));
  });

  r.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const p = parse(body(req));
    const other = byBarcode(p.barcode, req.user.id);
    if (other && other.id !== id) throw conflict();
    const { changes } = db
      .prepare(
        `UPDATE products SET barcode=@barcode, name=@name, brand=@brand, kcal_100=@kcal_100, protein_100=@protein_100,
           carbs_100=@carbs_100, fat_100=@fat_100, serving_g=@serving_g WHERE id=@id AND user_id=@user_id`,
      )
      .run({ ...p, id, user_id: req.user.id });
    if (!changes) throw notFound();
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  });

  r.delete('/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM products WHERE id = ? AND user_id = ?').run(parseId(req.params.id), req.user.id);
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return r;
}
