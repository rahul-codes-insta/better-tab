// Floating widgets: drag anywhere, snap and stack along the left and right edges.
//
// To add a widget type, add an entry to WIDGET_TYPES:
//   name, description, icon (svg), create() → initial data, mount(body, widget, api),
//   optional settings(widget) → extra rows for the widget's gear menu, each one of
//     { label, get(), set(v) }                 a toggle
//     { label, text: true, get(), set(v) }     a text field
//     { label, run() }                         a button (closes the menu)
//   optional fit: true → the card shrinks to its content instead of the usual width.
// api: { save(), setCount(text), settings(), apps }
import { uiConfirm } from './ui-dialog.js';
import * as P from './pinterest.js';

const uid = () => Math.random().toString(36).slice(2, 10);
const SNAP = 140;        // px from an edge that snaps a widget to it
const TOP = 84;          // where the edge stacks start

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
    name: 'To-do',
    description: 'Tasks you can star, edit, drag into order and tick off, with an optional progress bar.',
    icon: ICONS.todo,
    create: () => ({ items: [] }),
    mount(body, w, api) {
      const d = w.data;
      if (d.hideDone) { d.completed = 'hide'; delete d.hideDone; } // older setting
      body.innerHTML = `
        <div class="todo-progress" hidden><span></span></div>
        <ul class="todo-list"></ul>
        <form class="todo-add"><span class="todo-plus" aria-hidden="true">+</span><input type="text" placeholder="Add a task" maxlength="120" aria-label="Add a task"></form>
        <button type="button" class="todo-clear" hidden>Clear completed</button>`;
      const list = body.querySelector('.todo-list');
      const form = body.querySelector('.todo-add');
      const input = form.querySelector('input');
      const clear = body.querySelector('.todo-clear');
      const progress = body.querySelector('.todo-progress');
      const items = () => (d.items = d.items || []);
      const completed = () => d.completed || 'bottom'; // bottom | stay | hide
      let dragId = null;

      // Starred first, then the list's own order; finished tasks sink (or hide).
      function visible() {
        const rank = (x) => (x.done && completed() === 'bottom' ? 2 : 0) + (x.star && !x.done && d.starFirst !== false ? -1 : 0);
        return items().filter((x) => !(x.done && completed() === 'hide'))
          .map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]);
      }
      const commit = () => { api.save(); draw(); };

      function draw() {
        list.innerHTML = '';
        const shown = visible();
        for (const it of shown) {
          const li = document.createElement('li');
          li.className = 'todo-item' + (it.done ? ' done' : '') + (it.star ? ' starred' : '');
          li.draggable = true;
          li.innerHTML = `<button type="button" class="todo-check" aria-label="${it.done ? 'Mark not done' : 'Mark done'}"></button><span class="todo-text" title="Double-click to edit"></span><button type="button" class="todo-star" aria-pressed="${!!it.star}" aria-label="${it.star ? 'Unstar task' : 'Star task'}">${ICONS.star}</button><button type="button" class="todo-del" aria-label="Delete task">${ICONS.x}</button>`;
          const text = li.querySelector('.todo-text');
          text.textContent = it.text;
          li.querySelector('.todo-check').addEventListener('click', () => { it.done = !it.done; commit(); });
          li.querySelector('.todo-star').addEventListener('click', () => { it.star = !it.star; commit(); });
          li.querySelector('.todo-del').addEventListener('click', () => { d.items = items().filter((x) => x !== it); commit(); });
          text.addEventListener('dblclick', () => edit(li, it));
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
        api.setCount(total ? (done === total ? 'All done' : `${total - done} left`) : '');
        clear.hidden = !done;
        clear.textContent = completed() === 'hide' ? `Clear ${done} hidden completed` : 'Clear completed';
        list.hidden = !shown.length;
        progress.hidden = !d.progress || !total;
        progress.firstElementChild.style.width = total ? `${(done / total) * 100}%` : '0';
      }

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

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const it = { id: uid(), text, done: false };
        if (d.newOnTop) items().unshift(it); else items().push(it);
        input.value = '';
        commit();
      });
      clear.addEventListener('click', () => { d.items = items().filter((x) => !x.done); commit(); });
      draw();
    },
    chips: (w) => [
      { label: 'Progress', get: () => !!w.data.progress, set: (v) => { w.data.progress = v; } },
      { label: 'Stars first', get: () => w.data.starFirst !== false, set: (v) => { w.data.starFirst = v; } },
    ],
    settings: (w) => [
      { label: 'New tasks', choice: [['top', 'Top'], ['bottom', 'Bottom']], get: () => (w.data.newOnTop ? 'top' : 'bottom'), set: (v) => { w.data.newOnTop = v === 'top'; } },
      { label: 'Done tasks', choice: [['bottom', 'Sink'], ['stay', 'Keep'], ['hide', 'Hide']], get: () => w.data.completed || 'bottom', set: (v) => { w.data.completed = v; } },
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
    description: 'Up to 4 cities with their time, date, day or night, and how far ahead or behind they are. Pick cities in its settings.',
    icon: ICONS.clock,
    create: () => ({ clocks: [{ tz: 'America/New_York' }, { tz: 'Europe/London' }] }),
    mount(body, w, api) {
      const d = migrateClock(w.data);
      body.innerHTML = '<ul class="wc-list"></ul><div class="wc-empty" hidden>No cities yet. <button type="button">Choose cities</button></div>';
      const list = body.querySelector('.wc-list');
      const empty = body.querySelector('.wc-empty');
      empty.querySelector('button').addEventListener('click', () => api.openSettings?.());
      const rows = () => [...(d.local ? [{ tz: HERE_TZ, label: 'My time', here: true }] : []), ...d.clocks];

      function draw() {
        list.innerHTML = '';
        list.classList.toggle('grid', d.layout === 'grid');
        for (const c of rows()) {
          const li = document.createElement('li');
          li.className = 'wc-item' + (c.here ? ' here' : '');
          li.dataset.tz = c.tz;
          li.innerHTML = '<div class="wc-place"><span class="wc-city"></span><span class="wc-meta"></span></div><div class="wc-clock"><span class="wc-dn" aria-hidden="true"></span><span class="wc-time"></span><span class="wc-ampm"></span></div>';
          li.querySelector('.wc-city').textContent = c.label || cityOf(c.tz);
          list.append(li);
        }
        list.style.setProperty('--cols', Math.min(2, rows().length || 1));
        list.hidden = !rows().length;
        empty.hidden = !!rows().length;
        api.setCount('');
        tick();
      }

      function tick() {
        const now = new Date();
        const h12 = d.format === '12' ? true : d.format === '24' ? false : !api.settings?.().clock24;
        const here = offsetMin(now, HERE_TZ);
        for (const li of list.children) {
          const tz = li.dataset.tz;
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', second: d.seconds ? '2-digit' : undefined, hour12: h12 }).formatToParts(now);
          li.querySelector('.wc-time').textContent = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
          li.querySelector('.wc-ampm').textContent = (parts.find((p) => p.type === 'dayPeriod')?.value || '').toLowerCase();
          const hour = +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now);
          const day = hour >= 6 && hour < 18;
          li.querySelector('.wc-dn').innerHTML = d.daynight !== false ? (day ? ICONS.sun : ICONS.moon) : '';
          li.querySelector('.wc-dn').title = day ? 'Daytime' : 'Night';
          li.classList.toggle('off', !!d.workHours && (hour < 9 || hour >= 18));
          const meta = [];
          const dd = dayDiff(now, tz);
          if (d.date) meta.push(now.toLocaleDateString([], { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }));
          if (li.classList.contains('here')) meta.push('Your time zone');
          else if (d.diff !== false) {
            const m = offsetMin(now, tz) - here;
            const rel = m === 0 ? 'Same time' : `${m > 0 ? '+' : '−'}${fmtHrs(Math.abs(m))}`;
            meta.push(d.date || !dd ? rel : `${dd > 0 ? 'Tomorrow' : 'Yesterday'}, ${rel}`);
          } else if (!d.date && dd) meta.push(dd > 0 ? 'Tomorrow' : 'Yesterday');
          if (d.workHours && (hour < 9 || hour >= 18)) meta.push('Off hours');
          li.querySelector('.wc-meta').textContent = meta.join(' · ');
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
        { label: 'Day / night', get: () => d.daynight !== false, set: (v) => { d.daynight = v; } },
        { label: 'Off hours', title: 'Dim cities outside 9 am – 6 pm their time', get: () => !!d.workHours, set: (v) => { d.workHours = v; } },
      ];
    },
    settings: (w) => {
      const d = migrateClock(w.data);
      return [
        { custom: (box, changed) => cityEditor(box, d, changed) },
        { label: 'Layout', choice: [['list', 'List'], ['grid', 'Grid']], get: () => d.layout || 'list', set: (v) => { d.layout = v; } },
        { label: 'Format', title: 'Auto follows the main clock', choice: [['auto', 'Auto'], ['12', '12h'], ['24', '24h']], get: () => d.format || 'auto', set: (v) => { d.format = v; } },
      ];
    },
  },

  /* ---------- app folder ---------- */
  folder: {
    name: 'App folder',
    description: 'Group apps into a folder. Drag apps here from the bar, or use Add apps in its settings. Apps in a folder leave the bar.',
    icon: ICONS.folder,
    fit: true,
    create: () => ({ ids: [] }),
    mount(body, w, api) {
      const d = w.data;
      body.innerHTML = '<div class="fd-grid"></div><div class="fd-pick" hidden></div>';
      const grid = body.querySelector('.fd-grid');
      const pick = body.querySelector('.fd-pick');
      const all = () => api.apps?.all() || [];
      // Drop ids of apps that were deleted since.
      const mine = () => (d.ids = (d.ids || []).filter((id) => all().some((a) => a.id === id)));
      const appIcon = (app) => { const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.src = api.apps.icon(app); return img; };
      const changed = () => { api.save(); api.apps.changed(); draw(); };
      let dragId = null;

      function put(id) {
        if (!id || mine().includes(id) || !all().some((a) => a.id === id)) return;
        d.ids.push(id);
        changed();
      }
      function draw() {
        grid.innerHTML = '';
        grid.className = `fd-grid size-${d.size || 'm'}` + (d.hideNames ? ' no-names' : '');
        for (const id of mine()) {
          const app = all().find((a) => a.id === id);
          const a = document.createElement('a');
          a.className = 'fd-app';
          a.href = app.url;
          a.title = app.name;
          if (d.newTab) { a.target = '_blank'; a.rel = 'noopener'; }
          a.append(appIcon(app));
          a.insertAdjacentHTML('beforeend', `<span class="fd-name"></span><button type="button" class="fd-out" title="Back to the bar">${ICONS.x}</button>`);
          a.querySelector('.fd-name').textContent = app.name;
          const out = a.querySelector('.fd-out');
          out.setAttribute('aria-label', `Move ${app.name} back to the bar`);
          out.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            d.ids = mine().filter((x) => x !== id);
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
        // The + tile shows only while the folder is empty or you're picking apps,
        // so the card is exactly as big as the apps in it.
        if (!mine().length || !pick.hidden) {
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'fd-app fd-add';
          add.setAttribute('aria-expanded', String(!pick.hidden));
          add.innerHTML = `<span class="fd-plus" aria-hidden="true">${pick.hidden ? '+' : '✓'}</span><span class="fd-name">${pick.hidden ? 'Add' : 'Done'}</span>`;
          add.addEventListener('click', () => { pick.hidden = !pick.hidden; draw(); });
          grid.append(add);
        }
        grid.style.setProperty('--cols', Math.min(Math.min(d.cols || 4, 4), Math.max(1, grid.children.length)));
        api.setCount(mine().length ? `${mine().length} app${mine().length === 1 ? '' : 's'}` : '');
        drawPicker();
      }
      function drawPicker() {
        if (pick.hidden) return;
        const free = api.apps.onBar();
        pick.innerHTML = free.length ? '' : `<p class="fd-empty">${all().length ? 'All your apps are already in folders.' : 'No apps yet. Add some with + first.'}</p>`;
        for (const app of free) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'fd-pick-row';
          b.append(appIcon(app));
          b.insertAdjacentHTML('beforeend', '<span></span>');
          b.lastChild.textContent = app.name;
          b.addEventListener('click', () => put(app.id));
          pick.append(b);
        }
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
      if (w._pick) { delete w._pick; pick.hidden = false; } // "Add apps" from the gear menu
      draw();
    },
    // Extra on/off pills for the widget's "Show" row.
    chips: (w) => [
      { label: 'App names', get: () => !w.data.hideNames, set: (v) => { w.data.hideNames = !v; } },
    ],
    settings: (w, ctx) => [
      { label: 'Folder name', text: true, placeholder: 'App folder', get: () => w.data.title, set: (v) => { w.data.title = v; } },
      { label: 'Per row', choice: [['2', '2'], ['3', '3'], ['4', '4']], get: () => String(Math.min(w.data.cols || 4, 4)), set: (v) => { w.data.cols = +v; } },
      { label: 'Icon size', choice: [['s', 'S'], ['m', 'M'], ['l', 'L']], get: () => w.data.size || 'm', set: (v) => { w.data.size = v; } },
      { label: 'Open apps in a new tab', get: () => !!w.data.newTab, set: (v) => { w.data.newTab = v; } },
      {
        actions: [
          { label: 'Add apps…', run: () => { w._pick = true; } },
          { label: 'All back to bar', disabled: () => !(w.data.ids || []).length, run: () => { w.data.ids = []; ctx.apps?.changed(); } },
        ],
      },
    ],
  },
};

/* ---------- Pinterest ---------- */
const pinMemo = new Map(); // widget id -> last pins, so a settings change redraws instantly

WIDGET_TYPES.pinterest = {
  name: 'Pinterest',
  description: 'The newest pins from Pinterest accounts and boards you pick, or from everyone you follow when you sign in.',
  icon: ICONS.pin,
  create: () => ({ source: 'links', links: [], count: 6, layout: 'grid', every: 60, titles: false }),
  mount(body, w, api) {
    const d = w.data;
    body.innerHTML = '<div class="pn-box"></div>';
    const box = body.querySelector('.pn-box');
    let pins = pinMemo.get(w.id) || [];
    let slide = 0;
    let note = '';

    const message = (text, action) => {
      box.innerHTML = `<div class="pn-msg"><p></p>${action ? '<button type="button"></button>' : ''}</div>`;
      box.querySelector('p').textContent = text;
      if (action) { const b = box.querySelector('button'); b.textContent = action; b.addEventListener('click', () => api.openSettings?.()); }
    };

    function draw() {
      if (!pins.length) return;
      const layout = d.layout || 'grid';
      const shown = layout === 'grid' ? pins.slice(0, d.count || 6) : [pins[slide % pins.length]];
      box.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = `pn-${layout === 'grid' ? 'grid' : 'one'}` + (d.titles ? ' titles' : '') + (d.showSource ? ' sources' : '');
      if (layout === 'grid') wrap.style.setProperty('--cols', (d.count || 6) === 4 ? 2 : 3);
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
        if (!(await P.isSignedIn())) return message('Sign in to Pinterest to see new pins from people you follow.', 'Set up sign-in');
        try { feeds = await P.accountFeeds({ force }); } catch (e) { return message(e.message || 'Couldn’t reach Pinterest.', 'Settings'); }
        if (!feeds.length) return message('You don’t follow anyone on Pinterest yet, so there are no new pins to show.');
      } else {
        feeds = (d.links || []).map(P.toFeed).filter(Boolean);
        if (!feeds.length) return message('Pick Pinterest accounts or boards to see their newest pins.', 'Add accounts');
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
  settings: (w) => [
    { label: 'Pins from', redraw: true, choice: [['links', 'Links'], ['account', 'My account']], get: () => w.data.source || 'links', set: (v) => { w.data.source = v; } },
    { custom: (box, changed, redraw) => ((w.data.source === 'account' ? accountEditor : linkEditor)(box, w, changed, redraw)) },
    { label: 'Layout', choice: [['grid', 'Grid'], ['one', 'Large'], ['slides', 'Slides']], get: () => w.data.layout || 'grid', set: (v) => { w.data.layout = v; } },
    { label: 'Pins', title: 'How many pins the grid shows', choice: [['4', '4'], ['6', '6'], ['9', '9']], get: () => String(w.data.count || 6), set: (v) => { w.data.count = +v; } },
    { label: 'Refresh', choice: [['30', '30m'], ['60', '1h'], ['180', '3h']], get: () => String(w.data.every || 60), set: (v) => { w.data.every = +v; } },
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

export function createWidgetLayer({ layer, getList, save, getBounds, getSettings, apps }) {
  // The area widgets may occupy: below the mode switcher, above the cards and bar.
  const bounds = () => (getBounds ? getBounds() : { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 });
  function clampTo(x, y, w, h) {
    const b = bounds();
    return {
      x: Math.min(Math.max(b.left, x), Math.max(b.left, b.right - w)),
      y: Math.min(Math.max(b.top, y), Math.max(b.top, b.bottom - h)),
    };
  }
  layer.innerHTML = '<div class="w-col left"></div><div class="w-col right"></div><div class="w-free"></div><div class="w-guide left"></div><div class="w-guide right"></div>';
  const cols = { left: layer.querySelector('.w-col.left'), right: layer.querySelector('.w-col.right') };
  const free = layer.querySelector('.w-free');
  const mounted = new Map(); // id -> element

  function build(w) {
    const type = WIDGET_TYPES[w.type];
    const el = document.createElement('section');
    el.className = 'widget' + (type.fit ? ' fit' : '') + (w.showName === false ? ' no-name' : '') + (w.hideButtons ? ' no-buttons' : '') + (w.bg && w.bg !== 'glass' ? ' bg-' + w.bg : '');
    el.dataset.id = w.id;
    // Every widget gets this same header: icon, name, a bare move grip and a bare settings gear (styled in styles.css "Widget controls").
    el.innerHTML = `<header class="w-head"><span class="w-icon">${type.icon}</span><span class="w-name"></span><span class="w-count"></span><button type="button" class="w-move" aria-label="Move widget" title="Drag to move">${ICONS.grip}</button><button type="button" class="w-gear" aria-label="Widget settings" aria-haspopup="dialog" title="Settings">${ICONS.gear}</button></header><div class="w-body"></div>`;
    el.querySelector('.w-name').textContent = w.data.title || type.name;
    const count = el.querySelector('.w-count');
    type.mount(el.querySelector('.w-body'), w, { save, settings: getSettings, apps, setCount: (t) => { count.textContent = t; }, openSettings: () => openMenu(w, el.querySelector('.w-gear')) });
    el.querySelector('.w-gear').addEventListener('click', (e) => openMenu(w, e.currentTarget));
    enableDrag(el, w);
    return el;
  }

  async function remove(w) {
    const hasData = w.type === 'todo' && w.data.items?.length;
    if (hasData && !(await uiConfirm({ title: 'Remove this widget?', message: 'Its tasks are removed too.', confirmLabel: 'Remove', danger: true }))) return;
    const list = getList();
    list.splice(list.indexOf(w), 1);
    save(); render();
    if (w.type === 'folder') apps?.changed(); // its apps go back to the bar
  }

  // Redraw one widget after a setting changed, keeping its place.
  function refresh(w) {
    const old = mounted.get(w.id);
    if (!old) return;
    const el = build(w);
    old.replaceWith(el);
    mounted.set(w.id, el);
    if (w.dock === 'free') { el.classList.add('free'); place(el, w); }
    if (menuFor === w) el.querySelector('.w-gear').setAttribute('aria-expanded', 'true');
  }

  /* ---------- settings menu (one, shared by every widget) ---------- */
  const menu = document.createElement('div');
  menu.className = 'menu w-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Widget settings');
  menu.hidden = true;
  document.body.append(menu);
  let menuFor = null;
  const gearOf = (w) => mounted.get(w?.id)?.querySelector('.w-gear');
  function closeMenu(focus = false) {
    if (menu.hidden) return;
    const g = gearOf(menuFor);
    g?.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    menuFor = null;
    if (focus) g?.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && !e.target.closest?.('.w-gear')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(true); });

  function openMenu(w, btn, at = null) {
    if (menuFor === w && !at) return closeMenu();
    closeMenu();
    menuFor = w;
    btn.setAttribute('aria-expanded', 'true');
    drawMenu(w);
    menu.hidden = false;
    // Next to the gear, or at the pointer when opened from the right-click menu / with the gear hidden.
    const g = btn.getBoundingClientRect();
    const b = at || !g.width ? { right: (at?.clientX ?? g.right), top: (at?.clientY ?? g.top), bottom: (at?.clientY ?? g.bottom) } : g;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(b.right - mw, innerWidth - mw - 8)) + 'px';
    const below = b.bottom + 6, above = b.top - 6 - mh;
    menu.style.top = (below + mh <= innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, innerHeight - mh - 8)) + 'px';
    menu.querySelector('input, button:not(:disabled), select')?.focus();
  }

  function drawMenu(w) {
    const type = WIDGET_TYPES[w.type];
    // Everything that's just on/off sits in one "Show" row of pills.
    const rows = [
      ...(type.settings?.(w, { apps }) || []),
      {
        label: 'Show',
        chips: [
          { label: 'Name', get: () => w.showName !== false, set: (v) => { w.showName = v; } },
          { label: 'Buttons', title: 'The move and settings buttons. Right-click works either way', get: () => !w.hideButtons, set: (v) => { w.hideButtons = !v; } },
          ...(type.chips?.(w) || []),
        ],
        hint: () => (w.hideButtons ? 'Buttons hidden: right-click the widget for Settings and Move' : ''),
      },
      { label: 'Background', choice: [['glass', 'Glass'], ['dark', 'Dark'], ['clear', 'Clear']], get: () => w.bg || 'glass', set: (v) => { w.bg = v; } },
    ];
    menu.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'w-menu-title';
    title.textContent = w.data.title || type.name;
    menu.append(title);
    for (const it of rows) menu.append(menuRow(w, it));
    menu.append(menuRow(w, { actions: [{ label: 'Remove widget', danger: true, run: () => remove(w), keepClosed: true }] }));
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
    if (it.section) {
      const h = document.createElement('div');
      h.className = 'w-menu-section';
      h.textContent = it.section;
      return h;
    }
    if (it.custom) {
      const box = document.createElement('div');
      it.custom(box, () => { save(); refresh(w); }, () => { if (menuFor === w) drawMenu(w); });
      return box;
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
      b.disabled = !!it.disabled?.();
      b.addEventListener('click', async () => {
        closeMenu();
        if (it.keepClosed) return it.run();
        await it.run();
        save(); refresh(w);
      });
      return b;
    }
    const row = document.createElement(it.choice ? 'div' : 'label');
    row.className = 's-row';
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
      input.maxLength = 40;
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
    for (const side of ['left', 'right']) {
      list.filter((w) => w.dock === side).sort((a, b) => a.order - b.order).forEach((w) => {
        const el = mounted.get(w.id) || build(w);
        mounted.set(w.id, el);
        el.classList.remove('free');
        el.style.left = el.style.top = '';
        cols[side].append(el);
      });
    }
    for (const w of list.filter((x) => x.dock === 'free')) {
      const el = mounted.get(w.id) || build(w);
      mounted.set(w.id, el);
      el.classList.add('free');
      free.append(el);
      place(el, w);
    }
  }

  // Free widgets are stored as fractions of the window so they keep their spot on resize.
  function place(el, w) {
    const r = el.getBoundingClientRect();
    const p = clampTo(w.x * innerWidth, w.y * innerHeight, r.width, r.height);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  }
  addEventListener('resize', () => getList().filter((w) => w.dock === 'free').forEach((w) => mounted.has(w.id) && place(mounted.get(w.id), w)));

  /* ---------- moving ---------- */
  // By the move handle (press and drag), or from the right-click menu's Move
  // ("pickup": the widget follows the pointer until you click; Esc puts it back).
  function enableDrag(el, w) {
    el.querySelector('.w-move').addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startMove(el, w, e);
    });
  }

  function startMove(el, w, e, pickup = false) {
    const r = el.getBoundingClientRect();
    const dx = pickup ? Math.min(r.width / 2, 48) : e.clientX - r.left;
    const dy = pickup ? 18 : e.clientY - r.top;
    // Track the pointer on the whole window: lifting the widget out of its stack
    // (below) would cancel pointer capture, and a fast mouse would leave it behind.
    const pid = e.pointerId;
    el.classList.add('dragging');
    if (pickup) el.classList.add('picked');
    el.style.width = r.width + 'px';
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    layer.append(el); // lift it out of its stack
    let side = null;

    const move = (ev) => {
      if (!pickup && ev.pointerId !== pid) return;
      const p = clampTo(ev.clientX - dx, ev.clientY - dy, r.width, r.height); // stays inside the widget area
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      side = ev.clientX < SNAP ? 'left' : ev.clientX > innerWidth - SNAP ? 'right' : null;
      layer.classList.toggle('snap-left', side === 'left');
      layer.classList.toggle('snap-right', side === 'right');
      markInsert(side, ev.clientY);
    };
    const cleanup = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('pointerdown', drop, true);
      removeEventListener('keydown', key, true);
      document.body.classList.remove('dragging-widget');
      layer.classList.remove('snap-left', 'snap-right');
      clearInsert();
      el.classList.remove('dragging', 'picked');
      el.style.width = '';
    };
    const finish = (ev) => {
      cleanup();
      const list = getList();
      if (side) {
        // Insert into the edge stack at the pointer's height.
        const stack = list.filter((x) => x.dock === side && x !== w).sort((a, b) => a.order - b.order);
        let idx = stack.length;
        for (let i = 0; i < stack.length; i++) {
          const sr = mounted.get(stack[i].id)?.getBoundingClientRect();
          if (sr && ev.clientY < sr.top + sr.height / 2) { idx = i; break; }
        }
        stack.splice(idx, 0, w);
        stack.forEach((x, i) => { x.order = i; });
        w.dock = side;
      } else {
        const nr = el.getBoundingClientRect();
        w.dock = 'free';
        w.x = nr.left / innerWidth;
        w.y = nr.top / innerHeight;
      }
      save(); render();
    };
    const up = (ev) => { if (ev.pointerId === pid) finish(ev); };
    const drop = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(ev); };
    const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cleanup(); render(); } };
    addEventListener('pointermove', move);
    if (pickup) {
      addEventListener('pointerdown', drop, true);
      addEventListener('keydown', key, true);
      move(e);
    } else {
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    }
    document.body.classList.add('dragging-widget'); // no text selection while dragging
  }

  /* ---------- right-click menu: always has Settings and Move ---------- */
  const ctxMenu = document.createElement('div');
  ctxMenu.className = 'menu';
  ctxMenu.setAttribute('role', 'menu');
  ctxMenu.hidden = true;
  ctxMenu.innerHTML = '<button type="button" role="menuitem" data-act="settings">Settings…</button><button type="button" role="menuitem" data-act="move">Move</button><hr><button type="button" role="menuitem" data-act="remove" class="danger">Remove widget</button>';
  document.body.append(ctxMenu);
  let ctxFor = null, ctxAt = null;
  const closeCtx = () => { ctxMenu.hidden = true; };
  document.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target)) closeCtx(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });
  layer.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.widget');
    if (!el || e.target.closest('input, textarea, select')) return; // keep the normal menu for typing
    const w = getList().find((x) => x.id === el.dataset.id);
    if (!w) return;
    e.preventDefault();
    closeMenu();
    ctxFor = w;
    ctxAt = { clientX: e.clientX, clientY: e.clientY, pointerId: -1 };
    ctxMenu.hidden = false;
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.min(e.clientX, innerWidth - mw - 8) + 'px';
    ctxMenu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - mh - 8)) + 'px';
    ctxMenu.querySelector('button').focus();
  });
  ctxMenu.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    const w = ctxFor;
    if (!act || !w) return;
    closeCtx();
    const el = mounted.get(w.id);
    if (!el) return;
    if (act === 'settings') openMenu(w, el.querySelector('.w-gear'), ctxAt);
    if (act === 'move') startMove(el, w, ctxAt, true);
    if (act === 'remove') remove(w);
  });

  function clearInsert() { layer.querySelectorAll('.insert-before, .insert-after').forEach((x) => x.classList.remove('insert-before', 'insert-after')); }
  function markInsert(side, y) {
    clearInsert();
    if (!side) return;
    const els = [...cols[side].children];
    if (!els.length) return;
    const target = els.find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (target) target.classList.add('insert-before'); else els[els.length - 1].classList.add('insert-after');
  }

  function add(type) {
    const list = getList();
    const right = list.filter((x) => x.dock === 'right');
    const w = { id: 'w_' + uid(), type, dock: 'right', order: right.length, x: 0.7, y: 0.2, data: WIDGET_TYPES[type].create() };
    list.push(w);
    save(); render();
    const el = mounted.get(w.id);
    el?.classList.add('just-added');
    setTimeout(() => el?.classList.remove('just-added'), 700);
    el?.querySelector('input')?.focus();
  }

  return { render, add, reset: () => { for (const el of mounted.values()) el.remove(); mounted.clear(); render(); } };
}

export const TOP_OFFSET = TOP;
