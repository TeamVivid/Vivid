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

import { getTextFromObject, getThumbnailUrlExact } from './utils.js';

function toParts(obj) {
  const parts = [];
  for (const run of obj?.runs || []) {
    if (run.emoji) {
      const id = run.emoji.emojiId || '';
      const url = run.emoji.image?.thumbnails?.[0]?.url;
      if (id && !id.includes('/') && id.length <= 8) parts.push({ text: id });
      else if (url) parts.push({ emoji: url, label: run.emoji.shortcuts?.[0] || '' });
    } else if (run.text) {
      parts.push({ text: run.text });
    }
  }
  if (!parts.length && obj?.simpleText) parts.push({ text: obj.simpleText });
  return parts;
}

function toColor(argb) {
  return argb == null ? '' : `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`;
}

function parseMessage(item, offsetMs) {
  const kinds = {
    liveChatTextMessageRenderer: 'text',
    liveChatPaidMessageRenderer: 'paid',
    liveChatPaidStickerRenderer: 'sticker',
    liveChatMembershipItemRenderer: 'member',
  };
  const key = Object.keys(kinds).find(k => item[k]);
  if (!key) return null;
  const r = item[key];

  const badges = (r.authorBadges || []).map(b => b.liveChatAuthorBadgeRenderer).filter(Boolean);
  const msg = {
    id: r.id,
    type: kinds[key],
    authorName: getTextFromObject(r.authorName),
    authorIcon: getThumbnailUrlExact(r.authorPhoto?.thumbnails, 32),
    authorId: r.authorExternalChannelId || '',
    parts: toParts(r.message),
    timestamp: r.timestampText ? getTextFromObject(r.timestampText) : '',
    offsetMs,
    isOwner: badges.some(b => b.icon?.iconType === 'OWNER'),
    isModerator: badges.some(b => b.icon?.iconType === 'MODERATOR'),
    isMember: badges.some(b => b.customThumbnail),
  };

  if (msg.type === 'paid' || msg.type === 'sticker') {
    msg.amount = getTextFromObject(r.purchaseAmountText);
    msg.bodyColor = toColor(r.bodyBackgroundColor ?? r.backgroundColor);
    msg.headerColor = toColor(r.headerBackgroundColor ?? r.moneyChipBackgroundColor);
    if (msg.type === 'sticker') msg.sticker = r.sticker?.thumbnails?.slice(-1)[0]?.url || '';
  } else if (msg.type === 'member') {
    msg.headerText = getTextFromObject(r.headerPrimaryText) || getTextFromObject(r.headerSubtext);
  }
  return msg;
}

export async function getLiveChat(client, continuationToken, { replay = false, offsetMs = 0 } = {}) {
  const result = {
    messages: [],
    removed: [],
    continuationToken: '',
    timeoutMs: 0,
    error: '',
  };

  try {
    const data = await client.liveChat(continuationToken, { replay, offsetMs });

    const chat = data?.continuationContents?.liveChatContinuation;
    if (!chat) {
      result.error = 'No chat data available';
      return result;
    }

    const handle = (action, offset) => {
      const item = action.addChatItemAction?.item;
      if (item) {
        const msg = parseMessage(item, offset);
        if (msg) result.messages.push(msg);
      }
      const removed = action.removeChatItemAction?.targetItemId || action.markChatItemAsDeletedAction?.targetItemId;
      if (removed) result.removed.push(removed);
    };

    for (const action of chat.actions || []) {
      if (action.replayChatItemAction) {
        const offset = Number(action.replayChatItemAction.videoOffsetTimeMsec) || 0;
        for (const inner of action.replayChatItemAction.actions || []) handle(inner, offset);
      } else {
        handle(action, 0);
      }
    }

    for (const cont of chat.continuations || []) {
      const c = cont.timedContinuationData || cont.invalidationContinuationData
        || cont.liveChatReplayContinuationData || cont.playerSeekContinuationData;
      if (!c?.continuation) continue;
      result.continuationToken = c.continuation;
      result.timeoutMs = c.timeoutMs || c.timeUntilLastMessageMsec || 0;
    }
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

export default { getLiveChat };
