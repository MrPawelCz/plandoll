// Time of day as plain data: keyframes over t in [0, 1] (0 = 06:00, 1 = 23:00) and linear interpolation between them.
// No three.js in this file, so the maths runs (and is tested) in Node. Colours are '#rrggbb' strings, the rest are numbers.
//
// Fields: sunC/sunI sun colour and strength, sky/gnd hemisphere colours, hemiI hemisphere strength, envI image based light,
// exp exposure, winC/winI glow of the window glass, lampK lamp strength 0..1, bnc/bncC warm bounce fill from below,
// bloom, vig vignette, bgTop/bgBot backdrop gradient, glow/glowA blurred lights of the backdrop, top/topA paper base tint.

export const DAY_START_HOUR = 6;
export const DAY_SPAN_HOURS = 17;

const K = (t, o) => Object.freeze({ t, ...o });

export const KEYFRAMES = Object.freeze([
  K(0.0, { sunC: '#ffb48a', sunI: 1.3, sky: '#9aa4c8', gnd: '#4a4048', hemiI: 0.5, envI: 0.22, exp: 0.95, winC: '#ffd2aa', winI: 1.1, lampK: 0.5, bnc: 0.25, bncC: '#ffcba0', bloom: 0.3, vig: 0.3, bgTop: '#b9bfd6', bgBot: '#e9d3c0', glow: '#ffc08a', glowA: 0.35 }),
  K(0.18, { sunC: '#fff0dc', sunI: 2.4, sky: '#e4ecff', gnd: '#d9cdb8', hemiI: 0.65, envI: 0.36, exp: 0.95, winC: '#f2f6ff', winI: 1.0, lampK: 0.0, bnc: 0.3, bncC: '#ffe8cc', bloom: 0.1, vig: 0.22, bgTop: '#cfd9ea', bgBot: '#efe9df', glow: '#f4f7ff', glowA: 0.3 }),
  K(0.4, { sunC: '#fffbf4', sunI: 2.7, sky: '#e8f0ff', gnd: '#ddd2c0', hemiI: 0.65, envI: 0.42, exp: 0.85, winC: '#eef5ff', winI: 1.1, lampK: 0.0, bnc: 0.32, bncC: '#fff0da', bloom: 0.1, vig: 0.2, bgTop: '#d4dff0', bgBot: '#f1ece3', glow: '#ffffff', glowA: 0.35 }),
  K(0.62, { sunC: '#ffe0b0', sunI: 3.3, sky: '#f4dcc0', gnd: '#6a5444', hemiI: 0.6, envI: 0.35, exp: 1.0, winC: '#ffdcae', winI: 1.4, lampK: 0.05, bnc: 0.38, bncC: '#ffcf9a', bloom: 0.3, vig: 0.26, bgTop: '#d8c6bd', bgBot: '#ecd4b8', glow: '#ffd8a0', glowA: 0.45 }),
  K(0.735, { sunC: '#ff9a44', sunI: 3.0, sky: '#ffc08a', gnd: '#5a4033', hemiI: 0.42, envI: 0.24, exp: 0.95, winC: '#ffb25f', winI: 1.2, lampK: 0.4, bnc: 0.42, bncC: '#ffb070', bloom: 0.3, vig: 0.34, bgTop: '#b79aa6', bgBot: '#e0b48c', glow: '#ff9a55', glowA: 0.55 }),
  K(0.83, { sunC: '#7f86c0', sunI: 0.9, sky: '#6e5f94', gnd: '#241a2a', hemiI: 0.34, envI: 0.12, exp: 1.1, winC: '#7f78b4', winI: 0.8, lampK: 0.85, bnc: 0.3, bncC: '#ff9f60', bloom: 0.34, vig: 0.44, bgTop: '#5a5586', bgBot: '#2b2540', glow: '#ff9a5a', glowA: 0.6 }),
  K(0.95, { sunC: '#8fa8ff', sunI: 0.9, sky: '#4a5f94', gnd: '#10131c', hemiI: 0.28, envI: 0.08, exp: 1.1, winC: '#6282c8', winI: 0.5, lampK: 1.0, bnc: 0.26, bncC: '#ffa860', bloom: 0.36, vig: 0.5, bgTop: '#243252', bgBot: '#0f1426', glow: '#ffb060', glowA: 0.7 }),
  K(1.0, { sunC: '#8fa8ff', sunI: 0.9, sky: '#4a5f94', gnd: '#10131c', hemiI: 0.28, envI: 0.08, exp: 1.1, winC: '#6282c8', winI: 0.5, lampK: 1.0, bnc: 0.26, bncC: '#ffa860', bloom: 0.36, vig: 0.5, bgTop: '#243252', bgBot: '#0f1426', glow: '#ffb060', glowA: 0.7 }),
]);

export const COLOR_FIELDS = Object.freeze(['sunC', 'sky', 'gnd', 'winC', 'bncC', 'bgTop', 'bgBot', 'glow']);
export const NUMBER_FIELDS = Object.freeze(['sunI', 'hemiI', 'envI', 'exp', 'winI', 'lampK', 'bnc', 'bloom', 'vig', 'glowA']);

export const clamp01 = (t) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) throw new Error(`bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function lerpHex(a, b, f) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * f));
}

// Interpolated look of the sky, light and backdrop at time t (clamped to 0..1).
export function sample(t, keys = KEYFRAMES) {
  t = clamp01(t);
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const out = { t };
  for (const n of NUMBER_FIELDS) out[n] = a[n] + (b[n] - a[n]) * f;
  for (const n of COLOR_FIELDS) out[n] = lerpHex(a[n], b[n], f);
  return out;
}

// Clock time for t: { hour: 6..23, minute, text: 'HH:MM' }.
export function clock(t) {
  const h = DAY_START_HOUR + DAY_SPAN_HOURS * clamp01(t);
  let hour = Math.floor(h), minute = Math.round((h - hour) * 60);
  if (minute === 60) { hour += 1; minute = 0; }
  return { hour, minute, text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

// A stylised sun path (not astronomical): up from about 06:20 to 19:50, rising in the east, culminating in the south.
// Returns elevation and azimuth in degrees, `up` and a unit direction towards the sun in plan space (x east, z south, y up).
export function sunPosition(t) {
  const hour = DAY_START_HOUR + DAY_SPAN_HOURS * clamp01(t);
  const k = (hour - 6.3) / 13.5;
  const up = k > 0 && k < 1 && 62 * Math.sin(Math.PI * k) > 3;
  const elevation = up ? 62 * Math.sin(Math.PI * k) : 45; // when it is down a fixed "moon" direction keeps soft light and shadows
  const azimuth = up ? 70 + 100 * k : 140;
  const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
  const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  return { elevation, azimuth, up, dir };
}
