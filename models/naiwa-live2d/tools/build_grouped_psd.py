#!/usr/bin/env python3
"""Create a Cubism-friendly PSD whose seven source layers share a root group.

Cubism mirrors PSD folder hierarchy into its Parts palette.  The original
source PSD deliberately contains seven flat layers, so this utility preserves
all pixel/channel bytes and adds a single visible Photoshop section-divider
folder named ``Naiwa`` below those layers.  No source pixels are recompressed.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


PSD_SIGNATURE = b"8BPS"
BLEND_SIGNATURE = b"8BIM"
EMPTY_LAYER_CHANNELS = ((-1, 2), (0, 2), (1, 2), (2, 2))
EMPTY_LAYER_CHANNEL_DATA = struct.pack(">H", 0) * len(EMPTY_LAYER_CHANNELS)


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">H", data, offset)[0]


def _i16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">h", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from(">I", data, offset)[0]


def _pascal4(name: str) -> bytes:
    encoded = name.encode("latin-1")
    if len(encoded) > 255:
        raise ValueError("PSD layer names may contain at most 255 bytes")
    raw = bytes([len(encoded)]) + encoded
    return raw + b"\0" * ((-len(raw)) % 4)


def _additional(key: bytes, body: bytes) -> bytes:
    if len(key) != 4:
        raise ValueError("PSD additional-info keys are four bytes")
    # PSD (not PSB) additional-info payloads are padded to an even boundary.
    return BLEND_SIGNATURE + key + struct.pack(">I", len(body)) + body + b"\0" * (len(body) % 2)


def _section_divider_record(
    *,
    name: str,
    divider_type: int,
    layer_id: int,
    blend_mode: bytes,
    opacity: int,
    include_blend_in_divider: bool,
) -> bytes:
    """Build one of Photoshop's paired group-boundary layer records.

    PSD stores a folder as two records: an invisible ``type=3`` bounding
    divider before its children, and a named ``type=1`` folder divider after
    them.  Keeping both records is essential: a lone folder divider can be
    rendered by permissive image readers, but it does not describe a layer
    hierarchy to applications such as Cubism.
    """
    if divider_type not in (1, 2, 3):
        raise ValueError("PSD section-divider type must be 1, 2, or 3")
    if len(blend_mode) != 4:
        raise ValueError("PSD blend mode must be four bytes")

    section_divider = struct.pack(">I", divider_type)
    if include_blend_in_divider:
        section_divider += BLEND_SIGNATURE + blend_mode
    extra = (
        struct.pack(">I", 0)  # layer mask data
        + struct.pack(">I", 0)  # blending ranges
        + _pascal4(name)
        + _additional(b"lsct", section_divider)
        + _additional(b"lyid", struct.pack(">I", layer_id))
    )
    return (
        struct.pack(">4i", 0, 0, 0, 0)
        # Cubism's PSD reader assumes every layer record has at least one
        # channel.  Declare empty RGB and alpha channels for the zero-sized
        # folder boundary; each consists only of the 2-byte compression code.
        + struct.pack(">H", len(EMPTY_LAYER_CHANNELS))
        + b"".join(struct.pack(">hI", channel_id, length) for channel_id, length in EMPTY_LAYER_CHANNELS)
        + BLEND_SIGNATURE
        + blend_mode
        # 0x08 marks Photoshop 5+ semantics; 0x10 marks a section divider as
        # having no pixel data.  Do not set 0x02: that would hide the folder
        # and all of its children in PSD consumers.
        + bytes([opacity, 0, 0b00011000, 0])
        + struct.pack(">I", len(extra))
        + extra
    )


def _end_of_layer_records(data: bytes, records_offset: int, layer_count: int) -> tuple[int, int]:
    """Return the first channel-data byte and largest existing layer id."""
    offset = records_offset
    max_layer_id = -1
    for _ in range(layer_count):
        offset += 16  # top, left, bottom, right
        channel_count = _u16(data, offset)
        offset += 2 + channel_count * 6
        offset += 12  # blend-mode signature/key, opacity, clipping, flags, filler
        extra_length = _u32(data, offset)
        offset += 4
        extra_end = offset + extra_length

        mask_length = _u32(data, offset)
        offset += 4 + mask_length
        blending_ranges_length = _u32(data, offset)
        offset += 4 + blending_ranges_length
        pascal_length = data[offset]
        offset += 1 + pascal_length
        offset += (-(1 + pascal_length)) % 4

        while offset < extra_end:
            signature = data[offset : offset + 4]
            key = data[offset + 4 : offset + 8]
            payload_length = _u32(data, offset + 8)
            payload_start = offset + 12
            if signature == BLEND_SIGNATURE and key == b"lyid" and payload_length == 4:
                max_layer_id = max(max_layer_id, _u32(data, payload_start))
            offset = payload_start + payload_length + (payload_length % 2)

        if offset != extra_end:
            raise ValueError("Malformed PSD layer extra-data boundary")
    return offset, max_layer_id


def build(source: Path, destination: Path, group_name: str) -> None:
    data = source.read_bytes()
    if data[:4] != PSD_SIGNATURE or _u16(data, 4) != 1:
        raise ValueError("Only standard PSD version 1 files are supported")

    offset = 26
    color_mode_length = _u32(data, offset)
    offset += 4 + color_mode_length
    image_resources_length = _u32(data, offset)
    offset += 4 + image_resources_length

    layer_mask_length_offset = offset
    layer_mask_length = _u32(data, offset)
    layer_mask_start = offset + 4
    layer_mask_end = layer_mask_start + layer_mask_length
    if layer_mask_end > len(data):
        raise ValueError("Malformed PSD layer-and-mask section")

    layer_info_length_offset = layer_mask_start
    layer_info_length = _u32(data, layer_info_length_offset)
    layer_info_start = layer_info_length_offset + 4
    layer_info_end = layer_info_start + layer_info_length
    layer_count = _i16(data, layer_info_start)
    if layer_count <= 0:
        raise ValueError("Source PSD must contain at least one layer")
    records_start = layer_info_start + 2
    records_end, max_layer_id = _end_of_layer_records(data, records_start, layer_count)
    if not records_start <= records_end <= layer_info_end:
        raise ValueError("Malformed PSD layer-record section")

    # A PSD folder is encoded as a matching type-3 (opening boundary) and
    # type-1 (named folder) pair around the child layer records.  PSD layer
    # records are stored from top to bottom, hence the type-3 marker comes
    # first and the named type-1 record comes after the seven children.
    group_start_record = _section_divider_record(
        name="</Layer group>",
        divider_type=3,
        layer_id=max_layer_id + 1,
        blend_mode=b"norm",
        opacity=255,
        include_blend_in_divider=False,
    )
    group_end_record = _section_divider_record(
        name=group_name,
        divider_type=1,
        layer_id=max_layer_id + 2,
        # Cubism's PSD reader does not accept Photoshop's "pass" (pass
        # through) group blend mode.  A normal folder is equivalent for this
        # flat artwork and imports reliably in Cubism.
        blend_mode=b"norm",
        opacity=255,
        include_blend_in_divider=True,
    )
    new_layer_info = (
        struct.pack(">h", layer_count + 2)
        + group_start_record
        + data[records_start:records_end]
        + group_end_record
        + EMPTY_LAYER_CHANNEL_DATA
        + data[records_end:layer_info_end]
        + EMPTY_LAYER_CHANNEL_DATA
    )
    if len(new_layer_info) % 2:
        new_layer_info += b"\0"
    remaining_layer_mask_data = data[layer_info_end:layer_mask_end]
    new_layer_mask_data = struct.pack(">I", len(new_layer_info)) + new_layer_info + remaining_layer_mask_data

    result = (
        data[:layer_mask_length_offset]
        + struct.pack(">I", len(new_layer_mask_data))
        + new_layer_mask_data
        + data[layer_mask_end:]
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--group-name", default="Naiwa")
    args = parser.parse_args()
    build(args.source, args.destination, args.group_name)
    print(f"Wrote {args.destination}")


if __name__ == "__main__":
    main()
