const KEY = 'lyricsStudio.library';

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

export function songId(song) {
  const base = song.url || (song.title || '') + '|' + (song.artist || '') + '|' + song.lines.length;
  return (song.source || 'x') + '|' + base;
}

export function list() {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export function has(id) {
  return read().some(s => s.id === id);
}

export function get(id) {
  return read().find(s => s.id === id) || null;
}

export function save(song) {
  const items = read().filter(s => s.id !== song.id);
  items.push({ ...song, savedAt: Date.now() });
  return write(items);
}

export function saveMany(songs) {
  const map = new Map(read().map(s => [s.id, s]));
  const now = Date.now();
  songs.forEach((song, i) => map.set(song.id, { ...song, savedAt: now + i }));
  return write([...map.values()]);
}

export function update(id, patch) {
  const items = read();
  const i = items.findIndex(s => s.id === id);
  if (i < 0) return false;
  items[i] = { ...items[i], ...patch };
  return write(items);
}

export function remove(id) {
  return write(read().filter(s => s.id !== id));
}
