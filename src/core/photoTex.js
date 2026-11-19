// 照片立面贴图：把打包进来的 data URI 变成 THREE 贴图，按楼缓存。
// 体积策略：单张 512² JPEG q85 ≈ 40–90 KB；40 栋 ≈ 2–3.5 MB（base64 后 3–5 MB）。
import * as THREE from 'three';
import { FACADE_MAP } from '../assets/facade-data.js';

const cache = new Map();
let loader = null;

function getLoader() {
  if (!loader) loader = new THREE.TextureLoader();
  return loader;
}

/** 取某栋楼的立面贴图（无则返回 null） */
export function facadeTexture(name) {
  if (cache.has(name)) return cache.get(name);
  const m = FACADE_MAP[name];
  if (!m) { cache.set(name, null); return null; }
  const tex = getLoader().load(m.uri);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData = m;
  cache.set(name, tex);
  return tex;
}

/** 某栋楼是否有实拍贴图 */
export function hasFacade(name) { return !!FACADE_MAP[name]; }

/** 立面材质（按楼独立，独立 repeat）
 *  兜底：manifest 缺项 → null（调用方回落通用材质）；
 *        贴图解码失败 → 自动退成 manifest 里的石材色，不留白屏/黑块。
 *  opts.tint      整体乘色（压亮度/偏色），默认白
 *  opts.emissiveIntensity 补光强度（默认 0.17；过曝的楼可以压到 0.09） */
export function facadeMaterial(name, opts = {}) {
  const m = FACADE_MAP[name];
  if (!m || !m.uri) return null;
  const emI = opts.emissiveIntensity ?? 0.17;
  const mat = new THREE.MeshStandardMaterial({
    color: opts.albedo ?? opts.tint ?? 0xffffff,
    roughness: opts.roughness ?? 0.86,
    metalness: opts.metalness ?? 0.03,
    emissive: 0x2a251d,
    emissiveIntensity: 0.9,
  });
  const tex = getLoader().load(
    m.uri,
    undefined,
    undefined,
    () => {
      // 解码失败：抽掉贴图，只留纯色 —— 至少还是「一栋楼」，不会白屏/黑块
      mat.map = null;
      mat.emissiveMap = null;
      mat.emissive = new THREE.Color(0x2a251d);
      mat.emissiveIntensity = 0.9;
      mat.color.copy(hexColor(m.wallColor, '#d8d2c4'));
      mat.needsUpdate = true;
      console.warn('[photoTex] 立面贴图解码失败，回落纯色:', name);
    },
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.userData = m;
  mat.map = tex;
  // 背光面（朝北）只有半球光，照片会闷成一片灰。用自身颜色当自发光底做
  // 「天空补光」：按比例抬亮、不冲淡细节。实测 0.17 时北向立面最接近原片；
  // 再低（≤0.12）就发闷，再高（≥0.22）向阳面会糊。过曝的楼按调用方给的值压。
  mat.emissive = new THREE.Color(0xffffff);
  mat.emissiveIntensity = emI;
  mat.emissiveMap = tex;
  mat.userData = m;
  return mat;
}

/** 颜色工具：把 manifest 里的 hex 转 THREE.Color */
export function hexColor(s, fallback = '#cccccc') {
  try { return new THREE.Color(s || fallback); } catch (e) { return new THREE.Color(fallback); }
}

export function facadeStats() {
  let bytes = 0, n = 0;
  for (const f of Object.values(FACADE_MAP)) { bytes += f.uri.length; n++; }
  return { count: n, mb: +(bytes / 1024 / 1024).toFixed(2) };
}
