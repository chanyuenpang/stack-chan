"""Stream a 24 kHz mono PCM WAV or generated tone to the local Dock speaker pipe."""

from __future__ import annotations

import argparse
from array import array
import math
from pathlib import Path
import struct
import sys
import time
import wave


SAMPLE_RATE = 24_000
SAMPLES_PER_FRAME = 240
FRAME_BYTES = SAMPLES_PER_FRAME * 2
DEFAULT_PIPE = r"\\.\pipe\stackchan-wifi-speaker"


def apply_gain(pcm: bytes, gain: float) -> tuple[bytes, int]:
    if gain <= 0:
        raise ValueError("gain must be positive")
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    clipped = 0
    for index, sample in enumerate(samples):
        value = round(sample * gain)
        if value > 32767:
            value = 32767
            clipped += 1
        elif value < -32768:
            value = -32768
            clipped += 1
        samples[index] = value
    if sys.byteorder != "little":
        samples.byteswap()
    return samples.tobytes(), clipped


def read_wav(path: Path, gain: float = 1.0) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as source:
        actual = (source.getframerate(), source.getnchannels(), source.getsampwidth())
        expected = (SAMPLE_RATE, 1, 2)
        if actual != expected:
            raise ValueError(f"WAV must be 24 kHz mono s16le; got rate/channels/bytes={actual}")
        return apply_gain(source.readframes(source.getnframes()), gain)


def make_tone(frequency: float, duration: float, amplitude: float = 0.2) -> bytes:
    sample_count = round(SAMPLE_RATE * duration)
    peak = round(32767 * amplitude)
    return b"".join(
        struct.pack("<h", round(peak * math.sin(2 * math.pi * frequency * index / SAMPLE_RATE)))
        for index in range(sample_count)
    )


def stream(pipe: str, pcm: bytes) -> None:
    started = time.monotonic()
    frame_count = (len(pcm) + FRAME_BYTES - 1) // FRAME_BYTES
    with open(pipe, "wb", buffering=0) as sink:
        for index in range(frame_count):
            frame = pcm[index * FRAME_BYTES:(index + 1) * FRAME_BYTES]
            sink.write(frame.ljust(FRAME_BYTES, b"\0"))
            deadline = started + (index + 1) * 0.010
            delay = deadline - time.monotonic()
            if delay > 0:
                time.sleep(delay)


def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--wav", type=Path)
    source.add_argument("--tone", type=float, metavar="HZ")
    parser.add_argument("--duration", type=float, default=2.0)
    parser.add_argument("--amplitude", type=float, default=0.2)
    parser.add_argument("--gain", type=float, default=1.0)
    parser.add_argument("--pipe", default=DEFAULT_PIPE)
    args = parser.parse_args()
    if args.duration <= 0:
        parser.error("--duration must be positive")
    if not 0 < args.amplitude <= 1:
        parser.error("--amplitude must be in the range (0, 1]")
    if args.gain <= 0:
        parser.error("--gain must be positive")
    if args.wav:
        pcm, clipped = read_wav(args.wav, args.gain)
        print(f"WAV gain={args.gain:.2f} clipped_samples={clipped}", file=sys.stderr)
    else:
        pcm, clipped = apply_gain(make_tone(args.tone, args.duration, args.amplitude), args.gain)
    stream(args.pipe, pcm)


if __name__ == "__main__":
    main()
