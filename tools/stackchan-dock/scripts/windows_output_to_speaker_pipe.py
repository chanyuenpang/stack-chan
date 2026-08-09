"""Bridge Windows playback captured by Stereo Mix into Stack-chan Wi-Fi speaker PCM."""

from __future__ import annotations

import argparse
from array import array
from collections import deque
from contextlib import ExitStack
import os
from pathlib import Path
import queue
import sys
import time

import sounddevice as sd


INPUT_SAMPLE_RATE = 48_000
OUTPUT_SAMPLE_RATE = 24_000
INPUT_CHANNELS = 2
INPUT_FRAMES_PER_BLOCK = 480
OUTPUT_FRAME_BYTES = 480
DEFAULT_PIPE = r"\\.\pipe\stackchan-wifi-speaker"


class ActivityGate:
    """Suppress steady silence while preserving attack context and speech tails."""

    def __init__(self, threshold: int, pre_roll_frames: int, hangover_frames: int) -> None:
        if threshold < 0 or pre_roll_frames < 0 or hangover_frames < 0:
            raise ValueError("activity gate values must be non-negative")
        self.threshold = threshold
        self.pre_roll = deque(maxlen=pre_roll_frames)
        self.hangover_frames = hangover_frames
        self.hangover_remaining = 0

    def push(self, payload: bytes, peak: int) -> list[bytes]:
        if peak >= self.threshold:
            output = [*self.pre_roll, payload]
            self.pre_roll.clear()
            self.hangover_remaining = self.hangover_frames
            return output
        if self.hangover_remaining > 0:
            self.hangover_remaining -= 1
            return [payload]
        self.pre_roll.append(payload)
        return []


def resolve_input_device(name: str, host_api: str) -> int:
    host_apis = sd.query_hostapis()
    for index, device in enumerate(sd.query_devices()):
        current_host_api = host_apis[device["hostapi"]]["name"]
        if (
            name.lower() in device["name"].lower()
            and current_host_api == host_api
            and device["max_input_channels"] >= INPUT_CHANNELS
        ):
            return index
    raise RuntimeError(f"No {host_api} input device matching {name!r}")


def stereo_48k_to_mono_24k(payload: bytes, gain: float = 1.0) -> tuple[bytes, int]:
    """Downmix stereo and 2:1 decimate with a two-frame boxcar low-pass filter."""
    if gain <= 0:
        raise ValueError("gain must be positive")
    samples = array("h")
    samples.frombytes(payload)
    if sys.byteorder != "little":
        samples.byteswap()
    if len(samples) % 4:
        raise ValueError("48 kHz stereo payload must contain an even number of frames")

    output = array("h")
    clipped = 0
    for index in range(0, len(samples), 4):
        # Average L/R over two adjacent 48 kHz frames.  The temporal average
        # suppresses energy above the new 12 kHz Nyquist limit before decimation.
        value = round((samples[index] + samples[index + 1] + samples[index + 2] + samples[index + 3]) * gain / 4)
        if value > 32767:
            value = 32767
            clipped += 1
        elif value < -32768:
            value = -32768
            clipped += 1
        output.append(value)
    if sys.byteorder != "little":
        output.byteswap()
    return output.tobytes(), clipped


def peak_s16le(payload: bytes) -> int:
    samples = array("h")
    samples.frombytes(payload)
    if sys.byteorder != "little":
        samples.byteswap()
    return max((abs(sample) for sample in samples), default=0)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="立体声混音 (Realtek HD Audio Stereo input)")
    parser.add_argument("--host-api", default="Windows WDM-KS")
    parser.add_argument("--pipe", default=DEFAULT_PIPE)
    parser.add_argument("--gain", type=float, default=2.0)
    parser.add_argument("--gate-threshold", type=int, default=64)
    parser.add_argument("--pre-roll-ms", type=int, default=20)
    parser.add_argument("--hangover-ms", type=int, default=300)
    parser.add_argument("--duration", type=float, help="optional bounded capture duration in seconds")
    parser.add_argument("--capture-pcm", type=Path, default=os.environ.get("STACKCHAN_WIFI_SPEAKER_CAPTURE"))
    args = parser.parse_args()
    if args.gain <= 0:
        parser.error("--gain must be positive")
    if args.duration is not None and args.duration <= 0:
        parser.error("--duration must be positive")
    if args.gate_threshold < 0 or args.pre_roll_ms < 0 or args.hangover_ms < 0:
        parser.error("activity gate values must be non-negative")

    device = resolve_input_device(args.device, args.host_api)
    frames = 0
    overflows = 0
    clipped = 0
    input_peak = 0
    output_peak = 0
    sent_frames = 0
    gated_frames = 0
    started = time.monotonic()
    blocks: queue.Queue[bytes] = queue.Queue(maxsize=64)
    callback_state = {"overflows": 0, "queue_drops": 0}
    gate = ActivityGate(
        threshold=args.gate_threshold,
        pre_roll_frames=round(args.pre_roll_ms / 10),
        hangover_frames=round(args.hangover_ms / 10),
    )

    def on_audio(indata, frames_count, _time_info, status) -> None:
        if frames_count != INPUT_FRAMES_PER_BLOCK:
            callback_state["queue_drops"] += 1
            return
        if status.input_overflow:
            callback_state["overflows"] += 1
        try:
            blocks.put_nowait(bytes(indata))
        except queue.Full:
            callback_state["queue_drops"] += 1

    with ExitStack() as stack:
        capture = stack.enter_context(args.capture_pcm.open("wb")) if args.capture_pcm else None
        pipe = stack.enter_context(open(args.pipe, "wb", buffering=0))
        stream = stack.enter_context(
            sd.RawInputStream(
                device=device,
                samplerate=INPUT_SAMPLE_RATE,
                channels=INPUT_CHANNELS,
                dtype="int16",
                blocksize=INPUT_FRAMES_PER_BLOCK,
                callback=on_audio,
            )
        )
        while args.duration is None or time.monotonic() - started < args.duration:
            try:
                payload = blocks.get(timeout=0.5)
            except queue.Empty:
                continue
            output, block_clipped = stereo_48k_to_mono_24k(payload, args.gain)
            if len(output) != OUTPUT_FRAME_BYTES:
                raise RuntimeError(f"expected {OUTPUT_FRAME_BYTES} output bytes, got {len(output)}")
            block_peak = peak_s16le(payload)
            outgoing = gate.push(output, block_peak)
            for outgoing_frame in outgoing:
                pipe.write(outgoing_frame)
                if capture is not None:
                    capture.write(outgoing_frame)
                sent_frames += 1
            if not outgoing:
                gated_frames += 1
            frames += 1
            overflows = callback_state["overflows"]
            clipped += block_clipped
            input_peak = max(input_peak, block_peak)
            output_peak = max(output_peak, peak_s16le(output))
            if frames == 1 or frames % 500 == 0:
                print(
                    f"Windows speaker bridge frames={frames} input_peak={input_peak} output_peak={output_peak} "
                    f"overflows={overflows} queue_drops={callback_state['queue_drops']} "
                    f"sent_frames={sent_frames} gated_frames={gated_frames} "
                    f"clipped_samples={clipped} stream_active={stream.active}",
                    file=sys.stderr,
                    flush=True,
                )
                input_peak = 0
                output_peak = 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
