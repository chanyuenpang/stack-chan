/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 *
 * self.robot.celebrate MCP tool - 非阻塞庆祝动画实现
 *
 * 设计目标：
 * - MCP callback 立即返回 true，不阻塞 AI 响应
 * - 实际庆祝动作（声音 + 跳舞 + LED 渐变）异步执行
 * - 复用现有 DanceModifier::Happy 动画
 * - 约 3-5 秒后自动清理
 */
#include "celebrate.h"
#include <esp_timer.h>
#include <mooncake_log.h>
#include <stackchan/stackchan.h>
#include <hal/hal_bridge.h>
#include <stackchan/modifiers/dance.h>

using namespace stackchan;

static const std::string_view _tag = "CELEBRATE";

/**
 * @brief 渐变步进间隔 (ms)
 */
static constexpr int _led_step_ms = 50;

/**
 * @brief 渐变总持续时间 (ms)
 */
static constexpr int _celebration_ms = 4000;

/**
 * @brief 总步数
 */
static constexpr int _total_steps = _celebration_ms / _led_step_ms;

/**
 * @brief 当前是否正在执行庆祝动画
 */
static bool _celebrate_active = false;

/**
 * @brief 当前步数
 */
static int _led_step = 0;

/**
 * @brief 渐变定时器句柄
 */
static esp_timer_handle_t _led_timer = nullptr;

/**
 * @brief 预设颜色序列：柔和呼吸效果
 *
 * 三个阶段：
 *   Phase 1 (0-33%): 关闭 → 暖金色 (0→80, 0→60, 0→0)
 *   Phase 2 (33-66%): 暖金色 → 暖粉色 (80→100, 60→30, 0→30)
 *   Phase 3 (66-100%): 暖粉色 → 关闭 (100→0, 30→0, 30→0)
 *
 * 颜色值范围 0-168（与现有 set_led_color 一致）
 * 叠加正弦波呼吸因子做平滑效果
 */
static void _update_led(void)
{
    if (!_celebrate_active) {
        return;
    }

    float progress = static_cast<float>(_led_step) / _total_steps;
    progress = std::min(progress, 1.0f);

    int r, g, b;

    if (progress < 0.33f) {
        float t = progress / 0.33f;
        r = static_cast<int>(80.0f * t);
        g = static_cast<int>(60.0f * t);
        b = 0;
    } else if (progress < 0.66f) {
        float t = (progress - 0.33f) / 0.33f;
        r = static_cast<int>(80.0f + 20.0f * t);
        g = static_cast<int>(60.0f - 30.0f * t);
        b = static_cast<int>(30.0f * t);
    } else {
        float t = (progress - 0.66f) / 0.34f;
        r = static_cast<int>(100.0f * (1.0f - t));
        g = static_cast<int>(30.0f * (1.0f - t));
        b = static_cast<int>(30.0f * (1.0f - t));
    }

    // 叠加正弦呼吸因子
    float breathe = std::sin(progress * 3.14159f * 2.0f) * 0.3f + 0.7f;
    r = std::clamp(static_cast<int>(r * breathe), 0, 168);
    g = std::clamp(static_cast<int>(g * breathe), 0, 168);
    b = std::clamp(static_cast<int>(b * breathe), 0, 168);

    {
        LvglLockGuard lock;
        GetStackChan().leftNeonLight().setColor(r, g, b);
        GetStackChan().rightNeonLight().setColor(r, g, b);
    }

    _led_step++;

    if (_led_step >= _total_steps) {
        // 关闭灯光并清理
        {
            LvglLockGuard lock;
            GetStackChan().leftNeonLight().setColor(0, 0, 0);
            GetStackChan().rightNeonLight().setColor(0, 0, 0);
        }

        if (_led_timer) {
            esp_timer_stop(_led_timer);
            esp_timer_delete(_led_timer);
            _led_timer = nullptr;
        }

        _celebrate_active = false;
        _led_step = 0;
        mclog::tagInfo(_tag, "celebration finished");
    }
}

void tools::celebrate()
{
    if (_celebrate_active) {
        mclog::tagInfo(_tag, "celebration already running, ignoring duplicate");
        return;
    }

    mclog::tagInfo(_tag, "starting celebration");

    _celebrate_active = true;
    _led_step = 0;

    // 1. 播放提示音（异步，不阻塞）
    hal_bridge::app_play_sound(OGG_NEW_NOTIFICATION);

    // 2. 触发 Happy 跳舞动画（异步，由 Modifier 框架驱动）
    {
        LvglLockGuard lock;
        GetStackChan().addModifier<DanceModifier>(DanceModifier::Happy);
    }

    // 3. 启动 LED 渐变定时器（esp_timer，不阻塞 MCP 响应）
    const esp_timer_create_args_t timer_args = {
        .callback = &_update_led,
        .arg = nullptr,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "celebrate_led",
        .skip_unhandled_events = true,
    };

    if (_led_timer) {
        esp_timer_delete(_led_timer);
        _led_timer = nullptr;
    }

    esp_timer_create(&timer_args, &_led_timer);
    esp_timer_start_periodic(_led_timer, _led_step_ms * 1000);  // 微秒单位

    mclog::tagInfo(_tag, "celebration started, MCP returning immediately");
}
