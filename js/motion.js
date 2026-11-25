// Small motion helpers so layout changes glide instead of jumping.
const SPRING = 'cubic-bezier(.3, 1.25, .45, 1)';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const rectOf = (el) => {
  if (!el.isConnected || el.closest('[hidden]')) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? r : null;
};

/**
 * FLIP: remember where elements are, run `mutate`, then animate each element
 * from its old spot to its new one. Elements that weren't there before fade in.
 * `key` matches old and new elements when the DOM is rebuilt.
 */
export function measure(els, key = (el) => el) {
  const m = new Map();
  for (const el of els) { const r = rectOf(el); if (r) m.set(key(el), r); }
  return m;
}

export function play(before, els, { key = (el) => el, enter = true, duration = 560 } = {}) {
  if (reducedMotion()) return;
  for (const el of els) {
    const a = rectOf(el);
    if (!a) continue;
    const b = before.get(key(el));
    if (b) {
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration, easing: SPRING, composite: 'add' });
    } else if (enter) {
      el.animate([{ opacity: 0, transform: 'translateY(8px) scale(.94)' }, { opacity: 1, transform: 'none' }],
        { duration: 460, easing: SPRING, fill: 'backwards' });
    }
  }
}

export async function flip(getEls, mutate, opts = {}) {
  const before = measure(getEls(), opts.key);
  await mutate();
  play(before, getEls(), opts);
}

/** Fade and shrink an element away; resolves when it's gone from view. */
export function exit(el, { duration = 280 } = {}) {
  if (reducedMotion() || !el.isConnected) return Promise.resolve();
  return el.animate([{ opacity: 1, transform: 'none', filter: 'none' }, { opacity: 0, transform: 'scale(.9)', filter: 'blur(3px)' }],
    { duration, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' }).finished.catch(() => {});
}
