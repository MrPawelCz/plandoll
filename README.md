# planstage

**[Open the demo](https://mrpawelcz.github.io/planstage/)**

Turn a floor plan into a furnished, lit miniature of the flat, in your browser.

![A two-level flat furnished and lit at golden hour](docs/screenshot.jpg)

**Status: early work in progress.** The page furnishes every room by itself and lights the flat at a time of day you can move. It shows two built-in example plans. There is no editor yet (you cannot move, rotate or recolour pieces) and the page cannot load your own plan yet. It is not a CAD tool and not a phone app.

## What works today

- **One HTML file.** `dist/planstage.html` is under 1 MB and runs from a file or any static host: no server, no account, no tracking, no network requests, nothing stored in the browser. It needs a browser with WebGL 2; without it the page says so.
- **Automatic furnishing.** A layout engine reads the plan, recognises each room by its name (English or Polish) or by its shape, and places furniture and decor by simple rules: a sofa opposite a television, beds with night tables, kitchen units along a wall, bathroom fittings, lamps, curtains at windows, pictures, rugs and plants. The result is plain data (a list of pieces with position, rotation, size and colours) and it is deterministic: the same plan gives the same flat.
- **48 piece types built in code.** Sofas, armchairs, beds, wardrobes, tables and chairs, kitchen units and appliances, a sink, a toilet, a washbasin, a shower, a bath, bookcases, lamps, curtains, mirrors, pictures, rugs, plants and more. No model files are loaded. Every piece has named colour slots and a size range, so a future editor can recolour and resize it.
- **Light.** A time-of-day slider and three named moods: Amber (Bursztyn), Clear (Jasno) and Lamplit (Lampy). Soft sun shadows, ambient occlusion, bloom and a vignette, in three quality levels (high, medium, low) that are picked automatically unless you ask for one.
- **Plan format.** Plans are JSON, version 1, the format of [planwalk](https://github.com/MrPawelCz/planwalk) (another project by the same author). A validator and a generator of synthetic test plans are included. A chat with a vision model can produce a plan from a photo or scan: see `docs/PROMPT.md` (English) and `docs/PROMPT.pl.md` (Polish).

## Page parameters

The address hash sets the view, for example `dist/planstage.html#lamplit&plan=duplex-1&q=low`.

| parameter | values |
| --- | --- |
| `preset`, or a bare word | `amber`, `clear`, `lamplit` |
| `t` | time of day, from 0 to 1 |
| `q` | `high`, `medium`, `low` (default: picked automatically) |
| `plan` | `flat-1`, `duplex-1` |
| `cam` | `close` for a close-up of the best furnished room |
| `seed` | 1 to 999999, changes colours only |
| `lang` | `en`, `pl` |

## Build and test

```
npm ci
npm run build   # writes dist/planstage.html
npm test
npm start       # serves dist on http://127.0.0.1:8080
```

Node 20 or newer. The tests that start Chrome are skipped when Chrome is missing (they need Node 22 or newer).

Tools: `npm run validate -- plan.json` checks a plan file against the format; `node tools/gen-plans.mjs --seed 401 --count 3 --out DIR` writes synthetic plans. The format is described in `docs/plan-format.md` and `docs/SPEC.md`, how plans are read from images in `docs/reading-plans.md`, and the data contract between plan, layout and look in `docs/DESIGN.md`.

## Krótko po polsku

Strona w przeglądarce, która z rzutu mieszkania robi urządzoną, oświetloną makietę 3D. Silnik układu sam urządza pokoje (48 typów mebli zbudowanych w kodzie), a suwak pory dnia i trzy nastroje zmieniają światło. Wersja robocza: bez edytora, pokazuje dwa wbudowane plany.

## Author

Paweł Czerwiński ([@MrPawelCz](https://github.com/MrPawelCz)).

## Licence

MIT. Parts are adapted from [planwalk](https://github.com/MrPawelCz/planwalk) by the same author (MIT); see `THIRD_PARTY_LICENSES.md`.
