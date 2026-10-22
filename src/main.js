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


import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import { route, handleRoute, navigate } from './router.js';
import { renderHome } from './pages/home.js';
import { renderSearch } from './pages/search.js';
import { renderWatch } from './pages/watch.js';
import { renderChannel } from './pages/channel.js';
import { renderPlaylist } from './pages/playlist.js';
import { renderUserPlaylists } from './pages/userPlaylists.js';
import { renderPrivacy } from './pages/privacy.js';
import { getSearchSuggestions } from './api.js';
import { applySettings, openSettingsModal, getSettings, saveSettings } from './settings.js';
import { openAccountModal, updateAuthHeaderBtn, checkAndSyncOnStartup } from './account.js';

if (location.pathname !== '/' && !location.hash) {
  const target = location.pathname + location.search;
  history.replaceState(null, '', '/#' + target);
}

route('/', renderHome);
route('/results', renderSearch);
route('/watch', renderWatch);
route('/embed/:id', (app, params) => renderWatch(app, { ...params, v: params.id, embed: '1' }));
route('/channel/:id', renderChannel);
route('/playlist', renderPlaylist);
route('/playlists', renderUserPlaylists);
route('/privacy', renderPrivacy);


window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', () => {
  fetch('/api/v1').then(r => r.json()).then(info => {
    const el = document.getElementById('footer-version');
    if (el) el.textContent = info.behind ? `${info.version} (${info.behind} behind)` : info.version;
    const privacyLink = document.getElementById('footer-privacy');
    if (privacyLink && info.privacyPolicyUrl) {
      privacyLink.href = info.privacyPolicyUrl;
      privacyLink.target = '_blank';
      privacyLink.rel = 'noopener';
    }
  }).catch(() => {});
  applySettings();
  checkAndSyncOnStartup();
  updateAuthHeaderBtn();

  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const headerNav = document.getElementById('header-nav');
  if (mobileMenuBtn && headerNav) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      headerNav.classList.toggle('mobile-open');
    });
    document.addEventListener('click', (e) => {
      if (!headerNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        headerNav.classList.remove('mobile-open');
      }
    });
    headerNav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        headerNav.classList.remove('mobile-open');
      });
    });
  }

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const s = getSettings();
      const nextTheme = s.theme === 'light' ? 'dark' : 'light';
      saveSettings({ ...s, theme: nextTheme });
    });
  }

  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => openSettingsModal());
  }

  const accountBtn = document.getElementById('account-btn');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => openAccountModal());
  }

  
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  
  const suggestBox = document.createElement('div');
  suggestBox.className = 'search-suggestions';
  suggestBox.style.cssText = 'display:none; position:absolute; top:100%; left:0; right:0; background:var(--bg-main, #121212); border:1px solid var(--border-color); border-radius:4px; z-index:100; max-height:300px; overflow-y:auto; box-shadow:0 4px 6px rgba(0,0,0,0.5); opacity:1;';
  searchForm.style.position = 'relative';
  searchForm.appendChild(suggestBox);

  let suggestTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(suggestTimeout);
    suggestTimeout = setTimeout(async () => {
      const q = e.target.value.trim();
      if (!q) { suggestBox.style.display = 'none'; return; }
      try {
        const data = await getSearchSuggestions(q);
        if (!data.suggestions?.length) { suggestBox.style.display = 'none'; return; }
        suggestBox.innerHTML = data.suggestions.map(s => 
          `<div class="suggestion-item" data-q="${s.replace(/"/g, '&quot;')}" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border-color);">${s}</div>`
        ).join('');
        suggestBox.style.display = 'block';
      } catch(er) {}
    }, 200);
  });


  document.addEventListener('click', (e) => {
    if (!searchForm.contains(e.target)) suggestBox.style.display = 'none';
  });

    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      suggestBox.style.display = 'none';
      const query = searchInput.value.trim();
      if (query) {
        navigate(`/results?search_query=${encodeURIComponent(query)}`);
      }
    });

    suggestBox.addEventListener('click', (e) => {
      if (e.target.classList.contains('suggestion-item')) {
        const query = e.target.dataset.q;
        searchInput.value = query;
        suggestBox.style.display = 'none';
        navigate(`/results?search_query=${encodeURIComponent(query)}`);
      }
    });

    document.getElementById('search-btn').addEventListener('click', (e) => {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query) {
        suggestBox.style.display = 'none';
        navigate(`/results?search_query=${encodeURIComponent(query)}`);
      }
    });

  const logoLink = document.getElementById('logo-link');
  if (logoLink) {
    logoLink.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        window.open(window.location.origin + window.location.pathname, '_blank');
        return;
      }
      e.preventDefault();
      navigate('/');
    });
  }

  const navHome = document.getElementById('nav-home');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('/');
    });
  }

  const navPlaylists = document.getElementById('nav-playlists');
  if (navPlaylists) {
    navPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('/playlists');
    });
  }

  handleRoute();
});
