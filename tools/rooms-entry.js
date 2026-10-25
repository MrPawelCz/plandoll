// Review page for room colours: the example flat with colours taken from the hash, lit like the other contact sheets.
// Hash options: w<i>=<rrggbb | lib-key> and f<i>=<rrggbb | lib-key> (wall and floor colour of room number i on the first level), cut=<metres>,
// look (textured or clay), az, el, fov, frames. Build with: node tools/build-sheet.mjs tools/rooms-entry.js <out.html>
import { runSheet } from './sheet-studio.js';
import { validatePlan } from '../src/core/validate.js';
import { buildModel } from '../src/model/geometry.js';
import { PlanScene } from '../src/render/scene.js';
import flat from '../examples/flat-1.plan.json';

const spec = (v) => (v ? (v.startsWith('lib-') ? `lib:${v.slice(4)}` : `#${v}`) : undefined);

runSheet(({ scene, opt }) => {
  const model = buildModel(validatePlan(JSON.parse(JSON.stringify(flat))).normalized);
  const look = opt.look ?? 'textured', ps = new PlanScene(model, look), lv = model.levels[0];
  const colors = { [lv.id]: {} };
  lv.rooms.forEach((r, i) => { if (opt[`w${i}`] || opt[`f${i}`]) colors[lv.id][r.id] = { wall: spec(opt[`w${i}`]), floor: spec(opt[`f${i}`]) }; });
  ps.setRoomColors(colors, look);
  if (opt.cut) ps.setCut(Number(opt.cut));
  const xs = lv.walls.flatMap((w) => [w.from[0], w.to[0]]), zs = lv.walls.flatMap((w) => [w.from[1], w.to[1]]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  ps.group.position.set(-(x0 + x1) / 2, 0, -(z0 + z1) / 2);
  scene.add(ps.group);
  queueMicrotask(() => { if (window.__stats) window.__stats.skins = ps.skins.size; });
  return { width: x1 - x0, depth: z1 - z0 };
});
