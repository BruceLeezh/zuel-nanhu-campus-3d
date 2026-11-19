// 校园树木：5 个树型（香樟 / 法桐 / 水杉 / 垂柳 / 银杏）。
// 近景（<120m）每种树型一个 InstancedMesh（分叉树干 + 几何簇叶，顶点色）；
// 远景全部合并为 2 个共享低模 InstancedMesh（阔叶 / 针叶），per-instance 颜色。
// 每 ~200ms 依据主相机距离重排实例槽位（swap-with-last 压缩数组）。
import * as THREE from 'three';
import { GeoBuilder, icoGeo, rgb, mixRgb, scaleRgb } from './merge.js';
import {
  propMaterials, sampleAlong, siteClear, insideCampus, inWater, buildingClearance,
  roadClearance, inPlaza, inSports, SpatialHash, SEED, distToCampusEdge,
} from './shared.js';
import { heightAt } from '../terrain.js';
import { TREE_ZONES, ROADS, GATES, LAKE, LANDMARKS, PLAZAS, SPORTS } from '../layout.js';
import { makeRng } from '../../core/util.js';

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const GOLDEN = 2.3999632297286535;

// ------------------------------------------------------------------ 树型几何
// 近景团块可用 detail=1 的 icosahedron（80 面）让轮廓更圆
const _icoCache = [icoGeo(), null];
function icoGeoD(d) {
  if (d <= 0) return _icoCache[0];
  if (!_icoCache[1]) _icoCache[1] = new THREE.IcosahedronGeometry(1, 1);
  return _icoCache[1];
}

function blob(b, x, y, z, rx, ry, rz, hex, jitter = 0.14, detail = 0, shade = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    _q.setFromEuler(new THREE.Euler(b.rand() * 0.8, b.rand() * 6.283, b.rand() * 0.8)),
    new THREE.Vector3(rx, ry, rz)
  );
  const col = shade === 1 ? rgb(hex) : scaleRgb(rgb(hex), shade);
  b.add(icoGeoD(detail), m, { colorRgb: col, jitter });
}

/** 在椭球壳内均匀撒“团块”（中心 0.8× 暗，外缘 1.15× 亮） */
function crownBlobs(b, cx, cy, cz, rx, ry, rz, n, size, dark, mid, detail = 0) {
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN + b.rand() * 0.4;
    const u = (i + 0.5) / n;
    const phi = Math.acos(1 - 1.7 * u * 0.95);
    const sp = Math.sin(phi);
    const dx = Math.cos(a) * sp, dy = Math.cos(phi), dz = Math.sin(a) * sp;
    const rf = 0.3 + 0.62 * b.rand();
    const sc = size * (0.7 + 0.55 * b.rand());
    // 内深外浅：团块离树冠中心越远越亮（0.8× → 1.18×），消除“纸片/平板”感
    const shade = 0.8 + 0.38 * rf;
    const col = scaleRgb(mixRgb(rgb(dark), rgb(mid), b.rand()), shade);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx + dx * rx * rf, cy + dy * ry * rf, cz + dz * rz * rf),
      _q.setFromEuler(new THREE.Euler(b.rand() * 1.2, b.rand() * 6.28, b.rand() * 1.2)),
      new THREE.Vector3(sc, sc * (0.72 + 0.4 * b.rand()), sc)
    );
    b.add(icoGeoD(detail), m, { colorRgb: col, jitter: 0.16 });
  }
}

/** 在椭球壳上撒叶片 */
function crownLeaves(b, cx, cy, cz, rx, ry, rz, n, size, base, tip, droop = 0) {
  const cBase = rgb(base), cTip = rgb(tip);
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN + b.rand() * 0.7;
    const u = (i + 0.5) / n;
    const phi = Math.acos(1 - 1.9 * u * 0.95);
    const sp = Math.sin(phi);
    const dx = Math.cos(a) * sp, dy = Math.cos(phi), dz = Math.sin(a) * sp;
    const rf = 0.84 + 0.2 * b.rand();
    const px = cx + dx * rx * rf, py = cy + dy * ry * rf, pz = cz + dz * rz * rf;
    const dir = [dx + (b.rand() - 0.5) * 0.7, dy * 0.55 + 0.3 - droop, dz + (b.rand() - 0.5) * 0.7];
    b.leafQuad([px, py, pz], dir, size * (0.7 + 0.6 * b.rand()), cBase, cTip, b.rand() * 6.283);
  }
}

/* ------------------------------------------------ 香樟：常绿阔球冠，校园主力 */
function buildCamphor(b) {
  const BARK = 0x6a5847;
  b.beam([0, 0, 0], [0.1, 3.3, 0.05], 0.27, 0.2, 7, BARK);
  // 根部 3 个小凸起
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    b.beam([0, 0.55, 0], [Math.cos(a) * 0.55, 0.02, Math.sin(a) * 0.55], 0.17, 0.07, 4, BARK);
  }
  const tips = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.283 + 0.35;
    const r = 2.0 + b.rand() * 0.9;
    const tip = [Math.cos(a) * r, 5.9 + b.rand() * 1.6, Math.sin(a) * r];
    b.beam([0.1, 3.3, 0.05], tip, 0.21, 0.085, 5, BARK);
    tips.push(tip);
  }
  for (let i = 0; i < 4; i++) {
    const t = tips[i];
    const a = Math.atan2(t[2], t[0]) + 0.7;
    b.beam(t, [t[0] + Math.cos(a) * 0.9, t[1] + 1.1, t[2] + Math.sin(a) * 0.9], 0.075, 0.032, 4, BARK);
  }
  // 树冠：三层小团块（内深外浅）+ 细碎叶片，轮廓起伏自然，避免“几块大石头”感
  crownBlobs(b, 0, 8.0, 0, 2.9, 2.4, 2.9, 8, 1.05, 0x38562a, 0x456930, 0);
  crownBlobs(b, 0, 8.4, 0, 4.0, 3.3, 4.0, 13, 0.92, 0x4a6f31, 0x5a823c, 0);
  crownBlobs(b, 0, 8.7, 0, 4.2, 3.5, 4.2, 8, 0.8, 0x577e3a, 0x6e9847, 1);
  crownLeaves(b, 0, 8.5, 0, 4.7, 4.0, 4.7, 62, 0.46, 0x4f7233, 0x93ba58);
}

/* ------------------------------------------------ 法桐：高大、分叉明显 */
function buildPlane(b) {
  const BARK = 0x8c8168;
  b.beam([0, 0, 0], [0.05, 4.4, 0.02], 0.31, 0.23, 8, BARK);
  const fork = [0.05, 4.4, 0.02];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.283 + 0.6;
    const mid = [Math.cos(a) * 1.7, 9.2 + b.rand() * 1.2, Math.sin(a) * 1.7];
    b.beam(fork, mid, 0.31, 0.15, 6, BARK);
    for (let k = 0; k < 2; k++) {
      const a2 = a + (k ? 0.6 : -0.6);
      const tip = [mid[0] + Math.cos(a2) * 2.1, 13.4 + b.rand() * 1.6, mid[2] + Math.sin(a2) * 2.1];
      b.beam(mid, tip, 0.145, 0.05, 5, BARK);
    }
  }
  crownBlobs(b, 0, 13.2, 0, 3.7, 3.2, 3.7, 10, 1.2, 0x44612e, 0x50743a);
  crownBlobs(b, 0, 13.6, 0, 4.7, 4.0, 4.7, 13, 1.0, 0x4f7136, 0x638b41);
  crownBlobs(b, 0, 14.0, 0, 5.2, 4.4, 5.2, 10, 0.84, 0x5a7f3e, 0x74994c, 1);
  crownLeaves(b, 0, 13.6, 0, 5.3, 4.5, 5.3, 54, 0.9, 0x53723a, 0x93b055);
}

/* ------------------------------------------------ 水杉：塔形针叶 */
function buildMetasequoia(b) {
  const BARK = 0x6b5b48;
  b.beam([0, 0, 0], [0, 22.8, 0], 0.26, 0.04, 6, BARK);
  const base = rgb(0x35512a), top = rgb(0x6b8f3c);
  // 层叠锥壳：每层一个扁锥，半径自下而上收缩，形成饱满塔形
  const layers = 8;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = 4.0 + i * 2.35;
    const rBot = Math.max(0.42, 3.35 * Math.pow(1 - t * 0.94, 1.12));
    const rTop = rBot * 0.34;
    const h = 4.2 - t * 0.9;
    const col = mixRgb(base, top, t * 0.85);
    b.addCyl(rTop, rBot, h, {
      y: y + h * 0.5, seg: 8, colorRgb: col, jitter: 0.1,
      capTop: true, capBot: false,
    });
    // 层边下垂的针叶碎面，柔化轮廓
    const dirs = 7;
    for (let k = 0; k < dirs; k++) {
      const a = (k / dirs) * 6.283 + i * 0.55;
      const dx = Math.cos(a), dz = Math.sin(a);
      b.leafQuad(
        [dx * rBot * 0.94, y + h * 0.16, dz * rBot * 0.94],
        [dx, -0.55 - t * 0.2, dz],
        1.15 - t * 0.42,
        col, mixRgb(col, rgb(0x9dbb62), 0.55), 1.57 + a
      );
    }
  }
  // 顶梢
  b.addCyl(0.02, 0.5, 2.6, { y: 23.4, seg: 5, colorRgb: mixRgb(top, rgb(0x9dbb62), 0.4), capTop: true });
}

/* ------------------------------------------------ 垂柳：湖畔垂枝 */
function buildWillow(b) {
  const BARK = 0x6f6049;
  b.beam([0, 0, 0], [0.32, 2.7, 0.1], 0.24, 0.17, 7, BARK);
  const tips = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.283 + 0.9;
    const tip = [0.32 + Math.cos(a) * (1.5 + b.rand() * 0.9), 6.0 + b.rand() * 1.4, 0.1 + Math.sin(a) * (1.5 + b.rand() * 0.9)];
    b.beam([0.32, 2.7, 0.1], tip, 0.17, 0.06, 5, BARK);
    tips.push(tip);
  }
  // 垂枝：从树冠四周垂下（连续窄带 6 段，形成柳帘而非碎叶）
  const cBase = rgb(0x6d8c37), cTip = rgb(0xa7c05e);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * 6.283 + b.rand() * 0.25;
    const rr = 1.6 + b.rand() * 2.2;
    const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
    const py = 6.8 + b.rand() * 0.9;
    const hang = 3.6 + b.rand() * 2.6;
    const segs = 6;
    for (let k = 0; k < segs; k++) {
      const f = (k + 0.5) / segs;
      b.leafQuad(
        [px * (1 - f * 0.1), py - hang * f, pz * (1 - f * 0.1)],
        [Math.cos(a) * 0.12, -1, Math.sin(a) * 0.12],
        0.66 - f * 0.1, mixRgb(cBase, cTip, f), cTip, a
      );
    }
  }
  // 冠内浅绿团块，让柳冠不成空壳
  crownBlobs(b, 0.2, 6.6, 0.1, 2.4, 1.5, 2.4, 5, 1.1, 0x5c7f36, 0x7ba044, 0);
  crownBlobs(b, 0, 7.1, 0, 2.1, 1.6, 2.1, 6, 1.05, 0x4e6c2c, 0x6d8c37);
}

/* ------------------------------------------------ 银杏：秋色行道树 */
function buildGinkgo(b) {
  const BARK = 0x7c6f59;
  b.beam([0, 0, 0], [0.04, 4.5, 0.02], 0.28, 0.2, 7, BARK);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.283 + 0.3;
    const tip = [Math.cos(a) * (1.5 + b.rand() * 0.8), 7.4 + b.rand() * 1.3, Math.sin(a) * (1.5 + b.rand() * 0.8)];
    b.beam([0.04, 4.5, 0.02], tip, 0.19, 0.06, 5, BARK);
  }
  crownBlobs(b, 0, 10.2, 0, 2.8, 3.0, 2.8, 8, 1.05, 0x7d5f1c, 0x94711f);
  crownBlobs(b, 0, 10.6, 0, 3.5, 3.8, 3.5, 11, 0.92, 0x9a761f, 0xb58e28);
  crownBlobs(b, 0, 11.0, 0, 3.9, 4.1, 3.9, 9, 0.76, 0xb18a25, 0xc9a031);
  crownLeaves(b, 0, 10.6, 0, 4.0, 4.2, 4.0, 52, 0.78, 0xc39a2c, 0xf0d268);
}

/* ------------------------------------------------ 远景低模 */
function buildFarBroad(b) {
  const BARK = 0x6a5a48;
  b.addCyl(0.26, 0.4, 3.6, { y: 1.8, seg: 3, color: BARK, capTop: false });
  // 单团块 + 轻微偏心，120m 外仅约 40px 高，靠 instanceColor 与树冠色差形成层次
  blob(b, 0, 7.6, 0, 4.1, 3.7, 4.1, 0xf4f4f4, 0.2);
}

function buildFarCone(b) {
  const BARK = 0x6a5a48;
  b.addCyl(0.22, 0.36, 3.2, { y: 1.6, seg: 4, color: BARK, capTop: false });
  const c1 = 0xffffff, c2 = 0xe4e4e4;
  b.addCyl(0.06, 2.9, 10.5, { y: 9.0, seg: 5, color: c2, capTop: false, capBot: true });
  b.addCyl(0.02, 1.7, 6.4, { y: 17.4, seg: 4, color: c1, capTop: true, capBot: true });
}

// ------------------------------------------------------------------ 树种表
const SPECIES = [
  { key: 'camphor', name: '香樟', build: buildCamphor, h: 12.6, canopy: 0x4a6a33, far: 'broad', leaf: 0x4f7237 },
  { key: 'plane', name: '法桐', build: buildPlane, h: 18.6, canopy: 0x5f8038, far: 'broad', leaf: 0x6b8d41 },
  { key: 'metasequoia', name: '水杉', build: buildMetasequoia, h: 23.2, canopy: 0x5b7d3d, far: 'cone', leaf: 0x6c9040 },
  { key: 'willow', name: '垂柳', build: buildWillow, h: 12.0, canopy: 0x7c9a42, far: 'broad', leaf: 0x86a64a },
  { key: 'ginkgo', name: '银杏', build: buildGinkgo, h: 15.2, canopy: 0xc39a2c, far: 'broad', leaf: 0xd8b242 },
];
const SP_CAMPHOR = 0, SP_PLANE = 1, SP_METASEQ = 2, SP_WILLOW = 3, SP_GINKGO = 4;

// 每个树区的目标密度（棵 / 1000 m²，乘 TREE_ZONES.density）
const ZONE_BASE = { hillforest: 19, forest: 14, garden: 17, scatter: 2.2, avenue: 0 };
// 行道树：路名 → 树种
const AVENUE_SPECIES = {
  南湖大道: SP_PLANE, 民族大道: SP_PLANE, 中原大道: SP_METASEQ, 博文路: SP_GINKGO,
  中南大道: SP_CAMPHOR, 厚德路: SP_CAMPHOR, 济世路: SP_CAMPHOR, 治国路: SP_CAMPHOR,
  水蓝路: SP_METASEQ, 齐家路: SP_CAMPHOR, 梓年路: SP_CAMPHOR, 亲民路: SP_WILLOW,
  修身路: SP_GINKGO, 格物街: SP_CAMPHOR, 正心街: SP_CAMPHOR, 诚意街: SP_CAMPHOR,
  明理路: SP_CAMPHOR, 天下路: SP_CAMPHOR,
};

// ------------------------------------------------------------------ 播种
function pickZoneSpecies(kind, rnd) {
  const r = rnd();
  if (kind === 'hillforest') {
    if (r < 0.42) return SP_CAMPHOR;
    if (r < 0.63) return SP_PLANE;
    if (r < 0.88) return SP_METASEQ;
    return SP_GINKGO;
  }
  if (kind === 'garden') {
    if (r < 0.32) return SP_CAMPHOR;
    if (r < 0.55) return SP_GINKGO;
    if (r < 0.72) return SP_PLANE;
    if (r < 0.85) return SP_METASEQ;
    return SP_WILLOW;
  }
  if (kind === 'scatter') {
    if (r < 0.46) return SP_CAMPHOR;
    if (r < 0.72) return SP_PLANE;
    if (r < 0.86) return SP_GINKGO;
    return SP_METASEQ;
  }
  // forest
  if (r < 0.36) return SP_CAMPHOR;
  if (r < 0.58) return SP_PLANE;
  if (r < 0.9) return SP_METASEQ;
  return SP_GINKGO;
}

function nearLandmark(x, z, extra = 0) {
  for (const l of LANDMARKS) {
    const rr = (l.r || 12) + extra;
    if (Math.hypot(x - l.x, z - l.z) < rr) return true;
  }
  return false;
}

function nearGate(x, z, radius = 15) {
  for (const g of GATES) {
    if (Math.hypot(x - g.x, z - g.z) < radius) return true;
  }
  return false;
}

/** 其他道路（不含 self）的净距 */
function otherRoadClearance(x, z, self) {
  let best = Infinity;
  for (const r of ROADS) {
    if (r === self) continue;
    const half = (r.width || 8) / 2 + (r.sidewalk || 1.6) + 3.4;
    const d = Math.hypot(0, 0) + distanceToRoad(x, z, r) - half;
    if (d < best) best = d;
  }
  return best;
}

function distanceToRoad(x, z, r) {
  const pts = r.pts;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

function plant(rnd) {
  const trees = [];
  const hash = new SpatialHash(5);
  const push = (x, z, sp, scale, flags = 0) => {
    const y = heightAt(x, z);
    if (y < -2.2) return false;
    const t = {
      x, z, y,
      sp,
      rot: rnd() * 6.283,
      scale,
      tint: 0.86 + rnd() * 0.28,
      tier: 1,
      slot: 0,
      height: SPECIES[sp].h * scale,
      flags,
    };
    trees.push(t);
    hash.add(x, z, t);
    return true;
  };

  // ---------- 1. 树区
  for (const zone of TREE_ZONES) {
    if (zone.kind === 'avenue') continue; // 行道树单独沿路排
    const area = Math.PI * zone.rx * zone.rz;
    const base = ZONE_BASE[zone.kind] || 10;
    const target = Math.round((area / 1000) * base * zone.density);
    let placed = 0;
    const attempts = target * 4;
    for (let i = 0; i < attempts && placed < target; i++) {
      const a = rnd() * 6.283;
      const rr = Math.sqrt(rnd());
      const x = zone.x + Math.cos(a) * rr * zone.rx;
      const z = zone.z + Math.sin(a) * rr * zone.rz;
      if (!siteClear(x, z, { inset: 4, water: 2, building: 2.6, road: 2.2 })) continue;
      if (nearLandmark(x, z, 6)) continue;
      if (nearGate(x, z, 13)) continue;
      const minGap = zone.kind === 'forest' || zone.kind === 'hillforest' ? 4.2 : 5.4;
      if (hash.nearest(x, z, minGap) < minGap) continue;
      // 林窗：用低频随机留出空地
      if ((zone.kind === 'forest' || zone.kind === 'hillforest') && rnd() < 0.16) continue;
      const sp = pickZoneSpecies(zone.kind, rnd);
      const sc = (zone.kind === 'forest' || zone.kind === 'hillforest')
        ? 0.82 + rnd() * 0.4 : 0.88 + rnd() * 0.3;
      if (push(x, z, sp, sc)) placed++;
    }
  }

  // ---------- 2. 行道树
  for (const road of ROADS) {
    const sp = AVENUE_SPECIES[road.name] != null ? AVENUE_SPECIES[road.name] : SP_CAMPHOR;
    const halfW = (road.width || 8) / 2;
    const sw = road.sidewalk || 1.6;
    const off = halfW + sw + 2.3;
    const spacing = road.width >= 18 ? 11 : road.width >= 10 ? 14 : 18;
    const sides = road.width >= 9 ? [-1, 1] : [1];
    for (const side of sides) {
      for (const p of sampleAlong(road.pts, spacing, { start: spacing * 0.5 })) {
        const x = p.x + p.nx * off * side;
        const z = p.z + p.nz * off * side;
        if (!insideCampus(x, z, 2.5)) continue;
        if (inWater(x, z, 1.5)) continue;
        if (nearGate(x, z, 15)) continue;
        if (buildingClearance(x, z) < 2.4) continue;
        if (otherRoadClearance(x, z, road) < 0) continue;
        if (inPlaza(x, z, 0.98) || inSports(x, z, 3)) continue;
        if (hash.nearest(x, z, 4.6) < 4.6) continue;
        const sc = 0.86 + rnd() * 0.26;
        push(x, z, sp, sc, 2);
      }
    }
  }

  // ---------- 3. 沿湖垂柳带（岸线外 2–6m，两排，8m 一株，尽量连续不断）
  const lakeCenter = { x: LAKE.center.x, z: LAKE.center.z };
  const poly = LAKE.poly;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b2 = poly[(i + 1) % poly.length];
    const segLen = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
    if (segLen < 1) continue;
    const dx = (b2[0] - a[0]) / segLen, dz = (b2[1] - a[1]) / segLen;
    for (let d = 4; d < segLen; d += 5) {
      const px = a[0] + dx * d, pz = a[1] + dz * d;
      // 外法线（远离湖心）
      const mx = px - lakeCenter.x, mz = pz - lakeCenter.z;
      const ml = Math.hypot(mx, mz) || 1;
      const ox = (mx / ml), oz = (mz / ml);
      for (let row = 0; row < 2; row++) {
        const off = 2.6 + row * 2.7;
        const x = px + ox * off + (rnd() - 0.5) * 1.5;
        const z = pz + oz * off + (rnd() - 0.5) * 1.5;
        if (!insideCampus(x, z, 2.5)) continue;
        if (inWater(x, z, 0.6)) continue;
        if (buildingClearance(x, z) < 2.0) continue;
        if (roadClearance(x, z) < 0.4) continue;
        if (hash.nearest(x, z, 1.7) < 1.7) continue;
        const sp = rnd() < 0.86 ? SP_WILLOW : SP_METASEQ;
        push(x, z, sp, 0.9 + rnd() * 0.28, 4);
      }
    }
  }
  // 晓湖园小池塘的垂柳
  for (const pond of LAKE.ponds || []) {
    const n = pond.r > 20 ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rnd() * 0.4;
      const rr = pond.r + 3.2 + rnd() * 2.2;
      const x = pond.x + Math.cos(a) * rr;
      const z = pond.z + Math.sin(a) * rr;
      if (!insideCampus(x, z, 3)) continue;
      if (inWater(x, z, 1)) continue;
      if (buildingClearance(x, z) < 3) continue;
      if (hash.nearest(x, z, 4.5) < 4.5) continue;
      push(x, z, rnd() < 0.7 ? SP_WILLOW : SP_GINKGO, 0.85 + rnd() * 0.2, 4);
    }
  }

  // ---------- 4. 广场四周的框景树
  for (const p of PLAZAS) {
    const n = p.kind === 'plaza' ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + 0.18;
      const x = p.x + Math.cos(a) * p.rx * 1.06;
      const z = p.z + Math.sin(a) * p.rz * 1.06;
      if (!insideCampus(x, z, 4)) continue;
      if (inWater(x, z, 1)) continue;
      if (roadClearance(x, z) < 1.2) continue;
      if (buildingClearance(x, z) < 2.6) continue;
      if (nearGate(x, z, 12)) continue;
      if (hash.nearest(x, z, 5.5) < 5.5) continue;
      const sp = p.kind === 'garden' ? (rnd() < 0.5 ? SP_GINKGO : SP_CAMPHOR) : SP_CAMPHOR;
      push(x, z, sp, 0.84 + rnd() * 0.22, 8);
    }
  }

  // ---------- 5. 林丛：在空旷草地里补成片小树林，打破“大片空草地”观感
  for (let g = 0; g < 44; g++) {
    for (let tries = 0; tries < 40; tries++) {
      const x0 = -640 + rnd() * 1600;
      const z0 = -540 + rnd() * 1200;
      if (!insideCampus(x0, z0, 12)) continue;
      if (roadClearance(x0, z0) < 6) continue;
      if (buildingClearance(x0, z0) < 8) continue;
      if (inPlaza(x0, z0, 0.9) || inSports(x0, z0, 6) || inWater(x0, z0, 6)) continue;
      if (hash.nearest(x0, z0, 24) < 24) continue;
      const gr = 12 + rnd() * 13;
      const n = 5 + Math.floor(rnd() * 7);
      const spMain = pickZoneSpecies('forest', rnd);
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283;
        const rr = Math.sqrt(rnd()) * gr;
        const x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr;
        if (!insideCampus(x, z, 6)) continue;
        if (roadClearance(x, z) < 2.5) continue;
        if (buildingClearance(x, z) < 3) continue;
        if (inPlaza(x, z, 0.92) || inSports(x, z, 2) || inWater(x, z, 2)) continue;
        if (hash.nearest(x, z, 4.4) < 4.4) continue;
        const sp = rnd() < 0.72 ? spMain : pickZoneSpecies('forest', rnd);
        push(x, z, sp, 0.84 + rnd() * 0.34, 16);
      }
      break;
    }
  }

  // ---------- 6. 中区银杏点缀（文泰楼—图书馆一带，补金色秋景）
  const gZone = { x: -120, z: 74, rx: 96, rz: 64 };
  let gi = 0;
  for (let tries = 0; tries < 1200 && gi < 46; tries++) {
    const a = rnd() * 6.283;
    const rr = Math.sqrt(rnd());
    const x = gZone.x + Math.cos(a) * gZone.rx * rr;
    const z = gZone.z + Math.sin(a) * gZone.rz * rr;
    if (!insideCampus(x, z, 6)) continue;
    if (inWater(x, z, 3)) continue;
    if (roadClearance(x, z) < 2.0) continue;
    if (buildingClearance(x, z) < 3.2) continue;
    if (inPlaza(x, z, 1.02) || inSports(x, z, 2)) continue;
    if (nearGate(x, z, 12)) continue;
    if (hash.nearest(x, z, 6.0) < 6.0) continue;
    if (push(x, z, SP_GINKGO, 0.9 + rnd() * 0.3, 32)) gi++;
  }

  // ---------- 7. 校门内轴线净空：门头前方 65m、半宽 13m 内不留树，避免挡门/逆光黑穹顶
  for (const gate of GATES) {
    const dx = Math.sin(gate.rot || 0), dz = Math.cos(gate.rot || 0);
    for (let i = trees.length - 1; i >= 0; i--) {
      const t = trees[i];
      const vx = t.x - gate.x, vz = t.z - gate.z;
      const proj = vx * dx + vz * dz;
      if (proj < 3 || proj > 65) continue;
      const perp = Math.abs(vx * dz - vz * dx);
      if (perp < 13) trees.splice(i, 1);
    }
  }

  return trees;
}

// ------------------------------------------------------------------ LOD 管理
function makeInstanced(geo, mat, cap) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.count = 0;
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

function makeSet(mesh, cap) {
  return { mesh, cap, members: [] };
}

/** 白昼环境下把烘焙的顶点色提亮（贴图/vertexColor 都在 linear 空间，原色偏暗） */
function boostColor(geo, f) {
  const c = geo.getAttribute('color');
  if (!c) return;
  for (let i = 0; i < c.count; i++) {
    c.setXYZ(i, Math.min(1, c.getX(i) * f), Math.min(1, c.getY(i) * f), Math.min(1, c.getZ(i) * f));
  }
  c.needsUpdate = true;
}

/** 一棵树的当前槽位数据写入 */
function writeInstance(set, i, tree, isNear) {
  const s = tree.scale * 0.62;
  // 行道树香樟（flag 2 = 沿路种植）冠幅放大 1.15：只拉伸水平方向，保持树高不变
  const wide = tree.flags === 2 && tree.sp === SP_CAMPHOR ? 1.15 : 1;
  _m.compose(
    _v.set(tree.x, tree.y - 0.14, tree.z),
    _q.setFromAxisAngle(UP, tree.rot),
    _s.set(s * wide, s, s * wide)
  );
  set.mesh.setMatrixAt(i, _m);
  // 注意：本场景里 InstancedMesh 的 instanceColor 与自定义顶点色叠加会把颜色乘成近黑，
  // 所以近景树只依赖烘焙好的顶点色（品种/明暗都已烘焙），不写 instanceColor。
  if (isNear) return;
  const col = new THREE.Color(SPECIES[tree.sp].canopy);
  _c.setRGB(
    Math.min(1, col.r * 2.2 * tree.tint),
    Math.min(1, col.g * 2.2 * tree.tint),
    Math.min(1, col.b * 2.2 * tree.tint)
  );
  set.mesh.setColorAt(i, _c);
}

class TreeLOD {
  constructor(group, trees, mats) {
    this.trees = trees;
    this.mats = mats;
    this.nearSets = [];
    this.farBroad = null;
    this.farCone = null;
    this.nearCap = 320;
    this.lastUpdate = -1e9;
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this.dirty = new Set();

    const nearCap = this.nearCap;
    for (const sp of SPECIES) {
      const b = new GeoBuilder('tree_' + sp.key);
      sp.build(b);
      const geo = b.build();
      boostColor(geo, 1.85);
      const mesh = makeInstanced(geo, mats.treeNear, nearCap);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.name = 'trees-near-' + sp.key;
      group.add(mesh);
      const set = makeSet(mesh, nearCap);
      set.gtris = geo.userData.tris;
      this.nearSets.push(set);
    }
    // 远景
    const bb = new GeoBuilder('far_broad');
    buildFarBroad(bb);
    const broadGeo = bb.build();
    const broadMesh = makeInstanced(broadGeo, mats.treeFar, trees.length + 16);
    broadMesh.receiveShadow = false;
    broadMesh.name = 'trees-far-broad';
    group.add(broadMesh);
    this.farBroad = makeSet(broadMesh, trees.length + 16);
    this.farBroad.gtris = broadGeo.userData.tris;

    const bc = new GeoBuilder('far_cone');
    buildFarCone(bc);
    const coneGeo = bc.build();
    const coneMesh = makeInstanced(coneGeo, mats.treeFar, trees.length + 16);
    coneMesh.receiveShadow = false;
    coneMesh.name = 'trees-far-cone';
    group.add(coneMesh);
    this.farCone = makeSet(coneMesh, trees.length + 16);
    this.farCone.gtris = coneGeo.userData.tris;

    // 初始：全部进远景，近处再升级
    for (const t of trees) this.addToSet(t, 1);

    // 每帧一次（且限频）的 LOD 更新；相机交给主相机，阴影 pass 会传正交相机 → 跳过
    const hook = (renderer, scene, camera) => {
      if (!camera || camera.isOrthographicCamera) return;
      this.update(camera.position.x, camera.position.z);
    };
    this.nearSets[0].mesh.onBeforeRender = hook;
    this.farBroad.mesh.onBeforeRender = hook;
    this.farCone.mesh.onBeforeRender = hook;
  }

  setFor(tree, tier) {
    if (tier === 0) return this.nearSets[tree.sp];
    return tree.sp === SP_METASEQ ? this.farCone : this.farBroad;
  }

  addToSet(tree, tier) {
    const set = this.setFor(tree, tier);
    if (set.members.length >= set.cap) return false;
    tree.tier = tier;
    tree.slot = set.members.length;
    set.members.push(tree);
    writeInstance(set, tree.slot, tree, tier === 0);
    set.mesh.count = set.members.length;
    this.dirty.add(set);
    return true;
  }

  move(tree, tier) {
    // 先从旧集合移除（swap-with-last）
    const old = this.setFor(tree, tree.tier);
    const last = old.members.length - 1;
    if (tree.slot !== last) {
      const other = old.members[last];
      old.members[tree.slot] = other;
      other.slot = tree.slot;
      old.mesh.getMatrixAt(last, _m);
      old.mesh.setMatrixAt(tree.slot, _m);
      if (old.mesh.instanceColor) {
        old.mesh.getColorAt(last, _c);
        old.mesh.setColorAt(tree.slot, _c);
      }
    }
    old.members.pop();
    old.mesh.count = old.members.length;
    this.dirty.add(old);
    // 再加入新集合（容量满则留在远景）
    if (!this.addToSet(tree, tier)) this.addToSet(tree, 1);
  }

  update(cx, cz) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lastUpdate < 180) return;
    if (Math.abs(cx - this.lastX) + Math.abs(cz - this.lastZ) < 2.0 && this.lastUpdate > 0) return;
    this.lastUpdate = now;
    this.lastX = cx;
    this.lastZ = cz;
    const near2 = 120 * 120;
    const far2 = 138 * 138;
    const trees = this.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = t.x - cx, dz = t.z - cz;
      const d2 = dx * dx + dz * dz;
      if (t.tier === 0) {
        if (d2 > far2) this.move(t, 1);
      } else if (d2 < near2) {
        this.move(t, 0);
      }
    }
    for (const set of this.dirty) {
      set.mesh.instanceMatrix.needsUpdate = true;
      if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
    }
    this.dirty.clear();
  }

  stats() {
    let near = 0, far = 0, ntris = 0, ftris = 0;
    for (const s of this.nearSets) { near += s.members.length; ntris += s.members.length * s.gtris; }
    for (const s of [this.farBroad, this.farCone]) { far += s.members.length; ftris += s.members.length * s.gtris; }
    return { near, far, ntris, ftris };
  }
}

// ------------------------------------------------------------------ 入口
export function createTrees(ctx) {
  const { group, colliders } = ctx;
  const mats = propMaterials();
  const rnd = makeRng(SEED ^ 0x7ee5c0de);
  const trees = plant(rnd);
  const lod = new TreeLOD(group, trees, mats);

  // 碰撞体：每棵一段圆柱
  for (const t of trees) {
    colliders.push({
      type: 'cyl', x: t.x, z: t.z, r: 0.3 + 0.14 * t.scale, h: 5.2, tag: 'tree',
    });
  }

  const out = {
    lod,
    trees,
    count: trees.length,
    byFlag: trees.reduce((m, t) => { m[t.flags] = (m[t.flags] || 0) + 1; return m; }, {}),
    stats: () => lod.stats(),
  };
  if (typeof window !== 'undefined') {
    window.__treeCount = trees.length;
  }
  return out;
}
