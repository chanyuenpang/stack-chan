/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "servo.h"
#include <hal/hal.h>
#include <mooncake_log.h>

using namespace uitk;

namespace stackchan::motion {

static SpringOptions_t _default_spring_options = {
    .stiffness = 170.0,
    .damping   = 26.0,

    .mass     = 1.0,
    .velocity = 0.0,

    .restSpeed = 0.1,
    .restDelta = 0.1,

    .duration       = 0.0,
    .bounce         = 0.0,
    .visualDuration = 0.0,
};

void Servo::init()
{
    apply_default_spring_options();

    _angle_anim.teleport(getCurrentAngle());
    update();

    setTorqueEnabled(false);
}

void Servo::update()
{
    if (_update_in_progress) {
        return;
    }

    struct UpdateGuard {
        bool& flag;
        explicit UpdateGuard(bool& flag) : flag(flag) { flag = true; }
        ~UpdateGuard() { flag = false; }
    } guard(_update_in_progress);

    // Keep update in at most 50Hz
    if (GetHAL().millis() - _last_tick < 20) {
        return;
    }
    _last_tick = GetHAL().millis();

    // Apply animation
    if (!_angle_anim.done()) {
        _angle_anim.updateWithDelta(0.02f);  // Fixed delta time for consistency
        set_angle_impl(static_cast<int>(_angle_anim.directValue()));
    }

    // Snap to target angle when animation ends
    else if (_snap_to_target_on_rest) {
        _snap_to_target_on_rest = false;
        set_angle_impl(_angle_anim.end);
    }

    // Auto release torque on rest
    else if (_auto_torque_release_enabled && !isMoving()) {
        if (GetHAL().millis() - _last_torque_check_tick > 200) {
            if (getTorqueEnabled()) {
                setTorqueEnabled(false);
            }
            _last_torque_check_tick = GetHAL().millis();
        }
    }
}

void Servo::move(int angle)
{
    _last_motion_speed = 180;
    apply_default_spring_options();
    update_angle_anim_target(angle);
}

void Servo::moveWithSpringParams(int angle, float stiffness, float damping)
{
    _angle_anim.springOptions().visualDuration = 0.0f;  // Disable timing override
    _angle_anim.springOptions().stiffness      = stiffness;
    _angle_anim.springOptions().damping        = damping;

    update_angle_anim_target(angle);
}

void Servo::moveWithSpeed(int angle, int speed)
{
    _last_motion_speed = uitk::clamp(speed, 0, 1000);
    auto spring_options = map_speed_to_spring_options(_last_motion_speed);
    moveWithSpringParams(angle, spring_options.stiffness, spring_options.damping);
}

void Servo::moveWithSpeedNoHardwareRead(int angle, int speed)
{
    _last_motion_speed = uitk::clamp(speed, 0, 1000);
    auto spring_options = map_speed_to_spring_options(_last_motion_speed);
    _angle_anim.springOptions().visualDuration = 0.0f;
    _angle_anim.springOptions().stiffness      = spring_options.stiffness;
    _angle_anim.springOptions().damping        = spring_options.damping;
    update_angle_anim_target(angle, false);
}

void Servo::stopAnimation()
{
    // Do not read the physical servo position here. Scheduler release paths call
    // Motion::stop() immediately after the spring animation reaches rest; issuing
    // a ReadPos at that point can wedge an unhealthy half-duplex servo bus. Normal
    // movement auto-sync still uses getCurrentAngle() in update_angle_anim_target().
    const int cached_angle = static_cast<int>(_angle_anim.directValue());
    _angle_anim.teleport(cached_angle);
    _snap_to_target_on_rest = false;
    mclog::tagInfo("SERVO-DIAG", "source=stopAnimation read_hardware=0 angle={}", cached_angle);
}

void Servo::abortAnimationNoRead()
{
    const int cached_angle = static_cast<int>(_angle_anim.directValue());
    _angle_anim.teleport(cached_angle);
    _snap_to_target_on_rest = false;
    mclog::tagInfo("SERVO-DIAG", "source=abortAnimationNoRead read_hardware=0 angle={}", cached_angle);
}

int Servo::getCurrentAngle()
{
    return _angle_anim.directValue();
}

int Servo::getAnimationAngle()
{
    return static_cast<int>(_angle_anim.directValue());
}

int Servo::syncAnimationToCurrentAngle()
{
    const int current_angle = getCurrentAngle();
    _angle_anim.teleport(current_angle);
    _snap_to_target_on_rest = false;
    return current_angle;
}

bool Servo::isMoving()
{
    if (isBusDead()) {
        return false;
    }
    return _angle_anim.done() == false || is_moving_impl();
}

void Servo::apply_default_spring_options()
{
    auto& options          = _angle_anim.springOptions();
    options.visualDuration = 0.0f;  // Disable timing override
    options.stiffness      = _default_spring_options.stiffness;
    options.damping        = _default_spring_options.damping;
}

void Servo::update_angle_anim_target(int angle, bool allowHardwareSync)
{
    angle = uitk::clamp(angle, _angle_limit.x, _angle_limit.y);

    // 2.0.18: motion must explicitly hold torque before any optional
    // start-position sync/read and before the first position write.
    setTorqueEnabled(true);

    if (allowHardwareSync && _auto_angle_sync_enabled) {
        _angle_anim.teleport(getCurrentAngle());  // Use current angle as start
    }
    _angle_anim             = angle;  // Apply new target
    _snap_to_target_on_rest = true;
}

uitk::SpringOptions_t Servo::map_speed_to_spring_options(int speed)
{
    speed = uitk::clamp(speed, 0, 1000);

    // 1. 计算 Stiffness (刚度)
    // 使用二次方映射: k = k_min + (speed/1000)^2 * k_range
    // 当 speed=500 时，k 约为 10 + 0.25 * 640 = 170
    float k_min           = 10.0f;
    float k_max           = 650.0f;
    float normalizedSpeed = speed / 1000.0f;
    float stiffness       = k_min + (normalizedSpeed * normalizedSpeed) * (k_max - k_min);

    // 2. 计算 Damping (阻尼)
    // 为了保持临界阻尼(无过冲，最快稳定)，公式为 d = 2 * sqrt(m * k)
    // 如果想要带一点点弹性感(bounce)，可以将系数从 2.0 降到 1.5~1.8
    float mass    = 1.0f;
    float damping = 2.0f * sqrtf(mass * stiffness);

    // 3. 构造选项
    uitk::SpringOptions_t options = _default_spring_options;
    options.stiffness             = stiffness;
    options.damping               = damping;
    options.mass                  = mass;

    // 4. 动态调整静止阈值
    // 高速时阈值大一点可以防止由于离散计算导致的微小抖动
    if (speed > 800) {
        options.restDelta = 0.5f;
        options.restSpeed = 0.5f;
    } else {
        options.restDelta = 0.1f;
        options.restSpeed = 0.1f;
    }

    return options;
}

}  // namespace stackchan::motion
