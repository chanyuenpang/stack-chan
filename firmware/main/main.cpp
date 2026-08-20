/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <smooth_ui_toolkit.hpp>
#include <uitk/short_namespace.hpp>
#include <mooncake_log.h>
#include <mooncake.h>
#include <apps/apps.h>
#include <hal/hal.h>
#include <board.h>
#include <display.h>
#include <stackchan/stackchan.h>
#include <esp_system.h>
#include <esp_app_desc.h>
#include <esp_ota_ops.h>
#include <esp_err.h>
#include <esp_log.h>
#include <sdkconfig.h>
#include <settings.h>
#include <ota.h>
#include <hal/usb_uac_mvp.h>
#include <hal/wifi_audio_dock_mvp.h>

using namespace mooncake;
using namespace smooth_ui_toolkit;

namespace {
constexpr const char* kBootNvsNamespace = "boot";
constexpr const char* kBootDefaultModeKey = "default_mode";
constexpr const char* kBootAutoStartOnceKey = "start_once";
constexpr const char* kBootAutoStartFailCountKey = "fail_count";
// ESP-IDF NVS limits key names to 15 bytes. Keep this distinct from the
// human-readable build version stored as the value.
constexpr const char* kBootAutoStartBuildKey = "auto_start_ver";
static_assert(sizeof("auto_start_ver") - 1 <= 15, "NVS key must fit ESP-IDF's 15-byte limit");
constexpr const char* kBootDefaultLauncher = "launcher";
constexpr const char* kBootDefaultXiaozhi = "xiaozhi";
constexpr int kBootAutoStartFailCountLimit = 3;

const char* ota_state_to_string(esp_ota_img_states_t state)
{
    switch (state) {
        case ESP_OTA_IMG_NEW:
            return "new";
        case ESP_OTA_IMG_PENDING_VERIFY:
            return "pending_verify";
        case ESP_OTA_IMG_VALID:
            return "valid";
        case ESP_OTA_IMG_INVALID:
            return "invalid";
        case ESP_OTA_IMG_ABORTED:
            return "aborted";
        case ESP_OTA_IMG_UNDEFINED:
            return "undefined";
        default:
            return "unknown";
    }
}

bool set_xiaozhi_boot_policy_on_ota_first_boot(esp_ota_img_states_t state)
{
    if (state != ESP_OTA_IMG_PENDING_VERIFY && state != ESP_OTA_IMG_NEW) {
        return false;
    }

    {
        Settings writable_boot_settings(kBootNvsNamespace, true);
        writable_boot_settings.SetString(kBootDefaultModeKey, kBootDefaultXiaozhi);
        writable_boot_settings.SetBool(kBootAutoStartOnceKey, false);
        writable_boot_settings.SetInt(kBootAutoStartFailCountKey, 0);
    }

    mclog::tagInfo("BOOT-MODE",
                   "route=xiaozhi_ota event=ota_first_boot source=ota_state state={} "
                   "action=set_default_xiaozhi",
                   ota_state_to_string(state));
    return true;
}

// App-only maintenance flashes deliberately leave otadata untouched, so they
// do not enter ESP-IDF's OTA pending-verify state.  Remembering the build that
// last received the local-Dock auto-start policy gives that path the same
// one-time recovery behaviour without weakening the later boot-loop guard.
bool set_xiaozhi_boot_policy_on_new_local_dock_build()
{
#if !CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK
    return false;
#else
    const auto* app_desc = esp_app_get_description();
    const std::string build_version = app_desc ? app_desc->version : "unknown";
    Settings boot_settings(kBootNvsNamespace, false);
    if (boot_settings.GetString(kBootAutoStartBuildKey, "") == build_version) {
        return false;
    }

    Settings writable_boot_settings(kBootNvsNamespace, true);
    writable_boot_settings.SetString(kBootAutoStartBuildKey, build_version);
    writable_boot_settings.SetString(kBootDefaultModeKey, kBootDefaultXiaozhi);
    writable_boot_settings.SetBool(kBootAutoStartOnceKey, false);
    writable_boot_settings.SetInt(kBootAutoStartFailCountKey, 0);
    mclog::tagInfo("BOOT-MODE",
                   "route=xiaozhi_app_only event=new_local_dock_build build_version={} "
                   "action=set_default_xiaozhi_reset_fail_count",
                   build_version);
    return true;
#endif
}

bool log_running_partition_and_mark_valid_early()
{
    bool ota_first_boot = false;
    const esp_partition_t* partition = esp_ota_get_running_partition();
    if (!partition) {
        mclog::tagError("BOOT-DIAG", "event=ota_state running_partition=null action=skip_mark_valid");
        return ota_first_boot;
    }

    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    esp_err_t state_err        = esp_ota_get_state_partition(partition, &state);
    if (state_err == ESP_OK) {
        mclog::tagInfo("BOOT-DIAG", "event=ota_state phase=before_mark running_partition={} address=0x{:x} state={}",
                       partition->label, static_cast<unsigned>(partition->address), ota_state_to_string(state));
        ota_first_boot = set_xiaozhi_boot_policy_on_ota_first_boot(state);
    } else {
        mclog::tagWarn("BOOT-DIAG", "event=ota_state phase=before_mark running_partition={} address=0x{:x} err={}",
                       partition->label, static_cast<unsigned>(partition->address), esp_err_to_name(state_err));
    }

    Ota ota;
    ota.MarkCurrentVersionValid();

    state_err = esp_ota_get_state_partition(partition, &state);
    if (state_err == ESP_OK) {
        mclog::tagInfo("BOOT-DIAG", "event=ota_state phase=after_mark running_partition={} state={}", partition->label,
                       ota_state_to_string(state));
    } else {
        mclog::tagWarn("BOOT-DIAG", "event=ota_state phase=after_mark running_partition={} err={}", partition->label,
                       esp_err_to_name(state_err));
    }

    return ota_first_boot;
}

void force_launcher_boot_after_xiaozhi_fail_limit(const char* source, int fail_count)
{
    Settings writable_boot_settings(kBootNvsNamespace, true);
    writable_boot_settings.SetString(kBootDefaultModeKey, kBootDefaultLauncher);
    writable_boot_settings.SetBool(kBootAutoStartOnceKey, false);
    writable_boot_settings.SetInt(kBootAutoStartFailCountKey, 0);
    mclog::tagWarn("BOOT-MODE",
                   "route=launcher_only event=fallback source={} reason=fail_count_limit fallback=launcher "
                   "action=set_default_launcher_clear_once_reset_fail_count fail_count={} limit={}",
                   source, fail_count, kBootAutoStartFailCountLimit);
}

const char* get_boot_mode_xiaozhi_auto_open_source(bool ota_first_boot, bool new_local_dock_build)
{
    Settings boot_settings(kBootNvsNamespace, false);
    const auto default_mode = boot_settings.GetString(kBootDefaultModeKey, kBootDefaultLauncher);
    const bool auto_start_once = boot_settings.GetBool(kBootAutoStartOnceKey, false);
    const int fail_count = boot_settings.GetInt(kBootAutoStartFailCountKey, 0);

    mclog::tagInfo("BOOT-MODE", "event=read default_mode={} once={} fail_count={} ota_first_boot={}", default_mode,
                   auto_start_once, fail_count, ota_first_boot ? 1 : 0);

    if (ota_first_boot) {
        Settings writable_boot_settings(kBootNvsNamespace, true);
        writable_boot_settings.SetInt(kBootAutoStartFailCountKey, 1);
        mclog::tagInfo(
            "BOOT-MODE",
            "route=xiaozhi_ota event=auto_open_pending source=ota_first_boot fail_count=0 next_fail_count=1 limit={}",
            kBootAutoStartFailCountLimit);
        return "ota_first_boot";
    }

    if (new_local_dock_build) {
        Settings writable_boot_settings(kBootNvsNamespace, true);
        writable_boot_settings.SetInt(kBootAutoStartFailCountKey, 1);
        mclog::tagInfo("BOOT-MODE",
                       "route=xiaozhi_app_only event=auto_open_pending source=new_local_dock_build "
                       "fail_count=0 next_fail_count=1 limit={}",
                       kBootAutoStartFailCountLimit);
        return "new_local_dock_build";
    }

    if (auto_start_once) {
        if (fail_count >= kBootAutoStartFailCountLimit) {
            force_launcher_boot_after_xiaozhi_fail_limit("once", fail_count);
            return nullptr;
        }

        Settings writable_boot_settings(kBootNvsNamespace, true);
        writable_boot_settings.SetBool(kBootAutoStartOnceKey, false);
        writable_boot_settings.SetInt(kBootAutoStartFailCountKey, fail_count + 1);
        mclog::tagInfo(
            "BOOT-MODE",
            "route=xiaozhi_ota event=auto_open_pending source=once action=clear_once fail_count={} "
            "next_fail_count={} limit={}",
            fail_count, fail_count + 1, kBootAutoStartFailCountLimit);
        return "once";
    }

    if (default_mode == kBootDefaultXiaozhi) {
        if (fail_count >= kBootAutoStartFailCountLimit) {
            force_launcher_boot_after_xiaozhi_fail_limit("default_mode", fail_count);
            return nullptr;
        }

        {
            Settings writable_boot_settings(kBootNvsNamespace, true);
            writable_boot_settings.SetInt(kBootAutoStartFailCountKey, fail_count + 1);
        }
        mclog::tagInfo(
            "BOOT-MODE",
            "route=xiaozhi_ota event=auto_open_pending source=default_mode fail_count={} next_fail_count={} limit={}",
            fail_count, fail_count + 1, kBootAutoStartFailCountLimit);
        return "default_mode";
    }

    if (fail_count != 0) {
        Settings writable_boot_settings(kBootNvsNamespace, true);
        writable_boot_settings.SetInt(kBootAutoStartFailCountKey, 0);
        mclog::tagInfo("BOOT-MODE", "route=launcher_only event=reset_fail_count source=default_mode default_mode={}",
                       default_mode);
    }

    mclog::tagInfo("BOOT-MODE", "route=launcher_only event=skip source=default_mode reason=launcher_or_unknown default_mode={}",
                   default_mode);
    return nullptr;
}
}  // namespace

extern "C" void app_main(void)
{
    // Setup logger
    mclog::set_level(mclog::level_info);
    mclog::set_time_format(mclog::time_format_unix_milliseconds);

    const esp_app_desc_t* app_desc = esp_app_get_description();
    mclog::tagInfo("BOOT-DIAG", "app_version={} project={} reset_reason={} sys_evt_stack={}", app_desc->version,
                   app_desc->project_name, static_cast<int>(esp_reset_reason()),
                   CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE);

    // HAL init
    GetHAL().init();

    // Confirm the freshly booted OTA app as valid before any Launcher/Xiaozhi path
    // can reboot. Launcher-only boots may never call updateFirmwareEx(), so the
    // rollback state must be handled here, once NVS/board init is ready.
    [[maybe_unused]] const bool ota_first_boot = log_running_partition_and_mark_valid_early();
    [[maybe_unused]] const bool new_local_dock_build = set_xiaozhi_boot_policy_on_new_local_dock_build();

    // Setup ui hal
    ui_hal::on_delay([](uint32_t ms) { GetHAL().delay(ms); });
    ui_hal::on_get_tick([]() { return GetHAL().millis(); });

#if CONFIG_STACKCHAN_USB_UAC_MVP
    // The companion owns its neutral face directly; no app runtime is installed
    // here, so nothing covers the face or starts a WebSocket service.
    Display* display = Board::GetInstance().GetDisplay();
    ESP_ERROR_CHECK(display != nullptr ? ESP_OK : ESP_ERR_NOT_FOUND);
    display->SetupUI();
    display->SetEmotion("neutral");

    // USB UAC owns the codec directly in this baseline.
    ESP_ERROR_CHECK(start_stackchan_usb_uac_mvp());

    while (1) {
        GetHAL().feedTheDog();
        GetHAL().updateHeapStatusLog();
        {
            LvglLockGuard lock;
            GetStackChan().update();
        }
        GetHAL().delay(20);
    }
#elif CONFIG_STACKCHAN_WIFI_AUDIO_MVP
    // Wi-Fi Audio owns the same codec, so it has an equally isolated runtime.
    ESP_LOGI("WIFI-AUDIO", "boot stage: isolated runtime entered");
    Display* display = Board::GetInstance().GetDisplay();
    ESP_ERROR_CHECK(display != nullptr ? ESP_OK : ESP_ERR_NOT_FOUND);
    ESP_LOGI("WIFI-AUDIO", "boot stage: display acquired");
    display->SetupUI();
    display->SetEmotion("neutral");
    ESP_LOGI("WIFI-AUDIO", "boot stage: display initialized");
    // The normal Setup app is intentionally absent in this isolated runtime,
    // so start its BLE provisioning service explicitly before reading the
    // Wi-Fi Audio endpoint saved by the phone.
#if CONFIG_STACKCHAN_WIFI_AUDIO_AUTOSTART
    ESP_LOGI("WIFI-AUDIO", "boot stage: BLE config begin");
    GetHAL().startAppConfigServer();
    ESP_LOGI("WIFI-AUDIO", "boot stage: BLE config complete");
    ESP_LOGI("WIFI-AUDIO", "boot stage: transport begin");
    ESP_ERROR_CHECK(start_stackchan_wifi_audio_dock_mvp());
    ESP_LOGI("WIFI-AUDIO", "boot stage: transport scheduled");
#else
    mclog::tagWarn("WIFI-AUDIO", "runtime autostart disabled for boot diagnosis");
#endif

    while (1) {
        GetHAL().feedTheDog();
        GetHAL().updateHeapStatusLog();
        {
            LvglLockGuard lock;
            update_stackchan_wifi_audio_volume_gesture();
            GetStackChan().update();
        }
        GetHAL().delay(20);
    }
#else
    const char* auto_open_ai_agent_source = get_boot_mode_xiaozhi_auto_open_source(ota_first_boot, new_local_dock_build);

    // Install apps
    auto launcher = std::make_unique<AppLauncher>();
    if (auto_open_ai_agent_source) {
        // Ask the Launcher to open AI.AGENT after its view/startup worker is ready.
        // This intentionally goes through the same Launcher close -> Mooncake openApp ->
        // AppAiAgent::onOpen lifecycle as a real icon click instead of requesting
        // Xiaozhi directly from boot code.
        launcher->requestAutoOpenAiAgent(auto_open_ai_agent_source);
    }
    GetMooncake().installApp(std::move(launcher));
    GetMooncake().installApp(std::make_unique<AppAiAgent>());
#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK
    // This product profile deliberately keeps only the touch-reachable
    // settings/recovery UI and the official AI.Agent entrypoint.
    GetMooncake().installApp(std::make_unique<AppSetup>());
#else
    GetMooncake().installApp(std::make_unique<AppAvatar>());
    GetMooncake().installApp(std::make_unique<AppEspnowControl>());
    GetMooncake().installApp(std::make_unique<AppAppCenter>());
    GetMooncake().installApp(std::make_unique<AppEzdata>());
    GetMooncake().installApp(std::make_unique<AppDance>());
    GetMooncake().installApp(std::make_unique<AppSetup>());
#endif

    // Main loop
    while (1) {
        GetHAL().feedTheDog();
        GetHAL().updateHeapStatusLog();

        GetMooncake().update();

        if (GetHAL().isXiaozhiStartRequested()) {
            break;
        }
    }

    // Uninstall all apps and destroy mooncake
    GetMooncake().uninstallAllApps();
    DestroyMooncake();

    // Start xiaozhi, never returns
    GetHAL().startXiaozhi();
#endif
}
