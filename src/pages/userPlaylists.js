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


import { getPlaylists, createPlaylist, deletePlaylist } from '../playlistManager.js';
import { proxyImageUrl } from '../api.js';
import { escapeHtml } from '../router.js';

export function renderUserPlaylists(app) {
  document.title = 'My Playlists - Vivid';
  const playlists = getPlaylists();

  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
      <h1 class="page-title" style="margin:0;">My Playlists</h1>
      <button id="create-pl-btn" class="modal-btn-primary" style="display:flex; align-items:center; gap:6px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>New Playlist</span>
      </button>
    </div>

    <div class="video-grid" id="user-playlists-grid">
      ${playlists.map(p => renderPlaylistCard(p)).join('')}
      ${playlists.length === 0 ? `
        <div style="grid-column: 1/-1; text-align:center; padding:3rem 1rem; color:var(--text-muted);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:1rem; opacity:0.5;"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          <p>No playlists yet. Create one or save videos from any watch page!</p>
        </div>
      ` : ''}
    </div>
  `;

  app.querySelector('#create-pl-btn').addEventListener('click', () => {
    const name = prompt('Enter a name for the new playlist:');
    if (name && name.trim()) {
      createPlaylist(name.trim());
      renderUserPlaylists(app);
    }
  });

  app.querySelectorAll('.delete-pl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('Delete this playlist?')) {
        deletePlaylist(id);
        renderUserPlaylists(app);
      }
    });
  });
}

function renderPlaylistCard(p) {
  const firstVideo = p.videos?.[0];
  const thumb = firstVideo?.thumbnailUrl || '';
  return `
    <div class="video-card">
      <a href="#/playlist?list=${p.id}" class="video-card-link">
        <div class="video-card-thumb" style="position:relative;">
          ${thumb ? `<img src="${proxyImageUrl(thumb)}" alt="" loading="lazy">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);background:var(--bg-tertiary);"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>`}
          <span class="video-card-duration" style="display:flex;align-items:center;gap:4px;">
            ${p.videos?.length || 0} videos
          </span>
        </div>
        <div class="video-card-info" style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1; min-width:0;">
            <div class="video-card-title">${escapeHtml(p.name)}</div>
            <div class="video-card-meta">Local Playlist</div>
          </div>
          <button class="delete-pl-btn" data-id="${p.id}" title="Delete playlist" style="background:none;border:none;color:var(--text-muted);padding:4px;cursor:pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </a>
    </div>
  `;
}
