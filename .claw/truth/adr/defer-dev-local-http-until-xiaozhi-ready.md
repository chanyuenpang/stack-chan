# ADR: Defer Dev Local HTTP until XiaoZhi ready

## Status

accepted

## Context

决定：StackChan 本地 Dev HTTP server 的启动时机属于稳定性边界，不能只以 STA IP ready 作为启动条件。

原因：已完成的崩溃修复计划确认，重打包后的 App 无法进入或点击即崩溃时无法取得有效串口崩溃栈，因此采用静态审查高风险初始化链路。完成任务事实表明：当前 HTTP server 不是立即启动，但 `http_deferred_start_task` 在 XiaoZhi app 初始化前创建，且原延迟条件只等待 STA IP，不等待 XiaoZhi ready，也没有冷却窗口；这会让本地 HTTP 控制面与 XiaoZhi/App 初始化抢资源，成为当前最可能根因。

同时，计划已排除若干历史稳定点回退：performance no-op、保守 update tick、LVGL lock、dev serial no-op 均仍在。`PROJECT_VER` 与当前打包标识不一致被记录为发现项，但本次修复明确不通过改版本号解决崩溃。

## Decision

决定：`firmware/main/hal/hal_dev_local_control.cpp` 中本地 Dev HTTP server 必须延后到网络与 XiaoZhi 均稳定后再启动，并且启动任务只能创建一次。

具体规则：

- `http_deferred_start_task` 只能一次性创建，避免重复初始化 HTTP server。
- HTTP server 启动前必须同时等待 STA IP 与 `hal_bridge::is_xiaozhi_ready()`。
- XiaoZhi ready 后必须保留稳定冷却窗口；本次已采用 5000ms cooldown。
- 冷却后必须二次确认 ready 状态再启动 HTTP server。
- 若 60s 内 XiaoZhi 未 ready，则记录日志并放弃启动本地 HTTP server，不为了控制面可用性抢占 App 初始化资源。
- `PROJECT_VER` 保持 `1.4.1`；版本号错位或 OTA manifest 口径不作为本崩溃修复手段。

## Alternatives Considered

- 只等待 STA IP 后启动 HTTP server：拒绝。计划完成事实表明这仍可能早于 XiaoZhi/App 稳定，存在初始化资源竞争风险。
- 为了消除 v2.0.29 打包标识与 `PROJECT_VER` 不一致而修改源码版本号：拒绝。本次修复目标是 HTTP 初始化竞争，计划明确版本号保持 `1.4.1`。
- 继续依赖串口崩溃栈定位：暂不采用。计划背景说明当前无法捕捉有效运行日志，因此本次以已知高风险点静态审查和最小修复推进。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_dev_local_control.cpp` | 本地 Dev HTTP server 延迟启动、一次性 task guard、ready/cooldown/timeout 规则的实现锚点。 |

## Consequences

- 正向效果：降低本地 HTTP 控制面与 XiaoZhi/App 初始化抢资源导致进入 App 或点击后崩溃的风险。
- 约束：后续改动 `start_dev_local_control_server`、`http_deferred_start_task`、WiFi ready 回调、`Hal::startXiaozhi` / `Hal::xiaozhi_init` 相关初始化顺序时，必须保留“STA IP + XiaoZhi ready + cooldown + 二次确认”的门槛。
- 取舍：若 XiaoZhi 60s 内未 ready，本地 Dev HTTP 控制面会不可用；这是有意选择，优先保护 App 初始化稳定性。
- 验证锚点：本次完整 `idf.py build` 因 mqtt component 缺失无法完成；`xtensa g++ -fsyntax-only` 返回 0，静态检查确认包含一次性 task guard、STA IP + `hal_bridge::is_xiaozhi_ready()`、5000ms cooldown、二次确认与 60s 超时放弃启动。
- 设备侧观察点：后续 OTA/设备验证应显式使用修复后 bin 路径，避免默认 `firmware/build` 错包；观察 `/dev/status`、`/dev/celebrate`、`/dev/mcp/call` 是否在 XiaoZhi 稳定后可用。

## Search Terms

- `firmware/main/hal/hal_dev_local_control.cpp`
- `start_dev_local_control_server`
- `http_deferred_start_task`
- `hal_bridge::is_xiaozhi_ready()`
- `Hal::startXiaozhi`
- `Hal::xiaozhi_init`
- `start_dev_serial_wake_stop_task`
- `PROJECT_VER`
- `1.4.1`
- `5000ms cooldown`
- `60s`
- `/dev/status`
- `/dev/celebrate`
- `/dev/mcp/call`
