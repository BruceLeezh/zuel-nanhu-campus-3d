import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CFG } from '../core/config.js';
import { heightAt } from '../world/terrain.js';
import { clamp, lerp } from '../core/util.js';

// ============================================================================
//  软体工人角色（《人类一败涂地》风格）
//  - 躯干根体：双球胶囊，fixedRotation，负责真正的地形/建筑碰撞与移动
//  - 13 段肢体：低质量刚体 + PointToPoint 关节 + PD 肌肉力矩
//  - 摔倒时关掉肌肉、解除根体锁定旋转 → 布娃娃翻滚；落地后自动爬起
// ============================================================================

export const ROOT_H = 0.79;   // 根体中心到脚底
export const EYE_OFF = 0.78;  // 根体中心到眼睛（脚底 +1.57）
const ROOT_MASS = CFG.player.mass;
const GRAVITY = CFG.physics.gravity; // 负数

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _qTarget = new THREE.Quaternion();
const _qStart = new THREE.Quaternion();
const _qEnd = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
const _zero = new CANNON.Vec3(0, 0, 0);
const _force = new CANNON.Vec3();
const _torque = new CANNON.Vec3();

// 肌肉：角速度伺服把 body 的世界朝向拉向 target（比纯 PD 力矩稳，不依赖惯性）
// k 保留为刚度提示，d 用作阻尼/响应速度，maxT 映射到最大角速度
function muscleTorque(body, target, k, d, maxT, scale, dt) {
  if (scale <= 0.001) return;
  const q = body.quaternion;
  // err = target * conj(q)
  let w = target.w * q.w + target.x * q.x + target.y * q.y + target.z * q.z;
  let x = -target.w * q.x + q.w * target.x - target.y * q.z + target.z * q.y;
  let y = -target.w * q.y + q.w * target.y - target.z * q.x + target.x * q.z;
  let z = -target.w * q.z + q.w * target.z - target.x * q.y + target.y * q.x;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-6) return;
  const angle = 2 * Math.atan2(s, clamp(w, -1, 1));
  const inv = 1 / s;
  const maxOmega = Math.min(16, 3.5 + maxT * 0.085) * scale;
  const want = Math.min(angle * 7, maxOmega);
  const wx = x * inv * want;
  const wy = y * inv * want;
  const wz = z * inv * want;
  const av = body.angularVelocity;
  const blend = 1 - Math.exp(-(10 + d) * dt);
  av.x += (wx - av.x) * blend;
  av.y += (wy - av.y) * blend;
  av.z += (wz - av.z) * blend;
}

function clampBodySpeed(body, maxV, maxW) {
  const v = body.velocity;
  const vl = v.length();
  if (vl > maxV) v.scale(maxV / vl, v);
  const w = body.angularVelocity;
  const wl = w.length();
  if (wl > maxW) w.scale(maxW / wl, w);
}

function buildMaterials() {
  const mk = (color, rough = 0.88, metal = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  return {
    blue: mk(0x2f5f9e),
    blueDark: mk(0x24486f),
    skin: mk(0xdda875, 0.92),
    helmet: mk(0xf2b21f, 0.52),
    helmetDark: mk(0xcf9410, 0.6),
    boot: mk(0x34373c, 0.95),
    glove: mk(0x8a6238, 0.95),
    stripe: mk(0xf7e26b, 0.6),
    white: mk(0xf7f3ea, 0.55),
    dark: mk(0x241f1a, 0.7),
  };
}

function buildGeometries() {
  return {
    chest: new THREE.BoxGeometry(0.46, 0.38, 0.32),
    collar: new THREE.BoxGeometry(0.38, 0.06, 0.28),
    stripe: new THREE.BoxGeometry(0.32, 0.07, 0.012),
    head: new THREE.SphereGeometry(0.24, 20, 16),
    helmet: new THREE.SphereGeometry(0.272, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6),
    brim: new THREE.CylinderGeometry(0.305, 0.305, 0.028, 20),
    eye: new THREE.SphereGeometry(0.036, 10, 8),
    pupil: new THREE.SphereGeometry(0.018, 8, 6),
    upperArm: new THREE.BoxGeometry(0.17, 0.21, 0.16),
    shoulder: new THREE.SphereGeometry(0.10, 12, 8),
    foreArm: new THREE.BoxGeometry(0.155, 0.18, 0.15),
    mitten: new THREE.SphereGeometry(0.105, 12, 10),
    thigh: new THREE.BoxGeometry(0.20, 0.33, 0.22),
    shin: new THREE.BoxGeometry(0.18, 0.33, 0.19),
    foot: new THREE.BoxGeometry(0.20, 0.14, 0.26),
  };
}

function buildVisual(name, group, GEO, MAT) {
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  if (name === 'chest') {
    add(GEO.chest, MAT.blue);
    add(GEO.collar, MAT.blueDark, 0, 0.175, 0);
    add(GEO.stripe, MAT.stripe, 0, 0.045, 0.156);
    add(GEO.stripe, MAT.stripe, 0, -0.06, 0.156);
  } else if (name === 'head') {
    add(GEO.head, MAT.skin);
    add(GEO.eye, MAT.white, -0.076, 0.0, 0.226);
    add(GEO.eye, MAT.white, 0.076, 0.0, 0.226);
    add(GEO.pupil, MAT.dark, -0.076, 0.0, 0.25);
    add(GEO.pupil, MAT.dark, 0.076, 0.0, 0.25);
    add(GEO.helmet, MAT.helmet, 0, 0.055, 0);
    add(GEO.brim, MAT.helmetDark, 0, 0.028, 0.02);
  } else if (name.startsWith('upperArm')) {
    add(GEO.upperArm, MAT.blue);
    add(GEO.shoulder, MAT.blueDark, 0, 0.115, 0);
  } else if (name.startsWith('foreArm')) {
    add(GEO.foreArm, MAT.blue);
    add(GEO.mitten, MAT.glove, 0, -0.12, 0);
  } else if (name.startsWith('thigh')) {
    add(GEO.thigh, MAT.blue);
  } else if (name.startsWith('shin')) {
    add(GEO.shin, MAT.blueDark);
  } else if (name.startsWith('foot')) {
    add(GEO.foot, MAT.boot);
  }
}

export function createCharacter(scene, { world, physics } = {}) {
  if (!physics) throw new Error('createCharacter 需要 physics');

  const MAT = buildMaterials();
  const GEO = buildGeometries();
  const object3D = new THREE.Group();
  object3D.name = 'character';
  scene.add(object3D);

  // ---------------------------------------------------------------- 根体（胶囊）
  const root = new CANNON.Body({
    mass: ROOT_MASS,
    material: physics.materials.char,
    linearDamping: 0.0,
    angularDamping: 0.4,
    allowSleep: false,
    fixedRotation: true,
  });
  root.addShape(new CANNON.Sphere(0.34), new CANNON.Vec3(0, -0.45, 0));
  root.addShape(new CANNON.Sphere(0.32), new CANNON.Vec3(0, 0.45, 0));
  root.collisionFilterGroup = physics.group.CHAR;
  root.collisionFilterMask = physics.group.GROUND | physics.group.STATIC | physics.group.PROP;
  root.userData = { kind: 'char' };
  root.updateMassProperties();
  physics.addBody(root);

  const parts = [];
  const byName = new Map();
  const position = new THREE.Vector3();
  let facing = Math.PI;

  // ---------------------------------------------------------------- 分段定义
  function addPart(cfg) {
    const body = new CANNON.Body({
      mass: cfg.mass,
      material: physics.materials.char,
      linearDamping: 0.06,
      angularDamping: 0.65,
      allowSleep: false,
    });
    if (cfg.sphere) body.addShape(new CANNON.Sphere(cfg.sphere));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(cfg.box[0], cfg.box[1], cfg.box[2])));
    // 肢体只做视觉/惯性，不参与任何碰撞（省 CPU，也避免自碰撞）
    body.collisionFilterGroup = 0;
    body.collisionFilterMask = 0;
    body.collisionResponse = false;
    body.position.set(
      root.position.x + cfg.rest[0],
      root.position.y + cfg.rest[1],
      root.position.z + cfg.rest[2]
    );
    body.quaternion.set(0, 1, 0, 0); // yaw = π，与出生朝向一致
    body.userData = { kind: 'limb', part: cfg.name };
    body.updateMassProperties();
    physics.addBody(body);

    const parentBody = cfg.parent ? byName.get(cfg.parent).body : root;
    const constraint = new CANNON.PointToPointConstraint(
      parentBody,
      new CANNON.Vec3(cfg.pivotA[0], cfg.pivotA[1], cfg.pivotA[2]),
      body,
      new CANNON.Vec3(cfg.pivotB[0], cfg.pivotB[1], cfg.pivotB[2]),
      1e6
    );
    constraint.collideConnected = false;
    physics.addConstraint(constraint);

    const group = new THREE.Group();
    group.name = cfg.name;
    buildVisual(cfg.name, group, GEO, MAT);
    object3D.add(group);

    const part = {
      name: cfg.name,
      side: cfg.side || 0,
      body,
      group,
      rest: cfg.rest,
      k: cfg.k,
      d: cfg.d,
      maxT: cfg.maxT,
      constraint,
      parent: cfg.parent || null,
    };
    parts.push(part);
    byName.set(cfg.name, part);
    return part;
  }

  addPart({
    name: 'chest', parent: null, mass: 3.5, box: [0.23, 0.19, 0.16],
    rest: [0, 0.31, 0], pivotA: [0, 0.14, 0], pivotB: [0, -0.19, 0],
    k: 130, d: 7, maxT: 150,
  });
  addPart({
    name: 'head', parent: 'chest', mass: 1.6, sphere: 0.24,
    rest: [0, 0.75, 0], pivotA: [0, 0.21, 0], pivotB: [0, -0.24, 0],
    k: 110, d: 5, maxT: 70,
  });

  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'L' : 'R';
    const sx = side * 0.27;
    const hx = side * 0.115;
    addPart({
      name: `upperArm${tag}`, parent: 'chest', side, mass: 0.55, box: [0.085, 0.105, 0.08],
      rest: [sx, 0.33, 0], pivotA: [sx, 0.12, 0], pivotB: [0, 0.105, 0],
      k: 28, d: 1.2, maxT: 26,
    });
    addPart({
      name: `foreArm${tag}`, parent: `upperArm${tag}`, side, mass: 0.45, box: [0.078, 0.09, 0.075],
      rest: [sx, 0.135, 0], pivotA: [0, -0.105, 0], pivotB: [0, 0.09, 0],
      k: 22, d: 1.1, maxT: 20,
    });
    addPart({
      name: `thigh${tag}`, parent: null, side, mass: 1.4, box: [0.10, 0.165, 0.11],
      rest: [hx, -0.145, 0], pivotA: [hx, 0.02, 0], pivotB: [0, 0.165, 0],
      k: 70, d: 2.6, maxT: 60,
    });
    addPart({
      name: `shin${tag}`, parent: `thigh${tag}`, side, mass: 1.0, box: [0.09, 0.165, 0.095],
      rest: [hx, -0.475, 0], pivotA: [0, -0.165, 0], pivotB: [0, 0.165, 0],
      k: 55, d: 2.0, maxT: 45,
    });
    addPart({
      name: `foot${tag}`, parent: `shin${tag}`, side, mass: 0.6, box: [0.10, 0.07, 0.13],
      rest: [hx, -0.715, 0.07], pivotA: [0, -0.165, 0], pivotB: [0, 0.07, -0.07],
      k: 40, d: 1.2, maxT: 30,
    });
  }

  // ---------------------------------------------------------------- 状态
  let ragdoll = false;
  let ragdollTime = 0;
  let getup = null;
  let muscleScale = 0;
  let phase = 0;
  let animT = 0;
  let lastState = {};
  let headVisible = true;

  _qEnd.identity();

  function resetPose() {
    for (const p of parts) {
      const b = p.body;
      b.position.set(
        root.position.x + p.rest[0],
        root.position.y + p.rest[1],
        root.position.z + p.rest[2]
      );
      b.quaternion.set(0, 1, 0, 0); // 初始朝向：yaw = π
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
    }
  }

  function syncVisuals() {
    position.set(root.position.x, root.position.y - ROOT_H, root.position.z);
    object3D.position.copy(position);
    for (const p of parts) {
      const b = p.body;
      p.group.position.set(
        b.position.x - position.x,
        b.position.y - position.y,
        b.position.z - position.z
      );
      p.group.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
  }

  function enterRagdoll(st) {
    if (ragdoll) return;
    ragdoll = true;
    ragdollTime = 0;
    getup = null;
    muscleScale = 0;
    root.fixedRotation = false;
    root.updateMassProperties();
    root.angularDamping = 0.45;
    root.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
    for (const p of parts) {
      const b = p.body;
      b.angularVelocity.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
      b.velocity.set((Math.random() - 0.5) * 2.2, Math.random() * 1.6, (Math.random() - 0.5) * 2.2);
    }
    if (st) st.ragdoll = true;
  }

  function startGetup() {
    const gx = root.position.x;
    const gz = root.position.z;
    const sy = physics.surfaceBelow(gx, root.position.y + 1.4, gz, 4);
    const groundY = (isFinite(sy) ? sy : heightAt(gx, gz)) + ROOT_H;
    _qStart.set(root.quaternion.x, root.quaternion.y, root.quaternion.z, root.quaternion.w);
    getup = {
      t: 0,
      dur: 0.55,
      sx: root.position.x, sy: root.position.y, sz: root.position.z,
      ex: gx, ey: Math.max(groundY, root.position.y - 0.2), ez: gz,
    };
    ragdollTime = 0;
    root.fixedRotation = true;
    root.updateMassProperties();
    root.velocity.set(0, 0, 0);
    root.angularVelocity.set(0, 0, 0);
    root.angularDamping = 0.3;
  }

  function clampLimbsToGround() {
    for (const p of parts) {
      const b = p.body;
      const g = heightAt(b.position.x, b.position.z) + 0.085;
      if (b.position.y < g) {
        b.position.y = g;
        const v = b.velocity;
        if (v.y < 0) v.y *= -0.08;
        v.x *= 0.86;
        v.z *= 0.86;
        const w = b.angularVelocity;
        w.x *= 0.72; w.y *= 0.72; w.z *= 0.72;
      }
    }
  }

  // ---------------------------------------------------------------- 姿态 & 肌肉
  function applyMuscles(st, dt) {
    if (ragdoll || getup) return;
    const speed = st.speed || 0;
    const mv = clamp(speed / CFG.player.walk, 0, 1.8);
    const runF = clamp((speed - CFG.player.walk) / (CFG.player.run - CFG.player.walk), 0, 1);
    const climbing = !!st.climbing;
    const air = !climbing && st.grounded === false;
    const stag = clamp(st.stagger || 0, 0, 1);
    phase += dt * (2.7 + speed * 2.5);
    animT += dt;
    const sw = Math.sin(phase);
    const breathe = Math.sin(animT * 1.7);
    const armSwing = sw * (0.14 + mv * 0.28) * (1 + runF * 0.22);
    const legSwing = sw * (0.15 + mv * 0.30) * (1 + runF * 0.22);
    const chestPitch = 0.05 + mv * 0.08 + runF * 0.08 + (air ? 0.06 : 0) - stag * 1.0 + breathe * 0.012;
    const chestRoll = sw * 0.04 * mv;
    const headPitch = -chestPitch * 0.55 + (air ? -0.08 : 0) - stag * 0.3;
    const headRoll = -sw * 0.025 * mv;
    poseFacing = (st.facing != null ? st.facing : poseFacing);

    for (const p of parts) {
      const side = p.side || 0;
      let pitch = 0;
      let roll = 0;
      let yawOff = 0;
      const n = p.name;
      if (n === 'chest') {
        pitch = chestPitch;
        roll = chestRoll;
      } else if (n === 'head') {
        pitch = headPitch;
        roll = headRoll;
        yawOff = Math.sin(animT * 0.55) * 0.10;
      } else if (n.startsWith('upperArm')) {
        if (climbing) {
          pitch = -2.0 + sw * 0.18;
          roll = side * 0.22;
        } else if (air) {
          pitch = -0.35;
          roll = side * 1.0;
        } else if (stag > 0.02) {
          pitch = 1.1 * stag;
          roll = side * (0.35 + 0.55 * stag);
        } else {
          pitch = -side * armSwing;
          roll = side * 0.12;
        }
      } else if (n.startsWith('foreArm')) {
        if (climbing) {
          pitch = -1.25;
          roll = side * 0.18;
        } else if (air) {
          pitch = -0.75;
          roll = side * 0.35;
        } else if (stag > 0.02) {
          pitch = 0.55 * stag;
          roll = side * 0.3;
        } else {
          pitch = -side * armSwing + 0.30 + Math.max(0, -side * armSwing) * 0.25;
          roll = side * 0.10;
        }
      } else if (n.startsWith('thigh')) {
        if (climbing) {
          pitch = -0.5 + Math.sin(animT * 2.2) * 0.18;
          roll = side * 0.06;
        } else if (air) {
          pitch = -0.45 + side * 0.08;
          roll = side * 0.05;
        } else {
          pitch = -side * legSwing;
          roll = side * 0.02;
        }
      } else if (n.startsWith('shin')) {
        const thighPitch = -side * legSwing;
        let bend = 0.16 + Math.max(0, side * sw) * (0.45 + mv * 0.55);
        if (climbing) bend = 0.95;
        else if (air) bend = 0.75;
        else if (stag > 0.02) bend = 0.35 + stag * 0.4;
        pitch = (climbing || air || stag > 0.02 ? 0 : thighPitch) + bend;
        roll = side * 0.02;
      } else if (n.startsWith('foot')) {
        const thighPitch = -side * legSwing;
        const bend = 0.16 + Math.max(0, side * sw) * (0.45 + mv * 0.55);
        pitch = climbing ? 0.15 : (air ? -0.32 : -(thighPitch + bend) * 0.35);
      }
      if (st.emote && st.emote.name) {
        const em = st.emote;
        const ew = clamp(em.w != null ? em.w : 1, 0, 1);
        if (em.name === 'sit') {
          if (n.startsWith('thigh')) { pitch = -1.35 * ew; roll = side * 0.12; }
          else if (n.startsWith('shin')) pitch = 1.5 * ew;
          else if (n === 'chest') { pitch = 0.18 * ew; roll = 0; }
          else if (n.startsWith('upperArm')) { pitch = -0.3 * ew; roll = side * 0.2; }
          else if (n.startsWith('foreArm')) pitch = -0.85 * ew;
        } else if (em.name === 'drink') {
          if (n.startsWith('upperArm') && side > 0) pitch = -1.75 * ew;
          else if (n.startsWith('foreArm') && side > 0) pitch = -1.2 * ew;
          else if (n === 'head') pitch = 0.18 * ew;
          else if (n.startsWith('upperArm')) pitch = -0.15 * ew;
        } else if (em.name === 'read') {
          if (n.startsWith('upperArm')) { pitch = -1.1 * ew; roll = side * 0.06; }
          else if (n.startsWith('foreArm')) pitch = -1.45 * ew;
          else if (n === 'head') pitch = 0.42 * ew;
          else if (n === 'chest') pitch = 0.12 * ew;
        }
      }
      _euler.set(pitch, poseFacing + yawOff, roll, 'YXZ');
      _qTarget.setFromEuler(_euler);
      muscleTorque(p.body, _qTarget, p.k, p.d, p.maxT, muscleScale, dt);
    }
  }

  let poseFacing = Math.PI;

  // ---------------------------------------------------------------- 公共接口
  function preStep(dt, st) {
    lastState = st || {};
    if (ragdoll) return;
    if (lastState.climbing) {
      // 抵消重力，攀爬时竖直速度由 player 指定
      _force.set(0, -GRAVITY * ROOT_MASS, 0);
      root.applyForce(_force, _zero);
    }
    applyMuscles(lastState, dt);
  }

  function update(dt, st) {
    st = st || lastState || {};
    lastState = st;
    const d = clamp(dt, 0.0001, 0.05);

    if (!ragdoll) {
      muscleScale = Math.min(1, muscleScale + d * 3.2);
      if (st.landImpact > 7.5 && st.fallHeight > 2.0) {
        enterRagdoll(st);
      }
    } else if (getup) {
      getup.t += d;
      const k = clamp(getup.t / getup.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      root.position.set(
        lerp(getup.sx, getup.ex, e),
        lerp(getup.sy, getup.ey, e),
        lerp(getup.sz, getup.ez, e)
      );
      _qTmp.copy(_qStart).slerp(_qEnd, e);
      root.quaternion.set(_qTmp.x, _qTmp.y, _qTmp.z, _qTmp.w);
      root.velocity.set(0, 0, 0);
      root.angularVelocity.set(0, 0, 0);
      if (k >= 1) {
        getup = null;
        ragdoll = false;
        muscleScale = 0;
        root.quaternion.set(0, 0, 0, 1);
      }
    } else {
      ragdollTime += d;
      clampLimbsToGround();
      let w2 = 0;
      for (const p of parts) w2 += p.body.angularVelocity.lengthSquared();
      const calm = root.velocity.lengthSquared() < 9 && w2 < 55;
      if ((ragdollTime > 0.9 && calm) || ragdollTime > 3.4) startGetup();
    }

    // 限制四肢速度，避免约束+肌肉把布娃娃炸飞
    for (const p of parts) clampBodySpeed(p.body, 22, 26);
    clampBodySpeed(root, 40, 20);

    syncVisuals();
    st.ragdoll = ragdoll;
    if (st.landImpact) st.landImpact = 0;
    if (st.fallHeight) st.fallHeight = 0;
  }

  function teleport(x, y, z) {
    const px = isFinite(x) ? x : 0;
    const pz = isFinite(z) ? z : 18;
    const py = (isFinite(y) && y != null) ? y : heightAt(px, pz) + ROOT_H;
    ragdoll = false;
    ragdollTime = 0;
    getup = null;
    muscleScale = 0;
    root.fixedRotation = true;
    root.updateMassProperties();
    root.position.set(px, py, pz);
    root.quaternion.set(0, 0, 0, 1);
    root.velocity.set(0, 0, 0);
    root.angularVelocity.set(0, 0, 0);
    root.angularDamping = 0.4;
    resetPose();
    syncVisuals();
  }

  function reset() {
    teleport(0, null, 18);
  }

  function setHeadVisible(v) {
    headVisible = !!v;
    const head = byName.get('head');
    if (head) head.group.visible = headVisible;
  }

  function eyePosition(out = new THREE.Vector3()) {
    return out.set(root.position.x, root.position.y + EYE_OFF, root.position.z);
  }

  // 初始出生：五羊广场
  teleport(0, null, 18);

  return {
    object3D,
    position,
    root,
    parts,
    ROOT_H,
    EYE_OFF,
    preStep,
    update,
    teleport,
    reset,
    setHeadVisible,
    eyePosition,
    get ragdollActive() { return ragdoll; },
    get ragdollTime() { return ragdollTime; },
  };
}

export default createCharacter;
