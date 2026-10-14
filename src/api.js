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


const API_BASE = '/api/v1';

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 403 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt < maxRetries && (e.message?.includes('403') || e.code === 'ECONNRESET')) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetchWithRetry(url, options);
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

export async function searchVideos(query, filters = {}, continuation = null) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.sort_by) params.set('sort_by', filters.sort_by);
  if (filters.type) params.set('type', filters.type);
  if (filters.date) params.set('date', filters.date);
  if (filters.duration) params.set('duration', filters.duration);
  if (continuation) params.set('continuation', continuation);
  return fetchJson(`${API_BASE}/search?${params}`);
}

export async function getTrending() {
  return fetchJson(`${API_BASE}/trending`);
}

export async function getVideo(id, listId = null) {
  const params = listId ? `?list=${encodeURIComponent(listId)}` : '';
  return fetchJson(`${API_BASE}/videos/${id}${params}`);
}

export async function getStreams(id, includeSabr = true) {
  const qs = includeSabr ? '?include_and_try_sabr=true' : '';
  return fetchJson(`${API_BASE}/streams/${id}${qs}`);
}

export async function getComments(id, continuation = null, type = null) {
  const params = new URLSearchParams();
  if (continuation) params.set('continuation', continuation);
  if (type !== null) params.set('type', type);
  const qs = params.toString();
  return fetchJson(`${API_BASE}/comments/${id}${qs ? '?' + qs : ''}`);
}

export async function getCommentReplies(id, continuation) {
  const params = new URLSearchParams();
  params.set('continuation', continuation);
  return fetchJson(`${API_BASE}/comments/${id}/replies?${params.toString()}`);
}

export async function getLiveChat(id, continuation, { replay = false, offsetMs = 0 } = {}) {
  const qs = `continuation=${encodeURIComponent(continuation)}${replay ? `&replay=1&offset=${Math.floor(offsetMs)}` : ''}`;
  return fetchJson(`${API_BASE}/livechat/${id}?${qs}`);
}

export async function getChannel(id) {
  return fetchJson(`${API_BASE}/channels/${encodeURIComponent(id)}`);
}

export async function getChannelStreams(id) {
  return fetchJson(`${API_BASE}/channels/${encodeURIComponent(id)}/streams`);
}

export async function getChannelShorts(id) {
  return fetchJson(`${API_BASE}/channels/${encodeURIComponent(id)}/shorts`);
}

export async function getChannelPlaylists(id) {
  return fetchJson(`${API_BASE}/channels/${encodeURIComponent(id)}/playlists`);
}

export async function getChannelCommunity(id) {
  return fetchJson(`${API_BASE}/channels/${encodeURIComponent(id)}/community`);
}

export async function getChannelContinuation(id, token) {
  return fetchJson(`${API_BASE}/channels/${encodeURIComponent(id)}/continuation?token=${encodeURIComponent(token)}`);
}

export function proxyImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  return `${API_BASE}/proxy/image?url=${encodeURIComponent(url)}`;
}

export function proxyHlsUrl(url) {
  if (!url) return '';
  return `${API_BASE}/proxy/hls?url=${encodeURIComponent(url)}`;
}

export function proxyStreamUrl(url) {
  if (!url) return '';
  return `${API_BASE}/proxy/stream?url=${encodeURIComponent(url)}`;
}

export async function getSponsorBlockSegments(videoId) {
  return fetchJson(`${API_BASE}/proxy/sponsorblock?videoID=${encodeURIComponent(videoId)}`);
}

export async function getCaptions(id) {
  return fetchJson(`${API_BASE}/captions/${id}`);
}

export async function getCaptionContent(id, lang) {
  return fetchJson(`${API_BASE}/captions/${id}/${lang}`);
}

export async function getSearchSuggestions(query) {
  return fetchJson(`${API_BASE}/search/suggest?q=${encodeURIComponent(query)}`);
}

export async function getPlaylist(id) {
  return fetchJson(`${API_BASE}/playlists/${id}`);
}

export async function registerAccount(username, password) {
  return fetchJson(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export async function loginAccount(username, password) {
  return fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export async function getAccountMe(token) {
  return fetchJson(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

export async function syncAccount(token, data) {
  return fetchJson(`${API_BASE}/auth/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
}

export async function logoutAccount(token) {
  return fetchJson(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
}
