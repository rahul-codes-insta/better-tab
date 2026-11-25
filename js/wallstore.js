// Wallpapers (IndexedDB) and the downloadable 3D Wallpaper Engine model (Cache Storage).
// Shared by the new tab page and the engine page — both run on the extension's origin.

/* ---------------- wallpapers ---------------- */

const DB_NAME = 'horizon';
const DB_VERSION = 1;
const STORE = 'wallpapers';

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  }));
}

/** { id, name, createdAt, bg: Blob, fg: Blob|null, thumb: Blob, clockTop: number(vh) } */
export const putWallpaper = (w) => tx('readwrite', (s) => { s.put(w); return w; });
export const getWallpaper = (id) => tx('readonly', (s) => s.get(id));
export const deleteWallpaper = (id) => tx('readwrite', (s) => s.delete(id));
export async function listWallpapers() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => a.createdAt - b.createdAt);
}

/* ---------------- engine model ---------------- */

// Depth Anything V2 Small (Apache-2.0), 8-bit quantised ONNX export — about 27 MB.
// "model_quantized" is the variant Transformers.js uses by default in browsers.
export const MODEL_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx';
export const MODEL_SIZE_MB = 27;
const CACHE = 'horizon-engine-v2';
const OLD_CACHES = ['horizon-engine-v1'];

export async function engineInstalled() {
  try {
    const c = await caches.open(CACHE);
    return !!(await c.match(MODEL_URL));
  } catch {
    return false;
  }
}

/** Download the model once, reporting progress (0–1). Resolves when cached. */
export async function downloadEngine(onProgress = () => {}, signal) {
  const res = await fetch(MODEL_URL, { signal, credentials: 'omit' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = +res.headers.get('content-length') || MODEL_SIZE_MB * 1024 * 1024;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  if (got < 1_000_000) throw new Error('Download was incomplete');
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  // ONNX files are protobuf; a stray HTML/JSON error page would start with "<" or "{".
  const head = new Uint8Array(await blob.slice(0, 1).arrayBuffer())[0];
  if (head === 0x3c || head === 0x7b) throw new Error('The server sent a web page instead of the model');
  const c = await caches.open(CACHE);
  await c.put(MODEL_URL, new Response(blob, { headers: { 'content-length': String(blob.size) } }));
  for (const old of OLD_CACHES) await caches.delete(old).catch(() => {});
  onProgress(1);
  return blob.size;
}

export async function loadModelBytes() {
  const c = await caches.open(CACHE);
  const r = await c.match(MODEL_URL);
  if (!r) throw new Error('Engine is not downloaded');
  return new Uint8Array(await r.arrayBuffer());
}

/** Remove the model (wallpapers you already made are kept). */
export async function removeEngine() {
  await caches.delete(CACHE);
  for (const old of OLD_CACHES) await caches.delete(old).catch(() => {});
}
