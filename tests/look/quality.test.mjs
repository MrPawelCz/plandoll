// Quality levels: each level must really change the cost knobs; automatic choice and the address parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, QUALITY_LEVELS, parseQualityParam, pickQuality, resolveQuality, getLevel, effectivePixelRatio, relativeCost } from '../../src/look/quality.js';
import { MAX_POINT_LIGHTS } from '../../src/look/rig.js';

test('levels are high, medium and low, each with every knob', () => {
  assert.deepEqual([...QUALITY_LEVELS], ['high', 'medium', 'low']);
  for (const n of QUALITY_LEVELS) {
    const l = LEVELS[n]; assert.equal(l.id, n);
    for (const key of ['pixelRatio', 'msaa', 'shadowMap', 'shadowRadius', 'shadowBlur', 'aoScale', 'aoSamples', 'aoPdSamples', 'bloomScale', 'maxLights', 'tiltTaps', 'anisotropy']) assert.ok(Number.isFinite(l[key]), `${n}.${key}`);
    assert.equal(typeof l.aoOn, 'boolean'); assert.equal(typeof l.bloomOn, 'boolean'); assert.equal(typeof l.reflection, 'boolean');
  }
});

test('every cost knob is monotone: high >= medium >= low, and strictly different somewhere', () => {
  for (const key of ['pixelRatio', 'msaa', 'shadowMap', 'shadowRadius', 'shadowBlur', 'aoScale', 'aoSamples', 'bloomScale', 'maxLights', 'tiltTaps', 'anisotropy']) {
    assert.ok(LEVELS.high[key] >= LEVELS.medium[key] && LEVELS.medium[key] >= LEVELS.low[key], key);
  }
  assert.ok(LEVELS.high.shadowCutoff <= LEVELS.medium.shadowCutoff && LEVELS.medium.shadowCutoff < LEVELS.low.shadowCutoff, 'shadowCutoff grows as quality drops');
  assert.ok(LEVELS.high.shadowMax >= LEVELS.medium.shadowMax && LEVELS.medium.shadowMax > LEVELS.low.shadowMax, 'shadowMax shrinks as quality drops');
  assert.ok(LEVELS.high.shadowMap > LEVELS.medium.shadowMap && LEVELS.medium.shadowMap > LEVELS.low.shadowMap);
  assert.ok(LEVELS.high.aoOn && !LEVELS.low.aoOn);
  assert.ok(relativeCost('high') > relativeCost('medium') && relativeCost('medium') > relativeCost('low'));
});

test('the point light budget never exceeds the rig pool', () => {
  assert.equal(MAX_POINT_LIGHTS, 6);
  for (const n of QUALITY_LEVELS) assert.ok(LEVELS[n].maxLights <= MAX_POINT_LIGHTS && LEVELS[n].maxLights >= 1);
  assert.equal(LEVELS.high.maxLights, 6);
});

test('q parameter: a level name or auto, anything else is auto', () => {
  assert.equal(parseQualityParam('high'), 'high'); assert.equal(parseQualityParam(' LOW '), 'low'); assert.equal(parseQualityParam('medium'), 'medium');
  for (const v of ['', 'auto', 'ultra', undefined, null, 5, '../x']) assert.equal(parseQualityParam(v), 'auto');
});

test('automatic pick from cores, touch, screen and memory', () => {
  assert.equal(pickQuality({ cores: 12, width: 1920, height: 1080, touch: false, memory: 8 }), 'high');
  assert.equal(pickQuality({ cores: 8, width: 1440, height: 900, memory: 8 }), 'high');
  assert.equal(pickQuality({ cores: 4, width: 1440, height: 900 }), 'medium');
  assert.equal(pickQuality({ cores: 8, width: 1024, height: 768, touch: true }), 'medium'); // a tablet
  assert.equal(pickQuality({ cores: 8, width: 390, height: 844, touch: true }), 'low'); // a phone
  assert.equal(pickQuality({ cores: 2, width: 1920, height: 1080 }), 'low');
  assert.equal(pickQuality({ cores: 16, width: 1920, height: 1080, memory: 2 }), 'low');
  assert.equal(pickQuality({ cores: 12, width: 1000, height: 560 }), 'medium'); // a small window on a big machine
  assert.ok(QUALITY_LEVELS.includes(pickQuality({})));
  assert.ok(QUALITY_LEVELS.includes(pickQuality({ cores: NaN, width: NaN })));
});

test('resolveQuality: explicit levels win, auto picks', () => {
  assert.equal(resolveQuality('low', { cores: 16, width: 2000, height: 1200 }), 'low');
  assert.equal(resolveQuality('auto', { cores: 16, width: 2000, height: 1200 }), 'high');
  assert.equal(resolveQuality(undefined, { cores: 4, width: 1400, height: 900 }), 'medium');
});

test('pixel ratio is capped per level and never below 1', () => {
  assert.equal(effectivePixelRatio('high', 3), 2); assert.equal(effectivePixelRatio('medium', 2), 1.5); assert.equal(effectivePixelRatio('low', 3), 1);
  assert.equal(effectivePixelRatio('high', 1), 1); assert.equal(effectivePixelRatio('high', 0.5), 1); assert.equal(effectivePixelRatio('high', NaN), 1);
  assert.equal(getLevel('nonsense').id, 'medium');
});
