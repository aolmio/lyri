import { loadScript } from './net.js';
import { convert as thai } from './thai.js';
import { convert as korean } from './korean.js';
import { kanaToRomaji } from './kana.js';
import { googleRoman } from './translate.js';

const PINYIN_URL = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js';
const KUROSHIRO_URL = 'https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js';
const ANALYZER_URL = 'https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js';
const DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/';

const HAN = /[㐀-鿿]/;
const kuro = { state: 'idle', promise: null, inst: null };

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

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(v => {
      clearTimeout(id);
      resolve(v);
    }, e => {
      clearTimeout(id);
      reject(e);
    });
  });
}

export function kuroshiroState() {
  return kuro.state;
}

export function startKuroshiro() {
  if (kuro.promise) return kuro.promise;
  kuro.state = 'loading';
  kuro.promise = (async () => {
    try {
      await loadScript(KUROSHIRO_URL, 25000);
      await loadScript(ANALYZER_URL, 25000);
      const K = window.Kuroshiro && window.Kuroshiro.default ? window.Kuroshiro.default : window.Kuroshiro;
      const A = window.KuromojiAnalyzer && window.KuromojiAnalyzer.default ? window.KuromojiAnalyzer.default : window.KuromojiAnalyzer;
      const inst = new K();
      await withTimeout(inst.init(new A({ dictPath: DICT_PATH })), 45000);
      kuro.inst = inst;
      kuro.state = 'ready';
      return true;
    } catch (e) {
      kuro.state = 'failed';
      return false;
    }
  })();
  return kuro.promise;
}

export async function localJapanese(text) {
  if (kuro.state !== 'ready') return '';
  try {
    return await kuro.inst.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' });
  } catch (e) {
    return '';
  }
}

export async function japanese(text, signal) {
  const local = await localJapanese(text);
  if (local) return local;
  return googleRoman(text, signal);
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
