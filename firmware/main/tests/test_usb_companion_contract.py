"""Host-side contract checks for the Stack-chan USB companion firmware.

These tests intentionally inspect the compiled firmware source contract.  They
catch descriptor/endpoint drift, an accidentally widened command surface, and
regressions that would stop disabled audio paths from keeping UAC streaming.
Run with: python -m unittest main.tests.test_usb_companion_contract
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
SOURCE = (FIRMWARE_ROOT / "main" / "hal" / "usb_uac_mvp.cpp").read_text(encoding="utf-8")
MAIN_SOURCE = (FIRMWARE_ROOT / "main" / "main.cpp").read_text(encoding="utf-8")
SDKCONFIG_DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.defaults").read_text(encoding="utf-8")
CMAKE_SOURCE = (FIRMWARE_ROOT / "main" / "CMakeLists.txt").read_text(encoding="utf-8")


def constant(name: str) -> int:
    match = re.search(rf"constexpr uint8_t {re.escape(name)} = (0x[0-9a-fA-F]+|\d+);", SOURCE)
    if match is None:
        raise AssertionError(f"missing endpoint constant {name}")
    return int(match.group(1), 0)


class UsbDescriptorContractTests(unittest.TestCase):
    def test_uac_is_composite_part(self) -> None:
        self.assertIn("CONFIG_USB_DEVICE_UAC_AS_PART=y", SDKCONFIG_DEFAULTS)

    def test_interface_numbers_preserve_the_proven_uac_layout(self) -> None:
        enum_body = re.search(r"enum InterfaceNumber[^\{]*\{(?P<body>.*?)\};", SOURCE, re.S)
        self.assertIsNotNone(enum_body)
        self.assertRegex(enum_body.group("body"), r"kInterfaceAudioControl\s*=\s*0")
        ordered = re.findall(r"kInterface(?:AudioSpeaker|AudioMicrophone|CdcControl|CdcData)", enum_body.group("body"))
        self.assertEqual(
            ordered,
            ["kInterfaceAudioSpeaker", "kInterfaceAudioMicrophone", "kInterfaceCdcControl", "kInterfaceCdcData"],
        )

    def test_endpoint_budget_and_addresses(self) -> None:
        endpoints = {
            "audio_out": constant("kEndpointAudioOut"),
            "audio_feedback": constant("kEndpointAudioFeedback"),
            "audio_in": constant("kEndpointAudioIn"),
            "cdc_notification": constant("kEndpointCdcNotification"),
            "cdc_out": constant("kEndpointCdcOut"),
            "cdc_in": constant("kEndpointCdcIn"),
        }
        self.assertEqual(endpoints, {
            "audio_out": 0x01,
            "audio_feedback": 0x81,
            "audio_in": 0x82,
            "cdc_notification": 0x83,
            "cdc_out": 0x04,
            "cdc_in": 0x84,
        })
        self.assertTrue(all((address & 0x0F) <= 5 for address in endpoints.values()))
        self.assertIn("static_assert(sizeof(s_configuration_descriptor) == STACKCHAN_CONFIG_TOTAL_LEN)", SOURCE)


class ProtocolAllowlistContractTests(unittest.TestCase):
    def test_frame_is_bounded_and_versioned(self) -> None:
        self.assertIn("constexpr uint32_t kProtocolVersion = 1;", SOURCE)
        self.assertIn("constexpr size_t kMaxFrameBytes = 511;", SOURCE)
        self.assertIn('send_error(0, "frame_too_large"', SOURCE)
        self.assertIn('cJSON_AddNumberToObject(response, "id", request_id)', SOURCE)
        self.assertIn('cJSON_AddNumberToObject(event, "seq", ++s_event_sequence)', SOURCE)
        self.assertIn('cJSON_AddNumberToObject(result, "event_sequence", s_event_sequence.load())', SOURCE)

    def test_dispatch_surface_is_exactly_allowlisted(self) -> None:
        commands = set(re.findall(r'command == "([a-z_]+)"', SOURCE))
        self.assertEqual(commands, {
            "get_status",
            "set_audio",
            "set_expression",
            "set_talking",
            "set_speech",
            "clear_speech",
            "set_led",
            "get_head",
            "set_head",
        })
        self.assertIn('send_error(request_id, "unknown_command"', SOURCE)
        for forbidden in ("shell", "exec", "passthrough", "raw_command"):
            self.assertNotIn(f'command == "{forbidden}"', SOURCE)

    def test_output_ranges_are_validated_before_dispatch(self) -> None:
        self.assertIn('read_int(args, "red", 0, 168', SOURCE)
        self.assertIn('read_int(args, "green", 0, 168', SOURCE)
        self.assertIn('read_int(args, "blue", 0, 168', SOURCE)
        self.assertIn('read_int(args, "yaw", -128, 128', SOURCE)
        self.assertIn('read_int(args, "pitch", 0, 90', SOURCE)
        self.assertIn('read_int(args, "speed", 100, 300', SOURCE)
        self.assertIn("show_temporary_led", SOURCE)
        self.assertIn('stackchan_mcp_dispatch_tool("self.robot.set_head_angles"', SOURCE)

    def test_speech_bubble_text_is_bounded_and_typed(self) -> None:
        self.assertIn("constexpr size_t kMaxSpeechTextBytes = 320;", SOURCE)
        self.assertIn('has_exact_fields(args, {"text"})', SOURCE)
        self.assertIn("is_valid_utf8(text_item->valuestring, text_length)", SOURCE)
        self.assertIn('display->SetChatMessage("assistant", text_item->valuestring)', SOURCE)
        self.assertIn("display->ClearChatMessages()", SOURCE)

    def test_talking_animation_is_boolean_allowlisted_and_mouth_only(self) -> None:
        self.assertIn('has_exact_fields(args, {"enabled"})', SOURCE)
        self.assertIn('read_bool(args, "enabled", &enabled)', SOURCE)
        display_source = (
            FIRMWARE_ROOT / "main" / "hal" / "board" / "stackchan_display.cc"
        ).read_text(encoding="utf-8")
        self.assertIn("SpeakingModifier>(0, 180, false)", display_source)
        self.assertIn("stackchan.avatar().mouth().setWeight(0)", display_source)


class AudioPathContractTests(unittest.TestCase):
    def test_audio_paths_boot_disabled_for_standby(self) -> None:
        self.assertIn("std::atomic_bool s_microphone_enabled{false};", SOURCE)
        self.assertIn("std::atomic_bool s_speaker_enabled{false};", SOURCE)

    def test_both_endpoint_states_are_always_updated(self) -> None:
        update = re.search(r"void update_audio_paths.*?\n\}", SOURCE, re.S)
        self.assertIsNotNone(update)
        self.assertIn("const bool microphone_changed = s_microphone_enabled.exchange", update.group(0))
        self.assertIn("const bool speaker_changed = s_speaker_enabled.exchange", update.group(0))
        self.assertIn("if (microphone_changed || speaker_changed)", update.group(0))

    def test_disabling_microphone_keeps_returning_full_silence_frames(self) -> None:
        disabled_path = re.search(
            r"if \(!s_microphone_enabled\.load\(\)\) \{(?P<body>.*?)\n    \}", SOURCE, re.S
        )
        self.assertIsNotNone(disabled_path)
        self.assertIn("std::memset(buffer, 0, length)", disabled_path.group("body"))
        self.assertIn("*bytes_read = length", disabled_path.group("body"))
        self.assertIn("return ESP_OK", disabled_path.group("body"))

    def test_disabling_speaker_consumes_and_drops_without_stopping_uac(self) -> None:
        disabled_path = re.search(
            r"if \(!s_speaker_enabled\.load\(\)\) \{(?P<body>.*?)\n    \}", SOURCE, re.S
        )
        self.assertIsNotNone(disabled_path)
        self.assertIn("return ESP_OK", disabled_path.group("body"))
        self.assertNotIn("OutputData", disabled_path.group("body"))

    def test_touch_sets_deterministic_audio_states(self) -> None:
        self.assertIn('update_audio_paths(true, true, "touch_swipe_forward")', SOURCE)
        self.assertIn('update_audio_paths(false, false, "touch_swipe_backward")', SOURCE)
        self.assertIn("emit_touch_event(gesture)", SOURCE)


class CompanionUiContractTests(unittest.TestCase):
    def test_uac_runtime_creates_neutral_avatar_without_launcher(self) -> None:
        uac_runtime = re.search(
            r"#if CONFIG_STACKCHAN_USB_UAC_MVP(?P<body>.*?)#else", MAIN_SOURCE, re.S
        )
        self.assertIsNotNone(uac_runtime)
        body = uac_runtime.group("body")
        self.assertIn("display->SetupUI()", body)
        self.assertIn('display->SetEmotion("neutral")', body)
        self.assertIn("GetStackChan().update()", body)
        self.assertNotIn("AppLauncher", body)
        self.assertNotIn("AppAvatar", body)
        self.assertNotIn("startWebSocketAvatarService", body)

    def test_native_avatar_uses_the_configured_text_font(self) -> None:
        display_source = (
            FIRMWARE_ROOT / "main" / "hal" / "board" / "stackchan_display.cc"
        ).read_text(encoding="utf-8")
        self.assertIn("avatar->init(lv_screen_active(), &BUILTIN_TEXT_FONT)", display_source)

    def test_stackchan_bubble_font_covers_representative_voice_text(self) -> None:
        stackchan_config = re.search(
            r"if\(CONFIG_BOARD_TYPE_M5STACK_STACK_CHAN\)(?P<body>.*?)endif\(\)",
            CMAKE_SOURCE,
            re.S,
        )
        self.assertIsNotNone(stackchan_config)
        selected = re.search(r"set\(BUILTIN_TEXT_FONT ([a-zA-Z0-9_]+)\)", stackchan_config.group("body"))
        self.assertIsNotNone(selected)
        self.assertEqual(selected.group(1), "font_puhui_20_4")

        font_source = (
            FIRMWARE_ROOT
            / "managed_components"
            / "78__xiaozhi-fonts"
            / "src"
            / f"{selected.group(1)}.c"
        ).read_text(encoding="utf-8")
        for character in "好我现在就关闭语音":
            with self.subTest(character=character):
                self.assertIn(f"U+{ord(character):04X}", font_source)

    def test_audio_state_has_a_single_status_led_mapping(self) -> None:
        self.assertIn("constexpr RgbColor kStandbyLed{24, 24, 24};", SOURCE)
        self.assertIn("constexpr RgbColor kActiveLed{0, 48, 0};", SOURCE)
        self.assertIn("constexpr RgbColor kPartialLed{48, 32, 0};", SOURCE)
        self.assertIn("constexpr RgbColor kFaultLed{48, 0, 0};", SOURCE)
        update = re.search(r"void update_audio_paths.*?\n\}", SOURCE, re.S)
        self.assertIsNotNone(update)
        self.assertIn("apply_audio_status_led()", update.group(0))

    def test_manual_led_effect_is_bounded_and_restores_status(self) -> None:
        self.assertIn("constexpr uint32_t kManualLedEffectMs = 1500;", SOURCE)
        self.assertIn("show_temporary_led", SOURCE)
        self.assertIn("restore_audio_status_led", SOURCE)
        self.assertIn('cJSON_AddNumberToObject(result, "restore_after_ms", kManualLedEffectMs)', SOURCE)

    def test_detectable_start_failures_request_fault_led(self) -> None:
        start = re.search(r"esp_err_t start_stackchan_usb_uac_mvp\(\).*?\n\}", SOURCE, re.S)
        self.assertIsNotNone(start)
        self.assertGreaterEqual(start.group(0).count("show_fault_led()"), 3)


if __name__ == "__main__":
    unittest.main()
