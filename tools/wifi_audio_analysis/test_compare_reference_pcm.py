import array
import tempfile
import unittest
import wave
from pathlib import Path

from compare_reference_pcm import compare, read_source


class CompareReferencePcmTests(unittest.TestCase):
    def test_shifted_gain_changed_signal_passes(self):
        sample_rate = 16_000
        source = array.array("h", ((index * 37) % 20_000 - 10_000 for index in range(16_000)))
        candidate = array.array("h", [0] * 1_600 + [round(value * 0.5) for value in source] + [0] * 1_600)
        result = compare(source, candidate, sample_rate)
        self.assertTrue(result["pass"], result)
        self.assertEqual(result["time_scale"], 1.0)

    def test_repeated_samples_fail_reference_gate(self):
        sample_rate = 16_000
        source = array.array("h", ((index * 37) % 20_000 - 10_000 for index in range(16_000)))
        candidate = array.array("h", (source[index // 2] for index in range(len(source))))
        result = compare(source, candidate, sample_rate)
        self.assertFalse(result["pass"], result)

    def test_reads_uncompressed_mono_s16_wave_source(self):
        expected = array.array("h", [0, 1200, -900, 32767, -32768])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.wav"
            with wave.open(str(path), "wb") as sink:
                sink.setnchannels(1)
                sink.setsampwidth(2)
                sink.setframerate(16_000)
                sink.writeframes(expected.tobytes())
            self.assertEqual(read_source(path, 16_000).tolist(), expected.tolist())

    def test_rejects_wave_source_with_wrong_sample_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.wav"
            with wave.open(str(path), "wb") as sink:
                sink.setnchannels(1)
                sink.setsampwidth(2)
                sink.setframerate(24_000)
                sink.writeframes(array.array("h", [1, 2, 3]).tobytes())
            with self.assertRaisesRegex(ValueError, "rate=24000"):
                read_source(path, 16_000)


if __name__ == "__main__":
    unittest.main()
