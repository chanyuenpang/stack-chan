# ADR: StackChan tool preservation uses golden entrypoint and channel boundaries

## Status

accepted

## Context

决定：StackChan 工具成果后续需要用统一黄金入口、doctor 与 smoke test 保全，而不是临场猜入口或混用不同控制通道。

原因：已完成的“StackChan 工具成果盘点与保全审计”计划记录，核心工具成果仍在，但主要风险来自入口分裂、凭据缺失、service 口径混淆，以及缺少黄金入口 / doctor。审计明确区分了本地 HTTP 入口、Xiaozhi 云端 messaging / MCP 入口、USB 串口入口和 OTA 服务入口；这些通道的鉴权、运行前提和风险边界不同，不能互相替代。

后续“StackChan 工具链收尾与文档保全”已落地本地 reboot 最小闭环：本地 `/dev/mcp/call` dispatcher 支持完整 `self.system.reboot`，CLI 侧 `remote_control.py reboot --confirm` 可调用该 tool；默认不刷机、不写设备、不写 NVS、不触发 OTA，也没有新增独立 `/dev/reboot` route。

同一收尾阶段已落地 `ops/bin/stackchan-doctor` 只读 doctor：默认检查 OTA user service、本机 OTA manifest / bin、`active.json`、active release bin、bin app desc version、USB 串口和 Xiaozhi token 存在性；默认不访问设备状态，只有 `--check-device` 才只读 `GET /dev/status`。doctor、OTA release 与 runbook 已进入 accepted 边界：`ops/bin/stackchan-doctor` 保持只读诊断，`ops/bin/stackchan-ota-release` 负责本地 OTA 发布与回退，`docs/runbook/stackchan-ops.md` 作为人工运维入口；动作类能力必须有显式 `--confirm` / `--allow-action`；token 只检查存在性，不输出原文、片段、哈希或任何可复用凭据。

后续运维工具箱脚本化计划已把 P0 常用检查固化为 `ops/bin/stackchan-*` 工具：`stackchan-device-version`、`stackchan-usb-logs`、`stackchan-celebrate-diagnose`，并通过 `stackchan-doctor` 的扩展参数索引这些只读诊断。该计划的核心决策不是新增临时脚本，而是把版本核对、USB/串口日志聚合、庆祝失败日志诊断沉淀为可复用、可 JSON 输出、默认无设备动作的运维入口，并要求 `docs/runbook/stackchan-ops.md` 记录安全边界和命令索引。

收尾阶段还记录了一次实际防回归：曾出现 manifest 标成 `2.0.36` 但 bin app_desc 仍是 `2.0.35` 的假升版本，导致设备重复 OTA。因此 OTA 发布不再允许手工拼 `active.json`；必须由 `ops/bin/stackchan-ota-release` 校验 manifest version、`firmware.version`、bin app desc version、size、sha256 与 `force=0` 口径一致，发布失败时恢复旧 active release / manifest 并重启 user 级 `stackchan-ota.service`。

后续 2.0.45 语音注入验收计划确认：当目标是验证“小智被唤醒并实际调用 MCP tool”的完整链路时，黄金入口是 `tools/remote_control/remote_control.py inject-prompt` / `POST /dev/inject_prompt`，使用固件内嵌 WAV 注入，无需用户现场人工说话；`/dev/celebrate` 或直接 `/dev/mcp/call` 只能验证局部动作 / MCP 入口，不能替代 XiaoZhi 语音链路验收。该入口与判定标准已落入 `docs/runbook/voice-injection-celebrate-e2e.md`，避免下次重新临场调研。

## Decision

决定：后续 StackChan 工具、运维脚本和排障流程必须按“先识别通道，再按黄金入口执行，再用 doctor / smoke test 自检”的策略收敛。

具体规则：

- 本地 HTTP、Xiaozhi 云端 messaging / MCP、USB 串口、OTA 服务必须作为不同入口维护；文档和脚本不得把它们写成可随意互换的同一能力。
- `XIAOZHI_MCP_TOKEN` 与 `XIAOZHI_MESSAGING_TOKEN` 必须分开描述和校验；缺少 Messaging token 时，云端设备调用应判定不可用，不能用 MCP token 代替。
- `stackchan-ota.service` 的有效检查口径以 user systemd 为准；只检查 system systemd 会造成“未安装 / 不存在”的误判。
- 远程重启路线必须先明确实际入口：云端 messaging 依赖 `XIAOZHI_MESSAGING_TOKEN` secrets；本地 Dev HTTP 已通过 `/dev/mcp/call` dispatcher 接入 `self.system.reboot`，但不得假设它与云端 dispatcher 对所有 tool 的支持范围一致。
- 本地 reboot 黄金入口已落地：本地 `/dev/mcp/call` dispatcher 复用已有 `confirm` / `delay_ms` / `reason` / `scheduleSystemReboot()` / `esp_restart` 逻辑，CLI 侧通过 `remote_control.py reboot --confirm` 调用完整 `self.system.reboot`；必须显式 `--confirm`，不得绕过确认，也不得新增无确认的 `/dev/reboot`。
- `ops/bin/stackchan-doctor` 是当前已落地的只读 doctor；默认检查 OTA user service、`GET/POST /ota/`、`HEAD /stack-chan.bin`、`ops/ota/active.json`、`exp-pkg/active-release/stack-chan.bin` size/sha256、bin app desc `App version`、token 存在性与 USB 串口；支持 `--json` 机器可读输出。
- `ops/bin/stackchan-device-version` 是设备版本核对入口，必须区分 `device_running_version`、`ota_server_version` 与 `active_bin_app_desc`；HTTP 侧只读 `GET /dev/status`，固件侧只允许追加 `app_version` / `project_name` / `idf_version` 这类只读字段，不改变既有响应语义或动作逻辑。
- `ops/bin/stackchan-usb-logs` 是 USB / 串口日志聚合入口，默认只检查 `/dev/ttyACM*` 与 `/tmp/stackchan-serial*.log` 等既有日志，不打开串口、不发送字节；输出应支持 `--json`、关键词 grep 和 tail/context 诊断。
- `ops/bin/stackchan-celebrate-diagnose` 是庆祝失败只读诊断入口，只分析已有串口日志，不调用 `/dev/celebrate`；诊断应围绕 `queued` / `started` / `finished`、LED step、motion frame、`bus_dead`、`force_release`、finish reason 等时间线锚点。
- `stackchan-doctor` 可以通过显式扩展参数索引 P0 子工具，例如 `--include-usb-logs` 与 `--include-celebrate-logs`；默认输出必须保持兼容，子工具 unsupported 应映射为 skipped / warning，而不是触发动作端点或依赖小智 token。
- doctor 默认不访问设备 endpoint；只有显式 `--check-device` 才只读 `GET /dev/status`。
- doctor / smoke test 的动作类检查必须标记为 `skipped_destructive`；只有显式 `--allow-action` 才能执行动作类能力。
- `docs/runbook/stackchan-ops.md` 是工具链人工入口，应优先引用 golden entrypoint、doctor 与 release 脚本，而不是复制临场命令。
- 后续 OTA 发布统一使用 `ops/bin/stackchan-ota-release`，不得手工改 `ops/ota/active.json` 或 active release symlink 来发布；发布前必须校验目标版本、manifest `firmware.version`、bin app desc version、size、sha256 一致，默认 `force=0`，失败必须回退旧 manifest / active release。
- `stackchan-ota-release` 可以重启 user 级 `stackchan-ota.service` 并用 `GET/POST /ota/`、`HEAD/GET /stack-chan.bin`、`stackchan-doctor` 验收服务端发布结果；默认不得访问设备、触发设备 reboot、写 NVS、触发真实 OTA 或刷机，只有显式 `--reboot-device --confirm` 才能走本地 reboot。
- 语音触发 celebrate 的完整链路验收必须使用 `remote_control.py inject-prompt` / `/dev/inject_prompt` 黄金入口，确认 XiaoZhi 状态流转、实际调用 `self.robot.celebrate`、进入 `DanceModifier::Celebrate` 且结束后回到 `listening`；不得用 `/dev/celebrate` 或直接 `/dev/mcp/call` 冒充真实小智语音 / MCP 链路。
- token 检查只能报告存在性或缺失状态，不得输出 token 原文、片段、哈希或任何可复用凭据。
- 发布到设备只能走 OTA；不得把 USB、`esptool` 或 `idf.py flash` 直刷当作默认发布 / 恢复路径。
- runbook、doctor 和 smoke test 应固化能力矩阵：能力、入口路径 / 命令、当前状态、证据、失效原因、风险、保全动作和后续计划建议。

## Alternatives Considered

- 临场按记忆选择入口：拒绝。审计计划要求输出必须基于证据路径 / 命令，核心问题也正是入口分裂导致反复踩坑。
- 混用 `XIAOZHI_MCP_TOKEN` 与 `XIAOZHI_MESSAGING_TOKEN`：拒绝。计划事实记录二者容易混用，且当前 Messaging token 缺失会导致云端设备调用不可用。
- 用 system systemd 检查 `stackchan-ota.service`：拒绝。计划事实记录当前有效口径是 user systemd，system 口径会误判。
- 手工编辑 `active.json` 或只看 manifest version 判定发布成功：拒绝。收尾计划记录过 manifest `2.0.36` / bin app_desc `2.0.35` 错位，必须用脚本校验 bin app desc、manifest、size、sha256 与 force 口径。
- 用 `/dev/celebrate` 或直接 `/dev/mcp/call` 替代语音注入验收：拒绝。2.0.45 验收计划要求证明 XiaoZhi 被自动唤醒并经语音 / MCP 语义链路调用 `self.robot.celebrate`，直接动作入口不能覆盖该链路。

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
| `ops/bin/stackchan-doctor` | 只读诊断入口，默认不执行重启、NVS 写入、OTA trigger 或 flash；可显式聚合 USB 日志和庆祝失败诊断。 |
| `ops/bin/stackchan-device-version` | 设备 / OTA server / active bin 三方版本核对入口，HTTP 侧只读 `/dev/status`。 |
| `ops/bin/stackchan-usb-logs` | USB / 串口日志聚合入口，默认只读 `/dev/ttyACM*` 与既有 `/tmp/stackchan-serial*.log`。 |
| `ops/bin/stackchan-celebrate-diagnose` | 庆祝失败日志诊断入口，只分析既有串口日志，不调用 `/dev/celebrate`。 |
| `ops/bin/stackchan-ota-release` | 本地 OTA 发布入口，负责 candidate、active-release、active.json、user service restart、HTTP / doctor 验收与失败回退。 |
| `docs/runbook/stackchan-ops.md` | 人工运维 runbook，记录通道边界、doctor、release、P0 工具索引与安全确认口径。 |
| `tools/remote_control/remote_control.py` | 语音注入验收 CLI，`inject-prompt` 子命令调用 `/dev/inject_prompt`，用于验证 XiaoZhi 真实语音 / MCP 链路。 |
| `docs/runbook/voice-injection-celebrate-e2e.md` | 语音注入 celebrate E2E Runbook，记录黄金入口、前置条件、日志诊断、成功判定和常见失败处理。 |

## Consequences

- 正向效果：后续排障和发布前检查可以先用统一能力矩阵确认入口、凭据、服务口径和当前可用性，减少反复猜入口。
- 约束：新增 runbook、doctor 或 smoke test 时，必须显式区分本地 HTTP、云端 messaging / MCP、USB 串口和 OTA 服务，而不是只写一个“远程控制”总称。
- 语音验收约束：后续验证 XiaoZhi celebrate 完整链路时，优先按 Runbook 使用 `inject-prompt`；只有目标明确是局部动作或 MCP dispatcher 时，才使用 `/dev/celebrate` 或 `/dev/mcp/call`。
- 取舍：本地 reboot dispatcher / CLI 闭环和只读 doctor 已存在；runbook、doctor、P0 诊断工具与 release 脚本已落地；后续 smoke test 仍应默认 skipped 动作类能力，只有显式 `--allow-action` 才执行。
- 发布约束：OTA server 侧发布可直接重启 user 级 `stackchan-ota.service` 使配置生效，但这不等同于设备动作授权；设备 reboot / OTA trigger 仍需显式 `--reboot-device --confirm` 或现场授权。
- 验证锚点：本地 reboot 收尾验证覆盖 `python3 -m py_compile StackChan/tools/remote_control/remote_control.py` 与 firmware build；未连接设备、未调用 `/dev/mcp/call`、未触发重启、未触发 OTA、未写 NVS、未刷机。doctor 验证覆盖默认模式与 `--json` 模式；默认模式未访问设备动作端点，`/dev/status` 只在 `--check-device` 下只读访问；当前环境 token 缺失会让 overall 为 `warning`，但 OTA/manifest/bin/app_desc 核心检查可为 `ok`。P0 工具箱验证覆盖 `stackchan-device-version`、`stackchan-usb-logs`、`stackchan-celebrate-diagnose` 与 doctor 扩展参数的 `py_compile`、`--help`、`--json`、默认只读、无 token 泄露、未打开串口交互、未访问设备动作端点；`stackchan-device-version` 必须能区分 `device_running_version`、`ota_server_version`、`active_bin_app_desc`，旧固件缺新字段时报告 `unsupported_old_firmware` 而不猜版本。`stackchan-ota-release` 收尾验证覆盖 `--help`、dry-run、版本不匹配拒绝、reboot 缺 `--confirm` 拒绝、默认 `force=0`、manifest/bin app_desc/size/sha 一致、user service active、doctor `overall=ok`；计划记录 2.0.36 发布未访问设备 IP。

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
- `ops/bin/stackchan-device-version`
- `ops/bin/stackchan-usb-logs`
- `ops/bin/stackchan-celebrate-diagnose`
- `--include-usb-logs`
- `--include-celebrate-logs`
- `--json`
- `--check-device`
- `device_running_version`
- `ota_server_version`
- `active_bin_app_desc`
- `unsupported_old_firmware`
- `queued`
- `started`
- `finished`
- `force_release`
- `GET /ota/`
- `POST /ota/`
- `HEAD /stack-chan.bin`
- `active.json`
- `exp-pkg/active-release/stack-chan.bin`
- `App version`
- `smoke test`
- `docs/runbook/stackchan-ops.md`
- `ops/bin/stackchan-ota-release`
- `tools/remote_control/remote_control.py inject-prompt`
- `/dev/inject_prompt`
- `docs/runbook/voice-injection-celebrate-e2e.md`
- `speaking -> listening`
- `manifest version`
- `firmware.version`
- `bin app_desc`
- `force=0`
- `HEAD /stack-chan.bin`
- `GET /stack-chan.bin`
- `remote_control.py`
- `--confirm`
- `--allow-action`
- `skipped_destructive`
- `esp_restart`
