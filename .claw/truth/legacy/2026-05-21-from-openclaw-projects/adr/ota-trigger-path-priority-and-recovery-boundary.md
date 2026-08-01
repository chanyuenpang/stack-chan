# ADR: OTA trigger path priority and recovery boundary

## Status

accepted

## Context

决定：StackChan 从 2.0.34 升级到 2.0.35 这类非物理 OTA，应优先使用设备端已验证的 OTA 检查路径，并把远程重启 / 远程升级工具视为有前置条件和风险分级的触发手段。

原因：已完成计划确认，2.0.34 内置 Xiaozhi user-only MCP 工具 `self.reboot` 和 `self.upgrade_firmware`，但本地 Dev HTTP `/dev/mcp/call` 不映射这两个工具；当前机器缺少 `XIAOZHI_MESSAGING_TOKEN`，仅有 `XIAOZHI_MCP_TOKEN` 不能替代，HTTP Messaging API 返回 401，因此助手实际没有通过 `self.reboot` 触发升级。最终 2.0.34 -> 2.0.35 的成功触发来自用户手动操作。

## Decision

决定：后续非物理 OTA 触发按“最小风险、可观测、可停止”的优先级执行：

- 最稳路径是设备 UI `Check for Updates`，由设备主动请求 OTA manifest 与固件。
- 只有在设备已进入 Xiaozhi 且具备正确 Messaging API 鉴权时，才考虑通过 Xiaozhi 正常 MCP / user-only 通道调用 `self.reboot` 来触发 OTA 检查或首启链路。
- 本地 Dev HTTP `/dev/mcp/call` 不应被假定可以调用 `self.reboot` / `self.upgrade_firmware`；计划事实已确认 2.0.34 不映射这两个工具。
- `self.upgrade_firmware` 指定 URL 风险更高，只能作为最后备选，不能作为默认触发路径。
- OTA 失败恢复边界是保留 OTA server active 配置、固件包、server 日志与串口日志；若设备不请求 OTA 或下载失败，停止当前触发路径并选择更低风险替代路径。
- 若升级后 bootloop 或不稳定，先尝试断电冷启动；不得 USB 直刷、擦除或覆盖恢复，后续恢复路径必须重新确认。
- 成功验收必须分开记录触发来源与升级结果；不能把用户手动触发误记为助手远程 `self.reboot`。

## Alternatives Considered

- 通过本地 `/dev/mcp/call` 直接调用 `self.reboot`：拒绝。计划完成事实确认 2.0.34 本地 Dev HTTP 不映射该 user-only 工具。
- 在缺少 `XIAOZHI_MESSAGING_TOKEN` 时继续尝试 Messaging API：拒绝。计划记录该路径返回 401，`XIAOZHI_MCP_TOKEN` 不能替代。
- 默认使用 `self.upgrade_firmware` 指定 URL：拒绝。计划将它列为高风险最后备选。
- OTA 异常后 USB 直刷或擦除：拒绝。恢复方案明确禁止 USB 直刷 / 擦除，后续恢复需重新确认。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/hal_mcp.cpp` | Xiaozhi MCP / user-only 工具与远程重启能力的实现锚点。 |
| `firmware/xiaozhi-esp32/main/ota.cc` | 设备 OTA 检查、manifest 请求与固件下载锚点。 |
| `firmware/main/hal/hal_ota.cpp` | OTA URL / 设备 OTA 集成锚点。 |
| `tools/ota-mock-server/ota-mock-server.py` | OTA server 请求与固件下载日志观察锚点。 |

## Consequences

- 正向效果：OTA 触发方式与设备真实能力对齐，避免把缺 token 或不映射的远程路径误当成已执行动作。
- 约束：后续自动化汇报 OTA 时必须明确触发来源、鉴权前提和是否真正发出远程工具调用。
- 取舍：当远程鉴权不可用时，需要依赖 UI `Check for Updates` 或等待用户现场触发；这是为了避免高风险远程升级或物理刷写。
- 验证锚点：本次完成计划记录 server 收到 `POST /ota/` 与 `GET /stack-chan.bin`；设备启动 `App version 2.0.35`；`pending_verify marked valid`；`auto_open_ai_agent` 自动进入小智；`Ota current version 2.0.35 latest`；首启无 panic / Guru / WDT / stack overflow / 重启循环。

## Search Terms

- `self.reboot`
- `self.upgrade_firmware`
- `XIAOZHI_MESSAGING_TOKEN`
- `XIAOZHI_MCP_TOKEN`
- `/dev/mcp/call`
- `Check for Updates`
- `POST /ota/`
- `GET /stack-chan.bin`
- `pending_verify marked valid`
- `auto_open_ai_agent`
- `App version 2.0.35`
