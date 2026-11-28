// Notes: a small built-in notes app that opens as an overlay over the new tab.
// Notes live in storage under 'notes' and are shared by every mode.
import * as store from './store.js';
import { uiConfirm } from './ui-dialog.js';

const KEY = 'notes';
const uid = () => Math.random().toString(36).slice(2, 10);

// The Notes app's own icon: a cream page with a butter-yellow top and ruled lines.
export const NOTES_ICON = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#f3eee2"/></linearGradient></defs>
<rect width="120" height="120" rx="28" fill="url(#g)"/>
<path d="M0 28A28 28 0 0 1 28 0h64a28 28 0 0 1 28 28v8H0z" fill="#f6c84c"/>
<g stroke="#d9d2c2" stroke-width="3" stroke-linecap="round"><path d="M22 58h76M22 76h76M22 94h52"/></g>
</svg>`);

let panel, data = { list: [], current: null }, loaded = false, saveT;

async function load() {
  if (loaded) return;
  data = (await store.get(KEY))[KEY] || data;
  data.list = data.list || [];
  loaded = true;
}
function persist(now = false) {
  clearTimeout(saveT);
  const go = () => store.set({ [KEY]: data });
  if (now) return go();
  saveT = setTimeout(go, 350);
}
const blank = (n) => !n.title.trim() && !n.body.trim();
const titleOf = (n) => n.title.trim() || n.body.trim().split('\n')[0].slice(0, 60) || 'New note';
const snippetOf = (n) => (n.title.trim() ? n.body : n.body.split('\n').slice(1).join(' ')).trim().replace(/\s+/g, ' ').slice(0, 80);
function when(at) {
  const d = new Date(at), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function build() {
  panel = document.createElement('div');
  panel.className = 'notes-overlay';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="nt-scrim"></div>
    <section class="nt-panel" role="dialog" aria-modal="true" aria-label="Notes">
      <aside class="nt-side">
        <div class="nt-side-head">
          <h2>Notes</h2>
          <button type="button" class="nt-new" aria-label="New note" title="New note">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <ul class="nt-list" role="listbox" aria-label="Your notes"></ul>
      </aside>
      <div class="nt-main">
        <button type="button" class="nt-close sp-close" aria-label="Close notes">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <div class="nt-editor">
          <input class="nt-title" type="text" maxlength="120" placeholder="Title" aria-label="Note title">
          <div class="nt-meta"></div>
          <textarea class="nt-body" placeholder="Start writing…" aria-label="Note"></textarea>
        </div>
        <div class="nt-empty">
          <p>No notes yet</p>
          <button type="button" class="nt-empty-new">New note</button>
        </div>
      </div>
    </section>`;
  document.body.append(panel);
  const $ = (s) => panel.querySelector(s);
  $('.nt-scrim').addEventListener('click', close);
  $('.nt-close').addEventListener('click', close);
  $('.nt-new').addEventListener('click', () => create());
  $('.nt-empty-new').addEventListener('click', () => create());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); create(); }
  });
  const title = $('.nt-title'), body = $('.nt-body');
  title.addEventListener('input', () => edit({ title: title.value }));
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
  body.addEventListener('input', () => edit({ body: body.value }));
}

const cur = () => data.list.find((n) => n.id === data.current);

function edit(patch) {
  const n = cur();
  if (!n) return;
  Object.assign(n, patch, { at: Date.now() });
  // the note being edited moves to the top
  data.list = [n, ...data.list.filter((x) => x !== n)];
  persist();
  drawList();
  drawMeta();
}

function dropBlank(except) {
  const before = data.list.length;
  data.list = data.list.filter((n) => n.id === except || !blank(n));
  return before !== data.list.length;
}

function create() {
  dropBlank();
  const n = { id: uid(), title: '', body: '', at: Date.now() };
  data.list.unshift(n);
  data.current = n.id;
  persist();
  draw();
  panel.querySelector('.nt-title').focus();
}

function select(id) {
  if (id === data.current) return;
  dropBlank(id);
  data.current = id;
  persist();
  draw();
}

async function removeNote(n) {
  if (!blank(n) && !(await uiConfirm({ title: 'Delete this note?', message: `“${titleOf(n)}” will be deleted.`, confirmLabel: 'Delete', danger: true }))) return;
  data.list = data.list.filter((x) => x !== n);
  if (data.current === n.id) data.current = data.list[0]?.id || null;
  persist(true);
  draw();
}

function drawList() {
  const list = panel.querySelector('.nt-list');
  list.replaceChildren(...data.list.map((n) => {
    const li = document.createElement('li');
    li.className = 'nt-item' + (n.id === data.current ? ' on' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(n.id === data.current));
    li.tabIndex = 0;
    li.innerHTML = '<div class="nt-item-title"></div><div class="nt-item-sub"><time></time><span></span></div><button type="button" class="nt-del" aria-label="Delete note"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg></button>';
    li.querySelector('.nt-item-title').textContent = titleOf(n);
    li.querySelector('time').textContent = when(n.at);
    li.querySelector('.nt-item-sub span').textContent = snippetOf(n) || 'No more text';
    li.addEventListener('click', (e) => { if (!e.target.closest('.nt-del')) select(n.id); });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(n.id); });
    li.querySelector('.nt-del').addEventListener('click', () => removeNote(n));
    return li;
  }));
}

function drawMeta() {
  const n = cur();
  panel.querySelector('.nt-meta').textContent = n
    ? new Date(n.at).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
}

function draw() {
  if (!cur()) data.current = data.list[0]?.id || null;
  const n = cur();
  panel.classList.toggle('is-empty', !n);
  panel.querySelector('.nt-title').value = n?.title || '';
  panel.querySelector('.nt-body').value = n?.body || '';
  drawList();
  drawMeta();
}

export async function openNotes() {
  await load();
  if (!panel) build();
  if (!panel.hidden) return;
  if (!data.list.length) create(); // nothing yet: start a note so you can just type
  else draw();
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('in'));
  const n = cur();
  const field = panel.querySelector(n && !n.title ? '.nt-title' : '.nt-body');
  if (n) setTimeout(() => field.focus({ preventScroll: true }), 80);
}

export function close() {
  if (!panel || panel.hidden) return;
  if (dropBlank()) { data.current = data.list[0]?.id || null; }
  persist(true);
  panel.classList.remove('in');
  setTimeout(() => { panel.hidden = true; }, 260);
}

// Another tab changed the notes: pick it up next time (or now, if open and not typing).
store.onChange?.((changes) => {
  if (!changes[KEY] || !loaded) return;
  const typing = panel && !panel.hidden && panel.contains(document.activeElement) && document.activeElement.matches('input, textarea');
  if (typing) return;
  data = changes[KEY].newValue || { list: [], current: null };
  if (panel && !panel.hidden) draw();
});
