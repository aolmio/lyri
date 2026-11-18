const NAV_WORDS = new Set([
  'ภาพยนตร์', 'เพลง', 'ละคร', 'เว็บบอร์ด', 'คลิป', 'ปฏิทินกิจกรรม', 'อื่นๆ', 'อื่น ๆ', 'เข้าระบบ / สมัคร',
  'เข้าระบบ', 'สมัคร', 'สยามโซน', 'เนื้อเพลง', 'ข่าวบันเทิง', 'ชิงรางวัล', 'สมัครงาน', 'โฆษณา', 'หน้าแรก',
  'ค้นหาข้อมูล', 'แชร์', 'ADVERTISEMENT', 'Advertisement', 'ADVERTISING', 'Sign in', 'Sign out', 'เกมส์', 'เกม'
]);

const JUNK_PATTERNS = [
  /amazon music/i,
  /\(ad\)\s*$/i,
  /^advertis(e)?ment$/i,
  /^sponsored$/i,
  /ถอดคำร้อง/,
  /สงวนลิขสิทธิ์/,
  /^ดู\s*[\d,]+\s*ครั้ง/,
  /^(share|แชร์)(\s|$)/i,
  /ติดตามเรา/,
  /นโยบายความเป็นส่วนตัว/,
  /ข้อกำหนดในการให้บริการ/,
  /ติดต่อทีมงาน/,
  /ที่แสดงบนเว็บก็เพื่อประโยชน์ในการศึกษา/,
  /ไม่มีบริการดาวน์โหลด/,
  /^on spotify$/i,
  /^listen on/i,
  /^you might also like/i,
  /^embed$/i,
  /^\d+\s*embed$/i,
  /^see .* live$/i,
  /^get tickets/i
];

export function isJunk(text) {
  const s = text.trim();
  if (!s) return false;
  if (NAV_WORDS.has(s)) return true;
  return JUNK_PATTERNS.some(rx => rx.test(s));
}

export function cleanLines(lines) {
  const out = [];
  for (const line of lines) {
    const text = (line.text || '').replace(/\s+/g, ' ').trim();
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
  const meta = /^(作词|作曲|编曲|制作人|混音|母带|词|曲|詞|曲|lyrics|composer|producer|arranger)\s*[:：]/i;
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
  burmese: /[က-႟]/
};

export function detectLang(lines) {
  const counts = { thai: 0, kana: 0, hangul: 0, han: 0 };
  for (const { text } of lines) {
    for (const ch of text) {
      if (RX.thai.test(ch)) counts.thai++;
      else if (RX.kana.test(ch)) counts.kana++;
      else if (RX.hangul.test(ch)) counts.hangul++;
      else if (RX.han.test(ch)) counts.han++;
    }
  }
  if (counts.kana > 0) return 'ja';
  if (counts.hangul > 0 && counts.hangul >= counts.han) return 'ko';
  if (counts.thai > 0 && counts.thai >= counts.han) return 'th';
  if (counts.han > 0) return 'zh';
  return 'en';
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
  const hasLatin = /[A-Za-z]/.test(text);
  if (target === 'en') return hasLatin && !hasThai && !hasKana && !hasHangul && !hasHan && !hasBurmese;
  if (target === 'zh-CN') return hasHan && !hasKana && !hasHangul && !hasThai && !hasBurmese && !hasLatin;
  if (target === 'my') return hasBurmese && !hasThai && !hasKana && !hasHangul && !hasHan;
  return false;
}
