#!/usr/bin/env python3
"""Capture StackChan RX-only four-slot diagnostic UDP packets as WAV files."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import socket
import struct
import time
import wave
from array import array
from datetime import datetime
from pathlib import Path
from typing import Any


MAGIC = b"SC4D"
VERSION = 1
TYPE_AUDIO = 1
TYPE_REGISTERS = 2
CHANNELS = 4
SAMPLE_BYTES = 2
SAMPLE_RATE = 24_000
HEADER = struct.Struct(">4sBBBBIQHH")
FRAMES_PER_AUDIO_PACKET = 120
AUDIO_PAYLOAD_BYTES = FRAMES_PER_AUDIO_PACKET * CHANNELS * SAMPLE_BYTES
AUDIO_PACKET_BYTES = HEADER.size + AUDIO_PAYLOAD_BYTES
SLOT_NAMES = ("slot0_mic1", "slot1_mic3_or_aec", "slot2_mic2", "slot3_unconnected")


def parse_packet(data: bytes) -> dict[str, Any]:
    if len(data) < HEADER.size:
        raise ValueError("packet shorter than 24-byte header")
    magic, version, packet_type, channels, sample_bytes, sequence, capture_us, frames, payload_bytes = HEADER.unpack_from(data)
    payload = data[HEADER.size:]
    if magic != MAGIC or version != VERSION:
        raise ValueError("invalid diagnostic magic or version")
    if channels != CHANNELS or sample_bytes != SAMPLE_BYTES:
        raise ValueError("unexpected channel or sample width")
    if payload_bytes != len(payload):
        raise ValueError("payload length mismatch")
    if packet_type == TYPE_AUDIO:
        if frames != FRAMES_PER_AUDIO_PACKET or payload_bytes != AUDIO_PAYLOAD_BYTES or len(data) != AUDIO_PACKET_BYTES:
            raise ValueError("audio packet must be exactly 120 frames, 960-byte payload, and 984 bytes total")
        if payload_bytes != frames * channels * sample_bytes:
            raise ValueError("audio frame length mismatch")
    if packet_type == TYPE_REGISTERS and (frames != 0 or payload_bytes % 2):
        raise ValueError("invalid register snapshot")
    if packet_type not in (TYPE_AUDIO, TYPE_REGISTERS):
        raise ValueError("unknown packet type")
    return {
        "type": packet_type,
        "sequence": sequence,
        "capture_us": capture_us,
        "frames": frames,
        "payload": payload,
    }


def split_channels(interleaved: bytes) -> list[bytes]:
    samples = array("h")
    samples.frombytes(interleaved)
    if len(samples) % CHANNELS:
        raise ValueError("interleaved PCM is not four-channel aligned")
    outputs = [array("h") for _ in range(CHANNELS)]
    for index, sample in enumerate(samples):
        outputs[index % CHANNELS].append(sample)
    return [channel.tobytes() for channel in outputs]


def channel_metrics(pcm: bytes) -> dict[str, float | int]:
    samples = array("h")
    samples.frombytes(pcm)
    if not samples:
        return {"samples": 0, "peak": 0, "rms": 0.0, "near_zero_percent": 100.0}
    squares = sum(int(value) * int(value) for value in samples)
    near_zero = sum(abs(value) <= 4 for value in samples)
    return {
        "samples": len(samples),
        "peak": max(abs(value) for value in samples),
        "rms": round(math.sqrt(squares / len(samples)), 3),
        "near_zero_percent": round(near_zero * 100.0 / len(samples), 3),
    }


def write_wav(path: Path, channels: int, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(SAMPLE_BYTES)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def capture(args: argparse.Namespace) -> dict[str, Any]:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = Path(args.output_dir or f"rx4-capture-{timestamp}").resolve()
    output_dir.mkdir(parents=True, exist_ok=False)

    receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    receiver.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
    receiver.bind((args.bind, args.port))
    receiver.settimeout(0.5)

    audio = bytearray()
    register_snapshots: list[dict[str, Any]] = []
    invalid_packets = 0
    sequence_gaps = 0
    missing_packets = 0
    audio_packets = 0
    expected_sequence: int | None = None
    first_sequence: int | None = None
    last_sequence: int | None = None
    first_capture_us: int | None = None
    last_capture_us: int | None = None
    source_endpoints: set[str] = set()
    first_audio_at: float | None = None
    capture_started_at = datetime.now().astimezone().isoformat()
    startup_deadline = time.monotonic() + args.startup_timeout

    try:
        while True:
            now = time.monotonic()
            if first_audio_at is None and now >= startup_deadline:
                raise TimeoutError("no RX4 audio packet arrived before startup timeout")
            if first_audio_at is not None and now - first_audio_at >= args.duration:
                break
            try:
                data, source = receiver.recvfrom(2048)
            except socket.timeout:
                continue
            try:
                packet = parse_packet(data)
            except ValueError:
                invalid_packets += 1
                continue

            if packet["type"] == TYPE_REGISTERS:
                payload = packet["payload"]
                register_snapshots.append({
                    "sequence": packet["sequence"],
                    "capture_us": packet["capture_us"],
                    "registers": {f"0x{payload[i]:02X}": f"0x{payload[i + 1]:02X}" for i in range(0, len(payload), 2)},
                })
                continue

            if first_audio_at is None:
                first_audio_at = now
            sequence = packet["sequence"]
            source_endpoints.add(f"{source[0]}:{source[1]}")
            if first_sequence is None:
                first_sequence = sequence
                first_capture_us = packet["capture_us"]
            if expected_sequence is not None and sequence != expected_sequence:
                forward = (sequence - expected_sequence) & 0xFFFFFFFF
                if 0 < forward < 10_000:
                    sequence_gaps += 1
                    missing_packets += forward
                    audio.extend(b"\0" * (forward * packet["frames"] * CHANNELS * SAMPLE_BYTES))
                else:
                    invalid_packets += 1
                    continue
            expected_sequence = (sequence + 1) & 0xFFFFFFFF
            last_sequence = sequence
            last_capture_us = packet["capture_us"]
            audio.extend(packet["payload"])
            audio_packets += 1
    finally:
        receiver.close()

    raw_path = output_dir / "rx4-interleaved-s16le.pcm"
    raw_path.write_bytes(audio)
    four_channel_path = output_dir / "rx4-four-slot-24khz.wav"
    write_wav(four_channel_path, CHANNELS, audio)
    mono = split_channels(audio)
    mono_paths: dict[str, str] = {}
    metrics: dict[str, dict[str, float | int]] = {}
    for name, pcm in zip(SLOT_NAMES, mono, strict=True):
        path = output_dir / f"{name}-24khz.wav"
        write_wav(path, 1, pcm)
        mono_paths[name] = str(path)
        metrics[name] = channel_metrics(pcm)

    artifact_paths = [raw_path, four_channel_path, *(Path(path) for path in mono_paths.values())]
    artifact_hashes = {path.name: sha256_file(path) for path in artifact_paths}

    summary = {
        "format": {"sample_rate": SAMPLE_RATE, "channels": CHANNELS, "sample_width_bits": 16},
        "duration_requested_seconds": args.duration,
        "frames": len(audio) // (CHANNELS * SAMPLE_BYTES),
        "audio_packets": audio_packets,
        "first_sequence": first_sequence,
        "last_sequence": last_sequence,
        "first_device_capture_us": first_capture_us,
        "last_device_capture_us": last_capture_us,
        "source_endpoints": sorted(source_endpoints),
        "capture_started_at": capture_started_at,
        "capture_finished_at": datetime.now().astimezone().isoformat(),
        "sequence_gap_events": sequence_gaps,
        "missing_packets_zero_filled": missing_packets,
        "invalid_packets": invalid_packets,
        "register_snapshots": register_snapshots,
        "metrics": metrics,
        "sha256": artifact_hashes,
        "files": {
            "raw_interleaved": str(raw_path),
            "four_channel_wav": str(four_channel_path),
            "mono_wav": mono_paths,
        },
    }
    metadata_path = output_dir / "capture-metadata.json"
    metadata_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary["files"]["metadata"] = str(metadata_path)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--duration", type=float, default=15.0)
    parser.add_argument("--startup-timeout", type=float, default=30.0)
    parser.add_argument("--output-dir")
    args = parser.parse_args()
    if args.duration <= 0 or args.startup_timeout <= 0:
        parser.error("duration and startup-timeout must be positive")
    try:
        summary = capture(args)
    except (OSError, TimeoutError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, **summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
