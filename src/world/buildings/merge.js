// 几何合并工具（不依赖 three/addons —— 单文件构建里没有 BufferGeometryUtils）
//
// 提供两件事：
//   1. mergeGeos(list) ：把若干 BufferGeometry 拼成一个非索引 BufferGeometry
//   2. GeoBuilder      ：按材质分桶的“几何累加器”。所有建筑/地标往同一个
//                        GeoBuilder 里塞盒子、坡屋顶、圆柱，最后 build() 出一个
//                        BufferGeometry → 一个材质一个 mesh → draw call 极少。
//
// 关键约定：GeoBuilder 有一个“当前坐标系”（setFrame），所有图元都在局部坐标
// 里给，顶点写出时统一乘上建筑自身的位移/朝向。
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 1. 通用合并
// ---------------------------------------------------------------------------
export function mergeGeos(list) {
  const geos = (list || []).filter((g) => g && g.attributes && g.attributes.position);
  if (!geos.length) return new THREE.BufferGeometry();
  let total = 0;
  for (const g of geos) total += g.index ? g.index.count : g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const cols = new Float32Array(total * 3).fill(1);
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const c = g.attributes.color;
    const idx = g.index;
    const cnt = idx ? idx.count : p.count;
    for (let i = 0; i < cnt; i++) {
      const vi = idx ? idx.getX(i) : i;
      const d = (off + i) * 3;
      pos[d] = p.getX(vi); pos[d + 1] = p.getY(vi); pos[d + 2] = p.getZ(vi);
      if (n) { nor[d] = n.getX(vi); nor[d + 1] = n.getY(vi); nor[d + 2] = n.getZ(vi); } else nor[d + 1] = 1;
      const e = (off + i) * 2;
      if (u) { uvs[e] = u.getX(vi); uvs[e + 1] = u.getY(vi); }
      if (c) { cols[d] = c.getX(vi); cols[d + 1] = c.getY(vi); cols[d + 2] = c.getZ(vi); }
    }
    off += cnt;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// 2. 颜色（sRGB hex → 线性空间顶点色，和材质 color 的处理保持一致）
// ---------------------------------------------------------------------------
const _colorCache = new Map();
const _c = new THREE.Color();
export function linRGB(hex) {
  let v = _colorCache.get(hex);
  if (v) return v;
  _c.setHex(hex, THREE.SRGBColorSpace);
  v = [_c.r, _c.g, _c.b];
  _colorCache.set(hex, v);
  return v;
}

// 六个面的假 AO（顶面亮、背光面暗），廉价但极大提升白色线脚的体积感
const FACE_SHADE = [0.94, 0.90, 1.0, 0.84, 1.06, 0.68];

// 单位立方体的 6 个面：角点用 (±1,{0,1},±1) 表示（y: -1=底 / +1=顶）
const BOX_FACES = [
  { n: [1, 0, 0], q: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], q: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 0, 1], q: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], q: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [0, 1, 0], q: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], q: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

export class GeoBuilder {
  constructor(label = '') {
    this.label = label;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.n = 0;
    this.frame = { x: 0, y: 0, z: 0, ry: 0, c: 1, s: 0 };
    // ---- 照片立面专用开关（默认全关，不改变既有观感）----
    this.uvM = null;        // 未显式给 uvM 时的兜底密度 [米/列, 米/层]
    this.forceUv = null;    // 强制覆盖调用方传入的 uvM（照片立面要统一分格）
    this.uvWorld = false;   // 用楼体局部坐标（米）投影 UV：层高对齐、窗带连续
    this.vAnchor = null;    // 立面起点高度（第一段墙体的底），照片楼层从这里开始排
    this.forceFlat = false; // 关掉六面假 AO（照片自带明暗，叠加会脏）
  }

  // 把另一个 builder 已烘焙好的顶点吞进来（私有 kit 的非墙面桶并回共享桶）
  absorb(other) {
    if (!other || !other.n) return this;
    this.pos = this.pos.concat(other.pos);
    this.nor = this.nor.concat(other.nor);
    this.uv = this.uv.concat(other.uv);
    this.col = this.col.concat(other.col);
    this.n += other.n;
    other.pos = []; other.nor = []; other.uv = []; other.col = []; other.n = 0;
    return this;
  }

  // 设置当前坐标系（建筑落地位置与朝向）；本地坐标 = 局部，写出时变换到世界
  setFrame(x = 0, y = 0, z = 0, ry = 0) {
    this.frame.x = x; this.frame.y = y; this.frame.z = z; this.frame.ry = ry;
    this.frame.c = Math.cos(ry); this.frame.s = Math.sin(ry);
    return this;
  }

  get empty() { return this.n === 0; }

  // 底层写入：局部坐标 + 局部法线 + uv + 线性色
  vert(lx, ly, lz, nx, ny, nz, u, v, rgb) {
    const f = this.frame;
    this.pos.push(f.c * lx + f.s * lz + f.x, ly + f.y, -f.s * lx + f.c * lz + f.z);
    this.nor.push(f.c * nx + f.s * nz, ny, -f.s * nx + f.c * nz);
    this.uv.push(u, v);
    this.col.push(rgb[0], rgb[1], rgb[2]);
    this.n++;
  }

  tri(p1, p2, p3, opts = {}) {
    const color = opts.color ?? 0xffffff;
    const uv = opts.uv || null;
    const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
    const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const k = opts.noShade ? 1 : (opts.shadeK ?? 0.94);
    const c0 = linRGB(color);
    const r = c0[0] * k, g = c0[1] * k, b = c0[2] * k;
    const rgb = [r, g, b];
    const uv3 = uv || [[p1[0] / 4, p1[2] / 4], [p2[0] / 4, p2[2] / 4], [p3[0] / 4, p3[2] / 4]];
    this.vert(p1[0], p1[1], p1[2], nx, ny, nz, uv3[0][0], uv3[0][1], rgb);
    this.vert(p2[0], p2[1], p2[2], nx, ny, nz, uv3[1][0], uv3[1][1], rgb);
    this.vert(p3[0], p3[1], p3[2], nx, ny, nz, uv3[2][0], uv3[2][1], rgb);
    return this;
  }

  // 四点多边形（凸）→ 2 个三角形。uv 缺省按水平面投影
  quad(p1, p2, p3, p4, opts = {}) {
    const uv = opts.uv;
    const base = uv ? null : null;
    this.tri(p1, p2, p3, { ...opts, uv: uv ? [uv[0], uv[1], uv[2]] : base });
    this.tri(p1, p3, p4, { ...opts, uv: uv ? [uv[0], uv[2], uv[3]] : base });
    return this;
  }

  // 轴对齐盒：y 是**底面**高度，x/z 是中心。uvM=[米/次] 控制贴图密度
  box(w, h, d, o = {}) {
    if (w <= 0.0005 || h <= 0.0005 || d <= 0.0005) return this;
    const bx = o.x || 0, by = o.y || 0, bz = o.z || 0;
    const ry = o.ry || 0;
    const cY = Math.cos(ry), sY = Math.sin(ry);
    const cr = linRGB(o.color ?? this.tint ?? 0xffffff);
    const uvM = this.forceUv || o.uvM || this.uvM || null;
    const uvo = o.uvOff || this.uvOff || [0, 0];
    const shOn = (o.flat ?? this.forceFlat) !== true && o.shade !== false;
    // 照片立面：以「第一段墙体的底」作为立面起点。逸夫/文泰这类有 2.6~3.2m 石材基座
    // 的楼，若从 ±0 起算，窗带会整体错半层；锁到基座顶就正好每层对齐。
    if (this.uvWorld && this.vAnchor === null) this.vAnchor = Math.max(0, Math.min(4, by));
    const hx = w / 2, hz = d / 2;
    const dimW = [d, d, w, w, w, w]; // 每个面的水平尺寸（+x/-x→d，其余→w）
    const dimH = [h, h, h, h, d, d]; // 每个面的竖直尺寸（顶/底→d）
    for (let fi = 0; fi < 6; fi++) {
      const F = BOX_FACES[fi];
      const k = shOn ? FACE_SHADE[fi] : 1;
      const rgb = o.flat ? linRGB(o.color ?? this.tint ?? 0xffffff) : [cr[0] * k, cr[1] * k, cr[2] * k];
      const n = F.n;
      const nl = [cY * n[0] + sY * n[2], n[1], -sY * n[0] + cY * n[2]];
      const pts = [];
      for (let qi = 0; qi < 4; qi++) {
        const q = F.q[qi];
        const px = q[0] * hx, py = (q[1] + 1) * 0.5 * h;
        const pz = q[2] * hz;
        // 盒子自身绕 Y 旋转，再平移到盒中心
        pts.push([bx + (px * cY + pz * sY), by + py, bz + (-px * sY + pz * cY)]);
      }
      let uvs;
      if (uvM && this.uvWorld) {
        // 照片立面：按楼体局部坐标（米）投影。
        //   v = 局部高度 / 每格层高 → 层线与真实楼面严格对齐，不随盒子高度漂移；
        //   u = 沿该立面自身的水平轴 / 每格开间 → 同一面上多段墙体窗带连续。
        const iu = 1 / uvM[0], iv = 1 / uvM[1];
        const anchor = this.vAnchor || 0;
        uvs = [];
        for (let qi = 0; qi < 4; qi++) {
          const px = pts[qi][0], py = pts[qi][1], pz = pts[qi][2];
          // 侧面（±x）以 z 为水平轴，正背面（±z）以 x 为水平轴；按朝向取正负，避免贴图左右镜像
          const u = fi === 0 ? -pz * iu : fi === 1 ? pz * iu
            : fi === 2 ? px * iu : fi === 3 ? -px * iu
              : px * iu;
          const v = (fi >= 4 ? pz : py - anchor) * iv;
          uvs.push([u, v]);
        }
      } else {
        const su = uvM ? dimW[fi] / uvM[0] : 1;
        const sv = uvM ? dimH[fi] / uvM[1] : 1;
        const u0 = uvo[0], v0 = uvo[1];
        uvs = [[u0, v0], [u0 + su, v0], [u0 + su, v0 + sv], [u0, v0 + sv]];
      }
      for (let qi = 0; qi < 3; qi++) {
        this.vert(pts[qi][0], pts[qi][1], pts[qi][2], nl[0], nl[1], nl[2], uvs[qi][0], uvs[qi][1], rgb);
      }
      this.vert(pts[0][0], pts[0][1], pts[0][2], nl[0], nl[1], nl[2], uvs[0][0], uvs[0][1], rgb);
      this.vert(pts[2][0], pts[2][1], pts[2][2], nl[0], nl[1], nl[2], uvs[2][0], uvs[2][1], rgb);
      this.vert(pts[3][0], pts[3][1], pts[3][2], nl[0], nl[1], nl[2], uvs[3][0], uvs[3][1], rgb);
    }
    return this;
  }

  // 圆柱/棱柱：y 底面，radius 顶/底分开（可做锥台）
  cyl(rTop, rBot, h, seg, o = {}) {
    const x = o.x || 0, y = o.y || 0, z = o.z || 0;
    const k = o.shade === false ? 1 : 0.95;
    const cr = linRGB(o.color ?? 0xffffff);
    const rgb = [cr[0] * k, cr[1] * k, cr[2] * k];
    const uvr = o.uvRepeat || 1;
    seg = Math.max(3, seg | 0);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const t0 = Math.cos(a0), t1 = Math.cos(a1), s0 = Math.sin(a0), s1 = Math.sin(a1);
      const p = [
        [x + t0 * rBot, y, z + s0 * rBot],
        [x + t1 * rBot, y, z + s1 * rBot],
        [x + t1 * rTop, y + h, z + s1 * rTop],
        [x + t0 * rTop, y + h, z + s0 * rTop],
      ];
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      const uv = [[i / seg * uvr, 0], [(i + 1) / seg * uvr, 0], [(i + 1) / seg * uvr, h / 4], [i / seg * uvr, h / 4]];
      for (let qi = 0; qi < 3; qi++) {
        this.vert(p[qi][0], p[qi][1], p[qi][2], nx, 0, nz, uv[qi][0], uv[qi][1], rgb);
      }
      this.vert(p[0][0], p[0][1], p[0][2], nx, 0, nz, uv[0][0], uv[0][1], rgb);
      this.vert(p[2][0], p[2][1], p[2][2], nx, 0, nz, uv[2][0], uv[2][1], rgb);
      this.vert(p[3][0], p[3][1], p[3][2], nx, 0, nz, uv[3][0], uv[3][1], rgb);
      if (rTop > 0.001) {
        // 顶盖
        this.vert(x, y + h, z, 0, 1, 0, 0.5, 0.5, rgb);
        this.vert(p[3][0], p[3][1], p[3][2], 0, 1, 0, 0, 0, rgb);
        this.vert(p[2][0], p[2][1], p[2][2], 0, 1, 0, 1, 0, rgb);
      }
      if (rBot > 0.001) {
        this.vert(x, y, z, 0, -1, 0, 0.5, 0.5, rgb);
        this.vert(p[1][0], p[1][1], p[1][2], 0, -1, 0, 1, 0, rgb);
        this.vert(p[0][0], p[0][1], p[0][2], 0, -1, 0, 0, 0, rgb);
      }
    }
    return this;
  }

  // 四坡瓦屋顶（歇山简化：脊沿长边）。y=檐口高度
  hipRoof(w, d, h, o = {}) {
    const ov = o.overhang ?? 0.7;
    const W = w / 2 + ov, D = d / 2 + ov;
    const y0 = o.y || 0;
    const col = o.color ?? 0x8a8f96;
    const alongX = w >= d;
    const rl = Math.max(0.6, Math.abs(w - d) / 2 - 0.4);
    const A = alongX ? [-rl, y0 + h, 0] : [0, y0 + h, -rl];
    const B = alongX ? [rl, y0 + h, 0] : [0, y0 + h, rl];
    const c1 = [-W, y0, D], c2 = [W, y0, D], c3 = [W, y0, -D], c4 = [-W, y0, -D];
    const M = 1 / 2.6; // 瓦片密度（米/次）
    const uvOf = (p, along) => [along * M, (p[1] - y0) * M];
    if (alongX) {
      this.quad(c4, c3, B, A, { color: col, shadeK: 0.88, uv: [uvOf(c4, c4[0]), uvOf(c3, c3[0]), uvOf(B, B[0]), uvOf(A, A[0])] });
      this.quad(c2, c1, A, B, { color: col, shadeK: 1.0, uv: [uvOf(c2, c2[0]), uvOf(c1, c1[0]), uvOf(A, A[0]), uvOf(B, B[0])] });
      this.tri(c3, c2, B, { color: col, shadeK: 0.93, uv: [uvOf(c3, c3[2]), uvOf(c2, c2[2]), uvOf(B, B[2])] });
      this.tri(c1, c4, A, { color: col, shadeK: 0.86, uv: [uvOf(c1, c1[2]), uvOf(c4, c4[2]), uvOf(A, A[2])] });
    } else {
      this.quad(c1, c2, B, A, { color: col, shadeK: 1.0, uv: [uvOf(c1, c1[0]), uvOf(c2, c2[0]), uvOf(B, B[0]), uvOf(A, A[0])] });
      this.quad(c4, c3, A, B, { color: col, shadeK: 0.88, uv: [uvOf(c4, c4[0]), uvOf(c3, c3[0]), uvOf(A, A[0]), uvOf(B, B[0])] });
      this.tri(c2, c3, B, { color: col, shadeK: 0.93, uv: [uvOf(c2, c2[2]), uvOf(c3, c3[2]), uvOf(B, B[2])] });
      this.tri(c4, c1, A, { color: col, shadeK: 0.86, uv: [uvOf(c4, c4[2]), uvOf(c1, c1[2]), uvOf(A, A[2])] });
    }
    return this;
  }

  // 双坡（人字）屋顶，脊沿 x
  gableRoof(w, d, h, o = {}) {
    const ov = o.overhang ?? 0.6;
    const W = w / 2 + ov, D = d / 2 + ov;
    const y0 = o.y || 0;
    const col = o.color ?? 0x8a8f96;
    const M = 1 / 2.6;
    const A = [-W, y0 + h, 0], B = [W, y0 + h, 0];
    const c1 = [-W, y0, D], c2 = [W, y0, D], c3 = [W, y0, -D], c4 = [-W, y0, -D];
    const uvf = (p) => [p[0] * M, (Math.abs(p[2]) + (p[1] - y0)) * M];
    this.quad(c2, c1, A, B, { color: col, shadeK: 1.0, uv: [uvf(c2), uvf(c1), uvf(A), uvf(B)] });
    this.quad(c4, c3, B, A, { color: col, shadeK: 0.86, uv: [uvf(c4), uvf(c3), uvf(B), uvf(A)] });
    // 山墙
    this.tri(c1, c4, A, { color: o.gableColor ?? col, shadeK: 1.0, uv: [uvf(c1), uvf(c4), uvf(A)] });
    this.tri(c3, c2, B, { color: o.gableColor ?? col, shadeK: 0.9, uv: [uvf(c3), uvf(c2), uvf(B)] });
    return this;
  }

  // 筒壳 / 拱屋顶：沿 x 方向为长度，跨度为 d，矢高 rise
  vault(w, d, rise, seg, o = {}) {
    const x0 = -(w / 2), x1 = w / 2;
    const y0 = o.y || 0;
    const col = o.color ?? 0x9aa5a3;
    const R = (d * d / 4 + rise * rise) / (2 * rise); // 圆弧半径
    const cy = y0 + rise - R;
    const half = Math.asin((d / 2) / R);
    seg = Math.max(4, seg | 0);
    const M = 1 / 3;
    const pt = (a, xx) => [xx, cy + R * Math.cos(a), R * Math.sin(a)];
    for (let i = 0; i < seg; i++) {
      const a0 = -half + (i / seg) * half * 2, a1 = -half + ((i + 1) / seg) * half * 2;
      const p1 = pt(a0, x0), p2 = pt(a0, x1), p3 = pt(a1, x1), p4 = pt(a1, x0);
      const mid = (a0 + a1) / 2;
      const k = 0.86 + 0.18 * Math.cos(mid);
      // 每个面用显式法线由 tri() 自动算；uv 沿弧长展开
      const uv = (p) => [p[0] * M, Math.atan2(p[2], p[1] - cy) * R * M];
      this.quad(p1, p2, p3, p4, { color: col, shadeK: k, uv: [uv(p1), uv(p2), uv(p3), uv(p4)] });
    }
    // 两端封头（扇形）
    for (let i = 0; i < seg; i++) {
      const a0 = -half + (i / seg) * half * 2, a1 = -half + ((i + 1) / seg) * half * 2;
      const o0 = [x0, y0, 0];
      const q0 = pt(a0, x0), q1 = pt(a1, x0);
      this.tri(o0, q1, q0, { color: o.endColor ?? col, shadeK: 0.7, noShade: true });
      const o1 = [x1, y0, 0];
      const r0 = pt(a0, x1), r1 = pt(a1, x1);
      this.tri(o1, r0, r1, { color: o.endColor ?? col, shadeK: 1.0, noShade: true });
    }
    return this;
  }

  // 竖直矩形面片（朝向 +z），用于挂牌/玻璃幕/旗面
  panel(w, h, o = {}) {
    const x = o.x || 0, y = o.y || 0, z = o.z || 0;
    const ry = o.ry || 0;
    const uv = o.uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const nx = Math.sin(ry), nz = Math.cos(ry);
    const cY = Math.cos(ry), sY = Math.sin(ry);
    const p = (lx, ly) => [x + lx * cY, y + ly, z + (-lx * sY)];
    const p1 = p(-w / 2, 0), p2 = p(w / 2, 0), p3 = p(w / 2, h), p4 = p(-w / 2, h);
    const col = o.color ?? 0xffffff;
    const k = o.shadeK ?? 1;
    const cr = linRGB(col);
    const rgb = [cr[0] * k, cr[1] * k, cr[2] * k];
    const n = [nx, 0, nz];
    this.vert(p1[0], p1[1], p1[2], n[0], 0, n[2], uv[0][0], uv[0][1], rgb);
    this.vert(p2[0], p2[1], p2[2], n[0], 0, n[2], uv[1][0], uv[1][1], rgb);
    this.vert(p3[0], p3[1], p3[2], n[0], 0, n[2], uv[2][0], uv[2][1], rgb);
    this.vert(p1[0], p1[1], p1[2], n[0], 0, n[2], uv[0][0], uv[0][1], rgb);
    this.vert(p3[0], p3[1], p3[2], n[0], 0, n[2], uv[2][0], uv[2][1], rgb);
    this.vert(p4[0], p4[1], p4[2], n[0], 0, n[2], uv[3][0], uv[3][1], rgb);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
