# ADR: Plan Complete 由 Linux watcher 直连 Stack-chan 官方庆祝端点

## Status

proposed

## Context

决定先行：Plan Complete 自动庆祝应从「Agent/SOUL.md 主动触发」转为「Linux 文件 watcher 自动触发」。原因是庆祝属于系统自动化事件，不应依赖某次 agent 回复是否执行了 `SOUL.md` 中的兜底命令。

现有 ADR 已记录过 OpenClaw ↔ Stack-chan 的 WS Bridge 与 SOUL.md curl 双触发方案；后续官方固件路线确认 `POST /api/celebrate` 已是 Stack-chan 官方固件可用端点。因此新的自动化目标是：监听 plan 文件或 `todo.json` 的 `completed` 状态后，直接调用官方固件 HTTP API。

当前 plan 仍为 `active`，尚未记录实现完成；但 `keyDecisions` 已明确给出未来实现约束，因此本 ADR 以 `proposed` 记录该设计方向。

## Decision

Plan Complete 自动庆祝由 Linux 文件 watcher 负责触发，不依赖 agent 根据 `SOUL.md` 手动执行。

具体规则：

1. Linux 侧 watcher 监听 OpenClaw plan 文件或 `todo.json` 的 `completed` 状态。
2. 检测到 completed 后，由 watcher 直接向 Stack-chan 官方固件端点发送请求：`POST http://192.168.0.168:8080/api/celebrate`。
3. `SOUL.md` 只保留为行为说明或兜底提示，不作为自动化执行机制。
4. 若复用既有脚本，应优先复用 `ws-bridge.js` / `ws-bridge-server.js` 中已有的文件监听思路，但触发目标改为直连设备端点。

## Alternatives Considered

- 继续依赖 `SOUL.md` 中的 curl 指令：被拒绝，因为它要求 agent 在完成 plan 时主动执行，自动化链路不稳定。
- 继续通过 WS Bridge 中转庆祝：计划未明确完全废弃，但对官方固件 `POST /api/celebrate` 场景来说不是必需路径；直连端点更短、更少依赖。

## Related Code

| Path | Role |
| ---- | ---- |
| `SOUL.md` | 仅作为 Plan Complete 行为说明/兜底，不作为主自动化执行机制 |
| `scripts/ws-bridge.js` | 可复用文件监听逻辑的候选脚本 |
| `scripts/ws-bridge-server.js` | 可复用文件监听/桥接逻辑的候选脚本 |
| `todo.json` | watcher 需要监听 completed 状态的候选状态文件 |

## Consequences

- 正向：Plan Complete 庆祝从对话行为中解耦，减少 agent 漏执行或回复中断导致的漏庆祝。
- 正向：直连官方固件 `POST /api/celebrate`，链路比 WS Bridge 中转更短，运行依赖更少。
- 风险：设备 IP `192.168.0.168` 是环境内固定地址，网络变化时 watcher 需要配置更新。
- 风险：plan 仍处于 `active`，实现脚本和后台验证尚未完成；本 ADR 只能约束设计方向，不能声明实现已落地。
- 验证锚点：后台启动 watcher 后，通过测试 plan 标记 `completed` 验证设备自动庆祝。

## Search Terms

- `Plan Complete`
- `completed`
- `todo.json`
- `SOUL.md`
- `ws-bridge.js`
- `ws-bridge-server.js`
- `POST /api/celebrate`
- `http://192.168.0.168:8080/api/celebrate`
