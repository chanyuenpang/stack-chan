#pragma once

#include <cstdint>
#include <sdkconfig.h>
#include <string>

#include "hal_audio_performance_stats.h"

#if defined(CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS) && \
    CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS

namespace stackchan_audio_diag {

using SummarySink = void (*)(const std::string& notification_json);

struct QueueDepths {
    uint32_t window_ms = 0;
    uint32_t decode = 0;
    uint32_t playback = 0;
    uint32_t encode = 0;
    uint32_t send = 0;
};

uint32_t NowUs();

void RecordIngress(bool accepted, uint32_t decode_queue_depth, uint32_t queue_wait_us);
void RecordIngressTimestampMissing();
void RecordDecode(bool has_ingress_timestamp, uint32_t ingress_to_decode_us,
                  uint32_t decoder_lock_wait_us, uint32_t decode_us, uint32_t resample_us);
void RecordDecodeFailure();
void RecordPlaybackQueueDepth(uint32_t playback_queue_depth);
void RecordOutput(bool has_ingress_timestamp, uint32_t ingress_to_output_us,
                  bool has_decode_ready_timestamp, uint32_t decode_to_output_us,
                  uint32_t output_call_us, bool has_output_gap, uint32_t output_gap_us,
                  bool underrun_candidate, bool has_underrun_decomposition,
                  uint32_t previous_output_us, uint32_t ready_late_us,
                  uint32_t ready_wait_us);
void RecordI2sWrite(uint32_t duration_us, bool success);

void RecordDisplayGuardWait(uint32_t wait_us, bool success);
void RecordDisplayGuardSpan(uint32_t span_us);
void RecordLvglGuardWait(uint32_t wait_us);
void RecordLvglGuardSpan(uint32_t span_us);
void RecordLedSetI2c(uint32_t duration_us);
void RecordLedRefreshI2c(uint32_t duration_us);

void InitializeReporter();
void SetSummarySink(SummarySink sink);
void ResetWindow();
bool TryBeginReportWindow(uint32_t& elapsed_us);
void QueueReport(const QueueDepths& queues);

}  // namespace stackchan_audio_diag

#endif
