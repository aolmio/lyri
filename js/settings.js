const KEY = 'lyricsStudio.settings';

export const DEFAULTS = {
  theme: 'auto',
  font: 'system',
  fontSize: 20,
  lineHeight: 1.6,
  stanzaGap: 1.1,
  align: 'left',
  maxWidth: 720,
  layout: 'stacked',
  showOrig: true,
  showRom: true,
  showTr: true,
  dimRom: true,
  timestamps: true,
  follow: true,
  tapLag: 0.2,
  readingHidesChrome: true,
  target: 'en',
  langOverride: 'auto',
  thaiMode: 'tone',
  cseKey: '',
  cseCx: '',
  proxy: '',
  srcLrclib: true,
  srcOvh: true,
  srcNetease: true,
  srcSiamzone: true
};

let data = { ...DEFAULTS };
try {
  Object.assign(data, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (e) {
  data = { ...DEFAULTS };
}

const subscribers = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    return;
  }
}

export const settings = {
  get(key) {
    return data[key];
  },
  set(key, value) {
    data[key] = value;
    persist();
    subscribers.forEach(fn => fn(key, value));
  },
  reset() {
    data = { ...DEFAULTS };
    persist();
    subscribers.forEach(fn => fn(null, null));
  },
  on(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }
};
