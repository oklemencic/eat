// Erzeugt den Zufallswert für die Umgebung (Env-Datei außerhalb des Repos, Docker Secret o. Ä.).
//
//   node scripts/secrets.js secret   Zufallswert für SESSION_SECRET
//
// Benutzer und Passwörter gibt es hier nicht mehr: Der erste Benutzer wird beim ersten Start in der
// Web-Oberfläche angelegt, weitere Benutzer legt dieser (Administrator) dort an.

import { randomBytes } from 'node:crypto';

if (process.argv[2] === 'secret') {
  console.log(randomBytes(48).toString('base64url'));
} else {
  console.error('Aufruf: node scripts/secrets.js secret');
  process.exit(1);
}
