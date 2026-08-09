import sys
from array import array
from pathlib import Path
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from windows_output_to_speaker_pipe import ActivityGate, stereo_48k_to_mono_24k  # noqa: E402


def pcm(*samples: int) -> bytes:
    return array("h", samples).tobytes()


class Stereo48kToMono24kTests(unittest.TestCase):
    def test_downmixes_stereo_and_averages_adjacent_frames(self) -> None:
        output, clipped = stereo_48k_to_mono_24k(pcm(1000, 1000, 3000, 3000))
        self.assertEqual(array("h", output).tolist(), [2000])
        self.assertEqual(clipped, 0)

    def test_cancels_opposite_stereo_polarity(self) -> None:
        output, clipped = stereo_48k_to_mono_24k(pcm(1000, -1000, 3000, -3000))
        self.assertEqual(array("h", output).tolist(), [0])
        self.assertEqual(clipped, 0)

    def test_applies_gain_and_counts_clipping(self) -> None:
        output, clipped = stereo_48k_to_mono_24k(pcm(20000, 20000, 20000, 20000), gain=2.0)
        self.assertEqual(array("h", output).tolist(), [32767])
        self.assertEqual(clipped, 1)

    def test_rejects_misaligned_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "even number of frames"):
            stereo_48k_to_mono_24k(pcm(1, 2))


class ActivityGateTests(unittest.TestCase):
    def test_suppresses_steady_silence(self) -> None:
        gate = ActivityGate(threshold=64, pre_roll_frames=2, hangover_frames=2)
        self.assertEqual(gate.push(b"quiet-1", 3), [])
        self.assertEqual(gate.push(b"quiet-2", 3), [])

    def test_emits_pre_roll_on_attack(self) -> None:
        gate = ActivityGate(threshold=64, pre_roll_frames=2, hangover_frames=2)
        gate.push(b"quiet-1", 3)
        gate.push(b"quiet-2", 3)
        self.assertEqual(gate.push(b"voice", 100), [b"quiet-1", b"quiet-2", b"voice"])

    def test_emits_bounded_hangover_then_gates(self) -> None:
        gate = ActivityGate(threshold=64, pre_roll_frames=1, hangover_frames=2)
        gate.push(b"voice", 100)
        self.assertEqual(gate.push(b"tail-1", 3), [b"tail-1"])
        self.assertEqual(gate.push(b"tail-2", 3), [b"tail-2"])
        self.assertEqual(gate.push(b"silence", 3), [])


if __name__ == "__main__":
    unittest.main()
