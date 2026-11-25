// Dünner fetch-Wrapper für die REST-API. Fehler der API ({ error }) werden zu ApiError.
// Bei 401 (Session abgelaufen) wird ein Event ausgelöst, damit die App zur Anmeldung wechselt.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const UNAUTHORIZED_EVENT = 'eat:unauthorized';

// body: JSON-Objekt; raw: { type, data } für Datei-Uploads (Blob mit eigenem Content-Type)
async function request(method, url, body, raw) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (raw) {
    init.headers['Content-Type'] = raw.type;
    init.body = raw.data;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Bei Login und Einrichtung bedeutet 401 "falsche Zugangsdaten" und ist kein Sitzungsablauf
    if (res.status === 401 && url !== '/api/login' && url !== '/api/setup') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`);
  }
  return data;
}

const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  return q.size ? `?${q}` : '';
};

export const photoUrl = (id) => `/photos/${id}`;

// Download-Links (Session-Cookie wird mitgeschickt)
export const exportUrl = (format, table) => `/api/export${query({ format, table })}`;

export const api = {
  session: () => request('GET', '/api/session'),
  // session/login/setup liefern { authenticated, setup_required, user: { id, username, is_admin } | null }
  setup: (username, password) => request('POST', '/api/setup', { username, password }),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout'),

  changePassword: (current_password, new_password) =>
    request('PUT', '/api/account/password', { current_password, new_password }),
  // nur Administratoren
  users: () => request('GET', '/api/users'),
  addUser: (username, password, is_admin) => request('POST', '/api/users', { username, password, is_admin }),
  resetUserPassword: (id, password) => request('PUT', `/api/users/${id}/password`, { password }),
  deleteUser: (id) => request('DELETE', `/api/users/${id}`),

  settings: () => request('GET', '/api/settings'),
  updateSettings: (patch) => request('PUT', '/api/settings', patch),

  dishes: (params = {}) => request('GET', `/api/dishes${query(params)}`),
  recentDishes: (limit = 10) => request('GET', `/api/dishes/recent${query({ limit })}`),
  addDish: (dish) => request('POST', '/api/dishes', dish),
  updateDish: (id, dish) => request('PUT', `/api/dishes/${id}`, dish),
  deleteDish: (id) => request('DELETE', `/api/dishes/${id}`),
  // Vorschläge für fertige Gerichte aus Open Food Facts: { results: [{ name, brand, basis: 'portion' | '100g', serving_g, kcal, protein, carbs, fat }] }
  // (Werte pro Portion bzw. pro 100 g; fehlende = null). Wirft ApiError 404 (abgeschaltet) oder 502 (Dienst nicht erreichbar).
  suggestDishes: (q) => request('GET', `/api/dishes/suggest${query({ q })}`),

  // Produkte (Barcode, Nährwerte pro 100 g). productByBarcode liefert null, wenn noch nicht angelegt.
  products: (params = {}) => request('GET', `/api/products${query(params)}`),
  productByBarcode: (code) =>
    request('GET', `/api/products/barcode/${encodeURIComponent(code)}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  // Vorschlag aus Open Food Facts zu einem noch nicht angelegten Barcode (Nährwerte pro 100 g, fehlende = null).
  // null, wenn dort unbekannt; wirft ApiError (502), wenn die Produktdatenbank nicht erreichbar ist.
  lookupProduct: (code) =>
    request('GET', `/api/products/lookup/${encodeURIComponent(code)}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  addProduct: (product) => request('POST', '/api/products', product),
  // Mehrere auf einmal: { results: [{ barcode, status: 'created' | 'exists' | 'invalid', product?, error? }] }
  addProducts: (products) => request('POST', '/api/products/batch', { products }),
  updateProduct: (id, product) => request('PUT', `/api/products/${id}`, product),
  deleteProduct: (id) => request('DELETE', `/api/products/${id}`),

  meals: (date) => request('GET', `/api/meals${query({ date })}`),
  addMeal: (meal) => request('POST', '/api/meals', meal),
  updateMeal: (id, meal) => request('PUT', `/api/meals/${id}`, meal),
  deleteMeal: (id) => request('DELETE', `/api/meals/${id}`),

  workouts: (params = {}) => request('GET', `/api/workouts${query(params)}`),
  workoutRecords: () => request('GET', '/api/workouts/records'),
  addWorkout: (w) => request('POST', '/api/workouts', w),
  updateWorkout: (id, w) => request('PUT', `/api/workouts/${id}`, w),
  deleteWorkout: (id) => request('DELETE', `/api/workouts/${id}`),

  // { entries: [{ id, date, kg, avg7 }], trend: { kg_per_week, status, ... } | null }
  weights: (params = {}) => request('GET', `/api/weights${query(params)}`),
  addWeight: (date, kg) => request('POST', '/api/weights', { date, kg }),
  deleteWeight: (id) => request('DELETE', `/api/weights/${id}`),

  statsWeek: (end) => request('GET', `/api/stats/week${query({ end })}`),

  // Ersetzt alle Daten auf dem Server
  importData: (data) => request('POST', '/api/import?confirm=replace', data),

  // Gibt { id, url } zurück
  uploadPhoto: (blob) => request('POST', '/api/photos', undefined, { type: blob.type, data: blob }),

  // Bildsuche bei Pexels/Pixabay (nur mit API-Keys am Server). stockProviders: { providers: [...] } (leer = nicht eingerichtet);
  // stockSearch: { results: [{ provider, thumb, url, author, page }] }; importStockPhoto speichert das Bild wie einen Upload ({ id, url }).
  stockProviders: () => request('GET', '/api/stock'),
  stockSearch: (q) => request('GET', `/api/stock/search${query({ q })}`),
  importStockPhoto: (provider, url) => request('POST', '/api/photos/stock', { provider, url }),
};
