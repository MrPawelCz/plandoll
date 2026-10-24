// Contact sheet of the material library: a slab and a sphere per material, under warm or cool light.
// Hash options: keys=a,b,c (default: all), cols, cell (m), look (textured or clay), light (warm or cool), az, el, fov, frames;
// see tools/sheet-studio.js for the page contract. Build with tools/materials-sheet.mjs.
import * as THREE from 'three';
import { runSheet, layoutGrid } from './sheet-studio.js';
import { MATERIAL_KEYS, getMaterial, libraryScale, materialInfo, textureBudget } from '../src/render/library.js';
import { boxGeometry, setBoxUV } from '../src/render/uv.js';

const LIGHTS = {
  warm: { key: '#ffd7a3', keyIntensity: 2.6, sky: '#fff1dd', ground: '#c9b79e' },
  cool: { key: '#cfe0ff', keyIntensity: 2.4, sky: '#e4edff', ground: '#a9b2bf' },
};

function cell(key, look) {
  const group = new THREE.Group();
  const k = libraryScale(key), slab = 1.15, radius = 0.42;
  const material = getMaterial(key, { look });
  const slabGeo = boxGeometry();
  setBoxUV(slabGeo, 0, 0, 0, slab, 0.1, slab, k);
  const plate = new THREE.Mesh(slabGeo, material);
  plate.scale.set(slab, 0.1, slab); plate.position.y = 0.05;
  plate.castShadow = plate.receiveShadow = true;
  const sphereGeo = new THREE.SphereGeometry(radius, 64, 40);
  const uv = sphereGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * radius * k, uv.getY(i) * Math.PI * radius * k);
  const ball = new THREE.Mesh(sphereGeo, material);
  ball.position.y = 0.1 + radius;
  ball.castShadow = ball.receiveShadow = true;
  group.add(plate, ball);
  return group;
}

runSheet(({ scene, opt }) => {
  const set = LIGHTS[opt.light] ?? LIGHTS.warm, look = opt.look ?? 'textured';
  scene.traverse((o) => {
    if (o.isDirectionalLight) { o.color.set(set.key); o.intensity = set.keyIntensity; }
    if (o.isHemisphereLight) { o.color.set(set.sky); o.groundColor.set(set.ground); }
  });
  const keys = (opt.keys ? opt.keys.split(',') : MATERIAL_KEYS).filter((k) => MATERIAL_KEYS.includes(k));
  const items = keys.map((key) => {
    const info = materialInfo(key);
    return { object: cell(key, look), label: `${key}  r${info.roughness.toFixed(2)}`, size: [1.15, 1.15] };
  });
  const extent = layoutGrid(scene, items, { cols: Number(opt.cols ?? 5), cell: Number(opt.cell ?? 1.5) });
  queueMicrotask(() => { if (window.__stats) window.__stats.textureBytes = textureBudget(); });
  return extent;
});
