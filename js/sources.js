import { settings } from './settings.js';
import { fetchT, viaProxy, jsonDirect, jsonVia } from './net.js';
import { parsePlain, parseLrc, cleanLines } from './lyrics.js';
import { parseSiamzone, splitTitle } from './siamzone.js';

const SZ = 'https://www.siamzone.com/music/thailyric/';

async function lrclib(q, signal) {
  const rows = await jsonDirect('https://lrclib.net/api/search?q=' + encodeURIComponent(q), signal);
  return rows
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
  const res = await jsonDirect('https://api.lyrics.ovh/suggest/' + encodeURIComponent(q), signal);
  return (res.data || []).slice(0, 8).map(x => ({
    source: 'Lyrics.ovh',
    title: x.title,
    artist: x.artist && x.artist.name,
    album: x.album && x.album.title,
    url: 'https://api.lyrics.ovh/v1/' + encodeURIComponent(x.artist.name) + '/' + encodeURIComponent(x.title),
    load: async loadSignal => {
      const body = await jsonDirect('https://api.lyrics.ovh/v1/' + encodeURIComponent(x.artist.name) + '/' + encodeURIComponent(x.title), loadSignal);
      if (!body.lyrics) throw new Error('No lyrics returned');
      return { lines: parsePlain(body.lyrics) };
    }
  }));
}

async function netease(q, signal) {
  const url = 'https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=' + encodeURIComponent(q) + '&type=1&offset=0&total=true&limit=10';
  const res = await jsonVia(url, signal);
  const songs = (res.result && res.result.songs) || [];
  return songs.map(x => ({
    source: 'NetEase',
    title: x.name,
    artist: (x.artists || []).map(a => a.name).join(', '),
    album: x.album && x.album.name,
    synced: true,
    url: 'https://music.163.com/#/song?id=' + x.id,
    load: async loadSignal => {
      const body = await jsonVia('https://music.163.com/api/song/lyric?id=' + x.id + '&lv=1&kv=1&tv=-1', loadSignal);
      const text = body.lrc && body.lrc.lyric;
      if (!text) throw new Error('No lyrics returned');
      return { lines: parseLrc(text) };
    }
  }));
}

function szItem(id, title, artist) {
  return {
    source: 'SiamZone',
    title,
    artist,
    lang: 'th',
    url: SZ + id,
    load: async signal => parseSiamzone(await viaProxy(SZ + id, signal))
  };
}

function szIdFrom(link) {
  const m = String(link || '').match(/siamzone\.com\/music\/thailyric\/(\d+)/);
  return m ? m[1] : null;
}

async function cseSearch(q, signal) {
  const key = settings.get('cseKey').trim();
  const cx = settings.get('cseCx').trim();
  if (!key || !cx) return [];
  const url = 'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(key) + '&cx=' + encodeURIComponent(cx) + '&num=10&q=' + encodeURIComponent(q);
  const res = await jsonDirect(url, signal);
  const out = [];
  const seen = new Set();
  for (const item of res.items || []) {
    const id = szIdFrom(item.link);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const info = splitTitle(item.title);
    out.push(szItem(id, info.title, info.artist));
  }
  return out;
}

function decodeBing(href) {
  try {
    const u = new URL(href).searchParams.get('u');
    if (u && u.startsWith('a1')) return atob(u.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
  } catch (e) {
    return href;
  }
  return href;
}

function harvestLinks(html, resolve) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const seen = new Set();
  doc.querySelectorAll('a[href]').forEach(a => {
    const id = szIdFrom(resolve(a.getAttribute('href') || ''));
    if (!id || seen.has(id)) return;
    seen.add(id);
    const info = splitTitle(a.getAttribute('title') || a.textContent);
    out.push(szItem(id, info.title || 'SiamZone #' + id, info.artist));
  });
  return out;
}

async function webFallback(q, signal) {
  const query = 'site:siamzone.com/music/thailyric ' + q;
  try {
    const html = await viaProxy('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), signal);
    const items = harvestLinks(html, h => {
      const m = h.match(/uddg=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : h;
    });
    if (items.length) return items;
  } catch (e) {
    if (signal.aborted) throw e;
  }
  try {
    const html = await viaProxy('https://www.bing.com/search?setlang=th&q=' + encodeURIComponent(query), signal);
    return harvestLinks(html, decodeBing);
  } catch (e) {
    if (signal.aborted) throw e;
    return [];
  }
}

async function artistPage(q, signal) {
  try {
    const html = await viaProxy(SZ + encodeURIComponent('เนื้อเพลง-' + q), signal);
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return harvestLinks(html, h => (h.startsWith('http') ? h : 'https://www.siamzone.com' + h))
      .filter(i => tokens.some(t => (i.title + ' ' + i.artist).toLowerCase().includes(t)));
  } catch (e) {
    if (signal.aborted) throw e;
    return [];
  }
}

async function siamzone(q, signal) {
  const direct = szIdFrom(q);
  if (direct) return [szItem(direct, '', '')];
  let items = [];
  try {
    items = await cseSearch(q, signal);
  } catch (e) {
    if (signal.aborted) throw e;
  }
  if (!items.length) items = await webFallback(q, signal);
  if (!items.length) items = await artistPage(q, signal);
  return items.slice(0, 10);
}

function textOf(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  clone.querySelectorAll('script,style,noscript,iframe,ins').forEach(n => n.remove());
  return clone.textContent;
}

export async function urlItems(url, signal) {
  const id = szIdFrom(url);
  if (id) return [szItem(id, '', '')];
  const html = await viaProxy(url, signal);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let best = '';
  const blocks = [...doc.querySelectorAll('[data-lyrics-container]')];
  if (blocks.length) {
    best = blocks.map(textOf).join('\n');
  } else {
    for (const el of doc.querySelectorAll('[class*="yric"],[id*="yric"]')) {
      const t = textOf(el);
      if (t.length > best.length) best = t;
    }
  }
  if (!best.trim()) throw new Error('No lyrics found on that page');
  const h1 = doc.querySelector('h1');
  const title = (h1 ? h1.textContent : doc.title || url).trim();
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    host = url;
  }
  return [{ source: host, title, artist: '', url, load: async () => ({ lines: parsePlain(best) }) }];
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
  { name: 'LRCLIB', setting: 'srcLrclib', search: lrclib },
  { name: 'Lyrics.ovh', setting: 'srcOvh', search: lyricsOvh },
  { name: 'NetEase', setting: 'srcNetease', search: netease },
  { name: 'SiamZone', setting: 'srcSiamzone', search: siamzone }
];

export { fetchT };
