// Page shell: reads the address parameters, builds the plan scene, the stage (light, base, backdrop) and the post chain, draws.
// Parameters: #preset&t=&q=&cam=&plan=&frames=&lang=&ui=&live= (see params.js). No network, no storage, no external files.
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../core/validate.js';
import { buildModel, modelExtent } from '../model/geometry.js';
import { PlanScene } from '../render/scene.js';
import { setBoxUV } from '../render/uv.js';
import { createStage } from '../look/stage.js';
import { createPost } from '../look/post.js';
import { getPreset } from '../look/presets.js';
import { resolveQuality } from '../look/quality.js';
import { parseParams } from './params.js';
import { createUI, showErrorCard } from './ui.js';
import { addDemoProps, FLAT1_EXTRAS } from './demo-props.js';
import flat from '../../examples/flat-1.plan.json';
import duplex from '../../examples/duplex-1.plan.json';

const fail = (e) => { window.__fail = String((e && e.stack) || e); console.error(window.__fail); try { showErrorCard(String((e && e.message) || e)); } catch {} };

// Camera for the whole model (three-quarter view from the south-east) or a close view into the north-west room.
function cameraFor(ext, aspect, mode) {
  const w = ext.maxX - ext.minX, d = ext.maxZ - ext.minZ, cx = (ext.minX + ext.maxX) / 2, cz = (ext.minZ + ext.maxZ) / 2;
  if (mode === 'close') return { fov: 50, pos: [ext.minX + 0.38 * w, 1.55, ext.minZ + 0.14 * d], target: [ext.minX + 0.5 * w, 0.42, ext.minZ + 0.42 * d] };
  const hgt = ext.maxY - ext.minY, multi = hgt > 3.6; // a tall model (several storeys) is framed by its 3D diagonal and aimed higher
  const R = (multi ? Math.hypot(w, d, hgt) : Math.hypot(w, d)) / 2, dist = R * 3.2 * Math.max(1, Math.pow(1.78 / Math.max(0.4, aspect), 0.8));
  const ty = multi ? ext.minY + 0.3 * hgt : 0;
  const dir = new THREE.Vector3(0.5, 0.7, 0.7).normalize();
  return { fov: 27, pos: [cx + dir.x * dist, ty + dir.y * dist, cz + dir.z * dist], target: [cx, ty, cz] };
}

// One warm light at the label point of each of the six largest rooms (a stand-in for lamp emitters).
function roomEmitters(model) {
  const out = [];
  for (const lv of model.levels) for (const r of lv.rooms) {
    const p = r.polygon; if (!p || p.length < 3) continue;
    let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
    out.push({ area: Math.abs(a) / 2, pos: [r.label[0], lv.elevation + 1.7, r.label[1]], color: '#ffb064', power: 1.5 });
  }
  return out.sort((x, y) => y.area - x.area).slice(0, 6).map(({ area, ...e }) => e);
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
  const isFlat1 = params.plan.name === 'flat-1';
  if (isFlat1) plan.levels[0].furniture.push(...FLAT1_EXTRAS);
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
    const back = z < ext.minZ + e || x < ext.minX + e, front = z > ext.maxZ - e || x > ext.maxX - e;
    const h = back ? 99 : front ? 0.62 : 1.0;
    if (c.y0 >= h - 1e-4) m.visible = false; else { place(m, c.y0, Math.min(c.y1, h)); m.visible = true; }
    if (!back && !front && Math.max(c.mesh.scale.x, c.mesh.scale.z) > 3.5) m.castShadow = false; // a long low partition facing the sun would drown the rooms behind it
    ps._placeCap(c);
  }

  // ---------- stage ----------
  const stage = createStage({ renderer, scene, bounds: ext, quality: level, preset: S.preset, t: S.t });
  const palette = getPreset(S.preset).palette;
  const props = isFlat1 ? addDemoProps({ group: scene, level: model.levels[0], palette }) : null;
  stage.setEmitters(props ? props.emitters : roomEmitters(model)); // until the layout engine supplies real lamps, plans other than flat-1 get one warm light per large room
  stage.refreshShadowCasters(scene);

  // ---------- camera and post ----------
  let W = window.innerWidth, H = window.innerHeight;
  const camera = new THREE.PerspectiveCamera(27, W / H, 0.5, 160);
  function frameCamera() { const c = cameraFor(ext, W / H, params.cam); camera.fov = c.fov; camera.aspect = W / H; camera.position.set(...c.pos); camera.lookAt(...c.target); camera.updateProjectionMatrix(); }
  frameCamera();
  const post = createPost({ renderer, scene, camera, width: W, height: H, quality: level, devicePixelRatio: dpr });

  // ---------- state changes ----------
  let dirty = true; const times = [];
  function applyAll() {
    const k = stage.applyTime(S.t); post.setLook(k); props?.setLampGlow(stage.state.lampK);
  }
  function setPreset(name, keepT) { const p = stage.setPreset(name); S.preset = p.id; if (!keepT) S.t = p.t; props?.setPalette(p.palette); applyAll(); ui?.update(S); dirty = true; }
  function setTime(t) { S.t = Math.min(1, Math.max(0, t)); applyAll(); ui?.update(S); dirty = true; }
  function setQ(q) { S.q = q; level = resolveQuality(q, env); stage.setQuality(level); stage.refreshShadowCasters(scene); post.setQuality(level); applyAll(); ui?.update(S); dirty = true; }
  function setLang(l) { S.lang = l; ui?.update(S); }
  const ui = params.ui ? createUI({ onPreset: (n) => setPreset(n), onTime: setTime, onQuality: setQ, onLang: setLang }, S) : null;
  props?.setPalette(palette); applyAll();
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') setTime(S.t + 0.02); else if (e.key === 'ArrowLeft') setTime(S.t - 0.02);
    else if (['1', '2', '3'].includes(e.key)) setPreset(['amber', 'clear', 'lamplit'][Number(e.key) - 1]);
  });
  addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; frameCamera(); post.resize(W, H); dirty = true; });
  window.__setT = setTime; window.__setPreset = setPreset; window.__setQuality = setQ;

  // ---------- loop: draws on demand; with frames=N (the default for tools) it draws N frames and reports ----------
  let frames = 0;
  function frame() {
    renderer.info.reset(); renderCalls = 0; const t0 = performance.now();
    post.render(); { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); } times.push(performance.now() - t0); frames++;
    dirty = false;
    if (frames === params.frames) done();
    if (!params.live && frames >= params.frames) return;
    requestAnimationFrame(tick);
  }
  function tick() { if (dirty || !params.live) frame(); else requestAnimationFrame(tick); }
  function luminance() {
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, dark = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) { const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; sum += l; if (l < 0.03) dark++; n++; }
    return { mean: +(sum / n).toFixed(4), nearBlackPct: +((100 * dark) / n).toFixed(2) };
  }
  function done() {
    const rest = times.slice(1), avg = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : times[0];
    let meshes = 0, lights = 0; scene.traverse((o) => { if (o.isMesh && o.visible) meshes++; if (o.isLight && o.visible) lights++; });
    window.__stats = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, frameMs: Math.round(avg), quality: level, preset: S.preset, t: +S.t.toFixed(3),
      luminance: luminance(), msFirst: Math.round(times[0]), frames, geometries: renderer.info.memory.geometries, visibleMeshes: meshes, lights, rendererRenderCalls: renderCalls, shadowCasters: stage.state.casters, size: post.size, pixelRatio: post.pixelRatio, plan: params.plan.name };
    window.__done = true;
  }
  requestAnimationFrame(tick);
} catch (e) { fail(e); }
