#!/usr/bin/env python3
"""
生成 PWA 图标。

用几何图形直接画（不依赖字体）—— 这样在任何机器上重新生成的结果都一样，
不会因为缺字体而悄悄变成一个空白方块。

用法：python3 scripts/make-icons.py
输出：public/icon-192.png、public/icon-512.png、src/app/apple-icon.png
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

# 与应用主题一致：暗色背景 + 天蓝色前景
BG = (10, 10, 10, 255)
ACCENT = (56, 189, 248, 255)
ACCENT_DIM = (56, 189, 248, 90)


def draw_icon(size: int, *, maskable: bool = False) -> Image.Image:
    """
    画一个房子。

    maskable 版本会把图形缩小到安全区内 —— Android 的自适应图标会按各种
    形状裁切（圆形、方形、水滴形），超出安全区的部分会被切掉。
    """
    img = Image.new("RGBA", (size, size), BG if not maskable else ACCENT)
    d = ImageDraw.Draw(img)

    if maskable:
        # 满色背景 + 居中的深色房子，交给系统去裁
        fg = BG
        scale = 0.55  # 安全区大约 80%，图形再收一点更保险
    else:
        fg = ACCENT
        scale = 0.72

    cx, cy = size / 2, size / 2
    w = size * scale

    # 屋顶（三角形）
    roof_h = w * 0.42
    roof_top = cy - w * 0.46
    d.polygon(
        [
            (cx, roof_top),
            (cx - w * 0.58, roof_top + roof_h),
            (cx + w * 0.58, roof_top + roof_h),
        ],
        fill=fg,
    )

    # 墙体（圆角矩形）
    body_top = roof_top + roof_h - size * 0.015
    body_bottom = cy + w * 0.46
    d.rounded_rectangle(
        [cx - w * 0.40, body_top, cx + w * 0.40, body_bottom],
        radius=w * 0.07,
        fill=fg,
    )

    # 门（用背景色挖出来，形成镂空感）
    door_w = w * 0.22
    door_h = w * 0.30
    d.rounded_rectangle(
        [
            cx - door_w / 2,
            body_bottom - door_h,
            cx + door_w / 2,
            body_bottom,
        ],
        radius=door_w * 0.35,
        fill=BG if not maskable else ACCENT,
    )

    return img


def main() -> None:
    public = ROOT / "public"
    public.mkdir(exist_ok=True)

    outputs = [
        (public / "icon-192.png", 192, False),
        (public / "icon-512.png", 512, False),
        # maskable：Android 自适应图标，会被裁成各种形状
        (public / "icon-maskable-512.png", 512, True),
        # iOS 的「添加到主屏幕」图标，不透明背景
        (ROOT / "src" / "app" / "apple-icon.png", 180, False),
    ]

    for path, size, maskable in outputs:
        img = draw_icon(size, maskable=maskable)
        # iOS 不支持透明背景的主屏图标，转成 RGB
        if path.name == "apple-icon.png":
            img = img.convert("RGB")
        img.save(path, "PNG", optimize=True)
        print(f"  {path.relative_to(ROOT)}  ({size}×{size}{' maskable' if maskable else ''})")

    # favicon 用 512 缩一版就好
    print("\n图标已生成。")


if __name__ == "__main__":
    main()