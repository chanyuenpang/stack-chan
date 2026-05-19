# StackChan HTTP MCP Tool Entrypoints

## 结论

StackChan 当前有两条“HTTP 调用 MCP tool”的稳定入口，但语义不同：

- 本地设备 LAN dev HTTP：`http://<device-ip>:18080/dev/mcp/call`，由 firmware 直接实现，走 `stackchan_mcp_dispatch_tool()`，只支持一组 `self.robot.*` 工具，且没有 `/dev/mcp/list`。
- 小智官方云端 HTTP Messaging API：`https://xiaozhi.me/api/messaging/device/tools/list|call`，需要 `messaging token`，云端把 HTTP 请求转成设备已建立连接上的 `type:"mcp"` 消息，再由固件 `McpServer` 执行；这条路径可以列出/调用更完整的设备 MCP tools。

未来调查“远控调用内置 MCP 工具”时，先判断走的是本地 dev 控制面还是小智官方 messaging 控制面，不要把两者的请求格式、鉴权 token、可见 tool 范围混在一起。

## 长期行为 / 规则

- 本地 dev HTTP 控制面端口为 `18080`，控制端口为 `18081`；普通 body 最大约 `512 bytes`，`/dev/mcp/call` 最大 body 约 `1024 bytes`。
- 本地 dev HTTP 需要 Header `X-StackChan-Dev-Token`；默认 token 来自 `STACKCHAN_DEV_LOCAL_CONTROL_TOKEN`，默认值 `stackchan-dev`，只适合 LAN/dev 环境。
- 本地 `/dev/mcp/call` 不是标准 JSON-RPC `tools/call`，请求体使用自定义字段 `tool` + `arguments`，成功响应为 `{ "ok": true }` 或 `{ "ok": true, "result": ... }`。
- 本地 `/dev/mcp/call` 没有对应 `/dev/mcp/list`；可调用工具范围由 `stackchan_mcp_dispatch_tool()` 手写分发决定，主要是 `self.robot.*`。
- 当前本地 dev HTTP 控制面也没有稳定的 OTA trigger endpoint；不要在 `/dev/mcp/call` 或 `/dev/*` 清单中假设存在 `/dev/ota/check`、`/dev/ota/update`。Launcher 阶段手动 OTA 走 `SETUP -> SystemUpdateWorker -> GetHAL().updateFirmware()`，远程 OTA trigger 需要另行新增并明确阶段边界。
- 官方小智 HTTP Messaging API endpoint 是 `POST /api/messaging/device/tools/list` 和 `POST /api/messaging/device/tools/call`，鉴权使用 `Authorization: Bearer <messaging-token>`。
- 官方 messaging API 需要的是 `messaging token`，不是外部 MCP endpoint token `XIAOZHI_MCP_TOKEN`。
- 官方 `tools/call` 请求字段是 `name` + `arguments`；云端最终会向设备发送 `type:"mcp"` + JSON-RPC payload，设备端由 `McpServer::ParseMessage()`、`McpServer::DoToolCall()` 分发。
- `self.audio_speaker.set_volume` 只设置音量，不播放音频；本地 `/dev/play_sound` 是独立 HTTP endpoint，不是 MCP tool。
- `self.robot.create_reminder` 触发后主要显示 ReminderView 并播放 `OGG_NEW_NOTIFICATION`，不会朗读 `message`；`message` 主要用于屏幕显示。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_dev_local_control.cpp`：本地 dev HTTP server、endpoint 注册、token 校验、`mcp_call_handler()`、`celebrate_handler()`、`status_handler()`、`play_sound_handler()`、`inject_prompt_handler()`。
- `firmware/main/hal/hal_mcp.cpp`：`Hal::xiaozhi_mcp_init()` 注册 `self.robot.*` tools；`stackchan_mcp_dispatch_tool()` 是本地 `/dev/mcp/call` 的实际分发入口；`submitHeadMotion()`、`start_celebrate_modifier()`、`stackchan_celebrate_tick()` 负责硬件动作。
- `firmware/xiaozhi-esp32/main/mcp_server.cc`：官方 MCP `tools/list` / `tools/call` 的设备端解析与执行入口，包含 `McpServer::ParseMessage()`、`GetToolsList()`、`DoToolCall()`。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/CMakeLists.txt` | 当前 dev build 强制开启 `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`、`STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`。 |
| `firmware/main/CMakeLists.txt` | 启用 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` 时加入 `esp_http_server` 并设置编译定义。 |
| `firmware/main/hal/hal.cpp` | `Hal::startXiaozhi()` 调用 `start_dev_local_control_server()`；reminder trigger 回调显示 ReminderView 并播放通知音。 |
| `firmware/main/hal/hal_dev_local_control.h` | 本地 HTTP 控制 server 启动函数声明。 |
| `firmware/xiaozhi-esp32/main/application.cc` | 初始化时调用 `McpServer::AddCommonTools()`、`AddUserOnlyTools()`；收到 `type:"mcp"` 时调用 `McpServer::ParseMessage(payload)`。 |
| `firmware/xiaozhi-esp32/main/mcp_server.h` | `McpTool`、`Property`、`PropertyList`、`ReturnValue` 等 MCP tool 数据结构。 |
| `firmware/xiaozhi-esp32/main/protocols/protocol.cc` | `Protocol::SendMcpMessage()` 把 MCP 响应包装成 `type:"mcp"` 消息返回。 |
| `firmware/xiaozhi-esp32/main/protocols/websocket_protocol.cc` | hello/features 中声明 `"mcp": true`。 |
| `firmware/xiaozhi-esp32/main/protocols/mqtt_protocol.cc` | hello/features 中声明 `"mcp": true`。 |
| `firmware/main/apps/common/reminder/reminder.cpp` | `tools::create_reminder()`、`get_active_reminders()`、`stop_reminder()`。 |
| `firmware/main/apps/common/reminder/reminder.h` | reminder tools 对外声明。 |
| `tools/remote_control/remote_control.py` | Python LAN 客户端，封装 `/dev/status`、`/dev/mcp/call`、`/dev/celebrate`、`/dev/play_sound`、`/dev/inject_prompt`。 |
| `tools/xiaozhi-mcp-bridge/scripts/probe-messaging-tools.mjs` | 官方小智 HTTP Messaging API `tools/list` / `tools/call` 探测脚本。 |
| `tools/xiaozhi-mcp-bridge/README.md` | 记录官方 messaging API 的 token 与 endpoint 用法。 |

## 真实调用链路

### 本地 LAN dev HTTP `/dev/mcp/call`

1. `firmware/CMakeLists.txt` / `firmware/main/CMakeLists.txt` 启用 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` 与 `esp_http_server`。
2. `Hal::startXiaozhi()` 在 Wi-Fi STA 拿到 IP 后调用 `start_dev_local_control_server()`，最多等待约 `60s`。
3. `hal_dev_local_control.cpp` 启动本地 HTTP server，注册 `/dev/status`、`/dev/mcp/call`、`/dev/celebrate`、`/dev/wake`、`/dev/stop`、`/dev/play_sound`、`/dev/inject_prompt`。
4. `mcp_call_handler()` 校验 `X-StackChan-Dev-Token`，读取 JSON body，解析 `tool` 与 `arguments`。
5. handler 调用 `stackchan_mcp_dispatch_tool(tool, arguments, ...)`。
6. `stackchan_mcp_dispatch_tool()` 按 tool name 手写分发到 `self.robot.get_head_angles`、`self.robot.set_head_angles`、`self.robot.set_led_color`、`self.robot.celebrate`、reminder tools 等。
7. 头部动作进入 `submitHeadMotion()`；庆祝进入 `start_celebrate_modifier()`，后续由 `_stackchan_update_task()` / `stackchan_celebrate_tick()` 异步推进。

### 官方小智 HTTP Messaging API

1. 外部客户端调用 `POST https://xiaozhi.me/api/messaging/device/tools/list` 或 `/tools/call`，Header 使用 `Authorization: Bearer <messaging-token>`。
2. 小智云端把 HTTP 请求转换为设备连接上的 MCP JSON-RPC 消息。
3. 设备收到类似 `{ "type": "mcp", "payload": { "jsonrpc": "2.0", "method": "tools/call", ... } }`。
4. `application.cc` 收到 `type:"mcp"` 后调用 `McpServer::GetInstance().ParseMessage(payload)`。
5. `McpServer::ParseMessage()` 根据 method 分流到 `GetToolsList()` 或 `DoToolCall()`。
6. `DoToolCall()` 查找 `McpTool`，再通过 `Application::Schedule(...)` 执行 tool callback。
7. tool callback 通过 `McpTool::Call()` 产生返回值，`Protocol::SendMcpMessage()` 将响应重新包装为 `type:"mcp"` 发回。

## HTTP API 速查

### 本地设备 dev HTTP

| Endpoint | 方法 | 请求格式 / 含义 | 关键限制 |
| ---- | ---- | ---- | ---- |
| `/dev/status` | `GET` | 查询 `version`、`ip`、`state`、`heap_free`、`wifi_rssi` | 需要 `X-StackChan-Dev-Token`。 |
| `/dev/mcp/call` | `POST` | `{ "tool": "self.robot.set_led_color", "arguments": { ... } }` | 自定义格式；无 `/dev/mcp/list`；body 约 `1024 bytes`。 |
| `/dev/celebrate` | `POST` | `{ "style": "cheer", "duration_ms": 8200, "intensity": 2, "sound": false }` | 不走 `/dev/mcp/call`，但底层同样调用 `start_celebrate_modifier()`；已有 active 返回 `already_active`。 |
| `/dev/wake` | `POST` | 调用 `Application::StartListening()` | 未 ready 返回 `not_ready`。 |
| `/dev/stop` | `POST` | 调用 `Application::StopListening()` | 显式 stop，不是 toggle。 |
| `/dev/play_sound` | `POST` | `{ "sound": "success" }` | 不是 MCP tool；未知音效返回 `unknown_sound`。 |
| `/dev/inject_prompt` | `POST` | 注入内置 WAV prompt 到 XiaoZhi 上行音频队列 | 不是 MCP tool；并发返回 `inject_already_active`。 |

本地常见错误词：`unauthorized`、`invalid_json`、`missing_tool`、`unknown_tool`、`body_too_large`、`already_active`、`not_ready`、`unknown_sound`、`inject_already_active`。

### 官方小智 HTTP Messaging API

| Endpoint | 方法 | 请求格式 | 作用 |
| ---- | ---- | ---- | ---- |
| `/api/messaging/device/tools/list` | `POST` | `{}` | 列出设备当前暴露的 MCP tools。 |
| `/api/messaging/device/tools/call` | `POST` | `{ "name": "self.robot.set_led_color", "arguments": { ... } }` | 调用设备 MCP tool。 |

## 可调用工具范围

### 本地 `/dev/mcp/call` 支持的 `self.robot.*`

| Tool | 参数 / 行为要点 |
| ---- | ---- |
| `self.robot.get_head_angles` | 参数 `{}`；返回 `{ "yaw": ..., "pitch": ... }`。 |
| `self.robot.set_head_angles` | `yaw` / `pitch` 单位为度，内部乘以 `10`；缺省轴用 `-9999` 表示不更新；`speed` 默认约 `180`。 |
| `self.robot.set_head_targets` | 直接传内部 target；`yaw_target` 约 `-1280..1280`，`pitch_target` 实际 clamp 到 `30..870`，`speed` 约 `0..300`。 |
| `self.robot.set_led_color` | 设置左右 neon light RGB；MCP schema 建议 `0..168`，本地 dispatcher 只按数字读取，不主动拒绝越界。 |
| `self.robot.celebrate` | `style` 支持 `cheer`、`sparkle`、`nod`、`calm`；非阻塞；同一时间只允许一个 active。 |
| `self.robot.create_reminder` | 创建 reminder，返回 id；触发后显示 ReminderView 并播放 `OGG_NEW_NOTIFICATION`。 |
| `self.robot.get_reminders` | 返回 active reminders 列表。 |
| `self.robot.stop_reminder` | 按 id 停止 reminder。 |

### 设备 MCP server 暴露的工具

- StackChan 自定义 robot tools：`self.robot.get_head_angles`、`self.robot.set_head_angles`、`self.robot.set_head_targets`、`self.robot.set_led_color`、`self.robot.celebrate`、`self.robot.create_reminder`、`self.robot.get_reminders`、`self.robot.stop_reminder`。
- Common tools：`self.get_device_status`、`self.audio_speaker.set_volume`；条件工具包括 `self.screen.set_brightness`、`self.screen.set_theme`、`self.camera.take_photo`。
- User-only tools：`self.get_system_info`、`self.reboot`、`self.upgrade_firmware`；条件工具包括 `self.screen.get_info`、`self.screen.snapshot`、`self.screen.preview_image`、`self.assets.set_download_url`。
- `self.reboot`、`self.upgrade_firmware`、`self.screen.snapshot`、`self.screen.preview_image`、`self.assets.set_download_url` 属于系统变更、外部网络或隐私敏感能力，不应随意开放给不可信调用方。

## 不要改错的位置

- 不要在本地 HTTP 控制面里寻找 `/dev/mcp/list`；当前仓库没有这个 endpoint，本地可调用列表应从 `stackchan_mcp_dispatch_tool()` 和文档维护。
- 不要在本地 HTTP 控制面里寻找 OTA trigger endpoint；若要新增，应明确 endpoint、鉴权、是否允许 Launcher 阶段启动，以及与 `GetHAL().updateFirmware()` 的关系。
- 不要把官方 messaging API 的 `name` 字段格式套到本地 `/dev/mcp/call`；本地使用 `tool` 字段。
- 不要把本地 `X-StackChan-Dev-Token` 当成官方 messaging API token；官方路径使用 Bearer `messaging token`。
- 不要把 `tools/xiaozhi-mcp-bridge` 误判为设备 LAN 控制桥；官方 messaging API 探测脚本在 `tools/xiaozhi-mcp-bridge/scripts/probe-messaging-tools.mjs`，但真实设备执行仍在固件 `McpServer`。
- 不要用 `self.audio_speaker.set_volume` 期待播放提示音；播放内置音效走 `/dev/play_sound`，庆祝动作 sound 参数当前也不是音效播放链路。

## 验证标准

后续修改 HTTP MCP 远控链路时，至少验证：

- 本地 `/dev/mcp/call` 是否仍使用 `tool` + `arguments`，且 token 校验、body size 限制、错误码保持清晰。
- 本地 `/dev/mcp/call` 与官方 messaging `tools/call` 的请求字段、鉴权 token 和可见工具范围是否在文档和客户端里区分明确。
- `stackchan_mcp_dispatch_tool()` 支持列表与 `Hal::xiaozhi_mcp_init()` 注册的 `self.robot.*` 是否保持一致；若新增 robot tool，应同步考虑本地 HTTP dispatcher 是否需要支持。
- 官方 `tools/list` 是否能看到 common tools / user-only tools 的预期范围，尤其不要误开放 `self.reboot`、`self.upgrade_firmware` 等高风险工具。
- 头部、LED、celebrate、reminder tools 的回归测试应覆盖快速返回、参数 clamp、`already_active`、reminder 触发显示与通知音。

## 关键检索词

- `/dev/mcp/call`
- `/dev/mcp/list`
- `/api/messaging/device/tools/list`
- `/api/messaging/device/tools/call`
- `messaging token`
- `XIAOZHI_MCP_TOKEN`
- `X-StackChan-Dev-Token`
- `STACKCHAN_DEV_LOCAL_CONTROL_TOKEN`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `start_dev_local_control_server()`
- `mcp_call_handler()`
- `stackchan_mcp_dispatch_tool()`
- `Hal::xiaozhi_mcp_init()`
- `McpServer::ParseMessage()`
- `McpServer::GetToolsList()`
- `McpServer::DoToolCall()`
- `Protocol::SendMcpMessage()`
- `self.robot.set_led_color`
- `self.robot.celebrate`
- `self.robot.create_reminder`
- `self.audio_speaker.set_volume`
- `self.reboot`
- `self.upgrade_firmware`
