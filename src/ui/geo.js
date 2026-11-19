// 平面几何工具（米制平面：x 向东，z 向南，y 向上）
// 纯函数，供「区域判定」与「校园地图」共用，不依赖 three。
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** 点在某矩形（可带 y 轴旋转）的距离：内部为负（到最近边的距离），外部为米制距离 */
export function rectDistance(px, pz, b) {
  let dx = px - b.x;
  let dz = pz - b.z;
  const rot = b.rot || 0;
  if (rot) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const x2 = dx * c + dz * s;
    const z2 = -dx * s + dz * c;
    dx = x2;
    dz = z2;
  }
  const hw = (b.w || 0) * 0.5;
  const hd = (b.d || 0) * 0.5;
  const ex = Math.abs(dx) - hw;
  const ez = Math.abs(dz) - hd;
  if (ex <= 0 && ez <= 0) return Math.max(ex, ez);
  return Math.hypot(Math.max(ex, 0), Math.max(ez, 0));
}

/** 点到椭圆的近似米制距离（沿径向），内部为负 */
export function ellipseDistance(px, pz, e) {
  const rx = e.rx || e.r || 1;
  const rz = e.rz || e.r || 1;
  const nx = (px - e.x) / rx;
  const nz = (pz - e.z) / rz;
  const k = Math.hypot(nx, nz);
  if (k < 1e-9) return -Math.min(rx, rz);
  // 该方向上的椭圆边界半径
  const boundary = Math.hypot((nx / k) * rx, (nz / k) * rz);
  return (k - 1) * boundary;
}

/** 点到线段：{ d, t, x, z } */
export function segmentNearest(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / len2, 0, 1) : 0;
  const x = ax + vx * t;
  const z = az + vz * t;
  return { d: Math.hypot(px - x, pz - z), t, x, z };
}

/** 点到折线：{ d, x, z, i }（i 为最近线段下标） */
export function polylineNearest(px, pz, pts) {
  let best = { d: Infinity, x: 0, z: 0, i: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const s = segmentNearest(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (s.d < best.d) best = { d: s.d, x: s.x, z: s.z, i };
  }
  return best;
}

/** 射线法判断点是否在多边形内 */
export function pointInPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** 到多边形边界的距离（内部也返回正数） */
export function polygonDistance(px, pz, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const s = segmentNearest(px, pz, a[0], a[1], b[0], b[1]);
    if (s.d < d) d = s.d;
  }
  return d;
}

/** 矩形四角（世界坐标），rot 绕 y 轴（与 three 的 rotation.y 同向） */
export function rectCorners(x, z, w, d, rot = 0) {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out = [];
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    out.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  }
  return out;
}

export function fmtMeters(d) {
  const a = Math.abs(d);
  if (a >= 1000) return (a / 1000).toFixed(1) + ' km';
  return Math.round(a) + ' m';
}
