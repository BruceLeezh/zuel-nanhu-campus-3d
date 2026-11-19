import * as THREE from 'three';
import { CFG } from '../core/config.js';
import { BOUNDS, HILLS, LAKE, PLAZAS, BUILDINGS, SPORTS, TREE_ZONES } from './layout.js';
import { clamp, lerp, smoothstep, fbm, valueNoise, makeRng, pointInPoly } from '../core/util.js';
import { grassMat, stdMat } from '../core/materials.js';
import { grassTexture, waterNormalTexture, pavingTexture } from '../core/textures.js';

// ---------------------------------------------------------------------------
// 地形：统一高度场（烘焙到栅格，供渲染 / 角色 / 物理 / 摆放共用）
// ---------------------------------------------------------------------------
const STEP = 4; // 米
const NX = Math.round((BOUNDS.maxX - BOUNDS.minX) / STEP) + 1;
const NZ = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / STEP) + 1;
const heights = new Float32Array(NX * NZ);
let baked = false;

function baseHeight(x, z) {
  let h = 0;
  // 微起伏：校园整体平缓，局部有缓坡
  h += (fbm(x * 0.0022 + 11, z * 0.0022 + 7, 3, 7) - 0.5) * 2.2;
  h += (valueNoise(x * 0.012, z * 0.012, 3) - 0.5) * 0.5;
  // 山丘（高斯包络）
  for (const hill of HILLS) {
    const dx = (x - hill.x) / hill.rx, dz = (z - hill.z) / hill.rz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1.6) {
      const k = Math.exp(-d * d * 1.9) * (1 - smoothstep(clamp((d - 0.9) / 0.7, 0, 1)));
      h += hill.h * k;
    }
  }
  return h;
}

function lakeDepth(x, z) {
  let d = 0;
  if (pointInPoly(x, z, LAKE.poly)) d = -3.2;
  for (const p of LAKE.ponds) {
    const dd = Math.hypot(x - p.x, z - p.z) / (p.r + 3);
    if (dd < 1) d = Math.min(d, -1.9 * (1 - dd * dd));
  }
  return d;
}

function bake() {
  if (baked) return;
  baked = true;
  const rnd = makeRng(CFG.seed + 5);
  // 平坦台基：建筑、广场、运动场
  const pads = [];
  for (const b of BUILDINGS) {
    if (b.group && b.cells) {
      for (const c of b.cells) pads.push({ x: c[0], z: c[1], rx: 22, rz: 16 });
    } else pads.push({ x: b.x, z: b.z, rx: b.w * 0.62 + 8, rz: b.d * 0.62 + 8 });
  }
  for (const s of SPORTS) pads.push({ x: s.x, z: s.z, rx: s.w * 0.62 + 10, rz: s.d * 0.62 + 10 });
  for (const p of PLAZAS) if (p.kind === 'plaza') pads.push({ x: p.x, z: p.z, rx: p.rx + 6, rz: p.rz + 6 });

  const padH = pads.map((p) => baseHeight(p.x, p.z));

  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = BOUNDS.minX + i * STEP;
      const z = BOUNDS.minZ + j * STEP;
      let h = baseHeight(x, z);
      // 湖盆
      h += lakeDepth(x, z);
      // 台基压平
      for (let k = 0; k < pads.length; k++) {
        const p = pads[k];
        const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1) {
          const w = 1 - smoothstep(clamp((d - 0.72) / 0.28, 0, 1));
          h = lerp(h, padH[k], w);
        }
      }
      // 校园边界外略微下沉，形成「孤岛」观感
      heights[j * NX + i] = h;
    }
  }
}

export function heightAt(x, z) {
  bake();
  const fx = clamp((x - BOUNDS.minX) / STEP, 0, NX - 1.001);
  const fz = clamp((z - BOUNDS.minZ) / STEP, 0, NZ - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const h00 = heights[j * NX + i], h10 = heights[j * NX + i + 1];
  const h01 = heights[(j + 1) * NX + i], h11 = heights[(j + 1) * NX + i + 1];
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

/** 地面法线（用于斜坡行走/贴地） */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.2;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

export function inLake(x, z) {
  if (pointInPoly(x, z, LAKE.poly)) return true;
  for (const p of LAKE.ponds) if (Math.hypot(x - p.x, z - p.z) < p.r) return true;
  return false;
}

export function waterLevel() { return LAKE.level; }

// ---------------------------------------------------------------------------
// 地形网格
// ---------------------------------------------------------------------------
export function createTerrain(scene) {
  bake();
  const segX = NX - 1, segZ = NZ - 1;
  // 地面网格向四周扩展到远景（超出 BOUNDS 的部分取边缘高度并向远处微降）
  const EXT = 620;
  const sizeX = (BOUNDS.maxX - BOUNDS.minX) + EXT * 2, sizeZ = (BOUNDS.maxZ - BOUNDS.minZ) + EXT * 2;
  const cx = (BOUNDS.minX + BOUNDS.maxX) / 2, cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segX + 40, segZ + 32);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;

  // 顶点高度 + 顶点色（草地/林地/湖岸/土路）
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0xd7e0bd);
  const cForest = new THREE.Color(0x94a878);
  const cShore = new THREE.Color(0xf2e7cc);
  const cLawn = new THREE.Color(0xe6eec4);
  const tmp = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const wx = pos.getX(k) + cx;
    const wz = pos.getZ(k) + cz;
    const out = Math.max(
      (BOUNDS.minX - wx) / EXT, (wx - BOUNDS.maxX) / EXT,
      (BOUNDS.minZ - wz) / EXT, (wz - BOUNDS.maxZ) / EXT, 0
    );
    let h = heightAt(wx, wz);
    if (out > 0) h = h * (1 - Math.min(1, out) * 0.65) - Math.min(1, out) * 6
      + (fbm(wx * 0.004, wz * 0.004, 3, 3) - 0.5) * 14 * Math.min(1, out);
    pos.setY(k, h);

    // 顶点色：森林区域更深，湖岸近处偏土黄
    let forest = 0;
    for (const z2 of TREE_ZONES) {
      const d = Math.sqrt(((wx - z2.x) / z2.rx) ** 2 + ((wz - z2.z) / z2.rz) ** 2);
      if (d < 1) forest = Math.max(forest, (1 - d) * Math.min(1, z2.density * 1.4));
    }
    const shore = clamp(1 - Math.abs(h - (LAKE.level + 0.4)) / 2.2, 0, 1);
    tmp.copy(cGrass).lerp(cForest, forest * 0.85).lerp(cShore, shore * 0.75);
    tmp.lerp(cLawn, 0.12 + 0.1 * valueNoise(wx * 0.01, wz * 0.01, 9));
    if (out > 0) tmp.lerp(new THREE.Color(0xa8b6b0), Math.min(1, out) * 0.8);
    colors[k * 3] = tmp.r; colors[k * 3 + 1] = tmp.g; colors[k * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.98, metalness: 0,
    map: grassTexture(),
  });
  mat.map.repeat.set(620, 490);
  mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
  mat.map.anisotropy = 8;
  // 近地面细节：再叠一张低对比噪声贴图打破重复感
  const det = grassTexture().clone();
  det.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  scene.add(mesh);

  // 水面（晓南湖 + 校内池塘）
  const water = createWater(scene);

  // 校园外部环境：远景山峦 / 环校树林 / 城市街区 / 南湖
  const rim = createSurroundings(scene);

  return { mesh, water, rim, heightAt, normalAt };
}

function createWater(scene) {
  const group = new THREE.Group();
  group.name = 'water';
  const nrm = waterNormalTexture();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x48788a, roughness: 0.30, metalness: 0.05, side: THREE.DoubleSide,
    normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true, opacity: 0.95,
    envMapIntensity: 1.0, clearcoat: 0.25, clearcoatRoughness: 0.35,
  });
  nrm.repeat.set(18, 18);
  // 湖面：按多边形形状
  const shape = new THREE.Shape();
  LAKE.poly.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
  shape.closePath();
  const lakeGeo = new THREE.ShapeGeometry(shape, 12);
  lakeGeo.rotateX(-Math.PI / 2);
  const lake = new THREE.Mesh(lakeGeo, mat);
  lake.position.y = LAKE.level;
  lake.receiveShadow = false;
  lake.name = 'xiaonan-lake';
  group.add(lake);

  // 池塘
  for (const p of LAKE.ponds) {
    const g = new THREE.CircleGeometry(p.r, 26);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(p.x, LAKE.level + 0.05, p.z);
    group.add(m);
  }
  scene.add(group);
  return { group, mat, lake };
}


// ---------------------------------------------------------------------------
// 校园外部环境：远景山峦 + 环校树林带 + 城市街区 + 南湖水面
// 目的：让地图边缘不出现「草地消失在地平线」的破面
// ---------------------------------------------------------------------------
function createSurroundings(scene) {
  const group = new THREE.Group();
  group.name = 'surroundings';
  const rnd = makeRng(CFG.seed + 77);

  // ---- 1. 远景山峦（大气透视：基本色 = 雾色，几乎不受光） ----
  {
    const geo = new THREE.BufferGeometry();
    const verts = [], cols = [];
    const cHaze = new THREE.Color(0xcfdadb);   // 山脊顶部：偏冷灰
    const cHill = new THREE.Color(0x8fa39c);   // 山脚：偏青绿
    const R0 = 1150, R1 = 2100;
    const N = 200;
    const prof = (i) => {
      const a = (i / N) * Math.PI * 2;
      const s1 = Math.sin(a * 3 + 1.2) * 0.5 + Math.sin(a * 7 - 0.6) * 0.28 + Math.sin(a * 13 + 2.1) * 0.14;
      return 0.5 + 0.5 * s1;
    };
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const h0 = 18 + prof(i) * 62, h1 = 18 + prof(i + 1) * 62;
      const p0 = [Math.cos(a0) * R0, -14, Math.sin(a0) * R0];
      const p1 = [Math.cos(a1) * R0, -14, Math.sin(a1) * R0];
      const q0 = [Math.cos(a0) * R1, h0, Math.sin(a0) * R1];
      const q1 = [Math.cos(a1) * R1, h1, Math.sin(a1) * R1];
      verts.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1);
      for (const t of [0, 1, 1, 0, 1, 0]) {
        const c = t ? cHaze : cHill;
        cols.push(c.r, c.g, c.b);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'far-hills';
    mesh.renderOrder = -2;
    group.add(mesh);
  }

  // ---- 2. 环校树林带：把校园边界外的草地挡住 ----
  {
    const parts = [];
    const base = new THREE.BoxGeometry(1, 1, 1);
    const cx0 = (BOUNDS.minX + BOUNDS.maxX) * 0.5, cz0 = (BOUNDS.minZ + BOUNDS.maxZ) * 0.5;
    const rx = (BOUNDS.maxX - BOUNDS.minX) * 0.5, rz = (BOUNDS.maxZ - BOUNDS.minZ) * 0.5;
    for (let i = 0; i < 520; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 1.06 + rnd() * 0.30;
      const x = cx0 + Math.cos(a) * rx * rr;
      const z = cz0 + Math.sin(a) * rz * rr;
      const h = 7 + rnd() * 9;
      const w = 6 + rnd() * 6;
      const g = base.clone();
      g.scale(w, h, w);
      g.translate(x, h / 2 - 1, z);
      parts.push(g);
    }
    const merged = mergeSimple(parts);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4c6238, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'boundary-forest';
    group.add(mesh);
  }

  // ---- 3. 城市街区：校外的多层建筑剪影（光谷一带） ----
  {
    const parts = [];
    const base = new THREE.BoxGeometry(1, 1, 1);
    const cx0 = (BOUNDS.minX + BOUNDS.maxX) * 0.5, cz0 = (BOUNDS.minZ + BOUNDS.maxZ) * 0.5;
    const rx = (BOUNDS.maxX - BOUNDS.minX) * 0.5, rz = (BOUNDS.maxZ - BOUNDS.minZ) * 0.5;
    for (let i = 0; i < 150; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 1.34 + rnd() * 0.62;
      const x = cx0 + Math.cos(a) * rx * rr;
      const z = cz0 + Math.sin(a) * rz * rr;
      const h = 12 + rnd() * 46;
      const w = 14 + rnd() * 26, d = 14 + rnd() * 26;
      const g = base.clone();
      g.scale(w, h, d);
      g.translate(x, h / 2 - 1, z);
      parts.push(g);
    }
    const merged = mergeSimple(parts);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.95, metalness: 0.02, vertexColors: false });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'city-blocks';
    group.add(mesh);
  }

  // ---- 4. 南湖：校园西北方向的天然湖面（远景，纯色 + 轻微反光） ----
  {
    const shape = new THREE.Shape();
    const pts = [
      [-2400, -520], [-1500, -640], [-760, -700], [-180, -690], [180, -760],
      [260, -1120], [-120, -1560], [-760, -1780], [-1620, -1720], [-2320, -1240],
    ];
    pts.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape, 4);
    g.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fa8b4, roughness: 0.22, metalness: 0.1 });
    const lake = new THREE.Mesh(g, mat);
    lake.position.y = LAKE.level - 0.6;
    lake.name = 'nanhu-far';
    group.add(lake);
  }

  scene.add(group);
  return group;
}

// 极简几何合并（同材质、仅 position/normal/uv）
function mergeSimple(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    pos.set(p, vo * 3); nor.set(n, vo * 3);
    const gi = g.index;
    if (gi) {
      for (let i = 0; i < gi.count; i++) idx[io + i] = gi.array[i] + vo;
      io += gi.count;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export default { createTerrain, heightAt, normalAt, inLake, waterLevel };
