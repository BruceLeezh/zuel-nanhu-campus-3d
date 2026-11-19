import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CFG } from '../core/config.js';
import { heightAt } from '../world/terrain.js';
import { GROUP } from './physics.js';

// ============================================================================
//  抓取系统：E 用视线选最近可抓物 → 弹簧手把物体拉到胸前；再按 E 松开/扔出
//  - 用自己的 12 个占位道具（篮球/木箱/油桶/锥桶/纸箱），程序化材质
//  - 若 world.grabbables 已有 {mesh, body}（场景同学提供）则一并注册
// ============================================================================

const REACH = CFG.player.grabReach;
const HOLD_FORCE = 520;

function propMaterials() {
  return {
    ball: new THREE.MeshStandardMaterial({ color: 0xd9792e, roughness: 0.82 }),
    ballLine: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x9b6b3e, roughness: 0.95 }),
    crateEdge: new THREE.MeshStandardMaterial({ color: 0x6f4826, roughness: 0.95 }),
    drum: new THREE.MeshStandardMaterial({ color: 0x2f5f9e, roughness: 0.55, metalness: 0.35 }),
    drumRing: new THREE.MeshStandardMaterial({ color: 0x223f66, roughness: 0.6, metalness: 0.4 }),
    cone: new THREE.MeshStandardMaterial({ color: 0xe2622a, roughness: 0.85 }),
    coneStripe: new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.7 }),
    box: new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.98 }),
  };
}

export function createGrabSystem(scene, world, physics, ctx) {
  const MAT = propMaterials();
  const items = [];
  const external = Array.isArray(world.grabbables) ? world.grabbables.slice() : [];

  const tempEye = new THREE.Vector3();
  const tempAim = new THREE.Vector3();
  const tempTarget = new THREE.Vector3();
  const tempVel = new THREE.Vector3();

  let holding = false;
  let held = null;
  let heldMask = -1;
  let constraint = null;

  // 运动学锚点（胸前）
  const anchor = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    collisionFilterGroup: 0,
    collisionFilterMask: 0,
  });
  anchor.addShape(new CANNON.Sphere(0.09));
  anchor.collisionResponse = false;
  anchor.allowSleep = false;
  anchor.position.set(0, -50, 0);
  anchor.userData = { kind: 'grabAnchor' };
  physics.addBody(anchor);

  function groundY(x, z) {
    return heightAt(x, z);
  }

  function addItem(mesh, body, label) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(body.position.x, body.position.y, body.position.z);
    scene.add(mesh);
    body.material = physics.materials.prop;
    body.linearDamping = 0.06;
    body.angularDamping = 0.22;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.18;
    body.sleepTimeLimit = 1.2;
    body.userData = { kind: 'prop', grabbable: true, label: label || 'prop' };
    physics.addBody(body);
    const item = { mesh, body, label };
    items.push(item);
    return item;
  }

  // ---------------------------------------------------------------- 占位道具
  function makeBall(x, z) {
    const r = 0.27;
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), MAT.ball);
    ball.castShadow = true;
    ball.receiveShadow = true;
    g.add(ball);
    const ringGeo = new THREE.TorusGeometry(r * 1.002, 0.012, 6, 24);
    const r1 = new THREE.Mesh(ringGeo, MAT.ballLine);
    r1.rotation.x = Math.PI / 2;
    const r2 = new THREE.Mesh(ringGeo, MAT.ballLine);
    r2.rotation.y = Math.PI / 2;
    g.add(r1, r2);
    const body = new CANNON.Body({ mass: 1.2, material: physics.materials.prop });
    body.addShape(new CANNON.Sphere(r));
    body.position.set(x, groundY(x, z) + r + 0.02, z);
    return addItem(g, body, '篮球');
  }

  function makeCrate(x, z) {
    const s = 0.55;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), MAT.crate);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    const edgeGeo = new THREE.BoxGeometry(s * 1.01, 0.05, 0.05);
    for (const y of [-s * 0.34, s * 0.34]) {
      for (const zz of [-s / 2, s / 2]) {
        const m = new THREE.Mesh(edgeGeo, MAT.crateEdge);
        m.position.set(0, y, zz);
        g.add(m);
      }
    }
    const body = new CANNON.Body({ mass: 6, material: physics.materials.prop });
    body.addShape(new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)));
    body.position.set(x, groundY(x, z) + s / 2 + 0.02, z);
    return addItem(g, body, '木箱');
  }

  function makeDrum(x, z) {
    const r = 0.28, h = 0.8;
    const g = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), MAT.drum);
    drum.castShadow = true;
    drum.receiveShadow = true;
    g.add(drum);
    const ringGeo = new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.05, 14);
    for (const y of [-h * 0.3, h * 0.3]) {
      const ring = new THREE.Mesh(ringGeo, MAT.drumRing);
      ring.position.y = y;
      g.add(ring);
    }
    const body = new CANNON.Body({ mass: 8, material: physics.materials.prop });
    body.addShape(new CANNON.Cylinder(r, r, h, 12));
    body.position.set(x, groundY(x, z) + h / 2 + 0.02, z);
    return addItem(g, body, '油桶');
  }

  function makeCone(x, z) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 12), MAT.cone);
    cone.position.y = 0.06;
    cone.castShadow = true;
    g.add(cone);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.1, 12), MAT.coneStripe);
    stripe.position.y = 0.05;
    g.add(stripe);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), MAT.cone);
    base.position.y = -0.24;
    base.castShadow = true;
    g.add(base);
    const body = new CANNON.Body({ mass: 1.5, material: physics.materials.prop });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.17, 0.28, 0.17)));
    body.position.set(x, groundY(x, z) + 0.30, z);
    return addItem(g, body, '锥桶');
  }

  function makeBox(x, z) {
    const s = 0.45;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.85, s), MAT.box);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const body = new CANNON.Body({ mass: 2, material: physics.materials.prop });
    body.addShape(new CANNON.Box(new CANNON.Vec3(s / 2, s * 0.425, s / 2)));
    body.position.set(x, groundY(x, z) + s * 0.425 + 0.02, z);
    return addItem(mesh, body, '纸箱');
  }

  // 广场与主路附近散布（出生点正前方留一个便于测试抓取）
  makeBall(1.0, 16.5);
  makeCrate(3.4, 14.8);
  makeDrum(-3.6, 15.2);
  makeCone(5.2, 12.5);
  makeBox(-5.0, 12.0);
  makeBall(6.5, 7.0);
  makeCrate(-7.0, 6.0);
  makeDrum(9.0, 2.0);
  makeBall(-10.0, -2.0);
  makeBox(12.0, -3.5);
  makeCone(-12.5, -6.0);
  makeCrate(15.0, -9.0);

  // 注册场景同学提供的可抓物（约定 {mesh, body}）
  for (const e of external) {
    try {
      if (!e || !e.mesh || !e.body) continue;
      if (items.some((it) => it.body === e.body)) continue;
      e.body.material = physics.materials.prop;
      e.body.userData = Object.assign({ kind: 'prop', grabbable: true }, e.body.userData || {});
      if (!e.body.world) physics.addBody(e.body);
      items.push({ mesh: e.mesh, body: e.body, label: e.label || '场景道具' });
    } catch (err) {
      console.warn('[grab] 注册外部可抓物失败', err);
    }
  }
  world.grabbables = items;

  // ---------------------------------------------------------------- 抓 / 放
  function attach(body, worldPoint) {
    if (holding) release(false);
    body.wakeUp();
    body.allowSleep = false;
    held = body;
    holding = true;
    heldMask = body.collisionFilterMask;
    body.collisionFilterMask = heldMask & ~GROUP.CHAR;
    held.prevMask = heldMask;

    const pivotB = new CANNON.Vec3();
    body.pointToLocalFrame(new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z), pivotB);
    const target = ctx.hold(tempTarget);
    anchor.position.set(target.x, target.y, target.z);
    anchor.velocity.set(0, 0, 0);
    anchor.aabbNeedsUpdate = true;
    constraint = new CANNON.PointToPointConstraint(
      anchor, new CANNON.Vec3(0, 0, 0), body, pivotB, HOLD_FORCE
    );
    constraint.collideConnected = false;
    physics.addConstraint(constraint);
    return true;
  }

  function tryGrab() {
    if (holding) return false;
    const eye = ctx.eye(tempEye);
    const aim = ctx.aim(tempAim).normalize();
    const from = { x: eye.x, y: eye.y, z: eye.z };
    const to = {
      x: eye.x + aim.x * (REACH + 0.6),
      y: eye.y + aim.y * (REACH + 0.6),
      z: eye.z + aim.z * (REACH + 0.6),
    };
    const hits = physics.rayAll(from, to, GROUP.PROP | GROUP.STATIC | GROUP.GROUND);
    let blocked = false;
    for (const h of hits) {
      if (!h || !h.body) continue;
      if (h.body === anchor) continue;
      const ud = h.body.userData;
      if (ud && ud.grabbable) {
        return attach(h.body, h.point);
      }
      // 先打到墙/地面 → 被遮挡，不能隔墙抓
      if (ud && ud.kind === 'char') continue;
      blocked = true;
      break;
    }
    if (blocked) return false;

    // 视线射线没命中（低头/偏移）时，用前方锥形兜底
    let best = null;
    let bestScore = -1;
    const maxD = REACH + 0.6;
    for (const it of items) {
      const b = it.body;
      const dx = b.position.x - eye.x;
      const dy = b.position.y - eye.y;
      const dz = b.position.z - eye.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.05 || d > maxD) continue;
      const dot = (dx * aim.x + dy * aim.y + dz * aim.z) / d;
      if (dot < 0.28) continue;
      const score = dot - d * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) {
      return attach(best, { x: best.position.x, y: best.position.y, z: best.position.z });
    }
    return false;
  }

  function release(throwIt) {
    if (!holding) return false;
    if (constraint) {
      physics.removeConstraint(constraint);
      constraint = null;
    }
    if (held) {
      held.collisionFilterMask = heldMask;
      held.allowSleep = true;
      if (throwIt) {
        const aim = ctx.aim(tempAim).normalize();
        const pv = ctx.playerVel(tempVel);
        held.velocity.set(
          pv.x * 0.55 + aim.x * 7.0,
          Math.max(0, pv.y) * 0.3 + aim.y * 7.0 + 2.6,
          pv.z * 0.55 + aim.z * 7.0
        );
        held.angularVelocity.set(
          (Math.random() - 0.5) * 7,
          (Math.random() - 0.5) * 7,
          (Math.random() - 0.5) * 7
        );
      }
      held.wakeUp();
    }
    held = null;
    holding = false;
    anchor.velocity.set(0, 0, 0);
    anchor.position.set(0, -50, 0);
    return true;
  }

  function preStep(dt) {
    if (!holding || !held) {
      if (holding) release(false);
      return;
    }
    const target = ctx.hold(tempTarget);
    const d = Math.max(dt, 1e-4);
    anchor.velocity.set(
      (target.x - anchor.position.x) / d,
      (target.y - anchor.position.y) / d,
      (target.z - anchor.position.z) / d
    );
    anchor.position.set(target.x, target.y, target.z);
    anchor.aabbNeedsUpdate = true;
    const dx = held.position.x - target.x;
    const dy = held.position.y - target.y;
    const dz = held.position.z - target.z;
    if (dx * dx + dy * dy + dz * dz > 9) release(false);
  }

  function sync() {
    for (const it of items) {
      const b = it.body;
      it.mesh.position.set(b.position.x, b.position.y, b.position.z);
      it.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
  }

  return {
    items,
    tryGrab,
    release,
    preStep,
    sync,
    get holding() { return holding; },
    get heldBody() { return held; },
    get anchorBody() { return anchor; },
  };
}

export default createGrabSystem;
