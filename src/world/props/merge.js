// 轻量几何合并器：把大量程序化生成的小几何体烘焙进一个 BufferGeometry，
// 只保留 position / normal / uv / color 四个属性（顶点色 + 单个材质 = 1 draw call）。
// 只用 three 核心 API，不依赖 three/addons 的 BufferGeometryUtils。
import * as THREE from 'three';

const _colorCache = new Map();
/** hex → [r,g,b]（linear，three 的 Color 会自动做 sRGB→linear） */
export function rgb(hex) {
  let c = _colorCache.get(hex);
  if (!c) {
    const col = new THREE.Color(hex);
    c = [col.r, col.g, col.b];
    _colorCache.set(hex, c);
    if (_colorCache.size > 4096) _colorCache.clear();
  }
  return c;
}

/** 两个 rgb 线性插值 */
export function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 亮度缩放 */
export function scaleRgb(c, f) {
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}

const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

let _ico0 = null;
/** 共享的低模球（20 面） */
export function icoGeo() {
  if (!_ico0) _ico0 = new THREE.IcosahedronGeometry(1, 0);
  return _ico0;
}
let _box = null;
export function boxGeo() {
  if (!_box) _box = new THREE.BoxGeometry(1, 1, 1);
  return _box;
}

export class GeoBuilder {
  constructor(name = 'merged') {
    this.name = name;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.seed = 0x1a2b3c4d;
  }

  get tris() { return this.pos.length / 9; }

  /** xorshift 随机，保证每次构建结果一致 */
  rand() {
    let x = this.seed | 0;
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    this.seed = x;
    return ((x >>> 0) % 1000000) / 1000000;
  }

  _vert(px, py, pz, nx, ny, nz, u, v, c) {
    this.pos.push(px, py, pz);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
  }

  /** 三角形（平法线）；uvs 可选 [[u,v],[u,v],[u,v]] */
  tri(a, b, c, color, uvs) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const col = typeof color === 'number' ? rgb(color) : color;
    const u0 = uvs ? uvs[0] : null, u1 = uvs ? uvs[1] : null, u2 = uvs ? uvs[2] : null;
    this._vert(a[0], a[1], a[2], nx, ny, nz, u0 ? u0[0] : 0, u0 ? u0[1] : 0, col);
    this._vert(b[0], b[1], b[2], nx, ny, nz, u1 ? u1[0] : 1, u1 ? u1[1] : 0, col);
    this._vert(c[0], c[1], c[2], nx, ny, nz, u2 ? u2[0] : 1, u2 ? u2[1] : 1, col);
  }

  /** 三角形，逐顶点颜色（做叶片渐变） */
  triC(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this._vert(a[0], a[1], a[2], nx, ny, nz, 0, 0, ca);
    this._vert(b[0], b[1], b[2], nx, ny, nz, 1, 0, cb);
    this._vert(c[0], c[1], c[2], nx, ny, nz, 1, 1, cc);
  }

  /** 四边形（两个三角形，逆时针） */
  quad(a, b, c, d, color, uvs) {
    if (uvs) {
      this.tri(a, b, c, color, [uvs[0], uvs[1], uvs[2]]);
      this.tri(a, c, d, color, [uvs[0], uvs[2], uvs[3]]);
    } else {
      this.tri(a, b, c, color);
      this.tri(a, c, d, color);
    }
  }

  /**
   * 合并任意几何。
   * opts: { color, jitter, facetColor(cx,cy,cz,out)=>hex, uvScale:[sx,sy], uvOffset:[ox,oy] }
   */
  add(geo, matrix, opts = {}) {
    let g = geo;
    if (matrix) {
      g = geo.clone();
      g.applyMatrix4(matrix);
    }
    if (g.index) {
      const ng = g.toNonIndexed();
      if (g !== geo) g.dispose();
      g = ng;
    }
    const P = g.getAttribute('position');
    if (!P) return;
    const N = g.getAttribute('normal');
    const U = g.getAttribute('uv');
    const CV = g.getAttribute('color');
    const base = opts.colorRgb || (opts.color != null ? rgb(opts.color) : null);
    const jit = opts.jitter || 0;
    const us = opts.uvScale;
    const uo = opts.uvOffset;
    const facet = opts.facetColor || null;
    const count = P.count;
    let facetCol = null;
    for (let i = 0; i < count; i += 3) {
      if (facet || jit) {
        const cx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3;
        const cy = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3;
        const cz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
        if (facet) {
          const fc = facet(cx, cy, cz);
          facetCol = Array.isArray(fc) ? fc : rgb(fc);
        } else if (base) {
          facetCol = base;
        } else {
          facetCol = rgb(0xffffff);
        }
        if (jit) {
          const f = 1 + (this.rand() * 2 - 1) * jit;
          facetCol = scaleRgb(facetCol, f);
        }
      }
      for (let k = 0; k < 3; k++) {
        const i2 = i + k;
        let c;
        if (facet || jit) c = facetCol;
        else if (base) c = base;
        else if (CV) c = [CV.getX(i2), CV.getY(i2), CV.getZ(i2)];
        else c = rgb(0xffffff);
        let nx = 0, ny = 1, nz = 0;
        if (N) { nx = N.getX(i2); ny = N.getY(i2); nz = N.getZ(i2); }
        let u = 0, v = 0;
        if (U) { u = U.getX(i2); v = U.getY(i2); }
        if (us) { u = u * us[0] + (uo ? uo[0] : 0); v = v * us[1] + (uo ? uo[1] : 0); }
        this._vert(P.getX(i2), P.getY(i2), P.getZ(i2), nx, ny, nz, u, v, c);
      }
    }
    if (g !== geo) g.dispose();
  }

  /** 轴对齐盒子（带旋转/缩放），比 add(BoxGeometry) 快很多 */
  addBox(w, h, d, opts = {}) {
    const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = opts;
    const c = opts.colorRgb || (typeof opts.color === 'number' ? rgb(opts.color) : (opts.color || rgb(0xffffff)));
    const jit = opts.jitter || 0;
    const m = _m.compose(
      _v1.set(x, y, z),
      _q.setFromEuler(_e.set(rx, ry, rz)),
      _v2.set(1, 1, 1)
    ).elements;
    const hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
    // 8 角点
    const P = [];
    for (let i = 0; i < 8; i++) {
      const lx = (i & 1 ? hw : -hw);
      const ly = (i & 2 ? hh : -hh);
      const lz = (i & 4 ? hd : -hd);
      P.push([
        m[0] * lx + m[4] * ly + m[8] * lz + m[12],
        m[1] * lx + m[5] * ly + m[9] * lz + m[13],
        m[2] * lx + m[6] * ly + m[10] * lz + m[14],
      ]);
    }
    const cc = jit ? scaleRgb(c, 1 + (this.rand() * 2 - 1) * jit) : c;
    // 逆时针外表面：0(-,-,-) 1(+,-,-) 2(-,+,-) 3(+,+,-) 4(-,-,+) 5(+,-,+) 6(-,+,+) 7(+,+,+)
    this.quad(P[4], P[5], P[7], P[6], cc); // +z
    this.quad(P[1], P[0], P[2], P[3], cc); // -z
    this.quad(P[5], P[1], P[3], P[7], cc); // +x
    this.quad(P[0], P[4], P[6], P[2], cc); // -x
    this.quad(P[6], P[7], P[3], P[2], cc); // +y
    this.quad(P[0], P[1], P[5], P[4], cc); // -y
  }

  /**
   * 圆柱/圆台。y 为轴，原点在中心。
   * opts: {x,y,z,rx,ry,rz, seg, color, capTop, capBot, matrix}
   */
  addCyl(rTop, rBot, h, opts = {}) {
    const seg = opts.seg || 8;
    const c = opts.colorRgb || (typeof opts.color === 'number' ? rgb(opts.color) : (opts.color || rgb(0xffffff)));
    const jit = opts.jitter || 0;
    const m = (opts.matrix ? _m.copy(opts.matrix) : _m.compose(
      _v1.set(opts.x || 0, opts.y || 0, opts.z || 0),
      _q.setFromEuler(_e.set(opts.rx || 0, opts.ry || 0, opts.rz || 0)),
      _v2.set(1, 1, 1)
    )).elements;
    const T = (lx, ly, lz) => ([
      m[0] * lx + m[4] * ly + m[8] * lz + m[12],
      m[1] * lx + m[5] * ly + m[9] * lz + m[13],
      m[2] * lx + m[6] * ly + m[10] * lz + m[14],
    ]);
    const hy = h * 0.5;
    const bot = [], top = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      bot.push(T(ca * rBot, -hy, sa * rBot));
      top.push(T(ca * rTop, hy, sa * rTop));
    }
    for (let i = 0; i < seg; i++) {
      const cc = jit ? scaleRgb(c, 1 + (this.rand() * 2 - 1) * jit) : c;
      // 逆时针（外法线朝外）
      this.quad(bot[i], top[i], top[i + 1], bot[i + 1], cc);
    }
    if (opts.capTop) {
      const apex = T(0, hy, 0);
      for (let i = 0; i < seg; i++) this.tri(top[i + 1], top[i], apex, c);
    }
    if (opts.capBot !== false) {
      const apex = T(0, -hy, 0);
      for (let i = 0; i < seg; i++) this.tri(bot[i], bot[i + 1], apex, c);
    }
  }

  /** 任意两点之间的圆柱（树干/树枝） */
  beam(a, b, r0, r1, seg, color, opts = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 0.001;
    _v1.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_up, _v1);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5),
      _q, _one
    );
    this.addCyl(r1, r0, len, {
      matrix: m, seg, color, capTop: opts.capTop || false, capBot: opts.capBot || false, jitter: opts.jitter,
    });
  }

  /** 由若干四边形拼成的叶片（4 顶点，中间折起，自由朝向） */
  leafQuad(center, dir, size, cBase, cTip, roll = 0) {
    // dir: 向外指向；构造平面基
    let ox = dir[0], oy = dir[1], oz = dir[2];
    const ol = Math.hypot(ox, oy, oz) || 1;
    ox /= ol; oy /= ol; oz /= ol;
    // right = normalize(cross(dir, up)); 若退化用 x 轴
    let rxx = -oz, ryy = 0, rzz = ox;
    const rl = Math.hypot(rxx, ryy, rzz);
    if (rl < 1e-4) { rxx = 1; ryy = 0; rzz = 0; } else { rxx /= rl; ryy /= rl; rzz /= rl; }
    // up2 = cross(right, dir)
    const ux = ryy * oz - rzz * oy;
    const uy = rzz * ox - rxx * oz;
    const uz = rxx * oy - ryy * ox;
    // roll 旋转 right/up2 绕 dir
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const ax = rxx * cr + ux * sr, ay = ryy * cr + uy * sr, az = rzz * cr + uz * sr;
    const bx = ux * cr - rxx * sr, by = uy * cr - ryy * sr, bz = uz * cr - rzz * sr;
    const s = size;
    const cx = center[0], cy = center[1], cz = center[2];
    const A = [cx - ax * s * 0.28 - bx * s * 0.42, cy - ay * s * 0.28 - by * s * 0.42, cz - az * s * 0.28 - bz * s * 0.42];
    const B = [cx + ax * s * 0.34 - bx * s * 0.10, cy + ay * s * 0.34 - by * s * 0.10, cz + az * s * 0.34 - bz * s * 0.10];
    const C = [cx + ax * s * 0.06 + bx * s * 0.52, cy + ay * s * 0.06 + by * s * 0.52, cz + az * s * 0.06 + bz * s * 0.52];
    const D = [cx - ax * s * 0.30 + bx * s * 0.12, cy - ay * s * 0.30 + by * s * 0.12, cz - az * s * 0.30 + bz * s * 0.12];
    this.triC(A, B, C, cBase, cBase, cTip);
    this.triC(A, C, D, cBase, cTip, cBase);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.tris = this.tris;
    g.name = this.name;
    return g;
  }
}

/** 便捷函数：合并一组 {geo, matrix, opts} */
export function mergeGeos(list) {
  const b = new GeoBuilder();
  for (const it of list) b.add(it.geo, it.matrix || null, it.opts || {});
  return b.build();
}
