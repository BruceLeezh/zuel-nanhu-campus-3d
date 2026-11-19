// 构建：把 src/main.js 打包成 IIFE，再内联进 template.html → dist 单文件
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist');
mkdirSync(outDir, { recursive: true });

const minify = process.argv.includes('--min');
const res = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  minify,
  sourcemap: false,
  legalComments: 'none',
  loader: { '.glsl': 'text' },
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
});

const js = res.outputFiles[0].text;
if (js.includes('</script')) throw new Error('bundle 中含 </script，需转义');

const tpl = readFileSync(resolve(root, 'build/template.html'), 'utf8');
if (!tpl.includes('/*__BUNDLE__*/')) throw new Error('模板缺少 /*__BUNDLE__*/ 占位');
const html = tpl.replace('/*__BUNDLE__*/', () => '\n' + js + '\n');

const outFile = resolve(outDir, '中南财经政法大学南湖校区-3D校园.html');
writeFileSync(outFile, html, 'utf8');
const kb = (statSync(outFile).size / 1024).toFixed(0);
console.log(`✓ ${outFile}  (${kb} KB, js ${(js.length / 1024).toFixed(0)} KB)`);
