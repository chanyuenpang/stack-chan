#!/usr/bin/env python3
"""Reproducible, dependency-light diagnostics for StackChan Wi-Fi WAV captures."""

from __future__ import annotations

import argparse
import json
import math
import wave
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


BANDS_HZ = ((0, 80), (80, 300), (300, 3400), (3400, 8000), (8000, 20000))


def read_wav(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM, got {wav.getsampwidth() * 8}-bit")
        rate = wav.getframerate()
        channels = wav.getnchannels()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    return rate, samples.reshape(-1, channels)


def frame_view(samples: np.ndarray, size: int, hop: int) -> np.ndarray:
    count = 1 + max(0, (len(samples) - size) // hop)
    if count == 0 or len(samples) < size:
        return np.empty((0, size), dtype=np.float64)
    shape = (count, size)
    strides = (samples.strides[0] * hop, samples.strides[0])
    return np.lib.stride_tricks.as_strided(samples, shape=shape, strides=strides)


def safe_db(value: np.ndarray | float, floor: float = 1e-12) -> np.ndarray | float:
    return 20.0 * np.log10(np.maximum(value, floor))


def top_spectral_peaks(freqs: np.ndarray, power: np.ndarray, count: int = 8) -> list[dict]:
    valid = np.where((freqs >= 20) & (freqs <= 12000))[0]
    order = valid[np.argsort(power[valid])[-count:][::-1]]
    total = float(power.sum()) or 1.0
    return [{"hz": round(float(freqs[i]), 3), "fraction": float(power[i] / total)} for i in order]


def analyze_channel(samples_i16: np.ndarray, rate: int) -> tuple[dict, dict]:
    raw = samples_i16.astype(np.int32)
    samples = raw.astype(np.float64)
    centered = samples - samples.mean()
    abs_values = np.abs(centered)
    peak = float(abs_values.max(initial=0))
    rms = float(np.sqrt(np.mean(centered * centered))) if len(centered) else 0.0

    frame_size = max(1, round(rate * 0.020))
    frame_hop = max(1, round(rate * 0.010))
    energy_frames = frame_view(centered, frame_size, frame_hop)
    frame_rms = np.sqrt(np.mean(energy_frames * energy_frames, axis=1)) if len(energy_frames) else np.array([])
    frame_rms_db = safe_db(frame_rms)

    fft_size = 8192
    fft_hop = 2048
    fft_frames = frame_view(centered, fft_size, fft_hop)
    window = np.hanning(fft_size)
    spectra = np.fft.rfft(fft_frames * window, axis=1) if len(fft_frames) else np.empty((0, fft_size // 2 + 1))
    power_frames = np.abs(spectra) ** 2
    mean_power = power_frames.mean(axis=0) if len(power_frames) else np.zeros(fft_size // 2 + 1)
    freqs = np.fft.rfftfreq(fft_size, 1.0 / rate)
    total_power = float(mean_power.sum()) or 1.0

    band_fractions = {}
    for low, high in BANDS_HZ:
        mask = (freqs >= low) & (freqs < min(high, rate / 2))
        band_fractions[f"{low}-{high}"] = float(mean_power[mask].sum() / total_power)

    positive_power = mean_power[1:]
    positive_freqs = freqs[1:]
    spectral_centroid = float((positive_freqs * positive_power).sum() / max(positive_power.sum(), 1e-12))
    spectral_flatness = float(
        np.exp(np.mean(np.log(np.maximum(positive_power, 1e-30)))) / max(np.mean(positive_power), 1e-30)
    )

    line_bins = np.zeros_like(freqs, dtype=bool)
    bin_tolerance = max(rate / fft_size / 2.0, 1.0)
    for base in (50, 60):
        for harmonic in range(1, 9):
            target = base * harmonic
            line_bins |= np.abs(freqs - target) <= bin_tolerance
    line_noise_fraction = float(mean_power[line_bins].sum() / total_power)

    adjacent_equal = float(np.mean(raw[1:] == raw[:-1])) if len(raw) > 1 else 0.0
    paired_count = len(raw) // 2
    pair_equal = float(np.mean(raw[: paired_count * 2 : 2] == raw[1 : paired_count * 2 : 2])) if paired_count else 0.0
    differences = np.diff(raw)
    zero_runs = []
    if len(raw):
        zero_mask = raw == 0
        padded = np.r_[False, zero_mask, False].astype(np.int8)
        edges = np.diff(padded)
        starts = np.where(edges == 1)[0]
        ends = np.where(edges == -1)[0]
        zero_runs = (ends - starts).tolist()

    digital_silence_frames = frame_rms <= 2.0
    padded_silence = np.r_[False, digital_silence_frames, False].astype(np.int8)
    silence_edges = np.diff(padded_silence)
    silence_starts = np.where(silence_edges == 1)[0]
    silence_ends = np.where(silence_edges == -1)[0]
    silence_runs_seconds = [
        float(((end - start - 1) * frame_hop + frame_size) / rate)
        for start, end in zip(silence_starts, silence_ends)
    ]

    unsigned = raw.astype(np.uint16)
    bit_one_fraction = [float(np.mean(((unsigned >> bit) & 1) != 0)) for bit in range(16)]
    trailing_zero_count = []
    nonzero_abs = np.abs(raw[raw != 0]).astype(np.uint32)
    if len(nonzero_abs):
        for value in nonzero_abs:
            trailing_zero_count.append(int((int(value) & -int(value)).bit_length() - 1))

    highest_index = int(np.argmax(frame_rms)) if len(frame_rms) else 0
    highest_frame = energy_frames[highest_index] if len(energy_frames) else np.array([])
    periodicity = 0.0
    periodicity_hz = 0.0
    if len(highest_frame):
        highest_frame = highest_frame - highest_frame.mean()
        autocorr = np.correlate(highest_frame, highest_frame, mode="full")[len(highest_frame) - 1 :]
        min_lag = max(1, rate // 400)
        max_lag = min(len(autocorr) - 1, rate // 70)
        if max_lag > min_lag and autocorr[0] > 0:
            lag = min_lag + int(np.argmax(autocorr[min_lag : max_lag + 1]))
            periodicity = float(autocorr[lag] / autocorr[0])
            periodicity_hz = float(rate / lag)

    metrics = {
        "sample_count": int(len(raw)),
        "dc_mean": float(samples.mean()),
        "peak": peak,
        "rms": rms,
        "crest_factor_db": float(safe_db(peak / max(rms, 1e-12))),
        "absolute_percentiles": {str(p): float(np.percentile(abs_values, p)) for p in (50, 90, 95, 99, 99.9)},
        "clipped_fraction": float(np.mean(np.abs(raw) >= 32767)),
        "frame_rms_db_percentiles": {str(p): float(np.percentile(frame_rms_db, p)) for p in (5, 10, 50, 90, 95)} if len(frame_rms_db) else {},
        "frame_dynamic_range_p95_p10_db": float(np.percentile(frame_rms_db, 95) - np.percentile(frame_rms_db, 10)) if len(frame_rms_db) else 0.0,
        "adjacent_equal_fraction": adjacent_equal,
        "even_odd_pair_equal_fraction": pair_equal,
        "difference_rms": float(np.sqrt(np.mean(differences.astype(np.float64) ** 2))) if len(differences) else 0.0,
        "longest_zero_run_samples": int(max(zero_runs, default=0)),
        "digital_silence_frame_threshold_rms": 2.0,
        "digital_silence_frame_fraction": float(np.mean(digital_silence_frames)) if len(digital_silence_frames) else 0.0,
        "digital_silence_run_count": int(len(silence_runs_seconds)),
        "digital_silence_longest_run_seconds": float(max(silence_runs_seconds, default=0.0)),
        "digital_silence_total_run_seconds": float(sum(silence_runs_seconds)),
        "bit_one_fraction_lsb_to_msb": bit_one_fraction,
        "trailing_zero_percentiles": {str(p): float(np.percentile(trailing_zero_count, p)) for p in (50, 90, 99)} if trailing_zero_count else {},
        "low_byte_unique_values": int(len(np.unique(unsigned & 0xFF))),
        "high_byte_unique_values": int(len(np.unique(unsigned >> 8))),
        "spectral_centroid_hz": spectral_centroid,
        "spectral_flatness": spectral_flatness,
        "band_power_fraction": band_fractions,
        "mains_50_60_harmonics_fraction": line_noise_fraction,
        "top_spectral_peaks": top_spectral_peaks(freqs, mean_power),
        "strongest_frame_periodicity": periodicity,
        "strongest_frame_periodicity_hz": periodicity_hz,
    }
    arrays = {
        "centered": centered,
        "frame_rms": frame_rms,
        "mean_power": mean_power,
        "freqs": freqs,
        "power_frames": power_frames,
        "fft_hop": fft_hop,
        "fft_size": fft_size,
    }
    return metrics, arrays


def render_diagnostic(path: Path, rate: int, metrics: dict, arrays: dict, output_path: Path) -> None:
    centered = arrays["centered"]
    frame_rms = arrays["frame_rms"]
    freqs = arrays["freqs"]
    mean_power = arrays["mean_power"]
    power_frames = arrays["power_frames"]
    fft_hop = arrays["fft_hop"]

    fig, axes = plt.subplots(4, 1, figsize=(14, 13), constrained_layout=True)
    time = np.arange(len(centered)) / rate
    axes[0].plot(time, centered, linewidth=0.25, color="#205493")
    axes[0].set(title=f"{path.name}: centered waveform", xlabel="Time (s)", ylabel="PCM")

    frame_time = np.arange(len(frame_rms)) * 0.010
    axes[1].plot(frame_time, safe_db(frame_rms), linewidth=0.8, color="#2e8540")
    axes[1].set(title="20 ms short-time RMS", xlabel="Time (s)", ylabel="dBFS-like (relative PCM)")

    if len(power_frames):
        spec_db = 10.0 * np.log10(np.maximum(power_frames.T, 1e-20))
        upper = min(8000, rate / 2)
        freq_mask = freqs <= upper
        extent = (0, len(centered) / rate, 0, upper)
        axes[2].imshow(spec_db[freq_mask], origin="lower", aspect="auto", extent=extent, cmap="magma", vmin=np.percentile(spec_db, 10), vmax=np.percentile(spec_db, 99))
    axes[2].set(title="Spectrogram", xlabel="Time (s)", ylabel="Frequency (Hz)")

    spectrum_db = 10.0 * np.log10(np.maximum(mean_power, 1e-20))
    axes[3].semilogx(freqs[1:], spectrum_db[1:], linewidth=0.8, color="#a61c00")
    axes[3].axvspan(300, 3400, color="#fdb81e", alpha=0.15, label="speech band")
    axes[3].set(title="Mean power spectrum", xlabel="Frequency (Hz)", ylabel="Power (dB)", xlim=(20, min(20000, rate / 2)))
    axes[3].legend(loc="best")

    fig.suptitle(
        f"RMS={metrics['rms']:.2f}, DR95-10={metrics['frame_dynamic_range_p95_p10_db']:.2f} dB, "
        f"flatness={metrics['spectral_flatness']:.4f}",
        fontsize=11,
    )
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def analyze_file(path: Path, output_dir: Path) -> dict:
    rate, channels = read_wav(path)
    channel_results = []
    plot_paths = []
    arrays_per_channel = []
    for index in range(channels.shape[1]):
        metrics, arrays = analyze_channel(channels[:, index], rate)
        channel_results.append(metrics)
        arrays_per_channel.append(arrays)
        plot_path = output_dir / f"{path.stem}-ch{index}-diagnostic.png"
        render_diagnostic(path, rate, metrics, arrays, plot_path)
        plot_paths.append(str(plot_path))

    channel_correlation = None
    channel_equal_fraction = None
    if channels.shape[1] >= 2:
        left = channels[:, 0].astype(np.float64)
        right = channels[:, 1].astype(np.float64)
        channel_correlation = float(np.corrcoef(left, right)[0, 1])
        channel_equal_fraction = float(np.mean(left == right))

    return {
        "path": str(path),
        "sample_rate": rate,
        "channels": int(channels.shape[1]),
        "frames": int(channels.shape[0]),
        "duration_seconds": float(channels.shape[0] / rate),
        "channel_correlation_0_1": channel_correlation,
        "channel_equal_fraction_0_1": channel_equal_fraction,
        "channel_metrics": channel_results,
        "diagnostic_plots": plot_paths,
        "limitations": [
            "Metrics describe only the supplied WAV; infer acquisition, transport, resampling, or virtual-device stages from the recording provenance stored with that run.",
            "Reference-based intelligibility metrics such as STOI and PESQ are invalid without a time-aligned clean reference recording.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", nargs="+", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    results = [analyze_file(path.resolve(), args.output_dir.resolve()) for path in args.wav]
    report_path = args.output_dir / "waveform-analysis.json"
    report_path.write_text(json.dumps({"files": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report_path.resolve())


if __name__ == "__main__":
    main()
