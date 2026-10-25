// The bars at the bottom of the window (the controls and, while editing, the edit bar) cover part of the picture. coverShare turns their boxes
// into the share of the window height that the camera keeps free of the model. Pure: the page reads the boxes and passes them in.
import { BOTTOM_MAX } from './camera.js';

export const COVER_GAP = 6; // pixels of air kept between the model and the bars
export const NARROW_WIDTH = 760; // windows up to this wide (phones) get the narrow layout, where the bars span the window: only there the model is kept above them
export const isNarrow = (width) => Number.isFinite(width) && width > 0 && width <= NARROW_WIDTH;
const LOWER_PART = 0.3; // a box counts as a bottom bar when its top is below this share of the height

// rects: boxes as getBoundingClientRect gives them ({ top, width, height }); null, empty and non-finite ones are skipped. viewH: height of the window.
// Returns 0 to BOTTOM_MAX: from the highest top of the bars in the lower part of the window down to the window edge, plus COVER_GAP.
export function coverShare(rects, viewH) {
  const H = Number(viewH);
  if (!(H > 0) || !Number.isFinite(H)) return 0;
  let top = H;
  for (const r of rects ?? []) {
    if (!r || !(r.width > 0) || !(r.height > 0) || !Number.isFinite(r.top)) continue;
    if (r.top > H * LOWER_PART && r.top < top) top = r.top;
  }
  if (top >= H) return 0;
  return Math.min(BOTTOM_MAX, Math.max(0, (H - top + COVER_GAP) / H));
}
