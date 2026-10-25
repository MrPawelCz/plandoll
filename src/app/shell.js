// Decisions of the page shell that need no browser: what the address asks for, which parts of the page are built, what the failure card says and the
// order in which a loaded plan is built. main.js calls these; tests/app/shell.test.mjs runs them in Node.

export const NO_WEBGL2 = 'WebGL2 is not available';

// true when the canvas that makeCanvas returns gives a WebGL2 context; a probe that throws or returns nothing counts as no.
// A key press that lands in a form field (a size box in the panel, a pasted text) belongs to the field, never to the shortcuts of the page.
export function isFormTarget(target) {
  const tag = String(target?.tagName ?? '').toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea' || target?.isContentEditable === true;
}

export function hasWebgl2(makeCanvas) {
  try { return !!makeCanvas()?.getContext?.('webgl2'); } catch { return false; }
}

// The line shown under the failure card for an error: its message (or the value itself when it is not an error), as text.
export function failureDetail(e) {
  return String((e && e.message) || e);
}

// Which plan the page opens: the plan that a test tool injected as window.__plan ('ext'), duplex-1, otherwise flat-1 (a generator name opens flat-1 too).
export function planChoice(params, injected) {
  if (params?.plan?.kind === 'ext' && injected) return 'ext';
  return params?.plan?.name === 'duplex-1' ? 'duplex-1' : 'flat-1';
}

// What the controls show at the start, from the parsed address parameters (the page adds the quality levels).
export function startState(params) {
  return { preset: params.preset, t: params.t, q: params.q, lang: params.lang, tools: params.btn, editing: params.edit };
}

// Which parts of the page are built. ui=0 leaves the picture alone (no controls, no edit bar, no sheet; the editing gestures still work), btn=0 hides only
// the row of extra buttons, edit=1 adds the edit bar and the sheet.
export function partsOf(params) {
  const ui = !!params.ui;
  return { controls: ui, tools: ui && !!params.btn, editBar: ui && !!params.edit, sheet: ui && !!params.edit, editing: !!params.edit };
}

// Builds everything that a loaded plan needs before the page touches the scene it shows, so a plan that cannot be built leaves the page as it was. The plan
// is copied and stripped of furniture (the layout engine furnishes it). deps: { analyzePlan, modelOf, buildModel, modelExtent, makeScene(model),
// autoFurnish(model, options), piecesImplemented() }. The order is fixed: analyse, model, extent, scene, layout. Returns { model, ext, scene, layout } or null.
export function buildPlanParts(next, seed, deps) {
  let scene = null;
  try {
    const p = JSON.parse(JSON.stringify(next));
    for (const lv of p.levels) lv.furniture = [];
    const res = deps.analyzePlan(p), model = deps.buildModel(deps.modelOf(res)), ext = deps.modelExtent(model);
    scene = deps.makeScene(model);
    const layout = deps.autoFurnish(model, { seed, allowedTypes: deps.piecesImplemented() });
    return { model, ext, scene, layout };
  } catch {
    try { scene?.dispose?.(); } catch { /* the scene is dropped anyway */ }
    return null;
  }
}
