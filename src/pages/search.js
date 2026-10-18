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

import { searchVideos, proxyImageUrl } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { getSettings } from '../settings.js';
import { videoCard, verifiedBadge } from './home.js';

export async function renderSearch(app, params) {
  const query = params.search_query || params.q || '';
  if (!query) {
    app.innerHTML = '<div class="error-msg">No search query provided</div>';
    return;
  }

  const filters = {
    sort_by: params.sort_by || '',
    type: params.type || '',
    date: params.date || '',
    duration: params.duration || '',
    features: params.features || '',
  };
  document.title = `${query} - Vivid`;
  const data = await searchVideos(query, filters);

  if (data.error) {
    app.innerHTML = `<div class="error-msg">${escapeHtml(data.error)}</div>`;
    return;
  }

  const showShorts = getSettings().showShortsInResults;
  const results = (data.results || []).filter(r => showShorts || r.type !== 'shorts');
  let continuationToken = data.continuationToken || '';
  const isListLayout = getSettings().layoutStyle === 'list';

  app.innerHTML = `
  <h1 class="page-title">
  Search: "${escapeHtml(query)}"
  <span class="page-subtitle">${data.estimatedResults ? ` ${escapeHtml(data.estimatedResults)} results` : ''}</span>
  </h1>
  <div class="search-chips">${renderChips(query, filters, showShorts)}<button id="toggle-filters-btn" class="search-chip" style="cursor:pointer;flex-shrink:0;">Toggle Filters</button></div>
  <div id="filters-container" style="display:none;">
  ${renderFilters(query, filters)}
  </div>
  <div id="results-container">
  ${results.length === 0 ? '<p style="color:var(--text-muted);padding:2rem;text-align:center">No results found</p>' : ''}
  <div class="${isListLayout ? 'video-list' : 'video-grid'}" id="results-list">
  ${results.map(r => renderResult(r, isListLayout)).join('')}
  </div>
  </div>
  ${continuationToken ? '<button class="load-more" id="load-more-search">Load more</button>' : ''}
  `;

  const toggleBtn = document.getElementById('toggle-filters-btn');
  const filtersContainer = document.getElementById('filters-container');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const open = filtersContainer.style.display === 'none';
      filtersContainer.style.display = open ? 'block' : 'none';
      toggleBtn.classList.toggle('active', open);
    });
  }

  app.querySelectorAll('.filter-select').forEach(sel => {
    sel.classList.toggle('active', !!sel.value);
    sel.addEventListener('change', () => {
      const f = {};
      app.querySelectorAll('.filter-select').forEach(s => {
        if (s.value) f[s.name] = s.value;
      });
        let hash = `/results?search_query=${encodeURIComponent(query)}`;
        for (const [k, v] of Object.entries(f)) hash += `&${k}=${v}`;
        navigate(hash);
    });
  });

  const loadMoreBtn = document.getElementById('load-more-search');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      if (!continuationToken) return;
      loadMoreBtn.textContent = 'Loading...';
      try {
        const more = await searchVideos(query, filters, continuationToken);
        const list = document.getElementById('results-list');
        for (const r of (more.results || []).filter(r => showShorts || r.type !== 'shorts')) {
          list.insertAdjacentHTML('beforeend', renderResult(r, isListLayout));
        }
        continuationToken = more.continuationToken || '';
        if (!continuationToken) loadMoreBtn.remove();
        else loadMoreBtn.textContent = 'Load more';
      } catch (e) {
        loadMoreBtn.textContent = 'Error, retry';
      }
    });
  }
}

const SEARCH_CHIPS = [
  { label: 'All', filters: {} },
{ label: 'Shorts', filters: { type: 'shorts' } },
{ label: 'Videos', filters: { type: 'video' } },
{ label: 'Recently uploaded', filters: { sort_by: 'date' } },
{ label: 'Live', filters: { features: 'live' } },
];

function renderChips(query, current, showShorts) {
  const active = Object.entries(current).filter(([, v]) => v);
  return SEARCH_CHIPS.filter(chip => showShorts || chip.label !== 'Shorts').map(chip => {
    const entries = Object.entries(chip.filters);
    const isActive = entries.length === active.length && entries.every(([k, v]) => current[k] === v);
    const qs = entries.map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    return `<a href="#/results?search_query=${encodeURIComponent(query)}${qs}" class="search-chip${isActive ? ' active' : ''}">${chip.label}</a>`;
  }).join('');
}

function renderFilters(query, current) {
  return `
  <div class="search-filters">
  <div class="filter-group">
  <label>Sort:</label>
  <select class="filter-select" name="sort_by">
  <option value="">Relevance</option>
  <option value="date" ${current.sort_by === 'date' ? 'selected' : ''}>Date</option>
  <option value="views" ${current.sort_by === 'views' ? 'selected' : ''}>Views</option>
  <option value="rating" ${current.sort_by === 'rating' ? 'selected' : ''}>Rating</option>
  </select>
  </div>
  <div class="filter-group">
  <label>Type:</label>
  <select class="filter-select" name="type">
  <option value="">All</option>
  <option value="video" ${current.type === 'video' ? 'selected' : ''}>Video</option>
  <option value="channel" ${current.type === 'channel' ? 'selected' : ''}>Channel</option>
  <option value="playlist" ${current.type === 'playlist' ? 'selected' : ''}>Playlist</option>
  </select>
  </div>
  <div class="filter-group">
  <label>Date:</label>
  <select class="filter-select" name="date">
  <option value="">Any time</option>
  <option value="hour" ${current.date === 'hour' ? 'selected' : ''}>Last hour</option>
  <option value="today" ${current.date === 'today' ? 'selected' : ''}>Today</option>
  <option value="week" ${current.date === 'week' ? 'selected' : ''}>This week</option>
  <option value="month" ${current.date === 'month' ? 'selected' : ''}>This month</option>
  <option value="year" ${current.date === 'year' ? 'selected' : ''}>This year</option>
  </select>
  </div>
  <div class="filter-group">
  <label>Duration:</label>
  <select class="filter-select" name="duration">
  <option value="">Any</option>
  <option value="short" ${current.duration === 'short' ? 'selected' : ''}>Short (&lt;4m)</option>
  <option value="medium" ${current.duration === 'medium' ? 'selected' : ''}>Medium (4-20m)</option>
  <option value="long" ${current.duration === 'long' ? 'selected' : ''}>Long (&gt;20m)</option>
  </select>
  </div>
  </div>
  `;
}

function renderResult(item, isList = true) {
  if (!item) return '';
  if (item.type === 'shorts') return renderShortsShelf(item);
  if (item.type === 'channel') return renderChannelResult(item);
  if (item.type === 'playlist') return renderPlaylistResult(item, isList);
  return videoCard(item, isList);
}

function renderShortsShelf(shelf) {
  return `
  <div class="shorts-shelf">
  <h2 class="shorts-shelf-title">${escapeHtml(shelf.title)}</h2>
  <div class="shorts-shelf-row">
  ${shelf.items.map(s => `
    <a href="#${s.url}" class="short-card">
    <img src="${proxyImageUrl(s.thumbnailUrl || '')}" alt="" loading="lazy">
    <div class="short-card-title">${escapeHtml(s.title || '')}</div>
    <div class="short-card-views">${escapeHtml(s.views || '')}</div>
    </a>
    `).join('')}
    </div>
    </div>
    `;
}

function renderChannelResult(ch) {
  const href = ch.id ? `/channel/${ch.id}` : '#';
  return `
  <a href="#${href}" class="channel-card">
  <div class="channel-card-avatar">
  <img src="${proxyImageUrl(ch.iconUrl || '')}" alt="" loading="lazy">
  </div>
  <div>
  <div class="channel-card-name">${escapeHtml(ch.name || '')}${verifiedBadge(ch.verified)}</div>
  <div class="channel-card-meta">${[ch.subscribers, ch.videoCount].filter(Boolean).map(escapeHtml).join(' • ')}</div>
  </div>
  </a>
  `;
}

function renderPlaylistResult(pl, isList = true) {
  const href = pl.url || '#';
  let thumb = pl.thumbnailUrl || '';
  if (thumb.includes('/default.jpg')) thumb = thumb.replace('/default.jpg', '/mqdefault.jpg');
  if (thumb.includes('/hqdefault.jpg')) thumb = thumb.replace('/hqdefault.jpg', '/mqdefault.jpg');

  const channelHref = pl.authorId
  ? `#/channel/${encodeURIComponent(pl.authorId)}`
  : (pl.authorUrl ? `#${pl.authorUrl.startsWith('/') ? pl.authorUrl : '/' + pl.authorUrl}` : '');

  const authorHtml = pl.author
  ? (channelHref
  ? `<a href="${channelHref}" class="video-card-author" onclick="event.stopPropagation();">${escapeHtml(pl.author)}</a>`
  : `<span class="video-card-author">${escapeHtml(pl.author)}</span>`)
  : '';

  if (!isList) {
    return `
    <div class="video-card" style="position:relative;">
    <div class="video-card-link" onclick="if (!event.target.closest('a')) location.hash = '#${href}';" style="cursor:pointer;">
    <a href="#${href}" class="video-card-thumb" style="display:block;" tabindex="-1">
    <img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">
    <span class="video-card-duration">▶ ${escapeHtml(pl.videoCount || '')}</span>
    </a>
    <div class="video-card-info">
    <a href="#${href}" class="video-card-title" style="display:block;text-decoration:none;">${escapeHtml(pl.title || '')}</a>
    <div class="video-card-meta">
    ${authorHtml}
    <span class="video-card-stats">Playlist</span>
    </div>
    </div>
    </div>
    </div>
    `;
  }
  return `
  <div class="video-list-entry" style="position:relative;">
  <div class="video-list-item" onclick="if (!event.target.closest('a')) location.hash = '#${href}';" style="cursor:pointer;">
  <a href="#${href}" class="video-list-thumb" tabindex="-1">
  <img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">
  <span class="video-card-duration">▶ ${escapeHtml(pl.videoCount || '')}</span>
  </a>
  <div class="video-list-info">
  <a href="#${href}" class="video-list-title" style="display:block;text-decoration:none;">${escapeHtml(pl.title || '')}</a>
  <div class="video-list-meta">
  ${authorHtml}
  <span class="video-card-stats">Playlist</span>
  </div>
  </div>
  </div>
  </div>
  `;
}
