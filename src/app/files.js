// File helpers: save text as a download, read a text file the visitor picks, and a small paste dialog.
// Everything goes through the document passed in, so it can run against stubs. Nothing is stored or sent anywhere.

import { MAX_PLAN_CHARS } from '../core/limits.js';

export const LAYOUT_FILENAME = 'plandoll-layout.json';
export const IMAGE_FILENAME = 'plandoll-view.png';
// One limit everywhere (core/limits.js): the longest pasted text, chosen file or plan, in characters.
export const MAX_FILE_BYTES = MAX_PLAN_CHARS;
// How long the address of a download stays valid after the click (the browser may start saving a moment later).
export const REVOKE_DELAY_MS = 10000;

// A browser API from the document's own view when it has one, else the global one.
const api = (doc, name) => doc?.defaultView?.[name] ?? globalThis[name];
const isText = (s) => typeof s === 'string' && s.length > 0;

// Takes a node out of the page, whatever its flavour; never throws.
function detach(node) {
  try { if (typeof node?.remove === 'function') node.remove(); else node?.parentNode?.removeChild(node); } catch { /* already gone */ }
}

// Frees an object URL right away (no delay), or after the delay.
function release(doc, urls, url, delayMs) {
  if (!url || typeof urls?.revokeObjectURL !== 'function') return;
  const revoke = () => { try { urls.revokeObjectURL(url); } catch { /* nothing to free */ } };
  if (!(delayMs > 0)) { revoke(); return; }
  try {
    const win = doc.defaultView;
    if (typeof win?.setTimeout === 'function') win.setTimeout(revoke, delayMs); else setTimeout(revoke, delayMs);
  } catch { revoke(); }
}

// Offers a Blob as a download called `filename` through a temporary hidden link. `make(BlobType)` builds the Blob (or returns null).
// Returns true once the link was clicked, false (never throws) when it could not be done. opts: { revokeDelayMs } (default 10000; a click that failed frees the address at once).
function offerDownload(doc, filename, make, opts = {}) {
  if (!isText(filename)) return false;
  let link = null, url = null, urls = null, ok = false;
  try {
    const BlobType = api(doc, 'Blob');
    urls = api(doc, 'URL');
    if (typeof BlobType === 'function' && typeof urls?.createObjectURL === 'function' && doc?.body) {
      const blob = make(BlobType);
      if (blob) {
        url = urls.createObjectURL(blob);
        link = doc.createElement('a');
        link.href = url; link.download = filename; link.style.display = 'none';
        doc.body.appendChild(link);
        link.click();
        ok = true;
      }
    }
  } catch { ok = false; }
  detach(link);
  release(doc, urls, url, ok ? (opts?.revokeDelayMs ?? REVOKE_DELAY_MS) : 0);
  return ok;
}

// Offers `text` as a download called `filename` through a temporary hidden link.
// Returns true once the link was clicked, false (never throws) when it could not be done. opts: { revokeDelayMs } (default 10000; a click that failed frees the address at once).
export function saveTextFile(doc, filename, text, opts = {}) {
  if (!isText(text)) return false;
  return offerDownload(doc, filename, (BlobType) => new BlobType([text], { type: 'application/json' }), opts);
}

// Offers an existing Blob (a picture, say) as a download called `filename`; true once the link was clicked, false (never throws) otherwise.
export function saveBlobFile(doc, filename, blob, opts = {}) {
  if (!blob || typeof blob !== 'object' || !(blob.size > 0)) return false;
  return offerDownload(doc, filename, () => blob, opts);
}

const fail = (error) => ({ ok: false, error });

// Opens the file picker and resolves with { ok: true, text } or { ok: false, error }, error being one of
// 'cancelled' | 'read-failed' | 'too-large' | 'unsupported'. Never rejects. Call it from a click handler.
const pickers = new WeakMap(); // document -> how to close the picker that is open now (only one at a time)

export function readTextFile(doc) {
  return new Promise((resolve) => {
    let input = null, done = false, started = false;
    const win = doc?.defaultView;
    const onFocus = () => { // a browser without a cancel event: the window gets the focus back and no file arrives
      const later = typeof win?.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
      later(() => { if (!done && !started && !(input?.files && input.files.length)) finish(fail('cancelled')); }, 1500);
    };
    const finish = (result) => {
      if (done) return; done = true;
      win?.removeEventListener?.('focus', onFocus);
      if (pickers.get(doc) === finish) pickers.delete(doc);
      detach(input); resolve(result);
    };
    try {
      const Reader = api(doc, 'FileReader');
      if (typeof Reader !== 'function' || typeof doc?.createElement !== 'function') return finish(fail('unsupported'));
      pickers.get(doc)?.(fail('cancelled')); // an older picker that never answered is closed first
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
      pickers.set(doc, finish); win?.addEventListener?.('focus', onFocus);
      input.click();
    } catch { finish(fail('read-failed')); }
  });
}

// Why a text or a file was refused, shown in the dialog and by the page (PL and EN).
const REASON = {
  en: { empty: 'There is nothing to load: the field is empty.', tooLong: 'The text is too long (2 MB at most).', fileTooLarge: 'The file is too large (2 MB at most).', fileFailed: 'The file could not be read.' },
  pl: { empty: 'Nie ma czego wczytać: pole jest puste.', tooLong: 'Tekst jest za długi (najwyżej 2 MB).', fileTooLarge: 'Plik jest za duży (najwyżej 2 MB).', fileFailed: 'Nie udało się odczytać pliku.' },
};
export const refusalText = (lang, key) => (REASON[lang === 'pl' ? 'pl' : 'en'][key] ?? REASON.en.fileFailed);

const STR = {
  en: { title: 'Paste a layout', hint: 'Paste the text of a saved layout and press Load.', field: 'Layout text', load: 'Load', cancel: 'Cancel' },
  pl: { title: 'Wklej układ', hint: 'Wklej tekst zapisanego układu i naciśnij Wczytaj.', field: 'Tekst układu', load: 'Wczytaj', cancel: 'Anuluj' },
};
const PLAN_STR = {
  en: { title: 'Load a plan', hint: 'Paste the text of a plan (JSON) or choose a file, then press Load.', field: 'Plan text', load: 'Load', cancel: 'Cancel', pick: 'Choose a file' },
  pl: { title: 'Wczytaj plan', hint: 'Wklej tekst planu (JSON) albo wybierz plik, potem naciśnij Wczytaj.', field: 'Tekst planu', load: 'Wczytaj', cancel: 'Anuluj', pick: 'Wybierz plik' },
};

const CSS = `
#ps-files-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(8,6,4,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
#ps-files-overlay .ps-files-dialog{width:min(92vw,560px);max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;padding:18px;border-radius:18px;color:#f4ede1;background:rgba(26,22,18,.82);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);font:14px/1.4 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif}
#ps-files-overlay h2{margin:0 0 6px;font-size:18px;line-height:1.25;font-weight:700}
#ps-files-overlay p{margin:0 0 12px;opacity:.8}
#ps-files-overlay textarea{display:block;width:100%;height:40vh;min-height:140px;box-sizing:border-box;resize:vertical;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35);color:inherit;-webkit-user-select:text;user-select:text;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#ps-files-overlay .ps-files-error{margin:10px 0 0;color:#ffb680;font-weight:600;opacity:1}
#ps-files-overlay .ps-files-error:empty{display:none}
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

// Modal for pasting layout text (opts.kind 'plan': the words of loading a plan, plus a button that fills the field from a file). Resolves with the text, or null when cancelled or the dialog could not be built;
// a blank or too long text keeps the dialog open and shows the reason.
// Escape or a click on the dim background cancels; Ctrl or Cmd + Enter loads. Only one dialog per document at a time.
export function askForText(doc, lang, opts = {}) {
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
      const plan = opts?.kind === 'plan', L = (plan ? PLAN_STR : STR)[lang === 'pl' ? 'pl' : 'en'];
      overlay = el(doc, 'div', { id: 'ps-files-overlay', className: 'ps-files-overlay' });
      const dialog = el(doc, 'div', { className: 'ps-files-dialog' });
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'ps-files-title'); dialog.setAttribute('aria-describedby', 'ps-files-hint');
      const title = el(doc, 'h2', { id: 'ps-files-title', textContent: L.title });
      const hint = el(doc, 'p', { id: 'ps-files-hint', textContent: L.hint });
      const area = el(doc, 'textarea', { id: 'ps-files-text', spellcheck: false });
      area.setAttribute('aria-label', L.field);
      const R = REASON[lang === 'pl' ? 'pl' : 'en'];
      const err = el(doc, 'p', { id: 'ps-files-error', className: 'ps-files-error' }); err.setAttribute('role', 'alert');
      const showError = (text) => { err.textContent = text; };
      area.addEventListener('input', () => showError(''));
      const row = el(doc, 'div', { className: 'ps-files-actions' });
      const load = el(doc, 'button', { type: 'button', className: 'ps-files-load', textContent: L.load });
      const cancel = el(doc, 'button', { type: 'button', className: 'ps-files-cancel', textContent: L.cancel });
      const submit = () => {
        const text = area.value;
        if (typeof text !== 'string' || text.trim() === '') { showError(R.empty); area.focus?.(); return; }
        if (text.length > MAX_FILE_BYTES) { showError(R.tooLong); return; }
        showError(''); finish(text);
      };
      load.addEventListener('click', submit);
      cancel.addEventListener('click', () => finish(null));
      const order = [area, load, cancel];
      let pick = null; // a plan can also come from a file: its text goes into the field, so it can be looked at before it is loaded
      if (plan) {
        pick = el(doc, 'button', { type: 'button', className: 'ps-files-pick', textContent: L.pick });
        pick.addEventListener('click', () => {
          readTextFile(doc).then((r) => {
            if (settled) return;
            if (r.ok) { area.value = r.text; showError(''); } else if (r.error !== 'cancelled') showError(r.error === 'too-large' ? R.fileTooLarge : R.fileFailed);
          });
        });
        order.splice(2, 0, pick);
      }
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
      row.append(...(pick ? [load, pick, cancel] : [load, cancel])); dialog.append(title, hint, area, err, row); overlay.append(dialog);
      doc.body.appendChild(overlay);
      showing.set(doc, finish);
      before = doc.activeElement ?? null;
      area.focus?.();
    } catch { finish(null); }
  });
}

// Copies text to the clipboard: the modern call first (it needs a secure page), then the old selection command. Resolves true when it was copied, false otherwise; never rejects.
export async function copyText(win, text) {
  if (!isText(text)) return false;
  try {
    const clip = win?.navigator?.clipboard;
    if (typeof clip?.writeText === 'function' && win.isSecureContext !== false) { await clip.writeText(text); return true; }
  } catch { /* the old way below */ }
  let area = null;
  try {
    const doc = win?.document;
    if (!doc?.body || typeof doc.execCommand !== 'function') return false;
    area = doc.createElement('textarea');
    area.value = text; area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    doc.body.appendChild(area);
    area.select?.(); area.setSelectionRange?.(0, text.length);
    return !!doc.execCommand('copy');
  } catch { return false; } finally { detach(area); }
}

const LINK_STR = {
  en: { title: 'Link to this layout', hint: 'Copy the link and send it to someone: whoever opens it sees this layout. The whole layout is in the link, nothing is stored anywhere.', field: 'Link', copy: 'Copy', close: 'Close', copied: 'Copied', failed: 'Could not copy: select the link and copy it by hand.' },
  pl: { title: 'Link do tego układu', hint: 'Skopiuj link i wyślij go komuś: kto go otworzy, zobaczy ten układ. Cały układ jest w linku, nic nie jest nigdzie zapisywane.', field: 'Link', copy: 'Kopiuj', close: 'Zamknij', copied: 'Skopiowano', failed: 'Nie udało się skopiować: zaznacz link i skopiuj go ręcznie.' },
};

// A dialog that shows a link, for a page that cannot copy it by itself (an address that is not secure, a browser that refuses): the link is in a field that selects itself, with a Copy button.
// opts.note is one more sentence under the hint. Escape, Close and a click on the dim background close it. Returns { close } or null when the dialog could not be built.
export function showLinkDialog(doc, lang, url, opts = {}) {
  let overlay = null, before = null, closed = false;
  const finish = () => {
    if (closed) return; closed = true;
    if (showing.get(doc) === finish) showing.delete(doc);
    detach(overlay);
    try { before?.focus?.(); } catch { /* focus stays where it is */ }
  };
  try {
    if (typeof doc?.createElement !== 'function' || !doc.body || !isText(url)) return null;
    showing.get(doc)?.(null); // an older dialog closes first
    detach(doc.getElementById?.('ps-files-overlay'));
    ensureStyle(doc);
    const L = LINK_STR[lang === 'pl' ? 'pl' : 'en'];
    overlay = el(doc, 'div', { id: 'ps-files-overlay', className: 'ps-files-overlay' });
    const dialog = el(doc, 'div', { className: 'ps-files-dialog' });
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'ps-files-title'); dialog.setAttribute('aria-describedby', 'ps-files-hint');
    const title = el(doc, 'h2', { id: 'ps-files-title', textContent: L.title });
    const hint = el(doc, 'p', { id: 'ps-files-hint', textContent: opts?.note ? `${L.hint} ${opts.note}` : L.hint });
    const area = el(doc, 'textarea', { id: 'ps-files-text', spellcheck: false, readOnly: true, value: url });
    area.setAttribute('aria-label', L.field);
    area.addEventListener('focus', () => { try { area.select?.(); } catch { /* nothing to select */ } });
    const status = el(doc, 'p', { id: 'ps-files-error', className: 'ps-files-error' }); status.setAttribute('role', 'status');
    const row = el(doc, 'div', { className: 'ps-files-actions' });
    const copy = el(doc, 'button', { type: 'button', className: 'ps-files-load', textContent: L.copy });
    const close = el(doc, 'button', { type: 'button', className: 'ps-files-cancel', textContent: L.close });
    copy.addEventListener('click', () => {
      copyText(doc.defaultView, url).then((ok) => { if (closed) return; status.textContent = ok ? L.copied : L.failed; if (!ok) { try { area.focus?.(); area.select?.(); } catch { /* by hand then */ } } });
    });
    close.addEventListener('click', finish);
    const order = [area, copy, close];
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.preventDefault?.(), finish();
      else if (e.key === 'Tab') { // keep the focus inside the dialog
        const i = order.indexOf(doc.activeElement);
        if (e.shiftKey ? i <= 0 : i === -1 || i === order.length - 1) { e.preventDefault?.(); order[e.shiftKey ? order.length - 1 : 0].focus?.(); }
      }
      e.stopPropagation?.(); // keys here must not reach the page's own key handling
    });
    let pressedInside = false; // a text selection that ends on the dim background must not close the dialog
    overlay.addEventListener('pointerdown', (e) => { pressedInside = e.target !== overlay; });
    overlay.addEventListener('click', (e) => { const inside = pressedInside; pressedInside = false; if (e.target === overlay && !inside) finish(); });
    row.append(copy, close); dialog.append(title, hint, area, status, row); overlay.append(dialog);
    doc.body.appendChild(overlay);
    showing.set(doc, finish);
    before = doc.activeElement ?? null;
    copy.focus?.();
    return { close: finish };
  } catch { finish(); return null; }
}
