# StackChan Wi-Fi 麦克风 PoC 设计

## 目标与边界

在不改变现有 USB UAC+CDC 基线的前提下，为 StackChan 增加一条统一的 Wi-Fi Audio/Dock 链路：设备通过局域网把来自 CoreS3 codec 的音频、触摸与状态发送给 PC Companion，并从同一条连接接收类型受限的 Dock 控制命令。此 PoC 不刷写设备，不控制 Codex Desktop Voice，也不实现扬声器下行音频。

USB UAC 仍是回退路径；Wi-Fi 只替代音频数据线，不提供设备供电。

当前 USB 配置为 24 kHz、16-bit、单声道 PCM，每 10 ms 一帧，即每帧 480 bytes、裸码率 384 kbit/s。PoC 保持该采样格式，先避免编码器延迟、CPU 预算和可诊断性混入首轮结论。

## 已验证的接入约束

- `usb_uac_mvp.cpp` 已从 `AudioCodec::InputData` 取得输入，并将多通道输入折叠为单声道；Wi-Fi 采集必须复用同一 codec 所有权模型。
- `CONFIG_STACKCHAN_USB_UAC_MVP` 的启动分支不安装应用，也不调用网络启动。因此 Wi-Fi 不能简单叠加到该运行时，而应有独立的 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP` 分支。
- 现有 HAL 能启动 Wi-Fi，并提供 `Network::CreateWebSocket`；设备是主动连接 PC Companion，而非在局域网开放一个未经认证的音频监听端口。
- Wi-Fi MVP 和小智语音互斥：二者都需要 codec 输入。切换必须在启动时明确选择，不能运行时并发读取。

## PoC 传输协议

设备建立到 PC Companion 的 `wss://<pc-host>:<port>/stackchan/audio/v1` 单一连接。连接前，PC 通过本机启动参数提供一次性 256-bit 配对密钥；设备通过现有 BLE 配网通道首次写入专用 NVS 项。BLE 不参与运行时音频或 Dock 控制。密钥不得出现在日志、状态页或音频帧中。

握手先发送 JSON 控制帧：

```json
{
  "type": "hello",
  "protocol": 1,
  "device_id": "<mac-derived-id>",
  "format": { "codec": "pcm_s16le", "sample_rate": 24000, "channels": 1, "frame_ms": 10 },
  "nonce": "<random>",
  "auth": "<HMAC-SHA256 over device_id and nonce>"
}
```

服务端校验协议、格式和 HMAC 后返回 `ready` 控制帧。之后设备发送二进制帧：

```text
version:u8 | flags:u8 | sequence:u32be | capture_time_us:u64be | payload_length:u16be | PCM payload
```

其中 payload 固定为 480 bytes。序号只用于计算丢帧和乱序；接收端不可等待补包。TCP/WebSocket 已保证有序，过期帧的正确策略是丢弃而非让延迟不断累积。

同一连接的文本控制帧复用现有 Dock 协议：PC 发送 `{v,id,cmd,args}`，设备返回 `{v,id,ok,result}` 或 `{v,id,ok:false,error}`，设备事件使用 `{v,seq,event,data}`。命令仍由既有 allowlist 校验，因此 Wi-Fi 不引入原始命令或任意透传接口。

## 背压、重连与观测

- 设备端最多缓存 3 帧（30 ms）；发送阻塞或队列满时丢弃最旧帧，并累计 `dropped_backpressure`。
- 连接断开后停止发送、释放队列内容，以 1、2、4、8、15 秒上限并加入抖动重连。
- PC Companion 记录握手失败原因、相邻序号缺口、接收时间、音频帧大小、设备声明的 capture timestamp、重连次数和接收端队列深度；日志绝不包含密钥或原始 PCM。
- PoC 成功标准：同一局域网连续采集 10 分钟，接收端无进程崩溃；音频帧格式 100% 合法；可量化端到端延迟、丢包和重连恢复时间。是否适合 Codex Voice 由这些实测值决定。

## 当前集成实测与边界

Wi-Fi Audio 已完成当前设备到 Windows Dock 的实测：设备完成站点关联和认证 Dock 连接，Dock 至少接收 `1,501` 帧 / `720,480 bytes` PCM、`gaps=0`。Windows 端使用 VB-CABLE 验证虚拟音频输入：DirectSound 24 kHz 输出会静默，已改为 WASAPI 48 kHz 输出并作 2 倍重采样；回环与真实 Wi-Fi PCM 均可观测到非零样本。详见 [Wi-Fi Audio 启动诊断记录](stackchan-wifi-audio-boot-diagnostics.md)。

这不等同于最终全无线验收：尚未在 Codex Desktop Voice 中选择并实测该虚拟输入，也尚未完成 USB 物理拔除后 Dock 控制、麦克风和状态反馈的联合验证。

## 明确不做（已调整）

- 不把 BLE GATT 当作实时音频传输；BLE 仅用于首次 Wi-Fi 与 Wi-Fi Audio 配置。
- 不新增广播发现、无鉴权 LAN HTTP 接口或公网暴露。
- 本轮使用 VB-CABLE 验证接收 PCM 可进入 Windows 虚拟输入；这不自动替代 Codex Desktop 的声卡选择，也不代表 Codex Voice 已完成实测。
- 不修改、替换或擦除设备上已验证的 USB 音频固件。

## 启动诊断记录

完整 Wi-Fi Audio transport 曾在应用日志出现前连续复位；当前采用分段二分恢复最小启动能力。现状、已排除范围、镜像阶段和后续实验顺序见 [Wi-Fi Audio 启动诊断记录](stackchan-wifi-audio-boot-diagnostics.md)。该记录不包含 Wi-Fi 密码或 PC Dock 配对材料。

## 后续决策门

PoC 验证后才在两条 PC 接入路线中选择其一：

1. Wi-Fi 接收器输出到 Windows 虚拟麦克风，继续使用 Codex Desktop Voice。
2. Wi-Fi 接收器直接交给独立 PC 语音客户端，并明确其与 Codex Desktop Voice 的产品边界。

在此之前，Wi-Fi 仅被定义为可测量的音频输入传输层。
