# 可复用设计要点（参考作品 → 本项目）

> 素材：`work/pg/`（Interactive-Playground：Hollowmoor 万圣夜游乐园 / Sweetheart Park 童话乐园，Three.js）
> 与 `work/qm/`（清明上河图 · 手卷式可探索街市，2.5D）。
> 本文只提炼**能迁移到别的项目**的做法，并标注哪些我们用了、哪些刻意没用。
> 数据可信度与缺口另见 `work/campus-sources.md`。

---

## 0. 先分清三种"作品形态"

| | Interactive-Playground | 清明上河图（qm） | 本项目（3D 校园） |
| --- | --- | --- | --- |
| 形态 | 双页面 3D 乐园，ES module 多文件 | 单页手卷街市，2.5D 分层 | 单个 HTML，3D 自由漫游 |
| 运行方式 | 需 HTTP 服务；three 走 CDN import map | 需 HTTP（本地 mp3 / webp 素材） | **双击 `file://` 直接打开，无任何外部请求** |
| 素材 | 程序化建模 + 少量贴图 | imagegen 生成背景/人物 + 手工修图 | 100% 程序化（几何 + CanvasTexture） |
| 玩法 | 游乐设施、演出、导览 | 点人对话、坐船、任务收集 | 无任务线、无计时，纯探索 |
| 最值得抄的 | 画质分档 + 自动降档、演出编排 | 提示词工程、手卷镜头与"短按/按住"移动手感 | —— |

**第一条结论**：形态决定架构。pg 的 `import` + CDN 结构不适合"双击即玩"的交付，qm 的本地 mp3/webp 也不适合；所以本项目把 esbuild 打成 IIFE 再内联进模板（`build/build.mjs`），换来零请求、零跨域、单文件可发。抄参考作品要抄**方法**，不要抄**它的基础设施**。

---

## 1. 工程与交付

### 1.1 参数集中、单一来源

- 参考：pg 把所有可调项塞进 `js/playground/config.js`（雾、光层、后期、画质档、粒子预算、相机、园区布局），文件头写明"这是唯一要改的地方"。
- 本项目：`src/core/config.js` 一个 `CFG` 管住 world / render / sky / player / camera / physics / quality / keys（共 60 余项，含 `seed: 20261109`）。改手感只改 `CFG.player.walk/run/sprint/accel`，改画质只改 `CFG.quality.*`。
- 可复用点：**给每个数值写单位与用途注释**；把"策划参数"和"实现参数"分开（我们前者在 CFG，后者在模块内）。

### 1.2 程序化贴图（不引入图片文件）

- 本项目：`src/core/textures.js:15/283/304`、`src/world/buildings/facade.js:13`、`src/world/props/shared.js:66` 全部用 `CanvasTexture`——砖缝、玻璃、草地、树皮、招牌都是画出来的；道具用 **1024×1024、4×4 格图集**（`props/shared.js`）合批。
- 收益：零素材体积、零 404、风格可参数化（换 `STYLE_PRESETS` 颜色整套变）；代价：写不出照片级细节，只能做"远看像、近看是色块"的风格化。
- 对照：qm 用 imagegen 出**背景板**（2172×724、3:1）再手工修，人物用**透明图集**由 CSS/Canvas 变形。两条路都能出效果，但**素材来源必须写清**（qm 的 `docs/prompts/*.md` 就是这么做的）。

### 1.3 画质分档（三档 + 手动切换）

- 参考：pg `js/playground/config.js:47-52` 有 `quality` 档与
  `autoDegrade: { warmup: 14, window: 2, minFps: 26 }`（预热 14 s、2 s 窗口、低于 26 fps 降档），
  `core/renderer.js:3` 注明每档控制 pixel ratio / shadow map / 阴影更新节奏 / bloom / 粒子 / 植被密度 / 夜灯数量，
  `:22` 按 `IS_MOBILE` 选初始档；主循环 `main.js:95` 每帧 `autoQuality()`；README 里对外承诺"多档画质与自动降级，F3 看帧率/绘制调用/三角形数"。
- 本项目：`CFG.quality` 三档（`low/mid/high` = dpr 1/1.5/2、阴影 1024/2048/2048、阴影每 3/2/1 帧、树 0.45/0.75/1、道具 0.5/0.8/1、草 0/1/1），`P` 键循环、`?q=low|mid|high` 直选；HUD 的 `#stats` 对应 pg 的 F3（FPS / 绘制调用 / 坐标），FPS < 45 变暖黄提醒。
- **诚实差距**：我们只做了"分档 + 手动"，没做自动降档。若 15 分钟能加，最小实现是：连续 2 s FPS < 30 → 调 `applyQuality(next lower)` 一次并提示；这比"每帧检测"稳定，也不至于在加载期误降。

### 1.4 降级与失败要说人话

- 参考：qm 在 WebGL 不可用时直接回落到 2D 街市，`prefers-reduced-motion` 时改用静态虚线，切后台停止三维绘制/音频并释放纹理与监听器（`docs/CROSSING-PREVIEW.md:17`）。
- 本项目：`#boot` 引导 + `#fatal` 兜底（`main.js` 的 `fail()` 文案会给"按 P 降画质或刷新"的建议）；帮助面板页脚固定一句"场景按公开资料还原，非精确测绘"——**先声明边界，再谈体验**。
- 可复用点：任何"生成/重建"型页面都要有 ①加载话术 ②失败话术 ③能力声明。

### 1.5 性能数字要带测量条件

- 参考：qm `docs/CROSSING-PERFORMANCE.md:7` 写清机器（M1 Pro）、浏览器版本、Playwright 无头、CSS 尺寸 1200×910、DPR 2、缓存关闭、限速 1.5 MB/s + 150 ms 延迟。
- 本项目：截图固定 `tools/shot.sh`（Edge headless + SwiftShader + 1280×800 + virtual-time 12 s），所以"截图里的 FPS 不代表真机"——汇报性能时必须带上 `?q=` 档位与设备信息。
- 可复用点：**没有测量条件的帧率等于没测**。

---

## 2. 相机与移动手感

### 2.1 相机相对控制器 + 指数阻尼

- 参考：pg 用 orbit/dist 目标值 + 每帧阻尼逼近（不是直接 set），镜头永远"追"而不是"跟"。
- 本项目：`src/game/player.js` 里 `boom = damp(boom, targetLen, rate, dt)`（:482）、`camY = damp(camY, position.y, 11, dt)`（:470）、速度 `damp(root.velocity.x, dirX * speedTarget, rate, dt)`（:349），朝向 `dampAngle(facing, atan2(dirX, dirZ), P.turnRate, dt)`（:373），`CFG.camera.damp = 9`、`pivotHeight = 1.25`。
- 手感要点：**位置/朝向都走阻尼，但输入方向不阻尼**；起停要有 0.1–0.2 s 的重量，转向不能滞后于瞄准。

### 2.2 贴地 + 弹簧臂防穿墙

- 本项目：`heightAt(x,z)`（`src/world/terrain.js`）决定脚底高度（`player.js:145/159/402/489` 都先取地形再夹），相机用 `cameraClear(pivot, -dir, dist)`（:479）求"视线到墙的距离"，再 `targetLen = max(0.7, dist * clear)`、`boom` 阻尼跟随并 `if (boom > dist) boom = dist`（:483），最后相机高度也不低于 `heightAt+0.3`（:489）。
- 直接后果：进小巷/贴墙时镜头自动拉近而不是穿模；上坡时镜头跟着抬。参考作品也走同一套思路（碰撞体 + 距离衰减）。
- 可复用点：**先算"视线可用的最长距离"，再阻尼，不要反过来**；最小距离给一个下限（0.7 m）以免贴脸。

### 2.3 输入语义：短按 / 按住 / 连续输入 / 换向

- 参考（qm `docs/CONTROLS.md:4-6`）：左右短按走一小段；按住持续行走、松开减速停下；连续输入保留速度；**换向先减速**；过桥按坡度调速；点击街道行人走到该处；点击店铺人物 → 对方回应；附近也可按 `E`；点击水面产生波纹。
- 本项目：键盘 `WASD + Shift 跑 + Space 跳 + E 抓/放 + Q 就近互动 + F 攀爬 + C 视角 + R 回广场 + M 地图 + H 帮助 + P 画质`；触屏用 `#stick`（移动）+ `#look`（视角）+ `跳/抓/跑` 三键，事件通过 `ui-input` 自定义事件 / `window.__uiTouch` 与玩法层解耦（见 `src/ui/touch.js`、`src/ui/hud.js`）。
- 可复用点：**把"意图"和"按键"分开**。移动端不是"键盘模拟"，而是同一个意图源（move/look/press/run）；这样以后换手柄只加一个适配器。

### 2.4 物理反馈与"可抓的东西"

- 参考：pg 有 lantern、shell 等可交互物；qm 的点击对象都有明确命中区域，且**移动后命中区域跟着更新**（`docs/ARCHITECTURE.md:10`），图集裁切边界与点击范围用同一套 alpha 连通轮廓（`docs/CITY-FUSION.md:11`）。
- 本项目：cannon-es 刚体（`CFG.player.mass=62`、`grabReach=2.2`、`grabForce=22`），可抓篮球等；`#dot` 准星在可交互时放大 1.9× 并变暖黄（`#dot.act`），`#hint` 同步给"按 E 抓起 篮球"。
- 可复用点：**视觉高亮和可交互判定必须同源**，否则会出现"看着能点却没反应"。

### 2.5 无任务线也是一种设计

- pg / qm 都有明确玩法（演出、任务收集）。本项目反其道：没有任务、没有计时、没有 KPI，只有区域名、地图和"这里是什么"。
- 可复用点：**探索型体验的"进度感"来自空间认知**（知道自己在哪、附近有什么），而不是任务列表——所以区域名 + 地图 + 罗盘是核心功能，不是装饰。

---

## 3. 地图与信息层

### 3.1 用真实数据画"示意平面图"

- 本项目 `src/ui/map.js`：直接读 `layout.js` 的 `BOUNDS / CAMPUS_OUTLINE / ROADS / LAKE / HILLS / BUILDINGS / PLAZAS / SPORTS / GATES / LANDMARKS`，用 `zoom 1..4.2` 的等比投影绘制；比例尺取 10/20/25/50/100/200/400/800 m 的"好数字"；有图例、指北玫瑰、当前视野扇形、悬停/点击"这里是什么"。
- 关键细节：①道路名按**裁剪后可见线段**的中点旋转标注（`clipSeg`，Liang–Barsky），否则长路过界时标签会被丢到画布外；②标签按优先级分段绘制（湖山 → 主干道 → 主馆 → 主门 → 次路 → 次楼 → 广场），后面用矩形避让（`collides`），出生点用 `force` 兜底；③地图上的图形与场景用**同一份坐标**，不另画一张"好看的"示意图。
- 参考：qm 把"空间交互标记"（`.scene-action`、`.district-stop`）明确列为**不可覆盖成矩形按钮**的元素（`docs/BUTTON-DESIGN.md:9`）——地图上的点、路、楼也是同理，保持几何形状比"做成卡片"更可信。

### 3.2 视觉语言：深色玻璃 + 一个暖黄

- 模板 CSS 已定 `--glass rgba(12,20,26,.62)`、`--glass-b rgba(255,255,255,.12)`、`--accent #ffd479`、`--accent2 #7fd1c0`。HUD 所有面板共用 `.panel`（14 px 圆角 + 9 px blur），信息层只用两种"墨色"（正文 `#eef2f4`、次要 `#9fb0bb`）和一个高亮色。
- 对照：qm 是纸本淡彩（米黄 + 墨线 + 石绿），3D 场景是自然光。**UI 不能和场景抢颜色**：场景越写实，UI 越要退成玻璃与细线；高亮只留给"当前/可交互/危险"三类语义。

### 3.3 移动端信息降级

- `pointer: coarse` 或 `maxTouchPoints>0 && 宽度<820` → `html.touch-ui`：隐藏 `#keys` 键位表、罗盘缩到 92 px、帮助面板单列可滚动、`#hint` 移到顶部避开摇杆、左上出现地图圆钮（`#mapbtn`，z-index 26 高于 `#touch` 的 25）。
- 可复用点：**移动端不是缩小版桌面**，是"减少常驻信息 + 放大可点区域 + 移开拇指遮挡区"。

### 3.4 HUD 的三个“容易做错”的地方

1. **罗盘角度**：世界 yaw 与罗盘方位不是同一个角。本项目约定 yaw 0 = 朝 +z（南）、π/2 = 朝 +x（东），所以罗盘方位 `bearing = π − yaw`；画刻度时把方位 `a` 画在屏幕角 `a − bearing` 处（`x = cx + sin(a−b)·r`、`y = cy − cos(a−b)·r`），盘面固定、指针随人转。固定视野扇形画在正上方，用户一眼能看出“盘面在转”。
2. **键位互斥**：`H` 由主循环调用 `hud.toggleHelp()`，HUD 自己的键盘监听就**只记录不切换**，否则一次按键翻转两次（面板闪一下就回去）。`M`（地图）反过来：主循环没接，就在 `window` 捕获阶段接，并在模态打开时 `stopPropagation()`，防止 WASD 继续驱动角色。
3. **提示条要能自己推断**：`#hint` 不能只等外部传字符串（没人调就永远空着）。做法是外部 `setHint()` 可临时接管 1.5 s，其余时间 HUD 每 0.2 s 自查：手里有没有东西（放下）→ 是否攀爬中（松手提示）→ 最近可抓物水平距离 < 2.2 m 且高差 < 1.8 m（抓起）→ 体力见底（松开 Shift）。**高差检查很重要**：物理体万一掉出世界（y ≈ -8000），不检查高差就会在出生点提示“抓起篮球”。

---

## 4. 提示词工程（qm 的模板，可直接抄）

qm 的 `docs/prompts/ASSETS.md`、`PROMPT.md`、`BOAT-PROMPT.md`、`FEATURED-PROMPTS.md` 是目前见过最工程化的写法。归纳成六段式：

1. **Use case / Asset type** —— 先声明用途与素材类型。
   `Use case: precise-object-edit.` / `Asset type: clean background plate for animation.` / `Asset type: TRANSPARENT PNG character sprite atlas…`
2. **画布与比例** —— 给死尺寸，不给"high resolution"。
   `2172 x 724`、`3:1`、`3840 by 1280 pixels`、`Canvas 3:2`。
3. **构图锚点（世界坐标）** —— 用比例或像素坐标锁住要素。
   `the continuous walkable street runs at y=477`、`stone quay top at y=493`、`river water below y=525`、`sky in upper 20%`、`left-center window rectangle approximately x392..566,y239..521`。
4. **必须保留** —— 逐条列出不能动的东西。
   `Absolutely preserve the existing image layout and registration: same 3:1 canvas, identical bridge silhouette…`；
   `preserve EXACT canvas dimensions…interactive coordinates already depend on them`。
5. **负面清单** —— 比正面描述更能稳定出图。
   `no text, no labels, no border, no watermark, no glossy rendering, no photographic realism`；
   `no large red lanterns, no fantasy pagodas`；`no people and no animals anywhere`。
6. **留给程序的部分** —— 明确"这张图不画什么，因为后面要动"。
   `Remove EVERY human figure…because every inhabitant will be animated as a separate layer later`；
   `No people and no oar: those will be animated separately`；
   `DO NOT DRAW the pole, oar, boat, water or scenery`；
   `GENUINELY TRANSPARENT BACKGROUND WITH ALPHA`、`no shadow outside the object`。

两个高价值技巧：
- **先出"干净底板"，再逐层叠动画**。人物/船/水面全部单独出图，底板永远无人无船——这样动画层可以随时替换、缩放、做呼吸感，不会把原画"焊死"。
- **用"修图型"提示词迭代，而不是重生成**。qm 的做法是 `precise-object-edit`：只替换棋盘格背景、只改窗景、只统一色调，并反复强调"pixel aligned / same positions / exact same canvas"——这比重新描述整张图稳得多。

> 本项目没有外部图片，所以这套模板当前没被直接用上；但它对"以后要出海报、角色立绘、贴图"仍然适用。**诚实说明**：程序化贴图的观感上限低于 imagegen 出图，这是为"单文件、零请求"付出的代价。

---

## 5. 十条可复用检查表

1. 打开方式先定：`file://` 还是 HTTP？（决定打包与素材策略）
2. 参数是否集中在一处？改手感要不要翻 5 个文件？
3. 有没有"分档 + 降级"？降档后是否仍在可玩帧率？
4. 相机是否"追"而不是"钉"？贴墙时会不会穿模？
5. 地形/铺装/道路有没有 `polygonOffset` 或分层偏移防 z-fighting？（本项目 `materials.js:76-84`、`roads.js:79-81/291-292`、`buildings.js:39-41`）
6. 合批了吗？同材质的铺装/道具/窗格是否并成少量 draw call？
7. 交互高亮与判定是否同源？移动后命中区是否跟着更新？
8. 地图/小地图是否用真实坐标？比例尺/指北针是否可信？
9. 移动端是否减少常驻信息、避开拇指区、放大可点区？
10. 失败/加载/能力声明是否写清？数据来源与缺口是否如实标注？

## 6. 我们刻意没做的

- **不做自动导览/演出**（pg 的 cinematic tour 很强，但会把"自由探索"变成"看片"）。
- **不做任务与收集**（qm 的收集册适合内容型页面，不适合"逛校园"）。
- **不做照片级立面**（没有素材也不该假装有）。
- **不假装精确**：地图写明"示意平面图"，文档写明精度（`work/campus-sources.md` 第 5 节）。

---

*本文与 `work/campus-sources.md` 一起构成交付说明：一份讲"东西是怎么来的"，一份讲"为什么这么做"。*
