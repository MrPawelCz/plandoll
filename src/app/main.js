// Page shell: reads the address parameters, builds the plan scene, the stage (light, base, backdrop) and the post chain, draws.
// Parameters: #preset&t=&q=&cam=&az=&pol=&plan=&frames=&lang=&ui=&live=&edit=&btn=&shell=&walk= (see params.js). No network, no storage, no external files.
// A button opens the shell: the outer walls fall outward and lie flat (render/openshell.js), and the view is framed for the closed and the open model together;
// shell=0 takes the button away; the shell works the same while editing (edit=1). The example plans of the control bar are built in place like a loaded plan.
// With edit=1 a piece can be selected, dragged over the floor, turned and deleted, with undo and redo (edit.js, pick.js, render/outline.js); with the shell open the
// pieces that hang on an outer wall are picked, outlined and dragged where the turned wall has put them.
// The model can be turned round, zoomed and moved over the ground (camera.js): the outer walls that face the camera are cut low (render/cutaway.js). The card board under it follows the open shell (look/board.js).
// A button walks the flat at eye height (spacer.js has the input, spacerrun.js the run, spacerview.js the map and the hints); walk=1 opens in that mode, walk=0 takes the button away.
// The plain page opens with an intro (intro.js, buildup.js, introview.js, introrun.js): the first model builds itself on the stage while the camera comes down to the starting view; intro=0 and a request for
// less motion switch it off, and the editor, ui=0 and live=1 never get it. A touch or a key ends it at once.
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../core/validate.js';
import { buildModel, modelExtent } from '../model/geometry.js';
import { PlanScene } from '../render/scene.js';
import { createStage } from '../look/stage.js';
import { createPost } from '../look/post.js';
import { resolveQuality } from '../look/quality.js';
import { parseParams, editHash, planHash, parsePlanParam, parseFloorParam, floorHash, withoutShare, splitHash } from './params.js';
import { ALL, resolveFloor, visibleFlags, visibleIndices, allShown, floorLift, visibleExtent, sameGround } from './floors.js';
import { frameRequest } from './capture.js';
import { createLoop } from './loop.js';
import { createUI, createEditBar, showErrorCard } from './ui.js';
import { createEditSession, placeCheck } from './edit.js';
import { NO_WEBGL2, hasWebgl2, failureDetail, planChoice, startState, partsOf, buildPlanParts, isFormTarget, shellKey, shellOn, strayClick } from './shell.js';
import { coverShare, isNarrow } from './stack.js';
import { readPlanText } from './planfile.js';
import { decodeShare, encodeShare, packLayout, planForLink, setViewParams, lostCount, SHARE_LONG } from './share.js';
import { createAddressSync, leaveAdvice } from './addrsync.js';
import { pickPiece, floorHit, slidePoint } from './pick.js';
import { createOutline, createOutlineFrame, createRoomOutline, outlineKind } from '../render/outline.js';
import { createPanel } from './panel.js';
import { createDock } from './dock.js';
import { introWanted, cameraFrom, cameraAt, liftAt } from './intro.js';
import { createBuildUp } from './buildup.js';
import { createIntroView } from './introview.js';
import { createIntroRun } from './introrun.js';
import { createSpacerRun } from './spacerrun.js';
import { createSpacerView } from './spacerview.js';
import { pieceInfo, roomsData } from './info.js';
import { saveTextFile, saveBlobFile, readTextFile, askForText, refusalText, copyText, showLinkDialog, LAYOUT_FILENAME, IMAGE_FILENAME } from './files.js';
import { promptFor } from './prompts.js';
import { roomAt, serializeLayout, parseLayout } from '../editor/index.js';
import { autoFurnish } from '../layout/index.js';
import { piecesImplemented } from '../furniture/index.js';
import { composeLayout, cutawayPieces, emittersByLevel, focusRoom, mergeByMaterial, showMergedLevels, setLampGlow, disposeComposed, wallCutHeight } from '../render/compose.js';
import { applyWallCut } from '../render/cutaway.js';
import { createOpenShell } from '../render/openshell.js';
import { stepClock, modeOf } from '../render/openmotion.js';
import { openExtent, openPoints, flatFootprint, foldWalls } from '../model/foldwalls.js';
import { createCameraController, stateFrom, positionOf, nearSides, sameSides, sidesKey, viewOf, fitView, wrapDegrees, fillBoost, lowestOnPicture, nearPlane, liftOf, PAN_GROW, SLOP_MOUSE, SLOP_TOUCH } from './camera.js';
import { boardRect } from '../look/board.js';
import flat from '../../examples/flat-1.plan.json';
import duplex from '../../examples/duplex-1.plan.json';

// The loading icon of the page (plain CSS in the HTML, see tools/build.mjs) goes once the first frame is drawn, or when the page fails; data-intro on the body says where the page is: loading, playing (the intro), done.
const leaveLoading = (state, why) => { try { const b = document.body; document.getElementById('ps-loading')?.remove(); if (state === 'done' && b.dataset.intro === 'playing') b.dataset.introFade = '1'; b.dataset.intro = state; b.dataset.introEnd = why; } catch {} }; // the control bar fades in only after an intro that played
const fail = (e) => { window.__fail = String((e && e.stack) || e); console.error(window.__fail); leaveLoading('done', 'error'); try { showErrorCard(failureDetail(e)); } catch {} };

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
  const ty = multi ? ext.minY + 0.3 * hgt : (ext.floorY ?? 0); // floorY: the box of a single upper floor on show starts at its own floor
  const dir = new THREE.Vector3(0.5, 0.7, 0.7).normalize();
  return { fov: 27, pos: [cx + dir.x * dist, ty + dir.y * dist, cz + dir.z * dist], target: [cx, ty, cz] };
}

(async () => { // async because a share link is unpacked by the browser's own inflate, which is asynchronous, before the page is built
try {
  const params = parseParams(location.hash, { language: navigator.language });
  if (!partsOf(params).controls) document.getElementById('ps-version')?.remove(); // ui=0 leaves the picture alone, the version mark of the built page (tools/version.mjs) too
  // A share link (share=, see share.js) carries a layout and maybe a plan of the visitor's own. It is unpacked first and read below with the same checks as a loaded file;
  // what cannot be read is left out, and startNotes says so once the page stands.
  const startNotes = []; // [kind, detail]
  let shared = null;
  if (params.share) { const r = await decodeShare(params.share); if (r.ok) shared = r; else startNotes.push(['link', r.error]); }
  if (!hasWebgl2(() => document.createElement('canvas'))) throw new Error(NO_WEBGL2);
  const dpr = window.devicePixelRatio || 1;
  const env = { cores: navigator.hardwareConcurrency, touch: navigator.maxTouchPoints > 0, width: window.innerWidth, height: window.innerHeight, memory: navigator.deviceMemory };
  const S = startState(params), parts = partsOf(params); // what the controls show; which parts of the page are built (ui=0, btn=0, edit=1)
  const T = (pl, en) => (S.lang === 'pl' ? pl : en);
  try { document.getElementById('ps-loading')?.setAttribute('aria-label', T('Wczytywanie', 'Loading')); } catch {}
  // The intro (see the block before the loop): while it is asked for, the pieces stay objects of their own (introHold) and the camera may turn without the walls being cut again for each view; the scene is put in its usual state when it ends.
  const introAsk = introWanted({ ...params, intro: params.intro && !params.walk }, { reducedMotion: !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) });
  let introHold = introAsk.run, intro = null;
  const introSize = [window.innerWidth, window.innerHeight], introSized = (w, h) => Math.abs(w - introSize[0]) > 1 || Math.abs(h - introSize[1]) > introSize[1] * 0.15; // whether the window is no longer the one the intro was made for
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
  let linkPlan = null; // the plan of the visitor's own that a link made here carries (null: an example plan, which the link names); normalized, as the validator gave it
  if (shared?.plan) {
    try { const rp = readPlanText(JSON.stringify(shared.plan), S.lang); if (rp.ok) linkPlan = rp.plan; else startNotes.push(['plan', rp.message]); } catch { startNotes.push(['plan', '']); }
  }
  const choice = planChoice(params, window.__plan);
  // The plan the page opens with, analysed and built. The plan of a link is built under a guard: readPlanText accepted it, but if it cannot be built after all the page opens with the example plan and says so.
  const openWith = (p) => {
    const q = JSON.parse(JSON.stringify(p));
    for (const lv of q.levels) lv.furniture = []; // the plan brings no furniture: the layout engine furnishes it
    const r = analyzePlan(q);
    return { plan: q, res: r, model: buildModel(modelOf(r)) };
  };
  let opened = null;
  if (linkPlan) {
    try { opened = openWith(linkPlan); S.plan = null; /* no example button is pressed for a plan that came in a link */ } catch { linkPlan = null; startNotes.push(['plan', '']); }
  }
  if (!opened) opened = openWith(choice === 'ext' ? window.__plan : choice === 'duplex-1' ? duplex : flat);
  const plan = opened.plan, res = opened.res; let model = opened.model; // model, ext, ps, stage, layout and focus are replaced when a plan is loaded
  let allExt = modelExtent(model); // the box of the whole model; ext below is the box of the floors on show, which is this very box while all of them are
  const useShell = shellOn(params); // the shell opens when its button is on (shell=0 takes it away), also while editing
  // The floors on show (floors.js): 'all' or the index of one level; flags says per level whether it is drawn. A plan with one level always shows all of it.
  let floor = resolveFloor(params.floor, model.levels.length), flags = visibleFlags(floor, model.levels.length);
  // What the camera and the walls look at for the floors in `fl`: ext (their box), frameExt (the box the camera and the stage keep in view: with the shell the closed and the
  // open model together) and framePts (with the shell the camera fits these points, the closed model and every wall lying flat, a tighter fit than the box).
  const framing = (m, full, fl) => {
    const e = visibleExtent(m, full, fl);
    if (!useShell) return { ext: e, frameExt: e, framePts: undefined };
    const walls = foldWalls(m).filter((f) => fl[f.level]);
    return { ext: e, frameExt: openExtent(m, e, walls), framePts: openPoints(m, e, walls) };
  };
  let stageExt = framing(model, allExt, visibleFlags(ALL, model.levels.length)).frameExt; // the stage (light, table, board) is made for the whole house and keeps that
  const firstFraming = framing(model, allExt, flags);
  let ext = firstFraming.ext, frameExt = firstFraming.frameExt, framePts = firstFraming.framePts;
  const makeScene = (m) => { const s = new PlanScene(m, 'textured'); s.setLabels(false); s.setArcs(false); s.setCeilings(false); return s; };
  let ps = makeScene(model);
  scene.add(ps.group);
  let shell = useShell ? createOpenShell(ps, model) : null, shellTarget = 0, shellRaf = 0, shellLast = 0; // shell: the hinges of the outer walls (null without the shell); shellTarget: 1 opening or open, 0 closing or closed

  // ---------- stage ----------
  // The card board hugs the closed model and follows the walls while the shell opens (look/board.js); the light and the table keep the bounds of the open extent.
  // Without outer walls that open (or without the shell) the board is the old one: the bounds with a margin.
  // Only the walls of the floors on show count for the board (a hidden floor's walls fall and lie flat out of sight).
  const boardOf = () => {
    if (!shell?.walls.length) return null;
    const st = shell.state(), keep = shell.walls.map((f, i) => i).filter((i) => flags[shell.walls[i].level]);
    return keep.length ? boardRect(ext, keep.map((i) => shell.walls[i]), keep.map((i) => st[i].deg)) : null;
  };
  let stage = createStage({ renderer, scene, bounds: stageExt, board: boardOf(), quality: level, preset: S.preset, t: S.t });
  stage.setLift(floorLift(model, flags)); // only an upper floor on show: the base of the house comes up under it
  // ---------- furniture: the engine lays the rooms out, compose builds the pieces (rebuilt when the quality changes) ----------
  let layout = autoFurnish(model, { seed: params.seed, allowedTypes: piecesImplemented() });
  if (shared?.layout) { // the layout of a share link: read like a pasted layout (parseLayout checks every piece against the plan); what cannot be used is left out
    try {
      const rl = parseLayout(JSON.stringify(shared.layout), model);
      const count = (lay) => (Array.isArray(lay?.levels) ? lay.levels : []).reduce((n, l) => n + (Array.isArray(l?.pieces) ? l.pieces.length : 0), 0);
      const dropped = rl.ok ? lostCount(rl.warnings) : 0; // what was not taken (a piece that merely sticks out of its room is kept and is no loss)
      if (rl.ok && !(count(shared.layout) > 0 && count(rl.layout) === 0)) { layout = rl.layout; if (dropped) startNotes.push(['skipped', dropped]); } // a link whose every piece was refused (the levels of another plan, say) keeps the automatic layout
      else startNotes.push(['layout', String(rl.errors?.[0] ?? '')]);
    } catch { startNotes.push(['layout', '']); } // whatever a link holds, the page opens
  }
  // the room that the close view (cam=close) looks at: the best furnished one of the floors on show
  const focusOf = () => (allShown(flags) ? focusRoom(model, layout) : focusRoom({ levels: model.levels.filter((_, i) => flags[i]) }, { levels: layout.levels.filter((lc) => flags[model.levels.findIndex((l) => l.id === lc.id)] !== false) }));
  let focus = focusOf();

  // ---------- camera: turns round the model; the outer walls that face it are cut low, the others stay tall ----------
  let W = window.innerWidth, H = window.innerHeight;
  const camera = new THREE.PerspectiveCamera(27, W / H, 0.5, 160);
  let pose = cameraFor(frameExt, W / H, params.cam, focus), cam = null;
  // Opened at another azimuth or tilt than the default view: the distance and the target are fitted to the model as seen from there (all storeys inside
  // the frame with a margin). The default view itself is left exactly as cameraFor gives it.
  const dh = stateFrom(pose.pos, pose.target), askAz = params.az ?? dh.azimuth, askPol = params.pol ?? dh.polar;
  let wantFit = params.cam !== 'close' && (useShell || Math.abs(wrapDegrees(askAz - dh.azimuth + 180) - 180) > 1 || Math.abs(askPol - dh.polar) > 1); // with the shell the view is always fitted to the closed and the open model
  let cover = 0; // the share of the window height that the bars at the bottom cover (stack.js): the model is kept above it
  // How far the centre of the projection is moved up (picture units): a fitted view (fitPose, and liftPose when it has to fit) looks at the middle of the model and
  // puts that point in the middle of the part above the bars, so that turning and zooming happen about what the person sees; a default view that already shows
  // the whole box above the bars is left as cameraFor gives it, with no lift.
  let viewLift = 0;
  // Where the view may go: with the shell the card board of the moment (it hugs the closed house and holds the walls as they fall) plus a hand's breadth, so that a
  // pinch or a drag over the empty ground cannot lose the model; without the shell the box of the whole model grown by PAN_GROW.
  const BOARD_GROW = 0.04;
  const limitsOf = () => { const r = boardOf(); return r ? [r, BOARD_GROW] : [frameExt, PAN_GROW]; };
  // The board changed (the shell moves): the view is brought back with it when it sat near the edge of a board that shrinks.
  function limitCamera() {
    if (!cam) return;
    const was = cam.target; cam.setLimits(...limitsOf()); const now = cam.target;
    if (now[0] !== was[0] || now[2] !== was[2]) { camera.position.set(...positionOf(cam.state, now)); camera.lookAt(...now); }
  }
  const fitPose = (p) => {
    const fit = fitView({ azimuth: askAz, polar: askPol }, frameExt, { fov: p.fov, aspect: W / H, bottom: cover, points: framePts, lift: true });
    return { ...p, target: fit.target, pos: positionOf({ azimuth: askAz, polar: askPol, distance: fit.distance }, fit.target), lifted: true };
  };
  // The default view stays exactly as cameraFor gives it while the whole box shows above the bars; when its lowest corner would sit behind them (a tall
  // model on a phone) it is fitted into the part of the picture above the bars, from the same side and tilt.
  const liftPose = (p) => {
    if (!(cover > 0) || params.cam === 'close') return p;
    const st = stateFrom(p.pos, p.target);
    if (lowestOnPicture(st, p.target, frameExt, p.fov) >= -1 + 2 * cover + 0.04) return p;
    const fit = fitView(st, frameExt, { fov: p.fov, aspect: W / H, bottom: cover, lift: true });
    return { ...p, target: fit.target, pos: positionOf({ azimuth: st.azimuth, polar: st.polar, distance: fit.distance }, fit.target), lifted: true };
  };
  const fitNow = () => wantFit || (!allShown(flags) && !(params.cam === 'close' && focus)); // a view of some floors only is fitted to them, except the close view, which looks at the room it found there
  if (fitNow()) pose = fitPose(pose);
  const home0 = stateFrom(pose.pos, pose.target);
  let current = { ...home0, azimuth: params.az ?? home0.azimuth, polar: params.pol ?? home0.polar }; // the view the controller reports
  let near = nearSides(current.azimuth);
  // Spacer (see its block below): walkMode is on from the first thing begin() does to the first thing end() does. Then the walls stand full height, every piece shows, and nothing may move the camera.
  let walkMode = false, spacer = null, spacerView = null, planAsk = false, onWalk = null; // planAsk: the box that asks for a plan is open; onWalk: set by the plain page, the card and the list of rooms go while Spacer runs
  // The walls are cut for the view (cutaway.js); the walls that fall in the open shell rise to full height as they start to turn (shell.heightFor). In Spacer they all stand full height: the cut belongs
  // to the view from above (the sun side still casts no shadow, so the sun reaches the rooms); setCut(null) takes the dark caps off the tops, which the ceilings close.
  const recut = () => { if (walkMode) { applyWallCut(ps, ext, near, { height: () => Infinity }); ps.setCut(null); } else applyWallCut(ps, ext, near, shell ? { height: shell.heightFor } : undefined); };
  recut();

  let onSettled = null; // set by the plain page (below): called after every settle, the card of a piece that the cutaway has taken away goes with it
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
  const showPieces = (pieces) => { for (const g of pieces.values()) g.visible = true; return 0; };
  // After the pieces or the set of near walls changed: hide what the cutaway would spoil, rebuild the merged meshes and the lights.
  function settle() {
    const open = !!shell?.active; // the shell is open or moving: the outer walls stand full height and the pieces hung on them turn with them
    furn.hidden = walkMode ? showPieces(furn.pieces) : cutawayPieces(furn.pieces, ext, viewOf(current), open ? {} : near); // hung pieces behind the low walls would float; in Spacer nothing is cut, so nothing hides
    const hung = open ? shell.adopt(furn.group, furn.pieces, (x, z) => wallCutHeight(x, z, ext, 0.3, near)) : (shell?.release(), null); // ids of the pieces that turn with a wall
    furn.lamps = emittersByLevel(furn.pieces); // the lamps of each level, before the pieces leave for the merged meshes; showFloors gives the stage those of the floors on show
    furn.cutOff = new Set(); for (const [id, g] of furn.pieces) if (!g.visible) furn.cutOff.add(id); // hidden by the cutaway
    if (furn.merged) { disposeComposed(furn.merged.group); furn.merged = null; }
    furn.own = new Set(); // the pieces that are objects of their own (not inside the merged meshes): showFloors keeps them in step with the floors on show
    const merging = params.merge && !introHold; // while the intro builds the flat the pieces stay objects of their own; they are merged when it ends
    if (merging && (params.edit || hung?.size)) { // the editor merges the pieces nobody moves (the one being dragged stays its own object); with the shell open the pieces that turn with a wall stay their own objects
      const keep = new Set([...(hung ?? []), ...live]); // the pieces that turn with a wall, and the one being dragged (it may be one of them)
      furn.cutHidden = furn.cutOff; // hidden by the cutaway: not pickable
      furn.merged = mergeByMaterial(furn, keep);
      for (const [id, g] of furn.pieces) if (!keep.has(id)) g.visible = false; // the merged meshes draw them
      furn.own = keep;
      furn.group.visible = true;
      scene.add(furn.merged.group);
    } else if (merging) { furn.merged = mergeByMaterial(furn); furn.group.visible = false; scene.add(furn.merged.group); } // one mesh per material: far fewer draw calls
    else furn.own = new Set(furn.pieces.keys()); // merge=0 (or the intro still plays): every piece is an object of its own
    showFloors();
    stage.refreshShadowCasters(scene);
    onSettled?.();
  }
  // The floors on show (flags): the other levels vanish with their walls, floors, stairs and window light (PlanScene.setLevelVisible), their pieces drawn as objects of
  // their own and the pieces hung on their walls (shell.setLevels), and their stretch of the merged meshes (the draw range only, nothing is merged again); the stage
  // gets the lamps of the floors on show only. Cheap enough for every tap of a floor button.
  function showFloors() {
    const all = allShown(flags), shown = new Set(model.levels.filter((_, i) => flags[i]).map((l) => l.id)); // with all floors on show nothing is left out, whatever a piece says about its level
    ps.setLevelVisible((i) => flags[i]);
    shell?.hidePatches(); // setLevelVisible lights the panes again: while the shell is not closed the window light stays off the floor
    shell?.setLevels(all ? null : flags);
    if (furn.merged) showMergedLevels(furn.merged.group, all ? null : shown);
    for (const id of furn.own) {
      const g = furn.pieces.get(id);
      if (g && !shell?.hostMatrix(id)) g.visible = (all || shown.has(g.userData.levelId)) && !furn.cutOff.has(id); // the pieces hung on a turned wall follow the shell
    }
    furn.emitters = [...furn.lamps].filter(([lv]) => all || shown.has(lv)).flatMap(([, list]) => list);
    stage.setEmitters(furn.emitters);
  }
  furnish();

  // The bars at the bottom (controls, edit bar) as a share of the window height on a narrow window (a phone), where they span the window; zero on a wide one,
  // where they are a small box in the middle, and when the picture is not the size of the window (a captured size).
  // With the shell the folded walls reach the bottom of the picture, so a wide window keeps the model above the bars too.
  const barsCover = () => (W === window.innerWidth && H === window.innerHeight && (useShell || isNarrow(W)) ? coverShare(['#ps-ui', '#ps-edit'].map((s) => document.querySelector(s)?.getBoundingClientRect() ?? null), H) : 0);
  function frameCamera() {
    if (walkMode) { camera.aspect = W / H; camera.updateProjectionMatrix(); stage.fitBackdrop(W / H); return; } // the eyes of Spacer are not framed above the bars: a window that changes shape changes the aspect only
    cover = barsCover();
    pose = cameraFor(frameExt, W / H, params.cam, focus);
    pose = fitNow() ? fitPose(pose) : liftPose(pose);
    viewLift = pose.lifted ? liftOf(cover) : 0; // only a fitted view has its target in the middle of the model and the centre of the projection over the free part
    if (cam) { cam.setLift(viewLift); cam.setLimits(...limitsOf()); cam.setTarget(pose.target); cam.rehome(stateFrom(pose.pos, pose.target)); current = cam.state; } // the pan stays, now from the new home
    const eye = cam ? cam.target : pose.target; // what the camera looks at: the home target and the pan
    camera.fov = pose.fov; camera.aspect = W / H; camera.near = nearPlane(current.distance);
    if (viewLift > 0) camera.setViewOffset(W, H, 0, (viewLift * H) / 2, W, H); else camera.clearViewOffset(); // the picture is the part of a taller one, so the camera's target lands in the middle of the part above the bars
    camera.position.set(...positionOf(current, eye)); camera.lookAt(...eye); camera.updateProjectionMatrix(); stage.fitBackdrop(W / H);
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
  function setQ(q) { intro?.skip('api'); S.q = q; level = resolveQuality(q, env); S.level = level; stage.setQuality(level); furnish(); post.setQuality(level); applyAll(); ui?.update(S); redraw(); }
  function setLang(l) { S.lang = l; ui?.update(S); editBar?.update({ lang: l }); panel?.setLang(l); dock?.setLang(l); spacerView?.setLang(l); }
  // the camera reports every change of the view; a change in the set of near edges re-cuts the walls and the pieces (not every frame of a turn)
  function onCamera(s) {
    if (walkMode) return; // the camera of Spacer is the eyes
    current = s;
    const eye = cam.target, nr = nearPlane(s.distance); // the home target and the pan; a close view needs a nearer plane
    if (Math.abs(nr - camera.near) > 1e-3) { camera.near = nr; camera.updateProjectionMatrix(); }
    camera.position.set(...positionOf(s, eye)); camera.lookAt(...eye);
    stage.rig.setFillBoost(fillBoost(s.azimuth));
    const n = nearSides(s.azimuth, near);
    if (!introHold && !sameSides(n, near)) { near = n; recut(); shell?.hidePatches(); settle(); } // the intro moves the camera over a build-up that is cut for the view it ends in; the cut is made again when it ends
    redraw();
  }
  let editBar = null, panel = null, dock = null, toggleRooms = null; // dock: the card of a tapped piece and the list of rooms (plain page); toggleRooms: the Rooms button of the bar
  const sayLine = (text, detail, ms) => (editBar ? editBar.say(text, ms, detail) : ui?.say(text, ms, detail)); // one short result line: above the edit bar, or above the controls on the plain page
  // The extra buttons of the control bar (btn=1): edit mode on or off (the page reloads with edit=1 added or removed, the mood, the time of day, the
  // quality and the language kept), and the picture of the current view as a PNG. The address follows the layout (addr below), so Done keeps every change; only a layout that
  // cannot go in the address still asks for a file and a second tap.
  let dirty = false, leaveWarned = false, leaveTimer = 0;
  async function toggleEdit() {
    const leaving = params.edit;
    const planOnly = !!linkPlan && !shareNow; // a plan of your own loaded here is in no address yet: it goes in too, or the reload would drop it
    if (planOnly || (leaving && (dirty || addr.pending))) addr.changed(); // the view of this moment goes into the address with the last change
    if (addr.pending) { await addr.flush(); if (!addr.pending) dirty = false; } // the last change goes into the address before the page reloads
    if (leaving) {
      const advice = leaveAdvice({ unsaved: dirty && !!session?.canUndo(), lost: keptLost, warned: leaveWarned });
      if (advice !== 'go') {
        leaveWarned = true; clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { leaveWarned = false; }, 6000);
        sayLine(advice === 'file'
          ? T('Nie udało się zostawić układu w adresie strony: zapisz go do pliku (Plik, Zapisz układ) albo dotknij jeszcze raz', 'The layout could not stay in the address of the page: save it to a file (File, Save layout) or tap again')
          : T(`Elementów poza pokojem: ${keptLost}. Po zakończeniu znikną: przesuń je do pokoju albo dotknij jeszcze raz`, `Items outside a room: ${keptLost}. They will be gone after Done: move them into a room or tap again`), '', 9000);
        return;
      }
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
  // ---------- the share link (share.js): the layout, the view and a plan of your own in one address ----------
  // buildLink() packs what the page shows now: { ok, url, hash, chars, compressed } or { ok: false, error }; url is the clean link to send, hash is the same view with the parameters of this
  // page kept (the address bar). shareLink() is the button: it makes the link, puts it in the address bar (so a reload, or Edit and Done, keeps the layout), copies it, and when the browser
  // will not copy shows it in a dialog. The link is in the part of the address after the #, which no server ever gets.
  let lastLink = null, planGen = 0, keptLost = 0, shareNow = params.share; // planGen: counts the plans built on this page (a layout made for an older plan is never written); keptLost: the pieces of the layout last written that a reader leaves out; shareNow: the share= that the page was built from or last wrote to the address
  // A link pasted into the address bar of a tab that already shows the page changes only the hash, and the page would keep what it shows: a share= that differs from shareNow loads again.
  addEventListener('hashchange', () => { const next = splitHash(location.hash).kv.share ?? null; if (next && next !== shareNow) location.reload(); });
  async function buildLink() {
    const gen = planGen; // read before any await: the plan may change while the link is built
    const text = session ? session.exportText() : serializeLayout(curLayout);
    const packed = text ? packLayout(text) : null;
    if (!packed) return { ok: false, error: 'layout' };
    const enc = await encodeShare({ plan: linkPlan ? planForLink(linkPlan) : null, layout: packed });
    if (!enc.ok) return { ok: false, error: enc.error };
    const view = { preset: S.preset, t: S.t, az: cam.state.azimuth, pol: cam.state.polar, floor, plan: S.plan, seed: params.seed };
    const url = `${location.href.split('#')[0]}#${setViewParams('', view, enc.value)}`;
    let lost = 0; // the pieces that the page of the receiver will not take (one that stands outside its room, say), counted the way the receiver counts them
    try { lost = lostCount(parseLayout(JSON.stringify(packed), model).warnings); } catch { lost = 0; }
    return { ok: true, url, hash: setViewParams(location.hash, view, enc.value), chars: url.length, compressed: enc.compressed, lost, gen };
  }
  async function shareLink() {
    const r = await buildLink();
    if (!r.ok) { sayLine(T('Nie udało się zrobić linku', 'Could not make the link'), r.error === 'too-long' ? T('Układ jest za duży na link: zapisz go do pliku', 'The layout is too large for a link: save it to a file') : r.error); return; }
    lastLink = r.url;
    try { history.replaceState(null, '', `#${r.hash}`); shareNow = splitHash(r.hash).kv.share ?? shareNow; } catch { /* an address that cannot change stays as it is */ }
    dirty = false; // the link holds the layout, like a saved file
    const note = [
      r.chars > SHARE_LONG ? T('Długi link: część komunikatorów może go uciąć, plik układu jest pewniejszy', 'A long link: some messengers may cut it, a layout file is safer') : '',
      r.lost ? T(`Elementów, które nie przejdą w linku (stoją poza pokojem): ${r.lost}`, `Items that will not come through the link (outside a room): ${r.lost}`) : '',
      location.protocol === 'file:' ? T('Strona jest otwarta z pliku, więc link zadziała tylko na tym komputerze', 'The page is open from a file, so the link works only on this computer') : '',
    ].filter(Boolean).join('. ');
    if (await copyText(window, r.url)) { sayLine(note ? `${T('Link skopiowany', 'Link copied')}. ${note}` : T('Link skopiowany', 'Link copied'), '', note ? 9000 : undefined); return; }
    if (!showLinkDialog(document, S.lang, r.url, { note })) sayLine(T('Nie udało się skopiować linku', 'Could not copy the link'));
  }
  // The address follows the layout. Edit and Done reload the page, and a reloaded page builds its layout from the share= of its address, so whatever is not there is lost (a changed colour,
  // say). Every change of the layout is written to the address a moment after it is made, without the clipboard and without a word to the visitor; Done writes the last one first
  // (toggleEdit), and Copy link copies the same address. A layout that cannot go in the address (too large) is the one case that still asks for a file.
  const addr = createAddressSync({
    build: buildLink,
    write: (r) => {
      if (r.gen !== planGen) return false; // built for a plan that is gone: the address already names the new one
      try { history.replaceState(null, '', `#${r.hash}`); } catch { return false; } // an address that cannot change keeps the old layout
      shareNow = splitHash(r.hash).kv.share ?? shareNow; keptLost = r.lost ?? 0;
      return true;
    },
  });
  // Loading a plan of your own (a button of the controls and an item of the File menu): the text goes through the reader and the validator, then the old
  // scene is released and the model, the automatic layout, the stage and the view are built again, without reloading the page. Nothing is stored.
  let onPlanSwapped = null;
  function applyPlan(next) {
    intro?.skip('api'); // the intro belongs to the first model only
    // everything new is built first, so a plan that cannot be built leaves the page as it was
    const built = buildPlanParts(next, params.seed, { analyzePlan, modelOf, buildModel, modelExtent, makeScene, autoFurnish, piecesImplemented });
    if (!built) return false;
    let nextShell = null, nextExt = built.ext, nextPts;
    try { // the frame and the shell of the new plan too, before the old scene goes
      if (useShell) { nextExt = openExtent(built.model, built.ext); nextPts = openPoints(built.model, built.ext); nextShell = createOpenShell(built.scene, built.model); }
    } catch { try { built.scene.dispose?.(); } catch { /* dropped anyway */ } return false; }
    spacer?.leave(); // the walk belongs to the plan it began in; it ends only once the new plan is sure to stand, and while the old scene is still there to hand back
    shell?.dispose();
    if (furn) { disposeComposed(furn.group, furn.merged?.group); furn = null; }
    scene.remove(ps.group); ps.dispose(); stage.dispose();
    model = built.model; allExt = built.ext; ext = built.ext; frameExt = nextExt; framePts = nextPts; stageExt = nextExt; ps = built.scene; layout = built.layout; curLayout = layout;
    floor = ALL; flags = visibleFlags(ALL, model.levels.length); focus = focusOf(); S.floor = ALL; S.levels = model.levels.map((l) => ({ id: l.id, name: l.name })); // a new plan starts with all its floors on show
    colorsKey = '{}'; shareNow = null; planGen += 1; keptLost = 0; // the new scene has no room colours (the layout of the old plan, and the share link that brought it, are gone with the plan)
    try { history.replaceState(null, '', `#${floorHash(withoutShare(location.hash), ALL)}`); } catch { /* an address that cannot change keeps its floor= */ }
    scene.add(ps.group);
    shell = nextShell; shellTarget = 0; S.shellOpen = false; ui?.update(S); // a new plan starts closed
    stage = createStage({ renderer, scene, bounds: stageExt, board: boardOf(), quality: level, preset: S.preset, t: S.t }); // the board of the new plan hugs the closed model
    wantFit = useShell && params.cam !== 'close'; near = nearSides(current.azimuth); recut();
    furnish(); // the pieces first: the camera below may re-cut the walls and the pieces
    frameCamera(); cam.reset(false); current = cam.state; // the reset takes the turn, the zoom and the pan of the old plan away
    applyAll(); stage.rig.setFillBoost(fillBoost(current.azimuth));
 onPlanSwapped?.(); redraw();
    return true;
  }
  function loadPlan() {
    // The box tells how to make a plan file from a picture (and copies the prompt for an AI chat), and keeps a plan that does not pass the validator open with the reason,
    // so the message can be copied and handed back to the chat; the text that passed is the one that is built.
    let checked = null;
    const check = (text) => { const r = readPlanText(text, S.lang); checked = { text, r }; return r.ok ? null : { message: r.message, detail: r.list || r.detail }; };
    planAsk = true; // Spacer will not begin while the box is open
    askForText(document, S.lang, { kind: 'plan', check, help: { prompt: promptFor(S.lang) } }).then((text) => {
      planAsk = false;
      if (text == null) return;
      const r = checked && checked.text === text ? checked.r : readPlanText(text, S.lang);
      if (!r.ok) { sayLine(r.message, r.detail); return; }
      const ok = applyPlan(r.plan);
      if (ok) { S.plan = null; linkPlan = r.plan; ui?.update(S); } // a plan from a file: no example button is pressed, and a link made now carries this plan
      sayLine(ok ? T('Wczytano plan', 'Plan loaded') : T('Nie udało się zbudować modelu z tego planu', 'Could not build a model from this plan'));
    });
  }
  // The example plans of the control bar: built in place like a loaded plan, then the address follows (plan= in the hash), so a reload or a shared address opens the same plan.
  const EXAMPLES = { 'flat-1': flat, 'duplex-1': duplex };
  function pickExample(name) {
    if (!EXAMPLES[name] || name === S.plan) return;
    if (!applyPlan(EXAMPLES[name])) { sayLine(T('Nie udało się zbudować modelu z tego planu', 'Could not build a model from this plan')); return; }
    S.plan = name; linkPlan = null; shareNow = null; params.plan = parsePlanParam(name); ui?.update(S);
    try { history.replaceState(null, '', `#${planHash(location.hash, name)}`); } catch { /* an address that cannot change keeps the old plan on reload */ }
  }
  // ---------- the floors on show (floors.js): the buttons of the control bar and floor= in the address ----------
  // A change draws the chosen floors only: the others vanish (PlanScene, the merged meshes by draw range, the lamps), the base of the house comes up under an upper floor
  // that stands alone, the board follows the walls of the floors on show, the walls are cut again when their ground differs, and the camera is fitted to them (the turn and the
  // tilt stay; the distance and the target are the fit of the floors on show). Nothing is built again unless the ground of the floors differs from that of the last choice.
  let onFloorChange = null; // set by the editing block: clears the selection that belongs to a floor that is no longer on show
  const shownLevel = (id) => flags[model.levels.findIndex((l) => l.id === id)] !== false; // whether the level with this id is on show (a level that is not known counts as shown)
  function setFloor(next) {
    intro?.skip('api');
    if (walkMode) return floor; // in Spacer the stairs change the floor, and every floor is on show
    const want = resolveFloor(next, model.levels.length);
    if (want === floor) return floor;
    floor = want; flags = visibleFlags(floor, model.levels.length); S.floor = floor;
    const f = framing(model, allExt, flags), reground = !sameGround(f.ext, ext);
    ext = f.ext; frameExt = f.frameExt; framePts = f.framePts; focus = focusOf();
    stage.setLift(floorLift(model, flags));
    onFloorChange?.();
    if (reground) { recut(); shell?.hidePatches(); settle(); } else { showFloors(); stage.refreshShadowCasters(scene); } // other ground: other near walls and hung pieces
    const rect = boardOf(); if (rect) stage.setBoard(rect);
    frameCamera(); ui?.update(S); redraw();
    try { history.replaceState(null, '', `#${floorHash(location.hash, floor)}`); } catch { /* an address that cannot change keeps its floor= */ }
    return floor;
  }
  // ---------- open shell: the clock runs towards its target and the walls follow it ----------
  // Every step puts the walls where the clock says, cuts them for the view and asks for a frame. The hung pieces and the merged furniture are settled
  // only when the shell leaves or reaches the closed state, and the shadow casters when it comes to rest, not on every step. The outline of a selected piece
  // (editing) follows the wall that holds the piece: onHinge is set by the editing block below.
  let onHinge = null;
  function shellPose(p) {
    const was = shell.active;
    shell.pose(p); recut(); shell.hidePatches();
    if (was !== shell.active) settle();
    const rect = boardOf(); if (rect) { stage.setBoard(rect); limitCamera(); } // the board holds the walls as they stand now, and the view may not leave it
    onHinge?.();
    redraw();
  }
  function shellTick(ts) {
    shellRaf = 0;
    if (!shell) return;
    const dt = shellLast ? Math.min(100, ts - shellLast) : 0; shellLast = ts;
    const next = stepClock(shell.clock, shellTarget, dt);
    shellPose(next);
    if (next !== shellTarget) shellRaf = requestAnimationFrame(shellTick); else { shellLast = 0; stage.refreshShadowCasters(scene); }
  }
  function shellGo(open) {
    if (!shell) return;
    intro?.skip('api');
    if (walkMode) return; // Spacer lives inside a closed house
    if (open && shell.clock === 0) shell.setOrder(viewOf(current)); // the order the walls start in is chosen when the opening begins
    shellTarget = open ? 1 : 0; S.shellOpen = !!open; ui?.update(S);
    if (!shellRaf) { shellLast = 0; shellRaf = requestAnimationFrame(shellTick); }
  }
  // The shell shuts at once, without the swing: Spacer lives inside a closed house.
  function shellSnap() {
    if (!shell) return;
    if (shellRaf) { cancelAnimationFrame(shellRaf); shellRaf = 0; }
    shellLast = 0; shellTarget = 0; S.shellOpen = false;
    if (shell.clock !== 0 || shell.active) shellPose(0);
  }
  S.floor = floor; S.levels = model.levels.map((l) => ({ id: l.id, name: l.name })); // the floor buttons (two or more levels)
  const ui = parts.controls ? createUI({ onPreset: (n) => { setPreset(n); if (walkMode) document.activeElement?.blur?.(); }, onTime: setTime, onQuality: setQ, onLang: setLang, onReset: () => cam?.reset(true), onEdit: toggleEdit, onSaveImage: saveImage, onShare: shareLink, onLoadPlan: loadPlan, onPlan: pickExample, onFloor: (k) => setFloor(k),
    onShell: () => { if (shell) shellGo(shellTarget !== 1); }, onRooms: () => toggleRooms?.(),
    onSpacer: () => { document.activeElement?.blur?.(); if (spacer?.active) spacer.leave(); else spacer?.enter(); } }, S) : null; // the button gives up the focus: a space on a button presses it, and the first space in Spacer must jump
  // The first one-finger turn on a touch screen says how to zoom and move (one short line, about 6 seconds, once per page load).
  let touchHinted = false;
  const onGesture = (g) => {
    ui?.hideHint();
    if (touchHinted || g?.kind !== 'orbit' || g.pointerType !== 'touch') return;
    touchHinted = true;
    sayLine(T('1 palec: obrót, 2 palce: zoom i ruch, 2 dotknięcia: wróć', '1 finger: turn, 2 fingers: zoom and move, double tap: back')); // the line goes away by itself after 6 seconds
  };
  cam = createCameraController({ element: renderer.domElement, home: home0, initial: { azimuth: params.az, polar: params.pol }, target: pose.target, limits: limitsOf()[0], grow: limitsOf()[1], lift: viewLift, fov: pose.fov, onChange: onCamera, onGesture });
  applyAll();
  // The room colours of the layout go to the scene; a plan without any colour is left exactly as it was drawn before. It runs once at the start (the layout of a share link may bring
  // colours, to the plain page as well as to the editor) and after every change of the layout in the editor.
  let colorsKey = '{}';
  function applyRoomColors() {
    if (typeof ps.setRoomColors !== 'function') return;
    const colors = {};
    for (const lc of curLayout.levels) if (lc.rooms && Object.keys(lc.rooms).length) colors[lc.id] = lc.rooms;
    const key = JSON.stringify(colors);
    if (key === colorsKey) return;
    colorsKey = key; ps.setRoomColors(colors, 'textured'); redraw();
  }
  applyRoomColors();
  // ---------- edit mode (edit=1): select a piece, drag it over the floor, turn, delete, undo and redo ----------
  let session = null;
  if (params.edit) {
    const levelBase = (id) => Number(model.levels.find((l) => l.id === id)?.elevation) || 0;
    const outline = createOutline(), outlineFrame = createOutlineFrame(outline); scene.add(outlineFrame.group);
    const roomOutline = createRoomOutline(); scene.add(roomOutline.group);
    // the outline of a piece that hangs on a wall that has turned (shell open) turns with the wall
    const followHinge = () => { const sel = session?.selected(); outlineFrame.follow(sel ? shell?.hostMatrix(sel.id) : null); };
    onHinge = followHinge;
    const dom = renderer.domElement;
    const polygonOf = (r) => model.levels.find((l) => l.id === r.level)?.rooms?.find((x) => x.id === r.id)?.polygon ?? null;
    // (applyRoomColors, which puts the room colours of the layout on the scene, is above: a layout from a share link brings colours to the plain page too)
    // the plan point and level under the centre of the view: where a new piece is put
    const viewPoint = () => {
      let bottom = H; // the picture above the bars (and above the sheet of the panel when it is open) is what the person looks at
      for (const sel of ['#ps-edit', '.psp-sheet']) { const r = document.querySelector(sel)?.getBoundingClientRect(); if (r && r.width > 0 && r.height > 0 && r.top > H * 0.3) bottom = Math.min(bottom, r.top); }
      const ray = cam.pointerToRay({ clientX: W / 2, clientY: bottom / 2 });
      for (const lv of [...model.levels].sort((p, q) => levelBase(q.id) - levelBase(p.id))) {
        if (!shownLevel(lv.id)) continue; // a floor that is not on show takes nothing
        const fh = floorHit(ray, levelBase(lv.id));
        if (fh && roomAt(model, lv.id, fh[0], fh[2])) return { level: lv.id, x: fh[0], y: fh[2] };
      }
      const top = [...model.levels].sort((p, q) => levelBase(q.id) - levelBase(p.id)).find((lv) => shownLevel(lv.id));
      return !allShown(flags) && top ? { level: top.id } : null; // with some floors hidden a new piece goes to the highest floor on show even when the view centre is over no room
    };
    // the room under a pointer on the floor (the highest level first), or null
    const roomHitAt = (e) => {
      const ray = cam.pointerToRay(e);
      for (const lv of [...model.levels].sort((p, q) => levelBase(q.id) - levelBase(p.id))) {
        if (!shownLevel(lv.id)) continue;
        const fh = floorHit(ray, levelBase(lv.id)), id = fh ? roomAt(model, lv.id, fh[0], fh[2]) : null;
        if (id) return { level: lv.id, id };
      }
      return null;
    };
    // a selection that belongs to a floor that is no longer on show goes
    onFloorChange = () => {
      const sel = session?.selected();
      if (sel && !shownLevel(session.levelOf(sel.id))) session.select(null);
      const room = session?.selectedRoom();
      if (room && !shownLevel(room.level)) session.selectRoom(null);
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
      followHinge();
      if (room && polygonOf(room)) roomOutline.set(polygonOf(room), levelBase(room.level)); else roomOutline.hide();
      editBar?.update({ selected: !!sel, canUndo: session.canUndo(), canRedo: session.canRedo() });
    }
    function onEdit(e) {
      curLayout = session.state.layout;
      if (e.type === 'structure' || e.type === 'dragend') { dirty = true; try { addr.changed(); } catch { /* the address is a convenience: the editor goes on without it */ } }
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
    if (parts.editBar) editBar = createEditBar({ onTurn: () => session.turn(90), onRemove: () => session.remove(), onUndo: () => session.undo(), onRedo: () => session.redo(), onAuto: () => session.reset(), onSaveImage: saveImage, onLoadPlan: loadPlan, onLink: shareLink, ...fileHandlers }, { lang: S.lang }, document, ui);
    if (parts.sheet) panel = createPanel({ doc: document, host: document.body, lang: S.lang, session });
    refreshEdit();
    onPlanSwapped = () => { // a new plan: a new editing session with nothing selected, no undo history and no unsaved changes
      gest = null; down.clear(); cam.enabled = true; dirty = false; leaveWarned = false; colorsKey = '{}';
      session = makeSession();
      if (panel) { panel.dispose(); panel = createPanel({ doc: document, host: document.body, lang: S.lang, session }); }
      refreshEdit();
    };

    // One finger or the mouse on a piece selects it and drags it; elsewhere the camera turns as before; a quick tap on nothing clears the selection.
    let gest = null, adopting = false;
    const PAD = { mouse: 0.02, touch: 0.06, pen: 0.04 }; // metres of margin round every piece when picking: a fingertip is wider than a mouse pointer
    // A piece that the cutaway hides cannot be picked. furn.cutHidden says which they are for the pieces that went into the merged meshes; a piece that hangs on a
    // turned wall stays its own object, so its own flag is the live one (it shows once its wall has risen). Such a piece is picked where the wall has put it: frameOf.
    const hiddenNow = (id) => !shownLevel(session.levelOf(id)) || (shell?.hostMatrix(id) ? !furn.pieces.get(id)?.visible : furn.cutHidden ? furn.cutHidden.has(id) : !furn.pieces.get(id)?.visible); // a piece on a floor that is not on show cannot be picked
    const hitAt = (e) => pickPiece(session.state.layout, cam.pointerToRay(e), { levelBase, pad: PAD[e.pointerType] ?? PAD.mouse, skip: hiddenNow, frameOf: (id) => shell?.hostMatrix(id) ?? null });
    // Where a pointer is on the surface a piece slides over (slidePoint in pick.js): the floor at the height of the piece, or, for a piece that hangs on an outer wall
    // that has turned, the inner face of that wall in the wall's closed place, so the piece moves along the wall wherever the wall lies. host: shell.hostOf(id) or null.
    const surfaceAt = slidePoint;
    const showPanel = (on) => { if (panel) panel.element.hidden = !on; };
    const down = new Map(); // the pointers that are down (id to pointer type): a second or a third finger belongs to the camera (zoom and move), never to a piece
    const slopOf = (e) => (e.pointerType === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH); // as in the camera: a tap may wander this far before it is a drag
    // A pointerup or pointercancel that never came (a system gesture, a switch to another app) would leave a finger in `down` for good, and no piece could be picked
    // again until a reload. A pointer of that kind going down as the first one, the window losing the focus or the page going to the background lets go of what is left
    // (a piece that was being dragged goes back).
    const releaseStale = (type) => {
      for (const [id, t] of down) if (type === undefined || t === type) down.delete(id);
      if (gest && !down.has(gest.pointerId)) { if (gest.dragging) session.cancelDrag(); if (gest.id) { cam.enabled = true; showPanel(true); } gest = null; }
    };
    addEventListener('blur', () => releaseStale());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseStale(); });
    dom.addEventListener('pointerdown', (e) => {
      if (adopting) return;
      if (e.pointerType === 'mouse' && (e.button !== 0 || e.shiftKey)) return; // the right and the middle button, and Shift with the left one, move the view
      if (e.isPrimary) releaseStale(e.pointerType);
      down.set(e.pointerId, e.pointerType);
      if (gest) { // a second finger: the piece goes back, the selection that the first finger made is taken back, and the camera takes over with both fingers
        const first = gest; gest = null;
        if (first.dragging) session.cancelDrag();
        if (first.id) {
          if (session.state.selection === first.id) session.restoreSelection(first.before); // the piece that was selected before, or the room (picking the piece cleared it)
          cam.enabled = true; showPanel(true);
          adopting = true; // the camera learns about the first finger too, so that the pinch starts at once
          try { dom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: first.pointerId, pointerType: e.pointerType, clientX: first.lastX, clientY: first.lastY, button: 0, buttons: 1, isPrimary: true, bubbles: true, cancelable: true })); } catch {}
          adopting = false;
        }
        return;
      }
      if (down.size > 1) return; // a finger that comes while others are down: the camera has it
      const hit = hitAt(e), base = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, t0: performance.now(), moved: 0, id: null, dragging: false };
      if (!hit) { gest = { ...base, room: roomHitAt(e) }; return; }
      const piece = session.pieceById(hit.id), host = shell?.hostOf(hit.id) ?? null, at = surfaceAt(cam.pointerToRay(e), host, levelBase(hit.level) + piece.elev);
      gest = { ...base, id: hit.id, level: hit.level, before: session.selectionNow(), base: levelBase(hit.level) + piece.elev, wall: host?.wall ?? null, off: at ? [piece.x - at[0], piece.y - at[1]] : [0, 0] };
      cam.enabled = false; session.select(hit.id);
      try { dom.setPointerCapture(e.pointerId); } catch {}
    }, true);
    dom.addEventListener('pointermove', (e) => {
      const g = gest; if (!g || !g.id || g.pointerId !== e.pointerId) return;
      g.lastX = e.clientX; g.lastY = e.clientY;
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
      if (g.moved < slopOf(e)) return; // a tap is not a drag
      if (!g.dragging) { g.dragging = session.beginDrag(g.id); if (!g.dragging) return; showPanel(false); }
      const ray = cam.pointerToRay(e), host = shell?.hostOf(g.id) ?? null;
      if ((host?.wall ?? null) !== g.wall) return; // another wall holds the piece than at the grab (the shell opened or closed meanwhile): the grab no longer fits
      const at = surfaceAt(ray, host, g.base);
      if (!at) return;
      session.dragTo(at[0] + g.off[0], at[1] + g.off[1]);
      // a prop that leaves a table (or lands on one) changes height: the plane that the finger points at follows it, so it stays under the finger
      const nb = levelBase(g.level) + (session.pieceById(g.id)?.elev ?? 0);
      if (Math.abs(nb - g.base) > 1e-6) { g.base = nb; const a2 = surfaceAt(ray, host, nb); if (a2) session.dragTo(a2[0] + g.off[0], a2[1] + g.off[1]); }
    }, true);
    const finish = (e, cancelled) => {
      down.delete(e.pointerId);
      const g = gest; if (!g || g.pointerId !== e.pointerId) return;
      gest = null;
      if (g.id) {
        cam.enabled = true;
        try { dom.releasePointerCapture(e.pointerId); } catch {}
        if (g.dragging) { if (cancelled) session.cancelDrag(); else session.endDrag(); }
        if (g.dragging && !cancelled && window.innerWidth <= 760) panel?.collapse?.(); // on a phone the sheet folds to its header after a drop
        showPanel(true);
      } else if (!cancelled && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < slopOf(e) && performance.now() - g.t0 < 350) {
        if (g.room) session.selectRoom(g.room.level, g.room.id); else session.select(null); // a tap on a floor picks the room, a tap beside the plan clears
      }
    };
    dom.addEventListener('pointerup', (e) => finish(e, false), true);
    dom.addEventListener('pointercancel', (e) => finish(e, true), true);
    // The click of a touch tap goes to whatever is under the finger when it lifts. A tap on a piece (or on a floor) selects at once and the sheet of the panel opens over
    // that part of the picture, so the click can land on a colour swatch, a size field or the header of a sheet that was not under the finger when it went down. A click that
    // follows the lift of a pointer that went down on the picture, close to where it lifted, and is not for the picture itself, is dropped (strayClick in shell.js).
    let lift = null;
    dom.addEventListener('pointerup', (e) => { lift = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }; }, true);
    addEventListener('click', (e) => {
      if (!strayClick(lift, { x: e.clientX, y: e.clientY, onPicture: e.target === dom }, performance.now())) return;
      lift = null; e.stopPropagation(); e.preventDefault();
    }, true);
    // keys (not while a form field has the focus): Delete or Backspace removes, R turns, Ctrl or Cmd + Z undoes, with Shift (or Ctrl + Y) redoes, Escape clears the selection.
    // This listener comes before the shell's (onShellKey below): an Escape that cleared a selection is marked as taken, so the open shell stays open until the next one.
    addEventListener('keydown', (e) => {
      if (isFormTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey, k = String(e.key).toLowerCase();
      if (mod && k === 'z') { if (e.shiftKey) session.redo(); else session.undo(); e.preventDefault(); }
      else if (mod && k === 'y') { session.redo(); e.preventDefault(); }
      else if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) { session.remove(); e.preventDefault(); }
      else if (!mod && !e.altKey && k === 'r') session.turn(90);
      else if (e.key === 'Escape' && (session.selected() || session.selectedRoom())) { session.select(null); e.preventDefault(); }
    });
    // for test tools: the piece's place in client pixels, the number of pieces, the selected id
    const v3 = new THREE.Vector3();
    window.__edit = {
      get session() { return session; },
      count: () => session.state.layout.levels.reduce((n, lv) => n + lv.pieces.length, 0),
      hit: (x, y, type = 'touch') => hitAt({ clientX: x, clientY: y, pointerType: type })?.id ?? null, // the piece under a client point (with the margin of a fingertip unless type is 'mouse'), or null
      selectedId: () => session.state.selection,
      // Would the piece `id` stand clean at plan point (x, z) on its level? Nothing changes and nothing is dragged: { ok, problems } from the editor rules
      // (overlap, outside the room, door zone, stair, floating prop count against it).
      canPlace: (id, x, z) => placeCheck(model, session.state.layout, id, x, z),
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
      // where the piece is drawn now (upper part of its box), in client pixels: from its own group, so a piece that hangs on a turned wall is found where the wall has put it
      screenOf(id) {
        const f = session.pieceById(id); if (!f) return null;
        camera.updateMatrixWorld(true);
        const g = furn.pieces.get(id);
        if (g) { g.updateWorldMatrix(true, false); v3.set(0, f.size[2] * 0.75, 0).applyMatrix4(g.matrixWorld); }
        else v3.set(f.x, levelBase(session.levelOf(id)) + f.elev + f.size[2] * 0.75, f.y);
        v3.project(camera);
        const r = dom.getBoundingClientRect();
        return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
      },
      // How far the selection outline is from the piece it outlines: the largest distance in client pixels between the eight corners of the piece's box as drawn
      // (its own group) and the same corners of the outline (its group, inside the frame that turns it with a wall). null when the piece is not the selected one.
      outlineGap(id) {
        const f = session.pieceById(id), g = furn.pieces.get(id);
        if (!f || !g || !outline.visible || session.state.selection !== id) return null;
        camera.updateMatrixWorld(true); g.updateWorldMatrix(true, false); outline.group.updateWorldMatrix(true, false);
        const r = dom.getBoundingClientRect(), [w, d, h] = f.size, a = new THREE.Vector3(), b = new THREE.Vector3();
        let worst = 0;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, h]) {
          a.set((sx * w) / 2, y, (sz * d) / 2).applyMatrix4(g.matrixWorld).project(camera);
          b.set((sx * w) / 2, y, (sz * d) / 2).applyMatrix4(outline.group.matrixWorld).project(camera);
          worst = Math.max(worst, Math.hypot((a.x - b.x) * 0.5 * r.width, (a.y - b.y) * 0.5 * r.height));
        }
        return +worst.toFixed(2);
      },
      // the point `d` metres along the wall from the piece, as drawn now, in client pixels (the width axis of a hung piece runs along its wall): where a finger goes to slide it
      alongWall(id, d) {
        const f = session.pieceById(id), g = furn.pieces.get(id); if (!f || !g) return null;
        camera.updateMatrixWorld(true); g.updateWorldMatrix(true, false);
        v3.set(d, f.size[2] * 0.75, 0).applyMatrix4(g.matrixWorld).project(camera);
        const r = dom.getBoundingClientRect();
        return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
      },
      // whether the piece is drawn as an object of its own (not inside the merged meshes): true for the piece being dragged and for pieces that hang on a turned wall
      own: (id) => !!furn.pieces.get(id)?.visible,
      // the id of the wall that holds the piece while the shell is open (null: none), and the matrix that turns it
      hostOf: (id) => { const h = shell?.hostOf(id); return h ? { wall: h.wall, matrix: [...h.matrix] } : null; },
    };
  }
  // ---------- the plain page: a tap on a piece shows its card, and the list of rooms (dock.js, info.js) ----------
  // Only without editing (the editor has its own sheet) and with the controls (ui=0 leaves the picture alone). A tap is what the camera calls a tap: one finger or the left
  // mouse button, moving less than the slop and lifting within 350 ms; the second tap of a double tap (the view goes back) changes nothing here. The piece under the tap is
  // found the way the editor finds it (pick.js) and left out when the cutaway hides it or its floor is not on show; it gets the copper outline and the card. A tap on anything
  // else, the close button of the card or Escape takes both away. The list shows the rooms of the floors on show; a row puts the outline of that room on its floor.
  if (parts.controls && !params.edit) {
    const dom = renderer.domElement, baseOf = (id) => Number(model.levels.find((l) => l.id === id)?.elevation) || 0;
    const outline = createOutline(), outlineFrame = createOutlineFrame(outline), roomOutline = createRoomOutline();
    scene.add(outlineFrame.group); scene.add(roomOutline.group);
    const PAD = { mouse: 0.02, touch: 0.06, pen: 0.04 }; // metres of margin round every piece when picking: a fingertip is wider than a mouse pointer
    let shownPiece = null; // { id, level } of the piece that has the card
    const followHinge = () => outlineFrame.follow(shownPiece ? shell?.hostMatrix(shownPiece.id) ?? null : null); // a piece that hangs on a turned wall (shell open) takes its outline with it
    onHinge = followHinge;
    const levelIds = () => { const m = new Map(); for (const lc of curLayout.levels) for (const p of lc.pieces) m.set(p.id, lc.id); return m; };
    const pieceOf = (id) => { for (const lc of curLayout.levels) { const p = lc.pieces.find((q) => q.id === id); if (p) return p; } return null; };
    // hidden pieces cannot be tapped: the ones the cutaway hides (furn.cutOff, also for the merged ones), those of a floor that is not on show, and a piece that hangs on a turned wall is as visible as its own object
    const hidden = (lv) => (id) => !shownLevel(lv.get(id)) || (shell?.hostMatrix(id) ? !furn.pieces.get(id)?.visible : furn.cutOff.has(id));
    const hitAt = (e) => pickPiece(curLayout, cam.pointerToRay(e), { levelBase: baseOf, pad: PAD[e.pointerType] ?? PAD.mouse, skip: hidden(levelIds()), frameOf: (id) => shell?.hostMatrix(id) ?? null });
    function closeCard() {
      if (!shownPiece) return;
      shownPiece = null; dock.hideCard(); outline.hide(); followHinge(); redraw();
    }
    function openCard(id, levelId) {
      const piece = pieceOf(id), info = piece ? pieceInfo(piece, levelId, model) : null;
      if (!info) { closeCard(); return; }
      shownPiece = { id, level: levelId };
      dock.showCard(info); ui?.hideHint();
      outline.set(piece, baseOf(levelId), 'ok'); followHinge(); redraw();
    }
    const clearRoom = () => { dock.setPickedRoom(null); roomOutline.hide(); redraw(); };
    function pickRoom(ref) {
      const room = ref ? model.levels.find((l) => l.id === ref.level)?.rooms?.find((r) => r.id === ref.id) : null;
      if (room && Array.isArray(room.polygon)) roomOutline.set(room.polygon, baseOf(ref.level)); else roomOutline.hide();
      redraw();
    }
    // the list is worked out while it is open (a plan of 500 rooms takes a moment to add up), and when it opens after a change under it (a floor, a plan)
    let roomsStale = true;
    const refreshRooms = () => { if (S.rooms) { dock.setRooms(roomsData(model, flags)); roomsStale = false; } else roomsStale = true; };
    dock = createDock({ doc: document, host: document.body, lang: S.lang, onCardClose: closeCard, onRoomsClose: () => toggleRooms(), onRoomPick: pickRoom });
    refreshRooms(); dock.setRoomsOpen(!!S.rooms);
    toggleRooms = () => { S.rooms = !S.rooms; if (S.rooms && roomsStale) refreshRooms(); dock.setRoomsOpen(S.rooms); if (!S.rooms) clearRoom(); ui?.update(S); };

    // taps on the picture: the camera keeps its own gestures; this only watches for a tap
    const down = new Set(); let tapG = null, lastTap = null, lift = null; // lift: where and when a tap that left a card on show lifted (see the click listener below)
    const slopOf = (e) => (e.pointerType === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH);
    dom.addEventListener('pointerdown', (e) => {
      if (e.isPrimary) down.clear(); // a pointerup that never came (a system gesture) must not make every later tap a two-finger one
      if (e.pointerType === 'mouse' && (e.button !== 0 || e.shiftKey)) { tapG = null; return; } // the right and the middle button, and Shift with the left one, move the view
      down.add(e.pointerId);
      tapG = down.size > 1 ? null : { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0 };
    });
    dom.addEventListener('pointermove', (e) => { if (tapG && tapG.id === e.pointerId) tapG.moved = Math.max(tapG.moved, Math.hypot(e.clientX - tapG.x0, e.clientY - tapG.y0)); });
    const lifted = (e, cancelled) => {
      down.delete(e.pointerId);
      const g = tapG; if (!g || g.id !== e.pointerId) return;
      tapG = null;
      if (walkMode) return; // the camera that picks is the one of the view from above: in Spacer a tap is a step or a look
      const t = performance.now();
      if (cancelled || g.moved >= slopOf(e) || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) >= slopOf(e) || t - g.t0 >= 350) return;
      if (lastTap && t - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { lastTap = null; return; } // the second tap of a double tap: the view goes back (camera.js)
      lastTap = { t, x: e.clientX, y: e.clientY };
      const hit = hitAt(e);
      if (hit) openCard(hit.id, hit.level); else closeCard();
      lift = shownPiece ? { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType } : null;
    };
    dom.addEventListener('pointerup', (e) => lifted(e, false));
    dom.addEventListener('pointercancel', (e) => lifted(e, true));
    addEventListener('blur', () => { down.clear(); tapG = null; });
    // the click of a touch tap goes to whatever is under the finger when it lifts; the card that a tap opens must not catch it (strayClick in shell.js). Only a tap that left a
    // card on show is marked: the end of a drag or a pinch opens nothing, and a button pressed a moment later is pressed
    addEventListener('click', (e) => {
      if (!strayClick(lift, { x: e.clientX, y: e.clientY, onPicture: e.target === dom }, performance.now())) return;
      lift = null; e.stopPropagation(); e.preventDefault();
    }, true);
    // Escape takes the card away, or else the outline of a room; this listener comes before the shell's, and an Escape that did something is marked as taken, so the open shell stays open
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isFormTarget(e.target)) return;
      if (shownPiece) { closeCard(); e.preventDefault(); } else if (dock.picked) { clearRoom(); e.preventDefault(); }
    });
    // what changes under the card and the list
    onFloorChange = () => {
      if (shownPiece && !shownLevel(shownPiece.level)) closeCard();
      if (dock.picked && !shownLevel(dock.picked.level)) clearRoom();
      refreshRooms();
    };
    onPlanSwapped = () => { closeCard(); clearRoom(); refreshRooms(); };
    onWalk = (on) => { if (on) { closeCard(); if (S.rooms) toggleRooms(); } }; // Spacer shows no card and no list
    onSettled = () => { if (shownPiece && hidden(levelIds())(shownPiece.id)) closeCard(); }; // the cutaway took the piece away, so does the card
    // for test tools: the card, the list, the piece under a client point, and where a piece is drawn (client pixels)
    const v3 = new THREE.Vector3();
    window.__info = {
      cardOpen: () => dock.cardOpen, card: () => dock.card, shown: () => (shownPiece ? { ...shownPiece } : null), roomsOpen: () => dock.roomsOpen, pickedRoom: () => dock.picked,
      outlineOn: () => outline.visible, roomOutlineOn: () => roomOutline.visible,
      hit: (x, y, type = 'touch') => hitAt({ clientX: x, clientY: y, pointerType: type })?.id ?? null,
      pieces: () => curLayout.levels.flatMap((lc) => lc.pieces.map((p) => ({ id: p.id, type: p.type, level: lc.id, room: p.room, size: [...p.size], hidden: hidden(levelIds())(p.id) }))),
      screenOf(id) {
        const p = pieceOf(id), lv = levelIds().get(id); if (!p) return null;
        camera.updateMatrixWorld(true);
        const g = furn.pieces.get(id);
        if (g && shell?.hostMatrix(id)) { g.updateWorldMatrix(true, false); v3.set(0, p.size[2] * 0.75, 0).applyMatrix4(g.matrixWorld); }
        else v3.set(p.x, baseOf(lv) + p.elev + p.size[2] * 0.75, p.y);
        v3.project(camera);
        const r = dom.getBoundingClientRect();
        return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
      },
    };
  }
  // The bars exist now: the view is framed again above them, and again whenever they change size (a wrapped row, another language, a turned screen).
  let coverSeen = 0;
  // The edit bar publishes the height of what is stacked at the bottom as --ps-stack-h while editing; on the plain page the control bar does, so that the card and the list of the
  // dock end above it (a small phone has no room for both the dock and the bar otherwise).
  function publishStack() {
    const top = ui?.root?.getBoundingClientRect?.().top;
    if (!params.edit && Number.isFinite(top) && innerHeight > 0 && top > 0) document.documentElement.style.setProperty('--ps-stack-h', `${Math.round(innerHeight - top)}px`);
  }
  function restack() {
    publishStack();
    const c = barsCover(); if (Math.abs(c - coverSeen) < 0.002) return;
    coverSeen = c; frameCamera(); redraw();
  }
  restack();
  if (typeof ResizeObserver === 'function') { const watch = new ResizeObserver(() => restack()); for (const s of ['#ps-ui', '#ps-edit']) { const el = document.querySelector(s); if (el) watch.observe(el); } }
  // Arrow keys turn the model (see camera.js); Shift + left or right moves the time of day, 1 to 3 pick a mood (never while a form field has the focus).
  addEventListener('keydown', (e) => {
    if (isFormTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return; // typing a size in the panel must not change the mood or the time
    if (!walkMode && e.shiftKey && e.key === 'ArrowRight') setTime(S.t + 0.02); else if (!walkMode && e.shiftKey && e.key === 'ArrowLeft') setTime(S.t - 0.02); // in Spacer Shift is the run
    else if (['1', '2', '3'].includes(e.key)) setPreset(['clear', 'amber', 'lamplit'][Number(e.key) - 1]); // the keys follow the buttons: Day, Sunset, Night
  });
  // Open shell: Space opens or closes it, Escape closes it (shellKey in shell.js decides: a held key counts once, a form field keeps both keys, a button or a link keeps Space).
  const onShellKey = (e) => {
    if (walkMode) return; // Space is the jump and Escape the way out
    const act = shellKey(e, shellTarget === 1);
    if (!act) return;
    if (e.key !== 'Escape') e.preventDefault(); // Space must not scroll the page
    shellGo(act === 'open');
  };
  if (useShell) addEventListener('keydown', onShellKey);
  // A window that is turned or resized ends the intro (the view it was to end in belongs to the old window); a phone fires resize events of its own at the start and when its address bar moves, which change the
  // height a little and the width not at all, and those leave it alone.
  addEventListener('resize', () => { if (intro?.active && introSized(window.innerWidth, window.innerHeight)) intro.skip('resize'); W = window.innerWidth; H = window.innerHeight; frameCamera(); coverSeen = cover; post.resize(W, H); redraw(); });
  window.__planInfo = () => ({ pieces: furn.pieces.size, levels: model.levels.length, rooms: model.levels.reduce((n, l) => n + (l.rooms?.length ?? 0), 0), extent: [ext.minX, ext.maxX, ext.minZ, ext.maxZ].map((v) => +v.toFixed(2)),
    floor, visibleLevels: visibleIndices(floor, model.levels.length) }); // for test tools; floor: 'all' or the index of the level on show
  // For test tools: the floors on show. get() is 'all' or the index of one level, set(v) takes the same (a number, a numeric string or 'all'; anything else counts as all) and
  // returns the choice now, count is the number of levels, visible() the indices of the levels drawn, lift() how far the base of the house has come up (metres).
  window.__floors = { get: () => floor, set: (v) => setFloor(parseFloorParam(String(v))), get count() { return model.levels.length; }, visible: () => visibleIndices(floor, model.levels.length), lift: () => stage.lift() };
  window.__setT = setTime; window.__setPreset = setPreset; window.__setQuality = setQ;
  // For test tools: the share link. build() makes the link of the page as it stands ({ ok, url, hash, chars, compressed }), copy() is the button, last() the link that the button made last,
  // notes what a link could not give and said what the page told the visitor about it (once the first frame was drawn).
  window.__share = { build: buildLink, copy: shareLink, last: () => lastLink, get notes() { return startNotes.map((n) => n.slice()); }, get said() { return startNoteText; } };
  // For test tools: the view (turn, tilt, distance and its default), the pan in metres, what the camera looks at, the ground point under a client point, and the plane of the near cut
  window.__camera = { get azimuth() { return cam.state.azimuth; }, get polar() { return cam.state.polar; }, get distance() { return cam.state.distance; }, get base() { return cam.state.base; }, get pan() { return cam.pan; }, get target() { return cam.target; }, get lift() { return cam.lift; },
    get near() { return sidesKey(near); }, get nearPlane() { return camera.near; }, get busy() { return cam.busy; }, groundAt: (x, y) => cam.groundAt(x, y), set: (azimuth, polar) => { intro?.skip('api'); cam.set({ azimuth, polar }); }, reset: () => { intro?.skip('api'); cam.reset(false); } };
  // For test tools and the film (there while the shell is built, also while editing): the clock (0 closed, 1 open), the target and the mode, open/close/toggle like the button, the pose of every wall,
  // the camera as three.js holds it, and seek(p) which puts the walls at clock p without any transition and resolves after the frame that shows it.
  if (useShell) {
    window.__shell = {
      get clock() { return shell.clock; }, get target() { return shellTarget; }, get mode() { return modeOf(shell.clock, shellTarget); }, get walls() { return shell.walls.length; },
      open: () => shellGo(true), close: () => shellGo(false), toggle: () => shellGo(shellTarget !== 1),
      state: () => shell.state(),
      patchesLit: () => { const a = ps.sunPatch?.geometry.attributes.aInfo, n = ps.sunPatch?.userData.patches ?? 0; let k = 0; for (let i = 0; i < n; i++) if (a.getW(i * 4) === 1) k++; return k; }, // panes whose window light lies on the floor now
      extent: () => ({ minX: frameExt.minX, maxX: frameExt.maxX, minZ: frameExt.minZ, maxZ: frameExt.maxZ }), // the closed model with every wall lying flat (the board of the open shell holds it)
      view: () => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect, target: cam.target, lift: cam.lift }), // lift: the centre of the projection sits this far above the middle of the picture (half pictures)
      // where the corners of the closed model and of every wall lying flat land in the picture (px), and the top of the control bar: the fit check
      project() {
        camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
        const v = new THREE.Vector3(), pts = [], add = (x, y, z, kind) => { v.set(x, y, z).project(camera); pts.push({ kind, x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H }); };
        for (const x of [ext.minX, ext.maxX]) for (const y of [ext.minY, ext.maxY]) for (const z of [ext.minZ, ext.maxZ]) add(x, y, z, 'closed');
        for (const f of shell.walls) if (flags[f.level]) for (const [x, z] of flatFootprint(f)) add(x, ps.levelGroups[f.level].position.y + f.y, z, 'flat'); // the walls of the floors on show
        return { w: W, h: H, pts, barTop: document.querySelector('#ps-ui')?.getBoundingClientRect().top ?? null };
      },
      // how well the sun's shadow frustum holds the closed model and every wall lying flat: worst is the largest share of the half width, the half height
      // or the depth range that a corner uses (1 or less: inside)
      shadow() {
        const sun = stage.rig.sun, sc = sun.shadow.camera, v = new THREE.Vector3();
        sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true); sun.shadow.updateMatrices(sun); sc.updateMatrixWorld(true);
        let worst = 0;
        const check = (x, y, z) => { v.set(x, y, z).applyMatrix4(sc.matrixWorldInverse); const d = -v.z; worst = Math.max(worst, Math.abs(v.x) / sc.right, Math.abs(v.y) / sc.top, (d - sc.near) / (sc.far - sc.near) > 1 ? 9 : 0, d < sc.near ? 9 : 0); };
        for (const x of [ext.minX, ext.maxX]) for (const y of [ext.minY, ext.maxY]) for (const z of [ext.minZ, ext.maxZ]) check(x, y, z);
        for (const f of shell.walls) if (flags[f.level]) for (const [x, z] of flatFootprint(f)) { const y = ps.levelGroups[f.level].position.y + f.y; check(x, y, z); check(x, y - 0.25, z); }
        return { half: [sc.right, sc.top], near: sc.near, far: sc.far, worst: +worst.toFixed(4) };
      },
      seek: (p) => new Promise((resolve) => {
        intro?.skip('api');
        if (shellRaf) { cancelAnimationFrame(shellRaf); shellRaf = 0; }
        const c = Math.min(1, Math.max(0, Number(p) || 0));
        if (c > 0 && shell.clock === 0) shell.setOrder(viewOf(current));
        shellTarget = c >= 1 ? 1 : c <= 0 ? 0 : shellTarget; S.shellOpen = shellTarget === 1; ui?.update(S);
        const before = loop.drawn;
        shellPose(c);
        if (c <= 0 || c >= 1) stage.refreshShadowCasters(scene);
        const wait = () => { if (loop.drawn > before) resolve({ clock: shell.clock, drawCalls: renderer.info.render.calls }); else requestAnimationFrame(wait); };
        requestAnimationFrame(wait);
      }),
    };
  }

  // ---------- Spacer: the flat at eye height (spacerrun.js has the run, spacerview.js the map and the hints) ----------
  // The run is handed what it may touch of the page. begin() puts the eyes on: the card and the list of rooms go, the shell shuts at once, every floor shows and the base of the house comes down,
  // the orbit controller stops, the picture is a perspective of 70 degrees with a near plane of 5 cm, the walls stand full height and the ceilings close the rooms (the sun still reaches the floor
  // through the windows: floors and ceilings cast no shadow), every piece shows, the table and the card board are taken away (their lights stay) and the blur of the top and the bottom of the frame
  // goes. end() gives all of it back from what snapshot() took: the orbit view, the floors, the mood and the time of day (the moods can be changed while walking), the list of rooms. Nothing in the
  // address changes. walkMode (declared with the cut) tells frameCamera, onCamera, recut and settle to leave the eyes alone.
  const EYES = { fov: 70, near: 0.05 };
  const touchDevice = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
  spacer = createSpacerRun({
    win: window, doc: document, canvas: renderer.domElement,
    host: {
      model: () => model,
      refusal: () => (params.edit ? 'edit' : planAsk ? 'loading' : !model?.levels?.length ? 'no-model' : ''),
      snapshot: () => { intro?.skip('api'); return { cam: cam.state, flags: flags.slice(), ext, frameExt, framePts, preset: S.preset, t: S.t, rooms: !!S.rooms }; }, // the intro ends first: a view saved in the middle of the flight would be the one to come back to
      begin() {
        walkMode = true;
        intro?.skip('api');
        onWalk?.(true); ui?.hideHint();
        shellSnap();
        flags = visibleFlags(ALL, model.levels.length);
        const f = framing(model, allExt, flags); ext = f.ext; frameExt = f.frameExt; framePts = f.framePts;
        stage.setLift(0); stage.setBase(false);
        cam.enabled = false;
        ps.setCeilings(true); ps.setWalkShadows(true); post.setEyes(true);
        camera.fov = EYES.fov; camera.near = EYES.near; camera.aspect = W / H; camera.clearViewOffset(); camera.updateProjectionMatrix();
        recut(); shell?.hidePatches(); settle();
        spacerView ??= createSpacerView({ doc: document, lang: S.lang });
        spacerView.show();
      },
      end(saved) {
        walkMode = false;
        spacerView?.hide();
        post.setEyes(false); stage.rig.setFocus(null); stage.setBase(true); ps.setCeilings(false); ps.setWalkShadows(false);
        if (saved) { flags = saved.flags; ext = saved.ext; frameExt = saved.frameExt; framePts = saved.framePts; }
        stage.setLift(floorLift(model, flags));
        cam.enabled = true;
        if (saved) cam.set({ azimuth: saved.cam.azimuth, polar: saved.cam.polar, distance: saved.cam.distance });
        recut(); shell?.hidePatches(); settle();
        if (saved) { setPreset(saved.preset, true); setTime(saved.t); }
        frameCamera();
        if (saved?.rooms && !S.rooms) toggleRooms?.();
      },
      pose(e) {
        const cp = Math.cos(e.pitch);
        camera.position.set(e.x, e.y, e.z); stage.rig.setFocus([e.x, e.y, e.z]); // the lamps that light the room are the ones near the eyes
        camera.lookAt(e.x + Math.cos(e.yaw) * cp, e.y + Math.sin(e.pitch), e.z + Math.sin(e.yaw) * cp);
      },
      doors: (list, open) => ps.setDoors(list, open),
      paint: (f) => spacerView?.paint(f),
      changed: (on) => { S.walking = on; ui?.update(S); },
      redraw, now: () => performance.now(), width: () => renderer.domElement.clientWidth || W, touchDevice,
    },
  });
  // For test tools: the walk. enter() and leave() return whether it began or ended; state() is { active, denied, cam (metres, degrees), level, room, collisions, jump, doors }; walkTo(x, y, levelId, yawDeg,
  // pitchDeg) puts the walker down; walkInput({ forward, strafe, turn, run, jump }) holds an input; walkUse() is the space bar and says what it did; advanceTime(ms) walks that long and resolves after the
  // frame that shows it; manualClock(on) stops the clock so that only advanceTime moves the walk.
  window.__spacer = {
    get active() { return spacer.active; },
    enter: () => spacer.enter(), leave: () => spacer.leave(), state: () => spacer.state(),
    walkTo: (x, y, levelId, yawDeg, pitchDeg) => spacer.walkTo(x, y, levelId, yawDeg, pitchDeg),
    walkInput: (input) => spacer.walkInput(input), walkUse: () => spacer.use(), manualClock: (on) => spacer.manualClock(on),
    advanceTime: (ms) => {
      spacer.advanceTime(ms);
      const before = loop.drawn;
      return new Promise((resolve) => { const wait = () => (loop.drawn > before || !spacer.active ? resolve(spacer.state()) : requestAnimationFrame(wait)); requestAnimationFrame(wait); });
    },
  };
  // ---------- loop: the first N frames (frames=N, 4 by default) are drawn at once and measured, then a frame is drawn whenever the picture changes ----------
  // With the intro the page is "done" (window.__done, window.__stats, the note of a share link) when the intro is over, not when the first frames are drawn: a tool that waits for it finds the page as it always stands.
  let framesDrawn = false, noteSaid = false, doneRun = false;
  function frame(n) {
    renderer.info.reset(); renderCalls = 0; const t0 = performance.now();
    if (walkMode) spacer.frame(t0); // the clock steps the walk, the eyes go where the walker is
    post.render();
    if (n <= params.frames) { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); times.push(performance.now() - t0); } // waits for the GPU: only for the measured frames
    window.__frames = n; // frames drawn so far (tools wait on it after a click)
    if (n === 1) { if (intro?.active) intro.shown(); else leaveLoading('done', intro?.reason || introAsk.why || 'off'); } // the first frame is on its way to the screen: the loading icon goes
    if (n === params.frames) framesDrawn = true;
    if (walkMode) redraw(); // Spacer draws every frame
    if (!intro?.active) { // a frame drawn after the intro (or with none): the note of a link and the end of the start-up
      if (!noteSaid) { noteSaid = true; sayStartNote(); }
      if (framesDrawn && !doneRun) { doneRun = true; done(); }
    }
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
    window.__stats = { get board() { return stage.board(); }, // the card board now, in metres: { minX, maxX, minZ, maxZ, width, depth } (it follows the open shell)
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, frameMs: Math.round(avg), quality: level, preset: S.preset, t: +S.t.toFixed(3),
      luminance: luminance(), msFirst: Math.round(times[0]), frames: params.frames, geometries: renderer.info.memory.geometries, visibleMeshes: meshes, lights, rendererRenderCalls: renderCalls, shadowCasters: stage.state.casters, pieces: furn.pieces.size, hiddenPieces: furn.hidden, mergedMeshes: furn.merged?.meshes ?? 0, emitters: furn.emitters.length, azimuth: Math.round(current.azimuth), near: sidesKey(near), size: post.size, pixelRatio: post.pixelRatio, plan: params.plan.name };
    window.__done = true;
  }
  // What a share link could not give (see the start of this block): one short line, said when the first frame is drawn (on a slow device that is some seconds after the page was built, and a line
  // said earlier would be gone by then); the page itself opens as it can.
  let startNoteText = ''; // what was said, for the test tools
  const sayStartNote = () => {
    if (!startNotes.length) return;
    const [kind, detail] = startNotes[0];
    const words = {
      link: detail === 'unsupported' ? T('Ta przeglądarka nie otworzy takiego linku: strona otwarta bez układu z linku', 'This browser cannot open such a link: the page opened without its layout') : T('Link jest uszkodzony albo za długi: strona otwarta bez niego', 'The link is broken or too long: the page opened without it'),
      plan: T('Plan z linku nie jest poprawny: strona otwarta z przykładowym planem', 'The plan in the link is not valid: the page opened with an example plan'),
      layout: T('Nie udało się wczytać układu z linku', 'Could not load the layout of the link'),
      skipped: T(`Z linku pominięto część elementów (${detail})`, `Some items of the link were left out (${detail})`),
    };
    startNoteText = words[kind] ?? words.link;
    sayLine(startNoteText, '', 9000);
  };
  // ---------- the intro: the first model builds itself (intro.js has the story, buildup.js moves the scene, introview.js has the line to skip, introrun.js the clock) ----------
  // Prepared here, before the first frame, so that the frame the visitor sees first is the empty plan; the clock starts with that frame (frame() above). It ends the
  // moment anything else needs the scene (a touch or a key, a slow device, a plan, a floor, the quality, a hook of a tool): intro.skip() or its own end. Then the pieces are merged and the
  // walls cut as on every page (finishScene), the camera is exactly where the page starts, and the control bar, which the style of the page keeps hidden until data-intro is done, fades in.
  if (introAsk.run) {
    const endView = { azimuth: cam.state.azimuth, polar: cam.state.polar, distance: cam.state.distance }; // the view the page starts in (a link may name its own)
    // The first view looks almost straight down, and from there the plan may not fit the window as it does in the starting view (a phone held upright is narrower than a plan is wide): the camera
    // is taken back, a little at a time, until every corner of the box of the model is inside the window with a margin of 12 px.
    // The control bar is not there while the intro plays, so the picture stands in the middle of the window and glides up to where the page keeps it (viewLift, see frameCamera) as the camera arrives.
    const setLift = (k) => { const l = viewLift * k; if (l > 0) camera.setViewOffset(W, H, 0, (l * H) / 2, W, H); else camera.clearViewOffset(); };
    const introFrom = () => {
      const from = cameraFrom(endView), bx = (24 / W), by = (24 / H), v = new THREE.Vector3(), along = Array.from({ length: 13 }, (_, i) => i / 12); // the whole way down, not only its first view
      for (let k = 0; k < 24; k++) {
        let fits = true;
        for (const at of along) {
          setLift(liftAt(at, { readyAt: 1 })); cam.set(cameraAt(at, { readyAt: 1 }, from, endView)); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
          for (const x of [ext.minX, ext.maxX]) for (const y of [ext.minY, ext.maxY]) for (const z of [ext.minZ, ext.maxZ]) { v.set(x, y, z).project(camera); if (Math.abs(v.x) > 1 - bx || Math.abs(v.y) > 1 - by) fits = false; }
        }
        if (fits) break;
        from.distance *= 1.05;
      }
      setLift(0); cam.set(from);
      return from;
    };
    const build = createBuildUp({ ps, furn, layout: curLayout, ext, scene, lamps: (list) => stage.setEmitters(list) });
    const view = createIntroView({ doc: document, win: window, lang: S.lang, onSkip: (how) => intro?.skip(how) });
    intro = createIntroRun({
      build, view, end: endView, from: introFrom(), guard: window.__introNoGuard !== true,
      setCamera: (st) => cam.set(st), setLift, render: () => post.render(), invalidate: redraw, nextFrame: () => new Promise((resolve) => { const before = loop.drawn; const wait = () => (loop.drawn > before ? resolve() : requestAnimationFrame(wait)); requestAnimationFrame(wait); }),
      finishScene: () => { introHold = false; setLift(1); cam.set(endView); recut(); shell?.hidePatches(); settle(); }, // the camera first: the cut and the hidden pieces are worked out for the view the page starts in
      setState: (state, why) => leaveLoading(state, why ?? ''),
    });
    intro.begin();
  }
  window.__intro = { get state() { return intro?.state ?? 'off'; }, get reason() { return intro?.reason || introAsk.why; }, get how() { return intro?.how ?? ''; }, get t() { return intro?.t ?? 0; }, get total() { return intro?.total ?? 0; }, get counts() { return intro?.counts ?? { placed: 0, total: 0 }; },
    get timeline() { return intro?.timeline ?? null; }, seek: (t) => intro?.seek(t) ?? Promise.resolve(false), skip: () => intro?.skip('api') ?? false }; // for test tools: where the intro is, and seek(t) holds it at time t
  loop = createLoop({ draw: frame, frames: params.frames, live: params.live });
  loop.start();
  if (params.walk) spacer.enter(); // walk=1: the page opens inside the flat (the editor never does, and the intro was left out above)
  // Frame hook for screenshots and video capture: window.__frame({ preset, t, az, pol, dist, size }) sets the mood, the time of day (0 to 1), the view
  // (azimuth and tilt in degrees, dist as a multiple of the default distance) and the size of the picture, draws exactly one new frame and resolves
  // after the animation frame that drew it with { frames, drawCalls }. Every field is optional; values are checked in capture.js.
  window.__frame = (args) => new Promise((resolve) => {
    intro?.skip('api');
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
})();
