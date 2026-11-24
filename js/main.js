import { settings } from './settings.js';
import { SOURCES, urlItems, manualItem } from './sources.js';
import { detectLang, lineScript, alreadyTarget, parseLrc, parsePlain } from './lyrics.js';
import { translateLines, googleRoman, SOURCE_CODE } from './translate.js';
import { thaiTone, koreanRoman, quickJapanese, japanese, pinyinChars } from './romanize.js';
import { isAbort, pool, tick } from './net.js';
import * as library from './library.js';
import { toLrc, safeName } from './lrc.js';
import { makeZip, readZip, uniqueNames, downloadBlob } from './bulk.js';
import { initSync } from './sync.js';

const $ = id => document.getElementById(id);

const LANG_ATTR = { th: 'th', zh: 'zh-Hans', ja: 'ja', ko: 'ko', my: 'my', en: 'en' };
const TARGET_ATTR = { en: 'en', 'zh-CN': 'zh-Hans', my: 'my' };
const SEARCH_LIMIT_MS = 35000;
const LOAD_LIMIT_MS = 40000;
const TRANSLATE_LIMIT_MS = 70000;

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const S = {
  searchId: 0,
  searchCtl: null,
  searchTimer: 0,
  loadCtl: null,
  romCtl: null,
  trCtl: null,
  romGen: 0,
  results: [],
  seen: new Set(),
  chips: {},
  song: null,
  lang: 'en',
  rows: [],
  tab: 'search'
};

const sync = initSync({
  settings,
  toast: message => toast(message),
  getSong: () => S.song,
  isSaved: () => !!S.song && library.has(S.song.id),
  persist: () => {
    if (S.song && library.has(S.song.id)) library.update(S.song.id, { lines: S.song.lines, tr: S.song.tr || {}, roman: S.song.roman || null });
  },
  replaceLines: lines => replaceLines(lines)
});

const notes = {};

function setNote(key, text, error = false) {
  if (text) notes[key] = { text, error };
  else delete notes[key];
  const list = Object.values(notes);
  const el = $('status');
  el.textContent = list.map(n => n.text).join(' · ');
  el.classList.toggle('error', list.some(n => n.error));
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function refreshBusy() {
  const searching = !!S.searchCtl;
  const busy = searching || !!S.loadCtl || !!S.romCtl || !!S.trCtl;
  $('stopBtn').disabled = !busy;
  $('searchBtn').disabled = searching;
  $('searchBtn').textContent = searching ? 'Searching…' : 'Search';
  document.body.classList.toggle('busy', busy);
}

function setView(view) {
  document.body.dataset.view = view;
  if (view === 'song') window.scrollTo({ top: 0 });
}

function showTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs button').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('searchPanel').hidden = tab !== 'search';
  $('savedPanel').hidden = tab !== 'saved';
  if (tab === 'saved') renderSaved();
}

function renderChips() {
  const box = $('chips');
  box.textContent = '';
  for (const [name, info] of Object.entries(S.chips)) {
    const text = info.st === 'ok' ? `${name} · ${info.n}` : info.st === 'empty' ? `${name} · 0` : info.st === 'fail' ? `${name} · failed` : info.st === 'stopped' ? `${name} · stopped` : name;
    box.append(make('span', 'chip ' + info.st, text));
  }
}

function renderResults() {
  const ul = $('resultList');
  ul.textContent = '';
  if (!S.results.length) {
    const text = S.searchCtl ? 'Searching…' : Object.keys(S.chips).length ? 'No results found. Try another keyword or paste a SiamZone link.' : 'Results will appear here.';
    ul.append(make('li', 'empty-note', text));
    return;
  }
  for (const item of S.results) {
    const li = make('li', 'item');
    const open = make('button', 'open');
    open.type = 'button';
    open.append(make('span', 'name', item.title || 'Untitled'));
    if (item.artist) open.append(make('span', 'by', item.artist));
    const tags = make('span', 'tags');
    tags.append(make('span', 'tag', item.source));
    if (item.synced) tags.append(make('span', 'tag', 'synced'));
    open.append(tags);
    open.addEventListener('click', () => openItem(item));
    li.append(open);
    ul.append(li);
  }
}

function abortSearch() {
  S.searchId++;
  clearTimeout(S.searchTimer);
  const ctl = S.searchCtl;
  S.searchCtl = null;
  if (ctl) ctl.abort();
  for (const info of Object.values(S.chips)) if (info.st === 'loading') info.st = 'stopped';
  renderChips();
  refreshBusy();
}

function startSearch(raw) {
  const q = raw.trim();
  if (!q) return;
  abortSearch();
  const id = S.searchId;
  const ctl = new AbortController();
  S.searchCtl = ctl;
  S.results = [];
  S.seen = new Set();
  S.chips = {};
  setNote('search', '');
  showTab('search');
  setView('list');
  const isUrl = /^https?:\/\//i.test(q);
  const jobs = isUrl
    ? [{ name: 'Page', run: async (query, signal, emit) => emit(await urlItems(query, signal)) }]
    : SOURCES.filter(s => settings.get(s.setting)).map(s => ({ name: s.name, run: s.search }));
  if (!jobs.length) {
    S.searchCtl = null;
    refreshBusy();
    renderResults();
    setNote('search', 'Enable at least one source in Options.', true);
    return;
  }
  let pending = jobs.length;
  for (const job of jobs) S.chips[job.name] = { st: 'loading', n: 0 };
  refreshBusy();
  renderChips();
  renderResults();

  S.searchTimer = setTimeout(() => {
    if (id !== S.searchId) return;
    abortSearch();
    renderResults();
    setNote('search', 'Some sources were too slow and were stopped.');
  }, SEARCH_LIMIT_MS);

  for (const job of jobs) {
    const state = S.chips[job.name];
    const emit = items => {
      if (id !== S.searchId) return;
      const fresh = items.filter(it => {
        const key = it.source + '|' + (it.url || it.title + '|' + it.artist);
        if (S.seen.has(key)) return false;
        S.seen.add(key);
        return true;
      });
      if (!fresh.length) return;
      state.n += fresh.length;
      S.results = S.results.concat(fresh);
      renderResults();
      renderChips();
    };
    Promise.resolve()
      .then(() => job.run(q, ctl.signal, emit))
      .then(() => {
        if (id === S.searchId) state.st = state.n ? 'ok' : 'empty';
      })
      .catch(e => {
        if (id !== S.searchId) return;
        state.st = state.n ? 'ok' : isAbort(e) ? 'stopped' : 'fail';
      })
      .finally(() => {
        if (id !== S.searchId) return;
        renderChips();
        pending--;
        if (pending === 0) {
          clearTimeout(S.searchTimer);
          S.searchCtl = null;
          refreshBusy();
          renderResults();
        }
      });
  }
}

function cancelRoman() {
  S.romGen++;
  const ctl = S.romCtl;
  S.romCtl = null;
  if (ctl) ctl.abort();
  setNote('rom', '');
}

function cancelTranslate() {
  const ctl = S.trCtl;
  S.trCtl = null;
  if (ctl) ctl.abort();
  setNote('tr', '');
}

function cancelSong() {
  const ctl = S.loadCtl;
  S.loadCtl = null;
  if (ctl) ctl.abort();
  setNote('load', '');
  cancelRoman();
  cancelTranslate();
  refreshBusy();
}

function stopAll() {
  const wasLoadingSong = !!S.loadCtl && !S.song;
  abortSearch();
  cancelSong();
  renderResults();
  if (wasLoadingSong) setNote('load', 'Stopped.');
  toast('Stopped');
}

async function openItem(item) {
  abortSearch();
  cancelSong();
  const ctl = new AbortController();
  S.loadCtl = ctl;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, LOAD_LIMIT_MS);
  sync.detach();
  S.song = null;
  S.rows = [];
  $('placeholder').hidden = true;
  $('song').hidden = false;
  $('songTitle').textContent = item.title || 'Loading…';
  $('songArtist').textContent = item.artist || '';
  updateSourceLink(item);
  $('lyrics').textContent = '';
  updateSaveButton();
  refreshBusy();
  setView('song');
  setNote('load', 'Loading lyrics from ' + item.source + '…');
  try {
    const res = await item.load(ctl.signal);
    if (S.loadCtl !== ctl) return;
    if (!res.lines || !res.lines.some(l => l.text)) throw new Error('No lyrics found');
    const title = res.title || (item.title && !/^SiamZone #\d+$/.test(item.title) ? item.title : '') || 'Untitled';
    const artist = res.artist || item.artist || '';
    S.loadCtl = null;
    setNote('load', '');
    setSong({
      id: library.songId({ source: item.source, url: item.url, title, artist, lines: res.lines }),
      source: item.source,
      url: item.url,
      title,
      artist,
      lines: res.lines,
      roman: res.roman || null,
      tr: {}
    });
  } catch (e) {
    if (S.loadCtl !== ctl) return;
    S.loadCtl = null;
    if (timedOut) setNote('load', 'Loading from ' + item.source + ' timed out. Try another result.', true);
    else if (isAbort(e)) setNote('load', 'Stopped.');
    else setNote('load', 'Could not load lyrics from ' + item.source + ': ' + e.message, true);
  } finally {
    clearTimeout(timer);
    refreshBusy();
  }
}

function updateSourceLink(song) {
  const a = $('songSource');
  a.textContent = song.source ? 'Source: ' + song.source : '';
  if (song.url && /^https?:/.test(song.url)) a.href = song.url;
  else a.removeAttribute('href');
}

function effectiveLang() {
  const forced = settings.get('langOverride');
  return forced === 'auto' ? detectLang(S.song.lines) : forced;
}

function setSong(song) {
  cancelRoman();
  cancelTranslate();
  S.song = song;
  S.lang = effectiveLang();
  $('songTitle').textContent = song.title;
  $('songArtist').textContent = song.artist;
  updateSourceLink(song);
  updateSaveButton();
  renderLyrics();
  applyView();
  runRoman();
  runTranslate();
  renderSaved();
}

function formatTime(t) {
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
}

function renderLyrics() {
  const box = $('lyrics');
  const target = settings.get('target');
  box.textContent = '';
  S.rows = [];
  S.song.lines.forEach((line, i) => {
    if (!line.text) {
      box.append(make('div', 'gap'));
      S.rows[i] = null;
      return;
    }
    const row = make('div', 'row');
    row.dataset.i = String(i);
    const left = make('div', 'left');
    const o = make('div', 'o');
    o.lang = LANG_ATTR[S.lang] || 'en';
    if (typeof line.t === 'number') o.append(make('span', 'ts', formatTime(line.t)));
    const txt = make('span', 'txt', line.text);
    o.append(txt);
    const r = make('div', 'r');
    r.lang = 'en';
    left.append(o, r);
    const t = make('div', 't');
    t.lang = TARGET_ATTR[target] || 'en';
    row.append(left, t);
    box.append(row);
    S.rows[i] = { o, txt, r, t };
  });
  sync.attach();
}

function replaceLines(lines) {
  if (!S.song) return;
  S.song.lines = lines;
  S.song.tr = {};
  S.song.roman = null;
  S.lang = effectiveLang();
  renderLyrics();
  applyView();
  runRoman();
  runTranslate();
  if (library.has(S.song.id)) library.update(S.song.id, { lines, tr: {}, roman: null });
}

function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme = settings.get('theme');
  root.dataset.font = settings.get('font');
  root.dataset.align = settings.get('align');
  root.dataset.layout = settings.get('layout');
  root.dataset.dim = String(!!settings.get('dimRom'));
  root.style.setProperty('--fs', settings.get('fontSize') + 'px');
  root.style.setProperty('--lh', String(settings.get('lineHeight')));
  root.style.setProperty('--gap', settings.get('stanzaGap') + 'em');
  root.style.setProperty('--maxw', settings.get('maxWidth') + 'px');
  document.querySelectorAll('[data-out]').forEach(o => {
    const key = o.dataset.out;
    const v = settings.get(key);
    o.textContent = key === 'fontSize' || key === 'maxWidth' ? v + 'px' : key === 'stanzaGap' ? v + 'em' : key === 'tapLag' ? v + 's' : v;
  });
  document.body.classList.toggle('keep-chrome', !settings.get('readingHidesChrome'));
}

function applyView() {
  const box = $('lyrics');
  box.classList.toggle('hide-o', !settings.get('showOrig'));
  box.classList.toggle('hide-r', !settings.get('showRom'));
  box.classList.toggle('hide-t', !settings.get('showTr'));
  box.classList.toggle('show-ts', !!settings.get('timestamps'));
}

function syncControls() {
  document.querySelectorAll('[data-key]').forEach(el => {
    const v = settings.get(el.dataset.key);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el !== document.activeElement || el.type === 'range') el.value = v;
  });
}

function setRom(i, value) {
  const row = S.rows[i];
  if (row) row.r.textContent = value || '';
}

function setRuby(i, pairs) {
  const row = S.rows[i];
  if (!row) return;
  row.txt.textContent = '';
  for (const [ch, py] of pairs) {
    if (py) {
      const ruby = document.createElement('ruby');
      ruby.append(document.createTextNode(ch));
      ruby.append(make('rt', '', py));
      row.txt.append(ruby);
    } else {
      row.txt.append(document.createTextNode(ch));
    }
  }
}

async function runRoman() {
  cancelRoman();
  const song = S.song;
  if (!song) {
    refreshBusy();
    return;
  }
  S.rows.forEach((row, i) => {
    if (!row) return;
    row.r.textContent = '';
    row.txt.textContent = song.lines[i].text;
  });
  if (!settings.get('showRom')) {
    refreshBusy();
    return;
  }
  const ctl = new AbortController();
  const gen = S.romGen;
  S.romCtl = ctl;
  refreshBusy();
  const thaiMode = settings.get('thaiMode');
  const slow = [];
  const han = [];
  const alive = () => !ctl.signal.aborted && S.song === song && S.romGen === gen;
  try {
    let n = 0;
    for (let i = 0; i < song.lines.length; i++) {
      if (!alive()) return;
      const text = song.lines[i].text;
      if (!text || !S.rows[i]) continue;
      const kind = lineScript(text, S.lang);
      if (!kind) continue;
      if (kind === 'th') {
        if (thaiMode === 'tone') setRom(i, thaiTone(text));
        else slow.push({ i, text, kind });
      } else if (kind === 'ko') {
        setRom(i, koreanRoman(text));
      } else if (kind === 'ja') {
        const quick = quickJapanese(text);
        if (quick) setRom(i, quick);
        slow.push({ i, text, kind });
      } else if (kind === 'zh') {
        han.push({ i, text, kind });
      }
      if (++n % 25 === 0) await tick();
    }
    if (han.length) {
      try {
        let k = 0;
        for (const job of han) {
          if (!alive()) return;
          setRuby(job.i, await pinyinChars(job.text));
          if (++k % 15 === 0) await tick();
        }
      } catch (e) {
        if (!alive()) return;
        slow.push(...han);
      }
    }
    if (slow.length) {
      setNote('rom', 'Romanizing…');
      await pool(slow, 4, async job => {
        if (!alive()) return;
        try {
          let v = '';
          if (job.kind === 'ja') v = await japanese(job.text, ctl.signal);
          else if (job.kind === 'th') v = (song.roman && song.roman[job.i]) || (await googleRoman(job.text, ctl.signal));
          else v = await googleRoman(job.text, ctl.signal);
          if (v && alive()) setRom(job.i, v);
        } catch (e) {
          if (!alive()) throw e;
        }
      });
    }
  } catch (e) {
    if (alive() && !isAbort(e)) setNote('rom', 'Romanization is partly unavailable.');
  } finally {
    if (S.romCtl === ctl) {
      S.romCtl = null;
      if (alive()) setNote('rom', '');
      refreshBusy();
    }
  }
}

async function runTranslate() {
  cancelTranslate();
  const song = S.song;
  if (!song) {
    refreshBusy();
    return;
  }
  const target = settings.get('target');
  S.rows.forEach(r => {
    if (!r) return;
    r.t.textContent = '';
    r.t.lang = TARGET_ATTR[target] || 'en';
  });
  if (!settings.get('showTr')) {
    refreshBusy();
    return;
  }
  const sl = SOURCE_CODE[S.lang] || 'auto';
  if (sl === target) {
    refreshBusy();
    return;
  }
  const cached = song.tr && song.tr[target];
  if (cached) {
    cached.forEach((value, i) => {
      if (S.rows[i]) S.rows[i].t.textContent = value;
    });
    refreshBusy();
    return;
  }
  const ctl = new AbortController();
  S.trCtl = ctl;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TRANSLATE_LIMIT_MS);
  refreshBusy();
  setNote('tr', 'Translating…');
  const texts = song.lines.map(l => l.text);
  try {
    const out = await translateLines(texts, sl, target, ctl.signal, (i, value) => {
      if (!ctl.signal.aborted && S.song === song && S.rows[i]) S.rows[i].t.textContent = value;
    });
    if (S.trCtl !== ctl || S.song !== song) return;
    const missing = out.some((v, i) => texts[i] && !v && !alreadyTarget(texts[i], target));
    if (!missing) {
      song.tr = { ...(song.tr || {}), [target]: out };
      if (library.has(song.id)) library.update(song.id, { tr: song.tr });
    }
    setNote('tr', missing ? 'Some lines could not be translated.' : '', missing);
  } catch (e) {
    if (S.trCtl !== ctl) return;
    if (timedOut) setNote('tr', 'Translation timed out. Lines shown so far are partial.', true);
    else if (!isAbort(e)) setNote('tr', 'Translation failed: ' + e.message, true);
  } finally {
    clearTimeout(timer);
    if (S.trCtl === ctl) {
      S.trCtl = null;
      refreshBusy();
    }
  }
}

function updateSaveButton() {
  const btn = $('saveBtn');
  const saved = !!S.song && library.has(S.song.id);
  btn.textContent = saved ? '★ Saved' : '☆ Save';
  btn.classList.toggle('on', saved);
  btn.disabled = !S.song;
}

function toggleSave() {
  if (!S.song) return;
  if (library.has(S.song.id)) {
    library.remove(S.song.id);
    toast('Removed from Saved');
  } else if (library.save({ ...S.song })) {
    toast('Saved');
  } else {
    setNote('save', 'Could not save: browser storage is full or disabled.', true);
  }
  updateSaveButton();
  renderSaved();
}

function savedPreview(rec) {
  return rec.lines.filter(l => l.text).slice(0, 2).map(l => l.text).join(' • ');
}

function savedItems() {
  const all = library.list();
  const q = $('savedFilter').value.trim().toLowerCase();
  return q ? all.filter(r => (r.title + ' ' + r.artist + ' ' + r.source + ' ' + savedPreview(r)).toLowerCase().includes(q)) : all;
}

function renderSaved() {
  const all = library.list();
  const items = savedItems();
  const ul = $('savedList');
  ul.textContent = '';
  $('savedCount').textContent = all.length ? String(all.length) : '';
  $('clearSaved').hidden = !all.length;
  $('bulkExportBtn').disabled = !all.length;
  if (!items.length) {
    ul.append(make('li', 'empty-note', all.length ? 'No saved songs match your filter.' : 'Songs you save appear here.'));
    return;
  }
  for (const rec of items) {
    const li = make('li', 'item');
    if (S.song && S.song.id === rec.id) li.classList.add('active');
    const open = make('button', 'open');
    open.type = 'button';
    open.append(make('span', 'name', rec.title || 'Untitled'));
    if (rec.artist) open.append(make('span', 'by', rec.artist));
    open.append(make('span', 'preview', savedPreview(rec)));
    const tags = make('span', 'tags');
    tags.append(make('span', 'tag', rec.source));
    open.append(tags);
    open.addEventListener('click', () => openSaved(rec.id));
    const del = make('button', 'del', '✕');
    del.type = 'button';
    del.title = 'Delete saved song';
    del.setAttribute('aria-label', 'Delete ' + (rec.title || 'song'));
    del.addEventListener('click', () => {
      library.remove(rec.id);
      updateSaveButton();
      renderSaved();
      toast('Deleted');
    });
    li.append(open, del);
    ul.append(li);
  }
}

function openSaved(id) {
  const rec = library.get(id);
  if (!rec) return;
  abortSearch();
  cancelSong();
  $('placeholder').hidden = true;
  $('song').hidden = false;
  setView('song');
  setSong({ ...rec, tr: rec.tr || {} });
}

function copyLyrics() {
  if (!S.song) return;
  const parts = [];
  S.song.lines.forEach((line, i) => {
    if (!line.text) {
      parts.push('');
      return;
    }
    const row = S.rows[i];
    const block = [];
    if (settings.get('showOrig')) block.push(line.text);
    if (settings.get('showRom') && row && row.r.textContent) block.push(row.r.textContent);
    if (settings.get('showTr') && row && row.t.textContent) block.push(row.t.textContent);
    parts.push(block.join('\n'));
  });
  const text = (S.song.title + (S.song.artist ? ' - ' + S.song.artist : '') + '\n\n' + parts.join('\n')).trim();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Copy failed'));
  else toast('Clipboard is not available');
}

const LRC_STAMP = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/;

function lrcItem(source, title, artist, text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const tag = name => {
    const m = raw.match(new RegExp('^\\[' + name + ':([^\\]]*)\\]', 'mi'));
    return m ? m[1].trim() : '';
  };
  return {
    source,
    title: title || tag('ti') || 'Untitled',
    artist: artist || tag('ar'),
    url: '',
    load: async () => {
      let lines = LRC_STAMP.test(raw) ? parseLrc(raw) : [];
      if (!lines.some(l => l.text)) lines = parsePlain(raw.replace(/^\[[a-z]{2,8}:[^\]]*\]\s*$/gim, ''));
      return { lines };
    }
  };
}

function songFromText(fileName, text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const item = lrcItem('File', '', '', raw);
  let lines = LRC_STAMP.test(raw) ? parseLrc(raw) : [];
  if (!lines.some(l => l.text)) lines = parsePlain(raw.replace(/^\[[a-z]{2,8}:[^\]]*\]\s*$/gim, ''));
  if (!lines.some(l => l.text)) return null;
  let base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
  let artist = item.artist;
  let title = item.title === 'Untitled' ? '' : item.title;
  if (!title) {
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    if (m) {
      if (!artist) artist = m[1].trim();
      base = m[2].trim();
    }
    title = base || 'Untitled';
  }
  return {
    id: library.songId({ source: 'File', url: '', title, artist, lines }),
    source: 'File',
    url: '',
    title,
    artist,
    lines,
    roman: null,
    tr: {}
  };
}

async function collectImportEntries(files) {
  const entries = [];
  let zipped = false;
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      zipped = true;
      try {
        entries.push(...await readZip(await file.arrayBuffer()));
      } catch (e) {
        toast(file.name + ': ' + e.message);
      }
    } else {
      entries.push({ name: file.name, text: await file.text() });
    }
  }
  return { entries, zipped };
}

async function importLyricsFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  try {
    const { entries, zipped } = await collectImportEntries(files);
    const songs = entries.map(e => songFromText(e.name, e.text)).filter(Boolean);
    if (!songs.length) {
      toast('No lyrics found in the selected files');
      return;
    }
    if (songs.length === 1 && !zipped && S.tab === 'search') {
      const song = songs[0];
      openItem({
        source: 'File',
        title: song.title,
        artist: song.artist,
        url: '',
        load: async () => ({ lines: song.lines, title: song.title, artist: song.artist })
      });
      return;
    }
    if (!library.saveMany(songs)) {
      setNote('save', 'Could not save: browser storage is full or disabled.', true);
      return;
    }
    const skipped = entries.length - songs.length;
    showTab('saved');
    renderSaved();
    updateSaveButton();
    toast('Imported ' + songs.length + (songs.length === 1 ? ' song' : ' songs') + (skipped ? ', skipped ' + skipped : ''));
  } catch (e) {
    toast('Could not read the selected files');
  }
}

function exportSaved() {
  const items = savedItems();
  if (!items.length) {
    toast('Nothing to export');
    return;
  }
  const names = uniqueNames(items.map(r => safeName(r) + '.lrc'));
  if (items.length === 1) {
    downloadBlob(new Blob([toLrc(items[0])], { type: 'text/plain;charset=utf-8' }), names[0]);
    toast('Exported 1 song');
    return;
  }
  const zip = makeZip(items.map((r, i) => ({ name: names[i], data: toLrc(r) })));
  downloadBlob(zip, 'lyrics-' + new Date().toISOString().slice(0, 10) + '.zip');
  toast('Exported ' + items.length + ' songs');
}

async function updateApp() {
  const btn = $('updateBtn');
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update().catch(() => {})));
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    toast('Update check failed, reloading anyway');
  }
  const url = new URL(location.href);
  url.searchParams.set('v', String(Date.now()));
  location.replace(url.toString());
}

function setReading(on) {
  document.body.classList.toggle('reading', on);
  $('exitReading').hidden = !on;
  if (on) window.scrollTo({ top: 0 });
  window.dispatchEvent(new Event('resize'));
}

function onSettingChange(key) {
  syncControls();
  applyAppearance();
  applyView();
  if (key === null) {
    if (S.song) {
      S.lang = effectiveLang();
      renderLyrics();
      applyView();
      runRoman();
      runTranslate();
    }
    return;
  }
  if (key === 'target' || key === 'showTr') runTranslate();
  if (key === 'showRom' || key === 'thaiMode') runRoman();
  if (key === 'langOverride' && S.song) {
    S.lang = effectiveLang();
    renderLyrics();
    applyView();
    runRoman();
    runTranslate();
  }
}

function bindControls() {
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (!el || !el.dataset || !el.dataset.key) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'range' || el.type === 'number') value = Number(el.value);
    else value = el.value;
    settings.set(el.dataset.key, value);
  });
  settings.on(onSettingChange);
}

function setupInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    deferred = ev;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('installBtn').hidden = true;
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

function init() {
  bindControls();
  applyAppearance();
  syncControls();
  showTab('search');
  renderResults();
  renderSaved();
  updateSaveButton();
  refreshBusy();
  setupInstall();

  $('searchForm').addEventListener('submit', ev => {
    ev.preventDefault();
    startSearch($('q').value);
  });
  $('stopBtn').addEventListener('click', stopAll);
  $('optionsBtn').addEventListener('click', () => {
    syncControls();
    $('optionsDlg').showModal();
  });
  $('resetBtn').addEventListener('click', () => {
    if (confirm('Reset all options to their defaults?')) settings.reset();
  });
  $('optionsDlg').addEventListener('click', ev => {
    if (ev.target === $('optionsDlg')) $('optionsDlg').close();
  });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    showTab(b.dataset.tab);
    if (document.body.dataset.view === 'song') setView('list');
  }));
  $('savedFilter').addEventListener('input', renderSaved);
  $('clearSaved').addEventListener('click', () => {
    if (!confirm('Delete all saved songs?')) return;
    library.list().forEach(r => library.remove(r.id));
    updateSaveButton();
    renderSaved();
  });
  $('backBtn').addEventListener('click', () => setView('list'));
  $('saveBtn').addEventListener('click', toggleSave);
  $('readBtn').addEventListener('click', () => setReading(true));
  $('exitReading').addEventListener('click', () => setReading(false));
  $('copyBtn').addEventListener('click', copyLyrics);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && document.body.classList.contains('reading') && !$('optionsDlg').open) setReading(false);
  });
  $('pasteForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const text = $('pasteText').value;
    const title = $('pasteTitle').value.trim();
    const artist = $('pasteArtist').value.trim();
    if (LRC_STAMP.test(text)) openItem(lrcItem('Manual', title, artist, text));
    else openItem(manualItem(title, artist, text));
  });
  $('importLrcBtn').addEventListener('click', () => $('lrcFile').click());
  $('bulkImportBtn').addEventListener('click', () => $('lrcFile').click());
  $('bulkExportBtn').addEventListener('click', exportSaved);
  $('lrcFile').addEventListener('change', () => {
    const files = Array.from($('lrcFile').files || []);
    $('lrcFile').value = '';
    importLyricsFiles(files);
  });
  $('updateBtn').addEventListener('click', updateApp);
}

init();
