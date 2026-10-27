// The build-up of the intro (intro.js has the story, this moves the scene by it). The walls of the finished scene are cut to the heights the view asks for; here they start flat
// (only their dark tops show, the outline of the plan), rise in a wave and stop at exactly those heights; the windows and doors rise where they stand; the pieces of furniture,
// each of them an object of its own for now, drop in room by room; a soft contact shadow comes under each piece that stands on the floor when it lands.
// The scene as it is when prepare() is called is the end state: it is read from the scene, not worked out again, and finish() puts every wall box and every piece back to it
// exactly, so that the page after the intro is the page without one (the caller then merges the pieces and cuts the walls again as it always does).
// Nothing here draws, schedules or listens: apply(t) puts the scene at time t seconds, the caller asks for the frame.
import { setBoxUV } from '../render/uv.js';
import { contactMesh, castsContact, footprintOf } from '../render/contact.js';
import { emittersOf } from '../render/compose.js';
import { specOf } from '../furniture/specs.js';
import { INTRO, introTimeline, pieceStarts, pieceMotion, pieceRank, pieceOrder, wallRise, waveOf, easeOut } from './intro.js';

// Moves a wall box so it spans y0..y1 (level space) and keeps its texture frame in step (the same as cutaway.js).
function place(m, y0, y1) {
  m.position.y = (y0 + y1) / 2; m.scale.y = Math.max(1e-4, y1 - y0);
  const f = m.pw?.uv;
  if (f) setBoxUV(m.geometry, f.u, (y0 + y1) / 2, f.w, f.sx, y1 - y0, f.sz, f.k, f.swap);
}

// deps: { ps (the PlanScene), furn (what composeLayout made: pieces is a Map of id to group), layout (the layout on the stage), ext (the box of the floors on show), scene (where the contact
// shadows go), lamps(list) (the page gives the stage the lamps that stand now) }. Pieces that are not visible when prepare() is called (the cutaway took them away, or their floor is not on show)
// stay as they are, and are not counted.
export function createBuildUp({ ps, furn, layout, ext, scene, lamps = () => {} }) {
  let tl = null, walls = [], openings = [], list = [], rooms = 0, contact = null, perPatch = 0, lastPlaced = -1, lastLanded = -1, active = false;

  function prepare() {
    // walls and openings: the end state is what the boxes are now; a wall (or an opening) is all the boxes under one group, which rise together
    const groups = new Map();
    for (const c of ps.cuttables) {
      const m = c.mesh, p = m.parent, name = p?.name ?? '';
      if (!groups.has(p)) groups.set(p, { kind: name.startsWith('opening:') ? 'opening' : 'wall', items: [], x: 0, z: 0, top: 0, stage: -1, t0: 0 });
      const g = groups.get(p);
      c.end = { vis: m.visible, py: m.position.y, sy: m.scale.y, y1: m.position.y + m.scale.y / 2 };
      g.items.push(c); g.x += m.position.x; g.z += m.position.z; g.top = Math.max(g.top, c.y1);
    }
    walls = []; openings = [];
    for (const g of groups.values()) {
      g.x /= g.items.length; g.z /= g.items.length; g.wave = waveOf(g.x, g.z, ext);
      (g.kind === 'opening' ? openings : walls).push(g);
    }

    // furniture: the pieces that show in the end state, dealt out by room
    furn.group.updateMatrixWorld(true);
    const meta = new Map();
    for (const lc of layout.levels) for (const p of lc.pieces) meta.set(p.id, { room: p.room ?? '', level: lc.id });
    const items = [];
    for (const [id, g] of furn.pieces) {
      if (!g.visible) continue;
      const spec = specOf(g.userData.pieceType), mode = spec?.place?.mode ?? 'floor', size = g.userData.size ?? [0.5, 0.5, 0.5], m = meta.get(id) ?? { room: '', level: '' };
      items.push({ id, room: `${m.level}|${m.room}`, rank: pieceRank(mode), area: size[0] * size[1], g, mode });
    }
    const byId = new Map(items.map((it) => [it.id, it]));
    const order = pieceOrder(items);
    rooms = new Set(order.map((o) => o.room)).size;
    tl = introTimeline(order.length);
    const starts = pieceStarts(order.map((o) => o.first), tl);
    list = order.map((o, i) => {
      const it = byId.get(o.id), g = it.g;
      return { id: o.id, g, mode: it.mode, drop: it.mode === 'floor' || it.mode === 'corner' || it.mode === 'surface', flat: it.mode === 'floor-flat', t0: starts[i], y: g.position.y,
        sx: g.scale.x, sy: g.scale.y, sz: g.scale.z, lamps: emittersOf(new Map([[o.id, g]])), state: -1, contact: 0 };
    });
    // the contact shadows, in the order of the pieces: the first k patches show when k pieces have landed
    disposeContact();
    const ordered = new Map(list.map((q) => [q.id, q.g]));
    contact = contactMesh(ordered);
    if (contact) {
      perPatch = contact.geometry.index.count / contact.userData.pieces;
      contact.geometry.setDrawRange(0, 0);
      scene.add(contact);
      let n = 0;
      for (const q of list) { if (castsContact(q.g) && footprintOf(q.g)) n++; q.contact = n; } // patches up to and including this piece
    }
    lastPlaced = -1; lastLanded = -1; active = true;
    return info();
  }

  function disposeContact() {
    if (!contact) return;
    contact.removeFromParent(); contact.geometry.dispose(); contact = null;
  }

  const info = () => ({ walls: walls.length, openings: openings.length, pieces: list.length, rooms, timeline: tl });

  // A wall box at the height H of its wall: hidden when it is not there in the end state or when H has not reached its bottom, otherwise from its bottom up to H or its end height.
  function setBox(c, H) {
    const m = c.mesh, end = c.end;
    if (!end.vis || (c.y0 > 0 && H <= c.y0 + 0.003)) { m.visible = false; return; }
    place(m, c.y0, Math.max(Math.min(end.y1, H), c.y0 + 0.002)); m.visible = true;
  }

  // Puts the scene at time t (seconds since the intro began). Returns { placed, total }: how many pieces stand on the plan at that time, of how many.
  function apply(t) {
    if (!active) return { placed: 0, total: 0 };
    const W = tl.walls, O = tl.openings;
    for (const g of walls) {
      const k = wallRise(t, W.start + W.wave * g.wave, W.dur, W.power), stage = k <= 0 ? 0 : k >= 1 ? 2 : 1;
      if (stage !== 1 && g.stage === stage) continue; // nothing moves: still flat, or already at its height
      g.stage = stage;
      const H = g.top * k;
      for (const c of g.items) { setBox(c, H); ps._placeCap(c); }
    }
    for (const g of openings) {
      const k = (t - (O.start + O.wave * g.wave)) / O.dur, stage = k <= 0 ? 0 : k >= 1 ? 2 : 1;
      if (stage !== 1 && g.stage === stage) continue;
      g.stage = stage;
      const H = g.top * easeOut(k, 3);
      for (const c of g.items) {
        const m = c.mesh;
        if (k <= 0 || !c.end.vis || c.y0 >= H - 0.003) m.visible = false; else { place(m, c.y0, Math.max(Math.min(c.end.y1, H), c.y0 + 0.002)); m.visible = true; }
        ps._placeCap(c);
        if (m.pw?.pane === true) ps.sunPatch?.userData.show(m, m.visible && k >= 0.85 && (ps.paneLit ? ps.paneLit(m) : true));
      }
    }
    let placed = 0, landed = 0;
    const P = INTRO.piece;
    for (const q of list) {
      const u = t - q.t0, mo = pieceMotion(u, q.drop, q.flat), g = q.g;
      if (!mo.on) { if (q.state !== 0) { g.visible = false; q.state = 0; } continue; }
      placed++;
      if (q.drop && u >= P.fall) landed = Math.max(landed, q.contact);
      if (u >= (q.drop ? P.fall + P.bounce : P.pop)) { // at rest: exactly where the scene had it
        if (q.state !== 2) { g.visible = true; g.position.y = q.y; g.scale.set(q.sx, q.sy, q.sz); q.state = 2; }
        continue;
      }
      q.state = 1; g.visible = true; g.position.y = q.y + mo.dy; g.scale.set(q.sx * mo.sx, q.sy * mo.sy, q.sz * mo.sz);
    }
    // A lamp lights its room once it stands. The list always holds every lamp of the end state, those that do not stand yet with no power: the number of lights the renderer draws
    // stays what it will be at the end, so no shader is built again each time a lamp lands.
    if (placed !== lastPlaced) { lastPlaced = placed; lamps(list.flatMap((q) => (t >= q.t0 ? q.lamps : q.lamps.map((e) => ({ ...e, power: 0 }))))); }
    if (contact && landed !== lastLanded) { lastLanded = landed; contact.geometry.setDrawRange(0, landed * perPatch); }
    return { placed, total: list.length };
  }

  // Puts every wall box and every piece back as prepare() found them, takes the contact shadows away and lets the graphics card have the buffers of the pieces back. The caller merges and cuts again after this.
  function finish() {
    if (!active) return;
    active = false;
    for (const g of [...walls, ...openings]) {
      for (const c of g.items) {
        const m = c.mesh, e = c.end, f = m.pw?.uv;
        m.position.y = e.py; m.scale.y = e.sy; m.visible = e.vis;
        if (f && m.geometry) setBoxUV(m.geometry, f.u, e.py, f.w, f.sx, e.sy, f.sz, f.k, f.swap);
        ps._placeCap(c);
        if (m.pw?.pane === true) ps.sunPatch?.userData.show(m, ps.paneLit ? ps.paneLit(m) : m.visible);
        delete c.end;
      }
    }
    for (const q of list) { q.g.visible = true; q.g.position.y = q.y; q.g.scale.set(q.sx, q.sy, q.sz); }
    disposeContact();
    // The pieces were drawn one by one, so every geometry of theirs has buffers on the graphics card. The merged scene that follows draws none of them (it has meshes of its own), so those buffers go;
    // the data stays in memory, and a piece that is ever drawn alone again (merge=0, the shell open) is uploaded again.
    for (const q of list) q.g.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }

  return { prepare, apply, finish, info, get timeline() { return tl; }, get active() { return active; }, get contact() { return contact; } };
}
