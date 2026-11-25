import * as store from './store.js';
import {
  normalizeUrl, prettyName, scanPage, resolveIcon, resolveLocalIcon,
  iconFromImageUrl, iconFromFile, letterTile, SOURCE_LABEL, ICON_PIPELINE,
} from './icons.js';
import { fetchCurrent, searchCities, currentPosition, iconSvg, describe } from './weather.js';
import { buildSettings } from './settings-ui.js';
import { uiConfirm, uiAlert } from './ui-dialog.js';
import { createWidgetLayer, WIDGET_TYPES } from './widgets.js';
import { createSearch, ENGINES } from './search.js';
import { flip, exit, measure, play } from './motion.js';
import {
  listWallpapers, getWallpaper, putWallpaper, deleteWallpaper, engineInstalled, downloadEngine, removeEngine, MODEL_SIZE_MB,
} from './wallstore.js';

const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const ICON_TTL = 1000 * 60 * 60 * 24 * 30; // re-check cached icons monthly

const DEFAULT_SETTINGS = {
  brandfetchId: '',
  clock24: false,
  night: false,
  barStyle: 'bar',     // 'bar' | 'drawer'
  barCount: 8,         // icons visible in the app bar
  barScale: 100,       // % size of the app bar and its icons
  showAdvanced: false,
  widgetsShown: true,      // top-right button shows / hides widgets
  searchOn: true,          // search bar above the bar / Keep watching
  searchEngine: 'google',  // last service used in the search bar
  continueWatching: true, // Keep watching: Prime Video
  watchYoutube: true,      // Keep watching: YouTube
  watchNetflix: true,      // Keep watching: Netflix
  watchHotstar: true,      // Keep watching: JioHotstar
  modesOn: true,           // false = one mode: no Chill/Work switcher
  splitModes: false,       // "Separate setups": Chill and Work keep their own settings
  weatherOn: true,
  weatherUnit: 'celsius',  // 'celsius' | 'fahrenheit'
  weatherLoc: null,        // null = use my location, else { name, lat, lon }
  clockScale: 100,     // % of the default clock size
  clockWeight: 400,    // 200–700 (variable font)
  dateScale: 100,      // % of the default date size
  dateWeight: 500,     // 300–800
};

// Services that can show a "Keep watching" card. To add one: a content-script
// adapter (js/watch-<id>.js) plus an entry here.
const WATCH_SERVICES = [
  { id: 'prime', name: 'Prime Video', setting: 'continueWatching', color: '#1399ff', match: /primevideo\.com|amazon\.[a-z.]+\/(gp\/video|prime)/i },
  { id: 'youtube', name: 'YouTube', setting: 'watchYoutube', color: '#ff0033', match: /(^|\.)youtube\.com/i },
  { id: 'netflix', name: 'Netflix', setting: 'watchNetflix', color: '#e50914', match: /netflix\.com/i },
  { id: 'hotstar', name: 'JioHotstar', setting: 'watchHotstar', color: '#1f6fe5', match: /hotstar\.com/i },
];
const watchKey = (id) => 'watch:' + id;

const TYPE_KEYS = ['clockScale', 'clockWeight', 'dateScale', 'dateWeight', 'barScale'];

// Settings that always stay the same in both modes, even with separate setups.
const SHARED_KEYS = ['searchEngine', 'searchApps', 'searchNewTab', 'searchRemember', 'searchAnywhere', 'searchHints', 'modesOn', 'splitModes', 'showAdvanced', 'openSections', 'brandfetchId', 'weatherLoc', 'builtinClockTop'];

/**
 * Bring stored state up to date and line it up with the active mode:
 *  - wallpapers live on each mode (profile.wallpaper)
 *  - with separate setups, state.settings is the active mode's settings and
 *    the other mode's are kept in state.modeSettings.
 */
function normalize(st) {
  st = migrate(st);
  st.settings = { ...DEFAULT_SETTINGS, ...st.settings };
  // Older versions had one wallpaper for everything.
  const legacyWall = st.settings.wallpaper;
  for (const p of st.profiles) if (!p.wallpaper) p.wallpaper = legacyWall || 'builtin';
  delete st.settings.wallpaper;
  st.modeSettings = st.modeSettings || {};
  if (st.settings.splitModes && st.settingsMode && st.settingsMode !== st.activeProfile) {
    swapSettings(st, st.settingsMode, st.activeProfile);
  }
  if (st.settings.splitModes) st.settingsMode = st.activeProfile;
  return st;
}

/** Park the current mode's settings and load the next mode's (keeping shared ones). */
function swapSettings(st, from, to) {
  st.modeSettings[from] = { ...st.settings };
  const next = st.modeSettings[to] ? { ...DEFAULT_SETTINGS, ...st.modeSettings[to] } : { ...st.settings };
  for (const k of SHARED_KEYS) next[k] = st.settings[k];
  st.settings = next;
  st.settingsMode = to;
}

/** Turning "Separate setups" on gives both modes a copy of the current settings. */
function setSplitModes(on) {
  state.settings.splitModes = on;
  if (on) {
    for (const p of state.profiles) state.modeSettings[p.id] = { ...state.settings };
    state.settingsMode = state.activeProfile;
  }
  save();
}

/** Re-apply everything that depends on settings (after a mode swap or sync). */
function applyAllSettings() {
  lastMinute = '';
  applyWidgetsShown();
  applyTypeStyle();
  applyNight();
  refreshWeather();
  syncAdvanced();
}

function applyTypeStyle() {
  const st = state.settings, root = document.documentElement.style;
  root.setProperty('--clock-scale', st.clockScale / 100);
  root.setProperty('--clock-weight', st.clockWeight);
  root.setProperty('--date-scale', st.dateScale / 100);
  root.setProperty('--date-weight', st.dateWeight);
  root.setProperty('--bar-scale', st.barScale / 100);
  if (typeof updateArrows === 'function') requestAnimationFrame(updateArrows);
}

/* ============================ state ============================ */

// Two fixed modes. Each keeps its own list of apps.
const MODES = [
  {
    id: 'chill', name: 'Chill',
    icon: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5"/></svg>',
    defaults: [
      ['YouTube', 'https://www.youtube.com/'],
      ['Netflix', 'https://www.netflix.com/'],
      ['Prime Video', 'https://www.primevideo.com/'],
      ['Spotify', 'https://open.spotify.com/'],
    ],
  },
  {
    id: 'work', name: 'Work',
    icon: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/></g></svg>',
    defaults: [
      ['Gmail', 'https://mail.google.com/'],
      ['Calendar', 'https://calendar.google.com/'],
      ['GitHub', 'https://github.com/'],
      ['Notion', 'https://www.notion.so/'],
    ],
  },
];
const modeMeta = (id) => MODES.find((m) => m.id === id);
const MAX_MODES = 5;
const EXTRA_MODE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>';

function freshState() {
  return {
    v: 2,
    settings: { ...DEFAULT_SETTINGS },
    activeProfile: 'chill',
    profiles: MODES.map((m) => ({
      id: m.id, name: m.name,
      apps: m.defaults.map(([name, url]) => ({ id: uid(), name, url, icon: null })),
    })),
  };
}

// Older versions had "Person 1 / Person 2" profiles: turn them into Chill / Work,
// keeping every app (anything from extra profiles goes into Work).
function migrate(st) {
  if (st.v >= 2 && MODES.every((m) => st.profiles.some((p) => p.id === m.id))) return st;
  const old = st.profiles || [];
  const chillApps = old[0]?.apps || [];
  const workApps = old.slice(1).flatMap((p) => p.apps || []);
  const activeIdx = Math.max(0, old.findIndex((p) => p.id === st.activeProfile));
  return {
    ...st,
    v: 2,
    activeProfile: activeIdx === 0 ? 'chill' : 'work',
    profiles: [
      { id: 'chill', name: 'Chill', apps: chillApps },
      { id: 'work', name: 'Work', apps: workApps },
    ],
  };
}

let state;
const iconCache = new Map(); // appId -> data URL
const inflight = new Set();

const profile = () => state.profiles.find((p) => p.id === state.activeProfile) || state.profiles[0];
const findApp = (id) => profile().apps.find((a) => a.id === id);

let saveTimer = null;
let selfWrite = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    selfWrite = true;
    await store.set({ state });
    setTimeout(() => (selfWrite = false), 50);
  }, 60);
}

async function loadIcons(apps) {
  const keys = apps.filter((a) => a.icon?.kind === 'data' && !iconCache.has(a.id)).map((a) => 'icon:' + a.id);
  if (!keys.length) return;
  const got = await store.get(keys);
  for (const [k, v] of Object.entries(got)) iconCache.set(k.slice(5), v);
}

/* ============================ clock ============================ */

const dateEl = $('#dateText');
const clockEl = $('#clock');
let lastMinute = '';
function tick() {
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  if (!state.settings.clock24) h = h % 12 || 12;
  const hh = state.settings.clock24 ? String(h).padStart(2, '0') : String(h);
  const key = hh + ':' + m;
  if (key !== lastMinute) {
    lastMinute = key;
    clockEl.textContent = `${hh}:${m}`;
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    document.title = 'New Tab';
  }
  setTimeout(tick, 1000 - now.getMilliseconds() + 5);
}

/* ============================ top bar ============================ */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dockStack = $('#dockStack');

function moveThumb(animate = true) {
  const nav = $('#profiles');
  const thumb = nav.querySelector('.pill-thumb');
  const active = nav.querySelector('button[aria-pressed="true"]');
  if (!thumb || !active) return;
  nav.classList.toggle('no-anim', !animate);
  thumb.style.width = active.offsetWidth + 'px';
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!animate) requestAnimationFrame(() => nav.classList.remove('no-anim'));
}

const modesOn = () => state.settings.modesOn !== false;

function renderProfiles() {
  const nav = $('#profiles');
  nav.hidden = !modesOn();
  nav.innerHTML = '<span class="pill-thumb" aria-hidden="true"></span>';
  for (const p of state.profiles) {
    const b = document.createElement('button');
    b.innerHTML = (modeMeta(p.id)?.icon || EXTRA_MODE_ICON) + '<span></span>';
    b.querySelector('span').textContent = p.name;
    b.title = `${p.name} mode`;
    b.dataset.mode = p.id;
    b.setAttribute('aria-pressed', String(p.id === state.activeProfile));
    b.addEventListener('click', () => switchMode(p.id));
    nav.append(b);
  }
  moveThumb(false);
  document.fonts?.ready.then(() => moveThumb(false)); // widths settle once Inter loads
}

let switching = false;
let booted = false;   // no entrance animations on first paint

/** Animate the bar from its old width to its new natural width (FLIP). */
function glideDockWidth(fromW) {
  dock.style.width = '';
  const toW = dock.getBoundingClientRect().width;
  if (Math.abs(toW - fromW) < 1) return;
  dock.style.width = fromW + 'px';
  dock.getBoundingClientRect();     // commit the starting width
  dock.classList.add('gliding');
  dock.style.width = toW + 'px';
  clearTimeout(glideDockWidth.t);
  glideDockWidth.t = setTimeout(() => {
    dock.classList.remove('gliding');
    dock.style.width = '';
    updateArrows();
  }, 520);
}
async function switchMode(id) {
  if (id === state.activeProfile || switching) return;
  switching = true;
  setDrawer(false);
  const prev = state.activeProfile;
  state.activeProfile = id;
  if (state.settings.splitModes) swapSettings(state, prev, id);
  document.body.dataset.mode = id;
  for (const b of $('#profiles').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === id));
  moveThumb(true);
  save();
  applyWallpaper();                 // each mode has its own wallpaper (cross-fades)
  // Fade the apps out, swap them, fade back in, while the bar glides to its new width.
  const fromW = dock.getBoundingClientRect().width;
  dockStack.classList.add('mode-out');
  widgetLayer.classList.add('mode-out');
  await wait(200);
  if (state.settings.splitModes) applyAllSettings();
  widgets.reset();
  requestAnimationFrame(() => widgetLayer.classList.remove('mode-out'));
  await renderDock();
  await renderContinue();
  track.scrollLeft = 0;
  glideDockWidth(fromW);
  if (sdlg.open) settingsUI.refresh();
  syncAdvanced();
  requestAnimationFrame(() => dockStack.classList.remove('mode-out'));
  switching = false;
}

function applyWidgetsShown() {
  const on = state.settings.widgetsShown !== false;
  $('#widgetLayer').classList.toggle('hidden-widgets', !on);
  const b = $('#widgetsBtn');
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Hide widgets' : 'Show widgets';
  b.setAttribute('aria-label', b.title);
}
$('#widgetsBtn').addEventListener('click', () => {
  state.settings.widgetsShown = state.settings.widgetsShown === false;
  applyWidgetsShown();
  save();
});

function applyNight() {
  document.body.classList.toggle('night', !!state.settings.night);
  $('#nightBtn').setAttribute('aria-pressed', String(!!state.settings.night));
}
$('#nightBtn').addEventListener('click', () => {
  state.settings.night = !state.settings.night;
  applyNight();
  save();
});

/* ============================ dock ============================ */

const track = $('#track');
const dock = $('#dock');
const tip = $('#tip');

function iconSrc(app) {
  if (!app.icon) return iconCache.get(app.id) || letterTile(app.name);
  if (app.icon.kind === 'remote') return app.icon.url;
  return iconCache.get(app.id) || letterTile(app.name);
}

function tileFor(app) {
  const a = document.createElement('a');
  a.className = 'tile';
  a.href = app.url;
  a.dataset.id = app.id;
  a.setAttribute('role', 'listitem');
  a.setAttribute('aria-label', app.name);
  a.draggable = true;
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  if (app.icon?.kind === 'remote') img.referrerPolicy = 'strict-origin-when-cross-origin';
  img.src = iconSrc(app);
  img.addEventListener('error', () => {
    // Brandfetch hotlink failed (blocked / removed) → fall back to the site's own icon.
    if (app.icon?.kind === 'remote') {
      app.icon = null;
      app.bfMissAt = Date.now();
      img.src = letterTile(app.name);
      queueIcon(app, { skipBrandfetch: true });
    }
  }, { once: false });
  a.append(img);
  if (!app.icon || inflight.has(app.id)) a.classList.add('loading');
  return a;
}

const drawerEl = $('#drawer');
const drawerGrid = $('#drawerGrid');

function drawerButton() {
  const b = document.createElement('button');
  b.className = 'tile util drawer-btn';
  b.id = 'drawerBtn';
  b.setAttribute('aria-label', 'All apps');
  b.setAttribute('aria-expanded', String(dock.classList.contains('open')));
  b.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6"/></svg>';
  b.addEventListener('click', () => setDrawer(!dock.classList.contains('open')));
  return b;
}

function setDrawer(open, { focus = false } = {}) {
  if (open && state.settings.barStyle !== 'drawer') open = false;
  dock.classList.toggle('open', open);
  drawerEl.inert = !open;
  $('#drawerBtn')?.setAttribute('aria-expanded', String(open));
  hideTip();
  if (open && focus) setTimeout(() => drawerGrid.querySelector('.tile')?.focus(), 60);
}

function renderDrawer(apps) {
  drawerGrid.innerHTML = '';
  $('#drawerTitle').textContent = `${profile().name} apps`;
  $('#drawerCount').textContent = `${apps.length} app${apps.length === 1 ? '' : 's'}`;
  for (const app of apps) {
    const item = document.createElement('div');
    item.className = 'drawer-item';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = app.name;
    item.append(tileFor(app), name);
    drawerGrid.append(item);
  }
}

function needsIcon(app) {
  if (!app.icon) return true;
  const src = app.icon.source;
  if (src === 'custom') return false;
  const stale = app.icon.kind === 'data' && Date.now() - (app.icon.at || 0) > ICON_TTL;
  const oldPipeline = (app.icon.pv || 1) < ICON_PIPELINE;
  // Try Brandfetch once for icons found before a client ID was set.
  // (App Store and site app icons still win, so those don't need it).
  const upgrade = state.settings.brandfetchId && !['brandfetch', 'appstore', 'touch', 'maskable'].includes(src) && !app.bfTriedAt;
  return stale || oldPipeline || upgrade;
}

// Ids of apps kept in a folder widget in this mode: they're shown there, not on the bar.
const folderIds = () => new Set((profile().widgets || []).filter((w) => w.type === 'folder').flatMap((w) => w.data?.ids || []));
const barApps = () => { const f = folderIds(); return profile().apps.filter((a) => !f.has(a.id)); };

async function renderDock() {
  const apps = barApps();
  const { barStyle, barCount } = state.settings;
  const drawerMode = barStyle === 'drawer';
  await loadIcons(profile().apps);

  const animate = booted && !switching;
  const fromW = dock.getBoundingClientRect().width;
  const tiles = () => [...track.children, searchEl, continueEl];
  const tileKey = (el) => el.dataset.id || el.id || el.className;
  const before = animate ? measure(tiles(), tileKey) : null;

  dock.classList.toggle('style-drawer', drawerMode);
  dock.style.setProperty('--count', barCount);
  track.innerHTML = '';
  if (!apps.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = 'No apps yet. Press <b>+</b> to add some';
    track.append(e);
  }
  for (const app of drawerMode ? apps.slice(0, barCount) : apps) track.append(tileFor(app));
  if (drawerMode) {
    if (apps.length) track.append(drawerButton());
    renderDrawer(apps);
  } else {
    drawerGrid.innerHTML = '';
    setDrawer(false);
  }
  if (!apps.length) setDrawer(false);
  updateArrows();
  if (animate) {
    glideDockWidth(fromW);
    play(before, tiles(), { key: tileKey });
  }
  for (const app of apps) if (needsIcon(app)) queueIcon(app);
}

function refreshTile(app) {
  dock.querySelectorAll(`.tile[data-id="${app.id}"]`).forEach((old) => old.replaceWith(tileFor(app)));
}

/* ---------- icon queue (3 at a time) ---------- */

const queue = [];
let running = 0;
function queueIcon(app, opts = {}) {
  if (inflight.has(app.id)) return;
  inflight.add(app.id);
  dock.querySelectorAll(`.tile[data-id="${app.id}"]`).forEach((t) => t.classList.add('loading'));
  queue.push([app, opts]);
  pump();
}
function pump() {
  while (running < 3 && queue.length) {
    const [app, opts] = queue.shift();
    running++;
    fetchIconFor(app, opts).finally(() => { running--; inflight.delete(app.id); refreshTile(app); pump(); });
  }
}
async function fetchIconFor(app, { skipBrandfetch = false } = {}) {
  const bf = state.settings.brandfetchId;
  const recentMiss = app.bfMissAt && Date.now() - app.bfMissAt < ICON_TTL;
  if (bf) app.bfTriedAt = Date.now();
  try {
    const res = await resolveIcon(app.url, { brandfetchId: bf, skipBrandfetch: skipBrandfetch || recentMiss, name: app.name });
    await applyIcon(app, res);
  } catch (err) {
    console.warn('Icon lookup failed for', app.url, err);
  }
}

async function applyIcon(app, res) {
  if (res.kind === 'remote') {
    app.icon = { kind: 'remote', url: res.url, source: res.source, at: Date.now(), pv: ICON_PIPELINE };
    iconCache.delete(app.id);
    await store.remove('icon:' + app.id);
  } else {
    app.icon = { kind: 'data', source: res.source, at: Date.now(), pv: ICON_PIPELINE };
    iconCache.set(app.id, res.dataUrl);
    await store.set({ ['icon:' + app.id]: res.dataUrl });
  }
  if (res.source === 'brandfetch') delete app.bfMissAt;
  save();
}

/* ---------- carousel scrolling ---------- */

function updateArrows() {
  const max = track.scrollWidth - track.clientWidth;
  dock.classList.toggle('overflow-l', track.scrollLeft > 4);
  dock.classList.toggle('overflow-r', track.scrollLeft < max - 4);
}
track.addEventListener('scroll', updateArrows, { passive: true });
window.addEventListener('resize', () => { updateArrows(); hideTip(); });
const page = () => Math.max(track.clientWidth * 0.8, 120);
$('#arrowL').addEventListener('click', () => track.scrollBy({ left: -page() }));
$('#arrowR').addEventListener('click', () => track.scrollBy({ left: page() }));
track.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && track.scrollWidth > track.clientWidth) {
    e.preventDefault();
    track.scrollBy({ left: e.deltaY, behavior: 'auto' });
  }
}, { passive: false });

/* ---------- name tooltip ---------- */

function showTip(tile) {
  const app = findApp(tile.dataset.id);
  const label = app ? app.name : tile.getAttribute('aria-label');
  if (!label) return;
  tip.textContent = label;
  const r = tile.getBoundingClientRect();
  const wrap = tip.parentElement.getBoundingClientRect();
  const bar = dock.getBoundingClientRect();
  tip.style.left = (r.left + r.width / 2 - wrap.left) + 'px';
  tip.style.bottom = (wrap.bottom - bar.top + 12) + 'px';
  tip.classList.add('show');
}
const hideTip = () => tip.classList.remove('show');
const barTile = (el) => { const t = el.closest?.('.tile'); return t && !t.closest('.drawer') && !dock.classList.contains('open') ? t : null; };
dock.addEventListener('pointerover', (e) => { const t = barTile(e.target); if (t) showTip(t); else if (e.target.closest('.drawer')) hideTip(); });
dock.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !dock.contains(e.relatedTarget.closest?.('.tile'))) hideTip(); });
dock.addEventListener('focusin', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  if (barTile(t)) showTip(t); else hideTip();
  t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
dock.addEventListener('focusout', hideTip);

document.addEventListener('pointerdown', (e) => {
  if (!dock.classList.contains('open')) return;
  if (dock.contains(e.target) || $('#menu').contains(e.target) || document.querySelector('dialog[open]')) return;
  setDrawer(false);
});

/* ---------- keyboard: TV-style left/right ---------- */

function allTiles() { return [...dock.querySelectorAll('.tile')].filter((t) => !t.closest('[inert]')); }
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || !$('#menu').hidden || !$('#engineOverlay').hidden) return;
  if (e.target.matches('input, textarea')) return;
  const open = dock.classList.contains('open');
  if (e.key === 'Escape' && open) { setDrawer(false); $('#drawerBtn')?.focus(); return; }
  if (e.key === 'ArrowUp' && state.settings.barStyle === 'drawer' && !open && dock.contains(document.activeElement)) {
    e.preventDefault(); setDrawer(true, { focus: true }); return;
  }
  const tiles = allTiles();
  const i = tiles.indexOf(document.activeElement);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = i < 0 ? (step > 0 ? 0 : tiles.length - 1) : Math.min(tiles.length - 1, Math.max(0, i + step));
    tiles[next]?.focus();
  } else if (e.key === 'Delete' && i >= 0 && tiles[i].dataset.id) {
    openEditor(findApp(tiles[i].dataset.id));
  }
});

/* ---------- drag to reorder ---------- */

let dragId = null;
const clearDropMarks = () => dock.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
dock.addEventListener('dragstart', (e) => {
  const t = e.target.closest('.tile[data-id]');
  if (!t) return;
  dragId = t.dataset.id;
  t.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/uri-list', t.href);
  e.dataTransfer.setData('application/x-app-id', dragId); // lets an app folder widget take it
  hideTip();
});
dock.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const t = e.target.closest('.tile[data-id]');
  e.preventDefault();
  clearDropMarks();
  if (t && t.dataset.id !== dragId) {
    const r = t.getBoundingClientRect();
    t.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  }
  // auto-scroll the bar near its edges
  if (track.contains(e.target)) {
    const tr = track.getBoundingClientRect();
    if (e.clientX < tr.left + 40) track.scrollLeft -= 12;
    else if (e.clientX > tr.right - 40) track.scrollLeft += 12;
  }
});
dock.addEventListener('drop', (e) => {
  if (!dragId) return;
  e.preventDefault();
  const t = dock.querySelector('.drop-before,.drop-after');
  if (t) {
    const apps = profile().apps;
    const from = apps.findIndex((a) => a.id === dragId);
    const [moved] = apps.splice(from, 1);
    let to = apps.findIndex((a) => a.id === t.dataset.id);
    if (t.classList.contains('drop-after')) to++;
    apps.splice(to, 0, moved);
    save();
    renderDock();
  }
});
dock.addEventListener('dragend', () => {
  dragId = null;
  dock.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  clearDropMarks();
});

/* ============================ context menu ============================ */

const menu = $('#menu');
let menuApp = null;
dock.addEventListener('contextmenu', (e) => {
  const t = e.target.closest('.tile[data-id]');
  if (!t) return;
  e.preventDefault();
  menuApp = findApp(t.dataset.id);
  const apps = barApps();
  const idx = apps.indexOf(menuApp);
  menu.querySelector('[data-act="left"]').disabled = idx === 0;
  menu.querySelector('[data-act="right"]').disabled = idx === apps.length - 1;
  const other = state.profiles.find((p) => p.id !== state.activeProfile);
  menu.querySelector('[data-act="swap-mode"]').textContent = `Move to ${other.name}`;
  menu.hidden = false;
  const { innerWidth: W, innerHeight: H } = window;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(e.clientX, W - mw - 8) + 'px';
  menu.style.top = Math.max(8, Math.min(e.clientY - mh, H - mh - 8)) + 'px';
  menu.querySelector('button:not(:disabled)').focus();
  hideTip();
});
const closeMenu = () => { menu.hidden = true; };
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) closeMenu(); });
window.addEventListener('blur', closeMenu);
menu.addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act || !menuApp) return;
  closeMenu();
  const apps = profile().apps;
  const i = apps.indexOf(menuApp);
  switch (act) {
    case 'open-new': window.open(menuApp.url, '_blank', 'noopener'); break;
    case 'edit': openEditor(menuApp); break;
    case 'refetch':
      if (menuApp.icon?.source === 'custom') menuApp.icon = null;
      delete menuApp.bfMissAt;
      queueIcon(menuApp);
      break;
    case 'left': case 'right': {
      // Swap with the neighbour on the bar (skipping apps tucked in folders).
      const shown = barApps();
      const k = shown.indexOf(menuApp) + (act === 'left' ? -1 : 1);
      const j = apps.indexOf(shown[k]);
      if (j < 0) break;
      [apps[i], apps[j]] = [apps[j], apps[i]];
      save(); await renderDock();
      dock.querySelector(`.tile[data-id="${menuApp.id}"]`)?.focus();
      break;
    }
    case 'swap-mode': {
      const other = state.profiles.find((p) => p.id !== state.activeProfile);
      apps.splice(i, 1);
      other.apps.push(menuApp);
      save(); renderDock();
      break;
    }
    case 'remove': removeApp(menuApp); break;
  }
});

async function removeApp(app) {
  const p = profile();
  p.apps = p.apps.filter((a) => a !== app);
  iconCache.delete(app.id);
  await store.remove('icon:' + app.id);
  save();
  renderDock();
}

/* ============================ add / edit dialog ============================ */

const dlg = $('#appDialog');
const f = {
  title: $('#appTitle'), url: $('#appUrl'), name: $('#appName'),
  prevIcon: $('#previewIcon'), prevName: $('#previewName'), prevSrc: $('#previewSrc'),
  err: $('#appError'), save: $('#appSave'), remove: $('#appRemove'),
  iconUrl: $('#iconUrl'), iconFile: $('#iconFile'), opts: $('.icon-opts'),
};
let draft = null;   // { app (existing or null), url, name, nameTouched, icon:{kind,url|dataUrl,source} }
let lookupSeq = 0;

function setPreview() {
  const img = draft.icon
    ? (draft.icon.kind === 'remote' ? draft.icon.url : draft.icon.dataUrl)
    : null;
  const spin = f.prevIcon.querySelector('.spinner');
  f.prevIcon.querySelectorAll('img').forEach((x) => x.remove());
  if (img) {
    const el = document.createElement('img');
    el.referrerPolicy = 'strict-origin-when-cross-origin';
    el.src = img;
    el.alt = '';
    f.prevIcon.prepend(el);
  }
  spin.hidden = !draft.busy;
  f.prevName.textContent = draft.name || (draft.url ? prettyName(draft.url) : 'New app');
  f.prevSrc.textContent = draft.busy ? 'Finding the best icon…'
    : draft.icon ? `Icon: ${SOURCE_LABEL[draft.icon.source] || draft.icon.source}`
      : 'Paste a link to find its icon';
  f.save.disabled = !!draft.busy || !f.url.value.trim();
}

function showError(msg) {
  f.err.textContent = msg || '';
  f.err.hidden = !msg;
}

function openEditor(app = null) {
  draft = {
    app,
    url: app?.url || '',
    name: app?.name || '',
    nameTouched: !!app,
    icon: app ? (app.icon?.kind === 'remote' ? { ...app.icon } : app.icon ? { ...app.icon, dataUrl: iconCache.get(app.id) } : null) : null,
    busy: false,
  };
  f.title.textContent = app ? 'Edit app' : 'Add an app';
  f.save.textContent = app ? 'Save' : 'Add';
  f.remove.hidden = !app;
  f.url.value = draft.url;
  f.name.value = draft.name;
  f.iconUrl.value = '';
  f.opts.open = false;
  showError('');
  setPreview();
  dlg.showModal();
  (app ? f.name : f.url).focus();
}

async function lookup() {
  let url;
  try { url = normalizeUrl(f.url.value); } catch (e) { if (f.url.value.trim()) showError(e.message); return; }
  showError('');
  if (url === draft.url && draft.icon) return;
  draft.url = url;
  const seq = ++lookupSeq;
  draft.busy = true;
  draft.icon = null;
  if (!draft.nameTouched) { draft.name = prettyName(url); f.name.value = draft.name; }
  setPreview();
  const page = await scanPage(url);
  if (seq !== lookupSeq) return;
  if (!draft.nameTouched && page.name) { draft.name = page.name; f.name.value = page.name; }
  const res = await resolveIcon(url, { brandfetchId: state.settings.brandfetchId, page, name: draft.name });
  if (seq !== lookupSeq) return;
  draft.icon = res;
  draft.busy = false;
  setPreview();
}

let urlTimer;
f.url.addEventListener('input', () => {
  f.save.disabled = !!draft.busy || !f.url.value.trim();
  clearTimeout(urlTimer);
  urlTimer = setTimeout(lookup, 650);
});
f.url.addEventListener('blur', () => { clearTimeout(urlTimer); lookup(); });
f.url.addEventListener('paste', () => { clearTimeout(urlTimer); setTimeout(lookup, 0); });
f.name.addEventListener('input', () => { draft.nameTouched = true; draft.name = f.name.value.trim(); setPreview(); });

async function withBusy(fn) {
  draft.busy = true; setPreview(); showError('');
  const seq = ++lookupSeq;
  try {
    const res = await fn();
    if (seq === lookupSeq) draft.icon = res;
  } catch (e) {
    showError(e.message || 'That image could not be loaded');
  } finally {
    if (seq === lookupSeq) { draft.busy = false; setPreview(); }
  }
}
$('#iconUrlBtn').addEventListener('click', () => withBusy(() => iconFromImageUrl(f.iconUrl.value)));
f.iconUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#iconUrlBtn').click(); } });
f.iconFile.addEventListener('change', () => { const file = f.iconFile.files[0]; f.iconFile.value = ''; withBusy(() => iconFromFile(file)); });
$('#iconAutoBtn').addEventListener('click', () => {
  let url;
  try { url = normalizeUrl(f.url.value); } catch (e) { showError(e.message); return; }
  draft.url = url;
  withBusy(() => resolveIcon(url, { brandfetchId: state.settings.brandfetchId, name: draft.name }));
});

$('#appCancel').addEventListener('click', () => { lookupSeq++; dlg.close(); });
f.remove.addEventListener('click', () => { if (draft.app) removeApp(draft.app); dlg.close(); });

$('#appForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url;
  try { url = normalizeUrl(f.url.value); } catch (err) { showError(err.message); return; }
  if (draft.busy) return;
  const name = (f.name.value.trim() || draft.name || prettyName(url)).slice(0, 28);
  const app = draft.app || { id: uid() };
  app.name = name;
  app.url = url;
  if (draft.icon && (draft.icon.kind === 'remote' || draft.icon.dataUrl)) {
    await applyIcon(app, draft.icon);
  } else {
    app.icon = null; // found in the background after saving
  }
  if (!draft.app) profile().apps.push(app);
  save();
  dlg.close();
  await renderDock();
  const tile = track.querySelector(`[data-id="${app.id}"]`);
  tile?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
});
/* ============================ + menu (apps / widgets) ============================ */

// Popular picks. Chill leans to watching and social, Work to tools.
const POPULAR = {
  chill: [
    ['YouTube', 'https://www.youtube.com/'], ['Netflix', 'https://www.netflix.com/'], ['Prime Video', 'https://www.primevideo.com/'],
    ['JioHotstar', 'https://www.hotstar.com/'], ['Spotify', 'https://open.spotify.com/'], ['YouTube Music', 'https://music.youtube.com/'],
    ['Instagram', 'https://www.instagram.com/'], ['X', 'https://x.com/'], ['Reddit', 'https://www.reddit.com/'],
    ['Twitch', 'https://www.twitch.tv/'], ['SonyLIV', 'https://www.sonyliv.com/'], ['Crunchyroll', 'https://www.crunchyroll.com/'],
    ['Apple TV', 'https://tv.apple.com/'], ['Pinterest', 'https://www.pinterest.com/'], ['WhatsApp', 'https://web.whatsapp.com/'],
  ],
  work: [
    ['Gmail', 'https://mail.google.com/'], ['Calendar', 'https://calendar.google.com/'], ['Drive', 'https://drive.google.com/'],
    ['Docs', 'https://docs.google.com/'], ['Sheets', 'https://sheets.google.com/'], ['Notion', 'https://www.notion.so/'],
    ['Slack', 'https://app.slack.com/'], ['GitHub', 'https://github.com/'], ['Figma', 'https://www.figma.com/'],
    ['Claude', 'https://claude.ai/'], ['ChatGPT', 'https://chatgpt.com/'], ['LinkedIn', 'https://www.linkedin.com/'],
    ['Outlook', 'https://outlook.office.com/'], ['Teams', 'https://teams.microsoft.com/'], ['Zoom', 'https://app.zoom.us/'],
    ['Canva', 'https://www.canva.com/'], ['Trello', 'https://trello.com/'],
  ],
};
const addSheet = $('#addSheet');
let popSet = 'chill';
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function openAddSheet(tab = 'apps') {
  setDrawer(false);
  closeSettings();
  popSet = state.activeProfile === 'work' ? 'work' : 'chill';
  showAddTab(tab);
  renderPopular();
  renderWidgetCards();
  addSheet.showModal();
}
function showAddTab(tab) {
  addSheet.querySelectorAll('#addTabs button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tab === tab)));
  addSheet.querySelectorAll('.as-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
}
addSheet.querySelectorAll('#addTabs button').forEach((b) => b.addEventListener('click', () => showAddTab(b.dataset.tab)));
$('#addClose').addEventListener('click', () => addSheet.close());
addSheet.addEventListener('click', (e) => { if (e.target === addSheet) addSheet.close(); }); // click on the backdrop
$('#customApp').addEventListener('click', () => { addSheet.close(); openEditor(); });

function renderPopular() {
  const sets = $('#popSets');
  sets.innerHTML = '';
  for (const [id, label] of [['chill', 'Chill picks'], ['work', 'Work picks']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-checked', String(popSet === id));
    b.addEventListener('click', () => { popSet = id; renderPopular(); });
    sets.append(b);
  }
  $('#popTitle').textContent = modesOn() ? `Popular apps · adding to ${profile().name}` : 'Popular apps';
  const have = new Set(profile().apps.map((a) => hostOf(a.url)));
  const grid = $('#popGrid');
  grid.innerHTML = '';
  for (const [name, url] of POPULAR[popSet]) {
    const host = hostOf(url);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pop-item' + (have.has(host) ? ' added' : '');
    b.title = have.has(host) ? `${name} is already in your bar` : `Add ${name}`;
    b.innerHTML = `<span class="pop-icon"><img alt="" src="https://www.google.com/s2/favicons?domain=${host}&sz=64"></span><span class="pop-name"></span><span class="pop-tick" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>`;
    b.querySelector('.pop-name').textContent = name;
    b.querySelector('img').onerror = (e) => { e.target.replaceWith(Object.assign(document.createElement('span'), { textContent: name[0], className: 'pop-letter' })); };
    b.addEventListener('click', async () => {
      if (b.classList.contains('added')) return;
      const app = { id: uid(), name, url, icon: null };
      profile().apps.push(app);
      b.classList.add('added');
      save();
      await renderDock();          // the icon is looked up in the background
    });
    grid.append(b);
  }
}

function renderWidgetCards() {
  const box = $('#widgetCards');
  box.innerHTML = '';
  for (const [type, t] of Object.entries(WIDGET_TYPES)) {
    const card = document.createElement('div');
    card.className = 'widget-card';
    card.innerHTML = `<div class="wc-preview">
        <div class="pv-row done"><span class="pv-dot"></span>Book movie tickets</div>
        <div class="pv-row"><span class="pv-dot"></span>Finish the weekly report</div>
        <div class="pv-row"><span class="pv-dot"></span>Call mom</div>
      </div>
      <h4>${t.icon}<span></span></h4><p></p>
      <button type="button" class="btn sm primary">Add widget</button>`;
    card.querySelector('h4 span').textContent = t.name;
    card.querySelector('p').textContent = t.description;
    card.querySelector('.btn').addEventListener('click', () => {
      addSheet.close();
      if (state.settings.widgetsShown === false) { state.settings.widgetsShown = true; applyWidgetsShown(); }
      widgets.add(type);
    });
    box.append(card);
  }
}

$('#addBtn').addEventListener('click', () => openAddSheet());

/* ============================ settings ============================ */

const sdlg = $('#settingsDialog');
const ICON = {
  wallpaper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18l6-8 4 5 2.5-3L21 18z"/><circle cx="16.5" cy="7" r="1.6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/></svg>',
  bar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="14" width="18" height="6" rx="2.5"/><rect x="5" y="4" width="5" height="5" rx="1.5"/><rect x="14" y="4" width="5" height="5" rx="1.5"/></svg>',
  watch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M10 9l4 2-4 2z" fill="currentColor"/><path d="M8 20h8" stroke-linecap="round"/></svg>',
  weather: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8" r="3"/><path d="M8.5 2.5v1M3 8h1M4.6 4.1l.7.7"/><path d="M8 19h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 8 19z"/></svg>',
  modes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="3" fill="currentColor"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/></svg>',
};
const pct = (v) => `${v}%`;
const typeSlider = (key, label, min, max, step, format) => ({
  type: 'slider', key, label, min, max, step, format, onChange: () => applyTypeStyle(),
});

// ---- The settings, by section. Add new settings here. ----
const SETTINGS = [
  {
    id: 'wallpaper',
    title: 'Wallpaper & clock',
    icon: ICON.wallpaper,
    summary: () => `${modesOn() ? profile().name + ': ' : ''}${currentWallRec?.name || 'Mountains'} · clock at ${currentClockTop()}%`,
    items: [
      {
        type: 'custom',
        render: (el) => { el.innerHTML = '<div class="s-hint wall-for" id="wallFor"></div><div class="wall-grid" id="wallGrid"></div>'; },
        refresh: () => { $('#wallFor').textContent = modesOn() ? `Wallpaper for ${profile().name} mode` : 'Wallpaper'; renderWallGrid(); },
      },
      {
        type: 'custom',
        render: (el) => {
          el.innerHTML = `<div class="engine-row">
            <div class="s-label"><div class="s-title">3D Wallpaper Engine</div><div class="s-hint" id="engineSub"></div>
            <div class="engine-progress" id="engineProg" hidden><span></span></div></div>
            <div class="s-btns" id="engineActions"></div></div>`;
        },
        refresh: () => renderEngineRow(),
      },
      { type: 'slider', label: 'Clock position', min: 2, max: 40, step: 0.5, format: pct, get: currentClockTop, set: setClockTop },
      { type: 'toggle', key: 'clock24', label: '24-hour clock', onChange: () => { lastMinute = ''; } },
      {
        type: 'group',
        label: 'Clock & date style',
        items: [
          typeSlider('clockScale', 'Clock size', 50, 150, 1, pct),
          typeSlider('clockWeight', 'Clock weight', 200, 700, 1),
          typeSlider('dateScale', 'Date size', 70, 170, 1, pct),
          typeSlider('dateWeight', 'Date weight', 300, 800, 1),
          {
            type: 'buttons',
            buttons: [{
              label: 'Reset style',
              onClick: () => {
                for (const k of ['clockScale', 'clockWeight', 'dateScale', 'dateWeight']) state.settings[k] = DEFAULT_SETTINGS[k];
                applyTypeStyle(); save(); settingsUI.refresh();
              },
            }],
          },
        ],
      },
    ],
  },
  {
    id: 'search',
    title: 'Search',
    icon: ICON.search,
    summary: () => (state.settings.searchOn === false ? 'Off' : `${(ENGINES.find((e) => e.id === state.settings.searchEngine) || ENGINES[0]).name}${state.settings.searchApps === false ? '' : ' · finds your apps too'}`),
    items: [
      {
        type: 'toggle', key: 'searchOn', label: 'Search bar',
        hint: 'Enter opens the top app, Shift + Enter searches the web.',
        onChange: () => applySearchOn(),
      },
      {
        type: 'custom', when: () => state.settings.searchOn !== false,
        render: (el) => { el.innerHTML = '<div class="s-label"><div class="s-title">Search with</div><div class="s-hint">Pick in the search bar too. The last one you use is remembered.</div></div><select class="s-select" id="engineSelect"></select>'; el.querySelector('select').addEventListener('change', (e) => { state.settings.searchEngine = e.target.value; save(); searchUI.refresh(); settingsUI.refresh(); }); },
        refresh: () => {
          const sel = $('#engineSelect');
          if (!sel.options.length) for (const e of ENGINES) sel.add(new Option(e.name, e.id));
          sel.value = state.settings.searchEngine || 'google';
        },
      },
      {
        type: 'toggle', label: 'Remember last service', when: () => state.settings.searchOn !== false,
        hint: () => (state.settings.searchRemember === false ? 'Each new tab starts with the service above' : 'The one you pick in the search bar becomes the default'),
        get: () => state.settings.searchRemember !== false, set: (v) => { state.settings.searchRemember = v; save(); },
      },
      {
        type: 'toggle', label: 'Find my apps', when: () => state.settings.searchOn !== false,
        hint: 'Show your apps that match as you type',
        get: () => state.settings.searchApps !== false, set: (v) => { state.settings.searchApps = v; save(); }, onChange: () => searchUI.refresh(),
      },
      {
        type: 'segment', label: 'Open in', when: () => state.settings.searchOn !== false,
        options: [{ value: false, label: 'Same tab' }, { value: true, label: 'New tab' }],
        get: () => !!state.settings.searchNewTab, set: (v) => { state.settings.searchNewTab = v; save(); },
      },
      {
        type: 'toggle', label: 'Start typing anywhere', when: () => state.settings.searchOn !== false,
        hint: 'Typing on the page jumps into search. / always works',
        get: () => state.settings.searchAnywhere !== false, set: (v) => { state.settings.searchAnywhere = v; save(); },
      },
      {
        type: 'toggle', label: 'Keyboard hints', when: () => state.settings.searchOn !== false,
        hint: 'The Enter / Shift + Enter line under the search bar',
        get: () => state.settings.searchHints !== false, set: (v) => { state.settings.searchHints = v; save(); }, onChange: () => searchUI.refresh(),
      },
    ],
  },
  {
    id: 'appbar',
    title: 'App bar',
    icon: ICON.bar,
    summary: () => `${state.settings.barStyle === 'drawer' ? 'Drawer' : 'Bar'} · ${state.settings.barCount} icons · ${state.settings.barScale}% size`,
    items: [
      {
        type: 'segment', key: 'barStyle', label: 'Style',
        hint: () => (state.settings.barStyle === 'drawer' ? 'First apps in the bar, the arrow opens the rest' : 'Scrolls sideways when apps don’t fit'),
        options: [{ value: 'bar', label: 'Bar' }, { value: 'drawer', label: 'Drawer' }],
        onChange: () => renderDock(),
      },
      {
        type: 'group',
        label: 'Size & layout',
        items: [
          { type: 'slider', key: 'barCount', label: 'Icons shown', min: 3, max: 16, step: 1, onChange: () => renderDock() },
          { type: 'slider', key: 'barScale', label: 'Bar size', min: 70, max: 150, step: 1, format: pct, onChange: () => applyTypeStyle() },
        ],
      },
      {
        type: 'text', key: 'brandfetchId', label: 'Brandfetch client ID', advanced: true,
        placeholder: 'Optional',
        hint: 'Extra icon source. Free ID at developers.brandfetch.com',
        onChange: () => {
          for (const p of state.profiles) for (const a of p.apps) { delete a.bfTriedAt; delete a.bfMissAt; }
          renderDock();
        },
      },
      {
        type: 'buttons', label: 'App icons', hint: 'Look up every icon in this mode again', advanced: true,
        buttons: [{
          label: 'Refresh icons',
          onClick: (btn) => {
            for (const a of profile().apps) { if (a.icon?.source === 'custom') continue; delete a.bfMissAt; queueIcon(a); }
            btn.textContent = 'Refreshing…';
            setTimeout(() => { btn.textContent = 'Refresh icons'; }, 1500);
          },
        }],
      },
    ],
  },
  {
    id: 'watching',
    title: 'Keep watching',
    icon: ICON.watch,
    summary: () => {
      const on = WATCH_SERVICES.filter((svc) => state.settings[svc.setting] !== false).map((svc) => svc.name);
      return on.length ? `${on.join(', ')}${modesOn() ? ' · Chill mode' : ''}` : 'Off';
    },
    items: WATCH_SERVICES.map((svc) => ({
      type: 'toggle', key: svc.setting, label: svc.name,
      hint: {
        prime: 'Your last show with time left',
        youtube: 'Resumes at the exact second · skips ads and videos under 4 minutes',
        netflix: 'Artwork appears once you’ve browsed Netflix in this browser',
        hotstar: 'Best effort: JioHotstar’s pages change often',
      }[svc.id],
      onChange: async (on) => { if (!on) await store.remove(watchKey(svc.id)); renderContinue(); },
    })),
  },
  {
    id: 'weather',
    title: 'Weather',
    icon: ICON.weather,
    summary: () => (state.settings.weatherOn
      ? `${state.settings.weatherUnit === 'fahrenheit' ? '°F' : '°C'} · ${state.settings.weatherLoc?.name || 'Current location'}`
      : 'Off'),
    items: [
      { type: 'toggle', key: 'weatherOn', label: 'Show weather', hint: 'Next to the date', onChange: () => refreshWeather(true) },
      {
        type: 'segment', key: 'weatherUnit', label: 'Units',
        options: [{ value: 'celsius', label: '°C' }, { value: 'fahrenheit', label: '°F' }],
        onChange: () => refreshWeather(true),
      },
      { type: 'custom', render: renderLocationRow, refresh: refreshLocationRow },
    ],
  },
  {
    id: 'modes',
    title: 'Modes',
    icon: ICON.modes,
    summary: () => {
      if (!modesOn()) return 'One mode';
      const n = state.profiles.length;
      return `${n} modes · ${state.settings.splitModes ? 'separate setups' : 'shared setup'}`;
    },
    items: [
      {
        type: 'toggle', key: 'modesOn', label: 'Mode switcher',
        hint: () => (modesOn() ? 'Switch between Chill, Work and any extra modes from the top left' : `Off: one mode, using your ${profile().name} apps and wallpaper`),
        onChange: () => { renderProfiles(); syncAdvanced(); renderContinue(); applyWallpaper(); },
      },
      {
        type: 'custom', advanced: true, when: modesOn,
        render: (el) => { el.innerHTML = '<div class="s-label"><div class="s-title">Extra modes</div><div class="s-hint">Up to 5 modes in total, each with its own apps, wallpaper and widgets</div></div><div class="mode-list" id="modeList"></div>'; },
        refresh: renderModeList,
      },
      {
        type: 'toggle', label: 'Separate setups', when: modesOn,
        hint: 'Each mode keeps its own app bar, clock style, weather and night mode. Wallpapers are always separate.',
        get: () => !!state.settings.splitModes,
        set: (v) => { setSplitModes(v); syncAdvanced(); },
      },
    ],
  },
  {
    id: 'data',
    title: 'Backup',
    icon: ICON.data,
    advanced: true,
    summary: () => 'Save or restore your apps and settings',
    items: [
      {
        type: 'buttons', label: 'Backup file', hint: 'Apps, modes and settings (not wallpapers)',
        buttons: [
          { label: 'Export', onClick: exportBackup },
          { label: 'Import', file: true, accept: 'application/json', onFile: importBackup },
        ],
      },
    ],
  },
];

let settingsUI = { refresh() {} };

function setClockTop(v) {
  applyClockTop(v);
  // Saved on the wallpaper itself, so the engine and Settings share one value.
  clearTimeout(setClockTop.t);
  setClockTop.t = setTimeout(async () => {
    if (currentWallRec) { currentWallRec.clockTop = v; await putWallpaper(currentWallRec); }
    else { state.settings.builtinClockTop = v; save(); }
  }, 250);
}

async function exportBackup() {
  const all = await store.getAll();
  for (const k of Object.keys(all)) if (k.startsWith('pinterest:')) delete all[k]; // sign-in and cached pins stay on this computer
  const blob = new Blob([JSON.stringify({ horizonNewTab: 1, ...all }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'new-tab-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.horizonNewTab || !data.state?.profiles) throw new Error();
    delete data.horizonNewTab;
    await store.set(data);
    location.reload();
  } catch {
    uiAlert({ title: 'Can’t import this file', message: 'That file isn’t a backup from this new tab page. Choose a file made with Export.' });
  }
}

function initSettings() {
  settingsUI = buildSettings($('#settingsBody'), SETTINGS, {
    settings: () => state.settings,
    save,
    openSections: () => state.settings.openSections || ['wallpaper'],
    setOpenSections: (ids) => { state.settings.openSections = ids; save(); },
  });
  syncAdvanced();
}
function syncAdvanced() {
  $('#showAdvanced').checked = !!state.settings.showAdvanced;
  sdlg.classList.toggle('show-adv', !!state.settings.showAdvanced);
  // With separate setups, show which mode's settings are being edited.
  const chip = $('#spMode');
  chip.hidden = !state.settings.splitModes || !modesOn();
  chip.textContent = `${profile().name} mode`;
}
$('#showAdvanced').addEventListener('change', () => {
  state.settings.showAdvanced = $('#showAdvanced').checked;
  save(); syncAdvanced();
});

/* open / close: slides in from the right, slides back out; outside click closes */
function openSettings() {
  if (sdlg.open) return;
  setDrawer(false);
  settingsUI.refresh();
  sdlg.show();
  requestAnimationFrame(() => requestAnimationFrame(() => sdlg.classList.add('in')));
}
function closeSettings() {
  if (!sdlg.open || !sdlg.classList.contains('in')) return;
  sdlg.classList.remove('in');
  const done = () => { if (!sdlg.classList.contains('in')) sdlg.close(); };
  sdlg.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 480);
}
$('#settingsBtn').addEventListener('click', () => (sdlg.open && sdlg.classList.contains('in') ? closeSettings() : openSettings()));
$('#settingsClose').addEventListener('click', closeSettings);
document.addEventListener('pointerdown', (e) => {
  if (!sdlg.open) return;
  const t = e.target;
  if (sdlg.contains(t) || t.closest('#settingsBtn') || t.closest('dialog[open]:not(#settingsDialog)') || t.closest('#menu')) return;
  if (!$('#engineOverlay').hidden) return;
  closeSettings();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sdlg.open && !document.querySelector('dialog[open]:not(#settingsDialog)')) closeSettings(); });

function renderModeList() {
  const box = $('#modeList');
  if (!box) return;
  box.innerHTML = '';
  for (const p of state.profiles.filter((x) => !modeMeta(x.id))) {
    const row = document.createElement('div');
    row.className = 'mode-row';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 's-input'; input.maxLength = 16; input.value = p.name;
    input.setAttribute('aria-label', 'Mode name');
    input.addEventListener('change', () => { p.name = input.value.trim() || 'Mode'; save(); renderProfiles(); settingsUI.refresh(); });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn sm danger-ghost'; del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!(await uiConfirm({ title: `Delete “${p.name}”?`, message: `${p.apps.length ? `Its ${p.apps.length} app${p.apps.length === 1 ? '' : 's'} and widgets are` : 'Its widgets are'} deleted too. Your other modes aren’t affected.`, confirmLabel: 'Delete mode', danger: true }))) return;
      if (state.activeProfile === p.id) await switchMode('chill');
      state.profiles = state.profiles.filter((x) => x !== p);
      delete state.modeSettings?.[p.id];
      await store.remove(p.apps.map((a) => 'icon:' + a.id));
      save(); renderProfiles(); settingsUI.refresh();
    });
    row.append(input, del);
    box.append(row);
  }
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'btn sm ghost';
  const full = state.profiles.length >= MAX_MODES;
  add.textContent = full ? 'You have 5 modes' : 'Add a mode';
  add.disabled = full;
  add.addEventListener('click', () => {
    const id = 'm_' + uid();
    const n = state.profiles.length + 1;
    state.profiles.push({ id, name: `Mode ${n}`, apps: [], wallpaper: 'builtin', widgets: [] });
    if (state.settings.splitModes) state.modeSettings[id] = { ...state.settings };
    save(); renderProfiles(); settingsUI.refresh();
    box.querySelector('.mode-row:last-of-type input')?.select();
  });
  box.append(add);
}

/* ============================ wallpaper ============================ */

const BUILTIN = { bg: 'assets/wallpaper.jpg', fg: 'assets/wallpaper-fg.webp' };
const DEFAULT_CLOCK_TOP = 14; // vh
let currentWallRec = null;    // the saved record of the wallpaper on screen (null = built-in)

function currentClockTop() {
  if (currentWallRec) return currentWallRec.clockTop ?? DEFAULT_CLOCK_TOP;
  return state.settings.builtinClockTop ?? DEFAULT_CLOCK_TOP;
}
function applyClockTop(v = currentClockTop()) {
  document.documentElement.style.setProperty('--clock-top', v + 'vh');
}
const wallBg = $('#wallBg'), wallFg = $('#wallFg');
let shownWall = null;
let wallUrls = [];

const loadImg = (el, src) => new Promise((resolve) => {
  el.onload = () => resolve(); el.onerror = () => resolve();
  el.src = src;
});

async function applyWallpaper() {
  let id = profile().wallpaper || 'builtin';
  let pick = BUILTIN, urls = [];
  let rec = null;
  if (id !== 'builtin') {
    try {
      const w = await getWallpaper(id);
      if (w?.bg) {
        rec = w;
        const bg = URL.createObjectURL(w.bg);
        const fg = w.fg ? URL.createObjectURL(w.fg) : null;
        urls = [bg, fg].filter(Boolean);
        pick = { bg, fg };
      } else id = 'builtin';
    } catch { id = 'builtin'; }
  }
  currentWallRec = rec;
  if (id === shownWall) { urls.forEach(URL.revokeObjectURL); applyClockTop(); return; }
  const first = shownWall === null;
  shownWall = id;
  if (!first) { wallBg.classList.remove('ready'); wallFg.classList.remove('ready'); await wait(350); }
  await Promise.all([
    loadImg(wallBg, pick.bg),
    pick.fg ? loadImg(wallFg, pick.fg) : Promise.resolve(),
  ]);
  wallFg.classList.toggle('none', !pick.fg);
  applyClockTop();
  if (sdlg.open) settingsUI.refresh();
  wallBg.classList.add('ready'); wallFg.classList.add('ready');
  wallUrls.forEach(URL.revokeObjectURL);
  wallUrls = urls;
}

/* wallpaper settings */
let thumbUrls = [];
async function renderWallGrid() {
  const grid = $('#wallGrid');
  thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = [];
  let mine = [];
  try { mine = await listWallpapers(); } catch { /* storage unavailable */ }
  const items = [{ id: 'builtin', name: 'Mountains', thumb: 'assets/wallpaper-thumb.jpg' },
    ...mine.map((w) => { const u = URL.createObjectURL(w.thumb); thumbUrls.push(u); return { id: w.id, name: w.name, thumb: u, mine: true }; })];
  grid.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wall-item';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String((profile().wallpaper || 'builtin') === it.id));
    b.title = it.name;
    const im = document.createElement('img'); im.src = it.thumb; im.alt = '';
    const nm = document.createElement('span'); nm.className = 'wi-name'; nm.textContent = it.name;
    b.append(im, nm);
    if (it.mine) {
      const x = document.createElement('span');
      x.className = 'wi-x'; x.title = 'Delete';
      x.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(await uiConfirm({ title: `Delete “${it.name}”?`, message: 'Modes using it switch back to Mountains.', confirmLabel: 'Delete wallpaper', danger: true }))) return;
        await deleteWallpaper(it.id);
        for (const p of state.profiles) if (p.wallpaper === it.id) p.wallpaper = 'builtin';
        save(); applyWallpaper();
        renderWallGrid();
      });
      b.append(x);
    }
    b.addEventListener('click', () => {
      profile().wallpaper = it.id;
      save(); applyWallpaper();
      grid.querySelectorAll('.wall-item').forEach((el) => el.setAttribute('aria-checked', String(el === b)));
    });
    grid.append(b);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'wall-item wall-add';
  add.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg><span>Create your own</span>';
  add.addEventListener('click', openEngine);
  grid.append(add);
}

let engineBusy = false;
async function renderEngineRow() {
  const box = $('#engineActions'), sub = $('#engineSub');
  if (engineBusy) return;
  const installed = await engineInstalled();
  box.innerHTML = '';
  const mk = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = label; b.addEventListener('click', fn); box.append(b); return b; };
  if (installed) {
    sub.textContent = `Installed · about ${MODEL_SIZE_MB} MB. Removing it keeps the wallpapers you’ve made.`;
    mk('Open', 'primary', openEngine);
    mk('Remove', 'danger-ghost', async () => {
      if (!(await uiConfirm({ title: 'Remove the 3D Wallpaper Engine?', message: `Frees about ${MODEL_SIZE_MB} MB. Wallpapers you’ve made stay, and you can download it again any time.`, confirmLabel: 'Remove', danger: true }))) return;
      await removeEngine();
      renderEngineRow();
    });
  } else {
    sub.textContent = `Turn your own photos into wallpapers with the clock behind the scene. Optional ${MODEL_SIZE_MB} MB download.`;
    mk('Download', 'primary', async (e) => {
      engineBusy = true;
      const btn = e.currentTarget, bar = $('#engineProg');
      btn.disabled = true; bar.hidden = false;
      try {
        await downloadEngine((p) => {
          bar.firstElementChild.style.width = `${(p * 100).toFixed(1)}%`;
          btn.textContent = `${Math.round(p * 100)}%`;
        });
      } catch (err) {
        sub.textContent = `Download failed (${err.message}). Check your connection and try again.`;
        engineBusy = false; bar.hidden = true;
        btn.disabled = false; btn.textContent = 'Retry';
        return;
      }
      engineBusy = false; bar.hidden = true;
      renderEngineRow();
    });
  }
}

/* ============================ engine overlay ============================ */

const engineOverlay = $('#engineOverlay');
const engineFrame = $('#engineFrame');
function openEngine() {
  closeSettings();
  setDrawer(false);
  engineFrame.src = 'engine.html?overlay=1';
  engineOverlay.hidden = false;
  engineFrame.addEventListener('load', () => engineFrame.focus(), { once: true });
}
function closeEngine() {
  if (engineOverlay.hidden) return;
  engineOverlay.hidden = true;
  engineFrame.src = 'about:blank'; // frees the model's memory
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== engineFrame.contentWindow) return;
  if (e.data?.type === 'horizon-engine-close') closeEngine();
  if (e.data?.type === 'horizon-engine-saved') { applyWallpaper(); setTimeout(closeEngine, 700); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !engineOverlay.hidden) closeEngine(); });
engineOverlay.addEventListener('click', (e) => { if (e.target === engineOverlay) closeEngine(); });

/* ============================ weather ============================ */

const WX_KEY = 'wx:cache';
const WX_TTL = 15 * 60 * 1000;
const wxEl = $('#weather');
let wxBusy = false;

async function weatherCoords() {
  const loc = state.settings.weatherLoc;
  if (loc) return { lat: loc.lat, lon: loc.lon, name: loc.name };
  try {
    const pos = await currentPosition();
    await store.set({ 'wx:coords': pos });
    return { ...pos, name: '' };
  } catch {
    const saved = (await store.get('wx:coords'))['wx:coords'];
    return saved ? { ...saved, name: '' } : null;
  }
}

function paintWeather(w) {
  if (!w || !state.settings.weatherOn) { wxEl.hidden = true; return; }
  $('#wxIcon').innerHTML = iconSvg(w.code, w.isDay);
  $('#wxTemp').textContent = `${Math.round(w.temp)}°${w.unit === 'fahrenheit' ? 'F' : 'C'}`;
  wxEl.title = [describe(w.code), w.name].filter(Boolean).join(' · ');
  wxEl.hidden = false;
}

async function refreshWeather(force = false) {
  if (!state.settings.weatherOn) { wxEl.hidden = true; return; }
  const unit = state.settings.weatherUnit;
  const locKey = state.settings.weatherLoc ? `${state.settings.weatherLoc.lat},${state.settings.weatherLoc.lon}` : 'auto';
  const cached = (await store.get(WX_KEY))[WX_KEY];
  const fits = cached && cached.unit === unit && cached.locKey === locKey;
  if (fits) paintWeather(cached);          // show the last reading straight away
  if (!force && fits && Date.now() - cached.at < WX_TTL) return;
  if (wxBusy) return;
  wxBusy = true;
  try {
    const c = await weatherCoords();
    if (!c) { if (!fits) wxEl.hidden = true; return; }
    const now = await fetchCurrent(c.lat, c.lon, unit);
    const w = { ...now, unit, locKey, name: c.name, at: Date.now() };
    await store.set({ [WX_KEY]: w });
    paintWeather(w);
  } catch {
    if (!fits) wxEl.hidden = true;        // offline: keep whatever we had
  } finally {
    wxBusy = false;
  }
}
setInterval(() => refreshWeather(), WX_TTL);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWeather(); });

/* weather location row (rendered inside Settings) */
function renderLocationRow(el) {
  el.innerHTML = `<div class="loc-line">
      <div class="s-label"><div class="s-title">Location</div><div class="s-hint" id="locLabel"></div></div>
      <button type="button" class="btn sm ghost" id="useMyLoc">Use my location</button>
    </div>
    <div class="city-search">
      <input type="text" class="s-input" id="citySearch" placeholder="Search a city" spellcheck="false">
      <button type="button" class="btn sm ghost" id="citySearchBtn">Search</button>
    </div>
    <div class="city-results" id="cityResults"></div>`;
  el.querySelector('#useMyLoc').addEventListener('click', () => {
    state.settings.weatherLoc = null;
    save(); settingsUI.refresh(); refreshWeather(true);
  });
  el.querySelector('#citySearchBtn').addEventListener('click', runCitySearch);
  el.querySelector('#citySearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCitySearch(); } });
}
function refreshLocationRow() {
  const loc = state.settings.weatherLoc;
  $('#locLabel').textContent = loc ? `${loc.name}${loc.detail ? ', ' + loc.detail : ''}` : 'Current location';
  $('#useMyLoc').hidden = !loc;
}
async function runCitySearch() {
  const q = $('#citySearch').value.trim();
  const box = $('#cityResults');
  if (q.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="msg">Searching…</div>';
  try {
    const list = await searchCities(q);
    box.innerHTML = list.length ? '' : '<div class="msg">No places found</div>';
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.name;
      const d = document.createElement('span');
      d.textContent = c.detail;
      b.append(d);
      b.addEventListener('click', () => {
        state.settings.weatherLoc = { name: c.name, detail: c.detail, lat: c.lat, lon: c.lon };
        box.innerHTML = '';
        $('#citySearch').value = '';
        save(); settingsUI.refresh(); refreshWeather(true);
      });
      box.append(b);
    }
  } catch {
    box.innerHTML = '<div class="msg">Couldn’t search right now. Check your connection.</div>';
  }
}

/* ============================ keep watching ============================ */

const WATCH_MAX_AGE = 1000 * 60 * 60 * 24 * 21; // hide after 3 weeks
const MAX_CARDS = 3;
const continueEl = $('#continue');
const continueRow = $('#continueRow');

function timeLeft(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m left` : `${h}h left`;
}

function episodeLabel(rec) {
  if (typeof rec.episode === 'string') return rec.episode;          // older saves ("S3 E2")
  if (rec.season && rec.episode) return `S${rec.season} E${rec.episode}`;
  if (rec.episode) return `E${rec.episode}`;
  return '';                                                       // a movie or video
}

function serviceIcon(svc) {
  for (const p of state.profiles) {
    for (const a of p.apps) {
      if (svc.match.test(a.url)) {
        if (a.icon?.kind === 'remote') return a.icon.url;
        if (iconCache.has(a.id)) return iconCache.get(a.id);
      }
    }
  }
  return null;
}

async function renderContinue() {
  const work = modesOn() && state.activeProfile === 'work'; // off in Work mode
  const on = work ? [] : WATCH_SERVICES.filter((svc) => state.settings[svc.setting] !== false);
  const got = on.length ? await store.get(on.map((svc) => watchKey(svc.id))) : {};
  const items = on
    .map((svc) => ({ svc, rec: got[watchKey(svc.id)] }))
    .filter(({ rec }) => {
      if (!rec?.url || !rec.duration) return false;
      const pct = rec.position / rec.duration;
      return pct > 0.01 && pct < 0.95
        && Date.now() - rec.updatedAt < WATCH_MAX_AGE
        && !(rec.dismissedAt && rec.dismissedAt >= rec.updatedAt);
    })
    .sort((a, b) => b.rec.updatedAt - a.rec.updatedAt)
    .slice(0, MAX_CARDS);

  const quiet = dockStack.classList.contains('mode-out');
  await flip(() => [searchEl, continueEl, ...continueRow.children],
    () => {
      continueEl.hidden = !items.length;
      continueRow.replaceChildren(...items.map((it) => watchCard(it.svc, it.rec)));
    },
    { key: (el) => el.dataset.key || el.id || el, enter: !quiet && booted });
}

function watchCard(svc, rec) {
  const pct = rec.position / rec.duration;
  const card = document.createElement('a');
  card.className = 'watch-card';
  card.dataset.key = svc.id;
  card.href = rec.url;
  card.title = `Continue ${rec.title}${episodeLabel(rec) ? ' — ' + episodeLabel(rec) : ''}${rec.episodeTitle ? ': ' + rec.episodeTitle : ''}`;

  const thumb = document.createElement('div');
  thumb.className = 'wc-thumb';
  const play = '<svg class="wc-play" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
  if (rec.poster) {
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = rec.poster;
    img.onerror = () => { thumb.innerHTML = play; };
    thumb.append(img);
  } else {
    thumb.innerHTML = play;
  }

  const body = document.createElement('div');
  body.className = 'wc-body';
  const service = document.createElement('div');
  service.className = 'wc-service';
  const badge = document.createElement('span');
  badge.className = 'wc-badge';
  badge.style.background = svc.color;
  const icon = serviceIcon(svc);
  if (icon) { const i = document.createElement('img'); i.alt = ''; i.src = icon; badge.append(i); }
  else badge.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="#fff" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
  service.append(badge, document.createTextNode(svc.name));

  const title = document.createElement('div');
  title.className = 'wc-title';
  title.textContent = rec.title;
  const ep = document.createElement('div');
  ep.className = 'wc-ep';
  ep.textContent = [episodeLabel(rec) || rec.sub, timeLeft(rec.duration - rec.position)].filter(Boolean).join(' · ');
  const bar = document.createElement('div');
  bar.className = 'wc-bar';
  bar.innerHTML = `<span style="width:${(pct * 100).toFixed(1)}%"></span>`;
  body.append(service, title, ep, bar);

  const x = document.createElement('button');
  x.className = 'wc-x';
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss');
  x.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
  x.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    card.style.pointerEvents = 'none';
    await exit(card);
    await store.set({ [watchKey(svc.id)]: { ...rec, dismissedAt: Date.now() } });
    renderContinue();
  });

  card.append(thumb, body, x);
  return card;
}

/* ============================ search ============================ */

const searchEl = $('#search');
let tabEngine = null;
const searchUI = createSearch({
  root: searchEl,
  // Apps from every mode, the current mode's first, without duplicates.
  getApps: () => {
    const seen = new Set();
    const order = [profile(), ...state.profiles.filter((p) => p !== profile())];
    return order.flatMap((p) => p.apps).filter((a) => (seen.has(a.url) ? false : seen.add(a.url)));
  },
  iconFor: (a) => iconSrc(a),
  // With "Remember last service" off, a pick in the bar lasts for this tab only.
  getEngine: () => tabEngine || state?.settings?.searchEngine || 'google',
  setEngine: (id) => { if (state.settings.searchRemember === false) tabEngine = id; else { tabEngine = null; state.settings.searchEngine = id; save(); } },
  getOptions: () => ({
    apps: state?.settings?.searchApps !== false,
    newTab: !!state?.settings?.searchNewTab,
    anywhere: state?.settings?.searchAnywhere !== false,
    hints: state?.settings?.searchHints !== false,
  }),
});
function applySearchOn() {
  const hide = state.settings.searchOn === false;
  if (searchEl.hidden === hide) return;
  flip(() => [searchEl, continueEl], () => { searchEl.hidden = hide; }, { enter: booted });
}

/* ============================ widgets ============================ */

const widgetLayer = $('#widgetLayer');
// Edge stacks stop just above the bar and the Keep watching cards.
function updateWidgetBounds() {
  const top = dockStack.getBoundingClientRect().top;
  widgetLayer.style.setProperty('--w-bottom', Math.max(120, innerHeight - top + 14) + 'px');
}
addEventListener('resize', updateWidgetBounds);
new ResizeObserver(updateWidgetBounds).observe(dockStack);
const widgets = createWidgetLayer({
  layer: widgetLayer,
  getList: () => (profile().widgets = profile().widgets || []),
  save,
  getSettings: () => state.settings,
  apps: { all: () => profile().apps, onBar: barApps, icon: iconSrc, changed: () => renderDock() },
  // Imaginary rounded rectangle: under the mode switcher, above the Keep watching cards and bar.
  getBounds: () => {
    const topEl = $('#profiles').hidden ? $('#nightBtn') : $('#profiles');
    return {
      left: 16,
      right: innerWidth - 16,
      top: topEl.getBoundingClientRect().bottom + 14,
      bottom: dockStack.getBoundingClientRect().top - 14,
    };
  },
});

/* ============================ boot ============================ */

async function boot() {
  const got = await store.get('state');
  state = normalize(got.state?.profiles ? got.state : freshState());
  if (state !== got.state) await store.set({ state });
  document.body.dataset.mode = state.activeProfile;
  applyTypeStyle();
  initSettings();
  applyWallpaper();
  applyNight();
  applyWidgetsShown();
  applySearchOn(); searchUI.refresh();
  tick();
  renderProfiles();
  widgets.render();
  await renderDock();
  renderContinue();
  refreshWeather();

  setTimeout(() => { booted = true; }, 600);
  // Keep several open tabs in sync, and pick up Prime Video progress live.
  store.onChange(async (changes) => {
    if (Object.keys(changes).some((k) => k.startsWith('watch:') && k !== 'watch:netflix-art')) renderContinue();
    if (!changes.state || selfWrite) return;
    const fresh = (await store.get('state')).state;
    if (!fresh) return;
    state = normalize(fresh);
    applyTypeStyle();
    renderContinue();
    refreshWeather();
    applyWallpaper();
    syncAdvanced();
    if (sdlg.open) settingsUI.refresh();
    document.body.dataset.mode = state.activeProfile;
    iconCache.clear();
    applyNight();
    applyWidgetsShown();
    applySearchOn();
    searchUI.refresh();
    renderProfiles();
    if (!document.activeElement?.closest?.('.widget')) widgets.reset();
    if (!document.querySelector('dialog[open]')) renderDock();
  });
}
boot();
