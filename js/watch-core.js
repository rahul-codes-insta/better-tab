// Shared "Keep watching" tracker for streaming sites. Each site adds a small
// adapter (watch-youtube.js, watch-netflix.js, watch-hotstar.js) that says how
// to find the video, its title and its artwork. Data stays in chrome.storage.local
// under "watch:<service>".
(() => {
  if (window.BetterTabWatch) return;

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

  // "Season 3, Ep. 2 Title" · "Season 1 Episode 3: Title" · "S3:E2 Title" · "E4 Title"
  function parseEpisode(s) {
    s = clean(s);
    let m = s.match(/Season\s*(\d+)\s*[,:·.\-]?\s*Ep(?:isode|\.)?\s*(\d+)\s*[:.·\-–]?\s*(.*)$/i)
      || s.match(/\bS(\d+)\s*[:.,]?\s*E(\d+)\b\s*[:.·\-–]?\s*(.*)$/i);
    if (m) return { season: +m[1], episode: +m[2], episodeTitle: clean(m[3]).slice(0, 80) };
    m = s.match(/(?:^|\s)(?:Ep(?:isode|\.)?|E)\s*(\d+)\b\s*[:.·\-–]?\s*(.*)$/i);
    if (m) return { season: null, episode: +m[1], episodeTitle: clean(m[2]).slice(0, 80) };
    return null;
  }

  /** Fresh title + artwork for a path (single-page sites keep stale <meta> tags). */
  const metaCache = new Map();
  function freshMeta(path) {
    if (!metaCache.has(path)) {
      metaCache.set(path, (async () => {
        try {
          const r = await fetch(location.origin + path, { credentials: 'include' });
          if (!r.ok) return null;
          const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
          const m = (n) => doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content')?.trim() || '';
          return { title: m('og:title') || doc.title, image: m('og:image') };
        } catch { return null; }
      })());
    }
    return metaCache.get(path);
  }

  function longestPlaying(minLength) {
    let best = null;
    for (const v of document.querySelectorAll('video')) {
      const d = v.duration;
      if (!Number.isFinite(d) || d < minLength || v.currentTime < 1) continue;
      if (!best || d > best.duration) best = v;
    }
    return best;
  }

  /**
   * adapter: {
   *   service, settingKey, minLength,
   *   video(): HTMLVideoElement | null    — the programme (not an ad), or null
   *   key(): string                       — identifies what's playing (changes → save at once)
   *   describe(video): Promise<{ title, sub?, season?, episode?, episodeTitle?, poster, url }>
   * }
   */
  function start(adapter) {
    const KEY = 'watch:' + adapter.service;
    const store = chrome.storage.local;
    let enabled = true, lastSave = 0, lastKey = '', saving = false;
    const readEnabled = (st) => st?.settings?.[adapter.settingKey] !== false;
    store.get('state').then(({ state }) => { enabled = readEnabled(state); }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.state) enabled = readEnabled(ch.state.newValue); });

    async function save(force = false) {
      if (!enabled || saving) return;
      const v = adapter.video();
      if (!v) return;
      const key = adapter.key();
      const now = Date.now();
      if (!force && key === lastKey && now - lastSave < 15000) return;
      saving = true;
      try {
        const info = await adapter.describe(v);
        if (!info || !info.url) return;
        await store.set({
          [KEY]: {
            service: adapter.service,
            season: null, episode: null, episodeTitle: '', sub: '',
            ...info,
            position: Math.round(v.currentTime),
            duration: Math.round(v.duration),
            updatedAt: Date.now(),
          },
        });
        lastSave = now; lastKey = key;
      } catch {
        // extension reloaded — this page's script is detached
      } finally {
        saving = false;
      }
    }

    setInterval(() => { const v = adapter.video(); if (v && !v.paused) save(); }, 2000);
    for (const ev of ['playing', 'pause', 'ended', 'seeked']) {
      document.addEventListener(ev, (e) => { if (e.target instanceof HTMLVideoElement) setTimeout(() => save(true), 300); }, true);
    }
    document.addEventListener('visibilitychange', () => save(true));
    window.addEventListener('pagehide', () => save(true));
  }

  window.BetterTabWatch = { start, parseEpisode, freshMeta, longestPlaying, clean, norm };
})();
