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

import { getChannel, getChannelContinuation, getChannelCommunity, getChannelPlaylists, getChannelHome, getChannelReleases, getChannelAbout, searchChannel, getPostComments, proxyImageUrl, syncAccount } from '../api.js';
import { escapeHtml } from '../router.js';
import { getPlaylists } from '../playlistManager.js';
import { videoCard, verifiedBadge } from './home.js';
import { renderComment, attachReplyListeners } from './watch.js';

export async function renderChannel(app, params) {
  const channelId = params.id;
  if (!channelId) {
    app.innerHTML = '<div class="error-msg">No channel ID provided</div>';
    return;
  }

  const data = await getChannel(channelId);
  if (!app.isConnected) return;

  if (data.error) {
    app.innerHTML = `<div class="error-msg">${escapeHtml(data.error)}</div>`;
    return;
  }
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
  let activeTab = '';
  let contToken = '';
  let sorts = {};
  
  const subs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
  const isSubscribed = subs.includes(channelId);

  app.innerHTML = `
  <div class="channel-header">
  ${data.bannerUrl ? `<div class="channel-banner"><img src="${proxyImageUrl(data.bannerUrl)}" alt=""></div>` : ''}
  <div class="channel-profile">
  <div class="channel-avatar-lg">
  <img src="${proxyImageUrl(data.iconUrl || '')}" alt="">
  </div>
  <div>
  <div class="channel-name-lg">${escapeHtml(data.name || '')}${verifiedBadge(data.verified)}</div>
  ${data.handle ? `<div class="channel-handle">${escapeHtml(data.handle)}</div>` : ''}
  ${data.subscriberCount ? `<div class="channel-sub-count">${escapeHtml(data.subscriberCount)}</div>` : ''}
  <button id="sub-btn" style="margin-top:8px; padding:6px 16px; background:#e50914; color:#fff; border:none; border-radius:16px; font-weight:bold; cursor:pointer;">
  ${isSubscribed ? 'Unsubscribe' : 'Subscribe'}
  </button>
  </div>
  </div>
  </div>

  ${data.description ? `
    <div class="channel-description" id="channel-description">
    <div class="channel-description-text">${escapeHtml(data.description)}</div>
    <span class="channel-description-more">...more</span>
    </div>
    ` : ''}

    <div class="channel-tabs" id="channel-tabs">
    <button class="channel-tab active" data-tab="home">Home</button>
    <button class="channel-tab" data-tab="videos">Videos</button>
    <button class="channel-tab" data-tab="shorts">Shorts</button>
    <button class="channel-tab" data-tab="streams">Streams</button>
    ${data.releasesTabParams ? '<button class="channel-tab" data-tab="releases">Releases</button>' : ''}
    <button class="channel-tab" data-tab="playlists">Playlists</button>
<button class="channel-tab" data-tab="community">Community</button>
    <button class="channel-tab" data-tab="search">Search</button>
    </div>

    <div id="channel-sorts" style="margin-bottom:1rem; display:none; gap:8px;"></div>

    <div class="video-grid" id="channel-content"></div>
    <div id="community-content" style="display:none;"></div>
    <button class="load-more" id="load-more-channel" style="display:none;">Load more</button>
    `;
  document.title = data.name ? `${data.name} - Vivid` : 'Channel - Vivid';
  
  const sortsContainer = document.getElementById('channel-sorts');
  const content = document.getElementById('channel-content');
  const communityContent = document.getElementById('community-content');
  const loadMoreBtn = document.getElementById('load-more-channel');

  function bindSortBtns() {
    sortsContainer.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        sortsContainer.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        try {
          const more = await getChannelContinuation(channelId, btn.dataset.token);
          contToken = more.continuationToken || '';
          content.innerHTML = (more.items || []).map(renderItem).join('');
          if (contToken && loadMoreBtn) loadMoreBtn.style.display = 'block';
        } catch (e) {}
      });
    });
  }
  bindSortBtns();


  const descBox = document.getElementById('channel-description');
  if (descBox) {
    descBox.addEventListener('click', async () => {
      const modal = document.createElement('div');
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal-box">
          <div class="modal-header">
            <h2 class="modal-title">About</h2>
            <button class="modal-close-btn">&times;</button>
          </div>
          <div class="modal-body channel-about"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('.modal-close-btn')) modal.remove();
      });

      const about = await getChannelAbout(channelId).catch(() => ({ error: true }));
      const stats = about.error
        ? [data.handle, data.subscriberCount]
        : [about.handle, about.country, about.joined, about.subscribers, about.videos, about.views];
      const links = (about.links || []).map(l => `
        <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="channel-about-link">
          <span>${escapeHtml(l.title)}</span>
          <span>${escapeHtml(l.label)}</span>
        </a>
      `).join('');
      modal.querySelector('.channel-about').innerHTML = `
        <div class="channel-about-description">${linkifyText(about.description || data.description || '')}</div>
        ${links ? `<h3>Links</h3><div class="channel-about-links">${links}</div>` : ''}
        <h3>More info</h3>
        <ul class="channel-about-stats">${stats.filter(Boolean).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      `;
    });
  }

  function renderSections(sections) {
    return sections.map(sec => sec.items.length === 1 && sec.items[0].description ? `
      <div class="channel-featured">
        <a href="#${sec.items[0].url}" class="channel-featured-thumb"><img src="${proxyImageUrl(sec.items[0].thumbnailUrl)}" alt=""></a>
        <div class="channel-featured-info">
          <a href="#${sec.items[0].url}" class="channel-featured-title">${escapeHtml(sec.items[0].title)}</a>
          <div class="channel-featured-meta">${[sec.items[0].views, sec.items[0].publishDate].filter(Boolean).map(escapeHtml).join(' • ')}</div>
          <div class="channel-featured-desc">${escapeHtml(sec.items[0].description)}</div>
        </div>
      </div>
    ` : `
      <div class="channel-shelf">
        ${sec.title ? `<h2 class="channel-shelf-title">${escapeHtml(sec.title)}</h2>` : ''}
        <div class="channel-shelf-row">${sec.items.map(renderItem).join('')}</div>
      </div>
    `).join('');
  }

  content.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = e.target.querySelector('input').value.trim();
    if (!q) return;
    const results = document.getElementById('channel-search-results');
    results.innerHTML = '<div class="loading" style="grid-column:1/-1;"><div class="spinner"></div></div>';
    loadMoreBtn.style.display = 'none';
    try {
      const res = await searchChannel(channelId, q);
      contToken = res.continuationToken || '';
      results.innerHTML = (res.items || []).map(renderItem).join('')
        || `<p style="color:var(--text-muted);grid-column:1/-1;">${escapeHtml(res.error || 'No results found')}</p>`;
      if (contToken) loadMoreBtn.style.display = 'block';
    } catch (err) {
      results.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    }
  });

  communityContent.addEventListener('click', async (e) => {
    const toggle = e.target.closest('.community-comments-btn');
    const more = e.target.closest('.community-comments-more');
    const box = document.getElementById(`cc-${(toggle || more)?.dataset.post}`);
    if (!box) return;
    if (toggle && box.dataset.loaded) {
      box.hidden = !box.hidden;
      return;
    }
    box.dataset.loaded = '1';
    box.hidden = false;
    more?.remove();
    const postId = (toggle || more).dataset.post;
    try {
      const res = await getPostComments(postId, channelId, box.dataset.token || null);
      if (res.error && !res.comments?.length) {
        box.insertAdjacentHTML('beforeend', `<p style="color:var(--text-muted)">${escapeHtml(res.error)}</p>`);
        delete box.dataset.loaded;
        return;
      }
      box.insertAdjacentHTML('beforeend', (res.comments || []).map(c => renderComment(c, postId)).join(''));
      box.dataset.token = res.continuationToken || '';
      if (res.continuationToken) {
        box.insertAdjacentHTML('beforeend', `<button class="load-more community-comments-more" data-post="${postId}">Load more</button>`);
      }
      attachReplyListeners(postId, '', true);
    } catch {
      box.insertAdjacentHTML('beforeend', '<p style="color:var(--text-muted)">Failed to load comments</p>');
    }
  });

  
  const tabs = app.querySelectorAll('.channel-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const newTab = tab.dataset.tab;
      if (newTab === activeTab) return;
      activeTab = newTab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      sortsContainer.style.display = ['videos','streams','shorts'].includes(newTab) ? 'flex' : 'none';
      content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      content.style.display = newTab === 'community' ? 'none' : 'grid';
      communityContent.style.display = newTab === 'community' ? 'block' : 'none';
      communityContent.innerHTML = newTab === 'community' ? '<div class="loading"><div class="spinner"></div></div>' : '';
      
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';

      try {
        let tabData;
        if (newTab === 'search') {
          contToken = '';
          content.innerHTML = `
            <form class="channel-search" style="grid-column:1/-1;">
              <input type="search" class="form-input" placeholder="Search this channel">
              <button type="submit" class="channel-search-btn">Search</button>
            </form>
            <div id="channel-search-results" style="display:contents;"></div>
          `;
          content.querySelector('input').focus();
        } else if (newTab === 'home' || newTab === 'releases') {
          tabData = newTab === 'home' ? await getChannelHome(channelId) : await getChannelReleases(channelId);
          contToken = '';
          content.innerHTML = renderSections(tabData.sections || [])
            || '<p style="color:var(--text-muted);grid-column:1/-1;">Nothing here</p>';
        } else if (newTab === 'videos') {
          tabData = await getChannel(channelId);
          contToken = tabData.videosContinuationToken || '';
          content.innerHTML = (tabData.videos || []).map(v => videoCard(v)).join('');
          sorts = tabData.videoSortTokens || {};
          sortsContainer.innerHTML = renderSortButtons(sorts);
          bindSortBtns();
        } else if (newTab === 'streams') {
          const res = await fetch(`/api/v1/channels/${channelId}/streams`);
          tabData = await res.json();
          contToken = tabData.streamsContinuationToken || '';
          content.innerHTML = (tabData.streams || []).map(v => videoCard(v)).join('');
          sorts = tabData.streamsSortTokens || {};
          sortsContainer.innerHTML = renderSortButtons(sorts);
          bindSortBtns();
        } else if (newTab === 'shorts') {
          const res = await fetch(`/api/v1/channels/${channelId}/shorts`);
          tabData = await res.json();
          contToken = tabData.shortsContinuationToken || '';
          content.innerHTML = (tabData.shorts || []).map(v => videoCard(v)).join('');
          sorts = tabData.shortsSortTokens || {};
          sortsContainer.innerHTML = renderSortButtons(sorts);
          bindSortBtns();
        } else if (newTab === 'playlists') {
          tabData = await getChannelPlaylists(channelId);
          contToken = '';
          const html = [];
          for (const pl of tabData.playlists || []) {
            if (pl.category) html.push(`<h2 style="grid-column: 1/-1; margin:1rem 0;">${escapeHtml(pl.category)}</h2>`);
            html.push(...(pl.items || []).map(p => playlistCard(p)));
          }
          content.innerHTML = html.join('');
        } else if (newTab === 'community') {
          tabData = await getChannelCommunity(channelId);
          contToken = tabData.continuationToken || '';
          communityContent.innerHTML = (tabData.posts || []).map(p => renderCommunityPost(p)).join('');
        }
        
        if (contToken && loadMoreBtn) loadMoreBtn.style.display = 'block';
        else if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      } catch (e) {
        content.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      }
    });
  });

  
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      if (!contToken) return;
      loadMoreBtn.textContent = 'Loading...';
      loadMoreBtn.disabled = true;
      try {
        const more = await getChannelContinuation(channelId, contToken);
        for (const item of more.items || []) {
          content.insertAdjacentHTML('beforeend', renderItem(item));
        }
        contToken = more.continuationToken || '';
        if (!contToken) loadMoreBtn.style.display = 'none';
        else loadMoreBtn.textContent = 'Load more';
      } catch (e) {
        loadMoreBtn.textContent = 'Error, retry';
      } finally {
        loadMoreBtn.disabled = false;
      }
    });
  }

  app.querySelector('[data-tab="home"]').click();

  const subBtn = document.getElementById('sub-btn');
  if (subBtn) {
    subBtn.addEventListener('click', async () => {
      let subs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
      if (subs.includes(channelId)) {
        subs = subs.filter(id => id !== channelId);
        subBtn.textContent = 'Subscribe';
        subBtn.style.background = '#e50914';
      } else {
        subs.push(channelId);
        subBtn.textContent = 'Unsubscribe';
        subBtn.style.background = 'var(--bg-tertiary)';
      }
      localStorage.setItem('vivid_subs', JSON.stringify(subs));
      const token = localStorage.getItem('vivid_auth_token');
      if (token) {
        try {
          await syncAccount(token, { subscriptions: subs, playlists: getPlaylists() });
        } catch {}
      }
    });
  }
}

function renderItem(item) {
  if (item.type === 'playlist') return playlistCard(item);
  if (item.type === 'channel') {
    return `
      <a href="#/channel/${encodeURIComponent(item.id)}" class="channel-card">
        <div class="channel-card-avatar"><img src="${proxyImageUrl(item.iconUrl || '')}" alt="" loading="lazy"></div>
        <div>
          <div class="channel-card-name">${escapeHtml(item.name || '')}${verifiedBadge(item.verified)}</div>
          <div class="channel-card-meta">${escapeHtml(item.subscribers || '')}</div>
        </div>
      </a>
    `;
  }
  return videoCard(item);
}

function renderSortButtons(sorts) {
  return [['newest', 'Newest'], ['popular', 'Popular'], ['oldest', 'Oldest']]
    .filter(([key]) => sorts[key])
    .map(([key, label]) => `<button class="sort-btn${key === 'newest' ? ' active' : ''}" data-token="${sorts[key]}">${label}</button>`)
    .join('');
}

function playlistCard(p) {
  if (!p) return '';
  let href = '#/playlist?list=' + (p.id || '');
  if (!p.id && p.url) {
    const match = p.url.match(/[?&]list=([^&]+)/);
    if (match) href = '#/playlist?list=' + match[1];
    else href = '#' + (p.url.startsWith('/') ? p.url : '/' + p.url);
  }
  return `
    <div class="video-card">
      <a href="${href}" class="video-card-link">
        <div class="video-card-thumb" style="position:relative;">
          <img src="${proxyImageUrl(p.thumbnailUrl || '')}" alt="" loading="lazy">
          <span class="video-card-duration" style="display:flex;align-items:center;gap:4px;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            ${escapeHtml(p.videoCount || '')}
          </span>
        </div>
        <div class="video-card-info">
          <div class="video-card-title">${escapeHtml(p.title || '')}</div>
          <div class="video-card-meta">${escapeHtml(p.subtitle || 'Playlist')}</div>
        </div>
      </a>
    </div>
  `;
}

function renderCommunityPost(p) {
  const channelHref = p.authorId
    ? `#/channel/${encodeURIComponent(p.authorId)}`
    : (p.authorUrl ? `#${p.authorUrl.startsWith('/') ? p.authorUrl : '/' + p.authorUrl}` : '');

  const authorHtml = channelHref
    ? `<a href="${channelHref}" style="font-weight:600;color:var(--text-primary);text-decoration:none;">${escapeHtml(p.authorName || '')}</a>`
    : `<div style="font-weight:600;">${escapeHtml(p.authorName || '')}</div>`;

  const avatarHtml = channelHref
    ? `<a href="${channelHref}"><img src="${proxyImageUrl(p.authorIconUrl || '')}" alt="" style="width:40px; height:40px; border-radius:50%;"></a>`
    : `<img src="${proxyImageUrl(p.authorIconUrl || '')}" alt="" style="width:40px; height:40px; border-radius:50%;">`;

  return `
    <div class="community-post" style="background:var(--bg-card); padding:1rem; border-radius:8px; margin-bottom:1rem; border:1px solid var(--border-color);">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        ${avatarHtml}
        <div>
          ${authorHtml}
          <div style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(p.time || '')}</div>
        </div>
      </div>
      <div style="margin-bottom:12px; white-space:pre-wrap;">${escapeHtml(p.message || '')}</div>
      ${p.imageUrl ? `<img src="${proxyImageUrl(p.imageUrl)}" style="max-width:100%; border-radius:8px; margin-bottom:12px; max-height:500px; object-fit:contain;" alt="">` : ''}
      ${p.video ? `<div style="margin-bottom:12px; border:1px solid var(--border-color); border-radius:8px; overflow:hidden;">${videoCard(p.video)}</div>` : ''}
      <div style="color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;gap:12px;"><span style="display:flex;align-items:center;gap:5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg> ${escapeHtml(p.upvotes || '0')}</span>${p.id ? `<button class="community-comments-btn" data-post="${p.id}" title="Comments"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>${escapeHtml(p.commentCount || '')}</button>` : ''}</div>
      ${p.id ? `<div class="community-comments" id="cc-${p.id}" hidden></div>` : ''}
    </div>
  `;
}
