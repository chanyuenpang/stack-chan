/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include "view/view.h"
#include <apps/app_setup/workers/workers.h>
#include <mooncake.h>
#include <mooncake_templates.h>
#include <cstdint>
#include <memory>

class AppLauncher : public mooncake::templates::AppLauncherBase {
public:
    void onLauncherCreate() override;
    void onLauncherOpen() override;
    void onLauncherRunning() override;
    void onLauncherClose() override;
    void onLauncherDestroy() override;

    void requestAutoOpenAiAgent(const char* source);

private:
    std::unique_ptr<view::LauncherView> _view;
    std::unique_ptr<view::Screensaver> _screensaver;
    std::unique_ptr<setup_workers::StartupWorker> _startup_worker;
    uint32_t _screensaver_timecount = 0;
    uint32_t _last_auto_open_ai_agent_retry_ms = 0;
    bool _startup_checked           = false;
    bool _auto_open_ai_agent_pending = false;
    const char* _auto_open_ai_agent_source = nullptr;

    void create_launcher_view();
    void try_auto_open_ai_agent();
    void retry_auto_open_ai_agent_if_due();
    void screensaver_update();
};
