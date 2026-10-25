// Light rig: a sun with a soft (VSM) shadow, a hemisphere light, a warm bounce fill from below (a cheap stand-in for light
// reflected by floors and walls), image based light, and a pool of up to six point lights fed by lamp emitters.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { sunPosition } from './timeofday.js';
import { getLevel } from './quality.js';

export const MAX_POINT_LIGHTS = 6;
export const LAMP_RANGE = 5.5; // metres: a lamp lights a pool of this radius and no more (smooth cut-off, inverse square inside)
export const LAMP_BASE_INTENSITY = 4.6; // candela-ish for an emitter with power 1 (a table lamp); a floor lamp is about 2

const toVec = (p) => (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3(p.x, p.y, p.z));

// The n emitters that light the most of the home: the strongest first, then each next one is the emitter farthest from the ones
// already taken (distance weighted by the square root of its power), so that the few real lights spread over the rooms.
export function spreadPick(list, n) {
  const left = list.slice().sort((a, b) => (b.power ?? 1) - (a.power ?? 1)), out = [];
  if (!left.length || n <= 0) return out;
  out.push(left.shift());
  while (out.length < n && left.length) {
    let best = 0, bestScore = -1;
    left.forEach((e, i) => {
      const p = toVec(e.pos); let d = Infinity;
      for (const o of out) d = Math.min(d, p.distanceTo(toVec(o.pos)));
      const score = d * Math.sqrt(Math.max(0.05, e.power ?? 1));
      if (score > bestScore + 1e-9) { bestScore = score; best = i; }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

export function createRig({ group, renderer = null, quality = 'medium', target = [4, 0.8, 3], radius = 7 }) {
  const hemi = new THREE.HemisphereLight('#ffffff', '#222222', 0.5);
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.castShadow = true;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  const bounce = new THREE.DirectionalLight('#ffcba0', 0.3); // no shadow: it only lifts the sides that face away from the sun
  const tgt = new THREE.Vector3(...target);
  const dist = Math.max(30, radius * 3);
  const cam = sun.shadow.camera;
  Object.assign(cam, { left: -radius, right: radius, top: radius, bottom: -radius, near: Math.max(1, dist - radius * 2.2), far: dist + radius * 2.2 });
  cam.updateProjectionMatrix();
  sun.target.position.copy(tgt); bounce.target.position.copy(tgt);
  group.add(hemi, sun, sun.target, bounce, bounce.target);

  let envTexture = null, pmrem = null;
  if (renderer) {
    pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }

  const pool = [];
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) { const l = new THREE.PointLight('#ffb064', 0, LAMP_RANGE, 2); l.visible = false; group.add(l); pool.push({ light: l, power: 1 }); }
  let emitters = [];
  let level = getLevel(quality);
  let lampK = 0;

  function layoutEmitters() {
    const sorted = spreadPick(emitters, Math.min(MAX_POINT_LIGHTS, level.maxLights));
    pool.forEach((p, i) => {
      const e = sorted[i];
      p.light.visible = !!e;
      if (e) { p.light.position.copy(toVec(e.pos)); p.light.color.set(e.color ?? '#ffb064'); p.power = e.power ?? 1; }
    });
  }
  function applyLamps() { for (const p of pool) p.light.intensity = p.light.visible ? LAMP_BASE_INTENSITY * p.power * lampK : 0; }

  function setQuality(name) {
    level = getLevel(name);
    sun.shadow.mapSize.set(level.shadowMap, level.shadowMap);
    sun.shadow.map?.dispose(); sun.shadow.map = null; // the map is recreated at the new size on the next frame
    sun.shadow.radius = level.shadowRadius; sun.shadow.blurSamples = level.shadowBlur;
    layoutEmitters(); applyLamps();
  }

  // k: the interpolated look from timeofday.sample(t); t the raw time (for the sun path).
  // fillBoost: a multiplier for the hemisphere light that the page raises a little when the model is seen from the north, where the inside of the far wall is in shade
  let fillBoost = 1, lastK = null;
  function setFillBoost(b) { fillBoost = Number.isFinite(b) ? Math.min(1.6, Math.max(1, b)) : 1; if (lastK) hemi.intensity = lastK.hemiI * fillBoost; }
  function applyTime(k, t) {
    lastK = k;
    const sp = sunPosition(t);
    sun.position.copy(tgt).addScaledVector(new THREE.Vector3(...sp.dir), dist);
    sun.color.set(k.sunC); sun.intensity = k.sunI;
    hemi.color.set(k.sky); hemi.groundColor.set(k.gnd); hemi.intensity = k.hemiI * fillBoost;
    bounce.color.set(k.bncC); bounce.intensity = k.bnc;
    bounce.position.copy(tgt).add(new THREE.Vector3(-sp.dir[0], -0.55, -sp.dir[2]).normalize().multiplyScalar(dist));
    lampK = k.lampK; applyLamps();
    return { lampK, sun: sp };
  }

  function setEmitters(list) { emitters = Array.isArray(list) ? list.filter((e) => e && e.pos).slice(0, 64) : []; layoutEmitters(); applyLamps(); }

  setQuality(quality);
  return { hemi, sun, bounce, pool, environment: envTexture, applyTime, setFillBoost, setQuality, setEmitters, get lampK() { return lampK; }, activeLights: () => pool.filter((p) => p.light.visible).length,
    dispose() { for (const p of pool) p.light.dispose?.(); sun.shadow.map?.dispose(); envTexture?.dispose(); pmrem?.dispose(); } };
}
