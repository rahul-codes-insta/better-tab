// Netflix adapter. The player only shows the title while its controls are visible,
// so the last title seen for each /watch/<id> is remembered. Artwork comes from the
// box-art images on Netflix's browse pages, matched by title.
(() => {
  const W = window.BetterTabWatch;
  if (!W || window.__betterTabNetflix) return;
  window.__betterTabNetflix = true;

  const ART_KEY = 'watch:netflix-art';
  const watchId = () => (location.pathname.match(/^\/watch\/(\d+)/) || [])[1] || null;
  const seen = new Map(); // watch id -> { title, ep }

  // Learn title → box art while browsing.
  let art = {};
  chrome.storage.local.get(ART_KEY).then((r) => { art = r[ART_KEY] || {}; }).catch(() => {});
  function learnArt() {
    if (watchId()) return;
    let changed = false;
    for (const img of document.querySelectorAll('img.boxart-image, .title-card img, img[class*="boxart"]')) {
      const t = W.norm(img.alt || img.closest('[aria-label]')?.getAttribute('aria-label'));
      const src = img.currentSrc || img.src;
      if (t && src && /^https:/.test(src) && art[t] !== src) { art[t] = src; changed = true; }
    }
    if (changed) {
      const keys = Object.keys(art);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete art[k];
      chrome.storage.local.set({ [ART_KEY]: art }).catch(() => {});
    }
  }
  setInterval(learnArt, 4000);

  // Remember the title whenever the player overlay shows it.
  function readOverlay() {
    const id = watchId();
    if (!id) return;
    const box = document.querySelector('[data-uia="video-title"]');
    if (!box) return;
    const show = W.clean(box.querySelector('h4')?.textContent) || W.clean(box.childNodes[0]?.textContent);
    const rest = [...box.querySelectorAll('span')].map((s) => W.clean(s.textContent)).filter(Boolean).join(' ');
    if (show) seen.set(id, { title: show, ep: rest });
  }
  setInterval(readOverlay, 1000);

  W.start({
    service: 'netflix',
    settingKey: 'watchNetflix',
    video() {
      if (!watchId()) return null;
      return W.longestPlaying(5 * 60);
    },
    key: () => watchId() || '',
    async describe() {
      const id = watchId();
      if (!id) return null;
      readOverlay();
      const s = seen.get(id);
      const title = s?.title || W.clean(document.title.replace(/\s*[-|]\s*Netflix$/i, '')) || 'Netflix';
      const ep = s?.ep ? W.parseEpisode(s.ep.replace(/^E(\d+)/, 'E$1 ')) : null;
      return {
        title: title === 'Netflix' && !s ? 'Netflix' : title,
        ...(ep || {}),
        poster: art[W.norm(title)] || '',
        url: `https://www.netflix.com/watch/${id}`,   // Netflix resumes where you left off
      };
    },
  });
})();
