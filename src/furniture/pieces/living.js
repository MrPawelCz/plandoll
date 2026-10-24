// Living room pieces: sofas, armchair, coffee table, TV unit, TV, bookshelf, rug. Local frame: front +z, centre of the footprint, y up.
import { bookRow, M, deg, clamp, lerp } from '../kit.js';

// Shared by sofas and the armchair: legs, plinth, arms, back shell, seat and back cushions, scatter pillows.
function sofaBody(b, { seats, cushionSlot, armW, backD, legH, scatter }) {
  const { w, d, h } = b;
  const seatBase = legH + 0.14, seatTop = seatBase + 0.15;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.leg('legs', 'f:wood', [sx * (w / 2 - 0.09), legH / 2, sz * (d / 2 - 0.1)], 0.05, 0.03, legH);
  }
  b.box('upholstery', 'f:fabric', [0, legH + 0.07, 0], [w - 0.005, 0.14, d - 0.005], 0.03, { seg: 2 });
  const armH = Math.min(0.64, h * 0.74);
  for (const s of [-1, 1]) b.box('upholstery', 'f:fabric', [s * (w / 2 - armW / 2), (legH + armH) / 2 + 0.005, 0], [armW, armH - legH, d - 0.005], 0.055, { seg: 2, top: 3 });
  const innerW = w - 2 * armW;
  b.box('upholstery', 'f:fabric', [0, (legH + h - 0.07) / 2, -d / 2 + backD / 2 + 0.003], [innerW + 0.04, h - 0.07 - legH, backD], 0.05, { seg: 2, top: 3 });
  const cw = innerW / seats, sd = d - backD - 0.012, tz = -d / 2 + backD + sd / 2;
  for (let i = 0; i < seats; i++) {
    const cx = -innerW / 2 + cw * (i + 0.5);
    b.add(cushionSlot, b.cush(cw - 0.012, 0.16, sd, { r: 0.05, puff: 0.03, dent: 0.012 }), 'f:cushion', M(cx, seatBase + 0.075, tz + 0.006));
    const bh = h - 0.04 - seatTop - 0.02, th = 0.17, a = deg(-12), cz = -d / 2 + backD + th * 0.5 + 0.01 - (bh / 2) * Math.sin(-a);
    b.add(cushionSlot, b.cush(cw - 0.012, bh, th, { r: 0.05, puff: 0.025, dent: 0.01 }), 'f:cushion', M(cx, seatTop - 0.015 + (bh / 2) * Math.cos(a), cz, a));
  }
  if (scatter) {
    const pw = Math.min(0.4, innerW * 0.34);
    b.add(cushionSlot, b.cush(pw, pw * 0.95, 0.13, { r: 0.045, puff: 0.04, dent: 0.014 }), 'f:blanket', M(-innerW / 2 + pw * 0.58, seatTop + pw * 0.4, -d / 2 + backD + 0.2, deg(-18), deg(14), deg(4)));
    if (seats > 1) b.add(cushionSlot, b.cush(pw * 0.9, pw * 0.9, 0.12, { r: 0.045, puff: 0.04, dent: 0.014 }), 'f:pillow', M(innerW / 2 - pw * 0.55, seatTop + pw * 0.38, -d / 2 + backD + 0.2, deg(-16), deg(-12), deg(-3)));
  }
}

const sofaOf = (seatsFor) => (b) => sofaBody(b, { seats: seatsFor(b.w), cushionSlot: 'cushions', armW: 0.16, backD: 0.2, legH: 0.13, scatter: true });
export const sofa3 = sofaOf((w) => clamp(Math.round((w - 0.32) / 0.6), 3, 4));
export const sofa2 = sofaOf((w) => clamp(Math.round((w - 0.32) / 0.62), 2, 3));
export const armchair = (b) => sofaBody(b, { seats: 1, cushionSlot: 'cushion', armW: 0.14, backD: 0.19, legH: 0.14, scatter: false });

export function coffeeTable(b) {
  const { w, d, h } = b;
  b.box('top', 'f:wood', [0, h - 0.022, 0], [w, 0.044, d], 0.014, { seg: 2, top: 2 });
  b.box('frame', 'f:wood', [0, 0.12, 0], [w - 0.18, 0.025, d - 0.16], 0.008);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('frame', 'f:wood', [sx * (w / 2 - 0.07), (h - 0.044) / 2, sz * (d / 2 - 0.07)], 0.045, 0.028, h - 0.044);
  b.box('frame', 'f:wood', [0, h - 0.07, d / 2 - 0.07], [w - 0.14, 0.04, 0.025], 0.006);
  b.box('frame', 'f:wood', [0, h - 0.07, -d / 2 + 0.07], [w - 0.14, 0.04, 0.025], 0.006);
}

export function tvUnit(b) {
  const { w, d, h } = b;
  const legH = 0.13, bodyH = h - legH - 0.03, by = legH + bodyH / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('legs', 'f:wood', [sx * (w / 2 - 0.08), legH / 2, sz * (d / 2 - 0.07)], 0.045, 0.026, legH);
  b.box('body', 'f:body', [0, by, -0.004], [w - 0.02, bodyH, d - 0.012], 0.01, { seg: 2 });
  const n = clamp(Math.round(w / 0.4), 3, 6), fw = (w - 0.04) / n;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + 0.02 + fw * (i + 0.5), open = n >= 4 && i === Math.floor(n / 2);
    // the open niche stands 8 mm ahead of the carcass face, so no two faces are coplanar
    if (open) { b.box('body', 'k:black', [cx, by, d / 2 - 0.006], [fw - 0.012, bodyH - 0.07, 0.008], 0.003); continue; }
    b.box('body', 'f:wood', [cx, by, d / 2 - 0.004], [fw - 0.008, bodyH - 0.03, 0.02], 0.005, { seg: 1 });
  }
  b.box('top', 'f:top', [0, h - 0.015, 0], [w, 0.03, d], 0.01, { seg: 2, top: 2 });
}

export function tv(b) {
  const { w, d, h } = b;
  b.box('frame', 'k:black', [0, 0.03 + (h - 0.03) / 2, -d / 2 + 0.017], [w, h - 0.03, 0.034], 0.006);
  b.box('screen', 'k:screen', [0, 0.03 + (h - 0.03) / 2, -d / 2 + 0.036], [w - 0.024, h - 0.03 - 0.024, 0.004], 0.002);
  for (const s of [-1, 1]) b.box('frame', 'k:black', [s * w * 0.3, 0.015, 0], [0.2, 0.03, d], 0.006);
}

export function bookshelf(b) {
  const { w, d, h } = b;
  const t = 0.022, plinth = 0.07, backT = 0.012;
  b.box('body', 'f:wood', [-(w / 2 - t / 2), h / 2, 0], [t, h, d], 0.004);
  b.box('body', 'f:wood', [w / 2 - t / 2, h / 2, 0], [t, h, d], 0.004);
  b.box('body', 'f:wood', [0, h - t / 2, 0], [w, t, d], 0.004);
  b.box('body', 'f:wood', [0, plinth + t / 2, 0.005], [w - 2 * t, t, d - 0.015], 0.003);
  b.box('body', 'f:wood', [0, plinth / 2, -0.01], [w - 2 * t, plinth, d - 0.04], 0.003);
  b.box('body', 'f:dark', [0, h / 2, -d / 2 + backT / 2], [w - 2 * t, h - 0.04, backT], 0.002);
  const n = clamp(Math.round((h - plinth) / 0.36), 3, 7), inner = h - plinth - 2 * t, gap = inner / n;
  const books = [];
  for (let i = 0; i < n; i++) {
    const y0 = plinth + t + gap * i; // top of the shelf board below this compartment
    if (i > 0) b.box('body', 'f:wood', [0, y0 - t / 2, 0.005], [w - 2 * t, t, d - 0.015], 0.003);
    const clear = gap - (i > 0 ? t : 0) - 0.03;
    const row = bookRow(w - 2 * t - 0.02, clear, d - 0.07, b.rng, { fill: i === n - 1 ? 0.5 : 0.62 + b.rng() * 0.3, gap: 0.09, lean: i % 2 === 0 });
    if (row) books.push([row, y0 + 0.001]);
  }
  for (const [g, y] of books) b.add('books', g, 'k:paper', M(0, y, 0.025), { shadow: true });
}

export function rug(b) {
  const { w, d, h } = b;
  const fh = h * 0.8;
  b.box('fabric', 'f:rug2', [0, fh / 2, 0], [w, fh, d], Math.min(0.004, fh / 3), { seg: 1 });
  const bw = Math.min(0.07, w * 0.12), ins = Math.min(0.045, w * 0.07);
  const y = fh + (h - fh) / 2, hh = h - fh;
  b.plain('border', 'f:rug', [0, y, -d / 2 + ins + bw / 2], [w - 2 * ins, hh, bw]);
  b.plain('border', 'f:rug', [0, y, d / 2 - ins - bw / 2], [w - 2 * ins, hh, bw]);
  b.plain('border', 'f:rug', [-w / 2 + ins + bw / 2, y, 0], [bw, hh, d - 2 * ins - 2 * bw]);
  b.plain('border', 'f:rug', [w / 2 - ins - bw / 2, y, 0], [bw, hh, d - 2 * ins - 2 * bw]);
  const n = w >= 1.2 ? clamp(Math.round(w / 0.28), 4, 12) : 0;
  for (let i = 0; i < n; i++) b.plain('fabric', 'f:rug', [lerp(-w / 2 + 0.3, w / 2 - 0.3, (i + 0.5) / n), y, 0], [0.012, hh, d - 0.5]);
}

export const builders = { sofa3, sofa2, armchair, 'coffee-table': coffeeTable, 'tv-unit': tvUnit, tv, bookshelf, rug };
