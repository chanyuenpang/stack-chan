# StackChan XiaoZhi 音频迁移基线与清单

## 结论

Wi-Fi Codex Voice 的设备侧基线固定为 **官方 StackChan 集成的 XiaoZhi 音频链**，不是通用 M5Stack/CoreS3 示例，也不是直接追随 `78/xiaozhi-esp32` 最新 HEAD。

当前工作树不能通过一次配置开关直接恢复产品能力：`CONFIG_STACKCHAN_WIFI_AUDIO_MVP` 不仅改变 `main.cpp` 入口，还改变 StackChan 专用 `CoreS3AudioCodec` 的 channel owner、TDM geometry、gain、Read/Write 和 Listening/Speaking 重建。迁移必须按模块所有权逐层恢复，并保留已有 StackChan 扩展和回归证据。

本阶段只完成只读基线和接口决策；未改产品代码、未构建、未刷写、未做实机或听感验收。

## 精确版本与工作树身份

| 对象 | 当前/参考身份 | 边界 |
| ---- | ------------- | ---- |
| 当前 StackChan 根仓库 | `cf98815bdd8828005ad843feee21885ac1190af6` | 用户 fork 当前 HEAD，工作树有大量既有改动。 |
| 官方 StackChan 参考 | `m5stack/StackChan@b72b3ede38b32d54f0b6ba51c62cfcef2ec3ae1e` | 2026-08-09 只读 `origin/main` 与远端 HEAD 一致；作为硬件/BSP/集成参考。 |
| 根仓库分叉 | 当前 HEAD 相对官方 `20` 个提交在左、`24` 个提交在右；merge-base `da156e1fa0e1c2a5e00b78fbf69b1f7e7bca0483` | 禁止用 checkout/reset/整仓覆盖迁移；只做有边界的增量实现。 |
| 当前嵌套 XiaoZhi base | `e77dedb1309153bb63fed285772962c920c97dd4` | detached/嵌套 Git，且 `Application`、`AudioService`、protocol 等已有本地改动。 |
| XiaoZhi 上游远端 HEAD | `18a60b8051f5ee6a25beed6248ed84c7fcc742bf` | 仅说明上游已前进；本计划不独立升级 vendor，避免脱离官方 StackChan 集成。 |
| StackChan 关键集成本地 diff 指纹 | Git binary diff SHA-1 `bb0c8e57d6343319ae8c1298f26e156d79d2ce24` | 覆盖 main/CMake/Kconfig/CoreS3 codec/HAL bridge 关键文件。 |
| XiaoZhi 关键本地 diff 指纹 | Git binary diff SHA-1 `3adee9d26487dd10e89e854e3e4789705a580258` | 覆盖 Application/AudioService/WebSocket/MQTT/OTA 关键文件。 |
| 旧 Wi-Fi MVP 源身份 | `wifi_audio_dock_mvp.cpp` SHA-256 `C664451A...82A19`; header `523C6B73...D092` | 历史取证/回滚资产，不再是产品主线。 |

## 已确认调用链

### 官方产品链

1. 官方 `main.cpp` 完成 HAL/Launcher 后调用 `Hal::startXiaozhi()`。
2. `Hal::startXiaozhi()` 启动 StackChan update task，然后进入 `hal_bridge::start_xiaozhi_app()`。
3. `Application::Initialize()` 获取 StackChan `Board::GetAudioCodec()`，调用 `AudioService::Initialize(codec)` 与 `Start()`。
4. `AudioService` 拥有 audio input/output/Opus task、16 kHz 上行、60 ms Opus、有界 encode/decode/send/playback queue 和 codec power lifecycle。
5. `Application::ActivationTask()` 经 `Ota::CheckVersion()` 取得协议配置，再由 `InitializeProtocol()` 选择 MQTT 或 WebSocket。
6. `WebsocketProtocol` 从 `Settings("websocket")` 读取 `url/token/version`，发送 device hello，接收 server hello；binary frame 是 Opus，JSON 承担 TTS/state/MCP。

### 当前被绕开的链

`firmware/main/main.cpp:235-267` 在 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP` 下直接启动 BLE 和 `start_stackchan_wifi_audio_dock_mvp()`，随后停留在独立循环。因此正常 `Hal::startXiaozhi -> Application -> AudioService -> WebsocketProtocol` 完全没有运行。

这不是“小智链偶尔失效”，而是构建期选择了另一套产品运行时。

## StackChan 硬件适配边界

官方 `m5stack/StackChan@b72b3ed` 的 `CoreS3AudioCodec` 明确使用 StackChan 的 ES7210、AW88298、24 kHz input/output、TDM 四槽时钟和 XiaoZhi codec 接口。它不是通用 M5Stack 设备假设。

当前本地 codec 相对官方增加了 500+ 行 Wi-Fi MVP 所有权和诊断逻辑：

- MVP 模式改为单 owner，Listening 时 RX-only TDM4、Speaking 时 TX-only。
- MVP 下 `input_channels=4`、gain 30 dB、direct `i2s_channel_read`，并由上层选择 slot0/slot2。
- 非 MVP 分支仍保留官方 duplex/codec-dev 形态。
- 用户批准的 Task57 证明当前 MIC1/slot0 采集在传输连续窗口内可以清晰；历史错麦是把 raw index1/slot1 当成 MIC2，而不是官方左声道逻辑本身。

因此迁移规则是：

1. `Application/AudioService` 必须成为唯一设备音频 owner。
2. 第一版以官方 StackChan duplex codec 适配为结构基线，不把旧 `SetWifiAudioMode()` 生命周期接入 AudioService。
3. 已验证 MIC1 选择、30 dB golden、strict read/诊断作为回归观测项保留，但是否进入产品 codec 必须由 PC-only 和已知 PCM HIL 证明，不能凭历史试听直接搬入。
4. 不从 `xiaozhi-esp32/main/boards/m5stack-core-s3` 复制通用 CoreS3 codec 覆盖 StackChan 专用 `firmware/main/hal/board`。

## 本地 Dock 配置决策

选择复用官方 OTA bootstrap，而不是在 `Application::InitializeProtocol()` 再造一个本地协议选择分支：

1. PC Dock 暴露一个 XiaoZhi-compatible bootstrap HTTP endpoint。
2. 响应只提供 `websocket` 配置，不同时提供 `mqtt`，因为当前官方选择顺序是 MQTT 优先。
3. bootstrap 返回 `websocket.url`、`websocket.token`、`websocket.version=1`；官方 `Ota::CheckVersion()` 已负责写入 `Settings("websocket")`。
4. 现有 BLE `set_wifi_audio` 入口改为保存 Dock bootstrap URL 与 64-hex pairing token；token 作为本地 WebSocket Bearer credential 使用，不写入文档/日志。
5. 设备后续仍由官方 `WebsocketProtocol` 从 NVS 读取并连接，不在 codec/audio task 内解析 Dock URL。

若 PC Dock bootstrap 暂时不可达，设备应保留 Launcher/BLE 配置和可诊断状态，不允许回退启动旧 Wi-Fi MVP。

## 模块所有权与迁移清单

| 能力 | 目标所有者 | 当前动作 |
| ---- | ---------- | -------- |
| I2S/TDM、ES7210、AW88298 | StackChan `CoreS3AudioCodec` + XiaoZhi `AudioService` | 以官方 StackChan 结构恢复，去除 MVP 对 AudioService 的旁路所有权。 |
| 采集、播放、重采样、Opus、队列 | XiaoZhi `AudioService` | 保留本地诊断和 `InjectPcmFrameToSendQueue` 扩展，经逐项 review 后迁移。 |
| Listening/Speaking/半双工 | XiaoZhi `Application` | 继续使用 `tts:start/stop` 和现有 watchdog；不在 Dock MVP 再维护第二套状态。 |
| 设备网络协议 | XiaoZhi `WebsocketProtocol v1` | 保留 JSON 防御补丁；停止 raw PCM/UDP、自定义 speaker frame/HMAC packet。 |
| 启动与配网 | StackChan Launcher/HAL/BLE + XiaoZhi OTA bootstrap | BLE 写 bootstrap URL/token；官方启动链取得 WebSocket config。 |
| Codex 虚拟麦克风/扬声器 | PC Dock 单一 Rust WASAPI broker | 停止 Python `sounddevice`/PortAudio 跨进程 player/capture。 |
| 本地会话、Opus、TTS | PC Dock XiaoZhi-compatible server | 实现 device/server hello、binary Opus、`tts:start/stop`、session/auth。 |
| 表情/动作 | XiaoZhi MCP + 现有 `self.robot.*` | Dock 转发/映射，不重写舵机/表情 executor。 |
| 音量、头部 mute、状态灯 | StackChan HAL/UI 接到 XiaoZhi 状态 | 从 MVP helper 迁移为 Application/AudioCodec/Display 的薄适配。 |

## 本地改动保留/重审清单

### 原则上保留

- `Application::StartListeningDefaultMode()` 和 speaking watchdog：已有 canonical Truth，属于对话恢复扩展。
- `AudioService::InjectPcmFrameToSendQueue()`：已知源 HIL 的黄金入口。
- `WebsocketProtocol::ParseServerHello()` JSON 类型防御。
- StackChan update task、MCP/HTTP dispatcher、表情/动作、状态灯、音量和头部 mute 的产品行为。

### 必须重新审查后才能带入

- `AUDIO_SERVICE_DIAG_ENABLED=1` 的常驻开销和日志频率。
- `CoreS3AudioCodec` 的 raw four-slot、single-owner、direct I2S 和 mode transition 代码。
- 所有 `esp-ml307-wifi-audio-*` managed component patch。
- Wi-Fi MVP 的自定义 WebSocket lifecycle、UDP/HMAC、speaker pipe 和 memory/timing tuning。

### 明确停止

- 在旧 `wifi_audio_dock_mvp.cpp` 上继续加 packet retry、TX buffer、I2S owner 或 codec transition 修复。
- Python/PortAudio、MME、WDM-KS、channel count、VB registry latency 的排列组合实验。
- PC-only 数据链未通过前的新固件候选、刷机和用户试听。

## 下一任务的输入合同

PC-only 实现必须直接模拟上述 `WebsocketProtocol v1`，而不是沿用旧 Dock 私有 hello：

- device hello：`type=hello`、`version=1`、`transport=websocket`、`features.mcp=true`、audio `opus/16000/mono/60ms`。
- server hello：`type=hello`、`transport=websocket`、`session_id`、下行 audio `sample_rate=24000`、`frame_duration=60`。
- 上行/下行 binary：version 1 下为裸 Opus payload。
- 播放事务：`tts:start` -> binary Opus -> drain -> `tts:stop`。
- Windows 边界：一个 Rust event-driven WASAPI broker 同时拥有虚拟麦克风 render 与 Codex process-loopback capture。
- 验证：固定语料集、纯 codec golden、source-to-capture 时间映射和成组质量报告；任一失败均停在 PC-only。

## 证据命令摘要

本轮只读使用：

- `git ls-remote` 核对官方 StackChan/XiaoZhi HEAD。
- `git rev-list --left-right --count` 与 `merge-base` 核对分叉。
- `git diff --numstat/--binary | git hash-object --stdin` 固化关键本地 diff。
- 当前工作树与 `origin/main` 的 `main.cpp`、HAL、CoreS3 codec、Application、AudioService、WebSocket/OTA 静态调用链 review。
- 官方主仓库、XiaoZhi 协议和 ESP-IDF/ViSQOL 资料只读调研。

未执行 fetch/merge/checkout/reset，未切换 PC 网络，未修改网络或硬件状态。
