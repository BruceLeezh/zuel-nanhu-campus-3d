import * as THREE from 'three';
import { CFG } from './config.js';
import { cssHex, fbm } from './util.js';

// 天空穹顶（渐变着色器）+ 太阳 + 云层 + 光照
export function createSky(scene, renderer) {
  const S = CFG.sky;
  const geo = new THREE.SphereGeometry(1900, 40, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(S.top) },
      midColor: { value: new THREE.Color(S.mid) },
      botColor: { value: new THREE.Color(S.bottom) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(S.sunColor) },
      time: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 topColor, midColor, botColor, sunColor;
      uniform vec3 sunDir;
      uniform float time;
      varying vec3 vDir;
      // 廉价云：在方向球面上做一层 fbm
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm2(vec2 p){
        float s = 0.0, a = 0.5;
        mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
        for (int i = 0; i < 5; i++) { s += a * noise(p); p = rot * p * 2.03; a *= 0.5; }
        return s;
      }
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(botColor, midColor, smoothstep(0.0, 0.55, h));
        col = mix(col, topColor, smoothstep(0.5, 1.0, h));
        // 太阳光晕
        float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += sunColor * pow(sd, 260.0) * 3.2;
        col += sunColor * pow(sd, 8.0) * 0.16;
        // 地平线暖雾（与地面雾色衔接）
        col = mix(col, vec3(0.82, 0.86, 0.86), smoothstep(0.20, 0.0, h) * 0.34);
        // 云
        vec2 uv = vDir.xz / max(0.16, vDir.y + 0.32) * 0.9 + vec2(time * 0.004, time * 0.002);
        float c = fbm2(uv * 1.4);
        c = smoothstep(0.46, 0.80, c) * smoothstep(0.03, 0.34, vDir.y);
        col = mix(col, vec3(0.99, 0.99, 1.0), c * 0.72);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  // 太阳方向
  const sunDir = new THREE.Vector3(
    Math.cos(S.sunElevation) * Math.cos(S.sunAzimuth),
    Math.sin(S.sunElevation),
    Math.cos(S.sunElevation) * Math.sin(S.sunAzimuth)
  ).normalize();
  mat.uniforms.sunDir.value.copy(sunDir);

  const sun = new THREE.DirectionalLight(S.sunColor, S.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(700);
  sun.castShadow = true;
  const sm = CFG.render.shadowMapSize;
  sun.shadow.mapSize.set(sm, sm);
  const d = 150;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.2;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(S.hemiSky, S.hemiGround, S.hemiIntensity);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(S.ambient, S.ambientIntensity);
  scene.add(amb);

  // 雾
  scene.fog = new THREE.Fog(S.fogColor, S.fogNear, S.fogFar);

  return {
    dome, sun, hemi, amb, sunDir,
    /** 阴影相机跟随玩家，保证近处阴影分辨率 */
    follow(target) {
      sun.position.set(target.x + sunDir.x * 320, sunDir.y * 320, target.z + sunDir.z * 320);
      sun.target.position.set(target.x, 0, target.z);
      sun.target.updateMatrixWorld();
    },
    update(t, camera) {
      mat.uniforms.time.value = t;
      // 天空球跟随相机：球心固定在原点时，相机走到校园边缘会让远端球面
      // 距离超过相机 far，天空被裁出一个大黑洞。跟随相机后恒为 R=1900。
      if (camera) dome.position.copy(camera.position);
    },
  };
}
