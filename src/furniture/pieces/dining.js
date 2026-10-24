// Dining and work pieces: dining table, dining chair, desk, desk chair.
import { M, deg } from '../kit.js';

export function diningTable(b) {
  const { w, d, h } = b;
  const tt = 0.035;
  b.box('top', 'f:wood', [0, h - tt / 2, 0], [w, tt, d], 0.012, { seg: 2, top: 2 });
  const inset = 0.09, lw = 0.065;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('legs', 'f:wood', [sx * (w / 2 - inset), (h - tt) / 2, sz * (d / 2 - inset)], lw, 0.04, h - tt);
  b.box('legs', 'f:wood', [0, h - tt - 0.04, d / 2 - inset], [w - 2 * inset, 0.07, 0.025], 0.005);
  b.box('legs', 'f:wood', [0, h - tt - 0.04, -d / 2 + inset], [w - 2 * inset, 0.07, 0.025], 0.005);
  for (const sx of [-1, 1]) b.box('legs', 'f:wood', [sx * (w / 2 - inset), h - tt - 0.04, 0], [0.025, 0.07, d - 2 * inset], 0.005);
}

export function diningChair(b) {
  const { w, d, h } = b;
  const seatY = 0.45, st = 0.04, legW = 0.04;
  for (const sx of [-1, 1]) {
    b.leg('frame', 'f:wood', [sx * (w / 2 - 0.035), seatY / 2, d / 2 - 0.04], legW, 0.026, seatY);
    // back leg runs up into the backrest post, leaning back a little
    b.box('frame', 'f:wood', [sx * (w / 2 - 0.035), h / 2 - 0.005, -d / 2 + 0.055], [0.036, h - 0.02, 0.036], 0.01, { rot: [deg(-4), 0, 0] });
  }
  b.box('frame', 'f:wood', [0, seatY - 0.075, d / 2 - 0.04], [w - 0.08, 0.04, 0.022], 0.005);
  b.box('frame', 'f:wood', [0, seatY - 0.075, -d / 2 + 0.04], [w - 0.08, 0.04, 0.022], 0.005);
  b.box('frame', 'f:wood', [0, h - 0.17, -d / 2 + 0.036], [w - 0.07, 0.07, 0.024], 0.01, { rot: [deg(-4), 0, 0] }); // top rail
  b.box('frame', 'f:wood', [0, h - 0.27, -d / 2 + 0.043], [w - 0.07, 0.05, 0.02], 0.008, { rot: [deg(-4), 0, 0] });
  b.add('seat', b.cush(w - 0.03, st, d - 0.04, { r: 0.016, puff: 0.012, dent: 0, top: 2, seg: 2 }), 'f:fabric', M(0, seatY - st / 2 + 0.01, 0.005));
}

export function desk(b) {
  const { w, d, h } = b;
  const tt = 0.03;
  b.box('top', 'f:wood', [0, h - tt / 2, 0], [w, tt, d], 0.01, { seg: 2, top: 2 });
  // two trestle sides and a back rail in dark metal
  for (const sx of [-1, 1]) {
    b.box('frame', 'k:black', [sx * (w / 2 - 0.06), (h - tt) / 2, 0], [0.03, h - tt, d - 0.12], 0.008);
    b.box('frame', 'k:black', [sx * (w / 2 - 0.06), 0.02, 0], [0.05, 0.03, d - 0.04], 0.008);
  }
  b.box('frame', 'k:black', [0, h - tt - 0.09, -d / 2 + 0.07], [w - 0.18, 0.18, 0.015], 0.006);
}

export function deskChair(b) {
  const { w, d, h } = b;
  const seatY = 0.46;
  b.cyl('base', 'k:black', [0, 0.22, 0], 0.03, 0.03, seatY - 0.1, { seg: 12 }); // gas column up to the seat plate
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3, len = w / 2 - 0.03;
    b.box('base', 'k:black', [Math.sin(a) * len * 0.5, 0.045, Math.cos(a) * len * 0.5], [0.04, 0.025, len], 0.008, { rot: [0, a, 0] });
    b.cyl('base', 'k:black', [Math.sin(a) * len, 0.025, Math.cos(a) * len], 0.022, 0.022, 0.05, { seg: 10 });
  }
  b.cyl('base', 'k:black', [0, seatY - 0.06, 0], 0.085, 0.06, 0.04, { seg: 14 });
  b.add('upholstery', b.cush(w - 0.04, 0.09, d - 0.08, { r: 0.04, puff: 0.02, dent: 0, top: 3 }), 'f:fabric', M(0, seatY - 0.01, 0.02));
  b.add('upholstery', b.cush(w - 0.1, h - seatY - 0.2, 0.08, { r: 0.04, puff: 0.02, dent: 0.006, top: 3 }), 'f:fabric', M(0, seatY + 0.17 + (h - seatY - 0.2) / 2, -d / 2 + 0.07, deg(-8)));
  b.box('base', 'k:black', [0, seatY + 0.09, -d / 2 + 0.1], [0.045, 0.2, 0.03], 0.008, { rot: [deg(-8), 0, 0] }); // spine to the backrest
  for (const s of [-1, 1]) {
    b.box('base', 'k:black', [s * (w / 2 - 0.035), seatY + 0.125, 0.0], [0.03, 0.025, d * 0.5], 0.008);
    b.box('base', 'k:black', [s * (w / 2 - 0.035), seatY + 0.06, 0.04], [0.025, 0.12, 0.03], 0.006);
  }
}

export const builders = { 'dining-table': diningTable, 'dining-chair': diningChair, desk, 'desk-chair': deskChair };
