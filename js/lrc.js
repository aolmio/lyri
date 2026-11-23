const pad = (n, w = 2) => String(n).padStart(w, '0');

export function fmtClock(t, decimals = 1) {
  const v = Math.max(0, Number(t) || 0);
  const scale = Math.pow(10, decimals);
  const whole = Math.floor(v * scale + 1e-6);
  const secs = Math.floor(whole / scale);
  const frac = whole % scale;
  return pad(Math.floor(secs / 60)) + ':' + pad(secs % 60) + (decimals ? '.' + pad(frac, decimals) : '');
}

export function fmtStamp(t) {
  return fmtClock(t, 0);
}

export function hasTimes(lines) {
  return lines.some(l => l.text && typeof l.t === 'number');
}

export function buildTimeline(lines) {
  const out = [];
  lines.forEach((l, i) => {
    if (l.text && typeof l.t === 'number') out.push({ t: l.t, i });
  });
  out.sort((a, b) => a.t - b.t || a.i - b.i);
  return out;
}

export function activeIndex(timeline, pos) {
  let lo = 0;
  let hi = timeline.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t <= pos) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? -1 : timeline[found].i;
}

export function endTime(lines) {
  let end = 0;
  for (const l of lines) if (l.text && typeof l.t === 'number' && l.t > end) end = l.t;
  return end;
}

export function nextTarget(lines, from) {
  for (let i = from + 1; i < lines.length; i++) if (lines[i].text) return i;
  return -1;
}

export function firstTarget(lines) {
  for (let i = 0; i < lines.length; i++) if (lines[i].text && typeof lines[i].t !== 'number') return i;
  return nextTarget(lines, -1);
}

export function round2(t) {
  return Math.round(t * 100) / 100;
}

export function stampLine(lines, i, t) {
  const prev = lines[i].t;
  lines[i].t = round2(Math.max(0, t));
  return prev;
}

export function restoreStamp(lines, i, prev) {
  if (typeof prev === 'number') lines[i].t = prev;
  else delete lines[i].t;
}

export function adjustLine(lines, i, d) {
  if (typeof lines[i].t !== 'number') return false;
  lines[i].t = round2(Math.max(0, lines[i].t + d));
  return true;
}

export function shiftAll(lines, d) {
  for (const l of lines) if (typeof l.t === 'number') l.t = round2(Math.max(0, l.t + d));
}

export function clearAll(lines) {
  for (const l of lines) delete l.t;
}

export function toLrc(song) {
  const out = [];
  if (song.title) out.push('[ti:' + song.title + ']');
  if (song.artist) out.push('[ar:' + song.artist + ']');
  let last = null;
  for (const l of song.lines) {
    if (!l.text) {
      if (last !== null) {
        out.push('[' + fmtClock(last + 0.01, 2) + ']');
        last = null;
      }
      continue;
    }
    if (typeof l.t === 'number') {
      out.push('[' + fmtClock(l.t, 2) + ']' + l.text);
      last = l.t;
    } else {
      out.push(l.text);
    }
  }
  return out.join('\n') + '\n';
}

export function safeName(song) {
  const raw = [song.artist, song.title].filter(Boolean).join(' - ') || 'lyrics';
  return raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'lyrics';
}
