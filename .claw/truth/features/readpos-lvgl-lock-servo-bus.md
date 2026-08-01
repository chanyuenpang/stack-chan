# ReadPos / LVGL lock / Servo bus 黑屏卡死链路

## 结论

`ReadPos` 黑屏/卡死的长期根因链路是：`ScsServo::getCurrentAngle()` 或写前读进入阻塞式 SCS UART 读取时，调用方仍持有 `LvglLockGuard` / `lvgl_port_lock`；当舵机无响应、半双工总线冲突或帧头读取超时时，单次 `ReadPos` 可能阻塞约 `100-280ms`，LVGL 渲染任务拿不到同一把锁，屏幕停止刷新，看起来像黑屏或卡死。

这不是单纯“舵机读慢”问题。双 update 路径、MCP/httpd 回调、两个舵机共享 `_scs_bus`、以及 bus_dead recovery 中继续探测 `ReadPos`，都会放大这条链路。第一阶段根治已把串行化下沉到 `SCS` 基类协议层：所有 `genWrite` / `Read` / `Ping` / `writeByte` / `writeWord` / `syncWrite` 等 UART 事务共用一把全局 FreeRTOS mutex，并设置 `50ms` 有限超时和 `SERVO-IO` 异常/慢事务诊断日志。后续根治仍应继续做 **UI 锁隔离 + ReadPos 硬超时 + update 去重**，而不是继续在 LVGL 锁内同步读 UART。

## 长期行为 / 规则

- `ReadPos` 的主要入口包括：
  - `Servo::update()` → `ScsServo::set_angle_impl()` 中的写前读（当 `kReadBeforeWriteDuringMotion=true`）。
  - `Servo::getCurrentAngle()` → `ScsServo::getCurrentAngle()`，例如 `update_angle_anim_target()` 或 MCP `get_head_angles` 查询。
  - `probe_bus_recovery()` 的恢复探测阶段，尤其 `Ping` 后的 `ReadPos`。
- `SCSCL::ReadPos(ID)` 最终走 `SCS::Read()`，会经历 `rFlushSCS()`、`writeBuf()`、`wFlushSCS()`、`checkHead()`、多段 `readSCS(...)`；这些都是同步 UART 事务。
- `checkHead()` 会逐字节寻找 `0xFF 0xFF` 帧头；每次 `readSCS(&bDat, 1)` 可等待 `IOTimeOut=10ms`，最多约 11 次，最坏约 `110ms`。
- 后续读取 `ID+Length+Status`、`Position`、checksum 等多个 `readSCS(...)` 调用，每段也可能按字节超时，理论上再叠加约 `70ms`。
- `wFlushSCS()` 内部 `uart_wait_tx_done(..., 100ms)` 是另一个同步阻塞点。
- 因此单次 `ReadPos` 正常响应约 `5-10ms`，异常最坏可接近 `280ms`；如果此时持有 LVGL 锁，会直接拖住渲染。
- `_stackchan_update_task()` 的 motion update 路径和 full update 路径都可能在 `LvglLockGuard` 内进入 `motion.update()`：
  - motion path：`LvglLockGuard` → `motion.update()` → `Servo::update()` → `ScsServo::set_angle_impl()` / `ReadPos`。
  - full path：`LvglLockGuard` → `GetStackChan().update()` → `_motion->update()` → 同一舵机链路。
- `StackChan::update()` 内部本身会调用 `_motion->update()`；如果外层又单独 tick `motion.update()`，两条路径对齐时会提高 `ReadPos` / `Servo::update()` 密度。`_update_in_progress` 只防重入，不防“路径 A 释放锁后路径 B 立刻再执行”。
- MCP/httpd 回调若在 `LvglLockGuard` 内调用 `getCurrentAngle()` 或 set/get head tools，也会和 `_stackchan_update_task`、LVGL 渲染任务竞争同一把锁。
- yaw/pitch 两个 `ScsServo` 共享同一 `_scs_bus` / UART；第一阶段修复已在 `SCS` 基类协议层加入全局 FreeRTOS mutex，让所有 UART 事务在协议层串行化，避免 MCP/httpd 任务和 update task 同时操作半双工总线造成事务交错、帧损坏、`ReadPos` 返回 `-1`、继而触发 `bus_dead`。
- `bus_dead` recovery 有 750ms 节流，但 recovery 中的 `ReadPos` 仍可能阻塞；它是安全网，不是根治。

## 关联代码

### 主锚点

- `firmware/main/hal/hal.cpp`：`_stackchan_update_task()` 的 motion update / full update 双路径、`LvglLockGuard` 持锁范围、`motion.update()` 与 `GetStackChan().update()` 的真实执行位置。
- `firmware/main/hal/hal_servo.cpp`：`ScsServo::set_angle_impl()`、`ScsServo::getCurrentAngle()`、`probe_bus_recovery()`、`kReadBeforeWriteDuringMotion`、`kReadMoveEnabled`、`record_bus_failure()`；ReadPos 进入点和 bus_dead 状态机主锚点。
- `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp`：`SCS::Read()`、`checkHead()`、`readWord()` 等协议层阻塞读取主入口；第一阶段串行化修复也在这里实现全局 FreeRTOS mutex、owner task 递归安全、`50ms` 获取超时和 `SERVO-IO` 慢事务/异常日志。
- `firmware/main/hal/drivers/FTServo_Arduino/src/SCSerial.cpp`：`SCSerial::readSCS()`、`uart_get_buffered_data_len()`、`uart_read_bytes()`、`vTaskDelay(1ms)`、`uart_wait_tx_done(..., 100ms)`；UART 层真实阻塞点。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.h` | `SCS` 基类协议层的 mutex 基础设施声明；确保所有 SCS UART 事务共享同一串行化入口。 |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCSCL.cpp` | `SCSCL::ReadPos(ID)` 调 `readWord(ID, SCSCL_PRESENT_POSITION_L)` 的入口。 |
| `firmware/main/stackchan/motion/servo.cpp` / `servo.h` | `Servo::update()`、`getCurrentAngle()`、`update_angle_anim_target()`、`stopAnimation()`、`abortAnimationNoRead()`；决定是否会通过虚函数落到硬件 `ReadPos`。 |
| `firmware/main/stackchan/motion/motion.cpp` | `Motion::update()` 顺序更新 yaw/pitch，共享 servo bus 的上层聚合入口。 |
| `firmware/main/stackchan/stackchan.h` | `StackChan::update()` 内部调用 `_motion->update()`，是 full update 路径重复 motion 的关键位置。 |
| `firmware/main/hal/hal_mcp.cpp` | `self.robot.get_head_angles`、`self.robot.set_head_angles`、`submitHeadMotion()`、`HeadMotionSchedulerModifier`；MCP/httpd 任务可能触发 `getCurrentAngle()` 或 head motion。 |
| `firmware/main/hal/board/stackchan_display.cc` | `StackChanAvatarDisplay::LvglLock()` / `lvgl_port_lock(timeout_ms)`；排查 30s 锁等待和 UI 渲染停顿。 |

## 真实调用链路

### ReadPos 同步阻塞链路

1. `Servo::update()` 推进动画，或 `Servo::getCurrentAngle()` 被查询。
2. 对 `ScsServo` 实现，进入 `ScsServo::set_angle_impl()` 或 `ScsServo::getCurrentAngle()`。
3. 需要读取当前位置时调用 `_scs_bus.ReadPos(id)`。
4. `SCSCL::ReadPos(ID)` 调用 `readWord(ID, SCSCL_PRESENT_POSITION_L)`。
5. `SCS::readWord()` 调用 `SCS::Read(ID, MemAddr, nDat, 2)`。
6. `SCS::Read()` 先 `rFlushSCS()` 清 RX，再 `writeBuf(...)` 发读指令，然后 `wFlushSCS()` 等 TX 完成，最多约 `100ms`。
7. `checkHead()` 通过 `readSCS(&bDat, 1)` 逐字节等 `0xFF 0xFF` 帧头；servo 无响应或帧损坏时，按 `IOTimeOut=10ms` 多次等待。
8. 后续再分别读 `ID+Length+Status`、Position 数据和 checksum；每段 `readSCS` 都可能因超时/空缓冲 `vTaskDelay(1ms)`。
9. 若调用栈外层仍持有 `LvglLockGuard`，整个等待期间 LVGL 渲染任务无法进入 `lv_timer_handler()` / flush，屏幕停止刷新。

### UI 锁竞争链路

1. `_stackchan_update_task` 与 LVGL port task 都在 Core 1、优先级约 `3`。
2. `_stackchan_update_task` 获取 `LvglLockGuard`。
3. 在锁内调用 `motion.update()` 或 `GetStackChan().update()` → `_motion->update()`。
4. 舵机链路进入 `ReadPos`，因无响应/总线冲突阻塞 `100-280ms`。
5. LVGL 渲染 task 被唤醒后也需要 `lvgl_port_lock`，但锁仍由 update task 持有。
6. `lv_timer_handler()` / flush 无法按时执行，屏幕黑屏或长时间不刷新。
7. 若双 update、MCP 查询或 recovery 探测继续触发 `ReadPos`，锁被反复长时间占用，表现接近卡死。

## 不要改错的位置

- 不要只把黑屏归因于背光关闭；必须同时记录 backlight 状态和 LVGL tick/flush 是否停顿。
- 不要只禁用 `kReadBeforeWriteDuringMotion` 就认为根治；`getCurrentAngle()`、MCP `get_head_angles`、auto sync、recovery `ReadPos` 仍可进入同一阻塞链路。
- 不要在 `LvglLockGuard` 内继续调用任何可能触发 `ReadPos`、`WritePos`、`Ping`、`ReadMove` 的同步 UART 事务。
- 不要假设两个轴串行 update 就没有总线并发；跨任务 MCP/httpd 回调仍可能同时碰同一 `_scs_bus`。
- 不要把 `bus_dead` recovery 当成“不会高频所以无害”；它虽然有节流，但每次探测仍可能长阻塞，并且会和 UI 锁问题叠加。
- 不要只靠 `/dev/status`、ping、USB 枚举或 heap 稳定判断问题解决；这些不能证明 LVGL lock 没被长持有，也不能证明 servo bus 没有 `ReadPos` 超时。

## 推荐修复方向

1. **Servo bus 串行化（第一阶段已落地）**：当前权威落点是 `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp` / `SCS.h` 的 `SCS` 基类协议层，而不是只在上层 `ScsServo` 包一层锁。所有 `genWrite`、`Read`、`Ping`、`writeByte`、`writeWord`、`syncWrite` 等 UART 事务都应经过同一把全局 FreeRTOS mutex；获取锁使用 `50ms` 有限超时，超时返回失败并打 `SERVO-IO` WARN，不能无限阻塞。实现必须保持 owner task 递归安全，避免 `readByte` → `Read` 这类同 task 嵌套调用自锁。
2. **UI 锁隔离**：`motion.update()`、servo bus 事务、recovery 探测不得在 `LvglLockGuard` 内执行。LVGL 锁只保护 avatar/UI 状态和渲染对象修改。
3. **ReadPos 硬超时**：降低底层 `IOTimeOut` 或在 `ScsServo::getCurrentAngle()` 外层加总耗时上限；超过阈值直接返回缓存角 / fallback，并记录 bus failure。
4. **update 去重**：拆分 `StackChan::update()` 中 motion 更新，或让 full update 在本轮已执行 motion tick 时跳过 motion；避免 motion path 与 full path 同轮重复推进 `Servo::update()`。
5. **诊断可观测性**：记录 ReadPos 耗时、LVGL 锁持有时间、当前 task/core/stack high water、UART transaction id、reset reason、backlight 状态和 LVGL tick 停顿。
6. **recovery 状态机约束**：继续保持 `flush -> quiet -> ping -> read_pos -> recovered`，但 `read_pos` 阶段也必须遵守 bus mutex、硬超时和“不持 LVGL 锁”。

## 验证标准

后续修复或排查同类黑屏时，至少验证：

- `ReadPos` 进入/退出日志包含 axis/id、task name、core、耗时；异常时不会出现单次 `>50ms` 且仍持有 LVGL 锁。
- `LvglLockGuard` 持锁时间可观测；motion / servo bus 事务移出后，持锁时间不随 `ReadPos` 失败拉长。
- LVGL tick / flush 在 servo 无响应、bus_dead、MCP `get_head_angles` 并发调用时仍持续推进，不出现长时间停顿。
- `_stackchan_update_task` 的 motion path 与 full path 不再同轮重复执行 `motion.update()`；如暂时保留双路径，应有日志证明重复路径不会触发硬件读。
- yaw/pitch 与 MCP/httpd 回调共享 `SCS` 协议层同一个 FreeRTOS mutex；并发触发时只出现排队、`50ms` 超时或 fallback，不出现 UART 帧交错。
- `probe_bus_recovery()` 的 `ReadPos` 只在 `Ping` 成功后执行，并受硬超时和 bus mutex 保护。
- 黑屏现场同时记录 `esp_reset_reason()`、backlight 状态、LVGL tick、UART 事务耗时，能区分 WDT reset、brownout、panic、背光关闭和渲染停顿。

## 关键检索词

- `ReadPos`
- `ScsServo::getCurrentAngle`
- `ScsServo::set_angle_impl`
- `SCSCL::ReadPos`
- `SCS::Read`
- `SCS::readWord`
- `checkHead`
- `SCSerial::readSCS`
- `IOTimeOut=10ms`
- `uart_wait_tx_done`
- `vTaskDelay(1ms)`
- `LvglLockGuard`
- `lvgl_port_lock`
- `_stackchan_update_task`
- `motion.update()`
- `GetStackChan().update()`
- `StackChan::update()`
- `_motion->update()`
- `_update_in_progress`
- `stackchan_motion_high_refresh_active`
- `self.robot.get_head_angles`
- `probe_bus_recovery`
- `record_bus_failure`
- `bus_dead`
- `stage=flush`
- `stage=quiet`
- `stage=ping`
- `stage=read_pos`
- `SCS`
- `SCS.h`
- `SERVO-IO`
- `50ms`
- `ServoBusManager`
- `lv_timer_handler`
- `esp_reset_reason`
