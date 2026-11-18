const MONO = {
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'ゐ': 'i', 'ゑ': 'e', 'を': 'o',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o',
  'ゔ': 'vu', 'ゎ': 'wa'
};

const YOON_STEM = {
  'き': 'ky', 'ぎ': 'gy', 'し': 'sh', 'じ': 'j', 'ち': 'ch', 'ぢ': 'j', 'に': 'ny', 'ひ': 'hy',
  'び': 'by', 'ぴ': 'py', 'み': 'my', 'り': 'ry', 'ゔ': 'v'
};

const SMALL_Y = { 'ゃ': 'a', 'ゅ': 'u', 'ょ': 'o' };
const SMALL_V = { 'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o' };

const SPECIAL = {
  'しぇ': 'she', 'じぇ': 'je', 'ちぇ': 'che',
  'てぃ': 'ti', 'でぃ': 'di', 'とぅ': 'tu', 'どぅ': 'du',
  'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo',
  'うぃ': 'wi', 'うぇ': 'we', 'うぉ': 'wo',
  'つぁ': 'tsa', 'つぃ': 'tsi', 'つぇ': 'tse', 'つぉ': 'tso',
  'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔぇ': 've', 'ゔぉ': 'vo'
};

const MACRON = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

function toHiragana(text) {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0x30A1 && c <= 0x30F6) out += String.fromCodePoint(c - 0x60);
    else if (c === 0x30FD) out += 'ゝ';
    else out += ch;
  }
  return out;
}

function syllableAt(chars, i) {
  const a = chars[i];
  const b = chars[i + 1];
  if (b !== undefined) {
    const pair = a + b;
    if (SPECIAL[pair]) return { rom: SPECIAL[pair], len: 2 };
    if (SMALL_Y[b] && YOON_STEM[a]) {
      const stem = YOON_STEM[a];
      const v = SMALL_Y[b];
      const soft = stem === 'sh' || stem === 'j' || stem === 'ch';
      return { rom: soft ? stem + v : stem + v, len: 2 };
    }
    if (SMALL_Y[b] && MONO[a] && a !== 'ん') {
      const base = MONO[a];
      return { rom: base.slice(0, -1) + 'y' + SMALL_Y[b], len: 2 };
    }
  }
  if (MONO[a]) return { rom: MONO[a], len: 1 };
  return null;
}

export function kanaToRomaji(text) {
  const chars = [...toHiragana(String(text))];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === 'っ') {
      const next = syllableAt(chars, i + 1);
      if (next && /^[bcdfghjklmnpqrstvwxyz]/.test(next.rom)) out += next.rom.startsWith('ch') ? 't' : next.rom[0];
      i++;
      continue;
    }
    if (c === 'ー') {
      const last = out[out.length - 1];
      if (last && MACRON[last]) out = out.slice(0, -1) + MACRON[last];
      i++;
      continue;
    }
    if (c === 'ん') {
      const next = chars[i + 1];
      const following = next ? syllableAt(chars, i + 1) : null;
      out += following && /^[aiueoy]/.test(following.rom) ? "n'" : 'n';
      i++;
      continue;
    }
    if (c === 'ゝ') {
      i++;
      continue;
    }
    const s = syllableAt(chars, i);
    if (s) {
      out += s.rom;
      i += s.len;
      continue;
    }
    if (SMALL_V[c]) {
      out += SMALL_V[c];
      i++;
      continue;
    }
    if (c === '・' || c === '、' || c === '，') out += ' ';
    else if (c === '。') out += ' ';
    else out += c;
    i++;
  }
  return out.replace(/\s+/g, ' ').trim();
}
