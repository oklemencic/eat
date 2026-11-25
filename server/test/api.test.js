import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { LookupError } from '../lookup.js';

// Zugangsdaten entstehen zur Laufzeit und werden nirgends gespeichert.
const password = randomBytes(12).toString('hex');
const username = 'alice';
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'eat-test-'));
const config = {
  dataDir,
  clientDir: path.join(dataDir, 'no-client'),
  sessionSecret: randomBytes(32).toString('hex'),
  sessionDays: 1,
  cookieSecure: false,
  trustProxy: false,
  // Keine echten Abfragen im Test: Open Food Facts wird ersetzt
  productLookup: async (code) => {
    if (code === '9010158017486') return { barcode: code, name: 'Hafer-Müsli', brand: 'Billa', kcal_100: 437, protein_100: 9, carbs_100: 61, fat_100: 15, serving_g: null, source: 'openfoodfacts' };
    if (code === '1111111') throw new LookupError('Produktdatenbank nicht erreichbar');
    return null;
  },
};

let server;
let base;
let db;
let cookie = '';

before(async () => {
  const created = createApp(config);
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function api(method, url, payload, { headers = {}, raw, auth = true } = {}) {
  const h = { ...headers };
  if (auth && cookie) h.cookie = cookie;
  let data;
  if (raw !== undefined) data = raw;
  else if (payload !== undefined) {
    h['content-type'] = 'application/json';
    data = JSON.stringify(payload);
  }
  const res = await fetch(base + url, { method, headers: h, body: data });
  const type = res.headers.get('content-type') ?? '';
  const parsed = type.includes('json') ? await res.json() : type.startsWith('text/') ? await res.text() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: parsed, res };
}

test('Zugriff ohne Login wird abgewiesen, Healthcheck und Session-Status sind offen', async () => {
  assert.equal((await api('GET', '/healthz', undefined, { auth: false })).status, 200);
  assert.equal((await api('GET', '/api/session', undefined, { auth: false })).body.authenticated, false);
  for (const url of ['/api/dishes', '/api/products', '/api/meals?date=2026-01-01', '/api/export', '/photos/x', '/api/users']) {
    assert.equal((await api('GET', url, undefined, { auth: false })).status, 401, url);
  }
  assert.equal((await api('POST', '/api/import?confirm=replace', {}, { auth: false })).status, 401);
});

test('Erster Start: ohne Benutzer ist die Einrichtung offen, Anmeldung nicht möglich', async () => {
  const s = (await api('GET', '/api/session', undefined, { auth: false })).body;
  assert.deepEqual(s, { authenticated: false, setup_required: true, user: null });
  assert.equal((await api('POST', '/api/login', { username, password }, { auth: false })).status, 401);
  // Beispielgerichte aus der Migration gehören noch niemandem
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM dishes WHERE user_id IS NULL').get().n >= 5);
});

test('Einrichtung: Eingaben werden geprüft, der erste Benutzer wird Administrator und angemeldet', async () => {
  const bad = (payload) => api('POST', '/api/setup', payload, { auth: false });
  assert.equal((await bad({ username: 'a', password })).status, 400);
  assert.equal((await bad({ username: 'mit leerzeichen', password })).status, 400);
  assert.equal((await bad({ username, password: 'kurz' })).status, 400);
  assert.equal((await bad({ username })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);

  const { status, body, res } = await bad({ username, password });
  assert.equal(status, 201);
  assert.equal(body.user.username, username);
  assert.equal(body.user.is_admin, true);
  assert.equal('password_hash' in body.user, false);
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await api('GET', '/api/session')).body.authenticated, true);

  // Das Passwort liegt nur als Hash in der Datenbank
  const row = db.prepare('SELECT password_hash FROM users').get();
  assert.match(row.password_hash, /^scrypt:/);
  assert.ok(!row.password_hash.includes(password));

  // Vorhandene Daten gehören jetzt dem ersten Benutzer; danach ist die Einrichtung gesperrt
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dishes WHERE user_id IS NULL').get().n, 0);
  assert.equal((await bad({ username: 'mallory', password })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('Login: falsches Passwort und unbekannter Benutzer 401, richtiges setzt HttpOnly-Cookie', async () => {
  assert.equal((await api('POST', '/api/login', { username, password: 'falsch' }, { auth: false })).status, 401);
  assert.equal((await api('POST', '/api/login', { username: 'unbekannt', password }, { auth: false })).status, 401);
  assert.equal((await api('POST', '/api/login', { password }, { auth: false })).status, 401);

  // Groß-/Kleinschreibung des Namens ist egal
  const { status, res, body } = await api('POST', '/api/login', { username: 'ALICE', password }, { auth: false });
  assert.equal(status, 200);
  assert.equal(body.user.username, username);
  const setCookie = res.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  cookie = setCookie.split(';')[0];
  assert.equal((await api('GET', '/api/session')).body.authenticated, true);
});

test('manipuliertes Session-Cookie wird abgewiesen', async () => {
  const forged = `${cookie.slice(0, -2)}xx`;
  const res = await fetch(`${base}/api/dishes`, { headers: { cookie: forged } });
  assert.equal(res.status, 401);
});

test('Gerichte: Startdaten, Anlegen, Ändern, Favoriten, Löschen', async () => {
  const list = await api('GET', '/api/dishes');
  assert.ok(list.body.length >= 5);

  const created = await api('POST', '/api/dishes', { name: 'Testgericht', kcal: 500, protein: 30, favorite: true });
  assert.equal(created.status, 201);
  assert.equal(created.body.favorite, true);

  const favs = await api('GET', '/api/dishes?favorite=1');
  assert.deepEqual(favs.body.map((d) => d.name), ['Testgericht']);
  assert.equal((await api('GET', '/api/dishes?q=testgeri')).body.length, 1);

  const put = await api('PUT', `/api/dishes/${created.body.id}`, { name: 'Neu', kcal: 600, protein: 31 });
  assert.equal(put.body.name, 'Neu');
  assert.equal(put.body.favorite, false);

  assert.equal((await api('POST', '/api/dishes', { name: 'x', kcal: -1 })).status, 400);
  assert.equal((await api('POST', '/api/dishes', { kcal: 5 })).status, 400);
  assert.equal((await api('GET', '/api/dishes/99999')).status, 404);
  assert.equal((await api('DELETE', `/api/dishes/${created.body.id}`)).status, 204);
  assert.equal((await api('DELETE', `/api/dishes/${created.body.id}`)).status, 404);
});

test('Produkte: Barcode-Suche, Normalisierung, Eindeutigkeit, Validierung', async () => {
  assert.equal((await api('GET', '/api/products/barcode/4006381333931')).status, 404);
  const body = { barcode: '036000291452', name: 'Testriegel', brand: 'Marke', kcal_100: 450, protein_100: 20, carbs_100: 50, fat_100: 15, serving_g: 40 };
  const created = await api('POST', '/api/products', body);
  assert.equal(created.status, 201);
  assert.equal(created.body.barcode, '36000291452');

  // UPC-A und derselbe Code als EAN-13 (führende 0) sind dasselbe Produkt
  for (const code of ['036000291452', '0036000291452']) {
    const found = await api('GET', `/api/products/barcode/${code}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);
  }
  assert.equal((await api('POST', '/api/products', { ...body, barcode: '0036000291452' })).status, 409);
  assert.equal((await api('GET', '/api/products?q=riegel')).body.length, 1);

  for (const bad of [{ barcode: 'abc' }, { barcode: '123' }, { name: '' }, { kcal_100: -1 }, { kcal_100: undefined }, { protein_100: 101 }]) {
    assert.equal((await api('POST', '/api/products', { ...body, barcode: '4006381333931', ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api('GET', '/api/products/barcode/abc')).status, 400);

  const put = await api('PUT', `/api/products/${created.body.id}`, { ...body, name: 'Neu', kcal_100: 460 });
  assert.equal(put.body.name, 'Neu');
  assert.equal(put.body.kcal_100, 460);

  // Export enthält Produkte, Import stellt sie wieder her
  const exp = await api('GET', '/api/export');
  assert.equal(exp.body.tables.products.length, 1);
  assert.ok(!('user_id' in exp.body.tables.products[0]));

  assert.equal((await api('DELETE', `/api/products/${created.body.id}`)).status, 204);
  assert.equal((await api('DELETE', `/api/products/${created.body.id}`)).status, 404);
  assert.equal((await api('GET', '/api/products')).body.length, 0);
});

test('Produkte: Vorschlag aus der Produktdatenbank (Fallback)', async () => {
  const hit = await api('GET', '/api/products/lookup/9010158017486');
  assert.equal(hit.status, 200);
  assert.equal(hit.body.name, 'Hafer-Müsli');
  assert.equal((await api('GET', '/api/products/lookup/4006381333931')).status, 404);
  const down = await api('GET', '/api/products/lookup/1111111');
  assert.equal(down.status, 502);
  assert.match(down.body.error, /nicht erreichbar/);
  assert.equal((await api('GET', '/api/products/lookup/abc')).status, 400);
  assert.equal((await api('GET', '/api/products/lookup/9010158017486', undefined, { auth: false })).status, 401);
  // Der Vorschlag wird nicht gespeichert
  assert.equal((await api('GET', '/api/products/barcode/9010158017486')).status, 404);

  // Schon registrierte Barcodes werden nicht erneut vorgeschlagen
  const saved = await api('POST', '/api/products', { barcode: '9010158017486', name: 'Müsli', kcal_100: 437 });
  assert.equal(saved.status, 201);
  assert.equal((await api('GET', '/api/products/lookup/9010158017486')).status, 409);
  await api('DELETE', `/api/products/${saved.body.id}`);
});

test('Produkte: Batch-Registrierung legt gültige an und meldet Rest einzeln', async () => {
  const ok = { barcode: '9010158017486', name: 'Hafer-Müsli', kcal_100: 437, protein_100: 9 };
  const res = await api('POST', '/api/products/batch', {
    products: [
      ok,
      { ...ok, barcode: '09010158017486' }, // gleicher Code mit führender 0: im selben Aufruf schon angelegt
      { barcode: '4006381333931', name: 'Ohne Kalorien' },
      { barcode: 'abc', name: 'Kaputt', kcal_100: 1 },
      null,
      { barcode: '036000291452', name: 'Riegel', kcal_100: 450 },
    ],
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.results.map((r) => r.status), ['created', 'exists', 'invalid', 'invalid', 'invalid', 'created']);
  assert.equal((await api('GET', '/api/products')).body.length, 2);
  // Wiederholung ist unschädlich
  const again = await api('POST', '/api/products/batch', { products: [ok] });
  assert.equal(again.body.results[0].status, 'exists');

  assert.equal((await api('POST', '/api/products/batch', { products: [] })).status, 400);
  assert.equal((await api('POST', '/api/products/batch', {})).status, 400);
  const many = Array.from({ length: 101 }, (_, i) => ({ barcode: String(100000 + i), name: 'x', kcal_100: 1 }));
  assert.equal((await api('POST', '/api/products/batch', { products: many })).status, 400);

  for (const p of (await api('GET', '/api/products')).body) await api('DELETE', `/api/products/${p.id}`);
});

test('Essens-Einträge: Werte vom Gericht, Portionsfaktor, Tagessumme, Zuletzt gegessen', async () => {
  const dish = (await api('POST', '/api/dishes', { name: 'Reis', kcal: 400, protein: 10, carbs: 80 })).body;

  const e1 = await api('POST', '/api/meals', { dish_id: dish.id, portion: 1.5, eaten_at: '2026-03-10T12:30' });
  assert.equal(e1.status, 201);
  assert.equal(e1.body.kcal, 400);
  assert.equal(e1.body.kcal_total, 600);
  assert.equal(e1.body.protein_total, 15);
  assert.equal(e1.body.date, '2026-03-10');

  // Kalorien pro Eintrag überschreibbar
  const e2 = await api('POST', '/api/meals', { dish_id: dish.id, kcal: 300, eaten_at: '2026-03-10T18:00' });
  assert.equal(e2.body.kcal_total, 300);
  // Freier Eintrag ohne Gericht
  const e3 = await api('POST', '/api/meals', { name: 'Eis', kcal: 250, eaten_at: '2026-03-11T15:00' });
  assert.equal(e3.body.dish_id, null);

  const day = await api('GET', '/api/meals?date=2026-03-10');
  assert.equal(day.body.entries.length, 2);
  assert.equal(day.body.totals.kcal, 900);
  assert.equal(day.body.totals.protein, 25);

  const range = await api('GET', '/api/meals?from=2026-03-10&to=2026-03-11');
  assert.equal(range.body.entries.length, 3);

  const recent = await api('GET', '/api/dishes/recent');
  assert.equal(recent.body[0].id, dish.id);

  assert.equal((await api('GET', '/api/meals')).status, 400);
  assert.equal((await api('GET', '/api/meals?date=2026-02-31')).status, 400);
  assert.equal((await api('POST', '/api/meals', { name: 'x', kcal: 1, portion: 0 })).status, 400);
  assert.equal((await api('POST', '/api/meals', { dish_id: 99999 })).status, 400);

  const upd = await api('PUT', `/api/meals/${e3.body.id}`, { name: 'Eis', kcal: 275, eaten_at: '2026-03-11T15:00', note: 'lecker' });
  assert.equal(upd.body.kcal, 275);

  // Gericht löschen: Eintrag bleibt erhalten
  await api('DELETE', `/api/dishes/${dish.id}`);
  const after = await api('GET', `/api/meals/${e1.body.id}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.dish_id, null);
  assert.equal((await api('DELETE', `/api/meals/${e3.body.id}`)).status, 204);
});

test('Gewicht: Tageswert überschreiben, 7-Tage-Schnitt, Trend', async () => {
  // 3 Wochen mit ca. 0,4 kg Zunahme pro Woche
  const start = Date.parse('2026-04-01T00:00:00Z');
  for (let i = 0; i < 22; i++) {
    const date = new Date(start + i * 864e5).toISOString().slice(0, 10);
    const kg = 70 + (i * 0.4) / 7;
    assert.equal((await api('POST', '/api/weights', { date, kg: Math.round(kg * 100) / 100 })).status, 201);
  }
  await api('POST', '/api/weights', { date: '2026-04-01', kg: 70 });
  const all = await api('GET', '/api/weights');
  assert.equal(all.body.entries.length, 22);
  assert.ok(all.body.entries.every((e) => typeof e.avg7 === 'number'));
  assert.equal(all.body.trend.status, 'on_track');
  assert.ok(Math.abs(all.body.trend.kg_per_week - 0.4) < 0.05);

  const slice = await api('GET', '/api/weights?from=2026-04-20&to=2026-04-22');
  assert.equal(slice.body.entries.length, 3);

  assert.equal((await api('POST', '/api/weights', { date: '2026-04-01', kg: 5 })).status, 400);
  assert.equal((await api('POST', '/api/weights', { date: 'gestern', kg: 70 })).status, 400);
  const id = all.body.entries[0].id;
  assert.equal((await api('DELETE', `/api/weights/${id}`)).status, 204);
});

test('Sport: Training mit Sätzen, Ersetzen, Bestleistungen', async () => {
  const w1 = await api('POST', '/api/workouts', {
    date: '2026-04-02', category: 'Krafttraining', duration_min: 60,
    sets: [
      { exercise: 'Bankdrücken', sets: 3, reps: 8, weight_kg: 60 },
      { exercise: 'Kniebeuge', sets: 3, reps: 5, weight_kg: 80 },
    ],
  });
  assert.equal(w1.status, 201);
  assert.equal(w1.body.sets.length, 2);

  await api('POST', '/api/workouts', {
    date: '2026-04-09', category: 'Krafttraining', duration_min: 55,
    sets: [{ exercise: 'Bankdrücken', sets: 3, reps: 6, weight_kg: 65 }],
  });
  await api('POST', '/api/workouts', { date: '2026-04-10', category: 'Laufen', duration_min: 30 });

  const records = (await api('GET', '/api/workouts/records')).body;
  const bench = records.find((r) => r.exercise === 'Bankdrücken');
  assert.equal(bench.weight_kg, 65);
  assert.equal(bench.date, '2026-04-09');

  const put = await api('PUT', `/api/workouts/${w1.body.id}`, {
    date: '2026-04-02', category: 'Krafttraining', duration_min: 70,
    sets: [{ exercise: 'Kniebeuge', sets: 4, reps: 5, weight_kg: 85 }],
  });
  assert.equal(put.body.sets.length, 1);
  assert.equal(put.body.duration_min, 70);

  const list = await api('GET', '/api/workouts?from=2026-04-09&to=2026-04-30');
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].date, '2026-04-10');

  assert.equal((await api('POST', '/api/workouts', { date: '2026-04-02', category: 'x', duration_min: 0 })).status, 400);
  assert.equal((await api('PUT', '/api/workouts/99999', { date: '2026-04-02', category: 'x', duration_min: 5 })).status, 404);
  assert.equal((await api('DELETE', `/api/workouts/${w1.body.id}`)).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id = ?').get(w1.body.id).n, 0);
});

test('Einstellungen: Defaults, Teil-Update, Validierung', async () => {
  const s = await api('GET', '/api/settings');
  assert.equal(s.body.kcal_goal, 3000);
  const put = await api('PUT', '/api/settings', { kcal_goal: 3200, target_weight: 80 });
  assert.equal(put.body.kcal_goal, 3200);
  assert.equal(put.body.target_weight, 80);
  assert.equal(put.body.protein_goal, 140);
  assert.equal((await api('PUT', '/api/settings', { kcal_goal: 5 })).status, 400);
  assert.equal((await api('PUT', '/api/settings', { unbekannt: 1 })).status, 400);
});

test('Wochenstatistik', async () => {
  const s = (await api('GET', '/api/stats/week?end=2026-03-11')).body;
  assert.equal(s.start, '2026-03-05');
  assert.equal(s.days.length, 7);
  // Nur der 10.03. hat Einträge (600 + 300 kcal, 15 + 10 g Protein); der 11.03. wurde wieder gelöscht
  assert.equal(s.days_logged, 1);
  assert.equal(s.avg_kcal, 900);
  assert.equal(s.avg_protein, 25);
  assert.equal(s.training_days, 0);
  // 04.-10.04.: Trainings am 09. und 10.04. (das vom 02.04. liegt außerhalb und ist gelöscht)
  const w = (await api('GET', '/api/stats/week?end=2026-04-10')).body;
  assert.equal(w.training_days, 2);
  assert.ok(w.weight && typeof w.weight.change === 'number');
  assert.equal((await api('GET', '/api/stats/week?end=morgen')).status, 400);
});

// 1x1-PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('Fotos: Upload, Abruf, Typprüfung, Verknüpfung', async () => {
  const up = await api('POST', '/api/photos', undefined, { headers: { 'content-type': 'image/png' }, raw: PNG });
  assert.equal(up.status, 201);
  assert.match(up.body.url, /^\/photos\//);
  assert.equal(readdirSync(path.join(dataDir, 'photos')).length, 1);

  const get = await api('GET', up.body.url);
  assert.equal(get.status, 200);
  assert.equal(get.res.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.compare(get.body, PNG) === 0);

  const fake = await api('POST', '/api/photos', undefined, { headers: { 'content-type': 'image/png' }, raw: Buffer.from('kein bild') });
  assert.equal(fake.status, 400);
  const wrong = await api('POST', '/api/photos', undefined, { headers: { 'content-type': 'text/html' }, raw: '<script>' });
  assert.equal(wrong.status, 415);

  const meal = await api('POST', '/api/meals', { name: 'Mit Foto', kcal: 100, photo_id: up.body.id });
  assert.equal(meal.body.photo_id, up.body.id);
  assert.equal((await api('POST', '/api/meals', { name: 'x', kcal: 1, photo_id: 'nope' })).status, 400);
  assert.equal((await api('GET', '/photos/..%2F..%2Fetc%2Fpasswd')).status, 404);
});

test('Export/Import: Rundreise und Ablehnung ungültiger Daten', async () => {
  const exp = await api('GET', '/api/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.body.app, 'eat');
  const meals = exp.body.tables.meal_entries.length;
  assert.ok(meals > 0);

  const csv = await api('GET', '/api/export?format=csv&table=dishes');
  assert.match(csv.body, /^id,name,category,kcal/);
  // fetch().text() entfernt das BOM, daher die rohen Bytes pr\u00FCfen (EF BB BF = UTF-8-BOM f\u00FCr Excel)
  const raw = Buffer.from(await (await fetch(`${base}/api/export?format=csv&table=dishes`, { headers: { cookie } })).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal((await api('GET', '/api/export?format=csv&table=sqlite_master')).status, 400);

  // Formel-Injection im CSV entschärfen
  await api('POST', '/api/dishes', { name: '=HYPERLINK("x")', kcal: 1 });
  const csv2 = await api('GET', '/api/export?format=csv&table=dishes');
  assert.ok(csv2.body.includes(`"'=HYPERLINK(""x"")"`));

  // Ohne Bestätigung kein Import
  assert.equal((await api('POST', '/api/import', exp.body)).status, 400);

  // Ungültiger Import (Verstoß gegen NOT NULL) lässt die Daten unverändert
  const broken = structuredClone(exp.body);
  broken.tables.dishes.push({ id: 9999 });
  assert.equal((await api('POST', '/api/import?confirm=replace', broken)).status, 400);
  assert.equal((await api('GET', '/api/export')).body.tables.meal_entries.length, meals);

  // Kaputte Fremdschlüssel werden abgelehnt
  const dangling = structuredClone(exp.body);
  dangling.tables.meal_entries[0].dish_id = 424242;
  assert.equal((await api('POST', '/api/import?confirm=replace', dangling)).status, 400);

  // Manipulierter Foto-Dateiname (Path Traversal) wird abgelehnt
  const evil = structuredClone(exp.body);
  evil.tables.photos[0].file = '../../etc/passwd';
  assert.equal((await api('POST', '/api/import?confirm=replace', evil)).status, 400);

  // Rundreise: leeren und wiederherstellen
  db.exec('DELETE FROM meal_entries');
  const ok = await api('POST', '/api/import?confirm=replace', exp.body);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.imported.meal_entries, meals);
  assert.equal((await api('GET', '/api/export')).body.tables.meal_entries.length, meals);
});

// Führt fn mit dem Session-Cookie eines anderen Benutzers aus
async function as(otherCookie, fn) {
  const saved = cookie;
  cookie = otherCookie;
  try {
    return await fn();
  } finally {
    cookie = saved;
  }
}

const bobPassword = randomBytes(12).toString('hex');
let bobCookie;
let bobId;

test('Benutzerverwaltung: nur Administratoren, Eingaben und Doppelte werden geprüft', async () => {
  assert.equal((await api('POST', '/api/users', { username: 'x', password: bobPassword })).status, 400);
  assert.equal((await api('POST', '/api/users', { username: 'bob', password: 'kurz' })).status, 400);
  const created = await api('POST', '/api/users', { username: 'bob', password: bobPassword });
  assert.equal(created.status, 201);
  assert.equal(created.body.is_admin, false);
  assert.equal('password_hash' in created.body, false);
  bobId = created.body.id;
  assert.equal((await api('POST', '/api/users', { username: 'BOB', password: bobPassword })).status, 409);

  const list = await api('GET', '/api/users');
  assert.deepEqual(list.body.map((u) => u.username), ['alice', 'bob']);

  const login = await api('POST', '/api/login', { username: 'bob', password: bobPassword }, { auth: false });
  assert.equal(login.status, 200);
  bobCookie = login.res.headers.getSetCookie()[0].split(';')[0];

  await as(bobCookie, async () => {
    assert.equal((await api('GET', '/api/users')).status, 403);
    assert.equal((await api('POST', '/api/users', { username: 'eve', password: bobPassword })).status, 403);
    assert.equal((await api('DELETE', '/api/users/1')).status, 403);
    assert.equal((await api('PUT', '/api/users/1/password', { password: bobPassword })).status, 403);
  });
});

test('Daten sind je Benutzer getrennt', async () => {
  const aliceDish = (await api('GET', '/api/dishes')).body[0];
  const aliceMeal = (await api('GET', '/api/meals?from=2026-01-01&to=2026-12-31')).body.entries[0];
  const aliceWeights = (await api('GET', '/api/weights')).body.entries;
  assert.ok(aliceMeal && aliceWeights.length > 0);
  const alicePhoto = db.prepare('SELECT id FROM photos').get().id;
  await api('PUT', '/api/settings', { kcal_goal: 3333 });

  await as(bobCookie, async () => {
    // Bob startet mit eigenen Beispielgerichten und sonst leer
    const dishes = (await api('GET', '/api/dishes')).body;
    assert.equal(dishes.length, 10);
    assert.ok(dishes.every((d) => d.id !== aliceDish.id));
    assert.ok(!dishes.some((d) => d.name === 'Testgericht'));
    assert.equal((await api('GET', '/api/meals?from=2026-01-01&to=2026-12-31')).body.entries.length, 0);
    assert.equal((await api('GET', '/api/weights')).body.entries.length, 0);
    assert.equal((await api('GET', '/api/workouts')).body.length, 0);
    assert.deepEqual((await api('GET', '/api/workouts/records')).body, []);
    assert.equal((await api('GET', '/api/settings')).body.kcal_goal, 3000);
    assert.equal((await api('GET', '/api/dishes/recent')).body.length, 0);
    assert.equal((await api('GET', '/api/stats/week?end=2026-03-11')).body.days_logged, 0);

    // Zugriff auf fremde Datensätze per ID: nicht gefunden
    assert.equal((await api('GET', `/api/meals/${aliceMeal.id}`)).status, 404);
    assert.equal((await api('PUT', `/api/meals/${aliceMeal.id}`, { name: 'x', kcal: 1 })).status, 404);
    assert.equal((await api('DELETE', `/api/meals/${aliceMeal.id}`)).status, 404);
    assert.equal((await api('GET', `/api/dishes/${aliceDish.id}`)).status, 404);
    assert.equal((await api('PUT', `/api/dishes/${aliceDish.id}`, { name: 'x', kcal: 1 })).status, 404);
    assert.equal((await api('DELETE', `/api/dishes/${aliceDish.id}`)).status, 404);
    assert.equal((await api('DELETE', `/api/weights/${aliceWeights[0].id}`)).status, 404);
    assert.equal((await api('GET', `/photos/${alicePhoto}`)).status, 404);

    // Fremde Gerichte und Fotos lassen sich nicht verknüpfen
    assert.equal((await api('POST', '/api/meals', { dish_id: aliceDish.id })).status, 400);
    assert.equal((await api('POST', '/api/meals', { name: 'x', kcal: 1, photo_id: alicePhoto })).status, 400);
    assert.equal((await api('POST', '/api/dishes', { name: 'x', kcal: 1, photo_id: alicePhoto })).status, 400);

    // Gleicher Tag, gleiche Einstellung: unabhängig vom anderen Benutzer
    assert.equal((await api('POST', '/api/weights', { date: aliceWeights[0].date, kg: 90 })).status, 201);
    assert.equal((await api('PUT', '/api/settings', { kcal_goal: 2500 })).body.kcal_goal, 2500);
    assert.equal((await api('POST', '/api/meals', { name: 'Bobs Essen', kcal: 111, eaten_at: '2026-03-10T08:00' })).status, 201);
    assert.equal((await api('POST', '/api/workouts', { date: '2026-04-09', category: 'Laufen', duration_min: 20 })).status, 201);
  });

  assert.equal((await api('GET', '/api/settings')).body.kcal_goal, 3333);
  assert.equal((await api('GET', '/api/weights')).body.entries.find((e) => e.date === aliceWeights[0].date).kg, aliceWeights[0].kg);
  const day = (await api('GET', '/api/meals?date=2026-03-10')).body.entries;
  assert.ok(day.length > 0 && day.every((e) => e.name !== 'Bobs Essen'));
  assert.ok(!(await api('GET', '/api/workouts')).body.some((w) => w.category === 'Laufen' && w.duration_min === 20));
});

test('Export und Import betreffen nur den eigenen Benutzer', async () => {
  const aliceBefore = (await api('GET', '/api/export')).body;
  const bobExport = await as(bobCookie, () => api('GET', '/api/export'));
  assert.equal(bobExport.body.tables.meal_entries.length, 1);
  assert.equal(bobExport.body.tables.meal_entries[0].name, 'Bobs Essen');
  assert.ok(Object.values(bobExport.body.tables).flat().every((row) => !('user_id' in row)));
  assert.equal(bobExport.body.tables.photos.length, 0);
  const bobCsv = await as(bobCookie, () => api('GET', '/api/export?format=csv&table=meal_entries'));
  assert.ok(!bobCsv.body.includes('user_id'));
  assert.ok(!bobCsv.body.includes('Mit Foto'));

  // Bob importiert Alices Export (IDs kollidieren mit Alices Zeilen): beide bleiben getrennt und heil
  const imp = await as(bobCookie, () => api('POST', '/api/import?confirm=replace', { ...aliceBefore, tables: { ...aliceBefore.tables, photos: [] }, }));
  // Alices Einträge verweisen auf ein Foto, das Bob nicht hat: abgelehnt, nichts verändert
  assert.equal(imp.status, 400);
  assert.equal((await as(bobCookie, () => api('GET', '/api/export'))).body.tables.meal_entries.length, 1);

  const withoutPhotoRefs = structuredClone(aliceBefore);
  withoutPhotoRefs.tables.photos = [];
  for (const t of ['dishes', 'meal_entries']) for (const row of withoutPhotoRefs.tables[t]) row.photo_id = null;
  const ok = await as(bobCookie, () => api('POST', '/api/import?confirm=replace', withoutPhotoRefs));
  assert.equal(ok.status, 200);
  const bobAfter = (await as(bobCookie, () => api('GET', '/api/export'))).body;
  assert.equal(bobAfter.tables.meal_entries.length, aliceBefore.tables.meal_entries.length);
  assert.equal(bobAfter.tables.dishes.length, aliceBefore.tables.dishes.length);
  // Verweise wurden auf neue IDs umgestellt und zeigen auf Bobs eigene Gerichte
  const bobDishIds = new Set(bobAfter.tables.dishes.map((d) => d.id));
  for (const m of bobAfter.tables.meal_entries) assert.ok(m.dish_id === null || bobDishIds.has(m.dish_id));
  const bobWorkoutIds = new Set(bobAfter.tables.workouts.map((w) => w.id));
  assert.ok(bobAfter.tables.workout_sets.every((x) => bobWorkoutIds.has(x.workout_id)));

  // Alice hat unverändert alles
  const aliceAfter = (await api('GET', '/api/export')).body;
  assert.deepEqual(aliceAfter.tables, aliceBefore.tables);

  // Ein Foto-Eintrag, dessen Datei zu einer anderen ID gehört, wird abgelehnt
  const stolen = structuredClone(withoutPhotoRefs);
  const [aliceFoto] = aliceBefore.tables.photos;
  stolen.tables.photos = [{ ...aliceFoto, id: '00000000-0000-4000-8000-000000000000' }];
  assert.equal((await as(bobCookie, () => api('POST', '/api/import?confirm=replace', stolen))).status, 400);
  // ... und ebenso die ID eines fremden Fotos
  stolen.tables.photos = [aliceFoto];
  assert.equal((await as(bobCookie, () => api('POST', '/api/import?confirm=replace', stolen))).status, 400);
  assert.equal((await as(bobCookie, () => api('GET', `/photos/${aliceFoto.id}`))).status, 404);
});

test('Passwortwechsel: altes Passwort nötig, Cookie wird erneuert, andere Sessions enden', async () => {
  const newPw = randomBytes(12).toString('hex');
  await as(bobCookie, async () => {
    assert.equal((await api('PUT', '/api/account/password', { current_password: 'falsch', new_password: newPw })).status, 403);
    assert.equal((await api('PUT', '/api/account/password', { current_password: bobPassword, new_password: 'kurz' })).status, 400);
    const res = await api('PUT', '/api/account/password', { current_password: bobPassword, new_password: newPw });
    assert.equal(res.status, 204);
    // Das alte Cookie ist ungültig, das neue gilt
    assert.equal((await api('GET', '/api/dishes')).status, 401);
    cookie = res.res.headers.getSetCookie()[0].split(';')[0];
    bobCookie = cookie;
    assert.equal((await api('GET', '/api/dishes')).status, 200);
  });
  assert.equal((await api('POST', '/api/login', { username: 'bob', password: bobPassword }, { auth: false })).status, 401);
  assert.equal((await api('POST', '/api/login', { username: 'bob', password: newPw }, { auth: false })).status, 200);

  // Administrator setzt ein Passwort zurück: Bobs Sessions enden
  const reset = randomBytes(12).toString('hex');
  assert.equal((await api('PUT', `/api/users/${bobId}/password`, { password: 'kurz' })).status, 400);
  assert.equal((await api('PUT', `/api/users/${bobId}/password`, { password: reset })).status, 204);
  assert.equal((await as(bobCookie, () => api('GET', '/api/dishes'))).status, 401);
  assert.equal((await api('PUT', '/api/users/99999/password', { password: reset })).status, 404);
  const login = await api('POST', '/api/login', { username: 'bob', password: reset }, { auth: false });
  assert.equal(login.status, 200);
  bobCookie = login.res.headers.getSetCookie()[0].split(';')[0];
});

test('Benutzer löschen: Daten und Session sind weg, sich selbst löschen geht nicht', async () => {
  const aliceId = (await api('GET', '/api/session')).body.user.id;
  assert.equal((await api('DELETE', `/api/users/${aliceId}`)).status, 400);
  assert.equal((await api('PUT', `/api/users/${aliceId}/password`, { password: bobPassword })).status, 400);

  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM meal_entries WHERE user_id = ?').get(bobId).n > 0);
  assert.equal((await api('DELETE', `/api/users/${bobId}`)).status, 204);
  assert.equal((await api('DELETE', `/api/users/${bobId}`)).status, 404);
  assert.equal((await as(bobCookie, () => api('GET', '/api/dishes'))).status, 401);
  for (const t of ['dishes', 'meal_entries', 'workouts', 'weights', 'settings']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(bobId).n, 0, t);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id NOT IN (SELECT id FROM workouts)').get().n, 0);
  assert.equal((await api('GET', '/api/session')).body.authenticated, true);
});

test('Fehlerbehandlung: ungültiges JSON, unbekannte Pfade', async () => {
  const res = await fetch(`${base}/api/dishes`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{kaputt',
  });
  assert.equal(res.status, 400);
  assert.equal((await api('GET', '/api/gibtsnicht')).status, 404);
  assert.equal((await api('POST', '/api/dishes', [1, 2])).status, 400);
});

test('Logout beendet die Session im Browser (Cookie wird gelöscht)', async () => {
  const { res } = await api('POST', '/api/logout');
  assert.match(res.headers.getSetCookie()[0], /eat_session=;/);
});
