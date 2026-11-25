// Thin wrapper over chrome.storage.local, with a localStorage fallback so the
// page can also be previewed as a plain web page.
const local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

export async function get(keys) {
  if (local) return chrome.storage.local.get(keys);
  const out = {};
  for (const k of [].concat(keys)) {
    const v = localStorage.getItem(k);
    if (v != null) out[k] = JSON.parse(v);
  }
  return out;
}

export async function set(obj) {
  if (local) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) localStorage.setItem(k, JSON.stringify(v));
}

export async function remove(keys) {
  if (local) return chrome.storage.local.remove(keys);
  for (const k of [].concat(keys)) localStorage.removeItem(k);
}

export async function getAll() {
  if (local) return chrome.storage.local.get(null);
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    try { out[k] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ }
  }
  return out;
}

export function onChange(fn) {
  if (local && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') fn(changes); });
  } else {
    window.addEventListener('storage', (e) => fn({ [e.key]: {} }));
  }
}
