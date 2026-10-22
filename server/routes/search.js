/*
 * Vivid - A privacy focused alternative YouTube frontend inspired by Invidious and Nitter
 * Copyright (C) 2026  TheErrorExe, zUnpaid
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { Router } from 'express';
import fetch from 'node-fetch';
const router = Router();

router.get('/suggest', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });
    
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`;
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: 'Upstream error' });
    
    const data = await response.json();
    res.json({ suggestions: data[1] || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { q, sort_by, type, date, duration, features, continuation } = req.query;
    if (!q && !continuation) {
      return res.status(400).json({ error: 'Missing query parameter "q"' });
    }

    if (continuation) {
      const result = await req.extractor.searchContinuation(continuation, type === 'song', sort_by === 'date');
      return res.json(result);
    }

    const filters = {};
    if (sort_by) filters.sortBy = sort_by;
    if (type) filters.type = type;
    if (date) filters.uploadDate = date;
    if (duration) filters.duration = duration;
    if (features) filters.features = features.split(',');

    const result = await req.extractor.search(q, filters);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
