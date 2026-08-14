import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "layers" / "naiwa-live2d-source.psd"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from reencode_psd_rle import inspect_layer_channels
from strip_empty_layer_masks import inspect_layer_masks, strip_empty_layer_masks


class StripEmptyLayerMasksTest(unittest.TestCase):
    def test_removes_zero_filled_masks_without_changing_layer_pixels(self) -> None:
        source_channels = inspect_layer_channels(SOURCE)
        source_masks = inspect_layer_masks(SOURCE)

        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "naiwa-no-masks.psd"
            removed = strip_empty_layer_masks(SOURCE, destination)
            destination_channels = inspect_layer_channels(destination)
            destination_masks = inspect_layer_masks(destination)

        self.assertEqual(removed, 7)
        self.assertEqual([mask.length for mask in source_masks], [36] * 7)
        self.assertTrue(all(set(mask.data) == {0} for mask in source_masks))
        self.assertEqual([mask.length for mask in destination_masks], [0] * 7)
        self.assertEqual(
            [(channel.layer_name, channel.channel_id, channel.pixels) for channel in source_channels],
            [(channel.layer_name, channel.channel_id, channel.pixels) for channel in destination_channels],
        )

    def test_refuses_to_strip_nonempty_mask_data(self) -> None:
        data = bytearray(SOURCE.read_bytes())
        first_mask_data_offset = _first_mask_data_offset(data)
        data[first_mask_data_offset] = 1

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "nonempty-mask.psd"
            destination = Path(temp_dir) / "output.psd"
            source.write_bytes(data)

            with self.assertRaisesRegex(ValueError, "non-empty layer mask"):
                strip_empty_layer_masks(source, destination)


def _first_mask_data_offset(data: bytes) -> int:
    offset = 26
    offset += 4 + struct.unpack_from(">I", data, offset)[0]
    offset += 4 + struct.unpack_from(">I", data, offset)[0]
    layer_mask_start = offset + 4
    layer_info_start = layer_mask_start + 4
    records_offset = layer_info_start + 2
    offset = records_offset + 16
    channel_count = struct.unpack_from(">H", data, offset)[0]
    offset += 2 + channel_count * 6 + 12
    offset += 4
    return offset + 4


if __name__ == "__main__":
    unittest.main()
