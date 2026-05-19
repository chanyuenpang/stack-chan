/*
 * Dev-only local LAN control endpoint.
 * Compiled in only when STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP is enabled.
 */
#pragma once

#include <string>

struct cJSON;

void start_dev_local_control_server();

/**
 * Dispatch an MCP tool call from the local HTTP control endpoint.
 * Returns true if the tool was found (out_result contains the result).
 * Returns false if the tool name is unknown.
 */
bool stackchan_mcp_dispatch_tool(const std::string& tool_name, const cJSON* arguments, std::string& out_result);
