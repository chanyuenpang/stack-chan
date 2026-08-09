"""Fixed-ratio PCM resamplers used by Stack-chan Wi-Fi audio diagnostics."""

from array import array
import math
import sys
from collections.abc import Callable


def _decode_pcm16(payload: bytes) -> array:
    if len(payload) % 2:
        raise ValueError("PCM payload must contain complete 16-bit samples")
    result = array("h")
    result.frombytes(payload)
    if sys.byteorder != "little":
        result.byteswap()
    return result


def _encode_pcm16(samples: array) -> bytes:
    if sys.byteorder == "little":
        return samples.tobytes()
    result = array("h", samples)
    result.byteswap()
    return result.tobytes()


def upsample_duplicate_24k_to_48k(payload: bytes) -> bytes:
    """Reproduce the current zero-order-hold behavior exactly."""
    source = _decode_pcm16(payload)
    output = array("h")
    for sample in source:
        output.append(sample)
        output.append(sample)
    return _encode_pcm16(output)


def upsample_linear_24k_to_48k(payload: bytes) -> bytes:
    """Insert a linear midpoint after each input sample."""
    source = _decode_pcm16(payload)
    output = array("h")
    for index, sample in enumerate(source):
        next_sample = source[index + 1] if index + 1 < len(source) else sample
        output.append(sample)
        output.append(round((sample + next_sample) / 2))
    return _encode_pcm16(output)


class StreamingLinearUpsampler24kTo48k:
    """Causal 2x linear interpolation that stays continuous across frames."""

    def __init__(self) -> None:
        self._previous: int | None = None

    def process(self, payload: bytes) -> bytes:
        source = _decode_pcm16(payload)
        output = array("h")
        previous = self._previous
        for sample in source:
            if previous is None:
                output.extend((sample, sample))
            else:
                output.append(round((previous + sample) / 2))
                output.append(sample)
            previous = sample
        self._previous = previous
        return _encode_pcm16(output)


def _half_sample_coefficients(radius: int = 16) -> tuple[tuple[int, ...], tuple[float, ...]]:
    offsets = tuple(range(-radius + 1, radius + 1))
    coefficients = []
    for offset in offsets:
        distance = 0.5 - offset
        sinc = math.sin(math.pi * distance) / (math.pi * distance)
        ratio = abs(distance) / radius
        window = 0.42 + 0.5 * math.cos(math.pi * ratio) + 0.08 * math.cos(2 * math.pi * ratio)
        coefficients.append(sinc * window)
    total = sum(coefficients)
    return offsets, tuple(value / total for value in coefficients)


_SINC_OFFSETS, _SINC_COEFFICIENTS = _half_sample_coefficients()


def upsample_sinc_polyphase_24k_to_48k(payload: bytes) -> bytes:
    """Use a windowed-sinc half-sample phase for band-limited 2x interpolation."""
    source = _decode_pcm16(payload)
    if not source:
        return b""
    output = array("h")
    last = len(source) - 1
    for index, sample in enumerate(source):
        midpoint = 0.0
        for offset, coefficient in zip(_SINC_OFFSETS, _SINC_COEFFICIENTS):
            source_index = min(last, max(0, index + offset))
            midpoint += source[source_index] * coefficient
        output.append(sample)
        output.append(max(-32768, min(32767, round(midpoint))))
    return _encode_pcm16(output)


RESAMPLERS: dict[str, Callable[[bytes], bytes]] = {
    "duplicate": upsample_duplicate_24k_to_48k,
    "linear": upsample_linear_24k_to_48k,
    "sinc-polyphase": upsample_sinc_polyphase_24k_to_48k,
}
