# -*- coding: utf-8 -*-
"""
生成 DSA Mobile 的 PWA 图标与 Android 启动图标。

不依赖 Pillow：内置一个极简 RGBA 画布 + PNG 编码器。
输出：
  app/icons/icon-192.png
  app/icons/icon-512.png
  app/icons/icon-maskable-512.png
  app/icons/apple-touch-icon.png
  android/app/src/main/res/drawable/ic_launcher_foreground.png
  android/app/src/main/res/drawable/ic_launcher.png
"""
import os
import zlib
import struct
import math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP_ICONS = os.path.join(ROOT, 'app', 'icons')
ANDROID_RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
ANDROID_DRAWABLE = os.path.join(ANDROID_RES, 'drawable')


# ---------------- PNG 编码 ----------------
def write_png(path, w, h, buf):
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += bytes(buf[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


# ---------------- 画布 ----------------
class Canvas(object):
    def __init__(self, size):
        self.w = size
        self.h = size
        self.buf = bytearray(size * size * 4)

    def blend(self, x, y, color, alpha=1.0):
        if x < 0 or y < 0 or x >= self.w or y >= self.h or alpha <= 0:
            return
        if alpha > 1:
            alpha = 1.0
        r, g, b, a = color
        a = a * alpha
        if a <= 0:
            return
        i = (y * self.w + x) * 4
        if a >= 1:
            self.buf[i] = r
            self.buf[i + 1] = g
            self.buf[i + 2] = b
            self.buf[i + 3] = 255
            return
        dr, dg, db, da = self.buf[i], self.buf[i + 1], self.buf[i + 2], self.buf[i + 3]
        out_a = a + da * (1 - a)
        if out_a <= 0:
            return
        self.buf[i] = clamp8(int((r * a + dr * da * (1 - a)) / out_a))
        self.buf[i + 1] = clamp8(int((g * a + dg * da * (1 - a)) / out_a))
        self.buf[i + 2] = clamp8(int((b * a + db * da * (1 - a)) / out_a))
        self.buf[i + 3] = clamp8(int(out_a * 255 + 0.5))

    def fill(self, color, alpha=1.0):
        for y in range(self.h):
            for x in range(self.w):
                self.blend(x, y, color, alpha)

    def gradient_rounded(self, radius_ratio, top, bottom):
        """渐变圆角背景"""
        r = int(self.w * radius_ratio)
        for y in range(self.h):
            t = y / float(max(1, self.h - 1))
            col = (
                int(top[0] + (bottom[0] - top[0]) * t),
                int(top[1] + (bottom[1] - top[1]) * t),
                int(top[2] + (bottom[2] - top[2]) * t),
                255,
            )
            # 该行的圆角水平起点/终点
            for x in range(self.w):
                # 判断是否在圆角外
                cx = cy = 0
                inside = True
                if x < r and y < r:
                    cx, cy = r, r
                elif x > self.w - r - 1 and y < r:
                    cx, cy = self.w - r - 1, r
                elif x < r and y > self.h - r - 1:
                    cx, cy = r, self.h - r - 1
                elif x > self.w - r - 1 and y > self.h - r - 1:
                    cx, cy = self.w - r - 1, self.h - r - 1
                if cx or cy:
                    d = math.hypot(x - cx, y - cy)
                    if d > r:
                        inside = False
                    elif d > r - 1.2:
                        self.blend(x, y, col, (r - d) / 1.2)
                        continue
                if inside:
                    self.blend(x, y, col)

    def rounded_rect(self, x0, y0, x1, y1, radius, color, alpha=1.0):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                cx = min(max(x, x0 + radius), x1 - radius)
                cy = min(max(y, y0 + radius), y1 - radius)
                d = math.hypot(x - cx, y - cy)
                edge = 0
                if x < x0 + radius or x > x1 - radius:
                    pass
                if d <= radius - 0.5:
                    self.blend(x, y, color, alpha)
                elif d <= radius + 0.5:
                    self.blend(x, y, color, alpha * (radius + 0.5 - d))

    def rect(self, x0, y0, x1, y1, color, alpha=1.0):
        for y in range(int(round(y0)), int(round(y1)) + 1):
            for x in range(int(round(x0)), int(round(x1)) + 1):
                self.blend(x, y, color, alpha)

    def circle(self, cx, cy, radius, color, alpha=1.0):
        for y in range(int(cy - radius - 1), int(cy + radius + 2)):
            for x in range(int(cx - radius - 1), int(cx + radius + 2)):
                d = math.hypot(x - cx, y - cy)
                if d <= radius - 0.5:
                    self.blend(x, y, color, alpha)
                elif d <= radius + 0.5:
                    self.blend(x, y, color, alpha * (radius + 0.5 - d))

    def line(self, p0, p1, width, color, alpha=1.0):
        x0, y0 = p0
        x1, y1 = p1
        half = width / 2.0
        for y in range(int(min(y0, y1) - width - 1), int(max(y0, y1) + width + 2)):
            for x in range(int(min(x0, x1) - width - 1), int(max(x0, x1) + width + 2)):
                d = point_segment_distance(x, y, x0, y0, x1, y1)
                if d <= half - 0.5:
                    self.blend(x, y, color, alpha)
                elif d <= half + 0.5:
                    self.blend(x, y, color, alpha * (half + 0.5 - d))


def clamp8(v):
    return 0 if v < 0 else (255 if v > 255 else v)


def point_segment_distance(px, py, x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    if dx == 0 and dy == 0:
        return math.hypot(px - x0, py - y0)
    t = ((px - x0) * dx + (py - y0) * dy) / float(dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


WHITE = (255, 255, 255, 255)
RED = (255, 92, 92, 255)
GREEN = (57, 217, 138, 255)


def draw_mark(size, maskable=False):
    """在正方形画布上绘制图标内容"""
    c = Canvas(size)
    top = (30, 58, 138, 255)      # #1e3a8a
    bottom = (37, 99, 235, 255)   # #2563eb
    c.gradient_rounded(0.22 if not maskable else 0.0, top, bottom)
    if maskable:
        c.fill(top, 1.0)
        c.gradient_rounded(0.0, top, bottom)

    # 内容缩放：maskable 需要留出安全区，内容占 66%
    scale = 0.60 if maskable else 0.62
    pad = size * (1 - scale) / 2.0
    W = size - pad * 2

    # 底部三根柱：高度递增
    base_y = pad + W * 0.86
    bar_w = W * 0.115
    heights = [W * 0.26, W * 0.40, W * 0.56]
    xs = [pad + W * 0.20, pad + W * 0.44, pad + W * 0.68]
    for i, h in enumerate(heights):
        color = (255, 255, 255, 255)
        alpha = 0.45 if i < 2 else 0.9
        c.rounded_rect(xs[i], base_y - h, xs[i] + bar_w, base_y, bar_w * 0.22, color, alpha)

    # 上升折线
    lw = W * 0.062
    pts = [
        (pad + W * 0.10, pad + W * 0.66),
        (pad + W * 0.38, pad + W * 0.52),
        (pad + W * 0.62, pad + W * 0.34),
        (pad + W * 0.90, pad + W * 0.14),
    ]
    for i in range(len(pts) - 1):
        c.line(pts[i], pts[i + 1], lw, WHITE, 1.0)

    # 顶点强调圆
    c.circle(pts[-1][0] + W * 0.015, pts[-1][1], W * 0.075, RED, 1.0)
    c.circle(pts[-1][0] + W * 0.015, pts[-1][1], W * 0.032, WHITE, 1.0)
    return c


def main():
    targets = []
    for size in (192, 512):
        targets.append((size, os.path.join(APP_ICONS, 'icon-%d.png' % size), False))
    targets.append((512, os.path.join(APP_ICONS, 'icon-maskable-512.png'), True))
    targets.append((180, os.path.join(APP_ICONS, 'apple-touch-icon.png'), False))

    for size, path, maskable in targets:
        c = draw_mark(size, maskable)
        write_png(path, size, size, c.buf)
        print('生成', path)

    # Android legacy icon（API<26 无 adaptive-icon 时使用，放 mipmap-nodpi）
    src = os.path.join(APP_ICONS, 'icon-512.png')
    with open(src, 'rb') as f:
        data = f.read()
    nodpi = os.path.join(ANDROID_RES, 'mipmap-nodpi')
    os.makedirs(nodpi, exist_ok=True)
    os.makedirs(ANDROID_DRAWABLE, exist_ok=True)
    for name in ('ic_launcher.png', 'ic_launcher_round.png'):
        dst = os.path.join(nodpi, name)
        with open(dst, 'wb') as f:
            f.write(data)
        print('生成', dst)

    # Android adaptive foreground: 432x432，内容居中占 66%
    fg = 432
    canvas = Canvas(fg)
    inner = int(fg * 0.66)
    offset = (fg - inner) // 2
    sub = draw_mark(inner, False)
    for y in range(inner):
        for x in range(inner):
            i = (y * inner + x) * 4
            canvas.blend(x + offset, y + offset, tuple(sub.buf[i:i + 4]))
    dst = os.path.join(ANDROID_DRAWABLE, 'ic_launcher_foreground.png')
    write_png(dst, fg, fg, canvas.buf)
    print('生成', dst)


if __name__ == '__main__':
    main()
