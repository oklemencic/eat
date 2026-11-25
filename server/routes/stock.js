// Bildsuche bei Pexels/Pixabay (siehe stock.js). Der Import eines gewählten Bildes liegt in routes/photos.js.
// GET /          -> { providers: ['pexels', 'pixabay'] } (leer, wenn keine Keys gesetzt sind)
// GET /search?q= -> { results: [{ provider, thumb, url, author, page }] }; 502, wenn kein Anbieter antwortet

import { Router } from 'express';
import { HttpError, reqString } from '../http.js';
import { StockError } from '../stock.js';

export default function stockRouter(stock) {
  const r = Router();

  r.get('/', (req, res) => res.json({ providers: stock?.providers ?? [] }));

  r.get('/search', async (req, res) => {
    const q = reqString(req.query.q, 'q', 100);
    if (!stock?.providers.length) return res.json({ results: [] });
    try {
      res.json({ results: await stock.search(q) });
    } catch (e) {
      if (e instanceof StockError) throw new HttpError(502, e.message);
      throw e;
    }
  });

  return r;
}
