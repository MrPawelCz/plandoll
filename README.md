# planstage

**[Open the demo](https://mrpawelcz.github.io/planstage/)**

Turn a floor plan into a furnished, lit miniature of the flat, in your browser.

![A two-level flat furnished and lit at golden hour](docs/screenshot.jpg)

**Status: early work in progress.** The page furnishes every room by itself, lights the flat at a time of day you can move, and lets you turn the miniature around to see it from every side. It shows two built-in example plans (a flat and a duplex, picked with buttons), and one button lays the outer walls open like the sides of a dolls' house. A first version of the editor can be switched on with `edit=1` in the address (see below): it can move, turn, delete, add and duplicate pieces, change their size and colours, colour the walls and floor of a room, and save the layout to a file or load it back. A plan of your own can be pasted or loaded from a file (see Buttons and your own plan). It is not a CAD tool and not a phone app.

## What works today

- **One HTML file.** `dist/planstage.html` is a single file of about 1 MB and runs from a file or any static host: no server, no account, no tracking, no network requests, nothing stored in the browser. It needs a browser with WebGL 2; without it the page says so.
- **Automatic furnishing.** A layout engine reads the plan, recognises each room by its name (English or Polish) or by its shape, and places furniture and decor by simple rules: a sofa opposite a television, beds with night tables, kitchen units along a wall, bathroom fittings, lamps, curtains at windows, pictures, rugs and plants. The result is plain data (a list of pieces with position, rotation, size and colours) and it is deterministic: the same plan gives the same flat.
- **52 piece types built in code.** Sofas, armchairs, beds, wardrobes, tables and chairs, kitchen units and appliances, a sink, a toilet, a washbasin, a shower, a bath, bookcases, lamps, curtains, mirrors, pictures, rugs, plants and more. No model files are loaded. Every piece has named colour slots and most have a size range, so the editor can recolour and resize them.
- **A view from every side.** Drag with one finger or the left mouse button to turn the miniature around its centre. Two fingers zoom and move it at the same time: the point between your fingers stays under them, so pinching on a room zooms into that room. Three fingers move it with their middle. With the mouse, the right or the middle button (or Shift with the left button) moves it and the wheel zooms towards the pointer. Zoom runs from 0.2 to 1.8 times the starting distance, and the model can be moved as far as the edge of the open shell plus 15 percent, so it cannot be lost. A double tap, a double click, `0` or the Reset view button go back to the starting view: the turn, the zoom and the move. On a touch screen the first one-finger turn shows one line about this (1 finger: turn, 2 fingers: zoom and move, double tap: back) for about six seconds, once per page load. The walls that face you lower so the rooms stay in sight, on both levels of a duplex, while the other walls stay high. The arrow keys turn the view by 15 degrees (up and down tilt it by 10), `+` and `-` zoom, `1`, `2` and `3` pick a mood, and Shift with left or right moves the time of day. An idle page draws no frames. While the Open the shell button is on (the default), and on a phone (a window up to 760 px wide) in any case, the starting view keeps the whole model above the bars at the bottom, so the lower storey of a duplex is not hidden behind them.
- **A first editor (experimental, off by default).** Open the page with `edit=1` in the address, for example `dist/planstage.html#edit=1`. Tap a piece to select it (a copper outline shows it) and drag it over the floor with a finger or the mouse (it snaps to walls, to a 5 cm grid and to steps of 15 degrees), turn it by 90 degrees, delete it, undo and redo (up to 200 steps) or go back to the automatic layout. The outline turns red when a piece overlaps another one or leaves its room and yellow for lesser problems such as blocking a door. The Add button lists the pieces by group; the panel of the selected piece has a size field for every dimension that may change and colour swatches for every part; tap the floor of a room, in a place without a piece, to colour its walls and floor. The edit bar has six buttons: Rotate piece, Delete, Undo, Redo, Reset layout (back to the automatic layout, which also clears the room colours; Undo brings them back) and File. The File menu duplicates the selected piece (Duplicate piece), saves the layout to a file (`planstage-layout.json`), loads one from a file or from pasted text, saves the picture and loads a plan. A short hint ("Tap a piece to select it, drag to move it") shows when editing starts and goes away at the first selection. On a computer: `R` turns, `Delete` removes, `Ctrl` or `Cmd` with `Z` undoes, with `Shift` and `Z` (or `Ctrl` and `Y`) redoes, `Escape` clears the selection. The logic behind it is in `src/editor` and tested. The pieces that nobody moves stay merged into a few meshes; the one you drag is drawn on its own.
- **Buttons and your own plan.** The control bar has a row of buttons (under the mood and time controls, on a row of its own in a window of any width): the example plans, Flat and Duplex (the plan on show is pressed; the plan is built in place and `plan=` in the address follows, so a reload or a shared address opens the same plan); Open the shell (see below); Edit (reloads the page in edit mode and, in the editor, becomes Done), Save image (a PNG of the current view, without the controls) and Load plan. Load plan opens a box where you paste the text of a plan or fill it from a `.json` file (2 MB at most); the plan is checked, the old scene is released and the new model, its automatic layout and the view are built in place, without reloading the page. A plan that does not pass the check leaves the page as it was and a short line says what is wrong first and how many more problems there are. Nothing is stored in the browser. Add `btn=0` to the address to hide the row of buttons.
- **Open the shell.** The Open the shell button lets the outer walls fall outward round the plan, like the sides of a paper model, with their windows, doors, curtains and pictures; the walls start one after another and settle with a little overshoot in about three seconds, and the camera stays where it is. Tap the button again, press Space or Escape and they fold back up. Because the view has to hold the closed house and the open one together, the closed house sits a little smaller in the picture than it would without the button (about six tenths of its old size on a computer, seven tenths on a phone); `shell=0` in the address takes the button away and frames the closed house alone. The card board under the model follows the shell: closed, it hugs the house with a rim of about six percent of the larger side (at least 0.35 m); as the walls fall open it grows to hold every wall, and it shrinks back as they fold up. While you edit the shell stays closed: the editor works on the closed model, the button is dimmed and says to finish editing first, and the Edit button reloads the page with the walls up.
- **Light.** A time-of-day slider and three named moods: Amber (Bursztyn), Clear (Jasno) and Lamplit (Lampy). Soft sun shadows, ambient occlusion, bloom and a vignette, in three quality levels (high, medium, low) that are picked automatically unless you ask for one. On a phone the choice of quality is hidden while you edit, so change it before you tap Edit (the page keeps it).
- **Plan format.** Plans are JSON, version 1, the format of [planwalk](https://github.com/MrPawelCz/planwalk) (another project by the same author). A validator and a generator of synthetic test plans are included. Prompts that turn a photo or scan of a plan into this JSON are in `docs/PROMPT.md` (English) and `docs/PROMPT.pl.md` (Polish).

## Page parameters

The address hash sets the view, for example `dist/planstage.html#lamplit&plan=duplex-1&q=low`.

| parameter | values |
| --- | --- |
| `preset`, or a bare word | `amber`, `clear`, `lamplit` |
| `t` | time of day, from 0 to 1 |
| `q` | `high`, `medium`, `low` (default: picked automatically) |
| `plan` | `flat-1`, `duplex-1` (the Flat and Duplex buttons set it) |
| `cam` | `close` for a close-up of the best furnished room |
| `az` | direction the view starts from, in degrees round the model: 0 from the south, 90 from the east, 180 from the north, 270 from the west |
| `pol` | how steeply the view looks down, in degrees from the vertical (12 to 80) |
| `edit` | `1` switches the first version of the editor on (default: off) |
| `btn` | `0` hides the row of buttons: example plans, Open the shell, Edit, Save image and Load plan (default: shown) |
| `shell` | `0` takes the Open the shell button away and frames the closed model alone (default: button shown; the shell is always closed while editing) |
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

Strona w przeglądarce, która z rzutu mieszkania robi urządzoną, oświetloną makietę 3D. Silnik układu sam urządza pokoje (52 typy mebli zbudowane w kodzie), a suwak pory dnia i trzy nastroje zmieniają światło. Makietę można obracać jednym palcem lub myszą, przybliżać i przesuwać (dwa palce: przybliżanie i przesuwanie, trzy palce: przesuwanie, prawy przycisk myszy: przesuwanie, kółko: przybliżanie do kursora; podwójne dotknięcie wraca do widoku początkowego), żeby obejrzeć mieszkanie z każdej strony. Za parametrem edit=1 jest wczesna wersja edytora (zaznaczanie, przesuwanie, obrót, usuwanie, cofanie, dodawanie i powielanie mebli, rozmiary, kolory, kolory ścian i podłóg, zapis i wczytanie układu). Wersja robocza: ma dwa wbudowane plany (przyciski Mieszkanie i Dupleks), własny rzut (plik JSON) wczytasz przyciskiem Wczytaj plan, a obraz zapiszesz przyciskiem Zapisz obraz. Przycisk Otwórz bryłę kładzie ściany zewnętrzne na zewnątrz jak w domku dla lalek (w edycji bryła zostaje zamknięta).

## Author

Paweł Czerwiński ([@MrPawelCz](https://github.com/MrPawelCz)).

## Licence

MIT. Parts are adapted from [planwalk](https://github.com/MrPawelCz/planwalk) by the same author (MIT); see `THIRD_PARTY_LICENSES.md`.

The example plans in `examples/` and the test plans are also released under CC0.
