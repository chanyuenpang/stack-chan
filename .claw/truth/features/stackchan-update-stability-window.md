# StackChan App 进入阶段更新稳定窗口

## 结论

StackChan 点击进入 XiaoZhi/App 后的稳定性边界，不应只看本地 Dev HTTP 是否启动；更关键的是 `_stackchan_update_task()` 在 XiaoZhi 非 idle / App 初始化阶段是否保持 2.0.5 的保守更新窗口。当前长期主嫌是：非 idle task wake 回到 `50ms`，并且 `stackchan_motion_high_refresh_active()` / active motion tick 可能绕开 `150ms` 保守节奏，使 StackChan update 与 XiaoZhi 状态切换、显示更新、音频初始化重新抢 `LVGL lock`、CPU、servo/IO 总线。

一句话：**HTTP 可能是噪声或放大器，但 App 进入阶段崩溃不能只归因于 HTTP；必须同时核对 StackChan 更新节奏是否回归激进。**

## 长期行为 / 规则

- 2.0.5 的稳定窗口由三类条件共同组成：`request_stackchan_performance_mode()` no-op、非 idle 更新节奏保持约 `150ms`、`vTaskDelay` 放在 `LvglLockGuard` 外。
- `request_stackchan_performance_mode()` 当前源码层面是 no-op，`is_stackchan_performance_mode_active()` 固定返回 `false`；不要把 performance lease 当作当前主嫌。
- `vTaskDelay` 必须继续在 `LvglLockGuard` 外；当前这一点符合历史稳定点，排查时不要误判成“持锁 delay”。
- App 进入阶段如果 `_stackchan_update_task()` 非 idle delay 是 `50ms`，即使 full update 间隔仍是 `150ms`，任务也会更频繁醒来并参与调度竞争。
- active motion / celebrate / head scheduler 的高刷新分支如果把 motion tick 提到 `50ms`，会绕开“非 idle 保守 150ms”的历史意图。
- `StackChan::update()` 内部仍会调用 `_motion->update()`；如果 `_stackchan_update_task()` 又单独执行 `motion.update()`，full update 与 independent motion tick 可能在对齐时重复推进 motion。当前确认存在两条路径：约 `50ms` 的 `motion.update()` / `stackchan_celebrate_tick()`，以及约 `150ms` 的 `GetStackChan().update()`；full update 内部还会 `modifier_pool.forEach(_update)` / `cleanup()` 后再 `_motion->update()`，因此 `Servo::update()` 可能被调用两次，依赖 `_update_in_progress` guard 防重入。
- XiaoZhi `SetStatus()` 在 App 进入阶段会持有 display/LVGL lock，同时修改 StackChan modifier、avatar mouth/speech、LED RGB 与 `_is_xiaozhi_idle`；这与 StackChan update task 操作的是同一批对象/锁/总线。
- Dev HTTP 当前若被 `CMakeLists.txt` `FORCE ON` 编进 release-like build，应视为噪声/放大器和安全边界问题，但历史上“禁用 dev HTTP 仍崩”的事实说明它不是充分根因。

## 关联代码

### 主锚点

- `firmware/main/hal/hal.cpp`：`_stackchan_update_task()` 的 idle/non-idle delay、full update interval、独立 motion tick、`LvglLockGuard` 位置和 `Hal::startXiaozhi()` task 创建链路。
- `firmware/main/stackchan/stackchan.h`：`StackChan::update()` 内部统一更新 modifier、avatar、`_motion->update()`、左右 neon light，是 full update 是否重复 motion 的关键锚点。
- `firmware/main/hal/board/stackchan_display.cc`：XiaoZhi/App 状态切换时 `SetStatus()` 持有 `DisplayLockGuard` 并改 StackChan modifier、avatar、LED 与 idle 状态。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/hal_stackchan_performance.cpp` | performance mode 当前 no-op；`request_stackchan_performance_mode()` 忽略 reason/ttl，`is_stackchan_performance_mode_active()` 固定 `false`。 |
| `firmware/main/hal/hal_mcp.cpp` | `stackchan_motion_high_refresh_active()`、`HeadMotionSchedulerModifier`、celebrate/head scheduler 高刷新来源。 |
| `firmware/main/hal/hal_servo.cpp` | servo 写入和 `kWriteIntervalMs = 200` 限流；50ms wake 仍会增加逻辑执行、锁竞争与必要时总线写入压力。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | 本地 Dev HTTP 控制面；可能放大初始化资源竞争，但不应作为唯一根因。 |
| `firmware/CMakeLists.txt` | `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`、`STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP` 的默认/强制开关位置。 |
| `build-active-release-2.0.25/compile_commands.json` | 当前 build 是否实际编入 `hal_stackchan_performance.cpp`、dev HTTP 等能力的只读核对入口。 |
| `build-active-release-2.0.25/CMakeCache.txt` | 当前 build 中 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` / `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP` 是否为 `ON` 的核对入口。 |

## 真实调用链路

1. `Hal::startXiaozhi()` 创建独立 `_stackchan_update_task()`，该任务与 XiaoZhi 主流程并行运行。
2. `_stackchan_update_task()` 根据 XiaoZhi idle/non-idle 状态决定 full update 间隔与 task delay；历史稳定点要求非 idle 也保持保守窗口。
3. full update 分支持有 `LvglLockGuard` 后调用 `GetStackChan().update()`。
4. `StackChan::update()` 更新 modifier、avatar，并继续调用 `_motion->update()` 与左右 neon light update。
5. 独立 motion tick 分支也会持有 `LvglLockGuard`，调用 `motion.update()` 和 `stackchan_celebrate_tick(GetStackChan(), now_ms)`。
6. `stackchan_motion_high_refresh_active()` 若因 `g_celebrate_active` 或 `HeadMotionSchedulerModifier::isHighRefreshActive()` 返回 true，motion update interval 可能进入 `50ms`。
7. XiaoZhi 进入 App / 状态变化时，`stackchan_display.cc` 的 `SetStatus()` 持有 `DisplayLockGuard`，同步修改 StackChan modifier、avatar speech/mouth、RGB LED、`_is_xiaozhi_idle`。
8. `DisplayLockGuard` 和 `_stackchan_update_task()` 的 `LvglLockGuard` 底层都走 `lvgl_port_lock(...)`，因此 App 进入阶段二者会争同一把 LVGL lock；LED refresh 还会落到 IO expander，motion update 还会触达 servo 逻辑。

## 不要改错的位置

- 不要只在 `hal_dev_local_control.cpp` 找崩溃根因；HTTP 延后启动是稳定性边界之一，但 2.0.5 稳定窗口被 50ms wake / high refresh motion 打破时，同样会在 App 进入阶段制造资源竞争。
- 不要看到 full update interval 是 `150ms` 就认为完全恢复 2.0.5；还必须核对 `_stackchan_update_task` 的实际 `vTaskDelay` 和 independent motion tick interval。
- 不要忽略 `StackChan::update()` 内部的 `_motion->update()`；如果外层也单独 tick motion，就存在双路径 motion update。
- 不要把 `request_stackchan_performance_mode()` 当成仍会提高频率的租约机制；当前它是 no-op，真实节奏来自 `_stackchan_update_task()` 与 high refresh 判定。
- 不要把 `LvglLockGuard` 与 `DisplayLockGuard` 当成互不相关；它们底层都争 `lvgl_port_lock(...)`。

## 最小修复方向

- 先恢复 2.0.5 保守节奏：非 idle `vTaskDelay` 从 `50ms` 回到约 `150ms`，App 进入阶段不要让 active motion tick 触发 `50ms`。
- 保证 motion update 只有一条节奏来源：要么拆出不含 motion 的 `StackChan` full update，要么 full update 不再重复调用内部 `_motion->update()`。
- 在 `hal_bridge::is_xiaozhi_ready()` 前，或 XiaoZhi 非 idle 初始阶段，禁止 `stackchan_motion_high_refresh_active()` 打开 50ms high refresh；等 STANDBY 稳定后再允许 celebrate/head scheduler 高刷新。
- 将 Dev HTTP 默认强制开启改成更保守的 release 边界；这不是主根因修复，但能减少噪声并避免误判。

## 验证标准

后续修改 App 崩溃、刷新节奏、head scheduler 或 celebrate tick 时，至少验证：

- `request_stackchan_performance_mode()` 仍为 no-op，或若重新启用必须明确说明启用条件、TTL 与 App 进入阶段影响。
- `_stackchan_update_task()` 的 `vTaskDelay` 仍在 `LvglLockGuard` 外。
- XiaoZhi 非 idle / App 进入阶段 task wake、full update、motion update 都不再绕开保守 `150ms` 窗口。
- full update 与 independent motion tick 不会在同一轮重复执行 `motion.update()`；若暂时保留双路径，必须确认 `_update_in_progress` guard 覆盖重入，并记录两条 update 路径对齐时的行为。
- `SetStatus()` 与 StackChan update task 的 LVGL lock 竞争、LED IO refresh、servo update 路径在 App 进入阶段不会形成高频抢占。
- 当前 build 的 `compile_commands.json` / `CMakeCache.txt` 与源码一致，避免只看源码没确认真实构建开关。
- Dev HTTP 是否开启要单独记录；若开启，作为放大器/噪声处理，不要覆盖更新节奏排查。

## 关键检索词

- `_stackchan_update_task`
- `vTaskDelay(pdMS_TO_TICKS(is_idle ? 20 : 50))`
- `full_update_interval_ms`
- `motion_update_interval_ms`
- `stackchan_motion_high_refresh_active`
- `g_celebrate_active`
- `HeadMotionSchedulerModifier::isHighRefreshActive`
- `StackChan::update()`
- `_motion->update()`
- `LvglLockGuard`
- `DisplayLockGuard`
- `lvgl_port_lock`
- `StackChanDisplay::SetStatus`
- `GetHAL().refreshRgb()`
- `ScsServo::set_angle_impl`
- `kWriteIntervalMs`
- `request_stackchan_performance_mode`
- `is_stackchan_performance_mode_active`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`
