// 逐栋资产构建器：把参数化体量写成 .glb（引擎无关）
// 用法：node tools/build-asset.mjs                 → 导出 assets/buildings/*.glb
//      node tools/build-asset.mjs 逸夫图书馆        → 只导出一栋
import { GlbBuilder, validateGlb } from './glb.mjs';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'assets/buildings';

// ---------------------------------------------------------------------------
// 迷你几何库：按材质分桶，最后每桶一个 mesh
// ---------------------------------------------------------------------------
class Bucket {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.n = 0; }
  quad(p0, p1, p2, p3, n, uvScale = 1) {
    const base = this.n;
    const pts = [p0, p1, p2, p3];
    const uv = [[0, 0], [uvScale, 0], [uvScale, uvScale], [0, uvScale]];
    for (let i = 0; i < 4; i++) {
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uv[i][0], uv[i][1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.n += 4;
  }
  /** 轴对齐盒（y 为底面高程），4 个侧面 + 顶 + 底 */
  box(cx, y0, cz, w, h, d, uvScale = 1) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const s = uvScale;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], s);          // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], s);         // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], s);          // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], s);         // -x
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], s);          // top
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], s);         // bottom
    return this;
  }
  /** 圆台/圆柱（y 底面） */
  cyl(cx, y0, cz, rTop, rBot, h, seg = 12) {
    const y1 = y0 + h;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const nx = (c0 + c1) / 2, nz = (s0 + s1) / 2;
      this.quad([cx + c0 * rBot, y0, cz + s0 * rBot], [cx + c1 * rBot, y0, cz + s1 * rBot],
                [cx + c1 * rTop, y1, cz + s1 * rTop], [cx + c0 * rTop, y1, cz + s0 * rTop],
                [nx, 0, nz], 1);
      // 顶盖
      this.quad([cx, y1, cz], [cx + c0 * rTop, y1, cz + s0 * rTop], [cx + c1 * rTop, y1, cz + s1 * rTop], [cx, y1, cz], [0, 1, 0], 1);
    }
    return this;
  }
  /** 四坡屋顶：底矩形 + 屋脊 */
  hipRoof(cx, y0, cz, w, d, h, uvScale = 1) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const rl = Math.max(0, w - d) / 2;   // 屋脊半长（南北向短脊）
    const r0 = [cx - rl, y1, cz], r1 = [cx + rl, y1, cz];
    // 南北两坡
    this.quad([x0, y0, z1], [x1, y0, z1], r1, r0, [0, 0.45, 1], uvScale);
    this.quad([x1, y0, z0], [x0, y0, z0], r0, r1, [0, 0.45, -1], uvScale);
    // 东西两端三角
    this.quad([x1, y0, z1], [x1, y0, z0], r1, r1, [1, 0.3, 0], uvScale);
    this.quad([x0, y0, z0], [x0, y0, z1], r0, r0, [-1, 0.3, 0], uvScale);
    return this;
  }
  get tris() { return this.idx.length / 3; }
}

// ---------------------------------------------------------------------------
// 材质预设
// ---------------------------------------------------------------------------
const MAT = {
  stone: { name: 'stone', color: [0.82, 0.79, 0.72, 1], roughness: 0.92, metalness: 0.02 },
  stoneWarm: { name: 'stoneWarm', color: [0.78, 0.71, 0.60, 1], roughness: 0.9, metalness: 0.02 },
  trim: { name: 'trim', color: [0.93, 0.91, 0.85, 1], roughness: 0.75, metalness: 0.03 },
  glass: { name: 'glass', color: [0.30, 0.45, 0.52, 1], roughness: 0.22, metalness: 0.25, emissive: [0.03, 0.06, 0.08] },
  glassLight: { name: 'glassLight', color: [0.55, 0.70, 0.76, 1], roughness: 0.3, metalness: 0.15 },
  roofTile: { name: 'roofTile', color: [0.40, 0.42, 0.45, 1], roughness: 0.78, metalness: 0.08 },
  roofDeck: { name: 'roofDeck', color: [0.72, 0.70, 0.65, 1], roughness: 0.95, metalness: 0.0 },
  brick: { name: 'brick', color: [0.66, 0.45, 0.36, 1], roughness: 0.93, metalness: 0.0 },
  metal: { name: 'metal', color: [0.62, 0.65, 0.67, 1], roughness: 0.42, metalness: 0.55 },
  dark: { name: 'dark', color: [0.16, 0.19, 0.21, 1], roughness: 0.7, metalness: 0.1 },
  gold: { name: 'gold', color: [0.85, 0.68, 0.28, 1], roughness: 0.35, metalness: 0.8 },
};

// ---------------------------------------------------------------------------
// 参数化建筑：从 spec 生成几何（每栋一个 spec，来自照片量测）
// ---------------------------------------------------------------------------
function buildSpec(spec) {
  const B = {};
  const get = (k) => (B[k] = B[k] || new Bucket());
  const { w, d, floors, floorH, style } = spec;
  const H = floors * floorH;
  const base = spec.baseH ?? 3.0;

  // 基座
  get('stone').box(0, 0, 0, w + 1.4, base, d + 1.4, 3);

  // 主体
  if (style === 'slab' || style === 'library') {
    for (let f = 0; f < floors; f++) {
      const y = base + f * floorH;
      // 玻璃横带（四面内凹 0.35）
      get('glass').box(0, y + 0.85, 0, w - 1.2, floorH * 0.55, d - 1.2, 2);
      // 窗间墙
      get('trim').box(0, y + floorH * 0.62, 0, w, floorH * 0.4, d, 3);
    }
    // 通长壁柱
    const nb = Math.max(4, Math.round(w / 6));
    for (let i = 0; i <= nb; i++) {
      const x = -w / 2 + (i * w) / nb;
      get('trim').box(x, base, d / 2 + 0.18, 0.5, H, 0.42, 1);
      get('trim').box(x, base, -d / 2 - 0.18, 0.5, H, 0.42, 1);
    }
    // 檐口与屋面
    get('trim').box(0, base + H - 0.7, 0, w + 2.0, 0.8, d + 2.0, 3);
    get('roofDeck').box(0, base + H, 0, w, 0.35, d, 4);
  } else if (style === 'classic') {
    get('stoneWarm').box(0, base, 0, w, H, d, 3);
    // 每层拱窗
    const bays = Math.max(4, Math.round(w / 5.2));
    for (let f = 0; f < floors; f++) {
      const y = base + f * floorH + floorH * 0.25;
      for (let b = 0; b < bays; b++) {
        const x = -w / 2 + (b + 0.5) * (w / bays);
        get('dark').box(x, y, d / 2 + 0.06, 1.9, floorH * 0.5, 0.2, 1);
        get('dark').box(x, y, -d / 2 - 0.06, 1.9, floorH * 0.5, 0.2, 1);
      }
      get('trim').box(0, base + (f + 1) * floorH - 0.28, 0, w + 0.5, 0.34, d + 0.5, 3);
    }
    // 四坡瓦顶
    get('roofTile').hipRoof(0, base + H, 0, w + 1.6, d + 1.6, Math.min(7.0, w * 0.1), 3);
    get('trim').box(0, base + H - 0.55, 0, w + 1.9, 0.6, d + 1.9, 3);
  } else if (style === 'dorm') {
    get('brick').box(0, base, 0, w, H, d, 3);
    const bays = Math.max(4, Math.round(w / 3.6));
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const x = -w / 2 + (b + 0.5) * (w / bays);
        const y = base + f * floorH + 0.9;
        get('glassLight').box(x, y, d / 2 + 0.06, 1.5, 1.6, 0.16, 1);
        get('glassLight').box(x, y, -d / 2 - 0.06, 1.5, 1.6, 0.16, 1);
      }
      get('trim').box(0, base + (f + 1) * floorH - 0.2, 0, w + 0.3, 0.22, d + 0.3, 3);
    }
    get('trim').box(0, base + H - 0.6, 0, w + 1.2, 0.7, d + 1.2, 3);
    get('roofDeck').box(0, base + H, 0, w, 0.3, d, 4);
  } else if (style === 'gym') {
    get('stone').box(0, base, 0, w, H * 0.36, d, 3);
    // 筒拱
    const r = w / 2, rise = Math.min(13, w * 0.2);
    const seg = 16;
    for (let i = 0; i < seg; i++) {
      const a0 = Math.PI * (i / seg), a1 = Math.PI * ((i + 1) / seg);
      const p0 = [-Math.cos(a0) * r, base + H * 0.36 + Math.sin(a0) * rise, 0];
      const p1 = [-Math.cos(a1) * r, base + H * 0.36 + Math.sin(a1) * rise, 0];
      const z0 = -d / 2, z1 = d / 2;
      get('metal').quad([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], [0, 1, 0], 3);
      get('trim').quad([p0[0], p0[1] - 0.5, z0], [p1[0], p1[1] - 0.5, z0], [p1[0], p1[1] - 0.5, z1], [p0[0], p0[1] - 0.5, z1], [0, -1, 0], 3);
    }
    get('glassLight').box(0, base + H * 0.1, d / 2 + 0.1, w * 0.7, H * 0.22, 0.3, 2);
  } else {
    get('stone').box(0, base, 0, w, H, d, 3);
    get('roofDeck').box(0, base + H, 0, w, 0.3, d, 4);
  }

  // 入口台阶 + 雨棚（除宿舍外）
  if (style !== 'dorm') {
    const cw = Math.min(w * 0.45, 30);
    get('trim').box(0, base * 0.55, d / 2 + 3.4, cw, 0.5, 7.0, 2);
    for (let i = 0; i < 5; i++) {
      get('stone').box(0, 0.05 + i * 0.02, d / 2 + 6.6 + i * 1.1, cw, 0.26, 1.1, 2);
    }
  }
  return { B, H: base + H };
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
function exportSpec(spec, dir) {
  const { B } = buildSpec(spec);
  const g = new GlbBuilder(spec.name);
  let tris = 0;
  for (const key of Object.keys(B)) {
    const b = B[key];
    if (!b.idx.length) continue;
    const idx = b.n > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx);
    g.addMesh({
      name: `${spec.name}_${key}`,
      position: new Float32Array(b.pos),
      normal: new Float32Array(b.nor),
      uv: new Float32Array(b.uv),
      index: idx,
      material: MAT[key] || MAT.stone,
    });
    tris += b.tris;
  }
  const file = join(dir, `${spec.name}.glb`);
  const res = g.write(file);
  const buf = readFileSync(file);
  const v = validateGlb(file, buf);
  return { ...res, tris, valid: v.ok, reason: v.reason, materials: v.materials };
}

const SPECS = [
  { name: '逸夫图书馆', w: 96, d: 76, floors: 5, floorH: 4.3, style: 'library', baseH: 2.6 },
  { name: '文泰楼', w: 132, d: 56, floors: 6, floorH: 3.85, style: 'slab', baseH: 3.2 },
  { name: '文澜楼', w: 118, d: 58, floors: 6, floorH: 3.8, style: 'slab', baseH: 3.0 },
  { name: '文波楼', w: 110, d: 62, floors: 6, floorH: 4.0, style: 'slab', baseH: 3.0 },
  { name: '文泉楼', w: 104, d: 60, floors: 6, floorH: 3.9, style: 'slab', baseH: 3.0 },
  { name: '文溯楼', w: 76, d: 44, floors: 5, floorH: 4.0, style: 'classic', baseH: 3.0 },
  { name: '文泓楼', w: 74, d: 42, floors: 5, floorH: 4.0, style: 'classic', baseH: 3.0 },
  { name: '文治楼', w: 78, d: 40, floors: 5, floorH: 4.0, style: 'classic', baseH: 3.0 },
  { name: '环湖公寓', w: 40, d: 15, floors: 6, floorH: 3.2, style: 'dorm', baseH: 0.6 },
  { name: '南湖体育馆', w: 62, d: 46, floors: 3, floorH: 5.6, style: 'gym', baseH: 2.0 },
  { name: '体育中心', w: 96, d: 66, floors: 3, floorH: 6.6, style: 'gym', baseH: 2.0 },
];

const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
let total = 0, okCount = 0;
for (const s of SPECS) {
  if (only && s.name !== only) continue;
  const r = exportSpec(s, OUT);
  total += r.bytes; okCount += r.valid ? 1 : 0;
  console.log(`${r.valid ? '✓' : '✗'} ${s.name.padEnd(8, ' ')} ${String(Math.round(r.bytes / 1024)).padStart(5)} KB  tris ${String(r.tris).padStart(6)}  meshes ${r.meshes}  mats ${r.materials}${r.valid ? '' : '  ← ' + r.reason}`);
}
console.log(`\n合计 ${okCount} 个资产，${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}/`);
