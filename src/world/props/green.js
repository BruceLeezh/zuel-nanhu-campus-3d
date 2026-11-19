// 植被配角：绿篱 / 花坛 / 灌木 / 草簇 / 花丛 / 湖岸驳石 / 木栈道 / 芦苇。
// 除草簇（InstancedMesh）外全部合并进 stone/wood/bush/grass 各 1 个 mesh。
import * as THREE from 'three';
import { PLAZAS, LAKE, BUILDINGS, ROADS } from '../layout.js';
import { heightAt } from '../terrain.js';
import { GeoBuilder, icoGeo, rgb } from './merge.js';
import {
  propMaterials, buildingClearance, roadClearance,
  inWater, inPlaza, inSports, insideCampus, SEED, sampleAlong,
} from './shared.js';
import { makeRng } from '../../core/util.js';

const C = {
  hedgeDark: 0x39562c,
  hedge: 0x44692f,
  hedgeLight: 0x4e7735,
  shrub: 0x4a6f33,
  soil: 0x5a4632,
  curb: 0xb4b0a6,
  flower: [0xd8544a, 0xe8b93c, 0xd97fae, 0xf0ede0, 0xc75f2f, 0xa86fc0],
  rock: [0x8e8b84, 0x7e7b75, 0x9a968d, 0x6f6d68],
  reed: 0x9d9750,
  reedTip: 0xb9ab63,
  plank: 0x9a7550,
  plank2: 0x8a6749,
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return _m.compose(
    new THREE.Vector3(x, y, z),
    _q.setFromEuler(_e.set(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  ).clone();
}

// ------------------------------------------------------------------ 绿篱
/** 沿折线撒绿篱块（自带随机抖动的方块 + 顶部小球） */
function hedgeLine(b, pts, halfW, h, opts = {}) {
  const step = opts.step || 2.2;
  const jitter = opts.jitter == null ? 0.1 : opts.jitter;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], bb = pts[i + 1];
    const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    const yaw = Math.atan2(-(bb[1] - a[1]), bb[0] - a[0]);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (bb[0] - a[0]) * t;
      const z = a[1] + (bb[1] - a[1]) * t;
      if (opts.skip && opts.skip(x, z)) continue;
      const gy = heightAt(x, z);
      const hh = h * (0.92 + b.rand() * 0.16);
      b.addBox(step * 1.02, hh, halfW * 2, {
        x, y: gy + hh * 0.5, z, ry: yaw, color: C.hedge, jitter: jitter,
      });
      // 顶部修剪起伏
      if (b.rand() < 0.35) {
        b.add(icoGeo(), mat4(
          x + (b.rand() - 0.5) * 0.3, gy + hh - 0.06, z + (b.rand() - 0.5) * 0.3,
          b.rand() * 0.6, b.rand() * 6.28, b.rand() * 0.6,
          halfW * 0.9, 0.16, halfW * 0.9
        ), { color: C.hedgeLight, jitter: 0.12 });
      }
    }
  }
}

/** 椭圆/矩形环（广场外圈、花坛边） */
function ring(b, cx, cz, rx, rz, halfW, h, skip) {
  const seg = Math.max(12, Math.round((rx + rz) * 0.35));
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * rx, cz + Math.sin(a0) * rz];
    const p1 = [cx + Math.cos(a1) * rx, cz + Math.sin(a1) * rz];
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
    if (skip && skip(mx, mz)) continue;
    hedgeLine(b, [p0, p1], halfW, h, { step: 2.0 });
  }
}

// ------------------------------------------------------------------ 花坛 / 花丛
function flowerClump(b, x, y, z, n, spread) {
  for (let i = 0; i < n; i++) {
    const fx = x + (b.rand() - 0.5) * spread;
    const fz = z + (b.rand() - 0.5) * spread;
    const fy = y + b.rand() * 0.05;
    const col = C.flower[(b.rand() * C.flower.length) | 0];
    const s = 0.09 + b.rand() * 0.07;
    // 单片小面片当花（2 面片/朵，省面数）
    b.add(icoGeo(), mat4(fx, fy + s, fz, b.rand(), b.rand() * 6.28, b.rand(), s, s * 0.6, s), { color: col, jitter: 0.08 });
  }
}

function flowerBed(bStone, bBush, cx, cz, w, d, yaw) {
  const gy = heightAt(cx, cz);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  // 石缘（4 段）
  const hw = w / 2, hd = d / 2;
  const corners = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], bb = corners[(i + 1) % 4];
    const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
    const mx = (a[0] + bb[0]) / 2, mz = (a[1] + bb[1]) / 2;
    const yy = Math.atan2(-(bb[1] - a[1]), bb[0] - a[0]);
    bStone.addBox(len + 0.18, 0.3, 0.22, { x: mx, y: heightAt(mx, mz) + 0.15, z: mz, ry: yy, color: C.curb, jitter: 0.04 });
  }
  // 土面
  bStone.addBox(w - 0.1, 0.16, d - 0.1, { x: cx, y: gy + 0.2, z: cz, ry: yaw, color: C.soil });
  // 矮灌木 + 花
  const nS = Math.max(2, Math.round(w * d / 9));
  for (let i = 0; i < nS; i++) {
    const lx = (bBush.rand() - 0.5) * (w - 1.0);
    const lz = (bBush.rand() - 0.5) * (d - 1.0);
    const [x, z] = P(lx, lz);
    const r = 0.35 + bBush.rand() * 0.3;
    bBush.add(icoGeo(), mat4(x, heightAt(x, z) + 0.3 + r * 0.5, z, bBush.rand(), bBush.rand() * 6.28, bBush.rand(), r, r * 0.85, r), { color: C.shrub, jitter: 0.16 });
    if (bBush.rand() < 0.55) flowerClump(bBush, x, heightAt(x, z) + 0.55, z, 3, 0.7);
  }
}

// ------------------------------------------------------------------ 灌木
function shrubs(b, rnd, n) {
  let made = 0;
  let tries = 0;
  while (made < n && tries < n * 8) {
    tries++;
    const x = -660 + rnd() * 1650;
    const z = -540 + rnd() * 1220;
    if (!insideCampus(x, z, 6)) continue;
    if (inWater(x, z, 1.5)) continue;
    if (roadClearance(x, z) < 1.0) continue;
    if (inSports(x, z, 3)) continue;
    // 靠近建筑/广场更密
    const nearB = buildingClearance(x, z) < 9;
    const nearP = PLAZAS.some((p) => Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) < 1.5);
    if (!nearB && !nearP && rnd() > 0.35) continue;
    if (buildingClearance(x, z) < 1.2) continue;
    const r = 0.5 + rnd() * 0.75;
    const gy = heightAt(x, z);
    b.add(icoGeo(), mat4(x, gy + r * 0.55, z, rnd() * 0.5, rnd() * 6.28, rnd() * 0.5, r, r * (0.75 + rnd() * 0.4), r), { color: C.shrub, jitter: 0.2 });
    if (rnd() < 0.35) {
      b.add(icoGeo(), mat4(x + (rnd() - 0.5) * r, gy + r * 1.1, z + (rnd() - 0.5) * r, rnd(), rnd() * 6.28, rnd(), r * 0.6, r * 0.5, r * 0.6), { color: C.hedgeLight, jitter: 0.2 });
    }
    made++;
  }
  return made;
}

// ------------------------------------------------------------------ 草坪灌木丛（打破大面积空草地）
function lawnClumps(b, rnd, n) {
  let made = 0;
  let tries = 0;
  while (made < n && tries < n * 12) {
    tries++;
    const x = -640 + rnd() * 1610;
    const z = -520 + rnd() * 1180;
    if (!insideCampus(x, z, 8)) continue;
    if (inWater(x, z, 2) || inPlaza(x, z) || inSports(x, z, 4)) continue;
    if (roadClearance(x, z) < 2.0 || buildingClearance(x, z) < 3.0) continue;
    const k = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < k; i++) {
      const px = x + (rnd() - 0.5) * 3.4, pz = z + (rnd() - 0.5) * 3.4;
      const r = 0.45 + rnd() * 0.8;
      const gy = heightAt(px, pz);
      b.add(icoGeo(), mat4(px, gy + r * 0.5, pz, rnd() * 0.5, rnd() * 6.28, rnd() * 0.5, r, r * (0.7 + rnd() * 0.5), r), { color: C.shrub, jitter: 0.22 });
    }
    made++;
  }
  return made;
}

// ------------------------------------------------------------------ 草簇（instanced）
function tuftGeometry() {
  const b = new GeoBuilder('tuft');
  const base = rgb(0x5a7a38);
  const tip = rgb(0xa7c069);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    const lean = 0.18;
    // 一片草叶：底部窄、顶部略前倾
    const p0 = [-dx, 0, -dz], p1 = [dx, 0, dz];
    const p2 = [dx * 0.45 + lean, 0.55, dz * 0.45], p3 = [-dx * 0.45 + lean, 0.55, -dz * 0.45];
    b.triC(p0, p1, p2, base, base, tip);
    b.triC(p0, p2, p3, base, tip, tip);
  }
  const g = b.build();
  const tris = g.attributes.position.count / 3;
  g.userData.tris = tris;
  return g;
}

function grassTufts(ctx, rnd, n) {
  const mats = propMaterials();
  const g = tuftGeometry();
  const mesh = new THREE.InstancedMesh(g, mats.grass, n);
  mesh.name = 'grass-tufts';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  let made = 0;
  let tries = 0;
  while (made < n && tries < n * 6) {
    tries++;
    // 校园核心一带更密
    const core = rnd() < 0.62;
    const x = core ? (rnd() * 2 - 1) * 560 : -660 + rnd() * 1660;
    const z = core ? (rnd() * 2 - 1) * 420 : -540 + rnd() * 1220;
    if (!insideCampus(x, z, 4)) continue;
    if (inWater(x, z, 0.7)) continue;
    if (inPlaza(x, z, 1.0)) continue;
    if (inSports(x, z, 1)) continue;
    if (roadClearance(x, z) < 0.6) continue;
    const bc = buildingClearance(x, z);
    if (bc < 0.8) continue;
    const gy = heightAt(x, z);
    const s = 0.7 + rnd() * 0.85;
    pos.set(x, gy - 0.02, z);
    e.set((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12);
    q.setFromEuler(e);
    scl.set(s, s * (0.85 + rnd() * 0.5), s);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(made, m);
    const v = 0.95 + rnd() * 0.4;
    col.setRGB(v, v * (0.96 + rnd() * 0.1), v * 0.86);
    mesh.setColorAt(made, col);
    made++;
  }
  mesh.count = made;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  ctx.group.add(mesh);
  return made;
}

// ------------------------------------------------------------------ 湖岸拨石
function revetment(bStone, rnd) {
  const poly = LAKE.poly;
  const lvl = LAKE.level;
  let n = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], bb = poly[(i + 1) % poly.length];
    const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
    const steps = Math.max(2, Math.round(len / 1.7));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = a[0] + (bb[0] - a[0]) * t;
      const z = a[1] + (bb[1] - a[1]) * t;
      // 外法线
      let ox = x - LAKE.center.x, oz = z - LAKE.center.z;
      const l = Math.hypot(ox, oz) || 1;
      ox /= l; oz /= l;
      const gy = heightAt(x, z);
      // 只在岸线附近（水位上下 1.2m）
      if (gy > lvl + 1.4 || gy < lvl - 2.0) continue;
      const off = 0.35 + rnd() * 1.1;
      const rx = x + ox * off, rz = z + oz * off;
      const r = 0.32 + rnd() * 0.5;
      const col = C.rock[(rnd() * C.rock.length) | 0];
      bStone.add(icoGeo(), mat4(
        rx, Math.min(gy, lvl) + r * 0.35 + rnd() * 0.25, rz,
        rnd() * 0.6, rnd() * 6.28, rnd() * 0.6,
        r * (0.9 + rnd() * 0.5), r * (0.55 + rnd() * 0.35), r * (0.9 + rnd() * 0.5)
      ), { color: col, jitter: 0.12 });
      n++;
      if (rnd() < 0.4) {
        // 第二排更靠水
        const r2 = 0.25 + rnd() * 0.35;
        bStone.add(icoGeo(), mat4(
          x + ox * (off - 0.8), lvl + 0.05 + rnd() * 0.1, z + oz * (off - 0.8),
          rnd(), rnd() * 6.28, rnd(),
          r2 * 1.2, r2 * 0.7, r2 * 1.2
        ), { color: col, jitter: 0.1 });
        n++;
      }
    }
  }
  return n;
}

// ------------------------------------------------------------------ 木栈道
function boardwalk(bWood, bMetal, rnd) {
  // 北岸/东岸：取 LAKE.poly 的一段向外偏移 3.2m 铺栈道
  const idx = [0, 1, 2, 3, 4, 5, 6];
  const pts = [];
  for (const i of idx) {
    const p = LAKE.poly[i];
    let ox = p[0] - LAKE.center.x, oz = p[1] - LAKE.center.z;
    const l = Math.hypot(ox, oz) || 1;
    pts.push([p[0] + (ox / l) * 3.2, p[1] + (oz / l) * 3.2]);
  }
  const deckY = (x, z) => Math.max(heightAt(x, z), LAKE.level + 0.55);
  let planks = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], bb = pts[i + 1];
    const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
    const n = Math.max(2, Math.round(len / 0.48));
    const yaw = Math.atan2(-(bb[1] - a[1]), bb[0] - a[0]);
    const nx = -(bb[1] - a[1]) / len, nz = (bb[0] - a[0]) / len;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (bb[0] - a[0]) * t;
      const z = a[1] + (bb[1] - a[1]) * t;
      const yy = deckY(x, z) + 0.16;
      bWood.addBox(0.44, 0.09, 1.9, {
        x, y: yy, z, ry: yaw,
        color: k % 2 ? C.plank : C.plank2, jitter: 0.05,
      });
      planks++;
    }
    // 龙骨（下面）
    const mx = (a[0] + bb[0]) / 2, mz = (a[1] + bb[1]) / 2;
    bWood.addBox(len, 0.14, 0.12, { x: mx + nx * 0.85, y: deckY(mx, mz) + 0.02, z: mz + nz * 0.85, ry: yaw, color: C.plank2 });
    bWood.addBox(len, 0.14, 0.12, { x: mx - nx * 0.85, y: deckY(mx, mz) + 0.02, z: mz - nz * 0.85, ry: yaw, color: C.plank2 });
    // 栏杆（临水侧）
    const railSteps = Math.max(1, Math.round(len / 2.0));
    for (let k = 0; k <= railSteps; k++) {
      const t = k / railSteps;
      const x = a[0] + (bb[0] - a[0]) * t + nx * 0.95;
      const z = a[1] + (bb[1] - a[1]) * t + nz * 0.95;
      const yy = deckY(x, z) + 0.16;
      if (k < railSteps) bMetal.addBox(0.07, 0.95, 0.07, { x, y: yy + 0.45, z, ry: yaw, color: C.plank2 });
      else bMetal.addBox(0.07, 0.95, 0.07, { x, y: yy + 0.45, z, ry: yaw, color: C.plank2 });
    }
    for (const hh of [0.55, 0.98]) {
      bMetal.addBox(len, 0.06, 0.06, {
        x: mx + nx * 0.95, y: deckY(mx, mz) + hh, z: mz + nz * 0.95, ry: yaw, color: C.plank,
      });
    }
    // 支柱
    const postN = Math.max(2, Math.round(len / 2.4));
    for (let k = 0; k < postN; k++) {
      const t = k / postN;
      const x = a[0] + (bb[0] - a[0]) * t, z = a[1] + (bb[1] - a[1]) * t;
      const gy = heightAt(x, z);
      const yy = deckY(x, z) + 0.1;
      if (yy - gy > 0.12) {
        bWood.addBox(0.14, yy - gy + 0.1, 0.14, { x, y: (yy + gy) / 2, z, ry: yaw, color: C.plank2 });
      }
    }
  }
  void rnd;
  return planks;
}

// ------------------------------------------------------------------ 芦苇
function reeds(b, rnd) {
  const poly = LAKE.poly;
  let n = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], bb = poly[(i + 1) % poly.length];
    const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
    const steps = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k < steps; k++) {
      if (rnd() > 0.55) continue;
      const t = (k + 0.5) / steps;
      const x = a[0] + (bb[0] - a[0]) * t;
      const z = a[1] + (bb[1] - a[1]) * t;
      let ox = x - LAKE.center.x, oz = z - LAKE.center.z;
      const l = Math.hypot(ox, oz) || 1;
      ox /= l; oz /= l;
      const gy = heightAt(x, z);
      if (gy > LAKE.level + 0.9 || gy < LAKE.level - 1.2) continue;
      for (let s = 0; s < 4; s++) {
        const px = x + ox * (0.2 + rnd() * 0.9) + (rnd() - 0.5) * 1.2;
        const pz = z + oz * (0.2 + rnd() * 0.9) + (rnd() - 0.5) * 1.2;
        const hh = 0.9 + rnd() * 0.9;
        const y0 = Math.max(gy, LAKE.level - 0.1);
        // 3 片交叉的芦苇叶
        for (let q = 0; q < 3; q++) {
          const a2 = (q / 3) * Math.PI + rnd() * 0.5;
          const dx = Math.cos(a2) * 0.045, dz = Math.sin(a2) * 0.045;
          const lean = (rnd() - 0.5) * 0.3;
          b.triC(
            [px - dx, y0, pz - dz],
            [px + dx, y0, pz + dz],
            [px + lean, y0 + hh, pz + lean * 0.5],
            rgb(C.reed), rgb(C.reed), rgb(C.reedTip)
          );
        }
        n++;
      }
    }
  }
  return n;
}

// ------------------------------------------------------------------ 建筑前花坛
function buildingBeds(bStone, bBush, rnd) {
  let n = 0;
  for (const bl of BUILDINGS) {
    if (bl.group || !bl.w || !bl.d) continue;
    const rot = bl.rot || 0;
    // 正面（局部 -z）外侧
    const off = bl.d / 2 + 3.4;
    const cx = bl.x + Math.sin(rot) * off * -1 * 0 - Math.cos(rot) * 0;
    const cz = bl.z + Math.cos(rot) * off;
    // 用局部变换求正面中心
    const c = Math.cos(rot), s = Math.sin(rot);
    const lx = 0, lz = -(bl.d / 2 + 3.4);
    const fx = bl.x + c * lx + s * lz;
    const fz = bl.z - s * lx + c * lz;
    void cx; void cz;
    const w = Math.min(bl.w * 0.62, 22);
    if (w < 4) continue;
    if (roadClearance(fx, fz) < 1.2) continue;
    if (inSports(fx, fz, 1) || inWater(fx, fz, 1)) continue;
    flowerBed(bStone, bBush, fx, fz, w, 2.6, rot);
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ 入口
export function createGreen(ctx) {
  const mats = propMaterials();
  const rnd = makeRng((SEED ^ 0x22a11e) >>> 0);
  const bStone = new GeoBuilder('green-stone');
  const bBush = new GeoBuilder('green-bush');
  const bGrass = new GeoBuilder('green-grass');
  const bWood = new GeoBuilder('green-wood');
  const bMetal = new GeoBuilder('green-metal');

  // 广场/园林外圈绿篱
  const skipPlaza = (x, z) => roadClearance(x, z) < 2.2 || buildingClearance(x, z) < 1.0;
  for (const p of PLAZAS) {
    ring(bBush, p.x, p.z, p.rx * 1.04, p.rz * 1.04, p.kind === 'garden' ? 0.55 : 0.7, p.kind === 'garden' ? 0.75 : 0.9, skipPlaza);
  }

  // 主干道中央隔离绿带（仅超宽道路，下垫石缘）
  for (const road of ROADS) {
    if (road.width < 18) continue;
    const pts = sampleAlong(road.pts, 8, { start: 24 });
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      let gap = false;
      for (const g of ctx.gates) if (Math.hypot(mx - g.x, mz - g.z) < g.w * 0.5 + 10) { gap = true; break; }
      if (gap || !insideCampus(mx, mz, 2)) continue;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      bStone.addBox(len + 0.1, 0.22, 1.5, { x: mx, y: heightAt(mx, mz) + 0.14, z: mz, ry: yaw, color: C.curb });
      bBush.addBox(len, 0.62, 1.1, { x: mx, y: heightAt(mx, mz) + 0.55, z: mz, ry: yaw, color: C.hedge, jitter: 0.1 });
      if ((i & 1) === 0) {
        bBush.add(icoGeo(), mat4(mx, heightAt(mx, mz) + 0.85, mz, 0, yaw, 0, len * 0.4, 0.22, 0.6), { color: C.hedgeLight, jitter: 0.12 });
      }
    }
  }

  // 建筑前花坛
  const beds = buildingBeds(bStone, bBush, rnd);

  // 灌木丛
  const shrubN = shrubs(bBush, rnd, 320);
  // 草坪灌木丛（打破大面积空草地）
  const lawnN = lawnClumps(bBush, rnd, 140);

  // 花丛（点缀在草坪/广场边）
  for (let i = 0; i < 90; i++) {
    const x = -520 + rnd() * 1380;
    const z = -460 + rnd() * 1080;
    if (!insideCampus(x, z, 6)) continue;
    if (inWater(x, z, 1.5) || inPlaza(x, z) || inSports(x, z, 2)) continue;
    if (roadClearance(x, z) < 1.2 || buildingClearance(x, z) < 1.5) continue;
    if (rnd() > 0.6) continue;
    flowerClump(bBush, x, heightAt(x, z) + 0.12, z, 4 + ((rnd() * 5) | 0), 1.5);
  }

  // 湖岸驳石 + 芦苇 + 木栈道
  const rocks = revetment(bStone, rnd);
  const reedN = reeds(bGrass, rnd);
  const planks = boardwalk(bWood, bMetal, rnd);

  // 草簇（instanced）
  const tufts = grassTufts(ctx, rnd, 1800);

  // 汇总
  const stone = bake(bStone, mats.stone, 'green-stone');
  const bush = bake(bBush, mats.bush, 'green-bush');
  const grass = bake(bGrass, mats.grass, 'green-grass', false);
  const wood = bake(bWood, mats.wood, 'green-wood');
  const metal = bake(bMetal, mats.metalDark, 'green-metal', false);
  ctx.group.add(stone, bush, grass, wood, metal);

  // 长椅交互之外的坐点：花坛边沿可坐（少量）
  return { beds, shrubN, lawnN, rocks, reedN, planks, tufts };
}

function bake(b, mat, name, cast = true) {
  const g = b.build();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}
