# StackChan boot mode / XiaoZhi autostart 与 `sys_evt` 栈溢出

## 结论

StackChan 当前“进入 XiaoZhi 失败 / reboot loop”的最高优先级根因线索不是 OTA URL，也不是 MoonCake `AI.AGENT` open 生命周期本身，而是**启动网络阶段触发 ESP system event task `sys_evt` 栈溢出**。`firmware/sdkconfig.defaults` 中 `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=4096`，现场曾出现 `***ERROR*** A stack overflow in task sys_evt has been detected.`，且发生在 Wi-Fi connecting 附近。

这条风险同时覆盖两条路径：Launcher 自主 OTA 会调用网络初始化；XiaoZhi `Application::Initialize()` 也会在 `board.StartNetwork()` 后进入 Wi-Fi event callback 链。因此即使 `boot/default_mode=launcher`、`start_once=false`、`fail_count=0`，设备仍可能在 Launcher 阶段因自主 OTA 网络初始化而重启。

现场 2.0.31 reboot loop 的关键链路已被串口日志确认：`Boot 2.0.31 → Launcher → LAUNCHER-OTA task → startNetwork() → WiFi scan/connecting → *** sys_evt STACK OVERFLOW *** → reboot`。这说明“每次重启像是想进入小智”不应直接归因于 `AI.AGENT` auto-open；在该链路里设备从未进入 `AI.AGENT` / XiaoZhi，`BOOT-MODE` 仍是 `default_mode=launcher once=false`。2.0.32 通过 OTA 成功后，设备在 Launcher idle 下 Wi-Fi 可 ping、`SERVO-MOVE` / `SystemInfo` 持续输出且不再崩溃，可作为 `sys_evt` 栈溢出修复后的现场验收口径。

另一个长期约束是：`boot/start_once=true` 当前优先级高于 `default_mode=xiaozhi`，且**不受 `fail_count` 保护**；OTA 成功后的 `set_boot_autostart_once_for_ota()` 还会写 `default_mode=xiaozhi`、`start_once=true` 并清 `fail_count=0`。如果网络 / XiaoZhi 启动路径有 panic，这会把设备推向危险路径。

## 长期行为 / 规则

- `get_boot_mode_xiaozhi_auto_open_source()` 先读取 `boot/default_mode`、`boot/start_once`、`boot/fail_count`。
- `start_once=true` 分支会立即清除 `start_once=false` 并返回 `"once"`，但不检查 `fail_count`、不递增 `fail_count`。
- `default_mode=="xiaozhi"` 分支才检查 `fail_count >= 3`；未超限时先写 `fail_count + 1`，再返回 `"default_mode"`。
- 若 `default_mode` 不是 `xiaozhi` 且 `fail_count != 0`，启动会把 `fail_count` 重置为 `0`。
- 自动进入 XiaoZhi 不应绕过 Launcher 生命周期：`main.cpp` 只调用 `launcher->requestAutoOpenAiAgent(source)`，Launcher view ready 后由 `try_auto_open_ai_agent()` 找到 `AppAiAgent::kAppName` 并 `openApp(appID)`。
- `AppAiAgent::onOpen()` 只做 `GetHAL().requestXiaozhiStart()`；`main.cpp` 的 launcher loop 下一轮检测 `isXiaozhiStartRequested()` 后退出 MoonCake，`DestroyMooncake()`，再 `GetHAL().startXiaozhi()`。
- `Hal::startXiaozhi()` 创建 `stackchan` task、启动 dev serial/local control，并调用 `hal_bridge::start_xiaozhi_app()`。
- `hal_bridge::start_xiaozhi_app()` 调用 `Application::Initialize()` / `Application::Run()`；真正高风险点在 `Application::Initialize()` 内 display、audio、network 初始化，尤其 `board.StartNetwork()` 后的 Wi-Fi event callback 链。
- Launcher 自主 OTA 与 auto-open AI Agent 在 view 创建后相邻触发：`create_launcher_view()` 先 `start_autonomous_ota_check_once()`，再 `try_auto_open_ai_agent()`。若 `launcher_ota` task 已开始 `GetHAL().startNetwork()`，同时 auto-open 切到 XiaoZhi，会形成网络初始化与 runtime 切换重叠风险。
- `sys_evt` 栈溢出不依赖是否真正进入 XiaoZhi：Launcher autonomous OTA 的 Wi-Fi 也足以触发同一类崩溃。
- 看到 `SERVO-MOVE`、`SystemInfo`、Wi-Fi ping 稳定但没有 `AI.AGENT` 输出时，应判定设备仍在 Launcher idle；HTTP `18080` 无响应并不异常，因为本地 dev HTTP 控制面属于 `startXiaozhi()` 后能力。
- `log_running_partition_and_mark_valid_early()` 会在 HAL init 后早期 `MarkCurrentVersionValid()`；这能避免 Launcher-only boot 漏 mark valid，但也意味着新固件即使随后 panic，也可能不会 OTA rollback。

## 关联代码

### 主锚点

- `firmware/main/main.cpp`：`get_boot_mode_xiaozhi_auto_open_source()`、`app_main()`、早期 OTA valid 标记、Launcher 安装、auto-open AI Agent 请求、MoonCake loop 退出与 `GetHAL().startXiaozhi()`。
- `firmware/main/apps/app_launcher/app_launcher.cpp`：`requestAutoOpenAiAgent()`、`create_launcher_view()`、`try_auto_open_ai_agent()`、`start_autonomous_ota_check_once()`；Launcher ready 后自主 OTA 与 auto-open AI Agent 的相邻触发点。
- `firmware/main/hal/hal_ota.cpp`：`set_boot_autostart_once_for_ota()` 写 `default_mode=xiaozhi`、`start_once=true`、`fail_count=0` 的 OTA 成功收尾策略。
- `firmware/sdkconfig.defaults`：`CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=4096`，`sys_evt` 事件任务栈大小锚点。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/apps/app_ai_agent/app_ai_agent.cpp` | `AppAiAgent::onOpen()` 调用 `GetHAL().requestXiaozhiStart()`。 |
| `firmware/main/hal/hal.h` | `_xiaozhi_start_requested`、`requestXiaozhiStart()`、`isXiaozhiStartRequested()`。 |
| `firmware/main/hal/hal.cpp` | `Hal::startXiaozhi()` 创建 `stackchan` task、启动控制面、进入 XiaoZhi app。 |
| `firmware/main/hal/board/hal_bridge.cc` | `hal_bridge::start_xiaozhi_app()` 设置 XiaoZhi mode 并调用 `Application::Initialize()` / `Run()`。 |
| `firmware/xiaozhi-esp32/main/application.cc` | `Application::Initialize()` 中 `SetupUI()`、audio 初始化、`board.SetNetworkEventCallback(...)`、`board.StartNetwork()`；`Run()` 进入事件循环。 |
| `firmware/xiaozhi-esp32/main/settings.cc` | `Settings` NVS commit 行为；排查 `boot/default_mode`、`boot/start_once`、`boot/fail_count` 是否持久化时联动查看。 |
| `firmware/main/hal/board/stackchan_display.cc` | XiaoZhi display / LVGL 初始化与 `SetupUI()`，是低优先级但需排查的显示链路候选。 |
| `firmware/main/hal/board/cores3_audio_codec.cc` | audio codec 初始化中的 `assert` / `ESP_ERROR_CHECK`，若日志停在 audio 附近再提高优先级。 |

## 真实调用链路

### Boot mode → Launcher auto-open → XiaoZhi

1. `app_main()` 完成 logger、HAL init 和早期 OTA valid 标记。
2. `get_boot_mode_xiaozhi_auto_open_source()` 读取 `boot/default_mode`、`boot/start_once`、`boot/fail_count`。
3. 若返回 `"once"` 或 `"default_mode"`，`app_main()` 调用 `launcher->requestAutoOpenAiAgent(source)`。
4. `AppLauncher::create_launcher_view()` 创建 view 后先 `start_autonomous_ota_check_once()`，再 `try_auto_open_ai_agent()`。
5. `try_auto_open_ai_agent()` 遍历 `GetMooncake().getAllAppProps()`，找到 `AppAiAgent::kAppName` 后调用 `openApp(appID)`。
6. `AppAiAgent::onOpen()` 调用 `GetHAL().requestXiaozhiStart()`。
7. `main.cpp` launcher loop 检测 `GetHAL().isXiaozhiStartRequested()`，break 后 `GetMooncake().uninstallAllApps()`、`DestroyMooncake()`、`GetHAL().startXiaozhi()`。
8. `Hal::startXiaozhi()` 创建 StackChan task 并调用 `hal_bridge::start_xiaozhi_app()`。
9. `Application::Initialize()` 初始化 display、audio、network；`board.StartNetwork()` 后进入 Wi-Fi event callback 链。
10. `Application::Run()` 进入 XiaoZhi 事件循环。

### Launcher autonomous OTA → Wi-Fi event 风险

1. `AppLauncher::create_launcher_view()` 打印 `LAUNCHER-OTA launcher_ready action=create_autonomous_task`。
2. `start_autonomous_ota_check_once()` 创建 `launcher_ota` task，stack `8192`、priority `4`。
3. `launcher_ota_check_task` 走 `GetHAL().startNetwork(...)` 与 `GetHAL().updateFirmwareEx(...)`。
4. Wi-Fi 连接阶段会触发 ESP system event task `sys_evt`。
5. 若 `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=4096` 不足，现场可见 `***ERROR*** A stack overflow in task sys_evt has been detected.` 与 corrupted backtrace，随后 reboot。
6. 因为这发生在 Launcher 阶段，`fail_count` 和 XiaoZhi auto-open 保护不一定参与。

## 已知陷阱

- 不要把“设备没有进入 XiaoZhi”直接归因于 OTA URL 或 `AI.AGENT` open 失败；如果串口停在 `WifiBoard: WiFi connecting...` 后 `sys_evt` stack overflow，主线应转向 ESP system event task 栈和网络回调链。
- 不要以 `default_mode=launcher once=false fail_count=0` 排除 reboot loop；Launcher autonomous OTA 自己也会启动网络并触发 `sys_evt`。
- 不要认为 `fail_count` 能保护所有自动进入路径；当前它只保护 `default_mode=xiaozhi`，不保护 `start_once`。
- 不要在 OTA 成功后无条件清 `fail_count=0` 并强制 `start_once=true`，除非 XiaoZhi / Wi-Fi 启动路径已证明稳定或另有救援窗口。
- 不要把 `AppAiAgent` 当作复杂业务根因；它的 `onOpen()` 只是设置 HAL flag，真正复杂初始化在 `Hal::startXiaozhi()` 和 `Application::Initialize()`。
- 不要只盯 LVGL、audio、servo；在已有 `sys_evt` 现场证据时，Wi-Fi system event task stack 是 P0，LVGL/audio/servo 是后续候选。
- 不要把早期 `MarkCurrentVersionValid()` 当成 reboot loop 修复；它解决 rollback 状态，但也可能让坏 app 留在当前 slot。

## 验证标准

后续修改 boot mode、Launcher OTA 或 XiaoZhi startup 时至少验证：

- 串口启动日志包含 `BOOT-DIAG app_version/project/reset_reason`、`BOOT-MODE event=read default_mode=... once=... fail_count=...`、`event=auto_open_pending` / `event=skip`。
- `start_once=true` 路径是否有 fail_count / 限次 / 取消保护；如果没有，不能把它当安全救援机制。
- `default_mode=xiaozhi` 连续失败时 `fail_count` 是否持久递增，并在达到 limit 后留在 Launcher。
- OTA 成功后的 `set_boot_autostart_once_for_ota()` 是否仍写 `default_mode=xiaozhi`、`start_once=true`、`fail_count=0`；若保留，应解释风险与救援策略。
- Launcher autonomous OTA 与 auto-open AI Agent 不应让两个网络初始化阶段并发重叠；至少要有 `OtaRunningGuard`、启动顺序或取消条件证据。
- Wi-Fi 连接阶段必须观察是否仍出现 `***ERROR*** A stack overflow in task sys_evt has been detected.`；若仍出现，应优先调整/验证 `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE` 或减少 event callback 栈占用。
- 修复后的最低现场口径：OTA 后能看到目标版本下载/校验/`Firmware upgrade successful`/reboot，随后 Launcher idle 持续输出 `SERVO-MOVE` / `SystemInfo`，Wi-Fi 可 ping，且无新的 `sys_evt` stack overflow；若 `BOOT-MODE` 仍是 `default_mode=launcher once=false`，没有 `AI.AGENT` 输出是预期，不应算 XiaoZhi 进入失败。
- 若不再出现 `sys_evt` stack overflow，再继续排查 `Application::Initialize()` 的 display/audio/network、LVGL destroy 后对象引用、audio codec assert、PSRAM/heap 和 servo update 竞争。

## 关键检索词

- `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE`
- `sys_evt`
- `***ERROR*** A stack overflow in task sys_evt has been detected.`
- `WifiBoard: WiFi connecting`
- `get_boot_mode_xiaozhi_auto_open_source`
- `boot/default_mode`
- `boot/start_once`
- `boot/fail_count`
- `BOOT-MODE event=read`
- `BOOT-MODE event=auto_open_pending`
- `set_boot_autostart_once_for_ota`
- `default_mode=xiaozhi`
- `start_once=true`
- `fail_count=0`
- `requestAutoOpenAiAgent`
- `try_auto_open_ai_agent`
- `AppAiAgent::kAppName`
- `AppAiAgent::onOpen()`
- `requestXiaozhiStart()`
- `isXiaozhiStartRequested()`
- `Hal::startXiaozhi()`
- `hal_bridge::start_xiaozhi_app()`
- `Application::Initialize()`
- `board.StartNetwork()`
- `Boot 2.0.31 → Launcher → LAUNCHER-OTA task → startNetwork()`
- `2.0.32`
- `Launcher idle`
- `SERVO-MOVE`
- `SystemInfo`
- `HTTP 18080`
- `start_autonomous_ota_check_once`
- `launcher_ota`
- `GetHAL().startNetwork`
- `MarkCurrentVersionValid`
