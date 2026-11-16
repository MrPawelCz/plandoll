// The world outside the doors of Spacer: a lawn to the horizon, a stone step and path in front of every outer door of the ground floor, and a sky that follows the mood.
// It exists only while the walk lasts (show() puts it in the scene and keeps the fog and the background it found; hide() gives both back). Nothing here is a collider.
import * as THREE from 'three';
import { mat, texScale } from './materials.js';

export const LAWN_DROP = 0.03; // the lawn lies this far under the floor of the ground level, the step and the path flush with it
export const PATH = { width: 1.2, length: 12, step: 0.6, margin: 0.15, thick: 0.1 };
export const FOG = { near: 20, far: 100 }; // seen from 1.6 m the last 100 m of lawn are a few rows of pixels, so the fog has to start early for the edge to melt
const GLOW_AT_HORIZON = 0.6; // the share of the glow colour that the horizon takes (the fog takes the same, so that the ground melts into it)
const DOOR_FREE_SILL = 0.35; // the same height the walker steps over (src/model/physics.js)

// Where the steps and paths go: one per outer door or passage of the ground floor that has no sill to climb. Pure data (plan metres).
// out is the unit vector that leads away from the house (the wall normal points into the flat); x, y is the middle of the opening on the outer face of the wall.
export function pathsFor(model) {
  const lv = model?.levels?.[0];
  if (!lv) return [];
  const list = [];
  for (const o of lv.openings ?? []) {
    if (o.type !== 'door' && o.type !== 'passage') continue;
    if ((o.sill ?? 0) > DOOR_FREE_SILL) continue;
    const w = lv.walls.find((x) => x.id === o.wallId);
    if (!w || w.kind !== 'exterior') continue;
    const um = (o.u0 + o.u1) / 2, out = [-w.normal[0], -w.normal[1]];
    list.push({ id: o.id, x: w.from[0] + w.dir[0] * um + out[0] * w.thickness / 2, y: w.from[1] + w.dir[1] * um + out[1] * w.thickness / 2, out, width: o.width });
  }
  return list;
}

// The colours of the sky for a sample k of the time of day: the horizon (also the fog), the zenith and the glow of the low sun or of the lights of the town.
export function skyOf(k) {
  const top = new THREE.Color(k.bgTop), bot = new THREE.Color(k.bgBot), glow = new THREE.Color(k.glow), ga = (k.glowA ?? 0) * (1 - 0.6 * Math.min(1, Math.max(0, ((k.lampK ?? 0) - 0.5) * 2))); // the glow of the lights of the town is weaker than the sun was
  const horizon = bot.clone().lerp(glow, Math.min(1, ga * GLOW_AT_HORIZON));
  return { top, bot, glow, ga, horizon };
}

const NIGHT = new THREE.Color().setRGB(0.14, 0.18, 0.3); // what the lawn and the path are multiplied by when the lamps are on
const SKY_VERT = 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = 'uniform vec3 top; uniform vec3 bot; uniform vec3 glow; uniform float ga; varying vec3 vD; void main() { float h = clamp(normalize(vD).y, 0.0, 1.0); vec3 c = mix(bot, top, pow(h, 0.5)); c = mix(c, glow, clamp(ga * ' + GLOW_AT_HORIZON.toFixed(1) + ' * exp(-h * 9.0), 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }';

// One tile of grass: strokes of a few greens on a mid green, drawn again across the edges so that it repeats without a seam.
function grassTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#8da56b'; g.fillRect(0, 0, N, N);
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const tones = ['#7c965c', '#9bb377', '#86a064', '#a8bd80', '#728d55'];
  g.globalAlpha = 0.55;
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * N, y = rnd() * N, l = 3 + rnd() * 6, a = (rnd() - 0.5) * 0.7;
    g.strokeStyle = tones[(rnd() * tones.length) | 0]; g.lineWidth = 1 + rnd();
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.sin(a) * l, y + dy - Math.cos(a) * l); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// A flat slab (`across` wide, `along` long from `from` metres out of the wall) with its top at y = top; the stone texture keeps its scale on every face.
function slab(group, material, p, across, along, from, top, thick) {
  const geo = new THREE.BoxGeometry(across, thick, along);
  const uv = geo.attributes.uv, k = texScale('floor:stone');
  for (let i = 0; i < uv.count; i++) { // faces in order +x -x +y -y +z -z, four vertices each
    const [a, b] = i < 8 ? [along, thick] : i < 16 ? [across, along] : [across, thick];
    uv.setXY(i, uv.getX(i) * a * k, uv.getY(i) * b * k);
  }
  const m = new THREE.Mesh(geo, material);
  const mid = from + along / 2;
  m.position.set(p.x + p.out[0] * mid, top - thick / 2, p.y + p.out[1] * mid);
  m.rotation.y = Math.atan2(p.out[0], p.out[1]);
  m.receiveShadow = true; m.name = `outside:${p.id}`;
  group.add(m);
}

// scene, camera and the model of the walk: the shadow of the sun falls on the lawn, the dome of the sky moves with the camera.
export function createOutside({ scene, camera, model }) {
  const top = model.levels[0].elevation ?? 0, group = new THREE.Group();
  group.name = 'outside';
  const tex = grassTexture(), RADIUS = 300;
  tex.repeat.set(RADIUS * 2 / 2.5, RADIUS * 2 / 2.5);
  const lawnMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  // The big patches of the lawn: a slow change of tone with the place, so that the tile does not show at five to eight metres.
  lawnMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.9 + 0.2 * (0.5 + 0.25 * sin(vW.x * 0.21 + sin(vW.y * 0.13) * 2.0) + 0.25 * sin(vW.y * 0.17 + sin(vW.x * 0.11) * 2.0));');
  };
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 40), lawnMat);
  lawn.rotation.x = -Math.PI / 2; lawn.position.y = top - LAWN_DROP; lawn.receiveShadow = true; lawn.name = 'outside:lawn';
  group.add(lawn);
  const stoneBase = mat('floor:stone', 'textured'), stone = stoneBase.clone(); // a copy of its own: the colour of the library's one is not ours to dim
  for (const p of pathsFor(model)) {
    slab(group, stone, p, p.width + 2 * PATH.margin, PATH.step, 0, top, PATH.thick);
    slab(group, stone, p, Math.max(PATH.width, p.width), PATH.length, PATH.step, top, PATH.thick);
  }
  const skyMat = new THREE.ShaderMaterial({ uniforms: { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, ga: { value: 0 } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat);
  dome.renderOrder = -1000; dome.frustumCulled = false; dome.name = 'outside:sky';
  dome.onBeforeRender = () => dome.position.copy(camera.position);
  group.add(dome);

  const fog = new THREE.Fog(0xffffff, FOG.near, FOG.far);
  let kept = null, look = null;
  function setLook(k) {
    look = k; const s = skyOf(k);
    skyMat.uniforms.top.value.copy(s.top); skyMat.uniforms.bot.value.copy(s.bot); skyMat.uniforms.glow.value.copy(s.glow); skyMat.uniforms.ga.value = s.ga;
    fog.color.copy(s.horizon);
    const tint = new THREE.Color(1, 1, 1).lerp(NIGHT, Math.min(1, Math.max(0, k.lampK ?? 0)));
    lawnMat.color.copy(tint); stone.color.copy(stoneBase.color).multiply(tint);
    if (kept) scene.background = s.horizon.clone();
  }
  function show() {
    if (kept) return;
    kept = { fog: scene.fog, background: scene.background };
    scene.fog = fog; scene.add(group);
    if (look) setLook(look);
  }
  function hide() {
    if (!kept) return;
    scene.remove(group); scene.fog = kept.fog; scene.background = kept.background; kept = null;
  }
  function dispose() {
    hide();
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    lawnMat.dispose(); stone.dispose(); tex.dispose(); skyMat.dispose();
  }
  return { group, show, hide, setLook, dispose, fog, get shown() { return !!kept; } };
}
