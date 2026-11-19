#!/usr/bin/env bash
# 用法： bash tools/shot.sh <名字> ["查询串"]
# 例：  bash tools/shot.sh gate "?cam=405,-460&yaw=0.1&pitch=0.12&dist=10"
set -e
cd "$(dirname "$0")/.."
NAME="${1:-shot}"
QUERY="${2:-}"
node build/build.mjs >/dev/null
cp "dist/中南财经政法大学南湖校区-3D校园.html" dist/preview.html
mkdir -p work/shots
OUT="$(pwd)/work/shots/${NAME}.png"
EDGE="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$EDGE" --headless=new --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist \
  --disable-gpu-sandbox --enable-zero-copy --screenshot="C:\\Users\\lenovo\\Desktop\\抖音校园\\work\\shots\\${NAME}.png" \
  --window-size=1600,900 --virtual-time-budget=1500 --hide-scrollbars \
  "file:///C:/Users/lenovo/Desktop/%E6%8A%96%E9%9F%B3%E6%A0%A1%E5%9B%AD/dist/preview.html${QUERY}" 2>/dev/null | tail -1
echo "SHOT: $OUT"
