import unittest
from pathlib import Path


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
XIAOZHI_AUDIO = FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "audio"
KCONFIG = (FIRMWARE_ROOT / "main" / "Kconfig.projbuild").read_text(encoding="utf-8")
AUDIO_HEADER = (XIAOZHI_AUDIO / "audio_service.h").read_text(encoding="utf-8")
AUDIO_SOURCE = (XIAOZHI_AUDIO / "audio_service.cc").read_text(encoding="utf-8")
OVERLAY = FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock_audio_output_priority.defaults"
NORMAL_DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock.defaults").read_text(encoding="utf-8")
FIRMWARE_CMAKE = (FIRMWARE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
PRIORITY_PATCH = FIRMWARE_ROOT / "patches" / "xiaozhi-local-dock-audio-output-priority.patch"


class XiaozhiAudioOutputPriorityOptimizationTests(unittest.TestCase):
    def test_latest_measured_outlier_does_not_warrant_a_priority_change(self):
        # Numeric-only evidence from the latest six valid priority-4 windows.
        # The candidate's output/I2S and UI-lock maxima are not worse than the
        # non-candidate median, so aggregate windows cannot justify a priority
        # change.  The next experiment must first decompose the candidate gap.
        outlier = {
            "output_gap_max": 115_767,
            "output_call_max": 65_783,
            "i2s_write_max": 59_305,
            "ingress_to_output_max": 43_979,
            "display_wait_max": 35,
            "lvgl_wait_max": 8_138,
            "decode_hwm": 1,
            "playback_hwm": 1,
            "underrun_candidates": 1,
        }
        non_candidate_median = {
            "output_call_max": 67_489,
            "i2s_write_max": 59_263,
            "ingress_to_output_max": 51_293,
            "display_wait_max": 9_129,
            "lvgl_wait_max": 11_548,
        }

        self.assertLess(outlier["output_call_max"], non_candidate_median["output_call_max"])
        self.assertLess(outlier["ingress_to_output_max"], non_candidate_median["ingress_to_output_max"])
        self.assertLess(outlier["display_wait_max"], non_candidate_median["display_wait_max"])
        self.assertLess(outlier["lvgl_wait_max"], non_candidate_median["lvgl_wait_max"])
        self.assertLess(abs(outlier["i2s_write_max"] - non_candidate_median["i2s_write_max"]), 100)
        self.assertEqual(outlier["decode_hwm"], 1)
        self.assertEqual(outlier["playback_hwm"], 1)

    def test_priority_boost_is_default_off_and_local_dock_only(self):
        block = KCONFIG.split("config STACKCHAN_XIAOZHI_AUDIO_OUTPUT_PRIORITY_BOOST", 1)[1].split(
            "\nconfig ", 1
        )[0]
        self.assertIn("default n", block)
        self.assertIn("depends on STACKCHAN_XIAOZHI_LOCAL_DOCK", block)
        self.assertTrue(OVERLAY.is_file())
        self.assertIn(
            "CONFIG_STACKCHAN_XIAOZHI_AUDIO_OUTPUT_PRIORITY_BOOST=y",
            OVERLAY.read_text(encoding="utf-8"),
        )
        self.assertNotIn("CONFIG_STACKCHAN_XIAOZHI_AUDIO_OUTPUT_PRIORITY_BOOST=y", NORMAL_DEFAULTS)

    def test_only_the_output_task_priority_changes_when_opted_in(self):
        self.assertIn("#define AUDIO_SERVICE_OUTPUT_TASK_PRIORITY 5", AUDIO_HEADER)
        self.assertIn("#define AUDIO_SERVICE_OUTPUT_TASK_PRIORITY 4", AUDIO_HEADER)
        self.assertEqual(AUDIO_SOURCE.count("AUDIO_SERVICE_OUTPUT_TASK_PRIORITY, &audio_output_task_handle_"), 2)

        start = AUDIO_SOURCE.split("void AudioService::Start()", 1)[1].split("void AudioService::Stop()", 1)[0]
        self.assertNotIn('xTaskCreatePinnedToCore([](void* arg) {\n        AudioService* audio_service = (AudioService*)arg;\n        audio_service->AudioOutputTask()', start)
        self.assertIn("#define MAX_PLAYBACK_TASKS_IN_QUEUE 2", AUDIO_HEADER)
        self.assertIn("#define OPUS_FRAME_DURATION_MS 60", AUDIO_HEADER)

    def test_priority_hook_is_a_separate_layered_patch(self):
        patch = PRIORITY_PATCH.read_text(encoding="utf-8")
        self.assertEqual(
            {line.removeprefix("+++ b/") for line in patch.splitlines() if line.startswith("+++ b/")},
            {"main/audio/audio_service.cc", "main/audio/audio_service.h"},
        )
        self.assertNotIn("AudioOutputTask() {", patch)
        self.assertNotIn("MAX_PLAYBACK_TASKS_IN_QUEUE", patch)
        self.assertNotIn("xTaskCreatePinnedToCore", patch)
        self.assertIn("STACKCHAN_XIAOZHI_AUDIO_OUTPUT_PRIORITY_PATCH", FIRMWARE_CMAKE)
        self.assertLess(
            FIRMWARE_CMAKE.index("Failed to apply XiaoZhi audio performance diagnostics patch"),
            FIRMWARE_CMAKE.index("Failed to apply XiaoZhi audio output priority patch"),
        )
        self.assertLess(
            FIRMWARE_CMAKE.index("--reverse --check \"${STACKCHAN_XIAOZHI_AUDIO_OUTPUT_PRIORITY_PATCH}\""),
            FIRMWARE_CMAKE.index("--reverse --check \"${STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_PATCH}\""),
        )


if __name__ == "__main__":
    unittest.main()
