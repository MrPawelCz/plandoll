# planstage

**[Open the demo](https://mrpawelcz.github.io/planstage/)**

Turn a floor plan into a furnished, lit miniature of the flat, in your browser.

![A two-level flat furnished and lit at golden hour](docs/screenshot.jpg)

**Status: early work in progress.** The page furnishes every room by itself, lights the flat at a time of day you can move, and lets you turn the miniature around to see it from every side. It shows two built-in example plans. A first version of the editor can be switched on with `edit=1` in the address (see below): it can move, turn, delete, add and duplicate pieces, change their size and colours, colour the walls and floor of a room, and save the layout to a file or load it back. A plan of your own can be pasted or loaded from a file (see Buttons and your own plan). It is not a CAD tool and not a phone app.

## What works today

- **One HTML file.** `dist/planstage.html` is a single file of about 1 MB and runs from a file or any static host: no server, no account, no tracking, no network requests, nothing stored in the browser. It needs a browser with WebGL 2; without it the page says so.
- **Automatic furnishing.** A layout engine reads the plan, recognises each room by its name (English or Polish) or by its shape, and places furniture and decor by simple rules: a sofa opposite a television, beds with night tables, kitchen units along a wall, bathroom fittings, lamps, curtains at windows, pictures, rugs and plants. The result is plain data (a list of pieces with position, rotation, size and colours) and it is deterministic: the same plan gives the same flat.
- **52 piece types built in code.** Sofas, armchairs, beds, wardrobes, tables and chairs, kitchen units and appliances, a sink, a toilet, a washbasin, a shower, a bath, bookcases, lamps, curtains, mirrors, pictures, rugs, plants and more. No model files are loaded. Every piece has named colour slots and most have a size range, so the editor can recolour and resize them.
- **A view from every side.** Drag with one finger or the mouse to turn the miniature around its centre, pinch or use the wheel to zoom, and double tap, double click, press `0` or use the Reset view button to go back to the starting view. The walls that face you lower so the rooms stay in sight, on both levels of a duplex, while the other walls stay high. The arrow keys turn the view by 15 degrees (up and down tilt it by 10), `+` and `-` zoom, `1`, `2` and `3` pick a mood, and Shift with left or right moves the time of day. An idle page draws no frames. On a phone (a window up to 760 px wide) the starting view keeps the whole model above the bars at the bottom, so the lower storey of a duplex is not hidden behind them.
- **A first editor (experimental, off by default).** Open the page with `edit=1` in the address, for example `dist/planstage.html#edit=1`. Tap a piece to select it (a copper outline shows it) and drag it over the floor with a finger or the mouse (it snaps to walls, to a 5 cm grid and to steps of 15 degrees), turn it by 90 degrees, delete it, undo and redo (up to 200 steps) or go back to the automatic layout. The outline turns red when a piece overlaps another one or leaves its room and yellow for lesser problems such as blocking a door. The Add button lists the pieces by group; the panel of the selected piece has a size field for every dimension that may change and colour swatches for every part; tap the floor of a room, in a place without a piece, to colour its walls and floor. The edit bar has six buttons: Rotate piece, Delete, Undo, Redo, Reset layout (back to the automatic layout, which also clears the room colours; Undo brings them back) and File. The File menu duplicates the selected piece (Duplicate piece), saves the layout to a file (`planstage-layout.json`), loads one from a file or from pasted text, saves the picture and loads a plan. A short hint ("Tap a piece to select it, drag to move it") shows when editing starts and goes away at the first selection. On a computer: `R` turns, `Delete` removes, `Ctrl` or `Cmd` with `Z` undoes, with `Shift` and `Z` (or `Ctrl` and `Y`) redoes, `Escape` clears the selection. The logic behind it is in `src/editor` and tested. The pieces that nobody moves stay merged into a few meshes; the one you drag is drawn on its own.
- **Buttons and your own plan.** The control bar has three buttons (under the mood and time controls in a narrow window, on the same line in a wide one): Edit (reloads the page in edit mode and, in the editor, becomes Done), Save image (a PNG of the current view, without the controls) and Load plan. Load plan opens a box where you paste the text of a plan or fill it from a `.json` file (2 MB at most); the plan is checked, the old scene is released and the new model, its automatic layout and the view are built in place, without reloading the page. A plan that does not pass the check leaves the page as it was and a short line says what is wrong first and how many more problems there are. Nothing is stored in the browser. Add `btn=0` to the address to hide the row of buttons.
- **Light.** A time-of-day slider and three named moods: Amber (Bursztyn), Clear (Jasno) and Lamplit (Lampy). Soft sun shadows, ambient occlusion, bloom and a vignette, in three quality levels (high, medium, low) that are picked automatically unless you ask for one. On a phone the choice of quality is hidden while you edit, so change it before you tap Edit (the page keeps it).
- **Plan format.** Plans are JSON, version 1, the format of [planwalk](https://github.com/MrPawelCz/planwalk) (another project by the same author). A validator and a generator of synthetic test plans are included. Prompts that turn a photo or scan of a plan into this JSON are in `docs/PROMPT.md` (English) and `docs/PROMPT.pl.md` (Polish).

## Page parameters

The address hash sets the view, for example `dist/planstage.html#lamplit&plan=duplex-1&q=low`.

| parameter | values |
| --- | --- |
| `preset`, or a bare word | `amber`, `clear`, `lamplit` |
| `t` | time of day, from 0 to 1 |
| `q` | `high`, `medium`, `low` (default: picked automatically) |
| `plan` | `flat-1`, `duplex-1` |
| `cam` | `close` for a close-up of the best furnished room |
| `az` | direction the view starts from, in degrees round the model: 0 from the south, 90 from the east, 180 from the north, 270 from the west |
| `pol` | how steeply the view looks down, in degrees from the vertical (12 to 80) |
| `edit` | `1` switches the first version of the editor on (default: off) |
| `btn` | `0` hides the Edit, Save image and Load plan buttons (default: shown) |
| `ui` | `0` hides all controls (default: shown) |
| `merge` | `0` draws every piece as its own mesh (default: pieces are merged by material; a debugging aid) |
| `seed` | 1 to 999999, changes colours and small details (books, leaves, curtain folds, pictures), never the positions |
| `lang` | `en`, `pl` |
| `frames`, `live` | for the test tools: `frames` is how many frames the page draws in a row at the start (1 to 60, default 4), and `live=1` draws only the first frame at the start and later frames only when something asks for one |

## Build and test

```
npm ci
npm run build   # writes dist/planstage.html
npm test
npm start       # serves dist on http://127.0.0.1:8080
```

Node 20 or newer. The test that starts Chrome and clicks through the page runs on request only (`PLANSTAGE_BROWSER_TESTS=1 npm test`, Chrome and Node 22 or newer); the click-through tool is `tools/interact.mjs`.

The built page carries a content security policy that lets the browser itself refuse network requests and foreign scripts.

Tools: `npm run validate -- plan.json` checks a plan file against the format; `node tools/gen-plans.mjs --seed 401 --count 3 --out DIR` writes synthetic plans. The format is described in `docs/plan-format.md` and `docs/SPEC.md`, how plans are read from images in `docs/reading-plans.md`, and the data contract between plan, layout and look in `docs/DESIGN.md`.

## Krótko po polsku

Strona w przeglądarce, która z rzutu mieszkania robi urządzoną, oświetloną makietę 3D. Silnik układu sam urządza pokoje (52 typy mebli zbudowane w kodzie), a suwak pory dnia i trzy nastroje zmieniają światło. Makietę można obracać palcem lub myszą i przybliżać, żeby obejrzeć mieszkanie z każdej strony. Za parametrem edit=1 jest wczesna wersja edytora (zaznaczanie, przesuwanie, obrót, usuwanie, cofanie, dodawanie i powielanie mebli, rozmiary, kolory, kolory ścian i podłóg, zapis i wczytanie układu). Wersja robocza: ma dwa wbudowane plany, własny rzut (plik JSON) wczytasz przyciskiem Wczytaj plan, a obraz zapiszesz przyciskiem Zapisz obraz.

## Author

Paweł Czerwiński ([@MrPawelCz](https://github.com/MrPawelCz)).

## Licence

MIT. Parts are adapted from [planwalk](https://github.com/MrPawelCz/planwalk) by the same author (MIT); see `THIRD_PARTY_LICENSES.md`.

The example plans in `examples/` and the test plans are also released under CC0.
