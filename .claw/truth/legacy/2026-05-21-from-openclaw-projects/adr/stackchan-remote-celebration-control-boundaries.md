# ADR: StackChan remote celebration control boundaries

## Status

accepted

## Context

决定：StackChan 远控庆祝链路的长期架构边界，应以设备端已经存在的本地 LAN Dev HTTP 控制入口、MCP tool 分发、非阻塞头部运动调度、OTA URL/NVS 配置和本地音频注入链路为基础，而不是把庆祝动作做成单一阻塞式外部脚本。

原因：已完成计划确认四条能力都已有稳定实现证据链：电机控制通过独立 `_stackchan_update_task` 与 modifier 调度避免阻塞小智主循环；OTA 通过 `ota.cc` / `hal_ota.cpp`、NVS `ota_url` 与 rollback 配置支持任意版本切换；HTTP 调 MCP 通过 `/dev/mcp/call`、官方 HTTP Messaging API 与 `stackchan_mcp_dispatch_tool` 分层；唤醒、音频注入和庆祝动作通过 `hal_dev_local_control.cpp`、`/dev/wake`、`/dev/stop`、`/dev/inject_prompt`、嵌入式 WAV 资源、`AudioService::InjectPcmFrameToSendQueue`、`start_celebrate_modifier` 与 `stackchan_celebrate_tick` 串联。

决定：远控庆祝链路的长期文档入口应收敛到当前权威中文手册和实际 OTA 参数口径，删除或改链强冲突旧文档，而不是保留多套互相冲突的历史设计说明。

原因：已完成的文档清理计划确认 6 个 P0 强冲突旧文档已按固定清单删除，`docs/research/stackchan-remote-celebration-runbook.md` 已成为当前手册，失效链接已改向该手册；同时 `tools/ota-mock-server/start-upgrade.sh` 已从 `2.0.0-test` / `--force true` 改为可配置 `VERSION` 默认 `2.0.25`、`LAN_IP` 可覆盖，并使用 `--force 1`。

决定：同版本 OTA 验证和恢复应通过现有 OTA manifest 的 `force=1` 机制完成；当目标固件版本与当前版本相同，例如 `1.4.1` 到 `1.4.1`，不要为了触发升级而临时篡改源码版本号。

原因：已完成的同版本 Force OTA 计划确认：本地 `ota-mock-server.py` 以 upgrade 模式返回 `version=1.4.1` 与 `force=1` 后，设备通过用户手动 `Check for Updates` 访问 `/ota/`、下载 `stack-chan.bin` 并完成更新；收尾阶段已停止 mock server 并释放端口。

决定：点击 App 崩溃类回归排查应优先以已验证工作版本作为验收基线；当前基线是 `v2.0.29` 的 HTTP 远程控制端点清单。若同类问题已通过新版本完整端点验证闭环，不再继续采集串口崩溃日志。

原因：已完成计划确认用户已验证 `v2.0.29` 所有 HTTP 远程控制端点可用，点击 App 后崩溃问题已通过版本验证闭环；后续如再回归，应以 `v2.0.29` 为基线对比，而不是继续围绕已闭环版本追加串口采集。

## Decision

决定：后续接入 StackChan 远控庆祝时，外部系统只负责编排 HTTP/API 调用顺序；设备端继续拥有动作、音频、MCP tool 分发和 OTA 执行责任。

具体规则：

- 头部电机控制必须走现有非阻塞运动链路，优先复用 `_stackchan_update_task`、`HeadMotionSchedulerModifier`、`ScsServo::set_angle_impl` 等路径，避免在 HTTP/MCP 请求处理线程里直接做长时间舵机动作。
- MCP tool 调用必须通过已有 HTTP/MCP 入口：本地 LAN Dev HTTP `/dev/mcp/call`，或官方小智 HTTP Messaging API 的 `tools/list` / `tools/call`；工具分发边界保留在 `stackchan_mcp_dispatch_tool` 与 MCP server 内。
- 唤醒小智、停止、注入本地音频和庆祝动作应继续组合 `/dev/wake`、`/dev/stop`、`/dev/inject_prompt`、`AudioService::InjectPcmFrameToSendQueue`、`start_celebrate_modifier`、`stackchan_celebrate_tick`，不要把本地音频庆祝链路误写成远端服务端播放。
- 任意版本或同版本 OTA 应继续通过 OTA URL/NVS/manifest/rollback 链路处理；外部自动化只设置目标、`version` 与 `force=1` 并触发升级，不绕过 `ota.cc`、`hal_ota.cpp`、分区和 rollback 安全边界。
- 安全边界必须显式保留：本地 Dev HTTP 控制、官方 HTTP Messaging API、OTA、音频注入和运动控制都要按已有认证、端口、并发和失败恢复限制接入。
- 远控庆祝文档维护必须以 `docs/research/stackchan-remote-celebration-runbook.md` 为当前权威入口；不要恢复已删除的强冲突旧设计/总结文档，也不要让索引继续指向旧文档。
- 本地 OTA 快捷启动脚本必须使用纯数字版本和 `--force 1` 口径；`VERSION`、`LAN_IP` 可以作为可覆盖参数，但不要恢复 `2.0.0-test` 或 `--force true`。
- 同版本强制 OTA 的操作边界是：先确认 `firmware/build/stack-chan.bin`、本地端口和 `LAN_IP`，再启动 `tools/ota-mock-server/ota-mock-server.py --mode upgrade --firmware firmware/build/stack-chan.bin --version <current-version> --force 1`，由用户在设备端手动 `SETUP -> Firmware -> Check for Updates` 触发；成功标准以 server 日志和用户反馈为准，包括 `POST /ota/`、manifest 返回当前版本且 `force=1`、`GET /stack-chan.bin`、下载完成和设备重启进入新 app。
- 点击 App 崩溃类回归的恢复边界是：若新版本已验证所有 HTTP 远程控制端点可用，则将该版本登记为工作基线；当前基线为 `v2.0.29`。后续自动化接入和回归验收应复用 `v2.0.29` 的已验证 HTTP endpoint 清单作为对照。

## Alternatives Considered

- 把庆祝能力做成外部脚本直接控制舵机和音频：拒绝。计划完成事实表明设备端已有非阻塞调度和音频注入链路，绕过它们会增加阻塞主循环、动作竞争和状态不一致风险。
- 只通过服务端 MCP 配置表达庆祝动作：拒绝。计划完成事实表明本地可调用工具、HTTP 控制入口、音频资源和庆祝 tick 都在设备端链路中，服务端配置不应越过设备端执行边界。
- 为 OTA 另建独立升级通道：拒绝。计划完成事实表明现有 OTA URL、NVS、分区和 rollback 配置已经承担任意版本切换、同版本强制升级与失败恢复职责。
- 为触发同版本升级而修改源码版本号：拒绝。计划完成事实表明 manifest 的 `force=1` 已足以让设备下载同版本固件，修改源码版本会制造不必要的版本漂移。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_servo.cpp` | 舵机底层控制与非阻塞运动链路锚点。 |
| `firmware/main/stackchan` | motion 抽象、modifier、`_stackchan_update_task` 与庆祝动作调度锚点。 |
| `firmware/main/hal/hal_dev_local_control.cpp` | 本地 LAN Dev HTTP 控制入口，包含 `/dev/wake`、`/dev/stop`、`/dev/inject_prompt` 等链路。 |
| `firmware/xiaozhi-esp32/main/ota.cc` | OTA 客户端实现锚点。 |
| `firmware/main/hal/hal_ota.cpp` | OTA URL/NVS 与设备 OTA 集成锚点。 |
| `tools/ota-mock-server/ota-mock-server.py` | 本地 OTA server、任意版本切换和同版本 `force=1` OTA 验证锚点。 |
| `tools/ota-mock-server/start-upgrade.sh` | 本地 OTA 快捷启动参数口径锚点，使用 `VERSION`、`LAN_IP` 与 `--force 1`。 |
| `docs/research/stackchan-remote-celebration-runbook.md` | 远控庆祝当前权威中文手册与文档入口。 |

## Consequences

- 正向效果：OpenClaw 或其他外部系统可以用 HTTP/API 编排庆祝动作和 OTA 准备动作，同时保持设备端对实时运动、音频注入、MCP 分发、用户触发更新和 OTA 安全恢复的所有权。
- 约束：新增自动触发、HTTP 封装或文档合并时，必须按四条既有链路接入；不能在外部自动化里重写设备端调度、直接抢占音频队列或绕过 OTA rollback。
- 文档后果：后续维护应更新当前 runbook，而不是复活已删除的强冲突旧文档；README/索引链接也应指向 runbook。
- 验证锚点：后续回归应覆盖 curl / Python CLI 调用示例、本地 `/dev/*` API、MCP `tools/list` / `tools/call`、OTA mock server、安全边界、并发限制、常见失败点，以及 `start-upgrade.sh` 不含 `2.0.0-test` / `--force true` 且包含 `--force 1`。
- 验收基线：`v2.0.29` 已作为点击 App 后 HTTP 远程控制端点可用的工作版本；同类回归优先与该版本的已验证 HTTP endpoint 清单对比。
- 恢复策略：同版本强制 OTA 异常时先停止 mock server；必要时恢复设备 `ota_url` 到官方地址；可用 no-upgrade/confirm 模式确认当前 app valid；若新 app 崩溃则依赖 rollback，必要时回退到已知可用固件。

## Search Terms

- `_stackchan_update_task`
- `HeadMotionSchedulerModifier`
- `ScsServo::set_angle_impl`
- `/dev/mcp/call`
- `/dev/wake`
- `/dev/stop`
- `/dev/inject_prompt`
- `stackchan_mcp_dispatch_tool`
- `AudioService::InjectPcmFrameToSendQueue`
- `start_celebrate_modifier`
- `stackchan_celebrate_tick`
- `ota.cc`
- `hal_ota.cpp`
- `ota_url`
- `ota-mock-server.py`
- `start-upgrade.sh`
- `firmware/build/stack-chan.bin`
- `force=1`
- `SETUP -> Firmware -> Check for Updates`
- `POST /ota/`
- `GET /stack-chan.bin`
- `stackchan-remote-celebration-runbook.md`
- `VERSION`
- `LAN_IP`
- `--force 1`
- `2.0.0-test`
- `--force true`
- `v2.0.29`
- `HTTP endpoint`
