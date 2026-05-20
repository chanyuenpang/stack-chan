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
#include <apps/common/common.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <new>

using namespace stackchan;

static const std::string_view _tag = "HAL-MCP";

namespace {

std::atomic_bool g_celebrate_active{false};

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
        if ((_has_pending || _active) && motion.hasBusDead()) {
            logState("force_release", now, false, false, active_elapsed_ms, "bus_dead", false);
            motion.stop();
            _active          = false;
            _has_pending     = false;
            _release_at_ms   = 0;
            _active_since_ms = 0;
            requestDestroy();
            return;
        }

        if (_active && _active_since_ms != 0 && now - _active_since_ms >= kHardActiveTimeoutMs) {
            const uint32_t elapsed_ms = now - _active_since_ms;
            const bool moving = motion.isMoving();
            const bool busHealthy = !motion.hasHardwareFailure();
            logState("force_release", now, moving, false, elapsed_ms, "hard_timeout", busHealthy);
            motion.release();
            _active        = false;
            _has_pending   = false;
            _release_at_ms = 0;
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
                  uint32_t elapsedMs, const char* reason = nullptr, bool busHealthy = true) const
    {
        const int targetYaw   = _has_pending ? _pending_yaw : _last_yaw;
        const int targetPitch = _has_pending ? _pending_pitch : _last_pitch;
        const int targetSpeed = _has_pending ? _pending_speed : _pending_speed;
        mclog::tagInfo("SERVO-SCHED",
                       "event={} active={} has_pending={} isMoving={} elapsed_ms={} target_yaw={} target_pitch={} speed={} sync_from_present={} reason={} bus_healthy={}",
                       event, _active ? 1 : 0, _has_pending ? 1 : 0, isMoving ? 1 : 0, elapsedMs,
                       targetYaw, targetPitch, targetSpeed, syncFromPresent ? 1 : 0, reason ? reason : "none",
                       busHealthy ? 1 : 0);
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

enum class CelebrateStyle { Cheer, Sparkle, Nod, Calm };

enum class CelebrateState { Idle, Pending, Running };

struct CelebrateExecutor {
    CelebrateState state = CelebrateState::Idle;
    CelebrateStyle style = CelebrateStyle::Cheer;
    int duration_ms = 4000;
    int intensity = 2;
    bool started = false;
    uint32_t start_ms = 0;
    uint32_t next_frame_ms = 0;
    uint32_t next_led_ms = 0;
    uint32_t step_index = 0;
    uint32_t led_step_index = 0;
};

CelebrateExecutor g_celebrate_executor;
std::mutex g_celebrate_mutex;

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

static CelebrateStyle parseCelebrateStyle(const std::string& style)
{
    if (style == "sparkle") {
        return CelebrateStyle::Sparkle;
    }
    if (style == "nod") {
        return CelebrateStyle::Nod;
    }
    if (style == "calm") {
        return CelebrateStyle::Calm;
    }
    return CelebrateStyle::Cheer;
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

struct CelebrateRgb {
    uint8_t r;
    uint8_t g;
    uint8_t b;
};

static void setCelebrateLightHard(Modifiable& stackchan, CelebrateRgb left, CelebrateRgb right)
{
    // 2.0.22: celebrate LED is a hard flash, not a soft/fading transition.
    // snapColor teleports the animator and writes LEDs immediately, so every
    // on step is max-brightness color and every off step is a true black frame.
    stackchan.leftNeonLight().snapColor(left.r, left.g, left.b);
    stackchan.rightNeonLight().snapColor(right.r, right.g, right.b);
}

static void applyCelebrateStartLight(Modifiable& stackchan, CelebrateStyle style, int intensity)
{
    (void)style;
    (void)intensity;
    setCelebrateLightHard(stackchan, {0, 0, 0}, {0, 0, 0});
    mclog::tagInfo(_tag,
                   "celebrate_led_mode_start mode=hard_flash step_ms=150 pattern=max_color_off_max_color_off brightness=255");
}

static void applyCelebrateLightStep(Modifiable& stackchan, uint32_t step, CelebrateStyle style, int intensity)
{
    (void)style;
    (void)intensity;
    static constexpr CelebrateRgb kOff{0, 0, 0};
    static constexpr CelebrateRgb kHighContrastColors[] = {
        {255, 176, 32},   // gold
        {0, 255, 255},    // cyan
        {255, 0, 255},    // magenta
        {0, 255, 0},      // green
        {0, 64, 255},     // blue
        {255, 255, 255},  // white
    };
    static constexpr uint32_t kColorCount = sizeof(kHighContrastColors) / sizeof(kHighContrastColors[0]);

    const bool is_off_step = (step % 2U) == 1U;
    const uint32_t color_index = (step / 2U) % kColorCount;
    const CelebrateRgb color = is_off_step ? kOff : kHighContrastColors[color_index];

    setCelebrateLightHard(stackchan, color, color);
    if (step < 4 || (step % 8U) == 0U) {
        mclog::tagInfo(_tag,
                       "celebrate_led_mode_step step_index={} is_on={} color_index={} left=({},{},{}) right=({},{},{}) brightness={}",
                       step, is_off_step ? 0 : 1, color_index, color.r, color.g, color.b,
                       color.r, color.g, color.b, is_off_step ? "off" : "max");
    }
}

struct MotionFrame {
    int yaw;
    int pitch;
};

// Internal motion units are tenths of a degree. Keep the requested big V
// celebration shape (left-up -> center -> right-up -> center), while reducing
// the pitch peak from the bus-dead 45° case to a tested-safer 30°.
static constexpr MotionFrame kCelebrateMotionFrames[] = {
    {0, 0},
    {-450, 300},
    {0, 0},
    {450, 300},
    {0, 0},
};
static constexpr uint32_t kCelebrateMotionFrameCount =
    sizeof(kCelebrateMotionFrames) / sizeof(kCelebrateMotionFrames[0]);

static void applyCelebrateMotion(Modifiable& stackchan, uint32_t step)
{
    (void)stackchan;
    static constexpr int kMoveSpeed = 120;

    if (step >= kCelebrateMotionFrameCount) {
        return;
    }

    const MotionFrame& frame = kCelebrateMotionFrames[step];
    mclog::tagInfo("SERVO-REQ",
                   "source=celebrate_frame step={} yaw_mcp_deg={} pitch_mcp_deg={} yaw_internal={} pitch_internal={} speed={}",
                   step, frame.yaw / 10, frame.pitch / 10, frame.yaw, frame.pitch, kMoveSpeed);
    submitHeadMotion(true, frame.yaw, true, frame.pitch, kMoveSpeed);
}

static void finishCelebrateLocked(Modifiable& stackchan, const char* reason)
{
    static constexpr int kReturnSpeed = 120;

    stackchan.leftNeonLight().snapColor(0, 0, 0);
    stackchan.rightNeonLight().snapColor(0, 0, 0);

    // Release the active latch. If the servo bus has reported failures, do not
    // send a final home frame: that residual write caused large force-release
    // deltas in 2.0.16 when the bus had already disappeared.
    if (stackchan.motion().hasHardwareFailure()) {
        mclog::tagWarn("SERVO-REQ", "source=celebrate_finish reason={} action=no_write bus_failed=1",
                       reason ? reason : "done");
        stackchan.motion().stop();
    } else {
        mclog::tagInfo("SERVO-REQ", "source=celebrate_finish reason={} yaw=0 pitch=0 speed={} action=scheduler_queue",
                       reason ? reason : "done", kReturnSpeed);
        submitHeadMotion(true, 0, true, 0, kReturnSpeed);
    }
    g_celebrate_executor = CelebrateExecutor{};
    g_celebrate_active.store(false);
    mclog::tagInfo(_tag, "celebrate_led_mode_finish reason={}", reason ? reason : "done");
    mclog::tagInfo(_tag, "celebrate executor finished: {}", reason ? reason : "done");
}

}  // namespace

bool stackchan_celebrate_active()
{
    return g_celebrate_active.load();
}

bool stackchan_motion_high_refresh_active()
{
    return g_celebrate_active.load() ||
           (g_head_motion_scheduler != nullptr && g_head_motion_scheduler->isHighRefreshActive());
}

bool start_celebrate_modifier(std::string style, int durationMs, int intensity, bool sound, std::string* error)
{
    const int requestedDurationMs = durationMs;
    const int requestedIntensity  = intensity;
    durationMs = clampInt(durationMs, 3000, 5000);
    intensity  = clampInt(intensity, 1, 3);

    {
        std::lock_guard<std::mutex> guard(g_celebrate_mutex);
        g_celebrate_executor.state       = CelebrateState::Pending;
        g_celebrate_executor.style       = parseCelebrateStyle(style);
        g_celebrate_executor.duration_ms = durationMs;
        g_celebrate_executor.intensity   = intensity;
        g_celebrate_executor.started     = false;
        g_celebrate_executor.start_ms    = 0;
        g_celebrate_executor.next_frame_ms = 0;
        g_celebrate_executor.next_led_ms   = 0;
        g_celebrate_executor.step_index    = 0;
        g_celebrate_executor.led_step_index = 0;
        g_celebrate_active.store(true);
    }

    if (error) {
        error->clear();
    }

    mclog::tagInfo(_tag,
                   "celebrate queued: style={} requested_duration_ms={} clamped_duration_ms={} requested_intensity={} clamped_intensity={} sound={} action=led_and_servo",
                   style, requestedDurationMs, durationMs, requestedIntensity, intensity, sound ? 1 : 0);
    mclog::tagInfo("SERVO-REQ",
                   "source=celebrate_start style={} requested_duration_ms={} duration_ms={} requested_intensity={} intensity={} sound={} active=1 action=scheduler_led_servo",
                   style, requestedDurationMs, durationMs, requestedIntensity, intensity, sound ? 1 : 0);
    return true;
}

void stackchan_celebrate_tick(stackchan::Modifiable& stackchan, uint32_t nowMs)
{
    static constexpr uint32_t kInitialMotionAvoidMs = 200;
    static constexpr uint32_t kFrameBeatMs          = 750;
    static constexpr uint32_t kLedBeatMs            = 150;
    static constexpr uint32_t kFallbackGraceMs      = 1500;
    static constexpr uint32_t kHardTimeoutMs        = 10500;
    static constexpr uint32_t kMotionFrameCount     = kCelebrateMotionFrameCount;

    if (!g_celebrate_active.load()) {
        return;
    }

    std::lock_guard<std::mutex> guard(g_celebrate_mutex);

    if (g_celebrate_executor.state == CelebrateState::Idle) {
        // Defensive cleanup: active must never stay latched if state was reset unexpectedly.
        finishCelebrateLocked(stackchan, "idle_fallback");
        return;
    }

    if (g_celebrate_executor.state == CelebrateState::Pending) {
        g_celebrate_executor.state         = CelebrateState::Running;
        g_celebrate_executor.started       = true;
        g_celebrate_executor.start_ms      = nowMs;
        g_celebrate_executor.next_frame_ms = nowMs;
        g_celebrate_executor.next_led_ms   = nowMs;
        g_celebrate_executor.step_index    = 0;
        g_celebrate_executor.led_step_index = 0;

        applyCelebrateStartLight(stackchan, g_celebrate_executor.style, g_celebrate_executor.intensity);
        mclog::tagInfo(_tag, "celebrate executor started: big_v low-torque motion via scheduler, independent_led_mode, fixed_timeline frame_beat_ms={}", kFrameBeatMs);
    }

    const uint32_t elapsedMs = nowMs - g_celebrate_executor.start_ms;
    const uint32_t timeoutMs = std::min<uint32_t>(g_celebrate_executor.duration_ms + kFallbackGraceMs, kHardTimeoutMs);

    if (stackchan.motion().hasBusDead()) {
        finishCelebrateLocked(stackchan, "bus_dead");
        return;
    }

    if (elapsedMs >= timeoutMs) {
        finishCelebrateLocked(stackchan, "timeout");
        return;
    }

    if (nowMs >= g_celebrate_executor.next_led_ms) {
        applyCelebrateLightStep(stackchan, g_celebrate_executor.led_step_index, g_celebrate_executor.style,
                                g_celebrate_executor.intensity);
        ++g_celebrate_executor.led_step_index;
        g_celebrate_executor.next_led_ms = nowMs + kLedBeatMs;
    }

    if (g_celebrate_executor.step_index < kMotionFrameCount && nowMs >= g_celebrate_executor.next_frame_ms) {
        const uint32_t step          = g_celebrate_executor.step_index;
        const bool isMovingSnapshot = stackchan.motion().isMoving();

        // Keep only a tiny initial avoid window. Subsequent big-V celebrate
        // head frames run on a short fixed timeline via HeadMotionScheduler
        // even when Servo::isMoving() still reflects the previous animation.
        if (step == 0 && isMovingSnapshot && elapsedMs < kInitialMotionAvoidMs) {
            g_celebrate_executor.next_frame_ms = g_celebrate_executor.start_ms + kInitialMotionAvoidMs;
        } else {
            mclog::tagInfo(_tag,
                           "celebrate_frame_schedule step={} frame_schedule=fixed_timeline is_moving_snapshot={} is_moving_ignored={} elapsed_ms={} scheduled_ms={}",
                           step, isMovingSnapshot ? 1 : 0, (step > 0 && isMovingSnapshot) ? 1 : 0,
                           elapsedMs, g_celebrate_executor.start_ms + (step * kFrameBeatMs));
            applyCelebrateMotion(stackchan, step);
            ++g_celebrate_executor.step_index;
            g_celebrate_executor.next_frame_ms = g_celebrate_executor.start_ms +
                                                 (g_celebrate_executor.step_index * kFrameBeatMs);
        }
    }

    if (elapsedMs >= static_cast<uint32_t>(g_celebrate_executor.duration_ms)) {
        finishCelebrateLocked(stackchan, "duration_complete");
    }
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
