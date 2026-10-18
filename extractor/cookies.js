import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedCookies = null;
let lastMtime = 0;

function findCookiesFile() {
  const candidates = [
    path.resolve(process.cwd(), 'cookies.txt'),
    path.resolve(__dirname, '..', 'cookies.txt'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function parseNetscapeCookies(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (cachedCookies && stat.mtimeMs === lastMtime) {
      return cachedCookies;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const cookies = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_'))) continue;
      const parts = trimmed.split('\t');
      if (parts.length >= 7) {
        const domain = parts[0].replace('#HttpOnly_', '').toLowerCase();
        if (domain.endsWith('youtube.com')) {
          cookies[parts[5]] = parts[6];
        }
      }
    }
    cachedCookies = cookies;
    lastMtime = stat.mtimeMs;
    return cookies;
  } catch {
    return null;
  }
}

export function getCookies() {
  const file = findCookiesFile();
  return parseNetscapeCookies(file);
}

export function getCookieHeader() {
  const cookies = getCookies();
  if (!cookies || !Object.keys(cookies).length) return null;
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

export function getAuthHeader(origin = 'https://www.youtube.com', userSessionId = null) {
  const cookies = getCookies();
  if (!cookies) return null;
  const sapisid = cookies['SAPISID'] || cookies['__Secure-3PAPISID'] || cookies['__Secure-1PAPISID'];
  if (!sapisid) return null;

  const ts = Math.round(Date.now() / 1000).toString();
  const auths = [];
  for (const [scheme, sid] of [
    ['SAPISIDHASH', cookies['SAPISID']],
    ['SAPISID1PHASH', cookies['__Secure-1PAPISID']],
    ['SAPISID3PHASH', cookies['__Secure-3PAPISID']]
  ]) {
    if (sid) {
      const parts = [];
      if (userSessionId) parts.push(userSessionId);
      parts.push(ts, sid, origin);
      const sha1 = crypto.createHash('sha1').update(parts.join(' ')).digest('hex');
      auths.push(`${scheme} ${ts}_${sha1}${userSessionId ? '_u' : ''}`);
    }
  }

  return auths.length ? auths.join(' ') : null;
}

export default {
  getCookies,
  getCookieHeader,
  getAuthHeader
};
