#!/usr/bin/env python3
"""Remove invalid zero-filled layer-mask metadata from a standard PSD.

The Naiwa source PSD contains a 36-byte all-zero mask block on every layer,
even though it has no user-mask channels.  Photopea renders those blocks as
solid-black masks and Cubism imports blank model images.  This utility removes
only all-zero mask blocks and preserves the layer records and channel bytes.
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LayerMask:
    layer_name: str
    length: int
    data: bytes


@dataclass(frozen=True)
class _Layout:
    data: bytes
    layer_mask_length_offset: int
    layer_mask_end: int
    layer_info_start: int
    layer_info_end: int
    records_start: int
    records_end: int
    records: list[bytes]
    masks: list[LayerMask]


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">H", data, offset)[0]


def _i16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">h", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from(">I", data, offset)[0]


def _parse(path: Path) -> _Layout:
    data = path.read_bytes()
    if data[:4] != b"8BPS" or _u16(data, 4) != 1:
        raise ValueError("Only standard PSD version 1 files are supported")

    offset = 26
    offset += 4 + _u32(data, offset)
    offset += 4 + _u32(data, offset)

    layer_mask_length_offset = offset
    layer_mask_length = _u32(data, offset)
    layer_mask_start = offset + 4
    layer_mask_end = layer_mask_start + layer_mask_length

    layer_info_length = _u32(data, layer_mask_start)
    layer_info_start = layer_mask_start + 4
    layer_info_end = layer_info_start + layer_info_length
    layer_count = abs(_i16(data, layer_info_start))
    records_start = layer_info_start + 2

    records: list[bytes] = []
    masks: list[LayerMask] = []
    offset = records_start
    for _ in range(layer_count):
        record_start = offset
        offset += 16
        channel_count = _u16(data, offset)
        offset += 2 + channel_count * 6
        offset += 12

        extra_length = _u32(data, offset)
        offset += 4
        extra_end = offset + extra_length

        mask_length = _u32(data, offset)
        mask_data_start = offset + 4
        mask_data = data[mask_data_start : mask_data_start + mask_length]
        offset = mask_data_start + mask_length

        ranges_length = _u32(data, offset)
        offset += 4 + ranges_length
        name_length = data[offset]
        layer_name = data[offset + 1 : offset + 1 + name_length].decode("latin-1")

        records.append(data[record_start:extra_end])
        masks.append(LayerMask(layer_name, mask_length, mask_data))
        offset = extra_end

    return _Layout(
        data=data,
        layer_mask_length_offset=layer_mask_length_offset,
        layer_mask_end=layer_mask_end,
        layer_info_start=layer_info_start,
        layer_info_end=layer_info_end,
        records_start=records_start,
        records_end=offset,
        records=records,
        masks=masks,
    )


def inspect_layer_masks(path: Path) -> list[LayerMask]:
    return _parse(path).masks


def _strip_record(record: bytes, mask: LayerMask) -> bytes:
    if mask.length == 0:
        return record
    if any(mask.data):
        raise ValueError(f"Refusing to strip non-empty layer mask from {mask.layer_name}")

    offset = 16
    channel_count = _u16(record, offset)
    offset += 2 + channel_count * 6 + 12
    extra_length_offset = offset
    extra_length = _u32(record, extra_length_offset)
    mask_length_offset = extra_length_offset + 4
    mask_data_start = mask_length_offset + 4
    mask_data_end = mask_data_start + mask.length

    result = bytearray(record[:mask_data_start] + record[mask_data_end:])
    struct.pack_into(">I", result, extra_length_offset, extra_length - mask.length)
    struct.pack_into(">I", result, mask_length_offset, 0)
    return bytes(result)


def strip_empty_layer_masks(source: Path, destination: Path) -> int:
    layout = _parse(source)
    stripped_records = [
        _strip_record(record, mask) for record, mask in zip(layout.records, layout.masks, strict=True)
    ]
    removed = sum(mask.length > 0 for mask in layout.masks)

    layer_info = (
        layout.data[layout.layer_info_start : layout.records_start]
        + b"".join(stripped_records)
        + layout.data[layout.records_end : layout.layer_info_end]
    )
    if len(layer_info) % 2:
        layer_info += b"\0"

    remaining_layer_mask = layout.data[layout.layer_info_end : layout.layer_mask_end]
    layer_mask = struct.pack(">I", len(layer_info)) + layer_info + remaining_layer_mask
    output = (
        layout.data[: layout.layer_mask_length_offset]
        + struct.pack(">I", len(layer_mask))
        + layer_mask
        + layout.data[layout.layer_mask_end :]
    )

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    removed = strip_empty_layer_masks(args.source, args.destination)
    print(f"Wrote {args.destination} after removing {removed} empty layer masks")


if __name__ == "__main__":
    main()
