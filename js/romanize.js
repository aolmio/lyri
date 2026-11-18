import { loadScript } from './net.js';
import { convert as thai } from './thai.js';
import { convert as korean } from './korean.js';
import { romanizationFor } from './translate.js';

const PINYIN_URL = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3/dist/index.js';
const KUROSHIRO_URL = 'https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js';
const ANALYZER_URL = 'https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js';
const DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/';

let kuroshiro = null;
let kuroshiroLoading = null;

async function ensureKuroshiro(onStatus) {
  if (kuroshiro) return kuroshiro;
  if (!kuroshiroLoading) {
    kuroshiroLoading = (async () => {
      if (onStatus) onStatus('Loading Japanese dictionary…');
      await loadScript(KUROSHIRO_URL);
      await loadScript(ANALYZER_URL);
      const K = window.Kuroshiro && window.Kuroshiro.default ? window.Kuroshiro.default : window.Kuroshiro;
      const A = window.KuromojiAnalyzer && window.KuromojiAnalyzer.default ? window.KuromojiAnalyzer.default : window.KuromojiAnalyzer;
      const instance = new K();
      await instance.init(new A({ dictPath: DICT_PATH }));
      kuroshiro = instance;
      return instance;
    })().catch(e => {
      kuroshiroLoading = null;
      throw e;
    });
  }
  return kuroshiroLoading;
}

export async function romanize(text, kind, options) {
  const { signal, thaiMode, plainThai, onStatus } = options;
  if (kind === 'zh') {
    try {
      await loadScript(PINYIN_URL);
      return window.pinyinPro.pinyin(text, { toneType: 'symbol', nonZh: 'consecutive' });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      return romanizationFor(text, signal);
    }
  }
  if (kind === 'ja') {
    try {
      const k = await ensureKuroshiro(onStatus);
      return await k.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      return romanizationFor(text, signal);
    }
  }
  if (kind === 'ko') return korean(text);
  if (kind === 'th') {
    if (thaiMode === 'plain') {
      if (plainThai) return plainThai;
      return romanizationFor(text, signal);
    }
    return thai(text);
  }
  return '';
}
