# ADR: Inject prompt uses default listening mode for chat-state recovery

## Status

accepted

## Context

决定：`/dev/inject_prompt` 结束后必须让设备回到默认聊天 / 收音状态，而不是把状态机留在 `ManualStop` 语义里。

原因：已完成计划确认，`self.robot.celebrate` 与 `set_led_color`、`get_head_angles`、`set_head_angles`、`reminder` 等 MCP 工具一样，不直接修改 listening / speaking / chat 状态。庆祝 MCP 后落到 `idle` 的关键差异不在 `self.robot.celebrate`，而在 `inject_prompt` 曾使用 `StartListening` → `StopListening`，该路径会留下 `ManualStop` 模式；随后 TTS stop 时，状态机从 `speaking` 回落到 `idle`，而不是继续回到 listening / chat / 收音相关状态。

## Decision

决定：`/dev/inject_prompt` 的长期状态机契约是使用默认 `AutoStop` / `Realtime` listening 模式注入提示，并且注入结束不再调用 `StopListening` 做收尾。

具体规则：

- 新增并使用 `StartListeningDefaultMode()`，保留原 `StartListening` / `StopListening` 的既有语义，不用全局改动来修复单个注入入口。
- `inject_prompt` 改用默认模式启动 listening，使后续 TTS / MCP 工具链路能按正常聊天状态恢复。
- `inject_prompt` 结束时不再调用 `StopListening`，避免把状态机切入或残留在 `ManualStop` 语义。
- 庆祝动作本身不是本问题的修复点；不得通过修改 `self.robot.celebrate` 动作幅度、节奏、帧序列，或处理 `bus_dead` / `no_write` 来掩盖状态机问题。

## Alternatives Considered

- 修改 `self.robot.celebrate`：拒绝。计划只读对比确认庆祝工具与其他 MCP 工具一样不直接改状态，修复点不在 celebrate。
- 继续使用 `StartListening` → `StopListening`：拒绝。该组合会产生 `ManualStop` 模式残留，导致 TTS stop 后 `speaking` → `idle`。
- 改庆祝动作幅度 / 节奏 / 帧序列或处理 `bus_dead`：拒绝。计划目标明确排除这些方向，它们与 MCP 后聊天状态恢复无关。

## Related Code

| Path | Role |
| ---- | ---- |
| `/dev/inject_prompt` | 本次状态模式修复入口；计划未记录具体源码文件路径。 |
| `StartListeningDefaultMode()` | 默认 `AutoStop` / `Realtime` listening 模式 helper。 |
| `StartListening` | 原有 listening 入口，保留既有语义，不作为本次全局修复目标。 |
| `StopListening` | 原有停止入口；`inject_prompt` 不再以它作为结束收尾。 |
| `self.robot.celebrate` | 对照 MCP 工具；确认不直接修改 listening / speaking / chat 状态。 |

## Consequences

- 正向效果：庆祝 MCP 或其他经 `inject_prompt` 触发的链路完成后，应回到正常 listening / chat / 收音相关状态，而不是停在 `idle`。
- 约束：后续改动 `/dev/inject_prompt` 时，不能重新引入 `StartListening` → `StopListening` 导致的 `ManualStop` 模式残留。
- 取舍：`StartListening` / `StopListening` 的原语义被保留；需要默认聊天恢复语义的入口必须显式选择 `StartListeningDefaultMode()`。
- 验证锚点：计划静态验证已确认 `inject_prompt` 改用 `StartListeningDefaultMode()` 且不再 `StopListening`；未修改 `celebrate` / `bus_dead`。整体验证因工作区存在其他历史未提交改动标记 FAIL，后续仍需 OTA 实机日志验证 `speaking` → `listening`。

## Search Terms

- `/dev/inject_prompt`
- `StartListeningDefaultMode()`
- `StartListening`
- `StopListening`
- `ManualStop`
- `AutoStop`
- `Realtime`
- `speaking→idle`
- `speaking→listening`
- `self.robot.celebrate`
- `set_led_color`
- `get_head_angles`
- `set_head_angles`
- `reminder`
