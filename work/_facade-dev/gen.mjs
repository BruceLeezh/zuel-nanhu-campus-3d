// 开发用：造几张「合成立面瓦片」验证 UV / repeat 数学。
// 注意：输出到 work/_facade-dev/，**不碰** assets/facade/（那是 texturer 的地盘）。
// 产物 src/assets/facade-data.js 会带 DEV 标记；真瓦片到位后必须重跑
// `node tools/pack-textures.mjs` 覆盖掉。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve('work/_facade-dev');
const TILES = join(OUT, 'tiles');
mkdirSync(TILES, { recursive: true });

// ---------------- 极简 PNG 编码（无第三方依赖） ----------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------- 合成一张「1 层 × bays 开间」的立面 ----------------
// DEBUG=1 时用高对比棋盘：每个「开间 × 楼层」= 唯一色块，
// 一眼就能看出重复次数对不对、窗户有没有被拉长。
const DEBUG = process.env.DEBUG === '1';
const BAY_COLORS = [[255, 92, 0], [0, 168, 170], [220, 30, 120], [180, 200, 20]];

function makeTile({ bays = 2, bayM = 5.5, floorM = 4.0, wall = [216, 210, 196], glass = [92, 116, 128], trim = [236, 230, 216] }) {
  const PX = 46;                      // 像素/米（512 宽 ≈ 11m）
  const w = Math.round(bays * bayM * PX);
  const h = Math.round(floorM * PX);
  const buf = Buffer.alloc(w * h * 3);
  const put = (x, y, c, k = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    buf[i] = Math.min(255, c[0] * k); buf[i + 1] = Math.min(255, c[1] * k); buf[i + 2] = Math.min(255, c[2] * k);
  };
  const bayPx = w / bays;
  for (let y = 0; y < h; y++) {
    const v = 1 - y / h; // 0 = 底
    for (let x = 0; x < w; x++) {
      const bi = Math.floor(x / bayPx);
      const bx = (x % bayPx) / bayPx; // 0..1 within bay
      let c = wall, k = 1;
      if (DEBUG) {
        c = BAY_COLORS[bi % BAY_COLORS.length];
        k = 1;
        // 竖向 3 段：下 25% 深（窗台）、中 50% 窗（更暗）、上 25% 亮
        if (v > 0.25 && v < 0.75) k = 0.42;           // 窗：明显压暗
        else if (v >= 0.85) k = 0.75;                  // 楼板线
        if (bx < 0.04 || bx > 0.96) { c = [255, 255, 255]; k = 1; } // 开间分界白线
      } else if (v < 0.10) { c = trim; k = 0.92; }                        // 楼板线
      else if (v > 0.80) { c = wall; k = 1.04; }                    // 窗上墙（受光）
      else if (v >= 0.44 && v <= 0.80) {
        // 窗：左 6% 是窗间墙，其余玻璃 + 竖梃
        if (bx < 0.07) { c = trim; }
        else if (bx > 0.93) { c = trim; }
        else if (bx < 0.10 || bx > 0.90) { c = [150, 150, 148]; }
        else { c = glass; k = 0.9 + 0.22 * (1 - v); }                // 上亮下暗，像反天光
        // 竖向中梃
        if (Math.abs(bx - 0.5) < 0.012) { c = [168, 168, 166]; }
      }
      // 砖缝噪点，避免纯色看起来像塑料
      const n = ((x * 7 + y * 13) % 11) / 11;
      put(x, y, c, k * (0.96 + n * 0.08));
    }
  }
  return { w, h, buf };
}

const SPECS = [
  { name: '逸夫图书馆', wall: [222, 216, 200], glass: [86, 112, 126], trim: [240, 235, 222] },
  { name: '文泰楼', wall: [214, 218, 216], glass: [96, 132, 146], trim: [232, 234, 230] },
  { name: '中原楼', wall: [212, 204, 188], glass: [120, 150, 160], trim: [228, 220, 204] },
];

const entries = [];
let total = 0;
for (const s of SPECS) {
  const { w, h, buf } = makeTile({ bays: 2, bayM: 5.5, floorM: 4.0, wall: s.wall, glass: s.glass, trim: s.trim });
  const file = join(TILES, `${s.name}.png`);
  const data = png(w, h, buf);
  writeFileSync(file, data);
  total += data.length;
  entries.push({
    name: s.name,
    uri: `data:image/png;base64,${data.toString('base64')}`,
    kind: 'bay',
    floorsPerTile: 1,
    baysPerTile: 2,
    wallColor: '#' + s.wall.map((v) => v.toString(16).padStart(2, '0')).join(''),
    glassColor: '#' + s.glass.map((v) => v.toString(16).padStart(2, '0')).join(''),
    trimColor: '#' + s.trim.map((v) => v.toString(16).padStart(2, '0')).join(''),
    confidence: 'dev',
    source: 'synthetic',
    note: `${w}x${h} 合成测试瓦片`,
  });
  console.log(`  ${s.name}  ${w}x${h}  ${(data.length / 1024).toFixed(0)} KB`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(Object.fromEntries(entries.map((e) => [e.name, {
  tile: `${e.name}.png`, kind: e.kind, floorsPerTile: e.floorsPerTile, baysPerTile: e.baysPerTile,
  wallColor: e.wallColor, glassColor: e.glassColor, trimColor: e.trimColor, confidence: 'dev', note: e.note,
}])), null, 1));

const js = `// ⚠️ DEV-FAKE：合成测试瓦片，不是实拍。
// 真瓦片到位后必须重跑 node tools/pack-textures.mjs 覆盖本文件。
export const FACADES = ${JSON.stringify(entries, null, 1)};
export const FACADE_MAP = Object.fromEntries(FACADES.map((f) => [f.name, f]));
export const FACADE_TOTAL_BYTES = ${total};
`;
writeFileSync(resolve('src/assets/facade-data.js'), js, 'utf8');
console.log(`✓ ${entries.length} 张合成瓦片，${(total / 1024).toFixed(0)} KB → src/assets/facade-data.js（DEV-FAKE）`);
