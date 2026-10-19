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
import { MWEB, WEB, TVHTML5, TVHTML5_SIMPLY } from './constants.js';
import { mintCynTokens, getPlayerCode, decipherStream } from './absolutesolver/index.js';
import { parseStoryboards } from './storyboards.js';
import { cacheCaptionTracks } from './captions.js';

function isForceSabr() {
  const v = process.env.FORCE_SABR || process.env['FORCE-SABR'];
  return v === 'true' || v === '1' || v === 'yes';
}

function isDisableSabr() {
  const v = process.env.DISABLE_SABR || process.env['DISABLE-SABR'];
  return v === 'true' || v === '1' || v === 'yes';
}

function getSpecialClientRetry() {
  const v = process.env.SPECIAL_CLIENT_RETRY || process.env['SPECIAL-CLIENT-RETRY'];
  const parsed = parseInt(v, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

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
    storyboards: null,
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
  return !!(hasFormats || sd.hlsManifestUrl || sd.serverAbrStreamingUrl);
}

function parseInnertubeResult(data, videoId, usedClient, decipherFn = null, poToken = '') {
  const result = buildEmptyResult(videoId);
  result.usedClient = usedClient;

  result.cpn = data.cpn || '';
  result.playabilityStatus = data?.playabilityStatus?.status || '';
  result.playabilityReason = data?.playabilityStatus?.reason || '';
  result.isPlayable = result.playabilityStatus === 'OK';
  result.storyboards = parseStoryboards(data?.storyboards || data?.playerResponse?.storyboards);

  if (data?.captions?.playerCaptionsTracklistRenderer) {
    try { cacheCaptionTracks(videoId, data.captions.playerCaptionsTracklistRenderer); } catch {}
  }

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
    let url = '';
    if (decipherFn) {
      try {
        url = decipherFn(format);
      } catch {}
    }
    if (!url && format.url) {
      url = decodeURIComponent(format.url);
    }
    if (!url) continue;
    if (poToken && !url.includes('pot=')) {
      url += (url.includes('?') ? '&' : '?') + `pot=${encodeURIComponent(poToken)}`;
    }
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
        if (track.audioIsDefault === true || format.isDefaultAudioTrack === true) streamInfo.isDefault = true;
        if (/original/i.test(streamInfo.displayName) || /original/i.test(streamInfo.audioTrackId)) {
          streamInfo.isOriginal = true;
        }
      } else if (format.isDefaultAudioTrack === true) {
        streamInfo.isDefault = true;
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

  if ((data?.videoDetails?.isLive || result.isLivestream) && !result.hlsManifestUrl) {
    result.videoStreams = [];
    result.audioStreams = [];
    result.combinedStreams = [];
  }

  result.audioStreams.sort((a, b) => {
    const aScore = (a.isDefault ? 2 : (a.isOriginal ? 1 : 0));
    const bScore = (b.isDefault ? 2 : (b.isOriginal ? 1 : 0));
    if (aScore !== bScore) return bScore - aScore;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
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

function parseSabrResult(raw, videoId, client, poToken = '', decipherFn = null, clientConfig = null) {
  const result = buildEmptyResult(videoId);
  result.usedClient = 'SABR';
  result.playabilityStatus = raw?.playabilityStatus?.status || 'OK';
  result.playabilityReason = raw?.playabilityStatus?.reason || '';
  result.isPlayable = result.playabilityStatus === 'OK';
  result.storyboards = parseStoryboards(raw?.storyboards || raw?.playerResponse?.storyboards);

  if (raw?.captions?.playerCaptionsTracklistRenderer) {
    try { cacheCaptionTracks(videoId, raw.captions.playerCaptionsTracklistRenderer); } catch {}
  }

  const sd = raw?.streamingData;
  if (!sd || !sd.serverAbrStreamingUrl) return null;

  let sabrUrl = sd.serverAbrStreamingUrl;
  if (decipherFn) {
    try {
      sabrUrl = decipherFn({ url: sabrUrl }, false);
    } catch {}
  }

  const ustreamerConfig = raw?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig || '';

  const cName = clientConfig?.clientName || client?.clientName || (typeof client === 'string' ? client : 'ANDROID_VR');
  const cVer = clientConfig?.clientVersion || client?.clientVersion || '1.73.21';
  const cUa = clientConfig?.userAgent || client?.userAgent || '';

  result.sabr = {
    available: true,
    videoId,
    sabrUrl,
    proxyUrl: '/api/v1/proxy/sabr',
    visitorData: client.visitorData || raw?.responseContext?.visitorData || '',
    ustreamerConfig,
    poToken,
    clientName: cName,
    clientVersion: cVer,
    userAgent: cUa,
    cpn: raw?.cpn || result.cpn || '',
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
      if (fmt.isDefaultAudioTrack || fmt.audioTrack?.audioIsDefault) streamInfo.isDefault = true;
      if (/original/i.test(streamInfo.displayName) || /original/i.test(streamInfo.audioTrackId)) streamInfo.isOriginal = true;
      result.audioStreams.push(streamInfo);
    } else if (mimeType.startsWith('video/')) {
      result.videoStreams.push(streamInfo);
    }
    result.sabr.formats.push(streamInfo);
  }

  result.audioStreams.sort((a, b) => {
    const aScore = (a.isDefault ? 2 : (a.isOriginal ? 1 : 0));
    const bScore = (b.isDefault ? 2 : (b.isOriginal ? 1 : 0));
    if (aScore !== bScore) return bScore - aScore;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
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

const MWEB_COMPAT_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel Tablet Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Safari/537.36';
let _mwebPageCache = null;
async function getMwebPageInfo() {
  if (_mwebPageCache && Date.now() - _mwebPageCache.t < 3600_000) return _mwebPageCache;
  const info = { t: Date.now(), clientVersion: '', visitorData: '' };
  try {
    const { default: fetch } = await import('node-fetch');
    const { getProxyAgent } = await import('./proxyManager.js');
    const args = { headers: { 'User-Agent': MWEB_COMPAT_UA } };
    const agent = getProxyAgent();
    if (agent) args.agent = agent;
    const html = await (await fetch('https://m.youtube.com/', args)).text();
    info.clientVersion = (html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/) || [])[1] || '';
    info.visitorData = (html.match(/"visitorData":\s*"([^"]+)"/) || [])[1] || '';
  } catch {}
  _mwebPageCache = info;
  return info;
}

export async function extractJsClient(client, videoId, clientKey, trySabr) {
  if (client?.initPromise) {
    try { await client.initPromise; } catch {}
  }
  let targetKey = clientKey;
  if (!trySabr && (targetKey === 'tv' || targetKey === 'tvhtml5')) {
    targetKey = 'tv_simply';
  }
  const isTv = targetKey === 'tv' || targetKey === 'tvhtml5';
  const isTvSimply = targetKey === 'tv_simply' || targetKey === 'tvhtml5_simply';
  const clientConfig = targetKey === 'mweb' ? MWEB : (targetKey === 'web' ? WEB : (isTvSimply ? TVHTML5_SIMPLY : TVHTML5));
  const userAgent = clientConfig.userAgent;
  const player = await getPlayerCode(isTvSimply ? 'tv_simply' : (isTv ? 'tv' : targetKey), userAgent);

  if (!client.visitorData) {
    if (isTv || isTvSimply) {
      await client.fetchTvVisitorData?.();
    } else {
      await client.fetchVisitorData?.();
    }
  }

  let mwebCompat = null;
  if (targetKey === 'mweb') {
    const pg = await getMwebPageInfo();
    mwebCompat = {
      clientVersion: pg.clientVersion || clientConfig.clientVersion,
      visitorData: pg.visitorData || '',
      userAgent: MWEB_COMPAT_UA,
    };
  }

  let cyn = null;
  try {
    cyn = await mintCynTokens(videoId, (mwebCompat?.visitorData || client.visitorData || ''), {
      clientKey: isTvSimply ? 'tv_simply' : (isTv ? 'tv' : targetKey),
                              clientVersion: mwebCompat?.clientVersion || clientConfig.clientVersion,
                              userAgent: mwebCompat?.userAgent || userAgent
    });
  } catch {}

  const playerPoToken = cyn?.playerCynToken || cyn?.cynToken || '';
  const sabrPoToken = cyn?.sabrCynToken || playerPoToken;

  let raw;
  if (targetKey === 'mweb') {
    raw = await client.mwebPlayer(videoId, { sts: player.sts, poToken: playerPoToken, mwebPlayerCompat: true, ...mwebCompat });
  } else if (targetKey === 'web') {
    raw = await client.webPlayer(videoId, { sts: player.sts, poToken: playerPoToken });
  } else if (isTvSimply) {
    raw = await client.tvSimplyPlayer(videoId, { sts: player.sts, poToken: playerPoToken });
  } else {
    raw = await client.tvPlayer(videoId, { sts: player.sts, poToken: playerPoToken });
  }

  const upcoming = parseUpcoming(raw, videoId, clientConfig.clientName);
  if (upcoming) return upcoming;

  const streamPoToken = targetKey === 'mweb' ? (playerPoToken || sabrPoToken) : (sabrPoToken || playerPoToken);
  const decipherFn = (fmt, addPot = true) => {
    let u = decipherStream(targetKey, player.code, fmt, streamPoToken, targetKey, addPot);
    if (mwebCompat?.clientVersion && u) u = u.replace(/([?&]cver=)[^&]*/, `$1${mwebCompat.clientVersion}`);
    return u;
  };
  if (process.env.VIVID_DEBUG_MWEB && targetKey === 'mweb') {
    const f = (raw?.streamingData?.adaptiveFormats || [])[0];
    let q = '';
    try { q = new URL(f?.url || 'https://x/?').searchParams; } catch {}
    console.error('[MWEB-DEBUG]', JSON.stringify({
      compat: mwebCompat, playerPotLen: playerPoToken.length, sabrPotLen: sabrPoToken.length,
      usedPotLen: streamPoToken.length, status: raw?.playabilityStatus?.status,
      rawUrlHas: q ? { epbp: q.has('epbp'), pcm2: q.has('pcm2'), c: q.get('c'), sparams: q.get('sparams') } : null,
    }));
  }

  if (trySabr && !isTvSimply && raw?.streamingData?.serverAbrStreamingUrl && !raw?.videoDetails?.isLive) {
    const sabrResult = parseSabrResult(raw, videoId, client, sabrPoToken, decipherFn, clientConfig);
    if (sabrResult && sabrResult.isPlayable && (sabrResult.videoStreams.length || sabrResult.audioStreams.length)) {
      return sabrResult;
    }
  }

  if (isUsableStreamingData(raw)) {
    const res = parseInnertubeResult(raw, videoId, clientConfig.clientName, decipherFn, streamPoToken);
    if (res.videoStreams.length || res.audioStreams.length || res.combinedStreams.length || res.hlsManifestUrl) {
      return res;
    }
  }

  return null;
}

export async function getStreamUrls(client, videoId, options = {}) {
  let lastError = '';

  const reqClient = (options?.client || '').toLowerCase();
  const isTvSimplyRequested = reqClient === 'tv_simply' || reqClient === 'tvhtml5_simply';
  const isTvRequested = reqClient === 'tv' || reqClient === 'tvhtml5';
  const isMwebRequested = reqClient === 'mweb';
  const isWebRequested = reqClient === 'web';
  const isAndroidVrRequested = reqClient === 'android_vr' || reqClient === 'androidvr';
  const isVisionOsRequested = reqClient === 'visionos';
  const trySabr = !isTvSimplyRequested && (options?.include_and_try_sabr === true || options?.include_and_try_sabr === 'true' || isForceSabr()) && !isDisableSabr();

  if (forceYtDlp()) {
    try {
      return await getStreamUrlsViaYtdlp(videoId);
    } catch (e) {
      const result = buildEmptyResult(videoId);
      result.error = `yt-dlp failed (FORCE-YT-DLP is enabled): ${e.message}`;
      return result;
    }
  }

  if (isTvSimplyRequested) {
    try {
      const tvRes = await extractJsClient(client, videoId, 'tv_simply', false);
      if (tvRes) return tvRes;
    } catch (e) {
      lastError = `TVHTML5_SIMPLY failed: ${e.message}`;
    }
  }

  if (isTvRequested) {
    try {
      const tvRes = await extractJsClient(client, videoId, trySabr ? 'tv' : 'tv_simply', trySabr);
      if (tvRes) return tvRes;
    } catch (e) {
      lastError = `${trySabr ? 'TVHTML5' : 'TVHTML5_SIMPLY'} failed: ${e.message}`;
    }
  }

  if (isAndroidVrRequested && hasOAuthFile()) {
    try {
      const raw = await client.androidVrPlayer(videoId);
      const sabrResult = raw?.videoDetails?.isLive ? null : parseSabrResult(raw, videoId, client);
      if (sabrResult && sabrResult.isPlayable && (sabrResult.videoStreams.length || sabrResult.audioStreams.length)) {
        return sabrResult;
      }
    } catch (e) {
      lastError = `ANDROID_VR_SABR failed: ${e.message}`;
    }
  }

  if (isVisionOsRequested) {
    try {
      const raw = await client.visionOsPlayer(videoId);
      const upcoming = parseUpcoming(raw, videoId, 'VISIONOS');
      if (upcoming) return upcoming;
      if (isUsableStreamingData(raw)) {
        const res = parseInnertubeResult(raw, videoId, 'VISIONOS');
        if (res.videoStreams.length || res.audioStreams.length || res.combinedStreams.length || res.hlsManifestUrl) {
          return res;
        }
      }
    } catch (e) {
      lastError = `VISIONOS failed: ${e.message}`;
    }
  }

  if (trySabr) {
    if (isMwebRequested) {
      try {
        const mwebRes = await extractJsClient(client, videoId, 'mweb', true);
        if (mwebRes) return mwebRes;
      } catch (e) {
        lastError = `MWEB client failed: ${e.message}`;
      }
    }

    try {
      const webRes = await extractJsClient(client, videoId, 'web', true);
      if (webRes) return webRes;
    } catch (e) {
      lastError = `WEB client failed: ${e.message}`;
    }

    try {
      const mwebRes = await extractJsClient(client, videoId, 'mweb', true);
      if (mwebRes) return mwebRes;
    } catch (e) {
      lastError = `MWEB client failed: ${e.message}`;
    }

    try {
      const raw = await client.visionOsPlayer(videoId);
      const upcoming = parseUpcoming(raw, videoId, 'VISIONOS');
      if (upcoming) return upcoming;
      if (isUsableStreamingData(raw)) {
        const res = parseInnertubeResult(raw, videoId, 'VISIONOS');
        if (res.videoStreams.length || res.audioStreams.length || res.combinedStreams.length || res.hlsManifestUrl) {
          return res;
        }
      }
    } catch (e) {
      lastError = `VISIONOS failed: ${e.message}`;
    }

    if (hasOAuthFile()) {
      try {
        const raw = await client.androidVrPlayer(videoId);
        const sabrResult = raw?.videoDetails?.isLive ? null : parseSabrResult(raw, videoId, client);
        if (sabrResult && sabrResult.isPlayable && (sabrResult.videoStreams.length || sabrResult.audioStreams.length)) {
          return sabrResult;
        }
      } catch (e) {
        lastError = `ANDROID_VR_SABR failed: ${e.message}`;
      }
    }

    try {
      const tvRes = await extractJsClient(client, videoId, 'tv_simply', false);
      if (tvRes) return tvRes;
    } catch (e) {
      lastError = `TVHTML5_SIMPLY failed: ${e.message}`;
    }

    if (await isYtDlpAvailable()) {
      try {
        return await getStreamUrlsViaYtdlp(videoId);
      } catch (e) {
        lastError = `yt-dlp failed: ${e.message}`;
      }
    }

    try {
      const raw = await client.reelPlayer(videoId);
      if (isUsableStreamingData(raw)) {
        return parseInnertubeResult(raw, videoId, 'ANDROID_REEL');
      }
    } catch (e) {
      lastError = `ANDROID_REEL failed: ${e.message}`;
    }
  } else {
    if (isWebRequested) {
      try {
        const webRes = await extractJsClient(client, videoId, 'web', false);
        if (webRes && !webRes.sabr?.available) {
          return webRes;
        }
      } catch (e) {
        lastError = `WEB client failed: ${e.message}`;
      }
    }

    try {
      const tvRes = await extractJsClient(client, videoId, 'tv_simply', false);
      if (tvRes) return tvRes;
    } catch (e) {
      lastError = `TVHTML5_SIMPLY failed: ${e.message}`;
    }

    const specialRetries = getSpecialClientRetry();
    for (let i = 0; i <= specialRetries; i++) {
      try {
        const mwebRes = await extractJsClient(client, videoId, 'mweb', false);
        if (mwebRes && !mwebRes.sabr?.available) {
          return mwebRes;
        }
      } catch (e) {
        lastError = `MWEB attempt ${i + 1} failed: ${e.message}`;
      }
    }

    try {
      const raw = await client.visionOsPlayer(videoId);
      const upcoming = parseUpcoming(raw, videoId, 'VISIONOS');
      if (upcoming) return upcoming;
      if (isUsableStreamingData(raw)) {
        const res = parseInnertubeResult(raw, videoId, 'VISIONOS');
        if (res.videoStreams.length || res.audioStreams.length || res.combinedStreams.length || res.hlsManifestUrl) {
          return res;
        }
      }
    } catch (e) {
      lastError = `VISIONOS failed: ${e.message}`;
    }

    if (hasOAuthFile()) {
      try {
        const raw = await client.androidVrPlayer(videoId);
        const sabrResult = raw?.videoDetails?.isLive ? null : parseSabrResult(raw, videoId, client);
        if (sabrResult && sabrResult.isPlayable && (sabrResult.videoStreams.length || sabrResult.audioStreams.length)) {
          return sabrResult;
        }
      } catch (e) {
        lastError = `ANDROID_VR_SABR failed: ${e.message}`;
      }
    }

    if (await isYtDlpAvailable()) {
      try {
        return await getStreamUrlsViaYtdlp(videoId);
      } catch (e) {
        lastError = `yt-dlp failed: ${e.message}`;
      }
    }

    try {
      const raw = await client.reelPlayer(videoId);
      if (isUsableStreamingData(raw)) {
        return parseInnertubeResult(raw, videoId, 'ANDROID_REEL');
      }
    } catch (e) {
      lastError = `ANDROID_REEL failed: ${e.message}`;
    }
  }

  const result = buildEmptyResult(videoId);
  result.error = `All extraction methods failed` +
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
