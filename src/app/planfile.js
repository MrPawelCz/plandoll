// Reading a plan that a visitor brings (a file or pasted text): the text goes through the validator and the answer is either a plan the page can
// build or one short line that says what is wrong (the first problem and how many more there are). Pure logic, tested in Node.
import { analyzePlan } from '../core/validate.js';
import { MAX_FILE_BYTES } from './files.js';

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

// text: the content of a .json file or pasted text (text around the JSON object is fine). lang: 'pl' or 'en' (the validator's own sentences stay English).
// Returns { ok: true, plan, warnings } or { ok: false, message, errors? }.
export function readPlanText(text, lang = 'en') {
  const pl = lang === 'pl';
  if (typeof text !== 'string' || !text.trim()) return { ok: false, message: pl ? 'Brak planu do wczytania' : 'There is no plan to load' };
  if (text.length > MAX_FILE_BYTES) return { ok: false, message: pl ? 'Plan jest za duży (najwyżej 2 MB)' : 'The plan is too large (2 MB at most)' };
  let res = null;
  try { res = analyzePlan(text); } catch { return { ok: false, message: pl ? 'Nie udało się odczytać planu' : 'Could not read the plan' }; }
  if (res?.ok && res.normalized) return { ok: true, plan: res.normalized, warnings: Array.isArray(res.warnings) ? res.warnings.length : 0 };
  const errors = Array.isArray(res?.errors) ? res.errors : [];
  const first = cut(String(errors[0]?.message ?? '').replace(/\s+/g, ' ').trim(), 110), rest = Math.max(0, errors.length - 1);
  const head = pl ? 'Nie wczytano planu' : 'Could not load the plan';
  const more = rest ? (pl ? ` (jeszcze ${rest})` : ` (${rest} more)`) : '';
  return { ok: false, message: `${head}${first ? `: ${first}` : ''}${more}`, errors: errors.length };
}
