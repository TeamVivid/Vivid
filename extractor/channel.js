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

import { getTextFromObject, parseSuccinctVideo, parseSuccinctPlaylist, getThumbnailUrlClosest,
  getThumbnailUrlExact, convertUrlToMobile, convertUrlToDesktop, convertWebpThumbnailToJpg,
  getVideoThumbnailUrl, getVideoIdFromThumbnailUrl, parseQueryParams, extractInitialData } from './utils.js';
  function getContinuationToken(endpoint) {
    if (!endpoint) return '';
    if (endpoint?.continuationCommand?.token) {
      return endpoint.continuationCommand.token;
    }
    if (endpoint?.navigationEndpoint?.continuationCommand?.token) {
      return endpoint.navigationEndpoint.continuationCommand.token;
    }
    return '';
  }
  function parseChannelData(data) {
    const result = {
      id: '',
      name: '',
      handle: '',
      url: '',
      iconUrl: '',
      bannerUrl: '',
      description: '',
      subscriberCount: '',
      videos: [],
      streams: [],
      shorts: [],
      videosContinuationToken: '',
      streamsContinuationToken: '',
      shortsContinuationToken: '',
      videoSortTokens: { newest: '', popular: '', oldest: '' },
      streamsSortTokens: { newest: '', popular: '', oldest: '' },
      shortsSortTokens: { newest: '', popular: '', oldest: '' },
      playlistTabBrowseId: '',
      playlistTabParams: '',
      playlists: [],
      error: '',
    };

    const metadata = data?.metadata?.channelMetadataRenderer;
    if (metadata) {
      result.name = metadata.title || '';
      result.id = metadata.externalId || '';
      result.url = `/channel/${result.id}`;
      result.description = metadata.description || '';

      const vanityUrl = metadata.vanityChannelUrl || '';
      const atPos = vanityUrl.indexOf('@');
      if (atPos !== -1) {
        result.handle = decodeURIComponent(vanityUrl.substring(atPos));
      }
    }

    const c4Header = data?.header?.c4TabbedHeaderRenderer;
    if (c4Header) {
      result.subscriberCount = getTextFromObject(c4Header.subscriberCountText);
      const bannerThumbs = c4Header?.banner?.thumbnails || [];
      result.bannerUrl = bannerThumbs.length
      ? (bannerThumbs[bannerThumbs.length - 1].url || '')
      : '';
      result.iconUrl = getThumbnailUrlClosest(c4Header?.avatar?.thumbnails, 88);
    } else {
      const pageHeader = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
      if (pageHeader) {
        const bannerSources = pageHeader?.banner?.imageBannerViewModel?.image?.sources || [];
        result.bannerUrl = bannerSources.length
        ? (bannerSources[bannerSources.length - 1].url || '')
        : '';
        result.iconUrl = getThumbnailUrlClosest(
          pageHeader?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources, 88
        );
        const rows = pageHeader?.metadata?.contentMetadataViewModel?.metadataRows || [];
        if (rows.length > 1) {
          const parts = rows[1]?.metadataParts || [];
          if (parts.length >= 1) {
            result.subscriberCount = parts[0]?.text?.content || '';
          }
        }
      }
    }

    const tabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const tabRenderer = tab.tabRenderer;
      if (!tabRenderer) continue;

      const tabUrl = tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
      const isVideosTab = tabUrl.endsWith('/videos');
      const isStreamsTab = tabUrl.endsWith('/streams');
      const isShortsTab = tabUrl.endsWith('/shorts');
      const isPlaylistsTab = tabUrl.endsWith('/playlists');

      if (isPlaylistsTab) {
        result.playlistTabBrowseId = tabRenderer?.endpoint?.browseEndpoint?.browseId || '';
        result.playlistTabParams = tabRenderer?.endpoint?.browseEndpoint?.params || '';
      }

      const richGrid = tabRenderer?.content?.richGridRenderer;
      if (!richGrid) continue;

      const legacyChips = richGrid?.header?.feedFilterChipBarRenderer?.contents || [];
      const modernChips = richGrid?.header?.chipBarViewModel?.chips || [];

      let tokens = [];
      if (legacyChips.length >= 3) {
        tokens = legacyChips.map(c =>
        getContinuationToken(c?.chipCloudChipRenderer?.navigationEndpoint)
        );
      } else if (modernChips.length >= 3) {
        tokens = modernChips.map(c =>
        getContinuationToken(c?.chipViewModel?.tapCommand?.innertubeCommand)
        );
      }

      if (tokens.length >= 3) {
        if (isVideosTab) {
          result.videoSortTokens = { newest: tokens[0], popular: tokens[1], oldest: tokens[2] };
        } else if (isStreamsTab) {
          result.streamsSortTokens = { newest: tokens[0], popular: tokens[1], oldest: tokens[2] };
        } else if (isShortsTab) {
          result.shortsSortTokens = { newest: tokens[0], popular: tokens[1], oldest: tokens[2] };
        }
      }

      for (const item of richGrid.contents || []) {
        if (item.continuationItemRenderer) {
          const token = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
          if (isStreamsTab) result.streamsContinuationToken = token;
          else if (isVideosTab) result.videosContinuationToken = token;
          else if (isShortsTab) result.shortsContinuationToken = token;
          continue;
        }

        const richContent = item?.richItemRenderer?.content;
        if (!richContent) continue;

        const videoRenderer = richContent.compactVideoRenderer || richContent.videoWithContextRenderer || richContent.videoRenderer;
        if (videoRenderer) {
          const video = parseSuccinctVideo(videoRenderer);
          if (isStreamsTab) result.streams.push(video);
          else if (isShortsTab) result.shorts.push(video);
          else if (isVideosTab) result.videos.push(video);
          continue;
        }

        if (richContent.shortsLockupViewModel && isShortsTab) {
          const shortsData = richContent.shortsLockupViewModel;
          const short = parseShortVideo(shortsData, result.name);
          if (short) result.shorts.push(short);
        }
      }
    }

    return result;
  }

  function parseShortVideo(shortsData, channelName) {
    let videoId = '';
    if (shortsData?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId) {
      videoId = shortsData.onTap.innertubeCommand.reelWatchEndpoint.videoId;
    }
    if (!videoId && shortsData?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url) {
      const url = shortsData.onTap.innertubeCommand.commandMetadata.webCommandMetadata.url;
      const match = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (match) videoId = match[1];
    }
    if (!videoId && shortsData?.entityId) {
      const match = shortsData.entityId.match(/([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
    }
    if (!videoId && shortsData?.inlinePlayerData?.playbackEndpoint?.reelWatchEndpoint?.videoId) {
      videoId = shortsData.inlinePlayerData.playbackEndpoint.reelWatchEndpoint.videoId;
    }

    const overlay = shortsData.overlayMetadata || {};
    let title = overlay?.primaryText?.content || '';
    if (!title && shortsData.accessibilityText) {
      title = shortsData.accessibilityText
        .replace(/\s*-\s*play\s*short.*$/i, '')
        .replace(/,\s*[\d.,]+\s*(?:views|Aufrufe|vues|visualizaciones|thousand|million|billion|K|M|B).*$/i, '')
        .trim();
    }
    if (!title && shortsData.headline?.content) {
      title = shortsData.headline.content;
    }
    if (!title && shortsData.accessibility?.accessibilityData?.label) {
      title = shortsData.accessibility.accessibilityData.label
        .replace(/\s*-\s*play\s*short.*$/i, '')
        .replace(/,\s*[\d.,]+\s*(?:views|Aufrufe|vues|visualizaciones|thousand|million|billion|K|M|B).*$/i, '')
        .trim();
    }

    let views = overlay?.secondaryText?.content || '';
    if (!views && shortsData.accessibilityText) {
      const m = shortsData.accessibilityText.match(/([\d.,]+\s*(?:thousand|million|billion|K|M|B)?\s*views)/i);
      if (m) views = m[1];
    }

    let thumbnailUrl = '';
    const sources = shortsData?.thumbnail?.sources || [];
    if (sources.length > 0) {
      let originalUrl = sources[sources.length - 1].url || sources[0].url || '';
      originalUrl = convertWebpThumbnailToJpg(originalUrl);
      const id = getVideoIdFromThumbnailUrl(originalUrl);
      thumbnailUrl = id ? getVideoThumbnailUrl(id) : originalUrl;
    }
    if (!thumbnailUrl && videoId) {
      thumbnailUrl = getVideoThumbnailUrl(videoId);
    }

    return {
      type: 'video',
      videoId,
      url: videoId ? `/watch?v=${videoId}` : '',
      title: title || 'Short',
      views,
      duration: 'Short',
      author: channelName,
      thumbnailUrl,
      isShort: true,
    };
  }

  async function resolveChannelId(client, input) {
    if (/^UC[\w-]{22}$/.test(input)) return input;
    const urlPath = input.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?/, '/');
    const data = await client.resolveUrl(`https://www.youtube.com${urlPath}`);
    const id = data?.endpoint?.browseEndpoint?.browseId;
    if (!id) throw new Error('Could not resolve channel: ' + input);
    return id;
  }

  export async function getChannel(client, urlOrId) {
    try {
      const id = await resolveChannelId(client, urlOrId);
      return parseChannelData(await client.browse(id, 'EgZ2aWRlb3PyBgQKAjoA'));
    } catch (e) {
      return { error: e.message };
    }
  }

  export async function getChannelStreams(client, urlOrId) {
    try {
      const id = await resolveChannelId(client, urlOrId);
      return parseChannelData(await client.browse(id, 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D'));
    } catch (e) {
      return { error: e.message };
    }
  }

  export async function getChannelShorts(client, urlOrId) {
    try {
      const id = await resolveChannelId(client, urlOrId);
      return parseChannelData(await client.browse(id, 'EgZzaG9ydHPyBgUKA5oBAA%3D%3D'));
    } catch (e) {
      return { error: e.message };
    }
  }

  export async function loadMoreChannelItems(client, continuationToken) {
    try {
      const data = await client.browse(null, null, continuationToken);
      const result = { items: [], continuationToken: '' };

      for (const action of data.onResponseReceivedActions || []) {
        const items = action?.appendContinuationItemsAction?.continuationItems
        || action?.reloadContinuationItemsCommand?.continuationItems || [];

        for (const item of items) {
          const content = item?.richItemRenderer?.content;
          if (content) {
            const renderer = content.videoWithContextRenderer || content.compactVideoRenderer || content.videoRenderer;
            if (renderer) {
              result.items.push(parseSuccinctVideo(renderer));
              continue;
            }
            if (content.shortsLockupViewModel) {
              result.items.push(parseShortVideo(content.shortsLockupViewModel, ''));
            }
          }
          if (item.compactVideoRenderer) {
            result.items.push(parseSuccinctVideo(item.compactVideoRenderer));
          }
          if (item.continuationItemRenderer) {
            result.continuationToken =
            item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
          }
        }
      }

      return result;
    } catch (e) {
      return { items: [], continuationToken: '', error: e.message };
    }
  }

  function parseChannelPlaylistItem(item) {
    if (!item) return null;
    if (item.compactPlaylistRenderer) return parseSuccinctPlaylist(item.compactPlaylistRenderer);
    if (item.playlistRenderer) return parseSuccinctPlaylist(item.playlistRenderer);
    if (item.lockupViewModel) {
      const lm = item.lockupViewModel;
      const title = lm.metadata?.lockupMetadataViewModel?.title?.content || '';
      const id = (lm.contentId || '').replace(/^VL/, '');
      const badge = lm.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text || '';
      const sources = lm.contentImage?.thumbnailViewModel?.image?.sources || [];
      const thumb = sources.length ? (sources[sources.length - 1].url || '') : '';
      let url = lm.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || '';
      if (!url && id) url = `/playlist?list=${id}`;
      return {
        type: 'playlist',
        id,
        url,
        title,
        videoCount: badge,
        thumbnailUrl: thumb,
      };
    }
    return null;
  }

  export async function loadChannelPlaylists(client, browseId, params) {
    try {
      const p = params || 'EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA';
      const data = await client.browse(browseId, p);
      const playlists = [];

      const tabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs || data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      for (const tab of tabs) {
        const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        for (const section of sections) {
          if (section.shelfRenderer) {
            const categoryName = getTextFromObject(section.shelfRenderer.title) || 'Playlists';
            const categoryPlaylists = [];
            const shelfItems = section.shelfRenderer?.content?.verticalListRenderer?.items ||
                               section.shelfRenderer?.content?.gridRenderer?.items ||
                               section.shelfRenderer?.content?.horizontalListRenderer?.items || [];
            for (const item of shelfItems) {
              const parsed = parseChannelPlaylistItem(item);
              if (parsed) categoryPlaylists.push(parsed);
            }
            if (categoryPlaylists.length) playlists.push({ category: categoryName, items: categoryPlaylists });
          }
          if (section.itemSectionRenderer) {
            const items = [];
            for (const item of section.itemSectionRenderer.contents || []) {
              const parsed = parseChannelPlaylistItem(item);
              if (parsed) items.push(parsed);
            }
            if (items.length) playlists.push({ category: 'Playlists', items });
          }
        }

        const richItems = tab?.tabRenderer?.content?.richGridRenderer?.contents || [];
        if (richItems.length) {
          const items = [];
          for (const item of richItems) {
            const content = item?.richItemRenderer?.content;
            const parsed = parseChannelPlaylistItem(content || item);
            if (parsed) items.push(parsed);
          }
          if (items.length) playlists.push({ category: 'Playlists', items });
        }
      }

      return { playlists };
    } catch (e) {
      return { playlists: [], error: e.message };
    }
  }

  export async function loadCommunityPosts(client, channelUrl, continuationToken = null) {
    try {
      if (continuationToken) {
        const data = await client.browseWeb(null, null, continuationToken);
        return parseCommunityResponse(data, true);
      }

      const desktopUrl = convertUrlToDesktop(channelUrl) + '/community';
      const url = desktopUrl.replace('/community', '/posts');
      const html = await client.getDesktopPage(url);
      if (!html) return { error: 'Empty response' };

      const initialData = extractInitialData(html);
      if (!initialData) return { error: 'Could not extract ytInitialData' };

      const tabs = initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      for (const tab of tabs) {
        const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        for (const section of sections) {
          if (section.itemSectionRenderer?.contents) {
            return parseCommunityItems(section.itemSectionRenderer.contents);
          }
        }
      }

      return { posts: [], continuationToken: '' };
    } catch (e) {
      return { posts: [], continuationToken: '', error: e.message };
    }
  }

  function parseCommunityResponse(data, isContinuation) {
    for (const cmd of data.onResponseReceivedEndpoints || []) {
      if (cmd.appendContinuationItemsAction?.continuationItems) {
        return parseCommunityItems(cmd.appendContinuationItemsAction.continuationItems);
      }
    }
    return { posts: [], continuationToken: '' };
  }

  function parseCommunityItems(contents) {
    const result = { posts: [], continuationToken: '' };

    for (const post of contents) {
      if (post.backstagePostThreadRenderer?.post?.backstagePostRenderer) {
        const renderer = post.backstagePostThreadRenderer.post.backstagePostRenderer;
        const communityPost = {
          message: getTextFromObject(renderer.contentText),
          authorName: getTextFromObject(renderer.authorText),
          authorIconUrl: getThumbnailUrlClosest(renderer?.authorThumbnail?.thumbnails, 70),
          time: getTextFromObject(renderer.publishedTimeText),
          upvotes: getTextFromObject(renderer.voteCount),
          imageUrl: '',
          video: null,
          poll: null,
        };

        const imgRenderer = renderer?.backstageAttachment?.backstageImageRenderer;
        if (imgRenderer?.image?.thumbnails?.length) {
          communityPost.imageUrl = imgRenderer.image.thumbnails[0].url;
        }

        if (renderer?.backstageAttachment?.videoRenderer) {
          communityPost.video = parseSuccinctVideo(renderer.backstageAttachment.videoRenderer);
        }

        if (renderer?.backstageAttachment?.pollRenderer) {
          const poll = renderer.backstageAttachment.pollRenderer;
          communityPost.poll = {
            totalVotes: getTextFromObject(poll.totalVotes),
            choices: (poll.choices || []).map(c => getTextFromObject(c.text)),
          };
        }

        result.posts.push(communityPost);
      }
      if (post.continuationItemRenderer) {
        result.continuationToken =
        post.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
      }
    }

    return result;
  }

  export default {
    getChannel, getChannelStreams, getChannelShorts,
    loadMoreChannelItems, loadChannelPlaylists, loadCommunityPosts
  };
