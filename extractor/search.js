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

import { getTextFromObject, findKey, normalizeThumbnailUrl, parseSuccinctVideo, parseSuccinctChannel, parseSuccinctPlaylist, convertUrlToMobile } from './utils.js';
import { buildSearchParams, WEB, MWEB, WEB_REMIX } from './constants.js';
import { parseShelfItem } from './channel.js';

function parseSearchItem(content) {
  if (content.videoRenderer) {
    return parseSuccinctVideo(content.videoRenderer);
  }
  if (content.channelRenderer) {
    return parseSuccinctChannel(content.channelRenderer);
  }
  if (content.playlistRenderer) {
    return parseSuccinctPlaylist(content.playlistRenderer);
  }
  if (content.compactVideoRenderer) {
    return parseSuccinctVideo(content.compactVideoRenderer);
  }
  if (content.videoWithContextRenderer) {
    return parseSuccinctVideo(content.videoWithContextRenderer);
  }
  if (content.compactChannelRenderer) {
    return parseSuccinctChannel(content.compactChannelRenderer);
  }
  if (content.compactRadioRenderer || content.compactPlaylistRenderer) {
    const renderer = content.compactRadioRenderer || content.compactPlaylistRenderer;
    return parseSuccinctPlaylist(renderer);
  }
  if (content.lockupViewModel) {
    const type = content.lockupViewModel.contentType;
    return type === 'LOCKUP_CONTENT_TYPE_VIDEO' || type === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ? parseShelfItem(content) : null;
  }
  const shelf = content.reelShelfRenderer || content.gridShelfViewModel;
  if (shelf) {
    const items = (shelf.items || shelf.contents || []).map(parseShelfItem).filter(Boolean);
    return items.length ? { type: 'shorts', title: 'Shorts', items } : null;
  }
  return null;
}

const SONG_PARAMS = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';

function parseSongs(data) {
  const shelf = findKey(data, 'musicShelfRenderer') || data?.continuationContents?.musicShelfContinuation || {};
  const items = shelf.contents || findKey(data, 'continuationItems') || [];
  const results = [];
  for (const { musicResponsiveListItemRenderer: r } of items) {
    const videoId = r?.playlistItemData?.videoId;
    if (!videoId) continue;
    const runs = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).filter(x => x.text !== ' • ');
    const artist = runs.find(x => x.navigationEndpoint?.browseEndpoint) || runs[0];
    const authorId = artist?.navigationEndpoint?.browseEndpoint?.browseId || '';
    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    results.push({
      type: 'video',
      videoId,
      url: `/watch?v=${videoId}`,
      title: r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '',
      duration: runs.map(x => x.text).find(t => /^\d+(:\d+)+$/.test(t)) || '',
      publishDate: '',
      views: '',
      author: artist?.text || '',
      authorId: authorId.startsWith('UC') ? authorId : '',
      authorUrl: authorId.startsWith('UC') ? `/channel/${authorId}` : '',
      verified: false,
      thumbnailUrl: normalizeThumbnailUrl((thumbs[thumbs.length - 1]?.url || '').replace(/=w\d+-h\d+[^=]*$/, '=w544-h544-l90-rj')),
    });
  }
  const token = shelf.continuations?.[0]?.nextContinuationData?.continuation
    || items.find(i => i.continuationItemRenderer)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
    || '';
  return { results, token };
}

export async function search(client, query, filters = {}) {
  if (filters.type === 'shorts') {
    query = `${query} #shorts`;
    filters = { ...filters, type: 'video', duration: 'short' };
  }
  const isSong = filters.type === 'song';
  if (isSong) filters = { ...filters, type: 'video' };
  if (isSong) {
    const music = parseSongs(await client.search(query, SONG_PARAMS, null, WEB_REMIX).catch(() => null));
    if (music.results.length) {
      return { query, estimatedResults: 'unknown', results: music.results, continuationToken: music.token, filters };
    }
  }
  if (filters.sortBy === 'date' && !filters.type && !filters.uploadDate && !filters.duration && !filters.features) {
    const base = await client.search(query, null, null, WEB);
    const chip = (findKey(base, 'chipCloudRenderer')?.chips || [])
      .map(c => c.chipCloudChipRenderer)
      .find(c => /recently uploaded/i.test(getTextFromObject(c?.text)));
    const token = chip?.navigationEndpoint?.continuationCommand?.token;
    if (token) {
      const recent = await searchContinuation(client, token, false, true);
      if (recent.results.length) {
        return { ...recent, query, estimatedResults: base.estimatedResults || 'unknown', filters };
      }
    }
  }
  const params = buildSearchParams(filters);
  const findContents = (d) => d?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
    || d?.contents?.sectionListRenderer?.contents
    || findKey(d?.contents, 'sectionListRenderer')?.contents;
  const data = await client.search(query, params, null, WEB);
  const contents = findContents(data);

  const result = {
    query,
    estimatedResults: data.estimatedResults || 'unknown',
    results: [],
    continuationToken: '',
    filters: filters,
  };

  if (!contents) {
    return { ...result, error: 'Unexpected result structure' };
  }

  for (const section of contents) {
    if (section.itemSectionRenderer) {
      for (const item of section.itemSectionRenderer.contents || []) {
        if (item.didYouMeanRenderer || item.horizontalCardListRenderer) continue;

        const parsed = parseSearchItem(item);
        if (parsed) {
          result.results.push(parsed);
        }
      }
    }
    if (section.continuationItemRenderer) {
      result.continuationToken =
        section.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
    }
  }

  return result;
}

export async function searchContinuation(client, continuationToken, isSong = false, mweb = false) {
  if (isSong) {
    const music = parseSongs(await client.searchContinuation(continuationToken, WEB_REMIX).catch(() => null));
    if (music.results.length) {
      return { estimatedResults: 'unknown', results: music.results, continuationToken: music.token };
    }
  }
  const data = await client.searchContinuation(continuationToken, mweb ? MWEB : WEB);

  const result = {
    estimatedResults: data.estimatedResults || 'unknown',
    results: [],
    continuationToken: '',
  };

  for (const cmd of data.onResponseReceivedCommands || []) {
    for (const item of (cmd.appendContinuationItemsAction || cmd.reloadContinuationItemsCommand)?.continuationItems || []) {
      if (item.itemSectionRenderer) {
        for (const content of item.itemSectionRenderer.contents || []) {
          const parsed = parseSearchItem(content);
          if (parsed) {
            result.results.push(parsed);
          }
        }
      }
      if (item.continuationItemRenderer) {
        result.continuationToken =
          item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
      }
    }
  }

  return result;
}

export default { search, searchContinuation };
