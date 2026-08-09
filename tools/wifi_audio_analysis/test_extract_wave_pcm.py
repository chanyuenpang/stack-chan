import array
import tempfile
import unittest
import wave
from pathlib import Path

from extract_wave_pcm import extract


class ExtractWavePcmTests(unittest.TestCase):
    def test_extracts_exact_pcm_without_resampling(self):
        expected = array.array("h", [0, 1200, -900, 32767, -32768])
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.wav"
            output = Path(directory) / "source.pcm"
            with wave.open(str(source), "wb") as sink:
                sink.setnchannels(1)
                sink.setsampwidth(2)
                sink.setframerate(16_000)
                sink.writeframes(expected.tobytes())
            self.assertEqual(extract(source, output, 16_000), len(expected))
            self.assertEqual(output.read_bytes(), expected.tobytes())


if __name__ == "__main__":
    unittest.main()
