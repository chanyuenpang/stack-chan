import unittest
from pathlib import Path


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
ROOT = FIRMWARE_ROOT.parent
KCONFIG = (FIRMWARE_ROOT / "main" / "Kconfig.projbuild").read_text(encoding="utf-8")
BLE = (FIRMWARE_ROOT / "main" / "hal" / "hal_ble.cpp").read_text(encoding="utf-8")
OTA = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "ota.cc").read_text(encoding="utf-8")
MAIN = (FIRMWARE_ROOT / "main" / "main.cpp").read_text(encoding="utf-8")
DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.xiaozhi_dock.defaults").read_text(encoding="utf-8")
APP = (ROOT / "app" / "lib" / "view" / "popup" / "wifi_audio_dock_config.dart").read_text(encoding="utf-8")
FIRMWARE_CMAKE = (FIRMWARE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
MAIN_CMAKE = (FIRMWARE_ROOT / "main" / "CMakeLists.txt").read_text(encoding="utf-8")
LOCAL_DOCK_PATCH = (FIRMWARE_ROOT / "patches" / "xiaozhi-local-dock.patch").read_text(encoding="utf-8")
LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH = (
    FIRMWARE_ROOT / "patches" / "esp-ml307-local-dock-websocket-safety.patch"
).read_text(encoding="utf-8")
AUDIO_SERVICE_HEADER = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "audio" / "audio_service.h").read_text(encoding="utf-8")
FLASH_SCRIPT = (ROOT / "ops" / "bin" / "flash-xiaozhi-dock-app-only-resumable.ps1").read_text(encoding="utf-8")
DEV_HTTP = (FIRMWARE_ROOT / "main" / "hal" / "hal_dev_local_control.cpp").read_text(encoding="utf-8")
REMOTE_CONTROL = (ROOT / "tools" / "remote_control" / "remote_control.py").read_text(encoding="utf-8")
LAN_PROVISION = (ROOT / "tools" / "stackchan-dock" / "scripts" / "provision-xiaozhi-dock-lan.ps1").read_text(
    encoding="utf-8"
)
SPEAKER_HIL = (ROOT / "ops" / "bin" / "test-xiaozhi-speaker-hil.ps1").read_text(encoding="utf-8")
STACKCHAN_DISPLAY = (FIRMWARE_ROOT / "main" / "hal" / "board" / "stackchan_display.cc").read_text(encoding="utf-8")
STACKCHAN_BOARD = (FIRMWARE_ROOT / "main" / "hal" / "board" / "stackchan.cc").read_text(encoding="utf-8")
VOLUME_GESTURE = (FIRMWARE_ROOT / "main" / "hal" / "volume_gesture.cpp").read_text(encoding="utf-8")
APPLICATION = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "application.cc").read_text(encoding="utf-8")
LOCAL_DOCK_LED = (FIRMWARE_ROOT / "main" / "hal" / "hal_local_dock_led.cpp").read_text(encoding="utf-8")
SPEECH_BUBBLE = (FIRMWARE_ROOT / "main" / "stackchan" / "avatar" / "skins" / "default" / "speech_bubble.cpp").read_text(encoding="utf-8")
WEBSOCKET_PROTOCOL = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "protocols" / "websocket_protocol.cc").read_text(encoding="utf-8")
BLACK_SCREEN_FLIGHT = (FIRMWARE_ROOT / "main" / "hal" / "black_screen_flight_recorder.cpp").read_text(encoding="utf-8")


class XiaozhiLocalDockContractTests(unittest.TestCase):
    def test_profile_selects_official_application_runtime(self):
        self.assertIn("CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK=y", DEFAULTS)
        self.assertIn("CONFIG_STACKCHAN_USB_UAC_MVP=n", DEFAULTS)
        self.assertIn("CONFIG_STACKCHAN_WIFI_AUDIO_MVP=n", DEFAULTS)
        self.assertIn("CONFIG_USB_DEVICE_UAC_AS_PART=n", DEFAULTS)
        self.assertIn("GetHAL().startXiaozhi();", MAIN)

    def test_local_dock_keeps_the_shared_full_screen_volume_gesture(self):
        self.assertIn('#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK', APPLICATION)
        self.assertIn('start_stackchan_volume_gesture_task();', APPLICATION)
        self.assertIn('constexpr TickType_t kEventWaitTicks = portMAX_DELAY;', APPLICATION)
        self.assertIn('xTaskCreatePinnedToCore(volume_gesture_task, "volume_gesture", 4096, nullptr, 1, &task_handle, 0);', VOLUME_GESTURE)
        self.assertIn('vTaskDelay(pdMS_TO_TICKS(20));', VOLUME_GESTURE)
        self.assertIn('lv_indev_wait_release(indev);', VOLUME_GESTURE)
        self.assertIn('GetHAL().setSpeakerVolume(current_volume_, true);', VOLUME_GESTURE)

    def test_screen_chat_toggle_safely_cancels_an_active_assistant_reply(self):
        toggle = APPLICATION.split('void Application::HandleToggleChatEvent()', 1)[1].split(
            'void Application::ContinueOpenAudioChannel', 1
        )[0]
        speaking = toggle.split('if (state == kDeviceStateSpeaking) {', 1)[1].split('\n    }', 1)[0]
        self.assertIn('AbortSpeaking(kAbortReasonNone);', speaking)
        self.assertIn('protocol_->CloseAudioChannel();', speaking)
        self.assertIn('audio_service_.ResetDecoder();', speaking)
        self.assertIn('stackchan_local_dock_user_disconnect_led_off();', speaking)
        self.assertIn('SetDeviceState(kDeviceStateIdle);', speaking)
        self.assertNotIn('screen_chat_toggle_ignored state=speaking', toggle)
        self.assertLess(speaking.index('AbortSpeaking(kAbortReasonNone);'), speaking.index('protocol_->CloseAudioChannel();'))
        self.assertLess(speaking.index('protocol_->CloseAudioChannel();'), speaking.index('audio_service_.ResetDecoder();'))
        self.assertLess(speaking.index('audio_service_.ResetDecoder();'), speaking.index('SetDeviceState(kDeviceStateIdle);'))
        self.assertIn('protocol_->CloseAudioChannel();', toggle)
        self.assertIn('ContinueOpenAudioChannel(mode);', toggle)

    def test_confirmed_channel_close_leaves_decoder_to_audio_pipeline_before_idle(self):
        closed = APPLICATION.split('protocol_->OnAudioChannelClosed', 1)[1].split(
            'protocol_->OnIncomingJson', 1
        )[0]
        scheduled = closed.split('Schedule([this]() {', 1)[1]
        self.assertNotIn('audio_service_.ResetDecoder();', scheduled)
        self.assertIn('SetDeviceState(kDeviceStateIdle);', scheduled)

    def test_explicit_screen_disconnect_turns_off_both_neon_lights_before_close(self):
        toggle = APPLICATION.split('void Application::HandleToggleChatEvent()', 1)[1].split(
            'void Application::ContinueOpenAudioChannel', 1
        )[0]
        listening = toggle.split('} else if (state == kDeviceStateListening) {', 1)[1]
        self.assertIn('stackchan_local_dock_user_disconnect_led_off();', listening)
        self.assertLess(listening.index('stackchan_local_dock_user_disconnect_led_off();'), listening.index('protocol_->CloseAudioChannel();'))
        idle = toggle.split('if (state == kDeviceStateIdle)', 1)[1].split('} else if (state == kDeviceStateListening)', 1)[0]
        self.assertNotIn('stackchan_local_dock_user_disconnect_led_off();', idle)
        self.assertNotIn('screen_chat_toggle_ignored state=speaking', toggle)
        self.assertIn('leftNeonLight().snapColor(0, 0, 0);', LOCAL_DOCK_LED)
        self.assertIn('rightNeonLight().snapColor(0, 0, 0);', LOCAL_DOCK_LED)

    def test_first_connect_to_listening_syncs_both_neon_lights_without_touching_later_listening(self):
        self.assertIn('old_state == kDeviceStateConnecting && new_state == kDeviceStateListening', APPLICATION)
        self.assertIn('dock_connected_to_listening_ = true;', APPLICATION)
        listening = APPLICATION.split('case kDeviceStateListening:', 1)[1].split('case kDeviceStateSpeaking:', 1)[0]
        self.assertIn('if (dock_connected_to_listening_.exchange(false))', listening)
        self.assertIn('stackchan_local_dock_connected_led_green();', listening)
        self.assertIn('leftNeonLight().snapColor(0, 50, 0);', LOCAL_DOCK_LED)
        self.assertIn('rightNeonLight().snapColor(0, 50, 0);', LOCAL_DOCK_LED)

    def test_local_dock_streaming_subtitles_queue_sentences_without_repeat(self):
        self.assertIn('strcmp(state->valuestring, "sentence_append")', APPLICATION)
        self.assertIn('strcmp(state->valuestring, "subtitle_trim")', APPLICATION)
        self.assertIn('strcmp(state->valuestring, "response_end")', APPLICATION)
        self.assertIn('strcmp(state->valuestring, "subtitle_cancel")', APPLICATION)
        self.assertIn('AppendStreamingAssistantSubtitle', APPLICATION)
        self.assertIn('TrimStreamingAssistantSubtitle', APPLICATION)
        self.assertIn('EndStreamingAssistantSubtitle', APPLICATION)
        self.assertIn('CancelStreamingAssistantSubtitle', APPLICATION)
        self.assertIn('BeginStreamingAssistantSubtitle', APPLICATION)
        self.assertIn('appendStreamingSpeech', STACKCHAN_DISPLAY)
        self.assertIn('trimStreamingSpeech', STACKCHAN_DISPLAY)
        self.assertIn('endStreamingSpeech', STACKCHAN_DISPLAY)
        self.assertIn('cancelStreamingSpeech', STACKCHAN_DISPLAY)
        self.assertIn('LV_LABEL_LONG_MODE_CLIP', SPEECH_BUBBLE)
        self.assertIn('complete = _streaming_offset_px >= static_cast<uint32_t>(_streaming_cycle_width_px);', SPEECH_BUBBLE)
        self.assertIn('_streaming_offset_px += 4;', SPEECH_BUBBLE)
        self.assertIn('_streaming_sentence_ended', SPEECH_BUBBLE)
        self.assertIn('if (!_streaming_sentence_ended)', SPEECH_BUBBLE)
        self.assertIn('bool _streaming_display_expired = false;', (FIRMWARE_ROOT / "main" / "stackchan" / "avatar" / "skins" / "default" / "default.h").read_text(encoding="utf-8"))
        self.assertIn('if (_streaming_display_expired)', SPEECH_BUBBLE)
        self.assertIn('return false;', SPEECH_BUBBLE[SPEECH_BUBBLE.index('if (_streaming_display_expired)'):SPEECH_BUBBLE.index('// A natural subtitle boundary')])
        self.assertIn('_streaming_display_expired = true;', SPEECH_BUBBLE)
        self.assertIn('kShortSentenceHoldMs = 1600', SPEECH_BUBBLE)
        self.assertIn('if (_streaming_queue.empty()) {', SPEECH_BUBBLE)
        self.assertLess(
            SPEECH_BUBBLE.index('if (!_streaming_sentence_ended)', SPEECH_BUBBLE.index('void DefaultSpeechBubble::advanceStreamingMarquee')),
            SPEECH_BUBBLE.index('if (_streaming_queue.empty()) {', SPEECH_BUBBLE.index('void DefaultSpeechBubble::advanceStreamingMarquee')),
        )
        self.assertIn('if (_streaming_cycle_width_px <= 0) _streaming_elapsed_ms = 0;', SPEECH_BUBBLE)
        self.assertNotIn('if (_streaming_cycle_width_px > 0 && _streaming_queue.empty())', SPEECH_BUBBLE)
        self.assertIn('const uint32_t removable_px = _streaming_offset_px > _text_mx', SPEECH_BUBBLE)
        self.assertIn('const size_t codepoint_bytes = (lead < 0x80)', SPEECH_BUBBLE)
        self.assertIn('_streaming_text.erase(0, prefix_bytes)', SPEECH_BUBBLE)
        self.assertIn('_streaming_offset_px = prefix_width_px >= static_cast<int>(_streaming_offset_px)', SPEECH_BUBBLE)
        self.assertIn('kNextSentenceWaitMs = 1000', SPEECH_BUBBLE)
        self.assertIn('if (_streaming_waiting_for_next)', SPEECH_BUBBLE)
        self.assertIn('bool DefaultSpeechBubble::cancelStreamingSpeech(uint32_t subtitle_id)', SPEECH_BUBBLE)
        self.assertIn('_streaming_queue.erase(std::remove_if', SPEECH_BUBBLE)

    def test_local_dock_links_only_settings_and_ai_agent_mooncake_apps(self):
        self.assertIn('if(CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK)', MAIN_CMAKE)
        self.assertIn('list(FILTER STACK_CHAN_SOURCES EXCLUDE REGEX "/apps/app_(app_center|avatar|dance|espnow_ctrl|ezdata|template)/")', MAIN_CMAKE)
        local_profile = MAIN[MAIN.index('#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK', MAIN.index('GetMooncake().installApp(std::move(launcher));')):]
        local_profile = local_profile[:local_profile.index('#else')]
        self.assertIn('GetMooncake().installApp(std::make_unique<AppAiAgent>());', MAIN)
        self.assertIn('GetMooncake().installApp(std::make_unique<AppSetup>());', local_profile)
        self.assertNotIn('AppAvatar', local_profile)
        self.assertNotIn('AppEspnowControl', local_profile)
        self.assertNotIn('AppAppCenter', local_profile)
        self.assertNotIn('AppEzdata', local_profile)
        self.assertNotIn('AppDance', local_profile)

    def test_kconfig_keeps_local_dock_mutually_exclusive_with_private_audio_owners(self):
        self.assertIn("config STACKCHAN_XIAOZHI_LOCAL_DOCK", KCONFIG)
        self.assertIn("depends on BOARD_TYPE_M5STACK_STACK_CHAN && !STACKCHAN_USB_UAC_MVP && !STACKCHAN_WIFI_AUDIO_MVP", KCONFIG)
        self.assertIn("config STACKCHAN_XIAOZHI_LOCAL_ALLOW_INSECURE_HTTP", KCONFIG)

    def test_local_dock_profile_disables_only_automatic_idle_head_motion(self):
        self.assertIn("config STACKCHAN_XIAOZHI_DISABLE_IDLE_HEAD_MOTION", KCONFIG)
        self.assertIn("depends on STACKCHAN_XIAOZHI_LOCAL_DOCK", KCONFIG)
        self.assertIn("CONFIG_STACKCHAN_XIAOZHI_DISABLE_IDLE_HEAD_MOTION=y", DEFAULTS)
        idle_factory = STACKCHAN_DISPLAY[
            STACKCHAN_DISPLAY.index("void StackChanAvatarDisplay::CreateIdleMotionModifier()") :
            STACKCHAN_DISPLAY.index("void StackChanAvatarDisplay::SetEmotion")
        ]
        self.assertIn("#if CONFIG_STACKCHAN_XIAOZHI_DISABLE_IDLE_HEAD_MOTION", idle_factory)
        self.assertIn("idle_motion_modifier_id_ = -1;", idle_factory)
        self.assertIn("return;", idle_factory)
        self.assertNotIn("idle_expression_modifier_id_", idle_factory)
        self.assertIn("idle_motion_modifier_id_ < 0 && idle_motion_level_ > 0", STACKCHAN_DISPLAY)
        self.assertIn("if (idle_expression_modifier_id_ < 0)", STACKCHAN_DISPLAY)
        self.assertGreaterEqual(STACKCHAN_DISPLAY.count("if (idle_expression_modifier_id_ >= 0)"), 2)

    def test_local_dock_profile_can_disable_automatic_power_save_for_idle_failure_diagnosis(self):
        self.assertIn("config STACKCHAN_XIAOZHI_DISABLE_POWER_SAVE", KCONFIG)
        self.assertIn("depends on STACKCHAN_XIAOZHI_LOCAL_DOCK", KCONFIG)
        self.assertIn("CONFIG_STACKCHAN_XIAOZHI_DISABLE_POWER_SAVE=y", DEFAULTS)
        power_save_gate = STACKCHAN_BOARD[
            STACKCHAN_BOARD.index("bool ShouldEnablePowerSave") :
            STACKCHAN_BOARD.index("void UpdatePowerSaveEnabled")
        ]
        self.assertIn("#if CONFIG_STACKCHAN_XIAOZHI_DISABLE_POWER_SAVE", power_save_gate)
        self.assertIn("return false;", power_save_gate)
        self.assertIn("return is_discharging || (has_external_power && xiaozhi_config_.allowShutdownWhenCharging);", power_save_gate)

    def test_black_screen_flight_record_is_passive_and_persists_prior_boot_snapshot(self):
        self.assertIn("RTC_NOINIT_ATTR RtcBreadcrumb g_rtc_breadcrumb;", BLACK_SCREEN_FLIGHT)
        self.assertIn("void UpdateBreadcrumbFromMain(uint32_t now, FlightEvent event)", BLACK_SCREEN_FLIGHT)
        self.assertIn("constexpr uint32_t kBreadcrumbVersion = 4;", BLACK_SCREEN_FLIGHT)
        self.assertIn('writable.SetInt("reset_reason"', BLACK_SCREEN_FLIGHT)
        self.assertIn('writable.SetInt("last_event"', BLACK_SCREEN_FLIGHT)
        self.assertIn('writable.SetInt("last_event_us"', BLACK_SCREEN_FLIGHT)
        self.assertIn('settings.GetInt("reset_reason")', BLACK_SCREEN_FLIGHT)
        self.assertIn('settings.GetInt("last_event")', BLACK_SCREEN_FLIGHT)
        self.assertIn('settings.GetInt("last_event_us")', BLACK_SCREEN_FLIGHT)
        self.assertIn('writable.SetString("reason", "previous_boot_snapshot");', BLACK_SCREEN_FLIGHT)
        self.assertIn('writable.SetBool("pending", true);', BLACK_SCREEN_FLIGHT)
        self.assertNotIn("xTaskCreatePinnedToCore", BLACK_SCREEN_FLIGHT)
        self.assertNotIn("esp_restart();", BLACK_SCREEN_FLIGHT)
        self.assertNotIn("PersistAndRestart", BLACK_SCREEN_FLIGHT)
        self.assertIn("g_pending.store(false);", BLACK_SCREEN_FLIGHT)
        published = BLACK_SCREEN_FLIGHT[BLACK_SCREEN_FLIGHT.index("void MarkRecordPublished()"):]
        self.assertNotIn('EraseKey("pending")', published)

    def test_black_screen_flight_records_audio_and_close_phase_checkpoints_without_new_tasks(self):
        self.assertIn("enum class FlightEvent", (FIRMWARE_ROOT / "main" / "hal" / "black_screen_flight_recorder.h").read_text(encoding="utf-8"))
        self.assertIn("IncomingAudioFrame", BLACK_SCREEN_FLIGHT)
        self.assertIn("AudioChannelClosed", BLACK_SCREEN_FLIGHT)
        self.assertIn("stackchan_black_screen_flight::IncomingAudioFrame", WEBSOCKET_PROTOCOL)
        close_handler = APPLICATION[
            APPLICATION.index("protocol_->OnAudioChannelClosed") :
            APPLICATION.index("protocol_->OnIncomingJson")
        ]
        self.assertIn("stackchan_black_screen_flight::AudioChannelClosed();", close_handler)
        self.assertNotIn("xTaskCreate", BLACK_SCREEN_FLIGHT)

    def test_pending_flight_record_waits_for_live_transport_and_sends_once_per_boot(self):
        clock_tick = APPLICATION[
            APPLICATION.index("if (bits & MAIN_EVENT_CLOCK_TICK)") :
            APPLICATION.index("clock_ticks_++", APPLICATION.index("if (bits & MAIN_EVENT_CLOCK_TICK)"))
        ]
        pending = clock_tick.index("PendingRecordNotification()")
        gate = clock_tick.rfind("protocol_ && protocol_->IsAudioChannelOpened()", 0, pending)
        self.assertNotEqual(-1, gate)
        self.assertLess(gate, pending)
        self.assertIn("protocol_->SendMcpMessage(pending_flight_record);", clock_tick)
        self.assertIn("stackchan_black_screen_flight::MarkRecordPublished();", clock_tick)

    def test_audio_channel_close_does_not_reset_decoder_during_final_playback_transition(self):
        close_handler = APPLICATION[
            APPLICATION.index("protocol_->OnAudioChannelClosed") :
            APPLICATION.index("protocol_->OnIncomingJson")
        ]
        self.assertIn("board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);", close_handler)
        self.assertIn('display->SetChatMessage("system", "");', close_handler)
        self.assertIn("SetDeviceState(kDeviceStateIdle);", close_handler)
        self.assertNotIn("audio_service_.ResetDecoder();", close_handler)

    def test_ble_saves_bootstrap_url_and_secret_without_logging_secret(self):
        self.assertIn('Settings wifi_settings("wifi", true);', BLE)
        self.assertIn('wifi_settings.SetString("ota_url", url);', BLE)
        self.assertIn('Settings local_settings("xiaozhi_local", true);', BLE)
        self.assertIn('local_settings.SetString("token", key);', BLE)
        self.assertNotIn('"token={}"', BLE)
        self.assertNotIn('"key={}"', BLE)

    def test_ota_uses_pairing_token_only_as_bootstrap_bearer(self):
        self.assertIn('Settings local_settings("xiaozhi_local", false);', OTA)
        self.assertIn('http->SetHeader("Authorization", "Bearer " + local_token);', OTA)

    def test_authenticated_lan_provisioning_is_local_dock_only_and_fail_closed(self):
        self.assertIn('#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK', DEV_HTTP)
        self.assertIn('xiaozhi_local_config_uri.uri = "/dev/xiaozhi-local";', DEV_HTTP)
        handler = DEV_HTTP.index("esp_err_t xiaozhi_local_config_handler")
        token_check = DEV_HTTP.index("if (!check_token(req))", handler)
        body_limit = DEV_HTTP.index("kMaxBodyBytes", token_check)
        url_validation = DEV_HTTP.index("valid_xiaozhi_local_url", body_limit)
        key_validation = DEV_HTTP.index("valid_xiaozhi_local_token", url_validation)
        takeover_guard = DEV_HTTP.index('send_error(req, 409, "pairing_token_mismatch");', key_validation)
        first_write = DEV_HTTP.index('Settings local_settings("xiaozhi_local", true);', takeover_guard)
        first_commit = DEV_HTTP.index("local settings committed", first_write)
        second_write = DEV_HTTP.index('Settings wifi_settings("wifi", true);', first_commit)
        self.assertLess(token_check, body_limit)
        self.assertLess(body_limit, url_validation)
        self.assertLess(url_validation, key_validation)
        self.assertLess(key_validation, takeover_guard)
        self.assertLess(takeover_guard, first_write)
        self.assertLess(first_write, first_commit)
        self.assertLess(first_commit, second_write)
        self.assertIn('local_settings.SetString("token", key);', DEV_HTTP[first_write:second_write])
        self.assertIn('wifi_settings.SetString("ota_url", url);', DEV_HTTP[second_write:])

    def test_lan_provisioning_never_echoes_or_logs_pairing_token_and_restarts_after_response_delay(self):
        handler = DEV_HTTP[DEV_HTTP.index("esp_err_t xiaozhi_local_config_handler"):]
        self.assertNotIn('mclog::tagInfo(TAG, "token', handler)
        self.assertNotIn('mclog::tagInfo(TAG, "key', handler)
        self.assertIn('"{\\"ok\\":true,\\"configured\\":true,\\"restart_scheduled\\":true}"', handler)
        self.assertIn('"self.system.reboot"', handler)
        self.assertIn('cJSON_AddNumberToObject(reboot_args, "delay_ms", 1500);', handler)

    def test_pc_lan_provisioner_keeps_pairing_secret_out_of_command_line(self):
        self.assertIn('def configure_xiaozhi_local(self, bootstrap_url, pairing_token):', REMOTE_CONTROL)
        self.assertIn('"/dev/xiaozhi-local"', REMOTE_CONTROL)
        self.assertIn('STACKCHAN_WIFI_PAIRING_KEY', REMOTE_CONTROL)
        self.assertNotIn('--pairing-token', REMOTE_CONTROL)
        self.assertIn("ConvertTo-SecureString", LAN_PROVISION)
        self.assertIn("STACKCHAN_WIFI_PAIRING_KEY", LAN_PROVISION)
        self.assertIn("changes_pc_network = $false", LAN_PROVISION)
        self.assertIn("changes_robot_wifi_credentials = $false", LAN_PROVISION)

    def test_mobile_configuration_accepts_bootstrap_http_url(self):
        self.assertIn("endpoint.startsWith('https://')", APP)
        self.assertIn("endpoint.startsWith('http://')", APP)
        self.assertIn("XiaoZhi bootstrap", APP)

    def test_official_profile_keeps_safety_patches_and_defaults_performance_diagnostics_off(self):
        self.assertIn("if(CONFIG_STACKCHAN_WIFI_AUDIO_MVP)", FIRMWARE_CMAKE)
        self.assertIn("elseif(CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK)", FIRMWARE_CMAKE)
        self.assertIn("list(REVERSE STACKCHAN_ESP_ML307_REVERSE_PATCHES)", FIRMWARE_CMAKE)
        self.assertIn("--reverse", FIRMWARE_CMAKE)
        self.assertIn("xiaozhi-local-dock.patch", FIRMWARE_CMAKE)
        self.assertIn("xiaozhi-audio-performance-diagnostics.patch", FIRMWARE_CMAKE)
        self.assertIn('http->SetHeader("Authorization", "Bearer " + local_token);', LOCAL_DOCK_PATCH)
        self.assertNotIn("AUDIO_SERVICE_DIAG_ENABLED=", MAIN_CMAKE)
        self.assertIn("CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS", AUDIO_SERVICE_HEADER)
        self.assertIn("#define AUDIO_SERVICE_DIAG_ENABLED 1", AUDIO_SERVICE_HEADER)
        self.assertIn("#define AUDIO_SERVICE_DIAG_ENABLED 0", AUDIO_SERVICE_HEADER)

    def test_websocket_text_json_is_parsed_with_its_explicit_frame_length(self):
        self.assertIn("cJSON_ParseWithLength(data, len)", WEBSOCKET_PROTOCOL)
        self.assertIn("if (!root || !cJSON_IsObject(root))", WEBSOCKET_PROTOCOL)
        self.assertIn('"Invalid WebSocket JSON payload, length=%u"', WEBSOCKET_PROTOCOL)
        self.assertIn('"Missing WebSocket JSON message type, length=%u"', WEBSOCKET_PROTOCOL)
        self.assertNotIn("cJSON_Parse(data)", WEBSOCKET_PROTOCOL)
        self.assertNotIn('"Missing message type, data: %s"', WEBSOCKET_PROTOCOL)

    def test_local_dock_websocket_safety_patch_is_minimal_and_independent(self):
        self.assertIn("esp-ml307-local-dock-websocket-safety.patch", FIRMWARE_CMAKE)
        self.assertIn("OnStream", LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH)
        self.assertLess(
            LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH.index("OnStream"),
            LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH.index("发送 WebSocket 握手请求"),
        )
        self.assertIn("payload_length > receive_buffer_size_", LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH)
        self.assertIn(
            "payload.size() > receive_buffer_size_ - current_message_.size()",
            LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH,
        )
        self.assertNotIn("Abort", LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH)
        self.assertNotIn("tcp_->Disconnect(", LOCAL_DOCK_WEBSOCKET_SAFETY_PATCH)

    def test_hil_flash_is_pinned_app_only_and_requires_explicit_execute(self):
        self.assertIn("[string]$Stage = 'Offline'", FLASH_SCRIPT)
        self.assertIn("if ($Stage -eq 'Offline')", FLASH_SCRIPT)
        self.assertIn("$appOffset = [long]0x20000", FLASH_SCRIPT)
        self.assertIn("$appPartitionSize = [long]0x4f0000", FLASH_SCRIPT)
        self.assertIn("ConfirmSerialDeviceDisruption", FLASH_SCRIPT)
        self.assertIn("ConfirmedOta0IsIntendedTarget", FLASH_SCRIPT)
        self.assertIn("Invoke-StackChanAppOnlyTransaction", FLASH_SCRIPT)
        self.assertIn("'verify_flash'", FLASH_SCRIPT)
        self.assertNotIn("0x0',", FLASH_SCRIPT)

    def test_known_source_injection_task_uses_external_stack_memory(self):
        self.assertIn('xTaskCreatePinnedToCoreWithCaps(', DEV_HTTP)
        self.assertIn('inject_prompt_task, "inject_prompt", 4096,', DEV_HTTP)
        self.assertIn('MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT', DEV_HTTP)
        injection_task = DEV_HTTP[
            DEV_HTTP.index("void inject_prompt_task") : DEV_HTTP.index("esp_err_t inject_prompt_handler")
        ]
        self.assertEqual(injection_task.count("vTaskDeleteWithCaps(nullptr);"), 3)
        self.assertNotIn("vTaskDelete(nullptr);", injection_task)

    def test_speaker_hil_wakes_official_client_after_temporary_dock_starts(self):
        dock_start = SPEAKER_HIL.index("$dock = & $dockScript")
        wake = SPEAKER_HIL.index("'wake'", dock_start)
        authentication_deadline = SPEAKER_HIL.index("$deadline =", dock_start)
        self.assertLess(dock_start, wake)
        self.assertLess(wake, authentication_deadline)
        self.assertIn("$remoteControl", SPEAKER_HIL[dock_start:wake])
        self.assertIn("if ($LASTEXITCODE -ne 0)", SPEAKER_HIL[wake:authentication_deadline])
        self.assertIn("Get-Content -Raw -LiteralPath $dock.StderrLog", SPEAKER_HIL)
        self.assertNotIn("[System.IO.File]::ReadAllText($dock.StderrLog)", SPEAKER_HIL)


if __name__ == "__main__":
    unittest.main()
