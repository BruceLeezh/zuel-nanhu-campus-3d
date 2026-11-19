// 通用数学/几何/程序化工具
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
// 帧率无关阻尼：向目标 b 逼近，速率 r
export const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
export const dampAngle = (a, b, r, dt) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * (1 - Math.exp(-r * dt));
};
export const deg = (d) => (d * Math.PI) / 180;

// 确定性随机数（mulberry32）
export function makeRng(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.range = (lo, hi) => lo + rnd() * (hi - lo);
  rnd.int = (lo, hi) => Math.floor(lo + rnd() * (hi - lo + 1));
  rnd.pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  rnd.sign = () => (rnd() < 0.5 ? -1 : 1);
  rnd.chance = (p) => rnd() < p;
  return rnd;
}

// 二维哈希 + 值噪声（地形/分布用）
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smootherstep(xf), v = smootherstep(yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, oct = 4, seed = 0) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * valueNoise(x * f, y * f, seed + i * 131); amp *= 0.5; f *= 2.03; }
  return s;
}

// 多边形工具
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi) inside = !inside;
  }
  return inside;
}
export function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
// 椭圆区域内归一化距离（0 中心，1 边缘）
export function ellipseDist(x, z, cx, cz, rx, rz) {
  const dx = (x - cx) / rx, dz = (z - cz) / rz;
  return Math.sqrt(dx * dx + dz * dz);
}
export function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const L2 = vx * vx + vz * vz;
  const t = L2 > 0 ? clamp((wx * vx + wz * vz) / L2, 0, 1) : 0;
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}
export function distToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}
export function polylineLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}
// 沿折线取点（t: 0..1）+ 切线角
export function samplePolyline(pts, t) {
  const total = polylineLength(pts);
  let target = clamp(t, 0, 1) * total;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (target <= seg || i === pts.length - 2) {
      const k = seg > 0 ? clamp(target / seg, 0, 1) : 0;
      const x = lerp(pts[i][0], pts[i + 1][0], k), z = lerp(pts[i][1], pts[i + 1][1], k);
      const ang = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      return { x, z, ang };
    }
    target -= seg;
  }
  return { x: pts[0][0], z: pts[0][1], ang: 0 };
}
// Catmull-Rom 折线加密
export function smoothPolyline(pts, perSeg = 6) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      const t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 颜色工具
export function shade(hex, amt) {
  const r = clamp(((hex >> 16) & 255) + amt, 0, 255);
  const g = clamp(((hex >> 8) & 255) + amt, 0, 255);
  const b = clamp((hex & 255) + amt, 0, 255);
  return (r << 16) | (g << 8) | b;
}
export function tint(hex, mul) {
  const r = clamp(Math.round(((hex >> 16) & 255) * mul), 0, 255);
  const g = clamp(Math.round(((hex >> 8) & 255) * mul), 0, 255);
  const b = clamp(Math.round((hex & 255) * mul), 0, 255);
  return (r << 16) | (g << 8) | b;
}
export function hexToRgb(hex) {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
}
export function cssHex(hex) { return '#' + hex.toString(16).padStart(6, '0'); }

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
