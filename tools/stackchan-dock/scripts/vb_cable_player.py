"""Write Stack-chan 24 kHz mono PCM to VB-CABLE's native WASAPI input."""

import argparse
from array import array
from contextlib import ExitStack
import os
from pathlib import Path
import sys
import wave

import sounddevice as sd

from pcm_resample import StreamingLinearUpsampler24kTo48k


def resolve_device(name: str, host_api: str) -> int:
    host_apis = sd.query_hostapis()
    for index, device in enumerate(sd.query_devices()):
        current_host_api = host_apis[device["hostapi"]]["name"]
        if (
            name.lower() in device["name"].lower()
            and current_host_api == host_api
            and device["max_output_channels"] >= 1
        ):
            return index
    raise RuntimeError(f"No {host_api} playback device matching {name!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="CABLE Input (VB-Audio Virtual Cable)")
    parser.add_argument("--host-api", default="Windows WASAPI")
    parser.add_argument("--capture-pcm", default=os.environ.get("STACKCHAN_WIFI_PCM_CAPTURE"))
    parser.add_argument("--wav", type=Path, help="Read 24 kHz mono s16le PCM from a WAV file instead of stdin")
    parser.add_argument("--latency", choices=("low", "high"), default="low")
    args = parser.parse_args()
    device = resolve_device(args.device, args.host_api)
    input_frame_bytes = 480  # 24 kHz * 10 ms * 16-bit mono
    frames = 0
    underflows = 0
    window_peak = 0
    upsampler = StreamingLinearUpsampler24kTo48k()
    with ExitStack() as stack:
        if args.wav:
            wav = stack.enter_context(wave.open(str(args.wav), "rb"))
            actual = (wav.getframerate(), wav.getnchannels(), wav.getsampwidth())
            expected = (24_000, 1, 2)
            if actual != expected:
                raise RuntimeError(f"WAV must be 24 kHz mono s16le; got rate/channels/bytes={actual}")
            read_payload = lambda: wav.readframes(input_frame_bytes // 2)
        else:
            read_payload = lambda: sys.stdin.buffer.read(input_frame_bytes)
        capture = stack.enter_context(Path(args.capture_pcm).open("wb")) if args.capture_pcm else None
        stream = stack.enter_context(
            sd.RawOutputStream(
                device=device,
                samplerate=48000,
                channels=1,
                dtype="int16",
                blocksize=480,
                latency=args.latency,
            )
        )
        while payload := read_payload():
            if len(payload) != input_frame_bytes:
                raise RuntimeError(f"truncated PCM frame: expected {input_frame_bytes}, got {len(payload)}")
            if capture is not None:
                capture.write(payload)
            samples = array("h")
            samples.frombytes(payload)
            window_peak = max(window_peak, max((abs(sample) for sample in samples), default=0))
            underflows += int(bool(stream.write(upsampler.process(payload))))
            frames += 1
            if frames == 1 or frames % 500 == 0:
                print(
                    f"VB-CABLE frames={frames} input_peak={window_peak} "
                    f"underflows={underflows} stream_active={stream.active} latency={args.latency}",
                    file=sys.stderr,
                    flush=True,
                )
                window_peak = 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
