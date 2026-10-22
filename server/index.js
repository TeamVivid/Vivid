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

import '../extractor/dnsCache.js';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import VividExtractor from '../extractor/index.js';

import searchRoutes from './routes/search.js';
import videoRoutes from './routes/videos.js';
import channelRoutes from './routes/channels.js';
import trendingRoutes from './routes/trending.js';
import commentRoutes from './routes/comments.js';
import captionRoutes from './routes/captions.js';
import streamRoutes from './routes/stream.js';
import proxyRoutes from './routes/proxy.js';
import livechatRouter from './routes/livechat.js';
import playlistRouter from './routes/playlists.js';
import fullvideoRoutes from './routes/fullvideo.js';
import authRoutes from './routes/auth.js';
import { version, status, checkForUpdates } from './version.js';
import { runWithRequestContext } from '../extractor/innertube.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3067;
const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL || process.env['PRIVACY-POLICY-URL'] || '';

const extractor = new VividExtractor({
  language: process.env.VIVID_LANG || 'en',
});

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`${time} +00:00 ${res.statusCode} ${req.method} ${req.originalUrl} ${ms.toFixed(2)}ms`);
  });
  next();
});

app.use((req, res, next) => {
  req.extractor = extractor;
  runWithRequestContext(next);
});

app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/videos', videoRoutes);
app.use('/api/v1/channels', channelRoutes);
app.use('/api/v1/trending', trendingRoutes);
app.use('/api/v1/comments', commentRoutes);
app.use('/api/v1/captions', captionRoutes);
app.use('/api/v1/streams', streamRoutes);
app.use('/api/v1/stream', streamRoutes);
app.use('/api/v1/proxy', proxyRoutes);
app.use('/api/v1/livechat', livechatRouter);
app.use('/api/v1/playlists', playlistRouter);
app.use('/api/v1/fullvideo', fullvideoRoutes);
app.use('/api/v1/auth', authRoutes);

app.get('/api/v1', (req, res) => {
  res.json({
    name: 'Vivid API',
    version,
    behind: status.behind,
    privacyPolicyUrl: PRIVACY_POLICY_URL,
    website: 'https://github.com/TeamVivid/Vivid'
  });
});

const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/') || (req.path.includes('.') && !req.path.startsWith('/@'))) {
    return res.status(404).send('Not found');
  }
  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  res.sendFile(join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vivid ${version} is running on http://localhost:${PORT}`);
  checkForUpdates();
});

export default app;
