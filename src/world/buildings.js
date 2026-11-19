import * as THREE from 'three';
import { BUILDINGS, STYLE_PRESETS } from './layout.js';
import { heightAt } from './terrain.js';
import { tileRoofTexture } from '../core/textures.js';
import { pavingMat } from '../core/materials.js';
import { clamp, makeRng } from '../core/util.js';
import { makeKit, setFrame, setWallTint, setWallPattern, setPhotoMode } from './buildings/parts.js';
import { STYLE_FN, buildDorm } from './buildings/styles.js';
import { facadeTex, signAtlas } from './buildings/facade.js';
import { createParking } from './buildings/parking.js';
import { buildZhongyuan, buildYifu, buildWentai, flushPlanes } from './buildings/photo-accurate.js';
import { FACADE_MAP } from '../assets/facade-data.js';
import { facadeMaterial } from '../core/photoTex.js';

// ---------------------------------------------------------------------------
// 材质：一桶一材质 → 每桶合并成 1 个 mesh。全场建筑 ≈ 12 个 draw call。
// ---------------------------------------------------------------------------
const WALL_KINDS = ['wClassic', 'wModern', 'wLibrary', 'wDorm', 'wGym'];
const FACADE_KIND = {
  wClassic: 'classic', wModern: 'modern', wLibrary: 'library', wDorm: 'dorm', wGym: 'gym',
};

function buildMaterials(atlas) {
  const M = {};
  for (const id of WALL_KINDS) {
    M[id] = new THREE.MeshStandardMaterial({
      map: facadeTex(FACADE_KIND[id]),
      vertexColors: true, roughness: 0.86, metalness: 0.02,
      // 背光面（朝北）只吃半球光会黑成一片 —— 加一点点自发光当作「天空漫射兜底」，
      // 让阴影里的立面仍读得出石材色，而不是变成黑盒子。
      emissive: 0x2a251d, emissiveIntensity: 1.0,
    });
  }
  M.trim = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0.04, emissive: 0x221d17,
  });
  M.stone = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0.02, emissive: 0x201c16,
  });
  M.roof = new THREE.MeshStandardMaterial({
    map: tileRoofTexture(), vertexColors: true, roughness: 0.74, metalness: 0.08,
    emissive: 0x575147, emissiveIntensity: 1.0,
    // 坡屋顶的四边形绕序与盒体相反（法线朝内 → 单面剔除后只剩黑背板）。
    // 用双面材质：three 对背面会自动翻转法线，光照正确，且省掉重算几何。
    side: THREE.DoubleSide,
  });
  // 场景没有环境贴图：roughness 太低 → 只有太阳一个高光点，整片玻璃全黑。
  // 用偏亮的蓝灰 + 中等 roughness，靠半球光读出「反天光」的观感。
  M.glass = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.34, metalness: 0.06,
    emissive: 0x1d2f3e, emissiveIntensity: 1.0,
  });
  // 场景没有环境贴图，metalness 高会发黑 —— 压到 0.1 左右，靠颜色和粗糙度区分
  M.metal = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.52, metalness: 0.10, emissive: 0x211d18,
  });
  M.flat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
  M.sign = new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.8, metalness: 0.0 });
  M.paving = pavingMat(0xcfc8ba);
  M.paving.polygonOffset = true;
  M.paving.polygonOffsetFactor = -2;
  M.paving.polygonOffsetUnits = -4;
  return M;
}

// ---------------------------------------------------------------------------
// 落地：取占地范围的最低地面，勒脚再下沉 1.2m，避免悬空/穿地
// ---------------------------------------------------------------------------
export function groundUnder(x, z, w, d, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  let mn = Infinity;
  const pts = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [ax, az] of pts) {
    const lx = (ax * w) / 2, lz = (az * d) / 2;
    const gx = x + c * lx + s * lz;
    const gz = z - s * lx + c * lz;
    const h = heightAt(gx, gz);
    if (h < mn) mn = h;
  }
  return Number.isFinite(mn) ? mn : heightAt(x, z);
}

// ---------------------------------------------------------------------------
// 建筑周边硬质铺装裙边（避免楼直接插在草地里）
// 注意：必须写**局部坐标** —— GeoBuilder 会再套上 setFrame 的平移/旋转，
// 早期版本这里传了世界坐标，导致铺装被偏移了两倍距离、飘在草地上。
// ---------------------------------------------------------------------------
let _apIdx = 0;
function apron(K, x, z, w, d, ry, gy) {
  const dy = -0.07 - (_apIdx % 37) * 0.0016;
  _apIdx++;
  // 主裙边：楼四周各出挑 3.5m
  K.paving.box(w + 7, 0.12, d + 7, { y: dy, color: 0xbdb6a8, uvM: [4, 4], shade: false });
  // 入口前步道（局部 +z 就是正立面方向）
  K.paving.box(9, 0.12, 12, { y: dy + 0.004, z: d / 2 + 8, color: 0xc2bbad, uvM: [4, 4], shade: false });
}

// ---------------------------------------------------------------------------
// 入口朝向：朝校园中心（五羊广场）一侧开门
// ---------------------------------------------------------------------------
function facingFlip(z) { return z > 10 ? Math.PI : 0; }

// ---------------------------------------------------------------------------
// 每栋楼各自的墙体染色 + 立面纹理相位偏移
// 同一种 style 共用一张立面贴图，如果染色/相位全一样，一眼就能看出是复制的。
// 这里给 0.84~1.0 的亮度 + 轻微冷暖偏差（顶点色乘在 sRGB 贴图上），
// 再随机错开半格以内的 uv，让窗格不对齐 → 每栋楼读起来都不一样。
// ---------------------------------------------------------------------------
const _rndT = makeRng(9182);
function wallTintFor() {
  const k = 0.84 + _rndT() * 0.16;
  const warm = _rndT() < 0.5;
  const r = Math.round(255 * k * (warm ? 1.0 : 0.965));
  const g = Math.round(255 * k * 0.988);
  const b = Math.round(255 * k * (warm ? 0.935 : 1.0));
  return (clamp(r, 0, 255) << 16) | (clamp(g, 0, 255) << 8) | clamp(b, 0, 255);
}
function wallPhaseFor() {
  setWallPattern(_rndT.range(0, 1), _rndT.int(0, 1) ? 0.5 : 0);
}

// ---------------------------------------------------------------------------
// 实拍立面：命中的楼 → 私有 kit + 独立材质/网格（+1 draw call/栋）；
// 未命中 → 完全走原来的共享材质桶，观感与 draw call 都不变。
// ---------------------------------------------------------------------------
const PHOTO_SET = new Set(Object.keys(FACADE_MAP));
// 照片楼里只有「墙面」需要独立材质；这些桶并回共享桶，零额外 draw call
const PHOTO_SHARED = ['trim', 'stone', 'roof', 'glass', 'metal', 'flat', 'sign', 'paving'];
// style → 该 style 原本写墙面的桶（照片贴图不可用时并回这里）
const STYLE_WALL = {
  classic: 'wClassic', modern: 'wModern', office: 'wModern', library: 'wLibrary',
  dorm: 'wDorm', gym: 'wGym', hall: 'wModern', canteen: 'wModern',
  museum: 'wClassic', market: 'wModern',
};
// 少数楼实测层高与 STYLE_PRESETS 不同（照片校核轮的实测值）
const PHOTO_FLOOR_H = { 逸夫图书馆: 4.85, 文泰楼: 3.85, 中原楼: 3.9 };
// 开间宽定点覆盖：中原楼是 7 段折面，每段 17.4m = 3 开间 × 5.8m，正好一张瓦片，
// 段与段之间才不会在弧面上露出半格接缝（不能按整栋 96m 去凑整除）。
const PHOTO_BAY = { 中原楼: 5.8 };
// 逐楼「观感校正」：体育中心瓦片偏亮 + 正南直射，向阳面接近过曝 →
// tint 压 15%（0xd8d8d8≈0.85），并把补光按 0.9→0.5 的比例压到 0.17*0.5/0.9≈0.09。
const PHOTO_LOOK = {
  // 体育中心：南面被太阳直射会糊成一片白，北面又发闷。压低受光项（albedo）
  // 并把照片本身抬成主光源（emissiveIntensity），让两个朝向都读得出墙面细节。
  体育中心: { albedo: 0x6a6a6a, emissiveIntensity: 0.62 },
};

/** 只有「真照片」才接入：confidence high/mid 且瓦片本身带窗（非 flat 色带） */
function photoEligible(m) {
  if (!m) return false;
  const conf = m.confidence || 'mid';
  return m.kind !== 'flat' && (conf === 'high' || conf === 'mid');
}

function photoKitFor(b, st) {
  if (!b || !b.name || !PHOTO_SET.has(b.name)) return null;
  if (b.group && b.cells) return null; // 公寓组团：多单元共用一个网格，不拆
  const m = FACADE_MAP[b.name];
  if (!photoEligible(m)) return null; // low/flat → 保留程序化立面（有窗格节奏）
  const bays = Math.max(1, m.baysPerTile || 1);
  const floors = Math.max(1, m.floorsPerTile || 1);
  const bay0 = clamp(st.bay || 5.6, 5, 6); // 开间宽取 5–6m
  // 让贴图在正立面上「整除」：转角处不切半个窗，缝落在开间线上。
  const nTile = Math.max(1, Math.round((b.w || 30) / (bays * bay0)));
  let bayW = (b.w || 30) / (bays * nTile);
  if (!(bayW >= 4.6 && bayW <= 6.6)) bayW = bay0; // 出了合理开间就退回标称值
  if (PHOTO_BAY[b.name]) bayW = PHOTO_BAY[b.name];
  const floorH = PHOTO_FLOOR_H[b.name] || st.floorH || 4;
  const K = makeKit(['wPhoto', 'paving'], {
    wallAlias: 'wPhoto',
    wallUv: [bayW * bays, floorH * floors], // 一贴图 = bays 开间 × floors 层
  });
  // 瓦片本身带窗（band/bay）→ 关掉几何假窗带；flat 永远不会走到这里
  const windows = m.kind === 'band' || m.kind === 'bay';
  return { K, name: b.name, bayW, floorH, windows, fallbackWall: STYLE_WALL[b.style] || 'wModern' };
}

/** 私有 kit → 1 个独立墙面 mesh（实拍材质）；其余桶并回共享桶 */
function emitPhoto(photo, group, meshes, K) {
  const wb = photo.K.wPhoto;
  let mat = null;
  try { mat = facadeMaterial(photo.name, PHOTO_LOOK[photo.name] || {}); } catch (e) { mat = null; }
  if (wb && !wb.empty) {
    if (mat) {
      const mesh = new THREE.Mesh(wb.build(), mat);
      mesh.name = 'bld-photo-' + photo.name;
      // 实拍墙面不投影：几何是世界坐标 + matrixAutoUpdate=false，投影阶段会
      // 变成一个横跨全场的大遮挡体，把整片广场压成阴影（实测：只开这一栋的
      // castShadow 就能让五羊广场整块变暗）。楼体本身在 wClassic/wModern 等
      // 共享桶里已经投过影了，这里关掉不会丢影子。
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes.push(mesh);
    } else {
      // 兜底：贴图缺失/解码失败 → 墙面并回通用窗格材质，绝不留白屏或黑块
      K[photo.fallbackWall].absorb(wb);
    }
  }
  for (const id of PHOTO_SHARED) {
    const g = photo.K[id];
    if (g && !g.empty) K[id].absorb(g);
  }
}

// 收集所有要挂牌子的名字（一张图集 → 1 个 draw call）
function collectNames() {
  const names = [];
  for (const b of BUILDINGS) {
    if (b.group && b.cells) { if (b.name) names.push(b.name); continue; }
    if (b.name) names.push(b.name);
  }
  return Array.from(new Set(names));
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
export function createBuildings(scene, ctx = {}) {
  const group = new THREE.Group();
  group.name = 'buildings';

  const atlas = signAtlas(collectNames());
  const K = makeKit(['paving']);
  const colliders = [];
  const dormBoxes = []; // 供 collider 用
  const meshes = [];    // 照片楼的独立墙面 mesh 在循环里就加进来，共享桶的在循环后合并

  for (const b of BUILDINGS) {
    const st = STYLE_PRESETS[b.style] || STYLE_PRESETS.modern;
    setWallTint(wallTintFor());
    wallPhaseFor();

    // ---- 公寓区：group + cells，一套重复单元 ----
    if (b.group && b.cells) {
      const floors = b.floors || 6;
      const cw = b.w || 30, cd = b.d || 14;
      const seen = [];
      for (const cell of b.cells) {
        const [cx, cz] = cell;
        if (seen.some((p) => Math.abs(p[0] - cx) < 9 && Math.abs(p[1] - cz) < 9)) continue;
        seen.push(cell);
        const ry = facingFlip(cz);
        const gy = groundUnder(cx, cz, cw, cd, ry);
        setFrame(K, cx, gy + 0.03, cz, ry);
        apron(K, cx, cz, cw, cd, ry, gy);
        buildDorm(K, cx, cz, {
          w: cw, d: cd, floors,
          name: b.cells.length === seen.length ? b.name : null,
        });
        dormBoxes.push({ x: cx, z: cz, w: cw, d: cd, h: floors * 3.2 + 1.2, rot: ry });
      }
      continue;
    }

    // ---- 独立建筑 ----
    const w = b.w, d = b.d, h = b.h;
    const rot = b.rot || 0;
    const ry = rot + facingFlip(b.z);
    const gy = groundUnder(b.x, b.z, w, d, ry);
    // 命中实拍立面的楼：整栋换私有 kit（墙面单独成 mesh + 专属贴图）
    const photo = photoKitFor(b, st);
    const Kb = photo ? photo.K : K;
    setFrame(Kb, b.x, gy + 0.03, b.z, ry);
    apron(Kb, b.x, b.z, w, d, ry, gy);
    if (photo) setPhotoMode(photo.windows);

    if (b.style === 'dorm') {
      const floors = Math.max(3, Math.round(h / 3.2));
      buildDorm(Kb, b.x, b.z, { w: Math.max(w, 26), d: Math.max(d, 13), floors, name: b.name });
      if (photo) { setPhotoMode(false); emitPhoto(photo, group, meshes, K); }
      colliders.push({ x: b.x, z: b.z, w: Math.max(w, 26), d: Math.max(d, 13), h, rot: ry });
      continue;
    }

    // 照片校核轮：两栋楼按实拍重做特征形体（work/real-photos/analysis.md）
    const frame = { x: b.x, y: gy + 0.03, z: b.z, ry };
    const fn = b.name === '中原楼' ? buildZhongyuan
      : b.name === '文泰楼' ? buildWentai
      : b.name === '逸夫图书馆' ? buildYifu
      : (STYLE_FN[b.style] || STYLE_FN.modern);
    try {
      fn(Kb, b, st, frame);
    } catch (e) {
      // 单栋失败不能拖垮整场（契约：不得抛异常）
      console.warn('[buildings] 生成失败', b.name, e);
      Kb.stone.box(w, h, d, { y: 0, color: 0xcac3b5 });
    }
    if (photo) { setPhotoMode(false); emitPhoto(photo, group, meshes, K); }
    colliders.push({ x: b.x, z: b.z, w, d, h, rot: ry });
  }

  // ---- 校园连廊：把相邻教学楼在 2 层高处架空连起来（财大高识别度特征）----
  // 只用已有桶（metal 栏杆/玻璃栏板/trim 楼板与顶板），不新增 draw call。
  const LINKS = [
    { a: [260, 3], b: [342, 37], wa: [74, 42], wb: [78, 40], w: 4.6 },     // 文泓楼 — 文治楼
    { a: [299, 96], b: [350, 120], wa: [58, 36], wb: [54, 34], w: 4.4 },   // 文清楼 — 文湛楼
    { a: [-238, 64], b: [-243, 170], wa: [132, 56], wb: [96, 52], w: 5.0 }, // 文泰楼 — 中原楼
  ];
  // 中心点到轴对齐盒边界沿单位方向的出射距离
  const exitDist = (w, d, ux, uz) => Math.min(
    Math.abs(ux) < 1e-4 ? Infinity : (w / 2) / Math.abs(ux),
    Math.abs(uz) < 1e-4 ? Infinity : (d / 2) / Math.abs(uz),
  );
  for (const L of LINKS) {
    try {
      const [x1, z1] = L.a, [x2, z2] = L.b;
      let dx = x2 - x1, dz = z2 - z1;
      const dist = Math.hypot(dx, dz) || 1;
      const ux = dx / dist, uz = dz / dist;
      // 从各自外墙起算，连廊两端正好「插进」两栋楼，不会悬空
      const sx = x1 + ux * (exitDist(L.wa[0], L.wa[1], ux, uz) - 1.2);
      const sz = z1 + uz * (exitDist(L.wa[0], L.wa[1], ux, uz) - 1.2);
      const ex = x2 - ux * (exitDist(L.wb[0], L.wb[1], ux, uz) - 1.2);
      const ez = z2 - uz * (exitDist(L.wb[0], L.wb[1], ux, uz) - 1.2);
      dx = ex - sx; dz = ez - sz;
      const len = Math.hypot(dx, dz);
      if (len < 8) continue;
      const ry = Math.atan2(dx, dz);       // 局部 +z 指向 b
      const cx = (sx + ex) / 2, cz = (sz + ez) / 2;
      const gy = groundUnder(cx, cz, len, L.w, ry);
      const deckY = 8.4;                   // 2 层标高
      setFrame(K, cx, gy + 0.03, cz, ry);
      // 楼板 + 顶板
      K.trim.box(L.w, 0.55, len, { y: deckY, color: 0xd6cfbe });
      K.trim.box(L.w + 0.5, 0.3, len, { y: deckY - 0.3, color: 0xb9b1a0 });
      K.trim.box(L.w, 0.5, len, { y: deckY + 3.5, color: 0xded7c6 });
      K.trim.box(L.w + 0.6, 0.28, len, { y: deckY + 4.0, color: 0xb3ab9a });
      // 玻璃栏板（两侧）+ 扶手
      for (const s of [-1, 1]) {
        K.glass.box(0.1, 1.05, len - 1.2, { x: s * (L.w / 2 - 0.16), y: deckY + 0.55, color: 0x9cb8c6 });
        K.metal.box(0.12, 0.1, len - 1.2, { x: s * (L.w / 2 - 0.16), y: deckY + 0.55, color: 0xa8b0b4 });
        K.metal.box(0.14, 0.14, len, { x: s * (L.w / 2 - 0.16), y: deckY + 1.6, color: 0x9aa2a6 });
      }
      // 架空柱：每 8m 一组，两柱 + 横梁
      const nCol = Math.max(1, Math.round(len / 8));
      for (let i = 1; i < nCol; i++) {
        const pz = -len / 2 + (len * i) / nCol;
        for (const s of [-1, 1]) {
          K.metal.box(0.62, deckY, 0.62, { x: s * (L.w / 2 - 0.5), y: 0, z: pz, color: 0xb4b0a4 });
        }
        K.trim.box(L.w, 0.42, 0.5, { y: deckY - 0.72, z: pz, color: 0xcac2b1 });
      }
      // 廊内吊顶灯带（连续的一条暖色）
      K.trim.box(L.w - 1.6, 0.12, len - 2, { y: deckY + 3.42, color: 0xe8e2d4 });
    } catch (e) {
      console.warn('[buildings] 连廊生成失败', e);
    }
  }

  // ---- 合桶 → mesh ----
  const M = buildMaterials(atlas);
  for (const id of Object.keys(K)) {
    const gb = K[id];
    if (!gb || gb.empty) continue;
    const geo = gb.build();
    const mesh = new THREE.Mesh(geo, M[id]);
    mesh.name = 'bld-' + id;
    const isBody = WALL_KINDS.includes(id) || id === 'roof';
    mesh.castShadow = isBody;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push(mesh);
  }

  scene.add(group);
  createParking(scene); // 共享电驴停放区（项 2）
  flushPlanes(scene);   // 照片校核金字/招牌 plane
  return { group, meshes, colliders: colliders.concat(dormBoxes), bounds: null };
}

export function collectColliders() {
  const list = [];
  for (const b of BUILDINGS) {
    if (b.group && b.cells) {
      for (const c of b.cells) list.push({ x: c[0], z: c[1], w: b.w || 30, d: b.d || 14, h: (b.floors || 6) * 3.2 });
      continue;
    }
    list.push({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, rot: b.rot || 0 });
  }
  return list;
}
