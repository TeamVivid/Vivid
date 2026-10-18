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

import { getTextFromObject } from './utils.js';

const VIDEO_RENDERERS = ['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer'];

export async function getTrending(client) {
  const result = {
    videos: [],
    continuationToken: '',
    error: '',
  };

  try {
    const data = await client.browseWeb('FEhype_leaderboard');
    const seen = new Set();

    const add = (video) => {
      if (!video?.videoId || seen.has(video.videoId)) return;
      seen.add(video.videoId);
      result.videos.push(video);
    };

    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (VIDEO_RENDERERS.includes(key) && value?.videoId) add(parseVideoRenderer(value));
        else if (key === 'lockupViewModel' && value?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') add(parseLockup(value));
        else walk(value);
      }
    };
    walk(data);
  } catch (e) {
    result.error = `[Hype] ${e.message}`;
  }

  return result;
}

function parseVideoRenderer(v) {
  const byline = v.ownerText || v.shortBylineText || v.longBylineText;
  const authorId = byline?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    || v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.navigationEndpoint?.browseEndpoint?.browseId
    || '';
  const authorUrl = byline?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
    || (authorId ? `/channel/${authorId}` : '');
  return {
    type: 'video',
    videoId: v.videoId,
    url: `/watch?v=${v.videoId}`,
    title: getTextFromObject(v.title),
    duration: getTextFromObject(v.lengthText),
    author: getTextFromObject(byline),
    authorId,
    authorUrl,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    views: getTextFromObject(v.shortViewCountText || v.viewCountText),
    publishDate: getTextFromObject(v.publishedTimeText),
  };
}

function parseLockup(l) {
  const meta = l.metadata?.lockupMetadataViewModel;
  const badges = (l.contentImage?.thumbnailViewModel?.overlays || [])
    .flatMap(o => o.thumbnailBottomOverlayViewModel?.badges || []);
  const avatarTap = meta?.image?.decoratedAvatarViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint;
  const authorId = avatarTap?.browseId || '';
  const authorUrl = avatarTap?.canonicalBaseUrl || (authorId ? `/channel/${authorId}` : '');
  return {
    type: 'video',
    videoId: l.contentId,
    url: `/watch?v=${l.contentId}`,
    title: meta?.title?.content || '',
    duration: badges.map(b => b.thumbnailBadgeViewModel?.text).find(Boolean) || '',
    author: meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || '',
    authorId,
    authorUrl,
    thumbnailUrl: `https://i.ytimg.com/vi/${l.contentId}/mqdefault.jpg`,
    views: '',
    publishDate: '',
  };
}

export default { getTrending };
