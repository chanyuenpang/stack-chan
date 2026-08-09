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
AUDIO_SERVICE_HEADER = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "audio" / "audio_service.h").read_text(encoding="utf-8")
FLASH_SCRIPT = (ROOT / "ops" / "bin" / "flash-xiaozhi-dock-candidate.ps1").read_text(encoding="utf-8")
DEV_HTTP = (FIRMWARE_ROOT / "main" / "hal" / "hal_dev_local_control.cpp").read_text(encoding="utf-8")
REMOTE_CONTROL = (ROOT / "tools" / "remote_control" / "remote_control.py").read_text(encoding="utf-8")
LAN_PROVISION = (ROOT / "tools" / "stackchan-dock" / "scripts" / "provision-xiaozhi-dock-lan.ps1").read_text(
    encoding="utf-8"
)
SPEAKER_HIL = (ROOT / "ops" / "bin" / "test-xiaozhi-speaker-hil.ps1").read_text(encoding="utf-8")
STACKCHAN_DISPLAY = (FIRMWARE_ROOT / "main" / "hal" / "board" / "stackchan_display.cc").read_text(encoding="utf-8")


class XiaozhiLocalDockContractTests(unittest.TestCase):
    def test_profile_selects_official_application_runtime(self):
        self.assertIn("CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK=y", DEFAULTS)
        self.assertIn("CONFIG_STACKCHAN_USB_UAC_MVP=n", DEFAULTS)
        self.assertIn("CONFIG_STACKCHAN_WIFI_AUDIO_MVP=n", DEFAULTS)
        self.assertIn("CONFIG_USB_DEVICE_UAC_AS_PART=n", DEFAULTS)
        self.assertIn("GetHAL().startXiaozhi();", MAIN)

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

    def test_official_profile_removes_private_transport_patches_and_verbose_diagnostics(self):
        self.assertIn("if(CONFIG_STACKCHAN_WIFI_AUDIO_MVP)", FIRMWARE_CMAKE)
        self.assertIn("elseif(CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK)", FIRMWARE_CMAKE)
        self.assertIn("list(REVERSE STACKCHAN_ESP_ML307_REVERSE_PATCHES)", FIRMWARE_CMAKE)
        self.assertIn("--reverse", FIRMWARE_CMAKE)
        self.assertIn("xiaozhi-local-dock.patch", FIRMWARE_CMAKE)
        self.assertIn('http->SetHeader("Authorization", "Bearer " + local_token);', LOCAL_DOCK_PATCH)
        self.assertIn("AUDIO_SERVICE_DIAG_ENABLED=0", MAIN_CMAKE)
        self.assertIn("#define AUDIO_SERVICE_DIAG_ENABLED 1", AUDIO_SERVICE_HEADER)

    def test_hil_flash_is_pinned_app_only_and_requires_explicit_execute(self):
        self.assertIn("[switch]$Execute", FLASH_SCRIPT)
        self.assertIn("if (-not $Execute)", FLASH_SCRIPT)
        self.assertIn("$appOffset = 0x20000", FLASH_SCRIPT)
        self.assertIn("$appPartitionSize = 0x4f0000", FLASH_SCRIPT)
        self.assertIn("C484CC7CB3EA58FD2F261A03CF9A206C9CD8164EE162DCA51CFA2CF02D7787D5", FLASH_SCRIPT)
        self.assertIn("00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236", FLASH_SCRIPT)
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
