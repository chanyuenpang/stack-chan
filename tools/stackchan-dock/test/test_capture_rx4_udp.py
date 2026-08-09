"""Contract tests for the RX-only four-slot UDP capture helper."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import struct
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "capture_rx4_udp.py"
SPEC = spec_from_file_location("capture_rx4_udp", SCRIPT)
MODULE = module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class CaptureRx4UdpTests(unittest.TestCase):
    def test_parses_strict_984_byte_audio_packet(self):
        samples = list(range(MODULE.CHANNELS * 120))
        payload = struct.pack("<" + "h" * len(samples), *samples)
        packet = MODULE.HEADER.pack(
            MODULE.MAGIC, MODULE.VERSION, MODULE.TYPE_AUDIO,
            MODULE.CHANNELS, MODULE.SAMPLE_BYTES, 7, 123456, 120, len(payload),
        ) + payload
        parsed = MODULE.parse_packet(packet)
        self.assertEqual(len(packet), 984)
        self.assertEqual(parsed["sequence"], 7)
        self.assertEqual(parsed["frames"], 120)

    def test_splits_interleaved_slots_without_reordering(self):
        payload = struct.pack("<8h", 1, 2, 3, 4, 11, 12, 13, 14)
        channels = MODULE.split_channels(payload)
        self.assertEqual([struct.unpack("<2h", channel) for channel in channels], [(1, 11), (2, 12), (3, 13), (4, 14)])

    def test_rejects_truncated_audio(self):
        packet = MODULE.HEADER.pack(
            MODULE.MAGIC, MODULE.VERSION, MODULE.TYPE_AUDIO,
            MODULE.CHANNELS, MODULE.SAMPLE_BYTES, 1, 0, 120, 960,
        ) + b"\0" * 958
        with self.assertRaisesRegex(ValueError, "payload length mismatch"):
            MODULE.parse_packet(packet)

    def test_rejects_internally_consistent_but_noncanonical_audio_packet(self):
        frames = 60
        payload = b"\0" * (frames * MODULE.CHANNELS * MODULE.SAMPLE_BYTES)
        packet = MODULE.HEADER.pack(
            MODULE.MAGIC, MODULE.VERSION, MODULE.TYPE_AUDIO,
            MODULE.CHANNELS, MODULE.SAMPLE_BYTES, 2, 0, frames, len(payload),
        ) + payload
        with self.assertRaisesRegex(ValueError, "exactly 120 frames"):
            MODULE.parse_packet(packet)


if __name__ == "__main__":
    unittest.main()
