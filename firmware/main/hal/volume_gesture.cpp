#include "volume_gesture.h"

#include <algorithm>
#include <cstdlib>

#include "hal.h"
#include "board/hal_bridge.h"
#include "lvgl.h"
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

namespace {
constexpr int kVolumeGestureScreenWidth = 320;
constexpr int kVolumeGestureScreenHeight = 240;
constexpr int kVolumeGestureActivationPixels = 8;

class VolumeGesture {
public:
    void update()
    {
        const auto touch = hal_bridge::get_touch_point();
        const bool pressed = touch.num > 0;
        const lv_point_t current_point{touch.x, touch.y};

        if (pressed && !last_pressed_) {
            start_point_ = current_point;
            start_volume_ = GetHAL().getSpeakerVolume();
            current_volume_ = start_volume_;
            tracking_ = true;
            active_ = false;
        } else if (pressed && tracking_) {
            const int vertical_delta = start_point_.y - current_point.y;
            const int horizontal_delta = std::abs(current_point.x - start_point_.x);
            if (!active_) {
                if (std::abs(vertical_delta) < kVolumeGestureActivationPixels ||
                    std::abs(vertical_delta) < horizontal_delta) {
                    return;
                }
                active_ = true;
                // The original target has already received the press. Stop
                // that sequence before release so a confirmed volume swipe
                // becomes PRESS_LOST instead of activating the control below.
                with_lvgl([this]() {
                    if (auto* indev = GetHAL().lvTouchpad) lv_indev_wait_release(indev);
                    create_overlay();
                });
            }

            const int target_volume = std::clamp(
                start_volume_ + vertical_delta * 100 / kVolumeGestureScreenHeight, 0, 100);
            if (target_volume != current_volume_) {
                current_volume_ = target_volume;
                GetHAL().setSpeakerVolume(current_volume_, false);
                with_lvgl([this]() { render_overlay(); });
            }
        } else if (!pressed && last_pressed_) {
            if (tracking_ && active_) GetHAL().setSpeakerVolume(current_volume_, true);
            if (active_) with_lvgl([this]() { destroy_overlay(); });
            tracking_ = false;
            active_ = false;
        }

        last_pressed_ = pressed;
    }

private:
    void create_overlay()
    {
        if (volume_overlay_) return;

        volume_overlay_ = lv_obj_create(lv_screen_active());
        lv_obj_remove_style_all(volume_overlay_);
        lv_obj_set_size(volume_overlay_, kVolumeGestureScreenWidth, kVolumeGestureScreenHeight);
        lv_obj_set_pos(volume_overlay_, 0, 0);
        lv_obj_set_style_bg_color(volume_overlay_, lv_color_hex(0x000000), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(volume_overlay_, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_remove_flag(volume_overlay_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(volume_overlay_, LV_OBJ_FLAG_SCROLLABLE);

        volume_fill_ = lv_obj_create(volume_overlay_);
        lv_obj_remove_style_all(volume_fill_);
        lv_obj_set_width(volume_fill_, kVolumeGestureScreenWidth);
        lv_obj_set_style_bg_color(volume_fill_, lv_color_hex(0x00FF00), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(volume_fill_, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_remove_flag(volume_fill_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(volume_fill_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_align(volume_fill_, LV_ALIGN_BOTTOM_MID, 0, 0);
        lv_obj_move_foreground(volume_overlay_);
    }

    void render_overlay()
    {
        if (!volume_fill_) return;
        const int fill_height = current_volume_ * kVolumeGestureScreenHeight / 100;
        lv_obj_set_height(volume_fill_, fill_height);
        lv_obj_align(volume_fill_, LV_ALIGN_BOTTOM_MID, 0, 0);
        if (fill_height == 0) {
            lv_obj_add_flag(volume_fill_, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_remove_flag(volume_fill_, LV_OBJ_FLAG_HIDDEN);
        }
    }

    void destroy_overlay()
    {
        if (volume_overlay_) lv_obj_del(volume_overlay_);
        volume_overlay_ = nullptr;
        volume_fill_ = nullptr;
    }

    template <typename Callback>
    void with_lvgl(Callback&& callback)
    {
        LvglLockGuard lock;
        callback();
    }

    bool tracking_ = false;
    bool active_ = false;
    bool last_pressed_ = false;
    lv_point_t start_point_{};
    int start_volume_ = 0;
    int current_volume_ = 0;
    lv_obj_t* volume_overlay_ = nullptr;
    lv_obj_t* volume_fill_ = nullptr;
};

VolumeGesture s_volume_gesture;

void volume_gesture_task(void*)
{
    while (true) {
        s_volume_gesture.update();
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
}  // namespace

void start_stackchan_volume_gesture_task()
{
    static TaskHandle_t task_handle = nullptr;
    if (task_handle != nullptr) return;
    xTaskCreatePinnedToCore(volume_gesture_task, "volume_gesture", 4096, nullptr, 1, &task_handle, 0);
}

void update_stackchan_volume_gesture()
{
    s_volume_gesture.update();
}
