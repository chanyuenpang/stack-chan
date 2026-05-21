# ADR: self.robot.celebrate 复用官方 DanceModifier/Timeline

## Status

accepted

## Context

决策是将 `self.robot.celebrate` 从 `firmware/main/hal/hal_mcp.cpp` 中的自研 `CelebrateExecutor` / 手写 tick 路径迁移到官方 `DanceModifier` / `Timeline` 体系，并在该体系内实现专用 `DanceModifier::Celebrate`。原因是庆祝动画需要稳定、可控、符合用户预期且速度为中速；继续在 HAL/MCP 层堆自研动画状态机会扩大状态复杂度，而官方 modifier/timeline 路径更适合作为长期动画边界。

完成计划确认：先用 `DanceModifier::Happy` 验证官方调用链路，再切换为专用 `DanceModifier::Celebrate`；`Happy` 只是阶段性验证，不是最终庆祝效果。最终版本保留 MCP/HTTP 对外接口，清理自研 `CelebrateExecutor`、`CelebrateStyle`、LED/motion/tick 与 `parseCelebrateStyle` 残留；`git diff --check` 和 `idf.py build` 均通过。

后续 2.0.45 OTA 实机验收确认：`/dev/celebrate` 与 `/dev/mcp/call -> self.robot.celebrate` 均走官方 `DanceModifier::Celebrate`，日志锚点为 `action=dance_modifier_celebrate`、`speed=260`、yaw V 形路径、结束回中；设备保持 `idle`，无重启、失联、panic、abort、Guru 或 WDT。真实小智语音会话仍需要现场验收，但若语音路径出现问题，修复边界仍应限定在 `DanceModifier::Celebrate` sequence 或 MCP 调度，不回退自研 `CelebrateExecutor`。

## Decision

`self.robot.celebrate` 的庆祝动画长期实现必须复用官方 `DanceModifier` / `Timeline`，最终入口使用专用 `DanceModifier::Celebrate`，而不是恢复或继续扩展自研 `CelebrateExecutor` tick 状态机。

具体规则：

1. `firmware/main/hal/hal_mcp.cpp` 只负责对外 MCP/HTTP 入口与触发官方 modifier，不再承载自研庆祝动画状态机。
2. `DanceModifier::Happy` 只能作为官方动画系统与调用路径的验证手段，不能被视为最终庆祝效果。
3. 最终庆祝效果应在官方体系内定义 `DanceModifier::Celebrate` sequence，并保持中速舵机节奏；当前完成计划记录的速度锚点为 `speed=260` / `Medium servo speed`。
4. 如果后续实机效果不符合用户标准，应只调整 `DanceModifier::Celebrate` sequence 的动作、LED 或节奏，不恢复自研 `CelebrateExecutor`。
5. MCP/HTTP 对外接口保持兼容；架构迁移限定为内部动画执行路径。

## Alternatives Considered

- 继续在 `hal_mcp.cpp` 堆自研 `CelebrateExecutor` / `CelebrateStyle` / LED / motion / tick 状态机：被拒绝，因为该路径让 HAL/MCP 入口承担动画编排责任，且计划规则明确要求优先复用官方 `DanceModifier` / `Timeline`。
- 把 `DanceModifier::Happy` 作为最终庆祝效果：被拒绝，因为用户标准要求最终庆祝应稳定、可控且中速；`Happy` 仅用于验证官方链路可靠。
- 降低到偏保守速度 `speed=180`：被拒绝，因为它不符合中速标准；最终校正为 `speed=260`。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_mcp.cpp` | `self.robot.celebrate` 入口与官方 `DanceModifier::Celebrate` 触发锚点；不再保留自研 `CelebrateExecutor` tick 路径。 |
| `hal.cpp` | 不再调用自研庆祝 tick 的行为锚点。 |
| `dance.h` | `DanceModifier::Celebrate` sequence、`Medium servo speed` 与 `speed=260` 的定义锚点。 |
| `ops/bin/stackchan-ota-release` | 2.0.45 OTA 发布与 active metadata 校验入口。 |
| `ops/bin/stackchan-device-version` | 设备运行版本与 OTA active 版本一致性校验入口。 |

## Consequences

- 正向效果：庆祝动画所有权从 HAL/MCP 自研状态机收敛到官方 modifier/timeline 体系，后续调整只需维护 `DanceModifier::Celebrate` sequence。
- 兼容边界：`self.robot.celebrate` 的 MCP/HTTP 对外接口保持兼容，调用方不需要因内部动画迁移改变协议。
- 取舍：官方体系内仍需要实机调参；如果动作、LED、结束回中或红灯表现不达标，应继续调整 `DanceModifier::Celebrate`，而不是回退自研状态机。
- 验证锚点：`git diff --check` 通过；source ESP-IDF 后 `idf.py build` 通过；完成计划确认 `firmware/main/hal/hal_mcp.cpp` 已切到 `DanceModifier::Celebrate`，`dance.h` 中 `Celebrate` 为 `Medium servo speed` 且 `speed=260`；2.0.45 OTA 后 `/dev/celebrate` 与 `/dev/mcp/call -> self.robot.celebrate` 双路径验收通过，真实小智语音会话为唯一现场验收项。

## Search Terms

- `self.robot.celebrate`
- `start_celebrate_modifier`
- `CelebrateExecutor`
- `CelebrateStyle`
- `parseCelebrateStyle`
- `DanceModifier`
- `DanceModifier::Happy`
- `DanceModifier::Celebrate`
- `Timeline`
- `Medium servo speed`
- `speed=260`
- `/dev/celebrate`
- `/dev/mcp/call`
- `action=dance_modifier_celebrate`
- `hal_mcp.cpp`
- `hal.cpp`
- `dance.h`
