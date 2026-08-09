"""Generate comparable 48 kHz WAV files from one raw 24 kHz PCM capture."""

import argparse
import hashlib
from pathlib import Path
import wave

from pcm_resample import RESAMPLERS


def write_wave(path: Path, payload: bytes) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(48_000)
        output.writeframes(payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="raw 24 kHz, 16-bit, mono little-endian PCM")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    source = args.input.read_bytes()
    if not source or len(source) % 2:
        raise ValueError("input must contain complete 16-bit PCM samples")
    output_dir = args.output_dir or args.input.parent / f"{args.input.stem}-ab"
    output_dir.mkdir(parents=True, exist_ok=True)
    duration = len(source) / 2 / 24_000
    for name, resampler in RESAMPLERS.items():
        output_path = output_dir / f"{args.input.stem}-{name}-48k.wav"
        result = resampler(source)
        write_wave(output_path, result)
        digest = hashlib.sha256(result).hexdigest()
        print(f"{name}: {output_path} duration={duration:.3f}s pcm_sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
