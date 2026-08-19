# StackChan Launcher 无网络停留态与 UI 脱困路径

## 结论

StackChan 停在 MoonCake Launcher 且没有 Wi-Fi / OTA / HTTP 访问时，不应直接判定为 Wi-Fi 模块损坏或 OTA server 异常。当前 2.0.32 / 2.0.33 口径下，Launcher 默认可以处于 `launcher_only` 无网络停留态：Launcher 本身不主动启动 XiaoZhi `Application::Initialize()`，也不会在默认关闭自主 OTA 时启动网络。

可用的非 USB 脱困路径主要依赖设备触摸 UI：首选在 Launcher 中打开 `AI.AGENT`，让 XiaoZhi 自身启动网络并走 `ActivationTask::CheckNewVersion()` / `UpgradeFirmware(...)`；备选在 `SETUP` / Firmware 页面点击 `Check for Updates`，走 `SystemUpdateWorker` → `Hal::updateFirmware(...)`。如果触摸 UI 完全不可用，并且遵守“不 USB 直刷 / 不擦除 / 不写设备分区 / 不覆盖 NVS”的禁令，当前正式固件没有可靠的非 UI 程序入口可以从纯 Launcher 无网态脱困。

## 长期行为 / 规则

- Launcher 阶段只跑 MoonCake UI loop：`GetMooncake().update()`；停留态不会自动进入 XiaoZhi，也不会天然启动 Wi-Fi。
- `AI.AGENT` 是 Launcher 到 XiaoZhi runtime 的边界 app：点击后 `AppAiAgent::onOpen()` 只设置 `GetHAL().requestXiaozhiStart()`，随后 `main.cpp` 主循环检测 flag，退出 Launcher 并调用 `GetHAL().startXiaozhi()`。
- 进入 XiaoZhi 后才会执行 `Application::Initialize()`，其中 `board.StartNetwork()` 启动 Wi-Fi；网络连上后 `ActivationTask()` 调用 `CheckNewVersion()`，发现新版本后 `UpgradeFirmware(...)` 并成功后 reboot。
- Launcher 设置页仍有手动 OTA 能力：`SETUP` → Firmware → `Check for Updates` 会创建 `SystemUpdateWorker`；worker 先 `GetHAL().startNetwork(...)`，再 `GetHAL().updateFirmware(...)`。
- 串口长期只有 `SERVO-MOVE ... mode=prevent_disconnect`、`SystemInfo`，但没有 `AI.AGENT on open`、`HAL start xiaozhi`、Wi-Fi 日志或 OTA 请求时，应优先判定设备仍在 Launcher idle / launcher_only，而不是继续追 OTA manifest。
- 当前 dev serial 不能作为正式脱困入口：`start_dev_serial_wake_stop_task()` 未启用宏时为空；即使启用实验宏，当前实现也明确打印 intentionally disabled 并不创建任务。
- 当前本地 HTTP / MCP / LAN 控制不能从纯 Launcher 无网态使用：`start_dev_local_control_server()` 需要编译开关，且即使启用也在 `Hal::startXiaozhi()` 之后才启动；MCP tools 也要等 XiaoZhi `Application::Initialize()` 后注册。
- BLE / AP 配网入口不是 Launcher 常驻能力：只有触发 `WifiBoard::StartNetwork()` 后，已有 Wi-Fi 配置才会 STA 连接；无 SSID 时才进入 Xiaozhi AP/config mode。停在 Launcher 本身不会主动开 AP/BLE 配网。
- 若当前版本日志出现 `LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher`，这是“Launcher 默认不自启 Wi-Fi/OTA”的设计证据；后续调查应转向 UI 触发、boot mode auto-open 或新增救援入口，而不是等待 OTA server 请求。

## 关联代码

### 主锚点

- `firmware/main/main.cpp`：安装 `AppAiAgent`；MoonCake Launcher loop 检测 `isXiaozhiStartRequested()` 后退出 Launcher 并调用 `GetHAL().startXiaozhi()`；`launcher_only` boot mode 可让设备保持 Launcher。
- `firmware/main/apps/app_ai_agent/app_ai_agent.cpp`：`AppAiAgent::onOpen()` 调用 `GetHAL().requestXiaozhiStart()`，是触摸打开 `AI.AGENT` 的边界入口。
- `firmware/main/apps/app_setup/workers/about.cpp`：`SystemUpdateWorker` 的手动 OTA 入口，先启动网络再调用固件更新。
- `firmware/xiaozhi-esp32/main/application.cc`：`Application::Initialize()` 启动网络，`ActivationTask()` / `CheckNewVersion()` / `UpgradeFirmware()` 负责 XiaoZhi 自身 OTA。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/apps/app_launcher/app_launcher.cpp` | `create_launcher_view()` 绑定 `onAppClicked => openApp(appID)`；当前版本还可记录 `LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher`。 |
| `firmware/main/apps/app_launcher/view/view.cpp` | Launcher 图标 `onClick()` 设置 `_clicked_app_id`，`handle_state_normal()` 触发 `onAppClicked(_clicked_app_id)`。 |
| `firmware/main/hal/hal.cpp` | `Hal::startXiaozhi()` 打印/进入 `start xiaozhi`，并调用 `hal_bridge::start_xiaozhi_app()`。 |
| `firmware/main/hal/hal_network.cpp` | `Hal::startNetwork()` 调用 `board.StartNetwork()` 并等待 network connected；Launcher 手动 OTA worker 依赖它。 |
| `firmware/main/hal/hal_ota.cpp` | `Hal::updateFirmwareEx()` 检查 OTA、下载升级、成功后 reboot；设置页手动 OTA 最终落到这里。 |
| `firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc` | `WifiBoard::StartNetwork()` / `TryWifiConnect()`：有 SSID 走 STA，无 SSID 才进入 Wi-Fi config mode。 |
| `firmware/main/hal/hal_dev_serial.cpp` | dev serial wake/stop 当前 no-op / intentionally disabled；不能靠串口命令从 Launcher 脱困。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | 本地 HTTP 控制面条件编译，且在 `Hal::startXiaozhi()` 后才可能启动；纯 Launcher 无网态不可用。 |
| `firmware/main/CMakeLists.txt` | `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`、`STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` 编译开关；默认不应假设救援入口存在。 |

## 真实调用链路

### Launcher 点击 `AI.AGENT` → XiaoZhi OTA

1. 用户在 Launcher carousel 中找到并点按 `AI.AGENT`。
2. `LauncherView::onClick()` 设置 `_clicked_app_id`。
3. `LauncherView::handle_state_normal()` 调用 `onAppClicked(_clicked_app_id)`。
4. `AppLauncher::openApp(appID)` 进入 MoonCake app 打开流程。
5. `AppAiAgent::onOpen()` 调用 `GetHAL().requestXiaozhiStart()`。
6. `main.cpp` Launcher loop 检测 `GetHAL().isXiaozhiStartRequested()`，退出 MoonCake 并调用 `GetHAL().startXiaozhi()`。
7. `Hal::startXiaozhi()` 调用 `hal_bridge::start_xiaozhi_app()`。
8. `Application::Initialize()` 执行 `board.StartNetwork()`；网络连上后 `ActivationTask()` 执行 `CheckNewVersion()`。
9. 若发现新版本，`UpgradeFirmware(...)` 下载并升级固件，成功后 reboot。

预期证据包括：`AI.AGENT on open`、`start xiaozhi`、`WiFi scanning`、`WiFi connecting to ...`、`Connected to WiFi`、`Network connected`、`CHECKING_NEW_VERSION`、`Starting firmware upgrade from URL: ...`、`Firmware upgrade successful, rebooting...`，服务端应看到 `/ota/` 与固件 bin 请求。

### Launcher `SETUP` → Firmware → `Check for Updates`

1. 用户在 Launcher 中打开 `SETUP`。
2. 进入 Firmware 分组并点击 `Check for Updates`。
3. `AppSetup` 创建 `SystemUpdateWorker`。
4. `SystemUpdateWorker` 先调用 `GetHAL().startNetwork(...)`。
5. 网络连上后调用 `GetHAL().updateFirmware(...)` / `Hal::updateFirmwareEx()`。
6. 固件检查、下载和写 OTA app 分区成功后 reboot。

预期证据包括：`WiFi scanning...`、`Connecting to ...`、`network connected elapsed_ms=...`、`LAUNCHER-OTA check start`、`LAUNCHER-OTA update start version=... url=...`、`LAUNCHER-OTA update success version=... action=reboot next_route=xiaozhi_ota`，服务端应看到 `/ota/` 与固件 bin 请求。

## 不要改错的位置

- 不要把 `HTTP 18080`、MCP 或本地 LAN 控制当成 Launcher 无网态的救援入口；它们都要求进入 XiaoZhi 或至少先启动网络。
- 不要把 dev serial 历史代码当成可用的 USB 命令通道；当前正式实现是 no-op / intentionally disabled。
- 不要看到无 `/ota/` 请求就继续只调 manifest、`force=1` 或 server；如果设备仍在 Launcher 且没有点击 `AI.AGENT` / `SETUP`，根本不会到达 OTA check。
- 不要把 BLE/AP 配网当成 Launcher 自动常驻；它依赖 `StartNetwork()` 被触发。
- 不要用“稳定停在 Launcher”粉饰为修复 XiaoZhi/OTA：目标若是进入 XiaoZhi 并 OTA，验收必须看到进入 XiaoZhi、联网、OTA 请求和无 `sys_evt` 栈溢出。

## 后续改进方向

- Launcher 增加安全的物理按键 / 长按 / 触摸手势触发 `requestXiaozhiStart()`。
- Launcher 在联网条件下做一次轻量 OTA check，但必须避免重引入 `sys_evt` 栈溢出或与 XiaoZhi 启动并发抢网络资源。
- 恢复生产可控、受限且有安全门控的串口命令入口，只允许 `open AI.AGENT` 或 `startNetwork` 这类救援动作。
- 修正 boot policy，让小智 OTA 后首启更可靠地 auto-open `AI.AGENT`，同时保留 `fail_count` / 取消窗口，避免落入 `launcher_only` 无网态。

## 验证标准

- Launcher 无网态判断：串口只有 `SERVO-MOVE` / `SystemInfo`，没有 `AI.AGENT on open`、`start xiaozhi`、Wi-Fi、OTA 或服务端 `/ota/` 请求时，只能说明未触发网络/OTA入口。
- 触摸 `AI.AGENT` 路径必须看到 `AI.AGENT on open` → `start xiaozhi` → Wi-Fi 连接 → `CHECKING_NEW_VERSION` / `/ota/` 请求 → 固件下载 / reboot。
- `SETUP` 手动 OTA 路径必须看到 `SystemUpdateWorker` 相关日志、`startNetwork()`、`LAUNCHER-OTA check start`、服务端 `/ota/` 和成功 reboot。
- 声称串口、HTTP、MCP、BLE/AP 可作为救援入口前，必须证明对应编译开关、启动阶段、网络状态和日志均满足；否则按不可用处理。

## 关键检索词

- `AI.AGENT`
- `AppAiAgent::onOpen()`
- `requestXiaozhiStart()`
- `isXiaozhiStartRequested()`
- `Hal::startXiaozhi()`
- `hal_bridge::start_xiaozhi_app()`
- `Application::Initialize()`
- `board.StartNetwork()`
- `ActivationTask()`
- `CheckNewVersion()`
- `UpgradeFirmware()`
- `SETUP`
- `Firmware`
- `Check for Updates`
- `SystemUpdateWorker`
- `GetHAL().startNetwork`
- `Hal::updateFirmwareEx()`
- `LAUNCHER-OTA disabled reason=default_off route=launcher_only action=stay_launcher`
- `launcher_only`
- `SERVO-MOVE`
- `SystemInfo`
- `WiFi scanning`
- `Connected to WiFi`
- `CHECKING_NEW_VERSION`
- `Firmware upgrade successful, rebooting`
- `start_dev_serial_wake_stop_task()`
- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `start_dev_local_control_server()`
- `WifiBoard::StartNetwork()`
- `TryWifiConnect()`
