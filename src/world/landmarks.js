// 校园地标：五羊雕塑 / 钟楼 / 旗杆 / 观景亭 / 湖心亭 / 曲桥 / 校训石 / 希贤岭碑 / 12 座校门
//
// 与 buildings.js 相同套路：所有构件写进按材质分桶的 GeoBuilder，
// 最后每桶一个 mesh → 地标总共约 12 个 draw call。
import * as THREE from 'three';
import { heightAt, waterLevel } from './terrain.js';
import { LANDMARKS, GATES } from './layout.js';
import { GeoBuilder } from './buildings/merge.js';
import { signAtlas, signUV, clockTex, flagTex, stoneTextTex } from './buildings/facade.js';
import { tileRoofTexture } from '../core/textures.js';

// ---------------------------------------------------------------------------
// 调色
// ---------------------------------------------------------------------------
const C = {
  stone: 0xc3bcae,
  stoneDk: 0x9a9284,
  stoneLt: 0xd7d1c2,
  granite: 0x6f6a62,
  trim: 0xefe9dc,
  trimWarm: 0xe3d9c4,
  roofTile: 0x767c85,
  roofRed: 0x8d5344,
  wood: 0x9c3a2c,
  woodDk: 0x6d2a20,
  metal: 0x9aa2a8,
  metalDk: 0x555b60,
  glass: 0x6a8490,
  gold: 0xc9a94e,
  dark: 0x4a4a48,
  white: 0xf3efe6,
};

const BUCKETS = [
  'stone', 'trim', 'metal', 'glass', 'roof', 'wood', 'dark',
  'gold', 'sign', 'flag', 'clock', 'motto', 'hill', 'flat',
];

function makeKit() {
  const K = {};
  for (const id of BUCKETS) K[id] = new GeoBuilder(id);
  return K;
}
function setFrame(K, x, y, z, ry) {
  for (const k in K) K[k].setFrame(x, y, z, ry);
}
function ringPoint(a, r) { return [Math.cos(a) * r, Math.sin(a) * r]; }

// ---------------------------------------------------------------------------
// 1) 山羊（雕塑单元）
// ---------------------------------------------------------------------------
function goat(K, x, y, z, s, ry, c) {
  const b = K.stone;
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const P = (lx, ly, lz) => [x + (lx * cs + lz * sn) * s, y + ly * s, z + (-lx * sn + lz * cs) * s];
  const B = (w, h, d, lx, ly, lz) => {
    const p = P(lx, ly, lz);
    b.box(w * s, h * s, d * s, { x: p[0], y: p[1], z: p[2], color: c, ry });
  };
  B(1.05, 0.92, 1.75, 0, 0.62, 0);
  B(0.94, 1.02, 0.7, 0, 0.66, 0.52);
  B(0.5, 0.9, 0.42, 0, 1.15, 0.82);
  B(0.46, 0.52, 0.72, 0, 1.72, 1.02);
  B(0.32, 0.3, 0.34, 0, 1.6, 1.42);
  for (const sx of [-1, 1]) {
    const h1 = P(sx * 0.17, 2.0, 0.98);
    b.cyl(0.03 * s, 0.12 * s, 0.55 * s, 5, { x: h1[0], y: h1[1], z: h1[2], color: 0x8f8879 });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-0.55, 0.55]) B(0.22, 0.72, 0.22, sx * 0.33, 0, sz);
  }
  B(0.16, 0.4, 0.16, 0, 0.86, -0.86);
}

function sculpture(K, l) {
  const s = l.s || 6;
  const R = s * 0.56;
  K.stone.box(s * 1.55, 0.3, s * 1.55, { y: -0.05, color: 0x9c9587 });
  K.stone.cyl(R * 1.12, R * 1.2, 0.75, 8, { y: 0.22, color: 0x8d8779 });
  K.trim.cyl(R * 0.98, R * 1.02, 0.22, 8, { y: 0.97, color: 0xb9b1a1 });
  K.stone.cyl(R * 0.9, R * 0.94, 0.55, 8, { y: 1.19, color: 0x9b9486 });
  K.stone.box(s * 0.44, s * 0.34, s * 0.44, { y: 1.74, color: 0xa9a294 });
  // 主羊放大到真人尺度的 2 倍多（真实五羊石像主羊约 5m 高，远看才有辨识度）
  goat(K, 0, 2.22, 0, s * 0.30, -0.18, 0xd9d3c4);
  const around = [[-0.62, 0.30, 0.9], [0.58, 0.34, -2.2], [-0.20, -0.62, 2.5], [0.42, -0.55, 1.1]];
  for (const [ax, az, ay] of around) {
    goat(K, ax * s * 0.46, 1.62, az * s * 0.46, s * 0.19, ay, 0xd2ccbd);
  }
}

// ---------------------------------------------------------------------------
// 2) 钟楼
// ---------------------------------------------------------------------------
function clocktower(K, l) {
  const H = l.h || 28;
  const W = l.w || 9;
  // ---- 湖心塔座：晓南湖水面 -1.6，塔座顶面 -0.5（露出水面 ~1.1m），
  //      八角石砌驳岸沉到水下 -3.4，四周一圈石望柱，看起来像「湖心岛上的钟楼」----
  const Rp = W * 0.62 + 2.2;
  K.stone.cyl(Rp + 0.9, Rp + 1.5, 3.0, 8, { y: -3.5, color: 0x8a8477 });
  K.trim.cyl(Rp + 0.7, Rp + 0.95, 0.36, 8, { y: -0.6, color: 0xb6ad9c });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const px = Math.cos(a) * Rp, pz = Math.sin(a) * Rp;
    K.stone.box(0.4, 1.05, 0.4, { x: px, z: pz, y: -0.28, color: 0xa8a191 });
  }
  K.stone.cyl(Rp + 0.28, Rp + 0.28, 0.16, 8, { y: 0.62, color: 0xb0a998 });
  const shaft = H * 0.40;
  const upper = H * 0.27;
  K.stone.box(W * 1.42, 1.1, W * 1.42, { y: -0.55, color: C.stone });
  K.trim.box(W * 1.22, 0.42, W * 1.22, { y: 0.55, color: C.stoneLt });
  K.trim.box(W, shaft, W, { y: 0.97, color: 0xe8e1d0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      K.trim.box(1.05, shaft, 1.05, { x: sx * (W / 2 - 0.35), y: 0.97, z: sz * (W / 2 - 0.35), color: C.white });
    }
  }
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      K.glass.box(0.95, shaft * 0.46, 0.2, { x: sx * (W * 0.22), y: 0.97 + shaft * 0.3, z: sz * (W / 2 - 0.02), color: 0x53646c });
    }
  }
  const y1 = 0.97 + shaft;
  K.trim.box(W + 0.95, 0.55, W + 0.95, { y: y1 - 0.1, color: C.trim });
  K.trim.box(W + 0.5, 0.28, W + 0.5, { y: y1 + 0.45, color: 0xd6cfbe });
  const W2 = W * 0.82;
  const y2 = y1 + 0.73;
  K.trim.box(W2, upper, W2, { y: y2, color: 0xeee7d6 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      K.trim.box(0.85, upper, 0.85, { x: sx * (W2 / 2 - 0.3), y: y2, z: sz * (W2 / 2 - 0.3), color: C.white });
    }
  }
  const cy0 = y2 + upper * 0.5 - 1.6;
  const csz = W2 * 0.46;
  const dz = W2 / 2 + 0.03;
  K.clock.panel(csz, csz, { y: cy0, z: dz });
  K.clock.panel(csz, csz, { y: cy0, z: -dz, ry: Math.PI });
  K.clock.panel(csz, csz, { y: cy0, x: dz, ry: Math.PI / 2 });
  K.clock.panel(csz, csz, { y: cy0, x: -dz, ry: -Math.PI / 2 });
  for (const sz of [-1, 1]) {
    K.trim.box(csz + 0.5, 0.22, 0.3, { y: cy0 + csz, z: sz * dz, color: C.trim });
    K.trim.box(csz + 0.5, 0.22, 0.3, { y: cy0 - 0.22, z: sz * dz, color: C.trim });
    K.trim.box(0.22, csz + 0.5, 0.3, { y: cy0, x: (csz + 0.5) / 2, z: sz * dz, color: C.trim });
    K.trim.box(0.22, csz + 0.5, 0.3, { y: cy0, x: -(csz + 0.5) / 2, z: sz * dz, color: C.trim });
  }
  const y3 = y2 + upper;
  K.trim.box(W2 + 1.5, 0.72, W2 + 1.5, { y: y3, color: C.trim });
  K.trim.box(W2 + 1.9, 0.26, W2 + 1.9, { y: y3 - 0.26, color: 0xd3cbba });
  const y4 = y3 + 0.72;
  const ph = H * 0.12;
  const pr = W2 * 0.30;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      K.trim.box(0.8, ph, 0.8, { x: sx * pr, y: y4, z: sz * pr, color: C.white });
      K.trim.box(1.1, 0.22, 1.1, { x: sx * pr, y: y4, z: sz * pr, color: C.stoneLt });
    }
  }
  K.trim.box(pr * 2 + 1.9, 0.42, pr * 2 + 1.9, { y: y4 + ph - 0.3, color: C.trim });
  K.trim.box(pr * 2 + 1.2, 1.15, pr * 2 + 1.2, { y: y4 + ph, color: 0xe4dccb });
  const y5 = y4 + ph + 1.15;
  const roofH = Math.max(2.6, Math.min(H - y5, 4.6));
  K.roof.hipRoof(W2 + 0.6, W2 + 0.6, roofH, { y: y5, overhang: 0.85, color: C.roofRed });
  K.roof.box(1.0, 0.4, 1.0, { y: y5 + roofH - 0.1, color: 0x6b4238 });
  K.gold.cyl(0.06, 0.34, 1.7, 8, { y: y5 + roofH + 0.3, color: C.gold });
  K.gold.cyl(0.22, 0.22, 0.3, 8, { y: y5 + roofH + 1.95, color: 0xdcc069 });
}

// ---------------------------------------------------------------------------
// 3) 旗杆
// ---------------------------------------------------------------------------
function flagpole(K, l) {
  const H = l.h || 22;
  K.stone.box(4.6, 0.26, 4.6, { y: -0.05, color: 0xb8b1a2 });
  K.stone.box(3.3, 0.36, 3.3, { y: 0.2, color: C.stone });
  K.trim.box(2.4, 0.22, 2.4, { y: 0.56, color: C.stoneLt });
  K.metal.cyl(0.07, 0.17, H, 10, { y: 0.78, color: 0xdadfe2 });
  K.gold.cyl(0.17, 0.17, 0.34, 8, { y: 0.78 + H, color: C.gold });
  K.flag.panel(3.3, 2.2, { x: 1.68, y: 0.78 + H - 2.75, z: 0.1 });
  K.trim.box(1.05, 0.42, 0.12, { y: 0.2, z: 1.68, color: 0xc8bfa9 });
}

// ---------------------------------------------------------------------------
// 4) 六角亭
// ---------------------------------------------------------------------------
function pavilion(K, l) {
  const s = l.s || 7;
  const rp = s * 0.86;
  const rc = rp * 0.76;
  const colH = s * 0.52;
  K.stone.cyl(rp * 1.1, rp * 1.16, 0.34, 6, { y: -0.1, color: 0xb5ada0 });
  K.stone.cyl(rp, rp * 1.02, 0.5, 6, { y: 0.24, color: C.stone });
  for (let i = 0; i < 3; i++) {
    K.stone.box(3.2 + i * 0.9, 0.18, 0.9, { y: 0.02 + i * 0.17, z: rp + 0.6 + i * 0.42, color: i % 2 ? 0xbcb4a6 : C.stone });
  }
  const y0 = 0.74;
  const angs = [];
  for (let i = 0; i < 6; i++) angs.push(Math.PI / 6 + (i / 6) * Math.PI * 2);
  for (const a of angs) {
    const [px, pz] = ringPoint(a, rc);
    K.stone.cyl(0.27, 0.31, 0.3, 8, { x: px, y: y0, z: pz, color: C.stoneDk });
    K.wood.cyl(0.155, 0.175, colH, 8, { x: px, y: y0 + 0.3, z: pz, color: C.wood });
  }
  for (let i = 0; i < 6; i++) {
    const a0 = angs[i], a1 = angs[(i + 1) % 6];
    const mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * rc;
    const mz = (Math.sin(a0) + Math.sin(a1)) * 0.5 * rc;
    const dx = Math.cos(a1) - Math.cos(a0), dz2 = Math.sin(a1) - Math.sin(a0);
    const chord = Math.hypot(dx, dz2) * rc;
    const ryb = Math.atan2(-dz2, dx);
    K.wood.box(chord * 0.94, 0.14, 0.42, { x: mx, y: y0 + 0.42, z: mz, color: 0x8c4a35, ry: ryb });
  }
  const yb = y0 + 0.3 + colH;
  for (let i = 0; i < 6; i++) {
    const a0 = angs[i], a1 = angs[(i + 1) % 6];
    const mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * rc;
    const mz = (Math.sin(a0) + Math.sin(a1)) * 0.5 * rc;
    const dx = Math.cos(a1) - Math.cos(a0), dz2 = Math.sin(a1) - Math.sin(a0);
    const chord = Math.hypot(dx, dz2) * rc;
    const ryb = Math.atan2(-dz2, dx);
    K.wood.box(chord * 1.02, 0.36, 0.28, { x: mx, y: yb - 0.36, z: mz, color: 0xa8422f, ry: ryb });
    K.trim.box(chord * 1.06, 0.14, 0.36, { x: mx, y: yb, z: mz, color: C.trimWarm, ry: ryb });
  }
  K.trim.cyl(rp * 0.98, rp * 1.0, 0.3, 6, { y: yb + 0.14, color: C.trim });
  K.wood.cyl(rp * 1.02, rp * 1.02, 0.16, 6, { y: yb + 0.44, color: 0x8e3a2a });
  const roofH = s * 0.46;
  K.roof.cyl(0.3, rp * 1.16, roofH, 6, { y: yb + 0.6, color: C.roofTile });
  K.roof.cyl(rp * 1.16, rp * 1.2, 0.14, 6, { y: yb + 0.6, color: 0x5e6570 });
  for (const a of angs) {
    const [px, pz] = ringPoint(a, rp * 1.17);
    K.roof.box(0.9, 0.16, 0.5, { x: px, y: yb + 0.72, z: pz, color: 0x5e6570, ry: -a });
  }
  K.wood.cyl(0.16, 0.22, 0.5, 6, { y: yb + 0.6 + roofH - 0.1, color: C.woodDk });
  K.gold.cyl(0.2, 0.2, 0.3, 8, { y: yb + 0.6 + roofH + 0.4, color: C.gold });
}

// ---------------------------------------------------------------------------
// 5) 曲桥（四段折线 + 石栏）
// ---------------------------------------------------------------------------
function bridge(K, l) {
  const len = l.len || 56;
  const segs = [0.28, 0.26, 0.24, 0.22];
  const zig = [0, 1.9, 0.3, 2.0];
  let x = -len / 2;
  const wd = 3.0;
  for (let i = 0; i < segs.length; i++) {
    const sl = len * segs[i];
    const cx = x + sl / 2;
    const cz = zig[i];
    K.stone.box(sl + 0.5, 0.34, wd, { x: cx, y: 0.62, z: cz, color: 0xc8c1b2 });
    K.stone.box(sl + 0.5, 0.16, wd + 0.5, { x: cx, y: 0.48, z: cz, color: 0xb0a89a });
    for (const t of [-0.5, 0.5]) {
      const px = cx + sl * t * 0.86;
      for (const sz of [-1, 1]) {
        K.stone.box(0.8, 3.4, 0.8, { x: px, y: -2.2, z: cz + sz * wd * 0.34, color: 0xa79f92 });
      }
    }
    for (const sz of [-1, 1]) {
      K.stone.box(sl + 0.4, 0.5, 0.18, { x: cx, y: 1.02, z: cz + sz * wd * 0.46, color: 0xd0c9ba });
      K.trim.box(sl + 0.5, 0.14, 0.28, { x: cx, y: 1.52, z: cz + sz * wd * 0.46, color: C.stoneLt });
      const np = Math.max(2, Math.round(sl / 4.2));
      for (let k = 0; k <= np; k++) {
        const px = cx - sl / 2 + (sl * k) / np;
        K.trim.box(0.22, 0.72, 0.22, { x: px, y: 1.1, z: cz + sz * wd * 0.46, color: 0xdad3c4 });
      }
    }
    x += sl;
  }
}

// ---------------------------------------------------------------------------
// 6) 校训石
// ---------------------------------------------------------------------------
function mottoStone(K, l) {
  K.stone.box(10.5, 0.22, 4.6, { y: -0.06, color: 0xb4ac9d });
  K.trim.box(9.4, 0.28, 3.8, { y: 0.16, color: C.stoneLt });
  const gy = 0.44;
  K.stone.box(7.6, 2.05, 1.7, { y: gy, color: 0x9d9486 });
  K.stone.box(7.0, 0.55, 1.45, { y: gy + 2.05, color: 0xa59c8e });
  K.stone.box(5.6, 0.42, 1.2, { y: gy + 2.6, color: 0x968d80 });
  for (const sx of [-1, 1]) {
    K.stone.box(1.5, 1.35, 1.5, { x: sx * 3.55, y: gy, z: 0, color: 0x958c7f });
    K.stone.box(1.0, 0.75, 1.1, { x: sx * 3.9, y: gy, z: 0.18, color: 0x9e9587 });
  }
  K.trim.box(6.6, 1.62, 0.1, { y: gy + 0.28, z: 0.86, color: 0xb9b0a0 });
  K.motto.panel(6.2, 1.42, { y: gy + 0.36, z: 0.93 });
  K.stone.box(1.1, 0.9, 0.16, { x: 4.9, y: 0.5, z: 1.9, color: 0x8f8779, ry: -0.3 });
}

// ---------------------------------------------------------------------------
// 7) 希贤岭碑
// ---------------------------------------------------------------------------
function hillStele(K, l) {
  K.stone.box(3.9, 0.45, 2.2, { y: -0.12, color: 0xb1a99a });
  K.trim.box(3.2, 0.3, 1.7, { y: 0.33, color: C.stoneLt });
  K.stone.box(2.7, 0.6, 1.25, { y: 0.63, color: 0x867e71 });
  const y0 = 1.23;
  K.stone.box(2.0, 3.3, 0.55, { y: y0, color: C.granite });
  K.stone.box(2.16, 0.22, 0.68, { y: y0 + 3.3, color: 0x7c766c });
  K.trim.box(1.42, 2.55, 0.06, { y: y0 + 0.35, z: 0.29, color: 0x585149 });
  K.hill.panel(1.25, 2.4, { y: y0 + 0.42, z: 0.33 });
  for (let i = 0; i < 3; i++) {
    K.stone.box(4.4 + i * 0.9, 0.18, 0.8, { y: 0.02 + i * 0.16, z: 1.5 + i * 0.4, color: i % 2 ? 0xbab2a3 : 0xc5bdae });
  }
}

// ---------------------------------------------------------------------------
// 8) 校门 —— 主门按实拍参考（douyin/meipaizhao + youleyuan）重做：
//    双联石砌柱群（主柱+副柱）+ 高门楣（校名横匾 + 校徽圆牌）+ 电动伸缩门
//    + 人车分道白线/隔离墩；侧门简化双柱 + 道闸。
// ---------------------------------------------------------------------------
function stoneCourses(K, cx, pw, y0, y1, step, color) {
  // 石砌横缝：每 step 一道略宽于柱身的暗色带（模拟块石分层）
  for (let y = y0; y < y1 - 0.35; y += step) {
    K.stone.box(pw + 0.08, 0.13, pw + 0.08, { x: cx, y, z: 0, color });
  }
}

function gateEmblem(K, x, y, z) {
  // 校徽圆牌：金色八角环 + 米白圆面 + 金色内芯（低多边形近似圆）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    K.gold.box(0.72, 0.72, 0.16, { x: x + Math.cos(a) * 0.7, y, z, ry: a + Math.PI / 8, color: 0xd9b95c });
  }
  K.trim.box(1.42, 1.42, 0.18, { x, y, z, ry: Math.PI / 8, color: 0xf2ead8 });
  K.trim.box(1.0, 1.0, 0.2, { x, y, z, color: 0xe9e0cb });
  K.gold.cyl(0.28, 0.28, 0.22, 8, { x, y: y - 0.02, z, color: 0xc9a94e });
}

function buildGate(K, g) {
  const gy = heightAt(g.x, g.z);
  setFrame(K, g.x, gy + 0.02, g.z, g.rot || 0);
  const w = g.w || 12;
  const main = !!g.main;
  const baseY = 0.28;
  const rot = g.rot || 0;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  // 局部 → 世界高度采样（分道白线贴地形）
  const lift = (lx, lz) =>
    heightAt(g.x + lx * cs + lz * sn, g.z - lx * sn + lz * cs) - (gy + 0.02);

  let px, pw, ph, topX;
  if (main) {
    // ---- 双联柱群：主柱 3.0×11.5 + 副柱 1.8×8.5（每组两柱）----
    pw = 3.0; ph = 11.5;
    const p2w = 1.8, p2h = 8.5;
    px = w / 2 + pw / 2;
    const p2x = px + pw / 2 + 1.1 + p2w / 2;
    topX = p2x;
    for (const sx of [-1, 1]) {
      K.stone.box(pw + 1.4, 1.0, pw + 1.4, { x: sx * px, y: -0.4, color: 0xaba394 });
      K.stone.box(pw, ph, pw, { x: sx * px, y: baseY, color: 0xd2cbb9 });
      stoneCourses(K, sx * px, pw, baseY + 0.9, baseY + ph - 0.8, 1.15, 0xb8b0a0);
      K.trim.box(pw + 0.55, 0.32, pw + 0.55, { x: sx * px, y: baseY + ph - 0.32, color: C.trim });
      K.trim.box(pw + 0.2, 0.24, pw + 0.2, { x: sx * px, y: baseY + ph, color: 0xdcd4c2 });
      K.metal.box(0.3, 0.5, 0.3, { x: sx * px, y: baseY + ph + 0.24, color: C.metalDk });
      K.gold.cyl(0.26, 0.32, 0.44, 8, { x: sx * px, y: baseY + ph + 0.74, color: 0xf4e6bc });

      K.stone.box(p2w + 0.9, 0.8, p2w + 0.9, { x: sx * p2x, y: -0.3, color: 0xb0a898 });
      K.stone.box(p2w, p2h, p2w, { x: sx * p2x, y: baseY, color: 0xcac3b1 });
      stoneCourses(K, sx * p2x, p2w, baseY + 0.8, baseY + p2h - 0.5, 1.15, 0xb6ae9d);
      K.trim.box(p2w + 0.4, 0.26, p2w + 0.4, { x: sx * p2x, y: baseY + p2h - 0.26, color: C.trim });
      K.trim.box(p2w + 0.12, 0.2, p2w + 0.12, { x: sx * p2x, y: baseY + p2h, color: 0xd8d0be });
      K.metal.box(0.22, 0.4, 0.22, { x: sx * p2x, y: baseY + p2h + 0.2, color: C.metalDk });
      K.gold.cyl(0.18, 0.22, 0.34, 8, { x: sx * p2x, y: baseY + p2h + 0.6, color: 0xf4e6bc });
    }
    // ---- 门楣横梁（嵌进主柱顶）+ 梁身横缝 + 压顶 ----
    const bl = w + pw * 2, bh = 2.7, bd = 1.7;
    const by = baseY + ph - bh;
    K.stone.box(bl, bh, bd, { y: by, color: 0xd6cfbe });
    K.stone.box(bl + 0.08, 0.14, bd + 0.08, { y: by + 0.5, color: 0xb8b0a0 });
    K.stone.box(bl + 0.08, 0.14, bd + 0.08, { y: by + bh - 0.75, color: 0xb8b0a0 });
    K.trim.box(bl + 0.5, 0.3, bd + 0.45, { y: by + bh - 0.15, color: C.trim });
    K.trim.box(bl + 0.24, 0.22, bd + 0.24, { y: by + bh + 0.15, color: 0xdcd4c2 });
    K.trim.box(bl - 0.3, 0.24, bd + 0.12, { y: by - 0.12, color: 0xc7bfae });
    // ---- 校名横匾（双面）----
    const uv = signUV('中南财经政法大学');
    const sw = Math.min(w * 0.42, 10);
    if (uv) {
      K.sign.panel(sw, sw / 3.76, { y: by + bh * 0.5, z: bd / 2 + 0.03, uv });
      K.sign.panel(sw, sw / 3.76, { y: by + bh * 0.5, z: -bd / 2 - 0.03, ry: Math.PI, uv });
    }
    // ---- 校徽圆牌（梁顶中央）----
    K.metal.box(0.3, 0.8, 0.3, { y: baseY + ph + 0.1, color: C.metalDk });
    gateEmblem(K, 0, baseY + ph + 1.55, 0);
    // ---- 电动伸缩门（中央车道）----
    const gw = Math.min(w * 0.42, 9.6);
    const ng = Math.max(10, Math.round(gw / 0.62));
    for (let i = 0; i <= ng; i++) {
      const gx = -gw / 2 + (gw * i) / ng;
      K.metal.box(0.16, 1.3, 0.07, { x: gx, y: 0.12, z: 0, color: i % 2 ? 0xaab2b8 : 0x687076 });
    }
    K.metal.box(gw + 0.5, 0.12, 0.16, { y: 1.52, z: 0, color: 0x9aa2a8 });
    K.metal.box(gw + 0.5, 0.1, 0.14, { y: 0.2, z: 0, color: 0x8b9398 });
    for (const ex of [-1, 1]) {
      K.metal.box(0.5, 1.7, 0.5, { x: ex * (gw / 2 + 0.3), y: 0.05, z: 0, color: 0x7d858b });
      K.trim.box(0.56, 0.14, 0.56, { x: ex * (gw / 2 + 0.3), y: 1.75, z: 0, color: 0xd8d3c8 });
    }
    // ---- 人车分道：贴地白线（跟随地形）+ 橙色隔离墩 ----
    for (const sx of [-1, 1]) {
      const lx = sx * (w * 0.27);
      for (let i = 0; i < 6; i++) {
        const lz = -6.2 + i * 2.3;
        K.flat.box(0.2, 0.06, 2.1, { x: lx, y: lift(lx, lz + 1.05) + 0.1, z: lz + 1.05, color: 0xf3f2ec });
      }
      for (let i = 0; i < 4; i++) {
        const lz = -4.6 + i * 3.1;
        const by2 = lift(lx, lz) + 0.08;
        K.metal.cyl(0.13, 0.15, 0.62, 6, { x: lx, y: by2, z: lz, color: 0xd97b35 });
        K.metal.cyl(0.15, 0.15, 0.1, 6, { x: lx, y: by2 + 0.62, z: lz, color: 0xe8e6e0 });
      }
    }
  } else {
    // ---- 侧门：双柱 + 门楣 + 门牌（简化）----
    pw = 2.0; ph = 7.5;
    px = w / 2 + pw / 2;
    topX = px;
    for (const sx of [-1, 1]) {
      K.stone.box(pw + 1.0, 0.9, pw + 1.0, { x: sx * px, y: -0.35, color: 0xaba394 });
      K.stone.box(pw, ph, pw, { x: sx * px, y: baseY, color: 0xd0c9b8 });
      stoneCourses(K, sx * px, pw, baseY + 0.85, baseY + ph - 0.7, 1.1, 0xb7afa0);
      K.trim.box(pw + 0.45, 0.28, pw + 0.45, { x: sx * px, y: baseY + ph - 0.28, color: C.trim });
      K.trim.box(pw + 0.15, 0.2, pw + 0.15, { x: sx * px, y: baseY + ph, color: 0xdad2c0 });
      K.metal.box(0.26, 0.42, 0.26, { x: sx * px, y: baseY + ph + 0.2, color: C.metalDk });
      K.gold.cyl(0.2, 0.26, 0.36, 8, { x: sx * px, y: baseY + ph + 0.62, color: 0xf4e6bc });
    }
    const bh = 1.5, bd = 1.15;
    const by = baseY + ph - bh;
    K.stone.box(w + pw * 2 + 0.4, bh, bd, { y: by, color: 0xd2cbb9 });
    K.stone.box(w + pw * 2 + 0.5, 0.13, bd + 0.06, { y: by + bh - 0.55, color: 0xb7afa0 });
    K.trim.box(w + pw * 2 + 0.8, 0.26, bd + 0.35, { y: by + bh - 0.1, color: C.trim });
    const uv = signUV(g.name);
    if (uv) {
      const sw = Math.min(w * 0.5, 6.4);
      K.sign.panel(sw, sw / 3.76, { y: by + bh * 0.5, z: bd / 2 + 0.03, uv });
    }
  }

  // ---- 门卫亭（主门双侧 / 侧门单侧，外移避开柱群）----
  const houses = main ? [-1, 1] : [1];
  for (const s of houses) {
    const hx = s * (topX + 3.4);
    const hz = 3.1;
    K.stone.box(4.4, 0.5, 3.8, { x: hx, y: -0.25, z: hz, color: 0xada596 });
    K.trim.box(3.9, 3.05, 3.3, { x: hx, y: 0.25, z: hz, color: 0xe6dfd0 });
    K.glass.box(1.9, 1.25, 0.14, { x: hx + 0.55, y: 1.5, z: hz + 1.68, color: C.glass });
    K.trim.box(2.1, 0.14, 0.2, { x: hx + 0.55, y: 2.75, z: hz + 1.7, color: C.trim });
    K.trim.box(2.1, 0.14, 0.2, { x: hx + 0.55, y: 1.4, z: hz + 1.7, color: C.trim });
    K.dark.box(0.85, 2.05, 0.12, { x: hx - 1.15, y: 0.25, z: hz + 1.66, color: 0x5f5a52 });
    K.trim.box(4.6, 0.32, 3.9, { x: hx, y: 3.3, z: hz, color: C.trim });
    K.flat.box(4.2, 0.5, 3.5, { x: hx, y: 3.62, z: hz, color: 0xc9c3b6 });
    K.metal.box(0.8, 0.6, 0.7, { x: hx + 0.8, y: 4.12, z: hz - 0.6, color: 0xb4babd });
  }

  // ---- 道闸（红白杆）----
  const bx = -w / 2 + 2.6;
  K.metal.box(0.55, 1.2, 0.6, { x: bx, y: 0.12, z: 1.0, color: 0xd8d3c8 });
  K.trim.box(0.62, 0.16, 0.68, { x: bx, y: 1.32, z: 1.0, color: 0x8d94e0 });
  const barLen = Math.min(w * 0.5, 8.5);
  const nseg = 8;
  for (let i = 0; i < nseg; i++) {
    K.dark.box(barLen / nseg, 0.13, 0.16, {
      x: bx + barLen * (i + 0.5) / nseg, y: 1.06, z: 1.0,
      color: i % 2 ? 0xd8422f : 0xf2efe6,
    });
  }
  // ---- 道闸机箱 × 2 ----
  for (const s of [-1, 1]) {
    const gx = s * (w * 0.5 - 1.1);
    K.metal.box(1.6, 1.0, 1.6, { x: gx, y: 0.06, z: 2.6, color: 0xcfd3d6 });
    K.glass.box(1.5, 1.7, 0.1, { x: gx, y: 1.06, z: 2.6, color: 0x8fa8b4 });
    K.trim.box(1.7, 0.14, 1.7, { x: gx, y: 2.76, z: 2.6, color: C.trim });
  }
  // ---- 后缘石柱 ----
  const nb = Math.round(w / 3.2);
  for (let i = 0; i <= nb; i++) {
    const x = -w / 2 + 0.9 + ((w - 1.8) * i) / nb;
    if (Math.abs(x) < 2.2) continue;
    K.stone.cyl(0.32, 0.35, 0.72, 8, { x, y: 0.02, z: -1.9, color: 0xbfb8a9 });
  }
  return { x: g.x, z: g.z, w: topX * 2 + 5, d: 10, h: baseY + ph, rot: g.rot || 0 };
}

// ---------------------------------------------------------------------------
// 材质
// ---------------------------------------------------------------------------
function buildMaterials(atlas) {
  const M = {};
  const vc = (rough, metal) => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: rough, metalness: metal,
  });
  M.stone = vc(0.93, 0.02);
  M.trim = vc(0.82, 0.03);
  M.metal = vc(0.42, 0.35);
  M.glass = vc(0.12, 0.25);
  M.wood = vc(0.72, 0.02);
  M.dark = vc(0.6, 0.2);
  M.gold = vc(0.35, 0.55);
  M.flat = vc(0.95, 0.02);
  M.roof = new THREE.MeshStandardMaterial({
    map: tileRoofTexture(), vertexColors: true, roughness: 0.7, metalness: 0.08,
    // 与 buildings 的坡屋顶同理：瓦片贴图平均亮度低 + 背光面极易黑成一片。
    // 加自发光兜底 + 双面（坡/攒尖屋顶的法线朝内）。
    emissive: 0x575147, emissiveIntensity: 1.0, side: THREE.DoubleSide,
  });
  M.sign = new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.78, metalness: 0 });
  M.flag = new THREE.MeshStandardMaterial({ map: flagTex(), roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  M.clock = new THREE.MeshStandardMaterial({ map: clockTex(), roughness: 0.6, metalness: 0.05 });
  M.motto = new THREE.MeshStandardMaterial({
    map: stoneTextTex('博文明理  厚德济世', { w: 1024, h: 240, fg: '#f0e2bc' }),
    roughness: 0.55, metalness: 0.05, transparent: true,
  });
  M.hill = new THREE.MeshStandardMaterial({
    map: stoneTextTex('希贤岭', { w: 256, h: 768, vertical: true, fg: '#ecdfb8' }),
    roughness: 0.55, metalness: 0.05, transparent: true,
  });
  return M;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
export function createLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'landmarks';

  const names = [];
  for (const g of GATES) if (g.name) names.push(g.name);
  names.push('中南财经政法大学');
  const atlas = signAtlas(Array.from(new Set(names)));

  const K = makeKit();
  const colliders = [];
  const interactables = [];

  for (const l of LANDMARKS) {
    const kind = l.kind || l.type;
    const gy = heightAt(l.x, l.z);
    const y = kind === 'bridge' ? waterLevel() : gy;
    setFrame(K, l.x, y + 0.02, l.z, l.rot || 0);
    try {
      if (kind === 'sculpture') {
        sculpture(K, l);
        colliders.push({ x: l.x, z: l.z, w: (l.s || 6) * 1.3, d: (l.s || 6) * 1.3, h: (l.s || 6) * 1.1, rot: 0 });
        interactables.push({ x: l.x, z: l.z, r: 6, label: '五羊雕塑', kind: 'statue' });
      } else if (kind === 'clocktower') {
        clocktower(K, l);
        colliders.push({ x: l.x, z: l.z, w: (l.w || 9) * 1.45, d: (l.w || 9) * 1.45, h: l.h || 28, rot: 0 });
        interactables.push({ x: l.x, z: l.z, r: 7, label: '钟楼', kind: 'tower' });
      } else if (kind === 'flagpole') {
        flagpole(K, l);
        colliders.push({ x: l.x, z: l.z, w: 4.2, d: 4.2, h: 1.0, rot: 0 });
      } else if (kind === 'pavilion') {
        pavilion(K, l);
        colliders.push({ x: l.x, z: l.z, w: (l.s || 7) * 1.8, d: (l.s || 7) * 1.8, h: (l.s || 7) * 1.1, rot: 0 });
        interactables.push({ x: l.x, z: l.z, r: 5, label: l.name || '亭', kind: 'pavilion' });
      } else if (kind === 'bridge') {
        bridge(K, l);
      } else if (kind === 'motto') {
        mottoStone(K, l);
        colliders.push({ x: l.x, z: l.z, w: 10.5, d: 4.6, h: 3.2, rot: l.rot || 0 });
        interactables.push({ x: l.x, z: l.z, r: 7, label: l.text || '校训石', kind: 'motto' });
      }
    } catch (e) {
      console.warn('[landmarks] 生成失败', kind, e);
    }
  }

  for (const g of GATES) {
    try {
      colliders.push(buildGate(K, g));
    } catch (e) {
      console.warn('[landmarks] 校门失败', g.name, e);
    }
  }

  const M = buildMaterials(atlas);
  for (const id of Object.keys(K)) {
    const gb = K[id];
    if (!gb || gb.empty) continue;
    const mesh = new THREE.Mesh(gb.build(), M[id]);
    mesh.name = 'lm-' + id;
    mesh.castShadow = id === 'stone' || id === 'roof' || id === 'wood';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  scene.add(group);
  return { group, colliders, interactables };
}
