// Foto-Suche bei Pexels und Pixabay (kostenlose Bild-APIs). Nach außen geht nur der Suchbegriff; der User-Agent ist
// generisch. Die API-Keys kommen aus der Umgebung (PEXELS_API_KEY, PIXABAY_API_KEY), liegen nur auf dem Server und
// erscheinen weder in Antworten noch in Fehlermeldungen. Gewählte Bilder lädt der Server herunter und speichert sie
// lokal (kein Hotlinking, wie es Pixabay verlangt). Ohne Key ist der jeweilige Anbieter abgeschaltet.

const USER_AGENT = 'EatApp/0.1 (self-hosted)';
const PER_PROVIDER = 8;
const MAX_QUERY = 100;
// Pixabay verlangt, Suchergebnisse 24 Stunden zwischenzuspeichern
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 200;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// Nur diese Hosts liefern Bilder bzw. Seiten; alles andere wird nie abgerufen oder verlinkt (SSRF, javascript:-Links)
const IMAGE_HOSTS = {
  pexels: ['images.pexels.com'],
  pixabay: ['pixabay.com', 'cdn.pixabay.com'],
};
const PAGE_HOSTS = {
  pexels: ['www.pexels.com', 'pexels.com'],
  pixabay: ['pixabay.com'],
};

// Fehler des Dienstes (Timeout, 4xx/5xx, Netz, unbrauchbare Antwort)
export class StockError extends Error {}

// URL, wenn https und Host in der Liste des Anbieters (ohne Zugangsdaten, ohne Sonderport), sonst null
export function safeUrl(value, hosts) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.includes(u.hostname)) return null;
  return u.href;
}

export const isImageUrl = (provider, url) => !!IMAGE_HOSTS[provider] && safeUrl(url, IMAGE_HOSTS[provider]) !== null;

const text = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function fromPexels(data) {
  const out = [];
  for (const p of Array.isArray(data?.photos) ? data.photos : []) {
    const thumb = safeUrl(p?.src?.medium, IMAGE_HOSTS.pexels);
    const url = safeUrl(p?.src?.large, IMAGE_HOSTS.pexels);
    if (!thumb || !url) continue;
    out.push({ provider: 'pexels', thumb, url, author: text(p.photographer), page: safeUrl(p.url, PAGE_HOSTS.pexels) });
  }
  return out;
}

export function fromPixabay(data) {
  const out = [];
  for (const p of Array.isArray(data?.hits) ? data.hits : []) {
    const thumb = safeUrl(p?.webformatURL, IMAGE_HOSTS.pixabay);
    const url = safeUrl(p?.largeImageURL, IMAGE_HOSTS.pixabay);
    if (!thumb || !url) continue;
    out.push({ provider: 'pixabay', thumb, url, author: text(p.user), page: safeUrl(p.pageURL, PAGE_HOSTS.pixabay) });
  }
  return out;
}

// Abwechselnd je ein Treffer pro Anbieter, damit beide in der Auswahl vorkommen
function interleave(lists) {
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i += 1) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

// Keys: nur Buchstaben, Ziffern, "-" und "_" (landen in einem Header bzw. einer URL)
export function createStockSearch({ pexelsKey = '', pixabayKey = '', fetchImpl = fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const cache = new Map();
  const sources = [];

  if (pexelsKey) {
    sources.push({
      name: 'pexels',
      url: (q) => `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: PER_PROVIDER, locale: 'de-DE', orientation: 'landscape' })}`,
      headers: { Authorization: pexelsKey },
      parse: fromPexels,
    });
  }
  if (pixabayKey) {
    sources.push({
      name: 'pixabay',
      url: (q) => `https://pixabay.com/api/?${new URLSearchParams({ key: pixabayKey, q, per_page: PER_PROVIDER, lang: 'de', category: 'food', image_type: 'photo', orientation: 'horizontal', safesearch: 'true' })}`,
      headers: {},
      parse: fromPixabay,
    });
  }

  async function fromSource(src, q) {
    const key = `${src.name}:${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;

    let res;
    try {
      res = await fetchImpl(src.url(q), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...src.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new StockError(`${src.name} nicht erreichbar`);
    }
    if (!res.ok) throw new StockError(`${src.name} antwortet mit Fehler ${res.status}`);
    const data = await res.json().catch(() => null);
    const value = src.parse(data);

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: now() + CACHE_TTL_MS });
    return value;
  }

  // Treffer aller aktiven Anbieter. Fällt einer aus, zählen die anderen; nur wenn alle ausfallen, wird geworfen.
  async function search(query) {
    const q = text(query, MAX_QUERY);
    if (!q || !sources.length) return [];
    const settled = await Promise.allSettled(sources.map((s) => fromSource(s, q)));
    const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) throw settled[0].reason;
    return interleave(ok);
  }

  // Bild herunterladen (nur von den Bild-Hosts des Anbieters, Weiterleitungen werden einzeln geprüft)
  async function download(provider, url) {
    let current = safeUrl(url, IMAGE_HOSTS[provider] ?? []);
    if (!current) throw new StockError('Bildadresse nicht erlaubt');
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let res;
      try {
        res = await fetchImpl(current, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs * 2) });
      } catch {
        throw new StockError('Bild nicht erreichbar');
      }
      if (res.status >= 300 && res.status < 400) {
        current = safeUrl(new URL(res.headers.get('location') ?? '', current).href, IMAGE_HOSTS[provider]);
        if (!current) throw new StockError('Weiterleitung nicht erlaubt');
        continue;
      }
      if (!res.ok) throw new StockError(`Bild nicht abrufbar (${res.status})`);
      if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new StockError('Bild zu groß');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) throw new StockError('Bild zu groß');
      return buf;
    }
    throw new StockError('Zu viele Weiterleitungen');
  }

  return { providers: sources.map((s) => s.name), search, download };
}
