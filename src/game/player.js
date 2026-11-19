import * as THREE from 'three';
import { CFG } from '../core/config.js';
import { clamp, damp, dampAngle } from '../core/util.js';
import { heightAt } from '../world/terrain.js';
import { GROUP } from './physics.js';
import { ROOT_H, EYE_OFF } from './character.js';
import { createGrabSystem } from './grab.js';

// ============================================================================
//  第三人称探索控制器
//  - 相机相对 WASD / Shift 跑（体力）/ Space 跳（蓄力）/ F 攀爬 / E 抓取
//  - 速度用 damp 平滑；root 胶囊由 cannon 负责地形/建筑碰撞
//  - 弹簧臂相机：后方射线采样地形 + 建筑 OBB，收缩快 / 恢复慢
// ============================================================================

const P = CFG.player;
const CAM = CFG.camera;
// 出生点：站在五羊广场中轴、正对五羊雕塑。原来的 z=18 会让第三人称相机
// 顶到广场边的矮花坛，画面下方 1/5 被石台糊住，故前移到 z=12。
const SPAWN = { x: 0, z: 12 };
const MASK_MOVE = GROUP.STATIC | GROUP.GROUND;

const _lookTarget = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _vel = new THREE.Vector3();

export function createPlayer(scene, camera, world, character, physics) {
  if (!character || !physics) throw new Error('createPlayer 需要 character 与 physics');
  const root = character.root;

  const position = new THREE.Vector3();
  const state = {
    speed: 0,
    run: false,
    grounded: false,
    vy: 0,
    stamina: 1,
    climbing: false,
    ragdoll: false,
    facing: Math.PI,
    stagger: 0,
    holding: false,
    dist: CAM.dist,
    landImpact: 0,
    fallHeight: 0,
    view: 'third',
    airTime: 0,
    emote: null,
  };

  let facing = Math.PI;
  let yaw = Math.PI;
  let pitch = 0.22;
  let view = 'third';
  let dist = CAM.dist;
  let boom = CAM.dist;
  let camY = character.position.y;
  let _dt = 1 / 60;

  let wasGrounded = false;
  let airTime = 0;
  let apexY = 0;
  let coyote = 0;
  let jumpBuffer = 0;
  let jumpHoldT = 0;
  let prevJump = false;
  let prevGrab = false;
  let jumping = 0;
  let moveVx = 0;
  let moveVz = 0;

  let climbing = false;
  let climbInfo = null;
  let climbCooldown = 0;
  let emote = null;
  let staminaLock = false;

  // ---------------------------------------------------------------- 相机碰撞盒
  const camBoxes = [];
  for (const c of world.colliders || []) {
    if (!c || !(c.w > 0) || !(c.d > 0) || !(c.h > 0)) continue;
    const rot = c.rot || 0;
    const base = (c.base != null) ? c.base : heightAt(c.x, c.z);
    camBoxes.push({
      x: c.x, z: c.z,
      cy: base + c.h / 2,
      hw: c.w / 2, hh: c.h / 2, hd: c.d / 2,
      cos: Math.cos(rot), sin: Math.sin(rot),
    });
  }

  // ---------------------------------------------------------------- 抓取系统
  const grabSys = createGrabSystem(scene, world, physics, {
    eye: (out) => character.eyePosition(out),
    aim: (out) => aimDir(out),
    hold: (out) => holdTarget(out),
    playerVel: (out) => out.set(moveVx, root.velocity.y, moveVz),
  });

  function aimDir(out = _aim) {
    const cp = Math.cos(pitch);
    return out.set(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp).normalize();
  }

  function holdTarget(out = _hold) {
    return out.set(
      root.position.x + Math.sin(facing) * 0.82,
      root.position.y + 0.18,
      root.position.z + Math.cos(facing) * 0.82
    );
  }

  // ---------------------------------------------------------------- 相机遮挡
  function rayBox(ox, oy, oz, dx, dy, dz, maxDist, b, margin) {
    // 把射线变到盒子的局部坐标（绕 Y 旋转 -rot）
    const lx = ox - b.x;
    const lz = oz - b.z;
    const px = lx * b.cos - lz * b.sin;
    const pz = lx * b.sin + lz * b.cos;
    const vx = dx * b.cos - dz * b.sin;
    const vz = dx * b.sin + dz * b.cos;
    const py = oy - b.cy;
    const ex = b.hw + margin, ey = b.hh + margin, ez = b.hd + margin;
    let tmin = 0, tmax = maxDist;
    const slab = (o, d, e) => {
      if (Math.abs(d) < 1e-6) return Math.abs(o) <= e;
      let t1 = (-e - o) / d;
      let t2 = (e - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      return tmin <= tmax;
    };
    if (!slab(px, vx, ex)) return null;
    if (!slab(py, dy, ey)) return null;
    if (!slab(pz, vz, ez)) return null;
    if (tmax < 0) return null;
    return tmin > 0 ? tmin : 0.02;
  }

  function cameraClear(px, py, pz, bx, by, bz, maxDist) {
    let t = 1;
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = px + bx * maxDist * k;
      const y = py + by * maxDist * k;
      const z = pz + bz * maxDist * k;
      if (y < heightAt(x, z) + 0.3) {
        t = Math.min(t, (i - 1) / steps);
        break;
      }
    }
    for (let i = 0; i < camBoxes.length; i++) {
      const h = rayBox(px, py, pz, bx, by, bz, maxDist, camBoxes[i], 0.32);
      if (h != null && h / maxDist < t) t = h / maxDist;
    }
    return clamp(t, 0.05, 1);
  }

  // ---------------------------------------------------------------- 地面判定
  function detectGrounded() {
    const g = heightAt(position.x, position.z);
    if (position.y <= g + 0.18 && root.velocity.y < 3.0) return true;
    const contacts = physics.world.contacts;
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      let other = null;
      if (c.bi === root) other = c.bj;
      else if (c.bj === root) other = c.bi;
      else continue;
      if (!other) continue;
      if (root.position.y - other.position.y > -0.15 && Math.abs(c.ni.y) > 0.35) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 攀爬
  function tryStartClimb() {
    const y0 = position.y + 1.0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const hit = physics.ray(
      { x: position.x, y: y0, z: position.z },
      { x: position.x + fx * 0.95, y: y0, z: position.z + fz * 0.95 },
      MASK_MOVE
    );
    if (!hit) return false;
    if (Math.abs(hit.normal.y) > 0.55) return false;
    if (hit.distance < 0.06) return false;
    climbInfo = hit;
    climbing = true;
    state.climbing = true;
    facing = Math.atan2(-hit.normal.x, -hit.normal.z);
    state.facing = facing;
    root.velocity.set(0, 0, 0);
    return true;
  }

  function mantle(info) {
    climbing = false;
    state.climbing = false;
    climbCooldown = 0.5;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    root.position.x += fx * 0.85;
    root.position.z += fz * 0.85;
    root.position.y = info.top + ROOT_H + 0.03;
    root.velocity.set(fx * 2.0, 1.6, fz * 2.0);
    position.set(root.position.x, root.position.y - ROOT_H, root.position.z);
  }

  function updateClimb(dt, input) {
    if (!climbing) return;
    if (!input.climb || climbCooldown > 0) {
      climbing = false;
      state.climbing = false;
      return;
    }
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const y1 = position.y + 0.9;
    const hit = physics.ray(
      { x: position.x, y: y1, z: position.z },
      { x: position.x + fx * 1.15, y: y1, z: position.z + fz * 1.15 },
      MASK_MOVE
    );
    if (hit && Math.abs(hit.normal.y) < 0.6) {
      climbInfo = hit;
      const up = (input.forward || 0) * 2.2;
      // 贴墙位移同样绕开 cannon 摩擦：每帧把身体吸附到墙面前 0.36m，并直接升降
      const nx = hit.normal.x;
      const nz = hit.normal.z;
      root.velocity.set(0, 0, 0);
      const dx = root.position.x - hit.point.x;
      const dz = root.position.z - hit.point.z;
      const distOut = dx * nx + dz * nz;
      const corr = distOut - 0.36;
      root.position.x -= nx * corr;
      root.position.z -= nz * corr;
      root.position.y += up * dt;
      const info = hit.body && hit.body.userData && hit.body.userData.collider;
      if (input.forward > 0 && info && root.position.y + 0.25 > info.top - 0.35) {
        mantle(info);
      }
    } else {
      const info = climbInfo && climbInfo.body && climbInfo.body.userData && climbInfo.body.userData.collider;
      if (input.forward > 0 && info && root.position.y + 0.25 > info.top - 0.35) {
        mantle(info);
      } else {
        climbing = false;
        state.climbing = false;
        climbCooldown = 0.3;
      }
    }
  }

  // ---------------------------------------------------------------- 水平位移
  // cannon 的 heightfield 多接触点摩擦会吃掉水平速度（纯物理实验确认），
  // 因此水平移动改为「自维护速度 + 墙检后直接位移」，垂直/重力/摔落仍交给 cannon。
  function blockedRay(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return false;
    const from = { x: root.position.x, y: root.position.y, z: root.position.z };
    const d = Math.max(0.24, len + 0.12);
    const inv = d / len;
    const to = { x: from.x + dx * inv, y: from.y, z: from.z + dz * inv };
    return !!physics.ray(from, to, GROUP.STATIC);
  }

  function applyMove(dt) {
    if (climbing || character.ragdollActive) {
      root.velocity.x = 0;
      root.velocity.z = 0;
      return 0;
    }
    const dx = moveVx * dt;
    const dz = moveVz * dt;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
    let sx = dx, sz = dz;
    if (blockedRay(sx, sz)) {
      const okX = !blockedRay(sx, 0);
      const okZ = !blockedRay(0, sz);
      if (okX && !okZ) {
        sz = 0;
      } else if (okZ && !okX) {
        sx = 0;
      } else if (okX && okZ) {
        // 斜向贴墙：保留较大的分量，另一轴滑走
        if (Math.abs(dx) >= Math.abs(dz)) sz = 0; else sx = 0;
      } else {
        sx = 0; sz = 0;
      }
    }
    root.position.x += sx;
    root.position.z += sz;
    const b = physics.bounds;
    if (b) {
      root.position.x = clamp(root.position.x, b.minX, b.maxX);
      root.position.z = clamp(root.position.z, b.minZ, b.maxZ);
    }
    // 清掉水平速度，避免下一步物理再叠加，也避免摩擦反复拉扯
    root.velocity.x = 0;
    root.velocity.z = 0;
    const want = Math.hypot(dx, dz);
    const got = Math.hypot(sx, sz);
    return want > 1e-6 ? 1 - got / want : 0;
  }

  // ---------------------------------------------------------------- 主更新
  function playEmote(name, dur = 2.6) {
    emote = { name, t: 0, dur };
    state.emote = { name, t: 0, dur, w: 0 };
    if (climbing) { climbing = false; state.climbing = false; }
  }

  function update(dt, input) {
    dt = clamp(dt, 0.0002, 0.05);
    _dt = dt;
    input = input || {};

    // 视角（按住鼠标拖动）
    if (input.lookX) yaw -= input.lookX;
    if (input.lookY) pitch = clamp(pitch + input.lookY, -1.12, 1.28);
    if (yaw > Math.PI * 2) yaw -= Math.PI * 2;
    else if (yaw < -Math.PI * 2) yaw += Math.PI * 2;

    const grabEdge = !!input.grab && !prevGrab;
    prevGrab = !!input.grab;
    const jumpEdge = !!input.jump && !prevJump;
    prevJump = !!input.jump;

    // 互动小动作（Q：坐下 / 喝水 / 看报）：播放期间停步，结束自动恢复
    if (emote) {
      emote.t += dt;
      if (emote.t >= emote.dur) {
        emote = null;
        state.emote = null;
      } else {
        const w = clamp(Math.min(emote.t, emote.dur - emote.t) / 0.25, 0, 1);
        state.emote = { name: emote.name, t: emote.t, dur: emote.dur, w };
      }
    }
    const frozen = !!(emote && state.emote);

    // 布娃娃：玩家失去控制，物理继续跑
    if (character.ragdollActive) {
      if (grabSys.holding) grabSys.release(false);
      state.ragdoll = true;
      state.climbing = false;
      state.speed = 0;
      moveVx = 0;
      moveVz = 0;
      state.stagger = Math.max(0, state.stagger - dt);
      climbing = false;
      character.preStep(dt, state);
      grabSys.preStep(dt);
      physics.step(dt);
      grabSys.sync();
      syncAfterStep();
      state.ragdoll = character.ragdollActive;
      return;
    }
    state.ragdoll = false;

    // --- 攀爬 / 跳跃 ---
    climbCooldown = Math.max(0, climbCooldown - dt);
    if (input.climb && !climbing && climbCooldown <= 0) {
      tryStartClimb();
    }
    if (climbing) {
      updateClimb(dt, input);
      if (jumpEdge) {
        // 蹬墙跳
        climbing = false;
        state.climbing = false;
        climbCooldown = 0.35;
        root.velocity.set(
          -Math.sin(facing) * 3.4,
          4.6,
          -Math.cos(facing) * 3.4
        );
        jumping = 0.2;
      }
    }

    const grounded = !climbing && state.grounded;

    // 体力
    const moveMag = Math.hypot(input.forward || 0, input.right || 0);
    const wantRun = !!input.run && moveMag > 0.1 && grounded && !staminaLock;
    state.run = wantRun;
    if (wantRun) {
      state.stamina = Math.max(0, state.stamina - dt * 0.115);
      if (state.stamina <= 0.001) { state.stamina = 0; staminaLock = true; }
    } else {
      state.stamina = Math.min(1, state.stamina + dt * (grounded ? 0.17 : 0.09));
      if (staminaLock && state.stamina > 0.35) staminaLock = false;
    }

    // 相机相对方向
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    let dirX = fx * (input.forward || 0) + rx * (input.right || 0);
    let dirZ = fz * (input.forward || 0) + rz * (input.right || 0);
    if (frozen) { dirX = 0; dirZ = 0; }
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen > 1e-4) { dirX /= dirLen; dirZ /= dirLen; }

    const speedTarget = (state.run ? P.run : P.walk) * (state.stagger > 0.05 ? 0.4 : 1);

    // --- 跳 ---
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (jumpEdge) jumpBuffer = 0.14;
    coyote = grounded ? 0.10 : Math.max(0, coyote - dt);
    if (jumpBuffer > 0 && (grounded || coyote > 0) && !climbing && !frozen) {
      root.velocity.y = P.jump;
      jumpBuffer = 0;
      coyote = 0;
      jumpHoldT = 0;
      jumping = 1;
      apexY = position.y;
    }
    if (jumping > 0) {
      if (input.jump && jumpHoldT < P.jumpHold) {
        root.velocity.y += 9.0 * dt;
        jumpHoldT += dt;
      } else if (!input.jump) {
        jumping = 0;
      }
    }

    // --- 水平速度（自维护；避免 heightfield 摩擦吃掉位移）---
    if (!climbing) {
      if (grounded) {
        const rate = dirLen > 0.05 ? P.accel : P.decel;
        moveVx = damp(moveVx, dirX * speedTarget, rate, dt);
        moveVz = damp(moveVz, dirZ * speedTarget, rate, dt);
        // 轻微下压，避免下坡小跳
        if (root.velocity.y > -0.2 && jumping <= 0) root.velocity.y = -1.0;
      } else if (dirLen > 0.05) {
        const cur = Math.hypot(moveVx, moveVz);
        const target = Math.max(speedTarget, cur * 0.96);
        moveVx = damp(moveVx, dirX * target, P.accel * P.airControl, dt);
        moveVz = damp(moveVz, dirZ * target, P.accel * P.airControl, dt);
      } else {
        moveVx = damp(moveVx, 0, 0.5, dt);
        moveVz = damp(moveVz, 0, 0.5, dt);
      }
      const hs = Math.hypot(moveVx, moveVz);
      const maxHs = P.run * 1.5;
      if (hs > maxHs) {
        moveVx *= maxHs / hs;
        moveVz *= maxHs / hs;
      }
    } else {
      moveVx = 0;
      moveVz = 0;
    }

    if (jumping > 0) jumping = Math.max(0, jumping - dt);

    // --- 朝向 ---
    if (climbing) {
      // 面向墙面
    } else if (dirLen > 0.08) {
      facing = dampAngle(facing, Math.atan2(dirX, dirZ), P.turnRate, dt);
    }

    // --- 抓取 ---
    if (grabEdge && !frozen) {
      if (grabSys.holding) grabSys.release(true);
      else grabSys.tryGrab();
    }

    // --- 物理步进 ---
    state.facing = facing;
    state.climbing = climbing;
    character.preStep(dt, state);
    grabSys.preStep(dt);
    physics.step(dt);
    grabSys.sync();

    // 位置驱动的水平移动（墙检后直接位移；垂直/地形/摔落仍由 cannon 负责）
    const blockedFrac = applyMove(dt);
    if (!climbing && blockedFrac > 0.5 && Math.hypot(moveVx, moveVz) > 3.2 && state.stagger <= 0.02) {
      state.stagger = 0.45;
    }

    syncAfterStep();

    // 地面吸附（修复斜坡/接触穿透）
    if (state.grounded && !climbing) {
      const g = heightAt(position.x, position.z);
      const feet = root.position.y - ROOT_H;
      if (feet < g && feet > g - 0.4) {
        root.position.y = g + ROOT_H;
        if (root.velocity.y < 0) root.velocity.y = 0;
        position.y = g;
      }
    }

    state.stagger = Math.max(0, state.stagger - dt * 1.5);
  }

  function syncAfterStep() {
    position.set(root.position.x, root.position.y - ROOT_H, root.position.z);
    const newGrounded = detectGrounded();
    const vyBefore = root.velocity.y;

    if (!wasGrounded && newGrounded) {
      const impact = Math.max(0, -state.vy);
      const fall = Math.max(0, apexY - position.y);
      state.landImpact = impact;
      state.fallHeight = fall;
    } else {
      state.landImpact = 0;
      state.fallHeight = 0;
    }
    if (!newGrounded) {
      airTime += _dt;
      if (airTime > 0.02) apexY = Math.max(apexY, position.y);
      else apexY = position.y;
    } else {
      airTime = 0;
      apexY = position.y;
    }
    wasGrounded = newGrounded;
    state.grounded = newGrounded;
    state.vy = vyBefore;
    state.airTime = airTime;

    state.speed = climbing
      ? Math.hypot(root.velocity.x, root.velocity.z)
      : Math.hypot(moveVx, moveVz);
    state.climbing = climbing;
    state.facing = facing;
    state.ragdoll = character.ragdollActive;
    state.holding = grabSys.holding;
    state.dist = boom;
    state.view = view;
    state.run = state.run && state.speed > 0.4;
  }

  // ---------------------------------------------------------------- 相机
  function applyToCamera(cam) {
    const dt = _dt || 1 / 60;
    if (view === 'first') {
      cam.position.set(
        root.position.x,
        root.position.y + EYE_OFF,
        root.position.z
      );
      aimDir(_aim);
      _lookTarget.set(
        cam.position.x + _aim.x * 8,
        cam.position.y + _aim.y * 8,
        cam.position.z + _aim.z * 8
      );
      cam.lookAt(_lookTarget);
      return;
    }

    camY = damp(camY, position.y, 11, dt);
    const pivotX = position.x;
    const pivotY = camY + CAM.pivotHeight;
    const pivotZ = position.z;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp;
    const dy = -Math.sin(pitch);
    const dz = Math.cos(yaw) * cp;
    // 相机在 pivot 的后方：backDir = -aim
    const clear = cameraClear(pivotX, pivotY, pivotZ, -dx, -dy, -dz, dist);
    const targetLen = Math.max(0.7, dist * clear);
    const rate = targetLen < boom ? 30 : 3;
    boom = damp(boom, targetLen, rate, dt);
    if (boom > dist) boom = dist;
    if (boom < 0.7) boom = 0.7;

    let cx = pivotX - dx * boom;
    let cy = pivotY - dy * boom;
    let cz = pivotZ - dz * boom;
    const floor = heightAt(cx, cz) + 0.3;
    if (cy < floor) cy = floor;
    cam.position.set(cx, cy, cz);
    _lookTarget.set(pivotX, pivotY + 0.1, pivotZ);
    cam.lookAt(_lookTarget);
    state.dist = boom;
  }

  function setView(mode) {
    view = mode === 'first' ? 'first' : 'third';
    state.view = view;
    character.setHeadVisible(view !== 'first');
    if (view === 'third') camY = position.y;
    return view;
  }

  function toggleView() {
    return setView(view === 'first' ? 'third' : 'first');
  }

  function zoom(dy) {
    if (!isFinite(dy)) return;
    dist = clamp(dist * Math.exp(dy * 0.0011), CAM.minDist, CAM.maxDist);
  }

  function teleport(x, z) {
    const px = isFinite(x) ? x : SPAWN.x;
    const pz = isFinite(z) ? z : SPAWN.z;
    const g = heightAt(px, pz);
    if (grabSys.holding) grabSys.release(false);
    climbing = false;
    state.climbing = false;
    climbCooldown = 0.45;
    character.teleport(px, g + ROOT_H + 0.02, pz);
    root.velocity.set(0, 0, 0);
    root.angularVelocity.set(0, 0, 0);
    moveVx = 0;
    moveVz = 0;
    position.set(px, g, pz);
    yaw = Math.PI;
    pitch = 0.22;
    facing = Math.PI;
    state.facing = facing;
    state.stamina = 1;
    state.stagger = 0;
    state.ragdoll = false;
    emote = null;
    state.emote = null;
    state.grounded = true;
    wasGrounded = true;
    airTime = 0;
    apexY = g;
    coyote = 0;
    jumpBuffer = 0;
    jumping = 0;
    dist = Math.max(dist, CAM.dist);
    boom = dist;
    camY = g;
    state.landImpact = 0;
    state.fallHeight = 0;
  }

  // 初始出生
  teleport(SPAWN.x, SPAWN.z);
  setView('third');

  return {
    position,
    state,
    get facing() { return facing; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get view() { return view; },
    get boom() { return boom; },
    getZ() { return root.position.z - ROOT_H; },
    update,
    applyToCamera,
    teleport,
    zoom,
    setView,
    toggleView,
    playEmote,
    get emote() { return emote; },
    getView() { return view; },
    grab() { return grabSys.tryGrab(); },
    release() { return grabSys.release(true); },
    isClimbing() { return climbing; },
    get grabSystem() { return grabSys; },
    get isRagdoll() { return character.ragdollActive; },
  };
}

export default createPlayer;
