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

import { getTextFromObject, getAttributedText, parseSuccinctVideo, parseSuccinctPlaylist, getThumbnailUrlExact,
  getThumbnailUrlClosest, getVideoThumbnailUrl, getVideoIdByUrl, getPlaylistIdByUrl,
  convertUrlToMobile, hasVerifiedBadge, parseQueryParams, getVideoIdFromThumbnailUrl, formatCount, formatWithCommas } from './utils.js';
import fetch from 'node-fetch';
import https from 'node:https';
import { parseStoryboards } from './storyboards.js';
import { WEB } from './constants.js';

  function findKey(node, key) {
    if (!node || typeof node !== 'object') return null;
    if (node[key]) return node[key];
    for (const value of Object.values(node)) {
      const found = findKey(value, key);
      if (found) return found;
    }
    return null;
  }

  const rydAgent = new https.Agent({ family: 4, keepAlive: true });
  const rydCache = new Map();

  async function fetchLikeDislikeCounts(videoId) {
    const hit = rydCache.get(videoId);
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.v;
    const v = await fetchLikeDislikeCounts0(videoId);
    if (v.dislikes !== 'N/A') rydCache.set(videoId, { t: Date.now(), v });
    return v;
  }

  async function fetchLikeDislikeCounts0(videoId) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`, { signal: controller.signal, agent: rydAgent });
      clearTimeout(timeout);
      if (!res.ok) return { dislikes: 'N/A', dislikesExact: 0, rating: 0 };
      const data = await res.json();
      return {
        dislikes: data.dislikes != null ? formatCount(data.dislikes) : '0',
        dislikesExact: data.dislikes || 0,
        rating: data.rating || 0,
      };
    } catch (e) {
      return { dislikes: 'N/A', dislikesExact: 0, rating: 0 };
    }
  }

  function extractLikesFromNext(data) {
    let likes = '';
    let likesExact = 0;

    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.segmentedLikeDislikeButtonViewModel) {
        const vm = node.segmentedLikeDislikeButtonViewModel;
        const btn = vm.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel;
        const title = btn?.defaultButtonViewModel?.buttonViewModel?.title || btn?.toggledButtonViewModel?.buttonViewModel?.title;
        if (title && !likes) likes = title;
      }
      if (node.segmentedLikeDislikeButtonRenderer) {
        const r = node.segmentedLikeDislikeButtonRenderer;
        const title = r.likeButton?.toggleButtonRenderer?.defaultText?.simpleText || r.likeButton?.toggleButtonRenderer?.defaultText?.runs?.[0]?.text;
        if (title && !likes) likes = title;
      }
      if (node.listItemLikeCountViewModel?.valueIfLiked) {
        const str = node.listItemLikeCountViewModel.valueIfLiked;
        const num = parseInt(str.replace(/[^0-9]/g, ''), 10);
        if (num && !likesExact) likesExact = num;
      }
      for (const v of Object.values(node)) {
        walk(v);
      }
    }
    walk(data);
    return { likes, likesExact };
  }

  function extractSlimMetadata(renderer, result) {
    result.title = getTextFromObject(renderer.title);
    result.description = getTextFromObject(renderer.description, true);
    result.views = getTextFromObject(renderer.expandedSubtitle);
    result.publishDate = getTextFromObject(renderer.dateText);

    for (const button of renderer.buttons || []) {
      if (button.slimMetadataToggleButtonRenderer) {
        const smtbr = button.slimMetadataToggleButtonRenderer;
        if (smtbr.target?.videoId) {
          result.videoId = smtbr.target.videoId;
        }
      }
      if (button.slimMetadataButtonRenderer?.button?.segmentedLikeDislikeButtonViewModel) {
        const vm = button.slimMetadataButtonRenderer.button.segmentedLikeDislikeButtonViewModel;
        const likeText = vm?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel
        ?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel?.title || '0';
        result.likes = likeText;
      }
    }

    if (renderer.owner?.slimOwnerRenderer) {
      const owner = renderer.owner.slimOwnerRenderer;
      result.author = {
        id: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
        name: owner.channelName || '',
        subscribers: getTextFromObject(owner.expandedSubtitle),
        iconUrl: getThumbnailUrlExact(owner?.thumbnail?.thumbnails, 72),
        verified: hasVerifiedBadge(owner.ownerBadges || owner.badges),
      };
    }
  }

  function extractSuggestionItem(content) {
    if (content.lockupViewModel && content.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const lm = content.lockupViewModel;
      const videoId = lm.contentId || '';
      if (videoId) {
        const meta = lm.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || '';
        const author = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || '';
        const avatarTap = meta?.image?.decoratedAvatarViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint;
        const authorId = avatarTap?.browseId || '';
        const authorUrl = avatarTap?.canonicalBaseUrl || (authorId ? `/channel/${authorId}` : '');
        const metaRows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const rawViews = metaRows[1]?.metadataParts?.[0]?.text?.content || '';
        const views = metaRows[1]?.metadataParts?.[0]?.accessibilityLabel || (rawViews ? `${rawViews} views` : '');
        const publishDate = metaRows[1]?.metadataParts?.[1]?.accessibilityLabel || metaRows[1]?.metadataParts?.[1]?.text?.content || '';
        const badges = (lm.contentImage?.thumbnailViewModel?.overlays || [])
          .flatMap(o => o.thumbnailBottomOverlayViewModel?.badges || []);
        const duration = badges.map(b => b.thumbnailBadgeViewModel?.text).find(Boolean) || '';
        const sources = lm.contentImage?.thumbnailViewModel?.image?.sources || [];
        const thumb = sources[sources.length - 1]?.url || getVideoThumbnailUrl(videoId);
        return {
          type: 'video',
          videoId,
          url: `/watch?v=${videoId}`,
          title,
          duration,
          views,
          publishDate,
          author,
          authorId,
          authorUrl,
          verified: hasVerifiedBadge(meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]),
          thumbnailUrl: thumb,
        };
      }
    }
    if (content.compactVideoRenderer) {
      return { type: 'video', ...parseSuccinctVideo(content.compactVideoRenderer) };
    }
    if (content.compactAutoplayRenderer) {
      for (const j of content.compactAutoplayRenderer.contents || []) {
        if (j.videoWithContextRenderer) {
          return { type: 'video', ...parseSuccinctVideo(j.videoWithContextRenderer) };
        }
      }
    }
    if (content.videoWithContextRenderer) {
      return { type: 'video', ...parseSuccinctVideo(content.videoWithContextRenderer) };
    }
    if (content.compactRadioRenderer || content.compactPlaylistRenderer) {
      return parseSuccinctPlaylist(content.compactRadioRenderer || content.compactPlaylistRenderer);
    }
    return null;
  }

  function parseDescriptionSections(data) {
    const body = findKey(data, 'structuredDescriptionContentRenderer');
    const linkOf = (endpoint) => {
      const url = endpoint?.commandMetadata?.webCommandMetadata?.url
        || (endpoint?.watchEndpoint?.videoId ? `/watch?v=${endpoint.watchEndpoint.videoId}` : '');
      return /^\/(watch|channel|@|playlist)/.test(url) ? url : '';
    };
    const lastUrl = (sources) => sources?.length ? sources[sources.length - 1].url : '';
    const attributeItem = (v) => ({
      title: v.title || '',
      subtitle: v.subtitle || '',
      secondarySubtitle: v.secondarySubtitle?.content || '',
      imageUrl: lastUrl(v.image?.sources),
      url: linkOf(v.onTap?.innertubeCommand),
    });
    const sections = [];
    for (const item of body?.items || []) {
      const list = item.horizontalCardListRenderer;
      if (list) {
        const items = (list.cards || []).map(c => c.videoAttributeViewModel).filter(Boolean).map(attributeItem);
        if (items.length) {
          sections.push({ title: getTextFromObject(list.header?.richListHeaderRenderer?.title), subtitle: '', items });
        }
      }
      const music = item.videoDescriptionMusicSectionRenderer;
      if (music) {
        const items = (music.carouselLockups || []).map(l => l.carouselLockupRenderer).filter(Boolean).map(l => {
          const rows = {};
          for (const row of l.infoRows || []) {
            const r = row.infoRowRenderer;
            const value = getTextFromObject(r?.defaultMetadata) || getTextFromObject(r?.expandedMetadata);
            if (r && value) rows[getTextFromObject(r.title).toUpperCase()] = value;
          }
          const [song, artist, album] = [rows.SONG, rows.ARTIST, rows.ALBUM];
          const video = l.videoLockup?.compactVideoRenderer;
          return {
            title: song || getTextFromObject(video?.title),
            subtitle: artist || '',
            secondarySubtitle: album || '',
            imageUrl: lastUrl(video?.thumbnail?.thumbnails),
            url: video?.videoId ? `/watch?v=${video.videoId}` : '',
          };
        }).filter(i => i.title);
        if (items.length) {
          sections.push({ title: getTextFromObject(music.sectionTitle), subtitle: getTextFromObject(music.subHeaderText), items });
        }
      }
      const games = item.videoAttributesSectionViewModel;
      if (games) {
        const items = (games.videoAttributeViewModels || []).map(c => c.videoAttributeViewModel).filter(Boolean).map(attributeItem).filter(i => i.title);
        if (items.length) {
          sections.push({ title: games.headerTitle || 'Games', subtitle: '', items });
        }
      }
    }
    return sections;
  }

  export async function getVideoDetail(client, videoId, playlistId = null) {
    const result = {
      videoId,
      url: `/watch?v=${videoId}`,
      title: '',
      description: '',
      author: { id: '', name: '', subscribers: '', iconUrl: '', verified: false },
      views: '',
      publishDate: '',
      likes: '0',
      dislikes: '0',
      duration: 0,
      thumbnailUrl: getVideoThumbnailUrl(videoId),
      isLivestream: false,
      isUpcoming: false,
      license: '',
      category: '',
      visibility: '',
      suggestions: [],
      descriptionSections: [],
      suggestionsContinuationToken: '',
      comments: {
        continuationToken: '',
        type: -1,
        disabled: true,
      },
      playlist: null,
      storyboards: null,
      error: '',
    };

    try {
      const rydPromise = fetchLikeDislikeCounts(videoId);
      const promises = [
        client.next(videoId, playlistId),
        client._post(`${WEB.apiUrl}next?prettyPrint=false`, {
          context: client._makeContext(WEB),
          videoId,
          ...(playlistId ? { playlistId } : {})
        }, WEB).catch(() => null),
        client.mwebBasePlayer(videoId).catch(() => null)
      ];
      if (playlistId) {
        promises.push(getPlaylist(client, playlistId).catch(() => null));
      }
      const [nextData, webNextData, playerData, plData] = await Promise.all(promises);
      result.storyboards = parseStoryboards(nextData.playerResponse?.storyboards || nextData.storyboards);
      const watchNext = nextData?.contents?.singleColumnWatchNextResults;

      if (!watchNext) {
        result.error = 'Unexpected response structure';
        return result;
      }

      const tabbedResults = watchNext?.results?.watchNextTabbedResultsRenderer;
      if (tabbedResults) {
        for (const tab of tabbedResults.tabs || []) {
          if (!tab.tabRenderer) continue;
          const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents || [];
          for (const section of sections) {
            if (!section.itemSectionRenderer) continue;
            for (const item of section.itemSectionRenderer.contents || []) {
              if (item.videoMetadataRenderer && !result.title) {
                const meta = item.videoMetadataRenderer;
                result.title = getTextFromObject(meta.title);
                result.views = getTextFromObject(meta.viewCountText);
                if (meta.attributedDescription?.content) {
                  result.description = getAttributedText(meta.attributedDescription);
                } else {
                  result.description = getTextFromObject(meta.description, true);
                }
                result.publishDate = getTextFromObject(meta.dateText);
                if (meta.owner?.videoOwnerRenderer) {
                  const owner = meta.owner.videoOwnerRenderer;
                  result.author.name = getTextFromObject(owner.title);
                  result.author.subscribers = getTextFromObject(owner.subscriberCountText);
                  result.author.verified = hasVerifiedBadge(owner.badges);
                  if (owner.navigationEndpoint?.browseEndpoint?.browseId) {
                    result.author.id = owner.navigationEndpoint.browseEndpoint.browseId;
                  }
                  if (owner.thumbnail?.thumbnails?.length) {
                    result.author.iconUrl = owner.thumbnail.thumbnails[0].url;
                  }
                }
              } else {
                const suggestion = extractSuggestionItem(item);
                if (suggestion) result.suggestions.push(suggestion);
              }
            }
            if (section.itemSectionRenderer.continuations) {
              for (const cont of section.itemSectionRenderer.continuations) {
                if (cont.nextContinuationData) {
                  result.suggestionsContinuationToken = cont.nextContinuationData.continuation;
                }
              }
            }
          }
        }
      } else {
        const contents = watchNext?.results?.results?.contents || [];
        for (const content of contents) {
          if (content.itemSectionRenderer) {
            for (const item of content.itemSectionRenderer.contents || []) {
              if (item.slimVideoMetadataRenderer) {
                extractSlimMetadata(item.slimVideoMetadataRenderer, result);
              } else {
                const suggestion = extractSuggestionItem(item);
                if (suggestion) result.suggestions.push(suggestion);
              }
              if (item.continuationItemRenderer) {
                result.suggestionsContinuationToken =
                item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
              }
            }
          }
          if (content.slimVideoMetadataSectionRenderer) {
            for (const item of content.slimVideoMetadataSectionRenderer.contents || []) {
              if (item.slimVideoInformationRenderer) {
                result.title = getTextFromObject(item.slimVideoInformationRenderer.title);
              }
              if (item.slimOwnerRenderer) {
                const owner = item.slimOwnerRenderer;
                result.author = {
                  id: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
                  name: owner.channelName || '',
                  subscribers: getTextFromObject(owner.expandedSubtitle),
                  iconUrl: getThumbnailUrlExact(owner?.thumbnail?.thumbnails, 72),
                  verified: hasVerifiedBadge(owner.ownerBadges || owner.badges),
                };
              }
              if (item.slimVideoDescriptionRenderer) {
                const svdr = item.slimVideoDescriptionRenderer;
                if (svdr.attributedDescription?.content) {
                  result.description = getAttributedText(svdr.attributedDescription);
                } else {
                  result.description = getTextFromObject(svdr.description, true);
                }
              }
            }
          }
        }
      }

      if (watchNext?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer?.isLive
        || !!findKey(webNextData, 'isLive')
        || !!findKey(nextData, 'isLive')) {
        result.isLivestream = true;
      }

      for (const panel of nextData.engagementPanels || []) {
        const panelContent = panel?.engagementPanelSectionListRenderer?.content;

        if (panelContent?.structuredDescriptionContentRenderer) {
          for (const item of panelContent.structuredDescriptionContentRenderer.items || []) {
            if (item.expandableVideoDescriptionBodyRenderer) {
              const evdbr = item.expandableVideoDescriptionBodyRenderer;
              if (evdbr.attributedDescriptionBodyText?.content) {
                result.description = getAttributedText(evdbr.attributedDescriptionBodyText);
              } else if (evdbr.descriptionBodyText) {
                result.description = getTextFromObject(evdbr.descriptionBodyText, true);
              }
            }
            if (item.videoDescriptionHeaderRenderer) {
              if (!result.title) result.title = getTextFromObject(item.videoDescriptionHeaderRenderer.title);
              result.publishDate = getTextFromObject(item.videoDescriptionHeaderRenderer.publishDate);
              result.views = getTextFromObject(item.videoDescriptionHeaderRenderer.views);
            }
          }
        }
        const slContent = panelContent?.sectionListRenderer;
        if (slContent) {
          for (const cont of slContent.continuations || []) {
            if (cont.reloadContinuationData) {
              result.comments.continuationToken = cont.reloadContinuationData.continuation;
              result.comments.type = 0;
              result.comments.disabled = false;
            }
          }
          for (const item of slContent.contents || []) {
            if (item?.itemSectionRenderer?.contents) {
              for (const k of item.itemSectionRenderer.contents) {
                if (k.continuationItemRenderer) {
                  result.comments.continuationToken =
                  k.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
                  result.comments.type = 1;
                  result.comments.disabled = false;
                }
              }
            }
          }
        }
      }

      const micro = playerData?.microformat?.playerMicroformatRenderer || findKey(nextData, 'playerMicroformatRenderer') || findKey(webNextData, 'playerMicroformatRenderer');
      const metaRows = (findKey(webNextData, 'metadataRowContainerRenderer') || findKey(nextData, 'metadataRowContainerRenderer'))?.rows || [];
      const metaRow = (re) => {
        const row = metaRows.map(r => r.metadataRowRenderer).find(r => re.test(getTextFromObject(r?.title)));
        return row ? getTextFromObject(row.contents?.[0]) : '';
      };
      result.category = micro?.category || metaRow(/categor/i);
      result.license = metaRow(/licen[cs]e/i) || 'Standard YouTube License';
      result.visibility = (playerData?.videoDetails || findKey(nextData, 'videoDetails'))?.isPrivate ? 'Private' : micro?.isUnlisted ? 'Unlisted' : 'Public';

      const chat = findKey(webNextData, 'liveChatRenderer') || findKey(nextData, 'liveChatRenderer');
      const chatToken = chat?.continuations?.[0]?.reloadContinuationData?.continuation
        || chat?.continuations?.[0]?.invalidationContinuationData?.continuation
        || chat?.continuations?.[0]?.timedContinuationData?.continuation
        || chat?.continuations?.[0]?.liveChatReplayContinuationData?.continuation
        || '';
      if (chatToken) {
        const modes = chat.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems || [];
        result.liveChat = {
          token: chatToken,
          isReplay: !!chat.isReplay,
          modes: modes
            .map(m => ({
              title: m.title || '',
              continuation: m.continuation?.reloadContinuationData?.continuation
                || m.continuation?.invalidationContinuationData?.continuation
                || m.continuation?.timedContinuationData?.continuation
                || '',
              selected: !!m.selected
            }))
            .filter(m => m.continuation),
        };
        if (!chat.isReplay) result.isLivestream = true;
      }

      const playlistObj = watchNext?.playlist?.playlist;
      if (playlistObj) {
        result.playlist = {
          id: playlistObj.playlistId || '',
          title: playlistObj.title || '',
          authorName: getTextFromObject(playlistObj.ownerName),
          totalVideos: playlistObj.totalVideos || 0,
          selectedIndex: -1,
          videos: [],
        };
        for (const item of playlistObj.contents || []) {
          if (item.playlistPanelVideoRenderer) {
            const renderer = item.playlistPanelVideoRenderer;
            const video = parseSuccinctVideo(renderer);
            if (video && video.url && result.playlist.id) {
              video.url += `&list=${result.playlist.id}`;
            }
            if (renderer.selected) {
              result.playlist.selectedIndex = result.playlist.videos.length;
            }
            result.playlist.videos.push(video);
          }
        }
      }

      if (plData?.videos?.length && result.playlist?.videos?.length) {
        const plMap = new Map();
        for (const pv of plData.videos) {
          const vid = pv.videoId || pv.id;
          if (vid) plMap.set(vid, pv);
        }
        for (const v of result.playlist.videos) {
          const vid = v.videoId || v.id;
          const full = plMap.get(vid);
          if (full) {
            if (!v.views && full.views) v.views = full.views;
            if (!v.publishDate && full.publishDate) v.publishDate = full.publishDate;
            if (!v.authorId && full.authorId) v.authorId = full.authorId;
            if (!v.authorUrl && full.authorUrl) v.authorUrl = full.authorUrl;
          }
        }
      }

      if (webNextData) {
        result.descriptionSections = parseDescriptionSections(webNextData);
        const webOwner = findKey(webNextData, 'videoOwnerRenderer');
        if (webOwner && hasVerifiedBadge(webOwner.badges)) result.author.verified = true;
        const webSuggestionsMap = new Map();
        const webSecResults = webNextData?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
        for (const sec of webSecResults) {
          for (const item of sec.itemSectionRenderer?.contents || []) {
            if (item.lockupViewModel && item.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
              const lm = item.lockupViewModel;
              const vid = lm.contentId || '';
              if (vid) {
                const meta = lm.metadata?.lockupMetadataViewModel;
                const metaRows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
                const rawViews = metaRows[1]?.metadataParts?.[0]?.text?.content || '';
                const views = metaRows[1]?.metadataParts?.[0]?.accessibilityLabel || (rawViews ? `${rawViews} views` : '');
                const publishDate = metaRows[1]?.metadataParts?.[1]?.accessibilityLabel || metaRows[1]?.metadataParts?.[1]?.text?.content || '';
                webSuggestionsMap.set(vid, { views, publishDate });
              }
            }
          }
        }
        for (const s of result.suggestions) {
          const vid = s.videoId || s.id;
          const webMeta = webSuggestionsMap.get(vid);
          if (webMeta) {
            if (!s.views && webMeta.views) s.views = webMeta.views;
            if (!s.publishDate && webMeta.publishDate) s.publishDate = webMeta.publishDate;
          }
        }
      }

      const itLikes = extractLikesFromNext(nextData);
      if (itLikes.likes) result.likes = itLikes.likes;
      if (itLikes.likesExact) result.likesExact = itLikes.likesExact;

      const rydData = await rydPromise;
      result.dislikes = rydData.dislikes;
      result.dislikesExact = rydData.dislikesExact;
      result.rating = rydData.rating;

    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  export async function loadMoreSuggestions(client, continuationToken) {
    const data = await client.nextContinuation(continuationToken);
    const result = { suggestions: [], continuationToken: '' };

    if (data.continuationContents?.itemSectionContinuation) {
      const cont = data.continuationContents.itemSectionContinuation;
      for (const item of cont.contents || []) {
        const suggestion = extractSuggestionItem(item);
        if (suggestion) result.suggestions.push(suggestion);
      }
      for (const c of cont.continuations || []) {
        if (c.nextContinuationData) {
          result.continuationToken = c.nextContinuationData.continuation;
        }
      }
    } else {
      for (const cmd of data.onResponseReceivedEndpoints || []) {
        for (const item of cmd?.appendContinuationItemsAction?.continuationItems || []) {
          const suggestion = extractSuggestionItem(item);
          if (suggestion) result.suggestions.push(suggestion);
          if (item.continuationItemRenderer) {
            result.continuationToken =
            item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
          }
        }
      }
    }

    return result;
  }

  export default { getVideoDetail, loadMoreSuggestions };

  export async function getPlaylist(client, playlistId) {
    const result = {
      id: playlistId,
      title: '',
      authorName: '',
      videoCount: 0,
      viewCount: '',
      videos: [],
      error: '',
    };

    function parsePlaylistVideo(r) {
      if (!r || !r.videoId) return null;
      const videoId = r.videoId;
      const thumbs = r.thumbnail?.thumbnails || [];
      const thumb = thumbs[thumbs.length - 1]?.url || '';
      const byline = r.shortBylineText || r.longBylineText;
      const author = getTextFromObject(byline) || '';
      const authorId = byline?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
        || r.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.navigationEndpoint?.browseEndpoint?.browseId
        || '';
      const authorUrl = byline?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
        || (authorId ? `/channel/${authorId}` : '');
      let views = getTextFromObject(r.shortViewCountText || r.viewCountText);
      let publishDate = getTextFromObject(r.publishedTimeText);
      if ((!views || !publishDate) && r.videoInfo?.runs) {
        const parts = r.videoInfo.runs.map(run => run.text).filter(t => t && t.trim() !== '•');
        if (!views && parts[0]) views = parts[0].trim();
        if (!publishDate && parts[1]) publishDate = parts[1].trim();
      }
      return {
        videoId,
        id: videoId,
        title: r.title?.runs?.[0]?.text || r.title?.simpleText || '',
        author,
        authorName: author,
        authorId,
        authorUrl,
        views,
        publishDate,
        duration: r.lengthText?.simpleText || r.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '',
        thumbnailUrl: thumb,
        url: `/watch?v=${videoId}&list=${playlistId}`,
      };
    }

    function collectVideos(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) collectVideos(item);
        return;
      }
      if (obj.lockupViewModel) {
        const lm = obj.lockupViewModel;
        const videoId = lm.contentId || '';
        if (videoId) {
          const title = lm.metadata?.lockupMetadataViewModel?.title?.content || '';
          const author = lm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || '';
          const avatarTap = lm.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint;
          const authorId = avatarTap?.browseId || '';
          const authorUrl = avatarTap?.canonicalBaseUrl || (authorId ? `/channel/${authorId}` : '');
          const metaRows = lm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
          const rawViews = metaRows[1]?.metadataParts?.[0]?.text?.content || '';
          const views = metaRows[1]?.metadataParts?.[0]?.accessibilityLabel || (rawViews ? `${rawViews}` : '');
          const publishDate = metaRows[1]?.metadataParts?.[1]?.accessibilityLabel || metaRows[1]?.metadataParts?.[1]?.text?.content || '';
          let duration = '';
          const badges = lm.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges || [];
          if (badges.length > 0) {
            duration = badges[0]?.thumbnailBadgeViewModel?.text || '';
          }
          const sources = lm.contentImage?.thumbnailViewModel?.image?.sources || [];
          const thumb = sources[sources.length - 1]?.url || getVideoThumbnailUrl(videoId);
          result.videos.push({
            videoId,
            id: videoId,
            title,
            author,
            authorName: author,
            authorId,
            authorUrl,
            views,
            publishDate,
            duration,
            thumbnailUrl: thumb,
            url: `/watch?v=${videoId}&list=${playlistId}`,
          });
          return;
        }
      }
      if (obj.playlistVideoRenderer) {
        const v = parsePlaylistVideo(obj.playlistVideoRenderer);
        if (v) result.videos.push(v);
        return;
      }
      if (obj.playlistPanelVideoRenderer) {
        const v = parsePlaylistVideo(obj.playlistPanelVideoRenderer);
        if (v) result.videos.push(v);
        return;
      }
      if (obj.compactVideoRenderer) {
        const v = parsePlaylistVideo(obj.compactVideoRenderer);
        if (v) result.videos.push(v);
        return;
      }
      if (obj.videoRenderer) {
        const v = parsePlaylistVideo(obj.videoRenderer);
        if (v) result.videos.push(v);
        return;
      }
      if (obj.continuationItemRenderer) return;
      for (const key of Object.keys(obj)) {
        if (key === 'thumbnail' || key === 'navigationEndpoint') continue;
        collectVideos(obj[key]);
      }
    }

    try {
      let data = await client.browse(`VL${playlistId}`);

      const pageHeader = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
      if (pageHeader) {
        result.title = pageHeader.title?.dynamicTextViewModel?.text?.content || '';
        const rows = pageHeader.metadata?.contentMetadataViewModel?.metadataRows || [];
        const authorPart = rows[0]?.metadataParts?.[0];
        if (authorPart?.avatarStack?.avatarStackViewModel?.text?.content) {
          result.authorName = authorPart.avatarStack.avatarStackViewModel.text.content;
          const cmd = authorPart.avatarStack.avatarStackViewModel.rendererContext?.commandContext?.onTap?.innertubeCommand
            || authorPart.avatarStack.avatarStackViewModel.text?.commandRuns?.[0]?.onTap?.innertubeCommand;
          if (cmd?.browseEndpoint?.browseId) {
            result.authorId = cmd.browseEndpoint.browseId;
          }
          if (cmd?.browseEndpoint?.canonicalBaseUrl) {
            result.authorUrl = cmd.browseEndpoint.canonicalBaseUrl;
          }
        } else if (authorPart?.text?.content) {
          result.authorName = authorPart.text.content;
        }
        if (rows[1]?.metadataParts?.[0]?.text?.content) {
          result.videoCount = parseInt(rows[1].metadataParts[0].text.content) || 0;
        }
        if (rows[1]?.metadataParts?.[1]?.text?.content) {
          result.viewCount = rows[1].metadataParts[1].text.content;
        }
      }

      const header =
      data?.header?.playlistHeaderRenderer ||
      data?.header?.playlistPanelRenderer ||
      data?.header?.c4TabbedHeaderRenderer ||
      null;

      if (header) {
        result.title = result.title || header.title?.simpleText || header.title?.runs?.[0]?.text || '';
        result.authorName =
        result.authorName ||
        header.ownerText?.runs?.[0]?.text ||
        header.subtitle?.runs?.[0]?.text ||
        header.channelHandleText?.runs?.[0]?.text || '';
        const ownerBrowse = header.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
        if (!result.authorId && ownerBrowse?.browseId) {
          result.authorId = ownerBrowse.browseId;
        }
        if (!result.authorUrl && (ownerBrowse?.canonicalBaseUrl || result.authorId)) {
          result.authorUrl = ownerBrowse?.canonicalBaseUrl || `/channel/${result.authorId}`;
        }
        result.viewCount = result.viewCount || header.viewCountText?.simpleText || '';
        result.videoCount = result.videoCount || parseInt(header.numVideosText?.runs?.[0]?.text || '0') || 0;
      }

      if (!result.title) {
        result.title = data?.microformat?.microformatDataRenderer?.title || '';
      }

      const twoColTabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      for (const tab of twoColTabs) {
        if (!tab.tabRenderer?.selected) continue;
        collectVideos(tab.tabRenderer.content);
      }

      if (result.videos.length === 0) {
        const singleColTabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
        for (const tab of singleColTabs) {
          collectVideos(tab?.tabRenderer?.content);
        }
      }

      if (result.videos.length === 0) {
        collectVideos(data?.contents);
      }

      if (result.videos.length === 0) {
        collectVideos(data?.sidebar);
        collectVideos(data?.secondaryContents);
      }

      if (result.videos.length === 0) {
        try {
          const androidData = await client.browseAndroid(`VL${playlistId}`);
          collectVideos(androidData?.contents);
          collectVideos(androidData?.sidebar);
          if (!result.title) {
            const ah = androidData?.header?.playlistHeaderRenderer || androidData?.header?.playlistPanelRenderer;
            if (ah) result.title = ah.title?.simpleText || ah.title?.runs?.[0]?.text || '';
            if (!result.title) result.title = androidData?.microformat?.microformatDataRenderer?.title || '';
          }
        } catch (_) {}
      }

      if (!result.title && result.videos.length > 0) {
        result.title = 'Playlist';
      }

    } catch (e) {
      result.error = e.message;
    }

    return result;
  }
