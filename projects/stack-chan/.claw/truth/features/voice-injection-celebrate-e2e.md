# StackChan 语音注入触发 XiaoZhi Celebrate E2E 链路

## 结论

StackChan 语音注入庆祝完整链路的黄金入口是 `tools/remote_control/remote_control.py inject-prompt` / HTTP `POST /dev/inject_prompt`。这条链路不是本地扬声器播放，也不需要用户现场人工说话；它把固件内嵌 16 kHz mono s16 WAV prompt 注入 XiaoZhi 上行音频队列，经过 XiaoZhi listening / speaking / ASR / 语义链路后，由 XiaoZhi 实际调用 `self.robot.celebrate`，最终进入官方 `DanceModifier::Celebrate`。

后续验收“语音注入完整链路”时，不能用 `POST /dev/celebrate`、`POST /dev/mcp/call` 或 `POST /dev/wake` 冒充 E2E PASS；这些入口只能做动作、dispatcher 或 listening 分段诊断。

## 长期行为 / 规则

- `remote_control.py inject-prompt` 对应设备端 `POST /dev/inject_prompt`，Header 使用 `X-StackChan-Dev-Token`；token 只在运行时提供，不能写入文档、日志或提交记录。
- `/dev/inject_prompt` 的语义是“伪造麦克风输入”：固件解析内嵌 WAV prompt，按 PCM frame 注入 `AudioService::InjectPcmFrameToSendQueue(...)`，让 XiaoZhi 按真实上行音频处理。
- `/dev/inject_prompt` 不是 `/dev/play_sound`，不会通过本地喇叭播放提示音；是否触发 `self.robot.celebrate` 取决于 XiaoZhi ASR / 语义 / MCP 链路。
- 语音注入完整链路要求看到 `self.robot.celebrate` 由 XiaoZhi 调用，并进入 `DanceModifier::Celebrate` / `dance_modifier_celebrate`；仅 `inject-prompt` 返回 ok 不等于完整成功。
- `2.0.45+` 的长期验收口径包含 `speed=260`、LED 参与、头部 V 形左右庆祝动作，以及 XiaoZhi 会话从 `speaking -> listening` 回到可继续对话状态。
- `/dev/inject_prompt` 有防重入：已有注入任务时返回 `inject_already_active`；XiaoZhi 未 ready 时返回 `not_ready`；任务资源不足可能返回 `task_create_failed`。
- 完整链路验收前应先查询 `status`，确认设备处于 XiaoZhi runtime 且可接受状态为 `idle` / `connecting` / `listening` / `speaking` 的可解释过渡。
- M4 连续语音注入稳定性排障时，第一优先级不是削弱 `DanceModifier::Celebrate`，而是先证明 prompt 被 ASR 稳定识别并实际进入 `self.robot.celebrate`。若日志只有 `inject-prompt` ok、`listening -> speaking` 和错误 ASR 文本（例如把“庆祝一下”识别成近音错误），但没有 `self.robot.celebrate` / `DanceModifier::Celebrate`，根因边界在庆祝动作之前。
- HTTP `/dev/inject_prompt` 与 USB dev serial 注入入口曾存在长期可疑差异：HTTP 固定使用 `celebration-tts-16k-mono-s16-approx3s.wav`，serial 优先 `celebration-short-16k-mono-s16.wav`；serial 会检查 `InjectPcmFrameToSendQueue()` 返回值并在注入后 `StopListening()`，HTTP 路径只追加静音并延迟，若未显式结束一句话，ASR/VAD 句尾边界会更不确定。
- `speaking` 长期卡住通常不是 `DanceModifier::Celebrate` 自身证明点；XiaoZhi 设备端 `speaking -> listening/idle` 回落依赖服务端返回 `tts state=stop` JSON。若 stop 丢失、协议/session 异常、网络失联或 JSON 未处理，设备状态机允许回落但缺少 30s 内主动 watchdog 时会卡在 `speaking`。
- 低内部 SRAM 会放大注入、WiFi/LwIP/MQTT/UDP 与 JSON 处理风险；连续 M4 前应把 internal heap、largest free block、min free heap、RSSI 与当前状态作为前置诊断，而不是只看 HTTP 返回 ok。

## 关联代码

### 主锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/hal_dev_local_control.cpp` | 本地 Dev HTTP `/dev/inject_prompt` 主入口；包含 `inject_prompt_handler()`、`inject_prompt_task()`、内嵌 prompt WAV 符号、XiaoZhi ready 检查、防重入与任务创建。 |
| `tools/remote_control/remote_control.py` | LAN 远控 CLI；`inject-prompt` 子命令封装 `POST /dev/inject_prompt`，是 E2E 验收黄金入口。 |

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/xiaozhi-esp32/main/application.cc` | `Application::StartListeningDefaultMode()`；注入入口使用默认 listening mode，避免 `ManualStop` 残留导致 `speaking -> idle`；`protocol_->OnIncomingJson(...)` 处理 `tts state=start/stop`，`speaking` 回落依赖 `tts stop`。 |
| `firmware/xiaozhi-esp32/main/application.h` | `StartListeningDefaultMode()` 声明。 |
| `firmware/xiaozhi-esp32/main/audio/audio_service.cc` | `AudioService::InjectPcmFrameToSendQueue(...)` 与 `PushTaskToEncodeQueue()`；接收注入 PCM frame，编码为 OPUS 后送入 XiaoZhi 上行发送队列。 |
| `firmware/xiaozhi-esp32/main/audio/audio_service.h` | `OPUS_FRAME_DURATION_MS = 60`、`MAX_ENCODE_TASKS_IN_QUEUE = 2`、`MAX_SEND_PACKETS_IN_QUEUE = 40` 与 `InjectPcmFrameToSendQueue(...)` 声明。 |
| `firmware/xiaozhi-esp32/main/device_state_machine.cc` | XiaoZhi 状态机合法回落边界；`speaking` 只能回到 `listening` 或 `idle`。 |
| `firmware/xiaozhi-esp32/main/protocols/protocol.cc` | `Protocol::IsTimeout()`；默认 120s incoming timeout 且被动检查，不适合作为 30s M4 `speaking` 卡住兜底。 |
| `firmware/xiaozhi-esp32/main/protocols/mqtt_protocol.cc` | `MqttProtocol::IsAudioChannelOpened()` 依赖 `udp_`、`error_occurred_` 与 `IsTimeout()`；网络/session 卡住时会影响 TTS stop 与上行发送。 |
| `firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc` | WiFi disconnect 事件日志与底层 reconnect 边界；没有针对“`speaking` 卡住 + WiFi 不可达”的专用恢复策略。 |
| `firmware/main/hal/hal_mcp.cpp` | `self.robot.celebrate` 注册 / dispatch 与 `DanceModifier::Celebrate` 触发链路。 |
| `firmware/main/hal/hal.cpp` | `_stackchan_update_task()` 推进 motion / celebrate tick / UI / LED 更新。 |
| `firmware/main/hal/hal_dev_serial.cpp` | USB dev serial 的 prompt 注入相近实现；不是本地 HTTP E2E 黄金入口。 |
| `docs/runbook/voice-injection-celebrate-e2e.md` | 仓库 Runbook，保存标准命令、日志锚点、失败处理和最小验收清单。 |
| `docs/runbook/stackchan-ops.md` | 运维 Runbook 总入口，索引语音注入庆祝 E2E 验收。 |
| `ops/bin/stackchan-serial-capture` | 实时串口日志采集入口；用于触发前后捕获 `inject`、`self.robot.celebrate`、`dance_modifier_celebrate`、状态回落与异常。 |
| `ops/bin/stackchan-usb-logs` | 只读聚合已有 USB / 串口日志；不能替代实时采集。 |
| `ops/bin/stackchan-celebrate-diagnose` | 只读分析庆祝日志，定位 queued / started / finished、LED、motion frame、`bus_dead` 等信号。 |
| `ops/bin/stackchan-device-version` | 只读核对设备运行版本、OTA server 版本和 active bin app_desc，避免拿旧固件做 `2.0.45+` 验收。 |

## 真实调用链路

1. 操作者在仓库根目录执行 `python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> --port <PORT> --token '<DEV_TOKEN>' inject-prompt`。
2. `tools/remote_control/remote_control.py` 向设备发送 `POST /dev/inject_prompt`，Header 为 `X-StackChan-Dev-Token`。
3. `firmware/main/hal/hal_dev_local_control.cpp::inject_prompt_handler()` 校验 token、确认 XiaoZhi ready、检查注入互斥，并创建 `inject_prompt_task`。
4. `inject_prompt_task()` 使用内嵌 `_binary_celebration_tts_16k_mono_s16_approx3s_wav_start/_end` prompt 数据，启动默认 listening mode（`StartListeningDefaultMode()`），再把 prompt 拆成 960 samples / 60ms PCM frame 注入 `AudioService::InjectPcmFrameToSendQueue(...)`；约 3.25s prompt 会形成约 55 帧音频，再追加约 5 帧静音。
5. XiaoZhi 把这些 frame 当作麦克风上行音频处理，经过 listening / ASR / 语义识别后，如果语义命中庆祝，会在设备 MCP 层调用 `self.robot.celebrate`。
6. `firmware/main/hal/hal_mcp.cpp` 中的 `self.robot.celebrate` 进入 `DanceModifier::Celebrate` / `dance_modifier_celebrate`，动作由 StackChan update loop 后续异步推进。
7. XiaoZhi 收到服务端 `tts state=start` 后进入 `speaking`；只有收到 `tts state=stop` 时才按 listening mode 回到 `listening` 或 `idle`。因此成功链路最后应能观察到 `speaking -> listening` 回落，设备可继续对话；庆祝动作不能主动关闭会话或导致长期 `speaking` / 红灯 / panic / Guru / WDT。

## 不要改错的位置

- 不要把 `POST /dev/celebrate` 当成语音注入 E2E：它绕过 XiaoZhi listening / ASR / 语义调用，只能验证动作 executor。
- 不要把 `POST /dev/mcp/call` + `self.robot.celebrate` 当成语音注入 E2E：它绕过 XiaoZhi 语义识别，只能验证 HTTP MCP dispatcher 与动作层。
- 不要把 `POST /dev/wake` 当成注入：它只让 XiaoZhi 进入 listening，不会自动注入 prompt。
- 不要把 `inject-prompt` 的 HTTP ok 当成最终 PASS；它只表示注入任务已启动，最终必须看 `self.robot.celebrate`、`dance_modifier_celebrate`、`speed=260`、状态回落和无崩溃。
- 不要要求用户现场人工说话来补足验收；本链路的输入就是内嵌 prompt 注入。
- 不要用旧日志缺少 `self.robot.celebrate` 来否定本次执行；E2E 验收应优先开启 `stackchan-serial-capture` 做实时窗口取证。
- 语音注入后若 `speaking -> idle` 或长期卡 `speaking/listening`，优先按注入 / XiaoZhi 状态机问题排查，不要通过削弱 `DanceModifier::Celebrate`、禁用庆祝或 no-op/fallback 掩盖。

- 不要把 `speaking` 卡住直接归因到 celebrate 动作层。先检查是否收到 `tts state=stop`、是否有 network error / session close、`Protocol::IsTimeout()` 是否还未触发，以及设备是否仍有 HTTP/WiFi 可达性。
- 不要忽略 HTTP 与 serial 注入实现差异：WAV 资源选择、是否检查 `InjectPcmFrameToSendQueue()` 返回值、是否 `StopListening()` 都会影响 ASR 稳定性和诊断可见性。
- 不要只凭 WAV 格式正确判断 prompt 稳定；16 kHz mono s16 只是格式门槛，ASR 命中还受文案、发音、同音词、句尾静音、VAD 边界和低内存注入 jitter 影响。
- 不要在 internal heap 已低于约 20KB 的危险水位下直接做 M4 三连验收；低内存会放大音频队列、OPUS 编码、WiFi/LwIP/MQTT 与 JSON 处理异常。

## 验证标准

后续修改 `/dev/inject_prompt`、XiaoZhi listening 状态机或 celebrate 链路时，至少验证：

- `stackchan-device-version` 或 `status` 确认设备运行 `2.0.45+`，且 Dev HTTP `18080` 可读。
- 触发前启动实时串口采集，关键词覆盖 `inject`、`self.robot.celebrate`、`DanceModifier`、`dance_modifier_celebrate`、`speed=260`、`speaking`、`listening`、`panic`、`Guru`、`WDT`、`red`。
- 标准顺序为 `status` → `inject-prompt` → 等待链路完成 → `status`；不能中途用 `/dev/celebrate`、`/dev/mcp/call` 或 `/dev/wake` 补一次冒充成功。
- PASS 需要同时满足：注入启动成功、日志有 XiaoZhi 调用 `self.robot.celebrate`、进入 `DanceModifier::Celebrate` / `dance_modifier_celebrate`、包含 `speed=260`、LED 与头部 V 形庆祝可见或可追踪、状态能回到 `listening` / 可继续会话、无 panic / Guru / WDT / reboot / 长期红灯。
- 单轮 prompt 修复验证应先跑 5～10 次，不急着做三连；每次记录 sample name/hash、injected frames、accepted/rejected frames、ASR 原文、`self.robot.celebrate`、`dance_modifier_celebrate` 与状态迁移。
- speaking watchdog 或恢复策略验证应覆盖两类场景：正常 TTS stop 时 watchdog 不触发；异常长期 `speaking` 时能在 20～30s 量级自动恢复到 `idle/listening`，且 `/dev/status` 仍可达。
- M4 三连前置条件应包括：单轮 ASR 命中率稳定、`speaking` 能回落或有明确超时恢复、internal heap / largest free block / min free heap / RSSI 水位可接受、previous session 已关闭。
- 常见失败要保留原始错误词：`401` / `403`、`not_ready`、`inject_already_active`、`task_create_failed`、没有 `self.robot.celebrate`、有 `self.robot.celebrate` 但无 `dance_modifier_celebrate`、ASR 误识别、卡 `speaking`、卡 `listening`、`tts state=stop` 缺失、WiFi 不可达、红灯 / panic / Guru / WDT / 重启。

## 关键检索词

- `inject-prompt`
- `/dev/inject_prompt`
- `inject_prompt_handler`
- `inject_prompt_task`
- `X-StackChan-Dev-Token`
- `StartListeningDefaultMode()`
- `AudioService::InjectPcmFrameToSendQueue`
- `_binary_celebration_tts_16k_mono_s16_approx3s_wav_start`
- `celebration-tts-16k-mono-s16-approx3s.wav`
- `celebration-short-16k-mono-s16.wav`
- `local_parse_wav_pcm16_mono_16k()`
- `InjectPcmFrameToSendQueue()`
- `PushTaskToEncodeQueue()`
- `OPUS_FRAME_DURATION_MS`
- `tts state=start`
- `tts state=stop`
- `Protocol::IsTimeout()`
- `MqttProtocol::IsAudioChannelOpened()`
- `low_internal_heap`
- `self.robot.celebrate`
- `DanceModifier::Celebrate`
- `dance_modifier_celebrate`
- `speed=260`
- `speaking -> listening`
- `not_ready`
- `inject_already_active`
- `task_create_failed`
- `stackchan-serial-capture`
- `stackchan-usb-logs`
- `stackchan-celebrate-diagnose`
- `stackchan-device-version`
- `docs/runbook/voice-injection-celebrate-e2e.md`
