# Third-party licenses

plandoll itself is MIT licensed (see `LICENSE`). The product has no runtime dependencies. The built page
(`dist/plandoll.html`) contains a bundled copy of three.js, so its licence notice is reproduced here.

## Code adapted from planwalk (MIT, same author)

Parts of this repository are adapted from planwalk 0.2.0 (public repository main, commit bd97062), by the same author and under the
same MIT licence: `src/core/` (plan validator and helpers), `schema/plan.v1.schema.json`, `src/model/` (geometry, areas, i18n),
`src/render/` (scene, materials, textures, uv, soft, framing), `src/furniture/legacy.js` (the first furniture catalogue),
`tools/validate.mjs`, `tools/test.mjs`, `tools/serve.mjs`, `tools/gen-plans.mjs`, `examples/` (two synthetic example plans),
`tests/core/`, `tests/render/`, `tests/fixtures/`, `tests/helpers/chrome.mjs`, and `docs/` (PROMPT.md, PROMPT.pl.md, SPEC.md,
reading-plans.md, plan-format.md). The files were copied and adjusted for the new directory layout. `docs/SPEC.md` was shortened and rewritten for plandoll: it now covers only the plan format, its geometry, the validator and the plan generator. planwalk keeps its own history and releases;
there is no runtime dependency between the two.

Spacer, the walk through the flat at eye height, is adapted from a later planwalk release, 0.3.2 (public repository, commit fa1a280), by the same author and under the same MIT licence. The files were copied and adjusted, and each of the first four says so in its first lines, with the source commit:
`src/model/physics.js` (from `viewer/src/physics.js`, with the changes its header lists),
`src/app/spacer.js` (the rules of the keys, the mouse and the two touch halves, from `viewer/src/main.js` and `viewer/src/compact.js`),
`src/app/spacerrun.js` (in part from `viewer/src/main.js`) and
`src/app/spacerview.js` (the map of the floor, from `viewer/src/main.js`).
Two files that were adapted from planwalk 0.2.0 (above) carry parts of the same later release without a header of their own: `src/model/geometry.js` has the constants `JUMP`, `DOOR_REACH`, `DOOR_CONE_DEG` and `DOOR_SECONDS`, the function `leafPose` and the swing and the shut-door colliders of a door, from `viewer/src/geometry.js`, and `src/render/scene.js` has `setLeaf` and `setDoors`, which swing a door leaf, from `viewer/src/scene.js` (extended here to carry the handle).
The tests of the physics are copied the same way, cut down where they dealt with furniture because the plan model of plandoll has none: `tests/model/walk.test.mjs`, `tests/model/walk-doors.test.mjs`, `tests/model/walk-examples.test.mjs`, `tests/model/walk-furniture.test.mjs` and `tests/model/walk-jump.test.mjs` (from `tests/viewer/`), and the small plan they share, `tests/helpers/walk-model.mjs` (from `tests/viewer/walk-room.mjs`).
The other tests of Spacer, its words and the browser check `tools/spacer-check.mjs` are written for plandoll.

## Dependencies

| Package | Version | Licence | Where it ends up |
| --- | --- | --- | --- |
| three | 0.186.1 | MIT | development dependency, bundled into `dist/plandoll.html` (including the add-ons RoomEnvironment, EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, ShaderPass, OutputPass and the geometry merge helper) |
| esbuild | 0.28.2 | MIT | development dependency, used only by `tools/build.mjs`, not shipped |
| @esbuild/* platform binaries | 0.28.2 | MIT | optional development dependencies of esbuild, not shipped |

All of them are MIT. The full tree is in `package-lock.json` (28 packages in total, every one MIT).
Fonts: the page uses the system font stack and ships no font files.

The example plans in `examples/` and the plans in `tests/fixtures/` are synthetic and are additionally released under CC0 1.0 (public domain dedication), next to the MIT licence of the rest of the repository.

## three.js

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## esbuild

MIT License

Copyright (c) 2020 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
