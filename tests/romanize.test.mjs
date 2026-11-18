import test from 'node:test';
import assert from 'node:assert/strict';
import { convert as thai } from '../js/thai.js';
import { convert as korean } from '../js/korean.js';

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

test('thai base romanization', () => {
  const cases = {
    'ไทย': 'thai', 'ขอบคุณ': 'khop-khun', 'ผม': 'phom', 'ฉัน': 'chan', 'รัก': 'rak', 'ใจ': 'chai',
    'ไม่': 'mai', 'สบาย': 'sa-bai', 'คิดถึง': 'khit-thueng', 'เธอ': 'thoe', 'เรา': 'rao', 'เขา': 'khao',
    'ความ': 'khwam', 'ต้อง': 'tong', 'คน': 'khon', 'ยัง': 'yang', 'ที่': 'thi', 'ทำ': 'tham',
    'เสียง': 'siang', 'เมื่อ': 'muea', 'ใหม่': 'mai', 'ไหน': 'nai', 'อยาก': 'yak', 'ด้วย': 'duai',
    'เป็น': 'pen', 'เล่น': 'len', 'ใคร': 'khrai', 'ประเทศ': 'pra-thet', 'เพราะ': 'phro', 'ตรง': 'trong',
    'กัน': 'kan', 'ขนม': 'kha-nom', 'ตัว': 'tua', 'เลย': 'loei', 'สวน': 'suan', 'แล้ว': 'laeo'
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(strip(thai(input)), expected, input);
  }
});

test('thai tone marks', () => {
  const cases = {
    'ไม่': 'mâi', 'ที่': 'thî', 'ใหม่': 'mài', 'ผม': 'phǒm', 'รัก': 'rák', 'ต้อง': 'tông', 'ขอบ': 'khòp',
    'ฉัน': 'chǎn', 'คิดถึง': 'khít-thǔeng', 'เล่น': 'lên', 'ไหน': 'nǎi', 'ค่ะ': 'khâ', 'นะ': 'ná', 'จะ': 'chà'
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(thai(input), expected, input);
  }
});

test('thai mixed text and repetition', () => {
  assert.equal(thai('abc ไทย 123'), 'abc thai 123');
  assert.equal(thai('ดีๆ'), 'di di');
});

test('korean romanization', () => {
  assert.equal(korean('한국어'), 'hangugeo');
  assert.equal(korean('사랑해'), 'saranghae');
  assert.equal(korean('좋아'), 'joa');
  assert.equal(korean('같이'), 'gachi');
  assert.equal(korean('감사합니다'), 'gamsahamnida');
  assert.equal(korean('hello 안녕'), 'hello annyeong');
});
