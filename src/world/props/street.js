// 街具：路灯 / 长椅 / 垃圾桶 / 路缘石 / 减速带 / 指示牌 / 公告栏 /
// 旗杆基座 / 自行车棚 / 共享单车 / 铁艺围栏 / 石凳 / 饮水机。
// 全部合并烘焙成少量 mesh（stone/wood/metal/bush/sign 各 1 个）。
import * as THREE from 'three';
import {
  ROADS, GATES, PLAZAS, LAKE, SPORTS, LANDMARKS, CAMPUS_OUTLINE,
} from '../layout.js';
import { heightAt } from '../terrain.js';
import { GeoBuilder, rgb } from './merge.js';
import {
  propMaterials, atlasUV, buildingClearance, roadClearance, sampleAlong,
  inWater, inPlaza, inSports, insideCampus, SEED,
} from './shared.js';
import { makeRng, distToPolyline, pointInPoly } from '../../core/util.js';

// ------------------------------------------------------------------ 调色
const C = {
  pole: 0x8b968f,        // 灯杆钢灰绿（提亮，避免近景逆光发黑）
  poleTop: 0x6b7a72,
  head: 0xd7dcd9,        // 灯头浅灰
  lens: 0xf4f2e6,
  metal: 0x8b9498,       // 不锈钢
  metalDark: 0x4d5558,   // 哑光铁艺
  wood: 0x9a6f45,        // 防腐木
  wood2: 0x8a5936,
  wood3: 0xb98a55,
  stone: 0xb0aca2,       // 花岗岩
  stone2: 0x9a958b,
  curb: 0xc2c0ba,
  concrete: 0xa9a69e,
  binBody: 0x4f6f5e,
  binLid: 0x3d5a4c,
  frameRed: 0xa53a2c,
  bikeBlue: 0x2f6fb5,
  bikeYellow: 0xd6a82a,
  bikeCyan: 0x2f9f9a,
};

// ------------------------------------------------------------------ 辅助
/** 让局部 +x 指向世界 (dx,dz) 的 yaw（THREE 的 Y 轴旋转约定） */
function yawTo(dx, dz) {
  return Math.atan2(-dz, dx);
}
/** 局部坐标 → 世界坐标（与 yawTo 一致） */
function frame(cx, cz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (px, py, pz) => [cx + c * px + s * pz, py, cz - s * px + c * pz];
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
function nearGate(x, z, pad) {
  for (const g of GATES) {
    if (Math.hypot(x - g.x, z - g.z) < (g.w || 12) * 0.5 + pad) return g;
  }
  return null;
}
function groundAt(x, z) { return heightAt(x, z); }

// ------------------------------------------------------------------ 路灯
/** 单臂灯：局部 +x 为悬臂方向 */
function addLamp(b, x, z, yaw, double_) {
  const F = frame(x, z, yaw);
  const gy = groundAt(x, z);
  // 基座
  const gb = gy + 0.21;
  b.addCyl(0.26, 0.32, 0.42, {
    seg: 8, color: C.stone2,
    matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(x, gb, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)
    ),
  });
  const p0 = F(0, gy + 0.42, 0);
  b.addCyl(0.075, 0.13, 7.6, {
    seg: 8, color: C.pole, capTop: true,
    matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(p0[0], p0[1] + 3.8, p0[2]),
      new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)
    ),
  });
  // 悬臂（两段，微微上翘）+ 灯头
  const arm = (sgn) => {
    const a = F(0, gy + 7.55, 0);
    const m1 = F(0.55 * sgn, gy + 7.92, 0);
    const m2 = F(1.35 * sgn, gy + 8.04, 0);
    b.beam(a, m1, 0.075, 0.06, 6, C.pole);
    b.beam(m1, m2, 0.06, 0.05, 6, C.pole);
    // 灯头
    const hx = 1.62 * sgn;
    b.addBox(0.62, 0.15, 0.3, { x: F(hx, gy + 8.0, 0)[0], y: gy + 8.0, z: F(hx, gy + 8.0, 0)[2], ry: yaw, color: C.head });
    // 灯罩：上窄下宽的浅色罩
    const sp = F(hx, gy + 7.85, 0);
    b.addCyl(0.1, 0.29, 0.13, {
      seg: 6, color: C.head, capBot: true,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(sp[0], sp[1], sp[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)
      ),
    });
  };
  arm(1);
  if (double_) arm(-1);
}

function lamps(b, ctx) {
  const rnd = ctx.rnd;
  for (const road of ROADS) {
    const halfW = road.width / 2 + (road.sidewalk || 0) + 1.0;
    const spacing = road.width >= 18 ? 28 : (road.width >= 11 ? 40 : 54);
    const sides = road.width >= 11 ? [1, -1] : [rnd() < 0.5 ? 1 : -1];
    for (const side of sides) {
      const pts = sampleAlong(road.pts, spacing, { start: 6 + side * 5 });
      for (const p of pts) {
        const x = p.x + p.nx * halfW * side;
        const z = p.z + p.nz * halfW * side;
        if (!insideCampus(x, z, 3)) continue;
        if (nearGate(x, z, 12)) continue;          // 路口空出
        if (inPlaza(x, z) || inSports(x, z, 2)) continue;
        if (inWater(x, z, 1.5)) continue;
        if (buildingClearance(x, z) < 2.0) continue;
        // 悬臂朝向路面中心
        const dx = -p.nx * side, dz = -p.nz * side;
        addLamp(b, x, z, yawTo(dx, dz), road.width >= 18);
        ctx.colliders.push({ type: 'cyl', x, z, r: 0.22, h: 8, tag: 'lamp' });
      }
    }
  }
}

// ------------------------------------------------------------------ 长椅
function addBench(bWood, bMetal, x, z, yaw) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  // 铸铁侧架
  for (const sx of [-0.82, 0.82]) {
    const p = F(sx, gy + 0.22, 0);
    bMetal.addBox(0.07, 0.44, 0.52, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.metalDark });
    const pb = F(sx, gy + 0.72, -0.26);
    bMetal.addBox(0.06, 0.62, 0.07, { x: pb[0], y: pb[1], z: pb[2], ry: yaw, rx: 0.16, color: C.metalDark });
    const pl = F(sx, gy + 0.06, 0.16);
    bMetal.addBox(0.09, 0.1, 0.1, { x: pl[0], y: pl[1], z: pl[2], ry: yaw, color: C.metalDark });
  }
  // 坐板 3 条
  for (let i = 0; i < 3; i++) {
    const p = F(0, gy + 0.44, -0.16 + i * 0.16);
    bWood.addBox(1.88, 0.05, 0.14, { x: p[0], y: p[1], z: p[2], ry: yaw, color: i === 1 ? C.wood3 : C.wood });
  }
  // 靠背 3 条（带倾角）
  for (let i = 0; i < 3; i++) {
    const yy = 0.62 + i * 0.15;
    const p = F(0, gy + yy, -0.26 - i * 0.024);
    bWood.addBox(1.88, 0.11, 0.045, { x: p[0], y: p[1], z: p[2], ry: yaw, rx: 0.16, color: i === 1 ? C.wood2 : C.wood });
  }
  // 两端扶手（弧形的两段管）
  for (const sx of [-0.9, 0.9]) {
    const a0 = F(sx, gy + 0.74, -0.24);
    const a1 = F(sx, gy + 0.82, 0.02);
    const a2 = F(sx, gy + 0.62, 0.26);
    bMetal.beam(a0, a1, 0.042, 0.042, 5, C.metalDark);
    bMetal.beam(a1, a2, 0.038, 0.038, 5, C.metalDark);
  }
  ctxPushBench(x, z, gy, yaw);
}
// 交互/碰撞收集（闭包由 createStreet 注入）
let ctxPushBench = () => {};

// ------------------------------------------------------------------ 垃圾桶
function addBin(b, x, z, yaw) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  const T = (yy, r0, r1, hh, color, capTop = false) => b.addCyl(r0, r1, hh, {
    seg: 10, color, capTop,
    matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(x, gy + yy, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)
    ),
  });
  T(0.36, 0.3, 0.26, 0.72, C.binBody);
  T(0.75, 0.33, 0.33, 0.06, C.binLid, true);
  T(0.72, 0.32, 0.32, 0.07, C.binLid);
  T(0.70, 0.24, 0.24, 0.02, 0x30322f);
  T(0.1, 0.18, 0.2, 0.2, C.metalDark);
  // 正面投放口 + 盖把手 + 分类标识牌
  const op = F(0, gy + 0.6, 0.27);
  b.addBox(0.34, 0.2, 0.06, { x: op[0], y: op[1], z: op[2], ry: yaw, color: 0x2a2d2b });
  const hd = F(0, gy + 0.8, 0);
  b.addBox(0.12, 0.05, 0.14, { x: hd[0], y: hd[1], z: hd[2], ry: yaw, color: C.binLid });
  const tg = F(0, gy + 0.5, 0.285);
  b.addBox(0.16, 0.12, 0.02, { x: tg[0], y: tg[1], z: tg[2], ry: yaw, color: C.lens });
  void F;
}

// ------------------------------------------------------------------ 指示牌
/** 竖牌：正面/背面各一块（带图集 UV） */
function plate(b, F, yaw, w, h, y, zOff, cell, color = 0xffffff) {
  const uv = atlasUV(cell);
  const p = (px, py, pz) => F(px, py, pz);
  const a = p(-w / 2, y - h / 2, zOff), bb = p(w / 2, y - h / 2, zOff);
  const c = p(w / 2, y + h / 2, zOff), d = p(-w / 2, y + h / 2, zOff);
  b.quad(a, bb, c, d, color, [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]]);
  // 背面（镜像 u）
  const a2 = p(w / 2, y - h / 2, zOff - 0.03), b2 = p(-w / 2, y - h / 2, zOff - 0.03);
  const c2 = p(-w / 2, y + h / 2, zOff - 0.03), d2 = p(w / 2, y + h / 2, zOff - 0.03);
  b.quad(a2, b2, c2, d2, color, [[uv.u1, uv.v0], [uv.u0, uv.v0], [uv.u0, uv.v1], [uv.u1, uv.v1]]);
}

function addSign(bSign, bMetal, x, z, yaw, cells) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  const pp = F(0, gy + 1.35, 0);
  bMetal.addCyl(0.055, 0.07, 2.7, {
    seg: 8, color: C.metalDark, capTop: true,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(pp[0], pp[1], pp[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
  });
  const base = F(0, gy + 0.06, 0);
  bMetal.addCyl(0.16, 0.2, 0.12, {
    seg: 8, color: C.stone2,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(base[0], base[1], base[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
  });
  // 牌框 + 面板
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    const yy = gy + 2.05 - i * 0.62;
    bMetal.addBox(1.28, 0.82, 0.05, { x: F(0, yy, -0.03)[0], y: yy, z: F(0, yy, -0.03)[2], ry: yaw, color: C.metalDark });
    plate(bSign, F, yaw, 1.16, 0.7, yy, 0.005, cells[i]);
  }
}

// ------------------------------------------------------------------ 公告栏
function addBoard(bWood, bSign, x, z, yaw) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  for (const sx of [-1.15, 1.15]) {
    const p = F(sx, gy + 1.1, 0);
    bWood.addBox(0.12, 2.2, 0.12, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.wood2 });
  }
  // 板体（深绿背板）+ 木框
  const pc = F(0, gy + 1.55, 0);
  bWood.addBox(2.5, 1.5, 0.12, { x: pc[0], y: pc[1], z: pc[2], ry: yaw, color: 0x1d4a37 });
  for (const [w, h, yy, zz] of [[2.62, 0.12, 2.34, 0], [2.62, 0.12, 0.76, 0], [0.12, 1.7, 1.55, 1.24], [0.12, 1.7, 1.55, -1.24]]) {
    const p = F(zz, gy + yy, 0);
    bWood.addBox(w, h, 0.16, { x: p[0], y: gy + yy, z: p[2], ry: yaw, color: C.wood });
  }
  // 顶棚（两坡）
  const pr = F(0, gy + 2.46, 0);
  bWood.addBox(2.8, 0.08, 0.5, { x: pr[0], y: pr[1], z: pr[2], ry: yaw, rz: 0.0, rx: 0.12, color: C.wood3 });
  bWood.addBox(2.8, 0.08, 0.5, { x: pr[0], y: pr[1], z: pr[2], ry: yaw, rx: -0.12, color: C.wood3 });
  // 海报
  const cells = [10, 11, 12];
  for (let i = 0; i < 3; i++) {
    const cx = -0.78 + i * 0.78;
    plate(bSign, F, yaw, 0.72, 0.98, gy + 1.55, 0.065, cells[i]);
    void cx;
  }
}

// ------------------------------------------------------------------ 石凳
function addStoneBench(bStone, x, z, yaw) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  for (const sx of [-0.75, 0.75]) {
    const p = F(sx, gy + 0.2, 0);
    bStone.addBox(0.24, 0.4, 0.42, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.stone2 });
  }
  const pt = F(0, gy + 0.44, 0);
  bStone.addBox(1.7, 0.1, 0.46, { x: pt[0], y: pt[1], z: pt[2], ry: yaw, color: C.stone });
}

// ------------------------------------------------------------------ 饮水机
function addFountain(bMetal, x, z, yaw) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  const pc = F(0, gy + 0.5, 0);
  bMetal.addCyl(0.22, 0.26, 1.0, {
    seg: 8, color: 0xb9c4c0, capTop: true,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(pc[0], pc[1], pc[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
  });
  // 水盆
  const pb = F(0, gy + 0.62, 0);
  bMetal.addCyl(0.3, 0.24, 0.16, {
    seg: 10, color: C.metal,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(pb[0], pb[1], pb[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
  });
  // 底座
  const p0 = F(0, gy + 0.05, 0);
  bMetal.addBox(0.6, 0.1, 0.6, { x: p0[0], y: p0[1], z: p0[2], ry: yaw, color: C.stone2 });
}

// ------------------------------------------------------------------ 旗杆基座
function flagBase(bStone, bWood) {
  const lm = LANDMARKS.find((l) => l.kind === 'flagpole');
  if (!lm) return;
  const gy = groundAt(lm.x, lm.z);
  const steps = [
    [4.6, 0.16, 0.0], [3.8, 0.16, 0.16], [3.1, 0.22, 0.32],
  ];
  for (const [r, h, y] of steps) {
    const b = new GeoBuilder('flagstep');
    b.addCyl(r, r, h, {
      seg: 16, color: C.stone,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(lm.x, gy + y + h / 2, lm.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)
      ),
    });
    bStone.add(b.build(), null, { colorRgb: rgb(C.stone), jitter: 0.02 });
  }
  // 围栏立柱（4 根小柱子）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = lm.x + Math.cos(a) * 2.7, z = lm.z + Math.sin(a) * 2.7;
    bWood.addCyl(0.09, 0.11, 0.9, { x, y: gy + 0.72, z, seg: 6, color: C.stone2, capTop: true });
  }
}

// ------------------------------------------------------------------ 路缘石 / 减速带
function curbs(b, ctx) {
  for (const road of ROADS) {
    if (road.width < 11) continue;
    const halfW = road.width / 2;
    for (const side of [1, -1]) {
      const pts = sampleAlong(road.pts, 8.0, { start: 0 });
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const ax = p.x + p.nx * halfW * side, az = p.z + p.nz * halfW * side;
        const bx = q.x + q.nx * halfW * side, bz = q.z + q.nz * halfW * side;
        if (!insideCampus(ax, az, 2)) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (nearGate(mx, mz, 9)) continue;
        const len = Math.hypot(bx - ax, bz - az) + 0.06;
        const yaw = yawTo(bx - ax, bz - az);
        b.addBox(len, 0.16, 0.26, {
          x: mx, y: groundAt(mx, mz) + 0.07, z: mz, ry: yaw, color: C.curb,
        });
      }
    }
  }
}

function speedBumps(b, ctx) {
  for (const g of GATES) {
    if (!g.main) continue;
    const road = ROADS.find((r) => r.major);
    if (!road) continue;
    const dir = g.rot || 0;
    for (let k = 0; k < 2; k++) {
      const dist = 14 + k * 9;
      const x = g.x + Math.sin(dir) * dist * 0 + Math.cos(dir) * 0;
      const z = g.z + dist; // 门内一侧（+z 南）
      const gy = groundAt(x, z);
      if (inWater(x, z, 1)) continue;
      // 黄黑相间的减速带
      for (let s = 0; s < 7; s++) {
        const ox = -3.3 + s * 1.1;
        b.addBox(1.0, 0.12, 1.4, {
          x: x + ox, y: gy + 0.06, z, ry: dir,
          color: s % 2 ? 0xe4c341 : 0x2f2f2f,
        });
      }
    }
  }
}

// ------------------------------------------------------------------ 自行车棚
function addShelter(bMetal, bCanopyList, x, z, yaw, len) {
  const gy = groundAt(x, z);
  const F = frame(x, z, yaw);
  const n = Math.max(2, Math.round(len / 2.4));
  for (let i = 0; i <= n; i++) {
    const px = -len / 2 + (i / n) * len;
    for (const sx of [-1.35, 1.35]) {
      const p = F(px, gy + 1.25, sx);
      bMetal.addBox(0.12, 2.5, 0.12, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.metalDark });
    }
    // 横梁
    const p = F(px, gy + 2.52, 0);
    bMetal.addBox(0.1, 0.1, 2.9, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.metalDark });
  }
  // 纵向檩条
  for (const sx of [-1.35, 0, 1.35]) {
    const p = F(0, gy + 2.6, sx);
    bMetal.addBox(len + 0.3, 0.09, 0.09, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.metalDark });
  }
  // 半透明顶（单独 mesh）
  const g = new THREE.PlaneGeometry(len + 0.5, 3.1, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, propMaterials().canopy);
  const pc = F(0, gy + 2.74, 0);
  m.position.set(pc[0], pc[1], pc[2]);
  m.rotation.y = yaw;
  m.name = 'shelter-roof';
  m.renderOrder = 2;
  bCanopyList.push(m);
  // 车位分隔管
  for (let i = 0; i < 8; i++) {
    const px = -len / 2 + 0.6 + i * 0.62;
    const p = F(px, gy + 0.35, 0);
    bMetal.addBox(0.05, 0.05, 2.4, { x: p[0], y: p[1], z: p[2], ry: yaw, color: C.metal });
  }
}

// ------------------------------------------------------------------ 共享单车（可抓）
function bikeGeometry(color) {
  const b = new GeoBuilder('bike');
  const dark = 0x24262a;
  // 车轮：扁圆柱 + 轮圈
  for (const wz of [-0.52, 0.52]) {
    b.addCyl(0.33, 0.33, 0.045, { x: 0, y: 0.34, z: wz, rx: Math.PI / 2, seg: 14, color: dark });
    b.addCyl(0.26, 0.26, 0.03, { x: 0, y: 0.34, z: wz, rx: Math.PI / 2, seg: 14, color: 0xb9bdc0 });
  }
  // 车架
  b.beam([0, 0.34, -0.52], [0, 0.62, -0.12], 0.035, 0.035, 5, color);
  b.beam([0, 0.62, -0.12], [0, 0.42, 0.42], 0.035, 0.035, 5, color);
  b.beam([0, 0.42, 0.42], [0, 0.34, 0.52], 0.03, 0.03, 5, color);
  b.beam([0, 0.62, -0.12], [0, 0.34, 0.52], 0.03, 0.03, 5, color);
  b.beam([0, 0.34, -0.52], [0, 0.72, -0.52], 0.03, 0.03, 5, dark);
  // 车把
  b.beam([-0.24, 0.86, -0.58], [0.24, 0.86, -0.58], 0.025, 0.025, 5, dark);
  b.beam([0, 0.72, -0.52], [0, 0.86, -0.58], 0.03, 0.03, 5, dark);
  // 车座
  b.addBox(0.1, 0.05, 0.26, { x: 0, y: 0.78, z: 0.24, color: dark });
  // 车筐
  b.addBox(0.3, 0.2, 0.24, { x: 0, y: 0.82, z: -0.44, color: color });
  return b.build();
}

function sharedBikes(ctx) {
  const rnd = ctx.rnd;
  const mats = propMaterials();
  const spots = [
    [-30, 46], [-58, 38], [46, -30], [300, -452], [330, -486], [880, -20],
    [864, 40], [176, -96], [206, -104], [-404, 60], [-436, 96], [140, 286],
  ];
  const colors = [C.bikeBlue, C.bikeYellow, C.bikeCyan];
  let made = 0;
  for (const [sx, sz] of spots) {
    if (!siteOk(sx, sz)) continue;
    const g = bikeGeometry(colors[made % colors.length]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
    const mesh = new THREE.Mesh(g, mat);
    const yaw = rnd() * Math.PI * 2;
    const gy = groundAt(sx, sz);
    mesh.position.set(sx + (rnd() - 0.5) * 0.6, gy + 0.02, sz + (rnd() - 0.5) * 0.6);
    mesh.rotation.y = yaw;
    mesh.rotation.z = (rnd() - 0.5) * 0.22;
    mesh.name = 'bike';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.group.add(mesh);
    ctx.grabbables.push({ mesh, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, radius: 0.9, mass: 15, label: '共享单车' });
    made++;
  }
  return made;
}
function siteOk(x, z) {
  return insideCampus(x, z, 4) && !inWater(x, z, 2) && buildingClearance(x, z) > 1.5 && roadClearance(x, z) > 0.2;
}

// ------------------------------------------------------------------ 铁艺围栏
function fence(bStone, bMetal, bFence, ctx) {
  const poly = CAMPUS_OUTLINE;
  const n = poly.length;
  const PANEL = 3.6;
  // 先收集每条边上的门洞区间
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const elen = Math.hypot(ex, ez);
    if (elen < 1) continue;
    const ux = ex / elen, uz = ez / elen;
    const yaw = yawTo(ux, uz);
    const panels = Math.floor(elen / PANEL);
    for (let k = 0; k < panels; k++) {
      const d0 = k * PANEL, d1 = d0 + PANEL;
      const mx = a[0] + ux * (d0 + PANEL / 2);
      const mz = a[1] + uz * (d0 + PANEL / 2);
      // 门洞：整段跳过
      let gap = false;
      for (const g of GATES) {
        if (Math.hypot(mx - g.x, mz - g.z) < (g.w || 12) * 0.5 + 2.6) { gap = true; break; }
      }
      // 只建在校园内侧地面（不建在湖里）
      if (gap || inWater(mx, mz, 1)) continue;
      const gy = groundAt(mx, mz);
      const F = frame(mx, mz, yaw);
      // 混凝土基座
      bStone.addBox(PANEL + 0.04, 0.34, 0.36, { x: mx, y: gy + 0.16, z: mz, ry: yaw, color: C.concrete, jitter: 0.05 });
      // 立柱（每 2 板一根，7.2m 间距；纹理里已有细竖杆）
      if (k % 2 === 0) {
        const p0 = F(-PANEL / 2, 0, 0);
        bMetal.addBox(0.15, 2.05, 0.15, { x: p0[0], y: gy + 1.05, z: p0[2], ry: yaw, color: C.metalDark });
        bMetal.addBox(0.22, 0.1, 0.22, { x: p0[0], y: gy + 2.1, z: p0[2], ry: yaw, color: C.metalDark });
      }
      // 通透铁艺面板：一张镂空纹理面片（省掉上千根竖杆的三角面）
      const h0 = gy + 0.34, h1 = gy + 2.08;
      const qa = F(-PANEL / 2, h0, 0), qb = F(PANEL / 2, h0, 0);
      const qc = F(PANEL / 2, h1, 0), qd = F(-PANEL / 2, h1, 0);
      bFence.quad(qa, qb, qc, qd, 0xffffff, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    // 碰撞：整条边一段长盒（略抬高）
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    ctx.colliders.push({ type: 'box', x: mx, z: mz, w: elen, d: 0.5, h: 2.2, rot: -yaw, tag: 'fence' });
  }
}

// ------------------------------------------------------------------ 主入口
export function createStreet(ctx) {
  const mats = propMaterials();
  const rnd = makeRng((SEED ^ 0x51e2a7) >>> 0);
  ctx.rnd = rnd;

  const bStone = new GeoBuilder('street-stone');
  const bWood = new GeoBuilder('street-wood');
  const bMetal = new GeoBuilder('street-metal');
  const bFence = new GeoBuilder('street-fence');
  const bSign = new GeoBuilder('street-sign');
  const canopies = [];

  // 长椅/坐具的交互与碰撞
  ctxPushBench = (x, z, gy, yaw) => {
    ctx.colliders.push({ type: 'box', x, z, w: 1.9, d: 0.62, h: 0.95, rot: -yaw, tag: 'bench' });
    ctx.interactables.push({ x, z, y: gy + 0.45, radius: 1.8, label: '长椅', action: 'sit' });
  };

  // ---- 路灯
  lamps(bMetal, ctx);

  // ---- 路缘石 / 减速带
  curbs(bStone, ctx);
  speedBumps(bWood, ctx);

  // ---- 长椅：广场外圈 + 湖畔
  const benchSpots = [];
  for (const p of PLAZAS) {
    const count = p.kind === 'plaza' ? 10 : 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.2;
      const rr = 1.06 + rnd() * 0.12;
      const x = p.x + Math.cos(a) * p.rx * rr;
      const z = p.z + Math.sin(a) * p.rz * rr;
      if (!siteOkLight(x, z)) continue;
      benchSpots.push([x, z, Math.atan2(p.x - x, p.z - z) + Math.PI]);
    }
  }
  // 湖畔木栈道旁的长椅（朝向湖心）
  const lakePts = [];
  for (let i = 0; i < LAKE.poly.length; i++) {
    const a = LAKE.poly[i], b = LAKE.poly[(i + 1) % LAKE.poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 26));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      // 外法线（远离湖心）
      let ox = x - LAKE.center.x, oz = z - LAKE.center.z;
      const l = Math.hypot(ox, oz) || 1;
      ox /= l; oz /= l;
      lakePts.push([x + ox * 4.6, z + oz * 4.6, Math.atan2(-ox, -oz)]);
    }
  }
  for (const [x, z, yaw] of lakePts) {
    if (!siteOkLight(x, z) || inWater(x, z, 0.8)) continue;
    benchSpots.push([x, z, yaw]);
  }
  // 去重：彼此至少 6m
  const chosen = [];
  for (const s of benchSpots) {
    let ok = true;
    for (const c of chosen) if (Math.hypot(s[0] - c[0], s[1] - c[1]) < 6) { ok = false; break; }
    if (ok) chosen.push(s);
  }
  for (const [x, z, yaw] of chosen) {
    addBench(bWood, bMetal, x, z, yaw);
    // 每张长椅旁一个垃圾桶（一半概率）
    if (rnd() < 0.5) {
      const bx = x + Math.cos(yaw + 1.3) * 1.5, bz = z - Math.sin(yaw + 1.3) * 1.5;
      if (siteOkLight(bx, bz)) {
        addBin(bMetal, bx, bz, yaw);
        ctx.colliders.push({ type: 'cyl', x: bx, z: bz, r: 0.34, h: 0.9, tag: 'bin' });
      }
    }
  }

  // ---- 石凳（园林）
  for (const p of PLAZAS) {
    if (p.kind !== 'garden') continue;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const x = p.x + Math.cos(a) * p.rx * 0.72, z = p.z + Math.sin(a) * p.rz * 0.72;
      if (!siteOkLight(x, z)) continue;
      const yaw = Math.atan2(p.x - x, p.z - z) + Math.PI;
      addStoneBench(bStone, x, z, yaw);
      ctx.colliders.push({ type: 'box', x, z, w: 1.7, d: 0.46, h: 0.55, rot: -yaw, tag: 'bench' });
      ctx.interactables.push({ x, z, y: groundAt(x, z) + 0.45, radius: 1.6, label: '石凳', action: 'sit' });
    }
  }

  // ---- 饮水机
  const fountainSpots = [[236, -92], [176, -40], [-404, 96], [0, 60], [420, 34]];
  for (const [x, z] of fountainSpots) {
    if (!siteOkLight(x, z)) continue;
    const yaw = rnd() * 6.28;
    addFountain(bMetal, x, z, yaw);
    ctx.colliders.push({ type: 'cyl', x, z, r: 0.3, h: 1.1, tag: 'fountain' });
    ctx.interactables.push({ x, z, y: groundAt(x, z) + 0.7, radius: 1.5, label: '直饮水机', action: 'drink' });
  }

  // ---- 指示牌（各广场/校门附近）
  const signs = [
    [10, 44, [0, 1]], [-14, -40, [0, 4]], [96, -62, [4, 9]],
    [405, -486, [7, 0]], [828, 22, [6, 9]], [-118, -528, [7, 5]],
    [300, -458, [3, 9]], [150, 288, [3, 8]], [-300, -132, [3, 8]],
    [180, -108, [9, 8]], [-425, 118, [8, 5]], [-541, 54, [4, 5]],
    [340, 188, [8, 1]], [430, 448, [4, 9]], [0, -30, [1, 0]],
    [250, -142, [9, 3]], [-109, 254, [4, 3]],
  ];
  for (const [x, z, cells] of signs) {
    if (!insideCampus(x, z, 2)) continue;
    const near = PLAZAS.find((p) => Math.hypot(x - p.x, z - p.z) < Math.max(p.rx, p.rz) + 30);
    let yaw = rnd() * 6.28;
    if (near) yaw = Math.atan2(near.x - x, near.z - z);
    addSign(bSign, bMetal, x, z, yaw, cells);
    ctx.colliders.push({ type: 'cyl', x, z, r: 0.16, h: 2.7, tag: 'sign' });
  }

  // ---- 主干道沿线街具：垃圾桶每 30m（左右错开）
  let rb = 0;
  for (const road of ROADS) {
    if ((road.width || 0) < 14) continue;
    const halfW = road.width / 2 + (road.sidewalk || 0) + 1.7;
    for (const p of sampleAlong(road.pts, 30, { start: 15 })) {
      const side = (rb++ % 2) ? 1 : -1;
      const x = p.x + p.nx * halfW * side;
      const z = p.z + p.nz * halfW * side;
      if (!siteOkLight(x, z) || inWater(x, z, 1)) continue;
      addBin(bMetal, x, z, yawTo(-p.nx * side, -p.nz * side));
      ctx.colliders.push({ type: 'cyl', x, z, r: 0.34, h: 0.9, tag: 'bin' });
    }
  }
  // ---- 主干道指路牌每 140m（与垃圾桶错开）
  let rs = 0;
  for (const road of ROADS) {
    if ((road.width || 0) < 14) continue;
    const halfW = road.width / 2 + (road.sidewalk || 0) + 2.1;
    for (const p of sampleAlong(road.pts, 140, { start: 70 })) {
      const side = (rs++ % 2) ? 1 : -1;
      const x = p.x + p.nx * halfW * side;
      const z = p.z + p.nz * halfW * side;
      if (!siteOkLight(x, z) || inWater(x, z, 1)) continue;
      addSign(bSign, bMetal, x, z, yawTo(-p.nx * side, -p.nz * side) + Math.PI, [1, 9]);
      ctx.colliders.push({ type: 'cyl', x, z, r: 0.16, h: 2.7, tag: 'sign' });
    }
  }

  // ---- 公告栏
  for (const [x, z, yaw] of [
    [26, 30, -0.4], [-30, 22, 0.6], [404, -452, 0.1], [112, -58, -0.9],
    [-410, 96, 1.2], [176, 22, 0.3],
  ]) {
    if (!siteOkLight(x, z)) continue;
    addBoard(bWood, bSign, x, z, yaw);
    ctx.colliders.push({ type: 'box', x, z, w: 2.6, d: 0.3, h: 2.5, rot: -yaw, tag: 'board' });
    ctx.interactables.push({ x, z, y: groundAt(x, z) + 1.5, radius: 2.0, label: '公告栏', action: 'read' });
  }

  // ---- 旗杆基座
  flagBase(bStone, bWood);

  // ---- 自行车棚
  for (const [x, z, yaw, len] of [
    [316, -476, 0.05, 16], [880, -34, Math.PI / 2, 14], [-448, 118, 0.0, 12],
  ]) {
    if (!insideCampus(x, z, 3) || buildingClearance(x, z) < 1.2) continue;
    addShelter(bMetal, canopies, x, z, yaw, len);
    for (const sx of [-1.35, 1.35]) {
      const px = x + Math.cos(yaw) * sx, pz = z - Math.sin(yaw) * sx;
      ctx.colliders.push({ type: 'box', x: px, z: pz, w: len + 0.3, d: 0.16, h: 2.6, rot: -yaw, tag: 'shelter' });
    }
  }

  // ---- 共享单车（可抓）
  const bikes = sharedBikes(ctx);

  // ---- 铁艺围栏
  fence(bStone, bMetal, bFence, ctx);

  // ---- 亭子交互点（几何由 landmarks 负责）
  for (const lm of LANDMARKS) {
    if (lm.kind !== 'pavilion') continue;
    ctx.interactables.push({
      x: lm.x, z: lm.z, y: groundAt(lm.x, lm.z), radius: 4.5,
      label: lm.name || '亭子', action: 'sit',
    });
  }

  // ---- 汇总成 mesh
  const stone = bake(bStone, mats.stone, 'street-stone');
  const wood = bake(bWood, mats.wood, 'street-wood');
  const metal = bake(bMetal, mats.metal, 'street-metal');
  const fenceMesh = bake(bFence, mats.fence, 'street-fence', false);
  const signMesh = bake(bSign, mats.sign, 'street-sign', false);
  ctx.group.add(stone, wood, metal, fenceMesh, signMesh);
  for (const m of canopies) ctx.group.add(m);

  return { benches: chosen.length, bikes, lamps: ctx.colliders.filter((c) => c.tag === 'lamp').length };
}

function siteOkLight(x, z) {
  if (!insideCampus(x, z, 2)) return false;
  if (inWater(x, z, 0.6)) return false;
  if (roadClearance(x, z) < 0.8) return false;
  return true;
}
