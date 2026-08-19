import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
XIAOZHI_MAIN = FIRMWARE_ROOT / "xiaozhi-esp32" / "main"

KCONFIG = (FIRMWARE_ROOT / "main" / "Kconfig.projbuild").read_text(encoding="utf-8")
NORMAL_DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock.defaults").read_text(encoding="utf-8")
DIAG_DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock_audio_diag.defaults").read_text(encoding="utf-8")
FIRMWARE_CMAKE = (FIRMWARE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
MAIN_CMAKE = (FIRMWARE_ROOT / "main" / "CMakeLists.txt").read_text(encoding="utf-8")
PATCH = (FIRMWARE_ROOT / "patches" / "xiaozhi-audio-performance-diagnostics.patch").read_text(encoding="utf-8")
PATCH_PATH = FIRMWARE_ROOT / "patches" / "xiaozhi-audio-performance-diagnostics.patch"
PRIORITY_PATCH_PATH = FIRMWARE_ROOT / "patches" / "xiaozhi-local-dock-audio-output-priority.patch"

AUDIO_HEADER = (XIAOZHI_MAIN / "audio" / "audio_service.h").read_text(encoding="utf-8")
AUDIO_SOURCE = (XIAOZHI_MAIN / "audio" / "audio_service.cc").read_text(encoding="utf-8")
APPLICATION = (XIAOZHI_MAIN / "application.cc").read_text(encoding="utf-8")
DISPLAY_HEADER = (XIAOZHI_MAIN / "display" / "display.h").read_text(encoding="utf-8")

DIAG_HEADER = (FIRMWARE_ROOT / "main" / "hal" / "hal_audio_performance_diagnostics.h").read_text(encoding="utf-8")
DIAG_SOURCE = (FIRMWARE_ROOT / "main" / "hal" / "hal_audio_performance_diagnostics.cpp").read_text(encoding="utf-8")
STATS_HEADER = FIRMWARE_ROOT / "main" / "hal" / "hal_audio_performance_stats.h"
HOST_CONCURRENCY_TEST = FIRMWARE_ROOT / "main" / "tests" / "host" / "audio_performance_stats_concurrency_test.cpp"
HAL_HEADER = (FIRMWARE_ROOT / "main" / "hal" / "hal.h").read_text(encoding="utf-8")
HAL_IO = (FIRMWARE_ROOT / "main" / "hal" / "hal_io_expander.cpp").read_text(encoding="utf-8")
CORES3_CODEC = (FIRMWARE_ROOT / "main" / "hal" / "board" / "cores3_audio_codec.cc").read_text(encoding="utf-8")


def extract_braced_block(source: str, signature: str) -> str:
    start = source.index(signature)
    opening = source.index("{", start)
    depth = 0
    for index in range(opening, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise AssertionError(f"unterminated function or callback: {signature}")


def count_reports(segment_starts_us: tuple[int, ...], reset_at_each_segment: bool) -> int:
    last_report_us = 0
    reports = 0
    for segment_start_us in segment_starts_us:
        if reset_at_each_segment:
            last_report_us = segment_start_us
        for output_us in range(segment_start_us, segment_start_us + 3_600_000, 600_000):
            if last_report_us == 0:
                last_report_us = output_us
            elif output_us - last_report_us >= 5_000_000:
                reports += 1
                last_report_us = output_us
    return reports


class XiaozhiAudioPerformanceDiagnosticsTests(unittest.TestCase):
    def test_concurrent_window_snapshots_keep_each_logical_event_together(self):
        with tempfile.TemporaryDirectory(prefix="stackchan-audio-perf-") as temp_dir:
            temp = Path(temp_dir)
            executable = temp / ("audio_performance_stats_test.exe" if os.name == "nt" else "audio_performance_stats_test")
            compiler = shutil.which("g++") or shutil.which("clang++") or shutil.which("c++")
            if compiler:
                compile_command = [
                    compiler,
                    "-std=c++17",
                    "-O2",
                    "-pthread",
                    "-I",
                    str(STATS_HEADER.parent),
                    str(HOST_CONCURRENCY_TEST),
                    "-o",
                    str(executable),
                ]
                compile_result = subprocess.run(
                    compile_command, capture_output=True, text=True, encoding="utf-8", errors="replace"
                )
            else:
                program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
                vcvars = program_files / "Microsoft Visual Studio" / "2022" / "Community" / "VC" / "Auxiliary" / "Build" / "vcvars64.bat"
                if not vcvars.exists():
                    self.fail("No supported native C++ compiler found for the concurrency host test")
                build_script = temp / "build-host-test.cmd"
                build_script.write_text(
                    f'@call "{vcvars}" >nul\n'
                    f'@cl /nologo /std:c++17 /EHsc /O2 /I"{STATS_HEADER.parent}" '
                    f'"{HOST_CONCURRENCY_TEST}" /Fe:"{executable}"\n',
                    encoding="utf-8",
                )
                compile_result = subprocess.run(
                    ["cmd.exe", "/d", "/c", str(build_script)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )

            self.assertEqual(
                compile_result.returncode,
                0,
                msg=f"native compile failed\nstdout:\n{compile_result.stdout}\nstderr:\n{compile_result.stderr}",
            )
            run_result = subprocess.run(
                [str(executable)], capture_output=True, text=True, encoding="utf-8", errors="replace"
            )
            self.assertEqual(
                run_result.returncode,
                0,
                msg=f"host stress failed\nstdout:\n{run_result.stdout}\nstderr:\n{run_result.stderr}",
            )
            self.assertIn("concurrency test passed", run_result.stdout)

    def test_production_records_and_snapshots_under_the_same_lock(self):
        stats_header = STATS_HEADER.read_text(encoding="utf-8")
        self.assertIn("class LockedStatsAccumulator", stats_header)
        self.assertIn("StatsSnapshot SnapshotAndReset()", stats_header)
        self.assertIn("const StatsSnapshot snapshot = stats_;", stats_header)
        self.assertIn("stats_ = StatsSnapshot{};", stats_header)
        self.assertNotIn("std::atomic", stats_header)
        self.assertNotIn("memory_order", stats_header)

        self.assertIn('#include "hal_audio_performance_stats.h"', DIAG_SOURCE)
        self.assertIn("portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED", DIAG_SOURCE)
        lock_adapter = DIAG_SOURCE.split("class PortMuxLock", 1)[1].split("PortMuxLock g_stats_lock", 1)[0]
        self.assertIn("portENTER_CRITICAL(&mux_)", lock_adapter)
        self.assertIn("portEXIT_CRITICAL(&mux_)", lock_adapter)
        self.assertLess(lock_adapter.index("portENTER_CRITICAL(&mux_)"), lock_adapter.index("portEXIT_CRITICAL(&mux_)"))
        self.assertIn("LockedStatsAccumulator<PortMuxLock> g_stats", DIAG_SOURCE)
        self.assertIn("const auto stats = g_stats.SnapshotAndReset();", DIAG_SOURCE)
        self.assertNotIn("TakeTiming", DIAG_SOURCE)
        self.assertNotIn("exchange(0", DIAG_SOURCE)
        self.assertNotIn("std::array<std::atomic", DIAG_SOURCE)

    def test_diagnostics_are_default_off_with_an_explicit_opt_in_overlay(self):
        block = KCONFIG.split(
            "config STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS", 1
        )[1].split("\nconfig ", 1)[0]
        self.assertIn("default n", block)
        self.assertIn("depends on STACKCHAN_XIAOZHI_LOCAL_DOCK", block)
        self.assertNotIn("CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS=y", NORMAL_DEFAULTS)
        self.assertIn("CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS=y", DIAG_DEFAULTS)
        self.assertNotIn("AUDIO_SERVICE_DIAG_ENABLED=", MAIN_CMAKE)
        self.assertIn("#define AUDIO_SERVICE_DIAG_ENABLED 0", AUDIO_HEADER)

    def test_nested_xiaozhi_hooks_are_a_reproducible_independent_patch(self):
        self.assertIn("xiaozhi-audio-performance-diagnostics.patch", FIRMWARE_CMAKE)
        self.assertIn("STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_PATCH_APPLIED", FIRMWARE_CMAKE)
        patched_paths = set(re.findall(r"^diff --git a/(\S+) b/", PATCH, flags=re.MULTILINE))
        self.assertEqual(
            patched_paths,
            {
                "main/audio/audio_service.cc",
                "main/audio/audio_service.h",
                "main/display/display.h",
            },
        )
        self.assertNotIn("InjectPcmFrameToSendQueue", PATCH)
        self.assertNotIn("web_socket", PATCH.lower())
        self.assertNotIn("touchscreen", PATCH.lower())

    def test_diagnostics_and_default_off_priority_layers_round_trip_from_fresh_index(self):
        with tempfile.TemporaryDirectory(prefix="stackchan-audio-patch-") as temp_dir:
            env = os.environ.copy()
            env["GIT_INDEX_FILE"] = str(Path(temp_dir) / "index")

            def git(*args: str) -> subprocess.CompletedProcess[str]:
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
                return result

            git("read-tree", "HEAD")
            git("apply", "--cached", str(PATCH_PATH))
            git("apply", "--cached", str(PRIORITY_PATCH_PATH))
            git("apply", "--cached", "--reverse", str(PRIORITY_PATCH_PATH))
            git("apply", "--cached", "--reverse", str(PATCH_PATH))
            git("diff", "--cached", "--quiet")

    def test_network_ingress_timestamp_sidecar_moves_under_the_audio_queue_lock(self):
        self.assertIn(
            "PushPacketToDecodeQueue(std::move(packet));",
            APPLICATION,
        )
        self.assertIn("bool track_network_ingress = true", AUDIO_HEADER)
        self.assertIn(
            "PushPacketToDecodeQueue(std::move(packet), true, false);",
            AUDIO_SOURCE,
        )

        decode = AUDIO_SOURCE.split("void AudioService::OpusCodecTask()", 1)[1].split(
            "void AudioService::PushTaskToEncodeQueue", 1
        )[0]
        self.assertLess(decode.index("audio_decode_queue_.pop_front();"), decode.index("audio_decode_ingress_us_.pop_front();"))
        self.assertLess(decode.index("audio_decode_ingress_us_.pop_front();"), decode.index("lock.unlock();"))

        push = AUDIO_SOURCE.split("bool AudioService::PushPacketToDecodeQueue", 1)[1].split(
            "std::unique_ptr<AudioStreamPacket> AudioService::PopPacketFromSendQueue", 1
        )[0]
        self.assertLess(push.index("audio_decode_queue_.push_back"), push.index("audio_decode_ingress_us_.push_back"))
        self.assertIn("RecordIngress(\n                    false", push)
        self.assertIn("RecordIngress(\n            true", push)

        stop = AUDIO_SOURCE.split("void AudioService::Stop()", 1)[1].split("bool AudioService::ReadAudioData", 1)[0]
        self.assertIn("stackchan_audio_diag::ResetWindow();", stop)
        self.assertIn("audio_decode_ingress_us_.clear();", stop)
        reset = extract_braced_block(AUDIO_SOURCE, "void AudioService::ResetDecoder()")
        self.assertNotIn("stackchan_audio_diag::ResetWindow();", reset)
        self.assertIn("audio_decode_ingress_us_.clear();", reset)
        self.assertIn("audio_decode_ingress_us_.assign(audio_decode_queue_.size(), 0);", AUDIO_SOURCE)

    def test_segmented_playback_cannot_restart_the_five_second_report_deadline(self):
        opened = extract_braced_block(APPLICATION, "protocol_->OnAudioChannelOpened")
        self.assertEqual(opened.count("stackchan_audio_diag::ResetWindow();"), 1)

        reset_decoder = extract_braced_block(AUDIO_SOURCE, "void AudioService::ResetDecoder()")
        self.assertNotIn("stackchan_audio_diag::ResetWindow();", reset_decoder)
        self.assertIn("constexpr uint32_t kReportIntervalUs = 5'000'000;", DIAG_SOURCE)

        # The Host capture gate can create multiple TTS start/stop segments in
        # one authenticated session. Each TTS start re-enters Speaking and
        # calls ResetDecoder, so tying the report deadline to decoder resets
        # starves a five-second report when every spoken segment is shorter.
        segments = (1_000_000, 5_000_000, 9_000_000)
        self.assertEqual(count_reports(segments, reset_at_each_segment=True), 0)
        self.assertGreaterEqual(count_reports(segments, reset_at_each_segment=False), 1)

    def test_audio_stages_and_same_window_contention_are_instrumented(self):
        for marker in (
            "RecordDecode(",
            "RecordPlaybackQueueDepth(",
            "RecordOutput(",
            "RecordIngressTimestampMissing(",
        ):
            self.assertIn(marker, AUDIO_SOURCE)
        self.assertIn("RecordI2sWrite(", CORES3_CODEC)
        self.assertIn("RecordDisplayGuardWait(", DISPLAY_HEADER)
        self.assertIn("RecordDisplayGuardSpan(", DISPLAY_HEADER)
        self.assertIn("RecordLvglGuardWait(", HAL_HEADER)
        self.assertIn("RecordLvglGuardSpan(", HAL_HEADER)
        self.assertIn("RecordLedSetI2c(", HAL_IO)
        self.assertIn("RecordLedRefreshI2c(", HAL_IO)

        display_destructor = DISPLAY_HEADER.split("~DisplayLockGuard()", 1)[1].split("private:", 1)[0]
        self.assertLess(display_destructor.index("display_->Unlock();"), display_destructor.index("RecordDisplayGuardWait"))
        lvgl_destructor = HAL_HEADER.split("~LvglLockGuard()", 1)[1].split("private:", 1)[0]
        self.assertLess(lvgl_destructor.index("GetHAL().lvglUnlock();"), lvgl_destructor.index("RecordLvglGuardWait"))

    def test_underrun_candidates_are_decomposed_without_changing_audio_behavior(self):
        output = extract_braced_block(AUDIO_SOURCE, "void AudioService::AudioOutputTask()")
        self.assertIn("codec_->OutputData(task->pcm);", output)
        self.assertEqual(output.count("codec_->OutputData(task->pcm);"), 1)
        self.assertIn("stackchan_audio_diag::DecomposeOutputGap(", output)
        self.assertIn("gap_decomposition.previous_output_us", output)
        self.assertIn("gap_decomposition.ready_late_us", output)
        self.assertIn("gap_decomposition.ready_wait_us", output)
        self.assertIn("audio_diag_last_output_end_us_.store(output_end_us", output)

        stop = extract_braced_block(AUDIO_SOURCE, "void AudioService::Stop()")
        reset = extract_braced_block(AUDIO_SOURCE, "void AudioService::ResetDecoder()")
        for block in (stop, reset):
            self.assertIn("audio_diag_last_output_start_us_.store(0", block)
            self.assertIn("audio_diag_last_output_end_us_.store(0", block)

        self.assertIn('cJSON_AddNumberToObject(params, "version", 2);', DIAG_SOURCE)
        self.assertIn('"underrun_decomposition_missing"', DIAG_SOURCE)
        for field in (
            "underrun_previous_output",
            "underrun_ready_late",
            "underrun_ready_wait",
        ):
            self.assertIn(field, DIAG_SOURCE)

    def test_reporting_is_low_priority_bounded_and_numeric_only(self):
        self.assertIn('xTaskCreate(ReporterTask, "audio_perf", 4096', DIAG_SOURCE)
        self.assertIn("tskIDLE_PRIORITY + 1", DIAG_SOURCE)
        self.assertIn("xQueueOverwrite(g_report_queue, &queues)", DIAG_SOURCE)

        report_gate = AUDIO_SOURCE.split("void AudioService::AudioDiagReportMaybe()", 1)[1].split("#endif", 1)[0]
        self.assertLess(report_gate.index("TryBeginReportWindow"), report_gate.index("audio_queue_mutex_"))
        self.assertNotIn("ESP_LOG", report_gate)
        self.assertEqual(DIAG_SOURCE.count("ESP_LOGI(kTag"), 3)

        summaries = DIAG_SOURCE.split("void ReportSnapshot", 2)[-1]
        self.assertNotIn("%s", summaries)
        for forbidden in ("payload", "pcm", "transcript", "subtitle"):
            self.assertNotIn(forbidden, summaries.lower())
        self.assertIn("[AUDIO-PERF]", summaries)
        self.assertIn("[AUDIO-PERF-LAT]", summaries)
        self.assertIn("[AUDIO-PERF-CONTENTION]", summaries)


if __name__ == "__main__":
    unittest.main()
