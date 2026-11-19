import * as THREE from 'three';
import { CFG } from './config.js';
import { brickTexture, concreteTexture, tileRoofTexture, pavingTexture, facadeTexture, barkTexture, grassTexture } from './textures.js';
import { shade, tint, cssHex } from './util.js';

// 共享材质（控制 draw call 与显存）
const cache = new Map();
function reg(key, mat) { cache.set(key, mat); return mat; }

export function stdMat(opts = {}) {
  const key = 'std:' + JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial(opts);
  return reg(key, m);
}

export function basicMat(opts = {}) {
  const key = 'basic:' + JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshBasicMaterial(opts);
  return reg(key, m);
}

export function glassMat(color = 0x8fb4c9, opacity = 0.42) {
  const key = 'glass:' + color + ':' + opacity;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.1, roughness: 0.08, transparent: true, opacity,
    transmission: 0.55, thickness: 0.6, side: THREE.DoubleSide,
    envMapIntensity: 0.7, depthWrite: false,
  });
  return reg(key, m);
}

// 墙面材质：带窗户阵列贴图
export function facadeMat(wallColor, floors, bays, opts = {}) {
  const key = 'fac:' + [wallColor, floors, bays, opts.glass, opts.lit].join('|');
  if (cache.has(key)) return cache.get(key);
  const tex = facadeTexture(wallColor, Math.max(1, Math.round(floors)), Math.max(1, Math.round(bays)), opts);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.MeshStandardMaterial({
    map: tex, color: 0xffffff, roughness: 0.78, metalness: 0.02,
  });
  return reg(key, m);
}

// 砖墙（中山装式的红砖教学楼）
export function brickMat(color = 0xffffff) {
  const key = 'brick:' + color;
  if (cache.has(key)) return cache.get(key);
  const t = brickTexture();
  const m = new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.95, metalness: 0 });
  return reg(key, m);
}

export function concreteMat(color = 0xffffff) {
  const key = 'conc:' + color;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({ map: concreteTexture(), color, roughness: 0.88, metalness: 0.03 });
  return reg(key, m);
}

export function roofMat(color = 0x6f747d) {
  const key = 'roof:' + color;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({ map: tileRoofTexture(), color, roughness: 0.72, metalness: 0.12 });
  return reg(key, m);
}

export function pavingMat(color = 0xffffff) {
  const key = 'pav:' + color;
  if (cache.has(key)) return cache.get(key);
  const t = pavingTexture();
  t.repeat.set(1, 1);
  const m = new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.94, metalness: 0 });
  // 广场/道路贴地时用 polygonOffset 消除与地形的 z-fighting
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  return reg(key, m);
}

export function asphaltMat() {
  if (cache.has('asphaltM')) return cache.get('asphaltM');
  const m = new THREE.MeshStandardMaterial({ color: 0x565a5e, roughness: 0.96, metalness: 0.0 });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  return reg('asphaltM', m);
}

export function grassMat(color = 0xffffff) {
  const key = 'grassM:' + color;
  if (cache.has(key)) return cache.get(key);
  const t = grassTexture();
  t.repeat.set(90, 80);
  const m = new THREE.MeshStandardMaterial({ map: t, color, roughness: 1, metalness: 0 });
  return reg(key, m);
}

export function barkMat() {
  if (cache.has('barkM')) return cache.get('barkM');
  const t = barkTexture();
  const m = new THREE.MeshStandardMaterial({ map: t, color: 0xa89684, roughness: 0.95, metalness: 0 });
  return reg('barkM', m);
}

export function metalMat(color = 0x9aa3a8, rough = 0.45) {
  const key = 'metal:' + color + rough;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.75 });
  return reg(key, m);
}

export function emissiveMat(color, intensity = 1) {
  const key = 'emi:' + color + intensity;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: intensity, roughness: 0.6 });
  return reg(key, m);
}

// 树叶材质（面片 + 透明贴图 + alpha test，减少透明排序问题）
export function foliageMat(color = 0x4e7a3a) {
  const key = 'fol:' + color;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, flatShading: false,
  });
  return reg(key, m);
}

export function clearMaterialCache() { cache.clear(); }
export function materialCacheSize() { return cache.size; }
