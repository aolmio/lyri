import { direct, proxied, jina } from './net.js';
import { parsePlain, parseLrc, cleanLines } from './lyrics.js';
import { extractTitleAndLyrics, parseJinaText } from './extract.js';
import { searchSiamzone, szItem, matchSiamzone, splitTitle } from './siamzone.js';

const one = fn => async (q, signal, emit) => {
  const items = await fn(q, signal);
  if (items.length) emit(items);
};

async function lrclib(q, signal) {
  const rows = await direct('https://lrclib.net/api/search?q=' + encodeURIComponent(q), { signal, as: 'json' });
  return (Array.isArray(rows) ? rows : [])
    .filter(x => x.plainLyrics || x.syncedLyrics)
    .slice(0, 12)
    .map(x => ({
      source: 'LRCLIB',
      title: x.trackName,
      artist: x.artistName,
      album: x.albumName,
      synced: !!x.syncedLyrics,
      url: 'https://lrclib.net/api/get/' + x.id,
      load: async () => ({ lines: x.syncedLyrics ? parseLrc(x.syncedLyrics) : parsePlain(x.plainLyrics) })
    }));
}

async function lyricsOvh(q, signal) {
  const res = await direct('https://api.lyrics.ovh/suggest/' + encodeURIComponent(q), { signal, as: 'json' });
  return ((res && res.data) || []).slice(0, 8).map(x => {
    const artist = (x.artist && x.artist.name) || '';
    const url = 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(x.title);
    return {
      source: 'Lyrics.ovh',
      title: x.title,
      artist,
      album: x.album && x.album.title,
      url,
      load: async loadSignal => {
        const body = await direct(url, { signal: loadSignal, as: 'json' });
        if (!body || !body.lyrics) throw new Error('No lyrics returned');
        return { lines: parsePlain(body.lyrics) };
      }
    };
  });
}

async function netease(q, signal) {
  const url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(q) + '&type=1&offset=0&limit=10';
  const res = await proxied(url, { signal, as: 'json', validator: d => d && d.result });
  return ((res.result && res.result.songs) || []).map(x => ({
    source: 'NetEase',
    title: x.name,
    artist: (x.artists || []).map(a => a.name).join(', '),
    album: x.album && x.album.name,
    synced: true,
    url: 'https://music.163.com/#/song?id=' + x.id,
    load: async loadSignal => {
      const body = await proxied('https://music.163.com/api/song/lyric?id=' + x.id + '&lv=1&kv=1&tv=-1', { signal: loadSignal, as: 'json', validator: d => d && d.lrc });
      const text = body.lrc && body.lrc.lyric;
      if (!text) throw new Error('No lyrics returned');
      return { lines: parseLrc(text) };
    }
  }));
}

function textOf(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  clone.querySelectorAll('script,style,noscript,iframe,ins').forEach(n => n.remove());
  return clone.textContent;
}

export async function urlItems(url, signal) {
  const sz = matchSiamzone(url);
  if (sz) return [szItem(sz.type, sz.id, '', '')];
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    host = url;
  }
  const load = async loadSignal => {
    let html = null;
    try {
      html = await proxied(url, { signal: loadSignal, validator: t => /<\/?(html|body|div)\b/i.test(t) });
    } catch (e) {
      if (loadSignal.aborted) throw e;
    }
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const blocks = [...doc.querySelectorAll('[data-lyrics-container]')];
      if (blocks.length) {
        const h1 = doc.querySelector('h1');
        return { lines: parsePlain(blocks.map(textOf).join('\n')), title: h1 ? h1.textContent.trim() : '' };
      }
      const ex = extractTitleAndLyrics(html);
      if (ex.lyrics && !ex.lyrics.includes('�')) {
        const info = splitTitle(ex.title);
        return { lines: parsePlain(ex.lyrics), title: info.title, artist: info.artist };
      }
    }
    const ex = parseJinaText(await jina(url, { signal: loadSignal, text: true, timeout: 12000 }));
    if (!ex.lyrics) throw new Error('No lyrics found on that page');
    const info = splitTitle(ex.title);
    return { lines: parsePlain(ex.lyrics), title: info.title, artist: info.artist };
  };
  return [{ source: host, title: url, artist: '', url, load }];
}

export function manualItem(title, artist, text) {
  return {
    source: 'Manual',
    title: title || 'Untitled',
    artist: artist || '',
    url: '',
    load: async () => ({ lines: cleanLines(String(text).replace(/\r/g, '').split('\n').map(t => ({ text: t }))) })
  };
}

export const SOURCES = [
  { name: 'LRCLIB', setting: 'srcLrclib', search: one(lrclib) },
  { name: 'Lyrics.ovh', setting: 'srcOvh', search: one(lyricsOvh) },
  { name: 'NetEase', setting: 'srcNetease', search: one(netease) },
  { name: 'SiamZone', setting: 'srcSiamzone', search: searchSiamzone }
];
