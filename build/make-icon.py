"""Generates build/icon.png (256x256): teal rounded square with three white bars.
Pure standard library so it runs anywhere: python build/make-icon.py
"""
import os
import struct
import zlib

SIZE = 256
SS = 4  # supersampling for smooth edges
TEAL = (20, 160, 168)
WHITE = (255, 255, 255)
RADIUS = 56
BARS = [(64, 144), (112, 80), (160, 112)]  # (x, top) on a 256 grid; bars are 32 wide, end at y=208
BAR_W, BAR_BOTTOM, BAR_R = 32, 208, 10


def in_round_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def sample(x, y):
    if not in_round_rect(x, y, 8, 8, 248, 248, RADIUS):
        return None
    for bx, top in BARS:
        if in_round_rect(x, y, bx, top, bx + BAR_W, BAR_BOTTOM, BAR_R):
            return WHITE
    return TEAL


rows = []
for py in range(SIZE):
    row = bytearray([0])  # filter: none
    for px in range(SIZE):
        acc = [0, 0, 0, 0]
        for sy in range(SS):
            for sx in range(SS):
                c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
                if c:
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
        n = SS * SS
        a = acc[3] // n
        if a:
            k = acc[3] // 255
            row += bytes([acc[0] // k, acc[1] // k, acc[2] // k, a])
        else:
            row += b"\0\0\0\0"
    rows.append(bytes(row))


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")
with open(out, "wb") as f:
    f.write(png)
print("wrote", out)
