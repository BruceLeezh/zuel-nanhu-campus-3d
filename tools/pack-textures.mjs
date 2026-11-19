// 把 assets/facade/ 下的立面瓦片打包成「可内联」的 JS 模块，保持单文件交付。
// 用法：node tools/pack-textures.mjs  [--atlas]
//   --atlas  额外生成 4×4=16 格的 2048² 图集（assets/facade/atlas-0.jpg）供多楼共用材质
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const SRC = 'assets/facade';
const MANIFEST = join(SRC, 'manifest.json');
const OUT = 'src/assets/facade-data.js';

if (!existsSync(MANIFEST)) {
  console.error('缺少 assets/facade/manifest.json —— 先跑 texturer 的 tools/facade-crop.py');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

let total = 0, count = 0;
const entries = [];
const skipped = [];
for (const [name, m] of Object.entries(manifest)) {
  // 只打包「真照片」：low 置信度 / flat 纯色带的瓦片不进包。
  // 理由：flat 瓦片没有窗格节奏，盖到程序化立面上会把窗带抹平，比现状更假；
  // 等补拍到真照片、manifest 改成 mid/high + band/bay 后会自动重新入选。
  const kind = m.kind || 'bay';
  const conf = m.confidence || 'mid';
  if (kind === 'flat' || (conf !== 'high' && conf !== 'mid')) {
    skipped.push(`${name}(${kind}/${conf})`);
    continue;
  }
  const file = join(SRC, m.tile);
  if (!existsSync(file)) { console.warn('缺瓦片:', name, m.tile); continue; }
  const buf = readFileSync(file);
  const ext = m.tile.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  entries.push({
    name,
    uri: `data:image/${ext};base64,${buf.toString('base64')}`,
    kind,
    floorsPerTile: m.floorsPerTile ?? 1,
    baysPerTile: m.baysPerTile ?? 1,
    wallColor: m.wallColor || '#d8d2c4',
    glassColor: m.glassColor || '#5f7f8c',
    trimColor: m.trimColor || '#eae3d2',
    confidence: conf,
    source: m.source || '',
    note: m.note || '',
  });
  total += buf.length; count++;
}
if (skipped.length) console.log('跳过（非真照片，保留程序化立面）:', skipped.join(' '));

mkdirSync('src/assets', { recursive: true });
const js = `// 由 tools/pack-textures.mjs 生成，勿手改。
// ${count} 张立面瓦片，原始 ${(total / 1024 / 1024).toFixed(2)} MB。
export const FACADES = ${JSON.stringify(entries, null, 1)};
export const FACADE_MAP = Object.fromEntries(FACADES.map((f) => [f.name, f]));
export const FACADE_TOTAL_BYTES = ${total};
`;
writeFileSync(OUT, js, 'utf8');
console.log(`✓ ${OUT}  ${count} 张，${(total / 1024).toFixed(0)} KB（base64 后约 ${(total * 1.37 / 1024).toFixed(0)} KB）`);
console.log('  单文件预计增量：' + ((total * 1.37) / 1024 / 1024).toFixed(2) + ' MB');
