import sys
from array import array
from pathlib import Path
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from stream_wav_to_speaker_pipe import apply_gain  # noqa: E402


class ApplyGainTests(unittest.TestCase):
    def test_scales_pcm_and_reports_clipping(self) -> None:
        source = array("h", [1000, -2000, 20000, -20000]).tobytes()
        output, clipped = apply_gain(source, 2.0)
        self.assertEqual(array("h", output).tolist(), [2000, -4000, 32767, -32768])
        self.assertEqual(clipped, 2)

    def test_rejects_non_positive_gain(self) -> None:
        with self.assertRaisesRegex(ValueError, "gain must be positive"):
            apply_gain(b"", 0)


if __name__ == "__main__":
    unittest.main()
