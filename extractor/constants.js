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

export const API_URL = 'https://www.youtube.com/youtubei/v1/';
export const MOBILE_API_URL = 'https://m.youtube.com/youtubei/v1/';

export function getInnertubeApiUrl(apiName) {
  return `${MOBILE_API_URL}${apiName}?prettyPrint=false`;
}

export const MWEB = {
  clientName: 'MWEB',
  clientId: '2',
  clientVersion: '2.20260820.08.00',
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  apiUrl: MOBILE_API_URL,
};

export const ANDROID = {
  clientName: 'ANDROID',
  clientId: '3',
  clientVersion: '21.12.525',
  userAgent: 'com.google.android.youtube/19.51.37 (Linux; U; Android 14; de_DE; Quest 3) gzip',
  osName: 'Android',
  osVersion: '14',
  androidSdkVersion: '34',
  apiUrl: API_URL,
};

export const ANDROID_REEL = {
  clientName: 'ANDROID',
  clientVersion: '20.44.38',
  clientId: '3',
  osName: 'Android',
  osVersion: '12',
  deviceMake: 'Samsung',
  deviceModel: 'SM-G998B',
  androidSdkVersion: '32',
  userAgent: 'com.google.android.youtube/20.44.38 (Linux; U; Android 12; en_US; SM-G998B; Build/SP1A.210812.016)',
  usePlayerEndpoint: false,
  apiUrl: 'https://youtubei.googleapis.com/youtubei/v1/',
  apiUrl: API_URL,
};

export const ANDROID_VR = {
  clientName: 'ANDROID_VR',
  clientId: '28',
  clientVersion: '1.73.21',
  package: 'com.google.android.apps.youtube.vr.pico',
  deviceMake: 'Pico',
  deviceModel: 'A8110',
  osName: 'Android',
  osVersion: '10',
  androidSdkVersion: '29',
  buildId: '5.13.7',
  userAgent: 'com.google.android.apps.youtube.vr.pico/1.73.21 (Linux; U; Android 10; en_US; A8110 Build/5.13.7)',
  apiUrl: 'https://youtubei.googleapis.com/youtubei/v1/',
};

export const VISIONOS = {
  clientName: 'VISIONOS',
  clientId: '101',
  clientVersion: '1.03',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice14,1',
  osName: 'visionOS',
  osVersion: '1.03',
  userAgent: 'com.google.ios.youtube/1.3 (RealityDevice14,1; U; CPU visionOS 1.3 like Mac OS X)',
  apiUrl: 'https://www.youtube.com/youtubei/v1/',
};

export const WEB = {
  clientName: 'WEB',
  clientId: '1',
  clientVersion: '2.20260820.08.00',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0',
  apiUrl: API_URL,
};

export const DEFAULT_LANG = 'en';
export const DEFAULT_COUNTRY = 'US';

export const LANG_TO_COUNTRY = {
  en: 'US',
  ja: 'JP',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  es: 'MX',
};

export const SEARCH_FILTERS = {
  uploadDate: {
    hour: 'EgIIAQ%3D%3D',
    today: 'EgIIAg%3D%3D',
    week: 'EgIIAw%3D%3D',
    month: 'EgIIBA%3D%3D',
    year: 'EgIIBQ%3D%3D',
  },
  type: {
    video: 'EgIQAQ%3D%3D',
    channel: 'EgIQAg%3D%3D',
    playlist: 'EgIQAw%3D%3D',
    movie: 'EgIQBA%3D%3D',
  },
  duration: {
    short: 'EgIYAQ%3D%3D',
    medium: 'EgIYAw%3D%3D',
    long: 'EgIYAg%3D%3D',
  },
  sortBy: {
    relevance: 'CAASAhAB',
    date: 'CAI%3D',
    views: 'CAM%3D',
    rating: 'CAE%3D',
  },
  features: {
    live: 'EgJAAQ%3D%3D',
    hd: 'EgIgAQ%3D%3D',
    subtitles: 'EgIoAQ%3D%3D',
    creativeCommons: 'EgIwAQ%3D%3D',
    '360': 'EgJ4AQ%3D%3D',
    vr180: 'EgPQAQE%3D',
    '3d': 'EgI4AQ%3D%3D',
    hdr: 'EgPIAQE%3D',
    '4k': 'EgJAAQ%3D%3D',
    location: 'EgO4AQE%3D',
  },
};

export function buildSearchParams(filters = {}) {
  if (filters.sortBy && !filters.uploadDate && !filters.type && !filters.duration) {
    return SEARCH_FILTERS.sortBy[filters.sortBy] || null;
  }
  if (filters.uploadDate && !filters.sortBy && !filters.type && !filters.duration) {
    return SEARCH_FILTERS.uploadDate[filters.uploadDate] || null;
  }
  if (filters.type && !filters.sortBy && !filters.uploadDate && !filters.duration) {
    return SEARCH_FILTERS.type[filters.type] || null;
  }
  if (filters.duration && !filters.sortBy && !filters.uploadDate && !filters.type) {
    return SEARCH_FILTERS.duration[filters.duration] || null;
  }

  const parts = [];
  const sortMap = { relevance: 0, date: 2, views: 3, rating: 1 };
  const sortValue = sortMap[filters.sortBy] || 0;
  if (sortValue) {
    parts.push(0x08, sortValue);
  }

  const filterParts = [];

  const dateMap = { hour: 1, today: 2, week: 3, month: 4, year: 5 };
  if (filters.uploadDate && dateMap[filters.uploadDate]) {
    filterParts.push(0x08, dateMap[filters.uploadDate]);
  }

  const typeMap = { video: 1, channel: 2, playlist: 3, movie: 4 };
  if (filters.type && typeMap[filters.type]) {
    filterParts.push(0x10, typeMap[filters.type]);
  }

  const durationMap = { short: 1, long: 2, medium: 3 };
  if (filters.duration && durationMap[filters.duration]) {
    filterParts.push(0x18, durationMap[filters.duration]);
  }

  if (filters.features) {
    const featureBits = {
      hd: [0x20, 0x01],
      subtitles: [0x28, 0x01],
      creativeCommons: [0x30, 0x01],
      '3d': [0x38, 0x01],
      live: [0x40, 0x01],
      '4k': [0x70, 0x01],
      '360': [0x78, 0x01],
      hdr: [0xc8, 0x01, 0x01],
      vr180: [0xd0, 0x01, 0x01],
    };
    for (const feature of filters.features) {
      if (featureBits[feature]) {
        filterParts.push(...featureBits[feature]);
      }
    }
  }

  if (filterParts.length > 0) {
    parts.push(0x12, filterParts.length, ...filterParts);
  }

  if (parts.length === 0) return null;

  const bytes = new Uint8Array(parts);
  return encodeURIComponent(Buffer.from(bytes).toString('base64'));
}
