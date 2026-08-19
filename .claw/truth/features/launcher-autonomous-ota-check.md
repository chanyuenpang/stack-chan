# Launcher 自主 OTA 检查机制

## 结论

StackChan Launcher 自主 OTA 是一个需要按版本 / 开关判断的机制，不应无条件假设“停在 Launcher 就会自动联网”。历史实现中，Launcher view 创建完成后会自动触发**一次**后台 OTA 检查；OTA 成功后写入 NVS `boot/default_mode=xiaozhi`、`boot/start_once=true` 和 `boot/fail_count=0`，然后 reboot；失败路径不写 `start_once`、不重启。

但 2.0.32 / 2.0.33 现场源码口径显示，Launcher 自主 OTA 可被默认关闭：`LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher`。在该口径下，设备停在 `launcher_only` 时不会自动启动 Wi-Fi，也不会访问 OTA server；需要触摸打开 `AI.AGENT` 或在 `SETUP` 中手动 `Check for Updates` 才会进入网络 / OTA 链路。详见 `features/launcher-no-network-recovery-paths.md`。

长期风险仍然成立：一旦 Launcher 自主 OTA 被启用，它会启动网络，和 XiaoZhi `Application::Initialize()->board.StartNetwork()` 一样可能触发 ESP system event task `sys_evt`。如果现场出现 `***ERROR*** A stack overflow in task sys_evt has been detected.`，应优先排查 `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=4096` 与 Wi-Fi event callback 栈，而不是继续只盯 OTA URL、manifest 或 `AI.AGENT` open 生命周期。2.0.31 现场已经证明 Launcher autonomous OTA 的 `startNetwork()` 足以在未进入 XiaoZhi 的情况下触发 reboot loop；2.0.32 后若处于 default_off / launcher_only，无 Wi-Fi、无 `/ota/` 请求则是预期停留态，不再能作为 autonomous OTA 失败证据。详见 `features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md`。

## 长期行为 / 规则

- Launcher view 创建完成后，`start_autonomous_ota_check_once()` 通过 `exchange(true)` 原子操作去重，确保整个 Launcher 生命周期只触发一次后台 OTA check。
- OTA 互斥 guard `OtaRunningGuard` / `std::atomic<bool> s_ota_running` 防止并发 OTA。
- OTA 调用 `updateFirmwareEx()`，该函数检查 guard 后走完整 OTA 流程。
- **成功路径**（唯一写 `start_once` + reboot 的分支）：`set_boot_autostart_once_for_ota()` 写入 `boot/default_mode=xiaozhi`、`boot/start_once=true`、`boot/fail_count=0`，然后 `reboot()`。
- `boot/start_once=true` 在 boot mode 读取逻辑里优先级高于 `default_mode=xiaozhi`，并且当前不检查、不递增 `fail_count`；`fail_count` 只保护 `default_mode=xiaozhi` 分支。因此 OTA 成功后强制 next boot 进 XiaoZhi 是高风险策略，必须和 `sys_evt` / XiaoZhi 启动稳定性一起验证。
- Launcher 自主 OTA task 会调用网络初始化；即使设备最终没有进入 XiaoZhi，也可能在 Launcher 阶段触发 Wi-Fi event 链和 `sys_evt` 栈溢出。
- **失败路径全部跳过**：CheckFailed、NoUpdate、metadata invalid、UpgradeFailed 均不写 `start_once`、不重启。
- 自主 OTA **不使用 `force=1`**；`force=1` 仅存在于 `tools/ota-mock-server/` 测试工具和文档中，未进入 firmware 自主 OTA 常驻逻辑。
- NVS key 长度均 ≤ 15 字符：`boot` (4)、`start_once` (10)、`fail_count` (10)、`warm_boot` (9)、`app_index` (9)。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_ota.cpp`：OTA 核心实现，包含 `updateFirmwareEx()`、`set_boot_autostart_once_for_ota()`、`OtaRunningGuard`、成功/失败分支和 reboot 逻辑。
- `firmware/main/apps/app_launcher/app_launcher.cpp`：Launcher 生命周期；启用自主 OTA 时在 view 创建后调用 `start_autonomous_ota_check_once()` 触发后台 OTA；default_off 口径下会记录 `LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher` 并留在 Launcher。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/apps/app_launcher/app_launcher.h` | `start_autonomous_ota_check_once()` 声明 |
| `tools/ota-mock-server/ota-mock-server.py` | 测试用 mock server，含 `force=1` 逻辑，不属于 firmware 自主 OTA |

## 真实调用链路

```
AppLauncher view 创建完成 (app_launcher.cpp:130)
→ start_autonomous_ota_check_once() (app_launcher.cpp:152)
→ s_launcher_ota_check_started.exchange(true) 去重 (app_launcher.cpp:154-158)
→ xTaskCreate 后台任务 (app_launcher.cpp:160)
→ updateFirmwareEx() (hal_ota.cpp:56)
→ OtaRunningGuard 检查 s_ota_running (hal_ota.cpp:22-39)
  → busy 则返回 (hal_ota.cpp:58-65)
→ OTA 流程执行
  → 成功: set_boot_autostart_once_for_ota() 写 NVS (hal_ota.cpp:137)
    → boot/default_mode = xiaozhi
    → boot/start_once = true
    → boot/fail_count = 0
    → reboot() (hal_ota.cpp:143)
  → CheckFailed: 不写不重启 (hal_ota.cpp:75-80)
  → NoUpdate: 不写不重启 (hal_ota.cpp:83-89)
  → metadata invalid / UpgradeFailed: 不写不重启 (hal_ota.cpp:94-99, 128-134)
```

## 与 XiaoZhi OTA 路径的区别

| 维度 | Launcher 自主 OTA | XiaoZhi OTA |
| ---- | ---- | ---- |
| 入口 | 启用时 Launcher view 创建后自动触发；2.0.32/2.0.33 default_off 时不触发 | 用户点击 AI Agent 进入 XiaoZhi 后，`ActivationTask::CheckNewVersion()` |
| 核心文件 | `hal_ota.cpp`、`app_launcher.cpp` | `xiaozhi-esp32/main/ota.cc`，并在集成层复用 HAL/OTA 成功收尾逻辑 |
| OTA URL 来源 | `Hal::updateFirmware()` → `Ota` | `Ota::GetCheckVersionUrl()` → NVS `wifi.ota_url` 优先 |
| 触发频率 | 启用时 Launcher 生命周期一次；default_off 时为 0 次 | 每次进入 XiaoZhi 后按 schedule 检查 |
| 成功后行为 | 写 `boot/start_once` + reboot | 真实设备日志已证明可完成 `Ota::Upgrade()`、写 OTA app 分区、设置 boot partition，并在 reboot 前调用 `set_boot_autostart_once_for_ota()` 写 `boot/start_once=true` |

## 真实设备 OTA 验收口径

- 进入 XiaoZhi 后触发的 OTA 已在真实设备上观察到完整成功链路：串口出现 `Ota: Current version: 2.0.29`、`Ota: New version available: 2.0.30`、`Writing to partition ota_1`、`Progress: 100%`、`Firmware upgrade successful`、`Application: Firmware upgrade successful, rebooting...` 与 ESP32 ROM reboot 日志。
- 这能证明“检查版本 → 下载固件 → 写 OTA 分区 → `esp_ota_set_boot_partition` / boot partition 切换 → `set_boot_autostart_once_for_ota()` → reboot”链路在真实设备上可闭环。
- reboot 后如果串口 USB 断开重连，可能错过最早 `0-305ms` 的 `Project name`、`App version`、`BOOT-MODE` 等关键启动日志；此时不能仅凭后续 `SERVO-MOVE` / Launcher 空闲日志断言新 app 已启动或分区切换失败。
- reboot 后若没有 `LAUNCHER-OTA`、`OTA check`、`[AI.AGENT] on open`、`[HAL] start xiaozhi`、Wi-Fi 初始化或 HTTP 请求，只能写成“未观察到”，不能推断自主 OTA 或自动打开 AI.AGENT 已发生。
- OTA 到 2.0.32 的现场验收补充：串口可见下载 100%、image verify、`Firmware upgrade successful`、`Rebooting...`，随后 `SERVO-MOVE` / `SystemInfo` 持续输出、Wi-Fi ping 稳定、无 `sys_evt` stack overflow；若同时 `BOOT-MODE` 为 `default_mode=launcher once=false`，设备保持 Launcher idle 是预期状态，HTTP `18080` 无响应不能当作 OTA 失败或 XiaoZhi 失败。

## 已知陷阱

- 不要混淆 `boot/start_once`（当前 OTA 成功后自动设置且不受 `fail_count` 保护）与旧提案中的 `boot/auto_start_xiaozhi_once`；应以当前源码 `boot/start_once` / `boot/default_mode` / `boot/fail_count` 为准。
- 不要看到 `default_mode=launcher once=false fail_count=0` 就排除 Launcher 阶段 reboot loop；自主 OTA若已启用，`GetHAL().startNetwork()` 也可能触发 `sys_evt` stack overflow。
- 反过来，也不要看到 Launcher idle 无 Wi-Fi / 无 `/ota/` 请求就认定 OTA server 或 manifest 失败；如果日志明确 `LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher`，这是当前设计停留态。
- 自主 OTA 不使用 `force=1`，排查 OTA 行为时不要把 mock server 的 `force=1` 逻辑当作 firmware 行为。
- `OtaRunningGuard` 互斥意味着 XiaoZhi OTA 和 Launcher 自主 OTA 不能同时执行；如果 Launcher 自主 OTA 正在运行时用户点击进入 XiaoZhi，后者需要等 guard 释放。
- “OTA 前半段成功”与“reboot 后运行目标版本”是两个验收点：前者看下载、写分区、`Firmware upgrade successful` 和 reboot；后者必须捕获完整启动日志中的版本/boot mode，或用只读分区状态/设备 UI 版本确认。
- 串口重连漏掉启动最早窗口时，不要把“无 Wi-Fi / 无 AI.AGENT 自动打开 / HTTP 不通 / tcpdump 0 字节”当成 OTA 失败的直接证据；它只说明后续观察窗口未看到网络和自动启动链路。

## 验证标准

后续修改自主 OTA 链路时，至少验证：

- 先确认当前版本 / build 的 Launcher autonomous OTA 是启用还是 default_off；启用时 `start_autonomous_ota_check_once()` 仍只在 Launcher view 创建后触发一次，default_off 时不应自动联网或访问 OTA server。
- OTA 成功路径仍写入 `boot/default_mode=xiaozhi`、`boot/start_once=true` 和 `boot/fail_count=0` 后再 reboot；若修改该策略，必须同步验证 auto-start 救援语义。
- `start_once` 是否仍绕过 `fail_count`；如果仍绕过，需要有串口日志与现场策略证明不会形成无限重启路径。
- Launcher autonomous OTA 网络初始化期间不再出现 `sys_evt` stack overflow；必要时验证 `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE` 调整或 Wi-Fi event callback 栈占用降低。
- 失败路径不写 `start_once`、不触发 reboot。
- `OtaRunningGuard` 互斥仍有效，并发 OTA 请求会被 busy 拒绝。
- NVS key 长度不超过 15 字符。
- 构建 App version 与预期一致（通过 `esptool image_info --version 2` 核对）。

## 关键检索词

- `start_autonomous_ota_check_once`
- `updateFirmwareEx`
- `OtaRunningGuard`
- `s_ota_running`
- `s_launcher_ota_check_started`
- `set_boot_autostart_once_for_ota`
- `boot/start_once`
- `boot/fail_count`
- `boot/default_mode`
- `default_mode=xiaozhi`
- `sys_evt`
- `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE`
- `***ERROR*** A stack overflow in task sys_evt has been detected.`
- `LAUNCHER-OTA`
- `BOOT-MODE set_once`
- `FirmwareUpdateResult`
- `Ota: Current version`
- `Ota: New version available`
- `Writing to partition ota_1`
- `Firmware upgrade successful`
- `Application: Firmware upgrade successful, rebooting`
- `2.0.32`
- `Launcher idle`
- `SERVO-MOVE`
- `SystemInfo`
- `HTTP 18080`
- `Project name`
- `App version`
- `firmware/main/hal/hal_ota.cpp`
- `firmware/main/apps/app_launcher/app_launcher.cpp`
- `LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher`
