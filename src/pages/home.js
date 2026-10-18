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
  const settings = getSettings();
  const isListLayout = settings.layoutStyle === 'list';

  if (settings.disablePopularHome && !showSubs) {
    document.title = 'Vivid';
    app.innerHTML = `
      <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:1rem;">
        <label style="background:var(--bg-card); padding:6px 16px; border-radius:16px; border:1px solid var(--border-color); cursor:pointer;">
          <input type="checkbox" id="toggle-subs" ${showSubs ? 'checked' : ''} ${subsIds.length === 0 ? 'disabled' : ''}> Show Subscriptions
        </label>
      </div>
      <div id="home-grid"></div>
    `;

    document.getElementById('toggle-subs').addEventListener('change', (e) => {
      localStorage.setItem('vivid_subs_toggle', e.target.checked ? 'true' : 'false');
      renderHome(app);
    });
    return;
  }

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
        } catch { return []; }
      };
      
      const results = await Promise.all(subsIds.map(id => fetchChannel(id)));
      for (const res of results) {
        allVideos.push(...res);
      }
      
      grid.innerHTML = allVideos.map(v => videoCard(v, isListLayout)).join('');
      if (allVideos.length === 0) grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;">No videos from subscriptions found</p>';
    } catch (e) {
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
    } catch (e) {
      grid.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
    }
  }
}

export function verifiedBadge(verified) {
  return verified
    ? '<svg class="verified-badge" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-label="Verified"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.5 14.5l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z"/></svg>'
    : '';
}

export function videoCard(v, isList = false) {
  if (!v) return '';
  const vid = v.videoId || v.id || '';
  const href = v.url || (vid ? `/watch?v=${vid}` : '#');
  let thumb = v.thumbnailUrl || (vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : '');
  if (thumb.includes('/default.jpg')) thumb = thumb.replace('/default.jpg', '/mqdefault.jpg');
  if (thumb.includes('/hqdefault.jpg')) thumb = thumb.replace('/hqdefault.jpg', '/mqdefault.jpg');

  const channelHref = v.authorId
    ? `#/channel/${encodeURIComponent(v.authorId)}`
    : (v.authorUrl ? `#${v.authorUrl.startsWith('/') ? v.authorUrl : '/' + v.authorUrl}` : '');

  const authorHtml = v.author
    ? (channelHref
        ? `<a href="${channelHref}" class="video-card-author" onclick="event.stopPropagation();">${escapeHtml(v.author)}${verifiedBadge(v.verified)}</a>`
        : `<span class="video-card-author">${escapeHtml(v.author)}${verifiedBadge(v.verified)}</span>`)
    : '';

  if (isList) {
    return `
      <div class="video-list-entry" style="position:relative;">
        <div class="video-list-item" onclick="if (!event.target.closest('a')) location.hash = '#${href}';" style="cursor:pointer;">
          <a href="#${href}" class="video-list-thumb" tabindex="-1">
            <img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">
            ${v.duration ? `<span class="video-card-duration">${escapeHtml(v.duration)}</span>` : ''}
          </a>
          <div class="video-list-info">
            <a href="#${href}" class="video-list-title" style="display:block;text-decoration:none;">${escapeHtml(v.title || '')}</a>
            <div class="video-list-meta">
              ${authorHtml}
              <span class="video-card-stats">${[v.views, v.publishDate].filter(Boolean).map(escapeHtml).join(' • ')}</span>
            </div>
          </div>
        </div>
        ${vid ? `<a href="#/watch?v=${vid}&audio=1" class="video-listen-pill" title="Listen (Audio Only)">🎧 Listen</a>` : ''}
      </div>
    `;
  }

  return `
    <div class="video-card" style="position:relative;">
      <div class="video-card-link" onclick="if (!event.target.closest('a')) location.hash = '#${href}';" style="cursor:pointer;">
        <a href="#${href}" class="video-card-thumb" style="display:block;" tabindex="-1">
          <img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">
          ${v.duration ? `<span class="video-card-duration">${escapeHtml(v.duration)}</span>` : ''}
        </a>
        <div class="video-card-info">
          <a href="#${href}" class="video-card-title" style="display:block;text-decoration:none;">${escapeHtml(v.title || '')}</a>
          <div class="video-card-meta">
            ${authorHtml}
            <span class="video-card-stats">${[v.views, v.publishDate].filter(Boolean).map(escapeHtml).join(' • ')}</span>
          </div>
        </div>
      </div>
      ${vid ? `<a href="#/watch?v=${vid}&audio=1" class="video-listen-pill" title="Listen (Audio Only)">🎧 Listen</a>` : ''}
    </div>
  `;
}
