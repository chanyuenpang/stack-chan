# ADR: Servo command chain diagnosis and root-cause repair boundary

## Status

accepted

## Context

决定：当 HTTP/MCP 返回 `ok` 但舵机没有预期物理动作时，后续排查和修复必须以端到端舵机命令链路断点为准，不能把 `ok` 响应当作动作已完成。

原因：已完成计划记录，`/dev/celebrate` 多次 HTTP 200 但现场物理 0 次动作，`set_head_angles` / `set_head_targets` 返回 `ok` 但角度不按目标变化，系统设置里的电机调节也无反应。只读链路梳理确认 HTTP/MCP、`celebrate`、系统设置三条入口最终汇合到底层调度与 `WritePos` 链路；带日志最小动作验证进一步确认断点不在 HTTP/MCP 或调度入口，至少 yaw 轴可到达 `SERVO-DIAG hw_write` 且 `WritePos rc=1`，pitch 因目标被 clamp 后 `same_target` 跳过。

## Decision

决定：舵机无动作类问题的长期修复边界是“保留庆祝动作语义，沿请求入口 → scheduler → servo write → SCS bus 的真实链路定位并修复根因”。

具体规则：

- `/dev/mcp/call`、`/dev/celebrate`、`self.robot.set_head_angles`、`self.robot.set_head_targets` 和系统设置电机调节应按共享底层链路诊断；若多个入口同时无物理动作，应优先看汇合后的 scheduler / servo / bus 层。
- `HTTP 200` 或 MCP 返回 `ok` 只代表入口接收或调度成功，不代表舵机已经完成物理动作。
- 最小动作验证必须对照串口断点日志与现场物理反馈，重点观察 `SERVO-SCHED queued/dispatch`、`SERVO-REQ`、`SERVO-DIAG hw_write`、`WritePos rc`、`bus_healthy`、`bus_dead`、`same_target` 与读回角度变化。
- 如果日志显示请求已到 `hw_write` / `WritePos`，修复应继续追踪总线、目标角度 clamp、same-target 跳过和硬件返回码；不得回退成削弱庆祝动作幅度、降低庆祝节奏、禁用舵机或 no-op 庆祝。
- 修复方案若涉及错误返回语义，应让入口层暴露真实调度 / 写入失败状态，避免继续用 `ok` 掩盖 `WritePos rc=0`、`bus_dead` 或其他底层失败。

## Alternatives Considered

- 只依据 HTTP/MCP `ok` 判定动作链路正常：拒绝。计划完成事实表明入口返回 `ok` 时仍可能没有物理动作，必须结合串口断点与现场反馈。
- 通过降低或削弱庆祝动作幅度 / 节奏来规避问题：拒绝。计划复核明确该方向不满足约束；后续必须解决 `WritePos rc=0` / `bus_dead` 等根因，而不是削弱庆祝动作。
- 把系统设置电机调节与远程 MCP 命令分开排查：拒绝。计划只读梳理确认它们共享底层链路；多入口同时异常时应优先排查汇合后的 motion / servo / bus 层。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_dev_local_control.cpp` | 本地 Dev HTTP `/dev/celebrate`、`/dev/mcp/call` 等入口与调度观察锚点。 |
| `firmware/main/hal/hal_mcp.cpp` | MCP tool 分发与 `self.robot.set_head_angles` / `self.robot.set_head_targets` 入口锚点。 |
| `motion` | 计划记录的 scheduler / motion 汇合层锚点。 |
| `servo` | `Servo::update`、舵机请求处理与 `hw_write` 观察锚点。 |
| `ScsServo::set_angle_impl` | SCS 舵机写入路径锚点。 |
| `_scs_bus.WritePos` | 底层写入返回码、`bus_dead` / `bus_healthy` 诊断锚点。 |

## Consequences

- 正向效果：后续舵机无动作问题可以用同一套断点日志区分入口未达、scheduler 未派发、servo write 未执行、SCS bus 失败、目标被 clamp 或 same-target 跳过。
- 约束：庆祝动作的修复不能以降低动作幅度、降低节奏、禁用舵机或 no-op 作为“稳定性修复”；这些只能掩盖根因。
- 取舍：为了得到真实断点，验证需要至少一次可控的小幅动作、串口日志和现场物理反馈对照，而不能只看 HTTP 响应。
- 验证锚点：计划记录最小 `set_head_targets` 验证中出现 `DEV-HTTP`、`HAL-MCP dispatch`、`SERVO-SCHED queued/dispatch`、`SERVO-REQ`、`SERVO-DIAG hw_write`；`axis_id=1 WritePos rc=1`、`bus_healthy=1`；`axis_id=2` 因 `same_target` 跳过；读回角度从 `yaw=1,pitch=3` 到 action 后 `yaw=6,pitch=3`，back 后 `yaw=0,pitch=3`。

## Search Terms

- `/dev/celebrate`
- `/dev/mcp/call`
- `self.robot.set_head_angles`
- `self.robot.set_head_targets`
- `SERVO-SCHED`
- `SERVO-REQ`
- `SERVO-DIAG hw_write`
- `WritePos rc=0`
- `WritePos rc=1`
- `bus_dead`
- `bus_healthy`
- `same_target`
- `ScsServo::set_angle_impl`
- `_scs_bus.WritePos`
