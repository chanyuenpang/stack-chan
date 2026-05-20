/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include "drivers/FTServo_Arduino/src/SCSCL.h"
#include <stackchan/stackchan.h>
#include <smooth_ui_toolkit.hpp>
#include <mooncake_log.h>
#include <settings.h>
#include <esp_timer.h>
#include <cstring>

using namespace smooth_ui_toolkit;
using namespace stackchan::motion;

static SCSCL _scs_bus;

struct ServoConfig_t {
    int id             = -1;
    int defaultZeroPos = 0;
    Vector2i angleLimit;
    Vector2i rawPosLimit;
    std::string settingNs;
    std::string settingZeroPositionKey;
    bool enablePwmMode = false;
};

class ScsServo : public Servo {
public:
    static inline const std::string _tag = "ScsServo";

    ScsServo(const ServoConfig_t& config) : _config(config)
    {
    }

    void init() override
    {
        set_angle_limit(_config.angleLimit);
        get_zero_pos_from_nvs();
        Servo::init();
    }

    void update() override
    {
        const uint32_t now_ms = GetHAL().millis();
        service_transient_probe(now_ms, "update_tick");
        if (_bus_dead) {
            probe_bus_recovery(now_ms, "update_tick");
        }
        Servo::update();
    }

    void get_zero_pos_from_nvs()
    {
        _zero_pos     = _config.defaultZeroPos;
        bool is_valid = false;

        {
            Settings settings(_config.settingNs, false);
            int nvs_zero_pos = settings.GetInt(_config.settingZeroPositionKey, -1);

            // Limit check
            if (nvs_zero_pos >= _config.rawPosLimit.x && nvs_zero_pos <= _config.rawPosLimit.y) {
                _zero_pos = nvs_zero_pos;
                is_valid  = true;
                mclog::tagInfo(_tag, "id: {} get zero pos: {} from settings", _config.id, _zero_pos);
            } else {
                is_valid = false;
                mclog::tagWarn(_tag, "id: {} get invalid zero pos: {} from settings", _config.id, nvs_zero_pos);
            }
        }

        if (!is_valid) {
            _zero_pos = _config.defaultZeroPos;
            mclog::tagInfo(_tag, "id: {} override zero pos to default: {}", _config.id, _zero_pos);

            Settings settings(_config.settingNs, true);
            settings.SetInt(_config.settingZeroPositionKey, _zero_pos);
        }
    }

    void set_angle_impl(int angle) override
    {
        const uint32_t now_ms = GetHAL().millis();
        if (_set_angle_in_progress) {
            log_write_skip_suppressed(now_ms, "reentrant");
            return;
        }

        struct SetAngleGuard {
            bool& flag;
            explicit SetAngleGuard(bool& flag) : flag(flag) { flag = true; }
            ~SetAngleGuard() { flag = false; }
        } guard(_set_angle_in_progress);

        if (_bus_dead) {
            // 2.0.17 bus_dead is only a safety net: the main experiment is to
            // prevent the bus wedge by reducing FEETECH/SCS UART transactions.
            probe_bus_recovery(now_ms, "write_skip");
            return;
        }
        service_transient_probe(now_ms, "write_skip");
        if (is_transient_cooldown_active(now_ms)) {
            log_transient_write_skip(now_ms, "transient_cooldown");
            return;
        }

        const int requested_angle = angle;
        const int command_angle   = kSingleWriteFinalTargetMode ? static_cast<int>(_angle_anim.end) : requested_angle;
        int mapped_angle          = _zero_pos + command_angle * 16 / 5 / 10;  // 一步对应 0.3125度, 0.3125 = 5/16
        mapped_angle              = uitk::clamp(mapped_angle, _config.rawPosLimit.x, _config.rawPosLimit.y);
        const int write_angle     = raw_to_internal(mapped_angle);

        if (_has_last_written && mapped_angle == _last_written_raw) {
            // 2.0.19: same-target skips are the hot/rest path after a final-target write.
            // Keep it silent and side-effect-free except for a tiny throttled breadcrumb;
            // never enter the heavy SERVO-DIAG formatter from this path.
            log_write_skip_suppressed(now_ms, "same_target");
            return;
        }

        const int present_raw     = kReadBeforeWriteDuringMotion ? _scs_bus.ReadPos(_config.id) : -1;
        const bool present_valid  = kReadBeforeWriteDuringMotion && is_valid_raw(present_raw);
        if (kReadBeforeWriteDuringMotion) {
            if (present_valid) {
                record_bus_success();
            } else {
                record_bus_failure("read_pos_in_write", present_raw, now_ms);
                if (_bus_dead) {
                    return;
                }
            }
        }
        const int present_angle   = present_valid ? remember_present_angle(present_raw) : fallback_angle();
        const char* fallback_src  = present_valid ? "present" : fallback_angle_source();
        const int last_raw        = _has_last_written ? _last_written_raw : -1;
        const int last_angle      = _has_last_written ? _last_written_angle : 0;
        const uint32_t dt_ms      = _has_last_written ? (now_ms - _last_written_ms) : 0;
        const int delta_angle     = _has_last_written ? (write_angle - _last_written_angle) : 0;
        const int delta_raw       = _has_last_written ? (mapped_angle - _last_written_raw) : 0;
        const float deg_per_sec   = dt_ms > 0 ? (static_cast<float>(delta_angle) / 10.0f) * 1000.0f / dt_ms : 0.0f;
        const char* sync_state    = _auto_angle_sync_enabled ? "on" : "off";
        const char* present_state = present_valid ? "ok" : "disabled";
        const int source_speed    = _last_motion_speed;
        const int clamped_speed   = clamp_write_time_speed(source_speed);
        const uint16_t write_time = speed_to_write_time(source_speed);

        if (_has_last_written && now_ms - _last_written_ms < kWriteIntervalMs) {
            log_write_skip(now_ms, "interval", requested_angle, command_angle, mapped_angle, present_state,
                           present_raw, present_angle, fallback_src, last_raw, last_angle, delta_angle, delta_raw,
                           dt_ms, deg_per_sec, sync_state);
            return;
        }

        if (_has_last_attempted && mapped_angle == _last_attempted_raw &&
            now_ms - _last_attempted_ms < kWriteAttemptCooldownMs) {
            log_write_backoff(now_ms, requested_angle, command_angle, mapped_angle, present_state, present_raw,
                              present_angle, fallback_src, last_raw, last_angle, delta_angle, delta_raw, dt_ms,
                              deg_per_sec, sync_state);
            return;
        }

        if (!try_acquire_axis_write_slot(now_ms, requested_angle, command_angle, mapped_angle, present_state,
                                         present_raw, present_angle, fallback_src, last_raw, last_angle,
                                         delta_angle, delta_raw, dt_ms, deg_per_sec, sync_state)) {
            return;
        }

        check_mode(Mode::Position);
        record_write_attempt(mapped_angle, write_angle, now_ms);
        const int64_t write_start_us = esp_timer_get_time();
        const int write_rc           = _scs_bus.WritePos(_config.id, mapped_angle, write_time, kWriteSpeed);
        record_axis_write_slot(now_ms);
        const int64_t write_cost_us  = esp_timer_get_time() - write_start_us;
        const bool write_ok          = write_rc > 0;
        const int write_err          = _scs_bus.getLastError();
        if (write_ok) {
            record_bus_success();
        } else {
            handle_write_pos_failure(write_rc, write_err, mapped_angle, write_angle, now_ms);
        }

        ++_diag_seq;
        mclog::tagInfo("SERVO-DIAG",
                       "source=hw_write axis_id={} seq={} t_ms={} write_mode={} read_before_write={} read_move_enabled={} write_interval_ms={} write_attempt_cooldown_ms={} present={} present_raw={} present_ang={} fallback={} last_raw={} last_ang={} anim_req_ang={} command_ang={} write_ang={} write_raw={} delta_ang={} delta_raw={} dt_ms={} deg_s={:.1f} autoSync={} source_speed={} clamped_speed={} computed_write_time={} write_time={} base_write_time={} write_speed={} torque_enable_rc={} rc={} err={} cost_us={}",
                       _config.id, _diag_seq, now_ms, write_mode(), kReadBeforeWriteDuringMotion ? 1 : 0,
                       kReadMoveEnabled ? 1 : 0, kWriteIntervalMs, kWriteAttemptCooldownMs, present_state,
                       present_raw, present_angle, fallback_src, last_raw, last_angle, requested_angle,
                       command_angle, write_angle, mapped_angle, delta_angle, delta_raw, dt_ms, deg_per_sec,
                       sync_state, source_speed, clamped_speed, write_time, write_time, kDefaultWriteTime,
                       kWriteSpeed, _last_torque_enable_rc, write_rc, write_err,
                       static_cast<long long>(write_cost_us));

        if (write_ok) {
            _last_written_raw   = mapped_angle;
            _last_written_angle = write_angle;
            _last_written_ms    = now_ms;
            _has_last_written   = true;
        }
    }

    int getCurrentAngle() override
    {
        const uint32_t now_ms = GetHAL().millis();
        if (_bus_dead) {
            probe_bus_recovery(now_ms, "read_pos_skip");
            return uitk::clamp(static_cast<int>(_angle_anim.directValue()), getAngleLimit().x, getAngleLimit().y);
        }
        service_transient_probe(now_ms, "read_pos_skip");
        if (is_transient_cooldown_active(now_ms)) {
            return fallback_angle();
        }

        const int current_pos = _scs_bus.ReadPos(_config.id);
        if (is_valid_raw(current_pos)) {
            _read_pos_fail_count = 0;
            record_bus_success();
            return remember_present_angle(current_pos);
        }

        ++_read_pos_fail_count;
        record_bus_failure("read_pos", current_pos, now_ms);
        const int angle = fallback_angle();
        if (_read_pos_fail_count == 1 || now_ms - _last_read_pos_fail_diag_ms >= kReadPosFailLogIntervalMs) {
            mclog::tagWarn("SERVO-DIAG",
                           "source=read_pos_fail axis_id={} raw={} fallback={} angle={} fail_count={}",
                           _config.id, current_pos, fallback_angle_source(), angle, _read_pos_fail_count);
            _last_read_pos_fail_diag_ms = now_ms;
        }
        return angle;
    }

    bool is_moving_impl() override
    {
        const uint32_t now_ms = GetHAL().millis();
        if (_bus_dead) {
            probe_bus_recovery(now_ms, "read_move_skip");
            return false;
        }

        const bool anim_done = _angle_anim.done();

        if (!kReadMoveEnabled) {
            if (!_has_last_move_diag || now_ms - _last_move_diag_ms >= kReadMoveFailLogIntervalMs) {
                mclog::tagInfo("SERVO-MOVE",
                               "axis_id={} read_move=disabled anim_done={} moving_result=0 mode=prevent_disconnect",
                               _config.id, anim_done ? 1 : 0);
                _last_move_diag_ms  = now_ms;
                _has_last_move_diag = true;
            }
            return false;
        }

        if (_read_move_fail_count >= kReadMoveFailFallbackThreshold &&
            now_ms < _read_move_fallback_until_ms) {
            if (now_ms - _last_move_diag_ms >= kReadMoveFailLogIntervalMs) {
                mclog::tagWarn("SERVO-MOVE",
                               "axis_id={} read_move=fallback anim_done={} moving_result=0 fail_count={} cooldown_left_ms={}",
                               _config.id, anim_done ? 1 : 0, _read_move_fail_count,
                               _read_move_fallback_until_ms - now_ms);
                _last_move_diag_ms  = now_ms;
                _has_last_move_diag = true;
            }
            return false;
        }

        const int moving = _scs_bus.ReadMove(_config.id);

        bool moving_result = false;
        if (moving < 0) {
            record_bus_failure("read_move", moving, now_ms);
            if (_read_move_fail_count < kReadMoveFailFallbackThreshold) {
                ++_read_move_fail_count;
            }
            // A failed ReadMove must not keep the release path latched forever.
            // After a small number of consecutive failures, enter a cooldown
            // fallback window so release checks do not hammer a wedged bus.
            moving_result = false;
            if (_read_move_fail_count >= kReadMoveFailFallbackThreshold) {
                _read_move_fallback_until_ms = now_ms + kReadMoveFailFallbackCooldownMs;
            }
        } else {
            record_bus_success();
            _read_move_fail_count          = 0;
            _read_move_fallback_until_ms   = 0;
            moving_result                  = moving != 0;
        }

        const bool changed = !_has_last_move_diag || moving != _last_read_move ||
                             moving_result != _last_moving_result;
        const bool throttled_fail_log = moving < 0 && now_ms - _last_move_diag_ms >= kReadMoveFailLogIntervalMs;
        const bool should_log = changed || throttled_fail_log;
        if (should_log) {
            mclog::tagInfo("SERVO-MOVE",
                           "axis_id={} read_move={} anim_done={} moving_result={} fail_count={}",
                           _config.id, moving, anim_done ? 1 : 0, moving_result ? 1 : 0,
                           _read_move_fail_count);
            _last_read_move      = moving;
            _last_moving_result  = moving_result;
            _last_move_diag_ms   = now_ms;
            _has_last_move_diag  = true;
        }

        return moving_result;
    }

    void setTorqueEnabled(bool enabled) override
    {
        Servo::setTorqueEnabled(enabled);
        const uint32_t now_ms = GetHAL().millis();
        const char* transient_probe_reason = enabled ? "torque_enable_skip" : "torque_release_skip";
        if (_bus_dead) {
            probe_bus_recovery(now_ms, transient_probe_reason);
            return;
        }
        service_transient_probe(now_ms, transient_probe_reason);
        if (is_transient_cooldown_active(now_ms)) {
            log_transient_write_skip(now_ms, "torque_transient_cooldown");
            return;
        }
        if (_torque_enabled_shadow == enabled && _last_torque_enable_rc > 0) {
            return;
        }
        const int rc = _scs_bus.EnableTorque(_config.id, enabled ? 1 : 0);
        _last_torque_enable_rc = rc;
        if (rc > 0) {
            _torque_enabled_shadow = enabled;
            record_bus_success();
        } else {
            record_bus_failure("torque_enable", rc, now_ms);
        }
        mclog::tagInfo("SERVO-DIAG", "axis_id={} torque_enable={} torque_enable_rc={} shadow={}",
                       _config.id, enabled ? 1 : 0, rc, _torque_enabled_shadow ? 1 : 0);
    }

    bool getTorqueEnabled() override
    {
        // Avoid an extra UART read in the post-motion auto-release path. 2.0.18
        // relies on the last EnableTorque ACK instead of polling torque state.
        return _torque_enabled_shadow;
    }

    void setCurrentAngleAsZero() override
    {
        _zero_pos = _scs_bus.ReadPos(_config.id);

        Settings settings(_config.settingNs, true);
        settings.SetInt(_config.settingZeroPositionKey, _zero_pos);

        mclog::tagInfo(_tag, "id: {} set zero pos: {} to settings", _config.id, _zero_pos);
    }

    void resetZeroCalibration() override
    {
        _zero_pos = _config.defaultZeroPos;

        Settings settings(_config.settingNs, true);
        settings.SetInt(_config.settingZeroPositionKey, _zero_pos);

        mclog::tagInfo(_tag, "id: {} set zero pos: {} to settings", _config.id, _zero_pos);
    }

    void rotate(int velocity) override
    {
        velocity = uitk::clamp(velocity, -1000, 1000);

        const uint32_t now_ms = GetHAL().millis();
        if (_bus_dead) {
            probe_bus_recovery(now_ms, "pwm_skip");
            return;
        }
        service_transient_probe(now_ms, "pwm_skip");
        if (is_transient_cooldown_active(now_ms)) {
            log_transient_write_skip(now_ms, "pwm_transient_cooldown");
            return;
        }

        if (!_config.enablePwmMode) {
            return;
        }

        int mapped_velocity = map_range(velocity, 0, 1000, 0, 1023);

        check_mode(Mode::PWM);
        _scs_bus.WritePWM(_config.id, mapped_velocity);
    }

    bool isBusDead() const override
    {
        return _bus_dead;
    }

    bool hasTransientIoError() const override
    {
        return _consecutive_bus_failures > 0 || _read_pos_fail_count > 0 || _read_move_fail_count > 0 ||
               _write_ack_missing_count > 0 || _transient_probe_pending ||
               GetHAL().millis() < _transient_hold_until_ms;
    }

    bool hasHardwareFailure() const override
    {
        return isBusDead() || hasTransientIoError();
    }

    bool serviceBusRecoveryProbe(uint32_t nowMs, const char* reason) override
    {
        service_transient_probe(nowMs, reason ? reason : "external");
        if (_bus_dead) {
            probe_bus_recovery(nowMs, reason ? reason : "external");
        }
        return !_bus_dead;
    }

    void enterTransientPassiveCooldown(uint32_t durationMs, const char* reason) override
    {
        const uint32_t now_ms = GetHAL().millis();
        const uint32_t until_ms = now_ms + durationMs;
        if (until_ms - _transient_passive_until_ms < 0x80000000UL) {
            _transient_passive_until_ms = until_ms;
        }
        _transient_passive_reason = reason ? reason : "unspecified";
        mclog::tagWarn(
            "SERVO-BUS",
            "axis_id={} event=transient_passive_cooldown reason={} passive_until={} duration_ms={} no_powercycle=1 transient_probe_pending={} hold_until={} probe_fail_count={}",
            _config.id, _transient_passive_reason, _transient_passive_until_ms, durationMs,
            _transient_probe_pending ? 1 : 0, _transient_hold_until_ms, _transient_probe_fail_count);
    }

private:
    enum class Mode { Position = 0, PWM = 1 };

    ServoConfig_t _config;
    int _zero_pos      = 0;
    Mode _current_mode = Mode::Position;

    bool _has_last_written    = false;
    int _last_written_raw     = 0;
    int _last_written_angle   = 0;
    uint32_t _last_written_ms = 0;
    bool _has_last_attempted  = false;
    int _last_attempted_raw   = 0;
    int _last_attempted_angle = 0;
    uint32_t _last_attempted_ms = 0;
    uint32_t _diag_seq        = 0;
    uint32_t _last_write_skip_diag_ms = 0;
    uint32_t _last_write_backoff_diag_ms = 0;
    uint32_t _last_write_skip_suppressed_ms = 0;
    uint32_t _last_axis_stagger_diag_ms = 0;
    const char* _last_write_skip_suppressed_reason = nullptr;
    bool _set_angle_in_progress = false;

    int _last_torque_enable_rc = 0;
    bool _torque_enabled_shadow = false;

    bool _has_last_present     = false;
    int _last_present_raw      = 0;
    int _last_present_angle    = 0;
    uint32_t _read_pos_fail_count = 0;
    uint32_t _last_read_pos_fail_diag_ms = 0;

    static constexpr bool kReadBeforeWriteDuringMotion        = false;
    static constexpr bool kReadMoveEnabled                    = false;
    static constexpr bool kSingleWriteFinalTargetMode         = true;
    static constexpr uint32_t kWriteIntervalMs                = 200;
    static constexpr uint32_t kWriteAttemptCooldownMs         = 200;
    static constexpr uint16_t kDefaultWriteTime               = 250;
    static constexpr uint16_t kWriteSpeed                     = 0;  // Library keeps speed=0 semantics; time controls duration.
    static constexpr uint32_t kWriteSkipLogIntervalMs         = 1000;
    static constexpr uint32_t kWriteSkipSuppressedLogIntervalMs = 2000;
    static constexpr uint32_t kAxisWriteStaggerWindowMs       = 100;
    static constexpr uint32_t kAxisStaggerLogIntervalMs       = 250;
    static constexpr uint32_t kReadPosFailLogIntervalMs       = 1000;
    static constexpr uint32_t kReadMoveFailLogIntervalMs      = 1000;
    static constexpr uint32_t kReadMoveFailFallbackThreshold  = 3;
    static constexpr uint32_t kReadMoveFailFallbackCooldownMs = 2000;
    static constexpr uint32_t kTransientQuietMs             = 100;
    static constexpr uint32_t kTransientProbeDelayMs         = 250;
    static constexpr uint32_t kTransientProbeSlotMs          = 200;
    static constexpr uint32_t kTransientHoldMs               = 600;
    static constexpr uint32_t kTransientFailHoldMs           = 750;
    static constexpr uint32_t kTransientTimeoutMs            = 2500;
    static constexpr uint32_t kTransientMaxProbeFailures     = 5;
    static constexpr uint32_t kTransientDeferLogIntervalMs   = 500;
    bool _has_last_move_diag                                = false;
    int _last_read_move                                     = 0;
    bool _last_moving_result                                = false;
    uint32_t _last_move_diag_ms                             = 0;
    uint32_t _read_move_fail_count                          = 0;
    uint32_t _read_move_fallback_until_ms                   = 0;

    static inline int _axis_write_slot_owner                = -1;
    static inline uint32_t _axis_write_slot_ms              = 0;
    static inline int _verify_probe_slot_owner              = -1;
    static inline uint32_t _verify_probe_slot_ms            = 0;

    enum class RecoveryStage { Flush = 0, Quiet = 1, Ping = 2, ReadPos = 3, UartReinit = 4, PowerCycle = 5, PowerRestore = 6 };

    static constexpr uint32_t kBusDeadFailureThreshold      = 3;
    static constexpr uint32_t kBusDeadProbeIntervalMs       = 750;
    static constexpr uint32_t kBusRecoveryQuietMs           = 80;
    static constexpr uint32_t kBusRecoveryReadAfterPingMs   = 30;
    static constexpr uint32_t kBusRecoveryPowerOffMs        = 120;
    static constexpr uint32_t kBusRecoveryPowerRestoreMs    = 300;
    bool _bus_dead                                          = false;
    uint32_t _consecutive_bus_failures                      = 0;
    uint32_t _write_ack_missing_count                       = 0;
    bool _transient_probe_pending                           = false;
    uint32_t _transient_quiet_until_ms                      = 0;
    uint32_t _transient_probe_due_ms                        = 0;
    uint32_t _transient_hold_until_ms                       = 0;
    uint32_t _transient_first_ms                            = 0;
    uint32_t _transient_probe_fail_count                    = 0;
    uint32_t _transient_passive_until_ms                    = 0;
    const char* _transient_passive_reason                   = "none";
    uint32_t _last_transient_defer_log_ms                   = 0;
    uint32_t _last_transient_write_skip_log_ms              = 0;
    uint32_t _last_bus_dead_diag_ms                         = 0;
    uint32_t _next_bus_recovery_probe_ms                    = 0;
    RecoveryStage _recovery_stage                           = RecoveryStage::Flush;
    uint8_t _recovery_escalation                            = 0;

    bool is_valid_raw(int raw) const
    {
        return raw >= _config.rawPosLimit.x && raw <= _config.rawPosLimit.y;
    }

    int raw_to_internal(int raw) const
    {
        int angle = (raw - _zero_pos) * 5 * 10 / 16;
        return uitk::clamp(angle, getAngleLimit().x, getAngleLimit().y);
    }

    int remember_present_angle(int raw)
    {
        _last_present_raw   = raw;
        _last_present_angle = raw_to_internal(raw);
        _has_last_present   = true;
        return _last_present_angle;
    }

    int fallback_angle()
    {
        if (_has_last_present) {
            return _last_present_angle;
        }
        if (_has_last_written) {
            return _last_written_angle;
        }
        return uitk::clamp(static_cast<int>(_angle_anim.directValue()), getAngleLimit().x, getAngleLimit().y);
    }

    const char* fallback_angle_source() const
    {
        if (_has_last_present) {
            return "last_present";
        }
        if (_has_last_written) {
            return "last_written";
        }
        return "animation";
    }

    const char* write_mode() const
    {
        return kSingleWriteFinalTargetMode ? "single_final_target" : "limited";
    }

    static int clamp_write_time_speed(int speed)
    {
        // Match the MCP-facing contract: effective speed is limited to 100..180.
        return uitk::clamp(speed, 100, 180);
    }

    static uint16_t speed_to_write_time(int source_speed)
    {
        // 180 is the current fast/base feel; 100 is 3x slower. Keep
        // single-final-target writes and only vary FEETECH WritePos time.
        static constexpr uint16_t kBaseWriteTimeMs = kDefaultWriteTime;
        const int clamped_speed = clamp_write_time_speed(source_speed);
        const int ratio_num = 180 - clamped_speed;  // 0..80
        // write_time = base * (1 + 2 * ratio_num / 80), rounded to nearest ms.
        return static_cast<uint16_t>((static_cast<int>(kBaseWriteTimeMs) * (80 + 2 * ratio_num) + 40) / 80);
    }

    bool try_acquire_axis_write_slot(uint32_t now_ms, int requested_angle, int command_angle, int mapped_angle,
                                     const char* present_state, int present_raw, int present_angle,
                                     const char* fallback_src, int last_raw, int last_angle, int delta_angle,
                                     int delta_raw, uint32_t dt_ms, float deg_per_sec, const char* sync_state)
    {
        if (_axis_write_slot_owner < 0 || _axis_write_slot_owner == _config.id) {
            return true;
        }

        const uint32_t elapsed_ms = now_ms - _axis_write_slot_ms;
        if (elapsed_ms >= kAxisWriteStaggerWindowMs) {
            return true;
        }

        const uint32_t cooldown_left_ms = kAxisWriteStaggerWindowMs - elapsed_ms;
        if (_last_axis_stagger_diag_ms == 0 || now_ms - _last_axis_stagger_diag_ms >= kAxisStaggerLogIntervalMs) {
            _last_axis_stagger_diag_ms = now_ms;
            const int source_speed      = _last_motion_speed;
            const int clamped_speed     = clamp_write_time_speed(source_speed);
            const uint16_t write_time   = speed_to_write_time(source_speed);
            ++_diag_seq;
            mclog::tagInfo(
                "SERVO-DIAG",
                "source=hw_write_skip event=axis_stagger_wait axis_id={} seq={} t_ms={} reason=axis_write_slot_busy action=no_write slot_owner={} slot_age_ms={} cooldown_left_ms={} stagger_window_ms={} write_mode={} read_before_write={} read_move_enabled={} write_interval_ms={} write_attempt_cooldown_ms={} present={} present_raw={} present_ang={} fallback={} last_raw={} last_ang={} anim_req_ang={} command_ang={} write_raw={} delta_ang={} delta_raw={} dt_ms={} deg_s={:.1f} autoSync={} source_speed={} clamped_speed={} computed_write_time={} write_time={} base_write_time={} write_speed={} torque_enable_rc={}",
                _config.id, _diag_seq, now_ms, _axis_write_slot_owner, elapsed_ms, cooldown_left_ms,
                kAxisWriteStaggerWindowMs, write_mode(), kReadBeforeWriteDuringMotion ? 1 : 0,
                kReadMoveEnabled ? 1 : 0, kWriteIntervalMs, kWriteAttemptCooldownMs, present_state, present_raw,
                present_angle, fallback_src, last_raw, last_angle, requested_angle, command_angle, mapped_angle,
                delta_angle, delta_raw, dt_ms, deg_per_sec, sync_state, source_speed, clamped_speed, write_time,
                write_time, kDefaultWriteTime, kWriteSpeed, _last_torque_enable_rc);
        }

        return false;
    }

    void record_axis_write_slot(uint32_t now_ms)
    {
        _axis_write_slot_owner = _config.id;
        _axis_write_slot_ms    = now_ms;
    }

    void log_write_skip(uint32_t now_ms, const char* reason, int requested_angle, int command_angle,
                        int mapped_angle, const char* present_state, int present_raw, int present_angle,
                        const char* fallback_src, int last_raw, int last_angle, int delta_angle, int delta_raw,
                        uint32_t dt_ms, float deg_per_sec, const char* sync_state)
    {
        if (now_ms - _last_write_skip_diag_ms < kWriteSkipLogIntervalMs) {
            return;
        }
        _last_write_skip_diag_ms = now_ms;
        const int source_speed    = _last_motion_speed;
        const int clamped_speed   = clamp_write_time_speed(source_speed);
        const uint16_t write_time = speed_to_write_time(source_speed);
        ++_diag_seq;
        mclog::tagInfo("SERVO-DIAG",
                       "source=hw_write_skip axis_id={} seq={} t_ms={} reason={} write_mode={} read_before_write={} read_move_enabled={} write_interval_ms={} present={} present_raw={} present_ang={} fallback={} last_raw={} last_ang={} anim_req_ang={} command_ang={} write_raw={} delta_ang={} delta_raw={} dt_ms={} deg_s={:.1f} autoSync={} source_speed={} clamped_speed={} computed_write_time={} write_time={} base_write_time={} write_speed={} torque_enable_rc={}",
                       _config.id, _diag_seq, now_ms, reason, write_mode(), kReadBeforeWriteDuringMotion ? 1 : 0,
                       kReadMoveEnabled ? 1 : 0, kWriteIntervalMs, present_state, present_raw, present_angle,
                       fallback_src, last_raw, last_angle, requested_angle, command_angle, mapped_angle, delta_angle,
                       delta_raw, dt_ms, deg_per_sec, sync_state, source_speed, clamped_speed, write_time, write_time,
                       kDefaultWriteTime, kWriteSpeed, _last_torque_enable_rc);
    }

    void log_write_skip_suppressed(uint32_t now_ms, const char* reason)
    {
        const bool reason_changed = _last_write_skip_suppressed_reason != reason;
        if (!reason_changed && now_ms - _last_write_skip_suppressed_ms < kWriteSkipSuppressedLogIntervalMs) {
            return;
        }

        _last_write_skip_suppressed_reason = reason;
        _last_write_skip_suppressed_ms     = now_ms;
        const int source_speed    = _last_motion_speed;
        const int clamped_speed   = clamp_write_time_speed(source_speed);
        const uint16_t write_time = speed_to_write_time(source_speed);
        ++_diag_seq;
        mclog::tagInfo("SERVO-DIAG",
                       "source=hw_write_skip_suppressed axis_id={} seq={} t_ms={} reason={} write_mode={} source_speed={} clamped_speed={} computed_write_time={} write_time={} base_write_time={} torque_enable_rc={}",
                       _config.id, _diag_seq, now_ms, reason, write_mode(), source_speed, clamped_speed,
                       write_time, write_time, kDefaultWriteTime, _last_torque_enable_rc);
    }

    void log_write_backoff(uint32_t now_ms, int requested_angle, int command_angle, int mapped_angle,
                           const char* present_state, int present_raw, int present_angle, const char* fallback_src,
                           int last_raw, int last_angle, int delta_angle, int delta_raw, uint32_t dt_ms,
                           float deg_per_sec, const char* sync_state)
    {
        if (now_ms - _last_write_backoff_diag_ms < kWriteSkipLogIntervalMs) {
            return;
        }

        _last_write_backoff_diag_ms = now_ms;
        const int source_speed    = _last_motion_speed;
        const int clamped_speed   = clamp_write_time_speed(source_speed);
        const uint16_t write_time = speed_to_write_time(source_speed);
        ++_diag_seq;
        mclog::tagWarn("SERVO-DIAG",
                       "source=hw_write_skip axis_id={} seq={} t_ms={} reason=write_backoff action=write_backoff write_mode={} write_interval_ms={} write_attempt_cooldown_ms={} cooldown_left_ms={} present={} present_raw={} present_ang={} fallback={} last_raw={} last_ang={} last_attempt_raw={} last_attempt_ang={} anim_req_ang={} command_ang={} write_raw={} delta_ang={} delta_raw={} dt_ms={} deg_s={:.1f} autoSync={} source_speed={} clamped_speed={} computed_write_time={} write_time={} base_write_time={} write_speed={} torque_enable_rc={} ack_missing_count={}",
                       _config.id, _diag_seq, now_ms, write_mode(), kWriteIntervalMs, kWriteAttemptCooldownMs,
                       kWriteAttemptCooldownMs - (now_ms - _last_attempted_ms), present_state, present_raw,
                       present_angle, fallback_src, last_raw, last_angle, _last_attempted_raw, _last_attempted_angle,
                       requested_angle, command_angle, mapped_angle, delta_angle, delta_raw, dt_ms, deg_per_sec,
                       sync_state, source_speed, clamped_speed, write_time, write_time, kDefaultWriteTime,
                       kWriteSpeed, _last_torque_enable_rc, _write_ack_missing_count);
    }

    void record_write_attempt(int raw, int angle, uint32_t now_ms)
    {
        _last_attempted_raw   = raw;
        _last_attempted_angle = angle;
        _last_attempted_ms    = now_ms;
        _has_last_attempted   = true;
    }

    void handle_write_pos_failure(int rc, int err, int attempted_raw, int attempted_angle, uint32_t now_ms)
    {
        if (err == static_cast<int>(ERR_NO_REPLY)) {
            enter_ack_missing_cooldown(rc, err, attempted_raw, attempted_angle, now_ms);
            return;
        }

        record_bus_failure("write_pos", rc, now_ms);
    }

    bool is_transient_cooldown_active(uint32_t now_ms) const
    {
        return _transient_probe_pending || now_ms < _transient_hold_until_ms;
    }

    bool is_transient_passive_cooldown_active(uint32_t now_ms) const
    {
        return now_ms < _transient_passive_until_ms;
    }

    bool reason_is_active_io_demand(const char* reason)
    {
        if (reason == nullptr) {
            return false;
        }
        return std::strcmp(reason, "write_skip") == 0 ||
               std::strcmp(reason, "torque_enable_skip") == 0 ||
               std::strcmp(reason, "pwm_skip") == 0;
    }

    bool has_active_motion_io_demand(const char* reason)
    {
        return !_angle_anim.done() || reason_is_active_io_demand(reason);
    }

    void enter_ack_missing_cooldown(int rc, int err, int attempted_raw, int attempted_angle, uint32_t now_ms)
    {
        ++_write_ack_missing_count;
        if (!_transient_probe_pending && now_ms >= _transient_hold_until_ms) {
            _transient_first_ms = now_ms;
            _transient_probe_fail_count = 0;
        } else if (_transient_first_ms == 0) {
            _transient_first_ms = now_ms;
        }

        _scs_bus.waitTxDone();
        _scs_bus.flushInput();
        _transient_probe_pending = true;
        _transient_quiet_until_ms = now_ms + kTransientQuietMs;
        _transient_probe_due_ms = now_ms + kTransientProbeDelayMs;
        _transient_hold_until_ms = now_ms + kTransientHoldMs;

        mclog::tagWarn(
            "SERVO-BUS",
            "axis_id={} event=write_ack_missing action=ack_missing_cooldown op=write_pos rc={} err={} attempted_raw={} attempted_ang={} ack_missing_count={} transient_probe_pending=1 quiet_until={} probe_due={} hold_until={} probe_fail_count={} cooldown_ms={}",
            _config.id, rc, err, attempted_raw, attempted_angle, _write_ack_missing_count,
            _transient_quiet_until_ms, _transient_probe_due_ms, _transient_hold_until_ms,
            _transient_probe_fail_count, kTransientHoldMs);
    }

    void service_transient_probe(uint32_t now_ms, const char* reason)
    {
        if (!_transient_probe_pending || _bus_dead) {
            return;
        }

        if (now_ms < _transient_quiet_until_ms || now_ms < _transient_probe_due_ms) {
            log_transient_probe_deferred(now_ms, reason, "quiet_or_not_due");
            return;
        }

        const uint32_t slot_age_ms = now_ms - _verify_probe_slot_ms;
        if (_verify_probe_slot_owner >= 0 && _verify_probe_slot_owner != _config.id &&
            slot_age_ms < kTransientProbeSlotMs) {
            log_transient_probe_deferred(now_ms, reason, "verify_slot_busy");
            return;
        }

        _verify_probe_slot_owner = _config.id;
        _verify_probe_slot_ms = now_ms;

        const bool passive_cooldown = is_transient_passive_cooldown_active(now_ms);
        const bool active_io_demand = has_active_motion_io_demand(reason);
        const int ping_rc = _scs_bus.Ping(_config.id);
        if (ping_rc == _config.id) {
            _consecutive_bus_failures = 0;
            _write_ack_missing_count = 0;
            _transient_probe_pending = false;
            _transient_quiet_until_ms = 0;
            _transient_probe_due_ms = 0;
            _transient_hold_until_ms = 0;
            _transient_first_ms = 0;
            _transient_probe_fail_count = 0;
            _transient_passive_until_ms = 0;
            _transient_passive_reason = "cleared";
            mclog::tagInfo(
                "SERVO-BUS",
                "axis_id={} event=transient_probe_ok reason={} op=ping rc={} result=bus_alive quiet_until={} probe_due={} hold_until={} probe_fail_count={} transient_passive_cooldown={} no_powercycle={} passive_until={} passive_reason={}",
                _config.id, reason, ping_rc, _transient_quiet_until_ms, _transient_probe_due_ms,
                _transient_hold_until_ms, _transient_probe_fail_count, passive_cooldown ? 1 : 0,
                passive_cooldown ? 1 : 0, _transient_passive_until_ms, _transient_passive_reason);
            return;
        }

        ++_transient_probe_fail_count;
        _transient_probe_due_ms = now_ms + kTransientProbeDelayMs;
        _transient_hold_until_ms = now_ms + kTransientFailHoldMs;

        const uint32_t elapsed_ms = _transient_first_ms == 0 ? 0 : now_ms - _transient_first_ms;
        const bool transient_timeout = elapsed_ms >= kTransientTimeoutMs &&
                                       _transient_probe_fail_count >= kTransientMaxProbeFailures;
        const bool suppress_timeout = passive_cooldown || !active_io_demand;
        if (transient_timeout && !suppress_timeout) {
            _bus_dead = true;
            _consecutive_bus_failures = kBusDeadFailureThreshold;
            _next_bus_recovery_probe_ms = now_ms;
            _recovery_stage = RecoveryStage::Flush;
            _recovery_escalation = 0;
            _angle_anim.teleport(static_cast<int>(_angle_anim.directValue()));
            _snap_to_target_on_rest = false;
            mclog::tagWarn(
                "SERVO-BUS",
                "axis_id={} event=bus_dead_escalated_after_transient_timeout reason={} op=ping rc={} elapsed_ms={} timeout_ms={} quiet_until={} probe_due={} hold_until={} probe_fail_count={} active_io_demand=1 transient_passive_cooldown=0 no_powercycle=0 action=stop_animation_no_write",
                _config.id, reason, ping_rc, elapsed_ms, kTransientTimeoutMs, _transient_quiet_until_ms,
                _transient_probe_due_ms, _transient_hold_until_ms, _transient_probe_fail_count);
            _last_bus_dead_diag_ms = now_ms;
            return;
        }

        if (transient_timeout && suppress_timeout) {
            mclog::tagWarn(
                "SERVO-BUS",
                "axis_id={} event=transient_timeout_suppressed reason={} op=ping rc={} elapsed_ms={} timeout_ms={} quiet_until={} probe_due={} hold_until={} probe_fail_count={} action=hold_no_write no_powercycle=1 transient_passive_cooldown={} passive_until={} passive_reason={} active_io_demand={}",
                _config.id, reason, ping_rc, elapsed_ms, kTransientTimeoutMs, _transient_quiet_until_ms,
                _transient_probe_due_ms, _transient_hold_until_ms, _transient_probe_fail_count,
                passive_cooldown ? 1 : 0, _transient_passive_until_ms, _transient_passive_reason,
                active_io_demand ? 1 : 0);
            return;
        }

        mclog::tagWarn(
            "SERVO-BUS",
            "axis_id={} event={} reason={} op=ping rc={} elapsed_ms={} quiet_until={} probe_due={} hold_until={} probe_fail_count={} action=hold_no_write no_powercycle={} transient_passive_cooldown={} passive_until={} passive_reason={} active_io_demand={}",
            _config.id, passive_cooldown ? "transient_probe_failed_passive" : "transient_probe_failed_hold",
            reason, ping_rc, elapsed_ms, _transient_quiet_until_ms, _transient_probe_due_ms,
            _transient_hold_until_ms, _transient_probe_fail_count, passive_cooldown ? 1 : 0,
            passive_cooldown ? 1 : 0, _transient_passive_until_ms, _transient_passive_reason,
            active_io_demand ? 1 : 0);
    }

    void log_transient_probe_deferred(uint32_t now_ms, const char* reason, const char* defer_reason)
    {
        if (now_ms - _last_transient_defer_log_ms < kTransientDeferLogIntervalMs) {
            return;
        }
        _last_transient_defer_log_ms = now_ms;
        const uint32_t slot_age_ms = now_ms - _verify_probe_slot_ms;
        mclog::tagInfo(
            "SERVO-BUS",
            "axis_id={} event=transient_probe_deferred reason={} defer_reason={} verify_slot_busy={} slot_owner={} slot_age_ms={} quiet_until={} probe_due={} hold_until={} probe_fail_count={} transient_passive_cooldown={} no_powercycle={} passive_until={} passive_reason={}",
            _config.id, reason, defer_reason,
            (_verify_probe_slot_owner >= 0 && _verify_probe_slot_owner != _config.id &&
             slot_age_ms < kTransientProbeSlotMs) ? 1 : 0,
            _verify_probe_slot_owner, slot_age_ms, _transient_quiet_until_ms, _transient_probe_due_ms,
            _transient_hold_until_ms, _transient_probe_fail_count,
            is_transient_passive_cooldown_active(now_ms) ? 1 : 0,
            is_transient_passive_cooldown_active(now_ms) ? 1 : 0,
            _transient_passive_until_ms, _transient_passive_reason);
    }

    void log_transient_write_skip(uint32_t now_ms, const char* reason)
    {
        if (now_ms - _last_transient_write_skip_log_ms < kTransientDeferLogIntervalMs) {
            return;
        }
        _last_transient_write_skip_log_ms = now_ms;
        mclog::tagWarn(
            "SERVO-BUS",
            "axis_id={} event=transient_probe_pending reason={} action=no_write quiet_until={} probe_due={} hold_until={} probe_fail_count={} transient_passive_cooldown={} no_powercycle={} passive_until={} passive_reason={}",
            _config.id, reason, _transient_quiet_until_ms, _transient_probe_due_ms,
            _transient_hold_until_ms, _transient_probe_fail_count,
            is_transient_passive_cooldown_active(now_ms) ? 1 : 0,
            is_transient_passive_cooldown_active(now_ms) ? 1 : 0,
            _transient_passive_until_ms, _transient_passive_reason);
    }

    void record_bus_success()
    {
        if (_bus_dead) {
            mclog::tagInfo("SERVO-BUS", "axis_id={} event=recovered stage=read_pos", _config.id);
        }
        _bus_dead                   = false;
        _consecutive_bus_failures   = 0;
        _write_ack_missing_count    = 0;
        _transient_probe_pending    = false;
        _transient_quiet_until_ms   = 0;
        _transient_probe_due_ms     = 0;
        _transient_hold_until_ms    = 0;
        _transient_first_ms         = 0;
        _transient_probe_fail_count = 0;
        _transient_passive_until_ms = 0;
        _transient_passive_reason   = "cleared";
        _next_bus_recovery_probe_ms = 0;
        _recovery_stage             = RecoveryStage::Flush;
        _recovery_escalation        = 0;
    }

    void record_bus_failure(const char* op, int rc, uint32_t now_ms)
    {
        if (_consecutive_bus_failures < kBusDeadFailureThreshold) {
            ++_consecutive_bus_failures;
        }

        if (!_bus_dead && _consecutive_bus_failures >= kBusDeadFailureThreshold) {
            _bus_dead                   = true;
            _next_bus_recovery_probe_ms = now_ms;
            _recovery_stage             = RecoveryStage::Flush;
            _recovery_escalation        = 0;
            _angle_anim.teleport(static_cast<int>(_angle_anim.directValue()));
            _snap_to_target_on_rest = false;
            mclog::tagWarn("SERVO-BUS",
                           "axis_id={} event=bus_dead_escalated op={} rc={} fail_count={} action=stop_animation_no_write probe_interval_ms={}",
                           _config.id, op, rc, _consecutive_bus_failures, kBusDeadProbeIntervalMs);
            _last_bus_dead_diag_ms = now_ms;
        } else if (_bus_dead && now_ms - _last_bus_dead_diag_ms >= kReadPosFailLogIntervalMs) {
            mclog::tagWarn("SERVO-BUS", "axis_id={} event=bus_dead_hold op={} rc={} fail_count={}",
                           _config.id, op, rc, _consecutive_bus_failures);
            _last_bus_dead_diag_ms = now_ms;
        }
    }

    void probe_bus_recovery(uint32_t now_ms, const char* reason)
    {
        if (!_bus_dead || now_ms < _next_bus_recovery_probe_ms) {
            return;
        }

        switch (_recovery_stage) {
            case RecoveryStage::Flush:
                _scs_bus.waitTxDone();
                _scs_bus.flushInput();
                _recovery_stage = RecoveryStage::Quiet;
                _next_bus_recovery_probe_ms = now_ms + kBusRecoveryQuietMs;
                mclog::tagInfo("SERVO-BUS",
                               "axis_id={} event=recovery_probe stage=flush reason={} quiet_ms={} next_ms={}",
                               _config.id, reason, kBusRecoveryQuietMs, _next_bus_recovery_probe_ms);
                return;

            case RecoveryStage::Quiet:
                _recovery_stage = RecoveryStage::Ping;
                _next_bus_recovery_probe_ms = now_ms;
                mclog::tagInfo("SERVO-BUS",
                               "axis_id={} event=recovery_probe stage=quiet reason={} next_stage=ping next_ms={}",
                               _config.id, reason, _next_bus_recovery_probe_ms);
                return;

            case RecoveryStage::Ping: {
                const int ping_rc = _scs_bus.Ping(_config.id);
                if (ping_rc == _config.id) {
                    _recovery_stage = RecoveryStage::ReadPos;
                    _next_bus_recovery_probe_ms = now_ms + kBusRecoveryReadAfterPingMs;
                    mclog::tagInfo("SERVO-BUS",
                                   "axis_id={} event=recovery_probe stage=ping reason={} rc={} next_stage=read_pos next_ms={}",
                                   _config.id, reason, ping_rc, _next_bus_recovery_probe_ms);
                } else if (_recovery_escalation == 0) {
                    _recovery_escalation = 1;
                    _recovery_stage = RecoveryStage::UartReinit;
                    _next_bus_recovery_probe_ms = now_ms;
                    mclog::tagWarn("SERVO-BUS",
                                   "axis_id={} event=recovery_probe_failed stage=ping reason={} rc={} next_stage=uart_reinit next_ms={}",
                                   _config.id, reason, ping_rc, _next_bus_recovery_probe_ms);
                } else if (_recovery_escalation == 1) {
                    _recovery_escalation = 2;
                    _recovery_stage = RecoveryStage::PowerCycle;
                    _next_bus_recovery_probe_ms = now_ms;
                    mclog::tagWarn("SERVO-BUS",
                                   "axis_id={} event=recovery_probe_failed stage=ping reason={} rc={} next_stage=power_cycle next_ms={}",
                                   _config.id, reason, ping_rc, _next_bus_recovery_probe_ms);
                } else {
                    _recovery_escalation = 0;
                    _recovery_stage = RecoveryStage::Flush;
                    _next_bus_recovery_probe_ms = now_ms + kBusDeadProbeIntervalMs;
                    mclog::tagWarn("SERVO-BUS",
                                   "axis_id={} event=recovery_probe_failed stage=failed reason={} rc={} next_stage=flush next_ms={} result=failed",
                                   _config.id, reason, ping_rc, _next_bus_recovery_probe_ms);
                }
                return;
            }

            case RecoveryStage::ReadPos: {
                const int raw = _scs_bus.ReadPos(_config.id);
                if (is_valid_raw(raw)) {
                    remember_present_angle(raw);
                    record_bus_success();
                    _read_pos_fail_count         = 0;
                    _read_move_fail_count        = 0;
                    _read_move_fallback_until_ms = 0;
                    _angle_anim.teleport(_last_present_angle);
                    _snap_to_target_on_rest = false;
                    mclog::tagInfo("SERVO-BUS",
                                   "axis_id={} event=recovery_probe stage=read_pos reason={} raw={} angle={} result=recovered",
                                   _config.id, reason, raw, _last_present_angle);
                } else {
                    _recovery_stage = RecoveryStage::Flush;
                    _next_bus_recovery_probe_ms = now_ms + kBusDeadProbeIntervalMs;
                    mclog::tagWarn("SERVO-BUS",
                                   "axis_id={} event=recovery_probe_failed stage=read_pos reason={} raw={} next_stage=flush next_ms={}",
                                   _config.id, reason, raw, _next_bus_recovery_probe_ms);
                }
                return;
            }

            case RecoveryStage::UartReinit: {
                _scs_bus.end();
                const bool begin_ok = _scs_bus.begin(UART_NUM_1, 1000000, 6, 7);
                _recovery_stage = RecoveryStage::Quiet;
                _next_bus_recovery_probe_ms = now_ms + kBusRecoveryQuietMs;
                mclog::tagInfo("SERVO-BUS",
                               "axis_id={} event=recovery_probe stage=uart_reinit reason={} rc={} quiet_ms={} next_stage=quiet next_ms={}",
                               _config.id, reason, begin_ok ? 1 : 0, kBusRecoveryQuietMs,
                               _next_bus_recovery_probe_ms);
                return;
            }

            case RecoveryStage::PowerCycle:
                _scs_bus.waitTxDone();
                GetHAL().setServoPowerEnabled(false);
                _recovery_stage = RecoveryStage::PowerRestore;
                _next_bus_recovery_probe_ms = now_ms + kBusRecoveryPowerOffMs;
                mclog::tagWarn("SERVO-BUS",
                               "axis_id={} event=recovery_probe stage=power_cycle reason={} action=vm_off off_ms={} next_stage=power_restore next_ms={}",
                               _config.id, reason, kBusRecoveryPowerOffMs, _next_bus_recovery_probe_ms);
                return;

            case RecoveryStage::PowerRestore:
                GetHAL().setServoPowerEnabled(true);
                _recovery_stage = RecoveryStage::UartReinit;
                _next_bus_recovery_probe_ms = now_ms + kBusRecoveryPowerRestoreMs;
                mclog::tagWarn("SERVO-BUS",
                               "axis_id={} event=recovery_probe stage=power_restore reason={} action=vm_on restore_ms={} next_stage=uart_reinit next_ms={}",
                               _config.id, reason, kBusRecoveryPowerRestoreMs, _next_bus_recovery_probe_ms);
                return;
        }
    }

    void check_mode(Mode targetMode)
    {
        if (targetMode == _current_mode) {
            return;
        }

        _scs_bus.SwitchMode(_config.id, static_cast<uint8_t>(targetMode));
        _current_mode = targetMode;
    }
};

void Hal::servo_init()
{
    mclog::tagInfo("HAL-Servo", "init");

    _scs_bus.begin(UART_NUM_1, 1000000, 6, 7);

    ServoConfig_t yaw_servo_config;
    yaw_servo_config.id                     = 1;
    yaw_servo_config.defaultZeroPos         = 460;
    yaw_servo_config.angleLimit             = Vector2i(-1280, 1280);
    yaw_servo_config.rawPosLimit            = Vector2i(0, 1000);
    yaw_servo_config.settingNs              = "servo";
    yaw_servo_config.settingZeroPositionKey = "zero_pos_1";
    yaw_servo_config.enablePwmMode          = true;

    ServoConfig_t pitch_servo_config;
    pitch_servo_config.id                     = 2;
    pitch_servo_config.defaultZeroPos         = 620;
    pitch_servo_config.angleLimit             = Vector2i(30, 870);
    pitch_servo_config.rawPosLimit            = Vector2i(0, 1000);
    pitch_servo_config.settingNs              = "servo";
    pitch_servo_config.settingZeroPositionKey = "zero_pos_2";

    auto yaw_servo   = std::make_unique<ScsServo>(yaw_servo_config);
    auto pitch_servo = std::make_unique<ScsServo>(pitch_servo_config);
    auto motion      = std::make_unique<Motion>(std::move(yaw_servo), std::move(pitch_servo));
    motion->init();

    GetStackChan().attachMotion(std::move(motion));
}
