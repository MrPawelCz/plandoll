// Frame hook for screenshots and video capture: turns the argument of window.__frame into safe values.
// Every field is optional. A value that is not a finite number, or a mood name that does not exist, is dropped; a number outside its range is
// clamped. t is the time of day (0 to 1), az and pol the view in degrees, dist a multiple of the default distance, size the picture in pixels.
import { isPreset } from '../look/presets.js';
import { ZOOM_MIN, ZOOM_MAX } from './camera.js';

export const FRAME_LIMITS = Object.freeze({ minW: 320, maxW: 3840, minH: 180, maxH: 2160 });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function frameRequest(args) {
  const a = args && typeof args === 'object' ? args : {};
  const out = {};
  if (typeof a.preset === 'string' && isPreset(a.preset)) out.preset = a.preset;
  const t = num(a.t); if (t !== null) out.t = clamp(t, 0, 1);
  const az = num(a.az); if (az !== null) out.az = az; // the camera wraps it into 0 to 360
  const pol = num(a.pol); if (pol !== null) out.pol = pol; // the camera keeps it between its own tilt limits
  const dist = num(a.dist); if (dist !== null && dist > 0) out.dist = clamp(dist, ZOOM_MIN, ZOOM_MAX);
  const w = num(a.size?.w), h = num(a.size?.h);
  if (w !== null && h !== null) out.size = { w: Math.round(clamp(w, FRAME_LIMITS.minW, FRAME_LIMITS.maxW)), h: Math.round(clamp(h, FRAME_LIMITS.minH, FRAME_LIMITS.maxH)) };
  return out;
}
