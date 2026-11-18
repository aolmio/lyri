import { cleanLines } from './lyrics.js';

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE']);
const REMOVE_TAGS = 'script,style,noscript,iframe,ins,nav,form,button,svg,video,audio,object,embed,canvas,template';
const BAD_CLASS = /(^|[\s_-])(ad|ads|adsbygoogle|advert|advertisement|adv|banner|share|sharing|sponsor|sponsored|social|breadcrumb|menu|navbar|nav|footer|comment|comments|related|toolbar|promo)([\s_-]|$)/i;
const END_MARKERS = /ถอดคำร้อง|สงวนลิขสิทธิ์|ที่แสดงบนเว็บก็เพื่อประโยชน์ในการศึกษา|เนื้อเพลงแบบคาราโอเกะได้มาจาก/;

export function splitTitle(raw) {
  let s = String(raw || '')
    .replace(/\s*[|\-–]\s*SIAMZONE(\.COM)?\s*$/i, '')
    .replace(/^เนื้อเพลง\s*/, '')
    .trim();
  let title = s;
  let artist = '';
  if (s.includes(' | ')) {
    const i = s.lastIndexOf(' | ');
    title = s.slice(0, i).trim();
    artist = s.slice(i + 3).trim();
  } else if (s.includes(' - ')) {
    const i = s.lastIndexOf(' - ');
    title = s.slice(0, i).trim();
    artist = s.slice(i + 3).trim();
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
      if (tag === 'BR') out += '\n';
      else if (BLOCK_TAGS.has(tag)) out += '\n';
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

export function parseSiamzone(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h1 = doc.querySelector('h1');
  const titleTag = doc.querySelector('title');
  const info = splitTitle(h1 ? h1.textContent : titleTag ? titleTag.textContent : '');
  const heads = [...doc.querySelectorAll('h2,h3')];
  const main = heads.find(h => h.tagName === 'H2' && /^\s*เนื้อเพลง/.test(h.textContent));
  if (!main) throw new Error('Lyrics block not found on this page');
  const kara = heads.find(h => h.tagName === 'H3' && /คาราโอเกะ/.test(h.textContent));
  doc.querySelectorAll(REMOVE_TAGS).forEach(e => {
    if (!e.contains(main) && !(kara && e.contains(kara))) e.remove();
  });
  [...doc.body.querySelectorAll('*')].forEach(e => {
    const label = (e.getAttribute('class') || '') + ' ' + (e.id || '');
    if (BAD_CLASS.test(label) && !e.contains(main) && !(kara && e.contains(kara))) e.remove();
  });
  const lines = toLines(collect(doc, main));
  if (!lines.length) throw new Error('No lyrics found on this page');
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
