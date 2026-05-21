# StackChan Canonical Truth 索引

## adr

| 文档 | 决策 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`adr/celebrate-servo-transient-bus-handling.md`](adr/celebrate-servo-transient-bus-handling.md) | celebrate 舵机 transient 与 bus_dead 分级处理 | `ERR_NO_REPLY`、`ack_missing_cooldown`、`transient_probe_pending`、`transient_passive_cooldown`、`no_powercycle=1`、`torque_enable_skip`、`torque_release_skip`、`active_io_demand`、`axis_stagger_wait`、`no_write_transient`、`no_write_stop`、`bus_dead_escalated_after_transient_timeout`。 |
| [`adr/celebrate-completion-frame-gating.md`](adr/celebrate-completion-frame-gating.md) | celebrate 完成判定与帧推进门控 | `self.robot.celebrate`、`expected_end`、`min_finish`、`step_index`、`frame_done_gated`、`celebrate_frame_schedule`、`finish_type=normal`、`finish_type=aborted`、`preflight_bus_dead`、`bus_dead`、`timeout`。 |
| [`adr/official-dancemodifier-for-celebrate.md`](adr/official-dancemodifier-for-celebrate.md) | self.robot.celebrate 复用官方 DanceModifier/Timeline | `self.robot.celebrate`、`start_celebrate_modifier`、`CelebrateExecutor`、`DanceModifier::Happy`、`DanceModifier::Celebrate`、`Timeline`、`Medium servo speed`、`speed=260`、`/dev/celebrate`、`/dev/mcp/call`、`action=dance_modifier_celebrate`、`hal_mcp.cpp`、`dance.h`。 |

## features

| 文档 | 主题 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`features/ota-release-workflow.md`](features/ota-release-workflow.md) | StackChan OTA 发布与实机升级链路 | `PROJECT_VER`、`stackchan-ota-release`、`image_info --version 2`、`remote_control.py reboot --confirm`、`state=upgrading`、`app_version`。 |
| [`features/celebrate-servo-bus-health.md`](features/celebrate-servo-bus-health.md) | celebrate 触发/完成语义与舵机总线健康 | `start_celebrate_modifier`、`self.robot.celebrate`、`/dev/celebrate`、`g_celebrate_active`、`stackchan_celebrate_tick`、`finishCelebrateLocked`、`duration_complete`、`finish_type=normal`、`finish_type=aborted`、`expected_end_ms`、`min_finish_ms`、`last_motion_frame_due_ms`、`kMotionFrameCount`、`kCelebrateFrameBeatMs`、`preflight_bus_dead`、`bus_dead`、`timeout`、`HeadMotionSchedulerModifier`、`Servo::isMoving()`、`kReadMoveEnabled=false`、`computeCompletionEventTiming`、`should_celebrate`、`celebrate_last_reason`、`Motion::enterTransientPassiveCooldown(...)`、`transient_passive_cooldown`、`ERR_NO_REPLY`、`ack_missing_cooldown`、`serviceBusRecoveryProbe()`、`bus_dead_escalated_after_transient_timeout`、`kAxisWriteStaggerWindowMs`、`axis_stagger_wait`、legacy `bus_failed=1`。 |
| [`features/voice-injection-celebrate-e2e.md`](features/voice-injection-celebrate-e2e.md) | 语音注入触发 XiaoZhi celebrate 完整链路 | `inject-prompt`、`/dev/inject_prompt`、`inject_prompt_handler`、`inject_prompt_task`、`StartListeningDefaultMode()`、`AudioService::InjectPcmFrameToSendQueue`、`self.robot.celebrate`、`DanceModifier::Celebrate`、`dance_modifier_celebrate`、`speed=260`、`speaking -> listening`、`not_ready`、`inject_already_active`、`task_create_failed`、`stackchan-serial-capture`、`docs/runbook/voice-injection-celebrate-e2e.md`。 |

## 2026-05-21 迁移补充 canonical ADR

> 本区来自旧 OpenClaw project Truth 迁移；合并原则为当前 `.claw/truth` canonical 优先，旧内容仅补充长期规则与背景，不覆盖上方现有 canonical 结论。

| 文档 | 决策 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`adr/defer-dev-local-http-until-xiaozhi-ready.md`](adr/defer-dev-local-http-until-xiaozhi-ready.md) | Dev Local HTTP 延后到 XiaoZhi ready 后再启动 | `dev local HTTP`、`XiaoZhi ready`、`/dev/mcp/call`、启动阶段边界。 |
| [`adr/inject-prompt-default-listening-mode.md`](adr/inject-prompt-default-listening-mode.md) | prompt 注入使用默认 listening mode 恢复 chat state | `inject prompt`、`default listening mode`、`chat-state recovery`。 |
| [`adr/xiaozhi-mcp-delayed-confirmed-reboot.md`](adr/xiaozhi-mcp-delayed-confirmed-reboot.md) | XiaoZhi MCP reboot 必须延迟且显式确认 | `self.system.reboot`、`confirm=true`、`delayed reboot`、MCP 工具返回后重启。 |
| [`adr/avoid-64-bit-printf-in-scs-logs.md`](adr/avoid-64-bit-printf-in-scs-logs.md) | SCS 诊断日志避免 64-bit printf | `%lld`、`nano-vfprintf`、`SCS.cpp`、`LoadProhibited`、日志格式安全。 |
| [`adr/servo-command-chain-diagnosis-and-root-cause-boundary.md`](adr/servo-command-chain-diagnosis-and-root-cause-boundary.md) | 舵机命令链诊断与根因修复边界 | `servo command chain`、`ReadPos`、`WritePos`、`LVGL lock`、`SCS UART`。 |
| [`adr/stackchan-tool-preservation-golden-entrypoint-and-channel-boundaries.md`](adr/stackchan-tool-preservation-golden-entrypoint-and-channel-boundaries.md) | StackChan 工具链保留黄金入口与通道边界 | `ops/bin`、`golden entrypoint`、`dev HTTP`、`messaging API`、工具链边界。 |
| [`adr/truth-doc-migration-canonical-precedence.md`](adr/truth-doc-migration-canonical-precedence.md) | Truth doc 迁移以当前 `.claw/truth` 为 canonical 优先 | `.claw/truth`、`.projects/stack-chan/truth`、`legacy/background`、`MIGRATION-INDEX-2026-05-21.md`、`source -> target`。 |

## 2026-05-21 迁移补充 canonical features

| 文档 | 主题 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md`](features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md) | boot mode / XiaoZhi autostart 与 `sys_evt` 栈溢出 | `boot/default_mode`、`start_once`、`sys_evt`、Wi-Fi event task、Launcher 自主 OTA。 |
| [`features/http-mcp-tool-entrypoints.md`](features/http-mcp-tool-entrypoints.md) | HTTP MCP tool 入口与语义边界 | `/dev/mcp/call`、`xiaozhi.me/api/messaging/device/tools`、`messaging token`、`McpServer`。 |
| [`features/launcher-autonomous-ota-check.md`](features/launcher-autonomous-ota-check.md) | Launcher 自主 OTA 检查机制 | `LAUNCHER-OTA`、`default_off`、`launcher_only`、`Check for Updates`。 |
| [`features/launcher-no-network-recovery-paths.md`](features/launcher-no-network-recovery-paths.md) | Launcher 无网络停留态与 UI 脱困路径 | `launcher_only`、`AI.AGENT`、`SETUP`、无 USB / 无擦除约束。 |
| [`features/launcher-to-xiaozhi-startup-chain.md`](features/launcher-to-xiaozhi-startup-chain.md) | Launcher 到 XiaoZhi 启动链路 | `requestAutoOpenAiAgent`、`openApp(AI.AGENT)`、`Hal::startXiaozhi()`。 |
| [`features/mooncake-launcher-capability-map.md`](features/mooncake-launcher-capability-map.md) | MoonCake Launcher 能力地图 | `MoonCake Launcher`、`AI.AGENT`、`SETUP`、Launcher 阶段能力边界。 |
| [`features/nonblocking-head-motion-control.md`](features/nonblocking-head-motion-control.md) | 非阻塞头部电机控制链路 | `HeadMotionSchedulerModifier`、`MCP/HTTP 快速返回`、`no-read`、`bus_dead`。 |
| [`features/openclaw-plan-completion-hooks.md`](features/openclaw-plan-completion-hooks.md) | OpenClaw plan completion hooks 接入点 | `after_tool_call`、`plan_edit`、`plan_write`、`planEventListeners`。 |
| [`features/readpos-lvgl-lock-servo-bus.md`](features/readpos-lvgl-lock-servo-bus.md) | ReadPos / LVGL lock / Servo bus 卡死链路 | `ReadPos`、`LvglLockGuard`、`SCS UART`、`SERVO-IO`、有限超时。 |
| [`features/scs-nano-vfprintf-guru-meditation.md`](features/scs-nano-vfprintf-guru-meditation.md) | SCS `%lld` nano-vfprintf Guru Meditation 重启链路 | `%lld`、`CONFIG_LIBC_NEWLIB_NANO_FORMAT`、`LoadProhibited`、`boot loop`。 |
| [`features/stackchan-device-version-readonly-check.md`](features/stackchan-device-version-readonly-check.md) | `stackchan-device-version` 只读版本检查 | `app_version`、`project_name`、`unsupported_old_firmware`、只读核对。 |
| [`features/stackchan-doctor-readonly-self-check.md`](features/stackchan-doctor-readonly-self-check.md) | `stackchan-doctor` 只读自检入口 | `stackchan-doctor`、`--json`、`--check-device`、只读自检。 |
| [`features/stackchan-ota-release-automation.md`](features/stackchan-ota-release-automation.md) | `stackchan-ota-release` 一键 OTA 发布脚本 | `active-release`、`active.json`、`stackchan-ota`、`--reboot-device --confirm`。 |
| [`features/stackchan-update-stability-window.md`](features/stackchan-update-stability-window.md) | App 进入阶段更新稳定窗口 | `_stackchan_update_task`、`50ms`、`150ms`、`LVGL lock`、XiaoZhi 状态切换。 |

## Legacy / background（不进入 canonical 主索引）

以下文件为旧 OpenClaw project Truth 隐藏目录中与当前 canonical 重叠或冲突的历史背景，已迁入 `legacy/2026-05-21-from-openclaw-projects/`。它们只能作为溯源和背景参考，不得覆盖当前 `.claw/truth` 中 OTA / Celebrate 等 canonical 结论。

| Legacy 文档 | 原相对路径 | 说明 |
| ---- | ---- | ---- |
| [`legacy/2026-05-21-from-openclaw-projects/PROJECT-TRUTH.md`](legacy/2026-05-21-from-openclaw-projects/PROJECT-TRUTH.md) | `PROJECT-TRUTH.md` | 旧项目级规则背景。 |
| [`legacy/2026-05-21-from-openclaw-projects/SUMMARY.md`](legacy/2026-05-21-from-openclaw-projects/SUMMARY.md) | `SUMMARY.md` | 旧索引背景。 |
| [`legacy/2026-05-21-from-openclaw-projects/features/ota-firmware-update-chain.md`](legacy/2026-05-21-from-openclaw-projects/features/ota-firmware-update-chain.md) | `features/ota-firmware-update-chain.md` | 旧 OTA 链路背景。 |
| [`legacy/2026-05-21-from-openclaw-projects/adr/ota-trigger-path-priority-and-recovery-boundary.md`](legacy/2026-05-21-from-openclaw-projects/adr/ota-trigger-path-priority-and-recovery-boundary.md) | `adr/ota-trigger-path-priority-and-recovery-boundary.md` | 旧 OTA trigger / recovery 边界背景。 |
| [`legacy/2026-05-21-from-openclaw-projects/features/stackchan-celebrate-power-servo-stability.md`](legacy/2026-05-21-from-openclaw-projects/features/stackchan-celebrate-power-servo-stability.md) | `features/stackchan-celebrate-power-servo-stability.md` | 旧 Celebrate 舵机稳定性背景。 |
| [`legacy/2026-05-21-from-openclaw-projects/features/stackchan-dev-local-http-celebrate.md`](legacy/2026-05-21-from-openclaw-projects/features/stackchan-dev-local-http-celebrate.md) | `features/stackchan-dev-local-http-celebrate.md` | 旧 dev HTTP celebrate 背景。 |
| [`legacy/2026-05-21-from-openclaw-projects/adr/stackchan-remote-celebration-control-boundaries.md`](legacy/2026-05-21-from-openclaw-projects/adr/stackchan-remote-celebration-control-boundaries.md) | `adr/stackchan-remote-celebration-control-boundaries.md` | 旧远程 celebration 控制边界背景。 |
