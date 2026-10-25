// Selection outline for the editor: a tinted rectangle on the floor under the piece plus the edges of its box, always visible
// (no depth test, drawn last). The colour says how the place is: light copper (accent of the page) when fine, yellow for warnings
// (door zone, stair, tall piece at a window), red for a hard problem (overlap, outside the room, prop without support).
import * as THREE from 'three';

export const OUTLINE_COLORS = Object.freeze({ ok: '#ffb27a', warn: '#ffdf2e', bad: '#ff3b30' });
export const HARD_KINDS = ['overlap', 'outside-room', 'floating-prop'];

// 'bad' when any hard problem is present, 'warn' for any other, 'ok' for none.
export function outlineKind(problems) {
  if (!Array.isArray(problems) || !problems.length) return 'ok';
  return problems.some((p) => HARD_KINDS.includes(p?.kind)) ? 'bad' : 'warn';
}

export function createOutline() {
  const group = new THREE.Group(); group.name = 'edit-outline'; group.visible = false; group.renderOrder = 1000;
  const basic = (opacity) => new THREE.MeshBasicMaterial({ color: OUTLINE_COLORS.ok, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const lineMat = new THREE.LineBasicMaterial({ color: OUTLINE_COLORS.ok, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false });
  const fillMat = basic(0.3), rimMat = basic(0.95);
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const fill = new THREE.Mesh(flat, fillMat);
  // a rim round the floor rectangle: four thin strips, so it stays visible at any pixel density
  const strip = (sx, sz, px, pz) => { const m = new THREE.Mesh(flat, rimMat); m.userData = { sx, sz, px, pz }; return m; };
  const rim = [strip(1, 0, 0, -0.5), strip(1, 0, 0, 0.5), strip(0, 1, -0.5, 0), strip(0, 1, 0.5, 0)];
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), lineMat);
  const parts = [fill, ...rim, box];
  for (const m of parts) { m.renderOrder = 1000; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }
  group.add(...parts);
  const WIDTH = 0.03; // metres: width of the rim strips

  return {
    group,
    // piece: { x, y, rot, elev, size: [w, d, h] } of the layout; base: height of the floor of its level; kind: 'ok' | 'warn' | 'bad'
    set(piece, base, kind = 'ok') {
      if (!piece || !Array.isArray(piece.size) || piece.size.length !== 3 || ![piece.x, piece.y, piece.rot, piece.elev, base, ...piece.size].every(Number.isFinite)) { group.visible = false; return; }
      const [w, d, h] = piece.size, color = OUTLINE_COLORS[kind] ?? OUTLINE_COLORS.ok;
      group.position.set(piece.x, base + piece.elev + 0.006, piece.y);
      group.rotation.y = (-piece.rot * Math.PI) / 180;
      fill.scale.set(w, 1, d);
      for (const s of rim) s.scale.set(s.userData.sx ? w + WIDTH : WIDTH, 1, s.userData.sz ? d + WIDTH : WIDTH), s.position.set(s.userData.px * w, 0.001, s.userData.pz * d);
      box.scale.set(w, h, d); box.position.set(0, h / 2, 0);
      fillMat.color.set(color); rimMat.color.set(color); lineMat.color.set(color);
      group.visible = true;
    },
    hide() { group.visible = false; },
    get visible() { return group.visible; },
    get kindColor() { return `#${lineMat.color.getHexString()}`; },
    dispose() { flat.dispose(); box.geometry.dispose(); fillMat.dispose(); rimMat.dispose(); lineMat.dispose(); group.removeFromParent(); },
  };
}
