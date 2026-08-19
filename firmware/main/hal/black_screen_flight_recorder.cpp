#include "black_screen_flight_recorder.h"

#include <atomic>
#include <esp_log.h>
#include <esp_attr.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "settings.h"

namespace stackchan_black_screen_flight {
namespace {
constexpr char kTag[] = "BlackScreenFlight";
constexpr uint32_t kBreadcrumbMagic = 0x53434652;  // "SCFR"
constexpr uint32_t kBreadcrumbVersion = 4;
constexpr char kNamespace[] = "black_screen_flight";
std::atomic<uint32_t> g_main_heartbeat_us{0};
std::atomic<uint32_t> g_network_heartbeat_us{0};
std::atomic<uint32_t> g_display_attempt_us{0};
std::atomic<uint32_t> g_display_success_us{0};
std::atomic<uint32_t> g_display_release_us{0};
std::atomic<uint32_t> g_backlight{0};
std::atomic<bool> g_pending{false};

// RTC no-init RAM survives a software/watchdog reset but is intentionally not
// flash-backed. The fixed-width checkpoints below create no runnable work and
// avoid the NVS writes that previously perturbed the live audio path.
struct RtcBreadcrumb {
    uint32_t magic;
    uint32_t version;
    uint32_t last_event;
    uint32_t last_event_us;
    uint32_t main_heartbeat_us;
    uint32_t network_heartbeat_us;
    uint32_t display_attempt_us;
    uint32_t display_success_us;
    uint32_t display_release_us;
    uint32_t audio_frame_bytes;
    uint32_t audio_declared_payload_bytes;
    uint32_t backlight;
    uint32_t checksum;
};
RTC_NOINIT_ATTR RtcBreadcrumb g_rtc_breadcrumb;
portMUX_TYPE g_breadcrumb_lock = portMUX_INITIALIZER_UNLOCKED;

uint32_t NowUs() { return static_cast<uint32_t>(esp_timer_get_time()); }
uint32_t BreadcrumbChecksum(const RtcBreadcrumb& value) {
    return value.magic ^ value.version ^ value.last_event ^ value.last_event_us ^
           value.main_heartbeat_us ^ value.network_heartbeat_us ^ value.display_attempt_us ^
           value.display_success_us ^ value.display_release_us ^ value.audio_frame_bytes ^
           value.audio_declared_payload_bytes ^ value.backlight ^ 0x4b1d2e3f;
}

bool HasValidBreadcrumb() {
    return g_rtc_breadcrumb.magic == kBreadcrumbMagic &&
           g_rtc_breadcrumb.version == kBreadcrumbVersion &&
           g_rtc_breadcrumb.checksum == BreadcrumbChecksum(g_rtc_breadcrumb);
}

void UpdateBreadcrumbFromMain(uint32_t now, FlightEvent event) {
    portENTER_CRITICAL(&g_breadcrumb_lock);
    g_rtc_breadcrumb.last_event = static_cast<uint32_t>(event);
    g_rtc_breadcrumb.last_event_us = now;
    g_rtc_breadcrumb.main_heartbeat_us = g_main_heartbeat_us.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.network_heartbeat_us = g_network_heartbeat_us.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.display_attempt_us = g_display_attempt_us.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.display_success_us = g_display_success_us.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.display_release_us = g_display_release_us.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.backlight = g_backlight.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.checksum = BreadcrumbChecksum(g_rtc_breadcrumb);
    portEXIT_CRITICAL(&g_breadcrumb_lock);
}

void UpdateBreadcrumbFromAudio(uint32_t frame_bytes, uint32_t declared_payload_bytes) {
    const uint32_t now = NowUs();
    portENTER_CRITICAL(&g_breadcrumb_lock);
    g_rtc_breadcrumb.last_event = static_cast<uint32_t>(FlightEvent::AudioFrame);
    g_rtc_breadcrumb.last_event_us = now;
    g_rtc_breadcrumb.audio_frame_bytes = frame_bytes;
    g_rtc_breadcrumb.audio_declared_payload_bytes = declared_payload_bytes;
    g_rtc_breadcrumb.checksum = BreadcrumbChecksum(g_rtc_breadcrumb);
    portEXIT_CRITICAL(&g_breadcrumb_lock);
}

void SeedBreadcrumb(uint32_t now) {
    g_rtc_breadcrumb.magic = kBreadcrumbMagic;
    g_rtc_breadcrumb.version = kBreadcrumbVersion;
    g_rtc_breadcrumb.last_event = static_cast<uint32_t>(FlightEvent::Boot);
    g_rtc_breadcrumb.last_event_us = now;
    g_rtc_breadcrumb.main_heartbeat_us = now;
    g_rtc_breadcrumb.network_heartbeat_us = now;
    g_rtc_breadcrumb.display_attempt_us = 0;
    g_rtc_breadcrumb.display_success_us = 0;
    g_rtc_breadcrumb.display_release_us = 0;
    g_rtc_breadcrumb.audio_frame_bytes = 0;
    g_rtc_breadcrumb.audio_declared_payload_bytes = 0;
    g_rtc_breadcrumb.backlight = g_backlight.load(std::memory_order_relaxed);
    g_rtc_breadcrumb.checksum = BreadcrumbChecksum(g_rtc_breadcrumb);
}

}

void Initialize() {
    const bool previous_breadcrumb_valid = HasValidBreadcrumb();
    const RtcBreadcrumb previous_breadcrumb = g_rtc_breadcrumb;
    Settings settings(kNamespace, false);
    g_pending.store(settings.GetBool("pending", false));
    const uint32_t now = NowUs();
    g_main_heartbeat_us.store(now);
    g_network_heartbeat_us.store(now);
    if (previous_breadcrumb_valid) {
        // Finish the Settings scope before any later code can reset. v2
        // restarted while Settings was still alive, losing its only record.
        {
            Settings writable(kNamespace, true);
            writable.SetBool("pending", true);
            writable.SetString("reason", "previous_boot_snapshot");
            writable.SetInt("reset_reason", static_cast<int32_t>(esp_reset_reason()));
            writable.SetInt("last_event", static_cast<int32_t>(previous_breadcrumb.last_event));
            writable.SetInt("last_event_us", static_cast<int32_t>(previous_breadcrumb.last_event_us));
            writable.SetInt("last_main_heartbeat_us", static_cast<int32_t>(previous_breadcrumb.main_heartbeat_us));
            writable.SetInt("last_network_heartbeat_us", static_cast<int32_t>(previous_breadcrumb.network_heartbeat_us));
            writable.SetInt("last_display_attempt_us", static_cast<int32_t>(previous_breadcrumb.display_attempt_us));
            writable.SetInt("last_display_success_us", static_cast<int32_t>(previous_breadcrumb.display_success_us));
            writable.SetInt("last_display_release_us", static_cast<int32_t>(previous_breadcrumb.display_release_us));
            writable.SetInt("audio_frame_bytes", static_cast<int32_t>(previous_breadcrumb.audio_frame_bytes));
            writable.SetInt("audio_declared_payload_bytes", static_cast<int32_t>(previous_breadcrumb.audio_declared_payload_bytes));
            writable.SetInt("backlight", static_cast<int32_t>(previous_breadcrumb.backlight));
        }
        g_pending.store(true);
    }
    SeedBreadcrumb(now);
}
void MainHeartbeat() {
    const uint32_t now = NowUs();
    g_main_heartbeat_us.store(now, std::memory_order_relaxed);
    UpdateBreadcrumbFromMain(now, FlightEvent::MainHeartbeat);
}
void NetworkHeartbeat() {
    const uint32_t now = NowUs();
    g_network_heartbeat_us.store(now, std::memory_order_relaxed);
    UpdateBreadcrumbFromMain(now, FlightEvent::NetworkHeartbeat);
}
void NetworkSessionHeartbeat() {
    NetworkHeartbeat();
}
void DisplayLockAttempt() { g_display_attempt_us.store(NowUs(), std::memory_order_relaxed); }
void DisplayLockAcquired() { g_display_success_us.store(g_display_attempt_us.load(), std::memory_order_relaxed); }
void DisplayLockReleased() { g_display_release_us.store(NowUs(), std::memory_order_relaxed); }
void BacklightChanged(uint8_t brightness) { g_backlight.store(brightness, std::memory_order_relaxed); }
void IncomingAudioFrame(uint32_t frame_bytes, uint32_t declared_payload_bytes) {
    UpdateBreadcrumbFromAudio(frame_bytes, declared_payload_bytes);
}
void AudioChannelClosed() { UpdateBreadcrumbFromMain(NowUs(), FlightEvent::AudioChannelClosed); }

std::string PendingRecordNotification() {
    if (!g_pending.load()) return {};
    Settings settings(kNamespace, false);
    return "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/black_screen_flight_record\",\"params\":{\"type\":\"black_screen_flight_record\",\"reason\":\"" + settings.GetString("reason") + "\",\"reset_reason\":" + std::to_string(settings.GetInt("reset_reason")) + ",\"last_event\":" + std::to_string(settings.GetInt("last_event")) + ",\"last_event_us\":" + std::to_string(settings.GetInt("last_event_us")) + ",\"last_main_heartbeat_us\":" + std::to_string(settings.GetInt("last_main_heartbeat_us")) + ",\"last_network_heartbeat_us\":" + std::to_string(settings.GetInt("last_network_heartbeat_us")) + ",\"last_display_attempt_us\":" + std::to_string(settings.GetInt("last_display_attempt_us")) + ",\"last_display_success_us\":" + std::to_string(settings.GetInt("last_display_success_us")) + ",\"last_display_release_us\":" + std::to_string(settings.GetInt("last_display_release_us")) + ",\"audio_frame_bytes\":" + std::to_string(settings.GetInt("audio_frame_bytes")) + ",\"audio_declared_payload_bytes\":" + std::to_string(settings.GetInt("audio_declared_payload_bytes")) + ",\"backlight\":" + std::to_string(settings.GetInt("backlight")) + "}}";
}
void MarkRecordPublished() {
    // This only runs after Application confirmed a live audio channel and
    // queued the MCP notification. Keep the NVS copy for the next boot, but
    // never requeue it on every clock tick of the current boot.
    g_pending.store(false);
}

}  // namespace stackchan_black_screen_flight
