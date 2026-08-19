/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include "hal_audio_performance_diagnostics.h"
#include "board/hal_bridge.h"
#include "drivers/PY32IOExpander_Class/PY32IOExpander_Class.hpp"
#include <mooncake_log.h>
#include <memory>

static const std::string_view _tag = "HAL-IOE";

static std::unique_ptr<m5::PY32IOExpander_Class> _io_expander;

void Hal::io_expander_init()
{
    mclog::tagInfo(_tag, "init");

    auto i2c_bus        = hal_bridge::board_get_i2c_bus();
    _io_expander        = std::make_unique<m5::PY32IOExpander_Class>(i2c_bus);
    uint32_t start_tick = GetHAL().millis();

    // PY32 IO Expander may boot slowly, wait for it
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(200));

        if (GetHAL().millis() - start_tick > 1200) {
            mclog::tagError(_tag, "init timeout");
            _io_expander.reset();
            break;
        }

        if (_io_expander->begin()) {
            break;
        }
        mclog::tagInfo(_tag, "init failed, retrying...");
    }

    if (_io_expander) {
        // VM EN
        _io_expander->setDirection(0, true);  // Output
        _io_expander->setPullMode(0, true);   // Pull-up
        GetHAL().setServoPowerEnabled(true);
        vTaskDelay(pdMS_TO_TICKS(200));

        // RGB
        _io_expander->setDirection(13, true);   // Output
        _io_expander->setPullMode(13, true);    // Pull-up
        _io_expander->setDriveMode(13, false);  // Push-pull
        _io_expander->setLedCount(12);
        vTaskDelay(pdMS_TO_TICKS(200));
        GetHAL().showRgbColor(0, 0, 0);
        vTaskDelay(pdMS_TO_TICKS(50));
        GetHAL().showRgbColor(0, 0, 0);

        mclog::tagInfo(_tag, "init done");
    }
}

void Hal::setServoPowerEnabled(bool enabled)
{
    if (!_io_expander) {
        return;
    }
    _io_expander->digitalWrite(0, enabled ? true : false);
}

void Hal::setRgbColor(uint8_t index, uint8_t r, uint8_t g, uint8_t b)
{
    if (!_io_expander) {
        return;
    }
#if defined(CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS) && \
    CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS
    const uint32_t start_us = stackchan_audio_diag::NowUs();
#endif
    _io_expander->setLedColor(index, r, g, b);
#if defined(CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS) && \
    CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS
    stackchan_audio_diag::RecordLedSetI2c(
        static_cast<uint32_t>(stackchan_audio_diag::NowUs() - start_us));
#endif
}

void Hal::refreshRgb()
{
    if (!_io_expander) {
        return;
    }
#if defined(CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS) && \
    CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS
    const uint32_t start_us = stackchan_audio_diag::NowUs();
#endif
    _io_expander->refreshLeds();
#if defined(CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS) && \
    CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS
    stackchan_audio_diag::RecordLedRefreshI2c(
        static_cast<uint32_t>(stackchan_audio_diag::NowUs() - start_us));
#endif
}

void Hal::showRgbColor(uint8_t r, uint8_t g, uint8_t b)
{
    for (int i = 0; i < 12; i++) {
        setRgbColor(i, r, g, b);
    }
    refreshRgb();
}
