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
const router = Router();

const videoCache = new Map();
const inFlightVideos = new Map();

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { list, refresh } = req.query;
    const cacheKey = `${id}:${list || ''}`;

    if (!refresh) {
      const cached = videoCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return res.json(cached.data);
      }
    }

    if (inFlightVideos.has(cacheKey)) {
      const data = await inFlightVideos.get(cacheKey);
      return res.json(data);
    }

    const promise = req.extractor.getVideoDetail(id, list || null)
      .then(result => {
        if (result && !result.error) {
          videoCache.set(cacheKey, { data: result, expiresAt: Date.now() + (result.isLivestream ? 60 * 1000 : 600 * 1000) });
          if (videoCache.size > 200) {
            const oldest = videoCache.keys().next().value;
            videoCache.delete(oldest);
          }
        }
        return result;
      })
      .finally(() => {
        inFlightVideos.delete(cacheKey);
      });

    inFlightVideos.set(cacheKey, promise);
    const result = await promise;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/suggestions', async (req, res) => {
  try {
    const { continuation } = req.query;
    if (!continuation) return res.status(400).json({ error: 'Missing continuation token' });
    const result = await req.extractor.loadMoreSuggestions(continuation);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
