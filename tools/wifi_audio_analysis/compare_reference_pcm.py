#!/usr/bin/env python3
"""Compare mono s16le PCM against its clean source with alignment and scale checks."""

from __future__ import annotations

import argparse
import array
import json
import math
import wave
from pathlib import Path


def read_s16le(path: Path) -> array.array:
    payload = path.read_bytes()
    if not payload or len(payload) % 2:
        raise ValueError(f"{path} must contain non-empty mono s16le PCM")
    samples = array.array("h")
    samples.frombytes(payload)
    return samples


def read_source(path: Path, sample_rate: int) -> array.array:
    if path.suffix.lower() != ".wav":
        return read_s16le(path)
    with wave.open(str(path), "rb") as source:
        actual = (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype())
        expected = (1, 2, sample_rate, "NONE")
        if actual != expected:
            raise ValueError(
                f"{path} must be uncompressed mono s16 WAV at {sample_rate} Hz; got "
                f"channels={actual[0]} width={actual[1]} rate={actual[2]} compression={actual[3]}"
            )
        payload = source.readframes(source.getnframes())
    samples = array.array("h")
    samples.frombytes(payload)
    if not samples:
        raise ValueError(f"{path} must contain non-empty mono s16 WAV audio")
    return samples


def rms_envelope(samples: array.array, window: int) -> list[float]:
    return [
        math.sqrt(sum(value * value for value in samples[start : start + window]) / window)
        for start in range(0, len(samples) - window + 1, window)
    ]


def correlation(left: list[float] | array.array, right: list[float] | array.array) -> float:
    count = min(len(left), len(right))
    if count < 2:
        return 0.0
    left = left[:count]
    right = right[:count]
    left_mean = sum(left) / count
    right_mean = sum(right) / count
    left_energy = sum((value - left_mean) ** 2 for value in left)
    right_energy = sum((value - right_mean) ** 2 for value in right)
    if not left_energy or not right_energy:
        return 0.0
    covariance = sum(
        (left[index] - left_mean) * (right[index] - right_mean)
        for index in range(count)
    )
    return covariance / math.sqrt(left_energy * right_energy)


def stretch(values: list[float], scale: float) -> list[float]:
    output = []
    for index in range(round(len(values) * scale)):
        position = index / scale
        left = min(int(position), len(values) - 1)
        right = min(left + 1, len(values) - 1)
        fraction = position - left
        output.append(values[left] * (1 - fraction) + values[right] * fraction)
    return output


def find_envelope_mapping(
    source: list[float], candidate: list[float], minimum_scale: float, maximum_scale: float
) -> tuple[float, float, int]:
    best = (-2.0, 1.0, 0)
    first = round(minimum_scale * 1000)
    last = round(maximum_scale * 1000)
    for permille in range(first, last + 1):
        scale = permille / 1000
        mapped = stretch(source, scale)
        if len(mapped) > len(candidate):
            continue
        for lag in range(len(candidate) - len(mapped) + 1):
            score = correlation(mapped, candidate[lag : lag + len(mapped)])
            if score > best[0]:
                best = (score, scale, lag)
    return best


def compare(
    source: array.array,
    candidate: array.array,
    sample_rate: int,
    minimum_scale: float = 0.98,
    maximum_scale: float = 1.02,
) -> dict[str, object]:
    window = sample_rate // 100
    source_envelope = rms_envelope(source, window)
    candidate_envelope = rms_envelope(candidate, window)
    envelope_correlation, time_scale, lag_windows = find_envelope_mapping(
        source_envelope, candidate_envelope, minimum_scale, maximum_scale
    )
    if time_scale != 1.0:
        mapped_source = array.array(
            "h",
            (
                round(
                    source[min(int(index / time_scale), len(source) - 1)]
                )
                for index in range(round(len(source) * time_scale))
            ),
        )
    else:
        mapped_source = source

    base_offset = lag_windows * window
    decimation = max(1, sample_rate // 4_000)
    best_sample = (-2.0, base_offset)
    max_offset = max(0, len(candidate) - len(mapped_source))
    for offset in range(max(0, base_offset - 2 * window), min(max_offset, base_offset + 2 * window) + 1):
        left = mapped_source[::decimation]
        right = candidate[offset : offset + len(mapped_source) : decimation]
        count = min(len(left), len(right))
        left = left[:count]
        right = right[:count]
        dot = sum(left[index] * right[index] for index in range(count))
        left_energy = sum(value * value for value in left)
        right_energy = sum(value * value for value in right)
        score = dot / math.sqrt(left_energy * right_energy) if left_energy and right_energy else 0.0
        if score > best_sample[0]:
            best_sample = (score, offset)

    sample_correlation, offset = best_sample
    count = min(len(mapped_source), len(candidate) - offset)
    aligned_source = mapped_source[:count]
    aligned_candidate = candidate[offset : offset + count]
    source_energy = sum(value * value for value in aligned_source)
    gain = (
        sum(aligned_source[index] * aligned_candidate[index] for index in range(count))
        / source_energy
        if source_energy
        else 0.0
    )
    signal_energy = sum((gain * value) ** 2 for value in aligned_source)
    residual_energy = sum(
        (aligned_candidate[index] - gain * aligned_source[index]) ** 2
        for index in range(count)
    )
    fitted_snr_db = (
        10 * math.log10(signal_energy / residual_energy)
        if residual_energy and signal_energy
        else 120.0
    )
    source_zero_ratio = sum(value == 0 for value in aligned_source) / count
    candidate_zero_ratio = sum(value == 0 for value in aligned_candidate) / count
    source_adjacent_equal_ratio = sum(
        aligned_source[index] == aligned_source[index - 1] for index in range(1, count)
    ) / (count - 1)
    candidate_adjacent_equal_ratio = sum(
        aligned_candidate[index] == aligned_candidate[index - 1] for index in range(1, count)
    ) / (count - 1)
    checks = {
        "time_scale_0_995_to_1_005": 0.995 <= time_scale <= 1.005,
        "envelope_correlation_gte_0_95": envelope_correlation >= 0.95,
        "sample_correlation_gte_0_90": sample_correlation >= 0.90,
        "fitted_snr_db_gte_8": fitted_snr_db >= 8.0,
        "candidate_zero_growth_lte_0_05": candidate_zero_ratio <= source_zero_ratio + 0.05,
        "candidate_adjacent_equal_growth_lte_0_05": (
            candidate_adjacent_equal_ratio <= source_adjacent_equal_ratio + 0.05
        ),
    }
    return {
        "pass": all(checks.values()),
        "checks": checks,
        "sample_rate": sample_rate,
        "source_samples": len(source),
        "candidate_samples": len(candidate),
        "aligned_samples": count,
        "offset_samples": offset,
        "offset_ms": offset * 1000 / sample_rate,
        "time_scale": time_scale,
        "envelope_correlation": envelope_correlation,
        "sample_correlation": sample_correlation,
        "fitted_gain": gain,
        "fitted_snr_db": fitted_snr_db,
        "source_peak": max(abs(value) for value in aligned_source),
        "candidate_peak": max(abs(value) for value in aligned_candidate),
        "source_zero_ratio": source_zero_ratio,
        "candidate_zero_ratio": candidate_zero_ratio,
        "source_adjacent_equal_ratio": source_adjacent_equal_ratio,
        "candidate_adjacent_equal_ratio": candidate_adjacent_equal_ratio,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--sample-rate", type=int, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.sample_rate <= 0 or args.sample_rate % 100:
        parser.error("sample rate must be positive and divisible by 100")
    result = compare(read_source(args.source, args.sample_rate), read_s16le(args.candidate), args.sample_rate)
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
