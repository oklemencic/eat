import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openDb, sessionSecret } from './db.js';
import {
  SESSION_COOKIE, verifyLogin, createSessionToken, verifySessionToken, tokenUserId, readCookie, createLoginLimiter,
} from './auth.js';
import { HttpError } from './http.js';
import {
  countUsers, createUser, credentials, findUserById, findUserByName, publicUser, reqUsername, reqNewPassword,
} from './users.js';
import { usersRouter, accountRouter } from './routes/users.js';
import dishesRouter from './routes/dishes.js';
import productsRouter from './routes/products.js';
import { createLookup } from './lookup.js';
import { createDishSearch } from './dish-search.js';
import mealsRouter from './routes/meals.js';
import workoutsRouter from './routes/workouts.js';
import weightsRouter from './routes/weights.js';
import settingsRouter from './routes/settings.js';
import statsRouter from './routes/stats.js';
import exchangeRouter from './routes/exchange.js';
import { photosApiRouter, photosFileRouter } from './routes/photos.js';
import stockRouter from './routes/stock.js';
import { createStockSearch } from './stock.js';

export function createApp(baseConfig) {
  const db = openDb(baseConfig.dataDir);
  // SESSION_SECRET aus der Umgebung hat Vorrang, sonst der in der Datenbank gespeicherte Schlüssel
  const config = { ...baseConfig, sessionSecret: baseConfig.sessionSecret || sessionSecret(db) };
  const app = express();
  const limiter = createLoginLimiter();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  // Ohne Anmeldung erreichbar: Healthcheck und die statische App (die Login-Seite muss ladbar sein)
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const hasClient = existsSync(path.join(config.clientDir, 'index.html'));
  if (hasClient) app.use(express.static(config.clientDir));

  // Große Body-Grenze nur für den Import; alle anderen JSON-Bodies max. 100 kB
  app.use('/api/import', express.json({ limit: '20mb' }));
  app.use(express.json({ limit: '100kb' }));

  // --- Anmeldung ---
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
  const setSessionCookie = (res, user) => {
    res.cookie(SESSION_COOKIE, createSessionToken(user, config), {
      ...cookieOptions,
      maxAge: config.sessionDays * 86400 * 1000,
    });
  };

  // Angemeldeter Benutzer aus dem Session-Cookie (oder null). Der Benutzer wird bei jeder Anfrage aus der DB
  // gelesen: Ein gelöschter Benutzer oder ein geändertes Passwort macht die Session sofort ungültig.
  const sessionUser = (req) => {
    const token = readCookie(req, SESSION_COOKIE);
    const id = tokenUserId(token);
    if (id === null) return null;
    const user = findUserById(db, id);
    return verifySessionToken(token, user, config) ? user : null;
  };

  const sessionInfo = (user) => ({
    authenticated: !!user,
    setup_required: !user && countUsers(db) === 0,
    user: user ? publicUser(user) : null,
  });

  app.get('/api/session', (req, res) => res.json(sessionInfo(sessionUser(req))));

  // Erster Start ohne Benutzer: Der erste Benutzer wird in der Web-Oberfläche angelegt (Administrator)
  // und übernimmt Daten aus der Einzelnutzer-Zeit. Danach ist dieser Endpunkt gesperrt.
  app.post('/api/setup', (req, res) => {
    const c = credentials(req);
    const user = createUser(db, {
      username: reqUsername(c.username),
      password: reqNewPassword(c.password),
      first: true,
    });
    setSessionCookie(res, user);
    res.status(201).json(sessionInfo(user));
  });

  app.post('/api/login', (req, res) => {
    if (limiter.blocked(req.ip)) {
      res.set('Retry-After', '900');
      throw new HttpError(429, 'too many failed attempts, try again later');
    }
    const c = credentials(req);
    const user = typeof c.username === 'string' ? findUserByName(db, c.username.trim()) : undefined;
    if (!verifyLogin(c.password, user)) {
      limiter.fail(req.ip);
      throw new HttpError(401, 'invalid credentials');
    }
    limiter.reset(req.ip);
    setSessionCookie(res, user);
    res.json(sessionInfo(user));
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ authenticated: false, setup_required: false, user: null });
  });

  // Alles Weitere unter /api und /photos erfordert eine gültige Session; req.user ist der Besitzer der Daten
  app.use(['/api', '/photos'], (req, res, next) => {
    const user = sessionUser(req);
    if (!user) return next(new HttpError(401, 'login required'));
    req.user = user;
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/users', usersRouter(db));
  app.use('/api/account', accountRouter(db, { onChanged: setSessionCookie, limiter }));
  // config.productLookup (Funktion) kann für Tests ersetzt werden; null = keine Abfrage externer Datenbanken
  const lookup = baseConfig.productLookup !== undefined ? baseConfig.productLookup : baseConfig.productLookupEnabled === false ? null : createLookup();
  // Gericht-Vorschläge nutzen dieselbe Datenbank und dieselbe Abschaltung (PRODUCT_LOOKUP=off); config.dishSearch (Funktion) ersetzt sie im Test
  const dishSearch = baseConfig.dishSearch !== undefined ? baseConfig.dishSearch : lookup ? createDishSearch({ lookup }) : null;
  app.use('/api/dishes', dishesRouter(db, { search: dishSearch }));
  app.use('/api/products', productsRouter(db, { lookup }));
  app.use('/api/meals', mealsRouter(db));
  app.use('/api/workouts', workoutsRouter(db));
  app.use('/api/weights', weightsRouter(db));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/stats', statsRouter(db));
  // Bildsuche (Pexels/Pixabay) nur mit API-Key; config.stockSearch (Objekt) kann für Tests ersetzt werden
  const stock = baseConfig.stockSearch !== undefined
    ? baseConfig.stockSearch
    : createStockSearch({ pexelsKey: baseConfig.pexelsKey, pixabayKey: baseConfig.pixabayKey });
  app.use('/api/stock', stockRouter(stock));
  app.use('/api/photos', photosApiRouter(db, config, { stock }));
  app.use('/api', exchangeRouter(db));
  app.use('/photos', photosFileRouter(db, config));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not found')));

  // Single-Page-App: unbekannte GET-Pfade liefern index.html (Client-Routing)
  if (hasClient) {
    app.get(/^\/(?!api\/|photos\/).*/, (req, res) => {
      res.sendFile('index.html', { root: config.clientDir });
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    // Bewusst geworfene HttpError (z. B. 502 bei nicht erreichbarer Produktdatenbank) behalten ihre Meldung
    if (status >= 500 && !(err instanceof HttpError)) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
    // JSON-Parserfehler und zu große Bodies stammen von body-parser und haben einen Status < 500
    const message = err.type === 'entity.parse.failed' ? 'invalid JSON' : err.message;
    res.status(status).json({ error: message });
  });

  return { app, db };
}
