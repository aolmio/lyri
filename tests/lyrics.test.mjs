import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLines, parseLrc, parsePlain, detectLang, lineScript, alreadyTarget, isJunk } from '../js/lyrics.js';

test('site chrome and ads are stripped from lyric text', () => {
  const junk = [
    'ภาพยนตร์', 'เพลง', 'ละคร', 'เว็บบอร์ด', 'คลิป', 'ปฏิทินกิจกรรม', 'อื่นๆ', 'เข้าระบบ / สมัคร', 'สยามโซน',
    'เนื้อเพลง', 'ADVERTISEMENT', 'on Amazon Music Unlimited (ad)'
  ];
  for (const text of junk) assert.equal(isJunk(text), true, text);
  const lines = cleanLines([
    { text: 'ADVERTISEMENT' }, { text: 'บรรทัดแรก' }, { text: 'on Amazon Music Unlimited (ad)' },
    { text: '' }, { text: '' }, { text: 'เพลง' }, { text: 'บรรทัดที่สอง' }, { text: '' }
  ]);
  assert.deepEqual(lines.map(l => l.text), ['บรรทัดแรก', '', 'บรรทัดที่สอง']);
});

test('real lyric lines that mention music words are kept', () => {
  assert.equal(isJunk('เพลงนี้เพื่อเธอ'), false);
  assert.equal(isJunk('ฟังเพลงรัก'), false);
  assert.equal(isJunk('Amazing grace'), false);
});

test('plain text parsing collapses blank lines', () => {
  const lines = parsePlain('a\n\n\n\nb\r\nc\n');
  assert.deepEqual(lines.map(l => l.text), ['a', '', 'b', 'c']);
});

test('lrc parsing', () => {
  const lines = parseLrc('[ti:x]\n[00:01.50]first\n[00:03.00]second\n[00:03.00]作词 : someone\n[00:05.1][00:09.2]again');
  assert.deepEqual(lines.map(l => l.text), ['first', 'second', 'again', 'again']);
  assert.equal(lines[0].t, 1.5);
  assert.equal(lines[3].t, 9.2);
});

test('language detection', () => {
  const mk = t => [{ text: t }];
  assert.equal(detectLang(mk('hello world')), 'en');
  assert.equal(detectLang(mk('你好世界')), 'zh');
  assert.equal(detectLang(mk('こんにちは世界')), 'ja');
  assert.equal(detectLang(mk('안녕하세요')), 'ko');
  assert.equal(detectLang(mk('สวัสดีครับ')), 'th');
  assert.equal(lineScript('世界', 'ja'), 'ja');
  assert.equal(lineScript('世界', 'zh'), 'zh');
  assert.equal(lineScript('hello', 'en'), null);
});

test('lines already in the target language are skipped', () => {
  assert.equal(alreadyTarget('hello there', 'en'), true);
  assert.equal(alreadyTarget('สวัสดี', 'en'), false);
  assert.equal(alreadyTarget('你好', 'zh-CN'), true);
  assert.equal(alreadyTarget('hello', 'zh-CN'), false);
  assert.equal(alreadyTarget('မင်္ဂလာပါ', 'my'), true);
});
