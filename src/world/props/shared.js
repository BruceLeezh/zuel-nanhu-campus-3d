// 场景植被与街具的共享资源：材质、贴图图集、世界查询辅助。
import * as THREE from 'three';
import { CFG } from '../../core/config.js';
import {
  BUILDINGS, LAKE, PLAZAS, SPORTS, ROADS, CAMPUS_OUTLINE,
} from '../layout.js';
import { pointInPoly, smoothPolyline, distToPolyline, makeRng } from '../../core/util.js';

// ---------------------------------------------------------------- 材质
let MATS = null;

export function propMaterials() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    // 近景树：顶点色 + 平滑法线，双面（叶片是单面片）；emissive 抬升背光面，避免逆光时整棵发黑
    treeNear: std({ vertexColors: true, flatShading: false, roughness: 0.9, metalness: 0.0, emissive: 0x24321c, emissiveIntensity: 0.9, side: THREE.DoubleSide }),
    // 远景树：低模（双面，避免任何面片反面剔除导致“树消失”）
    treeFar: std({ vertexColors: true, flatShading: false, roughness: 0.95, metalness: 0.0, emissive: 0x1e2a18, emissiveIntensity: 0.7, side: THREE.DoubleSide }),
    // 石作/混凝土/木栈道等不透明合并体（合并几何朝向不统一 → 统一双面渲染，避免剔除）
    stone: std({ vertexColors: true, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide }),
    wood: std({ vertexColors: true, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide }),
    // 金属件（灯杆/栏杆/球架/棚架）
    metal: std({ vertexColors: true, roughness: 0.48, metalness: 0.16, side: THREE.DoubleSide }),
    metalDark: std({ vertexColors: true, roughness: 0.55, metalness: 0.12, side: THREE.DoubleSide }),
    // 通透铁艺围栏：一张镂空铁艺纹理贴在有 alphaTest 的面片上（省几万三角面）
    fence: std({
      map: null, alphaTest: 0.5, roughness: 0.5, metalness: 0.45,
      side: THREE.DoubleSide, vertexColors: true,
    }),
    // 运动场面层 + 白线
    court: std({ vertexColors: true, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide }),
    // 灌木/绿篱/树桩
    bush: std({ vertexColors: true, flatShading: false, roughness: 0.92, metalness: 0.0, emissive: 0x28401a, emissiveIntensity: 0.25, side: THREE.DoubleSide }),
    // 草簇/花（单面片，双面渲染）
    grass: std({ vertexColors: true, flatShading: false, roughness: 0.95, metalness: 0.0, emissive: 0x2e451c, emissiveIntensity: 0.25, side: THREE.DoubleSide }),
    // 指示牌图集（合并成一个 mesh + 一张图集）
    sign: std({ map: null, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }),
    // 车棚半透明顶
    canopy: std({
      color: 0xdfe8ee, transparent: true, opacity: 0.38, roughness: 0.25,
      metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
    }),
  };
  MATS.sign.map = signAtlas();
  MATS.sign.map.needsUpdate = true;
  MATS.fence.map = fenceTexture();
  MATS.fence.map.needsUpdate = true;
  return MATS;
}

// ---------------------------------------------------------------- 铁艺围栏纹理
let _fenceTex = null;
/** 一块围栏的标准图案（128×256，透明底，竖栏杆 + 两道横梁 + 枪尖） */
export function fenceTexture() {
  if (_fenceTex) return _fenceTex;
  const W = 128, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // 竖栏杆 9 根
  const n = 9;
  for (let i = 0; i < n; i++) {
    const x = Math.round((i + 0.5) * (W / n));
    g.fillStyle = i % 2 ? '#3d4548' : '#454e51';
    g.fillRect(x - 2, 26, 4, H - 30);
    // 枪尖
    g.beginPath();
    g.moveTo(x - 4, 26);
    g.lineTo(x, 10);
    g.lineTo(x + 4, 26);
    g.closePath();
    g.fillStyle = '#4a5356';
    g.fill();
  }
  // 两道横梁
  g.fillStyle = '#394144';
  g.fillRect(0, 66, W, 8);
  g.fillRect(0, 178, W, 9);
  // 顶部细梁
  g.fillStyle = '#424b4e';
  g.fillRect(0, 30, W, 4);
  _fenceTex = new THREE.CanvasTexture(cv);
  _fenceTex.colorSpace = THREE.SRGBColorSpace;
  _fenceTex.anisotropy = 4;
  return _fenceTex;
}

// ---------------------------------------------------------------- 指示牌 / 公告栏图集
const SIGN_CELLS = [
  { t: '逸夫图书馆', s: '→ 300m', k: 'dir' },
  { t: '五羊广场', s: '↑ 200m', k: 'dir' },
  { t: '南湖会堂', s: '→ 150m', k: 'dir' },
  { t: '第一运动场', s: '↑ 250m', k: 'dir' },
  { t: '晓南湖', s: '↑ 100m', k: 'dir' },
  { t: '学生公寓', s: '→ 400m', k: 'dir' },
  { t: '东门', s: '← 200m', k: 'dir' },
  { t: '北门', s: '↑ 350m', k: 'dir' },
  { t: '教学楼', s: '→ 120m', k: 'dir' },
  { t: '南湖体育馆', s: '↑ 180m', k: 'dir' },
  { t: '学生社团招新', s: '9月20日 · 五羊广场', k: 'poster', c: '#c8452f' },
  { t: '学术讲座', s: '文泉楼报告厅 19:00', k: 'poster', c: '#2f5f8e' },
  { t: '校园歌手大赛', s: '南湖会堂 · 周五', k: 'poster', c: '#7a3f8e' },
  { t: '食堂', s: '→ 200m', k: 'dir' },
  { t: '校医院', s: '→ 260m', k: 'dir' },
  { t: '中南大道', s: '↑ 100m', k: 'dir' },
];

let _atlas = null;
/** 生成 1024×1024 图集，4×4 格；返回 THREE.CanvasTexture */
export function signAtlas() {
  if (_atlas) return _atlas;
  const S = 1024, CELL = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#f5f3ec';
  g.fillRect(0, 0, S, S);
  const font = (px) => `${px}px "Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif`;
  SIGN_CELLS.forEach((cell, i) => {
    const cx = (i % 4) * CELL, cy = Math.floor(i / 4) * CELL;
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.rect(0, 0, CELL, CELL);
    g.clip();
    if (cell.k === 'dir') {
      g.fillStyle = '#1d5b3c';
      g.fillRect(0, 0, CELL, CELL);
      // 边框
      g.strokeStyle = '#eef3e6';
      g.lineWidth = 8;
      g.strokeRect(12, 12, CELL - 24, CELL - 24);
      // 箭头块
      g.fillStyle = '#eef3e6';
      g.beginPath();
      g.moveTo(52, 168); g.lineTo(84, 168); g.lineTo(84, 92); g.lineTo(108, 92);
      g.lineTo(68, 56); g.lineTo(28, 92); g.lineTo(52, 92);
      g.closePath(); g.fill();
      // 主文字
      g.fillStyle = '#ffffff';
      g.font = font(34);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      const t = cell.t;
      if (t.length <= 5) g.fillText(t, 116, 86);
      else { g.font = font(28); g.fillText(t, 106, 86); }
      // 距离
      g.fillStyle = '#cfe3c4';
      g.font = font(26);
      g.fillText(cell.s, 116, 140);
      // 底部细线
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(40, 200); g.lineTo(CELL - 40, 200); g.stroke();
    } else {
      // 公告栏海报
      g.fillStyle = '#f7f2e4';
      g.fillRect(0, 0, CELL, CELL);
      g.fillStyle = cell.c;
      g.fillRect(14, 14, CELL - 28, 96);
      g.fillStyle = '#fdfbf3';
      g.font = font(30);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(cell.t, CELL / 2, 66);
      g.fillStyle = '#4a4438';
      g.font = font(20);
      g.textAlign = 'left';
      const lines = cell.s.split(' ');
      lines.forEach((ln, k) => g.fillText(ln, 26, 150 + k * 30));
      // 假文字块
      g.fillStyle = 'rgba(90,84,70,0.30)';
      for (let r = 0; r < 3; r++) g.fillRect(26, 208 + r * 14, CELL - 52 - r * 26, 6);
    }
    g.restore();
  });
  _atlas = new THREE.CanvasTexture(cv);
  _atlas.colorSpace = THREE.SRGBColorSpace;
  _atlas.anisotropy = 4;
  _atlas.needsUpdate = true;
  return _atlas;
}

/** 图集第 i 格的 UV 矩形（带内缩，避免 mip 串色） */
export function atlasUV(i, inset = 0.008) {
  const col = i % 4, row = Math.floor(i / 4);
  const u0 = col / 4 + inset, u1 = (col + 1) / 4 - inset;
  // 画布 v 向上，纹理 v 向上：第 0 行在画布顶部 → v 大
  const v0 = 1 - (row + 1) / 4 + inset, v1 = 1 - row / 4 - inset;
  return { u0, u1, v0, v1 };
}

export const SIGN_TEX = {
  lib: 0, plaza: 1, hall: 2, stadium: 3, lake: 4, dorm: 5, eastGate: 6,
  northGate: 7, teach: 8, gym: 9, poster0: 10, poster1: 11, poster2: 12,
  canteen: 13, hospital: 14, zhongnan: 15,
};

// ---------------------------------------------------------------- 世界数据展开
let _boxes = null;
/** 把所有建筑展开成世界包围盒（含 group 的 cells） */
export function buildingBoxes() {
  if (_boxes) return _boxes;
  const out = [];
  for (const b of BUILDINGS) {
    if (b.group && Array.isArray(b.cells)) {
      for (const c of b.cells) {
        out.push({ x: c[0], z: c[1], w: 26, d: 15, h: b.h || 20, rot: b.rot || 0 });
      }
    } else {
      out.push({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, rot: b.rot || 0 });
    }
  }
  _boxes = out;
  return out;
}

/** 点到矩形的距离（内部为 0），用于判断与建筑的安全距离 */
export function rectDist(px, pz, b) {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const dx = px - b.x, dz = pz - b.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.max(Math.abs(lx) - b.w / 2, 0);
  const qz = Math.max(Math.abs(lz) - b.d / 2, 0);
  return Math.hypot(qx, qz);
}

/** 是否在水面（湖 + 三个水塘），margin 米外扩 */
export function inWater(x, z, margin = 0) {
  if (pointInPoly(x, z, LAKE.poly)) {
    if (margin <= 0) return true;
    // 外扩：到多边形边界的距离
    let dmin = Infinity;
    const p = LAKE.poly;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      dmin = Math.min(dmin, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
    }
    if (dmin <= margin) return true;
  }
  for (const pond of LAKE.ponds || []) {
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + margin) return true;
  }
  return false;
}

/** 到最近道路中心线的距离（各减去半宽后的净距离） */
export function roadClearance(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    const half = (r.width || 8) / 2 + (r.sidewalk || 1.6);
    const d = distToPolyline(x, z, r.pts) - half;
    if (d < best) best = d;
  }
  return best;
}

/** 到最近道路中心线的“原始”距离（不减半宽） */
export function roadDistRaw(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    const d = distToPolyline(x, z, r.pts);
    if (d < best) best = d;
  }
  return best;
}

/** 是否落在广场铺装面上（kind='plaza'） */
export function inPlaza(x, z, shrink = 0.92) {
  for (const p of PLAZAS) {
    if (p.kind === 'garden') continue;
    const dx = (x - p.x) / (p.rx * shrink);
    const dz = (z - p.z) / (p.rz * shrink);
    if (dx * dx + dz * dz < 1) return true;
  }
  return false;
}

/** 是否在运动场内（矩形，外扩 pad 米） */
export function inSports(x, z, pad = 0) {
  for (const s of SPORTS) {
    const dx = Math.abs(x - s.x), dz = Math.abs(z - s.z);
    if (dx < s.w / 2 + pad && dz < s.d / 2 + pad) return true;
  }
  return false;
}

/** 校园轮廓内（inset 米内缩） */
export function insideCampus(x, z, inset = 0) {
  if (!pointInPoly(x, z, CAMPUS_OUTLINE)) return false;
  if (inset <= 0) return true;
  return distToCampusEdge(x, z) > inset;
}

export function distToCampusEdge(x, z) {
  let dmin = Infinity;
  const p = CAMPUS_OUTLINE;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    dmin = Math.min(dmin, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
  }
  return dmin;
}

/** 到建筑的最小距离 */
export function buildingClearance(x, z) {
  let best = Infinity;
  for (const b of buildingBoxes()) {
    const d = rectDist(x, z, b);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/**
 * 一个通用“可放置”判断：校园内、不在水面/广场/运动场、离建筑和道路有净距。
 * opts: {inset, water, building, road, plaza, sports}
 */
export function siteClear(x, z, opts = {}) {
  const {
    inset = 6, water = 2, building = 3, road = 2.5, plaza = true, sports = true,
  } = opts;
  if (!insideCampus(x, z, inset)) return false;
  if (inWater(x, z, water)) return false;
  if (buildingClearance(x, z) < building) return false;
  if (roadClearance(x, z) < road) return false;
  if (plaza && inPlaza(x, z)) return false;
  if (sports && inSports(x, z, 2)) return false;
  return true;
}

// ---------------------------------------------------------------- 折线采样
/** 沿折线按固定间距采样（平滑后），返回 {x,z,ang,nx,nz} */
export function sampleAlong(pts, spacing, opts = {}) {
  const sub = opts.sub == null ? 6 : opts.sub;
  const sm = sub > 0 ? smoothPolyline(pts, sub) : pts;
  const cum = [0];
  for (let i = 1; i < sm.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const start = opts.start || 0;
  const out = [];
  let seg = 0;
  for (let d = start; d <= total; d += spacing) {
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const a = sm[seg], b = sm[seg + 1] || sm[seg];
    const segLen = (cum[seg + 1] - cum[seg]) || 1;
    const t = (d - cum[seg]) / segLen;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    out.push({ x, z, ang: Math.atan2(dz, dx), nx: -dz / l, nz: dx / l, t: d / total });
  }
  return out;
}

/** 沿折线每隔间距取横向偏移点 */
export function offsetPoint(p, off) {
  return [p.x + p.nx * off, p.z + p.nz * off];
}

/** 简单空间哈希，避免重复种植 */
export class SpatialHash {
  constructor(cell = 4) {
    this.cell = cell;
    this.map = new Map();
    this.rnd = makeRng(0x5eed);
  }

  static key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  add(x, z, data) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const k = SpatialHash.key(cx, cz);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push({ x, z, data });
  }

  /** 返回半径内最近距离（无邻居返回 Infinity） */
  nearest(x, z, radius) {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = Infinity;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const arr = this.map.get(SpatialHash.key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const d = Math.hypot(arr[i].x - x, arr[i].z - z);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

/** 数学小工具 */
export function t2(a, b, k) { return a + (b - a) * k; }

export const SEED = CFG.seed || 20261109;
