// In-app pop-ups that replace the browser's confirm() and alert().
//   if (await uiConfirm({ title, message, confirmLabel: 'Delete', danger: true })) …
//   await uiAlert({ title, message });

const CSS = `
dialog.ui-pop {
  width: min(380px, calc(100vw - 40px)); padding: 22px 22px 18px; border-radius: 22px;
  color: #f2f6f7; background: rgba(8, 12, 14, .74);
  border: 1px solid rgba(255,255,255,.1);
  backdrop-filter: blur(34px) saturate(160%); -webkit-backdrop-filter: blur(34px) saturate(160%);
  box-shadow: 0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
  font: 500 14px/1.45 Inter, system-ui, sans-serif;
}
dialog.ui-pop[open] { animation: uiPopIn .22s cubic-bezier(.2,.8,.2,1); }
@keyframes uiPopIn { from { opacity: 0; transform: translateY(8px) scale(.97); } }
dialog.ui-pop::backdrop { background: rgba(0, 6, 8, .35); backdrop-filter: blur(3px); }
dialog.ui-pop h3 { margin: 0 0 6px; font-size: 16.5px; font-weight: 650; color: #fff; text-transform: none; letter-spacing: -.005em; }
dialog.ui-pop p { margin: 0; }
.ui-pop p { margin: 0; color: rgba(255,255,255,.66); font-size: 13.5px; }
.ui-pop .ui-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.ui-pop button {
  border: 0; cursor: pointer; padding: 9px 16px; border-radius: 11px;
  font: 600 13.5px Inter, system-ui, sans-serif; transition: background .15s, transform .1s;
}
.ui-pop button:active { transform: scale(.97); }
.ui-pop .ui-cancel { background: rgba(255,255,255,.09); color: #fff; }
.ui-pop .ui-cancel:hover { background: rgba(255,255,255,.16); }
.ui-pop .ui-ok { background: #fff; color: #0d1214; }
.ui-pop .ui-ok:hover { background: rgba(255,255,255,.85); }
.ui-pop .ui-ok.danger { background: #ff6b5e; color: #fff; }
.ui-pop .ui-ok.danger:hover { background: #ff8379; }
.ui-pop button:focus-visible { outline: 2px solid rgba(255,255,255,.8); outline-offset: 2px; }
`;

let styled = false;
function ensureStyle() {
  if (styled) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
  styled = true;
}

function open({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, alertOnly = false }) {
  ensureStyle();
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ui-pop';
    d.innerHTML = `<h3></h3><p></p><div class="ui-actions">${alertOnly ? '' : '<button type="button" class="ui-cancel"></button>'}<button type="button" class="ui-ok"></button></div>`;
    d.querySelector('h3').textContent = title || '';
    d.querySelector('p').textContent = message || '';
    const ok = d.querySelector('.ui-ok');
    ok.textContent = confirmLabel;
    if (danger) ok.classList.add('danger');
    const cancel = d.querySelector('.ui-cancel');
    if (cancel) cancel.textContent = cancelLabel;
    let result = false;
    const finish = (v) => { result = v; d.close(); };
    ok.addEventListener('click', () => finish(true));
    cancel?.addEventListener('click', () => finish(false));
    d.addEventListener('click', (e) => { if (e.target === d) finish(alertOnly); }); // click outside = cancel
    d.addEventListener('close', () => { d.remove(); resolve(alertOnly ? true : result); });
    document.body.append(d);
    d.showModal();
    (danger && cancel ? cancel : ok).focus();      // safe default for destructive actions
  });
}

export const uiConfirm = (opts) => open(opts);
export const uiAlert = (opts) => open({ confirmLabel: 'OK', ...opts, alertOnly: true });
