// JioHotstar adapter (best effort). Uses the player's video for progress and a
// fresh copy of the current page's preview tags for the title and artwork.
(() => {
  const W = window.HorizonWatch;
  if (!W || window.__horizonHotstar) return;
  window.__horizonHotstar = true;

  const isWatchPage = () => /\/(watch|play)(\/|$)|\/(shows|movies|sports)\//i.test(location.pathname);
  const cleanTitle = (t) => W.clean(t)
    .replace(/^Watch\s+/i, '')
    .replace(/\s*[-|]\s*(Jio)?Hotstar.*$/i, '')
    .replace(/\s+(Online|Full Episode|Full Movie|in HD).*$/i, '');

  W.start({
    service: 'hotstar',
    settingKey: 'watchHotstar',
    video() {
      if (!isWatchPage()) return null;
      return W.longestPlaying(5 * 60);
    },
    key: () => location.pathname,
    async describe() {
      const meta = await W.freshMeta(location.pathname);
      const raw = W.clean(meta?.title || document.title).replace(/\s*[-|]\s*(Jio)?Hotstar.*$/i, '');
      const ep = W.parseEpisode(raw);
      let title = cleanTitle(raw);
      if (ep) title = W.clean(title.replace(/\s*[-|:,]?\s*(Season\s*\d+.*|S\d+\s*[:.]?\s*E\d+.*)$/i, '')) || title;
      return {
        title: title || 'JioHotstar',
        ...(ep || {}),
        poster: meta?.image || '',
        url: location.origin + location.pathname,
      };
    },
  });
})();
