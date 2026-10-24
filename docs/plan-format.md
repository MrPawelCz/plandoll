# Plan format (v1)

This is plan format v1 as used by planstage; it derives from the plan format of planwalk, another project by the same author.

Plan space: x to the right, y downward, like an image. All lengths in `units` (default `m`). Full definition: `schema/plan.v1.schema.json` and `docs/SPEC.md` (coordinates, plan format, geometry and validation; the validator enforces the schema and says what to fix).

```json
{
  "version": 1,
  "name": "Studio",
  "units": "m",
  "meta": { "source": "image", "scale_note": "Scale from the printed 5.00 m dimension line on the south wall." },
  "levels": [
    {
      "id": "L0",
      "walls": [
        { "id": "w1", "from": [0, 0], "to": [6, 0], "kind": "exterior" },
        { "id": "w2", "from": [6, 0], "to": [6, 4], "kind": "exterior" },
        { "id": "w3", "from": [0, 4], "to": [6, 4], "kind": "exterior" },
        { "id": "w4", "from": [0, 0], "to": [0, 4], "kind": "exterior" },
        { "id": "w5", "from": [4, 2.2], "to": [6, 2.2] },
        { "id": "w6", "from": [4, 2.2], "to": [4, 4] }
      ],
      "openings": [
        { "id": "front", "wall": "w3", "type": "door", "offset": 1.0, "width": 0.9 },
        { "id": "win1", "wall": "w1", "type": "window", "offset": 1.5, "width": 1.6 },
        { "id": "bath-door", "wall": "w6", "type": "door", "offset": 0.4, "width": 0.8 }
      ],
      "rooms": [
        { "id": "main", "name": "Living / sleeping", "polygon": [[0, 0], [6, 0], [6, 2.2], [4, 2.2], [4, 4], [0, 4]], "area": 18.4 },
        { "id": "bath", "name": "Bathroom", "polygon": [[4, 2.2], [6, 2.2], [6, 4], [4, 4]], "floor": "tile" }
      ]
    }
  ]
}
```

## Fields you will use most

- **walls**: `id`, `from [x, y]`, `to [x, y]`, `kind` (`exterior` 0.30 m, `interior` 0.12 m, `partition` 0.08 m default thickness), optional `thickness`.
- **openings**: `wall` (id), `type` (`door`, `window`, `passage`), `offset` (along the wall from `from`), `width`; optional `height`, `sill` (windows default 0.9 m), doors: `hinge` (`start`/`end`: which end of the opening carries the hinge, `start` being the end near the wall's `from` point), `opens_to` (`left`/`right`: the side of the wall the leaf swings toward, looking from `from` to `to` on the plan seen from above with y down; on a wall drawn from north to south, `left` is the east side).
- **rooms**: `polygon` along wall centerlines, `name`, optional `use`, `floor` (`wood`, `tile`, `carpet`, `stone`, `concrete`), `area` (printed area, m2).
- **stairs** (optional): `from` (centre of the step line at this level's floor), `to` (centre of the step line at the far end), `width`, `steps`, and `to_level` when the floor it leads to is in the file. On a drawing of one floor leave `to_level` out: the stair leaves the plan and is drawn as steps that connect to nothing; `rise` (height, negative when the stair goes down from this level; default one storey up) is optional.
- **furniture** (optional, decorative): `type`, `center`, `size [w, d]`, `rotation` (degrees clockwise on the plan).
- **levels**: several levels for several floors; `elevation` (height of the floor above the ground) defaults to the stack of previous levels, so set it (for example 3.0) when the drawing shows only an upper floor.
- **ids and notes**: ids use letters, digits, `_`, `-` and `.` (1 to 40 characters); `meta.scale_note` may be up to 1000 characters, `meta.notes` up to 2000.

## Checks the validator makes

Ids unique, walls long enough, openings fit their wall and do not overlap, rooms do not self-intersect, declared areas agree with a polygon (along the centerlines within 5%, or net of the walls within 10%: printed areas are usually net; this is the scale check), rooms are reachable from an entrance through doors, passages, stairs and open edges (rooms that share an edge with no wall), wall ends that just miss another wall, plausible overall size for the units. Errors block rendering; warnings do not, but read them.
