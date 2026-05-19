#!/usr/bin/env python3
"""Configurable OTA update server for Stack Chan firmware updates."""

import argparse
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080
DEFAULT_LAN_IP = "192.168.0.12"
DEFAULT_FIRMWARE = "exp-pkg/active-release/stack-chan.bin"
DEFAULT_VERSION = "2.0.25"
DEFAULT_FORCE = 0


def _int_force(value):
    """Return numeric OTA force flag (0 or 1)."""
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return 1 if value else 0
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("1", "true", "yes", "y", "on", "force"):
            return 1
        if text in ("0", "false", "no", "n", "off", ""):
            return 0
    raise argparse.ArgumentTypeError("force must be 0 or 1")


def _load_metadata(path):
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"metadata must be a JSON object: {path}")
    return data


def _resolve_path(path):
    return path if os.path.isabs(path) else os.path.abspath(path)


def parse_args():
    parser = argparse.ArgumentParser(
        description="StackChan OTA manifest and firmware server."
    )
    parser.add_argument(
        "--metadata",
        help="JSON metadata file, for example ops/ota/active.json",
    )
    parser.add_argument("--host", help=f"listen host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, help=f"listen port (default: {DEFAULT_PORT})")
    parser.add_argument("--lan-ip", help=f"LAN IP used in firmware URL (default: {DEFAULT_LAN_IP})")
    parser.add_argument("--firmware", help=f"firmware path (default: {DEFAULT_FIRMWARE})")
    parser.add_argument("--version", help=f"firmware version (default: {DEFAULT_VERSION})")
    parser.add_argument("--force", type=_int_force, help=f"OTA force flag 0 or 1 (default: {DEFAULT_FORCE})")
    args = parser.parse_args()

    metadata = _load_metadata(args.metadata)
    config = {
        "host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "lan_ip": DEFAULT_LAN_IP,
        "firmware": DEFAULT_FIRMWARE,
        "version": DEFAULT_VERSION,
        "force": DEFAULT_FORCE,
    }
    for key in config:
        if key in metadata and metadata[key] is not None:
            config[key] = metadata[key]

    # CLI arguments override metadata.
    for arg_name, key in (
        ("host", "host"),
        ("port", "port"),
        ("lan_ip", "lan_ip"),
        ("firmware", "firmware"),
        ("version", "version"),
        ("force", "force"),
    ):
        value = getattr(args, arg_name)
        if value is not None:
            config[key] = value

    config["port"] = int(config["port"])
    config["force"] = _int_force(config["force"])
    config["firmware_path"] = _resolve_path(str(config["firmware"]))
    config["url"] = f"http://{config['lan_ip']}:{config['port']}/stack-chan.bin"
    return config


def firmware_meta(path):
    size = os.path.getsize(path) if os.path.exists(path) else 0
    digest = hashlib.sha256()
    if size:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                digest.update(chunk)
    return size, digest.hexdigest() if size else ""


class OTAHandler(BaseHTTPRequestHandler):
    config = None

    def _send_manifest(self, send_body=True):
        cfg = self.config
        size, sha256 = firmware_meta(cfg["firmware_path"])
        resp = {
            "mode": "upgrade",
            "version": str(cfg["version"]),
            "force": int(cfg["force"]),
            "url": cfg["url"],
            "size": size,
            "sha256": sha256,
            "firmware": {
                "version": str(cfg["version"]),
                "url": cfg["url"],
                "force": int(cfg["force"]),
                "size": size,
                "sha256": sha256,
            },
        }
        body = json.dumps(resp, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def _send_firmware(self, send_body):
        path = self.config["firmware_path"]
        if not os.path.exists(path):
            self.send_response(404)
            self.send_header("Connection", "close")
            self.end_headers()
            return
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Connection", "close")
        self.end_headers()
        if send_body:
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    self.wfile.write(chunk)

    def _path(self):
        return urlparse(self.path).path

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len > 0:
            self.rfile.read(content_len)
        if self._path() in ("/ota/", "/ota"):
            self._send_manifest(True)
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        path = self._path()
        if path in ("/ota/", "/ota"):
            self._send_manifest(True)
        elif path == "/stack-chan.bin":
            self._send_firmware(True)
        else:
            self.send_response(404)
            self.end_headers()

    def do_HEAD(self):
        path = self._path()
        if path in ("/ota/", "/ota"):
            self._send_manifest(False)
        elif path == "/stack-chan.bin":
            self._send_firmware(False)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        print(
            f"[OTA] {self.client_address[0]} {self.command} {self.path} - " + (fmt % args),
            flush=True,
        )


def print_banner(config):
    size, sha256 = firmware_meta(config["firmware_path"])
    print("StackChan OTA Server", flush=True)
    print(f"  Version:  {config['version']}", flush=True)
    print(f"  Force:    {int(config['force'])}", flush=True)
    print(f"  Firmware: {config['firmware']} -> {config['firmware_path']}", flush=True)
    print(f"  Size:     {size} bytes", flush=True)
    print(f"  SHA256:   {sha256}", flush=True)
    print(f"  URL:      {config['url']}", flush=True)
    print(f"  Listen:   {config['host']}:{config['port']}", flush=True)
    print("", flush=True)


def main():
    config = parse_args()
    OTAHandler.config = config
    print_banner(config)
    server = HTTPServer((config["host"], config["port"]), OTAHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
