#include "hal_audio_performance_diagnostics.h"

#if defined(CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS) && \
    CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS

#include "hal_audio_performance_stats.h"

#include <atomic>

#include <cJSON.h>
#include <esp_log.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <freertos/queue.h>
#include <freertos/task.h>

namespace stackchan_audio_diag {
namespace {

constexpr char kTag[] = "AudioPerf";
constexpr uint32_t kReportIntervalUs = 5'000'000;

class PortMuxLock {
public:
    void lock()
    {
        portENTER_CRITICAL(&mux_);
    }

    void unlock()
    {
        portEXIT_CRITICAL(&mux_);
    }

private:
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
};

PortMuxLock g_stats_lock;
LockedStatsAccumulator<PortMuxLock> g_stats(g_stats_lock);
std::atomic<uint32_t> g_last_report_us{0};
QueueHandle_t g_report_queue = nullptr;
std::atomic<SummarySink> g_summary_sink{nullptr};
uint32_t g_summary_sequence = 0;

void ReportSnapshot(const QueueDepths& queues);

void ReporterTask(void*)
{
    QueueDepths queues;
    while (xQueueReceive(g_report_queue, &queues, portMAX_DELAY) == pdTRUE) {
        ReportSnapshot(queues);
    }
    vTaskDelete(nullptr);
}

uint32_t Average(const TimingSnapshot& stats)
{
    return stats.count == 0 ? 0 : stats.total_us / stats.count;
}

void AddAverageAndMax(cJSON* object, const char* average_name, const char* maximum_name,
                      const TimingSnapshot& stats)
{
    cJSON_AddNumberToObject(object, average_name, Average(stats));
    cJSON_AddNumberToObject(object, maximum_name, stats.max_us);
}

void AddHistogram(cJSON* object, const char* name, const TimingSnapshot& stats)
{
    cJSON* values = cJSON_AddArrayToObject(object, name);
    for (const auto bucket : stats.buckets) {
        cJSON_AddItemToArray(values, cJSON_CreateNumber(bucket));
    }
}

std::string BuildSummaryNotification(const QueueDepths& queues, const StatsSnapshot& stats,
                                     uint32_t free_heap, uint32_t minimum_free_heap)
{
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "jsonrpc", "2.0");
    cJSON_AddStringToObject(root, "method", "notifications/audio_performance_summary");
    cJSON* params = cJSON_AddObjectToObject(root, "params");
    cJSON_AddStringToObject(params, "type", "audio_perf_summary");
    cJSON_AddNumberToObject(params, "version", 2);
    cJSON_AddNumberToObject(params, "seq", ++g_summary_sequence);
    cJSON_AddNumberToObject(params, "window_ms", queues.window_ms);

    cJSON* queue_values = cJSON_AddObjectToObject(params, "queues");
    cJSON_AddNumberToObject(queue_values, "decode", queues.decode);
    cJSON_AddNumberToObject(queue_values, "playback", queues.playback);
    cJSON_AddNumberToObject(queue_values, "encode", queues.encode);
    cJSON_AddNumberToObject(queue_values, "send", queues.send);
    cJSON_AddNumberToObject(queue_values, "decode_hwm", stats.decode_queue_high_water);
    cJSON_AddNumberToObject(queue_values, "playback_hwm", stats.playback_queue_high_water);

    cJSON* counts = cJSON_AddObjectToObject(params, "counts");
    cJSON_AddNumberToObject(counts, "ingress_received", stats.ingress_received);
    cJSON_AddNumberToObject(counts, "ingress_accepted", stats.ingress_accepted);
    cJSON_AddNumberToObject(counts, "decode_queue_drops", stats.decode_queue_drops);
    cJSON_AddNumberToObject(counts, "timestamp_missing", stats.ingress_timestamp_missing);
    cJSON_AddNumberToObject(counts, "decode_failures", stats.decode_failures);
    cJSON_AddNumberToObject(counts, "i2s_write_failures", stats.i2s_write_failures);
    cJSON_AddNumberToObject(counts, "underrun_candidates", stats.underrun_candidates);
    cJSON_AddNumberToObject(counts, "underrun_decomposition_missing",
                            stats.underrun_decomposition_missing);
    cJSON_AddNumberToObject(counts, "display_lock_failures", stats.display_lock_failures);

    cJSON* timing = cJSON_AddObjectToObject(params, "timing_us");
    AddAverageAndMax(timing, "ingress_queue_wait_avg", "ingress_queue_wait_max", stats.ingress_queue_wait);
    AddAverageAndMax(timing, "ingress_to_decode_avg", "ingress_to_decode_max", stats.ingress_to_decode);
    AddAverageAndMax(timing, "decoder_lock_wait_avg", "decoder_lock_wait_max", stats.decoder_lock_wait);
    AddAverageAndMax(timing, "decode_avg", "decode_max", stats.decode);
    AddAverageAndMax(timing, "resample_avg", "resample_max", stats.resample);
    AddAverageAndMax(timing, "decode_to_output_avg", "decode_to_output_max", stats.decode_to_output);
    AddAverageAndMax(timing, "ingress_to_output_avg", "ingress_to_output_max", stats.ingress_to_output);
    AddAverageAndMax(timing, "output_call_avg", "output_call_max", stats.output_call);
    AddAverageAndMax(timing, "i2s_write_avg", "i2s_write_max", stats.i2s_write);
    AddAverageAndMax(timing, "output_gap_avg", "output_gap_max", stats.output_gap);
    AddAverageAndMax(timing, "underrun_previous_output_avg", "underrun_previous_output_max",
                     stats.underrun_previous_output);
    AddAverageAndMax(timing, "underrun_ready_late_avg", "underrun_ready_late_max",
                     stats.underrun_ready_late);
    AddAverageAndMax(timing, "underrun_ready_wait_avg", "underrun_ready_wait_max",
                     stats.underrun_ready_wait);

    cJSON* contention = cJSON_AddObjectToObject(params, "contention_us");
    AddAverageAndMax(contention, "display_wait_avg", "display_wait_max", stats.display_lock_wait);
    AddAverageAndMax(contention, "display_span_avg", "display_span_max", stats.display_lock_span);
    AddAverageAndMax(contention, "lvgl_wait_avg", "lvgl_wait_max", stats.lvgl_lock_wait);
    AddAverageAndMax(contention, "lvgl_span_avg", "lvgl_span_max", stats.lvgl_lock_span);
    AddAverageAndMax(contention, "led_set_i2c_avg", "led_set_i2c_max", stats.led_set_i2c);
    AddAverageAndMax(contention, "led_refresh_i2c_avg", "led_refresh_i2c_max", stats.led_refresh_i2c);

    cJSON* histograms = cJSON_AddObjectToObject(params, "histograms");
    AddHistogram(histograms, "ingress_to_output", stats.ingress_to_output);
    AddHistogram(histograms, "output_gap", stats.output_gap);
    AddHistogram(histograms, "display_wait", stats.display_lock_wait);
    AddHistogram(histograms, "display_span", stats.display_lock_span);
    AddHistogram(histograms, "lvgl_wait", stats.lvgl_lock_wait);
    AddHistogram(histograms, "lvgl_span", stats.lvgl_lock_span);

    cJSON* heap = cJSON_AddObjectToObject(params, "heap");
    cJSON_AddNumberToObject(heap, "free_bytes", free_heap);
    cJSON_AddNumberToObject(heap, "minimum_free_bytes", minimum_free_heap);

    char* serialized = cJSON_PrintUnformatted(root);
    std::string result = serialized == nullptr ? std::string() : std::string(serialized);
    cJSON_free(serialized);
    cJSON_Delete(root);
    return result;
}

}  // namespace

uint32_t NowUs()
{
    return static_cast<uint32_t>(esp_timer_get_time());
}

void RecordIngress(bool accepted, uint32_t decode_queue_depth, uint32_t queue_wait_us)
{
    g_stats.RecordIngress(accepted, decode_queue_depth, queue_wait_us);
}

void RecordIngressTimestampMissing()
{
    g_stats.RecordIngressTimestampMissing();
}

void RecordDecode(bool has_ingress_timestamp, uint32_t ingress_to_decode_us,
                  uint32_t decoder_lock_wait_us, uint32_t decode_us, uint32_t resample_us)
{
    g_stats.RecordDecode(has_ingress_timestamp, ingress_to_decode_us,
                         decoder_lock_wait_us, decode_us, resample_us);
}

void RecordDecodeFailure()
{
    g_stats.RecordDecodeFailure();
}

void RecordPlaybackQueueDepth(uint32_t playback_queue_depth)
{
    g_stats.RecordPlaybackQueueDepth(playback_queue_depth);
}

void RecordOutput(bool has_ingress_timestamp, uint32_t ingress_to_output_us,
                  bool has_decode_ready_timestamp, uint32_t decode_to_output_us,
                  uint32_t output_call_us, bool has_output_gap, uint32_t output_gap_us,
                  bool underrun_candidate, bool has_underrun_decomposition,
                  uint32_t previous_output_us, uint32_t ready_late_us,
                  uint32_t ready_wait_us)
{
    g_stats.RecordOutput(has_ingress_timestamp, ingress_to_output_us,
                         has_decode_ready_timestamp, decode_to_output_us,
                         output_call_us, has_output_gap, output_gap_us,
                         underrun_candidate, has_underrun_decomposition,
                         previous_output_us, ready_late_us, ready_wait_us);
}

void RecordI2sWrite(uint32_t duration_us, bool success)
{
    g_stats.RecordI2sWrite(duration_us, success);
}

void RecordDisplayGuardWait(uint32_t wait_us, bool success)
{
    g_stats.RecordDisplayGuardWait(wait_us, success);
}

void RecordDisplayGuardSpan(uint32_t span_us)
{
    g_stats.RecordDisplayGuardSpan(span_us);
}

void RecordLvglGuardWait(uint32_t wait_us)
{
    g_stats.RecordLvglGuardWait(wait_us);
}

void RecordLvglGuardSpan(uint32_t span_us)
{
    g_stats.RecordLvglGuardSpan(span_us);
}

void RecordLedSetI2c(uint32_t duration_us)
{
    g_stats.RecordLedSetI2c(duration_us);
}

void RecordLedRefreshI2c(uint32_t duration_us)
{
    g_stats.RecordLedRefreshI2c(duration_us);
}

void InitializeReporter()
{
    if (g_report_queue != nullptr) {
        return;
    }
    g_report_queue = xQueueCreate(1, sizeof(QueueDepths));
    if (g_report_queue == nullptr) {
        ESP_LOGE(kTag, "Failed to create performance report queue");
        return;
    }
    if (xTaskCreate(ReporterTask, "audio_perf", 4096, nullptr,
                    tskIDLE_PRIORITY + 1, nullptr) != pdPASS) {
        vQueueDelete(g_report_queue);
        g_report_queue = nullptr;
        ESP_LOGE(kTag, "Failed to create performance reporter task");
    }
}

void SetSummarySink(SummarySink sink)
{
    g_summary_sink.store(sink, std::memory_order_release);
}

void ResetWindow()
{
    g_stats.Reset();
    g_last_report_us.store(NowUs(), std::memory_order_relaxed);
}

bool TryBeginReportWindow(uint32_t& elapsed_us)
{
    if (g_report_queue == nullptr) {
        return false;
    }
    const uint32_t now_us = NowUs();
    uint32_t last_us = g_last_report_us.load(std::memory_order_relaxed);
    if (last_us == 0) {
        if (g_last_report_us.compare_exchange_strong(
                last_us, now_us, std::memory_order_relaxed)) {
            g_stats.Reset();
        }
        return false;
    }
    if (static_cast<uint32_t>(now_us - last_us) < kReportIntervalUs) {
        return false;
    }
    elapsed_us = static_cast<uint32_t>(now_us - last_us);
    return g_last_report_us.compare_exchange_strong(last_us, now_us,
                                                     std::memory_order_relaxed);
}

void QueueReport(const QueueDepths& queues)
{
    if (g_report_queue != nullptr) {
        xQueueOverwrite(g_report_queue, &queues);
    }
}

namespace {

void ReportSnapshot(const QueueDepths& queues)
{
    const auto stats = g_stats.SnapshotAndReset();
    const auto& ingress_wait = stats.ingress_queue_wait;
    const auto& ingress_to_decode = stats.ingress_to_decode;
    const auto& decoder_lock_wait = stats.decoder_lock_wait;
    const auto& decode = stats.decode;
    const auto& resample = stats.resample;
    const auto& decode_to_output = stats.decode_to_output;
    const auto& ingress_to_output = stats.ingress_to_output;
    const auto& output_call = stats.output_call;
    const auto& i2s_write = stats.i2s_write;
    const auto& output_gap = stats.output_gap;
    const auto& underrun_previous_output = stats.underrun_previous_output;
    const auto& underrun_ready_late = stats.underrun_ready_late;
    const auto& underrun_ready_wait = stats.underrun_ready_wait;
    const auto& display_wait = stats.display_lock_wait;
    const auto& display_span = stats.display_lock_span;
    const auto& lvgl_wait = stats.lvgl_lock_wait;
    const auto& lvgl_span = stats.lvgl_lock_span;
    const auto& led_set_i2c = stats.led_set_i2c;
    const auto& led_refresh_i2c = stats.led_refresh_i2c;
    const uint32_t free_heap = esp_get_free_heap_size();
    const uint32_t minimum_free_heap = esp_get_minimum_free_heap_size();

    ESP_LOGI(kTag,
             "[AUDIO-PERF] win_ms=%u q=%u/%u/%u/%u hwm=%u/%u "
             "ingress=%u/%u drop=%u timestamp_missing=%u decode_fail=%u i2s_fail=%u "
             "underrun_candidate=%u decomp_missing=%u heap=%u/%u stage_avg_max_us="
             "queue:%u/%u,decoder_lock:%u/%u,decode:%u/%u,resample:%u/%u,output:%u/%u,i2s:%u/%u",
             queues.window_ms, queues.decode, queues.playback, queues.encode, queues.send,
             stats.decode_queue_high_water, stats.playback_queue_high_water,
             stats.ingress_received, stats.ingress_accepted, stats.decode_queue_drops,
             stats.ingress_timestamp_missing, stats.decode_failures, stats.i2s_write_failures,
             stats.underrun_candidates, stats.underrun_decomposition_missing,
             free_heap, minimum_free_heap,
             Average(ingress_wait), ingress_wait.max_us,
             Average(decoder_lock_wait), decoder_lock_wait.max_us,
             Average(decode), decode.max_us, Average(resample), resample.max_us,
             Average(output_call), output_call.max_us, Average(i2s_write), i2s_write.max_us);

    ESP_LOGI(kTag,
             "[AUDIO-PERF-LAT] avg_max_us in_decode=%u/%u ready_output=%u/%u "
             "in_output=%u/%u gap=%u/%u underrun_prev_late_wait=%u/%u,%u/%u,%u/%u "
             "hist_le_60_80_120_240_gt "
             "in_output=[%u,%u,%u,%u,%u] gap=[%u,%u,%u,%u,%u]",
             Average(ingress_to_decode), ingress_to_decode.max_us,
             Average(decode_to_output), decode_to_output.max_us,
             Average(ingress_to_output), ingress_to_output.max_us,
             Average(output_gap), output_gap.max_us,
             Average(underrun_previous_output), underrun_previous_output.max_us,
             Average(underrun_ready_late), underrun_ready_late.max_us,
             Average(underrun_ready_wait), underrun_ready_wait.max_us,
             ingress_to_output.buckets[0], ingress_to_output.buckets[1],
             ingress_to_output.buckets[2], ingress_to_output.buckets[3],
             ingress_to_output.buckets[4], output_gap.buckets[0], output_gap.buckets[1],
             output_gap.buckets[2], output_gap.buckets[3], output_gap.buckets[4]);

    ESP_LOGI(kTag,
             "[AUDIO-PERF-CONTENTION] display_fail=%u avg_max_us "
             "display_wait=%u/%u display_span=%u/%u lvgl_guard_wait=%u/%u "
             "lvgl_guard_span=%u/%u led_set=%u/%u/%u led_refresh=%u/%u/%u "
             "hist_le_100_500_2000_10000_gt display_wait=[%u,%u,%u,%u,%u] "
             "display_span=[%u,%u,%u,%u,%u] lvgl_wait=[%u,%u,%u,%u,%u] "
             "lvgl_span=[%u,%u,%u,%u,%u]",
             stats.display_lock_failures, Average(display_wait), display_wait.max_us,
             Average(display_span), display_span.max_us, Average(lvgl_wait), lvgl_wait.max_us,
             Average(lvgl_span), lvgl_span.max_us,
             led_set_i2c.count, Average(led_set_i2c), led_set_i2c.max_us,
             led_refresh_i2c.count, Average(led_refresh_i2c), led_refresh_i2c.max_us,
             display_wait.buckets[0], display_wait.buckets[1], display_wait.buckets[2],
             display_wait.buckets[3], display_wait.buckets[4],
             display_span.buckets[0], display_span.buckets[1], display_span.buckets[2],
             display_span.buckets[3], display_span.buckets[4],
             lvgl_wait.buckets[0], lvgl_wait.buckets[1], lvgl_wait.buckets[2],
             lvgl_wait.buckets[3], lvgl_wait.buckets[4],
             lvgl_span.buckets[0], lvgl_span.buckets[1], lvgl_span.buckets[2],
             lvgl_span.buckets[3], lvgl_span.buckets[4]);

    const auto sink = g_summary_sink.load(std::memory_order_acquire);
    if (sink != nullptr) {
        const auto notification = BuildSummaryNotification(queues, stats, free_heap, minimum_free_heap);
        if (!notification.empty()) {
            sink(notification);
        }
    }
}

}  // namespace

}  // namespace stackchan_audio_diag

#endif
