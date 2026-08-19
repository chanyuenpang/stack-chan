import math
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
XIAOZHI_AUDIO = FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "audio"
KCONFIG = (FIRMWARE_ROOT / "main" / "Kconfig.projbuild").read_text(encoding="utf-8")
AUDIO_HEADER = (XIAOZHI_AUDIO / "audio_service.h").read_text(encoding="utf-8")
AUDIO_SOURCE = (XIAOZHI_AUDIO / "audio_service.cc").read_text(encoding="utf-8")
NORMAL_DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock.defaults").read_text(encoding="utf-8")
OVERLAY = FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock_audio_codec_priority.defaults"
PATCH = FIRMWARE_ROOT / "patches" / "xiaozhi-local-dock-audio-codec-priority.patch"
DIAGNOSTICS_PATCH = FIRMWARE_ROOT / "patches" / "xiaozhi-audio-performance-diagnostics.patch"
OUTPUT_PRIORITY_PATCH = FIRMWARE_ROOT / "patches" / "xiaozhi-local-dock-audio-output-priority.patch"
CMAKE = (FIRMWARE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")


def correlation(left, right):
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    covariance = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_energy = sum((x - left_mean) ** 2 for x in left)
    right_energy = sum((y - right_mean) ** 2 for y in right)
    return covariance / math.sqrt(left_energy * right_energy)


class XiaozhiAudioCodecPriorityOptimizationTests(unittest.TestCase):
    def test_v2_evidence_points_to_decode_wall_time_not_ingress_or_lock_wait(self):
        # Sequences 1,2,3,5..18 from the completed v2 field cycle.
        ready_late_max = [0, 79100, 70820, 134909, 166068, 0, 0, 0, 174659, 0,
                          147705, 115553, 0, 0, 0, 0, 0]
        decode_max = [15402, 83394, 61645, 91027, 156270, 48642, 45680, 42380,
                      119115, 20455, 123614, 113824, 42397, 46178, 49868, 51248, 50563]
        ingress_to_decode_max = [1773, 112310, 56521, 42814, 250879, 244944, 249637,
                                 249318, 61357, 1786, 138385, 73420, 76520, 77304,
                                 66585, 113706, 107479]
        decoder_lock_wait_max = [6, 10, 10, 12, 10, 475, 19, 14, 206, 6, 34, 14,
                                 14, 19, 13, 28, 19]

        self.assertGreater(correlation(ready_late_max, decode_max), 0.90)
        self.assertLess(abs(correlation(ready_late_max, ingress_to_decode_max)), 0.05)
        self.assertLess(abs(correlation(ready_late_max, decoder_lock_wait_max)), 0.05)

    def test_codec_priority_experiment_is_default_off_and_local_dock_only(self):
        block = KCONFIG.split("config STACKCHAN_XIAOZHI_AUDIO_CODEC_PRIORITY_BOOST", 1)[1].split(
            "\nconfig ", 1
        )[0]
        self.assertIn("default n", block)
        self.assertIn("depends on STACKCHAN_XIAOZHI_LOCAL_DOCK", block)
        self.assertTrue(OVERLAY.is_file())
        self.assertIn(
            "CONFIG_STACKCHAN_XIAOZHI_AUDIO_CODEC_PRIORITY_BOOST=y",
            OVERLAY.read_text(encoding="utf-8"),
        )
        self.assertNotIn("CONFIG_STACKCHAN_XIAOZHI_AUDIO_CODEC_PRIORITY_BOOST=y", NORMAL_DEFAULTS)

    def test_only_opus_codec_priority_changes_from_two_to_three(self):
        self.assertIn("#define AUDIO_SERVICE_CODEC_TASK_PRIORITY 3", AUDIO_HEADER)
        self.assertIn("#define AUDIO_SERVICE_CODEC_TASK_PRIORITY 2", AUDIO_HEADER)
        self.assertEqual(
            AUDIO_SOURCE.count('"opus_codec", 2048 * 12, this, AUDIO_SERVICE_CODEC_TASK_PRIORITY'),
            1,
        )
        start = AUDIO_SOURCE.split("void AudioService::Start()", 1)[1].split(
            "void AudioService::Stop()", 1
        )[0]
        self.assertNotIn('xTaskCreatePinnedToCore', start.split('"opus_codec"', 1)[0].rsplit(
            "/* Start the opus codec task */", 1
        )[-1])
        self.assertIn("AUDIO_SERVICE_OUTPUT_TASK_PRIORITY", start)
        self.assertIn("#define MAX_PLAYBACK_TASKS_IN_QUEUE 2", AUDIO_HEADER)
        self.assertIn("#define OPUS_FRAME_DURATION_MS 60", AUDIO_HEADER)

    def test_codec_priority_hook_is_a_separate_top_layer(self):
        patch = PATCH.read_text(encoding="utf-8")
        self.assertEqual(
            {line.removeprefix("+++ b/") for line in patch.splitlines() if line.startswith("+++ b/")},
            {"main/audio/audio_service.cc", "main/audio/audio_service.h"},
        )
        for forbidden in (
            "AudioOutputTask() {",
            "MAX_PLAYBACK_TASKS_IN_QUEUE",
            "xTaskCreatePinnedToCore",
            "esp_opus_dec_decode",
            "audio_playback_queue_",
        ):
            self.assertNotIn(forbidden, patch)
        self.assertIn("STACKCHAN_XIAOZHI_AUDIO_CODEC_PRIORITY_PATCH", CMAKE)
        self.assertLess(
            CMAKE.index("Failed to apply XiaoZhi audio output priority patch"),
            CMAKE.index("Failed to apply XiaoZhi audio codec priority patch"),
        )
        self.assertLess(
            CMAKE.index('--reverse --check "${STACKCHAN_XIAOZHI_AUDIO_CODEC_PRIORITY_PATCH}"'),
            CMAKE.index('--reverse --check "${STACKCHAN_XIAOZHI_AUDIO_OUTPUT_PRIORITY_PATCH}"'),
        )

    def test_diagnostics_and_codec_priority_layers_round_trip_from_fresh_index(self):
        with tempfile.TemporaryDirectory(prefix="stackchan-codec-patch-") as temp_dir:
            env = os.environ.copy()
            env["GIT_INDEX_FILE"] = str(Path(temp_dir) / "index")

            def git(*args: str):
                result = subprocess.run(
                    ["git", "-C", str(FIRMWARE_ROOT / "xiaozhi-esp32"), *args],
                    env=env,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                self.assertEqual(
                    result.returncode,
                    0,
                    msg=f"git {' '.join(args)} failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
                )

            git("read-tree", "HEAD")
            git("apply", "--cached", str(DIAGNOSTICS_PATCH))
            git("apply", "--cached", str(OUTPUT_PRIORITY_PATCH))
            git("apply", "--cached", str(PATCH))
            git("apply", "--cached", "--reverse", str(PATCH))
            git("apply", "--cached", "--reverse", str(OUTPUT_PRIORITY_PATCH))
            git("apply", "--cached", "--reverse", str(DIAGNOSTICS_PATCH))
            git("diff", "--cached", "--quiet")


if __name__ == "__main__":
    unittest.main()
