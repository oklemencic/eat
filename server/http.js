// Kleine Validierungs-Helfer. Alle Fehler werden als HttpError (400/404) geworfen.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export function reqString(v, name, max = 200) {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${name} is required`);
  if (v.length > max) throw bad(`${name} is too long`);
  return v.trim();
}

export function optString(v, name, max = 500) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  if (v.length > max) throw bad(`${name} is too long`);
  return v.trim() || null;
}

export function num(v, name, { min = 0, max = 1e6, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw bad(`${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

export function int(v, name, opts = {}) {
  const n = num(v, name, opts);
  if (n !== null && !Number.isInteger(n)) throw bad(`${name} must be an integer`);
  return n;
}

export function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function isoDate(v, name = 'date') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw bad(`${name} must be YYYY-MM-DD`);
  }
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) {
    throw bad(`${name} is not a valid date`);
  }
  return v;
}

export function isoDateTime(v, name = 'eaten_at') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw bad(`${name} must be YYYY-MM-DDTHH:MM`);
  }
  isoDate(v.slice(0, 10), name);
  return v;
}

// Pfad-Parameter :id; ungültig oder nicht vorhanden -> 404
export function parseId(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

export function notFound() {
  return new HttpError(404, 'not found');
}

// Verweis auf ein hochgeladenes Foto (oder null)
export function photoRef(db, userId, v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !db.prepare('SELECT 1 FROM photos WHERE id = ? AND user_id = ?').get(v, userId)) {
    throw bad('photo_id does not exist');
  }
  return v;
}

export function body(req) {
  const b = req.body;
  if (b === undefined) return {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw bad('JSON object expected');
  return b;
}

export const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
