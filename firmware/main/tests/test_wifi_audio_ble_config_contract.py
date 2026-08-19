"""Static contract tests for Wi-Fi Audio provisioning over the existing BLE config channel."""

from pathlib import Path
import json
import hashlib
import hmac
import struct
import unittest


SOURCE = (Path(__file__).resolve().parents[1] / "hal" / "hal_ble.cpp").read_text(encoding="utf-8")
WIFI_AUDIO_SOURCE = (Path(__file__).resolve().parents[1] / "hal" / "wifi_audio_dock_mvp.cpp").read_text(encoding="utf-8")
UDP_CONTRACT_VECTOR_PATH = Path(__file__).resolve().parents[3] / "tools" / "stackchan-dock" / "test" / "fixtures" / "wifi-audio-udp-v1.json"
CODEC_SOURCE = (Path(__file__).resolve().parents[1] / "hal" / "board" / "cores3_audio_codec.cc").read_text(encoding="utf-8")
CODEC_HEADER_SOURCE = (Path(__file__).resolve().parents[1] / "hal" / "board" / "cores3_audio_codec.h").read_text(encoding="utf-8")
DISPLAY_SOURCE = (Path(__file__).resolve().parents[1] / "hal" / "board" / "stackchan_display.cc").read_text(encoding="utf-8")
MAIN_SOURCE = (Path(__file__).resolve().parents[1] / "main.cpp").read_text(encoding="utf-8")
KCONFIG_SOURCE = (Path(__file__).resolve().parents[1] / "Kconfig.projbuild").read_text(encoding="utf-8")
FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
OFFICIAL_CODEC_SOURCE = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "boards" / "m5stack-core-s3" / "cores3_audio_codec.cc").read_text(encoding="utf-8")
FIRMWARE_CMAKE = (FIRMWARE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
WIFI_AUDIO_SDKCONFIG_DEFAULTS = (FIRMWARE_ROOT / "sdkconfig.wifi_audio.defaults").read_text(encoding="utf-8")
ESP_ML307_PATCH = (FIRMWARE_ROOT / "patches" / "esp-ml307-wifi-audio-bounded-send.patch").read_text(encoding="utf-8")
ESP_ML307_PLAIN_TCP_PATCH = (FIRMWARE_ROOT / "patches" / "esp-ml307-wifi-audio-plain-tcp.patch").read_text(encoding="utf-8")
ESP_ML307_RECEIVE_LIMIT_PATCH = (FIRMWARE_ROOT / "patches" / "esp-ml307-wifi-audio-receive-limit.patch").read_text(encoding="utf-8")
ESP_ML307_WEBSOCKET_LIFECYCLE_PATCH = (FIRMWARE_ROOT / "patches" / "esp-ml307-wifi-audio-websocket-lifecycle.patch").read_text(encoding="utf-8")
MANAGED_ROOT = Path(__file__).resolve().parents[2] / "managed_components" / "78__esp-ml307"
FLASH_SCRIPT = (FIRMWARE_ROOT.parent / "ops" / "bin" / "flash-wifi-audio-final.ps1").read_text(encoding="utf-8")
WEB_SOCKET_HEADER = (MANAGED_ROOT / "include" / "web_socket.h").read_text(encoding="utf-8")
WEB_SOCKET_SOURCE = (MANAGED_ROOT / "src" / "web_socket.cc").read_text(encoding="utf-8")
TCP_HEADER = (MANAGED_ROOT / "include" / "tcp.h").read_text(encoding="utf-8")
ESP_TCP_SOURCE = (MANAGED_ROOT / "src" / "esp" / "esp_tcp.cc").read_text(encoding="utf-8")
ESP_SSL_SOURCE = (MANAGED_ROOT / "src" / "esp" / "esp_ssl.cc").read_text(encoding="utf-8")
PRIVATE_TRANSPORT_PATCHES_ACTIVE = "void Abort();" in WEB_SOCKET_HEADER
requires_private_transport_patches = unittest.skipUnless(
    PRIVATE_TRANSPORT_PATCHES_ACTIVE,
    "private Wi-Fi MVP transport patches are intentionally absent in the official XiaoZhi profile",
)


class WifiAudioBleConfigContractTests(unittest.TestCase):
    def test_wifi_audio_lwip_allocations_prefer_psram_before_internal_memory(self):
        option = "CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y"
        self.assertIn(option, WIFI_AUDIO_SDKCONFIG_DEFAULTS)
        self.assertIn("CONFIG_ESP_WIFI_STATIC_TX_BUFFER_NUM=8", WIFI_AUDIO_SDKCONFIG_DEFAULTS)

    def test_shared_udp_wire_and_hmac_vector_matches_the_firmware_contract(self):
        vector = json.loads(UDP_CONTRACT_VECTOR_PATH.read_text(encoding="utf-8"))
        pairing_key = vector["pairingKey"].encode("utf-8")
        session = bytes.fromhex(vector["sessionHex"])
        key_input = (b"stackchan-wifi-audio-udp-v1\n" + vector["deviceId"].encode("utf-8") +
                     b"\n" + vector["nonce"].encode("utf-8") + b"\n" + session)
        session_key = hmac.new(pairing_key, key_input, hashlib.sha256).digest()
        self.assertEqual(session_key.hex(), vector["sessionKeyHex"])
        proof_input = (f"stackchan-wifi-audio-udp-ready-v1\n{vector['deviceId']}\n{vector['nonce']}\n"
                       f"{vector['port']}\n{vector['sessionHex']}").encode("utf-8")
        self.assertEqual(hmac.new(pairing_key, proof_input, hashlib.sha256).hexdigest(), vector["readyProofHex"])
        self.assertEqual(vector["pcmPattern"], "byte_index_mod_256")
        pcm = bytes(index % 256 for index in range(vector["pcmBytes"]))
        header = (b"SCAU" + bytes((1, 2)) + struct.pack(">IQH", vector["sequence"],
                 int(vector["captureTimeUs"]), len(pcm)) + session)
        tag = hmac.new(session_key, header + pcm, hashlib.sha256).digest()[:16]
        packet = header + pcm + tag
        self.assertEqual(len(packet), vector["packetBytes"])
        self.assertEqual(hashlib.sha256(packet).hexdigest(), vector["packetSha256"])
        self.assertIn('constexpr size_t kMicrophoneUdpHeaderBytes = 36;', WIFI_AUDIO_SOURCE)
        self.assertIn('write_u32be(packet.data() + 6, wire_sequence);', WIFI_AUDIO_SOURCE)
        self.assertIn('write_u64be(packet.data() + 10, frame.capture_time_us);', WIFI_AUDIO_SOURCE)
        self.assertIn('write_u16be(packet.data() + 18, frame.payload_length);', WIFI_AUDIO_SOURCE)
        self.assertIn('std::memcpy(packet.data() + 20, s_microphone_udp_session.session.data()', WIFI_AUDIO_SOURCE)

    def test_audio_configuration_is_explicit_and_persisted(self):
        self.assertIn('doc["cmd"] == "setWifiAudio"', SOURCE)
        self.assertIn('Settings settings("wifi_audio", true);', SOURCE)
        self.assertIn('settings.SetString("url", url);', SOURCE)
        self.assertIn('settings.SetString("key", key);', SOURCE)
        self.assertIn('settings.SetBool("configured", true);', SOURCE)

    def test_configuration_requires_wss_unless_the_explicit_dev_switch_is_enabled(self):
        self.assertIn('std::string_view(key).size() != 64', SOURCE)
        self.assertIn('url_value.rfind("wss://", 0) == 0', SOURCE)
        self.assertIn('#if CONFIG_STACKCHAN_WIFI_AUDIO_ALLOW_INSECURE_WS', SOURCE)
        self.assertIn('url_value.rfind("ws://", 0) == 0', SOURCE)
        self.assertIn('wifiAudioConfigFailed', SOURCE)

    def test_wifi_password_and_audio_key_are_not_logged(self):
        self.assertNotIn('get wifi config: {} / {}', SOURCE)
        self.assertIn('received Wi-Fi configuration for ssid={}', SOURCE)
        self.assertNotIn('Wi-Fi Audio receiver configuration updated: {}', SOURCE)

    def test_first_boot_waits_for_ble_configuration_instead_of_resetting(self):
        self.assertIn('Wi-Fi Audio is waiting for BLE PC Dock configuration', WIFI_AUDIO_SOURCE)
        self.assertIn('xTaskCreate(transport_bootstrap_task', WIFI_AUDIO_SOURCE)

    def test_transport_waits_for_the_existing_ble_wifi_station(self):
        self.assertNotIn('GetHAL().startNetwork', WIFI_AUDIO_SOURCE)
        self.assertIn('esp_wifi_sta_get_ap_info', WIFI_AUDIO_SOURCE)
        self.assertIn('Wi-Fi Audio is waiting for Wi-Fi association', WIFI_AUDIO_SOURCE)

    def test_transport_disables_modem_sleep_for_realtime_audio_after_association(self):
        self.assertIn('configure_realtime_wifi_mode(ap_info)', WIFI_AUDIO_SOURCE)
        self.assertIn('esp_wifi_get_ps(&previous_mode)', WIFI_AUDIO_SOURCE)
        self.assertIn('esp_wifi_set_ps(WIFI_PS_NONE)', WIFI_AUDIO_SOURCE)
        self.assertIn('esp_wifi_get_ps(&active_mode)', WIFI_AUDIO_SOURCE)
        self.assertIn('active_mode != WIFI_PS_NONE', WIFI_AUDIO_SOURCE)
        self.assertIn('channel=%u rssi=%d power_save=%d->%d', WIFI_AUDIO_SOURCE)

    def test_wifi_audio_raises_the_generic_tcp_receiver_above_audio_workers(self):
        self.assertIn('constexpr UBaseType_t kWifiAudioTcpReceivePriority = 5;', WIFI_AUDIO_SOURCE)
        self.assertIn('socket->GetReceiveTaskHandle()', WIFI_AUDIO_SOURCE)
        self.assertIn('vTaskPrioritySet(receive_task, kWifiAudioTcpReceivePriority)', WIFI_AUDIO_SOURCE)
        self.assertIn('TCP receive task priority=%u->%u', WIFI_AUDIO_SOURCE)

    def test_companion_modes_do_not_install_the_servo_moving_head_pet_modifier(self):
        self.assertIn(
            '#if !CONFIG_STACKCHAN_USB_UAC_MVP && !CONFIG_STACKCHAN_WIFI_AUDIO_MVP',
            DISPLAY_SOURCE,
        )
        self.assertIn('stackchan.addModifier(std::make_unique<HeadPetModifier>());', DISPLAY_SOURCE)

    def test_wifi_head_swipes_only_set_microphone_and_publish_revisioned_events(self):
        self.assertIn('std::atomic_uint32_t s_audio_state_revision{1};', WIFI_AUDIO_SOURCE)
        self.assertIn('std::atomic_uint32_t s_event_sequence{0};', WIFI_AUDIO_SOURCE)
        self.assertIn('const char* gesture_name(HeadPetGesture gesture)', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddNumberToObject(result, "revision", s_audio_state_revision.load());', WIFI_AUDIO_SOURCE)
        self.assertIn('void update_audio_paths(bool microphone_enabled, bool speaker_enabled, const char* source,', WIFI_AUDIO_SOURCE)
        self.assertIn('update_audio_paths(true, s_speaker_enabled.load(), "touch_swipe_forward")', WIFI_AUDIO_SOURCE)
        self.assertIn('update_audio_paths(false, s_speaker_enabled.load(), "touch_swipe_backward")', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddStringToObject(body, "gesture", gesture_name(gesture));', WIFI_AUDIO_SOURCE)
        self.assertNotIn('cJSON_AddNumberToObject(body, "gesture",static_cast<int>(gesture))', WIFI_AUDIO_SOURCE)

    def test_wifi_dock_rejects_head_motion_until_the_servo_bug_is_resolved(self):
        self.assertIn('"head_motion_disabled"', WIFI_AUDIO_SOURCE)
        self.assertIn('"head motion is disabled until the servo power-loss bug is resolved"', WIFI_AUDIO_SOURCE)
        self.assertNotIn('"self.robot.set_head_angles"', WIFI_AUDIO_SOURCE)

    def test_wifi_status_led_tracks_transport_microphone_playback_and_faults(self):
        self.assertIn('constexpr RgbColor kWaitingLed{48, 32, 0};', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr RgbColor kListeningLed{0, 48, 0};', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr RgbColor kMicrophoneOffLed{24, 24, 24};', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr RgbColor kPlayingLed{0, 0, 48};', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr RgbColor kFaultLed{48, 0, 0};', WIFI_AUDIO_SOURCE)
        self.assertIn('std::atomic_bool s_speaker_playback_active{false};', WIFI_AUDIO_SOURCE)
        self.assertIn('std::atomic_bool s_led_update_requested{true};', WIFI_AUDIO_SOURCE)
        self.assertIn('void set_transport_state(TransportState state)', WIFI_AUDIO_SOURCE)
        self.assertIn('void request_wifi_audio_status_led(bool clear_manual = false)', WIFI_AUDIO_SOURCE)
        self.assertIn('void service_wifi_audio_status_led()', WIFI_AUDIO_SOURCE)
        self.assertIn('void show_temporary_led(const RgbColor& color)', WIFI_AUDIO_SOURCE)

    def test_realtime_workers_never_wait_for_lvgl_to_change_status_leds(self):
        playback_setter = WIFI_AUDIO_SOURCE.split(
            'void set_speaker_playback_active(bool active)', 1
        )[1].split('void write_u16be', 1)[0]
        self.assertIn('request_wifi_audio_status_led();', playback_setter)
        self.assertNotIn('apply_led_color', playback_setter)
        self.assertNotIn('LvglLockGuard', playback_setter)
        self.assertIn('Only this low-priority worker may wait for LVGL', WIFI_AUDIO_SOURCE)

    def test_tcp_receive_callback_only_queues_control_commands(self):
        on_data = WIFI_AUDIO_SOURCE.split('socket->OnData(', 1)[1].split(
            'socket->OnDisconnected(', 1
        )[0]
        self.assertIn('enqueue_command_frame(', on_data)
        self.assertNotIn('handle_command(', on_data)
        self.assertNotIn('send_result(', on_data)
        self.assertNotIn('socket->Send(', on_data)

    def test_application_websocket_writes_have_one_stream_owner_after_direct_hello(self):
        self.assertIn('void wifi_tx_task(void*)', WIFI_AUDIO_SOURCE)
        self.assertEqual(WIFI_AUDIO_SOURCE.count('socket->Send('), 2)
        tx_task = WIFI_AUDIO_SOURCE.split('void wifi_tx_task(void*)', 1)[1].split(
            'void command_task(void*)', 1
        )[0]
        self.assertIn('socket->Send(', tx_task)
        self.assertIn('s_control_tx_queue', tx_task)
        self.assertIn('s_microphone_tx_queue', tx_task)
        self.assertIn('send_microphone_udp(microphone_frame);', tx_task)
        self.assertIn('if (!s_ready.load()) continue;', tx_task)
        self.assertIn('socket->Abort();', tx_task)
        direct_hello = WIFI_AUDIO_SOURCE.split('bool send_json_direct_to_socket(', 1)[1].split(
            'void send_error(', 1
        )[0]
        self.assertEqual(direct_hello.count('socket->Send('), 1)

    @requires_private_transport_patches
    def test_wifi_audio_aborts_after_every_send_failure_to_preserve_websocket_framing(self):
        self.assertIn('constexpr int kWifiAudioSendTimeoutMs = 200;', WIFI_AUDIO_SOURCE)
        self.assertIn('socket->SetSendTimeout(kWifiAudioSendTimeoutMs);', WIFI_AUDIO_SOURCE)
        self.assertIn('const int send_error = socket->GetLastError();', WIFI_AUDIO_SOURCE)
        failed_send = WIFI_AUDIO_SOURCE.split('if (!sent) {', 1)[1].split('} else {', 1)[0]
        self.assertIn('socket->Abort();', failed_send)
        self.assertNotIn('send_error != EAGAIN', failed_send)
        self.assertIn('void SetSendTimeout(int timeout_ms);', WEB_SOCKET_HEADER)
        self.assertIn('virtual bool SetSendTimeout(int timeout_ms)', TCP_HEADER)
        self.assertIn('SO_SNDTIMEO', ESP_TCP_SOURCE)
        self.assertIn('SO_SNDTIMEO', ESP_SSL_SOURCE)
        self.assertIn('last_error_ = ETIMEDOUT;', ESP_SSL_SOURCE)
        want_write = ESP_SSL_SOURCE.split(
            'if (ret == ESP_TLS_ERR_SSL_WANT_WRITE)', 1
        )[1].split('if (ret <= 0)', 1)[0]
        self.assertNotIn('continue;', want_write)

    @requires_private_transport_patches
    def test_websocket_installs_handshake_callbacks_before_send_and_closes_every_failure(self):
        connect = WEB_SOCKET_SOURCE.split('bool WebSocket::Connect', 1)[1].split(
            'bool WebSocket::Send(const std::string& data)', 1
        )[0]
        callback_index = connect.index('tcp_->OnStream')
        send_index = connect.index('tcp_->Send(request)')
        self.assertLess(callback_index, send_index)
        self.assertIn('handshake_completed_ = false;', connect)
        self.assertIn('receive_buffer_.clear();', connect)
        self.assertGreaterEqual(connect.count('tcp_->Disconnect();'), 5)
        destructor = WEB_SOCKET_SOURCE.split('WebSocket::~WebSocket()', 1)[1].split(
            'void WebSocket::SetHeader', 1
        )[0]
        self.assertIn('if (tcp_)', destructor)
        self.assertIn('tcp_->Disconnect();', destructor)

    @requires_private_transport_patches
    def test_wifi_audio_disables_nagle_for_10ms_realtime_frames_on_plain_and_tls(self):
        self.assertIn('socket->SetNoDelay(true);', WIFI_AUDIO_SOURCE)
        self.assertIn('void SetNoDelay(bool enabled);', WEB_SOCKET_HEADER)
        self.assertIn('virtual bool SetNoDelay(bool enabled)', TCP_HEADER)
        self.assertIn('TCP_NODELAY', ESP_TCP_SOURCE)
        self.assertIn('TCP_NODELAY', ESP_SSL_SOURCE)
        self.assertIn('TCP_NODELAY', ESP_ML307_PATCH)

    def test_managed_websocket_hardening_is_reproducibly_patched(self):
        self.assertIn('esp-ml307-wifi-audio-bounded-send.patch', FIRMWARE_CMAKE)
        self.assertIn('esp-ml307-wifi-audio-plain-tcp.patch', FIRMWARE_CMAKE)
        self.assertIn('esp-ml307-wifi-audio-receive-limit.patch', FIRMWARE_CMAKE)
        self.assertIn('esp-ml307-wifi-audio-websocket-lifecycle.patch', FIRMWARE_CMAKE)
        self.assertIn('foreach(STACKCHAN_ESP_ML307_PATCH IN LISTS STACKCHAN_ESP_ML307_PATCHES)', FIRMWARE_CMAKE)
        self.assertIn('--directory=${STACKCHAN_ESP_ML307_DIR}', FIRMWARE_CMAKE)
        self.assertIn('--reverse --check', FIRMWARE_CMAKE)
        self.assertIn('--check "${STACKCHAN_ESP_ML307_PATCH}"', FIRMWARE_CMAKE)
        self.assertIn('SO_SNDTIMEO', ESP_ML307_PATCH)
        self.assertIn('TaskHandle_t GetReceiveTaskHandle() const', ESP_ML307_PATCH)
        self.assertIn('SO_RCVTIMEO', ESP_ML307_PLAIN_TCP_PATCH)
        self.assertIn('EAGAIN || receive_error == EWOULDBLOCK', ESP_ML307_PLAIN_TCP_PATCH)
        self.assertIn('tcp_->OnStream', ESP_ML307_WEBSOCKET_LIFECYCLE_PATCH)
        self.assertGreaterEqual(ESP_ML307_WEBSOCKET_LIFECYCLE_PATCH.count('tcp_->Disconnect();'), 4)

    @requires_private_transport_patches
    def test_websocket_abort_converges_disconnected_state_for_every_transport(self):
        abort = WEB_SOCKET_SOURCE.split('void WebSocket::Abort()', 1)[1].split(
            'void WebSocket::OnConnected', 1
        )[0]
        self.assertIn('tcp_->Disconnect();', abort)
        self.assertIn('connected_.exchange(false)', abort)
        self.assertIn('on_disconnected_();', abort)
        self.assertIn('std::atomic_bool connected_{false};', WEB_SOCKET_HEADER)

    @requires_private_transport_patches
    def test_peer_close_frame_aborts_transport_from_receive_task(self):
        close_frame = WEB_SOCKET_SOURCE.split('case 0x8: // 关闭帧', 1)[1].split(
            'case 0x9: // Ping', 1
        )[0]
        self.assertIn('Abort();', close_frame)
        self.assertNotIn('connected_.exchange(false)', close_frame)

    @requires_private_transport_patches
    def test_tls_disconnect_never_fatally_asserts_or_frees_under_a_live_receiver(self):
        disconnect = ESP_SSL_SOURCE.split('void EspSsl::Disconnect()', 1)[1].split(
            'int EspSsl::Send', 1
        )[0]
        self.assertNotIn('ESP_ERROR_CHECK', disconnect)
        self.assertIn('receive_task_handle_ == xTaskGetCurrentTaskHandle()', disconnect)
        self.assertIn('shutdown(socket_fd, SHUT_RDWR);', disconnect)
        self.assertNotIn('close(socket_fd);', disconnect)
        self.assertIn('pdFALSE, pdFALSE, portMAX_DELAY', disconnect)
        self.assertNotIn('vTaskDelete(receive_task_handle_)', disconnect)
        destroy_index = disconnect.index('esp_tls_conn_destroy(tls_client_);')
        wait_index = disconnect.index('xEventGroupWaitBits(')
        self.assertGreater(destroy_index, wait_index)
        self.assertIn(
            'DoDisconnect(xTaskGetCurrentTaskHandle() != receive_task_handle_);',
            ESP_TCP_SOURCE,
        )
        self.assertIn('shutdown(tcp_fd_, SHUT_RDWR);', ESP_TCP_SOURCE)
        self.assertNotIn('vTaskDelete(receive_task_handle_)', ESP_TCP_SOURCE)

    @requires_private_transport_patches
    def test_plain_tcp_receiver_has_a_bounded_abort_wakeup(self):
        connect = ESP_TCP_SOURCE.split('bool EspTcp::Connect', 1)[1].split(
            'void EspTcp::Disconnect', 1
        )[0]
        receive = ESP_TCP_SOURCE.split('void EspTcp::ReceiveTask()', 1)[1].split(
            'int EspTcp::GetLastError()', 1
        )[0]
        self.assertIn('SO_RCVTIMEO', connect)
        self.assertIn('receive_timeout.tv_usec = 250 * 1000;', connect)
        self.assertIn('receive_error == EAGAIN || receive_error == EWOULDBLOCK', receive)
        self.assertIn('if (connected_) continue;', receive)

    @requires_private_transport_patches
    def test_plain_tcp_receive_task_creation_failure_is_recoverable(self):
        connect = ESP_TCP_SOURCE.split('bool EspTcp::Connect', 1)[1].split(
            'void EspTcp::Disconnect', 1
        )[0]
        self.assertIn('const BaseType_t receive_task_result = xTaskCreate(', connect)
        self.assertIn('if (receive_task_result != pdPASS)', connect)
        self.assertIn('last_error_ = ENOMEM;', connect)
        self.assertIn('receive_task_handle_ = nullptr;', connect)
        self.assertIn('connected_ = false;', connect)
        self.assertIn('shutdown(tcp_fd_, SHUT_RDWR);', connect)
        self.assertIn('tcp_fd_ = -1;', connect)
        self.assertIn('return false;', connect)

        disconnect = ESP_TCP_SOURCE.split('void EspTcp::DoDisconnect', 1)[1].split(
            'int EspTcp::Send', 1
        )[0]
        self.assertIn('if (wait_for_task && receive_task_handle_ != nullptr)', disconnect)
        self.assertNotIn('portMAX_DELAY', disconnect)
        self.assertIn('esp_restart();', disconnect)

        self.assertIn('receive_task_result != pdPASS', ESP_ML307_PLAIN_TCP_PATCH)
        self.assertIn('wait_for_task && receive_task_handle_ != nullptr', ESP_ML307_PLAIN_TCP_PATCH)
        self.assertIn('+                esp_restart();', ESP_ML307_PLAIN_TCP_PATCH)
        self.assertIn('diff --git a/src/esp/esp_tcp.h b/src/esp/esp_tcp.h',
                      ESP_ML307_PLAIN_TCP_PATCH)
        for declaration in (
            'bool SetSendTimeout(int timeout_ms) override;',
            'bool SetNoDelay(bool enabled) override;',
            'TaskHandle_t GetReceiveTaskHandle() const override;',
        ):
            self.assertIn(f'+    {declaration}', ESP_ML307_PLAIN_TCP_PATCH)

    @requires_private_transport_patches
    def test_websocket_receive_limit_is_enforced_before_allocation_and_fragment_append(self):
        self.assertIn('payload_length > receive_buffer_size_', WEB_SOCKET_SOURCE)
        self.assertIn('payload.size() > receive_buffer_size_ - current_message_.size()', WEB_SOCKET_SOURCE)
        self.assertIn('Abort();', WEB_SOCKET_SOURCE)
        self.assertIn('payload_length > receive_buffer_size_', ESP_ML307_RECEIVE_LIMIT_PATCH)
        self.assertIn('fragmented message exceeds receive limit', ESP_ML307_RECEIVE_LIMIT_PATCH)

    def test_protected_flash_script_backs_up_current_app_before_write(self):
        backup = FLASH_SCRIPT.index("$backupPath =")
        read_flash = FLASH_SCRIPT.index("'read_flash'", backup)
        write_flash = FLASH_SCRIPT.index("'write_flash'", read_flash)
        verify_flash = FLASH_SCRIPT.index("'verify_flash'", write_flash)
        self.assertLess(backup, read_flash)
        self.assertLess(read_flash, write_flash)
        self.assertLess(write_flash, verify_flash)
        self.assertIn('$appPartitionSize', FLASH_SCRIPT[read_flash:write_flash])
        self.assertIn('Get-FileHash -LiteralPath $backupPath', FLASH_SCRIPT)

    def test_protected_flash_script_reuses_only_a_verified_full_backup(self):
        reuse = FLASH_SCRIPT.index('if ($ExistingBackupPath)')
        write_flash = FLASH_SCRIPT.index("'write_flash'", reuse)
        guarded = FLASH_SCRIPT[reuse:write_flash]
        self.assertIn('$backup.Length -ne $appPartitionSize', guarded)
        self.assertIn('$sidecarPath = "$backupPath.sha256.txt"', guarded)
        self.assertIn('Get-FileHash -LiteralPath $backupPath -Algorithm SHA256', guarded)
        self.assertIn('$sidecarHash -ne $backupHash', guarded)
        self.assertIn('Reusing verified full ota_0 rollback backup', guarded)

    def test_audio_and_control_frames_have_independent_protocol_limits(self):
        self.assertIn('constexpr size_t kAudioFrameBytes = 16 + kPcmBytes;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kControlFrameBytes = 1500;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kMaxWebSocketFrameBytes = kControlFrameBytes;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kMicrophoneUdpMaxPacketBytes = 1200;', WIFI_AUDIO_SOURCE)
        self.assertIn('kMicrophoneUdpMaxPacketBytes - kMicrophoneUdpHeaderBytes - kMicrophoneUdpTagBytes;', WIFI_AUDIO_SOURCE)
        self.assertIn('static_assert(kMicrophoneUdpMaxPayloadBytes == 1148', WIFI_AUDIO_SOURCE)
        self.assertIn('kMicrophoneUdpHeaderBytes + kMicrophonePcmBytes + kMicrophoneUdpTagBytes == 1012', WIFI_AUDIO_SOURCE)
        self.assertIn('std::array<uint8_t, kMaxWebSocketFrameBytes> data{};', WIFI_AUDIO_SOURCE)
        self.assertIn('length > kControlFrameBytes', WIFI_AUDIO_SOURCE)
        self.assertIn('std::array<char, kControlFrameBytes> data{};', WIFI_AUDIO_SOURCE)
        self.assertIn('socket->SetReceiveBufferSize(kControlFrameBytes);', WIFI_AUDIO_SOURCE)

    def test_worst_case_status_response_fits_control_frame_limit(self):
        u32 = 4_294_967_295
        result = {
            "device": "stackchan-wifi-companion",
            "protocol_version": 1,
            "event_sequence": u32,
            "sample_rate": 24_000,
            "audio": {
                "duplex_mode": "half",
                "phase": "listening",
                "microphone_enabled": True,
                "microphone_active": True,
                "speaker_enabled": True,
                "speaker_active": False,
                "voice_reply_active": False,
                "revision": u32,
                "i2s_owner": {
                    "mode": "listening", "transition_failures": u32, "last_error": 2_147_483_647,
                    "read_successes": u32, "read_failures": u32, "last_read_error": 2_147_483_647,
                },
                "microphone_stats": {
                    "transport": "udp_pcm_s16le_hmac", "captured_chunks_10ms": u32,
                    "captured_frames": u32, "packetized_frames": u32, "sent_frames": u32,
                    "queue_drops": u32, "tx_queue_drops": u32,
                    "flushed_frames": u32, "queued_frames": u32,
                    "send_failures": u32, "max_send_us": u32,
                },
                "speaker_stats": {
                    "received_frames": u32, "played_frames": u32, "silence_frames": u32,
                    "underruns": u32, "queue_drops": u32, "sequence_gaps": u32,
                },
            },
            "runtime": {
                "heap_free_bytes": u32, "heap_min_bytes": u32,
                "stack_free_words": {"tx": u32, "cmd": u32, "mic": u32, "speaker": u32},
                "tx": {"max_send_us": u32, "slow_sends": u32, "failed_sends": u32},
                "worker_cores": {"tx": 1, "mic": 1, "speaker": 1},
            },
        }
        response = {"v": 1, "id": 2_147_483_647, "ok": True, "result": result}
        encoded = json.dumps(response, separators=(",", ":")).encode("utf-8")
        self.assertLessEqual(len(encoded), 1500, encoded.decode("utf-8"))

    def test_reconnect_clears_old_queues_and_sends_hello_synchronously_after_connect(self):
        self.assertIn('void reset_protocol_queues_for_new_socket()', WIFI_AUDIO_SOURCE)
        self.assertIn('xQueueReset(s_command_queue);', WIFI_AUDIO_SOURCE)
        self.assertIn('xQueueReset(s_control_tx_queue);', WIFI_AUDIO_SOURCE)
        self.assertIn('xQueueReset(s_microphone_tx_queue);', WIFI_AUDIO_SOURCE)
        self.assertIn('xQueueSendToFront(queue, &outbound, 0)', WIFI_AUDIO_SOURCE)
        self.assertIn('xQueueReceive(queue, &discarded, 0)', WIFI_AUDIO_SOURCE)
        bootstrap = WIFI_AUDIO_SOURCE.split('void transport_bootstrap_task(void*)', 1)[1]
        connect = bootstrap.index('socket->Connect(url.c_str())')
        hello = bootstrap.index('send_json_direct_to_socket(socket, hello)')
        ready_barrier = bootstrap.index('s_dock_ready_generation.load() != socket_generation')
        ready_commit = bootstrap.index(
            'commit_ready_for_socket(socket, socket_generation)', ready_barrier
        )
        self.assertLess(connect, hello)
        self.assertLess(hello, ready_barrier)
        self.assertLess(ready_barrier, ready_commit)
        commit_helper = WIFI_AUDIO_SOURCE.split('bool commit_ready_for_socket(', 1)[1].split(
            'void set_speaker_playback_active', 1
        )[0]
        self.assertIn('std::lock_guard<std::mutex> lock(s_socket_mutex);', commit_helper)
        self.assertIn('s_socket != expected', commit_helper)
        self.assertIn('s_socket_generation.load() != generation', commit_helper)
        self.assertIn('s_dock_ready_generation.load() != generation', commit_helper)
        self.assertIn('!expected->IsConnected()', commit_helper)
        self.assertIn('set_ready(true);', commit_helper)
        self.assertIn('if (s_wifi_tx_task_handle) xTaskNotifyGive(s_wifi_tx_task_handle);', WIFI_AUDIO_SOURCE)
        self.assertNotIn('queue_json_to_socket(callback_socket, hello, true)', bootstrap)
        on_data = bootstrap.split('socket->OnData(', 1)[1].split('socket->OnDisconnected(', 1)[0]
        self.assertIn('s_dock_ready_generation.store(generation)', on_data)
        self.assertNotIn('set_ready(true)', on_data)

    def test_bootstrap_never_publishes_ready_without_audio_workers(self):
        bootstrap = WIFI_AUDIO_SOURCE.split('void transport_bootstrap_task(void*)', 1)[1]
        task_commit = bootstrap.split('if (!audio_task_started)', 1)[1]
        self.assertIn('connection_tasks_ready = audio_task_started;', task_commit)
        self.assertIn('if (!connection_tasks_ready)', task_commit)
        self.assertLess(
            task_commit.index('if (!connection_tasks_ready)'),
            task_commit.index('commit_ready_for_socket(socket, socket_generation)'),
        )

    def test_event_sequence_assignment_and_queueing_are_serialized(self):
        self.assertIn('std::mutex s_event_mutex;', WIFI_AUDIO_SOURCE)
        event_sender = WIFI_AUDIO_SOURCE.split('void emit_event(', 1)[1].split(
            'void emit_audio_state(', 1
        )[0]
        self.assertIn('std::lock_guard<std::mutex> lock(s_event_mutex);', event_sender)

    @requires_private_transport_patches
    def test_wifi_audio_uses_the_exact_receive_task_handle(self):
        self.assertIn('TaskHandle_t GetReceiveTaskHandle() const;', WEB_SOCKET_HEADER)
        self.assertIn('virtual TaskHandle_t GetReceiveTaskHandle() const', TCP_HEADER)
        self.assertIn('socket->GetReceiveTaskHandle()', WIFI_AUDIO_SOURCE)
        self.assertNotIn('xTaskGetHandle("tcp_receive")', WIFI_AUDIO_SOURCE)

    def test_microphone_uplink_uses_native_pcm_and_session_bound_udp(self):
        self.assertNotIn('#include "audio/audio_service.h"', WIFI_AUDIO_SOURCE)
        self.assertNotIn('#include "esp_ae_rate_cvt.h"', WIFI_AUDIO_SOURCE)
        self.assertNotIn('#include "encoder/impl/esp_opus_enc.h"', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kMicrophonePcmSamples = 480;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kMicrophonePcmBytes = 960;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kMicrophoneTxQueueFrames = 8;', WIFI_AUDIO_SOURCE)
        self.assertIn('bool send_microphone_udp(const MicrophoneFrame& frame)', WIFI_AUDIO_SOURCE)
        self.assertIn('bool stage_microphone_udp_negotiation(', WIFI_AUDIO_SOURCE)
        self.assertIn('bool activate_microphone_udp_session(', WIFI_AUDIO_SOURCE)
        microphone_send = WIFI_AUDIO_SOURCE.split('bool send_microphone_udp(', 1)[1].split(
            'void reset_protocol_queues_for_new_socket()', 1
        )[0]
        self.assertIn('sendto(', microphone_send)
        self.assertIn('MSG_DONTWAIT', microphone_send)
        self.assertNotIn('socket->Send(', microphone_send)
        self.assertNotIn('Abort()', microphone_send)
        self.assertIn('s_microphone_send_failures.fetch_add(1)', microphone_send)
        self.assertIn('QueueHandle_t s_microphone_tx_queue = nullptr;', WIFI_AUDIO_SOURCE)
        audio_task = WIFI_AUDIO_SOURCE.split('void audio_task(void*)', 1)[1].split(
            'bool load_wifi_audio_configuration', 1
        )[0]
        self.assertNotIn('socket->Send(', audio_task)
        self.assertNotIn('prepare_microphone_websocket_frame(', audio_task)
        self.assertIn('xQueueSend(s_microphone_tx_queue, &frame, 0)', audio_task)
        self.assertIn(
            'uxQueueMessagesWaiting(s_microphone_tx_queue)', WIFI_AUDIO_SOURCE
        )
        self.assertIn('void discard_queued_microphone_frames()', WIFI_AUDIO_SOURCE)
        set_ready = WIFI_AUDIO_SOURCE.split('void set_ready(bool ready)', 1)[1].split(
            'void set_speaker_playback_active', 1
        )[0]
        half_duplex = WIFI_AUDIO_SOURCE.split(
            'void set_half_duplex_speaking(bool requested)', 1
        )[1].split('void set_voice_reply_active', 1)[0]
        audio_paths = WIFI_AUDIO_SOURCE.split('void update_audio_paths(', 1)[1].split(
            '#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC\nbool enqueue_speaker_frame', 1
        )[0]
        self.assertIn('discard_queued_microphone_frames();', set_ready)
        self.assertIn('discard_queued_microphone_frames();', half_duplex)
        self.assertIn('if (!microphone_enabled) discard_queued_microphone_frames();', audio_paths)
        self.assertIn('"flushed_frames"', WIFI_AUDIO_SOURCE)
        discard = WIFI_AUDIO_SOURCE.split('void discard_queued_microphone_frames()', 1)[1].split(
            'void set_ready(bool ready)', 1
        )[0]
        self.assertIn('xQueueReceive(s_microphone_tx_queue', discard)
        self.assertIn('s_microphone_pipeline_generation.fetch_add(1)', discard)
        self.assertIn('pending_samples = 0;', audio_task)
        tx_task = WIFI_AUDIO_SOURCE.split('void wifi_tx_task(void*)', 1)[1].split(
            'void command_task(void*)', 1
        )[0]
        self.assertIn('send_microphone_udp(microphone_frame);', tx_task)

    def test_product_microphone_uplink_preserves_native_24khz_pcm(self):
        self.assertIn('constexpr size_t kMicrophonePcmSamples = 480;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr size_t kMicrophonePcmBytes = 960;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr uint8_t kMicrophonePcmFrameFlag = 2;', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddStringToObject(format, "codec", "pcm_s16le")', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddNumberToObject(format, "sample_rate", 24000)', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddNumberToObject(format, "frame_ms", 20)', WIFI_AUDIO_SOURCE)
        self.assertNotIn('#include "esp_ae_rate_cvt.h"', WIFI_AUDIO_SOURCE)
        self.assertNotIn('#include "encoder/impl/esp_opus_enc.h"', WIFI_AUDIO_SOURCE)
        self.assertNotIn('esp_ae_rate_cvt_process(', WIFI_AUDIO_SOURCE)
        self.assertNotIn('esp_opus_enc_process(', WIFI_AUDIO_SOURCE)
        self.assertNotIn('void microphone_encode_task(void*)', WIFI_AUDIO_SOURCE)
        self.assertNotIn('QueueHandle_t s_microphone_pcm_queue', WIFI_AUDIO_SOURCE)
        audio_task = WIFI_AUDIO_SOURCE.split('void audio_task(void*)', 1)[1].split(
            'bool load_wifi_audio_configuration', 1
        )[0]
        self.assertIn('xQueueSend(s_microphone_tx_queue', audio_task)
        self.assertIn('pending_samples == kMicrophonePcmSamples', audio_task)

    def test_microphone_udp_retries_only_enomem_without_changing_the_wire_frame(self):
        self.assertIn(
            'constexpr size_t kMicrophoneUdpMaxSendAttempts = 3;', WIFI_AUDIO_SOURCE
        )
        self.assertIn(
            'constexpr TickType_t kMicrophoneUdpRetryDelayTicks = 1;', WIFI_AUDIO_SOURCE
        )
        microphone_send = WIFI_AUDIO_SOURCE.split('bool send_microphone_udp(', 1)[1].split(
            'void reset_protocol_queues_for_new_socket()', 1
        )[0]
        self.assertEqual(microphone_send.count('sendto('), 1)
        self.assertIn(
            'attempt < kMicrophoneUdpMaxSendAttempts', microphone_send
        )
        self.assertIn(
            'send_error != ENOMEM || attempt + 1 >= kMicrophoneUdpMaxSendAttempts',
            microphone_send,
        )
        self.assertIn('vTaskDelay(kMicrophoneUdpRetryDelayTicks);', microphone_send)
        self.assertIn('s_socket_generation.load() != socket_generation', microphone_send)
        self.assertIn('s_microphone_send_retries.fetch_add(1);', microphone_send)
        self.assertIn('s_microphone_send_retry_exhausted.fetch_add(1);', microphone_send)
        self.assertIn('s_microphone_last_send_error.store(send_error);', microphone_send)
        self.assertLess(
            microphone_send.index('write_u32be(packet.data() + 6, wire_sequence);'),
            microphone_send.index('for (size_t attempt = 0;'),
        )
        retry_loop = microphone_send.split('for (size_t attempt = 0;', 1)[1]
        self.assertLess(
            retry_loop.index('s_socket_generation.load() != socket_generation'),
            retry_loop.index('s_microphone_send_retries.fetch_add(1);'),
        )
        self.assertLess(
            retry_loop.index('s_microphone_send_retries.fetch_add(1);'),
            retry_loop.index('sendto('),
        )
        self.assertIn('"send_retries"', WIFI_AUDIO_SOURCE)
        self.assertIn('"retry_exhausted"', WIFI_AUDIO_SOURCE)
        self.assertIn('"last_send_error"', WIFI_AUDIO_SOURCE)

    def test_microphone_pipeline_has_no_resampler_or_encoder_startup_failure(self):
        audio_task = WIFI_AUDIO_SOURCE.split('void audio_task(void*)', 1)[1].split(
            'bool load_wifi_audio_configuration', 1
        )[0]
        self.assertNotIn('esp_ae_rate_cvt', audio_task)
        self.assertNotIn('esp_opus_enc', WIFI_AUDIO_SOURCE)
        self.assertIn('s_codec->InputData(input)', audio_task)

    def test_microphone_hello_negotiates_authenticated_udp_pcm(self):
        self.assertIn('const bool hello_complete =', WIFI_AUDIO_SOURCE)
        self.assertIn('if (!hello_complete || !send_json_direct_to_socket(socket, hello))', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddStringToObject(format, "codec", "pcm_s16le")', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddNumberToObject(format, "sample_rate", 24000)', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddNumberToObject(format, "channels", 1)', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_AddNumberToObject(format, "frame_ms", 20)', WIFI_AUDIO_SOURCE)
        self.assertIn('std::strcmp(transport_type->valuestring, "udp") != 0', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_GetObjectItemCaseSensitive(transport, "port")', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_GetObjectItemCaseSensitive(transport, "session")', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_GetObjectItemCaseSensitive(transport, "proof")', WIFI_AUDIO_SOURCE)
        self.assertIn('cJSON_GetObjectItemCaseSensitive(message,"protocol")', WIFI_AUDIO_SOURCE)
        self.assertIn('protocol->valueint==static_cast<int>(kProtocolVersion)', WIFI_AUDIO_SOURCE)
        self.assertIn('activate_microphone_udp_session(socket_generation)', WIFI_AUDIO_SOURCE)
        self.assertIn('!microphone_udp_session_ready(generation)', WIFI_AUDIO_SOURCE)

    def test_udp_destination_accepts_the_configured_websocket_hostname_and_resolves_off_callback(self):
        self.assertIn('#include <lwip/netdb.h>', WIFI_AUDIO_SOURCE)
        self.assertIn('bool extract_dock_host(', WIFI_AUDIO_SOURCE)
        stage = WIFI_AUDIO_SOURCE.split('bool stage_microphone_udp_negotiation(', 1)[1].split(
            'bool activate_microphone_udp_session(', 1
        )[0]
        activate = WIFI_AUDIO_SOURCE.split('bool activate_microphone_udp_session(', 1)[1].split(
            'bool send_microphone_udp(', 1
        )[0]
        self.assertIn('extract_dock_host(dock_url, dock_host)', stage)
        self.assertNotIn('getaddrinfo(', stage)
        self.assertIn('getaddrinfo(negotiation.host.data()', activate)
        self.assertIn('hints.ai_family = AF_INET;', activate)
        self.assertIn('freeaddrinfo(addresses);', activate)

    def test_udp_session_is_authenticated_generation_bound_and_invalidated_before_flush(self):
        self.assertIn('constexpr char kMicrophoneUdpKeyLabel[] = "stackchan-wifi-audio-udp-v1\\n";', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr char kMicrophoneUdpReadyLabel[] = "stackchan-wifi-audio-udp-ready-v1";', WIFI_AUDIO_SOURCE)
        stage = WIFI_AUDIO_SOURCE.split('bool stage_microphone_udp_negotiation(', 1)[1].split(
            'bool activate_microphone_udp_session(', 1
        )[0]
        self.assertIn('proof_difference |= expected_proof[index] ^ actual_proof[index];', stage)
        self.assertIn('key_input.insert(key_input.end(), device_id.begin(), device_id.end());', stage)
        self.assertIn("key_input.push_back('\\n');", stage)
        self.assertIn('key_input.insert(key_input.end(), nonce.begin(), nonce.end());', stage)
        self.assertIn('key_input.insert(key_input.end(), negotiation.session.begin()', stage)

        activate = WIFI_AUDIO_SOURCE.split('bool activate_microphone_udp_session(', 1)[1].split(
            'bool send_microphone_udp(', 1
        )[0]
        self.assertIn('s_microphone_udp_session.socket_generation = socket_generation;', activate)
        self.assertIn('s_microphone_udp_sequence.store(1);', activate)

        reset = WIFI_AUDIO_SOURCE.split('void reset_protocol_queues_for_new_socket()', 1)[1].split(
            'void notify_wifi_tx_task()', 1
        )[0]
        self.assertLess(reset.index('clear_microphone_udp_session();'), reset.index('xQueueReset(s_microphone_tx_queue);'))
        self.assertLess(reset.index('clear_microphone_udp_session();'), reset.index('s_microphone_pipeline_generation.fetch_add(1);'))

        send = WIFI_AUDIO_SOURCE.split('bool send_microphone_udp(', 1)[1].split(
            'void reset_protocol_queues_for_new_socket()', 1
        )[0]
        self.assertIn('s_microphone_udp_session.socket_generation != socket_generation', send)
        self.assertGreaterEqual(send.count('frame.generation != s_microphone_pipeline_generation.load()'), 2)
        self.assertIn('s_half_duplex_speaking.load()', send)
        self.assertIn('uint32_t wire_sequence = s_microphone_udp_sequence.fetch_add(1);', send)
        self.assertIn('std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);', send)

    def test_wifi_tx_and_i2s_workers_use_separate_esp32s3_cores(self):
        self.assertIn('constexpr BaseType_t kWifiAudioNetworkCore = 0;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr BaseType_t kWifiAudioI2sCore = 1;', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr uint32_t kWifiAudioTxTaskStackBytes = 12 * 1024;', WIFI_AUDIO_SOURCE)
        self.assertNotIn('kWifiAudioOpusTaskStackBytes', WIFI_AUDIO_SOURCE)
        self.assertIn('static_assert(CONFIG_FREERTOS_NUMBER_OF_CORES >= 2', WIFI_AUDIO_SOURCE)
        self.assertIn(
            'xTaskCreatePinnedToCore(wifi_tx_task, "wifi_audio_tx", kWifiAudioTxTaskStackBytes, nullptr, 5,',
            WIFI_AUDIO_SOURCE,
        )
        self.assertIn(
            '&s_wifi_tx_task_handle, kWifiAudioNetworkCore)',
            WIFI_AUDIO_SOURCE,
        )
        self.assertNotIn('microphone_encode_task', WIFI_AUDIO_SOURCE)
        self.assertIn(
            'xTaskCreatePinnedToCore(audio_task, "wifi_audio", 6144, nullptr, 4,',
            WIFI_AUDIO_SOURCE,
        )
        self.assertIn('&s_audio_task_handle, kWifiAudioI2sCore)', WIFI_AUDIO_SOURCE)
        speaker_startup = WIFI_AUDIO_SOURCE.split('static bool speaker_task_started = false;', 1)[1].split(
            'connection_tasks_ready = connection_tasks_ready && speaker_task_started;', 1
        )[0]
        self.assertIn(
            's_speaker_queue = xQueueCreateWithCaps(\n'
            '                    kSpeakerQueueFrames, sizeof(SpeakerFrame),',
            speaker_startup,
        )
        self.assertIn('MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT', speaker_startup)
        self.assertIn(
            'xTaskCreatePinnedToCoreWithCaps(\n                    speaker_task, "wifi_speaker", 4096, nullptr, 6,',
            speaker_startup,
        )
        self.assertIn('&s_speaker_task_handle, kWifiAudioI2sCore,', speaker_startup)
        self.assertNotIn('xQueueCreate(kSpeakerQueueFrames, sizeof(SpeakerFrame))', speaker_startup)
        self.assertNotIn('xTaskCreatePinnedToCore(speaker_task, "wifi_speaker"', speaker_startup)

    def test_status_request_logs_heap_and_worker_stack_headroom_for_one_pass_acceptance(self):
        self.assertIn('void log_runtime_health()', WIFI_AUDIO_SOURCE)
        self.assertIn('heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT)', WIFI_AUDIO_SOURCE)
        self.assertIn('uxTaskGetStackHighWaterMark(s_wifi_tx_task_handle)', WIFI_AUDIO_SOURCE)
        self.assertIn('uxTaskGetStackHighWaterMark(s_command_task_handle)', WIFI_AUDIO_SOURCE)
        self.assertIn('uxTaskGetStackHighWaterMark(s_audio_task_handle)', WIFI_AUDIO_SOURCE)
        self.assertIn('uxTaskGetStackHighWaterMark(s_speaker_task_handle)', WIFI_AUDIO_SOURCE)
        get_status = WIFI_AUDIO_SOURCE.split('if (cmd == "get_status")', 1)[1].split(
            '} else if (cmd == "set_audio")', 1
        )[0]
        self.assertIn('log_runtime_health();', get_status)
        self.assertIn('cJSON_AddItemToObject(result, "runtime", runtime_state());', get_status)
        self.assertIn('"microphone_stats"', WIFI_AUDIO_SOURCE)
        self.assertIn('"captured_frames"', WIFI_AUDIO_SOURCE)
        self.assertIn('"sent_frames"', WIFI_AUDIO_SOURCE)
        self.assertIn('"queue_drops"', WIFI_AUDIO_SOURCE)
        self.assertIn('"transport", "udp_pcm_s16le_hmac"', WIFI_AUDIO_SOURCE)
        self.assertIn('"packetized_frames"', WIFI_AUDIO_SOURCE)
        self.assertNotIn('"encode_failures"', WIFI_AUDIO_SOURCE)
        self.assertIn('"max_send_us"', WIFI_AUDIO_SOURCE)
        self.assertIn('"slow_sends"', WIFI_AUDIO_SOURCE)
        self.assertIn('"failed_sends"', WIFI_AUDIO_SOURCE)
        self.assertIn('heap_caps_get_free_size(MALLOC_CAP_8BIT)', WIFI_AUDIO_SOURCE)

    def test_queued_commands_and_replies_keep_the_socket_generation(self):
        self.assertIn('std::atomic_uint32_t s_socket_generation{0};', WIFI_AUDIO_SOURCE)
        self.assertIn('struct CommandFrame', WIFI_AUDIO_SOURCE)
        self.assertIn('frame.generation = generation;', WIFI_AUDIO_SOURCE)
        self.assertIn('if (!current_socket_for_generation(frame.generation)) continue;', WIFI_AUDIO_SOURCE)
        self.assertIn('handle_command(frame.data.data(), frame.length, frame.generation);', WIFI_AUDIO_SOURCE)
        self.assertIn('current_socket_for_generation(frame.generation)', WIFI_AUDIO_SOURCE)

    def test_wifi_volume_gesture_uses_the_shared_whole_screen_live_green_fill(self):
        volume_gesture = (FIRMWARE_ROOT / 'main' / 'hal' / 'volume_gesture.cpp').read_text(encoding='utf-8')
        self.assertIn('class VolumeGesture', volume_gesture)
        self.assertIn('constexpr int kVolumeGestureScreenWidth = 320;', volume_gesture)
        self.assertIn('constexpr int kVolumeGestureScreenHeight = 240;', volume_gesture)
        self.assertIn('constexpr int kVolumeGestureActivationPixels = 8;', volume_gesture)
        self.assertIn('start_volume_ + vertical_delta * 100 / kVolumeGestureScreenHeight', volume_gesture)
        self.assertIn('lv_color_hex(0x000000)', volume_gesture)
        self.assertIn('lv_color_hex(0x00FF00)', volume_gesture)
        self.assertIn('lv_obj_set_height(volume_fill_', volume_gesture)
        self.assertIn('GetHAL().setSpeakerVolume(current_volume_, false);', volume_gesture)
        self.assertIn('GetHAL().setSpeakerVolume(current_volume_, true);', volume_gesture)
        self.assertIn('void update_stackchan_wifi_audio_volume_gesture()', WIFI_AUDIO_SOURCE)
        self.assertIn('update_stackchan_volume_gesture();', WIFI_AUDIO_SOURCE)
        self.assertIn('update_stackchan_wifi_audio_volume_gesture();', MAIN_SOURCE)

    def test_ble_exposes_non_secret_transport_progress(self):
        self.assertIn('doc["cmd"] == "getWifiAudioStatus"', SOURCE)
        self.assertIn('stackchan_wifi_audio_transport_state()', SOURCE)
        self.assertIn('waiting_wifi_association', WIFI_AUDIO_SOURCE)

    def test_private_build_wifi_bootstrap_uses_the_ble_station(self):
        self.assertIn('CONFIG_STACKCHAN_WIFI_AUDIO_BOOTSTRAP_SSID', SOURCE)
        self.assertIn('CONFIG_STACKCHAN_WIFI_AUDIO_BOOTSTRAP_PASSWORD', SOURCE)
        self.assertIn('_wifi_station->AddAuth', SOURCE)
        self.assertNotIn('SsidManager', WIFI_AUDIO_SOURCE)

    def test_dock_connection_retries_without_rebooting(self):
        self.assertIn('retrying PC Dock connection', WIFI_AUDIO_SOURCE)
        self.assertIn('while (socket->IsConnected())', WIFI_AUDIO_SOURCE)
        self.assertIn('while (true)', WIFI_AUDIO_SOURCE)

    def test_initial_listening_failure_retries_before_websocket_connection(self):
        bootstrap = WIFI_AUDIO_SOURCE.split('void transport_bootstrap_task(void*)', 1)[1].split(
            '} // namespace', 1
        )[0]
        before_websocket, websocket_path = bootstrap.split(
            'std::shared_ptr<WebSocket> socket =', 1
        )
        codec_gate = before_websocket.rsplit('#endif', 1)[-1]
        self.assertIn('initial_listening_ready = apply_half_duplex_codec_mode(false);', codec_gate)
        self.assertIn('if (!initial_listening_ready)', codec_gate)
        self.assertIn('vTaskDelay(pdMS_TO_TICKS(1000));', codec_gate)
        self.assertIn('continue;', codec_gate)
        self.assertNotIn('vTaskDelete(nullptr);', codec_gate)
        self.assertIn('Board::GetInstance().GetNetwork()->CreateWebSocket(2)', websocket_path)
        self.assertLess(
            bootstrap.index('initial_listening_ready = apply_half_duplex_codec_mode(false);'),
            bootstrap.index('Board::GetInstance().GetNetwork()->CreateWebSocket(2)'),
        )

    def test_stale_websocket_callbacks_cannot_clear_the_active_ready_state(self):
        self.assertIn('bool is_current_socket', WIFI_AUDIO_SOURCE)
        self.assertIn('std::weak_ptr<WebSocket> weak_socket = socket;', WIFI_AUDIO_SOURCE)
        self.assertGreaterEqual(
            WIFI_AUDIO_SOURCE.count('if (!callback_socket || !is_current_socket(callback_socket)) return;'),
            3,
        )

    def test_wifi_microphone_selects_physical_mic_from_verified_four_slot_order(self):
        self.assertIn(
            'constexpr size_t kWifiPhysicalMicrophoneChannel = CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC;',
            WIFI_AUDIO_SOURCE,
        )
        self.assertIn(
            'const size_t capture_channel = kWifiPhysicalMicrophoneChannel == 1 && channels >= 3 ? 2 : 0;',
            WIFI_AUDIO_SOURCE,
        )
        self.assertNotIn(
            'const size_t capture_channel = channels > kWifiPhysicalMicrophoneChannel ? kWifiPhysicalMicrophoneChannel : 0;',
            WIFI_AUDIO_SOURCE,
        )
        self.assertIn('input[i * channels + capture_channel]', WIFI_AUDIO_SOURCE)

    def test_cores3_product_uses_verified_raw_four_slot_tdm_rx(self):
        selection = ('es7210_cfg.mic_selected = ES7210_SEL_MIC1 | ES7210_SEL_MIC2 | '
                     'ES7210_SEL_MIC3 | ES7210_SEL_MIC4;')
        self.assertIn(selection, CODEC_SOURCE)
        raw_input = CODEC_SOURCE.split('#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT', 1)[1].split(
            '#else', 1
        )[0]
        self.assertIn('input_channels_ = 4;', raw_input)
        self.assertIn('bool CoreS3AudioCodec::CreateListeningPath()', CODEC_SOURCE)
        self.assertIn('i2s_new_channel(&chan_cfg, nullptr, &rx_handle_)', CODEC_SOURCE)
        self.assertIn('i2s_channel_init_tdm_mode(rx_handle_, &tdm_cfg)', CODEC_SOURCE)
        self.assertIn('.bclk_div = 8,', CODEC_SOURCE)
        self.assertIn('I2S_TDM_SLOT0 | I2S_TDM_SLOT1 | I2S_TDM_SLOT2 | I2S_TDM_SLOT3', CODEC_SOURCE)
        listening = CODEC_SOURCE.split('bool CoreS3AudioCodec::CreateListeningPath()', 1)[1].split(
            'bool CoreS3AudioCodec::CreateSpeakingPath()', 1
        )[0]
        self.assertIn('.channel = 4,', listening)
        self.assertNotIn('.channel = 2,', listening)
        for slot in range(4):
            self.assertIn(f'ESP_CODEC_DEV_MAKE_CHANNEL_MASK({slot})', CODEC_SOURCE)

    def test_cores3_wifi_audio_has_one_serialized_i2s_owner(self):
        self.assertIn('enum class WifiAudioMode', CODEC_HEADER_SOURCE)
        self.assertIn('bool SetWifiAudioMode(WifiAudioMode mode);', CODEC_HEADER_SOURCE)
        self.assertIn('bool CoreS3AudioCodec::DestroyActivePath()', CODEC_SOURCE)
        self.assertIn('bool CoreS3AudioCodec::CreateListeningPath()', CODEC_SOURCE)
        self.assertIn('bool CoreS3AudioCodec::CreateSpeakingPath()', CODEC_SOURCE)
        self.assertIn('i2s_new_channel(&chan_cfg, nullptr, &rx_handle_)', CODEC_SOURCE)
        self.assertIn('i2s_new_channel(&chan_cfg, &tx_handle_, nullptr)', CODEC_SOURCE)
        self.assertIn('i2s_del_channel(rx_handle_)', CODEC_SOURCE)
        self.assertIn('i2s_del_channel(tx_handle_)', CODEC_SOURCE)
        self.assertIn('active_mode_ = WifiAudioMode::Idle;', CODEC_SOURCE)

    def test_cores3_wifi_audio_checks_data_format_and_open_failures(self):
        self.assertIn('data_if_->set_fmt(data_if_, ESP_CODEC_DEV_TYPE_IN, &fs)', CODEC_SOURCE)
        self.assertIn('data_if_->set_fmt(data_if_, ESP_CODEC_DEV_TYPE_OUT, &fs)', CODEC_SOURCE)
        self.assertIn('RecordTransitionFailure(', CODEC_SOURCE)
        self.assertIn('transition_failures_', CODEC_HEADER_SOURCE)
        self.assertIn('last_transition_error_', CODEC_HEADER_SOURCE)

    def test_cores3_transition_failure_stays_fail_closed_and_recoverable(self):
        read = CODEC_SOURCE.split('int CoreS3AudioCodec::Read', 1)[1].split(
            'int CoreS3AudioCodec::Write', 1
        )[0]
        self.assertTrue(read.rstrip().endswith('return 0;\n}'))
        apply_mode = WIFI_AUDIO_SOURCE.split('bool apply_half_duplex_codec_mode', 1)[1].split(
            'void set_half_duplex_speaking', 1
        )[0]
        self.assertIn('set_transport_state(TransportState::ErrorAudioCodec);', apply_mode)
        self.assertIn('set_ready(false);', apply_mode)
        destroy = CODEC_SOURCE.split('bool CoreS3AudioCodec::DestroyActivePath()', 1)[1].split(
            'bool CoreS3AudioCodec::CreateListeningPath()', 1
        )[0]
        self.assertIn('if (result != ESP_OK)', destroy)
        self.assertIn('} else {\n            rx_handle_ = nullptr;', destroy)
        self.assertIn('} else {\n            tx_handle_ = nullptr;', destroy)
        self.assertIn('Preserve the complete device/data/channel graph', destroy)
        preserve = destroy.split('if (!success)', 1)[1].split('if (input_dev_)', 1)[0]
        self.assertNotIn('esp_codec_dev_delete(', preserve)
        self.assertNotIn('audio_codec_delete_data_if(', preserve)

        bootstrap = WIFI_AUDIO_SOURCE.split('void transport_bootstrap_task', 1)[1]
        ready_commit = bootstrap.split(
            's_dock_ready_generation.load() != socket_generation', 1
        )[1]
        self.assertIn('codec_ready = apply_half_duplex_codec_mode(false);', ready_commit)
        self.assertIn('if (!codec_ready)', ready_commit)
        self.assertIn('set_transport_state(TransportState::ErrorAudioCodec);', ready_commit)

    def test_cores3_mode_state_and_hardware_disable_results_are_observable(self):
        self.assertIn('std::atomic<WifiAudioMode> active_mode_', CODEC_HEADER_SOURCE)
        destroy = CODEC_SOURCE.split('bool CoreS3AudioCodec::DestroyActivePath()', 1)[1].split(
            'bool CoreS3AudioCodec::CreateListeningPath()', 1
        )[0]
        self.assertIn('data_if_->enable(data_if_, ESP_CODEC_DEV_TYPE_IN, false)', destroy)
        self.assertIn('data_if_->enable(data_if_, ESP_CODEC_DEV_TYPE_OUT, false)', destroy)
        self.assertIn('in_codec_if_->enable(in_codec_if_, false)', destroy)
        self.assertIn('out_codec_if_->enable(out_codec_if_, false)', destroy)

    def test_cores3_product_read_requires_complete_ten_ms_four_slot_frame(self):
        read = CODEC_SOURCE.split('int CoreS3AudioCodec::Read', 1)[1].split(
            'int CoreS3AudioCodec::Write', 1
        )[0]
        raw_read = read.split('#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT', 1)[1].split('#else', 1)[0]
        self.assertIn('i2s_channel_read(', raw_read)
        self.assertIn('bytes_read != requested_bytes', raw_read)
        self.assertIn('bytes_read % (4 * sizeof(int16_t))', raw_read)
        self.assertIn('std::memset(dest, 0, requested_bytes);', raw_read)
        self.assertIn('read_failures_.fetch_add(1)', raw_read)
        self.assertIn('last_read_error_', raw_read)
        self.assertNotIn('esp_codec_dev_read(', raw_read)
        self.assertIn('constexpr size_t kWifiInputChannels = 4;', WIFI_AUDIO_SOURCE)
        self.assertIn('static_assert(kWifiInputFrameBytes == 1920', WIFI_AUDIO_SOURCE)
        self.assertIn('if (channels != kWifiInputChannels)', WIFI_AUDIO_SOURCE)
        self.assertIn('input.resize(kSamplesPerFrame * channels);', WIFI_AUDIO_SOURCE)

    def test_cores3_product_output_keeps_two_by_sixteen_bit_frame_and_duplicates_mono(self):
        self.assertIn('bool CoreS3AudioCodec::CreateSpeakingPath()', CODEC_SOURCE)
        self.assertIn('i2s_new_channel(&chan_cfg, &tx_handle_, nullptr)', CODEC_SOURCE)
        self.assertIn('output_stereo_buffer_.resize(static_cast<size_t>(samples) * 2);', CODEC_SOURCE)
        self.assertIn('output_stereo_buffer_[static_cast<size_t>(i) * 2] = data[i];', CODEC_SOURCE)
        self.assertIn('output_stereo_buffer_[static_cast<size_t>(i) * 2 + 1] = data[i];', CODEC_SOURCE)

    def test_rx_only_diagnostic_is_explicit_and_wifi_scoped(self):
        self.assertIn('config STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC', KCONFIG_SOURCE)
        self.assertIn('depends on STACKCHAN_WIFI_AUDIO_MVP', KCONFIG_SOURCE)
        self.assertIn('config STACKCHAN_WIFI_AUDIO_DIAGNOSTIC_UDP_PORT', KCONFIG_SOURCE)

    def test_rx_only_diagnostic_has_no_tx_channel_and_uses_four_raw_slots(self):
        self.assertIn('i2s_new_channel(&chan_cfg, nullptr, &rx_handle_)', CODEC_SOURCE)
        self.assertIn('tdm_cfg.slot_cfg.total_slot = 4;', CODEC_SOURCE)
        self.assertIn('input_channels_ = 4;', CODEC_SOURCE)
        self.assertIn('input_gain_ = 30;', CODEC_SOURCE)
        for slot in range(4):
            self.assertIn(f'ESP_CODEC_DEV_MAKE_CHANNEL_MASK({slot})', CODEC_SOURCE)

    def test_rx_only_diagnostic_validates_every_i2s_read(self):
        self.assertIn('i2s_channel_read(', CODEC_SOURCE)
        self.assertIn('bytes_read != requested_bytes', CODEC_SOURCE)
        self.assertIn('bytes_read % (4 * sizeof(int16_t))', CODEC_SOURCE)
        self.assertIn('std::memset(dest, 0, requested_bytes);', CODEC_SOURCE)

    def test_rx_only_diagnostic_never_enables_speaker(self):
        self.assertIn('speaker output is disabled in RX-only diagnostic mode', WIFI_AUDIO_SOURCE)
        self.assertIn('#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC', WIFI_AUDIO_SOURCE)
        self.assertIn('Speaker output is unavailable in RX-only diagnostic mode', CODEC_SOURCE)

    def test_rx4_udp_packets_are_strict_and_below_receiver_boundary(self):
        self.assertIn('std::memcpy(packet, "SC4D", 4);', WIFI_AUDIO_SOURCE)
        self.assertIn('kDiagnosticFramesPerPacket = 120', WIFI_AUDIO_SOURCE)
        self.assertIn('kDiagnosticPacketBytes == 984', WIFI_AUDIO_SOURCE)
        self.assertIn('send_diagnostic_audio(input.data(), kSamplesPerFrame);', WIFI_AUDIO_SOURCE)

    def test_wifi_speaker_downlink_is_direction_tagged_and_latency_bounded(self):
        self.assertIn('kSpeakerFrameFlag = 1', WIFI_AUDIO_SOURCE)
        self.assertIn('length != kAudioFrameBytes', WIFI_AUDIO_SOURCE)
        self.assertIn('s_speaker_queue = xQueueCreateWithCaps(', WIFI_AUDIO_SOURCE)
        self.assertIn('kSpeakerQueueFrames, sizeof(SpeakerFrame),', WIFI_AUDIO_SOURCE)
        self.assertIn('discard the oldest 10 ms frame', WIFI_AUDIO_SOURCE)
        self.assertIn('constexpr TickType_t kSpeakerQueueWaitTicks = pdMS_TO_TICKS(20);', WIFI_AUDIO_SOURCE)
        self.assertIn('s_speaker_backpressure_waits.fetch_add(1);', WIFI_AUDIO_SOURCE)
        self.assertIn('xQueueSend(s_speaker_queue, &queued, kSpeakerQueueWaitTicks)', WIFI_AUDIO_SOURCE)
        self.assertIn('"backpressure_waits"', WIFI_AUDIO_SOURCE)
        self.assertIn('s_codec->OutputData(output)', WIFI_AUDIO_SOURCE)

    def test_wifi_speaker_rejects_stale_frames_across_disable_and_queue_reset(self):
        self.assertIn('uint32_t generation = 0;', WIFI_AUDIO_SOURCE)
        self.assertIn('s_speaker_pipeline_generation.fetch_add(1)', WIFI_AUDIO_SOURCE)
        self.assertIn('discard_queued_speaker_frames()', WIFI_AUDIO_SOURCE)
        self.assertIn('queued.generation = pipeline_generation;', WIFI_AUDIO_SOURCE)
        self.assertIn('speaker_frame_is_current(pipeline_generation)', WIFI_AUDIO_SOURCE)
        self.assertIn('stale.generation != playback_generation', WIFI_AUDIO_SOURCE)
        self.assertIn('frame.generation == playback_generation', WIFI_AUDIO_SOURCE)
        self.assertIn('if (xQueueReceive(s_speaker_queue, &discarded, 0) == pdTRUE)', WIFI_AUDIO_SOURCE)

    def test_wifi_audio_uses_bounded_half_duplex_reply_phases(self):
        self.assertIn('cJSON_AddStringToObject(result, "duplex_mode", "half");', WIFI_AUDIO_SOURCE)
        self.assertIn('speaking ? "speaking" : "listening"', WIFI_AUDIO_SOURCE)
        self.assertIn('void set_half_duplex_speaking(bool requested)', WIFI_AUDIO_SOURCE)
        self.assertIn('bool apply_half_duplex_codec_mode(bool speaking)', WIFI_AUDIO_SOURCE)
        self.assertIn('CoreS3AudioCodec::WifiAudioMode::Speaking', WIFI_AUDIO_SOURCE)
        self.assertIn('CoreS3AudioCodec::WifiAudioMode::Listening', WIFI_AUDIO_SOURCE)
        self.assertIn('CoreS3AudioCodec::WifiAudioMode::Idle', WIFI_AUDIO_SOURCE)
        self.assertIn('set_transport_state(TransportState::ErrorAudioCodec);', WIFI_AUDIO_SOURCE)
        set_talking = WIFI_AUDIO_SOURCE.split('} else if (cmd == "set_talking")', 1)[1].split(
            '} else if (cmd == "set_speech")', 1
        )[0]
        self.assertIn('set_voice_reply_active(enabled);', set_talking)

    def test_wifi_microphone_capture_is_serialized_and_blocked_while_speaking(self):
        audio_task = WIFI_AUDIO_SOURCE.split('void audio_task(void*)', 1)[1].split(
            'bool load_wifi_audio_configuration', 1
        )[0]
        self.assertIn('s_half_duplex_speaking.load()', audio_task)
        self.assertIn('std::lock_guard<std::mutex> lock(s_audio_codec_mutex);', audio_task)
        self.assertIn('captured = s_codec->InputData(input);', audio_task)

    def test_wifi_speaker_prebuffers_reply_and_closes_output_after_queue_drain(self):
        self.assertIn('kSpeakerPrebufferFrames = 4', WIFI_AUDIO_SOURCE)
        self.assertIn('kSpeakerDrainGraceUs = 400000', WIFI_AUDIO_SOURCE)
        self.assertIn('kSpeakerReplyIdleTimeoutUs = 3000000', WIFI_AUDIO_SOURCE)
        self.assertIn('s_voice_reply_active.load() ?', WIFI_AUDIO_SOURCE)
        self.assertIn('s_speaker_last_frame_us = esp_timer_get_time();', WIFI_AUDIO_SOURCE)
        self.assertIn('s_voice_reply_started_us = esp_timer_get_time();', WIFI_AUDIO_SOURCE)
        self.assertIn('s_voice_reply_ended_us = esp_timer_get_time();', WIFI_AUDIO_SOURCE)
        self.assertIn('esp_timer_get_time() - reply_activity_us >= kSpeakerReplyIdleTimeoutUs', WIFI_AUDIO_SOURCE)
        self.assertIn('speaker reply idle timeout; returning to listening mode', WIFI_AUDIO_SOURCE)
        self.assertIn('esp_timer_get_time() - boundary_us >= kSpeakerDrainGraceUs', WIFI_AUDIO_SOURCE)
        self.assertIn('queued > 0', WIFI_AUDIO_SOURCE)
        self.assertIn('uxQueueMessagesWaiting(s_speaker_queue) == 0', WIFI_AUDIO_SOURCE)
        self.assertIn('set_half_duplex_speaking(false);', WIFI_AUDIO_SOURCE)
        self.assertIn('std::fill(output.begin(), output.end(), 0);', WIFI_AUDIO_SOURCE)
        self.assertIn('Keep TX DMA warm only for the bounded speaking phase.', WIFI_AUDIO_SOURCE)
        self.assertIn('"underruns"', WIFI_AUDIO_SOURCE)
        self.assertIn('"queue_drops"', WIFI_AUDIO_SOURCE)
        self.assertIn('"sequence_gaps"', WIFI_AUDIO_SOURCE)


if __name__ == "__main__":
    unittest.main()
