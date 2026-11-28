// JioHotstar adapter. JioHotstar is a single-page app whose page title and preview
// tags say "JioHotstar - Watch TV Shows, Movies…" on every page (and re-downloading
// a page returns none at all), so names and artwork come from elsewhere:
//   1. While you browse, every episode / movie card is remembered by its content id:
//      its title (the artwork's alt text), "S20 E81" and its thumbnail.
//   2. On the watch page, the content id in the address is looked up there.
//   3. Fallbacks: the player's own "S1 E2" text, the show / episode names in the
//      address (/shows/<show>/<id>/<episode>/<id>/watch), and the page's preview
//      image when it belongs to this page.
(() => {
  const W = window.BetterTabWatch;
  if (!W || window.__betterTabHotstar) return;
  window.__betterTabHotstar = true;

  const CARDS_KEY = 'watch:hotstar-cards';
  const MAX_CARDS = 400;
  const GENERIC = /^(jio)?hotstar\b/i;
  let cards = {};
  const loaded = chrome.storage.local.get(CARDS_KEY).then((r) => { cards = r[CARDS_KEY] || {}; }).catch(() => {});

  // /in/shows/<show>/<showId>/<episode>/<episodeId>/watch
  // /in/shows/<show>/<showId>/watch?fallbackEpisodeId=<episodeId>
  // /in/movies/<movie>/<movieId>/watch
  function parse(href) {
    let u;
    try { u = new URL(href, location.origin); } catch { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex((x) => x === 'shows' || x === 'movies');
    if (i < 0) return null;
    const kind = parts[i];
    const rest = parts.slice(i + 1);
    const ids = rest.filter((x) => /^\d{5,}$/.test(x));
    const slugs = rest.filter((x) => !/^\d+$/.test(x) && x !== 'watch');
    const id = kind === 'shows' ? (ids[1] || u.searchParams.get('fallbackEpisodeId') || '') : (ids[0] || '');
    return { kind, show: slugs[0] || '', episode: kind === 'shows' ? slugs[1] || '' : '', showId: ids[0] || '', id, watch: rest.includes('watch') };
  }
  const unslug = (s) => { try { s = decodeURIComponent(s); } catch { /* keep */ } return W.clean(s.replace(/-/g, ' ')).replace(/\b\w/g, (c) => c.toUpperCase()); };
  // Cards use small (124px tall) images; ask for a 640px-wide one instead.
  const bigger = (src) => src.replace(/\/image\/upload\/[^/]*\//, '/image/upload/f_auto,w_640/');
  const seText = (t) => { const m = String(t || '').match(/\bS(\d+)\s*[·.:]?\s*E(\d+)\b/); return m ? { season: +m[1], episode: +m[2] } : null; };

  /* ---------- 1. remember cards while browsing ---------- */
  let saveTimer = null;
  function learn() {
    let changed = false;
    const put = (key, rec) => {
      const old = cards[key];
      if (old && old.title === rec.title && old.img === rec.img && old.episode === rec.episode) return;
      cards[key] = { ...old, ...rec, at: Date.now() };
      changed = true;
    };
    for (const a of document.querySelectorAll('a[href*="/shows/"], a[href*="/movies/"]')) {
      const info = parse(a.getAttribute('href'));
      if (!info) continue;
      for (const img of a.querySelectorAll('img[alt]')) {
        const alt = W.clean(img.alt);
        const src = img.currentSrc || img.src;
        if (!alt || GENERIC.test(alt) || /^(live|new|free)$/i.test(alt) || !/^https:\/\/[^/]*hotstar/.test(src)) continue;
        // A show's own title artwork (alt = the show's name): remember the proper name.
        if (info.showId && W.norm(alt) === W.norm(info.show)) { put('show:' + info.showId, { title: alt.slice(0, 100), img: bigger(src) }); continue; }
        if (info.watch && info.id) put(info.id, { title: alt.slice(0, 100), img: bigger(src), ...(seText(a.innerText) || {}) });
      }
    }
    // On a show's page, its name is the alt of the big title artwork.
    const here = parse(location.href);
    if (here?.showId && !here.watch) {
      for (const img of document.querySelectorAll('img[alt]')) {
        if (W.norm(img.alt) === W.norm(here.show)) { put('show:' + here.showId, { title: W.clean(img.alt).slice(0, 100), img: bigger(img.currentSrc || img.src) }); break; }
      }
    }
    if (!changed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keys = Object.keys(cards);
      if (keys.length > MAX_CARDS) keys.sort((a, b) => (cards[a].at || 0) - (cards[b].at || 0)).slice(0, keys.length - MAX_CARDS).forEach((k) => delete cards[k]);
      chrome.storage.local.set({ [CARDS_KEY]: cards }).catch(() => {});
    }, 1000);
  }
  loaded.then(() => { learn(); setInterval(learn, 4000); });

  /* ---------- 3. what the player itself shows ---------- */
  // "S20 E81" text that isn't inside a card link (cards are links).
  function playerEpisode() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), i = 0; n && i < 4000; n = walker.nextNode(), i++) {
      if (n.parentElement?.closest('a')) continue;
      const se = seText(n.textContent);
      if (se) return se;
    }
    return null;
  }
  // The page's own preview image, only when the page was opened directly at this address.
  function pageImage() {
    const url = document.querySelector('meta[property="og:url"]')?.content || '';
    const img = document.querySelector('meta[property="og:image"]')?.content || '';
    try { if (img && new URL(url).pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) return img; } catch { /* no match */ }
    return '';
  }

  W.start({
    service: 'hotstar',
    settingKey: 'watchHotstar',
    video() {
      const p = parse(location.href);
      if (!p?.watch) return null;
      return W.longestPlaying(5 * 60);
    },
    key: () => location.pathname + location.search,
    async describe() {
      await loaded;
      learn(); // pick up cards on the watch page itself (episode lists)
      const p = parse(location.href);
      if (!p) return null;
      const card = cards[p.id] || {};
      const show = cards['show:' + p.showId] || {};
      const url = location.origin + location.pathname + location.search;
      if (p.kind === 'movies') {
        return { title: card.title || unslug(p.show) || 'JioHotstar', poster: card.img || pageImage() || show.img || '', url };
      }
      const fromAddress = p.episode ? W.parseEpisode(unslug(p.episode)) : null; // "episode-3-the-return"
      const se = card.episode ? { season: card.season, episode: card.episode } : (playerEpisode() || (fromAddress?.episode ? fromAddress : null));
      const title = show.title || unslug(p.show) || 'JioHotstar';
      const episodeTitle = card.title || (p.episode ? unslug(p.episode) : '');
      return {
        title,
        season: se?.season ?? null,
        episode: se?.episode ?? null,
        episodeTitle: W.norm(episodeTitle) === W.norm(title) ? '' : episodeTitle.slice(0, 80),
        // Without an episode number, show the episode's name under the title instead.
        sub: se ? '' : episodeTitle.slice(0, 60),
        poster: card.img || pageImage() || show.img || '',
        url,
      };
    },
  });
})();
