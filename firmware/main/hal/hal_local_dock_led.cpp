#include "hal_local_dock_led.h"

#include <smooth_lvgl.hpp>
#include <stackchan/stackchan.h>

void stackchan_local_dock_user_disconnect_led_off()
{
    // snapColor cancels an in-flight animated/manual color and updates both
    // physical LED banks while the local UI is still alive.
    LvglLockGuard lock;
    GetStackChan().leftNeonLight().snapColor(0, 0, 0);
    GetStackChan().rightNeonLight().snapColor(0, 0, 0);
}

void stackchan_local_dock_input_muted_led_off()
{
    // This is a speaker-mode state projection, not a transport teardown.
    LvglLockGuard lock;
    GetStackChan().leftNeonLight().snapColor(0, 0, 0);
    GetStackChan().rightNeonLight().snapColor(0, 0, 0);
}

void stackchan_local_dock_input_unmuted_led_connected()
{
    // Return to the established connected indication. Host LED updates can
    // subsequently take back their existing session-state ownership.
    LvglLockGuard lock;
    GetStackChan().leftNeonLight().snapColor(0, 50, 0);
    GetStackChan().rightNeonLight().snapColor(0, 50, 0);
}

void stackchan_local_dock_connected_led_green()
{
    // The official display sets index 0 while entering Listening.  Apply the
    // same green to both physical Neon banks for this one connection boundary;
    // later Host LED state updates retain ownership of ongoing status colors.
    LvglLockGuard lock;
    GetStackChan().leftNeonLight().snapColor(0, 50, 0);
    GetStackChan().rightNeonLight().snapColor(0, 50, 0);
}
