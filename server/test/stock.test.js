import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStockSearch, StockError, fromPexels, fromPixabay, safeUrl, isImageUrl } from '../stock.js';

// Platzhalter-Keys für den Test (keine echten Zugangsdaten)
const KEYS = { pexelsKey: 'test-pexels', pixabayKey: 'test-pixabay' };

const json = (data, status = 200) => ({ status, ok: status < 300, json: async () => data, headers: new Headers() });

const pexelsData = {
  photos: [
    { url: 'https://www.pexels.com/photo/a-1/', photographer: 'Anna', src: { medium: 'https://images.pexels.com/photos/1/m.jpeg', large: 'https://images.pexels.com/photos/1/l.jpeg' } },
    { url: 'javascript:alert(1)', photographer: 'Evil', src: { medium: 'https://evil.example/m.jpeg', large: 'https://evil.example/l.jpeg' } },
  ],
};
const pixabayData = {
  hits: [
    { pageURL: 'https://pixabay.com/photos/x-2/', user: 'Bob', webformatURL: 'https://pixabay.com/get/w.jpg', largeImageURL: 'https://pixabay.com/get/l.jpg' },
    { pageURL: 'https://pixabay.com/photos/y-3/', user: 'Cy', webformatURL: 'https://cdn.pixabay.com/photo/w2.jpg', largeImageURL: 'https://cdn.pixabay.com/photo/l2.jpg' },
  ],
};

test('safeUrl: nur https auf erlaubten Hosts', () => {
  const hosts = ['images.pexels.com'];
  assert.ok(safeUrl('https://images.pexels.com/a.jpg', hosts));
  for (const bad of ['http://images.pexels.com/a.jpg', 'https://images.pexels.com.evil.example/a.jpg', 'https://user:pw@images.pexels.com/a.jpg',
    'https://images.pexels.com:8443/a.jpg', 'https://evil.example/a.jpg', 'javascript:alert(1)', 'nope', 42, null]) {
    assert.equal(safeUrl(bad, hosts), null, String(bad));
  }
  assert.ok(isImageUrl('pixabay', 'https://cdn.pixabay.com/x.jpg'));
  assert.ok(!isImageUrl('pixabay', 'https://images.pexels.com/x.jpg'), 'Host gehört zu einem anderen Anbieter');
  assert.ok(!isImageUrl('unbekannt', 'https://pixabay.com/x.jpg'));
});

test('Antworten werden gefiltert: fremde Hosts fallen weg, Links nur auf Anbieter-Seiten', () => {
  const p = fromPexels(pexelsData);
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].provider, p[0].author, p[0].page], ['pexels', 'Anna', 'https://www.pexels.com/photo/a-1/']);
  assert.equal(fromPixabay(pixabayData).length, 2);
  assert.deepEqual(fromPexels(null), []);
  const noLink = fromPixabay({ hits: [{ pageURL: 'https://evil.example/', user: 'X', webformatURL: 'https://pixabay.com/get/w.jpg', largeImageURL: 'https://pixabay.com/get/l.jpg' }] });
  assert.equal(noLink[0].page, null);
});

test('search: beide Anbieter, Keys nur an die richtige Stelle, Cache, Teilausfall', async () => {
  const calls = [];
  let failPixabay = false;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.ok(!/@/.test(init.headers['User-Agent']), 'User-Agent ist generisch');
    if (url.startsWith('https://api.pexels.com/')) return json(pexelsData);
    if (failPixabay) return json({}, 503);
    return json(pixabayData);
  };
  let t = 0;
  const stock = createStockSearch({ ...KEYS, fetchImpl, now: () => t });
  assert.deepEqual(stock.providers, ['pexels', 'pixabay']);

  const res = await stock.search('  Spaghetti ');
  assert.deepEqual(res.map((r) => r.provider), ['pexels', 'pixabay', 'pixabay'], 'abwechselnd');
  const pex = calls.find((c) => c.url.startsWith('https://api.pexels.com/'));
  assert.equal(pex.init.headers.Authorization, KEYS.pexelsKey);
  assert.ok(!pex.url.includes(KEYS.pexelsKey), 'Pexels-Key nur im Header');
  assert.ok(new URL(pex.url).searchParams.get('query') === 'Spaghetti');
  const pix = calls.find((c) => c.url.startsWith('https://pixabay.com/api/'));
  assert.equal(new URL(pix.url).searchParams.get('category'), 'food');
  assert.ok(!('Authorization' in pix.init.headers));

  await stock.search('spaghetti');
  assert.equal(calls.length, 2, 'zweite Suche kommt aus dem Cache (Groß-/Kleinschreibung egal)');
  t += 25 * 60 * 60 * 1000;
  failPixabay = true;
  const partial = await stock.search('spaghetti');
  assert.deepEqual(partial.map((r) => r.provider), ['pexels'], 'ein Anbieter fällt aus, der andere zählt');

  const down = createStockSearch({ pexelsKey: KEYS.pexelsKey, fetchImpl: async () => json({}, 500) });
  await assert.rejects(down.search('x'), (e) => e instanceof StockError && !e.message.includes(KEYS.pexelsKey));
});

test('search: ohne Key kein Anbieter, leere Suche ruft nichts ab', async () => {
  const stock = createStockSearch({ fetchImpl: async () => assert.fail('darf nicht abrufen') });
  assert.deepEqual(stock.providers, []);
  assert.deepEqual(await stock.search('Pizza'), []);
  const one = createStockSearch({ ...KEYS, fetchImpl: async () => assert.fail('darf nicht abrufen') });
  assert.deepEqual(await one.search('   '), []);
});

test('download: nur erlaubte Hosts, Weiterleitungen werden geprüft, Größenlimit', async () => {
  const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const binary = (buf, status = 200, headers = {}) => ({ status, ok: status < 300, headers: new Headers(headers), arrayBuffer: async () => buf });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    assert.equal(init.redirect, 'manual');
    if (url === 'https://pixabay.com/get/a.jpg') return binary(Buffer.alloc(0), 302, { location: 'https://cdn.pixabay.com/photo/a.jpg' });
    if (url === 'https://pixabay.com/get/evil.jpg') return binary(Buffer.alloc(0), 302, { location: 'http://127.0.0.1:8080/secret' });
    if (url === 'https://pixabay.com/get/big.jpg') return binary(img, 200, { 'content-length': String(50 * 1024 * 1024) });
    return binary(img);
  };
  const stock = createStockSearch({ ...KEYS, fetchImpl });

  assert.ok((await stock.download('pixabay', 'https://pixabay.com/get/a.jpg')).equals(img));
  assert.deepEqual(seen, ['https://pixabay.com/get/a.jpg', 'https://cdn.pixabay.com/photo/a.jpg']);

  await assert.rejects(stock.download('pixabay', 'https://pixabay.com/get/evil.jpg'), StockError);
  await assert.rejects(stock.download('pixabay', 'https://pixabay.com/get/big.jpg'), /zu groß/);
  const before = seen.length;
  await assert.rejects(stock.download('pixabay', 'http://127.0.0.1/x.jpg'), StockError);
  await assert.rejects(stock.download('pexels', 'https://cdn.pixabay.com/x.jpg'), StockError, 'falscher Anbieter');
  assert.equal(seen.length, before, 'unerlaubte Adressen werden nie abgerufen');
});
