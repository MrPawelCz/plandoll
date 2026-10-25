// three.js scene graph for a model: named groups (level:, wall:, opening:, room:, stair:, furniture:). All names double as GLB node names.
// The presentation scene (light, base, backdrop) is in src/look/stage.js.
import * as THREE from 'three';
import { mat, floorMat, floorName, texScale, paintMat, LOOKS, setWallFloors } from './materials.js';
import { sunPatchMesh } from './sunpatch.js';
import { MATERIAL_KEYS } from './library.js';
import { buildFurniture, SCENE_MESHES } from '../furniture/legacy.js';
import { levelOffsets } from '../model/geometry.js';
import { boxGeometry, setBoxUV, setPaneUV } from './uv.js';
import { roomArea, formatArea } from '../model/areas.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const TURNED = new Set(['leaf', 'stair']); // wood that runs across its box: a door grain is vertical, tread boards cross the stair
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Flat polygon (with holes) at height y, facing up or down; triangle winding is fixed from the cross product.
// The uv are plan metres times k (repeats per metre of the floor texture).
function flatGeometry(polygon, holes, y, up, k = 1) {
  const contour = polygon.map((p) => new THREE.Vector2(p[0], p[1]));
  const holeV = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  const tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
  const pts = contour.concat(...holeV);
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = v.y; });
  const idx = [];
  for (const [a, b, c] of tris) {
    const ny = (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x) - (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y);
    const faceUp = ny > 0;
    if (faceUp === up) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const nrm = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) nrm[i * 3 + 1] = up ? 1 : -1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const uv = new Float32Array(pts.length * 2);
  pts.forEach((v, i) => { uv[i * 2] = v.x * k; uv[i * 2 + 1] = v.y * k; });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function slabGeometry(polygon, holes, depth, k = 1) {
  const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // plan y -> world z, extrusion goes down
  g.translate(0, -0.004, 0);
  const uv = g.getAttribute('uv'); // metres from the extruder, scaled to repeats
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return g;
}

// CanvasRenderingContext2D.roundRect needs Safari 16 or Chrome 99; older browsers get the same outline from arcs.
function roundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The picture of a room label: the room name and its area text ("12,3 m²" in Polish, "~12.3 m²" for an estimate in English).
function labelTexture(name, areaText) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 176;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = 'rgba(80,72,62,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  roundedRect(ctx, 6, 6, 500, 164, 34);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let size = 60;
  const font = (s, w) => `${w} ${s}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.font = font(size, 600);
  while (ctx.measureText(name).width > 440 && size > 26) { size -= 2; ctx.font = font(size, 600); }
  ctx.fillStyle = '#37332d';
  ctx.fillText(name, 256, 84);
  ctx.font = font(42, 400);
  ctx.fillStyle = '#7a7266';
  ctx.fillText(areaText, 256, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// pw keeps what the picture was made from, so relabel() can draw it again in another language (not in userData: that goes into the GLB).
function makeLabel(name, area, widthWorld) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, formatArea(area.m2, area.estimated)), transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(widthWorld, (widthWorld * 176) / 512, 1);
  sprite.renderOrder = 20;
  sprite.pw = { name, area };
  return sprite;
}

// Room colours: '#rrggbb' or 'lib:<key of the material library>'; anything else means "no colour".
const HEX = /^#[0-9a-fA-F]{6}$/;
const okColor = (v) => typeof v === 'string' && (HEX.test(v) || (v.startsWith('lib:') && MATERIAL_KEYS.includes(v.slice(4))));
const own = (o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);
const SKIN_GAP = 0.002; // a painted skin floats 2 mm in front of the wall face

function inPolygon(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Stretches a box between the heights y0 and y1; its uv follow, so a texture keeps its scale (and its height above the floor) when a wall is cut.
function place(m, y0, y1) {
  m.position.y = (y0 + y1) / 2;
  m.scale.y = Math.max(1e-4, y1 - y0);
  const f = m.pw?.uv;
  if (f) setBoxUV(m.geometry, f.u, (y0 + y1) / 2, f.w, f.sx, y1 - y0, f.sz, f.k, f.swap);
}

export class PlanScene {
  constructor(model, look = 'clay') {
    this.model = model;
    this.look = look;
    this.group = new THREE.Group();
    this.group.name = 'plandoll';
    this.group.userData.plandoll = { name: model.name || 'plan', version: 1, units: 'm' };
    this.cuttables = [];
    this.cutH = null;
    this.ceilings = [];
    this.floors = [];
    this.labels = [];
    this.arcs = [];
    this.furnitureBudget = { left: SCENE_MESHES };
    this.roomFloors = []; // the floor mesh of every room, for setRoomColors
    this.wallPieces = []; // every wall piece with its box and the level it stands on
    this.skins = new Map(); // painted skins on wall faces, by id
    this.roomColors = {};
    this._panes = []; // every window pane with its level, for the window light on the floor
    this.sunPatch = null;
    this.levelGroups = model.levels.map((lv) => this._level(lv));
    this.levelGroups.forEach((g) => this.group.add(g));
    this.setExplode(0);
    this.setMaterials(look);
    this.sunPatch = sunPatchMesh(this._panes, this.group);
    if (this.sunPatch) this.group.add(this.sunPatch);
  }

  _box(parent, b, drop) {
    const material = mat(b.mat);
    const m = new THREE.Mesh(boxGeometry(), material);
    m.name = b.name;
    m.position.set(b.cx, 0, b.cy);
    m.rotation.y = -b.angle;
    m.scale.set(b.sx, 1, b.sz);
    // Texture frame: metres along the box's own axes, so a texture runs on along a wall and over the steps of a stair.
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    if (b.mat === 'glass') { m.pw = { mat: b.mat, box: true, pane: true }; setPaneUV(m.geometry); } // a pane shows one picture, not a metric texture
    else m.pw = { mat: b.mat, box: true, uv: { u: b.cx * ca + b.cy * sa, w: -b.cx * sa + b.cy * ca, sx: b.sx, sz: b.sz, k: texScale(b.mat), swap: TURNED.has(b.mat) } }; // not in userData: that goes into the GLB
    const y0 = b.y0 <= 1e-6 ? b.y0 - drop : b.y0;
    place(m, y0, b.y1);
    m.castShadow = b.mat !== 'glass';
    m.receiveShadow = b.mat !== 'glass';
    parent.add(m);
    const entry = { mesh: m, y0, y1: b.y1 };
    this.cuttables.push(entry);
    // Textured look: a dark cap on every solid wall piece, like the dark wall tops of an architectural cutaway drawing.
    if (b.mat === 'wall' && b.name.includes('/solid')) {
      const cap = new THREE.Mesh(boxGeometry(), mat('wallcap'));
      cap.position.set(b.cx, 0, b.cy);
      cap.rotation.y = -b.angle;
      cap.scale.set(b.sx, 1, b.sz);
      cap.pw = { mat: 'wallcap', box: true, look: 'textured' };
      cap.receiveShadow = true;
      parent.add(cap);
      entry.cap = cap;
    }
    if (b.mat === 'leaf' && b.sx > 0.4 && b.y1 - b.y0 > 1.5) this._handle(parent, b, y0);
    return m;
  }

  // A door handle: one small steel bar through the leaf near its free end, at hand height. It is cut together with the walls.
  _handle(parent, b, y0) {
    const h0 = y0 + 0.84, h1 = h0 + 0.035, dx = b.sx / 2 - 0.08;
    const m = new THREE.Mesh(boxGeometry(), mat('f:steel'));
    m.name = `${b.name}/handle`;
    m.position.set(b.cx + Math.cos(b.angle) * dx, 0, b.cy + Math.sin(b.angle) * dx);
    m.rotation.y = -b.angle;
    m.scale.set(0.12, 1, b.sz + 0.07);
    m.pw = { mat: 'f:steel', box: true };
    place(m, h0, h1);
    parent.add(m);
    this.cuttables.push({ mesh: m, y0: h0, y1: h1 });
  }

  _level(lv) {
    const g = new THREE.Group();
    g.name = `level:${lv.id}`;
    g.userData.level = lv.index;
    for (const w of lv.walls) {
      const wg = new THREE.Group();
      wg.name = `wall:${w.id}`;
      w.pieces.forEach((p, i) => {
        const um = (p.u0 + p.u1) / 2;
        const box = this._box(wg, {
          name: `wall:${w.id}/${p.part}${i}`, mat: 'wall', y0: p.y0, y1: p.y1,
          cx: w.from[0] + w.dir[0] * um, cy: w.from[1] + w.dir[1] * um, sx: p.u1 - p.u0, sz: w.thickness, angle: w.angle,
        }, lv.slab);
        this.wallPieces.push({ id: `${lv.id}:${w.id}/${i}`, lv, w, p, mesh: box, entry: this.cuttables[this.cuttables.length - 1], parent: wg });
      });
      g.add(wg);
    }
    for (const o of lv.openings) {
      const og = new THREE.Group();
      og.name = `opening:${o.id}`;
      og.userData.type = o.type;
      for (const b of o.parts) {
        const bm = this._box(og, b, 0);
        if (b.mat === 'glass') this._panes.push({ mesh: bm, floorY: lv.elevation, rooms: lv.rooms.filter((r) => r.polygon.length >= 3).map((r) => r.polygon) });
      }
      g.add(og);
      if (o.arc) {
        const pts = [];
        const a = o.arc;
        pts.push(new THREE.Vector3(a.cx, 0.012, a.cy));
        for (let k = 0; k <= 14; k++) {
          const t = a.a0 + (a.sweep * k) / 14;
          pts.push(new THREE.Vector3(a.cx + Math.cos(t) * a.r, 0.012, a.cy + Math.sin(t) * a.r));
        }
        pts.push(new THREE.Vector3(a.cx, 0.012, a.cy));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#8c867b', transparent: true, opacity: 0.7 }));
        line.name = `arc:${o.id}`;
        g.add(line);
        this.arcs.push(line);
      }
    }
    for (const r of lv.rooms) {
      if (r.polygon.length < 3) continue;
      const rg = new THREE.Group();
      rg.name = `room:${r.id}`;
      const shown = roomArea(r, lv.walls);
      rg.userData.area = shown.m2;
      if (shown.estimated) rg.userData.areaEstimated = true;
      if (r.floor !== 'none') {
        const fname = floorName(r.floor);
        const floor = new THREE.Mesh(flatGeometry(r.polygon, r.floorHoles, 0, true, texScale(fname)), floorMat(r.floor));
        floor.name = `room:${r.id}/floor`;
        floor.pw = { mat: fname, base: fname, k: texScale(fname), room: [lv.id, r.id], flat: { polygon: r.polygon, holes: r.floorHoles } };
        this.roomFloors.push(floor);
        floor.receiveShadow = true;
        const slab = new THREE.Mesh(slabGeometry(r.polygon, r.floorHoles, Math.max(0.01, lv.slab - 0.004), texScale('slab')), mat('slab'));
        slab.name = `room:${r.id}/slab`;
        slab.pw = { mat: 'slab' };
        slab.castShadow = true;
        slab.receiveShadow = true;
        rg.add(floor, slab);
        this.floors.push(floor, slab);
      }
      if (r.ceiling) {
        const ceil = new THREE.Mesh(flatGeometry(r.polygon, r.ceilingHoles, lv.height - 0.004, false, texScale('ceiling')), mat('ceiling'));
        ceil.name = `room:${r.id}/ceiling`;
        ceil.pw = { mat: 'ceiling' };
        ceil.receiveShadow = true;
        ceil.visible = false;
        rg.add(ceil);
        this.ceilings.push(ceil);
      }
      g.add(rg);
      const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
      const short = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const label = makeLabel(r.name || r.id, shown, clamp(short * 0.75, 1.1, 2.4));
      label.name = `label:${r.id}`;
      label.position.set(r.label[0], 0.9, r.label[1]);
      g.add(label);
      this.labels.push(label);
    }
    for (const st of lv.stairs) {
      const sg = new THREE.Group();
      sg.name = `stair:${st.id}`;
      for (const b of st.boxes) this._box(sg, b, 0);
      g.add(sg);
    }
    for (const f of lv.furniture) {
      const fg = buildFurniture(f, this.furnitureBudget);
      fg.position.set(f.center[0], 0, f.center[1]);
      fg.rotation.y = -f.rotation;
      fg.userData.type = f.type;
      g.add(fg);
    }
    return g;
  }

  setExplode(e) {
    const off = levelOffsets(this.model, e);
    this.model.levels.forEach((lv, i) => { this.levelGroups[i].position.y = lv.elevation + off[i]; });
    setWallFloors(this.model.levels.map((lv, i) => lv.elevation + off[i])); // the foot of every wall darkens a little above its floor
    if (this.sunPatch) this.sunPatch.visible = e < 1e-3; // the window light stays on the floor, so it hides while the levels move apart
  }

  setCut(h) {
    this.cutH = h;
    for (const c of this.cuttables) {
      if (h == null) { place(c.mesh, c.y0, c.y1); c.mesh.visible = true; }
      else if (c.y0 >= h - 1e-4) c.mesh.visible = false;
      else { place(c.mesh, c.y0, Math.min(c.y1, h)); c.mesh.visible = true; }
      this._placeCap(c);
    }
  }

  // ---- room colours
  // setRoomColors(colors, look): `colors` is { "<level id>": { "<room id>": { wall?, floor? } } } with '#rrggbb' or 'lib:<key>' values.
  // A floor takes the colour (a texture keeps its structure and gets the colour as its average) or the library material of its room,
  // with the uv rewritten for that texture. A wall takes it on the faces that look into the room: a thin skin 2 mm in front of the
  // face, cut where the room ends along the wall, so openings (the pieces around them are separate) and the other side of the wall
  // stay as they are. A missing or invalid value means the default look; a room that does not exist is ignored; the call is
  // idempotent (same colours, same scene) and with no colours at all the scene is the one the constructor built.
  setRoomColors(colors, look) {
    if (LOOKS.includes(look) && look !== this.look) this.setMaterials(look);
    this.roomColors = colors && typeof colors === 'object' ? colors : {};
    for (const floor of this.roomFloors) {
      const [lvId, roomId] = floor.pw.room;
      const e = own(own(this.roomColors, lvId), roomId);
      const v = e && typeof e === 'object' ? e.floor : undefined;
      this._paintFloor(floor, okColor(v) ? v : null);
    }
    this._paintWalls();
  }

  _paintFloor(floor, value) {
    const pw = floor.pw, sig = value ?? '';
    if (pw.sig === sig) return;
    pw.sig = sig;
    const lib = !!value && value.startsWith('lib:');
    const name = lib ? value : pw.base;
    pw.paint = value ? { color: lib ? undefined : value, offset: true } : null;
    pw.mat = name;
    const k = texScale(name);
    if (k !== pw.k) { // another texture, another repeat per metre
      floor.geometry.dispose();
      floor.geometry = flatGeometry(pw.flat.polygon, pw.flat.holes, 0, true, k);
      pw.k = k;
    }
    floor.material = pw.paint ? paintMat(name, pw.paint.color, this.look, true) : mat(name, this.look);
  }

  // Which room looks at a stretch of a wall piece, per side: [{ side, u0, u1, room }] (found once; the ends are refined to a millimetre).
  _spans(wp) {
    if (wp.spans) return wp.spans;
    const { w, p, lv } = wp, out = [];
    const rooms = lv.rooms.filter((r) => r.polygon.length >= 3);
    const nx = -w.dir[1], ny = w.dir[0], off = w.thickness / 2 + 0.03;
    for (const side of [1, -1]) {
      const at = (u) => {
        const x = w.from[0] + w.dir[0] * u + nx * side * off, y = w.from[1] + w.dir[1] * u + ny * side * off;
        for (const r of rooms) if (inPolygon(x, y, r.polygon)) return r.id;
        return null;
      };
      const edge = (a, b, id) => { for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (at(m) === id) a = m; else b = m; } return (a + b) / 2; };
      const len = p.u1 - p.u0, n = Math.max(1, Math.min(120, Math.ceil(len / 0.1)));
      const mids = Array.from({ length: n }, (_, j) => p.u0 + (len * (j + 0.5)) / n), ids = mids.map(at);
      let start = p.u0;
      for (let j = 1; j <= n; j++) {
        if (j < n && ids[j] === ids[j - 1]) continue;
        const end = j === n ? p.u1 : edge(mids[j - 1], mids[j], ids[j - 1]);
        if (ids[j - 1] && end - start > 0.02) out.push({ side, u0: start, u1: end, room: ids[j - 1] });
        start = end;
      }
    }
    wp.spans = out;
    return out;
  }

  _paintWalls() {
    const keep = new Set();
    for (const wp of this.wallPieces) {
      const spans = this._spans(wp);
      for (let j = 0; j < spans.length; j++) {
        const s = spans[j], e = own(own(this.roomColors, wp.lv.id), s.room);
        const v = e && typeof e === 'object' ? e.wall : undefined;
        if (!okColor(v)) continue;
        const id = `${wp.id}/${s.side > 0 ? 'a' : 'b'}${j}`;
        keep.add(id);
        let skin = this.skins.get(id);
        const fresh = !skin;
        if (fresh) { skin = this._makeSkin(wp, s, id); this.skins.set(id, skin); }
        if (fresh || skin.pw.sig !== v) {
          const lib = v.startsWith('lib:'), name = lib ? v : 'wall';
          skin.pw.sig = v; skin.pw.mat = name; skin.pw.paint = { color: lib ? undefined : v, offset: true }; skin.pw.skin.k = texScale(name);
          skin.material = paintMat(name, skin.pw.paint.color, this.look, true);
          this._placeSkins(wp.entry);
        }
      }
    }
    for (const [id, skin] of [...this.skins]) {
      if (keep.has(id)) continue;
      const entry = skin.pw.owner.entry;
      entry.skins = (entry.skins ?? []).filter((x) => x !== skin);
      skin.parent?.remove(skin);
      skin.geometry.dispose();
      this.skins.delete(id);
    }
  }

  _makeSkin(wp, span, id) {
    const { w } = wp;
    const nx = -w.dir[1], ny = w.dir[0], off = (w.thickness / 2 + SKIN_GAP) * span.side;
    const a = [w.from[0] + w.dir[0] * span.u0 + nx * off, w.from[1] + w.dir[1] * span.u0 + ny * off];
    const b = [w.from[0] + w.dir[0] * span.u1 + nx * off, w.from[1] + w.dir[1] * span.u1 + ny * off];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    const nrm = new Float32Array(12);
    for (let i = 0; i < 4; i++) { nrm[i * 3] = nx * span.side; nrm[i * 3 + 2] = ny * span.side; }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
    g.setIndex(span.side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]); // the front faces into the room
    const m = new THREE.Mesh(g, mat('wall', this.look));
    m.name = `skin:${id}`;
    m.receiveShadow = true;
    m.pw = { mat: 'wall', paint: null, owner: wp, skin: { a, b, u0: span.u0, u1: span.u1, k: 1 } };
    wp.parent.add(m);
    (wp.entry.skins ??= []).push(m);
    return m;
  }

  // A skin has the height range of its wall piece (cut or not, never below the floor), the uv of a texture that keeps its scale.
  _placeSkins(c) {
    if (!c.skins?.length) return;
    const y1 = c.mesh.position.y + c.mesh.scale.y / 2, y0 = Math.max(0, c.mesh.position.y - c.mesh.scale.y / 2);
    for (const s of c.skins) {
      const { a, b, u0, u1, k } = s.pw.skin, pos = s.geometry.getAttribute('position'), uv = s.geometry.getAttribute('uv');
      pos.setXYZ(0, a[0], y0, a[1]); pos.setXYZ(1, b[0], y0, b[1]); pos.setXYZ(2, b[0], y1, b[1]); pos.setXYZ(3, a[0], y1, a[1]);
      uv.setXY(0, u0 * k, y0 * k); uv.setXY(1, u1 * k, y0 * k); uv.setXY(2, u1 * k, y1 * k); uv.setXY(3, u0 * k, y1 * k);
      pos.needsUpdate = true; uv.needsUpdate = true;
      s.geometry.computeBoundingSphere();
      s.visible = c.mesh.visible && y1 - y0 > 1e-3;
    }
  }

  // The dark cap of a wall piece sits on its current top (at most 4 cm thick, thinner on a very low wall) and shows only in
  // the textured look and only while the walls are cut: a full height wall is closed by the ceiling.
  _placeCap(c) {
    this._placeSkins(c); // called after every change of the height of a wall piece (setCut and the cutaway of the page), so the painted skins follow
    const cap = c.cap;
    if (!cap) return;
    const top = c.mesh.position.y + c.mesh.scale.y / 2, t = Math.min(0.04, Math.max(0, (top - c.y0) * 0.5));
    cap.position.y = top + t / 2;
    cap.scale.y = Math.max(1e-4, t);
    cap.visible = this.look === 'textured' && this.cutH != null && c.mesh.visible && t > 0.006;
  }

  setCeilings(on) { for (const c of this.ceilings) c.visible = on; }
  setLabels(on) { for (const l of this.labels) l.visible = on; }
  // Draws every label again after a change of language (decimal comma, units); the sprites, their place and their visibility stay.
  relabel() {
    for (const l of this.labels) {
      const old = l.material.map;
      l.material.map = labelTexture(l.pw.name, formatArea(l.pw.area.m2, l.pw.area.estimated));
      l.material.needsUpdate = true;
      old.dispose();
    }
  }
  setArcs(on) { for (const a of this.arcs) a.visible = on; }
  // In Walk mode floors and ceilings stop casting shadows so the sun reaches the rooms under virtual roofs.
  setWalkShadows(walk) { for (const m of this.floors) m.castShadow = !walk && m.name.endsWith('/slab'); }
  setLevelVisible(fn) { this.levelGroups.forEach((g, i) => { g.visible = fn(i); }); }

  // Swaps every solid to the material of a look: 'clay' (plain colours) or 'textured' (procedural textures).
  setMaterials(look) {
    this.look = look;
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.pw?.mat) o.material = o.pw.paint ? paintMat(o.pw.mat, o.pw.paint.color, look, o.pw.paint.offset) : mat(o.pw.mat, look);
      if (o.pw?.look) o.visible = o.pw.look === look; // shapes that exist in one look only (soft furnishings, leaves, their clay boxes)
    });
    for (const c of this.cuttables) this._placeCap(c);
  }

  // For a GLB: boxes without a texture go back to one shared unit box (as before textures existed), so such a file stays small.
  shareBoxes(share) {
    this.group.traverse((o) => {
      if (!o.isMesh || !o.pw?.box) return;
      if (share) { if (!o.material.map && !o.pw.own) { o.pw.own = o.geometry; o.geometry = UNIT_BOX; } }
      else if (o.pw.own) { o.geometry = o.pw.own; o.pw.own = null; }
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
      else if (o.geometry && o.geometry !== UNIT_BOX && !o.userData.sharedGeometry) {
        if (o.isLine) { o.geometry.dispose(); o.material.dispose(); } else if (o.geometry.userData?.shared !== true && !o.geometry.parameters) o.geometry.dispose();
      }
    });
  }
}
