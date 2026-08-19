#pragma once

#include <cstdint>
#include <string>

namespace stackchan_black_screen_flight {

enum class FlightEvent : uint32_t {
    Boot = 1,
    MainHeartbeat = 2,
    NetworkHeartbeat = 3,
    AudioFrame = 4,
    AudioChannelClosed = 5,
};

// This diagnostic is deliberately passive during healthy operation. It creates
// no tasks and never restarts the device; the next boot reports the last RTC
// checkpoint through the existing Dock management channel.
void Initialize();
void MainHeartbeat();
void NetworkHeartbeat();
// Call only while the authenticated Dock audio channel is actually open.
// This is deliberately separate from the one-shot Wi-Fi connected event.
void NetworkSessionHeartbeat();
void DisplayLockAttempt();
void DisplayLockAcquired();
void DisplayLockReleased();
void BacklightChanged(uint8_t brightness);
// These checkpoints only snapshot existing execution paths. They create no
// task, write no NVS data, and never change audio or network behaviour.
void IncomingAudioFrame(uint32_t frame_bytes, uint32_t declared_payload_bytes);
void AudioChannelClosed();

// Returns the retained record after a watchdog restart, without erasing it.
// Publication is deliberately idempotent: the record remains in NVS so an
// early, not-yet-authenticated MCP send cannot lose crash evidence.
std::string PendingRecordNotification();
void MarkRecordPublished();

}  // namespace stackchan_black_screen_flight
