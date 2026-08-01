# ADR: unified device control uses capability-transport decoupling

## Status

accepted

## Context

决定：StackChan 设备控制框架长期采用“capability 与 transport 解耦”的统一控制模型，而不是继续维持 HTTP 一套、USB 半套、MCP 再一套的历史分叉实现。

原因：完成计划《统一设备控制框架（lan-usb）》已明确记录，目标是把控制能力从传输通道中解耦，建立统一 capability 模型、firmware 统一 dispatcher、LAN/USB 双 transport 与 host 侧统一 CLI，使 `reboot`、`wake`、`stop`、`toggle`、`status`、`inject`、`mcp` 等能力在 HTTP 和 USB 上语义一致、底层共用、行为可验证。计划中的已完成任务进一步确认：firmware 已新增统一 dispatcher，HTTP 与 USB 共用同一 capability 实现；host `remote_control.py` 已统一支持 `lan|usb|auto`；USB 已升级为 `JSON line + legacy fallback`；`mcp_call over USB` 已打通；`play-sound` 也已纳入统一双通道，不再保留框架层面的明确 LAN-only 偏置。

## Decision

决定：以后新增或维护设备控制能力时，必须先归入统一 capability 层，再通过具体 transport 暴露；transport 只负责承载与路由，不再各自定义独立业务语义。

具体规则：

- firmware 侧以统一 dispatcher 作为设备控制主入口，HTTP 与 USB 共用同一 capability handler 实现。
- host 侧统一控制入口是 `StackChan/tools/remote_control/remote_control.py`，并通过 `lan|usb|auto` transport 抽象暴露同一套命令面。
- USB 结构化控制协议采用 `JSON line + legacy fallback`：新能力优先走结构化 JSON 通道，legacy 文本兼容只作为基础命令保底，不再扩展为第二套长期协议面。
- 高级能力统一通过 `mcp_call` 主干收口；`mcp_call over USB` 是让 `head`、`led`、`reminder` 及同类能力自然进入双通道框架的标准路径。
- `play-sound` 已纳入统一 dispatcher 与 USB/HTTP 双通道，后续不应再接受“某能力长期只属于 LAN 通道”的框架性偏置，除非有新的明确 ADR 重新定义边界。
- 构建与链接边界上，统一控制层应通过正式可见 helper 复用 MCP 分发能力，避免依赖匿名命名空间内部符号，防止 transport 统一后再次出现链接/可见性回归。

## Alternatives Considered

- 继续为 USB 单独补手写子命令：拒绝。计划记录明确指出，这会继续扩大“通道即语义”的历史债务，不利于能力长期对齐。
- 让高级能力继续长期保持 LAN-only：拒绝。计划已完成 `mcp_call over USB` 与 `play-sound` 双通道收敛，说明统一框架优先级高于临时通道特判。
- 各通道分别实现 reboot、MCP、prompt 注入等业务语义：拒绝。已完成任务与 retrospective 都把统一 dispatcher 视为防回归主干。

## Related Code

| Path | Role |
| ---- | ---- |
| `StackChan/tools/remote_control/remote_control.py` | host 统一控制入口；承载 `lan|usb|auto` transport 抽象。 |
| `StackChan/firmware/main/hal/hal_dev_local_control.cpp` | HTTP 控制入口，已改为统一 dispatcher 调用链。 |
| `StackChan/firmware/main/hal/hal_dev_serial.cpp` | USB Serial 控制入口；支持 `JSON line + legacy fallback`。 |
| `StackChan/firmware/main/hal/hal_device_control.cpp` | 统一 capability dispatcher 主锚点。 |
| `StackChan/firmware/main/hal/hal_mcp.cpp` | `mcp_call` 收口与统一 helper 锚点。 |

## Consequences

- 正向效果：设备控制能力从“按通道复制实现”收敛为“按 capability 统一实现”，后续新增能力时可以同步获得 HTTP/USB 一致语义与可验证路径。
- 约束：后续扩展控制能力时，应优先补统一 dispatcher / capability 层，而不是先在某个 transport 上做临时特供。
- 协议取舍：USB 继续保留 legacy fallback 作为兼容层，但长期可扩展能力必须优先走结构化 JSON 通道。
- 防回归锚点：统一控制层与旧 MCP 内部符号边界必须保持清晰；如果再次把统一层绑到匿名内部实现，容易重演构建或链接失败。
- 验证锚点：计划已将以下事实视为完成事实——统一 dispatcher 接入 HTTP/USB、host CLI 统一 transport、USB `JSON line + legacy fallback`、`mcp_call over USB` 打通、`play-sound` 收进双通道、最终复验 PASS、构建通过并已推送。

## Search Terms

- `capability 与 transport 解耦`
- `remote_control.py`
- `lan|usb|auto`
- `hal_dev_local_control.cpp`
- `hal_dev_serial.cpp`
- `hal_device_control.cpp`
- `hal_mcp.cpp`
- `JSON line + legacy fallback`
- `mcp_call over USB`
- `play-sound`
- `unified dispatcher`
