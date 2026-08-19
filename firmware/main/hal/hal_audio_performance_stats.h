#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace stackchan_audio_diag {

struct TimingSnapshot {
    uint32_t count = 0;
    uint32_t total_us = 0;
    uint32_t max_us = 0;
    std::array<uint32_t, 5> buckets{};
};

struct OutputGapDecomposition {
    bool valid = false;
    uint32_t previous_output_us = 0;
    uint32_t ready_late_us = 0;
    uint32_t ready_wait_us = 0;
};

inline OutputGapDecomposition DecomposeOutputGap(bool has_output_gap,
                                                 uint32_t last_output_start_us,
                                                 uint32_t last_output_end_us,
                                                 bool has_decode_ready_timestamp,
                                                 uint32_t decode_ready_us,
                                                 uint32_t output_start_us)
{
    OutputGapDecomposition result;
    if (!has_output_gap || last_output_end_us == 0 || !has_decode_ready_timestamp) {
        return result;
    }

    const int32_t previous_output_us =
        static_cast<int32_t>(last_output_end_us - last_output_start_us);
    const int32_t ready_after_output_us =
        static_cast<int32_t>(decode_ready_us - last_output_end_us);
    const uint32_t ready_or_output_end_us =
        ready_after_output_us > 0 ? decode_ready_us : last_output_end_us;
    const int32_t ready_wait_us =
        static_cast<int32_t>(output_start_us - ready_or_output_end_us);
    if (previous_output_us < 0 || ready_wait_us < 0) {
        return result;
    }

    result.valid = true;
    result.previous_output_us = static_cast<uint32_t>(previous_output_us);
    result.ready_late_us = ready_after_output_us > 0
        ? static_cast<uint32_t>(ready_after_output_us)
        : 0;
    result.ready_wait_us = static_cast<uint32_t>(ready_wait_us);
    return result;
}

struct StatsSnapshot {
    uint32_t ingress_received = 0;
    uint32_t ingress_accepted = 0;
    uint32_t decode_queue_drops = 0;
    uint32_t ingress_timestamp_missing = 0;
    uint32_t decode_failures = 0;
    uint32_t i2s_write_failures = 0;
    uint32_t underrun_candidates = 0;
    uint32_t underrun_decomposition_missing = 0;
    uint32_t decode_queue_high_water = 0;
    uint32_t playback_queue_high_water = 0;
    uint32_t display_lock_failures = 0;

    TimingSnapshot ingress_queue_wait;
    TimingSnapshot ingress_to_decode;
    TimingSnapshot decoder_lock_wait;
    TimingSnapshot decode;
    TimingSnapshot resample;
    TimingSnapshot decode_to_output;
    TimingSnapshot ingress_to_output;
    TimingSnapshot output_call;
    TimingSnapshot i2s_write;
    TimingSnapshot output_gap;
    TimingSnapshot underrun_previous_output;
    TimingSnapshot underrun_ready_late;
    TimingSnapshot underrun_ready_wait;
    TimingSnapshot display_lock_wait;
    TimingSnapshot display_lock_span;
    TimingSnapshot lvgl_lock_wait;
    TimingSnapshot lvgl_lock_span;
    TimingSnapshot led_set_i2c;
    TimingSnapshot led_refresh_i2c;
};

inline void MergeTimingSnapshot(TimingSnapshot& target, const TimingSnapshot& source)
{
    target.count += source.count;
    target.total_us += source.total_us;
    if (source.max_us > target.max_us) {
        target.max_us = source.max_us;
    }
    for (size_t i = 0; i < target.buckets.size(); ++i) {
        target.buckets[i] += source.buckets[i];
    }
}

inline void MergeStatsSnapshot(StatsSnapshot& target, const StatsSnapshot& source)
{
    target.ingress_received += source.ingress_received;
    target.ingress_accepted += source.ingress_accepted;
    target.decode_queue_drops += source.decode_queue_drops;
    target.ingress_timestamp_missing += source.ingress_timestamp_missing;
    target.decode_failures += source.decode_failures;
    target.i2s_write_failures += source.i2s_write_failures;
    target.underrun_candidates += source.underrun_candidates;
    target.underrun_decomposition_missing += source.underrun_decomposition_missing;
    if (source.decode_queue_high_water > target.decode_queue_high_water) {
        target.decode_queue_high_water = source.decode_queue_high_water;
    }
    if (source.playback_queue_high_water > target.playback_queue_high_water) {
        target.playback_queue_high_water = source.playback_queue_high_water;
    }
    target.display_lock_failures += source.display_lock_failures;

    MergeTimingSnapshot(target.ingress_queue_wait, source.ingress_queue_wait);
    MergeTimingSnapshot(target.ingress_to_decode, source.ingress_to_decode);
    MergeTimingSnapshot(target.decoder_lock_wait, source.decoder_lock_wait);
    MergeTimingSnapshot(target.decode, source.decode);
    MergeTimingSnapshot(target.resample, source.resample);
    MergeTimingSnapshot(target.decode_to_output, source.decode_to_output);
    MergeTimingSnapshot(target.ingress_to_output, source.ingress_to_output);
    MergeTimingSnapshot(target.output_call, source.output_call);
    MergeTimingSnapshot(target.i2s_write, source.i2s_write);
    MergeTimingSnapshot(target.output_gap, source.output_gap);
    MergeTimingSnapshot(target.underrun_previous_output, source.underrun_previous_output);
    MergeTimingSnapshot(target.underrun_ready_late, source.underrun_ready_late);
    MergeTimingSnapshot(target.underrun_ready_wait, source.underrun_ready_wait);
    MergeTimingSnapshot(target.display_lock_wait, source.display_lock_wait);
    MergeTimingSnapshot(target.display_lock_span, source.display_lock_span);
    MergeTimingSnapshot(target.lvgl_lock_wait, source.lvgl_lock_wait);
    MergeTimingSnapshot(target.lvgl_lock_span, source.lvgl_lock_span);
    MergeTimingSnapshot(target.led_set_i2c, source.led_set_i2c);
    MergeTimingSnapshot(target.led_refresh_i2c, source.led_refresh_i2c);
}

template <typename Lock>
class LockedStatsAccumulator {
public:
    explicit LockedStatsAccumulator(Lock& lock) : lock_(lock) {}

    LockedStatsAccumulator(const LockedStatsAccumulator&) = delete;
    LockedStatsAccumulator& operator=(const LockedStatsAccumulator&) = delete;

    void RecordIngress(bool accepted, uint32_t decode_queue_depth, uint32_t queue_wait_us)
    {
        Guard guard(lock_);
        ++stats_.ingress_received;
        RecordTiming(stats_.ingress_queue_wait, queue_wait_us, kShortThresholdsUs);
        if (accepted) {
            ++stats_.ingress_accepted;
            UpdateMax(stats_.decode_queue_high_water, decode_queue_depth);
        } else {
            ++stats_.decode_queue_drops;
        }
    }

    void RecordIngressTimestampMissing()
    {
        Guard guard(lock_);
        ++stats_.ingress_timestamp_missing;
    }

    void RecordDecode(bool has_ingress_timestamp, uint32_t ingress_to_decode_us,
                      uint32_t decoder_lock_wait_us, uint32_t decode_us,
                      uint32_t resample_us)
    {
        Guard guard(lock_);
        if (has_ingress_timestamp) {
            RecordTiming(stats_.ingress_to_decode, ingress_to_decode_us, kAudioThresholdsUs);
        }
        RecordTiming(stats_.decoder_lock_wait, decoder_lock_wait_us, kShortThresholdsUs);
        RecordTiming(stats_.decode, decode_us, kShortThresholdsUs);
        RecordTiming(stats_.resample, resample_us, kShortThresholdsUs);
    }

    void RecordDecodeFailure()
    {
        Guard guard(lock_);
        ++stats_.decode_failures;
    }

    void RecordPlaybackQueueDepth(uint32_t playback_queue_depth)
    {
        Guard guard(lock_);
        UpdateMax(stats_.playback_queue_high_water, playback_queue_depth);
    }

    void RecordOutput(bool has_ingress_timestamp, uint32_t ingress_to_output_us,
                      bool has_decode_ready_timestamp, uint32_t decode_to_output_us,
                      uint32_t output_call_us, bool has_output_gap, uint32_t output_gap_us,
                      bool underrun_candidate, bool has_underrun_decomposition,
                      uint32_t previous_output_us, uint32_t ready_late_us,
                      uint32_t ready_wait_us)
    {
        Guard guard(lock_);
        if (has_ingress_timestamp) {
            RecordTiming(stats_.ingress_to_output, ingress_to_output_us, kAudioThresholdsUs);
        }
        if (has_decode_ready_timestamp) {
            RecordTiming(stats_.decode_to_output, decode_to_output_us, kAudioThresholdsUs);
        }
        RecordTiming(stats_.output_call, output_call_us, kAudioThresholdsUs);
        if (has_output_gap) {
            RecordTiming(stats_.output_gap, output_gap_us, kAudioThresholdsUs);
        }
        if (underrun_candidate) {
            ++stats_.underrun_candidates;
            if (has_underrun_decomposition) {
                RecordTiming(stats_.underrun_previous_output, previous_output_us,
                             kAudioThresholdsUs);
                RecordTiming(stats_.underrun_ready_late, ready_late_us,
                             kAudioThresholdsUs);
                RecordTiming(stats_.underrun_ready_wait, ready_wait_us,
                             kAudioThresholdsUs);
            } else {
                ++stats_.underrun_decomposition_missing;
            }
        }
    }

    void RecordI2sWrite(uint32_t duration_us, bool success)
    {
        Guard guard(lock_);
        RecordTiming(stats_.i2s_write, duration_us, kAudioThresholdsUs);
        if (!success) {
            ++stats_.i2s_write_failures;
        }
    }

    void RecordDisplayGuardWait(uint32_t wait_us, bool success)
    {
        Guard guard(lock_);
        RecordTiming(stats_.display_lock_wait, wait_us, kShortThresholdsUs);
        if (!success) {
            ++stats_.display_lock_failures;
        }
    }

    void RecordDisplayGuardSpan(uint32_t span_us)
    {
        Guard guard(lock_);
        RecordTiming(stats_.display_lock_span, span_us, kShortThresholdsUs);
    }

    void RecordLvglGuardWait(uint32_t wait_us)
    {
        Guard guard(lock_);
        RecordTiming(stats_.lvgl_lock_wait, wait_us, kShortThresholdsUs);
    }

    void RecordLvglGuardSpan(uint32_t span_us)
    {
        Guard guard(lock_);
        RecordTiming(stats_.lvgl_lock_span, span_us, kShortThresholdsUs);
    }

    void RecordLedSetI2c(uint32_t duration_us)
    {
        Guard guard(lock_);
        RecordTiming(stats_.led_set_i2c, duration_us, kShortThresholdsUs);
    }

    void RecordLedRefreshI2c(uint32_t duration_us)
    {
        Guard guard(lock_);
        RecordTiming(stats_.led_refresh_i2c, duration_us, kShortThresholdsUs);
    }

    StatsSnapshot SnapshotAndReset()
    {
        Guard guard(lock_);
        const StatsSnapshot snapshot = stats_;
        stats_ = StatsSnapshot{};
        return snapshot;
    }

    void Reset()
    {
        Guard guard(lock_);
        stats_ = StatsSnapshot{};
    }

private:
    class Guard {
    public:
        explicit Guard(Lock& lock) : lock_(lock)
        {
            lock_.lock();
        }

        ~Guard()
        {
            lock_.unlock();
        }

        Guard(const Guard&) = delete;
        Guard& operator=(const Guard&) = delete;

    private:
        Lock& lock_;
    };

    static constexpr std::array<uint32_t, 4> kShortThresholdsUs = {
        100, 500, 2'000, 10'000};
    static constexpr std::array<uint32_t, 4> kAudioThresholdsUs = {
        60'000, 80'000, 120'000, 240'000};

    static void UpdateMax(uint32_t& target, uint32_t value)
    {
        if (value > target) {
            target = value;
        }
    }

    static size_t BucketFor(uint32_t value, const std::array<uint32_t, 4>& thresholds)
    {
        for (size_t i = 0; i < thresholds.size(); ++i) {
            if (value <= thresholds[i]) {
                return i;
            }
        }
        return thresholds.size();
    }

    static void RecordTiming(TimingSnapshot& stats, uint32_t duration_us,
                             const std::array<uint32_t, 4>& thresholds)
    {
        ++stats.count;
        stats.total_us += duration_us;
        UpdateMax(stats.max_us, duration_us);
        ++stats.buckets[BucketFor(duration_us, thresholds)];
    }

    Lock& lock_;
    StatsSnapshot stats_{};
};

}  // namespace stackchan_audio_diag
