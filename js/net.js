import { settings } from './settings.js';

export function isAbort(e) {
  return !!e && (e.name === 'AbortError' || e.name === 'Aborted');
}

export function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function combine(...signals) {
  const ctl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctl.abort();
      break;
    }
    s.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl.signal;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    }
  });
}

export function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function decodeBuffer(buf, contentType = '') {
  const bytes = new Uint8Array(buf);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const head = utf8.slice(0, 2500).toLowerCase();
  const legacy =
    /tis-620|windows-874|iso-8859-11/.test(String(contentType).toLowerCase()) ||
    /charset=["']?(tis-620|windows-874|iso-8859-11)/.test(head) ||
    (utf8.includes('�') && /siamzone\.com/.test(head));
  if (legacy) {
    try {
      return new TextDecoder('windows-874').decode(bytes);
    } catch (e) {
      return utf8;
    }
  }
  return utf8;
}

export async function request(url, { signal, timeout = 10000, as = 'text', headers, method, body } = {}) {
  const timer = new AbortController();
  const id = setTimeout(() => timer.abort(), timeout);
  const sig = combine(signal, timer.signal);
  try {
    const res = await fetch(url, { signal: sig, headers, method, body });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (as === 'json') return JSON.parse(await res.text());
    return decodeBuffer(await res.arrayBuffer(), res.headers.get('content-type') || '');
  } catch (e) {
    if (timer.signal.aborted && !(signal && signal.aborted)) throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(id);
  }
}

export function firstSuccess(entries, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    const list = entries.map(e => ({ ...e, started: false }));
    const ctl = new AbortController();
    const sig = combine(signal, ctl.signal);
    const timers = [];
    let finished = false;
    let failed = 0;
    let lastError = null;
    const done = (fn, value) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      ctl.abort();
      fn(value);
    };
    if (signal) signal.addEventListener('abort', () => done(reject, abortError()), { once: true });
    const start = entry => {
      if (finished || entry.started) return;
      entry.started = true;
      Promise.resolve()
        .then(() => entry.run(sig))
        .then(value => {
          if (value === undefined || value === null || value === false) fail(new Error('Empty result'));
          else done(resolve, value);
        }, fail);
    };
    const fail = e => {
      lastError = e;
      failed++;
      if (finished) return;
      const next = list.find(x => !x.started);
      if (next) start(next);
      else if (failed >= list.length) done(reject, lastError || new Error('All attempts failed'));
    };
    list.forEach(entry => {
      if (!entry.delay) start(entry);
      else timers.push(setTimeout(() => start(entry), entry.delay));
    });
  });
}

const BUILTIN_PROXIES = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => 'https://thingproxy.freeboard.io/fetch/' + u
];

function proxyMakers() {
  const custom = String(settings.get('proxy') || '').trim();
  if (!custom) return BUILTIN_PROXIES;
  const own = u => (custom.includes('{url}') ? custom.replace('{url}', encodeURIComponent(u)) : custom + encodeURIComponent(u));
  return [own, ...BUILTIN_PROXIES];
}

export function proxied(url, { signal, as = 'text', validator, timeout = 9000, stagger = 1500 } = {}) {
  const entries = proxyMakers().map((make, i) => ({
    delay: i * stagger,
    run: async sig => {
      const data = await request(make(url), { signal: sig, as, timeout });
      if (typeof data === 'string' && data.trim().length < 20) throw new Error('Empty response');
      if (validator && !validator(data)) throw new Error('Rejected response');
      return data;
    }
  }));
  return firstSuccess(entries, signal);
}

export async function direct(url, { signal, as = 'text', validator, timeout = 9000 } = {}) {
  const data = await request(url, { signal, as, timeout });
  if (validator && !validator(data)) throw new Error('Rejected response');
  return data;
}

export function jina(url, { signal, timeout = 10000, text = false, validator } = {}) {
  return direct('https://r.jina.ai/' + url, {
    signal,
    timeout,
    validator,
    ...(text ? { headers: { 'X-Return-Format': 'text' } } : {})
  });
}

const scripts = new Map();

export function loadScript(src, timeout = 20000) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      const id = setTimeout(() => {
        tag.remove();
        scripts.delete(src);
        reject(new Error('Timed out loading ' + src));
      }, timeout);
      tag.src = src;
      tag.async = true;
      tag.onload = () => {
        clearTimeout(id);
        resolve();
      };
      tag.onerror = () => {
        clearTimeout(id);
        scripts.delete(src);
        reject(new Error('Failed to load ' + src));
      };
      document.head.append(tag);
    }));
  }
  return scripts.get(src);
}

export async function pool(items, size, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
