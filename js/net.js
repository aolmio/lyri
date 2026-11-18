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
    if (s.aborted) { ctl.abort(); break; }
    s.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl.signal;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    }
  });
}

export async function fetchT(url, { signal, timeout = 12000, ...options } = {}) {
  const timer = new AbortController();
  const id = setTimeout(() => timer.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: combine(signal, timer.signal) });
  } finally {
    clearTimeout(id);
  }
}

const BUILTIN_PROXIES = [
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u)
];

function proxyMakers() {
  const custom = (settings.get('proxy') || '').trim();
  if (!custom) return BUILTIN_PROXIES;
  const own = u => (custom.includes('{url}') ? custom.replace('{url}', encodeURIComponent(u)) : custom + encodeURIComponent(u));
  return [own, ...BUILTIN_PROXIES];
}

export async function viaProxy(url, signal) {
  let last = null;
  for (const make of proxyMakers()) {
    if (signal && signal.aborted) throw abortError();
    try {
      const res = await fetchT(make(url), { signal });
      if (res.ok) {
        const text = await res.text();
        if (text) return text;
      }
    } catch (e) {
      if (signal && signal.aborted) throw e;
      last = e;
    }
  }
  throw last || new Error('All proxies failed');
}

export async function jsonVia(url, signal) {
  return JSON.parse(await viaProxy(url, signal));
}

export async function jsonDirect(url, signal) {
  const res = await fetchT(url, { signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const scripts = new Map();

export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => {
        scripts.delete(src);
        reject(new Error('Failed to load ' + src));
      };
      document.head.append(tag);
    }));
  }
  return scripts.get(src);
}
