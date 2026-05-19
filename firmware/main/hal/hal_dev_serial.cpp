/*
 * Dev-only local serial wake/stop command PoC.
 *
 * Build with CMake option -DSTACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP=ON to enable.
 * Keep disabled for regular firmware: the wake command intentionally starts
 * local microphone listening from the serial console.
 */
#include "hal_dev_serial.h"

#if defined(STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP)

#include "application.h"
#include "audio/audio_service.h"
#include "board/hal_bridge.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include <driver/usb_serial_jtag.h>
#include <esp_err.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

namespace {

constexpr const char* TAG = "dev_serial_wake_stop";
constexpr uint32_t kTaskStackSize = 6144;
constexpr UBaseType_t kTaskPriority = 4;
constexpr size_t kPcmFrameSamples = 960;
constexpr TickType_t kFrameDelayTicks = pdMS_TO_TICKS(60);
constexpr int kListeningWaitMs = 2500;
constexpr int kPostInjectVadWaitMs = 1200;
constexpr int kTrailingSilentFrames = 5;
constexpr size_t kSerialLineBufferSize = 32;
constexpr size_t kSerialReadBufferSize = 16;
constexpr TickType_t kSerialReadTimeoutTicks = pdMS_TO_TICKS(100);

extern const uint8_t prompt_sample_short_wav_start[] asm("_binary_celebration_short_16k_mono_s16_wav_start");
extern const uint8_t prompt_sample_short_wav_end[] asm("_binary_celebration_short_16k_mono_s16_wav_end");
extern const uint8_t prompt_sample_fallback_wav_start[] asm("_binary_celebration_tts_16k_mono_s16_approx3s_wav_start");
extern const uint8_t prompt_sample_fallback_wav_end[] asm("_binary_celebration_tts_16k_mono_s16_approx3s_wav_end");

struct EmbeddedWav {
    const char* name;
    const char* repo_path;
    const uint8_t* start;
    const uint8_t* end;
};

struct WavPcmView {
    const uint8_t* data = nullptr;
    size_t bytes = 0;
    uint16_t channels = 0;
    uint32_t sample_rate = 0;
    uint16_t bits_per_sample = 0;
};

uint16_t read_le16(const uint8_t* p)
{
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

uint32_t read_le32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

bool fourcc_eq(const uint8_t* p, const char* s)
{
    return p[0] == static_cast<uint8_t>(s[0]) && p[1] == static_cast<uint8_t>(s[1]) &&
           p[2] == static_cast<uint8_t>(s[2]) && p[3] == static_cast<uint8_t>(s[3]);
}

bool parse_wav_pcm16_mono_16k(const uint8_t* wav, size_t wav_size, WavPcmView& out)
{
    if (wav_size < 12 || !fourcc_eq(wav, "RIFF") || !fourcc_eq(wav + 8, "WAVE")) {
        ESP_LOGE(TAG, "prompt_sample WAV parse failed: not RIFF/WAVE");
        return false;
    }

    bool have_fmt = false;
    bool have_data = false;
    uint16_t audio_format = 0;
    size_t offset = 12;
    while (offset + 8 <= wav_size) {
        const uint8_t* chunk = wav + offset;
        const uint32_t chunk_size = read_le32(chunk + 4);
        const size_t payload = offset + 8;
        if (payload > wav_size || chunk_size > wav_size - payload) {
            ESP_LOGE(TAG, "prompt_sample WAV parse failed: truncated chunk");
            return false;
        }

        if (fourcc_eq(chunk, "fmt ")) {
            if (chunk_size < 16) {
                ESP_LOGE(TAG, "prompt_sample WAV parse failed: short fmt chunk");
                return false;
            }
            audio_format = read_le16(wav + payload);
            out.channels = read_le16(wav + payload + 2);
            out.sample_rate = read_le32(wav + payload + 4);
            out.bits_per_sample = read_le16(wav + payload + 14);
            have_fmt = true;
        } else if (fourcc_eq(chunk, "data")) {
            out.data = wav + payload;
            out.bytes = chunk_size;
            have_data = true;
        }

        offset = payload + chunk_size + (chunk_size & 1U);
    }

    if (!have_fmt || !have_data) {
        ESP_LOGE(TAG, "prompt_sample WAV parse failed: missing fmt/data chunk");
        return false;
    }
    if (audio_format != 1 || out.channels != 1 || out.sample_rate != 16000 || out.bits_per_sample != 16) {
        ESP_LOGE(TAG, "prompt_sample WAV unsupported format: fmt=%u ch=%u rate=%lu bits=%u",
                 audio_format, out.channels, static_cast<unsigned long>(out.sample_rate), out.bits_per_sample);
        return false;
    }
    if ((out.bytes & 1U) != 0) {
        ESP_LOGE(TAG, "prompt_sample WAV data has odd byte count: %u", static_cast<unsigned>(out.bytes));
        return false;
    }
    return true;
}

void trim_line(char* line)
{
    if (line == nullptr) {
        return;
    }

    size_t len = std::strlen(line);
    while (len > 0 && std::isspace(static_cast<unsigned char>(line[len - 1]))) {
        line[--len] = '\0';
    }

    char* start = line;
    while (*start != '\0' && std::isspace(static_cast<unsigned char>(*start))) {
        ++start;
    }

    if (start != line) {
        std::memmove(line, start, std::strlen(start) + 1);
    }
}

bool wait_for_listening(Application& app)
{
    const int step_ms = 50;
    for (int waited_ms = 0; waited_ms < kListeningWaitMs; waited_ms += step_ms) {
        if (app.GetDeviceState() == kDeviceStateListening) {
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(step_ms));
    }
    return app.GetDeviceState() == kDeviceStateListening;
}

bool inject_frame(AudioService& audio_service, const uint8_t* pcm_bytes, size_t samples)
{
    std::vector<int16_t> frame(kPcmFrameSamples, 0);
    const size_t copy_samples = std::min(samples, kPcmFrameSamples);
    for (size_t i = 0; i < copy_samples; ++i) {
        frame[i] = static_cast<int16_t>(read_le16(pcm_bytes + i * sizeof(int16_t)));
    }
    return audio_service.InjectPcmFrameToSendQueue(std::move(frame));
}

void inject_prompt_sample()
{
    if (!hal_bridge::is_xiaozhi_ready()) {
        ESP_LOGW(TAG, "prompt_sample ignored: xiaozhi is not ready");
        return;
    }

    const EmbeddedWav samples[] = {
        {"short", "assets/dev_serial/celebration-short-16k-mono-s16.wav", prompt_sample_short_wav_start,
         prompt_sample_short_wav_end},
        {"fallback", "assets/dev_serial/celebration-tts-16k-mono-s16-approx3s.wav", prompt_sample_fallback_wav_start,
         prompt_sample_fallback_wav_end},
    };

    WavPcmView wav;
    const EmbeddedWav* selected = nullptr;
    for (const auto& sample : samples) {
        WavPcmView parsed;
        if (parse_wav_pcm16_mono_16k(sample.start, sample.end - sample.start, parsed)) {
            wav = parsed;
            selected = &sample;
            break;
        }
        ESP_LOGW(TAG, "prompt_sample: embedded WAV rejected: %s", sample.repo_path);
    }
    if (selected == nullptr) {
        ESP_LOGE(TAG, "prompt_sample: no usable embedded WAV sample");
        return;
    }

    const size_t total_samples = wav.bytes / sizeof(int16_t);
    const size_t prompt_frames = (total_samples + kPcmFrameSamples - 1) / kPcmFrameSamples;
    const size_t pad_samples = prompt_frames * kPcmFrameSamples - total_samples;

    auto& app = Application::GetInstance();
    ESP_LOGW(TAG,
             "prompt_sample: dev-only local serial PCM injection; sample=%s (%s), %lu Hz mono s16, data=%u bytes, "
             "samples=%u, frames=%u, pad=%u samples",
             selected->name, selected->repo_path, static_cast<unsigned long>(wav.sample_rate),
             static_cast<unsigned>(wav.bytes), static_cast<unsigned>(total_samples), static_cast<unsigned>(prompt_frames),
             static_cast<unsigned>(pad_samples));
    ESP_LOGI(TAG, "prompt_sample: StartListening; state=%d", static_cast<int>(app.GetDeviceState()));
    app.StartListening();

    if (!wait_for_listening(app)) {
        ESP_LOGW(TAG, "prompt_sample: listening state not observed after %d ms; injecting anyway", kListeningWaitMs);
    } else {
        ESP_LOGI(TAG, "prompt_sample: listening state observed; injecting PCM frames");
    }

    auto& audio_service = app.GetAudioService();
    size_t injected_frames = 0;
    for (size_t pos = 0; pos < total_samples; pos += kPcmFrameSamples) {
        const size_t samples = std::min(kPcmFrameSamples, total_samples - pos);
        if (!inject_frame(audio_service, wav.data + pos * sizeof(int16_t), samples)) {
            ESP_LOGW(TAG, "prompt_sample: send queue rejected PCM frame at sample %u", static_cast<unsigned>(pos));
        }
        ++injected_frames;
        vTaskDelay(kFrameDelayTicks);
    }

    for (int i = 0; i < kTrailingSilentFrames; ++i) {
        std::vector<int16_t> silence(kPcmFrameSamples, 0);
        if (!audio_service.InjectPcmFrameToSendQueue(std::move(silence))) {
            ESP_LOGW(TAG, "prompt_sample: send queue rejected trailing silence frame %d", i + 1);
        }
        ++injected_frames;
        vTaskDelay(kFrameDelayTicks);
    }

    ESP_LOGI(TAG, "prompt_sample: injected %u frames, waiting %d ms for VAD/ASR before StopListening",
             static_cast<unsigned>(injected_frames), kPostInjectVadWaitMs);
    vTaskDelay(pdMS_TO_TICKS(kPostInjectVadWaitMs));
    app.StopListening();
    ESP_LOGI(TAG, "prompt_sample: StopListening requested; this validates serial->PCM queue link only, not STT semantics");
}

void handle_serial_command(char* line)
{
    trim_line(line);
    if (line[0] == '\0') {
        return;
    }

    ESP_LOGI(TAG, "DEV serial RX command: %s", line);

    if (std::strcmp(line, "wake") == 0) {
        if (!hal_bridge::is_xiaozhi_ready()) {
            ESP_LOGW(TAG, "wake ignored: xiaozhi is not ready");
            return;
        }

        auto& app = Application::GetInstance();
        ESP_LOGI(TAG, "wake requested via USB serial; state=%d", static_cast<int>(app.GetDeviceState()));
        // Use StartListening instead of ToggleChatState so the command is explicit
        // and cannot accidentally stop an already-listening session. It is
        // event-based/thread-safe and opens listening through the normal protocol path.
        app.StartListening();
    } else if (std::strcmp(line, "stop") == 0) {
        auto& app = Application::GetInstance();
        ESP_LOGI(TAG, "stop requested via USB serial; state=%d", static_cast<int>(app.GetDeviceState()));
        // StopListening is required here so the main event loop sends
        // Protocol::SendStopListening() instead of bypassing the server with CloseAudioChannel().
        app.StopListening();
    } else if (std::strcmp(line, "prompt_sample") == 0 || std::strcmp(line, "saytest") == 0) {
        ESP_LOGI(TAG, "%s requested via USB serial", line);
        inject_prompt_sample();
    } else {
        ESP_LOGW(TAG, "unknown dev serial command: %s", line);
    }
}

bool install_usb_serial_jtag_driver_if_needed()
{
    if (usb_serial_jtag_is_driver_installed()) {
        ESP_LOGI(TAG, "USB Serial/JTAG driver already installed; using direct driver reads");
        return true;
    }

    usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    esp_err_t err = usb_serial_jtag_driver_install(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to install USB Serial/JTAG driver for dev serial RX: %s", esp_err_to_name(err));
        return false;
    }

    ESP_LOGI(TAG, "USB Serial/JTAG driver installed for dev serial RX; rx_buffer=%lu tx_buffer=%lu",
             static_cast<unsigned long>(config.rx_buffer_size), static_cast<unsigned long>(config.tx_buffer_size));
    return true;
}

void append_serial_byte(char byte, char* line, size_t& line_len)
{
    if (byte == '\r' || byte == '\n') {
        line[line_len] = '\0';
        handle_serial_command(line);
        line_len = 0;
        line[0] = '\0';
        return;
    }

    if (line_len + 1 >= kSerialLineBufferSize) {
        line[line_len] = '\0';
        ESP_LOGW(TAG, "dev serial command too long, dropping partial line: %s", line);
        line_len = 0;
        line[0] = '\0';
    }

    line[line_len++] = byte;
}

void serial_task(void*)
{
    ESP_LOGW(TAG, "DEV USB Serial/JTAG commands enabled: type 'wake', 'stop', 'prompt_sample', or 'saytest' and press Enter");

    if (!install_usb_serial_jtag_driver_if_needed()) {
        ESP_LOGE(TAG, "dev serial command task stopped: USB Serial/JTAG RX unavailable");
        vTaskDelete(nullptr);
        return;
    }

    char line[kSerialLineBufferSize] = {};
    size_t line_len = 0;
    uint8_t rx[kSerialReadBufferSize] = {};

    while (true) {
        int n = usb_serial_jtag_read_bytes(rx, sizeof(rx), kSerialReadTimeoutTicks);
        if (n <= 0) {
            continue;
        }

        for (int i = 0; i < n; ++i) {
            append_serial_byte(static_cast<char>(rx[i]), line, line_len);
        }
    }
}

}  // namespace

void start_dev_serial_wake_stop_task()
{
    static bool logged = false;
    if (!logged) {
        logged = true;
        ESP_LOGW(TAG,
                 "DEV serial wake/stop is compiled in but intentionally disabled for experiment: "
                 "USB Serial/JTAG driver is not installed and dev_serial_wake_stop task is not created");
    }
}

#else

void start_dev_serial_wake_stop_task() {}

#endif  // STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP
