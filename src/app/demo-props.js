// Temporary stand-ins for the furniture engine: for the bundled flat-1 example only, a few extra legacy pieces, curtains,
// pictures and lamps so that the look can be judged. The layout engine and the new furniture replace all of this.
import * as THREE from 'three';

export const FLAT1_EXTRAS = [
  { id: 'x-rug', type: 'rug', center: [3.6, 1.7], size: [2.8, 1.8] },
  { id: 'x-ch1', type: 'chair', center: [1.05, 0.58], rotation: 0 }, { id: 'x-ch2', type: 'chair', center: [1.95, 0.58], rotation: 0 },
  { id: 'x-ch3', type: 'chair', center: [1.05, 1.82], rotation: 180 }, { id: 'x-ch4', type: 'chair', center: [1.95, 1.82], rotation: 180 },
  { id: 'x-pl1', type: 'plant', center: [4.62, 0.42], size: [0.55, 0.55], height: 1.5 },
  { id: 'x-pl2', type: 'plant', center: [7.7, 2.7], size: [0.5, 0.5], height: 1.3 },
  { id: 'x-pl3', type: 'plant', center: [0.4, 2.6], size: [0.5, 0.5], height: 1.2 },
  { id: 'x-shelf', type: 'bookshelf', center: [4.24, 4.55], rotation: 270, size: [1.0, 0.3], height: 1.9 },
  { id: 'x-ns', type: 'table-coffee', center: [7.72, 0.62], size: [0.3, 0.34], height: 0.5 },
];

const LAMPS = [['floor', 4.8, 2.45, 0], ['table', 7.72, 0.62, 0.5], ['table', 7.05, 5.62, 0.75], ['table', 1.5, 1.2, 0.75]];

function drapeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d');
  for (let i = 0; i < 128; i++) { const g = Math.round(255 * (0.74 + 0.26 * Math.sin((i / 128) * Math.PI * 2 * 5 + 0.6))); x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(i, 0, 1, 128); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function paintArt(canvas, pal) {
  const x = canvas.getContext('2d');
  x.fillStyle = pal[0]; x.fillRect(0, 0, 256, 340); x.fillStyle = pal[1]; x.beginPath(); x.arc(128, 130, 70, 0, 7); x.fill();
  x.fillStyle = pal[2]; x.beginPath(); x.moveTo(36, 320); x.lineTo(36, 220); x.arc(100, 220, 64, Math.PI, 0); x.lineTo(164, 320); x.fill();
  x.fillStyle = pal[3]; x.beginPath(); x.arc(196, 262, 40, Math.PI, 0); x.lineTo(236, 320); x.lineTo(156, 320); x.fill();
}

// Builds the props for flat-1 into `group` and returns { emitters, setPalette(P), setLampGlow(k), dispose() }.
export function addDemoProps({ group, level, palette }) {
  const th = (id) => level.walls.find((w) => w.id === id)?.thickness ?? 0.2;
  const drapeMat = new THREE.MeshStandardMaterial({ color: palette.drape, map: drapeTexture(), roughness: 1 });
  for (const o of (level.openings || []).filter((q) => q.type === 'window' && (q.wall === 'w1' || q.wall === 'w4') && !q.sill)) {
    const a = o.offset, b = o.offset + o.width, pw = 0.3, d = 0.07;
    for (const [s0, s1] of [[a - pw - 0.03, a - 0.03], [b + 0.03, b + pw + 0.03]]) {
      const north = o.wall === 'w1', off = th(o.wall) / 2 + d / 2 + 0.005;
      const m = new THREE.Mesh(new THREE.BoxGeometry(north ? s1 - s0 : d, 2.45, north ? d : s1 - s0), drapeMat);
      m.position.set(north ? (s0 + s1) / 2 : off, 1.35, north ? off : (s0 + s1) / 2); m.castShadow = true; m.receiveShadow = true; group.add(m);
    }
  }
  const arts = [];
  const picture = (flip, w, h, x, y, z, rotY) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 340; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    arts.push({ c, tex, flip });
    const g = new THREE.Group();
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.035), new THREE.MeshStandardMaterial({ color: '#2b211a', roughness: 0.5 })); g.add(fr);
    const im = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); im.position.z = 0.019; g.add(im);
    g.position.set(x, y, z); g.rotation.y = rotY; fr.castShadow = true; fr.receiveShadow = true; group.add(g);
  };
  picture(false, 0.46, 0.62, 0.5, 1.55, th('w1') / 2 + 0.02, 0);
  picture(true, 0.42, 0.56, th('w4') / 2 + 0.02, 1.7, 0.62, Math.PI / 2);
  picture(false, 0.4, 0.54, 7.72, 1.75, th('w1') / 2 + 0.02, 0);

  const shades = []; const emitters = [];
  for (const [kind, x, z, y0] of LAMPS) {
    const g = new THREE.Group(); g.position.set(x, y0, z);
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2623', roughness: 0.45, metalness: 0.6 });
    const shadeMat = new THREE.MeshStandardMaterial({ color: '#e8c48c', emissive: '#ffa850', emissiveIntensity: 1, roughness: 0.9, side: THREE.DoubleSide });
    const fl = kind === 'floor';
    const base = new THREE.Mesh(new THREE.CylinderGeometry(fl ? 0.15 : 0.07, fl ? 0.17 : 0.08, 0.03, 24), dark); base.position.y = 0.015;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, fl ? 1.3 : 0.2, 10), dark); stem.position.y = fl ? 0.68 : 0.13;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(fl ? 0.15 : 0.1, fl ? 0.22 : 0.15, fl ? 0.3 : 0.2, 28, 1, true), shadeMat); shade.position.y = fl ? 1.44 : 0.33;
    g.add(base, stem, shade); base.castShadow = true; stem.castShadow = true; group.add(g); shades.push(shadeMat);
    emitters.push({ pos: [x, y0 + (fl ? 1.4 : 0.3), z], color: '#ffb064', power: fl ? 2.2 : 1 });
  }
  function setPalette(P) {
    drapeMat.color.set(P.drape);
    arts.forEach((a, i) => { paintArt(a.c, a.flip ? P.art.slice().reverse() : P.art); a.tex.needsUpdate = true; });
  }
  function setLampGlow(k) { for (const s of shades) s.emissiveIntensity = 0.1 + 1.1 * k; }
  setPalette(palette);
  return { emitters, setPalette, setLampGlow, dispose() { group.clear(); } };
}
