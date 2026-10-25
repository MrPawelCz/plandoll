// Page shell: reads the address parameters, builds the plan scene, the stage (light, base, backdrop) and the post chain, draws.
// Parameters: #preset&t=&q=&cam=&az=&pol=&plan=&frames=&lang=&ui=&live=&edit=&btn= (see params.js). No network, no storage, no external files.
// With edit=1 a piece can be selected, dragged over the floor, turned and deleted, with undo and redo (edit.js, pick.js, render/outline.js).
// The model can be turned round (camera.js): the outer walls that face the camera are cut low (render/cutaway.js).
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../core/validate.js';
import { buildModel, modelExtent } from '../model/geometry.js';
import { PlanScene } from '../render/scene.js';
import { createStage } from '../look/stage.js';
import { createPost } from '../look/post.js';
import { resolveQuality } from '../look/quality.js';
import { parseParams, editHash } from './params.js';
import { frameRequest } from './capture.js';
import { createLoop } from './loop.js';
import { createUI, createEditBar, showErrorCard } from './ui.js';
import { createEditSession } from './edit.js';
import { readPlanText } from './planfile.js';
import { pickPiece, floorHit } from './pick.js';
import { createOutline, createRoomOutline, outlineKind } from '../render/outline.js';
import { createPanel } from './panel.js';
import { saveTextFile, saveBlobFile, readTextFile, askForText, refusalText, LAYOUT_FILENAME, IMAGE_FILENAME } from './files.js';
import { roomAt } from '../editor/index.js';
import { autoFurnish } from '../layout/index.js';
import { piecesImplemented } from '../furniture/index.js';
import { composeLayout, cutawayPieces, emittersOf, focusRoom, mergeByMaterial, setLampGlow, disposeComposed } from '../render/compose.js';
import { applyWallCut } from '../render/cutaway.js';
import { createCameraController, stateFrom, positionOf, nearSides, sameSides, sidesKey, viewOf, fitView, wrapDegrees, fillBoost } from './camera.js';
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
  const S = { preset: params.preset, t: params.t, q: params.q, lang: params.lang, tools: params.btn, editing: params.edit };
  const T = (pl, en) => (S.lang === 'pl' ? pl : en);
  let level = resolveQuality(S.q, env);
  S.level = level; S.autoLevel = resolveQuality('auto', env); // the controls show which level Auto would pick on this device

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
  const res = analyzePlan(plan); let model = buildModel(modelOf(res)); // model, ext, ps, stage, layout and focus are replaced when a plan is loaded
  let ext = modelExtent(model);
  let ps = new PlanScene(model, 'textured');
  ps.setLabels(false); ps.setArcs(false); ps.setCeilings(false);
  scene.add(ps.group);

  // ---------- stage ----------
  let stage = createStage({ renderer, scene, bounds: ext, quality: level, preset: S.preset, t: S.t });
  // ---------- furniture: the engine lays the rooms out, compose builds the pieces (rebuilt when the quality changes) ----------
  let layout = autoFurnish(model, { seed: params.seed, allowedTypes: piecesImplemented() });
  let focus = focusRoom(model, layout);

  // ---------- camera: turns round the model; the outer walls that face it are cut low, the others stay tall ----------
  let W = window.innerWidth, H = window.innerHeight;
  const camera = new THREE.PerspectiveCamera(27, W / H, 0.5, 160);
  let pose = cameraFor(ext, W / H, params.cam, focus), cam = null;
  // Opened at another azimuth or tilt than the default view: the distance and the target are fitted to the model as seen from there (all storeys inside
  // the frame with a margin). The default view itself is left exactly as cameraFor gives it.
  const dh = stateFrom(pose.pos, pose.target), askAz = params.az ?? dh.azimuth, askPol = params.pol ?? dh.polar;
  let wantFit = params.cam !== 'close' && (Math.abs(wrapDegrees(askAz - dh.azimuth + 180) - 180) > 1 || Math.abs(askPol - dh.polar) > 1);
  const fitPose = (p) => {
    const fit = fitView({ azimuth: askAz, polar: askPol }, ext, { fov: p.fov, aspect: W / H });
    return { ...p, target: fit.target, pos: positionOf({ azimuth: askAz, polar: askPol, distance: fit.distance }, fit.target) };
  };
  if (wantFit) pose = fitPose(pose);
  const home0 = stateFrom(pose.pos, pose.target);
  let current = { ...home0, azimuth: params.az ?? home0.azimuth, polar: params.pol ?? home0.polar }; // the view the controller reports
  let near = nearSides(current.azimuth);
  applyWallCut(ps, ext, near);

  let furn = null, curLayout = layout, sigs = new Map(), live = new Set(); // live: ids of the pieces kept out of the merged meshes (the one being dragged); curLayout is the layout on the stage (the editor replaces it); sigs the build signature of each piece
  const sigOf = (p) => `${p.type}|${p.size.join(',')}|${JSON.stringify(p.colors ?? {})}`;
  const sigsOf = (lay) => { const m = new Map(); for (const lc of lay.levels) for (const p of lc.pieces) m.set(p.id, sigOf(p)); return m; };
  function furnish() {
    if (furn) disposeComposed(furn.group, furn.merged?.group);
    furn = composeLayout({ model, layout: curLayout, quality: level, look: 'textured', seed: params.seed });
    if (params.edit) { sigs = sigsOf(curLayout); scene.add(furn.group); } // not merged: the pieces must be in the scene before the shadow casters are chosen
    settle();
    if (!params.edit) scene.add(furn.group);
  }
  // After the pieces or the set of near walls changed: hide what the cutaway would spoil, rebuild the merged meshes and the lights.
  function settle() {
    furn.hidden = cutawayPieces(furn.pieces, ext, viewOf(current), near); // hung pieces behind the low walls would float
    furn.emitters = emittersOf(furn.pieces);
    if (furn.merged) { disposeComposed(furn.merged.group); furn.merged = null; }
    if (params.merge && params.edit) { // the editor merges the pieces nobody moves; the one being dragged stays its own object
      furn.cutHidden = new Set(); for (const [id, g] of furn.pieces) if (!g.visible) furn.cutHidden.add(id); // hidden by the cutaway: not pickable
      furn.merged = mergeByMaterial(furn, live);
      for (const [id, g] of furn.pieces) if (!live.has(id)) g.visible = false; // the merged meshes draw them
      scene.add(furn.merged.group);
    } else if (params.merge) { furn.merged = mergeByMaterial(furn); furn.group.visible = false; scene.add(furn.merged.group); } // one mesh per material: far fewer draw calls
    stage.setEmitters(furn.emitters);
    stage.refreshShadowCasters(scene);
  }
  furnish();

  function frameCamera() {
    pose = cameraFor(ext, W / H, params.cam, focus);
    if (wantFit) pose = fitPose(pose);
    if (cam) { cam.setTarget(pose.target); cam.rehome(stateFrom(pose.pos, pose.target)); current = cam.state; }
    camera.fov = pose.fov; camera.aspect = W / H;
    camera.position.set(...positionOf(current, pose.target)); camera.lookAt(...pose.target); camera.updateProjectionMatrix(); stage.fitBackdrop(W / H);
  }
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
  function setQ(q) { S.q = q; level = resolveQuality(q, env); S.level = level; stage.setQuality(level); furnish(); post.setQuality(level); applyAll(); ui?.update(S); redraw(); }
  function setLang(l) { S.lang = l; ui?.update(S); editBar?.update({ lang: l }); panel?.setLang(l); }
  // the camera reports every change of the view; a change in the set of near edges re-cuts the walls and the pieces (not every frame of a turn)
  function onCamera(s) {
    current = s;
    camera.position.set(...positionOf(s, pose.target)); camera.lookAt(...pose.target);
    stage.rig.setFillBoost(fillBoost(s.azimuth));
    const n = nearSides(s.azimuth, near);
    if (!sameSides(n, near)) { near = n; applyWallCut(ps, ext, near); settle(); }
    redraw();
  }
  let editBar = null, panel = null;
  const sayLine = (text, detail) => (editBar ? editBar.say(text, undefined, detail) : ui?.say(text, undefined, detail)); // one short result line: above the edit bar, or above the controls on the plain page
  // The extra buttons of the control bar (btn=1): edit mode on or off (the page reloads with edit=1 added or removed, the mood, the time of day, the
  // quality and the language kept), and the picture of the current view as a PNG. Leaving the editor with unsaved changes needs a second tap.
  let dirty = false, leaveWarned = false, leaveTimer = 0;
  function toggleEdit() {
    const leaving = params.edit;
    if (leaving && dirty && session?.canUndo() && !leaveWarned) {
      leaveWarned = true; clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { leaveWarned = false; }, 6000);
      sayLine(T('Masz niezapisane zmiany: zapisz układ albo dotknij jeszcze raz', 'You have unsaved changes: save the layout or tap again'));
      return;
    }
    location.hash = editHash(location.hash, !leaving, S);
    location.reload();
  }
  function saveImage() {
    post.render(); // the view is drawn once more and read in the same turn, so the buffer still holds the picture
    renderer.domElement.toBlob((blob) => {
      const ok = !!blob && saveBlobFile(document, IMAGE_FILENAME, blob);
      sayLine(ok ? T('Zapisano obraz do pliku', 'Picture saved to a file') : T('Nie udało się zapisać obrazu', 'Could not save the picture'));
    }, 'image/png');
  }
  // Loading a plan of your own (a button of the controls and an item of the More menu): the text goes through the reader and the validator, then the old
  // scene is released and the model, the automatic layout, the stage and the view are built again, without reloading the page. Nothing is stored.
  let onPlanSwapped = null;
  function applyPlan(next) {
    let built;
    try { // everything new is built first, so a plan that cannot be built leaves the page as it was
      const p = JSON.parse(JSON.stringify(next)); for (const lv of p.levels) lv.furniture = [];
      const r = analyzePlan(p), m = buildModel(modelOf(r)), e = modelExtent(m);
      const nps = new PlanScene(m, 'textured'); nps.setLabels(false); nps.setArcs(false); nps.setCeilings(false);
      built = { m, e, nps, lay: autoFurnish(m, { seed: params.seed, allowedTypes: piecesImplemented() }) };
    } catch { return false; }
    if (furn) { disposeComposed(furn.group, furn.merged?.group); furn = null; }
    scene.remove(ps.group); ps.dispose(); stage.dispose();
    model = built.m; ext = built.e; ps = built.nps; layout = built.lay; curLayout = layout; focus = focusRoom(model, layout);
    scene.add(ps.group);
    stage = createStage({ renderer, scene, bounds: ext, quality: level, preset: S.preset, t: S.t });
    wantFit = false; near = nearSides(current.azimuth); applyWallCut(ps, ext, near);
    furnish(); // the pieces first: the camera below may re-cut the walls and the pieces
    frameCamera(); cam.reset(false); current = cam.state;
    applyAll(); stage.rig.setFillBoost(fillBoost(current.azimuth));
 onPlanSwapped?.(); redraw();
    return true;
  }
  function loadPlan() {
    askForText(document, S.lang, { kind: 'plan' }).then((text) => {
      if (text == null) return;
      const r = readPlanText(text, S.lang);
      if (!r.ok) { sayLine(r.message, r.detail); return; }
      sayLine(applyPlan(r.plan) ? T('Wczytano plan', 'Plan loaded') : T('Nie udało się zbudować modelu z tego planu', 'Could not build a model from this plan'));
    });
  }
  const ui = params.ui ? createUI({ onPreset: (n) => setPreset(n), onTime: setTime, onQuality: setQ, onLang: setLang, onReset: () => cam?.reset(true), onEdit: toggleEdit, onSaveImage: saveImage, onLoadPlan: loadPlan }, S) : null;
  cam = createCameraController({ element: renderer.domElement, home: home0, initial: { azimuth: params.az, polar: params.pol }, target: pose.target, fov: pose.fov, onChange: onCamera, onGesture: () => ui?.hideHint() });
  applyAll();
  // ---------- edit mode (edit=1): select a piece, drag it over the floor, turn, delete, undo and redo ----------
  let session = null;
  if (params.edit) {
    const levelBase = (id) => Number(model.levels.find((l) => l.id === id)?.elevation) || 0;
    const outline = createOutline(); scene.add(outline.group);
    const roomOutline = createRoomOutline(); scene.add(roomOutline.group);
    const dom = renderer.domElement;
    const polygonOf = (r) => model.levels.find((l) => l.id === r.level)?.rooms?.find((x) => x.id === r.id)?.polygon ?? null;
    // the room colours of the layout go to the scene; a plan without any colour is left exactly as it was drawn before
    let colorsKey = '{}';
    function applyRoomColors() {
      if (typeof ps.setRoomColors !== 'function') return;
      const colors = {};
      for (const lc of curLayout.levels) if (lc.rooms && Object.keys(lc.rooms).length) colors[lc.id] = lc.rooms;
      const key = JSON.stringify(colors);
      if (key === colorsKey) return;
      colorsKey = key; ps.setRoomColors(colors, 'textured'); redraw();
    }
    // the plan point and level under the centre of the view: where a new piece is put
    const viewPoint = () => {
      let bottom = H; // the picture above the bars (and above the sheet of the panel when it is open) is what the person looks at
      for (const sel of ['#ps-edit', '.psp-sheet']) { const r = document.querySelector(sel)?.getBoundingClientRect(); if (r && r.width > 0 && r.height > 0 && r.top > H * 0.3) bottom = Math.min(bottom, r.top); }
      const ray = cam.pointerToRay({ clientX: W / 2, clientY: bottom / 2 });
      for (const lv of [...model.levels].sort((p, q) => levelBase(q.id) - levelBase(p.id))) {
        const fh = floorHit(ray, levelBase(lv.id));
        if (fh && roomAt(model, lv.id, fh[0], fh[2])) return { level: lv.id, x: fh[0], y: fh[2] };
      }
      return null;
    };
    // the room under a pointer on the floor (the highest level first), or null
    const roomHitAt = (e) => {
      const ray = cam.pointerToRay(e);
      for (const lv of [...model.levels].sort((p, q) => levelBase(q.id) - levelBase(p.id))) {
        const fh = floorHit(ray, levelBase(lv.id)), id = fh ? roomAt(model, lv.id, fh[0], fh[2]) : null;
        if (id) return { level: lv.id, id };
      }
      return null;
    };
    // the pieces move to where the layout says (no rebuilding): a drag, a turn, an undo of a move
    function syncGroups() {
      for (const lc of curLayout.levels) for (const p of lc.pieces) {
        const g = furn.pieces.get(p.id); if (!g) continue;
        g.position.set(p.x, levelBase(lc.id) + p.elev, p.y); g.rotation.y = (-p.rot * Math.PI) / 180; g.userData.elev = p.elev;
      }
      furn.group.updateMatrixWorld(true);
    }
    function refreshEdit() {
      const sel = session.selected(), room = sel ? null : session.selectedRoom();
      if (sel) outline.set(sel, levelBase(session.levelOf(sel.id)), outlineKind(session.problems())); else outline.hide();
      if (room && polygonOf(room)) roomOutline.set(polygonOf(room), levelBase(room.level)); else roomOutline.hide();
      editBar?.update({ selected: !!sel, canUndo: session.canUndo(), canRedo: session.canRedo() });
    }
    function onEdit(e) {
      curLayout = session.state.layout;
      if (e.type === 'structure' || e.type === 'dragend') dirty = true;
      if (e.type === 'structure') {
        live = new Set(); // a cancelled drag, a turn, an undo: every piece goes back into the merged meshes
        const next = sigsOf(curLayout);
        if (next.size === sigs.size && [...next].every(([id, sg]) => sigs.get(id) === sg)) { syncGroups(); settle(); } // only places changed
        else { furnish(); setLampGlow(furn.group, stage.state.lampK); } // pieces added, removed, resized or recoloured
        applyRoomColors();
      } else if (e.type === 'drag') {
        const id = session.state.selection; // the piece being dragged leaves the merged meshes at the first move and goes back at the end
        if (params.merge && id && !live.has(id)) { live = new Set([id]); syncGroups(); settle(); } else syncGroups();
      } else if (e.type === 'dragend') { live = new Set(); syncGroups(); settle(); }
      refreshEdit(); redraw();
    }
    const makeSession = () => createEditSession({ layout, model, allowedTypes: piecesImplemented(), onChange: onEdit, viewPoint });
    session = makeSession();
    // layout files and the "More" menu: one short line tells how a load went
    const LARGE_LAYOUT = 600; // pieces; a bigger layout is accepted, with a warning
    const plItems = (n) => (n === 1 ? 'pozycję' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pozycje' : 'pozycji');
    const say = (text) => editBar?.say(text);
    function loaded(res) {
      if (!res.ok) { const why = String(res.errors?.[0] ?? '').slice(0, 90); say(T('Nie wczytano układu', 'Could not load the layout') + (why ? `: ${why}` : '')); return; }
      const n = res.warnings?.length ?? 0, pieces = session.state.layout.levels.reduce((k, l) => k + (l.pieces?.length ?? 0), 0);
      if (pieces > LARGE_LAYOUT) { say(T('Wczytano. Duży układ może działać wolno na telefonie', 'Loaded. A large layout may run slowly on a phone'), 9000); return; }
      say(n ? T(`Wczytano, pominięto ${n} ${plItems(n)}`, `Loaded, skipped ${n} ${n === 1 ? 'item' : 'items'}`) : T('Wczytano układ', 'Layout loaded'));
    }
    const fileHandlers = {
      onDuplicate: () => { const r = session.duplicate(); if (!r.ok) say(T('Nie można powielić', 'Cannot duplicate')); },
      onSave: () => { const ok = saveTextFile(document, LAYOUT_FILENAME, session.exportText()); if (ok) dirty = false; say(ok ? T('Zapisano układ do pliku', 'Layout saved to a file') : T('Nie udało się zapisać pliku', 'Could not save the file')); },
      onLoad: () => { readTextFile(document).then((r) => { if (r.ok) loaded(session.importText(r.text)); else if (r.error !== 'cancelled') say(refusalText(S.lang, r.error === 'too-large' ? 'fileTooLarge' : 'fileFailed')); }); },
      onPaste: () => { askForText(document, S.lang).then((t) => { if (t != null) loaded(session.importText(t)); }); },
    };
    if (params.ui) editBar = createEditBar({ onTurn: () => session.turn(90), onRemove: () => session.remove(), onUndo: () => session.undo(), onRedo: () => session.redo(), onAuto: () => session.reset(), onSaveImage: saveImage, onLoadPlan: loadPlan, ...fileHandlers }, { lang: S.lang }, document, ui);
    if (params.ui) panel = createPanel({ doc: document, host: document.body, lang: S.lang, session });
    refreshEdit();
    onPlanSwapped = () => { // a new plan: a new editing session with nothing selected, no undo history and no unsaved changes
      gest = null; cam.enabled = true; dirty = false; leaveWarned = false; colorsKey = '{}';
      session = makeSession();
      if (panel) { panel.dispose(); panel = createPanel({ doc: document, host: document.body, lang: S.lang, session }); }
      refreshEdit();
    };

    // One finger or the mouse on a piece selects it and drags it; elsewhere the camera turns as before; a quick tap on nothing clears the selection.
    let gest = null, adopting = false;
    const PAD = { mouse: 0.02, touch: 0.06, pen: 0.04 }; // metres of margin round every piece when picking: a fingertip is wider than a mouse pointer
    const hitAt = (e) => pickPiece(session.state.layout, cam.pointerToRay(e), { levelBase, pad: PAD[e.pointerType] ?? PAD.mouse, skip: (id) => furn.cutHidden ? furn.cutHidden.has(id) : !furn.pieces.get(id)?.visible });
    const showPanel = (on) => { if (panel) panel.element.hidden = !on; };
    dom.addEventListener('pointerdown', (e) => {
      if (adopting) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gest) { // a second finger: the piece goes back and the camera takes over with both fingers
        const first = gest; gest = null;
        if (first.dragging) session.cancelDrag();
        if (first.id) {
          cam.enabled = true; showPanel(true);
          adopting = true; // the camera learns about the first finger too, so that the pinch starts at once
          try { dom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: first.pointerId, pointerType: e.pointerType, clientX: first.lastX, clientY: first.lastY, button: 0, buttons: 1, isPrimary: true, bubbles: true, cancelable: true })); } catch {}
          adopting = false;
        }
        return;
      }
      const hit = hitAt(e), base = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, t0: performance.now(), moved: 0, id: null, dragging: false };
      if (!hit) { gest = { ...base, room: roomHitAt(e) }; return; }
      const piece = session.pieceById(hit.id), fh = floorHit(cam.pointerToRay(e), levelBase(hit.level) + piece.elev);
      gest = { ...base, id: hit.id, level: hit.level, base: levelBase(hit.level) + piece.elev, off: fh ? [piece.x - fh[0], piece.y - fh[2]] : [0, 0] };
      cam.enabled = false; session.select(hit.id);
      try { dom.setPointerCapture(e.pointerId); } catch {}
    }, true);
    dom.addEventListener('pointermove', (e) => {
      const g = gest; if (!g || !g.id || g.pointerId !== e.pointerId) return;
      g.lastX = e.clientX; g.lastY = e.clientY;
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
      if (g.moved < 6) return; // a tap is not a drag
      if (!g.dragging) { g.dragging = session.beginDrag(g.id); if (!g.dragging) return; showPanel(false); }
      const ray = cam.pointerToRay(e), fh = floorHit(ray, g.base);
      if (!fh) return;
      session.dragTo(fh[0] + g.off[0], fh[2] + g.off[1]);
      // a prop that leaves a table (or lands on one) changes height: the plane that the finger points at follows it, so it stays under the finger
      const nb = levelBase(g.level) + (session.pieceById(g.id)?.elev ?? 0);
      if (Math.abs(nb - g.base) > 1e-6) { g.base = nb; const f2 = floorHit(ray, nb); if (f2) session.dragTo(f2[0] + g.off[0], f2[2] + g.off[1]); }
    }, true);
    const finish = (e, cancelled) => {
      const g = gest; if (!g || g.pointerId !== e.pointerId) return;
      gest = null;
      if (g.id) {
        cam.enabled = true;
        try { dom.releasePointerCapture(e.pointerId); } catch {}
        if (g.dragging) { if (cancelled) session.cancelDrag(); else session.endDrag(); }
        if (g.dragging && !cancelled && window.innerWidth <= 760) panel?.collapse?.(); // on a phone the sheet folds to its header after a drop
        showPanel(true);
      } else if (!cancelled && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 6 && performance.now() - g.t0 < 350) {
        if (g.room) session.selectRoom(g.room.level, g.room.id); else session.select(null); // a tap on a floor picks the room, a tap beside the plan clears
      }
    };
    dom.addEventListener('pointerup', (e) => finish(e, false), true);
    dom.addEventListener('pointercancel', (e) => finish(e, true), true);
    // keys (not while a form field has the focus): Delete or Backspace removes, R turns, Ctrl or Cmd + Z undoes, with Shift (or Ctrl + Y) redoes, Escape clears the selection
    addEventListener('keydown', (e) => {
      const tag = String(e.target?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey, k = String(e.key).toLowerCase();
      if (mod && k === 'z') { if (e.shiftKey) session.redo(); else session.undo(); e.preventDefault(); }
      else if (mod && k === 'y') { session.redo(); e.preventDefault(); }
      else if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) { session.remove(); e.preventDefault(); }
      else if (!mod && !e.altKey && k === 'r') session.turn(90);
      else if (e.key === 'Escape') session.select(null);
    });
    // for test tools: the piece's place in client pixels, the number of pieces, the selected id
    const v3 = new THREE.Vector3();
    window.__edit = {
      get session() { return session; },
      count: () => session.state.layout.levels.reduce((n, lv) => n + lv.pieces.length, 0),
      hit: (x, y, type = 'touch') => hitAt({ clientX: x, clientY: y, pointerType: type })?.id ?? null, // the piece under a client point (with the margin of a fingertip unless type is 'mouse'), or null
      selectedId: () => session.state.selection,
      selectedRoomId: () => session.selectedRoom()?.id ?? null,
      roomHit: (x, y) => roomHitAt({ clientX: x, clientY: y }), // the room under a client point: { level, id } or null
      // a client point on the floor of a room where no piece stands and the room is what a tap would pick (tests tap there): { x, y } or null
      freeFloor(levelId, roomId) {
        const poly = model.levels.find((l) => l.id === levelId)?.rooms?.find((r) => r.id === roomId)?.polygon; if (!poly) return null;
        const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, r = dom.getBoundingClientRect();
        const cand = []; for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.3) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.3) cand.push([x, y]);
        cand.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        camera.updateMatrixWorld(true);
        for (const [x, y] of cand.slice(0, 600)) {
          v3.set(x, levelBase(levelId) + 0.01, y).project(camera);
          const px = r.left + (v3.x * 0.5 + 0.5) * r.width, py = r.top + (-v3.y * 0.5 + 0.5) * r.height;
          if (px < r.left + 8 || px > r.right - 8 || py < r.top + 70 || py > r.bottom - 220) continue; // keep clear of the bars
          const rh = roomHitAt({ clientX: px, clientY: py });
          if (rh && rh.level === levelId && rh.id === roomId && !hitAt({ clientX: px, clientY: py, pointerType: 'touch' })) return { x: px, y: py };
        }
        return null;
      },
      // the plan point [x, z] under a client point on the floor of a level (or null), and the client point of a plan point on that floor
      floorAt(x, y, levelId) { const fh = floorHit(cam.pointerToRay({ clientX: x, clientY: y }), levelBase(levelId)); return fh ? [fh[0], fh[2]] : null; },
      pointOf(levelId, x, z) {
        camera.updateMatrixWorld(true);
        v3.set(x, levelBase(levelId), z).project(camera);
        const r = dom.getBoundingClientRect();
        return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
      },
      screenOf(id) {
        const f = session.pieceById(id); if (!f) return null;
        camera.updateMatrixWorld(true);
        v3.set(f.x, levelBase(session.levelOf(id)) + f.elev + f.size[2] * 0.75, f.y).project(camera);
        const r = dom.getBoundingClientRect();
        return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
      },
    };
  }
  // Arrow keys turn the model (see camera.js); Shift + left or right moves the time of day, 1 to 3 pick a mood.
  addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'ArrowRight') setTime(S.t + 0.02); else if (e.shiftKey && e.key === 'ArrowLeft') setTime(S.t - 0.02);
    else if (['1', '2', '3'].includes(e.key)) setPreset(['amber', 'clear', 'lamplit'][Number(e.key) - 1]);
  });
  addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; frameCamera(); post.resize(W, H); redraw(); });
  window.__planInfo = () => ({ pieces: furn.pieces.size, levels: model.levels.length, rooms: model.levels.reduce((n, l) => n + (l.rooms?.length ?? 0), 0), extent: [ext.minX, ext.maxX, ext.minZ, ext.maxZ].map((v) => +v.toFixed(2)) }); // for test tools
  window.__setT = setTime; window.__setPreset = setPreset; window.__setQuality = setQ;
  window.__camera = { get azimuth() { return cam.state.azimuth; }, get polar() { return cam.state.polar; }, get distance() { return cam.state.distance; }, get near() { return sidesKey(near); }, get busy() { return cam.busy; }, set: (azimuth, polar) => cam.set({ azimuth, polar }), reset: () => cam.reset(false) };

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
      luminance: luminance(), msFirst: Math.round(times[0]), frames: params.frames, geometries: renderer.info.memory.geometries, visibleMeshes: meshes, lights, rendererRenderCalls: renderCalls, shadowCasters: stage.state.casters, pieces: furn.pieces.size, hiddenPieces: furn.hidden, mergedMeshes: furn.merged?.meshes ?? 0, emitters: furn.emitters.length, azimuth: Math.round(current.azimuth), near: sidesKey(near), size: post.size, pixelRatio: post.pixelRatio, plan: params.plan.name };
    window.__done = true;
  }
  loop = createLoop({ draw: frame, frames: params.frames, live: params.live });
  loop.start();
  // Frame hook for screenshots and video capture: window.__frame({ preset, t, az, pol, dist, size }) sets the mood, the time of day (0 to 1), the view
  // (azimuth and tilt in degrees, dist as a multiple of the default distance) and the size of the picture, draws exactly one new frame and resolves
  // after the animation frame that drew it with { frames, drawCalls }. Every field is optional; values are checked in capture.js.
  window.__frame = (args) => new Promise((resolve) => {
    const r = frameRequest(args), before = loop.drawn;
    if (r.preset) { const p = stage.setPreset(r.preset); S.preset = p.id; if (r.t === undefined) S.t = p.t; }
    if (r.t !== undefined) S.t = r.t;
    if (r.size) { W = r.size.w; H = r.size.h; frameCamera(); post.resize(W, H); }
    cam.set({ azimuth: r.az ?? cam.state.azimuth, polar: r.pol ?? cam.state.polar, distance: r.dist !== undefined ? cam.state.base * r.dist : cam.state.distance });
    applyAll(); ui?.update(S);
    const wait = () => { if (loop.drawn > before) resolve({ frames: loop.drawn - before, drawCalls: renderer.info.render.calls }); else requestAnimationFrame(wait); };
    loop.invalidate(); requestAnimationFrame(wait);
  });
} catch (e) { fail(e); }
