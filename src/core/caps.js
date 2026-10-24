// Hard caps for plan input (docs/SPEC.md section 5, "Limits"). The array caps are mirrored as maxItems in
// schema/plan.v1.schema.json (a test keeps both equal). A plan above a cap is rejected with E013 before any
// geometry runs, so a broken or hostile file cannot hang the tab.
export const CAPS = Object.freeze({
  levels: 12,
  walls: 600, // per level
  openings: 600, // per level
  rooms: 150, // per level
  stairs: 24, // per level
  furniture: 400, // per level
  polygonPoints: 120, // points of one room polygon
  furnitureSpan: 6, // metres: the largest width, depth or height of a piece of furniture the viewer draws (W112 warns above it)
  coordinate: 1000, // metres from the origin: a wall end, room corner, stair end or furniture centre farther out is E014 (a mistyped number)
  echo: 80, // characters of a user supplied value that a message may repeat
  message: 1500, // characters of one message or fix text
  violations: 1000, // schema violations collected before the check gives up (unknown properties are not counted)
  unknownProperties: 1000, // unknown properties collected (W116); the rest are left out without a word and the plan is still read
});

// Own property test without Object.hasOwn (Safari before 15.4 has none). Plan keys such as "__proto__",
// "constructor" or "toString" must never count as known keys or as table entries.
export const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// A user supplied string cut to `max` characters, with "..." when something was left out.
export function clip(value, max = CAPS.echo) {
  const s = typeof value === 'string' ? value : String(value);
  return s.length > max ? `${s.slice(0, Math.max(0, max - 3))}...` : s;
}

// Number of code points of `s`, or Infinity when the string is so long that it surely has more than `limit`
// (a code point is at most 2 UTF-16 units), so a huge string is never walked.
export function codePointCount(s, limit) {
  if (s.length > 2 * limit + 2) return Infinity;
  let n = 0;
  for (const _ of s) n++;
  return n;
}
