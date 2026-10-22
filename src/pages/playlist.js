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


import { proxyImageUrl, getPlaylist } from '../api.js';
import { escapeHtml } from '../router.js';
import { getPlaylists, removeVideoFromPlaylist } from '../playlistManager.js';
import { startShuffle, stopShuffle } from '../shuffle.js';

export async function renderPlaylist(app, params) {
  const listId = params.list;
  if (!listId) {
    app.innerHTML = '<div class="error-msg">No playlist ID provided</div>';
    return;
  }

  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  let data;
  const isLocal = listId.startsWith('pl_');
  if (!isLocal) stopShuffle(listId);

  if (isLocal) {
    const playlists = getPlaylists();
    const found = playlists.find(p => p.id === listId);
    if (!found) {
      app.innerHTML = '<div class="error-msg">Playlist not found</div>';
      return;
    }
    data = {
      id: found.id,
      title: found.name,
      authorName: 'My Playlists',
      videoCount: found.videos?.length || 0,
      videos: found.videos || [],
    };
  } else {
    try {
      data = await getPlaylist(listId);
      if (!app.isConnected) return;
      document.title = data.title ? `${data.title} - Vivid` : 'Playlist - Vivid';
    } catch(e) {
      app.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      return;
    }
  }

  if (data.error) {
    app.innerHTML = `<div class="error-msg">${escapeHtml(data.error)}</div>`;
    return;
  }

  document.title = data.title ? `${data.title} - Vivid` : 'Playlist - Vivid';
  const videos = data.videos || [];
  const firstVideo = videos[0];

  app.innerHTML = `
    <div class="playlist-page">
      <div class="playlist-hero">
        <div class="playlist-cover">
          ${firstVideo?.thumbnailUrl
            ? `<img src="${proxyImageUrl(firstVideo.thumbnailUrl)}" alt="">`
            : `<div class="playlist-cover-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                  <path d="M4 6h16M4 10h16M4 14h8M4 18h8M15 14l5 3-5 3V14z"/>
                </svg>
               </div>`
          }
          <div class="playlist-cover-overlay"></div>
        </div>
        <div class="playlist-hero-info">
          <div class="playlist-label">${isLocal ? 'User Playlist' : 'Playlist'}</div>
          <h1 class="playlist-title">${escapeHtml(data.title || 'Playlist')}</h1>
          ${data.authorName ? (data.authorId || data.authorUrl
            ? `<a href="${data.authorId ? `#/channel/${encodeURIComponent(data.authorId)}` : `#${data.authorUrl.startsWith('/') ? data.authorUrl : '/' + data.authorUrl}`}" class="playlist-author">${escapeHtml(data.authorName)}</a>`
            : `<div class="playlist-author">${escapeHtml(data.authorName)}</div>`) : ''}
          <div class="playlist-meta">
            ${videos.length ? `<span>${videos.length} videos</span>` : ''}
            ${data.viewCount ? `<span>${escapeHtml(data.viewCount)}</span>` : ''}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:1rem;">
            ${firstVideo ? `
              <a href="#/watch?v=${firstVideo.videoId || firstVideo.id}&list=${listId}" class="playlist-play-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                Play all
              </a>
              <a href="#/watch?v=${firstVideo.videoId || firstVideo.id}&list=${listId}&audio=1" class="playlist-play-btn" style="background:var(--bg-tertiary);color:var(--text-primary);" title="Play playlist in audio-only listen mode">
                🎧 Audio Only
              </a>
            ` : ''}
            ${isLocal && videos.length > 1 ? `
              <button id="shuffle-pl-btn" class="playlist-play-btn" style="background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;" title="Shuffle videos in this playlist">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                Shuffle
              </button>
            ` : ''}
            ${!isLocal && videos.length > 1 ? `
              <button id="shuffle-play-btn" class="playlist-play-btn" style="background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;" title="Play this playlist in random order">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                Shuffle
              </button>
            ` : ''}
            ${!isLocal && videos.length > 0 ? `
              <button id="import-this-pl-btn" class="playlist-play-btn" style="background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;" title="Import to My Playlists">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Save to Local Playlists
              </button>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="playlist-track-list">
        ${videos.map((v, i) => renderPlaylistTrack(v, i, listId, isLocal)).join('')}
        ${videos.length === 0 ? '<p style="color:var(--text-muted);padding:2rem;text-align:center;">No videos in this playlist</p>' : ''}
      </div>
    </div>
  `;

  if (isLocal) {
    const shuffleBtn = app.querySelector('#shuffle-pl-btn');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        import('../playlistManager.js').then(pm => {
          pm.shufflePlaylist(listId);
          renderPlaylist(app, params);
        });
      });
    }

    app.querySelectorAll('.remove-track-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const vidId = btn.dataset.vid;
        removeVideoFromPlaylist(listId, vidId);
        renderPlaylist(app, params);
      });
    });
  } else {
    const shufflePlayBtn = app.querySelector('#shuffle-play-btn');
    if (shufflePlayBtn) {
      shufflePlayBtn.addEventListener('click', () => {
        const [first] = startShuffle(listId, videos);
        window.location.hash = `#/watch?v=${first.videoId || first.id}&list=${listId}`;
      });
    }

    const importBtn = app.querySelector('#import-this-pl-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        import('../playlistManager.js').then(pm => {
          const newId = pm.importYoutubePlaylist(data.title, data.videos);
          window.location.hash = `#/playlist?list=${newId}`;
        });
      });
    }
  }
}

function renderPlaylistTrack(v, i, listId, isLocal) {
  const videoId = v.videoId || v.id;
  if (!videoId) return '';
  const href = `#/watch?v=${videoId}&list=${listId}`;
  const authorName = v.author || v.authorName || '';
  const channelHref = v.authorId
    ? `#/channel/${encodeURIComponent(v.authorId)}`
    : (v.authorUrl ? `#${v.authorUrl.startsWith('/') ? v.authorUrl : '/' + v.authorUrl}` : '');

  const authorHtml = authorName
    ? (channelHref
        ? `<a href="${channelHref}" class="playlist-track-author" onclick="event.stopPropagation();">${escapeHtml(authorName)}</a>`
        : `<span>${escapeHtml(authorName)}</span>`)
    : '';

  const stats = [v.views, v.publishDate].filter(Boolean).map(escapeHtml).join(' • ');
  const statsHtml = stats ? `<span class="playlist-track-stats">${stats}</span>` : '';

  return `
    <div style="display:flex; align-items:center; gap:8px;">
      <div class="playlist-track" onclick="if (!event.target.closest('a')) location.hash = '${href}';" style="flex:1; cursor:pointer;">
        <span class="playlist-track-num">${i + 1}</span>
        <a href="${href}" class="playlist-track-thumb" tabindex="-1">
          <img src="${proxyImageUrl(v.thumbnailUrl || '')}" alt="" loading="lazy">
          ${v.duration ? `<span class="video-card-duration">${escapeHtml(v.duration)}</span>` : ''}
        </a>
        <div class="playlist-track-info">
          <a href="${href}" class="playlist-track-title" style="display:block;text-decoration:none;">${escapeHtml(v.title || '')}</a>
          <div class="playlist-track-meta">
            ${authorHtml}
            ${statsHtml}
          </div>
        </div>
      </div>
      <a href="#/watch?v=${videoId}&list=${listId}&audio=1" title="Play audio only (Listen mode)" style="color:var(--text-muted);padding:8px;text-decoration:none;font-size:1.1rem;display:flex;align-items:center;">
        🎧
      </a>
      ${isLocal ? `
        <button class="remove-track-btn" data-vid="${videoId}" title="Remove video" style="background:none;border:none;color:var(--text-muted);padding:8px;cursor:pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ''}
    </div>
  `;
}
