/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "app_launcher.h"
#include <apps/app_ai_agent/app_ai_agent.h>
#include <hal/hal.h>
#include <mooncake.h>
#include <mooncake_log.h>
#include <stackchan/stackchan.h>
#include <cstdint>

using namespace mooncake;

namespace {
constexpr uint32_t kAutoOpenAiAgentRetryIntervalMs = 750;
}

void AppLauncher::onLauncherCreate()
{
    mclog::tagInfo(getAppInfo().name, "on create");

    // 打开自己
    open();
}

void AppLauncher::onLauncherOpen()
{
    mclog::tagInfo(getAppInfo().name, "on open");

    LvglLockGuard lock;

    if (!_startup_checked && !GetHAL().isAppConfiged()) {
        mclog::tagInfo(getAppInfo().name, "app not configured, start startup worker");
        _startup_worker = std::make_unique<setup_workers::StartupWorker>();
    } else {
        create_launcher_view();
    }
}

void AppLauncher::onLauncherRunning()
{
    LvglLockGuard lock;

    if (_startup_worker) {
        _startup_worker->update();
        if (_startup_worker->isDone()) {
            _startup_worker.reset();
            _startup_checked = true;
            create_launcher_view();
        }
    } else {
        _view->update();
        screensaver_update();
        retry_auto_open_ai_agent_if_due();
    }

    GetStackChan().update();
}

void AppLauncher::onLauncherClose()
{
    mclog::tagInfo(getAppInfo().name, "on close");

    LvglLockGuard lock;

    _view.reset();
}

void AppLauncher::onLauncherDestroy()
{
    mclog::tagInfo(getAppInfo().name, "on close");
}

void AppLauncher::requestAutoOpenAiAgent(const char* source)
{
    _auto_open_ai_agent_pending = true;
    _auto_open_ai_agent_source = source;
    _last_auto_open_ai_agent_retry_ms = 0;
    mclog::tagInfo(getAppInfo().name, "BOOT-MODE event=requestAutoOpenAiAgent source={}",
                   _auto_open_ai_agent_source ? _auto_open_ai_agent_source : "unknown");
}

void AppLauncher::create_launcher_view()
{
    _view = std::make_unique<view::LauncherView>();
    _view->init(getAppProps());
    _view->onAppClicked = [&](int appID) {
        mclog::tagInfo(getAppInfo().name, "handle open app, app id: {}", appID);
        openApp(appID);
    };

    if (_auto_open_ai_agent_pending) {
        mclog::tagInfo(getAppInfo().name, "LAUNCHER-OTA disabled reason=xiaozhi_route source={} action=auto_open_ai_agent",
                       _auto_open_ai_agent_source ? _auto_open_ai_agent_source : "unknown");
        try_auto_open_ai_agent();
        return;
    }

    // Launcher autonomous OTA is intentionally default-off. The primary recovery/update
    // route is: boot Launcher safely -> auto-open AI.AGENT/Xiaozhi when requested -> let
    // Xiaozhi's own OTA path run. Manual Settings/About firmware update still calls
    // Hal::updateFirmware() directly and is not affected by this default-off policy.
    mclog::tagInfo(getAppInfo().name, "LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher");
}

void AppLauncher::try_auto_open_ai_agent()
{
    if (!_auto_open_ai_agent_pending) {
        return;
    }

    for (const auto& app_props : GetMooncake().getAllAppProps()) {
        if (app_props.info.name == AppAiAgent::kAppName) {
            _auto_open_ai_agent_pending = false;
            mclog::tagInfo(getAppInfo().name, "event=auto_open app={} app_id={} source={}", AppAiAgent::kAppName,
                           app_props.appID, _auto_open_ai_agent_source ? _auto_open_ai_agent_source : "unknown");
            openApp(app_props.appID);
            return;
        }
    }

    mclog::tagWarn(getAppInfo().name, "event=auto_open_skip reason=app_not_found app={}", AppAiAgent::kAppName);
}

void AppLauncher::retry_auto_open_ai_agent_if_due()
{
    if (!_auto_open_ai_agent_pending) {
        return;
    }

    const uint32_t now_ms = GetHAL().millis();
    if (_last_auto_open_ai_agent_retry_ms != 0 &&
        now_ms - _last_auto_open_ai_agent_retry_ms < kAutoOpenAiAgentRetryIntervalMs) {
        return;
    }

    _last_auto_open_ai_agent_retry_ms = now_ms;
    mclog::tagInfo(getAppInfo().name, "event=auto_open_retry app={} source={} interval_ms={}", AppAiAgent::kAppName,
                   _auto_open_ai_agent_source ? _auto_open_ai_agent_source : "unknown",
                   kAutoOpenAiAgentRetryIntervalMs);
    try_auto_open_ai_agent();
}

void AppLauncher::screensaver_update()
{
    const uint32_t SCREENSAVER_TIMEOUT_MS = 30000;

    uint32_t idle_time = lv_display_get_inactive_time(NULL);
    if (idle_time >= SCREENSAVER_TIMEOUT_MS) {
        if (!_screensaver) {
            _screensaver = std::make_unique<view::Screensaver>();
            _screensaver->init();
        }
    } else if (_screensaver) {
        _screensaver.reset();
    }

    // Update in 30ms interval
    if (_screensaver && GetHAL().millis() - _screensaver_timecount > 30) {
        _screensaver_timecount = GetHAL().millis();
        _screensaver->update();
    }
}
