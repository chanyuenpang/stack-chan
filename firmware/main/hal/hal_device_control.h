#pragma once

#include <cstddef>
#include <string>

struct cJSON;

struct DeviceControlResult {
    bool success = false;
    std::string result_json;
    std::string error_message;
};

using DeviceControlHandler = DeviceControlResult (*)(const cJSON* args);

void register_default_device_control_handlers();
DeviceControlResult dispatch_device_control(const char* command, const char* args_json);
DeviceControlResult dispatch_device_control(const char* command, const cJSON* args);

bool dispatch_stackchan_mcp_tool(const char* tool_name, const cJSON* arguments, DeviceControlResult* out_result = nullptr);

std::string json_escape(const char* value);
void copy_safe_reboot_reason(char* dest, size_t dest_size, const std::string& reason);
bool schedule_system_reboot(int delay_ms, const std::string& reason, int* scheduled_delay_ms = nullptr);
