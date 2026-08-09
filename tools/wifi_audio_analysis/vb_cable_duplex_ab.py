"""Replay a known 24 kHz WAV through VB-CABLE and capture it synchronously.

This diagnostic intentionally opens the VB-CABLE playback and capture endpoints
in one PortAudio full-duplex stream.  It removes the independent-process timing
and buffering ambiguity from the older player + recorder experiment.
"""

from __future__ import annotations

import argparse
from array import array
import json
from pathlib import Path
import sys
import threading
import wave

import numpy as np
import sounddevice as sd


def resolve_device(name: str, host_api: str, direction: str) -> int:
    channel_key = "max_input_channels" if direction == "input" else "max_output_channels"
    host_apis = sd.query_hostapis()
    for index, device in enumerate(sd.query_devices()):
        current_host_api = host_apis[device["hostapi"]]["name"]
        if (
            name.lower() in device["name"].lower()
            and current_host_api == host_api
            and device[channel_key] >= 1
        ):
            return index
    raise RuntimeError(f"No {host_api} {direction} device matching {name!r}")


def read_24k_mono_s16(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as source:
        actual = (source.getframerate(), source.getnchannels(), source.getsampwidth())
        expected = (24_000, 1, 2)
        if actual != expected:
            raise RuntimeError(f"WAV must be 24 kHz mono s16le; got {actual}")
        return np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").copy()


def streaming_linear_upsample(samples: np.ndarray) -> np.ndarray:
    """Match StreamingLinearUpsampler24kTo48k sample-for-sample."""
    if len(samples) == 0:
        return np.empty(0, dtype=np.int16)
    widened = samples.astype(np.int32)
    result = np.empty(len(samples) * 2, dtype=np.int16)
    result[0::2] = samples
    result[1] = samples[0]
    if len(samples) > 1:
        result[3::2] = np.rint((widened[:-1] + widened[1:]) / 2).astype(np.int16)
    return result


def write_wav(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as sink:
        sink.setnchannels(1)
        sink.setsampwidth(2)
        sink.setframerate(sample_rate)
        sink.writeframes(samples.astype("<i2", copy=False).tobytes())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--playback-device", default="CABLE Input (VB-Audio Virtual Cable)")
    parser.add_argument("--capture-device", default="CABLE Output (VB-Audio Virtual Cable)")
    parser.add_argument("--host-api", default="Windows WASAPI")
    parser.add_argument("--lead-seconds", type=float, default=1.0)
    parser.add_argument("--tail-seconds", type=float, default=2.0)
    args = parser.parse_args()

    if args.lead_seconds < 0 or args.tail_seconds < 0:
        parser.error("lead and tail durations must be non-negative")

    sample_rate = 48_000
    blocksize = 480
    source = streaming_linear_upsample(read_24k_mono_s16(args.source))
    lead = round(args.lead_seconds * sample_rate)
    tail = round(args.tail_seconds * sample_rate)
    playback = np.concatenate(
        (np.zeros(lead, dtype=np.int16), source, np.zeros(tail, dtype=np.int16))
    )
    captured = np.empty_like(playback)
    playback_device = resolve_device(args.playback_device, args.host_api, "output")
    capture_device = resolve_device(args.capture_device, args.host_api, "input")

    cursor = 0
    statuses: list[str] = []
    finished = threading.Event()

    def callback(indata, outdata, frames, time_info, status) -> None:
        nonlocal cursor
        if status:
            statuses.append(str(status))
        remaining = len(playback) - cursor
        count = min(frames, remaining)
        outdata.fill(0)
        if count:
            outdata[:count, 0] = playback[cursor : cursor + count]
            captured[cursor : cursor + count] = indata[:count, 0]
            cursor += count
        if count < frames:
            finished.set()
            raise sd.CallbackStop
        if cursor == len(playback):
            finished.set()
            raise sd.CallbackStop

    with sd.Stream(
        device=(capture_device, playback_device),
        samplerate=sample_rate,
        channels=(1, 1),
        dtype="int16",
        blocksize=blocksize,
        latency="high",
        callback=callback,
    ) as stream:
        if not finished.wait(timeout=len(playback) / sample_rate + 10):
            raise RuntimeError("VB-CABLE duplex capture timed out")
        stream.stop()

    if cursor != len(playback):
        raise RuntimeError(f"capture truncated: expected {len(playback)} samples, got {cursor}")
    write_wav(args.output, captured, sample_rate)
    report = {
        "source": str(args.source.resolve()),
        "output": str(args.output.resolve()),
        "sample_rate": sample_rate,
        "source_samples_24k": len(source) // 2,
        "playback_samples_48k": len(playback),
        "captured_samples_48k": len(captured),
        "lead_samples": lead,
        "tail_samples": tail,
        "playback_device": playback_device,
        "capture_device": capture_device,
        "status_events": statuses,
        "exact_zero_ratio": float(np.mean(captured == 0)),
        "peak": int(np.max(np.abs(captured.astype(np.int32)))),
        "stream_active_after_stop": bool(stream.active),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
