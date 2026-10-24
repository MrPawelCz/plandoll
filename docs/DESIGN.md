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

**Style** is also plain data:

```json
{ "preset": "amber", "t": 0.735, "quality": "auto" }
```

`t` is the time of day from 0 (06:00) to 1 (23:00). `quality` is `auto`, `high`, `medium` or `low`. Per-room floor and wall materials are planned and are not part of the style yet.

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
- `paletteOf(type, slot)` (`src/furniture/palettes.js`): `{ id, label, colors: [{ hex, name: { en, pl } }] }` with 8 to 12 colours, chosen from the material the builder uses for the slot (wood, fabric, painted, metal, ceramic and gloss, greens, glass and screens, picture tint). `defaultColorOf(type, slot)`: the `#rrggbb` the builder gives the slot; it is read from a piece built by the code, in the flat colour of the clay look (the textured look dresses a few materials richer), and for a slot with vertex colours it is the average.

**Rebuilding.** `rebuildPiece(group, { size, colors, quality, look })` (`src/furniture/index.js`) returns a new group for the same piece with the changes applied:

- `size` entries that are not finite numbers keep the current value; the result is held inside the range. `colors` is merged into the colours the piece already has (`userData.colors`); `null` brings the default back; unknown slots and invalid colours are dropped. `quality` and `look` default to what the piece had (`userData.quality`, `userData.lookName`, the latter set by `applyLook`).
- The new group takes the place of the old one: position, rotation, scale, visibility and name are copied, it sits at the same index among the children of the same parent, and every field of `userData` other than the ones the builder owns (`type`, `size`, `tris`, `slots`, `emitters`, `truncated`, `builder`, `seed`, `quality`, `colors`, `lookName`) is kept, so `pieceId`, `levelId`, `elev` and `pieceType` survive. The seed is kept, so a rebuild without changes gives the same geometry.
- `userData.emitters` come from the new build (local positions). A list of lights in world space made from the old group has to be made again from the new one (`emittersOf` in `src/render/compose.js`).
- The geometries of the old group are disposed; materials are shared and stay. Children that a caller added to the old group are not carried over. Rebuild a piece when its size or colours change, not on every pointer move: a drag of the position only moves the group.
- Tinted materials are cached by colour; the cache is bounded (about 1500 entries, the oldest half is dropped when it overflows), so a free colour picker does not grow memory without limit.

## 5. Layout engine (src/layout)

Pure functions, no three.js, no DOM, runs in Node. Input: the built model (`buildModel` output) plus options `{ seed }`. Output: a layout (section 3).
Room type comes from the room name (Polish and English, case and diacritics insensitive) or `room.use`, else from the geometry (area, doors, windows, neighbours). Placement honours `specs.js` (`place.against`, `clearFront`, `clearSide`, `rooms`), keeps door zones free (0.8 m in front and behind each door, plus the swing), keeps tall pieces away from windows, and is deterministic for the same input and seed.

## 6. Look (src/look, src/app)

The look module owns the stage (sky, light rig, backdrop, base), the time-of-day keyframes, the post-processing chain and the quality levels. The app shell owns the page: canvas, the three presets (`amber`, `clear`, `lamplit`), the time slider, the quality switch, the error card when WebGL2 is missing.

The `plan` parameter takes `flat-1` or `duplex-1`. `ext` shows a plan injected as `window.__plan` before the page loads (the screenshot tool does this with `--plan FILE`). Any other value, including `gen:<seed>`, shows `flat-1`: plans are generated by a Node tool (`tools/gen-plans.mjs`), not in the browser.

## 7. Tests and tools

- `npm test` runs every `tests/**/*.test.mjs` with node:test. Chrome tests skip without Chrome, unless `PLANSTAGE_REQUIRE_CHROME=1`.
- `tools/shot.mjs` takes screenshots with headless Chrome (software GL). Chrome runs under `nice -n 19`. The page sets `window.__done = true` and `window.__stats` when it has rendered `frames` frames.
- `tools/interact.mjs` uses the page like a visitor: a phone screen with touch input (or `--desktop` with the mouse), a tap on a mood button, a drag of the time slider, a quality change, the language button. After each step it checks that the picture above the controls changed, not only the controls. `tests/look/interact.test.mjs` runs it on request (`PLANSTAGE_BROWSER_TESTS=1`).
- The page draws its first `frames` frames (4 by default) at once and then only when something changed (`src/app/loop.js`; `window.__frames` counts the frames drawn). `live=1` skips the first burst.
- `tools/gen-plans.mjs` writes synthetic plans: `node tools/gen-plans.mjs --seed 401 --count 14 --out DIR` (7 families, deterministic; options in docs/SPEC.md section 5).

## 8. Design decisions

- `kitchen-sink`: `size[2]` (default 1.1, range 1.05 to 1.2) includes the tap. The worktop sits at `size[2] - 0.2` (0.9 by default, level with `kitchen-base`), the tap rises 0.2 above it. The layout engine only cares about the footprint, so nothing else changes.
- Completeness in `checkLayout` (`REQUIRED_SETS` in `src/layout/check.js`): a room is complete when it holds the pieces of its recipe. Small rooms are excused from three pieces, to keep the recipes honest about space: a wardrobe is required from 10 m2 of interior, a nightstand from 2.4 m of width, a shower or bathtub from 3.5 m2. Living rooms always need a sofa, a TV unit, a coffee table and a rug; kitchens a fridge, sink, hob and base cabinet; bathrooms a toilet and a washbasin.
- `layout.seed` changes colours only. Positions come from the recipes without randomness, so every seed gives the same arrangement. Layout variants per seed belong to the editor.
- The input plan's own furniture is ignored: the engine furnishes, `src/render/compose.js` places the pieces (one `buildPiece` group per layout piece, `rotation.y = -rot * PI / 180`, `y = level elevation + elev`), and lamp emitters go to `stage.setEmitters`.
