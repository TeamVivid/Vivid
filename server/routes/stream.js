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
import { mintCynTokens } from '../../extractor/absolutesolver/botguard.js';
const router = Router();

router.get('/:id/pot', async (req, res) => {
  try {
    const { id } = req.params;
    const clientKey = (req.query.client || 'web').toLowerCase();
    let visitorData = req.query.visitorData || req.query.visitor_data || '';
    if (!visitorData && req.extractor?.client) {
      const isTv = clientKey === 'tv' || clientKey === 'tvhtml5' || clientKey === 'tv_simply';
      if (isTv) {
        visitorData = req.extractor.client.visitorData || await req.extractor.client.fetchTvVisitorData?.() || '';
      } else {
        visitorData = req.extractor.client.visitorData || await req.extractor.client.fetchVisitorData?.() || '';
      }
    }
    const cyn = await mintCynTokens(id, visitorData, { clientKey, forceRefresh: true });
    res.json({
      poToken: cyn.sabrCynToken || cyn.playerCynToken || '',
      playerPoToken: cyn.playerCynToken || '',
      sabrPoToken: cyn.sabrCynToken || '',
      gvsPoToken: cyn.sabrCynToken || '',
      ttl: cyn.ttl || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await req.extractor.getStreamUrls(req.params.id, req.query);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
