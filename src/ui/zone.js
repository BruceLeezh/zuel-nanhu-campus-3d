// 区域判定：只用 layout.js 的真实坐标做「就近 / 包含」判断，不引入任何外部数据。
// 结果同时供 HUD 区域名、地图悬停与点击查询使用，保证两处口径一致。
import {
  BUILDINGS, PLAZAS, SPORTS, HILLS, GATES, LANDMARKS, LAKE, ROADS,
} from '../world/layout.js';
import {
  ellipseDistance, rectDistance, polylineNearest, pointInPoly, polygonDistance,
} from './geo.js';

// ---------------------------------------------------------------------------
// 文案：按建筑类型给副标题（更具体的名字用 layout.js 里的 note）
// ---------------------------------------------------------------------------
const BUILDING_SUB = {
  library: '图书馆 · 阅览与自习',
  modern: '教学与办公楼',
  classic: '教学楼',
  office: '行政办公',
  gym: '体育场馆',
  hall: '礼堂 · 校园活动',
  dorm: '学生公寓',
  canteen: '食堂 · 生活服务',
  museum: '博物馆 · 展陈',
  market: '生活服务',
};

const SPORT_SUB = {
  track: '环形跑道 · 标准 400 m',
  football: '草坪球场',
  court: '室外运动场地',
};

function buildingSub(b) {
  const name = b.name || '';
  if (/学院|研究院|研究中心|实验室/.test(name)) return '学院楼 · 教学科研';
  // 副标题要短，长注释留给地图卡片（那里有 note 字段）
  if (b.note && b.note.length <= 16) return b.note;
  return BUILDING_SUB[b.style] || '校内建筑';
}

function roadSub(road) {
  const pts = road.pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = Math.abs(b[0] - a[0]);
  const dz = Math.abs(b[1] - a[1]);
  const dir = dx > dz * 1.15 ? '东西向' : dz > dx * 1.15 ? '南北向' : '斜向';
  return (road.kind === 'arterial' ? '城市主干道' : '校园道路') + ' · ' + dir;
}

// ---------------------------------------------------------------------------
// 把 layout 数据整理成统一的可判定形状
//   { kind, name, sub, x, z, w/d/rot | rx/rz | r | pts/width, note, main, prio }
// ---------------------------------------------------------------------------
const ITEMS = { building: [], plaza: [], sport: [], hill: [], gate: [], landmark: [], road: [] };
let built = false;

function buildItems() {
  if (built) return;
  built = true;

  for (const b of BUILDINGS) {
    if (b.group && b.cells && b.cells.length) {
      let minX = Infinity; let maxX = -Infinity;
      let minZ = Infinity; let maxZ = -Infinity;
      for (const c of b.cells) {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minZ) minZ = c[1];
        if (c[1] > maxZ) maxZ = c[1];
      }
      ITEMS.building.push({
        kind: 'building',
        name: b.name,
        sub: '学生公寓区',
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        rx: (maxX - minX) / 2 + 20,
        rz: (maxZ - minZ) / 2 + 16,
        style: b.style || 'dorm',
        cells: b.cells,
      });
      continue;
    }
    ITEMS.building.push({
      kind: 'building',
      name: b.name,
      sub: buildingSub(b),
      x: b.x, z: b.z, w: b.w, d: b.d, rot: 0,
      style: b.style,
      note: b.note,
      main: !!b.main,
      prio: b.main ? 10 : 1,
    });
  }

  for (const p of PLAZAS) {
    ITEMS.plaza.push({
      kind: 'plaza',
      name: p.name,
      sub: p.kind === 'garden' ? '园林绿地 · 可自由穿行' : '广场 · 校园公共空间',
      x: p.x, z: p.z, rx: p.rx, rz: p.rz,
      prio: p.name === '五羊广场' ? 10 : 1,
      garden: p.kind === 'garden',
    });
  }

  for (const s of SPORTS) {
    ITEMS.sport.push({
      kind: 'sport',
      name: s.name,
      sub: SPORT_SUB[s.kind] || '运动场地',
      x: s.x, z: s.z, w: s.w, d: s.d, rot: 0,
    });
  }

  for (const h of HILLS) {
    ITEMS.hill.push({
      kind: 'hill',
      name: h.name,
      sub: '校内山丘 · 高程约 ' + h.h + ' m',
      x: h.x, z: h.z, rx: h.rx, rz: h.rz,
      note: h.name === '希贤岭' ? '以邓小平原名「希贤」命名的校内小山' : null,
    });
  }

  for (const g of GATES) {
    ITEMS.gate.push({
      kind: 'gate',
      name: g.name,
      sub: '校门 · 面向' + g.sub,
      x: g.x, z: g.z, w: g.w || 12, d: 12, rot: g.rot || 0,
      main: !!g.main,
      prio: g.main ? 10 : 1,
    });
  }

  for (const l of LANDMARKS) {
    const r = Math.max(4, (l.s || l.w || 6) / 2 + 2);
    ITEMS.landmark.push({
      kind: 'landmark',
      name: l.name,
      sub: l.text ? '题字「' + l.text.replace(/\s+/g, ' ') + '」' : landmarkSub(l),
      x: l.x, z: l.z, r,
    });
  }

  for (const r of ROADS) {
    ITEMS.road.push({
      kind: 'road',
      name: r.name,
      sub: roadSub(r),
      pts: r.pts,
      width: r.width,
      major: !!r.major,
      sidewalk: r.sidewalk || 0,
      prio: r.major ? 10 : 1,
    });
  }
}

function landmarkSub(l) {
  switch (l.kind) {
    case 'clocktower': return '校园地标 · 钟楼';
    case 'sculpture': return '校园地标 · 五羊雕塑';
    case 'flagpole': return '升旗广场 · 旗杆';
    case 'pavilion': return '湖畔亭榭 · 可小坐';
    case 'bridge': return '湖上曲桥';
    case 'motto': return '题字石';
    default: return '校园小品';
  }
}

const LAKE_ITEM = { kind: 'lake', name: LAKE.name, sub: '湖面与环湖步道', poly: LAKE.poly };

// ---------------------------------------------------------------------------
// 距离
// ---------------------------------------------------------------------------
function dist(it, x, z) {
  if (it.kind === 'lake') {
    if (pointInPoly(x, z, it.poly)) return -1;
    return polygonDistance(x, z, it.poly);
  }
  if (it.rx !== undefined) return ellipseDistance(x, z, it);
  if (it.w !== undefined && it.d !== undefined) return rectDistance(x, z, it);
  if (it.r !== undefined) return Math.hypot(x - it.x, z - it.z) - it.r;
  if (it.pts) return polylineNearest(x, z, it.pts).d - it.width / 2;
  return Infinity;
}

function nearestWhere(list, x, z, pred) {
  let best = null;
  for (const it of list) {
    const d = dist(it, x, z);
    if (pred && !pred(it, d)) continue;
    if (!best || d < best.d) best = { it, d };
  }
  return best;
}

function nearestInside(list, x, z) {
  return nearestWhere(list, x, z, (it, d) => d <= 0);
}

// 广场/校门这类「同圈时取主景」的判定
function nearestPriority(list, x, z, pred) {
  let best = null;
  for (const it of list) {
    const d = dist(it, x, z);
    if (pred && !pred(it, d)) continue;
    const prio = it.prio || 1;
    if (!best || prio > best.prio || (prio === best.prio && d < best.d)) best = { it, d, prio };
  }
  return best;
}

const hit = (it, d) => ({
  name: it.name,
  sub: it.sub,
  kind: it.kind,
  item: it,
  d,
});

const GREEN = {
  name: '校园绿地',
  sub: '林荫 · 可自由穿行',
  kind: 'green',
  item: null,
  d: 0,
};

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
export function describeAt(x, z) {
  buildItems();

  // 判定顺序：先「人一定站在里面」的东西（建筑 / 地标 / 校门 / 场地 / 广场），
  // 再是水面与山体——湖边有亭子、坡地上盖了食堂，把人归到建筑比归到山更合理。
  // 0 建筑轮廓内
  const bld = nearestInside(ITEMS.building, x, z);
  if (bld) return hit(bld.it, bld.d);

  // 1 地标近旁（半径很小，避免「站在广场上被旗杆抢名」）
  const lm = nearestInside(ITEMS.landmark, x, z);
  if (lm) return hit(lm.it, lm.d);

  // 2 校门
  const gate = nearestPriority(ITEMS.gate, x, z, (it, d) => d <= 0);
  if (gate) return hit(gate.it, gate.d);

  // 3 运动场内
  const sport = nearestInside(ITEMS.sport, x, z);
  if (sport) return hit(sport.it, sport.d);

  // 4 广场 / 绿地内
  const plaza = nearestPriority(ITEMS.plaza, x, z, (it, d) => d <= 0);
  if (plaza) {
    // 「希贤岭绿地」这类长在山上的园子，名字归山更符合直觉
    if (plaza.it.garden) {
      const same = ITEMS.hill.find((h) => (plaza.it.name || '').indexOf(h.name) === 0 && dist(h, x, z) <= 0);
      if (same) return hit(same, dist(same, x, z));
    }
    return hit(plaza.it, plaza.d);
  }

  // 5 湖面
  if (pointInPoly(x, z, LAKE.poly)) return hit(LAKE_ITEM, -1);

  // 6 山丘内（希贤岭等）
  const hill = nearestInside(ITEMS.hill, x, z);
  if (hill) return hit(hill.it, hill.d);

  // 7 道路上
  const road = nearestInside(ITEMS.road, x, z);
  if (road) return hit(road.it, road.d);

  // 8 离建筑很近
  const nearB = nearestWhere(ITEMS.building, x, z, (it, d) => d < 30);
  if (nearB) return hit(nearB.it, nearB.d);

  // 9 湖岸
  if (polygonDistance(x, z, LAKE.poly) < 26) return hit(LAKE_ITEM, polygonDistance(x, z, LAKE.poly));

  // 10 广场附近（绿地）
  const nearP = nearestWhere(ITEMS.plaza, x, z, (it, d) => d < 48);
  if (nearP) return hit(nearP.it, nearP.d);

  // 11 道路附近
  const nearR = nearestWhere(ITEMS.road, x, z, (it, d) => d < 26);
  if (nearR) return hit(nearR.it, nearR.d);

  return GREEN;
}

/** 同 describeAt，但只要「名字 + 副标题」，给 HUD 用 */
export function zoneAt(x, z) {
  const r = describeAt(x, z);
  return { name: r.name, sub: r.sub, kind: r.kind, d: r.d };
}

export { ITEMS as ZONE_ITEMS, LAKE_ITEM };
