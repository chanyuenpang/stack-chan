/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include <mooncake_log.h>
#include <cstdio>
#include <memory>
#include <atomic>
#include <ota.h>
#include <settings.h>

static const std::string_view _tag = "HAL-OTA";

namespace {
constexpr const char* kBootNvsNamespace = "boot";
constexpr const char* kBootDefaultModeKey = "default_mode";
constexpr const char* kBootAutoStartOnceKey = "start_once";
constexpr const char* kBootAutoStartFailCountKey = "fail_count";
constexpr const char* kBootDefaultXiaozhi = "xiaozhi";
std::atomic<bool> s_ota_running{false};

class OtaRunningGuard {
public:
    OtaRunningGuard() : _locked(!s_ota_running.exchange(true)) {}
    ~OtaRunningGuard()
    {
        if (_locked) {
            s_ota_running = false;
        }
    }

    bool locked() const
    {
        return _locked;
    }

private:
    bool _locked = false;
};

void set_xiaozhi_boot_policy_after_ota()
{
    Settings boot_settings(kBootNvsNamespace, true);
    boot_settings.SetString(kBootDefaultModeKey, kBootDefaultXiaozhi);
    boot_settings.SetBool(kBootAutoStartOnceKey, false);
    boot_settings.SetInt(kBootAutoStartFailCountKey, 0);
    mclog::tagInfo("BOOT-MODE",
                   "route=xiaozhi_ota event=set_next_boot source=ota_update default_mode={} once=0 fail_count=0 "
                   "fail_count_protected=1",
                   kBootDefaultXiaozhi);
}
}  // namespace

bool Hal::updateFirmware(std::function<void(std::string_view)> onLog)
{
    FirmwareUpdateResult result = updateFirmwareEx(onLog);
    return result == FirmwareUpdateResult::NoUpdate || result == FirmwareUpdateResult::Rebooting;
}

FirmwareUpdateResult Hal::updateFirmwareEx(std::function<void(std::string_view)> onLog)
{
    OtaRunningGuard running_guard;
    if (!running_guard.locked()) {
        mclog::tagWarn(_tag, "LAUNCHER-OTA update fail reason=busy");
        if (onLog) {
            onLog("Firmware update is already running");
        }
        return FirmwareUpdateResult::Busy;
    }

    if (onLog) {
        onLog("Checking firmware updates...");
    }
    mclog::tagInfo(_tag, "LAUNCHER-OTA check start");

    Ota ota;
    ota.MarkCurrentVersionValid();
    esp_err_t err = ota.CheckVersion();
    if (err != ESP_OK) {
        mclog::tagError(_tag, "LAUNCHER-OTA update fail stage=check err={}", esp_err_to_name(err));
        if (onLog) {
            onLog("Failed to check firmware updates");
        }
        return FirmwareUpdateResult::CheckFailed;
    }

    if (!ota.HasNewVersion()) {
        ota.MarkCurrentVersionValid();
        mclog::tagInfo(_tag, "LAUNCHER-OTA no update");
        if (onLog) {
            onLog("Already up to date");
        }
        return FirmwareUpdateResult::NoUpdate;
    }

    const std::string& firmware_url     = ota.GetFirmwareUrl();
    const std::string& firmware_version = ota.GetFirmwareVersion();
    if (firmware_url.empty()) {
        mclog::tagError(_tag, "LAUNCHER-OTA update fail stage=metadata reason=empty_url version={}", firmware_version);
        if (onLog) {
            onLog("Invalid firmware update info");
        }
        return FirmwareUpdateResult::UpgradeFailed;
    }

    mclog::tagInfo(_tag, "LAUNCHER-OTA update start version={} url={}", firmware_version, firmware_url);
    if (onLog) {
        if (!firmware_version.empty()) {
            onLog(std::string("New firmware found: ") + firmware_version);
        } else {
            onLog("New firmware found");
        }
        onLog("Starting firmware upgrade...");
    }

    int last_reported_progress = -1;
    bool upgrade_success       = Ota::Upgrade(firmware_url, [&](int progress, size_t speed) {
        if (progress == last_reported_progress) {
            return;
        }

        last_reported_progress = progress;

        char msg[48];
        std::snprintf(msg, sizeof(msg), "Upgrading firmware: %d%% at %uKB/s", progress,
                      static_cast<unsigned>(speed / 1024));
        if (onLog) {
            onLog(msg);
        }
    });

    if (!upgrade_success) {
        mclog::tagError(_tag, "LAUNCHER-OTA update fail stage=upgrade version={} url={}", firmware_version,
                        firmware_url);
        if (onLog) {
            onLog("Firmware upgrade failed");
        }
        return FirmwareUpdateResult::UpgradeFailed;
    }

    set_xiaozhi_boot_policy_after_ota();
    mclog::tagInfo(_tag, "LAUNCHER-OTA update success version={} action=reboot next_route=xiaozhi_ota", firmware_version);
    if (onLog) {
        onLog("Upgrade successful, rebooting...");
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
    reboot();
    return FirmwareUpdateResult::Rebooting;
}
