# XiaoZhi Local-Dock startup prebuffer experiment

This experiment adds one opt-in Host-side variable: hold the beginning of each
Codex downlink segment until either 17 Opus frames are available or 1000 ms has
elapsed. Each frame represents 60 ms of speech. At normal cadence, the 17th
frame arrives 16 intervals after the first, so the expected added wall-clock
latency is about 960 ms and the released audio reservoir is about 1020 ms.

The default remains immediate forwarding. The experiment does not change the
device queue capacity, task priorities, codec, frame duration, audio route,
session ownership, subtitle protocol, or steady-state packet forwarding.

## Offline-approved inputs

- Experiment app image: `firmware/build-xiaozhi-dock-startup-prebuffer-on/stack-chan.bin`
- Exact rollback app image: `firmware/build-xiaozhi-dock-startup-prebuffer-off/stack-chan.bin`
- Both images target only the `ota_0` app partition at `0x20000`; never use the
  generated full flash command for this experiment.

Before any later deployment, recompute and match the recorded SHA-256 and byte
length. A rebuild invalidates the reviewed hash.

## Owner opt-in and collection

Use a controlled handoff of the single existing Owner. Do not start a second
Owner. Set all three variables only for the experiment Owner:

```text
STACKCHAN_LOCAL_DOCK_STARTUP_PREBUFFER_FRAMES=17
STACKCHAN_SUBTITLE_TRACE=1
STACKCHAN_SUBTITLE_TRACE_PATH=<new empty absolute local NDJSON file>
```

Use a separate new empty absolute local path for the existing v2 audio
performance summary writer. The trace contains fixed timing metadata and byte
counts, not Opus, PCM, transcript content, or subtitle text.

`audio_prebuffer` records use schema version 1 and contain only integers:

- `event_code`: 1 start, 2 fill, 3 release, 4 clear without release.
- `release_reason_code`: 0 none, 1 threshold, 2 short segment/activity stop,
  3 disconnect, 4 detach, 5 maximum-delay release.
- `segment_seq`, `target_frames`, `buffered_frames`.
- `first_frame_at_ms`, `observed_at_ms`, `fill_elapsed_ms`,
  `added_latency_ms`.

The existing device v2 summaries remain authoritative for
`underrun_candidates`, `underrun_ready_late_*`, `underrun_ready_wait_*`, queue
high-water marks, drops, decode time, output gaps, and I2S timing. The Host does
not invent an underrun value.

For subtitle alignment, compare the release record's `observed_at_ms` with the
existing subtitle `ws_send` record's `at` value for `sentence_start`. This is a
transport alignment estimate, not a microphone measurement of acoustic onset.

## Acceptance and rollback

Collect equal-length real main-voice samples against the current true-off
baseline. Accept only if all of the following hold:

1. perceived continuity is no worse than the current stable baseline;
2. normal threshold releases stay near 960 ms and maximum-delay releases stay
   near the 1000 ms budget (event-loop delay must be reported, not hidden);
3. `underrun_candidates` and ready-late evidence improve or remain zero without
   increasing drops/decode failures;
4. subtitle alignment remains acceptable to the user.

Regardless of outcome, restore the reviewed true-off app image using the full
app-only backup/write/readback/verify/single-reset protocol, then perform one
controlled Owner handoff with all experiment and diagnostic variables removed.
Confirm authentication, normal robot-exclusive playback, and no further trace
or diagnostic-file growth. A disconnect clears unreleased frames; they are
never replayed into a later session.
