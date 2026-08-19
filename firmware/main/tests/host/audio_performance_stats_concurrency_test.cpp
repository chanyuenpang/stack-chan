#include "hal_audio_performance_stats.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

namespace {

using stackchan_audio_diag::LockedStatsAccumulator;
using stackchan_audio_diag::DecomposeOutputGap;
using stackchan_audio_diag::MergeStatsSnapshot;
using stackchan_audio_diag::StatsSnapshot;
using stackchan_audio_diag::TimingSnapshot;

constexpr uint32_t kDurationUs = 73;
constexpr uint32_t kWriterCount = 4;
constexpr uint32_t kEventsPerWriter = 25'000;

class HostLock {
public:
    void lock()
    {
        mutex_.lock();
    }

    void unlock()
    {
        mutex_.unlock();
    }

private:
    std::mutex mutex_;
};

bool TimingIsConsistent(const TimingSnapshot& timing)
{
    uint32_t bucket_count = 0;
    for (const uint32_t count : timing.buckets) {
        bucket_count += count;
    }
    if (bucket_count != timing.count) {
        return false;
    }
    if (timing.total_us != timing.count * kDurationUs) {
        return false;
    }
    return timing.max_us == (timing.count == 0 ? 0 : kDurationUs);
}

bool SnapshotIsConsistent(const StatsSnapshot& snapshot)
{
    const std::array<const TimingSnapshot*, 19> timings = {
        &snapshot.ingress_queue_wait,
        &snapshot.ingress_to_decode,
        &snapshot.decoder_lock_wait,
        &snapshot.decode,
        &snapshot.resample,
        &snapshot.decode_to_output,
        &snapshot.ingress_to_output,
        &snapshot.output_call,
        &snapshot.i2s_write,
        &snapshot.output_gap,
        &snapshot.underrun_previous_output,
        &snapshot.underrun_ready_late,
        &snapshot.underrun_ready_wait,
        &snapshot.display_lock_wait,
        &snapshot.display_lock_span,
        &snapshot.lvgl_lock_wait,
        &snapshot.lvgl_lock_span,
        &snapshot.led_set_i2c,
        &snapshot.led_refresh_i2c,
    };
    for (const auto* timing : timings) {
        if (!TimingIsConsistent(*timing)) {
            return false;
        }
    }

    if (snapshot.ingress_received !=
        snapshot.ingress_accepted + snapshot.decode_queue_drops) {
        return false;
    }
    if (snapshot.ingress_received != snapshot.ingress_queue_wait.count) {
        return false;
    }
    if (snapshot.ingress_to_decode.count != snapshot.decoder_lock_wait.count ||
        snapshot.decoder_lock_wait.count != snapshot.decode.count ||
        snapshot.decode.count != snapshot.resample.count) {
        return false;
    }
    if (snapshot.decode_to_output.count != snapshot.ingress_to_output.count ||
        snapshot.ingress_to_output.count != snapshot.output_call.count ||
        snapshot.output_call.count != snapshot.output_gap.count) {
        return false;
    }
    if (snapshot.underrun_candidates != snapshot.underrun_decomposition_missing +
            snapshot.underrun_previous_output.count ||
        snapshot.underrun_previous_output.count != snapshot.underrun_ready_late.count ||
        snapshot.underrun_ready_late.count != snapshot.underrun_ready_wait.count) {
        return false;
    }
    return true;
}

}  // namespace

int main()
{
    const auto ready_before_end = DecomposeOutputGap(true, 100, 160, true, 150, 210);
    const auto ready_after_end = DecomposeOutputGap(true, 100, 160, true, 180, 210);
    const auto wrapped = DecomposeOutputGap(true, 0xfffffff0U, 20, true, 30, 50);
    const auto missing = DecomposeOutputGap(true, 100, 160, false, 0, 210);
    if (!ready_before_end.valid || ready_before_end.previous_output_us != 60 ||
        ready_before_end.ready_late_us != 0 || ready_before_end.ready_wait_us != 50 ||
        !ready_after_end.valid || ready_after_end.previous_output_us != 60 ||
        ready_after_end.ready_late_us != 20 || ready_after_end.ready_wait_us != 30 ||
        !wrapped.valid || wrapped.previous_output_us != 36 ||
        wrapped.ready_late_us != 10 || wrapped.ready_wait_us != 20 || missing.valid) {
        std::cerr << "invalid output-gap decomposition" << std::endl;
        return 3;
    }

    HostLock lock;
    LockedStatsAccumulator<HostLock> stats(lock);
    std::atomic<bool> start{false};
    std::atomic<uint32_t> writers_running{kWriterCount};
    std::atomic<bool> failed{false};
    StatsSnapshot aggregate;
    uint32_t non_empty_snapshots_while_writing = 0;

    std::thread snapshotter([&]() {
        while (!start.load(std::memory_order_acquire)) {
            std::this_thread::yield();
        }
        while (writers_running.load(std::memory_order_acquire) != 0) {
            auto snapshot = stats.SnapshotAndReset();
            if (!SnapshotIsConsistent(snapshot)) {
                failed.store(true, std::memory_order_release);
            }
            if (snapshot.ingress_received != 0) {
                ++non_empty_snapshots_while_writing;
            }
            MergeStatsSnapshot(aggregate, snapshot);
            std::this_thread::yield();
        }
        auto tail = stats.SnapshotAndReset();
        if (!SnapshotIsConsistent(tail)) {
            failed.store(true, std::memory_order_release);
        }
        MergeStatsSnapshot(aggregate, tail);
    });

    std::vector<std::thread> writers;
    writers.reserve(kWriterCount);
    for (uint32_t writer = 0; writer < kWriterCount; ++writer) {
        writers.emplace_back([&, writer]() {
            while (!start.load(std::memory_order_acquire)) {
                std::this_thread::yield();
            }
            for (uint32_t event = 0; event < kEventsPerWriter; ++event) {
                const bool accepted = ((event + writer) & 1U) == 0;
                stats.RecordIngress(accepted, accepted ? 3 : 0, kDurationUs);
                stats.RecordDecode(true, kDurationUs, kDurationUs, kDurationUs, kDurationUs);
                stats.RecordOutput(true, kDurationUs, true, kDurationUs, kDurationUs,
                                   true, kDurationUs, ((event + writer) % 7U) == 0,
                                   true, kDurationUs, kDurationUs, kDurationUs);
                stats.RecordI2sWrite(kDurationUs, true);
                if ((event & 0xFFU) == 0) {
                    std::this_thread::yield();
                }
            }
            writers_running.fetch_sub(1, std::memory_order_release);
        });
    }
    start.store(true, std::memory_order_release);

    for (auto& writer : writers) {
        writer.join();
    }
    snapshotter.join();

    const uint32_t expected = kWriterCount * kEventsPerWriter;
    if (failed.load(std::memory_order_acquire) || non_empty_snapshots_while_writing < 2 ||
        !SnapshotIsConsistent(aggregate) ||
        aggregate.ingress_received != expected || aggregate.decode.count != expected ||
        aggregate.output_call.count != expected || aggregate.i2s_write.count != expected) {
        std::cerr << "inconsistent concurrent snapshot" << std::endl;
        return 1;
    }

    stats.RecordIngress(true, 1, kDurationUs);
    const auto sealed = stats.SnapshotAndReset();
    stats.Reset();
    if (sealed.ingress_received != 1 || sealed.ingress_queue_wait.count != 1) {
        std::cerr << "sealed snapshot changed across reset" << std::endl;
        return 2;
    }

    std::cout << "audio performance stats concurrency test passed" << std::endl;
    return 0;
}
