#!/usr/bin/env python3
"""Extract validated mono s16 PCM from a WAV fixture without resampling."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from compare_reference_pcm import read_source


def extract(source: Path, output: Path, sample_rate: int) -> int:
    samples = read_source(source, sample_rate)
    payload = samples.tobytes()
    if sys.byteorder != "little":
        samples.byteswap()
        payload = samples.tobytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    return len(samples)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample-rate", type=int, required=True)
    args = parser.parse_args()
    if args.sample_rate <= 0:
        parser.error("sample rate must be positive")
    samples = extract(args.source, args.output, args.sample_rate)
    print(f"extracted_samples={samples} output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
