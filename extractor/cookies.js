import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCAN_INTERVAL_MS = 5000;

const fileCache = new Map();
let accounts = [];
let lastScan = 0;
let activeIndex = 0;

export function parseNetscapeCookies(filePath) {
  try {
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = fileCache.get(filePath);
    if (cached?.mtime === mtime) return cached.cookies;

    const cookies = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
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
    fileCache.set(filePath, { mtime, cookies });
    return cookies;
  } catch {
    return null;
  }
}

function scanAccounts() {
  if (Date.now() - lastScan < SCAN_INTERVAL_MS) return accounts;
  lastScan = Date.now();

  const files = new Set();
  for (const dir of [process.cwd(), path.resolve(__dirname, '..')]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (/^cookies.*\.txt$/.test(name)) files.add(path.join(dir, name));
      }
    } catch {}
  }

  accounts = [...files].sort()
    .map(file => ({ file, name: path.basename(file), cookies: parseNetscapeCookies(file) }))
    .filter(a => a.cookies && Object.keys(a.cookies).length);
  return accounts;
}

export function getAccountCount() {
  return scanAccounts().length;
}

export function getActiveAccount() {
  const list = scanAccounts();
  return list.length ? list[activeIndex % list.length] : null;
}

export function rotateAccount(failed) {
  const list = scanAccounts();
  if (list.length && list[activeIndex % list.length].file === failed?.file) {
    activeIndex = (activeIndex + 1) % list.length;
  }
}

export function getCookieHeader(account = getActiveAccount()) {
  if (!account) return null;
  return Object.entries(account.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

export function getAuthHeader(origin = 'https://www.youtube.com', userSessionId = null, account = getActiveAccount()) {
  const cookies = account?.cookies;
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
  getAccountCount,
  getActiveAccount,
  rotateAccount,
  getCookieHeader,
  getAuthHeader
};
