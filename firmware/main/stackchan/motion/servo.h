/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include <smooth_ui_toolkit.hpp>
#include <uitk/short_namespace.hpp>
#include <cstdint>

namespace stackchan::motion {

/**
 * @brief
 *
 */
class Servo {
public:
    virtual ~Servo() = default;

    /**
     * @brief
     *
     */
    virtual void init();

    /**
     * @brief
     *
     */
    virtual void update();

    /**
     * @brief Move to angle
     *
     * @param angle
     */
    void move(int angle);

    /**
     * @brief Move to angle with custom spring params
     *
     * @param angle
     * @param stiffness
     * @param damping
     */
    void moveWithSpringParams(int angle, float stiffness = 170.0f, float damping = 26.0f);

    /**
     * @brief Move to angle with speed mapping
     *
     * @param angle
     * @param speed (0-1000)
     */
    void moveWithSpeed(int angle, int speed);

    /**
     * @brief Move with speed without synchronizing animation from hardware.
     *
     * This is used by scheduled/celebration command paths that must not issue
     * a ReadPos while queuing a new target.
     */
    void moveWithSpeedNoHardwareRead(int angle, int speed);

    /**
     * @brief Stop the current animation immediately without issuing a new move.
     *
     * Uses the cached animation angle and does not read hardware. This keeps
     * scheduler release/stop paths from issuing ReadPos after motion reaches rest.
     */
    void stopAnimation();

    /**
     * @brief Stop animation without reading hardware or issuing writes.
     *
     * Used when the servo bus is unhealthy: do not use stale present/fallback
     * values to create a new release/home write.
     */
    void abortAnimationNoRead();

    /**
     * @brief True when the hardware backend has declared the servo bus dead.
     */
    virtual bool isBusDead() const
    {
        return false;
    }

    /**
     * @brief True only after the backend has explicitly declared the bus dead.
     */
    bool hasBusDead() const
    {
        return isBusDead();
    }

    /**
     * @brief True when recent hardware I/O was unreliable, but bus_dead may still be false.
     *
     * Examples include consecutive write/read failures below the bus_dead threshold,
     * failed ReadPos, or failed ReadMove diagnostics. This is a transient/recent
     * signal and must not be treated as an explicit bus_dead declaration.
     */
    virtual bool hasTransientIoError() const
    {
        return false;
    }

    /**
     * @brief Broad hardware-unhealthy signal: bus_dead OR transient/recent I/O errors.
     *
     * Prefer hasBusDead() when the caller needs to distinguish a declared dead bus
     * from a conservative no-write decision caused by transient I/O errors.
     */
    virtual bool hasHardwareFailure() const
    {
        return hasBusDead() || hasTransientIoError();
    }

    /**
     * @brief Service a safe read-only bus recovery probe if the backend is bus_dead.
     *
     * Implementations must not write servo targets from this path. Returns true
     * when the backend is currently usable (or was never dead).
     */
    virtual bool serviceBusRecoveryProbe(uint32_t nowMs, const char* reason)
    {
        (void)nowMs;
        (void)reason;
        return !isBusDead();
    }

    /**
     * @brief Temporarily keep transient I/O errors in passive/no-powercycle mode.
     *
     * Used after a safe no-write motion finish: read-only probes may still clear
     * the transient state, but probe failures must not escalate to bus_dead or
     * power-cycle until a real motion/write demand needs the bus again.
     */
    virtual void enterTransientPassiveCooldown(uint32_t durationMs, const char* reason)
    {
        (void)durationMs;
        (void)reason;
    }

    /**
     * @brief Rotate servo with given velocity
     *
     * @param velocity (-1000, 1000)
     */
    virtual void rotate(int velocity)
    {
    }

    /**
     * @brief Get servo current angle
     *
     * @return int
     */
    virtual int getCurrentAngle();

    /**
     * @brief Get current animation cache angle without reading hardware.
     *
     * @return int
     */
    int getAnimationAngle();

    /**
     * @brief Rebuild the animation cache from the current angle source.
     *
     * For hardware-backed servos getCurrentAngle() is the physical present angle;
     * for software-only servos it is the existing animation value.
     * @return int angle used as the rebuilt animation start
     */
    int syncAnimationToCurrentAngle();

    /**
     * @brief
     *
     * @return uitk::Vector2i
     */
    virtual uitk::Vector2i getAngleLimit() const
    {
        return _angle_limit;
    }

    /**
     * @brief
     *
     * @return true
     * @return false
     */
    bool isMoving();

    /**
     * @brief
     *
     * @param enabled
     */
    virtual void setTorqueEnabled(bool enabled)
    {
    }
    virtual bool getTorqueEnabled()
    {
        return false;
    }

    /**
     * @brief Auto release torque on rest
     *
     * @param enabled
     */
    void setAutoTorqueReleaseEnabled(bool enabled)
    {
        _auto_torque_release_enabled = enabled;
    }

    /**
     * @brief Enables or disables automatic synchronization of the animation start point
     *        with the current physical angle.
     *
     * @param enabled
     *        - If true: Prevents sudden "jumps" when the servo is moved manually by
     *          external forces, but may cause stuttering during high-frequency updates
     *          as it resets the animation's velocity.
     *        - If false: Maintains animation momentum and velocity for smooth,
     *          continuous motion, but may cause a "snap" if the actual angle differs
     *          significantly from the internal state.
     */
    void setAutoAngleSyncEnabled(bool enabled)
    {
        _auto_angle_sync_enabled = enabled;
    }

    /**
     * @brief
     *
     */
    virtual void setCurrentAngleAsZero()
    {
    }

    /**
     * @brief
     *
     */
    virtual void resetZeroCalibration()
    {
    }

protected:
    Servo()
    {
    }

    void set_angle_limit(uitk::Vector2i angleLimit)
    {
        _angle_limit = angleLimit;
    }

    /**
     * @brief Servo set angle implementation
     *
     * @param angle
     */
    virtual void set_angle_impl(int angle) = 0;
    virtual bool is_moving_impl()
    {
        return false;
    }

protected:
    uitk::Vector2i _angle_limit;
    uitk::AnimateValue _angle_anim;

    uint32_t _last_tick               = 0;
    uint32_t _last_torque_check_tick  = 0;
    bool _snap_to_target_on_rest      = false;
    bool _auto_torque_release_enabled = true;
    bool _auto_angle_sync_enabled     = true;
    bool _update_in_progress          = false;
    int _last_motion_speed            = 180;

    void apply_default_spring_options();
    void update_angle_anim_target(int angle, bool allowHardwareSync = true);
    uitk::SpringOptions_t map_speed_to_spring_options(int speed);
};

}  // namespace stackchan::motion
