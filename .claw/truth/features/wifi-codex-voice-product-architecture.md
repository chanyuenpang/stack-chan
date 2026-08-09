# StackChan Wi-Fi Codex Voice 产品架构

<!-- state: current -->

## Current behavior

### 产品目标

StackChan 应在正常使用时不依赖 USB 数据线，通过 Wi-Fi 完成以下能力：

- 把机器人麦克风语音送入 PC 上由用户手动启动的 Codex Voice。
- 把 Codex Voice 的回复送回机器人喇叭播放。
- 由 PC Dock / MCP 控制机器人表情和其他已注册能力。第一版明确只验收屏幕表情，不验收舵机动作；待机自动头动保持禁用，显式头部动作留作后续已知缺陷处理。

BLE 只用于方便配网和写入 Dock 地址/凭据，不承载音频。PC 网络必须保持用户现有软路由链路，不得为了测试切换 PC Wi-Fi。

### 唯一产品主线

机器人端以仓库内已有的官方 XiaoZhi 设备音频链为基线：

`StackChan codec/BSP -> Application -> AudioService -> Opus -> XiaoZhi WebSocket v1`

- 麦克风/喇叭 codec 生命周期、I2S/TDM、Opus、输入/输出任务、有界队列和 Listening/Speaking 状态机由官方 `Application + AudioService` 负责。
- 没有 AEC 时采用官方可靠半双工：Listening 上传麦克风；收到 `tts:start` 后进入 Speaking 并停止麦克风上行；播放完成收到 `tts:stop` 后恢复 Listening。
- PC Dock 通过官方 OTA bootstrap 响应下发本地 WebSocket URL/token/version；BLE 只保存 bootstrap 地址和 pairing token。机器人端不再新增第二套协议选择器，并把音量手势、头部麦克风开关、状态灯和机器人 MCP 能力接到官方状态机。
- 当前 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP` / `wifi_audio_dock_mvp.cpp` 自研 raw PCM/UDP、speaker frame 和 codec owner 不是产品主线；新链路验收前先 feature flag 停用，整体验收后再决定删除。

PC Dock 作为本地 XiaoZhi-compatible WebSocket server：

- 接收机器人上行 binary Opus，解码后送入 Codex Voice 的虚拟麦克风。
- 捕获 Codex Voice 输出，编码为 Opus，并按 `tts:start -> binary audio -> tts:stop` 返回机器人。
- 承担 session/auth、协议适配、Codex 音频路由以及 MCP/表情映射，不重新实现机器人 codec 生命周期。
- Windows 虚拟音频只保留一个原生、事件驱动的 WASAPI broker；Python `sounddevice`/PortAudio 跨进程 player/capture 不作为产品链路。

### 当前证据边界

- 官方本地 Dock 固件候选已经恢复 `Application + AudioService + WebSocket`，并完成完整 ESP-IDF 构建、app-only 写入、独立只读校验和启动恢复；当前 `sdkconfig.xiaozhi_dock` 明确关闭旧 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP`。当前实机 app 为待机头动隔离候选 `C484CC7C...D7787D5`，写后状态接口返回 `idle`。
- 设备已读取本地 HTTP bootstrap，连接并通过 PC 侧 XiaoZhi WebSocket v1 鉴权；这证明官方设备音频框架与本地 Dock 的会话边界成立，不等于 Codex Voice 产品验收。
- PC 侧统一使用本地 bootstrap、XiaoZhi WebSocket v1、原生事件驱动 WASAPI broker、官方半双工和 typed MCP。固定下行语音已经完成自动 `speaking=true -> false`、全帧提交和 Listening 恢复；机器人喇叭听感仍须用户确认。真实 MCP stdio client 调用 `stackchan_set_expression(happy)` 已返回 `ok=true` 且 delivery 为 `xiaozhi-websocket`，但屏幕表情仍须用户目视确认。
- Codex 用户配置中的 `mcp_servers.stackchan_wifi` 曾仍指向已经淘汰的 `start-wifi-audio-mcp.ps1`。现已改为产品入口 `tools/stackchan-dock/scripts/start-xiaozhi-mcp.ps1`，并通过 TOML 解析和 PowerShell AST 检查；该配置在下一次 Codex 任务加载时生效。`start-xiaozhi-dock.ps1 --standalone` 只用于独立诊断，不是正常产品启动方式。
- 用户再次确认设备崩溃发生在待机自动摇头，而不是音频处理。当前本地 Dock profile 已用 `CONFIG_STACKCHAN_XIAOZHI_DISABLE_IDLE_HEAD_MOTION=y` 禁止挂载随机 `IdleMotionModifier`，同时保留屏幕待机表情和显式 MCP 头部命令；这是稳定性隔离，不等于舵机底层缺陷已经修复。
- 用户试听当前 Wi-Fi 麦克风回录中的室内生活音后确认音质没有问题。这只证明该窗口的环境音无明显机器人声或电流失真；因为没有标准人声实际从 PC 物理扬声器发出，不能外推人声可懂度、源相对保真或 Codex Voice 已通过。
- 2026-08-09 的两次“标准声学 HIL”均为无效夹具窗口：第一次没有形成物理外放，第二次采集接近数字静音且设备不在有效上行态。两次都不得作为产品音质证据，也不再继续深挖物理外放夹具。
- `POST /dev/inject_prompt` 仍是设备已知源上行的开发入口，但 live microphone 与 injected prompt 并发写入会污染单源参考映射；该 HIL 只能在单一来源前提被证明后用于定位，不能取代真实产品入口验收。
- Windows BLE/LAN 配置保留机器人现有 Wi-Fi 且不修改 PC 网络。PC 必须继续使用现有软路由链路；音频验证不得通过切换 PC Wi-Fi 获得更好结果。
- 当前已完成真实 Codex Voice 双向对话、机器人喇叭人工听感和 MCP 屏幕表情人工验收。物理断开 USB 后，Windows 不再枚举 StackChan USB 接口或 COM 口，机器人仍可通过 Wi-Fi 完成 Codex Voice 输入与回复播放；同一无 USB 窗口内，MCP `happy` 表情命令成功交付且用户确认屏幕表情可见。第一版产品门禁全部通过，状态为 **PASS / Complete**。
- 当前完成候选 app SHA-256 为 `C484CC7CB3EA58FD2F261A03CF9A206C9CD8164EE162DCA51CFA2CF02D7787D5`。正常使用由 Codex MCP 配置启动 `tools/stackchan-dock/scripts/start-xiaozhi-mcp.ps1`；独立 standalone Dock 仅用于诊断。
- 本地 Dock 是产品运行期依赖，不是只在对话时临时启动的工具。机器人启动阶段需要访问其 OTA bootstrap 端口取得本地 WebSocket 配置，随后语音和 MCP 使用同一 Dock 的 WebSocket；关闭 Dock/bootstrap 可能使机器人无法正确进入本地产品系统。正常产品入口必须在机器人启动前可用，并在使用期间保持运行。
- 舵机动作不属于第一版完成标准。随机待机摇头保持禁用；显式头部动作的硬件稳定性仍是已知后续问题，不能把本次 V1 完成外推为舵机缺陷已修复。

### 开发与验收规则

1. 先按产品边界判断进度：真实 Wi-Fi 麦克风、机器人喇叭、Codex Voice、MCP 可见动作和断 USB 是交付门禁；HIL、相关性和内部帧计数只用于定位失败，不得成为替代目标。
2. 再次刷写机器人前，先完成 PC-only XiaoZhi 协议模拟器到 WASAPI 的双向门禁。
3. 质量评估必须使用固定语料集和 source-to-capture 映射，至少输出时钟比例、延迟、插入/删除/重复区间、增益、相关性、残差 SNR，并用纯 codec golden 隔离 Opus 有损误差。
4. 无损 PCM/WASAPI 段的准入基线为每条 corr >= 0.999、SNR >= 50 dB、gain 0.98-1.02、新增零样本 <= 0.1%。Opus 段与同版本纯 encode/decode golden 比较，不要求逐样本相等。
5. 人声音质使用多条参考语料和 ViSQOL 聚合回归；单条录音、单个频谱或单个丢帧数字不能单独判定通过。
6. 任一离线门禁失败，不刷固件、不要求用户试听。全部通过后只做一次最小 HIL，再进行用户最终听感验收。
7. 第一版产品 PASS 需要同时证明：Wi-Fi 麦克风可驱动 Codex Voice、回复可由机器人喇叭清晰播放、MCP 屏幕表情可见、半双工可恢复、断开 USB 后仍可工作。舵机动作由用户明确延期，不纳入第一版 PASS。`ready`、绿灯、连接成功或局部帧计数都不能代替产品 PASS。
8. 测试过程、候选身份、原始数据、失败边界和用户听感必须持续记录；事实、推断和待验证假设分开书写。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/main.cpp` | 当前 Wi-Fi MVP 绕开官方 Application 的分支入口。 |
| `firmware/xiaozhi-esp32/main/application.cc` | 官方 Listening/Speaking、`tts:start/stop` 与半双工状态机。 |
| `firmware/xiaozhi-esp32/main/audio/audio_service.cc` | 官方 codec、采集/播放、Opus、队列与 PCM 注入。 |
| `firmware/xiaozhi-esp32/main/protocols/websocket_protocol.cc` | 官方 XiaoZhi WebSocket 设备协议实现。 |
| `firmware/xiaozhi-esp32/main/ota.cc` | 官方 websocket 配置写入机制的现有锚点。 |
| `tools/stackchan-dock/` | 本地 XiaoZhi server、Codex 音频适配和 MCP 的 PC 侧所有者。 |
| `tools/stackchan-dock/scripts/provision-xiaozhi-dock.ps1` | 受保护的 Windows BLE 官方 bootstrap 配置入口；不修改 PC 网络或机器人 Wi-Fi。 |
| `ops/bin/test-xiaozhi-audio-hil.ps1` | 固定 WAV 经 `/dev/inject_prompt` 上行、native WASAPI capture 与 reference-relative 比较。 |
| `ops/bin/test-xiaozhi-speaker-hil.ps1` | 固定人声经 production process loopback/Opus 下行的自动门禁；听感仍由用户判定。 |
| `docs/research/evidence/half-duplex-20260807/README.md` | 历史候选、录音、客观指标和实机测试时间线。 |
| `docs/research/stackchan-wifi-audio-boot-diagnostics.md` | 启动、音频、网络和 PC 虚拟音频诊断总记录。 |
| `docs/research/stackchan-xiaozhi-audio-migration-baseline.md` | 官方版本身份、调用链、配置入口、模块所有权与迁移清单。 |

### 外部基线

- M5Stack StackChan：<https://github.com/m5stack/StackChan>
- M5Stack StackChan BSP：<https://github.com/m5stack/StackChan-BSP>
- XiaoZhi WebSocket protocol：<https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md>
- ESP-IDF pytest-embedded：<https://docs.espressif.com/projects/pytest-embedded/en/latest/>
- ESP-IDF Application Level Tracing：<https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/system/app_trace.html>
- Google ViSQOL：<https://github.com/google/visqol>

<!-- state: history -->

## Evolution history

<!-- dated: 2026-08-09 -->

### 停止自研音频主线并恢复官方边界

此前方案同时自研设备 codec 生命周期、I2S/TDM owner、半双工状态机、raw PCM/UDP、speaker frame、网络队列和 Python/PortAudio 虚拟声卡桥。局部实验曾分别证明硬件采集、播放或 transport，但无法形成稳定可交付产品，并反复把 PC 供数失真、设备音频和 Wi-Fi 传输混在一起诊断。

本次把旧路线正式降为历史证据，改为复用官方 XiaoZhi 设备音频栈和协议，只在 PC Dock 实现本地 server、Codex 音频适配和 MCP。Task57、Task71 以及所有失败录音继续保留为回归资产，不因路线切换而丢弃。

<!-- dated: 2026-08-09 -->

### 固化可重复的 PC 配网与双向 HIL

旧 BLE 工具只接受 `ws(s)` endpoint，无法配置官方模式所需的 HTTP OTA bootstrap；现已兼容两种合同，并由受保护 PowerShell wrapper 从现有 PC 路由生成 bootstrap URL。已知源上行不再依赖当前固件中被禁用的 dev serial task，改走历史已验证的 Wi-Fi dev HTTP 注入；下行以独立进程回环驱动真实 production broker。两套 HIL 都把自动传输证据与用户音质结论分开。
