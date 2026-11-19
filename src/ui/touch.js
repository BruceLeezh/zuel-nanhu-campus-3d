// 移动端控件：点亮模板里的 #stick / #look / #tjump / #tgrab / #trun。
// 与玩法的对接方式（physicist 尚未定稿，这里做双通道）：
//   1) window.dispatchEvent(new CustomEvent('ui-input', { detail }))
//      detail = { source:'touch', type:'move', x, y }        摇杆：x 右为正，y 前为正（-1..1）
//               { source:'touch', type:'look', dx, dy }       视角：像素增量（与鼠标 drag 同量纲）
//               { source:'touch', type:'press', action:'jump'|'grab' }
//               { source:'touch', type:'run', on:true|false }
//   2) 轮询 window.__uiTouch（同一份状态镜像）
const CSS = `
.touch-ui #keys{display:none!important}
.touch-ui #hint{top:96px;bottom:auto}
.touch-ui #touch{display:block}
#touch,#touch *{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#stick{transition:background .16s,border-color .16s}
#stick.on{background:rgba(255,212,121,.12);border-color:rgba(255,212,121,.42)}
#stick i{transition:transform .06s linear,background .16s}
#stick.on i{background:rgba(255,212,121,.72);border-color:rgba(255,212,121,.9)}
.tbtn{transition:background .14s,border-color .14s,transform .1s}
.tbtn.pressed,.tbtn:active{background:rgba(255,212,121,.24);border-color:rgba(255,212,121,.6);transform:scale(.94)}
.tbtn.on{background:rgba(255,212,121,.26);border-color:rgba(255,212,121,.72);color:#ffe6ad}
`;

let injected = false;
function inject() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'campus-touch-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight',
  'KeyE', 'KeyQ', 'KeyF', 'KeyC'];

/** 通知外部：模态面板打开，玩法应清空按键状态（派发 keyup 更保险） */
export function releaseHeldKeys() {
  for (const code of MOVE_CODES) {
    try {
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
    } catch (e) { /* 老浏览器忽略 */ }
  }
}

export function createTouch(opts = {}) {
  inject();
  const root = document.getElementById('touch');
  if (!root) {
    return { enable() {}, disable() {}, isEnabled: () => false, destroy() {} };
  }
  const stick = document.getElementById('stick');
  const knob = stick ? stick.querySelector('i') : null;
  const look = document.getElementById('look');
  const bJump = document.getElementById('tjump');
  const bGrab = document.getElementById('tgrab');
  const bRun = document.getElementById('trun');

  const state = { move: { x: 0, y: 0 }, run: false, enabled: false, active: false };
  window.__uiTouch = state;

  function emit(detail) {
    window.dispatchEvent(new CustomEvent('ui-input', { detail }));
    if (opts.onInput) opts.onInput(detail);
  }

  // ---------------- 摇杆 ----------------
  let stickId = null;
  const RADIUS = 38;

  function stickCenter() {
    const r = stick.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, half: r.width / 2 };
  }

  function stickUpdate(e) {
    const { cx, cy, half } = stickCenter();
    let vx = (e.clientX - cx) / half;
    let vy = (e.clientY - cy) / half;
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    if (knob) {
      const px = vx * RADIUS;
      const py = vy * RADIUS;
      knob.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
    }
    state.move.x = +vx.toFixed(3);
    state.move.y = +(-vy).toFixed(3);
    emit({ source: 'touch', type: 'move', x: state.move.x, y: state.move.y });
  }

  function stickEnd() {
    if (stickId == null) return;
    stickId = null;
    state.active = false;
    if (stick) stick.classList.remove('on');
    if (knob) knob.style.transform = 'translate(0,0)';
    state.move.x = 0;
    state.move.y = 0;
    emit({ source: 'touch', type: 'move', x: 0, y: 0 });
  }

  if (stick) {
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stickId = e.pointerId;
      state.active = true;
      stick.classList.add('on');
      if (stick.setPointerCapture) stick.setPointerCapture(e.pointerId);
      stickUpdate(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      e.preventDefault();
      stickUpdate(e);
    });
    const end = (e) => {
      if (e.pointerId !== stickId) return;
      stickEnd();
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    stick.addEventListener('lostpointercapture', end);
  }

  // ---------------- 视角 ----------------
  let lookId = null;
  let last = { x: 0, y: 0 };

  if (look) {
    look.addEventListener('pointerdown', (e) => {
      if (lookId != null) return;
      lookId = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      if (look.setPointerCapture) look.setPointerCapture(e.pointerId);
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (!dx && !dy) return;
      emit({ source: 'touch', type: 'look', dx, dy });
    });
    const endLook = (e) => {
      if (e.pointerId !== lookId) return;
      lookId = null;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);
    look.addEventListener('lostpointercapture', endLook);
  }

  // ---------------- 按钮 ----------------
  function press(btn, action) {
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      emit({ source: 'touch', type: 'press', action });
    });
    const up = () => btn.classList.remove('pressed');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }
  press(bJump, 'jump');
  press(bGrab, 'grab');

  if (bRun) {
    bRun.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.run = !state.run;
      bRun.classList.toggle('on', state.run);
      emit({ source: 'touch', type: 'run', on: state.run });
    });
  }

  // ---------------- 显隐 ----------------
  const mq = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;

  function shouldEnable() {
    if (mq && mq.matches) return true;
    return (navigator.maxTouchPoints || 0) > 0 && window.innerWidth < 820;
  }

  function enable() {
    if (state.enabled) return;
    state.enabled = true;
    document.documentElement.classList.add('touch-ui');
    root.style.display = 'block';
    // 摇杆帽静止时必须在圆心（有的浏览器会记住上一次 transform）
    if (knob) knob.style.transform = 'translate(0,0)';
    state.move.x = 0;
    state.move.y = 0;
  }

  function disable() {
    if (!state.enabled) {
      root.style.display = 'none';
      document.documentElement.classList.remove('touch-ui');
      return;
    }
    state.enabled = false;
    stickEnd();
    lookId = null;
    if (state.run) {
      state.run = false;
      if (bRun) bRun.classList.remove('on');
    }
    root.style.display = 'none';
    document.documentElement.classList.remove('touch-ui');
  }

  function sync() {
    if (shouldEnable()) enable();
    else disable();
  }

  sync();
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
  }
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });

  return {
    enable,
    disable,
    sync,
    isEnabled: () => state.enabled,
    state,
    destroy() {
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener('change', sync);
        else if (mq.removeListener) mq.removeListener(sync);
      }
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      disable();
    },
  };
}
