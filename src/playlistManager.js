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


const STORAGE_KEY = 'vivid_playlists';

export function getPlaylists() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

export function savePlaylists(playlists, doSync = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  if (doSync) {
    syncWithServer();
  }
}

export function createPlaylist(name) {
  const playlists = getPlaylists();
  const id = 'pl_' + Math.random().toString(36).substr(2, 9);
  playlists.push({
    id,
    name,
    videos: [],
    createdAt: new Date().toISOString()
  });
  savePlaylists(playlists);
  return id;
}

export function deletePlaylist(id) {
  let playlists = getPlaylists();
  playlists = playlists.filter(p => p.id !== id);
  savePlaylists(playlists);
}

export function shufflePlaylist(id) {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === id);
  if (!playlist || !playlist.videos || playlist.videos.length <= 1) return;
  for (let i = playlist.videos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playlist.videos[i], playlist.videos[j]] = [playlist.videos[j], playlist.videos[i]];
  }
  savePlaylists(playlists);
}

export function importYoutubePlaylist(name, videos) {
  const playlists = getPlaylists();
  const id = 'pl_' + Math.random().toString(36).substr(2, 9);
  const formattedVideos = (videos || []).map(v => ({
    videoId: v.videoId || v.id,
    id: v.videoId || v.id,
    title: v.title || '',
    author: v.author || v.authorName || '',
    authorName: v.author || v.authorName || '',
    authorId: v.authorId || '',
    authorUrl: v.authorUrl || '',
    views: v.views || '',
    publishDate: v.publishDate || '',
    duration: v.duration || '',
    thumbnailUrl: v.thumbnailUrl || '',
    addedAt: new Date().toISOString(),
  }));

  playlists.push({
    id,
    name: name || 'Imported Playlist',
    videos: formattedVideos,
    createdAt: new Date().toISOString()
  });
  savePlaylists(playlists);
  return id;
}

export function addVideoToPlaylist(playlistId, video) {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (playlist) {
    if (!playlist.videos.some(v => (v.videoId || v.id) === (video.videoId || video.id))) {
      playlist.videos.push({
        videoId: video.videoId || video.id,
        id: video.videoId || video.id,
        title: video.title || '',
        author: video.author || video.authorName || '',
        authorName: video.author || video.authorName || '',
        authorId: video.authorId || '',
        authorUrl: video.authorUrl || '',
        views: video.views || '',
        publishDate: video.publishDate || '',
        duration: video.duration || '',
        thumbnailUrl: video.thumbnailUrl || '',
        addedAt: new Date().toISOString(),
      });
      savePlaylists(playlists);
    }
  }
}

export function removeVideoFromPlaylist(playlistId, videoId) {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (playlist) {
    playlist.videos = playlist.videos.filter(v => (v.videoId || v.id) !== videoId);
    savePlaylists(playlists);
  }
}

export function isVideoInPlaylist(playlistId, videoId) {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  return playlist ? playlist.videos.some(v => (v.videoId || v.id) === videoId) : false;
}

export async function syncWithServer() {
  const token = localStorage.getItem('vivid_auth_token');
  if (!token) return;
  try {
    const playlists = getPlaylists();
    const subs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
    const res = await fetch('/api/v1/auth/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ subscriptions: subs, playlists })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        if (data.user.subscriptions) {
          localStorage.setItem('vivid_subs', JSON.stringify(data.user.subscriptions));
        }
        if (data.user.playlists) {
          savePlaylists(data.user.playlists, false);
        }
      }
    }
  } catch {}
}
