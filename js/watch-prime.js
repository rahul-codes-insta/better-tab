// Runs on Prime Video pages. Records what you're watching and how far in,
// so the new tab page can offer "Keep watching". Data stays in chrome.storage.local.
//
// Prime Video is a single-page app: moving between titles doesn't reload the page,
// so <meta og:image> in the live document can still describe the *first* title you
// opened. To keep the thumbnail and text in sync, the artwork is read from a fresh
// copy of the current title's page (fetched once per title) and only used when its
// title matches what's playing.
(() => {
  if (window.__horizonPrime) return;
  window.__horizonPrime = true;

  const KEY = 'watch:prime';
  const MIN_LENGTH = 5 * 60;      // ignore trailers and ads (< 5 min)
  const SAVE_EVERY = 15 * 1000;   // regular saves while playing
  const store = chrome.storage.local;

  let enabled = true;
  let lastSave = 0;
  let lastKey = '';               // path + title of the last thing saved

  const readEnabled = (st) => st?.settings?.continueWatching !== false;
  store.get('state').then(({ state }) => { enabled = readEnabled(state); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.state) enabled = readEnabled(changes.state.newValue);
  });

  /* ---------- helpers ---------- */

  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isDetailPath = (p) => /\/detail\/|\/dp\//i.test(p);

  function cleanTitle(t) {
    return clean(t)
      .replace(/^\s*(Prime Video|Amazon\.[a-z.]+)\s*[:|–-]\s*/i, '')
      .replace(/\s*[|–]\s*(Prime Video|Amazon\.[a-z.]+).*$/i, '')
      .replace(/\s+-\s+(Prime Video|Amazon\.[a-z.]+).*$/i, '')
      .replace(/^Watch\s+/i, '')
      .trim();
  }
  // "The Boys - Season 3" vs "The Boys" → same show
  const sameTitle = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

  // The main programme is the longest video that has actually started.
  function mainVideo() {
    let best = null;
    for (const v of document.querySelectorAll('video')) {
      const d = v.duration;
      if (!Number.isFinite(d) || d < MIN_LENGTH || v.currentTime < 1) continue;
      if (!best || d > best.duration) best = v;
    }
    return best;
  }

  /* ---------- title + artwork for the current page (fresh, per title) ---------- */

  const pageInfo = new Map();      // path -> Promise<{ title, poster } | null>
  const posterByTitle = new Map(); // norm(title) -> poster, learned this session

  function infoForPath(path) {
    if (!isDetailPath(path)) return Promise.resolve(null);
    if (!pageInfo.has(path)) {
      pageInfo.set(path, (async () => {
        try {
          const r = await fetch(location.origin + path, { credentials: 'include' });
          if (!r.ok) return null;
          const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
          const m = (n) => doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content')?.trim() || '';
          const info = { title: cleanTitle(m('og:title') || doc.title), poster: m('og:image') };
          if (info.title && info.poster) posterByTitle.set(norm(info.title.replace(/\s*-\s*Season\s*\d+.*$/i, '')), info.poster);
          return info;
        } catch { return null; }
      })());
    }
    return pageInfo.get(path);
  }

  /* ---------- what's playing ---------- */

  function playerTitle() {
    for (const sel of ['.atvwebplayersdk-title-text', '[class*="atvwebplayersdk-title"]']) {
      const t = clean(document.querySelector(sel)?.textContent);
      if (t) return t;
    }
    return '';
  }

  // "Season 3, Ep. 2 Payback" · "Season 1 Episode 3: Pilot" · "S3:E2 Payback" · "Ep. 4 Title"
  function parseEpisode(s) {
    s = clean(s);
    let m = s.match(/Season\s*(\d+)\s*[,:·.\-]?\s*Ep(?:isode|\.)?\s*(\d+)\s*[:.·\-–]?\s*(.*)$/i)
      || s.match(/\bS(\d+)\s*[:.,]?\s*E(\d+)\b\s*[:.·\-–]?\s*(.*)$/i);
    if (m) return { season: +m[1], episode: +m[2], episodeTitle: clean(m[3]).slice(0, 80) };
    m = s.match(/\bEp(?:isode|\.)\s*(\d+)\s*[:.·\-–]?\s*(.*)$/i);
    if (m) return { season: null, episode: +m[1], episodeTitle: clean(m[2]).slice(0, 80) };
    return null;
  }

  function findEpisode() {
    const texts = [];
    for (const sel of ['.atvwebplayersdk-subtitle-text', '[class*="atvwebplayersdk-subtitle"]', '[class*="subtitle-text"]']) {
      document.querySelectorAll(sel).forEach((el) => texts.push(el.textContent));
    }
    // Any short text in the player overlay (the layout changes from time to time).
    for (const el of document.querySelectorAll('[class*="atvwebplayersdk"]')) {
      if (el.childElementCount === 0) {
        const t = clean(el.textContent);
        if (t && t.length < 140) texts.push(t);
      }
    }
    texts.push(document.title);
    for (const t of texts) {
      const r = parseEpisode(t);
      if (r) return r;
    }
    return { season: null, episode: null, episodeTitle: '' };
  }

  async function snapshot(v) {
    const path = location.pathname;
    const info = await infoForPath(path);
    const live = playerTitle();
    const title = cleanTitle(live || info?.title || document.title) || 'Prime Video';
    const showTitle = title.replace(/\s*-\s*Season\s*\d+.*$/i, '');

    // Artwork must belong to the title that's playing — never reuse a stale one.
    let poster = '';
    if (info?.poster && (!live || sameTitle(info.title, live))) poster = info.poster;
    else poster = posterByTitle.get(norm(showTitle)) || '';

    return {
      service: 'prime',
      title: showTitle,
      ...findEpisode(),
      url: location.origin + path,
      poster,
      position: Math.round(v.currentTime),
      duration: Math.round(v.duration),
      updatedAt: Date.now(),
    };
  }

  /* ---------- saving ---------- */

  let saving = false;
  async function save(force = false) {
    if (!enabled || saving) return;
    const v = mainVideo();
    if (!v) return;
    const now = Date.now();
    const key = location.pathname + '|' + playerTitle();
    const changed = key !== lastKey;           // new title started → save right away
    if (!force && !changed && now - lastSave < SAVE_EVERY) return;
    saving = true;
    try {
      const snap = await snapshot(v);
      await store.set({ [KEY]: snap });
      lastSave = now;
      lastKey = key;
    } catch {
      // Extension was reloaded or updated; this page's script is now detached.
    } finally {
      saving = false;
    }
  }

  // Warm up artwork as soon as you land on a title's page.
  let lastPath = '';
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      infoForPath(lastPath);
    }
    const v = mainVideo();
    if (v && !v.paused) save();
  }, 2000);

  // media events don't bubble, so listen in the capture phase
  for (const ev of ['playing', 'pause', 'ended', 'seeked', 'loadedmetadata']) {
    document.addEventListener(ev, (e) => {
      if (e.target instanceof HTMLVideoElement) setTimeout(() => save(true), ev === 'loadedmetadata' ? 1500 : 0);
    }, true);
  }
  document.addEventListener('visibilitychange', () => save(true));
  window.addEventListener('pagehide', () => save(true));
})();
