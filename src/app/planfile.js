// Reading a plan that a visitor brings (a file or pasted text): the text goes through the validator and the answer is either a plan the page can
// build or one short line that says what is wrong (the first problem and how many more there are). Pure logic, tested in Node.
import { analyzePlan } from '../core/validate.js';
import { MAX_PLAN_CHARS } from '../core/limits.js';

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const MAX_LISTED = 12; // problems listed one by one in `list`

// The validator's problem codes as short Polish sentences (the English original stays available as `detail`).
export const PL_ERRORS = {
  E001: 'tekst nie jest poprawnym planem w formacie JSON',
  E002: 'plan nie zgadza się z formatem (brakujące lub błędne pole)',
  E003: 'dwa elementy mają ten sam identyfikator',
  E004: 'jedna ze ścian jest błędna',
  E005: 'drzwi lub okno nie pasują do ściany',
  E006: 'drzwi lub okno nie pasują do ściany',
  E007: 'drzwi lub okno nie pasują do ściany',
  E008: 'obrys jednego z pomieszczeń jest błędny',
  E009: 'schody są błędnie opisane',
  E010: 'w planie jest liczba, która nie jest skończona',
  E011: 'skala planu wygląda nieprawdopodobnie, sprawdź jednostki',
  E012: 'schody są zdegenerowane',
  E013: 'plan ma za dużo elementów',
  E014: 'jeden punkt leży zbyt daleko od początku układu',
};

// text: the content of a .json file or pasted text (text around the JSON object is fine). lang: 'pl' or 'en' (the validator's own sentences stay English).
// Returns { ok: true, plan, warnings } or { ok: false, message, detail?, errors?, list? }; in Polish the message names the problem by its code and `detail` keeps the validator's own English sentence.
// `list` is every problem as a numbered line (the validator's English sentences, at most 12, then a line with the rest) when there is more than one; '' otherwise.
export function readPlanText(text, lang = 'en') {
  const pl = lang === 'pl';
  if (typeof text !== 'string' || !text.trim()) return { ok: false, message: pl ? 'Brak planu do wczytania' : 'There is no plan to load' };
  if (text.length > MAX_PLAN_CHARS) return { ok: false, message: pl ? 'Plan jest za duży (najwyżej 2 MB)' : 'The plan is too large (2 MB at most)' };
  let res = null;
  try { res = analyzePlan(text); } catch { return { ok: false, message: pl ? 'Nie udało się odczytać planu' : 'Could not read the plan' }; }
  if (res?.ok && res.normalized) return { ok: true, plan: res.normalized, warnings: Array.isArray(res.warnings) ? res.warnings.length : 0 };
  const errors = Array.isArray(res?.errors) ? res.errors : [];
  const original = String(errors[0]?.message ?? '').replace(/\s+/g, ' ').trim(), rest = Math.max(0, errors.length - 1);
  const first = pl && PL_ERRORS[errors[0]?.code] ? PL_ERRORS[errors[0].code] : cut(original, 110);
  const head = pl ? 'Nie wczytano planu' : 'Could not load the plan';
  const more = rest ? (pl ? ` (jeszcze ${rest})` : ` (${rest} more)`) : '';
  // Every problem the validator found, one numbered line each (up to MAX_LISTED), for a visitor who hands them all back to the chat that made the plan at once: one at a time takes a round per problem.
  const sentences = errors.slice(0, MAX_LISTED).map((e) => cut(String(e?.message ?? '').replace(/\s+/g, ' ').trim(), 220)).filter(Boolean);
  const list = errors.length > 1 ? [...sentences.map((t, i) => `${i + 1}. ${t}`), ...(errors.length > sentences.length ? [pl ? `... i jeszcze ${errors.length - sentences.length}` : `... and ${errors.length - sentences.length} more`] : [])].join('\n') : '';
  return { ok: false, message: `${head}${first ? `: ${first}` : ''}${more}`, detail: cut(original, 300), errors: errors.length, list };
}
