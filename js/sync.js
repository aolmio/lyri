import { Clock } from './clock.js';
import {
  fmtClock, buildTimeline, activeIndex, nextTarget, firstTarget,
  stampLine, restoreStamp, adjustLine, shiftAll, clearAll, toLrc, safeName
} from './lrc.js';
import { parseLrc } from './lyrics.js';
import { findSynced } from './sources.js';
import { isAbort } from './net.js';

const $ = id => document.getElementById(id);
const FIND_LIMIT_MS = 25000;
const AUTO_PAUSE_AFTER_END = 12;
const FOLLOW_PAUSE_MS = 2500;

export function initSync(ctx) {
  const clock = new Clock();
  const root = $('transport');
  const box = $('lyrics');
  const timeEl = $('tpTime');
  const seek = $('tpSeek');
  const note = $('tpNote');
  const panel = $('syncPanel');
  const nextEl = $('syncNext');
  const fileInput = $('tpFile');
  const btn = {
    play: root.querySelector('[data-act="play"]'),
    pause: root.querySelector('[data-act="pause"]'),
    stop: root.querySelector('[data-act="stop"]')
  };

  let song = null;
  let timeline = [];
  let estimated = false;
  let rowEls = new Map();
  let active = -1;
  let raf = 0;
  let dragging = false;
  let userAt = 0;
  let editing = false;
  let ptr = -1;
  let sel = -1;
  let history = [];
  let persistTimer = 0;
  let wake = null;
  let findCtl = null;
  let lastText = '';

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setNote(text, error = false) {
    note.textContent = text || '';
    note.classList.toggle('error', !!error);
  }

  function scrollToRow(el) {
    const rect = el.getBoundingClientRect();
    const bar = root.hidden ? 0 : root.offsetHeight;
    const view = window.innerHeight - bar;
    const target = window.scrollY + rect.top - (view - rect.height) / 2;
    window.scrollTo({ top: Math.max(0, target), behavior: reduced() ? 'auto' : 'smooth' });
  }

  function estimateTimeline(lines) {
    const out = [];
    let t = 0;
    lines.forEach((l, i) => {
      if (!l.text) {
        t += 1.2;
        return;
      }
      out.push({ t, i });
      const len = Array.from(l.text).length;
      t += Math.min(7, Math.max(2.2, 1.4 + len * 0.09));
    });
    return out;
  }

  function computeTimeline() {
    const real = buildTimeline(song.lines);
    if (real.length) {
      estimated = false;
      return real;
    }
    estimated = !editing;
    return estimated ? estimateTimeline(song.lines) : [];
  }

  function timelineEnd() {
    return timeline.length ? timeline[timeline.length - 1].t : 0;
  }

  function setActive(idx, force) {
    const old = rowEls.get(active);
    if (old) old.classList.remove('active');
    active = idx;
    const el = rowEls.get(idx);
    if (!el) return;
    el.classList.add('active');
    if (force || (ctx.settings.get('follow') && Date.now() - userAt > FOLLOW_PAUSE_MS)) scrollToRow(el);
  }

  function updateSeekMax(pos) {
    let max = Math.max(60, timelineEnd() + 20);
    if (editing) max = Math.max(max, pos + 30);
    if (Number(seek.max) !== max) seek.max = String(max);
  }

  function updateButtons() {
    const live = timeline.length > 0 || editing;
    btn.play.disabled = clock.playing || !live;
    btn.pause.disabled = !clock.playing;
    btn.stop.disabled = !clock.playing && clock.position === 0;
    root.classList.toggle('playing', clock.playing);
  }

  function update(force) {
    if (!song) return;
    const pos = clock.position;
    const text = fmtClock(pos, 1);
    if (text !== lastText) {
      lastText = text;
      timeEl.textContent = text;
    }
    updateSeekMax(pos);
    if (!dragging) seek.value = String(pos);
    const idx = timeline.length ? activeIndex(timeline, pos) : -1;
    if (idx !== active || force) setActive(idx, force && idx >= 0);
    if (clock.playing && !editing && timeline.length && pos > timelineEnd() + AUTO_PAUSE_AFTER_END) {
      pause();
    }
  }

  function tick() {
    raf = 0;
    update(false);
    if (clock.playing) startLoop();
  }

  function startLoop() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  async function lockWake() {
    try {
      if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch (e) {
      wake = null;
    }
  }

  function releaseWake() {
    try {
      if (wake) wake.release();
    } catch (e) {
      wake = null;
    }
    wake = null;
  }

  function play() {
    if (!song || (!timeline.length && !editing)) return;
    clock.play();
    userAt = 0;
    startLoop();
    lockWake();
    updateButtons();
  }

  function pause() {
    clock.pause();
    stopLoop();
    releaseWake();
    update(false);
    updateButtons();
  }

  function stop() {
    clock.stop();
    stopLoop();
    releaseWake();
    update(false);
    updateButtons();
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }

  function gotoTime(t) {
    clock.seek(t);
    update(true);
    updateButtons();
  }

  function paintTs(i) {
    const row = rowEls.get(i);
    if (!row || !song.lines[i]) return;
    const o = row.querySelector('.o');
    const t = song.lines[i].t;
    const has = typeof t === 'number';
    let ts = o.querySelector('.ts');
    if (!has && !editing) {
      if (ts) ts.remove();
      return;
    }
    if (!ts) {
      ts = document.createElement('span');
      ts.className = 'ts';
      o.prepend(ts);
    }
    ts.textContent = has ? fmtClock(t, editing ? 2 : 0) : '--:--';
    ts.classList.toggle('empty', !has);
  }

  function paintAllTs() {
    rowEls.forEach((_, i) => paintTs(i));
  }

  function markTargets() {
    rowEls.forEach((el, i) => {
      el.classList.toggle('target', editing && i === ptr);
      el.classList.toggle('picked', editing && i === sel && i !== ptr);
    });
    nextEl.textContent = ptr >= 0 && song.lines[ptr] ? song.lines[ptr].text : 'Every line is marked';
  }

  function fitHeight() {
    document.documentElement.style.setProperty('--tp-h', root.hidden ? '0px' : root.offsetHeight + 'px');
  }

  function refresh() {
    timeline = computeTimeline();
    const has = timeline.length > 0 && !estimated;
    if (editing && ptr >= 0 && (!song.lines[ptr] || !song.lines[ptr].text)) ptr = firstTarget(song.lines);
    root.hidden = false;
    document.body.classList.add('has-transport');
    root.classList.toggle('unsynced', !has && !editing);
    root.classList.toggle('editing', editing);
    panel.hidden = !editing;
    box.classList.toggle('synced', timeline.length > 0 || editing);
    box.classList.toggle('editing', editing);
    paintAllTs();
    markTargets();
    active = -1;
    update(true);
    updateButtons();
    fitHeight();
  }

  function attach() {
    const next = ctx.getSong();
    if (next !== song) {
      clock.stop();
      stopLoop();
      releaseWake();
      editing = false;
      history = [];
      ptr = -1;
      sel = -1;
      setNote('');
    }
    song = next;
    rowEls = new Map();
    if (!song) {
      detach();
      return;
    }
    box.querySelectorAll('.row').forEach(r => rowEls.set(Number(r.dataset.i), r));
    refresh();
  }

  function detach() {
    clock.stop();
    stopLoop();
    releaseWake();
    editing = false;
    history = [];
    song = null;
    timeline = [];
    estimated = false;
    rowEls = new Map();
    active = -1;
    root.hidden = true;
    panel.hidden = true;
    setNote('');
    box.classList.remove('synced', 'editing');
    document.body.classList.remove('has-transport');
    fitHeight();
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(flush, 600);
  }

  function flush() {
    if (!persistTimer) return;
    clearTimeout(persistTimer);
    persistTimer = 0;
    ctx.persist();
  }

  function changed() {
    timeline = computeTimeline();
    paintAllTs();
    markTargets();
    root.classList.toggle('unsynced', (!timeline.length || estimated) && !editing);
    update(false);
    updateButtons();
    schedulePersist();
  }

  function enterEdit() {
    editing = true;
    history = [];
    sel = -1;
    ptr = firstTarget(song.lines);
    setNote('');
    $('syncMore').open = window.innerWidth > 560;
    refresh();
  }

  function tap() {
    if (!song || !editing) return;
    if (ptr < 0) {
      ctx.toast('Every line is marked. Press Done, or tap a line to mark it again');
      return;
    }
    if (!clock.playing) {
      ctx.toast('Press Play, then mark each line as it starts');
      return;
    }
    const i = ptr;
    const lag = Number(ctx.settings.get('tapLag')) || 0;
    const prev = stampLine(song.lines, i, clock.position - lag);
    history.push({ i, prev });
    sel = i;
    const nx = nextTarget(song.lines, i);
    ptr = nx;
    if (nx < 0) ctx.toast('Last line marked. Press Done to finish.');
    changed();
  }

  function undo() {
    const h = history.pop();
    if (!h) {
      ctx.toast('Nothing to undo');
      return;
    }
    restoreStamp(song.lines, h.i, h.prev);
    ptr = h.i;
    sel = h.i;
    changed();
  }

  function fine(d) {
    if (sel < 0 || !song.lines[sel]) {
      ctx.toast('Tap a line first, then fine-tune its time');
      return;
    }
    const before = song.lines[sel].t;
    if (!adjustLine(song.lines, sel, d)) {
      ctx.toast('That line has no time yet');
      return;
    }
    history.push({ i: sel, prev: before });
    changed();
    gotoTime(song.lines[sel].t);
  }

  function clearLine() {
    if (sel < 0 || !song.lines[sel] || typeof song.lines[sel].t !== 'number') {
      ctx.toast('Tap a line that has a time first');
      return;
    }
    history.push({ i: sel, prev: song.lines[sel].t });
    restoreStamp(song.lines, sel, undefined);
    ptr = sel;
    changed();
  }

  function shift(d) {
    if (!timeline.length) {
      ctx.toast('No times to shift yet');
      return;
    }
    shiftAll(song.lines, d);
    history = [];
    changed();
  }

  function restart() {
    if (!confirm('Remove every time stamp from this song?')) return;
    clearAll(song.lines);
    history = [];
    sel = -1;
    ptr = firstTarget(song.lines);
    changed();
  }

  function done() {
    editing = false;
    const has = buildTimeline(song.lines).length > 0;
    clearTimeout(persistTimer);
    persistTimer = 0;
    ctx.persist();
    if (!has) ctx.toast('No lines were marked');
    else ctx.toast(ctx.isSaved() ? 'Sync saved' : 'Sync applied. Press Save to keep it');
    refresh();
  }

  function exportText() {
    return toLrc(song);
  }

  function copyLrc() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      ctx.toast('Clipboard is not available');
      return;
    }
    navigator.clipboard.writeText(exportText()).then(() => ctx.toast('LRC copied'), () => ctx.toast('Copy failed'));
  }

  function downloadLrc() {
    const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName(song) + '.lrc';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function applyLines(lines) {
    editing = false;
    history = [];
    sel = -1;
    ptr = -1;
    clock.stop();
    stopLoop();
    ctx.replaceLines(lines);
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const lines = parseLrc(text);
      if (!lines.some(l => typeof l.t === 'number')) {
        setNote('That file has no [mm:ss.xx] time stamps.', true);
        return;
      }
      setNote('');
      applyLines(lines);
      ctx.toast('Imported ' + lines.filter(l => l.text).length + ' timed lines');
    } catch (e) {
      setNote('Could not read that file.', true);
    }
  }

  async function find() {
    if (!song) return;
    if (findCtl) findCtl.abort();
    const ctl = new AbortController();
    findCtl = ctl;
    const timer = setTimeout(() => ctl.abort(), FIND_LIMIT_MS);
    setNote('Looking for a synced version online…');
    root.classList.add('finding');
    try {
      const hit = await findSynced(song.title, song.artist, ctl.signal);
      if (findCtl !== ctl) return;
      if (!hit) {
        setNote('No synced version found online. Use Sync manually or import an .lrc file.', true);
        return;
      }
      const label = hit.title + (hit.artist ? ' – ' + hit.artist : '') + ' (' + hit.source + ')';
      if (confirm('Replace the current text with the synced lyrics from ' + label + '?')) {
        setNote('');
        applyLines(hit.lines);
        ctx.toast('Synced lyrics loaded');
      } else {
        setNote('');
      }
    } catch (e) {
      if (findCtl !== ctl) return;
      setNote(isAbort(e) ? 'The online search timed out. Try again or sync manually.' : 'Could not search online: ' + e.message, true);
    } finally {
      clearTimeout(timer);
      if (findCtl === ctl) {
        findCtl = null;
        root.classList.remove('finding');
      }
    }
  }

  const actions = {
    play,
    pause,
    stop,
    back: () => gotoTime(clock.position - 0.5),
    fwd: () => gotoTime(clock.position + 0.5),
    edit: enterEdit,
    manual: enterEdit,
    find,
    import: () => fileInput.click(),
    undo,
    fine: b => fine(Number(b.dataset.d)),
    clearline: clearLine,
    shift: b => shift(Number(b.dataset.d)),
    restart,
    copy: copyLrc,
    download: downloadLrc,
    done
  };

  root.addEventListener('pointerdown', ev => {
    const b = ev.target.closest('[data-act="tap"]');
    if (!b) return;
    ev.preventDefault();
    tap();
  });

  root.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]');
    if (!b || !song) return;
    const fn = actions[b.dataset.act];
    if (fn) fn(b);
    if (ev.detail > 0 && editing && b.dataset.act !== 'tap') b.blur();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    importFile(file);
  });

  box.addEventListener('click', ev => {
    if (!song || (!timeline.length && !editing)) return;
    if (window.getSelection && String(window.getSelection())) return;
    const row = ev.target.closest('.row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (editing) {
      ptr = i;
      sel = i;
      markTargets();
    }
    const t = song.lines[i] && song.lines[i].t;
    if (typeof t === 'number') gotoTime(t);
    else if (estimated) {
      const hit = timeline.find(e => e.i === i);
      if (hit) gotoTime(hit.t);
    }
  });

  seek.addEventListener('pointerdown', () => { dragging = true; });
  ['pointerup', 'pointercancel', 'change', 'blur'].forEach(name => seek.addEventListener(name, () => { dragging = false; }));
  seek.addEventListener('input', () => {
    if (!song) return;
    clock.seek(Number(seek.value));
    update(true);
    updateButtons();
  });

  ['wheel', 'touchmove'].forEach(name => window.addEventListener(name, () => { userAt = Date.now(); }, { passive: true }));
  window.addEventListener('keydown', ev => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(ev.key)) userAt = Date.now();
  });

  document.addEventListener('keydown', ev => {
    if (!song || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const el = ev.target;
    const tag = el && el.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (el && el.isContentEditable)) return;
    if ($('optionsDlg').open) return;
    const isTap = el && el.dataset && el.dataset.act === 'tap';
    if (editing && (ev.key === ' ' || ev.key === 'Enter')) {
      if (tag === 'BUTTON' && !isTap) return;
      ev.preventDefault();
      if (!ev.repeat) tap();
      return;
    }
    if (!editing && ev.key === ' ' && timeline.length && tag !== 'BUTTON' && tag !== 'A' && tag !== 'SUMMARY') {
      ev.preventDefault();
      if (clock.playing) pause();
      else play();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !clock.playing) return;
    lockWake();
    startLoop();
  });

  window.addEventListener('pagehide', flush);
  if ('ResizeObserver' in window) new ResizeObserver(fitHeight).observe(root);

  return { attach, detach };
}
