# StackChan Release Candidate: launcher-ready-auto-open

## Version
- **App version (embedded)**: 2.0.29
- **Build tag**: candidate-launcher-ready-auto-open
- **Compiled**: May 19 2026 16:40:28
- **ESP-IDF**: v5.5.4

## Image Info
| Item | Value |
|---|---|
| File | `stack-chan.bin` |
| Size | 3,961,104 bytes (0x3c7110) |
| SHA256 | `71566872ef348c925a8cabc4257c7ca9273d5e860ec55ecc98df13a3e970b752` |
| Chip | ESP32-S3 (revision v0.0–v0.99) |
| Entry point | 0x40379720 |

## Key Changes (vs 2.0.28-mooncake-autostart-readfix)

1. **NVS key length fix** — `boot/auto_start_xiaozhi_once` / `boot/auto_start_fail_count` 改短为 `boot/start_once` / `boot/fail_count`（≤15 字符），避免 ESP32 NVS key 超长写入失败。
2. **Launcher ready 自动打开 AI.AGENT** — 不再在 `main.cpp` 直接调用 `GetHAL().requestXiaozhiStart()`，改为 Launcher view ready 后按 app name `"AI.AGENT"` 查找并走 `AppLauncherBase::openApp()` 生命周期，符合 MoonCake app 规范。
3. **直接调用路径清除** — `requestXiaozhiStart` 现仅由 `AppAiAgent::onOpen` 调用，`main.cpp` 无直接引用。

## Verification Status (by verify-agent #23)

| Check | Status |
|---|---|
| 长 NVS key 消失 | **PASS** — `auto_start_xiaozhi_once` / `auto_start_fail_count` 未出现在运行代码中 |
| main.cpp 不再直接 requestXiaozhiStart | **PASS** — 唯有 AppAiAgent::onOpen 调用 |
| 短 key ≤15 字符 | **PASS** — `start_once:10`, `fail_count:10`, `default_mode:12` |
| Launcher 按 app name 查找并 openApp | **PASS** — 遍历 getAllAppProps，匹配 AppAiAgent::kAppName |
| `idf.py build` 通过 | **PASS** — 0x3c7110, 分区剩余 23% free |

## Not Published
This is a **local candidate draft** bumped to **2.0.29** for natural OTA under `force=0`.

Publishing notes:
- `active-release` / served manifest must be updated only by the publish task.
- Rebuild is required before publishing so `stack-chan.bin` image_info, size, and SHA256 match embedded app version `2.0.29`.
- No device has been flashed or OTA-upgraded by this bump task.

## Build Source
Source code changes were made in `firmware/main/main.cpp`, `firmware/main/apps/app_launcher/app_launcher.cpp` and related NVS key definitions. Not committed to git yet.
