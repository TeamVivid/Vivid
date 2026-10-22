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

import { Agent, setGlobalDispatcher } from 'undici';
try {
  setGlobalDispatcher(new Agent({ maxHeaderSize: 65536 }));
} catch {}

import fetch from 'node-fetch';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MWEB, ANDROID, ANDROID_REEL, VISIONOS, ANDROID_VR, WEB, WEB_CREATOR, TVHTML5, TVHTML5_SIMPLY, getInnertubeApiUrl, API_URL, MOBILE_API_URL, DEFAULT_LANG, DEFAULT_COUNTRY, LANG_TO_COUNTRY } from './constants.js';
import { getProxyAgent } from './proxyManager.js';
import { getVrAuthorization, hasOAuthFile } from './androidVrAuth.js';
import { getCookieHeader, getAuthHeader, getActiveAccount, getAccountCount, rotateAccount } from './cookies.js';
import { getPlayerCode } from './absolutesolver/playerLoader.js';

const requestStore = new AsyncLocalStorage();

export function runWithRequestContext(fn) {
  return requestStore.run({ visitorData: null, visitorPromise: null }, fn);
}

const isBotCheck = (data) => /sign in to confirm/i.test(data?.playabilityStatus?.reason || '');

async function fetchWith403Retry(url, fetchArgs, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, fetchArgs);
      if (res.status === 403 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries && (err.message?.includes('403') || err.code === 'ECONNRESET')) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
}

class InnerTubeClient {
  constructor(options = {}) {
    this.language = options.language || DEFAULT_LANG;
    this.country = options.country || LANG_TO_COUNTRY[options.language] || DEFAULT_COUNTRY;
    this.visitorData = null;
    this.basePlayers = new Map();
    this.initPromise = this.refreshClientVersions();
    setInterval(() => this.refreshClientVersions(), 6 * 60 * 60 * 1000).unref();
  }

  get visitorData() {
    const store = requestStore.getStore();
    return store ? store.visitorData : this.sharedVisitorData;
  }

  set visitorData(value) {
    const store = requestStore.getStore();
    if (store) store.visitorData = value;
    else this.sharedVisitorData = value;
  }

  async refreshClientVersions() {
    await Promise.allSettled([
      this.refreshWebVersion(),
                             this.refreshMwebVersion()
    ]);
  }

  async refreshWebVersion() {
    try {
      const fetchArgs = { headers: { 'User-Agent': WEB.userAgent, 'Accept-Language': 'en' } };
      const agent = getProxyAgent();
      if (agent) fetchArgs.agent = agent;
      const res = await fetch('https://www.youtube.com/', fetchArgs);
      const html = await res.text();
      const match = html.match(/"(?:INNERTUBE_CLIENT_VERSION|INNERTUBE_CONTEXT_CLIENT_VERSION|clientVersion)":\s*"([^"]+)"/);
      if (match && match[1]) WEB.clientVersion = match[1];
    } catch (e) {
      console.error('[InnerTube] Failed to fetch WEB version:', e.message);
    }
  }

  async refreshMwebVersion() {
    try {
      const fetchArgs = { headers: { 'User-Agent': MWEB.userAgent, 'Accept-Language': 'en' } };
      const agent = getProxyAgent();
      if (agent) fetchArgs.agent = agent;
      const res = await fetch('https://m.youtube.com/', fetchArgs);
      const html = await res.text();
      const match = html.match(/"(?:INNERTUBE_CLIENT_VERSION|INNERTUBE_CONTEXT_CLIENT_VERSION|clientVersion)":\s*"([^"]+)"/);
      if (match && match[1]) MWEB.clientVersion = match[1];
    } catch (e) {
      console.error('[InnerTube] Failed to fetch MWEB version:', e.message);
    }
  }

  setLanguage(langCode) {
    this.language = langCode;
    const mapping = {
      'en': 'US',
      'ja': 'JP',
      'de': 'DE',
      'fr': 'FR',
      'it': 'IT',
      'es': 'MX'
    };
    this.country = mapping[langCode] || 'US';
  }

  _makeContext(client, originalUrl = null) {
    if (client.minimalContext) {
      const vd = client.visitorDataOverride || this.visitorData;
      const c = {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: this.language,
        gl: this.country,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
      };
      if (vd) c.visitorData = vd;
      return { client: c };
    }
    const ctx = {
      client: {
        hl: this.language,
        gl: this.country,
        clientName: client.clientName,
        clientVersion: client.clientVersion,
      }
    };

    if (client.osName) ctx.client.osName = client.osName;
    if (client.osVersion) ctx.client.osVersion = client.osVersion;
    if (client.androidSdkVersion) ctx.client.androidSdkVersion = String(client.androidSdkVersion);
    if (client.platform) ctx.client.platform = client.platform;
    if (client.deviceMake) ctx.client.deviceMake = client.deviceMake;
    if (client.deviceModel) ctx.client.deviceModel = client.deviceModel;
    if (this.visitorData) ctx.client.visitorData = this.visitorData;

    if (client.clientName === 'MWEB' || client.clientName === 'WEB') {
      Object.assign(ctx.client, {
        userAgent: `${client.userAgent},gzip(gfe)`,
                    originalUrl: originalUrl || `${client.origin}/`,
                    playerType: 'UNIPLAYER',
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    utcOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      if (client.clientFormFactor) ctx.client.clientFormFactor = client.clientFormFactor;
      if (client.browserName) ctx.client.browserName = client.browserName;
      if (client.browserVersion) ctx.client.browserVersion = client.browserVersion;
      ctx.user = { lockedSafetyMode: false };
      ctx.request = { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] };
    }

    return ctx;
  }

  _headers(client, account = null) {
    const isBrowserClient = client.clientName === 'MWEB' || client.clientName === 'WEB';
    const headers = {
      'Content-Type': 'application/json',
      'Accept-Language': isBrowserClient
      ? `${this.language}-${this.country},${this.language};q=0.9,en;q=0.7`
      : `${this.language};q=0.9`,
      'User-Agent': client.userAgent,
    };

    if (isBrowserClient) {
      headers['Accept'] = '*/*';
      headers['Sec-Fetch-Dest'] = 'empty';
      headers['Sec-Fetch-Mode'] = 'same-origin';
      headers['Sec-Fetch-Site'] = 'same-origin';
      headers['X-Youtube-Bootstrap-Logged-In'] = 'false';
    }

    if (client.origin) {
      headers['Origin'] = client.origin;
      headers['Referer'] = client.pageUrl ? (client.pageUrl.endsWith('/') ? client.pageUrl : client.pageUrl + '/') : (client.origin + '/');
    } else if (client.clientName === 'MWEB') {
      headers['Origin'] = 'https://m.youtube.com';
      headers['Referer'] = 'https://m.youtube.com/';
    } else if (client.clientName === 'WEB') {
      headers['Origin'] = 'https://www.youtube.com';
      headers['Referer'] = 'https://www.youtube.com/';
    }

    if (client.clientName === 'WEB' || client.clientName === 'MWEB' || client.clientName === 'TVHTML5_SIMPLY' || client.clientName === 'TVHTML5') {
      headers['X-YouTube-Client-Name'] = client.clientId;
      headers['X-YouTube-Client-Version'] = client.clientVersion;
      const cookieHeader = account ? getCookieHeader(account) : null;
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
        if (client.clientName !== 'TVHTML5_SIMPLY') {
          const origin = headers['Origin'] || 'https://www.youtube.com';
          const auth = getAuthHeader(origin, null, account);
          if (auth) {
            headers['Authorization'] = auth;
            headers['X-Origin'] = origin;
            headers['X-Goog-AuthUser'] = '0';
            headers['X-Youtube-Bootstrap-Logged-In'] = 'true';
          }
        }
      }
    }

    if (client.clientName === 'VISIONOS' || client.clientName === 'ANDROID') {
      headers['X-Goog-Api-Format-Version'] = '2';
      headers['X-Youtube-Client-Name'] = client.clientName;
      headers['X-Youtube-Client-Version'] = client.clientVersion;
    }

    const vdHeader = client.visitorDataOverride || this.visitorData;
    if (vdHeader) {
      headers[client.clientName === 'MWEB' && !client.minimalContext ? 'X-Goog-EOM-Visitor-Id' : 'X-Goog-Visitor-Id'] = vdHeader;
    }

    return headers;
  }

  async ensureRequestVisitorData() {
    if (requestStore.getStore() && !this.visitorData) await this.fetchVisitorData();
  }

  async _post(url, body, client = MWEB, extraHeaders = {}, agent = undefined) {
    await this.ensureRequestVisitorData();
    const isPlayer = url.split('?')[0].endsWith('/player');
    for (let attempt = 1; ; attempt++) {
      const account = isPlayer ? getActiveAccount() : null;
      const result = await this._postOnce(url, body, client, extraHeaders, agent, account);
      if (!account || !isBotCheck(result) || attempt >= getAccountCount()) return result;
      rotateAccount(account);
    }
  }

  async _postOnce(url, body, client, extraHeaders, agent, account) {
    const headers = { ...this._headers(client, account), ...extraHeaders };
    const fetchArgs = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };
    const useAgent = agent !== undefined ? agent : getProxyAgent();
    if (useAgent) {
      fetchArgs.agent = useAgent;
    }
    const res = await fetchWith403Retry(url, fetchArgs);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`InnerTube POST ${url}: ${res.status} - ${text.substring(0, 800)}`);
    }

    const result = await res.json();

    const vd = result?.responseContext?.visitorData;
    if (vd) {
      this.visitorData = vd;
    }

    return result;
  }

  async _get(url, extraHeaders = {}) {
    const headers = {
      'Accept-Language': `${this.language};q=0.9`,
      'User-Agent': MWEB.userAgent,
      ...extraHeaders,
    };

    const fetchArgs = { headers };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;

    const res = await fetchWith403Retry(url, fetchArgs);

    if (!res.ok) {
      throw new Error(`InnerTube GET ${url}: ${res.status}`);
    }

    return res;
  }

  async fetchVisitorData() {
    const store = requestStore.getStore();
    if (!store) return this.fetchVisitorData0();
    store.visitorPromise ??= this.fetchVisitorData0();
    return store.visitorPromise;
  }

  async fetchVisitorData0() {
    try {
      const fetchArgs = {
        headers: {
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
        }
      };
      const agent = getProxyAgent();
      if (agent) fetchArgs.agent = agent;
      const res = await fetchWith403Retry('https://www.youtube.com/sw.js_data', fetchArgs);
      const text = await res.text();
      const cleaned = text.replace(/^\)\]\}'\n/, '');
      const json = JSON.parse(cleaned);
      const visitorData = json?.[0]?.[2]?.[0]?.[0]?.[13];
      if (visitorData) {
        this.visitorData = visitorData;
      }
      return visitorData || null;
  } catch (e) {
    console.error('[InnerTube] Failed to fetch visitor data:', e.message);
    return null;
  }
}

async search(query, params = null, continuation = null, client = WEB) {
  const body = {
    context: this._makeContext(client),
    query,
  };
  if (params) body.params = params;
  if (continuation) body.continuation = continuation;

  return this._post(`${client.apiUrl}search?prettyPrint=false`, body, client);
}

async searchContinuation(continuationToken, client = WEB) {
  const body = {
    context: this._makeContext(client),
    continuation: continuationToken,
  };
  return this._post(`${client.apiUrl}search?prettyPrint=false`, body, client);
}

async liveChat(continuation, { replay = false, offsetMs = 0 } = {}) {
  const body = {
    context: this._makeContext(WEB),
    continuation,
  };
  if (replay) body.currentPlayerState = { playerOffsetMs: String(Math.max(0, Math.floor(offsetMs))) };
  return this._post(getInnertubeApiUrl(replay ? 'live_chat/get_live_chat_replay' : 'live_chat/get_live_chat', WEB), body, WEB);
}

async browse(browseId, params = null, continuation = null, query = null) {
  const body = {
    context: this._makeContext(MWEB),
  };
  if (query) body.query = query;
  if (browseId) body.browseId = browseId;
  if (params) body.params = params;
  if (continuation) body.continuation = continuation;

  return this._post(getInnertubeApiUrl('browse'), body, MWEB);
}
async resolveUrl(url) {
  const body = {
    context: this._makeContext(MWEB),
    url,
  };
  return this._post(getInnertubeApiUrl('navigation/resolve_url'), body, MWEB);
}

async browseAndroid(browseId, params = null, continuation = null) {
  const body = {
    context: this._makeContext(ANDROID),
  };
  if (browseId) body.browseId = browseId;
  if (params) body.params = params;
  if (continuation) body.continuation = continuation;

  return this._post("https://youtubei.googleapis.com/youtubei/v1/browse", body, ANDROID);
}
async browseWeb(browseId, params = null, continuation = null, query = null) {
  const body = {
    context: this._makeContext(WEB),
  };
  if (query) body.query = query;
  if (browseId) body.browseId = browseId;
  if (params) body.params = params;
  if (continuation) body.continuation = continuation;

  return this._post(`${WEB.apiUrl}browse?prettyPrint=false`, body, WEB);
}

async next(videoId, playlistId = null) {
  const body = {
    context: this._makeContext(MWEB, `${MWEB.origin}/watch?v=${videoId}`),
    videoId,
  };
  if (playlistId) body.playlistId = playlistId;

  return this._post(getInnertubeApiUrl('next'), body, MWEB);
}

async nextContinuation(continuationToken, useWeb = false) {
  const client = useWeb ? WEB : MWEB;
  const body = {
    context: this._makeContext(client),
    continuation: continuationToken,
  };
  return this._post(useWeb ? `${WEB.apiUrl}next?prettyPrint=false` : getInnertubeApiUrl('next'), body, client);
}

async player(videoId, options = {}, client = MWEB) {
  const opts = typeof options === 'boolean' ? { includePlaybackContext: options } : (options || {});
  let targetClient = opts.client || client || MWEB;
  if (opts.mwebPlayerCompat && targetClient.clientName === 'MWEB') {
    targetClient = {
      ...targetClient,
      clientVersion: opts.clientVersion || targetClient.clientVersion,
      userAgent: opts.userAgent || targetClient.userAgent,
      visitorDataOverride: opts.visitorData || undefined,
      minimalContext: true,
    };
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let cpn = opts.cpn;
  if (!cpn) {
    cpn = '';
    for (let i = 0; i < 16; i++) cpn += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const body = {
    context: this._makeContext(targetClient, targetClient.origin ? `${targetClient.origin}/watch?v=${videoId}` : null),
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    cpn,
  };

  if (opts.includePlaybackContext !== false) {
    const sts = opts.sts !== undefined ? opts.sts : (opts.signatureTimestamp || 0);
    body.playbackContext = {
      contentPlaybackContext: {
        currentUrl: `/watch?v=${videoId}`,
        signatureTimestamp: Number(sts) || 0,
        html5Preference: 'HTML5_PREF_WANTS',
      }
    };
  }

  const poToken = opts.poToken || opts.cynToken;
  if (poToken) {
    body.serviceIntegrityDimensions = {
      poToken: String(poToken)
    };
  }

  const url = (targetClient.origin ? targetClient.origin : (targetClient.apiUrl === MOBILE_API_URL ? 'https://m.youtube.com' : 'https://www.youtube.com')) + '/youtubei/v1/player?prettyPrint=false';
  const res = await this._post(url, body, targetClient);
  if (res && typeof res === 'object') {
    res.cpn = cpn;
  }
  return res;
}

async mwebPlayer(videoId, options = {}) {
  return this.player(videoId, options, MWEB);
}

async mwebBasePlayer(videoId) {
  let promise = this.basePlayers.get(videoId);
  if (!promise) {
    promise = getPlayerCode('mweb', MWEB.userAgent).then(({ sts }) => this.mwebPlayer(videoId, { sts }));
    this.basePlayers.set(videoId, promise);
    const drop = () => this.basePlayers.delete(videoId);
    promise.catch(drop);
    setTimeout(drop, 60_000).unref();
  }
  return promise;
}

async webPlayer(videoId, options = {}) {
  let raw = null;
  try {
    raw = await this.player(videoId, options, WEB);
  } catch {}
  if (raw && raw.playabilityStatus?.status === 'OK' && raw.streamingData) {
    return raw;
  }
  try {
    const hdrs = {
      'User-Agent': WEB.userAgent,
      'Accept-Language': `${this.language};q=0.9,en-US;q=0.8,en;q=0.7`,
    };
    const cookieHeader = getCookieHeader();
    if (cookieHeader) hdrs['Cookie'] = cookieHeader;
    const fetchArgs = { headers: hdrs };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`, fetchArgs);
    if (pageRes.ok) {
      const html = await pageRes.text();
      const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var\s|const\s|let\s|<\/script>)/s);
      if (m) {
        const parsed = JSON.parse(m[1]);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    }
  } catch {}
  return raw;
}

async fetchTvVisitorData() {
  try {
    const hdrs = {
      'User-Agent': TVHTML5.userAgent,
      'Accept-Language': 'en-US,en;q=0.9'
    };
    const fetchArgs = { headers: hdrs };
    const agent = getProxyAgent();
    if (agent) fetchArgs.agent = agent;
    const tvPageRes = await fetch('https://www.youtube.com/tv', fetchArgs);
    const html = await tvPageRes.text();
    const m = html.match(/"visitorData":\s*"([^"]+)"/);
    if (m) this.visitorData = m[1];
    return this.visitorData || null;
  } catch {
    return null;
  }
}

async tvPlayer(videoId, options = {}) {
  if (!this.visitorData) {
    await this.fetchTvVisitorData();
  }
  return this.player(videoId, options, TVHTML5);
}

async tvSimplyPlayer(videoId, options = {}) {
  if (!this.visitorData) {
    await this.fetchTvVisitorData();
  }
  return this.player(videoId, options, TVHTML5_SIMPLY);
}

async visionOsPlayer(videoId) {
  const client = VISIONOS;

  if (!this.visitorData) {
    await this.fetchVisitorData();
  }

  const ctx = this._makeContext(client);
  ctx.client.originalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  ctx.request = { useSsl: true };
  ctx.user = { enableSafetyMode: false, lockedSafetyMode: false };

  const body = {
    videoId,
    context: ctx,
    contentCheckOk: true,
    racyCheckOk: true,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
      },
    },
  };

  const url = `https://www.youtube.com/youtubei/v1/player`;
  return this._post(url, body, client);
}

async reelPlayer(videoId) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let cpn = '';
  for (let i = 0; i < 16; i++) cpn += chars.charAt(Math.floor(Math.random() * chars.length));

  if (!this.visitorData) {
    await this.fetchVisitorData();
  }

  const body = {
    context: this._makeContext(ANDROID_REEL),
    playerRequest: {
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
    disablePlayerResponse: false,
    cpn,
  };

  const endpoint = 'reel/reel_item_watch?fields=playerResponse.streamingData,playerResponse.playabilityStatus';
  const url = `${API_URL}${endpoint}&prettyPrint=false`;

  const result = await this._post(url, body, ANDROID_REEL);
  return { ...(result.playerResponse || result), cpn };
}

async getCommentsLegacy(continuationToken) {
  const url = `https://m.youtube.com/watch_comment?action_get_comments=1&pbj=1&ctoken=${encodeURIComponent(continuationToken)}`;
  const res = await this._get(url, {
    'X-YouTube-Client-Version': '2.20210714.00.00',
    'X-YouTube-Client-Name': '2',
  });
  return res.json();
}

async getPage(url) {
  const res = await this._get(url);
  return res.text();
}

async getDesktopPage(url) {
  const fetchArgs = {
    headers: {
      'User-Agent': WEB.userAgent,
      'Accept-Language': `${this.language};q=0.9`,
      'Cookie': 'SOCS=CAI; CONSENT=YES+1',
    },
  };
  const agent = getProxyAgent();
  if (agent) fetchArgs.agent = agent;
  const res = await fetchWith403Retry(url, fetchArgs);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.text();
}

async androidVrPlayer(videoId) {
  const authHeader = await getVrAuthorization();
  if (!authHeader) {
    throw new Error('SABR is not configured on this server');
  }

  if (!this.visitorData) {
    await this.fetchVisitorData();
  }

  const ctx = {
    client: {
      deviceMake: ANDROID_VR.deviceMake,
      deviceModel: ANDROID_VR.deviceModel,
      clientName: ANDROID_VR.clientName,
      clientVersion: ANDROID_VR.clientVersion,
      osName: ANDROID_VR.osName,
      osVersion: ANDROID_VR.osVersion,
      androidSdkVersion: Number(ANDROID_VR.androidSdkVersion),
      hl: this.language,
      gl: this.country,
    }
  };
  if (this.visitorData) ctx.client.visitorData = this.visitorData;

  const body = {
    context: ctx,
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': ANDROID_VR.userAgent,
    'X-YouTube-Client-Name': ANDROID_VR.clientId,
    'X-YouTube-Client-Version': ANDROID_VR.clientVersion,
    'X-Goog-Api-Format-Version': '2',
    'Authorization': authHeader,
  };
  if (this.visitorData) headers['X-Goog-Visitor-Id'] = this.visitorData;

  const url = 'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false';
  const fetchArgs = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };
  const agent = getProxyAgent();
  if (agent) fetchArgs.agent = agent;

  const res = await fetchWith403Retry(url, fetchArgs);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`InnerTube SABR player ${res.status}: ${text.substring(0, 200)}`);
  }

  const result = await res.json();
  const vd = result?.responseContext?.visitorData;
  if (vd) this.visitorData = vd;
  return result;
}
}

export default InnerTubeClient;
