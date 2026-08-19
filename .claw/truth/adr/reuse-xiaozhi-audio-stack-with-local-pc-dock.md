# ADR: 复用 XiaoZhi 设备音频栈并由 PC Dock 提供本地服务

## Context

产品目标是让 StackChan 不依赖 USB，通过 Wi-Fi 为 PC 上的 Codex Voice 提供麦克风和喇叭，并允许 PC 通过 MCP 控制表情和动作。

现有 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP` 路线直接进入 `wifi_audio_dock_mvp.cpp`，绕开已经编译进固件的 XiaoZhi `Application + AudioService + WebSocket`。这条自研路线同时承担 codec/I2S 生命周期、半双工、Opus/PCM、网络协议、队列和恢复逻辑，导致每个局部修复都可能改变另一层行为。

PC 侧也同时使用了多个 Python `sounddevice`/PortAudio 进程衔接 VB-CABLE。Task71-86 已证明，在机器人完全不参与时，同进程链路可高保真，而跨进程链会产生半频、成对样本复制、零数据和低沉不可懂失真。因此继续在现有全栈自研路径上局部调参，不能形成可信的产品收敛。

官方 XiaoZhi 代码已经提供成熟的设备音频所有权：codec 启停、I2S/TDM、Opus、采集/播放任务、有界队列、WebSocket 和 Listening/Speaking 状态机。StackChan 仓库还保留了 MCP、表情、语音注入和本地控制能力。

## Decision

采用以下唯一架构：

1. 机器人端恢复并复用仓库现有 XiaoZhi `Application + AudioService + codec + Opus + WebSocket`，不再维护第二套产品级设备音频栈。
2. PC Dock 实现最小 XiaoZhi WebSocket v1 server，负责 session/auth、Opus 双向音频、`tts:start/stop`、Codex 音频适配和 MCP/表情映射。
3. 没有 AEC 时使用官方半双工状态机；当前阶段不追求全双工愿景。
4. Windows 音频统一迁移到一个原生、事件驱动的 Rust WASAPI broker，替代 Python/PortAudio 跨进程 player/capture。
5. 本地 Dock 通过官方 OTA bootstrap 响应提供 WebSocket URL/token/version；BLE 保存 bootstrap 地址和 pairing token。设备继续由官方 `Ota::CheckVersion()` 写 `Settings("websocket")`，不在 `Application` 内新增第二套协议选择器。全局音量手势、头部麦克风开关和状态灯接入官方状态机。
6. 旧 raw PCM/UDP、自定义 speaker frame 和 codec owner 先由 feature flag 停用；新路线完成产品验收后再删除，避免在迁移期间失去回滚和取证能力。
7. 再次刷固件前必须通过 PC-only 协议与音频数据血缘门禁；实机只承担离线无法证明的最后一层 HIL。
8. Windows BLE 配置以 HTTP(S) bootstrap URL 为官方模式合同，只有设备明确通知 `wifiAudioConfigured` 才算成功；旧 WS(S) endpoint 仅为 raw-PCM 回滚兼容。已知源上行 HIL 走设备现有 `/dev/inject_prompt`，不启用当前被刻意禁用的 USB serial task。
9. Codex 回复文本显示复用 XiaoZhi 字幕帧：同一回复的首段建立 response-level `subtitle_id`，后续文本以 `tts:sentence_append` 追加，只有新回复或 `response_end` 才重置。设备端保留当前像素滚动，只在新增文本时按真实字体度量裁去已完全离开左侧视口的完整 UTF-8 前缀；长字幕滚完或短字幕展示 1.6 秒完成时只隐藏已消费显示、保留 active ID，使延迟 append 仅以新 delta 开始新 pass，不重播旧文本。不恢复旧的句子 enqueue/替换交接，也不把字幕发送门控到 WASAPI/Opus 音频。为抑制 PC/机器人双播，Windows 音频操作限定到 Dock 捕获的 Codex PID：设备认证期间以 `AudioPolicyConfig` 将该应用的渲染端点路由到 VB-Cable `CABLE Input`，设备断线、Dock 退出或 broker stdin EOF 时清除临时路由；不得静音 Codex 会话、修改系统主音量或影响无关应用。
10. 正常产品入口由 Electron 主进程以 owner mode 承载唯一 Dock runtime；它独占 bootstrap `8766`、WebSocket `8765` 和一个 WASAPI broker。独立 Dock 仅用于诊断，不得与该 owner 并行启动或作为正常产品入口。

## Alternatives

### 继续修补自研 raw PCM/UDP 路线

拒绝。该路线重复实现官方已有能力，已经暴露 codec owner、内存、socket、队列、PC 虚拟音频和状态机相互耦合的问题，无法用少量单变量实验建立完整产品信心。

### 只修 Python/PortAudio，保留设备自研音频栈

拒绝。PC 失真确实必须修复，但设备侧仍会保留第二套 codec 生命周期、协议和半双工状态机，无法利用官方产品已经验证的边界。

### 在机器人端直接接入 Codex/OpenAI 协议

拒绝。它会把云端协议、鉴权和产品迭代压力放到嵌入式端，并削弱 PC Dock 作为本地适配和 MCP 控制中心的价值。

### 引入完整第三方 XiaoZhi server

拒绝。当前只需要兼容设备 WebSocket 会话、Opus 和 MCP，不需要复制账号、OTA、云端管理等完整后端。

### 当前阶段实现全双工/AEC

拒绝。用户要求先有可靠可用版本；官方无 AEC 模式下的半双工与当前目标一致，且能显著缩小并发和回声问题面。

## Consequences

- 正向：设备音频的硬件调用方法、顺序和状态所有权回到官方单一实现；本项目只维护与产品差异直接相关的 PC Dock 和配置集成。
- 正向：PC-only、协议模拟、已知 PCM 注入和最终 HIL 可形成分层门禁，失败能定位到确定边界，不再通过反复刷机猜测。
- 正向：现有 StackChan MCP、表情、舵机、状态灯、触摸和音量能力可继续保留，但它们不再拥有或重建 codec。
- 代价：需要迁移/停用大量已完成但不可交付的 Wi-Fi MVP 代码，并实现一个可靠的本地 WebSocket server 与 Rust WASAPI broker。
- 风险：仓库 vendor 的 XiaoZhi/StackChan 代码可能落后于上游发布；实施前必须固定 exact commit/版本和本地差异，不以官网营销说明代替源码事实。
- 风险：摸头/舵机触发崩溃是独立生产风险，必须保留回归门禁，但不得再次混入音质判断。
- 约束：进程树 loopback 负责复制音频；应用级端点路由是独立的输出控制层，只能作用于 Dock 捕获的 Codex PID，且必须在断线、Dock 卸载或 broker stdin EOF 时清除。该控制不得使用会话静音。
- 约束：runtime 所有权转移只允许一次受控 cutover；启动 Electron owner 前必须确认独立 Dock 已退出且两个端口空闲，以避免双 broker、端口冲突或机器人重认证循环。
- 验收：架构完成不等于产品完成。最终必须由用户确认录音和扬声器听感，并证明 Codex Voice、MCP 表情动作、半双工恢复和断 USB 工作。

## Current validation boundary (2026-08-09)

- 该决策已经落实到当前实机候选：旧 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP` 关闭，官方 XiaoZhi `Application + AudioService + WebSocket` 运行，本地 bootstrap 与 WebSocket 鉴权已通过。
- 固定下行语音的自动传输及 `Speaking -> Listening` 生命周期已通过；用户尚未确认机器人喇叭听感。
- 用户已确认一个当前 Wi-Fi 回录窗口中的室内生活音清晰、没有明显机器人或电流失真；该窗口没有实际标准人声物理外放，因此不能作为 Codex 语音输入通过。
- 已知源 HIL 仍是诊断工具，不是产品目标。后续不再为改善夹具指标继续修改产品架构；直接按真实 Codex Voice、MCP 可见动作和断 USB 验收推进。
- 待机自动摇头已被用户再次确认会触发独立崩溃。当前 local Dock profile 仅禁用自动 `IdleMotionModifier`，保留 idle expression 与显式 MCP 动作；这是一项与官方音频框架正交的生产隔离措施。
- 当前候选已通过 app-only 写入、独立校验和 idle 启动门禁；固定下行真人语音自动链通过，MCP stdio `happy` 表情命令也通过官方 WebSocket 交付。两项人工可感知结果仍等待用户确认，不能提前写成产品 PASS。
- 正常产品入口已经固化为 Codex MCP 配置启动 `start-xiaozhi-mcp.ps1`；先前仍指向旧 raw-PCM `start-wifi-audio-mcp.ps1` 的用户配置已纠正。独立 standalone Dock 只保留为诊断入口，避免正常使用继续误启旧框架。
- 用户随后已人工确认机器人喇叭声音正常、MCP `happy` 屏幕表情可见，并完成真实 Codex Voice 双向对话。一次小幅头部命令返回 `ok` 但用户未见物理运动；用户明确决定第一版不处理舵机问题，因此 V1 控制面以屏幕表情通过为准，舵机动作延期且继续默认禁用。
- 最终无 USB 验收已经通过：物理断开 USB 后，PC 不再枚举 StackChan USB/COM 接口，机器人保持 Wi-Fi 在线；用户再次完成 Codex Voice 语音对话，并在同一窗口确认 MCP `happy` 屏幕表情可见。因此本 ADR 所定义的 V1（Wi-Fi 麦克风、Wi-Fi 喇叭、PC MCP 屏幕表情控制、正常使用不依赖 USB）状态为 **Accepted / Implemented / Product PASS**。
- 运维约束：本地 Dock 同时拥有 OTA bootstrap 和音频/MCP WebSocket。机器人启动时必须能够访问 bootstrap，使用期间 Dock 也必须持续运行；不得把 standalone 验收进程的清理规则误用为“可以关闭产品 Dock”。正常 Codex MCP 入口负责持有该运行时，独立脚本只用于没有 MCP stdio owner 时的诊断或恢复。
- 本次完成不包含舵机动作验收。待机随机头动继续由配置隔离，显式舵机动作稳定性另行修复，不阻塞 V1 交付。
- 2026-08-10 收口确认当前输出控制层作用于 Codex 子进程 `9072`：连接期将其输出路由至 `CABLE Input`，两次 `1006` 断连均清除一个临时应用路由；同一连接还发送了 4 条官方 `tts:sentence_start` 字幕。该证据只证明本功能闭环，不改变其他既有产品验收边界。
- 字幕 presenter 已实现 response-level `subtitle_id` 的 append-only 连续显示：后续文本在当前跑马灯尾部接续且不重置；设备只在新增文本时裁去已完全离屏的完整 UTF-8 前缀并保留像素滚动。Dock 回归、固件构建、app-only 写入校验、受控唯一 owner 重启和用户长中文回复确认均已完成。该验收不宣称完整句子队列或“某段首个 Opus 前切换字幕”已实现，也不扩大既有音频或触摸验收范围。
- 受控切换完成后，Electron owner 已成为当前唯一 Dock owner，且机器人重新认证由用户确认。此结论限定为运行时所有权与认证验收；不扩大为新的音频或字幕质量验收。

<!-- state: history -->

## Decision evolution

<!-- dated: 2026-08-09 -->

### 取代自研 Wi-Fi Audio MVP 主线

旧计划在 raw PCM/UDP、Opus、socket、I2S owner、任务栈、DMA buffer 和 VB-CABLE 上形成了大量局部证据，但没有交付稳定产品。本 ADR 不否定这些诊断资产；它改变的是产品所有权边界：官方 XiaoZhi 负责机器人音频，PC Dock 负责本地服务和 Codex 适配。

<!-- dated: 2026-08-10 -->

### 以应用级输出路由取代会话静音

原先为避免 PC 与机器人双播而静音 Codex 渲染会话；但 broker 的 application-loopback 同时采集该会话，静音会让机器人失去回复音频。当前决策改为在认证期将 Codex PID 的应用级输出路由到 VB-Cable `CABLE Input`，让 loopback 继续获得完整音频而 PC 默认扬声器不播放。路由必须在断线、Dock 卸载和 broker stdin EOF 时清除，以避免异常退出遗留偏好。

<!-- dated: 2026-08-10 -->

### 将唯一 Dock runtime 收敛到 Electron

独立 Dock 曾是验收和诊断入口。完成一次受控 cutover 后，Electron 主进程承担 bootstrap、WebSocket、WASAPI broker、机器人会话和字幕桥的单一运行时所有权。保留独立入口用于诊断，但正常产品不能恢复两个 owner 并行的模式。

<!-- dated: 2026-08-10 -->

### 将字幕策略收敛为响应级追加

字幕不再把后续累计转写替换为新的句子帧或依赖句子-音频段关联。选择 response-level `subtitle_id` 加 append-only 帧，使设备能在同一跑马灯尾部继续显示后续文本；新回复和明确结束是唯一重置边界。设备端以真实字体度量和当前像素偏移裁剪已完全离屏的 UTF-8 前缀，避免字符计数裁剪破坏滚动连续性。此策略明确与 Opus、WASAPI、触摸和首次字幕时序解耦。

<!-- dated: 2026-08-10 -->

### 将显示过期与响应结束分离

选择让 `DefaultSpeechBubble` 在长文本完整离屏或短文本展示满 1.6 秒后隐藏气泡，而不是清空 active `subtitle_id`。该 ID 仍可接受延迟 append，但新 pass 只显示新 delta，避免旧文本重播。这样将视觉生命周期限定在显示层，保持 response-level append、像素 trim 与音频路径的既有边界；长句 append 偶发视觉跳动被接受为当前限制，不以未经授权的调速或音频改动换取平滑效果。
