// 建筑专用程序化贴图（全部 canvas 现场生成，零外部资源）
// 单元尺寸：一格 = 一个开间 × 一个层高，贴图用 RepeatWrapping + 几何 uv 控制
// “每格几米”，所以同一张贴图可以用在不同层高/开间的楼上而不拉伸。
import * as THREE from 'three';
import { makeRng, cssHex, clamp } from '../../core/util.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
function speckle(ctx, w, h, seed, n = 900, alpha = 0.05) {
  const rnd = makeRng(seed);
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rnd.range(alpha * 0.4, alpha)})`;
    const s = rnd.range(1, 5);
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

// ---------------------------------------------------------------------------
// 立面：2×2 格（2 开间 × 2 层），每格 128px
// kind: 'classic' | 'modern' | 'library' | 'dorm' | 'gym'
// ---------------------------------------------------------------------------
const CELL = 128;
const FACADE = new Map();

function glassPane(ctx, x, y, w, h, rnd, lit) {
  if (lit) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#e6dbc0'); g.addColorStop(0.55, '#d6c6a4'); g.addColorStop(1, '#bfae8c');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
    g.addColorStop(0, '#8fa9b8');          // 天光反射
    g.addColorStop(0.42, '#4d6474');
    g.addColorStop(1, '#26323c');
    ctx.fillStyle = g;
  }
  ctx.fillRect(x, y, w, h);
  // 竖向反光
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(x + w * 0.12, y, w * 0.1, h);
}

function facadeCanvas(kind) {
  const W = CELL * 2, H = CELL * 2;
  const c = cv(W, H), ctx = c.getContext('2d');
  const rnd = makeRng(kind.length * 977 + 13);

  // --- 墙体底色 ---
  // 注意：材质贴图是 sRGB + ACESFilmic 色调映射，太阳直射下会整体提亮 ~25%，
  // 所以底色要按“渲染后”反推压暗，否则远景 mip 平均会糊成一片惨白。
  const wallBase = {
    classic: '#bb9569', modern: '#c9bda4', library: '#b0a68e',
    dorm: '#c09a83', gym: '#98a2a0',
  }[kind] || '#a49d8e';
  ctx.fillStyle = wallBase; ctx.fillRect(0, 0, W, H);

  // 石材/砖缝
  ctx.strokeStyle = 'rgba(120,105,86,0.13)';
  ctx.lineWidth = 1;
  const joint = kind === 'classic' ? 15 : 22;
  for (let y = joint; y < H; y += joint) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let y = 0; y < H; y += joint) {
    const off = ((y / joint) | 0) % 2 ? joint * 1.6 : 0;
    for (let x = off; x < W; x += joint * 3.2) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + joint); ctx.stroke();
    }
  }
  speckle(ctx, W, H, 71, 1500, 0.028);

  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const ox = cx * CELL, oy = cy * CELL;
      const lit = rnd() < (kind === 'dorm' ? 0.07 : 0.042);
      if (kind === 'classic' || kind === 'library') {
        // 白色壁柱（贴图自带，省几何）
        ctx.fillStyle = '#efe8da';
        const pw = kind === 'classic' ? 15 : 11;
        ctx.fillRect(ox, oy, pw, CELL);
        ctx.fillStyle = 'rgba(90,78,62,0.18)';
        ctx.fillRect(ox + pw, oy, 3, CELL);
        // 层间线脚
        ctx.fillStyle = '#e6dcc8'; ctx.fillRect(ox, oy + CELL - 14, CELL, 9);
        ctx.fillStyle = 'rgba(90,78,62,0.20)'; ctx.fillRect(ox, oy + CELL - 5, CELL, 5);
        // 拱窗
        const wx = ox + 34, wy = oy + (kind === 'library' ? 22 : 34);
        const ww = CELL - 62, wh = kind === 'library' ? CELL - 52 : CELL - 74;
        const r = ww / 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(wx, wy + wh);
        ctx.lineTo(wx, wy + r);
        ctx.arc(wx + r, wy + r, r, Math.PI, 0);
        ctx.lineTo(wx + ww, wy + wh);
        ctx.closePath();
        ctx.clip();
        glassPane(ctx, wx, wy, ww, wh, rnd, lit);
        if (kind === 'library') {
          // 横挺
          ctx.fillStyle = 'rgba(232,226,212,0.55)';
          ctx.fillRect(wx, wy + wh * 0.52, ww, 3);
        }
        ctx.restore();
        // 窗套
        ctx.strokeStyle = '#f2ece0'; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(wx, wy + wh);
        ctx.lineTo(wx, wy + r);
        ctx.arc(wx + r, wy + r, r, Math.PI, 0);
        ctx.lineTo(wx + ww, wy + wh);
        ctx.stroke();
        // 窗台
        ctx.fillStyle = '#f4eee2'; ctx.fillRect(wx - 8, wy + wh, ww + 16, 6);
        ctx.fillStyle = 'rgba(80,68,54,0.25)'; ctx.fillRect(wx - 8, wy + wh + 6, ww + 16, 3);
      } else if (kind === 'modern') {
        // 米黄石材横条 + 深灰带形窗（窗墙比 ~40%，远看是「暖色墙 + 深色窗带」，不是黑盒子）
        ctx.fillStyle = 'rgba(206,199,186,0.85)'; ctx.fillRect(ox, oy + CELL - 30, CELL, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fillRect(ox, oy + CELL - 16, CELL, 2);
        const wx = ox + 10, wy = oy + 42, ww = CELL - 20, wh = 52;
        ctx.fillStyle = '#4d535a'; ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
        glassPane(ctx, wx, wy, ww, wh, rnd, lit);
        ctx.fillStyle = 'rgba(232,230,224,0.75)';
        for (let m = 1; m < 4; m++) ctx.fillRect(wx + (ww * m) / 4 - 1, wy, 2, wh);
        ctx.fillStyle = 'rgba(244,241,234,0.9)'; ctx.fillRect(wx - 6, wy + wh, ww + 12, 5);
        ctx.fillStyle = 'rgba(60,56,48,0.28)'; ctx.fillRect(wx - 6, wy + wh + 5, ww + 12, 4);
      } else if (kind === 'dorm') {
        // 红砖腰带 + 白窗 + 抹灰
        ctx.fillStyle = '#a9604f'; ctx.fillRect(ox, oy + CELL - 20, CELL, 11);
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(ox, oy + CELL - 22, CELL, 2);
        const wx = ox + 26, wy = oy + 24, ww = CELL - 52, wh = 60;
        ctx.fillStyle = '#f2ece2'; ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
        glassPane(ctx, wx, wy, ww, wh, rnd, lit);
        ctx.fillStyle = 'rgba(244,240,232,0.9)'; ctx.fillRect(wx - 1, wy + wh * 0.48, ww + 2, 3);
        ctx.fillStyle = 'rgba(120,110,98,0.25)'; ctx.fillRect(wx - 6, wy + wh + 5, ww + 12, 3);
        // 空调外机（小灰块）
        if (rnd() < 0.55) {
          ctx.fillStyle = '#b9bcbe';
          ctx.fillRect(ox + CELL - 26, oy + 96, 20, 14);
          ctx.fillStyle = 'rgba(60,64,68,0.45)';
          ctx.fillRect(ox + CELL - 24, oy + 99, 16, 2);
          ctx.fillRect(ox + CELL - 24, oy + 103, 16, 2);
        }
      } else {
        // gym：高侧窗
        const wx = ox + 14, wy = oy + 40, ww = CELL - 28, wh = 44;
        ctx.fillStyle = '#9aa5a3'; ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
        glassPane(ctx, wx, wy, ww, wh, rnd, false);
        ctx.fillStyle = 'rgba(200,206,204,0.7)';
        for (let m = 1; m < 6; m++) ctx.fillRect(wx + (ww * m) / 6 - 1, wy, 2, wh);
      }
    }
  }
  return c;
}

export function facadeTex(kind) {
  if (FACADE.has(kind)) return FACADE.get(kind);
  const t = tex(facadeCanvas(kind));
  FACADE.set(kind, t);
  return t;
}

// ---------------------------------------------------------------------------
// 楼名牌 / 校名牌 图集：所有牌子一张贴图 → 所有牌子 1 个 draw call
// ---------------------------------------------------------------------------
const COLS = 4;
const CW = 256, CH = 68;
let ATLAS = null;
let ATLAS_NAMES = null;
let ATLAS_MAP = new Map();

export function signAtlas(names) {
  if (ATLAS && ATLAS_NAMES && ATLAS_NAMES.length === names.length) return ATLAS;
  ATLAS_NAMES = names.slice();
  ATLAS_MAP = new Map();
  const rows = Math.max(1, Math.ceil(names.length / COLS));
  const c = cv(COLS * CW, rows * CH);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (let i = 0; i < names.length; i++) {
    const col = i % COLS, row = (i / COLS) | 0;
    const x0 = col * CW, y0 = row * CH;
    ATLAS_MAP.set(names[i], i);
    // 牌底
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + CH);
    g.addColorStop(0, '#f7f4ea'); g.addColorStop(1, '#e9e3d3');
    ctx.fillStyle = g;
    ctx.fillRect(x0 + 2, y0 + 2, CW - 4, CH - 4);
    ctx.strokeStyle = '#8b8272'; ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 3.5, y0 + 3.5, CW - 7, CH - 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + 7.5, y0 + 7.5, CW - 15, CH - 15);
    // 文字：中文名居中，字号按字数收
    const name = names[i];
    const chars = [...name];
    const fs = Math.min(44, Math.floor((CW - 34) / Math.max(3.2, chars.length)) * 1.02);
    ctx.fillStyle = '#242424';
    ctx.font = `bold ${fs}px "Microsoft YaHei","Noto Sans SC",serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, x0 + CW / 2, y0 + CH / 2 + 1);
  }
  ATLAS = { tex: tex(c), rows, cols: COLS };
  ATLAS.tex.wrapS = ATLAS.tex.wrapT = THREE.ClampToEdgeWrapping;
  ATLAS.tex.needsUpdate = true;
  return ATLAS;
}

export function signUV(name) {
  const i = ATLAS_MAP.get(name);
  if (i == null || !ATLAS) return null;
  const col = i % COLS, row = (i / COLS) | 0;
  const u0 = (col * CW + 3) / (COLS * CW);
  const u1 = (col * CW + CW - 3) / (COLS * CW);
  const v1 = 1 - (row * CH + 3) / (ATLAS.rows * CH);
  const v0 = 1 - (row * CH + CH - 3) / (ATLAS.rows * CH);
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

// ---------------------------------------------------------------------------
// 钟面
// ---------------------------------------------------------------------------
let CLOCK = null;
export function clockTex() {
  if (CLOCK) return CLOCK;
  const S = 256, c = cv(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#f6f2e6';
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 4, 0, 7); ctx.fill();
  ctx.strokeStyle = '#3a3630'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 8, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#2c2925';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r0 = S / 2 - 26, r1 = S / 2 - 14;
    ctx.lineWidth = i % 3 === 0 ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    ctx.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
    ctx.stroke();
  }
  // 指针 10:10
  ctx.lineCap = 'round'; ctx.strokeStyle = '#22201d';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(S / 2, S / 2);
  ctx.lineTo(S / 2 + Math.cos(-Math.PI * 0.72) * 60, S / 2 + Math.sin(-Math.PI * 0.72) * 60); ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(S / 2, S / 2);
  ctx.lineTo(S / 2 + Math.cos(-Math.PI * 0.06) * 88, S / 2 + Math.sin(-Math.PI * 0.06) * 88); ctx.stroke();
  ctx.fillStyle = '#22201d';
  ctx.beginPath(); ctx.arc(S / 2, S / 2, 8, 0, 7); ctx.fill();
  CLOCK = tex(c);
  CLOCK.wrapS = CLOCK.wrapT = THREE.ClampToEdgeWrapping;
  return CLOCK;
}

// ---------------------------------------------------------------------------
// 国旗（简化五星红旗）
// ---------------------------------------------------------------------------
let FLAG = null;
export function flagTex() {
  if (FLAG) return FLAG;
  const W = 240, H = 160, c = cv(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#c8302a'; ctx.fillRect(0, 0, W, H);
  const star = (x, y, r, rot = 0) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.42;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = '#f5d23c'; ctx.fill();
  };
  star(44, 44, 26);
  const small = [[86, 18], [104, 40], [104, 68], [86, 90]];
  for (const [x, y] of small) star(x, y, 9, -0.4);
  FLAG = tex(c);
  FLAG.wrapS = FLAG.wrapT = THREE.ClampToEdgeWrapping;
  return FLAG;
}

// ---------------------------------------------------------------------------
// 校训石刻字（横排，深色底浅色字，用于贴在被挖出的石面上）
// ---------------------------------------------------------------------------
const STONES = new Map();
export function stoneTextTex(text, o = {}) {
  const key = 'st:' + text + JSON.stringify(o);
  if (STONES.has(key)) return STONES.get(key);
  const {
    w = 512, h = 128, vertical = false,
    fg = '#e8dfc8', bg = null, font = null,
  } = o;
  const c = cv(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  else ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const chars = [...text];
  if (vertical) {
    const fs = Math.min(w * 0.62, (h / chars.length) * 0.74);
    ctx.font = font || `bold ${fs}px "Microsoft YaHei",serif`;
    chars.forEach((ch, i) => ctx.fillText(ch, w / 2, (h / chars.length) * (i + 0.5)));
  } else {
    const fs = Math.min(h * 0.66, (w / Math.max(1, chars.length)) * 0.8);
    ctx.font = font || `bold ${fs}px "Microsoft YaHei","Noto Sans SC",serif`;
    ctx.fillText(text, w / 2, h / 2 + h * 0.03);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  STONES.set(key, t);
  return t;
}

export function cssRgb(hex, a = 1) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}
export { cssHex, clamp };
