// Benutzer anlegen und prüfen. Passwörter werden nur als Hash gespeichert.

import { HttpError, bad, body } from './http.js';
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './auth.js';
import { tx, seedDishes, claimLegacyData } from './db.js';

const USERNAME = /^[\p{L}\p{N}._-]{2,40}$/u;

export function reqUsername(v) {
  if (typeof v !== 'string' || !USERNAME.test(v.trim())) {
    throw bad('username must be 2-40 characters: letters, digits, ".", "_" or "-"');
  }
  return v.trim();
}

export function reqNewPassword(v, name = 'password') {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD_LENGTH) {
    throw bad(`${name} must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (v.length > MAX_PASSWORD_LENGTH) throw bad(`${name} is too long`);
  return v;
}

// Ohne password_hash, für die API
export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  is_admin: !!u.is_admin,
  created_at: u.created_at,
});

export const countUsers = (db) => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const findUserById = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const findUserByName = (db, name) => db.prepare('SELECT * FROM users WHERE username = ?').get(name);

// Legt einen Benutzer an. Läuft in der Transaktion des Aufrufers oder öffnet eine eigene.
// first = true: nur erlaubt, solange es keinen Benutzer gibt; Administrator, übernimmt vorhandene Daten.
export function createUser(db, { username, password, isAdmin = false, first = false }) {
  const passwordHash = hashPassword(password); // aufwendig, deshalb vor der Transaktion
  return tx(db, () => {
    if (first && countUsers(db) > 0) throw new HttpError(409, 'setup already completed');
    if (findUserByName(db, username)) throw new HttpError(409, 'username already taken');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
      .run(username, passwordHash, first || isAdmin ? 1 : 0);
    if (first) claimLegacyData(db, lastInsertRowid);
    else seedDishes(db, lastInsertRowid);
    return findUserById(db, lastInsertRowid);
  });
}

// Zugangsdaten aus dem Request-Body (Anmeldung, Einrichtung)
export function credentials(req) {
  const b = body(req);
  return { username: b.username, password: b.password };
}
