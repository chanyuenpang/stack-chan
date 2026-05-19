# Launcher 到 XiaoZhi 启动链路与自动启动可行性

> Last updated: 2026-05-19

## 结论

当前固件已经存在 NVS boot mode 驱动的 Launcher auto-open `AI.AGENT` 机制：`main.cpp::get_boot_mode_xiaozhi_auto_open_source()` 读取 `boot/default_mode`、`boot/start_once`、`boot/fail_count`，再调用 `launcher->requestAutoOpenAiAgent(source)`；Launcher view ready 后 `try_auto_open_ai_agent()` 通过 MoonCake `openApp(appID)` 打开 `AI.AGENT`，最终走到 `AppAiAgent::onOpen()` → `GetHAL().requestXiaozhiStart()` → `Hal::startXiaozhi()`。

这条链路不是模拟触摸，也不是 USB/HTTP/MCP 远程入口；停在 Launcher 阶段时，dev serial、dev local HTTP、MCP bridge 仍不能替代触摸或 boot mode。长期高风险点是：`boot/start_once=true` 会优先 auto-open 且不受 `fail_count` 保护；OTA 成功后 `set_boot_autostart_once_for_ota()` 会写 `default_mode=xiaozhi + start_once=true + fail_count=0`。如果 XiaoZhi / Wi-Fi 启动路径存在 `sys_evt` 栈溢出，这会把设备推入 reboot loop。详见 `features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md`。

## 长期行为 / 规则

- **已存在的自主 OTA + 自动启动机制**：Launcher view 创建后，`start_autonomous_ota_check_once()` 会自动触发一次后台 OTA check（详见 `features/launcher-autonomous-ota-check.md`）。OTA 成功后 `set_boot_autostart_once_for_ota()` 写入 `boot/default_mode=xiaozhi`、`boot/start_once=true` 和 `boot/fail_count=0`，然后 reboot。
- **已存在的 boot mode auto-open 机制**：`get_boot_mode_xiaozhi_auto_open_source()` 在启动阶段读取 `boot/default_mode`、`boot/start_once`、`boot/fail_count`；若返回 `"once"` 或 `"default_mode"`，`AppLauncher::requestAutoOpenAiAgent()` 会在 Launcher ready 后自动打开 `AI.AGENT`。
- StackChan 固件存在两阶段启动：Phase 1 是 `mooncake Launcher` 图标网格（`AppLauncher`），Phase 2 才是 `xiaozhi-esp32` App。
- 从 Launcher 进入 XiaoZhi 的稳定触发路径是：触摸点击 `AI Agent` 图标或 boot mode auto-open → `AppAiAgent::onOpen()` → `requestXiaozhiStart()` → `main.cpp` 主循环检测 flag 退出 → `startXiaozhi()`。
- `requestXiaozhiStart()` 只是设置运行期内存 bool `_xiaozhi_start_requested`；真正的持久化策略在 `main.cpp` boot mode 读取和 Launcher auto-open 逻辑中，不是 HAL flag 本身。
- `start_dev_serial_wake_stop_task()` 和 `start_dev_local_control_server()` 只在 `startXiaozhi()` 之后才启动——也就是说设备停在 Launcher 阶段时，这两个控制通道根本不存在。
- MoonCake apps 的完整注册表和 `SETUP -> SystemUpdateWorker` 手动 OTA 入口见 `features/mooncake-launcher-capability-map.md`；这里的“无法远程进入 XiaoZhi”不等于 Launcher 没有本地 UI 能力。
- 当前 dev serial 即使编译了 `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`，运行时也会打印日志说明"intentionally disabled"并跳过实际任务创建。
- LVGL touchpad 的 read callback 只从 `hal_bridge` 的真实触摸状态读取，源码中不存在 USB/serial/network 写入 touch 状态的通道。
- `openApp(appID)` 是 `AppLauncher` 内部 UI 点击回调走到的 Mooncake API，没有外部 USB/HTTP/串口桥接到它。

### NVS key 能力边界

| NVS key | 能做到 | 不能做到 |
| ------- | ------ | -------- |
| `app_config/is_configed=true` | 跳过首次配置页（StartupWorker），直接显示 Launcher 图标网格 | 不能自动打开 AI Agent |
| `boot/start_once=true` | 下一次启动优先 auto-open `AI.AGENT`；读取后立即清成 `false` | 当前不检查、不递增 `fail_count`，不能单独作为安全保护 |
| `boot/default_mode=xiaozhi` | 持续默认 auto-open `AI.AGENT`，并受 `boot/fail_count` 阈值保护 | 若启动失败根因在 Launcher 自主 OTA 网络阶段，`fail_count` 保护不到 |
| `boot/fail_count` | 保护 `default_mode=xiaozhi` 连续失败，达到阈值后跳过自动进入 | 不保护 `start_once=true` 分支 |
| `warm_boot/app_index=1` | 把 Launcher 滚动/恢复到 AI Agent 图标位置附近（`scrollBy()`） | 不触发 `openApp()`，不触发点击；一次性行为，Launcher 读到后 `clearWarmRebootRequest()` 写回 `-1` |

## 关联代码

### 主锚点

- `firmware/main/main.cpp`：`get_boot_mode_xiaozhi_auto_open_source()` 读取 `boot/default_mode`、`boot/start_once`、`boot/fail_count`；`app_main()` 初始化 HAL，安装 `AppLauncher` + `AppAiAgent` 等 App，主循环持续 `GetMooncake().update()` 并检查 `GetHAL().isXiaozhiStartRequested()` flag。
- `firmware/main/apps/app_ai_agent/app_ai_agent.cpp`：`AppAiAgent::onOpen()` 是唯一直接调用 `GetHAL().requestXiaozhiStart()` 的 App 入口。
- `firmware/main/hal/hal.h`：`_xiaozhi_start_requested` 内存 flag 及其 getter/setter。
- `firmware/main/hal/hal.cpp`：`Hal::startXiaozhi()` 启动 stackchan task、dev serial、dev local HTTP，最后进入 xiaozhi app。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/apps/app_launcher/app_launcher.cpp` | `AppLauncher` 生命周期：`onLauncherCreate()` 自动 `open()`，`onLauncherOpen()` 判断是否走 StartupWorker 或 `create_launcher_view()`；`openApp(appID)` 是 App 打开入口。 |
| `firmware/main/apps/app_launcher/view/view.cpp` | `LauncherView` 图标点击：`onClick()` 设置 `_clicked_app_id`，`handle_state_normal()` 检测后触发 `onAppClicked` 回调；`warm_boot/app_index` 只做 `scrollBy()` 恢复图标位置，不调用 `openApp()`。 |
| `firmware/components/mooncake/src/templates/launcher.h` | `AppLauncherBase::openApp(int appID)` 只设置 `_going_to_open_app_id`；`onRunning()` / `onSleeping()` 再关闭 Launcher 并调用 `GetMooncake().openApp(...)`。 |
| `firmware/xiaozhi-esp32/main/settings.h` | `Settings` NVS 包装类；未来 `boot/default_mode`、`boot/auto_start_xiaozhi_once`、`launcher/open_app_once` 可复用其 `Get*` / `Set*` / `EraseKey`。 |
| `firmware/main/hal/hal_ble.cpp` | `app_config/is_configed` NVS 读取；只影响是否跳过 StartupWorker。 |
| `firmware/main/hal/hal_dev_serial.cpp` | `start_dev_serial_wake_stop_task()` 当前实现明确禁用（编译但不创建任务）；未定义宏时为空函数。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | `start_dev_local_control_server()` 在条件编译块内；条件不满足时为空函数；且只在 `startXiaozhi()` 后调用。 |
| `firmware/main/hal/board/hal_bridge.cc` | `start_xiaozhi_app()` 调用 `Application::GetInstance().Initialize()/Run()`，永不返回。 |

## 真实调用链路

### 触摸点击 → 进入 XiaoZhi 完整链路

```
触摸点击 AI Agent 图标
→ LauncherView icon onClick
→ _clicked_app_id = appID
→ LauncherView::handle_state_normal()
→ AppLauncher::_view->onAppClicked(appID)
→ AppLauncher::openApp(appID)
→ AppAiAgent::onOpen()
→ GetHAL().requestXiaozhiStart()
→ main.cpp 主循环 break
→ GetMooncake().uninstallAllApps()
→ DestroyMooncake()
→ GetHAL().startXiaozhi()
  → start_dev_serial_wake_stop_task()    // 在此之后才可用
  → start_dev_local_control_server()     // 在此之后才可用
  → hal_bridge::start_xiaozhi_app()
    → Application::Initialize()/Run()    // 永不返回
```

### 不要改错的位置

- `LauncherView` 的 `warm_boot/app_index` 逻辑只做 `scrollBy()` UI 恢复，不是 App 打开入口。
- `app_config/is_configed` 只决定 StartupWorker vs `create_launcher_view()`，不涉及 `openApp()`。
- `hal_dev_serial.cpp` 中的 dev serial 即使编译也运行时禁用，不能用于从 Launcher 触发任何动作。
- `hal_dev_local_control.cpp` 的 HTTP server 只在 `startXiaozhi()` 后启动，Launcher 阶段不存在。

## 自动启动方案现状与后续改进

当前已实现的是 `boot/start_once` / `boot/default_mode` → Launcher `requestAutoOpenAiAgent()` → `openApp(AI.AGENT)` 的方案，优点是复用 MoonCake open 生命周期；缺口是 `start_once` 不受 `fail_count` 保护，且 OTA 成功后会清 `fail_count=0` 并强制 next boot 进入 XiaoZhi。若继续改进“无触摸自动进入 xiaozhi”，推荐优先级是：**先修现有 boot mode + fail_count/start_once 保护** → **C：Launcher `open_app_once` 泛化打开 App** → **B：Launcher 阶段 USB 控制**。

### 方案 A：NVS boot mode 直接请求 XiaoZhi

最小稳定插入点是 `firmware/main/main.cpp` 中 Mooncake apps 安装完成之后、进入 `while` launcher loop 之前：

```text
GetHAL().init()
install AppLauncher / AppAiAgent / ...
read boot/default_mode and boot/auto_start_xiaozhi_once
if should_enter_xiaozhi:
    clear once key before request
    GetHAL().requestXiaozhiStart()
launcher loop
if isXiaozhiStartRequested(): break
uninstall Mooncake apps
GetHAL().startXiaozhi()
```

推荐 NVS namespace / key：

| Namespace | Key | 含义 |
| ---- | ---- | ---- |
| `boot` | `default_mode = "launcher" | "xiaozhi"` | 持续默认进入 Launcher 或 XiaoZhi。 |
| `boot` | `auto_start_xiaozhi_once = bool` | 仅下一次启动自动进入 XiaoZhi；读取为 true 后应**先清除再 request**。 |
| `boot` | `auto_start_fail_count = int` | 自动进入失败计数；超过阈值后回退 Launcher。 |
| `boot` | `last_xiaozhi_autostart_ms = int` | 可选诊断字段，记录最近自动启动时间。 |

可复用 `firmware/xiaozhi-esp32/main/settings.h` 的 `Settings` 类读写 `GetString` / `SetString` / `GetInt` / `SetInt` / `GetBool` / `SetBool` / `EraseKey`。

长期安全边界：

- `auto_start_xiaozhi_once` 比 `default_mode=xiaozhi` 更适合作为首版 OTA 救援能力；持续模式必须配取消/回退。
- 一次性 key 必须在 `requestXiaozhiStart()` 前清除，避免 XiaoZhi 启动中崩溃/重启后无限循环。
- `default_mode=xiaozhi` 应配 `auto_start_fail_count` 阈值（例如 2 或 3 次）、触摸/长按取消窗口、USB 取消命令或其它物理在场条件。
- 自动进入太早可能影响 OTA valid 标记：`Hal::updateHeapStatusLog()` 有 20s 后确认 OTA 的逻辑，`xiaozhi-esp32/main/application.cc` OTA 检查后也会 `MarkCurrentVersionValid()`；保守实现可在自动进入前保留 3~5s 取消/稳定窗口，或确保进入 XiaoZhi 后仍会执行 `Ota::MarkCurrentVersionValid()`。

推荐日志检索词：

```text
BOOT-MODE event=read default_mode=xiaozhi once=1 fail_count=0
BOOT-MODE event=auto_start_xiaozhi source=once
BOOT-MODE event=clear_once key=auto_start_xiaozhi_once
BOOT-MODE event=cancel_auto_start reason=touch
BOOT-MODE event=cancel_auto_start reason=fail_count_limit
BOOT-MODE event=request_xiaozhi_start
BOOT-MODE event=launcher_loop_break reason=xiaozhi_requested
```

### 方案 C：Launcher `open_app_once`

若目标是泛化“下次启动打开某个 Mooncake app”，而不只是进入 XiaoZhi，可在 `AppLauncher` 生命周期里做一次性 `openApp()`。推荐 key：

| Namespace | Key | 含义 |
| ---- | ---- | ---- |
| `launcher` | `open_app_once = "ai_agent"` | 一次性打开指定 app；优先存稳定名称，不直接长期存 runtime appID。 |
| `launcher` | `open_app_once_index = int` | 可选 fallback；按 Launcher UI index 打开。 |

`openApp(appID)` 只设置 `_going_to_open_app_id`，实际打开由 `AppLauncherBase::onRunning()` 先 `close()` launcher，再由 `AppLauncherBase::onSleeping()` 调用 `GetMooncake().openApp(...)`。因此最佳插入点不是 `onLauncherOpen()` 一开始，而是 `AppLauncher::onLauncherRunning()` 中确认 `startup_worker` 不存在、`_view` 已创建并完成一帧后，再读取/清除 `launcher/open_app_once` 并调用 `openApp(resolved_id)`。

已知安装顺序当前是 `AppLauncher` → `AppAiAgent` → `AppAvatar` → `AppEspnowControl` → `AppAppCenter` → `AppEzdata` → `AppDance` → `AppSetup`；但长期不要把 `appID=1` 或 UI index 当作稳定配置，优先解析 app name，例如 `ai_agent`。

### 方案 B：Launcher 阶段 USB 控制

如果需要现场救援/调试，可新增极小 USB serial command parser，但应独立于小智阶段 dev serial。当前 `firmware/main/hal/hal_dev_serial.cpp` 的 `start_dev_serial_wake_stop_task()` 即使编译启用也只是打印 intentionally disabled，不创建任务，且设计语义属于 XiaoZhi 阶段 `wake/stop/prompt_sample/saytest`。

推荐新增：

```text
firmware/main/hal/hal_launcher_serial_control.h
firmware/main/hal/hal_launcher_serial_control.cpp
```

由 `Hal` 暴露 `startLauncherSerialControl()` / `stopLauncherSerialControl()`，在 `main.cpp` launcher loop 前启动，break 后、`startXiaozhi()` 前停止，避免与 XiaoZhi 阶段 serial 冲突。

最小命令：

```text
status
start_xiaozhi
open_app ai_agent
```

写 NVS 或更危险命令（例如 `set_default_mode xiaozhi`、`cancel_auto_start`）应要求鉴权、编译开关或物理在场条件。建议编译开关包括 `STACKCHAN_ENABLE_LAUNCHER_USB_CONTROL`，写 NVS 类命令再单独加 `STACKCHAN_ENABLE_LAUNCHER_USB_CONTROL_WRITE_NVS`。

## 已知陷阱

- 不要假设写 `warm_boot/app_index` 就能自动进入 xiaozhi；它只做 UI 滚动恢复，不触发 `openApp()`。
- 不要假设 `start_dev_serial_wake_stop_task()` 可以在 Launcher 阶段工作；它只在 `startXiaozhi()` 后启动。
- 不要假设可以通过 USB serial 注入 LVGL click；源码中不存在远程写入 touch 状态的通道。
- 不要在 MCP bridge 层寻找"打开 Mooncake App"的命令；`xiaozhi_mcp_init()` 不暴露此能力。
- `_xiaozhi_start_requested` 是运行期 flag，重启后丢失，不能通过现有 NVS 或文件系统恢复；若要持久化启动策略，需要新增 `boot/*` key 读取逻辑。
- 不要把 `default_mode=xiaozhi` 做成无取消的永久配置；坏固件或小智阶段 crash 会让用户难以回 Launcher。
- `open_app_once` 若在 `StartupWorker` 或 `_view` 未创建时执行，可能绕过首次配置流程或撞上 LVGL 生命周期；应等 `onLauncherRunning()` 中 view ready 后再一次性触发。
- Launcher 阶段 USB parser 不应复用小智阶段 `hal_dev_serial.cpp` 的 wake/stop parser；两者生命周期和安全边界不同。

## 验证标准

后续如果新增自动启动能力，应验证：

- NVS auto-start key 读取逻辑在 `main.cpp` 安装 apps 后、Launcher update loop 之前执行，并能直接触发 `GetHAL().requestXiaozhiStart()`。
- `auto_start_xiaozhi_once` 在 request 前被清除，重启后不会反复自动跳过 Launcher。
- `default_mode=xiaozhi` 有 fail_count、触摸/长按取消或 USB 取消等救援路径，失败不会永久循环卡死。
- 自动启动方案不破坏 OTA rollback / valid 标记：能确认新固件稳定后执行 `Ota::MarkCurrentVersionValid()` 或等价逻辑。
- Launcher `open_app_once` 只在 `startup_worker` 不存在、`_view` 已创建并完成至少一帧后调用 `openApp()`。
- `open_app_once` 优先通过 app name 解析目标，不把 runtime appID / UI index magic number 当长期配置。
- 串口命令 parser 有编译宏保护、鉴权/物理在场限制和超时停止；进入 XiaoZhi 前必须 stop，量产固件不暴露未授权写 NVS 或 open app 控制口。

## 关键检索词

- `AppLauncher`
- `AppAiAgent`
- `requestXiaozhiStart()`
- `isXiaozhiStartRequested()`
- `_xiaozhi_start_requested`
- `startXiaozhi()`
- `start_xiaozhi_app()`
- `openApp(appID)`
- `onLauncherOpen()`
- `create_launcher_view()`
- `LauncherView`
- `handle_state_normal()`
- `_clicked_app_id`
- `app_config/is_configed`
- `warm_boot/app_index`
- `clearWarmRebootRequest()`
- `start_dev_serial_wake_stop_task()`
- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `start_dev_local_control_server()`
- `hal_bridge`
- `mooncake`
- `GetMooncake().update()`
- `esp_restart()`
- `requestWarmReboot()`
- `auto_start_xiaozhi_once`
- `boot/default_mode`
- `boot/auto_start_fail_count`
- `BOOT-MODE event=auto_start_xiaozhi`
- `launcher/open_app_once`
- `open_app_once`
- `hal_launcher_serial_control`
- `STACKCHAN_ENABLE_LAUNCHER_USB_CONTROL`
