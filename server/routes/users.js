// Benutzerverwaltung (nur Administratoren) und eigenes Konto (Passwort ändern).

import { Router } from 'express';
import { HttpError, body, parseId, notFound } from '../http.js';
import { hashPassword, verifyPassword } from '../auth.js';
import {
  createUser, findUserById, publicUser, reqUsername, reqNewPassword,
} from '../users.js';

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return next(new HttpError(403, 'administrator required'));
  next();
}

export function usersRouter(db) {
  const r = Router();
  r.use(requireAdmin);

  r.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all();
    res.json(rows.map(publicUser));
  });

  r.post('/', (req, res) => {
    const b = body(req);
    const user = createUser(db, {
      username: reqUsername(b.username),
      password: reqNewPassword(b.password),
      isAdmin: b.is_admin === true,
    });
    res.status(201).json(publicUser(user));
  });

  // Neues Passwort für einen Benutzer setzen (beendet dessen Sessions)
  r.put('/:id/password', (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'use /api/account/password for your own password');
    if (!findUserById(db, id)) throw notFound();
    const hash = hashPassword(reqNewPassword(body(req).password));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    res.status(204).end();
  });

  // Löscht den Benutzer samt allen seinen Daten (Foto-Dateien bleiben auf dem Server liegen)
  r.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'you cannot delete yourself');
    const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return r;
}

// onChanged(req, res, user): setzt das Session-Cookie neu, da der Passwortwechsel das alte ungültig macht
export function accountRouter(db, { onChanged, limiter }) {
  const r = Router();

  r.put('/password', (req, res) => {
    if (limiter.blocked(req.ip)) {
      res.set('Retry-After', '900');
      throw new HttpError(429, 'too many failed attempts, try again later');
    }
    const b = body(req);
    if (!verifyPassword(b.current_password, req.user.password_hash)) {
      limiter.fail(req.ip);
      throw new HttpError(403, 'current password is wrong');
    }
    const hash = hashPassword(reqNewPassword(b.new_password, 'new_password'));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    limiter.reset(req.ip);
    onChanged(res, findUserById(db, req.user.id));
    res.status(204).end();
  });

  return r;
}
