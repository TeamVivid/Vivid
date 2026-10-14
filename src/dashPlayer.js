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


const AHEAD_S = 30;
const BEHIND_S = 30;
const CHUNK_BYTES = 1024 * 1024;
const PROBE_BYTES = 512 * 1024;
const MARGIN_S = 0.25;

async function fetchRange(url, start, end, signal) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (!res.ok) throw new Error(`Stream request failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

function parseMp4Index(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const init = [];
  let sidx = null;
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    if (size === 1) size = Number(view.getBigUint64(pos + 8));
    if (size < 8 || type === 'moof' || type === 'mdat') break;
    if (type === 'ftyp' || type === 'moov' || type === 'sidx') {
      if (pos + size > buf.length) throw new Error('Stream index too large');
      if (type === 'sidx') sidx = { box: buf.subarray(pos, pos + size), end: pos + size };
      else init.push(buf.subarray(pos, pos + size));
    }
    pos += size;
  }
  if (!init.length || !sidx) throw new Error('Unsupported stream layout');

  const v = new DataView(sidx.box.buffer, sidx.box.byteOffset, sidx.box.byteLength);
  const version = v.getUint8(8);
  const timescale = v.getUint32(16);
  let p = 20;
  let earliest;
  let firstOffset;
  if (version === 0) {
    earliest = v.getUint32(p);
    firstOffset = v.getUint32(p + 4);
    p += 8;
  } else {
    earliest = Number(v.getBigUint64(p));
    firstOffset = Number(v.getBigUint64(p + 8));
    p += 16;
  }
  const count = v.getUint16(p + 2);
  p += 4;

  const segs = [];
  let byte = sidx.end + firstOffset;
  let t = earliest;
  for (let i = 0; i < count; i++, p += 12) {
    const size = v.getUint32(p) & 0x7fffffff;
    const dur = v.getUint32(p + 4);
    segs.push({ start: t / timescale, end: (t + dur) / timescale, byteStart: byte, byteEnd: byte + size - 1 });
    byte += size;
    t += dur;
  }

  const total = init.reduce((a, b) => a + b.length, 0);
  const initData = new Uint8Array(total);
  let off = 0;
  for (const b of init) {
    initData.set(b, off);
    off += b.length;
  }
  return { initData, segs };
}

export class DashMediaSourcePlayer {
  constructor({ video, videoFmt, audioFmt }) {
    this.video = video;
    this.fmts = [videoFmt, audioFmt];
    this.tracks = [];
    this.abort = new AbortController();
    this.destroyed = false;
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

    const indexes = await Promise.all(
      this.fmts.map(async f => parseMp4Index(await fetchRange(f.url, 0, PROBE_BYTES - 1, this.abort.signal)))
    );
    this.mediaSource.duration = Math.max(...indexes.map(i => i.segs[i.segs.length - 1].end));

    this.fmts.forEach((fmt, n) => {
      const sb = this.mediaSource.addSourceBuffer(fmt.mimeType);
      const t = { url: fmt.url, sb, queue: [indexes[n].initData], segs: indexes[n].segs, busy: false, retryAt: 0 };
      sb.addEventListener('updateend', () => this.pump(t));
      this.tracks.push(t);
    });
    this.tracks.forEach(t => this.pump(t));

    this.onSeeking = () => this.tick();
    this.video.addEventListener('seeking', this.onSeeking);
    this.timer = setInterval(() => this.tick(), 400);
    await this.tick();
  }

  pump(t) {
    if (this.destroyed || t.sb.updating || this.mediaSource.readyState === 'closed') return;
    const next = t.queue.shift();
    if (!next) return;
    try {
      t.sb.appendBuffer(next);
    } catch (e) {
      if (e.name !== 'QuotaExceededError') return;
      t.queue.unshift(next);
      const cutoff = this.video.currentTime - BEHIND_S;
      if (cutoff > 0) {
        try {
          t.sb.remove(0, cutoff);
        } catch {}
      }
    }
  }

  has(t, seg) {
    const r = t.sb.buffered;
    for (let i = 0; i < r.length; i++) {
      if (r.start(i) <= seg.start + MARGIN_S && r.end(i) >= seg.end - MARGIN_S) return true;
    }
    return false;
  }

  async fill(t, cur) {
    if (t.busy || t.sb.updating || t.queue.length || Date.now() < t.retryAt) return;
    let i = t.segs.findIndex(s => s.end > cur + 0.01);
    if (i < 0) return;
    while (i < t.segs.length && t.segs[i].start < cur + AHEAD_S && this.has(t, t.segs[i])) i++;
    if (i >= t.segs.length || t.segs[i].start >= cur + AHEAD_S) return;

    let j = i;
    let size = t.segs[i].byteEnd - t.segs[i].byteStart + 1;
    while (j + 1 < t.segs.length && size < CHUNK_BYTES && !this.has(t, t.segs[j + 1])) {
      j++;
      size += t.segs[j].byteEnd - t.segs[j].byteStart + 1;
    }

    t.busy = true;
    try {
      const data = await fetchRange(t.url, t.segs[i].byteStart, t.segs[j].byteEnd, this.abort.signal);
      if (this.destroyed) return;
      t.queue.push(data);
      this.pump(t);
      this.failures = 0;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('[DASH]', e.message);
      t.retryAt = Date.now() + 2000;
      if (++this.failures >= 6) {
        this.destroyed = true;
        this.video.dispatchEvent(new ErrorEvent('error', { message: e.message }));
      }
    } finally {
      t.busy = false;
    }
  }

  async tick() {
    if (this.destroyed) return;
    await Promise.all(this.tracks.map(t => this.fill(t, this.video.currentTime)));
    const done = this.tracks.every(t => this.has(t, t.segs[t.segs.length - 1]));
    if (done && this.mediaSource.readyState === 'open' && !this.tracks.some(t => t.sb.updating || t.queue.length)) {
      try {
        this.mediaSource.endOfStream();
      } catch {}
    }
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.abort.abort();
    this.video.removeEventListener('seeking', this.onSeeking);
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
