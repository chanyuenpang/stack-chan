/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include "hal_celebrate.h"
#include "hal_dev_local_control.h"
#include "hal_stackchan_performance.h"
#include <mooncake_log.h>
#include <mcp_server.h>
#include <stackchan/stackchan.h>
#include <stackchan/modifiers/dance.h>
#include <apps/common/common.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <cstddef>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <new>
#include <string_view>

using namespace stackchan;

static const std::string_view _tag = "HAL-MCP";

namespace {

int g_celebrate_dance_modifier_id = -1;
Modifier* g_celebrate_dance_modifier_ptr = nullptr;
std::mutex g_celebrate_mutex;

static int clampHeadTarget(int value, int minValue, int maxValue)
{
    if (value < minValue) {
        return minValue;
    }
    if (value > maxValue) {
        return maxValue;
    }
    return value;
}

class HeadMotionSchedulerModifier;
HeadMotionSchedulerModifier* g_head_motion_scheduler = nullptr;

class HeadMotionSchedulerModifier : public Modifier {
public:
    HeadMotionSchedulerModifier() = default;

    ~HeadMotionSchedulerModifier() override
    {
        if (g_head_motion_scheduler == this) {
            g_head_motion_scheduler = nullptr;
        }
    }

    void submit(Modifiable& stackchan, bool hasYaw, int yawTarget, bool hasPitch, int pitchTarget, int speed)
    {
        auto& motion = stackchan.motion();

        auto animBase  = motion.getAnimationAngles();
        int baseYaw    = _has_last_commanded ? _last_yaw : clampHeadTarget(animBase.x, kYawMin, kYawMax);
        int basePitch  = _has_last_commanded ? _last_pitch : clampHeadTarget(animBase.y, kPitchMin, kPitchMax);
        int finalYaw   = hasYaw ? clampHeadTarget(yawTarget, kYawMin, kYawMax) : baseYaw;
        int finalPitch = hasPitch ? clampHeadTarget(pitchTarget, kPitchMin, kPitchMax) : basePitch;

        if (hasYaw && std::abs(finalYaw - baseYaw) < kTinyDelta) {
            finalYaw = baseYaw;
        }
        if (hasPitch && std::abs(finalPitch - basePitch) < kTinyDelta) {
            finalPitch = basePitch;
        }

        if (motion.hasBusDead()) {
            motion.stop();
            mclog::tagWarn("SERVO-SCHED",
                           "event=reject_bus_dead active={} has_pending={} target_yaw={} target_pitch={} action=no_write",
                           _active ? 1 : 0, _has_pending ? 1 : 0, finalYaw, finalPitch);
            return;
        }

        if (finalYaw == baseYaw && finalPitch == basePitch) {
            mclog::tagInfo(_tag, "head scheduler tiny/no-op ignored: yaw={}, pitch={}", finalYaw, finalPitch);
            return;
        }

        const bool startsNewHeadMotion = !_has_pending && !_active;
        _pending_yaw                   = finalYaw;
        _pending_pitch                 = finalPitch;
        _pending_speed                 = clampHeadTarget(speed, kSpeedMin, kSpeedMax);
        _pending_sync_from_present     = false;
        _has_pending                   = true;
        _next_dispatch_ms = GetHAL().millis() + kDebounceMs;
        _release_at_ms    = 0;
        requestPerformanceLease();

        const bool moving = motion.isMoving();
        logState("queued", nowMs(), moving, startsNewHeadMotion ? _pending_sync_from_present : false, 0);
        mclog::tagInfo("SERVO-REQ",
                       "source=head_scheduler_queue has_yaw={} raw_yaw={} final_yaw={} base_yaw={} anim_yaw={} has_pitch={} raw_pitch={} final_pitch={} base_pitch={} anim_pitch={} speed={} dispatch_in_ms={} sync_from_present={}",
                       hasYaw ? 1 : 0, yawTarget, _pending_yaw, baseYaw, animBase.x, hasPitch ? 1 : 0, pitchTarget,
                       _pending_pitch, basePitch, animBase.y, _pending_speed, kDebounceMs,
                       _pending_sync_from_present ? 1 : 0);
    }

    bool isHighRefreshActive() const
    {
        return _has_pending || _active;
    }

    void _update(Modifiable& stackchan) override
    {
        uint32_t now = GetHAL().millis();

        if (_has_pending && now >= _next_dispatch_ms) {
            _has_pending        = false;
            _last_yaw           = _pending_yaw;
            _last_pitch         = _pending_pitch;
            _has_last_commanded = true;
            _active             = true;
            _active_since_ms    = now;
            _release_at_ms      = 0;
            requestPerformanceLease();

            auto& motion              = stackchan.motion();
            const bool syncFromPresent = false;
            auto animBeforeSync        = motion.getAnimationAngles();
            auto currentForStart       = animBeforeSync;
            auto animAfterSync         = animBeforeSync;
            _pending_sync_from_present = false;

            if (motion.hasBusDead()) {
                logState("force_release", now, false, syncFromPresent, 0, "bus_dead_before_dispatch", false);
                motion.stop();
                _active          = false;
                _has_pending     = false;
                _release_at_ms   = 0;
                _active_since_ms = 0;
                requestDestroy();
                return;
            }

            motion.moveWithSpeedNoHardwareRead(_last_yaw, _last_pitch, _pending_speed);
            logState("dispatch", now, motion.isMoving(), syncFromPresent, 0);
            mclog::tagInfo("SERVO-REQ",
                           "source=head_scheduler_dispatch yaw={} pitch={} speed={} t_ms={} sync_from_present={} anim_yaw_before={} anim_pitch_before={} current_yaw={} current_pitch={} anim_yaw_start={} anim_pitch_start={}",
                           _last_yaw, _last_pitch, _pending_speed, now, syncFromPresent ? 1 : 0,
                           animBeforeSync.x, animBeforeSync.y, currentForStart.x, currentForStart.y,
                           animAfterSync.x, animAfterSync.y);
        }

        auto& motion = stackchan.motion();
        const uint32_t active_elapsed_ms = (_active && _active_since_ms != 0) ? (now - _active_since_ms) : 0;
        const bool hardTimeoutReached = _active && _active_since_ms != 0 && active_elapsed_ms >= kHardActiveTimeoutMs;
        if ((_has_pending || _active) && !hardTimeoutReached && motion.hasBusDead()) {
            logState("force_release", now, false, false, active_elapsed_ms, "bus_dead", false);
            motion.stop();
            _active          = false;
            _has_pending     = false;
            _release_at_ms   = 0;
            _active_since_ms = 0;
            requestDestroy();
            return;
        }

        if (hardTimeoutReached) {
            const uint32_t elapsed_ms       = active_elapsed_ms;
            const bool moving              = motion.isMoving();
            const bool busDead             = motion.hasBusDead();
            const bool transientIoError    = motion.hasTransientIoError();
            const bool hardwareFailure     = motion.hasHardwareFailure();
            const bool canReleaseWithWrite = !busDead && !transientIoError && !hardwareFailure;
            logState("force_release", now, moving, false, elapsed_ms, "hard_timeout", canReleaseWithWrite,
                     canReleaseWithWrite ? "release" : "no_write_stop", busDead, transientIoError, hardwareFailure);
            if (canReleaseWithWrite) {
                motion.release();
            } else {
                motion.stop();
            }
            _active          = false;
            _has_pending     = false;
            _release_at_ms   = 0;
            _active_since_ms = 0;
            requestDestroy();
            return;
        }

        const bool moving = motion.isMoving();
        const uint32_t elapsed_ms = (_active && _active_since_ms != 0) ? (now - _active_since_ms) : 0;
        if (!_has_pending && _active && !moving) {
            if (_release_at_ms == 0) {
                _release_at_ms = now + kReleaseDelayMs;
                logState("release_pending", now, moving, false, elapsed_ms);
            } else if (now >= _release_at_ms) {
                const bool busHealthy = !motion.hasHardwareFailure();
                logState("released", now, moving, false, elapsed_ms, nullptr, busHealthy);
                stackchan.motion().release();
                _active          = false;
                _release_at_ms   = 0;
                _active_since_ms = 0;
                requestDestroy();
            }
        } else if (_has_pending || _active) {
            requestPerformanceLease();
        }
    }

private:
    static uint32_t nowMs()
    {
        return GetHAL().millis();
    }

    void requestPerformanceLease()
    {
        stackchan_perf::request_stackchan_performance_mode("head_motion_scheduler", kPerformanceTtlMs);
    }

    void logState(const char* event, uint32_t now, bool isMoving, bool syncFromPresent,
                  uint32_t elapsedMs, const char* reason = nullptr, bool busHealthy = true,
                  const char* action = "none", bool busDead = false, bool transientIoError = false,
                  bool hardwareFailure = false) const
    {
        const int targetYaw   = _has_pending ? _pending_yaw : _last_yaw;
        const int targetPitch = _has_pending ? _pending_pitch : _last_pitch;
        const int targetSpeed = _has_pending ? _pending_speed : _pending_speed;
        mclog::tagInfo("SERVO-SCHED",
                       "event={} active={} has_pending={} isMoving={} elapsed_ms={} target_yaw={} target_pitch={} speed={} sync_from_present={} reason={} action={} bus_healthy={} bus_dead={} transient_io_error={} hardware_failure={}",
                       event, _active ? 1 : 0, _has_pending ? 1 : 0, isMoving ? 1 : 0, elapsedMs,
                       targetYaw, targetPitch, targetSpeed, syncFromPresent ? 1 : 0, reason ? reason : "none",
                       action, busHealthy ? 1 : 0, busDead ? 1 : 0, transientIoError ? 1 : 0,
                       hardwareFailure ? 1 : 0);
        (void)now;
    }

    static constexpr int kYawMin              = -1280;
    static constexpr int kYawMax              = 1280;
    static constexpr int kPitchMin            = 30;
    static constexpr int kPitchMax            = 870;
    static constexpr int kSpeedMin            = 0;
    static constexpr int kSpeedMax            = 300;
    static constexpr int kTinyDelta           = 15;
    static constexpr uint32_t kDebounceMs          = 30;
    static constexpr uint32_t kReleaseDelayMs      = 150;
    static constexpr uint32_t kPerformanceTtlMs    = 1000;
    static constexpr uint32_t kHardActiveTimeoutMs = 3000;

    bool _has_pending               = false;
    bool _active                    = false;
    bool _has_last_commanded        = false;
    bool _pending_sync_from_present = false;
    int _pending_yaw                = 0;
    int _pending_pitch              = 0;
    int _pending_speed              = 180;
    int _last_yaw                   = 0;
    int _last_pitch            = 0;
    uint32_t _next_dispatch_ms = 0;
    uint32_t _release_at_ms    = 0;
    uint32_t _active_since_ms  = 0;
};

void submitHeadMotion(bool hasYaw, int yawTarget, bool hasPitch, int pitchTarget, int speed)
{
    auto& stackchan = GetStackChan();
    if (!g_head_motion_scheduler) {
        auto scheduler          = std::make_unique<HeadMotionSchedulerModifier>();
        g_head_motion_scheduler = scheduler.get();
        stackchan.addModifier(std::move(scheduler));
    }
    g_head_motion_scheduler->submit(stackchan, hasYaw, yawTarget, hasPitch, pitchTarget, speed);
}


static int clampInt(int value, int minValue, int maxValue)
{
    if (value < minValue) {
        return minValue;
    }
    if (value > maxValue) {
        return maxValue;
    }
    return value;
}

struct SystemRebootContext {
    int delay_ms = 1500;
    char reason[65] = "remote_mcp";
};

static void copySafeRebootReason(char* dest, size_t destSize, const std::string& reason)
{
    if (destSize == 0) {
        return;
    }

    const std::string& source = reason.empty() ? std::string("remote_mcp") : reason;
    size_t pos = 0;
    for (; pos + 1 < destSize && pos < source.size(); ++pos) {
        const unsigned char ch = static_cast<unsigned char>(source[pos]);
        dest[pos] = (ch >= 32 && ch <= 126) ? static_cast<char>(ch) : '_';
    }
    dest[pos] = '\0';
}

static std::string jsonEscape(const char* value)
{
    std::string escaped;
    if (!value) {
        return escaped;
    }
    for (const char* p = value; *p; ++p) {
        if (*p == '\\' || *p == '"') {
            escaped.push_back('\\');
        }
        escaped.push_back(*p);
    }
    return escaped;
}

static void systemRebootTask(void* arg)
{
    auto* ctx = static_cast<SystemRebootContext*>(arg);
    mclog::tagWarn(_tag, "mcp_reboot scheduled: delay_ms={} reason={}", ctx->delay_ms, ctx->reason);
    vTaskDelay(pdMS_TO_TICKS(ctx->delay_ms));
    mclog::tagWarn(_tag, "mcp_reboot now: reason={}", ctx->reason);
    delete ctx;
    esp_restart();
}

static bool scheduleSystemReboot(int delayMs, const std::string& reason, int* scheduledDelayMs = nullptr)
{
    delayMs = clampInt(delayMs, 500, 10000);
    if (scheduledDelayMs) {
        *scheduledDelayMs = delayMs;
    }

    auto* ctx = new (std::nothrow) SystemRebootContext{};
    if (!ctx) {
        mclog::tagError(_tag, "mcp_reboot schedule failed: alloc_failed delay_ms={}", delayMs);
        return false;
    }

    ctx->delay_ms = delayMs;
    copySafeRebootReason(ctx->reason, sizeof(ctx->reason), reason);

    BaseType_t rc = xTaskCreate(systemRebootTask, "mcp_reboot", 4096, ctx, tskIDLE_PRIORITY + 1, nullptr);
    if (rc != pdPASS) {
        mclog::tagError(_tag, "mcp_reboot schedule failed: task_create_failed delay_ms={} reason={}",
                        ctx->delay_ms, ctx->reason);
        delete ctx;
        return false;
    }

    mclog::tagWarn(_tag, "mcp_reboot accepted: delay_ms={} reason={}", ctx->delay_ms, ctx->reason);
    return true;
}


}  // namespace

bool stackchan_celebrate_active()
{
    LvglLockGuard lvgl_lock;
    std::lock_guard<std::mutex> guard(g_celebrate_mutex);
    return g_celebrate_dance_modifier_id >= 0 &&
           GetStackChan().getModifier(g_celebrate_dance_modifier_id) == g_celebrate_dance_modifier_ptr;
}

bool stackchan_motion_high_refresh_active()
{
    return (g_head_motion_scheduler != nullptr && g_head_motion_scheduler->isHighRefreshActive());
}

bool start_celebrate_modifier(std::string style, int durationMs, int intensity, bool sound, std::string* error)
{
    const int requestedDurationMs = durationMs;
    const int requestedIntensity  = intensity;
    durationMs = clampInt(durationMs, 3000, 5000);
    intensity  = clampInt(intensity, 1, 3);

    if (error) {
        error->clear();
    }

    LvglLockGuard lvgl_lock;
    auto& stackchan = GetStackChan();
    if (!stackchan.hasAvatar()) {
        if (error) {
            *error = "avatar_unavailable";
        }
        mclog::tagWarn(_tag,
                       "celebrate rejected: style={} requested_duration_ms={} duration_ms={} requested_intensity={} intensity={} sound={} reason=avatar_unavailable action=dance_modifier_happy",
                       style, requestedDurationMs, durationMs, requestedIntensity, intensity, sound ? 1 : 0);
        return false;
    }

    int removedModifierId = -1;
    bool removedPrevious = false;
    int newModifierId = -1;
    {
        std::lock_guard<std::mutex> guard(g_celebrate_mutex);
        if (g_celebrate_dance_modifier_id >= 0 &&
            stackchan.getModifier(g_celebrate_dance_modifier_id) == g_celebrate_dance_modifier_ptr) {
            removedModifierId = g_celebrate_dance_modifier_id;
            removedPrevious = stackchan.removeModifier(g_celebrate_dance_modifier_id);
        }
        g_celebrate_dance_modifier_id = -1;
        g_celebrate_dance_modifier_ptr = nullptr;

        auto modifier = std::make_unique<DanceModifier>(DanceModifier::Happy);
        g_celebrate_dance_modifier_ptr = modifier.get();
        newModifierId = stackchan.addModifier(std::move(modifier));
        g_celebrate_dance_modifier_id = newModifierId;
        if (newModifierId < 0) {
            g_celebrate_dance_modifier_ptr = nullptr;
        }
    }

    if (newModifierId < 0) {
        if (error) {
            *error = "dance_modifier_add_failed";
        }
        mclog::tagWarn(_tag,
                       "celebrate failed: style={} requested_duration_ms={} duration_ms={} requested_intensity={} intensity={} sound={} action=dance_modifier_happy reason=add_failed",
                       style, requestedDurationMs, durationMs, requestedIntensity, intensity, sound ? 1 : 0);
        return false;
    }

    mclog::tagInfo(_tag,
                   "celebrate started: style={} requested_duration_ms={} duration_ms={} requested_intensity={} intensity={} sound={} action=dance_modifier_happy modifier_id={} removed_previous_id={} removed_previous={}",
                   style, requestedDurationMs, durationMs, requestedIntensity, intensity, sound ? 1 : 0,
                   newModifierId, removedModifierId, removedPrevious ? 1 : 0);
    mclog::tagInfo("SERVO-REQ",
                   "source=celebrate_start style={} requested_duration_ms={} duration_ms={} requested_intensity={} intensity={} sound={} active=1 action=dance_modifier_happy modifier_id={}",
                   style, requestedDurationMs, durationMs, requestedIntensity, intensity, sound ? 1 : 0, newModifierId);
    return true;
}

void stackchan_celebrate_tick(stackchan::Modifiable& stackchan, uint32_t nowMs)
{
    (void)stackchan;
    (void)nowMs;
    // Official DanceModifier/Timeline now drives self.robot.celebrate.
    // Keep this compatibility stub for older callers.
    return;
}

void Hal::xiaozhi_mcp_init()
{
    mclog::tagInfo(_tag, "init");

    // https://github.com/78/xiaozhi-esp32/blob/main/docs/mcp-usage.md
    auto& mcp_server = McpServer::GetInstance();

    // System Prompt：
    // You can control the robot's head. Use get_yaw and get_pitch to sense current position. Use set_yaw for horizontal
    // movement and set_pitch for vertical movement. All angles are in degrees.

    mclog::tagInfo(_tag, "add robot.get_head_angles tool");
    mcp_server.AddTool("self.robot.get_head_angles",
                       "Returns current yaw/pitch in degrees. Neutral position is {yaw:0, pitch:0}.",
                       std::vector<Property>{}, [this](const PropertyList& properties) -> ReturnValue {
                           LvglLockGuard lock;  // StackChan motion update is under the lvgl lock

                           auto& motion      = GetStackChan().motion();
                           int current_yaw   = motion.yawServo().getCurrentAngle() / 10;
                           int current_pitch = motion.pitchServo().getCurrentAngle() / 10;

                           auto result = fmt::format(R"({{"yaw": {}, "pitch": {}}})", current_yaw, current_pitch);
                           mclog::tagInfo(_tag, "get_head_angles: {}", result);
                           return result;
                       });

    mclog::tagInfo(_tag, "add robot.set_head_angles tool");
    mcp_server.AddTool("self.robot.set_head_angles",
                       "Adjust head position in degrees. GUIDELINES: "
                       "1. For natural interaction, stay within +/- 45 degrees. "
                       "2. Only use values > 70 if the user explicitly asks to look far away/behind. "
                       "3. Max ranges: Yaw(-128 to 128, -128 as your left), Pitch(0 to 90, 90 as your up). "
                       "Speed(100-300, 180 is natural/safe). Send the final target once; do not animate by issuing many "
                       "small incremental updates.",
                       PropertyList({Property("yaw", kPropertyTypeInteger, -9999, -9999, 128),
                                     Property("pitch", kPropertyTypeInteger, -9999, -9999, 90),
                                     Property("speed", kPropertyTypeInteger, 180, 100, 300)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int speed = properties["speed"].value<int>();
                           int yaw   = properties["yaw"].value<int>();
                           int pitch = properties["pitch"].value<int>();

                           mclog::tagInfo(_tag, "motion set_angles: yaw: {}, pitch: {}, speed: {}", yaw, pitch, speed);
                           mclog::tagInfo("SERVO-REQ",
                                          "source=mcp_set_head_angles yaw_deg={} pitch_deg={} yaw_internal={} pitch_internal={} speed={}",
                                          yaw, pitch, yaw * 10, pitch * 10, speed);

                           LvglLockGuard lock;
                           submitHeadMotion(yaw != -9999, yaw * 10, pitch != -9999, pitch * 10, speed);

                           return true;
                       });

    mclog::tagInfo(_tag, "add robot.set_head_targets tool");
    mcp_server.AddTool("self.robot.set_head_targets",
                       "Adjust head position using App/servo internal target values, not degrees. "
                       "Ranges: yaw_target -1280 to 1280 (-1280 as your left), pitch_target 0 to 900 "
                       "(0 as down, 900 as up; values below 30 clamp to 30), speed 0 to 300. "
                       "Send the final target once; do not animate by issuing many small incremental updates.",
                       PropertyList({Property("yaw_target", kPropertyTypeInteger, -9999, -9999, 1280),
                                     Property("pitch_target", kPropertyTypeInteger, -9999, -9999, 900),
                                     Property("speed", kPropertyTypeInteger, 180, 0, 300)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int speed        = properties["speed"].value<int>();
                           int yaw_target   = properties["yaw_target"].value<int>();
                           int pitch_target = properties["pitch_target"].value<int>();

                           mclog::tagInfo(_tag, "motion set_targets: yaw_target: {}, pitch_target: {}, speed: {}",
                                          yaw_target, pitch_target, speed);
                           mclog::tagInfo("SERVO-REQ", "source=mcp_set_head_targets yaw_internal={} pitch_internal={} speed={}",
                                          yaw_target, pitch_target, speed);

                           LvglLockGuard lock;
                           submitHeadMotion(yaw_target != -9999, yaw_target, pitch_target != -9999, pitch_target,
                                            speed);

                           return true;
                       });

    mclog::tagInfo(_tag, "add robot.set_led_color tool");
    mcp_server.AddTool(
        "self.robot.set_led_color",
        "Set the color of the robot's INTERNAL onboard LED. This is NOT for room lights. "
        "Values: 0-168 (safe range). Red=168,0,0; Green=0,168,0; Blue=0,0,168; White=100,100,100; Off=0,0,0.",
        PropertyList({Property("red", kPropertyTypeInteger, 0, 0, 168),
                      Property("green", kPropertyTypeInteger, 0, 0, 168),
                      Property("blue", kPropertyTypeInteger, 0, 0, 168)}),
        [this](const PropertyList& properties) -> ReturnValue {
            int r = properties["red"].value<int>();
            int g = properties["green"].value<int>();
            int b = properties["blue"].value<int>();

            mclog::tagInfo(_tag, "set_led_color: r={}, g={}, b={}", r, g, b);

            LvglLockGuard lock;

            GetStackChan().leftNeonLight().setColor(r, g, b);
            GetStackChan().rightNeonLight().setColor(r, g, b);

            return true;
        });

    mclog::tagInfo(_tag, "add robot.celebrate tool");
    mcp_server.AddTool("self.robot.celebrate",
                       "Run a short, gentle celebration on the robot. Styles: cheer/sparkle/nod/calm. "
                       "Non-blocking; keeps LED brightness and head movement in safe low ranges.",
                       PropertyList({Property("style", kPropertyTypeString, std::string("cheer")),
                                     Property("duration_ms", kPropertyTypeInteger, 4000, 3000, 5000),
                                     Property("intensity", kPropertyTypeInteger, 2, 1, 3),
                                     Property("sound", kPropertyTypeBoolean, false)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           std::string style = properties["style"].value<std::string>();
                           int duration_ms   = properties["duration_ms"].value<int>();
                           int intensity     = properties["intensity"].value<int>();
                           bool sound        = properties["sound"].value<bool>();

                           mclog::tagInfo(_tag, "celebrate: style={}, duration_ms={}, intensity={}, sound={}", style,
                                          duration_ms, intensity, sound);
                           mclog::tagInfo("SERVO-REQ",
                                          "source=mcp_celebrate_call style={} duration_ms={} intensity={} sound={}",
                                          style, duration_ms, intensity, sound ? 1 : 0);

                           return start_celebrate_modifier(style, duration_ms, intensity, sound);
                       });

    mclog::tagInfo(_tag, "add robot.create_reminder tool");
    mcp_server.AddTool("self.robot.create_reminder",
                       "Create a reminder. Duration is in seconds. Message is what to say when time is up. Set repeat "
                       "to true to repeat the reminder.",
                       PropertyList({Property("duration_seconds", kPropertyTypeInteger, 60, 1, 86400),
                                     Property("message", kPropertyTypeString, std::string("Time's up!")),
                                     Property("repeat", kPropertyTypeBoolean, false)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int duration_seconds = properties["duration_seconds"].value<int>();
                           std::string message  = properties["message"].value<std::string>();
                           bool repeat          = properties["repeat"].value<bool>();

                           // Default message
                           if (message.empty()) {
                               message = "Time's up!";
                           }

                           mclog::tagInfo(_tag, "create_reminder: duration={}s, message={}, repeat={}",
                                          duration_seconds, message, repeat);

                           int id = tools::create_reminder(duration_seconds * 1000, message, repeat);

                           return id;
                       });

    mclog::tagInfo(_tag, "add robot.get_reminders tool");
    mcp_server.AddTool("self.robot.get_reminders", "Get list of active reminders.", std::vector<Property>{},
                       [this](const PropertyList& properties) -> ReturnValue {
                           mclog::tagInfo(_tag, "get_reminders");
                           auto reminders          = tools::get_active_reminders();
                           std::string result_json = "[";
                           for (size_t i = 0; i < reminders.size(); ++i) {
                               const auto& r = reminders[i];
                               result_json +=
                                   fmt::format(R"({{"id": {}, "duration_ms": {}, "message": "{}", "repeat": {}}})",
                                               r.id, r.durationMs, r.message, r.repeat ? "true" : "false");
                               if (i < reminders.size() - 1) {
                                   result_json += ", ";
                               }
                           }
                           result_json += "]";
                           mclog::tagInfo(_tag, "get_reminders result: {}", result_json);
                           return result_json;
                       });

    mclog::tagInfo(_tag, "add robot.stop_reminder tool");
    mcp_server.AddTool("self.robot.stop_reminder", "Stop a reminder by ID.",
                       PropertyList({Property("id", kPropertyTypeInteger, -1)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int id = properties["id"].value<int>();
                           mclog::tagInfo(_tag, "stop_reminder: id={}", id);
                           tools::stop_reminder(id);
                           return true;
                       });

    mclog::tagWarn(_tag, "add system.reboot tool");
    mcp_server.AddTool("self.system.reboot",
                       "DANGEROUS: reboot this device to trigger first-boot OTA/upgrade checks. Only use when the user "
                       "explicitly asks to restart/reboot the StackChan system. Requires confirm=true; delay_ms is "
                       "clamped to 500..10000 ms. The reply is sent before the delayed reboot task runs.",
                       PropertyList({Property("confirm", kPropertyTypeBoolean, false),
                                     Property("delay_ms", kPropertyTypeInteger, 1500, 500, 10000),
                                     Property("reason", kPropertyTypeString, std::string("remote_mcp"))}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           bool confirm      = properties["confirm"].value<bool>();
                           int delay_ms      = properties["delay_ms"].value<int>();
                           std::string reason = properties["reason"].value<std::string>();

                           if (!confirm) {
                               mclog::tagWarn(_tag, "system_reboot rejected: confirm_required");
                               return std::string(R"({"accepted":false,"error":"confirm_required"})");
                           }

                           char scheduled_reason[65];
                           copySafeRebootReason(scheduled_reason, sizeof(scheduled_reason), reason);

                           int scheduled_delay_ms = 1500;
                           const std::string escaped_reason = jsonEscape(scheduled_reason);
                           if (!scheduleSystemReboot(delay_ms, scheduled_reason, &scheduled_delay_ms)) {
                               return fmt::format(R"({{"accepted":false,"error":"schedule_failed","delay_ms":{},"reason":"{}"}})",
                                                  scheduled_delay_ms, escaped_reason);
                           }

                           return fmt::format(R"({{"accepted":true,"delay_ms":{},"reason":"{}"}})",
                                              scheduled_delay_ms, escaped_reason);
                       });
}

/* ---------------------------------------------------------------------------
 * Public MCP tool dispatcher for the local HTTP control endpoint.
 * Runs in the httpd task context — acquire LvglLockGuard where needed.
 * Returns true if the tool was found; out_result receives a short status.
 * Returns false if tool_name is unknown.
 * -------------------------------------------------------------------------*/
bool stackchan_mcp_dispatch_tool(const std::string& tool_name, const cJSON* arguments, std::string& out_result)
{
    if (tool_name == "self.robot.get_head_angles") {
        LvglLockGuard lock;
        auto& motion      = GetStackChan().motion();
        int current_yaw   = motion.yawServo().getCurrentAngle() / 10;
        int current_pitch  = motion.pitchServo().getCurrentAngle() / 10;
        out_result = fmt::format(R"({{"yaw": {}, "pitch": {}}})", current_yaw, current_pitch);
        return true;
    }

    if (tool_name == "self.robot.set_head_angles") {
        int yaw = -9999, pitch = -9999, speed = 180;
        auto* v = cJSON_GetObjectItem(arguments, "yaw");
        if (v && cJSON_IsNumber(v)) yaw = v->valueint;
        v = cJSON_GetObjectItem(arguments, "pitch");
        if (v && cJSON_IsNumber(v)) pitch = v->valueint;
        v = cJSON_GetObjectItem(arguments, "speed");
        if (v && cJSON_IsNumber(v)) speed = v->valueint;
        mclog::tagInfo(_tag, "http dispatch set_head_angles: yaw={} pitch={} speed={}", yaw, pitch, speed);
        LvglLockGuard lock;
        submitHeadMotion(yaw != -9999, yaw * 10, pitch != -9999, pitch * 10, speed);
        out_result = "ok";
        return true;
    }

    if (tool_name == "self.robot.set_head_targets") {
        int yaw_target = -9999, pitch_target = -9999, speed = 180;
        auto* v = cJSON_GetObjectItem(arguments, "yaw_target");
        if (v && cJSON_IsNumber(v)) yaw_target = v->valueint;
        v = cJSON_GetObjectItem(arguments, "pitch_target");
        if (v && cJSON_IsNumber(v)) pitch_target = v->valueint;
        v = cJSON_GetObjectItem(arguments, "speed");
        if (v && cJSON_IsNumber(v)) speed = v->valueint;
        mclog::tagInfo(_tag, "http dispatch set_head_targets: yaw_target={} pitch_target={} speed={}", yaw_target, pitch_target, speed);
        LvglLockGuard lock;
        submitHeadMotion(yaw_target != -9999, yaw_target, pitch_target != -9999, pitch_target, speed);
        out_result = "ok";
        return true;
    }

    if (tool_name == "self.robot.set_led_color") {
        int r = 0, g = 0, b = 0;
        auto* v = cJSON_GetObjectItem(arguments, "red");
        if (v && cJSON_IsNumber(v)) r = v->valueint;
        v = cJSON_GetObjectItem(arguments, "green");
        if (v && cJSON_IsNumber(v)) g = v->valueint;
        v = cJSON_GetObjectItem(arguments, "blue");
        if (v && cJSON_IsNumber(v)) b = v->valueint;
        mclog::tagInfo(_tag, "http dispatch set_led_color: r={} g={} b={}", r, g, b);
        LvglLockGuard lock;
        GetStackChan().leftNeonLight().setColor(r, g, b);
        GetStackChan().rightNeonLight().setColor(r, g, b);
        out_result = "ok";
        return true;
    }

    if (tool_name == "self.robot.celebrate") {
        std::string style = "cheer";
        int duration_ms = 4000, intensity = 2;
        bool sound = false;
        auto* v = cJSON_GetObjectItem(arguments, "style");
        if (v && cJSON_IsString(v)) style = v->valuestring;
        v = cJSON_GetObjectItem(arguments, "duration_ms");
        if (v && cJSON_IsNumber(v)) duration_ms = v->valueint;
        v = cJSON_GetObjectItem(arguments, "intensity");
        if (v && cJSON_IsNumber(v)) intensity = v->valueint;
        v = cJSON_GetObjectItem(arguments, "sound");
        if (v && cJSON_IsBool(v)) sound = cJSON_IsTrue(v);
        mclog::tagInfo(_tag, "http dispatch celebrate: style={} duration_ms={} intensity={}", style, duration_ms, intensity);
        std::string error;
        if (!start_celebrate_modifier(style, duration_ms, intensity, sound, &error)) {
            out_result = error.empty() ? "celebrate_failed" : error;
        } else {
            out_result = "ok";
        }
        return true;
    }

    if (tool_name == "self.robot.create_reminder") {
        int duration_seconds = 60;
        std::string message = "Time's up!";
        bool repeat = false;
        auto* v = cJSON_GetObjectItem(arguments, "duration_seconds");
        if (v && cJSON_IsNumber(v)) duration_seconds = v->valueint;
        v = cJSON_GetObjectItem(arguments, "message");
        if (v && cJSON_IsString(v)) message = v->valuestring;
        v = cJSON_GetObjectItem(arguments, "repeat");
        if (v && cJSON_IsBool(v)) repeat = cJSON_IsTrue(v);
        mclog::tagInfo(_tag, "http dispatch create_reminder: duration={}s message={}", duration_seconds, message);
        int id = tools::create_reminder(duration_seconds * 1000, message, repeat);
        out_result = std::to_string(id);
        return true;
    }

    if (tool_name == "self.robot.get_reminders") {
        auto reminders = tools::get_active_reminders();
        std::string result_json = "[";
        for (size_t i = 0; i < reminders.size(); ++i) {
            const auto& r = reminders[i];
            result_json += fmt::format(R"({{"id": {}, "duration_ms": {}, "message": "{}", "repeat": {}}})",
                                       r.id, r.durationMs, r.message, r.repeat ? "true" : "false");
            if (i < reminders.size() - 1) result_json += ", ";
        }
        result_json += "]";
        out_result = result_json;
        return true;
    }

    if (tool_name == "self.robot.stop_reminder") {
        int id = -1;
        auto* v = cJSON_GetObjectItem(arguments, "id");
        if (v && cJSON_IsNumber(v)) id = v->valueint;
        mclog::tagInfo(_tag, "http dispatch stop_reminder: id={}", id);
        tools::stop_reminder(id);
        out_result = "ok";
        return true;
    }

    if (tool_name == "self.system.reboot") {
        bool confirm = false;
        int delay_ms = 1500;
        std::string reason = "remote_mcp";
        auto* v = cJSON_GetObjectItem(arguments, "confirm");
        if (v && cJSON_IsBool(v)) confirm = cJSON_IsTrue(v);
        v = cJSON_GetObjectItem(arguments, "delay_ms");
        if (v && cJSON_IsNumber(v)) delay_ms = v->valueint;
        v = cJSON_GetObjectItem(arguments, "reason");
        if (v && cJSON_IsString(v)) reason = v->valuestring;

        char scheduled_reason[65];
        copySafeRebootReason(scheduled_reason, sizeof(scheduled_reason), reason);
        const int scheduled_delay_ms = clampInt(delay_ms, 500, 10000);

        const std::string escaped_reason = jsonEscape(scheduled_reason);
        if (!confirm) {
            mclog::tagWarn(_tag, "http dispatch system_reboot rejected: confirm_required");
            out_result = fmt::format(R"({{"accepted":false,"error":"confirm_required","delay_ms":{},"reason":"{}"}})",
                                     scheduled_delay_ms, escaped_reason);
            return true;
        }

        int actual_delay_ms = scheduled_delay_ms;
        if (!scheduleSystemReboot(delay_ms, scheduled_reason, &actual_delay_ms)) {
            out_result = fmt::format(R"({{"accepted":false,"error":"schedule_failed","delay_ms":{},"reason":"{}"}})",
                                     actual_delay_ms, escaped_reason);
            return true;
        }

        out_result = fmt::format(R"({{"accepted":true,"delay_ms":{},"reason":"{}"}})",
                                 actual_delay_ms, escaped_reason);
        return true;
    }

    return false;
}
