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
  getVideoThumbnailUrl, getVideoIdFromThumbnailUrl, parseQueryParams, extractInitialData,
  parseSuccinctChannel, hasVerifiedBadge, findKey } from './utils.js';
import { getComments } from './comments.js';
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
      verified: false,
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
      homeTabParams: '',
      releasesTabParams: '',
      playlists: [],
      error: '',
    };

    const metadata = data?.metadata?.channelMetadataRenderer;
    const pageHeader = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
    const c4Header = data?.header?.c4TabbedHeaderRenderer;

    result.name = metadata?.title
      || pageHeader?.title?.dynamicTextViewModel?.text?.content
      || pageHeader?.pageTitle
      || data?.header?.pageHeaderRenderer?.pageTitle
      || getTextFromObject(c4Header?.title)
      || data?.microformat?.microformatDataRenderer?.title
      || '';

    if (metadata) {
      result.id = metadata.externalId || '';
      result.url = result.id ? `/channel/${result.id}` : '';
      result.description = metadata.description || '';

      const vanityUrl = metadata.vanityChannelUrl || '';
      const atPos = vanityUrl.indexOf('@');
      if (atPos !== -1) {
        result.handle = decodeURIComponent(vanityUrl.substring(atPos));
      }
    }

    result.verified = hasVerifiedBadge(data?.header);

    if (c4Header) {
      result.subscriberCount = getTextFromObject(c4Header.subscriberCountText);
      const bannerThumbs = c4Header?.banner?.thumbnails || [];
      result.bannerUrl = bannerThumbs.length
        ? (bannerThumbs[bannerThumbs.length - 1].url || '')
        : '';
      result.iconUrl = getThumbnailUrlClosest(c4Header?.avatar?.thumbnails, 176);
    } else if (pageHeader) {
      const bannerSources = pageHeader?.banner?.imageBannerViewModel?.image?.sources || [];
      result.bannerUrl = bannerSources.length
        ? (bannerSources[bannerSources.length - 1].url || '')
        : '';
      result.iconUrl = getThumbnailUrlClosest(
        pageHeader?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources, 176
      );
      const rows = pageHeader?.metadata?.contentMetadataViewModel?.metadataRows || [];
      if (rows.length > 1) {
        const parts = rows[1]?.metadataParts || [];
        if (parts.length >= 1) {
          result.subscriberCount = parts[0]?.text?.content || '';
        }
      }
      if (!result.handle && rows.length > 0) {
        const part0 = rows[0]?.metadataParts?.[0]?.text?.content || '';
        if (part0.startsWith('@')) result.handle = part0;
      }
    }

    const tabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
    for (const [tabIndex, tab] of tabs.entries()) {
      const tabRenderer = tab.tabRenderer;
      if (!tabRenderer) continue;

      const tabUrl = tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
      const tabParams = tabRenderer?.endpoint?.browseEndpoint?.params || '';
      if (tabUrl.endsWith('/releases')) result.releasesTabParams = tabParams;
      else if (tabIndex === 0 && !/\/(videos|streams|shorts|playlists|community|posts)$/.test(tabUrl)) result.homeTabParams = tabParams;
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
          const video = parseSuccinctVideo(videoRenderer, result.name);
          if (!video.author && result.name) video.author = result.name;
          if (isStreamsTab) result.streams.push(video);
          else if (isShortsTab) result.shorts.push(video);
          else if (isVideosTab) result.videos.push(video);
          continue;
        }

        if (richContent.shortsLockupViewModel && isShortsTab) {
          const shortsData = richContent.shortsLockupViewModel;
          const short = parseShortVideo(shortsData, result.name);
          if (short) {
            if (!short.author && result.name) short.author = result.name;
            result.shorts.push(short);
          }
        }
      }
    }

    for (const v of [...result.videos, ...result.streams, ...result.shorts]) {
      if (!v.author && result.name) v.author = result.name;
      if (!v.authorId && result.id) v.authorId = result.id;
      if (!v.authorUrl && (v.authorId || result.id)) v.authorUrl = `/channel/${v.authorId || result.id}`;
    }

    return result;
  }

  export function parseShortVideo(shortsData, channelName) {
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
      thumbnailUrl = originalUrl;
    }
    if (!thumbnailUrl && videoId) {
      thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
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

  export function parseShelfItem(node) {
    const featured = node.channelVideoPlayerRenderer;
    if (featured) {
      return {
        type: 'video',
        videoId: featured.videoId,
        url: `/watch?v=${featured.videoId}`,
        title: getTextFromObject(featured.title),
        description: getTextFromObject(featured.description),
        views: getTextFromObject(featured.viewCountText),
        publishDate: getTextFromObject(featured.publishedTimeText),
        thumbnailUrl: `https://i.ytimg.com/vi/${featured.videoId}/hqdefault.jpg`,
      };
    }
    const video = node.compactVideoRenderer || node.gridVideoRenderer || node.videoWithContextRenderer || node.videoRenderer;
    if (video) return video.videoId ? parseSuccinctVideo(video) : null;
    const playlist = node.compactPlaylistRenderer || node.gridPlaylistRenderer || node.playlistRenderer;
    if (playlist) return parseSuccinctPlaylist(playlist);
    const channel = node.compactChannelRenderer || node.gridChannelRenderer || node.channelRenderer;
    if (channel) return parseSuccinctChannel(channel);
    if (node.shortsLockupViewModel) return parseShortVideo(node.shortsLockupViewModel, '');
    if (node.reelItemRenderer) {
      const reel = node.reelItemRenderer;
      return {
        type: 'video',
        videoId: reel.videoId,
        url: `/watch?v=${reel.videoId}`,
        title: getTextFromObject(reel.headline) || 'Short',
        views: getTextFromObject(reel.viewCountText),
        duration: 'Short',
        thumbnailUrl: reel.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${reel.videoId}/hqdefault.jpg`,
        isShort: true,
      };
    }
    const lockup = node.lockupViewModel;
    if (!lockup) return null;
    if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return parseChannelPlaylistItem(node);
    const videoId = lockup.contentId || '';
    const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];
    const badges = (lockup.contentImage?.thumbnailViewModel?.overlays || []).flatMap(o => o.thumbnailBottomOverlayViewModel?.badges || []);
    const parts = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts || [];
    return {
      type: 'video',
      videoId,
      url: `/watch?v=${videoId}`,
      title: lockup.metadata?.lockupMetadataViewModel?.title?.content || '',
      duration: badges.map(b => b.thumbnailBadgeViewModel?.text).find(Boolean) || '',
      views: parts[0]?.text?.content || '',
      publishDate: parts[1]?.text?.content || '',
      thumbnailUrl: sources.length ? sources[sources.length - 1].url : getVideoThumbnailUrl(videoId),
    };
  }

  function collectChannelItems(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach(n => collectChannelItems(n, out));
      return out;
    }
    const item = parseShelfItem(node);
    if (item) {
      out.items.push(item);
      return out;
    }
    if (node.continuationItemRenderer) {
      out.token = node.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || out.token;
      return out;
    }
    Object.values(node).forEach(v => collectChannelItems(v, out));
    return out;
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

      if (!result.items.length) {
        const found = collectChannelItems(data.onResponseReceivedActions, { items: [], token: '' });
        result.items = found.items;
        result.continuationToken = found.token;
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
      const image = lm.contentImage?.thumbnailViewModel || lm.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
      const badge = (image?.overlays || []).flatMap(o => o.thumbnailBottomOverlayViewModel?.badges || [])
        .map(b => b.thumbnailBadgeViewModel?.text).find(Boolean) || '';
      const sources = image?.image?.sources || [];
      const thumb = sources.length ? (sources[sources.length - 1].url || '') : '';
      const command = lm.rendererContext?.commandContext?.onTap?.innertubeCommand;
      let url = command?.commandMetadata?.webCommandMetadata?.url || '';
      const listId = id || command?.watchEndpoint?.playlistId || url.match(/[?&]list=([^&]+)/)?.[1] || '';
      if (!url && listId) url = `/playlist?list=${listId}`;
      const subtitle = lm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || '';
      return {
        type: 'playlist',
        id: listId,
        url,
        title,
        subtitle,
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

  export async function loadChannelSections(client, browseId, params) {
    try {
      const data = await client.browseWeb(browseId, params || null);
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || data?.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
      const sections = [];
      for (const tab of tabs) {
        const content = tab?.tabRenderer?.content;
        for (const section of content?.sectionListRenderer?.contents || []) {
          for (const entry of section.itemSectionRenderer?.contents || [section]) {
            const found = collectChannelItems(entry, { items: [], token: '' });
            if (!found.items.length) continue;
            const shelf = findKey(entry, 'shelfRenderer') || findKey(entry, 'reelShelfRenderer') || findKey(entry, 'horizontalCardListRenderer');
            sections.push({ title: getTextFromObject(shelf?.title), items: found.items });
          }
        }
        if (content?.richGridRenderer) {
          const found = collectChannelItems(content.richGridRenderer, { items: [], token: '' });
          if (found.items.length) sections.push({ title: '', items: found.items });
        }
      }
      if (!sections.length) {
        const found = collectChannelItems(data?.contents, { items: [], token: '' });
        if (found.items.length) sections.push({ title: '', items: found.items });
      }
      return { sections };
    } catch (e) {
      return { sections: [], error: e.message };
    }
  }

  export async function searchChannel(client, urlOrId, query) {
    try {
      const id = await resolveChannelId(client, urlOrId);
      let found;
      const data = await client.browseWeb(id, 'EgZzZWFyY2jyBgQKAloA', null, query);
      found = collectChannelItems(data?.contents, { items: [], token: '' });
      return { items: found.items, continuationToken: found.token };
    } catch (e) {
      return { items: [], continuationToken: '', error: e.message };
    }
  }

  export async function getChannelAbout(client, urlOrId) {
    try {
      const id = await resolveChannelId(client, urlOrId);
      const page = await client.browseWeb(id);
      let about = findKey(page, 'aboutChannelViewModel');
      if (!about) {
        const token = findKey(findKey(page, 'showEngagementPanelEndpoint'), 'token');
        if (!token) return { error: 'About data not available' };
        about = findKey(await client.browseWeb(null, null, token), 'aboutChannelViewModel');
      }
      if (!about) return { error: 'About data not available' };

      const links = (about.links || []).map(l => {
        const vm = l.channelExternalLinkViewModel;
        let url = vm?.link?.commandRuns?.[0]?.onTap?.innertubeCommand?.urlEndpoint?.url || '';
        try {
          const q = new URL(url).searchParams.get('q');
          if (q) url = q;
        } catch {}
        return { title: vm?.title?.content || '', url, label: vm?.link?.content || url };
      }).filter(l => l.url);

      return {
        description: about.description || '',
        country: about.country || '',
        joined: about.joinedDateText?.content || '',
        subscribers: about.subscriberCountText || '',
        views: about.viewCountText || '',
        videos: about.videoCountText || '',
        handle: about.canonicalChannelUrl || '',
        links,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  function postDetailParams(channelId, postId) {
    const ch = Buffer.from(channelId);
    const post = Buffer.from(postId);
    const inner = Buffer.concat([Buffer.from([0x12, ch.length]), ch, Buffer.from([0x1a, post.length]), post, Buffer.from([0x5a, ch.length]), ch]);
    return Buffer.concat([Buffer.from([0xc2, 0x03, inner.length]), inner]).toString('base64');
  }

  export async function loadPostComments(client, postId, channelId, continuationToken = null) {
    try {
      let token = continuationToken;
      if (!token) {
        const data = await client.browseWeb('FEpost_detail', postDetailParams(channelId, postId));
        const found = collectContinuations(data);
        token = found.comments;
        if (!token) return { comments: [], continuationToken: '', error: 'No comments available' };
      }
      return await getComments(client, token, 1, true);
    } catch (e) {
      return { comments: [], continuationToken: '', error: e.message };
    }
  }

  function collectContinuations(node, out = {}) {
    if (!node || typeof node !== 'object') return out;
    const section = node.itemSectionRenderer;
    if (section?.targetId === 'comments-section') {
      out.comments = section.contents?.map(c => c.continuationItemRenderer).find(Boolean)
        ?.continuationEndpoint?.continuationCommand?.token || out.comments;
      return out;
    }
    Object.values(node).forEach(v => collectContinuations(v, out));
    return out;
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
        const authorEndpoint = renderer.authorEndpoint?.browseEndpoint;
        const communityPost = {
          id: renderer.postId || '',
          commentCount: getTextFromObject(renderer.actionButtons?.commentActionButtonsRenderer?.replyButton?.buttonRenderer?.text),
          message: getTextFromObject(renderer.contentText),
          authorName: getTextFromObject(renderer.authorText),
          authorId: authorEndpoint?.browseId || '',
          authorUrl: authorEndpoint?.canonicalBaseUrl || '',
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
    loadMoreChannelItems, loadChannelPlaylists, loadCommunityPosts,
    loadChannelSections, searchChannel, getChannelAbout, loadPostComments
  };
