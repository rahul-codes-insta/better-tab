// Declarative settings panel.
//
// The panel is built from a schema, so adding a setting is one entry in a list:
//
//   { type: 'toggle', key: 'clock24', label: '24-hour clock' }
//
// Section:  { id, title, icon (svg string), summary(): string, advanced?, items: [...] }
// Items (all accept `advanced: true` to hide them until Advanced is on, and `hint`):
//   toggle   { key | get/set, label, onChange(v) }
//   segment  { key | get/set, label, options: [{ value, label }], onChange(v) }
//   slider   { key | get/set, label, min, max, step, format(v), onChange(v) }  — compact, one line
//   text     { key | get/set, label, placeholder, onChange(v) }               — commits on Enter / blur
//   buttons  { label?, buttons: [{ label, kind: 'primary'|'ghost'|'danger', onClick(btn) }] }
//   custom   { render(el), refresh?(el) }
//   group    { label, items: [...] }   — a collapsible "more" drop-down inside a section
// Any item can also have `when: () => boolean` to show it only when that's true.
//
// `key` reads/writes ctx.settings()[key] and calls ctx.save(). `hint` may be a function.

const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>';

export function buildSettings(container, sections, ctx) {
  const refreshers = [];
  const open = new Set(ctx.openSections?.() || [sections[0]?.id]);
  const text = (v) => (typeof v === 'function' ? v() : v) ?? '';

  const binding = (item) => {
    if (item.get) return { get: item.get, set: item.set };
    return {
      get: () => ctx.settings()[item.key],
      set: (v) => { ctx.settings()[item.key] = v; ctx.save(); },
    };
  };
  const commit = (item, b, v) => { b.set(v); item.onChange?.(v); refreshAll(); };

  function row(item, cls = '') {
    const el = document.createElement('div');
    el.className = `s-row ${cls}`.trim();
    if (item.advanced) el.classList.add('adv');
    return el;
  }
  function labelBlock(item) {
    const wrap = document.createElement('div');
    wrap.className = 's-label';
    const t = document.createElement('div');
    t.className = 's-title';
    t.textContent = item.label;
    wrap.append(t);
    if (item.hint) {
      const h = document.createElement('div');
      h.className = 's-hint';
      wrap.append(h);
      refreshers.push(() => { h.textContent = text(item.hint); });
    }
    return wrap;
  }

  const renderers = {
    toggle(item) {
      const b = binding(item);
      const el = row(item);
      const lab = document.createElement('label');
      lab.className = 's-toggle-wrap';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'toggle';
      input.addEventListener('change', () => commit(item, b, input.checked));
      lab.append(labelBlock(item), input);
      el.append(lab);
      refreshers.push(() => { input.checked = !!b.get(); });
      return el;
    },

    segment(item) {
      const b = binding(item);
      const el = row(item);
      const seg = document.createElement('div');
      seg.className = 's-seg';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', item.label);
      const btns = item.options.map((o) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.textContent = o.label;
        btn.addEventListener('click', () => commit(item, b, o.value));
        seg.append(btn);
        return [o.value, btn];
      });
      el.append(labelBlock(item), seg);
      refreshers.push(() => { const v = b.get(); btns.forEach(([val, btn]) => btn.setAttribute('aria-checked', String(val === v))); });
      return el;
    },

    slider(item) {
      const b = binding(item);
      const el = row(item, 's-slider');
      const lab = document.createElement('label');
      lab.className = 's-slider-label';
      lab.textContent = item.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min; input.max = item.max; input.step = item.step ?? 1;
      input.setAttribute('aria-label', item.label);
      const out = document.createElement('output');
      const fmt = item.format || ((v) => String(v));
      const paint = () => {
        input.style.setProperty('--fill', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');
        out.textContent = fmt(+input.value);
      };
      input.addEventListener('input', () => { paint(); b.set(+input.value); item.onChange?.(+input.value); });
      input.addEventListener('change', () => refreshAll());
      el.append(lab, input, out);
      if (item.hint) el.title = text(item.hint);
      refreshers.push(() => { input.value = b.get(); paint(); });
      return el;
    },

    text(item) {
      const b = binding(item);
      const el = row(item, 's-textrow');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 's-input';
      input.placeholder = item.placeholder || '';
      input.spellcheck = false;
      const go = () => { const v = input.value.trim(); if (v !== (b.get() || '')) commit(item, b, v); };
      input.addEventListener('change', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      el.append(labelBlock(item), input);
      refreshers.push(() => { if (document.activeElement !== input) input.value = b.get() || ''; });
      return el;
    },

    buttons(item) {
      const el = row(item, 's-btnrow');
      if (item.label) el.append(labelBlock(item));
      const box = document.createElement('div');
      box.className = 's-btns';
      for (const spec of item.buttons) {
        const btn = document.createElement(spec.file ? 'label' : 'button');
        if (!spec.file) btn.type = 'button';
        btn.className = `btn sm ${spec.kind || 'ghost'}`;
        btn.textContent = spec.label;
        if (spec.file) {
          const f = document.createElement('input');
          f.type = 'file'; f.accept = spec.accept || ''; f.hidden = true;
          f.addEventListener('change', () => { const file = f.files[0]; f.value = ''; if (file) spec.onFile(file); });
          btn.append(f);
        } else {
          btn.addEventListener('click', () => spec.onClick(btn));
        }
        box.append(btn);
      }
      el.append(box);
      return el;
    },

    custom(item) {
      const el = row(item, 's-custom');
      item.render(el);
      if (item.refresh) refreshers.push(() => item.refresh(el));
      return el;
    },

    group(item) {
      const el = document.createElement('div');
      el.className = 's-group';
      if (item.advanced) el.classList.add('adv');
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 's-group-head';
      head.setAttribute('aria-expanded', 'false');
      head.innerHTML = `<span></span>${CHEVRON}`;
      head.firstChild.textContent = item.label;
      const body = document.createElement('div');
      body.className = 's-collapse';
      const inner = document.createElement('div');
      inner.className = 's-collapse-inner s-group-body';
      item.items.forEach((it) => inner.append(renderItem(it)));
      body.append(inner);
      body.inert = true;
      head.addEventListener('click', () => {
        const isOpen = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(isOpen));
        el.classList.toggle('open', isOpen);
        body.inert = !isOpen; // closed drop-downs can't be tabbed into
      });
      el.append(head, body);
      return el;
    },
  };

  function renderItem(it) {
    const el = renderers[it.type](it);
    if (it.when) refreshers.push(() => { el.hidden = !it.when(); });
    return el;
  }

  container.innerHTML = '';
  for (const sec of sections) {
    const s = document.createElement('section');
    s.className = 's-section';
    s.dataset.id = sec.id;
    if (sec.advanced) s.classList.add('adv');
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 's-head';
    head.innerHTML = `<span class="s-icon">${sec.icon || ''}</span><span class="s-head-text"><span class="s-head-title"></span><span class="s-head-sum"></span></span>${CHEVRON}`;
    head.querySelector('.s-head-title').textContent = sec.title;
    const sum = head.querySelector('.s-head-sum');
    const body = document.createElement('div');
    body.className = 's-collapse';
    const inner = document.createElement('div');
    inner.className = 's-collapse-inner s-body';
    sec.items.forEach((it) => inner.append(renderItem(it)));
    body.append(inner);
    const setOpen = (v) => {
      s.classList.toggle('open', v);
      head.setAttribute('aria-expanded', String(v));
      body.inert = !v;
      if (v) open.add(sec.id); else open.delete(sec.id);
    };
    setOpen(open.has(sec.id));
    head.addEventListener('click', () => { setOpen(!s.classList.contains('open')); ctx.setOpenSections?.([...open]); });
    if (sec.summary) refreshers.push(() => { sum.textContent = sec.summary(); });
    s.append(head, body);
    container.append(s);
  }

  function refreshAll() { refreshers.forEach((fn) => fn()); }
  refreshAll();
  return { refresh: refreshAll };
}
