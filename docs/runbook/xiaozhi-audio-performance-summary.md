# XiaoZhi audio performance numeric summary

This path is an opt-in diagnostic transport. It never transports Opus, PCM,
transcripts, subtitle text, or arbitrary metadata.

## Wire contract

The firmware reporter emits one JSON-RPC notification after each numeric
five-second snapshot:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/audio_performance_summary",
  "params": {
    "type": "audio_perf_summary",
    "version": 1,
    "seq": 1,
    "window_ms": 5000,
    "queues": {},
    "counts": {},
    "timing_us": {},
    "contention_us": {},
    "histograms": {},
    "heap": {}
  }
}
```

The existing `Protocol::SendMcpMessage` adds the current `session_id` and MCP
WebSocket envelope. The Dock accepts the event only after its existing Bearer,
device-id, protocol-version, hello, and session-id checks have succeeded. The
summary notification is intercepted before generic `message` and `mcp`
listeners; it cannot become a tool request.

The Dock rejects unknown fields and non-integer values, strips the wire session
identifier, limits accepted summaries to one every four seconds, and does not
close an otherwise valid audio session when a diagnostic record is rejected.

## Backpressure and disconnect behavior

- Firmware has one replaceable pending slot, not a queue. A slow main task can
  lose diagnostic windows but cannot accumulate them.
- The five-second deadline is anchored once when the authenticated audio
  channel opens. Capture-gate pauses may create several shorter Speaking
  segments; their decoder resets must not restart that deadline or the first
  summary can be starved indefinitely.
- Each open/close transition advances a generation. A window captured before a
  disconnect is discarded instead of being sent after reconnection.
- The Host writer allows one in-flight append and no pending queue. It drops a
  second record while busy and drops an in-flight record if its session ends.
- Nothing is replayed after a reconnect.

## Host persistence and reading

Persistence is disabled unless the Electron Owner is started with an absolute
local-drive file path in `STACKCHAN_AUDIO_PERF_SUMMARY_PATH`. UNC, device,
drive-relative, root-only, overlong, and NUL-containing paths are rejected.
The parent directory must already exist and its real path is resolved before
the Owner starts; a parent resolving outside a local absolute path and an
existing symlink destination file are rejected. Records are NDJSON containing only
`received_at_ms` and the validated summary. The file stops accepting records at
8 MiB; it is not silently rotated or truncated.

Code that needs bounded reads should import
`readAudioPerformanceSummaries(filePath, { limit })` from
`@stackchan/dock/xiaozhi-audio-performance-summary`. The reader requires an
absolute path, validates each stored record again, and accepts limits from 1 to
10,000.

Enabling persistence requires a planned Owner restart. Do not change this
environment variable on the currently running production Owner during an HIL
session.

## Collection lifecycle

Use a new empty local directory for every sampling run. The deployment operator
must preserve the exact opt-in and off image hashes together before making any
runtime change.

1. Start the same single Electron Owner with
   `STACKCHAN_AUDIO_PERF_SUMMARY_PATH` set to the absolute NDJSON path. Verify
   that ports 8765/8766 still have exactly one Owner. This restart enables only
   bounded persistence; it does not enable firmware instrumentation.
2. Deploy the opt-in image with
   `ops/bin/flash-xiaozhi-dock-app-only-resumable.ps1`: back up the complete
   current `ota_0` in manifested chunks, re-hash the assembled full-slot
   backup, reserve and perform one app write at `0x20000`, read back the exact
   app length in resumable chunks and compare SHA-256, then run the independent
   flash verify with the single final reset. Never write bootloader, NVS,
   partition table, OTA data, or assets. If write or reset status becomes
   uncertain, do not repeat it automatically; resume only the permitted
   no-write evidence phase recorded by `transaction.json`.
3. Wait for the authenticated device session. Run one Chinese response long
   enough to cross at least two five-second windows. Read the NDJSON through
   `readAudioPerformanceSummaries`; require monotonic sequence values, fixed
   schema, and no string/byte payload fields. Treat the first window after a
   session transition as warm-up, not an optimization basis.
4. Disconnect and reconnect once. No pre-disconnect sequence may appear after
   reconnection. A slow disk may cause explicit loss; it must not cause a later
   burst.
5. Stop instrumentation by app-only OTA of the separately rebuilt and audited
   **off image**. Back up the on slot first and apply the same write/readback/
   verify/one-reset gates. Removing the Host environment variable is not a
   firmware rollback and must never be used as a substitute for this step.
6. After the off image authenticates, run more than ten seconds of playback and
   confirm that the NDJSON does not grow. Then, in a separate controlled Owner
   restart, remove `STACKCHAN_AUDIO_PERF_SUMMARY_PATH` to close the collection
   surface. Keep the bounded NDJSON and both flash backups as evidence.

If the opt-in image fails authentication or destabilizes playback, immediately
restore the audited off app image through the same app-only procedure. Do not
repeat resets, switch slots, or modify OTA metadata as an improvised recovery.

## Build and deployment boundary

`CONFIG_STACKCHAN_XIAOZHI_AUDIO_PERFORMANCE_DIAGNOSTICS` remains default off.
The normal image contains neither the reporter nor the transport strings. An
opt-in image and any Owner restart remain separate deployment actions; this
document does not authorize either one.

The priority-3 single-variable experiment candidates rebuilt and audited on
2026-08-14 are:

- opt-in: SHA-256
  `2B675B5643E172A7619F9EB1029D8F4CCE283F483875AF5A12EDD625D74869F3`,
  4,966,880 bytes; this enables diagnostics and changes only the Opus codec
  task priority from 2 to 3 while keeping audio output priority 4;
- off rollback: SHA-256
  `EA079E26012B8FF11C613A3390A2E2D910221E258CDC85608CDA78E857F24699`,
  4,954,784 bytes.

Rebuilding either image invalidates these hashes and requires composition and
partition-size audit again.
