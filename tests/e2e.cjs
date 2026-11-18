const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || '';

const THAI_PAGE = `<html><head><title>เนื้อเพลง ทดสอบระบบ | ศิลปินจำลอง</title></head><body>
<div class="nav"><a>ภาพยนตร์</a> <a>เพลง</a> <a>ละคร</a> <a>เว็บบอร์ด</a> <a>คลิป</a></div>
<div class="banner">ADVERTISEMENT</div>
<h1>เนื้อเพลง ทดสอบระบบ - ศิลปินจำลอง</h1>
<div>ดู 123 ครั้ง / แชร์</div>
<h2>เนื้อเพลง ทดสอบระบบ</h2>
<p>ฉันเดินไปตามทางยาว<br>ใจเต้นแรงทุกก้าว<br>ดวงดาวส่องแสงให้เห็นทาง<br><br>เธอยิ้มให้ฉันในคืนนี้<br>ช่วยบอกได้ไหมว่ารักไหม</p>
<div>on Amazon Music Unlimited (ad)</div>
<h3>เนื้อเพลง ทดสอบระบบ แบบคาราโอเกะ</h3>
<p>chan doen pai tam thang yao<br>chai ten raeng thuk kao<br>duang dao song saeng hai hen thang<br><br>thoe yim hai chan nai khuen ni<br>chuai bok dai mai wa rak mai</p>
<p>เพลง ทดสอบระบบ นี้ ถอดคำร้องและตรวจสอบโดย สยามโซน.คอม</p>
<h3>เนื้อเพลง ทดสอบระบบ โดยศิลปินอื่น</h3><ul><li>x</li></ul>
</body></html>`;

const BING_MD = 'Search results\n\n[เนื้อเพลง ทดสอบระบบ - ศิลปินจำลอง](https://www.siamzone.com/music/thailyric/99991)\n';

const LRCLIB = [
  { id: 1, trackName: 'Test Song', artistName: 'Mock Artist', albumName: 'A', plainLyrics: 'Walking down the road\nStars in the sky\n\nNothing left to say', syncedLyrics: null },
  { id: 2, trackName: 'Test Japanese', artistName: 'Mock Artist', albumName: 'B', plainLyrics: 'ありがとう\n空を見上げて\nきらきら', syncedLyrics: null }
];

const NETEASE_SEARCH = { result: { songs: [{ id: 77, name: 'Test Chinese', artists: [{ name: 'Mock Artist' }], album: { name: 'C' } }] } };
const NETEASE_LYRIC = { lrc: { lyric: '[00:01.00]你好世界\n[00:03.00]今天很好\n[00:05.00]明天见' } };

function inner(urlStr) {
  const u = new URL(urlStr);
  if (u.hostname === 'api.allorigins.win' || u.hostname === 'corsproxy.io') return { target: u.searchParams.get('url'), proxy: u.hostname };
  if (u.hostname === 'api.codetabs.com') return { target: u.searchParams.get('quest'), proxy: u.hostname };
  return null;
}

function translateReply(urlStr, post) {
  const u = new URL(urlStr);
  const tl = u.searchParams.get('tl');
  const rm = urlStr.includes('dt=rm');
  const q = post ? new URLSearchParams(post).get('q') : u.searchParams.get('q');
  const lines = String(q || '').split('\n');
  const pick = l => (tl === 'my' ? 'မင်္ဂလာပါ ကမ္ဘာ' : tl === 'zh-CN' ? '你好 ' + l.length : 'EN ' + l);
  const segs = lines.map((l, i) => [pick(l) + (i < lines.length - 1 ? '\n' : ''), l]);
  if (rm) segs.push([null, null, '', 'rm:' + lines[0]]);
  return JSON.stringify([segs]);
}

async function mock(context, mode) {
  await context.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.hostname === 'cdn.jsdelivr.net' && /pinyin-pro/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.pinyinPro={pinyin:function(t,o){return Array.from(t).map(function(c){return "py"+c.charCodeAt(0)%10})}}' });
    }
    if (u.hostname === 'cdn.jsdelivr.net') return route.abort();
    if (mode === 'hang' && !(u.hostname === 'lrclib.net' && mode === 'hang-sz')) return new Promise(() => {});
    if (u.hostname === 'lrclib.net') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(LRCLIB) });
    if (u.hostname === 'api.lyrics.ovh') return route.abort();
    if (u.hostname === 'translate.googleapis.com' && mode === 'gdown') return route.abort();
    if (u.hostname === 'translate.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: translateReply(url, req.postData()) });
    }
    if (u.hostname === 'r.jina.ai') {
      const target = url.slice('https://r.jina.ai/'.length);
      if (mode === 'sz-hang') return new Promise(() => {});
      if (/bing\.com\/search/.test(target)) return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: BING_MD });
      return route.abort();
    }
    const px = inner(url);
    if (px) {
      if (mode === 'sz-hang') return new Promise(() => {});
      const t = px.target || '';
      if (/siamzone\.com\/music\/thailyric\/99991/.test(t)) {
        if (px.proxy === 'api.allorigins.win') return route.fulfill({ status: 500, body: 'bad gateway' });
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: THAI_PAGE });
      }
      if (/music\.163\.com\/api\/search/.test(t)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(NETEASE_SEARCH) });
      if (/music\.163\.com\/api\/song\/lyric/.test(t)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(NETEASE_LYRIC) });
      return route.abort();
    }
    return route.abort();
  });
}

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + (extra === undefined ? '' : JSON.stringify(extra))));
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function search(page, q) {
  await page.fill('#q', q);
  await page.click('#searchBtn');
}

async function main() {
  const browser = await chromium.launch();

  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    await mock(ctx, 'ok');
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE);

    check('saved panel is hidden on first load', !(await page.locator('#savedPanel').isVisible()));
    check('saved list is not visible under results', !(await page.locator('#savedList').isVisible()));
    check('stop button starts disabled', await page.locator('#stopBtn').isDisabled());

    await search(page, 'test');
    await page.waitForSelector('#resultList .item', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#resultList .item').length >= 4, null, { timeout: 15000 });
    const sources = await page.$$eval('#resultList .tag', els => els.map(e => e.textContent));
    check('results come from LRCLIB, NetEase and SiamZone', ['LRCLIB', 'NetEase', 'SiamZone'].every(s => sources.includes(s)), sources);
    check('saved list still hidden while results are shown', !(await page.locator('#savedList').isVisible()));
    await page.waitForFunction(() => !document.getElementById('searchBtn').disabled, null, { timeout: 40000 });
    check('search button unlocks when all sources finish', true);
    const chips = await page.$$eval('#chips .chip', els => els.map(e => e.textContent));
    check('failed source is reported, not hanging', chips.some(c => /Lyrics\.ovh · (failed|0)/.test(c)), chips);

    await page.locator('#resultList .item', { hasText: 'SiamZone' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row', { timeout: 20000 });
    const orig = await page.$$eval('#lyrics .row .o', els => els.map(e => e.textContent));
    check('siamzone lyric has 5 lines', orig.length === 5, orig);
    const all = orig.join('|');
    check('no menu or ad text in lyrics', !/ภาพยนตร์|ADVERTISEMENT|Amazon|ละคร|แชร์|คาราโอเกะ/.test(all), all);
    check('title and artist parsed', (await page.textContent('#songTitle')).includes('ทดสอบระบบ') && (await page.textContent('#songArtist')).includes('ศิลปินจำลอง'));
    const rom = await page.$$eval('#lyrics .row .r', els => els.map(e => e.textContent));
    check('thai romanization with tone marks shown', rom.length === 5 && rom.every(Boolean) && /[àáâǎ]/.test(rom.join('')), rom);
    await page.waitForFunction(() => [...document.querySelectorAll('#lyrics .t')].every(e => e.textContent), null, { timeout: 15000 });
    const tr = await page.$$eval('#lyrics .t', els => els.map(e => e.textContent));
    check('english translation shown for every line', tr.length === 5 && tr.every(t => t.startsWith('EN ')), tr);
    await shot(page, 'desktop-thai-en');

    await page.selectOption('.toggles select[data-key="target"]', 'my');
    await page.waitForFunction(() => [...document.querySelectorAll('#lyrics .t')].every(e => e.textContent.includes('မင်္ဂလာပါ')), null, { timeout: 15000 });
    const my = await page.$eval('#lyrics .t', el => {
      const cs = getComputedStyle(el);
      return { lang: el.lang, italic: cs.fontStyle, wrap: cs.overflowWrap, brk: cs.wordBreak, fam: cs.fontFamily, ratio: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) };
    });
    check('burmese translation tagged lang=my', my.lang === 'my', my);
    check('burmese is not italic and never splits clusters', my.italic === 'normal' && my.wrap !== 'anywhere' && my.brk === 'normal', my);
    check('burmese uses a Myanmar font stack', /Myanmar/i.test(my.fam), my.fam);
    check('burmese has generous line height', my.ratio >= 1.8, my.ratio);
    await shot(page, 'desktop-thai-my');

    await page.selectOption('.toggles select[data-key="target"]', 'zh-CN');
    await page.waitForFunction(() => [...document.querySelectorAll('#lyrics .t')].every(e => e.textContent.startsWith('你好')), null, { timeout: 15000 });
    check('chinese translation shown', true);

    await page.click('#saveBtn');
    check('save toggles to saved', (await page.textContent('#saveBtn')).includes('Saved'));
    await page.click('.tabs button[data-tab="saved"]');
    check('saved tab shows saved panel', await page.locator('#savedPanel').isVisible());
    check('search results hidden while on saved tab', !(await page.locator('#resultList').isVisible()));
    check('saved list has the song', (await page.locator('#savedList .item').count()) === 1);
    await page.click('.tabs button[data-tab="search"]');
    check('back on search tab saved list is hidden', !(await page.locator('#savedList').isVisible()));
    await page.click('.tabs button[data-tab="saved"]');
    await page.click('#savedList .item .del');
    check('delete removes the saved song', (await page.locator('#savedList .item').count()) === 0);
    check('save button resets after delete', (await page.textContent('#saveBtn')).includes('Save') && !(await page.textContent('#saveBtn')).includes('Saved'));
    await page.click('.tabs button[data-tab="search"]');

    await page.locator('#resultList .item', { hasText: 'Test Japanese' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row');
    await page.waitForFunction(() => [...document.querySelectorAll('#lyrics .r')].filter(e => e.textContent).length >= 3, null, { timeout: 10000 });
    const ja = await page.$$eval('#lyrics .row .r', els => els.map(e => e.textContent));
    check('japanese romaji appears for kana lines', ja[0].toLowerCase().startsWith('rm:') || ja[0] === 'arigatou', ja);
    check('japanese romaji appears for kanji lines', !!ja[1], ja);
    check('romaji for line 3 present', !!ja[2], ja);
    await shot(page, 'desktop-japanese');

    await page.locator('#resultList .item', { hasText: 'Test Chinese' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row');
    await page.waitForSelector('#lyrics ruby', { timeout: 10000 });
    check('chinese shows ruby pinyin above characters', (await page.locator('#lyrics ruby rt').count()) >= 6);
    await shot(page, 'desktop-chinese');

    await page.locator('#resultList .item', { hasText: 'Test Song' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row');
    await page.waitForTimeout(300);
    const en = await page.$$eval('#lyrics .row .r', els => els.map(e => e.textContent).filter(Boolean));
    check('english song has no romanization noise', en.length === 0, en);

    check('no uncaught page errors', errors.length === 0, errors);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await mock(ctx, 'hang');
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(BASE);
    await search(page, 'anything');
    await page.waitForFunction(() => document.getElementById('searchBtn').disabled);
    check('stop is enabled while searching', !(await page.locator('#stopBtn').isDisabled()));
    const t0 = Date.now();
    await page.click('#stopBtn');
    await page.waitForFunction(() => !document.getElementById('searchBtn').disabled);
    check('stop unlocks search instantly', Date.now() - t0 < 1000, Date.now() - t0);
    check('stop disables itself again', await page.locator('#stopBtn').isDisabled());
    const chips = await page.$$eval('#chips .chip', els => els.map(e => e.textContent));
    check('hung sources marked stopped', chips.length > 0 && chips.every(c => /stopped/.test(c)), chips);
    check('page still responsive after stop', (await page.evaluate(() => 1 + 1)) === 2);
    await search(page, 'again');
    await page.waitForFunction(() => document.getElementById('searchBtn').disabled);
    check('a new search can start right after stop', true);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await mock(ctx, 'sz-hang');
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(BASE);
    await search(page, 'test');
    await page.waitForSelector('#resultList .item');
    check('search stays busy while siamzone is slow', await page.locator('#searchBtn').isDisabled());
    const t0 = Date.now();
    await page.locator('#resultList .item', { hasText: 'Test Song' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row');
    check('clicking a fast result unlocks search at once', !(await page.locator('#searchBtn').isDisabled()) && Date.now() - t0 < 1500, Date.now() - t0);
    const chips = await page.$$eval('#chips .chip', els => els.map(e => e.textContent));
    check('slow sources cleared after click', chips.some(c => /stopped/.test(c)), chips);
    await search(page, 'second');
    await page.waitForFunction(() => document.getElementById('searchBtn').disabled);
    check('immediate second search works without refresh', true);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await mock(ctx, 'ok');
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await page.route('**/api.codetabs.com/**', () => new Promise(() => {}));
    await page.route('**/corsproxy.io/**', () => new Promise(() => {}));
    await page.goto(BASE);
    await search(page, 'test');
    await page.waitForSelector('#resultList .item', { hasText: 'SiamZone' });
    await page.locator('#resultList .item', { hasText: 'SiamZone' }).locator('button.open').click();
    await page.waitForFunction(() => document.getElementById('stopBtn') && !document.getElementById('stopBtn').disabled);
    check('stop is enabled while a song is loading', true);
    await page.click('#stopBtn');
    await page.waitForFunction(() => /Stopped/.test(document.getElementById('status').textContent));
    check('stopping a song load reports Stopped and unlocks stop', await page.locator('#stopBtn').isDisabled());
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await mock(ctx, 'gdown');
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(BASE);
    await search(page, 'test');
    await page.waitForSelector('#resultList .item', { hasText: 'Test Japanese' });
    await page.locator('#resultList .item', { hasText: 'Test Japanese' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row');
    await page.waitForFunction(() => !document.getElementById('stopBtn').disabled === false, null, { timeout: 30000 });
    const ja = await page.$$eval('#lyrics .row .r', els => els.map(e => e.textContent));
    check('kana romaji shows from the built-in converter with Google down', ja[0] === 'arigatou' && ja[2] === 'kirakira', ja);
    const status = await page.textContent('#status');
    check('translation outage is reported and does not hang', /could not be translated|failed|partly/i.test(status) && (await page.locator('#stopBtn').isDisabled()), status);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await mock(ctx, 'ok');
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(BASE);
    await search(page, 'test');
    await page.waitForFunction(() => document.querySelectorAll('#resultList .item').length >= 4);
    const overflow1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('mobile list view has no horizontal scroll', overflow1 <= 1, overflow1);
    check('mobile reader hidden in list view', !(await page.locator('#reader').isVisible()));
    check('mobile saved list hidden under results', !(await page.locator('#savedList').isVisible()));
    await shot(page, 'mobile-list');
    await page.locator('#resultList .item', { hasText: 'SiamZone' }).locator('button.open').click();
    await page.waitForSelector('#lyrics .row');
    await page.waitForFunction(() => [...document.querySelectorAll('#lyrics .t')].every(e => e.textContent));
    check('mobile song view hides the list', !(await page.locator('.side').isVisible()));
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('mobile song view has no horizontal scroll', overflow2 <= 1, overflow2);
    await shot(page, 'mobile-song');
    await page.click('#backBtn');
    check('back button returns to the list', await page.locator('.side').isVisible());
    await page.click('#optionsBtn');
    check('options dialog opens on mobile', await page.locator('#optionsDlg').isVisible());
    const fits = await page.evaluate(() => { const r = document.getElementById('optionsDlg').getBoundingClientRect(); return r.width <= window.innerWidth && r.height <= window.innerHeight; });
    check('options dialog fits the phone screen', fits);
    await shot(page, 'mobile-options');
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
