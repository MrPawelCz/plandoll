// three.js scene graph for a model: named groups (level:, wall:, opening:, room:, stair:, furniture:) plus the stage
// (lights, sky, base plate, ground). All names double as GLB node names.
import * as THREE from 'three';
import { mat, floorMat, floorName, texScale } from './materials.js';
import { buildFurniture, SCENE_MESHES } from '../furniture/legacy.js';
import { levelOffsets, modelExtent } from '../model/geometry.js';
import { boxGeometry, setBoxUV } from './uv.js';
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
    this.group.name = 'planwalk';
    this.group.userData.planwalk = { name: model.name || 'plan', version: 1, units: 'm' };
    this.cuttables = [];
    this.cutH = null;
    this.ceilings = [];
    this.floors = [];
    this.labels = [];
    this.arcs = [];
    this.furnitureBudget = { left: SCENE_MESHES };
    this.levelGroups = model.levels.map((lv) => this._level(lv));
    this.levelGroups.forEach((g) => this.group.add(g));
    this.setExplode(0);
    this.setMaterials(look);
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
    m.pw = { mat: b.mat, box: true, uv: { u: b.cx * ca + b.cy * sa, w: -b.cx * sa + b.cy * ca, sx: b.sx, sz: b.sz, k: texScale(b.mat), swap: TURNED.has(b.mat) } }; // not in userData: that goes into the GLB
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
    return m;
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
        this._box(wg, {
          name: `wall:${w.id}/${p.part}${i}`, mat: 'wall', y0: p.y0, y1: p.y1,
          cx: w.from[0] + w.dir[0] * um, cy: w.from[1] + w.dir[1] * um, sx: p.u1 - p.u0, sz: w.thickness, angle: w.angle,
        }, lv.slab);
      });
      g.add(wg);
    }
    for (const o of lv.openings) {
      const og = new THREE.Group();
      og.name = `opening:${o.id}`;
      og.userData.type = o.type;
      for (const b of o.parts) this._box(og, b, 0);
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
        floor.pw = { mat: fname };
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

  // The dark cap of a wall piece sits on its current top (at most 4 cm thick, thinner on a very low wall) and shows only in
  // the textured look and only while the walls are cut: a full height wall is closed by the ceiling.
  _placeCap(c) {
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
      if (o.pw?.mat) o.material = mat(o.pw.mat, look);
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

export class Stage {
  constructor(scene) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight('#f6f8fb', '#d9d0c3', 1.85);
    this.sun = new THREE.DirectionalLight('#fff2e0', 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.plate = new THREE.Mesh(UNIT_BOX, mat('plate'));
    this.plate.name = 'plate';
    this.plate.receiveShadow = true;
    const groundGeometry = new THREE.PlaneGeometry(600, 600);
    const guv = groundGeometry.getAttribute('uv'); // the 600 m square carries 600 m of texture
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 600 * texScale('ground'), guv.getY(i) * 600 * texScale('ground'));
    this.ground = new THREE.Mesh(groundGeometry, mat('ground'));
    this.ground.name = 'ground';
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    scene.add(this.plate, this.ground);
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#eaf0f6');
    grad.addColorStop(1, '#cfd8e3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    this.sky = new THREE.CanvasTexture(c);
    this.sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.sky;
    this.walk = false;
  }

  fit(model, explode = 0) {
    const e = modelExtent(model, explode);
    const cx = (e.minX + e.maxX) / 2, cz = (e.minZ + e.maxZ) / 2, cyy = (e.minY + e.maxY) / 2;
    const R = Math.max(2, 0.5 * Math.hypot(e.maxX - e.minX, e.maxY - e.minY, e.maxZ - e.minZ)) * 1.05;
    const dir = new THREE.Vector3(-0.55, 1.2, 0.3).normalize();
    this.sun.position.set(cx + dir.x * R * 3, cyy + dir.y * R * 3, cz + dir.z * R * 3);
    this.sun.target.position.set(cx, cyy, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = R * 7;
    cam.updateProjectionMatrix();
    const w = e.maxX - e.minX, d = e.maxZ - e.minZ;
    const pm = Math.max(1.2, 0.12 * Math.max(w, d));
    const base = model.levels.length ? Math.min(model.levels[0].elevation, e.minY + model.levels[0].slab) : 0; // lower when a stair goes down out of the plan
    this.plate.scale.set(w + 2 * pm, 0.3, d + 2 * pm);
    this.plate.position.set(cx, base - 0.02 - 0.15, cz);
    this.ground.position.set(cx, base - 0.02, cz);
    return { cx, cy: cyy, cz, R };
  }

  setMaterials(look) {
    this.ground.material = mat('ground', look);
    // The textured look gets a stronger sun and less ambient light: more contrast between lit and shaded surfaces.
    this.hemi.intensity = look === 'textured' ? 1.4 : 1.85;
    this.sun.intensity = look === 'textured' ? 2.1 : 1.55;
  }

  setWalk(on) {
    this.walk = on;
    this.plate.visible = !on;
    this.ground.visible = on;
    this.scene.fog = on ? new THREE.Fog('#d9e1ea', 30, 140) : null;
  }
}
