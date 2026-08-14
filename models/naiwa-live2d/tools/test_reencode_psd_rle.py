import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "layers" / "naiwa-live2d-source.psd"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from reencode_psd_rle import inspect_layer_channels, reencode_layer_channels_to_rle


class ReencodePsdRleTest(unittest.TestCase):
    def test_reencodes_every_layer_channel_without_changing_pixels(self) -> None:
        source_channels = inspect_layer_channels(SOURCE)

        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "naiwa-rle.psd"
            reencode_layer_channels_to_rle(SOURCE, destination)
            destination_channels = inspect_layer_channels(destination)

        self.assertEqual(len(source_channels), 28)
        self.assertEqual(
            [(channel.layer_name, channel.channel_id, channel.pixels) for channel in source_channels],
            [(channel.layer_name, channel.channel_id, channel.pixels) for channel in destination_channels],
        )
        self.assertTrue(all(channel.compression == 0 for channel in source_channels))
        self.assertTrue(all(channel.compression == 1 for channel in destination_channels))


if __name__ == "__main__":
    unittest.main()
