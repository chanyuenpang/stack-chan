/*
 * StackChan temporary performance mode time lease.
 */
#include "hal_stackchan_performance.h"

#include <cstring>
#include <mooncake_log.h>
#include <string_view>

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"

namespace stackchan_perf {
namespace {

static const std::string_view kTag = "STACKCHAN-PERF";
static constexpr uint32_t kMaxReasonLen = 31;

portMUX_TYPE g_lock = portMUX_INITIALIZER_UNLOCKED;
uint32_t g_deadline_ms = 0;
char g_reason[kMaxReasonLen + 1] = "";
char g_reason_snapshot[kMaxReasonLen + 1] = "";

uint32_t now_ms()
{
    return static_cast<uint32_t>(esp_timer_get_time() / 1000ULL);
}

const char* safe_reason(const char* reason)
{
    return reason ? reason : "unknown";
}

bool deadline_reached(uint32_t now, uint32_t deadline)
{
    return deadline == 0 || static_cast<int32_t>(now - deadline) >= 0;
}

bool deadline_after(uint32_t candidate, uint32_t current)
{
    return current == 0 || static_cast<int32_t>(candidate - current) > 0;
}

void copy_reason_locked(const char* reason)
{
    std::strncpy(g_reason, safe_reason(reason), kMaxReasonLen);
    g_reason[kMaxReasonLen] = '\0';
}

void clear_if_expired_locked(uint32_t now)
{
    if (deadline_reached(now, g_deadline_ms)) {
        g_deadline_ms = 0;
        g_reason[0] = '\0';
    }
}

}  // namespace

void request_stackchan_performance_mode(const char* reason, uint32_t ttl_ms)
{
    (void)reason;
    (void)ttl_ms;
    // Third minimal crash-isolation experiment: keep callers intact but make
    // StackChan performance leases ineffective, so update cadence stays
    // conservative outside xiaozhi idle state.
    static bool logged = false;
    if (!logged) {
        logged = true;
        mclog::tagWarn(kTag, "performance mode disabled for conservative-update experiment");
    }
}

bool is_stackchan_performance_mode_active()
{
    return false;
}

const char* current_reason()
{
    const uint32_t now = now_ms();

    portENTER_CRITICAL(&g_lock);
    clear_if_expired_locked(now);
    std::strncpy(g_reason_snapshot, g_reason, kMaxReasonLen);
    g_reason_snapshot[kMaxReasonLen] = '\0';
    portEXIT_CRITICAL(&g_lock);
    return g_reason_snapshot;
}

uint32_t deadline_ms()
{
    const uint32_t now = now_ms();
    uint32_t deadline = 0;

    portENTER_CRITICAL(&g_lock);
    clear_if_expired_locked(now);
    deadline = g_deadline_ms;
    portEXIT_CRITICAL(&g_lock);
    return deadline;
}

}  // namespace stackchan_perf
