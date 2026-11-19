import * as THREE from 'three';
import { CFG } from './core/config.js';
import { createSky } from './core/sky.js';
import { createTerrain, heightAt } from './world/terrain.js';
import { createRoads } from './world/roads.js';
import { createBuildings } from './world/buildings.js';
import { createLandmarks } from './world/landmarks.js';
import { createProps } from './world/props.js';
import { createPhysics } from './game/physics.js';
import { createCharacter } from './game/character.js';
import { createPlayer } from './game/player.js';
import { createHUD } from './ui/hud.js';
import { materialCacheSize } from './core/materials.js';
import { createPost } from './core/post.js';

window.__started = true;

const bootEl = document.getElementById('boot');
const barEl = document.querySelector('#bar > i');
const msgEl = document.getElementById('bootmsg');
function progress(p, msg) {
  if (barEl) barEl.style.width = Math.round(p * 100) + '%';
  if (msg && msgEl) msgEl.textContent = msg;
}
function fail(msg, tip) {
  if (window.__fatal) window.__fatal(msg, tip);
  else console.error(msg);
}

// ---------------------------------------------------------------- URL / 画质
// ?cam=x,z          调试相机坐标（y 自动取地面+1.7）
// ?cy= / yaw= / pitch= / dist=
// ?px=x,z           玩家出生点   |  ?q=low|mid|high  画质档
// ?noplayer=1       只渲染场景，不创建角色（截图快）
// ?auto=walk|runjump|grab|fall   无头自动测试，结果写到 body[data-probe]
const Q = new URLSearchParams(location.search);
let quality = ['low', 'mid', 'high'].includes(Q.get('q')) ? Q.get('q') : 'mid';
const qualityDpr = { low: 1, mid: 1.5, high: 2 };

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityDpr[quality]));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = CFG.render.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.render.fov, window.innerWidth / window.innerHeight, CFG.render.near, CFG.render.far);

// 后期：HDR → 泛光 → ACES/暗角/微调色（low 档内部自动直出，失败则回退）
let post = null;
try {
  post = createPost(renderer, scene, camera, { quality });
  post.resize(window.innerWidth, window.innerHeight);
} catch (err) {
  console.warn('[campus] 后期初始化失败，回退直出', err);
  post = null;
}

const hud = createHUD();
progress(0.08, '天空与光照…');
const sky = createSky(scene, renderer);

progress(0.2, '地形与水系…');
const terrain = createTerrain(scene);

progress(0.36, '道路与人行道…');
const roads = createRoads(scene);

progress(0.5, '教学建筑…');
const buildings = createBuildings(scene, {});

progress(0.64, '地标景观…');
const landmarks = createLandmarks(scene);

progress(0.76, '树木与街具…');
const props = createProps(scene, {});

// ---------------------------------------------------------------- 世界 / 物理 / 角色
progress(0.88, '角色与物理…');
const world = {
  heightAt,
  colliders: buildings.colliders || [],
  bounds: { minX: -760, maxX: 1080, minZ: -640, maxZ: 780 },
  grabbables: props.grabbables || [],
  interactables: props.interactables || [],
};
const noplayer = Q.get('noplayer') === '1' || Q.get('noplayer') === 'true';
let physics = null;
let character = null;
let player = null;
if (!noplayer) {
  physics = createPhysics(world);
  character = createCharacter(scene, { world, physics });
  player = createPlayer(scene, camera, world, character, physics);
  window.__game = { player, character, physics, world, scene, camera, renderer };
}

// Q：靠近街具触发坐下 / 喝水 / 看牌（动作由 character 的 emote 姿态播放）
function nearestInteractable() {
  if (!player) return null;
  const list = world.interactables || [];
  let best = null;
  let bd = Infinity;
  for (const it of list) {
    const d = Math.hypot(player.position.x - it.x, player.position.z - it.z);
    const reach = (it.radius || 1.8) + 1.5;
    if (d <= reach && d < bd) { bd = d; best = it; }
  }
  return best;
}
function tryInteract() {
  if (!player) return false;
  const it = nearestInteractable();
  if (!it) return false;
  const act = it.action === 'sit' || it.action === 'drink' || it.action === 'read' ? it.action : 'read';
  player.playEmote?.(act, 2.6);
  const verb = act === 'sit' ? '坐下' : act === 'drink' ? '喝水' : '查看';
  hud.setHint?.(it.label ? `${verb} · ${it.label}` : verb);
  return true;
}

// ---------------------------------------------------------------- 输入
const keys = new Set();
const input = { forward: 0, right: 0, jump: false, run: false, grab: false, climb: false, lookX: 0, lookY: 0 };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') return;
  keys.add(e.code);
  if (CFG.keys.help.some((k) => k === e.code)) hud.toggleHelp();
  if (CFG.keys.respawn.some((k) => k === e.code) && player) player.teleport(0, 12);
  if (CFG.keys.camera.some((k) => k === e.code) && player) player.toggleView();
  if (CFG.keys.quality.some((k) => k === e.code)) cycleQuality();
  if (CFG.keys.interact.some((k) => k === e.code)) tryInteract();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const has = (list) => list.some((k) => keys.has(k));
let mouseDown = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  mouseDown = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!mouseDown) return;
  input.lookX += (e.clientX - lastX) * 0.0026;
  input.lookY += (e.clientY - lastY) * 0.0022;
  lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('pointerup', () => { mouseDown = false; });
window.addEventListener('pointercancel', () => { mouseDown = false; });
canvas.addEventListener('wheel', (e) => { player?.zoom?.(e.deltaY); }, { passive: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function applyQuality(name) {
  quality = name;
  const dpr = Math.min(window.devicePixelRatio || 1, qualityDpr[name] || 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const sh = CFG.quality?.[name]?.shadows || (name === 'low' ? 1024 : 2048);
  scene.traverse((o) => {
    if (o.isLight && o.shadow) o.shadow.mapSize.set(sh, sh);
  });
  if (post) {
    post.setQuality(name);
    post.resize(window.innerWidth, window.innerHeight);
  }
}
function cycleQuality() {
  const order = ['low', 'mid', 'high'];
  const i = order.indexOf(quality);
  applyQuality(order[(i + 1) % order.length]);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, qualityDpr[quality] || 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (post) post.resize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- 调试相机
const dbgCam = Q.get('cam') ? Q.get('cam').split(',').map(Number) : null;
const dbgCamY = Q.has('cy') ? parseFloat(Q.get('cy')) : null;
const dbgYaw = Q.has('yaw') ? parseFloat(Q.get('yaw')) : 0.6;
const dbgPitch = Q.has('pitch') ? parseFloat(Q.get('pitch')) : 0.28;
const dbgDist = Q.has('dist') ? parseFloat(Q.get('dist')) : 9;
if (Q.get('px') && player) {
  const [px, pz] = Q.get('px').split(',').map(Number);
  player.teleport(px, pz);
}
if (player && Q.get('view') === 'first') player.setView('first');

// ---------------------------------------------------------------- 自动测试
const probe = {
  mode: Q.get('auto') || null,
  errors: [],
  noplayer,
  started: Date.now(),
};
window.addEventListener('error', (e) => probe.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => probe.errors.push('rejection:' + String(e.reason)));
window.__probe = probe;

// ?probe=1：同步跑数值测试（不依赖渲染帧，无头环境也能快速拿结果）
if (Q.get('probe') === '1' && player) {
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(0.5);
  renderer.setSize(480, 300, false);
  const suite = {};
  const inp = { forward: 0, right: 0, jump: false, run: false, grab: false, climb: false, lookX: 0, lookY: 0 };
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      player.update(1 / 60, inp);
      character.update(1 / 60, player.state || {});
    }
  };
  const clearInp = () => {
    inp.forward = 0; inp.right = 0; inp.jump = false;
    inp.run = false; inp.grab = false;
  };
  const reset = () => { clearInp(); player.teleport(0, 12); step(30); };
  const V = THREE.Vector3;
  try {
    // 1) 行走
    reset();
    const p0 = player.position.clone();
    const walkDiag = [];
    inp.forward = 1;
    for (let i = 0; i < 120; i++) {
      player.update(1 / 60, inp);
      character.update(1 / 60, player.state || {});
      if (i % 20 === 0) {
        const cts = [];
        for (const c of physics.world.contacts) {
          const other = c.bi === character.root ? c.bj : (c.bj === character.root ? c.bi : null);
          if (other && cts.length < 6) {
            cts.push({
              kind: other.userData ? other.userData.kind : '?',
              ny: +c.ni.y.toFixed(2),
              py: +other.position.y.toFixed(2),
              mass: other.mass,
            });
          }
        }
        walkDiag.push({
          i,
          speed: +player.state.speed.toFixed(2),
          grounded: player.state.grounded,
          vy: +player.state.vy.toFixed(2),
          x: +player.position.x.toFixed(2),
          z: +player.position.z.toFixed(2),
          rx: +character.root.position.x.toFixed(2),
          rz: +character.root.position.z.toFixed(2),
          ry: +character.root.position.y.toFixed(3),
          vx: +character.root.velocity.x.toFixed(2),
          vz: +character.root.velocity.z.toFixed(2),
          contacts: physics.world.contacts.length,
          cts,
        });
      }
    }
    clearInp();
    suite.walk = { dist: +p0.distanceTo(player.position).toFixed(3), diag: walkDiag };

    // 2) 跑跳：水平位移与跳高
    reset();
    inp.forward = 1; inp.run = true; step(24);
    const jumpBaseY = player.position.y;
    let apex2 = jumpBaseY;
    inp.jump = true;
    const jumpRec = [];
    for (let i = 0; i < 10; i++) {
      player.update(1 / 60, inp);
      character.update(1 / 60, player.state || {});
      apex2 = Math.max(apex2, player.position.y);
      jumpRec.push({
        i,
        vy: +character.root.velocity.y.toFixed(2),
        y: +player.position.y.toFixed(2),
        g: player.state.grounded,
      });
    }
    inp.jump = false;
    let air = false, apex = player.position.y, takeoff = null, landed = false;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60, inp);
      character.update(1 / 60, player.state || {});
      apex = Math.max(apex, player.position.y);
      apex2 = Math.max(apex2, player.position.y);
      if (!air && !player.state.grounded) { air = true; takeoff = player.position.clone(); }
      if (air && player.state.grounded) { landed = true; break; }
    }
    clearInp();
    suite.jump = {
      landed, air,
      horizontal: takeoff ? +Math.hypot(player.position.x - takeoff.x, player.position.z - takeoff.z).toFixed(3) : 0,
      height: +(apex2 - jumpBaseY).toFixed(3),
      rec: jumpRec,
    };

    // 3) 抓取：抓起后后退拖动，再扔出
    reset();
    step(10);
    const grabbed = player.grab();
    const gs = player.grabSystem;
    const held = gs ? gs.heldBody : null;
    const gp0 = held ? new V().copy(held.position) : null;
    inp.forward = -1; step(110); clearInp();
    const moveDist = held && gp0 ? +gp0.distanceTo(new V().copy(held.position)).toFixed(3) : 0;
    const relAt = held ? new V().copy(held.position) : null;
    player.release();
    step(40);
    const throwDist = held && relAt ? +relAt.distanceTo(new V().copy(held.position)).toFixed(3) : 0;
    suite.grab = { grabbed, moveDist, throwDist, label: held && held.userData ? held.userData.label : null };

    // 4) 高处摔落 → 布娃娃 → 起身
    reset();
    const gy = heightAt(0, 18);
    character.teleport(0, gy + 26, 18);
    let seen = false, recovered = false, ragdollT = 0;
    for (let i = 0; i < 720; i++) {
      player.update(1 / 60, inp);
      character.update(1 / 60, player.state || {});
      if (character.ragdollActive) { seen = true; ragdollT += 1 / 60; }
      if (seen && !character.ragdollActive) { recovered = true; break; }
    }
    suite.fall = { seen, recovered, ragdollT: +ragdollT.toFixed(2) };

    // 5) 攀爬：传送到最近未旋转建筑墙前，按 F 贴墙上爬
    const wall = pickClimbWall();
    if (wall) {
      clearInp();
      player.teleport(wall.x, wall.z + (wall.d || 10) / 2 + 0.72);
      step(24);
      const y0 = player.position.y;
      let climbSeen = false, mantle = false;
      inp.forward = 1;
      inp.climb = true;
      for (let i = 0; i < 150; i++) {
        player.update(1 / 60, inp);
        character.update(1 / 60, player.state || {});
        if (player.state.climbing) climbSeen = true;
        if (player.position.y - y0 > 1.2) { mantle = true; break; }
      }
      clearInp();
      step(20);
      suite.climb = {
        wall: wall.name || 'wall',
        climbSeen,
        dy: +(player.position.y - y0).toFixed(2),
        mantle,
      };
    } else {
      suite.climb = { wall: null, climbSeen: false };
    }

    // 6) 相机 boom：背靠建筑外墙，第三人称应自动拉近
    const camWall = pickClimbWall();
    if (camWall) {
      clearInp();
      player.teleport(camWall.x, camWall.z - (camWall.d || 10) / 2 - 0.75);
      step(6);
      const d0 = player.state.dist;
      for (let i = 0; i < 45; i++) {
        player.update(1 / 60, inp);
        character.update(1 / 60, player.state || {});
        player.applyToCamera(camera);
      }
      const dBoom = player.state.dist;
      suite.camera = { start: +d0.toFixed(2), boom: +dBoom.toFixed(2), shrunk: dBoom < d0 - 0.4 };
    } else {
      suite.camera = { start: null, boom: null, shrunk: false };
    }

    // 7) Q 互动：坐下姿态播放后自动恢复；interactables 数量
    reset();
    player.playEmote('sit', 2.6);
    step(9);
    const emoteOn = !!(player.state.emote && player.state.emote.name === 'sit');
    step(170);
    const emoteOff = !player.state.emote;
    suite.emote = {
      on: emoteOn, off: emoteOff,
      count: (world.interactables || []).length,
    };

    suite.ok = probe.errors.length === 0 && suite.walk.dist > 1.5 &&
      suite.jump.landed && suite.jump.horizontal > 1.5 &&
      suite.jump.height > 0.6 &&
      suite.grab.moveDist > 0.5 &&
      (!suite.climb.wall || suite.climb.climbSeen) &&
      (!suite.emote || (suite.emote.on && suite.emote.off)) &&
      (!suite.camera.start || suite.camera.shrunk);
  } catch (err) {
    suite.error = String((err && err.stack) || err);
    suite.ok = false;
  }
  probe.suite = suite;
  document.body.dataset.probe = JSON.stringify(probe);
  console.log('[probe-suite]', JSON.stringify(probe));
}

const AUTO = Q.get('auto') || '';
const auto = AUTO ? {
  mode: AUTO, t: 0, done: false,
  start: null, airStart: null, apex: 0, phase: '',
  grabStart: null, grabOk: false, throwStart: null, throwDist: 0,
  ragdollSeen: false, ragdollAt: 0, recovered: false,
  fallHeight: 0, landImpact: 0, climbWall: null, climbStarted: undefined,
} : null;

// 无头截图用：右上角实时输出自动探针状态（AUTO {t,pos,grounded,state}）
const autoEl = AUTO ? (() => {
  const el = document.createElement('div');
  el.id = 'auto-hud';
  el.style.cssText = 'position:fixed;right:10px;top:10px;z-index:99999;font:12px/1.45 ui-monospace,Consolas,monospace;color:#eaf6ff;background:rgba(8,16,26,.72);border:1px solid rgba(120,200,255,.35);border-radius:8px;padding:7px 10px;white-space:pre;pointer-events:none;text-shadow:0 1px 2px #000';
  document.body.appendChild(el);
  return el;
})() : null;

function autoHud(t) {
  if (!autoEl) return;
  const p = player ? player.position : { x: 0, y: 0, z: 0 };
  const st = (player && player.state) || {};
  const flags = [
    st.grounded ? 'G' : 'AIR',
    st.climbing ? 'CLIMB' : '',
    st.ragdoll ? 'RAGDOLL' : '',
    st.holding ? 'HOLD' : '',
    st.run ? 'RUN' : '',
    'v=' + (st.speed || 0).toFixed(1),
  ].filter(Boolean).join(' ');
  autoEl.textContent = 'AUTO ' + auto.mode + (auto.phase ? ' [' + auto.phase + ']' : '') +
    ' t=' + t.toFixed(2) + '\npos=(' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1) + ')\n' + flags;
}

// 选一个离出生点最近、未旋转、够高的建筑当攀爬靶子
function pickClimbWall() {
  let best = null, bestD = 1e9;
  for (const c of (world.colliders || [])) {
    if (!c || !(c.h > 5) || !(c.w > 2) || !(c.d > 2)) continue;
    if (Math.abs(c.rot || 0) > 0.02) continue;
    const d = Math.hypot(c.x - 0, c.z - 18);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function autoFinish(reason) {
  if (!auto || auto.done) return;
  auto.done = true;
  input.forward = 0; input.right = 0; input.jump = false;
  input.run = false; input.grab = false; input.climb = false;
  probe.reason = reason;
  probe.elapsed = +(performance.now() / 1000).toFixed(2);
  probe.fps = +fps.toFixed(1);
  probe.drawCalls = (post && post.info) ? post.info.calls : renderer.info.render.calls;
  probe.position = player ? { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2) } : null;
  const j = probe.jump, g = probe.grab, w = probe.walk, f = probe.fall;
  probe.ok = probe.errors.length === 0 && (
    auto.mode === 'walk' ? !!(w && w.dist > 1.5) :
    auto.mode === 'runjump' ? !!(j && j.landed && j.horizontal > 1.5) :
    auto.mode === 'grab' ? !!(g && g.grabOk && g.moveDist > 0.5) :
    auto.mode === 'fall' ? !!(f && f.triggered) : true
  );
  document.body.dataset.probe = JSON.stringify(probe);
  console.log('[probe]', JSON.stringify(probe));
  autoHud(auto.t);
}

function autoStep(dt) {
  if (!auto || auto.done || !player) return;
  auto.t += dt;
  const t = auto.t;
  autoHud(t);
  input.forward = 0; input.right = 0; input.jump = false;
  input.run = false; input.grab = false; input.climb = false;

  if (auto.mode === 'walk') {
    if (t > 0.2 && t < 1.9) input.forward = 1;
    if (!auto.start && t > 0.25) auto.start = player.position.clone();
    if (t > 2.05) {
      if (auto.start) probe.walk = { dist: +auto.start.distanceTo(player.position).toFixed(3) };
      autoFinish('walk done');
    }
  } else if (auto.mode === 'runjump') {
    if (t > 0.2 && t < 3.4) { input.forward = 1; input.run = true; }
    if (t > 0.65 && t < 0.9) input.jump = true;
    if (!auto.start && t > 0.25) auto.start = player.position.clone();
    if (!player.state.grounded) {
      if (!auto.airStart) {
        auto.airStart = player.position.clone();
        auto.apex = player.position.y;
      }
      auto.apex = Math.max(auto.apex, player.position.y);
    } else if (auto.airStart) {
      probe.jump = {
        horizontal: +auto.airStart.distanceTo(new THREE.Vector3(player.position.x, auto.airStart.y, player.position.z)).toFixed(3),
        height: +(auto.apex - auto.airStart.y).toFixed(3),
        apex: +auto.apex.toFixed(3),
        landed: true,
        airTime: +player.state.airTime.toFixed(2),
      };
      autoFinish('jump landed');
    }
    if (t > 3.6) {
      if (!probe.jump) probe.jump = { horizontal: 0, height: 0, landed: !!player.state.grounded };
      autoFinish('runjump timeout');
    }
  } else if (auto.mode === 'grab') {
    if (t > 0.3 && t < 0.42) input.grab = true;
    if (t > 0.8 && t < 2.1) input.forward = -1; // 后退，把东西拖走
    if (t > 2.3 && t < 2.42) input.grab = true;  // 再按 E 扔出
    const gs = player.grabSystem;
    if (!auto.grabOk && gs && gs.holding && t > 0.45) {
      auto.grabOk = true;
      auto.grabStart = gs.heldBody ? gs.heldBody.position.clone() : null;
    }
    if (auto.grabStart && t > 2.2 && !probe.grab) {
      const body = gs && (gs.heldBody || gs.lastHeldBody);
      const end = body ? new THREE.Vector3(body.position.x, body.position.y, body.position.z) : null;
      probe.grab = {
        grabOk: auto.grabOk,
        moveDist: end ? +auto.grabStart.distanceTo(end).toFixed(3) : 0,
        holding: !!(gs && gs.holding),
        throws: gs ? gs.throwCount : 0,
      };
    }
    if (t > 3.0) {
      if (!probe.grab) probe.grab = { grabOk: auto.grabOk, moveDist: 0 };
      autoFinish('grab done');
    }
  } else if (auto.mode === 'fall') {
    if (t > 0.15 && !auto.fallSet) {
      auto.fallSet = true;
      character.teleport(0, heightAt(0, 18) + 26, 18);
    }
    if (character.ragdollActive && !auto.ragdollSeen) {
      auto.ragdollSeen = true;
      auto.ragdollAt = t;
      probe.fall = { triggered: true, recovered: false, t: +t.toFixed(2) };
    }
    if (auto.ragdollSeen && !character.ragdollActive && !auto.recovered && t > auto.ragdollAt + 0.2) {
      auto.recovered = true;
      probe.fall.recovered = true;
      probe.fall.recoverT = +(t - auto.ragdollAt).toFixed(2);
      autoFinish('fall recovered');
    }
    if (t > 6.5) {
      if (!probe.fall) probe.fall = { triggered: false, recovered: false };
      autoFinish('fall timeout');
    }
  } else if (auto.mode === 'run') {
    if (t > 0.12 && t < 1.8) { input.forward = 1; input.run = true; }
    if (t > 2.0) autoFinish('run done');
  } else if (auto.mode === 'jump') {
    if (t > 0.05 && t < 1.7) input.forward = 1;
    if (t > 0.3 && t < 0.66) input.jump = true;
    if (!auto.airSeen && !player.state.grounded) { auto.airSeen = true; auto.apex = player.position.y; }
    if (auto.airSeen) auto.apex = Math.max(auto.apex, player.position.y);
    if (auto.airSeen && player.state.grounded && t > 0.75) {
      probe.jump = {
        landed: true,
        height: +(auto.apex - heightAt(player.position.x, player.position.z)).toFixed(2),
        airTime: +player.state.airTime.toFixed(2),
      };
      autoFinish('jump landed');
    }
    if (t > 2.2) autoFinish('jump timeout');
  } else if (auto.mode === 'climb') {
    if (!auto.climbWall && t > 0.02) {
      auto.climbWall = pickClimbWall();
      if (auto.climbWall) {
        const c = auto.climbWall;
        player.teleport(c.x, c.z + (c.d || 10) / 2 + 0.72);
      }
    }
    if (t > 0.10 && t < 1.8) { input.forward = 1; input.climb = true; }
    if (auto.climbStarted === undefined && player.state.climbing) auto.climbStarted = t;
    if (t > 2.0) autoFinish(player.state.climbing ? 'climbing' : 'climb attempt');
  } else if (auto.mode === 'full') {
    // 完整演示：走 2s → 跑 2.4s → 跳 3 次 → E 抓 → 贴墙 F
    if (t < 2.2) { auto.phase = 'walk'; input.forward = 1; }
    else if (t < 4.6) { auto.phase = 'run'; input.forward = 1; input.run = true; }
    else if (t < 6.8) {
      auto.phase = 'jump';
      input.forward = 1;
      input.jump = ((t - 4.6) % 0.72) < 0.24;
    } else if (t < 8.4) {
      auto.phase = 'grab';
      input.grab = (t > 6.95 && t < 7.1) || (t > 7.85 && t < 8.0);
    } else if (t < 10.6) {
      auto.phase = 'climb';
      if (!auto.climbWall) {
        auto.climbWall = pickClimbWall();
        if (auto.climbWall) {
          const c = auto.climbWall;
          player.teleport(c.x, c.z + (c.d || 10) / 2 + 1.05);
        }
      }
      if (t > 8.7) { input.forward = 1; input.climb = true; }
    } else autoFinish('full done');
  }
}

// ---------------------------------------------------------------- 主循环
let last = performance.now();
let acc = 0, frames = 0, fps = 60;
const clockStart = performance.now();
const posV = new THREE.Vector3();
let lowFpsTime = 0, degraded = false;

function tick(now) {
  requestAnimationFrame(tick);
  const dtRaw = (now - last) / 1000;
  last = now;
  const dt = Math.min(dtRaw, 0.05);

  input.forward = (has(CFG.keys.forward) ? 1 : 0) - (has(CFG.keys.back) ? 1 : 0);
  input.right = (has(CFG.keys.right) ? 1 : 0) - (has(CFG.keys.left) ? 1 : 0);
  input.jump = has(CFG.keys.jump);
  input.run = has(CFG.keys.run);
  input.grab = has(CFG.keys.grab);
  input.climb = has(CFG.keys.climb);

  if (auto) autoStep(dt);

  if (player) {
    player.update(dt, input);
    input.lookX = 0; input.lookY = 0;
    if (dbgCam) {
      // 调试：镜头固定在指定坐标，俯视看向校区
      const [cx, cz] = dbgCam;
      const cy = dbgCamY != null ? dbgCamY : heightAt(cx, cz) + 1.7;
      camera.position.set(cx, cy, cz);
      const lookAt = new THREE.Vector3(
        cx + Math.sin(dbgYaw) * Math.cos(dbgPitch) * 60,
        cy - Math.sin(dbgPitch) * 60,
        cz + Math.cos(dbgYaw) * Math.cos(dbgPitch) * 60
      );
      camera.lookAt(lookAt);
    } else {
      player.applyToCamera?.(camera);
    }
    hud.setHeading?.(player.yaw);
    character.update(dt, player.state || {});
    if (player.state) player.state.dist = player.state.dist ?? dbgDist;
  } else if (dbgCam) {
    const [cx, cz] = dbgCam;
    const cy = dbgCamY != null ? dbgCamY : heightAt(cx, cz) + 1.7;
    camera.position.set(cx, cy, cz);
    const lookAt = new THREE.Vector3(
      cx + Math.sin(dbgYaw) * Math.cos(dbgPitch) * 60,
      cy - Math.sin(dbgPitch) * 60,
      cz + Math.cos(dbgYaw) * Math.cos(dbgPitch) * 60
    );
    camera.lookAt(lookAt);
  } else {
    camera.position.set(0, heightAt(0, 18) + 1.7, 18);
    camera.lookAt(0, heightAt(0, 0) + 1.2, 0);
  }

  sky.update((now - clockStart) / 1000, camera);
  sky.follow(player ? player.position : camera.position);
  hud.update(dt);

  if (post) post.render(dt);
  else renderer.render(scene, camera);

  acc += dtRaw; frames++;
  if (acc > 0.5) {
    fps = frames / acc; frames = 0; acc = 0;
    if (player) {
      posV.copy(player.position);
      hud.setStats(Math.round(fps), `x ${posV.x.toFixed(0)} z ${posV.z.toFixed(0)}`, `${(post && post.info) ? post.info.calls : renderer.info.render.calls}`);
    } else {
      hud.setStats(Math.round(fps), '场景预览', `${(post && post.info) ? post.info.calls : renderer.info.render.calls}`);
    }
    // 帧率过低自动降档（只降一次，避免抖动）
    if (!degraded && quality !== 'low') {
      lowFpsTime = fps < 26 ? lowFpsTime + 0.5 : 0;
      if (lowFpsTime > 1.5) {
        degraded = true;
        lowFpsTime = 0;
        applyQuality('low');
        console.warn('[campus] 帧率偏低，画质自动降为 low');
      }
    }
  }
}

// 首帧渲染完成后再淡出载入层
if (Q.get('probe') === '1') {
  // 数值自检模式：不启动渲染循环，页面立即空闲，便于无头 dump-dom 快速退出
  document.title = 'PROBE_READY';
} else {
  progress(1.0, '就绪');
  renderer.compile(scene, camera);
  requestAnimationFrame((t) => {
    last = t;
    renderer.render(scene, camera);
    tick(t);
    bootEl?.classList.add('hidden');
    setTimeout(() => { if (bootEl) bootEl.style.display = 'none'; }, 800);
    hud.setZone('五羊广场', '博文明理 · 厚德济世');
    console.log('[campus] 材质缓存', materialCacheSize(), '建筑', buildings.colliders?.length ?? 0, '物理体', physics ? physics.world.bodies.length : 0);
  });
}

window.addEventListener('error', (e) => fail('运行出错：' + e.message, '可尝试按 P 降低画质或刷新页面。'));
