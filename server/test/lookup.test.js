import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookup, toSuggestion, offCode, LookupError } from '../lookup.js';

const reply = (status, json) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => json });

test('offCode füllt auf die Stellenzahl auf, die Open Food Facts führt', () => {
  assert.equal(offCode('36000291452'), '0036000291452'); // UPC-A ohne führende Nullen
  assert.equal(offCode('9010158017486'), '9010158017486');
  assert.equal(offCode('4001234'), '04001234'); // EAN-8
  assert.equal(offCode('12345678901234'), '12345678901234');
});

test('toSuggestion: Namen, kJ-Umrechnung, unplausible Werte werden verworfen', () => {
  const s = toSuggestion('1', {
    product_name: 'Müsli', product_name_de: ' Hafer-Müsli ', brands: 'Billa, Clever',
    nutriments: { 'energy_100g': 1833, proteins_100g: '9.46', carbohydrates_100g: 61, fat_100g: 150 },
    serving_quantity: '40',
  });
  assert.equal(s.name, 'Hafer-Müsli');
  assert.equal(s.brand, 'Billa');
  assert.equal(s.kcal_100, 438.1); // 1833 kJ / 4,184
  assert.equal(s.protein_100, 9.5);
  assert.equal(s.fat_100, null); // > 100 g pro 100 g
  assert.equal(s.serving_g, 40);
  const empty = toSuggestion('1', {});
  assert.deepEqual([empty.name, empty.brand, empty.kcal_100, empty.serving_g], [null, null, null, null]);
});

test('createLookup: Treffer, unbekannt, Dienstfehler, Cache', async () => {
  let calls = 0;
  const urls = [];
  const fetchImpl = async (url, init) => {
    calls += 1;
    urls.push(url);
    assert.ok(!/@|\bmail\b/i.test(init.headers['User-Agent']), 'User-Agent ist generisch');
    if (url.includes('/0036000291452')) {
      return reply(200, { status: 'success', product: { product_name: 'Riegel', nutriments: { 'energy-kcal_100g': 450 } } })();
    }
    if (url.includes('/9999999999999')) return reply(404, { status: 'failure' })();
    return reply(503, {})();
  };
  let t = 0;
  const lookup = createLookup({ fetchImpl, now: () => t });

  const hit = await lookup('36000291452');
  assert.equal(hit.name, 'Riegel');
  assert.equal(hit.barcode, '36000291452');
  assert.equal(hit.kcal_100, 450);
  assert.ok(urls[0].startsWith('https://world.openfoodfacts.org/api/v3/product/0036000291452?'));
  await lookup('36000291452');
  assert.equal(calls, 1, 'zweiter Aufruf kommt aus dem Cache');
  t += 61 * 60 * 1000;
  await lookup('36000291452');
  assert.equal(calls, 2, 'Cache läuft ab');

  assert.equal(await lookup('9999999999999'), null);
  await lookup('9999999999999');
  assert.equal(calls, 3, 'auch "unbekannt" wird kurz gemerkt');

  await assert.rejects(lookup('1111111111111'), LookupError);
  await assert.rejects(lookup('1111111111111'), LookupError);
  assert.equal(calls, 5, 'Fehler werden nicht zwischengespeichert');

  const down = createLookup({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down('1111111111111'), LookupError);
});
