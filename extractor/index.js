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

import InnerTubeClient from './innertube.js';
import { search, searchContinuation } from './search.js';
import { getVideoDetail, loadMoreSuggestions, getPlaylist } from './video.js';
import { getStreamUrls, getBestAudioUrl, getCombinedStreamUrl } from './stream.js';
import { getChannel, getChannelStreams, getChannelShorts, loadMoreChannelItems, loadChannelPlaylists, loadCommunityPosts,
  loadChannelSections, searchChannel, getChannelAbout, loadPostComments } from './channel.js';
import { getTrending } from './home.js';
import { getComments, getCommentReplies } from './comments.js';
import { getCaptionTracks, getCaptionContent, getCaptionVtt, cacheCaptionTracks } from './captions.js';
import livechat from './livechat.js';
import * as utils from './utils.js';
import * as constants from './constants.js';

class VividExtractor {
  constructor(options = {}) {
    this.client = new InnerTubeClient(options);
  }

  setLanguage(lang) { this.client.setLanguage(lang); }

  async search(query, filters = {}) { return search(this.client, query, filters); }
  async searchContinuation(token) { return searchContinuation(this.client, token); }
  async getVideoDetail(videoId, playlistId) { return getVideoDetail(this.client, videoId, playlistId); }
  async loadMoreSuggestions(token) { return loadMoreSuggestions(this.client, token); }
  async getPlaylist(playlistId) { return getPlaylist(this.client, playlistId); }
  async getStreamUrls(videoId, options = {}) { return getStreamUrls(this.client, videoId, options); }
  async getBestAudioUrl(videoId) { return getBestAudioUrl(this.client, videoId); }
  async getChannel(urlOrId) { return getChannel(this.client, urlOrId); }
  async getChannelStreams(urlOrId) { return getChannelStreams(this.client, urlOrId); }
  async getChannelShorts(urlOrId) { return getChannelShorts(this.client, urlOrId); }
  async loadMoreChannelItems(token) { return loadMoreChannelItems(this.client, token); }
  async loadChannelPlaylists(browseId, params) { return loadChannelPlaylists(this.client, browseId, params); }
  async loadCommunityPosts(channelUrl, token) { return loadCommunityPosts(this.client, channelUrl, token); }
  async loadChannelSections(browseId, params) { return loadChannelSections(this.client, browseId, params); }
  async searchChannel(urlOrId, query) { return searchChannel(this.client, urlOrId, query); }
  async getChannelAbout(urlOrId) { return getChannelAbout(this.client, urlOrId); }
  async loadPostComments(postId, channelId, token) { return loadPostComments(this.client, postId, channelId, token); }
  async getTrending() { return getTrending(this.client); }
  async getComments(token, type, useWeb) { return getComments(this.client, token, type, useWeb); }
  async getCommentReplies(token, useWeb) { return getCommentReplies(this.client, token, useWeb); }
  async getCaptionTracks(videoId) { return getCaptionTracks(this.client, videoId); }
  async getCaptionContent(baseUrl, lang) { return getCaptionContent(baseUrl, lang); }
  async getCaptionVtt(baseUrl, lang) { return getCaptionVtt(baseUrl, lang); }
  cacheCaptionTracks(videoId, renderer) { return cacheCaptionTracks(videoId, renderer); }
  async getFullVideo(videoId, options = {}) {
    const listId = options.list || options.playlistId || null;
    const [video, streams, captions] = await Promise.all([
      this.getVideoDetail(videoId, listId),
      this.getStreamUrls(videoId, options),
      this.getCaptionTracks(videoId)
    ]);
    if (streams && streams.duration && (!video.duration || video.duration === 0)) {
      video.duration = Math.round(streams.duration / 1000);
    }
    if (streams?.isLivestream) {
      video.isLivestream = true;
    }
    return {
      videoId,
      video,
      streams,
      captions
    };
  }
  async getLiveChat(token, options) { return livechat.getLiveChat(this.client, token, options); }
}

export default VividExtractor;
export { InnerTubeClient, utils, constants, livechat };
