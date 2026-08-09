#include "wifi_audio_dock_mvp.h"

#include <array>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>
#include <memory>
#include <mutex>
#include <vector>

#include <esp_log.h>
#include <esp_heap_caps.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/idf_additions.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <mbedtls/md.h>
#include <sdkconfig.h>

#if CONFIG_STACKCHAN_WIFI_AUDIO_MVP
#include "audio_codec.h"
#include "board.h"
#include "board/cores3_audio_codec.h"
#include "board/stackchan_display.h"
#include "cJSON.h"
#include "display.h"
#include "hal.h"
#include "hal_dev_local_control.h"
#include "lvgl.h"
#include "settings.h"
#include "stackchan/stackchan.h"
#include "web_socket.h"
#include <lwip/inet.h>
#include <lwip/netdb.h>
#include <lwip/sockets.h>

namespace {
constexpr const char* TAG = "WIFI-AUDIO";
constexpr uint32_t kProtocolVersion = 1;
constexpr size_t kPcmBytes = 480;
constexpr size_t kAudioFrameBytes = 16 + kPcmBytes;
constexpr size_t kControlFrameBytes = 1500;
constexpr size_t kSamplesPerFrame = kPcmBytes / sizeof(int16_t);
constexpr size_t kMicrophonePcmSamples = 480;
constexpr size_t kMicrophonePcmBytes = 960;
constexpr size_t kMaxWebSocketFrameBytes = kControlFrameBytes;
constexpr size_t kMicrophoneUdpSessionBytes = 16;
constexpr size_t kMicrophoneUdpHeaderBytes = 36;
constexpr size_t kMicrophoneUdpTagBytes = 16;
constexpr size_t kMicrophoneUdpMaxPacketBytes = 1200;
constexpr size_t kMicrophoneUdpMaxPayloadBytes =
    kMicrophoneUdpMaxPacketBytes - kMicrophoneUdpHeaderBytes - kMicrophoneUdpTagBytes;
constexpr size_t kMicrophoneUdpMaxSendAttempts = 3;
constexpr TickType_t kMicrophoneUdpRetryDelayTicks = 1;
constexpr char kMicrophoneUdpMagic[] = "SCAU";
constexpr char kMicrophoneUdpKeyLabel[] = "stackchan-wifi-audio-udp-v1\n";
constexpr char kMicrophoneUdpReadyLabel[] = "stackchan-wifi-audio-udp-ready-v1";
static_assert(kMicrophoneUdpMaxPayloadBytes == 1148,
              "authenticated UDP microphone packets must remain at or below 1200 bytes");
static_assert(kMicrophoneUdpHeaderBytes + kMicrophonePcmBytes + kMicrophoneUdpTagBytes == 1012,
              "20 ms native PCM microphone packets must remain below the no-fragment boundary");
constexpr size_t kWifiInputChannels = 4;
constexpr size_t kWifiInputFrameBytes = kSamplesPerFrame * kWifiInputChannels * sizeof(int16_t);
static_assert(kWifiInputFrameBytes == 1920, "four-slot 24 kHz input must read exactly 10 ms");
constexpr uint8_t kMicrophonePcmFrameFlag = 2;
constexpr uint8_t kSpeakerFrameFlag = 1;
constexpr size_t kSpeakerQueueFrames = 12;
constexpr size_t kSpeakerPrebufferFrames = 4;
constexpr TickType_t kSpeakerQueueWaitTicks = pdMS_TO_TICKS(20);
constexpr int64_t kSpeakerDrainGraceUs = 400000;
constexpr int64_t kSpeakerReplyIdleTimeoutUs = 3000000;
constexpr size_t kCommandQueueFrames = 8;
constexpr size_t kControlTxQueueFrames = 8;
constexpr size_t kMicrophoneTxQueueFrames = 8;
constexpr UBaseType_t kWifiAudioTcpReceivePriority = 5;
constexpr BaseType_t kWifiAudioNetworkCore = 0;
constexpr BaseType_t kWifiAudioI2sCore = 1;
constexpr int kWifiAudioSendTimeoutMs = 200;
// The TX worker owns three roughly 1.5 KiB protocol frames. The optimized
// ESP32-S3 function prologue reserves 0x1220 bytes before nested WebSocket
// calls; a 4 KiB task stack therefore overflows before the worker can run.
// Keep call-path headroom here and verify the remaining margin through the
// existing runtime high-water telemetry during the hardware gate.
constexpr uint32_t kWifiAudioTxTaskStackBytes = 12 * 1024;
static_assert(CONFIG_FREERTOS_NUMBER_OF_CORES >= 2,
              "Wi-Fi Audio requires the ESP32-S3 dual-core scheduler");
constexpr size_t kWifiPhysicalMicrophoneChannel = CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC;
static_assert(kWifiPhysicalMicrophoneChannel <= 1, "CoreS3 only exposes physical MIC1 and MIC2");
constexpr size_t kMaxSpeechBytes = 320;
constexpr uint32_t kManualLedEffectMs = 1500;
constexpr int kVolumeGestureScreenWidth = 320;
constexpr int kVolumeGestureScreenHeight = 240;
constexpr int kVolumeGestureActivationPixels = 8;

struct RgbColor {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
};

constexpr RgbColor kWaitingLed{48, 32, 0};
constexpr RgbColor kListeningLed{0, 48, 0};
constexpr RgbColor kMicrophoneOffLed{24, 24, 24};
constexpr RgbColor kPlayingLed{0, 0, 48};
constexpr RgbColor kFaultLed{48, 0, 0};

#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
constexpr size_t kDiagnosticHeaderBytes = 24;
constexpr size_t kDiagnosticChannels = 4;
constexpr size_t kDiagnosticFramesPerPacket = 120;
constexpr size_t kDiagnosticPayloadBytes =
    kDiagnosticFramesPerPacket * kDiagnosticChannels * sizeof(int16_t);
constexpr size_t kDiagnosticPacketBytes = kDiagnosticHeaderBytes + kDiagnosticPayloadBytes;
constexpr uint8_t kDiagnosticAudioPacket = 1;
constexpr uint8_t kDiagnosticRegisterPacket = 2;
static_assert(kDiagnosticPacketBytes == 984, "diagnostic UDP packet must stay below 1024 bytes");
#endif

AudioCodec* s_codec = nullptr;
std::shared_ptr<WebSocket> s_socket;
std::mutex s_socket_mutex;
std::atomic_uint32_t s_socket_generation{0};
std::atomic_uint32_t s_dock_ready_generation{0};
std::atomic_bool s_ready{false};
std::atomic_bool s_microphone_enabled{true};
#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
std::atomic_bool s_speaker_enabled{false};
#else
std::atomic_bool s_speaker_enabled{true};
#endif
std::atomic_uint32_t s_sequence{1};
std::atomic_uint32_t s_audio_state_revision{1};
std::atomic_uint32_t s_event_sequence{0};
std::atomic_bool s_speaker_playback_active{false};
std::atomic_bool s_voice_reply_active{false};
std::atomic_bool s_half_duplex_speaking{false};
std::atomic_bool s_half_duplex_speaking_requested{false};
std::atomic_int64_t s_speaker_last_frame_us{0};
std::atomic_int64_t s_voice_reply_started_us{0};
std::atomic_int64_t s_voice_reply_ended_us{0};
std::atomic_bool s_led_update_requested{true};
std::atomic_bool s_clear_manual_led_requested{false};
std::mutex s_audio_codec_mutex;
std::mutex s_led_mutex;
std::mutex s_event_mutex;
int s_head_touch_connection = -1;
bool s_manual_led_active = false;
TickType_t s_manual_led_deadline = 0;
RgbColor s_manual_led_color{};

struct SpeakerFrame {
    uint32_t sequence = 0;
    uint32_t generation = 0;
    std::array<int16_t, kSamplesPerFrame> samples{};
};

struct MicrophoneFrame {
    uint32_t sequence = 0;
    uint64_t capture_time_us = 0;
    uint32_t generation = 0;
    uint16_t payload_length = 0;
    std::array<uint8_t, kMicrophonePcmBytes> payload{};
};

struct OutboundFrame {
    uint32_t generation = 0;
    uint16_t length = 0;
    bool binary = false;
    std::array<uint8_t, kMaxWebSocketFrameBytes> data{};
};

struct MicrophoneUdpNegotiation {
    bool valid = false;
    uint32_t socket_generation = 0;
    uint16_t port = 0;
    std::array<char, 256> host{};
    std::array<uint8_t, kMicrophoneUdpSessionBytes> session{};
    std::array<uint8_t, 32> key{};
};

struct MicrophoneUdpSession {
    int socket_fd = -1;
    uint32_t socket_generation = 0;
    sockaddr_in destination{};
    std::array<uint8_t, kMicrophoneUdpSessionBytes> session{};
    std::array<uint8_t, 32> key{};
};

struct CommandFrame {
    uint32_t generation = 0;
    uint16_t length = 0;
    std::array<char, kControlFrameBytes> data{};
};

QueueHandle_t s_speaker_queue = nullptr;
QueueHandle_t s_command_queue = nullptr;
QueueHandle_t s_control_tx_queue = nullptr;
QueueHandle_t s_microphone_tx_queue = nullptr;
TaskHandle_t s_wifi_tx_task_handle = nullptr;
TaskHandle_t s_command_task_handle = nullptr;
TaskHandle_t s_audio_task_handle = nullptr;
TaskHandle_t s_speaker_task_handle = nullptr;
std::atomic_uint32_t s_speaker_received_frames{0};
std::atomic_uint32_t s_speaker_played_frames{0};
std::atomic_uint32_t s_speaker_silence_frames{0};
std::atomic_uint32_t s_speaker_underruns{0};
std::atomic_uint32_t s_speaker_queue_drops{0};
std::atomic_uint32_t s_speaker_backpressure_waits{0};
std::atomic_uint32_t s_speaker_sequence_gaps{0};
std::atomic_uint32_t s_speaker_pipeline_generation{1};
std::atomic_uint32_t s_microphone_captured_chunks{0};
std::atomic_uint32_t s_microphone_captured_frames{0};
std::atomic_uint32_t s_microphone_packetized_frames{0};
std::atomic_uint32_t s_microphone_sent_frames{0};
std::atomic_uint32_t s_microphone_tx_queue_drops{0};
std::atomic_uint32_t s_microphone_flushed_frames{0};
std::atomic_uint32_t s_microphone_send_failures{0};
std::atomic_uint32_t s_microphone_send_retries{0};
std::atomic_uint32_t s_microphone_send_retry_exhausted{0};
std::atomic_int s_microphone_last_send_error{0};
std::atomic_uint32_t s_microphone_max_send_us{0};
std::atomic_uint32_t s_microphone_pipeline_generation{1};
std::atomic_uint32_t s_tx_max_send_us{0};
std::atomic_uint32_t s_tx_slow_sends{0};
std::atomic_uint32_t s_tx_failed_sends{0};
std::atomic_uint32_t s_microphone_udp_sequence{1};
std::mutex s_microphone_udp_mutex;
MicrophoneUdpNegotiation s_microphone_udp_negotiation;
MicrophoneUdpSession s_microphone_udp_session;

#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
int s_diagnostic_socket = -1;
sockaddr_in s_diagnostic_destination{};
std::atomic_uint32_t s_diagnostic_sequence{1};
#endif

enum class TransportState {
    WaitingDockConfiguration,
    WaitingWifiAssociation,
    ConnectingDock,
    DockConnected,
    DockDisconnected,
    ErrorAudioCodec,
    ErrorWebSocket,
};

std::atomic<TransportState> s_transport_state{TransportState::WaitingDockConfiguration};

class WifiAudioVolumeGesture {
public:
    void update()
    {
        lv_indev_t* indev = GetHAL().lvTouchpad;
        if (!indev) return;

        const lv_indev_state_t state = lv_indev_get_state(indev);
        lv_point_t current_point{};
        lv_indev_get_point(indev, &current_point);

        if (state == LV_INDEV_STATE_PR && last_state_ == LV_INDEV_STATE_REL) {
            start_point_ = current_point;
            start_volume_ = GetHAL().getSpeakerVolume();
            current_volume_ = start_volume_;
            tracking_ = true;
            active_ = false;
        } else if (state == LV_INDEV_STATE_PR && tracking_) {
            const int vertical_delta = start_point_.y - current_point.y;
            const int horizontal_delta = std::abs(current_point.x - start_point_.x);
            if (!active_) {
                if (std::abs(vertical_delta) < kVolumeGestureActivationPixels ||
                    std::abs(vertical_delta) < horizontal_delta) {
                    last_state_ = state;
                    return;
                }
                active_ = true;
                create_overlay();
            }

            const int target_volume = std::clamp(
                start_volume_ + vertical_delta * 100 / kVolumeGestureScreenHeight, 0, 100);
            if (target_volume != current_volume_) {
                current_volume_ = target_volume;
                GetHAL().setSpeakerVolume(current_volume_, false);
            }
            render_overlay();
        } else if (state == LV_INDEV_STATE_REL && last_state_ == LV_INDEV_STATE_PR) {
            if (tracking_ && active_) {
                GetHAL().setSpeakerVolume(current_volume_, true);
            }
            destroy_overlay();
            tracking_ = false;
            active_ = false;
        }

        last_state_ = state;
    }

private:
    void create_overlay()
    {
        if (volume_overlay_) return;

        volume_overlay_ = lv_obj_create(lv_screen_active());
        lv_obj_remove_style_all(volume_overlay_);
        lv_obj_set_size(volume_overlay_, kVolumeGestureScreenWidth,
                        kVolumeGestureScreenHeight);
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

    bool tracking_ = false;
    bool active_ = false;
    lv_indev_state_t last_state_ = LV_INDEV_STATE_REL;
    lv_point_t start_point_{};
    int start_volume_ = 0;
    int current_volume_ = 0;
    lv_obj_t* volume_overlay_ = nullptr;
    lv_obj_t* volume_fill_ = nullptr;
};

WifiAudioVolumeGesture s_volume_gesture;

std::shared_ptr<WebSocket> current_socket_for_generation(uint32_t generation)
{
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    return generation != 0 && s_socket_generation.load() == generation ? s_socket : nullptr;
}

uint32_t current_socket_generation(const std::shared_ptr<WebSocket>& expected)
{
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    return s_socket == expected ? s_socket_generation.load() : 0;
}

uint32_t active_socket_generation()
{
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    return s_socket ? s_socket_generation.load() : 0;
}

bool is_current_socket(const std::shared_ptr<WebSocket>& expected)
{
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    return s_socket == expected;
}

uint32_t set_current_socket(std::shared_ptr<WebSocket> socket)
{
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    s_socket = std::move(socket);
    return ++s_socket_generation;
}

void clear_current_socket(const std::shared_ptr<WebSocket>& expected)
{
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    if (s_socket == expected) {
        s_socket.reset();
        ++s_socket_generation;
    }
}

const char* transport_state_name(TransportState state)
{
    switch (state) {
        case TransportState::WaitingDockConfiguration: return "waiting_dock_configuration";
        case TransportState::WaitingWifiAssociation: return "waiting_wifi_association";
        case TransportState::ConnectingDock: return "connecting_dock";
        case TransportState::DockConnected: return "dock_connected";
        case TransportState::DockDisconnected: return "dock_disconnected";
        case TransportState::ErrorAudioCodec: return "error_audio_codec";
        case TransportState::ErrorWebSocket: return "error_websocket";
    }
    return "error_unknown";
}

bool transport_state_is_fault(TransportState state)
{
    return state == TransportState::ErrorAudioCodec || state == TransportState::ErrorWebSocket;
}

RgbColor wifi_audio_status_led_color()
{
    const TransportState state = s_transport_state.load();
    if (transport_state_is_fault(state)) return kFaultLed;
    if (s_half_duplex_speaking.load()) return kPlayingLed;
    if (state != TransportState::DockConnected || !s_ready.load()) return kWaitingLed;
    return s_microphone_enabled.load() ? kListeningLed : kMicrophoneOffLed;
}

void apply_led_color(const RgbColor& color)
{
    LvglLockGuard lock;
    GetStackChan().leftNeonLight().snapColor(color.red, color.green, color.blue);
    GetStackChan().rightNeonLight().snapColor(color.red, color.green, color.blue);
}

void request_wifi_audio_status_led(bool clear_manual = false)
{
    if (clear_manual) s_clear_manual_led_requested = true;
    s_led_update_requested = true;
}

void show_temporary_led(const RgbColor& color)
{
    std::lock_guard<std::mutex> lock(s_led_mutex);
    s_manual_led_active = true;
    s_manual_led_deadline = xTaskGetTickCount() + pdMS_TO_TICKS(kManualLedEffectMs);
    s_manual_led_color = color;
    s_led_update_requested = true;
}

void service_wifi_audio_status_led()
{
    RgbColor color{};
    bool should_apply = s_led_update_requested.exchange(false);
    {
        std::lock_guard<std::mutex> lock(s_led_mutex);
        const bool fault = transport_state_is_fault(s_transport_state.load());
        const bool clear_manual = s_clear_manual_led_requested.exchange(false);
        const bool manual_expired = s_manual_led_active &&
            static_cast<int32_t>(xTaskGetTickCount() - s_manual_led_deadline) >= 0;
        if (clear_manual || fault || manual_expired) s_manual_led_active = false;
        should_apply = should_apply || clear_manual || fault || manual_expired;
        if (!should_apply) return;
        color = s_manual_led_active ? s_manual_led_color : wifi_audio_status_led_color();
    }
    // Only this low-priority worker may wait for LVGL. TCP receive and both
    // real-time audio workers only publish atomic LED state requests.
    apply_led_color(color);
}

void led_restore_task(void*)
{
    while (true) {
        service_wifi_audio_status_led();
        vTaskDelay(pdMS_TO_TICKS(25));
    }
}

void set_transport_state(TransportState state)
{
    s_transport_state = state;
    request_wifi_audio_status_led();
}

void clear_microphone_udp_session();
bool microphone_udp_session_ready(uint32_t socket_generation);

void discard_queued_microphone_frames()
{
    uint32_t discarded_frames = 0;
    if (s_microphone_tx_queue) {
        MicrophoneFrame discarded_pcm;
        while (xQueueReceive(s_microphone_tx_queue, &discarded_pcm, 0) == pdTRUE) {
            ++discarded_frames;
        }
    }
    s_microphone_pipeline_generation.fetch_add(1);
    if (discarded_frames > 0) s_microphone_flushed_frames.fetch_add(discarded_frames);
}

#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
void discard_queued_speaker_frames()
{
    // Invalidate blocked producers before resetting the queue. FreeRTOS may
    // wake one blocked sender from xQueueReset(); its old frame is harmless
    // because both enqueue completion and playback recheck this generation.
    s_speaker_pipeline_generation.fetch_add(1);
    if (s_speaker_queue) xQueueReset(s_speaker_queue);
}

bool speaker_frame_is_current(uint32_t generation)
{
    return generation == s_speaker_pipeline_generation.load() &&
           s_ready.load() && s_speaker_enabled.load();
}
#endif

void set_ready(bool ready)
{
    if (!ready) {
        s_ready = false;
        clear_microphone_udp_session();
        discard_queued_microphone_frames();
#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
        discard_queued_speaker_frames();
#endif
    } else {
        s_ready = true;
        if (s_wifi_tx_task_handle) xTaskNotifyGive(s_wifi_tx_task_handle);
    }
    request_wifi_audio_status_led();
}

bool commit_ready_for_socket(const std::shared_ptr<WebSocket>& expected, uint32_t generation)
{
    // Serialize the last owner check with publication. A disconnect callback
    // either observes ready and clears it afterwards, or completes first and
    // makes this commit fail; it cannot slip between those two operations.
    std::lock_guard<std::mutex> lock(s_socket_mutex);
    if (!expected || s_socket != expected ||
        s_socket_generation.load() != generation ||
        s_dock_ready_generation.load() != generation ||
        !microphone_udp_session_ready(generation) ||
        !expected->IsConnected()) {
        return false;
    }
    set_ready(true);
    return true;
}

void set_speaker_playback_active(bool active)
{
    if (s_speaker_playback_active.exchange(active) != active) {
        request_wifi_audio_status_led();
    }
}

bool apply_half_duplex_codec_mode(bool speaking)
{
    if (!s_codec) return false;
    auto* codec = static_cast<CoreS3AudioCodec*>(s_codec);
    const CoreS3AudioCodec::WifiAudioMode target = speaking
        ? CoreS3AudioCodec::WifiAudioMode::Speaking
        : (s_microphone_enabled.load()
            ? CoreS3AudioCodec::WifiAudioMode::Listening
            : CoreS3AudioCodec::WifiAudioMode::Idle);
    if (codec->SetWifiAudioMode(target)) return true;

    ESP_LOGE(TAG,
             "failed to apply half-duplex codec mode requested=%s actual=%s error=%d failures=%lu",
             speaking ? "speaking" : "listening", codec->wifi_audio_mode_name(),
             codec->last_transition_error(),
             static_cast<unsigned long>(codec->transition_failures()));
    set_transport_state(TransportState::ErrorAudioCodec);
    set_ready(false);
    return false;
}

void set_half_duplex_speaking(bool requested)
{
    requested = requested && s_speaker_enabled.load();
    s_half_duplex_speaking_requested = requested;
    // Gate new microphone reads before waiting for an in-flight 10 ms read.
    if (requested) {
        s_half_duplex_speaking = true;
        discard_queued_microphone_frames();
    }

    bool applied = false;
    {
        std::lock_guard<std::mutex> lock(s_audio_codec_mutex);
        const bool speaking = s_half_duplex_speaking_requested.load() &&
                              s_speaker_enabled.load();
        if (s_codec) {
            if (!apply_half_duplex_codec_mode(speaking)) {
                s_half_duplex_speaking = false;
                request_wifi_audio_status_led(true);
                return;
            }
        }
        applied = s_half_duplex_speaking.exchange(speaking) != speaking;
    }
    if (applied) request_wifi_audio_status_led(true);
}

void set_voice_reply_active(bool active)
{
    s_voice_reply_active = active;
    if (active) {
        s_voice_reply_started_us = esp_timer_get_time();
        s_voice_reply_ended_us = 0;
        set_half_duplex_speaking(true);
    } else {
        s_voice_reply_ended_us = esp_timer_get_time();
    }
    request_wifi_audio_status_led();
}

void write_u16be(uint8_t* out, uint16_t value) { out[0] = value >> 8; out[1] = value; }
void write_u32be(uint8_t* out, uint32_t value) { for (int i = 3; i >= 0; --i) out[3 - i] = value >> (i * 8); }
void write_u64be(uint8_t* out, uint64_t value) { for (int i = 7; i >= 0; --i) out[7 - i] = value >> (i * 8); }
uint16_t read_u16be(const uint8_t* in) { return (uint16_t(in[0]) << 8) | in[1]; }
uint32_t read_u32be(const uint8_t* in) {
    return (uint32_t(in[0]) << 24) | (uint32_t(in[1]) << 16) | (uint32_t(in[2]) << 8) | in[3];
}

void notify_wifi_tx_task();

#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
bool configure_diagnostic_udp(const std::string& dock_url)
{
    const size_t scheme_end = dock_url.find("://");
    if (scheme_end == std::string::npos) return false;
    const size_t host_begin = scheme_end + 3;
    const size_t host_end = dock_url.find_first_of(":/", host_begin);
    const std::string host = dock_url.substr(host_begin, host_end - host_begin);
    if (host.empty()) return false;

    sockaddr_in destination{};
    destination.sin_family = AF_INET;
    destination.sin_port = htons(CONFIG_STACKCHAN_WIFI_AUDIO_DIAGNOSTIC_UDP_PORT);
    if (inet_pton(AF_INET, host.c_str(), &destination.sin_addr) != 1) {
        ESP_LOGE(TAG, "RX4 diagnostic requires an IPv4 Dock URL");
        return false;
    }

    if (s_diagnostic_socket >= 0) {
        close(s_diagnostic_socket);
        s_diagnostic_socket = -1;
    }
    s_diagnostic_socket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s_diagnostic_socket < 0) {
        ESP_LOGE(TAG, "failed to create RX4 diagnostic UDP socket");
        return false;
    }
    s_diagnostic_destination = destination;
    ESP_LOGI(TAG, "RX4 diagnostic UDP enabled on port %d", CONFIG_STACKCHAN_WIFI_AUDIO_DIAGNOSTIC_UDP_PORT);
    return true;
}

void initialize_diagnostic_header(uint8_t* packet, uint8_t type, uint32_t sequence,
                                  uint16_t frames, uint16_t payload_bytes)
{
    std::memcpy(packet, "SC4D", 4);
    packet[4] = 1;
    packet[5] = type;
    packet[6] = kDiagnosticChannels;
    packet[7] = sizeof(int16_t);
    write_u32be(packet + 8, sequence);
    write_u64be(packet + 12, esp_timer_get_time());
    write_u16be(packet + 20, frames);
    write_u16be(packet + 22, payload_bytes);
}

bool send_diagnostic_packet(const uint8_t* packet, size_t length)
{
    if (s_diagnostic_socket < 0) return false;
    const int sent = sendto(s_diagnostic_socket, packet, length, MSG_DONTWAIT,
                            reinterpret_cast<const sockaddr*>(&s_diagnostic_destination),
                            sizeof(s_diagnostic_destination));
    static uint32_t failures = 0;
    if (sent != static_cast<int>(length)) {
        ++failures;
        if (failures == 1 || failures % 500 == 0) {
            ESP_LOGE(TAG, "RX4-UDP send failure=%lu expected=%u actual=%d",
                     static_cast<unsigned long>(failures), static_cast<unsigned>(length), sent);
        }
        return false;
    }
    return true;
}

void send_diagnostic_audio(const int16_t* interleaved, size_t frames)
{
    if (frames != kDiagnosticFramesPerPacket * 2) return;
    std::array<uint8_t, kDiagnosticPacketBytes> packet{};
    for (size_t half = 0; half < 2; ++half) {
        const uint32_t sequence = s_diagnostic_sequence.fetch_add(1);
        initialize_diagnostic_header(packet.data(), kDiagnosticAudioPacket, sequence,
                                     kDiagnosticFramesPerPacket, kDiagnosticPayloadBytes);
        std::memcpy(packet.data() + kDiagnosticHeaderBytes,
                    interleaved + half * kDiagnosticFramesPerPacket * kDiagnosticChannels,
                    kDiagnosticPayloadBytes);
        send_diagnostic_packet(packet.data(), packet.size());
    }
}

void send_diagnostic_registers()
{
    static constexpr uint8_t registers[] = {
        0x00, 0x01, 0x02, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x11, 0x12, 0x40, 0x43, 0x44, 0x45, 0x46, 0x4B, 0x4C,
    };
    auto* codec = static_cast<CoreS3AudioCodec*>(s_codec);
    std::array<uint8_t, kDiagnosticHeaderBytes + sizeof(registers) * 2> packet{};
    size_t payload_bytes = 0;
    for (const uint8_t reg : registers) {
        int value = 0;
        if (codec && codec->ReadInputRegister(reg, &value)) {
            packet[kDiagnosticHeaderBytes + payload_bytes++] = reg;
            packet[kDiagnosticHeaderBytes + payload_bytes++] = value & 0xff;
        }
    }
    initialize_diagnostic_header(packet.data(), kDiagnosticRegisterPacket,
                                 s_diagnostic_sequence.load(), 0,
                                 static_cast<uint16_t>(payload_bytes));
    send_diagnostic_packet(packet.data(), kDiagnosticHeaderBytes + payload_bytes);
}
#endif

std::string mac_device_id()
{
    uint8_t mac[6]{};
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_EFUSE_FACTORY));
    char id[24]{};
    std::snprintf(id, sizeof(id), "stackchan-%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return id;
}

std::string random_nonce()
{
    char nonce[33]{};
    for (size_t i = 0; i < 16; ++i) {
        std::snprintf(nonce + i * 2, 3, "%02x", static_cast<unsigned>(esp_random() & 0xff));
    }
    return nonce;
}

bool hmac_sha256(const uint8_t* key, size_t key_length, const uint8_t* data, size_t data_length,
                 std::array<uint8_t, 32>& digest)
{
    const mbedtls_md_info_t* md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    return md && mbedtls_md_hmac(md, key, key_length, data, data_length, digest.data()) == 0;
}

std::string hmac_hex(const std::string& key, const std::string& value)
{
    std::array<uint8_t, 32> digest{};
    if (!hmac_sha256(reinterpret_cast<const uint8_t*>(key.data()), key.size(),
                     reinterpret_cast<const uint8_t*>(value.data()), value.size(), digest)) return {};
    char hex[65]{};
    for (size_t i = 0; i < digest.size(); ++i) std::snprintf(hex + i * 2, 3, "%02x", digest[i]);
    return hex;
}

int hex_nibble(char value)
{
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

bool parse_hex_exact(const char* value, uint8_t* output, size_t output_bytes)
{
    if (!value || std::strlen(value) != output_bytes * 2) return false;
    for (size_t index = 0; index < output_bytes; ++index) {
        const int high = hex_nibble(value[index * 2]);
        const int low = hex_nibble(value[index * 2 + 1]);
        if (high < 0 || low < 0) return false;
        output[index] = static_cast<uint8_t>((high << 4) | low);
    }
    return true;
}

bool extract_dock_host(const std::string& dock_url, std::string& host)
{
    const size_t scheme_end = dock_url.find("://");
    if (scheme_end == std::string::npos) return false;
    const size_t host_begin = scheme_end + 3;
    const size_t authority_end = dock_url.find('/', host_begin);
    const size_t authority_length = (authority_end == std::string::npos ? dock_url.size() : authority_end) - host_begin;
    std::string authority = dock_url.substr(host_begin, authority_length);
    if (authority.empty() || authority.find('@') != std::string::npos) return false;
    if (authority.front() == '[') {
        const size_t bracket = authority.find(']');
        if (bracket == std::string::npos) return false;
        host = authority.substr(1, bracket - 1);
    } else {
        const size_t colon = authority.rfind(':');
        host = authority.substr(0, colon);
    }
    return !host.empty() && host.size() < 256;
}

void clear_microphone_udp_session()
{
    std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);
    s_microphone_udp_negotiation = {};
    if (s_microphone_udp_session.socket_fd >= 0) close(s_microphone_udp_session.socket_fd);
    s_microphone_udp_session = {};
    s_microphone_udp_session.socket_fd = -1;
}

bool microphone_udp_session_ready(uint32_t socket_generation)
{
    std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);
    return socket_generation != 0 && s_microphone_udp_session.socket_fd >= 0 &&
           s_microphone_udp_session.socket_generation == socket_generation;
}

bool stage_microphone_udp_negotiation(const std::string& dock_url, const std::string& pairing_key,
                                      const std::string& device_id, const std::string& nonce,
                                      cJSON* transport, uint32_t socket_generation)
{
    cJSON* transport_type = transport ? cJSON_GetObjectItemCaseSensitive(transport, "type") : nullptr;
    cJSON* port = transport ? cJSON_GetObjectItemCaseSensitive(transport, "port") : nullptr;
    cJSON* session = transport ? cJSON_GetObjectItemCaseSensitive(transport, "session") : nullptr;
    cJSON* proof = transport ? cJSON_GetObjectItemCaseSensitive(transport, "proof") : nullptr;
    if (!cJSON_IsString(transport_type) || std::strcmp(transport_type->valuestring, "udp") != 0 ||
        !cJSON_IsNumber(port) || port->valuedouble != port->valueint ||
        port->valueint < 1 || port->valueint > 65535 ||
        !cJSON_IsString(session) || !cJSON_IsString(proof)) return false;

    MicrophoneUdpNegotiation negotiation;
    negotiation.socket_generation = socket_generation;
    negotiation.port = static_cast<uint16_t>(port->valueint);
    std::string dock_host;
    if (!extract_dock_host(dock_url, dock_host) ||
        !parse_hex_exact(session->valuestring, negotiation.session.data(), negotiation.session.size())) {
        return false;
    }
    std::memcpy(negotiation.host.data(), dock_host.c_str(), dock_host.size() + 1);

    const std::string session_hex(session->valuestring);
    const std::string proof_input = std::string(kMicrophoneUdpReadyLabel) + "\n" + device_id + "\n" +
                                    nonce + "\n" + std::to_string(port->valueint) + "\n" + session_hex;
    std::array<uint8_t, 32> expected_proof{};
    std::array<uint8_t, 32> actual_proof{};
    if (!hmac_sha256(reinterpret_cast<const uint8_t*>(pairing_key.data()), pairing_key.size(),
                     reinterpret_cast<const uint8_t*>(proof_input.data()), proof_input.size(), expected_proof) ||
        !parse_hex_exact(proof->valuestring, actual_proof.data(), actual_proof.size())) return false;
    uint8_t proof_difference = 0;
    for (size_t index = 0; index < expected_proof.size(); ++index) {
        proof_difference |= expected_proof[index] ^ actual_proof[index];
    }
    if (proof_difference != 0) return false;

    std::vector<uint8_t> key_input;
    key_input.reserve(sizeof(kMicrophoneUdpKeyLabel) - 1 + device_id.size() + nonce.size() +
                      negotiation.session.size() + 2);
    key_input.insert(key_input.end(), kMicrophoneUdpKeyLabel,
                     kMicrophoneUdpKeyLabel + sizeof(kMicrophoneUdpKeyLabel) - 1);
    key_input.insert(key_input.end(), device_id.begin(), device_id.end());
    key_input.push_back('\n');
    key_input.insert(key_input.end(), nonce.begin(), nonce.end());
    key_input.push_back('\n');
    key_input.insert(key_input.end(), negotiation.session.begin(), negotiation.session.end());
    if (!hmac_sha256(reinterpret_cast<const uint8_t*>(pairing_key.data()), pairing_key.size(),
                     key_input.data(), key_input.size(), negotiation.key)) return false;
    negotiation.valid = true;

    std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);
    s_microphone_udp_negotiation = negotiation;
    return true;
}

bool activate_microphone_udp_session(uint32_t socket_generation)
{
    MicrophoneUdpNegotiation negotiation;
    {
        std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);
        if (!s_microphone_udp_negotiation.valid ||
            s_microphone_udp_negotiation.socket_generation != socket_generation) return false;
        negotiation = s_microphone_udp_negotiation;
    }
    addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    hints.ai_protocol = IPPROTO_UDP;
    addrinfo* addresses = nullptr;
    const std::string service = std::to_string(negotiation.port);
    const int resolve_result = getaddrinfo(negotiation.host.data(), service.c_str(), &hints, &addresses);
    if (resolve_result != 0 || !addresses || addresses->ai_addrlen < sizeof(sockaddr_in)) {
        if (addresses) freeaddrinfo(addresses);
        ESP_LOGE(TAG, "failed to resolve UDP Dock host=%s result=%d", negotiation.host.data(), resolve_result);
        return false;
    }
    const sockaddr_in destination = *reinterpret_cast<const sockaddr_in*>(addresses->ai_addr);
    freeaddrinfo(addresses);
    const int socket_fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (socket_fd < 0) return false;

    std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);
    if (!s_microphone_udp_negotiation.valid ||
        s_microphone_udp_negotiation.socket_generation != socket_generation ||
        s_microphone_udp_negotiation.session != negotiation.session) {
        close(socket_fd);
        return false;
    }
    if (s_microphone_udp_session.socket_fd >= 0) close(s_microphone_udp_session.socket_fd);
    s_microphone_udp_session.socket_fd = socket_fd;
    s_microphone_udp_session.socket_generation = socket_generation;
    s_microphone_udp_session.destination = destination;
    s_microphone_udp_session.session = negotiation.session;
    s_microphone_udp_session.key = negotiation.key;
    s_microphone_udp_sequence.store(1);
    s_microphone_udp_negotiation = {};
    return true;
}

bool send_microphone_udp(const MicrophoneFrame& frame)
{
    if (frame.payload_length != kMicrophonePcmBytes) {
        s_microphone_send_failures.fetch_add(1);
        ESP_LOGE(TAG, "invalid UDP PCM payload bytes=%u expected=%u",
                 static_cast<unsigned>(frame.payload_length),
                 static_cast<unsigned>(kMicrophonePcmBytes));
        return false;
    }
    if (frame.generation != s_microphone_pipeline_generation.load() || !s_ready.load() ||
        !s_microphone_enabled.load() || s_half_duplex_speaking.load()) {
        s_microphone_flushed_frames.fetch_add(1);
        return false;
    }

    std::array<uint8_t, kMicrophoneUdpMaxPacketBytes> packet{};
    const size_t authenticated_bytes = kMicrophoneUdpHeaderBytes + frame.payload_length;
    const size_t packet_bytes = authenticated_bytes + kMicrophoneUdpTagBytes;
    std::memcpy(packet.data(), kMicrophoneUdpMagic, 4);
    packet[4] = kProtocolVersion;
    packet[5] = kMicrophonePcmFrameFlag;
    write_u64be(packet.data() + 10, frame.capture_time_us);
    write_u16be(packet.data() + 18, frame.payload_length);

    const uint32_t socket_generation = active_socket_generation();
    std::lock_guard<std::mutex> lock(s_microphone_udp_mutex);
    if (s_microphone_udp_session.socket_fd < 0 ||
        s_microphone_udp_session.socket_generation != socket_generation ||
        frame.generation != s_microphone_pipeline_generation.load() || !s_ready.load() ||
        !s_microphone_enabled.load() || s_half_duplex_speaking.load()) {
        s_microphone_flushed_frames.fetch_add(1);
        return false;
    }
    uint32_t wire_sequence = s_microphone_udp_sequence.fetch_add(1);
    if (wire_sequence == 0) {
        wire_sequence = 1;
        s_microphone_udp_sequence.store(2);
    }
    write_u32be(packet.data() + 6, wire_sequence);
    std::memcpy(packet.data() + 20, s_microphone_udp_session.session.data(),
                s_microphone_udp_session.session.size());
    std::memcpy(packet.data() + kMicrophoneUdpHeaderBytes, frame.payload.data(), frame.payload_length);
    std::array<uint8_t, 32> digest{};
    if (!hmac_sha256(s_microphone_udp_session.key.data(), s_microphone_udp_session.key.size(),
                     packet.data(), authenticated_bytes, digest)) {
        s_microphone_send_failures.fetch_add(1);
        return false;
    }
    std::memcpy(packet.data() + authenticated_bytes, digest.data(), kMicrophoneUdpTagBytes);

    int sent = -1;
    int send_error = 0;
    size_t attempts = 0;
    for (size_t attempt = 0; attempt < kMicrophoneUdpMaxSendAttempts; ++attempt) {
        attempts = attempt + 1;
        if (attempt > 0) {
            vTaskDelay(kMicrophoneUdpRetryDelayTicks);
            if (s_microphone_udp_session.socket_fd < 0 ||
                s_microphone_udp_session.socket_generation != socket_generation ||
                s_socket_generation.load() != socket_generation ||
                frame.generation != s_microphone_pipeline_generation.load() || !s_ready.load() ||
                !s_microphone_enabled.load() || s_half_duplex_speaking.load()) {
                s_microphone_flushed_frames.fetch_add(1);
                return false;
            }
            s_microphone_send_retries.fetch_add(1);
        }

        const int64_t attempt_started_us = esp_timer_get_time();
        sent = sendto(s_microphone_udp_session.socket_fd, packet.data(), packet_bytes,
                      MSG_DONTWAIT,
                      reinterpret_cast<const sockaddr*>(&s_microphone_udp_session.destination),
                      sizeof(s_microphone_udp_session.destination));
        send_error = sent == static_cast<int>(packet_bytes) ? 0 : errno;
        const uint32_t elapsed_us = static_cast<uint32_t>(
            std::min<int64_t>(esp_timer_get_time() - attempt_started_us, UINT32_MAX));
        uint32_t previous_max = s_microphone_max_send_us.load();
        while (previous_max < elapsed_us &&
               !s_microphone_max_send_us.compare_exchange_weak(previous_max, elapsed_us)) {}

        if (send_error == 0) break;
        s_microphone_last_send_error.store(send_error);
        if (send_error != ENOMEM || attempt + 1 >= kMicrophoneUdpMaxSendAttempts) break;
    }
    if (sent != static_cast<int>(packet_bytes)) {
        if (send_error == ENOMEM && attempts == kMicrophoneUdpMaxSendAttempts) {
            s_microphone_send_retry_exhausted.fetch_add(1);
        }
        const uint32_t failures = s_microphone_send_failures.fetch_add(1) + 1;
        s_tx_failed_sends.fetch_add(1);
        if (failures == 1 || failures % 500 == 0) {
            ESP_LOGW(TAG, "UDP microphone send dropped frame=%lu bytes=%u actual=%d errno=%d failures=%lu",
                     static_cast<unsigned long>(wire_sequence), static_cast<unsigned>(packet_bytes),
                     sent, send_error, static_cast<unsigned long>(failures));
        }
        return false;
    }
    s_microphone_sent_frames.fetch_add(1);
    return true;
}

void reset_protocol_queues_for_new_socket()
{
    clear_microphone_udp_session();
    if (s_command_queue) xQueueReset(s_command_queue);
    if (s_control_tx_queue) xQueueReset(s_control_tx_queue);
    if (s_microphone_tx_queue) xQueueReset(s_microphone_tx_queue);
    s_microphone_pipeline_generation.fetch_add(1);
    s_sequence.store(1);
    s_dock_ready_generation.store(0);
}

void notify_wifi_tx_task()
{
    if (s_wifi_tx_task_handle) xTaskNotifyGive(s_wifi_tx_task_handle);
}

bool enqueue_outbound_frame(QueueHandle_t queue, uint32_t generation, bool binary,
                            const void* data, size_t length, bool high_priority = false)
{
    if (!queue || generation == 0 || !data || length == 0 || length > kControlFrameBytes) return false;
    OutboundFrame outbound;
    outbound.generation = generation;
    outbound.length = static_cast<uint16_t>(length);
    outbound.binary = binary;
    std::memcpy(outbound.data.data(), data, length);
    BaseType_t queued = high_priority ? xQueueSendToFront(queue, &outbound, 0)
                                      : xQueueSend(queue, &outbound, 0);
    if (high_priority && queued != pdTRUE) {
        // A new connection's hello must not be rejected by touch/volume events
        // produced during the handshake. Evict one oldest control frame and
        // reserve the front slot for the generation-defining hello.
        OutboundFrame discarded;
        if (xQueueReceive(queue, &discarded, 0) == pdTRUE) {
            queued = xQueueSendToFront(queue, &outbound, 0);
        }
    }
    if (queued == pdTRUE) notify_wifi_tx_task();
    return queued == pdTRUE;
}

bool queue_json_for_generation(uint32_t generation, cJSON* object, bool high_priority = false)
{
    if (!object) return false;
    char* payload = cJSON_PrintUnformatted(object);
    cJSON_Delete(object);
    if (!payload) return false;
    const size_t length = std::strlen(payload);
    const bool queued = enqueue_outbound_frame(
        s_control_tx_queue, generation, false, payload, length, high_priority);
    cJSON_free(payload);
    return queued;
}

bool send_json_direct_to_socket(const std::shared_ptr<WebSocket>& socket, cJSON* object)
{
    if (!object) return false;
    char* payload = cJSON_PrintUnformatted(object);
    cJSON_Delete(object);
    if (!payload) return false;
    const bool sent = socket && socket->IsConnected() && socket->Send(payload);
    cJSON_free(payload);
    return sent;
}

void send_error(uint32_t generation, int id, const char* code, const char* message)
{
    cJSON* response = cJSON_CreateObject();
    cJSON_AddNumberToObject(response, "v", kProtocolVersion); cJSON_AddNumberToObject(response, "id", id); cJSON_AddBoolToObject(response, "ok", false);
    cJSON* error = cJSON_AddObjectToObject(response, "error"); cJSON_AddStringToObject(error, "code", code); cJSON_AddStringToObject(error, "message", message);
    if (!queue_json_for_generation(generation, response)) ESP_LOGW(TAG, "dropped control error response id=%d", id);
}
void send_result(uint32_t generation, int id, cJSON* result)
{
    cJSON* response = cJSON_CreateObject();
    cJSON_AddNumberToObject(response, "v", kProtocolVersion); cJSON_AddNumberToObject(response, "id", id); cJSON_AddBoolToObject(response, "ok", true);
    cJSON_AddItemToObject(response, "result", result ? result : cJSON_CreateObject());
    if (!queue_json_for_generation(generation, response)) ESP_LOGW(TAG, "dropped control result response id=%d", id);
}
bool read_bool(cJSON* args, const char* key, bool* value) { cJSON* item = cJSON_GetObjectItemCaseSensitive(args, key); if (!cJSON_IsBool(item)) return false; *value = cJSON_IsTrue(item); return true; }
bool read_int(cJSON* args, const char* key, int min, int max, int* value) { cJSON* item = cJSON_GetObjectItemCaseSensitive(args, key); if (!cJSON_IsNumber(item) || item->valuedouble != item->valueint || item->valueint < min || item->valueint > max) return false; *value = item->valueint; return true; }

void log_runtime_health()
{
    ESP_LOGI(TAG,
             "runtime health heap_free=%u heap_min=%u stack_free_words tx=%u cmd=%u mic=%u speaker=%u",
             static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_8BIT)),
             static_cast<unsigned>(heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT)),
             static_cast<unsigned>(s_wifi_tx_task_handle ? uxTaskGetStackHighWaterMark(s_wifi_tx_task_handle) : 0),
             static_cast<unsigned>(s_command_task_handle ? uxTaskGetStackHighWaterMark(s_command_task_handle) : 0),
             static_cast<unsigned>(s_audio_task_handle ? uxTaskGetStackHighWaterMark(s_audio_task_handle) : 0),
             static_cast<unsigned>(s_speaker_task_handle ? uxTaskGetStackHighWaterMark(s_speaker_task_handle) : 0));
}

cJSON* runtime_state()
{
    cJSON* result = cJSON_CreateObject();
    cJSON_AddNumberToObject(result, "heap_free_bytes",
                            heap_caps_get_free_size(MALLOC_CAP_8BIT));
    cJSON_AddNumberToObject(result, "heap_min_bytes",
                            heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT));
    cJSON* stacks = cJSON_AddObjectToObject(result, "stack_free_words");
    cJSON_AddNumberToObject(stacks, "tx",
                            s_wifi_tx_task_handle ? uxTaskGetStackHighWaterMark(s_wifi_tx_task_handle) : 0);
    cJSON_AddNumberToObject(stacks, "cmd",
                            s_command_task_handle ? uxTaskGetStackHighWaterMark(s_command_task_handle) : 0);
    cJSON_AddNumberToObject(stacks, "mic",
                            s_audio_task_handle ? uxTaskGetStackHighWaterMark(s_audio_task_handle) : 0);
    cJSON_AddNumberToObject(stacks, "speaker",
                            s_speaker_task_handle ? uxTaskGetStackHighWaterMark(s_speaker_task_handle) : 0);
    cJSON* tx = cJSON_AddObjectToObject(result, "tx");
    cJSON_AddNumberToObject(tx, "max_send_us", s_tx_max_send_us.load());
    cJSON_AddNumberToObject(tx, "slow_sends", s_tx_slow_sends.load());
    cJSON_AddNumberToObject(tx, "failed_sends", s_tx_failed_sends.load());
    cJSON* cores = cJSON_AddObjectToObject(result, "worker_cores");
    cJSON_AddNumberToObject(cores, "tx", kWifiAudioNetworkCore);
    cJSON_AddNumberToObject(cores, "mic", kWifiAudioI2sCore);
    cJSON_AddNumberToObject(cores, "speaker", kWifiAudioI2sCore);
    return result;
}

cJSON* audio_state()
{
    cJSON* result = cJSON_CreateObject();
    const bool speaking = s_half_duplex_speaking.load();
    cJSON_AddStringToObject(result, "duplex_mode", "half");
    cJSON_AddStringToObject(result, "phase", speaking ? "speaking" : "listening");
    cJSON_AddBoolToObject(result, "microphone_enabled", s_microphone_enabled.load());
    cJSON_AddBoolToObject(result, "microphone_active",
                          s_microphone_enabled.load() && !speaking);
    cJSON_AddBoolToObject(result, "speaker_enabled", s_speaker_enabled.load());
    cJSON_AddBoolToObject(result, "speaker_active",
                          s_speaker_enabled.load() && speaking);
    cJSON_AddBoolToObject(result, "voice_reply_active", s_voice_reply_active.load());
    cJSON_AddNumberToObject(result, "revision", s_audio_state_revision.load());
    if (s_codec) {
        auto* codec = static_cast<CoreS3AudioCodec*>(s_codec);
        cJSON* i2s = cJSON_AddObjectToObject(result, "i2s_owner");
        cJSON_AddStringToObject(i2s, "mode", codec->wifi_audio_mode_name());
        cJSON_AddNumberToObject(i2s, "transition_failures", codec->transition_failures());
        cJSON_AddNumberToObject(i2s, "last_error", codec->last_transition_error());
        cJSON_AddNumberToObject(i2s, "read_successes", codec->read_successes());
        cJSON_AddNumberToObject(i2s, "read_failures", codec->read_failures());
        cJSON_AddNumberToObject(i2s, "last_read_error", codec->last_read_error());
    }
    cJSON* microphone = cJSON_AddObjectToObject(result, "microphone_stats");
    cJSON_AddStringToObject(microphone, "transport", "udp_pcm_s16le_hmac");
    cJSON_AddNumberToObject(microphone, "captured_chunks_10ms", s_microphone_captured_chunks.load());
    cJSON_AddNumberToObject(microphone, "captured_frames", s_microphone_captured_frames.load());
    cJSON_AddNumberToObject(microphone, "packetized_frames", s_microphone_packetized_frames.load());
    cJSON_AddNumberToObject(microphone, "sent_frames", s_microphone_sent_frames.load());
    cJSON_AddNumberToObject(microphone, "queue_drops",
                            s_microphone_tx_queue_drops.load());
    cJSON_AddNumberToObject(microphone, "tx_queue_drops", s_microphone_tx_queue_drops.load());
    cJSON_AddNumberToObject(microphone, "flushed_frames", s_microphone_flushed_frames.load());
    cJSON_AddNumberToObject(microphone, "queued_frames",
                            s_microphone_tx_queue ? uxQueueMessagesWaiting(s_microphone_tx_queue) : 0);
    cJSON_AddNumberToObject(microphone, "send_failures", s_microphone_send_failures.load());
    cJSON_AddNumberToObject(microphone, "send_retries", s_microphone_send_retries.load());
    cJSON_AddNumberToObject(microphone, "retry_exhausted",
                            s_microphone_send_retry_exhausted.load());
    cJSON_AddNumberToObject(microphone, "last_send_error", s_microphone_last_send_error.load());
    cJSON_AddNumberToObject(microphone, "max_send_us", s_microphone_max_send_us.load());
#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    cJSON* speaker = cJSON_AddObjectToObject(result, "speaker_stats");
    cJSON_AddNumberToObject(speaker, "received_frames", s_speaker_received_frames.load());
    cJSON_AddNumberToObject(speaker, "played_frames", s_speaker_played_frames.load());
    cJSON_AddNumberToObject(speaker, "silence_frames", s_speaker_silence_frames.load());
    cJSON_AddNumberToObject(speaker, "underruns", s_speaker_underruns.load());
    cJSON_AddNumberToObject(speaker, "queue_drops", s_speaker_queue_drops.load());
    cJSON_AddNumberToObject(speaker, "backpressure_waits",
                            s_speaker_backpressure_waits.load());
    cJSON_AddNumberToObject(speaker, "sequence_gaps", s_speaker_sequence_gaps.load());
#endif
    return result;
}

const char* gesture_name(HeadPetGesture gesture)
{
    switch (gesture) {
        case HeadPetGesture::Press: return "press";
        case HeadPetGesture::Release: return "release";
        case HeadPetGesture::SwipeForward: return "swipe_forward";
        case HeadPetGesture::SwipeBackward: return "swipe_backward";
        case HeadPetGesture::None:
        default: return "none";
    }
}

void emit_event(const char* name, cJSON* data, uint32_t generation = 0)
{
    std::lock_guard<std::mutex> lock(s_event_mutex);
    cJSON* event = cJSON_CreateObject();
    cJSON_AddNumberToObject(event, "v", kProtocolVersion);
    cJSON_AddNumberToObject(event, "seq", ++s_event_sequence);
    cJSON_AddStringToObject(event, "event", name);
    cJSON_AddItemToObject(event, "data", data ? data : cJSON_CreateObject());
    if (generation == 0) generation = active_socket_generation();
    if (!queue_json_for_generation(generation, event)) {
        ESP_LOGW(TAG, "dropped event %s because the Wi-Fi control queue is full", name);
    }
}

void emit_audio_state(const char* source, uint32_t generation = 0)
{
    cJSON* data = audio_state();
    cJSON_AddStringToObject(data, "source", source);
    emit_event("audio_state", data, generation);
}

void update_audio_paths(bool microphone_enabled, bool speaker_enabled, const char* source,
                        uint32_t generation = 0)
{
    const bool microphone_changed =
        s_microphone_enabled.exchange(microphone_enabled) != microphone_enabled;
    const bool speaker_changed = s_speaker_enabled.exchange(speaker_enabled) != speaker_enabled;
    if (!microphone_enabled) discard_queued_microphone_frames();

#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    if (!speaker_enabled) {
        s_voice_reply_active = false;
        discard_queued_speaker_frames();
        set_speaker_playback_active(false);
    }
    const bool keep_speaking = speaker_enabled &&
        (s_voice_reply_active.load() || s_half_duplex_speaking.load());
    set_half_duplex_speaking(keep_speaking);
#endif

    if (microphone_changed || speaker_changed) {
        ++s_audio_state_revision;
        request_wifi_audio_status_led(true);
        emit_audio_state(source, generation);
    }
}

#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
bool enqueue_speaker_frame(const char* data, size_t length)
{
    if (!s_ready.load() || !s_speaker_enabled.load() || s_speaker_queue == nullptr ||
        data == nullptr || length != kAudioFrameBytes) {
        return false;
    }
    const auto* frame = reinterpret_cast<const uint8_t*>(data);
    if (frame[0] != kProtocolVersion || frame[1] != kSpeakerFrameFlag ||
        read_u32be(frame + 2) == 0 || read_u16be(frame + 14) != kPcmBytes) {
        return false;
    }

    SpeakerFrame queued{};
    queued.sequence = read_u32be(frame + 2);
    const uint32_t pipeline_generation = s_speaker_pipeline_generation.load();
    queued.generation = pipeline_generation;
    std::memcpy(queued.samples.data(), frame + 16, kPcmBytes);
    s_speaker_received_frames.fetch_add(1);
    s_speaker_last_frame_us = esp_timer_get_time();
    if (xQueueSend(s_speaker_queue, &queued, 0) == pdTRUE) {
        return speaker_frame_is_current(pipeline_generation);
    }

    // Raw 10 ms PCM uses independent Windows and I2S clocks. Give the
    // high-priority consumer two frame periods to release a slot so TCP
    // backpressure absorbs short delivery bursts instead of deleting speech.
    s_speaker_backpressure_waits.fetch_add(1);
    if (xQueueSend(s_speaker_queue, &queued, kSpeakerQueueWaitTicks) == pdTRUE) {
        return speaker_frame_is_current(pipeline_generation);
    }

    if (!speaker_frame_is_current(pipeline_generation)) return false;

    // Bound latency under a slow consumer: discard the oldest 10 ms frame and
    // retain the newest audio instead of allowing an ever-growing delay.
    SpeakerFrame discarded{};
    if (xQueueReceive(s_speaker_queue, &discarded, 0) == pdTRUE) {
        s_speaker_queue_drops.fetch_add(1);
    }
    if (!speaker_frame_is_current(pipeline_generation)) return false;
    if (xQueueSend(s_speaker_queue, &queued, 0) != pdTRUE) return false;
    return speaker_frame_is_current(pipeline_generation);
}

void speaker_task(void*)
{
    SpeakerFrame frame{};
    std::vector<int16_t> output(kSamplesPerFrame, 0);
    uint32_t last_sequence = 0;
    uint32_t playback_generation = s_speaker_pipeline_generation.load();
    bool playback_active = false;
    while (true) {
        const uint32_t current_generation = s_speaker_pipeline_generation.load();
        if (current_generation != playback_generation) {
            playback_generation = current_generation;
            last_sequence = 0;
            playback_active = false;
            set_speaker_playback_active(false);
        }
        if (!s_ready.load() || !s_speaker_enabled.load() || s_codec == nullptr) {
            playback_active = false;
            set_speaker_playback_active(false);
            if (s_half_duplex_speaking.load()) set_half_duplex_speaking(false);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        SpeakerFrame stale{};
        while (xQueuePeek(s_speaker_queue, &stale, 0) == pdTRUE &&
               stale.generation != playback_generation) {
            xQueueReceive(s_speaker_queue, &stale, 0);
        }
        const UBaseType_t queued = uxQueueMessagesWaiting(s_speaker_queue);
        // The Codex lifecycle callback normally enters speaking before PCM
        // arrives. A first queued frame is the fail-safe when that callback is
        // unavailable or late.
        if (!s_half_duplex_speaking.load() && s_ready.load() && queued > 0) {
            set_half_duplex_speaking(true);
        }
        if (!s_half_duplex_speaking.load()) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        const UBaseType_t prebuffer = s_voice_reply_active.load() ?
            kSpeakerPrebufferFrames : 1;
        if (!playback_active && queued >= prebuffer) {
            playback_active = true;
            set_speaker_playback_active(true);
        }

        const bool has_audio = playback_active &&
                               xQueueReceive(s_speaker_queue, &frame, 0) == pdTRUE &&
                               frame.generation == playback_generation &&
                               speaker_frame_is_current(playback_generation) &&
                               s_half_duplex_speaking.load();
        if (has_audio) {
            std::copy(frame.samples.begin(), frame.samples.end(), output.begin());
        } else {
            if (playback_active && s_voice_reply_active.load()) {
                s_speaker_underruns.fetch_add(1);
            }
            playback_active = false;
            set_speaker_playback_active(false);
            if (s_voice_reply_active.load() &&
                uxQueueMessagesWaiting(s_speaker_queue) == 0) {
                const int64_t reply_activity_us = std::max(
                    s_speaker_last_frame_us.load(), s_voice_reply_started_us.load());
                if (reply_activity_us > 0 &&
                    esp_timer_get_time() - reply_activity_us >= kSpeakerReplyIdleTimeoutUs) {
                    ESP_LOGW(TAG, "speaker reply idle timeout; returning to listening mode");
                    s_voice_reply_active = false;
                    s_voice_reply_ended_us = esp_timer_get_time();
                }
            }
            if (!s_voice_reply_active.load() &&
                uxQueueMessagesWaiting(s_speaker_queue) == 0) {
                // The transcript-done callback can lead the Windows playback
                // capture by a small bounded amount. Hold output mode through
                // its 300 ms activity-gate tail, then return to listening once.
                const int64_t boundary_us = std::max(
                    s_speaker_last_frame_us.load(), s_voice_reply_ended_us.load());
                if (boundary_us == 0 ||
                    esp_timer_get_time() - boundary_us >= kSpeakerDrainGraceUs) {
                    set_half_duplex_speaking(false);
                    vTaskDelay(pdMS_TO_TICKS(10));
                    continue;
                }
            }
            std::fill(output.begin(), output.end(), 0);
            s_speaker_silence_frames.fetch_add(1);
        }

        // Keep TX DMA warm only for the bounded speaking phase. Listening mode
        // closes the output codec entirely so microphone capture matches the
        // proven RX-only operating condition.
        std::lock_guard<std::mutex> lock(s_audio_codec_mutex);
        const bool output_current = !has_audio ||
            (frame.generation == playback_generation &&
             speaker_frame_is_current(playback_generation));
        if (s_half_duplex_speaking.load() && s_speaker_enabled.load() &&
            s_ready.load() && output_current) {
            if (has_audio) {
                if (last_sequence != 0 && frame.sequence != last_sequence + 1) {
                    const uint32_t missing = frame.sequence > last_sequence
                                                 ? frame.sequence - last_sequence - 1
                                                 : 1;
                    s_speaker_sequence_gaps.fetch_add(missing);
                    ESP_LOGW(TAG, "speaker sequence discontinuity previous=%lu current=%lu",
                             static_cast<unsigned long>(last_sequence),
                             static_cast<unsigned long>(frame.sequence));
                }
                last_sequence = frame.sequence;
                s_speaker_played_frames.fetch_add(1);
            }
            s_codec->OutputData(output);
        }
    }
}
#endif
void handle_command(const char* data, size_t length, uint32_t generation)
{
    cJSON* request = cJSON_ParseWithLength(data, length);
    cJSON* id_item = request ? cJSON_GetObjectItemCaseSensitive(request, "id") : nullptr;
    const int id = cJSON_IsNumber(id_item) ? id_item->valueint : 0;
    cJSON* version = request ? cJSON_GetObjectItemCaseSensitive(request, "v") : nullptr;
    cJSON* command = request ? cJSON_GetObjectItemCaseSensitive(request, "cmd") : nullptr;
    cJSON* args = request ? cJSON_GetObjectItemCaseSensitive(request, "args") : nullptr;
    if (!request || !cJSON_IsObject(request) || !cJSON_IsNumber(version) ||
        version->valueint != 1 || id <= 0 || !cJSON_IsString(command) || !cJSON_IsObject(args)) {
        cJSON_Delete(request);
        send_error(generation, id, "invalid_request", "expected Dock protocol v=1 request");
        return;
    }

    const std::string_view cmd(command->valuestring);
    if (cmd == "get_status") {
        log_runtime_health();
        cJSON* result = cJSON_CreateObject();
        cJSON_AddStringToObject(result, "device", "stackchan-wifi-companion");
        cJSON_AddNumberToObject(result, "protocol_version", 1);
        cJSON_AddNumberToObject(result, "event_sequence", s_event_sequence.load());
        cJSON_AddNumberToObject(result, "sample_rate", 24000);
        cJSON_AddItemToObject(result, "audio", audio_state());
        cJSON_AddItemToObject(result, "runtime", runtime_state());
        send_result(generation, id, result);
    } else if (cmd == "set_audio") {
        bool microphone = s_microphone_enabled.load();
        bool speaker = s_speaker_enabled.load();
        const bool has_mic = cJSON_HasObjectItem(args, "microphone_enabled");
        const bool has_speaker = cJSON_HasObjectItem(args, "speaker_enabled");
        if ((!has_mic && !has_speaker) ||
            (has_mic && !read_bool(args, "microphone_enabled", &microphone)) ||
            (has_speaker && !read_bool(args, "speaker_enabled", &speaker))) {
            send_error(generation, id, "invalid_args", "set_audio requires boolean endpoint fields");
#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
        } else if (speaker) {
            send_error(generation, id, "speaker_unavailable",
                       "speaker output is disabled in RX-only diagnostic mode");
        } else {
            update_audio_paths(microphone, false, "dock_command", generation);
            send_result(generation, id, audio_state());
#else
        } else {
            update_audio_paths(microphone, speaker, "dock_command", generation);
            send_result(generation, id, audio_state());
#endif
        }
    } else if (cmd == "set_expression") {
        cJSON* value = cJSON_GetObjectItemCaseSensitive(args, "expression");
        const std::string_view expression = cJSON_IsString(value) ? value->valuestring : "";
        if (expression != "neutral" && expression != "happy" && expression != "angry" &&
            expression != "sad" && expression != "doubtful") {
            send_error(generation, id, "invalid_args", "expression is not in the allowlist");
        } else {
            Board::GetInstance().GetDisplay()->SetEmotion(value->valuestring);
            cJSON* result = cJSON_CreateObject();
            cJSON_AddStringToObject(result, "expression", value->valuestring);
            send_result(generation, id, result);
        }
    } else if (cmd == "set_talking") {
        bool enabled = false;
        auto* display = static_cast<StackChanAvatarDisplay*>(Board::GetInstance().GetDisplay());
        if (!read_bool(args, "enabled", &enabled) || !display ||
            !display->SetTalkingAnimation(enabled)) {
            send_error(generation, id, "invalid_args", "talking animation is unavailable");
        } else {
            // The existing Codex lifecycle signal is also the half-duplex
            // boundary: stop capture before reply PCM arrives and keep the
            // microphone closed until the reply has ended and its queue drains.
            set_voice_reply_active(enabled);
            cJSON* result = cJSON_CreateObject();
            cJSON_AddBoolToObject(result, "enabled", enabled);
            cJSON_AddStringToObject(result, "phase",
                                    s_half_duplex_speaking.load() ? "speaking" : "listening");
            send_result(generation, id, result);
        }
    } else if (cmd == "set_speech") {
        cJSON* text = cJSON_GetObjectItemCaseSensitive(args, "text");
        const size_t bytes = cJSON_IsString(text) ? std::strlen(text->valuestring) : 0;
        if (!bytes || bytes > kMaxSpeechBytes) {
            send_error(generation, id, "invalid_args", "text must be 1..320 bytes");
        } else {
            Board::GetInstance().GetDisplay()->SetChatMessage("assistant", text->valuestring);
            cJSON* result = cJSON_CreateObject();
            cJSON_AddBoolToObject(result, "displayed", true);
            send_result(generation, id, result);
        }
    } else if (cmd == "clear_speech") {
        Board::GetInstance().GetDisplay()->ClearChatMessages();
        cJSON* result = cJSON_CreateObject();
        cJSON_AddBoolToObject(result, "displayed", false);
        send_result(generation, id, result);
    } else if (cmd == "set_led") {
        int red = 0;
        int green = 0;
        int blue = 0;
        if (!read_int(args, "red", 0, 168, &red) || !read_int(args, "green", 0, 168, &green) ||
            !read_int(args, "blue", 0, 168, &blue)) {
            send_error(generation, id, "invalid_args", "LED channels must be integers in 0..168");
        } else {
            show_temporary_led({static_cast<uint8_t>(red), static_cast<uint8_t>(green),
                                static_cast<uint8_t>(blue)});
            cJSON* result = cJSON_CreateObject();
            cJSON_AddNumberToObject(result, "red", red);
            cJSON_AddNumberToObject(result, "green", green);
            cJSON_AddNumberToObject(result, "blue", blue);
            send_result(generation, id, result);
        }
    } else if (cmd == "get_head") {
        std::string output;
        if (!stackchan_mcp_dispatch_tool("self.robot.get_head_angles", args, output)) {
            send_error(generation, id, "command_failed", "head command failed");
        } else {
            cJSON* result = cJSON_Parse(output.c_str());
            if (result) send_result(generation, id, result);
            else send_error(generation, id, "command_failed", "invalid head response");
        }
    } else if (cmd == "set_head") {
        send_error(generation, id, "head_motion_disabled",
                   "head motion is disabled until the servo power-loss bug is resolved");
    } else {
        send_error(generation, id, "unknown_command", "command is not in the allowlist");
    }
    cJSON_Delete(request);
}

bool enqueue_command_frame(const char* data, size_t length, uint32_t generation)
{
    if (!s_command_queue || !data || length == 0 || length > kControlFrameBytes || generation == 0) {
        return false;
    }
    CommandFrame frame;
    frame.generation = generation;
    frame.length = static_cast<uint16_t>(length);
    std::memcpy(frame.data.data(), data, length);
    return xQueueSend(s_command_queue, &frame, 0) == pdTRUE;
}

void wifi_tx_task(void*)
{
    const auto transmit = [](const OutboundFrame& frame) {
        // The bootstrap owner sends hello directly. No queued application frame
        // may enter WebSocket framing until that hello generation is accepted.
        if (!s_ready.load()) return;
        auto socket = current_socket_for_generation(frame.generation);
        if (!socket || !socket->IsConnected()) return;
        const int64_t started_us = esp_timer_get_time();
        const bool sent = socket->Send(frame.data.data(), frame.length, frame.binary);
        const int64_t elapsed_us = esp_timer_get_time() - started_us;
        const uint32_t bounded_elapsed_us = static_cast<uint32_t>(
            std::min<int64_t>(elapsed_us, UINT32_MAX));
        uint32_t previous_max = s_tx_max_send_us.load();
        while (previous_max < bounded_elapsed_us &&
               !s_tx_max_send_us.compare_exchange_weak(previous_max, bounded_elapsed_us)) {}
        if (!sent) {
            const int send_error = socket->GetLastError();
            s_tx_failed_sends.fetch_add(1);
            ESP_LOGW(TAG, "Wi-Fi TX failed generation=%lu binary=%d bytes=%u errno=%d",
                      static_cast<unsigned long>(frame.generation), frame.binary,
                      static_cast<unsigned>(frame.length), send_error);
            // EspTcp::Send may have written part of this WebSocket frame before
            // returning an error. The stream is no longer message-aligned, so
            // every send failure must replace the connection before more data.
            socket->Abort();
        } else {
            if (elapsed_us >= 20000) {
                s_tx_slow_sends.fetch_add(1);
                ESP_LOGW(TAG, "Wi-Fi TX blocked for %lld us generation=%lu binary=%d bytes=%u",
                         static_cast<long long>(elapsed_us),
                         static_cast<unsigned long>(frame.generation), frame.binary,
                         static_cast<unsigned>(frame.length));
            }
        }
    };

    OutboundFrame frame;
    MicrophoneFrame microphone_frame;
    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (!s_ready.load()) continue;
        do {
            // Control stays on the reliable WebSocket. One authenticated 20 ms
            // native PCM packet then uses the session-bound non-blocking UDP sender.
            while (xQueueReceive(s_control_tx_queue, &frame, 0) == pdTRUE) transmit(frame);
            if (xQueueReceive(s_microphone_tx_queue, &microphone_frame, 0) == pdTRUE) {
                send_microphone_udp(microphone_frame);
            }
        } while (uxQueueMessagesWaiting(s_control_tx_queue) > 0 ||
                 uxQueueMessagesWaiting(s_microphone_tx_queue) > 0);
    }
}

void command_task(void*)
{
    CommandFrame frame;
    while (true) {
        if (xQueueReceive(s_command_queue, &frame, portMAX_DELAY) == pdTRUE) {
            if (!current_socket_for_generation(frame.generation)) continue;
            handle_command(frame.data.data(), frame.length, frame.generation);
        }
    }
}

void on_head_touch(HeadPetGesture gesture)
{
    if (gesture == HeadPetGesture::SwipeForward) {
        update_audio_paths(true, s_speaker_enabled.load(), "touch_swipe_forward");
    } else if (gesture == HeadPetGesture::SwipeBackward) {
        update_audio_paths(false, s_speaker_enabled.load(), "touch_swipe_backward");
    }
    cJSON* body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "gesture", gesture_name(gesture));
    emit_event("touch", body);
}

void audio_task(void*)
{
    std::vector<int16_t> input;
    std::array<int16_t, kSamplesPerFrame> mono{};
    std::array<int16_t, kMicrophonePcmSamples> pending_pcm{};
    size_t pending_samples = 0;
    uint64_t pending_capture_time_us = 0;
    uint32_t observed_generation = s_microphone_pipeline_generation.load();
#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    uint32_t diagnostic_reads = 0;
#endif
    while (true) {
        const uint32_t active_generation = s_microphone_pipeline_generation.load();
        if (active_generation != observed_generation) {
            observed_generation = active_generation;
            pending_samples = 0;
            pending_capture_time_us = 0;
        }
        if (!s_ready.load() || !s_microphone_enabled.load() || s_half_duplex_speaking.load()) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        const size_t channels = std::max(1, s_codec->input_channels());
        if (channels != kWifiInputChannels) {
            ESP_LOGE(TAG, "invalid Wi-Fi microphone geometry: expected=%u actual=%u",
                     static_cast<unsigned>(kWifiInputChannels), static_cast<unsigned>(channels));
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        input.resize(kSamplesPerFrame * channels);
        bool captured = false;
        {
            // Serialize I2S reads with input/output mode transitions. The
            // speaking flag is checked again after taking the lock so a reply
            // cannot close the codec underneath an in-flight new read.
            std::lock_guard<std::mutex> lock(s_audio_codec_mutex);
            if (!s_half_duplex_speaking.load() && s_microphone_enabled.load()) {
                captured = s_codec->InputData(input);
            }
        }
        if (!captured) {
            // Do not join samples across a failed 10 ms I2S read. That would
            // compress a real capture gap into an apparently continuous frame.
            pending_samples = 0;
            pending_capture_time_us = 0;
            continue;
        }
        s_microphone_captured_chunks.fetch_add(1);
#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
        if (channels == kDiagnosticChannels) {
            send_diagnostic_audio(input.data(), kSamplesPerFrame);
            if (diagnostic_reads++ % 500 == 0) send_diagnostic_registers();
        }
#endif
        const size_t capture_channel = kWifiPhysicalMicrophoneChannel == 1 && channels >= 3 ? 2 : 0;
        for (size_t i = 0; i < kSamplesPerFrame; ++i) {
            mono[i] = input[i * channels + capture_channel];
        }
        const uint64_t capture_time_us = esp_timer_get_time();
        if (observed_generation != s_microphone_pipeline_generation.load() ||
            s_half_duplex_speaking.load() || !s_microphone_enabled.load()) {
            continue;
        }
        for (size_t index = 0; index < mono.size(); ++index) {
            if (pending_samples == 0) pending_capture_time_us = capture_time_us;
            pending_pcm[pending_samples++] = mono[index];
            if (pending_samples == kMicrophonePcmSamples) {
                MicrophoneFrame frame;
                frame.sequence = s_sequence.fetch_add(1);
                frame.capture_time_us = pending_capture_time_us;
                frame.generation = observed_generation;
                frame.payload_length = static_cast<uint16_t>(kMicrophonePcmBytes);
                std::memcpy(frame.payload.data(), pending_pcm.data(), kMicrophonePcmBytes);
                s_microphone_captured_frames.fetch_add(1);
                s_microphone_packetized_frames.fetch_add(1);
                if (xQueueSend(s_microphone_tx_queue, &frame, 0) == pdTRUE) {
                    notify_wifi_tx_task();
                } else {
                    s_microphone_tx_queue_drops.fetch_add(1);
                }
                pending_samples = 0;
                pending_capture_time_us = 0;
            }
        }
    }
}

bool load_wifi_audio_configuration(std::string& url, std::string& key)
{
    Settings settings("wifi_audio");
    url = settings.GetString("url");
    key = settings.GetString("key");
    const bool secure_endpoint = url.rfind("wss://", 0) == 0;
#if CONFIG_STACKCHAN_WIFI_AUDIO_ALLOW_INSECURE_WS
    const bool development_endpoint = url.rfind("ws://", 0) == 0;
#else
    constexpr bool development_endpoint = false;
#endif
    return settings.GetBool("configured", false) && (secure_endpoint || development_endpoint) && key.size() == 64;
}

bool configure_realtime_wifi_mode(const wifi_ap_record_t& ap_info)
{
    wifi_ps_type_t previous_mode = WIFI_PS_MIN_MODEM;
    const esp_err_t get_before_result = esp_wifi_get_ps(&previous_mode);
    const esp_err_t set_result = esp_wifi_set_ps(WIFI_PS_NONE);

    wifi_ps_type_t active_mode = WIFI_PS_MIN_MODEM;
    const esp_err_t get_after_result = esp_wifi_get_ps(&active_mode);
    if (set_result != ESP_OK || get_after_result != ESP_OK || active_mode != WIFI_PS_NONE) {
        ESP_LOGE(TAG,
                 "failed to enable real-time Wi-Fi mode: get_before=%s set=%s get_after=%s active_ps=%d",
                 esp_err_to_name(get_before_result), esp_err_to_name(set_result), esp_err_to_name(get_after_result),
                 static_cast<int>(active_mode));
        return false;
    }

    ESP_LOGI(TAG, "Wi-Fi association is ready: channel=%u rssi=%d power_save=%d->%d",
             static_cast<unsigned>(ap_info.primary), static_cast<int>(ap_info.rssi),
             get_before_result == ESP_OK ? static_cast<int>(previous_mode) : -1, static_cast<int>(active_mode));
    return true;
}

void wait_for_wifi_association()
{
    bool waiting_reported = false;
    while (true) {
        wifi_ap_record_t ap_info{};
        if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
            // The isolated Wi-Fi Audio runtime does not enter Xiaozhi's normal
            // PERFORMANCE state. ESP-IDF defaults to MIN_MODEM, whose DTIM
            // wakeups can delay real-time speaker downlink by hundreds of ms.
            if (configure_realtime_wifi_mode(ap_info)) return;
            ESP_LOGW(TAG, "retrying real-time Wi-Fi mode configuration");
        }

        if (!waiting_reported) {
            // WifiConfigServer owns the Wi-Fi driver and accepts provisioning
            // changes over BLE while this independent transport task waits.
            ESP_LOGW(TAG, "Wi-Fi Audio is waiting for Wi-Fi association");
            waiting_reported = true;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void transport_bootstrap_task(void*)
{
    bool audio_task_started = false;
    while (true) {
        std::string url;
        std::string key;
        set_transport_state(TransportState::WaitingDockConfiguration);
        bool waiting_reported = false;
        while (!load_wifi_audio_configuration(url, key)) {
            if (!waiting_reported) {
                // Keep this task non-blocking so the BLE configuration worker can
                // process the first endpoint/key pair and later corrections.
                ESP_LOGW(TAG, "Wi-Fi Audio is waiting for BLE PC Dock configuration");
                waiting_reported = true;
            }
            vTaskDelay(pdMS_TO_TICKS(500));
        }

        set_transport_state(TransportState::WaitingWifiAssociation);
        wait_for_wifi_association();

#if CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
        if (!configure_diagnostic_udp(url)) {
            set_transport_state(TransportState::ErrorWebSocket);
            ESP_LOGE(TAG, "failed to configure RX4 diagnostic destination");
            vTaskDelete(nullptr);
            return;
        }
#endif

        if (!s_codec) s_codec = Board::GetInstance().GetAudioCodec();
        if (!s_codec || s_codec->input_sample_rate() != 24000) {
            set_transport_state(TransportState::ErrorAudioCodec);
            ESP_LOGE(TAG, "audio codec does not support the required 24 kHz input");
            ESP_LOGW(TAG, "retrying initial Wi-Fi microphone listening mode in 1 second");
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        bool initial_listening_ready = false;
        {
            std::lock_guard<std::mutex> lock(s_audio_codec_mutex);
            initial_listening_ready = apply_half_duplex_codec_mode(false);
        }
        if (!initial_listening_ready) {
            ESP_LOGE(TAG, "failed to enter initial Wi-Fi microphone listening mode");
            ESP_LOGW(TAG, "retrying initial Wi-Fi microphone listening mode in 1 second");
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        s_voice_reply_active = false;
        s_half_duplex_speaking_requested = false;
        s_half_duplex_speaking = false;

        std::shared_ptr<WebSocket> socket = Board::GetInstance().GetNetwork()->CreateWebSocket(2);
        if (!socket) {
            set_transport_state(TransportState::ErrorWebSocket);
            ESP_LOGE(TAG, "failed to create PC Dock WebSocket client");
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }
        set_ready(false);
        reset_protocol_queues_for_new_socket();
        const uint32_t socket_generation = set_current_socket(socket);
        const std::string id = mac_device_id();
        const std::string nonce = random_nonce();
        std::weak_ptr<WebSocket> weak_socket = socket;
        socket->SetReceiveBufferSize(kControlFrameBytes);
        socket->SetNoDelay(true);
        socket->SetSendTimeout(kWifiAudioSendTimeoutMs);
        socket->OnData([weak_socket, url, key, id, nonce](const char* data, size_t length, bool binary) {
            auto callback_socket = weak_socket.lock();
            if (!callback_socket || !is_current_socket(callback_socket)) return;
            if (binary) {
#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
                if (!enqueue_speaker_frame(data, length)) {
                    ESP_LOGW(TAG, "discarded invalid or unavailable speaker frame length=%u",
                             static_cast<unsigned>(length));
                }
#endif
                return;
            }
            cJSON* message=cJSON_ParseWithLength(data,length);
            cJSON* type=message?cJSON_GetObjectItemCaseSensitive(message,"type"):nullptr;
            cJSON* protocol=message?cJSON_GetObjectItemCaseSensitive(message,"protocol"):nullptr;
            const bool ready=cJSON_IsString(type)&&std::strcmp(type->valuestring,"ready")==0&&
                cJSON_IsNumber(protocol)&&protocol->valuedouble==protocol->valueint&&
                protocol->valueint==static_cast<int>(kProtocolVersion);
            if (ready) {
                cJSON* transport=cJSON_GetObjectItemCaseSensitive(message,"microphone_transport");
                const uint32_t generation = current_socket_generation(callback_socket);
                const bool valid_transport = generation != 0 && stage_microphone_udp_negotiation(
                    url, key, id, nonce, transport, generation);
                cJSON_Delete(message);
                if (valid_transport) {
                    s_dock_ready_generation.store(generation);
                } else {
                    ESP_LOGE(TAG,"Dock ready frame did not negotiate authenticated UDP PCM");
                    callback_socket->Abort();
                }
            } else {
                cJSON_Delete(message);
                const uint32_t generation = current_socket_generation(callback_socket);
                if (!enqueue_command_frame(data, length, generation)) {
                    ESP_LOGW(TAG, "dropped Wi-Fi control command bytes=%u", static_cast<unsigned>(length));
                }
            }
        });
        socket->OnDisconnected([weak_socket] {
            auto callback_socket = weak_socket.lock();
            if (!callback_socket || !is_current_socket(callback_socket)) return;
            set_transport_state(TransportState::DockDisconnected);
            set_ready(false);
#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
            s_voice_reply_active = false;
            discard_queued_speaker_frames();
            set_speaker_playback_active(false);
            set_half_duplex_speaking(false);
#endif
        });
        socket->OnError([weak_socket](int error) {
            auto callback_socket = weak_socket.lock();
            if (!callback_socket || !is_current_socket(callback_socket)) return;
            set_transport_state(TransportState::ErrorWebSocket);
            ESP_LOGW(TAG,"websocket error=%d",error);
            set_ready(false);
#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
            s_voice_reply_active = false;
            discard_queued_speaker_frames();
            set_speaker_playback_active(false);
            set_half_duplex_speaking(false);
#endif
        });
        set_transport_state(TransportState::ConnectingDock);
        if (!socket->Connect(url.c_str())) {
            set_ready(false);
            set_transport_state(TransportState::ErrorWebSocket);
            ESP_LOGE(TAG, "failed to begin PC Dock WebSocket connection");
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }

        // Match the official Xiaozhi WebSocket lifecycle: the connection owner
        // sends the first application frame synchronously after Connect returns.
        // Audio/control remain queued behind ready, so no other application
        // sender can overlap this generation-defining hello.
        set_transport_state(TransportState::DockConnected);
        const std::string auth = hmac_hex(key, id + "\n" + nonce);
        cJSON* hello = cJSON_CreateObject();
        cJSON* format = nullptr;
        const bool hello_complete =
            hello &&
            cJSON_AddStringToObject(hello, "type", "hello") &&
            cJSON_AddNumberToObject(hello, "protocol", 1) &&
            cJSON_AddStringToObject(hello, "device_id", id.c_str()) &&
            cJSON_AddStringToObject(hello, "nonce", nonce.c_str()) &&
            cJSON_AddStringToObject(hello, "auth", auth.c_str()) &&
            (format = cJSON_AddObjectToObject(hello, "format")) &&
            cJSON_AddStringToObject(format, "codec", "pcm_s16le") &&
            cJSON_AddNumberToObject(format, "sample_rate", 24000) &&
            cJSON_AddNumberToObject(format, "channels", 1) &&
            cJSON_AddNumberToObject(format, "frame_ms", 20);
        if (!hello_complete) {
            cJSON_Delete(hello);
            hello = nullptr;
        }
        if (!hello_complete || !send_json_direct_to_socket(socket, hello)) {
            ESP_LOGE(TAG, "failed to send Wi-Fi Audio hello");
            socket->Abort();
            set_ready(false);
            set_transport_state(TransportState::ErrorWebSocket);
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }

        // esp-ml307 creates its generic TCP receive task at priority 1. That is
        // sufficient for Xiaozhi's lower-rate audio traffic, but 10 ms raw PCM
        // downlink frames can fill the TCP receive window while both audio
        // workers run at priority 4. Raise only the isolated Wi-Fi Audio
        // connection's receiver after the WebSocket handshake has created it.
        TaskHandle_t receive_task = socket->GetReceiveTaskHandle();
        if (receive_task) {
            const UBaseType_t previous_priority = uxTaskPriorityGet(receive_task);
            vTaskPrioritySet(receive_task, kWifiAudioTcpReceivePriority);
            ESP_LOGI(TAG, "TCP receive task priority=%u->%u",
                     static_cast<unsigned>(previous_priority),
                     static_cast<unsigned>(uxTaskPriorityGet(receive_task)));
        } else {
            ESP_LOGW(TAG, "TCP receive task was not found after WebSocket connect");
        }

        if (s_head_touch_connection < 0) {
            s_head_touch_connection = GetHAL().onHeadPetGesture.connect(on_head_touch);
        }
        if (!audio_task_started) {
            if (xTaskCreatePinnedToCore(audio_task, "wifi_audio", 6144, nullptr, 4,
                                        &s_audio_task_handle, kWifiAudioI2sCore) != pdPASS) {
                ESP_LOGE(TAG, "failed to create audio task");
            } else {
                audio_task_started = true;
            }
        }
        bool connection_tasks_ready = audio_task_started;

#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
        static bool speaker_task_started = false;
        if (!speaker_task_started) {
            if (s_speaker_queue == nullptr) {
                // Speaker staging is not DMA memory and is never accessed from an ISR.
                // Keep it in PSRAM so the I2S driver can retain scarce internal/DMA RAM.
                // If lifecycle teardown is added later, use vQueueDeleteWithCaps().
                s_speaker_queue = xQueueCreateWithCaps(
                    kSpeakerQueueFrames, sizeof(SpeakerFrame),
                    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
            }
            if (s_speaker_queue == nullptr ||
                // This task must not perform flash/OTA writes while its stack is in PSRAM.
                // If lifecycle teardown is added later, use vTaskDeleteWithCaps().
                xTaskCreatePinnedToCoreWithCaps(
                    speaker_task, "wifi_speaker", 4096, nullptr, 6,
                    &s_speaker_task_handle, kWifiAudioI2sCore,
                    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
                ESP_LOGE(TAG, "failed to create Wi-Fi speaker queue/task");
            } else {
                speaker_task_started = true;
            }
        }
        connection_tasks_ready = connection_tasks_ready && speaker_task_started;
#endif

        if (!connection_tasks_ready) {
            ESP_LOGE(TAG, "Wi-Fi Audio runtime tasks are unavailable after Dock connect");
            socket->Abort();
            set_ready(false);
            set_transport_state(TransportState::ErrorAudioCodec);
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }

        // The official Xiaozhi sequence does not expose its audio producer
        // until the peer has accepted the hello. Keep the callback lightweight:
        // it only records the accepted socket generation. This bootstrap owner
        // commits task/priority setup first, then publishes ready exactly once.
        const TickType_t ready_started = xTaskGetTickCount();
        while (socket->IsConnected() &&
               s_dock_ready_generation.load() != socket_generation &&
               xTaskGetTickCount() - ready_started < pdMS_TO_TICKS(10000)) {
            vTaskDelay(pdMS_TO_TICKS(10));
        }
        if (!socket->IsConnected() ||
            s_dock_ready_generation.load() != socket_generation) {
            ESP_LOGE(TAG, "PC Dock did not accept Wi-Fi Audio hello within 10 seconds");
            socket->Abort();
            set_ready(false);
            set_transport_state(TransportState::ErrorWebSocket);
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }

        bool codec_ready = false;
        {
            std::lock_guard<std::mutex> lock(s_audio_codec_mutex);
            codec_ready = apply_half_duplex_codec_mode(false);
        }
        if (!codec_ready) {
            ESP_LOGE(TAG, "Dock ready rejected because listening mode could not be restored");
            socket->Abort();
            set_ready(false);
            set_transport_state(TransportState::ErrorAudioCodec);
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }
        if (!activate_microphone_udp_session(socket_generation)) {
            ESP_LOGE(TAG, "Dock ready rejected because UDP microphone session could not be activated");
            socket->Abort();
            set_ready(false);
            set_transport_state(TransportState::ErrorWebSocket);
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }
        if (!commit_ready_for_socket(socket, socket_generation)) {
            ESP_LOGE(TAG, "PC Dock disconnected before Wi-Fi Audio ready commit");
            socket->Abort();
            set_ready(false);
            set_transport_state(TransportState::DockDisconnected);
            clear_current_socket(socket);
            ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }

        while (socket->IsConnected()) {
            vTaskDelay(pdMS_TO_TICKS(500));
        }
        if (is_current_socket(socket)) {
            set_ready(false);
            set_transport_state(TransportState::DockDisconnected);
#if !CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
            discard_queued_speaker_frames();
            s_voice_reply_active = false;
            set_speaker_playback_active(false);
            set_half_duplex_speaking(false);
#endif
            clear_current_socket(socket);
        }
        ESP_LOGW(TAG, "retrying PC Dock connection in 2 seconds");
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}
} // namespace

esp_err_t start_stackchan_wifi_audio_dock_mvp()
{
    set_transport_state(TransportState::WaitingDockConfiguration);
    s_command_queue = xQueueCreate(kCommandQueueFrames, sizeof(CommandFrame));
    s_control_tx_queue = xQueueCreate(kControlTxQueueFrames, sizeof(OutboundFrame));
    s_microphone_tx_queue = xQueueCreate(kMicrophoneTxQueueFrames, sizeof(MicrophoneFrame));
    const auto delete_protocol_queues = [] {
        if (s_command_queue) vQueueDelete(s_command_queue);
        if (s_control_tx_queue) vQueueDelete(s_control_tx_queue);
        if (s_microphone_tx_queue) vQueueDelete(s_microphone_tx_queue);
        s_command_queue = nullptr;
        s_control_tx_queue = nullptr;
        s_microphone_tx_queue = nullptr;
    };
    if (!s_command_queue || !s_control_tx_queue || !s_microphone_tx_queue) {
        delete_protocol_queues();
        return ESP_ERR_NO_MEM;
    }

    TaskHandle_t led_task_handle = nullptr;
    if (xTaskCreatePinnedToCore(wifi_tx_task, "wifi_audio_tx", kWifiAudioTxTaskStackBytes, nullptr, 5,
                                &s_wifi_tx_task_handle, kWifiAudioNetworkCore) != pdPASS) {
        s_wifi_tx_task_handle = nullptr;
        delete_protocol_queues();
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(command_task, "wifi_audio_cmd", 8192, nullptr, 4,
                    &s_command_task_handle) != pdPASS) {
        vTaskDelete(s_wifi_tx_task_handle);
        s_wifi_tx_task_handle = nullptr;
        delete_protocol_queues();
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(led_restore_task, "wifi_audio_led", 3072, nullptr, 2,
                    &led_task_handle) != pdPASS) {
        vTaskDelete(s_command_task_handle);
        s_command_task_handle = nullptr;
        vTaskDelete(s_wifi_tx_task_handle);
        s_wifi_tx_task_handle = nullptr;
        delete_protocol_queues();
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(transport_bootstrap_task, "wifi_audio_boot", 8192, nullptr, 4,
                    nullptr) != pdPASS) {
        vTaskDelete(s_command_task_handle);
        s_command_task_handle = nullptr;
        vTaskDelete(led_task_handle);
        vTaskDelete(s_wifi_tx_task_handle);
        s_wifi_tx_task_handle = nullptr;
        delete_protocol_queues();
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void update_stackchan_wifi_audio_volume_gesture()
{
    s_volume_gesture.update();
}

const char* stackchan_wifi_audio_transport_state()
{
    return transport_state_name(s_transport_state.load());
}
#else
esp_err_t start_stackchan_wifi_audio_dock_mvp() { return ESP_ERR_NOT_SUPPORTED; }
void update_stackchan_wifi_audio_volume_gesture() {}
const char* stackchan_wifi_audio_transport_state() { return "unsupported"; }
#endif
