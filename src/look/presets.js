// Three named starting points on the time axis: amber (17:54), clear (11:26) and lamplit (22:40). A preset sets t and the colour tints of walls,
// floors and soft furnishings; the interpolated time of day (timeofday.js) does the rest. Plain data, no three.js.

export const PRESET_NAMES = Object.freeze(['amber', 'clear', 'lamplit']);
export const DEFAULT_PRESET = 'amber';

export const PRESETS = Object.freeze({
  amber: Object.freeze({
    id: 'amber', t: 0.70,
    name: { en: 'Amber', pl: 'Bursztyn' },
    blurb: { en: 'Home from work, the street turning gold.', pl: 'Powrót z pracy, ulica robi się złota.' },
    swatch: ['#f2d3a0', '#c79a6e', '#dc7a45'],
    palette: { wall: '#f2d3a0', floor: '#c79a6e', sofa: '#3a4f7e', cushion: '#566a98', accent: '#dc7a45', bed: '#f4ead8', rug: '#e4d7bb', rug2: '#cdbd9a', wood: '#a06a42', body: '#d9c3a0', drape: '#ead5b0', pot: '#b86f4b', tile: '#d6dade', art: ['#efe2c8', '#d4683a', '#2f4272', '#8aa07a'] },
  }),
  clear: Object.freeze({
    id: 'clear', t: 0.32,
    name: { en: 'Clear', pl: 'Jasno' },
    blurb: { en: 'A slow Saturday morning, windows open.', pl: 'Leniwa sobota przed południem, okna otwarte.' },
    swatch: ['#f1ede4', '#e6cfa8', '#7f93b6'],
    palette: { wall: '#f1ede4', floor: '#e6cfa8', sofa: '#7f93b6', cushion: '#98a9c6', accent: '#e08e60', bed: '#fbf7ee', rug: '#ece6d9', rug2: '#d8d1c1', wood: '#c39a68', body: '#ece0cc', drape: '#fffdf7', pot: '#cc8c69', tile: '#d6dade', art: ['#f4efe4', '#d98a5f', '#43618f', '#9bb592'] },
  }),
  lamplit: Object.freeze({
    id: 'lamplit', t: 0.98,
    name: { en: 'Lamplit', pl: 'Lampy' },
    blurb: { en: 'Late evening, curtains drawn, only lamps on.', pl: 'Późny wieczór, zasłony zaciągnięte, świecą tylko lampy.' },
    swatch: ['#34495e', '#7a5538', '#cf6a35'],
    palette: { wall: '#34495e', floor: '#7a5538', sofa: '#cf6a35', cushion: '#e07a45', accent: '#f0924f', bed: '#d8ccb6', rug: '#6a6764', rug2: '#4b4947', wood: '#64422a', body: '#8a6a4c', drape: '#a8744c', pot: '#8f5a40', tile: '#8d949a', art: ['#d9c9a8', '#c85a2d', '#1f3a5c', '#6f8a64'] },
  }),
});

export function isPreset(name) { return PRESET_NAMES.includes(name); }

// Unknown or missing names fall back to the default preset.
export function getPreset(name) { return PRESETS[isPreset(name) ? name : DEFAULT_PRESET]; }

// Display strings in a language ('en' or 'pl'; anything else is English).
export function presetLabel(name, lang = 'en') { const p = getPreset(name); return p.name[lang] ?? p.name.en; }
export function presetBlurb(name, lang = 'en') { const p = getPreset(name); return p.blurb[lang] ?? p.blurb.en; }
