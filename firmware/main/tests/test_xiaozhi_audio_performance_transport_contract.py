from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
KCONFIG = (ROOT / "firmware/main/Kconfig.projbuild").read_text(encoding="utf-8")
DIAG_H = (ROOT / "firmware/main/hal/hal_audio_performance_diagnostics.h").read_text(encoding="utf-8")
DIAG_CPP = (ROOT / "firmware/main/hal/hal_audio_performance_diagnostics.cpp").read_text(encoding="utf-8")
APPLICATION = (ROOT / "firmware/xiaozhi-esp32/main/application.cc").read_text(encoding="utf-8")
HOST_SCHEMA = (ROOT / "tools/stackchan-dock/src/xiaozhi-audio-performance-summary.mjs").read_text(encoding="utf-8")
HOST_SERVER = (ROOT / "tools/stackchan-dock/src/xiaozhi-websocket-server.mjs").read_text(encoding="utf-8")
HOST_RUNTIME = (ROOT / "tools/stackchan-dock/src/xiaozhi-runtime.mjs").read_text(encoding="utf-8")
HOST_CONSOLE = (ROOT / "tools/stackchan-console/src/main.mjs").read_text(encoding="utf-8")


class AudioPerformanceTransportContract(unittest.TestCase):
    def test_firmware_transport_is_default_off_and_numeric_only(self):
        block = re.search(
            r"config STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS(?P<body>.*?)(?=\nconfig |\Z)",
            KCONFIG,
            re.S,
        )
        self.assertIsNotNone(block)
        self.assertIn("default n", block.group("body"))
        self.assertIn("never stores or logs Opus/PCM payloads, transcripts, or subtitle text", block.group("body"))
        self.assertIn("using SummarySink = void (*)(const std::string& notification_json);", DIAG_H)
        self.assertIn("std::atomic<SummarySink> g_summary_sink{nullptr};", DIAG_CPP)
        self.assertIn('"notifications/audio_performance_summary"', DIAG_CPP)
        self.assertIn('"audio_perf_summary"', DIAG_CPP)
        self.assertIn('cJSON_AddNumberToObject(params, "version", 2);', DIAG_CPP)
        self.assertIn("value.version !== 1 && value.version !== AUDIO_PERFORMANCE_SUMMARY_VERSION", HOST_SCHEMA)
        for field in (
            "underrun_decomposition_missing",
            "underrun_previous_output_avg",
            "underrun_ready_late_avg",
            "underrun_ready_wait_avg",
        ):
            self.assertIn(field, DIAG_CPP)
            self.assertIn(field, HOST_SCHEMA)
        for forbidden in ('"text"', '"audio"', 'payload', 'transcript', 'subtitle'):
            self.assertNotIn(forbidden, DIAG_CPP)

    def test_reporter_handoff_uses_main_task_and_existing_authenticated_mcp_envelope(self):
        self.assertIsNotNone(re.search(
            r"ForwardAudioPerformanceSummary\([^)]*\).*?OfferAudioPerformanceSummary\(notification_json\)",
            APPLICATION,
            re.S,
        ))
        self.assertIn("stackchan_audio_diag::SetSummarySink(ForwardAudioPerformanceSummary);", APPLICATION)
        offer = APPLICATION.split("void Application::OfferAudioPerformanceSummary", 1)[1].split("#endif", 1)[0]
        self.assertIn("audio_performance_summary_pending_ = notification_json;", offer)
        self.assertIn("xEventGroupSetBits(event_group_, MAIN_EVENT_AUDIO_PERF_REPORT);", offer)
        self.assertNotIn("Schedule(", offer)
        handler = APPLICATION.split("if (bits & MAIN_EVENT_AUDIO_PERF_REPORT)", 1)[1].split("#endif", 1)[0]
        self.assertIn("notification.swap(audio_performance_summary_pending_);", handler)
        self.assertIn("generation == audio_performance_session_generation_.load", handler)
        self.assertIn("protocol_->IsAudioChannelOpened()", handler)
        self.assertIn("protocol_->SendMcpMessage(notification);", handler)
        self.assertIn("audio_performance_session_generation_.fetch_add", APPLICATION)
        self.assertIn('\\"session_id\\"', (ROOT / "firmware/xiaozhi-esp32/main/protocols/protocol.cc").read_text(encoding="utf-8"))

    def test_host_intercepts_before_generic_mcp_and_persistence_is_explicit_opt_in(self):
        intercept = HOST_SERVER.index("value.type === \"mcp\" && value.payload?.method === AUDIO_PERFORMANCE_SUMMARY_METHOD")
        generic_message = HOST_SERVER.index('this.emit("message", value)')
        generic_mcp = HOST_SERVER.index('this.emit("mcp", value.payload)')
        self.assertLess(intercept, generic_message)
        self.assertLess(intercept, generic_mcp)
        handler = HOST_SERVER.split("#handleAudioPerformanceSummary(value)", 1)[1].split("#protocolError", 1)[0]
        for unrelated in ("microphoneOpus", "sendTts", "subtitle", "setCodexOutputRouted", "setLed"):
            self.assertNotIn(unrelated, handler)
        self.assertIn("assertExactKeys", HOST_SCHEMA)
        self.assertIn("#inFlight !== null", HOST_SCHEMA)
        self.assertIn('reason: "writer_busy"', HOST_SCHEMA)
        self.assertIn('reason: "disconnected"', HOST_SCHEMA)
        self.assertIn(
            'this.#listen(this.#server, "audioPerformanceSummary", (summary) => this.emit("audioPerformanceSummary", summary))',
            HOST_RUNTIME,
        )
        self.assertIn("STACKCHAN_AUDIO_PERF_SUMMARY_PATH", HOST_CONSOLE)
        self.assertIn("isLocalAbsoluteFilePath(audioPerformancePath)", HOST_CONSOLE)
        self.assertRegex(HOST_CONSOLE, r"audioPerformancePath\s*\? new AudioPerformanceSummaryWriter")
        persistence = HOST_CONSOLE.split("if (audioPerformance) {", 1)[1].split("transcripts.on", 1)[0]
        for unrelated in ("voiceStatus", "presenter", "ledArbiter", "speaker", "route"):
            self.assertNotIn(unrelated, persistence)


if __name__ == "__main__":
    unittest.main()
