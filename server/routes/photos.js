// Foto-Upload als Roh-Body (Content-Type image/jpeg|png|webp). Dateien liegen in data/photos,
// in der DB stehen nur ID, Dateiname und MIME-Typ.

import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, bad } from '../http.js';

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Dateiinhalt gegen den angegebenen Typ prüfen (Magic Bytes)
function matchesType(buf, mime) {
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  return false;
}

export const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PHOTO_FILE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function photosApiRouter(db, config) {
  const r = Router();
  const dir = path.join(config.dataDir, 'photos');

  r.post('/', express.raw({ type: Object.keys(TYPES), limit: '10mb' }), async (req, res) => {
    const mime = req.headers['content-type']?.split(';')[0].trim();
    if (!TYPES[mime]) throw new HttpError(415, 'Content-Type must be image/jpeg, image/png or image/webp');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('empty body');
    if (!matchesType(req.body, mime)) throw bad('file content does not match Content-Type');

    const id = randomUUID();
    const file = `${id}.${TYPES[mime]}`;
    await writeFile(path.join(dir, file), req.body, { flag: 'wx' });
    try {
      db.prepare('INSERT INTO photos (id, user_id, file, mime) VALUES (?, ?, ?, ?)').run(id, req.user.id, file, mime);
    } catch (err) {
      await unlink(path.join(dir, file)).catch(() => {});
      throw err;
    }
    res.status(201).json({ id, url: `/photos/${id}` });
  });

  return r;
}

export function photosFileRouter(db, config) {
  const r = Router();
  const dir = path.join(config.dataDir, 'photos');

  r.get('/:id', (req, res, next) => {
    const row = PHOTO_ID.test(req.params.id) && db.prepare('SELECT file, mime FROM photos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    // Dateiname wird zusätzlich geprüft, bevor er einen Pfad bildet
    if (!row || !PHOTO_FILE.test(row.file)) return next(new HttpError(404, 'not found'));
    res.set({
      'Content-Type': row.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.sendFile(row.file, { root: dir, dotfiles: 'deny' }, (err) => {
      if (err) next(err.code === 'ENOENT' ? new HttpError(404, 'not found') : err);
    });
  });

  return r;
}
