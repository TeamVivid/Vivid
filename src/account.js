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


import { registerAccount, loginAccount, getAccountMe, syncAccount, logoutAccount, deleteAccount } from './api.js';
import { getPlaylists, savePlaylists } from './playlistManager.js';

const TOKEN_KEY = 'vivid_auth_token';
const USERNAME_KEY = 'vivid_auth_username';

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export function getAuthUsername() {
  return localStorage.getItem(USERNAME_KEY) || null;
}

export function isLoggedIn() {
  return !!getAuthToken();
}

export function updateAuthHeaderBtn() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;
  const username = getAuthUsername();
  if (username) {
    btn.setAttribute('title', `Account: ${username}`);
    btn.classList.add('account-active');
  } else {
    btn.setAttribute('title', 'Account');
    btn.classList.remove('account-active');
  }
}

export async function checkAndSyncOnStartup() {
  const token = getAuthToken();
  if (!token) return;
  try {
    const data = await getAccountMe(token);
    if (data?.user) {
      localStorage.setItem(USERNAME_KEY, data.user.username);
      updateAuthHeaderBtn();
    }
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    updateAuthHeaderBtn();
  }
}

export function openAccountModal() {
  const existing = document.getElementById('account-modal');
  if (existing) existing.remove();

  const token = getAuthToken();
  const username = getAuthUsername();

  const modal = document.createElement('div');
  modal.id = 'account-modal';
  modal.className = 'modal-backdrop';

  if (!token) {
    modal.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2 class="modal-title">Account</h2>
          <button class="modal-close-btn" id="account-close-btn">&times;</button>
        </div>

        <div class="modal-tabs">
          <button class="modal-tab active" data-tab="tab-login">Log In</button>
          <button class="modal-tab" data-tab="tab-register">Register</button>
        </div>

        <div class="modal-body">
          <div id="account-alert" class="modal-alert" style="display:none;"></div>

          <form id="login-form" class="account-tab-pane active">
            <div class="form-group">
              <label for="login-username">Username</label>
              <input type="text" id="login-username" class="form-input" required autocomplete="username">
            </div>
            <div class="form-group">
              <label for="login-password">Password</label>
              <input type="password" id="login-password" class="form-input" required autocomplete="current-password">
            </div>
            <button type="submit" class="modal-btn-primary" style="width:100%; margin-top:1rem;">Log In</button>
          </form>

          <form id="register-form" class="account-tab-pane" style="display:none;">
            <div class="form-group">
              <label for="register-username">Choose a Username</label>
              <input type="text" id="register-username" class="form-input" required autocomplete="username" minlength="3">
            </div>
            <div class="form-group">
              <label for="register-password">Choose a Password</label>
              <input type="password" id="register-password" class="form-input" required autocomplete="new-password" minlength="4">
            </div>
            <button type="submit" class="modal-btn-primary" style="width:100%; margin-top:1rem;">Create Account</button>
          </form>
        </div>
      </div>
    `;
  } else {
    const subs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
    const playlists = getPlaylists();

    modal.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2 class="modal-title">My Account</h2>
          <button class="modal-close-btn" id="account-close-btn">&times;</button>
        </div>

        <div class="modal-body">
          <div class="account-profile-header">
            <div class="account-avatar-circle">${escapeHtml((username || 'U').charAt(0).toUpperCase())}</div>
            <div>
              <div class="account-username">${escapeHtml(username || 'User')}</div>
              <div class="account-instance-badge">Instance Account</div>
            </div>
          </div>

          <div class="account-stats-row">
            <div class="account-stat-box">
              <span class="account-stat-num" id="stat-subs-count">${subs.length}</span>
              <span class="account-stat-label">Subscriptions</span>
            </div>
            <div class="account-stat-box">
              <span class="account-stat-num" id="stat-pl-count">${playlists.length}</span>
              <span class="account-stat-label">Playlists</span>
            </div>
          </div>

          <div id="account-sync-status" class="modal-alert" style="display:none;"></div>

          <div class="account-actions-list">
            <button id="account-sync-btn" class="account-action-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
              <span>Sync Subscriptions & Playlists</span>
            </button>
            <a href="#/playlists" id="account-view-pl-btn" class="account-action-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <span>View My Playlists</span>
            </a>
            <button id="account-logout-btn" class="account-action-btn account-logout">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Log Out</span>
            </button>
            <button id="account-delete-btn" class="account-action-btn account-logout">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              <span>Delete Account</span>
            </button>
            <form id="account-delete-form" style="display:none;">
              <div class="form-group">
                <label for="delete-password">Confirm your password to permanently delete your account and its synced data</label>
                <input type="password" id="delete-password" class="form-input" required autocomplete="current-password">
              </div>
              <button type="submit" class="modal-btn-primary" style="width:100%; margin-top:1rem;">Delete Permanently</button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#account-close-btn').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  if (!token) {
    const tabs = modal.querySelectorAll('.modal-tab');
    const loginForm = modal.querySelector('#login-form');
    const registerForm = modal.querySelector('#register-form');
    const alertBox = modal.querySelector('#account-alert');

    tabs.forEach(t => {
      t.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        if (t.dataset.tab === 'tab-login') {
          loginForm.style.display = 'block';
          registerForm.style.display = 'none';
        } else {
          loginForm.style.display = 'none';
          registerForm.style.display = 'block';
        }
      });
    });

    const handleAuthSuccess = async (data) => {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USERNAME_KEY, data.user.username);
      updateAuthHeaderBtn();

      const localSubs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
      const localPl = getPlaylists();
      try {
        const synced = await syncAccount(data.token, { subscriptions: localSubs, playlists: localPl });
        if (synced?.user) {
          if (synced.user.subscriptions) localStorage.setItem('vivid_subs', JSON.stringify(synced.user.subscriptions));
          if (synced.user.playlists) savePlaylists(synced.user.playlists, false);
        }
      } catch {}

      close();
      window.dispatchEvent(new CustomEvent('vivid-auth-changed'));
    };

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.style.display = 'none';
      const u = loginForm.querySelector('#login-username').value;
      const p = loginForm.querySelector('#login-password').value;
      try {
        const res = await loginAccount(u, p);
        if (res.token) await handleAuthSuccess(res);
      } catch (err) {
        alertBox.textContent = err.message || 'Login failed';
        alertBox.style.display = 'block';
      }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.style.display = 'none';
      const u = registerForm.querySelector('#register-username').value;
      const p = registerForm.querySelector('#register-password').value;
      try {
        const res = await registerAccount(u, p);
        if (res.token) await handleAuthSuccess(res);
      } catch (err) {
        alertBox.textContent = err.message || 'Registration failed';
        alertBox.style.display = 'block';
      }
    });
  } else {
    const syncBtn = modal.querySelector('#account-sync-btn');
    const logoutBtn = modal.querySelector('#account-logout-btn');
    const statusBox = modal.querySelector('#account-sync-status');
    const viewPlBtn = modal.querySelector('#account-view-pl-btn');
    const deleteBtn = modal.querySelector('#account-delete-btn');
    const deleteForm = modal.querySelector('#account-delete-form');

    if (viewPlBtn) viewPlBtn.addEventListener('click', close);

    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
      try {
        const localSubs = JSON.parse(localStorage.getItem('vivid_subs') || '[]');
        const localPl = getPlaylists();
        const res = await syncAccount(token, { subscriptions: localSubs, playlists: localPl });
        if (res?.user) {
          if (res.user.subscriptions) {
            localStorage.setItem('vivid_subs', JSON.stringify(res.user.subscriptions));
            modal.querySelector('#stat-subs-count').textContent = res.user.subscriptions.length;
          }
          if (res.user.playlists) {
            savePlaylists(res.user.playlists, false);
            modal.querySelector('#stat-pl-count').textContent = res.user.playlists.length;
          }
        }
        statusBox.textContent = 'Synchronization completed successfully!';
        statusBox.className = 'modal-alert modal-alert-success';
        statusBox.style.display = 'block';
      } catch (err) {
        statusBox.textContent = `Sync error: ${err.message}`;
        statusBox.className = 'modal-alert';
        statusBox.style.display = 'block';
      }
      syncBtn.disabled = false;
      syncBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        <span>Sync Subscriptions & Playlists</span>
      `;
    });

    deleteBtn.addEventListener('click', () => {
      deleteForm.style.display = deleteForm.style.display === 'none' ? 'block' : 'none';
    });

    deleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await deleteAccount(token, deleteForm.querySelector('#delete-password').value);
      } catch (err) {
        statusBox.textContent = err.message || 'Account deletion failed';
        statusBox.className = 'modal-alert';
        statusBox.style.display = 'block';
        return;
      }
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USERNAME_KEY);
      updateAuthHeaderBtn();
      close();
      window.dispatchEvent(new CustomEvent('vivid-auth-changed'));
    });

    logoutBtn.addEventListener('click', async () => {
      try { await logoutAccount(token); } catch {}
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USERNAME_KEY);
      updateAuthHeaderBtn();
      close();
      window.dispatchEvent(new CustomEvent('vivid-auth-changed'));
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
