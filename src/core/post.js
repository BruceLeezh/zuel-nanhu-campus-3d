import * as THREE from 'three';

/**
 * 轻量后期管线（单 pass 合成，纯手写，不依赖 examples/EffectComposer）
 *
 * 流程：
 *   场景 → HDR RenderTarget（4×MSAA）
 *        → 亮度阈值提取（1/2 分辨率）→ 两次分离高斯模糊（1/2 分辨率）
 *        → 合成：ACES 色调映射 + 泛光叠加 + 暗角 + 微对比/饱和 + sRGB 编码
 *
 * 用法（在 main.js 里）：
 *   const post = createPost(renderer, scene, camera);
 *   // 每帧：post.render(dt)  —— 内部会自动处理 resize / 画质档
 */

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 亮度阈值 + 下采样
const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
uniform float softKnee;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + texel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 0.5, -0.5)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-0.5,  0.5)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float knee = threshold * softKnee + 1e-5;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, l - threshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * contrib, 1.0);
}`;

// 分离高斯（9 tap）
const BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 dir;      // 已含 texel 尺寸
varying vec2 vUv;
void main() {
  vec3 sum = vec3(0.0);
  sum += texture2D(tSrc, vUv + dir * -4.0).rgb * 0.0162;
  sum += texture2D(tSrc, vUv + dir * -3.0).rgb * 0.0540;
  sum += texture2D(tSrc, vUv + dir * -2.0).rgb * 0.1216;
  sum += texture2D(tSrc, vUv + dir * -1.0).rgb * 0.1946;
  sum += texture2D(tSrc, vUv).rgb                   * 0.2270;
  sum += texture2D(tSrc, vUv + dir *  1.0).rgb * 0.1946;
  sum += texture2D(tSrc, vUv + dir *  2.0).rgb * 0.1216;
  sum += texture2D(tSrc, vUv + dir *  3.0).rgb * 0.0540;
  sum += texture2D(tSrc, vUv + dir *  4.0).rgb * 0.0162;
  gl_FragColor = vec4(sum, 1.0);
}`;

// 合成：ACES + 泛光 + 暗角 + 调色 + 抖动
const COMP_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform float exposure;
uniform float vignette;
uniform float contrast;
uniform float saturation;
uniform float grain;
uniform float time;
varying vec2 vUv;

// ACES filmic（Narkowicz）
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col += bloom * bloomStrength;

  col *= exposure;
  col = aces(col);

  // 轻微对比 + 饱和
  col = mix(vec3(0.5), col, contrast);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, saturation);

  // 暗角
  vec2 p = vUv - 0.5;
  float v = 1.0 - dot(p, p) * vignette;
  col *= clamp(v, 0.0, 1.0);

  // 抖动，抑制天空色带
  float n = hash12(vUv * vec2(1920.0, 1080.0) + fract(time) * 91.7);
  col += (n - 0.5) * grain;

  // sRGB 编码
  col = max(col, vec3(0.0));
  vec3 srgb = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  gl_FragColor = vec4(srgb, 1.0);
}`;

export function createPost(renderer, scene, camera, opts = {}) {
  const quality = opts.quality || 'high';
  const state = {
    enabled: quality !== 'low',
    bloom: quality === 'high' ? 0.34 : 0.26,
    exposure: 1.04,
    vignette: 0.42,
    contrast: 1.045,
    saturation: 1.06,
    grain: 0.012,
    threshold: 0.92,
    width: 1,
    height: 1,
    scale: quality === 'high' ? 1 : 0.85,
    bloomScale: quality === 'high' ? 0.5 : 0.35,
  };

  const quad = new THREE.PlaneGeometry(2, 2);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function makeRT(w, h, samples) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: samples || 0,
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    return rt;
  }

  const sceneRT = makeRT(2, 2, quality === 'high' ? 4 : 2);
  const bloomRT = makeRT(2, 2, 0);
  const blurRT = makeRT(2, 2, 0);

  const brightMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tSrc: { value: null },
      texel: { value: new THREE.Vector2() },
      threshold: { value: state.threshold },
      softKnee: { value: 0.6 },
    },
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() } },
  });
  const compMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      bloomStrength: { value: state.bloom },
      exposure: { value: state.exposure },
      vignette: { value: state.vignette },
      contrast: { value: state.contrast },
      saturation: { value: state.saturation },
      grain: { value: state.grain },
      time: { value: 0 },
    },
  });

  const fsQuad = new THREE.Mesh(quad, brightMat);
  fsQuad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(fsQuad);

  const prevTarget = new THREE.WebGLRenderTarget(2, 2);
  const info = { calls: 0, triangles: 0 };

  function pass(mat, target) {
    fsQuad.material = mat;
    renderer.setRenderTarget(target || null);
    renderer.render(fsScene, cam);
  }

  function resize(w, h) {
    state.width = Math.max(1, Math.floor(w * state.scale));
    state.height = Math.max(1, Math.floor(h * state.scale));
    sceneRT.setSize(state.width, state.height);
    const bw = Math.max(1, Math.floor(w * state.bloomScale));
    const bh = Math.max(1, Math.floor(h * state.bloomScale));
    bloomRT.setSize(bw, bh);
    blurRT.setSize(bw, bh);
    prevTarget.setSize(state.width, state.height);
  }

  let time = 0;

  function render(dt) {
    time += dt || 0.016;
    if (!state.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    const w = renderer.domElement.width / (renderer.getPixelRatio() || 1);
    const h = renderer.domElement.height / (renderer.getPixelRatio() || 1);
    if (state.width === 1 || Math.abs(w * state.scale - state.width) > 2) resize(w, h);

    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;

    // 1) 场景 → HDR RT
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    info.calls = renderer.info.render.calls;
    info.triangles = renderer.info.render.triangles;

    // 2) 亮度提取 + 模糊
    brightMat.uniforms.tSrc.value = sceneRT.texture;
    brightMat.uniforms.texel.value.set(1 / state.width, 1 / state.height);
    brightMat.uniforms.threshold.value = state.threshold;
    pass(brightMat, bloomRT);

    const bw = bloomRT.width, bh = bloomRT.height;
    blurMat.uniforms.tSrc.value = bloomRT.texture;
    blurMat.uniforms.dir.value.set(1 / bw, 0);
    pass(blurMat, blurRT);
    blurMat.uniforms.tSrc.value = blurRT.texture;
    blurMat.uniforms.dir.value.set(0, 1 / bh);
    pass(blurMat, bloomRT);
    // 二次扩散（更大半径）
    blurMat.uniforms.tSrc.value = bloomRT.texture;
    blurMat.uniforms.dir.value.set(2 / bw, 0);
    pass(blurMat, blurRT);
    blurMat.uniforms.tSrc.value = blurRT.texture;
    blurMat.uniforms.dir.value.set(0, 2 / bh);
    pass(blurMat, bloomRT);

    // 3) 合成 → 屏幕
    compMat.uniforms.tScene.value = sceneRT.texture;
    compMat.uniforms.tBloom.value = bloomRT.texture;
    compMat.uniforms.time.value = time;
    compMat.uniforms.bloomStrength.value = state.bloom;
    pass(compMat, null);

    renderer.toneMapping = prevTone;
  }

  function setQuality(q) {
    state.enabled = q !== 'low';
    state.scale = q === 'high' ? 1 : 0.85;
    state.bloomScale = q === 'high' ? 0.5 : 0.35;
    state.bloom = q === 'high' ? 0.34 : 0.26;
    sceneRT.samples = q === 'high' ? 4 : 2;
    sceneRT.dispose();
    resize(state.width / (state.scale || 1), state.height / (state.scale || 1));
  }

  function dispose() {
    sceneRT.dispose(); bloomRT.dispose(); blurRT.dispose();
    brightMat.dispose(); blurMat.dispose(); compMat.dispose();
    quad.dispose(); prevTarget.dispose();
  }

  return { render, resize, setQuality, dispose, state, info };
}

export default { createPost };
