#include "hal_device_control.h"

#include "hal_celebrate.h"
#include "board/hal_bridge.h"
#include "assets/assets.h"
#include "audio/audio_service.h"
#include <application.h>
#include <ArduinoJson.h>
#include <assets/lang_config.h>
#include <cJSON.h>
#include <esp_app_desc.h>
#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mooncake_log.h>
#include <wifi_manager.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <string>
#include <string_view>
#include <vector>

bool stackchan_mcp_dispatch_tool(const std::string& tool_name, const cJSON* arguments, std::string& out_result);

namespace {

constexpr const char* TAG = "DEV-CTRL";
constexpr size_t kPcmFrameSamples = 960;
constexpr TickType_t kFrameDelayTicks = pdMS_TO_TICKS(60);
constexpr int kListeningWaitMs = 2500;
constexpr int kPostInjectVadWaitMs = 1200;
constexpr int kTrailingSilentFrames = 5;

extern const uint8_t prompt_short_wav_start[] asm("_binary_celebration_short_16k_mono_s16_wav_start");
extern const uint8_t prompt_short_wav_end[] asm("_binary_celebration_short_16k_mono_s16_wav_end");
extern const uint8_t prompt_tts_wav_start[] asm("_binary_celebration_tts_16k_mono_s16_approx3s_wav_start");
extern const uint8_t prompt_tts_wav_end[] asm("_binary_celebration_tts_16k_mono_s16_approx3s_wav_end");

std::once_flag g_register_once;
std::map<std::string, DeviceControlHandler> g_handlers;
std::mutex g_handlers_mutex;
std::atomic_bool g_inject_active{false};

enum class InjectPromptSample : uint8_t {
    Short,
    Tts,
};

struct InjectPromptRequest {
    InjectPromptSample sample = InjectPromptSample::Short;
    bool explicit_stop = false;
};

struct InjectPromptTaskContext {
    InjectPromptRequest request;
};

struct EmbeddedPromptWav {
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

struct SystemRebootContext {
    int delay_ms = 1500;
    char reason[65] = "remote_dev_control";
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

int clamp_int(int value, int min_value, int max_value)
{
    if (value < min_value) {
        return min_value;
    }
    if (value > max_value) {
        return max_value;
    }
    return value;
}

}  // namespace

std::string json_escape(const char* value)
{
    std::string escaped;
    if (!value) {
        return escaped;
    }
    for (const char* p = value; *p; ++p) {
        if (*p == '\\' || *p == '"') {
            escaped.push_back('\\');
        }
        escaped.push_back(*p);
    }
    return escaped;
}

void copy_safe_reboot_reason(char* dest, size_t dest_size, const std::string& reason)
{
    if (dest_size == 0) {
        return;
    }

    const std::string& source = reason.empty() ? std::string("remote_dev_control") : reason;
    size_t pos = 0;
    for (; pos + 1 < dest_size && pos < source.size(); ++pos) {
        const unsigned char ch = static_cast<unsigned char>(source[pos]);
        dest[pos] = (ch >= 32 && ch <= 126) ? static_cast<char>(ch) : '_';
    }
    dest[pos] = '\0';
}

namespace {

const char* device_state_str(int state)
{
    switch (state) {
        case 0: return "unknown";
        case 1: return "starting";
        case 2: return "wifi_configuring";
        case 3: return "idle";
        case 4: return "connecting";
        case 5: return "listening";
        case 6: return "speaking";
        case 7: return "upgrading";
        case 8: return "activating";
        case 9: return "audio_testing";
        case 10: return "fatal_error";
        default: return "unknown";
    }
}

bool parse_wav_pcm16_mono_16k(const uint8_t* wav, size_t wav_size, WavPcmView& out)
{
    if (wav_size < 12 || !fourcc_eq(wav, "RIFF") || !fourcc_eq(wav + 8, "WAVE")) {
        ESP_LOGE(TAG, "inject_prompt WAV parse failed: not RIFF/WAVE");
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
            ESP_LOGE(TAG, "inject_prompt WAV parse failed: truncated chunk");
            return false;
        }

        if (fourcc_eq(chunk, "fmt ")) {
            if (chunk_size < 16) {
                ESP_LOGE(TAG, "inject_prompt WAV parse failed: short fmt chunk");
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
        ESP_LOGE(TAG, "inject_prompt WAV parse failed: missing fmt/data chunk");
        return false;
    }
    if (audio_format != 1 || out.channels != 1 || out.sample_rate != 16000 || out.bits_per_sample != 16) {
        ESP_LOGE(TAG, "inject_prompt WAV unsupported format: fmt=%u ch=%u rate=%lu bits=%u",
                 audio_format, out.channels, static_cast<unsigned long>(out.sample_rate), out.bits_per_sample);
        return false;
    }
    if ((out.bytes & 1U) != 0) {
        ESP_LOGE(TAG, "inject_prompt WAV data has odd byte count: %u", static_cast<unsigned>(out.bytes));
        return false;
    }
    return true;
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

bool parse_sample_arg(const cJSON* args, InjectPromptSample& sample, bool allow_default)
{
    if (!args) {
        return allow_default;
    }
    cJSON* sample_item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "sample");
    if (!sample_item) {
        return allow_default;
    }
    if (!cJSON_IsString(sample_item)) {
        return false;
    }
    const std::string sample_name = sample_item->valuestring ? sample_item->valuestring : "";
    if (sample_name == "short") {
        sample = InjectPromptSample::Short;
        return true;
    }
    if (sample_name == "tts") {
        sample = InjectPromptSample::Tts;
        return true;
    }
    return false;
}

bool parse_explicit_stop_arg(const cJSON* args, bool& explicit_stop)
{
    if (!args) {
        return true;
    }
    cJSON* item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "explicit_stop");
    if (!item) {
        return true;
    }
    if (!cJSON_IsBool(item)) {
        return false;
    }
    explicit_stop = cJSON_IsTrue(item);
    return true;
}

bool select_prompt_wav(InjectPromptSample requested, WavPcmView& wav, const EmbeddedPromptWav*& selected)
{
    const EmbeddedPromptWav short_sample = {"short", "assets/dev_serial/celebration-short-16k-mono-s16.wav",
                                            prompt_short_wav_start, prompt_short_wav_end};
    const EmbeddedPromptWav tts_sample = {"tts", "assets/dev_serial/celebration-tts-16k-mono-s16-approx3s.wav",
                                          prompt_tts_wav_start, prompt_tts_wav_end};

    const EmbeddedPromptWav* candidates[2] = {};
    size_t candidate_count = 0;
    if (requested == InjectPromptSample::Tts) {
        candidates[candidate_count++] = &tts_sample;
    } else {
        candidates[candidate_count++] = &short_sample;
        candidates[candidate_count++] = &tts_sample;
    }

    for (size_t i = 0; i < candidate_count; ++i) {
        WavPcmView parsed;
        const EmbeddedPromptWav* candidate = candidates[i];
        if (parse_wav_pcm16_mono_16k(candidate->start, candidate->end - candidate->start, parsed)) {
            wav = parsed;
            selected = candidate;
            return true;
        }
        ESP_LOGW(TAG, "inject_prompt: embedded WAV rejected: sample_name=%s path=%s", candidate->name, candidate->repo_path);
    }

    selected = nullptr;
    return false;
}

void system_reboot_task(void* arg)
{
    auto* ctx = static_cast<SystemRebootContext*>(arg);
    mclog::tagWarn(TAG, "device reboot scheduled: delay_ms={} reason={}", ctx->delay_ms, ctx->reason);
    vTaskDelay(pdMS_TO_TICKS(ctx->delay_ms));
    mclog::tagWarn(TAG, "device reboot now: reason={}", ctx->reason);
    delete ctx;
    esp_restart();
}

}  // namespace

bool schedule_system_reboot(int delay_ms, const std::string& reason, int* scheduled_delay_ms)
{
    delay_ms = clamp_int(delay_ms, 500, 10000);
    if (scheduled_delay_ms) {
        *scheduled_delay_ms = delay_ms;
    }

    auto* ctx = new (std::nothrow) SystemRebootContext{};
    if (!ctx) {
        mclog::tagError(TAG, "device reboot schedule failed: alloc_failed delay_ms={}", delay_ms);
        return false;
    }

    ctx->delay_ms = delay_ms;
    copy_safe_reboot_reason(ctx->reason, sizeof(ctx->reason), reason);

    BaseType_t rc = xTaskCreate(system_reboot_task, "dev_reboot", 4096, ctx, tskIDLE_PRIORITY + 1, nullptr);
    if (rc != pdPASS) {
        mclog::tagError(TAG, "device reboot schedule failed: task_create_failed delay_ms={} reason={}", ctx->delay_ms, ctx->reason);
        delete ctx;
        return false;
    }

    return true;
}

namespace {

void inject_prompt_task(void* arg)
{
    std::unique_ptr<InjectPromptTaskContext> ctx(static_cast<InjectPromptTaskContext*>(arg));
    const InjectPromptRequest request = ctx ? ctx->request : InjectPromptRequest{};

    if (!hal_bridge::is_xiaozhi_ready()) {
        ESP_LOGW(TAG, "inject_prompt: xiaozhi is not ready");
        g_inject_active.store(false);
        vTaskDelete(nullptr);
        return;
    }

    WavPcmView wav;
    const EmbeddedPromptWav* selected = nullptr;
    if (!select_prompt_wav(request.sample, wav, selected)) {
        ESP_LOGE(TAG, "inject_prompt: failed to select embedded WAV");
        g_inject_active.store(false);
        vTaskDelete(nullptr);
        return;
    }

    const size_t total_samples = wav.bytes / sizeof(int16_t);
    auto& app = Application::GetInstance();
    app.StartListeningDefaultMode();
    wait_for_listening(app);

    auto& audio_service = app.GetAudioService();
    for (size_t pos = 0; pos < total_samples; pos += kPcmFrameSamples) {
        const size_t samples = std::min(kPcmFrameSamples, total_samples - pos);
        const bool accepted = inject_frame(audio_service, wav.data + pos * sizeof(int16_t), samples);
        if (!accepted) {
            ESP_LOGW(TAG, "inject_prompt: PCM frame rejected at pos=%u", static_cast<unsigned>(pos));
        }
        vTaskDelay(kFrameDelayTicks);
    }

    for (int i = 0; i < kTrailingSilentFrames; ++i) {
        std::vector<int16_t> silence(kPcmFrameSamples, 0);
        if (!audio_service.InjectPcmFrameToSendQueue(std::move(silence))) {
            ESP_LOGW(TAG, "inject_prompt: trailing silence frame rejected index=%d", i);
        }
        vTaskDelay(kFrameDelayTicks);
    }

    vTaskDelay(pdMS_TO_TICKS(kPostInjectVadWaitMs));
    if (request.explicit_stop) {
        app.StopListening();
    }

    g_inject_active.store(false);
    vTaskDelete(nullptr);
}

DeviceControlResult make_success(std::string result_json = "{\"ok\":true}")
{
    DeviceControlResult result;
    result.success = true;
    result.result_json = std::move(result_json);
    return result;
}

DeviceControlResult make_error(const char* error)
{
    DeviceControlResult result;
    result.success = false;
    result.error_message = error ? error : "unknown_error";
    return result;
}

DeviceControlResult handle_status(const cJSON*)
{
    auto& wifi = WifiManager::GetInstance();
    auto& app = Application::GetInstance();
    const esp_app_desc_t* app_desc = esp_app_get_description();

    ArduinoJson::JsonDocument doc;
    doc["ok"] = true;
    doc["version"] = FIRMWARE_VERSION;
    doc["app_version"] = app_desc ? app_desc->version : "";
    doc["project_name"] = app_desc ? app_desc->project_name : "";
    doc["idf_version"] = app_desc ? app_desc->idf_ver : "";
    doc["ip"] = wifi.GetIpAddress();
    doc["state"] = device_state_str(static_cast<int>(app.GetDeviceState()));
    doc["heap_free"] = esp_get_free_heap_size();
    doc["wifi_rssi"] = wifi.GetRssi();
    doc["xiaozhi_ready"] = hal_bridge::is_xiaozhi_ready();

    std::string out;
    ArduinoJson::serializeJson(doc, out);
    return make_success(out);
}

DeviceControlResult handle_wake(const cJSON*)
{
    if (!hal_bridge::is_xiaozhi_ready()) {
        return make_error("not_ready");
    }
    Application::GetInstance().StartListening();
    return make_success();
}

DeviceControlResult handle_stop(const cJSON*)
{
    if (!hal_bridge::is_xiaozhi_ready()) {
        return make_error("not_ready");
    }
    Application::GetInstance().StopListening();
    return make_success();
}

DeviceControlResult handle_toggle(const cJSON*)
{
    if (!hal_bridge::is_xiaozhi_ready()) {
        return make_error("not_ready");
    }
    Application::GetInstance().ToggleChatState();
    return make_success();
}

DeviceControlResult handle_reboot(const cJSON* args)
{
    bool confirm = false;
    int delay_ms = 1500;
    std::string reason = "remote_dev_control";

    if (args) {
        cJSON* item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "confirm");
        if (!item || !cJSON_IsBool(item) || !cJSON_IsTrue(item)) {
            return make_error("confirm_required");
        }
        confirm = true;

        item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "delay_ms");
        if (item && cJSON_IsNumber(item)) {
            delay_ms = item->valueint;
        }
        item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "reason");
        if (item && cJSON_IsString(item) && item->valuestring) {
            reason = item->valuestring;
        }
    }

    if (!confirm) {
        return make_error("confirm_required");
    }

    char scheduled_reason[65];
    copy_safe_reboot_reason(scheduled_reason, sizeof(scheduled_reason), reason);
    int actual_delay_ms = delay_ms;
    if (!schedule_system_reboot(delay_ms, scheduled_reason, &actual_delay_ms)) {
        return make_error("schedule_failed");
    }

    return make_success(std::string("{\"ok\":true,\"accepted\":true,\"delay_ms\":") +
                        std::to_string(actual_delay_ms) +
                        ",\"reason\":\"" + json_escape(scheduled_reason) + "\"}");
}

DeviceControlResult handle_inject_prompt(const cJSON* args)
{
    if (!hal_bridge::is_xiaozhi_ready()) {
        return make_error("not_ready");
    }

    InjectPromptRequest request;
    if (!parse_sample_arg(args, request.sample, true)) {
        return make_error("invalid_sample");
    }
    if (!parse_explicit_stop_arg(args, request.explicit_stop)) {
        return make_error("invalid_explicit_stop");
    }
    if (g_inject_active.exchange(true)) {
        return make_error("inject_already_active");
    }

    auto* ctx = new (std::nothrow) InjectPromptTaskContext{};
    if (!ctx) {
        g_inject_active.store(false);
        return make_error("alloc_failed");
    }
    ctx->request = request;

    BaseType_t ret = xTaskCreatePinnedToCore(inject_prompt_task, "inject_prompt", 4096, ctx, tskIDLE_PRIORITY + 3, nullptr, 1);
    if (ret != pdPASS) {
        delete ctx;
        g_inject_active.store(false);
        return make_error("task_create_failed");
    }

    return make_success(std::string("{\"ok\":true,\"message\":\"prompt injection started\",\"sample\":\"") +
                        (request.sample == InjectPromptSample::Tts ? "tts" : "short") + "\"}");
}

DeviceControlResult handle_prompt_sample(const cJSON* args)
{
    return handle_inject_prompt(args);
}

DeviceControlResult handle_celebrate(const cJSON* args)
{
    std::string style = "cheer";
    int duration_ms = 3200;
    int intensity = 2;
    bool sound = false;

    if (args) {
        cJSON* item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "style");
        if (item && cJSON_IsString(item) && item->valuestring) {
            style = item->valuestring;
        }
        item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "duration_ms");
        if (item && cJSON_IsNumber(item)) {
            duration_ms = item->valueint;
        }
        item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "intensity");
        if (item && cJSON_IsNumber(item)) {
            intensity = item->valueint;
        }
        item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "sound");
        if (item && cJSON_IsBool(item)) {
            sound = cJSON_IsTrue(item);
        }
    }

    std::string error;
    if (!start_celebrate_modifier(style, duration_ms, intensity, sound, &error)) {
        return make_error(error.empty() ? "celebrate_failed" : error.c_str());
    }
    return make_success();
}

DeviceControlResult handle_play_sound(const cJSON* args)
{
    if (!args) {
        return make_error("missing_sound");
    }

    cJSON* item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "sound");
    if (!item || !cJSON_IsString(item) || !item->valuestring || item->valuestring[0] == '\0') {
        return make_error("missing_sound");
    }

    const std::string sound = item->valuestring;
    if (sound == "camera_shutter") {
        hal_bridge::app_play_sound(OGG_CAMERA_SHUTTER);
    } else if (sound == "new_notification") {
        hal_bridge::app_play_sound(OGG_NEW_NOTIFICATION);
    } else {
        return make_error("unknown_sound");
    }

    return make_success();
}

DeviceControlResult handle_mcp_call(const cJSON* args)
{
    if (!args) {
        return make_error("missing_tool");
    }
    cJSON* tool_item = cJSON_GetObjectItem(const_cast<cJSON*>(args), "tool");
    if (!tool_item || !cJSON_IsString(tool_item) || !tool_item->valuestring) {
        return make_error("missing_tool");
    }

    std::string tool_name = tool_item->valuestring;
    if (tool_name.rfind("self.", 0) != 0) {
        tool_name = std::string("self.robot.") + tool_name;
    }

    DeviceControlResult result;
    if (!dispatch_stackchan_mcp_tool(tool_name.c_str(),
                                     cJSON_GetObjectItem(const_cast<cJSON*>(args), "arguments"),
                                     &result)) {
        return make_error("unknown_tool");
    }
    return result;
}

DeviceControlResult handle_capabilities(const cJSON*)
{
    return make_success(
        "{\"ok\":true,\"transport\":\"unified_dispatch\",\"commands\":[\"status\",\"wake\",\"stop\",\"toggle\",\"reboot\",\"prompt_sample\",\"inject_prompt\",\"celebrate\",\"play_sound\",\"mcp_call\",\"capabilities\"],\"mcp_tools\":[\"self.robot.get_head_angles\",\"self.robot.set_head_angles\",\"self.robot.set_head_targets\",\"self.robot.set_led_color\",\"self.robot.celebrate\",\"self.robot.create_reminder\",\"self.robot.get_reminders\",\"self.robot.stop_reminder\",\"self.system.reboot\"]}");
}

void register_handler(const char* command, DeviceControlHandler handler)
{
    std::lock_guard<std::mutex> lock(g_handlers_mutex);
    g_handlers[command] = handler;
}

void ensure_registered()
{
    std::call_once(g_register_once, []() {
        register_handler("status", handle_status);
        register_handler("wake", handle_wake);
        register_handler("stop", handle_stop);
        register_handler("toggle", handle_toggle);
        register_handler("reboot", handle_reboot);
        register_handler("inject_prompt", handle_inject_prompt);
        register_handler("prompt_sample", handle_prompt_sample);
        register_handler("celebrate", handle_celebrate);
        register_handler("play_sound", handle_play_sound);
        register_handler("mcp_call", handle_mcp_call);
        register_handler("capabilities", handle_capabilities);
    });
}

}  // namespace

void register_default_device_control_handlers()
{
    ensure_registered();
}

DeviceControlResult dispatch_device_control(const char* command, const cJSON* args)
{
    ensure_registered();
    if (!command || command[0] == '\0') {
        return make_error("missing_command");
    }

    std::lock_guard<std::mutex> lock(g_handlers_mutex);
    auto it = g_handlers.find(command);
    if (it == g_handlers.end() || !it->second) {
        return make_error("unknown_command");
    }
    return it->second(args);
}

DeviceControlResult dispatch_device_control(const char* command, const char* args_json)
{
    cJSON* root = nullptr;
    if (args_json && args_json[0] != '\0') {
        root = cJSON_Parse(args_json);
        if (!root) {
            return make_error("invalid_json");
        }
    }

    DeviceControlResult result = dispatch_device_control(command, root);
    if (root) {
        cJSON_Delete(root);
    }
    return result;
}

bool dispatch_stackchan_mcp_tool(const char* tool_name, const cJSON* arguments, DeviceControlResult* out_result)
{
    if (!tool_name || tool_name[0] == '\0') {
        if (out_result) {
            *out_result = make_error("missing_tool");
        }
        return false;
    }

    std::string result;
    const bool found = stackchan_mcp_dispatch_tool(tool_name, arguments, result);
    if (!found) {
        if (out_result) {
            *out_result = make_error("unknown_tool");
        }
        return false;
    }

    DeviceControlResult normalized;
    if (result == "ok" || result == "true" || result.empty()) {
        normalized = make_success();
    } else if (result[0] == '{' || result[0] == '[') {
        normalized = make_success(std::string("{\"ok\":true,\"result\":") + result + "}");
    } else {
        normalized = make_success(std::string("{\"ok\":true,\"result\":\"") + json_escape(result.c_str()) + "\"}");
    }

    if (out_result) {
        *out_result = std::move(normalized);
    }
    return true;
}
