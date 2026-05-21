# ADR: celebrate 完成判定与帧推进门控

## Status

accepted

## Context

决策是让 `self.robot.celebrate` 的正常完成必须同时受时间保护、帧进度保护和上一帧完成保护约束。原因是小智 MCP 触发庆祝时曾出现一两秒红灯卡住：定位结论显示该现象与 `preflight_bus_dead` / `bus_dead` 异常提前结束高度吻合；如果完成判定只依赖固定时间线或过早认为动作完成，可能在上一帧动画/调度尚未结束时压入下一帧，导致庆祝被提前收束或错误进入 aborted 路径。

完成计划确认：`firmware/main/hal/hal_mcp.cpp` 已加入 `expected_end`、`min_finish`、`step_index` 三条件保护，并继续改为上一帧动画/调度结束后再推进下一帧；构建验证为 `idf.py build` 通过。

## Decision

`self.robot.celebrate` 的完成语义采用“正常完成严格门控，异常完成显式 aborted”的策略：

1. 正常完成必须满足 `expected_end`、`min_finish`、`step_index`，不能只因时间推进或局部状态变化就提前结束。
2. 帧推进必须采用 `frame_done_gated`：提交帧后等待 scheduler 非高刷新且 motion 非 moving，再满足最小间隔才提交下一帧。
3. 每帧仍保留最大等待超时；若触发 `bus_dead`、`preflight_bus_dead` 或 `timeout`，必须优先中止并记录为 aborted，而不是伪装为 normal completion。
4. 庆祝动作本身和幅度保持不变；修复点限定在完成判定与帧推进语义，不通过降低动作幅度规避问题，也不主动 toggle 小智会话状态。

## Alternatives Considered

- 继续使用纯固定时间线推进帧：被拒绝，因为上一帧未到位时会压下一帧，无法保证庆祝动作真实完成。
- 仅加入最终完成时间保护：被拒绝，因为它只能防止过早宣布整体完成，不能防止帧间推进过快。
- 通过降低庆祝动作幅度绕开风险：被拒绝，因为计划规则要求庆祝动作和幅度保持不变，问题应由调度与完成判定修复。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_mcp.cpp` | `self.robot.celebrate` 完成判定、帧推进门控、normal/aborted 日志语义锚点。 |

## Consequences

- 正向效果：庆祝正常完成不再只依赖固定时间线，必须等到预期结束时间、最小完成时间、帧索引和上一帧软件动作完成条件都满足。
- 可靠性边界：`bus_dead`、`preflight_bus_dead`、`timeout` 明确为 aborted，便于实机观察红灯异常与正常完成的区别。
- 取舍：每帧增加最大等待超时，动作推进可能比固定 `750ms` 时间线更保守，但能避免未到位时压下一帧。
- 验证锚点：`git diff --check` 通过；source ESP-IDF export 后 `idf.py build` 完整通过并生成 `stack-chan.bin`。后续实机 OTA 需观察 `celebrate_frame_schedule` / `done` 顺序以及是否仍出现红灯 aborted。

## Search Terms

- `self.robot.celebrate`
- `expected_end`
- `min_finish`
- `step_index`
- `frame_done_gated`
- `celebrate_frame_schedule`
- `done`
- `preflight_bus_dead`
- `bus_dead`
- `timeout`
- `finish_type=normal`
- `finish_type=aborted`
