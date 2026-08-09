# Wi-Fi no-modem-sleep candidate

- Hypothesis: the isolated Wi-Fi Audio runtime retains ESP-IDF's default `WIFI_PS_MIN_MODEM`, delaying real-time downlink until DTIM wakeups.
- Single product change: after station association, set `WIFI_PS_NONE`, read it back, and log RSSI/channel plus the before/after mode.
- App image: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-no-ps-20260806.bin`
- Build output: `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-short/stack-chan.bin`
- Size: `3,821,920 bytes` (`0x3A5160`)
- SHA-256: `AAF073C47C570C723307EFCF8AB77F6769CDD7EA629F19C6685226F2641EEF81`
- ESP-IDF: `5.5.5`; target: ESP32-S3; project version: `2.0.45`
- Partition check: smallest app partition `0x4F0000`; free `0x14AEA0` (26%).

## Pre-flash evidence

- Real-speech host capture: no overflow, host queue drop, or clipping; 859 active 10 ms frames.
- Dock downlink: repeated 100--930.707 ms WebSocket sends; bounded pipe dropped more than 500 stale frames.
- Idle A/B, 15 pings each: robot `97--1384 ms`, average `741 ms`, 0% loss; gateway `1--23 ms`, average `3 ms`, 0% loss.
- Firmware contract: 21/21 passed.
- Dock Node tests: 33/33 passed.
- Full ESP-IDF build and partition-size check: passed.

## Required acceptance order

1. App-only flash to `ota_0` at `0x20000`, followed by independent digest verification.
2. Physical reset into the application; capture the power-save/RSSI/channel log.
3. Before audio, repeat the same 15-ping robot/gateway A/B. The candidate fails if robot latency remains in the hundreds of milliseconds.
4. Only if idle latency is restored to the local real-time range, play one real Chinese speech sentence and compare Dock send latency/drop counters.
5. Keep head touch and all active servo motion prohibited during this isolated audio test.

## Flash result

- Port/device: `COM7`, ESP32-S3 revision v0.2, factory MAC `44:1b:f6:e2:78:a8`.
- Scope: app-only write at `0x20000`; bootloader, partition table, NVS, and assets were not written.
- Write result: `3,821,920` bytes written; esptool reported `Hash of data verified`.
- Independent result: `verify_flash 0x20000 ...` reported `verify OK (digest matched)`.
- Post-verify boundary: esptool's `Hard resetting via RTS pin` did not start the application; `192.168.0.8` remained unreachable. A physical short RST is required before runtime acceptance, matching earlier observations on this unit.

## Runtime result

- Physical RST restored the application and authenticated Dock connection.
- Idle 15-ping A/B after the fix: robot `2--143 ms`, average `30 ms`, 0% loss; gateway `2--3 ms`, average `2 ms`, 0% loss. The prior robot baseline was `97--1384 ms`, average `741 ms`.
- Dock restart exposed that the original pairing key existed only in the terminated process environment. A fresh 256-bit key was generated, sent through the existing BLE configuration characteristic, and stored on Windows as a current-user DPAPI ciphertext. The new Dock authenticated successfully; the key was not printed or placed on its command line.
- `tools/stackchan-dock/scripts/start-wifi-audio-dock.ps1` was then used for a second real Dock restart. It decrypted the DPAPI secret in memory and re-established exactly one authenticated robot connection.
- Real Chinese TTS sent `856` active 10 ms frames. Host capture reported zero overflow, queue drop, and clipping. Dock maximum WebSocket send latency was `0.564 ms`, `slow_sends=0`, and the bounded speaker pipe reported no drop.
- During speech, 20 pings to the robot were `3--141 ms`, average `39 ms`, 0% loss. The authenticated TCP connection remained established and microphone uplink stayed at `gaps=0`.
- The robot microphone return showed peaks up to full scale during speaker playback, objectively proving acoustic playback occurred while also exposing a remaining echo/half-duplex isolation concern for Codex Desktop Voice.
- User perceptual confirmation of clarity and the absence of late-sentence stutter is still required before the real-speech acceptance is marked complete.

## Follow-up TCP receive-priority candidate

- User result after two same-sentence replays: playback still stuttered.
- Device counters at the next authenticated status: `received_frames=2667`, `played_frames=2341`, `underruns=72`, `queue_drops=326`, `sequence_gaps=326`.
- Instrumented failure: WebSocket send latency reached `1029.266 ms`; the bounded PC speaker pipe dropped more than 600 stale frames while host capture stayed at zero overflow/queue drop/clipping.
- Fault-window ping: robot `5/10`, `457--666 ms`, average `540 ms`; gateway `10/10`, average `21 ms`.
- Microphone-disabled idle A/B: robot `6/6`, average `35 ms`. Speaker-only load still reached `524.132 ms` send latency and average `275 ms` ping, so uplink contention was not the sole cause.
- Source/upstream comparison: locked `78/esp-ml307 3.6.5` and current upstream `3.6.6` both create `tcp_receive` at priority 1; this project runs 10 ms raw PCM audio workers at priority 4, while standard Xiaozhi uses lower-packet-rate Opus and normally disables voice processing while speaking.
- Single firmware change: after this isolated runtime's WebSocket connects, find `tcp_receive`, raise it to priority 5, and log the actual before/after priority.
- App image: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-rx-priority-20260806.bin`
- Build output: `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-short/stack-chan.bin`
- Size: `3,822,496 bytes` (`0x3A53A0`)
- SHA-256: `0E233FA4A526A38DCE3456736A637CB2D15D14650CEB4A496D6E8138CC1B6272`
- Pre-flash checks: firmware contract `22/22`, Dock Node `33/33`, ESP-IDF 5.5.5 full build and partition-size check all passed; smallest app partition remains 26% free.
- Current boundary before the result below: the candidate had not yet been flashed. Even after verified write, do not claim that task priority is the confirmed root cause until a physical reset, idle ping, and same-sentence playback show low latency with no new device queue drops or sequence gaps.

### Receive-priority flash result

- Automatic esptool reset from the running `COM7` application successfully entered the ESP32-S3 ROM loader; no manual download-mode action was required.
- Identity before write: ESP32-S3 revision v0.2, factory MAC ending `78:a8`.
- Scope: app-only write of `3,822,496` bytes at `0x20000`; bootloader, partition table, NVS, Wi-Fi credentials, and pairing data were not written.
- Write result: esptool reported `Hash of data verified`.
- Independent result: `verify_flash 0x20000 ...` reported `verify OK (digest matched)`.
- Both the ROM `run` command and a subsequent RTS `hard_reset` left `192.168.0.8` unreachable. This matches the unit's previous post-flash behavior and requires a physical short RST before runtime validation; it is not evidence that the verified image failed to write.

### Receive-priority runtime result

- After physical RST, the robot established a fresh authenticated Dock session. Microphone uplink reached more than `21001` frames with `gaps=0`, and the VB-CABLE sink reported `underflows=0`.
- Direct 24 kHz Chinese speech sent `1045` 10 ms frames. The PC pipe sent all frames with `droppedFrames=0`; WebSocket maximum send latency was `0.658 ms`, and robot ping was `12/12`, average `46 ms`, maximum `91 ms`.
- The user confirmed that this playback was clear. This verifies that raising `tcp_receive` removed the earlier several-hundred-millisecond backpressure and the severe audible stutter.
- Device counters still increased by `queue_drops=27` and `sequence_gaps=27`. A second 1.4x-gain replay remained host-clean but increased device queue drops by another `132`; the user requested the slightly higher volume, but this remaining internal loss prevents objective downlink closeout.
- Scheduling inspection found `tcp_receive` at priority 5 while `wifi_speaker` remained at priority 4. The receiver can therefore preempt the real-time player during a receive burst and overflow the 12-frame queue. The next candidate raises only `wifi_speaker` to priority 6, preserving `wifi_audio` at 4 and `tcp_receive` at 5.

### Dock single-robot connection rule

- The product supports one robot per Dock. `WifiDockTransport.attach()` now closes the prior authenticated socket before installing the new one, and the old socket's delayed close callback is guarded so it cannot detach the replacement.
- A failing-first reconnect test now proves that the previous socket closes, the new socket remains usable for binary speaker data, and reconnect accounting increments once. Dock results: Node `34/34`, Python `19/19`, syntax check passed.
- The status probe was also corrected to wait for three seconds with an unchanged received-frame counter; it no longer inserts `get_status` requests during ongoing speech.

## Speaker-priority candidate

- Single firmware change: run `wifi_speaker` at FreeRTOS priority 6 so I2S playback preempts priority-5 TCP receive bursts.
- App image: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-speaker-priority-20260806.bin`
- Size: `3,822,496 bytes` (`0x3A53A0`)
- SHA-256: `4584F5A3B04959C0A8593330AAFCBE53D2F23BAE6208FDF421CDF4337F100496`
- Pre-flash checks: firmware contracts `42/42`, Dock Node `34/34`, Dock Python `19/19`, syntax check, full ESP-IDF 5.5.5 build, and partition-size check passed.
- Flash scope/result: app-only write at `0x20000`; bootloader, partition table, NVS, assets, Wi-Fi credentials, and pairing data were not written. Esptool reported `Hash of data verified`; independent `verify_flash` reported `verify OK (digest matched)`.
- Current boundary: the device remains in the ROM loader after verified write. Physical RST is required before runtime validation; no runtime claim is made yet.
