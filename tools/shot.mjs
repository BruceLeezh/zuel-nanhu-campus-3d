// node tools/shot.mjs [name] [query] —— 同 tools/shot.sh 的 Node 版（供 teammate 使用）
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
const name = process.argv[2] || 'shot';
const query = process.argv[3] || '';
const root = 'C:/Users/lenovo/Desktop/抖音校园';
execFileSync('node', [root + '/build/build.mjs'], { cwd: root, stdio: 'ignore' });
copyFileSync(root + '/dist/中南财经政法大学南湖校区-3D校园.html', root + '/dist/preview.html');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
execFileSync(edge, [
  '--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
  '--screenshot=' + root + '/work/shots/' + name + '.png',
  '--window-size=1600,900', '--virtual-time-budget=1500', '--hide-scrollbars',
  'file:///C:/Users/lenovo/Desktop/%E6%8A%96%E9%9F%B3%E6%A0%A1%E5%9B%AD/dist/preview.html' + query,
], { stdio: 'ignore' });
console.log('SHOT: ' + root + '/work/shots/' + name + '.png');
