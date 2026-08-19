# StackChan 非阻塞头部电机控制链路

## 结论

StackChan 当前的“不卡顿控制电机/舵机”不是同步执行舵机动作，而是采用 **MCP/HTTP 快速返回 + 独立 `_stackchan_update_task` + `HeadMotionSchedulerModifier` 合并调度 + 舵机总线少读少写 + bus dead 保护** 的异步推进模型。未来修改远控头部、庆祝动作或小智并行逻辑时，应优先保持这条链路，不要把长动作放回 MCP callback 或 HTTP handler 中。

本地 Codex Dock 产品 profile 另有一条当前安全边界：`CONFIG_STACKCHAN_XIAOZHI_DISABLE_IDLE_HEAD_MOTION=y` 时不挂载随机 `IdleMotionModifier`，因为用户已多次确认待机摇头可触发崩溃。该隔离不关闭屏幕 idle expression，也不删除显式 MCP 头部命令；它不能被写成舵机底层根因已修复。

庆祝/调度链路的长期边界是：`submit()` / `moveWithSpeedNoHardwareRead()` 避免启动阶段 `ReadPos`，scheduler release 到达目标后的 `motion.stop()` → `Servo::stopAnimation()` 也必须保持 no-read。当前修复已让 `Servo::stopAnimation()` / `abortAnimationNoRead()` 使用 `_angle_anim.directValue()` 缓存角度，并用 `SERVO-DIAG ... read_hardware=0` 留证；`HeadMotionSchedulerModifier::_update()` 在 release 前记录 `bus_healthy=0|1`，但正常运动 auto sync 在 `allowHardwareSync && _auto_angle_sync_enabled` 时仍保留 `getCurrentAngle()`。

## 长期行为 / 规则

- MCP tools `self.robot.set_head_angles`、`self.robot.set_head_targets` 收到请求后只解析参数、加锁并调用 `submitHeadMotion(...)`，不在 callback 中循环等待舵机到位。
- `self.robot.celebrate` 只把庆祝 executor 状态设置为 pending/active，真正的 LED/head frame 由 StackChan update loop 后续 tick 推进。
- `_stackchan_update_task()` 与小智主流程解耦：小智启动后单独创建 FreeRTOS task 负责 `StackChan::update()`、motion、celebrate tick、UI/LED 等刷新。
- 对话中或小智非 idle 时降低 full update / motion refresh 频率；head scheduler 或 celebrate active 时才提高 motion tick，避免音频/对话期间抢 CPU。
- `HeadMotionSchedulerModifier` 是头部不卡顿控制的核心：收到目标后只保留最后一个 pending target，做 tiny-delta 过滤、30ms debounce、dispatch 后延迟释放，并用 hard timeout 防止调度器长期占用；新目标的 base 应优先使用 `_last_yaw/_last_pitch` 或动画角缓存，不应在提交阶段读取硬件当前位置。
- 舵机底层策略是“少读、少写、写最终目标”：移动中不 `ReadPos`，禁用 `ReadMove`，同目标跳过，短时间重复写跳过，写硬件时倾向使用最终 target 而不是每帧小目标。
- 但 `single_final_target` 不是庆祝稳定性的充分修复：它减少 UART 刷屏，同时会把动作变成阶跃式最终目标；当庆祝把两轴舵机、满亮 LED 和 SCS UART ACK 等待叠在同一更新任务里时，仍可能造成电源/力矩/总线峰值，详见 `features/stackchan-celebrate-power-servo-stability.md`。
- bus dead 后停止继续普通写入/扭矩写和读移动风暴，恢复探测应按 `flush -> quiet -> ping -> read_pos -> recovered` 分阶段节流推进；只有 `Ping` 成功后才允许 `ReadPos`，避免 bus_dead 状态下无限 `ReadPos` 探测。庆祝启动前的 `celebrate_preflight` 应只调用 `Motion::serviceBusRecoveryProbe()` / `Servo::serviceBusRecoveryProbe()` 复用该安全探测，不写 servo target，恢复成功后才启动 executor。
- 活动中的 head scheduler / celebrate 会临时关闭 `AutoAngleSync`，避免每帧从当前角度 teleport 造成抖动；活动停止一段时间后再恢复 auto sync。
- `_stackchan_update_task()` 中存在两个独立 update 路径：约 `50ms` 的 `motion.update()` / `stackchan_celebrate_tick()`，以及约 `150ms` 的 `GetStackChan().update()`；后者内部仍会先更新 modifier/cleanup，再调用 `_motion->update()`。因此 `Servo::update()` 在两条路径对齐时会被重复推进，`_update_in_progress` guard 是防止重入的关键保护，不应随意移除。
- `HeadMotionSchedulerModifier` release 阶段（`!_has_pending && _active && !moving`）若调用 `motion.stop()`，普通健康路径会进入 `Servo::stopAnimation()`；该路径必须使用 `_angle_anim.directValue()` 缓存角度而不是虚函数 `getCurrentAngle()`，避免在 `ScsServo` 上触发 `ReadPos()`。`SERVO-SCHED` 的 release / bus dead / hard timeout 日志应带 `bus_healthy=0|1`。
- `Servo::update()` 自动扭矩释放是另一个到达后硬件操作窗口：motor stopped 后约 `200ms` 可能调用 `setTorqueEnabled(false)` → `EnableTorque(id, 0)`；它是写操作，通常晚于 scheduler release 的 `ReadPos`。
- `AutoAngleSync` 重新启用后，下次普通 `moveWithSpeed` 若允许 sync，仍可能走 `update_angle_anim_target(sync=true)` → `getCurrentAngle()` → `ReadPos()`；这比 release 后读更晚，但仍是长期回归点。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_mcp.cpp`：MCP tools、本地 HTTP 复用 dispatch、`HeadMotionSchedulerModifier`、celebrate executor/tick 的核心入口。
- `firmware/main/hal/hal.cpp`：`_stackchan_update_task()` 和 `Hal::startXiaozhi()`，负责把 StackChan update loop 与小智主流程解耦。
- `firmware/main/hal/hal_servo.cpp`：FEETECH/SCS 舵机底层写入、少读少写策略、bus dead 保护与分阶段恢复探测；庆祝稳定性排查还要看 `ScsServo::set_angle_impl()`、`WritePos`、`Ack(ID)`、`uart_wait_tx_done` 与 `stage=flush/quiet/ping/read_pos` 是否仍在更新任务中同步等待。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/stackchan/motion/servo.cpp` / `firmware/main/stackchan/motion/servo.h` | `Servo::update()`、`moveWithSpeed()`、`moveWithSpeedNoHardwareRead()`、`update_angle_anim_target(angle, false)`、`syncAnimationToCurrentAngle()`、`stopAnimation()` / `abortAnimationNoRead()`，负责动画推进与底层角度写入衔接；庆祝/调度启动新目标走 no-hardware-read 路径，release/stop 收尾使用 `_angle_anim.directValue()` 避免重新触发硬件 `ReadPos`，`servo.h` 注释明确 stop 路径不读硬件。 |
| `firmware/main/stackchan/motion/motion.cpp` / `motion.h` | `Motion::moveWithSpeed()`、`Motion::moveWithSpeedNoHardwareRead()`、`serviceBusRecoveryProbe()`、`stop()`、`isMoving()`、`hasBusDead()` / `hasHardwareFailure()` 等 motion 聚合接口；`Motion::stop()` 需要区分 bus_dead 时的 no-read abort 与健康路径的 `stopAnimation()` 硬件读；`serviceBusRecoveryProbe()` 应分别驱动 yaw/pitch 的安全恢复探测，全部恢复才返回 true。 |
| `firmware/main/stackchan/stackchan.h` | `StackChan::update()`、`addModifier()` / `removeModifier()`，异步 modifier 挂载与统一 update 入口。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | dev-only HTTP 控制面：`/dev/mcp/call`、`/dev/celebrate`、`/dev/status`、`/dev/wake`、`/dev/stop` 等。 |
| `firmware/CMakeLists.txt` | dev build 开关，例如 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`、`STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`。 |
| `tools/remote_control/remote_control.py` | 局域网远控 CLI，封装 `/dev/mcp/call`、`/dev/celebrate` 等接口。 |
| `tools/celebrate-mcp-tool/DESIGN.md` | 早期 celebrate MCP 设计说明，强调 callback 立即返回、动画异步执行。 |

## 真实调用链路

### MCP / HTTP 设置头部角度

1. MCP tool `self.robot.set_head_angles` 或 `self.robot.set_head_targets` 在 `Hal::xiaozhi_mcp_init()` 中注册。
2. 本地 HTTP `POST /dev/mcp/call` 由 `hal_dev_local_control.cpp` 接收后调用 `stackchan_mcp_dispatch_tool()`，与 MCP 复用同一套 tool 逻辑。
3. tool callback 解析参数后获取 `LvglLockGuard`，调用 `submitHeadMotion(...)` 并立即返回。
4. `submitHeadMotion(...)` 把目标交给 `HeadMotionSchedulerModifier::submit()`；scheduler 只保留最后目标，并做 clamp、tiny delta skip、debounce。
5. `StackChan::update()` 驱动 modifier `_update()`；达到 debounce 条件后应基于缓存/动画角 dispatch 到 `motion.moveWithSpeedNoHardwareRead(...)`，不再在派发阶段调用 `motion.syncAnimationToCurrentAngles()` 或 `motion.getCurrentAngles()`。
6. `Servo::update()` 推进动画，最终通过 `ScsServo::set_angle_impl(int angle)` 写入舵机。

### celebrate 动作

1. `self.robot.celebrate` 或 HTTP `POST /dev/celebrate` 调用 `start_celebrate_modifier()`。
2. `start_celebrate_modifier()` 设置全局 executor 为 pending/active；已有 active celebrate 时返回 `already_active`。
3. `stackchan_celebrate_tick()` 在 `Pending` 阶段先做 `hasBusDead()` preflight；若 bus dead，则只驱动 `serviceBusRecoveryProbe()`，不点启动灯、不排 motion、不写 target，恢复成功后才启动 executor，失败则红灯错误反馈。
4. `_stackchan_update_task()` 后续循环调用 `stackchan_celebrate_tick()` 推进 LED/head frame。
4. celebrate 结束时若 `hasHardwareFailure()` 为 true，不强行发送回中动作，只停止动画，避免在硬件失败时继续施压总线。

## 源码位置速查

| 主题 | 源文件 | 函数 / 类 / 常量 | 说明 |
| ---- | ------ | ---------------- | ---- |
| StackChan 独立刷新任务 | `firmware/main/hal/hal.cpp` | `_stackchan_update_task()` | motion、celebrate、UI/LED 的非阻塞 tick 主循环。 |
| 小智启动挂载 StackChan task | `firmware/main/hal/hal.cpp` | `Hal::startXiaozhi()` | 开启 auto sync / auto torque release，并创建 pinned FreeRTOS task。 |
| MCP tool 注册 | `firmware/main/hal/hal_mcp.cpp` | `Hal::xiaozhi_mcp_init()` | 注册 `self.robot.get_head_angles`、`set_head_angles`、`set_head_targets`、`celebrate`、`set_led_color` 等。 |
| HTTP 复用 MCP dispatch | `firmware/main/hal/hal_mcp.cpp` | `stackchan_mcp_dispatch_tool()` | 供 `/dev/mcp/call` 复用同一套工具逻辑。 |
| 头部目标合并调度 | `firmware/main/hal/hal_mcp.cpp` | `HeadMotionSchedulerModifier::submit()` / `_update()` | 合并最后目标、debounce、dispatch、release、hard timeout。 |
| 高刷新判定 | `firmware/main/hal/hal_mcp.cpp` | `stackchan_motion_high_refresh_active()` | head scheduler / celebrate active 时提高 motion 刷新频率。 |
| 舵机总线少读少写 | `firmware/main/hal/hal_servo.cpp` | `kReadBeforeWriteDuringMotion`、`kReadMoveEnabled`、`kSingleWriteFinalTargetMode`、`kWriteIntervalMs` | 避免 UART 压力和连续小步进写入。 |
| bus dead 保护 | `firmware/main/hal/hal_servo.cpp` | `record_bus_failure()` / `probe_bus_recovery()` | 连续失败后停止普通写入，按 `flush -> quiet -> ping -> read_pos -> recovered` 分阶段探测恢复。 |
| 动画到硬件写入 | `firmware/main/stackchan/motion/servo.cpp` / `firmware/main/stackchan/motion/servo.h` | `Servo::update()`、`Servo::moveWithSpeedNoHardwareRead()`、`Servo::stopAnimation()`、`abortAnimationNoRead()`、`ScsServo::set_angle_impl(int angle)` | 动画最多 50Hz 推进；庆祝/调度启动新目标使用 no-hardware-read 入口，release/stop 收尾通过 `_angle_anim.directValue()` 与 `SERVO-DIAG ... read_hardware=0` 证明未重新触发 `getCurrentAngle()` / `ReadPos`。 |
| dev HTTP 控制 | `firmware/main/hal/hal_dev_local_control.cpp` | `mcp_call_handler()`、`inject_prompt_handler()` | `/dev/mcp/call` 控制头部；prompt 注入另起 `inject_prompt_task` 避免 handler 阻塞。 |

## API 约束

### MCP tools

- `self.robot.get_head_angles`：返回当前 yaw/pitch 角度；内部会读取 `motion.yawServo().getCurrentAngle() / 10`、`motion.pitchServo().getCurrentAngle() / 10`。
- `self.robot.set_head_angles`：按角度控制，`yaw` 约为 `-128 ~ 128` 度，`pitch` 约为 `0 ~ 90` 度，`speed` 默认约 `180`；`-9999` 表示该轴不更新；内部乘以 10 转成 target。
- `self.robot.set_head_targets`：按内部单位控制，`yaw_target` 约 `-1280 ~ 1280`，`pitch_target` 文档范围到 `0 ~ 900`，但 scheduler 实际会 clamp 到 `30 ~ 870`。
- `self.robot.celebrate`：`style` 支持 `cheer` / `sparkle` / `nod` / `calm`；duration clamp 到约 `8000 ~ 9000`；intensity clamp 到 `1 ~ 3`；已有 active celebrate 时返回 `already_active`。
- `self.robot.set_led_color`：RGB 范围约 `0 ~ 168`。

### 本地 HTTP dev API

- `POST /dev/mcp/call`：传入 `tool` 与 `arguments`，调用同一套 MCP dispatch。
- `POST /dev/celebrate`：触发 celebrate modifier。
- `GET /dev/status`：返回版本、IP、小智状态、heap、RSSI 等。
- `POST /dev/wake` / `POST /dev/stop`：直接调用小智 `Application::StartListening()` / `StopListening()`。
- 本地 HTTP 控制面是 dev-only 能力；涉及 `STACKCHAN_DEV_LOCAL_CONTROL_TOKEN`、端口 `18080` 和编译开关时，生产环境必须重新评估暴露风险，不要把 dev 默认值当生产认证方案。

## 已知陷阱

- 不要用 `yaw=1,2,3,4...` 这种连续小步进驱动动画；当前设计要求“final target once”，高频小步进会被合并但仍增加锁竞争和日志压力。
- 不要在 MCP callback、HTTP handler 中写长循环或等待动作完成；长动作必须拆到 modifier / executor / FreeRTOS task 的 tick 中。
- `sound` 参数目前在 celebrate 中基本是 no-op；源码里 `(void)sound;`，目的是避免运动刷新实验期间引入额外音频压力。
- `pitch` 的公开文档范围和 scheduler 实际 clamp 不完全一致：低于 internal `30` 会被夹到 `30`。
- MCP `speed` 可到 `300`，但底层 `ScsServo::speed_to_write_time()` 的有效速度会再次 clamp 到约 `100~180`，超过 `180` 不应期待线性变快。
- `get_head_angles` 仍是读取当前位置的查询工具；但 scheduler / celebrate 启动新动作不应再用 `getCurrentAngle()`、`ReadPos`、`syncAnimationToCurrentAngles()` 或 `getCurrentAngles()` 取硬件 base，应使用 `_last_yaw/_last_pitch` 或 `motion.getAnimationAngles()`。
- 不要只验证启动阶段没有 `ReadPos`：庆祝回中动作完成后的 scheduler release、`motion.stop()`、自动扭矩释放和 auto sync 重新启用后的下一次运动，都是“到达目标后”硬件读写窗口。
- `request_stackchan_performance_mode()` 当前是 no-op；真实刷新节奏主要来自 `_stackchan_update_task()` 的 active/idle 判断，不要误以为 performance lease 一定生效。
- `Task` / modifier 的职责边界很重要：`StackChan::update()` 是真实推进点，MCP/HTTP 只是提交目标。

## 验证标准

后续修改头部远控、celebrate 或刷新策略时，至少验证：

- MCP/HTTP callback 是否仍快速返回，没有新增阻塞等待或长循环。
- 高频连续请求下 `HeadMotionSchedulerModifier` 是否仍只 dispatch 合并后的最终目标。
- 小智对话/非 idle 状态下 full update 与 motion update 是否仍会降频。
- 舵机底层是否仍避免移动中频繁 `ReadPos` / `ReadMove`，且同目标、短间隔重复写会被跳过。
- celebrate / scheduler 启动新目标后的 0~200ms 内不应因启动逻辑出现 `source=read_pos_fail`、`raw=-1`、`getCurrentAngle`、`ReadPos`。
- scheduler release 调用 `motion.stop()` 后也不应出现新的 `ReadPos` UART 事务；日志应能看到 `SERVO-DIAG source=stopAnimation read_hardware=0` / `source=abortAnimationNoRead read_hardware=0`，以及 `SERVO-SCHED` 的 `bus_healthy=0|1`，必要时用逻辑分析仪证明 release 前后无 `ReadPos`。
- bus dead 后是否停止普通写入/读移动风暴，并按 `stage=flush`、`stage=quiet`、`stage=ping`、`stage=read_pos`、`event=recovered` 的恢复探测逻辑重新同步；庆祝 preflight 期间应出现 `source=celebrate_preflight event=bus_dead_detected action=recovery_probe_no_write`，且恢复失败时不进入 `applyCelebrateMotion()` / `HeadMotionSchedulerModifier`。
- celebrate active 时二次调用是否稳定返回 `already_active`，结束时硬件失败路径不强行回中。
- HTTP dev 控制面是否仍受 dev 开关和 token 保护，生产构建不要无意暴露。

## 关键检索词

- `_stackchan_update_task`
- `Hal::startXiaozhi()`
- `HeadMotionSchedulerModifier`
- `submitHeadMotion`
- `stackchan_motion_high_refresh_active`
- `stackchan_celebrate_tick`
- `start_celebrate_modifier`
- `stackchan_mcp_dispatch_tool`
- `self.robot.set_head_angles`
- `self.robot.set_head_targets`
- `self.robot.celebrate`
- `Servo::stopAnimation`
- `abortAnimationNoRead`
- `ScsServo::set_angle_impl`
- `ScsServo::getCurrentAngle`
- `moveWithSpeedNoHardwareRead`
- `Motion::stop`
- `EnableTorque(id, 0)`
- `update_angle_anim_target(angle, false)`
- `motion.getAnimationAngles`
- `serviceBusRecoveryProbe`
- `celebrate_preflight`
- `recovery_probe_no_write`
- `preflight_bus_dead`
- `stage=flush`
- `stage=quiet`
- `stage=ping`
- `stage=read_pos`
- `event=recovered`
- `kReadBeforeWriteDuringMotion`
- `kReadMoveEnabled`
- `kSingleWriteFinalTargetMode`
- `kWriteIntervalMs`
- `record_bus_failure`
- `probe_bus_recovery`
- `reject_bus_dead`
- `already_active`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `STACKCHAN_DEV_LOCAL_CONTROL_TOKEN`
