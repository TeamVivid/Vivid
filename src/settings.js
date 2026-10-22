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


export const THEMES = [
  { id: 'dark', name: 'Dark (Default)' },
  { id: 'oled', name: 'OLED Pure Black' },
  { id: 'dracula', name: 'Dracula' },
  { id: 'nord', name: 'Nord' },
  { id: 'catppuccin', name: 'Catppuccin Mocha' },
  { id: 'cyberpunk', name: 'Cyberpunk' },
  { id: 'light', name: 'Light' },
];

export const AUTOPLAY_MODES = {
  always: 'Always',
  playlists: 'Playlists only',
  off: 'Off',
};

export const AUDIO_QUALITIES = {
  high: 'Highest',
  medium: 'Medium',
  low: 'Lowest',
};

export function pickAudioByQuality(list, quality = 'high') {
  const sorted = [...list].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const idx = quality === 'low' ? sorted.length - 1 : quality === 'medium' ? Math.floor((sorted.length - 1) / 2) : 0;
  return sorted[idx] || null;
}

export const SPONSOR_CATEGORIES = {
  sponsor: { name: 'Sponsor', defaultBehavior: 'skip_show', color: '#00d400' },
  intro: { name: 'Intermission / Intro', defaultBehavior: 'skip_show', color: '#00d8d8' },
  outro: { name: 'Outro / Endcards', defaultBehavior: 'skip_show', color: '#5c6bc0' },
  interaction: { name: 'Interaction Reminder', defaultBehavior: 'show_only', color: '#ec407a' },
  selfpromo: { name: 'Self-promotion', defaultBehavior: 'skip_show', color: '#ffd54f' },
  music_offtopic: { name: 'Non-music Section', defaultBehavior: 'show_only', color: '#ff9800' },
  preview: { name: 'Preview / Recap', defaultBehavior: 'show_only', color: '#29b6f6' },
  filler: { name: 'Filler Tangent / Jokes', defaultBehavior: 'show_only', color: '#7300ff' },
  poi_highlight: { name: 'Highlight / Point of Interest', defaultBehavior: 'show_only', color: '#ff1493' },
};

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  layoutStyle: 'grid',
  uiScale: 'normal',
  defaultQuality: 'auto',
  autoplayMode: 'always',
  autoplayCountdown: 0,
  defaultAudioQuality: 'high',
  loopVideo: false,
  trySabr: true,
  disablePopularHome: false,
  showShortsInResults: false,
  sponsorBlockEnabled: true,
  sponsorCategories: {
    sponsor: 'skip_show',
    intro: 'skip_show',
    outro: 'skip_show',
    interaction: 'show_only',
    selfpromo: 'skip_show',
    music_offtopic: 'show_only',
    preview: 'show_only',
    filler: 'show_only',
    poi_highlight: 'show_only',
  }
};

const SETTINGS_KEY = 'vivid_settings';

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const hasCustomLayout = parsed.customLayout === true || localStorage.getItem('vivid_custom_layout') === 'true';
    const layoutStyle = hasCustomLayout && (parsed.layoutStyle === 'list' || parsed.layoutStyle === 'grid')
      ? parsed.layoutStyle
      : 'grid';
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      layoutStyle,
      autoplayMode: parsed.autoplayMode || (parsed.autoplay === false ? 'off' : 'always'),
      sponsorCategories: {
        ...DEFAULT_SETTINGS.sponsorCategories,
        ...(parsed.sponsorCategories || {})
      }
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    if (settings.customLayout) {
      localStorage.setItem('vivid_custom_layout', 'true');
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem('vivid-theme', settings.theme);
  } catch {}
  applySettings(settings);
  window.dispatchEvent(new CustomEvent('vivid-settings-changed', { detail: settings }));
}

export function applySettings(settings = getSettings()) {
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-scale', settings.uiScale);
  root.setAttribute('data-layout', settings.layoutStyle);
}

export function openSettingsModal() {
  const existing = document.getElementById('settings-modal');
  if (existing) existing.remove();

  const settings = getSettings();

  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.className = 'modal-backdrop';

  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button class="modal-close-btn" id="modal-close-btn" aria-label="Close settings">&times;</button>
      </div>

      <div class="modal-tabs">
        <button class="modal-tab active" data-tab="tab-appearance">Appearance</button>
        <button class="modal-tab" data-tab="tab-playback">Playback & SABR</button>
        <button class="modal-tab" data-tab="tab-sponsorblock">SponsorBlock</button>
      </div>

      <div class="modal-body">
        <div class="settings-tab-pane active" id="tab-appearance">
          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Theme</label>
              <div class="setting-desc">Choose your visual color theme</div>
            </div>
            <select id="setting-theme" class="setting-select">
              ${THEMES.map(t => `<option value="${t.id}" ${settings.theme === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Results Layout</label>
              <div class="setting-desc">Display video cards vertically (Grid) or horizontally (List)</div>
            </div>
            <select id="setting-layout" class="setting-select">
              <option value="grid" ${settings.layoutStyle === 'grid' ? 'selected' : ''}>Vertical Grid (Default)</option>
              <option value="list" ${settings.layoutStyle === 'list' ? 'selected' : ''}>Horizontal List</option>
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">UI Sizing</label>
              <div class="setting-desc">Scale UI size, cards, and thumbnails</div>
            </div>
            <select id="setting-scale" class="setting-select">
              <option value="normal" ${settings.uiScale === 'normal' ? 'selected' : ''}>Standard</option>
              <option value="large" ${settings.uiScale === 'large' ? 'selected' : ''}>Large (Comfortable)</option>
              <option value="xlarge" ${settings.uiScale === 'xlarge' ? 'selected' : ''}>Extra Large</option>
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Disable Popular on Home</label>
              <div class="setting-desc">Do not show popular/trending videos on the home page</div>
            </div>
            <label class="setting-switch">
              <input type="checkbox" id="setting-disable-popular" ${settings.disablePopularHome ? 'checked' : ''}>
              <span class="setting-slider"></span>
            </label>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Shorts in Search Results</label>
              <div class="setting-desc">Show the Shorts shelf and Shorts filter on the results page</div>
            </div>
            <label class="setting-switch">
              <input type="checkbox" id="setting-shorts-results" ${settings.showShortsInResults ? 'checked' : ''}>
              <span class="setting-slider"></span>
            </label>
          </div>
        </div>

        <div class="settings-tab-pane" id="tab-playback">
          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Default Quality</label>
              <div class="setting-desc">Preferred video stream resolution</div>
            </div>
            <select id="setting-quality" class="setting-select">
              <option value="auto" ${settings.defaultQuality === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="1080" ${settings.defaultQuality === '1080' ? 'selected' : ''}>1080p</option>
              <option value="720" ${settings.defaultQuality === '720' ? 'selected' : ''}>720p</option>
              <option value="480" ${settings.defaultQuality === '480' ? 'selected' : ''}>480p</option>
              <option value="360" ${settings.defaultQuality === '360' ? 'selected' : ''}>360p</option>
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Default Audio Quality</label>
              <div class="setting-desc">Preferred audio stream bitrate for audio only and downloads</div>
            </div>
            <select id="setting-audio-quality" class="setting-select">
              ${Object.entries(AUDIO_QUALITIES).map(([k, v]) => `<option value="${k}" ${settings.defaultAudioQuality === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Autoplay Next Video</label>
              <div class="setting-desc">When to automatically play the next video after one ends</div>
            </div>
            <select id="setting-autoplay" class="setting-select">
              ${Object.entries(AUTOPLAY_MODES).map(([k, v]) => `<option value="${k}" ${settings.autoplayMode === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Autoplay Countdown</label>
              <div class="setting-desc">Seconds to wait before the next video starts</div>
            </div>
            <select id="setting-autoplay-countdown" class="setting-select">
              ${[0, 3, 5, 10, 15].map(n => `<option value="${n}" ${settings.autoplayCountdown === n ? 'selected' : ''}>${n ? `${n} seconds` : 'Off (instant)'}</option>`).join('')}
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Enable SABR Streaming</label>
              <div class="setting-desc">Use client-side SABR decoding for adaptive streams when available</div>
            </div>
            <label class="setting-switch">
              <input type="checkbox" id="setting-sabr" ${settings.trySabr ? 'checked' : ''}>
              <span class="setting-slider"></span>
            </label>
          </div>
        </div>

        <div class="settings-tab-pane" id="tab-sponsorblock">
          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">Enable SponsorBlock</label>
              <div class="setting-desc">Show colored segments and skip sponsored sections</div>
            </div>
            <label class="setting-switch">
              <input type="checkbox" id="setting-sponsor-enabled" ${settings.sponsorBlockEnabled ? 'checked' : ''}>
              <span class="setting-slider"></span>
            </label>
          </div>

          <div class="sponsor-categories-header">
            <span>Segment Category</span>
            <span>Action</span>
          </div>

          <div class="sponsor-categories-list">
            ${Object.entries(SPONSOR_CATEGORIES).map(([key, cat]) => {
              const currentVal = settings.sponsorCategories[key] || cat.defaultBehavior;
              return `
                <div class="sponsor-cat-row">
                  <div class="sponsor-cat-info">
                    <span class="sponsor-color-indicator" style="background:${cat.color}"></span>
                    <span>${cat.name}</span>
                  </div>
                  <select class="setting-select sponsor-cat-select" data-category="${key}">
                    <option value="skip_show" ${currentVal === 'skip_show' ? 'selected' : ''}>Skip & Show</option>
                    <option value="show_only" ${currentVal === 'show_only' ? 'selected' : ''}>Show only</option>
                    <option value="disabled" ${currentVal === 'disabled' ? 'selected' : ''}>Disabled</option>
                  </select>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button id="modal-cancel-btn" class="modal-btn-secondary">Cancel</button>
        <button id="modal-save-btn" class="modal-btn-primary">Save & Apply</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modal-close-btn').addEventListener('click', close);
  modal.querySelector('#modal-cancel-btn')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  const tabButtons = modal.querySelectorAll('.modal-tab');
  const tabPanes = modal.querySelectorAll('.settings-tab-pane');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = modal.querySelector(`#${btn.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });

  modal.querySelector('#modal-save-btn').addEventListener('click', () => {
    const updated = {
      theme: modal.querySelector('#setting-theme').value,
      layoutStyle: modal.querySelector('#setting-layout').value,
      customLayout: true,
      uiScale: modal.querySelector('#setting-scale').value,
      defaultQuality: modal.querySelector('#setting-quality').value,
      autoplayMode: modal.querySelector('#setting-autoplay').value,
      autoplayCountdown: parseInt(modal.querySelector('#setting-autoplay-countdown').value, 10),
      defaultAudioQuality: modal.querySelector('#setting-audio-quality').value,
      loopVideo: settings.loopVideo,
      trySabr: modal.querySelector('#setting-sabr').checked,
      disablePopularHome: modal.querySelector('#setting-disable-popular')?.checked ?? false,
      showShortsInResults: modal.querySelector('#setting-shorts-results')?.checked ?? false,
      sponsorBlockEnabled: modal.querySelector('#setting-sponsor-enabled').checked,
      sponsorCategories: {}
    };

    modal.querySelectorAll('.sponsor-cat-select').forEach(sel => {
      updated.sponsorCategories[sel.dataset.category] = sel.value;
    });

    saveSettings(updated);
    close();
  });
}
