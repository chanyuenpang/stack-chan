#!/usr/bin/env python3
"""Measure the continuity of a known test tone in a PCM WAV recording."""

from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path

import numpy as np


def read_mono(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as source:
        if source.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM")
        rate = source.getframerate()
        channels = source.getnchannels()
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2")
    return rate, samples.reshape(-1, channels).astype(np.float64).mean(axis=1)


def frame_view(samples: np.ndarray, size: int, hop: int) -> np.ndarray:
    if len(samples) < size:
        return np.empty((0, size), dtype=np.float64)
    count = 1 + (len(samples) - size) // hop
    return np.lib.stride_tricks.as_strided(
        samples,
        shape=(count, size),
        strides=(samples.strides[0] * hop, samples.strides[0]),
    )


def runs(mask: np.ndarray, start: int = 0, end: int | None = None) -> list[tuple[int, int]]:
    if end is None:
        end = len(mask)
    selected = mask[start:end]
    padded = np.r_[False, selected, False].astype(np.int8)
    edges = np.diff(padded)
    starts = np.where(edges == 1)[0] + start
    ends = np.where(edges == -1)[0] + start
    return list(zip(starts.tolist(), ends.tolist()))


def analyze(path: Path, target_hz: float, max_gap_ms: float, min_tone_burst_ms: float) -> dict:
    rate, samples = read_mono(path)
    frame_ms = 20.0
    hop_ms = 10.0
    size = round(rate * frame_ms / 1000)
    hop = round(rate * hop_ms / 1000)
    frames = frame_view(samples, size, hop)
    if not len(frames):
        raise ValueError(f"{path}: recording is too short")

    window = np.hanning(size)
    oscillator = np.exp(-2j * np.pi * target_hz * np.arange(size) / rate)
    tone_amplitude = np.abs((frames * window) @ oscillator) * 2 / window.sum()
    low = float(np.percentile(tone_amplitude, 10))
    high = float(np.percentile(tone_amplitude, 90))
    threshold = max(5.0, low * 5.0, high * 0.25)
    active = tone_amplitude >= threshold
    qualifying_runs = [
        (start, end)
        for start, end in runs(active)
        if (end - start) * hop_ms >= min_tone_burst_ms
    ]
    if not qualifying_runs:
        raise ValueError(f"{path}: no {target_hz:g} Hz tone segment detected")

    first = qualifying_runs[0][0]
    last = qualifying_runs[-1][1] - 1
    inactive_runs = runs(~active, first, last + 1)
    gaps_ms = [float((end - start) * hop_ms) for start, end in inactive_runs]
    long_gaps = [gap for gap in gaps_ms if gap > max_gap_ms]

    onset_seconds = first * hop / rate
    offset_seconds = (last * hop + size) / rate
    span_seconds = offset_seconds - onset_seconds
    active_seconds = float(active[first : last + 1].sum() * hop / rate)

    segment = samples[first * hop : last * hop + size]
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(len(segment)))) ** 2
    frequencies = np.fft.rfftfreq(len(segment), 1 / rate)
    neighborhood = (frequencies >= max(20, target_hz - 100)) & (frequencies <= target_hz + 100)
    dominant_hz = float(frequencies[np.where(neighborhood)[0][np.argmax(spectrum[neighborhood])]])

    return {
        "path": str(path.resolve()),
        "sample_rate": rate,
        "duration_seconds": float(len(samples) / rate),
        "target_hz": target_hz,
        "dominant_hz_near_target": dominant_hz,
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "tone_threshold_pcm": threshold,
        "tone_onset_seconds": onset_seconds,
        "tone_offset_seconds": offset_seconds,
        "tone_span_seconds": span_seconds,
        "active_seconds_approx": active_seconds,
        "active_duty_fraction": active_seconds / span_seconds,
        "interior_gap_count": len(gaps_ms),
        "interior_gap_durations_ms": gaps_ms,
        "longest_interior_gap_ms": max(gaps_ms, default=0.0),
        "maximum_allowed_gap_ms": max_gap_ms,
        "minimum_tone_burst_ms": min_tone_burst_ms,
        "gaps_over_limit": long_gaps,
        "continuity_pass": not long_gaps,
        "limitations": [
            "This measures acoustic presence of the requested tone, not packet delivery directly.",
            "The recording device must be close enough that the tone is clearly above ambient noise.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("--target-hz", type=float, required=True)
    parser.add_argument("--max-gap-ms", type=float, default=100.0)
    parser.add_argument("--min-tone-burst-ms", type=float, default=100.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = analyze(args.wav, args.target_hz, args.max_gap_ms, args.min_tone_burst_ms)
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
        print(args.output.resolve())
    else:
        print(encoded)


if __name__ == "__main__":
    main()
