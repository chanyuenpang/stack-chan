# StackChan MoonCake Launcher 能力地图

## 结论

StackChan 启动后先进入 `mooncake Launcher` 阶段，所有 MoonCake apps 都在 `firmware/main/main.cpp::app_main()` 中安装并由 Launcher 打开。`AI.AGENT` 是 Launcher 与 XiaoZhi runtime 的边界 app：它在 Launcher 阶段可见、可点击，但打开后会调用 HAL 进入 `startXiaozhi()`，随后 HTTP 18080、MCP tools、小智协议、reminder 等能力才真正可用。

Launcher 阶段已经可以通过 `SETUP` app 的 About/System Update 手动触发 OTA；但当前固件没有公开的 Launcher 阶段远程 OTA 触发入口。远程控制面 `/dev/*`、MCP dispatcher 和 dev serial 的历史命令都不能被当作 Launcher 阶段能力。

## 长期行为 / 规则

- `app_main()` 先执行 `GetHAL().init()`，再创建 `AppLauncher`，安装各个 MoonCake apps，最后打开 Launcher。
- Launcher 会安装 `AI.AGENT`，并可按启动配置请求 auto-open AI Agent；但真正进入 XiaoZhi 的边界仍是 `AppAiAgent::onOpen()` 调用 HAL。
- `SETUP` app 是 Launcher 阶段可用的系统设置入口，About/System Update worker 可调用 `GetHAL().updateFirmware(...)`，复用 XiaoZhi OTA 核心代码。
- Launcher 阶段可用的是 MoonCake UI 与设置页；HTTP 18080、MCP tools、reminder/celebrate tools、XiaoZhi 协议栈都属于 `startXiaozhi()` 之后能力。
- `hal_dev_serial.cpp` 仍保留历史 wake/stop/prompt 相关代码片段，但当前实现明确 no-op：USB Serial/JTAG driver 不安装，dev serial task 不创建，不能作为可靠入口。
- 当前 HTTP 18080 dev local control 的启动点在 `Hal::startXiaozhi()`，即使编译宏启用，也不是纯 Launcher 阶段能力。
- 当前可程序化调用 OTA 的函数级入口包括 `GetHAL().updateFirmware()`、`Ota::CheckVersion()`、`Ota::StartUpgrade()`；但缺少可从远程直接调用的公开 HTTP endpoint 或 Launcher 阶段控制面。

## MoonCake apps 速查

| App | 路径 | 名称 / 入口证据 | 作用 | Launcher 阶段 |
| ---- | ---- | ---- | ---- | ---- |
| `LAUNCHER` | `firmware/main/apps/app_launcher/` | `AppLauncher::AppLauncher()` 设置 `name="LAUNCHER"` | 主启动器，卡片入口，负责打开其它 app，也支持 auto-open AI Agent | 默认打开 |
| `SETUP` | `firmware/main/apps/app_setup/` | `AppSetup::AppSetup()` | 设置页：Wi-Fi、启动模式、系统、关于、OTA 等 | 可用 |
| `AVATAR` | `firmware/main/apps/app_avatar/` | `AppAvatar::AppAvatar()` 设置 `name="AVATAR"` | Avatar / WebSocket avatar service demo / 工具 app | 可用 |
| `ESPNOW.REMOTE` | `firmware/main/apps/app_espnow_ctrl/` | `name="ESPNOW.REMOTE"` | ESP-NOW 遥控相关 | 可用 |
| `APP.CENTER` | `firmware/main/apps/app_app_center/` | `name="APP.CENTER"` | App 中心 / 加载页 | 可用 |
| `EZDATA` | `firmware/main/apps/app_ezdata/` | `name="EZDATA"` | EZData 示例 / 数据相关 | 可用 |
| `DANCE` | `firmware/main/apps/app_dance/` | `name="DANCE"` | 舞蹈 / 动作示例 | 可用 |
| `AI.AGENT` | `firmware/main/apps/app_ai_agent/` | `AppAiAgent::kAppName = "AI.AGENT"` | 进入 XiaoZhi runtime 的边界 app | 图标可见；打开后进入 runtime |

## Launcher 设置页结构

`SETUP` app 的页面和 worker 在以下文件中组织：

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/apps/app_setup/app_setup.cpp` | `AppSetup::onOpen()` 创建设置界面和菜单 workers。 |
| `firmware/main/apps/app_setup/workers/workers.h` | 集中声明 Wi-Fi、Startup、About/System、Firmware Version、System Update、Factory Reset 等 worker 类。 |
| `firmware/main/apps/app_setup/workers/about.cpp` | `FwVersionWorker`、`SystemUpdateWorker` 等 About/System Update 实现。 |
| `firmware/main/apps/app_setup/workers/startup.cpp` | 启动模式设置，例如默认进入 XiaoZhi。 |
| `firmware/main/apps/app_setup/workers/system.cpp` | Factory Reset 等系统操作。 |

用户“检查更新”的稳定入口是 `SystemUpdateWorker`：

```text
Launcher
  → 打开 SETUP app
    → AppSetup::onOpen()
      → About / System Update
        → SystemUpdateWorker 用户点击“检查更新”
          → GetHAL().updateFirmware(...)
          → Hal::updateFirmware()
          → Ota::CheckVersion()
          → Ota::StartUpgrade()/Upgrade()
```

## 关联代码

### 主锚点

- `firmware/main/main.cpp`：`app_main()` 初始化 HAL、创建 Launcher、安装 MoonCake apps、设置 auto-open AI Agent、打开 Launcher。
- `firmware/main/apps/app_ai_agent/app_ai_agent.cpp`：`AppAiAgent::onOpen()` 是 Launcher 到 XiaoZhi runtime 的边界入口。
- `firmware/main/apps/app_setup/workers/about.cpp`：`SystemUpdateWorker` 是 Launcher 设置页 OTA 检查入口。
- `firmware/main/hal/hal.cpp`：`Hal::startXiaozhi()` 启动 XiaoZhi runtime、StackChan update task、dev serial/local HTTP 控制面。
- `firmware/main/hal/hal_ota.cpp`：HAL 层 OTA 流程，设置页 OTA 最终落到这里。
- `firmware/xiaozhi-esp32/main/ota.cc`：`Ota::CheckVersion()`、`Ota::Upgrade()`、`Ota::StartUpgrade()` 核心 OTA 实现。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/apps/app_launcher/` | Launcher UI、卡片入口、打开其他 app 的主模块。 |
| `firmware/main/apps/app_setup/workers/workers.h` | 设置页 worker 类声明和 About/System worker 检索入口。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | HTTP 18080 dev local control；当前启动点在 `startXiaozhi()` 后，不是 Launcher 阶段远控面。 |
| `firmware/main/hal/hal_dev_serial.cpp` | dev serial 当前实现 no-op；不能作为 Launcher 阶段控制入口。 |
| `firmware/main/hal/hal_mcp.cpp` | StackChan 自定义 MCP tools 和 HTTP dispatch；完整能力属于 XiaoZhi 后阶段。 |
| `firmware/xiaozhi-esp32/main/mcp_server.cc` | XiaoZhi MCP server 基础实现。 |
| `firmware/main/hal/board/hal_bridge.cc` | `hal_bridge::start_xiaozhi_app()` 进入 XiaoZhi `Application::Initialize()/Run()`。 |

## 真实调用链路

### Launcher 安装 apps

1. `firmware/main/main.cpp::app_main()` 调用 `GetHAL().init()`。
2. 创建 `AppLauncher`，按启动模式可调用 `launcher->requestAutoOpenAiAgent(...)`。
3. 通过 `moon.installApp(std::make_unique<...>())` 安装 `SETUP`、`AVATAR`、`ESPNOW.REMOTE`、`APP.CENTER`、`EZDATA`、`DANCE`、`AI.AGENT` 等 apps。
4. 最后打开 Launcher；用户可在 Launcher UI 点击 app 卡片。

### Launcher → XiaoZhi 边界

1. 用户点击 `AI.AGENT`。
2. `AppAiAgent::onOpen()` 调用 HAL 请求进入 XiaoZhi。
3. `main.cpp` 的 launcher loop 检测 flag 并退出 MoonCake app 阶段。
4. `Hal::startXiaozhi()` 执行 motion 自动同步/释放、reminder callback、StackChan update task、dev serial/local HTTP 控制面启动，然后调用 `hal_bridge::start_xiaozhi_app()`。
5. XiaoZhi runtime ready 后，`_stackchan_update_task()` 轮询 `hal_bridge::is_xiaozhi_ready()` 并创建 home indicator/status bar、启动 SNTP 等后续状态。

### 能力分层

| 能力 | Launcher / MoonCake 阶段 | `startXiaozhi()` 后 |
| ---- | ---- | ---- |
| MoonCake Launcher UI | 可用 | 被 XiaoZhi runtime 接管或混合显示 |
| `SETUP` 设置页 | 可用 | 不作为主要入口 |
| 设置页 OTA | 可手动点击触发 | 仍复用同一 OTA 类 |
| XiaoZhi 语音 / 协议 / runtime | 不可用 | 可用 |
| HTTP 18080 `/dev/*` | 不可用 | 可用，受编译宏和 token 限制 |
| dev serial wake/stop | 当前不可用，no-op | 理论调用在此阶段，但当前仍 no-op |
| MCP tools / reminder / celebrate | 不可用 | 可用 |

## 不要改错的位置

- 不要把 HTTP 18080 当作 Launcher 阶段能力；它的启动点在 `Hal::startXiaozhi()` 之后。
- 不要把 dev serial 历史代码当成可用控制面；当前实现明确不创建 task。
- 不要为远程 OTA 继续只调整 manifest、`force` 或 OTA server；如果设备停在 Launcher 且没人点击 `SETUP` 或 `AI.AGENT`，OTA 检查不会自动到达。
- 不要把 `AI.AGENT` 当成普通 app 继续调查其内部 UI；它是边界 app，打开后主要职责是把系统切到 XiaoZhi runtime。
- 不要假设 MCP tool 能解决纯 Launcher 远程控制；MCP 属于 XiaoZhi 后阶段。

## 验证标准

后续修改 Launcher、OTA 或远控能力时，至少验证：

- `main.cpp::app_main()` 的 app 安装顺序和 `AI.AGENT` 边界仍清晰，Launcher 能打开 `SETUP` 和 `AI.AGENT`。
- `SystemUpdateWorker` 点击后仍走 `GetHAL().updateFirmware()`，并复用 `Ota::CheckVersion()` / `Ota::Upgrade()`。
- 停在 Launcher 阶段时，不应宣称 HTTP 18080、MCP tools、dev serial 可用；如果新增 Launcher 控制面，应有独立启动点、编译开关和鉴权。
- 进入 XiaoZhi 后再验证 `/dev/status`、`/dev/mcp/call`、reminder/celebrate 等能力。
- 如果新增远程 OTA trigger，需明确它是 Launcher 阶段 endpoint、XiaoZhi 后 endpoint，还是 MCP tool；三者安全边界不同。

## 关键检索词

- `app_main()`
- `moon.installApp`
- `AppLauncher`
- `requestAutoOpenAiAgent`
- `AI.AGENT`
- `AppAiAgent::kAppName`
- `AppAiAgent::onOpen()`
- `SETUP`
- `AppSetup::onOpen()`
- `SystemUpdateWorker`
- `FwVersionWorker`
- `GetHAL().updateFirmware`
- `Hal::updateFirmware`
- `Ota::CheckVersion`
- `Ota::StartUpgrade`
- `Ota::Upgrade`
- `Hal::startXiaozhi()`
- `start_dev_local_control_server()`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`
- `start_dev_serial_wake_stop_task()`
- `xiaozhi_mcp_init()`
- `self.robot.create_reminder`
- `self.robot.celebrate`
