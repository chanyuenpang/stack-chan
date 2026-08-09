"""Contract tests for fixed-ratio Stack-chan PCM resampling."""

from array import array
import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "pcm_resample.py"
SPEC = importlib.util.spec_from_file_location("pcm_resample", MODULE_PATH)
PCM = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PCM)


def samples(payload: bytes) -> list[int]:
    result = array("h")
    result.frombytes(payload)
    return result.tolist()


class PcmResampleTests(unittest.TestCase):
    def test_duplicate_matches_existing_zero_order_hold(self):
        source = array("h", [-100, 0, 200]).tobytes()
        self.assertEqual(
            samples(PCM.upsample_duplicate_24k_to_48k(source)),
            [-100, -100, 0, 0, 200, 200],
        )

    def test_linear_interpolates_midpoints_and_preserves_duration(self):
        source = array("h", [0, 100, 300]).tobytes()
        self.assertEqual(
            samples(PCM.upsample_linear_24k_to_48k(source)),
            [0, 50, 100, 200, 300, 300],
        )

    def test_streaming_linear_is_continuous_across_frame_boundaries(self):
        upsampler = PCM.StreamingLinearUpsampler24kTo48k()
        first = samples(upsampler.process(array("h", [0, 100]).tobytes()))
        second = samples(upsampler.process(array("h", [300, 500]).tobytes()))
        self.assertEqual(first, [0, 0, 50, 100])
        self.assertEqual(second, [200, 300, 400, 500])

    def test_sinc_polyphase_preserves_constant_signal_and_duration(self):
        source_samples = [1234] * 64
        result = samples(
            PCM.upsample_sinc_polyphase_24k_to_48k(array("h", source_samples).tobytes())
        )
        self.assertEqual(len(result), len(source_samples) * 2)
        self.assertTrue(all(abs(value - 1234) <= 1 for value in result))

    def test_all_resamplers_reject_partial_16_bit_sample(self):
        for resampler in PCM.RESAMPLERS.values():
            with self.subTest(resampler=resampler.__name__):
                with self.assertRaisesRegex(ValueError, "16-bit"):
                    resampler(b"\x01")


if __name__ == "__main__":
    unittest.main()
