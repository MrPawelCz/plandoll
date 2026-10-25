// File helpers: save text as a download, read a text file the visitor picks, and a small paste dialog.
// Everything goes through the document passed in, so it can run against stubs. Nothing is stored or sent anywhere.

export const LAYOUT_FILENAME = 'planstage-layout.json';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

// A browser API from the document's own view when it has one, else the global one.
const api = (doc, name) => doc?.defaultView?.[name] ?? globalThis[name];
const isText = (s) => typeof s === 'string' && s.length > 0;

// Takes a node out of the page, whatever its flavour; never throws.
function detach(node) {
  try { if (typeof node?.remove === 'function') node.remove(); else node?.parentNode?.removeChild(node); } catch { /* already gone */ }
}

// Frees an object URL right away, or after a delay when the caller asks for one.
function release(doc, urls, url, delayMs) {
  if (!url || typeof urls?.revokeObjectURL !== 'function') return;
  const revoke = () => { try { urls.revokeObjectURL(url); } catch { /* nothing to free */ } };
  if (!(delayMs > 0)) { revoke(); return; }
  try {
    const win = doc.defaultView;
    if (typeof win?.setTimeout === 'function') win.setTimeout(revoke, delayMs); else setTimeout(revoke, delayMs);
  } catch { revoke(); }
}

// Offers `text` as a download called `filename` through a temporary hidden link.
// Returns true once the link was clicked, false (never throws) when it could not be done. opts: { revokeDelayMs } (default 0 = at once).
export function saveTextFile(doc, filename, text, opts = {}) {
  if (!isText(text) || !isText(filename)) return false;
  let link = null, url = null, urls = null, ok = false;
  try {
    const BlobType = api(doc, 'Blob');
    urls = api(doc, 'URL');
    if (typeof BlobType === 'function' && typeof urls?.createObjectURL === 'function' && doc?.body) {
      url = urls.createObjectURL(new BlobType([text], { type: 'application/json' }));
      link = doc.createElement('a');
      link.href = url; link.download = filename; link.style.display = 'none';
      doc.body.appendChild(link);
      link.click();
      ok = true;
    }
  } catch { ok = false; }
  detach(link);
  release(doc, urls, url, opts?.revokeDelayMs);
  return ok;
}

const fail = (error) => ({ ok: false, error });

// Opens the file picker and resolves with { ok: true, text } or { ok: false, error }, error being one of
// 'cancelled' | 'read-failed' | 'too-large' | 'unsupported'. Never rejects. Call it from a click handler.
export function readTextFile(doc) {
  return new Promise((resolve) => {
    let input = null, done = false, started = false;
    const finish = (result) => { if (done) return; done = true; detach(input); resolve(result); };
    try {
      const Reader = api(doc, 'FileReader');
      if (typeof Reader !== 'function' || typeof doc?.createElement !== 'function') return finish(fail('unsupported'));
      input = doc.createElement('input');
      if (typeof input.click !== 'function') return finish(fail('unsupported'));
      input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none';
      input.addEventListener('cancel', () => { if (!started) finish(fail('cancelled')); });
      input.addEventListener('change', () => {
        if (done || started) return;
        try {
          const file = input.files?.[0];
          if (!file) return finish(fail('cancelled'));
          if (file.size > MAX_FILE_BYTES) return finish(fail('too-large'));
          started = true;
          const reader = new Reader();
          reader.onload = () => {
            const text = reader.result;
            if (typeof text !== 'string') finish(fail('read-failed'));
            else if (text.length > MAX_FILE_BYTES) finish(fail('too-large'));
            else finish({ ok: true, text });
          };
          reader.onerror = reader.onabort = () => finish(fail('read-failed'));
          reader.readAsText(file);
        } catch { finish(fail('read-failed')); }
      });
      doc.body?.appendChild(input); // kept in the page while the picker is open, removed when finished
      input.click();
    } catch { finish(fail('read-failed')); }
  });
}

const STR = {
  en: { title: 'Paste a layout', hint: 'Paste the text of a saved layout and press Load.', field: 'Layout text', load: 'Load', cancel: 'Cancel' },
  pl: { title: 'Wklej układ', hint: 'Wklej tekst zapisanego układu i naciśnij Wczytaj.', field: 'Tekst układu', load: 'Wczytaj', cancel: 'Anuluj' },
};

const CSS = `
#ps-files-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(8,6,4,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
#ps-files-overlay .ps-files-dialog{width:min(92vw,560px);max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;padding:18px;border-radius:18px;color:#f4ede1;background:rgba(26,22,18,.82);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);font:14px/1.4 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif}
#ps-files-overlay h2{margin:0 0 6px;font-size:18px;line-height:1.25;font-weight:700}
#ps-files-overlay p{margin:0 0 12px;opacity:.8}
#ps-files-overlay textarea{display:block;width:100%;height:40vh;min-height:140px;box-sizing:border-box;resize:vertical;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35);color:inherit;-webkit-user-select:text;user-select:text;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#ps-files-overlay .ps-files-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
#ps-files-overlay button{flex:1 1 130px;min-height:44px;padding:8px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:inherit;font:inherit;font-weight:600;cursor:pointer}
#ps-files-overlay button.ps-files-load{background:#c8793a;border-color:#c8793a;color:#1c130a}
#ps-files-overlay button:hover{filter:brightness(1.15)}
#ps-files-overlay textarea:focus-visible,#ps-files-overlay button:focus-visible{outline:2px solid #ffb680;outline-offset:2px}
@media (pointer:coarse){#ps-files-overlay textarea{font-size:16px}}
`;

function ensureStyle(doc) {
  if (doc.getElementById('ps-files-style')) return;
  const s = doc.createElement('style'); s.id = 'ps-files-style'; s.textContent = CSS; (doc.head ?? doc.body).appendChild(s);
}

const el = (doc, tag, props) => Object.assign(doc.createElement(tag), props);
const showing = new WeakMap(); // document -> close function of the dialog that is showing

// Modal for pasting layout text. Resolves with the text, or null when cancelled, blank, too long, or the dialog could not be built.
// Escape or a click on the dim background cancels; Ctrl or Cmd + Enter loads. Only one dialog per document at a time.
export function askForText(doc, lang) {
  return new Promise((resolve) => {
    let overlay = null, before = null, settled = false;
    const finish = (value) => {
      if (settled) return; settled = true;
      if (showing.get(doc) === finish) showing.delete(doc);
      detach(overlay);
      try { before?.focus?.(); } catch { /* focus stays where it is */ }
      resolve(value);
    };
    try {
      if (typeof doc?.createElement !== 'function' || !doc.body) return resolve(null);
      showing.get(doc)?.(null); // an older dialog closes first, answering null
      detach(doc.getElementById?.('ps-files-overlay'));
      ensureStyle(doc);
      const L = lang === 'pl' ? STR.pl : STR.en;
      overlay = el(doc, 'div', { id: 'ps-files-overlay', className: 'ps-files-overlay' });
      const dialog = el(doc, 'div', { className: 'ps-files-dialog' });
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'ps-files-title'); dialog.setAttribute('aria-describedby', 'ps-files-hint');
      const title = el(doc, 'h2', { id: 'ps-files-title', textContent: L.title });
      const hint = el(doc, 'p', { id: 'ps-files-hint', textContent: L.hint });
      const area = el(doc, 'textarea', { id: 'ps-files-text', spellcheck: false });
      area.setAttribute('aria-label', L.field);
      const row = el(doc, 'div', { className: 'ps-files-actions' });
      const load = el(doc, 'button', { type: 'button', className: 'ps-files-load', textContent: L.load });
      const cancel = el(doc, 'button', { type: 'button', className: 'ps-files-cancel', textContent: L.cancel });
      const submit = () => {
        const text = area.value;
        finish(typeof text !== 'string' || text.trim() === '' || text.length > MAX_FILE_BYTES ? null : text);
      };
      load.addEventListener('click', submit);
      cancel.addEventListener('click', () => finish(null));
      const order = [area, load, cancel];
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault?.(); finish(null); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault?.(); submit(); }
        else if (e.key === 'Tab') { // keep the focus inside the dialog
          const i = order.indexOf(doc.activeElement);
          if (e.shiftKey ? i <= 0 : i === -1 || i === order.length - 1) { e.preventDefault?.(); order[e.shiftKey ? order.length - 1 : 0].focus?.(); }
        }
        e.stopPropagation?.(); // typing here must not reach the page's own key handling
      });
      let pressedInside = false; // a text selection that ends on the dim background must not close the dialog
      overlay.addEventListener('pointerdown', (e) => { pressedInside = e.target !== overlay; });
      overlay.addEventListener('click', (e) => { const inside = pressedInside; pressedInside = false; if (e.target === overlay && !inside) finish(null); });
      row.append(load, cancel); dialog.append(title, hint, area, row); overlay.append(dialog);
      doc.body.appendChild(overlay);
      showing.set(doc, finish);
      before = doc.activeElement ?? null;
      area.focus?.();
    } catch { finish(null); }
  });
}
