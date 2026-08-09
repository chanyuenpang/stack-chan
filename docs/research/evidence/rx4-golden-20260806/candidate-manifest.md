# RX4 golden diagnostic candidate manifest

Created: 2026-08-06 (Asia/Shanghai)

## Candidate identity

- Repository HEAD: `cf98815bdd8828005ad843feee21885ac1190af6`
- Repository state: dirty; this is an explicitly local diagnostic candidate, not a committed release artifact.
- Candidate: `D:/Users/chany/Documents/StackChan/tmp/stackchan-wifi-audio-rx4-golden-diagnostic-20260806.bin`
- Build output: `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-short/stack-chan.bin`
- Size: `3,821,264 bytes` (`0x3A4ED0`)
- SHA-256 for both files: `D0DF3EA06789733EDFCF24157BDAB6F4096F44C35199D552FCABDE8C14BAB581`
- ESP-IDF: `5.5.5`
- Application partition: `ota_0`, offset `0x20000`, capacity `0x4F0000`
- App-only write end, exclusive: `0x3C4ED0`

## Required diagnostic configuration

The generated `sdkconfig.h` was checked for these exact values:

- `CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC=1`
- `CONFIG_STACKCHAN_WIFI_AUDIO_DIAGNOSTIC_UDP_PORT=8766`
- `CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC=0`

The complete private sdkconfig is not copied into evidence because it contains network credentials. Its SHA-256 is `1E12DC1D48720A70DCD3585E896DA105A5156B60771EA0C6CBA88A14791C87D5`.

## Dirty source scope and hashes

The relevant current-worktree paths are intentionally modified or untracked:

```text
 M firmware/main/Kconfig.projbuild
 M firmware/main/hal/board/cores3_audio_codec.cc
 M firmware/main/hal/board/cores3_audio_codec.h
?? firmware/main/hal/wifi_audio_dock_mvp.cpp
?? firmware/main/tests/test_wifi_audio_ble_config_contract.py
?? tools/stackchan-dock/scripts/capture_rx4_udp.py
?? tools/stackchan-dock/test/test_capture_rx4_udp.py
?? docs/research/stackchan-wifi-audio-boot-diagnostics.md
?? docs/research/stackchan-wifi-audio-decisive-experiment.md
```

| Path | SHA-256 |
| --- | --- |
| `firmware/main/Kconfig.projbuild` | `0C5C9C691379CDF3315F0BF6D731484B027A13FEFF7F61C5BE0B5BCAF710C679` |
| `firmware/main/hal/board/cores3_audio_codec.cc` | `A4A0E885AC6EF8250FF7F921BDCE49AD357E624AC4F4F2658293B585EDAF8866` |
| `firmware/main/hal/board/cores3_audio_codec.h` | `93786B8727E513E58804E43A40A4F68D93C404767D04EF912C6F3DE1657E287A` |
| `firmware/main/hal/wifi_audio_dock_mvp.cpp` | `41CBC01CBA284B0E69D02EB7280430938124052E30B1F7F0C849E1874C74A31C` |
| `firmware/main/tests/test_wifi_audio_ble_config_contract.py` | `8BD5B13A1D81B29A5E2180E567EC598A99F8C1475EC3055BDE0539B777B74D2B` |
| `tools/stackchan-dock/scripts/capture_rx4_udp.py` | `2AF29E35EBB2317BA895BFD860D499FA7CBA7DC711C07FE06F8F5BEF2D8C3343` |
| `tools/stackchan-dock/test/test_capture_rx4_udp.py` | `32FA3B8D3F547A246AE82C98F1F3121986413416686E51E23322C4F5D934FD11` |

## Reproducible verification commands

```powershell
. C:\Espressif\frameworks\esp-idf-v5.5.5\export.ps1
idf.py -B S:\build-wifi-audio-short -D SDKCONFIG=S:\sdkconfig.wifi_audio build
python -m unittest discover -s firmware/main/tests -p "test_*.py"
Set-Location tools/stackchan-dock
npm test
Set-Location ../..
python -m unittest discover -s tools/stackchan-dock/test -p "test_*.py"
```

Results:

- ESP-IDF build and partition size check: passed; `0x14B130` bytes (26%) app space free.
- Firmware Python: `35/35` passed.
- Dock Node: `30/30` passed.
- Dock Python: `10/10` passed.

Raw evidence:

| File | SHA-256 |
| --- | --- |
| `esp-idf-build.log` | `435110F9635EC38ECA44C43F9B3CAAF173950997192FA84D4AABBB58A2E4189A` |
| `firmware-python-tests.log` | `1721084E925C2EAB13D0F8DB79BE2346EC880ABEF11916076713D7557D7305F0` |
| `dock-node-tests.log` | `074BCBEDE6D2E709B9438F1252E3200EC05CF2086CDBE7BD711BBD47E2652FD5` |
| `dock-python-tests.log` | `7FA2C3F39772BA088198B95AA567E627F67C3902377D56005C27E26C62E660A9` |

## Generated-build workaround boundary

ESP-IDF/CMake regeneration on this Windows checkout produces an overlong final placeholder-C compile command and duplicates the short-path/absolute-path `nano.specs` argument. The successful build used a response file for that generated compile rule and removed only the duplicate specs entry. Those fixes live under `firmware/build-wifi-audio-short` and are not product-source changes.

## Flash and capture evidence still required

Do not call this candidate validated until the following are recorded:

- Factory MAC and COM port before writing.
- Esptool version, write time, offset `0x20000`, length `0x3A4ED0`, tool hash result, and independent `verify_flash`.
- Physical reset time; RTS reset alone is not accepted as an application-start boundary.
- No reboot loop, display/touch response, BLE/Wi-Fi state, and authenticated Dock connection.
- Serial `pair_chan`, 24 kHz/four-slot/16-bit declaration, gain, every ES7210 register read, every RX4 read failure, and UDP send failure count.
- Receiver command, output directory, source endpoint, first/last sequence and device timestamp, packet/gap/missing/invalid counts.
- Fixed stimulus timeline, raw/four-channel/slot WAV hashes and metrics, plus synchronous mono Dock gaps/player underflows.

## Executed flash and decisive capture

The app-only write and independent verify were completed with esptool `4.12.0` on `COM7`, factory MAC `44:1b:f6:e2:78:a8`. Write hash verification and independent `verify_flash` both passed. The physical reset then produced an authenticated Dock connection and RX4 data from `192.168.0.8`.

| Evidence | SHA-256 |
| --- | --- |
| `preflash-chip-id.log` | `64DE202955183B362E690775373BA6A1CB48877227C6DE92B1B541C79DF8EC87` |
| `flash-write.log` | `3B4668AAE5B60419321A804A0291E5552AF0500DA39A64B896B6E6536963149E` |
| `flash-verify.log` | `A8F6F6E32CB8AFB22B0E821AFC612F30377F7A154859DF5991DA080D8CF4C33F` |
| `run2/capture-metadata.json` | `D4190C51F222AD9FE364A3A11BD764334C63BE4F61DCF5E3BBFFEA1E10FD1E83` |
| `run2/analysis/waveform-analysis.json` | `51253D43E894229A5A89D4743283129B6987F5030CBF73E274CD51DC9315E02A` |

The capture contains `6,644` received audio packets, `42` explicitly zero-filled missing packets, seven stable ES7210 snapshots, and about `33.43 s` of four-slot PCM. The pre-reset serial reader lost its Windows COM handle during physical reset and saved no boot bytes; this missing evidence is explicit and is not represented as a successful serial audit.
