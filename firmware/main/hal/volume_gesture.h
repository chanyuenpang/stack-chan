#pragma once

// Starts the low-priority, core-0 consumer for the hardware touch snapshot.
// It owns the LVGL lock only while applying a volume gesture.
void start_stackchan_volume_gesture_task();

// Polls the full-screen vertical speaker-volume gesture. The caller must hold
// the LVGL lock because this function creates and removes the temporary UI.
void update_stackchan_volume_gesture();
