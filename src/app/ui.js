// Page controls: a floating paper-coloured bar at the bottom with three mood buttons, a time-of-day slider and a quality
// choice; plus the card shown when WebGL 2 is missing or start-up fails. System font stack only, styles injected from here.
import { PRESET_NAMES, PRESETS, presetLabel, presetBlurb } from '../look/presets.js';
import { QUALITY_LEVELS } from '../look/quality.js';
import { clock } from '../look/timeofday.js';

const STR = {
  en: { time: 'Time of day', quality: 'Image quality', auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low', lang: 'PL', reset: 'Reset view', resetTitle: 'Back to the starting view', hint: 'Drag to turn',
    qualityHelp: 'High: sharper picture, soft accurate shadows, darker corners, a glow round the lamps, blurred top and bottom of the frame, shine and film grain; slower and uses more battery. Medium: in between. Low: faster and lighter on the battery, with fewer effects. Auto picks a level for your device.' },
  pl: { time: 'Pora dnia', quality: 'Jakość obrazu', auto: 'Auto', high: 'Wysoka', medium: 'Średnia', low: 'Niska', lang: 'EN', reset: 'Reset widoku', resetTitle: 'Wróć do widoku początkowego', hint: 'Przeciągnij, żeby obrócić',
    qualityHelp: 'Wysoka: ostrzejszy obraz, miękkie dokładne cienie, ciemnienie w narożnikach, poświata lamp, rozmycie góry i dołu kadru, połysk i ziarno; działa wolniej i zużywa więcej baterii. Średnia: pośrodku. Niska: szybciej i oszczędniej, mniej efektów. Auto dobiera poziom do urządzenia.' },
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
#ps-ui label.time{display:flex;align-items:center;gap:10px;min-width:260px}
#ps-ui .clock{font-variant-numeric:tabular-nums;font-weight:700;min-width:3.4em;text-align:right}
#ps-ui input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:8px;border-radius:6px;background:linear-gradient(90deg,#ffb48a 0%,#e8eefc 18%,#f6f2e8 40%,#ffc88a 62%,#ff9a44 73%,#6e5f94 83%,#1d2a4e 100%);box-shadow:0 0 0 1px rgba(60,40,10,.18) inset}
#ps-ui input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fffaf0;border:2px solid var(--ink);box-shadow:0 2px 6px rgba(0,0,0,.3)}
#ps-ui input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fffaf0;border:2px solid var(--ink)}
#ps-ui select{font:inherit;color:inherit;background:#fffaf0;border:1px solid var(--line);border-radius:10px;padding:5px 8px}
#ps-ui button.lang{all:unset;cursor:pointer;font-weight:700;font-size:11px;letter-spacing:.08em;padding:5px 8px;border-radius:8px;border:1px solid var(--line)}
#ps-ui .blurb{position:absolute;left:50%;transform:translateX(-50%);bottom:100%;margin-bottom:8px;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis;text-align:center;font-size:12px;color:var(--ink);background:var(--paper);padding:3px 12px;border-radius:12px;border:1px solid var(--line);pointer-events:none}
#ps-ui label.quality{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.02em}
#ps-ui button.reset{all:unset;cursor:pointer;font-weight:600;font-size:12px;padding:5px 10px;border-radius:10px;border:1px solid var(--line);white-space:nowrap}
#ps-ui button.reset:hover{background:rgba(200,121,58,.1)}
#ps-ui button.reset:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#ps-ui .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#ps-hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);font:600 13px/1.3 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--paper);padding:6px 14px;border-radius:16px;border:1px solid var(--line);box-shadow:0 6px 18px rgba(40,28,12,.22);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);pointer-events:none;max-width:calc(100vw - 24px);box-sizing:border-box;text-align:center}
@media (max-width:760px){#ps-ui{flex-wrap:wrap;justify-content:center;gap:8px}#ps-ui label.time{min-width:100%}#ps-ui label.quality{flex-direction:column;align-items:flex-start;gap:2px}#ps-ui select{padding:4px 6px}}
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
// handlers: { onPreset(name), onTime(t), onQuality(q), onLang(lang), onReset() }; the returned object has hideHint() for the first-visit hint.
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
  const timeName = doc.createElement('span');
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
  root.append(blurb, moods, sep1, timeLabel, sep2, qLabel, reset, lang);
  doc.body.appendChild(root);
  // a hint for the first visit; it goes away at the first turn of the model
  let hint = doc.createElement('div'); hint.id = 'ps-hint'; hint.setAttribute('role', 'status'); doc.body.appendChild(hint);

  function update(s) {
    Object.assign(state, s);
    const L = STR[state.lang] ?? STR.en;
    for (const name of PRESET_NAMES) { buttons[name].label.textContent = presetLabel(name, state.lang); buttons[name].b.setAttribute('aria-pressed', String(name === state.preset)); }
    blurb.textContent = presetBlurb(state.preset, state.lang);
    timeName.textContent = L.time; slider.value = String(state.t); slider.setAttribute('aria-label', L.time); clk.textContent = clock(state.t).text;
    qName.textContent = L.quality; qHelp.textContent = L.qualityHelp; qLabel.title = L.qualityHelp; qSel.title = L.qualityHelp;
    const autoPick = state.autoLevel ?? state.level; // the level that Auto stands for on this device
    for (const o of qSel.options) o.textContent = o.value === 'auto' && L[autoPick] ? `${L.auto}: ${L[autoPick].toLowerCase()}` : L[o.value];
    qSel.value = state.q;
    reset.textContent = L.reset; reset.title = L.resetTitle; reset.setAttribute('aria-label', L.resetTitle);
    if (hint) hint.textContent = L.hint;
    lang.textContent = L.lang; lang.setAttribute('aria-label', state.lang === 'pl' ? 'English' : 'Polski');
    doc.documentElement.lang = state.lang;
  }
  update(state);
  return { root, update, hideHint: () => { if (hint) { hint.remove(); hint = null; } }, setVisible: (v) => { root.style.display = v ? '' : 'none'; if (hint) hint.style.display = v ? '' : 'none'; }, dispose: () => { root.remove(); hint?.remove(); } };
}
