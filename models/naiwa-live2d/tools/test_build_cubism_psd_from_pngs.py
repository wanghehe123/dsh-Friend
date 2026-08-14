#!/usr/bin/env python3

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops


TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
sys.path.insert(0, str(TOOLS_DIR))

from build_cubism_psd_from_pngs import build_cubism_psd
from reencode_psd_rle import _parse, inspect_layer_channels
from strip_empty_layer_masks import inspect_layer_masks


EXPECTED_LAYER_NAMES = [
    "01_BODY_BACK",
    "02_ARM_BACK",
    "04_EYES_NEUTRAL",
    "05_EYES_CLOSED",
    "06_MOUTH_SMILE",
    "07_MOUTH_SURPRISE",
    "03_ARM_FRONT",
]


class BuildCubismPsdFromPngsTest(unittest.TestCase):
    def test_builds_cubism_compatible_v3_psd_with_real_layer_pixels(self) -> None:
        template = ROOT / "layers" / "naiwa-live2d-source.psd"
        layers_dir = ROOT / "layers-v3"

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "naiwa-v3.psd"
            build_cubism_psd(template, layers_dir, output)

            layout = _parse(output)
            channels = inspect_layer_channels(output)
            masks = inspect_layer_masks(output)
            with Image.open(output) as psd_image:
                composite = psd_image.convert("RGBA")

        self.assertEqual((layout.layers[0].width, layout.layers[0].height), (1220, 1550))
        self.assertEqual([layer.name for layer in layout.layers], EXPECTED_LAYER_NAMES)
        self.assertTrue(all((layer.width, layer.height) == (1220, 1550) for layer in layout.layers))
        self.assertTrue(all(channel.compression == 1 for channel in channels))
        self.assertEqual([mask.length for mask in masks], [0] * 7)

        body_alpha = next(
            channel.pixels
            for channel in channels
            if channel.layer_name == "01_BODY_BACK" and channel.channel_id == -1
        )
        expected_alpha = Image.open(layers_dir / "body-back-v3.png").convert("RGBA").getchannel("A").tobytes()
        self.assertEqual(body_alpha, expected_alpha)

        expected_composite = Image.new("RGBA", (1220, 1550), (0, 0, 0, 0))
        for filename in (
            "body-back-v3.png",
            "arm-back-v3.png",
            "eyes-neutral-v3.png",
            "mouth-smile-v3.png",
            "arm-front-v3.png",
        ):
            with Image.open(layers_dir / filename) as layer_image:
                expected_composite = Image.alpha_composite(
                    expected_composite,
                    layer_image.convert("RGBA"),
                )
        self.assertIsNone(ImageChops.difference(composite, expected_composite).getbbox())


if __name__ == "__main__":
    unittest.main()
