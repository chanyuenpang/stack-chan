# Wi-Fi audio single-sender candidate history

## Candidate A identity: single-slot unpinned workers

- Historical app image: the build path was `firmware/build-wifi-audio-short/stack-chan.bin`, but that mutable path has since been replaced by newer candidates; identify Candidate A by the size and SHA-256 below.
- Size: `3,821,360 bytes` (`0x3A4F30`)
- SHA-256: `252FBA5734F91685B7BDF1151E532E1A020E9EE1DFD947E24A4DC614C321FD11`
- Target: ESP32-S3 revision v0.2; expected factory MAC `44:1b:f6:e2:78:a8`
- Write scope: app-only at `ota_0@0x20000`; expected live partition size `0x4f0000`
- The write must not modify the bootloader, partition table, otadata, NVS, assets, Wi-Fi credentials, or pairing data.

## Offline evidence

- Firmware contract tests: `60/60` passed.
- Dock Node tests: `38/38` passed.
- ESP-IDF 5.5.5 full configure/build/link and partition-size check passed.
- The current candidate hash was independently recalculated from the build artifact on 2026-08-07.
- The durable managed-component patch was checked against a clean upstream checkout and against the materialized dependency source.
- Final read-only review found no remaining P0/P1 defect in the single-sender, timeout, connection-generation, or TLS/TCP shutdown path.

## Guarded flash route

Use `ops/bin/flash-wifi-audio-final.ps1` only after the USB download port appears.

1. Run without `-Execute`. It verifies the exact candidate length/hash, ESP32-S3 identity, factory MAC, and the live `ota_0` layout. It performs no flash write.
2. Only after preflight passes, run the same command with `-Execute`.
3. The script writes only the candidate at `0x20000` and immediately performs an independent `verify_flash` over the same image.
4. This CoreS3 has repeatedly remained in the ROM loader after the tool's automatic reset. After successful verification, use one physical short RST with all buttons released.

## One combined runtime acceptance

Keep head touch and all servo motion prohibited during this acceptance.

1. Confirm exactly one authenticated robot connection replaces any stale Dock connection.
2. Request `get_status`; preserve heap and task stack high-water metrics as the post-boot baseline.
3. Confirm microphone uplink reaches VB-CABLE with `gaps=0` and no Dock underflow.
4. Send the established 24 kHz mono s16le real Chinese speech sample once. Require host `slow_sends=0`, host dropped frames `=0`, and no material increase in device queue drops or sequence gaps.
5. Ask the user for one listening confirmation of clarity and adequate volume.
6. In the same boot and connection, the user manually opens Codex Voice. Confirm Codex receives robot speech and its spoken reply reaches the robot speaker without duplicated local playback.
7. Confirm listening/speaking state lights agree with the actual audio direction.
8. Stop and restart the Dock once. Require a clean disconnect and one replacement connection, without reboot or stuck socket.

## No-USB closeout

Only after the combined runtime acceptance passes:

1. Disconnect the USB data cable while keeping the robot on battery power.
2. Repeat status, microphone, and one Codex Voice reply over Wi-Fi only.
3. Record the final counters and user confirmation in this manifest and the main boot-diagnostics document.
4. Complete claw task #6, then task #7, and close the plan only when every item above is evidenced.

## Flash result

- Port/device: `COM7`, ESP32-S3 revision v0.2, factory MAC `44:1b:f6:e2:78:a8`.
- Live partition table: `ota_0@0x20000`, size `5056K` (`0x4f0000`).
- Scope: app-only write of `3,821,360` bytes at `0x20000`; actual erase range `0x20000..0x3c4fff`, fully inside `ota_0`.
- Built-in result: `Hash of data verified`.
- Independent result: `verify_flash 0x20000 ...` reported `verify OK (digest matched)`.
- No bootloader, partition table, otadata, NVS, assets, Wi-Fi credentials, or pairing data was written.

## Candidate A runtime result: failed before the listening test

- A physical RST booted the new app and created a genuinely new Dock TCP session. The first `get_status` succeeded.
- With no speaker traffic, Dock microphone sequence gaps increased continuously: the fresh Dock process reported `gaps=45` at 501 received frames, `605` at 3,501 frames, and later more than `6,000` gaps at about 60,000 received frames. VB-CABLE itself stayed at `underflows=0`.
- The robot also reauthenticated three times with the same Dock process, consistent with the firmware's bounded 200 ms send failure/abort path rather than a frozen socket.
- No real-speech playback or Codex Voice listening test was run after this gate failed. Per the low-cost-test rule, the failure was taken back to scheduling/source analysis instead of collecting subjective audio evidence.
- The application log console is configured for UART0, not USB Serial/JTAG. A DTR/RTS-safe 20-second idle capture and a 35-second Dock-restart capture both opened `COM7` without resetting the robot but received zero bytes. Runtime diagnostics therefore have to travel in the typed `get_status` response.

## Candidate B identity: dual-core bounded-jitter follow-up

- Root cause: one 240-sample frame is produced every 10 ms and the configured FreeRTOS tick is also 100 Hz. Candidate A placed capture and TX at the same priority with no affinity and used a one-slot overwrite queue. ESP-IDF 5.5.5 documents that equal-priority unpinned SMP scheduling provides only best-effort round robin, so ordinary one-tick jitter became deliberate microphone loss.
- Scheduling: Wi-Fi/WebSocket TX is pinned to Core 0 at priority 5. Microphone capture is pinned to Core 1 at priority 4. Speaker I2S is pinned to Core 1 at priority 6 so TCP receive cannot starve playback. Network work remains below the lwIP TCP/IP task priority.
- Buffering: microphone TX uses four 10 ms slots. A full queue discards only its oldest frame and increments an explicit counter, bounding added latency to 40 ms while absorbing normal scheduler jitter.
- Typed telemetry: `get_status` now includes microphone captured/sent/drop/queued counters, TX maximum send time/slow/failure counters, heap current/minimum bytes, task stack high-water values, and the fixed worker-core mapping.
- Control boundary: firmware, Dock WebSocket `maxPayload`, and Dock protocol parsing use the same bounded 1,024-byte control limit. A worst-case status envelope with every counter at `UINT32_MAX` is 812 bytes.
- Historical app image: the mutable build path has since been replaced by Candidate C; identify Candidate B by the size and SHA-256 below.
- Size: `3,822,672 bytes` (`0x3A5450`)
- SHA-256: `6CB9D1E374E72BDB83CD39E5F49D6198CB418A7AF7FBD2761BFA9B8F3D2C925B`
- ESP-IDF image inspection: ESP32-S3 image v1, six segments, checksum and validation hash valid.
- Partition check: end-exclusive address `0x3C5450`, inside `ota_0@0x20000 size 0x4f0000`; smallest app partition remains 26% free.
- Offline gates: firmware contracts `61/61`, Dock Node `38/38`, 812-byte worst-case control-envelope check, ESP-IDF 5.5.5 full build/link, and partition-size check passed.

## Candidate B flash result

- Port/device was rechecked as `COM7`, ESP32-S3 revision v0.2, factory MAC `44:1b:f6:e2:78:a8`.
- The live partition table was re-read as `ota_0@0x20000 size 5056K` (`0x4f0000`).
- App-only write length was `3,822,672` bytes at `0x20000`; actual erase range `0x20000..0x3c5fff`, fully inside `ota_0`.
- esptool reported `Hash of data verified`; independent `verify_flash` reported `verify OK (digest matched)`.
- No bootloader, partition table, otadata, NVS, assets, Wi-Fi credentials, or pairing data was written.

## Candidate B runtime result: rejected at the idle gate

- After a physical RST, the first typed status reported microphone `captured_frames=27`, `sent_frames=22`, `queue_drops=5`, and `queued_frames=0` before any speaker traffic.
- The same status measured TX `max_send_us=96392`, `slow_sends=3`, and `failed_sends=0`; heap and worker stacks retained comfortable headroom and the requested Core 0/Core 1 mapping was active.
- Sequence gaps still grew continuously with no downlink audio: `377` gaps at 501 received frames, `684` at 1,001, and `1,325` at 4,001. This is worse than Candidate A's early idle result, so no listening or Codex Voice test was run.
- This proves that task affinity and a four-slot queue do not remove the immediate bottleneck. The direct measured mechanism is an otherwise successful small-frame TCP send occasionally blocking for about 96 ms, long enough to overflow four 10 ms microphone slots.

## Candidate C identity: disable Nagle for real-time frames

- Single variable relative to Candidate B: the Wi-Fi audio WebSocket requests `TCP_NODELAY`; the managed component applies it to the underlying socket for both plain TCP and TLS. Candidate B's task affinity, priorities, four-slot queue, timeout, protocol sizes, and telemetry are unchanged.
- Rationale: microphone WebSocket frames are emitted every 10 ms and are much smaller than a TCP maximum segment. ESP-IDF 5.5.5 documents `TCP_NODELAY` as the standard way to minimize latency by disabling Nagle aggregation. This is a high-confidence hypothesis until runtime counters verify it, not yet a proven root cause.
- Current app image: `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-short/stack-chan.bin`
- Size: `3,823,280 bytes` (`0x3A56B0`)
- SHA-256: `B252FA733B737672D5E34C3CCCECCAAB6E131CF94345D696F46233EB04A52A90`
- Partition check: end-exclusive address `0x3C56B0`, inside `ota_0@0x20000 size 0x4f0000`; the smallest app partition remains 26% free.
- Offline gates: the new failing-first contract turned green, firmware contracts `62/62`, Dock Node `38/38`, Dock syntax checks, managed-component patch forward/reverse checks, ESP-IDF 5.5.5 full build/link, and partition-size check all passed.

## Candidate C flash result

- The guarded preflight rechecked `COM7` as ESP32-S3 revision v0.2 with the expected factory MAC and re-read `ota_0@0x20000 size 5056K`.
- The exact `3,823,280`-byte image was written app-only at `0x20000`; esptool erased `0x20000..0x3c5fff`, fully inside `ota_0`.
- The write reported `Hash of data verified`; the separate `verify_flash 0x20000 + 0x3A56B0` reported `verify OK (digest matched)`.
- No bootloader, partition table, otadata, NVS, assets, Wi-Fi credentials, or pairing data was written.

## Current boundary

Candidates A, B, and C are objectively rejected before listening. Candidate C auto-booted after the verified write and authenticated to the fresh Dock process, so another physical RST was not required. Its first status already showed `captured=398`, `sent=39`, `queue_drops=349`, `queued_frames=3`, TX `max_send_us=1855633`, `slow_sends=11`, and `failed_sends=1`; the Dock then observed ten authenticated sessions and repeated control timeouts. Queue drops were 87.69% of captures and completed sends were 9.80%; ten captured frames are not closed by sent/drop/queued and may include an in-flight send or generation reset, so they are not relabeled without evidence. The measured 1.86-second wall-clock call also proves only that the configured 200 ms socket timeout was not an end-to-end `WebSocket::Send()` deadline, not which lower network layer caused the delay. `TCP_NODELAY` therefore did not remove the idle uplink failure, and no listening test was spent. Raw logs are preserved as `candidate-c-runtime.stdout.log` and `candidate-c-runtime.stderr.log` in this directory.

The next evidence-backed route is not a larger TCP queue or half-duplex playback gate: idle microphone-only TCP already fails. The exact hardware has previously delivered 6,644 four-channel UDP diagnostic packets with only 42 explicitly detected losses while carrying roughly four times the production mono payload rate. The next candidate will keep authenticated WebSocket for typed control and speaker downlink, but move the loss-tolerant microphone uplink to session-bound, non-blocking UDP so a lost packet cannot stall later real-time frames.

## Candidate D identity: session-bound non-blocking UDP microphone uplink

- Control commands and speaker PCM remain on the authenticated WebSocket/TCP connection. Microphone PCM no longer enters a WebSocket queue or TCP send path; each 10 ms frame is sent independently with non-blocking UDP.
- Each fixed 516-byte datagram contains the `SCAU` magic, protocol version, microphone flag, sequence, capture timestamp, 480-byte PCM payload length, a fresh 16-byte connection session, and 480 bytes of mono PCM.
- The Dock creates a new random session after each authenticated WebSocket hello and accepts UDP only from that connection's source IP and session. Duplicate, out-of-order, stale-session, invalid, and legacy WebSocket microphone frames are rejected and counted.
- The session value prevents accidental or stale cross-session delivery; it is not encryption. The current development transport is trusted-LAN plaintext, matching the existing `ws://` security boundary. Production confidentiality requires a separately designed encrypted media transport.
- `microphone_stats.queue_drops` is retained as a compatibility field but now counts microphone datagrams that could not be sent immediately; `queued_frames` is always zero, and `udp_send_failures` exposes the same failed-send class explicitly.
- Current app image: `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-short/stack-chan.bin`
- Size: `3,824,656 bytes` (`0x3A5C10`)
- SHA-256: `43A5AC09C522E650DBA4AAF8E0E00BD551987D7011C607739DCEF1D58E58D47D`
- Partition check: end-exclusive address `0x3C5C10`, inside `ota_0@0x20000 size 0x4f0000`; the smallest app partition remains 26% free.
- Offline gates: firmware contracts `62/62`, Dock Node tests `39/39`, Dock Python tests `19/19`, Dock syntax check, ESP-IDF 5.5.5 full build/link, and partition-size check passed.
- Runtime acceptance is intentionally still open. A fresh Dock process must receive at least 5,000 UDP frames with `udp_frames > 0`, `websocket_frames = 0`, no reconnect or control timeout, zero device UDP send failures, zero invalid/duplicate/out-of-order packets, and initially zero sequence gaps before any listening test is spent.

## Candidate D flash result

- The guarded preflight rechecked `COM7` as ESP32-S3 revision v0.2 with factory MAC `44:1b:f6:e2:78:a8` and re-read the live `ota_0@0x20000 size 5056K` (`0x4f0000`) partition.
- The exact `3,824,656`-byte image was written app-only at `0x20000`; its end-exclusive address is `0x3C5C10`, and the sector-aligned erase range `0x20000..0x3c5fff` remained fully inside `ota_0`.
- esptool reported `Hash of data verified`; the independent `verify_flash 0x20000 + 0x3A5C10` reported `verify OK (digest matched)`.
- No bootloader, partition table, otadata, NVS, assets, Wi-Fi credentials, or pairing data was written.

## Candidate D runtime result: exact idle gate passed

- Fresh Dock session `wifi-audio-dock-20260807-023316` authenticated exactly one robot connection. At the explicit idle gate, device and Dock counters closed exactly: device `captured_frames=5000 / sent_frames=5000 / queue_drops=0 / queued_frames=0 / udp_send_failures=0`, and Dock `frames=5000 / udpFrames=5000 / websocketMicrophoneFrames=0`.
- The same gate had `sequenceGaps=0`, `duplicateFrames=0`, `outOfOrderFrames=0`, `invalidFrames=0`, `rejectedDatagrams=0`, and `reconnects=0`. Device UDP `max_send_us=1565`; VB-CABLE remained at `underflows=0`.
- This proves the session-bound UDP microphone path met the initial 5,000-frame isolation gate without using the legacy WebSocket microphone path. The session is a stale-session guard, not encryption; microphone PCM remains plaintext on the trusted-LAN development transport.
- The Dock session continued past 9,000 received UDP frames with `gaps=0` before it was intentionally restarted. Raw evidence is preserved as `candidate-d-idle.stdout.log` and `candidate-d-idle.stderr.log` in this directory.

## Candidate D runtime result: Dock restart and one real-speech pass

- A deliberate Dock restart created fresh session `wifi-audio-dock-20260807-023452` with one authenticated robot connection. Its independent idle gate reached `5001` UDP frames with `websocketMicrophoneFrames=0`, no reconnect, no invalid/duplicate/out-of-order datagrams, and `sequenceGaps=0`; device lifetime counters were `captured_frames=14319 / sent_frames=14318 / queue_drops=0 / queued_frames=0 / udp_send_failures=0`.
- The second session accumulated its first microphone UDP gap at about `6001` received frames and still had exactly `1` gap immediately before speaker playback. During the one established `1045`-frame real Chinese speech sample, the cumulative microphone gap count increased from `1` to `6`; at the immediate post-playback checkpoint duplicate, out-of-order, and invalid counts were still zero.
- The PC speaker pipe received and sent all `1045` frames with `droppedFrames=0`, `maxPendingFrames=1`, and maximum WebSocket send latency `0.621 ms`; `slow_sends=0`.
- The device reported speaker `received_frames=1045 / played_frames=1024 / queue_drops=21 / sequence_gaps=21 / underruns=7`. Thus all PC frames reached the device transport, but `21` frames were discarded before I2S playback and the objective speaker continuity gate did not pass.
- A parallel ping probe reported `12/12`, average `32 ms`, maximum `103 ms`. This ping result was supplied by the parallel probe rather than emitted by the two Dock log files.
- The log continued after the speaker checkpoint and later reached microphone `gaps=8 / out_of_order=2`; those later values are retained as post-checkpoint evidence and are not relabeled as part of the 1045-frame playback window.
- The user explicitly reported that the real-speech playback was "比较清晰，没有卡顿中断" (fairly clear, with no stutter or interruption). The subjective listening gate therefore passed for this run; state-light correctness still awaits explicit user feedback. Task 6, the no-USB closeout, and the overall goal remain open. The checkpoint snapshot read for this record is preserved as `candidate-d-speech.stdout.log` and `candidate-d-speech.stderr.log`; the original `023452` Dock files were still being appended by the untouched running process after this checkpoint.

## Candidate D Codex Voice process-loopback preparation

- The first custom Windows application process-loopback implementation was rejected: it had produced heap corruption and otherwise captured only silence. It has been replaced by an application process-tree loopback built on `wasapi-rs 0.23.0` rather than being treated as a usable bridge.
- The Rust helper passed `2/2` unit tests and a release build. `rustfmt` was not installed; this is recorded as a missing optional formatting tool, not as a test or build failure.
- A pure-PC isolated 660 Hz validation produced `253,920 bytes` of 24 kHz mono s16 PCM with peak `11,438`, dominant frequency `659.750 Hz`, SHA-256 `40986B66538AD56F952F715C259C3E44AE029ADFA93F219397055D0F8BF0F824`, and no detected discontinuity. This proves the replacement process-loopback can capture and deliver non-silent, frequency-correct PCM without involving the robot.
- The guarded launcher is `tools/stackchan-dock/scripts/start-codex-voice-speaker-bridge.ps1`. At this checkpoint, bridge PID `27780` had attached to the Codex process tree rooted at PID `23240` and connected to the StackChan speaker pipe.
- Task 6 is not complete. The user must manually open Codex Voice, select `CABLE Output` as the microphone and the Steam virtual speaker as the intentionally silent output, then confirm robot-to-Codex speech, Codex-to-robot playback, correct listening/speaking state lights, and absence of duplicate local playback. The overall goal remains open.

## Current complete offline regression

- Firmware Wi-Fi Audio contract tests passed `43/43`.
- Dock Node syntax validation passed, followed by Dock Node tests `39/39`.
- Dock Python tests passed `19/19`.
- Rust process-loopback unit tests passed `2/2`, and its release build passed.
- The PowerShell speaker-bridge launcher parsed successfully and also completed a successful real startup.
- Current code and offline contracts cover the full-screen volume gesture, head swipe changing only the microphone path, the listening/speaking/fault state-light state machine, and typed MCP request routing.
- These offline checks do not prove the remaining user-visible Task 6/7 gates. Real Codex Voice robot-to-Codex and Codex-to-robot audio, blue-light switching, absence of duplicate local playback, and the no-USB run still require user testing. Task 6 and Task 7 remain incomplete, and the overall goal remains open.

## Current process-loopback bridge readiness evidence

- After adding an explicit ready diagnostic, only the computer-side bridge was safely restarted; the Dock and robot were not restarted. The replacement bridge ran as PID `4448` and continued to capture the Codex process tree rooted at PID `23240`.
- Its log reported `ready ... sample_rate=24000 channels=1 bits=16 pipe=...`, confirming the expected 24 kHz mono 16-bit capture format and an open connection to the configured speaker pipe without recording credentials.
- During the next `1500` idle input frames, the bridge reported `peak=1 / sent_frames=0 / gated_frames=1500 / discontinuities=0`. This proves the bridge remained connected and continuous while its silence gate correctly withheld idle audio from the robot.
- This readiness check is not the real Codex Voice bidirectional acceptance. Task 6 and Task 7 remain incomplete, and the overall goal remains open.
