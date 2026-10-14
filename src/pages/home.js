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

import { getTrending, getChannel, proxyImageUrl } from '../api.js';
import { escapeHtml } from '../router.js';
import { getSettings } from '../settings.js';

export async function renderHome(app) {
  let showSubs = localStorage.getItem('vivid_subs_toggle') === 'true';
  document.title = showSubs ? 'Subscriptions - Vivid' : 'Trending - Vivid';
  const subsIds = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
  const isListLayout = getSettings().layoutStyle === 'list';

  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
      <h1 class="page-title" style="margin:0;">${showSubs ? 'Subscriptions' : 'Trending'}</h1>
      <label style="background:var(--bg-card); padding:6px 16px; border-radius:16px; border:1px solid var(--border-color); cursor:pointer;">
        <input type="checkbox" id="toggle-subs" ${showSubs ? 'checked' : ''} ${subsIds.length === 0 ? 'disabled' : ''}> Show Subscriptions
      </label>
    </div>
    <div class="${isListLayout ? 'video-list' : 'video-grid'}" id="home-grid">
      <div class="loading" style="grid-column:1/-1;"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('toggle-subs').addEventListener('change', (e) => {
    localStorage.setItem('vivid_subs_toggle', e.target.checked ? 'true' : 'false');
    renderHome(app);
  });

  const grid = document.getElementById('home-grid');

  if (showSubs && subsIds.length > 0) {
    try {
      const allVideos = [];
      const fetchChannel = async (id) => {
        try {
          const cData = await getChannel(id);
          return (cData.videos || []).slice(0, 10);
        } catch(e) { return []; }
      };
      
      const results = await Promise.all(subsIds.map(id => fetchChannel(id)));
      for (const res of results) {
        allVideos.push(...res);
      }
      
      grid.innerHTML = allVideos.map(v => videoCard(v, isListLayout)).join('');
      if (allVideos.length === 0) grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;">No videos from subscriptions found</p>';
    } catch(e) {
      grid.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
    }
  } else {
    try {
      const data = await getTrending();
      if (data.error) {
        grid.innerHTML = `<div class="error-msg">${escapeHtml(data.error)}</div>`;
        return;
      }
      const videos = data.videos || [];
      grid.innerHTML = videos.map(v => videoCard(v, isListLayout)).join('');
      if (videos.length === 0) grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;">No trending videos found</p>';
    } catch(e) {
      grid.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
    }
  }
}

export function videoCard(v, isList = false) {
  if (!v) return '';
  const href = v.url || (v.videoId ? `/watch?v=${v.videoId}` : '#');
  let thumb = v.thumbnailUrl || (v.videoId ? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg` : '');
  if (thumb.includes('/default.jpg')) thumb = thumb.replace('/default.jpg', '/hqdefault.jpg');

  if (isList) {
    return `
      <a href="#${href}" class="video-list-item">
        <div class="video-list-thumb">
          <img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">
          ${v.duration ? `<span class="video-card-duration">${escapeHtml(v.duration)}</span>` : ''}
        </div>
        <div class="video-list-info">
          <div class="video-list-title">${escapeHtml(v.title || '')}</div>
          <div class="video-list-meta">
            ${v.author ? `<span class="video-card-author">${escapeHtml(v.author)}</span>` : ''}
            <span class="video-card-stats">${[v.views, v.publishDate].filter(Boolean).map(escapeHtml).join(' • ')}</span>
          </div>
        </div>
      </a>
    `;
  }

  return `
    <div class="video-card">
      <a href="#${href}" class="video-card-link">
        <div class="video-card-thumb">
          <img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">
          ${v.duration ? `<span class="video-card-duration">${escapeHtml(v.duration)}</span>` : ''}
        </div>
        <div class="video-card-info">
          <div class="video-card-title">${escapeHtml(v.title || '')}</div>
          <div class="video-card-meta">
            ${v.author ? `<span class="video-card-author">${escapeHtml(v.author)}</span>` : ''}
            <span class="video-card-stats">${[v.views, v.publishDate].filter(Boolean).map(escapeHtml).join(' • ')}</span>
          </div>
        </div>
      </a>
    </div>
  `;
}
