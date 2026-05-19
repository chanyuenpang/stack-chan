/*
 * Shared dev/MCP celebration entrypoint and StackChan-task executor tick.
 */
#pragma once

#include <cstdint>
#include <string>

namespace stackchan {
class Modifiable;
}

bool start_celebrate_modifier(std::string style, int durationMs, int intensity, bool sound, std::string* error = nullptr);
void stackchan_celebrate_tick(stackchan::Modifiable& stackchan, uint32_t nowMs);
bool stackchan_celebrate_active();
bool stackchan_motion_high_refresh_active();
