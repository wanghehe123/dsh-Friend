#!/usr/bin/env python3
"""Build a Cubism-friendly layered PSD from full-canvas RGBA PNG files.

Photopea's PSD writer emits layer metadata that Cubism 5.3 cannot always
parse.  This builder keeps the layer-record dialect of the known-good Naiwa
PSD, replaces the canvas geometry and channel payloads, removes empty masks,
and writes PackBits-compressed layer channels.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

from PIL import Image

from reencode_psd_rle import _encode_rle, _parse as parse_channel_layout
from strip_empty_layer_masks import _parse as parse_record_layout, _strip_record


LAYER_FILES = {
    "01_BODY_BACK": "body-back-v3.png",
    "02_ARM_BACK": "arm-back-v3.png",
    "03_ARM_FRONT": "arm-front-v3.png",
    "04_EYES_NEUTRAL": "eyes-neutral-v3.png",
    "05_EYES_CLOSED": "eyes-closed-v3.png",
    "06_MOUTH_SMILE": "mouth-smile-v3.png",
    "07_MOUTH_SURPRISE": "mouth-surprise-v3.png",
}

HIDDEN_BY_DEFAULT = {"05_EYES_CLOSED", "07_MOUTH_SURPRISE"}
# Cubism reverses the PSD record sequence when it creates its object list.
# Store records back-to-front so equal initial draw-order values still render
# the front arm, expressions, back arm, and body in the intended order.
PSD_RECORD_ORDER = (
    "01_BODY_BACK",
    "02_ARM_BACK",
    "04_EYES_NEUTRAL",
    "05_EYES_CLOSED",
    "06_MOUTH_SMILE",
    "07_MOUTH_SURPRISE",
    "03_ARM_FRONT",
)
DEFAULT_STACK_BACK_TO_FRONT = (
    "01_BODY_BACK",
    "02_ARM_BACK",
    "04_EYES_NEUTRAL",
    "06_MOUTH_SMILE",
    "03_ARM_FRONT",
)
CHANNEL_TO_BAND = {-1: "A", 0: "R", 1: "G", 2: "B"}


def _load_images(layers_dir: Path) -> tuple[dict[str, Image.Image], tuple[int, int]]:
    images = {
        name: Image.open(layers_dir / filename).convert("RGBA")
        for name, filename in LAYER_FILES.items()
    }
    sizes = {image.size for image in images.values()}
    if len(sizes) != 1:
        raise ValueError(f"All source layers must use one canvas size; found {sorted(sizes)}")
    return images, sizes.pop()


def _encode_layer_channels(image: Image.Image, channel_ids: list[int]) -> dict[int, bytes]:
    width, height = image.size
    encoded: dict[int, bytes] = {}
    for channel_id in channel_ids:
        try:
            pixels = image.getchannel(CHANNEL_TO_BAND[channel_id]).tobytes()
        except KeyError as error:
            raise ValueError(f"Unsupported PSD layer channel {channel_id}") from error
        encoded[channel_id] = struct.pack(">H", 1) + _encode_rle(pixels, width, height)
    return encoded


def _patch_record(
    record: bytes,
    mask,
    *,
    width: int,
    height: int,
    encoded_channels: dict[int, bytes],
    hidden: bool,
) -> bytes:
    clean = bytearray(_strip_record(record, mask))
    struct.pack_into(">4i", clean, 0, 0, 0, height, width)

    channel_count = struct.unpack_from(">H", clean, 16)[0]
    offset = 18
    for _ in range(channel_count):
        channel_id = struct.unpack_from(">h", clean, offset)[0]
        struct.pack_into(">I", clean, offset + 2, len(encoded_channels[channel_id]))
        offset += 6

    blend_start = offset
    clean[blend_start + 4 : blend_start + 8] = b"norm"
    flags_offset = blend_start + 10
    if hidden:
        clean[flags_offset] |= 0x02
    else:
        clean[flags_offset] &= ~0x02
    return bytes(clean)


def _flatten_default(images: dict[str, Image.Image], size: tuple[int, int]) -> Image.Image:
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    for layer_name in DEFAULT_STACK_BACK_TO_FRONT:
        result = Image.alpha_composite(result, images[layer_name])
    return result


def build_cubism_psd(template: Path, layers_dir: Path, destination: Path) -> None:
    channel_layout = parse_channel_layout(template)
    record_layout = parse_record_layout(template)
    images, (width, height) = _load_images(layers_dir)

    template_names = [layer.name for layer in channel_layout.layers]
    if set(template_names) != set(LAYER_FILES):
        raise ValueError(f"Template layers do not match expected Naiwa layers: {template_names}")

    template_items = {
        layer.name: (layer, record, mask)
        for layer, record, mask in zip(
            channel_layout.layers,
            record_layout.records,
            record_layout.masks,
            strict=True,
        )
    }

    records: list[bytes] = []
    channel_payloads = bytearray()
    for layer_name in PSD_RECORD_ORDER:
        layer, record, mask = template_items[layer_name]
        channel_ids = [channel.channel_id for channel in layer.channels]
        encoded = _encode_layer_channels(images[layer.name], channel_ids)
        records.append(
            _patch_record(
                record,
                mask,
                width=width,
                height=height,
                encoded_channels=encoded,
                hidden=layer.name in HIDDEN_BY_DEFAULT,
            )
        )
        for channel_id in channel_ids:
            channel_payloads.extend(encoded[channel_id])

    data = channel_layout.data
    layer_info = (
        data[channel_layout.layer_info_start : channel_layout.records_start]
        + b"".join(records)
        + bytes(channel_payloads)
    )
    if len(layer_info) % 2:
        layer_info += b"\0"

    remaining_layer_mask = data[channel_layout.layer_info_end : channel_layout.layer_mask_end]
    layer_mask = struct.pack(">I", len(layer_info)) + layer_info + remaining_layer_mask

    header_and_resources = bytearray(data[: channel_layout.layer_mask_length_offset])
    struct.pack_into(">I", header_and_resources, 14, height)
    struct.pack_into(">I", header_and_resources, 18, width)

    composite = _flatten_default(images, (width, height))
    composite_data = struct.pack(">H", 0) + b"".join(
        composite.getchannel(band).tobytes() for band in ("R", "G", "B", "A")
    )
    output = (
        bytes(header_and_resources)
        + struct.pack(">I", len(layer_mask))
        + layer_mask
        + composite_data
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", type=Path)
    parser.add_argument("layers_dir", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    build_cubism_psd(args.template, args.layers_dir, args.destination)
    print(f"Wrote {args.destination}")


if __name__ == "__main__":
    main()
