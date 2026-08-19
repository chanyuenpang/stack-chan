# StackChan dev local HTTP control and XiaoZhi celebrate chain

## 结论

StackChan firmware 里已有一条实验链路：本地 HTTP 控制面可以唤醒 XiaoZhi listening，并把内嵌 WAV 作为“麦克风上行音频”注入 XiaoZhi；如果语义触发 `self.robot.celebrate` MCP tool，最终进入 firmware 的庆祝 executor，执行 LED 与头部动作。另有两条捷径可以绕过 ASR：`POST /dev/celebrate` 直接触发庆祝，或 `POST /dev/mcp/call` 调用 `self.robot.celebrate`。

这套能力是 dev/实验控制面，默认不应视为生产 API；必须同时启用 `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP=ON` 和 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL=ON` 才真正暴露 LAN HTTP endpoint。

## 长期行为 / 规则

- 本地 HTTP 控制入口在 `firmware/main/hal/hal_dev_local_control.cpp`，端口为 `18080`，默认 Header token 键为 `X-StackChan-Dev-Token`，默认值来自 `STACKCHAN_DEV_LOCAL_CONTROL_TOKEN`（默认 `stackchan-dev`）。
- HTTP 控制面当前没有 `/dev/chat`、`/dev/toggle`、`/dev/listen`；listening 状态只通过：
  - `POST /dev/wake`：调用 `Application::GetInstance().StartListening()`，显式进入 listening。
  - `POST /dev/stop`：调用 `Application::GetInstance().StopListening()`。
  - `GET /dev/status`：返回 version、ip、state、heap、RSSI 等只读状态。
- `/dev/inject_prompt` 不是播放喇叭音频，而是把内嵌 WAV 解析成 PCM frame 后注入 XiaoZhi 上行发送队列，等价于“伪造麦克风输入”。
- 注入 WAV 的稳定格式约束：RIFF/WAVE、PCM、mono、16000 Hz、16-bit；`AudioService::InjectPcmFrameToSendQueue()` 要求每帧 sample 数匹配 `ESP_AUDIO_SAMPLE_RATE_16K * OPUS_FRAME_DURATION_MS / 1000`。
- 庆祝动作最终收敛到 `start_celebrate_modifier()`；无论来自 HTTP `/dev/celebrate`、HTTP `/dev/mcp/call` 还是 XiaoZhi 原生 MCP tool `self.robot.celebrate`，都会进入同一 executor。
- `sound` 参数目前在 `start_celebrate_modifier()` 中被 `(void)sound;` 忽略；庆祝 executor 只做 LED + 头部运动，不播放庆祝音效。若需要音效，应单独走 `/dev/play_sound`，但它不是庆祝 executor 的组成部分。
- 庆祝动作有并发限制：已有 active 庆祝时再次调用会返回 `already_active`；动作推进依赖 `_stackchan_update_task()` 周期调用 `stackchan_celebrate_tick()`。
- `duration_ms` 的用户帮助与实际 clamp 存在差异：`tools/remote_control/remote_control.py` help 写 `3200-6000 ms`，但 `hal_mcp.cpp` 当前会把 duration clamp 到 `8000-9000`。
- `tools/xiaozhi-mcp-bridge` 不是设备控制桥；它只给 XiaoZhi 读取 plan / completion event 状态，不能直接触发 StackChan HTTP endpoint。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_dev_local_control.cpp`：dev 本地 HTTP server、endpoint 注册、token 校验、`/dev/wake`、`/dev/stop`、`/dev/inject_prompt`、`/dev/celebrate`、`/dev/mcp/call` 的主要入口。
- `firmware/main/hal/hal_mcp.cpp`：`self.robot.celebrate` MCP tool 注册 / dispatch 与 `start_celebrate_modifier()`、`stackchan_celebrate_tick()` 庆祝 executor 主实现。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/hal.cpp` | `_stackchan_update_task()` 周期执行 motion update 和 `stackchan_celebrate_tick()`；`Hal::xiaozhi_init()` 附近启动 dev serial / local HTTP 控制。 |
| `firmware/main/hal/hal_celebrate.h` | 对外声明 `start_celebrate_modifier()`、`stackchan_celebrate_tick()` 等庆祝接口。 |
| `firmware/main/CMakeLists.txt` | `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`、`STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` 编译开关、WAV 资源嵌入、`esp_http_server` 依赖。 |
| `firmware/xiaozhi-esp32/main/audio/audio_service.cc` | `AudioService::InjectPcmFrameToSendQueue(std::vector<int16_t>&& frame)`，把 PCM frame 推入编码 / 上行发送队列。 |
| `firmware/main/hal/hal_dev_serial.cpp` | USB serial 的 `wake`、`stop`、`prompt_sample`、`saytest`，以及 `inject_prompt_sample()` 的类似注入能力。 |
| `tools/remote_control/remote_control.py` | Python 客户端封装 `wake()`、`stop()`、`celebrate()`、`mcp_call()`、`play_sound()`、`inject_prompt()`；默认 IP/端口/token 在这里。 |
| `tools/xiaozhi-mcp-bridge/bridge.mjs` | XiaoZhi 侧只读 MCP bridge；暴露 `ping`、`echo`、`get_time`、`get_plan_status`、`get_latest_completion_event`，不直接控制设备。 |
| `tools/xiaozhi-mcp-bridge/README.md` | 明确 bridge 不提供设备控制、不修改 plan；`get_latest_completion_event` 按 TTL 重新计算 `should_celebrate`。 |

## 真实调用链路

### HTTP 注入 prompt → XiaoZhi 语义触发庆祝

1. `POST /dev/inject_prompt` 进入 `firmware/main/hal/hal_dev_local_control.cpp`，先校验 `X-StackChan-Dev-Token` 并确认 `hal_bridge::is_xiaozhi_ready()`。
2. `g_inject_active` 做防重入；已有注入任务时返回 `409 inject_already_active`。
3. 创建 FreeRTOS task `inject_prompt_task`。
4. task 解析内嵌 WAV `celebration-tts-16k-mono-s16-approx3s.wav`，并要求 PCM mono 16k s16。
5. task 调用 `Application::GetInstance().StartListening()`，等待设备进入 `kDeviceStateListening`。
6. task 按 `kPcmFrameSamples` 切分 PCM，每帧约 `60ms` 注入一次。
7. 每帧通过 `AudioService::InjectPcmFrameToSendQueue()` 进入 XiaoZhi 编码 / 上行发送队列。
8. task 追加静音尾巴，等待 VAD/识别收尾，再调用 `StopListening()` 并清理 `g_inject_active=false`。
9. XiaoZhi 若把 prompt 语义理解为庆祝，会调用 `self.robot.celebrate` MCP tool。
10. firmware 中 `stackchan_mcp_dispatch_tool()` / `McpServer::AddTool("self.robot.celebrate", ...)` 最终调用 `start_celebrate_modifier()`。
11. `_stackchan_update_task()` 周期调用 `stackchan_celebrate_tick()`，推进 LED 与头部运动。

### 直接 HTTP 触发庆祝

1. `POST /dev/celebrate` 由 `celebrate_handler()` 解析 JSON 字段 `style`、`duration_ms`、`intensity`、`sound`。
2. handler 调用 `start_celebrate_modifier(style, duration_ms, intensity, sound, &error)`。
3. executor 从 `Pending` 进入 `Running`，记录开始时间，调用 `applyCelebrateStartLight(...)`。
4. 后续 tick 约每 `150ms` 更新 LED step，约每 `1500ms` 调度一次 head motion frame，共约 `5` 个 motion frame。
5. 达到 duration / timeout / bus dead 后调用 `finishCelebrateLocked(...)` 收尾。

### HTTP MCP call 触发庆祝

1. `POST /dev/mcp/call` 由 `mcp_call_handler()` 解析 `tool` 和 `arguments`。
2. 当 `tool == "self.robot.celebrate"` 时，`stackchan_mcp_dispatch_tool()` 解析参数。
3. 参数最终进入同一个 `start_celebrate_modifier()`，后续 tick 行为与直接 `/dev/celebrate` 相同。

## HTTP endpoint 速查

| Endpoint | 方法 | 长期含义 |
| ---- | ---- | ---- |
| `/dev/wake` | `POST` | 显式 `StartListening()`，不是 toggle。 |
| `/dev/stop` | `POST` | 显式 `StopListening()`。 |
| `/dev/status` | `GET` | 返回设备版本、IP、状态、heap、RSSI 等。 |
| `/dev/inject_prompt` | `POST` | 注入内嵌 WAV 到 XiaoZhi 上行音频队列，非本地播放。 |
| `/dev/celebrate` | `POST` | 直接调用庆祝 executor。 |
| `/dev/mcp/call` | `POST` | 通过 HTTP 调 firmware MCP dispatch，可调用 `self.robot.celebrate`。 |
| `/dev/play_sound` | `POST` | 播放内置 sound；与庆祝 executor 分离。 |

## 资源路径

| 路径 / 符号 | 作用 |
| ---- | ---- |
| `firmware/main/assets/dev_serial/celebration-tts-16k-mono-s16-approx3s.wav` | `/dev/inject_prompt` 当前使用的内嵌 prompt WAV。 |
| `firmware/main/assets/dev_serial/celebration-short-16k-mono-s16.wav` | serial 注入会优先尝试的 short WAV；失败再 fallback 到 approx3s。 |
| `_binary_celebration_tts_16k_mono_s16_approx3s_wav_start` / `_end` | `/dev/inject_prompt` 使用的链接器嵌入资源符号。 |
| `firmware/main/assets/sfx/camera_shutter.ogg` | `/dev/play_sound` 可播放的普通音效资源之一。 |
| `firmware/main/assets/sfx/new_notification.ogg` | `/dev/play_sound` 可播放的普通音效资源之一。 |
| `firmware/xiaozhi-esp32/main/assets/lang_config.h` | `Lang::Sounds::*` locale 音效映射。 |

## 已知陷阱

- 不要把 `/dev/inject_prompt` 当成本地扬声器播放：它走 XiaoZhi 上行音频队列，会受 VAD/ASR/协议状态影响。
- 不要查找或实现不存在的 `/dev/chat`、`/dev/toggle`、`/dev/listen`；HTTP 侧当前明确使用 `/dev/wake` 和 `/dev/stop`。
- 不要认为 `sound: true` 会让庆祝动作发声；当前该参数被忽略。
- 不要把 `tools/xiaozhi-mcp-bridge` 当成控制设备的桥；它只暴露只读状态，真正控制设备的是 firmware HTTP endpoint 或 firmware MCP tool。
- 默认 token 很弱，只适合 LAN/dev 环境；不要把这套 HTTP 控制面暴露到公网或不可信网络。
- 后续改 duration 行为时，同时核对 `remote_control.py` help 与 `hal_mcp.cpp` clamp，避免 CLI 说明与实际不一致。

## 验证标准

- 编译配置必须同时启用 `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP=ON` 与 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL=ON`，并确认 `esp_http_server` 依赖被加入。
- HTTP 控制路径验证应至少覆盖：`/dev/status`、`/dev/wake`、`/dev/stop`、`/dev/inject_prompt`、`/dev/celebrate`、`/dev/mcp/call`。
- 音频注入改动应验证 WAV 格式约束、frame sample 数、`g_inject_active` 防重入、StartListening/StopListening 收尾。
- 庆祝 executor 改动应验证 already_active、duration clamp、tick 推进、LED/head motion 收尾，以及 `_stackchan_update_task()` 是否仍周期调用 `stackchan_celebrate_tick()`。
- MCP bridge 相关改动应单独验证它仍是只读状态工具，除非明确需求要新增设备控制能力。

## 关键检索词

- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `STACKCHAN_DEV_LOCAL_CONTROL_TOKEN`
- `X-StackChan-Dev-Token`
- `start_dev_local_control_server()`
- `do_start_server()`
- `/dev/inject_prompt`
- `inject_prompt_task`
- `g_inject_active`
- `inject_already_active`
- `AudioService::InjectPcmFrameToSendQueue`
- `StartListening()`
- `StopListening()`
- `self.robot.celebrate`
- `stackchan_mcp_dispatch_tool()`
- `start_celebrate_modifier()`
- `stackchan_celebrate_tick()`
- `_stackchan_update_task()`
- `get_latest_completion_event`
