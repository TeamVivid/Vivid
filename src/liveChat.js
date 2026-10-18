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


import { getLiveChat, getLiveChatModes, proxyImageUrl } from './api.js';

const MAX_MESSAGES = 300;
const REPLAY_MIN_INTERVAL_MS = 1500;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderMessage(m) {
  const row = el('div', `chat-msg chat-${m.type}`);
  row.dataset.id = m.id;

  if (m.type === 'paid' || m.type === 'sticker') {
    if (m.bodyColor) row.style.setProperty('--chat-body', m.bodyColor);
    if (m.headerColor) row.style.setProperty('--chat-header', m.headerColor);
  }

  const icon = el('img', 'chat-avatar');
  icon.src = proxyImageUrl(m.authorIcon);
  icon.loading = 'lazy';
  row.appendChild(icon);

  const body = el('div', 'chat-body');
  const head = el('div', 'chat-head');
  const name = el('span', `chat-author${m.isOwner ? ' is-owner' : ''}${m.isModerator ? ' is-mod' : ''}${m.isMember ? ' is-member' : ''}`, m.authorName);
  head.appendChild(name);
  if (m.amount) head.appendChild(el('span', 'chat-amount', m.amount));
  if (m.timestamp) head.appendChild(el('span', 'chat-time', m.timestamp));
  body.appendChild(head);

  if (m.headerText) body.appendChild(el('div', 'chat-note', m.headerText));
  if (m.sticker) {
    const sticker = el('img', 'chat-sticker');
    sticker.src = proxyImageUrl(m.sticker);
    body.appendChild(sticker);
  }

  if (m.parts.length) {
    const text = el('div', 'chat-text');
    for (const part of m.parts) {
      if (part.emoji) {
        const img = el('img', 'chat-emoji');
        img.src = proxyImageUrl(part.emoji);
        img.alt = part.label || '';
        text.appendChild(img);
      } else {
        text.appendChild(document.createTextNode(part.text));
      }
    }
    body.appendChild(text);
  }

  row.appendChild(body);
  return row;
}

export function startLiveChat({ videoId, chat, player, listEl, modeEl, statusEl }) {
  let stopped = false;
  let pollTimer = null;
  let replayTimer = null;
  let generation = 0;
  let token = chat.token;
  let seen = new Set();
  let queue = [];
  let done = false;
  let fetching = false;
  let nextFetchAt = 0;
  let lastCt = -1;
  let failures = 0;
  let refreshed = false;

  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  const append = (messages) => {
    const stick = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 60;
    const placeholder = listEl.querySelector('.chat-empty');
    if (placeholder && messages.length) placeholder.remove();
    for (const m of messages) {
      if (!m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      listEl.appendChild(renderMessage(m));
    }
    while (listEl.children.length > MAX_MESSAGES) listEl.firstElementChild.remove();
    if (stick) listEl.scrollTop = listEl.scrollHeight;
  };

  const removeMessages = (ids) => {
    for (const id of ids) {
      const row = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (row) row.remove();
    }
  };

  const reset = (newToken) => {
    generation++;
    clearTimeout(pollTimer);
    token = newToken;
    seen = new Set();
    queue = [];
    done = false;
    fetching = false;
    nextFetchAt = 0;
    lastCt = -1;
    failures = 0;
    refreshed = false;
    listEl.replaceChildren(el('div', 'chat-empty', chat.isReplay ? 'Loading replay...' : 'Waiting for messages...'));
  };

  async function pollLive() {
    if (stopped) return;
    const gen = generation;
    let delay = 10000;
    try {
      const data = await getLiveChat(videoId, token);
      if (gen !== generation || stopped) return;
      append(data.messages || []);
      removeMessages(data.removed || []);
      if (!data.continuationToken) {
        if (data.error && !refreshed) {
          refreshed = true;
          const fresh = await getLiveChatModes(videoId).catch(() => null);
          if (gen !== generation || stopped) return;
          const mode = fresh?.modes?.[modeEl ? modeEl.selectedIndex : -1];
          if (mode?.continuation || fresh?.token) {
            token = mode?.continuation || fresh.token;
            pollTimer = setTimeout(pollLive, 500);
            return;
          }
        }
        if (!data.error || ++failures > 6) {
          setStatus(data.error ? `Chat unavailable: ${data.error}` : 'Chat ended');
          return;
        }
        delay = 4000;
      } else {
        failures = 0;
        token = data.continuationToken;
        delay = Math.min(Math.max(data.timeoutMs || 3000, 1000), 4000);
      }
    } catch {}
    pollTimer = setTimeout(pollLive, delay);
  }

  async function fetchReplay(ct) {
    fetching = true;
    const gen = generation;
    try {
      const data = await getLiveChat(videoId, token, { replay: true, offsetMs: ct });
      if (gen !== generation || stopped) return;
      for (const m of data.messages || []) if (!seen.has(m.id)) queue.push(m);
      queue.sort((a, b) => a.offsetMs - b.offsetMs);
      removeMessages(data.removed || []);
      if (data.continuationToken) token = data.continuationToken;
      else done = true;
    } catch {
    } finally {
      if (gen === generation) {
        fetching = false;
        nextFetchAt = Date.now() + REPLAY_MIN_INTERVAL_MS;
      }
    }
  }

  function tickReplay() {
    if (stopped || !player) return;
    const ct = (player.currentTime() || 0) * 1000;
    if (lastCt >= 0 && (ct < lastCt - 1500 || ct > lastCt + 5000)) reset(activeToken);
    lastCt = ct;

    const due = [];
    while (queue.length && queue[0].offsetMs <= ct) due.push(queue.shift());
    if (due.length) append(due);

    const buffered = queue.length ? queue[queue.length - 1].offsetMs : -1;
    if (!fetching && !done && Date.now() >= nextFetchAt && buffered < ct + 8000) fetchReplay(ct);
  }

  let activeToken = chat.token;

  function start(newToken) {
    activeToken = newToken;
    reset(newToken);
    if (chat.isReplay) {
      setStatus('Replay');
      replayTimer = setInterval(tickReplay, 400);
    } else {
      setStatus('');
      pollLive();
    }
  }

  const stopTimers = () => {
    clearTimeout(pollTimer);
    clearInterval(replayTimer);
  };

  if (modeEl) {
    modeEl.addEventListener('change', async () => {
      stopTimers();
      const index = modeEl.selectedIndex;
      const fresh = await getLiveChatModes(videoId).catch(() => null);
      if (stopped) return;
      start(fresh?.modes?.[index]?.continuation || modeEl.value);
    });
  }

  start(chat.token);

  return () => {
    stopped = true;
    generation++;
    stopTimers();
  };
}
