# Reading different kinds of plans

## Clean CAD or architect PDFs
- Walls are thick filled or hatched strips; trace the middle line. Doors have an arc; windows are three parallel lines across a wall.
- Dimension lines and grid axes are thin lines outside the building: ignore them for walls, use their numbers for scale. Dash-dot grid axes usually run through wall centerlines, which confirms where to trace.
- A label such as `80/200` next to a door is the leaf width and height in cm, and `90/240` next to a window its width and height; the arc chord and the dimension chains give the opening itself. Circled type tags (for example `D1`, `D2`, `O1`) name the opening type, and level marks beside windows and doors (for example `+2.40` and `+0.90`, relative to the floor mark) give the head and sill heights: use them for `height` and `sill`. Wall type tags (for example `S1`, `S2`: exterior and interior wall types, check the legend) come with a thickness: set `thickness` from it and `kind` from the type. Insulation layers outside the structural wall are not walls: leave them out and say so in `meta.notes`.
- Printed room areas are net (inside the wall faces): polygons on the centerlines come out larger (by about half a wall thickness on every side, so most for small rooms such as bathrooms), which the validator allows for. A much larger gap points at a missing split or a wrong corner, or at an area that leaves out part of the space (low headroom under a stair, a niche).
- Dashed lines between rooms mean an open plan: no wall, the polygons share the edge. Columns, niches, shafts and fixtures are not modelled; a wall that stops at a column simply has a free end.
- A cropped sheet cuts walls and rooms at its edge: say which sides are cut in `meta.notes`, and put the origin at the top-left corner of the walls you trace (there may be no outer corner).
- Vector PDFs can be rendered at 150 to 200 dpi; larger sheets (A1) at 100 dpi are usually enough and keep the image small.

## Real-estate brochures and listing images
- Often low resolution, with furniture symbols and room labels overlaid. Areas in labels are usually net floor areas; use them for the scale cross-check and expect polygons on the centerlines to come out larger than the label.
- Marketing plans may be mirrored or omit walls around shafts and balconies. Mention what you left out.

## Hand sketches and photos of paper
- Straighten mentally: ignore perspective and rotation; keep right angles unless the sketch clearly shows otherwise.
- If no dimensions exist, say that the scale is estimated from a standard door and set `meta.scale_note` accordingly.

## Multi-level plans
- One `levels` entry per floor, ids like `L0`, `L1`. A straight stair is drawn with steps and an arrow; put `from` at the end on the floor you are tracing, `to` at the other end, and `to_level` as the floor it leads to. Upper-level rooms must not cover the stair footprint.
- A drawing of one floor has no other floor in the file: leave `to_level` out (the stair then leaves the plan and is drawn as steps that connect to nothing) and give `rise` when you know the height, negative when the arrow points down from this floor. A floor drawn alone above the ground gets an `elevation` (for example 3.0), which also tells the validator that nobody enters through an exterior door.
- `steps` counts the risers (a drawing that prints `16 x 17.5` has 16 steps and a rise of 16 x 0.175 = 2.80 m); `from` and `to` are the centres of the first and last step line. When only part of a flight is drawn (the rest is dashed, hatched or cut off), trace the visible part: count its steps, set `rise` to those steps times the printed riser (6 x 0.175 = 1.05 m), and say in `meta.notes` that the rest is not drawn. A dot at one end of the walking line marks the foot of the stair: that end is `from` when the stair goes up from this floor.

## When something is unreadable
Leave it out, list it in `meta.notes`, and tell the user. Do not fill gaps with plausible rooms.
