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
    const result = await req.extractor.getChannel(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/streams', async (req, res) => {
  try {
    const result = await req.extractor.getChannelStreams(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/shorts', async (req, res) => {
  try {
    const result = await req.extractor.getChannelShorts(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/playlists', async (req, res) => {
  try {
    const channel = await req.extractor.getChannel(req.params.id);
    const browseId = channel.playlistTabBrowseId || channel.id || req.params.id;
    const params = channel.playlistTabParams || 'EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA';
    const result = await req.extractor.loadChannelPlaylists(browseId, params);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/community', async (req, res) => {
  try {
    const { continuation } = req.query;
    const channelUrl = `https://m.youtube.com/channel/${req.params.id}`;
    const result = await req.extractor.loadCommunityPosts(channelUrl, continuation || null);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/continuation', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing continuation token' });
    const result = await req.extractor.loadMoreChannelItems(token);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
