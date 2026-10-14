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

export function getAttributedText(obj) {
  let text = obj?.content || '';
  const runs = [...(obj?.commandRuns || [])].sort((a, b) => b.startIndex - a.startIndex);
  for (const run of runs) {
    let url = run.onTap?.innertubeCommand?.urlEndpoint?.url;
    if (!url) continue;
    try {
      const q = new URL(url).searchParams.get('q');
      if (q && /^https?:\/\//.test(q)) url = q;
    } catch {}
    text = text.slice(0, run.startIndex) + url + text.slice(run.startIndex + run.length);
  }
  return text;
}

export function getTextFromObject(obj, preserveUrls = false) {
  if (!obj) return '';
  if (obj.simpleText) return obj.simpleText;
  if (obj.runs) {
    return obj.runs.map(r => {
      const text = r.text || '';
      if (preserveUrls && r.navigationEndpoint) {
        let fullUrl = null;

        if (r.navigationEndpoint.urlEndpoint?.url) {
          fullUrl = r.navigationEndpoint.urlEndpoint.url;
        }
        else if (r.navigationEndpoint.watchEndpoint?.videoId) {
          fullUrl = `https://www.youtube.com/watch?v=${r.navigationEndpoint.watchEndpoint.videoId}`;
        }
        else if (r.navigationEndpoint.browseEndpoint?.canonicalBaseUrl) {
          fullUrl = `https://www.youtube.com${r.navigationEndpoint.browseEndpoint.canonicalBaseUrl}`;
        }

        if (fullUrl) {
          try {
            const parsed = new URL(fullUrl);
            const q = parsed.searchParams.get('q');
            if (q && (q.startsWith('http://') || q.startsWith('https://'))) {
              fullUrl = q;
            }
          } catch (_) {}
          return fullUrl;
        }
      }
      return text;
    }).join('');
  }
  if (obj.content) return obj.content;
  return '';
}

export function normalizeThumbnailUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

export function parseSuccinctVideo(renderer) {
  if (!renderer) return null;
  const videoId = renderer.videoId || '';
  const thumbs = renderer.thumbnail?.thumbnails || [];
  const rawThumb = thumbs.length ? (thumbs[thumbs.length - 1].url || '') : (videoId ? getVideoThumbnailUrl(videoId) : '');
  return {
    type: 'video',
    videoId,
    url: videoId ? `/watch?v=${videoId}` : '',
    title: getTextFromObject(renderer.title) || getTextFromObject(renderer.headline) || '',
    duration: getTextFromObject(renderer.lengthText) || '',
    publishDate: getTextFromObject(renderer.publishedTimeText) || '',
    views: getTextFromObject(renderer.shortViewCountText) || '',
    author: getTextFromObject(renderer.shortBylineText) || '',
    thumbnailUrl: normalizeThumbnailUrl(rawThumb),
  };
}

export function parseSuccinctChannel(renderer) {
  if (!renderer) return null;
  const id = renderer?.navigationEndpoint?.browseEndpoint?.browseId || '';
  const thumbs = renderer?.thumbnail?.thumbnails || [];
  const rawIcon = thumbs.length ? (thumbs[thumbs.length - 1].url || '') : getThumbnailUrlClosest(thumbs, 176);
  return {
    type: 'channel',
    id,
    name: getTextFromObject(renderer.displayName) || getTextFromObject(renderer.title) || '',
    subscribers: getTextFromObject(renderer.subscriberCountText) || '',
    videoCount: getTextFromObject(renderer.videoCountText) || '',
    iconUrl: normalizeThumbnailUrl(rawIcon),
  };
}

export function parseSuccinctPlaylist(renderer) {
  if (!renderer) return null;

  let thumbnailUrl = '';
  const thumbnails = renderer?.thumbnail?.thumbnails || renderer?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails || [];
  if (thumbnails.length) {
    thumbnailUrl = normalizeThumbnailUrl(thumbnails[thumbnails.length - 1].url || '');
  }

  let url = convertUrlToMobile(renderer?.shareUrl || '');
  if (!url.startsWith('https://m.youtube.com/watch')) {
    if (url.startsWith('https://m.youtube.com/playlist?')) {
      const params = parseQueryParams(url.split('?')[1] || '');
      const playlistId = params.list || '';
      const videoId = getVideoIdFromThumbnailUrl(thumbnailUrl);
      url = `https://m.youtube.com/watch?v=${videoId}&list=${playlistId}`;
    }
  }

  const relUrl = url.replace('https://m.youtube.com', '').replace('https://www.youtube.com', '');

  return {
    type: 'playlist',
    url: relUrl,
    title: getTextFromObject(renderer.title) || '',
    videoCount: getTextFromObject(renderer.videoCountText) || '',
    thumbnailUrl,
  };
}

export function getVideoIdByUrl(url) {
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : '';
}

export function getPlaylistIdByUrl(url) {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

export function getVideoThumbnailUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function getVideoUrlById(id) {
  return `https://m.youtube.com/watch?v=${id}`;
}

export function getVideoIdFromThumbnailUrl(url) {
  if (!url) return '';
  let match = url.match(/i\.ytimg\.com\/vi_webp\/([a-zA-Z0-9_-]+)\//);
  if (match) return match[1];
  match = url.match(/i\.ytimg\.com\/vi\/([a-zA-Z0-9_-]+)\//);
  return match ? match[1] : '';
}

export function isValidVideoId(id) {
  if (!id || id.length !== 11) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export function isYoutubeUrl(url) {
  return url && (
    url.startsWith('https://m.youtube.com/') ||
    url.startsWith('https://www.youtube.com/') ||
    url.startsWith('http://m.youtube.com/') ||
    url.startsWith('http://www.youtube.com/')
  );
}

export function convertUrlToMobile(url) {
  if (!url) return '';
  let u = url.replace(/^https?:\/\//, '');
  if (u.startsWith('www.')) {
    u = 'm.' + u.substring(4);
  }
  return 'https://' + u;
}

export function convertUrlToDesktop(url) {
  if (!url) return '';
  let u = url.replace(/^https?:\/\//, '');
  if (u.startsWith('m.')) {
    u = 'www.' + u.substring(2);
  }
  return 'https://' + u;
}

export function getThumbnailUrlClosest(thumbnails, targetWidth) {
  if (!thumbnails || !thumbnails.length) return '';
  let minDistance = 100000;
  let bestUrl = '';
  for (const thumb of thumbnails) {
    const curWidth = thumb.width || 0;
    const dist = Math.abs(targetWidth - curWidth);
    if (dist < minDistance) {
      minDistance = dist;
      bestUrl = thumb.url || '';
    }
  }
  if (bestUrl.startsWith('//')) bestUrl = 'https:' + bestUrl;
  return bestUrl;
}

export function getThumbnailUrlExact(thumbnails, targetWidth) {
  if (!thumbnails || !thumbnails.length) return '';
  const thumb = thumbnails[0];
  let iconUrl = thumb.url || '';
  const origWidth = thumb.width || 0;
  const replaceFrom = `${origWidth}-`;
  const replaceTo = `${targetWidth}-`;

  let modified = '';
  for (let i = 0; i < iconUrl.length; ) {
    if ((iconUrl[i] === 's' || iconUrl[i] === 'w') && iconUrl.substring(i + 1, i + 1 + replaceFrom.length) === replaceFrom) {
      modified += iconUrl[i] + replaceTo;
      i += 1 + replaceFrom.length;
    } else {
      modified += iconUrl[i++];
    }
  }

  if (modified.startsWith('//')) modified = 'https:' + modified;
  return modified;
}

export function convertWebpThumbnailToJpg(url) {
  if (!url) return url;
  if (url.includes('i.ytimg.com/vi_webp/')) {
    let converted = url.replace('/vi_webp/', '/vi/');
    converted = converted.replace('.webp', '.jpg');
    return converted;
  }
  return url;
}

export function parseQueryParams(input) {
  if (!input) return {};
  const res = {};
  for (const part of input.split('&')) {
    const [key, ...rest] = part.split('=');
    res[decodeURIComponent(key)] = decodeURIComponent(rest.join('='));
  }
  return res;
}

export function getPageType(url) {
  const u = convertUrlToMobile(url);
  if (u.match(/https:\/\/m\.youtube\.com\/watch\?/)) return 'video';
  if (u.match(/https:\/\/m\.youtube\.com\/(user|channel|c|@)/)) return 'channel';
  if (u.match(/https:\/\/m\.youtube\.com\/results\?/)) return 'search';
  return 'invalid';
}

export function extractStreamLength(url) {
  const match = url.match(/[?&]clen=(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

export function formatCount(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return String(count);
}

export function formatWithCommas(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function extractInitialData(html) {
  const patterns = [
    /var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s,
    /window\["ytInitialData"\]\s*=\s*(\{.+?\});\s*<\/script>/s,
    /ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        continue;
      }
    }
  }

  const idx = html.indexOf('ytInitialData');
  if (idx !== -1) {
    const eqIdx = html.indexOf('=', idx);
    if (eqIdx !== -1) {
      let start = eqIdx + 1;
      while (start < html.length && html[start] === ' ') start++;
      if (html[start] === '{' || html[start] === "'") {
        try {
          const jsonStr = extractJsonFromHtml(html, start);
          if (jsonStr) return JSON.parse(jsonStr);
        } catch (e) {
        }
      }
    }
  }

  return null;
}

function extractJsonFromHtml(html, start) {
  if (html[start] !== '{' && html[start] !== '[') return null;
  let level = 0;
  let inString = false;
  let i = start;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '"' && (i === 0 || html[i - 1] !== '\\')) {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{' || ch === '[') level++;
      else if (ch === '}' || ch === ']') {
        level--;
        if (level === 0) break;
      }
    }
  }
  if (level !== 0) return null;
  return html.substring(start, i + 1);
}
