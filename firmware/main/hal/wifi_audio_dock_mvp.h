#pragma once

#include <esp_err.h>

// Starts the mutually-exclusive Wi-Fi counterpart of the USB UAC + CDC
// companion. The endpoint/key are installed through the existing BLE config
// characteristic under the wifi_audio NVS namespace.
esp_err_t start_stackchan_wifi_audio_dock_mvp();

// Polls the isolated companion runtime's full-screen vertical volume gesture.
// The caller must hold the LVGL lock.
void update_stackchan_wifi_audio_volume_gesture();

// Returns a non-secret lifecycle label suitable for BLE diagnostic feedback.
const char* stackchan_wifi_audio_transport_state();
