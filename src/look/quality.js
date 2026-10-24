// Quality levels. Each level changes what a frame costs: pixel ratio, MSAA, shadow map size and blur, resolution and sample
// count of the ambient occlusion and the bloom, the number of point lights, which small objects cast a sun shadow (shadowCutoff,
// the bounding radius in metres below which a mesh stays out of the shadow pass, and shadowMax, the most casters), the tilt blur and texture filtering. Plain data and pure functions, no three.js.

export const QUALITY_LEVELS = Object.freeze(['high', 'medium', 'low']);

export const LEVELS = Object.freeze({
  high: Object.freeze({ id: 'high', pixelRatio: 2, msaa: 4, shadowMap: 2048, shadowRadius: 6, shadowBlur: 20, aoOn: true, aoScale: 1, aoSamples: 12, aoPdSamples: 12, bloomOn: true, bloomScale: 1, maxLights: 6, shadowCutoff: 0.1, shadowMax: 400, tiltTaps: 12, reflection: true, anisotropy: 8, grain: true }),
  medium: Object.freeze({ id: 'medium', pixelRatio: 1.5, msaa: 2, shadowMap: 1024, shadowRadius: 4, shadowBlur: 12, aoOn: true, aoScale: 0.5, aoSamples: 8, aoPdSamples: 12, bloomOn: true, bloomScale: 0.5, maxLights: 4, shadowCutoff: 0.14, shadowMax: 300, tiltTaps: 8, reflection: false, anisotropy: 4, grain: true }),
  low: Object.freeze({ id: 'low', pixelRatio: 1, msaa: 0, shadowMap: 512, shadowRadius: 2, shadowBlur: 6, aoOn: false, aoScale: 0.5, aoSamples: 4, aoPdSamples: 4, bloomOn: true, bloomScale: 0.25, maxLights: 2, shadowCutoff: 0.3, shadowMax: 100, tiltTaps: 0, reflection: false, anisotropy: 1, grain: false }),
});

export const isLevel = (name) => QUALITY_LEVELS.includes(name);

// 'q=' from the address: a level name or 'auto' (the default for anything else).
export function parseQualityParam(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return isLevel(v) ? v : 'auto';
}

// Automatic pick from what the browser reveals. env: { cores, touch, width, height, memory } (all optional).
// Phones and weak machines get low, tablets and mid machines medium, a roomy desktop with many cores high.
export function pickQuality(env = {}) {
  const cores = Number.isFinite(env.cores) ? env.cores : 4;
  const short = Math.min(env.width || 1280, env.height || 800);
  const long = Math.max(env.width || 1280, env.height || 800);
  const memory = Number.isFinite(env.memory) ? env.memory : 8;
  if (memory <= 2 || cores <= 2) return 'low';
  if (env.touch && short < 700) return 'low';
  if (env.touch || short < 600) return 'medium';
  if (cores >= 8 && long >= 1200 && memory >= 8) return 'high';
  return cores >= 4 ? 'medium' : 'low';
}

// Final level id for a 'q' parameter value and an environment.
export function resolveQuality(value, env = {}) {
  const p = parseQualityParam(value);
  return p === 'auto' ? pickQuality(env) : p;
}

export function getLevel(name) { return LEVELS[isLevel(name) ? name : 'medium']; }

// Pixel ratio actually used for a device pixel ratio.
export function effectivePixelRatio(level, devicePixelRatio = 1) {
  const cap = getLevel(level).pixelRatio;
  return Math.max(1, Math.min(cap, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
}

// Cost knobs as one number per level (for tests and the table in the notes): relative pixels shaded by the heavy passes.
export function relativeCost(level) {
  const q = getLevel(level);
  return +(q.pixelRatio * q.pixelRatio * (1 + (q.aoOn ? q.aoScale * q.aoScale * 1.5 : 0) + (q.bloomOn ? q.bloomScale * q.bloomScale * 0.5 : 0))).toFixed(2);
}
