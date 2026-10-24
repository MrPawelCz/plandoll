// Page shell: reads the address parameters, builds the plan scene, the stage (light, base, backdrop) and the post chain, draws.
// Parameters: #preset&t=&q=&cam=&plan=&frames=&lang=&ui=&live= (see params.js). No network, no storage, no external files.
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../core/validate.js';
import { buildModel, modelExtent } from '../model/geometry.js';
import { PlanScene } from '../render/scene.js';
import { setBoxUV } from '../render/uv.js';
import { createStage } from '../look/stage.js';
import { createPost } from '../look/post.js';
import { resolveQuality } from '../look/quality.js';
import { parseParams } from './params.js';
import { createLoop } from './loop.js';
import { createUI, showErrorCard } from './ui.js';
import { autoFurnish } from '../layout/index.js';
import { piecesImplemented } from '../furniture/index.js';
import { composeLayout, cutawayPieces, emittersOf, focusRoom, mergeByMaterial, setLampGlow, disposeComposed, wallCutHeight, WALL_PART } from '../render/compose.js';
import flat from '../../examples/flat-1.plan.json';
import duplex from '../../examples/duplex-1.plan.json';

const fail = (e) => { window.__fail = String((e && e.stack) || e); console.error(window.__fail); try { showErrorCard(String((e && e.message) || e)); } catch {} };

// Camera for the whole model (three-quarter view from the south-east) or a close view into the north-west room.
function cameraFor(ext, aspect, mode, focus) {
  const w = ext.maxX - ext.minX, d = ext.maxZ - ext.minZ, cx = (ext.minX + ext.maxX) / 2, cz = (ext.minZ + ext.maxZ) / 2;
  if (mode === 'close' && focus) { // the best furnished room from the same side as the main view, but nearer and a little steeper
    const dist = Math.max(3.4, focus.r * 2.7) * Math.max(1, Math.pow(1.78 / Math.max(0.4, aspect), 0.6)), dir = new THREE.Vector3(0.5, 0.75, 0.7).normalize();
    const t = [focus.cx, focus.y + 0.45, focus.cz];
    return { fov: 34, pos: [t[0] + dir.x * dist, t[1] + dir.y * dist, t[2] + dir.z * dist], target: t };
  }
  if (mode === 'close') return { fov: 50, pos: [ext.minX + 0.38 * w, 1.55, ext.minZ + 0.14 * d], target: [ext.minX + 0.5 * w, 0.42, ext.minZ + 0.42 * d] };
  const hgt = ext.maxY - ext.minY, multi = hgt > 3.6; // a tall model (several storeys) is framed by its 3D diagonal and aimed higher
  const R = (multi ? Math.hypot(w, d, hgt) : Math.hypot(w, d)) / 2, dist = R * 3.2 * Math.max(1, Math.pow(1.78 / Math.max(0.4, aspect), 0.8));
  const ty = multi ? ext.minY + 0.3 * hgt : 0;
  const dir = new THREE.Vector3(0.5, 0.7, 0.7).normalize();
  return { fov: 27, pos: [cx + dir.x * dist, ty + dir.y * dist, cz + dir.z * dist], target: [cx, ty, cz] };
}

try {
  const params = parseParams(location.hash, { language: navigator.language });
  const canvasProbe = document.createElement('canvas');
  if (!canvasProbe.getContext('webgl2')) throw new Error('WebGL2 is not available');
  const dpr = window.devicePixelRatio || 1;
  const env = { cores: navigator.hardwareConcurrency, touch: navigator.maxTouchPoints > 0, width: window.innerWidth, height: window.innerHeight, memory: navigator.deviceMemory };
  const S = { preset: params.preset, t: params.t, q: params.q, lang: params.lang };
  let level = resolveQuality(S.q, env);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap; // the soft shadow type of this three.js version
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  let renderCalls = 0; const _render = renderer.render.bind(renderer); renderer.render = (...a) => { renderCalls++; return _render(...a); };
  const scene = new THREE.Scene();

  // ---------- the plan ----------
  const plan = params.plan.kind === 'ext' && window.__plan ? JSON.parse(JSON.stringify(window.__plan)) : JSON.parse(JSON.stringify(params.plan.name === 'duplex-1' ? duplex : flat));
  for (const lv of plan.levels) lv.furniture = []; // the plan brings no furniture: the layout engine furnishes it
  const res = analyzePlan(plan); const model = buildModel(modelOf(res));
  const ext = modelExtent(model);
  const ps = new PlanScene(model, 'textured');
  ps.setLabels(false); ps.setArcs(false); ps.setCeilings(false);
  scene.add(ps.group);

  // cutaway: the walls on the north and west edges stay tall, those on the south and east edges are low, partitions in between
  const place = (m, y0, y1) => { m.position.y = (y0 + y1) / 2; m.scale.y = Math.max(1e-4, y1 - y0); const f = m.pw?.uv; if (f) setBoxUV(m.geometry, f.u, (y0 + y1) / 2, f.w, f.sx, y1 - y0, f.sz, f.k, f.swap); };
  ps.cutH = 1.1;
  for (const c of ps.cuttables) {
    const m = c.mesh, x = m.position.x, z = m.position.z, e = 0.3;
    const h = wallCutHeight(x, z, ext, e);
    if (c.y0 >= h - 1e-4) m.visible = false; else { place(m, c.y0, Math.min(c.y1, h)); m.visible = true; }
    if (h === WALL_PART && Math.max(c.mesh.scale.x, c.mesh.scale.z) > 3.5) m.castShadow = false; // a long low partition facing the sun would drown the rooms behind it
    ps._placeCap(c);
  }

  // ---------- stage ----------
  const stage = createStage({ renderer, scene, bounds: ext, quality: level, preset: S.preset, t: S.t });
  // ---------- furniture: the engine lays the rooms out, compose builds the pieces (rebuilt when the quality changes) ----------
  const layout = autoFurnish(model, { seed: params.seed, allowedTypes: piecesImplemented() });
  const focus = focusRoom(model, layout);
  let furn = null;
  function furnish() {
    if (furn) disposeComposed(furn.group, furn.merged?.group);
    furn = composeLayout({ model, layout, quality: level, look: 'textured', seed: params.seed });
    furn.hidden = cutawayPieces(furn.pieces, ext); // hung pieces behind the low walls would float
    furn.emitters = emittersOf(furn.pieces);
    if (params.merge) { furn.merged = mergeByMaterial(furn); furn.group.visible = false; scene.add(furn.merged.group); } // one mesh per material: far fewer draw calls
    scene.add(furn.group);
    stage.setEmitters(furn.emitters);
    stage.refreshShadowCasters(scene);
  }
  furnish();

  // ---------- camera and post ----------
  let W = window.innerWidth, H = window.innerHeight;
  const camera = new THREE.PerspectiveCamera(27, W / H, 0.5, 160);
  function frameCamera() { const c = cameraFor(ext, W / H, params.cam, focus); camera.fov = c.fov; camera.aspect = W / H; camera.position.set(...c.pos); camera.lookAt(...c.target); camera.updateProjectionMatrix(); stage.fitBackdrop(W / H); }
  frameCamera();
  const post = createPost({ renderer, scene, camera, width: W, height: H, quality: level, devicePixelRatio: dpr });

  // ---------- state changes ----------
  let loop = null; const times = [];
  const redraw = () => loop?.invalidate(); // every change of the picture asks for one more frame
  function applyAll() {
    const k = stage.applyTime(S.t); post.setLook(k); setLampGlow(furn.group, stage.state.lampK);
  }
  function setPreset(name, keepT) { const p = stage.setPreset(name); S.preset = p.id; if (!keepT) S.t = p.t; applyAll(); ui?.update(S); redraw(); }
  function setTime(t) { S.t = Math.min(1, Math.max(0, t)); applyAll(); ui?.update(S); redraw(); }
  function setQ(q) { S.q = q; level = resolveQuality(q, env); stage.setQuality(level); furnish(); post.setQuality(level); applyAll(); ui?.update(S); redraw(); }
  function setLang(l) { S.lang = l; ui?.update(S); }
  const ui = params.ui ? createUI({ onPreset: (n) => setPreset(n), onTime: setTime, onQuality: setQ, onLang: setLang }, S) : null;
  applyAll();
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') setTime(S.t + 0.02); else if (e.key === 'ArrowLeft') setTime(S.t - 0.02);
    else if (['1', '2', '3'].includes(e.key)) setPreset(['amber', 'clear', 'lamplit'][Number(e.key) - 1]);
  });
  addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; frameCamera(); post.resize(W, H); redraw(); });
  window.__setT = setTime; window.__setPreset = setPreset; window.__setQuality = setQ;

  // ---------- loop: the first N frames (frames=N, 4 by default) are drawn at once and measured, then a frame is drawn whenever the picture changes ----------
  function frame(n) {
    renderer.info.reset(); renderCalls = 0; const t0 = performance.now();
    post.render();
    if (n <= params.frames) { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); times.push(performance.now() - t0); } // waits for the GPU: only for the measured frames
    window.__frames = n; // frames drawn so far (tools wait on it after a click)
    if (n === params.frames) done();
  }
  function luminance() {
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, dark = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) { const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; sum += l; if (l < 0.03) dark++; n++; }
    return { mean: +(sum / n).toFixed(4), nearBlackPct: +((100 * dark) / n).toFixed(2) };
  }
  function done() {
    const rest = times.slice(1), avg = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : times[0];
    let meshes = 0, lights = 0; (function walk(o) { if (!o.visible) return; if (o.isMesh) meshes++; if (o.isLight) lights++; o.children.forEach(walk); })(scene);
    window.__stats = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, frameMs: Math.round(avg), quality: level, preset: S.preset, t: +S.t.toFixed(3),
      luminance: luminance(), msFirst: Math.round(times[0]), frames: params.frames, geometries: renderer.info.memory.geometries, visibleMeshes: meshes, lights, rendererRenderCalls: renderCalls, shadowCasters: stage.state.casters, pieces: furn.pieces.size, hiddenPieces: furn.hidden, mergedMeshes: furn.merged?.meshes ?? 0, emitters: furn.emitters.length, size: post.size, pixelRatio: post.pixelRatio, plan: params.plan.name };
    window.__done = true;
  }
  loop = createLoop({ draw: frame, frames: params.frames, live: params.live });
  loop.start();
} catch (e) { fail(e); }
