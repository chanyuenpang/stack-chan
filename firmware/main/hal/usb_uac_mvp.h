#pragma once

#include <cstdint>
#include <esp_err.h>

struct StackchanUsbAudioPathState {
    bool microphone_enabled;
    bool speaker_enabled;
    uint32_t revision;
};

esp_err_t start_stackchan_usb_uac_mvp();
StackchanUsbAudioPathState get_stackchan_usb_audio_path_state();
void set_stackchan_usb_audio_paths(bool microphone_enabled, bool speaker_enabled);
