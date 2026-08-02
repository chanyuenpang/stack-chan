#include "usb_uac_mvp.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include <esp_log.h>
#include <sdkconfig.h>

#if CONFIG_STACKCHAN_USB_UAC_MVP
#include "audio_codec.h"
#include "board.h"
#include "cJSON.h"
#include "display.h"
#include "hal.h"
#include "board/stackchan_display.h"
#include "hal_dev_local_control.h"
#include "stackchan/stackchan.h"
#include "tusb.h"
#include "uac_descriptors.h"
#include "usb_device_uac.h"

#include <esp_mac.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

namespace {
constexpr const char* TAG = "USB-COMPANION";
constexpr uint32_t kProtocolVersion = 1;
constexpr size_t kMaxFrameBytes = 511;
constexpr size_t kFrameStorageBytes = kMaxFrameBytes + 1;
constexpr size_t kMaxSpeechTextBytes = 320;
constexpr uint8_t kCdcInterface = 0;
constexpr uint32_t kManualLedEffectMs = 1500;

struct RgbColor {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
};

constexpr RgbColor kStandbyLed{24, 24, 24};
constexpr RgbColor kActiveLed{0, 48, 0};
constexpr RgbColor kPartialLed{48, 32, 0};
constexpr RgbColor kFaultLed{48, 0, 0};

enum InterfaceNumber : uint8_t {
    kInterfaceAudioControl = 0,
    kInterfaceAudioSpeaker,
    kInterfaceAudioMicrophone,
    kInterfaceCdcControl,
    kInterfaceCdcData,
    kInterfaceCount,
};

constexpr uint8_t kEndpointAudioOut = 0x01;
constexpr uint8_t kEndpointAudioFeedback = 0x81;
constexpr uint8_t kEndpointAudioIn = 0x82;
constexpr uint8_t kEndpointCdcNotification = 0x83;
constexpr uint8_t kEndpointCdcOut = 0x04;
constexpr uint8_t kEndpointCdcIn = 0x84;

static_assert(kInterfaceAudioSpeaker == 1);
static_assert(kInterfaceAudioMicrophone == 2);
static_assert((kEndpointCdcIn & 0x0f) <= 5);

struct ProtocolFrame {
    uint16_t length = 0;
    bool oversized = false;
    char data[kFrameStorageBytes]{};
};

AudioCodec* s_codec = nullptr;
std::mutex s_input_mutex;
std::mutex s_output_mutex;
std::mutex s_cdc_write_mutex;
std::mutex s_led_mutex;
std::vector<int16_t> s_input_buffer;
std::vector<int16_t> s_capture_buffer;
std::vector<int16_t> s_output_buffer;
std::atomic_bool s_microphone_enabled{false};
std::atomic_bool s_speaker_enabled{false};
std::atomic_bool s_usb_mounted{false};
std::atomic_bool s_usb_suspended{false};
std::atomic_uint32_t s_audio_state_revision{1};
std::atomic_uint32_t s_event_sequence{0};
QueueHandle_t s_command_queue = nullptr;
QueueHandle_t s_tx_queue = nullptr;
int s_head_touch_connection = -1;
bool s_led_fault = false;
bool s_manual_led_active = false;
TickType_t s_manual_led_deadline = 0;

RgbColor audio_status_led_color()
{
    if (s_led_fault) {
        return kFaultLed;
    }
    const bool microphone = s_microphone_enabled.load();
    const bool speaker = s_speaker_enabled.load();
    if (microphone && speaker) {
        return kActiveLed;
    }
    if (microphone || speaker) {
        return kPartialLed;
    }
    return kStandbyLed;
}

void apply_led_color(const RgbColor& color)
{
    LvglLockGuard lock;
    GetStackChan().leftNeonLight().snapColor(color.red, color.green, color.blue);
    GetStackChan().rightNeonLight().snapColor(color.red, color.green, color.blue);
}

void apply_audio_status_led()
{
    std::lock_guard<std::mutex> lock(s_led_mutex);
    s_manual_led_active = false;
    apply_led_color(audio_status_led_color());
}

void restore_audio_status_led()
{
    std::lock_guard<std::mutex> lock(s_led_mutex);
    if (!s_manual_led_active ||
        static_cast<int32_t>(xTaskGetTickCount() - s_manual_led_deadline) < 0) {
        return;
    }
    s_manual_led_active = false;
    apply_led_color(audio_status_led_color());
}

void show_temporary_led(const RgbColor& color)
{
    std::lock_guard<std::mutex> lock(s_led_mutex);
    s_manual_led_active = true;
    s_manual_led_deadline = xTaskGetTickCount() + pdMS_TO_TICKS(kManualLedEffectMs);
    apply_led_color(color);
}

void show_fault_led()
{
    std::lock_guard<std::mutex> lock(s_led_mutex);
    s_led_fault = true;
    s_manual_led_active = false;
    apply_led_color(kFaultLed);
}

void led_restore_task(void*)
{
    while (true) {
        restore_audio_status_led();
        vTaskDelay(pdMS_TO_TICKS(25));
    }
}

const char* gesture_name(HeadPetGesture gesture)
{
    switch (gesture) {
        case HeadPetGesture::Press:
            return "press";
        case HeadPetGesture::Release:
            return "release";
        case HeadPetGesture::SwipeForward:
            return "swipe_forward";
        case HeadPetGesture::SwipeBackward:
            return "swipe_backward";
        case HeadPetGesture::None:
        default:
            return "none";
    }
}

bool queue_text(QueueHandle_t queue, const char* text)
{
    if (queue == nullptr || text == nullptr) {
        return false;
    }
    const size_t length = std::strlen(text);
    if (length == 0 || length > kMaxFrameBytes) {
        return false;
    }

    ProtocolFrame frame;
    frame.length = static_cast<uint16_t>(length);
    std::memcpy(frame.data, text, length);
    frame.data[length] = '\0';
    return xQueueSend(queue, &frame, 0) == pdTRUE;
}

bool queue_json(cJSON* json)
{
    if (json == nullptr) {
        return false;
    }
    char* serialized = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (serialized == nullptr) {
        return false;
    }
    const bool queued = queue_text(s_tx_queue, serialized);
    cJSON_free(serialized);
    return queued;
}

cJSON* make_audio_state_json()
{
    cJSON* state = cJSON_CreateObject();
    cJSON_AddBoolToObject(state, "microphone_enabled", s_microphone_enabled.load());
    cJSON_AddBoolToObject(state, "speaker_enabled", s_speaker_enabled.load());
    cJSON_AddNumberToObject(state, "revision", s_audio_state_revision.load());
    return state;
}

void emit_event(const char* event_name, cJSON* data)
{
    cJSON* event = cJSON_CreateObject();
    cJSON_AddNumberToObject(event, "v", kProtocolVersion);
    cJSON_AddNumberToObject(event, "seq", ++s_event_sequence);
    cJSON_AddStringToObject(event, "event", event_name);
    cJSON_AddItemToObject(event, "data", data != nullptr ? data : cJSON_CreateObject());
    if (!queue_json(event)) {
        ESP_LOGW(TAG, "Dropped event %s because the CDC transmit queue is full", event_name);
    }
}

void emit_audio_state(const char* source)
{
    cJSON* data = make_audio_state_json();
    cJSON_AddStringToObject(data, "source", source);
    emit_event("audio_state", data);
}

void update_audio_paths(bool microphone_enabled, bool speaker_enabled, const char* source)
{
    const bool microphone_changed = s_microphone_enabled.exchange(microphone_enabled) != microphone_enabled;
    const bool speaker_changed = s_speaker_enabled.exchange(speaker_enabled) != speaker_enabled;
    if (microphone_changed || speaker_changed) {
        ++s_audio_state_revision;
        apply_audio_status_led();
        emit_audio_state(source);
    }
}

void emit_touch_event(HeadPetGesture gesture)
{
    cJSON* data = cJSON_CreateObject();
    cJSON_AddStringToObject(data, "gesture", gesture_name(gesture));
    emit_event("touch", data);
}

void on_head_touch(HeadPetGesture gesture)
{
    // Deterministic state setting avoids a reconnect or duplicate event turning
    // an ambiguous toggle into the opposite state.
    if (gesture == HeadPetGesture::SwipeForward) {
        update_audio_paths(true, true, "touch_swipe_forward");
    } else if (gesture == HeadPetGesture::SwipeBackward) {
        update_audio_paths(false, false, "touch_swipe_backward");
    }
    emit_touch_event(gesture);
}

esp_err_t uac_output_callback(uint8_t* buffer, size_t length, void*)
{
    if (s_codec == nullptr || buffer == nullptr || (length % sizeof(int16_t)) != 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_speaker_enabled.load()) {
        // The host stream remains active; frames are deliberately consumed and
        // discarded so disabling the robot path never changes USB enumeration.
        return ESP_OK;
    }

    std::lock_guard<std::mutex> lock(s_output_mutex);
    const size_t sample_count = length / sizeof(int16_t);
    s_output_buffer.resize(sample_count);
    std::memcpy(s_output_buffer.data(), buffer, length);
    s_codec->OutputData(s_output_buffer);
    return ESP_OK;
}

esp_err_t uac_input_callback(uint8_t* buffer, size_t length, size_t* bytes_read, void*)
{
    if (s_codec == nullptr || buffer == nullptr || bytes_read == nullptr || (length % sizeof(int16_t)) != 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_microphone_enabled.load()) {
        std::memset(buffer, 0, length);
        *bytes_read = length;
        return ESP_OK;
    }

    std::lock_guard<std::mutex> lock(s_input_mutex);
    const size_t mono_sample_count = length / sizeof(int16_t);
    const size_t input_channels = std::max(1, s_codec->input_channels());
    s_input_buffer.resize(mono_sample_count * input_channels);

    if (!s_codec->InputData(s_input_buffer)) {
        std::memset(buffer, 0, length);
        *bytes_read = length;
        return ESP_OK;
    }

    s_capture_buffer.resize(mono_sample_count);
    for (size_t index = 0; index < mono_sample_count; ++index) {
        s_capture_buffer[index] = s_input_buffer[index * input_channels];
    }
    std::memcpy(buffer, s_capture_buffer.data(), length);
    *bytes_read = length;
    return ESP_OK;
}

void add_request_envelope(cJSON* response, int request_id, bool ok)
{
    cJSON_AddNumberToObject(response, "v", kProtocolVersion);
    cJSON_AddNumberToObject(response, "id", request_id);
    cJSON_AddBoolToObject(response, "ok", ok);
}

void send_error(int request_id, const char* code, const char* message)
{
    cJSON* response = cJSON_CreateObject();
    add_request_envelope(response, request_id, false);
    cJSON* error = cJSON_AddObjectToObject(response, "error");
    cJSON_AddStringToObject(error, "code", code);
    cJSON_AddStringToObject(error, "message", message);
    queue_json(response);
}

void send_result(int request_id, cJSON* result)
{
    cJSON* response = cJSON_CreateObject();
    add_request_envelope(response, request_id, true);
    cJSON_AddItemToObject(response, "result", result != nullptr ? result : cJSON_CreateObject());
    queue_json(response);
}

bool read_bool(cJSON* args, const char* name, bool* value)
{
    cJSON* item = cJSON_GetObjectItemCaseSensitive(args, name);
    if (!cJSON_IsBool(item)) {
        return false;
    }
    *value = cJSON_IsTrue(item);
    return true;
}

bool read_int(cJSON* args, const char* name, int minimum, int maximum, int* value)
{
    cJSON* item = cJSON_GetObjectItemCaseSensitive(args, name);
    if (!cJSON_IsNumber(item) || item->valuedouble != item->valueint || item->valueint < minimum ||
        item->valueint > maximum) {
        return false;
    }
    *value = item->valueint;
    return true;
}

bool is_allowed_expression(std::string_view expression)
{
    constexpr std::array<std::string_view, 5> allowed = {
        "neutral", "happy", "angry", "sad", "doubtful",
    };
    return std::find(allowed.begin(), allowed.end(), expression) != allowed.end();
}

bool has_exact_fields(const cJSON* object, std::initializer_list<const char*> allowed)
{
    size_t count = 0;
    for (const cJSON* item = object->child; item != nullptr; item = item->next) {
        const bool found = item->string != nullptr &&
                           std::find_if(allowed.begin(), allowed.end(), [item](const char* name) {
                               return std::strcmp(item->string, name) == 0;
                           }) != allowed.end();
        if (!found) {
            return false;
        }
        ++count;
    }
    return count == allowed.size();
}

bool is_valid_utf8(const char* text, size_t length)
{
    const auto* bytes = reinterpret_cast<const uint8_t*>(text);
    for (size_t index = 0; index < length;) {
        const uint8_t lead = bytes[index];
        size_t continuation_count = 0;
        uint32_t codepoint = 0;
        if (lead <= 0x7f) {
            ++index;
            continue;
        } else if (lead >= 0xc2 && lead <= 0xdf) {
            continuation_count = 1;
            codepoint = lead & 0x1f;
        } else if (lead >= 0xe0 && lead <= 0xef) {
            continuation_count = 2;
            codepoint = lead & 0x0f;
        } else if (lead >= 0xf0 && lead <= 0xf4) {
            continuation_count = 3;
            codepoint = lead & 0x07;
        } else {
            return false;
        }
        if (index + continuation_count >= length) {
            return false;
        }
        for (size_t offset = 1; offset <= continuation_count; ++offset) {
            const uint8_t continuation = bytes[index + offset];
            if ((continuation & 0xc0) != 0x80) {
                return false;
            }
            codepoint = (codepoint << 6) | (continuation & 0x3f);
        }
        if ((continuation_count == 2 && codepoint >= 0xd800 && codepoint <= 0xdfff) ||
            (continuation_count == 3 && codepoint > 0x10ffff)) {
            return false;
        }
        const uint32_t minimum = continuation_count == 1 ? 0x80 : continuation_count == 2 ? 0x800 : 0x10000;
        if (codepoint < minimum) {
            return false;
        }
        index += continuation_count + 1;
    }
    return true;
}

cJSON* create_status_result()
{
    cJSON* result = cJSON_CreateObject();
    cJSON_AddStringToObject(result, "device", "stackchan-codex-companion");
    cJSON_AddNumberToObject(result, "protocol_version", kProtocolVersion);
    cJSON_AddBoolToObject(result, "usb_mounted", s_usb_mounted.load());
    cJSON_AddBoolToObject(result, "usb_suspended", s_usb_suspended.load());
    cJSON_AddNumberToObject(result, "sample_rate", CONFIG_UAC_SAMPLE_RATE);
    cJSON_AddNumberToObject(result, "event_sequence", s_event_sequence.load());
    cJSON_AddItemToObject(result, "audio", make_audio_state_json());

    std::string head_json;
    if (stackchan_mcp_dispatch_tool("self.robot.get_head_angles", nullptr, head_json)) {
        cJSON* head = cJSON_Parse(head_json.c_str());
        if (head != nullptr) {
            cJSON_AddItemToObject(result, "head", head);
        }
    }
    return result;
}

void dispatch_request(const ProtocolFrame& frame)
{
    if (frame.oversized) {
        send_error(0, "frame_too_large", "request exceeds 511 bytes");
        return;
    }
    cJSON* request = cJSON_ParseWithLength(frame.data, frame.length);
    if (request == nullptr || !cJSON_IsObject(request)) {
        cJSON_Delete(request);
        send_error(0, "invalid_json", "request must be one JSON object");
        return;
    }

    cJSON* version_item = cJSON_GetObjectItemCaseSensitive(request, "v");
    cJSON* id_item = cJSON_GetObjectItemCaseSensitive(request, "id");
    cJSON* command_item = cJSON_GetObjectItemCaseSensitive(request, "cmd");
    cJSON* args = cJSON_GetObjectItemCaseSensitive(request, "args");
    const int request_id = cJSON_IsNumber(id_item) ? id_item->valueint : 0;

    if (!cJSON_IsNumber(version_item) || version_item->valueint != static_cast<int>(kProtocolVersion)) {
        cJSON_Delete(request);
        send_error(request_id, "unsupported_version", "protocol version must be 1");
        return;
    }
    if (!cJSON_IsNumber(id_item) || id_item->valuedouble != id_item->valueint || request_id <= 0) {
        cJSON_Delete(request);
        send_error(0, "invalid_id", "id must be a positive integer");
        return;
    }
    if (!cJSON_IsString(command_item) || command_item->valuestring == nullptr) {
        cJSON_Delete(request);
        send_error(request_id, "invalid_command", "cmd must be a string");
        return;
    }
    if (args == nullptr) {
        args = cJSON_CreateObject();
        cJSON_AddItemToObject(request, "args", args);
    }
    if (!cJSON_IsObject(args)) {
        cJSON_Delete(request);
        send_error(request_id, "invalid_args", "args must be an object");
        return;
    }

    const std::string_view command(command_item->valuestring);
    if (command == "get_status") {
        send_result(request_id, create_status_result());
    } else if (command == "set_audio") {
        bool microphone = s_microphone_enabled.load();
        bool speaker = s_speaker_enabled.load();
        const bool has_microphone = cJSON_HasObjectItem(args, "microphone_enabled");
        const bool has_speaker = cJSON_HasObjectItem(args, "speaker_enabled");
        if ((!has_microphone && !has_speaker) ||
            (has_microphone && !read_bool(args, "microphone_enabled", &microphone)) ||
            (has_speaker && !read_bool(args, "speaker_enabled", &speaker))) {
            send_error(request_id, "invalid_args", "set_audio requires boolean endpoint fields");
        } else {
            update_audio_paths(microphone, speaker, "cdc_command");
            send_result(request_id, make_audio_state_json());
        }
    } else if (command == "set_expression") {
        cJSON* expression_item = cJSON_GetObjectItemCaseSensitive(args, "expression");
        if (!cJSON_IsString(expression_item) || expression_item->valuestring == nullptr ||
            !is_allowed_expression(expression_item->valuestring)) {
            send_error(request_id, "invalid_args", "expression is not in the allowlist");
        } else {
            Display* display = Board::GetInstance().GetDisplay();
            if (display == nullptr) {
                send_error(request_id, "unavailable", "display is unavailable");
            } else {
                display->SetEmotion(expression_item->valuestring);
                cJSON* result = cJSON_CreateObject();
                cJSON_AddStringToObject(result, "expression", expression_item->valuestring);
                send_result(request_id, result);
            }
        }
    } else if (command == "set_talking") {
        bool enabled = false;
        if (!has_exact_fields(args, {"enabled"}) || !read_bool(args, "enabled", &enabled)) {
            send_error(request_id, "invalid_args", "set_talking requires one boolean enabled field");
        } else {
            auto* display = static_cast<StackChanAvatarDisplay*>(Board::GetInstance().GetDisplay());
            if (display == nullptr || !display->SetTalkingAnimation(enabled)) {
                send_error(request_id, "unavailable", "talking animation is unavailable");
            } else {
                cJSON* result = cJSON_CreateObject();
                cJSON_AddBoolToObject(result, "enabled", display->IsTalkingAnimationEnabled());
                send_result(request_id, result);
            }
        }
    } else if (command == "set_speech") {
        cJSON* text_item = cJSON_GetObjectItemCaseSensitive(args, "text");
        const size_t text_length = cJSON_IsString(text_item) && text_item->valuestring != nullptr
                                       ? std::strlen(text_item->valuestring)
                                       : 0;
        if (!has_exact_fields(args, {"text"}) || text_length == 0 || text_length > kMaxSpeechTextBytes ||
            !is_valid_utf8(text_item->valuestring, text_length)) {
            send_error(request_id, "invalid_args", "text must be non-empty valid UTF-8 within 320 bytes");
        } else {
            Display* display = Board::GetInstance().GetDisplay();
            if (display == nullptr) {
                send_error(request_id, "unavailable", "display is unavailable");
            } else {
                display->SetChatMessage("assistant", text_item->valuestring);
                cJSON* result = cJSON_CreateObject();
                cJSON_AddBoolToObject(result, "displayed", true);
                cJSON_AddNumberToObject(result, "text_bytes", text_length);
                send_result(request_id, result);
            }
        }
    } else if (command == "clear_speech") {
        if (!has_exact_fields(args, {})) {
            send_error(request_id, "invalid_args", "clear_speech does not accept fields");
        } else {
            Display* display = Board::GetInstance().GetDisplay();
            if (display == nullptr) {
                send_error(request_id, "unavailable", "display is unavailable");
            } else {
                display->ClearChatMessages();
                cJSON* result = cJSON_CreateObject();
                cJSON_AddBoolToObject(result, "displayed", false);
                send_result(request_id, result);
            }
        }
    } else if (command == "set_led") {
        int red = 0;
        int green = 0;
        int blue = 0;
        if (!read_int(args, "red", 0, 168, &red) || !read_int(args, "green", 0, 168, &green) ||
            !read_int(args, "blue", 0, 168, &blue)) {
            send_error(request_id, "invalid_args", "LED channels must be integers in 0..168");
        } else {
            show_temporary_led({static_cast<uint8_t>(red), static_cast<uint8_t>(green), static_cast<uint8_t>(blue)});
            cJSON* result = cJSON_CreateObject();
            cJSON_AddNumberToObject(result, "red", red);
            cJSON_AddNumberToObject(result, "green", green);
            cJSON_AddNumberToObject(result, "blue", blue);
            cJSON_AddNumberToObject(result, "restore_after_ms", kManualLedEffectMs);
            send_result(request_id, result);
        }
    } else if (command == "get_head") {
        std::string dispatch_result;
        cJSON* result = nullptr;
        if (stackchan_mcp_dispatch_tool("self.robot.get_head_angles", args, dispatch_result)) {
            result = cJSON_Parse(dispatch_result.c_str());
        }
        if (result == nullptr) {
            send_error(request_id, "command_failed", "head state query failed");
        } else {
            send_result(request_id, result);
        }
    } else if (command == "set_head") {
        int yaw = 0;
        int pitch = 0;
        int speed = 0;
        if (!read_int(args, "yaw", -128, 128, &yaw) || !read_int(args, "pitch", 0, 90, &pitch) ||
            !read_int(args, "speed", 100, 300, &speed)) {
            send_error(request_id, "invalid_args", "head requires yaw -128..128, pitch 0..90, speed 100..300");
        } else {
            std::string dispatch_result;
            if (!stackchan_mcp_dispatch_tool("self.robot.set_head_angles", args, dispatch_result) ||
                dispatch_result != "ok") {
                send_error(request_id, "command_failed", "head command failed");
            } else {
                cJSON* result = cJSON_CreateObject();
                cJSON_AddNumberToObject(result, "yaw", yaw);
                cJSON_AddNumberToObject(result, "pitch", pitch);
                cJSON_AddNumberToObject(result, "speed", speed);
                send_result(request_id, result);
            }
        }
    } else {
        send_error(request_id, "unknown_command", "command is not in the allowlist");
    }

    cJSON_Delete(request);
}

void command_task(void*)
{
    ProtocolFrame frame;
    while (true) {
        if (xQueueReceive(s_command_queue, &frame, portMAX_DELAY) == pdTRUE) {
            dispatch_request(frame);
        }
    }
}

void tx_task(void*)
{
    ProtocolFrame frame;
    while (true) {
        if (xQueueReceive(s_tx_queue, &frame, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        std::lock_guard<std::mutex> lock(s_cdc_write_mutex);
        size_t offset = 0;
        const TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(500);
        while (offset < frame.length && xTaskGetTickCount() < deadline) {
            const uint32_t written = tud_cdc_n_write(kCdcInterface, frame.data + offset, frame.length - offset);
            offset += written;
            tud_cdc_n_write_flush(kCdcInterface);
            if (written == 0) {
                vTaskDelay(pdMS_TO_TICKS(2));
            }
        }
        if (offset == frame.length) {
            tud_cdc_n_write(kCdcInterface, "\n", 1);
            tud_cdc_n_write_flush(kCdcInterface);
        } else {
            ESP_LOGW(TAG, "Dropped partial CDC frame after %u bytes", static_cast<unsigned>(offset));
        }
    }
}

void initialize_protocol_tasks()
{
    s_command_queue = xQueueCreate(8, sizeof(ProtocolFrame));
    s_tx_queue = xQueueCreate(16, sizeof(ProtocolFrame));
    ESP_ERROR_CHECK(s_command_queue != nullptr && s_tx_queue != nullptr ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(xTaskCreate(command_task, "usb_companion_cmd", 8192, nullptr, 4, nullptr) == pdPASS ? ESP_OK
                                                                                                       : ESP_FAIL);
    ESP_ERROR_CHECK(xTaskCreate(tx_task, "usb_companion_tx", 4096, nullptr, 4, nullptr) == pdPASS ? ESP_OK
                                                                                                   : ESP_FAIL);
    ESP_ERROR_CHECK(xTaskCreate(led_restore_task, "usb_companion_led", 3072, nullptr, 3, nullptr) == pdPASS ? ESP_OK
                                                                                                            : ESP_FAIL);
}

std::array<char, 13> factory_mac_serial()
{
    std::array<char, 13> serial{};
    uint8_t mac[6]{};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        std::snprintf(serial.data(), serial.size(), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3],
                      mac[4], mac[5]);
    } else {
        std::snprintf(serial.data(), serial.size(), "000000000000");
    }
    return serial;
}
}  // namespace

extern "C" {
tusb_desc_device_t const s_device_descriptor = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0200,
    .bDeviceClass = TUSB_CLASS_MISC,
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = CONFIG_STACKCHAN_USB_COMPANION_VID,
    .idProduct = CONFIG_STACKCHAN_USB_COMPANION_PID,
    .bcdDevice = 0x0100,
    .iManufacturer = 1,
    .iProduct = 2,
    .iSerialNumber = 3,
    .bNumConfigurations = 1,
};

uint8_t const* tud_descriptor_device_cb(void)
{
    return reinterpret_cast<uint8_t const*>(&s_device_descriptor);
}

#define STACKCHAN_CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_AUDIO_DEVICE_DESC_LEN + TUD_CDC_DESC_LEN)
uint8_t const s_configuration_descriptor[] = {
    TUD_CONFIG_DESCRIPTOR(1, kInterfaceCount, 0, STACKCHAN_CONFIG_TOTAL_LEN, 0x00, 100),
    TUD_AUDIO_DESCRIPTOR(kInterfaceAudioControl, 4, kEndpointAudioOut, kEndpointAudioIn, kEndpointAudioFeedback),
    TUD_CDC_DESCRIPTOR(kInterfaceCdcControl, 7, kEndpointCdcNotification, 8, kEndpointCdcOut, kEndpointCdcIn, 64),
};
static_assert(sizeof(s_configuration_descriptor) == STACKCHAN_CONFIG_TOTAL_LEN);

uint8_t const* tud_descriptor_configuration_cb(uint8_t)
{
    return s_configuration_descriptor;
}

uint16_t const* tud_descriptor_string_cb(uint8_t index, uint16_t)
{
    static const std::array<char, 13> serial = factory_mac_serial();
    static const char* strings[] = {
        nullptr,
        "Stack-chan",
        "Stack-chan Codex Companion",
        serial.data(),
        "Stack-chan USB Audio",
        "Stack-chan Speaker",
        "Stack-chan Microphone",
        "Stack-chan Control",
    };
    static uint16_t descriptor[32];

    if (index == 0) {
        descriptor[1] = 0x0409;
        descriptor[0] = static_cast<uint16_t>((TUSB_DESC_STRING << 8) | 4);
        return descriptor;
    }
    if (index >= std::size(strings) || strings[index] == nullptr) {
        return nullptr;
    }

    const size_t count = std::min<size_t>(std::strlen(strings[index]), std::size(descriptor) - 1);
    for (size_t position = 0; position < count; ++position) {
        descriptor[position + 1] = static_cast<uint8_t>(strings[index][position]);
    }
    descriptor[0] = static_cast<uint16_t>((TUSB_DESC_STRING << 8) | (count * 2 + 2));
    return descriptor;
}

void tud_mount_cb(void)
{
    s_usb_mounted.store(true);
    s_usb_suspended.store(false);
    cJSON* data = cJSON_CreateObject();
    cJSON_AddStringToObject(data, "state", "mounted");
    emit_event("connection", data);
}

void tud_umount_cb(void)
{
    s_usb_mounted.store(false);
    s_usb_suspended.store(false);
}

void tud_suspend_cb(bool)
{
    s_usb_suspended.store(true);
}

void tud_resume_cb(void)
{
    s_usb_suspended.store(false);
    cJSON* data = cJSON_CreateObject();
    cJSON_AddStringToObject(data, "state", "resumed");
    emit_event("connection", data);
}

void tud_cdc_rx_cb(uint8_t interface_number)
{
    if (interface_number != kCdcInterface || s_command_queue == nullptr) {
        return;
    }

    static ProtocolFrame pending;
    while (tud_cdc_n_available(interface_number) > 0) {
        uint8_t byte = 0;
        if (tud_cdc_n_read(interface_number, &byte, 1) != 1) {
            break;
        }
        if (byte == '\r') {
            continue;
        }
        if (byte == '\n') {
            if (pending.length > 0 || pending.oversized) {
                pending.data[pending.length] = '\0';
                if (xQueueSend(s_command_queue, &pending, 0) != pdTRUE) {
                    ESP_LOGW(TAG, "Dropped CDC request because the command queue is full");
                }
                pending = ProtocolFrame{};
            }
            continue;
        }
        if (pending.oversized) {
            continue;
        }
        if (pending.length >= kMaxFrameBytes) {
            ESP_LOGW(TAG, "Discarding oversized CDC request until newline");
            pending.oversized = true;
            continue;
        }
        pending.data[pending.length++] = static_cast<char>(byte);
    }
}
}  // extern "C"

StackchanUsbAudioPathState get_stackchan_usb_audio_path_state()
{
    return {
        .microphone_enabled = s_microphone_enabled.load(),
        .speaker_enabled = s_speaker_enabled.load(),
        .revision = s_audio_state_revision.load(),
    };
}

void set_stackchan_usb_audio_paths(bool microphone_enabled, bool speaker_enabled)
{
    update_audio_paths(microphone_enabled, speaker_enabled, "firmware_api");
}

esp_err_t start_stackchan_usb_uac_mvp()
{
    apply_audio_status_led();
    auto& board = Board::GetInstance();
    s_codec = board.GetAudioCodec();
    if (s_codec == nullptr) {
        show_fault_led();
        ESP_LOGE(TAG, "Audio codec is unavailable");
        return ESP_ERR_NOT_FOUND;
    }
    if (s_codec->input_sample_rate() != CONFIG_UAC_SAMPLE_RATE ||
        s_codec->output_sample_rate() != CONFIG_UAC_SAMPLE_RATE) {
        show_fault_led();
        ESP_LOGE(TAG, "UAC sample rate %d does not match codec input/output rates %d/%d", CONFIG_UAC_SAMPLE_RATE,
                 s_codec->input_sample_rate(), s_codec->output_sample_rate());
        return ESP_ERR_INVALID_STATE;
    }

    initialize_protocol_tasks();
    s_head_touch_connection = GetHAL().onHeadPetGesture.connect(on_head_touch);

    s_codec->Start();
    s_codec->EnableInput(true);
    s_codec->EnableOutput(true);

    uac_device_config_t config = {
        .skip_tinyusb_init = false,
        .output_cb = uac_output_callback,
        .input_cb = uac_input_callback,
        .set_mute_cb = nullptr,
        .set_volume_cb = nullptr,
        .cb_ctx = nullptr,
        .spk_itf_num = kInterfaceAudioSpeaker,
        .mic_itf_num = kInterfaceAudioMicrophone,
    };
    const esp_err_t result = uac_device_init(&config);
    if (result != ESP_OK) {
        GetHAL().onHeadPetGesture.disconnect(s_head_touch_connection);
        s_head_touch_connection = -1;
        s_codec->EnableInput(false);
        s_codec->EnableOutput(false);
        s_codec = nullptr;
        show_fault_led();
        ESP_LOGE(TAG, "Failed to initialize USB UAC: %s", esp_err_to_name(result));
        return result;
    }

    ESP_LOGI(TAG, "USB Companion ready: UAC2 + CDC-ACM, %d Hz, 16-bit, mono capture/render",
             CONFIG_UAC_SAMPLE_RATE);
    return ESP_OK;
}

#else

StackchanUsbAudioPathState get_stackchan_usb_audio_path_state()
{
    return {.microphone_enabled = false, .speaker_enabled = false, .revision = 0};
}

void set_stackchan_usb_audio_paths(bool, bool)
{
}

esp_err_t start_stackchan_usb_uac_mvp()
{
    return ESP_ERR_NOT_SUPPORTED;
}

#endif
