const CONS = 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ';
const HIGH = 'ขฃฉฐถผฝศษสห';
const MID = 'กจฎฏดตบปอ';
const PRE = 'เแโไใ';
const MAI_EK = '่';
const MAI_THO = '้';
const MAI_TRI = '๊';
const MAI_CHAT = '๋';
const TONES = MAI_EK + MAI_THO + MAI_TRI + MAI_CHAT;
const MAI_HAN = 'ั';
const SARA_I = 'ิ';
const SARA_II = 'ี';
const SARA_UE = 'ึ';
const SARA_UEE = 'ื';
const SARA_U = 'ุ';
const SARA_UU = 'ู';
const SARA_AM = 'ำ';
const MAITAIKHU = '็';
const ABOVE = MAI_HAN + SARA_I + SARA_II + SARA_UE + SARA_UEE + SARA_U + SARA_UU + SARA_AM + MAITAIKHU;
const AA = 'า';
const SARA_A = 'ะ';
const THANTHAKHAT = '์';
const YAMOK = 'ๆ';

const INIT = {
  'ก': 'k', 'ข': 'kh', 'ฃ': 'kh', 'ค': 'kh', 'ฅ': 'kh', 'ฆ': 'kh', 'ง': 'ng', 'จ': 'ch', 'ฉ': 'ch',
  'ช': 'ch', 'ซ': 's', 'ฌ': 'ch', 'ญ': 'y', 'ฎ': 'd', 'ฏ': 't', 'ฐ': 'th', 'ฑ': 'th', 'ฒ': 'th',
  'ณ': 'n', 'ด': 'd', 'ต': 't', 'ถ': 'th', 'ท': 'th', 'ธ': 'th', 'น': 'n', 'บ': 'b', 'ป': 'p',
  'ผ': 'ph', 'ฝ': 'f', 'พ': 'ph', 'ฟ': 'f', 'ภ': 'ph', 'ม': 'm', 'ย': 'y', 'ร': 'r', 'ล': 'l',
  'ว': 'w', 'ศ': 's', 'ษ': 's', 'ส': 's', 'ห': 'h', 'ฬ': 'l', 'อ': '', 'ฮ': 'h'
};

const FINAL = {};
const setFinal = (group, value) => { for (const c of group) FINAL[c] = value; };
setFinal('กขฃคฅฆ', 'k');
setFinal('จชซฌฎฏฐฑฒดตถทธศษส', 't');
setFinal('บปผฝพฟภ', 'p');
setFinal('ญณนรลฬ', 'n');
setFinal('ม', 'm');
setFinal('ง', 'ng');
setFinal('ย', 'y');
setFinal('ว', 'w');

const FIN_ROM = { k: 'k', t: 't', p: 'p', n: 'n', m: 'm', ng: 'ng', y: 'i', w: 'o' };
const MARKS = { 1: '', 2: '̀', 3: '̂', 4: '́', 5: '̌' };
const CLUSTERS = new Set(['กร', 'กล', 'กว', 'ขร', 'ขล', 'ขว', 'คร', 'คล', 'คว', 'ตร', 'ปร', 'ปล', 'พร', 'พล', 'ผล', 'ฟร', 'ฟล', 'บร', 'บล', 'ดร']);
const SILENT_R = new Set(['ทร', 'สร', 'ศร']);
const EXCEPTIONS = { 'ก็': 'kô', 'สวัสดี': 'sà-wàt-di' };

const isC = c => typeof c === 'string' && CONS.includes(c);
const isSign = c => typeof c === 'string' && (ABOVE.includes(c) || c === AA || c === SARA_A);
const classOf = c => (HIGH.includes(c) ? 'h' : MID.includes(c) ? 'm' : 'l');

function toneNumber(cls, mark, dead, long) {
  if (mark === MAI_EK) return cls === 'l' ? 3 : 2;
  if (mark === MAI_THO) return cls === 'l' ? 4 : 3;
  if (mark === MAI_TRI) return 4;
  if (mark === MAI_CHAT) return 5;
  if (cls === 'm') return dead ? 2 : 1;
  if (cls === 'h') return dead ? 2 : 5;
  return dead ? (long ? 3 : 4) : 1;
}

function withTone(nucleus, tone) {
  return (nucleus[0] + MARKS[tone]).normalize('NFC') + nucleus.slice(1);
}

function syllable(s, i) {
  let p = i;
  let pre = null;
  if (PRE.includes(s[p])) { pre = s[p]; p++; }
  const c1 = s[p];
  if (!isC(c1)) return null;
  p++;
  let rom = INIT[c1];
  const lead = c1;
  const c2 = s[p];
  if (c1 === 'ห' && isC(c2) && 'งญนมยรลว'.includes(c2) && (pre || s[p + 1] !== undefined)) {
    rom = INIT[c2];
    p++;
  } else if (c1 === 'อ' && c2 === 'ย' && !pre && s[p + 1] !== undefined) {
    rom = 'y';
    p++;
  } else if (isC(c2)) {
    const pair = c1 + c2;
    let q = p + 1;
    while (TONES.includes(s[q])) q++;
    if (c2 === 'ว') {
      if (CLUSTERS.has(pair) && isSign(s[q])) { rom = INIT[c1] + 'w'; p++; }
    } else if (CLUSTERS.has(pair) && (pre || s[p + 1] !== undefined)) {
      rom = INIT[c1] + INIT[c2];
      p++;
    } else if (SILENT_R.has(pair) && (pre || s[p + 1] !== undefined)) {
      rom = 's';
      p++;
    } else if (pair === 'จร' && s[p + 1] === SARA_I) {
      rom = 'ch';
      p++;
    }
  }
  const cls = classOf(lead);
  let mark = null;
  const skip = q => { while (TONES.includes(s[q])) q++; return q; };
  const takeTone = () => { while (TONES.includes(s[p])) { mark = s[p]; p++; } };
  const takeFinal = () => {
    const x = s[p];
    if (!isC(x) || x === 'อ') return null;
    const y = s[p + 1];
    let isFinal;
    if (y === undefined || PRE.includes(y)) isFinal = true;
    else if (y === 'อ') isFinal = isSign(s[skip(p + 2)]);
    else isFinal = isC(y);
    if (!isFinal) return null;
    p++;
    return x;
  };
  let nuc = 'a';
  let long = false;
  let fin = null;
  takeTone();
  const ch = s[p];
  if (pre === 'เ') {
    const q1 = skip(p + 1);
    if (ch === SARA_II && s[q1] === 'ย') {
      p++; takeTone(); p++;
      nuc = 'ia'; long = true; takeTone();
      if (s[p] === SARA_A) { p++; long = false; } else fin = takeFinal();
    } else if (ch === SARA_UEE && s[q1] === 'อ') {
      p++; takeTone(); p++;
      nuc = 'uea'; long = true; takeTone();
      if (s[p] === SARA_A) { p++; long = false; } else fin = takeFinal();
    } else if (ch === SARA_I) {
      p++; takeTone();
      nuc = 'oe'; long = true; fin = takeFinal();
    } else if (ch === 'อ' && !isSign(s[p + 1])) {
      p++; takeTone();
      nuc = 'oe'; long = true;
      if (s[p] === SARA_A) { p++; long = false; }
    } else if (ch === AA) {
      p++;
      if (s[p] === SARA_A) { p++; nuc = 'o'; } else { nuc = 'a'; long = true; fin = 'ว'; }
    } else if (ch === 'ย' && !isSign(s[p + 1]) && !isC(s[p + 1])) {
      p++; nuc = 'oe'; long = true; fin = 'ย';
    } else if (ch === SARA_A) {
      p++; nuc = 'e';
    } else if (ch === MAITAIKHU) {
      p++; takeTone(); nuc = 'e'; fin = takeFinal();
    } else {
      nuc = 'e'; long = true; fin = takeFinal();
    }
  } else if (pre === 'แ') {
    nuc = 'ae';
    if (ch === SARA_A) p++;
    else if (ch === MAITAIKHU) { p++; takeTone(); fin = takeFinal(); }
    else { long = true; fin = takeFinal(); }
  } else if (pre === 'โ') {
    nuc = 'o';
    if (ch === SARA_A) p++;
    else { long = true; fin = takeFinal(); }
  } else if (pre === 'ไ' || pre === 'ใ') {
    nuc = 'a'; long = true; fin = 'ย';
    if (s[p] === 'ย' && s[p + 1] === undefined) p++;
  } else if (ch === MAI_HAN) {
    p++;
    if (s[p] === 'ว' && !isSign(s[p + 1])) {
      p++; nuc = 'ua'; long = true; takeTone();
      if (s[p] === SARA_A) { p++; long = false; } else fin = takeFinal();
    } else if (s[p] === 'ย' && !isSign(s[p + 1])) {
      p++; fin = 'ย';
    } else {
      takeTone(); fin = takeFinal();
    }
  } else if (ch === AA) {
    p++; takeTone(); long = true; fin = takeFinal();
  } else if (ch === SARA_AM) {
    p++; takeTone(); fin = 'ม';
  } else if (ch === SARA_I || ch === SARA_II) {
    p++; takeTone(); nuc = 'i'; long = ch === SARA_II; fin = takeFinal();
  } else if (ch === SARA_UE || ch === SARA_UEE) {
    p++; takeTone(); nuc = 'ue'; long = ch === SARA_UEE;
    if (s[p] === 'อ' && !isSign(s[p + 1])) p++;
    fin = takeFinal();
  } else if (ch === SARA_U || ch === SARA_UU) {
    p++; takeTone(); nuc = 'u'; long = ch === SARA_UU; fin = takeFinal();
  } else if (ch === SARA_A) {
    p++;
  } else if (ch === MAITAIKHU) {
    p++; takeTone(); nuc = 'o'; fin = takeFinal();
  } else if (ch === 'อ' && !isSign(s[p + 1])) {
    p++; takeTone(); nuc = 'o'; long = true; fin = takeFinal();
  } else if (ch === 'ร' && s[p + 1] === 'ร') {
    p += 2; takeTone(); fin = takeFinal() || 'น';
  } else if (ch === 'ว' && isC(s[p + 1])) {
    const save = p;
    p++; takeTone();
    const f = takeFinal();
    if (f) { nuc = 'ua'; long = true; fin = f; }
    else { p = save; fin = takeFinal(); nuc = 'o'; }
  } else if (isC(ch)) {
    const f = takeFinal();
    if (f) { nuc = 'o'; fin = f; }
  }
  const finKey = fin ? FINAL[fin] : null;
  const dead = finKey ? (finKey === 'k' || finKey === 't' || finKey === 'p') : !long;
  const tone = toneNumber(cls, mark, dead, long);
  return { rom: rom + withTone(nuc, tone) + (finKey ? FIN_ROM[finKey] : ''), next: p };
}

function prepare(word) {
  const a = [...word.replace(/ํา/g, SARA_AM)].filter(c => c !== YAMOK && c !== 'ฯ');
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] !== THANTHAKHAT) continue;
    let j = i - 1;
    while (j >= 0 && !isC(a[j])) j--;
    if (j < 0) { a.splice(i, 1); continue; }
    let from = j;
    if (a[j] === 'ร' && isC(a[j - 1]) && isC(a[j - 2])) from = j - 1;
    a.splice(from, i - from + 1);
    i = from;
  }
  return a;
}

function convertWord(word) {
  if (EXCEPTIONS[word]) return EXCEPTIONS[word];
  const s = prepare(word);
  if (!s.length) return '';
  if (s.length === 3 && s.every(isC) && s[0] !== 'ห' && s[1] !== 'อ' && s[1] !== 'ว' && !CLUSTERS.has(s[0] + s[1]) && !SILENT_R.has(s[0] + s[1])) {
    const a = syllable([s[0]], 0);
    const b = syllable(s, 1);
    if (a && b) return a.rom + '-' + b.rom;
  }
  const out = [];
  let i = 0;
  while (i < s.length) {
    const r = syllable(s, i);
    if (!r || r.next <= i) { out.push(s[i]); i++; continue; }
    out.push(r.rom);
    i = r.next;
  }
  return out.join('-');
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

export function convert(text) {
  const parts = text.split(/([฀-๿]+)/);
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (!/[฀-๿]/.test(part)) { out += part; continue; }
    const words = segmenter ? Array.from(segmenter.segment(part), x => x.segment) : [part];
    const roms = [];
    for (const w of words) {
      if (w === YAMOK) { if (roms.length) roms.push(roms[roms.length - 1]); continue; }
      const repeat = w.endsWith(YAMOK);
      const r = convertWord(repeat ? w.slice(0, -1) : w);
      roms.push(r);
      if (repeat) roms.push(r);
    }
    out += roms.filter(Boolean).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}
