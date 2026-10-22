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
let routeId = 0;

export function route(pattern, handler) {
  routes[pattern] = handler;
}

export function navigate(path) {
  window.location.hash = '#' + path;
}

export async function handleRoute() {
  const id = ++routeId;
  let hash = window.location.hash.slice(1) || '/';
  const channelPath = hash.match(/^\/(@[^/?#]+|(?:c|user)\/[^/?#]+)/);
  if (channelPath) hash = `/channel/${encodeURIComponent(channelPath[1])}`;

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  const app = document.createElement('div');
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  document.getElementById('app').replaceChildren(app);
  document.body.classList.toggle('embed-mode', hash.startsWith('/embed/'));

  const [pattern] = Object.keys(routes).filter(p => matchRoute(p, hash) !== null);
  const handler = routes[pattern] || routes['/'];
  if (!handler) return;

  try {
    const cleanup = await handler(app, pattern ? matchRoute(pattern, hash) : {});
    if (id === routeId && typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    if (id === routeId) app.innerHTML = `<div class="error-msg">Error: ${escapeHtml(e.message)}</div>`;
    console.error(e);
  }

  if (id === routeId) window.scrollTo(0, 0);
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
