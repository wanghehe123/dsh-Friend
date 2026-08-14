#!/usr/bin/env python3
"""Re-encode PSD layer channels from raw bytes to Photoshop PackBits RLE.

The source artwork uses valid PSD layer records but stores every channel with
compression type 0.  Cubism can read the layer metadata from that file, while
its imported model images remain empty.  This utility changes only the layer
channel compression and leaves the composite image and all metadata intact.
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LayerChannel:
    layer_name: str
    channel_id: int
    compression: int
    pixels: bytes


@dataclass
class _ChannelRecord:
    channel_id: int
    length: int
    length_offset: int


@dataclass
class _LayerRecord:
    name: str
    width: int
    height: int
    channels: list[_ChannelRecord]


@dataclass
class _PsdLayout:
    data: bytes
    layer_mask_length_offset: int
    layer_mask_end: int
    layer_info_length_offset: int
    layer_info_start: int
    layer_info_end: int
    records_start: int
    records_end: int
    layers: list[_LayerRecord]


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">H", data, offset)[0]


def _i16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">h", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from(">I", data, offset)[0]


def _parse(path: Path) -> _PsdLayout:
    data = path.read_bytes()
    if data[:4] != b"8BPS" or _u16(data, 4) != 1:
        raise ValueError("Only standard PSD version 1 files are supported")
    if _u16(data, 22) != 8 or _u16(data, 24) != 3:
        raise ValueError("Expected an 8-bit RGB PSD")

    offset = 26
    offset += 4 + _u32(data, offset)
    offset += 4 + _u32(data, offset)

    layer_mask_length_offset = offset
    layer_mask_length = _u32(data, offset)
    layer_mask_start = offset + 4
    layer_mask_end = layer_mask_start + layer_mask_length

    layer_info_length_offset = layer_mask_start
    layer_info_length = _u32(data, layer_info_length_offset)
    layer_info_start = layer_info_length_offset + 4
    layer_info_end = layer_info_start + layer_info_length
    layer_count = abs(_i16(data, layer_info_start))
    records_start = layer_info_start + 2

    layers: list[_LayerRecord] = []
    offset = records_start
    for _ in range(layer_count):
        top, left, bottom, right = struct.unpack_from(">4i", data, offset)
        offset += 16
        channel_count = _u16(data, offset)
        offset += 2
        channels: list[_ChannelRecord] = []
        for _ in range(channel_count):
            channel_id = _i16(data, offset)
            length_offset = offset + 2
            length = _u32(data, length_offset)
            channels.append(_ChannelRecord(channel_id, length, length_offset))
            offset += 6

        offset += 12
        extra_length = _u32(data, offset)
        offset += 4
        extra_end = offset + extra_length
        mask_length = _u32(data, offset)
        offset += 4 + mask_length
        ranges_length = _u32(data, offset)
        offset += 4 + ranges_length
        name_length = data[offset]
        name = data[offset + 1 : offset + 1 + name_length].decode("latin-1")
        offset = extra_end
        layers.append(_LayerRecord(name, right - left, bottom - top, channels))

    return _PsdLayout(
        data=data,
        layer_mask_length_offset=layer_mask_length_offset,
        layer_mask_end=layer_mask_end,
        layer_info_length_offset=layer_info_length_offset,
        layer_info_start=layer_info_start,
        layer_info_end=layer_info_end,
        records_start=records_start,
        records_end=offset,
        layers=layers,
    )


def _decode_rle(payload: bytes, width: int, height: int) -> bytes:
    table_size = height * 2
    row_lengths = struct.unpack_from(f">{height}H", payload, 0)
    offset = table_size
    decoded = bytearray()
    for row_length in row_lengths:
        row_end = offset + row_length
        while offset < row_end:
            control = payload[offset]
            offset += 1
            if control <= 127:
                count = control + 1
                decoded.extend(payload[offset : offset + count])
                offset += count
            elif control >= 129:
                count = 257 - control
                decoded.extend(payload[offset : offset + 1] * count)
                offset += 1
        if len(decoded) % width:
            raise ValueError("Malformed PackBits row")
    if len(decoded) != width * height:
        raise ValueError("Decoded channel size does not match layer bounds")
    return bytes(decoded)


def _read_channels(layout: _PsdLayout) -> list[LayerChannel]:
    data = layout.data
    offset = layout.records_end
    result: list[LayerChannel] = []
    for layer in layout.layers:
        for channel in layer.channels:
            compression = _u16(data, offset)
            payload = data[offset + 2 : offset + channel.length]
            if compression == 0:
                pixels = payload
            elif compression == 1:
                pixels = _decode_rle(payload, layer.width, layer.height)
            else:
                raise ValueError(f"Unsupported PSD channel compression {compression}")
            expected = layer.width * layer.height
            if len(pixels) != expected:
                raise ValueError(
                    f"{layer.name} channel {channel.channel_id} has {len(pixels)} bytes; expected {expected}"
                )
            result.append(LayerChannel(layer.name, channel.channel_id, compression, pixels))
            offset += channel.length
    return result


def inspect_layer_channels(path: Path) -> list[LayerChannel]:
    return _read_channels(_parse(path))


def _packbits_row(row: bytes) -> bytes:
    encoded = bytearray()
    offset = 0
    while offset < len(row):
        run_length = 1
        while (
            offset + run_length < len(row)
            and row[offset + run_length] == row[offset]
            and run_length < 128
        ):
            run_length += 1
        if run_length >= 3:
            encoded.extend(((257 - run_length) & 0xFF, row[offset]))
            offset += run_length
            continue

        literal_start = offset
        offset += run_length
        while offset < len(row) and offset - literal_start < 128:
            next_run = 1
            while (
                offset + next_run < len(row)
                and row[offset + next_run] == row[offset]
                and next_run < 128
            ):
                next_run += 1
            if next_run >= 3:
                break
            offset += next_run
        literal = row[literal_start:offset]
        encoded.append(len(literal) - 1)
        encoded.extend(literal)
    return bytes(encoded)


def _encode_rle(pixels: bytes, width: int, height: int) -> bytes:
    rows = [_packbits_row(pixels[row * width : (row + 1) * width]) for row in range(height)]
    if any(len(row) > 0xFFFF for row in rows):
        raise ValueError("A PackBits row exceeds the PSD 16-bit row-length limit")
    return struct.pack(f">{height}H", *(len(row) for row in rows)) + b"".join(rows)


def reencode_layer_channels_to_rle(source: Path, destination: Path) -> None:
    layout = _parse(source)
    source_channels = _read_channels(layout)
    if any(channel.compression != 0 for channel in source_channels):
        raise ValueError("Input must use raw layer-channel compression")

    records = bytearray(layout.data[layout.records_start : layout.records_end])
    encoded_channels = bytearray()
    channel_index = 0
    for layer in layout.layers:
        for channel in layer.channels:
            pixels = source_channels[channel_index].pixels
            channel_index += 1
            payload = _encode_rle(pixels, layer.width, layer.height)
            encoded = struct.pack(">H", 1) + payload
            local_length_offset = channel.length_offset - layout.records_start
            struct.pack_into(">I", records, local_length_offset, len(encoded))
            encoded_channels.extend(encoded)

    layer_info = (
        layout.data[layout.layer_info_start : layout.records_start]
        + bytes(records)
        + bytes(encoded_channels)
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    reencode_layer_channels_to_rle(args.source, args.destination)
    print(f"Wrote {args.destination}")


if __name__ == "__main__":
    main()
