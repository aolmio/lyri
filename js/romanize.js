import { loadScript } from './net.js';
import { convert as thai } from './thai.js';
import { convert as korean } from './korean.js';
import { kanaToRomaji } from './kana.js';
import { googleRoman } from './translate.js';

const PINYIN_URL = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js';
const HAN = /[\u3400-\u9FFF]/;

export const hasHan = text => HAN.test(text);

export function thaiTone(text) {
  return thai(text);
}

export function koreanRoman(text) {
  return korean(text);
}

export function quickJapanese(text) {
  return hasHan(text) ? '' : kanaToRomaji(text);
}

export function japanese(text, signal) {
  return googleRoman(text, signal, 'ja');
}

export async function pinyinChars(text) {
  await loadScript(PINYIN_URL, 20000);
  const api = window.pinyinPro;
  const chars = Array.from(text);
  let list = [];
  try {
    list = api.pinyin(text, { type: 'array' });
  } catch (e) {
    list = [];
  }
  if (list.length !== chars.length) {
    list = chars.map(c => {
      try {
        return api.pinyin(c, { type: 'array' })[0];
      } catch (e) {
        return c;
      }
    });
  }
  return chars.map((c, i) => [c, HAN.test(c) && list[i] && list[i] !== c ? list[i] : '']);
}
