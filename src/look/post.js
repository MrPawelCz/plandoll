// Post-processing chain: RenderPass, GTAO ambient occlusion, bloom, OutputPass (tone mapping) and a final pass of our own with a
// tilt blur at the top and bottom of the frame, a vignette and a touch of grain. Resolution of AO and bloom follows the quality level.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getLevel, effectivePixelRatio } from './quality.js';

// Only the brightest spots bloom: a lit lamp shade or a window, not a sunlit floor. A higher value keeps lamps readable.
export const BLOOM_THRESHOLD = 1.9;

export const FinalShader = {
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.3 }, tilt: { value: 1 }, taps: { value: 12 }, grain: { value: 1 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float tilt; uniform float taps; uniform float grain; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      float band = smoothstep(0.38, 0.52, abs(vUv.y - 0.5)) * tilt; float r = band * 5.0;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (r > 0.3 && taps > 0.5) { vec3 acc = c; float ws = 1.0;
        for (int i = 0; i < 12; i++) { if (float(i) >= taps) break; float a = float(i) * 2.399963; float d = sqrt((float(i) + 0.5) / taps); acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * d * r / res).rgb; ws += 1.0; }
        c = acc / ws; }
      vec2 q = vUv - 0.5; q.x *= res.x / res.y; float v = smoothstep(1.05, 0.25, length(q) * 1.15);
      c *= mix(1.0 - vig, 1.0, v); c += (hash(vUv * res) - 0.5) * 0.014 * grain;
      gl_FragColor = vec4(c, 1.0); }`,
};

// Makes a pass render its buffers at a fraction of the composer size (the composer calls setSize with full size).
function scaleSetSize(pass, scale) {
  const base = Object.getPrototypeOf(pass).setSize;
  pass.setSize = (w, h) => base.call(pass, Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
}

export function createPost({ renderer, scene, camera, width, height, quality = 'medium', devicePixelRatio = 1 }) {
  let level = getLevel(quality);
  let W = width, H = height, pr = effectivePixelRatio(level.id, devicePixelRatio);
  const rt = new THREE.WebGLRenderTarget(W * pr, H * pr, { type: THREE.HalfFloatType, samples: level.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  const render = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, W, H);
  gtao.blendIntensity = 1.0;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.4, 0.4, 1.25);
  const output = new OutputPass();
  const final = new ShaderPass(FinalShader);
  composer.addPass(render); composer.addPass(gtao); composer.addPass(bloom); composer.addPass(output); composer.addPass(final);

  function applyLevel(name) {
    level = getLevel(name);
    pr = effectivePixelRatio(level.id, devicePixelRatio);
    gtao.enabled = level.aoOn;
    gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 0.7, scale: 1.4, samples: level.aoSamples, distanceFallOff: 1.0, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 12, depthPhi: 2, normalPhi: 3, radius: 7, rings: 3, samples: level.aoPdSamples });
    scaleSetSize(gtao, level.aoScale); scaleSetSize(bloom, level.bloomScale);
    bloom.enabled = level.bloomOn;
    for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = level.msaa; t.dispose(); } // recreated lazily with the new sample count
    final.uniforms.taps.value = level.tiltTaps; final.uniforms.grain.value = level.grain ? 1 : 0;
    resize(W, H);
    if (lastK) setLook(lastK);
  }
  function resize(w, h) {
    W = w; H = h;
    renderer.setPixelRatio(pr); renderer.setSize(w, h);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    final.uniforms.res.value.set(w * pr, h * pr);
  }
  // k: interpolated look from timeofday.sample.
  let lastK = null;
  // A bloom at a lower resolution spreads wider on screen, so strength and radius shrink with the bloom scale.
  function setLook(k) { lastK = k; bloom.strength = k.bloom * (0.55 + 0.45 * level.bloomScale); bloom.radius = 0.3 * (0.5 + 0.5 * level.bloomScale); bloom.threshold = BLOOM_THRESHOLD; final.uniforms.vig.value = k.vig; renderer.toneMappingExposure = k.exp; }

  applyLevel(level.id);
  return { composer, passes: { render, gtao, bloom, output, final }, render: () => composer.render(), resize, setQuality: applyLevel, setLook,
    get pixelRatio() { return pr; }, get size() { return [W * pr, H * pr]; },
    dispose() { composer.dispose?.(); gtao.dispose?.(); bloom.dispose?.(); rt.dispose(); } };
}
