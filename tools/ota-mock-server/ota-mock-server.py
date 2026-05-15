#!/usr/bin/env python3
"""
StackChan OTA Mock Server

A lightweight HTTP server that simulates the OTA update endpoint.

Modes:
    probe       Safe default: low version + empty URL + force=0.
    no-upgrade  Current-version manifest + empty URL + force=0.
    confirm     Alias of no-upgrade, useful to exercise the no-new-version branch.
    upgrade     Explicit OTA test: high version + downloadable URL + force=1.

Usage:
    python3 ota-mock-server.py [--mode probe|no-upgrade|confirm|upgrade]
                               [--version VERSION] [--force 1|0]
                               [--port PORT]
                               [--firmware PATH]

Endpoints:
    GET/POST /ota/         → OTA manifest (JSON)
    GET/HEAD /stack-chan.bin → firmware binary file
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

# Path to the actual firmware build
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.normpath(os.path.join(SCRIPT_DIR, "../.."))
DEFAULT_FIRMWARE = os.path.join(PROJECT_ROOT, "firmware/build/stack-chan.bin")

DEFAULT_PROBE_VERSION = "0.0.0"
DEFAULT_CURRENT_VERSION = "1.4.1"
DEFAULT_UPGRADE_VERSION = "2.0.0"


@dataclass(frozen=True)
class ManifestConfig:
    mode: str
    version: str
    force: int


def parse_force(value: str) -> int:
    """Parse CLI force values and serialize them as numeric 1/0."""
    normalized = value.strip().lower()
    if normalized in ("1", "true", "yes", "y", "on"):
        return 1
    if normalized in ("0", "false", "no", "n", "off"):
        return 0
    raise argparse.ArgumentTypeError("expected one of: true/false, yes/no, 1/0, on/off")


class OTARequestHandler(BaseHTTPRequestHandler):
    firmware_path: str = ""  # set by factory
    manifest_config: ManifestConfig = ManifestConfig("probe", DEFAULT_PROBE_VERSION, 0)

    # ------------------------------------------------------------------ #
    #  helpers
    # ------------------------------------------------------------------ #
    def _log_request(self, method: str, path: str, status: int):
        source_ip = self.client_address[0]
        user_agent = self.headers.get("User-Agent", "-")
        content_length = self.headers.get("Content-Length", "-")
        print(
            f"[{datetime.now():%H:%M:%S}] "
            f"ip={source_ip} method={method} path={path} status={status} "
            f"ua={user_agent!r} content_length={content_length}",
            flush=True,
        )

    def _send_json(self, data: dict, status: int = 200, extra_headers: dict | None = None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_file(self, filepath: str, send_body: bool = True):
        if not os.path.isfile(filepath):
            self._send_json({"error": "firmware not found"}, 404)
            return
        size = os.path.getsize(filepath)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Connection", "close")
        self.end_headers()
        if not send_body:
            return
        sent = 0
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                sent += len(chunk)
        print(f"[SEND] binary complete: {sent}/{size} bytes", flush=True)

    def _firmware_url(self) -> str:
        host = self.headers.get("Host", f"localhost:{self.server.server_port}").split(":")[0]
        return f"http://{host}:{self.server.server_port}/stack-chan.bin"

    # ------------------------------------------------------------------ #
    #  handlers
    # ------------------------------------------------------------------ #
    def do_GET(self):
        if self.path in ("/ota/", "/ota"):
            self._handle_ota()
        elif self.path in ("/stack-chan.bin",):
            self._handle_binary(send_body=True)
        else:
            self._send_json({"error": "not found"}, 404)
            self._log_request("GET", self.path, 404)

    def do_POST(self):
        if self.path in ("/ota/", "/ota"):
            # Read request body (ignored — we always return the selected manifest)
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 0:
                _ = self.rfile.read(content_length)
            self._handle_ota()
        else:
            self._send_json({"error": "not found"}, 404)
            self._log_request("POST", self.path, 404)

    def do_HEAD(self):
        if self.path in ("/stack-chan.bin",):
            self._handle_binary(send_body=False)
        else:
            self._send_json({"error": "not found"}, 404)
            self._log_request("HEAD", self.path, 404)

    # ------------------------------------------------------------------ #
    #  internal
    # ------------------------------------------------------------------ #
    def _handle_ota(self):
        now_iso = datetime.now(timezone.utc).isoformat()
        cfg = self.manifest_config
        # Probe/no-upgrade/confirm modes must be non-invasive: keep the JSON
        # shape OTA clients may expect, but do not advertise a downloadable
        # firmware URL. Upgrade mode remains the only normal mode that returns
        # /stack-chan.bin in the manifest.
        url = self._firmware_url() if cfg.mode == "upgrade" else ""
        manifest = {
            "mode": cfg.mode,
            "version": cfg.version,
            "force": cfg.force,
            "url": url,
            "firmware": {
                "version": cfg.version,
                "url": url,
                "force": cfg.force,
            },
            "server_time": now_iso,
        }
        self._send_json(manifest, extra_headers={"X-OTA-Mock-Mode": cfg.mode})
        self._log_request(self.command, self.path, 200)

    def _handle_binary(self, send_body: bool):
        if self.manifest_config.mode != "upgrade":
            self._send_json({"error": "firmware download disabled in this mode"}, 404)
            self._log_request(self.command, self.path, 404)
            return
        status = 200 if os.path.isfile(self.firmware_path) else 404
        self._send_file(self.firmware_path, send_body=send_body)
        self._log_request(self.command, self.path, status)

    # suppress default "GET / HTTP/1.1" log line
    def log_message(self, format, *args):
        pass


def create_handler(fw_path: str, manifest_config: ManifestConfig):
    """Factory: returns a handler class with firmware_path/config set."""
    class_dict = {"firmware_path": fw_path, "manifest_config": manifest_config}
    return type("_Handler", (OTARequestHandler,), class_dict)


def build_manifest_config(args: argparse.Namespace) -> ManifestConfig:
    mode = "no-upgrade" if args.mode == "confirm" else args.mode
    if mode == "upgrade":
        default_version = DEFAULT_UPGRADE_VERSION
        default_force = 1
    elif mode == "no-upgrade":
        default_version = DEFAULT_CURRENT_VERSION
        default_force = 0
    else:
        default_version = DEFAULT_PROBE_VERSION
        default_force = 0
    return ManifestConfig(
        mode=mode,
        version=args.version or default_version,
        force=default_force if args.force is None else args.force,
    )


def main():
    parser = argparse.ArgumentParser(description="StackChan OTA Mock Server")
    parser.add_argument("--mode", choices=("probe", "no-upgrade", "confirm", "upgrade"), default="probe", help="manifest mode (default: probe)")
    parser.add_argument("--version", type=str, default=None, help="manifest firmware version")
    parser.add_argument("--force", type=parse_force, default=None, help="manifest force flag serialized as numeric 1/0 (default: 0 except upgrade=1)")
    parser.add_argument("--port", type=int, default=8080, help="listen port (default: 8080)")
    parser.add_argument("--firmware", type=str, default=DEFAULT_FIRMWARE, help="path to stack-chan.bin")
    args = parser.parse_args()

    firmware = os.path.abspath(args.firmware)
    if not os.path.isfile(firmware):
        print(f"[!] firmware not found: {firmware}", file=sys.stderr)
        sys.exit(1)

    manifest_config = build_manifest_config(args)
    handler = create_handler(firmware, manifest_config)
    server = HTTPServer(("0.0.0.0", args.port), handler)

    fw_size = os.path.getsize(firmware)
    downloadable_firmware_url = f"http://<LAN_IP>:{args.port}/stack-chan.bin"
    manifest_url = downloadable_firmware_url if manifest_config.mode == "upgrade" else ""
    manifest_preview = {
        "mode": manifest_config.mode,
        "version": manifest_config.version,
        "force": manifest_config.force,
        "url": manifest_url,
        "firmware": {
            "version": manifest_config.version,
            "url": manifest_url,
            "force": manifest_config.force,
        },
        "server_time": "<utc-now>",
    }

    print("=" * 60)
    print("  StackChan OTA Mock Server")
    print(f"  Mode:    {manifest_config.mode}")
    print(f"  Listen:  http://0.0.0.0:{args.port}")
    print(f"  Firmware file: {firmware} ({fw_size / 1024:.1f} KB)")
    if manifest_config.mode == "upgrade":
        print(f"  Firmware URL:  {downloadable_firmware_url}")
    else:
        print(f"  Firmware URL:  <not advertised in {manifest_config.mode} mode>")
    print("  Manifest:")
    print(json.dumps(manifest_preview, ensure_ascii=False, indent=4))
    print("-" * 60)
    print("  GET/POST  /ota/           → OTA manifest (JSON)")
    print("  GET/HEAD  /stack-chan.bin → firmware binary (upgrade mode only)")
    print("=" * 60)
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bye] server stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
