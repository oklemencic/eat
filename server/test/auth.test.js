import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  hashPassword, verifyPassword, verifyLogin, createSessionToken, verifySessionToken, tokenUserId,
  createLoginLimiter, HASH_FORMAT,
} from '../auth.js';
import { loadConfig } from '../config.js';

test('Passwort-Hash: Format, Prüfung, unterschiedliche Salze', () => {
  const pw = randomBytes(10).toString('hex');
  const h1 = hashPassword(pw);
  assert.match(h1, HASH_FORMAT);
  assert.ok(!h1.includes('$'));
  assert.ok(verifyPassword(pw, h1));
  assert.ok(!verifyPassword(`${pw}x`, h1));
  assert.ok(!verifyPassword(pw, 'kein-hash'));
  assert.ok(!verifyPassword(undefined, h1));
  assert.notEqual(h1, hashPassword(pw));
});

test('Login-Prüfung: unbekannter Benutzer und falsches Passwort scheitern', () => {
  const user = { id: 1, password_hash: hashPassword('ein-langes-passwort') };
  assert.ok(verifyLogin('ein-langes-passwort', user));
  assert.ok(!verifyLogin('falsch', user));
  assert.ok(!verifyLogin('ein-langes-passwort', undefined));
});

test('Session-Token: gültig, abgelaufen, manipuliert, anderer Benutzer, Passwortwechsel', () => {
  const config = { sessionSecret: randomBytes(32).toString('hex'), sessionDays: 1 };
  const user = { id: 7, password_hash: hashPassword('irgendein-passwort') };
  const now = Date.now();
  const token = createSessionToken(user, config, now);
  assert.equal(tokenUserId(token), 7);
  assert.ok(verifySessionToken(token, user, config, now + 1000));
  assert.ok(!verifySessionToken(token, user, config, now + 2 * 86400 * 1000));

  const [id, exp, sig] = token.split('.');
  assert.ok(!verifySessionToken(`${id}.${Number(exp) + 100000}.${sig}`, user, config, now));
  assert.ok(!verifySessionToken('', user, config, now));
  assert.ok(!verifySessionToken(undefined, user, config, now));
  assert.ok(!verifySessionToken(token, undefined, config, now));
  assert.equal(tokenUserId('abc.1.2'), null);

  // Token eines Benutzers gilt nicht für einen anderen, auch nicht mit umgeschriebener ID
  const other = { id: 8, password_hash: user.password_hash };
  assert.ok(!verifySessionToken(token, other, config, now));
  assert.ok(!verifySessionToken(`8.${exp}.${sig}`, other, config, now));

  const changed = { ...user, password_hash: hashPassword('anderes-passwort') };
  assert.ok(!verifySessionToken(token, changed, config, now));
});

test('Login-Bremse sperrt nach 5 Fehlversuchen und gibt nach Ablauf frei', () => {
  const l = createLoginLimiter({ limit: 5, windowMs: 1000 });
  for (let i = 0; i < 5; i++) {
    assert.ok(!l.blocked('ip', 0));
    l.fail('ip', 0);
  }
  assert.ok(l.blocked('ip', 500));
  assert.ok(!l.blocked('andere-ip', 500));
  assert.ok(!l.blocked('ip', 1001));
  l.fail('ip', 2000);
  l.reset('ip');
  assert.ok(!l.blocked('ip', 2000));
});

test('Konfiguration: zu kurzes Session-Secret verhindert den Start, ohne Werte zu nennen', () => {
  assert.throws(() => loadConfig({ SESSION_SECRET: 'zu-kurz' }), /SESSION_SECRET/);
  try {
    loadConfig({ SESSION_SECRET: 'zu-kurz' });
    assert.fail('sollte werfen');
  } catch (err) {
    assert.ok(!err.message.includes('zu-kurz'));
  }
  // Ein Passwort-Hash in der Umgebung ist nicht mehr nötig (Benutzer liegen in der Datenbank)
  // Ohne jede Variable startet die App (Schlüssel kommt aus der Datenbank)
  assert.equal(loadConfig({}).sessionSecret, '');
  const ok = loadConfig({ SESSION_SECRET: randomBytes(32).toString('hex') });
  assert.equal(ok.cookieSecure, true);
  assert.equal(ok.port, 3000);
  assert.equal('passwordHash' in ok, false);
});
