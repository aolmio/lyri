import { fetchT, sleep } from './net.js';
import { alreadyTarget } from './lyrics.js';

export const TARGETS = {
  en: 'English',
  'zh-CN': '中文 (Chinese)',
  my: 'မြန်မာ (Burmese)'
};

const cache = new Map();

async function request(text, target, signal, wantRoman = false) {
  const key = target + '|' + (wantRoman ? 'r|' : '') + text;
  if (cache.has(key)) return cache.get(key);
  const base = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + target + '&dt=t' + (wantRoman ? '&dt=rm' : '');
  let data = null;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    try {
      const res = await fetchT(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'q=' + encodeURIComponent(text),
        signal,
        timeout: 15000
      });
      if (res.ok) data = await res.json();
    } catch (e) {
      if (signal && signal.aborted) throw e;
    }
    if (!data) {
      try {
        const res = await fetchT(base + '&q=' + encodeURIComponent(text), { signal, timeout: 15000 });
        if (res.ok) data = await res.json();
      } catch (e) {
        if (signal && signal.aborted) throw e;
      }
    }
    if (!data) await sleep(500 * (attempt + 1), signal);
  }
  if (!data) throw new Error('Google Translate is unavailable');
  let translated = '';
  let roman = '';
  for (const seg of data[0] || []) {
    if (seg[0]) translated += seg[0];
    else if (seg[3]) roman += seg[3];
  }
  const result = { tr: translated, rm: roman };
  cache.set(key, result);
  return result;
}

export async function romanizationFor(text, signal) {
  return (await request(text, 'en', signal, true)).rm;
}

async function block(texts, target, signal) {
  const res = await request(texts.join('\n'), target, signal);
  const parts = res.tr.split('\n').map(s => s.trim());
  if (parts.length === texts.length) return parts;
  if (texts.length === 1) return [res.tr.trim()];
  return null;
}

function stanzas(lines, indexes) {
  const groups = [];
  let current = [];
  for (const i of indexes) {
    const breaks = current.length && (!lines[i - 1] || current.length >= 12 || i - current[current.length - 1] > 1);
    if (breaks) {
      groups.push(current);
      current = [];
    }
    current.push(i);
  }
  if (current.length) groups.push(current);
  return groups;
}

export async function translateLines(lines, target, signal, onItem) {
  const out = new Array(lines.length).fill('');
  const indexes = [];
  lines.forEach((text, i) => {
    if (text && !alreadyTarget(text, target)) indexes.push(i);
  });
  if (!indexes.length) return out;
  const emit = (i, value) => {
    out[i] = value;
    if (onItem) onItem(i, value);
  };
  const total = indexes.reduce((n, i) => n + lines[i].length + 1, 0);
  if (total <= 4500) {
    const whole = await block(indexes.map(i => lines[i]), target, signal);
    if (whole) {
      indexes.forEach((i, k) => emit(i, whole[k]));
      return out;
    }
  }
  for (const group of stanzas(lines, indexes)) {
    const part = await block(group.map(i => lines[i]), target, signal);
    if (part) {
      group.forEach((i, k) => emit(i, part[k]));
      continue;
    }
    for (const i of group) {
      const single = await block([lines[i]], target, signal);
      emit(i, single ? single[0] : '');
    }
  }
  return out;
}
