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

import { getTextFromObject, getThumbnailUrlExact, getThumbnailUrlClosest } from './utils.js';

function parseComment(commentRenderer, thumbnailHeight = 88) {
  return {
    id: commentRenderer.commentId || '',
    content: getTextFromObject(commentRenderer.contentText),
    authorName: getTextFromObject(commentRenderer.authorText),
    authorId: commentRenderer?.authorEndpoint?.browseEndpoint?.browseId || '',
    authorIconUrl: getThumbnailUrlExact(commentRenderer?.authorThumbnail?.thumbnails, thumbnailHeight),
    publishDate: getTextFromObject(commentRenderer.publishedTimeText),
    upvotes: getTextFromObject(commentRenderer.voteCount),
    replyCount: commentRenderer.replyCount || 0,
    authorIsChannelOwner: commentRenderer.authorIsChannelOwner || false,
    isPinned: !!commentRenderer.pinnedCommentBadge,
    creatorHeart: !!(commentRenderer.actionButtons?.commentActionButtonsRenderer?.creatorHeart || commentRenderer.creatorHeart),
    creatorHeartIcon: getThumbnailUrlExact(
      (commentRenderer.actionButtons?.commentActionButtonsRenderer?.creatorHeart?.creatorHeartRenderer || 
       commentRenderer.creatorHeart?.creatorHeartRenderer)?.creatorThumbnail?.thumbnails, 
      48
    ),
    repliesContinuationToken: commentRenderer.replies?.commentRepliesRenderer?.contents?.[0]?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token 
                             || commentRenderer.replies?.commentRepliesRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '',
  };
}

function parseViewModelComment(vm, entities) {
  const e = entities[(vm.commentViewModel || vm).commentKey];
  if (!e) return null;
  return {
    id: e.properties?.commentId || '',
    content: e.properties?.content?.content || '',
    authorName: e.author?.displayName || '',
    authorId: e.author?.channelId || '',
    authorIconUrl: e.author?.avatarThumbnailUrl || '',
    publishDate: e.properties?.publishedTime || '',
    upvotes: e.toolbar?.likeCountNotliked || '',
    replyCount: Number(e.toolbar?.replyCount) || 0,
    authorIsChannelOwner: !!e.author?.isCreator,
    isPinned: false,
    creatorHeart: false,
    creatorHeartIcon: '',
    repliesContinuationToken: '',
  };
}

function indexEntities(data) {
  const entities = {};
  for (const m of data?.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
    if (m.payload?.commentEntityPayload) entities[m.entityKey] = m.payload.commentEntityPayload;
  }
  return entities;
}

export async function getComments(client, continuationToken, type = 1, useWeb = false) {
  const result = {
    comments: [],
    continuationToken: '',
    type: -1,
    error: '',
  };

  try {
    if (type === 0) {
      const data = await client.getCommentsLegacy(continuationToken);
      result.type = -1;

      for (const item of Array.isArray(data) ? data : []) {
        const section = item?.response?.continuationContents?.commentSectionContinuation;
        if (!section) continue;

        for (const comment of section.items || []) {
          if (comment.commentThreadRenderer) {
            const parsed = parseCommentThread(comment);
            result.comments.push(parsed);
          }
        }

        for (const cont of section.continuations || []) {
          if (cont.nextContinuationData) {
            result.continuationToken = cont.nextContinuationData.continuation;
            result.type = 0;
          }
        }
      }
    } else {
      const data = useWeb ? await client.browseWeb(null, null, continuationToken) : await client.nextContinuation(continuationToken);
      const entities = indexEntities(data);
      result.type = -1;

      const actions = data.onResponseReceivedEndpoints || data.onResponseReceivedActions || [];

      for (const endpoint of actions) {
        const items = endpoint?.reloadContinuationItemsCommand?.continuationItems
          || endpoint?.appendContinuationItemsAction?.continuationItems || [];

        for (const item of items) {
          if (item.commentThreadRenderer) {
            const parsed = parseCommentThread(item, entities);
            if (parsed) result.comments.push(parsed);
          }
          if (item.continuationItemRenderer) {
            result.continuationToken =
              item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
            result.type = 1;
            if (result.continuationToken) break;
          }
        }
        if (result.continuationToken) break;
      }
    }
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

function parseCommentThread(commentThreadRenderer, entities = {}) {
  const ctr = commentThreadRenderer.commentThreadRenderer || commentThreadRenderer;
  const comment = ctr.commentViewModel
    ? parseViewModelComment(ctr.commentViewModel, entities)
    : parseComment(ctr?.comment?.commentRenderer || {});
  if (!comment) return null;

  const replyContents = ctr?.replies?.commentRepliesRenderer?.contents || [];
  for (const r of replyContents) {
    if (r.continuationItemRenderer) {
      const cont = r.continuationItemRenderer;
      comment.repliesContinuationToken =
        cont.button?.buttonRenderer?.command?.continuationCommand?.token ||
        cont.continuationEndpoint?.continuationCommand?.token || '';
      if (comment.repliesContinuationToken) break;
    }
  }

  return comment;
}

export async function getCommentReplies(client, continuationToken, useWeb = false) {
  const result = {
    replies: [],
    continuationToken: '',
    error: '',
  };

  try {
    const data = useWeb ? await client.browseWeb(null, null, continuationToken) : await client.nextContinuation(continuationToken);
    const entities = indexEntities(data);

    const actions = data.onResponseReceivedEndpoints || data.onResponseReceivedActions || [];
    for (const endpoint of actions) {
      const items = endpoint?.appendContinuationItemsAction?.continuationItems
        || endpoint?.reloadContinuationItemsCommand?.continuationItems || [];
      
      if (items.length > 0) {
        for (const item of items) {
          if (item.commentRenderer) {
            result.replies.push(parseComment(item.commentRenderer, 32));
          } else if (item.commentViewModel) {
            const parsed = parseViewModelComment(item.commentViewModel, entities);
            if (parsed) result.replies.push(parsed);
          }
          if (item.continuationItemRenderer) {
            const cont = item.continuationItemRenderer;
            const token = cont.button?.buttonRenderer?.command?.continuationCommand?.token ||
                          cont.continuationEndpoint?.continuationCommand?.token || '';
            result.continuationToken = token;
            if (token) break;
          }
        }
      }
      if (result.continuationToken) break;
    }
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

export default { getComments, getCommentReplies };
