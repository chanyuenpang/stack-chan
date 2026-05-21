/*
 * Dev-only local serial control entry for StackChan/Xiaozhi PoC.
 * Build with CMake option -DSTACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP=ON to enable.
 */
#include "hal_dev_serial.h"

#ifdef STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP

#include "hal_device_control.h"

#include <driver/usb_serial_jtag.h>
#include <esp_err.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include <ArduinoJson.h>

namespace {

constexpr const char* TAG = "dev_serial_wake_stop";
constexpr uint32_t kTaskStackSize = 6144;
constexpr UBaseType_t kTaskPriority = 4;
constexpr size_t kSerialLineBufferSize = 1024;
constexpr size_t kSerialReadBufferSize = 32;
constexpr TickType_t kSerialReadTimeoutTicks = pdMS_TO_TICKS(100);

void serial_write_line(const char* text)
{
    if (!text) {
        return;
    }
    usb_serial_jtag_write_bytes(reinterpret_cast<const uint8_t*>(text), std::strlen(text), 0);
    usb_serial_jtag_write_bytes(reinterpret_cast<const uint8_t*>("\r\n"), 2, 0);
}

void serial_write_json_response(const std::string& line)
{
    serial_write_line(line.c_str());
}

void trim_line(char* line)
{
    if (!line) {
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

    return true;
}

std::string next_token(char*& cursor)
{
    while (*cursor != '\0' && std::isspace(static_cast<unsigned char>(*cursor))) {
        ++cursor;
    }
    if (*cursor == '\0') {
        return "";
    }
    char* start = cursor;
    while (*cursor != '\0' && !std::isspace(static_cast<unsigned char>(*cursor))) {
        ++cursor;
    }
    const std::string token(start, cursor - start);
    while (*cursor != '\0' && std::isspace(static_cast<unsigned char>(*cursor))) {
        *cursor++ = '\0';
    }
    return token;
}

std::string make_json_error_response(const char* id, const char* error)
{
    ArduinoJson::JsonDocument doc;
    doc["v"] = 1;
    if (id && id[0] != '\0') {
        doc["id"] = id;
    }
    doc["ok"] = false;
    doc["error"] = error ? error : "unknown_error";
    std::string out;
    ArduinoJson::serializeJson(doc, out);
    return out;
}

std::string make_json_success_response(const char* id, const DeviceControlResult& result)
{
    ArduinoJson::JsonDocument doc;
    doc["v"] = 1;
    if (id && id[0] != '\0') {
        doc["id"] = id;
    }
    doc["ok"] = true;

    if (!result.result_json.empty()) {
        ArduinoJson::JsonDocument payload_doc;
        const auto err = ArduinoJson::deserializeJson(payload_doc, result.result_json);
        if (!err) {
            JsonVariantConst payload = payload_doc.as<JsonVariantConst>();
            if (payload.is<JsonObjectConst>() && payload["ok"].is<bool>() && payload["ok"].as<bool>() && payload.size() == 1) {
                doc["result"] = true;
            } else {
                doc["result"] = payload;
            }
        } else {
            doc["result"] = result.result_json;
        }
    } else {
        doc["result"] = true;
    }

    std::string out;
    ArduinoJson::serializeJson(doc, out);
    return out;
}

void respond_legacy_result(const DeviceControlResult& result)
{
    if (result.success) {
        serial_write_line(result.result_json.empty() ? "{\"ok\":true}" : result.result_json.c_str());
    } else {
        serial_write_line(make_json_error_response(nullptr, result.error_message.c_str()).c_str());
    }
}

void respond_json_result(const char* id, const DeviceControlResult& result)
{
    if (result.success) {
        serial_write_json_response(make_json_success_response(id, result));
    } else {
        serial_write_json_response(make_json_error_response(id, result.error_message.c_str()));
    }
}

DeviceControlResult handle_legacy_serial_command(char* line)
{
    trim_line(line);
    if (line[0] == '\0') {
        return DeviceControlResult{true, "{\"ok\":true,\"noop\":true}", ""};
    }

    char* cursor = line;
    const std::string command = next_token(cursor);

    if (command == "status" || command == "wake" || command == "stop" || command == "toggle") {
        return dispatch_device_control(command.c_str(), static_cast<const char*>(nullptr));
    }

    if (command == "prompt_sample") {
        std::string sample = next_token(cursor);
        if (sample.empty()) {
            sample = "short";
        }
        if (sample != "short" && sample != "tts") {
            return DeviceControlResult{false, "", "invalid_sample"};
        }
        std::string json = std::string("{\"sample\":\"") + sample + "\",\"explicit_stop\":true}";
        return dispatch_device_control("prompt_sample", json.c_str());
    }

    if (command == "reboot") {
        const std::string confirm = next_token(cursor);
        if (confirm != "confirm") {
            return DeviceControlResult{false, "", "confirm_required"};
        }

        int delay_ms = 1500;
        std::string reason = "usb_serial";
        while (*cursor != '\0') {
            const std::string token = next_token(cursor);
            if (token.rfind("delay_ms=", 0) == 0) {
                delay_ms = std::atoi(token.substr(9).c_str());
            } else if (token.rfind("reason=", 0) == 0) {
                reason = token.substr(7);
            } else if (!token.empty()) {
                return DeviceControlResult{false, "", "invalid_reboot_arg"};
            }
        }

        std::string json = std::string("{\"confirm\":true,\"delay_ms\":") + std::to_string(delay_ms) +
                           ",\"reason\":\"" + reason + "\"}";
        return dispatch_device_control("reboot", json.c_str());
    }

    return DeviceControlResult{false, "", "unknown_command"};
}

DeviceControlResult handle_json_serial_command(const char* line, std::string& response_id)
{
    ArduinoJson::JsonDocument doc;
    const auto err = ArduinoJson::deserializeJson(doc, line);
    if (err) {
        return DeviceControlResult{false, "", "invalid_json"};
    }

    JsonVariantConst root = doc.as<JsonVariantConst>();
    if (!root.is<JsonObjectConst>()) {
        return DeviceControlResult{false, "", "invalid_json"};
    }

    JsonObjectConst obj = root.as<JsonObjectConst>();
    const int version = obj["v"] | 0;
    if (version != 1) {
        return DeviceControlResult{false, "", "unsupported_version"};
    }

    if (obj["id"].is<const char*>()) {
        response_id = obj["id"].as<const char*>();
    }

    const char* command = obj["command"] | nullptr;
    if (!command || command[0] == '\0') {
        return DeviceControlResult{false, "", "missing_command"};
    }

    std::string args_json;
    if (!obj["args"].isNull()) {
        ArduinoJson::serializeJson(obj["args"], args_json);
    }
    return dispatch_device_control(command, args_json.empty() ? nullptr : args_json.c_str());
}

void process_serial_line(char* line)
{
    trim_line(line);
    if (line[0] == '\0') {
        respond_legacy_result(DeviceControlResult{true, "{\"ok\":true,\"noop\":true}", ""});
        return;
    }

    if (line[0] == '{') {
        std::string response_id;
        const DeviceControlResult result = handle_json_serial_command(line, response_id);
        respond_json_result(response_id.c_str(), result);
        return;
    }

    respond_legacy_result(handle_legacy_serial_command(line));
}

void append_serial_byte(char byte, char* line, size_t& line_len)
{
    if (byte == '\r' || byte == '\n') {
        line[line_len] = '\0';
        process_serial_line(line);
        line_len = 0;
        line[0] = '\0';
        return;
    }

    if (line_len + 1 >= kSerialLineBufferSize) {
        line[line_len] = '\0';
        serial_write_json_response(make_json_error_response(nullptr, "line_too_long"));
        line_len = 0;
        line[0] = '\0';
        return;
    }

    line[line_len++] = byte;
}

void serial_task(void*)
{
    serial_write_line("{\"ok\":true,\"message\":\"dev serial ready\",\"protocols\":[\"jsonl\",\"legacy\"],\"commands\":[\"status\",\"wake\",\"stop\",\"toggle\",\"reboot\",\"prompt_sample\",\"inject_prompt\",\"celebrate\",\"play_sound\",\"mcp_call\",\"capabilities\"],\"legacy_commands\":[\"status\",\"wake\",\"stop\",\"toggle\",\"reboot confirm [delay_ms=N] [reason=...]\",\"prompt_sample [short|tts]\"]}");

    if (!install_usb_serial_jtag_driver_if_needed()) {
        serial_write_line("{\"ok\":false,\"error\":\"usb_serial_unavailable\"}");
        vTaskDelete(nullptr);
        return;
    }

    register_default_device_control_handlers();

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
    static bool started = false;
    if (started) {
        return;
    }
    started = true;
    xTaskCreate(serial_task, "dev_serial_wake_stop", kTaskStackSize, nullptr, kTaskPriority, nullptr);
}

#else

void start_dev_serial_wake_stop_task() {}

#endif
