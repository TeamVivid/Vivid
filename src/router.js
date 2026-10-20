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

const routes = {};
let currentCleanup = null;

export function route(pattern, handler) {
  routes[pattern] = handler;
}

export function navigate(path) {
  window.location.hash = '#' + path;
}

export async function handleRoute() {
  let hash = window.location.hash.slice(1) || '/';
  const channelPath = hash.match(/^\/(@[^/?#]+|(?:c|user)\/[^/?#]+)/);
  if (channelPath) hash = `/channel/${encodeURIComponent(channelPath[1])}`;
  const app = document.getElementById('app');

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  let matched = false;
  for (const [pattern, handler] of Object.entries(routes)) {
    const params = matchRoute(pattern, hash);
    if (params !== null) {
      matched = true;
      try {
        const cleanup = await handler(app, params);
        if (typeof cleanup === 'function') currentCleanup = cleanup;
      } catch (e) {
        app.innerHTML = `<div class="error-msg">Error: ${escapeHtml(e.message)}</div>`;
        console.error(e);
      }
      break;
    }
  }

  if (!matched) {
    const homeHandler = routes['/'];
    if (homeHandler) {
      try {
        const cleanup = await homeHandler(app, {});
        if (typeof cleanup === 'function') currentCleanup = cleanup;
      } catch (e) {
        app.innerHTML = `<div class="error-msg">Error: ${escapeHtml(e.message)}</div>`;
      }
    }
  }

  window.scrollTo(0, 0);
}

function matchRoute(pattern, path) {
  const [pathPart, queryPart] = path.split('?');
  const [patternPart] = pattern.split('?');

  const patternParts = patternPart.split('/').filter(Boolean);
  const pathParts = pathPart.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};

  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    for (const [k, v] of searchParams) params[k] = v;
  }

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { escapeHtml };
