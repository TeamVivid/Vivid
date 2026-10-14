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
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function formatId(f) {
  return concat([
    pbInt(1, f.itag),
    f.lmt ? pbInt(2, f.lmt) : new Uint8Array(0),
    f.xtags ? pbStr(3, f.xtags) : new Uint8Array(0),
  ]);
}

function clientInfo(visitor) {
  return concat([
    pbStr(12, 'Pico'),
    pbStr(13, 'A8110'),
    visitor ? pbStr(14, visitor) : new Uint8Array(0),
    pbInt(16, 28),
    pbStr(17, '1.73.21'),
    pbStr(18, 'Android'),
    pbStr(19, '10'),
    pbStr(21, 'en'),
    pbStr(22, 'US'),
    pbInt(67, -new Date().getTimezoneOffset()),
    pbStr(80, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  ]);
}

export class SabrMediaSourcePlayer {
  constructor({ video, sabrInfo, videoFmt, audioFmt }) {
    this.video = video;
    this.sabrUrl = sabrInfo.sabrUrl;
    this.visitor = sabrInfo.visitorData || '';
    this.ustreamer = b64ToBytes(sabrInfo.ustreamerConfig);
    this.fmts = { video: videoFmt, audio: audioFmt };
    this.tracks = {};
    this.cookie = null;
    this.contexts = new Map();
    this.activeCtx = new Set();
    this.nextOk = 0;
    this.destroyed = false;
    this.busy = false;
    this.failures = 0;
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

    for (const kind of ['video', 'audio']) {
      const fmt = this.fmts[kind];
      const sb = this.mediaSource.addSourceBuffer(fmt.mimeType);
      this.tracks[fmt.itag] = {
        kind,
        sb,
        queue: [],
        initDone: false,
        endMs: 0,
        totalEndMs: 0,
      };
      sb.addEventListener('updateend', () => {
        this.setDuration();
        this.pump(this.tracks[fmt.itag]);
      });
    }

    this.onTime = () => this.maybeFetch();
    this.onSeeking = () => this.maybeFetch(true);
    this.video.addEventListener('timeupdate', this.onTime);
    this.video.addEventListener('seeking', this.onSeeking);
    this.timer = setInterval(() => this.maybeFetch(), 500);

    await this.fetchAt(0);
    if (!Object.values(this.tracks).every(t => t.initDone)) throw new Error('No init segments received');
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

  bufferedEndMs(t) {
    const cur = this.video.currentTime;
    const r = t.sb.buffered;
    for (let i = 0; i < r.length; i++) {
      if (cur >= r.start(i) - 0.1 && cur <= r.end(i)) return Math.floor(r.end(i) * 1000);
    }
    return this.currentMs();
  }

  buildRequest(playerTimeMs) {
    const abr = concat([
      pbInt(18, 1920),
      pbInt(19, 1080),
      pbInt(27, 5),
      pbInt(28, Math.max(0, Math.floor(playerTimeMs))),
      pbInt(29, 0),
      pbInt(34, 5),
    ]);
    const ctxParts = [pbBytes(1, clientInfo(this.visitor))];
    if (this.cookie) ctxParts.push(pbBytes(3, this.cookie));
    const unsent = [];
    for (const [typ, value] of this.contexts) {
      if (this.activeCtx.has(typ)) ctxParts.push(pbBytes(5, concat([pbInt(1, typ), pbBytes(2, value)])));
      else unsent.push(typ);
    }
    for (const typ of unsent) ctxParts.push(pbInt(6, typ));
    return concat([
      pbBytes(1, abr),
      pbBytes(5, this.ustreamer),
      pbBytes(16, formatId(this.fmts.audio)),
      pbBytes(17, formatId(this.fmts.video)),
      pbBytes(19, concat(ctxParts)),
    ]);
  }

  async fetchAt(timeMs) {
    if (this.destroyed || this.busy) return;
    this.busy = true;
    try {
      let redirects = 0;
      for (;;) {
        const wait = this.nextOk - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        if (this.destroyed) return;

        const res = await fetch(`/api/v1/proxy/sabr?sabr_url=${encodeURIComponent(this.sabrUrl)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-protobuf', 'X-Goog-Visitor-Id': this.visitor },
          body: this.buildRequest(timeMs),
        });
        if (!res.ok) throw new Error(`SABR request failed (${res.status})`);

        const result = await this.processResponse(new Uint8Array(await res.arrayBuffer()));
        if (result.error) throw new Error(`SABR error: ${result.error}`);
        if (result.reload) throw new Error('SABR session expired');
        if (result.protection === 3 && !result.sawMedia) throw new Error('SABR attestation required');
        this.nextOk = Date.now() + Math.max(150, Math.min(result.backoffMs, 10000));

        if (result.redirect) {
          if (++redirects > 20) throw new Error('Too many SABR redirects');
          this.sabrUrl = result.redirect;
          if (!result.newSegments) continue;
        }
        this.failures = 0;
        break;
      }
    } catch (e) {
      console.warn('[SABR]', e.message);
      if (++this.failures >= 4 && !this.destroyed) {
        this.destroyed = true;
        this.video.dispatchEvent(new ErrorEvent('error', { message: e.message }));
      }
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
        const h = hdrs.get(payload[0]);
        if (h) {
          h.chunks.push(payload.subarray(1));
          h.size += payload.length - 1;
        }
      } else if (ptype === UMP_MEDIA_END && payload.length) {
        const h = hdrs.get(payload[0]);
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
        t.endMs = Math.max(t.endMs, h.start + h.dur);
        t.queue.push(data);
        res.newSegments++;
      }
    }

    for (const t of Object.values(this.tracks)) this.pump(t);
    return res;
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.video.removeEventListener('timeupdate', this.onTime);
    this.video.removeEventListener('seeking', this.onSeeking);
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
