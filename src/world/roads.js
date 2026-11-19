import * as THREE from 'three';
import { ROADS, PLAZAS, SPORTS, LAKE, BOUNDS } from './layout.js';
import { heightAt } from './terrain.js';
import { smoothPolyline, polylineLength } from '../core/util.js';
import { asphaltMat, pavingMat, stdMat } from '../core/materials.js';
import { textTexture } from '../core/textures.js';

const OFFSET = 0.035;

// 沿折线生成带状几何（中心线两侧各半宽）
function ribbonGeometry(pts, halfW, yOff, uvScale = 0.08, vStart = 0) {
  const verts = [], uvs = [], idx = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const nx = -dz, nz = dx; // 左法线
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const y = heightAt(p[0], p[1]) + yOff;
    verts.push(p[0] + nx * halfW, heightAt(p[0] + nx * halfW, p[1] + nz * halfW) + yOff, p[1] + nz * halfW);
    verts.push(p[0] - nx * halfW, heightAt(p[0] - nx * halfW, p[1] - nz * halfW) + yOff, p[1] - nz * halfW);
    uvs.push(0, dist * uvScale + vStart);
    uvs.push(1, dist * uvScale + vStart);
    if (i > 0) {
      const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 人行道：中心线两侧 (halfW, halfW+sidewalk) 两条带
function sidewalkGeometry(pts, halfW, sw, yOff) {
  const parts = [];
  for (const side of [1, -1]) {
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      const nx = -dz * side, nz = dx * side;
      left.push([p[0] + nx * halfW, p[1] + nz * halfW, heightAt(p[0] + nx * halfW, p[1] + nz * halfW) + yOff]);
      right.push([p[0] + nx * (halfW + sw), p[1] + nz * (halfW + sw), heightAt(p[0] + nx * (halfW + sw), p[1] + nz * (halfW + sw)) + yOff]);
    }
    const verts = [], uvs = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const a = left[i], b = right[i];
      verts.push(a[0], a[2], a[1], b[0], b[2], b[1]);
      uvs.push(0, i * 0.6, 1, i * 0.6);
      if (i > 0) { const p = (i - 1) * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  return parts;
}

export function createRoads(scene) {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = asphaltMat();
  const pave = pavingMat(0xcfc9bd);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2efe2, roughness: 0.7, metalness: 0 });
  lineMat.polygonOffset = true; lineMat.polygonOffsetFactor = -6; lineMat.polygonOffsetUnits = -6;
  const zebraMat = new THREE.MeshStandardMaterial({ color: 0xeeeade, roughness: 0.8 });
  zebraMat.polygonOffset = true; zebraMat.polygonOffsetFactor = -7; zebraMat.polygonOffsetUnits = -7;

  const signs = [];
  for (const road of ROADS) {
    const pts = smoothPolyline(road.pts.map(([x, z]) => [x, z]), 7);
    const half = road.width / 2;
    const g = ribbonGeometry(pts, half, OFFSET, 0.09);
    const m = new THREE.Mesh(g, asphalt);
    m.receiveShadow = true;
    m.name = 'road:' + road.name;
    group.add(m);

    // 人行道
    if (road.sidewalk) {
      for (const sg of sidewalkGeometry(pts, half, road.sidewalk, OFFSET + 0.11)) {
        const sm = new THREE.Mesh(sg, pave);
        sm.receiveShadow = true;
        group.add(sm);
      }
    }

    // 车道标线：主干道画黄色虚线分离带 + 白色边线
    const len = polylineLength(pts);
    if (road.width >= 11) {
      const isMajor = !!road.major;
      const dashMat = isMajor ? lineMat : lineMat;
      const step = 9;
      for (let d = 4; d < len - 4; d += step) {
        for (const seg of [[d, d + 4.5]]) {
          const t0 = seg[0] / len, t1 = seg[1] / len;
          const p0 = sample(pts, t0), p1 = sample(pts, t1);
          const geo = quadAlong(p0, p1, 0.16);
          if (geo) {
            const mm = new THREE.Mesh(geo, dashMat);
            group.add(mm);
          }
        }
      }
      // 两侧白边线
      for (const side of [1, -1]) {
        const verts = [], idx = [];
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
          let dx = next[0] - prev[0], dz = next[1] - prev[1];
          const L = Math.hypot(dx, dz) || 1;
          dx /= L; dz /= L;
          const nx = -dz * side, nz = dx * side;
          const off = half - 0.9 - 0.12;
          for (const w of [-0.08, 0.08]) {
            const X = p[0] + nx * (off + w), Z = p[1] + nz * (off + w);
            verts.push(X, heightAt(X, Z) + OFFSET + 0.012, Z);
          }
          if (i > 0) {
            const a = (i - 1) * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, lineMat));
      }
    }

    // 路名牌（沿路每 ~180m 放一块）
    const signCount = Math.max(1, Math.floor(len / 220));
    for (let i = 0; i < signCount; i++) {
      const t = (i + 0.5) / signCount;
      const p = sample(pts, t);
      signs.push({ road, x: p.x, z: p.z, ang: p.ang });
    }
  }

  // 斑马线（放在主要交叉口，粗粒度手工标注）
  const crossings = [
    [0, -520, 0], [-120, -543, 0], [405, -518, 0],
    [567, -25, Math.PI / 2], [562, -130, Math.PI / 2], [571, 164, Math.PI / 2],
    [333, -394, Math.PI / 2], [451, -387, Math.PI / 2],
    [-88, 250, Math.PI / 2], [-308, 256, Math.PI / 2],
    [214, 162, Math.PI / 2], [214, -30, Math.PI / 2],
    [860, 60, 0], [860, -180, 0],
  ];
  for (const [cx, cz, rot] of crossings) {
    const y = heightAt(cx, cz) + OFFSET + 0.02;
    for (let i = -3; i <= 3; i++) {
      const g = new THREE.PlaneGeometry(0.55, 4.6);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, zebraMat);
      const off = i * 1.05;
      m.position.set(cx + Math.cos(rot) * off, y, cz + Math.sin(rot) * off);
      m.rotation.y = -rot;
      group.add(m);
    }
  }

  scene.add(group);

  // 路牌（billboard 双面）
  const signGroup = new THREE.Group();
  signGroup.name = 'road-signs';
  for (const s of signs) {
    const tex = textTexture(s.road.name, {
      w: 256, h: 96, bg: '#134433', fg: '#f4f2e6', border: true, radius: 10,
      font: 'bold 46px "Noto Sans SC","Microsoft YaHei",sans-serif',
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), mat);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), stdMat({ color: 0x8d9499, metalness: 0.6, roughness: 0.45 }));
    const y = heightAt(s.x, s.z);
    post.position.set(s.x, y + 1.3, s.z);
    plate.position.set(s.x, y + 2.5, s.z);
    plate.rotation.y = -s.ang + Math.PI / 2;
    post.castShadow = true;
    plate.castShadow = true;
    signGroup.add(post, plate);
  }
  scene.add(signGroup);
  createPlazas(scene);
  createSportsSurfaces(scene);

  return { group, signGroup };
}



// ---------------------------------------------------------------------------
// 广场铺装 / 园路 / 运动场地
// ---------------------------------------------------------------------------
function ellipsePaving(p, y0 = 0.05, innerScale = 1) {
  // 直接在世界坐标生成椭圆铺装（三角扇，法线朝上）
  const seg = 44;
  const verts = [], uvs = [], idx = [];
  const cx = p.x, cz = p.z;
  verts.push(cx, heightAt(cx, cz) + y0, cz);
  uvs.push(cx * 0.11, cz * 0.11);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * p.rx * innerScale;
    const z = cz + Math.sin(a) * p.rz * innerScale;
    verts.push(x, heightAt(x, z) + y0, z);
    uvs.push(x * 0.11, z * 0.11);
  }
  for (let i = 1; i <= seg; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createPlazas(scene) {
  const group = new THREE.Group();
  group.name = 'plazas';
  const mat = pavingMat(0xe4dfd2).clone();
  mat.side = THREE.DoubleSide;
  const stone = pavingMat(0xbdb4a2).clone();
  stone.side = THREE.DoubleSide;
  for (const p of PLAZAS) {
    if (p.kind === 'plaza') {
      // 外圈石带（在更低的 y，避免 z-fighting）
      const ring = new THREE.Mesh(ellipsePaving(p, 0.03, 1.055), stone);
      ring.receiveShadow = true;
      ring.renderOrder = 0;
      group.add(ring);
      const m = new THREE.Mesh(ellipsePaving(p, 0.07), mat);
      m.receiveShadow = true;
      m.renderOrder = 1;
      m.name = 'plaza:' + p.name;
      group.add(m);
    } else {
      // 园地：铺一条环形小径 + 中心草坪保持原样
      const r = Math.min(p.rx, p.rz) * 0.82;
      for (let i = 0; i < 18; i++) {
        const a0 = (i / 18) * Math.PI * 2, a1 = ((i + 1) / 18) * Math.PI * 2;
        const g = new THREE.BufferGeometry();
        const verts = [], idx = [], uvs = [];
        const steps = 3;
        for (let s = 0; s <= steps; s++) {
          const a = a0 + (a1 - a0) * (s / steps);
          for (const rr of [r - 1.5, r + 1.5]) {
            const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr * (p.rz / p.rx);
            verts.push(x, heightAt(x, z) + 0.05, z);
            uvs.push(x * 0.1, z * 0.1);
          }
        }
        for (let s = 0; s < steps; s++) {
          const a = s * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, stone));
      }
    }
  }
  scene.add(group);
  return group;
}

export function createSportsSurfaces(scene) {
  const group = new THREE.Group();
  group.name = 'sports';
  const trackMat = new THREE.MeshStandardMaterial({ color: 0xb4553f, roughness: 0.95 });
  const pitchMat = new THREE.MeshStandardMaterial({ color: 0x4f7d42, roughness: 1 });
  const courtMat = new THREE.MeshStandardMaterial({ color: 0x3e6f7a, roughness: 0.85 });
  trackMat.polygonOffset = pitchMat.polygonOffset = courtMat.polygonOffset = true;
  trackMat.polygonOffsetFactor = pitchMat.polygonOffsetFactor = courtMat.polygonOffsetFactor = -3;
  for (const s of SPORTS) {
    const y = heightAt(s.x, s.z);
    if (s.kind === 'track' || s.kind === 'football') {
      const outer = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), trackMat);
      outer.rotation.x = -Math.PI / 2;
      outer.position.set(s.x, y + 0.06, s.z);
      outer.receiveShadow = true;
      group.add(outer);
      if (s.kind === 'track') {
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(s.w - 26, s.d - 22), pitchMat);
        inner.rotation.x = -Math.PI / 2;
        inner.position.set(s.x, y + 0.09, s.z);
        inner.receiveShadow = true;
        group.add(inner);
      }
    } else {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), courtMat);
      c.rotation.x = -Math.PI / 2;
      c.position.set(s.x, y + 0.06, s.z);
      c.receiveShadow = true;
      group.add(c);
    }
  }
  scene.add(group);
  return group;
}

function sample(pts, t) {
  const total = polylineLength(pts);
  let target = t * total;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (target <= seg || i === pts.length - 2) {
      const k = seg ? Math.min(1, target / seg) : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k,
      ];
    }
    target -= seg;
  }
  return pts[0];
}

function quadAlong(p0, p1, w) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const L = Math.hypot(dx, dz);
  if (L < 1e-3) return null;
  const nx = (-dz / L) * w, nz = (dx / L) * w;
  const y0 = heightAt(p0[0], p0[1]) + OFFSET + 0.012;
  const y1 = heightAt(p1[0], p1[1]) + OFFSET + 0.012;
  const verts = [
    p0[0] + nx, y0, p0[1] + nz,
    p0[0] - nx, y0, p0[1] - nz,
    p1[0] + nx, y1, p1[1] + nz,
    p1[0] - nx, y1, p1[1] - nz,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

export default { createRoads, createPlazas, createSportsSurfaces };
