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

import express from 'express';
import { livechat } from '../../extractor/index.js';

const router = express.Router();

router.get('/:videoId/modes', async (req, res) => {
  try {
    const detail = await req.extractor.getVideoDetail(req.params.videoId);
    res.json(detail.liveChat || { token: '', modes: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:videoId', async (req, res) => {
  const { continuation, replay, offset } = req.query;

  if (!continuation) {
    return res.status(400).json({ error: 'Continuation token required' });
  }

  try {
    const result = await livechat.getLiveChat(req.extractor.client, continuation, {
      replay: replay === '1',
      offsetMs: Number(offset) || 0,
    });
    if (result.error) console.warn(`[livechat] ${req.params.videoId}: ${result.error}`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
