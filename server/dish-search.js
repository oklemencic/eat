// Vorschläge für fertige Gerichte aus Open Food Facts (offene Datenbank, kein API-Key). Zwei Schritte:
// 1. Textsuche (search-a-licious) liefert nur Barcodes, keine Nährwerte.
// 2. Die Nährwerte holt die bestehende Barcode-Abfrage (lookup.js, mit Cache) für die ersten Treffer.
// Nach außen geht nur der Suchbegriff (und die Barcodes der Treffer); der User-Agent ist generisch. Die Daten sind
// crowd-sourced und lückenhaft: Das Ergebnis ist nur ein Vorschlag, den der Benutzer im Formular prüft.

import { LookupError } from './lookup.js';

const USER_AGENT = 'EatApp/0.1 (self-hosted)';
const CANDIDATES = 12; // so viele Treffer werden höchstens nachgeschlagen
const BATCH = 3; // gleichzeitige Nachschlagungen (mehr löst bei Open Food Facts schnell Fehler 429 aus)
const MAX_RESULTS = 8;
const MAX_QUERY = 100;
const TTL_MS = 60 * 60 * 1000;
const MAX_CACHE = 200;

const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

// Barcode-Vorschlag (Nährwerte pro 100 g) -> Gericht pro Portion. Ist die Portionsgröße bekannt, werden die Werte
// umgerechnet (basis 'portion'); sonst bleiben sie pro 100 g (basis '100g') und der Benutzer passt sie an.
// Ohne Kalorien ist ein Treffer unbrauchbar (null).
export function toDish(s) {
  if (!s || s.kcal_100 === null || !s.name) return null;
  const portion = s.serving_g !== null && s.serving_g > 0;
  const f = portion ? s.serving_g / 100 : 1;
  const scale = (v, digits = 1) => (v === null ? null : round(v * f, digits));
  return {
    barcode: s.barcode,
    name: s.name,
    brand: s.brand,
    basis: portion ? 'portion' : '100g',
    serving_g: portion ? s.serving_g : null,
    kcal: scale(s.kcal_100, 0),
    protein: scale(s.protein_100),
    carbs: scale(s.carbs_100),
    fat: scale(s.fat_100),
    source: 'openfoodfacts',
  };
}

// lookup: Barcode-Abfrage aus createLookup (wirft LookupError bei Dienstproblemen)
export function createDishSearch({ lookup, baseUrl = 'https://search.openfoodfacts.org', timeoutMs = 6000, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();

  async function findCodes(q) {
    let res;
    try {
      const params = new URLSearchParams({ q, langs: 'de', page_size: CANDIDATES, fields: 'code' });
      res = await fetchImpl(`${baseUrl}/search?${params}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new LookupError('Produktdatenbank nicht erreichbar');
    }
    if (!res.ok) throw new LookupError(`Produktdatenbank antwortet mit Fehler ${res.status}`);
    const data = await res.json().catch(() => null);
    const codes = (Array.isArray(data?.hits) ? data.hits : []).map((h) => h?.code).filter((c) => typeof c === 'string' && /^\d{4,20}$/.test(c));
    return [...new Set(codes)];
  }

  return async function search(query) {
    const q = typeof query === 'string' ? query.trim().slice(0, MAX_QUERY) : '';
    if (!q) return [];
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;

    const codes = await findCodes(q);

    // Nährwerte in kleinen Gruppen nachschlagen: Open Food Facts sperrt Anfragen-Schübe (429). Die Reihenfolge der
    // Suche bleibt erhalten; bei einer Sperre wird mit dem Bisherigen abgeschlossen. Einzelne Fehler zählen nicht.
    const seen = new Set();
    const results = [];
    let failed = 0;
    let limited = false;
    for (let i = 0; i < codes.length && results.length < MAX_RESULTS && !limited; i += BATCH) {
      const settled = await Promise.allSettled(codes.slice(i, i + BATCH).map((c) => lookup(c)));
      for (const r of settled) {
        if (r.status === 'rejected') {
          failed += 1;
          if (r.reason?.status === 429) limited = true;
          continue;
        }
        const dish = toDish(r.value);
        if (!dish) continue;
        // Gleiche Produkte in mehreren Ländern/Packungen nur einmal zeigen
        const id = `${dish.name.toLowerCase()}|${(dish.brand ?? '').toLowerCase()}|${dish.kcal}`;
        if (seen.has(id) || results.length >= MAX_RESULTS) continue;
        seen.add(id);
        results.push(dish);
      }
    }

    // Nichts gefunden, weil der Dienst ausfiel oder bremste: Fehler statt "keine Treffer" (und nicht zwischenspeichern)
    if (!results.length && failed) {
      throw new LookupError(limited ? 'Zu viele Anfragen an die Produktdatenbank, bitte kurz warten' : 'Produktdatenbank nicht erreichbar');
    }
    // Unvollständige Ergebnisse nach einer Sperre nicht zwischenspeichern
    if (!limited) {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(key, { value: results, until: now() + TTL_MS });
    }
    return results;
  };
}
