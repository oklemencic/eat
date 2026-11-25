import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA, openDb } from '../db.js';
import { createApp } from '../app.js';

// Eine Datenbank aus der Einzelnutzer-Zeit (user_version 2) wird übernommen: nichts geht verloren,
// und der erste Benutzer erhält alle vorhandenen Daten.
test('Migration einer Einzelnutzer-Datenbank: Daten bleiben erhalten und gehören dem ersten Benutzer', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'eat-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'eat.db'));
    old.exec(SCHEMA);
    old.exec(`
      INSERT INTO dishes (id, name, kcal) VALUES (1, 'Altes Gericht', 500);
      INSERT INTO meal_entries (id, eaten_at, date, dish_id, name, kcal) VALUES (1, '2026-01-01T12:00', '2026-01-01', 1, 'Altes Gericht', 500);
      INSERT INTO workouts (id, date, category, duration_min) VALUES (1, '2026-01-02', 'Laufen', 30);
      INSERT INTO workout_sets (workout_id, exercise, sets, reps) VALUES (1, 'Kniebeuge', 3, 5);
      INSERT INTO weights (id, date, kg) VALUES (1, '2026-01-01', 70);
      INSERT INTO settings (key, value) VALUES ('kcal_goal', '3100');
      PRAGMA user_version = 2;
    `);
    old.close();

    // Migration beim Öffnen
    const db = openDb(dataDir);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meal_entries').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workout_sets').get().n, 1);
    db.close();

    // Einrichtung über die API: der erste Benutzer bekommt die Altdaten
    const password = randomBytes(12).toString('hex');
    const { app, db: appDb } = createApp({
      dataDir, clientDir: path.join(dataDir, 'none'), sessionSecret: randomBytes(32).toString('hex'),
      sessionDays: 1, cookieSecure: false, trustProxy: false,
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const setup = await fetch(`${base}/api/setup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'oliver', password }),
      });
      assert.equal(setup.status, 201);
      const cookie = setup.headers.getSetCookie()[0].split(';')[0];
      const get = async (url) => (await fetch(base + url, { headers: { cookie } })).json();

      assert.deepEqual((await get('/api/dishes')).map((d) => d.name), ['Altes Gericht']);
      assert.equal((await get('/api/meals?date=2026-01-01')).entries.length, 1);
      assert.equal((await get('/api/workouts'))[0].sets.length, 1);
      assert.equal((await get('/api/weights')).entries[0].kg, 70);
      assert.equal((await get('/api/settings')).kcal_goal, 3100);
    } finally {
      server.close();
      appDb.close();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// Ohne SESSION_SECRET: Schlüssel entsteht beim ersten Start, bleibt über Neustarts gleich und Sessions gelten weiter
test('Signaturschlüssel aus der Datenbank: stabil über Neustarts, Sessions überleben', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'eat-secret-'));
  const config = { dataDir, clientDir: path.join(dataDir, 'none'), sessionSecret: '', sessionDays: 1, cookieSecure: false, trustProxy: false };
  const start = async () => {
    const { app, db } = createApp(config);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    return { db, server, base: `http://127.0.0.1:${server.address().port}` };
  };
  try {
    let run = await start();
    const secret1 = run.db.prepare("SELECT value FROM app_meta WHERE key = 'session_secret'").get().value;
    assert.ok(secret1.length >= 32);
    const setup = await fetch(`${run.base}/api/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'oliver', password: randomBytes(12).toString('hex') }),
    });
    const cookie = setup.headers.getSetCookie()[0].split(';')[0];
    run.server.close();
    run.db.close();

    run = await start();
    assert.equal(run.db.prepare("SELECT value FROM app_meta WHERE key = 'session_secret'").get().value, secret1);
    const session = await (await fetch(`${run.base}/api/session`, { headers: { cookie } })).json();
    assert.equal(session.authenticated, true);
    // Der Schlüssel ist nicht Teil des Exports
    const exp = await (await fetch(`${run.base}/api/export`, { headers: { cookie } })).text();
    assert.ok(!exp.includes(secret1));
    run.server.close();
    run.db.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
