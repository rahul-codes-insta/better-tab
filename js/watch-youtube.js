// YouTube adapter: exact resume time and the video's own thumbnail.
(() => {
  const W = window.HorizonWatch;
  if (!W || window.__horizonYouTube) return;
  window.__horizonYouTube = true;

  const videoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

  W.start({
    service: 'youtube',
    settingKey: 'watchYoutube',
    video() {
      if (!videoId()) return null;
      const player = document.querySelector('#movie_player, .html5-video-player');
      if (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) return null; // an ad is playing
      const v = player?.querySelector('video') || W.longestPlaying(0);
      if (!v || !Number.isFinite(v.duration) || v.duration < 4 * 60 || v.currentTime < 1) return null; // skip short videos
      return v;
    },
    key: () => videoId() || '',
    async describe(v) {
      const id = videoId();
      if (!id) return null;
      // Only trust the page title once it belongs to this video (it can lag behind on navigation).
      const h1 = W.clean(document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1')?.textContent);
      const docTitle = W.clean(document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, ''));
      const title = h1 || docTitle || 'YouTube video';
      const channel = W.clean(document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a, #channel-name a')?.textContent);
      return {
        title,
        sub: channel,
        poster: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,   // always matches the video
        url: `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(v.currentTime) - 3)}s`,
      };
    },
  });
})();
