import { proxied, jina, direct, firstSuccess } from './net.js';
import { cleanLines, parsePlain, isJunk } from './lyrics.js';
import { extractTitleAndLyrics, parseJinaText, cleanPageTitle } from './extract.js';
import { settings } from './settings.js';

const BASE = 'https://www.siamzone.com/music/';
const ID_RX = /siamzone\.com\/music\/(thailyric|lyric)\/(\d+)/i;
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE']);
const REMOVE_TAGS = 'script,style,noscript,iframe,ins,nav,form,button,svg,video,audio,object,embed,canvas,template';
const BAD_CLASS = /(^|[\s_-])(ad|ads|adsbygoogle|advert|advertisement|adv|banner|share|sharing|sponsor|sponsored|social|breadcrumb|menu|navbar|nav|footer|comment|comments|related|toolbar|promo)([\s_-]|$)/i;
const END_MARKERS = /ถอดคำร้อง|สงวนลิขสิทธิ์|ที่แสดงบนเว็บก็เพื่อประโยชน์ในการศึกษา|เนื้อเพลงแบบคาราโอเกะได้มาจาก/;

export function matchSiamzone(text) {
  const m = String(text || '').match(ID_RX);
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
}

export function splitTitle(raw) {
  const s = cleanPageTitle(raw);
  let title = s;
  let artist = '';
  const bar = s.lastIndexOf(' | ');
  const dash = s.lastIndexOf(' - ');
  const i = bar >= 0 ? bar : dash;
  const width = 3;
  if (i > 0) {
    title = s.slice(0, i).trim();
    artist = s.slice(i + width).trim();
  }
  return { title, artist };
}

function collect(doc, head) {
  const walker = doc.createTreeWalker(doc.body, 1 | 4);
  walker.currentNode = head;
  let out = '';
  let node;
  while ((node = walker.nextNode())) {
    if (head.contains(node)) continue;
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === 'H1' || tag === 'H2' || tag === 'H3') break;
      if (tag === 'BR' || BLOCK_TAGS.has(tag)) out += '\n';
    } else {
      out += node.data.replace(/[\r\n\t]+/g, ' ');
    }
  }
  return out;
}

function toLines(raw) {
  const lines = raw.split('\n').map(t => t.replace(/\s+/g, ' ').trim());
  const cut = lines.findIndex(l => END_MARKERS.test(l));
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  return cleanLines(kept.map(text => ({ text })));
}

export function parseStructured(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h1 = doc.querySelector('h1');
  const titleTag = doc.querySelector('title');
  const info = splitTitle(h1 ? h1.textContent : titleTag ? titleTag.textContent : '');
  const heads = [...doc.querySelectorAll('h2,h3')];
  const main = heads.find(h => h.tagName === 'H2' && /^\s*เนื้อเพลง/.test(h.textContent));
  if (!main) throw new Error('Lyrics block not found');
  const kara = heads.find(h => h.tagName === 'H3' && /คาราโอเกะ/.test(h.textContent));
  const keep = e => e.contains(main) || (kara && e.contains(kara));
  doc.querySelectorAll(REMOVE_TAGS).forEach(e => {
    if (!keep(e)) e.remove();
  });
  [...doc.body.querySelectorAll('*')].forEach(e => {
    const label = (e.getAttribute('class') || '') + ' ' + (e.id || '');
    if (BAD_CLASS.test(label) && !keep(e)) e.remove();
  });
  const lines = toLines(collect(doc, main));
  if (lines.filter(l => l.text).length < 2) throw new Error('No lyrics found');
  let roman = null;
  if (kara) {
    const romLines = toLines(collect(doc, kara)).filter(l => l.text);
    const textLines = lines.filter(l => l.text);
    if (romLines.length === textLines.length) {
      let k = 0;
      roman = lines.map(l => (l.text ? romLines[k++].text : ''));
    }
  }
  return { lines, roman, title: info.title, artist: info.artist };
}

function fromExtract(ex) {
  const info = splitTitle(ex.title);
  return { lines: parsePlain(ex.lyrics), roman: null, title: info.title, artist: info.artist };
}

export function loadPage(type, id, signal) {
  const url = BASE + type + '/' + id;
  return firstSuccess([
    {
      delay: 0,
      run: async sig => {
        const html = await proxied(url, { signal: sig, validator: t => /<\/?(html|body|h1|h2|div)\b/i.test(t) });
        try {
          return parseStructured(html);
        } catch (e) {
          const ex = extractTitleAndLyrics(html);
          if (ex.lyrics && !ex.lyrics.includes('�')) return fromExtract(ex);
          throw new Error('Unreadable page');
        }
      }
    },
    {
      delay: 7000,
      run: async sig => {
        const txt = await jina(url, { signal: sig, text: true, timeout: 12000 });
        const ex = parseJinaText(txt);
        if (!ex.lyrics) throw new Error('Unreadable page');
        return fromExtract(ex);
      }
    }
  ], signal);
}

export function szItem(type, id, title, artist) {
  return {
    source: 'SiamZone',
    title: title || 'SiamZone #' + id,
    artist: artist || '',
    lang: 'th',
    url: BASE + type + '/' + id,
    load: signal => loadPage(type, id, signal)
  };
}

function expand(raw) {
  let extra = '';
  for (const m of raw.matchAll(/[?&]u=a1([A-Za-z0-9_-]{20,})/g)) {
    try {
      extra += '\n' + atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    } catch (e) {
      continue;
    }
  }
  for (const m of raw.matchAll(/uddg=([^&"'\s)<>]+)/g)) {
    try {
      extra += '\n' + decodeURIComponent(m[1]);
    } catch (e) {
      continue;
    }
  }
  return raw + extra;
}

export function parseLinks(rawInput) {
  const songs = [];
  const artistUrls = [];
  const seen = new Set();
  if (!rawInput) return { songs, artistUrls };

  const add = (type, id, rawTitle) => {
    const key = type + '/' + id;
    if (!id || seen.has(key)) return;
    let cleaned = cleanPageTitle(rawTitle)
      .replace(/^Siamzone\.com\s*[:|-]?\s*/i, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || /^siam\s*zone/i.test(cleaned) || /^\d+$/.test(cleaned)) cleaned = '';
    seen.add(key);
    const info = splitTitle(cleaned);
    songs.push({ type, id, title: info.title, artist: info.artist });
  };

  let raw = expand(String(rawInput));
  raw = raw.replace(/%(?:25)?([0-9A-Fa-f]{2})/g, (m, hex) => {
    const code = parseInt(hex, 16);
    return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : m;
  });

  for (const im of raw.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi)) {
    const t = im[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
    const m = im[2].trim().match(ID_RX);
    if (m) add(m[1].toLowerCase(), m[2], t);
  }

  try {
    const d = new DOMParser().parseFromString(raw, 'text/html');
    d.querySelectorAll('a[href]').forEach(a => {
      let href = a.getAttribute('href') || '';
      try {
        href = decodeURIComponent(href);
      } catch (e) {
        href = a.getAttribute('href') || '';
      }
      const m = href.match(ID_RX) || href.match(/\/music\/(thailyric|lyric)\/(\d+)/i);
      if (m) {
        let t = a.getAttribute('title') || a.textContent.trim();
        if (!t || /^https?:\/\//i.test(t) || t.length < 2) {
          const p = a.closest('div, li, tr, h2, h3, article');
          const hEl = p && p.querySelector('h2, h3, h4, b, strong');
          if (hEl) t = hEl.textContent.trim();
        }
        if (t && !isJunk(t)) add(m[1].toLowerCase(), m[2], t);
        else add(m[1].toLowerCase(), m[2], '');
        return;
      }
      const am = href.match(/siamzone\.com\/music\/thailyric\/([^/?#"'<>]+)/i);
      if (am && !/^(?:\d+|search|index|new_songs|new|top)$/i.test(am[1])) {
        const u = BASE + 'thailyric/' + am[1];
        if (!artistUrls.includes(u)) artistUrls.push(u);
      }
    });
  } catch (e) {
    seen.add('dom-error');
  }

  for (const mm of raw.matchAll(/\[([^\]]+)\]\(([^)]*siamzone\.com\/music\/(thailyric|lyric)\/(\d+)[^)]*)\)/gi)) {
    add(mm[3].toLowerCase(), mm[4], mm[1]);
  }

  for (const rm of raw.matchAll(/siamzone\.com\/music\/(thailyric|lyric)\/(\d+)/gi)) {
    if (seen.has(rm[1].toLowerCase() + '/' + rm[2])) continue;
    const start = Math.max(0, rm.index - 220);
    const ctx = raw.slice(start, Math.min(raw.length, rm.index + 220)).replace(/<[^>]+>/g, ' ');
    const tm = ctx.match(/เนื้อเพลง\s+([^\n|<>]{2,70})/);
    add(rm[1].toLowerCase(), rm[2], tm ? tm[1] : '');
  }
  return { songs, artistUrls };
}

export async function searchSiamzone(q, signal, emit) {
  const direct1 = matchSiamzone(q);
  if (direct1) {
    emit([szItem(direct1.type, direct1.id, '', '')]);
    return;
  }
  const found = new Set();
  const artistUrls = [];
  const publish = (list, filter) => {
    const fresh = [];
    for (const s of list) {
      const key = s.type + '/' + s.id;
      if (found.has(key)) continue;
      if (filter && !filter(s)) continue;
      found.add(key);
      fresh.push(szItem(s.type, s.id, s.title, s.artist));
    }
    if (fresh.length) emit(fresh);
  };
  const ingest = raw => {
    if (!raw) return;
    const { songs, artistUrls: found2 } = parseLinks(raw);
    publish(songs);
    for (const u of found2) if (!artistUrls.includes(u)) artistUrls.push(u);
  };

  const qSite = 'เนื้อเพลง ' + q + ' site:siamzone.com';
  const qNatural = 'เนื้อเพลง ' + q + ' siamzone';
  const hasSz = t => /siamzone\.com\/music\//i.test(t) || /siamzone/i.test(t);
  const key = String(settings.get('cseKey') || '').trim();
  const cx = String(settings.get('cseCx') || '').trim();

  const tasks = [
    () => jina('https://www.bing.com/search?q=' + encodeURIComponent(qSite), { signal, timeout: 12000, validator: hasSz }),
    () => jina('https://search.yahoo.com/search?p=' + encodeURIComponent(qNatural), { signal, timeout: 12000, validator: hasSz }),
    () => jina('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(qNatural), { signal, timeout: 12000, validator: hasSz }),
    () => proxied('https://search.yahoo.com/search?p=' + encodeURIComponent(qNatural), { signal, validator: hasSz }),
    () => proxied('https://www.bing.com/search?q=' + encodeURIComponent(qSite), { signal, validator: hasSz }),
    () => proxied('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(qNatural), { signal, validator: hasSz }),
    () => proxied(BASE + 'thailyric/' + encodeURIComponent(q.trim()), { signal, validator: t => /thailyric\/\d+/i.test(t) }),
    () => proxied(BASE + 'thailyric/' + encodeURIComponent('เนื้อเพลง-' + q.trim()), { signal, validator: t => /thailyric\/\d+/i.test(t) })
  ];
  if (key && cx) {
    tasks.unshift(async () => {
      const url = 'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(key) + '&cx=' + encodeURIComponent(cx) + '&num=10&q=' + encodeURIComponent(q);
      const res = await direct(url, { signal, as: 'json', timeout: 10000 });
      const items = (res.items || []).map(it => {
        const m = String(it.link || '').match(ID_RX);
        return m ? { type: m[1].toLowerCase(), id: m[2], ...splitTitle(it.title) } : null;
      }).filter(Boolean);
      publish(items);
      return null;
    });
  }

  await Promise.allSettled(tasks.map(async run => {
    try {
      ingest(await run());
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }));
  if (signal.aborted) return;

  if (found.size < 3 && artistUrls.length) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    await Promise.allSettled(artistUrls.slice(0, 2).map(async u => {
      try {
        const raw = await proxied(u, { signal, validator: t => /thailyric\/\d+/i.test(t) });
        const { songs } = parseLinks(raw);
        const matching = songs.filter(s => tokens.some(t => (s.title + ' ' + s.artist).toLowerCase().includes(t)));
        publish(matching.length ? matching : songs.slice(0, 8));
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }));
  }
}
