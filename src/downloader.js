import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { SabrDownloader } from './sabrPlayer.js';

export const DOWNLOAD_FORMATS = {
  mkv: { label: 'MKV', ext: 'mkv', audioExt: 'mkv', mime: 'video/x-matroska' },
  mp4: { label: 'MP4', ext: 'mp4', audioExt: 'm4a', mime: 'video/mp4' },
  webm: { label: 'WebM', ext: 'webm', audioExt: 'webm', mime: 'video/webm' },
  mp3: { label: 'MP3 (audio only)', ext: 'mp3', audioExt: 'mp3', mime: 'audio/mpeg' },
};

export async function muxBlobs(videoBlob, audioBlob, format, onProgress) {
  if (!videoBlob && !audioBlob) {
    throw new Error('No media streams provided for muxing');
  }

  const { ext, audioExt, mime } = DOWNLOAD_FORMATS[format];
  const outName = `out.${videoBlob ? ext : audioExt}`;

  const ffmpeg = new FFmpeg();
  if (onProgress) {
    ffmpeg.on('progress', ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))));
  }
  await ffmpeg.load({ coreURL, wasmURL });

  try {
    const inputs = [];
    for (const [name, blob] of [['video.in', videoBlob], ['audio.in', audioBlob]]) {
      if (!blob) continue;
      await ffmpeg.writeFile(name, await fetchFile(blob));
      inputs.push(name);
    }

    const args = inputs.flatMap(name => ['-i', name]);
    if (inputs.length === 2) args.push('-map', '0:v:0', '-map', '1:a:0');
    if (format === 'mp3') args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
    else args.push('-c', 'copy');
    if (format === 'mp4') args.push('-movflags', '+faststart');
    args.push(outName);

    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`Muxing to ${format.toUpperCase()} failed (ffmpeg exit ${code})`);

    const data = await ffmpeg.readFile(outName);
    return new Blob([data], { type: videoBlob || format === 'mkv' ? mime : mime.replace('video/', 'audio/') });
  } finally {
    ffmpeg.terminate();
  }
}

const CHUNK_SIZE = 10 * 1024 * 1024;

export async function fetchStreamBlob(url, approxTotal, onProgress, abortSignal) {
  const parts = [];
  let received = 0;
  let total = approxTotal || 0;
  let mimeType = 'video/mp4';

  for (;;) {
    const size = CHUNK_SIZE;
    let chunk = [];
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(url, { headers: { Range: `bytes=${received}-${received + size - 1}` }, signal: abortSignal });
        if (res.status === 416) return new Blob(parts, { type: mimeType });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        chunk = [];
        let chunkBytes = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunk.push(value);
          chunkBytes += value.length;
          if (onProgress) onProgress(received + chunkBytes, total);
        }
        break;
      } catch (e) {
        if (e.name === 'AbortError' || attempt >= 3) throw e;
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
      }
    }

    const got = chunk.reduce((n, c) => n + c.length, 0);
    parts.push(...chunk);
    received += got;
    if (received === got) mimeType = res.headers.get('content-type') || mimeType;

    const rangeTotal = res.headers.get('content-range')?.match(/\/(\d+)$/);
    if (rangeTotal) total = Number(rangeTotal[1]);

    const finished = res.status !== 206 || got < size || (rangeTotal && received >= total);
    if (finished) return new Blob(parts, { type: mimeType });
  }
}

export async function downloadAdaptive({ format, videoUrl, audioUrl, approxVideoBytes, approxAudioBytes, onProgress, abortSignal }) {
  let vBytes = 0;
  let aBytes = 0;
  let vTotal = approxVideoBytes || 0;
  let aTotal = approxAudioBytes || 0;

  const updateCombined = () => {
    if (!onProgress) return;
    const totalBytes = vBytes + aBytes;
    const expected = (vTotal > 0 && aTotal > 0) ? (vTotal + aTotal) : (vTotal || aTotal || 0);
    const pct = expected > 0 ? Math.min(100, Math.round((totalBytes / expected) * 100)) : 0;
    onProgress({
      phase: 'downloading',
      bytes: totalBytes,
      total: expected,
      percent: pct,
    });
  };

  const videoPromise = videoUrl
    ? fetchStreamBlob(videoUrl, approxVideoBytes, (rec, tot) => {
        vBytes = rec;
        if (tot > 0) vTotal = tot;
        updateCombined();
      }, abortSignal)
    : Promise.resolve(null);

  const audioPromise = audioUrl
    ? fetchStreamBlob(audioUrl, approxAudioBytes, (rec, tot) => {
        aBytes = rec;
        if (tot > 0) aTotal = tot;
        updateCombined();
      }, abortSignal)
    : Promise.resolve(null);

  const [videoBlob, audioBlob] = await Promise.all([videoPromise, audioPromise]);

  if (onProgress) {
    onProgress({
      phase: 'merging',
      bytes: (videoBlob?.size || 0) + (audioBlob?.size || 0),
      total: (videoBlob?.size || 0) + (audioBlob?.size || 0),
      percent: 100,
    });
  }

  const muxed = await muxBlobs(videoBlob, audioBlob, format, (mergePct) => {
    if (onProgress) {
      onProgress({
        phase: 'merging',
        bytes: (videoBlob?.size || 0) + (audioBlob?.size || 0),
        total: (videoBlob?.size || 0) + (audioBlob?.size || 0),
        percent: Math.min(100, Math.round(mergePct * 100)),
      });
    }
  });

  return muxed;
}

export async function downloadSabr({ format, videoId, sabrInfo, videoFmt, audioFmt, duration, onProgress, abortSignal }) {
  const downloader = new SabrDownloader({ videoId, sabrInfo, videoFmt, audioFmt, durationS: duration });
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => downloader.cancel());
  }

  const { videoBlob, audioBlob } = await downloader.download((progress) => {
    if (onProgress) {
      onProgress({
        phase: 'downloading',
        bytes: progress.bytes,
        total: 0,
        percent: progress.percent,
      });
    }
  }, abortSignal);

  if (onProgress) {
    onProgress({
      phase: 'merging',
      bytes: (videoBlob?.size || 0) + (audioBlob?.size || 0),
      total: (videoBlob?.size || 0) + (audioBlob?.size || 0),
      percent: 100,
    });
  }

  const muxed = await muxBlobs(videoBlob, audioBlob, format, (mergePct) => {
    if (onProgress) {
      onProgress({
        phase: 'merging',
        bytes: (videoBlob?.size || 0) + (audioBlob?.size || 0),
        total: (videoBlob?.size || 0) + (audioBlob?.size || 0),
        percent: Math.min(100, Math.round(mergePct * 100)),
      });
    }
  });

  return muxed;
}
