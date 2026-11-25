// Konfiguration aus Umgebungsvariablen. Fehlermeldungen nennen nur Variablennamen, nie Werte.
// Es ist keine Variable zwingend nötig. Benutzer und Passwörter gehören nicht hierher: Sie werden in der Web-Oberfläche angelegt und in der DB gespeichert.

import path from 'node:path';

export function loadConfig(env = process.env) {
  const errors = [];

  // Optional: Ohne Wert erzeugt die App beim ersten Start einen Schlüssel und legt ihn in der Datenbank ab
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret && sessionSecret.length < 32) {
    errors.push('SESSION_SECRET ist kürzer als 32 Zeichen (leer lassen oder erzeugen: scripts/secrets.js secret)');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT ist ungültig');

  const sessionDays = Number(env.SESSION_DAYS ?? 30);
  if (!Number.isFinite(sessionDays) || sessionDays <= 0) errors.push('SESSION_DAYS ist ungültig');

  // Optional: API-Keys für die Bildsuche (Pexels, Pixabay). Ohne Key ist der Anbieter abgeschaltet.
  const keyPattern = /^[A-Za-z0-9_-]+$/;
  const pexelsKey = (env.PEXELS_API_KEY ?? '').trim();
  const pixabayKey = (env.PIXABAY_API_KEY ?? '').trim();
  if (pexelsKey && !keyPattern.test(pexelsKey)) errors.push('PEXELS_API_KEY enthält ungültige Zeichen');
  if (pixabayKey && !keyPattern.test(pixabayKey)) errors.push('PIXABAY_API_KEY enthält ungültige Zeichen');

  if (errors.length) {
    throw new Error(`Ungültige Konfiguration:\n- ${errors.join('\n- ')}`);
  }

  const root = path.resolve(import.meta.dirname, '..');
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? path.join(root, 'data')),
    clientDir: path.resolve(env.CLIENT_DIR ?? path.join(root, 'client', 'dist')),
    sessionSecret, // '' = aus der Datenbank (siehe sessionSecret in db.js)
    sessionDays,
    // Secure-Cookie ist Standard (HTTPS per Reverse Proxy); für reines HTTP-Testen COOKIE_SECURE=false
    cookieSecure: env.COOKIE_SECURE !== 'false',
    // Hinter Caddy TRUST_PROXY=1 setzen, damit req.ip die Client-IP ist
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : false,
    // Produktvorschläge aus Open Food Facts (nur der Barcode geht nach außen); PRODUCT_LOOKUP=off schaltet sie ab
    productLookupEnabled: env.PRODUCT_LOOKUP !== 'off',
    pexelsKey,
    pixabayKey,
  };
}
