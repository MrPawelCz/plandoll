// Draws a furnished plan to SVG (walls, doors with the swing, windows, door zones, pieces with a front arrow) and builds a contact
// sheet of many plans. Usage:
//   node tools/layout-svg.mjs --out DIR [--seed N] [--png]      all fourteen test plans, one SVG each plus sheet.html (and sheet.png)
// The PNG step starts headless Chrome (software GL off, no WebGL needed) and must be run through the Chrome lock:
//   tools/chrome-lock.sh node tools/layout-svg.mjs --out DIR --png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { SPEC_BY_ID } from '../src/furniture/specs.js';
import { roomType } from '../src/layout/rooms.js';
import { levelZones, obb } from '../src/layout/geometry.js';
import { frontOf } from '../src/layout/geometry.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GROUP_FILL = { living: '#e3c29a', dining: '#d4e3a4', sleep: '#a9cbea', work: '#c4b6e6', kitchen: '#efd27c', bath: '#9edbdf', hall: '#d9d9d9', decor: '#b4dca8' };
const SHORT = { 'dining-table': 'table', 'dining-chair': 'chair', 'coffee-table': 'coffee', 'kitchen-base': 'base', 'kitchen-upper': 'upper', 'kitchen-sink': 'sink', 'kitchen-hob': 'hob', 'bed-double': 'bed', 'bed-single': 'bed1', 'tv-unit': 'tv unit', nightstand: 'ns', 'table-lamp': 'lamp', 'floor-lamp': 'flamp', 'plant-large': 'plant', 'plant-small': 'plant', 'art-large': 'art', 'art-small': 'art', 'washing-machine': 'wash', washbasin: 'basin', 'desk-chair': 'chair', bookshelf: 'shelf', wardrobe: 'ward' };

function f(v) { return Math.round(v * 1000) / 1000; }
const poly = (pts) => pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');

export function levelSvg(model, layout, levelIndex = 0, { violations = [], zones = true, labels = true, title = '' } = {}) {
  const level = model.levels[levelIndex];
  const L = layout.levels.find((l) => l.id === level.id) ?? { pieces: [] };
  const b = model.bounds;
  const pad = 0.6;
  const vb = [b.minX - pad, b.minY - pad - (title ? 0.5 : 0), b.width + 2 * pad, b.height + 2 * pad + (title ? 0.5 : 0)];
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f).join(' ')}" font-family="Helvetica, Arial, sans-serif">`, `<rect x="${f(vb[0])}" y="${f(vb[1])}" width="${f(vb[2])}" height="${f(vb[3])}" fill="#fbfaf7"/>`];
  if (title) out.push(`<text x="${f(b.minX)}" y="${f(b.minY - pad + 0.1)}" font-size="0.32" fill="#222">${esc(title)}</text>`);
  for (const r of level.rooms) {
    if (r.polygon.length < 3) continue;
    out.push(`<polygon points="${poly(r.polygon)}" fill="#f1ece2" stroke="none"/>`);
  }
  if (zones) {
    const z = levelZones(level, model);
    for (const d of z.doors) out.push(`<polygon points="${poly(d.box.pts)}" fill="#e14b4b" fill-opacity="0.13" stroke="#e14b4b" stroke-opacity="0.35" stroke-width="0.01"/>`);
    for (const s of z.stairs) out.push(`<polygon points="${poly(s.box.pts)}" fill="#999" fill-opacity="0.2"/>`);
  }
  const pieces = L.pieces.map((p) => ({ p, spec: SPEC_BY_ID[p.type] })).filter((x) => x.spec);
  const flat = pieces.filter((x) => x.spec.place.mode === 'floor-flat'), rest = pieces.filter((x) => x.spec.place.mode !== 'floor-flat');
  const bad = new Set(violations.filter((v) => v.level === level.id).flatMap((v) => [v.piece, v.other]).filter(Boolean));
  const draw = ({ p, spec }) => {
    const box = obb(p.x, p.y, p.size[0], p.size[1], p.rot);
    const [fx, fy] = frontOf(p.rot);
    const mode = spec.place.mode;
    const fill = mode === 'floor-flat' ? '#a5735b' : mode === 'wall-mount' ? '#d65b9c' : mode === 'window' ? '#8c6fd1' : mode === 'ceiling' ? '#f2b84b' : GROUP_FILL[spec.group] ?? '#ddd';
    const opacity = mode === 'floor-flat' ? 0.35 : mode === 'wall-mount' || mode === 'window' ? 0.85 : mode === 'surface' ? 0.95 : 0.9;
    const stroke = bad.has(p.id) ? '#e00000' : '#4b4b4b';
    out.push(`<polygon points="${poly(box.pts)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${bad.has(p.id) ? 0.04 : 0.012}"/>`);
    if (mode !== 'wall-mount' && mode !== 'window' && mode !== 'floor-flat') {
      const l = Math.min(0.25, p.size[1] / 2);
      out.push(`<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(p.x + fx * (p.size[1] / 2 - 0.02 + l * 0))}" y2="${f(p.y + fy * (p.size[1] / 2 - 0.02))}" stroke="#222" stroke-width="0.012"/>`);
      out.push(`<circle cx="${f(p.x + fx * (p.size[1] / 2 - 0.02))}" cy="${f(p.y + fy * (p.size[1] / 2 - 0.02))}" r="0.03" fill="#222"/>`);
    }
    if (labels && p.size[0] >= 0.5 && mode !== 'wall-mount' && mode !== 'window') out.push(`<text x="${f(p.x)}" y="${f(p.y + 0.05)}" font-size="0.14" text-anchor="middle" fill="#222" fill-opacity="0.85">${esc(SHORT[p.type] ?? p.type)}</text>`);
  };
  flat.forEach(draw);
  for (const w of level.walls) out.push(`<line x1="${f(w.from[0])}" y1="${f(w.from[1])}" x2="${f(w.to[0])}" y2="${f(w.to[1])}" stroke="#3a3a3a" stroke-width="${f(w.thickness)}" stroke-linecap="square"/>`);
  for (const o of level.openings) {
    const w = level.wallById.get(o.wallId);
    if (!w) continue;
    const a = [w.from[0] + w.dir[0] * o.u0, w.from[1] + w.dir[1] * o.u0], c = [w.from[0] + w.dir[0] * o.u1, w.from[1] + w.dir[1] * o.u1];
    const col = o.type === 'window' ? '#7fb6e8' : '#fbfaf7';
    out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}" stroke="${col}" stroke-width="${f(w.thickness * (o.type === 'window' ? 0.55 : 1.02))}"/>`);
    if (o.type === 'door' && o.arc) {
      const r = o.arc.r, a0 = o.arc.a0, a1 = o.arc.a0 + o.arc.sweep;
      const p0 = [o.arc.cx + Math.cos(a0) * r, o.arc.cy + Math.sin(a0) * r], p1 = [o.arc.cx + Math.cos(a1) * r, o.arc.cy + Math.sin(a1) * r];
      out.push(`<path d="M ${f(o.arc.cx)} ${f(o.arc.cy)} L ${f(p0[0])} ${f(p0[1])} A ${f(r)} ${f(r)} 0 0 ${o.arc.sweep > 0 ? 1 : 0} ${f(p1[0])} ${f(p1[1])} Z" fill="none" stroke="#777" stroke-width="0.012"/>`);
    }
  }
  rest.forEach(draw);
  for (const r of level.rooms) {
    if (r.polygon.length < 3 || !labels) continue;
    out.push(`<text x="${f(r.label[0])}" y="${f(r.label[1] - 0.15)}" font-size="0.17" text-anchor="middle" fill="#6a5a44" fill-opacity="0.75">${esc(r.name ?? r.id)} (${roomType(r, model)})</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

// Chrome path for the PNG step (the same lookup as the Chrome tests)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function main() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const outDir = resolve(get('--out', 'layout-sheet'));
  const seed = Number(get('--seed', 1));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { analyzePlan, modelOf } = await import(pathToFileURL(join(root, 'src/core/validate.js')));
  const { buildModel } = await import(pathToFileURL(join(root, 'src/model/geometry.js')));
  const { generatePlan } = await import(pathToFileURL(join(root, 'tools/gen-plans.mjs')));
  const { autoFurnish } = await import(pathToFileURL(join(root, 'src/layout/engine.js')));
  const { checkLayout, countsByRoom } = await import(pathToFileURL(join(root, 'src/layout/check.js')));
  const ex = (n) => JSON.parse(readFileSync(join(root, `examples/${n}.plan.json`), 'utf8'));
  const plans = [['flat-1', ex('flat-1')], ['duplex-1', ex('duplex-1')]];
  for (let s = 401; s <= 412; s++) { const g = generatePlan(s); plans.push([`gen-${s}-${g.family}`, g.plan]); }
  mkdirSync(outDir, { recursive: true });
  const cells = [];
  const metrics = {};
  for (const [name, plan] of plans) {
    const model = buildModel(modelOf(analyzePlan(plan)));
    const t0 = performance.now();
    const layout = autoFurnish(model, { seed });
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    const violations = checkLayout(model, layout);
    metrics[name] = { pieces: layout.levels.reduce((n, l) => n + l.pieces.length, 0), ms, violations: violations.length, violationList: violations.slice(0, 20), perRoom: countsByRoom(layout) };
    model.levels.forEach((lv, i) => {
      const svg = levelSvg(model, layout, i, { violations, title: `${name} ${lv.id}  pieces ${layout.levels[i].pieces.length}  violations ${violations.filter((v) => v.level === lv.id).length}` });
      writeFileSync(join(outDir, `${name}-${lv.id}.svg`), svg);
      cells.push(svg);
    });
  }
  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}.g svg{width:100%;height:auto;border:1px solid #ddd}</style><div class="g">${cells.join('\n')}</div>`;
  writeFileSync(join(outDir, 'sheet.html'), html);
  console.log(`wrote ${cells.length} panels to ${outDir}`);
  if (args.includes('--png')) {
    const w = Number(get('--width', 2400)), h = Number(get('--height', 2200));
    const res = spawnSync('nice', ['-n', '19', CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${join(outDir, 'sheet.png')}`, pathToFileURL(join(outDir, 'sheet.html')).href], { stdio: 'inherit', timeout: 120000 });
    console.log('chrome exit', res.status);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
