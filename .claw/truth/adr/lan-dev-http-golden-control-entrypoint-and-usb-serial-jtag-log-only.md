# ADR: LAN Dev HTTP 作为黄金控制入口，USB Serial/JTAG 仅作日志观察口

## Status

accepted

## Context

决定：当前阶段正式以 `LAN Dev HTTP` 作为 StackChan 实机控制与验收的黄金入口，而现有 `USB Serial/JTAG` 不再承担稳定控制职责，只保留为日志观察口；如果后续仍需要 USB 控制，必须转入独立专项并优先评估独立 `USB CDC` 控制接口。

原因：计划《双通道实机收口》已完成，并把以下事实记录为已完成结论：

- `remote_control.py` 中 `prompt-sample short` 已做最小兼容，LAN 下改走当前实机可用的 `/dev/inject_prompt`，实机已返回 `{ok:true, message:"prompt injection started"}`。
- `auto fallback` 已修复为按 CLI 命令名而非内部方法名判定 USB 支持，覆盖 `head`、`led`、`reminder`、`reminders`、`stop-reminder`、`mcp`、`prompt-sample`、`play-sound`、`inject-prompt` 等路径。
- 双通道实机回归后，LAN 主链路可用，但 `USB` 上 `status`、`capabilities` 等基础控制仍因 `/dev/ttyACM0` `write timeout` 失败。
- 已尝试 host 侧最小缓解，包括关闭握手、去 reset buffer、轻量 drain 日志、调整打开参数，但 `usb status` / `usb capabilities` 仍然 `write timeout`，且伴随 boot/reset 日志迹象。
- 调研结论已明确：现有 `hal_dev_serial.cpp` 所承载的 `USB Serial/JTAG` 天然更适合作日志口，不适合作为稳定控制口；若必须保留 USB 控制，应在下一阶段优先评估独立 `USB CDC` 控制接口。

因此，本次不是“USB 还有一点小 bug 待修”，而是控制口与日志口复用导致的结构性边界问题。继续在当前 `Serial/JTAG` 口上做 host 小修，不再被视为本阶段正确方向。

## Decision

决定：

- 当前 StackChan 项目的实机控制与验收主路径统一收敛到 `LAN Dev HTTP`。
- `USB Serial/JTAG` 当前只作为日志观察口，不再作为本阶段控制验收的阻塞项，也不再被视为等价主通道。
- `auto` 模式在控制路径选择上应保持 `LAN first`；当 USB 控制不可用时，可回退到 LAN，但不能假定当前 `USB Serial/JTAG` 具备稳定控制能力。
- `prompt-sample short` 这类控制请求，当前实机兼容路径应以 `/dev/inject_prompt` 为准，而不是坚持走仓库源码预期但与实机暴露路由不一致的旧入口。
- 若后续继续推进 USB 稳定控制，必须先做“控制口/日志口边界分离”的方案选型，再进入 firmware 编码与实机验证；主路线优先评估独立 `USB CDC` 控制接口。
- 在该专项完成前，任何文档、runbook、CLI 或验收口径都不得把当前 `USB Serial/JTAG` 描述为稳定控制入口。

## Alternatives Considered

- 继续在当前 `USB Serial/JTAG` 口上做 host 侧小修并要求其承担稳定控制：拒绝。计划已记录最小缓解无效，且仍出现 `write timeout` 与 boot/reset 日志迹象，说明问题不在 host 参数细节。
- 维持“LAN 与 USB 都是当前阶段等价主通道”的口径：拒绝。实机回归已确认只有 LAN 主链路可收口，USB 控制仍不具备通过条件。
- 因 USB 未通过而继续阻塞当前阶段收口：拒绝。计划已明确采用 B 方案，将 USB 控制从本阶段阻塞项中剥离，转为下一里程碑“USB 稳定控制通道专项”。
- 直接要求 firmware 立刻修复现有 `USB Serial/JTAG` 控制口：拒绝。当前已先确认这是 transport/接口方案问题，必须先做边界与方案设计。

## Related Code

| Path | Role |
| ---- | ---- |
| `StackChan/tools/remote_control/remote_control.py` | host 侧统一控制入口；本次承载 `prompt-sample` 实机兼容、`auto fallback` 命令映射修复与 USB 最小缓解尝试。 |
| `StackChan/firmware/main/hal/hal_dev_serial.cpp` | 当前 `USB Serial/JTAG` 控制口与日志口复用的核心实现，也是结构性边界问题锚点。 |
| `StackChan/firmware/main/hal/hal_dev_local_control.cpp` | `LAN Dev HTTP` 主控制入口；当前阶段黄金控制路径。 |
| `docs/project-status-celebrate.md` | 当前阶段收口口径固化锚点。 |

## Consequences

- 正向效果：当前阶段的实机验收口径被明确收敛，后续不必再把 `USB Serial/JTAG` 控制失败误判为 host CLI 小问题反复空转。
- 约束：今后控制链路验收、runbook 与自动化脚本应默认以 `LAN Dev HTTP` 为主入口描述和验证。
- 取舍：USB 控制能力没有被永久放弃，但被降级为独立里程碑处理；当前阶段不再让其反向绑架 LAN 主通道收口。
- 设计后果：若要恢复 USB 稳定控制，必须先拆分日志口与控制口边界，并优先评估独立 `USB CDC` 控制接口，而不是继续扩展现有 `USB Serial/JTAG` 复用方案。
- 防回归锚点：当 `prompt-sample short`、`auto` 或基础 `status/capabilities` 再次出现双通道不一致时，应先按“黄金入口 / 通道边界”检查是否误把日志口当控制口，而不是默认继续修 CLI 细节。

## Search Terms

- `LAN Dev HTTP`
- `golden control entrypoint`
- `USB Serial/JTAG`
- `log only`
- `write timeout`
- `/dev/ttyACM0`
- `hal_dev_serial.cpp`
- `hal_dev_local_control.cpp`
- `remote_control.py`
- `prompt-sample short`
- `/dev/inject_prompt`
- `auto fallback`
- `LAN first`
- `independent USB CDC control interface`
