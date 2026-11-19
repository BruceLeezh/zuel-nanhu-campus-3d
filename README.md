# 中南财经政法大学南湖校区 · 3D 校园

单文件、`file://` 双击即玩的 HFF（人类一败涂地）风格开放探索 3D 网页。
纯前端：Three.js 渲染 + cannon-es 物理 + esbuild 打包，无服务器、无 CDN 依赖。

![出生点](work/shots/spawn_final.png)

## 快速开始

```bash
npm install      # 安装依赖（three / cannon-es / esbuild）
npm run build    # 产出 dist/中南财经政法大学南湖校区-3D校园.html（约 1.8 MB）
npm run normcheck  # 合并几何法线自检
```

构建产物双击即可游玩；`dist/preview.html` 是带调试参数的开发副本。

## 操作

| 键位 | 功能 |
|---|---|
| WASD / 方向键 | 移动 |
| Space | 跳跃 / 攀爬（靠近墙面） |
| E | 抓取附近道具 |
| Q | 互动（坐/喝水/看牌） |
| C | 切换视角（第三/第一人称） |
| R | 回到出生点 |
| H | 帮助面板 |
| P | 画质档切换 |

## 调试参数（URL query）

`?cam=x,z&cy=高&yaw=弧度&pitch=俯角` 定机位截图；`&shot=1` Edge headless 出图；
`&px=x,z` 玩家出生点；`&probe=1` 跑物理测试套件（结果写 `body[data-probe]`）；
`&q=low|mid|high` 画质档；`&noplayer=1` 隐藏角色。

## 目录结构

```
src/            游戏源码（core 渲染核心 / world 世界 / game 玩家 / ui / assets）
build/          esbuild 打包（单文件内联）
tools/          构建与勘验脚本（截图 / 立面裁切 / 资产导出 / 法线自检）
assets/         立面照片与逐栋 GLB（由 tools 生成/消费，见 assets/README.md）
dist/           构建产物（可玩 HTML）
work/           工作区：
  docs/         设计文档、修复日志、需求清单
  poi_local.txt 百度 POI 采集的真实布局数据（layout.js 的数据来源）
  real-photos/  立面实拍原图（facade-crop.py 的输入，未入库）
  ref/          抖音参考账号截图
  _facade-dev/  立面瓦片开发裁切
  shots/        全部验证截图（未入库）
  archive/      一次性采集脚本与中间数据
  pg/ qm/       参考仓库克隆（未入库）
```

## 照片立面管线

`assets/facade/*.jpg`（实拍裁切）→ `npm run pack`（tools/pack-textures.mjs）
→ 生成 `src/assets/facade-data.js`（base64 内联）→ `src/core/photoTex.js` 建材质
→ `src/world/buildings.js` 的 `photoKitFor()` 按 manifest 接入（confidence high/mid 且非 flat）。

重新裁瓦片：`python tools/facade-crop.py --list`（原图在 work/real-photos/）。

## 已知问题与待办

见 [work/docs/需求清单.md](work/docs/需求清单.md)（14 条，P0~P2 分级）；
修复过程与踩坑记录见 [work/docs/polish-log.md](work/docs/polish-log.md)。

## 仓库未包含（本机保留）

`node_modules/`、`work/shots/`（230MB 截图存档）、`work/real-photos/`（58MB 原图）、
`work/pg/`、`work/qm/`（131MB 参考仓库）、`work/archive/`、`_non-project/`（误放在项目根目录的个人文件 quarantine）。
