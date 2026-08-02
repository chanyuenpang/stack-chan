import json
import math
import time

import numpy as np
import sounddevice as sd


DURATION_SECONDS = 15.0
OUTPUT_SAMPLE_RATE = 24_000
INPUT_SAMPLE_RATE = 48_000
TONE_HZ = 440.0
TONE_AMPLITUDE = 0.02


def find_stackchan_devices():
    hostapis = sd.query_hostapis()
    devices = sd.query_devices()
    wasapi_hosts = {
        index for index, host in enumerate(hostapis)
        if "WASAPI" in host["name"].upper()
    }
    inputs = [
        index for index, device in enumerate(devices)
        if device["hostapi"] in wasapi_hosts
        and "Stack-chan USB Audio" in device["name"]
        and device["max_input_channels"] >= 2
    ]
    outputs = [
        index for index, device in enumerate(devices)
        if device["hostapi"] in wasapi_hosts
        and "Stack-chan USB Audio" in device["name"]
        and device["max_output_channels"] >= 1
    ]
    if len(inputs) != 1 or len(outputs) != 1:
        raise RuntimeError(
            f"expected one Stack-chan WASAPI input/output, got inputs={inputs}, outputs={outputs}"
        )
    return inputs[0], outputs[0], devices


input_frames = 0
input_nonzero = 0
input_peak = 0.0
input_square_sum = 0.0
status_messages = []
phase = 0.0


def input_callback(indata, frames, _time_info, status):
    global input_frames, input_nonzero, input_peak, input_square_sum
    if status:
        status_messages.append(f"input:{status}")
    absolute = np.abs(indata)
    input_frames += frames
    input_nonzero += int(np.count_nonzero(indata))
    input_peak = max(input_peak, float(np.max(absolute, initial=0.0)))
    input_square_sum += float(np.sum(np.square(indata, dtype=np.float64)))


def output_callback(outdata, frames, _time_info, status):
    global phase
    if status:
        status_messages.append(f"output:{status}")
    step = 2.0 * math.pi * TONE_HZ / OUTPUT_SAMPLE_RATE
    positions = phase + step * np.arange(frames, dtype=np.float64)
    outdata[:, 0] = (TONE_AMPLITUDE * np.sin(positions)).astype(np.float32)
    phase = float((phase + step * frames) % (2.0 * math.pi))


input_device, output_device, all_devices = find_stackchan_devices()
input_name = all_devices[input_device]["name"]
output_name = all_devices[output_device]["name"]

with sd.InputStream(
    device=input_device,
    samplerate=INPUT_SAMPLE_RATE,
    channels=2,
    dtype="float32",
    callback=input_callback,
) as input_stream, sd.OutputStream(
    device=output_device,
    samplerate=OUTPUT_SAMPLE_RATE,
    channels=1,
    dtype="float32",
    callback=output_callback,
) as output_stream:
    print(json.dumps({
        "event": "audio_started",
        "input": input_name,
        "output": output_name,
        "input_active": input_stream.active,
        "output_active": output_stream.active,
    }, ensure_ascii=False), flush=True)
    started_at = time.monotonic()
    sd.sleep(round(DURATION_SECONDS * 1000))
    elapsed = time.monotonic() - started_at

sample_count = input_frames * 2
rms = math.sqrt(input_square_sum / sample_count) if sample_count else 0.0
print(json.dumps({
    "event": "audio_complete",
    "elapsed_seconds": elapsed,
    "input_frames": input_frames,
    "nonzero_samples": input_nonzero,
    "peak": input_peak,
    "rms": rms,
    "status_messages": status_messages,
}, ensure_ascii=False), flush=True)
