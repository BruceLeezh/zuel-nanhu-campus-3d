// 校园地图：全屏半透明平面图（M 键）。
// 坐标来源：src/world/layout.js（真实校区 POI 换算的米制坐标），
// 因此比例尺、道路名、楼名与 3D 场景完全一致。
import {
  BOUNDS, CAMPUS_OUTLINE, ROADS, GATES, LAKE, HILLS, BUILDINGS,
  SPORTS, PLAZAS, LANDMARKS,
} from '../world/layout.js';
import { describeAt } from './zone.js';
import { fmtMeters, rectCorners } from './geo.js';

const TAU = Math.PI * 2;
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
const ACCENT = '#ffd479';
const ACCENT_RGB = '255,212,121';

// ---------------------------------------------------------------------------
// DOM / 样式（模板里没有地图容器，这里动态插入一次）
// ---------------------------------------------------------------------------
const CSS = `
#campus-map{position:fixed;inset:0;z-index:45;display:flex;flex-direction:column;
  background:rgba(4,8,11,.66);backdrop-filter:blur(7px) saturate(1.1);-webkit-backdrop-filter:blur(7px) saturate(1.1);
  opacity:1;transition:opacity .2s ease;pointer-events:auto;color:var(--ink,#eef2f4);
  font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif}
#campus-map.hidden{opacity:0!important;pointer-events:none!important}
.cm-head{display:flex;align-items:center;gap:14px;padding:12px 18px 8px;flex:0 0 auto}
.cm-title{display:flex;align-items:baseline;gap:10px;min-width:0}
.cm-title b{font-size:15px;letter-spacing:.14em;font-weight:600}
.cm-title span{font-size:12px;color:var(--dim,#9fb0bb);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-tips{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:11.5px;color:rgba(159,176,187,.86);letter-spacing:.03em}
.cm-tips i{font-style:normal;color:rgba(255,212,121,.82)}
.cm-close{pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:7px;
  padding:7px 13px;border-radius:10px;border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.05);color:var(--ink,#eef2f4);font:inherit;font-size:12.5px;letter-spacing:.04em;
  transition:background .16s,border-color .16s,transform .16s}
.cm-close:hover{background:rgba(255,212,121,.14);border-color:rgba(255,212,121,.5)}
.cm-close:active{transform:translateY(1px)}
.cm-close kbd{font:inherit;font-size:11px;padding:1px 5px;border-radius:4px;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:rgba(238,242,244,.9)}
.cm-body{position:relative;flex:1 1 auto;margin:0 18px 18px;border-radius:16px;overflow:hidden;
  border:1px solid rgba(255,255,255,.12);background:#070d11;
  box-shadow:0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.02)}
.cm-body canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair;touch-action:none}
.cm-body.dragging canvas{cursor:grabbing}
.cm-tip{position:absolute;pointer-events:none;opacity:0;transform:translate(-50%,-100%);
  padding:6px 10px;border-radius:9px;white-space:nowrap;z-index:3;
  background:rgba(7,13,17,.9);border:1px solid rgba(255,212,121,.42);
  box-shadow:0 8px 22px rgba(0,0,0,.5);transition:opacity .12s}
.cm-tip.on{opacity:1}
.cm-tip b{display:block;font-size:12.5px;font-weight:600;color:#ffe6ad;letter-spacing:.03em}
.cm-tip i{display:block;font-style:normal;font-size:11px;color:rgba(159,176,187,.95);margin-top:2px}
.cm-info{position:absolute;left:16px;bottom:16px;width:284px;max-width:calc(100% - 32px);z-index:3;
  padding:12px 14px 11px;border-radius:13px;background:rgba(9,15,20,.86);
  border:1px solid rgba(255,255,255,.13);box-shadow:0 14px 34px rgba(0,0,0,.45);
  backdrop-filter:blur(8px);pointer-events:none}
.cm-info .k{font-size:10.5px;letter-spacing:.2em;color:rgba(159,176,187,.8)}
.cm-info .t{font-size:16px;font-weight:600;letter-spacing:.04em;margin-top:4px;color:#f2f6f8}
.cm-info .s{font-size:11.5px;color:var(--dim,#9fb0bb);margin-top:3px;letter-spacing:.02em}
.cm-info .n{font-size:11.5px;color:rgba(255,212,121,.85);margin-top:6px;line-height:1.5}
.cm-info .m{font-size:11px;color:rgba(159,176,187,.72);margin-top:7px;letter-spacing:.02em}
.cm-info .f{font-size:10.5px;color:rgba(159,176,187,.55);margin-top:8px;padding-top:7px;
  border-top:1px solid rgba(255,255,255,.08)}
.cm-legend{position:absolute;right:16px;bottom:16px;z-index:3;pointer-events:none;
  padding:10px 12px;border-radius:11px;background:rgba(9,15,20,.8);
  border:1px solid rgba(255,255,255,.1);font-size:11px;color:rgba(200,214,222,.82);line-height:1.85}
.cm-legend div{display:flex;align-items:center;gap:8px}
.cm-legend i{width:9px;height:9px;border-radius:2px;display:inline-block;font-style:normal}
@media (max-width:640px){
  .cm-tips{display:none}
  .cm-head{padding:10px 12px 6px}
  .cm-body{margin:0 10px 10px;border-radius:13px}
  .cm-info{left:10px;right:10px;bottom:10px;width:auto;padding:10px 12px}
  .cm-info.empty .s{display:none}
  .cm-info .t{font-size:14px}
  .cm-info .f{font-size:10px}
  .cm-legend{display:none}
  .cm-title span{display:none}
}
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.id = 'campus-map-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// 地图几何缓存（与 layout.js 一一对应，只做绘制需要的整理）
// ---------------------------------------------------------------------------
const MAP = (() => {
  const buildings = [];
  const shapes = new Map(); // name -> 绘制/高亮形状

  for (const b of BUILDINGS) {
    if (b.group && b.cells) {
      const cw = b.w || 30;
      const cd = b.d || 14;
      const cells = [];
      const seen = new Set();
      for (const [cx, cz] of b.cells) {
        const key = Math.round(cx / 9) + ',' + Math.round(cz / 9);
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ x: cx, z: cz, w: cw, d: cd });
      }
      const area = cells.length * cw * cd;
      buildings.push({ name: b.name, kind: 'group', cells, area, style: b.style || 'dorm' });
      shapes.set(b.name, { type: 'rects', cells });
      continue;
    }
    const w = b.w || 30;
    const d = b.d || 14;
    buildings.push({
      name: b.name, kind: 'box', x: b.x, z: b.z, w, d, rot: 0,
      area: w * d, style: b.style, main: !!b.main, note: b.note,
    });
    shapes.set(b.name, { type: 'rects', cells: [{ x: b.x, z: b.z, w, d }] });
  }

  for (const p of PLAZAS) shapes.set(p.name, { type: 'ellipse', x: p.x, z: p.z, rx: p.rx, rz: p.rz });
  for (const h of HILLS) shapes.set(h.name, { type: 'ellipse', x: h.x, z: h.z, rx: h.rx, rz: h.rz });
  for (const s of SPORTS) shapes.set(s.name, { type: 'rects', cells: [{ x: s.x, z: s.z, w: s.w, d: s.d }] });
  for (const r of ROADS) shapes.set(r.name, { type: 'line', pts: r.pts, width: r.width });
  shapes.set(LAKE.name, { type: 'poly', poly: LAKE.poly });
  for (const g of GATES) shapes.set(g.name, { type: 'circle', x: g.x, z: g.z, r: 7 });
  for (const l of LANDMARKS) shapes.set(l.name, { type: 'circle', x: l.x, z: l.z, r: 5 });

  return { buildings, shapes };
})();

const MAIN_STYLE = {
  library: { fill: 'rgba(255,212,121,0.34)', stroke: 'rgba(255,226,160,0.9)' },
  museum: { fill: 'rgba(255,212,121,0.28)', stroke: 'rgba(255,226,160,0.8)' },
  hall: { fill: 'rgba(255,212,121,0.26)', stroke: 'rgba(255,226,160,0.75)' },
  gym: { fill: 'rgba(255,212,121,0.22)', stroke: 'rgba(255,226,160,0.7)' },
  office: { fill: 'rgba(226,232,232,0.26)', stroke: 'rgba(226,238,244,0.5)' },
};
const NORMAL_STYLE = { fill: 'rgba(226,232,232,0.17)', stroke: 'rgba(226,238,244,0.3)' };

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------
export function createMap(opts = {}) {
  injectCSS();
  const getPose = opts.getPose || (() => ({ x: 0, z: 0, heading: 0 }));
  const TOUCH = (() => {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
      return (navigator.maxTouchPoints || 0) > 0 && window.innerWidth < 860;
    } catch (e) { return false; }
  })();

  const state = {
    open: false,
    zoom: 1,    cx: (BOUNDS.minX + BOUNDS.maxX) / 2,
    cz: (BOUNDS.minZ + BOUNDS.maxZ) / 2,
    homeCx: (BOUNDS.minX + BOUNDS.maxX) / 2,
    homeCz: (BOUNDS.minZ + BOUNDS.maxZ) / 2,
    hover: null,
    hoverPt: null,
    pinned: null,
    pinnedPt: null,
    dragging: false,
    moved: false,
    downAt: null,
    pointers: new Set(),
    dirty: true,
    raf: 0,
    lastDraw: 0,
    homeSet: false,
    touch: TOUCH,
  };

  // ---- DOM ----
  const root = document.createElement('div');
  root.id = 'campus-map';
  root.className = 'hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '校园地图');
  root.innerHTML =
    '<div class="cm-head">' +
    '  <div class="cm-title"><b>校园地图</b><span>中南财经政法大学 · 南湖校区</span></div>' +
    '  <div class="cm-tips">' +
    (TOUCH
      ? '    <span><i>点一下</i> 看这里是什么</span><span><i>双指</i> 缩放</span><span><i>拖动</i> 平移</span>'
      : '    <span><i>移鼠标</i> 看地点</span><span><i>点击</i> 固定位置</span>' +
        '    <span><i>滚轮</i> 缩放</span><span><i>拖动</i> 平移</span>') +
    '  </div>' +
    '  <button type="button" class="cm-close" aria-label="关闭地图">关闭 <kbd>' + (TOUCH ? '×' : 'M') + '</kbd></button>' +
    '</div>' +
    '<div class="cm-body">' +
    '  <canvas></canvas>' +
    '  <div class="cm-tip"></div>' +
    '  <div class="cm-info"></div>' +
    '  <div class="cm-legend">' +
    '    <div><i style="background:rgba(255,212,121,.75)"></i>主要场馆</div>' +
    '    <div><i style="background:rgba(226,232,232,.34)"></i>教学 · 生活建筑</div>' +
    '    <div><i style="background:rgba(190,205,215,.5)"></i>道路</div>' +
    '    <div><i style="background:rgba(74,142,168,.7)"></i>晓南湖水域</div>' +
    '    <div><i style="background:rgba(96,150,110,.55)"></i>山丘 · 绿地</div>' +
    '    <div><i style="background:rgba(255,212,121,.95);border-radius:50%"></i>你的位置与视野</div>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(root);

  const body = root.querySelector('.cm-body');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const tip = root.querySelector('.cm-tip');
  const info = root.querySelector('.cm-info');
  const closeBtn = root.querySelector('.cm-close');

  let W = 0;
  let H = 0;
  let dpr = 1;
  let baseScale = 1;

  // ---- 尺寸 ----
  function resize() {
    const r = body.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    recalcFit();
    state.dirty = true;
  }

  function recalcFit() {
    const worldW = BOUNDS.maxX - BOUNDS.minX;
    const worldH = BOUNDS.maxZ - BOUNDS.minZ;
    const pad = W < 640 ? 14 : 30;
    baseScale = Math.min((W - pad * 2) / worldW, (H - pad * 2) / worldH);
  }

  const scale = () => baseScale * state.zoom;

  function w2s(wx, wz) {
    const s = scale();
    return [W / 2 + (wx - state.cx) * s, H / 2 + (wz - state.cz) * s];
  }
  function s2w(sx, sy) {
    const s = scale();
    return [state.cx + (sx - W / 2) / s, state.cz + (sy - H / 2) / s];
  }

  function zoomAt(sx, sy, factor) {
    const [wx, wz] = s2w(sx, sy);
    const next = Math.min(4.2, Math.max(1, state.zoom * factor));
    if (next === state.zoom) return;
    state.zoom = next;
    const s = scale();
    state.cx = wx - (sx - W / 2) / s;
    state.cz = wz - (sy - H / 2) / s;
    clampCenter();
    state.dirty = true;
  }

  function clampCenter() {
    const s = scale();
    // 允许最多看到校园外 15% 画幅，避免把地图拖飞
    const slackX = (W / s) * 0.15;
    const slackZ = (H / s) * 0.15;
    state.cx = Math.min(BOUNDS.maxX + slackX, Math.max(BOUNDS.minX - slackX, state.cx));
    state.cz = Math.min(BOUNDS.maxZ + slackZ, Math.max(BOUNDS.minZ - slackZ, state.cz));
  }

  // -------------------------------------------------------------------------
  // 绘制
  // -------------------------------------------------------------------------
  const placed = []; // 已占用的标签包围盒
  const FONT_LABEL = FONT;

  function collides(box) {
    for (const b of placed) {
      if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return true;
    }
    return false;
  }

  function oval(x, z, rx, rz) {
    const [sx, sy] = w2s(x, z);
    const s = scale();
    ctx.beginPath();
    ctx.ellipse(sx, sy, Math.max(0.5, rx * s), Math.max(0.5, rz * s), 0, 0, TAU);
  }

  // 把世界坐标折线追加到当前路径（不 beginPath，便于 evenodd 裁剪）
  function appendPoly(pts, close) {
    const s = scale();
    pts.forEach(([wx, wz], i) => {
      const sx = W / 2 + (wx - state.cx) * s;
      const sy = H / 2 + (wz - state.cz) * s;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    if (close) ctx.closePath();
  }

  function polyPath(pts, close) {
    ctx.beginPath();
    appendPoly(pts, close);
  }

  function rectPath(x, z, w, d) {
    const [sx, sy] = w2s(x, z);
    const s = scale();
    ctx.beginPath();
    ctx.rect(sx - (w * s) / 2, sy - (d * s) / 2, Math.max(0.8, w * s), Math.max(0.8, d * s));
  }

  function campusPath() {
    polyPath(CAMPUS_OUTLINE, true);
  }

  // 标签：居中绘制，自动避让
  function label(text, x, y, o = {}) {
    const size = o.size || 11;
    const weight = o.weight || '400';
    ctx.font = weight + ' ' + size + 'px ' + FONT_LABEL;
    const tw = ctx.measureText(text).width;
    // 贴边的标签宁可不画，也别被裁成半个字
    if (!o.force && (x - tw / 2 < 4 || x + tw / 2 > W - 4 || y - size < 2 || y + size > H - 2)) return false;
    const pad = o.pad == null ? 3 : o.pad;
    const box = { x: x - tw / 2 - pad, y: y - size / 2 - pad, w: tw + pad * 2, h: size + pad * 2 };
    if (!o.force && collides(box)) return false;
    placed.push(box);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (o.halo) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = o.halo;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = o.color || 'rgba(230,238,243,.86)';
    ctx.fillText(text, x, y);
    return true;
  }

  // 旋转标签（道路名）
  function rotLabel(text, x, y, angle, o = {}) {
    const size = o.size || 11;
    const weight = o.weight || '500';
    ctx.font = weight + ' ' + size + 'px ' + FONT_LABEL;
    const tw = ctx.measureText(text).width;
    const c = Math.abs(Math.cos(angle));
    const sn = Math.abs(Math.sin(angle));
    const pad = 4;
    const bw = tw * c + size * sn + pad * 2;
    const bh = tw * sn + size * c + pad * 2;
    const box = { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh };
    if (box.x < 2 || box.y < 2 || box.x + box.w > W - 2 || box.y + box.h > H - 2) return false;
    if (collides(box)) return false;
    placed.push(box);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (o.pill) {
      ctx.beginPath();
      rr(-tw / 2 - 6, -size / 2 - 4, tw + 12, size + 8, 7);
      ctx.fillStyle = 'rgba(7,13,17,.74)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = o.color || 'rgba(184,198,208,.9)';
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return true;
  }

  function rr(x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
  }

  function draw() {
    if (!W || !H) return;
    const s = scale();
    placed.length = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 底：深色径向渐变
    const bg = ctx.createRadialGradient(W * 0.44, H * 0.42, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#0d161a');
    bg.addColorStop(1, '#05090c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawOutsideRoads();
    drawCampusBody();
    drawHills();
    drawPlazas();
    drawSports();
    drawLake();
    drawRoads();
    drawBuildings();
    drawGates();
    drawLandmarks();
    drawLabels();
    drawHover();
    drawPlayer();
    drawScale();
    drawRose();
  }

  function drawOutsideRoads() {
    const s = scale();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    appendPoly(CAMPUS_OUTLINE, true);
    ctx.clip('evenodd');
    for (const r of ROADS) {
      ctx.beginPath();
      r.pts.forEach(([wx, wz], i) => {
        const sx = W / 2 + (wx - state.cx) * s;
        const sy = H / 2 + (wz - state.cz) * s;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.lineWidth = Math.max(1.2, r.width * s);
      ctx.strokeStyle = 'rgba(148,164,175,.16)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCampusBody() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(29,45,38,0.78)');
    g.addColorStop(1, 'rgba(20,33,30,0.72)');
    campusPath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(198,224,206,.34)';
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(198,224,206,.06)';
    ctx.stroke();
  }

  function drawHills() {
    for (const h of HILLS) {
      oval(h.x, h.z, h.rx, h.rz);
      ctx.fillStyle = 'rgba(104,158,116,.13)';
      ctx.fill();
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(150,202,164,.26)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawPlazas() {
    for (const p of PLAZAS) {
      oval(p.x, p.z, p.rx, p.rz);
      ctx.fillStyle = p.kind === 'garden' ? 'rgba(120,182,142,.10)' : 'rgba(255,212,121,.075)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.kind === 'garden' ? 'rgba(140,190,156,.16)' : 'rgba(255,212,121,.16)';
      ctx.stroke();
    }
    // 小水面
    for (const pond of LAKE.ponds || []) {
      oval(pond.x, pond.z, pond.r, pond.r * 0.82);
      ctx.fillStyle = 'rgba(74,142,168,.42)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,205,224,.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawSports() {
    for (const sp of SPORTS) {
      rectPath(sp.x, sp.z, sp.w, sp.d);
      ctx.fillStyle = sp.kind === 'court' ? 'rgba(198,132,96,.14)' : 'rgba(198,132,96,.18)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(232,166,128,.26)';
      ctx.stroke();
      if (sp.kind === 'track') {
        const [sx, sy] = w2s(sp.x, sp.z);
        const s = scale();
        ctx.beginPath();
        ctx.ellipse(sx, sy, Math.max(1, (sp.w * s) / 2 - 6), Math.max(1, (sp.d * s) / 2 - 6), 0, 0, TAU);
        ctx.strokeStyle = 'rgba(240,196,150,.3)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(sx, sy, Math.max(1, (sp.w * s) / 2 - 22), Math.max(1, (sp.d * s) / 2 - 20), 0, 0, TAU);
        ctx.strokeStyle = 'rgba(120,190,140,.35)';
        ctx.stroke();
      }
    }
  }

  function drawLake() {
    polyPath(LAKE.poly, true);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(64,142,172,.55)');
    g.addColorStop(1, 'rgba(40,104,132,.5)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(150,214,234,.55)';
    ctx.stroke();
    // 岛
    for (const isl of LAKE.islands || []) {
      oval(isl.x, isl.z, isl.r * 0.92, isl.r * 0.8);
      ctx.fillStyle = 'rgba(96,150,110,.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,210,172,.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawRoads() {
    const s = scale();
    // 先画深色描边（挡出道路轮廓），再画亮色路面
    for (const pass of [0, 1]) {
      for (const r of ROADS) {
        ctx.beginPath();
        r.pts.forEach(([wx, wz], i) => {
          const sx = W / 2 + (wx - state.cx) * s;
          const sy = H / 2 + (wz - state.cz) * s;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (pass === 0) {
          ctx.lineWidth = Math.max(2.4, r.width * s + 3);
          ctx.strokeStyle = 'rgba(6,10,13,.85)';
        } else {
          ctx.lineWidth = Math.max(1.4, r.width * s);
          ctx.strokeStyle = r.major ? 'rgba(190,205,215,.5)' : 'rgba(176,192,202,.32)';
        }
        ctx.stroke();
      }
    }
  }

  function drawBuildings() {
    const s = scale();
    for (const b of MAP.buildings) {
      const st = b.main
        ? MAIN_STYLE[b.style] || MAIN_STYLE.office
        : b.style === 'library'
          ? MAIN_STYLE.library
          : NORMAL_STYLE;
      const cells = b.kind === 'group' ? b.cells : [{ x: b.x, z: b.z, w: b.w, d: b.d }];
      // 落影
      ctx.fillStyle = 'rgba(0,0,0,.34)';
      for (const c of cells) {
        const [sx, sy] = w2s(c.x, c.z);
        const w = Math.max(1, c.w * s);
        const d = Math.max(1, c.d * s);
        ctx.fillRect(sx - w / 2 + 1.6, sy - d / 2 + 2.6, w, d);
      }
      ctx.fillStyle = st.fill;
      for (const c of cells) {
        const [sx, sy] = w2s(c.x, c.z);
        const w = Math.max(1, c.w * s);
        const d = Math.max(1, c.d * s);
        ctx.fillRect(sx - w / 2, sy - d / 2, w, d);
        if (s > 0.5) {
          ctx.strokeStyle = st.stroke;
          ctx.lineWidth = b.main ? 1.3 : 1;
          ctx.strokeRect(sx - w / 2 + 0.5, sy - d / 2 + 0.5, w - 1, d - 1);
        }
      }
    }
  }

  function drawGates() {
    for (const g of GATES) {
      const [sx, sy] = w2s(g.x, g.z);
      const r = g.main ? 6 : 4;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = g.main ? 'rgba(255,212,121,.95)' : 'rgba(255,212,121,.55)';
      ctx.fillStyle = g.main ? 'rgba(255,212,121,.9)' : 'rgba(255,212,121,.25)';
      ctx.lineWidth = 1.4;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  }

  function drawLandmarks() {
    for (const l of LANDMARKS) {
      const [sx, sy] = w2s(l.x, l.z);
      if (l.kind === 'bridge') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-(l.rot || 0));
        ctx.strokeStyle = 'rgba(255,226,160,.8)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-(l.len / 2) * scale(), 0);
        ctx.lineTo((l.len / 2) * scale(), 0);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, l.kind === 'sculpture' ? 4 : 2.6, 0, TAU);
      ctx.fillStyle = l.kind === 'sculpture' ? 'rgba(255,212,121,.95)' : 'rgba(255,226,160,.6)';
      ctx.fill();
    }
  }

  function drawLabels() {
    const z = state.zoom;

    // 1) 湖 / 山：优先，保证不被楼名挤掉
    if (LAKE.poly.length) {
      let cx = 0;
      let cz = 0;
      for (const p of LAKE.poly) { cx += p[0]; cz += p[1]; }
      cx /= LAKE.poly.length;
      cz /= LAKE.poly.length;
      const [sx, sy] = w2s(cx + 6, cz);
      label(LAKE.name, sx, sy, { size: 14, weight: '600', color: 'rgba(176,226,240,.96)', halo: 'rgba(5,12,16,.9)', force: true, pad: 6 });
    }
    for (const h of HILLS) {
      const [sx, sy] = w2s(h.x, h.z);
      const big = h.rx * h.rz > 24000;
      if (z >= 1.15 || big) {
        label(h.name, sx, sy, { size: 11.5, weight: '500', color: 'rgba(168,214,178,.92)', halo: 'rgba(6,14,10,.85)', pad: 4 });
      }
    }

    // 2) 城市主干道：先占位，保证「南湖大道 / 民族大道」一定出现
    roadLabels((r) => r.major);

    // 3) 主馆（main / 图书馆 / 博物馆 / 礼堂 / 体育馆）
    const isMain = (b) => !!(b.main || b.style === 'library' || b.style === 'museum' || b.style === 'hall' || b.style === 'gym');
    const sorted = MAP.buildings.slice().sort((a, b) => {
      const pa = (isMain(a) ? 1e9 : 0) + a.area;
      const pb = (isMain(b) ? 1e9 : 0) + b.area;
      return pb - pa;
    });
    for (const b of sorted) {
      if (!isMain(b)) continue;
      drawBuildingLabel(b, true);
    }

    // 4) 校门（仅主门标注）
    for (const g of GATES) {
      if (!g.main) continue;
      const [sx, sy] = w2s(g.x, g.z);
      const outward = g.rot === 0 ? (g.z < 0 ? -1 : 1) : (g.x > 0 ? 1 : -1);
      const horizontal = g.rot !== 0;
      label(g.name, sx + (horizontal ? outward * 22 : 0), sy + (horizontal ? 0 : outward * 20), {
        size: 11.5, weight: '600', color: 'rgba(255,226,160,.95)', halo: 'rgba(7,12,16,.9)', pad: 4,
      });
    }

    // 5) 其余道路（窄屏只保留主干道，避免斜排路名压在楼上）
    if (W >= 520) roadLabels((r) => !r.major);

    // 6) 其余建筑：按缩放分档加密（窄屏只留主馆，避免小图挤成一团）
    const sizeMin = z >= 1.8 ? 420 : z >= 1.15 ? 1000 : 1900;
    if (W >= 520) {
      for (const b of sorted) {
        if (isMain(b)) continue;
        if (b.area < sizeMin) continue;
        drawBuildingLabel(b, false);
      }
    }

    // 7) 广场 / 园林：放大后标注
    if (z >= 1.25) {
      for (const p of PLAZAS) {
        if (p.name === '五羊广场') continue;
        const [sx, sy] = w2s(p.x, p.z);
        label(p.name, sx, sy, {
          size: 10.5, weight: '400', color: p.kind === 'garden' ? 'rgba(158,204,170,.8)' : 'rgba(240,222,178,.72)',
          halo: 'rgba(6,12,15,.8)', pad: 3,
        });
      }
    }
    // 8) 出生点广场：任何缩放都标（force 防止被路名挤掉）
    {
      const [sx, sy] = w2s(0, 0);
      label('五羊广场', sx, sy - 17, { size: 12, weight: '600', color: '#ffe6ad', halo: 'rgba(7,12,16,.92)', pad: 5, force: true });
    }
  }

  function drawBuildingLabel(b, main) {
    const cell = b.kind === 'group'
      ? b.cells.reduce((acc, c) => ({ x: acc.x + c.x / b.cells.length, z: acc.z + c.z / b.cells.length }), { x: 0, z: 0 })
      : { x: b.x, z: b.z };
    const [sx, sy] = w2s(cell.x, cell.z);
    label(b.name, sx, sy, {
      size: main ? 12.5 : 11,
      weight: main ? '600' : '400',
      color: main ? '#ffe6ad' : 'rgba(228,238,243,.84)',
      halo: 'rgba(6,12,15,.86)',
      pad: main ? 5 : 3,
    });
  }

  // 把一条屏幕线段裁到画布内（Liang–Barsky），返回可见部分或 null
  function clipSeg(ax, az, bx, bz, pad = 16) {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dz = bz - az;
    const tests = [
      [-dx, ax - pad],
      [dx, W - pad - ax],
      [-dz, az - pad],
      [dz, H - pad - az],
    ];
    for (const [p, q] of tests) {
      if (Math.abs(p) < 1e-6) {
        if (q < 0) return null;
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
    if (t1 - t0 < 0.02) return null;
    return { ax: ax + dx * t0, az: az + dz * t0, bx: ax + dx * t1, bz: az + dz * t1 };
  }

  function roadLabels(pred) {
    for (const r of ROADS) {
      if (pred && !pred(r)) continue;
      const pts = r.pts;
      let best = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = w2s(pts[i][0], pts[i][1]);
        const [bx, bz] = w2s(pts[i + 1][0], pts[i + 1][1]);
        const vis = clipSeg(ax, az, bx, bz);
        if (!vis) continue;
        const len = Math.hypot(vis.bx - vis.ax, vis.bz - vis.az);
        if (!best || len > best.len) {
          best = { ...vis, len, mx: (vis.ax + vis.bx) / 2, mz: (vis.az + vis.bz) / 2 };
        }
      }
      if (!best || best.len < 46) continue;
      let ang = Math.atan2(best.bz - best.az, best.bx - best.ax);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      rotLabel(r.name, best.mx, best.mz, ang, {
        size: r.major ? 12 : 10.5,
        weight: r.major ? '600' : '500',
        pill: true,
        color: r.major ? 'rgba(226,238,244,.95)' : 'rgba(198,212,221,.86)',
      });
    }
  }

  function drawHover() {
    const target = state.pinned && !state.hover ? state.pinned : state.hover;
    const pt = state.pinned && !state.hover ? state.pinnedPt : state.hoverPt;
    if (target) {
      const sh = MAP.shapes.get(target.name);
      if (sh) {
        ctx.save();
        ctx.shadowColor = 'rgba(255,212,121,.75)';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = 'rgba(255,212,121,.95)';
        ctx.fillStyle = 'rgba(255,212,121,.10)';
        ctx.lineWidth = 2;
        if (sh.type === 'rects') {
          const s = scale();
          for (const c of sh.cells) {
            const [sx, sy] = w2s(c.x, c.z);
            const w = Math.max(1.5, c.w * s);
            const d = Math.max(1.5, c.d * s);
            ctx.fillRect(sx - w / 2, sy - d / 2, w, d);
            ctx.strokeRect(sx - w / 2, sy - d / 2, w, d);
          }
        } else if (sh.type === 'ellipse') {
          oval(sh.x, sh.z, sh.rx, sh.rz);
          ctx.fill();
          ctx.stroke();
        } else if (sh.type === 'poly') {
          polyPath(sh.poly, true);
          ctx.fill();
          ctx.stroke();
        } else if (sh.type === 'line') {
          polyPath(sh.pts, false);
          ctx.lineWidth = Math.max(3, sh.width * scale() + 3);
          ctx.strokeStyle = 'rgba(255,212,121,.55)';
          ctx.stroke();
        } else if (sh.type === 'circle') {
          const [sx, sy] = w2s(sh.x, sh.z);
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(8, sh.r * scale() + 5), 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (pt) {
      const [sx, sy] = w2s(pt.x, pt.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.2, 0, TAU);
      ctx.fillStyle = 'rgba(255,212,121,.95)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, TAU);
      ctx.strokeStyle = 'rgba(255,212,121,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawPlayer() {
    const pose = getPose();
    const [sx, sy] = w2s(pose.x, pose.z);
    const h = pose.heading || 0;
    // 视野扇形（画布上方 = 正北）
    const dir = -Math.PI / 2 + h; // 屏幕坐标角度：heading 0 → 向上
    const R = 86;
    const half = 0.5;
    const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, R);
    g.addColorStop(0, 'rgba(255,212,121,.42)');
    g.addColorStop(1, 'rgba(255,212,121,0)');
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, R, dir - half, dir + half);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,212,121,.36)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 箭头
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(dir + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffd479';
    ctx.shadowColor = 'rgba(255,212,121,.8)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(10,16,20,.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  function drawScale() {
    const s = scale();
    const nice = [10, 20, 25, 50, 100, 200, 400, 800];
    let meters = nice[0];
    for (const m of nice) {
      if (m * s <= 150) meters = m;
    }
    const px = meters * s;
    const x = W / 2 - px / 2;
    const y = H - 24;
    ctx.save();
    ctx.strokeStyle = 'rgba(226,238,244,.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.lineTo(x + px, y - 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,224,232,.8)';
    ctx.font = '500 10.5px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(meters + ' m', x + px / 2, y - 7);
    ctx.restore();
  }

  function drawRose() {
    const cx = W - 44;
    const cy = 44;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, TAU);
    ctx.fillStyle = 'rgba(7,13,17,.62)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(226,238,244,.9)';
    ctx.font = '600 11px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - 15);
    // 指北针
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 4.5, cy + 9);
    ctx.lineTo(cx, cy + 5);
    ctx.lineTo(cx - 4.5, cy + 9);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,212,121,.9)';
    ctx.fill();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------
  function worldFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return s2w(e.clientX - r.left, e.clientY - r.top);
  }

  function setTip(res, clientX, clientY) {
    if (!res) {
      tip.classList.remove('on');
      return;
    }
    const r = body.getBoundingClientRect();
    tip.innerHTML = '<b>' + esc(res.name) + '</b><i>' + esc(res.sub || '') + '</i>';
    tip.style.left = Math.max(70, Math.min(W - 70, clientX - r.left)) + 'px';
    tip.style.top = Math.max(52, clientY - r.top - 12) + 'px';
    tip.classList.add('on');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function updateCard() {
    const res = state.pinned || state.hover;
    const pt = state.pinned ? state.pinnedPt : state.hoverPt;
    info.classList.toggle('empty', !res);
    if (!res) {
      info.innerHTML =
        '<div class="k">这里是什么</div>' +
        '<div class="t">' + (TOUCH ? '点一下地图上的位置' : '把鼠标移到图上') + '</div>' +
        '<div class="s">点击任意位置，可以固定查看该处的楼名、道路与说明。</div>' +
        '<div class="f">' +
        (TOUCH ? '拖动平移 · 双指缩放 · 点「关闭」返回' : '滚轮缩放 · 拖动平移 · M 或 Esc 关闭') +
        '</div>';
      return;
    }
    const pose = getPose();
    const d = pt ? Math.hypot(pt.x - pose.x, pt.z - pose.z) : 0;
    const note = res.item && res.item.note ? res.item.note : '';
    info.innerHTML =
      '<div class="k">' + (state.pinned ? '已固定 · 这里是什么' : '这里是什么') + '</div>' +
      '<div class="t">' + esc(res.name) + '</div>' +
      '<div class="s">' + esc(res.sub || '') + '</div>' +
      (note ? '<div class="n">' + esc(note) + '</div>' : '') +
      (pt ? '<div class="m">距你 ' + fmtMeters(d) + ' · 坐标 x ' + Math.round(pt.x) + ' z ' + Math.round(pt.z) + '</div>' : '') +
      '<div class="f">' + (state.pinned ? '再点一下地图可换位置' : '点击固定该位置') + '</div>';
  }

  function pick(e) {
    const [wx, wz] = worldFromEvent(e);
    const res = describeAt(wx, wz);
    return { res, pt: { x: wx, z: wz } };
  }

  function onMove(e) {
    if (pointers.has(e.pointerId)) ptrPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 双指捏合缩放（手机）
    if (pointers.size >= 2) {
      const now = pinchInfo();
      if (now && pinch && pinch.d > 4 && now.d > 4) {
        zoomAt(now.mx, now.my, now.d / pinch.d);
      }
      pinch = now;
      state.moved = true;
      state.dirty = true;
      tip.classList.remove('on');
      return;
    }
    if (state.dragging) {
      const s = scale();
      const fresh = lastPt && lastPt.id === e.pointerId;
      const dx = fresh ? e.clientX - lastPt.x : (e.movementX || 0);
      const dy = fresh ? e.clientY - lastPt.y : (e.movementY || 0);
      lastPt = { id: e.pointerId, x: e.clientX, y: e.clientY };
      state.cx -= dx / s;
      state.cz -= dy / s;
      clampCenter();
      state.moved = state.moved || Math.abs(dx) + Math.abs(dy) > 2;
      state.dirty = true;
      tip.classList.remove('on');
      return;
    }
    const { res, pt } = pick(e);
    state.hover = res;
    state.hoverPt = pt;
    setTip(res, e.clientX, e.clientY);
    state.dirty = true;
    if (!state.pinned) updateCard();
  }

  function onDown(e) {
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    pointers.add(e.pointerId);
    ptrPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastPt = { id: e.pointerId, x: e.clientX, y: e.clientY };
    state.dragging = true;
    state.moved = false;
    state.downAt = { x: e.clientX, y: e.clientY };
    body.classList.add('dragging');
    pinch = pointers.size >= 2 ? pinchInfo() : null;
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    ptrPos.delete(e.pointerId);
    lastPt = null;
    pinch = null;
    body.classList.remove('dragging');
    const wasDrag = state.moved || state.pointers.size > 0;
    state.dragging = state.pointers.size > 0;
    if (state.pointers.size) return;
    if (!wasDrag) {
      const { res, pt } = pick(e);
      state.pinned = res;
      state.pinnedPt = pt;
      state.hover = res;
      state.hoverPt = pt;
      updateCard();
      setTip(res, e.clientX, e.clientY);
      state.dirty = true;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 0.88 : 1.12);
  }

  const pointers = state.pointers;
  const ptrPos = new Map();
  let lastPt = null;

  function pinchInfo() {
    const ids = [...pointers].slice(0, 2);
    if (ids.length < 2) return null;
    const a = ptrPos.get(ids[0]);
    const b = ptrPos.get(ids[1]);
    if (!a || !b) return null;
    const r = canvas.getBoundingClientRect();
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      mx: (a.x + b.x) / 2 - r.left,
      my: (a.y + b.y) / 2 - r.top,
    };
  }
  let pinch = null;

  function onLeave() {
    if (state.pinned) return;
    state.hover = null;
    state.hoverPt = null;
    tip.classList.remove('on');
    updateCard();
    state.dirty = true;
  }

  // ---- 渲染循环 ----
  function loop(now) {
    if (!state.open) return;
    if (state.dirty || now - state.lastDraw > 60) {
      state.dirty = false;
      state.lastDraw = now;
      draw();
    }
    state.raf = requestAnimationFrame(loop);
  }

  // ---- 生命周期 ----
  function open() {
    if (state.open) return;
    state.open = true;
    root.classList.remove('hidden');
    resize();
    if (!state.homeSet) {
      state.homeSet = true;
      // 手机竖屏：按“填满高度”定初始缩放（但仍受 1.5–1.9 限制），并居中到玩家
      if (TOUCH) {
        const worldH = BOUNDS.maxZ - BOUNDS.minZ;
        const pad = W < 640 ? 14 : 30;
        const fill = ((H - pad * 2) / worldH) / baseScale;
        state.zoom = Math.min(1.9, Math.max(1.5, fill));
        const p = getPose();
        if (p && Number.isFinite(p.x)) {
          state.cx = p.x;
          state.cz = p.z + 20;
          clampCenter();
        }
      }
    }
    state.hover = null;
    state.pinned = null;
    state.pinnedPt = null;
    state.hoverPt = null;
    tip.classList.remove('on');
    updateCard();
    state.dirty = true;
    state.lastDraw = 0;
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(loop);
    closeBtn && closeBtn.focus({ preventScroll: true });
    if (opts.onOpen) opts.onOpen();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    root.classList.add('hidden');
    state.dragging = false;
    pointers.clear();
    body.classList.remove('dragging');
    tip.classList.remove('on');
    if (opts.onClose) opts.onClose();
  }

  // ---- 事件绑定 ----
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  // 双击缩放
  canvas.addEventListener('dblclick', (e) => {
    const r = canvas.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, state.zoom < 2.9 ? 1.8 : 0.2);
  });
  closeBtn.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  const ro = new ResizeObserver(() => {
    if (state.open) resize();
  });
  ro.observe(body);

  return {
    root,
    open,
    close,
    toggle: () => (state.open ? close() : open()),
    isOpen: () => state.open,
    setPose: () => {
      state.dirty = true;
    },
    setHeading: () => {
      state.dirty = true;
    },
    resize: () => {
      if (state.open) resize();
    },
  };
}
