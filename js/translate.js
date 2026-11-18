import { request, pool } from './net.js';
import { alreadyTarget } from './lyrics.js';

export const TARGETS = {
  en: 'English',
  'zh-CN': '中文 (Chinese)',
  my: 'မြန်မာ (Burmese)'
};

export const SOURCE_CODE = { th: 'th', zh: 'zh-CN', ja: 'ja', ko: 'ko', my: 'my', en: 'en' };

const cache = new Map();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };

async function gtx(text, sl, tl, signal, rm) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + tl + '&dt=t' + (rm ? '&dt=rm' : '');
  const attempts = [() => request(url, { signal, timeout: 9000, as: 'json', method: 'POST', headers: FORM, body: 'q=' + encodeURIComponent(text) })];
  if (text.length < 1200) attempts.push(() => request(url + '&q=' + encodeURIComponent(text), { signal, timeout: 9000, as: 'json' }));
  for (const run of attempts) {
    try {
      const data = await run();
      if (data && data[0]) return data;
    } catch (e) {
      if (signal && signal.aborted) throw e;
    }
  }
  return null;
}

async function myMemory(text, sl, tl, signal) {
  if (!sl || sl === 'auto' || text.length > 480) return '';
  try {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + sl + '|' + tl;
    const res = await request(url, { signal, timeout: 8000, as: 'json' });
    return (res && res.responseData && res.responseData.translatedText) || '';
  } catch (e) {
    if (signal && signal.aborted) throw e;
    return '';
  }
}

function joinSegments(data) {
  let tr = '';
  for (const seg of data[0] || []) if (seg && seg[0]) tr += seg[0];
  return tr;
}

export async function googleRoman(text, signal, sl = 'auto') {
  const key = 'rm|' + sl + '|' + text;
  if (cache.has(key)) return cache.get(key);
  const data = await gtx(text, sl, 'en', signal, true);
  let rom = '';
  if (data) for (const seg of data[0] || []) if (seg && !seg[0] && seg[3]) rom += seg[3];
  cache.set(key, rom);
  return rom;
}

async function translateOne(text, sl, tl, signal) {
  const key = sl + '|' + tl + '|' + text;
  if (cache.has(key)) return cache.get(key);
  let out = '';
  const data = await gtx(text, sl === 'auto' ? 'auto' : sl, tl, signal, false);
  if (data) out = joinSegments(data).trim();
  if (!out) out = (await myMemory(text, sl, tl, signal)).trim();
  if (out) cache.set(key, out);
  return out;
}

async function translateBlock(texts, sl, tl, signal) {
  const joined = texts.join('\n');
  const key = 'blk|' + sl + '|' + tl + '|' + joined;
  if (cache.has(key)) return cache.get(key);
  const data = await gtx(joined, 'auto', tl, signal, false);
  if (!data) return null;
  const parts = joinSegments(data).split('\n').map(s => s.trim());
  while (parts.length > texts.length && !parts[parts.length - 1]) parts.pop();
  if (parts.length === texts.length && parts.every(Boolean)) {
    cache.set(key, parts);
    return parts;
  }
  return null;
}

function chunks(lines, indexes, limit) {
  const stanzas = [];
  let current = [];
  for (const i of indexes) {
    const broke = current.length && (!lines[i - 1] || i - current[current.length - 1] > 1 || current.length >= 16);
    if (broke) {
      stanzas.push(current);
      current = [];
    }
    current.push(i);
  }
  if (current.length) stanzas.push(current);
  const out = [];
  let group = [];
  let size = 0;
  for (const st of stanzas) {
    const len = st.reduce((n, i) => n + lines[i].length + 1, 0);
    if (group.length && size + len > limit) {
      out.push(group);
      group = [];
      size = 0;
    }
    group = group.concat(st);
    size += len;
  }
  if (group.length) out.push(group);
  return out;
}

export async function translateLines(lines, sl, tl, signal, onItem) {
  const out = new Array(lines.length).fill('');
  const indexes = [];
  lines.forEach((text, i) => {
    if (text && !alreadyTarget(text, tl)) indexes.push(i);
  });
  const emit = (i, value) => {
    out[i] = value;
    if (onItem) onItem(i, value);
  };
  if (!indexes.length) return out;

  const failed = [];
  for (const group of chunks(lines, indexes, 3600)) {
    const part = await translateBlock(group.map(i => lines[i]), sl, tl, signal);
    if (part) group.forEach((i, k) => emit(i, part[k]));
    else failed.push(...group);
  }
  if (failed.length) {
    await pool(failed, 4, async i => {
      if (signal && signal.aborted) return;
      emit(i, await translateOne(lines[i], sl, tl, signal));
    });
  }
  return out;
}
