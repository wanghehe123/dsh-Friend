#!/usr/bin/env python3

import importlib.util
import struct
import tempfile
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parent
SOURCE = TOOLS_DIR.parent / "layers" / "naiwa-live2d-cubism-clean-rle.psd"
SPEC = importlib.util.spec_from_file_location("build_grouped_psd", TOOLS_DIR / "build_grouped_psd.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def _group_channel_counts(path: Path) -> list[tuple[str, int, list[tuple[int, int]]]]:
    data = path.read_bytes()
    offset = 26
    for _ in range(2):
        length = struct.unpack_from(">I", data, offset)[0]
        offset += 4 + length
    offset += 4  # layer-and-mask length
    offset += 4  # layer-info length
    layer_count = abs(struct.unpack_from(">h", data, offset)[0])
    offset += 2

    result = []
    for _ in range(layer_count):
        offset += 16
        channel_count = struct.unpack_from(">H", data, offset)[0]
        offset += 2
        channels = []
        for _ in range(channel_count):
            channel_id, length = struct.unpack_from(">hI", data, offset)
            offset += 6
            channels.append((channel_id, length))
        offset += 12
        extra_length = struct.unpack_from(">I", data, offset)[0]
        offset += 4
        extra_end = offset + extra_length
        mask_length = struct.unpack_from(">I", data, offset)[0]
        offset += 4 + mask_length
        ranges_length = struct.unpack_from(">I", data, offset)[0]
        offset += 4 + ranges_length
        name_length = data[offset]
        name = data[offset + 1 : offset + 1 + name_length].decode("latin-1")
        offset += 1 + name_length
        offset += (-(1 + name_length)) % 4
        offset = extra_end
        if name in {"</Layer group>", "Naiwa"}:
            result.append((name, channel_count, channels))
    return result


class BuildGroupedPsdTests(unittest.TestCase):
    def test_folder_boundaries_have_rgb_and_alpha_channels_for_cubism(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "grouped.psd"
            MODULE.build(SOURCE, output, "Naiwa")

            groups = _group_channel_counts(output)

        self.assertEqual(
            groups,
            [
                ("</Layer group>", 4, [(-1, 2), (0, 2), (1, 2), (2, 2)]),
                ("Naiwa", 4, [(-1, 2), (0, 2), (1, 2), (2, 2)]),
            ],
        )


if __name__ == "__main__":
    unittest.main()
