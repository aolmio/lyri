import { settings } from './settings.js';
import { SOURCES, urlItems, manualItem } from './sources.js';
import { detectLang, lineScript } from './lyrics.js';
import { translateLines } from './translate.js';
import { romanize } from './romanize.js';
import { isAbort } from './net.js';
import * as library from './library.js';

const $ = id => document.getElementById(id);

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const S = {
  searchId: 0,
  searchCtl: null,
  loadCtl: null,
  romCtl: null,
  trCtl: null,
  results: [],
  chips: {},
  song: null,
  lang: 'en',
  rows: [],
  tab: 'results',
  romCache: new Map(),
  query: ''
};

function setBusy(busy) {
  $('searchBtn').disabled = busy;
  $('searchBtn').textContent = busy ? 'Searching…' : 'Search';
  $('stopBtn').hidden = !busy;
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function setView(view) {
  document.body.dataset.view = view;
  if (view === 'song') window.scrollTo({ top: 0 });
}

function showTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('resultList').hidden = tab !== 'results';
  $('savedList').hidden = tab !== 'saved';
}

function renderChips() {
  const box = $('chips');
  box.textContent = '';
  for (const [name, info] of Object.entries(S.chips)) {
    const label = info.st === 'ok' ? `${name} · ${info.n}` : info.st === 'empty' ? `${name} · 0` : info.st === 'fail' ? `${name} · failed` : info.st === 'stopped' ? `${name} · stopped` : name;
    box.append(make('span', 'chip ' + info.st, label));
  }
}

function score(item, query) {
  const hay = ((item.title || '') + ' ' + (item.artist || '')).toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  return tokens.filter(t => hay.includes(t)).length / tokens.length;
}

function renderResults() {
  const ul = $('resultList');
  ul.textContent = '';
  if (!S.results.length) {
    const msg = Object.keys(S.chips).length ? 'No results yet.' : 'Results will appear here.';
    ul.append(make('li', 'empty-note', msg));
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
  if (S.searchCtl) S.searchCtl.abort();
  S.searchCtl = null;
  for (const info of Object.values(S.chips)) {
    if (info.st === 'loading') info.st = 'stopped';
  }
  renderChips();
  setBusy(false);
}

function startSearch(raw) {
  const q = raw.trim();
  if (!q) return;
  abortSearch();
  const id = S.searchId;
  const ctl = new AbortController();
  S.searchCtl = ctl;
  S.query = q;
  S.results = [];
  S.chips = {};
  showTab('results');
  setView('list');
  const isUrl = /^https?:\/\//i.test(q);
  const jobs = isUrl
    ? [['Page', () => urlItems(q, ctl.signal)]]
    : SOURCES.filter(s => settings.get(s.setting)).map(s => [s.name, () => s.search(q, ctl.signal)]);
  if (!jobs.length) {
    renderResults();
    setStatus('Enable at least one source in Options.', true);
    return;
  }
  let pending = jobs.length;
  setBusy(true);
  for (const [name] of jobs) S.chips[name] = { st: 'loading' };
  renderChips();
  renderResults();
  for (const [name, run] of jobs) {
    Promise.resolve()
      .then(run)
      .then(items => {
        if (id !== S.searchId) return;
        S.chips[name] = { st: items.length ? 'ok' : 'empty', n: items.length };
        for (const it of items) it._score = score(it, q);
        S.results = S.results.concat(items).sort((a, b) => b._score - a._score);
        renderResults();
      })
      .catch(e => {
        if (id !== S.searchId) return;
        S.chips[name] = { st: isAbort(e) ? 'stopped' : 'fail' };
      })
      .finally(() => {
        if (id !== S.searchId) return;
        renderChips();
        pending--;
        if (pending === 0) setBusy(false);
      });
  }
}

function abortSong() {
  if (S.loadCtl) S.loadCtl.abort();
  if (S.romCtl) S.romCtl.abort();
  if (S.trCtl) S.trCtl.abort();
  S.loadCtl = S.romCtl = S.trCtl = null;
}

async function openItem(item) {
  abortSearch();
  abortSong();
  const ctl = new AbortController();
  S.loadCtl = ctl;
  S.song = null;
  $('placeholder').hidden = true;
  $('song').hidden = false;
  $('songTitle').textContent = item.title || 'Loading…';
  $('songArtist').textContent = item.artist || '';
  updateSourceLink(item);
  $('lyrics').textContent = '';
  updateSaveButton();
  setView('song');
  setStatus('Loading lyrics from ' + item.source + '…');
  try {
    const res = await item.load(ctl.signal);
    if (ctl.signal.aborted) return;
    if (!res.lines || !res.lines.some(l => l.text)) throw new Error('No lyrics found');
    setSong({
      id: library.songId({ source: item.source, url: item.url, title: res.title || item.title, artist: res.artist || item.artist, lines: res.lines }),
      source: item.source,
      url: item.url,
      title: res.title || item.title || 'Untitled',
      artist: res.artist || item.artist || '',
      lines: res.lines,
      roman: res.roman || null,
      tr: {}
    });
  } catch (e) {
    if (ctl.signal.aborted || isAbort(e)) return;
    setStatus('Could not load lyrics from ' + item.source + ': ' + e.message, true);
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
  S.song = song;
  S.lang = effectiveLang();
  S.romCache = new Map();
  $('songTitle').textContent = song.title;
  $('songArtist').textContent = song.artist;
  updateSourceLink(song);
  updateSaveButton();
  setStatus('');
  renderLyrics();
  applyView();
  runRoman();
  runTranslate();
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function renderLyrics() {
  const box = $('lyrics');
  box.textContent = '';
  S.rows = [];
  S.song.lines.forEach((line, i) => {
    if (!line.text) {
      box.append(make('div', 'gap'));
      S.rows[i] = null;
      return;
    }
    const row = make('div', 'row');
    const left = make('div', 'left');
    const o = make('div', 'o');
    if (typeof line.t === 'number') o.append(make('span', 'ts', formatTime(line.t)));
    o.append(document.createTextNode(line.text));
    const r = make('div', 'r');
    left.append(o, r);
    const t = make('div', 't');
    row.append(left, t);
    box.append(row);
    S.rows[i] = { r, t };
  });
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
    o.textContent = key === 'fontSize' || key === 'maxWidth' ? v + 'px' : key === 'stanzaGap' ? v + 'em' : v;
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

async function runRoman() {
  if (S.romCtl) S.romCtl.abort();
  S.romCtl = null;
  if (!S.song || !settings.get('showRom')) return;
  const ctl = new AbortController();
  S.romCtl = ctl;
  const song = S.song;
  const thaiMode = settings.get('thaiMode');
  const needsWork = song.lines.some(l => l.text && lineScript(l.text, S.lang));
  if (!needsWork) return;
  for (let i = 0; i < song.lines.length; i++) {
    if (ctl.signal.aborted || song !== S.song) return;
    const row = S.rows[i];
    const text = song.lines[i].text;
    if (!row || !text) continue;
    const kind = lineScript(text, S.lang);
    if (!kind) {
      row.r.textContent = '';
      continue;
    }
    const key = kind + '|' + thaiMode + '|' + text;
    let value = S.romCache.get(key);
    if (value === undefined) {
      try {
        value = await romanize(text, kind, {
          signal: ctl.signal,
          thaiMode,
          plainThai: song.roman ? song.roman[i] : '',
          onStatus: msg => setStatus(msg)
        });
        if (status().startsWith('Loading Japanese')) setStatus('');
      } catch (e) {
        if (ctl.signal.aborted) return;
        value = '';
      }
      S.romCache.set(key, value);
    }
    if (ctl.signal.aborted || song !== S.song) return;
    row.r.textContent = value;
  }
}

function status() {
  return $('status').textContent;
}

async function runTranslate() {
  if (S.trCtl) S.trCtl.abort();
  S.trCtl = null;
  if (!S.song || !settings.get('showTr')) return;
  const song = S.song;
  const target = settings.get('target');
  S.rows.forEach(r => { if (r) r.t.textContent = ''; });
  const cached = song.tr && song.tr[target];
  if (cached) {
    cached.forEach((value, i) => { if (S.rows[i]) S.rows[i].t.textContent = value; });
    return;
  }
  const ctl = new AbortController();
  S.trCtl = ctl;
  setStatus('Translating…');
  try {
    const out = await translateLines(song.lines.map(l => l.text), target, ctl.signal, (i, value) => {
      if (ctl.signal.aborted || song !== S.song) return;
      if (S.rows[i]) S.rows[i].t.textContent = value;
    });
    if (ctl.signal.aborted || song !== S.song) return;
    song.tr = { ...(song.tr || {}), [target]: out };
    if (library.has(song.id)) library.update(song.id, { tr: song.tr });
    setStatus('');
  } catch (e) {
    if (ctl.signal.aborted || isAbort(e)) return;
    setStatus('Translation failed: ' + e.message, true);
  }
}

function updateSaveButton() {
  const btn = $('saveBtn');
  const saved = !!S.song && library.has(S.song.id);
  btn.textContent = saved ? '★ Saved' : '☆ Save';
  btn.disabled = !S.song;
}

function toggleSave() {
  if (!S.song) return;
  if (library.has(S.song.id)) {
    library.remove(S.song.id);
  } else {
    const ok = library.save({ ...S.song });
    if (!ok) setStatus('Could not save: browser storage is full or disabled.', true);
  }
  updateSaveButton();
  renderSaved();
}

function renderSaved() {
  const items = library.list();
  const ul = $('savedList');
  ul.textContent = '';
  $('savedCount').textContent = items.length ? '(' + items.length + ')' : '';
  if (!items.length) {
    ul.append(make('li', 'empty-note', 'Songs you save appear here.'));
    return;
  }
  for (const rec of items) {
    const li = make('li', 'item');
    if (S.song && S.song.id === rec.id) li.classList.add('active');
    const open = make('button', 'open');
    open.type = 'button';
    open.append(make('span', 'name', rec.title || 'Untitled'));
    if (rec.artist) open.append(make('span', 'by', rec.artist));
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
      if (S.song && S.song.id === rec.id) updateSaveButton();
      renderSaved();
    });
    li.append(open, del);
    ul.append(li);
  }
}

function openSaved(id) {
  const rec = library.get(id);
  if (!rec) return;
  abortSearch();
  abortSong();
  $('placeholder').hidden = true;
  $('song').hidden = false;
  setView('song');
  setSong({ ...rec, tr: rec.tr || {} });
  renderSaved();
}

function copyLyrics() {
  if (!S.song) return;
  const parts = [];
  S.song.lines.forEach((line, i) => {
    if (!line.text) { parts.push(''); return; }
    const row = S.rows[i];
    const block = [];
    if (settings.get('showOrig')) block.push(line.text);
    if (settings.get('showRom') && row && row.r.textContent) block.push(row.r.textContent);
    if (settings.get('showTr') && row && row.t.textContent) block.push(row.t.textContent);
    parts.push(block.join('\n'));
  });
  const text = (S.song.title + (S.song.artist ? ' - ' + S.song.artist : '') + '\n\n' + parts.join('\n')).trim();
  const done = () => {
    $('copyBtn').textContent = 'Copied';
    setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => setStatus('Copy failed.', true));
  else setStatus('Clipboard is not available in this browser.', true);
}

function setReading(on) {
  document.body.classList.toggle('reading', on);
  $('exitReading').hidden = !on;
  if (on) window.scrollTo({ top: 0 });
}

function onSettingChange(key) {
  syncControls();
  applyAppearance();
  applyView();
  if (key === null) {
    if (S.song) {
      S.lang = effectiveLang();
      runRoman();
      runTranslate();
    }
    return;
  }
  if (key === 'target' || key === 'showTr') runTranslate();
  if (key === 'showRom' || key === 'thaiMode') runRoman();
  if (key === 'langOverride' && S.song) {
    S.lang = effectiveLang();
    S.romCache = new Map();
    runRoman();
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

function init() {
  bindControls();
  applyAppearance();
  syncControls();
  renderResults();
  renderSaved();
  updateSaveButton();

  $('searchForm').addEventListener('submit', ev => {
    ev.preventDefault();
    startSearch($('q').value);
  });
  $('stopBtn').addEventListener('click', () => {
    abortSearch();
    renderResults();
  });
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
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
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
    openItem(manualItem($('pasteTitle').value.trim(), $('pasteArtist').value.trim(), $('pasteText').value));
  });
}

init();
