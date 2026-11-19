// HUD 总装：区域名 / 罗盘 / 状态 / 提示 / 帮助 / 地图 / 移动端控件。
// 只依赖模板里已有的 DOM（id 见 build/template.html），新增的容器一律由 JS 创建。
import { createCompass } from './compass.js';
import { createMap } from './map.js';
import { createTouch, releaseHeldKeys } from './touch.js';
import { zoneAt } from './zone.js';

const TAU = Math.PI * 2;

const CSS = `
/* 区域名淡入淡出 */
#zone{transition:opacity .18s ease}
#zone.z-fade{opacity:0}
/* 状态数字 */
#stats b.low{color:#ffd479!important}
#stats b{font-variant-numeric:tabular-nums}
/* 键位表底部那行「按 H 查看完整操作 · R 回广场 · M 地图」：压窄一点，别让「图」掉行 */
#keys .tog{font-size:10.5px;letter-spacing:0;line-height:1.75}
#keys .tog kbd{min-width:15px;padding:0 4px;font-size:10px;margin:0}
/* 提示条：允许换行，小屏不溢出 */
#hint{max-width:min(600px,calc(100vw - 32px));white-space:normal;text-align:center;line-height:1.6}
#hint kbd{font-family:inherit}
/* 小屏：收窄区域名、隐藏常驻键位表（保留 H 帮助与 M 地图入口） */
@media (max-width:760px){
  /* 顶部三件套：地图按钮(左) + 区域名(中) + 罗盘(右)，互不遮挡 */
  #zone{left:76px;right:auto;top:14px;transform:none;max-width:calc(100vw - 208px);padding:7px 12px;text-align:center}
  #zone b{font-size:13px;letter-spacing:.1em}
  #zone small{font-size:10px;letter-spacing:.04em}
  #stats{font-size:10px;min-width:0;padding:8px 10px;right:12px;bottom:12px}
  #keys{display:none}
  #compass{right:12px;top:12px;width:104px;height:104px}
  #compass canvas{width:92px;height:92px}
  #help .cols{grid-template-columns:1fr;gap:4px 0}
  #help .card{padding:20px 18px;max-height:88vh;overflow:auto}
  #help .foot{flex-direction:column;align-items:flex-start;gap:12px}
  #hint{bottom:110px;font-size:12px}
}
/* 移动端地图入口（桌面用 M） */
#mapbtn{position:fixed;left:16px;top:16px;z-index:26;display:none;align-items:center;justify-content:center;
  width:52px;height:52px;padding:0;border-radius:50%;cursor:pointer;
  border:1px solid rgba(255,255,255,.18);background:rgba(12,20,26,.72);color:#eef2f4;
  font-family:inherit;font-size:11.5px;letter-spacing:.1em;
  box-shadow:0 8px 22px rgba(0,0,0,.35);backdrop-filter:blur(9px) saturate(1.1);
  transition:background .16s,border-color .16s}
#mapbtn:active{background:rgba(255,212,121,.2);border-color:rgba(255,212,121,.55)}
.touch-ui #mapbtn{display:flex}
`;

let cssDone = false;
function injectCSS() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'campus-hud-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function param(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (e) {
    return null;
  }
}
function sessionGet(k) {
  try { return window.sessionStorage.getItem(k); } catch (e) { return null; }
}
function sessionSet(k, v) {
  try { window.sessionStorage.setItem(k, v); } catch (e) { /* 忽略 */ }
}
function escHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 相机 yaw → 罗盘方位角（0=北，顺时针）。世界约定：yaw 0 看向 +z（正南），yaw π/2 看向 +x（正东）。
export function bearingOf(yaw) {
  const b = Math.PI - yaw;
  return ((b % TAU) + TAU) % TAU;
}

export function createHUD() {
  injectCSS();

  const $ = (id) => document.getElementById(id);
  const zoneEl = $('zone');
  const zoneName = zoneEl ? zoneEl.querySelector('b') : null;
  const zoneSub = zoneEl ? zoneEl.querySelector('small') : null;
  const fpsEl = $('s-fps');
  const drawEl = $('s-draw');
  const posEl = $('s-pos');
  const hintEl = $('hint');
  const helpEl = $('help');
  const helpClose = $('help-close');
  const dotEl = $('dot');
  const cpc = $('cpc');

  const state = {
    pose: null,
    heading: 0,
    hasHeading: false,
    yaw: 0,
    yawSign: Number(param('uiyawsign') || '1') || 1,
    t: 0,
    zoneTick: 0,
    lastZonePos: null,
    zoneName: '',
    zoneSub: '',
    manualZoneUntil: 0,
    seenHelp: sessionGet('campus-help-seen') === '1',
    helpOpen: false,
    hintText: '',
    mapOpen: false,
    bootDone: false,
    helpAutoTimer: 0,
    fps: 0,
    compassTick: 1,
    hintAt: 0,
    hintTick: 0,
    hintAuto: false,
    statsAt: 0, // 上次外部 setStats 的时间（用于兜底）
    frameCount: 0,
    frameAcc: 0,
    localFps: 0,
    probeAt: 0,
    drawnHeading: -99,
  };

  // 初始朝向：允许用 ?yaw=0.6 与截图脚本对齐
  const yawParam = param('yaw');
  if (yawParam != null && yawParam !== '') {
    const v = parseFloat(yawParam);
    if (Number.isFinite(v)) {
      state.yaw = v;
      state.heading = bearingOf(v);
    }
  } else {
    // player.js 初始 yaw = Math.PI（看向正北），与场地一致；随后由 window.__game 探针接管
    state.yaw = Math.PI;
    state.heading = bearingOf(Math.PI);
  }

  // ---------------- 罗盘 ----------------
  const compass = createCompass(cpc);
  compass.draw(state.heading);

  // ---------------- 地图 ----------------
  const map = createMap({
    getPose: () => ({
      x: state.pose ? state.pose.x : 0,
      z: state.pose ? state.pose.z : 0,
      heading: state.heading,
    }),
    onOpen: () => {
      state.mapOpen = true;
      state.seenHelp = true;
      setHint(null);
      releaseHeldKeys();
      syncModal();
    },
    onClose: () => {
      state.mapOpen = false;
      syncModal();
      // 关地图后立刻刷一次区域名，避免读图期间错过了判定
      state.zoneTick = 99;
    },
  });

  // ---------------- 移动端 ----------------
  const touch = createTouch({
    onInput: (d) => {
      // 若外部（physicist）没有接管视角，这里让罗盘仍能跟着手指转
      if (d.type === 'look' && !state.hasHeading) {
        state.yaw -= (d.dx || 0) * 0.0026 * state.yawSign;
        state.heading = bearingOf(state.yaw);
        state.compassTick = 1;
      }
    },
  });

  // 移动端地图按钮（桌面有 M 键，这里只在触屏模式出现）
  const mapBtn = document.createElement('button');
  mapBtn.id = 'mapbtn';
  mapBtn.type = 'button';
  mapBtn.title = '校园地图';
  mapBtn.setAttribute('aria-label', '打开校园地图');
  mapBtn.textContent = '地图';
  mapBtn.addEventListener('click', (e) => {
    e.preventDefault();
    map.toggle();
  });
  document.body.appendChild(mapBtn);

  // ---------------- 模态状态 ----------------
  function syncModal() {
    const open = state.mapOpen || state.helpOpen;
    window.__uiModal = open;
    window.dispatchEvent(new CustomEvent('ui-modal', { detail: { open } }));
  }

  // ---------------- 区域名 ----------------
  let zoneFadeTimer = 0;
  function applyZone(name, sub) {
    if (!zoneName) return;
    if (name === state.zoneName && sub === state.zoneSub) return;
    state.zoneName = name;
    state.zoneSub = sub;
    if (zoneEl && zoneEl.classList.contains('z-fade')) {
      zoneName.textContent = name;
      if (zoneSub) zoneSub.textContent = sub;
      return;
    }
    if (zoneEl) zoneEl.classList.add('z-fade');
    clearTimeout(zoneFadeTimer);
    zoneFadeTimer = setTimeout(() => {
      zoneName.textContent = name;
      if (zoneSub) zoneSub.textContent = sub;
      if (zoneEl) zoneEl.classList.remove('z-fade');
    }, 150);
  }

  function autoZone() {
    if (!state.pose) return;
    if (performance.now() < state.manualZoneUntil) return;
    const zn = zoneAt(state.pose.x, state.pose.z);
    const sub = zn.name === '五羊广场' ? '博文明理 · 厚德济世' : zn.sub;
    applyZone(zn.name, sub);
  }

  function setZone(name, sub) {
    if (name == null || name === '') return;
    state.manualZoneUntil = performance.now() + 1600;
    const s = sub == null ? state.zoneSub : String(sub);
    applyZone(String(name), s);
  }

  // ---------------- 状态数字 ----------------
  // 可选联调探针：若页面把游戏对象挂到 window 上（physicist 可选用），
  // 即使 main.js 的 setStats 还没接上，HUD 也能读到真实的坐标 / 绘制调用。
  function probe() {
    const g = window.__game || window.__campus || null;
    const p = (g && (g.player || g.character)) || window.__player || null;
    const v = p && (p.position || (p.body && p.body.position));
    const out = { pose: null, yaw: null, draws: null };
    if (v && Number.isFinite(v.x) && Number.isFinite(v.z)) out.pose = { x: +v.x, z: +v.z };
    if (p) {
      if (typeof p.getYaw === 'function') {
        const y = p.getYaw();
        if (Number.isFinite(y)) out.yaw = y;
      } else if (Number.isFinite(p.yaw)) out.yaw = p.yaw;
    }
    const r = (g && (g.renderer || g.render)) || window.__renderer || null;
    const calls = r && r.info && r.info.render ? r.info.render.calls : null;
    if (Number.isFinite(calls)) out.draws = calls;
    return out;
  }

  // 外部 setStats 长时间不来时，用自己测的帧率把占位符填掉（至少不是「---」）
  function writeLocalStats() {
    if (fpsEl && state.localFps > 0) {
      const txt = String(Math.round(state.localFps));
      if (fpsEl.textContent !== txt) fpsEl.textContent = txt;
      fpsEl.classList.toggle('low', state.localFps < 45);
    }
    if (posEl && posEl.textContent === '--') {
      posEl.textContent = state.pose
        ? 'x ' + Math.round(state.pose.x) + ' z ' + Math.round(state.pose.z)
        : 'x -- z --';
    }
    if (drawEl && drawEl.textContent === '--') drawEl.textContent = '—';
  }

  function setStats(fps, posText, drawCalls) {
    state.statsAt = performance.now();
    if (typeof fps === 'number' && Number.isFinite(fps)) {
      state.fps = fps;
      if (fpsEl) {
        const txt = String(Math.round(fps));
        if (fpsEl.textContent !== txt) fpsEl.textContent = txt;
        fpsEl.classList.toggle('low', fps > 0 && fps < 45);
      }
    }
    if (drawCalls != null && drawEl) {
      const txt = String(drawCalls);
      if (drawEl.textContent !== txt) drawEl.textContent = txt;
    }
    if (posText != null && posEl) {
      // main.js 用 toFixed(0)，在 x=-0.4 这类位置会得到「-0」，看着像 bug
      const s = String(posText).replace(/(^|[^\d])-0(?![.\d])/g, '$10');
      if (posEl.textContent !== s) posEl.textContent = s;
      const m = /x\s*(-?\d+(?:\.\d+)?)\s*z\s*(-?\d+(?:\.\d+)?)/i.exec(s);
      if (m) {
        state.pose = { x: parseFloat(m[1]), z: parseFloat(m[2]) };
        state.zoneTick = Math.max(state.zoneTick, 0.35); // 第一次拿到坐标后尽快算一次
      }
    }
  }

  // ---------------- 提示条 ----------------
  function formatHint(text) {
    return escHTML(text).replace(/按\s*([A-Z])(?![A-Za-z])/g, (m, key) => '按 <kbd>' + key + '</kbd>');
  }

  function setHint(text) {
    state.hintAt = performance.now();
    state.hintAuto = false;
    applyHint(text);
  }

  function applyHint(text) {
    if (!hintEl) return;
    const t = text == null ? '' : String(text).trim();
    if (t === state.hintText) {
      hintEl.classList.toggle('on', !!t);
      return;
    }
    state.hintText = t;
    if (!t) {
      hintEl.classList.remove('on');
      if (dotEl) dotEl.classList.remove('act');
      return;
    }
    hintEl.innerHTML = formatHint(t);
    hintEl.classList.add('on');
    if (dotEl) {
      // 可抓取/可交互时，准星同步放大
      if (/抓|拿起|抱起|可互动|坐下/.test(t)) dotEl.classList.add('act');
      else dotEl.classList.remove('act');
    }
  }

  // 就近提示：main.js 没有 setHint 调用点，HUD 自己从 window.__game 推断
  // （可抓物 / 攀爬中 / 体力不足）。外部一旦调用 setHint，就先让位 1.5 s。
  function nearestGrabbable(pos, items, reach) {
    if (!pos || !items || !items.length) return null;
    let best = null;
    let bestD = reach;
    for (const it of items) {
      const b = it && (it.body || it.mesh);
      const p = b && b.position;
      if (!p) continue;
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const dy = p.y - pos.y;
      if (Math.abs(dy) > 1.8) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  function autoHint() {
    if (state.helpOpen || state.mapOpen) {
      if (state.hintAuto) applyHint(null);
      return;
    }
    if (performance.now() - state.hintAt < 1500) return;
    const g = window.__game;
    const p = g && g.player;
    if (!p) return;
    const gs = p.grabSystem || null;
    const st = p.state || {};
    let text = null;
    if (gs && gs.holding) {
      text = '按 E 放下';
    } else if (typeof p.isClimbing === 'function' && p.isClimbing()) {
      text = '按住 F 攀爬 · Space 松手';
    } else {
      const near = nearestGrabbable(p.position, gs && gs.items, 2.2);
      if (near) text = '按 E 抓起 ' + (near.label || '道具');
      else if (Number.isFinite(st.stamina) && st.stamina <= 0.08) text = '体力不足 · 松开 Shift 走一会儿';
    }
    if (text !== state.hintText || !state.hintAuto) {
      state.hintAuto = !!text;
      applyHint(text);
    }
  }

  // ---------------- 帮助面板 ----------------
  function setHelp(open) {
    if (!helpEl) return;
    if (state.helpOpen === open) return;
    state.helpOpen = open;
    helpEl.classList.toggle('hidden', !open);
    helpEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      releaseHeldKeys();
      if (helpClose && helpClose.focus) {
        try { helpClose.focus({ preventScroll: true }); } catch (e) { helpClose.focus(); }
      }
    } else {
      state.seenHelp = true;
      sessionSet('campus-help-seen', '1');
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    syncModal();
  }

  function toggleHelp() {
    setHelp(!state.helpOpen);
  }

  if (helpEl) helpEl.setAttribute('aria-hidden', helpEl.classList.contains('hidden') ? 'true' : 'false');
  if (helpClose) {
    helpClose.addEventListener('click', (e) => {
      e.preventDefault();
      setHelp(false);
    });
  }

  // ---------------- 自动弹一次帮助 ----------------
  function startAutoHelp() {
    // ?help=1 强制展示（截图/演示用），会覆盖「已看过」的记忆
    if (param('help') === '1') {
      setTimeout(() => { if (!state.mapOpen) setHelp(true); }, 220);
      return;
    }
    if (state.seenHelp) return;
    if (param('help') === '0') return;
    if (param('map') === '1') return; // 直接看地图的截图/分享链接不打扰
    const fire = () => {
      if (state.helpOpen) return;
      if (state.mapOpen) {
        state.helpAutoTimer = setTimeout(fire, 1200);
        return;
      }
      setHelp(true);
    };
    state.helpAutoTimer = setTimeout(fire, 2200);
  }

  // 等第一帧渲染完成（main.js 会移除 #boot）再开始
  const bootPoll = setInterval(() => {
    const boot = document.getElementById('boot');
    const done = window.__started === true || !boot || getComputedStyle(boot).display === 'none';
    if (!done) return;
    clearInterval(bootPoll);
    state.bootDone = true;
    startAutoHelp();
    if (param('map') === '1') setTimeout(() => map.open(), 260);
  }, 160);

  // ---------------- 键盘（捕捉阶段，早于玩法） ----------------
  function isTyping(e) {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(e) {
    if (e.isComposing || isTyping(e)) return;
    const code = e.code;
    const mapOpen = map.isOpen();

    // M：地图开关（main.js 未处理 M，由 HUD 负责）
    if (code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(state.helpAutoTimer);
      state.seenHelp = true;
      if (mapOpen) map.close();
      else map.open();
      return;
    }

    if (code === 'Escape') {
      if (mapOpen) {
        e.preventDefault();
        e.stopPropagation();
        map.close();
        return;
      }
      if (state.helpOpen) {
        e.preventDefault();
        e.stopPropagation();
        setHelp(false);
        return;
      }
      return;
    }

    if (code === 'KeyH') {
      // main.js 已绑定 H → hud.toggleHelp()，这里只记录「已交互」
      clearTimeout(state.helpAutoTimer);
      state.seenHelp = true;
      return;
    }

    // 首次按键 → 立刻弹帮助（比 2 秒定时更贴近「第一次操作前」）
    if (!state.seenHelp && !state.helpOpen && !mapOpen && !e.repeat) {
      clearTimeout(state.helpAutoTimer);
      setHelp(true);
    }

    // 模态打开时吞掉玩法按键，避免边读说明边乱走
    if (mapOpen || state.helpOpen) e.stopPropagation();
  }

  window.addEventListener('keydown', onKeyDown, true);

  // 帮助/地图打开时挡住滚轮缩放（地图自己处理滚轮）
  window.addEventListener('wheel', (e) => {
    const t = e.target;
    if (state.helpOpen) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (state.mapOpen && map.root && !map.root.contains(t)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false, capture: true });

  // 没有 setHeading 时的兜底：鼠标拖拽（左键）自跟踪朝向
  window.addEventListener('pointermove', (e) => {
    if (state.hasHeading || state.mapOpen || state.helpOpen) return;
    if (!(e.buttons & 1)) return;
    const dx = e.movementX || 0;
    if (!dx) return;
    state.yaw -= dx * 0.0026 * state.yawSign;
    state.heading = bearingOf(state.yaw);
    state.compassTick = 1;
  }, { passive: true });

  // ---------------- 每帧 ----------------
  function update(dt) {
    const d = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0.016;
    state.t += d;

    // 自测帧率 + 可选探针（每 0.25s）
    state.frameCount++;
    state.frameAcc += d;
    state.probeAt += d;
    if (state.probeAt >= 0.25) {
      state.probeAt = 0;
      const pr = probe();
      if (pr.pose && !state.pose) state.pose = pr.pose;
      if (pr.pose && state.pose) {
        state.pose.x = pr.pose.x;
        state.pose.z = pr.pose.z;
        state.zoneTick = Math.max(state.zoneTick, 0.2);
      }
      if (pr.yaw != null && !state.hasHeading) setHeading(pr.yaw);
    }
    if (state.frameAcc >= 0.5) {
      state.localFps = state.frameCount / state.frameAcc;
      state.frameCount = 0;
      state.frameAcc = 0;
      if (performance.now() - state.statsAt > 1600) writeLocalStats();
    }

    if (state.pose) {
      state.zoneTick += d;
      const last = state.lastZonePos;
      const moved = last ? Math.hypot(state.pose.x - last.x, state.pose.z - last.z) : Infinity;
      if (state.zoneTick >= 1.0 || moved >= 10) {
        if (performance.now() >= state.manualZoneUntil) {
          state.zoneTick = 0;
          state.lastZonePos = { x: state.pose.x, z: state.pose.z };
          autoZone();
        }
      }
    }

    // 罗盘 12 Hz 重绘足够，软件渲染下别跟主循环抢时间；朝向没变时跳过
    state.compassTick += d;
    if (state.compassTick >= 0.08 && Math.abs(state.heading - state.drawnHeading) > 0.0008) {
      state.compassTick = 0;
      state.drawnHeading = state.heading;
      compass.draw(state.heading);
    }

    // 就近提示（main.js 不调用 setHint，这里每 0.2s 兜底推断一次）
    state.hintTick += d;
    if (state.hintTick >= 0.2) {
      state.hintTick = 0;
      autoHint();
    }

    if (state.mapOpen) map.setPose();
  }

  // ---------------- 对外 API ----------------
  function setHeading(yaw) {
    if (!Number.isFinite(yaw)) return;
    state.hasHeading = true;
    state.yaw = yaw;
    state.heading = bearingOf(yaw);
    state.compassTick = 1;
  }

  function setMapOpen(open) {
    if (open) map.open();
    else map.close();
  }

  const api = {
    setZone,
    setStats,
    setHint,
    setHeading,
    toggleHelp,
    update,
    setMapOpen,
    isHelpOpen: () => state.helpOpen,
    isMapOpen: () => map.isOpen(),
    getHeading: () => state.heading,
    map,
    touch,
  };

  // 调试/联调用
  window.__hud = api;

  // 先画一帧罗盘，避免首帧空白
  compass.draw(state.heading);
  autoZone();

  return api;
}

export default createHUD;
