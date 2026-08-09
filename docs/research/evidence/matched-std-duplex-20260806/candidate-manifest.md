# Matched-STD duplex Wi-Fi Audio candidate manifest

Created: 2026-08-06 (Asia/Shanghai)

## Candidate identity

- Repository HEAD: `cf98815bdd8828005ad843feee21885ac1190af6`
- Repository state: dirty; this is a local validation candidate, not a committed release.
- Candidate: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-matched-std-duplex-20260806.bin`
- Size: `3,820,832 bytes` (`0x3A4D20`)
- SHA-256: `624738C34851B6664D267EC8E1D8E8A20EB318A61CB222F42B1EB966A1105E40`
- ESP-IDF: `5.5.5`
- App partition: `ota_0`, offset `0x20000`, capacity `0x4F0000`
- Free app space reported by the build: `0x14B2E0` bytes (26%)

The generated `sdkconfig.h` was checked for `CONFIG_STACKCHAN_WIFI_AUDIO_MVP=1` and absence of `CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC=1`. Private Wi-Fi and pairing values are intentionally omitted.

## Evidence-based change

The RX-only golden run established clear MIC1 and MIC2 audio at 30 dB gain; the user then listened to both raw WAVs and confirmed that both were clear. Official M5Unified configures CoreS3/StackChan microphone and speaker on the same I2S port and shared BCLK/WS using 16-bit standard stereo. It enables only MIC1/MIC2, while AW88298 declares a `16*2` BCLK frame. The local Espressif ES7210 driver enters TDM only when at least three microphones are selected.

This candidate therefore:

- selects only physical MIC1/MIC2 in product mode;
- configures paired TX/RX as identical 24 kHz, Philips standard-I2S, 2×16-bit frames;
- opens output as two channels and explicitly duplicates mono application PCM to L/R;
- keeps exact-length I2S read validation and the verified 30 dB microphone gain;
- retains the four-slot RX-only golden path behind an explicit diagnostic switch;
- adds direction-tagged 10 ms speaker frames on the authenticated WebSocket, an eight-frame latency-bounded device queue, and a local-only PC speaker PCM pipe.

## Source hashes

| Path | SHA-256 |
| --- | --- |
| `firmware/main/hal/board/cores3_audio_codec.cc` | `7D219666C60E865D874AE602231756278EFEA5200ACDE7EFAFC53DA0BCB687C2` |
| `firmware/main/hal/board/cores3_audio_codec.h` | `8F113A2863C198476E04C247910066A891803A1D0250EFF958B731A8F7A46562` |
| `firmware/main/hal/wifi_audio_dock_mvp.cpp` | `2CAF0FD125902A22D7EB2053F7A41B48E5EF246DAEBD6C3D0249B8EDFC6A6C8F` |
| `firmware/main/tests/test_wifi_audio_ble_config_contract.py` | `9A9F86A03B689364B5B5B31B95A68DA5F4909F6C15981E01EDCB1E16BB454317` |
| `tools/stackchan-dock/src/wifi-audio-receiver.mjs` | `3E55634BC3733A9444E0EBB79E1432EBC9ECA17E2285A3EF2ED48B17DBAEF82D` |
| `tools/stackchan-dock/src/wifi-audio-speaker-pipe.mjs` | `6ECF6274C56963B35681CE6D69580DCE296F515474264ECC291B45DD1B146BAA` |
| `tools/stackchan-dock/scripts/stream_wav_to_speaker_pipe.py` | `3F76B8A548DE1E8D588F248EEE145BA3E687AD75A9BB67B0448EFCDA664D6E36` |
| `tools/stackchan-dock/test/wifi-audio-receiver.test.mjs` | `A887A2046B4DBD050B2DEFF6CAD8109890F946353D34D00741282CDD7E08755A` |
| `tools/stackchan-dock/test/wifi-audio-speaker-pipe.test.mjs` | `6A1C809B109D8B19B8DB6775829A3E0E0D04F058FF80D2EF5FE0969F5496AA06` |

## Verification completed before flash

- ESP-IDF full build and partition check: passed.
- Firmware Python contract tests: `38/38` passed.
- Dock Node tests: `32/32` passed, including authenticated speaker frame and local pipe integration.
- Dock Python tests: `10/10` passed.
- Python syntax compilation for the speaker pipe source and waveform analyzer: passed.

The Windows generator again required a response file for the final placeholder-C compile and removal of a duplicate short/absolute `nano.specs` entry. Both changes are confined to `firmware/build-wifi-audio-short`.

## Required hardware acceptance

Do not call the candidate validated until one app-only write plus independent `verify_flash` is followed by a physical reset and all of the following pass:

- no reboot loop; display, head touch, expression and Dock state remain responsive;
- authenticated Wi-Fi microphone reaches VB-CABLE and is intelligible in Codex Desktop Voice;
- PC test PCM reaches the robot speaker without distortion while microphone capture continues;
- device/Dock logs show no sustained I2S read errors, speaker sequence discontinuities or queue overload;
- USB data is physically disconnected and the same control/audio behavior continues under independent power.

## Successor candidate after speaker continuity diagnosis

The matched-STD candidate was flashed and proved the intended 660 Hz output pitch, but two independent Realtek microphone captures measured 270--620 ms acoustic dropouts while the PC sent 500 frames with a maximum WebSocket send-callback latency of only 0.591 ms. This rules out another sample-format change and moves the remaining fault boundary to device-side receive buffering and I2S TX starvation.

- Candidate: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-jitter-buffered-20260806.bin`
- Size: `3,821,472 bytes` (`0x3A4FA0`)
- SHA-256: `BC1D8FA87778330746150CAF91C04065311A2E1F8E278ACC5D10FEFA5F69B54F`
- ESP image checksum and appended validation hash: valid
- Free app space: `0x14B060` bytes (26%)
- Config check: `CONFIG_STACKCHAN_WIFI_AUDIO_MVP=1`; RX-only diagnostic absent

The successor keeps the TX DMA supplied with silence while idle, expands the device queue to 12 frames, starts non-silent playback after a four-frame/40 ms prebuffer, and reports received, played, silence, underrun, queue-drop and sequence-gap counters. It was subsequently flashed and retested; the exact write/verify result, initial counters, two acoustic test rounds and later device disappearance are recorded in [`../jitter-buffered-20260806/candidate-manifest.md`](../jitter-buffered-20260806/candidate-manifest.md). The hardware result did **not** pass speaker continuity or stability acceptance.

| Path | SHA-256 |
| --- | --- |
| `firmware/main/hal/wifi_audio_dock_mvp.cpp` | `17A85D760B25B1202815992C65CF3C0D338ADA5A6A1AF274A30D28F7DCDCE741` |
| `firmware/main/tests/test_wifi_audio_ble_config_contract.py` | `58E746DA1A6176E1E5B54620865B9812BFF0E193D978536908F4C259C1A4FD1A` |
| `tools/stackchan-dock/src/wifi-audio-receiver.mjs` | `44DAE33B8894BBC7F26E01EB5200377E187E47220A674E017D64DD6F776111BD` |
| `tools/stackchan-dock/bin/wifi-audio-dock.mjs` | `279A0BCA8611BD450F16DE3487AF72467E13CDF6CE50824F377E44F58914A21F` |
| `tools/stackchan-dock/scripts/capture_vb_cable.py` | `02EA7F602605059B0380BA94C5583553E5163A90E34FCF54D7ED14B527A98503` |
| `tools/wifi_audio_analysis/analyze_tone_continuity.py` | `7C9EFD8C86AD4F127CD2481D612BDA893BD62B5E57F4DE4BC05ED8A175F68016` |

Pre-flash verification: firmware contracts `39/39`, Dock Node `32/32`, Dock Python `10/10`, Python syntax compilation passed, and ESP-IDF 5.5.5 completed ELF link, ESP32-S3 image generation and partition-size checks. The generated build directory again needed the documented response-file and duplicate `nano.specs` workaround; no product source was changed for that workaround.

Post-flash summary: the candidate initially reconnected with all speaker error/drop counters at zero, while microphone uplink reported `gaps=0` and VB-CABLE reported `underflows=0`. The robot later became unreachable; the external Realtek recording that measured `659.17 Hz` and a `2,380 ms` gap was completed only after the robot was already offline, so it is **not** valid evidence about robot speaker pitch or continuity. A later battery-only boot briefly restored gap-free Wi-Fi microphone transport without USB, but the robot again became unreachable and the user reported that it could not be restarted after the crash. See the successor manifest for the corrected chronology and evidence boundary.
