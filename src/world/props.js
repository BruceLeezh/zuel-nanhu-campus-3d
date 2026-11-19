// 场景植被与街具总装：树 / 灌木绿篱花坛 / 街具 / 体育设施 / 可抓物 / 交互点。
// 返回 { group, colliders, interactables, grabbables }。
//   colliders:    [{ type:'box', x,z, w,d,h, rot? } | { type:'cyl', x,z, r,h }]
//   interactables:[{ x,z, y, radius, label, action }]
//   grabbables:   [{ mesh, x,y,z, radius, mass, label }]
import * as THREE from 'three';
import { GATES, SPORTS } from './layout.js';
import { heightAt } from './terrain.js';
import { GeoBuilder, icoGeo } from './props/merge.js';
import { propMaterials, insideCampus, SEED } from './props/shared.js';
import { createTrees } from './props/trees.js';
import { createGreen } from './props/green.js';
import { createStreet } from './props/street.js';
import { createSports } from './props/sports.js';
import { makeRng } from '../core/util.js';

// ---------------------------------------------------------------- 可抓小道具
function coneMesh(rnd) {
  const b = new GeoBuilder('cone');
  b.addCyl(0.035, 0.15, 0.6, {
    seg: 8, color: 0xd8541f,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 0.34, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
  });
  b.addCyl(0.115, 0.13, 0.1, {
    seg: 8, color: 0xf2efe4,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 0.36, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
  });
  b.addBox(0.34, 0.05, 0.34, { x: 0, y: 0.025, z: 0, color: 0xb84414 });
  void rnd;
  return b.build();
}

function boxMesh(rnd, w, h, d) {
  const b = new GeoBuilder('carton');
  b.addBox(w, h, d, { x: 0, y: h / 2, z: 0, color: 0xa9814f, jitter: 0.06 });
  // 胶带
  b.addBox(w * 1.01, 0.02, 0.09, { x: 0, y: h, z: 0, color: 0xd8cdb2 });
  b.addBox(0.09, 0.02, d * 1.01, { x: 0, y: h, z: 0, color: 0xd8cdb2 });
  void rnd;
  return b.build();
}

function addGrabbables(ctx, rnd) {
  const mats = propMaterials();
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 });
  // 路锥
  const coneGeo = coneMesh(rnd);
  const coneSpots = [
    [410, -500], [418, -496], [402, -492], [-88, 528], [96, 30], [-296, 342],
    [300, -462], [180, -84],
  ];
  let cones = 0;
  for (const [x, z] of coneSpots) {
    if (!insideCampus(x, z, 3)) continue;
    const m = new THREE.Mesh(coneGeo, propMat);
    const gy = heightAt(x, z);
    m.position.set(x + (rnd() - 0.5) * 1.2, gy, z + (rnd() - 0.5) * 1.2);
    m.rotation.y = rnd() * 6.28;
    m.name = 'traffic-cone';
    m.castShadow = true;
    ctx.group.add(m);
    ctx.grabbables.push({
      mesh: m, x: m.position.x, y: m.position.y + 0.3, z: m.position.z,
      radius: 0.3, mass: 2.5, label: '路锥',
    });
    cones++;
  }
  // 纸箱（含堆叠）
  const cartonSpots = [
    [-32, 38, 0.6, 0.5, 0.6], [-34.2, 37.4, 0.45, 0.4, 0.45],
    [560, 300, 0.7, 0.55, 0.7], [298, 188, 0.5, 0.45, 0.5],
    [-198, 118, 0.62, 0.5, 0.55], [420, 470, 0.55, 0.42, 0.55],
  ];
  let boxes = 0;
  for (const [x, z, w, h, d] of cartonSpots) {
    if (!insideCampus(x, z, 3)) continue;
    const m = new THREE.Mesh(boxMesh(rnd, w, h, d), propMat);
    m.position.set(x, heightAt(x, z), z);
    m.rotation.y = rnd() * 6.28;
    m.name = 'carton';
    m.castShadow = true;
    ctx.group.add(m);
    ctx.grabbables.push({
      mesh: m, x: m.position.x, y: m.position.y + h / 2, z: m.position.z,
      radius: Math.max(w, d) * 0.8, mass: 1.6, label: '纸箱',
    });
    boxes++;
  }
  void mats;
  return { cones, boxes };
}

// ---------------------------------------------------------------- 总装
export function createProps(scene, ctxOptions = {}) {
  const group = new THREE.Group();
  group.name = 'props';
  const rnd = makeRng((SEED ^ 0x9e3779b9) >>> 0);
  const colliders = [];
  const interactables = [];
  const grabbables = [];
  const ctx = { group, colliders, interactables, grabbables, gates: GATES, rnd, scene };

  const stats = {};
  const safe = (name, fn) => {
    try {
      stats[name] = fn();
    } catch (err) {
      console.error('[props] ' + name + ' 构建失败：', err);
      stats[name] = null;
    }
  };

  safe('trees', () => createTrees(ctx));
  safe('green', () => createGreen(ctx));
  safe('street', () => createStreet(ctx));
  safe('sports', () => createSports(ctx));
  safe('grabbables', () => addGrabbables(ctx, rnd));

  // 统计（解析式：三角形 = 几何三角数 × 实例数；draw call ≈ 新增 mesh 数）
  let tris = 0, meshes = 0, instanced = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    if (!g) return;
    const tri = g.userData.tris || (g.index ? g.index.count / 3 : g.attributes.position ? g.attributes.position.count / 3 : 0);
    if (o.isInstancedMesh) {
      instanced++;
      // 近景树初始 count=0，用容量估算“最坏情况”；其余用实际实例数
      const nearTree = o.name.startsWith('trees-near-');
      const n = nearTree && o.instanceMatrix ? o.instanceMatrix.count : o.count;
      tris += tri * n;
    } else {
      tris += tri;
    }
  });
  const detail = {
    trees: stats.trees ? { count: stats.trees.count, byFlag: stats.trees.byFlag } : null,
    green: stats.green || null,
    street: stats.street || null,
    sports: stats.sports || null,
    grabbables: stats.grabbables || null,
  };
  const info = {
    trees: stats.trees && stats.trees.count,
    meshes,
    instanced,
    tris: Math.round(tris),
    colliders: colliders.length,
    interactables: interactables.length,
    grabbables: grabbables.length,
    detail,
  };
  if (typeof window !== 'undefined') {
    window.__propsInfo = info;
    const logIt = () => {
      try {
        if (stats.trees && stats.trees.stats) info.lod = stats.trees.stats();
        console.log('[props]', JSON.stringify(info));
      } catch (e) { /* ignore */ }
    };
    logIt();
    setTimeout(logIt, 1500);
  }

  scene.add(group);
  return { group, colliders, interactables, grabbables, info };
}

export default { createProps };
