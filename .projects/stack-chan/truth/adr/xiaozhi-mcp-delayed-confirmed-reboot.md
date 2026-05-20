# ADR: XiaoZhi MCP delayed confirmed reboot

## Status

accepted

## Context

决定：小智态远程重启必须作为受确认保护的 MCP 工具接入，而不是让任意远程调用直接触发 `esp_restart()`。

原因：已完成计划要求新增 Xiaozhi/MCP 可调用的 `self.system.reboot`，用于远程重启并触发 OTA 自动升级 / 首启链路。该能力具有设备可用性风险，因此计划明确安全边界：`confirm=true` 才执行；MCP callback 必须先返回响应，再由 FreeRTOS task/timer 延迟重启；不刷机、不擦除、不覆盖 NVS，也不产生 OTA 以外副作用。后续本地 Dev HTTP 收尾已按最小改动把同一 `self.system.reboot` 接入 `/dev/mcp/call` dispatcher 与 `remote_control.py reboot --confirm` CLI，没有新增独立 `/dev/reboot` route。

## Decision

决定：`self.system.reboot` 的长期调用契约是“显式确认 + 延迟执行 + 无持久副作用”。

具体规则：

- 工具注册在 `firmware/main/hal/hal_mcp.cpp::Hal::xiaozhi_mcp_init()`，名称为 `self.system.reboot`。
- 参数包含 `confirm`、`delay_ms`、`reason`。
- `confirm=false` 必须安全拒绝，返回 `confirm_required`，不得 schedule 重启。
- `confirm=true` 才能创建 `mcp_reboot` 延迟任务 / timer。
- MCP callback 不得直接调用 `esp_restart()`；必须先返回 `{accepted:true, delay_ms:<value>}` 一类响应，再由延迟 task 执行 `esp_restart()`。
- `delay_ms` 必须限制在合理范围内。
- `reason` 只用于日志，并需要截断 / 清理，不能驱动额外副作用。
- 工具不得写 NVS、不得触发 flash / erase、不得覆盖配置；远程重启只负责重启设备，让既有 OTA / 首启链路继续负责升级状态推进。
- 本地 LAN Dev HTTP `/dev/mcp/call` 已通过 `stackchan_mcp_dispatch_tool()` 单独接入 `self.system.reboot`；这不是复用 MCP server 注册层自动分发，而是本地 dispatcher 的显式分支。
- 本地 dispatcher 与 MCP 注册层必须保持同一安全契约：读取 `confirm` / `delay_ms` / `reason`，`confirm=false` 返回 `confirm_required` 且不调度重启，`delay_ms` clamp 到 `500..10000ms`，成功才复用 `scheduleSystemReboot()`。
- 本地 HTTP reboot 响应应保持结构化 JSON：成功 `{"accepted":true,"delay_ms":...,"reason":"..."}`，未确认 `{"accepted":false,"error":"confirm_required",...}`，调度失败 `{"accepted":false,"error":"schedule_failed",...}`；`reason` 输出必须经过 JSON escape，避免 `"` / `\` 破坏响应。
- `tools/remote_control/remote_control.py` 已能表达完整 `self.*` tool name；`get_head_angles` 等旧 shorthand 仍走 `self.robot.*`，但 `self.system.reboot` 会原样传给 `/dev/mcp/call`。
- CLI 的稳定入口是 `python3 tools/remote_control/remote_control.py reboot --confirm`，默认 `--delay-ms 1500`、`--reason remote_control`；未显式 `--confirm` 必须在 CLI 侧拒绝，不发出重启调用。
- 当前仍没有独立 `/dev/reboot` route；除非出现明确需求，不应为了重启再新增一条绕过 MCP confirm 语义的 HTTP 控制面。

## Alternatives Considered

- 不加确认参数直接重启：拒绝。计划完成事实要求 `confirm=false` 可安全验证并返回 `confirm_required`，防止误调用造成设备重启。
- 在 MCP callback 中同步 `esp_restart()`：拒绝。计划完成事实要求先返回 MCP 响应，再延迟重启，避免调用方拿不到 accepted 响应。
- 把 reboot 工具顺手写 NVS、触发 OTA 或修改配置：拒绝。计划明确“不刷机、不擦除、不覆盖 NVS”，重启工具只提供远程重启能力。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_mcp.cpp` | `Hal::xiaozhi_mcp_init()` 注册 `self.system.reboot`；`scheduleSystemReboot` 与 `systemRebootTask` 承担确认后延迟重启；`stackchan_mcp_dispatch_tool()` 是本地 `/dev/mcp/call` 分发层，已显式接入 `self.system.reboot` 并复用同一确认/延迟契约。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | `mcp_call_handler()` 解析 `/dev/mcp/call` 的 `{tool, arguments}` 后调用 `stackchan_mcp_dispatch_tool()`；当前没有独立 `/dev/reboot` route。 |
| `tools/remote_control/remote_control.py` | `StackChanClient.mcp_call()` 支持完整 `self.*` tool name；`reboot --confirm` 子命令调用 `self.system.reboot`，默认 `delay_ms=1500`、`reason=remote_control`。 |

## Consequences

- 正向效果：OpenClaw / 小智 / MCP 侧可以在设备已升级到包含该工具的固件后，远程触发一次受控重启，用于衔接 OTA 自动升级和首启链路。
- 约束：后续扩展 `self.system.reboot` 时，必须保留 `confirm=false` 安全拒绝、`confirm=true` 延迟 task 执行、callback 先返回响应、无 NVS/flash/erase 副作用这些边界。
- 本地化约束：LAN Dev HTTP reboot 的权威入口是 `/dev/mcp/call` + `self.system.reboot` + `confirm=true`，CLI 权威入口是 `remote_control.py reboot --confirm`；不需要新造 MCP 注册层，也不建议默认新增独立 `/dev/reboot`。
- 取舍：首次从不含该工具的版本升级时，不能依赖该工具触发重启；必须等设备升级到包含 `self.system.reboot` 的固件后再实机验证工具。
- 验证锚点：计划静态验证记录 `self.system.reboot` 注册层与本地 dispatcher 均在 `hal_mcp.cpp`；`esp_restart` 仅在 `systemRebootTask` 内；`scheduleSystemReboot` 仅由 `confirm=true` 分支调用；`confirm=false` 分支无 schedule / 重启。本地收尾验证覆盖 `python3 -m py_compile StackChan/tools/remote_control/remote_control.py` 与 firmware build；未连接设备、未调用 `/dev/mcp/call`、未触发重启/OTA/NVS/刷机。
- 构建锚点：候选包构建命令为 `idf.py -B build-active-release-2.0.35 build`，`stack-chan.bin` size=`3971616`，sha256=`7301fccd58e355d6949b4e0aa3f6c10d9faebdf39ea3d56a9de232a7a85530b1`。

## Search Terms

- `self.system.reboot`
- `Hal::xiaozhi_mcp_init()`
- `firmware/main/hal/hal_mcp.cpp`
- `confirm`
- `delay_ms`
- `reason`
- `confirm_required`
- `schedule_failed`
- `jsonEscape()`
- `remote_control.py reboot --confirm`
- `mcp_reboot`
- `scheduleSystemReboot`
- `systemRebootTask`
- `esp_restart`
- `ota_first_boot`
- `stackchan_mcp_dispatch_tool()`
- `/dev/mcp/call`
- `/dev/reboot`
- `StackChanClient.mcp_call()`
- `self.robot.{tool}`

