# Truth Migration Index - 2026-05-21

## Source / Target

- 来源目录：旧 OpenClaw project Truth 隐藏目录（同项目 `stack-chan`）
- 目标目录：当前仓库 `.claw/truth/`
- Legacy 目标根：`.claw/truth/legacy/2026-05-21-from-openclaw-projects/`

## 迁移原则

- 当前仓库 `.claw/truth` 是 canonical truth，优先级高于旧 OpenClaw project truth。
- 旧 OpenClaw project Truth 隐藏目录只作为补充、背景和历史迁移来源。
- 直接迁入项仅限目标同名文件不存在的 ADR / features；不得覆盖现有 canonical 文件。
- 与当前 canonical 重叠或可能冲突的文件进入 legacy/background，不进入 canonical 主索引。
- 不删除来源文件；不迁移 task/subagent/meta/log/secrets/sqlite；不处理 Truth 以外内容；不运行设备命令；不提交 git。

## Direct canonical migrated files

以下文件保持相对路径迁入 `.claw/truth/`，作为 canonical 补充索引：

### ADR

- `adr/defer-dev-local-http-until-xiaozhi-ready.md`
- `adr/inject-prompt-default-listening-mode.md`
- `adr/xiaozhi-mcp-delayed-confirmed-reboot.md`
- `adr/avoid-64-bit-printf-in-scs-logs.md`
- `adr/servo-command-chain-diagnosis-and-root-cause-boundary.md`
- `adr/stackchan-tool-preservation-golden-entrypoint-and-channel-boundaries.md`

### Features

- `features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md`
- `features/http-mcp-tool-entrypoints.md`
- `features/launcher-autonomous-ota-check.md`
- `features/launcher-no-network-recovery-paths.md`
- `features/launcher-to-xiaozhi-startup-chain.md`
- `features/mooncake-launcher-capability-map.md`
- `features/nonblocking-head-motion-control.md`
- `features/openclaw-plan-completion-hooks.md`
- `features/readpos-lvgl-lock-servo-bus.md`
- `features/scs-nano-vfprintf-guru-meditation.md`
- `features/stackchan-device-version-readonly-check.md`
- `features/stackchan-doctor-readonly-self-check.md`
- `features/stackchan-ota-release-automation.md`
- `features/stackchan-update-stability-window.md`

## Legacy / background migrated files

以下文件保持相对路径迁入 `.claw/truth/legacy/2026-05-21-from-openclaw-projects/`：

- `PROJECT-TRUTH.md`
- `SUMMARY.md`
- `features/ota-firmware-update-chain.md`
- `adr/ota-trigger-path-priority-and-recovery-boundary.md`
- `features/stackchan-celebrate-power-servo-stability.md`
- `features/stackchan-dev-local-http-celebrate.md`
- `adr/stackchan-remote-celebration-control-boundaries.md`

## 摘要合并目标

- `.claw/truth/SUMMARY.md`
  - 保留原有 canonical ADR / features 索引。
  - 增加本次 direct canonical ADR / features 索引。
  - 增加 Legacy / background 区，明确 legacy 文档不进入 canonical 主索引。
- `.claw/truth/PROJECT-TRUTH.md`
  - 保留现有项目级规则和 OTA / Celebrate 索引。
  - 追加“迁移补充的项目级长期规则（2026-05-21）”，摘要合并长期边界：本地 LAN `/dev/mcp/call` 与小智官方 messaging API、`self.system.reboot confirm=true`、Launcher/XiaoZhi 两阶段、OTA 前半段与 reboot 后验收拆分、工具链黄金入口、ReadPos/LVGL/SCS UART 风险、SCS 日志禁止 `%lld`。

## 不迁入项

- 本次来源目录下未发现清单外 Truth 文档需要额外迁入。
- 不迁入任何 `tasks/`、`subagents/`、`meta/`、`log/`、`secrets/`、`sqlite` 内容。
- 不迁入 Truth 以外内容。
- 不执行设备命令、不提交 git。
