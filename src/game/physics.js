import * as CANNON from 'cannon-es';
import { CFG } from '../core/config.js';
import { BOUNDS } from '../world/layout.js';
import { heightAt } from '../world/terrain.js';

// 物理分组：用位掩码决定谁和谁碰
export const GROUP = {
  GROUND: 1,   // 地形 heightfield
  STATIC: 2,   // 建筑/围墙
  CHAR: 4,     // 角色躯干
  PROP: 8,     // 可抓取道具
};

const STEP = 4; // 与 terrain.js 一致的地形网格步长（米）
const NX = Math.round((BOUNDS.maxX - BOUNDS.minX) / STEP) + 1;
const NZ = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / STEP) + 1;
const GX = BOUNDS.minX;
const GZ = BOUNDS.minZ;
const GX1 = GX + (NX - 1) * STEP;
const GZ1 = GZ + (NZ - 1) * STEP;

// 地形高度场：一次性采样，之后全部由 cannon 处理碰撞
function buildHeightfield(matGround) {
  const data = new Array(NX);
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < NX; i++) {
    const x = GX + i * STEP;
    const col = new Array(NZ);
    for (let j = 0; j < NZ; j++) {
      const h = heightAt(x, GZ1 - j * STEP);
      col[j] = h;
      if (h < minValue) minValue = h;
      if (h > maxValue) maxValue = h;
    }
    data[i] = col;
  }
  const shape = new CANNON.Heightfield(data, { elementSize: STEP, minValue, maxValue });
  const body = new CANNON.Body({
    mass: 0,
    material: matGround,
    type: CANNON.Body.STATIC,
    collisionFilterGroup: GROUP.GROUND,
  });
  body.addShape(shape);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.position.set(GX, 0, GZ1);
  body.userData = { kind: 'terrain' };
  return { body, shape, minValue, maxValue };
}

export function createPhysics(world = {}) {
  const w = new CANNON.World({
    gravity: new CANNON.Vec3(0, CFG.physics.gravity, 0),
    allowSleep: true,
  });
  w.broadphase = new CANNON.SAPBroadphase(w);
  w.solver.iterations = 8;
  w.solver.tolerance = 0.001;
  w.quatNormalizeSkip = 2;
  w.quatNormalizeFast = true;
  w.defaultContactMaterial.friction = 0.4;
  w.defaultContactMaterial.restitution = 0;
  w.defaultContactMaterial.contactEquationStiffness = 1e7;
  w.defaultContactMaterial.contactEquationRelaxation = 3;

  const mats = {
    ground: new CANNON.Material('ground'),
    statik: new CANNON.Material('static'),
    char: new CANNON.Material('char'),
    prop: new CANNON.Material('prop'),
  };
  const cm = (a, b, friction, restitution = 0) => {
    w.addContactMaterial(new CANNON.ContactMaterial(a, b, {
      friction, restitution, contactEquationStiffness: 1e7,
    }));
  };
  // 角色与地形：低摩擦（由控制器主动驱动速度），否则多接触点摩擦会吃光移动速度
  cm(mats.ground, mats.char, 0.03);
  cm(mats.ground, mats.prop, 0.5, 0.02);
  cm(mats.statik, mats.char, 0.12);
  cm(mats.statik, mats.prop, 0.35);
  cm(mats.char, mats.prop, 0.35);
  cm(mats.prop, mats.prop, 0.4, 0.05);

  const terrain = buildHeightfield(mats.ground);
  w.addBody(terrain.body);

  const colliders = []; // 供相机/攀爬使用的静态盒信息

  function addStaticBox(box) {
    const width = Math.max(0.05, box.w || 1);
    const depth = Math.max(0.05, box.d || 1);
    const height = Math.max(0.05, box.h || 1);
    const base = box.y != null ? box.y : heightAt(box.x, box.z);
    const rot = box.rot || 0;
    const body = new CANNON.Body({
      mass: 0,
      material: mats.statik,
      type: CANNON.Body.STATIC,
      collisionFilterGroup: GROUP.STATIC,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)));
    body.position.set(box.x, base + height / 2, box.z);
    body.quaternion.setFromEuler(0, rot, 0);
    const info = {
      x: box.x, z: box.z, w: width, d: depth, h: height,
      base, top: base + height, rot,
      name: box.name || '',
    };
    body.userData = { kind: 'static', collider: info };
    w.addBody(body);
    colliders.push(info);
    return body;
  }

  // 建筑 AABB 盒（相对地面抬高 h/2，与 buildings.js 保持一致）
  for (const c of world.colliders || []) {
    if (!c || !isFinite(c.x) || !isFinite(c.z) || !(c.w > 0) || !(c.d > 0) || !(c.h > 0)) continue;
    addStaticBox({ ...c, name: c.name || 'building' });
  }

  // 场界围墙（防止掉出地形）
  const spanX = GX1 - GX + 8;
  const spanZ = GZ1 - GZ + 8;
  const wallH = 80;
  const walls = [
    { x: GX - 2, z: (GZ + GZ1) / 2, w: 4, d: spanZ, h: wallH, y: 20, name: 'boundary' },
    { x: GX1 + 2, z: (GZ + GZ1) / 2, w: 4, d: spanZ, h: wallH, y: 20, name: 'boundary' },
    { x: (GX + GX1) / 2, z: GZ - 2, w: spanX, d: 4, h: wallH, y: 20, name: 'boundary' },
    { x: (GX + GX1) / 2, z: GZ1 + 2, w: spanX, d: 4, h: wallH, y: 20, name: 'boundary' },
  ];
  for (const b of walls) addStaticBox(b);

  // 射线的共享结果（避免每帧分配）
  const _ray = new CANNON.RaycastResult();
  const _from = new CANNON.Vec3();
  const _to = new CANNON.Vec3();

  function ray(from, to, mask = -1) {
    _from.set(from.x, from.y, from.z);
    _to.set(to.x, to.y, to.z);
    _ray.reset();
    w.raycastClosest(_from, _to, { collisionFilterMask: mask, skipBackfaces: true }, _ray);
    if (!_ray.hasHit) return null;
    const p = _ray.hitPointWorld;
    const n = _ray.hitNormalWorld;
    return {
      point: { x: p.x, y: p.y, z: p.z },
      normal: { x: n.x, y: n.y, z: n.z },
      body: _ray.body,
      shape: _ray.shape,
      distance: _ray.distance,
    };
  }

  function rayAll(from, to, mask = -1, out = []) {
    out.length = 0;
    _from.set(from.x, from.y, from.z);
    _to.set(to.x, to.y, to.z);
    w.raycastAll(_from, _to, { collisionFilterMask: mask, skipBackfaces: true }, (res) => {
      if (!res.hasHit) return;
      const p = res.hitPointWorld;
      out.push({
        point: { x: p.x, y: p.y, z: p.z },
        normal: { x: res.hitNormalWorld.x, y: res.hitNormalWorld.y, z: res.hitNormalWorld.z },
        body: res.body,
        distance: Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z),
      });
    });
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  /** 查询脚下地面（地形或建筑屋顶），返回世界 y */
  function groundAt(x, z) {
    return heightAt(x, z);
  }

  /** 世界射线向下，找脚下最高的表面（含可站立箱体） */
  function surfaceBelow(x, y, z, maxDist = 4) {
    const start = { x, y: y + 0.2, z };
    const hit = ray(start, { x, y: y - maxDist, z }, GROUP.GROUND | GROUP.STATIC | GROUP.PROP);
    if (hit && hit.normal.y > 0.5) return hit.point.y;
    return heightAt(x, z);
  }

  let stepCount = 0;
  function step(dt) {
    if (!(dt > 0)) return;
    const clamped = Math.min(dt, 0.1);
    w.step(CFG.physics.fixedStep, clamped, CFG.physics.maxSubSteps);
    stepCount++;
  }

  const bounds = { minX: GX + 6, maxX: GX1 - 6, minZ: GZ + 6, maxZ: GZ1 - 6 };

  return {
    world: w,
    materials: mats,
    group: GROUP,
    terrain: { minX: GX, maxX: GX1, minZ: GZ, maxZ: GZ1, nx: NX, nz: NZ, step: STEP },
    bounds,
    colliders,
    addStaticBox,
    addBody: (b) => w.addBody(b),
    addConstraint: (c) => w.addConstraint(c),
    removeConstraint: (c) => w.removeConstraint(c),
    ray,
    rayAll,
    groundAt,
    surfaceBelow,
    step,
    get stepCount() { return stepCount; },
    get heightfield() { return terrain.body; },
    heightAt,
  };
}

export default createPhysics;
