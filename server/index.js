import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

// Lokaler Betrieb: Variablen aus .env im Projektordner laden (unabhängig vom Arbeitsverzeichnis und davon, ob der
// Server mit node oder bun gestartet wird). Bereits gesetzte Variablen haben Vorrang. Im Docker-Image gibt es keine
// .env (siehe .dockerignore); dort kommen die Werte aus compose.yaml.
const envFile = path.resolve(import.meta.dirname, '..', '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { app, db } = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(`eat server listening on ${config.host}:${server.address().port}`);
  const providers = [config.pexelsKey && 'Pexels', config.pixabayKey && 'Pixabay'].filter(Boolean);
  console.log(`Bildsuche: ${providers.length ? providers.join(', ') : 'aus (kein API-Key gesetzt)'}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
