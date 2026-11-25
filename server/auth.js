// Passwort-Hash (scrypt), Session-Token (HMAC) und Login-Bremse.
// Benutzer und ihre Passwort-Hashes liegen in der Datenbank (Tabelle users), nie im Klartext.
// Aus der Umgebung kommt nur SESSION_SECRET.

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

export const HASH_FORMAT = /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/;
export const SESSION_COOKIE = 'eat_session';
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

// Format: scrypt:<salt hex>:<key hex>  (kein "$", damit Hashes in Env-Dateien/Exporten nichts interpolieren)
export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH || !HASH_FORMAT.test(stored)) {
    return false;
  }
  const [, saltHex, keyHex] = stored.split(':');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Für unbekannte Benutzernamen: gleicher Rechenaufwand wie bei einem echten Benutzer,
// damit die Antwortzeit nicht verrät, ob es den Namen gibt.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));
export function verifyLogin(password, user) {
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  return !!user && ok;
}

// Der Signaturschlüssel enthält den Passwort-Hash des Benutzers: Passwortwechsel beendet dessen Sessions.
function sign(userId, exp, passwordHash, sessionSecret) {
  return createHmac('sha256', `${sessionSecret}:${passwordHash}`)
    .update(`session:${userId}:${exp}`)
    .digest('base64url');
}

// Token: <userId>.<exp>.<Signatur>
export function createSessionToken(user, config, now = Date.now()) {
  const exp = Math.floor(now / 1000) + config.sessionDays * 86400;
  return `${user.id}.${exp}.${sign(user.id, exp, user.password_hash, config.sessionSecret)}`;
}

// Benutzer-ID aus dem (noch ungeprüften) Token, um den Benutzer nachzuschlagen; sonst null
export function tokenUserId(token) {
  if (typeof token !== 'string') return null;
  const [id] = token.split('.');
  return /^\d{1,15}$/.test(id) ? Number(id) : null;
}

export function verifySessionToken(token, user, config, now = Date.now()) {
  if (typeof token !== 'string' || !user) return false;
  const [id, exp, sig, extra] = token.split('.');
  if (!id || !exp || !sig || extra !== undefined || !/^\d+$/.test(exp)) return false;
  if (Number(id) !== user.id || Number(exp) * 1000 < now) return false;
  const expected = Buffer.from(sign(user.id, exp, user.password_hash, config.sessionSecret));
  const actual = Buffer.from(sig);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// Maximal `limit` Fehlversuche je Fenster und IP.
export function createLoginLimiter({ limit = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  const current = (key, now) => {
    const e = attempts.get(key);
    if (!e || e.resetAt <= now) return null;
    return e;
  };
  return {
    blocked(key, now = Date.now()) {
      const e = current(key, now);
      return !!e && e.count >= limit;
    },
    fail(key, now = Date.now()) {
      const e = current(key, now);
      if (e) e.count += 1;
      else attempts.set(key, { count: 1, resetAt: now + windowMs });
      if (attempts.size > 1000) {
        for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
      }
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
