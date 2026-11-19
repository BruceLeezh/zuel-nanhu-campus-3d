# 交接说明（2026-11-10 19:00）

## 当前状态
- 单文件交付物：`dist/中南财经政法大学南湖校区-3D校园.html`（1.65 MB，file:// 双击可玩，探针全绿）。
- 技术路线已定：**单文件 HTML + 照片立面贴图**（几何用代码、体积给贴图）。详见 `work/tech-plan.md`。
- 逐栋 GLB 管线已通：`tools/glb.mjs` + `tools/build-asset.mjs` → `assets/buildings/*.glb`（11 栋已导出并校验）。

## 本轮正在进行
1. `texturer`：从实拍照片裁 12 栋立面瓦片 → `assets/facade/<楼名>.jpg` + `manifest.json`。
2. `integrator`：把瓦片打包进单文件（`tools/pack-textures.mjs` → `src/assets/facade-data.js`），并让这 12 栋用「实拍立面材质」渲染（每栋独立材质/网格，draw call 约 +12），替换通用窗格贴图。

## 关键约束
- 单文件体积上限 ~15 MB（base64 +33%）；单张 512² JPEG q85 ≈ 40–90 KB。
- 不得破坏：`?cam/cy/yaw/pitch` 调试相机、`?shot=1&ui=0` 截图模式、`?probe=1` 探针、file:// 直开。
- 构建：`node build/build.mjs`；截图：`bash tools/shot.sh <名> "?cam=..&shot=1&ui=0"`（GPU 约 5 s/张，串行）。

## 已确认的建模事实（勿重复踩坑）
- 图书馆正面朝**北**（-z，面向五羊广场）；中原楼正面朝**北**；文泰楼北立面有弧形凸厅。
- 材质桶共享材质 → 一栋一个贴图会破坏合批；11–12 栋可接受（+12 draw calls）。
- 屋顶四坡/攒尖的四边形绕序与盒子相反，必须 DoubleSide + emissive 兜底，否则全黑。
- 没有 envMap：玻璃 roughness 不能太低，否则全黑；metalness 压到 ≤0.2。
