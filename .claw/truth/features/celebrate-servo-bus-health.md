# StackChan celebrate 收尾与舵机总线健康语义

## 结论

`celebrate` 收尾路径必须区分明确 `bus_dead` 与近期/瞬态 I/O 异常：只有 backend 明确声明 `bus_dead` 才记录 `bus_dead=1`；仅有 transient I/O 时应保守不写舵机、记录 `action=no_write_transient transient_io_error=1 bus_dead=0`。`duration_complete` 后的 transient-only 收尾还必须进入短期 passive cooldown，避免后台 transient probe 在无主动运动/写入需求时把 ACK missing timeout 升级为 power-cycle / `bus_dead`。在 `WritePos` ACK 缺失场景下，第一帧失败不能立刻等同于总线死亡：当前长期策略是先进入 per-axis transient cooldown，停止同步 `ReadPos` / `Ping` verify，等冷却到期后由 `update()` / recovery service 做异步单轴 probe；只有存在 active motion/write demand 且 transient 持续足够久、多次 probe 失败，才升级为 `bus_dead`。

## 长期行为 / 规则

- `Servo::hasBusDead()` / `Motion::hasBusDead()` 是窄口径信号，只表示舵机 backend 已明确声明总线死亡。
- `Servo::hasTransientIoError()` / `Motion::hasTransientIoError()` 是近期/瞬态 I/O 异常信号，典型来源包括 `_consecutive_bus_failures > 0`、`read_pos` fail、`read_move` fail、`_write_ack_missing_count > 0`，以及 ACK missing 后的 transient probe pending / hold 状态；它不等同于 `bus_dead`。
- `hasHardwareFailure()` 保留为宽口径 unhealthy 聚合：`hasBusDead() || hasTransientIoError()`。调用方如果需要区分真实 `bus_dead` 与 transient conservative no-write，不能只看 `hasHardwareFailure()`。
- `finishCelebrateLocked()` 收尾分三类：
  - `bus_dead=true`：`action=no_write bus_dead=1 ...`，然后 `motion.stop()`。
  - 仅 `transient_io_error=true`：`action=no_write_transient bus_dead=0 transient_io_error=1 ...`，然后 `motion.stop()`，并调用 `Motion::enterTransientPassiveCooldown(8000, "celebrate_finish_duration_complete")` 同时让 yaw / pitch 进入 passive no-powercycle 窗口。
  - healthy：通过 `submitHeadMotion(... yaw=0 pitch=0 speed=120)` 走回中路径，日志写 `action=scheduler_queue bus_dead=0 transient_io_error=0 hardware_failure=0`。
- `WritePos` ACK 缺失要先走 transient cooldown，而不是立即累计普通 `record_bus_failure()` 三次阈值，也不是在 `set_angle_impl()` 同步路径里马上 `ReadPos` / `Ping` verify。
- `rc <= 0` 且 `_scs_bus.getLastError() == ERR_NO_REPLY` 时，写失败路径只记录 `event=write_ack_missing`，随后执行 `_scs_bus.waitTxDone()` 与 `_scs_bus.flushInput()`，并设置 per-axis transient 字段：`_transient_probe_pending`、`_transient_quiet_until_ms`、`_transient_probe_due_ms`、`_transient_hold_until_ms`、`_transient_probe_fail_count`。
- transient 状态下必须保守避免硬件 I/O 风暴：
  - `set_angle_impl()` 不写舵机。
  - `setTorqueEnabled()` 不写。
  - `rotate()` PWM 不写。
  - `getCurrentAngle()` 返回 fallback，不同步读位置。
  - `hasTransientIoError()` 返回真，供上层收尾或诊断识别。
- transient probe 由 `ScsServo::update()` 与 `serviceBusRecoveryProbe()` 异步服务；只有到达 `_transient_probe_due_ms` 后才执行。
- 异步 probe 是单轴、限频的：全局 `_verify_probe_slot_owner` / `_verify_probe_slot_ms` 限制两个轴在同一个 tick 或过近时间内连续 probe，slot 间隔约 `200ms`；命中时记录 `verify_slot_busy` / `transient_probe_deferred`。
- probe 优先只执行 `Ping`；`Ping` 成功即认为 bus alive，记录 `transient_probe_ok`，不再额外频繁 `ReadPos`。
- transient probe 失败不会走普通三次 `record_bus_failure()` 阈值；失败时记录 `transient_probe_failed_hold`，延长 hold/cooldown，并增加 `probe_fail_count`。
- passive / no-powercycle 窗口内，`service_transient_probe()` 的 `Ping` 成功会清除 transient 与 passive 状态；`Ping` 失败只记录 hold / warning，不设置 `_bus_dead`、不进入 recovery stage，也不触发 power cycle。
- transient timeout 时，如果仍处于 passive 窗口，或没有 active motion/write demand，应记录 `transient_timeout_suppressed` 并保持 warning / hold 语义，不升级 `bus_dead`。
- active demand 判定至少包括 `_angle_anim.done() == false`，或当前 transient reason 是 `write_skip` / `torque_skip` / `pwm_skip` 这类主动写入/运动需求；无 active demand 的后台 probe timeout 不能触发 power-cycle。
- 只有存在 active motion/write demand，同时满足 transient 持续时间 `>= 2500ms` 且 `probe_fail_count >= 5`，才升级为 `bus_dead`，日志使用 `bus_dead_escalated_after_transient_timeout`。
- 同一 `mapped_angle/raw target` 在 `kWriteAttemptCooldownMs = 200ms` 内不重复 `WritePos`。失败前就要记录 `_last_attempted_raw` / `_last_attempted_angle` / `_last_attempted_ms`，否则第一帧 ACK 缺失后 `_last_written_*` 不更新，`Servo::update()` 会约每 20ms 重写同一目标并快速触发误判。
- yaw/pitch 双轴在同一 `Motion::update()` tick 内的调用顺序是 `_yaw_servo->update()` 后 `_pitch_servo->update()`；`Servo::update()` 每轴最多 50Hz，动画未结束时会调用 `set_angle_impl(...)`，`ScsServo::set_angle_impl()` 最终进入硬件 `WritePos(...)`。
- 双轴错峰只作用在实际硬件 `WritePos` 前：`kAxisWriteStaggerWindowMs = 100` 表示任意轴成功写入后记录 slot owner 与时间，另一个轴在窗口内命中 `reason=axis_write_slot_busy` 时跳过本 tick 的硬件写入，等待后续 `Servo::update()` 再尝试。
- 错峰逻辑必须排在原有保护之后、实际 `WritePos` 之前：`bus_dead` no-write、write interval、ACK missing cooldown、transient no-write 等保护仍然先执行；错峰不是替代总线健康保护。
- 明确升级为总线死亡时日志使用 `event=bus_dead_escalated_after_transient_timeout` 或语义等价的 bus-dead escalation 字段，避免和瞬态 `write_ack_missing` / `write_backoff` 混淆。
- 旧固件日志里的 `bus_failed=1` 曾同时覆盖真实 `bus_dead` 与 transient/recent I/O；调查 2.0.39 及更早日志时要按 legacy 字段理解，不要直接等同于当前 `bus_dead=1`。

## 庆祝触发与完成语义

- `start_celebrate_modifier()` / `self.robot.celebrate` / `/dev/celebrate` 的返回值只表示庆祝已排队或已触发，不表示机器人动作已经完成。上层日志或 UI 不应把“工具返回 ok”“已触发”翻译成“庆祝完成”。
- `g_celebrate_active` 是庆祝 executor 的 active latch；真正清空发生在 `finishCelebrateLocked()`，它可能代表正常完成，也可能代表 `bus_dead`、`preflight_bus_dead` 或 `timeout` 异常中止。
- `stackchan_celebrate_tick()` 的正常完成长期锚点是 `duration_complete`，但不能只看 `elapsedMs >= duration_ms`。正常完成必须同时满足时间线到达 `expected_end_ms`、最短保护到达 `min_finish_ms`、以及 `step_index >= kMotionFrameCount`，避免小智/上层把庆祝动作帧尚未跑完的状态误判为完成。
- `Pending -> Running` 时庆祝 executor 会初始化完整时间线：`start_ms = nowMs`，`last_motion_frame_due_ms = start_ms + (frame_count - 1) * kCelebrateFrameBeatMs`，`expected_end_ms = max(start_ms + duration_ms, last_motion_frame_due_ms + kCelebrateSettleAfterLastFrameMs)`，`min_finish_ms = max(start_ms + kCelebrateMinFinishMs, last_motion_frame_due_ms + kCelebrateSettleAfterLastFrameMs)`。典型 5 帧动作节拍为 `0ms`、`750ms`、`1500ms`、`2250ms`、`3000ms`，最后一帧后还要留 `500ms` settle。
- `finishCelebrateLocked()` 的结束语义应显式区分 `finish_type=normal` 与 `finish_type=aborted`：只有 `duration_complete` 是 normal；`bus_dead`、`preflight_bus_dead`、`timeout` 都属于 aborted。日志字段 `elapsed_ms`、`expected_end_ms`、`min_finish_ms`、`step_index` 是调查“过早完成/异常中止被误认为完成”的主证据。
- `HeadMotionSchedulerModifier` 的单帧释放不是整个庆祝完成判定：`!_has_pending && _active && !moving` 后的 release/destroy 只说明当前头部动作已释放，后续庆祝帧仍由 executor 的 `step_index` / `next_frame_ms` 推进。
- `ScsServo::is_moving_impl()` 在 `kReadMoveEnabled=false` 时不读取硬件 moving 状态，`Servo::isMoving()` 主要依赖 `_angle_anim.done()`；因此不能把 scheduler 很快释放误认为整个庆祝已完成。
- 1~2 秒后红灯卡住时，优先调查 `preflight_bus_dead`：庆祝开始前如果 `motion.hasBusDead()` 持续到 `kBusPreflightTimeoutMs=1800`，`finishCelebrateLocked(..., "preflight_bus_dead")` 会进入红灯错误模式。Running 过程中 `hasBusDead()` 也会立即以 `bus_dead` 中止并红灯。
- 上层小智 completion event 与机器人动作完成没有绑定：`xiaozhi-mcp-bridge` 的 `should_celebrate` 只按 OpenClaw completion event 的 `completed_at + ttl_seconds` 判断是否该触发庆祝，不等待设备动作完成。
- 如果需要对外暴露“庆祝是否正常完成”，应区分 normal complete 与 aborted/error：建议状态字段保留 `celebrate_active`、`celebrate_started_ms`、`celebrate_expected_end_ms`、`celebrate_last_reason`、`celebrate_completed_normally`，避免外部仅凭 active=false 把异常中止当作完成。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_mcp.cpp`：`CelebrateExecutor` 时间线状态、`finishCelebrateLocked()` 的 celebrate 收尾决策与日志字段；`stackchan_celebrate_tick()` 在 `duration_complete`、`bus_dead`、`preflight_bus_dead`、`timeout` 等原因下进入收尾。调查过早完成时优先看 `expected_end_ms`、`min_finish_ms`、`last_motion_frame_due_ms`、`step_index`、`finish_type`。
- `firmware/main/hal/hal_servo.cpp`：`ScsServo` 的 `isBusDead()`、`hasTransientIoError()`、`hasHardwareFailure()` 具体来源；也是 ACK missing transient cooldown、per-axis transient probe 状态、异步单轴 probe、`verify_slot_busy`、`transient_probe_failed_hold`、`bus_dead_escalated_after_transient_timeout`、双轴 `WritePos` 错峰 slot 与 `axis_stagger_wait` 诊断日志的主锚点。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/stackchan/motion/servo.h` | `Servo` 抽象接口，定义 `hasBusDead()`、`hasTransientIoError()`、`hasHardwareFailure()` 的语义边界。 |
| `firmware/main/stackchan/motion/motion.h` | `Motion` 对外暴露舵机健康接口，提醒宽/窄口径区别；声明 `Motion::enterTransientPassiveCooldown(...)` 聚合入口。 |
| `firmware/main/stackchan/motion/motion.cpp` | 聚合 yaw/pitch servo 健康状态；`Motion::update()` 固定先更新 yaw 再更新 pitch，是双轴同 tick 连续写入的上游顺序；`Motion::stop()` 在硬件 unhealthy 时走 `abortAnimationNoRead()`；`Motion::enterTransientPassiveCooldown(...)` 同时作用 yaw / pitch。 |
| `firmware/main/hal/hal.cpp` | 主循环先 `motion.update()` 再调用 `stackchan_celebrate_tick(GetStackChan(), now_ms)`；也是高刷新 active 判断的上游。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | `/dev/celebrate` 与 `/dev/mcp/call` 本地 HTTP 入口；`/dev/status` 是未来暴露 `celebrate_active` / `celebrate_last_reason` 的合适位置。 |
| `tools/remote_control/remote_control.py` | `celebrate()` 调用 `/dev/celebrate`，`cmd_celebrate()` 只应表达“已触发”，不要表达“已完成”。 |
| `tools/xiaozhi-mcp-bridge/bridge.mjs` | OpenClaw completion event 到小智 MCP bridge 的 TTL 判断链路；`should_celebrate` 不是机器人动作完成信号。 |
| `ops/bin/stackchan-celebrate-diagnose` | 只读日志诊断脚本，识别 legacy `bus_failed=1`、当前 `bus_dead=1`、`transient_io_error=1` 与 `action=no_write_transient`。 |

## 真实调用链路

1. 小智 MCP 内置工具 `self.robot.celebrate`、本地 `/dev/celebrate`、本地 `/dev/mcp/call` 都会进入 `start_celebrate_modifier()`；这些入口返回 ok 只表示触发/排队成功。
2. `start_celebrate_modifier()`：设置 `g_celebrate_active` 和 `g_celebrate_executor`，记录 `celebrate queued` / `source=celebrate_start`，并初始化 `Pending`、`duration_ms`、`step_index` 等状态。
3. `firmware/main/hal/hal.cpp` 主循环：`motion.update()` 后调用 `stackchan_celebrate_tick(GetStackChan(), now_ms)`，庆祝推进不由 HTTP/MCP 调用同步等待。
4. `stackchan_celebrate_tick()`：`Pending` 下先做 bus preflight；正常进入 `Running` 时初始化 `last_motion_frame_due_ms`、`expected_end_ms`、`min_finish_ms`。随后按 `kCelebrateFrameBeatMs=750` 调度头部动作帧，并按 LED beat 闪灯。
5. 正常完成门控：只有同时满足 `nowMs >= expected_end_ms`、`nowMs >= min_finish_ms`、`step_index >= kMotionFrameCount` 时，才允许以 `duration_complete` 调用 `finishCelebrateLocked()`。这条门控专门防止仅由 `duration_ms` 或单帧 scheduler release 触发过早完成。
6. 异常中止路径：`preflight_bus_dead`、`bus_dead`、`timeout` 仍可提前调用 `finishCelebrateLocked()`，但日志应标记 `finish_type=aborted`，且安全边界是不继续写 servo。
7. `finishCelebrateLocked()`：先读取 `motion.hasBusDead()`、`motion.hasTransientIoError()`、`motion.hasHardwareFailure()`，再决定 no-write / transient no-write / 回中调度，并输出 `finish_type`、`elapsed_ms`、`expected_end_ms`、`min_finish_ms`、`step_index`。
8. transient-only `duration_complete` 收尾：`finishCelebrateLocked()` 在 `action=no_write_transient` 后调用 `motion.stop()`，再通过 `Motion::enterTransientPassiveCooldown(8000, "celebrate_finish_duration_complete")` 给 yaw / pitch 设置 passive no-powercycle 窗口。
9. `Motion::hasBusDead()` / `Motion::hasTransientIoError()`：聚合 yaw 与 pitch 的 `Servo` 健康状态。
10. `ScsServo::hasTransientIoError()`：由近期读写失败、ACK missing 计数、transient probe pending/hold 等状态判断 transient/recent I/O；`ScsServo::isBusDead()` 才代表明确 bus dead latch。
11. `Motion::update()`：每个 tick 先 `_yaw_servo->update()` 再 `_pitch_servo->update()`；两轴动画目标可同 tick 更新。
12. `Servo::update()`：每轴最多约 50Hz；动画未结束时调用 `set_angle_impl(...)`，由 HAL backend 进入具体舵机写入。
13. `ScsServo::set_angle_impl()` / `WritePos` 路径：先经过 `bus_dead`、write interval、ACK missing cooldown、transient no-write 等保护；同一 raw target 在 `kWriteAttemptCooldownMs` 内命中 `reason=write_backoff action=write_backoff`，避免 ACK 缺失时因 `_last_written_*` 未更新而持续 20ms 级重写。
14. `ERR_NO_REPLY` 写失败处理：记录 `write_ack_missing`，执行 `_scs_bus.waitTxDone()` / `_scs_bus.flushInput()`，设置 `_transient_probe_pending`、`_transient_quiet_until_ms`、`_transient_probe_due_ms`、`_transient_hold_until_ms`、`_transient_probe_fail_count`，不在同步路径立即 `ReadPos` / `Ping`。
15. `ScsServo::update()` / `serviceBusRecoveryProbe()`：到达 `probe_due` 后服务 pending probe；如果全局 `_verify_probe_slot_owner` / `_verify_probe_slot_ms` 显示另一个轴刚 probe，则记录 `verify_slot_busy` 或 `transient_probe_deferred` 并延后。
16. transient probe 执行：优先 `Ping` 当前轴；成功记录 `transient_probe_ok` 并解除 transient / passive；失败时如果处于 passive no-powercycle 或无 active demand，只记录 `transient_probe_failed_passive` / hold / warning，不进入 recovery / power-cycle。
17. transient timeout 抑制：处于 passive 窗口或无 active motion/write demand 时记录 `transient_timeout_suppressed`，不能升级 `bus_dead`。
18. bus-dead 升级：只有存在 active motion/write demand、transient 持续 `>= 2500ms` 且 `probe_fail_count >= 5` 时，记录 `bus_dead_escalated_after_transient_timeout` 并进入明确 bus dead。
19. `try_acquire_axis_write_slot(...)`：在实际 `WritePos` 前检查全局 position write slot；如果另一个轴在 `kAxisWriteStaggerWindowMs` 窗口内刚写过，则记录 `event=axis_stagger_wait reason=axis_write_slot_busy action=no_write`，本 tick 不执行硬件写入。
20. `record_axis_write_slot(now_ms)`：实际 `WritePos` 成功发出后记录 `_axis_write_slot_owner` 与 `_axis_write_slot_ms`，供另一轴后续错峰判断。
21. `stackchan-celebrate-diagnose`：离线扫描串口日志，将新旧字段拆成不同 signals，避免把 transient warning 误判成当前 bus_dead error。
## 不要改错的位置

- 不要把所有 `hasHardwareFailure()` 调用都改成 `hasBusDead()`：`hasHardwareFailure()` 仍是有价值的宽口径安全信号，例如 stop/release 路径需要在 unhealthy 时避免读写硬件。
- `finishCelebrateLocked()` 这种需要解释日志语义的路径必须拆开 `hasBusDead()` 与 `hasTransientIoError()`；否则 transient I/O 会再次被误报为真实总线死亡。
- `bus_failed=1` 是 legacy 检索词，保留给诊断旧日志；当前收尾日志应优先使用 `bus_dead`、`transient_io_error`、`hardware_failure`。
- 不要只依赖 `_last_written_raw` / `_last_written_angle` 抑制重复写：ACK 缺失时写入不算成功，这两个字段可能不会更新；重复写保护必须看 `_last_attempted_*`。
- 不要把 `ERR_NO_REPLY` 的 `WritePos rc <= 0` 直接当作 `bus_dead`：FEETECH/SCS 写指令缺 ACK 可能只是 transient，必须先进入 cooldown，并通过后续异步 probe 判断是否恢复。
- 不要把 `start_celebrate_modifier()`、`self.robot.celebrate`、`/dev/celebrate` 的 ok 返回当作庆祝完成；它们只是触发入口，真正完成/中止原因要看 `finishCelebrateLocked()` 和 `celebrate_last_reason` 类状态。
- 不要把 `HeadMotionSchedulerModifier` 的单帧 release 当作整个庆祝完成；它只是释放当前 servo 动作调度，庆祝 executor 仍可能继续按 `step_index` 发送后续帧。
- 不要把 `duration_ms` 当作唯一正常完成条件；庆祝完成还必须等最后动作帧提交并 settle，即同时满足 `expected_end_ms`、`min_finish_ms` 与 `step_index >= kMotionFrameCount`。
- 不要把 `finishCelebrateLocked()` 后的 `g_celebrate_active=false` 直接翻译成正常完成；必须看 `finish_type=normal|aborted` 与 `duration_complete` / `bus_dead` / `preflight_bus_dead` / `timeout`。
- `xiaozhi-mcp-bridge` 的 `computeCompletionEventTiming()` / `should_celebrate` 是 OpenClaw 完成事件 TTL 判断，不是设备动作完成判定；不要在 bridge 层伪造“机器人庆祝完成”。
- 不要在 `set_angle_impl()` 同步路径里重新加入立即 `ReadPos` / `Ping` verify；这会把写失败、读确认和双轴同 tick 压力重新耦合起来，容易造成总线风暴或误判。
- 不要让 transient probe 两轴同 tick 连续执行；必须尊重 `_verify_probe_slot_owner` / `_verify_probe_slot_ms` 的 probe slot 限制。
- 不要让 `duration_complete` 后的 passive no-powercycle probe timeout 直接升级为 `bus_dead` 或触发 power-cycle；没有 active motion/write demand 时只能 warning / suppressed。
- 不要把 passive cooldown 当作永久屏蔽真实故障：一旦新运动或写入需求出现，仍应走健康门控、短 probe，并允许真实 active failure 升级。
- `write_backoff` 不是降低庆祝动作幅度；它只是在同一目标 ACK 缺失后的冷却窗口内阻断重复写入风暴。
- `axis_stagger_wait` 也不是降低庆祝动作幅度：不要改 Motion 目标角度、Servo animation target、speed-to-write-time 映射或庆祝动作帧；它只把第二轴的实际 `WritePos` 延后到 slot 释放后的后续 tick。
- 不要把错峰逻辑放到目标角度提交层：yaw/pitch 仍应同时接收目标角度，错峰只属于 HAL 硬件 position write 层。

## 验证标准

- 代码静态检查至少跑 `git diff --check`。
- 固件轻量构建应能通过，例如在 `firmware/` 下执行 `idf.py -B <build-dir> build` 并生成 `stack-chan.bin`。
- 日志验证重点：
  - 完整 `duration_complete` 且仅 transient I/O 时，应出现 `action=no_write_transient bus_dead=0 transient_io_error=1`，不应出现新的 `bus_failed=1`。
  - `WritePos rc<=0 err=ERR_NO_REPLY` 后，应先出现 `event=write_ack_missing` / `ack_missing_cooldown`，并带有 `quiet_until`、`probe_due`、`hold_until`、`probe_fail_count`、`axis_id` 等诊断字段。
  - ACK missing 后不应立即在同步 `set_angle_impl()` 路径里出现频繁 `ReadPos` / `Ping` verify；应等待 `probe_due`，由 `ScsServo::update()` 或 `serviceBusRecoveryProbe()` 服务异步 probe。
  - 两轴 probe 过近时，应出现 `verify_slot_busy` 或 `transient_probe_deferred`，而不是同 tick 连续 probe。
  - probe 成功时应出现 `transient_probe_ok`，并解除 transient no-write。
  - probe 失败但未达到升级条件时，应出现 `transient_probe_failed_hold`，并延长 hold/cooldown，不应立刻 `bus_dead`。
  - `duration_complete` 且仅 transient I/O 的收尾后，应出现 `transient_passive_cooldown`，带 `no_powercycle=1`、`passive_until`、`passive_reason=celebrate_finish_duration_complete`。
  - passive / no-powercycle 或无 active demand 期间，probe 失败应出现 `transient_probe_failed_passive` 或 `transient_timeout_suppressed`，不应出现 `bus_dead_escalated_after_transient_timeout` 或 power-cycle。
  - 只有存在 active motion/write demand，且 transient 持续 `>= 2500ms`、`probe_fail_count >= 5` 时，才允许出现 `bus_dead_escalated_after_transient_timeout`。
  - 明确 backend bus dead 时，应出现 `action=no_write bus_dead=1`。
  - 调查“1~2 秒后红灯卡住”时，应检查 `preflight_bus_dead` / `bus_dead` / `timeout` 与 `duration_complete` 是否被区分记录；`active=false` 本身不能证明正常完成。
  - 调查“小智触发庆祝过早完成判定”时，应检查 `finish_type`、`elapsed_ms`、`expected_end_ms`、`min_finish_ms`、`step_index`；正常完成不得早于最后动作帧 `last_motion_frame_due_ms` 后的 settle 窗口，也不得在 `step_index < kMotionFrameCount` 时发生。
  - 如果新增 `/dev/status` 庆祝字段，应验证 `celebrate_last_reason`、`celebrate_completed_normally` 或等价字段能区分正常 `duration_complete` 与异常中止。
  - 健康收尾时，应出现 `action=scheduler_queue bus_dead=0 transient_io_error=0 hardware_failure=0`。
  - 双轴错峰命中时，应出现 `event=axis_stagger_wait reason=axis_write_slot_busy action=no_write`，并带有 `axis_id`、`slot_owner`、`slot_age_ms`、`cooldown_left_ms`、`stagger_window_ms` 等字段；同时应保留 `write_mode`、`read_before_write`、`write_interval_ms`、`write_attempt_cooldown_ms`、`present_raw`、`anim_req_ang`、`command_ang`、`write_raw`、`delta_raw`、`source_speed`、`write_time` 等诊断上下文。
- 诊断脚本应能分别统计 `finish_bus_dead`、`transient_io_error`、`no_write_transient` 与 legacy `bus_failed`。

## 关键检索词

- `finishCelebrateLocked`
- `stackchan_celebrate_tick`
- `duration_complete`
- `finish_type=normal`
- `finish_type=aborted`
- `elapsed_ms`
- `expected_end_ms`
- `min_finish_ms`
- `last_motion_frame_due_ms`
- `last_finish_reason`
- `last_finish_was_normal`
- `last_finish_elapsed_ms`
- `last_finish_step_index`
- `kMotionFrameCount`
- `kCelebrateFrameBeatMs`
- `kCelebrateSettleAfterLastFrameMs`
- `kCelebrateMinFinishMs`
- `Servo::hasBusDead()`
- `Motion::hasBusDead()`
- `Servo::hasTransientIoError()`
- `Motion::hasTransientIoError()`
- `hasHardwareFailure()`
- `_consecutive_bus_failures`
- `_read_pos_fail_count`
- `_read_move_fail_count`
- `_write_ack_missing_count`
- `_last_attempted_raw`
- `_last_attempted_angle`
- `_last_attempted_ms`
- `_transient_probe_pending`
- `_transient_quiet_until_ms`
- `_transient_probe_due_ms`
- `_transient_hold_until_ms`
- `_transient_probe_fail_count`
- `_transient_passive_until_ms`
- `_transient_passive_reason`
- `_verify_probe_slot_owner`
- `_verify_probe_slot_ms`
- `kWriteAttemptCooldownMs`
- `kAxisWriteStaggerWindowMs`
- `kAxisStaggerLogIntervalMs`
- `_axis_write_slot_owner`
- `_axis_write_slot_ms`
- `try_acquire_axis_write_slot(...)`
- `record_axis_write_slot(now_ms)`
- `ERR_NO_REPLY`
- `record_write_attempt()`
- `handle_write_pos_failure()`
- `serviceBusRecoveryProbe()`
- `service_transient_probe()`
- `enterTransientPassiveCooldown`
- `Motion::enterTransientPassiveCooldown(...)`
- `WritePos`
- `ReadPos`
- `Ping`
- `event=write_ack_missing`
- `ack_missing_cooldown`
- `transient_probe_pending`
- `transient_probe_deferred`
- `verify_slot_busy`
- `transient_probe_ok`
- `transient_probe_failed_hold`
- `transient_passive_cooldown`
- `transient_probe_failed_passive`
- `transient_timeout_suppressed`
- `bus_dead_escalated_after_transient_timeout`
- `no_powercycle=1`
- `passive_until`
- `passive_reason`
- `active_io_demand`
- `celebrate_finish_duration_complete`
- `quiet_until`
- `probe_due`
- `hold_until`
- `probe_fail_count`
- `axis_id`
- `reason=write_backoff`
- `event=axis_stagger_wait`
- `reason=axis_write_slot_busy`
- `slot_owner`
- `slot_age_ms`
- `cooldown_left_ms`
- `stagger_window_ms`
- `action=no_write_transient`
- `transient_io_error=1`
- `bus_dead=1`
- `g_celebrate_active`
- `start_celebrate_modifier`
- `self.robot.celebrate`
- `/dev/celebrate`
- `/dev/mcp/call`
- `/dev/status`
- `HeadMotionSchedulerModifier::submit`
- `HeadMotionSchedulerModifier::_update`
- `Servo::isMoving()`
- `ScsServo::is_moving_impl()`
- `kReadMoveEnabled=false`
- `kFrameBeatMs`
- `kBusPreflightTimeoutMs`
- `preflight_bus_dead`
- `bus_dead`
- `timeout`
- `celebrate_active`
- `celebrate_expected_end_ms`
- `celebrate_last_reason`
- `celebrate_completed_normally`
- `get_latest_completion_event`
- `computeCompletionEventTiming`
- `should_celebrate`
- `bus_failed=1`
