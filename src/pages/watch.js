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

import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { getVideo, getStreams, getComments, getCommentReplies, getCaptions, proxyImageUrl, proxyStreamUrl, proxyHlsUrl, getSponsorBlockSegments, syncAccount } from '../api.js';
import { escapeHtml } from '../router.js';
import { getSettings, saveSettings, SPONSOR_CATEGORIES } from '../settings.js';
import { getPlaylists, addVideoToPlaylist, removeVideoFromPlaylist, isVideoInPlaylist, createPlaylist, syncWithServer } from '../playlistManager.js';
import { SabrMediaSourcePlayer } from '../sabrPlayer.js';
import { DashMediaSourcePlayer } from '../dashPlayer.js';
import { startLiveChat } from '../liveChat.js';

let vjsPlayer = null;
window.vjsPlayer = null;
let audioTrackPlayer = null;
let audioSyncInterval = null;
let stopChat = null;
let sponsorSegments = [];
const MEDIA_ACTIONS = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack'];
const VOLUME_KEY = 'vivid_volume';
const savedVolume = (() => {
  try {
    return JSON.parse(localStorage.getItem(VOLUME_KEY)) || {};
  } catch {
    return {};
  }
})();
let userVolume = typeof savedVolume.volume === 'number' ? Math.min(Math.max(savedVolume.volume, 0), 1) : 1;
let userMuted = !!savedVolume.muted;

function stopPlayback() {
  if (window.sabrPlayerInstance) {
    window.sabrPlayerInstance.destroy();
    window.sabrPlayerInstance = null;
  }
  if (audioSyncInterval) { clearInterval(audioSyncInterval); audioSyncInterval = null; }
  if (stopChat) { stopChat(); stopChat = null; }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    for (const action of MEDIA_ACTIONS) navigator.mediaSession.setActionHandler(action, null);
  }
  if (vjsPlayer) { vjsPlayer.dispose(); vjsPlayer = window.vjsPlayer = null; }
  if (audioTrackPlayer) {
    audioTrackPlayer.pause();
    audioTrackPlayer.removeAttribute('src');
    audioTrackPlayer.load();
    audioTrackPlayer = null;
  }
}

window.seekVideo = function(seconds) {
  if (window.vjsPlayer) {
    window.vjsPlayer.currentTime(seconds);
  }
};

const ICONS = {
  thumbUp: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>`,
  thumbDown: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>`,
  comment: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
  pin: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,
  heart: `<svg width="11" height="11" viewBox="0 0 24 24" fill="#f00"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
  next: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 15,12 5,21"/><rect x="17" y="3" width="2" height="18"/></svg>`,
  listPlay: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
};

function linkifyText(text) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const escapedUrl = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);word-break:break-all;">${escapedUrl}</a>`;
    }
    return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }).join('');
}

function linkifyComment(text) {
  text = escapeHtml(text);
  text = text.replace(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/.*[?&]v=)([a-zA-Z0-9_-]{11})/g, (match, videoId) => {
    return `<a href="javascript:void(0)" onclick="if(vjsPlayer)vjsPlayer.pause();window.location.hash='#/watch?v=${videoId}'" style="color:var(--accent);word-break:break-all;">/watch?v=${videoId}</a>`;
  });

  text = text.replace(/(\d+:)?(\d{1,2}):(\d{2})(?!\w)/g, (match) => {
    const parts = match.split(':').filter(p => p);
    let totalSeconds = 0;
    if (parts.length === 2) {
      totalSeconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      totalSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return `<a href="javascript:void(0)" onclick="seekVideo(${totalSeconds})" style="color:var(--accent);">${match}</a>`;
  });

  text = text.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);word-break:break-all;">${url}</a>`;
  });

  text = text.replace(/\n/g, '<br>');
  return text;
}

export async function renderWatch(app, params) {
  const videoId = params.v;
  const listId = params.list || null;
  const timestamp = parseInt(params.t) || 0;
  if (!videoId) {
    app.innerHTML = '<div class="error-msg">No video ID provided</div>';
    return;
  }

  stopPlayback();

  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const [detail, streams, captionsData, sponsorRes] = await Promise.allSettled([
    getVideo(videoId, listId),
    getStreams(videoId, getSettings().trySabr),
    getCaptions(videoId),
    getSettings().sponsorBlockEnabled ? getSponsorBlockSegments(videoId) : Promise.resolve([])
  ]);

  const detailObj = detail.status === 'fulfilled' ? detail.value : {};
  const streamsObj = streams.status === 'fulfilled' ? streams.value : {};
  const capsObj = captionsData.status === 'fulfilled' ? captionsData.value : null;

  sponsorSegments = [];
  if (sponsorRes.status === 'fulfilled' && Array.isArray(sponsorRes.value)) {
    sponsorSegments = sponsorRes.value;
  }

  if (detailObj.error && !detailObj.title) {
    app.innerHTML = `<div class="error-msg">${escapeHtml(detailObj.error)}</div>`;
    return;
  }
  if (streamsObj.error) {
    app.innerHTML = `<div class="error-msg">Stream Error: ${escapeHtml(streamsObj.error)}</div>`;
    return;
  }
  if (detailObj.title) {
    document.title = `${detailObj.title} - Vivid`;
  }

  const appSettings = getSettings();
  const qualities = [];

  const trackKey = (a) => `${a.audioTrackId || ''}|${a.displayName || ''}`;

  const sabrAudioFor = (video, choice) => {
    const container = video.mimeType.split(';')[0].split('/')[1];
    const sameContainer = streamsObj.audioStreams.filter(a => a.mimeType.includes(`/${container}`));
    const pool = sameContainer.length ? sameContainer : streamsObj.audioStreams;
    return (choice && pool.find(a => trackKey(a) === trackKey(choice)))
      || pool.find(a => a.isDefault) || pool.find(a => a.isOriginal) || pool[0];
  };

  if (streamsObj.sabr?.available && appSettings.trySabr) {
    if (streamsObj.qualityMap && Object.keys(streamsObj.qualityMap).length) {
      for (const [res, stream] of Object.entries(streamsObj.qualityMap).sort((a,b)=>b[0]-a[0])) {
        qualities.push({
          label: `${res}p (SABR)`,
          type: 'sabr',
          sabrInfo: streamsObj.sabr,
          videoFmt: stream,
        });
      }
    } else if (streamsObj.bestVideo && streamsObj.bestAudio) {
      qualities.push({
        label: 'SABR (Adaptive)',
        type: 'sabr',
        sabrInfo: streamsObj.sabr,
        videoFmt: streamsObj.bestVideo,
      });
    }
  }

  if (streamsObj.combinedStreams?.length) {
    qualities.push({ label: '360p', url: streamsObj.combinedStreams[0].url, type: 'combined' });
  }
  if (streamsObj.qualityMap && !streamsObj.sabr?.available) {
    for (const [res, stream] of Object.entries(streamsObj.qualityMap).sort((a,b)=>b[0]-a[0])) {
      qualities.push({ label: `${res}p`, url: stream.url, mimeType: stream.mimeType, audioUrl: streamsObj.bestAudio?.url, type: 'adaptive' });
    }
  }

  const probe = document.createElement('audio');
  const seenTracks = new Set();
  const audioOptions = (streamsObj.audioStreams || []).filter(a => {
    if (!probe.canPlayType(a.mimeType)) return false;
    const key = trackKey(a);
    if (seenTracks.has(key)) return false;
    seenTracks.add(key);
    return true;
  }).sort((a, b) => (b.isDefault ? 2 : b.isOriginal ? 1 : 0) - (a.isDefault ? 2 : a.isOriginal ? 1 : 0));
  let initialAudioIdx = audioOptions.findIndex(a => a.isDefault);
  if (initialAudioIdx === -1) initialAudioIdx = audioOptions.findIndex(a => a.isOriginal);
  if (initialAudioIdx === -1) initialAudioIdx = 0;

  let initialQ = qualities.find(q => q.label.startsWith('720p')) || qualities.find(q => q.label.startsWith('1080p')) || qualities.find(q => q.label.startsWith('360p')) || qualities[0];

  const playlist = detailObj.playlist || null;
  const playlistVideos = playlist?.videos || [];
  const currentIdx = playlist?.selectedIndex ?? -1;

  const sidebarVideos = listId && playlistVideos.length > 0
    ? playlistVideos
    : (detailObj.suggestions || []).filter(s => s.type === 'video');

  const nextVideos = listId && playlistVideos.length > 0
    ? playlistVideos.slice(currentIdx + 1)
    : sidebarVideos;

  const sidebarTitle = listId && playlist
    ? `${escapeHtml(playlist.title || 'Playlist')} · ${currentIdx + 1}/${playlist.totalVideos || playlistVideos.length}`
    : 'Up next';

  app.innerHTML = `
    <div class="watch-layout">
      <div class="watch-primary">
        <div class="watch-player-wrapper" style="position:relative;">
          <video id="vjs-video" class="video-js vjs-default-skin vjs-big-play-centered" controls preload="auto" width="100%" height="auto"></video>
        </div>

        ${detailObj.liveChat ? `
          <div class="live-chat-panel">
            <div class="live-chat-header">
              <span>${detailObj.liveChat.isReplay ? 'Chat Replay' : 'Live Chat'}</span>
              <span id="live-chat-status" class="live-chat-status"></span>
              ${detailObj.liveChat.modes.length ? `<select id="live-chat-mode" class="live-chat-mode">${detailObj.liveChat.modes.map(m => `<option value="${escapeHtml(m.continuation)}" ${m.selected ? 'selected' : ''}>${escapeHtml(m.title)}</option>`).join('')}</select>` : ''}
              ${detailObj.liveChat.isReplay ? '' : '<span class="live-chat-badge">● LIVE</span>'}
            </div>
            <div id="live-chat-messages" class="live-chat-messages"></div>
          </div>
        ` : ''}

        <div class="watch-info">
          <h1 class="watch-title">${escapeHtml(detailObj.title || '')}</h1>
          <div class="watch-meta">
            ${detailObj.views ? `<span>${escapeHtml(detailObj.views)}</span>` : ''}
            ${detailObj.publishDate ? `<span>${escapeHtml(detailObj.publishDate)}</span>` : ''}
          </div>
          <div class="watch-likes">
          <span class="watch-like-btn">${ICONS.thumbUp}<span>${escapeHtml(String(detailObj.likes || '0'))}</span></span>
          <span class="watch-like-btn">${ICONS.thumbDown}<span>${escapeHtml(String(detailObj.dislikes || '0'))}</span></span>
          <span id="share-btn" class="watch-like-btn" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          <span>Share</span>
          </span>
          <span id="save-pl-btn" class="watch-like-btn" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Save</span>
          </span>
          </div>
          ${detailObj.author?.id ? `
            <div class="watch-channel">
              <a href="#/channel/${detailObj.author.id}" class="watch-channel-avatar">
                <img src="${proxyImageUrl(detailObj.author.iconUrl || '')}" alt="">
              </a>
              <div>
                <a href="#/channel/${detailObj.author.id}" class="watch-channel-name">${escapeHtml(detailObj.author.name || '')}</a>
                ${detailObj.author.subscribers ? `<div class="watch-channel-subs">${escapeHtml(detailObj.author.subscribers)}</div>` : ''}
              </div>
              <button id="watch-sub-btn" class="watch-sub-btn" style="margin-left:auto; padding:6px 16px; background:#e50914; color:#fff; border:none; border-radius:16px; font-weight:600; cursor:pointer;">Subscribe</button>
            </div>
          ` : ''}
          ${detailObj.description ? `
            <div class="watch-description" id="watch-description">
              <div class="watch-description-body">${linkifyText(detailObj.description)}</div>
              <button class="watch-desc-toggle" id="desc-toggle">Show more</button>
            </div>
          ` : ''}
        </div>

        <div class="comments-section" id="comments-section">
          <h3>Comments</h3>
          <div id="comments-list"></div>
          ${!detailObj.comments?.disabled ? '<button class="load-more" id="load-comments">Load comments</button>' : '<p style="color:var(--text-muted)">Disabled</p>'}
        </div>
      </div>

      <div class="suggestions-sidebar">
        <div class="sidebar-header">
          ${listId && playlist ? `
            <a href="#/playlist?list=${listId}" class="sidebar-playlist-link">
              ${ICONS.listPlay} View full playlist
            </a>
          ` : ''}
          <div class="sidebar-title">${sidebarTitle}</div>
        </div>
        <div class="sidebar-list">
          ${sidebarVideos.map((s, i) => renderSuggestion(s, listId, i, currentIdx)).join('')}
        </div>
      </div>
    </div>
  `;

  const descBox = document.getElementById('watch-description');
  const descToggle = document.getElementById('desc-toggle');
  if (descBox && descToggle) {
    descToggle.addEventListener('click', () => {
      descBox.classList.toggle('expanded');
      descToggle.textContent = descBox.classList.contains('expanded') ? 'Show less' : 'Show more';
    });
  }

  audioTrackPlayer = document.createElement('audio');

  vjsPlayer = window.vjsPlayer = videojs('vjs-video', {
    fluid: true,
    html5: { preloadTextTracks: false },
    playbackRates: [0.25, 0.5, 1, 1.25, 1.5, 2],
    controlBar: {
      currentTimeDisplay: true,
      timeDivider: true,
      durationDisplay: true,
      remainingTimeDisplay: false
    }
  });

  const isLiveHls = !!streamsObj.hlsManifestUrl && (detailObj.isLivestream || !qualities.length);
  if (isLiveHls) {
    vjsPlayer.on('error', () => console.warn('[HLS]', vjsPlayer.error()));
    vjsPlayer.src({ src: proxyHlsUrl(streamsObj.hlsManifestUrl), type: 'application/x-mpegURL' });
  }

  if (detailObj.liveChat) {
    stopChat = startLiveChat({
      videoId,
      chat: detailObj.liveChat,
      player: vjsPlayer,
      listEl: document.getElementById('live-chat-messages'),
      modeEl: document.getElementById('live-chat-mode'),
      statusEl: document.getElementById('live-chat-status'),
    });
  }

  const playNext = () => {
    if (document.getElementById('ps-loop').checked) return;
    if (!document.getElementById('ps-autoplay').checked) return;

    const next = nextVideos[0];
    if (!next) return;
    const nextId = next.videoId || next.id;
    if (nextId) {
      window.location.hash = `#/watch?v=${nextId}${listId ? '&list=' + listId : ''}`;
    }
  };
  vjsPlayer.on('ended', playNext);
  audioTrackPlayer.addEventListener('ended', () => {
    if (!document.hidden) return;
    if (document.getElementById('ps-loop').checked) {
      audioTrackPlayer.currentTime = 0;
      audioTrackPlayer.play().catch(() => {});
    } else {
      playNext();
    }
  });

  const settingsMenuHtml = `
  <div class="vjs-settings-menu hidden" id="player-settings-menu">
  <h3>Settings <span class="vjs-settings-close" id="ps-close">&times;</span></h3>
  <div class="vjs-settings-section" ${detailObj.isLivestream ? 'style="display:none;"' : ''}>
  <label>Quality</label>
  <select id="ps-quality">
  ${qualities.map((q,i) => `<option value="${i}" ${q.label === initialQ?.label ? 'selected' : ''}>${q.label}</option>`).join('')}
  </select>
  </div>
  <div class="vjs-settings-section" ${detailObj.isLivestream ? 'style="display:none;"' : ''}>
  <label>Audio Track</label>
  <select id="ps-audio">
  ${audioOptions.map((a,i) => `<option value="${i}" ${i === initialAudioIdx ? 'selected' : ''}>${escapeHtml(a.displayName || 'Default')}</option>`).join('')}
  </select>
  </div>
  <div class="vjs-settings-section">
  <label><input type="checkbox" id="ps-loop" ${appSettings.loop ? 'checked' : ''}> Loop Video</label>
  </div>
  <div class="vjs-settings-section">
  <label><input type="checkbox" id="ps-autoplay" ${appSettings.autoplay ? 'checked' : ''}> Autoplay</label>
  </div>
  </div>
  `;
  const menuWrapper = document.createElement('div');
  menuWrapper.innerHTML = settingsMenuHtml;
  vjsPlayer.el().appendChild(menuWrapper.firstElementChild);

  const fullscreenToggle = vjsPlayer.controlBar.getChild('fullscreenToggle');
  const fullscreenIdx = vjsPlayer.controlBar.children().indexOf(fullscreenToggle);
  const settingsBtn = vjsPlayer.controlBar.addChild('button', {
    className: 'vjs-visible-control vjs-control vjs-button',
    title: 'Settings',
  }, fullscreenIdx !== -1 ? fullscreenIdx : undefined);
  settingsBtn.el().innerHTML = '<span class="vjs-icon-placeholder vjs-icon-cog" aria-hidden="true"></span>';
  settingsBtn.el().addEventListener('click', () => {
    document.getElementById('player-settings-menu').classList.toggle('hidden');
  });
  document.getElementById('ps-close').addEventListener('click', () => {
    document.getElementById('player-settings-menu').classList.add('hidden');
  });
  const volumePanel = vjsPlayer.controlBar.getChild('volumePanel');
  const volumePanelIdx = vjsPlayer.controlBar.children().indexOf(volumePanel);
  let isSyncing = false;
  let isAudioTrackActive = false;
  function addCaptions() {
    if (capsObj?.baseLanguages) {
      for (const track of capsObj.baseLanguages) {
        vjsPlayer.addRemoteTextTrack({
          kind: 'captions', label: track.name, language: track.languageCode,
          src: `/api/v1/captions/${videoId}/${track.languageCode}`, default: false
        }, true);
      }
    }
  }

  addCaptions();

  vjsPlayer.on('play', () => {
    if (isAudioTrackActive && audioTrackPlayer.src) {
      audioTrackPlayer.play().catch(e => console.log('Audio play error:', e));
    }
  });
  vjsPlayer.on('pause', () => {
    if (!isAudioTrackActive || !audioTrackPlayer.src) return;
    if (document.hidden && !audioTrackPlayer.paused) return;
    audioTrackPlayer.pause();
  });
  function handleVisibility() {
    if (document.hidden || !isAudioTrackActive || audioTrackPlayer.paused || !vjsPlayer.paused()) return;
    vjsPlayer.currentTime(audioTrackPlayer.currentTime);
    vjsPlayer.play();
  }
  document.addEventListener('visibilitychange', handleVisibility);
  vjsPlayer.on('seeking', () => {
    if (isAudioTrackActive && audioTrackPlayer.src) {
      audioTrackPlayer.pause();
      audioTrackPlayer.currentTime = vjsPlayer.currentTime();
    }
  });
  vjsPlayer.on('seeked', () => {
    if (isAudioTrackActive && audioTrackPlayer.src) {
      audioTrackPlayer.currentTime = vjsPlayer.currentTime();
      if (!vjsPlayer.paused()) audioTrackPlayer.play().catch(() => {});
    }
  });
  vjsPlayer.on('waiting', () => {
    if (isAudioTrackActive && audioTrackPlayer.src) audioTrackPlayer.pause();
  });
  vjsPlayer.on('playing', () => {
    if (isAudioTrackActive && audioTrackPlayer.src && audioTrackPlayer.paused) {
      audioTrackPlayer.currentTime = vjsPlayer.currentTime();
      audioTrackPlayer.play().catch(() => {});
    }
  });
  vjsPlayer.on('ratechange', () => {
    if (isAudioTrackActive && audioTrackPlayer.src) {
      audioTrackPlayer.playbackRate = vjsPlayer.playbackRate();
    }
  });
  vjsPlayer.on('volumechange', () => {
    if (isSyncing) return;
    const newVolume = vjsPlayer.volume();
    const newMuted = vjsPlayer.muted();
    userVolume = newVolume;
    userMuted = newMuted;
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: newVolume, muted: newMuted }));
    } catch {}

    if (isAudioTrackActive && audioTrackPlayer) {
      audioTrackPlayer.volume = newVolume;
      audioTrackPlayer.muted = newMuted;
    }
  });

  function handleSeekKey(e) {
    if (!vjsPlayer) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      vjsPlayer.currentTime(Math.max(0, vjsPlayer.currentTime() - 5));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const dur = vjsPlayer.duration() || Infinity;
      vjsPlayer.currentTime(Math.min(dur, vjsPlayer.currentTime() + 5));
    }
  }
  function handleKey(e) {
    if (!vjsPlayer) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'KeyK' || e.code === 'Space') {
      e.preventDefault();
      if (vjsPlayer.paused()) {
        vjsPlayer.play();
      } else {
        vjsPlayer.pause();
      }
    }

    if (e.code === 'KeyF') {
      e.preventDefault();
      if (vjsPlayer.isFullscreen()) {
        vjsPlayer.exitFullscreen();
      } else {
        vjsPlayer.requestFullscreen();
      }
    }
  }
  function handleVolumeWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const newVol = Math.min(1, Math.max(0, vjsPlayer.volume() + delta));
    vjsPlayer.volume(newVol);
    if (newVol > 0 && vjsPlayer.muted()) vjsPlayer.muted(false);
    if (newVol === 0) vjsPlayer.muted(true);
  }
  const volumePanelEl = vjsPlayer.controlBar.getChild('volumePanel')?.el();
  if (volumePanelEl) {
    volumePanelEl.addEventListener('wheel', handleVolumeWheel, { passive: false });
  }

  document.addEventListener('keydown', handleSeekKey);
  document.addEventListener('keydown', handleKey);
  vjsPlayer.on('dispose', () => {
    document.removeEventListener('keydown', handleSeekKey);
    document.removeEventListener('keydown', handleKey);
    document.removeEventListener('visibilitychange', handleVisibility);
    if (volumePanelEl) volumePanelEl.removeEventListener('wheel', handleVolumeWheel);
  });

  vjsPlayer.volume(userVolume);
  vjsPlayer.muted(userMuted);

  if ('mediaSession' in navigator) {
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title: detailObj.title || '',
      artist: detailObj.author?.name || '',
      artwork: [{
        src: new URL(proxyImageUrl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`), location.href).href,
        sizes: '480x360',
        type: 'image/jpeg',
      }],
    });
    const actions = {
      play: () => {
        vjsPlayer.play();
        if (isAudioTrackActive) audioTrackPlayer.play().catch(() => {});
      },
      pause: () => {
        vjsPlayer.pause();
        if (isAudioTrackActive) audioTrackPlayer.pause();
      },
      seekbackward: () => vjsPlayer.currentTime(Math.max(0, vjsPlayer.currentTime() - 10)),
      seekforward: () => vjsPlayer.currentTime(vjsPlayer.currentTime() + 10),
      seekto: (d) => vjsPlayer.currentTime(d.seekTime),
    };
    const next = nextVideos[0];
    if (next && (next.videoId || next.id)) {
      actions.nexttrack = () => {
        window.location.hash = `#/watch?v=${next.videoId || next.id}${listId ? '&list=' + listId : ''}`;
      };
    }
    for (const [action, handler] of Object.entries(actions)) session.setActionHandler(action, handler);
  }

  if (initialQ && !isLiveHls) setStream(initialQ, initialQ.type === 'combined' ? null : audioOptions[initialAudioIdx]);

  let lastHardSync = 0;
  if (audioSyncInterval) clearInterval(audioSyncInterval);
  audioSyncInterval = setInterval(() => {
    if (!vjsPlayer || vjsPlayer.paused()) return;
    const qIdx = document.getElementById('ps-quality')?.value;
    const q = qualities[qIdx] || initialQ;
    if (q?.type === 'adaptive' && audioTrackPlayer.src && !audioTrackPlayer.paused) {
      if (vjsPlayer.seeking() || vjsPlayer.readyState() < 3) return;
      const drift = Math.abs(audioTrackPlayer.currentTime - vjsPlayer.currentTime());
      if (drift > 0.4 && Date.now() - lastHardSync > 3000) {
        audioTrackPlayer.currentTime = vjsPlayer.currentTime();
        lastHardSync = Date.now();
      }
    }
  }, 1000);

  function sponsorMode(seg) {
    const cfg = getSettings();
    if (!cfg.sponsorBlockEnabled) return 'disabled';
    const cat = seg.category || 'sponsor';
    return cfg.sponsorCategories[cat] || SPONSOR_CATEGORIES[cat]?.defaultBehavior || 'skip_show';
  }

  function renderSponsorMarkers() {
    if (!vjsPlayer) return;
    const progressHolder = vjsPlayer.el().querySelector('.vjs-progress-holder');
    if (!progressHolder) return;
    let container = progressHolder.querySelector('.vjs-sponsor-markers-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'vjs-sponsor-markers-container';
      progressHolder.appendChild(container);
    }
    container.innerHTML = '';
    const duration = vjsPlayer.duration();
    if (!duration || duration <= 0 || !sponsorSegments.length) return;
    for (const seg of sponsorSegments) {
      const cat = seg.category || 'sponsor';
      if (sponsorMode(seg) === 'disabled') continue;
      const catInfo = SPONSOR_CATEGORIES[cat] || { name: cat, color: '#00d46a' };
      const start = Math.max(0, seg.segment[0]);
      const end = Math.min(duration, seg.segment[1]);
      if (start >= end) continue;
      const left = (start / duration) * 100;
      const width = Math.max(0.3, ((end - start) / duration) * 100);
      const marker = document.createElement('div');
      marker.className = 'vjs-sponsor-marker';
      marker.style.cssText = `position:absolute;left:${left}%;width:${width}%;height:100%;background:${catInfo.color};opacity:0.85;border-radius:1px;pointer-events:none;`;
      marker.title = `${catInfo.name} (${Math.round(start)}s - ${Math.round(end)}s)`;
      container.appendChild(marker);
    }
  }

  vjsPlayer.on('loadedmetadata', renderSponsorMarkers);
  vjsPlayer.on('durationchange', renderSponsorMarkers);
  setTimeout(renderSponsorMarkers, 500);

  vjsPlayer.on('timeupdate', () => {
    if (!sponsorSegments.length) return;
    const ct = vjsPlayer.currentTime();
    for (const seg of sponsorSegments) {
      if (sponsorMode(seg) === 'skip_show' && ct >= seg.segment[0] && ct < seg.segment[1]) {
        vjsPlayer.currentTime(seg.segment[1]);
        break;
      }
    }
  });

  async function setStream(q, audioChoice) {
    const ct = vjsPlayer.currentTime() || 0;
    const paused = vjsPlayer.paused();

    if (window.sabrPlayerInstance) {
      window.sabrPlayerInstance.destroy();
      window.sabrPlayerInstance = null;
    }

    const mp4Audio = q.type === 'adaptive' && audioChoice && q.mimeType?.includes('mp4')
      ? (audioChoice.mimeType.includes('mp4') ? audioChoice : streamsObj.audioStreams.find(a =>
          a.mimeType.includes('mp4') && trackKey(a) === trackKey(audioChoice)))
      : null;

    const audioSelect = document.getElementById('ps-audio');
    if (audioSelect) {
      audioSelect.disabled = q.type === 'combined';
      audioSelect.style.opacity = q.type === 'combined' ? '0.5' : '1';
    }

    if (q.type === 'sabr' || mp4Audio) {
      isAudioTrackActive = false;
      audioTrackPlayer.pause();
      audioTrackPlayer.src = '';
      try {
        const vidEl = vjsPlayer.tech({ IWillNotUseThisInPlugins: true })?.el() || vjsPlayer.el().querySelector('video');
        const player = q.type === 'sabr'
          ? new SabrMediaSourcePlayer({ video: vidEl, sabrInfo: q.sabrInfo, videoFmt: q.videoFmt, audioFmt: sabrAudioFor(q.videoFmt, audioChoice) })
          : new DashMediaSourcePlayer({
              video: vidEl,
              videoFmt: { url: proxyStreamUrl(q.url), mimeType: q.mimeType },
              audioFmt: { url: proxyStreamUrl(mp4Audio.url), mimeType: mp4Audio.mimeType },
            });
        window.sabrPlayerInstance = player;
        await player.init();
        vjsPlayer.currentTime(ct);
        if (!paused) vjsPlayer.play();
        return;
      } catch (e) {
        console.warn('Streaming failed, falling back:', e);
        if (window.sabrPlayerInstance) {
          window.sabrPlayerInstance.destroy();
          window.sabrPlayerInstance = null;
        }
        if (q.type === 'sabr') {
          const fallback = qualities.find(x => x.type === 'adaptive' || x.type === 'combined');
          if (fallback) setStream(fallback, audioChoice);
          return;
        }
      }
    }

    vjsPlayer.src({ type: 'video/mp4', src: proxyStreamUrl(q.url) });

    if (q.type === 'adaptive') {
      isAudioTrackActive = true;
      const aSrc = audioChoice ? proxyStreamUrl(audioChoice.url) : proxyStreamUrl(q.audioUrl);
      if (audioTrackPlayer.src !== aSrc) {
        audioTrackPlayer.src = aSrc;
        audioTrackPlayer.load();
      }
      audioTrackPlayer.volume = userVolume;
      audioTrackPlayer.muted = userMuted;
    } else {
      isAudioTrackActive = false;
      audioTrackPlayer.pause();
      audioTrackPlayer.src = '';
      isSyncing = true;
      vjsPlayer.muted(userMuted);
      vjsPlayer.volume(userVolume);
      isSyncing = false;
    }

    vjsPlayer.ready(() => {
      vjsPlayer.currentTime(ct);
      if (isAudioTrackActive) {
        audioTrackPlayer.currentTime = ct;
      }
      if (!paused) {
        vjsPlayer.play();
        if (isAudioTrackActive) {
          audioTrackPlayer.play().catch(e => console.log('Audio play error:', e));
        }
      }
    });
  }

  document.getElementById('ps-quality').addEventListener('change', (e) => {
    const q = qualities[e.target.value];
    const a = audioOptions[document.getElementById('ps-audio').value];
    if (q) setStream(q, a);
  });

  document.getElementById('ps-audio').addEventListener('change', (e) => {
    const q = qualities[document.getElementById('ps-quality').value];
    const a = audioOptions[e.target.value];
    if (q?.type === 'sabr' || (q?.type === 'adaptive' && window.sabrPlayerInstance)) {
      setStream(q, a);
    } else if (q?.type === 'adaptive') {
      audioTrackPlayer.src = proxyStreamUrl(a.url);
      audioTrackPlayer.addEventListener('loadedmetadata', () => {
        audioTrackPlayer.currentTime = vjsPlayer.currentTime();
        if (!vjsPlayer.paused()) audioTrackPlayer.play().catch(() => {});
      }, { once: true });
    }
  });

  document.getElementById('ps-autoplay').addEventListener('change', (e) => {
    saveSettings({ ...getSettings(), autoplay: e.target.checked });
  });

  document.getElementById('ps-loop').addEventListener('change', (e) => {
    vjsPlayer.loop(e.target.checked);
  });

  const savePlBtn = document.getElementById('save-pl-btn');
  if (savePlBtn) {
    savePlBtn.addEventListener('click', () => {
      openSavePlaylistModal({
        videoId,
        title: detailObj.title || '',
        author: detailObj.author?.name || '',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration: detailObj.duration || '',
      });
    });

    savePlBtn.addEventListener('mouseenter', () => {
      savePlBtn.style.background = 'var(--bg-tertiary)';
      savePlBtn.style.borderColor = 'var(--accent)';
      savePlBtn.style.color = 'var(--accent)';
    });

    savePlBtn.addEventListener('mouseleave', () => {
      savePlBtn.style.background = 'none';
      savePlBtn.style.borderColor = 'var(--border)';
      savePlBtn.style.color = 'var(--text-secondary)';
    });
  }

  const watchSubBtn = document.getElementById('watch-sub-btn');
  const authorId = detailObj.author?.id;
  if (watchSubBtn && authorId) {
    const updateSubBtn = () => {
      const subs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
      const isSub = subs.includes(authorId);
      watchSubBtn.textContent = isSub ? 'Subscribed' : 'Subscribe';
      watchSubBtn.style.background = isSub ? 'var(--bg-tertiary)' : '#e50914';
      watchSubBtn.style.color = isSub ? 'var(--text-primary)' : '#fff';
      watchSubBtn.style.border = isSub ? '1px solid var(--border)' : 'none';
    };
    updateSubBtn();
    watchSubBtn.addEventListener('click', async () => {
      let subs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
      if (subs.includes(authorId)) {
        subs = subs.filter(id => id !== authorId);
      } else {
        subs.push(authorId);
      }
      localStorage.setItem('vivid_subs', JSON.stringify(subs));
      updateSubBtn();
      const token = localStorage.getItem('vivid_auth_token');
      if (token) {
        try {
          await syncAccount(token, { subscriptions: subs, playlists: getPlaylists() });
        } catch {}
      }
    });
  }

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const shareUrl = `${window.location.origin}${window.location.pathname}#/watch?v=${videoId}${listId ? '&list=' + listId : ''}`;
      const shareText = `Check out: ${detailObj.title}`;

      if (navigator.share) {
        navigator.share({
          title: detailObj.title,
          text: shareText,
          url: shareUrl
        }).catch(err => console.log('Error sharing:', err));
      } else {
        navigator.clipboard.writeText(shareUrl).then(() => {
          shareBtn.textContent = 'Copied!';
          setTimeout(() => {
            shareBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
            <span>Share</span>`;
          }, 2000);
        });
      }
    });

    shareBtn.addEventListener('mouseenter', () => {
      shareBtn.style.background = 'var(--bg-tertiary)';
      shareBtn.style.borderColor = 'var(--accent)';
      shareBtn.style.color = 'var(--accent)';
    });

    shareBtn.addEventListener('mouseleave', () => {
      shareBtn.style.background = 'none';
      shareBtn.style.borderColor = 'var(--border)';
      shareBtn.style.color = 'var(--text-secondary)';
    });
  }

  const loadCommentsBtn = document.getElementById('load-comments');
  if (loadCommentsBtn) {
    let commentToken = detailObj.comments?.continuationToken || '';
    let commentType = detailObj.comments?.type ?? 1;
    loadCommentsBtn.addEventListener('click', async () => {
      loadCommentsBtn.textContent = 'Loading...';
      if (!detailObj.isLivestream) {
        try {
          const data = await getComments(videoId, commentToken || undefined, commentType);
          const list = document.getElementById('comments-list');
          for (const c of data.comments || []) {
            list.insertAdjacentHTML('beforeend', renderComment(c, videoId));
          }
          commentToken = data.continuationToken || '';
          commentType = data.type ?? -1;
          if (!commentToken || commentType === -1) loadCommentsBtn.remove();
          else loadCommentsBtn.textContent = 'Load more';
          attachReplyListeners(videoId);
        } catch (e) {
          loadCommentsBtn.textContent = 'Error, retry';
        }
      } else {
        loadCommentsBtn.remove();
        document.getElementById('comments-section').querySelector('h3').textContent = 'Top Chat';
      }
    });
    loadCommentsBtn.click();
  }

  return stopPlayback;
}

function attachReplyListeners(videoId) {
  document.querySelectorAll('.load-replies-btn:not(.bound)').forEach(btn => {
    btn.classList.add('bound');
    btn.addEventListener('click', async () => {
      const token = btn.getAttribute('data-token');
      const target = document.getElementById(btn.getAttribute('data-target'));
      btn.textContent = 'Loading...';
      try {
        const data = await getCommentReplies(videoId, token);
        for (const r of data.replies || []) {
          target.insertAdjacentHTML('beforeend', renderComment(r, videoId, true));
        }
        if (data.continuationToken) {
          btn.setAttribute('data-token', data.continuationToken);
          btn.textContent = 'Load more replies';
        } else {
          btn.remove();
        }
        attachReplyListeners(videoId);
      } catch(e) {
        btn.textContent = 'Error';
      }
    });
  });
}

function renderSuggestion(s, listId, i, currentIdx) {
  if (!s) return '';
  const videoId = s.videoId || s.id;
  if (!videoId) return '';
  const href = `#/watch?v=${videoId}${listId ? '&list=' + listId : ''}`;
  const isPlaying = listId && i === currentIdx;
  const isNext = listId ? i === currentIdx + 1 : i === 0;

  return `
    <a href="${href}" class="suggestion-item${isPlaying ? ' suggestion-playing' : ''}${isNext ? ' suggestion-next' : ''}">
      <div class="suggestion-thumb">
        <img src="${proxyImageUrl(s.thumbnailUrl || '')}" alt="" loading="lazy">
        ${s.duration ? `<span class="video-card-duration">${escapeHtml(s.duration)}</span>` : ''}
      </div>
      <div class="suggestion-info">
        <div class="suggestion-title">${escapeHtml(s.title || '')}</div>
        <div class="suggestion-meta">${escapeHtml(s.author || s.authorName || '')}</div>
      </div>
    </a>
  `;
}

function renderComment(c, videoId, isReply = false) {
  const ownerHtml = c.authorIsChannelOwner
    ? `<span style="background:#444;color:#fff;padding:1px 5px;border-radius:3px;font-size:0.7rem;margin-left:4px;">Owner</span>`
    : '';
  const pinHtml = c.isPinned
    ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;background:var(--bg-tertiary);padding:2px 6px;border-radius:10px;margin-left:4px;border:1px solid var(--border);">${ICONS.pin} Pinned</span>`
    : '';
  const heartHtml = c.creatorHeart
    ? `<span style="display:inline-flex;align-items:center;margin-left:6px;" title="Liked by creator">${ICONS.heart}</span>`
    : '';
  const rid = 'replies-' + Math.random().toString(36).substr(2, 9);

  let authorLink = '';
  if (c.authorId) {
    authorLink = `href="#/channel/${c.authorId}"`;
  } else if (c.authorChannelId) {
    authorLink = `href="#/channel/${c.authorChannelId}"`;
  } else if (c.authorUrl) {
    const raw = c.authorUrl.startsWith('/') ? c.authorUrl.slice(1) : c.authorUrl;
    authorLink = `href="#/${raw}"`;
  }

  return `
    <div class="comment ${isReply ? 'comment-reply' : ''}" ${isReply ? 'style="margin-left:32px;border-left:2px solid var(--border);padding-left:12px;margin-top:8px;"' : ''}>
      <div class="comment-avatar">
        <img src="${proxyImageUrl(c.authorIconUrl || '')}" alt="" loading="lazy">
      </div>
      <div class="comment-content" style="flex:1;">
        <div class="comment-header">
          ${authorLink
            ? `<a ${authorLink} class="comment-author" style="color:var(--text-primary);">${escapeHtml(c.authorName || '')}${ownerHtml}</a>`
            : `<span class="comment-author">${escapeHtml(c.authorName || '')}${ownerHtml}</span>`
          }
          ${pinHtml}
          <span class="comment-date" style="font-size:0.72rem;">${escapeHtml(c.publishDate || '')}</span>
        </div>
        <div class="comment-text" style="overflow-wrap: break-word;">${linkifyComment(c.content || '')}</div>
        <div class="comment-footer">
          ${c.upvotes ? `<span class="comment-stat">${ICONS.thumbUp} ${escapeHtml(c.upvotes)}</span>` : ''}
          ${c.replyCount ? `<span class="comment-stat">${ICONS.comment} ${c.replyCount}</span>` : ''}
          ${heartHtml}
        </div>
        <div class="comment-replies-list" id="${rid}"></div>
        ${c.repliesContinuationToken ? `
          <button class="load-replies-btn" data-token="${c.repliesContinuationToken}" data-target="${rid}">View replies</button>
        ` : ''}
      </div>
    </div>
  `;
}

function openSavePlaylistModal(videoObj) {
  const existing = document.getElementById('save-playlist-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'save-playlist-modal';
  modal.className = 'modal-backdrop';

  const renderContent = () => {
    const playlists = getPlaylists();
    const listHtml = playlists.length === 0
      ? '<p style="color:var(--text-muted);margin:10px 0;">No playlists yet. Create one below!</p>'
      : playlists.map(pl => {
          const inPl = isVideoInPlaylist(pl.id, videoObj.videoId);
          return `
            <label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;color:var(--text-primary);">
              <input type="checkbox" data-pl-id="${pl.id}" ${inPl ? 'checked' : ''} style="accent-color:var(--accent);">
              <span style="font-weight:500;">${escapeHtml(pl.name)}</span>
              <span style="color:var(--text-muted);font-size:0.8rem;margin-left:auto;">(${pl.videos?.length || 0})</span>
            </label>
          `;
        }).join('');

    modal.innerHTML = `
      <div class="modal-box" style="max-width:380px;">
        <div class="modal-header">
          <h2 class="modal-title">Save to Playlist</h2>
          <button class="modal-close-btn" id="save-pl-close">&times;</button>
        </div>
        <div class="modal-body">
          <div id="save-pl-items" style="max-height:220px;overflow-y:auto;margin-bottom:1rem;">
            ${listHtml}
          </div>
          <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:12px;">
            <input type="text" id="new-pl-input" class="form-input" placeholder="New playlist name..." style="flex:1;">
            <button id="new-pl-btn" class="modal-btn-primary" style="white-space:nowrap;">Create</button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector('#save-pl-close').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('input[data-pl-id]').forEach(input => {
      input.addEventListener('change', (e) => {
        const plId = e.target.getAttribute('data-pl-id');
        if (e.target.checked) {
          addVideoToPlaylist(plId, videoObj);
        } else {
          removeVideoFromPlaylist(plId, videoObj.videoId);
        }
      });
    });

    const createBtn = modal.querySelector('#new-pl-btn');
    const createInput = modal.querySelector('#new-pl-input');
    createBtn.addEventListener('click', () => {
      const name = createInput.value.trim();
      if (!name) return;
      const newPl = createPlaylist(name);
      addVideoToPlaylist(newPl.id, videoObj);
      renderContent();
    });
  };

  renderContent();
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
}
