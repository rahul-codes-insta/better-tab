// Search bar: one box for your apps and the web.
// Typing shows matching apps; Enter opens the top app, or searches with the
// chosen service. Shift+Enter always searches. The chosen service is remembered.

export const ENGINES = [
  { id: 'google', ph: 'Search Google or jump to an app', name: 'Google', host: 'google.com', url: (q) => `https://www.google.com/search?q=${q}` },
  { id: 'claude', ph: 'Ask Claude anything or open an app', name: 'Claude', host: 'claude.ai', url: (q) => `https://claude.ai/new?q=${q}` },
  { id: 'chatgpt', ph: 'Ask ChatGPT anything or open an app', name: 'ChatGPT', host: 'chatgpt.com', url: (q) => `https://chatgpt.com/?q=${q}` },
  { id: 'gemini', ph: 'Ask Gemini anything or open an app', name: 'Gemini', host: 'gemini.google.com', url: (q) => `https://gemini.google.com/app?q=${q}`, copy: true },
  { id: 'perplexity', ph: 'Ask Perplexity or open an app', name: 'Perplexity', host: 'perplexity.ai', url: (q) => `https://www.perplexity.ai/search?q=${q}` },
  { id: 'youtube', ph: 'Find a video or open an app', name: 'YouTube', host: 'youtube.com', url: (q) => `https://www.youtube.com/results?search_query=${q}` },
  { id: 'duckduckgo', ph: 'Search privately or jump to an app', name: 'DuckDuckGo', host: 'duckduckgo.com', url: (q) => `https://duckduckgo.com/?q=${q}` },
  { id: 'bing', ph: 'Search Bing or jump to an app', name: 'Bing', host: 'bing.com', url: (q) => `https://www.bing.com/search?q=${q}` },
  { id: 'yahoo', ph: 'Search Yahoo or jump to an app', name: 'Yahoo', host: 'yahoo.com', url: (q) => `https://search.yahoo.com/search?p=${q}` },
  { id: 'brave', ph: 'Search Brave or jump to an app', name: 'Brave Search', host: 'search.brave.com', url: (q) => `https://search.brave.com/search?q=${q}` },
  { id: 'wikipedia', ph: 'Look something up or open an app', name: 'Wikipedia', host: 'wikipedia.org', url: (q) => `https://en.wikipedia.org/w/index.php?search=${q}` },
  { id: 'maps', ph: 'Find a place or open an app', name: 'Google Maps', host: 'maps.google.com', url: (q) => `https://www.google.com/maps/search/${q}` },
  { id: 'amazon', ph: 'Shop Amazon or open an app', name: 'Amazon', host: 'amazon.in', url: (q) => `https://www.amazon.in/s?k=${q}` },
  { id: 'github', ph: 'Find code on GitHub or open an app', name: 'GitHub', host: 'github.com', url: (q) => `https://github.com/search?q=${q}` },
  { id: 'reddit', ph: 'Search Reddit or open an app', name: 'Reddit', host: 'reddit.com', url: (q) => `https://www.reddit.com/search/?q=${q}` },
];

const ICON = {
  search: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/></g></svg>',
  chev: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7 10l5 5 5-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h13M13 6l6 6-6 6"/></svg>',
};

/** How well an app matches what's typed (0 = no match). */
function score(app, q) {
  const n = app.name.toLowerCase();
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90 - (n.length - q.length) * 0.1;
  const words = n.split(/[\s\-_.]+/);
  if (words.some((w) => w.startsWith(q))) return 80;
  let host = '';
  try { host = new URL(app.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  if (host.startsWith(q)) return 72;
  if (n.includes(q)) return 60;
  if (words.map((w) => w[0]).join('').startsWith(q)) return 55;   // "pv" → Prime Video
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length ? 30 : 0;                                   // letters in order
}

export function createSearch({ root, getApps, iconFor, getEngine, setEngine, getOptions = () => ({}) }) {
  root.innerHTML = `
    <div class="sr-results" id="srResults" aria-live="polite"><div class="sr-label">Apps</div><div class="sr-apps" role="listbox"></div></div>
    <div class="sr-menu" id="srMenu" role="listbox" aria-label="Search with"></div>
    <div class="sr-bar">
      <span class="sr-glass-icon">${ICON.search}</span><button type="button" class="sr-engine" aria-label="Choose where to search" aria-haspopup="listbox"><span class="sr-ename"></span><span class="sr-chev">${ICON.chev}</span></button>
      <input type="text" class="sr-input" placeholder="Search" spellcheck="false" autocomplete="off" aria-label="Search apps and the web">
      <span class="sr-go" aria-hidden="true">${ICON.arrow}</span>
    </div>
    <div class="sr-hint"><div class="sr-hint-inner"></div></div>`;
  const bar = root.querySelector('.sr-bar');
  const input = root.querySelector('.sr-input');
  const engineBtn = root.querySelector('.sr-engine');
  const engineName = engineBtn.querySelector('.sr-ename');
  const menu = root.querySelector('.sr-menu');
  const results = root.querySelector('.sr-results');
  const appsBox = results.querySelector('.sr-apps');
  const hint = root.querySelector('.sr-hint-inner');
  let matches = [];
  let sel = 0;            // index in matches; matches.length = the "search" option
  let lastKey = '';

  const engine = () => ENGINES.find((e) => e.id === getEngine()) || ENGINES[0];

  function paintEngine() {
    const e = engine();
    engineName.textContent = e.name;
    engineBtn.title = `Searching with ${e.name}`;
    input.placeholder = root.classList.contains('open') ? e.ph : 'Search';
  }

  /* ---------- open / close with a liquid squish ---------- */
  // The placeholder changes while the bar morphs, so it's hidden until the shape settles.
  let phTimer;
  function hidePlaceholder() {
    root.classList.add('ph-wait');
    clearTimeout(phTimer);
    phTimer = setTimeout(() => root.classList.remove('ph-wait'), 380);
  }
  function open() {
    if (root.classList.contains('open')) return;
    hidePlaceholder();
    root.classList.add('open');
    bar.classList.remove('squish');
    void bar.offsetWidth;
    bar.classList.add('squish');
    paintEngine();
  }
  function close(force = false) {
    if (!force && input.value.trim()) return;
    hidePlaceholder();
    root.classList.remove('open', 'menu-open', 'has-results');
    if (force) input.value = '';
    matches = [];
    paintEngine();
    renderHint();
  }

  /* ---------- engine menu ---------- */
  function renderMenu() {
    menu.innerHTML = '';
    for (const e of ENGINES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sr-opt';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(e.id === engine().id));
      b.innerHTML = `<span></span>${e.id === engine().id ? ICON.check : ''}`;
      b.querySelector('span').textContent = e.name;
      b.addEventListener('click', () => {
        setEngine(e.id);
        root.classList.remove('menu-open');
        paintEngine(); update();
        input.focus();
      });
      menu.append(b);
    }
  }
  engineBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const on = !root.classList.contains('menu-open');
    if (on) renderMenu();
    root.classList.toggle('menu-open', on);
    if (on) menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  /* ---------- results ---------- */
  function update() {
    const q = input.value.trim().toLowerCase();
    const key = q;
    matches = q && getOptions().apps !== false ? getApps()
      .map((a) => ({ a, s: score(a, q) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 7)
      .map((x) => x.a) : [];
    if (key !== lastKey) sel = 0;
    lastKey = key;
    root.classList.toggle('has-results', matches.length > 0);
    const prev = new Map([...appsBox.children].map((el, i) => [el.dataset.url, { el, i }]));
    const next = matches.map((a, i) => {
      const had = prev.get(a.url);
      let b = had?.el;
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.dataset.url = a.url;
        b.innerHTML = '<img alt=""><span></span>';
        b.querySelector('img').src = iconFor(a);
        b.querySelector('span').textContent = a.name;
        b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the box
        b.addEventListener('click', () => go(a.url));
        b.addEventListener('animationend', () => b.classList.remove('enter'));
      }
      const moved = !had || had.i !== i;
      const playing = !moved && b.classList.contains('enter');
      b.className = 'sr-app' + (i === sel ? ' sel' : '') + (playing ? ' enter' : '');
      if (moved) { b.style.setProperty('--i', had ? 0 : i); void b.offsetWidth; b.classList.add('enter'); }
      return b;
    });
    appsBox.replaceChildren(...next);
    renderHint();
  }

  function renderHint() {
    const q = input.value.trim();
    const e = engine();
    if (!q || getOptions().hints === false) { hint.innerHTML = ''; root.classList.remove('has-hint'); return; }
    root.classList.add('has-hint');
    const app = matches[sel];
    hint.innerHTML = app
      ? `Press <kbd>Enter</kbd> to open <b></b><span class="sr-sep">·</span><kbd>Shift</kbd> <kbd>Enter</kbd> to search ${e.name}`
      : `Press <kbd>Enter</kbd> to search ${e.name}`;
    if (app) hint.querySelector('b').textContent = app.name;
  }

  /* ---------- go ---------- */
  function go(url) {
    if (getOptions().newTab) { window.open(url, '_blank', 'noopener'); close(true); input.blur(); } else location.assign(url);
  }
  async function search() {
    const q = input.value.trim();
    if (!q) return;
    const e = engine();
    if (e.copy) { try { await navigator.clipboard.writeText(q); } catch { /* no clipboard */ } }
    go(e.url(encodeURIComponent(q)));
  }

  input.addEventListener('focus', open);
  bar.addEventListener('click', () => input.focus());
  input.addEventListener('input', () => { root.classList.remove('menu-open'); update(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const app = matches[sel];
      if (app && !ev.shiftKey) go(app.url); else search();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      if (root.classList.contains('menu-open')) { root.classList.remove('menu-open'); return; }
      close(true); input.blur();
    } else if ((ev.key === 'ArrowRight' && input.selectionStart === input.value.length && matches.length) || (ev.key === 'Tab' && !ev.shiftKey && matches.length)) {
      ev.preventDefault();
      sel = (sel + 1) % (matches.length + 1); update();
    } else if ((ev.key === 'ArrowLeft' && input.selectionStart === input.value.length && sel > 0) || (ev.key === 'Tab' && ev.shiftKey && matches.length)) {
      ev.preventDefault();
      sel = (sel - 1 + matches.length + 1) % (matches.length + 1); update();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => {
    if (!root.contains(document.activeElement)) { root.classList.remove('menu-open'); close(); }
  }, 120));
  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target) && root.classList.contains('open')) { input.blur(); close(true); }
  });

  // Start typing anywhere on the page to search.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open], .notes-overlay:not([hidden])') || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === '/' || (getOptions().anywhere !== false && e.key.length === 1 && /\S/.test(e.key))) {
      if (e.key === '/') e.preventDefault();
      input.focus();
    }
  });

  paintEngine();
  return { refresh: () => { paintEngine(); if (root.classList.contains('open')) update(); } };
}
