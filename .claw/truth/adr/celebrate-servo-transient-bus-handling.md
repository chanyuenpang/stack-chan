# ADR: celebrate 舵机 transient 与 bus_dead 分级处理

## Status

accepted

## Context

决策是将 celebrate 的舵机总线异常从单一 `bus_failed` 口径拆成 `bus_dead`、`transient_io_error` 与 `hardware_failure`，并按状态分级处理。原因是实机复现显示：`self.robot.celebrate` 可返回 ok，但舵机总线可能在 `WritePos` ACK/状态包缺失、同步 verify 读风暴、或 idle/post-rest 自动 torque release 后被过早升级为 `bus_dead`，进而触发 recovery、power cycle 或黑屏式无反馈。

本轮 2.0.38 到 2.0.44 的完成任务表明，直接把 transient ACK 缺失当作 bus_dead 会导致庆祝中断；而在总线异常时继续写 servo 或强制 torque disable 也会放大风险。最终 2.0.44 的可接受收束标准是：庆祝可 `duration_complete`，LED/motion 帧完整，设备最终 idle/status ok，无 panic/Guru/WDT/reset/黑屏、无 `bus_failed=1`、无 `bus_dead_escalated_after_transient_timeout`、无 recovery/uart_reinit/power_cycle。

## Decision

庆祝链路必须采用“先安全、再恢复、最后降级告警”的舵机总线策略：

1. `bus_dead` 与 transient ACK/状态包缺失必须分开记录；`ERR_NO_REPLY` 先进入 `ack_missing_cooldown` 与异步 `transient_probe_*`，不得在 `set_angle_impl` 内同步 `ReadPos/Ping` 形成二次读风暴。
2. 位置写入必须有 P0 限流保护：同目标写入 cooldown、`write_ack_missing` 记录、只读 probe 验证、以及双轴 `axis_stagger_wait`/`axis_write_slot_busy` 错峰，不能为了避免失败而降低庆祝动作幅度。
3. `duration_complete` 收尾如果只是 transient-only，使用 `action=no_write_transient`，进入 `transient_passive_cooldown` 与 `no_powercycle=1`；passive 或无真实运动写需求时，probe 失败只能 warning/hold/suppressed，不得升级 `bus_dead`、不得触发 recovery/power_cycle。
4. `torque_enable_skip` 与 `torque_release_skip` 必须区分：新运动/写需求的 torque enable 可算 `active_io_demand`；idle/post-rest 自动释放的 `torque_release_skip` 不算 active demand，避免 cooldown 过期后误触发 `bus_dead_escalated_after_transient_timeout`。
5. `HeadMotionScheduler` 的 `hard_timeout` 只能在总线健康时执行 `motion.release`/torque off；`bus_dead`、transient 或 hardware failure 下必须走 `action=no_write_stop`，避免异常总线状态下强制写入。
6. 如果 preflight/recovery 确认 `bus_dead`，庆祝应给出红灯错误反馈并 no-write，而不是黑屏式灭灯或继续写坏总线。

## Alternatives Considered

- 继续把 `hasHardwareFailure()` 作为 `bus_failed` 统一口径：被拒绝，因为它会把 transient I/O failure 放大为 bus_failed，导致 `duration_complete` 收尾误报和后续 power cycle。
- `ERR_NO_REPLY` 后立即同步 `ReadPos/Ping` 验证：被拒绝，因为实机 2.0.41 显示同步 verify 会形成读风暴，快速升级 `bus_dead_escalated`。
- passive cooldown 固定 8000ms 后恢复 active 升级：被拒绝，因为 2.0.43 显示 cooldown 过期后 `torque_skip` 残留会再次触发 power cycle；最终改为区分 `torque_release_skip` 非 active demand。
- 在异常总线下强制 torque disable/release：被拒绝，因为该策略可能继续写异常总线；最终改为健康才 release，异常时 no-write stop。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/CMakeLists.txt` | `PROJECT_VER` 版本来源；2.0.38 到 2.0.44 发布验证锚点。 |
| `hal_servo.cpp` | 舵机 `WritePos`、ACK missing cooldown、异步 probe、axis stagger、bus recovery、`torque_enable_skip`/`torque_release_skip` 语义锚点。 |
| `ops/bin/stackchan-serial-capture` | 实时串口窗口采集，用于验证 MCP/LED/SERVO/SCHED 日志。 |
| `ops/bin/stackchan-celebrate-diagnose` | 诊断 `bus_dead`、transient、recovery、warning 与 ok/error 结果。 |
| `ops/bin/stackchan-device-version` | 区分设备运行版本、OTA server 版本与 active bin app_desc。 |
| `ops/bin/stackchan-ota-release` | force=0 OTA 发布与 active metadata 校验入口。 |

## Consequences

- 正向效果：2.0.44 已达到安全可接受版本；`self.robot.celebrate` 可完整 `duration_complete`，LED/motion 帧完整，设备最终 idle/status ok。
- 安全边界：总线异常时优先 no-write/no-powercycle，不再把 idle/post-rest 自动 torque release 当作 active I/O demand。
- 取舍：底层 FEETECH/SCS ACK/状态包缺失仍会产生 transient warning，当前不再作为 P0 阻塞；后续可作为 P1/P2 的 ACK/硬件总线专项。
- 验证锚点：2.0.44 实机验收记录 `bus_dead_escalated_after_transient_timeout=0`、`recovery_probe=0`、`uart_reinit=0`、`power_cycle=0`、`bus_failed=1=0`、panic/Guru/WDT/reset/network 均为 0。

## Search Terms

- `finishCelebrateLocked`
- `HeadMotionScheduler`
- `ScsServo::set_angle_impl`
- `ERR_NO_REPLY`
- `ack_missing_cooldown`
- `transient_probe_pending`
- `transient_passive_cooldown`
- `no_powercycle=1`
- `torque_enable_skip`
- `torque_release_skip`
- `active_io_demand`
- `bus_dead_escalated_after_transient_timeout`
- `axis_stagger_wait`
- `axis_write_slot_busy`
- `no_write_transient`
- `no_write_stop`
