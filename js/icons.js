// Icon pipeline.
//
// Order of preference:
//   1. The App Store icon (iTunes Search API, free, no key), matched by app name
//      and the developer's website. These are real, opaque app icons.
//   2. The site's own app icon: PWA manifest icons (maskable first) and
//      apple-touch-icon. Only trusted when the page didn't redirect to another
//      host (e.g. mail.google.com → workspace.google.com would give Google's logo).
//   3. Brandfetch "icon" (the brand's square social-profile icon), if a client ID
//      is set. Brandfetch only allows hotlinking, so we probe it with a plain <img>
//      and store the URL, never the image bytes.
//   4. Large site logos (<link rel="icon"> 96px+).
//   5. The site's favicon (Google's favicon service, then Chrome's own cache).
//   6. A generated letter tile.
//
// Everything except Brandfetch is cached locally as a PNG.
//
// Anything with transparency, or too small to fill a tile, is placed on an
// opaque rounded-square background so every icon looks like an app icon.

const SIZE = 256;
const hasChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;

// Bump when the lookup order changes so older cached icons get re-checked.
export const ICON_PIPELINE = 4;

export const SOURCE_LABEL = {
  brandfetch: 'Brandfetch',
  maskable: 'Site app icon',
  touch: 'Site app icon',
  appstore: 'App Store icon',
  site: 'Site logo',
  favicon: 'Favicon',
  custom: 'Custom',
  letter: 'Letter tile',
};

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter a link');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links work here');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('That doesn’t look like a website');
  return u.href;
}

export function domainOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

export function prettyName(url) {
  const host = domainOf(url).split('.');
  const skip = new Set(['m', 'app', 'web', 'my', 'en', 'in', 'us', 'uk', 'www']);
  let label = host.length > 1 ? host[host.length - 2] : host[0];
  if (['co', 'com', 'org', 'net', 'gov', 'ac'].includes(label) && host.length > 2) label = host[host.length - 3];
  if (host.length > 2 && !skip.has(host[0]) && host[0] !== label && host[0].length > 2) {
    // e.g. mail.google.com -> "Mail"
    label = host[0];
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function brandfetchUrl(pageUrl, clientId) {
  const d = encodeURIComponent(domainOf(pageUrl));
  return `https://cdn.brandfetch.io/domain/${d}/w/256/h/256/fallback/404/type/icon?c=${encodeURIComponent(clientId)}`;
}

/* ---------- network helpers ---------- */

async function fetchT(url, opts = {}, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function decodeBlob(blob) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { img._objectUrl = u; resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('Could not decode image')); };
    img.src = u;
  });
}

async function loadImage(url) {
  const r = await fetchT(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const type = (r.headers.get('content-type') || '').toLowerCase();
  if (type.includes('text/html') || type.includes('json')) throw new Error('Not an image');
  const blob = await r.blob();
  if (blob.size < 60) throw new Error('Empty image');
  return decodeBlob(blob);
}

function imgSize(img) {
  // SVGs without width/height report 0 — they are vectors, so treat as large.
  return Math.min(img.naturalWidth || 512, img.naturalHeight || 512);
}

/** Probe an image by hotlinking it (used for Brandfetch, which forbids downloading). */
export function probeHotlink(url, min = 64, ms = 6000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'strict-origin-when-cross-origin';
    const done = (ok) => { clearTimeout(t); img.onload = img.onerror = null; resolve(ok); };
    const t = setTimeout(() => done(false), ms);
    img.onload = () => done(imgSize(img) >= min);
    img.onerror = () => done(false);
    img.src = url;
  });
}

/* ---------- page scan ---------- */

function parseSizes(s) {
  if (!s) return 0;
  if (/any/i.test(s)) return 512;
  let best = 0;
  for (const m of s.matchAll(/(\d+)\s*x\s*(\d+)/gi)) best = Math.max(best, Math.min(+m[1], +m[2]));
  return best;
}

/** Fetch the page once and collect its name + icon candidates. */
export async function scanPage(pageUrl) {
  const result = { name: '', candidates: [], trusted: true };
  let doc, base;
  try {
    const r = await fetchT(pageUrl, { headers: { Accept: 'text/html' } }, 8000);
    if (!r.ok) return result;
    base = r.url || pageUrl;
    // Landed on a different host (login page, marketing page…)? Its icons and
    // name belong to that page, not to the app the user asked for.
    const bare = (u) => new URL(u).hostname.replace(/^www\./, '');
    if (bare(base) !== bare(pageUrl)) { result.trusted = false; return result; }
    const html = await r.text();
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return result;
  }
  const abs = (h) => { try { return new URL(h, base).href; } catch { return null; } };
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content')?.trim() || '';

  result.name = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || meta('meta[name="apple-mobile-web-app-title"]');

  let manifestUrl = null;
  for (const l of doc.querySelectorAll('link[rel][href]')) {
    const rel = l.getAttribute('rel').toLowerCase();
    const href = abs(l.getAttribute('href'));
    if (!href) continue;
    const isSvg = /\.svg(\?|#|$)/i.test(href) || (l.getAttribute('type') || '').includes('svg');
    const size = parseSizes(l.getAttribute('sizes'));
    if (rel.includes('apple-touch-icon')) {
      result.candidates.push({ url: href, size: size || 180, kind: 'touch' });
    } else if (rel === 'manifest') {
      manifestUrl = href;
    } else if (/(^|\s)icon(\s|$)/.test(rel) && (size >= 96 || isSvg)) {
      result.candidates.push({ url: href, size: size || 512, kind: 'site' });
    }
  }

  if (manifestUrl) {
    try {
      const r = await fetchT(manifestUrl, {}, 5000);
      if (r.ok) {
        const m = await r.json();
        if (!result.name) result.name = (m.short_name || m.name || '').trim();
        for (const ic of m.icons || []) {
          if (!ic.src) continue;
          const size = parseSizes(ic.sizes);
          if (size && size < 96) continue;
          const purpose = String(ic.purpose || 'any');
          if (/monochrome/.test(purpose) && !/any|maskable/.test(purpose)) continue;
          result.candidates.push({ url: new URL(ic.src, manifestUrl).href, size: size || 192, kind: /maskable/.test(purpose) ? 'maskable' : 'site' });
        }
      }
    } catch { /* ignore broken manifests */ }
  }

  if (result.name.length > 28) result.name = '';
  return result;
}

/* ---------- App Store icons ---------- */

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

function regDomain(host) {
  const p = host.replace(/^www\./, '').split('.');
  const second = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
  if (p.length > 2 && second.has(p[p.length - 2]) && p[p.length - 1].length === 2) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

/**
 * Find the app's App Store icon by name. Only accepts a result whose title
 * matches the name, and needs the developer's website or name to match the
 * site unless the title is an exact or clear prefix match.
 */
export async function appStoreIconUrl(pageUrl, name) {
  const n = norm(name);
  if (n.length < 2) return null;
  const site = regDomain(new URL(pageUrl).hostname);
  const siteLabel = norm(site.split('.')[0]);
  const region = (navigator.language || 'en-US').split('-')[1];
  const countries = [...new Set([(region || 'us').toLowerCase(), 'us'])];
  for (const cc of countries) {
    let data;
    try {
      const r = await fetchT(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=15&country=${cc}`, {}, 6000);
      if (!r.ok) continue;
      data = await r.json();
    } catch { continue; }
    let best = null, bestScore = 0;
    for (const it of data.results || []) {
      const t = norm(it.trackName);
      let score = t === n ? 6 : t.startsWith(n) ? 4 : t.includes(n) ? 2 : 0;
      if (!score) continue;
      let seller = '';
      try { seller = regDomain(new URL(it.sellerUrl).hostname); } catch { /* no website listed */ }
      const sameMaker = seller === site || (siteLabel.length > 2 && norm(it.artistName).includes(siteLabel));
      if (sameMaker) score += 3;
      const ok = sameMaker ? score >= 5 : (score === 6 || (score === 4 && n.length >= 5));
      if (ok && score > bestScore) { best = it; bestScore = score; }
    }
    if (best) return best.artworkUrl512 || best.artworkUrl100 || null;
  }
  return null;
}

function rankCandidates(cands) {
  const order = { maskable: 0, touch: 1, site: 2 };
  const seen = new Set();
  return cands
    .filter((c) => c.url && !seen.has(c.url) && seen.add(c.url))
    .sort((a, b) => (order[a.kind] - order[b.kind]) || (b.size - a.size));
}

/* ---------- rendering ---------- */

function analyse(img) {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data;
  let transparent = 0, r = 0, gr = 0, b = 0, cnt = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 235) transparent++;
    if (a > 128) {
      r += d[i]; gr += d[i + 1]; b += d[i + 2]; cnt++;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      sat += mx ? (mx - mn) / mx : 0;
    }
  }
  const corner = (x, y) => d[(y * n + x) * 4 + 3];
  const cornersClear = [corner(1, 1), corner(n - 2, 1), corner(1, n - 2), corner(n - 2, n - 2)].filter((a) => a < 200).length;
  cnt = cnt || 1;
  const avg = [r / cnt, gr / cnt, b / cnt];
  const lum = (0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2]) / 255;
  return { transparentRatio: transparent / (n * n), cornersClear, avg, lum, sat: sat / cnt };
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * Turn any image into an opaque square app icon (returned as a PNG data URL).
 * `kind` hints how much padding a transparent logo needs.
 */
export function renderTile(img, kind = 'site') {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const info = analyse(img);
  const size = imgSize(img);
  const opaque = info.transparentRatio < 0.02 && info.cornersClear === 0;

  if (opaque && size >= 96 && kind !== 'favicon') {
    // Already a proper app icon: fill the square (cover-crop if not square).
    const w = img.naturalWidth || SIZE, h = img.naturalHeight || SIZE;
    const s = Math.max(SIZE / w, SIZE / h);
    g.drawImage(img, (SIZE - w * s) / 2, (SIZE - h * s) / 2, w * s, h * s);
  } else {
    // Transparent or tiny: put the logo on a solid tile.
    const [r, gg, b] = info.avg;
    let top, bottom;
    if (info.lum > 0.72) {
      top = '#2b2f36'; bottom = '#16181c';             // light logo → dark tile
    } else if (info.sat > 0.35) {
      const tint = (v, k) => Math.round(v + (255 - v) * k);
      top = `rgb(${tint(r, 0.93)},${tint(gg, 0.93)},${tint(b, 0.93)})`;
      bottom = `rgb(${tint(r, 0.86)},${tint(gg, 0.86)},${tint(b, 0.86)})`; // colourful logo → soft tinted white
    } else {
      top = '#ffffff'; bottom = '#eceef1';             // dark/mono logo → white tile
    }
    const grad = g.createLinearGradient(0, 0, 0, SIZE);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, SIZE, SIZE);

    const share = kind === 'favicon' || size < 64 ? 0.5 : 0.62;
    const w = img.naturalWidth || SIZE, h = img.naturalHeight || SIZE;
    const s = Math.min((SIZE * share) / w, (SIZE * share) / h);
    // Tiny favicons: scale by whole numbers where possible so they stay crisp.
    const scale = size <= 32 ? Math.max(1, Math.floor(s)) : s;
    if (size <= 32) g.imageSmoothingEnabled = scale !== Math.floor(scale);
    g.drawImage(img, (SIZE - w * scale) / 2, (SIZE - h * scale) / 2, w * scale, h * scale);
  }
  if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);
  return c.toDataURL('image/png');
}

const LETTER_COLORS = [
  ['#5b8def', '#3a63c7'], ['#ef6b5b', '#c7463a'], ['#3fbf8f', '#2a9670'], ['#b46bef', '#8a46c7'],
  ['#efb15b', '#c78a3a'], ['#4fb3c8', '#2f8ea2'], ['#ef5b9c', '#c73a78'], ['#6b7bef', '#4653c7'],
];

export function letterTile(name) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const label = (name || '?').trim();
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = LETTER_COLORS[h % LETTER_COLORS.length];
  const grad = g.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = '#fff';
  g.font = '600 128px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label.charAt(0).toUpperCase(), SIZE / 2, SIZE / 2 + 6);
  return c.toDataURL('image/png');
}

/* ---------- public API ---------- */

/**
 * Work out the best icon for a site.
 * Returns { kind: 'remote', url, source } for Brandfetch (hotlinked)
 *      or { kind: 'data', dataUrl, source } for anything cached locally.
 */
export async function resolveIcon(pageUrl, { brandfetchId = '', skipBrandfetch = false, page = null, name = '' } = {}) {
  // Brandfetch is checked after the App Store and the site's own app icon.
  const brandfetch = brandfetchId && !skipBrandfetch
    ? async () => {
      const url = brandfetchUrl(pageUrl, brandfetchId);
      return (await probeHotlink(url, 64)) ? { kind: 'remote', url, source: 'brandfetch' } : null;
    }
    : null;
  return resolveLocalIcon(pageUrl, { page, name, afterOwnIcon: brandfetch });
}

export async function resolveLocalIcon(pageUrl, { page = null, name = '', afterOwnIcon = null } = {}) {
  page = page || (await scanPage(pageUrl));
  const domain = domainOf(pageUrl);
  const ranked = page.trusted === false ? [] : rankCandidates(page.candidates || []);

  const tryLoad = async (url, kind, min) => {
    try {
      const img = await loadImage(url);
      if (imgSize(img) < min) { if (img._objectUrl) URL.revokeObjectURL(img._objectUrl); return null; }
      return { kind: 'data', dataUrl: renderTile(img, kind), source: kind };
    } catch { return null; }
  };

  // 1. App Store icon.
  try {
    const art = await appStoreIconUrl(pageUrl, name || page.name || prettyName(pageUrl));
    if (art) {
      const res = await tryLoad(art, 'appstore', 96);
      if (res) return res;
    }
  } catch { /* App Store lookup is best-effort */ }

  // 2. The site's own app icon (maskable PWA icon / apple-touch-icon).
  const appIcons = ranked.filter((c) => c.kind === 'maskable' || c.kind === 'touch');
  if (page.trusted !== false && !appIcons.some((c) => c.kind === 'touch')) {
    appIcons.push({ url: new URL(pageUrl).origin + '/apple-touch-icon.png', kind: 'touch' });
  }
  for (const c of appIcons) {
    const res = await tryLoad(c.url, c.kind, 96);
    if (res) return res;
  }

  // 3. Brandfetch (when a client ID is set).
  if (afterOwnIcon) {
    const res = await afterOwnIcon();
    if (res) return res;
  }

  // 4. Large site logos.
  for (const c of ranked.filter((x) => x.kind === 'site')) {
    const res = await tryLoad(c.url, 'site', 96);
    if (res) return res;
  }

  // 5. Favicon.
  const fav = await tryLoad(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, 'favicon', 16);
  if (fav) return fav;
  if (hasChrome) {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', '64');
    const res = await tryLoad(u.href, 'favicon', 1);
    if (res) return res;
  }
  return { kind: 'data', dataUrl: letterTile(name || prettyName(pageUrl)), source: 'letter' };
}

/** Custom icon from a pasted image link. */
export async function iconFromImageUrl(url) {
  const img = await loadImage(normalizeUrl(url));
  return { kind: 'data', dataUrl: renderTile(img, 'custom'), source: 'custom' };
}

/** Custom icon from an uploaded file. */
export async function iconFromFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Pick an image file');
  const img = await decodeBlob(file);
  return { kind: 'data', dataUrl: renderTile(img, 'custom'), source: 'custom' };
}
