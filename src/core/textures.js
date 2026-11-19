import * as THREE from 'three';
import { makeRng, fbm, valueNoise, clamp, lerp, cssHex } from './util.js';

// ---------------------------------------------------------------------------
// 程序化贴图（全部由 canvas 现场生成，零外部资源，保证单文件离线可运行）
// ---------------------------------------------------------------------------
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTexture(c, repeat = [1, 1], opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = opts.aniso ?? 4;
  if (opts.colorSpace !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function noiseFill(ctx, w, h, base, amp, seed, scale = 0.08) {
  const img = ctx.createImageData(w, h);
  const { r, g, b } = { r: (base >> 16) & 255, g: (base >> 8) & 255, b: base & 255 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x * scale, y * scale, 4, seed) - 0.5;
      const n2 = valueNoise(x * 0.9, y * 0.9, seed + 7) - 0.5;
      const k = 1 + n * amp + n2 * amp * 0.45;
      const i = (y * w + x) * 4;
      img.data[i] = clamp(r * k, 0, 255);
      img.data[i + 1] = clamp(g * k, 0, 255);
      img.data[i + 2] = clamp(b * k, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function asphaltTexture() {
  if (cache.has('asphalt')) return cache.get('asphalt');
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  noiseFill(ctx, w, h, 0x4a4a4c, 0.55, 11, 0.16);
  // 骨料颗粒
  const rnd = makeRng(3);
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * w, y = rnd() * h, s = rnd.range(0.6, 2.2);
    const v = rnd.range(70, 150);
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${rnd.range(0.05, 0.3)})`;
    ctx.fillRect(x, y, s, s);
  }
  // 细裂纹
  ctx.strokeStyle = 'rgba(28,28,30,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    let x = rnd() * w, y = rnd() * h;
    ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += rnd.range(-22, 22); y += rnd.range(-22, 22); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const t = toTexture(c, [1, 1]);
  cache.set('asphalt', t);
  return t;
}

export function pavingTexture() {
  if (cache.has('paving')) return cache.get('paving');
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#8d8579'; ctx.fillRect(0, 0, w, h);
  const rnd = makeRng(17);
  const cell = 64;
  for (let gy = 0; gy < h / cell; gy++) {
    for (let gx = 0; gx < w / cell; gx++) {
      const off = (gy % 2) * cell * 0.5;
      const v = rnd.range(-16, 16);
      ctx.fillStyle = `rgb(${150 + v},${143 + v},${131 + v})`;
      ctx.fillRect(gx * cell + off + 2, gy * cell + 2, cell - 4, cell - 4);
      // 石斑
      ctx.fillStyle = `rgba(255,255,255,${rnd.range(0.02, 0.06)})`;
      ctx.fillRect(gx * cell + off + 4, gy * cell + 4, cell - 8, 6);
    }
  }
  // 缝隙阴影
  ctx.strokeStyle = 'rgba(60,55,48,0.5)'; ctx.lineWidth = 2;
  for (let gy = 0; gy <= h / cell; gy++) {
    ctx.beginPath(); ctx.moveTo(0, gy * cell); ctx.lineTo(w, gy * cell); ctx.stroke();
  }
  const t = toTexture(c, [1, 1]);
  cache.set('paving', t);
  return t;
}

export function concreteTexture() {
  if (cache.has('concrete')) return cache.get('concrete');
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  noiseFill(ctx, w, h, 0xbfb9ad, 0.22, 23, 0.1);
  const rnd = makeRng(5);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * w, y = rnd() * h;
    ctx.fillStyle = `rgba(90,86,78,${rnd.range(0.02, 0.09)})`;
    ctx.beginPath(); ctx.arc(x, y, rnd.range(2, 16), 0, 7); ctx.fill();
  }
  // 分模缝
  ctx.strokeStyle = 'rgba(120,114,104,0.35)'; ctx.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo((i * w) / 4, 0); ctx.lineTo((i * w) / 4, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i * h) / 4); ctx.lineTo(w, (i * h) / 4); ctx.stroke();
  }
  const t = toTexture(c, [1, 1]);
  cache.set('concrete', t);
  return t;
}

export function brickTexture() {
  if (cache.has('brick')) return cache.get('brick');
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#c9bda9'; ctx.fillRect(0, 0, w, h);
  const rnd = makeRng(31);
  const bw = 64, bh = 26;
  for (let row = 0; row * bh < h; row++) {
    const off = (row % 2) * bw * 0.5;
    for (let col = -1; col * bw < w + bw; col++) {
      const x = col * bw + off, y = row * bh;
      const r = rnd.range(150, 185), g = rnd.range(120, 148), b = rnd.range(96, 120);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
  }
  const t = toTexture(c, [1, 1]);
  cache.set('brick', t);
  return t;
}

export function tileRoofTexture() {
  if (cache.has('tileroof')) return cache.get('tileroof');
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#6d7078'; ctx.fillRect(0, 0, w, h);
  const rnd = makeRng(41);
  for (let x = 0; x < w; x += 16) {
    const grad = ctx.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, '#565a63'); grad.addColorStop(0.45, '#7d828c'); grad.addColorStop(1, '#4b4f57');
    ctx.fillStyle = grad; ctx.fillRect(x, 0, 15, h);
  }
  for (let y = 0; y < h; y += 32) {
    ctx.fillStyle = 'rgba(30,32,36,0.35)'; ctx.fillRect(0, y, w, 3);
    ctx.fillStyle = `rgba(200,205,215,${rnd.range(0.03, 0.08)})`; ctx.fillRect(0, y + 3, w, 2);
  }
  const t = toTexture(c, [1, 1]);
  cache.set('tileroof', t);
  return t;
}

export function grassTexture() {
  if (cache.has('grass')) return cache.get('grass');
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  noiseFill(ctx, w, h, 0x5c7136, 0.42, 53, 0.22);
  const rnd = makeRng(9);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * w, y = rnd() * h;
    const g = rnd.range(70, 128);
    ctx.strokeStyle = `rgba(${(g * 0.55) | 0},${g | 0},${(g * 0.4) | 0},${rnd.range(0.1, 0.4)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd.range(-2, 2), y - rnd.range(2, 5)); ctx.stroke();
  }
  const t = toTexture(c, [1, 1]);
  cache.set('grass', t);
  return t;
}

export function dirtTexture() {
  if (cache.has('dirt')) return cache.get('dirt');
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  noiseFill(ctx, w, h, 0x7d6a4f, 0.4, 61, 0.18);
  const t = toTexture(c, [1, 1]);
  cache.set('dirt', t);
  return t;
}

export function barkTexture() {
  if (cache.has('bark')) return cache.get('bark');
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  noiseFill(ctx, w, h, 0x5b4634, 0.5, 67, 0.3);
  const rnd = makeRng(13);
  for (let i = 0; i < 60; i++) {
    const x = rnd() * w;
    ctx.strokeStyle = `rgba(30,22,16,${rnd.range(0.15, 0.45)})`;
    ctx.lineWidth = rnd.range(1, 3);
    ctx.beginPath();
    let y = 0, xx = x;
    while (y < h) { y += rnd.range(18, 46); xx += rnd.range(-6, 6); ctx.lineTo(xx, y); }
    ctx.stroke();
  }
  const t = toTexture(c, [1, 2]);
  cache.set('bark', t);
  return t;
}

// 水面法线贴图（细碎波纹）
export function waterNormalTexture() {
  if (cache.has('waterN')) return cache.get('waterN');
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = 0.6;
      const hx = fbm(x * 0.05, y * 0.05, 3, 3) - fbm((x + e) * 0.05, y * 0.05, 3, 3);
      const hy = fbm(x * 0.05, y * 0.05, 3, 3) - fbm(x * 0.05, (y + e) * 0.05, 3, 3);
      const nx = hx * 6, ny = hy * 6, nz = 1;
      const L = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i] = ((nx / L) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / L) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / L) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, [6, 6], { colorSpace: false });
  cache.set('waterN', t);
  return t;
}

// 树叶（透明叶片簇，用于灌木/树冠面片）
export function leafTexture() {
  if (cache.has('leaf')) return cache.get('leaf');
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const rnd = makeRng(29);
  for (let i = 0; i < 150; i++) {
    const x = rnd() * w, y = rnd() * h;
    const r = rnd.range(6, 16);
    const g = rnd.range(70, 130);
    ctx.fillStyle = `rgba(${(g * 0.55) | 0},${g | 0},${(g * 0.42) | 0},${rnd.range(0.55, 0.95)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rnd.range(0.5, 0.9), rnd() * 3.14, 0, 6.3);
    ctx.fill();
  }
  const t = toTexture(c, [1, 1]);
  cache.set('leaf', t);
  return t;
}

// ---------------------------------------------------------------------------
// 文字贴图：路牌、楼名、校训石
// ---------------------------------------------------------------------------
export function textTexture(text, opts = {}) {
  const {
    w = 512, h = 128, bg = '#1d4b3a', fg = '#f2efe4', font = 'bold 64px "Noto Sans SC","Microsoft YaHei",sans-serif',
    border = true, vertical = false, sub = '', subFont = '30px "Noto Sans SC","Microsoft YaHei",sans-serif',
    subColor = '#d9e2d5', radius = 0,
  } = opts;
  const key = 'txt:' + JSON.stringify([text, sub, w, h, bg, fg, vertical, border]);
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (bg) {
    ctx.fillStyle = bg;
    if (radius > 0) {
      ctx.beginPath();
      const r = radius;
      ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.quadraticCurveTo(w, 0, w, r);
      ctx.lineTo(w, h - r); ctx.quadraticCurveTo(w, h, w - r, h);
      ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h - r);
      ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.fill();
    } else ctx.fillRect(0, 0, w, h);
  }
  if (border) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(2, h * 0.03);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (vertical) {
    ctx.font = font;
    const chars = [...text];
    const step = h / (chars.length + (sub ? 0.6 : 0.2));
    chars.forEach((ch, i) => ctx.fillText(ch, w / 2, step * (i + 0.6)));
  } else {
    ctx.font = font;
    ctx.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
    if (sub) { ctx.font = subFont; ctx.fillStyle = subColor; ctx.fillText(sub, w / 2, h * 0.74); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

// 楼名竖排贴图（用于墙面挂牌）
export function plaqueTexture(name) {
  const key = 'plaque:' + name;
  if (cache.has(key)) return cache.get(key);
  const w = 96, h = 96 * Math.max(2, name.length) * 0.42;
  const c = canvas(96, Math.ceil(h)), ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, 96, h);
  ctx.strokeStyle = '#8d8577'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 92, h - 4);
  ctx.fillStyle = '#2b2b2b';
  ctx.font = 'bold 62px "Noto Sans SC","Microsoft YaHei",serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const chars = [...name];
  const step = (h - 20) / chars.length;
  chars.forEach((ch, i) => ctx.fillText(ch, 48, 12 + step * (i + 0.5)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// 窗户立面贴图（成排窗户 + 少量暖光）
export function facadeTexture(wallColor = 0xd8d3c8, floors = 5, bays = 10, opts = {}) {
  const key = 'facade:' + [wallColor, floors, bays, JSON.stringify(opts)].join('|');
  if (cache.has(key)) return cache.get(key);
  const cw = 64, ch = 64;
  const w = bays * cw, h = floors * ch;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = cssHex(wallColor); ctx.fillRect(0, 0, w, h);
  const rnd = makeRng(97);
  // 墙面噪点
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd.range(0.01, 0.05)})`;
    ctx.fillRect(rnd() * w, rnd() * h, rnd.range(2, 8), rnd.range(2, 8));
  }
  const glass = opts.glass ?? '#3f5668';
  const lit = opts.lit ?? 0.16;
  for (let f = 0; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      const x = b * cw + cw * 0.18, y = f * ch + ch * 0.2;
      const ww = cw * 0.64, wh = ch * 0.5;
      // 窗框
      ctx.fillStyle = 'rgba(70,72,70,0.9)'; ctx.fillRect(x - 3, y - 3, ww + 6, wh + 6);
      // 玻璃
      const isLit = rnd() < lit;
      if (isLit) {
        const g = ctx.createLinearGradient(x, y, x, y + wh);
        g.addColorStop(0, '#ffe7b0'); g.addColorStop(1, '#f7c877');
        ctx.fillStyle = g;
      } else {
        const g = ctx.createLinearGradient(x, y, x + ww, y + wh);
        g.addColorStop(0, glass); g.addColorStop(0.5, '#516b80'); g.addColorStop(1, '#2e404f');
        ctx.fillStyle = g;
      }
      ctx.fillRect(x, y, ww, wh);
      // 窗棂
      ctx.strokeStyle = 'rgba(230,230,225,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + ww / 2, y); ctx.lineTo(x + ww / 2, y + wh); ctx.stroke();
      // 窗台
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 4, y + wh + 3, ww + 8, 4);
    }
    // 楼层分隔线
    ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(0, f * ch + ch - 3, w, 3);
  }
  const t = toTexture(c, [1, 1]);
  cache.set(key, t);
  return t;
}

export function clearTextureCache() { cache.clear(); }
export { canvas, toTexture };
