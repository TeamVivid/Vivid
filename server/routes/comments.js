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

router.get('/:id', async (req, res) => {
  try {
    const { continuation, type } = req.query;
    if (!continuation) {
      const detail = await req.extractor.getVideoDetail(req.params.id);
      if (detail.comments.disabled) {
        return res.json({ comments: [], disabled: true });
      }
      if (detail.comments.type === -1) {
        return res.json({ comments: [], error: 'No comments available' });
      }
      const result = await req.extractor.getComments(
        detail.comments.continuationToken, detail.comments.type
      );
      res.json(result);
    } else {
      const result = await req.extractor.getComments(continuation, parseInt(type) || 1);
      res.json(result);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/replies', async (req, res) => {
  try {
    const { continuation } = req.query;
    if (!continuation) return res.status(400).json({ error: 'Missing continuation' });
    const result = await req.extractor.getCommentReplies(continuation, req.query.web === '1');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
