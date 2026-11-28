// Floating widgets: drag anywhere, snap and stack along the left and right edges.
//
// To add a widget type, add an entry to WIDGET_TYPES:
//   name, description, icon (svg), create() → initial data, mount(body, widget, api),
//   optional size: one of WIDGET_SIZES (otherwise 2×4),
//   optional sizes: the sizes it makes sense in, e.g. ['2x2', '4x2'] (otherwise all but the tall 2×4),
//   Sizes read columns × rows: 4x2 is 4 across and 2 down (wide), 2x4 is 2 across and 4 down (tall).
//   optional settings(widget) → extra rows for the widget's gear menu, each one of
//     { label, get(), set(v) }                 a toggle
//     { label, text: true, get(), set(v) }     a text field
//     { label, run() }                         a button (closes the menu)
// Every widget uses the same four sizes on one grid. Do not invent a new width.
//   2×2 small square, 2×4 wide (4 cells across, 2 down), 4×4 large square, 6×4 extra wide.
// 8×4 would cover the clock on a laptop, so the widest is 6×4.
// A 2×2 is about a fifth of the window's height, and the gap is a tenth of that.
// Widgets snap to the grid unless "Move widgets freely" is on in Settings.
// api: { save(), setCount(text), settings(), apps }
import { uiConfirm } from './ui-dialog.js';
import * as P from './pinterest.js';
import { extraWidgets } from './widgets-more.js';

// Widgets have no name heading unless their type asks for one (showName: true, e.g. To-do).
// A type with its own switch (ownName, e.g. App folder) lets each widget choose.
const nameShown = (w) => {
  const t = WIDGET_TYPES[w.type];
  return t?.ownName ? !!w.showName : !!t?.showName;
};

export const WIDGET_SIZES = [['2x2', '2×2'], ['2x4', '2×4'], ['4x2', '4×2'], ['4x4', '4×4']];
const LEGACY_SIZE = { s: '2x2', m: '4x2', l: '4x4', xl: '4x4', '6x4': '4x4' }; // 6×4 is gone: 4×4 is the largest
const CELLS = { '2x2': [2, 2], '2x4': [2, 4], '4x2': [4, 2], '4x4': [4, 4], '6x4': [6, 4] }; // [across, down]
// The sizes a widget type offers (optional `sizes` on its entry), in WIDGET_SIZES order.
const sizesOf = (type) => WIDGET_SIZES.filter(([id]) => (WIDGET_TYPES[type]?.sizes ? WIDGET_TYPES[type].sizes.includes(id) : id !== '2x4'));
function applySize(w) {
  if (LEGACY_SIZE[w.size]) w.size = LEGACY_SIZE[w.size];
  // Before sizes read columns × rows, "2x4" meant the wide size; those become 4x2 once.
  if (!w.sz) { if (w.size === '2x4') w.size = '4x2'; w.sz = 2; }
  if (!sizesOf(w.type).some(([id]) => id === w.size)) w.size = WIDGET_TYPES[w.type]?.size || sizesOf(w.type)[0][0];
  delete w.shape; // every widget is the soft shape now
  delete w.hideButtons; // settings live in the right-click menu
  return w.size;
}

// Themes: a widget's own look, always called "Default" (optional `theme: {}` on its type, styled with
// .widget.type-<id>.theme-own) and then Glass, Dark and Clear (`noClear: true` drops Clear).
function themesOf(type) {
  return [...(type.theme ? [['own', 'Default']] : []), ['glass', 'Glass'], ['dark', 'Dark'], ...(type.noClear ? [] : [['clear', 'Clear']])];
}
function lookOf(w) {
  const type = WIDGET_TYPES[w.type];
  const ok = themesOf(type).map(([id]) => id);
  return ok.includes(w.bg) ? w.bg : ok[0];
}

const uid = () => Math.random().toString(36).slice(2, 10);

const ICONS = {
  todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.2l2.3 2.3 4.7-4.9"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-6"/><path d="M8.5 3.5h7l-1 6 3 3v2.5h-11V12.5l3-3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></g></svg>',
  star: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="14" height="14"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></g></svg>',
};

/* ---------------- widget types ---------------- */

const HERE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MAX_CITIES = 4;

export const WIDGET_TYPES = {
  /* ---------- to-do ---------- */
  todo: {
    showName: true, // the one widget with a title
    name: 'To-do',
    description: 'A checklist. Add it again for another list.',
    icon: ICONS.todo,
    sizes: ['2x2', '2x4', '4x2', '4x4'],
    theme: {}, // its own look ("Default"): white
    create: () => ({ items: [], title: 'To-do' }),
    mount(body, w, api) {
      const d = w.data;
      if (d.hideDone) { d.completed = 'hide'; delete d.hideDone; } // older setting
      if (d.completed === 'hide') d.completed = 'remove';
      if (d.completed === 'stay') d.completed = 'bottom';
      if (!d.title) d.title = 'To-do';
      const widget = body.closest('.widget');
      widget.classList.add('todo-widget');
      const name = widget.querySelector('.w-name');
      name.contentEditable = 'true';
      name.spellcheck = false;
      name.title = 'Click to rename';
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
      name.addEventListener('blur', () => {
        const v = name.textContent.replace(/\s+/g, ' ').trim().slice(0, 32) || 'To-do';
        name.textContent = v;
        if (v !== d.title) { d.title = v; api.save(); }
      });
      // Shows on hover, and always while the list is empty. While adding, it's the tick that saves.
      const PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>';
      const TICK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5.5 12.5l4.2 4.2 8.8-9.2"/></svg>';
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'todo-fab';
      widget.append(plus);
      body.innerHTML = `
        <div class="todo-progress" hidden><span></span></div>
        <div class="todo-scroll">
          <ul class="todo-list"></ul>
          <form class="todo-add" hidden><input type="text" placeholder="New task" maxlength="120" aria-label="New task"></form>
        </div>`;
      const scroller = body.querySelector('.todo-scroll');
      const list = body.querySelector('.todo-list');
      const form = body.querySelector('.todo-add');
      const input = form.querySelector('input');
      const progress = body.querySelector('.todo-progress');
      const items = () => (d.items = d.items || []);
      const removeDone = () => d.completed === 'remove';
      let dragId = null;

      // Starred first, then the list's own order; finished tasks sink to the bottom.
      function visible() {
        const rank = (x) => (x.done ? 2 : 0) + (x.star && !x.done && d.starFirst !== false ? -1 : 0);
        return items().map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]);
      }
      const commit = () => { api.save(); draw(); };
      // A finished task is crossed off first, then sinks or goes away.
      function toggle(li, it) {
        it.done = !it.done;
        api.save();
        li.classList.toggle('done', it.done);
        clearTimeout(li.settle);
        li.settle = setTimeout(() => {
          if (it.done && removeDone()) { d.items = items().filter((x) => x !== it); commit(); } else draw();
        }, it.done ? 650 : 0);
      }

      function draw() {
        list.innerHTML = '';
        const shown = visible();
        for (const it of shown) {
          const li = document.createElement('li');
          li.className = 'todo-item' + (it.done ? ' done' : '') + (it.star ? ' starred' : '');
          li.draggable = true;
          li.innerHTML = `<span class="todo-check" aria-hidden="true"></span><span class="todo-text"></span><button type="button" class="todo-star" aria-pressed="${!!it.star}" aria-label="${it.star ? 'Unstar task' : 'Star task'}">${ICONS.star}</button><button type="button" class="todo-del" aria-label="Delete task">${ICONS.x}</button>`;
          li.setAttribute('role', 'checkbox');
          li.setAttribute('aria-checked', String(!!it.done));
          li.tabIndex = 0;
          const text = li.querySelector('.todo-text');
          text.textContent = it.text;
          text.title = it.text + ' · Double-click to edit';
          // One click finishes it; a double-click edits it instead.
          let clickTimer;
          li.addEventListener('click', (e) => {
            if (e.target.closest('button, input')) return;
            clearTimeout(clickTimer);
            if (e.detail > 1) return;
            clickTimer = setTimeout(() => toggle(li, it), 220);
          });
          li.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target === li) { e.preventDefault(); toggle(li, it); } });
          li.querySelector('.todo-star').addEventListener('click', () => { it.star = !it.star; commit(); });
          li.querySelector('.todo-del').addEventListener('click', () => { d.items = items().filter((x) => x !== it); commit(); });
          text.addEventListener('dblclick', () => { clearTimeout(clickTimer); edit(li, it); });
          // drag to reorder
          li.addEventListener('dragstart', (e) => { dragId = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.text); li.classList.add('dragging'); });
          li.addEventListener('dragend', () => { dragId = null; draw(); });
          li.addEventListener('dragover', (e) => {
            if (!dragId || dragId === it.id) return;
            e.preventDefault();
            const r = li.getBoundingClientRect();
            list.querySelectorAll('.drop-above,.drop-below').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
            li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
          });
          li.addEventListener('drop', (e) => {
            if (!dragId) return;
            e.preventDefault();
            const arr = items();
            const [moved] = arr.splice(arr.findIndex((x) => x.id === dragId), 1);
            arr.splice(arr.indexOf(it) + (li.classList.contains('drop-below') ? 1 : 0), 0, moved);
            api.save();
          });
          list.append(li);
        }
        const total = items().length, done = items().filter((x) => x.done).length;
        api.setCount(!d.count || !total ? '' : done === total ? 'All done' : `${total - done} left`);
        list.hidden = !shown.length;
        widget.classList.toggle('todo-empty', !total);
        progress.hidden = !d.progress || !total;
        progress.firstElementChild.style.width = total ? `${(done / total) * 100}%` : '0';
        requestAnimationFrame(fit);
      }

      // When the tasks don't fit, the list scrolls and stops halfway through a row, so it's
      // clear there's more. The space after the last row keeps it clear of the corner button.
      function fit() {
        const top = scroller.scrollTop;
        scroller.classList.remove('scrolls');
        scroller.style.height = '';
        const content = list.offsetHeight + (form.hidden ? 0 : form.offsetHeight + 4);
        const avail = scroller.clientHeight;
        const row = list.firstElementChild?.offsetHeight;
        if (content > avail + 1 && row) {
          scroller.classList.add('scrolls');
          scroller.style.height = (Math.max(1, Math.floor((avail - row / 2) / row)) + 0.5) * row + 'px';
        }
        scroller.scrollTop = top;
      }
      new ResizeObserver(() => fit()).observe(body);

      function setAdding(on) {
        form.hidden = !on;
        widget.classList.toggle('adding', on);
        plus.innerHTML = on ? TICK : PLUS;
        plus.title = on ? 'Save task' : 'Add a task';
        plus.setAttribute('aria-label', plus.title);
        fit();
      }
      setAdding(false);

      function edit(li, it) {
        const text = li.querySelector('.todo-text');
        const field = document.createElement('input');
        field.className = 'todo-edit';
        field.value = it.text;
        field.maxLength = 120;
        field.setAttribute('aria-label', 'Edit task');
        li.draggable = false;
        text.replaceWith(field);
        field.focus();
        field.select();
        let over = false;
        const finish = (keep) => {
          if (over) return;
          over = true;
          const v = field.value.trim();
          if (keep) { if (v) it.text = v; else d.items = items().filter((x) => x !== it); api.save(); }
          draw();
        };
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
        });
        field.addEventListener('blur', () => finish(true));
      }

      const reveal = () => requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
      plus.addEventListener('pointerdown', (e) => { if (!form.hidden) e.preventDefault(); }); // keep typing focus
      plus.addEventListener('click', () => {
        if (form.hidden) { setAdding(true); input.focus(); reveal(); return; }
        if (input.value.trim()) form.requestSubmit();
        else setAdding(false);
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const it = { id: uid(), text, done: false };
        if (d.newOnTop) items().unshift(it); else items().push(it);
        input.value = '';
        commit();
        input.focus();
        reveal();
      });
      input.addEventListener('blur', () => { if (!input.value.trim()) setAdding(false); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; setAdding(false); input.blur(); } });
      draw();
    },
    chips: (w) => [
      { label: 'Tasks left', title: 'How many are left, next to the title', get: () => !!w.data.count, set: (v) => { w.data.count = v; } },
      { label: 'Progress bar', get: () => !!w.data.progress, set: (v) => { w.data.progress = v; } },
    ],
    settings: (w) => [
      { label: 'List name', text: true, max: 32, placeholder: 'To-do', get: () => w.data.title, set: (v) => { w.data.title = v || 'To-do'; } },
      { label: 'New tasks go', choice: [['top', 'Top'], ['bottom', 'Bottom']], get: () => (w.data.newOnTop ? 'top' : 'bottom'), set: (v) => { w.data.newOnTop = v === 'top'; } },
      { label: 'Done tasks', hint: 'Click a task to finish it', choice: [['bottom', 'Sink'], ['remove', 'Remove']], get: () => (w.data.completed === 'remove' ? 'remove' : 'bottom'), set: (v) => { w.data.completed = v; } },
      { label: 'Starred tasks first', get: () => w.data.starFirst !== false, set: (v) => { w.data.starFirst = v; } },
      {
        actions: [
          { label: 'Clear done', disabled: () => !(w.data.items || []).some((x) => x.done), run: () => { w.data.items = w.data.items.filter((x) => !x.done); } },
          {
            label: 'Delete all…', danger: true, disabled: () => !(w.data.items || []).length,
            run: async () => {
              const n = w.data.items.length;
              if (await uiConfirm({ title: 'Delete all tasks?', message: `All ${n} task${n === 1 ? '' : 's'} in this list are deleted.`, confirmLabel: 'Delete all', danger: true })) w.data.items = [];
            },
          },
        ],
      },
    ],
  },

  /* ---------- world clock ---------- */
  worldclock: {
    name: 'World clock',
    description: 'Times for up to 4 cities. One city gets a big clock with a day line.',
    icon: ICONS.clock,
    hideName: true, // the cities say what it is
    theme: {}, // its own look ("Default"): white card, dark type, a red "now" marker
    sizes: ['2x2', '2x4', '4x2', '4x4'],
    create: () => ({ clocks: [{ tz: 'America/New_York' }] }),
    mount(body, w, api) {
      const d = migrateClock(w.data);
      body.innerHTML = '<ul class="wcx-list"></ul><div class="wc-empty" hidden>No cities yet. <button type="button">Choose cities</button></div>';
      const list = body.querySelector('.wcx-list');
      const empty = body.querySelector('.wc-empty');
      empty.querySelector('button').addEventListener('click', () => api.openSettings?.());
      const rows = () => [...(d.local ? [{ tz: HERE_TZ, label: 'My time', here: true }] : []), ...d.clocks];
      const TICKS = '<div class="wcx-ticks" aria-hidden="true"><span>12</span><span>6</span><span>12</span><span>6</span><span>12</span></div>';

      function draw() {
        list.innerHTML = '';
        const n = rows().length;
        // One city: the big clock with a day line. More: a stack of rows, each with its own day bar.
        const solo = n === 1;
        list.className = 'wcx-list' + (solo ? ' solo' : ' stack') + (!solo && d.layout === 'grid' ? ' grid' : '');
        for (const c of rows()) {
          const li = document.createElement('li');
          li.className = 'wcx-item' + (c.here ? ' here' : '');
          li.dataset.tz = c.tz;
          li.innerHTML = '<div class="wcx-place"><span class="wcx-city"></span><span class="wcx-meta"></span></div>'
            + '<div class="wcx-clock"><span class="wcx-time"></span><span class="wcx-ampm"></span></div>'
            + `<div class="wcx-day"><div class="wcx-track"><i class="wcx-dot"></i></div>${solo ? TICKS : ''}</div>`
            + (solo ? '<div class="wcx-now" aria-hidden="true"><i></i></div>' : '');
          li.querySelector('.wcx-city').textContent = c.label || cityOf(c.tz);
          list.append(li);
        }
        const across = w.size === '2x2' || w.size === '2x4' ? 1 : 2;
        const cols = !solo && d.layout === 'grid' ? Math.min(across, n) : 1;
        list.style.setProperty('--cols', String(cols));
        list.style.setProperty('--rows', String(Math.max(1, Math.ceil(n / cols)))); // text scales to fit the rows
        list.hidden = !n;
        empty.hidden = !!n;
        api.setCount('');
        tick();
      }

      const gmt = (raw) => {
        const min = Math.round(raw / 15) * 15; // offsets are whole quarter hours
        if (!min) return 'GMT';
        const h = Math.floor(Math.abs(min) / 60), m = Math.abs(min) % 60;
        return `GMT${min > 0 ? '+' : '−'}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
      };

      function tick() {
        const now = new Date();
        const h12 = d.format === '12' ? true : d.format === '24' ? false : !api.settings?.().clock24;
        const here = offsetMin(now, HERE_TZ);
        for (const li of list.children) {
          const tz = li.dataset.tz;
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: d.seconds ? '2-digit' : undefined, hour12: h12 }).formatToParts(now);
          li.querySelector('.wcx-time').textContent = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
          li.querySelector('.wcx-ampm').textContent = parts.find((p) => p.type === 'dayPeriod')?.value || '';
          const hm = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
          const hour = +hm.find((p) => p.type === 'hour').value, minute = +hm.find((p) => p.type === 'minute').value;
          li.style.setProperty('--t', String((hour * 60 + minute) / 1440)); // where now sits on the day line
          li.classList.toggle('off', !!d.workHours && (hour < 9 || hour >= 18));
          const meta = [gmt(offsetMin(now, tz))];
          const dd = dayDiff(now, tz);
          if (d.date) meta.push(now.toLocaleDateString([], { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }));
          if (!li.classList.contains('here') && d.diff !== false) {
            const m = offsetMin(now, tz) - here;
            if (m) meta.push(`${m > 0 ? '+' : '−'}${fmtHrs(Math.abs(m))}`);
          }
          if (!d.date && dd) meta.push(dd > 0 ? 'Tomorrow' : 'Yesterday');
          if (d.workHours && (hour < 9 || hour >= 18)) meta.push('Off hours');
          li.querySelector('.wcx-meta').textContent = meta.join(' · ');
        }
      }

      draw();
      const timer = setInterval(() => { if (!body.isConnected) clearInterval(timer); else tick(); }, d.seconds ? 1000 : 10000);
    },
    chips: (w) => {
      const d = migrateClock(w.data);
      return [
        { label: 'My time', title: 'Your own time zone, first', get: () => !!d.local, set: (v) => { d.local = v; } },
        { label: 'Date', get: () => !!d.date, set: (v) => { d.date = v; } },
        { label: 'Seconds', get: () => !!d.seconds, set: (v) => { d.seconds = v; } },
        { label: 'Difference', title: 'How far ahead or behind you', get: () => d.diff !== false, set: (v) => { d.diff = v; } },
        { label: 'Off hours', title: 'Dim cities outside 9 am – 6 pm their time', get: () => !!d.workHours, set: (v) => { d.workHours = v; } },
      ];
    },
    settings: (w) => {
      const d = migrateClock(w.data);
      return [
        { label: 'Cities', hint: 'Rename a city by typing over it', custom: (box, changed) => cityEditor(box, d, changed) },
        { label: 'Layout', choice: [['list', 'Stack'], ['grid', 'Grid']], hint: 'With two or more cities', get: () => d.layout || 'list', set: (v) => { d.layout = v; } },
        { label: 'Time format', hint: 'Auto follows the main clock', choice: [['auto', 'Auto'], ['12', '12h'], ['24', '24h']], get: () => d.format || 'auto', set: (v) => { d.format = v; } },
      ];
    },
  },

  /* ---------- app folder ---------- */
  // Grows on its own: 2×2 holds 4 apps, then 2×4, 4×4, 6×4. No Size setting.
  folder: {
    name: 'App folder',
    description: 'Shortcuts to your apps, grouped in a folder. They stay on the bar too.',
    icon: ICONS.folder,
    size: '2x2',
    sizes: ['2x2', '2x4', '4x2', '4x4'],
    dynamicSize: true,
    hideName: true, // the icons say what it is
    create: () => ({ ids: [] }),
    mount(body, w, api) {
      const d = w.data;
      body.innerHTML = '<div class="fd-grid"></div>';
      const grid = body.querySelector('.fd-grid');
      const all = () => api.apps?.all() || [];
      // Drop ids of apps that were deleted since.
      // Apps this mode has (a folder moved from another mode keeps the others for when it goes back).
      const mine = () => (d.ids || []).filter((id) => all().some((a) => a.id === id));
      const appIcon = (app) => { const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.dataset.appIcon = app.id; img.src = api.apps.icon(app); return img; };
      const changed = () => { api.save(); api.apps.changed(); draw(); };
      let dragId = null;

      function put(id) {
        if (!id || mine().includes(id) || !all().some((a) => a.id === id)) return;
        d.ids = d.ids || [];
        const before = w.size;
        if (!api.fitFolder?.(mine().length + 1)) return; // grows if needed; refuses when there's no room
        d.ids.push(id);
        api.save();
        api.apps.changed();
        if (w.size !== before) api.refresh?.(); // rebuild so the widget's size class updates
        else draw();
      }
      function draw() {
        grid.innerHTML = '';
        const n = mine().length;
        const cap = api.folderCap?.(w.size) ?? 4;
        const full = n >= cap;
        grid.className = `fd-grid icon-${d.size || 'm'}` + (d.hideNames ? ' no-names' : '');
        for (const id of mine()) {
          const app = all().find((a) => a.id === id);
          const a = document.createElement('a');
          a.className = 'fd-app';
          a.href = app.url;
          a.title = app.name;
          if (d.newTab) { a.target = '_blank'; a.rel = 'noopener'; }
          a.append(appIcon(app));
          a.insertAdjacentHTML('beforeend', `<span class="fd-name"></span><button type="button" class="fd-out" title="Remove from folder">${ICONS.x}</button>`);
          a.querySelector('.fd-name').textContent = app.name;
          const out = a.querySelector('.fd-out');
          out.setAttribute('aria-label', `Remove ${app.name} from this folder`);
          out.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            d.ids = (d.ids || []).filter((x) => x !== id);
            changed();
          });
          // drag to reorder inside the folder
          a.addEventListener('dragstart', (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/uri-list', app.url); a.classList.add('dragging'); });
          a.addEventListener('dragend', () => { dragId = null; draw(); });
          a.addEventListener('dragover', (e) => {
            if (!dragId || dragId === id) return;
            e.preventDefault();
            const r = a.getBoundingClientRect();
            grid.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
            a.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
          });
          a.addEventListener('drop', (e) => {
            if (!dragId) return;
            e.preventDefault();
            e.stopPropagation();
            const ids = mine().filter((x) => x !== dragId);
            ids.splice(ids.indexOf(id) + (a.classList.contains('drop-after') ? 1 : 0), 0, dragId);
            d.ids = ids;
            api.save();
          });
          grid.append(a);
        }
        // + while there's a free slot (or while picking). When full, Add app is on right-click.
        if (!full) {
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'fd-app fd-add';
          add.setAttribute('aria-label', 'Add apps');
          add.innerHTML = '<span class="fd-plus" aria-hidden="true">+</span><span class="fd-name">Add</span>';
          add.addEventListener('click', () => api.openPicker?.());
          grid.append(add);
        }
        grid.style.setProperty('--cols', String(api.folderCols?.(w.size) ?? 2));
        grid.style.setProperty('--rows', String(api.folderRows?.(w.size) ?? 2));
        api.setCount(n ? `${n} app${n === 1 ? '' : 's'}` : '');
      }
      // Drag an app from the bar onto the folder.
      const card = () => body.closest('.widget');
      body.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('application/x-app-id')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card()?.classList.add('fd-over');
      });
      body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) card()?.classList.remove('fd-over'); });
      body.addEventListener('drop', (e) => {
        card()?.classList.remove('fd-over');
        const id = e.dataTransfer.getData('application/x-app-id');
        if (!id) return;
        e.preventDefault();
        put(id);
      });
      draw();
    },
    ownName: true, // its own "Show folder name" switch instead of the generic Name pill
    settings: (w, ctx) => [
      { label: 'Folder name', text: true, placeholder: 'App folder', get: () => w.data.title, set: (v) => { w.data.title = v; } },
      { label: 'Show folder name', hint: 'Off hides the folder’s title bar', get: () => nameShown(w), set: (v) => { w.showName = v; } },
      { label: 'Show app names', hint: 'Icons shrink a little to make room', get: () => !w.data.hideNames, set: (v) => { w.data.hideNames = !v; } },
      { label: 'Open apps in a new tab', get: () => !!w.data.newTab, set: (v) => { w.data.newTab = v; } },
      { label: 'Icon size', choice: [['s', 'S'], ['m', 'M'], ['l', 'L']], get: () => w.data.size || 'm', set: (v) => { w.data.size = v; } },
      {
        actions: [
          { label: 'Add apps…', run: () => { setTimeout(() => ctx.openPicker?.(), 0); } },
          { label: 'Empty folder', disabled: () => !(w.data.ids || []).length, run: () => { w.data.ids = []; } },
        ],
      },
    ],
  },
};

/* ---------- Pinterest ---------- */
const pinMemo = new Map(); // widget id -> last pins, so a settings change redraws instantly

Object.assign(WIDGET_TYPES, extraWidgets);

WIDGET_TYPES.pinterest = {
  name: 'Pinterest',
  description: 'Fresh pins from boards or accounts you pick.',
  icon: ICONS.pin,
  theme: {}, // its own look ("Default"): white
  size: '4x4',
  create: () => ({ source: 'links', links: [], count: 6, layout: 'grid', every: 60, titles: false }),
  mount(body, w, api) {
    const d = w.data;
    body.innerHTML = '<div class="pn-box"></div>';
    const box = body.querySelector('.pn-box');
    let pins = pinMemo.get(w.id) || [];
    let slide = 0;
    let note = '';

    const message = (text, action) => {
      box.innerHTML = `<div class="pn-msg">${action ? `<span class="pn-logo">${ICONS.pin}</span>` : ''}<p></p>${action ? '<button type="button"></button>' : ''}</div>`;
      box.querySelector('p').textContent = text;
      if (action) { const b = box.querySelector('button'); b.textContent = action; b.addEventListener('click', () => api.connect?.()); }
    };

    function draw() {
      if (!pins.length) return;
      const layout = d.layout || 'grid';
      const room = w.size === '2x2' ? 1 : w.size === '2x4' ? 2 : w.size === '4x2' ? 3 : w.size === '6x4' ? 10 : 6;
      const cols = w.size === '2x2' || w.size === '2x4' ? 1 : w.size === '6x4' ? 5 : 3;
      const shown = layout === 'grid' ? pins.slice(0, room) : [pins[slide % pins.length]];
      box.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = `pn-${layout === 'grid' ? 'grid' : 'one'}` + (d.titles ? ' titles' : '') + (d.showSource ? ' sources' : '');
      if (layout === 'grid') wrap.style.setProperty('--cols', String(cols));
      for (const p of shown) {
        const a = document.createElement('a');
        a.className = 'pn-pin';
        a.href = p.link;
        a.title = p.title || 'Open on Pinterest';
        a.innerHTML = '<img alt="" loading="lazy" referrerpolicy="no-referrer"><span class="pn-cap"><b></b><small></small></span>';
        a.querySelector('img').src = p.img;
        a.querySelector('img').alt = p.title || '';
        a.querySelector('b').textContent = p.title || '';
        a.querySelector('small').textContent = `${p.source} · ${ago(p.date)}`;
        wrap.append(a);
      }
      box.append(wrap);
      if (layout !== 'grid' && pins.length > 1) {
        const nav = document.createElement('div');
        nav.className = 'pn-nav';
        nav.innerHTML = `<button type="button" aria-label="Previous pin">${ICONS.up}</button><span>${(slide % pins.length) + 1} / ${pins.length}</span><button type="button" aria-label="Next pin">${ICONS.up}</button>`;
        const [prev, next] = nav.querySelectorAll('button');
        prev.addEventListener('click', () => { slide = (slide - 1 + pins.length) % pins.length; draw(); });
        next.addEventListener('click', () => { slide = (slide + 1) % pins.length; draw(); });
        box.append(nav);
      }
      if (note) { const n = document.createElement('p'); n.className = 'pn-note'; n.textContent = note; box.append(n); }
      api.setCount(pins[0]?.date ? `new ${ago(pins[0].date)}` : '');
    }

    async function load(force = false) {
      let feeds;
      if (d.source === 'account') {
        if (!(await P.isSignedIn())) return message('Sign in to Pinterest to see new pins from people you follow.', 'Connect Pinterest');
        try { feeds = await P.accountFeeds({ force }); } catch (e) { return message(e.message || 'Couldn’t reach Pinterest.', 'Settings'); }
        if (!feeds.length) return message('You don’t follow anyone on Pinterest yet, so there are no new pins to show.');
      } else {
        feeds = (d.links || []).map(P.toFeed).filter(Boolean);
        if (!feeds.length) return message('Fresh pins from the boards and people you like.', 'Connect Pinterest');
      }
      if (!pins.length) box.innerHTML = `<div class="pn-grid loading" style="--cols:3">${'<span class="pn-pin"></span>'.repeat(6)}</div>`;
      const { pins: got, failed } = await P.loadPins(feeds, { max: 24, force });
      if (!body.isConnected) return;
      note = failed.length && got.length ? `Couldn’t load ${failed.join(', ')}` : '';
      if (!got.length) return message(failed.length ? 'Couldn’t load those pins. Check the links in settings, or try again later.' : 'No pins yet.', 'Settings');
      pins = got;
      pinMemo.set(w.id, pins);
      draw();
    }

    const force = !!w._force; // "Refresh now" in settings
    delete w._force;
    if (pins.length) draw();
    load(force);
    const every = Math.max(15, d.every || 60) * 60 * 1000;
    const timer = setInterval(() => { if (!body.isConnected) return clearInterval(timer); load(); }, every);
    // Slideshow: next pin every 8 seconds, paused while the pointer is on it.
    const tick = setInterval(() => {
      if (!body.isConnected) return clearInterval(tick);
      if (d.layout === 'slides' && pins.length > 1 && !body.matches(':hover')) { slide = (slide + 1) % pins.length; draw(); }
    }, 8000);
  },
  chips: (w) => [
    { label: 'Titles', title: 'Always show pin titles (otherwise on hover)', get: () => !!w.data.titles, set: (v) => { w.data.titles = v; } },
    { label: 'Source', title: 'Which account or board each pin is from', get: () => !!w.data.showSource, set: (v) => { w.data.showSource = v; } },
  ],
  // Right-click → Edit, or the button in the widget.
  connect: {
    title: 'Connect Pinterest',
    render(box, w, { changed, redraw, close }) {
      const d = w.data;
      const acct = d.source === 'account';
      box.innerHTML = `
        <div class="wcn-tabs" role="tablist">
          <button type="button" role="tab" data-src="links" aria-selected="${!acct}">Boards &amp; people</button>
          <button type="button" role="tab" data-src="account" aria-selected="${acct}">My account</button>
        </div>
        ${acct
          ? '<ol class="wcn-steps"><li>Sign in with a Pinterest developer app (advanced).</li><li>New pins from everyone you follow show up here.</li></ol>'
          : '<ol class="wcn-steps"><li>Open a Pinterest profile or board you like.</li><li>Copy its address from the address bar, or just type <b>@name</b>.</li><li>Paste it below and press Enter. Add as many as you like.</li></ol>'}
        <div class="wcn-editor"></div>
        <div class="wcn-actions"><span></span><button type="button" class="btn primary wcn-done">Done</button></div>`;
      box.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.src === (d.source || 'links')) return;
        d.source = b.dataset.src; changed(); redraw();
      }));
      (acct ? accountEditor : linkEditor)(box.querySelector('.wcn-editor'), w, changed, redraw);
      box.querySelector('.wcn-done').addEventListener('click', close);
      setTimeout(() => box.querySelector('.wcn-editor input')?.focus(), 50);
    },
  },
  settings: (w) => [
    { label: 'Layout', hint: 'The widget size decides how many pins fit', choice: [['grid', 'Grid'], ['one', 'One'], ['slides', 'Slides']], get: () => w.data.layout || 'grid', set: (v) => { w.data.layout = v; } },
    { label: 'Check for new pins', choice: [['30', '30m'], ['60', '1h'], ['180', '3h']], get: () => String(w.data.every || 60), set: (v) => { w.data.every = +v; } },
    { actions: [{ label: 'Refresh now', run: () => { pinMemo.delete(w.id); w._force = true; } }] },
  ],
};

function ago(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days < 60 ? `${days}d ago` : new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// Links mode: paste profiles or boards.
function linkEditor(box, w, changed) {
  const d = w.data;
  box.className = 'pn-edit';
  const draw = (err = '') => {
    box.innerHTML = '';
    (d.links || []).forEach((l, i) => {
      const f = P.toFeed(l);
      const row = document.createElement('div');
      row.className = 'pn-edit-row';
      row.innerHTML = `<span></span><button type="button" class="wc-edit-btn" title="Remove">${ICONS.x}</button>`;
      row.querySelector('span').textContent = f?.label || l;
      row.querySelector('button').setAttribute('aria-label', `Remove ${f?.label || l}`);
      row.querySelector('button').addEventListener('click', () => { d.links.splice(i, 1); changed(); draw(); });
      box.append(row);
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'w-input';
    input.placeholder = 'Paste a profile or board link, or @name';
    input.setAttribute('aria-label', 'Add a Pinterest account or board');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const f = P.toFeed(input.value);
      if (!f) return draw('That doesn’t look like a Pinterest profile or board link.');
      d.links = d.links || [];
      if (d.links.some((x) => P.toFeed(x)?.feed === f.feed)) return draw('Already added.');
      d.links.push(input.value.trim());
      changed(); draw();
      box.querySelector('input')?.focus();
    });
    box.append(input);
    const hint = document.createElement('p');
    hint.className = 'pn-hint' + (err ? ' err' : '');
    hint.textContent = err || 'Press Enter to add. Works with any public account or board, no sign-in needed.';
    box.append(hint);
    if (err) input.focus();
  };
  draw();
}

// Account mode: sign in with your own Pinterest developer app.
async function accountEditor(box, w, changed, redraw) {
  box.className = 'pn-edit';
  box.innerHTML = '<p class="pn-hint">Loading…</p>';
  const auth = await P.getAuth();
  box.innerHTML = '';
  if (!P.canSignIn()) {
    box.innerHTML = '<p class="pn-hint">Sign-in works when BetterTab runs as a Chrome extension.</p>';
    return;
  }
  if (auth.token) {
    let n = '';
    try { n = `Following ${(await P.followingFeeds()).length} accounts and boards.`; } catch (e) { n = e.message; }
    box.innerHTML = '<p class="pn-hint pn-who"></p><div class="w-actions-inline"></div>';
    box.querySelector('.pn-who').textContent = `Signed in as @${auth.username || 'you'}. ${n}`;
    const acts = box.querySelector('.w-actions-inline');
    const btn = (label, fn, danger) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'w-menu-btn' + (danger ? ' danger' : '');
      b.textContent = label;
      b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { redraw(); changed(); } });
      acts.append(b);
    };
    btn('Update who I follow', () => P.followingFeeds({ force: true }));
    btn('Sign out', () => P.signOut(), true);
    return;
  }
  box.innerHTML = `
    <p class="pn-hint">Pinterest only lets apps sign in through your own free developer app:<br>
      1. Create an app at <a href="https://developers.pinterest.com/apps/" target="_blank" rel="noopener">developers.pinterest.com</a><br>
      2. Add this redirect URL to it:</p>
    <div class="pn-copy"><input type="text" class="w-input" readonly aria-label="Redirect URL"><button type="button" class="w-menu-btn">Copy</button></div>
    <p class="pn-hint">3. Paste its App ID and App secret here:</p>
    <input type="text" class="w-input pn-id" placeholder="App ID" autocomplete="off" spellcheck="false">
    <input type="password" class="w-input pn-secret" placeholder="App secret" autocomplete="off">
    <button type="button" class="w-menu-btn pn-connect">Sign in to Pinterest</button>
    <p class="pn-hint err" hidden></p>`;
  const url = box.querySelector('.pn-copy input');
  url.value = P.redirectUrl();
  box.querySelector('.pn-copy button').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(url.value); e.target.textContent = 'Copied'; } catch { url.select(); }
  });
  box.querySelector('.pn-id').value = auth.appId || '';
  box.querySelector('.pn-secret').value = auth.secret || '';
  const err = box.querySelector('.err');
  const go = box.querySelector('.pn-connect');
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Waiting for Pinterest…';
    err.hidden = true;
    try {
      await P.signIn(box.querySelector('.pn-id').value, box.querySelector('.pn-secret').value);
      redraw(); changed();
    } catch (e) {
      err.textContent = e.message || 'Sign-in didn’t work.';
      err.hidden = false;
      go.disabled = false;
      go.textContent = 'Sign in to Pinterest';
    }
  });
}

/* ---------------- world clock helpers ---------------- */

// Older versions kept plain time zones and "hideDiff".
function migrateClock(d) {
  if (d.zones) { d.clocks = d.zones.map((tz) => ({ tz })); delete d.zones; }
  if (d.hideDiff) { d.diff = false; delete d.hideDiff; }
  d.clocks = d.clocks || [];
  return d;
}
const cityOf = (tz) => CITIES.find((c) => c[1] === tz)?.[0] || tz.split('/').pop().replace(/_/g, ' ');

// The city list inside the world clock's settings: rename, reorder, remove, add.
function cityEditor(box, d, changed) {
  box.className = 'wc-edit';
  const draw = () => {
    box.innerHTML = '';
    d.clocks.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'wc-edit-row';
      row.innerHTML = `<input type="text" maxlength="24"><button type="button" class="wc-edit-btn" title="Move up">${ICONS.up}</button><button type="button" class="wc-edit-btn" title="Remove">${ICONS.x}</button>`;
      const [up, rm] = row.querySelectorAll('button');
      const input = row.querySelector('input');
      input.value = c.label || '';
      input.placeholder = cityOf(c.tz);
      input.setAttribute('aria-label', `Label for ${cityOf(c.tz)}`);
      input.addEventListener('change', () => { c.label = input.value.trim() || undefined; changed(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      up.setAttribute('aria-label', `Move ${cityOf(c.tz)} up`);
      rm.setAttribute('aria-label', `Remove ${cityOf(c.tz)}`);
      up.disabled = i === 0;
      up.addEventListener('click', () => { [d.clocks[i - 1], d.clocks[i]] = [d.clocks[i], d.clocks[i - 1]]; changed(); draw(); });
      rm.addEventListener('click', () => { d.clocks.splice(i, 1); changed(); draw(); });
      box.append(row);
    });
    if (d.clocks.length < MAX_CITIES) {
      const wrap = document.createElement('div');
      wrap.className = 'wc-search';
      wrap.innerHTML = `<input type="search" class="w-input" placeholder="Search a city or time zone (${d.clocks.length} of ${MAX_CITIES})" aria-label="Search for a city to add" autocomplete="off" spellcheck="false"><div class="wc-results" role="listbox" hidden></div>`;
      const q = wrap.querySelector('input');
      const res = wrap.querySelector('.wc-results');
      let found = [];
      const pickCity = (tz) => { d.clocks.push({ tz }); changed(); draw(); box.querySelector('.wc-search input')?.focus(); };
      const show = () => {
        found = findCities(q.value, d.clocks.map((c) => c.tz));
        res.hidden = !q.value.trim();
        res.innerHTML = found.length ? '' : '<div class="wc-none">No match. Try a bigger city nearby.</div>';
        const now = new Date();
        found.forEach(([name, tz], i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wc-result' + (i === 0 ? ' sel' : '');
          b.setAttribute('role', 'option');
          b.innerHTML = '<span class="wc-r-name"></span><span class="wc-r-sub"></span>';
          b.firstChild.textContent = name;
          b.lastChild.textContent = `${tz.split('/')[0].replace(/_/g, ' ')} · ${now.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`;
          b.addEventListener('click', () => pickCity(tz));
          res.append(b);
        });
      };
      q.addEventListener('input', show);
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && found[0]) { e.preventDefault(); pickCity(found[0][1]); }
        if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; show(); }
      });
      box.append(wrap);
    } else {
      box.insertAdjacentHTML('beforeend', `<p class="wc-edit-note">That's the most: ${MAX_CITIES} cities. Remove one to add another.</p>`);
    }
  };
  draw();
}


// [city, IANA time zone]
const CITIES = [
  ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Los Angeles', 'America/Los_Angeles'],
  ['Vancouver', 'America/Vancouver'], ['Denver', 'America/Denver'], ['Mexico City', 'America/Mexico_City'],
  ['Chicago', 'America/Chicago'], ['Toronto', 'America/Toronto'], ['New York', 'America/New_York'],
  ['Bogotá', 'America/Bogota'], ['São Paulo', 'America/Sao_Paulo'], ['Buenos Aires', 'America/Argentina/Buenos_Aires'],
  ['Reykjavík', 'Atlantic/Reykjavik'], ['London', 'Europe/London'], ['Lisbon', 'Europe/Lisbon'], ['Lagos', 'Africa/Lagos'],
  ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'], ['Amsterdam', 'Europe/Amsterdam'], ['Madrid', 'Europe/Madrid'],
  ['Rome', 'Europe/Rome'], ['Stockholm', 'Europe/Stockholm'], ['Cairo', 'Africa/Cairo'], ['Johannesburg', 'Africa/Johannesburg'],
  ['Athens', 'Europe/Athens'], ['Istanbul', 'Europe/Istanbul'], ['Moscow', 'Europe/Moscow'], ['Nairobi', 'Africa/Nairobi'],
  ['Riyadh', 'Asia/Riyadh'], ['Dubai', 'Asia/Dubai'], ['Karachi', 'Asia/Karachi'], ['Delhi', 'Asia/Kolkata'],
  ['Kathmandu', 'Asia/Kathmandu'], ['Dhaka', 'Asia/Dhaka'], ['Bangkok', 'Asia/Bangkok'], ['Jakarta', 'Asia/Jakarta'],
  ['Singapore', 'Asia/Singapore'], ['Hong Kong', 'Asia/Hong_Kong'], ['Shanghai', 'Asia/Shanghai'], ['Manila', 'Asia/Manila'],
  ['Seoul', 'Asia/Seoul'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'],
  ['Auckland', 'Pacific/Auckland'],
];

// Every city the browser knows a time zone for, plus the friendlier names in CITIES.
let ALL_ZONES = null;
function zoneList() {
  if (!ALL_ZONES) {
    const seen = new Set(CITIES.map((c) => c[1]));
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browser */ }
    ALL_ZONES = [...CITIES, ...zones.filter((tz) => tz.includes('/') && !seen.has(tz)).map((tz) => [tz.split('/').pop().replace(/_/g, ' '), tz])];
  }
  return ALL_ZONES;
}
function findCities(text, taken) {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const score = ([name, tz]) => {
    const n = name.toLowerCase(), z = tz.toLowerCase().replace(/_/g, ' ');
    if (n === q) return 4;
    if (n.startsWith(q)) return 3;
    if (n.split(/[\s-]/).some((x) => x.startsWith(q))) return 2;
    return z.includes(q) ? 1 : 0;
  };
  return zoneList().filter((c) => !taken.includes(c[1])).map((c) => [c, score(c)]).filter((x) => x[1] > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
}

// Minutes ahead of UTC in a time zone right now.
function offsetMin(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(date).map((x) => [x.type, +x.value]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - date.getTime()) / 60000);
}
// -1, 0 or 1: the zone's calendar day compared with here.
function dayDiff(date, tz) {
  const ymd = (o) => new Intl.DateTimeFormat('en-CA', { ...o, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const a = ymd({ timeZone: tz }), b = ymd({});
  return a === b ? 0 : a > b ? 1 : -1;
}
function fmtHrs(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ---------------- layer ---------------- */

export function createWidgetLayer({ layer, getList, save, getBounds, getSettings, apps, modes }) {
  // The area widgets may occupy: below the mode switcher, above the cards and bar.
  const bounds = () => (getBounds ? getBounds() : { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 });
  function clampTo(x, y, w, h) {
    const b = bounds();
    return {
      x: Math.min(Math.max(b.left, x), Math.max(b.left, b.right - w)),
      y: Math.min(Math.max(b.top, y), Math.max(b.top, b.bottom - h)),
    };
  }
  layer.innerHTML = '<div class="w-free"></div><div class="w-zone"></div>';
  const free = layer.querySelector('.w-free');
  const mounted = new Map(); // id -> element

  /* ---------- the grid ---------- */
  const gridOn = () => !getSettings?.()?.widgetsFree;
  const cellsOf = (w, size = w.size) => CELLS[size] || CELLS['4x2'];
  const cellsEl = document.createElement('div');
  cellsEl.className = 'w-grid';
  const slot = document.createElement('div');
  slot.className = 'w-slot';
  free.before(cellsEl, slot); // under the widgets
  let gridKey = '';
  // The grid is sized for the whole screen, not the window, so widgets keep their size and spot
  // when the window is resized. A narrower window shows part of it (scroll sideways for the rest);
  // a shorter one cuts it off above the bar. Both cut edges fade out.
  let scrollX = 0;
  let view = { left: 0, right: innerWidth, bottom: innerHeight, maxX: 0 };
  const hbar = document.createElement('div');
  hbar.className = 'w-hbar';
  hbar.innerHTML = '<span></span>';
  layer.append(hbar);
  function grid() {
    const b = bounds();
    const viewW = b.right - b.left;
    const chrome = Math.max(0, outerHeight - innerHeight);
    const fullW = Math.max(innerWidth, screen.availWidth || innerWidth);
    const fullH = Math.max(innerHeight, (screen.availHeight || innerHeight) - chrome);
    const width = viewW + (fullW - innerWidth);
    const height = (b.bottom - b.top) + (fullH - innerHeight);
    // Start from a 2×2 about a fifth of the screen tall, then grow the cells a little
    // so the columns fill the full width exactly, edge to edge with the top buttons.
    const small = Math.min(212, Math.max(150, fullH * 0.2));
    const ratio = 2 / 9; // gap ÷ cell, so the gap is a tenth of a 2×2
    const fitAcross = Math.max(2, Math.floor((width / (small * 0.45) + ratio) / (1 + ratio)));
    const fullUnit = width / (fitAcross + (fitAcross - 1) * ratio);
    const fullPitch = fullUnit * (1 + ratio);
    // Never smaller than the widgets already placed (e.g. after moving to a smaller screen),
    // so nothing is pushed on top of anything else; the extra just scrolls.
    let needX = 0, needY = 0;
    if (gridOn()) for (const x of getList()) {
      if (x.gx == null) continue;
      const [cw, ch] = cellsOf(x);
      needX = Math.max(needX, x.gx + cw); needY = Math.max(needY, x.gy + ch);
    }
    const across = Math.max(fitAcross, Math.min(needX, fitAcross * 2));
    const down = Math.max(2, Math.floor((height + fullUnit * ratio) / fullPitch), needY);
    // A smaller window shrinks the whole grid to fit, both ways, keeping every widget's spot.
    // Only once a 2×2 would drop below ~140px does it stop shrinking and get cut off instead.
    const fitW = viewW / (across + (across - 1) * ratio);
    const fitH = (b.bottom - b.top) / (down + (down - 1) * ratio);
    const MIN = 140 / (2 + ratio);
    const unit = Math.max(Math.min(fullUnit, fitW, fitH), Math.min(fullUnit, MIN));
    const gap = unit * ratio;
    layer.style.setProperty('--wu', unit + 'px');
    layer.style.setProperty('--wg', gap + 'px');
    const pitch = unit + gap;
    const canvasW = across * pitch - gap;
    const maxX = canvasW - viewW > 1 ? Math.round(canvasW - viewW) : 0;
    scrollX = Math.min(Math.max(0, scrollX), maxX);
    // A short window can leave the shrunken grid narrower than the window: keep it centred.
    const left = b.left - scrollX + Math.max(0, (viewW - canvasW) / 2);
    // When it scrolls sideways, the widgets end a little higher to make room for the scrollbar.
    view = { left: b.left, right: b.right, bottom: b.bottom - (maxX > 0 ? 24 : 0), maxX, canvasW, viewW };
    const g = { across, down, left, top: b.top, pitch, unit, gap };
    const key = `${across}:${down}:${left}:${b.top}:${pitch}`;
    if (key !== gridKey) {
      gridKey = key;
      cellsEl.style.cssText = `left:${left}px;top:${b.top}px;grid-template-columns:repeat(${across},${unit}px);grid-auto-rows:${unit}px;gap:${gap}px`;
      cellsEl.innerHTML = '<span></span>'.repeat(across * down);
      Object.assign(layer.querySelector('.w-zone').style, {
        left: b.left + 'px', top: b.top + 'px', width: viewW + 'px', height: (b.bottom - b.top) + 'px',
      });
    }
    paintScrollbar();
    return g;
  }

  // Fade a widget where the window cuts it: the left/right window edges and the bottom of the
  // widget area. Each widget gets its own mask, so its frosted glass keeps working.
  const FADE = 44;
  function cutEdges() {
    const grid = gridOn();
    for (const el of mounted.values()) {
      if (!grid || el.classList.contains('dragging')) { el.style.maskImage = el.style.webkitMaskImage = ''; continue; }
      const r = el.getBoundingClientRect();
      const fadeL = view.maxX > 0 && scrollX > 0 && r.left < FADE;
      const fadeR = view.maxX > 0 && scrollX < view.maxX && r.right > innerWidth - FADE;
      const fadeB = r.bottom > view.bottom + 1;
      if (!fadeL && !fadeR && !fadeB) { el.style.maskImage = el.style.webkitMaskImage = ''; continue; }
      // The mask reaches PAD px past the widget on every side, so its shadow isn't cut away.
      const PAD = 70, ox = r.left - PAD, oy = r.top - PAD;
      const x0 = fadeL ? `transparent ${-ox}px, #000 ${FADE - ox}px` : '#000 0';
      const x1 = fadeR ? `#000 ${innerWidth - FADE - ox}px, transparent ${innerWidth - ox}px` : '#000 100%';
      const yEnd = view.bottom - oy;
      const y = fadeB ? `#000 ${yEnd - FADE}px, transparent ${yEnd}px` : '#000 100%';
      const m = `linear-gradient(to right, ${x0}, ${x1}), linear-gradient(to bottom, #000 0, ${y})`;
      el.style.maskImage = el.style.webkitMaskImage = m;
      el.style.maskSize = el.style.webkitMaskSize = `calc(100% + ${PAD * 2}px) calc(100% + ${PAD * 2}px)`;
      el.style.maskPosition = el.style.webkitMaskPosition = `${-PAD}px ${-PAD}px`;
      el.style.maskRepeat = el.style.webkitMaskRepeat = 'no-repeat';
      el.style.maskClip = 'no-clip';
      el.style.maskComposite = 'intersect';
      el.style.webkitMaskComposite = 'source-in';
    }
  }

  // Sideways scrolling when the window is narrower than the widget grid:
  // trackpad swipe, Shift + mouse wheel, or the thin bar under the widgets.
  function paintScrollbar() {
    const on = gridOn() && view.maxX > 0;
    hbar.hidden = !on;
    if (!on) return;
    // A short bar, centred under the widgets with some room around it.
    const barW = Math.min(220, Math.max(90, view.viewW * 0.3));
    hbar.style.left = (view.left + (view.viewW - barW) / 2) + 'px';
    hbar.style.width = barW + 'px';
    hbar.style.top = (view.bottom + 5) + 'px';
    const tw = Math.max(28, barW * (view.viewW / view.canvasW));
    const thumb = hbar.firstElementChild;
    thumb.style.width = tw + 'px';
    thumb.style.transform = `translateX(${(barW - tw) * (scrollX / view.maxX)}px)`;
  }
  function scrollTo(x) {
    const next = Math.min(Math.max(0, x), view.maxX);
    if (next === scrollX) return;
    scrollX = next;
    render();
    hbar.classList.add('active');
    clearTimeout(hbar.t);
    hbar.t = setTimeout(() => hbar.classList.remove('active'), 900);
  }
  addEventListener('wheel', (e) => {
    if (!gridOn() || view.maxX <= 0 || layer.classList.contains('hidden-widgets')) return;
    const b = bounds();
    if (e.clientY < b.top || e.clientY > view.bottom + 20) return;
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    // a widget that scrolls sideways itself keeps the wheel
    for (let n = e.target; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return;
    }
    e.preventDefault();
    scrollTo(scrollX + dx);
  }, { passive: false });
  hbar.addEventListener('pointerdown', (e) => {
    const thumb = hbar.firstElementChild;
    const x0 = e.clientX, s0 = scrollX;
    const per = view.maxX / Math.max(1, hbar.offsetWidth - thumb.offsetWidth);
    if (e.target !== thumb) { // click the track: jump there
      const r = hbar.getBoundingClientRect();
      scrollTo(((e.clientX - r.left - thumb.offsetWidth / 2) / Math.max(1, r.width - thumb.offsetWidth)) * view.maxX);
      return;
    }
    e.preventDefault();
    const move = (ev) => scrollTo(s0 + (ev.clientX - x0) * per);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  function takenBy(list, except) {
    const set = new Set();
    for (const x of list) {
      if (x === except || x.gx == null) continue;
      const [cw, ch] = cellsOf(x);
      for (let i = 0; i < cw; i++) for (let j = 0; j < ch; j++) set.add(`${x.gx + i},${x.gy + j}`);
    }
    return set;
  }
  function fitsAt(g, taken, x, y, cw, ch) {
    if (x < 0 || y < 0 || x + cw > g.across || y + ch > g.down) return false;
    for (let i = 0; i < cw; i++) for (let j = 0; j < ch; j++) if (taken.has(`${x + i},${y + j}`)) return false;
    return true;
  }
  // The free spot closest to (x, y), or null when the widget fits nowhere.
  function nearestSpot(g, taken, x, y, cw, ch) {
    let best = null, bestD = Infinity;
    for (let gy = 0; gy + ch <= g.down; gy++) {
      for (let gx = 0; gx + cw <= g.across; gx++) {
        const d = (gx - x) ** 2 + (gy - y) ** 2;
        if (d < bestD && fitsAt(g, taken, gx, gy, cw, ch)) { best = { x: gx, y: gy }; bestD = d; }
      }
    }
    return best;
  }
  // Where a widget wants to be: its cell, or for older layouts, near its old edge or spot.
  function wantOf(g, w, cw) {
    if (w.gx != null) return { x: w.gx, y: w.gy };
    if (w.dock === 'left') return { x: 0, y: 0 };
    if (w.dock === 'right') return { x: g.across - cw, y: 0 };
    return { x: Math.round(((w.x ?? 0.7) * innerWidth - g.left) / g.pitch), y: Math.round(((w.y ?? 0.2) * innerHeight - g.top) / g.pitch) };
  }
  function spotFor(g, w, size = w.size) {
    const [cw, ch] = cellsOf(w, size);
    const taken = takenBy(getList(), w);
    const want = wantOf(g, w, cw);
    return fitsAt(g, taken, want.x, want.y, cw, ch) ? want : nearestSpot(g, taken, want.x, want.y, cw, ch);
  }
  const cellPx = (g, p) => ({ x: g.left + p.x * g.pitch, y: g.top + p.y * g.pitch });
  // App folder: how many apps fit, and the next size up when it's full.
  const FOLDER_SIZES = ['2x2', '4x2', '4x4'];
  const folderCols = (size) => (size === '6x4' ? 6 : size === '2x2' || size === '2x4' ? 2 : 4);
  const folderRows = (size) => (size === '2x2' || size === '4x2' ? 2 : 4);
  const folderCap = (size) => folderCols(size) * folderRows(size);
  // Grow the folder until it can hold n apps. False when the page has no room.
  function fitFolder(w, n) {
    while (folderCap(w.size) < n) {
      const i = FOLDER_SIZES.indexOf(w.size === '2x4' ? '4x2' : w.size); // tall grows to 4x4 next
      if (i < 0 || i >= FOLDER_SIZES.length - 1) { showNoRoom(); return false; }
      if (!resizeTo(w, FOLDER_SIZES[i + 1])) return false;
    }
    return true;
  }

  // Size changes from the gear menu. False when the bigger size has no room.
  function resizeTo(w, size) {
    if (!gridOn()) { w.size = size; return true; }
    const g = grid();
    const p = spotFor(g, w, size);
    if (!p) { showNoRoom(); return false; }
    w.size = size; w.gx = p.x; w.gy = p.y;
    return true;
  }

  function build(w) {
    const type = WIDGET_TYPES[w.type];
    const el = document.createElement('section');
    applySize(w);
    const look = lookOf(w);
    el.className = `widget type-${w.type} size-${w.size}`
      + (nameShown(w) ? '' : ' no-name')
      + (look === 'own' ? ' theme-own' : look !== 'glass' ? ' bg-' + look : '');
    el.dataset.id = w.id;
    // Every widget gets this same header: icon, name, count. Settings open from the right-click menu.
    el.innerHTML = `<header class="w-head" title="Drag to move · Right-click for settings"><span class="w-icon">${type.icon}</span><span class="w-name"></span><span class="w-count"></span></header><div class="w-body"></div>`;
    el.querySelector('.w-name').textContent = w.data.title || type.name;
    const count = el.querySelector('.w-count');
    type.mount(el.querySelector('.w-body'), w, {
      save, settings: getSettings, apps,
      setCount: (t) => { count.textContent = t; },
      openSettings: () => openConnect(w), // empty states ('Choose cities' etc.) open Edit
      folderCap, folderCols, folderRows, fitFolder: (n) => fitFolder(w, n),
      openPicker: (at) => openPicker(w, at),
      refresh: () => refresh(w),
      connect: () => openConnect(w),
      // 'Edit' from inside a widget (e.g. an empty world clock's 'Choose cities')
    });
    enableDrag(el, w);
    return el;
  }

  async function remove(w) {
    const hasData = w.type === 'todo' && w.data.items?.length;
    if (hasData && !(await uiConfirm({ title: 'Remove this widget?', message: 'Its tasks are removed too.', confirmLabel: 'Remove', danger: true }))) return;
    const list = getList();
    list.splice(list.indexOf(w), 1);
    save(); render();
  }

  // Redraw one widget after a setting changed, keeping its place.
  function refresh(w) {
    const old = mounted.get(w.id);
    if (!old) return;
    const el = build(w);
    old.replaceWith(el);
    mounted.set(w.id, el);
    if (gridOn()) render();
    else if (w.dock === 'free') { el.classList.add('free'); place(el, w); }
    if (menuFor === w) { el.classList.add('w-editing'); placeMenu(w); }
  }

  /* ---------- settings menu (one, shared by every widget) ---------- */
  const menu = document.createElement('div');
  menu.className = 'menu w-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Widget settings');
  menu.hidden = true;
  document.body.append(menu);
  let menuFor = null;
  /* ---------- Edit (what the widget shows) and Settings… (how it looks) ---------- */
  // Both open beside the widget. Edit is wider when it needs to be (connecting a calendar, Pinterest).
  // A type with `connect: { title, render(box, w, { done, close, changed, redraw }) }` shows that first in Edit.
  let menuMode = 'settings';
  const canEdit = (type) => !!(type?.connect || type?.settings || type?.editFocus);
  function openConnect(w, at = null) {
    const type = WIDGET_TYPES[w.type];
    // Nothing to set: Edit just puts you in the widget (e.g. a sticky note's text).
    if (!type?.connect && !type?.settings) {
      closeMenu();
      mounted.get(w.id)?.querySelector(type?.editFocus || 'textarea, input')?.focus();
      return;
    }
    openMenu(w, at, 'edit');
  }

  function closeMenu() {
    if (menu.hidden) return;
    mounted.get(menuFor?.id)?.classList.remove('w-editing');
    menu.hidden = true;
    menuFor = null;
  }
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  function openMenu(w, at = null, mode = 'settings') {
    closeMenu();
    menuMode = mode;
    menu.classList.toggle('w-menu-edit', mode === 'edit' && !!WIDGET_TYPES[w.type]?.connect);
    menuFor = w;
    mounted.get(w.id)?.classList.add('w-editing');
    drawMenu(w);
    menu.hidden = false;
    placeMenu(w, at);
    menu.querySelector('input, button:not(:disabled), select')?.focus({ preventScroll: true });
  }

  // Beside the widget (the side with more room) so changes stay visible while you make them.
  function placeMenu(w, at = null, box = menu) {
    const el = mounted.get(w.id);
    const mw = box.offsetWidth, mh = box.offsetHeight, gap = 12;
    const clampTop = (t) => Math.max(8, Math.min(t, innerHeight - mh - 8));
    const r = el?.getBoundingClientRect();
    if (r?.width) {
      const roomR = innerWidth - r.right - gap - 8, roomL = r.left - gap - 8;
      if (roomR >= mw || roomL >= mw) {
        box.style.left = (roomR >= roomL ? r.right + gap : r.left - gap - mw) + 'px';
        box.style.top = clampTop(r.top) + 'px';
        return;
      }
      const left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
      if (innerHeight - r.bottom - gap - 8 >= mh) { box.style.left = left; box.style.top = r.bottom + gap + 'px'; return; }
      if (r.top - gap - 8 >= mh) { box.style.left = left; box.style.top = r.top - gap - mh + 'px'; return; }
    }
    // No room around it: at the pointer, or over the widget's corner.
    const x = at?.clientX ?? r?.right ?? innerWidth / 2;
    const y = at?.clientY ?? r?.top ?? 8;
    box.style.left = Math.max(8, Math.min(x - mw, innerWidth - mw - 8)) + 'px';
    box.style.top = clampTop(y) + 'px';
  }

  function drawMenu(w) {
    const type = WIDGET_TYPES[w.type];
    // The widget's own settings first, then how it looks. On/off things share one row of pills.
    const own = type.settings?.(w, { apps, openPicker: () => openPicker(w) }) || [];
    const sizes = sizesOf(w.type);
    if (menuMode === 'edit') return drawEdit(w, type, own);
    const rows = [
      ...(sizes.length > 1 ? [{
        label: 'Size', choice: sizes, redraw: true, get: () => w.size,
        ...(type.dynamicSize ? { hint: 'Grows by itself when it fills up' } : {}),
        set: (v) => {
          // A folder can't shrink below the apps in it.
          const n = (w.data.ids || []).length;
          if (type.dynamicSize && folderCap(v) < n) { showNoRoom(`That size holds ${folderCap(v)} apps. Take some out first.`); return; }
          resizeTo(w, v);
        },
      }] : []),
      { label: 'Theme', choice: themesOf(type), get: () => lookOf(w), set: (v) => { w.bg = v; } },
    ];
    const chips = [
      ...(type.chips?.(w) || []),
    ];
    if (chips.length) rows.push({ label: 'Show', chips });
    menu.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'w-menu-head';
    head.innerHTML = `<span class="w-menu-icon">${type.icon}</span><div class="w-menu-titles"><div class="w-menu-title"></div><div class="w-menu-kind"></div></div>`;
    head.querySelector('.w-menu-title').textContent = w.data.title || type.name;
    head.querySelector('.w-menu-kind').textContent = w.data.title && w.data.title !== type.name ? type.name : 'Widget settings';
    menu.append(head);
    for (const it of rows) menu.append(menuRow(w, it));
    const foot = menuRow(w, { actions: [{ label: 'Remove widget', danger: true, run: () => remove(w), keepClosed: true }] });
    foot.classList.add('w-menu-foot');
    menu.append(foot);
  }

  function drawEdit(w, type, own) {
    menu.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'w-menu-head';
    head.innerHTML = `<span class="w-menu-icon">${type.icon}</span><div class="w-menu-titles"><div class="w-menu-title"></div><div class="w-menu-kind">Edit</div></div>`;
    head.querySelector('.w-menu-title').textContent = type.connect?.title || w.data.title || type.name;
    menu.append(head);
    if (type.connect) {
      const box = document.createElement('div');
      box.className = 'wcn-body';
      menu.append(box);
      type.connect.render(box, w, {
        changed: () => { save(); refresh(w); },
        done: () => { save(); refresh(w); closeMenu(); },
        close: () => closeMenu(),
        redraw: () => { if (menuFor === w) { drawMenu(w); placeMenu(w); } },
      });
    }
    if (own.length && type.connect) menu.append(Object.assign(document.createElement('div'), { className: 'w-menu-section', textContent: 'More' }));
    for (const it of own) menu.append(menuRow(w, it));
  }

  /* ---------- App folder: "Add apps" popup (same look as the settings menu) ---------- */
  const picker = document.createElement('div');
  picker.className = 'menu w-menu fd-picker';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Add apps to the folder');
  picker.hidden = true;
  document.body.append(picker);
  let pickFor = null;
  function closePicker() {
    if (picker.hidden) return;
    mounted.get(pickFor?.id)?.classList.remove('w-editing');
    picker.hidden = true;
    pickFor = null;
  }
  document.addEventListener('pointerdown', (e) => { if (!picker.contains(e.target) && !e.target.closest?.('.fd-add')) closePicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

  function openPicker(w, at = null) {
    if (pickFor === w) return closePicker();
    closeMenu(); closePicker();
    pickFor = w;
    mounted.get(w.id)?.classList.add('w-editing');
    picker.innerHTML = `
      <div class="w-menu-head"><span class="w-menu-icon">${WIDGET_TYPES.folder.icon}</span><div class="w-menu-titles"><div class="w-menu-title">Add apps</div><div class="w-menu-kind"></div></div></div>
      <input type="search" class="w-input fd-find" placeholder="Search your apps" aria-label="Search your apps" autocomplete="off" spellcheck="false">
      <div class="fd-pick-list" role="listbox" aria-multiselectable="true"></div>
      <div class="s-row w-actions w-menu-foot"><button type="button" class="w-menu-btn fd-done">Done</button></div>`;
    picker.querySelector('.w-menu-kind').textContent = `to ${w.data.title || 'App folder'}`;
    const find = picker.querySelector('.fd-find');
    find.addEventListener('input', () => drawPicker(w));
    picker.querySelector('.fd-done').addEventListener('click', closePicker);
    drawPicker(w);
    picker.hidden = false;
    placeMenu(w, at, picker);
    find.focus({ preventScroll: true });
  }

  // This folder's apps (ticked) first, then the rest of your apps, filtered by the search box.
  function drawPicker(w) {
    const list = picker.querySelector('.fd-pick-list');
    const q = picker.querySelector('.fd-find').value.trim().toLowerCase();
    const mine = (w.data.ids || []).filter((id) => apps.all().some((a) => a.id === id));
    const rows = [...mine.map((id) => apps.all().find((a) => a.id === id)), ...apps.all().filter((a) => !mine.includes(a.id))]
      .filter((a) => !q || a.name.toLowerCase().includes(q));
    list.innerHTML = rows.length ? '' : `<p class="fd-empty">${q ? 'No app matches that.' : 'No apps yet. Add some to the bar with + first.'}</p>`;
    for (const app of rows) {
      const on = mine.includes(app.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fd-pick-row';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(on));
      b.innerHTML = '<img alt="" draggable="false"><span></span><i class="fd-tick" aria-hidden="true"></i>';
      b.querySelector('img').src = apps.icon(app);
      b.querySelector('span').textContent = app.name;
      b.addEventListener('click', () => {
        const ids = w.data.ids = w.data.ids || [];
        const here = ids.filter((id) => apps.all().some((a) => a.id === id)).length;
        if (on) w.data.ids = ids.filter((id) => id !== app.id);
        else { if (!fitFolder(w, here + 1)) return; ids.push(app.id); }
        save(); apps.changed(); refresh(w);
        mounted.get(w.id)?.classList.add('w-editing');
        drawPicker(w);
        placeMenu(w, null, picker);
      });
      list.append(b);
    }
  }

  // Rows are built from the main Settings page's own pieces (s-row, s-title, s-hint, toggle, s-seg).
  function menuRow(w, it) {
    let hintEl = null;
    const commit = (v) => {
      it.set(v); save(); refresh(w);
      if (it.redraw) return drawMenu(w);
      if (hintEl && typeof it.hint === 'function') { hintEl.textContent = it.hint(); hintEl.hidden = !hintEl.textContent; }
    };
    const labelBlock = () => {
      const l = document.createElement('div');
      l.className = 's-label';
      l.innerHTML = '<div class="s-title"></div>';
      l.firstChild.textContent = it.label;
      const hint = typeof it.hint === 'function' ? it.hint() : it.hint;
      if (hint !== undefined) { hintEl = document.createElement('div'); hintEl.className = 's-hint'; hintEl.textContent = hint || ''; hintEl.hidden = !hint; l.append(hintEl); }
      if (it.title) l.title = it.title;
      return l;
    };
    if (it.note) {
      const p = document.createElement('p');
      p.className = 'w-menu-note';
      p.textContent = it.note;
      return p;
    }
    if (it.section) {
      const h = document.createElement('div');
      h.className = 'w-menu-section';
      h.textContent = it.section;
      return h;
    }
    if (it.custom) {
      const row = document.createElement('div');
      row.className = 's-row w-wrap w-custom';
      if (it.label) row.append(labelBlock());
      const box = document.createElement('div');
      it.custom(box, () => { save(); refresh(w); }, () => { if (menuFor === w) drawMenu(w); });
      box.classList.add('w-custom-box');
      row.append(box);
      return row;
    }
    if (it.chips) {
      const row = document.createElement('div');
      row.className = 's-row w-wrap';
      const box = document.createElement('div');
      box.className = 'w-chips';
      for (const c of it.chips) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-chip';
        b.textContent = c.label;
        if (c.title) b.title = c.title;
        b.setAttribute('aria-pressed', String(!!c.get()));
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          b.setAttribute('aria-pressed', String(on));
          it.set = (v) => c.set(v);
          commit(on);
        });
        box.append(b);
      }
      row.append(labelBlock(), box);
      return row;
    }
    if (it.actions) {
      const row = document.createElement('div');
      row.className = 's-row w-actions';
      for (const a of it.actions) row.append(menuRow(w, a));
      return row;
    }
    if (it.run) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'w-menu-btn' + (it.danger ? ' danger' : '');
      b.textContent = it.label;
      if (it.title) b.title = it.title;
      b.disabled = !!it.disabled?.();
      b.addEventListener('click', async () => {
        if (it.keepClosed) { closeMenu(); return it.run(); }
        await it.run();
        save(); refresh(w);
        if (menuFor === w) drawMenu(w);
      });
      return b;
    }
    const row = document.createElement(it.choice ? 'div' : 'label');
    row.className = 's-row';
    if (it.stepper) {
      // − value + : for numbers like minutes
      const { min = 0, max = 99, step = 1, unit = '', zero } = it.stepper;
      const row = document.createElement('div');
      row.className = 's-row';
      const box = document.createElement('div');
      box.className = 'w-stepper';
      box.innerHTML = '<button type="button" aria-label="Less">−</button><output></output><button type="button" aria-label="More">+</button>';
      const [less, more] = box.querySelectorAll('button');
      const out = box.querySelector('output');
      const show = () => {
        const v = it.get();
        out.textContent = v === 0 && zero ? zero : `${v} ${unit}`.trim();
        less.disabled = v <= min; more.disabled = v >= max;
      };
      const bump = (dir) => { const v = Math.min(max, Math.max(min, it.get() + dir * step)); if (v !== it.get()) { commit(v); show(); } };
      less.addEventListener('click', () => bump(-1));
      more.addEventListener('click', () => bump(1));
      show();
      row.append(labelBlock(), box);
      return row;
    }
    if (it.choice) {
      const seg = document.createElement('div');
      seg.className = 's-seg';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', it.label);
      const cur = it.get();
      for (const [value, label] of it.choice) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(value === cur));
        b.textContent = label;
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
          commit(value);
        });
        seg.append(b);
      }
      if (it.choice.reduce((n, c) => n + c[1].length, 0) > 14) row.classList.add('w-wrap'); // long options go under the label
      row.append(labelBlock(), seg);
      return row;
    }
    const input = document.createElement('input');
    if (it.text) {
      row.classList.add('w-wrap');
      input.type = 'text';
      input.className = 'w-input';
      input.maxLength = it.max || 40;
      input.value = it.get() || '';
      input.placeholder = it.placeholder || '';
      input.addEventListener('change', () => commit(input.value.trim()));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    } else {
      input.type = 'checkbox';
      input.className = 'toggle';
      input.checked = !!it.get();
      input.addEventListener('change', () => commit(input.checked));
    }
    row.append(labelBlock(), input);
    return row;
  }

  function render() {
    const list = getList();
    const ids = new Set(list.map((w) => w.id));
    for (const [id, el] of mounted) if (!ids.has(id)) { el.remove(); mounted.delete(id); }
    layer.classList.toggle('grid-mode', gridOn());
    if (gridOn()) return renderGrid(list);
    grid(); // keeps the cell size current in free mode too
    // Free mode has no edge stacks: anything still stacked gets its own spot once.
    const stacked = list.filter((x) => x.dock !== 'free');
    if (stacked.length) {
      const g = grid();
      for (const w of stacked) {
        const p = spotFor(g, w) || wantOf(g, w, cellsOf(w)[0]);
        const at = cellPx(g, p);
        w.gx = p.x; w.gy = p.y;
        w.dock = 'free'; w.x = at.x / innerWidth; w.y = at.y / innerHeight;
      }
      save();
    }
    for (const w of list) {
      const el = mounted.get(w.id) || build(w);
      mounted.set(w.id, el);
      el.classList.add('free');
      free.append(el);
      place(el, w);
    }
  }

  // Placed widgets first, so older ones without a cell fill in around them.
  function renderGrid(list) {
    const g = grid();
    let changed = false;
    const order = [...list].sort((a, b) => (a.gx == null) - (b.gx == null) || (a.order ?? 0) - (b.order ?? 0));
    const placed = [];
    for (const w of order) {
      const el = mounted.get(w.id) || build(w);
      mounted.set(w.id, el);
      const [cw, ch] = cellsOf(w);
      const taken = takenBy(placed);
      const want = wantOf(g, w, cw);
      let p = fitsAt(g, taken, want.x, want.y, cw, ch) ? want : nearestSpot(g, taken, want.x, want.y, cw, ch);
      if (p && (w.gx !== p.x || w.gy !== p.y)) { w.gx = p.x; w.gy = p.y; changed = true; }
      // No room on this window size: keep it on screen rather than hide it.
      if (!p) p = { x: Math.max(0, Math.min(want.x, g.across - cw)), y: Math.max(0, Math.min(want.y, g.down - ch)) };
      placed.push({ gx: p.x, gy: p.y, size: w.size });
      el.classList.add('free');
      free.append(el);
      const px = cellPx(g, p);
      el.style.left = px.x + 'px';
      el.style.top = px.y + 'px';
    }
    cutEdges();
    if (changed) save();
  }

  // Free widgets are stored as fractions of the window so they keep their spot on resize.
  function place(el, w) {
    const r = el.getBoundingClientRect();
    const p = clampTo(w.x * innerWidth, w.y * innerHeight, r.width, r.height);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  }
  addEventListener('resize', () => {
    if (gridOn()) return render();
    grid();
    getList().filter((w) => w.dock === 'free').forEach((w) => mounted.has(w.id) && place(mounted.get(w.id), w));
  });

  /* ---------- moving ---------- */
  // The top of the widget is the handle. Buttons, fields, and the title stay clickable.
  const toast = document.createElement('div');
  toast.className = 'w-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = 'No space for this widget';
  layer.append(toast);
  let toastTimer;
  function showNoRoom(text = 'No space for this widget') {
    toast.textContent = text;
    toast.classList.add('in');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('in'), 2200);
  }
  // Pick a widget up by its title bar or anywhere along its border (a thin band inside the edge).
  // It only lifts once the pointer actually moves, so clicks near the edge still do what they did.
  const EDGE = 14;     // px band along every edge
  const LIFT = 4;      // px of movement before it lifts
  function enableDrag(el, w) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, textarea, select, label, [contenteditable="true"]')) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const onHead = y <= 44;
      const onEdge = x <= EDGE || y <= EDGE || r.width - x <= EDGE || r.height - y <= EDGE;
      if (!onHead && !onEdge) return;
      // leave scrollbars alone
      const t = e.target;
      if (t !== el && t.scrollHeight > t.clientHeight && e.offsetX >= t.clientWidth) return;
      const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY;
      const off = () => { removeEventListener('pointermove', wait); removeEventListener('pointerup', off); removeEventListener('pointercancel', off); };
      const wait = (ev) => {
        if (ev.pointerId !== pid || Math.hypot(ev.clientX - x0, ev.clientY - y0) < LIFT) return;
        off();
        getSelection()?.removeAllRanges();
        startMove(el, w, e);
        // catch up to where the pointer already is
        dispatchEvent(new PointerEvent('pointermove', { pointerId: pid, clientX: ev.clientX, clientY: ev.clientY, bubbles: true }));
      };
      addEventListener('pointermove', wait);
      addEventListener('pointerup', off);
      addEventListener('pointercancel', off);
    });
  }

  function settle(el, from) {
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.028)`;
    el.classList.add('settling');
    requestAnimationFrame(() => {
      el.style.transition = '';
      el.style.transform = '';
      const done = (ev) => {
        if (ev.propertyName !== 'transform') return;
        el.classList.remove('settling');
        el.removeEventListener('transitionend', done);
      };
      el.addEventListener('transitionend', done);
    });
  }
  function showZones(on) {
    layer.classList.toggle('moving', on);
  }

  function startMove(el, w, e) {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    // Track the pointer on the whole window: lifting the widget onto the layer
    // (below) would cancel pointer capture, and a fast mouse would leave it behind.
    const pid = e.pointerId;
    el.classList.remove('settling');
    el.style.transform = '';
    el.classList.add('dragging');
    el.style.width = r.width + 'px';
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    layer.append(el); // above the other widgets while it moves
    const snapping = gridOn();
    const g = grid();
    const [cw, ch] = cellsOf(w);
    const taken = takenBy(getList(), w);
    // Letting go without moving puts it back where it was.
    let target = snapping && w.gx != null && fitsAt(g, taken, w.gx, w.gy, cw, ch) ? { x: w.gx, y: w.gy } : null;
    if (snapping) {
      slot.style.width = (cw * g.pitch - g.gap) + 'px';
      slot.style.height = (ch * g.pitch - g.gap) + 'px';
    }
    showZones(true);

    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      const p = clampTo(ev.clientX - dx, ev.clientY - dy, r.width, r.height); // stays inside the widget area
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      if (!snapping) return;
      const x = Math.round((p.x - g.left) / g.pitch);
      const y = Math.round((p.y - g.top) / g.pitch);
      target = fitsAt(g, taken, x, y, cw, ch) ? { x, y } : nearestSpot(g, taken, x, y, cw, ch);
      cellsEl.style.setProperty('--mx', ev.clientX - g.left + 'px');
      cellsEl.style.setProperty('--my', ev.clientY - g.top + 'px');
      slot.classList.toggle('on', !!target);
      if (target) {
        const at = cellPx(g, target);
        slot.style.transform = `translate(${at.x}px, ${at.y}px)`;
      }
    };
    const cleanup = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('keydown', key, true);
      document.body.classList.remove('dragging-widget');
      showZones(false);
      slot.classList.remove('on');
      el.classList.remove('dragging');
      el.style.width = '';
    };
    const finish = () => {
      const from = el.getBoundingClientRect();
      cleanup();
      if (!snapping) {
        // Free mode: it stays exactly where you let go.
        w.dock = 'free';
        w.x = from.left / innerWidth;
        w.y = from.top / innerHeight;
        w.gx = Math.max(0, Math.round((from.left - g.left) / g.pitch));
        w.gy = Math.max(0, Math.round((from.top - g.top) / g.pitch));
        save();
      } else if (target) {
        const at = cellPx(g, target);
        w.gx = target.x; w.gy = target.y;
        w.dock = 'free'; w.x = at.x / innerWidth; w.y = at.y / innerHeight; // where "Move freely" picks up
        save();
      } else showNoRoom();
      render();
      settle(el, from);
    };
    const up = (ev) => { if (ev.pointerId === pid) finish(); };
    const key = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault(); ev.stopPropagation();
      const from = el.getBoundingClientRect();
      cleanup(); render();
      settle(el, from);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', key, true);
    document.body.classList.add('dragging-widget'); // no text selection while dragging
  }

  /* ---------- right-click menu ---------- */
  const ctxMenu = document.createElement('div');
  ctxMenu.className = 'menu';
  ctxMenu.setAttribute('role', 'menu');
  ctxMenu.hidden = true;
  document.body.append(ctxMenu);
  let ctxFor = null, ctxAt = null;
  const closeCtx = () => { ctxMenu.hidden = true; };
  document.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target)) closeCtx(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });
  layer.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.widget');
    // keep the normal menu for typing (a sticky note is all text, so it gets the widget menu)
    if (!el || (e.target.closest('input, textarea, select') && !e.target.closest('.sn-text'))) return;
    const w = getList().find((x) => x.id === el.dataset.id);
    if (!w) return;
    e.preventDefault();
    closeMenu();
    ctxFor = w;
    ctxAt = { clientX: e.clientX, clientY: e.clientY, pointerId: -1 };
    // Folder: Add app first when the grid is full (no + tile left).
    const folderFull = w.type === 'folder' && (w.data.ids || []).length >= folderCap(w.size);
    // Other modes: "Move to Work" when there's one, "Move to…" (then pick) when there are several.
    const others = modes?.others() || [];
    const moveItem = others.length === 1
      ? `<button type="button" role="menuitem" data-act="mode" data-mode="${others[0].id}"></button>`
      : others.length > 1 ? '<button type="button" role="menuitem" data-act="move-to">Move to…</button>' : '';
    // Types with colours (sticky note): a row of swatches first.
    const colors = WIDGET_TYPES[w.type]?.colors;
    const swatches = colors ? '<div class="ctx-swatches" role="radiogroup" aria-label="Colour">'
      + colors.map(([c, name]) => `<button type="button" role="radio" data-act="color" data-color="${c}" title="${name}" aria-label="${name}" aria-checked="${(w.data.color || colors[0][0]) === c}" style="--sw:${c}"></button>`).join('')
      + '</div><hr>' : '';
    ctxMenu.innerHTML = swatches + (folderFull ? '<button type="button" role="menuitem" data-act="add-app">Add app</button><hr>' : '')
      + (canEdit(WIDGET_TYPES[w.type]) ? '<button type="button" role="menuitem" data-act="edit">Edit</button>' : '')
      + '<button type="button" role="menuitem" data-act="settings">Settings…</button>' + moveItem
      + '<hr><button type="button" role="menuitem" data-act="remove" class="danger">Remove widget</button>';
    if (others.length === 1) ctxMenu.querySelector('[data-act="mode"]').textContent = `Move to ${others[0].name}`;
    ctxMenu.hidden = false;
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.min(e.clientX, innerWidth - mw - 8) + 'px';
    ctxMenu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - mh - 8)) + 'px';
    ctxMenu.querySelector('button').focus();
  });
  ctxMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const act = btn?.dataset.act;
    const w = ctxFor;
    if (!act || !w) return;
    if (act === 'color') {
      // Recolour in place and keep the menu open, so shades can be compared.
      w.data.color = btn.dataset.color;
      layer.querySelector(`.widget[data-id="${w.id}"]`)?.style.setProperty('--note', w.data.color);
      ctxMenu.querySelectorAll('[data-act="color"]').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      save();
      return;
    }
    if (act === 'move-to') {
      // Swap the menu for the list of modes, in place.
      ctxMenu.innerHTML = '<div class="ctx-title">Move to</div>';
      for (const m of modes.others()) {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'menuitem');
        b.dataset.act = 'mode'; b.dataset.mode = m.id; b.textContent = m.name;
        ctxMenu.append(b);
      }
      const mh = ctxMenu.offsetHeight;
      ctxMenu.style.top = Math.max(8, Math.min(parseFloat(ctxMenu.style.top), innerHeight - mh - 8)) + 'px';
      ctxMenu.querySelector('[data-act="mode"]')?.focus();
      return;
    }
    closeCtx();
    if (act === 'mode') moveToMode(w, btn.dataset.mode);
    if (act === 'settings') openMenu(w, ctxAt);
    if (act === 'edit') openConnect(w, ctxAt);
    if (act === 'remove') remove(w);
    if (act === 'add-app') {
      openPicker(w, ctxAt);
    }
  });

  // Send a widget to another mode: same spot there if it's free, else the nearest free one.
  function moveToMode(w, modeId) {
    const target = modes?.listOf(modeId);
    const name = modes?.others().find((m) => m.id === modeId)?.name || 'that mode';
    if (!target) return;
    const g = grid();
    const [cw, ch] = cellsOf(w);
    const taken = takenBy(target);
    const want = w.gx != null ? { x: w.gx, y: w.gy } : { x: g.across - cw, y: 0 };
    const p = fitsAt(g, taken, want.x, want.y, cw, ch) ? want : nearestSpot(g, taken, want.x, want.y, cw, ch);
    if (!p) return showNoRoom(`No space for it in ${name}`);
    const list = getList();
    list.splice(list.indexOf(w), 1);
    const at = cellPx(g, p);
    w.gx = p.x; w.gy = p.y; w.x = at.x / innerWidth; w.y = at.y / innerHeight;
    target.push(w);
    save(); render();
    if (w.type === 'folder') apps?.changed?.();
    showNoRoom(`Moved to ${name}`);
  }

  // New widgets go in the free spot nearest the top right.
  function add(type) {
    const list = getList();
    const spec = WIDGET_TYPES[type];
    const w = { id: 'w_' + uid(), type, dock: 'free', sz: 2, data: spec.create() };
    if (spec.size) w.size = spec.size;
    if (spec.hideName) w.showName = false;
    applySize(w);
    const g = grid();
    const [cw, ch] = cellsOf(w);
    const visRight = Math.min(g.across, Math.floor((scrollX + view.viewW + g.gap) / g.pitch));
    const p = nearestSpot(g, takenBy(list), Math.max(0, visRight - cw), 0, cw, ch);
    if (!p) return showNoRoom();
    const at = cellPx(g, p);
    w.gx = p.x; w.gy = p.y; w.x = at.x / innerWidth; w.y = at.y / innerHeight;
    list.push(w);
    save(); render();
    const el = mounted.get(w.id);
    el?.classList.add('just-added');
    setTimeout(() => el?.classList.remove('just-added'), 700);
    el?.querySelector('input')?.focus();
  }

  return { render, add, reset: () => { for (const el of mounted.values()) el.remove(); mounted.clear(); render(); } };
}

