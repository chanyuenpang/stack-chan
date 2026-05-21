# StackChan Project Truth

## 项目级规则

- OTA 发布类知识按主题沉淀到 `features/`，`PROJECT-TRUTH.md` 只保留跨功能摘要和索引，不记录单次发布状态。
- 固件版本入口以 `firmware/CMakeLists.txt` 的 `PROJECT_VER` 为准；OTA 发布前必须通过 app_desc 校验目标版本。

## 重要索引

- [`features/ota-release-workflow.md`](features/ota-release-workflow.md)：StackChan OTA 发布、远程重启触发升级、实机状态验收链路。
- [`features/celebrate-servo-bus-health.md`](features/celebrate-servo-bus-health.md)：`celebrate` 触发不等于完成；正常完成必须同时满足 `expected_end_ms`、`min_finish_ms`、`step_index >= kMotionFrameCount`；`duration_complete` / `preflight_bus_dead` / `bus_dead` / `timeout` 的完成/中止语义边界，收尾日志中 `finish_type`、`bus_dead`、`transient_io_error`、`hardware_failure` 的长期语义边界，`ERR_NO_REPLY` 后 ACK missing transient cooldown / 异步单轴 probe 规则，以及 yaw/pitch 双轴 `WritePos` 错峰诊断入口。
- [`features/voice-injection-celebrate-e2e.md`](features/voice-injection-celebrate-e2e.md)：语音注入庆祝完整链路的黄金入口是 `tools/remote_control/remote_control.py inject-prompt` / `POST /dev/inject_prompt`；它通过内嵌 prompt 注入 XiaoZhi 上行音频触发 `self.robot.celebrate`，不是 `/dev/celebrate`、不是 `/dev/mcp/call`、不是 `/dev/wake`，也不需要用户现场人工说话。

## 迁移补充的项目级长期规则（2026-05-21）

> 本小节从旧 OpenClaw project Truth 摘要迁入。合并时以当前 `.claw/truth` 为 canonical；以下规则只补充长期边界，不覆盖现有 OTA / Celebrate 规则。

- **本地 LAN dev HTTP 与小智官方 messaging API 边界**：`http://<device-ip>:18080/dev/mcp/call` 是设备本地 dev 入口，由固件直接分发到 `stackchan_mcp_dispatch_tool()`；小智官方 `https://xiaozhi.me/api/messaging/device/tools/list|call` 需要 messaging token，经云端转发到设备已建立连接上的 MCP 消息。两者鉴权、可见工具集、链路状态与适用阶段不同，不能混作同一入口。
- **`self.system.reboot` 必须确认且延迟执行**：重启类 MCP 调用长期要求 `confirm=true`，并在工具响应返回后延迟 reboot，避免 HTTP/MCP response 尚未完成就切断链路。
- **Launcher / XiaoZhi 两阶段边界**：MoonCake Launcher 阶段负责 UI、`AI.AGENT` 打开、SETUP/手动 OTA 等入口；XiaoZhi runtime 启动后才具备 18080 dev HTTP、MCP tools、小智协议、reminder 等能力。排障时必须先判断设备处于 Launcher 还是 XiaoZhi 阶段。
- **OTA 前半段与 reboot 后验收拆分**：发布/触发 OTA、manifest/active release 更新、远程 reboot 是前半段；reboot 后需另行验收 `/dev/status`、`app_version`、运行态与日志。不要把“已触发/已重启”直接等同于“升级成功”。
- **工具链黄金入口**：本地 OTA/设备检查优先使用仓库 `ops/bin` 下维护的黄金入口（如 `stackchan-ota-release`、`stackchan-doctor`、`stackchan-device-version`），避免临时脚本绕过 app_desc 校验、只读边界、回退和验收逻辑。
- **ReadPos / LVGL / SCS UART 风险**：`ReadPos` 或写前读若在持有 LVGL lock 时阻塞，会放大成黑屏/卡死；SCS UART 事务需串行化、有限超时、少读少写，远控头部/庆祝动作应保持 MCP/HTTP 快速返回与异步调度。
- **SCS 日志禁止 `%lld`**：在启用 nano-vfprintf 的固件配置下，SCS 失败日志不得使用 `%lld` 等 64-bit printf 格式，避免参数消费错位导致 `LoadProhibited` / Guru Meditation boot loop。
