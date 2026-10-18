import { Agent, setGlobalDispatcher } from 'undici';
import { JSDOM } from 'jsdom';
import { getCachedItem, setCachedItem } from '../storage.js';
import { getProxyAgent } from '../proxyManager.js';
import { getCookieHeader, getAuthHeader } from '../cookies.js';
import { WEB, MWEB, TVHTML5, TVHTML5_SIMPLY } from '../constants.js';

try {
  setGlobalDispatcher(new Agent({ maxHeaderSize: 65536 }));
} catch {}

const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';

export function base64ToU8(base64) {
  let mod = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (mod.length % 4) mod += '=';
  const binary = atob(mod);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function u8ToBase64(u8, websafe = true) {
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  let b64 = btoa(binary);
  if (websafe) {
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return b64;
}

export function createColdStartCynToken(contentBinding = '', clientState = 1) {
  const cbBytes = new TextEncoder().encode(contentBinding);
  const ts = Math.floor(Date.now() / 1000);
  const r0 = Math.floor(Math.random() * 256);
  const r1 = Math.floor(Math.random() * 256);
  const header = [
    r0, r1,
    0, clientState & 0xFF,
    (ts >> 24) & 0xFF,
    (ts >> 16) & 0xFF,
    (ts >> 8) & 0xFF,
    ts & 0xFF
  ];
  const packet = new Uint8Array(2 + header.length + cbBytes.length);
  packet[0] = 34;
  packet[1] = header.length + cbBytes.length;
  packet.set(header, 2);
  packet.set(cbBytes, 2 + header.length);
  const keys = [r0, r1];
  for (let i = 2; i < packet.length; i++) {
    packet[i] ^= keys[(i - 2) % 2];
  }
  return u8ToBase64(packet, true);
}

export function descrambleChallenge(scrambledChallenge) {
  const buffer = base64ToU8(scrambledChallenge);
  if (buffer.length) return new TextDecoder().decode(buffer.map((b) => b + 97));
}

export function parseChallengeData(rawData) {
  let challengeData = [];
  if (rawData.length > 1 && typeof rawData[1] === 'string') {
    const descrambled = descrambleChallenge(rawData[1]);
    challengeData = JSON.parse(descrambled || '[]');
  } else if (rawData.length && typeof rawData[0] === 'object') {
    challengeData = rawData[0];
  }
  const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName] = challengeData;
  const script = Array.isArray(wrappedScript) ? wrappedScript.find(v => v && typeof v === 'string') : wrappedScript;
  return { messageId, interpreterHash, program, globalName, script };
}

async function getChallenge(clientKey, clientVersion, userAgent) {
  const isTv = clientKey === 'tv' || clientKey === 'tvhtml5' || clientKey === 'tv_simply' || clientKey === 'tvhtml5_simply';
  const isMweb = clientKey === 'mweb';
  const agent = getProxyAgent();
  const cookieHeader = getCookieHeader() || process.env.YT_COOKIE_HEADER || '';

  if (isTv) {
    const tvUa = 'Mozilla/5.0 (Linux arm64-v8a; Android 10) Cobalt/25.lts.30.1034958-gold (unlike Gecko) v8/8.8.278.17-jit gles Starboard/15, Sony_ATV_sdm845_13140765/52.1.C.0.268 (KDDI, SOV38) com.google.android.youtube.tv/5.30.301';
    const effectiveTvUa = userAgent && userAgent.includes('Cobalt') ? userAgent : tvUa;
    const tvHdrs = {
      'User-Agent': effectiveTvUa,
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/tv'
    };
    if (cookieHeader) {
      tvHdrs['Cookie'] = cookieHeader;
    }
    const fetchArgs = { headers: tvHdrs };
    if (agent) fetchArgs.agent = agent;

    const res = await fetch('https://www.youtube.com/tv_config?action_get_config=true&client=lb4&theme=cl', fetchArgs);
    if (!res.ok) throw new Error(`tv_config failed: ${res.status}`);
    let txt = await res.text();
    if (txt.startsWith(")]}'")) txt = txt.slice(4).trim();
    const data = JSON.parse(txt);
    if (!data.challengeParams?.R) throw new Error('No challengeParams.R in tv_config');
    const r = JSON.parse(data.challengeParams.R);
    const bg = r.bgChallenge;
    if (!bg) throw new Error('No bgChallenge in tv_config');

    const reqKey = data.challengeRequestKey || 'O43z0dpjhgX20SCx4KAo';
    const interpUrl = 'https:' + (bg.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue || '');
    let scriptText = await getCachedItem(`bg_interp_${bg.interpreterHash}`);
    if (!scriptText) {
      const sArgs = {};
      if (agent) sArgs.agent = agent;
      const scriptRes = await fetch(interpUrl, sArgs);
      if (!scriptRes.ok) throw new Error(`Fetch interpreter script failed: ${scriptRes.status}`);
      scriptText = await scriptRes.text();
      await setCachedItem(`bg_interp_${bg.interpreterHash}`, scriptText, 7 * 86400 * 1000);
    }

    return {
      interpreterHash: bg.interpreterHash,
      program: bg.program,
      globalName: bg.globalName,
      script: scriptText,
      challenge: r.challenge,
      requestKey: reqKey
    };
  }

  const clientName = isMweb ? 'MWEB' : 'WEB';
  const clientId = isMweb ? '2' : '1';
  const origin = isMweb ? 'https://m.youtube.com' : 'https://www.youtube.com';

  if (!isMweb) {
    try {
      const pageFetchArgs = {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': origin,
          'Referer': origin + '/',
        }
      };
      if (agent) pageFetchArgs.agent = agent;
      const pageRes = await fetch('https://www.youtube.com', pageFetchArgs);
      if (pageRes.ok) {
        const pageHtml = await pageRes.text();
        const ytcfgMatch = pageHtml.match(/ytcfg\.set\(({.+?})\);/s);
        const attMatch = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
        if (attMatch) {
          const raw = new Function('return ' + attMatch[1])();
          const r = typeof raw.R === 'string' ? JSON.parse(raw.R) : raw.R;
          const bg = r?.bgChallenge;
          if (bg?.program && bg?.interpreterUrl) {
            const ytcfg = ytcfgMatch ? JSON.parse(ytcfgMatch[1]) : null;
            const interpUrl = 'https:' + (bg.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue || '');
            let scriptText = await getCachedItem(`bg_interp_${bg.interpreterHash}`);
            if (!scriptText) {
              const sArgs = {};
              if (agent) sArgs.agent = agent;
              const scriptRes = await fetch(interpUrl, sArgs);
              if (scriptRes.ok) {
                scriptText = await scriptRes.text();
                await setCachedItem(`bg_interp_${bg.interpreterHash}`, scriptText, 7 * 86400 * 1000);
              }
            }
            if (scriptText) {
              return {
                interpreterHash: bg.interpreterHash,
                program: bg.program,
                globalName: bg.globalName,
                script: scriptText,
                challenge: r.challenge,
                requestKey: raw.challengeRequestKey || 'O43z0dpjhgX20SCx4KAo',
                ytcfg
              };
            }
          }
        }
      }
    } catch {}
  }

  const attHdrs = {
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'X-YouTube-Client-Name': clientId,
    'X-YouTube-Client-Version': clientVersion,
    'Origin': origin,
    'Referer': origin + '/',
  };
  if (cookieHeader) {
    attHdrs['Cookie'] = cookieHeader;
  }
  const authHeader = getAuthHeader(origin) || process.env.YT_AUTH_HEADER;
  if (authHeader) {
    attHdrs['Authorization'] = authHeader;
    attHdrs['X-Origin'] = origin;
    attHdrs['X-Goog-AuthUser'] = '0';
  }

  const fetchArgs = {
    method: 'POST',
    headers: attHdrs,
    body: JSON.stringify({
      context: { client: { clientName, clientVersion, hl: 'en', gl: 'US' } },
      engagementType: 'ENGAGEMENT_TYPE_UNBOUND'
    })
  };
  if (agent) fetchArgs.agent = agent;

  const attRes = await fetch(`${origin}/youtubei/v1/att/get?prettyPrint=false`, fetchArgs);
  if (!attRes.ok) throw new Error(`att/get failed: ${attRes.status}`);
  const attData = await attRes.json();
  const bg = attData.bgChallenge;
  if (!bg) throw new Error('No bgChallenge in att/get');

  const interpUrl = 'https:' + (bg.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue || '');
  let scriptText = await getCachedItem(`bg_interp_${bg.interpreterHash}`);
  if (!scriptText) {
    const sArgs = {};
    if (agent) sArgs.agent = agent;
    const scriptRes = await fetch(interpUrl, sArgs);
    if (!scriptRes.ok) throw new Error(`Fetch interpreter script failed: ${scriptRes.status}`);
    scriptText = await scriptRes.text();
    await setCachedItem(`bg_interp_${bg.interpreterHash}`, scriptText, 7 * 86400 * 1000);
  }

  return {
    interpreterHash: bg.interpreterHash,
    program: bg.program,
    globalName: bg.globalName,
    script: scriptText,
    challenge: attData.challenge,
    requestKey: 'O43z0dpjhgX20SCx4KAo'
  };
}

export async function mintCynTokens(videoId = '', visitorData = '', options = {}) {
  const clientKey = (options.clientKey || 'mweb').toLowerCase();
  const isTv = clientKey === 'tv' || clientKey === 'tvhtml5' || clientKey === 'tv_simply' || clientKey === 'tvhtml5_simply';
  const isTvSimply = clientKey === 'tv_simply' || clientKey === 'tvhtml5_simply';
  const clientConfig = clientKey === 'mweb' ? MWEB : (isTvSimply ? TVHTML5_SIMPLY : (isTv ? TVHTML5 : (clientKey === 'web' ? WEB : MWEB)));
  const clientVersion = options.clientVersion || clientConfig.clientVersion;
  const userAgent = isTv ? TVHTML5.userAgent : (options.userAgent || clientConfig.userAgent);

  const forceRefresh = options.forceRefresh || options.bypassCache;
  const cookieHeader = getCookieHeader() || process.env.YT_COOKIE_HEADER || '';
  const cacheKey = `cyn_tokens_${clientKey}_${videoId}_${visitorData || 'none'}${cookieHeader ? '_auth' : ''}`;
  const cached = await getCachedItem(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    const pot = cached.playerCynToken || cached.poToken || '';
    const gvs = cached.sabrCynToken || cached.gvsPoToken || cached.sabrPoToken || '';
    let isValid = false;
    if (clientKey === 'web') {
      isValid = Boolean(pot && gvs && gvs.startsWith('M'));
    } else if (clientKey === 'mweb' || isTv) {
      isValid = Boolean(pot && pot.startsWith('M'));
    } else {
      isValid = Boolean(pot);
    }
    if (isValid) return cached;
  }

  const isMweb = clientKey === 'mweb';
  const origin = isMweb ? 'https://m.youtube.com' : 'https://www.youtube.com';
  const pageUrl = isTv ? 'https://www.youtube.com/tv' : origin + '/';

  const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
    url: pageUrl,
    referrer: pageUrl,
    userAgent
  });

  if (cookieHeader) {
    try {
      const parts = cookieHeader.split(';');
      for (const part of parts) {
        if (part.trim()) dom.window.document.cookie = part.trim();
      }
    } catch {}
  }

  const previousGlobal = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    origin: globalThis.origin,
    navigator: globalThis.navigator,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
  });

  if (isTv) {
    const starboardMock = {
      version: 15,
      system: {
        getDeviceType: () => 'TV',
        getDeviceModel: () => 'Sony_ATV_sdm845_13140765',
        getBrand: () => 'Sony',
        getYear: () => 2024,
        getSystemPath: () => '',
        getLocale: () => 'en-US',
      }
    };
    const h5vccMock = {
      system: {
        getDeviceType: () => 'TV',
        getDeviceModel: () => 'Sony_ATV_sdm845_13140765',
        getBrand: () => 'Sony',
        getYear: () => 2024,
        getAdvertisingId: () => '',
        getLimitAdTracking: () => false,
        getSystemPath: () => '',
      },
      caching: { clearCache: () => {} },
      storage: { clear: () => {} },
      crashLog: { register: () => {} },
    };
    globalThis.starboard = starboardMock;
    globalThis.h5vcc = h5vccMock;
    dom.window.starboard = starboardMock;
    dom.window.h5vcc = h5vccMock;

    const screenMock = {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1080,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: { type: 'landscape-primary', angle: 0 }
    };
    try {
      Object.defineProperty(globalThis, 'screen', { value: screenMock, configurable: true, writable: true });
      Object.defineProperty(dom.window, 'screen', { value: screenMock, configurable: true, writable: true });
    } catch {}
    dom.window.innerWidth = 1920;
    dom.window.innerHeight = 1080;
    dom.window.devicePixelRatio = 1.0;
  } else {
    const createGlMock = () => {
      const gl = {
        getExtension(ext) {
          if (ext === 'WEBGL_debug_renderer_info') {
            return {
              UNMASKED_VENDOR_WEBGL: 0x9245,
              UNMASKED_RENDERER_WEBGL: 0x9246
            };
          }
          if (ext === 'EXT_texture_filter_anisotropic' || ext === 'WEBKIT_EXT_texture_filter_anisotropic') {
            return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff };
          }
          return {};
        },
        getParameter(pname) {
          switch (pname) {
            case 0x9245: return 'Google Inc. (NVIDIA)';
            case 0x9246: return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            case 0x1f00: return 'WebKit';
            case 0x1f01: return 'WebKit WebGL';
            case 0x1f02: return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
            case 0x8b8c: return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
            case 0x0d33: return 16384;
            case 0x851c: return 16384;
            case 0x84e8: return 32;
            case 0x8dfa: return 512;
            case 0x8b4c: return 32;
            case 0x8869: return 32;
            case 0x0d57: return 8;
            case 0x0d52: return 16;
            case 0x0d53: return 16;
            case 0x0d54: return 24;
            case 0x0d55: return 8;
            case 0x0d56: return 0;
            case 0x846e: return 8;
            default: return 0;
          }
        },
        createBuffer() { return {}; },
        bindBuffer() {},
        bufferData() {},
        createProgram() { return {}; },
        createShader() { return {}; },
        shaderSource() {},
        compileShader() {},
        attachShader() {},
        linkProgram() {},
        useProgram() {},
        getShaderParameter() { return true; },
        getProgramParameter() { return true; },
        getAttribLocation() { return 0; },
        getUniformLocation() { return {}; },
        vertexAttribPointer() {},
        enableVertexAttribArray() {},
        uniformMatrix4fv() {},
        uniform1i() {},
        uniform1f() {},
        createTexture() { return {}; },
        bindTexture() {},
        texParameteri() {},
        texImage2D() {},
        createFramebuffer() { return {}; },
        bindFramebuffer() {},
        framebufferTexture2D() {},
        createRenderbuffer() { return {}; },
        bindRenderbuffer() {},
        renderbufferStorage() {},
        framebufferRenderbuffer() {},
        checkFramebufferStatus() { return 0x8CD5; },
        viewport() {},
        clearColor() {},
        clear() {},
        enable() {},
        disable() {},
        drawArrays() {},
        drawElements() {},
        readPixels(x, y, w, h, format, type, pixels) {
          if (pixels && pixels.fill) pixels.fill(1);
        }
      };
      return gl;
    };

    const create2dMock = (canvas) => {
      let _fillStyle = '#000000';
      let _strokeStyle = '#000000';
      let _font = '10px sans-serif';
      return {
        canvas,
        get fillStyle() { return _fillStyle; },
        set fillStyle(val) { _fillStyle = val; },
        get strokeStyle() { return _strokeStyle; },
        set strokeStyle(val) { _strokeStyle = val; },
        get font() { return _font; },
        set font(val) { _font = val; },
        textBaseline: 'alphabetic',
        textAlign: 'start',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        miterLimit: 10,
        shadowBlur: 0,
        shadowColor: 'rgba(0, 0, 0, 0)',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        globalAlpha: 1.0,
        globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: true,
        fillRect() {},
        strokeRect() {},
        clearRect() {},
        fillText() {},
        strokeText() {},
        measureText(text) {
          const len = (text || '').length;
          return {
            width: len * 8,
            actualBoundingBoxAscent: 10,
            actualBoundingBoxDescent: 3,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: len * 8,
            fontBoundingBoxAscent: 12,
            fontBoundingBoxDescent: 4
          };
        },
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        bezierCurveTo() {},
        arc() {},
        arcTo() {},
        ellipse() {},
        rect() {},
        fill() {},
        stroke() {},
        clip() {},
        isPointInPath() { return false; },
        isPointInStroke() { return false; },
        save() {},
        restore() {},
        scale() {},
        rotate() {},
        translate() {},
        transform() {},
        setTransform() {},
        resetTransform() {},
        getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; },
        createPattern() { return {}; },
        createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = 128;
            data[i + 1] = 128;
            data[i + 2] = 128;
            data[i + 3] = 255;
          }
          return { data, width: w, height: h, colorSpace: 'srgb' };
        },
        putImageData() {},
        drawImage() {}
      };
    };

    if (dom.window.HTMLCanvasElement) {
      dom.window.HTMLCanvasElement.prototype.getContext = function(type) {
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
          return createGlMock();
        }
        if (type === '2d') {
          return create2dMock(this);
        }
        return null;
      };
      dom.window.HTMLCanvasElement.prototype.toDataURL = function() {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAAyCAYAAAAZFsBDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAMhSURBVHhe7Z2/SxtRFMfv3Y9oEZG4KQiCihZB/AO0CIK4uAiCihZB/AM0OAgKgiCCi4OIiIgg';
      };
      globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
    }
    class MockWebGLRenderingContext {}
    globalThis.WebGLRenderingContext = MockWebGLRenderingContext;
    dom.window.WebGLRenderingContext = MockWebGLRenderingContext;
    class MockWebGL2RenderingContext {}
    globalThis.WebGL2RenderingContext = MockWebGL2RenderingContext;
    dom.window.WebGL2RenderingContext = MockWebGL2RenderingContext;

    class MockAudioNode {
      connect(target) { return target; }
      disconnect() {}
    }
    class MockAudioParam {
      constructor(val = 0) { this.value = val; }
      setValueAtTime() { return this; }
      linearRampToValueAtTime() { return this; }
      exponentialRampToValueAtTime() { return this; }
      setTargetAtTime() { return this; }
      setValueCurveAtTime() { return this; }
      cancelScheduledValues() { return this; }
    }
    class MockOscillatorNode extends MockAudioNode {
      constructor() {
        super();
        this.type = 'sine';
        this.frequency = new MockAudioParam(440);
        this.detune = new MockAudioParam(0);
      }
      start() {}
      stop() {}
    }
    class MockDynamicsCompressorNode extends MockAudioNode {
      constructor() {
        super();
        this.threshold = new MockAudioParam(-24);
        this.knee = new MockAudioParam(30);
        this.ratio = new MockAudioParam(12);
        this.reduction = 0;
        this.attack = new MockAudioParam(0.003);
        this.release = new MockAudioParam(0.25);
      }
    }
    class MockAudioContext {
      constructor() {
        this.sampleRate = 44100;
        this.state = 'running';
        this.destination = new MockAudioNode();
      }
      createOscillator() { return new MockOscillatorNode(); }
      createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
      createGain() { return { gain: new MockAudioParam(1), connect() {}, disconnect() {} }; }
      createAnalyser() {
        return {
          fftSize: 2048,
          frequencyBinCount: 1024,
          getByteFrequencyData(arr) { if (arr && arr.fill) arr.fill(1); },
          getFloatFrequencyData(arr) { if (arr && arr.fill) arr.fill(-50); },
          getByteTimeDomainData(arr) { if (arr && arr.fill) arr.fill(128); },
          connect() {},
          disconnect() {}
        };
      }
      createBuffer(channels, length, sampleRate) {
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData() { return new Float32Array(length); }
        };
      }
      close() { return Promise.resolve(); }
    }
    class MockOfflineAudioContext extends MockAudioContext {
      constructor(channels = 1, length = 44100, sampleRate = 44100) {
        super();
        this.channels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
      }
      startRendering() {
        const samples = new Float32Array(this.length);
        for (let i = 0; i < this.length; i++) {
          samples[i] = Math.sin((i / 44100) * 440 * 2 * Math.PI) * Math.exp(-i / 10000);
        }
        return Promise.resolve({
          numberOfChannels: this.channels,
          length: this.length,
          sampleRate: this.sampleRate,
          duration: this.length / this.sampleRate,
          getChannelData() { return samples; }
        });
      }
    }
    globalThis.AudioContext = MockAudioContext;
    globalThis.webkitAudioContext = MockAudioContext;
    globalThis.OfflineAudioContext = MockOfflineAudioContext;
    globalThis.webkitOfflineAudioContext = MockOfflineAudioContext;
    dom.window.AudioContext = MockAudioContext;
    dom.window.webkitAudioContext = MockAudioContext;
    dom.window.OfflineAudioContext = MockOfflineAudioContext;
    dom.window.webkitOfflineAudioContext = MockOfflineAudioContext;

    const chromeMock = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
      },
      csi: () => {},
      loadTimes: () => ({
        requestTime: Date.now() / 1000 - 1,
        startLoadTime: Date.now() / 1000 - 0.9,
        commitLoadTime: Date.now() / 1000 - 0.5,
        finishDocumentLoadTime: Date.now() / 1000 - 0.2,
        finishLoadTime: Date.now() / 1000 - 0.1,
        firstPaintTime: Date.now() / 1000 - 0.3,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2'
      })
    };
    globalThis.chrome = chromeMock;
    dom.window.chrome = chromeMock;

    const screenMock = {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1040,
      availLeft: 0,
      availTop: 0,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: { type: 'landscape-primary', angle: 0 }
    };
    try {
      Object.defineProperty(globalThis, 'screen', { value: screenMock, configurable: true, writable: true });
      Object.defineProperty(dom.window, 'screen', { value: screenMock, configurable: true, writable: true });
    } catch {}

    dom.window.innerWidth = 1920;
    dom.window.innerHeight = 919;
    dom.window.outerWidth = 1920;
    dom.window.outerHeight = 1040;
    dom.window.devicePixelRatio = 1.0;
  }

  let platform = 'Win32';
  if (isTv) platform = 'Linux arm64-v8a';
  else if (userAgent.includes('Android')) platform = 'Linux armv81';
  else if (userAgent.includes('Linux')) platform = 'Linux x86_64';
  else if (userAgent.includes('Mac')) platform = 'MacIntel';

  const nav = {
    userAgent,
    platform,
    appVersion: userAgent.replace(/^Mozilla\//, ''),
    vendor: isTv ? '' : 'Google Inc.',
    language: 'en-US',
    languages: ['en-US', 'en'],
    hardwareConcurrency: isTv ? 4 : 8,
    deviceMemory: isTv ? 2 : 8,
  };

  try {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  } catch {
    globalThis.navigator = nav;
  }

  try {
    const challenge = await getChallenge(clientKey, clientVersion, userAgent);
    const requestKey = challenge.requestKey || 'O43z0dpjhgX20SCx4KAo';

    if (challenge.ytcfg) {
      const ytObj = { config_: challenge.ytcfg };
      globalThis.yt = ytObj;
      if (dom.window) dom.window.yt = ytObj;
    }

    new Function(challenge.script)();

    let globalName = challenge.globalName;
    if (!globalName || !globalThis[globalName] || !globalThis[globalName].a) {
      globalName = Object.keys(globalThis).find(k => globalThis[k] && typeof globalThis[k].a === 'function');
    }
    const vm = globalThis[globalName];
    if (!vm || !vm.a) throw new Error(`BotGuard VM Init failed (globalName=${globalName})`);

    const vmFunctions = {};
    const vmSetupCallback = (asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) => {
      Object.assign(vmFunctions, { asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction });
    };

    await vm.a(challenge.program, vmSetupCallback, true, undefined, () => {}, [[], []], undefined, false, undefined);

    let waitLoops = 0;
    while (!vmFunctions.asyncSnapshotFunction && waitLoops++ < 100) {
      await new Promise(r => setTimeout(r, 5));
    }
    if (!vmFunctions.asyncSnapshotFunction) throw new Error('VM snapshot function timeout');

    const webPoSignalOutput = [];
    const snapshotArg = [undefined, undefined, webPoSignalOutput, undefined];

    const botguardResponse = await new Promise((resolve) => {
      vmFunctions.asyncSnapshotFunction(resolve, snapshotArg);
    });

    const agent = getProxyAgent();
    const itHdrs = {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
      'user-agent': userAgent,
      'origin': origin,
      'referer': pageUrl
    };
    const itFetchArgs = {
      method: 'POST',
      headers: itHdrs,
      body: JSON.stringify([requestKey, botguardResponse])
    };
    if (agent) itFetchArgs.agent = agent;

    const itRes = await fetch(`${origin}/api/jnn/v1/GenerateIT`, itFetchArgs);
    if (!itRes.ok) throw new Error(`GenerateIT failed: ${itRes.status}`);
    const itData = await itRes.json();
    const integrityToken = itData[0] || itData[3];
    const ttl = Number(itData[1] || 43200);

    if (!webPoSignalOutput[0]) {
      throw new Error('WebPoSignal minter factory not produced');
    }

    const getMinter = webPoSignalOutput[0];
    const minter = await getMinter(base64ToU8(integrityToken));

    let playerCynToken = '';
    let sabrCynToken = '';

    if (clientKey === 'web') {
      const playerBytes = await minter(new TextEncoder().encode(visitorData || ''));
      playerCynToken = u8ToBase64(playerBytes, true);
      const gvsTarget = videoId || visitorData || '';
      const gvsBytes = await minter(new TextEncoder().encode(gvsTarget));
      sabrCynToken = u8ToBase64(gvsBytes, true);
    } else if (clientKey === 'mweb') {
      const playerBytes = await minter(new TextEncoder().encode(videoId || ''));
      playerCynToken = u8ToBase64(playerBytes, true);
      sabrCynToken = playerCynToken;
      if (visitorData) {
        const gvsBytes = await minter(new TextEncoder().encode(visitorData));
        sabrCynToken = u8ToBase64(gvsBytes, true);
      }
    } else if (isTv) {
      const tvBytes = await minter(new TextEncoder().encode(visitorData || ''));
      playerCynToken = u8ToBase64(tvBytes, true);
      const gvsTarget = videoId || visitorData || '';
      const gvsBytes = await minter(new TextEncoder().encode(gvsTarget));
      sabrCynToken = u8ToBase64(gvsBytes, true);
    } else {
      const playerBytes = await minter(new TextEncoder().encode(videoId || ''));
      playerCynToken = u8ToBase64(playerBytes, true);
      sabrCynToken = playerCynToken;
      if (visitorData) {
        const gvsBytes = await minter(new TextEncoder().encode(visitorData));
        sabrCynToken = u8ToBase64(gvsBytes, true);
      }
    }

    const result = {
      playerCynToken,
      sabrCynToken,
      cynToken: playerCynToken,
      gvsCynToken: sabrCynToken,
      poToken: playerCynToken,
      gvsPoToken: sabrCynToken,
      sabrPoToken: sabrCynToken,
      ttl,
      integrityToken,
      expiresAt: Date.now() + Math.max(300, ttl - 60) * 1000
    };

    await setCachedItem(cacheKey, result, Math.max(300, ttl - 60) * 1000);
    return result;
  } finally {
    delete globalThis.starboard;
    delete globalThis.h5vcc;
    delete globalThis.yt;
    delete globalThis.chrome;
    delete globalThis.HTMLCanvasElement;
    delete globalThis.WebGLRenderingContext;
    delete globalThis.WebGL2RenderingContext;
    delete globalThis.AudioContext;
    delete globalThis.webkitAudioContext;
    delete globalThis.OfflineAudioContext;
    delete globalThis.webkitOfflineAudioContext;
    delete globalThis.starboard;
    delete globalThis.h5vcc;
    Object.assign(globalThis, previousGlobal);
  }
}

export default {
  mintCynTokens,
  createColdStartCynToken,
  base64ToU8,
  u8ToBase64
};
