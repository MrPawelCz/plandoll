// Finds the plan JSON inside whatever a person pastes: a bare object, a whole chat answer with a fenced block and notes around
// it, typographic quotes, comments or a trailing comma. Pure and isomorphic; extractJson never throws.
//   extractJson(text) -> { ok: true, value, repairs }  or  { ok: false, error, kind, repairs }
// repairs lists what had to be changed, as short English phrases; strict JSON that parses as it is gives an empty list.
// kind of a failure: 'empty', 'too-long', 'no-object' (no { in the text), 'truncated' (braces never close), 'invalid' (syntax error).
import { MAX_PLAN_CHARS } from './limits.js';

const INVISIBLE = /[\u200b\u2060\ufeff]/g; // zero width joiners stay: inside a string they belong to the text (emoji, Persian), cut() drops them elsewhere
const OTHER_SPACE = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const TYPO_QUOTES = '\u201c\u201d\u201e\u201f\u00ab\u00bb\u2033\uff02';
const HAS_TYPO_QUOTE = new RegExp(`[${TYPO_QUOTES}]`);
const STARTS_LIKE_PLAN = new RegExp(`^\\{[\\s\u200c\u200d]*["${TYPO_QUOTES}][\\s\u200c\u200d]*[A-Za-z_]`); // { then a quoted key (joiners may sit in between)
const FENCE = /(?:^|\n)[ \t]*(`{3,}(?!`)|~{3,}(?!~))[^\n]*\n([\s\S]*?)(?:\n[ \t]*\1[`~]*[ \t]*(?=\n|$)|$)/g; // (?!`): a run of fence marks is never retried one mark shorter (quadratic on a last line of marks)
const JSON_LINE = /^\s*json[ \t]*:?[ \t]*\r?\n/i;
const MAX_FENCES = 200, MAX_TRIES = 3, MAX_BAD = 500; // fenced blocks searched before the whole text; { that never closes tried per source (each reads to the end); objects that are not JSON tolerated per source
const REST_HAS_TEXT = /\s*\S/y;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasLevels = (v) => isObj(v) && Object.prototype.hasOwnProperty.call(v, 'levels');

// Copies the first balanced top level object that starts at `from`, repairing as it goes. A string opens at a plain quote (or,
// in `typo` mode, at a typographic one); in `typo` mode it closes at a quote that is followed by , : } ] or the end, so quotes
// inside a value ("Pokój „Salon” duży") survive. Returns null when the braces or a string never close.
function cut(src, from, typo) {
  const n = src.length;
  const flags = { quotes: false, comments: false, commas: false, spaces: false, breaks: false, invisible: false };
  const out = [], closers = [];
  let i = from;
  const closesAt = (k) => {
    let j = k + 1;
    while (j < n && (src[j] === ' ' || src[j] === '\n' || src[j] === '\r' || src[j] === '\t' || src[j] === '\u200c' || src[j] === '\u200d' || OTHER_SPACE.test(src[j]))) j++;
    return j >= n || ',:}]'.includes(src[j]) || (src[j] === '/' && (src[j + 1] === '/' || src[j + 1] === '*'));
  };
  while (i < n) {
    const c = src[i];
    if (c === '"' || (typo && TYPO_QUOTES.includes(c))) {
      const plain = c === '"';
      if (!plain) flags.quotes = true;
      out.push('"');
      for (i++; i < n; i++) {
        const d = src[i];
        if (d === '\\' && i + 1 < n) {
          i++;
          out.push('"\\/bfnrtu'.includes(src[i]) ? '\\' + src[i] : src[i]);
        } else if (d === '"' && (plain || closesAt(i))) {
          break;
        } else if (!plain && TYPO_QUOTES.includes(d) && closesAt(i)) {
          break;
        } else if (d === '"') {
          out.push('\\"');
        } else if (d < ' ') {
          flags.breaks = true;
          out.push(d === '\n' ? '\\n' : d === '\r' ? '\\r' : d === '\t' ? '\\t' : '');
        } else {
          out.push(d);
        }
      }
      if (i >= n) return null;
      out.push('"');
    } else if (c === '/' && src[i + 1] === '/') {
      flags.comments = true;
      while (i < n && src[i] !== '\n') i++;
      continue;
    } else if (c === '/' && src[i + 1] === '*') {
      flags.comments = true;
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    } else if (c === '{' || c === '[') {
      closers.push(c === '{' ? '}' : ']');
      out.push(c);
    } else if (c === '}' || c === ']') {
      let k = out.length - 1;
      while (k >= 0 && /^\s*$/.test(out[k])) k--;
      if (k >= 0 && out[k] === ',') { out.splice(k, 1); flags.commas = true; }
      out.push(c);
      // a closer of the wrong kind ends the copy too: the text it leaves is not JSON, which the caller reports as a syntax error
      if (closers.pop() !== c || !closers.length) return { text: out.join(''), end: i + 1, flags };
    } else if (OTHER_SPACE.test(c)) {
      flags.spaces = true;
      out.push(' ');
    } else if (c === '\u200c' || c === '\u200d') {
      flags.invisible = true;
    } else {
      out.push(c);
    }
    i++;
  }
  return null;
}

function where(text, message) {
  const pos = /position (\d+)/.exec(message);
  if (!pos || /line \d+/.test(message)) return '';
  const upTo = text.slice(0, Number(pos[1]));
  return ` (line ${upTo.split('\n').length}, column ${upTo.length - upTo.lastIndexOf('\n')})`;
}

// The texts to search, most specific first: the fenced blocks that contain a { (a leading line that is just "json" dropped), then everything.
function* sources(text) {
  const dropLabel = (s) => (JSON_LINE.test(s) ? { body: s.replace(JSON_LINE, ''), label: true } : { body: s, label: false });
  let fences = 0;
  FENCE.lastIndex = 0;
  for (let m = FENCE.exec(text); m && fences < MAX_FENCES; m = FENCE.exec(text)) {
    if (!m[2].includes('{')) continue;
    fences++;
    yield { fence: true, ...dropLabel(m[2]) };
  }
  yield { fence: false, ...dropLabel(text) };
}

// Strict JSON can be a list: a list that holds plans gives the last plan (one plan is the usual case, several follow the two plans rule).
function unlist(value) {
  const plans = Array.isArray(value) ? value.filter(hasLevels) : [];
  if (!plans.length) return { ok: true, value, repairs: [] };
  const repairs = ['took the plan out of a list'];
  if (plans.length > 1) repairs.push(`found ${plans.length} plans, loaded the last one`);
  return { ok: true, value: plans[plans.length - 1], repairs };
}

// Whether the object at `from` is the first thing inside a [ ... ] list.
function inList(body, from) {
  let k = from - 1;
  while (k >= 0 && /\s/.test(body[k])) k--;
  return k >= 0 && body[k] === '[';
}

export function extractJson(text) {
  const fail = (kind, error) => ({ ok: false, kind, error, repairs: [] });
  try {
    if (typeof text !== 'string') return fail('empty', 'the input is not text');
    if (text.length > MAX_PLAN_CHARS) return fail('too-long', `the text is too long (${text.length} characters, the limit is ${MAX_PLAN_CHARS})`);
    if (!text.trim()) return fail('empty', 'the text is empty');
    try { return unlist(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)); } catch { /* repair below */ }

    const cleaned = text.replace(INVISIBLE, '');
    const invisible = cleaned.length !== text.length;
    let unbalanced = false, firstError = null, plain = null, last = null, count = 0;
    for (const src of sources(cleaned)) {
      if (count && !src.fence) break; // the whole text is searched only when no code block held a plan
      const before = count;
      for (const typo of [false, true]) {
        if (typo && (!HAS_TYPO_QUOTE.test(src.body) || count > before)) continue;
        let from = src.body.indexOf('{'), nested = false, unclosed = 0, bad = 0;
        while (from >= 0) {
          const found = cut(src.body, from, typo);
          // Objects that start inside a { that never closes are fragments of a cut off text, unless they are a whole plan.
          if (!found) {
            unbalanced = unbalanced || STARTS_LIKE_PLAN.test(src.body.slice(from, from + 40));
            nested = true;
            if (++unclosed >= MAX_TRIES) break;
            from = src.body.indexOf('{', from + 1);
            continue;
          }
          const start = from;
          from = src.body.indexOf('{', found.end);
          let value;
          // {the drawing} in a sentence is chat text, not a plan with a mistake in it: a plan has at least one "key": value
          if (!found.text.includes(':') && !/^\{\s*\}$/.test(found.text)) continue;
          try {
            value = JSON.parse(found.text);
          } catch (e) {
            firstError = firstError ?? { message: String(e && e.message ? e.message : e), text: found.text };
            if (++bad >= MAX_BAD) break;
            continue;
          }
          const isPlan = hasLevels(value);
          if ((nested && !isPlan) || (!isPlan && plain)) continue;
          const f = found.flags;
          const repairs = [];
          if (invisible || f.invisible) repairs.push('removed invisible characters');
          if (src.fence) repairs.push('took the code block');
          if (src.label) repairs.push('dropped a leading json line');
          if (!src.fence) { REST_HAS_TEXT.lastIndex = found.end; if (start > 0 || REST_HAS_TEXT.test(src.body)) repairs.push('ignored the text around the JSON object'); }
          if (inList(src.body, start)) repairs.push('took the plan out of a list');
          if (f.quotes) repairs.push('replaced typographic quotes with plain quotes');
          if (f.comments) repairs.push('removed comments');
          if (f.commas) repairs.push('removed trailing commas');
          if (f.spaces) repairs.push('replaced non-breaking spaces');
          if (f.breaks) repairs.push('escaped line breaks inside text');
          const hit = { ok: true, value, repairs };
          if (isPlan) { last = hit; count++; } else plain = hit;
        }
      }
    }
    // Two plans in one answer: a corrected version usually follows the first, so the last one is loaded and the person is told.
    if (last) {
      if (count > 1) last.repairs.push(`found ${count} plans, loaded the last one`);
      return last;
    }
    if (plain) return plain;
    if (firstError) return fail('invalid', `${firstError.message}${where(firstError.text, firstError.message)}`);
    if (unbalanced) return fail('truncated', 'the { of the plan is never closed, so the JSON looks cut off');
    return fail('no-object', 'there is no JSON object in the text');
  } catch (e) {
    return fail('invalid', String(e && e.message ? e.message : e));
  }
}
