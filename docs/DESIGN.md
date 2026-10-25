# Design: data and modules

Design notes for planstage. This file describes the data and the modules.

## 1. Pipeline

```
plan JSON (format v1, see docs/SPEC.md sections 1 to 4 and docs/PROMPT.md)
  -> analyzePlan / modelOf   (src/core/validate.js)       validated plan, units converted to metres
  -> buildModel              (src/model/geometry.js)      walls with thickness, openings with positions, rooms, colliders
  -> autoFurnish             (src/layout, pure functions) layout = list of pieces with positions
  -> PlanScene, composeLayout (src/render/scene.js, src/render/compose.js, src/furniture)
                                                          THREE objects: shell (walls, floors) + one object per piece
  -> look                    (src/look)                   light, shadows, post-processing, backdrop, quality level
  -> frame
```

The page never sends anything anywhere. No network requests, no localStorage, sessionStorage, cookies or IndexedDB.

## 2. Coordinates and angles

- Plan space: x to the right, y down the page, metres. World (three.js): x = plan x, z = plan y, y up. A level's floor is at `level.elevation`.
- `rot` is degrees clockwise as drawn on the plan (the same as `furniture.rotation` in the plan format). In three.js set `object.rotation.y = -rot * Math.PI / 180`.
- Every piece is built in its local frame: x = width, z = depth, y up, FRONT faces +z, BACK is -z, origin at the centre of the footprint on the floor. With `rot = 0` the front looks down the page (south). `rot = 90` looks west, `180` north, `270` east.
  So a sofa with its back on the north wall (small y) has `rot = 0`; with its back on the east wall `rot = 90`; on the south wall `rot = 180`; on the west wall `rot = 270`.
- Beds follow the same rule: width along x, headboard at -z, foot at +z. (The bed in `src/furniture/legacy.js` has the long side along x: do not mix them. `legacy.js` exists only as a stop-gap until a type has a new builder.)

## 3. The three documents

**Plan** is the v1 JSON described in `docs/SPEC.md` (walls, openings, rooms, optional stairs). Furniture in an input plan is ignored: the layout comes from the engine.

**Layout** is plain data, the thing an editor will change later:

```json
{
  "version": 1,
  "seed": 1,
  "levels": [
    {
      "id": "L0",
      "pieces": [
        { "id": "p1", "type": "sofa3", "room": "main", "x": 3.2, "y": 1.4, "rot": 90,
          "size": [2.1, 0.95, 0.85], "elev": 0, "on": null, "colors": { "upholstery": "#c9b8a6" } }
      ]
    }
  ]
}
```

- `type` is an id from `src/furniture/specs.js`. `x`, `y` are the centre of the footprint in plan metres. `size` is optional (default: the spec) and must stay inside `range`.
- `elev` is the height of the piece's bottom above the level floor (default 0; wall-mounted pieces use `place.elevation`; for a ceiling lamp it is the bottom of the hanging part).
- `on` is the id of the piece this one sits on (props on tables, shelves, nightstands); then `x`, `y`, `elev` are absolute anyway. It lets an editor move the child with its parent.
- `colors` maps a slot name to a `#rrggbb` colour or a material key of the material library (`src/render/library.js`). Missing slots use the piece's default.
- Limits: at most 400 pieces per level and 1500 in total; ids unique; every number finite. `autoFurnish` returns exactly this shape and nothing else.
- `levels[].rooms` is optional and maps a room id of the plan to `{ "wall": colour, "floor": colour }` (each part optional, a colour is `#rrggbb` or a material key, at most 200 rooms per level): a file without it is still a valid version 1 layout and `autoFurnish` never returns it.

**Style** is also plain data:

```json
{ "preset": "amber", "t": 0.735, "quality": "auto" }
```

`t` is the time of day from 0 (06:00) to 1 (23:00). `quality` is `auto`, `high`, `medium` or `low`. Per-room floor and wall colours are not part of the style: they live in the layout (`levels[].rooms`).

## 4. Furniture (src/furniture)

- `specs.js` is pure data for every type (size, range, placement rules, rooms, slots, emitters, triangle budget). It is the single source for the layout engine and for the tests of the builders.
- A builder is `buildPiece(type, { size, colors, seed, quality }) -> THREE.Group`. The group carries `userData = { type, size, tris, slots: [...], emitters: [...] }`. Meshes carry `userData.slot`. Static geometry is merged per slot, so a piece costs a handful of draw calls, not dozens.
- `emitters` are `{ pos: [x, y, z] (local), color, power }` for lamps. The look decides how many become real lights (a small fixed number) and how many are only glow.
- Everything is built from code. No model files, no texture files, no fonts, no network. Randomness only through a seeded generator (`mulberry32(seed)`), never `Math.random`.
- Loops use counters with limits. A piece that hits a limit sets `userData.truncated = true` instead of freezing the page.

## Editing pieces (src/furniture)

An editor changes the Layout document (section 3, format unchanged, version 1) and asks the furniture module for the data it needs and for rebuilt pieces. Nothing here touches the plan.

**Fields of a layout piece an editor may change**

| field | what it is | allowed values |
| --- | --- | --- |
| `x`, `y` | centre of the footprint, plan metres | finite numbers; keeping pieces apart and inside the room is the editor's job |
| `rot` | degrees clockwise as drawn on the plan | any finite number (turn in steps of 90 or freely) |
| `size` | `[w, d, h]` in metres | each axis that has a range in `specs.js` (`range.w`, `range.d`, `range.h`) inside it, every other axis the default; `clampSize` does this |
| `colors` | `{ slot: colour }` | slots from `spec.slots`; a colour is `#rrggbb`, a material of the library as `lib:<key>`, or a kit material `f:<name>`; a slot that is missing (delete the key) keeps the default |
| `elev` | height of the bottom edge above the level floor | edited for `wall-mount` and `ceiling` pieces, default `place.elevation` (`elevation` in the catalogue); for a `surface` piece it is the height of the top of the piece it sits on and follows `on`; every other piece stays at 0 |
| `on` | id of the piece it sits on | only for `surface` pieces, and only a piece whose type is in `place.onTop` (`onTop` in the catalogue); `x`, `y`, `elev` stay absolute |

`type` is not edited in place: a different type is a new piece (remove one, add one), chosen from the catalogue.

**Library keys for `colors`.** `lib:plaster-warm`, `lib:plaster-cool`, `lib:limewash`, `lib:oak`, `lib:oak-smoked`, `lib:walnut`, `lib:tile-grey`, `lib:stone-light`, `lib:boucle`, `lib:linen`, `lib:velvet`, `lib:leather`, `lib:lacquer-white` (`MATERIAL_KEYS` in `src/render/library.js`). A `#rrggbb` colour is the colour the surface should have on the whole: a textured surface keeps its structure and is tinted towards it. A slot with vertex colours (books, leaves, stems) multiplies the tint with them, so books stay varied.

**Data for the interface (pure functions, no three.js in `catalog.js`)**

- `catalog(lang)` (`src/furniture/catalog.js`): the list of pieces to choose from, `{ id, group, groupLabel, tier, label, size, range, slots: [{ name, label }], rooms, mode, elevation, onTop }`, ordered by group (the order of `GROUPS`), tier and id; `lang` is `'en'` or `'pl'`. `catalogGroups(lang)` gives the same as `[{ group, label, items }]`. Tier 3 entries (sideboard, vase, small wardrobe, sofa bed, wall shelf, bathroom cabinet and the other extras) are never placed by `autoFurnish`, which uses tiers 1 and 2; they are there for the person who edits.
- `defaultSizeOf(type)`, `clampSize(type, size)` (millimetres, held inside the range, a value that is not a finite number is replaced by the default of that axis), `isResizable(type)`, `resizableAxes(type)`, `slotLabel(type, slot, lang)`.
- `paletteOf(type, slot)` (`src/furniture/palettes.js`): `{ id, label, colors: [{ hex, name: { en, pl } }] }` with 8 to 12 colours, chosen from the material the builder uses for the slot (wood, fabric, painted, metal, ceramic and gloss, greens, glass and screens, picture tint). `defaultColorOf(type, slot, look = 'textured')`: the `#rrggbb` the slot has in that look. It is read from a piece built by the code (the flat colour of the clay look); for the textured look the colour of the material from `LOOK_COLOR` (`src/render/materials.js`) takes its place where the table has one (taupe sofa, walnut furniture, terracotta pots, green leaves); for a slot with vertex colours the result is the average. Only `'clay'` gives the flat colour.

**Rebuilding.** `rebuildPiece(group, { size, colors, quality, look })` (`src/furniture/index.js`) returns a new group for the same piece with the changes applied:

- `size` entries that are not finite numbers keep the current value; the result is held inside the range. `colors` is merged into the colours the piece already has (`userData.colors`); `null` brings the default back; unknown slots and invalid colours are dropped. `quality` and `look` default to what the piece had (`userData.quality`, `userData.lookName`, the latter set by `applyLook`).
- The new group takes the place of the old one: position, rotation, scale, visibility and name are copied, it sits at the same index among the children of the same parent, and every field of `userData` other than the ones the builder owns (`type`, `size`, `tris`, `slots`, `emitters`, `truncated`, `builder`, `seed`, `quality`, `colors`, `lookName`) is kept, so `pieceId`, `levelId`, `elev` and `pieceType` survive. The seed is kept, so a rebuild without changes gives the same geometry.
- `userData.emitters` come from the new build (local positions). A list of lights in world space made from the old group has to be made again from the new one (`emittersOf` in `src/render/compose.js`).
- The geometries of the old group are disposed; materials are shared and stay. Children that a caller added to the old group are not carried over. Rebuild a piece when its size or colours change, not on every pointer move: a drag of the position only moves the group.
- Tinted materials are cached by colour; the cache is bounded (about 1500 entries, the oldest half is dropped when it overflows), so a free colour picker does not grow memory without limit.

**Rooms.** `ROOM_PALETTES` (`src/furniture/palettes.js`) holds `wall` and `floor` lists of 8 to 16 entries `{ value, swatch, name: { en, pl } }`: `value` is what a layout stores for the room (`#rrggbb`, or `lib:<key>` of the material library) and `swatch` is the colour to draw in a picker (for a library surface its average colour). The flat colours come first, the library surfaces (plasters and limewash for walls, boards, tile and stone for floors) last. `roomPalette(kind, lang)` gives one list with the names in one language, or `null` for an unknown kind. The lists only offer colours; applying a colour to a room is the job of the scene (section "Surfaces"). The palettes of pieces (`PALETTES`) end with a few library surfaces in the same way (`{ hex: 'lib:oak', swatch, name }`); every value passes `isSlotColor`.

### Panel (src/app/panel.js)

`createPanel({ doc, host, lang, session })` returns `{ element, refresh(), setLang(lang), dispose() }`. It adds one element (`#ps-panel`) to `host` (the body when missing) and, once, a `<style id="ps-panel-style">`; all its class names start with `psp-`. It keeps nothing in the browser, makes no requests and does not move, turn or delete a piece (that is the edit bar of the page), nor does it read or write files.

It has two parts. **Add**: a button that opens a list; the groups of `catalogGroups(lang)` are collapsible sections (the first one starts open), every entry is a button at least 44 px high with the name, a tag for the extras (tier 3) and the rooms the piece suits (the first three, then a count). **Selected piece**, shown while `selected()` is not `null`: the name of the type, the problems of the piece as short lines, one number field in centimetres for every axis that has a range (`resizableAxes`, `min` and `max` from the range, step 1), and for every slot a bar of swatches: a "Default" swatch that shows `defaultColorOf(type, slot)` followed by the colours of `paletteOf(type, slot)`. A swatch is a button with `aria-pressed`, its name in `title` and `aria-label`.

**Selected room**, shown while `selectedRoom()` returns a room and no piece is selected (a piece wins if a session reports both): the name of the room and two bars, "Walls" and "Floor", each with a "Default" pill (`recolorRoom(part, null)`) and one swatch per entry of `roomPalette('wall' | 'floor', lang)`; a swatch calls `recolorRoom(part, value)`. The pressed swatch is the one whose value equals the room colour (`#rrggbb` without regard to case, `lib:` keys literally). A switch "Snap to neighbours" (`role="switch"`) is shown whenever the sheet is open and the session has `snapEdges` and `setSnapEdges`; it flips the setting.

On a screen 760 px wide or narrower the sheet floats above the bars of the page: its bottom edge is `--ps-stack-h` (pixels, read from the root element, with or without `px`; 200 px while it is missing) plus 8 px, it is at most 40 percent of the screen high and scrolls; the button stays at the top right. Wider screens get a column at the top right (the list of pieces scrolls inside the column so that the selected piece stays in view below it). Escape closes the list.

What the panel needs from the session (`src/app/edit.js`; the tests use a stand-in with the same methods):

| call | use |
| --- | --- |
| `selected()` | the selected layout piece `{ id, type, size?, colors? }` or `null`; the second part is rebuilt when `id` or `type` changes, otherwise only values are synced |
| `problems()` | a list of `{ kind }`; `overlap`, `outside-room`, `floating-prop` are drawn red, `door-zone`, `stair`, `tall-before-window`, `unknown-type`, `bad-number` yellow, other kinds are not listed |
| `add(type)` | called when an entry is touched; `{ ok: false, reason }` keeps the list open and shows a sentence for `no-room`, `limit-level`, `limit-total` (any other reason gets a general one) |
| `resize({ w, d, h })` | metres, all three axes, held in the range by `clampSize`; called on `change` of a field and only when the value differs from the one in use |
| `recolor(slot, color)` | a `#rrggbb` or `lib:<key>` of the palette, or `null` for the default |
| `selectedRoom()` | `{ level, id, name, colors: { wall?, floor? } }` or `null`; optional |
| `recolorRoom(part, color)` | `part` is `'wall'` or `'floor'`; a `#rrggbb` or `lib:<key>` of the room palette, or `null` for the default; optional |
| `snapEdges()` and `setSnapEdges(bool)` | the snap to the sides of neighbouring pieces; the switch shows only when both exist |
| `subscribe(fn)` | any event refreshes the panel; the function it returns is called by `dispose()` |

`refresh()` rebuilds only what changed. A field that has the focus keeps what is typed, and the number of nodes does not grow with the number of refreshes. `setLang(lang)` switches every text (`'pl'` or `'en'`). `tools/panel-sheet.mjs` builds a review page of the panel with the real catalogue and a stand-in session (see the header of `tools/panel-entry.js` for the hash options, among them `room=1` and `pickroom=wall.2`; the page sets `--ps-stack-h` to 190 px like the page of the product does).

## Surfaces (src/render/scene.js, src/render/materials.js)

`PlanScene.setRoomColors(colors, look)` gives rooms their own wall and floor colours. `colors` is `{ "<level id>": { "<room id>": { wall?, floor? } } }`; a value is `#rrggbb` or `lib:<key>` of the material library, anything else (wrong format, unknown key) counts as no colour; unknown levels and rooms are ignored (own properties only). The call is idempotent: the same colours give the same scene, and with no colours the scene is the one the constructor built (same materials, same geometries, same meshes). A `look` of `'clay'` or `'textured'` that differs from the scene's look is applied to the whole scene first (`setMaterials`).

- **Floors.** The floor mesh of every room (`room:<id>/floor`) takes `paintMat(name, color, look, true)` from `src/render/materials.js`: a copy of the floor material of the room in which the texture keeps its structure and its average becomes the colour (clay look: the flat colour). A `lib:<key>` value uses the surface of the library instead and the uv of the floor are written again for its repeats per metre (the old geometry is disposed). `null` brings back the shared default material and the first uv.
- **Walls.** Only the faces that look into the room are painted, by a skin: a thin quad (a geometry of its own, 4 vertices) 2 mm in front of the wall face, for one wall piece, one side and one stretch of that side along which one room looks at the wall. The stretches come from sampling the room polygons 3 cm beyond the face every 10 cm and refining each end by bisection, so a wall shared by two rooms gets two skins in two colours, and the far side of the wall (another room, or the outside) stays as it is. The pieces around windows and doors are separate wall pieces, so a skin never covers an opening. A skin follows its wall piece: it is cut with `setCut` (never below the floor), hidden when its piece is hidden, and its uv keep the scale of the texture. Skins are created on demand, named `skin:<level>:<wall>/<piece>/<side><n>`, and removed when the colour goes; the number of skins depends only on the colours given.
- **Looks.** Painted surfaces carry `pw.paint`, so `setMaterials(look)` re-applies them for the other look; the mood (amber, clear, lamplit) only changes light and never the colour of a room.
- **Memory.** `paintMat` keeps its copies in a cache of at most 48 entries (oldest dropped and disposed first), so 200 calls with changing colours do not grow materials; `disposeMaterials()` frees it. Tests: `tests/render/room-colors.test.mjs`. Review page: `tools/rooms-entry.js` (build with `tools/build-sheet.mjs`).

## 5. Layout engine (src/layout)

Pure functions, no three.js, no DOM, runs in Node. Input: the built model (`buildModel` output) plus options `{ seed }`. Output: a layout (section 3).
Room type comes from the room name (Polish and English, case and diacritics insensitive) or `room.use`, else from the geometry (area, doors, windows, neighbours). Placement honours `specs.js` (`place.against`, `clearFront`, `clearSide`, `rooms`), keeps door zones free (0.8 m in front and behind each door, plus the swing), keeps tall pieces away from windows, and is deterministic for the same input and seed.

## 5a. Editor (src/editor)

Pure functions, no DOM, no three.js, no storage and no network. They run in Node and in the page; the page keeps one state and replaces it with the state an operation returns. `src/editor/index.js` is the public API.

**State.** `{ layout, selection, history }`: `layout` is the document of section 3, `selection` is a piece id or null, `history` is `{ past, future, key }` (layouts, at most 200 steps). Updates are immutable: an operation builds a new state that shares every unchanged piece with the old one and never touches its input. Treat piece objects as read-only (their boxes are cached per object).

**Operations.** Every operation returns `{ state, ok, reason?, problems? }`, never throws, and hands back the input state itself when it fails. Reasons: `bad-state`, `unknown-id`, `unknown-type`, `unknown-level`, `bad-number`, `bad-slot`, `bad-color`, `bad-part`, `unknown-room`, `no-change`, `fixed-size`, `no-room`, `limit-level`, `limit-total`, `limit-rooms`, `nothing-to-undo`, `nothing-to-redo`, plus the hard problems of strict mode (below).

| call | effect |
| --- | --- |
| `createState(layout)` | fresh state with an empty history (anything that is not a layout becomes an empty one) |
| `addPiece(state, { type, x, y, rot?, level?, room?, size?, colors?, elev? }, opts)` | new piece with a fresh id (`p<n>`), spec size clamped to `range`, mounting height from `place`, selected; a prop finds the piece under it |
| `movePiece(state, id, x, y, opts)` | moves the centre; what stands on the piece comes along; the room follows the centre |
| `rotatePiece(state, id, deg, opts)` / `turnPiece(state, id, delta, opts)` | new angle / angle change in degrees clockwise; what stands on the piece turns around its centre |
| `deletePiece(state, id)` | removes the piece and everything that stands on it (one undo step brings all back) |
| `resizePiece(state, id, size, opts)` | `size` is `[w, d, h]` or a partial `{ w, d, h }`, clamped to `range`; an axis without a range is fixed; the footprint grows around the centre, except that a piece standing with its back on a wall (within 3 cm of the usual gap) keeps its back there when the depth changes (`snapped.wall`); props on top follow |
| `duplicatePiece(state, id, opts)` | a copy 0.3 m to the right of the piece and 0.3 m in front of it (in the piece's own directions), snapped and checked like `addPiece`, new id, selected, own copy of the colours; what stands on the piece is not copied; one undo step |
| `recolorPiece(state, id, slot, color, opts)` | `color` is `#rrggbb` (stored lower case), a material library key, or `null` for the default |
| `recolorRoom(state, level, room, part, color, opts)` | `part` is `'wall'` or `'floor'`; `color` as above, `null` clears the part (the last part removes the room entry, and the level's `rooms` key when it is empty); with `opts.model` the room must be on that level of the plan; one undo step, a series with the same `coalesceKey` is one step; `roomColorsOf(layout, level, room)` reads the colours back |
| `resetToAuto(state, model, { seed?, allowedTypes? })` | the layout engine furnishes the plan again; the result has no room colours, so they are cleared too (one undo step brings pieces and colours back, selection cleared) |
| `loadLayout(state, layout)` | replaces the layout (a loaded file), one undo step |
| `selectPiece(state, id \| null)`, `selectedPiece`, `findPiece`, `pieceAt(layout, level, x, y)` | selection and picking (the topmost piece under a point) |
| `undo(state)`, `redo(state)`, `canUndo`, `canRedo` | history; a new operation clears the redo list |

Options of the placing operations: `model` (the built plan; without it only overlaps and props are checked), `mode` (`soft`: snap and report problems, accept; `strict`: also refuse hard problems; `off`: no snapping and no checks), `snap` (`false`, or overrides for `grid`, `angle`, `wallGap`, `wallReach`, `wallAngle`, and `edges`), `coalesceKey`. Operations that carry the same `coalesceKey` in a row share one undo step (one drag of one piece); another key, no key, an undo or a redo ends the series.

**Rules** (`rules.js`). Snapping, in this order: the angle to 15 degrees (a move keeps the angle), the position to a 5 cm grid, and then, for pieces that stand with their back to a wall (`place.against` back or back-or-free, wall-mounted and window pieces), the back to the nearest wall of the room within 20 cm when the piece is turned at most 20 degrees from facing away from that wall: the gap becomes 2 cm (4 mm for wall-mounted pieces) and the angle becomes the wall's. With `snap: { edges: true }` (off by default) a floor piece also pulls a side to the side of a neighbour in the same room that is closer than `edgeReach` (15 cm), when both are turned the same way modulo 90 degrees and overlap along the shared side: the gap becomes `edgeGap` (5 mm); this runs before the wall step, so the wall keeps the last word along its normal. Positions stay within `COORD_LIMIT` (1000 m) and heights within 0 to `ELEV_LIMIT` (10 m), the limits the file reader applies. Results are rounded to the millimetre. `placementProblems(model, layout, level, piece)` lists `{ kind, with? }`:

- `outside-room`: the footprint is not inside the room's floor polygon.
- `overlap`: another piece blocks it (turned rectangles, heights, props and rugs follow the engine's `blocks` rule).
- `door-zone`, `stair`: inside the zones of `levelZones` (0.8 m in front of and behind each door plus the swing; stairs with a margin).
- `tall-before-window`: a tall or wall-mounted piece in front of a window.
- `floating-prop`: a prop (`place.mode` surface or `on` set) whose support is missing, of the wrong type, at the wrong height or too far from the centre.
- `front-blocked` (soft): the strip in front of a floor piece (`place.clearFront` deep, 90% of its width, see `clearBox`) reaches another solid piece of the same room (`with` says which) or the wall (no `with`); pieces that belong there do not count (a coffee table in front of a sofa, an armchair or the television unit, a seat in front of the television unit, a desk chair at its desk). The layout engine uses the same strip when it places pieces; `checkLayout` does not report it, so the editor and the checker differ here on purpose.

`strict` mode refuses `overlap`, `outside-room` and `floating-prop` (`HARD_KINDS`); the other kinds (door zone, stair, tall piece at a window, blocked front) are warnings in every mode. A prop moved onto another piece that accepts it changes its `on` and `elev`; dropped on bare floor it has no support.

**Saving and loading** (`io.js`). `serializeLayout(layout)` gives JSON text with a fixed key order, sorted colour slots and one piece per line (or `null` for something that is not a layout); the same layout always gives the same text. `parseLayout(text, model?, { strict? })` returns `{ ok, layout, errors, warnings }`. Errors make the file unusable: not text, more than 2 000 000 characters, not JSON, version other than 1, no list of levels, more than 20 levels, more than 400 pieces on a level or 1500 in all. Warnings list what was repaired or left out, at most 60 of them (the last one says how many more there were): sizes moved into their range, unknown colour slots and invalid colours, heights of props moved onto their support, duplicate ids, unknown types, non-finite numbers, supports that are missing, of the wrong type or part of a loop, and (with a model) levels, rooms or pieces that are not in the plan. With `strict` any warning counts as an error. Only the known keys of a piece are read, so keys such as `__proto__` cannot reach the result. Room colours (`levels[].rooms`) are written sorted by room id, `wall` before `floor`, and a level without colours has no `rooms` key, so older files and newer files without colours have the same text. When reading, only `wall` and `floor` are taken, a colour must be `#rrggbb` or a material key, with a plan the room must exist on that level, at most 200 rooms are read per level, and `__proto__`, `constructor` and `prototype` are refused as room ids; whatever is left out gets a warning.

**Files** (`src/app/files.js`, the only editor related code that touches the page). `saveTextFile(doc, filename, text)` offers text as a download through a temporary hidden link (`application/json`) and returns `true`, or `false` when the browser lacks the API or the text is empty. `readTextFile(doc)` opens the file picker and resolves to `{ ok: true, text }` or `{ ok: false, error }` with `cancelled`, `read-failed`, `too-large` (over 2 MB) or `unsupported`. `askForText(doc, lang)` shows a small dialog (Polish or English) for pasting text and resolves to the text or `null`. The layout file is called `planstage-layout.json` (`LAYOUT_FILENAME`). Nothing is kept in the browser and nothing is sent anywhere.

## 6. Look (src/look, src/app)

The look module owns the stage (sky, light rig, backdrop, base), the time-of-day keyframes, the post-processing chain and the quality levels. The app shell owns the page: canvas, the three presets (`amber`, `clear`, `lamplit`), the time slider, the quality switch, the error card when WebGL2 is missing.

The `plan` parameter takes `flat-1` or `duplex-1`. `ext` shows a plan injected as `window.__plan` before the page loads (the screenshot tool does this with `--plan FILE`). Any other value, including `gen:<seed>`, shows `flat-1`: plans are generated by a Node tool (`tools/gen-plans.mjs`), not in the browser.

## 6a. Camera (src/app/camera.js, src/render/cutaway.js)

The model can be turned round and looked at from every side. `src/app/camera.js` has two parts.

- The pure part keeps the view as `{ azimuth, polar, distance, base }` (degrees and metres) round a fixed target: `orbit`, `zoom`, `positionOf`, `stateFrom`, `blend`, `rayFor`. Azimuth 0 looks from the south, 90 from the east, 180 from the north, 270 from the west. The polar angle stays between 12 and 80 degrees from the vertical (never under the table, never straight down) and the distance between 0.45 and 1.8 times the default.
- `createCameraController` listens to pointers on the canvas: one finger or the mouse turns, two fingers and the wheel zoom, a double tap or double click goes back to the starting view in 400 ms. Arrow keys turn by 15 degrees (Shift + left or right still moves the time of day), `+` and `-` zoom, `0` resets. It asks the page for a frame only while something moves (a short inertia after a flick, the reset animation), so an idle page draws nothing. `enabled` switches it off (an editor does that while a piece is dragged) and `pointerToRay(event)` gives the ray under a pointer for picking.

`nearSides(azimuth, previous)` says which edges of the plan face the camera, with 10 degrees of hysteresis so a wall on the turning point does not flicker. Only when that set changes does the page cut the walls again: `applyWallCut` (`src/render/cutaway.js`) cuts the outer walls on a near edge low and leaves the other outer walls tall, partitions stay at half height; `cutawayPieces(pieces, ext, view, near)` hides the hung and tall pieces the new cut would spoil; then the merged meshes, the shadow casters and the lamp emitters are rebuilt. A full-height wall on the south or east edge does not cast a sun shadow (the sun stands on that side), so a view from the north does not drown the rooms. The same set of near edges cuts the upper storey of a duplex. The default view is the picture the page had before it could be turned.

The address takes `az` and `pol` (degrees) for the view the page opens with, for example `#amber&az=90` looks from the east.

## 6b. Edit mode (src/app/edit.js, src/app/pick.js, src/render/outline.js)

The address parameter `edit=1` turns the layout editor on. It is off by default: without it the page draws the same calls and the same picture as before and has no edit bar and no pointer handling for editing. `edit=1` also forces `merge=0`, because a piece that is being dragged must be an object of its own (the draw call limits apply to the view without editing).

- **Session** (`src/app/edit.js`, pure logic, tested in Node on the example plans). `createEditSession({ layout, model, onChange, allowedTypes })` holds the state of `src/editor` and forwards the operations of the interface to it: `select`, `add(type, at)`, `turn(deg)`, `remove`, `resize`, `recolor`, `undo`, `redo`, `reset` (automatic layout), `exportText`, `importText`, and for dragging `beginDrag(id)`, `dragTo(x, y)`, `endDrag`, `cancelDrag`. Placement is always in the `soft` mode of the editor: a piece accepts every place after snapping, the outline shows what is wrong, Undo is always at hand. `add` looks for the best free place of the room under the centre of the view (candidate points ordered by distance, four angles each, the first without overlap, door zone, stair or unsupported prop wins; when there is none the piece goes to the middle of the room with its problems shown). `onChange({ type })` says what the page has to redraw: `structure` (pieces added, removed, resized, recoloured, or places changed by turn, undo, redo, reset, import), `drag` (move only the group of the dragged piece), `dragend` (then refresh lamps and shadow casters) and `select`.
- **Picking** (`src/app/pick.js`). `pickPiece(layout, ray, { levelBase, skip, pad })` tests the ray against the oriented boxes of the pieces (centre, angle, size, height from `elev` to `elev + h` above the floor of the level) and returns the nearest `{ id, level, t, point }` in front of the camera; `skip(id)` leaves out pieces that the wall cutaway hides. It does not use the meshes, which are merged by material in the normal view. `floorHit(ray, y)` meets the ray with a horizontal plane (the base of the dragged piece).
- **Gestures** (`src/app/main.js`). A pointer that goes down on a piece selects it and switches the camera off for the length of the gesture; after 6 px of movement the piece is dragged (the grab offset is kept), each move calls `floorHit` at the height of the piece's foot and `session.dragTo`, which snaps (5 cm grid, walls) and moves the piece with what stands on it; only the groups of the pieces are moved and the outline follows, nothing is rebuilt. Releasing keeps the place as one undo step; `pointercancel`, or a second finger during the drag, puts the piece back and returns the camera. A drag that starts on an empty place is the camera as before; a quick tap on nothing clears the selection. Keys (not while a form field has the focus): Delete or Backspace removes, R turns by 90 degrees, Ctrl or Cmd + Z undoes, Ctrl or Cmd + Shift + Z and Ctrl + Y redo, Escape clears the selection.
- **Re-composing.** After a `structure` change the page compares a signature (type, size, colours) of each piece with the one it built; when only places changed the groups are moved (`position`, `rotation.y`) and the cutaway, lamps and shadow casters are refreshed, otherwise the furniture is composed again. The selection is kept by id.
- **Outline** (`src/render/outline.js`). A tinted rectangle with a rim on the floor under the piece plus the edges of its box, drawn last without a depth test. Red for `overlap`, `outside-room` and `floating-prop`, yellow for the other problems (`door-zone`, `stair`, `tall-before-window`), light copper when the place is fine.
- **Edit bar** (`createEditBar` in `src/app/ui.js`). Turn, Delete, Undo, Redo and Auto layout, each at least 44 px, disabled when there is nothing to do, one row above the controls. `#ps-edit-panel` is an empty container for further panels.
- **For test tools.** `window.__edit = { session, screenOf(id), count(), selectedId() }`; `tools/interact.mjs --edit` taps a piece at `screenOf(id)`, drags it by about 80 px, turns, undoes, redoes, deletes and restores the automatic layout, and checks after each step that the layout and the picture changed.

## 7. Tests and tools

- `npm test` runs every `tests/**/*.test.mjs` with node:test. Chrome tests skip without Chrome, unless `PLANSTAGE_REQUIRE_CHROME=1`.
- `tools/shot.mjs` takes screenshots with headless Chrome (software GL). Chrome runs under `nice -n 19`. The page sets `window.__done = true` and `window.__stats` when it has rendered `frames` frames.
- `tools/interact.mjs` uses the page like a visitor: a phone screen with touch input (or `--desktop` with the mouse), a tap on a mood button, a drag of the time slider, a quality change, the language button, the labels and the hint, a drag that turns the model by about 90 degrees, a double tap and the reset button that bring the view back, and a check that the idle page draws no frames. After each step it checks that the picture above the controls changed, not only the controls. `tests/look/interact.test.mjs` runs it on request (`PLANSTAGE_BROWSER_TESTS=1`).
- The page draws its first `frames` frames (4 by default) at once and then only when something changed (`src/app/loop.js`; `window.__frames` counts the frames drawn). `live=1` skips the first burst.
- `tools/gen-plans.mjs` writes synthetic plans: `node tools/gen-plans.mjs --seed 401 --count 14 --out DIR` (7 families, deterministic; options in docs/SPEC.md section 5).

## 8. Design decisions

- `kitchen-sink`: `size[2]` (default 1.1, range 1.05 to 1.2) includes the tap. The worktop sits at `size[2] - 0.2` (0.9 by default, level with `kitchen-base`), the tap rises 0.2 above it. The layout engine only cares about the footprint, so nothing else changes.
- Completeness in `checkLayout` (`REQUIRED_SETS` in `src/layout/check.js`): a room is complete when it holds the pieces of its recipe. Small rooms are excused from three pieces, to keep the recipes honest about space: a wardrobe is required from 10 m2 of interior, a nightstand from 2.4 m of width, a shower or bathtub from 3.5 m2. Living rooms always need a sofa, a TV unit, a coffee table and a rug; kitchens a fridge, sink, hob and base cabinet; bathrooms a toilet and a washbasin.
- `layout.seed` changes colours only. Positions come from the recipes without randomness, so every seed gives the same arrangement. Layout variants per seed belong to the editor.
- The input plan's own furniture is ignored: the engine furnishes, `src/render/compose.js` places the pieces (one `buildPiece` group per layout piece, `rotation.y = -rot * PI / 180`, `y = level elevation + elev`), and lamp emitters go to `stage.setEmitters`.
