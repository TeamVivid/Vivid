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
  convertUrlToMobile, parseQueryParams, getVideoIdFromThumbnailUrl, formatCount, formatWithCommas } from './utils.js';
  import fetch from 'node-fetch';

  function findKey(node, key) {
    if (!node || typeof node !== 'object') return null;
    if (node[key]) return node[key];
    for (const value of Object.values(node)) {
      const found = findKey(value, key);
      if (found) return found;
    }
    return null;
  }

  async function fetchLikeDislikeCounts(videoId) {
    try {
      const res = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`);
      if (!res.ok) return { likes: 'N/A', dislikes: 'N/A' };
      const data = await res.json();
      return {
        likes: data.likes != null ? formatCount(data.likes) : '0',
        dislikes: data.dislikes != null ? formatCount(data.dislikes) : '0',
        likesExact: data.likes || 0,
        dislikesExact: data.dislikes || 0,
        rating: data.rating || 0,
        viewCount: data.viewCount || 0,
      };
    } catch (e) {
      return { likes: 'N/A', dislikes: 'N/A' };
    }
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
      };
    }
  }

  function extractSuggestionItem(content) {
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

  export async function getVideoDetail(client, videoId, playlistId = null) {
    const result = {
      videoId,
      url: `/watch?v=${videoId}`,
      title: '',
      description: '',
      author: { id: '', name: '', subscribers: '', iconUrl: '' },
      views: '',
      publishDate: '',
      likes: '0',
      dislikes: '0',
      duration: 0,
      thumbnailUrl: getVideoThumbnailUrl(videoId),
      isLivestream: false,
      isUpcoming: false,
      suggestions: [],
      suggestionsContinuationToken: '',
      comments: {
        continuationToken: '',
        type: -1,
        disabled: true,
      },
      playlist: null,
      error: '',
    };

    try {
      const nextData = await client.next(videoId, playlistId);
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

      if (watchNext?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer?.isLive) {
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

      const chat = findKey(nextData, 'liveChatRenderer');
      const chatToken = chat?.continuations?.[0]?.reloadContinuationData?.continuation || '';
      if (chatToken) {
        const modes = chat.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems || [];
        result.liveChat = {
          token: chatToken,
          isReplay: !!chat.isReplay,
          modes: modes
            .map(m => ({ title: m.title || '', continuation: m.continuation?.reloadContinuationData?.continuation || '', selected: !!m.selected }))
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

      const rydData = await fetchLikeDislikeCounts(videoId);
      result.likes = rydData.likes;
      result.dislikes = rydData.dislikes;
      result.likesExact = rydData.likesExact;
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
      return {
        videoId,
        id: videoId,
        title: r.title?.runs?.[0]?.text || r.title?.simpleText || '',
        author: r.shortBylineText?.runs?.[0]?.text || r.longBylineText?.runs?.[0]?.text || '',
        authorName: r.shortBylineText?.runs?.[0]?.text || r.longBylineText?.runs?.[0]?.text || '',
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
          const views = lm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[1]?.metadataParts?.[0]?.text?.content || '';
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
            views,
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
        if (rows[0]?.metadataParts?.[0]?.text?.content) {
          result.authorName = rows[0].metadataParts[0].text.content;
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
