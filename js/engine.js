// 3D Wallpaper Engine: photo → depth map (on this computer) → foreground cut-out → saved wallpaper.
import * as ort from '../vendor/ort/ort.wasm.min.mjs';
import * as store from './store.js';
import {
  engineInstalled, downloadEngine, loadModelBytes, putWallpaper, removeEngine, MODEL_SIZE_MB,
} from './wallstore.js';

ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1; // extension pages aren't cross-origin isolated, so no worker threads

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const bgC = $('#bgCanvas'), fgC = $('#fgCanvas'), curC = $('#cursorCanvas');
const OBJ_Y = 0.42;          // matches the new tab's object-position (50% 42%)
const EDIT_W = 1024;         // resolution of the touch-up layer
const MAX_SAVE = 3840;       // longest side saved

let session = null;
let img = null;              // the photo
let depthC = null;           // grayscale depth canvas (white = near)
let editsC = null;           // touch-ups: red = add to front, green = send back
let small = null;            // { w, h, data } photo pixels at preview size
let threshold = 0.5, softness = 0.2;
let brush = 'off';
let settings = {};

/* ---------------- setup ---------------- */

// Opened as an overlay on the new tab: talk to the parent instead of navigating.
const OVERLAY = new URLSearchParams(location.search).has('overlay') && window.parent !== window;
const tellParent = (type) => { if (OVERLAY) window.parent.postMessage({ type }, location.origin); };
if (OVERLAY) {
  document.body.classList.add('overlay');
  const close = $('#closeBtn');
  close.textContent = 'Close';
  close.addEventListener('click', (e) => { e.preventDefault(); tellParent('horizon-engine-close'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#busy').hidden) tellParent('horizon-engine-close'); });
}

const ratio = (screen.width && screen.height) ? screen.width / screen.height : 16 / 10;
stage.style.setProperty('--screen-ratio', `${ratio}`);

async function loadSettings() {
  const { state } = await store.get('state');
  settings = state?.settings || {};
  stage.style.setProperty('--clock-weight', settings.clockWeight ?? 400);
  stage.style.setProperty('--clock-scale', (settings.clockScale ?? 100) / 100);
  const now = new Date();
  let h = now.getHours();
  if (!settings.clock24) h = h % 12 || 12;
  $('#stageClock').textContent = `${settings.clock24 ? String(h).padStart(2, '0') : h}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('#stageDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function paintRange(r) { r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'); }
document.querySelectorAll('input[type=range]').forEach((r) => { paintRange(r); r.addEventListener('input', () => paintRange(r)); });

async function showStart() {
  const installed = await engineInstalled();
  $('#installCard').hidden = installed;
  $('#drop').hidden = !installed || !!img;
  $('#editPanel').hidden = !img;
  $('#tipsCard').hidden = !installed || !!img;
  stage.classList.toggle('has-img', !!img);
  if (!installed) $('#stageHint').textContent = 'Download the engine to start.';
}

/* ---------------- download ---------------- */

$('#dlBtn').addEventListener('click', async () => {
  const btn = $('#dlBtn'), bar = $('#dlProgress'), err = $('#dlError');
  btn.disabled = true; err.hidden = true; bar.hidden = false;
  btn.textContent = 'Downloading…';
  try {
    await downloadEngine((p) => {
      bar.firstElementChild.style.width = `${(p * 100).toFixed(1)}%`;
      btn.textContent = `Downloading… ${Math.round(p * MODEL_SIZE_MB)} / ${MODEL_SIZE_MB} MB`;
    });
    $('#stageHint').textContent = 'Preview at your screen’s shape. The clock sits behind anything the engine marks as foreground.';
    await showStart();
  } catch (e) {
    err.textContent = `${e.message || 'Download failed'}. Check your connection and try again.`;
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Download engine'; bar.hidden = true;
  }
});

/* ---------------- choosing a photo ---------------- */

$('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openPhoto(f); });
for (const ev of ['dragenter', 'dragover']) stage.addEventListener(ev, (e) => { e.preventDefault(); $('#drop').classList.add('over'); });
for (const ev of ['dragleave', 'drop']) stage.addEventListener(ev, () => $('#drop').classList.remove('over'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f && $('#installCard').hidden) openPhoto(f); // only once the engine is installed
});
$('#newPhoto').addEventListener('click', () => $('#fileInput').click());

function busy(on, title, sub) {
  $('#busy').hidden = !on;
  if (title) $('#busyTitle').textContent = title;
  if (sub !== undefined) $('#busySub').textContent = sub;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function openPhoto(file) {
  let photo;
  try {
    photo = await decode(file);
  } catch {
    showFailure(new Error('That file couldn’t be opened as an image.'));
    return;
  }
  img = photo;
  $('#drop').hidden = true;
  $('#savedMsg').hidden = true;
  $('#wpName').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 32);
  busy(true, 'Finding depth…', 'This takes a few seconds and the page may pause briefly.');
  await nextFrame();
  $('#fail').hidden = true;
  try {
    if (!session) {
      $('#busyTitle').textContent = 'Starting the engine…';
      await nextFrame();
      session = await createSession();
      $('#busyTitle').textContent = 'Finding depth…';
      await nextFrame();
    }
    depthC = await depthWithRetry(img);
    editsC = blankEdits();
    threshold = autoThreshold(depthC);
    softness = 0.2;
    $('#depth').value = Math.round((1 - threshold) * 100);
    $('#soft').value = 20;
    $('#clockTop').value = 14;
    for (const id of ['depth', 'soft', 'clockTop', 'brushSize']) { paintRange($('#' + id)); }
    syncOutputs();
    $('#editPanel').hidden = false;
    $('#tipsCard').hidden = true;
    stage.classList.add('has-img');
    prepareSmall();
    render();
  } catch (e) {
    console.error('[engine]', e);
    img = null;
    stage.classList.remove('has-img');
    showFailure(e);
  } finally {
    busy(false);
  }
}

const errText = (e) => (e && (e.message || String(e))) || 'Unknown error';

async function createSession() {
  const bytes = await loadModelBytes();
  let first;
  for (const level of ['all', 'basic', 'disabled']) {
    try {
      return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: level });
    } catch (e) {
      console.warn(`[engine] session (${level}) failed:`, e);
      first = first || e;
    }
  }
  throw new Error('Starting the engine failed: ' + errText(first));
}

async function depthWithRetry(photo) {
  let first;
  for (const side of [518, 392, 266]) {
    try {
      return await estimateDepth(photo, side);
    } catch (e) {
      console.warn(`[engine] depth at ${side}px failed:`, e);
      first = first || e;
      $('#busyTitle').textContent = 'Retrying at a lower resolution…';
      await nextFrame();
    }
  }
  throw new Error('Finding depth failed: ' + errText(first));
}

function showFailure(e) {
  $('#failMsg').textContent = errText(e);
  $('#fail').hidden = false;
  $('#drop').hidden = true;
  $('#tipsCard').hidden = false;
}
$('#copyErr').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#failMsg').textContent); $('#copyErr').textContent = 'Copied'; } catch { /* ignore */ }
  setTimeout(() => { $('#copyErr').textContent = 'Copy error'; }, 1500);
});
$('#tryAgain').addEventListener('click', () => { $('#fail').hidden = true; $('#fileInput').click(); $('#drop').hidden = false; });
$('#redownload').addEventListener('click', async () => {
  await removeEngine();
  session = null;
  $('#fail').hidden = true;
  await showStart();
  $('#dlBtn').click();
});

function decode(file) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => { URL.revokeObjectURL(u); reject(new Error('decode')); };
    i.src = u;
  });
}

/* ---------------- depth ---------------- */

async function estimateDepth(photo, side = 518) {
  // Depth Anything expects the short side ≈ 518 px, both sides multiples of 14.
  const w0 = photo.naturalWidth, h0 = photo.naturalHeight;
  const s = side / Math.min(w0, h0);
  const tw = Math.max(14, Math.round((w0 * s) / 14) * 14);
  const th = Math.max(14, Math.round((h0 * s) / 14) * 14);
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo, 0, 0, tw, th);
  const px = g.getImageData(0, 0, tw, th).data;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const n = tw * th;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = (px[i * 4] / 255 - mean[0]) / std[0];
    input[n + i] = (px[i * 4 + 1] / 255 - mean[1]) / std[1];
    input[2 * n + i] = (px[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, th, tw]) };
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]] || Object.values(results)[0];
  const dims = out.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  const d = out.data;

  // Relative inverse depth (bigger = nearer). Normalise with robust percentiles.
  const sorted = Float32Array.from(d).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.995)];
  const span = hi - lo || 1;
  const dc = document.createElement('canvas');
  dc.width = ow; dc.height = oh;
  const dg = dc.getContext('2d');
  const im = dg.createImageData(ow, oh);
  for (let i = 0; i < ow * oh; i++) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) / span) * 255));
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  dg.putImageData(im, 0, 0);
  return dc;
}

// Otsu's method on the depth histogram: a good first split between "far" and "near".
function autoThreshold(dc) {
  const d = dc.getContext('2d').getImageData(0, 0, dc.width, dc.height).data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  const total = d.length / 4;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return Math.min(0.95, Math.max(0.05, t / 255));
}

function blankEdits() {
  const c = document.createElement('canvas');
  c.width = EDIT_W;
  c.height = Math.round((EDIT_W * img.naturalHeight) / img.naturalWidth);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/* ---------------- alpha (foreground mask) ---------------- */

function scaled(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Writes the foreground alpha into `rgba` (w × h, the photo's pixels). */
function applyAlpha(rgba, w, h, tint = false) {
  const dep = scaled(depthC, w, h);
  const ed = scaled(editsC, w, h);
  const band = 0.004 + softness * 0.12;
  const t = threshold * 255, lo = t - band * 255, hi = t + band * 255;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    let a = smooth(lo, hi, dep[p]);
    const add = ed[p] / 255, back = ed[p + 1] / 255;
    a = Math.max(a, add) * (1 - back);
    rgba[p + 3] = Math.round(a * 255);
    if (tint && a > 0.02) {
      rgba[p] = rgba[p] * 0.55 + 255 * 0.45;
      rgba[p + 1] = rgba[p + 1] * 0.55 + 70 * 0.45;
      rgba[p + 2] = rgba[p + 2] * 0.55 + 90 * 0.45;
    }
  }
}

/* ---------------- preview ---------------- */

function cover(iw, ih, W, H) {
  const s = Math.max(W / iw, H / ih);
  const dw = iw * s, dh = ih * s;
  return { x: (W - dw) / 2, y: (H - dh) * OBJ_Y, w: dw, h: dh, s };
}

function sizeCanvases() {
  const dpr = devicePixelRatio || 1;
  const W = Math.round(stage.clientWidth * dpr), H = Math.round(stage.clientHeight * dpr);
  for (const c of [bgC, fgC, curC]) { if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } }
  return { W, H };
}

function prepareSmall() {
  const { W, H } = sizeCanvases();
  const r = cover(img.naturalWidth, img.naturalHeight, W, H);
  const w = Math.min(img.naturalWidth, Math.round(r.w)), h = Math.round((w * img.naturalHeight) / img.naturalWidth);
  small = { w, h, data: scaled(img, w, h) };
}

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}
function draw() {
  if (!img) return;
  const { W, H } = sizeCanvases();
  const r = cover(img.naturalWidth, img.naturalHeight, W, H);
  const bg = bgC.getContext('2d');
  bg.imageSmoothingQuality = 'high';
  bg.clearRect(0, 0, W, H);
  bg.drawImage(img, r.x, r.y, r.w, r.h);

  const tmp = document.createElement('canvas');
  tmp.width = small.w; tmp.height = small.h;
  const tg = tmp.getContext('2d');
  const im = new ImageData(new Uint8ClampedArray(small.data), small.w, small.h);
  applyAlpha(im.data, small.w, small.h, $('#showMask').checked);
  tg.putImageData(im, 0, 0);
  const fg = fgC.getContext('2d');
  fg.imageSmoothingQuality = 'high';
  fg.clearRect(0, 0, W, H);
  fg.drawImage(tmp, r.x, r.y, r.w, r.h);
}

new ResizeObserver(() => { if (img) { prepareSmall(); render(); } }).observe(stage);

/* ---------------- controls ---------------- */

function syncOutputs() {
  $('#depthOut').textContent = $('#depth').value;
  $('#softOut').textContent = $('#soft').value;
  $('#brushOut').textContent = $('#brushSize').value + ' px';
  $('#clockTopOut').textContent = $('#clockTop').value + '%';
  stage.style.setProperty('--clock-top', $('#clockTop').value + '%');
}
$('#depth').addEventListener('input', () => { threshold = Math.min(0.97, Math.max(0.03, 1 - $('#depth').value / 100)); syncOutputs(); render(); });
$('#soft').addEventListener('input', () => { softness = $('#soft').value / 100; syncOutputs(); render(); });
$('#clockTop').addEventListener('input', syncOutputs);
$('#brushSize').addEventListener('input', syncOutputs);
$('#showMask').addEventListener('change', render);
for (const b of document.querySelectorAll('#brushSeg button')) {
  b.addEventListener('click', () => {
    brush = b.dataset.brush;
    document.querySelectorAll('#brushSeg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    stage.classList.toggle('brushing', brush !== 'off');
    if (brush !== 'off' && !$('#showMask').checked) { $('#showMask').checked = true; render(); }
    clearCursor();
  });
}
$('#clearEdits').addEventListener('click', () => { if (img) { editsC = blankEdits(); render(); } });

/* ---------------- brush ---------------- */

let painting = false, last = null;

function toEdit(ev) {
  const dpr = devicePixelRatio || 1;
  const rect = stage.getBoundingClientRect();
  const sx = (ev.clientX - rect.left) * dpr, sy = (ev.clientY - rect.top) * dpr;
  const r = cover(img.naturalWidth, img.naturalHeight, fgC.width, fgC.height);
  const k = editsC.width / r.w;
  return { x: (sx - r.x) * k, y: (sy - r.y) * k, rad: $('#brushSize').value * dpr * k / 2, sx, sy };
}

function dab(p) {
  const g = editsC.getContext('2d');
  const col = brush === 'add' ? '255,0,0' : '0,255,0';
  const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rad);
  grad.addColorStop(0, `rgba(${col},1)`);
  grad.addColorStop(0.65, `rgba(${col},1)`);
  grad.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grad;
  g.beginPath(); g.arc(p.x, p.y, p.rad, 0, Math.PI * 2); g.fill();
}

function strokeTo(p) {
  if (last) {
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    const step = Math.max(1, p.rad / 3);
    for (let d = step; d < dist; d += step) {
      const t = d / dist;
      dab({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t, rad: p.rad });
    }
  }
  dab(p);
  last = p;
  render();
}

function drawCursor(ev) {
  const g = curC.getContext('2d');
  g.clearRect(0, 0, curC.width, curC.height);
  if (brush === 'off' || !img) return;
  const p = toEdit(ev);
  const r = ($('#brushSize').value * (devicePixelRatio || 1)) / 2;
  g.lineWidth = 2 * (devicePixelRatio || 1);
  g.strokeStyle = brush === 'add' ? 'rgba(255,140,150,.95)' : 'rgba(160,230,255,.95)';
  g.beginPath(); g.arc(p.sx, p.sy, r, 0, Math.PI * 2); g.stroke();
}
const clearCursor = () => curC.getContext('2d').clearRect(0, 0, curC.width, curC.height);

stage.addEventListener('pointerdown', (ev) => {
  if (brush === 'off' || !img || !$('#busy').hidden) return;
  painting = true; last = null;
  stage.setPointerCapture(ev.pointerId);
  strokeTo(toEdit(ev));
});
stage.addEventListener('pointermove', (ev) => { drawCursor(ev); if (painting) strokeTo(toEdit(ev)); });
stage.addEventListener('pointerup', () => { painting = false; last = null; });
stage.addEventListener('pointerleave', () => { if (!painting) clearCursor(); });

/* ---------------- save ---------------- */

const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

$('#saveBtn').addEventListener('click', async () => {
  if (!img) return;
  const btn = $('#saveBtn');
  btn.disabled = true; $('#saveError').hidden = true;
  busy(true, 'Saving wallpaper…', 'Building the full-resolution layers.');
  await nextFrame();
  try {
    const k = Math.min(1, MAX_SAVE / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
    const full = document.createElement('canvas');
    full.width = W; full.height = H;
    const fg = full.getContext('2d', { willReadFrequently: true });
    fg.imageSmoothingQuality = 'high';
    fg.drawImage(img, 0, 0, W, H);
    const bgBlob = await toBlob(full, 'image/jpeg', 0.9);

    const im = fg.getImageData(0, 0, W, H);
    applyAlpha(im.data, W, H, false);
    fg.putImageData(im, 0, 0);
    const fgBlob = await toBlob(full, 'image/webp', 0.9);

    const tw = 480, th = Math.round((480 * H) / W);
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    const tg = t.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(img, 0, 0, tw, th);
    const thumb = await toBlob(t, 'image/jpeg', 0.82);

    const id = 'wp_' + Date.now().toString(36);
    await putWallpaper({
      id,
      name: $('#wpName').value.trim() || 'My wallpaper',
      createdAt: Date.now(),
      bg: bgBlob, fg: fgBlob, thumb,
      clockTop: +$('#clockTop').value,
    });
    // Set it as the current wallpaper (read fresh so other changes aren't overwritten).
    const { state } = await store.get('state');
    const mode = state?.profiles?.find((p) => p.id === state.activeProfile);
    if (mode) {
      mode.wallpaper = id;            // wallpapers are per mode (Chill / Work)
      await store.set({ state });
    }
    $('#savedMsg').hidden = false;
    tellParent('horizon-engine-saved');
  } catch (e) {
    console.error(e);
    $('#saveError').textContent = 'Couldn’t save this wallpaper. Try again.';
    $('#saveError').hidden = false;
  } finally {
    busy(false);
    btn.disabled = false;
  }
});

/* ---------------- start ---------------- */

loadSettings();
showStart();
