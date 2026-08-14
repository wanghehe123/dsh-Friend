#!/usr/bin/env python3
"""Generate placeholder tray / bundle icons. No Live2D assets."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "icons"


def png(size: int) -> bytes:
    def pixel(x: int, y: int) -> tuple[int, int, int, int]:
        cx = cy = (size - 1) / 2
        dx = x - cx
        dy = y - cy
        r = (dx * dx + dy * dy) ** 0.5
        rad = size * 0.42
        if r > rad:
            return (0, 0, 0, 0)
        t = r / rad
        red = int(56 + (14 - 56) * t)
        green = int(189 + (165 - 189) * t)
        blue = int(248 + (233 - 248) * t)
        # simple smile
        if size >= 32:
            eye_y = cy - rad * 0.18
            eye_dx = rad * 0.22
            if abs(dy - (eye_y - cy)) < max(1.2, size * 0.03) and (
                abs(dx - eye_dx) < max(1.2, size * 0.03)
                or abs(dx + eye_dx) < max(1.2, size * 0.03)
            ):
                return (15, 23, 42, 255)
            smile_y = cy + rad * 0.18
            if abs(r - rad * 0.55) < max(1.0, size * 0.03) and dy > smile_y - rad * 0.2 and abs(dx) < rad * 0.35:
                return (15, 23, 42, 255)
        return (red, green, blue, 255)

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )


def write_icns(path: Path, images: dict[bytes, bytes]) -> None:
    chunks = b"".join(tag + struct.pack(">I", 8 + len(data)) + data for tag, data in images.items())
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(chunks)) + chunks)


def write_ico(path: Path, images: list[tuple[int, bytes]]) -> None:
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    payloads = b""
    for size, data in images:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        payloads += data
        offset += len(data)
    path.write_bytes(header + entries + payloads)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon_16.png": 16,
        "icon_32.png": 32,
        "icon_64.png": 64,
        "icon_128.png": 128,
        "icon_256.png": 256,
        "icon_512.png": 512,
        "icon_1024.png": 1024,
    }
    blobs = {name: png(size) for name, size in sizes.items()}
    for name, data in blobs.items():
        (ROOT / name).write_bytes(data)
    write_ico(
        ROOT / "icon.ico",
        [
            (32, blobs["32x32.png"]),
            (128, blobs["icon_128.png"]),
            (256, blobs["128x128@2x.png"]),
        ],
    )
    write_icns(
        ROOT / "icon.icns",
        {
            b"icp4": blobs["icon_16.png"],
            b"icp5": blobs["icon_32.png"],
            b"icp6": blobs["icon_64.png"],
            b"ic07": blobs["icon_128.png"],
            b"ic08": blobs["icon_256.png"],
            b"ic09": blobs["icon_512.png"],
            b"ic10": blobs["icon_1024.png"],
            b"ic11": blobs["icon_32.png"],
            b"ic12": blobs["icon_64.png"],
            b"ic13": blobs["icon_256.png"],
            b"ic14": blobs["icon_512.png"],
        },
    )
    for extra in (
        "icon_16.png",
        "icon_32.png",
        "icon_64.png",
        "icon_128.png",
        "icon_256.png",
        "icon_512.png",
        "icon_1024.png",
    ):
        (ROOT / extra).unlink(missing_ok=True)
    print(f"wrote PNG/ICO/ICNS under {ROOT}")


if __name__ == "__main__":
    main()
