#!/usr/bin/env python3
"""Serve Naiwa V3 layers to Photopea and receive its PSD export."""

from __future__ import annotations

import json
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAYER_ROOT = ROOT / "layers-v3"
OUTPUT = LAYER_ROOT / "naiwa-live2d-v3-source.psd"
HOST = "127.0.0.1"
PORT = 8765


class PhotopeaBridge(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def translate_path(self, path: str) -> str:
        name = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        return str(LAYER_ROOT / name)

    def guess_type(self, path: str) -> str:
        return mimetypes.guess_type(path)[0] or "application/octet-stream"

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/save":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length)
        if len(payload) < 2000:
            self.send_error(400, "Photopea payload is too short")
            return

        header = json.loads(payload[:2000].decode("utf-8").rstrip("\x00 \t\r\n"))
        body = payload[2000:]
        psd_version = next(
            (version for version in header.get("versions", []) if version.get("format") == "psd"),
            None,
        )
        if psd_version is None:
            self.send_error(400, "Photopea did not include a PSD version")
            return

        start = int(psd_version["start"])
        size = int(psd_version["size"])
        OUTPUT.write_bytes(body[start : start + size])

        response = json.dumps(
            {
                "message": f"Saved {OUTPUT.name}",
                "newSource": f"local,naiwa-v3,{OUTPUT.name}",
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)
        print(f"SAVED {OUTPUT} ({size} bytes)", flush=True)


if __name__ == "__main__":
    print(f"SERVING http://{HOST}:{PORT} from {LAYER_ROOT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), PhotopeaBridge).serve_forever()
