// Page controls: a floating paper-coloured bar at the bottom with three mood buttons, a time-of-day slider and a quality
// choice; plus the card shown when WebGL 2 is missing or start-up fails. System font stack only, styles injected from here.
import { PRESET_NAMES, PRESETS, presetLabel, presetBlurb } from '../look/presets.js';
import { QUALITY_LEVELS } from '../look/quality.js';
import { clock } from '../look/timeofday.js';
import { PLAN_NAMES } from './params.js';

const STR = {
  en: { time: 'Time of day', quality: 'Image quality', auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low', lang: 'PL', reset: 'Reset view', resetTitle: 'Back to the starting view', hint: 'Drag to turn',
    edit: 'Edit', editDone: 'Done', editTitle: 'Edit the furniture layout', editDoneTitle: 'Leave the layout editor', saveImage: 'Save image', saveImageTitle: 'Save the current view as a PNG picture', loadPlan: 'Load plan', loadPlanTitle: 'Replace the plan with one of your own (a file or pasted text)',
    shell: 'Open the shell', shellClose: 'Close the shell', shellTitle: 'Let the outer walls fall open round the plan (Space or Esc folds them back)', shellCloseTitle: 'Fold the outer walls back up',
    plans: 'Example plans', 'flat-1': 'Flat', 'flat-1Title': 'Show the example flat: one floor, five rooms', 'duplex-1': 'Duplex', 'duplex-1Title': 'Show the example duplex: two floors joined by a stair',
    qualityHelp: 'High: sharper picture, soft accurate shadows, darker corners, a glow round the lamps, blurred top and bottom of the frame, shine and film grain; slower and uses more battery. Medium: in between. Low: faster and lighter on the battery, with fewer effects. Auto picks a level for your device.' },
  pl: { time: 'Pora dnia', quality: 'Jakość obrazu', auto: 'Auto', high: 'Wysoka', medium: 'Średnia', low: 'Niska', lang: 'EN', reset: 'Reset widoku', resetTitle: 'Wróć do widoku początkowego', hint: 'Przeciągnij, żeby obrócić',
    edit: 'Edytuj', editDone: 'Zakończ edycję', editTitle: 'Edytuj układ mebli', editDoneTitle: 'Zamknij edytor układu', saveImage: 'Zapisz obraz', saveImageTitle: 'Zapisz bieżący widok jako obraz PNG', loadPlan: 'Wczytaj plan', loadPlanTitle: 'Zastąp plan własnym (plik albo wklejony tekst)',
    shell: 'Otwórz bryłę', shellClose: 'Złóż bryłę', shellTitle: 'Rozłóż ściany zewnętrzne wokół rzutu (spacja albo Esc składa je z powrotem)', shellCloseTitle: 'Złóż ściany zewnętrzne z powrotem',
    plans: 'Przykładowe plany', 'flat-1': 'Mieszkanie', 'flat-1Title': 'Pokaż przykładowe mieszkanie: jedno piętro, pięć pomieszczeń', 'duplex-1': 'Dupleks', 'duplex-1Title': 'Pokaż przykładowy dupleks: dwa piętra połączone schodami',
    qualityHelp: 'Wysoka: ostrzejszy obraz, miękkie dokładne cienie, ciemnienie w narożnikach, poświata lamp, rozmycie góry i dołu kadru, połysk i ziarno; działa wolniej i zużywa więcej baterii. Średnia: pośrodku. Niska: szybciej i oszczędniej, mniej efektów. Auto dobiera poziom do urządzenia.' },
};
// Texts of the edit bar (shown with edit=1): the visible word, and the longer label for screen readers and tooltips.
export const EDIT_STR = {
  en: { turn: 'Rotate piece', turnLabel: 'Rotate the selected piece by 90 degrees', remove: 'Delete', removeLabel: 'Delete the selected piece', undo: 'Undo', undoLabel: 'Undo the last change', redo: 'Redo', redoLabel: 'Redo the change you undid',
    auto: 'Reset layout', autoLabel: 'Reset the layout: all furniture goes back to the automatic arrangement', more: 'File', moreLabel: 'File: save, load and paste a layout, save the picture, load a plan', group: 'Edit the layout',
    duplicate: 'Duplicate piece', save: 'Save layout', load: 'Load from file', paste: 'Paste layout', image: 'Save image', plan: 'Load plan', menu: 'File actions', hint: 'Tap a piece to select it, drag to move it' },
  pl: { turn: 'Obróć mebel', turnLabel: 'Obróć zaznaczony mebel o 90 stopni', remove: 'Usuń', removeLabel: 'Usuń zaznaczony mebel', undo: 'Cofnij', undoLabel: 'Cofnij ostatnią zmianę', redo: 'Ponów', redoLabel: 'Ponów cofniętą zmianę',
    auto: 'Układ od nowa', autoLabel: 'Układ od nowa: wszystkie meble wracają do układu automatycznego', more: 'Plik', moreLabel: 'Plik: zapisz, wczytaj i wklej układ, zapisz obraz, wczytaj plan', group: 'Edycja układu',
    duplicate: 'Powiel mebel', save: 'Zapisz układ', load: 'Wczytaj z pliku', paste: 'Wklej układ', image: 'Zapisz obraz', plan: 'Wczytaj plan', menu: 'Działania na plikach', hint: 'Dotknij mebla, żeby go zaznaczyć, przeciągnij, żeby przesunąć' },
};
export const ERROR_TEXT = {
  en: { title: 'This page needs WebGL 2', body: 'Your browser or device did not give us a WebGL 2 context. Try a current Chrome, Edge, Firefox or Safari and make sure hardware acceleration is on.' },
  pl: { title: 'Ta strona potrzebuje WebGL 2', body: 'Przeglądarka lub urządzenie nie udostępniło kontekstu WebGL 2. Użyj aktualnego Chrome, Edge, Firefox lub Safari i włącz przyspieszenie sprzętowe.' },
};

const CSS = `
:root{--ink:#4a3b2a;--paper:rgba(250,245,234,.84);--line:rgba(120,96,64,.22);--accent:#c8793a}
#ps-ui,#ps-card{font:13px/1.35 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink)}
#ps-ui{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:16px;padding:8px 14px;border-radius:20px;background:var(--paper);box-shadow:0 10px 30px rgba(40,28,12,.28),0 1px 0 rgba(255,255,255,.6) inset;border:1px solid var(--line);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);max-width:calc(100vw - 20px);box-sizing:border-box}
#ps-ui .moods{display:flex;gap:6px}
#ps-ui button.mood{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 12px 6px 8px;border-radius:14px;border:1px solid transparent;font-weight:600;letter-spacing:.01em}
#ps-ui button.mood:hover{background:rgba(200,121,58,.1)}
#ps-ui button.mood[aria-pressed=true]{background:#fffaf0;border-color:var(--line);box-shadow:0 2px 8px rgba(70,48,20,.14)}
#ps-ui button.mood:focus-visible,#ps-ui select:focus-visible,#ps-ui input:focus-visible,#ps-ui button.lang:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#ps-ui .dot{width:18px;height:18px;border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.12) inset}
#ps-ui .sep{width:1px;align-self:stretch;background:var(--line)}
#ps-ui label.time{display:grid;grid-template-columns:1fr auto;grid-template-areas:"name clock" "slider slider";align-items:end;gap:0 10px;min-width:260px}
#ps-ui .tname{grid-area:name;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.75}
#ps-ui .clock{grid-area:clock;font-variant-numeric:tabular-nums;font-weight:700;font-size:16px;text-align:right}
#ps-ui input[type=range]{grid-area:slider;-webkit-appearance:none;appearance:none;width:100%;height:44px;margin:0;background:transparent;cursor:pointer}
@media (pointer:fine) and (min-width:761px){#ps-ui input[type=range]{height:30px}}
#ps-ui input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--accent) 0 var(--fill,50%),rgba(120,96,64,.26) var(--fill,50%) 100%)}
#ps-ui input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;box-sizing:border-box;width:16px;height:30px;margin-top:-12px;border-radius:6px;background:#fffaf0;border:2px solid var(--accent);box-shadow:0 2px 6px rgba(0,0,0,.28)}
#ps-ui input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:rgba(120,96,64,.26)}
#ps-ui input[type=range]::-moz-range-progress{height:6px;border-radius:3px;background:var(--accent)}
#ps-ui input[type=range]::-moz-range-thumb{box-sizing:border-box;width:16px;height:30px;border-radius:6px;background:#fffaf0;border:2px solid var(--accent);box-shadow:0 2px 6px rgba(0,0,0,.28)}
#ps-ui select{font:inherit;color:inherit;background:#fffaf0;border:1px solid var(--line);border-radius:10px;padding:5px 8px}
#ps-ui button.lang{all:unset;cursor:pointer;font-weight:700;font-size:11px;letter-spacing:.08em;padding:5px 8px;border-radius:8px;border:1px solid var(--line)}
#ps-ui .blurb{position:absolute;left:50%;transform:translateX(-50%);bottom:100%;margin-bottom:8px;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis;text-align:center;font-size:12px;color:var(--ink);background:var(--paper);padding:3px 12px;border-radius:12px;border:1px solid var(--line);pointer-events:none}
#ps-ui label.quality{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.02em}
#ps-ui button.reset{all:unset;cursor:pointer;font-weight:600;font-size:12px;padding:5px 10px;border-radius:10px;border:1px solid var(--line);white-space:nowrap}
#ps-ui button.reset:hover{background:rgba(200,121,58,.1)}
#ps-ui button.reset:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#ps-ui-msg{position:absolute;left:50%;bottom:calc(100% + 40px);transform:translateX(-50%);max-width:calc(100vw - 24px);box-sizing:border-box;padding:5px 12px;border-radius:12px;background:var(--paper);border:1px solid var(--line);box-shadow:0 6px 18px rgba(40,28,12,.22);font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
#ps-ui-msg:empty{display:none}
#ps-ui .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#ps-ui .tools{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
#ps-ui button.tool{all:unset;cursor:pointer;box-sizing:border-box;min-width:44px;min-height:44px;padding:0 12px;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:600;font-size:12px;border-radius:12px;border:1px solid var(--line);white-space:nowrap;touch-action:manipulation}
#ps-ui button.tool:hover{background:rgba(200,121,58,.1)}
#ps-ui button.tool:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#ps-hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);font:600 13px/1.3 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--paper);padding:6px 14px;border-radius:16px;border:1px solid var(--line);box-shadow:0 6px 18px rgba(40,28,12,.22);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);pointer-events:none;max-width:calc(100vw - 24px);box-sizing:border-box;text-align:center}
@media (min-width:761px) and (max-width:1380px){#ps-ui{flex-wrap:wrap;justify-content:center}#ps-ui .tools{flex-basis:100%}#ps-ui .sep{display:none}}
@media (min-width:1381px){#ps-ui.has-tools{flex-wrap:wrap;justify-content:center}#ps-ui.has-tools .tools{flex-basis:100%}#ps-ui.has-tools .sep{display:none}}
#ps-ui .plans{display:flex;gap:6px}
#ps-ui button.tool[aria-pressed=true]{background:#fffaf0;box-shadow:0 2px 8px rgba(70,48,20,.14)}
@media (max-width:760px){#ps-ui{flex-wrap:wrap;justify-content:center;gap:8px}#ps-ui label.time{min-width:100%}#ps-ui label.quality{flex-direction:column;align-items:flex-start;gap:2px}#ps-ui select{padding:4px 6px}}
@media (max-width:760px),(pointer:coarse){#ps-ui button.mood{min-height:44px;box-sizing:border-box}#ps-ui select{min-height:44px;box-sizing:border-box}#ps-ui button.reset,#ps-ui button.lang{min-height:44px;min-width:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center}}
@media (max-width:760px){#ps-ui.editing label.quality,#ps-ui.editing .sep{display:none}}
#ps-edit{position:fixed;z-index:40;left:50%;bottom:96px;transform:translateX(-50%);display:flex;gap:6px;padding:6px 8px;border-radius:18px;background:var(--paper);border:1px solid var(--line);box-shadow:0 8px 24px rgba(40,28,12,.26);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);max-width:calc(100vw - 12px);box-sizing:border-box;font:600 12px/1.2 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink)}
#ps-edit button{all:unset;cursor:pointer;box-sizing:border-box;min-width:44px;min-height:44px;padding:0 9px;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:12px;border:1px solid var(--line);background:#fffaf0;font-weight:600;touch-action:manipulation;white-space:nowrap}
#ps-edit button:hover:not([disabled]){background:rgba(200,121,58,.14)}
#ps-edit button[disabled]{opacity:.36;cursor:default}
#ps-edit button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:560px){#ps-edit{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding:6px;width:calc(100vw - 12px)}#ps-edit button{padding:0 2px;font-size:11px;line-height:1.1;white-space:normal;overflow-wrap:anywhere}}
#ps-edit-hint{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;padding:6px 12px;border-radius:12px;background:var(--paper);border:1px solid var(--line);box-shadow:0 6px 18px rgba(40,28,12,.22);font-weight:600;text-align:center;pointer-events:none}
#ps-edit-hint:empty,#ps-edit-msg:not(:empty)~#ps-edit-hint{display:none}
#ps-edit-menu{position:absolute;right:0;bottom:calc(100% + 8px);min-width:180px;display:grid;gap:4px;padding:6px;border-radius:16px;background:var(--paper);border:1px solid var(--line);box-shadow:0 8px 24px rgba(40,28,12,.26);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
#ps-edit-menu[hidden]{display:none}
#ps-edit-menu button{justify-content:flex-start;padding:0 14px}
#ps-edit-msg{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);max-width:calc(100vw - 24px);padding:5px 12px;border-radius:12px;background:var(--paper);border:1px solid var(--line);box-shadow:0 6px 18px rgba(40,28,12,.22);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
#ps-edit-msg:empty{display:none}
#ps-edit-panel{position:fixed;right:10px;top:10px;max-width:calc(100vw - 20px);max-height:calc(100vh - 140px);overflow:auto}
#ps-edit-panel:empty{display:none}
#ps-card{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#efe6d4;padding:24px;box-sizing:border-box}
#ps-card .box{max-width:520px;padding:28px 30px;border-radius:22px;background:#fffaf0;border:1px solid var(--line);box-shadow:0 14px 40px rgba(60,40,10,.2)}
#ps-card h1{font-size:20px;margin:0 0 8px}#ps-card p{margin:0 0 18px}#ps-card h1:last-of-type{margin-top:6px}#ps-card .detail{font:11px/1.4 ui-monospace,Menlo,monospace;opacity:.6;white-space:pre-wrap;margin:0}
`;

export function injectStyles(doc = document) {
  if (doc.getElementById('ps-style')) return;
  const s = doc.createElement('style'); s.id = 'ps-style'; s.textContent = CSS; doc.head.appendChild(s);
}

// Card for a missing WebGL 2 or a failed start: English and Polish side by side, plus the technical detail.
export function showErrorCard(detail = '', doc = document) {
  injectStyles(doc);
  doc.getElementById('ps-card')?.remove();
  const card = doc.createElement('div'); card.id = 'ps-card'; card.setAttribute('role', 'alert');
  const box = doc.createElement('div'); box.className = 'box';
  for (const lang of ['en', 'pl']) {
    const h = doc.createElement('h1'); h.textContent = ERROR_TEXT[lang].title; h.lang = lang;
    const p = doc.createElement('p'); p.textContent = ERROR_TEXT[lang].body; p.lang = lang;
    box.append(h, p);
  }
  if (detail) { const d = doc.createElement('pre'); d.className = 'detail'; d.textContent = String(detail).slice(0, 400); box.append(d); }
  card.append(box); doc.body.appendChild(card);
  return card;
}

// state: { preset, t, q ('auto' or a level), autoLevel (what Auto picks here, shown beside Auto; the level in use when missing), level, lang };
// handlers: { onPreset(name), onTime(t), onQuality(q), onLang(lang), onReset(), onEdit(), onSaveImage(), onLoadPlan(), onPlan(name), onShell() }; the returned object has hideHint() for the first-visit hint and say(text) for one short result line.
// state.tools shows the extra buttons (the example plans, the open shell, edit mode, save the picture, load a plan; hidden by btn=0 in the address); state.editing turns the edit button into "Done" and hides
// the example plans, Save image and Load plan (the shell button stays and works). state.plan names the example on show (null: none), state.shell adds the shell button, state.shellOpen says it is open.
export function createUI(handlers, state, doc = document) {
  injectStyles(doc);
  const root = doc.createElement('div'); root.id = 'ps-ui';
  const blurb = doc.createElement('div'); blurb.className = 'blurb';
  const moods = doc.createElement('div'); moods.className = 'moods'; moods.setAttribute('role', 'group');
  const buttons = {};
  for (const name of PRESET_NAMES) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'mood'; b.dataset.preset = name;
    const dot = doc.createElement('span'); dot.className = 'dot';
    const sw = PRESETS[name].swatch; dot.style.background = `linear-gradient(135deg, ${sw[0]} 0 50%, ${sw[2]} 50% 100%)`;
    const label = doc.createElement('span'); b.append(dot, label); b.addEventListener('click', () => handlers.onPreset(name));
    moods.append(b); buttons[name] = { b, label };
  }
  const sep1 = doc.createElement('div'); sep1.className = 'sep';
  const timeLabel = doc.createElement('label'); timeLabel.className = 'time';
  const timeName = doc.createElement('span'); timeName.className = 'tname';
  const slider = doc.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.005';
  const clk = doc.createElement('span'); clk.className = 'clock';
  slider.addEventListener('input', () => handlers.onTime(Number(slider.value)));
  timeLabel.append(timeName, slider, clk);
  const sep2 = doc.createElement('div'); sep2.className = 'sep';
  const qLabel = doc.createElement('label'); qLabel.className = 'quality';
  const qName = doc.createElement('span');
  const qSel = doc.createElement('select');
  for (const q of ['auto', ...QUALITY_LEVELS]) { const o = doc.createElement('option'); o.value = q; qSel.append(o); }
  qSel.addEventListener('change', () => handlers.onQuality(qSel.value));
  const qHelp = doc.createElement('span'); qHelp.className = 'sr'; qHelp.id = 'ps-quality-help'; qSel.setAttribute('aria-describedby', 'ps-quality-help');
  qLabel.append(qName, qSel, qHelp);
  const reset = doc.createElement('button'); reset.type = 'button'; reset.className = 'reset';
  reset.addEventListener('click', () => handlers.onReset?.());
  const lang = doc.createElement('button'); lang.type = 'button'; lang.className = 'lang';
  lang.addEventListener('click', () => handlers.onLang(state.lang === 'pl' ? 'en' : 'pl'));
  const tools = doc.createElement('div'); tools.className = 'tools'; tools.setAttribute('role', 'group');
  // the example plans: one button each, the one on show is pressed (none when the plan came from a file); they leave the bar while editing
  const plans = doc.createElement('div'); plans.className = 'plans'; plans.setAttribute('role', 'group');
  const planBtns = {};
  for (const name of PLAN_NAMES) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'tool plan'; b.dataset.plan = name;
    b.addEventListener('click', () => handlers.onPlan?.(name));
    plans.append(b); planBtns[name] = b;
  }
  tools.append(plans);
  const toolBtns = {};
  for (const [key, handler] of [...(state.shell ? [['shell', 'onShell']] : []), ['edit', 'onEdit'], ['saveImage', 'onSaveImage'], ['loadPlan', 'onLoadPlan']]) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'tool'; b.dataset.tool = key;
    b.addEventListener('click', () => handlers[handler]?.());
    tools.append(b); toolBtns[key] = b;
  }
  const msg = doc.createElement('div'); msg.id = 'ps-ui-msg'; msg.setAttribute('role', 'status');
  root.append(blurb, msg, moods, sep1, timeLabel, sep2, qLabel, reset, lang, tools);
  doc.body.appendChild(root);
  // a hint for the first visit; it goes away at the first turn of the model
  let hint = doc.createElement('div'); hint.id = 'ps-hint'; hint.setAttribute('role', 'status'); doc.body.appendChild(hint);

  function update(s) {
    Object.assign(state, s);
    const L = STR[state.lang] ?? STR.en;
    for (const name of PRESET_NAMES) { buttons[name].label.textContent = presetLabel(name, state.lang); buttons[name].b.setAttribute('aria-pressed', String(name === state.preset)); }
    blurb.textContent = presetBlurb(state.preset, state.lang);
    timeName.textContent = L.time; slider.value = String(state.t); slider.style?.setProperty?.('--fill', `calc(8px + (100% - 16px) * ${Math.min(1, Math.max(0, Number(state.t) || 0))})`); slider.setAttribute('aria-label', L.time); clk.textContent = clock(state.t).text;
    qName.textContent = L.quality; qHelp.textContent = L.qualityHelp; qLabel.title = L.qualityHelp; qSel.title = L.qualityHelp;
    const autoPick = state.autoLevel ?? state.level; // the level that Auto stands for on this device
    for (const o of qSel.options) o.textContent = o.value === 'auto' && L[autoPick] ? `${L.auto}: ${L[autoPick].toLowerCase()}` : L[o.value];
    qSel.value = state.q;
    reset.textContent = L.reset; reset.title = L.resetTitle; reset.setAttribute('aria-label', L.resetTitle);
    if (hint) hint.textContent = L.hint;
    lang.textContent = L.lang; lang.setAttribute('aria-label', state.lang === 'pl' ? 'English' : 'Polski');
    tools.style.display = state.tools ? '' : 'none';
    const editLabel = state.editing ? L.editDone : L.edit, editTitle = state.editing ? L.editDoneTitle : L.editTitle;
    toolBtns.edit.textContent = editLabel; toolBtns.edit.title = editTitle; toolBtns.edit.setAttribute('aria-label', editTitle);
    toolBtns.saveImage.textContent = L.saveImage; toolBtns.saveImage.title = L.saveImageTitle; toolBtns.saveImage.setAttribute('aria-label', L.saveImageTitle);
    toolBtns.saveImage.style.display = state.editing ? 'none' : '';
    toolBtns.loadPlan.textContent = L.loadPlan; toolBtns.loadPlan.title = L.loadPlanTitle; toolBtns.loadPlan.setAttribute('aria-label', L.loadPlanTitle);
    toolBtns.loadPlan.style.display = state.editing ? 'none' : '';
    if (toolBtns.shell) { // the button of the open shell: its word and its hint follow the state (it works the same while editing)
      const open = !!state.shellOpen, label = open ? L.shellClose : L.shell;
      toolBtns.shell.textContent = label; toolBtns.shell.title = open ? L.shellCloseTitle : L.shellTitle; toolBtns.shell.setAttribute('aria-label', label);
    }
    plans.setAttribute('aria-label', L.plans); plans.style.display = state.editing ? 'none' : '';
    for (const name of PLAN_NAMES) {
      const b = planBtns[name];
      b.textContent = L[name]; b.title = L[`${name}Title`]; b.setAttribute('aria-label', L[`${name}Title`]); b.setAttribute('aria-pressed', String(name === state.plan));
    }
    root.className = [state.editing ? 'editing' : '', state.tools ? 'has-tools' : ''].filter(Boolean).join(' ');
    doc.documentElement.lang = state.lang;
  }
  update(state);
  let msgTimer = null; // one short line above the bar (a result of saving a picture or loading a plan)
  const say = (text, ms = 6000, title = '') => { msg.textContent = String(text ?? ''); msg.title = title || ''; if (msg.style) msg.style.pointerEvents = title ? 'auto' : ''; if (msgTimer !== null) clearTimeout(msgTimer); msgTimer = text ? setTimeout(() => { msg.textContent = ''; msgTimer = null; }, ms) : null; };
  return { root, update, say, hideHint: () => { if (hint) { hint.remove(); hint = null; } }, setVisible: (v) => { root.style.display = v ? '' : 'none'; if (hint) hint.style.display = v ? '' : 'none'; }, dispose: () => { root.remove(); hint?.remove(); } };
}

// The edit bar (edit=1): Rotate piece, Delete, Undo, Redo, Reset layout and File, one row above the controls, every button at least 44 px; File opens a
// small menu above the bar (Duplicate piece, Save layout, Load from file, Paste layout, Save image, Load plan) that closes on a tap outside or Escape; plus the empty
// container #ps-edit-panel that other parts of the page fill. handlers: { onTurn(), onRemove(), onUndo(), onRedo(), onAuto(), onDuplicate(),
// onSave(), onLoad(), onPaste(), onSaveImage(), onLoadPlan() }. update({ lang, selected, canUndo, canRedo }) sets the language and which buttons are enabled; `anchor` is the
// control bar that the edit bar sits above. say(text, ms, title) shows one short line above the bar for a few seconds (title: the longer original shown on hover). The height of everything stacked at
// the bottom (this bar, the mood caption, the controls) is published as the CSS variable --ps-stack-h on the root element.
export function createEditBar(handlers, state = {}, doc = document, anchor = null) {
  injectStyles(doc);
  const root = doc.createElement('div'); root.id = 'ps-edit'; root.setAttribute('role', 'toolbar');
  const defs = [['turn', 'onTurn'], ['remove', 'onRemove'], ['undo', 'onUndo'], ['redo', 'onRedo'], ['auto', 'onAuto']];
  const buttons = {};
  for (const [key, handler] of defs) {
    const b = doc.createElement('button'); b.type = 'button'; b.dataset.edit = key;
    b.addEventListener('click', () => { if (!b.disabled) handlers[handler]?.(); });
    root.append(b); buttons[key] = b;
  }
  const more = doc.createElement('button'); more.type = 'button'; more.dataset.edit = 'more'; more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
  buttons.more = more; root.append(more);
  const menu = doc.createElement('div'); menu.id = 'ps-edit-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  const items = {};
  const itemDefs = [['duplicate', 'onDuplicate'], ['save', 'onSave'], ['load', 'onLoad'], ['paste', 'onPaste'], ['image', 'onSaveImage'], ['plan', 'onLoadPlan']];
  const setOpen = (v) => { menu.hidden = !v; more.setAttribute('aria-expanded', String(!!v)); };
  for (const [key, handler] of itemDefs) {
    const b = doc.createElement('button'); b.type = 'button'; b.dataset.editItem = key; b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => { if (b.disabled) return; setOpen(false); handlers[handler]?.(); });
    menu.append(b); items[key] = b;
  }
  more.addEventListener('click', () => setOpen(menu.hidden));
  const msg = doc.createElement('div'); msg.id = 'ps-edit-msg'; msg.setAttribute('role', 'status');
  const hint = doc.createElement('div'); hint.id = 'ps-edit-hint'; hint.setAttribute('role', 'status');
  let hintDone = false; // the one-time hint goes away at the first selection
  root.append(menu, msg, hint);
  const panel = doc.createElement('div'); panel.id = 'ps-edit-panel';
  doc.body.append(root, panel);
  let msgTimer = null;
  const timers = doc.defaultView ?? (typeof window !== 'undefined' ? window : globalThis);
  function say(text, ms = 6000, title = '') {
    msg.textContent = String(text ?? ''); msg.title = title || ''; if (msg.style) msg.style.pointerEvents = title ? 'auto' : '';
    if (msgTimer !== null) timers.clearTimeout?.(msgTimer);
    msgTimer = text ? (timers.setTimeout?.(() => { msg.textContent = ''; msgTimer = null; }, ms) ?? null) : null;
  }
  // a tap outside the bar closes the menu; Escape closes it before anything else reacts to the key
  const onOutside = (e) => { if (!menu.hidden && !root.contains?.(e.target)) setOpen(false); };
  const onKey = (e) => { if (!menu.hidden && e.key === 'Escape') { setOpen(false); e.stopPropagation?.(); e.preventDefault?.(); } };
  doc.addEventListener?.('pointerdown', onOutside, true); doc.addEventListener?.('keydown', onKey, true);
  function place() { // sits one line above the control bar (and the line of its mood caption), wherever the bar has grown to
    const h = anchor?.root?.offsetHeight || anchor?.offsetHeight || 0;
    root.style.bottom = `${(h ? h + 18 : 78) + 8 + 30}px`;
    const top = root.getBoundingClientRect?.().top, vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
    if (Number.isFinite(top) && vh > 0 && top > 0) doc.documentElement?.style?.setProperty?.('--ps-stack-h', `${Math.round(vh - top)}px`);
  }
  function update(s = {}) {
    Object.assign(state, s);
    const L = EDIT_STR[state.lang] ?? EDIT_STR.en;
    root.setAttribute('aria-label', L.group); menu.setAttribute('aria-label', L.menu);
    for (const [key] of defs) { buttons[key].textContent = L[key]; buttons[key].title = L[`${key}Label`]; buttons[key].setAttribute('aria-label', L[`${key}Label`]); }
    more.textContent = L.more; more.title = L.moreLabel; more.setAttribute('aria-label', L.moreLabel);
    for (const [key] of itemDefs) items[key].textContent = L[key];
    if (state.selected) hintDone = true;
    hint.textContent = hintDone ? '' : L.hint;
    buttons.turn.disabled = !state.selected; buttons.remove.disabled = !state.selected; items.duplicate.disabled = !state.selected;
    buttons.undo.disabled = !state.canUndo; buttons.redo.disabled = !state.canRedo; buttons.auto.disabled = false;
    place();
  }
  const onResize = () => place();
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
  update(state);
  return {
    root, panel, menu, items, buttons, update, place, say, setMenuOpen: setOpen,
    dispose: () => {
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
      doc.removeEventListener?.('pointerdown', onOutside, true); doc.removeEventListener?.('keydown', onKey, true);
      if (msgTimer !== null) timers.clearTimeout?.(msgTimer);
      root.remove(); panel.remove();
    },
  };
}
