// What Spacer puts on the picture: a small map of the floor with the walker and where it looks, a hint at the bottom, and the two halves of a touch screen named for a few
// seconds. Plain DOM and a 2D canvas, no three.js, no network, no storage; the styles are one <style id="ps-walk-style">. spacerrun.js decides when each shows.
// The map is ported from planwalk viewer/src/main.js (MIT, same author), source commit fa1a280 (v0.3.2).

export const SPACER_STYLE_ID = 'ps-walk-style';
export const MAP_SIZE = 180; // px of the map canvas (the style makes it smaller on a phone)

export const SPACER_TEXT = Object.freeze({
  en: Object.freeze({
    hint: 'Click to look around. W S walk, A D step aside, arrows turn, Shift runs, Space jumps or opens and shuts doors, Esc goes back.',
    touchHint: 'Drag the left half to walk, the right half to look', left: 'Walk', right: 'Look around', map: 'Map of the floor',
  }),
  pl: Object.freeze({
    hint: 'Kliknij, żeby się rozglądać. W S: naprzód i wstecz, A D: bokiem, strzałki: obrót, Shift: bieg, spacja: skok albo drzwi, Esc: powrót.',
    touchHint: 'Lewa połowa: idź, prawa: rozglądaj się', left: 'Idź', right: 'Rozglądaj się', map: 'Plan piętra',
  }),
});

// The map sits at the top on the right: the bottom edge belongs to the bar, the version mark and the card of a piece, and Spacer shows none of the pieces.
const CSS = `
#ps-walk{position:fixed;inset:0;z-index:30;pointer-events:none;font:600 13px/1.3 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink,#4a3b2a);-webkit-user-select:none;user-select:none}
#ps-walk[hidden]{display:none}
#ps-walk-map{position:absolute;right:max(12px,env(safe-area-inset-right,0px));top:max(12px,env(safe-area-inset-top,0px));width:${MAP_SIZE}px;height:${MAP_SIZE}px;border-radius:16px;background:var(--paper,rgba(250,245,234,.84));border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 6px 18px rgba(40,28,12,.22);box-sizing:border-box}
@media (max-width:760px){#ps-walk-map{width:112px;height:112px;border-radius:12px}}
#ps-walk-hint{position:absolute;left:50%;bottom:calc(var(--ps-stack-h,80px) + 14px);transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;padding:6px 14px;border-radius:16px;background:var(--paper,rgba(250,245,234,.84));border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 6px 18px rgba(40,28,12,.22);text-align:center;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
#ps-walk-hint[hidden]{display:none}
#ps-walk-zones{position:absolute;left:0;right:0;top:0;bottom:var(--ps-stack-h,80px);display:flex;opacity:0;transition:opacity .25s ease}
#ps-walk-zones.on{opacity:1}
#ps-walk-zones div{flex:1;display:flex;align-items:center;justify-content:center;background:rgba(250,245,234,.08)}
#ps-walk-zones div+div{border-left:2px dashed rgba(250,245,234,.55)}
#ps-walk-zones span{padding:5px 14px;border-radius:14px;background:var(--paper,rgba(250,245,234,.84));border:1px solid var(--line,rgba(120,96,64,.22))}
`;

// Draws the floor the walker is on into a 2D context of size x size px: the walls, the stairs and the doors that are shut (an open door is a gap, as in the picture),
// scaled to fit the whole plan with a margin; the pieces of furniture are not part of the model, and the rails of the stairs are left out as they are thin. The walker is
// an arrow that points the way it looks. model: the walkable model (bounds, levels with colliders), world: the physics world (doors), player: its walker.
export function drawMap(ctx, size, { model, world, player }) {
  const lv = model.levels[player.level], b = model.bounds, pad = 12;
  const bw = Math.max(1e-6, b.maxX - b.minX), bh = Math.max(1e-6, b.maxY - b.minY);
  const s = Math.min((size - 2 * pad) / bw, (size - 2 * pad) / bh), ox = (size - bw * s) / 2, oy = (size - bh * s) / 2;
  const X = (x) => ox + (x - b.minX) * s, Y = (y) => oy + (y - b.minY) * s;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#6b655a';
  const shut = world.doors.filter((d) => d.level === player.level && d.closed).map((d) => d.collider);
  for (const c of [...lv.colliders, ...shut]) {
    if (c.kind === 'furniture' || c.kind === 'rail') continue;
    ctx.save();
    ctx.translate(X(c.cx), Y(c.cy));
    ctx.rotate(Math.atan2(c.uy, c.ux));
    ctx.fillRect(-c.hx * s, -Math.max(c.hy * s, 0.8), 2 * c.hx * s, Math.max(2 * c.hy * s, 1.6));
    ctx.restore();
  }
  ctx.save();
  ctx.translate(X(player.x), Y(player.y));
  ctx.rotate(player.yaw);
  ctx.fillStyle = '#d1542f';
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// options: { doc, lang }. Returns { element, map, show(), hide(), setLang(lang), paint(frame), dispose() }; paint takes what spacerrun.js hands the host:
// { model, world, player, help (the touch hint is due), locked (the mouse is captured), touch (a touch device) }. The map is drawn every frame, the words only when they change.
export function createSpacerView({ doc = document, lang = 'en' } = {}) {
  if (!doc.getElementById(SPACER_STYLE_ID)) { const s = doc.createElement('style'); s.id = SPACER_STYLE_ID; s.textContent = CSS; doc.head.appendChild(s); }
  const mk = (tag, id) => { const n = doc.createElement(tag); if (id) n.id = id; return n; };
  const root = mk('div', 'ps-walk'), map = mk('canvas', 'ps-walk-map'), hint = mk('div', 'ps-walk-hint'), zones = mk('div', 'ps-walk-zones');
  map.width = MAP_SIZE; map.height = MAP_SIZE; map.setAttribute('role', 'img');
  hint.setAttribute('role', 'status');
  const zl = mk('div'), zr = mk('div'), wl = mk('span'), wr = mk('span');
  zl.append(wl); zr.append(wr); zones.append(zl, zr); zones.setAttribute('aria-hidden', 'true');
  root.append(map, zones, hint);
  root.hidden = true;
  doc.body.appendChild(root);

  let L = SPACER_TEXT[lang === 'pl' ? 'pl' : 'en'], shown = '', zonesOn = null;
  function words() { wl.textContent = L.left; wr.textContent = L.right; map.setAttribute('aria-label', L.map); shown = ''; }
  words();
  const say = (text) => { if (text === shown) return; shown = text; hint.textContent = text; hint.hidden = !text; };
  return {
    element: root, map,
    show() { root.hidden = false; },
    hide() { root.hidden = true; shown = ''; zonesOn = null; zones.className = ''; },
    setLang(l) { L = SPACER_TEXT[l === 'pl' ? 'pl' : 'en']; words(); },
    paint({ model, world, player, help = false, locked = false, touch = false }) {
      const ctx = map.getContext?.('2d');
      if (ctx && model && world && player) drawMap(ctx, MAP_SIZE, { model, world, player });
      say(touch ? (help ? L.touchHint : '') : (locked ? '' : L.hint)); // the mouse hint goes once the mouse is captured and comes back when it is let go
      const on = !!(touch && help);
      if (on !== zonesOn) { zonesOn = on; zones.className = on ? 'on' : ''; }
    },
    get text() { return { hint: L.hint, touchHint: L.touchHint, left: L.left, right: L.right }; },
    dispose() { root.remove(); },
  };
}
