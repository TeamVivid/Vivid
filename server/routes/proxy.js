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

import express, { Router } from 'express';
import fetch from 'node-fetch';
import { getProxyAgent } from '../../extractor/proxyManager.js';
const router = Router();
const CHUNK_SIZE = 4 * 1024 * 1024;

async function fetchWithRetry(url, fetchArgs, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, fetchArgs);
      if (res.status === 403 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries && (err.message?.includes('403') || err.code === 'ECONNRESET')) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
}

router.get('/stream', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const host = parsedUrl.hostname;
    const isAllowed = host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
    if (!isAllowed) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const reqHeaders = { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : Infinity, start + CHUNK_SIZE - 1);
      reqHeaders.Range = `bytes=${start}-${end}`;
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    const fetchArgs = { headers: reqHeaders, signal: controller.signal };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;

    const response = await fetchWithRetry(url, fetchArgs);

    if (!response.ok) return res.status(response.status).json({ error: 'Upstream error' });

    const headersToForward = ['content-type', 'content-length', 'accept-ranges', 'content-range'];
    for (const h of headersToForward) {
      if (response.headers.get(h)) res.set(h, response.headers.get(h));
    }
    if (!response.headers.get('accept-ranges')) res.set('accept-ranges', 'bytes');
    res.status(response.status);

    response.body.on('error', () => res.destroy());
    response.body.pipe(res);
  } catch (e) {
    if (e.name === 'AbortError') return;
    res.status(500).json({ error: e.message });
  }
});

router.get('/hls', async (req, res) => {
  try {
    const { url } = req.query;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsed.hostname !== 'googlevideo.com' && !parsed.hostname.endsWith('.googlevideo.com')) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    if (!/hls_variant|hls_playlist|\.m3u8/.test(parsed.pathname)) {
      return res.redirect(307, `/api/v1/proxy/stream?url=${encodeURIComponent(url)}`);
    }

    const fetchArgs = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' } };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;
    const response = await fetchWithRetry(url, fetchArgs);
    if (!response.ok) return res.status(response.status).json({ error: 'Upstream error' });

    const proxied = (u) => `/api/v1/proxy/hls?url=${encodeURIComponent(new URL(u, url).href)}`;
    const playlist = (await response.text()).split('\n').map(line => {
      const l = line.trim();
      if (!l) return line;
      if (l.startsWith('#')) return l.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxied(u)}"`);
      return proxied(l);
    }).join('\n');

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.send(playlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/image', async (req, res) => {
  try {
    let { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    if (url.startsWith('//')) url = 'https:' + url;

    const allowed = ['i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com'];
    const parsed = new URL(url);
    if (!allowed.some(d => parsed.hostname.endsWith(d))) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const fetchArgs = {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;

    const response = await fetchWithRetry(url, fetchArgs);

    if (!response.ok) return res.status(response.status).end();

    const contentType = response.headers.get('content-type');
    if (contentType) res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sponsorblock', async (req, res) => {
  try {
    const videoId = req.query.videoID || req.query.videoId;
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid videoID' });
    }
    const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}`;
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'Vivid' } });
    if (response.status === 404) {
      return res.json([]);
    }
    if (!response.ok) {
      return res.status(response.status).json({ error: 'SponsorBlock error' });
    }
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const rawParser = express.raw({ type: () => true, limit: '10mb' });
router.post('/sabr', rawParser, async (req, res) => {
  try {
    const targetUrl = req.query.sabr_url || req.headers['x-sabr-url'];
    if (!targetUrl) return res.status(400).json({ error: 'Missing sabr_url' });

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid sabr_url' });
    }

    if (!parsed.hostname.endsWith('googlevideo.com')) {
      return res.status(403).json({ error: 'Target host not allowed' });
    }

    const headers = {
      'User-Agent': 'com.google.android.apps.youtube.vr.pico/1.73.21 (Linux; U; Android 10; en_US; A8110 Build/5.13.7)',
      'Content-Type': 'application/x-protobuf',
      'Accept': 'application/vnd.yt-ump',
      'Accept-Encoding': 'identity',
    };
    if (req.headers['x-goog-visitor-id']) {
      headers['X-Goog-Visitor-Id'] = req.headers['x-goog-visitor-id'];
    }

    const fetchArgs = {
      method: 'POST',
      headers,
      body: req.body,
    };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;

    const response = await fetchWithRetry(targetUrl, fetchArgs);
    const ct = response.headers.get('content-type') || 'application/vnd.yt-ump';
    res.set('Content-Type', ct);
    res.status(response.status);

    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
