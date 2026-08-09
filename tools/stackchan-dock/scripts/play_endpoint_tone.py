"""Play a bounded diagnostic tone to one explicit Windows output endpoint."""

from __future__ import annotations

import argparse
import math
import struct
import time

import sounddevice as sd


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device-index", type=int, required=True)
    parser.add_argument("--frequency", type=float, default=660.0)
    parser.add_argument("--duration", type=float, default=3.0)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--sample-rate", type=int, default=48_000)
    parser.add_argument("--amplitude", type=float, default=0.18)
    args = parser.parse_args()
    if args.frequency <= 0 or args.duration <= 0 or args.delay < 0:
        parser.error("frequency and duration must be positive; delay must be non-negative")
    if args.sample_rate <= 0 or not 0 < args.amplitude <= 1:
        parser.error("sample-rate must be positive and amplitude must be in (0, 1]")
    time.sleep(args.delay)
    peak = round(32767 * args.amplitude)
    payload = b"".join(
        struct.pack(
            "<hh",
            round(peak * math.sin(2 * math.pi * args.frequency * index / args.sample_rate)),
            round(peak * math.sin(2 * math.pi * args.frequency * index / args.sample_rate)),
        )
        for index in range(round(args.duration * args.sample_rate))
    )
    with sd.RawOutputStream(
        device=args.device_index,
        samplerate=args.sample_rate,
        channels=2,
        dtype="int16",
        blocksize=480,
    ) as stream:
        stream.write(payload)


if __name__ == "__main__":
    main()
