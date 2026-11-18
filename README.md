# Lyrics Studio

A static web app that searches several lyrics databases at once, shows lyrics with romanization (pinyin, romaji, Korean, Thai with tone marks) and translates them to English, Chinese or Burmese. No build step and no backend.

## Run it

Serve the folder over HTTP (ES modules do not load from `file://`):

```
npm run serve
```

then open http://localhost:8765/.

## Host on GitHub Pages

1. Push this folder to a repository.
2. Settings → Pages → Deploy from a branch → `main` / root.
3. Open `https://<user>.github.io/<repo>/`.

## Features

- One search bar queries LRCLIB, Lyrics.ovh, NetEase and SiamZone in parallel. Results appear as each source answers.
- Stop button next to Search cancels every in-flight request. Opening any result also cancels the rest of the search and unlocks Search immediately. Every network step has a hard timeout, so nothing can hang.
- Paste a lyrics page URL (SiamZone, Genius and similar) into the search bar to import that page.
- SiamZone is searched through several routes at once (Bing, Yahoo and DuckDuckGo through the Jina reader, the same engines through CORS proxies, the site's own artist pages, and optionally Google Custom Search). The lyric page is fetched through rotating proxies with a Jina fallback, then reduced to the lyric block only. Menus, banners, "ADVERTISEMENT" and "on Amazon Music Unlimited (ad)" lines are removed.
- Translation to English, Chinese (Simplified) and Burmese through Google Translate, with MyMemory as a fallback. The song is sent in context-sized blocks so lines keep their meaning. If Google merges or splits lines, it retries per line.
- Romanization: pinyin shown as ruby text above Chinese characters, Japanese romaji, Korean Revised Romanization, Thai with tone marks (built in) or SiamZone/Google plain romanization.
  - Japanese kana lines show romaji instantly from a built-in converter. Google then refines them, and kuroshiro (loaded in the background) gives the best result including kanji.
- Saved songs live on their own tab, are stored in the browser with their translations, can be filtered, and each can be deleted.
- Options: theme, font, text size, line and stanza spacing, column width, alignment, side-by-side layout, reading mode, language and source switches.
- Layout adapts to phones, tablets and desktops. The app can be installed as a PWA.

## SiamZone search with Google Custom Search (optional)

1. Create a Programmable Search Engine at https://programmablesearchengine.google.com limited to `siamzone.com/music/thailyric/*` and copy its Search engine ID.
2. Enable the Custom Search API in Google Cloud and create an API key. Restrict the key to your site's HTTP referrer.
3. Paste both into Options → SiamZone search.

This only adds one more route. SiamZone search works without it.

## CORS proxy

SiamZone, NetEase and the search engines do not send CORS headers, so the browser reaches them through public proxies. For reliability deploy `worker/cors-proxy.js` as a Cloudflare Worker and set its URL in Options, for example `https://your-worker.workers.dev/?url={url}`.

## Notes

- Burmese text uses Noto Sans Myanmar from Google Fonts. Translation lines are never italic, never split inside a syllable cluster and have extra line height for stacked diacritics.
- Thai tone marks come from a rule-based syllable parser. Common words are accurate, but words with hidden syllables or Pali/Sanskrit spellings can be wrong. Switch to plain romanization in Options if needed.
- Lyrics are copyrighted by their owners. The app only fetches and displays them for personal reading.
- The Google Translate endpoint used here is unofficial and may be rate limited.

## Tests

```
npm test
```

runs the unit tests. `npm run e2e` drives the real page in Chromium against mocked network responses (needs Playwright and `npm run serve` running).
