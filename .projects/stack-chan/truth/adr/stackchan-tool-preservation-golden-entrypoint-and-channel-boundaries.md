# ADR: StackChan tool preservation uses golden entrypoint and channel boundaries

## Status

proposed

## Context

决定：StackChan 工具成果后续需要用统一黄金入口、doctor 与 smoke test 保全，而不是临场猜入口或混用不同控制通道。

原因：已完成的“StackChan 工具成果盘点与保全审计”计划记录，核心工具成果仍在，但主要风险来自入口分裂、凭据缺失、service 口径混淆，以及缺少黄金入口 / doctor。审计明确区分了本地 HTTP 入口、Xiaozhi 云端 messaging / MCP 入口、USB 串口入口和 OTA 服务入口；这些通道的鉴权、运行前提和风险边界不同，不能互相替代。

后续“StackChan 工具链收尾与文档保全”已落地本地 reboot 最小闭环：本地 `/dev/mcp/call` dispatcher 支持完整 `self.system.reboot`，CLI 侧 `remote_control.py reboot --confirm` 可调用该 tool；默认不刷机、不写设备、不写 NVS、不触发 OTA，也没有新增独立 `/dev/reboot` route。

同一收尾阶段已落地 `ops/bin/stackchan-doctor` 只读 doctor：默认检查 OTA user service、本机 OTA manifest / bin、`active.json`、active release bin、bin app desc version、USB 串口和 Xiaozhi token 存在性；默认不访问设备状态，只有 `--check-device` 才只读 `GET /dev/status`。doctor / smoke test / runbook 仍保持 proposed 约束：动作类能力必须有显式 `--confirm` / `--allow-action`；token 只检查存在性，不输出原文、片段、哈希或任何可复用凭据。

## Decision

决定：后续 StackChan 工具、运维脚本和排障流程必须按“先识别通道，再按黄金入口执行，再用 doctor / smoke test 自检”的策略收敛。

具体规则：

- 本地 HTTP、Xiaozhi 云端 messaging / MCP、USB 串口、OTA 服务必须作为不同入口维护；文档和脚本不得把它们写成可随意互换的同一能力。
- `XIAOZHI_MCP_TOKEN` 与 `XIAOZHI_MESSAGING_TOKEN` 必须分开描述和校验；缺少 Messaging token 时，云端设备调用应判定不可用，不能用 MCP token 代替。
- `stackchan-ota.service` 的有效检查口径以 user systemd 为准；只检查 system systemd 会造成“未安装 / 不存在”的误判。
- 远程重启路线必须先明确实际入口：云端 messaging 依赖 `XIAOZHI_MESSAGING_TOKEN` secrets；本地 Dev HTTP 已通过 `/dev/mcp/call` dispatcher 接入 `self.system.reboot`，但不得假设它与云端 dispatcher 对所有 tool 的支持范围一致。
- 本地 reboot 黄金入口已落地：本地 `/dev/mcp/call` dispatcher 复用已有 `confirm` / `delay_ms` / `reason` / `scheduleSystemReboot()` / `esp_restart` 逻辑，CLI 侧通过 `remote_control.py reboot --confirm` 调用完整 `self.system.reboot`；必须显式 `--confirm`，不得绕过确认，也不得新增无确认的 `/dev/reboot`。
- `ops/bin/stackchan-doctor` 是当前已落地的只读 doctor；默认检查 OTA user service、`GET/POST /ota/`、`HEAD /stack-chan.bin`、`ops/ota/active.json`、`exp-pkg/active-release/stack-chan.bin` size/sha256、bin app desc `App version`、token 存在性与 USB 串口；支持 `--json` 机器可读输出。
- doctor 默认不访问设备 endpoint；只有显式 `--check-device` 才只读 `GET /dev/status`。
- doctor / smoke test 的动作类检查必须标记为 `skipped_destructive`；只有显式 `--allow-action` 才能执行动作类能力。
- token 检查只能报告存在性或缺失状态，不得输出 token 原文、片段、哈希或任何可复用凭据。
- 发布到设备只能走 OTA；不得把 USB、`esptool` 或 `idf.py flash` 直刷当作默认发布 / 恢复路径。
- runbook、doctor 和 smoke test 应固化能力矩阵：能力、入口路径 / 命令、当前状态、证据、失效原因、风险、保全动作和后续计划建议。

## Alternatives Considered

- 临场按记忆选择入口：拒绝。审计计划要求输出必须基于证据路径 / 命令，核心问题也正是入口分裂导致反复踩坑。
- 混用 `XIAOZHI_MCP_TOKEN` 与 `XIAOZHI_MESSAGING_TOKEN`：拒绝。计划事实记录二者容易混用，且当前 Messaging token 缺失会导致云端设备调用不可用。
- 用 system systemd 检查 `stackchan-ota.service`：拒绝。计划事实记录当前有效口径是 user systemd，system 口径会误判。

## Related Code

| Path | Role |
| ---- | ---- |
| `tools/` | StackChan 已落地工具入口的盘点范围。 |
| `scripts/` | 运维脚本与辅助命令入口的盘点范围。 |
| `docs/` | runbook / 保全文档入口的盘点范围。 |
| `ops/` | 运维能力入口的盘点范围。 |
| `remote/` | 远程调用能力入口的盘点范围。 |
| `/dev/mcp/call` | 本地 HTTP MCP 调用入口；不得默认等同于云端 dispatcher。 |
| `self.system.reboot` | 远程重启能力锚点；MCP 注册层与本地 `/dev/mcp/call` dispatcher 已支持，本地 CLI 入口为 `remote_control.py reboot --confirm`。 |
| `stackchan-ota.service` | OTA 服务检查锚点，当前有效检查口径为 user systemd。 |

## Consequences

- 正向效果：后续排障和发布前检查可以先用统一能力矩阵确认入口、凭据、服务口径和当前可用性，减少反复猜入口。
- 约束：新增 runbook、doctor 或 smoke test 时，必须显式区分本地 HTTP、云端 messaging / MCP、USB 串口和 OTA 服务，而不是只写一个“远程控制”总称。
- 取舍：本地 reboot dispatcher / CLI 闭环和只读 doctor 已存在；smoke test / runbook 仍不能声称已完全落地。动作类自检仍应默认 skipped，只有显式 `--allow-action` 才执行。
- 验证锚点：本地 reboot 收尾验证覆盖 `python3 -m py_compile StackChan/tools/remote_control/remote_control.py` 与 firmware build；未连接设备、未调用 `/dev/mcp/call`、未触发重启、未触发 OTA、未写 NVS、未刷机。doctor 验证覆盖默认模式与 `--json` 模式；默认模式未访问设备动作端点，`/dev/status` 只在 `--check-device` 下只读访问；当前环境 token 缺失会让 overall 为 `warning`，但 OTA/manifest/bin/app_desc 核心检查可为 `ok`。

## Search Terms

- `XIAOZHI_MCP_TOKEN`
- `XIAOZHI_MESSAGING_TOKEN`
- `stackchan-ota.service`
- `user systemd`
- `system systemd`
- `/dev/mcp/call`
- `self.system.reboot`
- `Xiaozhi Messaging`
- `Xiaozhi MCP`
- `golden entrypoint`
- `doctor`
- `ops/bin/stackchan-doctor`
- `--json`
- `--check-device`
- `GET /ota/`
- `POST /ota/`
- `HEAD /stack-chan.bin`
- `active.json`
- `exp-pkg/active-release/stack-chan.bin`
- `App version`
- `smoke test`
- `remote_control.py`
- `--confirm`
- `--allow-action`
- `skipped_destructive`
- `esp_restart`
