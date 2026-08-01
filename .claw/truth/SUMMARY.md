# StackChan Canonical Truth 索引

## adr

| 文档 | 决策 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`adr/celebrate-completion-frame-gating.md`](adr/celebrate-completion-frame-gating.md) | celebrate 完成判定与帧推进门控 | `self.robot.celebrate`、`expected_end`、`min_finish`、`step_index`、`frame_done_gated`、`celebrate_frame_schedule`、`finish_type=normal`、`finish_type=aborted`、`preflight_bus_dead`、`bus_dead`、`timeout`。 |
| [`adr/celebrate-servo-transient-bus-handling.md`](adr/celebrate-servo-transient-bus-handling.md) | celebrate 舵机 transient 与 bus_dead 分级处理 | `ERR_NO_REPLY`、`ack_missing_cooldown`、`transient_probe_pending`、`transient_passive_cooldown`、`no_powercycle=1`、`torque_enable_skip`、`torque_release_skip`、`active_io_demand`、`axis_stagger_wait`、`no_write_transient`、`no_write_stop`、`bus_dead_escalated_after_transient_timeout`。 |
| [`adr/development-process-archive-traceability-ota-validation-bisect.md`](adr/development-process-archive-traceability-ota-validation-bisect.md) | 开发流程归档、验证与 bisect 统一约束 | `commit SHA`、`candidate`、`ops/bin/stackchan-ota-release`、`ops/bin/stackchan-doctor`、`ready/idle`、`state=upgrading`、`xiaozhi_ready=true`、`bisect`、`force=1`、`force=0`。 |
| [`adr/force-ota-one-shot-release-and-auto-reset.md`](adr/force-ota-one-shot-release-and-auto-reset.md) | force OTA 一次性下发并自动恢复 | `ops/bin/stackchan-ota-release`、`force=1`、`force=0`、`active.json`、`exp-pkg/active-release`、`GET /ota/`、`POST /ota/`、`ops/bin/stackchan-doctor --json`。 |
| [`adr/force-ota-roll-back-close-loop.md`](adr/force-ota-roll-back-close-loop.md) | force OTA 回退闭环与完成判定收口 | `ops/bin/stackchan-ota-release`、`/dev/status`、`X-StackChan-Dev-Token`、`18080`、`app_version`、`state=upgrading`、`xiaozhi_ready=true`、`ops/bin/stackchan-doctor --json`。 |
| [`adr/official-dancemodifier-for-celebrate.md`](adr/official-dancemodifier-for-celebrate.md) | self.robot.celebrate 复用官方 DanceModifier/Timeline | `self.robot.celebrate`、`start_celebrate_modifier`、`CelebrateExecutor`、`DanceModifier::Happy`、`DanceModifier::Celebrate`、`Timeline`、`Medium servo speed`、`speed=260`、`/dev/celebrate`、`/dev/mcp/call`、`action=dance_modifier_celebrate`、`hal_mcp.cpp`、`dance.h`。 |

## features

| 文档 | 主题 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md`](features/boot-mode-xiaozhi-autostart-and-sys-evt-overflow.md) | boot mode / XiaoZhi autostart 与 `sys_evt` 栈溢出 | `boot/default_mode`、`start_once`、`sys_evt`、Wi-Fi event task、Launcher 自主 OTA。 |
| [`features/http-mcp-tool-entrypoints.md`](features/http-mcp-tool-entrypoints.md) | HTTP MCP tool 入口、控制面能力矩阵与通道边界 | `/dev/mcp/call`、`self.system.reboot`、`/dev/wake`、`/dev/stop`、`/dev/reboot`、`/dev/toggle`、`/dev/prompt_sample`、跨通道能力矩阵（HTTP/USB/CLI/UI 4 通道 × 12 能力）、USB Serial 2.0.34+ 已启用、编译宏已拆分、`STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`、`STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`、`start_dev_serial_wake_stop_task()`、`stackchan-usb-logs`、`stackchan-serial-capture`、`xiaozhi.me/api/messaging/device/tools`、`messaging token`、`McpServer`。 |
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
| [`features/stackchan-ota-release-automation.md`](features/stackchan-ota-release-automation.md) | `stackchan-ota-release` 一键 OTA 发布脚本 | `active-release`、`active.json`、`stackchan-ota`、`force=0`、`same version OTA`、`--reboot-device --confirm`。 |
| [`features/stackchan-update-stability-window.md`](features/stackchan-update-stability-window.md) | App 进入阶段更新稳定窗口 | `_stackchan_update_task`、`50ms`、`150ms`、`LVGL lock`、XiaoZhi 状态切换。 |
| [`features/dialog-state-machine-fix-surface.md`](features/dialog-state-machine-fix-surface.md) | 对话状态机修复面：`application.cc` JSON 防御、`hal_device_control.cpp` inject 闸门、`application.cc` TTS 起播时序 | `OnIncomingJson`、`cJSON_IsString`、`tts start/stop`、`handle_inject_prompt`、`g_inject_active`、`MarkTtsStartPending`、`IsSpeakingAudioAccepted`、对话恢复判据（ready/idle 不等于可对话）、bisect 协议 `r1_2.0.46plus_dialog_bisect`。 |
| [`features/force-ota-download-retry-and-clean-upgrade.md`](features/force-ota-download-retry-and-clean-upgrade.md) | force OTA 下载反复重试时的清洁升级收口规则；OTA 下载成功不等于刷写成功；固件大小差异作为 OTA 刷写失败关键诊断信号 | `force=1`、`force=0`、`ops/bin/stackchan-ota-release`、`ops/bin/stackchan-doctor --json`、`active.json`、`exp-pkg/active-release`、`下载重新开始`、`固件大小差异`、`刷写失败`、`esptool.py image_info`。 |
| [`features/voice-injection-celebrate-e2e.md`](features/voice-injection-celebrate-e2e.md) | 语音注入庆祝完整链路的黄金入口是 `tools/remote_control/remote_control.py inject-prompt` / `POST /dev/inject_prompt`；它通过内嵌 prompt 注入 XiaoZhi 上行音频触发 `self.robot.celebrate`，不是 `/dev/celebrate`、不是 `/dev/mcp/call`、不是 `/dev/wake`，也不需要用户现场人工说话。 已确认该入口可在 `listening` 状态下成功注入，且前置 `xiaozhi_ready: true`。 || [`features/display-backend-lvgl-vs-emote.md`](display-backend-lvgl-vs-emote.md) | StackChan 显示后端架构：LVGL vs Emote | `emote_display.cc`、`LVGL`、`EmoteDisplay`、`esp_emote_expression`、`EMOTE_MGR_EVT_*`、`emote_set_event_msg`、`USE_EMOTE_MESSAGE_STYLE`、`FLASH_EXPRESSION_ASSETS`、`firmware/main/CMakeLists.txt`。 |
| [`features/speaking-panic-strtof-and-body-lifetime.md`](features/speaking-panic-strtof-and-body-lifetime.md) | speaking 阶段 panic 的 `strtof` / body 生命周期排查边界 | `LoadProhibited`、`EXCVADDR=0x00000000`、`strtof`、`read_body`、`inject_prompt_task`、`handle_inject_prompt`、`SetStatus(SPEAKING)`、`cJSON->valuestring`、`std::string::c_str()`、不要先怪 `celebrate`。 |

## 2026-05-21 迁移补充 canonical ADR

> 本区来自旧 OpenClaw project Truth 迁移；合并原则为当前 `.claw/truth` canonical 优先，旧内容仅补充长期规则与背景，不覆盖上方现有 canonical 结论。

| 文档 | 决策 | 可检索摘要 |
| ---- | ---- | ---------- |
| [`adr/avoid-64-bit-printf-in-scs-logs.md`](adr/avoid-64-bit-printf-in-scs-logs.md) | SCS 诊断日志避免 64-bit printf | `%lld`、`nano-vfprintf`、`SCS.cpp`、`LoadProhibited`、日志格式安全。 |
| [`adr/defer-dev-local-http-until-xiaozhi-ready.md`](adr/defer-dev-local-http-until-xiaozhi-ready.md) | Dev Local HTTP 延后到 XiaoZhi ready 后再启动 | `dev local HTTP`、`XiaoZhi ready`、`/dev/mcp/call`、启动阶段边界。 |
| [`adr/inject-prompt-default-listening-mode.md`](adr/inject-prompt-default-listening-mode.md) | prompt 注入使用默认 listening mode 恢复 chat state | `inject prompt`、`default listening mode`、`chat-state recovery`。 |
| [`adr/lan-dev-http-golden-control-entrypoint-and-usb-serial-jtag-log-only.md`](adr/lan-dev-http-golden-control-entrypoint-and-usb-serial-jtag-log-only.md) | LAN Dev HTTP 作为黄金控制入口，USB Serial/JTAG 仅作日志观察口 | `LAN Dev HTTP`、`golden control entrypoint`、`USB Serial/JTAG`、`log only`、`write timeout`、`/dev/inject_prompt`、`LAN first`、`USB CDC`。 |
| [`adr/servo-command-chain-diagnosis-and-root-cause-boundary.md`](adr/servo-command-chain-diagnosis-and-root-cause-boundary.md) | 舵机命令链诊断与根因修复边界 | `servo command chain`、`ReadPos`、`WritePos`、`LVGL lock`、`SCS UART`。 |
| [`adr/stackchan-tool-preservation-golden-entrypoint-and-channel-boundaries.md`](adr/stackchan-tool-preservation-golden-entrypoint-and-channel-boundaries.md) | StackChan 工具链保留黄金入口与通道边界 | `ops/bin`、`golden entrypoint`、`dev HTTP`、`messaging API`、`remote_control.py inject-prompt`、`/dev/inject_prompt`、语音注入验收、工具链边界。 |
| [`adr/truth-doc-migration-canonical-precedence.md`](adr/truth-doc-migration-canonical-precedence.md) | Truth doc 迁移以当前 `.claw/truth` 为 canonical 优先 | `.claw/truth`、`.projects/stack-chan/truth`、`legacy/background`、`MIGRATION-INDEX-2026-05-21.md`、`source -> target`。 |
| [`adr/unified-device-control-capability-transport-decoupling.md`](adr/unified-device-control-capability-transport-decoupling.md) | 统一设备控制采用 capability / transport 解耦 | `remote_control.py`、`lan|usb|auto`、`hal_device_control.cpp`、`JSON line + legacy fallback`、`mcp_call over USB`、`play-sound`。 |
| [`adr/xiaozhi-mcp-delayed-confirmed-reboot.md`](adr/xiaozhi-mcp-delayed-confirmed-reboot.md) | XiaoZhi MCP reboot 必须延迟且显式确认 | `self.system.reboot`、`confirm=true`、`delayed reboot`、`MCP` 工具返回后重启。 |
