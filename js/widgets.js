// Floating widgets: drag anywhere, snap and stack along the left and right edges.
//
// To add a widget type, add an entry to WIDGET_TYPES:
//   name, description, icon (svg), create() → initial data, mount(body, widget, api)
// api: { save(), setCount(text) }
import { uiConfirm } from './ui-dialog.js';

const uid = () => Math.random().toString(36).slice(2, 10);
const SNAP = 140;        // px from an edge that snaps a widget to it
const TOP = 84;          // where the edge stacks start

const ICONS = {
  todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.2l2.3 2.3 4.7-4.9"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></g></svg>',
};

/* ---------------- widget types ---------------- */

export const WIDGET_TYPES = {
  todo: {
    name: 'To-do',
    description: 'A quick list of things to get done. Tick them off as you go.',
    icon: ICONS.todo,
    create: () => ({ items: [] }),
    mount(body, w, api) {
      body.innerHTML = `
        <ul class="todo-list"></ul>
        <form class="todo-add"><span class="todo-plus" aria-hidden="true">+</span><input type="text" placeholder="Add a task" maxlength="120" aria-label="Add a task"></form>
        <button type="button" class="todo-clear" hidden>Clear completed</button>`;
      const list = body.querySelector('.todo-list');
      const form = body.querySelector('.todo-add');
      const input = form.querySelector('input');
      const clear = body.querySelector('.todo-clear');
      const items = () => (w.data.items = w.data.items || []);

      function draw() {
        list.innerHTML = '';
        const sorted = [...items()].sort((a, b) => a.done - b.done);
        for (const it of sorted) {
          const li = document.createElement('li');
          li.className = 'todo-item' + (it.done ? ' done' : '');
          li.innerHTML = `<button type="button" class="todo-check" aria-label="${it.done ? 'Mark not done' : 'Mark done'}"></button><span class="todo-text"></span><button type="button" class="todo-del" aria-label="Delete task">${ICONS.x}</button>`;
          li.querySelector('.todo-text').textContent = it.text;
          li.querySelector('.todo-check').addEventListener('click', () => { it.done = !it.done; api.save(); draw(); });
          li.querySelector('.todo-del').addEventListener('click', () => { w.data.items = items().filter((x) => x !== it); api.save(); draw(); });
          list.append(li);
        }
        const left = items().filter((x) => !x.done).length;
        api.setCount(items().length ? `${left} left` : '');
        clear.hidden = !items().some((x) => x.done);
        list.hidden = !items().length;
      }
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        items().push({ id: uid(), text, done: false });
        input.value = '';
        api.save(); draw();
      });
      clear.addEventListener('click', () => { w.data.items = items().filter((x) => !x.done); api.save(); draw(); });
      draw();
    },
  },
};

/* ---------------- layer ---------------- */

export function createWidgetLayer({ layer, getList, save, getBounds }) {
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
    el.className = 'widget';
    el.dataset.id = w.id;
    // Every widget gets this same header: icon, name, a bare move grip and a bare close X (styled in styles.css "Widget controls").
    el.innerHTML = `<header class="w-head"><span class="w-icon">${type.icon}</span><span class="w-name"></span><span class="w-count"></span><button type="button" class="w-move" aria-label="Move widget" title="Drag to move">${ICONS.grip}</button><button type="button" class="w-close" aria-label="Remove widget">${ICONS.x}</button></header><div class="w-body"></div>`;
    el.querySelector('.w-name').textContent = type.name;
    const count = el.querySelector('.w-count');
    type.mount(el.querySelector('.w-body'), w, { save, setCount: (t) => { count.textContent = t; } });
    el.querySelector('.w-close').addEventListener('click', async () => {
      const hasData = w.type === 'todo' && w.data.items?.length;
      if (hasData && !(await uiConfirm({ title: 'Remove this widget?', message: 'Its tasks are removed too.', confirmLabel: 'Remove', danger: true }))) return;
      const list = getList();
      list.splice(list.indexOf(w), 1);
      save(); render();
    });
    enableDrag(el, w);
    return el;
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

  /* ---------- dragging ---------- */
  function enableDrag(el, w) {
    // Widgets move only by their move handle.
    const handle = el.querySelector('.w-move');
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      // Track the pointer on the whole window: lifting the widget out of its stack
      // (below) would cancel pointer capture, and a fast mouse would leave it behind.
      const pid = e.pointerId;
      el.classList.add('dragging');
      el.style.width = r.width + 'px';
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      layer.append(el); // lift it out of its stack
      let side = null;

      const move = (ev) => {
        if (ev.pointerId !== pid) return;
        const p = clampTo(ev.clientX - dx, ev.clientY - dy, r.width, r.height); // stays inside the widget area
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        side = ev.clientX < SNAP ? 'left' : ev.clientX > innerWidth - SNAP ? 'right' : null;
        layer.classList.toggle('snap-left', side === 'left');
        layer.classList.toggle('snap-right', side === 'right');
        markInsert(side, ev.clientY);
      };
      const up = (ev) => {
        if (ev.pointerId !== pid) return;
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging-widget');
        layer.classList.remove('snap-left', 'snap-right');
        clearInsert();
        el.classList.remove('dragging');
        el.style.width = '';
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
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
      document.body.classList.add('dragging-widget'); // no text selection while dragging
    });
  }

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
