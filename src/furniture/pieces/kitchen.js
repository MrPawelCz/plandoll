// Kitchen pieces: base, sink, hob and wall cabinets, fridge-freezer, washing machine.
// Local frame as everywhere: front +z, centre of the footprint, y up; handles stay inside the depth of the spec.
import { clamp, tubePath, M } from '../kit.js';

// Base cabinet carcass with plinth, fronts and handles; worktop slab on top (its top face is at h - topLift).
// `open` leaves the carcass without a top (sides, back, bottom only) so that a bowl can sink into it; `worktop(topY, wt)` replaces the slab.
export function baseCabinet(b, { fronts, topLift = 0, open = false, worktop = null, handleSlot = 'handles' }) {
  const { w, d, h } = b;
  const plinth = 0.1, wt = 0.03, topY = h - topLift;
  const fz = d / 2 - 0.032; // front plane of doors and drawers
  const inner = topY - wt - plinth;
  if (open) {
    const t = 0.018, y = plinth + inner / 2;
    for (const sx of [-1, 1]) b.box('body', 'f:body', [sx * (w / 2 - t / 2 - 0.002), y, -0.025], [t, inner, d - 0.05], 0.004, { seg: 1 });
    b.box('body', 'f:body', [0, y, -d / 2 + t / 2], [w - 0.004, inner, t], 0.004, { seg: 1 });
    b.box('body', 'f:body', [0, plinth + t / 2, -0.025], [w - 0.004, t, d - 0.05], 0.004, { seg: 1 });
  } else {
    b.box('body', 'f:body', [0, plinth + inner / 2, -0.025], [w - 0.004, inner, d - 0.05], 0.006, { seg: 1 });
  }
  b.box('body', 'f:dark', [0, plinth / 2, -0.03], [w - 0.03, plinth, d - 0.1], 0.004);
  if (worktop) worktop(topY, wt);
  else b.box('worktop', 'f:top', [0, topY - wt / 2, 0], [w, wt, d], 0.008, { seg: 2, top: 2 });
  const y0 = plinth + 0.004, y1 = topY - wt - 0.004;
  for (const f of fronts(y0, y1)) {
    b.box('fronts', 'f:wood', [f.x, (f.y0 + f.y1) / 2, fz - 0.009], [f.w - 0.006, f.y1 - f.y0 - 0.006, 0.018], 0.004);
    if (f.handle !== false) {
      if (f.drawer) b.box(handleSlot, 'k:brass', [f.x, f.y1 - 0.045, fz + 0.005], [Math.min(0.16, f.w * 0.4), 0.012, 0.012], 0.004);
      else b.box(handleSlot, 'k:brass', [f.x + (f.hx ?? 0), f.y1 - 0.14, fz + 0.005], [0.012, 0.16, 0.012], 0.004);
    }
  }
}

export function kitchenBase(b) {
  const { w } = b, n = clamp(Math.round(w / 0.5), 1, 3);
  baseCabinet(b, {
    fronts: (y0, y1) => {
      const out = [{ x: 0, w, y0: y1 - 0.17, y1, drawer: true }], dw = w / n;
      for (let i = 0; i < n; i++) out.push({ x: -w / 2 + dw * (i + 0.5), w: dw, y0, y1: y1 - 0.17, hx: (i % 2 ? -1 : 1) * (dw / 2 - 0.04) });
      return out;
    },
  });
}

// Sink cabinet: doors below, a worktop with a cut-out for a steel bowl (and a ribbed drainer when wide), a rim and a gooseneck tap.
// `size[2]` is the height with the tap: the worktop sits 0.2 m lower, like the other base cabinets, and the tap reaches the top.
export function kitchenSink(b) {
  const { w, d, h } = b;
  const tapH = 0.2, n = clamp(Math.round(w / 0.5), 1, 3), wide = w >= 1.0;
  const ow = wide ? 0.46 : w - 0.26, od = 0.38, ox = wide ? -w / 2 + 0.08 + ow / 2 : 0, oz = 0.03, bd = 0.17;
  const rim = 0.016;
  baseCabinet(b, {
    topLift: tapH,
    open: true,
    handleSlot: 'fronts',
    worktop: (topY, wt) => {
      const y = topY - wt / 2, zb = oz - od / 2, zf = oz + od / 2, x0 = ox - ow / 2, x1 = ox + ow / 2;
      b.box('worktop', 'f:top', [0, y, (-d / 2 + zb) / 2], [w, wt, zb + d / 2], 0.0006); // behind the bowl
      b.box('worktop', 'f:top', [0, y, (zf + d / 2) / 2], [w, wt, d / 2 - zf], 0.0006); // in front of it
      b.box('worktop', 'f:top', [(-w / 2 + x0) / 2, y, oz], [x0 + w / 2, wt, od], 0.0006); // left of it
      b.box('worktop', 'f:top', [(w / 2 + x1) / 2, y, oz], [w / 2 - x1, wt, od], 0.0006); // right of it
    },
    fronts: (y0, y1) => {
      const out = [], dw = w / n;
      for (let i = 0; i < n; i++) out.push({ x: -w / 2 + dw * (i + 0.5), w: dw, y0, y1, hx: (i % 2 ? -1 : 1) * (dw / 2 - 0.04) });
      return out;
    },
  });
  const topY = h - tapH, x0 = ox - ow / 2, x1 = ox + ow / 2, zb = oz - od / 2, zf = oz + od / 2;
  // rim around the opening, then the bowl: four walls and a floor in steel, with a drain
  const ry = topY + 0.002;
  b.box('basin', 'f:steel', [ox, ry, zb - rim / 2], [ow + 2 * rim, 0.004, rim], 0.001);
  b.box('basin', 'f:steel', [ox, ry, zf + rim / 2], [ow + 2 * rim, 0.004, rim], 0.001);
  b.box('basin', 'f:steel', [x0 - rim / 2, ry, oz], [rim, 0.004, od], 0.001);
  b.box('basin', 'f:steel', [x1 + rim / 2, ry, oz], [rim, 0.004, od], 0.001);
  const wy = topY - bd / 2;
  b.plain('basin', 'f:steel', [ox, wy, zb + 0.002], [ow, bd, 0.004]);
  b.plain('basin', 'f:steel', [ox, wy, zf - 0.002], [ow, bd, 0.004]);
  b.plain('basin', 'f:steel', [x0 + 0.002, wy, oz], [0.004, bd, od]);
  b.plain('basin', 'f:steel', [x1 - 0.002, wy, oz], [0.004, bd, od]);
  b.plain('basin', 'f:steel', [ox, topY - bd, oz], [ow, 0.004, od]);
  b.cyl('basin', 'k:black', [ox, topY - bd + 0.004, oz], 0.032, 0.032, 0.004, { seg: 14 });
  if (wide) { // drainer plate with grooves
    const dx0 = x1 + rim + 0.03, dx1 = w / 2 - 0.05, dw = dx1 - dx0;
    b.box('basin', 'f:steel', [(dx0 + dx1) / 2, topY + 0.0015, oz], [dw, 0.003, od], 0.001);
    for (let i = 0; i < 6; i++) b.plain('basin', 'k:black', [(dx0 + dx1) / 2, topY + 0.0033, oz - od / 2 + 0.03 + (i * (od - 0.06)) / 5], [dw * 0.82, 0.0016, 0.007]);
  }
  // gooseneck tap behind the bowl: stem, spout, lever
  const tz = -d / 2 + 0.07;
  b.cyl('tap', 'f:steel', [ox, topY + 0.07, tz], 0.017, 0.021, 0.14, { seg: 14 });
  b.add('tap', tubePath([[0, 0.135, 0], [0, 0.178, 0.03], [0, 0.186, 0.1], [0, 0.17, 0.165], [0, 0.135, 0.18]], 0.0105, { seg: 16, radial: 8 }), 'f:steel', M(ox, topY, tz), { uv: 'keep' });
  b.cyl('tap', 'f:steel', [ox + 0.034, topY + 0.1, tz], 0.007, 0.007, 0.07, { seg: 8, rot: [0, 0, Math.PI / 2] });
}

export function kitchenHob(b) {
  const { w, d, h } = b;
  baseCabinet(b, {
    topLift: 0.008,
    fronts: (y0, y1) => [{ x: 0, w, y0: y1 - 0.12, y1, drawer: true }, { x: 0, w, y0, y1: y1 - 0.12, handle: false }],
  });
  const fz = d / 2 - 0.032;
  b.box('handles', 'k:brass', [0, h - 0.008 - 0.03 - 0.17, fz + 0.005], [w * 0.7, 0.014, 0.014], 0.005); // oven rail
  b.box('fronts', 'k:black', [0, 0.1 + (h - 0.008 - 0.03 - 0.12 - 0.1) / 2 + 0.01, fz + 0.001], [w * 0.74, (h - 0.008 - 0.03 - 0.12 - 0.1) * 0.62, 0.006], 0.004); // oven window
  b.box('hob', 'k:black', [0, h - 0.004, 0], [w - 0.06, 0.008, d - 0.1], 0.003);
  const rx = w * 0.22, rz = d * 0.2, wide = w > 0.7;
  for (const [x, z, r] of [[-rx, -rz, 0.075], [rx, -rz, 0.06], [-rx, rz, 0.06], [rx, rz, 0.075]]) {
    b.cyl('hob', 'k:brass', [x, h - 0.0005, z], r, r, 0.004, { seg: 20 });
    b.cyl('hob', 'k:black', [x, h + 0.0005, z], r * 0.55, r * 0.55, 0.004, { seg: 16 });
  }
  void wide;
}

export function kitchenUpper(b) {
  const { w, d, h } = b;
  const n = clamp(Math.round(w / 0.45), 1, 3), dw = w / n, fz = d / 2 - 0.02;
  b.box('body', 'f:body', [0, h / 2, -0.01], [w, h, d - 0.02], 0.006, { seg: 1 });
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    b.box('fronts', 'f:wood', [x, h / 2, fz - 0.009], [dw - 0.006, h - 0.008, 0.018], 0.004);
    b.box('handles', 'k:brass', [x + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), 0.14, fz + 0.005], [0.012, 0.14, 0.012], 0.004);
  }
}

export function fridge(b) {
  const { w, d, h } = b;
  const fz = d / 2 - 0.03, tall = h > 1.5, split = tall ? 0.34 * h : 0;
  b.box('body', 'f:fridge', [0, h / 2, -0.02], [w - 0.004, h, d - 0.04], 0.012, { seg: 2 });
  if (tall) {
    b.box('body', 'f:fridge', [0, split / 2 + 0.01, fz - 0.015], [w - 0.012, split - 0.006, 0.03], 0.008, { seg: 2 });
    b.box('body', 'f:fridge', [0, split + (h - split) / 2, fz - 0.015], [w - 0.012, h - split - 0.014, 0.03], 0.008, { seg: 2 });
    b.box('handle', 'f:steel', [-w / 2 + 0.05, split + 0.45, fz + 0.012], [0.02, 0.55, 0.026], 0.008);
    b.box('handle', 'f:steel', [-w / 2 + 0.05, split - 0.1, fz + 0.012], [0.02, 0.25, 0.026], 0.008);
  } else {
    b.box('body', 'f:fridge', [0, h / 2, fz - 0.015], [w - 0.012, h - 0.012, 0.03], 0.008, { seg: 2 });
    b.box('handle', 'f:steel', [-w / 2 + 0.05, h - 0.2, fz + 0.012], [0.02, 0.22, 0.026], 0.008);
  }
}

export function washingMachine(b) {
  const { w, d, h } = b;
  const fz = d / 2 - 0.02;
  b.box('body', 'f:white', [0, h / 2, -0.01], [w, h, d - 0.02], 0.014, { seg: 2 });
  b.box('body', 'f:dark', [0, h - 0.05, fz + 0.001], [w - 0.06, 0.07, 0.004], 0.003); // control strip
  b.cyl('body', 'f:steel', [w * 0.3, h - 0.05, fz + 0.012], 0.022, 0.022, 0.016, { seg: 14, rot: [Math.PI / 2, 0, 0] }); // dial
  const dy = (h - 0.1) / 2 - 0.01, R = Math.min(0.22, w * 0.37);
  b.cyl('door', 'f:steel', [0, dy, fz + 0.003], R, R, 0.016, { seg: 32, rot: [Math.PI / 2, 0, 0] });
  b.cyl('door', 'k:black', [0, dy, fz + 0.012], R * 0.78, R * 0.78, 0.008, { seg: 32, rot: [Math.PI / 2, 0, 0] });
}

export const builders = { 'kitchen-base': kitchenBase, 'kitchen-sink': kitchenSink, 'kitchen-hob': kitchenHob, 'kitchen-upper': kitchenUpper, fridge, 'washing-machine': washingMachine };
