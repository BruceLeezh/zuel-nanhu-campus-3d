# 项目协作契约（所有 teammate 先读这一页）

## 目标
把「中南财经政法大学 南湖校区」做成 **单个可直接双击打开的 HTML**（`dist/中南财经政法大学南湖校区-3D校园.html`），
内含完整 3D 校园 + 《人类一败涂地》式软体角色自由探索（走/跑/跳/攀爬/抓取/物理碰撞），无任务线，页面内附操作提示。

## 技术栈（已固定，勿更换）
- three@0.160.0（ESM，`import * as THREE from 'three'`）
- cannon-es@0.20.0（如需物理，`import * as CANNON from 'cannon-es'`）
- esbuild 打包成 IIFE → 内联进模板；**最终产物必须能 file:// 直接打开**，因此：
  **禁止 fetch / XHR / 外部图片 / CDN / import()**。所有贴图必须程序化 canvas 生成。
- UI 中文；等宽/无衬线中文用系统字体即可。

## 目录与文件归属（只改自己的文件！）
| 文件 | 归属 |
|---|---|
| `src/core/*`（config/util/textures/materials/sky） | **Lead**（只读引用，勿改） |
| `src/world/layout.js` | **Lead**（真实校园数据：道路/建筑/校门/湖/山/广场/地标/树区），只读 |
| `src/world/terrain.js` `src/world/roads.js` | **Lead**，只读 |
| `src/world/buildings.js` `src/world/landmarks.js` | **A 场景建筑** |
| `src/world/props.js`（可新增 `src/world/props/*.js`） | **B 自然与街具** |
| `src/game/physics.js` `src/game/character.js` `src/game/player.js` `src/game/grab.js` `src/main.js` | **C 物理角色** |
| `src/ui/hud.js` `src/ui/map.js`（可新增 `src/ui/*.js`） | **D 交互界面** |
| `build/*` `package.json` | **Lead** |

## 构建与自检
```bash
node build/build.mjs                     # 打包 → dist/*.html（会打印体积）
bash tools/shot.sh <名字> "?cam=x,z&cy=高度&yaw=0&pitch=0.3"   # 生成截图 work/shots/<名字>.png
```
截图用无头 Edge（WebGL 走 SwiftShader），**不要**用共享的 browser_* 工具（会互相干扰）。
调试相机参数：`?cam=x,z`（镜头位置）、`?cy=` 相机高度、`?yaw=&pitch=` 朝向、`?px=x,z` 玩家出生点。
看截图请用 read_image 打开 `work/shots/xxx.png`。

## 世界坐标
世界单位 = 米。**+x = 东，+z = 南，y = 上**。原点 = 五羊广场。校园范围约 x∈[-680,1010]、z∈[-560,700]。
地面高度一律用 `heightAt(x,z)`（`src/world/terrain.js`），**不要自己假设 y=0**；湖面 `waterLevel()` = -1.6。

## 数据要点（`src/world/layout.js` 里都有）
- `ROADS`：18 条真实路名（南湖大道/民族大道/博文路/治国路/格物街/正心街/诚意街/中原大道/中南大道/厚德路/济世路/修身路/齐家路/天下路/明理路/梓年路/亲民路/水蓝路），带宽度与折线。
- `BUILDINGS`：~70 条真实楼名（逸夫图书馆/文泰楼/中原楼/文泉楼/文澜楼/文波楼/文泓楼/文治楼/文清楼/文湛楼/文潭楼/文溯楼/文济楼/文澴楼/文添楼/文沛楼/文永楼/南湖会堂/南湖体育馆/体育中心/医院/食堂/公寓区…），x/z 为真实位置，w/d/h 为按类型推算。
- `GATES` 12 个真实校门、`LAKE` 晓南湖多边形+岛、`HILLS` 希贤岭、`SPORTS`、`PLAZAS`、`LANDMARKS`（五羊雕塑/钟楼/旗杆/亭/曲桥/校训石）、`TREE_ZONES`。
- `STYLE_PRESETS`：各类建筑层高/开间/配色/屋顶型。
**数据缺口要在 `work/campus-sources.md` 记录**：楼栋尺寸、层数、立面为按公开资料与类型推算，非测绘。

## 质量要求
1. 视觉：像「一所真实大学校园」，不是方块堆。屋顶/檐口/门厅/窗格/台阶/围墙都要有；尺度要对（人 1.7 m，楼 3-7 层）。
2. 性能：1080p 中端核显 ≥30 FPS；draw call 尽量合并（同类静态物件合并成一个 mesh），阴影只给近处/主要物体。
3. 稳定：不得抛异常；文件都能 file:// 打开；错误要有中文提示。
4. 完成前必须自己出截图确认（至少 3 个机位），并把截图路径写进汇报。
