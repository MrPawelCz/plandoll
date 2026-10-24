// A neutral studio for contact sheets (furniture, materials): even light, a pale floor, labels, and the page contract of
// docs/ARCHITECTURE.md (hash options, window.__done, window.__stats, window.__fail). Sheets are built by tools/build-sheet.mjs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mat } from '../src/render/materials.js';

// Hash options: "#az=35&el=35&cols=6&frames=2" (a bare word is kept in .word).
export function hashOptions() {
  const o = { word: '' };
  for (const part of location.hash.replace(/^#/, '').split('&').filter(Boolean)) {
    const [k, v] = part.split('=');
    if (v === undefined) o.word = k; else o[k] = v;
  }
  return o;
}

// Swaps a built group to the textured look (the same rule as PlanScene.setMaterials).
export function texturize(root, look = 'textured') {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.pw?.mat) o.material = mat(o.pw.mat, look);
    if (o.pw?.look) o.visible = o.pw.look === look;
  });
}

export function labelSprite(text, height = 0.3) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.font = '600 44px ui-sans-serif, system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(40,36,32,0.92)';
  x.fillText(text, 256, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(height * (512 / 96), height, 1);
  s.renderOrder = 10;
  return s;
}

// Places { object, label, size: [w, d] } entries on a grid of cell x cell metres, centred on the origin; returns the grid extent.
export function layoutGrid(parent, items, { cols = 6, cell = 2.4 } = {}) {
  const rows = Math.ceil(items.length / cols);
  items.forEach((it, i) => {
    const cx = ((i % cols) - (cols - 1) / 2) * cell, cz = (Math.floor(i / cols) - (rows - 1) / 2) * cell;
    it.object.position.set(cx, it.object.position.y, cz);
    parent.add(it.object);
    if (it.label) { const s = labelSprite(it.label); s.position.set(cx, 0.02, cz + cell * 0.4); parent.add(s); }
  });
  return { width: cols * cell, depth: rows * cell };
}

// Runs a sheet: build(studio) fills studio.scene and returns { width, depth }; the page renders `frames` frames from azimuth/elevation.
export function runSheet(build) {
  try {
    const opt = hashOptions();
    const W = innerWidth, H = innerHeight, frames = Number(opt.frames ?? 2);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dedad3');
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9b3a8', 0.7));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 5; key.shadow.blurSamples = 16; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const extent = build({ scene, renderer, opt });
    const R = Math.max(extent.width, extent.depth) * 0.6;
    Object.assign(key.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 80 });
    key.shadow.camera.updateProjectionMatrix();
    const az = (Number(opt.az ?? 35) * Math.PI) / 180, el = (Number(opt.el ?? 35) * Math.PI) / 180;
    key.position.set(Math.sin(az + 0.8) * 20, 18, Math.cos(az + 0.8) * 20);
    const camera = new THREE.PerspectiveCamera(Number(opt.fov ?? 24), W / H, 0.5, 200);
    const dist = (Math.hypot(extent.width, extent.depth) * 0.5) / Math.tan((camera.fov * Math.PI) / 360) * 0.74;
    camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    camera.lookAt(0, 0.3, 0);
    const times = [];
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); renderer.render(scene, camera); const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); times.push(Math.round(performance.now() - t0)); }
    window.__stats = { size: [W, H], frames, msAll: times, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    window.__done = true;
  } catch (e) { window.__fail = String((e && e.stack) || e); console.error(window.__fail); }
}
