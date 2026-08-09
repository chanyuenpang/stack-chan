"""Contract tests for the VB-CABLE PCM playback helper."""

from array import array
import importlib.util
from pathlib import Path
import sys
import unittest


PLAYER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "vb_cable_player.py"
sys.path.insert(0, str(PLAYER_PATH.parent))
SPEC = importlib.util.spec_from_file_location("vb_cable_player", PLAYER_PATH)
PLAYER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PLAYER)


class VbCablePlayerTests(unittest.TestCase):
    def test_player_uses_streaming_linear_resampler(self):
        self.assertIs(PLAYER.StreamingLinearUpsampler24kTo48k,
                      sys.modules["pcm_resample"].StreamingLinearUpsampler24kTo48k)

if __name__ == "__main__":
    unittest.main()
