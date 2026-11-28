// Pomodoro, quick capture, calendar, calendar agenda, and the day weather card.
import { uiConfirm } from './ui-dialog.js';
import { fetchForecast, searchCities, currentPosition, iconSvg, iconColor, skyOf, describe, kindOf } from './weather.js';

const uid = () => Math.random().toString(36).slice(2, 10);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const I = {
  pomo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 13V9.5M9 3.5h6"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5M8 13h8M8 17h5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3.5v4M16 3.5v4"/></svg>',
  agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M12 13v4M10 15h4"/></svg>',
  gh: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="4" height="4" rx="1.2" opacity=".35"/><rect x="10" y="4" width="4" height="4" rx="1.2"/><rect x="17" y="4" width="4" height="4" rx="1.2" opacity=".6"/><rect x="3" y="10" width="4" height="4" rx="1.2"/><rect x="10" y="10" width="4" height="4" rx="1.2" opacity=".35"/><rect x="17" y="10" width="4" height="4" rx="1.2"/><rect x="3" y="16" width="4" height="4" rx="1.2" opacity=".6"/><rect x="10" y="16" width="4" height="4" rx="1.2"/><rect x="17" y="16" width="4" height="4" rx="1.2" opacity=".35"/></svg>',
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
const pomoSkip = new Map(); // widget id -> skip(), for the settings' Skip button
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
    const org = read('ORGANIZER');
    const who = (org?.meta.match(/CN="?([^";:]+)/) || [])[1] || '';
    return { title: title.value, loc: read('LOCATION')?.value || '', who, url: read('URL')?.value || '', start: s.date, end: e?.date || null, allDay: s.allDay };
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

/* ---------------- GitHub contributions ---------------- */
// Read from github.com/users/<name>/contributions, the same public page the profile shows.
// Cached for 30 minutes per name so every new tab doesn't ask GitHub again.
const GH_TTL = 30 * 60 * 1000;
async function loadContrib(user, force = false) {
  const key = 'gh:' + user.toLowerCase();
  if (!force) {
    try { const hit = JSON.parse(localStorage.getItem(key)); if (hit && Date.now() - hit.at < GH_TTL) return hit; } catch { /* no cache */ }
  }
  const r = await fetch(`https://github.com/users/${encodeURIComponent(user)}/contributions`, { credentials: 'omit' });
  if (r.status === 404) throw new Error('No GitHub user with that name.');
  if (!r.ok) throw new Error('Couldn’t reach GitHub.');
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  const days = [...doc.querySelectorAll('[data-date][data-level]')]
    .map((td) => ({ date: td.getAttribute('data-date'), level: +td.getAttribute('data-level') || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!days.length) throw new Error('Couldn’t read that contribution graph.');
  const total = +((doc.querySelector('h2')?.textContent || '').replace(/[^\d]/g, '')) || 0;
  const data = { at: Date.now(), user, days, total };
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* full */ }
  return data;
}
function contribStreak(days) {
  let i = days.length - 1;
  if (i >= 0 && !days[i].level) i--; // today can still be empty
  let n = 0;
  for (; i >= 0 && days[i].level; i--) n++;
  return n;
}

const wxCache = new Map();

export const extraWidgets = {
  pomodoro: {
    name: 'Pomodoro',
    description: 'Focus timer with breaks. A line runs around the edge as time passes.',
    icon: I.pomo,
    hideName: true, // the timer says what it is
    theme: {}, // its own look ("Default"): solid dark with a blue progress edge
    size: '2x2',
    sizes: ['2x2', '2x4', '4x2', '4x4'],
    create: () => ({ focus: 25, short: 5, long: 15, every: 4, chime: true, goal: 8 }),
    mount(body, w, api) {
      const d = w.data;
      const run = pomoEnsure(d);
      if (d.auto !== undefined) { d.autoBreak = d.autoFocus = !!d.auto; delete d.auto; } // older single switch
      body.innerHTML = `
        <div class="pm">
          <button type="button" class="pm-skip"><span class="pm-skip-label">Skip to break</span><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M6 6l6 6-6 6M13 6l6 6-6 6"/></svg></button>
          <div class="pm-time">25:00</div>
          <div class="pm-dots" aria-hidden="true"></div>
          <div class="pm-phase"></div>
          <button type="button" class="pm-go">Start</button>
          <input class="pm-task" type="text" maxlength="60" placeholder="What are you focusing on?" aria-label="Focus task">
          <div class="pm-meta"></div>
        </div>`;
      const $ = (c) => body.querySelector(c);
      const time = $('.pm-time'), phase = $('.pm-phase'), go = $('.pm-go'), dots = $('.pm-dots'), meta = $('.pm-meta'), task = $('.pm-task');
      const skipBtn = $('.pm-skip'), skipLabel = $('.pm-skip-label');
      task.value = d.task || '';
      task.hidden = d.showTask === false;
      task.addEventListener('change', () => { d.task = task.value.trim(); api.save(); });
      dots.hidden = d.showDots === false;

      // A line around the widget's edge, starting at the top middle and running clockwise.
      const card = body.closest('.widget');
      const NS = 'http://www.w3.org/2000/svg';
      const ring = document.createElementNS(NS, 'svg');
      ring.setAttribute('class', 'pm-ring');
      ring.setAttribute('aria-hidden', 'true');
      ring.innerHTML = '<path class="pm-ring-track" pathLength="100"/><path class="pm-ring-line" pathLength="100"/>';
      if (d.ring !== false) card?.append(ring);
      function shapeRing() {
        if (!card) return;
        const W = card.clientWidth, H = card.clientHeight;
        const r = Math.max(0, parseFloat(getComputedStyle(card).borderTopLeftRadius) - 3);
        const i = 3, x0 = i, y0 = i, x1 = W - i, y1 = H - i, mid = W / 2; // half the line's width, so it hugs the edge
        const dpath = `M${mid},${y0} H${x1 - r} A${r},${r} 0 0 1 ${x1},${y0 + r} V${y1 - r} A${r},${r} 0 0 1 ${x1 - r},${y1} H${x0 + r} A${r},${r} 0 0 1 ${x0},${y1 - r} V${y0 + r} A${r},${r} 0 0 1 ${x0 + r},${y0} Z`;
        ring.setAttribute('viewBox', `0 0 ${W} ${H}`);
        ring.querySelectorAll('path').forEach((p) => p.setAttribute('d', dpath));
      }
      if (card) new ResizeObserver(shapeRing).observe(card);

      function left() {
        return run.running ? Math.max(0, Math.round((run.endsAt - Date.now()) / 1000)) : run.left;
      }
      function paint() {
        const secs = left();
        const total = pomoLen(d, run.phase);
        const m = Math.floor(secs / 60), s = secs % 60;
        time.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        phase.textContent = phaseName(run.phase).toUpperCase();
        // The skip button says exactly where it goes next.
        const next = run.phase !== 'focus' ? 'focus' : ((d.round || 0) + 1) % d.every === 0 ? 'long' : 'short';
        const skipTo = `Skip to ${phaseName(next).toLowerCase()}`;
        if (skipLabel.textContent !== skipTo) { skipLabel.textContent = skipTo; skipBtn.setAttribute('aria-label', skipTo); }
        go.textContent = run.running ? 'Pause' : (secs === total ? 'Start' : 'Resume');
        go.classList.toggle('running', run.running);
        card?.classList.toggle('pm-break', run.phase !== 'focus');
        // Dots: focus sessions finished in this round of `every`.
        const done = run.phase === 'long' ? d.every : (d.round || 0) % d.every;
        if (dots.childElementCount !== d.every) dots.innerHTML = '<i></i>'.repeat(d.every);
        [...dots.children].forEach((x, i) => x.classList.toggle('on', i < done));
        // The edge line grows as the session runs.
        ring.querySelector('.pm-ring-line').style.strokeDashoffset = String(100 - (100 * (total - secs)) / total);
        ring.querySelector('.pm-ring-line').style.opacity = secs >= total ? '0' : '1'; // no stray dot before it starts
        const goal = d.goal || 0;
        meta.textContent = goal ? `${d.today || 0} of ${goal} sessions today` : `${d.today || 0} session${d.today === 1 ? '' : 's'} today`;
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
        if (run.phase === 'focus' ? d.autoFocus : d.autoBreak) start();
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
      $('.pm-skip').addEventListener('click', finish);
      pomoSkip.set(w.id, finish);
      const timer = setInterval(() => {
        if (!body.isConnected) { ring.remove(); return clearInterval(timer); }
        if (run.running && left() <= 0) finish();
        else paint();
      }, 250);
      paint();
    },
    chips: (w) => [
      { label: 'Edge line', title: 'A line around the edge that fills as time passes', get: () => w.data.ring !== false, set: (v) => { w.data.ring = v; } },
      { label: 'Dots', title: 'Finished focus sessions in this round', get: () => w.data.showDots !== false, set: (v) => { w.data.showDots = v; } },
      { label: 'Focus task', title: 'A line for what you are working on (bigger sizes)', get: () => w.data.showTask !== false, set: (v) => { w.data.showTask = v; } },
      { label: 'Chime', get: () => w.data.chime !== false, set: (v) => { w.data.chime = v; } },
    ],
    settings: (w) => {
      const d = w.data;
      // Changing a length resets the waiting (not running) timer to it.
      const fresh = () => { const run = d.run; if (run && !run.running) run.left = pomoLen(d, run.phase); };
      const preset = () => [d.focus, d.short, d.long].join('/');
      return [
        {
          label: 'Preset', choice: [['25/5/15', 'Classic'], ['50/10/20', 'Deep'], ['15/3/10', 'Quick']],
          hint: 'Classic 25/5 · Deep 50/10 · Quick 15/3', redraw: true,
          get: () => preset(), set: (v) => { [d.focus, d.short, d.long] = v.split('/').map(Number); fresh(); },
        },
        { label: 'Focus', redraw: true, stepper: { min: 5, max: 120, step: 5, unit: 'min' }, get: () => d.focus || 25, set: (v) => { d.focus = v; fresh(); } },
        { label: 'Break', redraw: true, stepper: { min: 1, max: 30, step: 1, unit: 'min' }, get: () => d.short || 5, set: (v) => { d.short = v; fresh(); } },
        { label: 'Long break', redraw: true, stepper: { min: 5, max: 60, step: 5, unit: 'min' }, get: () => d.long || 15, set: (v) => { d.long = v; fresh(); } },
        { label: 'Long break after', stepper: { min: 2, max: 8, step: 1, unit: 'sessions' }, get: () => d.every || 4, set: (v) => { d.every = v; } },
        { label: 'Daily goal', stepper: { min: 0, max: 16, step: 1, unit: 'sessions', zero: 'Off' }, get: () => d.goal ?? 8, set: (v) => { d.goal = v; } },
        { label: 'Start breaks on their own', get: () => !!d.autoBreak, set: (v) => { d.autoBreak = v; } },
        { label: 'Start focus on its own', hint: 'After a break ends', get: () => !!d.autoFocus, set: (v) => { d.autoFocus = v; } },
        {
          actions: [
            { label: 'Skip', run: () => { pomoSkip.get(w.id)?.(); } },
            { label: 'Reset', title: 'Back to the start of a focus session', run: () => { d.run = { phase: 'focus', left: (d.focus || 25) * 60, running: false }; d.round = 0; } },
            { label: 'Clear', title: 'Clear today’s session count', disabled: () => !d.today, run: () => { d.today = 0; } },
          ],
        },
      ];
    },
  },

  capture: {
    // (kept as "capture" so existing notes carry over)
    name: 'Sticky note',
    editFocus: '.sn-text', // Edit just puts you in the note
    description: 'A sticky note. Tap and type. Right-click to change its colour.',
    icon: I.note,
    hideName: true,
    size: '2x2',
    sizes: ['2x2', '2x4', '4x2', '4x4'],
    // Right-click colours (pastels)
    colors: [
      ['#f6d47a', 'Butter'], ['#f7bfa6', 'Peach'], ['#f5bcd3', 'Rose'], ['#d3c3f3', 'Lavender'],
      ['#b4d8f6', 'Sky'], ['#b5e3c8', 'Mint'], ['#d7e6ad', 'Pistachio'], ['#ece5d8', 'Paper'],
    ],
    create: () => ({ text: '', color: '#f6d47a', at: Date.now() }),
    mount(body, w, api) {
      const d = w.data;
      // Older Quick capture data: the draft plus kept notes become the note's text.
      if (d.text == null) {
        d.text = [d.draft, ...(d.notes || []).map((n) => n.text)].filter((t) => t && t.trim()).join('\n\n');
        d.at = d.notes?.[0]?.at || Date.now();
        delete d.draft; delete d.notes;
      }
      const card = body.closest('.widget');
      if (card) card.style.setProperty('--note', d.color || '#f6d47a');
      const ideas = ['Write something worth remembering', 'A thought, a list, a reminder…', 'What’s on your mind?', 'Jot it down before it’s gone'];
      body.innerHTML = '<textarea class="sn-text" maxlength="2000" aria-label="Sticky note"></textarea><time class="sn-date"></time>';
      const text = body.querySelector('.sn-text'), date = body.querySelector('.sn-date');
      text.placeholder = ideas[(w.id.charCodeAt(w.id.length - 1) || 0) % ideas.length];
      text.value = d.text;
      const paintDate = () => { date.textContent = new Date(d.at || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
      let t;
      text.addEventListener('input', () => {
        d.text = text.value;
        d.at = Date.now();
        paintDate();
        clearTimeout(t);
        t = setTimeout(() => api.save(), 400);
      });
      paintDate();
    },
  },

  calendar: {
    name: 'Calendar',
    description: 'This week or month, with reminders on the days you mark.',
    icon: I.cal,
    hideName: true, // the month says what it is
    theme: {}, // its own look ("Default"): frosted grey glass
    size: '4x4',
    sizes: ['2x2', '4x2', '4x4'],
    create: () => ({ marks: {}, view: 'week' }),
    mount(body, w, api) {
      const d = w.data;
      d.marks = d.marks || {};
      // Older versions marked days in five colors; now a day is simply marked (a white dot).
      for (const k of Object.keys(d.marks)) d.marks[k] = true;
      let sel = new Date();          // the selected day (today to start)
      let cursor = new Date();       // the month shown in Monthly
      const gear = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></g></svg>';
      const remIcon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="14" height="14" rx="2.5"/><path d="M13 21l2-4 5.5-5.5a1.6 1.6 0 0 0-2.3-2.3L12.7 14.7l-1.2 4.3z"/></g></svg>';
      body.innerHTML = `
        <div class="cal">
          <div class="cal-top">
            <div class="cal-tabs" role="tablist" aria-label="Calendar view"><button type="button" role="tab" data-v="week">Weekly</button><button type="button" role="tab" data-v="month">Monthly</button></div>
            <button type="button" class="cal-gear" aria-label="Calendar settings">${gear}</button>
          </div>
          <div class="cal-head"><button type="button" class="cal-arrow" data-step="-1" aria-label="Previous">‹</button><span class="cal-month"></span><button type="button" class="cal-arrow" data-step="1" aria-label="Next">›</button><span class="cal-num"></span></div>
          <div class="cal-days"></div>
          <div class="cal-foot">
            <button type="button" class="cal-rem">${remIcon}<span></span></button>
          </div>
        </div>`;
      const root = body.querySelector('.cal');
      const days = body.querySelector('.cal-days');
      const letters = () => (d.monday ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
      const startOfWeek = (date) => { const x = new Date(date.getFullYear(), date.getMonth(), date.getDate()); x.setDate(x.getDate() - (d.monday ? (x.getDay() + 6) % 7 : x.getDay())); return x; };
      const view = () => (d.view === 'month' ? 'month' : 'week');

      function dayButton(date, out) {
        const key = dayKey(date);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-d' + (out ? ' out' : '') + (key === dayKey(new Date()) ? ' today' : '') + (key === dayKey(sel) ? ' sel' : '') + (d.marks[key] ? ' marked' : '');
        b.innerHTML = '<span></span><i aria-hidden="true"></i>';
        b.firstChild.textContent = String(date.getDate());
        b.setAttribute('aria-label', date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + (d.marks[key] ? ', marked' : ''));
        b.setAttribute('aria-pressed', String(key === dayKey(sel)));
        // Click picks a day; clicking the picked day again marks or unmarks it.
        b.addEventListener('click', () => {
          if (key === dayKey(sel)) toggleMark(); else { sel = date; if (view() === 'month' && out) cursor = new Date(date.getFullYear(), date.getMonth(), 1); draw(); }
        });
        return b;
      }
      function toggleMark() {
        const key = dayKey(sel);
        if (d.marks[key]) delete d.marks[key]; else d.marks[key] = true;
        api.save();
        draw();
      }

      function draw() {
        root.dataset.view = view();
        body.querySelectorAll('.cal-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === view())));
        const shown = view() === 'month' ? cursor : sel;
        const monthEl = body.querySelector('.cal-month');
        const yr = shown.getFullYear() !== new Date().getFullYear() ? ` ${shown.getFullYear()}` : '';
        // Long names ("September") switch to the short form when they don't fit.
        fitMonth = () => {
          monthEl.textContent = shown.toLocaleDateString(undefined, { month: 'long' }) + yr;
          if (monthEl.scrollWidth > monthEl.clientWidth + 1) monthEl.textContent = shown.toLocaleDateString(undefined, { month: 'short' }) + yr;
        };
        requestAnimationFrame(fitMonth);
        body.querySelector('.cal-num').textContent = String(sel.getDate());
        days.innerHTML = letters().map((l) => `<span class="cal-l">${l}</span>`).join('');
        if (view() === 'week') {
          const s0 = startOfWeek(sel);
          for (let i = 0; i < 7; i++) { const x = new Date(s0); x.setDate(s0.getDate() + i); days.append(dayButton(x, false)); }
        } else {
          const y = cursor.getFullYear(), m = cursor.getMonth();
          const s0 = startOfWeek(new Date(y, m, 1));
          for (let i = 0; i < 42; i++) { const x = new Date(s0); x.setDate(s0.getDate() + i); days.append(dayButton(x, x.getMonth() !== m)); }
        }
        const marked = !!d.marks[dayKey(sel)];
        body.querySelector('.cal-rem span').textContent = marked ? 'Remove reminder' : 'Add reminder';
        body.querySelector('.cal-rem').classList.toggle('on', marked);
      }

      body.querySelectorAll('.cal-tabs button').forEach((b) => b.addEventListener('click', () => {
        d.view = b.dataset.v;
        if (d.view === 'month') cursor = new Date(sel.getFullYear(), sel.getMonth(), 1);
        api.save(); draw();
      }));
      body.querySelectorAll('.cal-arrow').forEach((b) => b.addEventListener('click', () => {
        const step = +b.dataset.step;
        if (view() === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
        else sel = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() + 7 * step);
        draw();
      }));
      // Check again once the font has loaded and whenever the widget changes size.
      let fitMonth = () => {};
      document.fonts?.ready.then(() => fitMonth());
      new ResizeObserver(() => fitMonth()).observe(root);
      body.querySelector('.cal-gear').addEventListener('click', () => api.openSettings?.());
      body.querySelector('.cal-rem').addEventListener('click', toggleMark);
      draw();
    },
    settings: (w) => [
      { label: 'View', choice: [['week', 'Weekly'], ['month', 'Monthly']], get: () => (w.data.view === 'month' ? 'month' : 'week'), set: (v) => { w.data.view = v; } },
      { label: 'Week starts on', choice: [['sun', 'Sunday'], ['mon', 'Monday']], get: () => (w.data.monday ? 'mon' : 'sun'), set: (v) => { w.data.monday = v === 'mon'; } },
      { note: 'Click a day to pick it; click it again, or use Add reminder, to mark it with a dot.' },
      {
        actions: [{
          label: 'Clear marked days', disabled: () => !Object.keys(w.data.marks || {}).length,
          run: () => { w.data.marks = {}; },
        }],
      },
    ],
  },

  agenda: {
    // (kept as "agenda" so existing widgets carry over)
    name: 'Events',
    description: 'This week at a glance and the day’s events, from your calendar.',
    icon: I.agenda,
    theme: {}, // its own look ("Default"): warm paper
    size: '4x4',
    sizes: ['2x2', '2x4', '4x2', '4x4'],
    create: () => ({}),
    mount(body, w, api) {
      const d = w.data;
      const today = new Date();
      const dayKey = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
      let sel = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let events = null;
      // the week (Monday first) around the chosen day
      const weekOf = (x) => {
        const mon = new Date(x); mon.setDate(x.getDate() - ((x.getDay() + 6) % 7));
        return [...Array(7)].map((_, i) => { const y = new Date(mon); y.setDate(mon.getDate() + i); return y; });
      };
      body.innerHTML = '<div class="ev"><div class="ev-week"><div class="ev-month"></div><div class="ev-days" role="tablist" aria-label="This week"></div></div><div class="ev-list"></div></div>';
      const month = body.querySelector('.ev-month'), daysEl = body.querySelector('.ev-days'), list = body.querySelector('.ev-list');

      function drawWeek() {
        const week = weekOf(sel);
        month.textContent = sel.toLocaleDateString(undefined, { month: 'long' });
        daysEl.innerHTML = '';
        for (const day of week) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'tab');
          const isToday = dayKey(day) === dayKey(today), isSel = dayKey(day) === dayKey(sel);
          b.className = 'ev-day' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + (day < today && !isToday ? ' past' : '');
          b.setAttribute('aria-selected', String(isSel));
          b.innerHTML = '<span class="ev-wd"></span><span class="ev-num"></span><i class="ev-dot"></i>';
          b.querySelector('.ev-wd').textContent = day.toLocaleDateString(undefined, { weekday: 'narrow' });
          b.querySelector('.ev-num').textContent = day.getDate();
          b.querySelector('.ev-dot').hidden = !events?.some((ev) => onDay(ev, day));
          b.setAttribute('aria-label', day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
          b.addEventListener('click', () => { sel = day; drawWeek(); drawList(); });
          daysEl.append(b);
        }
      }

      const hue = (t) => [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
      const fmtTime = (x) => x.toLocaleTimeString(undefined, { hour: 'numeric', minute: x.getMinutes() ? '2-digit' : undefined });

      function drawList() {
        list.innerHTML = '';
        if (!d.url) {
          // Not connected yet: the setup sits in the middle of the widget.
          list.innerHTML = '<div class="ev-setup"><p>See your week and the day’s events here.</p><button type="button" class="ev-connect">Connect to calendar</button></div>';
          list.querySelector('button').addEventListener('click', () => api.connect?.());
          return;
        }
        if (!events) { list.innerHTML = '<div class="ev-note">Loading events…</div>'; return; }
        const items = events.filter((ev) => onDay(ev, sel)).sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
        if (!items.length) {
          const n = document.createElement('div');
          n.className = 'ev-note';
          n.textContent = dayKey(sel) === dayKey(today) ? 'Nothing else today' : `Nothing on ${sel.toLocaleDateString(undefined, { weekday: 'long' })}`;
          list.append(n);
          return;
        }
        const now = Date.now();
        for (const ev of items) {
          const a = document.createElement('a');
          a.className = 'ev-row';
          a.href = ev.url || 'https://calendar.google.com/calendar/u/0/r/day';
          a.target = '_blank';
          a.rel = 'noreferrer';
          const who = ev.who || ev.loc;
          const end = ev.end || new Date(ev.start.getTime() + 3600000);
          const live = !ev.allDay && ev.start <= now && end > now;
          const soon = !ev.allDay && ev.start > now && ev.start - now < 30 * 60000;
          a.innerHTML = `<span class="ev-av"><span></span>${live || soon ? `<i class="${live ? 'live' : 'soon'}"></i>` : ''}</span><span class="ev-main"><b></b><small></small></span><svg class="ev-chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>`;
          a.querySelector('.ev-av').style.setProperty('--h', hue(who || ev.title));
          a.querySelector('.ev-av span').textContent = (who || ev.title).trim().charAt(0).toUpperCase();
          a.querySelector('b').textContent = ev.title;
          a.querySelector('small').textContent = [ev.allDay ? 'All day' : fmtTime(ev.start), d.places === false ? '' : who].filter(Boolean).join(' • ');
          if (live) a.title = 'Happening now';
          list.append(a);
        }
      }

      drawWeek();
      drawList();
      if (d.url) {
        loadEvents(d.url).then((got) => {
          if (!body.isConnected) return;
          events = got;
          drawWeek(); drawList();
        }).catch(() => {
          if (!body.isConnected) return;
          list.innerHTML = '<div class="ev-setup"><p>Couldn’t reach your calendar.</p><button type="button" class="ev-connect">Check connection</button></div>';
          list.querySelector('button').addEventListener('click', () => api.connect?.());
        });
      }
    },
    // Right-click → Edit, or the button in the widget: connect a calendar in a few steps.
    connect: {
      title: 'Connect your calendar',
      render(box, w, { done, close }) {
        const d = w.data;
        box.innerHTML = `
          <ol class="wcn-steps">
            <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener">Google Calendar settings</a>.</li>
            <li>Under <b>Settings for my calendars</b>, pick your calendar.</li>
            <li>In <b>Integrate calendar</b>, copy the <b>Secret address in iCal format</b>.</li>
            <li>Paste it below.</li>
          </ol>
          <input class="w-input wcn-input" type="url" placeholder="https://calendar.google.com/calendar/ical/…" aria-label="Calendar address">
          <p class="wcn-hint">Outlook and Apple Calendar iCal links work too. The link stays on this computer.</p>
          <div class="wcn-actions">
            ${d.url ? '<button type="button" class="btn danger-ghost wcn-off">Disconnect</button>' : ''}
            <span></span>
            <button type="button" class="btn ghost wcn-cancel">Cancel</button>
            <button type="button" class="btn primary wcn-go">${d.url ? 'Save' : 'Connect'}</button>
          </div>`;
        const input = box.querySelector('input'), hint = box.querySelector('.wcn-hint'), go = box.querySelector('.wcn-go');
        input.value = d.url || '';
        setTimeout(() => input.focus(), 50);
        const submit = async () => {
          const url = input.value.trim().replace(/^webcal:/i, 'https:');
          if (!/^https:\/\//i.test(url)) { hint.textContent = 'Paste the full address, starting with https://'; hint.classList.add('err'); return; }
          go.disabled = true; go.textContent = 'Checking…';
          icsCache.delete(url);
          try { await loadEvents(url); } catch {
            go.disabled = false; go.textContent = d.url ? 'Save' : 'Connect';
            hint.textContent = 'That address didn’t work. Make sure it’s the secret iCal address, not the public one.';
            hint.classList.add('err');
            return;
          }
          d.url = url;
          done();
        };
        go.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        box.querySelector('.wcn-cancel').addEventListener('click', close);
        box.querySelector('.wcn-off')?.addEventListener('click', () => { delete d.url; done(); });
      },
    },
    chips: (w) => [
      { label: 'Who / where', title: 'The organiser or place under each event', get: () => w.data.places !== false, set: (v) => { w.data.places = v; } },
    ],
    settings: (w) => [
      {
        actions: [
          { label: 'Refresh now', disabled: () => !w.data.url, run: () => { icsCache.delete(w.data.url); } },
          { label: 'Open Calendar', run: () => { open('https://calendar.google.com/calendar/u/0/r/week', '_blank', 'noopener'); } },
        ],
      },
    ],
  },

  github: {
    name: 'GitHub contributions',
    description: 'Your contribution graph, total for the year and current streak.',
    icon: I.gh,
    hideName: true,
    theme: {}, // its own look ("Default"): white
    size: '4x2',
    sizes: ['4x2'],
    create: () => ({}),
    mount(body, w, api) {
      const d = w.data;
      if (!d.user) {
        body.innerHTML = `<div class="gh-setup"><span class="gh-logo">${I.gh}</span><p>Your contribution graph, right on your new tab.</p><button type="button">Connect GitHub</button></div>`;
        body.querySelector('button').addEventListener('click', () => api.connect?.());
        return;
      }
      body.innerHTML = `<div class="gh"><div class="gh-head"><b class="gh-total">–</b><span>contributions in the last year</span></div><div class="gh-grid" aria-hidden="true"></div><div class="gh-foot"><a class="gh-user" target="_blank" rel="noreferrer"></a><span class="gh-streak"><b>–</b> day streak</span></div></div>`;
      const grid = body.querySelector('.gh-grid'), user = body.querySelector('.gh-user');
      user.textContent = '@' + d.user;
      user.href = `https://github.com/${encodeURIComponent(d.user)}`;
      body.querySelector('.gh-foot').hidden = d.showUser === false && d.showStreak === false;
      user.hidden = d.showUser === false;
      body.querySelector('.gh-streak').hidden = d.showStreak === false;
      let data = null;
      // As many weeks as fit across, newest on the right; one column per week, Sunday at the top.
      function draw() {
        if (!data) return;
        const h = grid.clientHeight, wd = grid.clientWidth;
        if (!h || !wd) return;
        const gap = Math.max(2, Math.round(h * 0.035));
        const cell = (h - gap * 6) / 7;
        const weeks = Math.max(1, Math.floor((wd + gap) / (cell + gap)));
        const last = data.days[data.days.length - 1];
        const lastDow = new Date(last.date + 'T00:00').getDay();
        const n = (weeks - 1) * 7 + lastDow + 1;
        const shown = data.days.slice(-n);
        grid.style.setProperty('--cell', cell + 'px');
        grid.style.setProperty('--gap', gap + 'px');
        grid.style.gridTemplateColumns = `repeat(${weeks}, var(--cell))`;
        grid.innerHTML = shown.map((x) => `<i class="l${Math.min(4, x.level)}" title="${x.date}"></i>`).join('');
      }
      function paint() {
        body.querySelector('.gh-total').textContent = data.total.toLocaleString();
        body.querySelector('.gh-streak b').textContent = contribStreak(data.days);
        draw();
      }
      new ResizeObserver(draw).observe(grid);
      const force = !!w._force; delete w._force;
      loadContrib(d.user, force).then((got) => { if (body.isConnected) { data = got; paint(); } })
        .catch((e) => {
          if (!body.isConnected) return;
          body.innerHTML = `<div class="gh-setup"><p></p><button type="button">Check username</button></div>`;
          body.querySelector('p').textContent = e.message;
          body.querySelector('button').addEventListener('click', () => api.connect?.());
        });
    },
    connect: {
      title: 'Connect GitHub',
      render(box, w, { done, close }) {
        const d = w.data;
        box.innerHTML = `
          <ol class="wcn-steps">
            <li>Type your GitHub username, the name after <b>github.com/</b>.</li>
            <li>Press Show. No sign-in needed: it reads your public contribution graph.</li>
          </ol>
          <input class="w-input wcn-input" type="text" placeholder="username" aria-label="GitHub username" spellcheck="false" autocapitalize="off">
          <p class="wcn-hint">Private contributions count only if “Private contributions” is turned on in your GitHub profile settings.</p>
          <div class="wcn-actions">
            ${d.user ? '<button type="button" class="btn danger-ghost wcn-off">Disconnect</button>' : ''}
            <span></span>
            <button type="button" class="btn ghost wcn-cancel">Cancel</button>
            <button type="button" class="btn primary wcn-go">Show</button>
          </div>`;
        const input = box.querySelector('input'), hint = box.querySelector('.wcn-hint'), go = box.querySelector('.wcn-go');
        input.value = d.user || '';
        setTimeout(() => input.focus(), 50);
        const submit = async () => {
          const name = input.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').split(/[/?#]/)[0];
          if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(name)) { hint.textContent = 'That doesn’t look like a GitHub username.'; hint.classList.add('err'); return; }
          go.disabled = true; go.textContent = 'Checking…';
          try { await loadContrib(name, true); } catch (e) {
            go.disabled = false; go.textContent = 'Show';
            hint.textContent = e.message; hint.classList.add('err');
            return;
          }
          d.user = name;
          done();
        };
        go.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        box.querySelector('.wcn-cancel').addEventListener('click', close);
        box.querySelector('.wcn-off')?.addEventListener('click', () => { delete d.user; done(); });
      },
    },
    chips: (w) => [
      { label: 'Username', get: () => w.data.showUser !== false, set: (v) => { w.data.showUser = v; } },
      { label: 'Streak', get: () => w.data.showStreak !== false, set: (v) => { w.data.showStreak = v; } },
    ],
    settings: (w) => [
      {
        actions: [
          { label: 'Refresh now', disabled: () => !w.data.user, run: () => { w._force = true; } },
          { label: 'Open profile', disabled: () => !w.data.user, run: () => { open(`https://github.com/${encodeURIComponent(w.data.user)}`, '_blank', 'noopener'); } },
        ],
      },
    ],
  },

  forecast: {
    name: 'Weather',
    description: 'Now, the hours and days ahead, and how it feels outside.',
    icon: I.wx,
    theme: {}, // its own look ("Default"): a sky that follows the weather
    hideName: true,
    size: '4x2',
    sizes: ['2x2', '4x2', '4x4'],
    create: () => ({ mode: 'today' }),
    mount(body, w, api) {
      const d = w.data;
      const card = body.closest('.widget');
      body.innerHTML = `
        <div class="wx2">
          <div class="wx2-top">
            <div class="wx2-left">
              <div class="wx2-place"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.6 3.4 3.9 10.2c-.8.3-.7 1.4.1 1.6l6.6 1.6 1.6 6.6c.2.8 1.3.9 1.6.1l6.8-16.7a.3.3 0 0 0 0-.4z"/></svg><span class="wx2-name">Weather</span></div>
              <div class="wx2-temp">–°</div>
            </div>
            <div class="wx2-right">
              <span class="wx2-icon"></span>
              <div class="wx2-cond"></div>
              <div class="wx2-hl"></div>
            </div>
          </div>
          <div class="wx2-hours"></div>
          <div class="wx2-details"></div>
          <div class="wx2-days"></div>
        </div>
        <div class="wx2-empty" hidden><span class="wx2-icon"></span><p>Pick a city, or allow location.</p><button type="button">Choose a city</button></div>`;
      const box = body.querySelector('.wx2');
      const empty = body.querySelector('.wx2-empty');
      empty.querySelector('button').addEventListener('click', () => api.openSettings?.());
      const hours = body.querySelector('.wx2-hours'), details = body.querySelector('.wx2-details'), days = body.querySelector('.wx2-days');
      const unit = () => (api.settings?.().weatherUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius');
      const deg = (n) => (n == null ? '–' : `${Math.round(n)}°`);
      const hourLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric' }).replace(/\s?([AP]M)/i, (m, p) => p.toLowerCase());
      async function place() {
        if (d.place) return d.place;
        const saved = api.settings?.().weatherLoc;
        if (saved) return saved;
        const pos = await currentPosition();
        return { ...pos, name: 'My location' };
      }
      const big = w.size === '4x4', tall = w.size === '2x4', wide = w.size === '4x2';

      function paint(fx, name) {
        box.hidden = false; empty.hidden = true;
        const sky = skyOf(fx.code, fx.isDay);
        card?.setAttribute('data-sky', sky);
        body.querySelector('.wx2-name').textContent = name || 'Weather';
        body.querySelector('.wx2-place svg').style.display = d.place || api.settings?.().weatherLoc ? 'none' : '';
        body.querySelector('.wx2-temp').textContent = deg(fx.temp);
        body.querySelector('.wx2-icon').innerHTML = iconColor(fx.code, fx.isDay);
        body.querySelector('.wx2-cond').textContent = describe(fx.code);
        const today = fx.daily[0];
        body.querySelector('.wx2-hl').textContent = today ? `H:${deg(today.high)}  L:${deg(today.low)}` : '';

        // hours ahead (wide and big), or the days strip when the wide size is set to Days
        hours.innerHTML = '';
        const daysStrip = wide && d.mode === 'days';
        if (wide || big) {
          if (daysStrip) {
            for (const day of fx.daily.slice(0, 6)) hours.append(col(dayName(day.date), iconColor(day.code, true), deg(day.high), day.rain));
          } else {
            const now = Date.now();
            const next = fx.hourly.filter((h) => new Date(h.time).getTime() >= now - 30 * 60 * 1000).slice(0, big ? 7 : 6);
            const sunset = today?.sunset && new Date(today.sunset), sunrise = fx.daily[1]?.sunrise && new Date(fx.daily[1].sunrise);
            next.forEach((h, i) => {
              const at = new Date(h.time);
              hours.append(col(i === 0 ? 'Now' : hourLabel(h.time), iconColor(h.code, h.isDay), deg(i === 0 ? fx.temp : h.temp), h.rain));
              const nx = next[i + 1] && new Date(next[i + 1].time);
              for (const [t, label] of [[sunset, 'Sunset'], [sunrise, 'Sunrise']]) {
                if (t && nx && t > at && t <= nx && hours.children.length < next.length) {
                  hours.append(col(t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), SUNMARK[label], label, null, 'mark'));
                }
              }
            });
            while (hours.children.length > next.length) hours.lastChild.remove();
          }
        }

        // how it feels (tall and big)
        details.innerHTML = '';
        if (tall || big) {
          const uv = today?.uv;
          const tiles = [
            ['Feels like', deg(fx.feels), fx.feels != null && Math.round(fx.feels) !== Math.round(fx.temp) ? (fx.feels < fx.temp ? 'Feels cooler' : 'Feels warmer') : 'Same as actual'],
            ['Humidity', fx.humidity == null ? '–' : `${Math.round(fx.humidity)}%`, fx.humidity >= 70 ? 'Muggy' : fx.humidity <= 30 ? 'Dry' : 'Comfortable'],
            ['Wind', fx.wind == null ? '–' : `${Math.round(fx.wind)}`, fx.windUnit],
            ['UV index', uv == null ? '–' : String(Math.round(uv)), uv == null ? '' : uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : 'Very high'],
          ];
          for (const [label, value, sub] of tiles) {
            const t = document.createElement('div');
            t.className = 'wx2-tile';
            t.innerHTML = '<span class="wx2-tl"></span><b></b><small></small>';
            t.querySelector('.wx2-tl').textContent = label;
            t.querySelector('b').textContent = value;
            t.querySelector('small').textContent = sub;
            details.append(t);
          }
        }

        // the days ahead, with a bar for each day's range (tall and big)
        days.innerHTML = '';
        if (tall || big) {
          const list = fx.daily.slice(0, 4);
          const lo = Math.min(...list.map((x) => x.low)), hi = Math.max(...list.map((x) => x.high));
          const span = Math.max(1, hi - lo);
          for (const day of list) {
            const r = document.createElement('div');
            r.className = 'wx2-day';
            r.innerHTML = `<span class="wx2-dn"></span><span class="wx2-di">${iconColor(day.code, true)}</span><span class="wx2-dr"></span><span class="wx2-lo"></span><span class="wx2-bar"><i></i></span><span class="wx2-hi"></span>`;
            r.querySelector('.wx2-dn').textContent = dayName(day.date);
            r.querySelector('.wx2-dr').textContent = day.rain >= 30 ? `${day.rain}%` : '';
            r.querySelector('.wx2-lo').textContent = deg(day.low);
            r.querySelector('.wx2-hi').textContent = deg(day.high);
            const bar = r.querySelector('.wx2-bar i');
            bar.style.left = `${((day.low - lo) / span) * 100}%`;
            bar.style.right = `${((hi - day.high) / span) * 100}%`;
            days.append(r);
          }
        }
      }
      const SUNMARK = {
        Sunset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17a6 6 0 0 1 12 0z" fill="#FFB627"/><path d="M3 17h18M12 3.5V8M10 6l2 2 2-2" stroke="#FFD27A" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        Sunrise: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17a6 6 0 0 1 12 0z" fill="#FFC93C"/><path d="M3 17h18M12 3.5V8M10 5.5l2-2 2 2" stroke="#FFD27A" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
      };
      function dayName(date) {
        const at = new Date(date + 'T12:00:00');
        return dayKey(at) === dayKey(new Date()) ? 'Today' : at.toLocaleDateString(undefined, { weekday: 'short' });
      }
      function col(top, icon, temp, rain, extra = '') {
        const c = document.createElement('div');
        c.className = 'wx2-hour' + (extra ? ' ' + extra : '');
        c.innerHTML = `<span class="wx2-hh"></span><span class="wx2-rain"></span><span class="wx2-ico">${icon}</span><span class="wx2-ht"></span>`;
        c.querySelector('.wx2-hh').textContent = top;
        c.querySelector('.wx2-rain').textContent = rain >= 30 ? `${rain}%` : '';
        c.querySelector('.wx2-ht').textContent = temp;
        return c;
      }
      async function load() {
        try {
          const p = await place();
          const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)},${unit()}`;
          let fx = wxCache.get(key);
          if (!fx || Date.now() - fx.at > 15 * 60 * 1000) {
            fx = { at: Date.now(), data: await fetchForecast(p.lat, p.lon, unit()) };
            wxCache.set(key, fx);
          }
          if (body.isConnected) paint(fx.data, p.name);
        } catch {
          if (!body.isConnected) return;
          box.hidden = true;
          empty.hidden = false;
          empty.querySelector('.wx2-icon').innerHTML = iconColor(2, true);
        }
      }
      load();
    },
    settings: (w) => [
      ...(w.size === '4x2' ? [{ label: 'Forecast', hint: 'What the row under the temperature shows', choice: [['today', 'Hours'], ['days', 'Days']], get: () => w.data.mode || 'today', set: (v) => { w.data.mode = v; } }] : []),
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
