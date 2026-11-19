// 照片校核轮：中原楼（real-photos 01/02/03）+ 逸夫图书馆（04/05）
// 按 work/real-photos/analysis.md 重做特征形体；金字/招牌用透明底 textTexture 独立 plane。
// 其余楼仍走 STYLE_FN；由 buildings.js 按楼名特判调用，并传楼 frame。
import * as THREE from 'three';
import { textTexture } from '../../core/textures.js';
import { C, setFrame as setKitFrame, photoMode } from './parts.js';

// ---- 金字 / 招牌 plane 队列（局部系 → flush 时已是世界坐标）----
const _planes = [];
function queuePlane(text, opts, lx, ly, lz, lry, w, h, f) {
  const c = Math.cos(f.ry), s = Math.sin(f.ry);
  _planes.push({
    x: f.x + c * lx + s * lz, y: f.y + ly, z: f.z - s * lx + c * lz,
    ry: f.ry + lry, w, h, text, opts,
  });
}

export function takePlanes() { return _planes.splice(0, _planes.length); }

export function flushPlanes(scene) {
  for (const p of takePlanes()) {
    const tex = textTexture(p.text, p.opts);
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.06,
      roughness: 0.55, metalness: 0.12, side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.ry;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = 'plane-' + p.text;
    scene.add(mesh);
  }
}

const GOLD = { bg: null, fg: '#e2b64e', border: false, font: 'bold 96px "Noto Sans SC","Microsoft YaHei",sans-serif' };

// ---------------------------------------------------------------------------
// 中原楼：浅弧形平面（凹面朝前广场）+ 中央椭圆玻璃鼓白鳍冠 + 东翼 8 层方角塔
// + 通高白竖鳍蓝灰玻璃带 + 30m 大台阶双折雨棚 + 塔楼首层中国银行红招牌
// 参考 01_正面 / 02_侧面 / 03_正面2
// ---------------------------------------------------------------------------
export function buildZhongyuan(K, b, st, f) {
  const fx = f.x, fy = f.y, fz = f.z, fry = f.ry;
  const c0 = Math.cos(fry), s0 = Math.sin(fry);
  // 段系 → 楼局部 合成
  const segFrame = (sx, sz, sry) => {
    setKitFrame(K, fx + c0 * sx + s0 * sz, fy, fz - s0 * sx + c0 * sz, fry + sry);
  };
  const plainFrame = (lx, lz, lry) => {
    setKitFrame(K, fx + c0 * lx + s0 * lz, fy, fz - s0 * lx + c0 * lz, fry + lry);
  };

  const TOP = 23, BASE_H = 7.4; // 基座柱廊高 + 主体（0~23 贯穿，外皮分层）
  // ---- 弧形主体：7 段折面，凹面朝 +z（前广场）----
  const L = b.w, SAG = 9, SEG = 7;
  const R = (L * L / 4 + SAG * SAG) / (2 * SAG);
  const half = Math.asin(L / 2 / R);
  for (let i = 0; i < SEG; i++) {
    const th = -half + (2 * half * i) / (SEG - 1);
    segFrame(R * Math.sin(th), R * (1 - Math.cos(th)), -th);
    const sw = 17.4; // 段宽（含重叠盖缝）
    // 主体贯穿地面（带窗纹理），首层用石皮+柱廊表达
    K.wModern.box(sw - 0.5, TOP, 52, { y: 0, uvM: [5.6, 3.9] });
    // 首层石皮（四面贴边，不实心，保住窗墙进深）
    K.stone.box(sw, BASE_H, 1.0, { y: 0, z: 26.2, color: 0xdcd4bf });
    K.stone.box(sw, BASE_H, 1.0, { y: 0, z: -26.2, color: 0xcfc7b2 });
    K.stone.box(1.0, BASE_H, 53, { y: 0, x: sw / 2 - 0.5, color: 0xd4ccba });
    K.stone.box(1.0, BASE_H, 53, { y: 0, x: -sw / 2 + 0.5, color: 0xd4ccba });
    K.trim.box(sw + 0.3, 0.2, 53.2, { y: 3.55, color: 0xb9af9a });
    // 蓝灰玻璃带 ×4 + 白横带 ×5
    // 实拍立面接入后，窗户由照片提供；这些「假窗带」会和照片窗户打架，故跳过。
    if (!photoMode()) {
      for (let fl = 0; fl < 4; fl++) {
        K.glass.box(sw - 2.6, 2.3, 0.8, { y: BASE_H + 0.82 + fl * 3.9, z: 26.2, color: 0x7e98a3 });
        K.trim.box(sw - 0.4, 1.06, 0.95, { y: BASE_H + fl * 3.9 + 0.05, z: 26.35, color: 0xe4ddcb });
      }
      K.trim.box(sw - 0.4, 1.06, 0.95, { y: TOP - 1.1, z: 26.35, color: 0xe4ddcb });
    }
    // 通高白色竖鳍 ×4（出挑 0.45）
    // 位置必须落在「开间分界线」上：一段 17.4m = 3 开间 × 5.8m → 分界在 ±2.9 / ±8.7。
    // 瓦片横向 u 以段中心为 0、一张 = 17.4m，所以瓦片自身的窗间墙正好落在 ±2.9 / ±8.7，
    // 原来的 -4.8/0/+4.8 会压在窗户中间，看起来「竖鳍错位」。
    for (const px of [-8.7, -2.9, 2.9, 8.7]) {
      K.trim.box(1.2, TOP - BASE_H, 1.25, { x: px, y: BASE_H, z: 26.55, color: 0xe8e1cf });
    }
    // 首层柱廊柱 ×2
    for (const px of [-6.2, 6.2]) {
      K.trim.cyl(0.5, 0.6, BASE_H, 8, { x: px, y: 0, z: 27.3, color: 0xded6c2 });
    }
    // 顶檐 + 屋面板 + 前沿女儿墙
    K.trim.box(sw + 0.7, 0.6, 53.4, { y: TOP - 0.6, color: 0xe0d9c6 });
    K.flat.box(sw, 0.4, 53, { y: TOP - 0.2, color: C.roofDeck });
    K.trim.box(sw, 0.9, 0.4, { y: TOP, z: 26.4, color: 0xdcd4c1 });
  }
  plainFrame(0, 0, 0);

  // ---- 中央椭圆玻璃鼓 + 白色放射鳍片冠 + 浅盘顶（中央段顶部）----
  {
    const dy = TOP;
    K.trim.cyl(9.4, 9.9, 0.9, 12, { y: dy, color: 0xe4ddca });
    K.glass.cyl(8.0, 9.2, 2.5, 12, { y: dy + 0.9, color: 0x6f98a8 });
    K.glass.cyl(6.2, 8.0, 2.3, 12, { y: dy + 3.4, color: 0x7ba3b2 });
    K.glass.cyl(3.4, 6.2, 1.9, 12, { y: dy + 5.7, color: 0x86acbb });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      K.trim.box(0.42, 8.6, 0.42, { x: Math.cos(a) * 9.55, y: dy + 0.4, z: Math.sin(a) * 9.55, ry: a, color: 0xeae3d1 });
    }
    K.trim.cyl(10.15, 10.15, 0.55, 12, { y: dy + 8.0, color: 0xe8e1cf });
    K.trim.cyl(10.3, 9.0, 0.75, 12, { y: dy + 8.55, color: 0xdcd5c2 });
  }
  // 金色「中原楼」三字（玻璃鼓正下方立面）
  queuePlane('中原楼', GOLD, 0, TOP - 3.4, 26.95, 0, 6.4, 1.75, f);

  // ---- 东翼 8 层方角塔（深青绿玻璃百叶 + 白石材转角框，顶层退台）----
  {
    const tx = 54, tz = 5;
    K.wModern.box(20, 28.5, 17, { x: tx, y: 2, z: tz, uvM: [5.6, 3.9] });
    // 转角白框 ×4
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      K.trim.box(1.15, 30.5, 1.15, { x: tx + sx * 9.6, y: 0, z: tz + sz * 7.9, color: 0xe6dfd0 });
    }
    // 正面深青绿百叶玻璃 + 白竖框 + 横百叶
    K.glass.box(16.6, 26.2, 0.5, { x: tx, y: 3.2, z: tz + 8.4, color: 0x3d5a58 });
    for (const px of [-6.6, 0, 6.6]) {
      K.trim.box(0.72, 26.2, 0.62, { x: tx + px, y: 3.2, z: tz + 8.6, color: 0xe4ddcb });
    }
    for (let fl = 0; fl < 8; fl++) {
      K.metal.box(16.6, 0.16, 0.72, { x: tx, y: 3.6 + fl * 3.35, z: tz + 8.75, color: 0xcfd4d2 });
    }
    // 塔顶盖 + 退台小层
    K.trim.box(21.4, 0.8, 18.4, { x: tx, y: 30.5, z: tz, color: 0xe2dbc9 });
    K.wModern.box(15, 2.7, 12, { x: tx, y: 31.3, z: tz, uvM: [5.6, 3.9] });
    K.trim.box(15.8, 0.6, 12.8, { x: tx, y: 34, z: tz, color: 0xe0d9c6 });
    // 中国银行红招牌（塔楼首层）
    queuePlane('中国银行 BANK OF CHINA', { bg: '#8f1d1d', fg: '#ffffff', border: false, font: 'bold 44px "Noto Sans SC","Microsoft YaHei",sans-serif' },
      tx, 3.1, tz + 8.95, 0, 5.2, 0.9, f);
  }

  // ---- 中央入口：30m 大台阶 + 双折白雨棚 + 玻璃门脸 ----
  {
    K.glass.box(11, 5.6, 0.6, { y: 0.7, z: 26.3, color: 0x54707e });
    K.trim.box(12.2, 0.7, 0.9, { y: 6.4, z: 26.4, color: 0xe4ddcb });
    K.trim.box(12.2, 0.5, 0.9, { y: 0.4, z: 26.4, color: 0xd8d0bc });
    // 双折平板雨棚（后半平、前段略上翘）+ 玻璃封边 + 双柱
    K.trim.box(13.5, 0.45, 4.6, { y: 7.15, z: 27.4, color: 0xe6dfcd });
    K.trim.box(13.5, 0.42, 5.6, { y: 7.75, z: 32.3, color: 0xe6dfcd });
    K.glass.box(13.5, 0.95, 0.16, { y: 7.4, z: 35.15, color: 0x9db8c4 });
    for (const px of [-5.4, 5.4]) {
      K.trim.cyl(0.48, 0.56, 7.15, 8, { x: px, y: 0, z: 32.6, color: 0xd8d0bc });
    }
    // 大台阶（5 级，宽 20）
    for (let i = 0; i < 5; i++) {
      K.stone.box(20 + i * 2.4, 0.3, 2.1 + i * 1.7, {
        y: 0.02 + (4 - i) * 0.3, z: 36.6 + (2.1 + i * 1.7) / 2,
        color: i % 2 ? 0xbdb4a1 : 0xb1a894,
      });
    }
    // 台阶两侧叠草花池
    for (const sx of [-1, 1]) {
      K.stone.box(3.2, 1.5, 9.5, { x: sx * 14, y: 0.02, z: 40.5, color: 0xb3aa96 });
      K.flat.box(2.5, 0.14, 8.6, { x: sx * 14, y: 1.5, z: 40.5, color: 0x6f9c4e });
    }
  }
  plainFrame(0, 0, 0);
}

// ---------------------------------------------------------------------------
// 逸夫图书馆：横带窗+白窗套石材墙（非全幕墙）+ 中央 3 开间通高玻璃中庭
// （4m 圆校徽环标 + 金字）+ 顶层退台玻璃盒 + 漂浮白色格栅棚 + 端部玻璃幕墙角
// + 3 级叠层花坛大台阶。参考 04_正面 / 05_黄昏
// ---------------------------------------------------------------------------
export function buildYifu(K, b, st, f) {
  setKitFrame(K, f.x, f.y, f.z, f.ry);
  const w = b.w, d = b.d, h = b.h; // 96 / 76 / 27
  const BASE = 2.6, U4 = 19.4, TOP4 = BASE + U4; // 主体 4 层顶 = 22
  const F5 = h - TOP4 - 0.8;                     // 顶层高 ~4.2
  const FH = U4 / 4;
  const ad = 8, dz = d / 2 + ad;                 // 中庭前凸

  // 基座 + 主体 4 层（横带窗墙，wLibrary 纹理自带白窗套横带）
  K.stone.box(w + 1.2, BASE, d + 1.2, { y: 0.4, color: 0xd9d0bb });
  K.wLibrary.box(w, U4, d, { y: BASE, uvM: [9, FH * 0.34] });
  // 正背白窗套竖条（避开中央 ±16）
  for (const sz of [-1, 1]) {
    for (const px of [-42.5, -32, -21.3, 21.3, 32, 42.5]) {
      K.trim.box(0.55, U4, 0.6, { x: px, y: BASE, z: sz * (d / 2 + 0.1), color: 0xe4ddca });
    }
  }
  // 顶层：两翼墙带窗 + 中央退台玻璃盒
  K.wLibrary.box(32, F5, d, { x: -32, y: TOP4, uvM: [9, F5 * 0.34] });
  K.wLibrary.box(32, F5, d, { x: 32, y: TOP4, uvM: [9, F5 * 0.34] });
  K.glass.box(30, F5, d - 12, { y: TOP4, z: -6, color: 0x9a948c });
  K.trim.box(31, 0.5, d - 11, { y: TOP4, z: -6, color: 0xe4ddca });
  K.trim.box(30.6, 0.7, d - 11.4, { y: TOP4 + F5 - 0.35, z: -6, color: 0xe0d9c6 });
  // 顶层通长檐口
  K.trim.box(w + 2.2, 0.7, d + 2.2, { y: h - 1.15, color: 0xe4ddcb });

  // ---- 中央 3 开间通高玻璃中庭（前凸）----
  K.glass.box(30, h - BASE - 1.4, ad, { y: BASE, z: dz - ad / 2 - 1.0, color: 0x8e8880 });
  // 中庭两侧深色凹缝（把玻璃体从石墙里「切」出来）
  for (const sx of [-1, 1]) K.flat.box(0.9, h - BASE - 1.2, 1.1, { x: sx * 15.2, y: BASE, z: dz - ad + 1.4, color: 0x2b3a40 });
  for (let i = 0; i <= 9; i++) {
    K.metal.box(0.42, h - BASE - 1.6, 0.42, { x: -13.5 + i * 3.0, y: BASE + 0.1, z: dz - 1.05, color: 0xeae3d2 });
  }
  for (let fl = 1; fl <= 5; fl++) {
    K.trim.box(30.4, 0.42, 0.45, { y: BASE + fl * FH - 0.5, z: dz - 0.95, color: 0xece5d4 });
  }
  K.trim.box(32.6, 1.9, 1.15, { y: h - 2.3, z: dz - 1.0, color: 0xe4ddca });
  K.trim.box(32.2, 1.1, 1.0, { y: BASE - 0.2, z: dz - 1.0, color: 0xe4ddca });
  for (const sx of [-1, 1]) {
    K.trim.box(1.5, h - BASE - 1.2, 1.5, { x: sx * 15.6, y: BASE - 0.2, z: dz - 1.0, color: 0xe4ddca });
  }
  // ---- 圆形校徽环标（中庭玻璃上，r≈2.1）----
  {
    const cy = BASE + 9.2, cr = 2.1, cz = dz - 0.85;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      K.trim.box(1.22, 0.3, 0.14, { x: Math.cos(a) * cr, y: cy + Math.sin(a) * cr, z: cz, ry: a, color: 0xece5d3 });
    }
    K.trim.box(0.2, 3.3, 0.13, { x: -0.55, y: cy, z: cz, color: 0xece5d3 });
    K.trim.box(0.2, 3.3, 0.13, { x: 0.55, y: cy, z: cz, color: 0xece5d3 });
    K.trim.box(1.7, 0.2, 0.13, { y: cy, z: cz, color: 0xece5d3 });
  }
  // 金色「图书馆」三字（中庭玻璃上沿）
  queuePlane('图书馆', GOLD, 0, h - 3.6, dz - 0.55, 0, 5.6, 1.55, f);
  // 中庭入口雨棚 + 门脸
  K.trim.box(26, 0.4, 3.6, { y: 6.4, z: dz + 1.5, color: 0xe0d9c6 });
  for (const sx of [-1, 1]) {
    K.trim.cyl(0.34, 0.4, 6.4, 8, { x: sx * 11.5, y: 0.4, z: dz + 2.8, color: 0xd6cebb });
  }
  K.glass.box(24, 5.0, 0.4, { y: 0.8, z: d / 2 + 0.35, color: 0x50616e });
  K.trim.box(25, 0.6, 0.7, { y: 5.9, z: d / 2 + 0.35, color: 0xe4ddcb });

  // ---- 漂浮白色格栅棚（顶层退台盒上方，南高北低）----
  {
    const sN = -16, sS = 6, yN = 27.9, yS = 29.6; // 棚南北缘
    K.flat.quad(
      [-23, yS, sS], [23, yS, sS], [23, yN, sN], [-23, yN, sN],
      { color: 0xece7da, noShade: true },
    );
    K.trim.box(46.4, 0.32, 0.6, { y: yS - 0.16, z: sS, color: 0xe6dfd0 });
    K.trim.box(46.4, 0.32, 0.6, { y: yN - 0.16, z: sN, color: 0xe6dfd0 });
    // 格栅竖条：前缘 12 根 + 后缘 6 根
    for (let i = 0; i < 12; i++) {
      const px = -20.7 + i * 3.76;
      K.trim.box(0.34, 1.5, 0.34, { x: px, y: yS + 0.1, z: sS - 0.2, color: 0xeae3d2 });
    }
    for (let i = 0; i < 6; i++) {
      const px = -19 + i * 7.6;
      K.trim.box(0.34, 1.2, 0.34, { x: px, y: yN + 0.1, z: sN + 0.2, color: 0xeae3d2 });
    }
    // 细白柱脚：南 5 + 北 4
    for (let i = 0; i < 5; i++) {
      K.trim.box(0.24, 1.75, 0.24, { x: -18 + i * 9, y: 27.55, z: sS - 1.2, color: 0xe6e0d0 });
    }
    for (let i = 0; i < 4; i++) {
      K.trim.box(0.24, 1.1, 0.24, { x: -15 + i * 10, y: 27.0, z: sN + 1.2, color: 0xe6e0d0 });
    }
  }

  // ---- 端部玻璃幕墙角（替代原石楼梯筒）----
  for (const sx of [-1, 1]) {
    K.glass.box(9.5, U4, d - 4, { x: sx * (w / 2 - 5), y: BASE, z: 0, color: 0x968f87 });
    for (const pz of [-1, 0, 1]) {
      K.trim.box(0.5, U4, 0.55, { x: sx * (w / 2 - 5), y: BASE, z: pz * (d / 2 - 5), color: 0xe4ddca });
    }
    K.trim.box(10.3, 0.6, d - 3.4, { x: sx * (w / 2 - 5), y: h - 1.15, z: 0, color: 0xe0d9c6 });
  }

  // ---- 屋面 + 设备 ----
  K.flat.box(w + 0.5, 0.4, d + 0.5, { y: h - 0.9, color: C.roofDeck });
  K.flat.box(30, 0.4, d - 11, { y: TOP4 + F5 - 0.2, z: -6, color: C.roofDeck });
  K.metal.box(4.2, 1.6, 2.6, { x: -36, y: h - 0.5, z: -20, color: 0x8b9298 });
  K.metal.box(3.2, 1.3, 2.2, { x: 30, y: h - 0.5, z: 18, color: 0x8b9298 });

  // ---- 大台阶 + 3 级叠层花坛 ----
  for (let i = 0; i < 4; i++) {
    K.stone.box(28 + i * 2.2, 0.3, 2.1 + i * 1.8, {
      y: 0.02 + (3 - i) * 0.3, z: dz + 1.2 + (2.1 + i * 1.8) / 2,
      color: i % 2 ? 0xbdb4a1 : 0xb1a894,
    });
  }
  for (const sx of [-1, 1]) {
    for (let t = 0; t < 3; t++) {
      const bh = 0.6 + t * 0.5, bw = 5.6 - t * 0.7;
      K.stone.box(bw, bh, 8.6 - t * 1.4, { x: sx * (19.5 - t * 1.1), y: 0.02, z: dz + 4.6 - t * 1.5, color: 0xb3aa96 });
      K.flat.box(bw - 0.7, 0.12, 7.6 - t * 1.4, { x: sx * (19.5 - t * 1.1), y: bh, z: dz + 4.6 - t * 1.5, color: 0x6f9c4e });
    }
  }
}

// ---------------------------------------------------------------------------
// 文泰楼：132m 长板式现代教学楼，6 层横带窗（蓝绿玻璃 + 白窗间墙）
// + 北面中央弧形玻璃凸厅（5 段折面，贯穿全高）+ 通长入口雨棚/台阶 + 金字竖排
// 参考 work/real-photos/sheets/文泰楼.jpg（临水弧形玻璃楼、楼前圆形花坛）
// ---------------------------------------------------------------------------
export function buildWentai(K, b, st, f) {
  setKitFrame(K, f.x, f.y, f.z, f.ry);
  const w = b.w, d = b.d, h = b.h;   // 132 / 56 / 24
  const FH = 3.85, FLOORS = 6;
  const BASE = 3.2, TOP = BASE + FH * FLOORS;  // 26.3 → 与 h 接近
  const halfD = d / 2;

  // 基座（石材）+ 主体墙（window 纹理打底，避免玻璃带之间露出天空）
  K.stone.box(w + 1.6, BASE, d + 1.6, { y: 0.2, color: 0xd6cfc0 });
  K.wModern.box(w, TOP - BASE, d, { y: BASE, color: 0xdfe2e0, uvM: [7.5, FH] });

  // 每层：蓝绿玻璃横带（四面）+ 白色窗间墙 + 窗台线
  // 实拍立面接入后窗户由照片提供，这些假窗带跳过（结构件保留）。
  if (!photoMode()) {
    for (let fl = 0; fl < FLOORS; fl++) {
      const y = BASE + fl * FH;
      for (const sz of [-1, 1]) {
        K.glass.box(w - 2.4, 2.0, 0.6, { y: y + 0.8, z: sz * (halfD + 0.08), color: 0x6b8e9a });
      }
      for (const sx of [-1, 1]) {
        K.glass.box(0.6, 2.0, d - 2.4, { x: sx * (w / 2 + 0.08), y: y + 0.8, color: 0x6b8e9a });
      }
      K.trim.box(w + 0.55, 0.62, d + 0.55, { y: y + FH - 0.62, color: 0xe7e0ce });
      K.trim.box(w + 0.3, 0.22, d + 0.3, { y: y + 0.62, color: 0xdfd8c6 });
    }
  }
  // 通长白色壁柱（南北两面，每 6m 一根，只做立面竖向薄片）
  const nb = Math.round(w / 6);
  for (let i = 0; i <= nb; i++) {
    const px = -w / 2 + (w * i) / nb;
    for (const sz of [-1, 1]) {
      K.trim.box(0.52, TOP - BASE, 0.42, { x: px, y: BASE, z: sz * (halfD + 0.2), color: 0xeee7d6 });
    }
  }
  // 顶檐
  K.trim.box(w + 2.0, 0.85, d + 2.0, { y: TOP - 0.85, color: 0xe9e2d0 });
  K.flat.box(w, 0.35, d, { y: TOP, color: C.roofDeck });

  // ---- 北面中央弧形玻璃凸厅（5 段折面，凸出 5m）----
  const bayW = 40, SAG = 5.2, SEG = 5;
  const R = (bayW * bayW / 4 + SAG * SAG) / (2 * SAG);
  const half = Math.asin(bayW / 2 / R);
  for (let i = 0; i < SEG; i++) {
    const th = -half + (2 * half * i) / (SEG - 1);
    const sx = R * Math.sin(th), sz = -R * (1 - Math.cos(th)); // 向北凸
    const lry = -th;
    const segW = 9.2;
    setKitFrame(K, f.x + Math.cos(f.ry) * sx + Math.sin(f.ry) * sz, f.y,
                f.z - Math.sin(f.ry) * sx + Math.cos(f.ry) * sz, f.ry + lry);
    K.glass.box(segW, TOP - BASE - 0.6, 1.1, { y: BASE, color: 0x5b8494 });
    for (let fl = 0; fl <= FLOORS; fl++) {
      K.trim.box(segW, 0.42, 1.35, { y: BASE + fl * FH - 0.2, color: 0xece5d4 });
    }
    for (const px of [-2.9, 0, 2.9]) {
      K.trim.box(0.32, TOP - BASE - 0.6, 1.3, { x: px, y: BASE, color: 0xe6dfcd });
    }
    K.trim.box(segW, 0.7, 1.5, { y: TOP - 0.7, color: 0xe9e2d0 });
  }
  setKitFrame(K, f.x, f.y, f.z, f.ry);

  // 入口：通长雨棚 + 台阶 + 无障碍坡道
  K.trim.box(46, 0.55, 7.5, { y: 6.1, z: -halfD - 3.4, color: 0xe8e1cf });
  for (let i = 0; i < 6; i++) {
    K.stone.box(46, 0.28, 1.1, { y: 0.05, z: -halfD - 6.6 - i * 1.0, color: 0xd9d2c1 });
  }
  // 金字「文泰楼」（北立面凸厅左侧石墙，竖排）
  queuePlane('文泰楼', { ...GOLD, vertical: true },
    -bayW / 2 - 6, 15.5, -halfD - 0.55, Math.PI, 2.6, 7.6, f);
}
