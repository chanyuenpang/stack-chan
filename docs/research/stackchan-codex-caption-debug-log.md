# Stack-chan Codex 字幕调试日志

> 状态：进行中
> 最近更新：2026-08-02
> 目标：让 Windows Dock 通过 `SPEAKER_TEXT` 显示 Codex 助手回复文字，同时不破坏 USB 音频、触摸、状态 UI、FaceView 与官方表情能力。

## 固定边界

- 保留当前 Moddable Host、FaceView、MOD 与 UI effect 架构；字幕只能作为 overlay 叠加。
- 不引入第二套 LVGL 屏幕所有权。官方 C++/LVGL 小智实现只作为交互和性能参考，不能直接与当前 Piu 显示栈并行接管屏幕。
- 官方表情仍由 `context.face`、FaceView 及其 motion/emotion/theme 路径控制；字幕渲染器不得替代这些接口。
- 实机写入只更新 factory app（`0x10000`），不得改写 bootloader、partition table、NVS 或 MOD storage。

## 已确认的数据链路

| 边界 | 证据 | 结论 |
| --- | --- | --- |
| Windows Dock -> `SPEAKER_TEXT` | Dock 能发送字幕帧，Host 能通过长度/UTF-8 校验 | 协议入口正常 |
| Host UTF-8 解码 | 保留 decode + trim、暂不通知 UI 时，音频正常完成 | 解码不是超时根因 |
| worker -> main 字符串消息 | presentation 的 `onPlaybackText` 设为 no-op 时，音频正常完成 | worker/main 传递不是根因 |
| 播放期间普通 UI 状态 | 播放中发送 STATUS 能成功刷新 | 不是所有 Piu UI 更新都会阻塞 |
| 不带字幕的 USB 播放 | 音频正常完成 | USB speaker/credit 基线正常 |

## 已尝试且被排除的方向

以下探针都使用真实 COM7 设备和同一 USB speaker-credit 测试。典型失败为 Dock 报 `speaker credit timeout`；这表示 Host 在字幕 UI 路径中未及时继续返还 speaker credits。

1. 官方 `SpeechBalloon` + 完整中文字体：失败。
2. 把字幕缩小为 ASCII 单字符 `A`：仍失败，排除“仅中文字符查找过慢”。
3. 换成极小 PuHui 诊断字集：失败。
4. 换成已打包的 OpenSans 字体：失败。
5. 用 Timer 延后 UI 通知：失败。
6. 等音频已经开始传输后再发 `SPEAKER_TEXT`：失败。
7. 暂停口型定时更新，避免 FaceView 周期重绘：失败，排除口型重绘为必要条件。
8. 把 `SpeechBalloon` 改成单行 Label：credits 能传完，但等不到 `SPEAKER_DONE`；实验修改已撤回。
9. 自建轻量 Container + Label，保留官方气泡纹理：失败。
10. 同一固件重复测试，排除首次字体预热：仍失败。
11. 自建 Piu Port，直接 `measureString` / `drawString`：失败。
12. 修复 Port 在 `width == 0` 时误启动跑马灯的生命周期问题，再测 `A`：仍稳定失败。

## 当前根因边界

现有证据支持以下边界判断：

- 字幕文本在进入 presentation 之前是健康的。
- 失败发生在播放期间由 Piu 执行字体度量、排版或文字绘制之后。
- 不能只归因于中文字体、文本长度、口型动画或通用 UI 刷新。
- 尚未证明是 Piu 字体渲染器自身缺陷、显示事务与 USB 音频任务的调度冲突，还是特定回调时序造成的阻塞；在没有更细 native trace 前，不把其中任何一项写成最终根因。

## 官方小智实现的可复用结论

官方小智 `speech_bubble.cpp` 使用单个 LVGL Label，并设置 `LV_LABEL_LONG_MODE_SCROLL_CIRCULAR`：短文本居中，长文本由 native LVGL 循环滚动。这说明理想字幕形态是“单行、固定高度、native 滚动”，而不是多行 Piu 文本布局。

可复用的是交互模型和性能原则，不是屏幕驱动本身。当前 Host 若直接再启一套 LVGL，会与 Piu/FaceView 争夺显示所有权并损害官方表情能力。

## 当前验证方向：离屏 native 位图

正在验证的最小架构为：

1. 使用 Moddable 已有 Commodetto/Poco native renderer，把字符串一次性离屏渲染为 RGB565 位图。
2. Piu overlay 不再调用 `measureString`、`Label` 或 `drawString`，只通过项目已有的 `RuntimeBitmapPort` native bridge 裁剪/贴图。
3. 长字幕保留一份预渲染位图，跑马灯每帧只移动 source-x；不重复进行字体布局。
4. FaceView 继续拥有屏幕和官方表情，字幕仍通过 `context.ui.addEffect` 添加和移除。

当前实现位置：

- `C:\sc-host\firmware\host\app\docks\android-usb-audio\caption-bitmap.ts`
- `C:\sc-host\firmware\host\app\docks\android-usb-audio\presentation.ts`
- 复用桥：`C:\sc-host\firmware\host\modules\ui\views\camera-preview\runtime-bitmap-port.c`

此方向目前只完成代码实现与构建尝试，尚未完成实机 speaker-credit、中文字形、跑马灯和表情共存验收，不应标记为已解决。

首次构建在 `caption-bitmap.ts` 报 `TS2304: Cannot find name 'Resource'`；原因是 TypeScript 模块没有像既有 TTS 实现那样显式 `import Resource from 'Resource'`。补齐该局部导入后完整构建通过，生成 `xs_esp32.bin`，大小 `0x5d3580`；这只证明编译/链接成立，尚不能证明实机字幕路径成立。

该镜像写入 factory app 并通过 flash hash 校验后，COM7 设备身份仍为 ESP32-S3 rev 0.2 / MAC `44:1b:f6:e2:78:a8`，但 Dock 连续两次超时等待 `HELLO_ACK`，因此尚未进入 speaker-credit 探针。单一假设是 presentation 顶层急切加载 BufferOut/Poco/font 资源链阻断了 Dock 初始化；将 `stackchan-usb-caption-bitmap` 改成收到第一条字幕时才 `Modules.importNow` 后，实机立即恢复 `HELLO_ACK` 及全部 USB capabilities。该启动回归假设已确认。

延迟加载版本首次编译提示 `Modules` 未导入；已按 Host 既有模块加载代码补充 `import Modules from 'modules'`。这属于编译接口修正，不构成上述启动假设的实机证据。

延迟加载版本的单字符实机探针通过：输入字幕 `A`、20 个 1920-sample / 24 kHz / mono / s16 PCM 帧，Dock 依次收到 `CONNECTED`、`STARTED`、`CAPTION_SENT`、`PLAYBACK_DONE_MS 6047`、`CLOSED`，没有 `speaker credit timeout`。这证明离屏 Poco 渲染 + RuntimeBitmapPort 贴图可在当前条件下与 USB speaker-credit 共存；尚需长文本、中文、口型和真实 Codex 链路验收。

长 ASCII 探针（60 个同规格 PCM 帧）也通过，`PLAYBACK_DONE_MS 8963`；滚动计时与持续位图裁剪期间没有 credit timeout。屏幕是否平滑循环滚动仍需目视确认。下一版本恢复此前为隔离变量而暂停的 `context.face.setMouthOpen` 功率驱动，以验证字幕 overlay 与官方表情/口型共存。

恢复 `Timer.repeat(flushMouth, 125 ms)` 与 `usbAudioMouthStep(power)` 后重新构建、验证同一 COM7 身份并只写 factory app；flash hash 通过。60 帧、振幅 6500 的长字幕探针完成于 `10167 ms`，无 credit timeout，证明字幕位图刷新与官方 `context.face.setMouthOpen` 路径可同时运行。口型幅度和屏幕视觉仍需目视确认，但 Host 未再为字幕禁用官方表情接口。

## 后续验收顺序

1. ASCII 单字符 + USB speaker-credit 探针：必须收到 playback done，不能 timeout。
2. 长 ASCII 字幕：确认循环滚动且不阻塞音频。
3. 恢复口型驱动：确认表情/口型与字幕同时工作。
4. 切回官方中文 PuHui 字体及精简中文字集：确认字号、常用字、无日文字形依赖。
5. Windows Dock + 真实 Codex 回复：确认当前句字幕不延迟到下一句。
6. 回归 USB 麦克风、speaker、触摸、状态图标、官方表情与 MOD 能力。

## 追加记录规则

每次新探针都应追加：构建/固件标识、输入文本、音频帧条件、是否收到 credits 与 `SPEAKER_DONE`、屏幕观察、结论及是否撤回实验代码。不要仅记录“成功/失败”，也不要删除已被排除的方向。

## 字体来源核验

- Host 的 `XiaoZhiPuHuiCommon-Regular.ttf` 与官方 `78/xiaozhi-fonts` 1.6.0 组件内 `ttf/puhui-common.ttf` 的 SHA-256 均为 `e98f6b039ba78327edb4dac255bfcd7cfeb7f00a09652103f235f41abb1a536`。
- 官方 LVGL `font_puhui_20_4.c` 的生成注释标明 20 px；当前字幕资源也固定为 `XiaoZhiPuHuiCommon-20.bf4`。
- `XiaoZhiPuHuiCommon-chars.txt` 有 5,454 个唯一字符，其中 5,258 个为 CJK Unified Ideographs；不含 `U+3040-U+30FF` 日文平假名/片假名区段。
- 诊断期的 OpenSans 和 `XiaoZhiPuHuiDiagnostic-chars.txt` 已退出正式字幕路径；设备与 WASM manifest 统一使用完整但不含日文字形的 common 字符表。

字体切换后的架构测试由“设备 manifest 仍引用 diagnostic 字集”失败转为通过。完整固件构建、同一设备身份验证、factory app 写入及 hash 校验均通过；中文长句 `你好，我是 Stack-chan。现在正在显示 Codex 中文回复字幕，并测试跑马灯效果。` 的 60 帧探针完成于 `9020 ms`，无 credit timeout。另一次约 16 秒中文目视探针也完整结束。相关 TypeScript 测试编译通过，字幕/presentation、协议和 speaker buffer 定向测试 20/20 通过。

## 整链回归状态

- Windows Dock 完整测试：Node 75/75 通过，2 项 Windows 不适用而跳过；Vitest 44/44 通过。
- Host 定向测试：字幕 presentation、协议、speaker buffer 共 20/20 通过。
- 真实 Windows Codex CLI app-server `0.146.0`（`ws://127.0.0.1:48765`）连接成功；CoreS3 协商到 EVENT、STATUS_EXTENDED、SPEAKER_TEXT 等全部能力，并创建新 Codex thread。
- 等待约 90 秒未收到用户前滑 EVENT，桥本身无错误或重连。为释放 COM7，已停止本次 Dock 进程。
- 当前唯一未完成验收：用户在机器人旁前滑，连续说两句不同内容，确认每句字幕与当前语音同步，并目视确认官方字体大小、缺字、跑马灯和口型。

## 2026-08-02 真实 Codex 有语音但无字幕

- 实机现象：Windows Dock 与 Codex Voice 可正常双向对话，日志出现多次 `CoreS3音声再生開始/終了`，但屏幕没有气泡和文字。
- 数据流核对发现 `RealtimeWebRtcSession` 已从 WebRTC `oai-events` 数据通道解析并发出 `event`，AudioBridge 当时只订阅 `audio`，没有订阅 `event`；字幕逻辑只等待 app-server 的 `thread/realtime/transcript/delta|done` 通知。
- OpenAI Realtime server-event 规范规定，音频回复字幕通过 `response.output_audio_transcript.delta` 与 `response.output_audio_transcript.done` 事件提供，其中完成事件字段名为 `transcript`。
- 新增与真实数据通道形状一致的回归测试后，原实现稳定超时，而原有 app-server 伪造字幕测试仍通过；这将断点定位到 Dock 的 WebRTC 事件消费层，而不是 Host 字体、气泡或 `SPEAKER_TEXT` 渲染层。
- 最小修复：AudioBridge 订阅会话 `event`，消费 WebRTC 音频转录 delta/done；app-server 字幕通知继续作为回退，并以 WebRTC 为优先来源避免双来源重复拼接。针对性测试由 1/8 失败转为 8/8 通过。
- 尚需新 Dock 构建后的同一实机目视回归，确认数据通道字幕最终穿过 `SPEAKER_TEXT` 并显示。

## 官方 SpeechBalloon 收口

- 完成性审计发现，首个 native 位图版本复制了官方 `bubble.png` 纹理，但实际创建的是自定义 `Container`；这不足以证明“调用官方 SpeechBalloon”。
- 官方 `SpeechBalloon` 新增可选 `body` 内容槽：默认文字路径保持原样；字幕路径可挂载 `RuntimeBitmapPort`，由官方组件继续拥有气泡纹理、尾部方向、布局和主题背景，正文仍使用已验证不会阻塞 USB credits 的离屏 Poco 位图与裁剪滚动。
- `android-usb-audio/presentation.ts` 已改为 `new SpeechBalloon({ body: captionPort, ... })`，不再自行复制气泡 Skin。
- TypeScript 架构/单元编译通过；Host Node 测试 350/355 通过，5 项失败均为 Windows 路径分隔符或子进程 PATH 的既有跨平台问题；完整 CoreS3 Host 构建成功，生成 `xs_esp32.bin`（`0x5d35f0`）。
- 尚未将这一版 Host 写入设备；应先完成当前 Dock-only WebRTC 字幕修复的实机观察，再决定是否以已验证的 factory-app 恢复路径更新 Host。

## 2026-08-02 首次修复版 Dock 实机结果

- 用户确认双向语音对话正常，但屏幕仍无气泡。
- 同一次对话日志显示两次 `Codex字幕就绪: source=app-server`，分别为 7 字和 13 字，且都位于对应的 `CoreS3音声再生開始/終了` 之间；因此 Codex 字幕事件缺失与到达过晚均被排除。
- `UsbStackChanDevice.setPlaybackText` 原先在能力不支持、speaker session 未活动或文本为空时都静默返回，调用方无法区分真正发送与丢弃。
- 已把返回值收紧为 `sent | unsupported | inactive | empty`，AudioBridge 记录每次结果，并新增“播放前为 inactive、播放中为 sent”的 USB 回归断言。Dock 完整测试仍为 Node 75/75（2 项 Windows 跳过）、Vitest 45/45。
- 已启动带显式发送结果的 Dock；下一次短对话将决定断点是 Dock speaker-session 时序还是 Host 的 `SPEAKER_TEXT`/presentation 路径。

后续实机对话确认：字幕在 speaker 启动前的早期增量为 `inactive`，但播放期间连续大量更新均为 `sent`，最终 23 字和 19 字文本也在 `CoreS3音声再生終了` 前返回 `sent`；屏幕仍无气泡。因此 Dock speaker-session 时序不是“完全无字幕”的根因，断点收窄到当前设备 Host 的 `SPEAKER_TEXT` 接收后 presentation 显示路径。

已更新到真正调用官方 `SpeechBalloon({ body: captionPort })` 的 Host 构建：写入前确认 COM7 为 ESP32-S3 rev 0.2 / MAC `44:1b:f6:e2:78:a8`，保留两份哈希一致的 16 MB 全闪存备份；只写 factory app `0x10000`，镜像 6,108,656 字节、SHA-256 `1fcc76e9b2db7f0f92ac498a27febadbccf554d75786246f796595490b246fe2`。写入内建校验和独立 `verify-flash` 均通过，设备重启后重新协商到 EVENT、STATUS_EXTENDED 与 SPEAKER_TEXT。尚待真实对话目视确认。

新 Host 的首个长回复仍无气泡且用户感知语音卡顿。Dock 日志显示字幕从 2 字增长到 167 字，几乎每个 delta 都产生一次 `result=sent`，随后触发 `Codex output audio exceeded the five-second speaker queue`。因此该次卡顿由字幕逐字符洪泛导致 Host 重绘反压，而不是 Wi-Fi 或 Codex 网络本身。

Dock 已新增 250 ms 最新值合并：播放开始仍强制发送当前文本，持续 delta 最多按固定间隔发送最新快照，淘汰中间过时文本。40 个同步 delta 的回归测试证明最多发送 2 次且最终仍为完整 40 字；完整 Dock 回归为 Node 75/75（2 项 Windows 跳过）、Vitest 46/46。已重启 Dock，下一步用严格短回复先隔离验证气泡可见性，再测试长句滚动与无卡顿。

## 设备重启后的 Dock 生命周期

- 用户重启机器人后，前后滑均无法进入麦克风状态。
- 现场检查显示 COM7 已重新枚举、Codex app-server 仍监听 `127.0.0.1:48765`，但原 Dock Node 进程已退出；因此直接原因是设备断连终止了手动启动的 Dock，而不是触摸事件或麦克风状态机失效。
- 手动重启 Dock 后再次协商到 `event=true status=true statusExtended=true` 并创建 Codex thread。当前整链验收仍使用前台/手动 Dock；自动守护与设备重连属于后续 Windows 运行时可靠性项，不能用它替代本次字幕链路验收。
