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

import { getTextFromObject } from './utils.js';
import fetch from 'node-fetch';
import { getProxyAgent } from './proxyManager.js';
import { forceYtDlp, isYtDlpAvailable, getYtDlpInfo } from './ytdlp.js';

const captionTracksCache = new Map();
const vttCache = new Map();

export function cacheCaptionTracks(videoId, captionsRenderer) {
  if (!videoId || !captionsRenderer) return;
  const result = { baseLanguages: [], translationLanguages: [], error: '', cachedAt: Date.now() };
  for (const track of captionsRenderer.captionTracks || []) {
    result.baseLanguages.push({
      name: getTextFromObject(track.name) || '',
      languageCode: track.languageCode || '',
      baseUrl: track.baseUrl || '',
      isTranslatable: track.isTranslatable || false,
    });
  }
  for (const lang of captionsRenderer.translationLanguages || []) {
    result.translationLanguages.push({
      name: getTextFromObject(lang.languageName) || '',
      languageCode: lang.languageCode || '',
    });
  }
  if (result.baseLanguages.length > 0) {
    captionTracksCache.set(videoId, result);
    if (captionTracksCache.size > 500) {
      const oldest = captionTracksCache.keys().next().value;
      captionTracksCache.delete(oldest);
    }
  }
}

async function getCaptionTracksViaInnertube(client, videoId) {
  const result = { baseLanguages: [], translationLanguages: [], error: '' };
  try {
    let data = await client.player(videoId, false);
    let captions = data?.captions?.playerCaptionsTracklistRenderer;
    
    if (!captions) {
      const { ANDROID } = await import('./constants.js');
      data = await client.player(videoId, true, ANDROID);
      captions = data?.captions?.playerCaptionsTracklistRenderer;
    }

    if (!captions) return result;

    for (const track of captions.captionTracks || []) {
      result.baseLanguages.push({
        name: getTextFromObject(track.name) || '',
        languageCode: track.languageCode || '',
        baseUrl: track.baseUrl || '',
        isTranslatable: track.isTranslatable || false,
      });
    }
    for (const lang of captions.translationLanguages || []) {
      result.translationLanguages.push({
        name: getTextFromObject(lang.languageName) || '',
        languageCode: lang.languageCode || '',
      });
    }
  } catch (e) { result.error = e.message; }
  return result;
}

async function getCaptionTracksViaYtdlp(videoId) {
  const result = { baseLanguages: [], translationLanguages: [], error: '' };
  const info = await getYtDlpInfo(videoId);
  const pickUrl = (formats) => (formats.find(f => f.ext === 'json3') || formats[0])?.url || '';

  for (const [code, formats] of Object.entries(info.subtitles || {})) {
    if (code === 'live_chat') continue;
    result.baseLanguages.push({
      name: formats[0]?.name || code,
      languageCode: code,
      baseUrl: pickUrl(formats),
      isTranslatable: false,
    });
  }

  for (const [code, formats] of Object.entries(info.automatic_captions || {})) {
    const name = formats[0]?.name || code;
    if (!code.endsWith('-orig')) {
      result.translationLanguages.push({ name, languageCode: code });
      continue;
    }
    const languageCode = code.replace(/-orig$/, '');
    if (result.baseLanguages.some(t => t.languageCode === languageCode)) continue;
    result.baseLanguages.push({ name, languageCode, baseUrl: pickUrl(formats), isTranslatable: true });
  }

  return result;
}

export async function getCaptionTracks(client, videoId) {
  const cached = captionTracksCache.get(videoId);
  if (cached && (Date.now() - (cached.cachedAt || 0) < 3600 * 1000)) {
    return cached;
  }

  if (forceYtDlp()) {
    try {
      const res = await getCaptionTracksViaYtdlp(videoId);
      if (res.baseLanguages.length) {
        res.cachedAt = Date.now();
        captionTracksCache.set(videoId, res);
      }
      return res;
    } catch (e) {
      return { baseLanguages: [], translationLanguages: [], error: `yt-dlp failed (FORCE-YT-DLP is enabled): ${e.message}` };
    }
  }

  const result = await getCaptionTracksViaInnertube(client, videoId);
  if (result.baseLanguages.length || !(await isYtDlpAvailable())) {
    if (result.baseLanguages.length) {
      result.cachedAt = Date.now();
      captionTracksCache.set(videoId, result);
    }
    return result;
  }

  try {
    const ytdlpRes = await getCaptionTracksViaYtdlp(videoId);
    if (ytdlpRes.baseLanguages.length) {
      ytdlpRes.cachedAt = Date.now();
      captionTracksCache.set(videoId, ytdlpRes);
      return ytdlpRes;
    }
    return result;
  } catch {
    return result;
  }
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

export async function getCaptionContent(baseUrl, translationLang = '') {
  try {
    const captionUrl = new URL(baseUrl);
    if (translationLang) captionUrl.searchParams.set('tlang', translationLang);
    captionUrl.searchParams.set('fmt', 'json3');
    captionUrl.searchParams.set('xorb', '2');
    captionUrl.searchParams.set('xobt', '3');
    captionUrl.searchParams.set('xovt', '3');
    
    const url = captionUrl.toString();
    const fetchArgs = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
    };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;
    const res = await fetch(url, fetchArgs);
    if (!res.ok) throw new Error(`Failed to fetch captions: ${res.status}`);
    
    const rawText = await res.text();
    const captions = [];

    try {
      const data = JSON.parse(rawText);
      for (const event of data.events || []) {
        if (!event.segs) continue;
        const text = (event.segs || []).map(s => s.utf8 || '').join('');
        if (!text.trim()) continue;
        captions.push({
          startTime: (event.tStartMs || 0) / 1000,
          endTime: ((event.tStartMs || 0) + (event.dDurationMs || 0)) / 1000,
          content: text.replace(/\n+/g, ' ').trim(),
        });
      }
      return { captions, error: '' };
    } catch {}

    const xmlRegex = /<(?:text|p)\b[^>]*?(?:start="([^"]+)"|t="([^"]+)")(?:[^>]*?(?:dur="([^"]+)"|d="([^"]+)"))?[^>]*>([\s\S]*?)<\/(?:text|p)>/gi;
    let match;
    while ((match = xmlRegex.exec(rawText)) !== null) {
      const startSec = match[1] ? parseFloat(match[1]) : (match[2] ? parseInt(match[2], 10) / 1000 : 0);
      const durSec = match[3] ? parseFloat(match[3]) : (match[4] ? parseInt(match[4], 10) / 1000 : 0);
      const text = decodeXmlEntities(match[5].replace(/<[^>]+>/g, '').trim());
      if (text) {
        captions.push({
          startTime: startSec,
          endTime: startSec + durSec,
          content: text,
        });
      }
    }

    return { captions, error: captions.length ? '' : 'No caption segments parsed' };
  } catch (e) {
    return { captions: [], error: e.message };
  }
}

export function fmtVttTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hh = String(Math.floor(totalMs / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(totalMs % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export async function getCaptionVtt(baseUrl, translationLang = '') {
  const cacheKey = `${baseUrl}|${translationLang || ''}`;
  const cached = vttCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.vtt;
  }

  const { captions, error } = await getCaptionContent(baseUrl, translationLang);
  if (error && (!captions || !captions.length)) {
    throw new Error(error || 'Failed to fetch captions');
  }

  let vtt = 'WEBVTT\n\n';
  for (const cap of captions) {
    vtt += `${fmtVttTime(cap.startTime)} --> ${fmtVttTime(cap.endTime)}\n${cap.content}\n\n`;
  }

  vttCache.set(cacheKey, { vtt, expiresAt: Date.now() + 7200 * 1000 });
  if (vttCache.size > 1000) {
    const oldest = vttCache.keys().next().value;
    vttCache.delete(oldest);
  }

  return vtt;
}

export default {
  getCaptionTracks,
  getCaptionContent,
  getCaptionVtt,
  cacheCaptionTracks,
  fmtVttTime
};
