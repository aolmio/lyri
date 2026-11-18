const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const STAY = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const LINK = [
  null, { f: '', i: 'g' }, { f: '', i: 'kk' }, { f: 'k', i: 's' }, { f: '', i: 'n' }, { f: 'n', i: 'j' },
  { f: '', i: 'n' }, { f: '', i: 'd' }, { f: '', i: 'r' }, { f: 'l', i: 'g' }, { f: 'l', i: 'm' },
  { f: 'l', i: 'b' }, { f: 'l', i: 's' }, { f: 'l', i: 't' }, { f: 'l', i: 'p' }, { f: '', i: 'r' },
  { f: '', i: 'm' }, { f: '', i: 'b' }, { f: 'p', i: 's' }, { f: '', i: 's' }, { f: '', i: 'ss' },
  null, { f: '', i: 'j' }, { f: '', i: 'ch' }, { f: '', i: 'k' }, { f: '', i: 't' }, { f: '', i: 'p' }, { f: '', i: '' }
];
const ASPIRATED = { 0: 'k', 3: 't', 7: 'p', 12: 'ch' };

function decompose(ch) {
  const n = ch.codePointAt(0) - 0xAC00;
  if (n < 0 || n > 11171) return null;
  return { l: Math.floor(n / 588), v: Math.floor((n % 588) / 28), t: n % 28 };
}

export function convert(text) {
  const chars = [...text];
  const syl = chars.map(decompose);
  const inits = syl.map(s => (s ? INITIALS[s.l] : ''));
  const finals = syl.map(s => (s ? STAY[s.t] : ''));
  for (let k = 0; k < chars.length - 1; k++) {
    const a = syl[k];
    const b = syl[k + 1];
    if (!a || !b || a.t === 0) continue;
    if (b.l === 11) {
      if (a.t === 21) continue;
      if (b.v === 20 && a.t === 7) { finals[k] = ''; inits[k + 1] = 'j'; continue; }
      if (b.v === 20 && a.t === 25) { finals[k] = ''; inits[k + 1] = 'ch'; continue; }
      const link = LINK[a.t];
      finals[k] = link.f;
      inits[k + 1] = link.i;
      continue;
    }
    let f = finals[k];
    if (a.t === 27 && ASPIRATED[b.l] !== undefined) { finals[k] = ''; inits[k + 1] = ASPIRATED[b.l]; continue; }
    if (b.l === 18 && (f === 'k' || f === 't' || f === 'p')) { finals[k] = ''; inits[k + 1] = f; continue; }
    if (b.l === 2 || b.l === 6) {
      if (f === 'k') f = 'ng';
      else if (f === 't') f = 'n';
      else if (f === 'p') f = 'm';
      else if (f === 'l' && b.l === 2) inits[k + 1] = 'l';
    } else if (b.l === 5) {
      if (f === 'n') { f = 'l'; inits[k + 1] = 'l'; }
      else if (f === 'l') inits[k + 1] = 'l';
      else if (f === 'k') { f = 'ng'; inits[k + 1] = 'n'; }
      else if (f === 'p') { f = 'm'; inits[k + 1] = 'n'; }
      else if (f === 't') { f = 'n'; inits[k + 1] = 'n'; }
      else if (f === 'm' || f === 'ng') inits[k + 1] = 'n';
    }
    finals[k] = f;
  }
  let out = '';
  for (let k = 0; k < chars.length; k++) {
    const s = syl[k];
    out += s ? inits[k] + VOWELS[s.v] + finals[k] : chars[k];
  }
  return out;
}
