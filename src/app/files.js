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
  en: { title: 'Load a plan', hint: 'Paste the text of a plan (JSON) or choose a file, then press Load.', field: 'Plan text', load: 'Load', cancel: 'Cancel', pick: 'Choose a file',
    helpTitle: 'No plan file yet? Make one from a picture of your plan',
    helpSteps: [
      'Take a photo, a screenshot or a PDF page of your floor plan. Walls, doors and windows should be visible; sizes or room areas printed on it help to find the scale.',
      'Open an AI chat assistant that can read pictures, attach the picture and paste the prompt.',
      'Copy the whole answer of the assistant, paste it into the box below and press Load. The page finds the plan in it.',
      'If the page names a problem, copy its message and paste it back into the chat: ask for a corrected plan.',
    ],
    copyPrompt: 'Copy the prompt', promptCopied: 'Prompt copied. Paste it into the chat.', copyFailed: 'Could not copy. Open Show the prompt and copy the text by hand.',
    showPrompt: 'Show the prompt', promptField: 'The prompt for the assistant',
    privacy: 'The picture goes to the assistant you choose, under its own rules; plandoll itself sends nothing anywhere. Take names and addresses off the picture first.',
    copyMessage: 'Copy the message', messageCopied: 'Message copied. Paste it into the chat.', messageFailed: 'Could not copy. Select the message by hand.' },
  pl: { title: 'Wczytaj plan', hint: 'Wklej tekst planu (JSON) albo wybierz plik, potem naciśnij Wczytaj.', field: 'Tekst planu', load: 'Wczytaj', cancel: 'Anuluj', pick: 'Wybierz plik',
    helpTitle: 'Nie masz pliku z planem? Zrób go ze zdjęcia rzutu',
    helpSteps: [
      'Zrób zdjęcie, zrzut ekranu albo weź stronę PDF z rzutem mieszkania. Mają być widoczne ściany, drzwi i okna; wymiary lub powierzchnie pokoi na rysunku pomagają ustalić skalę.',
      'Otwórz asystenta AI do czatu, który czyta obrazy, dołącz obraz i wklej polecenie.',
      'Skopiuj całą odpowiedź asystenta, wklej ją do pola poniżej i naciśnij Wczytaj. Strona sama znajdzie w niej plan.',
      'Jeśli strona wskaże problem, skopiuj jej komunikat i wklej go z powrotem do czatu, prosząc o poprawiony plan.',
    ],
    copyPrompt: 'Kopiuj polecenie', promptCopied: 'Skopiowano polecenie. Wklej je do czatu.', copyFailed: 'Nie udało się skopiować. Otwórz Pokaż polecenie i skopiuj tekst ręcznie.',
    showPrompt: 'Pokaż polecenie', promptField: 'Polecenie dla asystenta',
    privacy: 'Obraz trafia do wybranego asystenta, na jego zasadach; plandoll niczego nigdzie nie wysyła. Usuń z obrazu imiona, nazwiska i adresy.',
    copyMessage: 'Kopiuj komunikat', messageCopied: 'Skopiowano komunikat. Wklej go do czatu.', messageFailed: 'Nie udało się skopiować. Zaznacz komunikat ręcznie.' },
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
#ps-files-overlay .ps-files-error{white-space:pre-wrap;overflow-wrap:anywhere}
#ps-files-overlay .ps-files-help{margin:0 0 12px;padding:2px 12px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05)}
#ps-files-overlay .ps-files-help summary{cursor:pointer;padding:9px 0;min-height:26px;font-weight:700;color:#ffb680}
#ps-files-overlay .ps-files-help summary:focus-visible{outline:2px solid #ffb680;outline-offset:2px;border-radius:6px}
#ps-files-overlay .ps-files-steps{margin:4px 0 10px;padding-left:22px}
#ps-files-overlay .ps-files-steps li{margin:8px 0;opacity:.92}
#ps-files-overlay .ps-files-steps li::marker{color:#ffb680;font-weight:700}
#ps-files-overlay .ps-files-help button,#ps-files-overlay .ps-files-msgrow button{display:block;flex:none;min-height:40px;margin-top:8px;padding:6px 14px}
#ps-files-overlay .ps-files-copied{display:block;margin-top:6px;color:#bfe3b4;font-weight:600}
#ps-files-overlay .ps-files-copied:empty{display:none}
#ps-files-overlay .ps-files-note{margin:0 0 8px;font-size:.92em;opacity:.75}
#ps-files-overlay .ps-files-prompt summary{font-weight:600;color:inherit;opacity:.85}
#ps-files-overlay .ps-files-help textarea{height:26vh;min-height:110px;font-size:12px}
#ps-files-overlay .ps-files-help[open] ~ #ps-files-text{height:22vh}
#ps-files-overlay .ps-files-msgrow{margin-top:8px}
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
// Plan kind only: opts.check(text) is asked before the dialog closes. null or undefined lets the text through; { message, detail } keeps the dialog open and shows the problem, with a button that
// copies it (to hand it back to the AI chat that made the plan). opts.help { prompt } adds a folded instruction on making a plan file from a picture of a floor plan, with a button that copies the prompt.
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
      const useCheck = plan && typeof opts?.check === 'function', useHelp = plan && isText(opts?.help?.prompt);
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
      // The problem that opts.check reported stays in the dialog (not a line that fades), with a button that copies it, so it can be pasted back into the chat that made the plan.
      const msgRow = el(doc, 'div', { className: 'ps-files-msgrow' }); msgRow.style.display = 'none';
      const copyMsg = el(doc, 'button', { type: 'button', className: 'ps-files-copymsg', textContent: L.copyMessage });
      const msgStatus = el(doc, 'span', { className: 'ps-files-copied' }); msgStatus.setAttribute('role', 'status');
      msgRow.append(copyMsg, msgStatus);
      let problemText = '';
      const showError = (text) => { err.textContent = text; problemText = ''; msgStatus.textContent = ''; msgRow.style.display = 'none'; };
      const showProblem = (p) => {
        const full = [p?.message, p?.detail].filter(isText).join('\n');
        if (!full) return false;
        err.textContent = full; problemText = full; msgStatus.textContent = ''; msgRow.style.display = '';
        return true;
      };
      copyMsg.addEventListener('click', () => {
        if (!problemText) return;
        copyText(doc.defaultView, problemText).then((ok) => { if (!settled) msgStatus.textContent = ok ? L.messageCopied : L.messageFailed; });
      });
      area.addEventListener('input', () => showError(''));
      const row = el(doc, 'div', { className: 'ps-files-actions' });
      const load = el(doc, 'button', { type: 'button', className: 'ps-files-load', textContent: L.load });
      const cancel = el(doc, 'button', { type: 'button', className: 'ps-files-cancel', textContent: L.cancel });
      const submit = () => {
        const text = area.value;
        if (typeof text !== 'string' || text.trim() === '') { showError(R.empty); area.focus?.(); return; }
        if (text.length > MAX_FILE_BYTES) { showError(R.tooLong); return; }
        if (useCheck) {
          let verdict = null;
          try { verdict = opts.check(text); } catch { verdict = null; } // a check that fails by itself lets the text through: the caller reads it again
          if (verdict && showProblem(verdict)) { area.focus?.(); return; }
        }
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
      // The folded instruction: three steps, a button that copies the prompt, the privacy line and the prompt itself to read (or to copy by hand when the clipboard refuses).
      let help = null;
      if (useHelp) {
        const prompt = opts.help.prompt;
        help = el(doc, 'details', { id: 'ps-files-help', className: 'ps-files-help' });
        const helpSummary = el(doc, 'summary', { textContent: L.helpTitle });
        const steps = el(doc, 'ol', { className: 'ps-files-steps' });
        const copyPrompt = el(doc, 'button', { type: 'button', className: 'ps-files-copyprompt', textContent: L.copyPrompt });
        const promptStatus = el(doc, 'span', { className: 'ps-files-copied' }); promptStatus.setAttribute('role', 'status');
        L.helpSteps.forEach((text, i) => {
          const li = el(doc, 'li', {});
          li.appendChild(el(doc, 'span', { textContent: text }));
          if (i === 1) li.append(copyPrompt, promptStatus);
          steps.appendChild(li);
        });
        const note = el(doc, 'p', { className: 'ps-files-note', textContent: L.privacy });
        const shown = el(doc, 'details', { className: 'ps-files-prompt' });
        const shownSummary = el(doc, 'summary', { textContent: L.showPrompt });
        const promptArea = el(doc, 'textarea', { className: 'ps-files-prompt-text', spellcheck: false, readOnly: true, value: prompt });
        promptArea.setAttribute('aria-label', L.promptField);
        promptArea.addEventListener('focus', () => { try { promptArea.select?.(); } catch { /* nothing to select */ } });
        shown.append(shownSummary, promptArea);
        help.append(helpSummary, steps, note, shown);
        copyPrompt.addEventListener('click', () => {
          copyText(doc.defaultView, prompt).then((ok) => {
            if (settled) return;
            promptStatus.textContent = ok ? L.promptCopied : L.copyFailed;
            if (!ok) { shown.open = true; try { promptArea.focus?.(); promptArea.select?.(); } catch { /* by hand then */ } }
          });
        });
        order.unshift(helpSummary, copyPrompt, shownSummary, promptArea); // every control of the dialog is listed in page order, so the Tab key never jumps from one that is missing
      }
      if (useCheck) order.splice(order.indexOf(area) + 1, 0, copyMsg);
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
      row.append(...(pick ? [load, pick, cancel] : [load, cancel]));
      dialog.append(title, hint, ...(help ? [help] : []), area, err, ...(useCheck ? [msgRow] : []), row); overlay.append(dialog);
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
