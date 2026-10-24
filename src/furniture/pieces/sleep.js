// Bedroom pieces: beds (frame, mattress, duvet with folds, pillows, throw), nightstand, wardrobe, chest of drawers.
import { roundBox, M, deg, clamp } from '../kit.js';

function bed(b, { pillows, throwSlot }) {
  const { w, d, h } = b;
  const k = h / 0.55; // proportions are drawn for the 0.55 m double bed
  const legH = 0.09 * h, slabH = 0.22 * h, mattH = 0.31 * h, headT = 0.07, headH = h;
  const slabTop = legH + slabH, mattTop = slabTop + mattH;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('frame', 'f:wood', [sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06)], 0.06, 0.04, legH);
  b.box('frame', 'f:wood', [0, legH + slabH / 2, 0], [w, slabH, d], 0.014, { seg: 2 });
  b.box('frame', 'f:fabric', [0, headH / 2, -d / 2 + headT / 2], [w, headH, headT], 0.03, { seg: 2, top: 3 }); // padded headboard
  const mw = w - 0.06, mz0 = -d / 2 + headT + 0.005, md = d - headT - 0.03;
  b.box('frame', 'f:white', [0, slabTop + mattH / 2, mz0 + md / 2], [mw, mattH, md], 0.045, { seg: 2, top: 3 });
  // duvet: covers the mattress from the pillows to the foot, hangs over the sides, folds from a seeded wave
  const phase = b.rng() * 6, dz0 = mz0 + 0.62, dlen = mz0 + md + 0.01 - dz0, dh = mattH * 0.9;
  const fold = [0.9, 1.15, 1.7][b.ql]; // folds are stronger at high quality so that they read from a distance
  const warp = (x, z) => fold * (0.016 * Math.sin(x * 11 + phase) * Math.cos(z * 4.5 + phase * 0.5) + 0.011 * Math.sin(z * 14 + x * 3 + phase) + 0.006 * Math.sin(x * 23 + z * 7) + 0.012 * Math.sin((x * 0.9 + z * 1.6) * 8 + phase * 1.7));
  b.add('bedding', roundBox(mw + 0.07, dh, dlen, 0.04, { seg: 2, top: 16, warp }), 'f:bedding', M(0, mattTop - dh / 2 + 0.04 * h, dz0 + dlen / 2));
  // turned-down edge of the duvet near the pillows
  b.add('bedding', roundBox(mw + 0.07, 0.05 * k, 0.17, 0.022, { seg: 2, top: 6, warp: (x) => 0.006 * Math.sin(x * 17 + phase) }), 'f:bedding', M(0, mattTop + 0.04 * h + 0.004, dz0 + 0.07));
  const pw = (mw - 0.06) / pillows - 0.04;
  for (let i = 0; i < pillows; i++) {
    const x = pillows === 1 ? 0 : (i - (pillows - 1) / 2) * (pw + 0.05);
    b.add('pillows', b.cush(Math.min(pw, 0.62), 0.2 * h, 0.4, { r: 0.05, puff: 0.05 * h, dent: 0.012 }), 'f:pillow', M(x, mattTop + 0.1 * h, mz0 + 0.3, deg(-9), (i % 2 ? -1 : 1) * deg(3)));
  }
  if (throwSlot) b.add('throw', roundBox(mw + 0.09, 0.03, 0.42, 0.013, { seg: 2, top: 10, warp: (x, z) => 0.006 * Math.sin(x * 13 + 1) }), 'f:blanket', M(0, mattTop + 0.04 * h + 0.046, d / 2 - 0.33));
}

export const bedDouble = (b) => bed(b, { pillows: 2, throwSlot: true });
export const bedSingle = (b) => bed(b, { pillows: 1, throwSlot: false });

export function nightstand(b) {
  const { w, d, h } = b;
  const legH = 0.1, bodyH = h - legH - 0.03;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('body', 'f:wood', [sx * (w / 2 - 0.04), legH / 2, sz * (d / 2 - 0.04)], 0.036, 0.022, legH);
  const fz = d / 2 - 0.024; // front plane of the doors and drawers; handles stay inside the depth
  b.box('body', 'f:body', [0, legH + bodyH / 2, -0.012], [w - 0.02, bodyH, d - 0.024], 0.01, { seg: 2 });
  const fh = (bodyH - 0.03) / 2;
  for (let i = 0; i < 2; i++) {
    const y = legH + 0.01 + fh * (i + 0.5) + 0.01 * i;
    b.box('body', 'f:wood', [0, y + 0.004, fz - 0.008], [w - 0.04, fh - 0.006, 0.02], 0.005);
    b.box('handles', 'k:brass', [0, y + fh * 0.18, fz + 0.006], [0.11, 0.012, 0.012], 0.004);
  }
  b.box('top', 'f:top', [0, h - 0.015, 0], [w, 0.03, d], 0.01, { seg: 2, top: 2 });
}

export function wardrobe(b) {
  const { w, d, h } = b;
  const plinth = 0.07, crown = 0.04, n = clamp(Math.round(w / 0.5), 2, 6), dw = (w - 0.03) / n;
  const fz = d / 2 - 0.02;
  b.box('body', 'f:body', [0, plinth + (h - plinth) / 2, -0.01], [w, h - plinth, d - 0.02], 0.01, { seg: 2 });
  b.box('body', 'f:dark', [0, plinth / 2, -0.02], [w - 0.06, plinth, d - 0.06], 0.004);
  b.box('body', 'f:body', [0, h - crown / 2, 0], [w, crown, d], 0.008, { seg: 2 });
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + 0.015 + dw * (i + 0.5);
    b.box('doors', 'f:wood', [cx, plinth + (h - plinth - crown) / 2 + 0.002, fz - 0.008], [dw - 0.006, h - plinth - crown - 0.008, 0.02], 0.006);
    const side = i % 2 === 0 ? 1 : -1;
    b.box('handles', 'k:brass', [cx + side * (dw / 2 - 0.045), 1.05 * h / 2.2, fz + 0.006], [0.014, 0.34, 0.012], 0.005);
  }
}

export function dresser(b) {
  const { w, d, h } = b;
  const legH = 0.12, bodyH = h - legH - 0.03, rows = clamp(Math.round(bodyH / 0.2), 2, 4), cols = w > 1.0 ? 2 : 1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('body', 'f:wood', [sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06)], 0.05, 0.028, legH);
  const fz = d / 2 - 0.024;
  b.box('body', 'f:body', [0, legH + bodyH / 2, -0.012], [w - 0.02, bodyH, d - 0.024], 0.01, { seg: 2 });
  const fh = (bodyH - 0.02) / rows, fw = (w - 0.05) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = -w / 2 + 0.025 + fw * (c + 0.5), cy = legH + 0.01 + fh * (r + 0.5);
      b.box('body', 'f:wood', [cx, cy, fz - 0.008], [fw - 0.007, fh - 0.007, 0.02], 0.005);
      b.box('handles', 'k:brass', [cx, cy + fh * 0.2, fz + 0.006], [Math.min(0.14, fw * 0.3), 0.012, 0.012], 0.004);
    }
  }
  b.box('top', 'f:top', [0, h - 0.015, 0], [w, 0.03, d], 0.01, { seg: 2, top: 2 });
}

export const builders = { 'bed-double': bedDouble, 'bed-single': bedSingle, nightstand, wardrobe, dresser };
