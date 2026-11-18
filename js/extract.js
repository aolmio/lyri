import { isJunk } from './lyrics.js';

export function cleanPageTitle(t) {
  return String(t || '')
    .replace(/^เนื้อเพลง\s*/i, '')
    .replace(/\s*-\s*Siamrath.*$/i, '')
    .replace(/\s*[|:-]\s*Siam\s*Zone.*$/i, '')
    .replace(/\s*::\s*Siam\s*Zone.*$/i, '')
    .replace(/\s*[|-]\s*SIAMZONE(\.COM)?\s*$/i, '')
    .replace(/\s*-\s*สยามโซน.*$/i, '')
    .replace(/\s*เนื้อเพลงถูกต้อง.*$/i, '')
    .trim();
}

export function cleanExtractedLyrics(raw) {
  if (!raw) return '';
  let text = String(raw)
    .replace(/\r/g, '')
    .replace(/^[ \t]*on Amazon Music Unlimited\s*\(ad\)[ \t]*(\n|$)/gim, '')
    .replace(/on Amazon Music Unlimited\s*\(ad\)/gi, '')
    .replace(/^[ \t]*ADVERTISEMENT[ \t]*(\n|$)/gm, '')
    .replace(/\bADVERTISEMENT\b/g, '');

  const startMarkers = [
    /ฟังเพลง\s+[^\n]+\n/,
    /ศิลปิน\s+[^\n]+\|\s*เพิ่มเมื่อ\s+[^\n]+\n/,
    /ดู\s*[\d,]+\s*ครั้ง\s*\/\s*แชร์\n/
  ];
  for (const sm of startMarkers) {
    const m = text.match(sm);
    if (m && m.index !== undefined && m.index < text.length * 0.45) text = text.slice(m.index + m[0].length);
  }

  const endMarkers = [
    /\n\s*เนื้อเพลง[^\n]*แบบคาราโอเกะ/i,
    /\n\s*เกี่ยวกับเพลง\s+/i,
    /\n\s*เพลง[^\n]*นี้\s*ถอดคำร้องและตรวจสอบโดย/i,
    /\n\s*คุณอาจจะสนใจเนื้อหาเหล่านี้/i,
    /\n\s*เนื้อเพลง[^\n]*ที่แสดงบนเว็บก็เพื่อประโยชน์ในการศึกษา/i,
    /\n\s*เนื้อเพลงอื่นๆ/i,
    /\n\s*เนื้อเพลง[^\n]*โดยศิลปินอื่น/i,
    /\n\s*ความคิดเห็น/i,
    /\n\s*แสดงความคิดเห็น/i
  ];
  for (const em of endMarkers) {
    const m = text.match(em);
    if (m && m.index !== undefined && m.index > 30) text = text.slice(0, m.index);
  }

  const out = [];
  for (const rawLine of text.split('\n')) {
    const l = rawLine.trim();
    if (!l) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (isJunk(l)) continue;
    out.push(l);
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const REMOVE = [
  'script', 'style', 'nav', 'header', 'footer', 'noscript', 'aside', 'iframe',
  'form', 'button', 'select', 'input', 'ul', 'ol', 'table', 'ins', 'svg', 'canvas',
  '.navbar', '.nav', '.menu', '.breadcrumb', '.breadcrumbs', '.ad', '.ads',
  '.advertisement', '[class*="advert"]', '[id*="advert"]', '[class*="banner"]',
  '[id*="banner"]', '#comments', '.comments', '.comment-box', '[class*="comment"]',
  '[id*="comment"]', '.share', '.social', '.sidebar', '.related', '.footer',
  '.header', '.top-bar', '[class*="menu"]', '[id*="menu"]'
].join(',');

const SPECIFIC = ['[itemprop="description"]', '#lyric-content', '.lyric-content', '.lyrics-body', '.song-lyric', '#lyrics'];

function textWithBreaks(doc, el, blocks) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach(b => b.replaceWith(doc.createTextNode('\n')));
  clone.querySelectorAll(blocks).forEach(b => b.appendChild(doc.createTextNode('\n')));
  return clone.textContent;
}

export function extractTitleAndLyrics(html) {
  if (!html) return { title: '', lyrics: null };
  const d = new DOMParser().parseFromString(String(html).replace(/​/g, ''), 'text/html');
  let title = '';
  const h1 = d.querySelector('h1');
  const docTitle = d.querySelector('title');
  if (h1 && h1.textContent.trim()) title = cleanPageTitle(h1.textContent);
  if (!title && docTitle && docTitle.textContent.trim()) title = cleanPageTitle(docTitle.textContent);

  d.querySelectorAll(REMOVE).forEach(e => e.remove());
  d.querySelectorAll('a').forEach(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    if (isJunk(a.textContent.trim()) || /amazon|apple\.com|spotify|deezer|joox|login|register|movie|drama|board|clip|calendar|music\/thailyric\/?$/i.test(href)) a.remove();
  });

  for (const sel of SPECIFIC) {
    const el = d.querySelector(sel);
    if (!el) continue;
    const cleaned = cleanExtractedLyrics(textWithBreaks(d, el, 'p, div'));
    if (cleaned.split('\n').filter(Boolean).length >= 4) return { title, lyrics: cleaned };
  }

  const candidates = [...d.body.querySelectorAll('div, article, section, td, p, pre')];
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const directBr = [...el.children].filter(c => c.tagName === 'BR').length;
    const totalBr = el.querySelectorAll('br').length;
    const linkLen = [...el.querySelectorAll('a')].reduce((n, a) => n + a.textContent.trim().length, 0);
    const totalLen = el.textContent.trim().length;
    if (totalLen < 40) continue;
    if (linkLen / Math.max(1, totalLen) > 0.35) continue;
    const cleaned = cleanExtractedLyrics(textWithBreaks(d, el, 'p, div, li, h1, h2, h3, h4'));
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 4) continue;
    let valid = 0;
    let penalty = 0;
    for (const l of lines) {
      if (l.length > 150) penalty += 4;
      else if (/[฀-๿一-鿿က-႟぀-ヿ가-힯a-zA-Z]/.test(l)) valid++;
    }
    const score = valid - penalty + directBr * 2.5 - el.querySelectorAll('div').length * 1.2 + Math.min(totalBr, 40) * 0.3;
    if (score > bestScore && valid >= 4) {
      bestScore = score;
      best = { el, cleaned, valid };
    }
  }
  if (!best) return { title, lyrics: null };

  let chosen = best;
  for (const child of best.el.querySelectorAll('div, article, section, td, p, pre')) {
    const cleaned = cleanExtractedLyrics(textWithBreaks(d, child, 'p, div'));
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= Math.max(4, best.valid * 0.65) && cleaned.length < chosen.cleaned.length) {
      chosen = { el: child, cleaned, valid: lines.length };
    }
  }
  return { title, lyrics: chosen.cleaned };
}

export function parseJinaText(txt) {
  if (!txt || txt.length < 40) return { title: '', lyrics: null };
  let title = '';
  const tm = txt.match(/^Title:\s*(.+)$/m);
  if (tm) title = cleanPageTitle(tm[1]);
  const body = txt
    .replace(/^Title:.*$/m, '')
    .replace(/^URL Source:.*$/m, '')
    .replace(/^Markdown Content:.*$/m, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  return { title, lyrics: cleanExtractedLyrics(body) || null };
}
