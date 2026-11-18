const JUNK_EXACT = new Set([
  'ภาพยนตร์', 'เพลง', 'ละคร', 'เว็บบอร์ด', 'คลิป', 'ปฏิทินกิจกรรม', 'อื่นๆ', 'อื่น ๆ',
  'เข้าระบบ / สมัคร', 'เข้าระบบ', 'สมัคร', 'สมัครสมาชิก', 'สยามโซน', 'เนื้อเพลง', 'ข่าวบันเทิง', 'ชิงรางวัล',
  'สมัครงาน', 'หน้าแรก', 'ค้นหา', 'ค้นหาเนื้อเพลง', 'ค้นหาข้อมูล', 'ดูทั้งหมด', 'โฆษณา', 'แชร์', 'เกมส์', 'เกม',
  'advertisement', 'advertising', 'sponsored', 'on amazon music unlimited (ad)',
  'on amazon music unlimited', 'amazon music unlimited', 'amazon music',
  'apple music', 'spotify', '(ad)', 'ad', 'tap to unmute', 'ส่งไลน์', 'sign in', 'sign out', 'embed'
]);

const MENU_TOKENS = ['ภาพยนตร์', 'เพลง', 'ละคร', 'เว็บบอร์ด', 'คลิป', 'ปฏิทินกิจกรรม', 'อื่นๆ', 'เข้าระบบ'];

const MENU_ROW = /^(ภาพยนตร์|เพลง|ละคร|เว็บบอร์ด|คลิป|ปฏิทินกิจกรรม|อื่นๆ|เข้าระบบ|สยามโซน)(\s*[,|/•>-]\s*(ภาพยนตร์|เพลง|ละคร|เว็บบอร์ด|คลิป|ปฏิทินกิจกรรม|อื่นๆ|เข้าระบบ|สมัคร|สยามโซน|เนื้อเพลง))+$/i;

const JUNK_PATTERNS = [
  /^(advertisement|sponsored|on amazon music|listen on amazon|listen on apple|listen on spotify)/i,
  /amazon music unlimited|\(ad\)\s*$/i,
  /^(แจ้งเนื้อเพลงผิด|พิมพ์หน้านี้|ขนาดตัวอักษร|ฟังเพลงออนไลน์|ย้อนกลับ|แชร์หน้านี้|แสดงความคิดเห็น|ความคิดเห็นที่)/,
  /^(เนื้อเพลงอื่นๆ|เพลงอื่นๆ ของ|อัลบั้มอื่นๆ ของ|ข่าวล่าสุด|กระทู้ล่าสุด)/,
  /^(สงวนลิขสิทธิ์|copyright\s*©|all rights reserved|www\.siamzone\.com|siamzone\.com)/i,
  /^สยามโซน\s*[>»/·]\s*เพลง/,
  /^ดู\s*[\d,]+\s*ครั้ง/,
  /^ศิลปิน\s+.+\|\s*(อัลบัม|เพิ่มเมื่อ)/,
  /^ฟังเพลง\s+/,
  /ถอดคำร้อง/,
  /ติดตามเรา/,
  /นโยบายความเป็นส่วนตัว/,
  /ข้อกำหนดในการให้บริการ/,
  /ติดต่อทีมงาน/,
  /ที่แสดงบนเว็บก็เพื่อประโยชน์ในการศึกษา/,
  /ไม่มีบริการดาวน์โหลด/,
  /^(share|แชร์)(\s|$)/i,
  /^you might also like/i,
  /^\d+\s*embed$/i,
  /^see .* live$/i,
  /^get tickets/i
];

export function isJunk(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (JUNK_EXACT.has(s.toLowerCase())) return true;
  if (MENU_ROW.test(s)) return true;
  if (MENU_TOKENS.filter(tok => s.includes(tok)).length >= 3) return true;
  return JUNK_PATTERNS.some(rx => rx.test(s));
}

export function cleanLines(lines) {
  const out = [];
  for (const line of lines) {
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    if (text && isJunk(text)) continue;
    if (!text && (!out.length || !out[out.length - 1].text)) continue;
    out.push({ ...line, text });
  }
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}

export function parsePlain(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(t => ({ text: t }));
  return cleanLines(lines);
}

export function parseLrc(text) {
  const entries = [];
  const meta = /^(作词|作曲|编曲|制作人|混音|母带|词|曲|詞|lyrics|composer|producer|arranger)\s*[:：]/i;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (meta.test(body)) continue;
    for (const m of stamps) {
      const t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0);
      entries.push({ text: body, t });
    }
  }
  entries.sort((a, b) => a.t - b.t);
  return cleanLines(entries);
}

const RX = {
  thai: /[฀-๿]/,
  kana: /[぀-ヿㇰ-ㇿ]/,
  hangul: /[가-힯ᄀ-ᇿ㄰-㆏]/,
  han: /[㐀-䶿一-鿿]/,
  burmese: /[က-႟]/,
  latin: /[A-Za-z]/
};

export function detectLang(lines) {
  const n = { th: 0, ja: 0, ko: 0, zh: 0, my: 0, en: 0 };
  for (const { text } of lines) {
    for (const ch of text) {
      if (RX.thai.test(ch)) n.th++;
      else if (RX.kana.test(ch)) n.ja++;
      else if (RX.hangul.test(ch)) n.ko++;
      else if (RX.han.test(ch)) n.zh++;
      else if (RX.burmese.test(ch)) n.my++;
      else if (RX.latin.test(ch)) n.en++;
    }
  }
  if (n.ja >= 3 && n.ja > n.zh * 0.15) return 'ja';
  const order = ['th', 'zh', 'ko', 'my', 'en'];
  return order.sort((a, b) => n[b] - n[a])[0];
}

export function lineScript(text, lang) {
  if (RX.kana.test(text)) return 'ja';
  if (RX.hangul.test(text)) return 'ko';
  if (RX.thai.test(text)) return 'th';
  if (RX.han.test(text)) return lang === 'ja' ? 'ja' : 'zh';
  return null;
}

export function alreadyTarget(text, target) {
  const hasThai = RX.thai.test(text);
  const hasKana = RX.kana.test(text);
  const hasHangul = RX.hangul.test(text);
  const hasHan = RX.han.test(text);
  const hasBurmese = RX.burmese.test(text);
  const hasLatin = RX.latin.test(text);
  if (target === 'en') return hasLatin && !hasThai && !hasKana && !hasHangul && !hasHan && !hasBurmese;
  if (target === 'zh-CN') return hasHan && !hasKana && !hasHangul && !hasThai && !hasBurmese && !hasLatin;
  if (target === 'my') return hasBurmese && !hasThai && !hasKana && !hasHangul && !hasHan;
  return false;
}
