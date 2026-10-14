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

import { forceYtDlp, isYtDlpAvailable, getYtDlpInfo } from './ytdlp.js';
import { hasOAuthFile } from './androidVrAuth.js';

// This file will first try to extract with Innertube, if it fails it will try to use yt-dlp and if that also fails it will try to use ANDROID_REEL (currently only returns progressive streams (like the ANDROID client, but i will still use it because i can))

function pickBestAudio(audioStreams) {
  return audioStreams.find(s => s.isDefault)
  || audioStreams.find(s => s.isOriginal)
  || audioStreams[0] || null;
}

function buildEmptyResult(videoId) {
  return {
    videoId,
    playabilityStatus: '',
    playabilityReason: '',
    isPlayable: false,
    isLivestream: false,
    duration: 0,
    audioStreams: [],
    videoStreams: [],
    combinedStreams: [],
    cpn: '',
    error: '',
    usedClient: '',
    isUpcoming: false,
    scheduledStartTime: 0,
  };
}

function parseUpcoming(raw, videoId, usedClient) {
  if (raw?.playabilityStatus?.status !== 'LIVE_STREAM_OFFLINE') return null;
  const slate = raw.playabilityStatus.liveStreamability?.liveStreamabilityRenderer?.offlineSlate?.liveStreamOfflineSlateRenderer;
  const result = buildEmptyResult(videoId);
  result.usedClient = usedClient;
  result.playabilityStatus = 'LIVE_STREAM_OFFLINE';
  result.playabilityReason = raw.playabilityStatus.reason || '';
  result.isUpcoming = true;
  result.scheduledStartTime = (Number(slate?.scheduledStartTime) || 0) * 1000;
  return result;
}

async function getStreamUrlsViaYtdlp(videoId) {
  const result = buildEmptyResult(videoId);
  result.usedClient = 'YTDLP';

  const info = await getYtDlpInfo(videoId);

  result.playabilityStatus = 'OK';
  result.isPlayable = true;
  result.isLivestream = !!info.is_live;
  result.duration = info.duration ? Math.round(info.duration * 1000) : 0;

  if (info.is_live) {
    const hls = (info.formats || [])
      .filter(f => /m3u8/.test(f.protocol || '') && f.url)
      .sort((a, b) => (b.acodec !== 'none' && b.vcodec !== 'none') - (a.acodec !== 'none' && a.vcodec !== 'none') || (b.height || 0) - (a.height || 0))[0];
    if (!hls) throw new Error('yt-dlp returned no HLS format for the livestream');
    result.hlsManifestUrl = hls.url;
    return result;
  }

  const formats = (info.formats || []).filter(f => {
    const proto = f.protocol || '';
    return proto !== 'm3u8' && proto !== 'm3u8_native' && !(f.url || '').includes('.m3u8');
  });

  for (const format of formats) {
    if (!format.url) continue;
    if (/drc/i.test(format.format_id || '') || /drc/i.test(format.format_note || '')) continue;
    const hasAudio = format.acodec && format.acodec !== 'none';
    const hasVideo = format.vcodec && format.vcodec !== 'none';
    if (!hasAudio && !hasVideo) continue;

    const mimeType = format.ext === 'm4a' || (hasAudio && !hasVideo)
    ? `audio/${format.audio_ext === 'm4a' || format.ext === 'm4a' ? 'mp4' : format.ext}; codecs="${format.acodec}"`
    : `video/${format.ext}; codecs="${[format.vcodec, format.acodec].filter(c => c && c !== 'none').join(', ')}"`;

    const streamInfo = {
      url: format.url,
      itag: Number(format.format_id) || 0,
      mimeType,
      bitrate: Math.round((format.tbr || format.abr || format.vbr || 0) * 1000),
      contentLength: format.filesize ? String(format.filesize) : (format.filesize_approx ? String(format.filesize_approx) : ''),
      quality: format.format_note || '',
      qualityLabel: format.format_note || (format.height ? `${format.height}p` : ''),
    };

    if (hasAudio && !hasVideo) {
      streamInfo.audioQuality = format.format_note || '';
      streamInfo.audioSampleRate = format.asr || '';
      streamInfo.audioChannels = format.audio_channels || 0;
      const note = format.format_note || '';
      streamInfo.audioTrackId = format.language || '';
      streamInfo.displayName = note.split(',')[0].trim();
      if (format.language_preference > 0 || /\(default\)/i.test(note)) streamInfo.isDefault = true;
      if (/original/i.test(note)) streamInfo.isOriginal = true;
      result.audioStreams.push(streamInfo);
    } else if (hasVideo) {
      streamInfo.width = format.width || 0;
      streamInfo.height = format.height || 0;
      streamInfo.fps = format.fps || 0;
      if (hasAudio) {
        result.combinedStreams.push(streamInfo);
      } else {
        result.videoStreams.push(streamInfo);
      }
    }
  }

  result.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  result.videoStreams.sort((a, b) => (b.height || 0) - (a.height || 0));
  result.bestAudio = pickBestAudio(result.audioStreams);
  result.bestVideo = result.videoStreams.find(s => s.mimeType.includes('avc1'))
  || result.videoStreams[0] || null;

  result.qualityMap = {};
  const resolutions = [144, 240, 360, 480, 720, 1080, 1440, 2160];
  for (const stream of result.videoStreams) {
    if (stream.mimeType.includes('avc1')) {
      const closest = resolutions.reduce((prev, curr) =>
      Math.abs(curr - stream.height) < Math.abs(prev - stream.height) ? curr : prev
      );
      if (!result.qualityMap[closest] || stream.bitrate > result.qualityMap[closest].bitrate) {
        result.qualityMap[closest] = stream;
      }
    }
  }

  if (!result.audioStreams.length && !result.videoStreams.length && !result.combinedStreams.length) {
    throw new Error('yt-dlp returned no usable non-HLS formats');
  }

  return result;
}

function isUsableStreamingData(data) {
  const status = data?.playabilityStatus?.status || '';
  if (status !== 'OK') return false;
  const sd = data?.streamingData;
  if (!sd) return false;
  const hasFormats = (sd.formats && sd.formats.length) || (sd.adaptiveFormats && sd.adaptiveFormats.length);
  return !!(hasFormats || sd.hlsManifestUrl);
}

function parseInnertubeResult(data, videoId, usedClient) {
  const result = buildEmptyResult(videoId);
  result.usedClient = usedClient;

  result.cpn = data.cpn || '';
  result.playabilityStatus = data?.playabilityStatus?.status || '';
  result.playabilityReason = data?.playabilityStatus?.reason || '';
  result.isPlayable = result.playabilityStatus === 'OK';

  if (!result.isPlayable) {
    result.error = `Video not playable: ${result.playabilityReason || result.playabilityStatus}`;
    return result;
  }

  const streamingData = data?.streamingData;
  if (!streamingData) {
    result.error = 'No streaming data available';
    return result;
  }

  const allFormats = [
    ...(streamingData.formats || []),
    ...(streamingData.adaptiveFormats || []),
  ];

  for (const format of allFormats) {
    const url = format.url ? decodeURIComponent(format.url) : '';
    if (!url) continue;
    if (format.isDrc || /[?&]xtags=[^&]*drc/i.test(url)) continue;

    const mimeType = format.mimeType || '';
    const itag = format.itag || 0;
    const bitrate = format.bitrate || 0;
    const contentLength = format.contentLength || '';
    const quality = format.quality || '';
    const qualityLabel = format.qualityLabel || '';
    const width = format.width || 0;
    const height = format.height || 0;
    const fps = format.fps || 0;

    if (format.targetDurationSec) {
      result.isLivestream = true;
    }

    if (format.approxDurationMs) {
      result.duration = parseInt(format.approxDurationMs, 10);
    }

    if (format.type === 'FORMAT_STREAM_TYPE_OTF') continue;

    const streamInfo = {
      url: url + (result.cpn ? `&cpn=${result.cpn}` : ''),
      itag,
      mimeType,
      bitrate,
      contentLength,
      quality,
      qualityLabel,
    };

    if (mimeType.startsWith('audio/')) {
      streamInfo.audioQuality = format.audioQuality || '';
      streamInfo.audioSampleRate = format.audioSampleRate || '';
      streamInfo.audioChannels = format.audioChannels || 0;
      if (format.audioTrack) {
        const track = format.audioTrack;
        streamInfo.audioTrackId = track.id || track.audioTrackId || '';
        streamInfo.displayName = track.displayName || '';
        if (track.audioIsDefault === true) streamInfo.isDefault = true;
        if (/original/i.test(streamInfo.displayName) || /original/i.test(streamInfo.audioTrackId)) {
          streamInfo.isOriginal = true;
        }
      }
      result.audioStreams.push(streamInfo);
    } else if (mimeType.startsWith('video/')) {
      streamInfo.width = width;
      streamInfo.height = height;
      streamInfo.fps = fps;

      if (format.audioQuality || (width && height && itag === 18)) {
        result.combinedStreams.push(streamInfo);
      } else {
        result.videoStreams.push(streamInfo);
      }
    }
  }

  if (streamingData.hlsManifestUrl) {
    result.hlsManifestUrl = streamingData.hlsManifestUrl;
    result.isLivestream = true;
  }
  if (streamingData.dashManifestUrl) {
    result.dashManifestUrl = streamingData.dashManifestUrl;
  }

  result.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  result.videoStreams.sort((a, b) => (b.height || 0) - (a.height || 0));
  result.bestAudio = pickBestAudio(result.audioStreams);

  result.bestVideo = result.videoStreams.find(s => s.mimeType.includes('avc1'))
  || result.videoStreams[0] || null;

  result.qualityMap = {};
  const resolutions = [144, 240, 360, 480, 720, 1080, 1440, 2160];
  for (const stream of result.videoStreams) {
    if (stream.mimeType.includes('avc1')) {
      const closest = resolutions.reduce((prev, curr) =>
      Math.abs(curr - stream.height) < Math.abs(prev - stream.height) ? curr : prev
      );
      if (!result.qualityMap[closest] || stream.bitrate > result.qualityMap[closest].bitrate) {
        result.qualityMap[closest] = stream;
      }
    }
  }

  return result;
}

function parseSabrResult(raw, videoId, client) {
  const result = buildEmptyResult(videoId);
  result.usedClient = 'SABR';
  result.playabilityStatus = raw?.playabilityStatus?.status || 'OK';
  result.playabilityReason = raw?.playabilityStatus?.reason || '';
  result.isPlayable = result.playabilityStatus === 'OK';

  const sd = raw?.streamingData;
  if (!sd || !sd.serverAbrStreamingUrl) return null;

  const ustreamerConfig = raw?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig || '';

  result.sabr = {
    available: true,
    sabrUrl: sd.serverAbrStreamingUrl,
    proxyUrl: '/api/v1/proxy/sabr',
    visitorData: client.visitorData || raw?.responseContext?.visitorData || '',
    ustreamerConfig,
    formats: [],
  };

  const allFormats = sd.adaptiveFormats || [];
  for (const fmt of allFormats) {
    const itag = fmt.itag || 0;
    const mimeType = fmt.mimeType || '';
    const bitrate = fmt.bitrate || 0;
    const width = fmt.width || 0;
    const height = fmt.height || 0;
    const fps = fmt.fps || 0;
    const qualityLabel = fmt.qualityLabel || (height ? `${height}p` : '');
    const lmt = fmt.lastModified ? Number(fmt.lastModified) : 0;
    const xtags = fmt.xtags || '';
    if (fmt.isDrc || /drc/i.test(xtags)) continue;

    if (fmt.approxDurationMs) {
      result.duration = parseInt(fmt.approxDurationMs, 10);
    }

    const streamInfo = {
      itag,
      mimeType,
      bitrate,
      width,
      height,
      fps,
      qualityLabel,
      lmt,
      xtags,
      isSabr: true,
    };

    if (mimeType.startsWith('audio/')) {
      streamInfo.audioQuality = fmt.audioQuality || '';
      streamInfo.audioSampleRate = fmt.audioSampleRate || '';
      streamInfo.audioChannels = fmt.audioChannels || 2;
      streamInfo.audioTrackId = fmt.audioTrack?.id || '';
      streamInfo.displayName = fmt.audioTrack?.displayName || '';
      if (fmt.audioTrack?.audioIsDefault) streamInfo.isDefault = true;
      if (/original/i.test(streamInfo.displayName)) streamInfo.isOriginal = true;
      result.audioStreams.push(streamInfo);
    } else if (mimeType.startsWith('video/')) {
      result.videoStreams.push(streamInfo);
    }
    result.sabr.formats.push(streamInfo);
  }

  result.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  result.videoStreams.sort((a, b) => (b.height || 0) - (a.height || 0));
  result.bestAudio = pickBestAudio(result.audioStreams);
  result.bestVideo = result.videoStreams[0] || null;

  result.qualityMap = {};
  const resolutions = [144, 240, 360, 480, 720, 1080, 1440, 2160];
  for (const stream of result.videoStreams) {
    const closest = resolutions.reduce((prev, curr) =>
      Math.abs(curr - stream.height) < Math.abs(prev - stream.height) ? curr : prev
    );
    if (!result.qualityMap[closest] || stream.bitrate > result.qualityMap[closest].bitrate) {
      result.qualityMap[closest] = stream;
    }
  }

  return result;
}

export async function getStreamUrls(client, videoId, options = {}) {
  let lastError = '';

  const trySabr = options?.include_and_try_sabr === true || options?.include_and_try_sabr === 'true';
  if (trySabr && hasOAuthFile()) {
    try {
      const raw = await client.androidVrPlayer(videoId);
      const sabrResult = raw?.videoDetails?.isLive ? null : parseSabrResult(raw, videoId, client);
      if (sabrResult && sabrResult.isPlayable && (sabrResult.videoStreams.length || sabrResult.audioStreams.length)) {
        return sabrResult;
      }
    } catch (e) {
      lastError = `SABR failed: ${e.message}`;
    }
  }

  if (forceYtDlp()) {
    try {
      return await getStreamUrlsViaYtdlp(videoId);
    } catch (e) {
      const result = buildEmptyResult(videoId);
      result.error = `yt-dlp failed (FORCE-YT-DLP is enabled): ${e.message}`;
      return result;
    }
  }

  for (const attempt of [
    { key: 'VISIONOS_1_03', fetch: () => client.visionOsPlayer(videoId) },
  ]) {
    try {
      const raw = await attempt.fetch();
      const upcoming = parseUpcoming(raw, videoId, attempt.key);
      if (upcoming) return upcoming;
      if (isUsableStreamingData(raw)) {
        return parseInnertubeResult(raw, videoId, attempt.key);
      }
      lastError = raw?.playabilityStatus?.reason || raw?.playabilityStatus?.status || 'no usable streaming data';
    } catch (e) {
      lastError = e.message;
    }
  }

  if (await isYtDlpAvailable()) {
    try {
      return await getStreamUrlsViaYtdlp(videoId);
    } catch (e) {
      lastError = e.message;
    }
  } else {
    lastError = 'yt-dlp is not installed';
  }

  try {
    const raw = await client.reelPlayer(videoId);
    if (isUsableStreamingData(raw)) {
      return parseInnertubeResult(raw, videoId, 'ANDROID_REEL');
    }
    lastError = raw?.playabilityStatus?.reason || raw?.playabilityStatus?.status || 'no usable streaming data';
  } catch (e) {
    lastError = e.message;
  }

  const result = buildEmptyResult(videoId);
  result.error = `All extraction methods (VISIONOS, yt-dlp, ANDROID_REEL) failed` +
  (lastError ? ` (last error: ${lastError})` : '') +
  `. Check whether your server's IP has been blocked by YouTube, or make sure Vivid is up to date: https://github.com/Youtube-Hackers/vivid`;
  return result;
}

export async function getBestAudioUrl(client, videoId) {
  const streams = await getStreamUrls(client, videoId);
  if (streams.error) throw new Error(streams.error);
  if (!streams.bestAudio) throw new Error('No audio streams available');
  return streams.bestAudio.url;
}

export async function getCombinedStreamUrl(client, videoId) {
  const streams = await getStreamUrls(client, videoId);
  if (streams.error) throw new Error(streams.error);
  if (streams.combinedStreams.length) return streams.combinedStreams[0].url;
  throw new Error('No combined streams available');
}

export default { getStreamUrls, getBestAudioUrl, getCombinedStreamUrl };
