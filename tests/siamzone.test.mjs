import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExtractedLyrics, parseJinaText, cleanPageTitle } from '../js/extract.js';
import { parseLinks, matchSiamzone, splitTitle } from '../js/siamzone.js';
import { kanaToRomaji } from '../js/kana.js';
import { firstSuccess } from '../js/net.js';

test('page text keeps only lyric lines and drops menus and ads', () => {
  const raw = [
    'ภาพยนตร์ เพลง ละคร เว็บบอร์ด คลิป',
    'ADVERTISEMENT',
    'ศิลปิน ศิลปินจำลอง | อัลบัม ทดสอบ | เพิ่มเมื่อ 1 ม.ค. 60',
    'บรรทัดทดสอบหนึ่ง',
    'on Amazon Music Unlimited (ad)',
    'บรรทัดทดสอบสอง',
    '',
    'บรรทัดทดสอบสาม',
    'เนื้อเพลง ทดสอบ แบบคาราโอเกะ',
    'romanized line that must be cut'
  ].join('\n');
  const out = cleanExtractedLyrics(raw);
  assert.equal(out, 'บรรทัดทดสอบหนึ่ง\nบรรทัดทดสอบสอง\n\nบรรทัดทดสอบสาม');
});

test('jina reader text is parsed', () => {
  const txt = 'Title: เนื้อเพลง ทดสอบ - ศิลปินจำลอง\nURL Source: https://example.com\nMarkdown Content:\n' +
    'ศิลปิน ศิลปินจำลอง | อัลบัม ทดสอบ | เพิ่มเมื่อ 1 ม.ค. 60\nบรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม\n';
  const res = parseJinaText(txt);
  assert.equal(res.title, 'ทดสอบ - ศิลปินจำลอง');
  assert.equal(res.lyrics, 'บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม');
});

test('title helpers', () => {
  assert.equal(cleanPageTitle('เนื้อเพลง ทดสอบ | SIAMZONE.COM'), 'ทดสอบ');
  assert.deepEqual(splitTitle('เนื้อเพลง ทดสอบ - ศิลปินจำลอง'), { title: 'ทดสอบ', artist: 'ศิลปินจำลอง' });
  assert.deepEqual(splitTitle('เนื้อเพลง ทดสอบ | ศิลปินจำลอง'), { title: 'ทดสอบ', artist: 'ศิลปินจำลอง' });
});

test('siamzone ids are recognised', () => {
  assert.deepEqual(matchSiamzone('https://www.siamzone.com/music/thailyric/2676'), { type: 'thailyric', id: '2676' });
  assert.deepEqual(matchSiamzone('www.siamzone.com/music/lyric/55'), { type: 'lyric', id: '55' });
  assert.equal(matchSiamzone('hello'), null);
});

test('search page links are harvested from markdown, redirects and raw urls', () => {
  const md = '[เนื้อเพลง ทดสอบ - ศิลปินจำลอง](https://www.siamzone.com/music/thailyric/99991) and ' +
    'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.siamzone.com%2Fmusic%2Fthailyric%2F99992 and ' +
    'siamzone.com/music/lyric/99993';
  const { songs } = parseLinks(md);
  assert.deepEqual(songs.map(s => s.id).sort(), ['99991', '99992', '99993']);
  assert.equal(songs.find(s => s.id === '99991').title, 'ทดสอบ');
  assert.equal(songs.find(s => s.id === '99991').artist, 'ศิลปินจำลอง');
});

test('bing redirect links are decoded', () => {
  const target = 'https://www.siamzone.com/music/thailyric/88881';
  const b64 = Buffer.from(target).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const { songs } = parseLinks('https://www.bing.com/ck/a?!&&p=abc&u=a1' + b64 + '&ntb=1');
  assert.deepEqual(songs.map(s => s.id), ['88881']);
});

test('kana romaji', () => {
  assert.equal(kanaToRomaji('ありがとう'), 'arigatou');
  assert.equal(kanaToRomaji('きらきら'), 'kirakira');
  assert.equal(kanaToRomaji('ガッコウ'), 'gakkou');
  assert.equal(kanaToRomaji('しゃしん'), 'shashin');
  assert.equal(kanaToRomaji('こんにちは'), 'konnichiha');
  assert.equal(kanaToRomaji('ラーメン'), 'rāmen');
  assert.equal(kanaToRomaji('じゅうしょ'), 'juusho');
  assert.equal(kanaToRomaji('ちょっと'), 'chotto');
  assert.equal(kanaToRomaji('ほんや'), "hon'ya");
  assert.equal(kanaToRomaji('ファイト'), 'faito');
});

test('firstSuccess returns the first good result and starts the next after a failure', async () => {
  const order = [];
  const res = await firstSuccess([
    { delay: 0, run: async () => { order.push('a'); throw new Error('x'); } },
    { delay: 5000, run: async () => { order.push('b'); return 'ok'; } }
  ]);
  assert.equal(res, 'ok');
  assert.deepEqual(order, ['a', 'b']);
});

test('firstSuccess rejects when everything fails and honours abort', async () => {
  await assert.rejects(firstSuccess([{ delay: 0, run: async () => { throw new Error('no'); } }]), /no/);
  const ctl = new AbortController();
  const p = firstSuccess([{ delay: 0, run: () => new Promise(() => {}) }], ctl.signal);
  ctl.abort();
  await assert.rejects(p, e => e.name === 'AbortError');
});
