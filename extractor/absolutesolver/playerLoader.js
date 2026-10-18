import fetch from 'node-fetch';
import { getCachedItem, setCachedItem } from '../storage.js';
import { getProxyAgent } from '../proxyManager.js';
import { decipherStream, getSignatureTimestamp } from './decipher.js';

const CLIENT_PAGES = {
  mweb: {
    pageUrl: 'https://m.youtube.com/',
    defaultUa: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    defaultPath: '/s/player/mweb/player_ias.vflset/en_US/base.js'
  },
  web: {
    pageUrl: 'https://www.youtube.com/',
    defaultUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0',
    defaultPath: '/s/player/desktop/player_ias.vflset/en_US/base.js'
  },
  tv: {
    pageUrl: 'https://www.youtube.com/tv',
    defaultUa: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.00 Safari/605.1.15',
    defaultPath: '/s/player/tv-player-ias.vflset/tv-player-ias.js'
  },
  tv_simply: {
    pageUrl: 'https://www.youtube.com/tv',
    defaultUa: 'Mozilla/5.0 (PlayStation 4 5.55) AppleWebKit/601.2 (KHTML, like Gecko)',
    defaultPath: '/s/player/tv-player-ias.vflset/tv-player-ias.js'
  }
};

export async function discoverPlayerJsPath(clientKey = 'mweb', userAgent = null) {
  const cfg = CLIENT_PAGES[clientKey] || CLIENT_PAGES.mweb;
  const ua = userAgent || cfg.defaultUa;
  const agent = getProxyAgent();

  const fetchArgs = {
    headers: {
      'User-Agent': ua,
      'Accept-Language': 'en'
    }
  };
  if (agent) fetchArgs.agent = agent;

  try {
    const res = await fetch(cfg.pageUrl, fetchArgs);
    if (!res.ok) return cfg.defaultPath;
    const html = await res.text();
    const m = html.match(/"(?:PLAYER_JS_URL|jsUrl)":\s*"([^"]+)"/) || html.match(/<script\s+src="([^"]*(?:player|base)[^"]*\.js)"/);
    if (m) {
      return m[1].replace(/\\/g, '');
    }
  } catch {}

  return cfg.defaultPath;
}

export async function getPlayerCode(clientKey = 'mweb', userAgent = null) {
  const cacheKey = `player_code_${clientKey}`;
  const cached = await getCachedItem(cacheKey);
  if (cached && cached.code) {
    return cached;
  }

  const jsPath = await discoverPlayerJsPath(clientKey, userAgent);
  const fullUrl = jsPath.startsWith('http') ? jsPath : `https://www.youtube.com${jsPath}`;
  const agent = getProxyAgent();
  const fetchArgs = {
    headers: {
      'User-Agent': userAgent || CLIENT_PAGES[clientKey]?.defaultUa || 'Mozilla/5.0'
    }
  };
  if (agent) fetchArgs.agent = agent;

  const res = await fetch(fullUrl, fetchArgs);
  if (!res.ok) throw new Error(`Fetch player js failed (${res.status}): ${fullUrl}`);
  const code = await res.text();
  const sts = getSignatureTimestamp(code);

  const result = {
    code,
    url: fullUrl,
    path: jsPath,
    sts
  };

  await setCachedItem(cacheKey, result, 12 * 60 * 60 * 1000);
  return result;
}

export async function decipherFormat(clientKey, fmt, cynToken = null, clientVersion = null) {
  const player = await getPlayerCode(clientKey);
  return decipherStream(clientKey, player.code, fmt, cynToken, clientVersion);
}

export default {
  discoverPlayerJsPath,
  getPlayerCode,
  decipherFormat
};
