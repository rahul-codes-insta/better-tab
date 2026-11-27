// Pomodoro, quick capture, calendar, calendar agenda, and the day weather card.
import { uiConfirm } from './ui-dialog.js';
import { fetchForecast, searchCities, currentPosition, iconSvg, describe, kindOf } from './weather.js';

const uid = () => Math.random().toString(36).slice(2, 10);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const I = {
  pomo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 13V9.5M9 3.5h6"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5M8 13h8M8 17h5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3.5v4M16 3.5v4"/></svg>',
  agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M12 13v4M10 15h4"/></svg>',
  wx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="8" cy="9" r="3"/><path d="M8 3.5v1.2M3.2 9H4.4M4.6 5.2l.8.8"/><path d="M7 18.5h10.2a3.6 3.6 0 0 0 .4-7.18 5.2 5.2 0 0 0-10 .9A3.1 3.1 0 0 0 7 18.5z"/></svg>',
};

function chime() {
  const ctx = new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.05, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  o.connect(g); g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.36);
  setTimeout(() => ctx.close(), 600);
}

/* ---------------- pomodoro ---------------- */

function pomoEnsure(d) {
  d.focus = d.focus || 25;
  d.short = d.short || 5;
  d.long = d.long || 15;
  d.every = d.every || 4;
  d.round = d.round || 0;
  const today = dayKey(new Date());
  if (d.day !== today) { d.day = today; d.today = 0; }
  if (!d.run) d.run = { phase: 'focus', left: d.focus * 60, running: false };
  return d.run;
}
const pomoLen = (d, phase) => (phase === 'focus' ? d.focus : phase === 'long' ? d.long : d.short) * 60;
const phaseName = (p) => (p === 'focus' ? 'Focus' : p === 'long' ? 'Long break' : 'Break');

/* ---------------- calendar feed ---------------- */

function inZone(y, m, d, h, min, tz) {
  const guess = new Date(Date.UTC(y, m, d, h, min));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess);
  const n = (t) => +parts.find((p) => p.type === t).value;
  let hour = n('hour');
  if (hour === 24) hour = 0;
  const shown = Date.UTC(n('year'), n('month') - 1, n('day'), hour, n('minute'));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
function parseWhen(meta, value) {
  const tz = (meta.match(/TZID=([^;:]+)/) || [])[1];
  const allDay = /VALUE=DATE/i.test(meta) || /^\d{8}$/.test(value);
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, day = +m[3];
  if (allDay) return { date: new Date(y, mo, day), allDay: true };
  if (value.endsWith('Z')) return { date: new Date(Date.UTC(y, mo, day, +m[4], +m[5])), allDay: false };
  if (tz) { try { return { date: inZone(y, mo, day, +m[4], +m[5], tz), allDay: false }; } catch { /* fall through */ } }
  return { date: new Date(y, mo, day, +m[4] || 0, +m[5] || 0), allDay: false };
}
function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  const clean = (s) => s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  return events.map((rows) => {
    const field = (name) => rows.find((r) => r === name || r.startsWith(name + ';') || r.startsWith(name + ':'));
    const read = (name) => {
      const row = field(name);
      if (!row) return null;
      const i = row.indexOf(':');
      return { meta: row.slice(0, i), value: clean(row.slice(i + 1)) };
    };
    const start = read('DTSTART');
    const end = read('DTEND');
    const title = read('SUMMARY');
    if (!start || !title?.value) return null;
    const s = parseWhen(start.meta, start.value);
    const e = end ? parseWhen(end.meta, end.value) : null;
    if (!s) return null;
    return { title: title.value, loc: read('LOCATION')?.value || '', url: read('URL')?.value || '', start: s.date, end: e?.date || null, allDay: s.allDay };
  }).filter(Boolean);
}
const icsCache = new Map();
async function loadEvents(url) {
  const hit = icsCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.events;
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('Calendar unavailable');
  const events = parseIcs(await r.text());
  icsCache.set(url, { at: Date.now(), events });
  return events;
}
function onDay(ev, day) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = new Date(from); to.setDate(to.getDate() + 1);
  const end = ev.end || new Date(ev.start.getTime() + (ev.allDay ? 86400000 : 0));
  return ev.start < to && end > from;
}

const wxCache = new Map();

export const extraWidgets = {
  pomodoro: {
    name: 'Pomodoro',
    description: 'Focus timer with short and long breaks.',
    icon: I.pomo,
    size: '2x2',
    sizes: ['2x2', '2x4', '4x4'],
    create: () => ({ focus: 25, short: 5, long: 15, every: 4, chime: true }),
    mount(body, w, api) {
      const d = w.data;
      const run = pomoEnsure(d);
      body.innerHTML = `
        <div class="pomo">
          <svg class="pomo-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle class="pomo-track" cx="60" cy="60" r="52"/>
            <circle class="pomo-arc" cx="60" cy="60" r="52"/>
          </svg>
          <div class="pomo-mid"><div class="pomo-time">25:00</div><div class="pomo-phase"></div></div>
        </div>
        <div class="pomo-controls">
          <button type="button" class="pomo-go">Start</button>
          <button type="button" class="pomo-skip">Skip</button>
        </div>
        <input class="pomo-task" type="text" maxlength="60" placeholder="What are you focusing on?" aria-label="Focus task">
        <div class="pomo-meta"></div>`;
      const arc = body.querySelector('.pomo-arc');
      const time = body.querySelector('.pomo-time');
      const phase = body.querySelector('.pomo-phase');
      const go = body.querySelector('.pomo-go');
      const meta = body.querySelector('.pomo-meta');
      const task = body.querySelector('.pomo-task');
      const C = 2 * Math.PI * 52;
      arc.style.strokeDasharray = String(C);
      task.value = d.task || '';
      task.hidden = d.showTask === false;
      task.addEventListener('change', () => { d.task = task.value.trim(); api.save(); });

      function left() {
        return run.running ? Math.max(0, Math.round((run.endsAt - Date.now()) / 1000)) : run.left;
      }
      function paint() {
        const secs = left();
        const total = pomoLen(d, run.phase);
        const m = Math.floor(secs / 60), s = secs % 60;
        time.textContent = `${m}:${String(s).padStart(2, '0')}`;
        phase.textContent = phaseName(run.phase);
        arc.style.strokeDashoffset = String(C * (secs / total));
        arc.classList.toggle('break', run.phase !== 'focus');
        go.textContent = run.running ? 'Pause' : (secs === total ? 'Start' : 'Resume');
        meta.textContent = `${d.today || 0} focus session${d.today === 1 ? '' : 's'} today · round ${(d.round % d.every) + (run.phase === 'focus' ? 1 : 0) || d.every} of ${d.every}`;
      }
      function finish() {
        if (d.chime !== false) { try { chime(); } catch { /* no audio */ } }
        if (run.phase === 'focus') {
          d.round = (d.round || 0) + 1;
          d.today = (d.today || 0) + 1;
          run.phase = d.round % d.every === 0 ? 'long' : 'short';
        } else run.phase = 'focus';
        run.left = pomoLen(d, run.phase);
        run.running = false;
        if (d.auto) start();
        api.save();
        paint();
      }
      function start() {
        run.endsAt = Date.now() + run.left * 1000;
        run.running = true;
        api.save();
        paint();
      }
      go.addEventListener('click', () => {
        if (run.running) { run.left = left(); run.running = false; api.save(); paint(); }
        else start();
      });
      body.querySelector('.pomo-skip').addEventListener('click', finish);
      const timer = setInterval(() => {
        if (!body.isConnected) return clearInterval(timer);
        if (run.running && left() <= 0) finish();
        else paint();
      }, 250);
      paint();
    },
    chips: (w) => [
      { label: 'Chime', get: () => w.data.chime !== false, set: (v) => { w.data.chime = v; } },
      { label: 'Auto next', title: 'Start the next focus or break on its own', get: () => !!w.data.auto, set: (v) => { w.data.auto = v; } },
      { label: 'Focus task', title: 'A line for what you are working on', get: () => w.data.showTask !== false, set: (v) => { w.data.showTask = v; } },
    ],
    settings: (w) => {
      const setLen = (key, phase) => (v) => {
        w.data[key] = +v;
        const run = w.data.run;
        if (run && !run.running && run.phase === phase) run.left = +v * 60;
      };
      return [
        { section: 'Minutes' },
        { label: 'Focus', choice: [[15, '15'], [25, '25'], [45, '45'], [50, '50']], get: () => w.data.focus || 25, set: setLen('focus', 'focus') },
        { label: 'Break', choice: [[3, '3'], [5, '5'], [10, '10']], get: () => w.data.short || 5, set: setLen('short', 'short') },
        { label: 'Long break', choice: [[10, '10'], [15, '15'], [20, '20'], [30, '30']], get: () => w.data.long || 15, set: setLen('long', 'long') },
        { label: 'Long break every', hint: 'Focus sessions', choice: [[2, '2'], [4, '4'], [6, '6']], get: () => w.data.every || 4, set: (v) => { w.data.every = +v; } },
        {
          actions: [
            { label: 'Reset timer', run: () => { const d = w.data; d.run = { phase: 'focus', left: (d.focus || 25) * 60, running: false }; d.round = 0; } },
            { label: 'Reset today', disabled: () => !w.data.today, run: () => { w.data.today = 0; } },
          ],
        },
      ];
    },
  },

  capture: {
    name: 'Quick capture',
    description: 'A scratchpad for thoughts, ideas, or links.',
    icon: I.note,
    create: () => ({ notes: [], draft: '' }),
    mount(body, w, api) {
      const d = w.data;
      d.notes = d.notes || [];
      body.innerHTML = `
        <textarea class="qc-pad" rows="3" maxlength="1000" placeholder="Write a thought, idea, or link" aria-label="Scratchpad"></textarea>
        <button type="button" class="qc-keep" disabled>Keep this note</button>
        <ul class="qc-list"></ul>`;
      const pad = body.querySelector('.qc-pad');
      const keep = body.querySelector('.qc-keep');
      const list = body.querySelector('.qc-list');
      pad.value = d.draft || '';
      let timer;
      const syncKeep = () => { keep.disabled = !pad.value.trim(); };
      pad.addEventListener('input', () => {
        d.draft = pad.value;
        syncKeep();
        clearTimeout(timer);
        timer = setTimeout(() => api.save(), 400);
      });
      keep.addEventListener('click', () => {
        const text = pad.value.trim();
        if (!text) return;
        d.notes.unshift({ id: uid(), text, at: Date.now() });
        d.draft = '';
        pad.value = '';
        syncKeep();
        api.save();
        draw();
      });
      function draw() {
        list.innerHTML = '';
        for (const note of d.notes) {
          const li = document.createElement('li');
          li.className = 'qc-note';
          const text = document.createElement('div');
          text.className = 'qc-text';
          text.textContent = note.text;
          const url = note.text.trim().match(/^https?:\/\/\S+$/);
          if (url) {
            const a = document.createElement('a');
            a.href = url[0];
            a.target = '_blank';
            a.rel = 'noreferrer';
            a.textContent = note.text;
            text.textContent = '';
            text.append(a);
          }
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'qc-del';
          del.setAttribute('aria-label', 'Delete note');
          del.textContent = '×';
          del.addEventListener('click', () => { d.notes = d.notes.filter((n) => n !== note); api.save(); draw(); });
          text.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            const field = document.createElement('textarea');
            field.className = 'qc-edit';
            field.value = note.text;
            text.replaceWith(field);
            field.focus();
            const done = () => {
              const v = field.value.trim();
              if (v) note.text = v; else d.notes = d.notes.filter((n) => n !== note);
              api.save();
              draw();
            };
            field.addEventListener('blur', done);
            field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) field.blur(); });
          });
          if (d.dates) {
            const when = document.createElement('time');
            when.className = 'qc-when';
            when.textContent = new Date(note.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            text.append(when);
          }
          li.append(text, del);
          list.append(li);
        }
        api.setCount(d.notes.length ? String(d.notes.length) : '');
      }
      syncKeep();
      draw();
    },
    chips: (w) => [
      { label: 'Dates', title: 'When each note was kept', get: () => !!w.data.dates, set: (v) => { w.data.dates = v; } },
    ],
    settings: (w) => [{
      actions: [{
        label: 'Delete kept notes…', danger: true, disabled: () => !(w.data.notes || []).length,
        run: async () => {
          if (await uiConfirm({ title: 'Delete kept notes?', message: 'The scratchpad you are writing stays. Saved notes are removed.', confirmLabel: 'Delete', danger: true })) w.data.notes = [];
        },
      }],
    }],
  },

  calendar: {
    name: 'Calendar',
    description: 'This month, with days you can mark.',
    icon: I.cal,
    size: '2x2',
    sizes: ['2x2', '2x4', '4x4'],
    create: () => ({ marks: {} }),
    mount(body, w, api) {
      const d = w.data;
      d.marks = d.marks || {};
      let cursor = new Date();
      const colors = ['green', 'blue', 'amber', 'rose', 'violet'];
      body.innerHTML = `
        <div class="cal-nav"><button type="button" class="cal-prev" aria-label="Previous month">‹</button><div class="cal-title"></div><button type="button" class="cal-next" aria-label="Next month">›</button></div>
        <div class="cal-week">${(d.monday ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']).map((x) => `<span>${x}</span>`).join('')}</div>
        <div class="cal-grid"></div>`;
      const title = body.querySelector('.cal-title');
      const grid = body.querySelector('.cal-grid');
      function draw() {
        const y = cursor.getFullYear(), m = cursor.getMonth();
        title.textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const first = new Date(y, m, 1);
        const start = new Date(first);
        start.setDate(1 - (d.monday ? (first.getDay() + 6) % 7 : first.getDay()));
        grid.innerHTML = '';
        const today = dayKey(new Date());
        for (let i = 0; i < 42; i++) {
          const date = new Date(start);
          date.setDate(start.getDate() + i);
          const key = dayKey(date);
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cal-day' + (date.getMonth() === m ? '' : ' out') + (key === today ? ' today' : '') + (d.marks[key] ? ' mark-' + d.marks[key] : '');
          b.textContent = String(date.getDate());
          b.addEventListener('click', () => {
            const i = colors.indexOf(d.marks[key]);
            if (i === colors.length - 1) delete d.marks[key];
            else d.marks[key] = colors[i + 1] || colors[0];
            api.save();
            draw();
          });
          grid.append(b);
        }
      }
      body.querySelector('.cal-prev').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); draw(); });
      body.querySelector('.cal-next').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); draw(); });
      draw();
    },
    settings: (w) => [
      { label: 'Week starts on', choice: [['sun', 'Sunday'], ['mon', 'Monday']], get: () => (w.data.monday ? 'mon' : 'sun'), set: (v) => { w.data.monday = v === 'mon'; } },
      { note: 'Click a day to color it. Click again for the next color, or to clear it.' },
      {
        actions: [{
          label: 'Clear marked days', disabled: () => !Object.keys(w.data.marks || {}).length,
          run: () => { w.data.marks = {}; },
        }],
      },
    ],
  },

  agenda: {
    name: 'Agenda',
    description: 'Today’s events from Google Calendar.',
    icon: I.agenda,
    sizes: ['2x4', '4x4', '6x4'],
    create: () => ({ span: 'today' }),
    mount(body, w, api) {
      const d = w.data;
      body.innerHTML = '<div class="ag-status">Add your calendar link in settings.</div><div class="ag-list"></div>';
      const status = body.querySelector('.ag-status');
      const list = body.querySelector('.ag-list');
      status.addEventListener('click', (e) => { if (e.target.closest('button')) api.openSettings?.(); });
      if (!d.url) {
        status.innerHTML = 'Paste the secret iCal address from Google Calendar settings. <button type="button">Add link</button>';
        return;
      }
      status.textContent = 'Loading events…';
      loadEvents(d.url).then((events) => {
        if (!body.isConnected) return;
        const days = [];
        const n = d.span === 'soon' ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const day = new Date();
          day.setDate(day.getDate() + i);
          const items = events.filter((ev) => onDay(ev, day)).sort((a, b) => a.start - b.start || (b.allDay - a.allDay));
          if (items.length) days.push({ day, items });
        }
        list.innerHTML = '';
        if (!days.length) { status.textContent = n === 1 ? 'Nothing scheduled today.' : 'Nothing in the next 3 days.'; return; }
        status.hidden = true;
        for (const group of days) {
          const h = document.createElement('div');
          h.className = 'ag-day';
          h.textContent = group.day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
          list.append(h);
          for (const ev of group.items.slice(0, 8)) {
            const row = document.createElement('a');
            row.className = 'ag-event';
            row.href = ev.url || 'https://calendar.google.com/calendar/u/0/r/day';
            row.target = '_blank';
            row.rel = 'noreferrer';
            const when = ev.allDay ? 'All day' : ev.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            row.innerHTML = '<span class="ag-time"></span><span class="ag-main"><span class="ag-title"></span><span class="ag-loc"></span></span>';
            row.querySelector('.ag-time').textContent = when;
            row.querySelector('.ag-title').textContent = ev.title;
            row.querySelector('.ag-loc').textContent = ev.loc;
            row.querySelector('.ag-loc').hidden = !ev.loc || d.places === false;
            list.append(row);
          }
        }
      }).catch(() => { if (body.isConnected) status.textContent = 'That calendar link didn’t work. Check the secret iCal address.'; });
    },
    chips: (w) => [
      { label: 'Places', title: 'Where each event is', get: () => w.data.places !== false, set: (v) => { w.data.places = v; } },
    ],
    settings: (w) => [
      {
        label: 'Calendar link', text: true, max: 400, placeholder: 'https://calendar.google.com/calendar/ical/…',
        hint: 'Google Calendar → Settings → your calendar → Secret address in iCal format',
        get: () => w.data.url || '', set: (v) => { w.data.url = v; icsCache.delete(v); },
      },
      { label: 'Events from', choice: [['today', 'Today'], ['soon', 'Next 3 days']], get: () => w.data.span || 'today', set: (v) => { w.data.span = v; } },
      {
        actions: [
          { label: 'Refresh now', disabled: () => !w.data.url, run: () => { icsCache.delete(w.data.url); } },
          { label: 'Open Calendar', run: () => { open('https://calendar.google.com/calendar/u/0/r/day', '_blank', 'noopener'); } },
        ],
      },
    ],
  },

  forecast: {
    name: 'Weather',
    description: 'Temperature, high and low, and the hours ahead.',
    icon: I.wx,
    theme: { name: 'Blue' },
    hideName: true,
    size: '2x4',
    sizes: ['2x2', '2x4'],
    create: () => ({ mode: 'today' }),
    mount(body, w, api) {
      const d = w.data;
      body.innerHTML = `
        <div class="wxw">
          <div class="wxw-top">
            <div>
              <div class="wxw-place"><span class="wxw-name">Weather</span></div>
              <div class="wxw-temp">–°</div>
            </div>
            <div class="wxw-side">
              <div class="wxw-now"></div>
              <div class="wxw-cond"></div>
              <div class="wxw-hl"></div>
            </div>
          </div>
          <div class="wxw-hours"></div>
        </div>
        <div class="wxw-empty" hidden>Pick a city in settings, or allow location.</div>`;
      const card = body.querySelector('.wxw');
      const empty = body.querySelector('.wxw-empty');
      const hours = body.querySelector('.wxw-hours');
      const unit = () => (api.settings?.().weatherUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius');
      const deg = (n) => `${Math.round(n)}°`;
      const clock = (iso, withMin) => new Date(iso).toLocaleTimeString(undefined, withMin
        ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' });
      async function place() {
        if (d.place) return d.place;
        const saved = api.settings?.().weatherLoc;
        if (saved) return saved;
        const pos = await currentPosition();
        return { ...pos, name: 'Current location' };
      }
      function paint(fx, name) {
        card.hidden = false;
        empty.hidden = true;
        body.querySelector('.wxw-name').textContent = name || 'Weather';
        body.querySelector('.wxw-temp').textContent = deg(fx.temp);
        body.querySelector('.wxw-now').innerHTML = iconSvg(fx.code, fx.isDay);
        body.querySelector('.wxw-now').classList.toggle('sun', kindOf(fx.code) === 'clear' && fx.isDay);
        body.querySelector('.wxw-cond').textContent = describe(fx.code);
        const today = fx.daily[0];
        body.querySelector('.wxw-hl').textContent = today ? `H:${deg(today.high)}  L:${deg(today.low)}` : '';
        hours.innerHTML = '';
        if (d.mode === 'days') {
          const days = w.size === '2x2' ? 3 : w.size === '6x4' ? 7 : w.size === '2x4' ? 6 : 5;
          for (const day of fx.daily.slice(0, days)) {
            const col = document.createElement('div');
            col.className = 'wxw-hour';
            const when = new Date(day.date + 'T12:00:00');
            const label = dayKey(when) === dayKey(new Date()) ? 'Today' : when.toLocaleDateString(undefined, { weekday: 'short' });
            col.innerHTML = '<span class="wxw-hh"></span><span class="wxw-ico"></span><span class="wxw-ht"></span>';
            col.querySelector('.wxw-hh').textContent = label;
            col.querySelector('.wxw-ico').innerHTML = iconSvg(day.code, true);
            col.querySelector('.wxw-ht').textContent = deg(day.high);
            hours.append(col);
          }
          return;
        }
        const now = Date.now();
        const slots = w.size === '2x2' ? 0 : w.size === '6x4' ? 9 : 6;
        const upcoming = fx.hourly.filter((h) => new Date(h.time).getTime() >= now - 30 * 60 * 1000).slice(0, slots);
        const sunset = today?.sunset && new Date(today.sunset);
        let dropped = false;
        for (const h of upcoming) {
          const at = new Date(h.time);
          if (!dropped && sunset && sunset > new Date() && sunset < at) {
            dropped = true;
            const col = document.createElement('div');
            col.className = 'wxw-hour sunset';
            col.innerHTML = '<span class="wxw-hh"></span><span class="wxw-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 17h18M6 17a6 6 0 0 1 12 0"/><path d="M12 4v3M5.6 7.6l1.8 1.8M18.4 7.6l-1.8 1.8"/></svg></span><span class="wxw-ht"></span>';
            col.querySelector('.wxw-hh').textContent = clock(today.sunset, true);
            col.querySelector('.wxw-ht').textContent = 'Set';
            hours.append(col);
          }
          const col = document.createElement('div');
          col.className = 'wxw-hour' + (kindOf(h.code) === 'clear' && h.isDay ? ' sun' : '');
          col.innerHTML = '<span class="wxw-hh"></span><span class="wxw-ico"></span><span class="wxw-ht"></span>';
          col.querySelector('.wxw-hh').textContent = clock(h.time, false);
          col.querySelector('.wxw-ico').innerHTML = iconSvg(h.code, h.isDay);
          col.querySelector('.wxw-ht').textContent = deg(h.temp);
          hours.append(col);
        }
      }
      async function load() {
        try {
          const p = await place();
          const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)},${unit()},${d.mode}`;
          let fx = wxCache.get(key);
          if (!fx || Date.now() - fx.at > 15 * 60 * 1000) {
            fx = { at: Date.now(), data: await fetchForecast(p.lat, p.lon, unit()) };
            wxCache.set(key, fx);
          }
          if (body.isConnected) paint(fx.data, p.name);
        } catch {
          if (!body.isConnected) return;
          card.hidden = true;
          empty.hidden = false;
        }
      }
      load();
    },
    settings: (w) => [
      { label: 'Forecast', choice: [['today', 'Hours'], ['days', 'Days']], get: () => w.data.mode || 'today', set: (v) => { w.data.mode = v; } },
      {
        label: 'Location',
        hint: w.data.place ? w.data.place.name : 'Same as the weather next to the date',
        custom(box, changed, redrawMenu) {
          box.className = 'wxw-loc';
          const input = document.createElement('input');
          input.type = 'search';
          input.className = 'w-input';
          input.placeholder = 'Search a city';
          input.maxLength = 40;
          input.setAttribute('aria-label', 'Search a city');
          const list = document.createElement('div');
          list.className = 'wc-results';
          list.hidden = true;
          let timer;
          input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            list.innerHTML = '';
            list.hidden = q.length < 2;
            if (q.length < 2) return;
            timer = setTimeout(async () => {
              const found = await searchCities(q).catch(() => []);
              list.innerHTML = found.length ? '' : '<div class="wc-none">No city found.</div>';
              for (const c of found.slice(0, 5)) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'wc-result';
                b.innerHTML = '<span class="wc-r-name"></span><span class="wc-r-sub"></span>';
                b.firstChild.textContent = c.name;
                b.lastChild.textContent = c.detail || '';
                b.addEventListener('click', () => { w.data.place = { name: c.name, lat: c.lat, lon: c.lon }; changed(); redrawMenu(); });
                list.append(b);
              }
            }, 280);
          });
          box.append(input, list);
          if (w.data.place) {
            const mine = document.createElement('button');
            mine.type = 'button';
            mine.className = 'w-chip';
            mine.textContent = 'Use the page’s location';
            mine.addEventListener('click', () => { delete w.data.place; changed(); redrawMenu(); });
            box.append(mine);
          }
        },
      },
    ],
  },
};
