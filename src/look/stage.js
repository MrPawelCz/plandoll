// The presentation scene around the model: a layered card base in model-paper colours with a soft contact shadow, a pool of
// tabletop that fades into a time-of-day backdrop with blurred lights of far windows, and the light rig. Also the wall wash
// (cloudy colour variation and a darker foot on the walls) and the palette tints of the presets.
import * as THREE from 'three';
import { sample, clock } from './timeofday.js';
import { getPreset, DEFAULT_PRESET } from './presets.js';
import { createRig } from './rig.js';
import { getLevel } from './quality.js';
import { backdropCrop } from './crop.js';
import { mat } from '../render/materials.js';
import { setTextureAnisotropy } from '../render/materials.js';
import { setContactLook } from '../render/contact.js';
import { setSunPatchLook } from '../render/sunpatch.js';

// ---------- palette tints (they multiply the procedural textures of the material library) ----------
export function applyPalette(P) {
  const setC = (name, hex, f) => { const m = mat(name, 'textured'); m.color.set(hex); if (f) f(m); return m; };
  setC('wall', P.wall); setC('slab', '#8c8174'); setC('ceiling', P.wall);
  setC('floor:wood', P.floor, (m) => { m.roughness = 0.5; if (m.normalMap) m.normalScale.set(1.4, -1.4); });
  setC('floor:tile', P.tile, (m) => { m.roughness = 0.35; });
  setC('f:fabric', P.sofa, (m) => { if (m.normalMap) m.normalScale.set(1.3, -1.3); }); setC('f:cushion', P.cushion);
  setC('f:blanket', P.accent); setC('f:bedding', P.bed); setC('f:pillow', '#f7f1e6'); setC('f:linen', '#f2ead8');
  setC('f:rug', P.rug); setC('f:rug2', P.rug2); setC('f:wood', P.wood); setC('f:body', P.body, (m) => { m.roughness = 0.5; }); setC('f:pot', P.pot);
  setC('f:dark', '#35302b'); setC('wallcap', '#d8cdbb');
}

// ---------- wall wash: low-frequency colour cloud in world space plus a slightly darker foot ----------
const WASH_KEY = 'plandoll-wash-v1';
export function washWalls() {
  const m = mat('wall', 'textured');
  if (m.userData.washed) return m;
  m.userData.washed = true;
  m.customProgramCacheKey = () => WASH_KEY;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWp;
      float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 q = vec2(vWp.x + vWp.z, vWp.y);
        float cloud = wn(q * 0.55) * 0.6 + wn(q * 1.7 + 7.0) * 0.28 + wn(q * 5.3 + 3.0) * 0.12;
        diffuseColor.rgb *= 0.82 + 0.34 * cloud;
        diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 1.1, vWp.y)); }`);
  };
  m.needsUpdate = true;
  return m;
}

// ---------- small canvas helpers (all deterministic; no random numbers) ----------
const lcg = (seed) => { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

function softDisc(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(color, alpha)); g.addColorStop(0.55, hexA(color, alpha * 0.45)); g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`; }

// Backdrop: vertical gradient plus blurred lights of far windows (soft rectangles and discs, drawn as gradients so that no
// canvas filter is needed). Redrawn into the same canvas when the time changes.
function paintBackdrop(canvas, k) {
  const w = canvas.width, h = canvas.height, x = canvas.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, k.bgTop); g.addColorStop(1, k.bgBot);
  x.globalAlpha = 1; x.fillStyle = g; x.fillRect(0, 0, w, h);
  const r = lcg(11);
  for (let i = 0; i < 46; i++) { // far windows: soft discs in a band across the upper half
    const px = r() * w, py = h * (0.08 + r() * 0.5), rad = (0.02 + r() * 0.05) * w;
    softDisc(x, px, py, rad, k.glow, k.glowA * (0.25 + r() * 0.6) * (1 - py / (h * 0.8)));
  }
  for (let i = 0; i < 6; i++) { // a few tall soft glows that read as lit towers
    const px = r() * w, bw = (0.03 + r() * 0.05) * w, bh = h * (0.25 + r() * 0.3), top = h * (0.05 + r() * 0.2);
    const gg = x.createLinearGradient(0, top, 0, top + bh); gg.addColorStop(0, hexA(k.glow, 0)); gg.addColorStop(0.35, hexA(k.glow, k.glowA * 0.2)); gg.addColorStop(1, hexA(k.glow, 0));
    x.fillStyle = gg; x.fillRect(px - bw / 2, top, bw, bh);
  }
}

// Soft contact shadow of the base on the tabletop: nested rounded rectangles with growing alpha (a box shadow).
function contactTexture(wm, dm, penM) {
  const ppm = 48 / Math.max(0.5, penM); // pixels per metre so that the penumbra is about 48 px
  const cw = Math.min(1024, Math.round((wm + 2 * penM) * ppm)), ch = Math.min(1024, Math.round((dm + 2 * penM) * ppm));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d'); x.clearRect(0, 0, cw, ch);
  const steps = 26, pen = penM * (cw / (wm + 2 * penM));
  for (let i = 0; i < steps; i++) {
    const inset = (i / steps) * pen, rr = Math.max(2, pen * 0.7 - inset * 0.5);
    x.fillStyle = 'rgba(70,48,28,0.032)'; x.beginPath();
    x.roundRect ? x.roundRect(inset, inset, cw - 2 * inset, ch - 2 * inset, rr) : x.rect(inset, inset, cw - 2 * inset, ch - 2 * inset);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function poolAlphaTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fff'); g.addColorStop(0.45, '#fff'); g.addColorStop(0.95, '#000'); g.addColorStop(1, '#000'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}

// options: { renderer, scene, bounds: { minX, maxX, minZ, maxZ, minY, maxY }, quality, preset, t }
// Returns { group, applyTime(t), setPreset(name), setQuality(level), setEmitters(list), dispose(), ... }.
// What the window panes show: a pale sky that deepens towards the top and two rows of far towers. Grey values only, because the
// pane multiplies it by the glow colour of the hour (day, dusk, night). Small and drawn once; the filtering blurs it into a view.
function windowViewTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d'), r = lcg(77);
  const sky = x.createLinearGradient(0, 0, 0, 64);
  sky.addColorStop(0, '#9db9f0'); sky.addColorStop(0.55, '#e4eeff'); sky.addColorStop(1, '#ffffff');
  x.fillStyle = sky; x.fillRect(0, 0, 128, 64);
  for (const [shade, lo, hi] of [['#c3cde0', 12, 24], ['#7d889f', 6, 18]]) {
    x.fillStyle = shade;
    for (let px = 0, n = 0; px < 128 && n < 40; n++) { const w = 6 + Math.floor(r() * 10), h = lo + Math.floor(r() * (hi - lo)); x.fillRect(px, 64 - h, w, h); px += w + Math.floor(r() * 3); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.name = 'window-view';
  return tex;
}

export function createStage(options = {}) {
  const { renderer = null, scene = null, quality = 'medium' } = options;
  const b = { minX: 0, maxX: 8, minZ: 0, maxZ: 6, minY: -0.15, maxY: 2.6, ...(options.bounds || {}) };
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const R = Math.max(2, 0.5 * Math.hypot(w, d));
  const group = new THREE.Group(); group.name = 'stage';
  const rig = createRig({ group, renderer, quality, target: [cx, 0.8, cz], radius: R * 1.45 });

  // layered card base: a paper-coloured top board and a narrower darker board under it. By default the board is the bounds plus a margin of 9 percent; with
  // options.board ({ minX, maxX, minZ, maxZ, rim }, the outer rectangle) it is that rectangle, and setBoard moves and scales all of it (board, board under it
  // and contact shadow) to another one later: the board grows with the open shell and shrinks back (look/board.js).
  const B = options.board && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(options.board[k])) && options.board.maxX > options.board.minX && options.board.maxZ > options.board.minZ ? options.board : null;
  const margin = B ? Math.max(0.1, Number(B.rim) || 0.35) : Math.max(0.5, 0.09 * Math.max(w, d)), top = b.minY - 0.004, h1 = 0.07, h2 = 0.05;
  const bw = B ? B.maxX - B.minX : w + 2 * margin, bd = B ? B.maxZ - B.minZ : d + 2 * margin, bx = B ? (B.minX + B.maxX) / 2 : cx, bz = B ? (B.minZ + B.maxZ) / 2 : cz;
  const paper = new THREE.MeshStandardMaterial({ color: '#efe6d4', roughness: 0.92 });
  const card = new THREE.MeshStandardMaterial({ color: '#cdbfa6', roughness: 0.95 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, h1, bd), paper);
  board.position.set(bx, top - h1 / 2, bz); board.receiveShadow = true; board.castShadow = true; board.name = 'board';
  const under = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, bw - 0.28), h2, Math.max(0.1, bd - 0.28)), card);
  under.position.set(bx, top - h1 - h2 / 2, bz); under.receiveShadow = true; under.name = 'board-under';
  const tableY = top - h1 - h2 - 0.002;
  const tableMat = new THREE.MeshStandardMaterial({ color: '#d9cdb8', roughness: 0.95, transparent: true, alphaMap: poolAlphaTexture(), depthWrite: false });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(R * 4.8, R * 4.8), tableMat);
  table.rotation.x = -Math.PI / 2; table.position.set(cx, tableY - 0.004, cz); table.receiveShadow = true; table.name = 'tabletop'; table.renderOrder = -2;
  const pen = Math.max(0.5, 0.35 * margin + 0.3);
  const contactMat = new THREE.MeshBasicMaterial({ map: contactTexture(bw, bd, pen), transparent: true, depthWrite: false });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(bw + 2 * pen, bd + 2 * pen), contactMat);
  contact.rotation.x = -Math.PI / 2; contact.position.set(bx, tableY, bz); contact.name = 'contact-shadow'; contact.renderOrder = -1;
  group.add(board, under, table, contact);
  let boardNow = { minX: bx - bw / 2, maxX: bx + bw / 2, minZ: bz - bd / 2, maxZ: bz + bd / 2 };
  // Moves and scales the board to the outer rectangle r = { minX, maxX, minZ, maxZ } (false for anything else). The contact shadow stretches with it.
  function setBoard(r) {
    if (!r || !['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(r[k])) || !(r.maxX - r.minX > 0.3) || !(r.maxZ - r.minZ > 0.3)) return false;
    const rw = r.maxX - r.minX, rd = r.maxZ - r.minZ, x = (r.minX + r.maxX) / 2, z = (r.minZ + r.maxZ) / 2, sx = rw / bw, sz = rd / bd;
    board.scale.set(sx, 1, sz); board.position.x = x; board.position.z = z;
    under.scale.set(Math.max(0.1, rw - 0.28) / Math.max(0.1, bw - 0.28), 1, Math.max(0.1, rd - 0.28) / Math.max(0.1, bd - 0.28)); under.position.x = x; under.position.z = z;
    contact.scale.set(sx, sz, 1); contact.position.x = x; contact.position.z = z; // the plane lies flat: its own y axis runs along z
    boardNow = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
    return true;
  }
  // The outer rectangle of the board now, in metres: { minX, maxX, minZ, maxZ, width, depth }.
  const boardInfo = () => ({ ...boardNow, width: +(boardNow.maxX - boardNow.minX).toFixed(3), depth: +(boardNow.maxZ - boardNow.minZ).toFixed(3) });

  // backdrop: one canvas texture that is the scene background
  const bg = document.createElement('canvas'); bg.width = 768; bg.height = 432;
  const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace;
  if (scene) { scene.add(group); scene.background = bgTex; if (rig.environment) scene.environment = rig.environment; }

  const glass = mat('glass'); glass.transparent = true; glass.opacity = 0.9; glass.color.set('#ffffff'); glass.roughness = 0.1;
  const view = windowViewTexture(); glass.map = view; glass.emissiveMap = view; glass.envMapIntensity = 1.6; glass.needsUpdate = true;
  washWalls();
  setTextureAnisotropy(getLevel(quality).anisotropy);

  function fitBackdrop(aspect) { const c = backdropCrop(aspect, bg.width / bg.height); bgTex.repeat.set(...c.repeat); bgTex.offset.set(...c.offset); }

  const state = { preset: null, t: 0, quality: getLevel(quality).id, look: null, clockText: '', lampK: 0 };
  let lastBg = '';
  function applyTime(t) {
    const k = sample(t); state.t = k.t; state.look = k; state.clockText = clock(k.t).text;
    const res = rig.applyTime(k, k.t); state.lampK = res.lampK; state.sun = res.sun;
    if (scene && rig.environment) scene.environmentIntensity = k.envI;
    setContactLook(k); setSunPatchLook(k, res.sun.dir);
    glass.emissive.set(k.winC); glass.emissiveIntensity = k.winI; glass.color.set(k.winC).multiplyScalar(0.25);
    const sig = k.bgTop + k.bgBot + k.glow + k.glowA.toFixed(2);
    if (sig !== lastBg) { lastBg = sig; paintBackdrop(bg, k); bgTex.needsUpdate = true; }
    // At night the base turns dark too (a pale slab under a night scene reads as unlit paper).
    const night = Math.min(1, Math.max(0, (k.lampK - 0.55) / 0.35)), dark = night * night * (3 - 2 * night);
    tableMat.color.set(k.bgBot).lerp(new THREE.Color('#d9cdb8'), 0.55 - 0.42 * dark);
    paper.color.set('#efe6d4').lerp(new THREE.Color(k.sky), 0.06).lerp(new THREE.Color('#161c2e'), 0.6 * dark);
    return k;
  }
  // The level's shadow budget: meshes smaller than shadowCutoff (bounding radius in metres) stay out of the shadow pass, and of
  // the rest only the shadowMax largest cast (ties keep scene order). Fewer shadow draw calls on weak machines, deterministic.
  const _v = new THREE.Vector3();
  function refreshShadowCasters(root) {
    root.updateMatrixWorld(true);
    const lv = getLevel(state.quality), cands = [];
    (function walk(o) { // hidden objects (and what hangs under them) do not take part
      if (!o.visible) return;
      if (o.isMesh && o.parent !== group) {
        if (o.userData.psCast === undefined) o.userData.psCast = o.castShadow;
        o.castShadow = false;
        if (o.userData.psCast) {
          const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); o.getWorldScale(_v);
          const r = g.boundingSphere.radius * Math.max(_v.x, _v.y, _v.z);
          if (r >= lv.shadowCutoff) cands.push({ o, r, i: cands.length });
        }
      }
      for (const c of o.children) walk(c);
    })(root);
    cands.sort((a, b) => b.r - a.r || a.i - b.i);
    cands.slice(0, lv.shadowMax).forEach((c) => { c.o.castShadow = true; });
    state.casters = Math.min(cands.length, lv.shadowMax); return state.casters;
  }
  function setPreset(name) { const p = getPreset(name ?? DEFAULT_PRESET); state.preset = p.id; applyPalette(p.palette); return p; }
  function setQuality(name) { const l = getLevel(name); state.quality = l.id; rig.setQuality(l.id); setTextureAnisotropy(l.anisotropy); return l; }
  // The base of the house rises by `dy` metres when only an upper floor is on show (the board, the table, the light rig and the lamps move together, so the floor
  // on show stands on the board and nothing hangs in the air); 0 puts everything back. The lamps are given in world coordinates and follow the base.
  let lift = 0, lamps = [];
  const lowered = (list) => (lift ? list.map((e) => (e && Array.isArray(e.pos) ? { ...e, pos: [e.pos[0], e.pos[1] - lift, e.pos[2]] } : e)) : list);
  function setEmitters(list) { lamps = Array.isArray(list) ? list : []; rig.setEmitters(lowered(lamps)); }
  function setLift(dy) {
    const next = Number.isFinite(dy) && dy > 0 ? dy : 0;
    if (next === lift) return lift;
    lift = next; group.position.y = lift; rig.setEmitters(lowered(lamps));
    return lift;
  }
  // The base of the house (the card board, the board under it, the tabletop and the contact shadow) can be taken away: Spacer stands inside the house, with no table under it.
  // The lights of the rig stay, they are not part of this list.
  function setBase(on) { for (const o of [board, under, table, contact]) o.visible = !!on; }
  function dispose() { rig.dispose(); bgTex.dispose(); glass.map = null; glass.emissiveMap = null; view.dispose(); tableMat.alphaMap?.dispose(); contactMat.map?.dispose(); for (const o of [board, under, table, contact]) o.geometry.dispose(); [paper, card, tableMat, contactMat].forEach((m) => m.dispose()); scene?.remove(group); }

  setPreset(options.preset);
  applyTime(options.t ?? getPreset(options.preset).t);
  return { group, rig, state, background: bgTex, applyTime, fitBackdrop, setPreset, setQuality, setEmitters, setLift, lift: () => lift, refreshShadowCasters, setBoard, board: boardInfo, setBase, dispose };
}
