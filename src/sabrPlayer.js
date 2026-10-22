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


const UMP_MEDIA_HEADER = 20;
const UMP_MEDIA = 21;
const UMP_MEDIA_END = 22;
const UMP_NEXT_REQUEST_POLICY = 35;
const UMP_FORMAT_INIT_METADATA = 42;
const UMP_SABR_REDIRECT = 43;
const UMP_SABR_ERROR = 44;
const UMP_RELOAD_PLAYER_RESPONSE = 46;
const UMP_SABR_CONTEXT_UPDATE = 57;
const UMP_STREAM_PROTECTION_STATUS = 58;
const UMP_SABR_CONTEXT_SENDING_POLICY = 59;

const AHEAD_MS = 30000;
const BEHIND_MS = 30000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const CPN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function generateCpn() {
  let s = '';
  for (let i = 0; i < 16; i++) s += CPN_ALPHABET[Math.floor(Math.random() * CPN_ALPHABET.length)];
  return s;
}

function varint(n) {
  const out = [];
  while (n > 127) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Uint8Array.from(out);
}

function concat(bufs) {
  const out = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0));
  let off = 0;
  for (const b of bufs) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

const pbInt = (field, v) => concat([varint(field * 8), varint(v)]);
const pbBytes = (field, d) => concat([varint(field * 8 + 2), varint(d.length), d]);
const pbStr = (field, s) => pbBytes(field, enc.encode(s));

function pbParse(data) {
  const out = {};
  let pos = 0;
  while (pos < data.length) {
    let tag;
    [tag, pos] = readVarint(data, pos);
    const f = Math.floor(tag / 8);
    const wt = tag % 8;
    let v;
    if (wt === 0) {
      [v, pos] = readVarint(data, pos);
    } else if (wt === 2) {
      let len;
      [len, pos] = readVarint(data, pos);
      if (pos + len > data.length) break;
      v = data.subarray(pos, pos + len);
      pos += len;
    } else if (wt === 1) {
      pos += 8;
      continue;
    } else if (wt === 5) {
      pos += 4;
      continue;
    } else {
      break;
    }
    (out[f] ||= []).push(v);
  }
  return out;
}

function readVarint(buf, pos) {
  let result = 0;
  let mul = 1;
  while (pos < buf.length) {
    const b = buf[pos++];
    result += (b & 0x7f) * mul;
    if (!(b & 0x80)) return [result, pos];
    mul *= 128;
  }
  return [0, pos];
}

const gInt = (d, f, def = 0) => (typeof d[f]?.[0] === 'number' ? d[f][0] : def);
const gBytes = (d, f) => (d[f]?.[0] instanceof Uint8Array ? d[f][0] : new Uint8Array(0));
const gStr = (d, f) => dec.decode(gBytes(d, f));
const gMsg = (d, f) => pbParse(gBytes(d, f));

function gInts(d, f) {
  const out = [];
  for (const v of d[f] || []) {
    if (typeof v === 'number') out.push(v);
    else {
      let p = 0;
      while (p < v.length) {
        let x;
        [x, p] = readVarint(v, p);
        out.push(x);
      }
    }
  }
  return out;
}

function readUmpVarint(buf, pos) {
  if (pos >= buf.length) return [-1, pos];
  const b0 = buf[pos];
  const len = b0 < 128 ? 1 : b0 < 192 ? 2 : b0 < 224 ? 3 : b0 < 240 ? 4 : 5;
  if (pos + len > buf.length) return [-1, pos];
  let v;
  if (len === 1) v = b0;
  else if (len === 2) v = (b0 & 0x3f) | (buf[pos + 1] << 6);
  else if (len === 3) v = (b0 & 0x1f) | (buf[pos + 1] << 5) | (buf[pos + 2] << 13);
  else if (len === 4) v = (b0 & 0x0f) | (buf[pos + 1] << 4) | (buf[pos + 2] << 12) | (buf[pos + 3] << 20);
  else v = new DataView(buf.buffer, buf.byteOffset + pos + 1, 4).getUint32(0, true);
  return [v, pos + len];
}

function* iterUmpParts(buf) {
  let pos = 0;
  while (pos < buf.length) {
    const [ptype, p1] = readUmpVarint(buf, pos);
    if (ptype < 0) return;
    const [psize, p2] = readUmpVarint(buf, p1);
    if (psize < 0 || p2 + psize > buf.length) return;
    yield [ptype, buf.subarray(p2, p2 + psize)];
    pos = p2 + psize;
  }
}

async function gunzip(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function b64ToBytes(b64) {
  if (!b64) return new Uint8Array(0);
  let s = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function formatId(f) {
  return concat([
    pbInt(1, f.itag),
    f.lmt ? pbInt(2, f.lmt) : new Uint8Array(0),
    f.xtags ? pbStr(3, f.xtags) : new Uint8Array(0),
  ]);
}

function clientInfo(visitor, clientName = 'ANDROID_VR', clientVersion = '1.73.21') {
  if (clientName === 'MWEB') {
    return concat([
      pbStr(1, 'en_US'),
      pbInt(16, 2),
      pbStr(17, clientVersion || '2.20261016.01.00'),
      pbStr(12, 'google'),
      pbStr(13, 'pixel tablet'),
      pbStr(18, 'Android'),
      pbStr(19, '16'),
    ]);
  }
  if (clientName === 'TVHTML5' || clientName === 'TV') {
    return concat([
      pbStr(1, 'en_US'),
      pbInt(16, 31),
      pbStr(17, clientVersion || '7.20261014.18.00'),
      pbStr(12, 'Sony'),
      pbStr(13, 'Sony_ATV_sdm845_13140765'),
      pbStr(18, 'Android'),
      pbStr(19, '10'),
    ]);
  }
  if (clientName === 'TVHTML5_SIMPLY') {
    return concat([
      pbStr(1, 'en_US'),
      pbInt(16, 74),
      pbStr(17, clientVersion || '1.0'),
      pbStr(12, 'Sony'),
      pbStr(13, 'PlayStation 4'),
      pbStr(18, 'PlayStation 4'),
      pbStr(19, '5.55'),
    ]);
  }
  if (clientName === 'WEB') {
    return concat([
      pbStr(1, 'en_US'),
      pbInt(16, 1),
      pbStr(17, clientVersion || '2.20261016.01.00'),
      pbStr(18, 'X11'),
    ]);
  }
  return concat([
    pbStr(12, 'Pico'),
    pbStr(13, 'A8110'),
    visitor ? pbStr(14, visitor) : new Uint8Array(0),
    pbInt(16, 28),
    pbStr(17, clientVersion || '1.73.21'),
    pbStr(18, 'Android'),
    pbStr(19, '10'),
    pbStr(21, 'en'),
    pbStr(22, 'US'),
    pbInt(67, -new Date().getTimezoneOffset()),
    pbStr(80, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  ]);
}

export class SabrMediaSourcePlayer {
  constructor({ video, sabrInfo, videoFmt, audioFmt, onFatal }) {
    this.video = video;
    this.onFatal = onFatal;
    this.sabrUrl = sabrInfo.sabrUrl;
    this.visitor = sabrInfo.visitorData || '';
    this.poToken = sabrInfo.poToken || '';
    this.clientName = sabrInfo.clientName || 'ANDROID_VR';
    this.clientVersion = sabrInfo.clientVersion || '1.73.21';
    this.userAgent = sabrInfo.userAgent || '';
    this.cpn = sabrInfo.cpn || generateCpn();
    this.ustreamer = b64ToBytes(sabrInfo.ustreamerConfig);
    this.fmts = { video: videoFmt || null, audio: audioFmt || null };
    this.tracks = {};
    this.cookie = null;
    this.contexts = new Map();
    this.activeCtx = new Set();
    this.nextOk = 0;
    this.destroyed = false;
    this.busy = false;
    this.videoId = sabrInfo.videoId || '';
    this.rounds = 1;
    this.lastPos = 0;
    this.guardPos = 0;
    this.guardUntil = 0;
  }

  async renewPoToken() {
    if (!this.videoId) return;
    try {
      const potUrl = `/api/v1/stream/${encodeURIComponent(this.videoId)}/pot?client=${encodeURIComponent(this.clientName || 'web')}&visitorData=${encodeURIComponent(this.visitor || '')}`;
      const potRes = await fetch(potUrl);
      if (potRes.ok) {
        const potData = await potRes.json();
        if (potData.poToken) {
          this.poToken = potData.poToken;
        }
      }
    } catch (e) {
      console.warn('[SABR] PO token renewal failed:', e.message);
    }
  }

  async init() {
    if (!window.MediaSource) throw new Error('MediaSource not supported');
    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.objectUrl;
    await new Promise((resolve, reject) => {
      this.mediaSource.addEventListener('sourceopen', resolve, { once: true });
      this.mediaSource.addEventListener('error', reject, { once: true });
    });

    const activeKinds = ['audio', 'video'].filter(k => this.fmts[k]);
    for (const kind of activeKinds) {
      const fmt = this.fmts[kind];
      const sb = this.mediaSource.addSourceBuffer(fmt.mimeType);
      this.tracks[fmt.itag] = {
        kind,
        fmt,
        sb,
        queue: [],
        roundHeaders: [],
        initDone: false,
        endMs: 0,
        totalEndMs: 0,
      };
      sb.addEventListener('updateend', () => {
        this.setDuration();
        this.pump(this.tracks[fmt.itag]);
      });
    }

    let initAttempts = 0;
    while (!Object.values(this.tracks).every(t => t.initDone) && initAttempts++ < 5 && !this.destroyed) {
      await this.fetchAt(0);
    }
    if (!Object.values(this.tracks).every(t => t.initDone)) throw new Error('No init segments received');

    this.onTime = () => {
      if (!this.video.seeking && this.video.currentTime > 0) this.lastPos = this.video.currentTime;
      this.maybeFetch();
    };
    this.onSeeking = () => {
      if (this.guardPos > 2 && Date.now() < this.guardUntil && this.video.currentTime < 1) {
        console.log(`[SABR] playback jumped to start after PO token refresh, restoring ${this.guardPos.toFixed(1)}s`);
        this.video.currentTime = this.guardPos;
        return;
      }
      this.maybeFetch(true);
    };
    this.video.addEventListener('timeupdate', this.onTime);
    this.video.addEventListener('seeking', this.onSeeking);
    this.timer = setInterval(() => this.maybeFetch(), 500);
    this.maybeFetch();
  }

  setDuration() {
    const ends = Object.values(this.tracks).map(t => t.totalEndMs);
    if (!ends.every(Boolean) || this.mediaSource.readyState !== 'open') return;
    if (Object.values(this.tracks).some(t => t.sb.updating)) return;
    try {
      this.mediaSource.duration = Math.max(...ends) / 1000;
    } catch {}
  }

  pump(t) {
    if (this.destroyed || t.sb.updating || this.mediaSource.readyState !== 'open') return;
    const next = t.queue.shift();
    if (!next) return;
    try {
      t.sb.appendBuffer(next);
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        t.queue.unshift(next);
        this.trim(t);
      }
    }
  }

  trim(t) {
    const cur = this.video.currentTime;
    if (cur - BEHIND_MS / 1000 > 0 && !t.sb.updating) {
      try {
        t.sb.remove(0, cur - BEHIND_MS / 1000);
      } catch {}
    }
  }

  currentMs() {
    return Math.floor(this.video.currentTime * 1000);
  }

  bufferedAheadMs(t) {
    const cur = this.video.currentTime;
    const r = t.sb.buffered;
    for (let i = 0; i < r.length; i++) {
      if (cur >= r.start(i) - 0.1 && cur <= r.end(i)) return (r.end(i) - cur) * 1000;
    }
    return 0;
  }

  maybeFetch(seeking = false) {
    if (this.destroyed || this.busy) return;
    if (this.capped && !seeking) return;
    if (seeking) this.capped = false;
    const ts = Object.values(this.tracks);
    const cur = this.currentMs();
    if (ts.every(t => t.totalEndMs && this.bufferedEndMs(t) >= t.totalEndMs - 250)) {
      if (this.mediaSource.readyState === 'open' && !ts.some(t => t.sb.updating || t.queue.length)) {
        try {
          this.mediaSource.endOfStream();
        } catch {}
      }
      return;
    }
    const needsData = ts.some(t => {
      if (t.totalEndMs && cur >= t.totalEndMs - 500) return false;
      if (t.totalEndMs && this.bufferedEndMs(t) >= t.totalEndMs - 250) return false;
      return this.bufferedAheadMs(t) < AHEAD_MS / 2;
    });
    if (!needsData) return;
    const buffered = ts.every(t => this.bufferedAheadMs(t) > 0);
    this.fetchAt(seeking || !buffered ? cur : Math.min(...ts.map(t => this.bufferedEndMs(t))));
  }

  isBuffered(t, startMs, endMs) {
    if (endMs <= startMs) return false;
    const r = t.sb.buffered;
    for (let i = 0; i < r.length; i++) {
      if (r.start(i) * 1000 <= startMs + 250 && r.end(i) * 1000 >= endMs - 250) return true;
    }
    return false;
  }

  bufferedEndMs(t) {
    const cur = this.video.currentTime;
    const r = t.sb.buffered;
    for (let i = 0; i < r.length; i++) {
      if (cur >= r.start(i) - 0.1 && cur <= r.end(i)) return Math.floor(r.end(i) * 1000);
    }
    return this.currentMs();
  }

  buildRequest(playerTimeMs) {
    const isWeb = this.clientName === 'WEB';
    const abrParts = [];
    if (this.fmts.video) {
      abrParts.push(pbInt(18, 1280), pbInt(19, 720));
    }
    abrParts.push(
      pbInt(28, Math.max(0, Math.floor(playerTimeMs))),
      pbInt(40, isWeb ? 3 : 0),
      pbInt(46, 1)
    );
    const abr = concat(abrParts);
    const ctxParts = [pbBytes(1, clientInfo(this.visitor, this.clientName, this.clientVersion))];
    if (this.poToken) ctxParts.push(pbBytes(2, b64ToBytes(this.poToken)));
    if (this.cookie) ctxParts.push(pbBytes(3, this.cookie));
    const unsent = [];
    for (const [typ, value] of this.contexts) {
      if (this.activeCtx.has(typ)) ctxParts.push(pbBytes(5, concat([pbInt(1, typ), pbBytes(2, value)])));
      else unsent.push(typ);
    }
    for (const typ of unsent) ctxParts.push(pbInt(6, typ));

    const parts = [pbBytes(1, abr)];

    for (const trk of Object.values(this.tracks)) {
      if (trk.initDone) {
        parts.push(pbBytes(2, formatId(trk.fmt || this.fmts[trk.kind])));
      }
    }

    for (const trk of Object.values(this.tracks)) {
      if (trk.roundHeaders && trk.roundHeaders.length) {
        trk.roundHeaders.sort((a, b) => (a.num || 0) - (b.num || 0));
        for (const h of trk.roundHeaders) {
          const br = concat([
            pbBytes(1, formatId(trk.fmt || this.fmts[trk.kind])),
            pbInt(2, h.start || 0),
            pbInt(3, h.dur || 0),
            pbInt(4, h.num || 0),
            pbInt(5, h.num || 0),
          ]);
          parts.push(pbBytes(3, br));
        }
        trk.roundHeaders = [];
      }
    }

    if (this.ustreamer && this.ustreamer.length) {
      parts.push(pbBytes(5, this.ustreamer));
    }

    if (this.fmts.audio) parts.push(pbBytes(16, formatId(this.fmts.audio)));
    if (this.fmts.video) parts.push(pbBytes(17, formatId(this.fmts.video)));
    parts.push(pbBytes(19, concat(ctxParts)));

    return concat(parts);
  }

  async fetchAt(timeMs) {
    if (this.destroyed || this.busy) return;
    this.busy = true;
    try {
      let redirects = 0;
      let emptyRounds = 0;
      let protectionRetries = 0;
      for (;;) {
        const wait = this.nextOk - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        if (this.destroyed) return;

        const sep = this.sabrUrl.includes('?') ? '&' : '?';
        const cver = this.clientVersion || '2.20261016.01.00';
        const cverParam = !this.sabrUrl.includes('cver=') ? `&cver=${encodeURIComponent(cver)}` : '';
        const cpnParam = this.cpn && !this.sabrUrl.includes('cpn=') ? `&cpn=${encodeURIComponent(this.cpn)}` : '';
        const reqUrl = `${this.sabrUrl}${sep}rn=${this.rounds++}${cpnParam}${cverParam}`;

        const fetchHeaders = { 'Content-Type': 'application/x-protobuf' };
        if (this.clientName !== 'WEB' && this.visitor) {
          fetchHeaders['X-Goog-Visitor-Id'] = this.visitor;
        }
        if (this.userAgent) fetchHeaders['X-Client-User-Agent'] = this.userAgent;
        if (this.clientName) fetchHeaders['X-Client-Name'] = this.clientName;
        if (this.clientVersion) fetchHeaders['X-Client-Version'] = this.clientVersion;

        const sentHeaders = Object.values(this.tracks).map(t => [t, [...t.roundHeaders]]);
        const res = await fetch(`/api/v1/proxy/sabr?sabr_url=${encodeURIComponent(reqUrl)}`, {
          method: 'POST',
          headers: fetchHeaders,
          body: this.buildRequest(timeMs),
        });
        if (!res.ok) {
          for (const [t, h] of sentHeaders) t.roundHeaders.unshift(...h);
          if (res.status === 403 && emptyRounds < 3 && !this.destroyed) {
            console.warn('[SABR] HTTP 403 encountered, renewing token and retrying...');
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, emptyRounds)));
            emptyRounds++;
            await this.renewPoToken();
            continue;
          }
          throw new Error(`SABR request failed (${res.status})`);
        }

        const result = await this.processResponse(new Uint8Array(await res.arrayBuffer()));
        if (result.error) throw new Error(`SABR error: ${result.error}`);
        if (result.reload) {
          if (this.videoId && emptyRounds < 2) {
            emptyRounds++;
            try {
              const strRes = await fetch(`/api/v1/stream/${encodeURIComponent(this.videoId)}?include_and_try_sabr=true&force_refresh=true`);
              if (strRes.ok) {
                const strData = await strRes.json();
                if (strData.sabr?.sabrUrl) {
                  this.sabrUrl = strData.sabr.sabrUrl;
                  if (strData.sabr.poToken) this.poToken = strData.sabr.poToken;
                  if (strData.sabr.ustreamerConfig) this.ustreamer = b64ToBytes(strData.sabr.ustreamerConfig);
                  continue;
                }
              }
            } catch {}
          }
          throw new Error('SABR session expired');
        }
        const hasBufferedMedia = Object.values(this.tracks).some(t => t.endMs > 0);
        if (result.protection === 2 || result.protection === 3) {
          console.log(`[SABR] STREAM_PROTECTION_STATUS=${result.protection}, refreshing PO token...`);
          if (result.backoffMs > 0) {
            await new Promise(r => setTimeout(r, Math.min(result.backoffMs, 5000)));
          }
          this.guardPos = this.lastPos;
          this.guardUntil = Date.now() + 20000;
          await this.renewPoToken();
          if (result.protection === 3 && !hasBufferedMedia && !result.sawMedia) {
            return this.fail(new Error('PO token rejected after refresh'));
          }
          if (!result.sawMedia) {
            for (const [t, h] of sentHeaders) t.roundHeaders.unshift(...h);
            if (++protectionRetries <= 3) continue;
            if (!hasBufferedMedia) return this.fail(new Error('PO token rejected after refresh'));
          }
        }

        if (result.redirect) {
          if (++redirects > 20) throw new Error('Too many SABR redirects');
          this.sabrUrl = result.redirect;
          if (!result.newSegments) continue;
        }

        if (!result.sawMedia && !result.newSegments) {
          if (result.backoffMs > 0) {
            await new Promise(r => setTimeout(r, result.backoffMs));
          }
          if (++emptyRounds <= 4) {
            continue;
          }
        }

        this.nextOk = Date.now() + (result.sawMedia ? Math.max(150, Math.min(result.backoffMs, 5000)) : 100);
        this.failures = 0;
        break;
      }
    } catch (e) {
      console.warn('[SABR]', e.message);
      if (++this.failures >= 4) this.fail(e);
    } finally {
      this.busy = false;
    }
  }

  async processResponse(body) {
    const res = { newSegments: 0, redirect: null, reload: false, error: null, protection: 0, backoffMs: 0, sawMedia: false };
    if (dec.decode(body.subarray(0, 4)) === 'http') {
      res.redirect = dec.decode(body).trim();
      return res;
    }

    const hdrs = new Map();
    for (const [ptype, payload] of iterUmpParts(body)) {
      if (ptype === UMP_MEDIA_HEADER) {
        const d = pbParse(payload);
        const fid = gMsg(d, 13);
        const tr = gMsg(d, 15);
        let start = gInt(d, 11, -1);
        let dur = gInt(d, 12, -1);
        if ((start < 0 || dur < 0) && d[15]) {
          const ts = gInt(tr, 3) || 1000;
          start = Math.floor((gInt(tr, 1) * 1000) / ts);
          dur = Math.floor((gInt(tr, 2) * 1000) / ts);
        }
        hdrs.set(gInt(d, 1), {
          itag: gInt(d, 3) || gInt(fid, 1),
          init: !!gInt(d, 8),
          num: gInt(d, 9),
          start: Math.max(start, 0),
          dur: Math.max(dur, 0),
          len: gInt(d, 14),
          comp: gInt(d, 7),
          chunks: [],
          size: 0,
          done: false,
        });
      } else if (ptype === UMP_MEDIA && payload.length) {
        const [hid, pos] = readVarint(payload, 0);
        const h = hdrs.get(hid);
        if (h) {
          h.chunks.push(payload.subarray(pos));
          h.size += payload.length - pos;
        }
      } else if (ptype === UMP_MEDIA_END && payload.length) {
        const [hid] = readVarint(payload, 0);
        const h = hdrs.get(hid);
        if (h) h.done = true;
      } else if (ptype === UMP_FORMAT_INIT_METADATA) {
        const d = pbParse(payload);
        const t = this.tracks[gInt(gMsg(d, 2), 1)];
        const end = gInt(d, 3);
        if (t && end > 0) {
          t.totalEndMs = end;
          this.setDuration();
        }
      } else if (ptype === UMP_NEXT_REQUEST_POLICY) {
        const d = pbParse(payload);
        res.backoffMs = gInt(d, 4);
        const ck = gBytes(d, 7);
        if (ck.length) this.cookie = ck;
      } else if (ptype === UMP_SABR_REDIRECT) {
        res.redirect = gStr(pbParse(payload), 1) || null;
      } else if (ptype === UMP_SABR_ERROR) {
        const d = pbParse(payload);
        res.error = `${gStr(d, 1)} (code ${gInt(d, 2)})`;
      } else if (ptype === UMP_RELOAD_PLAYER_RESPONSE) {
        res.reload = true;
      } else if (ptype === UMP_STREAM_PROTECTION_STATUS) {
        res.protection = gInt(pbParse(payload), 1);
      } else if (ptype === UMP_SABR_CONTEXT_UPDATE) {
        const d = pbParse(payload);
        const typ = gInt(d, 1);
        if (!(this.contexts.has(typ) && gInt(d, 5) === 2)) {
          this.contexts.set(typ, gBytes(d, 3));
          if (gInt(d, 4)) this.activeCtx.add(typ);
        }
      } else if (ptype === UMP_SABR_CONTEXT_SENDING_POLICY) {
        const d = pbParse(payload);
        gInts(d, 1).forEach(t => this.activeCtx.add(t));
        gInts(d, 2).forEach(t => this.activeCtx.delete(t));
        gInts(d, 3).forEach(t => {
          this.contexts.delete(t);
          this.activeCtx.delete(t);
        });
      }
    }

    for (const h of hdrs.values()) {
      const t = this.tracks[h.itag];
      if (!t || !(h.done || (h.len && h.size === h.len))) continue;
      let data = concat(h.chunks);
      if (h.comp === 1) data = await gunzip(data);
      else if (h.comp === 2) throw new Error('Brotli segments not supported');
      res.sawMedia = true;
      if (h.init) {
        if (!t.initDone) {
          t.initDone = true;
          t.queue.push(data);
        }
      } else {
        if (t.roundHeaders) t.roundHeaders.push(h);
        if (this.isBuffered(t, h.start, h.start + h.dur)) {
          console.log(`[SABR] skipping already buffered segment ${h.num} (${h.start}ms)`);
          continue;
        }
        t.endMs = Math.max(t.endMs, h.start + h.dur);
        t.queue.push(data);
        res.newSegments++;
      }
    }

    for (const t of Object.values(this.tracks)) this.pump(t);
    return res;
  }

  fail(e) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.onFatal?.(e)) this.video.dispatchEvent(new ErrorEvent('error', { message: e.message }));
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.video.removeEventListener('timeupdate', this.onTime);
    this.video.removeEventListener('seeking', this.onSeeking);
    if (this.srcUrl) {
      URL.revokeObjectURL(this.srcUrl);
      this.srcUrl = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch {}
    }
  }
}

class SabrTrack {
  constructor(kind, fmt) {
    this.kind = kind;
    this.fmt = fmt;
    this.itag = Number(fmt.itag);
    this.chunks = [];
    this.initDone = false;
    this.pending = new Map();
    this.nextNum = null;
    this.endMs = 0;
    this.totalEndMs = 0;
    this.bytes = 0;
    this.roundHeaders = [];
  }

  addInit(data) {
    if (!this.initDone) {
      this.chunks.push(data);
      this.bytes += data.length;
      this.initDone = true;
    }
  }

  addSegment(seq, startMs, endMs, data) {
    if (this.pending.has(seq) || (this.nextNum !== null && seq < this.nextNum)) {
      return false;
    }
    this.pending.set(seq, { startMs, endMs, data });
    return true;
  }

  flush() {
    if (!this.initDone) return;
    if (this.nextNum === null) {
      if (this.pending.size === 0) return;
      this.nextNum = Math.min(...this.pending.keys());
    }
    while (this.pending.has(this.nextNum)) {
      const seg = this.pending.get(this.nextNum);
      this.pending.delete(this.nextNum);
      this.chunks.push(seg.data);
      this.bytes += seg.data.length;
      this.endMs = seg.endMs;
      this.nextNum++;
    }
  }

  close() {
    this.flush();
  }
}

export class SabrDownloader {
  constructor({ videoId, sabrInfo, videoFmt, audioFmt, durationS = 0 }) {
    this.videoId = videoId || sabrInfo.videoId || '';
    this.sabrUrl = sabrInfo.sabrUrl;
    this.visitor = sabrInfo.visitorData || '';
    this.poToken = sabrInfo.poToken || '';
    this.clientName = sabrInfo.clientName || 'WEB';
    this.clientVersion = sabrInfo.clientVersion || '2.20261016.01.00';
    this.userAgent = sabrInfo.userAgent || '';
    this.cpn = sabrInfo.cpn || generateCpn();
    this.ustreamer = b64ToBytes(sabrInfo.ustreamerConfig);
    this.durationMs = (durationS || sabrInfo.duration || 0) * 1000;
    this.videoFmt = videoFmt || null;
    this.audioFmt = audioFmt || null;
    this.tracks = {};
    if (videoFmt) {
      this.tracks[Number(videoFmt.itag)] = new SabrTrack('video', videoFmt);
    }
    if (audioFmt) {
      this.tracks[Number(audioFmt.itag)] = new SabrTrack('audio', audioFmt);
    }
    this.cookie = null;
    this.contexts = new Map();
    this.activeCtx = new Set();
    this.rounds = 1;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  playerTimeMs() {
    const list = Object.values(this.tracks);
    if (!list.length) return 0;
    return Math.min(...list.map(t => t.endMs));
  }

  refMs(t) {
    return t.totalEndMs || this.durationMs;
  }

  finished() {
    const list = Object.values(this.tracks);
    if (!list.length) return false;
    for (const t of list) {
      if (!t.initDone || !t.totalEndMs) return false;
      if (t.endMs < t.totalEndMs - 250) return false;
    }
    return true;
  }

  nearEnd() {
    const list = Object.values(this.tracks);
    if (!list.length) return false;
    return list.every(t => t.endMs >= this.refMs(t) - 5000);
  }

  async renewPoToken() {
    if (!this.videoId) return;
    try {
      const potUrl = `/api/v1/stream/${encodeURIComponent(this.videoId)}/pot?client=${encodeURIComponent(this.clientName || 'web')}&visitorData=${encodeURIComponent(this.visitor || '')}`;
      const potRes = await fetch(potUrl);
      if (potRes.ok) {
        const potData = await potRes.json();
        if (potData.poToken) this.poToken = potData.poToken;
      }
    } catch {}
  }

  async refreshPlayer() {
    if (!this.videoId) return;
    try {
      const res = await fetch(`/api/v1/stream/${encodeURIComponent(this.videoId)}?client=${encodeURIComponent(this.clientName || 'web')}&include_and_try_sabr=true&force_refresh=true`);
      if (res.ok) {
        const data = await res.json();
        if (data.sabr?.sabrUrl) {
          this.sabrUrl = data.sabr.sabrUrl;
          if (data.sabr.poToken) this.poToken = data.sabr.poToken;
          if (data.sabr.ustreamerConfig) this.ustreamer = b64ToBytes(data.sabr.ustreamerConfig);
          this.cookie = null;
          this.rounds = 0;
          this.contexts.clear();
          this.activeCtx.clear();
          for (const trk of Object.values(this.tracks)) {
            trk.roundHeaders = [];
          }
        }
      }
    } catch {}
  }

  buildRequest() {
    const t = this.playerTimeMs();
    const abr = concat([
      pbInt(18, 1280),
      pbInt(19, 720),
      pbInt(28, t),
      pbInt(40, 0),
      pbInt(46, 1),
    ]);

    const client = clientInfo(this.visitor, this.clientName, this.clientVersion);
    const ctxParts = [pbBytes(1, client)];
    if (this.poToken) ctxParts.push(pbBytes(2, b64ToBytes(this.poToken)));
    if (this.cookie) ctxParts.push(pbBytes(3, this.cookie));

    const sortedCtx = Array.from(this.activeCtx).sort((a, b) => a - b);
    for (const typ of sortedCtx) {
      if (this.contexts.has(typ)) {
        ctxParts.push(pbBytes(5, concat([pbInt(1, typ), pbBytes(2, this.contexts.get(typ))])));
      } else {
        ctxParts.push(pbInt(6, typ));
      }
    }

    const parts = [pbBytes(1, abr)];

    for (const trk of Object.values(this.tracks)) {
      if (trk.initDone) {
        parts.push(pbBytes(2, formatId(trk.fmt)));
      }
    }

    for (const trk of Object.values(this.tracks)) {
      if (trk.roundHeaders.length) {
        trk.roundHeaders.sort((a, b) => a.seq - b.seq);
        for (const h of trk.roundHeaders) {
          const br = concat([
            pbBytes(1, formatId(trk.fmt)),
            pbInt(2, h.start),
            pbInt(3, h.dur),
            pbInt(4, h.seq),
            pbInt(5, h.seq),
          ]);
          parts.push(pbBytes(3, br));
        }
        trk.roundHeaders = [];
      }
    }

    if (this.ustreamer && this.ustreamer.length) {
      parts.push(pbBytes(5, this.ustreamer));
    }

    if (this.audioFmt) parts.push(pbBytes(16, formatId(this.audioFmt)));
    if (this.videoFmt) parts.push(pbBytes(17, formatId(this.videoFmt)));
    parts.push(pbBytes(19, concat(ctxParts)));

    return concat(parts);
  }

  requestUrl() {
    const sep = this.sabrUrl.includes('?') ? '&' : '?';
    return `${this.sabrUrl}${sep}rn=${this.rounds++}`;
  }

  async download(onProgress, abortSignal) {
    let idle = 0;
    let reloads = 0;
    let redirects = 0;

    while (!this.finished() && !this.cancelled && (!abortSignal || !abortSignal.aborted)) {
      const reqUrl = this.requestUrl();
      const fetchHeaders = {
        'Content-Type': 'application/x-protobuf',
        'Accept': 'application/vnd.yt-ump',
      };
      if (this.visitor) fetchHeaders['X-Goog-Visitor-Id'] = this.visitor;
      if (this.userAgent) fetchHeaders['X-Client-User-Agent'] = this.userAgent;
      if (this.clientName) fetchHeaders['X-Client-Name'] = this.clientName;
      if (this.clientVersion) fetchHeaders['X-Client-Version'] = this.clientVersion;

      const res = await fetch(`/api/v1/proxy/sabr?sabr_url=${encodeURIComponent(reqUrl)}`, {
        method: 'POST',
        headers: fetchHeaders,
        body: this.buildRequest(),
        signal: abortSignal,
      });

      if (!res.ok) {
        if (res.status === 403 && idle < 3) {
          idle++;
          await this.renewPoToken();
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        throw new Error(`SABR request failed (${res.status})`);
      }

      const body = new Uint8Array(await res.arrayBuffer());
      if (dec.decode(body.subarray(0, 4)) === 'http') {
        if (++redirects > 20) throw new Error('Too many SABR redirects');
        this.sabrUrl = dec.decode(body).trim();
        continue;
      }

      const hdrs = new Map();
      let reload = false;
      let protection = 0;
      let backoffMs = 0;
      let sabrError = null;
      let redirectUrl = null;

      for (const [ptype, payload] of iterUmpParts(body)) {
        if (ptype === UMP_MEDIA_HEADER) {
          const d = pbParse(payload);
          const hid = gInt(d, 1);
          const fid = gMsg(d, 13);
          const tr = gMsg(d, 15);
          let start = gInt(d, 11, -1);
          let dur = gInt(d, 12, -1);
          if ((start < 0 || dur < 0) && d[15]) {
            const ts = gInt(tr, 3) || 1000;
            start = Math.floor((gInt(tr, 1) * 1000) / ts);
            dur = Math.floor((gInt(tr, 2) * 1000) / ts);
          }
          hdrs.set(hid, {
            itag: gInt(d, 3) || gInt(fid, 1),
            xtags: gStr(d, 5) || gStr(fid, 3),
            init: !!gInt(d, 8),
            seq: gInt(d, 9),
            start: Math.max(start, 0),
            dur: Math.max(dur, 0),
            len: gInt(d, 14),
            comp: gInt(d, 7),
            chunks: [],
          });
        } else if (ptype === UMP_MEDIA && payload.length) {
          const [hid, pos] = readVarint(payload, 0);
          const h = hdrs.get(hid);
          if (h) {
            h.chunks.push(payload.subarray(pos));
          }
        } else if (ptype === UMP_FORMAT_INIT_METADATA) {
          const d = pbParse(payload);
          const itag = gInt(gMsg(d, 2), 1);
          const end = gInt(d, 3);
          if (end > 0) {
            if (this.tracks[itag]) {
              this.tracks[itag].totalEndMs = end;
            } else {
              for (const trk of Object.values(this.tracks)) {
                if (!trk.initDone && !trk.totalEndMs) {
                  trk.totalEndMs = end;
                  break;
                }
              }
            }
          }
        } else if (ptype === UMP_NEXT_REQUEST_POLICY) {
          const d = pbParse(payload);
          backoffMs = gInt(d, 4);
          const ck = gBytes(d, 7);
          if (ck.length) this.cookie = ck;
        } else if (ptype === UMP_SABR_REDIRECT) {
          const d = pbParse(payload);
          redirectUrl = gStr(d, 1);
        } else if (ptype === UMP_SABR_ERROR) {
          const d = pbParse(payload);
          sabrError = `${gStr(d, 1)} (code ${gInt(d, 2)})`;
        } else if (ptype === UMP_RELOAD_PLAYER_RESPONSE) {
          reload = true;
        } else if (ptype === UMP_STREAM_PROTECTION_STATUS) {
          protection = gInt(pbParse(payload), 1);
        } else if (ptype === UMP_SABR_CONTEXT_UPDATE) {
          const d = pbParse(payload);
          const typ = gInt(d, 1);
          if (!(this.contexts.has(typ) && gInt(d, 5) === 2)) {
            this.contexts.set(typ, gBytes(d, 3));
            if (gInt(d, 4)) this.activeCtx.add(typ);
          }
        } else if (ptype === UMP_SABR_CONTEXT_SENDING_POLICY) {
          const d = pbParse(payload);
          gInts(d, 1).forEach(t => this.activeCtx.add(t));
          gInts(d, 2).forEach(t => this.activeCtx.delete(t));
          gInts(d, 3).forEach(t => {
            this.contexts.delete(t);
            this.activeCtx.delete(t);
          });
        }
      }

      if (sabrError) {
        throw new Error(`SABR error: ${sabrError}`);
      }

      if (redirectUrl) {
        if (++redirects > 20) throw new Error('Too many SABR redirects');
        this.sabrUrl = redirectUrl;
      }

      if (protection === 2 || protection === 3) {
        await this.renewPoToken();
      }

      if (reload) {
        if (++reloads > 4) throw new Error('Too many SABR player reloads');
        await this.refreshPlayer();
        continue;
      }

      let newSegments = 0;
      let sawMedia = false;

      for (const h of hdrs.values()) {
        let track = this.tracks[h.itag];
        if (!track) {
          for (const t of Object.values(this.tracks)) {
            if (t.bytes === 0 && !t.initDone) {
              this.tracks[h.itag] = t;
              t.itag = h.itag;
              if (t.fmt) t.fmt.itag = h.itag;
              track = t;
              break;
            }
          }
        }
        if (!track) continue;

        let data = concat(h.chunks);
        if (h.comp === 1) data = await gunzip(data);
        sawMedia = true;

        if (h.init) {
          track.addInit(data);
        } else {
          if (track.addSegment(h.seq, h.start, h.start + h.dur, data)) {
            newSegments++;
          }
          track.roundHeaders.push(h);
        }
      }

      for (const t of Object.values(this.tracks)) {
        t.flush();
      }

      const totalBytes = Object.values(this.tracks).reduce((acc, t) => acc + t.bytes, 0);
      let pct = 0;
      const validTracks = Object.values(this.tracks);
      if (validTracks.length && validTracks.every(t => t.totalEndMs > 0)) {
        const pcts = validTracks.map(t => Math.min(100, Math.round((t.endMs / t.totalEndMs) * 100)));
        pct = Math.min(...pcts);
      } else if (this.durationMs > 0) {
        pct = Math.min(100, Math.round((this.playerTimeMs() / this.durationMs) * 100));
      }

      if (onProgress) {
        onProgress({ bytes: totalBytes, percent: pct });
      }

      if (newSegments > 0) {
        idle = 0;
        reloads = 0;
      } else {
        if (this.nearEnd()) {
          break;
        }
        if (backoffMs > 0) {
        } else {
          idle++;
          if (idle >= 6) {
            if (sawMedia || Object.values(this.tracks).some(t => t.chunks.length > 0)) {
              break;
            }
            throw new Error('SABR stream returned no media chunks');
          }
          if (idle === 3) {
            await this.refreshPlayer();
          }
        }
      }

      const wait = backoffMs > 0 ? Math.max(100, Math.min(backoffMs, 5000)) : 100;
      await new Promise(r => setTimeout(r, wait));
    }

    for (const t of Object.values(this.tracks)) {
      t.close();
      if (!t.initDone) {
        throw new Error(`No init segment received for itag ${t.itag}`);
      }
    }

    const videoTrack = this.videoFmt ? this.tracks[this.videoFmt.itag] : null;
    const audioTrack = this.audioFmt ? this.tracks[this.audioFmt.itag] : null;

    const videoBlob = videoTrack && videoTrack.chunks.length
      ? new Blob(videoTrack.chunks, { type: this.videoFmt?.mimeType || 'video/mp4' })
      : null;

    const audioBlob = audioTrack && audioTrack.chunks.length
      ? new Blob(audioTrack.chunks, { type: this.audioFmt?.mimeType || 'audio/mp4' })
      : null;

    return { videoBlob, audioBlob, videoFmt: this.videoFmt, audioFmt: this.audioFmt };
  }
}
