# planstage

Turn a floor plan into a furnished, lit miniature of the flat, in your browser.

**Status: early work in progress.** The page lights a plan with a time of day you can move, in three moods. A layout engine that furnishes every room by itself, and a kit of 37 pieces built in code, are in this repository and are being wired into the page. There is no editor yet.

- One HTML file: no server, no account, no tracking, no network requests, nothing stored in the browser.
- It reads a floor plan in the [planwalk](https://github.com/MrPawelCz/planwalk) plan format (JSON v1). A chat with vision can produce that JSON from a photo or scan of a plan: see `docs/PROMPT.md` (English) and `docs/PROMPT.pl.md` (Polish).
- It is not an app for the phone and not a CAD tool. Furniture is built in code, not loaded from model files.

## Build and test

```
npm ci
npm run build   # writes dist/planstage.html
npm test
```

The design of the data (plan, layout, style) is in `docs/DESIGN.md`.

## Krótko po polsku

Strona w przeglądarce, która z rzutu mieszkania robi oświetloną makietę. Silnik, który sam urządza pokoje, i zestaw 37 mebli zbudowanych w kodzie są w repozytorium i trwa ich podłączanie do strony. Wersja robocza, jeszcze bez edytora.

## Author

Paweł Czerwiński ([@MrPawelCz](https://github.com/MrPawelCz)).

## Licence

MIT. Parts are adapted from [planwalk](https://github.com/MrPawelCz/planwalk) by the same author (MIT); see `THIRD_PARTY_LICENSES.md`.
