/*
 * Dev-only LAN HTTP control endpoint.
 * Intentionally not enabled by STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP alone.
 * Build with both -DSTACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP=ON and
 * -DSTACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL=ON to enable this endpoint.
 */
#include "hal_dev_local_control.h"

#if defined(STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP) && defined(STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL)

#include "hal_celebrate.h"
#include "board/hal_bridge.h"
#include "assets/assets.h"
#include "audio/audio_service.h"
#include <application.h>
#include <ArduinoJson.h>
#include <assets/lang_config.h>
#include <atomic>
#include <cJSON.h>
#include <cstring>
#include <esp_err.h>
#include <esp_http_server.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <esp_system.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mooncake_log.h>
#include <string>
#include <string_view>
#include <wifi_manager.h>

#ifndef STACKCHAN_DEV_LOCAL_CONTROL_TOKEN
#define STACKCHAN_DEV_LOCAL_CONTROL_TOKEN "stackchan-dev"
#endif

namespace {

constexpr const char* TAG = "DEV-HTTP";
constexpr int kDevHttpPort = 18080;
constexpr int kMaxBodyBytes = 512;
constexpr int kMaxMcpBodyBytes = 1024;
constexpr const char* kTokenHeader = "X-StackChan-Dev-Token";
httpd_handle_t g_server = nullptr;

const char* status_text(int status)
{
    switch (status) {
        case 200:
            return "200 OK";
        case 400:
            return "400 Bad Request";
        case 401:
            return "401 Unauthorized";
        case 409:
            return "409 Conflict";
        case 413:
            return "413 Payload Too Large";
        default:
            return "500 Internal Server Error";
    }
}

void send_json(httpd_req_t* req, int status, const char* body)
{
    httpd_resp_set_status(req, status_text(status));
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, body);
}

void send_error(httpd_req_t* req, int status, const char* error)
{
    std::string body = std::string("{\"ok\":false,\"error\":\"") + error + "\"}";
    send_json(req, status, body.c_str());
}

bool check_token(httpd_req_t* req)
{
    const size_t token_len = httpd_req_get_hdr_value_len(req, kTokenHeader);
    if (token_len == 0 || token_len >= 96) {
        return false;
    }

    char token[96] = {};
    if (httpd_req_get_hdr_value_str(req, kTokenHeader, token, sizeof(token)) != ESP_OK) {
        return false;
    }
    return std::strcmp(token, STACKCHAN_DEV_LOCAL_CONTROL_TOKEN) == 0;
}

esp_err_t celebrate_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    if (req->content_len > kMaxBodyBytes) {
        send_error(req, 413, "body_too_large");
        return ESP_OK;
    }

    std::string body;
    body.resize(req->content_len);
    int received = 0;
    while (received < req->content_len) {
        int ret = httpd_req_recv(req, body.data() + received, req->content_len - received);
        if (ret <= 0) {
            if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            send_error(req, 400, "body_read_failed");
            return ESP_OK;
        }
        received += ret;
    }

    std::string style = "cheer";
    int duration_ms = 3200;
    int intensity = 2;
    bool sound = false;

    if (!body.empty()) {
        ArduinoJson::JsonDocument doc;
        auto err = ArduinoJson::deserializeJson(doc, body);
        if (err) {
            send_error(req, 400, "invalid_json");
            return ESP_OK;
        }

        if (doc["style"].is<std::string>()) {
            style = doc["style"].as<std::string>();
        }
        if (doc["duration_ms"].is<int>()) {
            duration_ms = doc["duration_ms"].as<int>();
        }
        if (doc["intensity"].is<int>()) {
            intensity = doc["intensity"].as<int>();
        }
        if (doc["sound"].is<bool>()) {
            sound = doc["sound"].as<bool>();
        }
    }

    std::string error;
    if (!start_celebrate_modifier(style, duration_ms, intensity, sound, &error)) {
        if (error.empty()) {
            error = "celebrate_failed";
        }
        send_error(req, 409, error.c_str());
        return ESP_OK;
    }

    send_json(req, 200, "{\"ok\":true}");
    return ESP_OK;
}

const char* device_state_str(int state)
{
    switch (state) {
        case 0:  return "unknown";
        case 1:  return "starting";
        case 2:  return "wifi_configuring";
        case 3:  return "idle";
        case 4:  return "connecting";
        case 5:  return "listening";
        case 6:  return "speaking";
        case 7:  return "upgrading";
        case 8:  return "activating";
        case 9:  return "audio_testing";
        case 10: return "fatal_error";
        default: return "unknown";
    }
}

esp_err_t mcp_call_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    if (req->content_len > kMaxMcpBodyBytes) {
        send_error(req, 413, "body_too_large");
        return ESP_OK;
    }

    std::string body;
    body.resize(req->content_len);
    int received = 0;
    while (received < req->content_len) {
        int ret = httpd_req_recv(req, body.data() + received, req->content_len - received);
        if (ret <= 0) {
            if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            send_error(req, 400, "body_read_failed");
            return ESP_OK;
        }
        received += ret;
    }

    cJSON* root = cJSON_ParseWithLength(body.data(), body.size());
    if (!root) {
        send_error(req, 400, "invalid_json");
        return ESP_OK;
    }

    cJSON* tool_item = cJSON_GetObjectItem(root, "tool");
    if (!tool_item || !cJSON_IsString(tool_item)) {
        cJSON_Delete(root);
        send_error(req, 400, "missing_tool");
        return ESP_OK;
    }

    std::string tool_name = tool_item->valuestring;
    cJSON* arguments = cJSON_GetObjectItem(root, "arguments");

    mclog::tagInfo(TAG, "mcp/call: tool={}", tool_name);

    std::string result;
    bool found = stackchan_mcp_dispatch_tool(tool_name, arguments, result);
    cJSON_Delete(root);

    if (!found) {
        send_error(req, 400, "unknown_tool");
        return ESP_OK;
    }

    if (result != "ok" && result != "true" && !result.empty() &&
        result[0] != '{' && result[0] != '[' && result.find_first_of("0123456789") != 0) {
        send_error(req, 409, result.c_str());
        return ESP_OK;
    }

    if (!result.empty() && result != "ok") {
        std::string resp = std::string("{\"ok\":true,\"result\":") +
                           (result[0] == '{' || result[0] == '[' ? result : ("\"" + result + "\"")) + "}";
        send_json(req, 200, resp.c_str());
    } else {
        send_json(req, 200, "{\"ok\":true}");
    }
    return ESP_OK;
}

esp_err_t wake_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    if (!hal_bridge::is_xiaozhi_ready()) {
        send_error(req, 409, "not_ready");
        return ESP_OK;
    }

    auto& app = Application::GetInstance();
    mclog::tagInfo(TAG, "wake requested via HTTP; state={}", static_cast<int>(app.GetDeviceState()));
    app.StartListening();

    send_json(req, 200, "{\"ok\":true}");
    return ESP_OK;
}

esp_err_t stop_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    if (!hal_bridge::is_xiaozhi_ready()) {
        send_error(req, 409, "not_ready");
        return ESP_OK;
    }

    auto& app = Application::GetInstance();
    mclog::tagInfo(TAG, "stop requested via HTTP; state={}", static_cast<int>(app.GetDeviceState()));
    app.StopListening();

    send_json(req, 200, "{\"ok\":true}");
    return ESP_OK;
}

esp_err_t status_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    auto& wifi = WifiManager::GetInstance();
    auto& app  = Application::GetInstance();

    ArduinoJson::JsonDocument doc;
    doc["version"]   = FIRMWARE_VERSION;
    doc["ip"]        = wifi.GetIpAddress();
    doc["state"]     = device_state_str(static_cast<int>(app.GetDeviceState()));
    doc["heap_free"] = esp_get_free_heap_size();
    doc["wifi_rssi"] = wifi.GetRssi();

    std::string out;
    ArduinoJson::serializeJson(doc, out);

    send_json(req, 200, out.c_str());
    return ESP_OK;
}

// ─── play_sound handler ─────────────────────────────────────────────────────

esp_err_t play_sound_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    if (req->content_len > kMaxBodyBytes) {
        send_error(req, 413, "body_too_large");
        return ESP_OK;
    }

    std::string body;
    body.resize(req->content_len);
    int received = 0;
    while (received < req->content_len) {
        int ret = httpd_req_recv(req, body.data() + received, req->content_len - received);
        if (ret <= 0) {
            if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            send_error(req, 400, "body_read_failed");
            return ESP_OK;
        }
        received += ret;
    }

    ArduinoJson::JsonDocument doc;
    auto err = ArduinoJson::deserializeJson(doc, body);
    if (err) {
        send_error(req, 400, "invalid_json");
        return ESP_OK;
    }

    if (!doc["sound"].is<std::string>()) {
        send_error(req, 400, "missing_sound");
        return ESP_OK;
    }
    std::string sound_name = doc["sound"].as<std::string>();

    const std::string_view* sound_data = nullptr;

    // Map from name to sound constant
    if (sound_name == "success")               sound_data = &Lang::Sounds::OGG_SUCCESS;
    else if (sound_name == "welcome")          sound_data = &Lang::Sounds::OGG_WELCOME;
    else if (sound_name == "activation")       sound_data = &Lang::Sounds::OGG_ACTIVATION;
    else if (sound_name == "exclamation")      sound_data = &Lang::Sounds::OGG_EXCLAMATION;
    else if (sound_name == "popup")            sound_data = &Lang::Sounds::OGG_POPUP;
    else if (sound_name == "vibration")        sound_data = &Lang::Sounds::OGG_VIBRATION;
    else if (sound_name == "upgrade")          sound_data = &Lang::Sounds::OGG_UPGRADE;
    else if (sound_name == "low_battery")      sound_data = &Lang::Sounds::OGG_LOW_BATTERY;
    else if (sound_name == "err_pin")          sound_data = &Lang::Sounds::OGG_ERR_PIN;
    else if (sound_name == "err_reg")          sound_data = &Lang::Sounds::OGG_ERR_REG;
    else if (sound_name == "wificonfig")       sound_data = &Lang::Sounds::OGG_WIFICONFIG;
    else if (sound_name == "camera_shutter")   sound_data = &OGG_CAMERA_SHUTTER;
    else if (sound_name == "new_notification") sound_data = &OGG_NEW_NOTIFICATION;
    else if (sound_name == "0")               sound_data = &Lang::Sounds::OGG_0;
    else if (sound_name == "1")               sound_data = &Lang::Sounds::OGG_1;
    else if (sound_name == "2")               sound_data = &Lang::Sounds::OGG_2;
    else if (sound_name == "3")               sound_data = &Lang::Sounds::OGG_3;
    else if (sound_name == "4")               sound_data = &Lang::Sounds::OGG_4;
    else if (sound_name == "5")               sound_data = &Lang::Sounds::OGG_5;
    else if (sound_name == "6")               sound_data = &Lang::Sounds::OGG_6;
    else if (sound_name == "7")               sound_data = &Lang::Sounds::OGG_7;
    else if (sound_name == "8")               sound_data = &Lang::Sounds::OGG_8;
    else if (sound_name == "9")               sound_data = &Lang::Sounds::OGG_9;
    else {
        send_error(req, 400, "unknown_sound");
        return ESP_OK;
    }

    hal_bridge::app_play_sound(*sound_data);
    mclog::tagInfo(TAG, "play_sound: {}", sound_name);
    send_json(req, 200, "{\"ok\":true}");
    return ESP_OK;
}

// ─── inject_prompt handler ──────────────────────────────────────────────────

static std::atomic_bool g_inject_active{false};

constexpr size_t kPcmFrameSamples = 960;
constexpr TickType_t kFrameDelayTicks = pdMS_TO_TICKS(60);
constexpr int kListeningWaitMs = 2500;
constexpr int kPostInjectVadWaitMs = 1200;
constexpr int kTrailingSilentFrames = 5;

extern const uint8_t prompt_wav_start[] asm("_binary_celebration_tts_16k_mono_s16_approx3s_wav_start");
extern const uint8_t prompt_wav_end[] asm("_binary_celebration_tts_16k_mono_s16_approx3s_wav_end");

struct WavPcmView {
    const uint8_t* data = nullptr;
    size_t bytes = 0;
    uint16_t channels = 0;
    uint32_t sample_rate = 0;
    uint16_t bits_per_sample = 0;
};

uint16_t local_read_le16(const uint8_t* p)
{
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

uint32_t local_read_le32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

bool local_fourcc_eq(const uint8_t* p, const char* s)
{
    return p[0] == static_cast<uint8_t>(s[0]) && p[1] == static_cast<uint8_t>(s[1]) &&
           p[2] == static_cast<uint8_t>(s[2]) && p[3] == static_cast<uint8_t>(s[3]);
}

bool local_parse_wav_pcm16_mono_16k(const uint8_t* wav, size_t wav_size, WavPcmView& out)
{
    if (wav_size < 12 || !local_fourcc_eq(wav, "RIFF") || !local_fourcc_eq(wav + 8, "WAVE")) {
        ESP_LOGE(TAG, "inject_prompt WAV parse failed: not RIFF/WAVE");
        return false;
    }

    bool have_fmt = false;
    bool have_data = false;
    uint16_t audio_format = 0;
    size_t offset = 12;
    while (offset + 8 <= wav_size) {
        const uint8_t* chunk = wav + offset;
        const uint32_t chunk_size = local_read_le32(chunk + 4);
        const size_t payload = offset + 8;
        if (payload > wav_size || chunk_size > wav_size - payload) {
            ESP_LOGE(TAG, "inject_prompt WAV parse failed: truncated chunk");
            return false;
        }

        if (local_fourcc_eq(chunk, "fmt ")) {
            if (chunk_size < 16) {
                ESP_LOGE(TAG, "inject_prompt WAV parse failed: short fmt chunk");
                return false;
            }
            audio_format = local_read_le16(wav + payload);
            out.channels = local_read_le16(wav + payload + 2);
            out.sample_rate = local_read_le32(wav + payload + 4);
            out.bits_per_sample = local_read_le16(wav + payload + 14);
            have_fmt = true;
        } else if (local_fourcc_eq(chunk, "data")) {
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

void inject_prompt_task(void*)
{
    if (!hal_bridge::is_xiaozhi_ready()) {
        ESP_LOGW(TAG, "inject_prompt: xiaozhi is not ready");
        g_inject_active.store(false);
        vTaskDelete(nullptr);
        return;
    }

    WavPcmView wav;
    if (!local_parse_wav_pcm16_mono_16k(prompt_wav_start,
                                         static_cast<size_t>(prompt_wav_end - prompt_wav_start), wav)) {
        ESP_LOGE(TAG, "inject_prompt: failed to parse embedded WAV");
        g_inject_active.store(false);
        vTaskDelete(nullptr);
        return;
    }

    const size_t total_samples = wav.bytes / sizeof(int16_t);
    const size_t prompt_frames = (total_samples + kPcmFrameSamples - 1) / kPcmFrameSamples;

    auto& app = Application::GetInstance();
    ESP_LOGW(TAG, "inject_prompt: starting injection, frames=%u", static_cast<unsigned>(prompt_frames));
    app.StartListening();

    // Wait for listening state
    {
        const int step_ms = 50;
        bool listening = false;
        for (int waited_ms = 0; waited_ms < kListeningWaitMs; waited_ms += step_ms) {
            if (app.GetDeviceState() == kDeviceStateListening) {
                listening = true;
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(step_ms));
        }
        if (!listening) {
            ESP_LOGW(TAG, "inject_prompt: listening state not observed after %d ms; injecting anyway", kListeningWaitMs);
        }
    }

    auto& audio_service = app.GetAudioService();
    size_t injected_frames = 0;
    for (size_t pos = 0; pos < total_samples; pos += kPcmFrameSamples) {
        const size_t samples = std::min(kPcmFrameSamples, total_samples - pos);
        std::vector<int16_t> frame(kPcmFrameSamples, 0);
        for (size_t i = 0; i < samples; ++i) {
            frame[i] = static_cast<int16_t>(local_read_le16(wav.data + (pos + i) * sizeof(int16_t)));
        }
        audio_service.InjectPcmFrameToSendQueue(std::move(frame));
        ++injected_frames;
        vTaskDelay(kFrameDelayTicks);
    }

    for (int i = 0; i < kTrailingSilentFrames; ++i) {
        std::vector<int16_t> silence(kPcmFrameSamples, 0);
        audio_service.InjectPcmFrameToSendQueue(std::move(silence));
        ++injected_frames;
        vTaskDelay(kFrameDelayTicks);
    }

    ESP_LOGI(TAG, "inject_prompt: injected %u frames, waiting %d ms for VAD",
             static_cast<unsigned>(injected_frames), kPostInjectVadWaitMs);
    vTaskDelay(pdMS_TO_TICKS(kPostInjectVadWaitMs));
    app.StopListening();
    ESP_LOGI(TAG, "inject_prompt: done");

    g_inject_active.store(false);
    vTaskDelete(nullptr);
}

esp_err_t inject_prompt_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }

    if (!hal_bridge::is_xiaozhi_ready()) {
        send_error(req, 409, "not_ready");
        return ESP_OK;
    }

    if (g_inject_active.exchange(true)) {
        send_error(req, 409, "inject_already_active");
        return ESP_OK;
    }

    ESP_LOGW(TAG, "inject_prompt: free_heap=%u, internal=%u, attempting xTaskCreate",
             (unsigned)xPortGetFreeHeapSize(),
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    BaseType_t ret = xTaskCreatePinnedToCore(inject_prompt_task, "inject_prompt", 4096,
                                              nullptr, tskIDLE_PRIORITY + 3, nullptr, 1);
    ESP_LOGW(TAG, "inject_prompt: xTaskCreate ret=%d", (int)ret);
    if (ret != pdPASS) {
        g_inject_active.store(false);
        char errbuf[128];
        snprintf(errbuf, sizeof(errbuf), "{\"ok\":false,\"error\":\"task_create_failed\",\"ret\":%d,\"heap\":%u,\"internal\":%u}",
                 (int)ret, (unsigned)xPortGetFreeHeapSize(), (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
        httpd_resp_set_type(req, "application/json");
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_sendstr(req, errbuf);
        return ESP_OK;
    }

    send_json(req, 200, "{\"ok\":true,\"message\":\"prompt injection started\"}");
    return ESP_OK;
}

}  // namespace

static void do_start_server()
{
    if (g_server != nullptr) {
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = kDevHttpPort;
    config.ctrl_port = kDevHttpPort + 1;
    config.uri_match_fn = httpd_uri_match_wildcard;

    esp_err_t err = httpd_start(&g_server, &config);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "dev local HTTP server failed to start on port %d: %s", kDevHttpPort, esp_err_to_name(err));
        g_server = nullptr;
        return;
    }

    httpd_uri_t celebrate_uri = {};
    celebrate_uri.uri = "/dev/celebrate";
    celebrate_uri.method = HTTP_POST;
    celebrate_uri.handler = celebrate_handler;
    celebrate_uri.user_ctx = nullptr;
    err = httpd_register_uri_handler(g_server, &celebrate_uri);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "failed to register POST /dev/celebrate: %s", esp_err_to_name(err));
        httpd_stop(g_server);
        g_server = nullptr;
        return;
    }

    httpd_uri_t mcp_call_uri = {};
    mcp_call_uri.uri      = "/dev/mcp/call";
    mcp_call_uri.method   = HTTP_POST;
    mcp_call_uri.handler  = mcp_call_handler;
    mcp_call_uri.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &mcp_call_uri);

    httpd_uri_t wake_uri = {};
    wake_uri.uri      = "/dev/wake";
    wake_uri.method   = HTTP_POST;
    wake_uri.handler  = wake_handler;
    wake_uri.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &wake_uri);

    httpd_uri_t stop_uri = {};
    stop_uri.uri      = "/dev/stop";
    stop_uri.method   = HTTP_POST;
    stop_uri.handler  = stop_handler;
    stop_uri.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &stop_uri);

    httpd_uri_t status_uri = {};
    status_uri.uri      = "/dev/status";
    status_uri.method   = HTTP_GET;
    status_uri.handler  = status_handler;
    status_uri.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &status_uri);

    httpd_uri_t play_sound_uri = {};
    play_sound_uri.uri = "/dev/play_sound";
    play_sound_uri.method = HTTP_POST;
    play_sound_uri.handler = play_sound_handler;
    play_sound_uri.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &play_sound_uri);

    httpd_uri_t inject_prompt_uri = {};
    inject_prompt_uri.uri = "/dev/inject_prompt";
    inject_prompt_uri.method = HTTP_POST;
    inject_prompt_uri.handler = inject_prompt_handler;
    inject_prompt_uri.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &inject_prompt_uri);

    ESP_LOGW(TAG, "DEV local HTTP control enabled on port %d: /dev/celebrate /dev/mcp/call /dev/wake /dev/stop /dev/status /dev/play_sound /dev/inject_prompt", kDevHttpPort);
}

static bool sta_has_ip()
{
    esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (!netif) {
        return false;
    }

    esp_netif_ip_info_t ip_info;
    return esp_netif_get_ip_info(netif, &ip_info) == ESP_OK && ip_info.ip.addr != 0;
}

static void http_deferred_start_task(void*)
{
    constexpr int kMaxWaitMs = 60000;
    constexpr int kPollIntervalMs = 500;

    for (int waited = 0; waited < kMaxWaitMs; waited += kPollIntervalMs) {
        vTaskDelay(pdMS_TO_TICKS(kPollIntervalMs));

        if (sta_has_ip()) {
            do_start_server();
            vTaskDelete(nullptr);
            return;
        }
    }

    ESP_LOGW(TAG, "HTTP deferred start timed out after %d ms before STA IP, giving up", kMaxWaitMs);
    vTaskDelete(nullptr);
}

void start_dev_local_control_server()
{
    xTaskCreatePinnedToCore(http_deferred_start_task, "http_defer", 4096, nullptr, tskIDLE_PRIORITY + 2, nullptr, 0);
}

#else

void start_dev_local_control_server() {}

#endif  // STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP && STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL
