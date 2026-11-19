// 各类校园建筑的程序化体量生成器
// 约定：局部坐标，原点 = 建筑占地中心的地面，+z = 正立面（入口）方向
import {
  C, plinth, body, band, parapet, roofDeck, entrance, signBoard,
  roofEquip, hipRoof, gableRoof, mullions, railing, stairHead,
} from './parts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// 通用：确定层数/墙身高/屋顶高
// ---------------------------------------------------------------------------
function massing(b, st, roofRatio = 0.24, roofMin = 3.6, roofMax = 7.8) {
  const base = 0.45;
  const wantRoof = st.roof === 'hip' || st.roof === 'feature';
  const roofH = wantRoof ? clamp(Math.min(b.w, b.d) * roofRatio, roofMin, roofMax) : 0;
  let bodyH = b.h - base - roofH;
  if (bodyH < 8) { bodyH = b.h - base; }
  const floors = Math.max(2, Math.round(bodyH / st.floorH));
  return { base, bodyH, roofH, floors, top: base + bodyH };
}

// 立面分格：贴图 uv 密度
function uvDensity(b, st, floors) {
  const bays = Math.max(3, Math.round(b.w / st.bay));
  const fh = floors > 0 ? b.w / b.w * (b.h / floors) : st.floorH;
  return [b.w / bays, fh];
}

// 长楼端部加一个前凸的端厅，打破“一排长条”的单调
function endPavilions(K, w, d, h, wall, o = {}) {
  const pw = o.pw ?? clamp(w * 0.14, 7, 13);
  const pd = o.pd ?? clamp(d * 0.16, 3.2, 5.2);
  const off = w / 2 - pw / 2;
  for (const s of [-1, 1]) {
    K[wall].box(pw, h * (o.k ?? 0.98), d + pd * 2, { x: s * off, y: 0.45, uvM: [5.4, 3.9] });
    K.trim.box(pw + 0.7, 0.5, d + pd * 2 + 0.7, { x: s * off, y: 0.45 + h * (o.k ?? 0.98) - 0.5, color: C.trim });
  }
}

// ---------------------------------------------------------------------------
// 1) classic：米黄砖石 + 白壁柱 + 坡瓦屋顶（文泓/文治/文清/文湛/文潭/文溯…）
// ---------------------------------------------------------------------------
export function buildClassic(K, b, st) {
  const { base, bodyH, roofH, floors, top } = massing(b, st);
  const w = b.w, d = b.d;
  const uvM = [st.bay, bodyH / floors];

  plinth(K, w, d, { h: 1.5, ex: 0.55 });
  body(K, 'wClassic', w, bodyH, d, { y: base, uvM });
  // 一层石砌基座（比墙身出挑）
  K.stone.box(w + 0.55, 1.35, d + 0.55, { y: base - 0.1, color: 0xc9c0ac });
  K.trim.box(w + 0.75, 0.2, d + 0.75, { y: base + 1.25, color: C.trimWarm });

  // 长楼：端厅 + 中央门厅凸出
  if (w > 66) {
    endPavilions(K, w, d, bodyH, 'wClassic');
    K.wClassic.box(w * 0.2, bodyH * 0.99, d + 2.6, { x: 0, y: base, uvM: [st.bay, uvM[1]] });
    K.trim.box(w * 0.2 + 0.9, 0.6, d + 3.4, { x: 0, y: top - 0.6, color: C.trim });
    // 门厅两侧壁柱 + 檐部，避免中央一块光板
    for (const sx of [-1, 1]) {
      K.trim.box(0.95, bodyH * 0.99, d + 3.0, { x: sx * (w * 0.1 + 0.1), y: base, color: 0xece5d6 });
    }
    K.trim.box(w * 0.2 + 1.6, 0.45, d + 3.6, { x: 0, y: top - 1.0, color: 0xe6dfcf });
  }
  // 层间腰线（每两层一道）
  for (let f = 2; f < floors; f += 2) {
    band(K, w, d, base + f * uvM[1] - 0.22, { t: 0.3, ex: 0.5, color: C.trimWarm, drip: false });
  }
  // 顶部檐口 + 坡瓦屋顶
  if (roofH > 0) {
    band(K, w, d, top - 0.55, { t: 0.75, ex: 0.95, color: C.trim });
    hipRoof(K, w, d, top, { h: roofH, overhang: 1.05, color: C.roofTile });
  } else {
    band(K, w, d, top - 0.6, { t: 0.7, ex: 0.9 });
    roofDeck(K, w, d, top);
    parapet(K, w, d, top, { h: 1.15 });
    roofEquip(K, w, d, top + 1.15, { seed: w | 0 });
  }
  entrance(K, w, d, { name: b.name, cw: clamp(w * 0.3, 10, 15), dep: 3.2 });
  // 立面竖匾（入口右侧），中式校园常见的楼名立牌
  if (b.note !== 'no-plaque') {
    signBoard(K, b.name, 1.5, 3.4, { x: clamp(w * 0.3, 10, 15) / 2 + 2.6, y: 6.4, z: d / 2 + 0.06 });
  }
  // 屋顶小烟囱/通风
  if (roofH > 0) {
    K.roof.box(1.2, 1.7, 1.2, { x: w * 0.22, y: top + roofH * 0.45, z: d * 0.18, color: 0x8d8377 });
  }
}

// ---------------------------------------------------------------------------
// 2) modern：石材横条 + 玻璃幕墙 + 顶层挑檐（文泰/文澜/文波/文泉/文沛…）
// ---------------------------------------------------------------------------
export function buildModern(K, b, st) {
  const { base, bodyH, floors, top } = massing(b, st, 0);
  const w = b.w, d = b.d;
  const fh = bodyH / floors;
  const uvM = [st.bay, fh];

  plinth(K, w, d, { h: 1.6, ex: 0.7 });
  body(K, 'wModern', w, bodyH, d, { y: base, uvM });

  // ---- 基座裙房（前凸，2 层高，形成一个有体量的主入口基座）----
  const big = w > 55;
  const pw = clamp(w * 0.34, 22, 40);
  const pH = Math.min(8.4, fh * 2 + 0.6);
  const pdep = 9.5;
  const pz = d / 2 + pdep / 2 - 0.2;
  if (big) {
    K.wModern.box(pw, pH, pdep, { y: base, z: pz, uvM: [st.bay, fh] });
    // 裙房檐口 + 平台（可上人）
    K.trim.box(pw + 1.4, 0.55, pdep + 1.4, { y: base + pH - 0.55, z: pz, color: C.trimWarm });
    K.trim.box(pw + 0.4, 0.2, pdep + 0.4, { y: base + pH - 0.02, z: pz, color: 0x8e8779 });
    // 平台栏杆（裙房屋顶前缘）
    for (let i = 0; i < Math.round(pw / 2.4); i++) {
      const px = -pw / 2 + 1.2 + i * 2.4;
      K.metal.box(0.14, 1.0, 0.14, { x: px, y: base + pH, z: d / 2 + pdep - 0.7, color: 0x8d979c });
    }
    K.metal.box(pw, 0.12, 0.16, { y: base + pH + 0.95, z: d / 2 + pdep - 0.7, color: 0x8d979c });
    // 门廊：外凸于裙房之外的四柱柱廊（否则柱子会被裙房体量吃掉）
    const pcz = d / 2 + pdep + 1.6;
    for (let i = 0; i < 4; i++) {
      const px = -pw / 2 + 3.4 + i * ((pw - 6.8) / 3);
      K.trim.box(1.35, pH - 0.5, 1.35, { x: px, y: base, z: pcz, color: C.trim });
      K.trim.box(1.7, 0.5, 1.7, { x: px, y: base + 0.1, z: pcz, color: C.trimWarm });
      K.trim.box(1.65, 0.55, 1.65, { x: px, y: base + pH - 1.05, z: pcz, color: C.trim });
    }
    // 柱廊檐部（顶着楼名牌）
    K.trim.box(pw + 3.4, 1.15, 3.8, { y: base + pH - 0.45, z: pcz - 0.1, color: C.trim });
    K.trim.box(pw + 4.0, 0.42, 4.3, { y: base + pH + 0.62, z: pcz - 0.1, color: C.trimWarm });
    // 门廊内的玻璃门厅（退到主体墙面）
    K.glass.box(pw - 9.0, pH - 2.6, 0.8, { y: base + 0.1, z: d / 2 + 0.8, color: 0x86a2b0 });
    mullions(K, Math.max(4, Math.round((pw - 9) / 3.0)), -(pw - 9) / 2, (pw - 9) / 2, base + 0.2, pH - 2.8, d / 2 + 1.3, { color: 0xcfc7b7, w: 0.2, d: 0.2 });
    // 柱廊上的楼名牌（正对校园主路）
    signBoard(K, b.name, 5.6, 1.5, { y: base + pH - 0.3, z: pcz + 1.95 });
    // 大台阶（3 级通宽）
    for (let i = 0; i < 3; i++) {
      K.stone.box(pw + 5.0, 0.24, 1.6 + i * 1.1, {
        y: 0.02 + (2 - i) * 0.24, z: d / 2 + pdep + 3.4 + (1.6 + i * 1.1) / 2,
        color: i % 2 ? 0xb3ab9a : 0xa89f8e,
      });
    }
  } else {
    // 小体量：常规门厅
    entrance(K, w, d, { name: b.name, cw: clamp(w * 0.26, 13, 20), dep: 4.2, glassH: 4.6, canopy: 0xd8d1c2 });
    for (const s of [-1, 1]) {
      K.trim.box(1.6, 5.4, 1.2, { x: s * (clamp(w * 0.26, 13, 20) / 2 + 1.4), y: base, z: d / 2 + 1.4, color: 0xded7c8 });
    }
  }

  // ---- 立面竖壁柱（石材），每 ~11m 一道，压住大片玻璃 ----
  const nb = Math.max(4, Math.round(w / 11));
  for (let i = 0; i <= nb; i++) {
    const x = -w / 2 + (w * i) / nb;
    if (big && Math.abs(x) < pw / 2 + 1) continue;
    K.trim.box(0.9, bodyH - 0.6, 1.0, { x, y: base, z: d / 2 - 0.1, color: 0xd7cfbf });
  }

  // ---- 竖向体量打断：每 ~38m 一个前凸的楼梯/电梯核心筒（4.5m 出挑），
  //      把 100m+ 的长条切成有进退的几段，否则远看就是一块「白板」----
  const nCore = w > 60 ? Math.round(w / 38) : 0;
  for (let i = 0; i < nCore; i++) {
    const cx = -w / 2 + (w * (i + 0.5)) / nCore;
    if (Math.abs(cx) < pw / 2 + 5) continue;
    K.wModern.box(7.5, bodyH + 0.6, 4.5, { x: cx, y: base, z: d / 2 + 1.6, uvM: [st.bay, fh] });
    K.trim.box(8.3, 0.55, 5.3, { x: cx, y: base + bodyH - 0.35, z: d / 2 + 1.6, color: C.trimWarm });
    K.trim.box(7.9, 0.3, 5.0, { x: cx, y: base + bodyH + 0.25, z: d / 2 + 1.6, color: 0xb3ab9b });
    // 核心筒上的窄竖窗
    K.glass.box(2.6, bodyH - 2.2, 0.3, { x: cx, y: base + 1.1, z: d / 2 + 3.9, color: 0x5d7d8e });
    // 核心筒两侧与主体的脱缝（深色阴影缝）
    for (const s of [-1, 1]) {
      K.metal.box(0.3, bodyH, 4.6, { x: cx + s * 3.9, y: base, z: d / 2 + 1.6, color: 0x6d6a60 });
    }
  }
  // 一道通长腰线，压住楼层带的重复
  K.trim.box(w + 0.7, 0.32, d + 0.7, { y: base + fh * 3 - 0.16, color: 0xbdb5a5 });

  // ---- 雨水管（近景细节）----
  for (let i = 1; i < 7; i++) {
    const px = -w / 2 + (w * i) / 7;
    K.metal.box(0.26, bodyH - 1.4, 0.26, { x: px, y: base + 0.9, z: d / 2 + 0.18, color: 0xa4acb0 });
  }

  // 顶层挑檐（出挑 + 阴影缝）
  band(K, w, d, top - 0.6, { t: 0.85, ex: 1.5, color: C.trim, dripColor: 0x9f978a });
  K.trim.box(w + 3.4, 0.35, d + 3.4, { y: top - 1.0, color: 0xa9a294 });
  roofDeck(K, w, d, top);
  parapet(K, w, d, top, { h: 1.25, ex: 0.3, color: 0xd2cbbb });
  roofEquip(K, w, d, top + 1.25, { seed: (w * 3) | 0 });
  stairHead(K, w * 0.22, -d * 0.1, top + 1.25);
  // 屋顶太阳能板阵（平屋顶的教学楼很常见）
  for (let i = 0; i < 5; i++) {
    K.glass.box(3.4, 0.14, 1.9, { x: -w * 0.3 + i * 4.4, y: top + 1.55, z: -d * 0.16, color: 0x2e4a63 });
  }
  // 屋顶层设备百叶
  K.metal.box(6.4, 2.3, 0.32, { x: w * 0.28, y: top - 3.0, z: d / 2 + 0.15, color: 0x767e82 });
  for (let i = 0; i < 5; i++) {
    K.metal.box(6.0, 0.16, 0.55, { x: w * 0.28, y: top - 2.9 + i * 0.44, z: d / 2 + 0.32, color: 0x98a0a4 });
  }
}

// ---------------------------------------------------------------------------
// 3) library：大体量 + 中央玻璃中庭 + 大台阶 + 屋顶构架（逸夫图书馆）
// ---------------------------------------------------------------------------
export function buildLibrary(K, b, st) {
  const w = b.w, d = b.d, h = b.h;
  const base = 1.0;
  const bodyH = h - base - 1.0;
  const floors = Math.max(4, Math.round(bodyH / st.floorH));
  const fh = bodyH / floors;
  const uvM = [st.bay, fh];
  const podH = 6.4;              // 白色石墙裙高度
  const glassTop = h - 2.2;      // 玻璃幕墙顶

  plinth(K, w, d, { h: 2.4, ex: 1.2, color: 0xada492 });
  // ---- 上部玻璃幕墙（四面），内凹 0.35 让石鳍显出来 ----
  // 按层分带 + 每层一个色阶（上浅下深）→ 远看是「反天光的幕墙」，不是一整块蓝板
  const gh = glassTop - base - podH;
  const gf = Math.max(3, floors - 2);
  const GLASS_RAMP = [0xbcd8e6, 0xaccbdd, 0x9bbcce, 0x8baebe, 0x7d9fae, 0x71929f];
  for (let f = 0; f < gf; f++) {
    const bh = gh / gf - 0.34;
    if (bh <= 0.2) continue;
    K.glass.box(w - 0.7, bh, d - 0.7, {
      y: base + podH + (f * gh) / gf + 0.17,
      color: GLASS_RAMP[Math.min(GLASS_RAMP.length - 1, Math.round((f / Math.max(1, gf - 1)) * (GLASS_RAMP.length - 1)))],
    });
  }
  // ---- 白色石墙裙（两层高，带三道水平凹缝）----
  K.stone.box(w + 1.2, podH, d + 1.2, { y: base - 0.3, color: 0xd9d0bb });
  for (let i = 1; i <= 3; i++) {
    K.trim.box(w + 1.16, 0.14, d + 1.16, { y: base - 0.3 + i * (podH / 4), color: 0xb8ae99 });
  }
  K.trim.box(w + 1.9, 0.42, d + 1.9, { y: base + podH - 0.5, color: C.trim });
  // ---- 竖向白色石鳍（正背两面，撑住大玻璃）----
  const nb = Math.max(5, Math.round(w / 10));
  for (let i = 0; i <= nb; i++) {
    const x = -w / 2 + (w * i) / nb;
    if (Math.abs(x) < 17) continue;
    for (const sz of [-1, 1]) {
      K.trim.box(1.05, glassTop - base - podH, 1.5, {
        x, y: base + podH, z: sz * (d / 2 + 0.35), color: 0xe2dac7,
      });
    }
  }
  // ---- 水平楼层白腰带（横贯整面幕墙，是从远处分辨图书馆的关键）----
  for (let f = 1; f < gf; f++) {
    const y = base + podH + (f * gh) / gf;
    K.trim.box(w + 1.1, 0.34, d + 1.1, { y: y - 0.17, color: 0xe0d8c4 });
  }
  // ---- 两端楼梯筒（白色实体塔，出屋面）----
  for (const s of [-1, 1]) {
    K.stone.box(13, h + 1.6, 12, { x: s * (w / 2 - 7.5), y: 0.4, z: -d / 2 + 7, color: 0xd2cab6 });
    K.trim.box(13.8, 0.5, 12.8, { y: h + 1.4, x: s * (w / 2 - 7.5), z: -d / 2 + 7, color: C.trim });
  }
  // ---- 中央玻璃中庭（前凸，通高）----
  const aw = 30, ad = 8;
  K.glass.box(aw, h - 1.2, ad, { y: 1.0, z: d / 2 + ad / 2 - 1.2, color: 0x8aa6b6 });
  mullions(K, 9, -aw / 2 + 0.6, aw / 2 - 0.6, 1.2, h - 2.4, d / 2 + ad - 1.0, { color: 0xdfd9cc, w: 0.22, d: 0.26 });
  for (let f = 1; f <= floors; f++) {
    K.trim.box(aw + 0.3, 0.24, 0.3, { y: 1.2 + f * fh, z: d / 2 + ad - 0.9, color: 0xe4dcc9 });
  }
  // 中庭白色边框
  K.trim.box(aw + 2.6, 2.0, 1.2, { y: h - 2.1, z: d / 2 + ad - 0.6, color: C.trim });
  K.trim.box(aw + 2.2, 1.2, 1.0, { y: 0.7, z: d / 2 + ad - 0.6, color: C.trim });
  for (const s of [-1, 1]) {
    K.trim.box(1.5, h - 1.2, 1.5, { x: s * (aw / 2 + 0.6), y: 0.7, z: d / 2 + ad - 0.6, color: C.trim });
  }
  // 中庭入口雨棚
  K.metal.box(aw - 4, 0.3, 3.2, { y: 5.4, z: d / 2 + ad + 1.4, color: 0xd0c9ba });
  for (const s of [-1, 1]) {
    K.metal.cyl(0.16, 0.16, 5.4, 8, { x: s * (aw / 2 - 3.2), y: 0.2, z: d / 2 + ad + 2.6, color: 0x9aa2a6 });
  }
  // ---- 大台阶（5 级，宽 34m）----
  for (let i = 0; i < 5; i++) {
    K.stone.box(34 + i * 2.2, 0.28, 2.0 + i * 1.9, { y: 0.02 + (4 - i) * 0.28, z: d / 2 + ad + (2.0 + i * 1.9) / 2 - 0.4, color: i % 2 ? 0xbfb6a3 : 0xb3aa97 });
  }
  // 台阶两侧花池/挡墙
  for (const s of [-1, 1]) {
    K.stone.box(2.6, 1.6, 11.5, { x: s * 20.5, y: 0.02, z: d / 2 + ad + 4.2, color: 0xb0a795 });
  }
  // 两侧无障碍坡道
  for (const s of [-1, 1]) {
    K.stone.box(4.0, 0.5, 9.6, { x: s * 26, y: 0.02, z: d / 2 + ad + 3.4, color: 0xb6ad9b });
    railing(K, 9.6, s * 26 - s * 2.1, 0.5, d / 2 + ad + 3.4, { ry: Math.PI / 2 });
  }
  // 雨水管
  for (let i = 1; i < 9; i++) {
    const px = -w / 2 + (w * i) / 9;
    if (Math.abs(px) < 17) continue;
    K.metal.box(0.26, h - podH - 1.6, 0.26, { x: px, y: podH + 0.6, z: d / 2 + 0.42, color: 0xa4acb0 });
  }
  // ---- 屋顶：女儿墙 + 采光顶 + 门式构架 ----
  roofDeck(K, w, d, h - 0.4);
  parapet(K, w, d, h - 0.5, { h: 1.5, ex: 0.5, color: 0xd8d0bd });
  const fy = h + 1.0;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      K.trim.box(1.5, 5.2, 1.5, { x: s * 13, y: fy, z: t * 9, color: 0xe0d8c6 });
    }
    K.trim.box(31, 1.4, 2.4, { x: 0, y: fy + 5.2, z: s * 9, color: C.trim });
  }
  for (let i = -2; i <= 2; i++) {
    K.trim.box(1.1, 0.9, 19.5, { x: i * 6.4, y: fy + 5.0, z: 0, color: 0xcfc7b6 });
  }
  K.glass.box(aw - 1, 1.1, ad - 1, { y: h - 1.3, z: d / 2 + ad / 2 - 1.2, color: 0x9fbcc8 });
  roofEquip(K, w * 0.72, d * 0.66, h + 1.0, { seed: 7 });
  // ---- 幕墙竖向细梃（补齐 3m 级分格，否则整面玻璃只有横线）----
  for (let i = 0; i <= Math.round(w / 3.2); i++) {
    const px = -w / 2 + (i * w) / Math.round(w / 3.2);
    if (Math.abs(px) < 17) continue;
    for (const sz of [-1, 1]) {
      K.trim.box(0.2, gh, 0.34, { x: px, y: base + podH, z: sz * (d / 2 + 0.02), color: 0xc9c2b1 });
    }
  }
  // ---- 顶部白色檐口（压住幕墙，挡住屋面薄边）----
  K.trim.box(w + 2.6, 1.0, d + 2.6, { y: glassTop - 0.1, color: 0xe2dbc9 });
  K.trim.box(w + 3.1, 0.34, d + 3.1, { y: glassTop + 0.9, color: 0xd0c9b8 });
  // ---- 中庭主入口：通高玻璃门厅 + 门套 + 门楣（不用通用 entrance，避免被中庭体量吃掉）----
  const dz = d / 2 + ad - 0.05;
  K.glass.box(aw - 7.0, 4.6, 0.36, { y: 1.0, z: dz, color: 0x33495a });
  for (let i = 0; i <= 6; i++) {
    K.trim.box(0.22, 4.6, 0.5, { x: -aw / 2 + 3.5 + (i * (aw - 7)) / 6, y: 1.0, z: dz + 0.1, color: 0xe4ddcd });
  }
  K.trim.box(aw - 6.4, 0.5, 0.62, { y: 5.6, z: dz + 0.1, color: C.trim });
  for (const s of [-1, 1]) {
    K.trim.box(0.9, 5.2, 0.62, { x: s * (aw / 2 - 3.2), y: 1.0, z: dz + 0.1, color: C.trim });
  }
  signBoard(K, b.name, 6.0, 1.6, { y: h - 3.4, z: d / 2 + ad + 0.05 });
}

// ---------------------------------------------------------------------------
// 4) dorm：重复单元 + 阳台 + 空调板 + 红白配色
// ---------------------------------------------------------------------------
export function buildDorm(K, x, z, o = {}) {
  const w = o.w ?? 30, d = o.d ?? 14;
  const floors = o.floors ?? 6;
  const fh = 3.2;
  const base = 0.5;
  const bodyH = floors * fh;
  const top = base + bodyH;
  plinth(K, w, d, { h: 1.1, ex: 0.4 });
  body(K, 'wDorm', w, bodyH, d, { y: base, uvM: [3.8, fh] });
  // 一层门厅（深色）+ 单元入口
  K.glass.box(w * 0.28, 2.8, 0.4, { y: base + 0.2, z: d / 2 - 0.15, color: 0x53636c });
  // 阳台：每层一道通长挑板 + 栏板
  for (let f = 0; f < floors; f++) {
    const y = base + f * fh + 0.06;
    K.trim.box(w * 0.9, 0.16, 1.45, { y: y, z: d / 2 + 0.72, color: 0xf0eae0 });
    K.trim.box(w * 0.9, 0.96, 0.12, { y: y + 0.16, z: d / 2 + 1.4, color: 0xf6f1e8 });
    // 空调板（隔一层一个）
    if (f % 2 === 0) {
      K.flat.box(2.2, 0.5, 1.0, { x: (f % 4 === 0 ? -1 : 1) * w * 0.24, y: y + 0.1, z: d / 2 + 0.55, color: 0xdad4c8 });
    }
  }
  // 楼梯间出屋面
  stairHead(K, -w * 0.28, -d * 0.1, top + 0.3);
  // 平屋顶 + 女儿墙
  roofDeck(K, w, d, top + 0.3);
  parapet(K, w, d, top + 0.3, { h: 1.0, ex: 0.35, color: 0xeee8dd });
  // 屋顶水箱
  K.metal.cyl(1.2, 1.2, 2.0, 10, { x: w * 0.2, y: top + 0.6, z: d * 0.1, color: 0xc6cacd });
  // 入口雨棚
  K.trim.box(4.6, 0.35, 2.4, { y: base + 2.9, z: d / 2 + 1.2, color: 0xeee8de });
  for (const s of [-1, 1]) K.metal.box(0.16, 2.9, 0.16, { x: s * 1.7, y: 0.1, z: d / 2 + 2.2, color: C.metal });
  if (o.name) signBoard(K, o.name, 3.0, 0.72, { y: base + 3.5, z: d / 2 + 0.06 });
}

// ---------------------------------------------------------------------------
// 5) gym：大跨钢拱 / 网壳屋顶
// ---------------------------------------------------------------------------
export function buildGym(K, b, st) {
  const w = b.w, d = b.d, h = b.h;
  const wallH = clamp(h * 0.34, 6.2, 8.5);
  plinth(K, w, d, { h: 1.2, ex: 0.8 });
  // 下部墙体（含高侧窗）
  body(K, 'wGym', w, wallH, d, { y: 0.45, uvM: [8, wallH] });
  K.stone.box(w + 0.6, 2.6, d + 0.6, { y: 0.3, color: 0xc6c2b8 });
  band(K, w, d, wallH - 0.5, { t: 0.45, ex: 0.8, color: C.trim });
  // 拱屋顶
  const rise = h - wallH;
  K.roof.vault(w + 1.6, d + 1.6, rise, 10, { y: wallH, color: 0x9ba6a6, endColor: 0xbcc2bf });
  // 拱脚处的白色压边
  for (const s of [-1, 1]) {
    K.trim.box(w + 2.0, 0.5, 0.7, { y: wallH - 0.2, z: s * (d / 2 + 0.75), color: C.trim });
  }
  // 沿拱的钢肋（顺拱形排布，不要飘在拱面之上）
  const nrib = 6;
  for (let i = 0; i <= nrib; i++) {
    const x = -w / 2 + (w * i) / nrib;
    K.metal.box(0.34, 0.7, d + 2.0, { x, y: wallH + rise * 0.72, color: C.metalDark });
  }
  // 纵横两个方向的钢架（脊线 + 两端山墙拱肋的暗示）
  K.metal.box(w + 1.2, 0.5, 0.7, { y: wallH + rise - 0.3, color: C.metalDark });
  // 入口
  entrance(K, w, d, { name: b.name, cw: clamp(w * 0.24, 10, 16), dep: 4.0, glassH: 4.2 });
  // 入口上方的拱形雨棚
  K.roof.box(clamp(w * 0.3, 13, 20), 0.6, 5.0, { y: 6.4, z: d / 2 + 1.8, color: 0x8f9c9a });
  signBoard(K, b.name, 8.0, 1.2, { y: 7.2, z: d / 2 + 0.06 });
  // 侧向疏散门
  for (const s of [-1, 1]) {
    K.glass.box(0.4, 2.6, 3.0, { x: s * (w / 2 + 0.05), y: 0.4, color: 0x5b6b74 });
  }
}

// ---------------------------------------------------------------------------
// 6) hall：对称柱廊 + 坡顶（南湖会堂）
// ---------------------------------------------------------------------------
export function buildHall(K, b, st) {
  const w = b.w, d = b.d, h = b.h;
  const base = 0.6;
  const roofH = clamp(Math.min(w, d) * 0.2, 4.0, 6.4);
  const bodyH = h - base - roofH;
  const floors = Math.max(2, Math.round(bodyH / st.floorH));
  const uvM = [st.bay, bodyH / floors];
  plinth(K, w, d, { h: 1.7, ex: 0.9 });
  body(K, 'wClassic', w, bodyH, d, { y: base, uvM });
  K.stone.box(w + 0.6, 3.0, d + 0.6, { y: base - 0.2, color: 0xc7beab });
  // 通高柱廊（前）
  const cw = w * 0.58;
  const ncol = 6;
  K.trim.box(cw + 3.0, 1.0, 1.2, { y: bodyH + base - 1.3, z: d / 2 + 4.2, color: C.trim }); // 檐部
  for (let i = 0; i < ncol; i++) {
    const x = -cw / 2 + (cw * i) / (ncol - 1);
    K.trim.cyl(0.52, 0.6, bodyH - 1.6, 10, { x, y: base + 1.4, z: d / 2 + 4.2, color: 0xf4efe3 });
    K.trim.box(1.5, 0.4, 1.5, { x, y: base + 1.0, z: d / 2 + 4.2, color: C.stone });
    K.trim.box(1.4, 0.4, 1.4, { x, y: base + bodyH - 0.5, z: d / 2 + 4.2, color: C.trim });
  }
  // 柱廊后墙（玻璃门厅）
  K.glass.box(cw + 2.0, bodyH - 2.2, 0.6, { y: base + 1.0, z: d / 2 - 0.1, color: 0x62757e });
  K.trim.box(cw + 2.6, 1.2, 1.4, { y: base + bodyH - 1.6, z: d / 2 - 0.2, color: C.trim });
  // 大台阶
  for (let i = 0; i < 4; i++) {
    K.stone.box(cw + 6 + i * 1.6, 0.24, 1.6 + i * 1.5, { y: 0.02 + (3 - i) * 0.24, z: d / 2 + 4.2 + (1.6 + i * 1.5) / 2 - 1.2, color: i % 2 ? 0xc6bdac : 0xbcb3a2 });
  }
  // 屋顶
  band(K, w, d, base + bodyH - 0.5, { t: 0.7, ex: 1.1, color: C.trim });
  hipRoof(K, w, d, base + bodyH, { h: roofH, overhang: 1.3, color: 0x9c6b5a });
  signBoard(K, b.name, 9.0, 1.3, { y: base + bodyH - 2.2, z: d / 2 + 4.9 });
}

// ---------------------------------------------------------------------------
// 7) museum：石基座 + 柱廊 + 圆鼓屋顶
// ---------------------------------------------------------------------------
export function buildMuseum(K, b, st) {
  const w = b.w, d = b.d, h = b.h;
  const base = 0.6;
  const bodyH = h - base - 2.4;
  const floors = Math.max(2, Math.round(bodyH / st.floorH));
  const uvM = [st.bay, bodyH / floors];
  plinth(K, w, d, { h: 1.6, ex: 0.9 });
  body(K, 'wClassic', w, bodyH, d, { y: base, uvM });
  K.stone.box(w + 0.4, 2.4, d + 0.4, { y: base - 0.15, color: 0xc9bfaa });
  // 柱廊
  const ncol = Math.max(4, Math.round(w / 6));
  for (let i = 0; i < ncol; i++) {
    const x = -w * 0.42 + (w * 0.84 * i) / (ncol - 1);
    K.trim.cyl(0.42, 0.48, bodyH - 1.0, 8, { x, y: base + 1.8, z: d / 2 + 1.6, color: 0xf1ebdf });
  }
  K.trim.box(w * 0.9 + 1.6, 1.1, 2.6, { y: base + bodyH - 0.2, z: d / 2 + 1.5, color: C.trim });
  K.trim.box(w * 0.9 + 2.4, 0.5, 3.2, { y: base + bodyH + 0.9, z: d / 2 + 1.5, color: 0xd8d0be });
  // 屋顶圆鼓 + 浅穹顶
  const r = Math.min(w, d) * 0.28;
  K.trim.cyl(r, r, 2.6, 14, { y: h - 2.6, color: 0xe9e2d2 });
  K.trim.cyl(r + 0.5, r + 0.5, 0.5, 14, { y: h, color: 0xd9d1bf });
  K.roof.cyl(0.4, r + 0.4, 2.6, 14, { y: h + 0.5, color: C.roofRed });
  // 台阶
  for (let i = 0; i < 3; i++) {
    K.stone.box(w * 0.9 + 4 + i * 2, 0.22, 1.4 + i * 1.4, { y: 0.02 + (2 - i) * 0.22, z: d / 2 + 1.6 + (1.4 + i * 1.4) / 2, color: i % 2 ? 0xc4bbaa : 0xb9b09f });
  }
  signBoard(K, b.name, Math.min(w * 0.8, 12), 1.1, { y: base + bodyH - 2.0, z: d / 2 + 1.95 });
}

// ---------------------------------------------------------------------------
// 8) canteen：大玻璃底层 + 大挑檐 + 厨房体块
// ---------------------------------------------------------------------------
export function buildCanteen(K, b, st) {
  const w = b.w, d = b.d, h = b.h;
  const base = 0.5;
  const bodyH = h - base - 0.9;
  const floors = Math.max(2, Math.round(bodyH / st.floorH));
  const uvM = [st.bay, bodyH / floors];
  plinth(K, w, d, { h: 1.1, ex: 0.5 });
  body(K, 'wModern', w, bodyH, d, { y: base, uvM });
  // 一层通透玻璃（食堂特征）
  K.glass.box(w * 0.8, 3.5, 0.6, { y: base + 0.3, z: d / 2 + 0.05, color: 0x6e8792 });
  mullions(K, Math.round(w / 3.4), -w * 0.4, w * 0.4, base + 0.3, 3.5, d / 2 + 0.3, { w: 0.18, d: 0.2, color: 0xd6d2c8 });
  // 大挑檐
  band(K, w, d, h - 1.0, { t: 0.65, ex: 1.8, color: 0xece6d9 });
  roofDeck(K, w, d, h - 0.4);
  parapet(K, w, d, h - 0.4, { h: 0.95, ex: 0.3 });
  // 厨房排烟 + 设备
  K.flat.box(6, 3.2, 5, { x: -w * 0.3, y: h - 0.4, z: -d * 0.25, color: 0xc9c3b7 });
  for (let i = 0; i < 3; i++) {
    K.metal.cyl(0.7, 0.7, 2.4, 8, { x: -w * 0.3 - 2 + i * 2, y: h + 2.8, z: -d * 0.25, color: 0xb4b8bb });
  }
  entrance(K, w, d, { name: b.name, cw: clamp(w * 0.34, 11, 17), dep: 3.6 });
}

// ---------------------------------------------------------------------------
// 9) market：小体量 + 室外摊位雨棚
// ---------------------------------------------------------------------------
export function buildMarket(K, b, st) {
  const w = b.w, d = b.d, h = b.h;
  const base = 0.4;
  const bodyH = h - base - 0.8;
  const floors = Math.max(1, Math.round(bodyH / st.floorH));
  const uvM = [st.bay, bodyH / floors];
  plinth(K, w, d, { h: 0.9, ex: 0.4 });
  body(K, 'wModern', w, bodyH, d, { y: base, uvM });
  K.glass.box(w * 0.86, 2.9, 0.5, { y: base + 0.2, z: d / 2 + 0.02, color: 0x6b808a });
  band(K, w, d, h - 0.8, { t: 0.5, ex: 1.2, color: 0xe8e2d5 });
  roofDeck(K, w, d, h - 0.3);
  parapet(K, w, d, h - 0.3, { h: 0.8, ex: 0.25 });
  // 摊位雨棚（红白条纹用两个色块近似）
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x = -w * 0.36 + (w * 0.72 * i) / (n - 1);
    K.trim.box(3.6, 0.16, 2.2, { x, y: 2.8, z: d / 2 + 1.4, color: i % 2 ? 0xd8735f : 0xf0e9db });
    K.metal.box(0.12, 2.8, 0.12, { x: x - 1.6, y: 0.1, z: d / 2 + 2.2, color: C.metal });
    K.metal.box(0.12, 2.8, 0.12, { x: x + 1.6, y: 0.1, z: d / 2 + 2.2, color: C.metal });
  }
  signBoard(K, b.name, 5.2, 0.9, { y: h - 0.9, z: d / 2 + 0.06 });
}

// ---------------------------------------------------------------------------
// 10) office：方整的办公楼
// ---------------------------------------------------------------------------
export function buildOffice(K, b, st) {
  const { base, bodyH, floors, top } = massing(b, st, 0);
  const w = b.w, d = b.d;
  const uvM = [st.bay, bodyH / floors];
  plinth(K, w, d, { h: 1.1, ex: 0.6 });
  body(K, 'wModern', w, bodyH, d, { y: base, uvM });
  // 竖向石材肋
  const nb = Math.max(4, Math.round(w / 7));
  for (let i = 0; i <= nb; i++) {
    const x = -w / 2 + (w * i) / nb;
    K.trim.box(0.85, bodyH, 0.85, { x, y: base, z: d / 2 - 0.1, color: 0xe7e1d4 });
    K.trim.box(0.85, bodyH, 0.85, { x, y: base, z: -d / 2 + 0.1, color: 0xe7e1d4 });
  }
  band(K, w, d, top - 0.55, { t: 0.7, ex: 1.1, color: C.trim });
  roofDeck(K, w, d, top);
  parapet(K, w, d, top, { h: 1.1, ex: 0.3 });
  roofEquip(K, w, d, top + 1.1, { seed: (w * 7) | 0 });
  entrance(K, w, d, { name: b.name, cw: clamp(w * 0.3, 8, 13), dep: 3.0 });
}

export const STYLE_FN = {
  classic: buildClassic,
  modern: buildModern,
  library: buildLibrary,
  gym: buildGym,
  hall: buildHall,
  museum: buildMuseum,
  canteen: buildCanteen,
  market: buildMarket,
  office: buildOffice,
  dorm: buildDorm,
};
