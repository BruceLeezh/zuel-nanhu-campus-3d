// 共享电驴停放区：白线车位框 + 低多边形青白电驴
// 参考：douyin/gta_dianlu.jpg（电驴成排·白顶）、xiaoqing_tesla.jpg（青绿车身白座垫）
// 全部几何合进 1 个 GeoBuilder → 1 个 mesh ≈ 1 draw call。
import * as THREE from 'three';
import { heightAt } from '../terrain.js';
import { GeoBuilder } from './merge.js';

const TEALS = [0x2fb3a6, 0x36c2ae, 0x2a9c92, 0x3bb9a0];
const WHITE = 0xf2f1ea;
const DARK = 0x3b4044;
const LINE = 0xe8e6dc;

// 单辆低多边形电驴（≈9 盒 ~108 tris）。y 传地面高度。
function scooter(K, x, y, z, ry, body) {
  K.setFrame(x, y + 0.02, z, ry);
  // 轮（低多边形方块轮）
  K.box(0.16, 0.5, 0.5, { x: 0, y: 0, z: -0.62, color: DARK });
  K.box(0.16, 0.5, 0.5, { x: 0, y: 0, z: 0.7, color: DARK });
  // 踏板 + 座桶
  K.box(0.34, 0.2, 0.95, { x: 0, y: 0.3, z: 0.12, color: body });
  K.box(0.32, 0.34, 0.62, { x: 0, y: 0.5, z: -0.42, color: body });
  // 座垫（白）
  K.box(0.3, 0.14, 0.58, { x: 0, y: 0.84, z: -0.42, color: WHITE });
  // 转向柱 + 车把
  K.box(0.12, 0.55, 0.14, { x: 0, y: 0.6, z: 0.6, color: DARK });
  K.box(0.56, 0.09, 0.12, { x: 0, y: 1.08, z: 0.62, color: DARK });
  // 前脸挡泥板
  K.box(0.26, 0.34, 0.16, { x: 0, y: 0.52, z: 0.78, color: body });
}

// 白线车位框：spots 个格位（0.9m/格）× 2.2m 深，长边沿局部 x。
// 分段贴地形采样，避免长线浮空/入地。
function parkingBay(K, cx, cz, spots, ry) {
  const len = spots * 0.9;
  const yb = heightAt(cx, cz) + 0.03;
  K.setFrame(cx, yb, cz, ry);
  const c = Math.cos(ry), s = Math.sin(ry);
  const lift = (lx, lz) => heightAt(cx + lx * c + lz * s, cz - lx * s + lz * c) - yb;
  const seg = (w, d, lx, lz) => {
    K.box(w, 0.05, d, { x: lx, y: lift(lx, lz) + 0.02, z: lz, color: LINE, shade: false });
  };
  // 两条长边（每 1.8m 一段）+ 两端头 + 中间分隔线
  for (const sz of [-1, 1]) {
    for (let i = 0; i < Math.ceil(len / 1.8); i++) {
      const lx = -len / 2 + 0.9 + i * 1.8;
      seg(Math.min(1.8, len / 2 - Math.abs(lx) + 0.9), 0.14, lx, sz * 1.1);
    }
    seg(0.14, 2.2, -len / 2, 0); // 端头
    seg(0.14, 2.2, len / 2, 0);
  }
  for (let i = 1; i < spots; i++) {
    const lx = -len / 2 + i * 0.9;
    seg(0.12, 2.2, lx, 0);
  }
  return len;
}

// 一处停车区：白线框 + n 辆电驴（隔几格留空制造真实感）
function parkSpot(K, cx, cz, spots, ry, n) {
  const len = parkingBay(K, cx, cz, spots, ry);
  const c = Math.cos(ry), s = Math.sin(ry);
  let made = 0;
  for (let i = 0; i < spots && made < n; i++) {
    if ((i * 7 + spots * 3) % 5 === 0) continue;
    const lx = -len / 2 + 0.45 + i * 0.9;
    const wx = cx + lx * c, wz = cz - lx * s;
    scooter(K, wx, heightAt(wx, wz), wz, ry + Math.PI / 2 + ((i % 3) - 1) * 0.06, TEALS[(i + made) % TEALS.length]);
    made++;
  }
}

// 停车区布点（宿舍/食堂/教学楼/校门内侧，坐标来自 layout.js 建筑位置外推）
const SPOTS = [
  { x: -563, z: 149, ry: Math.PI / 2, spots: 8, n: 7 },   // 环湖公寓东侧
  { x: 800, z: -250, ry: 0, spots: 8, n: 7 },             // 滨湖公寓北侧
  { x: -529, z: -438, ry: 0, spots: 7, n: 6 },            // 望湖公寓南侧
  { x: 576, z: 532, ry: 0, spots: 7, n: 6 },              // 临湖公寓北侧
  { x: 215, z: 188, ry: 0, spots: 8, n: 7 },              // 中区学生公寓南侧
  { x: 127, z: -36, ry: 0, spots: 7, n: 6 },              // 第五食堂南侧
  { x: 162, z: 155, ry: 0, spots: 7, n: 6 },              // 第四食堂南侧
  { x: 403, z: 534, ry: 0, spots: 7, n: 6 },              // 临湖园食堂北侧
  { x: 434, z: -492, ry: Math.PI / 2, spots: 8, n: 7 },   // 北门内东侧
  { x: 834, z: 30, ry: Math.PI / 2, spots: 8, n: 7 },     // 东门内侧
];

export function createParking(scene) {
  const K = new GeoBuilder('parking');
  for (const sp of SPOTS) parkSpot(K, sp.x, sp.z, sp.spots, sp.ry, sp.n);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0.05,
  });
  const mesh = new THREE.Mesh(K.build(), mat);
  mesh.name = 'parking-scooters';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  const group = new THREE.Group();
  group.name = 'parking';
  group.add(mesh);
  scene.add(group);
  return { group, scooters: SPOTS.reduce((a, s) => a + s.n, 0), spots: SPOTS.length };
}
