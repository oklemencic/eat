// Konsistente Momentaufnahme der Datenbank (läuft im Container, auch während die App schreibt).
// Nutzt VACUUM INTO: Die Kopie entsteht aus einem einheitlichen Lesestand; gleichzeitige Schreibzugriffe der App
// werden kurz abgewartet statt abgebrochen (die Online-Backup-Funktion von node:sqlite scheitert dabei mit einem
// unklaren Fehler). Die Kopie wird danach geprüft; bei jedem Fehler bleibt keine halbe Datei zurück.
//
//   docker exec eat node scripts/backup.js
//
// Schreibt DATA_DIR/backups/eat-JJJJMMTT-HHMMSS.db und behält die letzten BACKUP_KEEP Stände (Standard 3).
// Das eigentliche Sichern (mit Fotos, mit Aufbewahrung) erledigt scripts/backup.sh auf dem Host.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const keep = Math.max(Number(process.env.BACKUP_KEEP ?? 3) || 3, 1);
const dir = path.join(dataDir, 'backups');
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const target = path.join(dir, `eat-${stamp}.db`);

try {
  const source = new DatabaseSync(path.join(dataDir, 'eat.db'));
  try {
    source.exec('PRAGMA busy_timeout = 10000');
    source.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    const { integrity_check: result } = copy.prepare('PRAGMA integrity_check').get();
    if (result !== 'ok') throw new Error(`Integritätsprüfung der Sicherung fehlgeschlagen: ${result}`);
  } finally {
    copy.close();
  }
} catch (err) {
  rmSync(target, { force: true });
  throw err;
}

// Alte Stände entfernen (Dateinamen enthalten den Zeitstempel, sortieren = nach Alter)
const snapshots = readdirSync(dir).filter((f) => /^eat-\d{8}-\d{6}\.db$/.test(f)).sort();
for (const old of snapshots.slice(0, Math.max(snapshots.length - keep, 0))) rmSync(path.join(dir, old));

console.log(path.basename(target));
