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

export async function renderPlaylist(app, params) {
  const listId = params.list;
  if (!listId) {
    app.innerHTML = '<div class="error-msg">No playlist ID provided</div>';
    return;
  }

  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  let data;
  const isLocal = listId.startsWith('pl_');

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
          ${data.authorName ? `<div class="playlist-author">${escapeHtml(data.authorName)}</div>` : ''}
          <div class="playlist-meta">
            ${videos.length ? `<span>${videos.length} videos</span>` : ''}
            ${data.viewCount ? `<span>${escapeHtml(data.viewCount)}</span>` : ''}
          </div>
          ${firstVideo ? `
            <a href="#/watch?v=${firstVideo.videoId || firstVideo.id}&list=${listId}" class="playlist-play-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              Play all
            </a>
          ` : ''}
        </div>
      </div>

      <div class="playlist-track-list">
        ${videos.map((v, i) => renderPlaylistTrack(v, i, listId, isLocal)).join('')}
        ${videos.length === 0 ? '<p style="color:var(--text-muted);padding:2rem;text-align:center;">No videos in this playlist</p>' : ''}
      </div>
    </div>
  `;

  if (isLocal) {
    app.querySelectorAll('.remove-track-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const vidId = btn.dataset.vid;
        removeVideoFromPlaylist(listId, vidId);
        renderPlaylist(app, params);
      });
    });
  }
}

function renderPlaylistTrack(v, i, listId, isLocal) {
  const videoId = v.videoId || v.id;
  if (!videoId) return '';
  return `
    <div style="display:flex; align-items:center; gap:8px;">
      <a href="#/watch?v=${videoId}&list=${listId}" class="playlist-track" style="flex:1;">
        <span class="playlist-track-num">${i + 1}</span>
        <div class="playlist-track-thumb">
          <img src="${proxyImageUrl(v.thumbnailUrl || '')}" alt="" loading="lazy">
          ${v.duration ? `<span class="video-card-duration">${escapeHtml(v.duration)}</span>` : ''}
        </div>
        <div class="playlist-track-info">
          <div class="playlist-track-title">${escapeHtml(v.title || '')}</div>
          <div class="playlist-track-meta">${escapeHtml(v.author || v.authorName || '')}</div>
        </div>
      </a>
      ${isLocal ? `
        <button class="remove-track-btn" data-vid="${videoId}" title="Remove video" style="background:none;border:none;color:var(--text-muted);padding:8px;cursor:pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ''}
    </div>
  `;
}
