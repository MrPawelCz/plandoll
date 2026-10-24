// Tier 2 pieces built so far: base and wall cabinets, hob cabinet, fridge-freezer, washing machine.
// Local frame as everywhere: front +z, centre of the footprint, y up; handles stay inside the depth of the spec.
import { clamp } from '../kit.js';

// Base cabinet carcass with plinth, fronts and handles; worktop slab on top (its top face is at h - topLift).
function baseCabinet(b, { fronts, topLift = 0 }) {
  const { w, d, h } = b;
  const plinth = 0.1, wt = 0.03, topY = h - topLift;
  const fz = d / 2 - 0.032; // front plane of doors and drawers
  b.box('body', 'f:body', [0, plinth + (topY - wt - plinth) / 2, -0.025], [w - 0.004, topY - wt - plinth, d - 0.05], 0.006, { seg: 1 });
  b.box('body', 'f:dark', [0, plinth / 2, -0.03], [w - 0.03, plinth, d - 0.1], 0.004);
  b.box('worktop', 'f:top', [0, topY - wt / 2, 0], [w, wt, d], 0.008, { seg: 2, top: 2 });
  const y0 = plinth + 0.004, y1 = topY - wt - 0.004;
  for (const f of fronts(y0, y1)) {
    b.box('fronts', 'f:wood', [f.x, (f.y0 + f.y1) / 2, fz - 0.009], [f.w - 0.006, f.y1 - f.y0 - 0.006, 0.018], 0.004);
    if (f.handle !== false) {
      if (f.drawer) b.box('handles', 'k:brass', [f.x, f.y1 - 0.045, fz + 0.005], [Math.min(0.16, f.w * 0.4), 0.012, 0.012], 0.004);
      else b.box('handles', 'k:brass', [f.x + (f.hx ?? 0), f.y1 - 0.14, fz + 0.005], [0.012, 0.16, 0.012], 0.004);
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

export const builders = { 'kitchen-base': kitchenBase, 'kitchen-hob': kitchenHob, 'kitchen-upper': kitchenUpper, fridge, 'washing-machine': washingMachine };
