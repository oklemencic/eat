// Produkt-Vorschlag aus Open Food Facts (offene Datenbank, kein API-Key). Wird nur als Fallback genutzt, wenn der
// Barcode noch nicht bei dem Benutzer registriert ist. Nach außen geht ausschließlich der Barcode; der User-Agent
// ist generisch (keine Benutzer- oder Betreiberdaten). Die Daten sind crowd-sourced und lückenhaft: Das Ergebnis ist
// nur ein Vorschlag, den der Benutzer prüft.

const FIELDS = 'code,product_name,product_name_de,generic_name,brands,nutriments,serving_quantity';
const USER_AGENT = 'EatApp/0.1 (self-hosted)';
const KJ_PER_KCAL = 4.184;

const HIT_TTL_MS = 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 500;

// Fehler des Dienstes (Timeout, 5xx, Netz) im Unterschied zu "Produkt unbekannt" (null)
export class LookupError extends Error {
  // status: HTTP-Status des Dienstes, falls vorhanden (429 = zu viele Anfragen)
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

// Normalisierter Barcode (ohne führende Nullen) -> Code, wie ihn Open Food Facts führt:
// EAN-8 bleibt 8-stellig, UPC-A/EAN-13 werden auf 13 Stellen aufgefüllt.
export function offCode(barcode) {
  const s = String(barcode);
  if (s.length <= 8) return s.padStart(8, '0');
  if (s.length <= 13) return s.padStart(13, '0');
  return s;
}

const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

// Zahl im erlaubten Bereich, sonst null (unplausible Werte nicht vorschlagen)
function inRange(v, max, min = 0) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? round(n) : null;
}

// Open-Food-Facts-Produkt -> Felder der App (Nährwerte pro 100 g). Fehlende Werte bleiben null.
export function toSuggestion(barcode, product) {
  const n = product.nutriments ?? {};
  let kcal = inRange(n['energy-kcal_100g'], 1000);
  if (kcal === null) {
    const kj = inRange(n.energy_100g, 5000);
    if (kj !== null) kcal = inRange(kj / KJ_PER_KCAL, 1000);
  }
  const name = [product.product_name_de, product.product_name, product.generic_name]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find(Boolean);
  const brand = typeof product.brands === 'string' ? product.brands.split(',')[0].trim() : '';
  return {
    barcode,
    name: name ? name.slice(0, 200) : null,
    brand: brand ? brand.slice(0, 100) : null,
    kcal_100: kcal,
    protein_100: inRange(n.proteins_100g, 100),
    carbs_100: inRange(n.carbohydrates_100g, 100),
    fat_100: inRange(n.fat_100g, 100),
    serving_g: inRange(product.serving_quantity, 5000, 1),
    source: 'openfoodfacts',
  };
}

// Erzeugt die Abfragefunktion lookup(barcode) -> Vorschlag | null; wirft LookupError bei Dienstproblemen.
// Treffer und "unbekannt" werden kurz zwischengespeichert, Fehler nicht.
export function createLookup({ baseUrl = 'https://world.openfoodfacts.org', timeoutMs = 6000, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();

  return async function lookup(barcode) {
    const hit = cache.get(barcode);
    if (hit && hit.until > now()) return hit.value;

    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api/v3/product/${encodeURIComponent(offCode(barcode))}?fields=${FIELDS}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new LookupError('Produktdatenbank nicht erreichbar');
    }

    let value = null;
    if (res.status !== 404) {
      if (!res.ok) throw new LookupError(`Produktdatenbank antwortet mit Fehler ${res.status}`, res.status);
      const data = await res.json().catch(() => null);
      if (data?.status === 'success' && data.product) value = toSuggestion(barcode, data.product);
    }

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(barcode, { value, until: now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
    return value;
  };
}
