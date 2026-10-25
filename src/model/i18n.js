// Language choice and string lookup for the page. A UI module keeps its own strings as { en: {...}, pl: {...} } and
// calls makeT(dict) once; t(key, params) answers in the current language, falls back to English, fills {name} slots.
const SUPPORTED = ['en', 'pl'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// A copy of the page can name its own default language in a head tag:
// <meta name="plandoll-default-lang" content="pl">. ?lang= still wins; without the tag the browser language decides.
function pageDefault(doc) {
  const meta = doc && doc.querySelector ? doc.querySelector('meta[name="plandoll-default-lang"]') : null;
  const lang = meta && meta.getAttribute('content');
  return SUPPORTED.includes(lang) ? lang : null;
}

export function detectLang(search = typeof location !== 'undefined' ? location.search : '', nav = typeof navigator !== 'undefined' ? navigator : {}, doc = typeof document !== 'undefined' ? document : null) {
  const q = new URLSearchParams(search).get('lang');
  if (SUPPORTED.includes(q)) return q;
  const page = pageDefault(doc);
  if (page) return page;
  const first = (nav.languages && nav.languages[0]) || nav.language || '';
  return /^pl\b/i.test(first) ? 'pl' : 'en';
}

// True when Polish is anywhere in the browser's language list, not only first (an English-language phone used by a Polish speaker).
export function prefersPolish(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  return (nav.languages && nav.languages.length ? [...nav.languages] : [nav.language]).some((l) => /^pl\b/i.test(l || ''));
}

let current = detectLang();
let chosen = false; // set once the language was picked by hand (the PL | EN buttons, setLang), not just detected
export const getLang = () => current;
export const langChosen = () => chosen;
export function setLang(lang) { if (SUPPORTED.includes(lang)) { current = lang; chosen = true; } }

export function makeT(dict) {
  return (key, params) => {
    const s = (has(dict, current) && has(dict[current], key) ? dict[current][key] : null) ?? (has(dict.en, key) ? dict.en[key] : key);
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (has(params, k) ? String(params[k]) : m)) : s;
  };
}
