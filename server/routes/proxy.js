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
import https from 'https';
import fetch from 'node-fetch';
import { getProxyAgent } from '../../extractor/proxyManager.js';
import { getCookieHeader, getAuthHeader } from '../../extractor/cookies.js';
import { getPlayerCode, getPlayerEngine } from '../../extractor/absolutesolver/index.js';
import { TVHTML5_SIMPLY } from '../../extractor/constants.js';
const router = Router();
const CHUNK_SIZE = 10 * 1024 * 1024;
const REDIRECTOR_HOST = 'redirector.googlevideo.com';
const CONNECT_ERRORS = ['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'];

const browserHttpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  maxSockets: 64,
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-RSA-AES256-SHA',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA',
    'AES256-SHA'
  ].join(':'),
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3'
});

function nextFallbackUrl(url, triedHosts) {
  const next = new URL(url);
  const host = [
    REDIRECTOR_HOST,
    ...[1, 2, 3, 4, 5].map(n => next.hostname.replace(/^rr\d+/, `rr${n}`))
  ].find(h => !triedHosts.has(h));
  if (!host) return null;
  triedHosts.add(host);
  next.hostname = host;
  return next.toString();
}

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

router.get('/captions', async (req, res) => {
  try {
    const { url, tlang } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    const host = parsed.hostname;
    const isAllowed = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
    if (!isAllowed) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    if (req.query.format === 'json') {
      return res.json(await req.extractor.getCaptionContent(url, tlang || ''));
    }
    const vtt = await req.extractor.getCaptionVtt(url, tlang || '');
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(?:7C|60|5E)/g, unescape);
}

function isGooglevideoHost(host) {
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
}

router.options('/stream', (req, res) => {
  res.set({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Range'
  });
  res.status(200).send('OK');
});

router.get('/stream', async (req, res) => {
  try {
    const { url, title } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (!isGooglevideoHost(parsedUrl.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const expire = parsedUrl.searchParams.get('expire');
    if (expire == null || Number(expire) < Math.floor(Date.now() / 1000)) {
      return res.status(400).json({
        error: 'Expire query string undefined or videoplayback URL has expired.'
      });
    }

    const clientType = parsedUrl.searchParams.get('c') || '';
    let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    if (clientType === 'ANDROID') {
      ua = 'com.google.android.youtube/1537338816 (Linux; U; Android 13; en_US; ; Build/TQ2A.230505.002; Cronet/113.0.5672.24)';
    } else if (clientType === 'IOS') {
      ua = 'com.google.ios.youtube/19.32.8 (iPhone14,5; U; CPU iOS 17_6 like Mac OS X;)';
    }

    const reqHeaders = {
      'User-Agent': ua,
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com',
      'DNT': '1'
    };

    const cookieHeader = getCookieHeader();
    if (cookieHeader) reqHeaders.Cookie = cookieHeader;

    const rangeHeader = req.headers.range;
    let requestBytes = null;
    let firstByte = null;
    let lastByte = null;
    if (rangeHeader) {
      requestBytes = rangeHeader.replace(/^bytes=/, '');
      const parts = requestBytes.split('-');
      firstByte = parts[0];
      lastByte = parts[1];
      parsedUrl.searchParams.set('range', requestBytes);
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const agent = getProxyAgent() || browserHttpsAgent;

    let location = parsedUrl.toString();
    let headResponse;
    const triedHosts = new Set([new URL(location).hostname]);
    for (let i = 0; i < 10; i++) {
      let r;
      try {
        r = await fetch(location, {
          method: 'HEAD',
          headers: reqHeaders,
          redirect: 'manual',
          signal: controller.signal,
          agent
        });
      } catch (err) {
        const fallback = CONNECT_ERRORS.includes(err.code) && nextFallbackUrl(location, triedHosts);
        if (!fallback) throw err;
        location = fallback;
        continue;
      }

      if (r.status === 403) {
        return res.status(403).json({ error: 'Upstream error' });
      }

      const next = r.headers.get('location');
      if (next) {
        const nextUrl = new URL(next, location);
        if (!isGooglevideoHost(nextUrl.hostname)) {
          return res.status(403).json({ error: 'Redirect target not allowed' });
        }
        location = nextUrl.toString();
        continue;
      }

      headResponse = r;
      break;
    }
    if (!headResponse) {
      return res.status(502).json({ error: 'Google redirected too many times' });
    }

    const fetchArgs = {
      method: 'POST',
      body: Buffer.from([0x78, 0]),
      headers: reqHeaders,
      signal: controller.signal,
      agent
    };

    const openUpstream = async (target) => {
      let upstream = await fetchWithRetry(target, fetchArgs);
      if (upstream && (upstream.status === 405 || upstream.status === 403)) {
        const getArgs = { ...fetchArgs, method: 'GET' };
        delete getArgs.body;
        const getRes = await fetchWithRetry(target, getArgs);
        if (getRes && getRes.ok) {
          fetchArgs.method = 'GET';
          delete fetchArgs.body;
          upstream = getRes;
        }
      }
      return upstream;
    };

    const totalLength = Number(headResponse.headers.get('content-length') || 0);
    if (!rangeHeader && title && totalLength > CHUNK_SIZE) {
      res.set({
        'access-control-allow-origin': '*',
        'content-length': String(totalLength),
        'content-type': headResponse.headers.get('content-type') || 'application/octet-stream',
        'content-disposition': `attachment; filename="${encodeURIComponent(title)}"; filename*=UTF-8''${encodeRFC5987ValueChars(title)}`
      });
      for (let offset = 0; offset < totalLength; offset += CHUNK_SIZE) {
        const chunkUrl = new URL(location);
        chunkUrl.searchParams.set('range', `${offset}-${Math.min(offset + CHUNK_SIZE, totalLength) - 1}`);
        const chunkRes = await openUpstream(chunkUrl.toString());
        if (!chunkRes.ok) return res.destroy();
        await new Promise((resolve, reject) => {
          chunkRes.body.on('error', reject);
          chunkRes.body.on('end', resolve);
          chunkRes.body.pipe(res, { end: false });
        });
      }
      return res.end();
    }

    const response = await openUpstream(location);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream error' });
    }

    const headersForResponse = { 'access-control-allow-origin': '*' };
    for (const h of ['content-length', 'accept-ranges', 'content-type', 'expires', 'last-modified']) {
      const v = headResponse.headers.get(h) || response.headers.get(h);
      if (v) headersForResponse[h] = v;
    }
    if (!headersForResponse['accept-ranges']) headersForResponse['accept-ranges'] = 'bytes';

    if (title) {
      headersForResponse['content-disposition'] =
        `attachment; filename="${encodeURIComponent(title)}"; filename*=UTF-8''${encodeRFC5987ValueChars(title)}`;
    }

    let responseStatus = headResponse.status;
    if (requestBytes && responseStatus === 200) {
      const clen = parsedUrl.searchParams.get('clen') || '*';
      if (lastByte) {
        responseStatus = 206;
        headersForResponse['content-range'] = `bytes ${requestBytes}/${clen}`;
      } else {
        const bytesReceived = Number(headersForResponse['content-length'] || 0);
        const start = Number(firstByte || 0);
        const totalContentLength = start + bytesReceived;
        if (firstByte !== '0') responseStatus = 206;
        headersForResponse['content-range'] =
          `bytes ${firstByte}-${totalContentLength - 1}/${totalContentLength}`;
      }
    } else if (response.headers.get('content-range')) {
      headersForResponse['content-range'] = response.headers.get('content-range');
    }

    res.set(headersForResponse);
    res.status(responseStatus);

    response.body.on('error', () => res.destroy());
    response.body.pipe(res);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('[proxy/stream]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
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

    const isSegment = parsed.pathname.includes('/file/seg') || parsed.pathname.endsWith('.ts') || parsed.pathname.endsWith('.m4s') || !/hls_variant|hls_playlist|\.m3u8$/.test(parsed.pathname);
    if (isSegment) {
      let targetUrl = url;
      const nMatch = targetUrl.match(/\/n\/([^/]+)/) || targetUrl.match(/[?&]n=([^&]+)/);
      if (nMatch) {
        try {
          const pCode = await getPlayerCode('tv_simply', TVHTML5_SIMPLY.userAgent);
          const engine = getPlayerEngine('tv_simply', pCode.code);
          const nDec = engine.getN();
          const rawN = decodeURIComponent(nMatch[1]);
          const solvedN = nDec(rawN);
          if (solvedN) {
            if (targetUrl.includes('/n/' + nMatch[1])) {
              targetUrl = targetUrl.replace('/n/' + nMatch[1], '/n/' + encodeURIComponent(solvedN));
            } else if (targetUrl.includes('n=' + nMatch[1])) {
              targetUrl = targetUrl.replace('n=' + nMatch[1], 'n=' + encodeURIComponent(solvedN));
            }
          }
        } catch {}
      }

      const fetchArgs = {
        headers: {
          'User-Agent': TVHTML5_SIMPLY.userAgent,
          'Accept': '*/*'
        }
      };
      if (req.headers.range) {
        fetchArgs.headers['Range'] = req.headers.range;
      }
      const agent = getProxyAgent();
      if (agent) fetchArgs.agent = agent;
      const response = await fetchWithRetry(targetUrl, fetchArgs);
      if (!response.ok) {
        console.warn(`[proxy/hls] segment ${response.status} ${parsed.hostname}${parsed.pathname.slice(0, 80)}`);
        return res.status(response.status).end();
      }
      const ct = response.headers.get('content-type') || 'application/octet-stream';
      res.set('Content-Type', ct);
      const cl = response.headers.get('content-length');
      if (cl) res.set('Content-Length', cl);
      const cr = response.headers.get('content-range');
      if (cr) res.set('Content-Range', cr);
      res.set('Accept-Ranges', 'bytes');
      res.set('Cache-Control', 'public, max-age=3600');
      res.status(response.status);
      response.body.on('error', () => res.destroy());
      return response.body.pipe(res);
    }

    const fetchArgs = { headers: { 'User-Agent': TVHTML5_SIMPLY.userAgent, 'Accept-Encoding': 'identity' } };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;
    const response = await fetchWithRetry(url, fetchArgs);
    if (!response.ok) {
      console.warn(`[proxy/hls] playlist ${response.status} ${parsed.hostname}${parsed.pathname.slice(0, 80)}`);
      return res.status(response.status).json({ error: 'Upstream error' });
    }

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

    const allowed = ['i.ytimg.com', 'ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com'];
    const parsed = new URL(url);
    if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    if (url.includes('/hqdefault.jpg')) {
      url = url.replace('/hqdefault.jpg', '/mqdefault.jpg');
    }

    const fetchArgs = {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;

    let response = await fetchWithRetry(url, fetchArgs);
    if (response.status === 404 && (url.includes('/maxresdefault.jpg') || url.includes('/hq720.jpg'))) {
      const fallbackUrl = url.replace(/\/(maxresdefault|hq720)\.jpg/, '/mqdefault.jpg');
      const fallbackRes = await fetchWithRetry(fallbackUrl, fetchArgs);
      if (fallbackRes.ok) response = fallbackRes;
    }

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
    const defaultCategories = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'music_offtopic', 'preview', 'filler', 'poi_highlight'];
    let categoriesParam = req.query.categories;
    if (!categoriesParam) {
      categoriesParam = JSON.stringify(defaultCategories);
    } else if (typeof categoriesParam === 'string' && !categoriesParam.startsWith('[')) {
      categoriesParam = JSON.stringify(categoriesParam.split(',').map(c => c.trim()).filter(Boolean));
    }
    let url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(categoriesParam)}`;
    if (req.query.actionTypes) {
      let actionTypesParam = req.query.actionTypes;
      if (typeof actionTypesParam === 'string' && !actionTypesParam.startsWith('[')) {
        actionTypesParam = JSON.stringify(actionTypesParam.split(',').map(a => a.trim()).filter(Boolean));
      }
      url += `&actionTypes=${encodeURIComponent(actionTypesParam)}`;
    }
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
    const rawTargetUrl = req.query.sabr_url || req.headers['x-sabr-url'];
    if (!rawTargetUrl) return res.status(400).json({ error: 'Missing sabr_url' });

    let parsed;
    try {
      parsed = new URL(rawTargetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid sabr_url' });
    }

    if (!parsed.hostname.endsWith('googlevideo.com')) {
      return res.status(403).json({ error: 'Target host not allowed' });
    }

    const clientName = req.headers['x-client-name'] || req.query.client_name;
    const origin = clientName === 'MWEB' ? 'https://m.youtube.com' : 'https://www.youtube.com';

    let defaultUa = 'com.google.android.apps.youtube.vr.pico/1.73.21 (Linux; U; Android 10; en_US; A8110 Build/5.13.7)';
    if (clientName === 'WEB') {
      defaultUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
    } else if (clientName === 'MWEB') {
      defaultUa = 'Mozilla/5.0 (Linux; Android 16; Pixel Tablet Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Safari/537.36';
    } else if (clientName === 'TVHTML5' || clientName === 'TV') {
      defaultUa = 'Mozilla/5.0 (Linux arm64-v8a; Android 10) Cobalt/25.lts.30.1034958-gold (unlike Gecko) v8/8.8.278.17-jit gles Starboard/15, Sony_ATV_sdm845_13140765/52.1.C.0.268 (KDDI, SOV38) com.google.android.youtube.tv/5.30.301';
    }

    const ua = req.headers['x-client-user-agent']
      || req.headers['x-user-agent']
      || defaultUa;

    if (!parsed.searchParams.has('cver')) {
      parsed.searchParams.set('cver', '2.20261016.01.00');
    }

    const headers = {
      'User-Agent': ua,
      'Content-Type': 'application/x-protobuf',
      'Accept': 'application/vnd.yt-ump',
      'Accept-Encoding': 'identity',
    };

    if (origin) {
      headers['Origin'] = origin;
      headers['Referer'] = origin + '/';
    }

    if (clientName === 'WEB') {
      headers['sec-ch-ua'] = '"Not A(Brand";v="99", "Chromium";v="154"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Linux"';
    } else {
      const visitorId = req.headers['x-goog-visitor-id'] || req.query.visitor_data;
      if (visitorId) {
        headers['X-Goog-Visitor-Id'] = visitorId;
      }
    }

    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    } else {
      const cookieHeader = getCookieHeader();
      if (cookieHeader) headers['Cookie'] = cookieHeader;
    }

    const finalTargetUrl = parsed.toString();

    const fetchArgs = {
      method: 'POST',
      headers,
      body: req.body,
    };
    fetchArgs.agent = getProxyAgent() || browserHttpsAgent;
    fetchArgs.redirect = 'manual';

    const triedHosts = new Set([parsed.hostname]);
    let target = finalTargetUrl;
    let response;
    for (let i = 0; i < 10 && !response; i++) {
      let r;
      try {
        r = await fetchWithRetry(target, fetchArgs);
      } catch (err) {
        const fallback = CONNECT_ERRORS.includes(err.code) && nextFallbackUrl(target, triedHosts);
        if (!fallback) throw err;
        target = fallback;
        continue;
      }
      const next = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && next) {
        const nextUrl = new URL(next, target);
        if (!isGooglevideoHost(nextUrl.hostname)) {
          return res.status(403).json({ error: 'Redirect target not allowed' });
        }
        target = nextUrl.toString();
        continue;
      }
      response = r;
    }
    if (!response) return res.status(502).json({ error: 'No reachable googlevideo host' });

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
