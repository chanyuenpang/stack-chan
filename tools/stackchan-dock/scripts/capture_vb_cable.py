"""Capture Stack-chan microphone audio from VB-CABLE's WASAPI output."""

from __future__ import annotations

import argparse
from pathlib import Path
import wave

import sounddevice as sd


def resolve_device(name: str, host_api: str) -> int:
    host_apis = sd.query_hostapis()
    for index, device in enumerate(sd.query_devices()):
        current_host_api = host_apis[device["hostapi"]]["name"]
        if (
            name.lower() in device["name"].lower()
            and current_host_api == host_api
            and device["max_input_channels"] >= 1
        ):
            return index
    raise RuntimeError(f"No {host_api} capture device matching {name!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--duration", type=float, default=6.0)
    parser.add_argument("--device", default="CABLE Output (VB-Audio Virtual Cable)")
    parser.add_argument("--host-api", default="Windows WASAPI")
    parser.add_argument("--sample-rate", type=int, default=48_000)
    parser.add_argument("--blocksize", type=int, default=480)
    parser.add_argument("--latency", choices=("low", "high"), default="high")
    args = parser.parse_args()
    if args.duration <= 0:
        parser.error("--duration must be positive")

    device = resolve_device(args.device, args.host_api)
    if args.blocksize <= 0:
        parser.error("--blocksize must be positive")
    frame_count = round(args.duration * args.sample_rate)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    chunks: list[bytes] = []
    frames_remaining = frame_count
    overflow_count = 0
    with sd.RawInputStream(
        samplerate=args.sample_rate,
        channels=1,
        dtype="int16",
        device=device,
        blocksize=args.blocksize,
        latency=args.latency,
    ) as stream:
        while frames_remaining:
            requested = min(args.blocksize, frames_remaining)
            payload, overflowed = stream.read(requested)
            chunks.append(bytes(payload))
            overflow_count += int(bool(overflowed))
            frames_remaining -= requested
    with wave.open(str(args.output), "wb") as sink:
        sink.setnchannels(1)
        sink.setsampwidth(2)
        sink.setframerate(args.sample_rate)
        sink.writeframes(b"".join(chunks))
    print(
        f"{args.output.resolve()} frames={frame_count} blocksize={args.blocksize} "
        f"latency={args.latency} overflows={overflow_count}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
