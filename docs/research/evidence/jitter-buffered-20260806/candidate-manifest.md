# Jitter-buffered Wi-Fi Audio candidate hardware evidence

Recorded: 2026-08-06 (Asia/Shanghai)

## Candidate identity

- Candidate: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-jitter-buffered-20260806.bin`
- Size: `3,821,472 bytes` (`0x3A4FA0`)
- SHA-256: `BC1D8FA87778330746150CAF91C04065311A2E1F8E278ACC5D10FEFA5F69B54F`
- App partition write offset: `0x20000`
- Intended change relative to the matched-STD candidate: keep TX DMA supplied with silence while idle, expand the device speaker queue to 12 frames, wait for a four-frame/40 ms prebuffer, and expose speaker receive/play/silence/underrun/drop/gap counters.

The SHA-256 above was recomputed from the candidate file still present in the workspace. Private Wi-Fi credentials and the Dock pairing key are intentionally omitted.

## Flash and first reconnect

The candidate was written app-only at `0x20000` for exactly `0x3A4FA0` bytes. The write completed with the image digest check passing, and the independent `verify_flash` over the same range reported `digest matched`.

The raw flashing transcript was observed in the live test terminal but was not saved as a file in this evidence directory. This manifest therefore records that witnessed result without presenting it as a separately archived log.

After physical restart, the candidate reconnected to the Dock. Its first recorded status was:

```text
received_frames=0
played_frames=0
silence_frames=34
underruns=0
queue_drops=0
sequence_gaps=0
```

During the same logged window, microphone uplink remained at `gaps=0` and the VB-CABLE player remained at `underflows=0`. These values prove that the candidate booted, authenticated and initially maintained the microphone/virtual-input path; they do not prove long-duration device stability.

## Hardware retest rounds

### Round 1: capture command rejected, speaker connection reset

The first Realtek capture command did not start recording. `capture-stderr.log` records an argument parsing failure because the device name was split into unrecognized arguments:

```text
capture_vb_cable.py: error: unrecognized arguments: (Realtek(R) Audio) WASAPI
```

No usable first-round recording was produced. Speaker tone transmission nevertheless continued to frame 133, where the Dock logged:

```text
Speaker TX frames=133 latency_ms=39983.909 max_latency_ms=39983.909 slow_sends=1 error=write ECONNRESET
```

This establishes a WebSocket write-side connection reset at that point. It does not establish why the peer reset the connection or whether this was the same failure mechanism as the later full device disappearance.

### Round 2: external Realtek recording generated after the robot was already offline

The corrected second capture command produced `speaker-external-realtek-660hz-run2.wav`, an 8.0-second, 44.1 kHz external Realtek microphone recording. The robot had already dropped offline before this recording completed. Offline analysis found:

| Metric | Result |
| --- | ---: |
| Requested tone | `660 Hz` |
| Dominant frequency near target | `659.1707 Hz` |
| Detected tone span | `6.27 s` |
| Approximate active tone time | `1.61 s` |
| Active duty fraction | `25.68%` |
| Longest internal gap | `2,380 ms` |
| Internal gaps over the `100 ms` limit | `6` |
| Continuity result for this recording | **failed** |

These metrics describe only the captured waveform. Because the robot was offline, neither the near-660 Hz component nor the 2.38-second internal gap can be attributed to the robot speaker. This file is not a valid acoustic continuity test of the jitter-buffered candidate and must not be used to claim that the candidate preserved pitch, improved continuity or made continuity worse.

## Post-run reachability snapshot

The connection failure preceded completion of the second Realtek recording. The robot was no longer reachable on its previously known Wi-Fi address and `COM7` disappeared from Windows. A later read-only check while preparing the first version of this record again returned `PING_192.168.0.8=False` and `PRESENT_COM7=False`.

This is positive evidence that both observed access paths were absent at that time. It is not enough to distinguish firmware panic, watchdog reset loop, brownout/power loss, a USB enumeration failure combined with Wi-Fi loss, or another hardware/runtime cause. No serial reset reason or valid coredump was captured in this run.

## Battery-only recovery and microphone transport

The user then disconnected USB and started the robot from its internal battery. `COM7` was absent by construction because there was no USB data connection. In that battery-only state:

- `192.168.0.8` responded to ping;
- the robot had an established connection to the Dock at `192.168.0.11:8765`;
- `dock-stdout.log` recorded a fresh device connection;
- microphone PCM counters advanced from frame `3001` through `4501`, with `gaps=0` throughout.

This proves that battery-only Wi-Fi association, Dock authentication and microphone transport worked for a limited observation window without a USB cable. It does not satisfy long-duration USB-independent acceptance because the device later became unreachable again.

## VB-CABLE isolation

An 8-second capture from `CABLE Output` during the battery-only microphone flow produced `no-usb-vb-cable-microphone.wav`. Offline analysis classified all 8.0 seconds as digital silence: `digital_silence_frame_fraction=1.0`, longest digital-silence run `8.0 s`, and frame dynamic range `0 dB`. The file is effectively silent even though it contains a very small isolated peak of 29 PCM counts.

At the same time, the existing Dock `vb_cable_player` subprocess remained alive. Its log continued to report nonzero `input_peak` values through frame 4500 and `underflows=0`. Therefore Dock microphone reception and the player process's input accounting continued, while the Windows recording endpoint received silence.

A separate pure-PC `CABLE Input -> CABLE Output` 660 Hz loopback then produced `vb-cable-direct-loopback-probe.wav`. Its independent analysis measured `660.3960 Hz`, `99.01%` active duty, zero internal gaps and `continuity_pass=true`. This proves that the VB-CABLE driver and endpoints could pass a newly created PC-only stream at that time. The combined evidence makes the old Dock WASAPI output stream a leading suspect, but it does not establish the precise failure mechanism.

The Dock was restarted to rebuild its WASAPI stream. The replacement Dock reached the listening state on `0.0.0.0:8765`, but the robot did not reconnect and `192.168.0.8` again stopped responding. Consequently the rebuilt stream could not be retested end-to-end with robot PCM.

## Production-blocking status

The user explicitly reported: “机器人崩溃之后，无法重启”. A physical RST produced only a brief screen flash before the robot crashed/offlined again; it did not complete a usable restart. Together with the repeated loss of ping and lack of robot reconnection after the Dock restart, this is a production-blocking failure for the jitter-buffered candidate. It does not prove that the image permanently damaged the device or identify the reset cause.

## Evidence boundary and next discriminating test

Verified:

- The exact candidate was flashed and independently verified.
- It booted and reconnected before testing.
- Logged microphone uplink gaps and VB-CABLE underflows were both zero before the connection loss.
- The robot later booted from its internal battery and briefly provided gap-free Wi-Fi microphone transport with USB disconnected.
- The old Dock player reported live nonzero input while an 8-second CABLE Output capture was digitally silent.
- A fresh pure-PC VB-CABLE loopback passed at 660.396 Hz with no internal gaps.
- After the Dock restart, the robot did not reconnect and its previously known IP stopped responding again.
- The user reported that physical RST caused only a brief screen flash followed by another crash/offline state, so the robot could not complete a restart after the crash.

Not yet verified:

- The cause of `ECONNRESET` or the later device disappearance.
- Whether the 12-frame queue/prebuffer logic was operating with nonzero receive/play counters immediately before each acoustic gap; the archived initial status predates tone traffic.
- Any valid jitter-buffered acoustic speaker-continuity result; the second Realtek recording was made after the robot was offline.
- Why the old Dock WASAPI output stream delivered silence even though its player process remained alive.
- Whether connection loss, WASAPI stream failure and the later non-restart condition share one root cause.
- Long-duration full-duplex, Codex Desktop Voice and USB-disconnected acceptance.

The next useful hardware action is recovery-first, not another tone run: restore a known-good boot while preserving reset/coredump evidence if possible, then attach continuous serial/reset-reason capture and power observation before exercising speaker traffic. A later valid acoustic run must prove the robot is online for the complete recording and preserve periodic speaker counters through the tone window.

## Archived artifacts

| Path | Purpose |
| --- | --- |
| `dock-stdout.log` | Dock connection, initial device status, microphone counts and speaker TX failure |
| `dock-stderr.log` | VB-CABLE activity and zero-underflow observations |
| `capture-stderr.log` | First-round Realtek capture argument failure |
| `capture-stdout.log` | Empty output paired with the failed first capture invocation |
| `speaker-external-realtek-660hz-run2.wav` | Second-round external acoustic recording |
| `speaker-external-realtek-run2-analysis/tone-continuity.json` | Reproducible waveform metrics; not attributable to the offline robot |
| `no-usb-vb-cable-microphone.wav` | Battery-only run's eight-second CABLE Output capture |
| `no-usb-vb-cable-microphone-analysis/waveform-analysis.json` | Digital-silence analysis for the CABLE Output capture |
| `vb-cable-direct-loopback-probe.wav` | Pure-PC 660 Hz CABLE Input-to-Output control |
| `vb-cable-direct-loopback-probe-analysis/tone-continuity.json` | Passing VB-CABLE control metrics |
| `dock-no-usb-stdout.log` | Replacement Dock listener after WASAPI stream reconstruction; no robot reconnect recorded |
| `dock-no-usb-stderr.log` | Empty stderr for the replacement Dock listener |

Artifact hashes:

- non-attributable Realtek WAV: `097678A35F5A434D18712231FD7E3D243AA71D41993E965B34AAC2610697F640`
- non-attributable continuity JSON: `F76EBE26025DB5F0C2986C52A206471F6E42713A4FB1FD1D0D2F658612FE4DDB`
- no-USB CABLE Output WAV: `AF582E557FD77AEFCD26BBD436BBEAB0A048C01741290C169E89E156C2E29058`
- no-USB waveform JSON: `861CC624FABC8D7AAAFAA746C18EF777517629E81B62C96C6039CE337E2D594C`
- pure-PC loopback WAV: `8977FC3A2ADCFF137BAA78CF633D09DE98D7C85D547BE603BD9192D0DAD3D173`
- pure-PC loopback JSON: `9A905DDF85336EA87E0F99CFD6D7BFC99E64E6556DFCB51906550FE386CFC3E3`
