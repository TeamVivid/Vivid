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

import { getTextFromObject, parseSuccinctVideo, parseSuccinctChannel, parseSuccinctPlaylist, convertUrlToMobile } from './utils.js';
import { buildSearchParams } from './constants.js';
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
  const shelf = content.reelShelfRenderer || content.gridShelfViewModel;
  if (shelf) {
    const items = (shelf.items || shelf.contents || []).map(parseShelfItem).filter(Boolean);
    return items.length ? { type: 'shorts', title: 'Shorts', items } : null;
  }
  return null;
}

export async function search(client, query, filters = {}) {
  if (filters.type === 'shorts') {
    query = `${query} #shorts`;
    filters = { ...filters, type: 'video', duration: 'short' };
  }
  const params = buildSearchParams(filters);
  const data = await client.search(query, params);

  const result = {
    query,
    estimatedResults: data.estimatedResults || 'unknown',
    results: [],
    continuationToken: '',
    filters: filters,
  };

  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
    || data?.contents?.sectionListRenderer?.contents;
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

export async function searchContinuation(client, continuationToken) {
  const data = await client.searchContinuation(continuationToken);

  const result = {
    estimatedResults: data.estimatedResults || 'unknown',
    results: [],
    continuationToken: '',
  };

  for (const cmd of data.onResponseReceivedCommands || []) {
    for (const item of cmd?.appendContinuationItemsAction?.continuationItems || []) {
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
