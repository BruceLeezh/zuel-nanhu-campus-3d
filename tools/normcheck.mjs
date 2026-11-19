// 诊断：检查树的合并几何里「存储法线 vs 绕序法线」是否一致
import * as THREE from 'three';
import { GeoBuilder, icoGeo, rgb, mixRgb } from '../src/world/props/merge.js';

// 复刻 trees.js 里最小的 blob 逻辑
const b = new GeoBuilder('t');
const m = new THREE.Matrix4().compose(
  new THREE.Vector3(0, 8, 0),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, 0.2)),
  new THREE.Vector3(1.4, 1.2, 1.4)
);
b.add(icoGeo(), m, { colorRgb: rgb(0x4a6a33), jitter: 0.1 });
const geo = b.build();
const P = geo.getAttribute('position');
const N = geo.getAttribute('normal');
let agree = 0, disagree = 0, out = 0, inward = 0;
const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3();
const fn = new THREE.Vector3(), vn = new THREE.Vector3(), cen = new THREE.Vector3();
for (let i = 0; i < P.count; i += 3) {
  a.fromBufferAttribute(P, i); bb.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
  fn.copy(bb).sub(a).cross(new THREE.Vector3().copy(c).sub(a)).normalize();
  vn.set(0, 0, 0);
  for (let k = 0; k < 3; k++) vn.add(new THREE.Vector3().fromBufferAttribute(N, i + k));
  vn.normalize();
  const d = fn.dot(vn);
  if (d > 0) agree++; else disagree++;
  // 以 blob 中心 (0,8,0) 判断内外
  cen.copy(a).add(bb).add(c).divideScalar(3).sub(new THREE.Vector3(0, 8, 0)).normalize();
  if (fn.dot(cen) > 0) out++; else inward++;
}
console.log(JSON.stringify({ tris: agree + disagree, agree, disagree, out, inward }));
