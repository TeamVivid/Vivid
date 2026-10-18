import vm from 'node:vm';
import crypto from 'node:crypto';
import { WEB, MWEB, TVHTML5_SIMPLY } from '../constants.js';

function resolveClientVersion(c, clientKey) {
  const normC = (c || '').toUpperCase();
  const normKey = (clientKey || '').toLowerCase();
  if (normC === 'TVHTML5_SIMPLY' || normKey === 'tvhtml5_simply' || normKey === 'tv_simply' || normKey === 'tv') {
    return TVHTML5_SIMPLY.clientVersion || '1.0';
  }
  if (normC === 'MWEB' || normKey === 'mweb') {
    return MWEB.clientVersion;
  }
  if (normC === 'WEB' || normKey === 'web') {
    return WEB.clientVersion;
  }
  return null;
}

const playerCache = new Map();

export function loadPlayer(src) {
  let patched;
  const tailReWeb = /\}\)\(_yt_player\);\s*$/;
  const tailReTv = /\}\)\.call\(this\);\s*$/;
  if (tailReWeb.test(src)) {
    patched = src.replace(tailReWeb, 'g.__e=function(c){return eval(c)};})(_yt_player);');
  } else if (tailReTv.test(src)) {
    patched = src.replace(tailReTv, 'this.__e=function(c){return eval(c)};}).call(this);');
  } else {
    throw new Error('Unknown base.js structure: neither _yt_player nor call(this) found at the end');
  }

  const proxy = new Proxy(function () { return proxy; }, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : proxy),
    apply: () => proxy,
    construct: () => proxy,
    set: () => true,
  });

  const loc = { href: 'https://www.youtube.com/', hostname: 'www.youtube.com', protocol: 'https:' };
  const win = { location: loc, window: null, self: null, document: proxy };
  win.window = win;
  win.self = win;

  const ctx = {
    window: win,
    self: win,
    document: proxy,
    location: loc,
    navigator: { userAgent: 'Mozilla/5.0', language: 'en' },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    XMLHttpRequest: function () {},
    fetch: proxy,
    Request: function () {},
    Response: function () {},
    Headers: function () {},
    MutationObserver: function () {},
    requestAnimationFrame: setTimeout,
    Image: function () {},
    Event: function () {},
    CustomEvent: function () {},
    HTMLElement: function () {},
    Element: function () {},
    Node: function () {},
    WeakRef,
    Intl,
    crypto: crypto.webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Uint8Array,
    atob,
    btoa,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(patched, ctx, { timeout: 30000 });

  const ev = (c) => (ctx._yt_player && ctx._yt_player.__e ? ctx._yt_player.__e(c) : (ctx.__e || win.__e)(c));
  if (!ev) throw new Error('Player closure access could not be established');
  return { src, ctx, ev };
}

function callIn(ctx, fn, thisArg, args, timeout = 2000) {
  ctx.__fn = fn;
  ctx.__this = thisArg;
  ctx.__args = args;
  return vm.runInContext('__fn.apply(__this,__args)', ctx, { timeout });
}

export function findSigCalls(src) {
  const re = /([\w$]+)\((\d+),(\d+),([\w$]+)\((\d+),(\d+),[\w$]+\.s\)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    out.push({ fn: m[1], a: +m[2], b: +m[3], pre: m[4], pa: +m[5], pb: +m[6], pos: m.index });
  }
  return out;
}

export function makeSigDecoder(p) {
  const calls = findSigCalls(p.src);
  if (!calls.length) throw new Error('Signature call (…(a,b,X(c,d,k.s))) not found');
  const c = calls[0];
  const fn = p.ev(c.fn);
  const pre = p.ev(c.pre);
  const decode = (s) => callIn(p.ctx, fn, undefined, [c.a, c.b, callIn(p.ctx, pre, undefined, [c.pa, c.pb, s])]);
  decode.info = `${c.fn}(${c.a},${c.b},${c.pre}(${c.pa},${c.pb},s))`;
  return decode;
}

export function parseTable(src) {
  const re = /([\w$]+)="((?:[^"\\]|\\.)*)"\.split\(["\x27]([^"\x27]+)["\x27]\)/g;
  let match;
  while ((match = re.exec(src))) {
    const varName = match[1];
    const rawStr = match[2];
    const delim = match[3];
    let arr;
    try {
      arr = JSON.parse('"' + rawStr + '"').split(delim);
    } catch {
      arr = rawStr.split(delim);
    }
    const idx = arr.findIndex((x) => /_w8_$/.test(x) || /enhanced_except/.test(x));
    if (idx >= 0) return { name: varName, table: arr, fallbackIdx: idx, marker: arr[idx], delim };
  }
  throw new Error('String table not found');
}

export function topLevelFunctions(src) {
  const starts = [];
  const re = /(?:^|\n|;|,|var\s+)((?:g\.)?[\w$]+)=function\(([^)]*)\)\{/g;
  let m;
  while ((m = re.exec(src))) {
    starts.push({ name: m[1], params: m[2].split(',').map((x) => x.trim()), pos: m.index });
  }
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].pos : src.length;
    out.push({ ...starts[i], body: src.slice(starts[i].pos, end) });
  }
  return out;
}

export function makeNDecoder(p) {
  const t = parseTable(p.src);
  const tn = t.name.replace(/\$/g, '\\$');
  const probe = ['rL0MPqw_EDnWQ09-', 'JCdehKC42ZTATz-O'];
  const valid = (r, inp) => typeof r === 'string' && r !== inp && !r.startsWith(t.marker.slice(0, 8)) &&
    /^[A-Za-z0-9_-]+$/.test(r) && Math.abs(r.length - inp.length) <= 6;

  const cands = topLevelFunctions(p.src).filter((f) => f.params.length >= 3 && /catch\(/.test(f.body) &&
    new RegExp(tn + '\\[[\\w$]+\\^\\d+\\]').test(f.body));

  for (const f of cands) {
    const [N, L] = f.params;
    const cm = f.body.match(new RegExp('var ([\\w$]+)=' + L + '\\^' + N + '\\b')) ||
               f.body.match(new RegExp('var ([\\w$]+)=' + N + '\\^' + L + '\\b'));
    if (!cm) continue;
    const Cv = cm[1].replace(/\$/g, '\\$');
    const Ks = new Set([...f.body.matchAll(new RegExp(tn + '\\[' + Cv + '\\^(\\d+)\\]', 'g'))].map((x) => +x[1]));
    const needed = [...Ks].map((k) => k ^ t.fallbackIdx);
    if (!needed.length) continue;
    let fn;
    try {
      fn = p.ev(f.name);
    } catch {
      continue;
    }
    if (typeof fn !== 'function') continue;
    for (const C of new Set(needed)) {
      for (let n = 0; n < 256; n++) {
        const l = n ^ C;
        let r1, r2, r3;
        try {
          r1 = callIn(p.ctx, fn, {}, [n, l, probe[0]], 300);
          if (!valid(r1, probe[0])) continue;
          r2 = callIn(p.ctx, fn, {}, [n, l, probe[0]], 300);
          r3 = callIn(p.ctx, fn, {}, [n, l, probe[1]], 300);
        } catch {
          continue;
        }
        if (r1 === r2 && valid(r3, probe[1]) && r3 !== r1) {
          const dec = (v) => {
            const r = callIn(p.ctx, fn, {}, [n, l, v], 3000);
            if (typeof r !== 'string' || r.startsWith(t.marker.slice(0, 8))) {
              throw new Error('n-function returned fallback for ' + v);
            }
            return r;
          };
          dec.info = `${f.name}.call({}, ${n}, ${l}, n)  (Marker "${t.marker}" @ Table[${t.fallbackIdx}])`;
          return dec;
        }
      }
    }
  }
  throw new Error('n-function not found (' + cands.length + ' candidates checked)');
}

export function findUrlCtor(p) {
  const m = p.src.match(/(?:function\s+([\w$]+)|([\w$]+)=function)\s*\(([a-zA-Z0-9_$]+),\s*([a-zA-Z0-9_$]+)[^)]*\)\s*\{[^}]*?\3=new\s+[^;]+;\s*\3\.set\(["\x27]alr["\x27],\s*["\x27]yes["\x27]\)/);
  if (!m) return null;
  const fnName = m[1] || m[2];
  try {
    const fn = p.ev(fnName);
    if (typeof fn === 'function') return { fn, name: fnName };
  } catch {}
  return null;
}

export function decipherWithUrlCtor(urlCtorFn, rawUrl, sp, s) {
  const urlCtor = urlCtorFn(rawUrl, sp || '', s || '');
  const proto = Object.getPrototypeOf(urlCtor);
  for (const prop of Object.getOwnPropertyNames(proto)) {
    if (['constructor', 'clone', 'set', 'get'].includes(prop)) continue;
    if (typeof urlCtor[prop] === 'function') {
      try { urlCtor[prop](); } catch {}
    }
  }
  const u = new URL(rawUrl);
  if (s) {
    const rawSig = urlCtor.get(sp || 'sig');
    if (rawSig) u.searchParams.set(sp || 'signature', decodeURIComponent(rawSig));
  }
  const rawN = urlCtor.get('n');
  if (rawN) {
    u.searchParams.set('n', decodeURIComponent(rawN));
  }
  const c = u.searchParams.get('c');
  if (c && !u.searchParams.get('cver')) {
    const ver = resolveClientVersion(c);
    if (ver) u.searchParams.set('cver', ver);
  }
  return u.toString();
}

export function parseCipher(str) {
  const q = new URLSearchParams(str);
  const rawUrl = q.get('url');
  if (!rawUrl) return { url: '', s: null, sp: 'signature' };
  const u = new URL(rawUrl);
  for (const [k, v] of q.entries()) {
    if (k !== 'url' && k !== 's' && k !== 'sp') {
      u.searchParams.set(k, v);
    }
  }
  return { url: u.toString(), s: q.get('s'), sp: q.get('sp') || 'signature' };
}

export function finishUrl(urlStr, sigDec, nDec, s, sp) {
  const u = new URL(urlStr);
  if (s && sigDec) u.searchParams.set(sp || 'signature', decodeURIComponent(sigDec(s)));
  const n = u.searchParams.get('n');
  if (n && nDec) {
    u.searchParams.set('n', decodeURIComponent(nDec(n)));
  } else if (nDec) {
    const m = u.pathname.match(/\/n\/([^/]+)/);
    if (m) {
      u.pathname = u.pathname.replace('/n/' + m[1], '/n/' + decodeURIComponent(nDec(decodeURIComponent(m[1]))));
    }
  }
  const c = u.searchParams.get('c');
  if (c && !u.searchParams.get('cver')) {
    const ver = resolveClientVersion(c);
    if (ver) u.searchParams.set('cver', ver);
  }
  return u.toString();
}

export function withPot(url, poToken) {
  if (!poToken) return url;
  if (url.includes('&pot=')) {
    return url.replace(/&pot=[^&]*/, `&pot=${poToken}`);
  }
  return url + (url.includes('?') ? '&' : '?') + `pot=${poToken}`;
}

export function getSignatureTimestamp(playerCode) {
  const patterns = [
    /signatureTimestamp[=:]\s*(\d+)/,
    /sts[=:]\s*(\d+)/,
    /playbackSignatureTimestamp[=:]\s*(\d+)/,
  ];
  for (const p of patterns) {
    const m = p.exec(playerCode);
    if (m) return parseInt(m[1], 10);
  }
  return 19800;
}

export function getPlayerEngine(playerKey, playerCode) {
  let engine = playerCache.get(playerKey);
  if (engine) return engine;

  const player = loadPlayer(playerCode);
  const urlCtor = findUrlCtor(player);
  let sigDec = null;
  let nDec = null;

  const getSig = () => {
    if (!sigDec) sigDec = makeSigDecoder(player);
    return sigDec;
  };

  const getN = () => {
    if (!nDec) nDec = makeNDecoder(player);
    return nDec;
  };

  engine = {
    player,
    urlCtor,
    getSig,
    getN,
    sts: getSignatureTimestamp(playerCode),
    decipher(urlOrCipher) {
      const isCipher = urlOrCipher.includes('&url=') || urlOrCipher.startsWith('s=') || urlOrCipher.startsWith('url=');
      const c = isCipher ? parseCipher(urlOrCipher) : { url: urlOrCipher, s: null, sp: null };
      if (urlCtor) {
        return decipherWithUrlCtor(urlCtor.fn, c.url, c.sp, c.s);
      }
      return finishUrl(c.url, c.s ? getSig() : null, getN(), c.s, c.sp);
    }
  };

  playerCache.set(playerKey, engine);
  return engine;
}

export function decipherStream(playerKey, playerCode, fmt, cynToken = null, clientKey = 'web', addPot = true) {
  const raw = typeof fmt === 'string' ? fmt : (fmt.url || fmt.signatureCipher || fmt.cipher);
  if (!raw) return '';

  const engine = getPlayerEngine(playerKey, playerCode);
  let finalUrl = engine.decipher(raw);

  try {
    const u = new URL(finalUrl);
    if (u.searchParams.has('c') && !u.searchParams.has('cver')) {
      const c = u.searchParams.get('c');
      const ver = resolveClientVersion(c, clientKey);
      if (ver) u.searchParams.set('cver', ver);
      finalUrl = u.toString();
    }
  } catch {}

  if (cynToken && addPot) {
    finalUrl = withPot(finalUrl, cynToken);
  }

  return finalUrl;
}

export default {
  loadPlayer,
  findSigCalls,
  makeSigDecoder,
  parseTable,
  topLevelFunctions,
  makeNDecoder,
  findUrlCtor,
  decipherWithUrlCtor,
  parseCipher,
  finishUrl,
  withPot,
  getSignatureTimestamp,
  getPlayerEngine,
  decipherStream,
};
