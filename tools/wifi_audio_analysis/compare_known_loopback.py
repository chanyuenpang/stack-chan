"""Compare a captured 48 kHz VB-CABLE loopback with a known 24 kHz WAV."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import wave

import numpy as np


def read_mono_s16(path: Path, expected_rate: int) -> np.ndarray:
    with wave.open(str(path), "rb") as source:
        actual = (source.getframerate(), source.getnchannels(), source.getsampwidth())
        expected = (expected_rate, 1, 2)
        if actual != expected:
            raise RuntimeError(f"Expected WAV {expected}, got {actual}: {path}")
        return np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").copy()


def streaming_linear_upsample(samples: np.ndarray) -> np.ndarray:
    if len(samples) == 0:
        return np.empty(0, dtype=np.int16)
    widened = samples.astype(np.int32)
    result = np.empty(len(samples) * 2, dtype=np.int16)
    result[0::2] = samples
    result[1] = samples[0]
    if len(samples) > 1:
        result[3::2] = np.rint((widened[:-1] + widened[1:]) / 2).astype(np.int16)
    return result


def cross_correlate_full(left: np.ndarray, right: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    size = len(left) + len(right) - 1
    fft_size = 1 << (size - 1).bit_length()
    values = np.fft.irfft(
        np.fft.rfft(left, fft_size) * np.fft.rfft(right[::-1], fft_size),
        fft_size,
    )[:size]
    lags = np.arange(-(len(right) - 1), len(left))
    return values, lags


def compare(source_24k: np.ndarray, capture_48k: np.ndarray, trim_seconds: float) -> dict:
    source = streaming_linear_upsample(source_24k).astype(np.float64)
    capture = capture_48k.astype(np.float64)
    trim = round(trim_seconds * 48_000)
    if trim < 0 or trim * 2 >= len(source):
        raise RuntimeError("trim must leave a non-empty source reference")

    reference = source[trim : len(source) - trim]
    correlation, lags = cross_correlate_full(capture - capture.mean(), reference - reference.mean())
    peak_index = int(np.argmax(np.abs(correlation)))
    reference_lag = int(lags[peak_index])
    source_start = reference_lag - trim

    capture_start = max(0, source_start)
    source_offset = max(0, -source_start)
    aligned_count = min(len(source) - source_offset, len(capture) - capture_start)
    edge = min(round(0.5 * 48_000), max(0, aligned_count // 20))
    aligned_source = source[source_offset + edge : source_offset + aligned_count - edge]
    aligned_capture = capture[capture_start + edge : capture_start + aligned_count - edge]
    if not len(aligned_source):
        raise RuntimeError("capture and source do not overlap after alignment")

    active = np.abs(aligned_source) > 100
    design = np.vstack((aligned_source[active], np.ones(int(active.sum())))).T
    gain, offset = np.linalg.lstsq(design, aligned_capture[active], rcond=None)[0]
    residual = aligned_capture - (gain * aligned_source + offset)
    signal_rms = float(np.sqrt(np.mean((gain * aligned_source) ** 2)))
    residual_rms = float(np.sqrt(np.mean(residual**2)))
    snr_db = float(20 * np.log10((signal_rms + 1e-12) / (residual_rms + 1e-12)))
    sample_correlation = float(np.corrcoef(aligned_source, aligned_capture)[0, 1])
    source_zero_ratio = float(np.mean(aligned_source == 0))
    capture_zero_ratio = float(np.mean(aligned_capture == 0))

    checks = {
        "source_start_in_capture": bool(source_start >= 0),
        "sample_correlation_gte_0_999": bool(sample_correlation >= 0.999),
        "gain_between_0_98_and_1_02": bool(0.98 <= gain <= 1.02),
        "snr_db_gte_50": bool(snr_db >= 50),
        "added_exact_zero_ratio_lte_0_001": bool(
            capture_zero_ratio - source_zero_ratio <= 0.001
        ),
    }
    return {
        "sample_rate": 48_000,
        "source_start_sample": source_start,
        "source_start_ms": source_start / 48,
        "aligned_samples": len(aligned_source),
        "sample_correlation": sample_correlation,
        "gain": float(gain),
        "offset": float(offset),
        "signal_rms": signal_rms,
        "residual_rms": residual_rms,
        "snr_db": snr_db,
        "source_exact_zero_ratio": source_zero_ratio,
        "capture_exact_zero_ratio": capture_zero_ratio,
        "added_exact_zero_ratio": capture_zero_ratio - source_zero_ratio,
        "source_peak": int(np.max(np.abs(aligned_source))),
        "capture_peak": int(np.max(np.abs(aligned_capture))),
        "checks": checks,
        "passed": all(checks.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--trim-seconds", type=float, default=1.0)
    parser.add_argument("--require-pass", action="store_true")
    args = parser.parse_args()

    report = compare(
        read_mono_s16(args.source, 24_000),
        read_mono_s16(args.capture, 48_000),
        args.trim_seconds,
    )
    payload = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload)
    return int(args.require_pass and not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
