// 建筑构件库：勒脚 / 墙身 / 檐口 / 女儿墙 / 入口 / 雨棚 / 台阶 / 挂牌 / 屋顶设备
// 所有构件都往「按材质分桶」的 GeoBuilder 里塞，最后由 buildings.js 每桶一个 mesh。
import { GeoBuilder } from './merge.js';
import { signUV } from './facade.js';

// 全局调色（写进顶点色，材质本身保持白色）
export const C = {
  // 注意：本场景是 ACESFilmic + 强太阳直射，白色在阳光下会直接烧成一片纯白，
  // 所以这些「白」都按渲染后反推压到米灰档。
  trim: 0xe6ddcb,       // 白色线脚 / 柱式
  trimWarm: 0xd8cbb0,   // 米黄石线
  stone: 0xa9a090,      // 花岗石勒脚
  stoneDark: 0x8a8274,
  concrete: 0xc4beb2,
  roofDeck: 0x928e84,   // 屋面（深灰，避免鸟瞰一片白）
  glass: 0x9cb2bf,
  metal: 0x939ba0,
  metalDark: 0x5c6266,
  roofTile: 0xb8bcb4,
  roofRed: 0x8f6053,
  bamboo: 0x9a8a6a,
};

export const BUCKETS = ['wClassic', 'wModern', 'wLibrary', 'wDorm', 'wGym', 'trim', 'stone', 'roof', 'glass', 'metal', 'flat', 'sign'];

// 已建立的 kit 全部登记：染色/相位对**所有** kit 生效。
// 否则切到「私有 kit」之后，共享 kit 的墙面染色会停在上一栋楼的随机值上。
const KITS = [];

/**
 * 建一套分桶累加器。
 * @param {string[]} extra 额外桶（如 'paving'）
 * @param {{wallAlias?:string, wallUv?:[number,number]}} opts
 *   wallAlias：照片立面模式——所有墙面桶指向同一个私有桶（整栋楼只有一张实拍贴图）；
 *   wallUv   ：该照片的分格 [开间米 × 每格开间数, 层高米 × 每格层数]，强制覆盖调用方的 uvM。
 */
export function makeKit(extra = [], opts = {}) {
  const K = {};
  for (const id of BUCKETS) K[id] = new GeoBuilder(id);
  for (const id of extra) K[id] = new GeoBuilder(id);
  if (opts.wallAlias) {
    const wb = new GeoBuilder(opts.wallAlias);
    // 照片立面：UV 按楼体局部坐标投影（层高对齐、窗带连续），关掉六面假 AO
    wb.uvWorld = true;
    wb.forceFlat = true;
    if (opts.wallUv) { wb.forceUv = opts.wallUv; wb.uvM = opts.wallUv; }
    K[opts.wallAlias] = wb;
    for (const id of WALL_IDS) K[id] = wb;
  }
  KITS.push(K);
  CURRENT_KIT = K;
  applyWallStyle();
  return K;
}

export function setFrame(K, x, y, z, ry) {
  for (const k in K) K[k].setFrame(x, y, z, ry);
  return K;
}

// ---------------------------------------------------------------------------
// 基本体量
// ---------------------------------------------------------------------------
export function plinth(K, w, d, o = {}) {
  const ex = o.ex ?? 0.55;
  const y0 = o.y ?? -1.15;
  // 勒脚必须盖住墙身底边（各 style 的 base 在 0.4~1.0 之间），否则墙身底面
  // 离地 0.3~0.5m，整栋楼看起来是浮在草地上的。这里强制顶面 ≥ 1.05m。
  const top = Math.max(o.top ?? 1.05, y0 + (o.h ?? 1.5));
  const h = top - y0;
  K.stone.box(w + ex * 2, h, d + ex * 2, { y: y0, color: o.color ?? C.stone });
  // 上一道稍窄的压顶，形成两级勒脚
  K.stone.box(w + ex, 0.26, d + ex, { y: top - 0.26, color: o.topColor ?? C.stoneDark });
}

// 每栋楼各自的墙体染色 + 立面纹理相位偏移（同一张贴图 → 不同观感）
let _wallTint = 0xffffff;
let _wallUvOff = [0, 0];
let CURRENT_KIT = null;
const WALL_IDS = ['wClassic', 'wModern', 'wLibrary', 'wDorm', 'wGym'];

function applyWallStyle() {
  for (const K of KITS) {
    for (const id of WALL_IDS) {
      const g = K[id];
      if (!g) continue;
      g.tint = _wallTint;
      // 照片立面不吃随机相位：套上随机半格位移，窗带就会和真实层线错开
      if (!g.uvWorld) g.uvOff = _wallUvOff;
    }
  }
}
export function setWallTint(hex) {
  // 兜底：直接 K.wXxx.box(...) 且没显式给色的调用也吃到同一层染色，
  // 否则主墙面被染色、端厅/凸出体还是纯白，接缝一眼可见。
  _wallTint = hex; applyWallStyle();
}
export function setWallPattern(ox, oy) { _wallUvOff = [ox, oy]; applyWallStyle(); }

// ---------------------------------------------------------------------------
// 照片立面模式：几何生成器据此跳过「假窗带 / 假窗间墙」——这些构件存在的
// 唯一目的就是在一张通用窗格贴图上伪造窗，换成实拍贴图后会与照片窗户打架。
// 结构件（壁柱、檐口、基座、雨棚、入口、屋顶）一律保留。
// ---------------------------------------------------------------------------
let _photoMode = false;
export function setPhotoMode(on) { _photoMode = !!on; return _photoMode; }
export function photoMode() { return _photoMode; }

// 墙身（带窗贴图；wall=桶名，uvM=[开间米, 层高米]）
export function body(K, wall, w, h, d, o = {}) {
  K[wall].box(w, h, d, {
    y: o.y ?? 0.4, color: o.color ?? _wallTint,
    uvM: o.uvM ?? [6, 4], uvOff: o.uvOff ?? _wallUvOff,
  });
}

// 水平线脚（檐口 / 层间腰线 / 窗台线）
export function band(K, w, d, y, o = {}) {
  const t = o.t ?? 0.45, ex = o.ex ?? 0.7;
  K.trim.box(w + ex * 2, t, d + ex * 2, { y, color: o.color ?? C.trim });
  if (o.drip !== false) {
    K.trim.box(w + ex * 2 + 0.25, 0.14, d + ex * 2 + 0.25, {
      y: y - 0.16, color: o.dripColor ?? 0xd8d1c0,
    });
  }
}

// 女儿墙（四周一圈 + 压顶）
export function parapet(K, w, d, y, o = {}) {
  const h = o.h ?? 1.05, t = o.t ?? 0.36;
  const W = w + (o.ex ?? 0.5) * 2, D = d + (o.ex ?? 0.5) * 2;
  const col = o.color ?? C.trim, cap = o.capColor ?? 0xd5cdbd;
  K.trim.box(W, h, t, { y, z: D / 2 - t / 2, color: col });
  K.trim.box(W, h, t, { y, z: -D / 2 + t / 2, color: col });
  K.trim.box(t, h, D - t * 2, { y, x: W / 2 - t / 2, color: col });
  K.trim.box(t, h, D - t * 2, { y, x: -W / 2 + t / 2, color: col });
  // 压顶（略外挑）
  K.trim.box(W + 0.16, 0.16, t + 0.16, { y: y + h, z: D / 2 - t / 2, color: cap });
  K.trim.box(W + 0.16, 0.16, t + 0.16, { y: y + h, z: -D / 2 + t / 2, color: cap });
  K.trim.box(t + 0.16, 0.16, D - t * 2, { y: y + h, x: W / 2 - t / 2, color: cap });
  K.trim.box(t + 0.16, 0.16, D - t * 2, { y: y + h, x: -W / 2 + t / 2, color: cap });
}

// 平屋顶屋面板 + 泛水
export function roofDeck(K, w, d, y, o = {}) {
  K.flat.box(w + 0.5, 0.4, d + 0.5, { y: y - 0.2, color: o.color ?? C.roofDeck });
}

// 入口：玻璃门厅 + 雨棚 + 柱 + 台阶 + 无障碍坡道
export function entrance(K, w, d, o = {}) {
  const name = o.name;
  const cw = Math.min(w * 0.42, o.cw ?? 13);
  const dep = o.dep ?? 3.4;
  const zf = d / 2;
  const glassH = o.glassH ?? 3.9;
  // 门厅玻璃（内凹一点，深色）
  K.glass.box(cw * 0.94, glassH, 0.5, { y: 0.9, z: zf - 0.28, color: o.glassColor ?? 0x6f8593 });
  // 竖梃
  const nm = Math.max(2, Math.round(cw / 2.4));
  for (let i = 0; i <= nm; i++) {
    K.metal.box(0.16, glassH, 0.2, { y: 0.9, x: -cw * 0.47 + (cw * 0.94 * i) / nm, z: zf - 0.06, color: C.metalDark });
  }
  // 雨棚（挑出）
  K.trim.box(cw + 1.6, 0.55, dep, { y: 4.5, z: zf + dep / 2 - 0.4, color: o.canopy ?? C.trim });
  K.trim.box(cw + 1.9, 0.18, dep + 0.25, { y: 4.32, z: zf + dep / 2 - 0.4, color: 0xd9d2c2 });
  // 两根圆柱
  const colX = cw / 2 + 0.45;
  for (const s of [-1, 1]) {
    K.trim.cyl(0.36, 0.4, 4.4, 8, { x: s * colX, y: 0.1, z: zf + dep - 1.0, color: o.colColor ?? C.trim });
    K.trim.box(0.95, 0.28, 0.95, { x: s * colX, y: 0, z: zf + dep - 1.0, color: C.stone });
  }
  // 台阶（3 级）
  const steps = o.steps ?? 3;
  for (let i = 0; i < steps; i++) {
    const sw = cw + 2.6 + i * 1.5;
    const sd = 1.1 + i * 1.35;
    K.stone.box(sw, 0.19, sd, { y: 0.02 + (steps - 1 - i) * 0.19, z: zf + dep + sd / 2 - 0.9, color: i % 2 ? 0xc4bcac : C.stone });
  }
  // 无障碍坡道（一侧）
  K.stone.box(2.6, 0.42, dep + 2.2, { x: cw / 2 + 2.6, y: 0.02, z: zf + dep / 2 - 0.6, color: 0xc6beae });
  K.metal.box(0.12, 0.9, 3.2, { x: cw / 2 + 3.9, y: 0.42, z: zf + dep / 2 - 0.8, color: C.metal });
  // 挂牌
  if (name) signBoard(K, name, Math.min(cw * 0.66, 7.4), 1.0, { y: 5.3, z: zf + 0.06 });
}

// 楼名牌（从图集取 uv）
export function signBoard(K, name, w, h, o = {}) {
  const uv = signUV(name);
  if (!uv) return;
  K.sign.panel(w, h, { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, ry: o.ry ?? 0, uv });
  // 牌背板（薄薄一层，增加厚度感）
  const back = o.back ?? 0.12;
  K.trim.box(w + 0.3, h + 0.24, back, { x: o.x ?? 0, y: (o.y ?? 0) - 0.12, z: (o.z ?? 0) - back - 0.02, color: 0xbfb6a4 });
}

// 屋顶设备：机房 + 水箱 + 通风帽
export function roofEquip(K, w, d, y, o = {}) {
  const s = o.seed ?? 1;
  const mx = (s % 3 - 1) * w * 0.16;
  K.flat.box(Math.min(9, w * 0.22), 2.8, Math.min(7, d * 0.3), { x: mx, y, z: -d * 0.12, color: 0xd6d0c2 });
  K.trim.box(Math.min(9, w * 0.22) + 0.4, 0.18, Math.min(7, d * 0.3) + 0.4, { x: mx, y: y + 2.8, z: -d * 0.12, color: 0xc2bcb0 });
  // 生活水箱（两个）
  for (let i = 0; i < 2; i++) {
    const tx = (i ? 1 : -1) * Math.min(w * 0.3, 7);
    K.metal.box(0.28, 1.2, 0.28, { x: tx, y, z: d * 0.16 + i * 0.9, color: 0x8f959a });
    K.metal.cyl(1.35, 1.35, 2.3, 10, { x: tx, y: y + 1.2, z: d * 0.16 + i * 0.9, color: 0xd6d9dc });
    K.metal.cyl(0.18, 0.18, 0.5, 6, { x: tx, y: y + 3.5, z: d * 0.16 + i * 0.9, color: 0x9aa0a4 });
  }
  // 通风帽
  for (let i = 0; i < 2; i++) {
    K.metal.cyl(0.45, 0.5, 1.0, 6, { x: -w * 0.3 + i * 1.6, y, z: -d * 0.26, color: 0xc6cacd });
  }
}

// 坡瓦屋顶 + 檐口封边
export function hipRoof(K, w, d, y, o = {}) {
  const h = o.h ?? clampH(w, d, 4, 7.2);
  const ov = o.overhang ?? 1.0;
  K.roof.hipRoof(w, d, h, { y, overhang: ov, color: o.color ?? C.roofTile });
  // 檐口白色封檐板
  const W = w + ov * 2, D = d + ov * 2;
  const t = 0.3;
  K.trim.box(W + 0.1, 0.4, t, { y: y - 0.42, z: D / 2 - t / 2, color: C.trim });
  K.trim.box(W + 0.1, 0.4, t, { y: y - 0.42, z: -D / 2 + t / 2, color: C.trim });
  K.trim.box(t, 0.4, D, { y: y - 0.42, x: W / 2 - t / 2, color: C.trim });
  K.trim.box(t, 0.4, D, { y: y - 0.42, x: -W / 2 + t / 2, color: C.trim });
  // 正脊
  K.roof.box(Math.max(0.4, Math.abs(w - d) - 0.8) + 0.6, 0.42, 0.7, { y: y + h - 0.16, color: 0x6d737b });
  return h;
}

function clampH(w, d, lo, hi) {
  const m = Math.min(w, d);
  return Math.max(lo, Math.min(hi, m * 0.19));
}

// 山墙 / 硬山屋顶
export function gableRoof(K, w, d, y, o = {}) {
  const h = o.h ?? clampH(w, d, 3.5, 7);
  K.roof.gableRoof(w, d, h, { y, overhang: o.overhang ?? 0.9, color: o.color ?? C.roofTile, gableColor: o.gableColor ?? 0xe4dcc8 });
  return h;
}

// 竖向遮阳板 / 幕墙竖梃（沿 x 排列）
export function mullions(K, n, x0, x1, y, h, z, o = {}) {
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    K.metal.box(o.w ?? 0.18, h, o.d ?? 0.35, { x, y, z, color: o.color ?? C.metalDark });
  }
}

// 栏杆（水平扶手 + 立柱）
export function railing(K, len, x, y, z, o = {}) {
  const ry = o.ry ?? 0;
  K.metal.box(len, 0.09, 0.09, { x, y: y + 0.95, z, color: o.color ?? C.metal, ry });
  K.metal.box(len, 0.07, 0.07, { x, y: y + 0.48, z, color: o.color ?? C.metal, ry });
  const n = Math.max(2, Math.round(len / 2.2));
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (len * i) / n;
    K.metal.box(0.07, 0.95, 0.07, { x: x + Math.cos(ry) * t, y, z: z - Math.sin(ry) * t, color: o.color ?? C.metal });
  }
}

// 屋面楼梯间出屋面小间
export function stairHead(K, x, z, y, o = {}) {
  K.flat.box(4.2, 3.0, 4.6, { x, y, z, color: 0xcdc7bb });
  K.trim.box(4.7, 0.2, 5.1, { x, y: y + 3.0, z, color: 0xb5afa3 });
  K.metal.box(1.1, 2.1, 0.12, { x, y, z: z + 2.34, color: C.metalDark });
}
