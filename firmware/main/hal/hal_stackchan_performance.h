/*
 * StackChan temporary performance mode time lease.
 */
#pragma once

#include <cstdint>

namespace stackchan_perf {

void request_stackchan_performance_mode(const char* reason, uint32_t ttl_ms);
bool is_stackchan_performance_mode_active();
const char* current_reason();
uint32_t deadline_ms();

}  // namespace stackchan_perf
