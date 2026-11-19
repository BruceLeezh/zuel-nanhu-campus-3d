#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
facade-crop.py —— 从实拍照片裁出「可平铺的建筑立面瓦片」

产出
  assets/facade/<楼名>.jpg     512x512 (或 512x1024)  JPEG q85
  assets/facade/manifest.json  每栋一条（tile/kind/floorsPerTile/baysPerTile/墙色/玻璃色/线脚色/source/confidence/note）
  work/shots/facade-sheet.png  4x3 拼图自检表（带楼名）

用法
  python tools/facade-crop.py                 # 全部重跑
  python tools/facade-crop.py 中原楼           # 只重做一栋
  python tools/facade-crop.py --sheet         # 只重出拼图
  python tools/facade-crop.py --debug 中原楼   # 额外输出裁切预览（框线）到 work/shots/zoom/

设计要点
  1) 只取建筑本体：SPECS 里的 crop / quad 已避开天空、地面、树、人、车、水印。
  2) 透视矫正：quad 给四点（TL,TR,BR,BL，源图像素），用自写的 PERSPECTIVE 系数求解，
     Image.transform 把该四边形拉成矩形（rect），四点落在「墙垛中心 × 层间线中心」上。
  3) 可平铺：rect 按 (开间数 × 层数) 均分，crop 只取整数格 —— 左右边缘落在墙垛中心、
     上下边缘落在层间线（白线脚）中心，repeat 时接缝落在同材质中间，不显。
  4) 不糊化：LANCZOS 重采样 + 轻微 USM 提锐，不做高斯模糊；不做镜像拼接（会造出假对称）。
  5) 亮度统一：整体亮度归一到目标值（默认 140/255，增益夹在 0.72~1.70 之间以保住对比度）。

SPECS 字段
  src      相对 work/real-photos/ 的路径
  quad     [(x,y)*4] TL,TR,BR,BL —— 有则先做透视矫正
  rect     (w,h) 矫正后的矩形像素尺寸 = 该四边形对应的 开间数x层数 的实际跨度
  rx, ry   四边形覆盖的 开间数 / 层数（用于把 rect 均分成格）
  crop     (x0,y0,x1,y1) 在矫正后图里的裁切框（必须是整格的倍数）
  bays/floors  该裁切框覆盖的开间数 / 层数（写进 manifest）
  out      输出尺寸
  kind     bay | band | flat
  conf     high | mid | low
  note     复核用备注
  flat     True 时走合成色带（photo 不可用）
  sample   合成色的取样框（源图坐标系），给出则从照片取墙/玻璃/线脚三色
  colors   (墙, 玻璃, 线脚) 直接指定合成色，优先于 sample
  band     (y0,y1) 玻璃带在瓦片里的纵向位置（0~1），用于区分同类楼
  no_band  True 时整幅只有墙体（如东门红砂岩墙）
  target   该瓦片的亮度归一目标（默认 140；深色屋面/红砂岩可降到 100~120）

每栋都只取建筑本体：crop/quad 里已避开天空、地面、树、人、车、金字与百度水印。
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTO = os.path.join(ROOT, 'work', 'real-photos')
OUTDIR = os.path.join(ROOT, 'assets', 'facade')
SHOTS = os.path.join(ROOT, 'work', 'shots')
ZOOM = os.path.join(SHOTS, 'zoom')
JPEG_Q = 85

# 目标楼栋顺序（拼图与 manifest 都按此序）
ORDER = ['逸夫图书馆', '中原楼', '文泰楼', '文澜楼', '文波楼', '文泉楼',
         '南湖会堂', '体育中心', '南湖体育馆', '北门', '东门', '钟楼']

# ---------------------------------------------------------------------------
# 每栋的裁切参数（坐标均为「源图像素」，可在 --debug 预览图上核对后微调）
# ---------------------------------------------------------------------------
SPECS = {
    # 逸夫图书馆：正立面右翼横带窗（白窗套 + 上下白线脚），避开顶部格栅棚与前景树
    '逸夫图书馆': dict(
        src='04_逸夫图书馆_正面.png',
        crop=(818, 357, 948, 457), bays=3, floors=2,
        out=(512, 512), kind='band', conf='mid',
        note='正立面右翼横带窗：白窗套+白线脚，3 开间 2 层；原片仅 50px/层，纵向放大后偏软',
    ),
    # 中原楼：右翼四点透视矫正（四角落在墙垛中心 × 白线脚中心），取 3 开间 × 3 层
    '中原楼': dict(
        src='01_中原楼_正面.png',
        quad=[(1015, 481), (1268, 438), (1276, 719), (1035, 760)],
        rect=(252, 280), rx=3, ry=4,
        crop=(0, 0, 252, 210), bays=3, floors=3,
        out=(512, 512), kind='bay', conf='high',
        note='白色竖鳍 + 蓝灰玻璃 + 白色横向百叶装饰带；取右翼避开中央玻璃鼓与旗杆',
    ),
    # 文泰楼：唯一可用照片是塔楼转角近景（「文泰楼」金字 + 树），只取无字石材墙
    '文泰楼': dict(
        src='search/文泰楼/02.jpg', flat=True,
        colors=('#cdc8bf', '#4d5f69', '#e9e3d7'),
        out=(512, 512), kind='flat', conf='low',
        note='照片只有塔楼转角近景（含「文泰楼」金字与树），无可用窗带；墙/玻璃色取自该石材墙面',
    ),
    # 文澜楼：search/文澜楼/ 为空，无任何照片
    '文澜楼': dict(
        src=None, flat=True,
        colors=('#c6bfae', '#3d5460', '#eae4d6'), band=(0.30, 0.66),
        out=(512, 512), kind='flat', conf='low',
        note='无照片（search/文澜楼/ 为空）；按同校区板楼色系合成两条色带，缺口待补拍',
    ),
    # 文波楼：楼体只在钟楼照片下方露出一条（约 280x52 px），取横带窗最干净的一段
    '文波楼': dict(
        src='search/文波楼/02.jpg', flat=True,
        colors=('#c4c9c8', '#3e4d53', '#e3e3df'),
        out=(512, 512), kind='flat', conf='low',
        note='4 张全是百米外街景，楼体仅约 190x38px 且窗带被树挡；取色合成（白线脚+深色横带窗）',
    ),
    # 文泉楼：入口近景有红横幅/金字/虚焦，航拍仅 720x360
    '文泉楼': dict(
        src=None, flat=True,
        sample=('search/文泉楼/04.jpg', (690, 380, 780, 520)),
        out=(512, 512), kind='flat', conf='low',
        note='入口近景有横幅/金字/虚焦，航拍仅 720x360；按侧墙石材取色合成色带',
    ),
    # 南湖会堂：正立面石材墙垛（竖向百叶通风槽 + 石材分缝）+ 一点玻璃幕墙
    '南湖会堂': dict(
        src='search/南湖会堂/01.jpg',
        crop=(845, 252, 985, 482), bays=1, floors=1,
        out=(512, 512), kind='bay', conf='high',
        note='浅灰花岗岩墙垛 + 竖向百叶通风槽 + 石材分缝（取右墙垛，已避开转角/路灯/花池）',
    ),
    # 体育中心：正立面上部两层横带窗（白色窗套 + 灰白墙板）
    '体育中心': dict(
        src='search/体育中心/03.jpg',
        crop=(110, 52, 410, 172), bays=7, floors=2,
        out=(512, 512), kind='band', conf='mid',
        note='两层横带窗 + 白色窗套；已避开金色字与前景围栏/水印',
    ),
    # 南湖体育馆：相册实为「文治楼」与 100px 缩略图，非本楼
    '南湖体育馆': dict(
        src=None, flat=True,
        sample=('search/南湖体育馆/03.jpg', (760, 520, 1200, 660)),
        out=(512, 512), kind='flat', conf='low',
        note='相册实为「文治楼」及 100px 缩略图，非本楼；按该片建筑取色（筒拱馆体待补拍）',
    ),
    # 北门：相册是钟楼远景 + 夜市，无门体
    '北门': dict(
        src='search/北门/01.jpg', flat=True,
        colors=('#c6c3bd', '#5a6a66', '#dedbd4'),
        out=(512, 512), kind='flat', conf='low',
        note='相册为钟楼远景+夜市（与南门/西门/北1门 共用一组图），无门体；取色于塔楼石材/深绿百叶',
    ),
    # 东门：红砂岩校名墙（金字占满墙面，只取字上方无字段做镜像平铺）
    '东门': dict(
        src='search/东门/01.jpg', flat=True,
        colors=('#8e5457', '#4a3f3e', '#bcb2a8'), no_band=True, target=104,
        out=(512, 512), kind='flat', conf='mid',
        note='红砂岩校名墙取色（墙面被金字+花坛占满、无干净纹理块）；门体本身无照片',
    ),
    # 钟楼：只在 文波楼/北门 相册里以远景出现（塔身约 55x50px）
    '钟楼': dict(
        src='search/北门/02.jpg', flat=True,
        colors=('#cfccc4', '#4f6259', '#e4e1da'),
        out=(512, 512), kind='flat', conf='low',
        note='塔身仅约 50x90px 远景（文波楼/北门 相册）；取色于石材与深绿百叶，钟面另行建模',
    ),
}

# 亮度归一目标（0-255 的 L 均值）
TARGET_L = 140.0
GAIN_CLAMP = (0.72, 1.70)


# ---------------------------------------------------------------------------
# 透视矫正
# ---------------------------------------------------------------------------
def _persp_coeffs(dst_pts, src_pts):
    """求 Image.transform(PERSPECTIVE) 的 8 个系数：输出坐标→输入坐标。"""
    A, b = [], []
    for (x, y), (u, v) in zip(dst_pts, src_pts):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.asarray(A, float), np.asarray(b, float))


def rectify(im, quad, rect):
    """quad=TL,TR,BR,BL（源图坐标）→ 矩形 rect=(w,h)"""
    w, h = rect
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = _persp_coeffs(dst, quad)
    return im.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)


# ---------------------------------------------------------------------------
# 色彩工具
# ---------------------------------------------------------------------------
def _hex(rgb):
    return '#%02x%02x%02x' % tuple(int(round(max(0, min(255, c)))) for c in rgb)


def palette(im):
    """把立面切成 3 组亮度簇：暗=玻璃，中=墙，亮=线脚。返 [(hex, share)]"""
    a = np.asarray(im.convert('RGB').resize((96, 96), Image.BILINEAR)).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    qs = np.percentile(lum, [20, 65, 90])
    groups = [np.abs(lum - q) <= 16 for q in qs]
    out = {}
    for key, m in zip(('glass', 'wall', 'trim'), groups):
        if m.sum() < 40:
            m = np.ones_like(lum, bool)
        px = a[m]
        out[key] = (_hex(px.mean(axis=0)), float(m.mean()))
    return out


def _lift_trim(wall, trim, min_gap=16):
    """线脚色若与主墙色太接近（低反差照片常见），向白提亮，保证 manifest 里三色可区分。"""
    w = np.array([int(wall[i:i + 2], 16) for i in (1, 3, 5)], float)
    t = np.array([int(trim[i:i + 2], 16) for i in (1, 3, 5)], float)
    if abs(float(t @ np.array([.299, .587, .114])) - float(w @ np.array([.299, .587, .114]))) >= min_gap:
        return trim
    return _hex(t * 0.35 + w * 0.30 + 255 * 0.35)


def normalize_luma(im, target=TARGET_L, clamp=GAIN_CLAMP):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    mean = float(lum.mean()) or 1.0
    gain = max(clamp[0], min(clamp[1], target / mean))
    if abs(gain - 1.0) < 0.03:
        return im
    out = a * gain
    # 保住高光：软压缩 235~255 区间，避免白线脚糊成一片死白
    hi = out > 232
    out[hi] = 232 + (out[hi] - 232) * 0.45
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def sharpen(im, radius=1.15, percent=62, threshold=2):
    return im.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=threshold))


# ---------------------------------------------------------------------------
# 合成 flat 瓦片：主墙色 + 一条玻璃色横带（+ 细线脚）
# ---------------------------------------------------------------------------
def make_flat(wall, glass, trim, out, seed=7, band=(0.36, 0.70), no_band=False):
    w, h = out
    rng = np.random.default_rng(seed)
    img = Image.new('RGB', (w, h), tuple(int(wall[i:i + 2], 16) for i in (1, 3, 5)))
    d = ImageDraw.Draw(img)
    g0, g1 = int(h * band[0]), int(h * band[1])
    tc = tuple(int(trim[i:i + 2], 16) for i in (1, 3, 5))
    if not no_band:
        # 一条横向玻璃带 + 上下各一条细线脚
        d.rectangle([0, g0, w, g1], fill=tuple(int(glass[i:i + 2], 16) for i in (1, 3, 5)))
        d.rectangle([0, g0 - max(2, h // 96), w, g0], fill=tc)
        d.rectangle([0, g1, w, g1 + max(2, h // 96)], fill=tc)
    # 玻璃带内的竖向窗挺（只在玻璃里，很淡）
    a = np.asarray(img).astype(np.float32)
    mw = max(40, w // 7)
    for x in range(mw, w, mw) if not no_band else ():
        a[g0 + 2:g1 - 1, x:x + max(2, w // 128)] *= 0.88
    # 石材/砌体横缝（贯穿整幅，3% 反差）
    for y in range(0, h, max(48, h // 8)):
        a[y:y + max(1, h // 340), :] *= 0.955
        a[y + max(1, h // 340):y + max(2, h // 170), :] *= 1.012
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    # 细颗粒，避免 JPEG 大面积色带
    n = rng.normal(0, 2.4, (h, w, 1)).repeat(3, axis=2)
    img = Image.fromarray(np.clip(np.asarray(img).astype(np.float32) + n, 0, 255).astype(np.uint8))
    return img


# ---------------------------------------------------------------------------
# 单栋处理
# ---------------------------------------------------------------------------
def process(name, spec, debug=False):
    os.makedirs(OUTDIR, exist_ok=True)
    out_size = tuple(spec.get('out', (512, 512)))
    src = spec.get('src')

    if spec.get('flat') or not src:
        # --- 合成色带 ---
        wall, glass, trim = '#cfc9ba', '#4f6470', '#e8e2d4'
        if spec.get('colors'):
            wall, glass, trim = spec['colors']
        elif spec.get('sample'):
            spath, sbox = spec['sample']
            full = os.path.join(PHOTO, spath)
            if os.path.exists(full):
                sm = Image.open(full).convert('RGB').crop(sbox)
                p = palette(sm)
                wall = p['wall'][0]
                glass = p['glass'][0]
                trim = p['trim'][0]
        tile = make_flat(wall, glass, trim, out_size, seed=abs(hash(name)) % 9973,
                         band=spec.get('band', (0.36, 0.70)), no_band=spec.get('no_band', False))
        tile = normalize_luma(tile, spec.get('target', TARGET_L))   # 合成瓦片也统一到同一亮度中位数
        src_field = (spec.get('sample', [None])[0] if spec.get('sample') else '') or spec.get('src') or ''
    else:
        full = os.path.join(PHOTO, src)
        if not os.path.exists(full):
            raise FileNotFoundError(full)
        im = Image.open(full).convert('RGB')
        quad = spec.get('quad')
        if quad:
            im = rectify(im, quad, spec['rect'])
        box = spec['crop']
        box = (max(0, box[0]), max(0, box[1]), min(im.width, box[2]), min(im.height, box[3]))
        im = im.crop(box)
        if debug:
            _debug_preview(name, im)
        tile = im.resize(out_size, Image.LANCZOS)
        tile = sharpen(tile)
        tile = normalize_luma(tile)
        tile = sharpen(tile, 1.0, 40, 3)
        p = palette(tile)
        wall, glass, trim = p['wall'][0], p['glass'][0], p['trim'][0]
        src_field = spec['src']
        trim = _lift_trim(wall, trim)

    trim = _lift_trim(wall, trim)        # 统一在写盘前兜底（低反差照片里线脚常与墙同色）
    path = os.path.join(OUTDIR, name + '.jpg')
    tile.convert('RGB').save(path, 'JPEG', quality=JPEG_Q, subsampling=1, optimize=True)
    size = os.path.getsize(path)

    entry = {
        'tile': name + '.jpg',
        'kind': spec.get('kind', 'bay'),
        'floorsPerTile': int(spec.get('floors', 1)),
        'baysPerTile': int(spec.get('bays', 1)),
        'wallColor': wall,
        'glassColor': glass,
        'trimColor': trim,
        'source': ('real-photos/' + src_field) if src_field else '',
        'confidence': spec.get('conf', 'mid'),
        'note': spec.get('note', ''),
    }
    print(f'  ✓ {name:8s} {size/1024:6.1f} KB  {tile.size[0]}x{tile.size[1]}  '
          f'{entry["kind"]:4s} {entry["baysPerTile"]}x{entry["floorsPerTile"]}  '
          f'wall {wall} glass {glass}  [{entry["confidence"]}]')
    return entry, tile


def _debug_preview(name, im):
    os.makedirs(ZOOM, exist_ok=True)
    p = os.path.join(ZOOM, f'crop_{name}.png')
    prev = im.copy()                      # 只画在副本上，不能污染正式输出
    d = ImageDraw.Draw(prev)
    d.rectangle([0, 0, prev.width - 1, prev.height - 1], outline=(255, 0, 0), width=2)
    prev.save(p)


# ---------------------------------------------------------------------------
# 自检拼图
# ---------------------------------------------------------------------------
def _font(sz):
    for f in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf',
              r'C:\Windows\Fonts\msyhbd.ttc', '/System/Library/Fonts/PingFang.ttc'):
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def sheet(names, tiles, path):
    cols, rows = 4, 3
    cell, pad, cap = 300, 14, 34
    W = cols * cell + pad * (cols + 1)
    H = rows * (cell + cap) + pad * (rows + 1)
    out = Image.new('RGB', (W, H), (26, 28, 32))
    d = ImageDraw.Draw(out)
    f = _font(22)
    for i, n in enumerate(names):
        if n not in tiles:
            continue
        r, c = divmod(i, cols)
        x = pad + c * (cell + pad)
        y = pad + r * (cell + cap + pad)
        t = tiles[n].resize((cell, cell), Image.LANCZOS)
        out.paste(t, (x, y))
        d.rectangle([x, y, x + cell - 1, y + cell - 1], outline=(80, 86, 96))
        d.text((x + 4, y + cell + 6), n, font=f, fill=(226, 230, 236))
    out.save(path)
    print('  ✓', path, out.size)
    return out


# ---------------------------------------------------------------------------
def main():
    args = [a for a in sys.argv[1:]]
    only = [a for a in args if not a.startswith('--')]
    debug = '--debug' in args

    if '--sheet' in args:
        names, tiles = [], {}
        for n in ORDER:
            p = os.path.join(OUTDIR, n + '.jpg')
            if os.path.exists(p):
                names.append(n)
                tiles[n] = Image.open(p).convert('RGB')
        sheet(names, tiles, os.path.join(SHOTS, 'facade-sheet.png'))
        return

    os.makedirs(OUTDIR, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    man_path = os.path.join(OUTDIR, 'manifest.json')
    manifest = {}
    if os.path.exists(man_path) and only:
        try:
            manifest = json.load(open(man_path, encoding='utf-8'))
        except Exception:
            manifest = {}

    targets = only or ORDER
    tiles = {}
    print(f'裁切 {len(targets)} 栋 → assets/facade/')
    for n in targets:
        if n not in SPECS:
            print('  ! 未定义 SPECS:', n)
            continue
        entry, tile = process(n, SPECS[n], debug=debug)
        manifest[n] = entry
        tiles[n] = tile

    # 保持 ORDER 顺序写盘
    ordered = {k: manifest[k] for k in ORDER if k in manifest}
    ordered.update({k: v for k, v in manifest.items() if k not in ordered})
    with open(man_path, 'w', encoding='utf-8') as fh:
        json.dump(ordered, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('  ✓', man_path, f'{len(ordered)} 条')

    # 拼图（总是用磁盘上的全部瓦片重出，保证 12 格完整）
    names, alltiles = [], {}
    for n in ORDER:
        p = os.path.join(OUTDIR, n + '.jpg')
        if os.path.exists(p):
            names.append(n)
            alltiles[n] = Image.open(p).convert('RGB')
    sheet(names, alltiles, os.path.join(SHOTS, 'facade-sheet.png'))


if __name__ == '__main__':
    main()
