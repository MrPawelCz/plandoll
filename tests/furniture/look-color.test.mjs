// The default colour of a slot in the textured look follows the colour table of that look; the clay look keeps the flat colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECS } from '../../src/furniture/specs.js';
import { buildPiece } from '../../src/furniture/index.js';
import { defaultColorOf } from '../../src/furniture/palettes.js';
import { LOOK_COLOR } from '../../src/render/materials.js';

const HEX = /^#[0-9a-f]{6}$/;
const meshes = (g) => { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };

test('LOOK_COLOR is exported as a table of well formed colours', () => {
  assert.ok(Object.keys(LOOK_COLOR).length >= 6);
  for (const [key, hex] of Object.entries(LOOK_COLOR)) assert.match(hex, HEX, key);
});

test('the textured default of a slot differs from the clay default exactly where the table dresses its material', () => {
  let dressed = 0, plain = 0;
  for (const spec of SPECS) {
    const g = buildPiece(spec.id, { seed: 1, quality: 'low' });
    for (const slot of spec.slots) {
      const keys = new Set(meshes(g).filter((m) => m.userData.slot === slot).map((m) => m.userData.look?.mat));
      const clay = defaultColorOf(spec.id, slot, 'clay'), textured = defaultColorOf(spec.id, slot, 'textured');
      assert.match(clay, HEX); assert.match(textured, HEX);
      assert.equal(defaultColorOf(spec.id, slot), textured, `${spec.id}/${slot}: the default look is textured`);
      if ([...keys].some((k) => LOOK_COLOR[k])) dressed++; else { plain++; assert.equal(textured, clay, `${spec.id}/${slot}: no entry in the table`); }
    }
  }
  assert.ok(dressed >= 8 && plain >= 50, `${dressed} dressed slots, ${plain} plain`);
});

test('sofa, wardrobe and planter show the colour of the textured look', () => {
  assert.equal(defaultColorOf('sofa2', 'upholstery', 'clay'), '#d8d2c8');
  assert.equal(defaultColorOf('sofa2', 'upholstery', 'textured'), LOOK_COLOR['f:fabric']);
  assert.notEqual(defaultColorOf('sofa2', 'upholstery', 'textured'), defaultColorOf('sofa2', 'upholstery', 'clay'));
  const wood = SPECS.find((s) => s.id === 'wardrobe').slots.filter((slot) => defaultColorOf('wardrobe', slot, 'textured') !== defaultColorOf('wardrobe', slot, 'clay'));
  assert.ok(wood.length >= 1, 'a wardrobe slot is dressed richer in the textured look');
  assert.equal(defaultColorOf('plant-large', 'pot', 'textured'), LOOK_COLOR['f:pot']);
  assert.notEqual(defaultColorOf('plant-large', 'pot', 'clay'), LOOK_COLOR['f:pot']);
});

test('a slot with vertex colours keeps them in the textured default (leaves stay varied, not the flat table colour)', () => {
  const clay = defaultColorOf('plant-large', 'leaves', 'clay'), textured = defaultColorOf('plant-large', 'leaves', 'textured');
  assert.match(textured, HEX);
  assert.notEqual(clay, textured);
  assert.equal(defaultColorOf('nope', 'leaves', 'textured'), null);
  assert.equal(defaultColorOf('plant-large', 'nope', 'textured'), null);
});
