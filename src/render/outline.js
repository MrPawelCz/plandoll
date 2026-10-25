// Selection outlines for the editor, always visible (no depth test, drawn last).
// createOutline(): a tinted rectangle on the floor under a piece, a rim round it and the twelve edges of its box as thin bars; every bar
// has a darker, wider bar under it, so the outline reads on light and on dark furniture. The colour says how the place is: light copper
// (accent of the page) when fine, yellow for warnings (door zone, stair, tall piece at a window, a blocked front), red for a hard problem
// (overlap, outside the room, prop without support).
// createRoomOutline(): the same kind of tinted fill and a thick light rim along the floor outline of one room.
import * as THREE from 'three';

export const OUTLINE_COLORS = Object.freeze({ ok: '#ffb27a', warn: '#ffdf2e', bad: '#ff3b30' });
export const ROOM_OUTLINE_COLOR = '#ffd9b3';
export const HARD_KINDS = ['overlap', 'outside-room', 'floating-prop'];
const HALO = '#3b2410';

// 'bad' when any hard problem is present, 'warn' for any other, 'ok' for none.
export function outlineKind(problems) {
  if (!Array.isArray(problems) || !problems.length) return 'ok';
  return problems.some((p) => HARD_KINDS.includes(p?.kind)) ? 'bad' : 'warn';
}

const basicMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const finite = (...v) => v.every(Number.isFinite);

export function createOutline() {
  const group = new THREE.Group(); group.name = 'edit-outline'; group.visible = false; group.renderOrder = 1000;
  const fillMat = basicMat(OUTLINE_COLORS.ok, 0.3), rimMat = basicMat(OUTLINE_COLORS.ok, 0.97), haloMat = basicMat(HALO, 0.55);
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), cube = new THREE.BoxGeometry(1, 1, 1);
  const fill = new THREE.Mesh(flat, fillMat);
  // floor rim: four strips (a light one over a wider dark one); the box edges: twelve bars with the same pairing
  const strip = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; return m; };
  const rim = [[1, 0, 0, -0.5], [1, 0, 0, 0.5], [0, 1, -0.5, 0], [0, 1, 0.5, 0]].map(([sx, sz, px, pz]) => ({ sx, sz, px, pz, light: strip(flat, rimMat, 1002), dark: strip(flat, haloMat, 1001) }));
  const edges = [];
  for (let axis = 0; axis < 3; axis++) for (const a of [-1, 1]) for (const b of [-1, 1]) edges.push({ axis, a, b, light: strip(cube, rimMat, 1004), dark: strip(cube, haloMat, 1003) });
  const parts = [fill, ...rim.flatMap((r) => [r.dark, r.light]), ...edges.flatMap((e) => [e.dark, e.light])];
  for (const m of parts) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }
  fill.renderOrder = 1000;
  group.add(...parts);
  const RIM = 0.05, BAR = 0.022, DARK = 2.6; // metres: width of the floor rim, thickness of the box bars, how much wider the dark under-bar is

  return {
    group,
    // piece: { x, y, rot, elev, size: [w, d, h] } of the layout; base: height of the floor of its level; kind: 'ok' | 'warn' | 'bad'
    set(piece, base, kind = 'ok') {
      if (!piece || !Array.isArray(piece.size) || piece.size.length !== 3 || !finite(piece.x, piece.y, piece.rot, piece.elev, base, ...piece.size)) { group.visible = false; return; }
      const [w, d, h] = piece.size, color = OUTLINE_COLORS[kind] ?? OUTLINE_COLORS.ok;
      group.position.set(piece.x, base + piece.elev + 0.006, piece.y);
      group.rotation.y = (-piece.rot * Math.PI) / 180;
      fill.scale.set(w, 1, d);
      for (const r of rim) {
        const lx = r.sx ? w + RIM : RIM, lz = r.sz ? d + RIM : RIM;
        r.light.scale.set(lx, 1, lz); r.dark.scale.set(r.sx ? lx : RIM * DARK, 1, r.sz ? lz : RIM * DARK);
        r.light.position.set(r.px * w, 0.002, r.pz * d); r.dark.position.set(r.px * w, 0.001, r.pz * d);
      }
      for (const e of edges) {
        const len = [w, h, d][e.axis];
        // the two other axes carry the offsets: axis 0 (along x) sits at y = 0 or h and z = +-d/2, axis 1 (along y) at x, z = +-, axis 2 (along z) at x = +-w/2 and y = 0 or h
        const pos = e.axis === 0 ? [0, e.a > 0 ? h : 0, (e.b * d) / 2] : e.axis === 1 ? [(e.a * w) / 2, h / 2, (e.b * d) / 2] : [(e.a * w) / 2, e.b > 0 ? h : 0, 0];
        for (const [m, t] of [[e.light, BAR], [e.dark, BAR * DARK]]) {
          const s = [t, t, t]; s[e.axis] = len + t; m.scale.set(s[0], s[1], s[2]); m.position.set(pos[0], pos[1], pos[2]);
        }
      }
      fillMat.color.set(color); rimMat.color.set(color);
      group.visible = true;
    },
    hide() { group.visible = false; },
    get visible() { return group.visible; },
    get kindColor() { return `#${rimMat.color.getHexString()}`; },
    dispose() { flat.dispose(); cube.dispose(); fillMat.dispose(); rimMat.dispose(); haloMat.dispose(); group.removeFromParent(); },
  };
}

// Outline of one room: polygon [[x, y], ...] of the plan (plan y is world z) on a floor at height `base`. Fill plus a thick rim, light on dark.
export function createRoomOutline() {
  const group = new THREE.Group(); group.name = 'room-outline'; group.visible = false; group.renderOrder = 990;
  const fillMat = basicMat(ROOM_OUTLINE_COLOR, 0.2), rimMat = basicMat(ROOM_OUTLINE_COLOR, 0.95), haloMat = basicMat(HALO, 0.5);
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMat), rim = new THREE.Mesh(new THREE.BufferGeometry(), rimMat), halo = new THREE.Mesh(new THREE.BufferGeometry(), haloMat);
  fill.renderOrder = 990; halo.renderOrder = 991; rim.renderOrder = 992;
  for (const m of [fill, halo, rim]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }
  group.add(fill, halo, rim);
  const RIM = 0.09, HALO_W = 0.17;
  // quads along every edge, each a little longer than the edge so the corners are closed
  function strips(poly, width, y) {
    const pos = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length], dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      if (!(len > 1e-6)) continue;
      const ux = dx / len, uz = dz / len, nx = -uz * width / 2, nz = ux * width / 2, ex = ux * width / 2, ez = uz * width / 2;
      const a = [x0 - ex + nx, y, z0 - ez + nz], b = [x1 + ex + nx, y, z1 + ez + nz], c = [x1 + ex - nx, y, z1 + ez - nz], d = [x0 - ex - nx, y, z0 - ez - nz];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    return pos;
  }
  const put = (mesh, pos) => { mesh.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mesh.geometry = g; };
  return {
    group,
    set(polygon, base) {
      const poly = Array.isArray(polygon) ? polygon.filter((p) => Array.isArray(p) && finite(p[0], p[1])) : [];
      if (poly.length < 3 || poly.length > 400 || !finite(base)) { group.visible = false; return; }
      const y = base + 0.012;
      let tri = [];
      try { tri = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { tri = []; }
      put(fill, tri.flatMap((t) => t.flatMap((i) => [poly[i][0], y - 0.004, poly[i][1]])));
      put(halo, strips(poly, HALO_W, y - 0.002)); put(rim, strips(poly, RIM, y));
      group.visible = true;
    },
    hide() { group.visible = false; },
    get visible() { return group.visible; },
    dispose() { for (const m of [fill, halo, rim]) m.geometry.dispose(); fillMat.dispose(); rimMat.dispose(); haloMat.dispose(); group.removeFromParent(); },
  };
}
