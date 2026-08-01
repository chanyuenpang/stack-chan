# StackChan celebrate power / servo stability

## 结论

`self.robot.celebrate` 的长期风险不是“单纯供电差”，而是庆祝链路在同一个 StackChan/LVGL 更新任务里叠加了 **满亮 LED 闪烁 + 两轴舵机阶跃式 final-target 写入 + SCS UART ACK/读写等待**。现场表现为执行庆祝后 USB 枚举消失、网络离线、无 panic 时，应优先按“瞬时掉电/复位或外设总线拖死系统”排查；修复方向不是 no-op、禁用或 fallback，而是把庆祝做成有功耗/力矩/总线预算的有界状态机，并隔离舵机 UART 阻塞。

`2.0.26 no-op life-preserver` 曾经只作为保命逻辑：屏蔽入口、不驱动 LED/servo/audio 并返回成功；它不是根因修复。恢复真实庆祝时，`start_celebrate_modifier()` 应设置 `g_celebrate_executor.state = Pending` 与 `g_celebrate_active = true`，由 tick 正常执行 LED + 舵机动作；关键边界是启动新目标不能读取硬件当前位置，并且 bus_dead 恢复不能无限 `ReadPos` 探测。`2.0.27-celebrate-stop-readfix` 的长期验收口径是：HTTP `/dev/celebrate`、MCP `self.robot.celebrate`、`start_celebrate_modifier()`、`stackchan_celebrate_tick()`、`applyCelebrateMotion()`、`submitHeadMotion()` 与 LED `setCelebrateLightHard` 路径都必须保持 active，不能再以 no-op / fallback / return-early 掩盖总线风险。

`2.0.26` 后续审查曾确认：启动/帧分发阶段的 `submit()`、`moveWithSpeedNoHardwareRead()`、`set_angle_impl` 读前写、`ReadMove` 已被覆盖，但“动作到达目标后”的 scheduler release 仍有缺口。后续修复已把 `Servo::stopAnimation()` / `abortAnimationNoRead()` 改为使用 `_angle_anim.directValue()` 缓存角度，release/stop 路径不再触发 `getCurrentAngle()` → `ScsServo::ReadPos()` 硬件读；`HeadMotionSchedulerModifier::_update()` 在 `motion.stop()` 前记录 `busHealthy = !motion.hasHardwareFailure()`，并让 `SERVO-SCHED` 日志携带 `bus_healthy=0|1`。正常运动 `update_angle_anim_target()` 的 auto sync 仍只在 `allowHardwareSync && _auto_angle_sync_enabled` 时保留 `getCurrentAngle()`，因此没有禁用正常头部运动同步。

后续排查还要把串口中的 `SERVO-BUS recovery_probe_failed reason=update_tick raw=-1` 当成独立的长期线索：即使设备 `ping`、HTTP `/dev/status`、USB 枚举和 heap 都稳定，双轴伺服总线也可能已经处在持续恢复失败循环中。这个状态不等价于庆祝已稳定，只能说明当前固件/当前触发路径没有复现硬死；任何依赖舵机总线的动作仍可能被 `bus_failed`、`prevent_disconnect` 或同步 UART 等待放大。

庆祝排查还必须先建立**实时串口 stdout 捕获闭环**。`start_celebrate_modifier()` 只负责把 executor 置为 pending/active 并快速返回，HTTP/MCP 得到 `ok:true` 不能证明 LED、servo frame 或 finish reason 已执行；真正证据只能来自 `_stackchan_update_task()` 后续 tick 的日志、实物动作或可靠的设备侧观测。`mooncake_log` / `mclog::tagInfo` 底层输出到 C `stdout`（USB Serial/JTAG），不走 ESP-IDF `ESP_LOG`；`ops/bin/stackchan-usb-logs` 与 `ops/bin/stackchan-celebrate-diagnose` 只是读取已有 `/tmp/stackchan-serial*.log`，不会主动打开串口或捕获新日志。如果没有正在运行的 `/dev/ttyACM*` 捕获进程，日志文件可能只是旧数据，不能用“日志里没有 celebrate”否定设备侧执行。

当进入庆祝前已经处于 `bus_dead` / `recovery_probe_failed` 循环时，庆祝 executor 不能先点启动灯再失败。长期正确顺序是：`Pending` 阶段先做 `hasBusDead()` preflight；若 bus dead，则进入 `celebrate_preflight`，在有限窗口内只调用 `Motion::serviceBusRecoveryProbe()` / `Servo::serviceBusRecoveryProbe()` 驱动既有 `probe_bus_recovery()`，不启动 executor、不调用 `applyCelebrateStartLight()`、不排 `applyCelebrateMotion()`。恢复成功后才进入正常庆祝；超时失败时应给红灯错误反馈并记录 `action=error_led_no_motion` / `action=no_servo_write`，而不是黑屏式 `bus_dead` 早退。

## 长期行为 / 规则

- 庆祝入口可以来自两条不同通道：XiaoZhi 内建 MCP server 在 `Hal::xiaozhi_mcp_init()` / `McpServer::AddTool("self.robot.celebrate", ...)` 注册 tool；本地 LAN HTTP 则包括 `POST /dev/celebrate` 和 `POST /dev/mcp/call` → `stackchan_mcp_dispatch_tool("self.robot.celebrate", ...)`。两条通道最终都调用 `start_celebrate_modifier(...)`，再由 `_stackchan_update_task()` 的 `stackchan_celebrate_tick(...)` 异步执行。
- `start_celebrate_modifier(...)` 的成功返回只代表“请求已排队”：它设置 `g_celebrate_executor.state = Pending`、`g_celebrate_active = true` 后立刻返回；调用方拿到 `ok:true` 时，LED 闪烁、servo motion、`bus_dead` preflight 和 finish reason 还没有发生。
- `stackchan_celebrate_tick()` 在 `_stackchan_update_task()` 中执行，当前与 `motion.update()` 同处 `LvglLockGuard` 保护范围；因此任何 UART 等待、LED 写入或 motion 调度异常都会影响 StackChan/LVGL 更新任务。
- 庆祝链路的“功能保留”验收不只看入口返回成功；必须确认 `/dev/celebrate` handler、`self.robot.celebrate` MCP tool、`start_celebrate_modifier()`、Pending → Running 状态机、`applyCelebrateMotion()` 的 5 帧 big-V、`submitHeadMotion()`、LED `setCelebrateLightHard` 和 release 后 `requestDestroy()` 都真实执行，且不存在 `noop`、`return early`、stub 或禁用分支。
- 庆祝 LED 链路会通过 `leftNeonLight().snapColor(...)` / `rightNeonLight().snapColor(...)` 立即落到 `Hal::setRgbColor()` / `hal_bridge::board_set_rgb_color(...)`；满白 `{255,255,255}` 硬闪应视为电流峰值来源之一。
- 庆祝 motion frame 当前是大 V 形目标：`{0,0}`、`{-450,300}`、`{0,0}`、`{450,300}`、`{0,0}`，`applyCelebrateMotion()` 固定 `kMoveSpeed = 120` 并一次提交 yaw+pitch；恢复真实庆祝后日志应出现 `action=led_and_servo`、`action=scheduler_led_servo`、`source=celebrate_frame`、`source=head_scheduler_queue`、`source=head_scheduler_dispatch`。
- 舵机底层当前倾向 `single_final_target`：减少连续小步写，但会把机械动作变成最终目标阶跃，可能提升瞬时力矩、堵转电流和电源压降风险。
- `same_target suppress`、`read_before_write=0`、`read_move=disabled`、`single_final_target` 能减少总线读写次数，但不能解决两轴同时动作、LED 同相满亮、UART ACK 等待和电气峰值。
- `brownout` 应被当作可验证结果，不应被当作修复方案；同一电源下若把舵机总线序列化、LED 与舵机错相后不再掉线，才说明代码侧资源预算有效。
- HTTP handler 或 MCP callback 不应直接触碰 StackChan/servo/LED 长动作；`start_celebrate_modifier()` 只能修改请求状态，真实执行者应保持单 owner tick / queue 模型。恢复真实庆祝时不应再出现 `celebrate_safed`、`noop_no_led_no_servo_no_audio`、`disabled_ota_2_0_26` 或 `action=noop`。
- `SERVO-BUS recovery_probe_failed reason=update_tick raw=-1` 表示恢复探测本身失败；若两个 axis 都持续出现，应优先定位 `hal_servo.cpp` 的 bus recovery / `update_tick` / UART SCS 读写链路，而不是只从 HTTP、Wi-Fi 或 heap 泄漏方向解释。稳定恢复探测应分为 `stage=flush`、`stage=quiet`、`stage=ping`、`stage=read_pos`、`event=recovered stage=read_pos`，并且只在 `Ping` 成功后进入 `ReadPos`。庆祝 preflight 复用同一安全恢复探测，只允许 `waitTxDone()`、`flushInput()`、`Ping()`、`ReadPos()`，不得在 bus_dead 未恢复时写 servo target。
- 庆祝“到达目标后”的密集硬件窗口按风险排序：A) scheduler release 后 `motion.stop()` / `Servo::stopAnimation()` 必须保持 no-read，日志应显示 `SERVO-DIAG source=stopAnimation read_hardware=0`；B) motor stopped 后自动扭矩释放 `EnableTorque(id, 0)`；C) bus_dead 后 `probe_bus_recovery` 的 flush/ping/read_pos；D) 2s idle 后 auto sync 重新启用，下次普通 `moveWithSpeed` 在 `allowHardwareSync && _auto_angle_sync_enabled` 时可能再次 `ReadPos()`。后续验证不能只看动作开始 0~200ms。
- `/dev/status` 中 `state: "idle"`、`heap_free` 稳定、`wifi_rssi` 正常，只能证明主系统和 HTTP 控制面仍可用；它不能证明 `self.robot.celebrate` 真正进入了 servo/LED 执行动作，也不能证明舵机总线健康。
- 庆祝诊断日志的权威来源是设备 `stdout` / USB Serial/JTAG。`mooncake_log` 不经过 `ESP_LOG`，因此只看 ESP-IDF log backend 或没有实时串口捕获的 `/tmp/stackchan-serial*.log` 会产生假阴性。
- 现有只读工具 `stackchan-usb-logs` / `stackchan-celebrate-diagnose` 不能替代 live capture：它们只聚合已有日志文件和关键词；若串口捕获进程未运行、连错 UART 而非 USB Serial/JTAG，或日志文件为旧数据，诊断结果只能说明“当前可读日志里没有证据”。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_mcp.cpp`：`self.robot.celebrate` 注册、`stackchan_mcp_dispatch_tool()`、`start_celebrate_modifier()`、`CelebrateExecutor`、`stackchan_celebrate_tick()`、`celebrate_preflight`、LED step、motion frame、`HeadMotionSchedulerModifier`。
- `firmware/main/hal/hal.cpp`：`_stackchan_update_task()`，决定 `motion.update()`、`stackchan_celebrate_tick()` 与 `LvglLockGuard` 的真实执行位置。
- `firmware/main/hal/hal_servo.cpp`：`ScsServo::set_angle_impl()`、`record_bus_failure()`、`probe_bus_recovery()`、`serviceBusRecoveryProbe()`、`update_tick`、`kReadBeforeWriteDuringMotion`、`kReadMoveEnabled`、`kSingleWriteFinalTargetMode`、bus dead / write cost / UART 写入主风险点；也是排查 `recovery_probe_failed reason=update_tick raw=-1`、`bus_failed`、`prevent_disconnect` 的主锚点。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/hal_dev_local_control.cpp` | `POST /dev/celebrate`，解析 `style` / `duration_ms` / `intensity` / `sound` 后调用 `start_celebrate_modifier(...)`。 |
| `firmware/main/stackchan/addons/neon_light/neon_light.cpp` | `NeonLight::snapColor()` 立即调用 `GetHAL().setRgbColor(...)`。 |
| `firmware/main/stackchan/motion/motion.cpp` / `motion.h` | `Motion::moveWithSpeed()`、`Motion::moveWithSpeedNoHardwareRead()`、`Motion::serviceBusRecoveryProbe()` 与 `Motion::update()`，同 tick 顺序更新 yaw/pitch；庆祝/调度启动新目标时应走 no-hardware-read 入口，庆祝 preflight 只驱动安全恢复探测。 |
| `firmware/main/stackchan/motion/servo.cpp` / `firmware/main/stackchan/motion/servo.h` | `Servo::update()` 每帧推进动画并调用 `_set_angle_impl(...)`；`Servo::moveWithSpeedNoHardwareRead()` / `update_angle_anim_target(angle, false)` 用于避免启动动作时触发硬件读；`Servo::serviceBusRecoveryProbe()` 约束为安全只读恢复探测、不写 target；`Servo::stopAnimation()` 与 `abortAnimationNoRead()` 已统一使用 `_angle_anim.directValue()` 缓存角度做 no-read 收尾，并通过 `SERVO-DIAG source=stopAnimation read_hardware=0` / `source=abortAnimationNoRead read_hardware=0` 留证；`servo.h` 注释也明确 stop 路径不读硬件。 |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCSCL.cpp` | `SCSCL::WritePos(...)`，FEETECH/SCS 写目标入口。 |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp` | `genWrite()`、`Ack(ID)`、`checkHead()`、`readSCS(...)`；写命令后等待 ACK 的协议层。 |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCSerial.h` / `SCSerial.cpp` | `uart_write_bytes(...)`、`uart_wait_tx_done(..., 100ms)`、默认读 timeout 约 `10ms`；`flushInput()`、`waitTxDone()` 是 bus_dead 分阶段恢复的公共封装。 |
| `firmware/main/stackchan/utils/object_pool.h` | `requestDestroy()` 后延迟 cleanup/reset，排查 scheduler lifecycle 时的对象池锚点。 |
| `firmware/main/hal/board/stackchan_display.cc` | `StackChanAvatarDisplay::LvglLock()` / `DisplayLockGuard`，排查 30s lock timeout 与 UI 锁竞争。 |

## 真实调用链路

1. XiaoZhi 内建 MCP 路径：`firmware/main/hal/hal_mcp.cpp` 在 `Hal::xiaozhi_mcp_init()` 通过 `McpServer::AddTool("self.robot.celebrate", ...)` 注册工具；云端/设备 MCP 消息命中该 tool 后读取 `style` / `duration_ms` / `intensity` / `sound`，调用 `start_celebrate_modifier(...)`。这条路径不经过 `hal_dev_local_control.cpp` 的 HTTP handler。
2. 本地 HTTP `/dev/celebrate` 路径：`firmware/main/hal/hal_dev_local_control.cpp::celebrate_handler()` 解析同类 JSON 并调用 `start_celebrate_modifier(...)`。
3. 本地 HTTP `/dev/mcp/call` 路径：`mcp_call_handler()` 解析 `{tool, arguments}`，经 `stackchan_mcp_dispatch_tool("self.robot.celebrate", ...)` 进入同一 `start_celebrate_modifier(...)`。
4. `start_celebrate_modifier()` 只设置 `CelebrateState::Pending`、`CelebrateExecutor` 和 `g_celebrate_active=true` 后快速返回；恢复真实庆祝时不要在这里直接操作 StackChan 硬件，也不要把 no-op 当成功执行。
5. `stackchan_celebrate_tick()` 在 `Pending` 阶段先检查 `stackchan.motion().hasBusDead()`；若 bus dead，则进入 `celebrate_preflight`，有限等待安全恢复探测，不点启动灯、不启动 executor、不排 servo motion。恢复成功时记录 `event=recovered action=start_executor` 后才进入正常庆祝；失败时记录 `event=failed action=error_led_no_motion` 并保持红灯错误反馈。
6. `_stackchan_update_task()` 每轮判断 `stackchan_motion_high_refresh_active()`，只有满足约 50ms / 150ms 刷新条件时才获取 `LvglLockGuard`，执行 `motion.update()` 与 `stackchan_celebrate_tick(GetStackChan(), now_ms)`。
7. `stackchan_celebrate_tick()` 推进 LED step：`applyCelebrateStartLight()` / `applyCelebrateLightStep()` → `setCelebrateLightHard()` → `snapColor()` → `Hal::setRgbColor()` → board RGB 实现。
8. 同一 tick 还可能推进 head motion：`applyCelebrateMotion()` → `submitHeadMotion(...)` → `HeadMotionSchedulerModifier::_update()` → `motion.moveWithSpeedNoHardwareRead(yaw,pitch,speed)`；提交和派发阶段不应调用 `getCurrentAngle()`、`ReadPos`、`syncAnimationToCurrentAngles()` 或 `getCurrentAngles()`。
9. `Motion::update()` 顺序更新 yaw/pitch 两个 `Servo`，`Servo::update()` 触发 `ScsServo::set_angle_impl()`。
10. `ScsServo::set_angle_impl()` 调用 `_scs_bus.WritePos(...)`，SCS 协议层执行 `genWrite()`、flush、`Ack(ID)`，UART 层执行 `uart_wait_tx_done(..., 100ms)` 和多段约 `10ms` 读超时。
11. 庆祝结束 `finishCelebrateLocked()` 在 `bus_dead` / `preflight_bus_dead` 路径不得直接黑灯；应保持红色错误灯态，记录 `celebrate_led_mode_error reason=... action=no_servo_write`，且 `SERVO-REQ source=celebrate_finish reason=... action=no_write`。若 `hasHardwareFailure()` 为真，不再强发回中，只 `motion.stop()`，否则可能再提交回中动作。
12. 回中动作完成后，`HeadMotionSchedulerModifier::_update()` 检测 `!moving` 并等待约 `150ms` release timer，随后调用 `motion.stop()`；当前 no-read 修复要求 release 前先计算并记录 `busHealthy = !motion.hasHardwareFailure()`，`SERVO-SCHED` 日志带 `bus_healthy=0|1`，落到 `Servo::stopAnimation()` 时只读 `_angle_anim.directValue()` 缓存值，不再通过虚函数 `getCurrentAngle()` 触发 `ScsServo::ReadPos()`。
13. 随后 `Servo::update()` 的 auto torque release 可能在 motor stopped 后约 `200ms` 调用 `setTorqueEnabled(false)` → `EnableTorque(id, 0)`；若 bus 已经异常，必须依赖 bus_dead / shadow skip 防止继续施压。

## 不要改错的位置

- 不要把 `2.0.26 no-op life-preserver` 当成庆祝已修复；它只是把入口屏蔽。若恢复真实庆祝，必须能看到 LED 和 big-V 头部帧执行，并且不再出现 no-op 相关日志。`2.0.27-celebrate-stop-readfix` 之后，若报告只证明 HTTP/MCP 返回成功但没有 `stackchan_celebrate_tick()`、LED、`applyCelebrateMotion()` 或 scheduler dispatch 证据，仍不能判定庆祝链路完整。
- 不要只把问题归因于电源或要求换电源；电源异常可能是结果，代码侧仍要避免 LED、两轴舵机和 UART ACK 等待同相叠峰。
- 不要只靠 `read_before_write=0`、`read_move=disabled`、`same_target suppress` 作为庆祝稳定性修复；这些降低总线频率，但不覆盖 `Servo::stopAnimation()` release 收尾读硬件，也不提供功耗/力矩/超时预算。
- 不要在 `hal_dev_local_control.cpp` 的 handler 或 MCP callback 中直接执行长动作；HTTP/MCP 应快速返回，长动作由 tick/worker 推进。也不要把 `ok:true` 当成动作完成证据；它只说明 `start_celebrate_modifier()` 排队成功。
- 不要假设 UART 等待“有 timeout 就安全”；两个轴同 tick 写入、`uart_wait_tx_done(100ms)`、`Ack()` 多段读超时在 LVGL update task 内叠加，会造成 UI/网络卡顿并放大电气问题。
- 不要把“v1.4.2 触发庆祝后 60s 未硬死”解释成庆祝链路已修好；如果串口持续刷 `recovery_probe_failed reason=update_tick raw=-1`，长期结论应是“硬死未复现，但伺服总线仍坏”。也不要把 `motion_frame=0`、`SERVO-SCHED=0`、`LED step=0` 的启动即失败误判为动作幅度问题；这通常说明 bus_dead preflight / 早退灯态问题，而不是 big-V 帧本身太激进。
- 不要用 `heap_free` 稳定或 `SystemInfo minimal sram` 约 `10KB` 作为庆祝根因排除的唯一证据；这些只能排除明显 heap 泄漏，不能排除 servo/UART 恢复循环、阻塞等待或瞬时电气峰值。
- 不要把 `Task` / modifier 的 `requestDestroy()` 当立即 delete；对象池 cleanup 是延迟 reset，scheduler lifecycle 排查要看 `object_pool.h`。

## 推荐修复方向

- 舵机总线改为“有界队列 + 单 owner worker + 硬超时统计”：所有 SCS/UART 写入由 worker 串行执行，`_stackchan_update_task()` 只提交目标，不同步等待 UART。
- 每条 head motion 命令记录 command id、target yaw/pitch、deadline、写入预算、失败计数和耗时；超过阈值（例如单次写 >150ms）时标记 bus unhealthy，并停止继续写本轮命令。
- 检查并日志化 `uart_wait_tx_done` 返回值；不能让 `wFlushSCS()` 忽略 UART 发送失败/超时。
- 庆祝状态机增加 generation / request id，保证幂等、不可重入、可取消、可恢复；`stackchan_celebrate_tick()` 是唯一执行者。
- LED 与舵机动作错相，限制满白亮度和 duty；避免 `{255,255,255}` 与两轴阶跃动作同一时间片出现。
- 两轴动作做力矩/电流预算：yaw/pitch 不同 tick 提交，或限制单帧目标差、速度和回中策略，避免同时堵转。
- 记录并上报 `esp_reset_reason()`；若出现 `ESP_RST_BROWNOUT`，作为电气结果证据，而不是关闭庆祝的理由。
- bus_dead 恢复探测使用阶段化状态机：先 `flush`（等待 TX 完成 + UART RX flush），再 `quiet` 静默间隔，然后 `ping`，只有 ping 成功后进入 `read_pos`，成功后清 bus_dead / 失败计数并记录 `event=recovered`。庆祝启动前若发现 bus_dead，应先走 `serviceBusRecoveryProbe()` preflight，恢复成功再启动 executor；失败只给错误灯和 no-motion 反馈。
- `Servo::stopAnimation()` / `abortAnimationNoRead()` 的长期正确形态是 no-read 收尾：直接使用 `_angle_anim.directValue()`，避免 scheduler release 时重新进入硬件 `ReadPos`；日志应包含 `SERVO-DIAG source=stopAnimation read_hardware=0 angle=...` 或 `source=abortAnimationNoRead read_hardware=0 angle=...`。
- `HeadMotionSchedulerModifier` release 分支在调用 `motion.stop()` 前应记录/判断 bus health；bus dead / hard timeout / released 路径都应带 `bus_healthy=0|1`，用于区分“主系统健康但伺服总线异常”和“健康 no-read release”。

## 验证标准

后续恢复或重做庆祝时至少验证：

- `self.robot.celebrate`、`POST /dev/celebrate`、`POST /dev/mcp/call` 都快速返回；HTTP/MCP callback 没有新增长循环或 UART 等待。
- 庆祝恢复后应真实执行 LED 高亮硬闪和 big-V 头部帧，日志包含 `action=led_and_servo`、`action=scheduler_led_servo`、`source=celebrate_start`、`source=celebrate_frame`。若启动前 bus dead，则应先看到 `SERVO-REQ source=celebrate_preflight event=bus_dead_detected action=recovery_probe_no_write`、`SERVO-BUS event=recovery_probe ...`；恢复成功再出现 `event=recovered action=start_executor`，失败则出现 `event=failed action=error_led_no_motion` 与红灯错误态。
- `_stackchan_update_task()` 不再同步执行可能长时间阻塞的 SCS/UART 写入；LVGL lock 内只做轻量状态推进。
- LED 满亮与两轴舵机动作不再同相叠加；庆祝期间没有 `{255,255,255}` 满白硬闪与 yaw/pitch final-target 同 tick 组合。
- UART 写入耗时、超时和返回值可观测；出现超时会标记 bus unhealthy 并停止本轮继续施压。
- 执行庆祝后设备不出现 USB 枚举消失、网络离线、无 panic 的硬死/复位；重启后能读取 `esp_reset_reason()`。
- 触发庆祝后 0~200ms 内不应出现启动逻辑导致的 `source=read_pos_fail`、`raw=-1`、`ReadPos`；回中动作完成、scheduler release 和 auto torque release 之后也不应新增 `ReadPos` 或异常 `EnableTorque(id, 0)` 风暴。release/stop 验收应看到 `SERVO-DIAG source=stopAnimation read_hardware=0`，必要时也看 `source=abortAnimationNoRead read_hardware=0`；`SERVO-SCHED` 在 bus dead / hard timeout / released 路径带 `bus_healthy=0|1`。观察窗口内串口不应持续出现双轴 `SERVO-BUS recovery_probe_failed reason=update_tick raw=-1`。若 bus_dead 由物理/供电/UART 问题触发，恢复日志应按 `stage=flush`、`stage=quiet`、`stage=ping`、`stage=read_pos`、成功后 `event=recovered` 出现。
- 连续触发 celebrate 压测应覆盖“帧播放结束 → 回中 → release → torque release → 2s idle 后下一次运动”的完整窗口；不能只证明启动阶段没有 `ReadPos`。
- 验证庆祝是否真实进入执行态时，不只看 `/dev/status state` 或 HTTP/MCP `ok:true`，还要结合 live USB Serial/JTAG stdout 捕获中的 `stackchan_celebrate_tick` / servo 写入日志、LED/舵机实物动作或可靠的服务端调用计数。若只用 `stackchan-usb-logs` / `stackchan-celebrate-diagnose`，必须先确认 `/tmp/stackchan-serial*.log` 正在实时写入而不是旧日志。
- bus dead / hardware failure 路径不会强发回中动作；收尾可恢复且 `g_celebrate_active` 能可靠清零。`preflight_bus_dead` / `bus_dead` finish 不应黑灯式退出，应保留红灯错误反馈并记录 `action=no_servo_write` / `action=no_write`。
- 高频或重入调用稳定返回 `already_active` 或按 generation 规则幂等处理，不产生多个 scheduler 交错。

## 关键检索词

- `self.robot.celebrate`
- `McpServer::AddTool("self.robot.celebrate")`
- `xiaozhi_mcp_init`
- `mooncake_log`
- `mclog::tagInfo`
- `fmt::print`
- `stdout`
- `USB Serial/JTAG`
- `/dev/ttyACM0`
- `/tmp/stackchan-serial*.log`
- `ops/bin/stackchan-usb-logs`
- `ops/bin/stackchan-celebrate-diagnose`
- `source=mcp_celebrate_call`
- `/dev/celebrate`
- `start_celebrate_modifier`
- `2.0.26 no-op life-preserver`
- `celebrate_safed`
- `noop_no_led_no_servo_no_audio`
- `disabled_ota_2_0_26`
- `action=noop`
- `action=led_and_servo`
- `action=scheduler_led_servo`
- `source=celebrate_start`
- `source=celebrate_frame`
- `source=head_scheduler_queue`
- `source=head_scheduler_dispatch`
- `CelebrateState::Pending`
- `CelebrateState::Running`
- `CelebrateExecutor`
- `g_celebrate_active`
- `stackchan_celebrate_tick`
- `applyCelebrateStartLight`
- `applyCelebrateLightStep`
- `setCelebrateLightHard`
- `snapColor`
- `kCelebrateMotionFrames`
- `applyCelebrateMotion`
- `submitHeadMotion`
- `HeadMotionSchedulerModifier`
- `moveWithSpeedNoHardwareRead`
- `update_angle_anim_target(angle, false)`
- `motion.getAnimationAngles`
- `finishCelebrateLocked`
- `Servo::stopAnimation`
- `abortAnimationNoRead`
- `Motion::stop`
- `EnableTorque(id, 0)`
- `_stackchan_update_task`
- `LvglLockGuard`
- `Motion::update`
- `Servo::update`
- `ScsServo::set_angle_impl`
- `WritePos`
- `genWrite`
- `Ack(ID)`
- `uart_wait_tx_done`
- `kReadBeforeWriteDuringMotion`
- `kReadMoveEnabled`
- `kSingleWriteFinalTargetMode`
- `same_target suppress`
- `read_before_write`
- `read_move`
- `single_final_target`
- `ESP_RST_BROWNOUT`
- `SERVO-BUS recovery_probe_failed`
- `reason=update_tick`
- `raw=-1`
- `serviceBusRecoveryProbe`
- `celebrate_preflight`
- `preflight_bus_dead`
- `action=recovery_probe_no_write`
- `action=error_led_no_motion`
- `celebrate_led_mode_error`
- `action=no_servo_write`
- `stage=flush`
- `stage=quiet`
- `stage=ping`
- `stage=read_pos`
- `event=recovered`
- `bus_failed`
- `prevent_disconnect`
- `SystemInfo minimal sram`
