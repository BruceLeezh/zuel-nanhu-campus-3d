// 体育区：田径场（塑胶跑道 + 内场草皮 + 看台）、足球场（草皮 + 白线 + 球门）、
// 篮球场（铺装 + 白线 + 球架）、网球场（铺装 + 网柱 + 球网），以及可抓取的篮球。
import * as THREE from 'three';
import { SPORTS } from '../layout.js';
import { heightAt } from '../terrain.js';
import { GeoBuilder, icoGeo, rgb } from './merge.js';
import { propMaterials, insideCampus, SEED } from './shared.js';
import { makeRng } from '../../core/util.js';

const C = {
  track: 0xa8452f,       // 塑胶跑道砖红
  trackDark: 0x943a28,
  lane: 0xf2efe4,        // 白线
  pitch: 0x39702f,       // 草皮
  pitchDark: 0x316428,
  court: 0x3e6b5a,       // 篮球场墨绿
  courtBlue: 0x2f5f7a,   // 网球场蓝
  concrete: 0xa8a49a,
  white: 0xf5f3ea,
  steel: 0x6c7477,
  board: 0xf0ece0,
  seat: 0x3e6b8a,
  seat2: 0xcb5b3a,
};

/** 贴合地形的矩形面片（细分网格，避免悬空/穿地） */
function patch(b, x, z, w, d, rot, color, gx = 6, gz = 4, yOff = 0.07) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pt = (lx, lz) => {
    const wx = x + c * lx + s * lz;
    const wz = z - s * lx + c * lz;
    return [wx, heightAt(wx, wz) + yOff, wz];
  };
  for (let i = 0; i < gx; i++) {
    for (let j = 0; j < gz; j++) {
      const x0 = -w / 2 + (i / gx) * w, x1 = -w / 2 + ((i + 1) / gx) * w;
      const z0 = -d / 2 + (j / gz) * d, z1 = -d / 2 + ((j + 1) / gz) * d;
      const a = pt(x0, z0), bb = pt(x1, z0), cc = pt(x1, z1), dd = pt(x0, z1);
      b.quad(a, bb, cc, dd, color);
    }
  }
}

/** 贴地白线（矩形框 / 直线 / 圆） */
function rectLine(b, x, z, w, d, rot, thickness = 0.12, color = C.white, yOff = 0.1) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pt = (lx, lz) => {
    const wx = x + c * lx + s * lz;
    const wz = z - s * lx + c * lz;
    return [wx, heightAt(wx, wz) + yOff, wz];
  };
  const hw = w / 2, hd = d / 2;
  const edges = [
    [[-hw, -hd], [hw, -hd]], [[hw, -hd], [hw, hd]], [[hw, hd], [-hw, hd]], [[-hw, hd], [-hw, -hd]],
  ];
  for (const [a0, b0] of edges) {
    const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    const n = Math.max(2, Math.round(len / 3));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ax = a0[0] + (b0[0] - a0[0]) * t0, az = a0[1] + (b0[1] - a0[1]) * t0;
      const bx = a0[0] + (b0[0] - a0[0]) * t1, bz = a0[1] + (b0[1] - a0[1]) * t1;
      const dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * thickness / 2, nz = (dx / l) * thickness / 2;
      b.quad(pt(ax - nx, az - nz), pt(bx - nx, bz - nz), pt(bx + nx, bz + nz), pt(ax + nx, az + nz), color);
    }
  }
}
function lineSeg(b, x0, z0, x1, z1, thickness = 0.12, color = C.white, yOff = 0.1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 4));
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const nx = (-dz * thickness) / 2, nz = (dx * thickness) / 2;
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0;
    const bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
    b.quad(
      [ax - nx, heightAt(ax, az) + yOff, az - nz],
      [bx - nx, heightAt(bx, bz) + yOff, bz - nz],
      [bx + nx, heightAt(bx, bz) + yOff, bz + nz],
      [ax + nx, heightAt(ax, az) + yOff, az + nz],
      color
    );
  }
}
function circleLine(b, cx, cz, r, thickness = 0.12, color = C.white, yOff = 0.1, seg = 28) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
    const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * thickness / 2, nz = (dx / l) * thickness / 2;
    b.quad(
      [p0[0] - nx, heightAt(p0[0], p0[1]) + yOff, p0[1] - nz],
      [p1[0] - nx, heightAt(p1[0], p1[1]) + yOff, p1[1] - nz],
      [p1[0] + nx, heightAt(p1[0], p1[1]) + yOff, p1[1] + nz],
      [p0[0] + nx, heightAt(p0[0], p0[1]) + yOff, p0[1] + nz],
      color
    );
  }
}

// ------------------------------------------------------------------ 田径场
function stadiumPt(R, L, t) {
  // t∈[0,1) 绕跑道一圈；直道沿 x
  const u = t * 4;
  const seg = Math.floor(u);
  const f = u - seg;
  const hx = L / 2;
  switch (seg % 4) {
    case 0: return [hx + Math.cos(-Math.PI / 2 + f * Math.PI) * R, Math.sin(-Math.PI / 2 + f * Math.PI) * R];
    case 1: return [-hx + Math.cos(Math.PI / 2 - f * Math.PI) * R * 0 + (-hx + f * 2 * hx), R];
    default: {
      // 兜底：用参数化近似
      const ang = t * Math.PI * 2;
      return [Math.cos(ang) * (L / 2 + R), Math.sin(ang) * R];
    }
  }
}

/** 圆角矩形（体育场形）边界点 */
function stadiumPoint(R, L, t) {
  // 上直道(+z 侧) → 东半圆 → 下直道 → 西半圆
  const per = 4 * (L / 2) + 2 * Math.PI * R; // 周长近似
  let d = t * per;
  const half = L / 2;
  if (d < half) return [half - d, R];                  // 直道1 -x 方向
  d -= half;
  if (d < half) return [-half + d, R];                  // 直道2 +x 方向（回程）
  d -= half;
  return null;
}

/** 直接按参数生成跑道外/内边界：直道 L、半径 R 的“跑道”形 */
function trackLoop(R, L, t) {
  // 参数 t∈[0,1)：直道1（z=+R, x: L/2→-L/2）→ 西半圆 → 直道2（z=-R）→ 东半圆
  const half = L / 2;
  const straight = L;
  const arc = Math.PI * R;
  const total = straight * 2 + arc * 2;
  let d = t * total;
  if (d < straight) {
    return [half - d, R];
  }
  d -= straight;
  if (d < arc) {
    const a = d / R; // 0..π 从 -x 端绕到 +z? 这里绕过西侧
    return [-half + Math.cos(Math.PI - a) * R * 0 - Math.cos(a) * R - 0, Math.cos(a) * R * 0 + Math.sin(a) * R * 0];
  }
  return [0, 0];
}

/** 用「直道 + 半圆」参数化：a 为沿跑道弧长 */
function ovalPt(R, L, s) {
  const half = L / 2;
  const straights = L * 2;
  const arcLen = Math.PI * R;
  s = ((s % (straights + arcLen * 2)) + straights + arcLen * 2) % (straights + arcLen * 2);
  if (s < L) return [half - s, R];                        // 上直道向南? (z=+R) 从 +x 到 -x
  s -= L;
  if (s < arcLen) {                                       // 西半圆
    const a = Math.PI / 2 + (s / R);                      // 从 +z 到 -z 经 -x
    return [-half + Math.cos(a) * R * 1, Math.sin(a) * R];
  }
  s -= arcLen;
  if (s < L) return [-half + s, -R];                      // 下直道
  s -= L;
  const a = -Math.PI / 2 + (s / R);                       // 东半圆
  return [half + Math.cos(a) * R, Math.sin(a) * R];
}

function trackField(bStone, bBush, bTrack, sp) {
  const rot = sp.rot || 0;
  const R = sp.d / 2;                 // 外半径
  const L = sp.w - sp.d;              // 直道长度
  const cx = sp.x, cz = sp.z;
  const N = 72;
  const innerR = R - 9.2;
  // 跑道面
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const o0 = ovalPt(R, L, t0 * (2 * L + 2 * Math.PI * R));
    const o1 = ovalPt(R, L, t1 * (2 * L + 2 * Math.PI * R));
    const i0 = ovalPt(innerR, L, t0 * (2 * L + 2 * Math.PI * R));
    const i1 = ovalPt(innerR, L, t1 * (2 * L + 2 * Math.PI * R));
    const c = Math.cos(rot), s = Math.sin(rot);
    const W = (p) => [cx + c * p[0] + s * p[1], cz - s * p[0] + c * p[1]];
    const a = W(o0), bb = W(o1), cc = W(i1), dd = W(i0);
    bTrack.quad(
      [a[0], heightAt(a[0], a[1]) + 0.08, a[1]],
      [bb[0], heightAt(bb[0], bb[1]) + 0.08, bb[1]],
      [cc[0], heightAt(cc[0], cc[1]) + 0.08, cc[1]],
      [dd[0], heightAt(dd[0], dd[1]) + 0.08, dd[1]],
      i % 2 ? C.track : C.trackDark
    );
    // 分道线（每 1.53m 一条，共 5 条）
    if (i % 6 === 0) {
      for (let k = 1; k <= 5; k++) {
        const rr = innerR + (k * 9.2) / 6;
        const p0 = ovalPt(rr, L, t0 * (2 * L + 2 * Math.PI * R));
        const p1 = ovalPt(rr, L, t1 * (2 * L + 2 * Math.PI * R));
        const q0 = W(p0), q1 = W(p1);
        const dx = q1[0] - q0[0], dz = q1[1] - q0[1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = (-dz / l) * 0.06, nz = (dx / l) * 0.06;
        bTrack.quad(
          [q0[0] - nx, heightAt(q0[0], q0[1]) + 0.105, q0[1] - nz],
          [q1[0] - nx, heightAt(q1[0], q1[1]) + 0.105, q1[1] - nz],
          [q1[0] + nx, heightAt(q1[0], q1[1]) + 0.105, q1[1] + nz],
          [q0[0] + nx, heightAt(q0[0], q0[1]) + 0.105, q0[1] + nz],
          C.lane
        );
      }
    }
  }
  // 内场草皮（体育场形多边形，中心扇形）
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (p) => [cx + c * p[0] + s * p[1], cz - s * p[0] + c * p[1]];
  const ctr = W([0, 0]);
  const yc = heightAt(ctr[0], ctr[1]) + 0.06;
  for (let i = 0; i < N; i++) {
    const p0 = W(ovalPt(innerR + 0.05, L, (i / N) * (2 * L + 2 * Math.PI * innerR)));
    const p1 = W(ovalPt(innerR + 0.05, L, ((i + 1) / N) * (2 * L + 2 * Math.PI * innerR)));
    bTrack.tri(
      [ctr[0], yc, ctr[1]],
      [p0[0], heightAt(p0[0], p0[1]) + 0.06, p0[1]],
      [p1[0], heightAt(p1[0], p1[1]) + 0.06, p1[1]],
      i % 2 ? C.pitch : C.pitchDark
    );
  }
  // 内场足球门（南北各一）
  goal(bStone, W([0, innerR * 0.72]), Math.atan2(-(1), 0) + rot + Math.PI / 2, 5.0);
  goal(bStone, W([0, -innerR * 0.72]), Math.atan2(1, 0) + rot + Math.PI / 2, 5.0);
  // 看台（西侧）
  stands(bStone, W([-L / 2 - R - 2.5, 0]), rot + Math.PI / 2, 34);
}

// ------------------------------------------------------------------ 看台
function stands(bStone, at, yaw, len) {
  const [x, z] = at;
  const gy = heightAt(x, z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
  for (let tier = 0; tier < 5; tier++) {
    const p = P(0, tier * 0.85);
    const yy = gy + 0.35 + tier * 0.45;
    bStone.addBox(len, 0.44, 0.92, { x: p[0], y: yy, z: p[1], ry: yaw, color: tier % 2 ? C.seat : C.seat2 });
    bStone.addBox(len, 0.16, 0.86, { x: p[0], y: yy + 0.3, z: p[1], ry: yaw, color: C.concrete });
  }
  const p = P(0, 4.2);
  bStone.addBox(len, 1.6, 0.3, { x: p[0], y: gy + 2.6, z: p[1], ry: yaw, color: C.concrete });
}

// ------------------------------------------------------------------ 足球场
function footballPitch(bStone, bTrack, sp) {
  const rot = sp.rot || 0;
  const w = sp.w - 8, d = sp.d - 8;
  patch(bTrack, sp.x, sp.z, w, d, rot, C.pitch, 10, 7, 0.06);
  rectLine(bTrack, sp.x, sp.z, w, d, rot, 0.14);
  // 中线 + 中圈 + 禁区
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (lx, lz) => [sp.x + c * lx + s * lz, sp.z - s * lx + c * lz];
  const p0 = P(0, -d / 2), p1 = P(0, d / 2);
  lineSeg(bTrack, p0[0], p0[1], p1[0], p1[1], 0.12);
  circleLine(bTrack, sp.x, sp.z, Math.min(w, d) * 0.13, 0.12);
  for (const sgn of [-1, 1]) {
    const ctr = P(0, sgn * d / 2);
    const in1 = P(-w * 0.22, sgn * (d / 2 - 9)), in2 = P(w * 0.22, sgn * (d / 2 - 9));
    lineSeg(bTrack, in1[0], in1[1], in2[0], in2[1], 0.12);
    const a = P(-w * 0.22, sgn * d / 2), bb = P(w * 0.22, sgn * d / 2);
    lineSeg(bTrack, a[0], a[1], in1[0], in1[1], 0.12);
    lineSeg(bTrack, bb[0], bb[1], in2[0], in2[1], 0.12);
    // 球门
    goal(bStone, [ctr[0], ctr[1]], rot + sgn * Math.PI / 2, 6.2);
  }
  return 1;
}

// ------------------------------------------------------------------ 球门
function goal(b, at, yaw, width) {
  const [x, z] = at;
  const gy = heightAt(x, z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, ly, lz) => [x + c * lx + s * lz, gy + ly, z - s * lx + c * lz];
  const hw = width / 2, h = 2.2;
  for (const sx of [-hw, hw]) {
    const p = P(sx, 0, 0);
    b.addCyl(0.055, 0.06, h, {
      seg: 6, color: C.white,
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1] + h / 2, p[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
    });
  }
  const a = P(-hw, h, 0), bb = P(hw, h, 0);
  b.beam(a, bb, 0.055, 0.055, 6, C.white);
  // 侧网（深灰细线框作示意）
  for (const sx of [-hw, hw]) {
    const p0 = P(sx, 0, 0), p1 = P(sx, h, 0), p2 = P(sx, h, -1.6), p3 = P(sx, 0.05, -1.6);
    b.quad(p0, p1, p2, p3, 0x6f7a72);
  }
  // 后网
  const q0 = P(-hw, 0.05, -1.6), q1 = P(hw, 0.05, -1.6), q2 = P(hw, h, -1.6), q3 = P(-hw, h, -1.6);
  b.quad(q0, q1, q2, q3, 0x6f7a72);
}

// ------------------------------------------------------------------ 篮球场
function basketballCourt(bStone, bMetal, bTrack, sp, rnd) {
  const rot = sp.rot || 0;
  patch(bStone, sp.x, sp.z, sp.w, sp.d, rot, C.court, 8, 6, 0.07);
  rectLine(bTrack, sp.x, sp.z, sp.w - 2, sp.d - 2, rot, 0.12);
  // 拆成 n 块半场
  const n = Math.max(1, Math.round(sp.w / 30));
  const cw = (sp.w - 2) / n;
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (lx, lz) => [sp.x + c * lx + s * lz, sp.z - s * lx + c * lz];
  // 中线
  const m0 = P(0, -(sp.d - 2) / 2), m1 = P(0, (sp.d - 2) / 2);
  lineSeg(bTrack, m0[0], m0[1], m1[0], m1[1], 0.12);
  circleLine(bTrack, sp.x, sp.z, 1.8, 0.12, C.white, 0.1, 18);
  for (let i = 0; i < n; i++) {
    const lx = -(sp.w - 2) / 2 + cw * (i + 0.5);
    for (const sgn of [-1, 1]) {
      // 三分弧
      const hx = P(lx, sgn * (sp.d - 2) / 2);
      circleLine(bTrack, hx[0], hx[1], 2.4, 0.1, C.white, 0.1, 16);
      // 篮架
      const base = P(lx, sgn * (sp.d / 2 - 1.2));
      hoop(bMetal, base[0], base[1], rot + (sgn > 0 ? Math.PI : 0), rnd);
    }
  }
  return n * 2;
}

function hoop(bMetal, x, z, yaw, rnd) {
  const gy = heightAt(x, z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, ly, lz) => [x + c * lx + s * lz, gy + ly, z - s * lx + c * lz];
  const p0 = P(0, 0, 0), p1 = P(0, 3.05, 0);
  bMetal.beam(p0, p1, 0.09, 0.08, 6, C.steel);
  // 悬臂
  const p2 = P(0, 3.15, 0.65);
  bMetal.beam(p1, p2, 0.07, 0.06, 6, C.steel);
  // 篮板
  const bp = P(0, 3.25, 1.15);
  bMetal.addBox(1.8, 1.05, 0.06, { x: bp[0], y: bp[1], z: bp[2], ry: yaw, color: C.board });
  // 篮圈（用 8 段细管围一圈）
  const rimY = 3.05;
  const rimPts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    rimPts.push(P(Math.cos(a) * 0.23, rimY, 1.15 + Math.sin(a) * 0.23 + 0.22));
  }
  for (let i = 0; i < 8; i++) bMetal.beam(rimPts[i], rimPts[i + 1], 0.022, 0.022, 4, 0xc9502a);
  // 底座
  const b0 = P(0, 0.1, -0.3);
  bMetal.addBox(0.5, 0.2, 0.5, { x: b0[0], y: b0[1], z: b0[2], ry: yaw, color: C.concrete });
  void rnd;
}

// ------------------------------------------------------------------ 网球场
function tennisCourt(bStone, bMetal, bTrack, sp) {
  const rot = sp.rot || 0;
  patch(bStone, sp.x, sp.z, sp.w, sp.d, rot, C.courtBlue, 7, 5, 0.07);
  rectLine(bTrack, sp.x, sp.z, sp.w - 6, sp.d - 6, rot, 0.1);
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (lx, lz) => [sp.x + c * lx + s * lz, sp.z - s * lx + c * lz];
  const n0 = P(-(sp.w - 6) / 2 + 4, 0), n1 = P((sp.w - 6) / 2 - 4, 0);
  lineSeg(bTrack, n0[0], n0[1], n1[0], n1[1], 0.1);
  // 网柱 + 网
  for (const lx of [-(sp.w - 6) / 2 + 4, (sp.w - 6) / 2 - 4]) {
    const p = P(lx, 0);
    bMetal.addCyl(0.05, 0.06, 1.1, {
      seg: 6, color: C.steel,
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(p[0], heightAt(p[0], p[1]) + 0.55, p[1]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
    });
  }
  const a = P(-(sp.w - 6) / 2 + 4, 0), bb = P((sp.w - 6) / 2 - 4, 0);
  const ya = heightAt(a[0], a[1]) + 1.05;
  const yb = heightAt(bb[0], bb[1]) + 1.05;
  bMetal.quad(
    [a[0], ya, a[1]], [bb[0], yb, bb[1]],
    [bb[0], yb - 0.95, bb[1]], [a[0], ya - 0.95, a[1]], 0x3a3f3c
  );
}

// ------------------------------------------------------------------ 篮球（可抓）
function basketball(ctx, x, z, rnd) {
  const g = icoGeo();
  const b = new GeoBuilder('ball');
  b.add(g, new THREE.Matrix4().makeScale(0.122, 0.122, 0.122), {
    facetColor: () => (Math.random() < 0.18 ? 0x2b211c : 0xc9702c),
  });
  const mesh = new THREE.Mesh(b.build(), propMaterials().bush);
  const gy = heightAt(x, z);
  mesh.position.set(x, gy + 0.122, z);
  mesh.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
  mesh.name = 'basketball';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.group.add(mesh);
  ctx.grabbables.push({
    mesh, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
    radius: 0.13, mass: 0.6, label: '篮球',
  });
}

// ------------------------------------------------------------------ 入口
export function createSports(ctx) {
  const mats = propMaterials();
  const rnd = makeRng((SEED ^ 0x5b0077) >>> 0);
  const bStone = new GeoBuilder('sports-stone');
  const bMetal = new GeoBuilder('sports-metal');
  const bTrack = new GeoBuilder('sports-track');

  let hoops = 0;
  let goals = 0;
  for (const sp of SPORTS) {
    const kind = sp.kind;
    if (kind === 'track') {
      trackField(bStone, null, bTrack, sp);
      // 篮球场/看台外的围网柱
    } else if (kind === 'football') {
      footballPitch(bStone, bTrack, sp);
      goals += 2;
    } else if (kind === 'court') {
      const isTennis = sp.name.includes('网球');
      if (isTennis) tennisCourt(bStone, bMetal, bTrack, sp);
      else hoops += basketballCourt(bStone, bMetal, bTrack, sp, rnd);
    }
  }

  // 围网柱（运动场周边，简化为立柱 + 横杆）
  for (const sp of SPORTS) {
    if (sp.kind === 'football') continue;
    const c = Math.cos(sp.rot || 0), s = Math.sin(sp.rot || 0);
    const hw = sp.w / 2 - 0.4, hd = sp.d / 2 - 0.4;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], bb = corners[(i + 1) % 4];
      const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      const n = Math.max(1, Math.round(len / 4));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const lx = a[0] + (bb[0] - a[0]) * t, lz = a[1] + (bb[1] - a[1]) * t;
        const wx = sp.x + c * lx + s * lz, wz = sp.z - s * lx + c * lz;
        const gy = heightAt(wx, wz);
        bMetal.addCyl(0.045, 0.05, 3.2, {
          seg: 5, color: C.steel,
          matrix: new THREE.Matrix4().compose(new THREE.Vector3(wx, gy + 1.6, wz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
        });
      }
    }
  }

  // 篮球（可抓）撒在篮球场与广场
  const ballSpots = [
    [180, -46], [186, -74], [172, -52], [-425, 96], [-416, 72], [400, 448],
    [14, 12], [-24, -16], [250, -128], [150, 292],
  ];
  for (const [x, z] of ballSpots) {
    if (!insideCampus(x, z, 2)) continue;
    basketball(ctx, x, z, rnd);
  }

  // 篮球架碰撞体
  for (const sp of SPORTS) {
    if (sp.kind !== 'court' || sp.name.includes('网球')) continue;
    const n = Math.max(1, Math.round(sp.w / 30));
    const cw = (sp.w - 2) / n;
    const c = Math.cos(sp.rot || 0), s = Math.sin(sp.rot || 0);
    for (let i = 0; i < n; i++) {
      const lx = -(sp.w - 2) / 2 + cw * (i + 0.5);
      for (const sgn of [-1, 1]) {
        const lz = sgn * (sp.d / 2 - 1.2);
        const x = sp.x + c * lx + s * lz, z = sp.z - s * lx + c * lz;
        ctx.colliders.push({ type: 'cyl', x, z, r: 0.22, h: 3.3, tag: 'hoop' });
      }
    }
  }

  const stone = bake(bStone, mats.court, 'sports-stone');
  const metal = bake(bMetal, mats.metal, 'sports-metal');
  const track = bake(bTrack, mats.court, 'sports-track', false);
  ctx.group.add(stone, metal, track);

  return { hoops, goals };
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
