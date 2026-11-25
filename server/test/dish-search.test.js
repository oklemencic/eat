import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDishSearch, toDish } from '../dish-search.js';
import { LookupError } from '../lookup.js';

const sug = (over = {}) => ({ barcode: '1', name: 'Lasagne', brand: 'Billa', kcal_100: 150, protein_100: 7, carbs_100: 14.04, fat_100: 7.5, serving_g: null, source: 'openfoodfacts', ...over });
const reply = (data, status = 200) => async () => ({ status, ok: status < 300, json: async () => data });

test('toDish: Portionsgröße bekannt -> Werte pro Portion, sonst pro 100 g; ohne kcal unbrauchbar', () => {
  const portion = toDish(sug({ serving_g: 400 }));
  assert.deepEqual([portion.basis, portion.serving_g, portion.kcal, portion.protein, portion.carbs, portion.fat], ['portion', 400, 600, 28, 56.2, 30]);
  const per100 = toDish(sug());
  assert.deepEqual([per100.basis, per100.serving_g, per100.kcal, per100.carbs], ['100g', null, 150, 14]);
  assert.equal(toDish(sug({ kcal_100: null })), null);
  assert.equal(toDish(sug({ name: null })), null);
  assert.equal(toDish(null), null);
  assert.equal(toDish(sug({ protein_100: null })).protein, null, 'fehlende Werte bleiben null');
});

test('search: Treffer nachschlagen, Unbrauchbares und Doppelte weglassen, Cache', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    assert.ok(!/@/.test(init.headers['User-Agent']), 'User-Agent ist generisch');
    return reply({ hits: [{ code: '1001' }, { code: '1002' }, { code: '1003' }, { code: '1004' }, { code: 'evil/../x' }, { code: '1001' }] })();
  };
  const looked = [];
  const lookup = async (code) => {
    looked.push(code);
    if (code === '1001') return sug({ barcode: code, serving_g: 400 });
    if (code === '1002') return sug({ barcode: code, kcal_100: null }); // keine Nährwerte
    if (code === '1003') return sug({ barcode: code, serving_g: 400 }); // gleiches Produkt nochmal
    if (code === '1004') throw new LookupError('Fehler'); // einzelner Ausfall zählt nicht
    return null;
  };
  let t = 0;
  const search = createDishSearch({ lookup, fetchImpl, now: () => t });

  const res = await search('  Lasagne ');
  assert.equal(res.length, 1);
  assert.equal(res[0].kcal, 600);
  assert.deepEqual(looked, ['1001', '1002', '1003', '1004'], 'ungültige Codes und Doppelte werden nicht abgefragt');
  const u = new URL(urls[0]);
  assert.equal(u.origin, 'https://search.openfoodfacts.org');
  assert.equal(u.searchParams.get('q'), 'Lasagne');

  await search('lasagne');
  assert.equal(urls.length, 1, 'zweite Suche kommt aus dem Cache');
  t += 61 * 60 * 1000;
  await search('lasagne');
  assert.equal(urls.length, 2, 'Cache läuft ab');

  assert.deepEqual(await search('   '), []);
  assert.equal(urls.length, 2, 'leere Suche ruft nichts ab');
});

test('search: Dienstfehler werden gemeldet, "keine Treffer" nicht', async () => {
  const lookup = async () => sug();
  await assert.rejects(createDishSearch({ lookup, fetchImpl: reply({}, 503) })('x'), LookupError);
  await assert.rejects(createDishSearch({ lookup, fetchImpl: async () => { throw new Error('offline'); } })('x'), LookupError);
  assert.deepEqual(await createDishSearch({ lookup, fetchImpl: reply({ hits: [] }) })('x'), []);
  const down = async () => { throw new LookupError('Produktdatenbank nicht erreichbar'); };
  await assert.rejects(createDishSearch({ lookup: down, fetchImpl: reply({ hits: [{ code: '1001' }, { code: '1002' }] }) })('x'), LookupError, 'alle Nachschlagungen fallen aus');
});

test('search: Sperre (429) beendet die Nachschlagung, Teilergebnis wird nicht zwischengespeichert', async () => {
  const hits = Array.from({ length: 9 }, (_, i) => ({ code: String(3000 + i) }));
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; return reply({ hits })(); };
  const looked = [];
  const lookup = async (code) => {
    looked.push(code);
    if (code === '3000') return sug({ barcode: code });
    throw new LookupError('Produktdatenbank antwortet mit Fehler 429', 429);
  };
  const search = createDishSearch({ lookup, fetchImpl });
  const res = await search('x');
  assert.equal(res.length, 1, 'Bisheriges wird geliefert');
  assert.equal(looked.length, 3, 'nach der ersten Gruppe mit Sperre wird nicht weiter abgefragt');
  await search('x');
  assert.equal(fetches, 2, 'Teilergebnis nach Sperre wird nicht zwischengespeichert');

  const allLimited = createDishSearch({ lookup: async () => { throw new LookupError('429', 429); }, fetchImpl });
  await assert.rejects(allLimited('y'), /Zu viele Anfragen/);
});

test('search: höchstens 8 Vorschläge', async () => {
  const hits = Array.from({ length: 12 }, (_, i) => ({ code: String(2000 + i) }));
  const lookup = async (code) => sug({ barcode: code, name: `Gericht ${code}` });
  const res = await createDishSearch({ lookup, fetchImpl: reply({ hits }) })('gericht');
  assert.equal(res.length, 8);
});
