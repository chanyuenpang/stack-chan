# 半双工候选麦克风实测证据（2026-08-07）

## 本目录在既有证据链中的位置

本目录不是新的独立基线，而是以下历史证据的后继实测：

- 用户唯一确认“两路声音很清晰”的麦克风基准是 [`../rx4-golden-20260806/run2/slot0_mic1-24khz.wav`](../rx4-golden-20260806/run2/slot0_mic1-24khz.wav) 与同轮 MIC2；该轮为 RX-only、four-slot TDM 原始采集。结论不能外推到 standard-stereo 产品麦克风。
- [`../matched-std-duplex-20260806/candidate-manifest.md`](../matched-std-duplex-20260806/candidate-manifest.md) 将产品路径改为 matched standard stereo，验证过扬声器音高，但其产品麦克风从未通过用户清晰度验收。
- [`../jitter-buffered-20260806/candidate-manifest.md`](../jitter-buffered-20260806/candidate-manifest.md) 记录了后续扬声器缓冲、虚拟设备与设备稳定性边界；其中的麦克风 transport 在线不等于麦克风音质通过。
- [`../wifi-audio-single-sender-20260807/candidate-manifest.md`](../wifi-audio-single-sender-20260807/candidate-manifest.md) 记录了将麦克风上行迁移到 session-bound UDP 后的候选历史及传输验收。
- [`../codex-voice-input-20260807/README.md`](../codex-voice-input-20260807/README.md) 记录上一份 `录音.m4a` 中 `54.77%` 数字静音的失败。本文的新样本用于区分“数字零已消失”和“麦克风本身已清晰”这两个不同结论。
- 完整时间线见 [`../../stackchan-wifi-audio-boot-diagnostics.md`](../../stackchan-wifi-audio-boot-diagnostics.md)。

## 新样本及可复核资产

- 用户原始文件：`D:/Users/chany/Documents/录音/录音 (2).m4a`，未复制到仓库；SHA-256 `B4F79AEF9FEC742A76975C3BDDA5692E6D5D81417D42D46B03119819072392E1`。
- 容器：AAC、`48 kHz`、stereo、约 `6.3786 s`；共 `299` 个 packet，PTS 单调连续。容器时间线没有可见断裂。
- 解码 PCM：[`recording-2-48k-stereo.wav`](recording-2-48k-stereo.wav)。
- 新录音分析：[`recording-2-analysis/waveform-analysis.json`](recording-2-analysis/waveform-analysis.json) 与同目录双声道诊断图。
- 同轮 Listening 环境音连续性控制：[`listening-ambient-vb-cable.wav`](listening-ambient-vb-cable.wav) 及 [`listening-ambient-analysis/waveform-analysis.json`](listening-ambient-analysis/waveform-analysis.json)。
- golden MIC1 的同一分析器结果：[`golden-mic1-analysis/waveform-analysis.json`](golden-mic1-analysis/waveform-analysis.json)。

## 决定性对比

| 指标 | 新半双工产品录音 | 已确认清晰的 RX-only TDM MIC1 |
| --- | ---: | ---: |
| 10 ms 数字静音块比例 | `0.314%` | 约 `0.15%`（本目录同一分析器） |
| 内部数字零段 | `1` 段、合计/最长 `30 ms` | `3` 段、合计 `80 ms`、最长 `30 ms` |
| RMS / peak | `648 / 11284` | `1403 / 32768` |
| `300--3400 Hz` 功率占比 | `30.47%` | `86.98%` |
| `0--80 Hz` 功率占比 | `40.22%` | `0.88%` |
| 50/60 Hz 及谐波功率占比 | `6.69%` | `0.44%` |

新样本把上一份录音中 `54.77%` 的数字零降到 `0.314%`，因此半双工与新传输路径已经消除了那一项连续性故障。然而，人声频带占比从 golden 的 `86.98%` 降至 `30.47%`，极低频占比从 `0.88%` 升至 `40.22%`，工频及谐波占比也从 `0.44%` 升至 `6.69%`。这与用户报告的“机器人质感、并非之前清晰版本”一致，客观上仍不可用；不能用“数字零已修复”替代“麦克风质量已通过”。不同内容和距离使 RMS/peak 只能作辅助指标，不能单独解释音质差异。

## 网络与 Codex 边界

录音同期 Dock 已接收超过 `27,500` 个 UDP 麦克风帧，`gaps=0 / drops=0 / reconnect=0`。因此这次低频污染和人声频带缺失不能归因于 Wi-Fi 丢帧、Dock 丢包或连接重建。Codex Voice 同轮仍无法听到/识别用户说话，这与不可用波形一致，但 Codex 行为本身不作为根因定位证据。

## 当前根因方向与修复边界

历史产品 RX 曾从清晰 RX-only 路径改成 matched standard stereo，并走过 raw I2S read；这条产品麦克风路线没有通过清晰度验收。仓库内小智官方 CoreS3 实现 [`../../../../firmware/xiaozhi-esp32/main/boards/m5stack-core-s3/cores3_audio_codec.cc`](../../../../firmware/xiaozhi-esp32/main/boards/m5stack-core-s3/cores3_audio_codec.cc) 的真实组合是：扬声器 TX 为 standard，麦克风选择 `MIC1 | MIC2 | MIC3`，由 ES7210 进入 four-slot TDM RX，并通过 `esp_codec_dev_read` 按 channel mapping 取得输入。唯一通过试听的 RX-only golden 同样使用 four-slot TDM。

主线程当前只恢复这条官方麦克风 RX 路径，保留已经分别验证的扬声器 TX、UDP、Dock 与半双工状态机不变，以减少实机测试变量。工作区源码可见相应方向于 [`../../../../firmware/main/hal/board/cores3_audio_codec.cc`](../../../../firmware/main/hal/board/cores3_audio_codec.cc)。该恢复候选先完成离线门禁：固件契约 `45/45` 通过，ESP-IDF 完整构建、链接和分区检查通过；app 大小 `3,827,296 bytes`，SHA-256 `4AD5DFCDDF4146CB2DF9D646121AC2D3DBEF88DE58E76B5CB11B70FFFDF98576`。这些结果只证明候选可构建且静态合同闭合；离线门禁完成时尚未刷写，后续写入与启动结果见下一节。下一次可用性结论仍必须同时满足客观频谱接近 golden、用户试听清晰且 Codex 能识别。

### 受保护写入、初始启动误判与运行确认

上述精确候选随后于 `2026-08-07` 受保护地执行 app-only 写入。写入前识别目标为 ESP32-S3 revision `v0.2`、factory MAC `44:1b:f6:e2:78:a8`；实时分区确认 `ota_0@0x20000`、大小 `5056K`。只写入 app 到 `ota_0`，写入工具的 image hash 校验通过，随后对同一目标范围执行的独立 `verify_flash` 也通过。因此候选身份、目标芯片和 flash 内容一致性已有正证据。

工具 hard reset 后设备最初没有回连当时的 Dock。用户随后短按 `RST` 无反应；按左侧电源键时观察到一次短暂闪屏，PC 同期只读检查中 `COM7` 消失，Dock 也没有设备连接。当时一度把该窗口解释为应用未启动，并保留了早期 app 崩溃、板级电源状态或其他启动故障三种假设。

后续现场证据纠正了这一结论：设备实际显示黄灯且全屏音量调节正常，`192.168.0.8` Ping 成功；启动 Dock 后，用户确认状态灯变为绿灯，设备也完成认证连接。黄色表示 waiting 状态，不是黑屏、崩溃或应用启动失败。因此“app 未启动”结论作废；写入候选已经进入应用并运行到网络与 UI 状态机。

本次官方 TDM RX 候选随后进行了 transport gate，约 `65 s` 内 Dock 收到 `3,001` 个 UDP 麦克风帧，但累计 `sequence gaps=4,430`；`duplicates=0 / out_of_order=0 / invalid=0`。同一窗口中 TCP `status` request `2` 与 `talking` request `3` 均在 `1,500 ms` 超时，VB-CABLE `underflow=0`。该结果没有达到进入人工音质测试的前置门槛，因此没有新增实体录音或 Codex 识别结论。

**该 transport gate 排除了已证实的启动故障，并把当时的边界收敛到固件端音频读取、排队或任务时序；后续代码闭环见下一节。官方 TDM RX 音质仍未验证，不得宣称麦克风已修复。**

### Raw4 单变量修复的离线候选

后续 subplan 已从源码与数据长度闭环确认产品失败根因：Wi-Fi 产品让 ES7210 输出 four-slot TDM，却仍以 logical `2ch`、每 10 ms `960 bytes` 打开和读取；当前 codec-dev 数据层既不进行槽位重排，也不向上保留实际 `bytes_read`，使产品读取边界与物理四槽帧不一致。这个结论解释了为何同一硬件的 RX-only four-slot TDM 清晰，而 standard/logical-2ch 产品录音低频污染且不可辨。

修复严格限定在 Wi-Fi 产品输入：以 raw4 打开 `channel=4 / channel_mask=0xF`，每 10 ms 直接严格读取 `1,920 bytes`，长度不匹配即拒绝该帧；物理映射固定为 MIC1=`slot0`、MIC2=`slot2`。扬声器 TX、UDP transport、任务调度、Dock 与半双工状态机均保持不变，不把其他历史变量混入这次硬件验收。

离线候选通过固件合同 `64/64`，并完成 ESP-IDF `5.5.5` 完整构建、链接和分区检查。候选 `stack-chan.bin` 大小 `3,827,488 bytes`（`0x3A6720`），SHA-256 `853EAF69CFAF86988E32E3D68B7F43651A1F421D021C7FDD4D2FD9C7F7AAE86A`。目标分区仍为 `ota_0@0x20000`、大小 `5056K`，app 末地址 `0x3C6720`，约 `26%` 空闲；受保护刷写脚本的 pin 与该长度/哈希匹配。

**离线候选形成时尚未刷写或完成 UDP transport gate，也没有实体录音、频谱或 Codex 识别验证。`64/64` 和完整构建只证明离线合同闭合；后续写入与 transport 结果见下一节。**

### Raw4 候选写入与 transport gate 失败

候选随后 app-only 写入 `ota_0@0x20000`；写入工具 image hash 校验与对同一范围执行的独立 `verify_flash` 均通过。机器人实体 `RST` 后上线并完成 Dock 认证，initial `get_status` 成功。新 Dock 原始日志为：

- `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260807-202638.stdout.log`
- `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260807-202638.stderr.log`

在主机 receiver 到达 `5,001` 帧时，计数为 `gaps=634 / duplicate=0 / out_of_order=13 / invalid=0 / reconnect=0`。同一候选的设备 status 为 `captured=5,634 / sent=5,013 / queue_drops=621 / udp_send_failures=621 / max_send_us=952`；VB-CABLE `underflows=0`。

该 transport gate 明确失败，因此没有进入人工试听。`634` 个 receiver gap 中，`621` 个已有设备端 `sendto` drop 的直接解释，余下 `13` 与 receiver 记录的 out-of-order 对齐；这组闭合计数不能归因于麦克风短读或主机包解析。raw4 修复已解决的是 four-slot/logical-2ch 的 frame geometry 错配，但不等于端到端麦克风已可用。

当前新增剩余根因是：I2S capture task 在实时采集路径内直接以 `MSG_DONTWAIT` 调用 UDP 发送，发送失败时在设备侧立即丢弃该帧。下一候选需要把 I2S 捕获与网络发送解耦，让捕获任务只写入有界队列，由独立网络任务消费；在该 transport gate 通过前仍不得做音质通过结论。

### Capture/network 解耦离线候选

后继候选在 `firmware/main/hal/wifi_audio_dock_mvp.cpp` 增加容量为 `16` 帧的 `MicrophoneFrame` 有界队列。core1 `audio_task` 只执行 I2S 采集、物理槽位选择和 enqueue；core0 `wifi_tx_task` 每轮优先清空 control 工作，再执行至多一个麦克风 UDP send。UDP socket 设置 `SO_SNDTIMEO=20 ms`，`sendto` 改用 `flags=0`，不再由采集任务以 `MSG_DONTWAIT` 直接发送。

遥测语义同时收紧：`queue_drops` 只统计队列已满，`udp_send_failures` 只统计真实发送失败，`queued_frames` 报告真实队列深度，并新增 `flushed_frames` 与 `last_errno`。`set_ready(false)`、进入 Speaking、或关闭逻辑麦克风时都会清空队列，避免旧 Listening 音频跨状态发送。

固件完整合同 `64/64` 通过；ESP-IDF `5.5.5` full build/link/partition 检查及随后第二次增量构建均通过。候选为 `firmware/build-wifi-audio-short/stack-chan.bin`，大小 `3,828,144 bytes`（`0x3A69B0`），SHA-256 `04C629FBD2EAB9E48DA49E44DA93C09082CF8D8CD89CF21004481BF3B54AB23D`；image checksum 与 validation hash 有效。目标 `ota_0@0x20000`、大小 `0x4F0000`，app 末地址 `0x3C69B0`，剩余 `0x149650`、约 `26%`。受保护 flash script 已 pin 新长度和哈希，语法检查通过。

离线候选形成时，`Win32_SerialPort` 中没有 `COM7`，因此当时尚未执行设备 preflight、刷写、transport gate 或音质验证。后续受保护写入结果见下一节；**离线结果本身不能记录为实机修复。**

### Capture/network 解耦候选受保护写入

后续 `COM7` 以 `VID_303A / PID_1001` 出现。受保护 preflight 识别目标为 ESP32-S3 revision `v0.2`、factory MAC `44:1b:f6:e2:78:a8`，并回读实时分区为 `ota_0@0x20000`、大小 `0x4F0000`。只把精确候选 `3,828,144 bytes`（`0x3A69B0`）、SHA-256 `04C629FBD2EAB9E48DA49E44DA93C09082CF8D8CD89CF21004481BF3B54AB23D` 写入 `0x20000`；实际 sector erase 范围为 `0x20000..0x3C6FFF`，完整位于 `ota_0`。

写入工具报告内建 `Hash verified`，随后对同一地址和长度执行的独立 `verify_flash` 报告 `digest matched`。本轮没有写入 bootloader、partition table、NVS 或 assets，因此只证明候选 app 与 flash 内容一致。

工具 hard reset 后的首个检查窗口没有 Dock listener，且 `192.168.0.8` 连续 `4` 次 Ping 超时；该时点尚无应用启动、transport 或音质证据。随后用户实体短按 `RST` 并完成独立 transport gate，结果见下一节。**写入与校验通过本身不得记为 capture/network 解耦已在实机修复。**

### Capture/network 解耦候选实体 transport gate（失败）

实体 `RST` 后，`192.168.0.8` Ping `4/4` 成功，延迟依次为 `19 / 26 / 40 / 44 ms`，证明应用在线。确认 TCP `8765` 与 UDP `8766` 均空闲后，通过 `start-wifi-audio-dock.ps1` 启动唯一 standalone Dock PID `14324`。原始日志：

- `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260807-205214.stdout.log`
- `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260807-205214.stderr.log`

设备以 `stackchan-441BF6E278A8` 完成认证。初始 status 为 `duplex_mode=half / phase=listening`，麦克风 enabled 且 active，扬声器 inactive；麦克风计数 `captured=12 / sent=12 / queue_drops=0 / flushed_frames=0 / udp_send_failures=0 / max_send_us=1687 / last_errno=0`，worker 为 `tx=0 / mic=1 / speaker=1`，heap 与各任务 stack 处于正常范围。

主机 receiver 的 sequence gap 按约 500 帧检查点持续增长：

| Receiver frames | Gaps |
| ---: | ---: |
| `1` | `0` |
| `501` | `46` |
| `1,001` | `77` |
| `1,501` | `99` |
| `2,001` | `122` |
| `2,501` | `190` |
| `3,001` | `274` |
| `3,501` | `282` |
| `4,001` | `339` |
| `4,501` | `393` |
| `5,001` | `598` |

自动 Idle gate 最终读数为：主机 `receiver frames=5,006 / udp=5,006 / websocket=0 / bytes=2,402,880 / gaps=600 / duplicate=0 / out_of_order=0 / invalid=0 / rejected=0 / reconnect=0`；设备 `captured=5,606 / sent=5,006 / queue_drops=0 / flushed_frames=0 / queued_frames=0 / udp_send_failures=600 / max_send_us=1698 / last_errno=0`；VB-CABLE `underflows=0`。

计数精确闭合：`captured - sent = 600 = udp_send_failures = receiver gaps`。容量 `16` 的队列从未积压或满，失败发生在独立 network task 的 blocking `sendto`；`max_send_us` 只有约 `1.7 ms`，说明这 `600` 次并非等待 `20 ms` 超时后才失败，而是立即返回失败。本轮没有扬声器播放、人工试听、录音或 Codex Voice 验收，transport gate 明确失败。

测试完成后精确停止 PID `14324`，复查 TCP `8765` 与 UDP `8766` 均恢复 free。当前 `last_errno=0` 不是“失败时 errno 为 0”的证据：实现会在任意后续成功发送时把它清零，因而这是诊断盲点。下一步应保留独立的 `last_failure_errno`，并研究 ESP-IDF/lwIP `sendto` 的实际错误路径；现有证据不支持继续盲目增加队列容量。

### 官方上行与 ESP-IDF/lwIP 只读调研

仓内官方 Xiaozhi 生产音频上行不是每 10 ms 发送一包 raw PCM。其流水线为：`24 kHz` 输入先重采样到 `16 kHz`，每 `10 ms` 喂入 processor，累计 `60 ms` PCM 后用 Opus 编码并启用 DTX/VBR；编码侧使用 `2` 帧队列，压缩发送侧使用 `40` 帧队列，最终经 WebSocket 或 MQTT/UDP 传输。当前 Wi-Fi Dock 则每 `10 ms` 发送 `480 bytes` raw mono PCM，即约 `100 packets/s`；官方 `60 ms` 粒度约 `16.7 packets/s`。因此官方路线同时降低包率、隔离捕获与发送，并用压缩队列吸收网络抖动，不能简化为“官方也使用 UDP”。

ESP-IDF/lwIP 源码证据进一步解释本轮立即失败：

- UDP `sendto` 路径忽略调用方传入的 `flags`，所以把 `MSG_DONTWAIT` 改成 `0` 不会改变底层 UDP 发送语义。
- `SO_SNDTIMEO` 只在 TCP write path 中参与等待；它不能让 UDP 在 TX buffer 不足时等待 `20 ms`。
- `wlanif` 将 Wi-Fi 返回的 `ESP_ERR_NO_MEM` 和 `ESP_ERR_ESP_NETIF_TX_FAILED` 映射为 lwIP `ERR_MEM / ERR_BUF`，UDP 上层不自动重试。
- ESP-IDF Kconfig 明确警告：若 UDP 上层发包过快，可能耗尽 Wi-Fi TX buffers。当前固件使用 dynamic TX buffers=`32`，与 `100 packets/s` 小包路径的失败机制一致，但尚未取得精确失败 errno。
- 现有 `last_errno` 会被任意后续成功发送清零，因此最终 status 的 `0` 不能区分 `ERR_MEM`、`ERR_BUF` 或其他错误；在增加独立 `last_failure_errno` 前，不把具体 errno 写成已确认。

### 官方与硬件配置边界

M5Stack 官方资料把 CoreS3 描述为双麦克风硬件；M5Unified 只使能 MIC1/MIC2。仓内 Xiaozhi CoreS3 实现却选择 `MIC1 | MIC2 | MIC3`，其中 MIC3 用于参考/AEC 并触发 ES7210 four-slot TDM。三者描述的抽象层和用途不同，不能在没有审核物理槽位、frame geometry 与产品模式的情况下整段照抄。第一版继续使用已由 RX-only golden 验证的 raw4 MIC1=`slot0`，不把未验证的 MIC3/AEC 路线引入产品验收。

### 下一版首选路线

证据最强的首选路线是完整采用官方结构，同时保留项目已验证的硬件入口：raw4 MIC1=`slot0` -> 重采样到 `16 kHz` -> 每 `60 ms` 编码 Opus -> 官方式有界队列与单发送器 -> WebSocket。半双工状态机和已验证扬声器链路保持不变。PC Dock 侧优先使用 Node 可用的 WASM Opus decoder（例如 `opus-decoder`）解码，再把 PCM 送入现有 VB-CABLE；具体包版本、初始化、帧格式与错误 API 仍需离线验证，不提前写成可用依赖。

`60 ms` raw PCM + WebSocket 只保留为 fallback。它能把调用频率从约 `100` 降至 `16.7 packets/s`，但不降低 PCM 带宽；本项目历史上 PCM/TCP 已有明显阻塞证据，因此其可靠性证据弱于官方 Opus 路线，不能作为当前首选。下一步先离线验证 Opus 编解码互通、阻塞/背压、顺序、队列上限、断线清理和控制优先级；通过后才安排一次合并实机 gate。

**这仍是研究决策：尚未实现、尚未构建、尚未刷写或实机测试。**

### Task 9：Opus WebSocket 上行离线实现/测试记录

Task 9 的目标链路固定为：已验证 raw4 MIC1=`slot0` -> 重采样到 `16 kHz` -> 每 `60 ms` 编码 Opus -> 官方式有界队列与 WebSocket 单发送器 -> PC Dock 解码 -> 现有 VB-CABLE。半双工状态机、扬声器下行和已验证硬件槽位保持不变。

本轮边界固定为仅做离线实现与验证：**不刷写设备，不启动实机，不执行 transport、试听、录音或 Codex Voice 验收。** 后续每轮合同、编解码互通、阻塞/背压、队列、断线清理、构建和依赖验证结果均追加在本节；在取得对应证据前，不提前记录为实现完成或测试通过。

#### 红灯合同基线

新增 Dock 协议/真实 Opus 解码合同和固件静态合同后，在产品实现尚未加入时按预期失败。Node 合同报错为 `ERR_MODULE_NOT_FOUND`，缺少 `wifi-audio-opus-decoder.mjs`。固件合同共 `46` 项，其中 `41` 项通过、`5` 项失败；失败集中在现状仍使用 UDP/PCM hello，尚无 `60 ms` Opus 流水线、独立编码任务和 WebSocket 音频发送。

这是 Task 9 的预期红灯，证明新合同覆盖目标能力缺口，不是既有功能回归结论。本轮未执行固件构建、刷写或实机启动。

#### 第一轮绿灯：定向离线互通

完成首轮实现后，固件静态合同 `46/46`，Dock `npm check` 通过，targeted receiver/真实 Opus 测试 `8/8`。由 Espressif 编码器产生的真实 `60 ms` Opus 测试向量，经 `opus-decoder 0.7.11` 解码为 `24 kHz` mono、`2,880 bytes` PCM，且 `peak > 0`；这证明目标编解码组合不是静音占位或伪造 packet 测试。

实现保持 raw4 采集、MIC1/MIC2 物理映射、扬声器和半双工状态机不变。新增 `24 kHz -> 16 kHz` 持久重采样器，`960` samples PCM 有界队列容量为 `2`，由独立 Opus 任务编码；encoded queue 容量为 `8`，最终只由唯一 socket 调用 `Send`。Dock 在同一已认证 WebSocket 上接收 Opus 并解码，再交给现有 PCM/VB-CABLE 路径。

该结果仅是第一轮定向离线绿灯：尚未运行全量 Dock 测试、ESP-IDF 完整构建或阻塞/背压压力测试，也未刷写或启动实机。

#### 全量 Dock 门禁与 fixture 协议漂移

首次运行全量 `npm test` 超时。改用 `node --test --test-timeout=10000 --test-reporter=spec` 后，定位到唯一未随协议更新的 fixture：`wifi-audio-speaker-pipe.test` 仍发送旧 PCM hello，导致认证失败并持续等待 ready，最终表现为超时。

只把该测试 fixture 的 hello 更新为 Opus 协议后，全量 Dock 测试 `40/40` 通过，`fail=0 / cancelled=0`，耗时约 `1.13 s`。这是测试 fixture 的协议漂移，不是 speaker pipe 或扬声器产品实现故障；本轮没有借此修改 speaker 实现。

Task 9 至此通过全量 Dock 门禁，但仍未进行 ESP-IDF 构建、阻塞/背压压力测试、刷写或实机验证。

#### Task 9 完整离线门禁与构建候选

协议审计先把 Dock 单帧上限从 `1,275` 调整为 `1,500 bytes`，与固件协议上限一致。依赖审计最初发现 `ws 8.18.3` 为 high、`hono 4.12.33` 为 moderate；只定向更新到 `ws 8.21.2`、`hono 4.13.1` 后，`npm audit` 为 `0`。Opus 路径锁定 `opus-decoder 0.7.11` 与 `@wasm-audio-decoders/common 9.0.7`。

更新后 Dock 全量测试 `41/41`、固件合同 `46/46`，`npm check` 与 diff check 均通过。新增 `1,000` 帧 Opus WebSocket 压力门禁在控制请求持续闭环期间取得 `frames=1000 / gaps=0 / duplicate=0 / out_of_order=0 / invalid=0 / decodeErrors=0 / PCM bytes=2,880,000`，离线测试耗时约 `48 ms`。该结果覆盖同一认证 WebSocket 上音频与控制并存时的顺序、解码和控制响应，不外推到真实 Wi-Fi 时延。

ESP-IDF `5.5.5` 完整构建、链接、镜像和分区检查通过。候选 `stack-chan.bin` 大小 `3,990,064 bytes`（`0x3CE230`），SHA-256 `210F0A75B83AAC4045C6872B91710EC86161D5363596A86318086FD0E0BC5649`；ESP32-S3 image checksum 与 validation hash 有效。`ota_0` app 分区大小 `0x4F0000`，剩余 `0x121DD0`、约 `22.93%`；本轮 `sdkconfig.h` 哈希与旧候选相同，说明构建配置未漂移。

**Task 9 当前只完成离线门禁与候选构建：尚未刷写，尚未进行实机 transport、录音音质或 Codex Voice 验收，不得写成产品已通过。**

#### Task 9 只读审阅、刷写前修复与最终离线候选

刷写前只读审阅发现四项问题：

- P1：flush 不能清除持久重采样器/编码器中正在累计的 `60 ms` 数据，旧 Listening PCM 可能跨 generation 进入后续 Opus 包。
- P1：Dock 并发认证会共享并同时 reset 同一 decoder，旧连接可能干扰新 active owner。
- P2：编码期间发生 generation 切换时，stale 包虽然可以不发送，但缺少准确的 flushed 计数，形成观测盲点。
- P2：resampler 首次初始化失败后不重试，会让同一进程永久失去麦克风解码链路。

四项均在刷写前处理。固件 `OutboundFrame` 现在携带 mic generation，TX 发送前重新检查 `ready / microphone enabled / not speaking / generation`；编码完成后发现 stale 的帧计入 `flushed_frames`。resampler 初始化失败会执行 `Abort`，让 bootstrap 在下一连接重新创建。Dock 增加 `authenticationBarrier`，把 decoder reset 与 active owner 切换串行化，避免并发认证竞争。

修复后回归为 Dock `42/42`、固件合同 `47/47`，`npm check`、`npm audit=0`、diff check 与 PowerShell parse 均通过。第一次固件构建在新 shell 中因 `ccache` 不在 `PATH`，于编译器启动前失败；这是构建环境问题，不是源码编译错误。补入绝对 `PATH` 后，完整编译、链接和分区检查通过。

最终离线 app 为 `3,990,384 bytes`（`0x3CE370`），SHA-256 `9DF00A654E4E0FCAE39F75E2D4EC662F9302394844EA002CF49A67EF3FEF86C3`；app 分区剩余 `0x121C90`（`1,186,960 bytes`，约 `22.93%`），ESP32-S3 image checksum 与 validation hash 有效。

**在该审阅结项节点，候选尚未刷写或实机验证；审阅问题关闭、回归和构建通过不能替代实体 transport、音质及 Codex Voice 验收。后续写入见 Task 10。**

#### 并发认证 newest-wins 复核

最终复核发现一个 Dock P2：`authenticationBarrier` 在认证 commit 前释放，串行 decoder reset 之后仍可能由较旧 hello 抢先 claim owner。修复增加 `authenticationGeneration` newest-wins：只有最新 hello 在串行 reset 完成后可以 claim、ready、attach decoder 并 emit authenticated；stale socket 会清除其 `5 s` handshake timer 后关闭。

新增测试断言并发 hello 只产生 `1` 次 authenticated、`authenticatedConnections=1`，且最终 owner 的 Opus 音频仍可解码。第一次全量虽为 `42/42`，但 stale timer 未清导致进程总时长约 `5.7 s`；补齐 timer 清理后全量仍为 `42/42`、`fail=0 / cancelled=0`，总时长约 `1.125 s`。

这是 Dock-only 修复，固件镜像未变化，仍沿用 SHA-256 `9DF00A654E4E0FCAE39F75E2D4EC662F9302394844EA002CF49A67EF3FEF86C3`；Task 9 离线结项时尚未刷写，后续写入见 Task 10。

### Task 10：Opus 候选受保护写入

目标 `COM7` 为 `VID_303A / PID_1001` USB Serial/JTAG，factory MAC `44:1b:f6:e2:78:a8`。受保护 preflight 回读 ESP32-S3 revision `v0.2` 和实时分区：`ota_0@0x20000 size 5056K`、`ota_1@0x510000`、`assets@0xA00000`。待写候选大小 `3,990,384 bytes`（`0x3CE370`）、SHA-256 `9DF00A654E4E0FCAE39F75E2D4EC662F9302394844EA002CF49A67EF3FEF86C3`，与 Task 9 最终 pin 匹配。

本轮唯一写操作是 app-only 写入 `ota_0@0x20000`；工具实际擦除 `0x20000..0x3EEFFF`，完整位于 `ota_0`。写入内建校验报告 `Hash verified`，随后对同一地址和长度执行的独立 `verify_flash` 报告 `digest matched`。未写 bootloader、partition table、NVS 或 assets。

**截至本条记录，尚未实体短按 `RST` 启动新应用，也未执行 Dock transport、录音、音质试听或 Codex Voice 验收；安全写入与校验通过不能记为产品通过。**

#### Task 10 启动重启循环证据

用户随后报告机器人不停重启。对 `COM7` 做 `20 s` 存在性采样时，端口基本持续存在，但中间有一次短暂消失。此前把 Ping 结果记作设备在线需要纠正：实际输出来自本机 `192.168.0.11` 的 `Destination host unreachable`，不是 `192.168.0.8` 应答，不能作为机器人上线证据。

第一次串口尝试使用默认 Python，但环境缺少 `pyserial`，在打开设备前即失败，因此没有生成设备日志，也不能作为启动诊断。随后改用 ESP-IDF Python，以只读方式设置 `DTR=false / RTS=false` 采集 `12 s`，有效日志为 `.claw/runtime/wifi-opus-reboot-com7-20260807-224040.log`。

有效日志完整重复 `4` 次固定签名：`rst:0xc (RTC_SW_CPU_RST)`、`Saved PC:0x4038ac61`，每轮末行均停在 `PSRAM: Reserving pool of 64K of internal memory for DMA/internal allocations`，没有出现 `BOOT-DIAG` 或 `app_main`。`addr2line` 将 `0x4038ac61` 映射到 `esp_restart_noos`（`system_internal.c:164`）。该签名与本诊断历史 Stage 0/2/4 相同。

串口当时只能确认最后可见日志是 `main_task` 的 PSRAM DMA reserve，且串口没有显示 `BOOT-DIAG/app_main`；它不能证明系统未进入 `app_main`。后续 JTAG 真实调用栈已经证明 `app_main` 实际执行，见下方决定性定位。音频 transport、录音、音质和 Codex 验收在此阶段暂停。

#### Task 10 只读静态定位

对新旧固件做只读静态对照后，两份镜像均为合法 ESP32-S3 image，分区内尺寸未越界。新旧 `init_fn` 与 `.ctors` 的成员和执行顺序一致；`main_task` 以及 `64 KiB` PSRAM DMA reserve 路径的系统机器码也一致。

串口最后一行的位置需进一步纠正：它来自 `main_task` 中调用的 `esp_psram_extram_reserve_dma_pool`，不是进入 `main_task` 之前更早的 PSRAM 初始化阶段。Wi-Fi audio 相关构造器的调用集合相较旧候选只少一个 `pthread_mutex_init`，没有出现新增的 Opus 启动构造器。因此当前静态证据不支持“Opus 全局构造器在 app_main 前主动重启”这一解释。

下一步只读动态定位采用 USB-JTAG：在 `esp_restart_noos` 设置断点，获取触发 restart 的真实调用栈。当前不刷写、不恢复音频验收，等待该调用栈证据。

#### 启动 footprint 候选与 USB-JTAG 驱动阻塞

研究代理对新旧 ELF 的进一步对照确认：`build-wifi-audio-short` 已链接 Opus；唯一新增的 live 启动前 footprint 来自 `esp_ae_rate_cvt`。相对旧候选，`_iram_text_end` 增加 `0x100`，`_heap_start` 后移 `0x108`，即 `264 bytes`；PSRAM DMA reserve 仍固定为 `65,536 bytes`。这在当时形成了内部内存阈值候选，但后续 JTAG 真实栈已将其作为重启根因推翻；`64 KiB` 只是串口最后可见日志中的 reserve 参数，不能继续作为修复方向。

USB-JTAG 动态定位尝试使用两个 OpenOCD 版本，均返回 `LIBUSB_ERROR_NOT_FOUND`。Windows 当前把目标 `MI_02` 接口绑定到通用 Microsoft `winusb.inf`；Espressif 官方文档说明该错误需要安装 Espressif WinUSB/JTAG 驱动，参见 [Configure ESP32-S3 built-in JTAG interface](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/jtag-debugging/configure-builtin-jtag.html)。

该检查节点尚未切换驱动、刷写或修改产品代码。用户随后授权切换 JTAG 驱动并取得真实调用栈，结果见下一节；`63 KiB` reserve 单变量实验因此不再需要。

#### USB-JTAG 决定性定位：`wifi_audio_tx` 栈溢出

用户授权后，Windows `MI_02` JTAG 接口从 Microsoft `winusb.inf` 切换到已安装的 `oem94.inf` / libwdi `6.1.7600.16386`；`MI_00` 的 `COM7` 仍正常。OpenOCD 成功识别 factory MAC `44:1B:F6:E2:78:A8` 和 ESP32-S3 双核。

JTAG halt cause 与 GDB thread `9` 给出明确错误：`***ERROR*** A stack overflow in task wifi_audio_tx has been detected.`。调用链为 `panic_abort -> esp_system_abort -> vApplicationStackOverflowHook -> vTaskSwitchContext`。主任务链同时证明系统已执行 `main_task -> app_main (main.cpp:252) -> start_stackchan... -> xTaskCreatePinnedToCore(wifi_tx_task, stack=4096, core=0)`。

因此当前重启的确认根因是 `wifi_audio_tx` 的 `4096` 字节任务栈溢出。此前“未到 app_main”和“固定 64 KiB reserve / 264 bytes footprint 阈值导致重启”均被真实栈推翻；PSRAM reserve 只是串口最后可见日志，不能再作为修复方向。

原始证据：`.claw/runtime/openocd-jtag-live.err.log` 与 `.claw/runtime/gdb-wifi-audio-stack-overflow-20260807.log`。本轮只切换经用户授权的 JTAG 驱动并只读调试，未刷写固件。

#### `wifi_audio_tx` 栈溢出单变量修复候选

精确反汇编显示当前 `wifi_tx_task` 函数栈帧为 `0x1220`，即 `4,640 bytes`，已经大于旧任务栈 `4,096 bytes`；这与 JTAG 捕获的栈溢出直接一致。单变量修复把任务栈改为常量 `kWifiAudioTxTaskStackBytes = 12 * 1024`。协议、Opus、raw4/TDM、队列容量、任务绑核与半双工状态机均未改变。

离线回归结果：固件合同 `47/47`、Dock `42/42`、`npm check`、`npm audit=0`、diff-check 及 ESP-IDF 完整构建均通过。新镜像仍为 `3,990,384 bytes`，SHA-256 更新为 `809D4A27FB1B9EF071C8D37B8E9919633D43F9C35C4D7707BEB79F128AC531C0`；反汇编确认任务创建参数为 `0x3000`，即 `12 KiB`。

**在该离线节点，候选尚未刷写或启动，也没有实机 transport、音质录音或 Codex Voice 验收；只能记为已完成根因对应的离线单变量修复。后续受保护写入见下一节。**

#### 12 KiB TX 栈修复候选受保护写入

受保护预检确认目标为 ESP32-S3、factory MAC `44:1b:f6:e2:78:a8`，实时 `ota_0@0x20000`、大小 `5056K`。本轮只把修复候选 app `3,990,384 bytes`、SHA-256 `809D4A27FB1B9EF071C8D37B8E9919633D43F9C35C4D7707BEB79F128AC531C0` 写入 `ota_0@0x20000`。

esptool 内建校验报告 `Hash verified`，随后对同一 app 地址和长度执行的独立 `verify_flash` 报告 `digest matched`。bootloader、partition table、NVS 与 assets 均未写入。

**该写入检查点尚未实体短按 `RST`，因此当时没有稳定启动、Dock 认证、transport、音质录音或 Codex Voice 验收证据；后续实体合并门禁见下一节。**

#### 12 KiB 候选合并门禁：peer-close 后 bootstrap 死等

实体 `RST` 后，`192.168.0.8` 四次 Ping 均成功，延迟为 `3--44 ms`，`COM7` 保持稳定。确认唯一 Dock PID `4952` 启动后，日志先出现一条认证过程中的主动关闭，随后出现第二条 TCP 连接，但此后设备不再重连。

JTAG live 日志 `.claw/runtime/gdb-live-auth-state-20260808.log` 明确没有 panic，也没有再次发生 `wifi_audio_tx` 栈溢出；`wifi_audio_tx` 处于正常阻塞等待，所有音频任务仍存在。卡住的是 `wifi_audio_boot`：线程停在 `EspTcp::DoDisconnect(wait_for_task=true) -> xEventGroupWaitBits(..., portMAX_DELAY)`。

源码与线程状态闭环表明：WebSocket 收到 peer close opcode `0x8` 时只清除 connected 状态并触发 callback，没有关闭底层 TCP。bootstrap 随后析构旧 socket，进入等待接收任务退出的 Disconnect 路径，而接收任务没有被中止，因此可无限等待。当前最小修复是在 close opcode 分支直接调用既有 `Abort()`，让 TCP 接收任务自身执行非等待 Disconnect；TDM/raw4、Opus、扬声器和半双工状态机均保持不变。

JTAG 工具侧曾报告 memory protection 保护事件，但用户现场随后确认机器人没有重启，屏幕持续显示黄灯。黄灯表示应用运行、Dock 未连接，不能据工具事件推断设备崩溃或离线。本节当时只完成运行态诊断和最小修复设计，尚未完成 peer-close 修复复测。

#### Peer-close 最小修复离线门禁

managed source 与可重放 patch 均已把 WebSocket opcode `0x8` 处理改为直接调用 `Abort()`。`git apply --reverse --check` 通过，证明当前 managed source 已包含该 patch；固件合同 `67/67` 通过。

完整构建时间线保留两个环境事件：首次构建因项目已配置 Python `3.14`，却误用 Python `3.11` 而明确失败，属于 IDF 环境不匹配，不是代码编译错误。切换到 `idf5.5_py3.14` 后，第一次外层命令被 `60 s` 超时中断；随后在同一正确环境继续增量构建，最终完整编译、链接和分区检查通过。

最终 bootloader 大小 `0x5CD0`，剩余 `0x2330`。app 大小 `0x3CE350`（`3,990,352 bytes`），目标分区 `0x4F0000`，剩余 `0x121CB0`（约 `23%`）；SHA-256 `F98DB5DC41CC97C5B25FE33F4CE4C7C979913B3EF0CED0368B410D0B96F8AA06`。esptool checksum `32` 与 validation hash `098a…71fc` 有效。diff-check 通过，受保护 flash script 已 pin 新长度和哈希。

**在该离线门禁节点，候选尚未刷写或完成 Dock 认证、transport、音质与 Codex Voice 复测；后续当前运行边界见下一节。**

#### 当前运行边界纠正：应用稳定，连接未认证

用户现场确认机器人没有重启，持续显示黄灯；黄灯表示应用正在运行但 Dock 尚未连接。对 coredump 分区执行只读检查：`0xE00000` 起始、长度 `0x10000` 的内容全部为 `0xFF`，没有 coredump，进一步支持没有 panic/崩溃。该读取结束后 esptool 执行 hard reset；不能把工具复位与读取前的设备运行状态混为一谈。

当前 F98 候选启动稳定。第一条 TCP 连接曾进入 Established，随后静默关闭；Dock 没有 `protocolError`，设备回到黄灯/未认证状态。因此当前问题不是整机故障，而是连接没有完成 hello/认证，或在该阶段被静默关闭。下一步应定位 hello 是否发出/收到及关闭发起方，不再沿设备崩溃方向归因。

#### PC-only 认证诊断与强杀后的 reconnect 边界

Opus decoder PC 基准首次 ready 为 `5.87 ms`，连续 `10` 次 reset 为 `0.17--1.55 ms`，排除 decoder 初始化触发 `5 s` 认证超时。新增 receiver 认证诊断的 check 与定向测试 `10/10` 通过。

新诊断时间线显示：首连接 accepted 后 `3.138 ms` 以 code `1006` 关闭，未收到 hello、未认证。随后多条旧/竞争连接在 `0.7--1.1 ms` 内关闭。最终连接在 `76.487 ms` 到达 `hello_validated`，`77.516 ms` 完成 `authentication_claimed`，claim 自身耗时 `0.678 ms`，并成功认证。

同期只读设备内存计数为 `transport_state=3 (DockConnected) / ready=1 / tx_failed_sends=0 / tx_max_send_us=0x404 (1028 us) / socket_generation=17`，证明设备已成功发送 hello 并进入认证状态。首个 request `1` 超时与 JTAG halt 处于同一窗口，不能记录为控制链路失败。

用户随后报告红灯，但空 coredump 与 Ping 仍支持“设备未崩溃”的边界。停止受 JTAG 干扰的 Dock 并强制结束其进程后，新 Dock 没有自动收到设备回连；当前必须区分 Windows 强杀未发送 graceful close/TCP liveness 未及时失效，与固件 reconnect 机制本身的问题。本轮尚未进入 Opus transport 或听感验收。

#### 5 秒 hello 过期与 receive timeout 修复候选

新增时序证据显示，设备 hello 在连接 accepted 后 `5,229.239 ms` 才到达，而 Dock handshake timeout 为 `5,000 ms`。结合此前 JTAG 捕获的 `Abort() -> EspTcp::DoDisconnect` 永久/长时间等待，当前根因收敛为：旧 receiver 清理阻塞唯一 `wifi_audio_tx` worker，新连接的 hello 已进入待发路径却直到 Dock 门槛后才发送，因而过期。

最小修复只作用于 plain TCP 接收生命周期：`esp_tcp` connect 后设置 `SO_RCVTIMEO=250 ms`；`ReceiveTask` 遇到 `EAGAIN/EWOULDBLOCK` 时，若仍 connected 则继续接收循环，若正在 disconnecting 则退出，使 Abort/析构能在有界时间内完成。TDM/raw4、Opus 和 authentication 逻辑不变。

复核还发现，既有 `esp_tcp` 直接改动没有被旧 patch 完整覆盖。新增 `firmware/patches/esp-ml307-wifi-audio-plain-tcp.patch`，基线为官方 commit `ab4de7c28...`；CMake 现在循环应用两份 patch，确保 managed source 可从官方基线重放。

离线门禁为两份 patch 的 reverse-check、diff-check 和固件合同 `68/68` 通过；ESP-IDF `5.5.5` 完整构建通过。新 app 长度 `3,990,576 bytes`（`0x3CE430`），SHA-256 `BB346C4118ED4AC8C7A55A76A868FF7883BEC46B06FB1E83D08F96ACC958DDE6`；esptool image checksum `d6` 有效，validation hash `e88134b3...ece14` 有效。app 分区剩余 `0x121BD0`（约 `23%`）。

#### receive-timeout 候选受保护写入

刷写前从 `COM7` 预检确认目标为 `ESP32-S3 rev0.2`、MAC `44:1b:f6:e2:78:a8`，实时 `ota_0` 为 `0x20000 / 5056 KiB`。随后仅将上述 `3,990,576 bytes` / SHA-256 `BB346C...8DDE6` app 写入 `ota_0@0x20000`；esptool 内建 hash verified，独立 `verify_flash` digest matched。未写入 bootloader、partition table、NVS 或 assets。

**写入成功只证明候选身份与 flash 内容一致，不等于应用启动、Dock transport、Opus 音质或 Codex Voice 已通过。下一步是 fresh Dock 客观门禁。**

#### 第一轮 fresh Dock 启动与认证门禁

fresh Dock 日志为 `wifi-audio-dock-20260808-005140.stdout.log` 与对应 `.stderr.log`。机器人 `192.168.0.8` ping `4/4` 成功，TCP 为 Established，且本轮没有重启。

第一条候选连接在 accepted 后 `1,616.054 ms` 以 code `1006` 关闭。第二条连接在 `82.978 ms` 完成 `hello_validated`，`84.167 ms` 进入 `authentication_claimed`，claim 耗时 `0.759 ms` 并成功认证。相对旧候选 hello 的 `5,229.239 ms`，本轮约 `83 ms` 已明确低于 Dock 的 `5,000 ms` timeout，证明 `SO_RCVTIMEO` 使旧 receiver 生命周期清理具备时限这一核心目标已在实机成立。随后另有一个未认证的竞争连接在 `0.74 ms` 关闭。

但认证后的 request `1` 仍在 `1,500 ms` 超时，且未出现 PCM/Opus 音频帧，因此 transport gate **尚未通过**。当前只继续做 PC Dock-only fresh reconnect，以区分首连接残留与控制通道问题；本阶段不再刷写。

#### 第二轮 Dock-only 复连与控制帧上限

第二轮日志为 `wifi-audio-dock-20260808-005303.stdout.log` 与对应 `.stderr.log`。hello 在 `93.463 ms` 到达，authentication claim 在 `95.248 ms` 完成、耗时 `0.732 ms`，认证再次稳定通过；但 request `1` 仍在 `1,500 ms` 超时，并且没有 PCM/Opus 音频帧。

源码检查与离线序列化给出控制超时的确定性解释：`get_status` 完整响应即使所有计数都是单数字 `0`，长度也已达 `1,004 bytes`；实机 heap、stacks 与 TX 计数变成多位数后会超过设备端和 Dock 当前共同使用的 `1,024 bytes` 控制帧上限，因而 status 响应会被丢弃。这能解释 request `1` 超时，但不能解释尚未收到 Opus 帧。

同期尝试的 JTAG direct init/halt 命令没有输出预期 `mdw`，只显示 reset cause 并短暂停住设备；这次采集无效，**不得作为 ready、任务状态或运行路径的证据，也不再使用该方法继续判断。** 下一步仅运行 PC-only bare receiver：只完成 authentication + ready，不发送 `get_status`，以隔离音频链与控制响应；不刷写。

#### Bare receiver 两轮隔离测试

第一轮 bare receiver 只运行 `12 s`，设备在 receiver 关闭后才 accepted，最终 `connections=0 / frames=0`；该轮没有形成有效观测窗口，标记为无效时窗，不用于判断音频链。

第二轮扩展到 `25 s` 后形成有效连接：`hello_validated=200.705 ms`，authentication claim `202.159 ms`、耗时 `1.287 ms`，认证成功；另一个竞争连接在 `1.442 ms` 关闭。最终统计 `connections=2 / authenticated=1`，但 `frames=0 / encodedBytes=0 / decodeErrors=0 / gaps=0`。认证 socket 在 `12,481.805 ms` 关闭，关闭由测试结束触发，不是设备主动失败。

因此，在完全不发送 `get_status` 的条件下仍为零音频帧。`1,024 bytes` 控制上限可以确定解释 status/request 超时，但已被排除为麦克风零帧根因；当前仍存在独立的 ready 传播或音频任务/发送路径问题。下一步只做串口日志与 PC 连接的只读联合观察，不刷写。

#### 官方完整代码 review：已确认、高可信候选与未知项

本轮只读 review 没有修改代码，没有构建、刷写或实机测试。

**已确认：**

- 当前产品在 ready 后的完整上行顺序为 `InputData -> 24 kHz/16 kHz resample -> 960 samples -> Opus -> WebSocket`（`firmware/main/hal/wifi_audio_dock_mvp.cpp:1453-1513`）。bare receiver 已认证但零帧，确定把故障边界放在 `InputData`/采集/重采样上游，而不是 Dock 解码或 `get_status`；但本轮缺少同一次连接的 RX4 与内部 counters，尚不能锁定唯一断点。
- golden 使用独立 `i2s_new_channel(NULL, &rx)` 的 RX-only TDM、`total_slot=4`（`firmware/main/hal/board/cores3_audio_codec.cc:142-172`）；产品仍在构造时一次配对 TX/RX 并同时 enable（同文件 `:174-252`），只复用了 raw4 frame geometry 与 strict read（`:261-320`、`:353-379`），并非与 golden 相同的 I2S 拓扑。
- codec-dev 的 I2S data interface 会把 `4ch x 16-bit` RX 对应的 STD TX 扩展为 `2ch x 32-bit` 并在 RX 活跃时维持 TX clock（`firmware/managed_components/espressif__esp_codec_dev/platform/audio_codec_data_i2s.c:242-256`、`:409-428`、`:468-481`）。因此现有证据不支持把产品问题简单归结为“STD TX 与 TDM RX 天然不匹配”；其 paired STD/TDM 用法也有上游测试覆盖（`firmware/managed_components/espressif__esp_codec_dev/test_apps/codec_dev_test/main/test_board.c:1095-1113`、`:1164-1189`）。ESP-IDF 文档说明 paired channels 共享时序（本地 `i2s.rst:42-44`、`:908-933`），并给出 simplex 约束（`:999-1004`）。
- 官方 Xiaozhi 路线使用 `AudioService` 输入任务 priority `8`、事件门控、lazy input、输入失败 `10 ms` 重试、独立 Opus 任务，并在 RX 活跃时保留 TX clock（`firmware/xiaozhi-esp32/main/boards/m5stack-core-s3/cores3_audio_codec.cc:93-181`；`firmware/xiaozhi-esp32/main/audio/audio_service.cc:120-157`、`:183-224`、`:242-285`、`:288-343`、`:806-817`；`firmware/xiaozhi-esp32/main/application.cc:956-978`；`firmware/xiaozhi-esp32/main/audio/processors/no_audio_processor.cc:12-36`）。
- 本项目为了现有硬件与首版可靠性必须保留的偏离为 raw4、MIC1、24 kHz->16 kHz、60 ms Opus 与半双工。当前缺少官方或实机证据支持的偏离，是每次 speaking 切换都反复 `EnableInput/EnableOutput` 做物理重配（`firmware/main/hal/wifi_audio_dock_mvp.cpp:511-537`）。

**高可信但未确认：** `esp_codec_dev_open()` 忽略 `data_if->set_fmt` 返回值（`firmware/managed_components/espressif__esp_codec_dev/esp_codec_dev.c:176-183`）。若 paired TX/RX 的 format 重配实际失败，open 仍可伪装成功，随后 read 只表现为超时；这与“认证 ready 但零帧”相符，是当前高可信候选，但没有同次 `set_fmt` 返回值、RX4 与 read counters，不能写成已确认根因。

**仍未知/方案倾向：** 零帧究竟发生在 format 应用、I2S read、resampler 初始化/输入还是 ready 到采集任务的状态传播，仍需同一运行窗口的只读 counters/日志区分。两个同端口 simplex channel 常驻不作为方案；若确认 paired 生命周期无法可靠工作，最终倾向由单一 I2S owner 在 RX-only TDM 与 TX-only STD 之间销毁/重建，而非并存两个 owner。该路线目前只是基于官方拓扑和故障风险的设计倾向，尚未实现或验证。

#### Task 11 方案 A：单一 I2S owner 离线候选

用户确认采用方案 A。实施前先新增“单一 I2S owner 拓扑”和“`1,500 bytes` 控制边界”合同，两个定向测试均按预期红灯失败，形成实施基线；该红灯是缺失功能的预期结果，不是产品回归结论。

实现边界为：唯一 I2S owner 在 Listening 状态创建 RX-only TDM `4ch x 16-bit`，在 Speaking 状态切换为 TX-only STD `2ch x 16-bit`；不再保留同端口 paired TX/RX。打开 codec 前显式预检 `data_if->set_fmt` 并向上传播失败。控制帧上限由 `1,024` 调整为 `1,500 bytes`，最坏 `UINT32` 状态响应合同通过。

离线门禁时间线如下：实现后 firmware contract `51/51`、Dock 定向 `10/10`；第一次直接运行增量 `ninja` 因新 shell 缺少 ccache PATH，在编译器启动前失败，属于环境问题。补入绝对 PATH 后，两次增量链接均成功。最终全量 firmware `71/71`、Dock `check`、Dock 全量 `42/42`、`git diff --check` 均通过；完整 `ninja all` 生成 `stack-chan.bin`，大小 `0x3CE9E0`，`ota_0` 剩余 `0x121620`、约 `23%`。

**当前仍处于离线 code review 阶段：尚未固化候选 SHA-256、尚未完成 managed patch 重放验证，也未刷写或进行启动、认证、transport、音质及 Codex Voice 实机验收。上述合同与构建结果不得写成方案 A 已上线或产品已通过。**

#### Task 11 最终离线审阅与候选固化

后续 code review 共发现 `3` 项 P1 与 `2` 项 P2：P1 为失败转换后可能恢复出伪采集状态、I2S channel 删除失败时丢失句柄、WebSocket 在分配 payload 前未先执行长度上限检查；P2 为 `active_mode` 数据竞争、codec-dev close 忽略底层 disable 错误。五项均逐项修复，最终 bounded re-review 确认 P1 全部关闭。关键路径反汇编显示：`DestroyActivePath` stack frame `32 bytes`、symbol size `0x17F`；`CreateListeningPath` 为 `192 bytes` / `0x1A1`；`CreateSpeakingPath` 为 `192 bytes` / `0x193`；`SetWifiAudioMode` 为 `48 bytes` / `0xA6`，没有出现新的大栈帧风险。

最终离线门禁：firmware contract `75/75`；Dock `npm check` 通过、全量 `42/42`，其中包含真实 Espressif Opus 解码向量与 `1,000` 帧并发控制压力测试；`3` 个 managed patch reverse-check 通过；`git diff --check` 通过。构建过程中一次 CMake 因缺少 `IDF_PATH` 失败，早期一次 ninja 因 ccache PATH 缺失失败，均为环境配置问题；补齐环境后 ESP-IDF 完整构建、链接和分区检查成功。

最终候选为 `firmware/build-wifi-audio-opus/stack-chan.bin`，长度 `3,993,152 bytes`（`0x3CEE40`），SHA-256 `36C294E5F4FFDF46B073957F13773E7CD24E13545DE61370923E44DDA57A7B00`。目标 app 分区大小 `0x4F0000`，空余 `0x1211C0`、约 `23%`；esptool image checksum `54` 有效，validation hash `36c4d561a1b94ebef3175ccd8225d31f1cf9f247d543b52f1c353dcd505306a9` 有效。

受保护 flash 脚本已 pin 上述长度与 SHA-256；任何 `Execute` 写入前都会先完整备份当前 `ota_0@0x20000`、长度 `0x4F0000`，并生成 SHA sidecar。`preflight-only` 路径不执行写入。

**本轮尚未执行硬件 preflight、备份、刷写或任何实机启动、transport、音质、Codex Voice 验收。最终哈希、完整构建和脚本保护只能证明离线候选可追溯，不能记录为方案 A 实机通过。**

#### Task 12 硬件验收预检

2026-08-08 在 `COM7` 进行只读 preflight，端口身份为 `VID_303A / PID_1001`。待验候选为 `3,993,152 bytes`，SHA-256 `36C294E5F4FFDF46B073957F13773E7CD24E13545DE61370923E44DDA57A7B00`。

esptool `4.12.0` 识别目标为 `ESP32-S3 QFN56 rev0.2`、`40 MHz`、`USB-Serial/JTAG`，MAC `44:1b:f6:e2:78:a8`。只读实时分区表为：`ota_0=0x20000 / 5056 KiB (0x4F0000)`、`ota_1=0x510000 / 5056 KiB`、`assets=0xA00000 / 4 MiB`、`coredump=0xE00000 / 64 KiB`。目标身份、候选大小与实时 `ota_0` 边界匹配，结果为 `PREFLIGHT PASSED`。

**该节点仅完成只读预检，没有执行 ota_0 备份、擦除、写入或任何启动与音频验证。**

#### Task 12 第一次 `-Execute` 尝试：外层时限中断

第一次使用同一候选与受保护脚本进入 `-Execute` 流程时，外层 shell 在 `120 s` 到期。最后输出停在 `Reading current ota_0 ...20260808-021433-ota_0-full.bin`；日志中尚未出现 backup SHA、`Writing only ota_0`、`write_flash` 或 verify 阶段。

中断后只读检查确认没有残留 Python/esptool 进程，目标备份文件 `20260808-021433-ota_0-full.bin` 不存在，`COM7` 仍正常存在。因此该节点既不能记录为备份成功，也不是备份或写入失败，更不能记成设备已经刷写；实际边界是完整 `5,056 KiB` ota_0 读回耗时超过外层 `120 s` 限制。

下一次仍使用完全相同的候选与脚本，仅延长外层命令时限后重跑，不改变固件版本或写入范围。

#### Task 12 第二次 `-Execute` 尝试：300 秒仍不足

第二次保持候选、脚本和传输参数完全不变，只把外层时限延长到 `300 s`，输出仍停在完整 `ota_0` 读取起点，未出现 backup SHA、write 或 verify。以前序 `4,096 bytes` 只读速度 `86.5 kbit/s` 估算，完整 `5,056 KiB` 需要约 `8 min`，因此 `300 s` 仍不足以让写前备份完成。

中断后只读确认没有残留 Python/esptool 进程，目标 `20260808-021711-ota_0-full.bin` 不存在，`COM7` 仍存在。结论仍是外层时限不足，流程在任何 flash 写入前停止；不能记录为备份、写入或设备故障。

下一次仅把同一脚本的外层时限延长到 `15 min`，不改变候选身份、传输参数或 app-only 边界。

#### Task 12 第三次 `-Execute`：完整备份、写入与验证通过

第三次保持同一候选、同一脚本和传输参数，只将外层时限延长为 `15 min`，流程实际耗时 `515.7 s`。脚本先从 `0x20000` 完整读取旧 `ota_0` 共 `5,177,344 bytes`，耗时 `452.4 s`、速率 `91.5 kbit/s`，生成备份 `backups/wifi-audio-preflash/20260808-022602-ota_0-full.bin`。独立回读确认备份 Length `5,177,344`，SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED`，与 SHA sidecar 完全一致。

备份确认后只擦除/写入 app 范围 `0x20000..0x3EEFFF`。写入候选长度 `3,993,152 bytes`，压缩传输 `2,371,044 bytes`，耗时 `23.3 s`、速率 `1370.3 kbit/s`；esptool 内建结果为 `Hash verified`。随后对 `0x20000 / 0x3CEE40` 执行独立 `verify_flash`，结果 `digest matched`，最终门禁为 `FLASH AND VERIFY PASSED`。

本次未写入 bootloader、partition table、NVS 或 assets。**截至该节点尚未实体短按 RST，也没有应用启动、Dock transport、音质或 Codex Voice 验收；完整备份、写入和校验通过仅证明 flash 内容与候选一致。**

#### Task 12 实体 RST 后重启与 Dock 单变量隔离

用户实体 RST 后报告：机器人能进入系统并显示黄灯，有时短暂变绿，但约 `4-6 s` 后崩溃重启。PC 侧发现旧 standalone Dock PID `792` 仍在监听，命令行为 `node wifi-audio-dock.mjs --port 8765 --microphone-enabled true`，进程创建时间 `01:04:31`。初始四次 ping 仅 `1` 次成功、`3` 次超时；`COM7` 存在，TCP 同时存在多条与 `192.168.0.8` 的 Established 连接。

Dock stdout 在循环中反复出现 `accepted -> hello_validated`（约 `11-312 ms`）`-> authentication_claimed -> connected -> code 1006 close`。stderr 中 request `1..20` 全部在 `1,500 ms` 超时；多次连接约 `5.0-5.9 s` 后关闭，与用户观察到的重启周期吻合。

同期 `25 s` 只读 `COM7` 采集从 `USB_UART_CHIP_RESET` 开始，随后多次出现 `rst:0xc / Saved PC:0x4038ac61`，每轮末行停在 `64K reserve`。依照此前 JTAG 已确认的历史边界，该日志只证明最终进入 software reset，不能直接把最后可见的 `64K reserve` 或 `0x4038ac61` 当作本轮真实根因。

随后停止唯一 Dock PID `792`，并确认 TCP `8765` 已无 listener。在停止 Dock 后进行 `35` 轮、约 `45 s` 的单变量隔离采样，`192.168.0.8` ping `35/35`、`COM7` 存在 `35/35`，用户同时确认机器人不再重启。

该对照确定：方案 A 的基础启动、Wi-Fi 与板级供电在无 Dock 条件下稳定；重启触发窗口严格收敛到 Dock 认证后的 Listening/I2S 切换或其后控制路径。**尚未完成连续 `5,000` 帧 transport、录音音质或 Codex Voice 验收，不能把无 Dock 稳定记录为方案 A 通过。**

#### Task 13 只读根因 review：`wifi_audio` 任务栈

源码时序确认 Listening RX path 在 Dock 连接前已经创建（`firmware/main/hal/wifi_audio_dock_mvp.cpp:1634-1655`）。认证 ready 后再次调用 `SetWifiAudioMode(Listening)` 时，因当前已处于 Listening 直接返回，不会重建 I2S；Dock 连接后才创建 `wifi_audio` 任务。resampler 在 ready 前 open，ready 后任务才进入 `Read/InputData -> resample`。因此本轮复位不支持“ready 再次重建 RX I2S”作为解释。

最终 ELF 中 `audio_task` 函数入口 prologue 为 `0x1180`，即静态 frame `4,480 bytes`；任务栈只有 `6,144 bytes`，仅余 `1,664 bytes` 给 rate converter、`InputData/Read/i2s` 调用链。源码还把 `mono[240]` 与 `pending[960]` 数组放在该任务栈上。官方 `AudioService` input 任务虽然同样使用 `6,144 bytes`，但其 buffers 是 `std::vector` heap 分配，不能直接用官方数值证明当前本地数组实现安全。

固件已开启 stack canary，overflow hook 会 abort，最终表现为 software reset；该机制与现象相符。源码、阻塞时限和复位时间线同时排除了锁环、I2S `1 s` 阻塞以及 `10 s` 非 panic task WDT 作为本轮约 `4-6 s` 首因。

后继 `microphone_encode` 的静态 frame 为 `3,584 bytes`、任务栈 `6,144 bytes`，属于下一阶段风险；官方 codec task 使用 `24,576 bytes`。但它尚未被证实为本轮第一次复位的首因，因此不能与当前变量一起盲目修改。

最小单变量候选只把 `wifi_audio` task stack 从 `6,144` 提升到 `12 KiB`，其余任务、I2S、Opus、协议和状态机保持不变。实机验收先做 `45 s` 认证、`get_status` 与 read counters 门禁；只有首个 `60 ms` 音频周期后仍复位，才单独验证 `wifi_opus` 栈风险。

**本轮仅完成只读 review；尚未修改代码、构建、刷写或执行上述实机门禁。任务栈证据是高可信根因候选，尚不是已验证修复。**

#### Task 13 `wifi_audio` 栈单变量候选与离线门禁

实现只在 `wifi_audio_dock_mvp.cpp` 新增 `kWifiAudioCaptureTaskStackBytes = 12 * 1024`，并把 `audio_task` 原 `6,144 bytes` 栈替换为该常量；注释固定记录 ELF frame `0x1180` 及扩栈原因。`wifi_opus` 仍为 `6,144 bytes`，I2S 拓扑、协议和 Dock 均未改变；固件合同同步锁定该单变量。

定向合同 `56/56` 通过。一次从 `tools/stackchan-dock` 错误 cwd 运行 firmware discovery，因 start directory 不可导入而失败，属于路径/环境错误；同一阶段 Dock `check` 与全量 `42/42` 均通过。从仓库根目录重跑后 firmware 全量 `75/75`。

第一次 `ninja` 因 PATH 指向不存在的 ccache `4.11.2` 而在编译器启动前失败，没有 C++ 诊断；实际已安装版本为 `4.12.1`。改用该版本绝对路径后，ESP-IDF 完整 build/link/image/partition 检查成功。

最终 app 长度仍为 `3,993,152 bytes`（`0x3CEE40`），目标分区 `0x4F0000`、剩余 `0x1211C0`、约 `23%`；新 SHA-256 为 `E215D6504753D792C70ED2512A32929287ECB36DD46B41E75286A649784E2EB6`，esptool checksum `e6` 有效，validation hash `741b3107a81b9373e98e327f742d1d1430b3e8647c1973f191afb18c414338e7` 有效。flash 脚本已 pin 新 SHA，长度不变。

最终复核为 firmware `75/75`、三份 managed patch reverse-check、`git diff --check` 与 flash pin check 全部通过，输出 `FINAL_OFFLINE_GATE_OK`；Dock `check + 42/42` 使用本轮前序同一实现结果。

**新候选尚未刷写或进行任何实体启动、45 秒稳定性、read counters、transport、音质及 Codex Voice 验收。相同长度不能替代哈希身份；只有 `E215D...E2EB6` 才是 Task 13 单变量候选。**

#### Task 14 决定性 JTAG 定案：实际溢出任务为 `wifi_opus`

在旧失败镜像仍运行、没有执行新刷写的条件下，启动 OpenOCD PID `32696`，确认双核 JTAG 与设备 MAC；随后启动唯一诊断 Dock PID `35644`，只触发一次故障。OpenOCD 原始日志为 `.claw/runtime/openocd-audio-stack-20260808-095230.err.log`。

halt cause 精确报告：`***ERROR*** A stack overflow in task wifi_opus has been detected.`。GDB 线程 `5` 位于 CPU0，调用链为 `panic_abort -> esp_system_abort -> vApplicationStackOverflowHook(task wifi_opus) -> vTaskSwitchContext -> _frxt_dispatch`。同期线程 `10` 的 `wifi_audio` 正常阻塞在 `i2s_channel_read(size=1920)`，command task 正常阻塞在 `xQueueReceive`。因此本轮实际栈溢出任务已由 JTAG 定案为 `wifi_opus`，排除 `wifi_audio` capture task 和 I2S read 作为实际溢出位置。

采证后执行 monitor resume/detach，停止诊断 Dock 与 OpenOCD；确认 PID `35644`、`32696` 均已结束，TCP `8765` 与 `3333` 均无 listener，设备 ping `2/2` 成功。

该决定性证据正式推翻 Task 13 的 capture `12 KiB` 高可信假设。由于该候选尚未刷写，现已撤销未落地的 capture 扩栈，`wifi_audio` 恢复 `6,144 bytes`；唯一变量改为把 `wifi_opus` stack 提升到 `24 KiB`，直接对齐官方 `AudioService` 中同类 Opus codec task 的栈配置。

**当前只完成代码方向纠正，尚未重新构建、固化候选哈希、刷写或进行启动、transport、音质与 Codex Voice 实机验收。JTAG 已确认根因任务，但修复尚未验证。**

#### Task 14 `wifi_opus` 24 KiB 根因匹配候选

实现撤销 capture `12 KiB` 修改，`wifi_audio` 恢复 `6,144 bytes`；新增 `kWifiAudioOpusTaskStackBytes = 24 * 1024`，只替换 `wifi_opus` 创建栈。修改依据仅为 JTAG 已定案的 `wifi_opus` overflow 与官方 `AudioService` codec task 的 `24 KiB` 配置，合同同步锁定该唯一变量。

固件全量合同 `75/75`；完整 `ninja` build/link/image/partition 检查通过。Dock 代码未改变，沿用同轮已通过的 `npm check + 42/42`。反汇编中 `wifi_opus` 创建参数为 `movi a12, 3` 后 `slli ... 13`，结果精确为 `24,576 bytes`，证明最终 ELF 携带目标栈值。

最终 app 长度 `3,993,152 bytes`（`0x3CEE40`），partition `0x4F0000`，free `0x1211C0`、约 `23%`。SHA-256 为 `D6686B27E100A2940D45A3984320897E5BF886C966D59160D23358D30C9630AD`；esptool checksum `7d` 有效，validation hash `695fc3be67971b66edd2e750fa22f8bff5b7fc815085463b70bb9649ec47f8d0` 有效。flash 脚本已 pin 新身份；最终 firmware `75/75`、pin check 与 `git diff --check` 输出 `OPUS_STACK_FINAL_GATE_OK`。

旧 `ota_0` 完整回滚备份 SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED` 仍有效。**新候选尚未刷写或进行实体启动、Dock transport、音质及 Codex Voice 验收；根因与代码变量闭合不等于修复已在实机通过。**

#### Task 14 刷写成本优化：受校验的既有备份复用

flash 脚本新增可选参数 `-ExistingBackupPath`。不传该参数时，默认行为仍是在写入前完整执行 `read_flash` 备份；选择复用时，脚本必须在任何 write 前同时确认：文件存在、长度精确为 `0x4F0000`、SHA sidecar 存在，并且现场 `Get-FileHash` 与 sidecar 完全一致。任一条件不满足立即 throw，禁止进入写入。

新增合同锁定该保护路径后，固件全量为 `76/76`；PowerShell 语法解析通过。实际既有备份 `backups/wifi-audio-preflash/20260808-022602-ota_0-full.bin` 长度为 `0x4F0000`，现场哈希与 sidecar 一致；D668 候选 pin 也一致，复用预检输出 `REUSE_BACKUP_GATE_OK`。

**当前尚未让设备进入下载模式，也未执行硬件 preflight 或刷写 SHA-256 `D6686...C9630AD` 候选。备份复用门禁通过只降低重复读取成本，不是 flash 或实机验收证据。**

#### Task 15：无需实体下载模式的 JTAG app-only 写入

写入前只读核对本机 OpenOCD `esp_common.cfg` 中 `program_esp`：它使用 `flash write_image erase <file> <address>` 按指定文件与地址擦写；verify 通过 `esp verify_bank_hash` 直接读取 flash；随后执行 `reset run`；命令格式要求 binary 与 address 成对提供。

本轮执行 `program_esp .../stack-chan.bin 0x20000 verify reset exit`。JTAG 识别 serial/MAC `44:1B:F6:E2:78:A8`、双 TAP/双核与 ESP32-S3 rev `0.2`。目标原内容与候选不一致后，从 `0x20000` 仅按镜像范围执行擦写；逻辑候选长度为 `3,993,152 bytes`，flash sector 对齐后的实际处理量为 `3,993,600 bytes`。erase `5,236.86 ms`，data `3,993,600 bytes in 35,582 ms`，write `35,827.9 ms`，全过程 `44,174 ms`。

随后日志依次为 `Verify Started -> Flash verified 2241.45 ms -> Verify OK -> Resetting Target`，OpenOCD 正常 shutdown、exit code `0`。写入候选 SHA-256 为 `D6686B27E100A2940D45A3984320897E5BF886C966D59160D23358D30C9630AD`；未触碰 bootloader、partition table、NVS 或 assets。旧完整 `ota_0` 备份 SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED` 继续作为回滚依据。

**该节点只证明 JTAG app-only 写入与 OpenOCD flash verify 通过。虽然执行了 `reset run`，尚未观察启动稳定性，也未执行 Dock、transport、音质或 Codex Voice 验收。**

#### Task 15 写入后的无人值守启动观察

D668 候选 JTAG 写入后，fresh Dock PID `24140` 于 `10:15:07` 监听 `8765`。机器人当时 ping `3/3`、`COM7` 正常，但截至 `10:18` 没有 TCP 连接；Dock stdout 只有四行启动信息，stderr 为空。`22 s` 只读串口成功打开端口但收到 `0` 个设备字节。

约 `10:20` 的 JTAG 线程快照因 OpenOCD 检测 memory protection 而自动触发 soft reset，因此不得用于推断复位前状态；快照中 `wifi_opus / wifi_audio_tx / cmd` 存在但 `boot / capture` 尚未出现，只代表复位早期。随后约 `17 s` 内四次 ping 均超时，`COM7` 仍正常、Dock 仍无连接；受 JTAG 自动复位污染，不能据此宣称新固件自行崩溃。

`10:21` 先以 DTR/RTS=false 连接 `COM7`，再显式执行 OpenOCD `init; reset run; shutdown`，reset 与 capture 均 exit `0`。原始串口日志 `.claw/runtime/wifi-audio-d668-controlled-reset-com7-20260808.log` 显示 `RTC_SW_SYS_RST/JTAG`、D668 app 启动信息，末行到 `esp_psram Reserving pool of 64K...`，其后 `28 s` 无字节；但窗口后机器人 ping `5/5`（`100 / 30 / 15 / 84 / 37 ms`）、`COM7` 正常，证明不能把串口末行外推为卡在 PSRAM。Dock 仍只有 listener、没有 TCP。

另一次直接 OpenOCD `mdw phys` 因命令不支持且 CPU1 examination 失败，是无效采集；已立即 `reset run; shutdown` 恢复，不得作为产品故障证据。只读源码与线程闭环显示：`transport_bootstrap` 首次 codec/Listening 初始化失败会直接 `vTaskDelete`；复位后存在 tx/opus/cmd/led 而没有 boot/capture，与该分支一致，但当时缺少精确 `transition_error`，仅列为高可信、未确认。

#### Task 16 初始化失败闭环与 PSRAM Opus 栈候选

进一步把线程快照与源码合并后确认：bootstrap 曾启动，但首次 codec/Listening 失败后永久 `vTaskDelete`；`Connect` 位于该失败分支之后，所以四个 worker 存在而 boot/capture 缺失能够解释“设备在线但没有 TCP”。

研究中曾误判普通 `24 KiB` task stack 会按 `512 bytes` 阈值自动进入 PSRAM；查阅 ESP-IDF `freertos/heap_idf.c` 后纠正：`pvPortMalloc` 强制 `MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT`，普通 `xTaskCreate` 的 stack 始终占内部 RAM。D668 相比旧 `6 KiB` 栈额外占用约 `18 KiB` 内部 RAM，而 I2S DMA 同样需要 `INTERNAL | DMA`；因此内部资源挤压是高可信解释，但具体首次失败叶节点仍未确认。

Task 16 保持 `wifi_opus=24 KiB`，改用 `xTaskCreatePinnedToCoreWithCaps(..., MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)`；三处回滚同步改为 `vTaskDeleteWithCaps`。bootstrap 每次循环都重新 apply Listening，失败后延时 `1 s` 再 continue，成功前禁止 `CreateWebSocket`。

全量固件合同 `77/77`，ESP-IDF 完整 build/link/image/partition 通过。新 bin 为 `3,993,200 bytes / 0x3CEE70`，app free `0x121190`、约 `23%`；SHA-256 `520FD7B36CA94160BDE46FFDC630EE392E21992B25629916EC1D0A7418A64E47`，checksum `55`、validation hash `160f703707ed98f763bb05d7204600c7cb657fc6bac252169daca70c8c52514d` 均有效。ELF 包含 `xTaskCreatePinnedToCoreWithCaps / vTaskDeleteWithCaps`，flash pin 更新，最终 `FINAL_OFFLINE_GATE_OK`。此离线节点尚未刷写或实测。

#### Task 16 写入恢复与首个 Opus 帧

写前 preflight 匹配候选 Length `3,993,200` / SHA `520F...A64E47`；既有 rollback Length `5,177,344` / SHA `5708...C2ED` 与 sidecar 一致，Dock 已停止且 `8765` 无 listener。首轮 `40 MHz` JTAG 在成功擦除对齐后的 `3,993,600 bytes` 后 algorithm stopped，`transferred=0 / write failed / exit=1`，使 app 区进入中间态。立即用同一镜像、`10 MHz` 恢复：erase `5,251.34 ms`，transfer `36,047.1 ms @ 108.192 KiB/s`，write `36,292.1 ms`，total `44,488 ms`，verify `2,245.62 ms`，`Verify OK`、reset、exit `0`。

fresh Dock PID `4008`，日志 `wifi-audio-dock-20260808-103812.stdout.log` / `.stderr.log`：hello `13.764 ms`、auth `15.602 ms`，首个 Opus frame 成功解码（`143 bytes -> 2,880 bytes`，`decode_errors=0 / gaps=0 / peak=147 / rms=47.33`）。但 `3.505 s` 后 code `1006`，request `1` 在 `1,500 ms` 超时；随后多次 accepted 后在 auth 前 `1006`，最终无 TCP。设备 ping `8/8`、`COM7` 正常。因此零 TCP/bootstrap 障碍已越过，PSRAM stack 能实际运行到首帧，但 transport 尚未通过。

#### Task 16 bare receiver 协议隔离

JTAG 在线触发时 OpenOCD 没有 panic/reset，设备连续 ping `5/5`，所以 code `1006` 不是已证实重启。首轮 bare receiver 先 reset、约 `10 s` 后才开始监听，得到 `0` 连接，属于无效时窗。

有效顺序改为 receiver 先监听再 software reset：hello `82.099 ms`、auth `83.708 ms`；不发送 `get_status` 时连续收到 `75` 个 Opus frame，`encodedBytes=10,928 / PCM=216,000 bytes`，`decodeErrors/gaps/duplicate/out_of_order/invalid` 全为 `0`。`7.273 s` 的 close 发生于 receiver `50 s` 总计时结束收尾，不能归因设备。第二个 status A/B 尝试在 reset 后 `15 s` 仍为 `0` 连接，是无效时窗，不记录为 status 结果。该证据证明无控制请求时 Opus 发送/解码可以持续，把剩余问题高度收敛到控制发送或其并发边界。

#### Task 16 `WebSocket::Abort` 决定性硬件断点

硬件断点命中 `WebSocket::Abort`，调用链为 `wifi_tx_task` 的 transmit lambda（`wifi_audio_dock_mvp.cpp:1379`）直接调用 `WebSocket::Abort`。失败帧为 `length=159 / binary=true / microphone=true / generation=3 / microphone_generation=6`；断点时计数 `s_tx_failed_sends=1 / s_microphone_send_failures=1 / s_microphone_frames_sent=27 / s_microphone_frames_encoded=36 / s_microphone_frames_captured=48`。

这确认设备侧 `socket->Send` 返回 false 后主动 Abort；失败对象是 Opus 麦克风二进制帧，不是 `get_status` JSON，也不是 Dock 主动 handshake timeout、设备 panic 或重启。第二次针对 `EspTcp::Send` line `146` errno 的断点尚未命中；GDB/OpenOCD/Dock 当时仍有残留进程，当前只允许清理并恢复目标运行，**不能记录任何 errno 结论。**

#### Task 16 官方与 ESP-IDF 发送语义深度 review

当前 PC Dock WebSocket 设置 `SetSendTimeout(200 ms)`，使 lwIP send 走带超时的可能阻塞语义：send buffer 暂时不足/`ERR_MEM` 时会等待；若超时且尚未写入任何字节，返回 `ERR_WOULDBLOCK -> EAGAIN`；若已经部分写入则按成功返回，`EspTcp` 会继续发送剩余数据。该等待/失败检查可能由约 `1 s` 的 TCP poll 驱动，而不保证精确在 `200 ms` 返回。

官方 Xiaozhi WebSocket 不调用 `SetSendTimeout`；其 `40` 个、每包 `60 ms` 的 Opus 队列满时等待。`SendAudio=false` 只停止当前 drain，不主动执行 `Abort`。这与当前产品“任一 microphone Send false 立即 Abort”存在行为差异。

实机计数闭合为 `encoded 36 - (sent 27 + failed 1) = 8`，精确等于 microphone TX queue 容量。这表明 TX worker 卡在一次 send 时，编码继续把队列填满，随后 Send 返回失败并触发 Abort。失败帧只有 `159 bytes`，远小于 TCP send buffer `5,760 bytes`，排除“单帧本身超过 sndbuf”。基于超时语义，最可能 errno 是 `EAGAIN`，但断点尚未取得真实值，仍不能排除 `ECONNRESET` 或 `ENOTCONN`。

两次地址断点均无效：一次目标源行被编译器优化、没有独立指令地址；另一次在启动期遇到 memory protection/JTAG trap，未命中目标 send 路径。二者不得充当 errno 或调用路径证据。

下一单变量候选只移除 PC Dock WebSocket 的 `200 ms SetSendTimeout`，恢复与官方一致的阻塞 send；queue 容量、Send-false Abort、重连和其他协议行为保持不变。**本节仅为只读 review 和候选设计，尚未实现、构建、刷写或实机测试。**

#### Task 17 移除 PC Dock send timeout：离线候选

实现只删除 `wifi_audio_dock_mvp.cpp` 中 `kWifiAudioSendTimeoutMs = 200` 以及该 socket 的 `SetSendTimeout` 调用。通用 WebSocket/TCP timeout API 仍保留；TX queue、Send-false Abort、reconnect、I2S、Opus 和所有音频参数均不变。定向合同 `58/58`、固件全量 `77/77` 通过。

第一次使用普通 `firmware/build` 完整构建虽然最终显示 `Project build complete`，但它采用通用 `sdkconfig` 而非 `sdkconfig.wifi_audio`，镜像只有 `0x36E430`，已明确拒绝刷写。外层 `181 s` 超时发生在构建完成提示之后，不是编译失败；该产物仍因配置错误而无效。

随后使用正确的专用 `build-wifi-audio-opus + sdkconfig.wifi_audio` 完整构建，exit code `0`。候选长度 `3,993,168 bytes`（`0x3CEE50`），partition `0x4F0000`，free `0x1211B0`、约 `23%`；SHA-256 `7F9CD0101B5BF39C1A6F8C934368BC286147C533674F093FDBDAC23A6A6CBCED`，checksum `e0` 有效，validation hash `48e2...1bab0` 有效。受保护 flash pin 已更新到该身份。

**Task 17 正确候选尚未写入或做启动、Dock transport、音质及 Codex Voice 实机验收。只有 `7F9C...CBCED` 专用构建可进入后续门禁，`0x36E430` 普通构建禁止使用。**

#### Task 18：7F9C 候选 JTAG 写入与中间态恢复

候选为 SHA-256 `7F9CD0101B5BF39C1A6F8C934368BC286147C533674F093FDBDAC23A6A6CBCED`。第一次从运行态以 `10 MHz` 执行 `program_esp`：识别芯片并发现 existing content mismatch 后，擦除对齐范围 `3,993,600 bytes`、耗时 `57.435 ms`，但 flash algorithm 随后意外停止，`Transferred=0 / write failed / exit=1`。此时 app 区处于不完整中间态，不能启动或验收。

没有修改任何变量；目标已停在 ROM 后，第二次使用同一镜像、同一 `0x20000` 地址和同一 `10 MHz` 重试。结果为 erase `3,993,600 bytes / 5,235.45 ms`，transfer `35,665.8 ms @ 109.349 KiB/s`，write `35,915.7 ms`，总计 `43,935 ms`；verify `2,244.06 ms`，`Verify OK`，随后 reset、exit code `0`。

本轮只处理 app `0x20000` 镜像范围，bootloader、partition table、NVS、assets 等其他分区未触碰；现有完整 `ota_0` 回滚备份仍有效。**写入与 verify 通过只恢复候选 flash 内容，不等于启动稳定、transport、音质或 Codex Voice 已通过。**

#### Task 18/19：移除 timeout 的实机收益与决定性反证

7F9C 新候选连接完整 Dock 时，hello `16.766 ms`、auth `19.034 ms`；同一 TCP 连接持续超过 `60 s`，设备 ping `10/10`，旧版本约 `3.7 s` 的 Send-false Abort 不再发生。但该窗口收到 `0` 个 Opus frame，request `1 (set_audio)` 仍在 `1,500 ms` 超时。

首次 `30 s` bare receiver 在脚本 final 之后设备连接才到达，属于无效时窗。有效 `120 s` bare 测试得到 hello `89.291 ms`、auth `91.161 ms`，认证连接持续 `111,962.225 ms`；全程 `reconnect/decodeErrors/gaps/duplicates/out_of_order/invalid=0`。然而最终只有 `21` 个 Opus frame、`3,003 encoded bytes`、`60,480 PCM bytes`，远低于按 `60 ms/frame` 应约 `1,866` 帧的实时速率。

因此实机否证“完全移除 send timeout”路线：它确实避免短时 Abort，却导致或暴露长期阻塞，音频吞吐不可用。测试结束后自动 MCP Dock PID `12032` 抢回 `8765` 并产生多连接，但发生在 bare final 之后，不污染上述有效 `111,962.225 ms` 窗口。

下一候选尚未实现：恢复 `200 ms` send timeout，并在 Send false 时读取 `GetLastError`；若为 `EAGAIN/EWOULDBLOCK`，仅丢弃当前已过期 microphone frame、不 Abort；只有 fatal errno 才 Abort。**当前没有该候选的代码、构建、刷写或实机证据。**

#### Task 20：按 errno 丢弃过期麦克风帧的离线候选

基于 Task 19 反证，恢复 `SetSendTimeout(200 ms)`。`Send=false` 后立即读取 `GetLastError`，继续保留现有 failed counters 与 errno 日志。只有 `frame.microphone && errno == EAGAIN` 时，丢弃这一帧已过期 mic 数据并继续会话、不调用 Abort；控制帧遇到 EAGAIN 或任何其他 errno 仍执行 Abort/reconnect。

该候选没有扩大队列、没有重试失败帧，也没有修改 I2S、Opus、采样率、帧长或其他音频参数。固件合同 `77/77`；专用 Wi-Fi Audio build exit `0`。app 为 `3,993,280 bytes / 0x3CEEC0`，free `0x121140`、约 `23%`；SHA-256 `D81E317731E339C6585EFDA88D1641F3317A01E00EFC91F18E5D4DCD51220F72`，checksum `78` 有效，validation hash `2cd809...99f1b` 有效。flash pin 已更新。

ELF 复核确认 `EspTcp::Send` 失败分支把 errno 通过 `s32i` 保存到 `this+52`，并保留 `GetLastError` 符号及实际调用，说明最终二进制携带 errno 分类路径。

**Task 20 仍是离线候选，尚未刷写或进行连接稳定性、实时帧率、音质及 Codex Voice 实机验收。**

#### Task 21：D81E 候选 JTAG app-only 写入

写入前先停止监听 `8765` 的 MCP Dock 及其父启动脚本，并校验候选身份为 SHA-256 `D81E317731E339C6585EFDA88D1641F3317A01E00EFC91F18E5D4DCD51220F72`。随后单独执行 reset halt，使目标稳定停在 ROM，再以 `10 MHz` 进行 app-only program。

本轮一次成功：erase 对齐范围 `3,993,600 bytes / 5,250.63 ms`，transfer `35,539.7 ms @ 109.737 KiB/s`，write `35,791.5 ms`，总计 `43,827 ms`；verify `2,245.1 ms`，`Verify OK`，reset、exit code `0`。

仅写入 app `0x20000` 镜像范围，其他分区未触碰；既有完整 `ota_0` 回滚备份仍有效。**当前尚未执行 transport、录音音质或 Codex Voice 验收。**

#### Task 21：D81E 120 秒 bare receiver 门禁失败

有效日志 `.claw/runtime/bare-receiver-task21.out.log`：hello `10.955 ms`、auth `12.874 ms`，单一认证连接稳定 `119,797 ms`，`reconnect/decodeErrors/gaps=0`。但全程仅收到 `5` 个 Opus frame、`715 encoded bytes`、`14,400 decoded PCM bytes`，远低于 `120 s / 60 ms` 应约 `2,000` 帧。因此 Task 20 的 errno 分类候选 transport gate 失败，不进入试听或 Codex Voice。

同期一次 OpenOCD `mdw` 静态计数器读取没有输出内存值，并使目标暂时失联；随后通过 reset halt/resume 恢复。该采集无效，不得据此推断任何 counters。

#### Task 22：逐帧时序与连接后续失效

新增纯 PC 脚本 `.claw/runtime/bare_receiver_verbose_task22.mjs`，Node syntax check 通过；有效日志 `.claw/runtime/bare-receiver-task22.out.log`。D81E 固件 hello `9.599 ms`、claim `11.220 ms`；只收到 seq `1..4` 四个连续帧，每帧 `143 bytes`。到达 sinceAuth 为 `73.383 / 103.314 / 172.761 / 276.298 ms`；arrival delta 为 `29.931 / 69.447 / 103.537 ms`；设备 capture delta 为 `10.960 / 59.850 / 59.999 ms`。

此后 TCP 保持 Established，直到测试结束在 `59,246.681 ms` 关闭；final `frames=4 / decodeErrors=0 / gaps=0 / reconnect=0`。这证明前约 `276 ms` 的 capture -> Opus -> WebSocket 链可用，之后连接存活但音频路径停滞，不是持续、均匀的低速发送。PktMon 因拒绝访问无法抓包，本轮没有 TCP ACK/window 证据；没有固件代码、构建或刷写。

该测试后的 fresh status receiver 两次都只 accepted，分别约 `1,465.551 ms / 1,556.397 ms` 后 code `1006`，没有 hello、未认证，也没有 status counters。这表明同一常驻 TX 路径在前一连接停滞后，重连也未自动恢复。

#### Task 22/23：partial send 源码闭环与原始 TCP 观察

官方/IDF 定向 review 确认：`WebSocket::Send` 先组装完整 WebSocket frame，`EspTcp::Send` 再循环调用底层 send。启用 `SO_SNDTIMEO` 时，底层可能先部分写入，再在后续零进展时返回 EAGAIN；上层只得到 false，不知道已经写入多少字节。因此“Send false 后 drop 逻辑帧但保留 TCP”在协议上确定不安全，可能让后续帧接到残帧之后。官方路径不设置短 send timeout，不会在一条 WebSocket 消息中间主动 drop。

Task 23 首次纯 PC raw observer 脚本 syntax 通过，但配合同固件 JTAG `reset run` 时出现 cache error，`30 s` 内零连接、ping `0/4`，属于无效采集。仅执行 `reset halt; resume` 恢复；约 `8 s` 后首个 ping 超时、后续 `4/4` 成功，未刷写。第二次 JTAG reset + status 同样被 cache error 污染，采集无效；恢复后 ping `5/5`。

随后有效 raw observer 收到 hello `264 bytes` 与 `38` 个完整 WebSocket 音频帧，音频 raw 约 `6,397 bytes`、总计 `6,661 bytes`；最后 payload 到达 `2.264 s`，此后直到 `28.5 s` 没有任何新 TCP payload。final `frames=38 / gaps=0 / decodeErrors=0`。最后一帧是完整 frame，之后 raw 为 `0`，所以该窗口**没有实证发生 partial 残帧**。`TCP_SND_BUF_DEFAULT=5,760` 是当前可排队预算，ACK 会释放空间，不是连接生命周期累计上限；PktMon 无管理员权限，仍没有 ACK/window 抓包，不能确认 ACK 未释放或窗口未推进。TCPIP task priority `18` 高于相关任务 `5/4`，任务优先级也不能解释 ACK 被永久饿死。

测试结束后，同一 Node 进程留下 `2` 条来自设备的 TCP Established 连接，但都没有完成 WebSocket upgrade。源码确定 `WebSocket::Connect` 的三个握手失败出口不会即时调用 Disconnect，失败资源至少滞留到局部 `shared_ptr/unique_ptr` 析构；但 `EspTcp` 析构会执行 Disconnect。现有两条 Established 缺少连接年龄与 owner 析构证据，**不足以称为永久 socket 泄漏**。恢复后的有效 status probe 只收到 hello `264 bytes`，`19.25 s` 内音频 `0` 帧，request `1` 超时。

当前分级结论：原始 TCP 已确认音频 payload 先短时连续、后完全停止；握手失败出口不即时 Disconnect 是确认事实，但永久泄漏未证实；partial-write 后 drop 逻辑帧在协议上确定不安全，但本次 raw 窗口最后一帧完整，未实证现场出现残帧。researcher 给出的首版最小修复建议为三项：任何 Send 失败都 Abort/reconnect；在发送握手 GET 前安装 callback 并清 event；所有 handshake 失败出口即时 Disconnect。本轮没有实现、固件写入、音质或 Codex Voice 验收。

#### Task 24：首版可恢复 WebSocket 生命周期离线候选

实现三项最小修复：`wifi_tx` 任意 Send false 都执行 Abort/reconnect，不再对 EAGAIN drop 后复用同一 TCP；`WebSocket::Connect` 在发送握手 GET 前清理握手状态并安装 `OnStream/OnDisconnected`；握手 request send 失败、non-101 响应和 `10 s` timeout 均即时 Disconnect，析构时只要 `tcp_` 存在也执行 Disconnect。

新增可重放 patch `firmware/patches/esp-ml307-wifi-audio-websocket-lifecycle.patch` 并纳入 CMake，reverse apply check 通过。首次 `ninja` 因新 shell 缺 `IDF_PATH` 在 CMake 阶段失败，是环境问题、没有代码编译诊断；加载 ESP-IDF `5.5.5` 后完整构建 `112.2 s` 成功。

最终门禁：固件 `78/78`，Dock `npm test 42/42`、`npm run check`、patch reverse-check 全部通过。镜像长度 `3,993,280 bytes / 0x3CEEC0`，partition `0x4F0000`，free `0x121140`、约 `23%`；SHA-256 `822F743B591FE7EE09A07583F2297D49100C9F8B11D47541BDFA57CD0521ED95`，checksum `04` 有效，validation hash `1992b5071079504378533b60989a8a8b2ab25a6ccef1a264c0e2d487dfd209f8` 有效。flash pin 已更新。

**Task 24 尚未执行硬件 preflight、刷写、实机 transport、录音音质或 Codex Voice 验收。离线候选只保证失败路径可恢复，不得登记为发送停滞已经修复。**

#### Task 25：822F 候选 JTAG 写入与中间态恢复

preflight 确认候选 Length `3,993,280`、SHA-256 pin `822F743B591FE7EE09A07583F2297D49100C9F8B11D47541BDFA57CD0521ED95` 匹配；完整备份 Length `5,177,344`、SHA `5708...C2ED` 与 sidecar 一致；TCP `8765` free，MI_02 JTAG 正常。

第一次从运行态执行 `program_esp`：识别目标 MAC/JTAG 后出现 cache error，检测 existing mismatch，擦除对齐范围 `3,993,600 bytes` 仅耗时 `57.619 ms`，随后 algorithm stopped，transfer `0 / 3,993,600`、exit `1`。该时点 app 候选范围处于不完整中间态。

未修改镜像或参数；立即在同一 OpenOCD 会话先执行 `init; reset halt; sleep 500` 进入 ROM halt，再以同一镜像、同一地址 program。第二次识别 flash `16 MiB`，erase `5,239.88 ms`，transfer `35,763.5 ms @ 109.05 KiB/s`，write `36,009.5 ms`，total `44,105 ms`；verify `2,245.74 ms`，`Verify OK`，reset、exit `0`。

本轮仅处理 app `0x20000` 镜像范围，其他分区未触碰；旧完整备份仍有效。**写入与 verify 成功不等于启动稳定性、transport、音质或 Codex Voice 已通过。**

#### Task 25：822F 启动与 65 秒 transport gate

写入后等待 `8 s`，设备 ping `5/5`，USB 三个接口均正常，基础启动门禁通过。transport 原始日志为 `.claw/runtime/bare-receiver-task25-transport.out.log` 与对应 `.err`。

首连接 hello `69.479 ms`、claim `72.787 ms`，只收到 seq `1..10` 连续 Opus frame，每帧 `143 bytes`，最后一帧 sinceAuth `669.081 ms`。在 `5 s get_status` 窗口附近，连接于 `5,153.926 ms` 以 code `1006` 关闭，status 报 Dock disconnected。这说明 Send 失败后的 Abort/reconnect 生命周期逻辑生效，没有继续静默保持坏流；但音频发送仍然停止。

随后共有 `6` 次 accepted：其中 `4` 次 app hello 分别约 `5,309.719 / 5,293.285 / 5,211.363 / 5,294.039 ms`，都超过 PC `5 s` 认证窗口后关闭；另 `2` 次约 `0.7 ms` 即关闭。最终统计 `connections=7 / authenticated=1 / rejected=4 / frames=10 / encoded=1,430 bytes / PCM=28,800 bytes / decodeErrors=0 / gaps=0 / raw chunks=15 / raw bytes=2,990`。

`65 s` 门禁应接近 `1,000` 帧，实际仅 `10` 帧，严重失败，不进入试听或 Codex Voice。**Task 24 生命周期修复的恢复行为有效，但底层 send 推进停止和重连 hello 约 `5.3 s` 延迟均未解决；822F 不可记录为可用。**

#### Task 26：PC-only 超时与 ping 时序诊断

本轮没有修改或刷写固件。raw receiver 新增可配置 `handshakeTimeoutMs` 后，在 `10 s` 窗口中观察到：连接 accepted 后 app hello 直到 `10,219.219 ms` 才到达，并在 `10,226.467 ms` 关闭，未认证。原始日志 `.claw/runtime/bare-receiver-task26-counters.out.log`。hello 延迟随 PC handshake timeout 从约 `5 s` 移到约 `10 s`。

第二个 PC-only receiver 每 `100 ms` 发送 WebSocket ping，日志 `.claw/runtime/bare-receiver-task26-ping100.out.log`。`30 s` 最终 `connections=3 / authenticated=0`；第二条连接在约 `10,142.945 ms` 一次收到唯一 raw chunk `810 bytes`，其中包含 `264 bytes` app hello，剩余约 `546 bytes` 与约 `91` 个 masked pong 的大小吻合。此前 raw 为零，聚合 chunk 到达后连接随后按超时关闭。

证据分级：PC 下行 ping 已被设备接收并生成 pong；但设备上行 hello/pong 仍被约 `10 s` 聚合或延迟后一起交付 PC。因此不能把现象写成 `wifi_tx` 任务完全死亡，也不能证明只是 TCP ACK 丢失。官方差异 `SetNoDelay(true)` 已进入只读研究，尚未形成实现、构建、刷写或实机候选。

#### Task 27：重连阶段 GDB 快照边界

raw receiver 运行 `30 s`、handshake timeout `20 s`，不发送 ping/status；日志 `.claw/runtime/bare-receiver-task27-jtag.out.log` / `.err.log`。连接 accepted 后 raw hello `264 bytes` 在 `21,608.989 ms` 才到达，`hello_validated elapsed=20,256.221 ms`，随后立即 code `1006`；第二连接约 `5.33 s` 后关闭。final `authenticated=0 / audio=0`。

第一次 OpenOCD 因启动参数解析失败，无效。第二次有效 OpenOCD PID `11152` 识别 JTAG serial/MAC 一致；GDB 日志 `.claw/runtime/gdb-task27.stdout.log`。快照中 `wifi_audio_tx` 在 `wifi_tx_task:1400` 的 `ulTaskGenericNotifyTake(portMAX)`，`wifi_opus` 等待队列，`wifi_audio` 阻塞 I2S；`wifi_audio_boot` 正处于 `WebSocket::Connect -> EspTcp::Connect -> lwip_connect -> netconn_connect`。因此采样时已经进入重新连接，可排除 TX 任务**当时**卡在 Send/Abort，但不能解释上一连接为什么停滞。

GDB detach 后目标仍 halt，随后 ping 超时属于调试干扰；telnet resume 没有生效。精确停止 PID `11152` 后，通过 `reset halt -> resume -> shutdown` 恢复，ping `5/5`。该窗口不得计入产品重启或稳定性。Task 27 无新固件、构建、刷写、音质或 Codex 测试；下一步需在首批音频出现后更早抓取定点快照。

#### Task 28：Send 入口断点与连续帧反证

两次低扰动 `EspTcp::Send` 入口断点：第一次 `data_size=169 / total=0 / fd=54`，调用者为 `WebSocket::Connect:188`，即 HTTP upgrade；第二次 `data_size=264 / total=0 / fd=54`，调用链为 `wifi_audio_tx -> WebSocket::Send`，即 app hello。断点命令 `.claw/runtime/gdb_task28_first_two_sends.cmd`，日志 `.claw/runtime/gdb-task28.stdout.log` / `.stderr.log`。

同轮 bare receiver `30 s` 日志 `.claw/runtime/bare-receiver-task28.out.log` / `.err.log`：`auth=1`，收到 `474` 个 Opus frame、`encoded=69,417 bytes / PCM=1,365,120 bytes / decode=0 / gaps=0`，持续约 `28.4 s`。这证明 hello 能及时进入 TX，且 822F 能在单次窗口连续工作，推翻“必然在约 10 帧停止”的强结论。`75 s` 与 `45 s` 复测分别见 `bare-receiver-task28-75s.*` 与 `bare-receiver-task28-disconnect.*`。

但 `75 s` 混合门禁仍失败：`connections=6 / auth=2 / frames=269 / decode=0 / gaps=0 / reconnect=1`，多次断连重连。随后 `45 s` 复测 `connections=2 / auth=2 / frames=659 / decode=0 / gaps=0 / reconnect=1`；第一连接在 `18.561 s` 断开，第二连接持续到测试结束。raw 观察到批量补发，因此不能写成稳定实时通过。外部 OpenOCD 的 send-false 断点未命中，但当时已有 GDB 会话，不能作为有效反证。

#### Task 29：PC Close opcode `0x8` 的断开定案

Task 29 改由 GDB 自身设置 `DoDisconnect` 断点，命令 `.claw/runtime/gdb_task29_first_disconnect.cmd`。首连接未收到 hello，PC 约 `29.410 s` 后关闭。多核自动命令失效，但 CPU1 保留现场；清理实际子 GDB PID 后，snapshot2 成功。snapshot 命令 `.claw/runtime/gdb_task29_snapshot.cmd`，日志 `.claw/runtime/gdb-task29-snapshot2.stdout.log` / `.stderr.log` 与 `.claw/runtime/bare-receiver-task29.out.log` / `.err.log`。

决定性调用链为 `tcp_receive -> EspTcp::ReceiveTask:212 -> WebSocket::OnTcpData:446 (opcode 0x8) -> WebSocket::Abort:289 -> EspTcp::Disconnect:97 -> DoDisconnect:100`。同期 `wifi_audio_tx` 位于 `ulTaskNotifyTake` 等待空队列。因此该次断开由 PC WebSocket Close frame 触发，是 hello timeout 清理类，不是 Send failure 或 Wi-Fi 掉线。

该证据只解释本次未认证连接，不能外推到已认证连接约 `18 s` 的断开；仍需 PC close/end instrumentation。JTAG/GDB 多核无效尝试不构成证据，且本节点恢复仍待完成。

#### Task 30：PC hello timeout 与后续 ECONNRESET

诊断脚本 `.claw/runtime/bare_receiver_raw_task23.mjs` 仅增加 monkey patch：记录 `socket.close` 的 code/reason/stack/time，并记录 TCP end/error/close；`node --check` 通过。`60 s` 日志 `.claw/runtime/bare-receiver-task30.out.log` / `.err.log`。

连接 accepted 后，PC 在 `11,228 ms` 由 `wifi-audio-receiver.mjs:303` 显式执行 `close(1008, "hello timeout")`；到 `20,468 ms` 底层才报告 `ECONNRESET / hadError=true`。连接 close elapsed `19.247 s`，未认证，`frames=0 / raw=0`。无 DTR/RTS 的 `COM7` 串口读取为空，没有设备重启证据。

因此本次顺序已确认是 PC hello timeout 主动发 Close，之后才出现 ECONNRESET；不能把 ECONNRESET 写成最初断开原因或设备 reboot。

#### Task 31：官方同步 hello、全发送屏障与原子 ready commit

新增同步 hello/ready 合同在实现前按预期红灯。第一版在 `Connect` 成功后由 bootstrap 直接发送 hello，`OnData` 仍直接 `set_ready`，合同达到 `59/59`。刷写前复审发现 P1：control queue 或触摸事件可在 hello 阶段并发 Send；P2：codec 初始化后断连可能产生假 ready，且 audio task 启动失败后仍可能 ready。该中间镜像立即作废。

第二版增加 `s_dock_ready_generation`：`OnData` 只存 generation；`wifi_tx` 在未 ready 时不消费，并在 transmit 前执行第二次 generation gate；`set_ready(true)` 后 notify；audio/speaker task 失败均 fail-closed；bootstrap 最多 `10 s` 等待同代 ready；JSON 字段逐项 fail-closed。发送全屏障合同 `60/60`，复审确认 P1 关闭，但发现 `ready` 复核与 `set_ready` 分离的 TOCTOU P2，因此该镜像也作废。

最终版新增 `commit_ready_for_socket`，在同一个 `s_socket_mutex` 临界区内同时检查 expected/current socket、socket generation、ready generation 与 `IsConnected`，并原子执行 `set_ready(true)`。最终 bounded review 无 P0/P1/P2。

最终门禁：firmware `79/79`，Dock `42/42`，`npm check`、`git diff --check`、ESP-IDF `5.5.5` 完整 build/link/partition 通过。第一次构建因 Python `3.11/3.14` 环境不匹配失败，是环境门禁、不是代码失败；使用正确环境后成功。

唯一最终候选 `firmware/build-wifi-audio-opus/stack-chan.bin`，Length `3,993,520 bytes / 0x3CEFB0`，partition `0x4F0000`，free `0x121050 / 23%`；SHA-256 `8A39AD6989315CAC2A7E64804672C16468AAE1B596B014671B13C24F9662D8D5`，checksum `33` 有效，validation hash `b3e1c526913a087002479f835fae3774f5a2f1afafa33c231b0c89fa1c384f12` 有效。此前 Task 31 中间镜像未固化身份且已被后续构建覆盖，全部作废、禁止刷写。

**Task 31 最终候选尚未刷写，也未完成实机 transport、音质或 Codex Voice 验收。**

#### Task 32：8A39 写入、基础启动与 transport 失败

写入 preflight 匹配候选 SHA-256 `8A39AD6989315CAC2A7E64804672C16468AAE1B596B014671B13C24F9662D8D5`、Length `3,993,520`；完整备份 `5,177,344 bytes / SHA 5708...C2ED` 与 sidecar 一致；MI_02 JTAG 正常，`8765` free。

OpenOCD `20260424` 以 `10 MHz` 执行 `reset halt; sleep 500`，识别 MAC `44:1B:F6:E2:78:A8`、rev `0.2`。仅写 app `0x20000`：erase 对齐范围 `3,993,600 bytes / 5,256.73 ms`，transfer `35,993.9 ms @ 108.352 KiB/s`，write `36,236.8 ms`，total `44,292 ms`；verify `2,243.54 ms`，`Verify OK`，reset、exit `0`。

基础门禁中，一次 `35` 轮采样和一次并行采样都因 PC 枚举命令超时而没有汇总，标记无效。后续有效检查为 ping `10/10`、延迟 `9-88 ms`，USB composite、JTAG、`COM7` 均正常，基础启动通过。

`75 s` bare receiver：hello `71.617 ms`，claim `72.374 ms`、耗时 `0.693 ms`。首个音频直到 sinceAuth `4,409.691 ms` 才到，随后约 `125 ms` 内突发 seq `1..34`，`decodeErrors=0 / gaps=0`；TCP 在 elapsed `4,605.511 ms` end、code `1006`。`5 s` status 请求失败，报告 transport not open。

此后大约每 `12 s` 出现一次 accepted，但均在 `0.45-0.57 ms` 内 tcpEnd、没有 hello。final `connections=6 / auth=1 / frames=34 / encoded=4,925 bytes / PCM=97,920 bytes / decode=0 / gaps=0 / raw chunks=5 / raw bytes=6,024`。

transport gate 明确失败，不进入试听或 Codex Voice。当前只读研究 `TCP_NODELAY` 的实际生效时机与官方 socket 配置，不再刷写新变量。

#### Task 33：麦克风上行返回会话绑定 UDP 的决策依据

连续 TCP 实验证据反复在约 `4 * MSS = 5,760 bytes` 当前可排队预算附近出现上行停滞、批量交付或超时重连；完全移除 send timeout 的 7F9C 候选又以约 `112 s` 仅 `21` 帧证明“永久阻塞等待”不可用。因此当前路线不再试图用更大 TCP queue、短 timeout 或 Nagle 参数承载实时麦克风上行。

历史 Candidate D 已在同一硬件上证明协议隔离可行：控制与扬声器保留认证 WebSocket，麦克风走 session-bound UDP；首轮实机 `5,000 / 5,000` 帧，sequence gap/drop/reconnect 为零，并持续超过 `9,000` 帧仍为零 gap。该历史只证明 UDP transport，不外推当时 PCM 麦克风音质。

仓内官方 Xiaozhi 还提供 MQTT/UDP 的压缩音频上行路线，与当前 `60 ms` Opus 帧天然匹配。Task 33 因此选择：保持 WebSocket 负责认证、控制和扬声器，把丢包可容忍的 Opus microphone frame 移到与当前认证会话绑定的 UDP；安全性和 ready 证明必须随协议一起完成。

#### Task 34：会话绑定 Opus UDP 当前离线过程

当前实现包含 Dock 会话绑定 UDP、HMAC 校验、ready proof 与最大 `1,200 bytes` 数据报边界。Dock 定向测试 `11/11`，其中包含 `5,000` 帧音频与控制并行门禁；固件合同 `60/60`。

第一次构建命令参数/环境错误，未形成可解释的固件镜像，因此没有镜像身份或功能结论。随后显式使用 `sdkconfig.wifi_audio` 完整构建成功，app 大小 `0x3D0270`，目标分区剩余 `0x11FD90`、约 `23%`。

**Task 34 尚未完成独立 code review、候选 SHA-256 固化、刷写、实机 transport、音质或 Codex Voice 验收；当前尺寸和合同不能登记为可刷候选或功能通过。**

#### Task 34 最终离线收敛与候选固化

独立最终 review 以当前磁盘内容为准，结果 `P0=0 / P1=0`。实现边界确认：hostname 只在 bootstrap 中以 `getaddrinfo(AF_INET)` 解析，并在 generation/session 复核后 commit；ready 严格要求 `protocol == 1`；半双工状态在发送前后双检；wire sequence 仅在真正发送数据报时取号；Python 与 Node 共享同一 fixture。

reviewer 唯一 P2 是 fixture 使用 `32` 字符，不能代表真实 `64` 字符配网 pairing key。fixture 已扩为 `64` 字符并重算跨语言向量，但不记录 pairing key 本体：session key `5f957120...981ec`，proof `cc30a9a4...e4fc`，packet 尾 tag `dc4440...50d2e`。首次 `npm test` 为 `43/44` 红灯，仅因 Node 仍保留旧常量；同步新常量后通过。

最终门禁：Dock `44/44`，`npm check` 通过，firmware `82/82`，`git diff --check` 通过；覆盖 `5,000` 个 UDP 音频帧与控制并发。

ESP-IDF `5.5.5` 使用 `sdkconfig.wifi_audio` 完整构建成功。最终镜像 `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-opus/stack-chan.bin`，Length `3,999,072 bytes / 0x3D0560`，partition free `0x11FAA0 / 23%`；SHA-256 `1048475ED0F22FC36DCCEEC235A06ADBB607F9B88B99057C15FCBC0DB2F64153`，checksum `0x74` 有效，validation hash `ebac462f931b78e79e23a69e939b86e08c9cb4ed542a436c95b23b7bb5641fea` 有效，ELF hash `cc11a4ba...a32b`。flash pin 脚本只更新候选 hash/length。

回滚备份 `backups/wifi-audio-preflash/20260808-022602-ota_0-full.bin` 长度 `5,177,344`，SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED`，与 `.sha256.txt` 一致。

**该最终候选尚未刷写，也未执行实机 transport、录音音质或 Codex Voice 验收；P0/P1 清零、82/82 和完整构建不能写成产品已经修复。**

#### Task 35：104847 候选受保护 JTAG app-only 写入

写入前确认候选 Length `3,999,072`、SHA-256 `1048475ED0F22FC36DCCEEC235A06ADBB607F9B88B99057C15FCBC0DB2F64153`；回滚备份 Length `5,177,344`、SHA-256 `5708...BC2ED` 与 sidecar 一致；TCP `8765` free，MI_02 存在。

OpenOCD `20260424` 以 `10 MHz` 识别 serial/MAC `44:1B:F6:E2:78:A8`、rev `0.2`，先执行 `reset halt; sleep 500`。唯一 program 操作为 `stack-chan.bin @ 0x20000`。检测 existing mismatch 后，erase sector 对齐范围 `4,001,792 bytes / 5,115.37 ms`，transfer `35,929.8 ms @ 108.768 KiB/s`，write `36,189.7 ms`，total `44,117 ms`；verify `2,247.68 ms`，`Verify OK`，reset、exit `0`。

bootloader、partition table、NVS、assets 均未写入。**该节点只证明 app flash 内容写入并校验通过，不等于启动、transport、音质或 Codex Voice 验收通过。**

#### Task 35：UDP `sendto` ENOMEM 决定性硬件证据

clean hard reset 并启动允许通信的 Node 24 Dock 后，hello `96.751 ms`、auth `98.395 ms`；三次 status retry 均超时，UDP 音频为零。

JTAG 活跃会话任务快照确认 bootstrap 已越过 DNS 与 ready commit；`wifi_audio` 正常阻塞于 `i2s_channel_read(1920)`，`wifi_opus` 正在编码，`wifi_audio_tx` 正在为 `SCAU` 包执行 HMAC。因此 DNS、post-ready I2S 切换和 `wifi_audio` 6 KiB 栈不足均被本轮线程证据否证。

同窗 counters：`ready=1 / dock_generation=5 / socket_generation=5 / UDP fd=55 / destination=192.168.0.11:8765 / captured_chunks=6431 / captured=1071 / encoded=1071 / sent=0 / send_failures=1071 / wire_seq=1072 / max_send_us≈1864`。硬件断点命中 `sendto` 返回 `-1`，packet 为 `195/199 bytes`，目的地址正确；从 `wifi_audio_tx` TCB 的 `xTLSBlock._errno` 安全读取到 errno `12 (ENOMEM)`。

ESP-IDF `sockets.c:1689-1693` 与 `LWIP_NETIF_TX_SINGLE_PBUF=1` 的源码闭环证明：`netbuf_alloc` 失败映射为 `ERR_MEM -> ENOMEM`。Windows 原防火墙规则只允许 TCP Private；新增 UDP 规则因 Access Denied 实际未创建，但改用已有 UDP Public 放行的 Node 24 仍同样失败，所以防火墙不是设备 `sendto ENOMEM` 根因。

一次 GDB 直接调用 `__errno` 触发 memory protection，是无效调试动作，不得记为产品故障。下一单变量仅拟启用 `CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y`，从而派生静态 Wi-Fi TX buffer；在该时点尚未实现、构建、刷写或实测。

#### Task 36：静态 Wi-Fi TX buffer 单变量离线候选

实现只在 Wi-Fi Audio defaults 与最终 sdkconfig 增加 `CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y`，并新增对应固件合同。第一次构建命令在当前 cwd 无法找到 `idf.py`，exit `2`，发生在 reconfigure 前，属于环境/命令错误，没有候选结论。改用 ESP-IDF tools 中 `idf.py` 的绝对路径后，reconfigure 与完整 `2,408` 步构建成功。

最终派生配置为 `STATIC_TX_BUFFER=y / TYPE=0 / NUM=16 / CACHE=32`，dynamic TX 不再启用。门禁：firmware `83/83`，Dock `45/45`（包含 `5,000` UDP 帧与控制并发）及 `npm check` 通过。

候选 `stack-chan.bin` Length `3,999,264 bytes / 0x3D0620`，free `0x11F9E0 / 23%`；SHA-256 `A2848B8D1FA357A6B252DA422820782531A9D128A314BB67ED105EBF6F5476FE`，checksum `0x46`，validation hash `fdd0434ead896c8424a84f42036f26200358ca0e1e29d8e9a2bd3ea11cfd5c2a`，ELF SHA `69650EF...936E87F`。flash pin 已更新。

回滚备份 SHA-256 `5708FF...E0BC2ED`、Length `5,177,344`，与 sidecar 匹配。**Task 36 当前仍在独立 review，尚未刷写或执行实机 transport、音质、Codex Voice 验收。**

#### Task 36：A284 候选写入与初始 Listening 内存门禁

四重 preflight 通过后，以 JTAG app-only 将 A284 候选写入 `0x20000`。erase 对齐范围 `4,001,792 bytes / 5,116.16 ms`，transfer `36,096.3 ms @ 108.266 KiB/s`，write `36,363 ms`，total `44,279 ms`；verify `2,249.38 ms`，`Verify OK`，reset、exit `0`。bootloader、partition table、NVS、assets 等其他分区均未触碰。

启动 gate 中，首次联合 shell 被安全层在执行前拒绝；一次伪 PowerShell 绝对路径调用失败；系统 Python 因没有 `pyserial` 在打开串口前失败。这三项都是工具或环境失败，不是产品启动失败。必须同时纠正先前读数：曾把 `Test-Connection` 返回对象数量误记为 ping 成功；系统 `ping` 与 ARP 证明设备当时实际未联网，该“成功”读数撤销。Node 24 Dock 虽已监听，但没有 TCP 连接；使用 IDF Python 的两轮只读串口采集均为 `0 bytes`，没有提供启动日志。

有效 JTAG 线程证据显示 main、Wi-Fi、lwIP 等任务仍在运行；`wifi_audio_boot` 固定停在 `wifi_audio_dock_mvp.cpp:1917`，即 initial Listening 失败后的 `1 s` retry。`CoreS3AudioCodec` 状态为 `transition_failures=96 / last_transition_error=257 (ESP_ERR_NO_MEM) / mode=Idle`，RX、data、input handles 均为 null。Task 36 主开关直接针对上一候选的 lwIP `sendto ENOMEM`，但同时派生 `16` 个静态 Wi-Fi TX buffer、约占 `25.6 KiB`，与新的 initial I2S 内存门禁强相关；由于本轮尚未进入 transport，不能宣称旧 UDP ENOMEM 已经实机消失，具体失败叶节点和唯一因果也仍未确认。

一次 GDB `tbreak` 触发 GDB internal assert，未取得 operation 字符串；一次 OpenOCD breakpoint timeout 也没有有效现场。这两次均为无效取证，不能把失败阶段写死为 `create_rx_channel` 或其他具体操作。当前转入只读后继 review，不再刷写；启动、transport、音质和 Codex Voice 均未通过。

#### Task 37：静态 Wi-Fi TX buffer `16 -> 6` 最终离线候选

独立 review 结论是：静态 Wi-Fi TX buffer 数量仍是当前唯一可信后继变量。`16 -> 8` 可释放约 `12.8 KiB`；Espressif 官方 ESP32-S3 memory-saving 配置使用 `6`，因此该轮最终把 `CONFIG_ESP_WIFI_STATIC_TX_BUFFER_NUM` 改为 `6`。`CACHE=32`、I2S DMA `6 x 240` 与 internal reserve `64 KiB` 均保持不变。

一次测试命令在 `firmware` cwd 错误使用仓库根路径，导致 `ImportError`；失败发生于 reconfigure 前，属于路径/环境错误，不是代码或配置失败。改用正确命令后，定向合同 `64/64`、完整 `2,408` 步构建、固件全量 `83/83`、Dock `45/45` 与 `npm check` 全部通过。

最终 `stack-chan.bin` Length `3,999,264 bytes / 0x3D0620`，partition free `0x11F9E0 / 23%`；SHA-256 `A8360AFF5A8181E822B1B2D5AEC19B9D5BA8877DA644DC2143C4A7B6A1B4FB26`，checksum `0x8E`，validation hash `76e5adb751d5f283f60aa4178849454614b996756c40595936a8f413dd69e5f7`，ELF SHA `E765A558...A46016`。flash pin 已更新；rollback `5708...BC2ED` 及 sidecar 保持一致。

**Task 37 当前只是最终离线候选，尚未刷写或完成启动、initial Listening、UDP transport、音质及 Codex Voice 实机验收。**

#### Task 37：A836 写入与 speaker worker 创建门禁

写前 preflight 匹配 A836 候选、既有完整 rollback 及 JTAG 目标身份。app-only 写入成功：erase 对齐范围 `4,001,792 bytes / 5,120.84 ms`，transfer `36,024.3 ms @ 108.482 KiB/s`，write `36,279.4 ms`，total `44,199 ms`；verify `2,247.78 ms`，`Verify OK`，reset、exit `0`。bootloader、partition table、NVS、assets 等其他分区未写。

有效实机 gate 按“Dock 先监听，再 hard reset”执行；system ping 真实 `3/3`。initial Listening 已越过，hello/auth 在约 `6-110 ms` 内完成。但此后约每 `2 s` 建立一次连接，认证后 `20-170 ms` 即以 code `1006` 关闭，全程收到 `0` 个音频帧，因此 transport gate 失败。

有效 JTAG 线程快照显示 `wifi_audio_boot` 位于 `wifi_audio_dock_mvp.cpp:2104` 的 `connection_tasks_ready=false` 分支；`wifi_audio`、`wifi_audio_tx`、`wifi_audio_cmd`、`wifi_opus` 已存在，而 `wifi_speaker` 不存在。源码在 `2097` 将 speaker queue 与 speaker task 创建合并判断，所以当前只可把失败边界收敛到“speaker queue 或 speaker task 创建”，不能继续细分或宣称已定位具体一个对象。

本轮不得写成已经确认整机 reboot：只读 serial `20 s` 仍为 `0 bytes`；GDB/OpenOCD 针对 Abort、stack、restart 和源码行的断点多次未命中、超时或出现 remote 异常，均属于无效或有扰动的取证。OpenOCD attach 只显示历史 reset cause `3`，不足以证明当前连接循环伴随整机重启。

当前只读 review 转向 speaker queue 与 speaker task stack 的 PSRAM 迁移可行性，不再刷写。启动基础与 initial Listening 已越过，但 speaker worker、UDP transport、音质和 Codex Voice 尚未通过。

#### Task 38：speaker queue/task PSRAM 迁移离线实现

先新增 speaker queue 与 speaker task 必须使用 PSRAM WithCaps API 的合同；实施前定向红灯如预期确认旧代码仍使用普通 API。随后两处均改为 WithCaps，并在实现中明确 cache-disabled 期间不能访问外部 RAM，以及分配对象必须使用对应专用删除 API 的约束。

首次固件全量 `83` 项中只有 `1` 项失败：旧 speaker downlink 合同仍硬编码要求普通 `xQueueCreate`。仅更新这条已陈旧断言以匹配新的 WithCaps 所有权契约后，firmware `83/83`、Dock `45/45`（包含 `5,000` 帧并发门禁）与 `npm check` 全部通过。

独立源码 review 结果为 `P0=0 / P1=0`；review 指出的旧测试 P1 已由上述断言更新和全量绿色门禁关闭。**本节点尚未完成 ESP-IDF 完整构建、候选哈希固化、刷写或实机复测，因此不能宣称 speaker worker 创建或 UDP transport 已修复。**

随后执行 ESP-IDF 构建。第一次 `ninja` 因 PATH 缺少 ccache，在源码编译开始前失败，属于环境错误；补入同一 IDF 自带的 ccache 路径后原样继续，最终 `9/9` 成功。bootloader 剩余 `0x2330`。

最终 app 为 `3,999,216 bytes / 0x3D05F0`，partition `0x4F0000`，free `0x11FA10 / 23%`。BIN SHA-256 `A7CF1745519919F67B4AC04BD1F5E053FDF3C48E935C45F49261C87DD1B6EF52`；checksum `0x37` valid，validation hash `ffae3062cda9ae4ac7c235cb9df92eecfc3685fa3caee9c5513d9446a2b0e383` valid；ELF SHA-256 `7A3EBFCC166DA2C9D360428E65B4343039918B3EF6A07A16F468C501E8D26DA5`。flash pin 仅更新候选长度和哈希。

**Task 38 现已形成可追溯离线镜像，但仍未刷写或执行 speaker worker、UDP transport、音质及 Codex Voice 实机验收。**

#### Task 39：A7CF 候选受保护 JTAG app-only 写入

preflight 确认 candidate SHA-256 `A7CF1745519919F67B4AC04BD1F5E053FDF3C48E935C45F49261C87DD1B6EF52`、Length `3,999,216`；rollback SHA-256 `5708...BC2ED`、Length `5,177,344` 与 `.sha256.txt` 一致。USB JTAG/serial debug unit 唯一且正常，`8765`、Dock、OpenOCD、GDB 均无占用。

OpenOCD 以 `10 MHz` 识别 serial/MAC `44:1B:F6:E2:78:A8`、rev `0.2`，仅向 `0x20000` 写 app。erase 对齐范围 `4,001,792 bytes / 5,125.94 ms`，transfer `36,168.3 ms @ 108.05 KiB/s`，write `36,445.5 ms`，total `44,366 ms`；verify `2,249.16 ms`，`Verify OK`，reset、exit `0`。原始日志：`.claw/runtime/task38-flash.log`。

bootloader、partition table、NVS、assets 等其他分区未写。**该节点只证明候选 app 写入和校验通过；尚未执行 speaker worker、UDP transport、音质或 Codex Voice 验收。**

#### Task 39：5001 帧麦克风 transport 通过，控制面失败

唯一 Dock PID `31348` 接受来自 `192.168.0.8` 的连接：accepted `0.031 ms`，hello `76.822 ms`，authentication claim 于 `78.716 ms` 完成、claim 耗时 `0.805 ms`。一次认证后保持单一 TCP 连接；麦克风 PCM 累计至 `5,001` 帧，encoded `732,614 bytes`，PCM `14,402,880 bytes`，`decodeErrors/gaps/duplicates/outOfOrder/invalid` 全为 `0`，VB-CABLE underflows `0`，设备 ping `2/2`。

因此上一版在 speaker 创建后 `20-170 ms` code `1006`、约 `2 s` 循环连接的问题已不再出现；本轮可以只判定麦克风 transport 数据面通过。

控制面仍独立失败：连接初期 request `3` 与 `5,000` 帧后的 request `4` 都在 `1,500 ms` 超时。因此完整门禁未通过，本轮不进入试听或 Codex Voice。测试后精确确认并停止 PID `31348`，TCP `8765` 已释放。日志为 `.claw/runtime/task39-dock.stdout.log` 与 `.claw/runtime/task39-dock.stderr.log`。

#### Task 40：PC 控制帧上限根因与 Dock-only 修复

第一次诊断因新终端未继承密钥而在连接前退出，属于无效采集。随后从 Windows DPAPI 安全加载，过程未打印或记录密钥。A7CF 固件上运行 `.claw/runtime/task40-control-probe.mjs --status-only`，日志 `.claw/runtime/task40-parser-limit-confirm.log`：hello `14.361 ms`、claim `15.120 ms / 0.657 ms`；请求后明确报 `transport_protocol_error: frame exceeds 1024 bytes`，get_status request `1` 于 `1,509.043 ms` 超时。同期 `92` 个麦克风帧全部 clean。

结合先前 JTAG 实测 status 响应 `1,172 bytes`、设备 enqueue 成功且 `WebSocket::Send=true`，根因闭环为 PC shared `parseFrame` 的 `1,024` 上限与 Wi-Fi control/WebSocket `1,500` 上限不一致，不是硬件或固件发送失败。

红灯覆盖默认 parser `1024/1025`，以及 Wi-Fi 的真实 `1172`、`1500/1501` 和 UTF-8 精确边界；共享 USB 边界通过，而 receiver 对真实 `1172` 仍超时。实现只给 `protocol.mjs::parseFrame` 增加经正安全整数校验的可选 `maxFrameBytes`，并只在 `WifiDockTransport.receive` 传入 `WIFI_AUDIO_CONTROL_BYTES=1500`；`encodeRequest` 与 USB/CDC transport 默认 `1024` 不变。定向 `2/2`、Dock 全量 `46/46`、`npm check` 通过。

实机日志 `.claw/runtime/task40-control-fixed-hardware.log`：hello `6.211 ms`、auth `6.946 ms`、claim `0.649 ms`，同一连接三次 get_status 分别 `38.976 / 28.711 / 82.970 ms` 成功；状态均为 Listening，transition/read/send/queue/encode failures/drops 全 `0`，另有 `81` 个 clean mic 帧。独立 review 对当前 diff 给出 `P0/P1/P2=0`，确认测试不是伪绿。新观察 `stack_free_words.mic=256` 仅登记为后续生产风险，不是本次失败。全程无固件刷写。

#### Task 41：半双工扬声器门禁失败与恢复诊断

R1 日志 `.claw/runtime/task41-half-duplex-gate.log`：连接及初始 mic 正常，但脚本在发送前错误断言 set_talking 精简响应中应存在 `speaker_active`，因此提前退出、speaker `0` 帧；这是无效测试，不是产品失败。

R2 `.claw/runtime/task41-half-duplex-gate-r2.log` 使用真实 `24 kHz mono s16` 语音 `501,576 bytes / 1,045` 个 `10 ms` 帧。hello `12.872 ms`、auth `13.682 ms`；初始 Listening `11` 个 mic 帧且错误/丢帧全 `0`。set_talking true 返回 Speaking，PC 发送 `1,045` 帧，binary send max `0.5447 ms`、`>=20 ms` 为 `0`；播放期间 mic 从 `12` 保持 `12`，证明半双工阻断成立，Speaking/I2S owner 状态正确且 transition failures `0`。但设备 `received=1045 / played=1013 / queue_drops=32 / sequence_gaps=32 / underruns=7 / silence=119`，扬声器 transport 未通过，不试听、不进 Codex。

cleanup set_talking false 返回时 phase 仍为 Speaking；源码定义该请求只记录 reply ended，真正回到 Listening 由 speaker queue 清空并经过 `400 ms` grace 后执行，断连也会调用 false。后续 `.claw/runtime/task41-post-failure-status.log` 中 ping `4/4`，TCP 可建立但 `10 s` 无 hello，最终 code `1006`；只能说明联网和 TCP 可建，不能称崩溃、重启或已恢复 Listening。

决定性 `.claw/runtime/task41-live-gdb.log` 显示 `wifi_audio_boot` 位于 `WebSocket::Connect -> EspTcp::Disconnect -> DoDisconnect(wait=true) -> exit event portMAX`，线程表无 `tcp_receive`；同期 speaker 已非 Speaking、capture 在 Listening，排除 speaker/codec 锁死。源码中 `EspTcp::Connect` 清 bit 后创建任务却忽略返回，`DoDisconnect` 对 null handle 仍先等 `1 s` 后永久等待；因此任务创建失败是最高可信近闭环，但具体 stack/TCB ENOMEM 尚未确认。两次对象字段 GDB 因仅恢复单核而无效，不能用于产品结论；随后用 `.claw/runtime/task41-recovery-reset-run.log` 执行不写 flash 的 reset run，ping `4/4`。

#### Task 42/43：连接生命周期与 speaker generation 离线收敛

独立首轮 review 为 `P0/P1=0`，但发现一个刷写前 P2：speaker queue 的 `20 ms` 阻塞发送可能与 disable/reset 交错，reset 唤醒发送者后旧帧重新入队，且 drop 计数应只在 dequeue 成功时增加。预期红灯后，为 `SpeakerFrame` 与 pipeline 增加 generation；reset 前先失效；immediate、`20 ms`、drop-oldest 的所有成功发送路径都 post-check；consumer 在队头 purge、取帧及 `OutputData` 前复核；drop 只在 dequeue 成功时计数，定向 `2/2` 转绿。

随后 firmware `85/85`、Dock `46/46`（含 `5,000` 帧并发）、`npm check`、gate Node check 及四份 patch reverse-check 通过。首次完整 IDF 构建 `115.8 s` 成功，app `0x3D08E0`、free `0x11F720`；`ESP_ROM_ELF_DIR` 仅为 GDB warning。后续 review 发现 plain-tcp patch 漏掉 `esp_tcp.h` 三项 override header hunk 的 P1；增加预期红灯合同并将 header hunk 折叠进 plain patch 后定向转绿。此前 researcher 引用的独立 lifecycle patch/CMake 顺序是旧快照，不是最终现状。

clean replay 前两次只是脚本路径错误（`LiteralPath` 不展开 `*`；随后遗漏 `git --directory`）。第三次完成全逆序还原和全正序重放；raw hash 的 CRLF/LF 差异经归一化后五文件一致，`CLEAN_PATCH_REPLAY_OK`。最终 review `P0/P1/P2=0`，firmware `85/85`，增量完整构建 `50.2 s / exit 0`。

最终 `firmware/build-wifi-audio-opus/stack-chan.bin` Length `3,999,968 / 0x3D08E0`，SHA-256 `73A2DEBC4B1AEF05FC6C22E6C06FE1E076D65F73AA4FDB373790E238CBB5C0E2`，checksum `0x25`，validation `6d4e...e5a5`，partition free `0x11F720`；ELF Length `70,729,640`、SHA `4E4179...72E5`。flash pin 已更新。该节点尚未 hardware preflight、写入或联合实机验收。

#### Task 44：73A2 候选写入、空闲启动与联合门禁失败

写前清理遗留 task40 GDB PID `20140`，确认唯一 `VID303A/PID1001`、MI_02 JTAG、`COM7`，设备 ping `3/3`，`8765` free，Dock/OpenOCD/GDB 无占用；rollback `5,177,344 / SHA 5708...BC2ED` 与 sidecar 一致，candidate `3,999,968 / SHA 73A2...C0E2`。JTAG `10 MHz` 使用 `.claw/runtime/openocd_task44_flash.cfg`，日志 `.claw/runtime/task44-flash.log`；识别 MAC `44:1B:F6:E2:78:A8`、rev `0.2`，reset halt 后 app-only 写 `0x20000`。sector `4,001,792`，erase `5,121.1 ms`、transfer `36,399.1 ms @ 107.365 KiB/s`、write `36,670.6 ms`、total `44,585 ms`、verify `2,252.34 ms / Verify OK`、reset、exit `0`。启动 `8 s` 后 USB 三接口正常、ping `10/10`、`8765` free；只证明写入和空闲启动。

联合日志 `.claw/runtime/task44-half-duplex-gate.log`：accepted `0.030 ms`、hello `14.878 ms`、claim `15.788 ms`，初始 `11` 帧 clean；但 `360 s` 内未达到 `5,000` 帧而超时，speaker 阶段完全未执行，设备未重启。后续 ping `5/5`（`71-289 ms`），USB 三接口正常。

#### Task 45：5 秒诊断收敛为间歇性设备 UDP 发送失败

日志 `.claw/runtime/task45-post-gate-diagnostic.log`。首连接认证后 `93.839 ms` code `1006`，约 `2 s` 后重连。首次 status 累计值为 `read_success=36084 / read_failures=0 / captured=6013 / encoded=6012 / sent=4982 / send_failures=1030`，queue、encode failures/drops 均为 `0`。

新连接随后 `5 s` 收到 `85` 帧，解码与 gaps/duplicates/out-of-order/invalid 全 `0`；设备计数增至 `captured=6097 / encoded=6096 / sent=5066`，`send_failures` 仍为 `1030`，控制 status 成功，设备在线。因此 Task 44 长 gate 实际已生成约 `6,012` 个编码帧，但约六分之一在设备 UDP `sendto` 调用处失败；该失败不是 mic/I2S、Opus、PC decoder 或整机崩溃，新会话中又未继续增长，属于间歇性设备 UDP 发送失败。当前 errno 尚未确认，speaker 和 Codex Voice 均未验收，候选不可交付；本轮不刷新固件版本。

#### Task 46：UDP `ENOMEM` 有限重试离线候选

研究边界为：Task 45 的失败发生在编码后的 UDP `sendto` 调用处，本轮没有重新取得 errno；历史同一路径曾由硬件断点确认 errno `12 (ENOMEM)`。因此单变量仅针对 `ENOMEM`：同一 packet、sequence 与认证 tag 最多额外重试 `2` 次，每次间隔 `1 tick`；每次重试前重新核对 session、socket、pipeline generation、ready、mic enabled 与非 Speaking，其他 errno 不进入该重试策略。

新增 `send_retries / retry_exhausted / last_send_error` 遥测。先加入预期红灯合同；独立 review 发现 retry 计数可能虚增的 P2 后修正，最终 review 为 `P0/P1/P2=0`。

离线门禁：firmware `86/86`，Dock `46/46`、`npm check`，专用 `ninja` 完整链接 exit `0`。最终 BIN Length `4,000,480 / 0x3D0AE0`，partition free `0x11F520`；SHA-256 `9F07EE...FEC17`，checksum `0xD5`，validation `ba9b...c3f8`。ELF Length `70,733,156`，SHA-256 `E2D9...3C50`。

**Task 46 尚未刷写或进行实机 UDP、speaker、音质和 Codex Voice 验收；离线重试合同不能证明间歇性 ENOMEM 已解决。**

#### Task 47：9F07 候选受保护写入与空闲启动门禁

preflight 确认 USB 三接口正常（含 MI_02 JTAG 与 `COM7`），目标 MAC `44:1B:F6:E2:78:A8`，ping `3/3`，TCP `8765` free；rollback Length `5,177,344`、SHA `5708...BC2ED` 与 sidecar 一致；candidate Length `4,000,480`、SHA `9F07...FEC17`。

OpenOCD `20260424`、`10 MHz` 识别 ESP32-S3 rev `0.2` 并执行 reset halt。唯一写入为 app `0x20000` 镜像范围：sector 对齐处理 `4,001,792 bytes`，erase `5,131.68 ms`，transfer `36,238.6 ms @ 107.841 KiB/s`，write `36,484.7 ms`，total `44,419 ms`；verify `2,249.63 ms`，`Verify OK`，reset、exit `0`。其他分区未写。

启动后 USB 三接口仍正常，ping `10/10`、最大 `72 ms`，`8765` free，空闲启动门禁通过。本轮没有单独 raw log 文件，以上事实来自本轮工具输出。

**Task 47 只完成受保护写入与空闲启动，尚未进行 UDP transport、speaker、音质或 Codex Voice 验收。**

#### Task 48：自动化联合 transport/半双工门禁通过

本节严格来自本轮工具输出，没有独立 raw log 文件。连接时序为 accept `0.030 ms`、hello `21.115 ms`、claim `22.172 ms`；单一连接持续 `312.341 s`。

麦克风 transport：设备 `captured/encoded/sent=5000/5000/5000`，I2S `read=30002 / fail=0`，`send_failures=0 / send_retries=0 / retry_exhausted=0 / last_errno=0`，所有 queue/encode failures 与 drops 均为 `0`。主机收到 `5,000` 个 frame/UDP datagram，`decode/gap/duplicate/out-of-order/invalid/reconnect` 全 `0`。

扬声器使用真实 speech WAV，PCM `501,576 bytes`、peak `30,703`、RMS `2,011`。`1,045` 帧 requested/received/played 全部一致，drop `0`、gap `0`；PC binary send max `0.8086 ms`，slow `0`。播放期间 mic 从 `5,001` 保持 `5,001`，半双工麦克风阻断成立。`silence=35 / underrun=4`，但全部有效语音帧均已播放。

恢复后最终为 Listening，mic 增至 `5,015`，speaker inactive，transition/read failures `0`；连接 `1`、reconnect `0`。运行核分配为 TX/Opus core `0`，mic/speaker core `1`。

**自动化 transport 与半双工门禁通过；本轮仍未进行用户听感或 Codex Voice 验收。由于 `send_retries=0`，只证明有限重试防护没有造成回归，不能宣称实机触发后的 ENOMEM 恢复已经得到验证。**

#### Task 49：Codex Voice 验收环境就绪

正式 Dock PID `14396` 正在监听 TCP `8765`，设备 TCP 已连接；VB-CABLE player PID `8608` 正在运行。Codex root ChatGPT 进程 PID `34536`；process-loopback bridge PID `15784` 捕获该 root 进程音频并输出到 StackChan speaker pipe。

**当前仅完成端到端进程与连接准备，用户尚未启动并完成 Codex Voice 对话，因此不得记录为 Codex Voice 验收通过。**

#### Task 50：人工音质与 Codex Voice 最终门禁失败

用户提供 `D:/Users/chany/Documents/录音/录音 (3).m4a`，明确反馈“仍不清晰、机器人音 + 电流音”；随后确认当前版本与昨晚表现一模一样，Codex 无法响应，录音不通过。原始 M4A 为 `179,798 bytes / 7.00 s / AAC 48 kHz stereo`。

解码与分析产物为 `.claw/runtime/task50-recording-3-48k-stereo.wav` 和 `.claw/runtime/task50-recording-3-analysis`。channel 0：RMS `1,057`、peak `11,337`，speech band `300-3400 Hz = 89.756%`，`0-80 Hz = 0.612%`，mains `2.166%`，digital silence `0`。同期 decode 链日志出现大峰值，但实际 Codex 行为仍不通过。

与 `录音 (2).m4a` 相比，TDM 路径与低频污染已有明显改善；然而用户可懂度和 Codex 最终门禁仍失败。由此正式拒绝 9F07 候选：自动化 transport、频带占比和连续性指标不能替代真实语音可懂度。

下一研究方向为：以已确认清晰的 golden `24 kHz PCM` 为基准，离线验证 lossless `20 ms / 960 bytes` UDP 路径的逐样本等价性。**该方向尚未实现、构建或刷写，也未形成新的实机候选。**

#### Task 51：lossless PCM 红灯基线

新增 Dock golden 逐字节 PCM 合同；由于产品尚未导出 `WIFI_AUDIO_MICROPHONE_PCM_BYTES`，测试按预期失败。固件全量共 `68` 项，仅新增 PCM 合同失败，既有 `67` 项全部通过，因此这是新需求红灯，不是旧功能回归。

独立研究推荐首选 `20 ms / 960 bytes` PCM；唯一 P1 风险是静态 Wi-Fi TX buffer `6` 的配置下，`50 packets/s` 上行是否仍有足够网络余量。

**Task 51 当前仅建立红灯与研究结论，尚未修改产品实现，也没有构建、刷写或实机测试。**

#### Task 52：lossless PCM 实现与完整离线门禁

产品麦克风路径改为 RX4 slot 0 原生 `24 kHz s16le`；每两个 `10 ms` 块聚合为 `20 ms / 960 bytes`，协议 flag `2`，加上会话 HMAC 后 UDP 总包长 `1,012 bytes`。移除 `24 -> 16 kHz` 重采样、Opus 编码/解码、`24 KiB` Opus task 和中间 PCM queue。

golden 合同从 RX4 interleaved 数据抽取 slot 0 并聚合，经 Dock 真实 parser 后逐样本比对；包含显式的尾部 `10 ms` 处理，所有完整样本均相等。

独立 review 首轮发现 `P1=1 / P2=3`，逐项修复后第二轮为 `P0/P1/P2=0`。离线门禁：firmware `68/68`，Dock `47/47`、check、Task 41 脚本语法，以及 ESP-IDF 完整 build 均通过。app 大小 `0x3A8E10`，partition free `0x1471F0`。

**Task 52 尚未固化最终 SHA/hash 身份，也未刷写或进行 transport、用户听感、Codex Voice 实机验收。**

#### Task 53：FF74 PCM 候选写入与间歇性 `ENOMEM` 门禁失败

最终 PCM 候选身份：BIN Length `3,837,456 / 0x3A8E10`，SHA-256 `FF74...DA45C`，checksum `0x2B`，validation `c303...2c94`；ELF SHA `58D5...43B2`。flash pin 已更新。

受保护 preflight 确认旧 rollback `5708...BC2ED` 与 sidecar 一致、MI_02 唯一，并停止旧 Dock。第一次 OpenOCD 仅因日志路径反斜杠解析失败，在连接目标前退出，没有写入。第二次以 `10 MHz` 仅向 app `0x20000` 写入，sector 对齐处理 `3,837,952 bytes`，`Verify OK`、reset、exit `0`；日志 `.claw/runtime/task53-pcm-flash.log`。启动后 USB 三接口正常，ping `10/10`。

自动化门禁约 `113 s` 后失败。PC 已收到 `5,000` 个连续 PCM packet，但设备 counters 为 `captured=5534 / sent=5017 / send_failures=517 / send_retries=1255 / retry_exhausted=517 / last_errno=12 / queue=0 / I2S failures=0`。这证明 lossless PCM 内容与主机连续性不能掩盖设备侧成批 UDP `ENOMEM`；候选不可交付，本轮不进入试听。

随后 `5 s` 诊断收到 `259` 帧，设备失败/重试计数没有继续增长，说明故障表现为间歇性 `ENOMEM` burst，而不是持续每包失败。日志 `.claw/runtime/task53-pcm-half-duplex-gate.log` 与 `.claw/runtime/task53-pcm-post-gate.log`。

**Task 53 的 transport 门禁失败；用户听感与 Codex Voice 均未验收。**

#### Task 54：FF74 PCM 人工分流录音失败

用户重启设备并确认可以录音后，当前 FF74 PCM 候选通过实际 VB-CABLE 录制 `10 s`。原始文件 `.claw/runtime/task54-pcm-user-listen-48k.wav`，格式 `48 kHz mono s16`，大小 `960,044 bytes`；peak 约 `2,162`、RMS `235`，无 clipping，digital silence 约 `0.2%`。

另生成一个只增加 `+18 dB`、不做降噪或其他音质处理的试听副本，用于把音量因素与信号本体分开。

用户已分别试听原始版与仅 `+18 dB` 版，明确确认两者都是机器人声，不是正常录音。因此人工音质门禁失败，FF74 候选正式拒绝；不能把 lossless PCM transport 或频带指标写成 PCM 音质通过。

在 Task 54 当时，间歇性 UDP 丢帧/`ENOMEM` 暂按独立问题处理并暂停 `TX buffer 6 -> 8`，先从 VB-CABLE 上采样前反推 `24 kHz` 样本。该阶段判断随后被 Task 57 的 A/B 与 gaps 时间线修正：Task 55 不可听主因最终确认为严重 UDP gaps。

#### Task 55：pre-VB 原始 `24 kHz` 取证环境就绪

Task 54 两个版本均已由用户判定为机器人声，FF74 保持拒绝。对当前实现与清晰 golden 做静态对照，尚未发现名义 gain、slot、clock 或 packing 差异；当前唯一 P1 证据缺口是 VB-CABLE 上采样前的原始 `24 kHz` 数据。

已停止旧 Dock PID `20884` 与 player PID `23012`；启动取证 Dock PID `24144` 与 player PID `13716`，设备 `192.168.0.8` 的 TCP 已 Established。`STACKCHAN_WIFI_PCM_CAPTURE` 写入 `.claw/runtime/task55-direct-player-input-24k.pcm`，日志目录 `.claw/runtime/task55-dock-logs`。捕获文件持续增长，首帧与第 `500` 帧的 `input_peak` 分别为 `150 / 293`。

**当前只完成取证环境和环境音基线：尚无人声片段，也未进行样本分析；没有刷写或修改产品代码。JTAG 仅保留为 direct 24 kHz 数据仍异常后的后继手段。**

用户回复“说完了”后立即停止 Dock PID `24144` 与 player PID `13716`。原始 pre-VB 文件 `.claw/runtime/task55-direct-player-input-24k.pcm` 长 `1,310,400 bytes = 27.3 s`；日志在首帧及第 `500/1000/1500/2000/2500` 帧的 `input_peak` 分别为 `150/293/371/245/244/2231`，underflows `0`。

按 `0.1 s` RMS 定位，人声活动主要在 `22.8-24.5 s`。生成 `22.5-25.5 s` 的两份试听段：

- `.claw/runtime/task55-listen/task55-direct-pre-vb-24k-raw.wav`：`24 kHz mono s16 / 3 s / peak2231 / RMS147.61 / clipping0`；
- `.claw/runtime/task55-listen/task55-direct-pre-vb-24k-gain18db.wav`：仅 `x8 / +18.06 dB`，`peak17848 / RMS1180.90 / clipping0`。

这两份文件直接来自 pre-VB `24 kHz` PCM，绕过 VB-CABLE，不含重采样、降噪或其他处理。用户试听 raw 与仅 x8 版本后明确反馈“无法听清”，因此 Task 55 当轮人工音质门禁失败。

后续 Task 57 的清晰 MIC1 A/B 样本推翻了“固定 I2S/ES7210 失真或错麦”的推断。回查 Task 55 stdout：frame `1` 时 gaps `0`，frame `501` 时 gaps `2508`，frame `1001` 时 gaps `8023`；用户实际说了约 `5-10 s`，落盘却只有约 `1.5 s` 活动，符合严重间歇性 UDP 丢帧导致的时间压缩。故 Task 55 不可听的主因现收敛为 UDP gaps；VB-CABLE/上采样并非主因，I2S 固定失真结论作废。

#### Task 56：raw4/麦克风通道只读取证

用户指出历史同类机器人/电流音曾由使用错误麦克风引起。精确历史结论是：当时 raw 逻辑 index `1` 实际取到 ES7210 slot1，即 MIC3/AEC，却被误认为 MIC2；错误不是 slot0/MIC1。当前配置为 `CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC=0`，代码映射 `0 -> slot0`、`1 -> slot2`，且 JTAG 已证实 mono 逐样本等于 raw slot0，因此当前没有重复历史同一错误。历史 golden 中 slot0 MIC1 与 slot2 MIC2 均有信号，但后续用户纠正该 golden WAV 的刺激实际为敲击声，因此把它当作人声对照的轮次无效，不能据此得出当前人声通道结论。

有效 JTAG 取证使用 reset-halt 与 hardware breakpoint，在 `wifi_audio_dock_mvp.cpp:1698` 取得 `.claw/runtime/task56-raw4-one-frame.pcm`：raw4 `1,920 bytes`，slot0/mono copy `480 bytes`。原始 slot0 序列与 mono 逐样本完全相同，排除 slot 抽取与 UDP 前 mono copy 本身出错。对象状态为 input `24 kHz / 4 channels / gain30 / Listening / read_success1 / read_fail0`。

环境单帧四槽 peak 约为 `slot0/1/2/3 = 136/28/104/14`；后续单帧同样显示 slot0 与 slot2 同量级、slot1 与 slot3 较低。该结果只描述环境帧能量，不等于人声通道已确认。

随后生成受控 TTS `.claw/runtime/task56-reference-human-voice.wav`，Microsoft Huihui、`22.05 kHz mono s16 / 49.655 s`、固定句子。JTAG 多帧采集因 FreeRTOS/GDB `thread exited` 只保存了 `1` 帧，不能写成 `50` 帧；该 TTS 单帧 slot0/slot2 peak `141/146`、RMS `63.4/68.0`，仅属弱证据。尝试通过 GDB 调用读取 ES7210 寄存器时发生线程/内部错误，没有取得任何有效寄存器值，必须标为无效。

**Task 56 没有刷写或修改产品代码；诊断脚本与日志保留。当前只确认 slot0 抽取/copy 逐样本正确，尚未确认真实人声应选 slot0 还是 slot2，也没有新的音质结论。**

#### Task 57：固定标准人声的首次 Listening A 样本

经用户同意，生成固定标准人声 `.claw/runtime/task56-reference-human-voice.wav`：Microsoft Huihui Desktop、中文固定句重复 `5` 次、`22,050 Hz mono s16 / 49.6553 s`，Length `2,189,846 bytes`，SHA-256 `E9701CC18A6E3D1A9B384A291F311153FCA4ABCF8B473515ACA3D73B728A4FD0`。

当前固件不刷写。启动 Dock PID `29184` 与 player PID `3240`，direct capture 为 `.claw/runtime/task57-generated-voice-initial-listening-24k.pcm`。JTAG 后使用 reset-halt-resume 恢复，设备 ping `2/2` 且 TCP Established。保持首次 Listening、禁止进入 Speaking 时播放标准人声 `15.865 s`；capture 字节窗口 `3,276,000..4,062,240`（时间 `68.25..84.63 s`），新增 `786,240 bytes / 16.38 s`。日志第 `5000/5500/6000` 帧等出现声学响应，窗口实测 peak `1,862`、RMS `136.56`、clipping `0`。

试听文件：`.claw/runtime/task57-analysis/task57-initial-listening-generated-voice-capture-24k.wav`，以及仅 `x4 / +12.04 dB` 版本。分析 `.claw/runtime/task57-analysis/waveform/waveform-analysis.json`：`adjacent_equal=2.0676% / digital_silence=0 / speech300-3400=80.119% / low0-80=2.251% / mains=1.937% / flatness=0.02278 / highbyte=16`。

用户试听 Task 57 第二份 pre-VB MIC1 `+12.04 dB` 版本后明确确认可以听清，并认为波形已可明显判断为高质量；因此首次 Listening A 的人工音质门禁通过。

质量对比 `.claw/runtime/task57-quality-comparison/waveform-analysis.json`：Task 55 失败片段 `speech=32.5% / low=10.221% / mains=7.929% / flatness=0.03225`；Task 57 A 为 `speech=80.119% / low=2.251% / mains=1.937% / flatness=0.02278`。由于内容和距离不同，这些数值只作相对证据，不固化为绝对质量阈值。

随后通过 speaker pipe 以 gain `4` 发送 `.claw/runtime/task57-analysis/task57-transition-speaker-voice-3s.wav`；设备 `received/played=300/300`，drops/gaps/underruns 全 `0`，完成一次 Speaking -> Listening。对同一外部 TTS 截取 B 窗口 bytes `54,119,520..54,905,760`（`1127.49..1143.87 s`），生成 post-speaking raw 与 `+12 dB` 版本。

A/B 分析 `.claw/runtime/task57-ab-comparison/waveform-analysis.json`：RMS `136.56/136.15`，speech `80.119/81.006%`，low `2.251/2.289%`，mains `1.937/1.909%`，adjacent equal `2.068/2.198%`，digital silence 均 `0`，flatness `0.02278/0.02227`。A/B 客观等价，排除一次 mode transition 导致固定退化。

Task 57 当前长窗至 frame `55001` 只有 gaps `2`，进一步说明丢帧为间歇性 burst。正式结论：当前不是错麦或固定 I2S 失真，Task 55 不可听主因是严重 UDP gaps。该节点恢复此前暂停的 `TX buffer 6 -> 8` 单变量研究；当时尚未实现、构建或刷写，后续实现与构建见 Task 58。

#### Task 58：固定 TTS 音质 PASS 与 TX buffer `6 -> 8` 离线候选

用户正式确认 Task 57 第二份 `+12 dB` pre-VB MIC1 固定 TTS 可以听清，波形指标与用户判断一致，因此该固定 TTS 音质门禁记为 **PASS**。Task 55 的机器人声已由 gaps `0 -> 2508 -> 8023`、用户说话 `5-10 s` 但落盘只有约 `1.5 s` 活动闭环为严重丢帧与时间压缩。

实现只把 `CONFIG_ESP_WIFI_STATIC_TX_BUFFER_NUM` 从 `6` 改为 `8`，同步 wifi_audio sdkconfig defaults、live sdkconfig 与合同断言；音频、TDM、PCM、半双工和 Dock 均未修改。

离线门禁：firmware unittest discover `87/87`；ESP-IDF `5.5.5` 完整 `2,408` 步构建成功，build sdkconfig 确认 TX buffer `8`。最终 bin Length `3,837,472 / 0x3A8E20`，partition free `0x1471E0`；BIN SHA-256 `13AD1C62513A0931F3BF5F56FA211C5CA72F1BAC885A5ACF2B17AC72D7DC5F7E`，checksum `0x85` valid，validation hash `6b78e0a022de968651e9e7b913ad55d2d126ca2fe8dac35165e7cd28191fbfcd`；ELF SHA-256 `7089C3070A85BD8DE83BFBDA35D2EA968FC852A0ECF08D62659CA0F0815E2C33`。flash pin 已更新到新长度和哈希。

**Task 58 离线构建后完成独立 review，但尚未刷写或执行实机连续性、用户真人语音与 Codex Voice 验收；不得记录为 UDP 丢帧已经修复。**

独立只读 review 对已证缺陷的分级为 `P0=0 / P1=0`。TX8 的 internal/DMA 余量是待实机关闭的门禁，不是 P1，也不是代码或配置错误。ESP-IDF `5.5.5` Kconfig 说明每个 static Wi-Fi TX buffer 约占 `1.6 KiB`，`6 -> 8` 增加约 `3.2 KiB` 常驻 DMA/internal 内存。历史 TX16 曾使 initial Listening 返回 `ESP_ERR_NO_MEM`；TX8 虽比 TX16 少约 `12.8 KiB`，离线构建仍不能证明 I2S 与 worker 重建余量充足。

有效配置锚点为 `defaults:7 / sdkconfig:2061 / generated sdkconfig.h:830-833`，均确认 `static / type0 / TX8 / cache32`。音频源码未变，RX-only TDM `4 x 16`、`capture0 -> slot0 MIC1`、`20 ms / 960 bytes` PCM 均保持。

构建对象时间序不存在陈旧混用：`sdkconfig.h 23:54:21 -> cores3 object 23:56:46 -> wifi_audio object 23:57:05 -> libmain 23:57:12 -> ELF/bin 23:57:58/23:57:59`。

该候选允许进入一次实机验证，但顺序必须是：先确认 initial Listening，以及 Speaking <-> Listening 后 `transition_failures=0 / last_error=0`；只有内存与重建门禁通过后，才判断 UDP failures/gaps。

回滚备份 `backups/wifi-audio-preflash/20260808-022602-ota_0-full.bin` 已重新回读确认：Length `5,177,344`，SHA-256 `5708...BC2ED`，与 sidecar 一致。

#### Task 59：13AD TX8 候选受保护 JTAG app-only 写入

preflight 匹配 candidate `3,837,472 bytes / SHA-256 13AD...C5F7E`，rollback `5,177,344 / SHA 5708...C2ED` 与 sidecar 已回读一致。MI_02 识别 serial/MAC `44:1B:F6:E2:78:A8`、ESP32-S3 rev `0.2`，JTAG `10 MHz`。

唯一 program 操作为 `program_esp` offset `0x20000`。检测 existing mismatch 后，erase 对齐范围 `3,837,952 bytes / 5.0055 s`，transfer `34.6495 s`，write `34.9137 s`，program 总计 `42.615 s`；verify `2.15884 s`，`Verify OK`，reset、exit `0`。

最初一次 reset halt 出现 timeout/cache error，但 `program_esp` 内部重新 reset halt 后完整写入并校验成功，因此不能记为写入失败。bootloader、partition table、NVS、assets 等其他分区未写。

**Task 59 仅证明 app 写入与 verify 通过；启动、TX8 内存门禁、transport、音质和 Codex Voice 均尚未验收。**

#### Task 60：TX8 自动 transport 与单次半双工实机门禁通过

写入后基础启动：ping `10/10`，min `9 ms`、max `68 ms`；USB composite、JTAG、`COM7` 均正常。旧 Task57 Dock 曾自动回连；随后精确停止旧 PID `29184` 及 child `3240`，再启动 fresh Dock PID `26236`。

fresh 连接 hello `12.645 ms`、auth 约 `14 ms`。初始 status 为 Listening，`transition_failures=0 / last_error=0`，UDP `send_failures/retries/exhausted` 均为 `0`。主机收到 `5,003` 帧，`gaps/duplicate/out-of-order/invalid/reconnect=0`；设备累计 `captured=12363 / sent=12363 / queue_drops=0 / send_failures=0 / retries=0 / exhausted=0 / last_error=0`；VB underflows `0`。

随后用 `.claw/runtime/task57-analysis/task57-transition-speaker-voice-3s.wav` 发送真实语音 `300` 帧：speaker pipe `300/300`，设备 `received=300 / played=299 / underruns=0 / sequence_gaps=0`。播放后麦克风恢复，主机累计约 `7,501` 帧仍为 gaps `0`。因此 TX8 自动 transport 与单次 Speaking -> Listening 半双工门禁通过。

一次准备 TX8 TTS capture 时误用 IDF Python，因缺少 numpy 而生成 `0 bytes` 文件；该文件已删除，属于工具环境失败，不是产品失败。本轮没有形成新的 TX8 试听文件。

之后 Codex MCP Dock PID `31556` 自动占用 `8765` 并建立连接，但没有进行 Codex Voice 对话，不能记为 Codex Voice 通过。**原间歇 UDP burst 仅在本窗口未复现；最终真人语音、新 TX8 人耳听感与 Codex Voice 仍待用户验收。**

#### 产品目标修订与 Task 61：13AD 独立 flash verify

用户明确修订产品目标：机器人通过 Wi-Fi 作为 Codex Voice 的麦克风和扬声器，PC 可通过 Dock/MCP 控制机器人表情与动作，正常使用不依赖 USB。Opus 或固定帧数不再是产品目标；当前 PCM 格式与各类帧计数只属于实现选择和内部验收门禁。

独立 verify 过程保留两次无效 OpenOCD 尝试。第一次 `verify_image` 返回 `not implemented`，未写 flash，并立即 resume 恢复目标。第二次 `flash verify_bank` 因 flash map/algorithm stop 读到伪 `0` 而失败，同样没有写入并再次恢复；这两次都不能记录为镜像不匹配。

随后使用官方 esptool `4.12.0`，通过 `COM7` 识别 ESP32-S3 rev `0.2`、MAC `44:1b:f6:e2:78:a8`，对 `0x20000`、Length `0x3A8E20 / 3,837,472` 执行 `verify_flash`。现场 flash 与 13AD 镜像 digest matched、`verify OK`，hard reset、exit `0`；这是独立只读 verify，没有写 flash。

复位后 ping `10/10`，USB 三接口正常，MCP Dock PID `31556` 重新 Established。**Task 61 只关闭当前 app 镜像的安全基线；产品场景中的 Codex Voice 双向语音、PC 表情/动作控制和拔除 USB 后运行仍待验收。**

#### Task 62：产品 Wi-Fi 麦克风与扬声器技术链打通

产品目标继续按用户场景定义，技术计数仅作内部门禁。当前 13AD/TX8 + MCP Dock 通过 VB-CABLE 录制固定 TTS，端到端路径为：PC 显示器扬声器 -> 机器人 MIC1 -> Wi-Fi PCM -> Dock -> VB-CABLE。

原始录音 `.claw/runtime/task62-tx8-vb-generated-voice.wav`：`20 s / 48 kHz mono s16 / Length 1,920,044`，SHA `1F44...E4FCE`。仅增加 `+12 dB` 的试听副本 `.claw/runtime/task62-tx8-vb-generated-voice-gain12db.wav`，Length 相同，SHA `5F13...49D30`，`960,000` samples，clipped `0`。

raw 客观指标：peak `1,972.32`、RMS `103.89`、speech `300-3400 Hz = 74.82%`、low `0-80 Hz = 1.40%`、mains `2.34%`、digital silence `0`、clipping `0`。分析 JSON 与 plot 位于 `.claw/runtime/task62-tx8-analysis/`。

结合 Task 60 的真实语音扬声器门禁——pipe `300/300`、设备 `played=299`、underrun/gap `0`，播放后麦克风恢复且累计约 `7,501` 帧 gaps `0`——可以判定 Wi-Fi 麦克风与喇叭技术链已打通。

用户后续试听 Task 62 文件并判定失败，因此 Task 62 人工音质为 **FAIL**。Task57 通过件是 pre-VB `24 kHz`，Task62 是 post-VB `48 kHz`，两者边界不同，不能直接等同；上述技术链连通证据仍成立，但不代表音质通过。Codex Voice、MCP 表情控制和拔除 USB 后运行仍待产品验收。

#### Task 63：PC -> MCP -> Dock -> Wi-Fi 表情命令链通过

先停止旧 Codex MCP PID `31556`、parent `23696` 与 player `34188`。随后使用真实 MCP stdio client 启动同一 `wifi-audio-dock`。初次 `get_status` 返回 `connected=true / transport=wifi / device=stackchan-441BF6E278A8 / phase=listening`。

调用 `stackchan_set_expression({happy})` 返回 `{expression: happy}`；再次 `get_status` 仍为 connected/listening，随后 probe 正常 close。由此证明 PC -> MCP -> Dock -> Wi-Fi -> 机器人表情命令链实际通过。

**用户尚未现场确认机器人是否显示 happy 表情，因此协议/命令链通过不等于视觉效果最终验收。**

#### Task 64：当前 Wi-Fi 输入输出连续性客观验收失败

按用户要求先验收当前 Wi-Fi 输入输出。标准 Dock PID `9976` fresh 连接：hello `10.177 ms`、auth `11.585 ms`。初始设备累计 counters 为 `captured=27391 / sent=24863 / send_failures=2528 / retry_exhausted=2528 / last_errno=12 ENOMEM / queue_drops=0`。

fresh host gaps 演进：frame `501 -> 4`，`1001 -> 4`，`1501 -> 4`，`2001 -> 22`。因此 Wi-Fi 输入长期连续性 **FAIL**。先前“Task 62 清晰样本仍有效”的措辞已被用户人工 FAIL 取代；其客观文件与指标可保留，但不能再作为清晰度证据。

真实语音 speaker 请求 `300` 帧，speaker pipe `sent=271 / dropped=29 / maxPending=12`；设备对实际收到的帧 `received=played=271`，`underrun=0 / queueDrops=0 / sequenceGap=0 / backpressure=206`，PC send max latency `323.507 ms`。播放后麦克风恢复，但 host gaps 已为 `22`。因此输出连续性也不能写 PASS；用户听感仍待确认，但客观当前验收为 **FAIL**。

日志：`C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260809-004431.stdout.log` 及对应 stderr。**本轮无固件/代码修改、无刷写，不继续 Codex Voice 验收。**

Task 64 只读代码闭环：麦克风 `27391 - 24863 = 2528 = send_failures = retry_exhausted`，而 I2S/read failures 与应用 queue drops 均为 `0`；每个损失包均在原始发送加两次有限重试、连续三次 `sendto` 返回 `ENOMEM` 后耗尽。errno `12` 目前仍不能区分 lwIP netbuf/pbuf 分配失败与 Wi-Fi driver TX pool 失败；后者只是高可信候选，不是最终确认。

扬声器 `300 - 271 = 29 = PC speaker pipe dropped 29`；设备对实际收到的 `271` 帧全部播放，device queue drop/gap/underrun 均为 `0`。因此这 `29` 帧丢在 PC 侧 `12` 帧 drop-oldest pipe；WebSocket stall `323.507 ms` 超过 `120 ms` 预算，设备累计 backpressure `206`。

下一次最高信息、无需刷写的验证是在首个 ENOMEM 现场设置 JTAG 分流断点：`sockets.c:1691/1692`、`udp.c:774/778`、`wlanif.c:114/115`，以区分 sockets/netbuf、UDP/pbuf 与 Wi-Fi driver TX 路径。**本节仅为只读代码闭环与取证设计；无代码修改、构建或刷写，不宣称根因最终确认。**

#### Task 65：当前 TX8 pre-VB A/B 与时间压缩闭环

用户明确纠正产品验收不要求 `100%` 零丢帧，同时判定 Task 62 试听失败。Task57 通过件为 pre-VB `24 kHz`，Task62 为 post-VB `48 kHz`，此前不能直接跨边界等同。

不刷写条件下启动 fresh Dock PID `2732`，raw capture `.claw/runtime/task65-current-tx8-pre-vb-24k.pcm`。在 `20 s` 同步墙钟窗口内，offset `131,040..393,120`，实际只有 `262,080 bytes = 5.46 s` 音频，约 `72.7%` 墙钟时间缺失；host frame `501` 时 gaps `3147`。

提取 `.claw/runtime/task65-current-window-pre-vb-24k.wav` 及 gain `+12 dB` 版本。raw peak `2,251`、RMS `137.89`、clipping `0`，speech band `81.37%`、low `3.20%`、mains `2.09%`、flatness `0.02434`。保留下来的样本本体与 Task57 质量相近，但严重缺帧导致时间压缩和机器人声。

结论：音频硬件与选麦没有回退；Task57 是 clean 窗口，`ENOMEM` 间歇 burst 尚未根治，TX buffer `6 -> 8` 只降低、未消除问题。Task62 正式人工 FAIL，旧“Task62 清晰样本仍有效”表述作废。**本轮无代码修改、构建或刷写。**

#### Task 66：ENOMEM 无刷 JTAG 分流无效，复位清除累积状态

首次 JTAG no-flash 探针因 `wlanif.c:114` 被优化、没有独立机器码而无效。随后按 ELF line map 在 `0x420e4caf` 设置条件 `a2 == 0x101`，但产生大量双核 halt/switch，未打印 `TASK66_WLANIF_ENOMEM_HIT`。最终意外捕获的是独立已知问题：`***ERROR*** A stack overflow in task headtouch has been detected.` / `panic_abort`。因此本次 ENOMEM 分流证据无效，不能据此归因到 wlanif 或其他分配层。

停止 OpenOCD 后设备 ping 不可达；使用既有 reset-run 配置只执行软件复位、没有写 flash。随后 ping `5/5`、USB 三接口恢复，Dock 重新认证。复位后首次 status 为 `captured=23 / sent=23 / failures=0 / retries=0 / last_errno=0`，说明先前持续 ENOMEM 状态被设备复位清除。

结合“只重启 PC Dock 时仍严重缺帧”，当前证据支持设备侧资源随运行/连接累积耗尽或泄漏这一高可信方向，但尚未锁定具体分配层。原始日志：`.claw/runtime/task66-gdb-wlanif-enomem.log`、`.claw/runtime/task66-openocd.stderr.log`、`.claw/runtime/task66-recovery-reset-run.log`。

**本轮无代码修改、构建或刷写；headtouch 栈溢出是独立已知问题，不是 ENOMEM 根因证据。**

#### Task 67：标准半双工播放未复现新增 `ENOMEM`

不刷写，设备复位后使用正确的 setTalking 半双工流程做单变量复现。初始设备累计 `captured=8638 / sent=8595 / failures=43 / retries=126 / exhausted=43 / last_errno=12`。

speaker 前主机接收 `500` 帧且 receiver gaps `0`，设备 failures 仍为 `43`。随后发送真实语音 `requested=300`，设备 `received=300 / played=300 / queueDrops=0 / backpressureWaits=0 / sequenceGaps=0`；`silence 63 -> 114`、underruns `3` 另列，不与 ENOMEM 计数混同。

speaker 后再接收 `500` 帧且 gaps `0`；最终设备 `captured=9649 / sent=9606 / failures=43`，失败计数没有增加。

结论：本轮标准半双工播放没有新增 ENOMEM，否证“每次 speaker transition 必然触发 ENOMEM”；故障属于间歇性或状态相关。诊断脚本仅为 `.claw/runtime/task67_speaker_enomem_repro.mjs`，日志 `.claw/runtime/task67-speaker-enomem-repro.log`。**无产品代码修改、构建或刷写；当前版本仍不可交付。**

#### Task 68：PC 网络切换无效实验与后续操作边界

此前尝试切换 PC 网络，等待约 `8 s` 后 PC 仍连接原有软路由 Wi-Fi；切换没有成功，因此该轮是**无效实验**，不用于任何技术结论。

用户明确说明：切换 PC 网络会导致软路由和 OpenAI 连接中断。今后未经用户在**当次操作中明确授权**，禁止切换 PC 网络。

当前网络研究范围仅限机器人侧的只读核实与方案评估：先确认机器人硬件/固件是否支持 `5 GHz Wi-Fi`；若确认不支持，再评估机器人侧将 gateway/DNS 设为 `192.168.0.2`。本节点未执行网络变更，也未修改产品代码、构建或刷写；不记录 Wi-Fi 密码。

#### Task 69：PC-only 同源 VB 回录与方法论纠正

第一次 PC-only 回录因本机没有 `ffmpeg`，raw 输入为 `0 bytes`，只得到空白 capture。该轮是**无效实验**，不得用于音质结论。

随后现有 `vb_cable_player.py` 增加 `--wav` 输入能力，唯一输入采用用户已经确认清晰的 Task 57 `+12 dB`、`24 kHz` WAV；机器人、Wi-Fi 与 Dock 均不参与。player 与 capture 均 `exit 0`，得到 `18.5 s / 48 kHz` 回录：`.claw/runtime/task69-vb-loopback-ab/task69-task57-through-vb-cable-48k.wav`。当前相关性计算结果异常，尚未形成音质结论；必须先继续定位或由用户试听，不能据此判定 VB 链通过或失败。

用户纠正产品目标是 **Stack-chan 整机**，不能等同于通用 M5Stack/CoreS3。基于实机芯片身份得到的 ESP32-S3 仅支持 `2.4 GHz` 频段这一结论保留；音频、触摸、舵机、电源等整机行为必须优先依据 Stack-chan 官方整机资料与本机源码，通用 CoreS3 推断一律降级为辅助参考。

鉴于当前投入产出不成比例，暂停新固件与刷写，先研究并建立分层观测、Golden 基准和 HIL 验收流程。本节点不记录密码，也没有修改产品代码、网络、构建或刷写。

#### Task 70：官方调研后的分层验证方法

**目标对象必须写成官方 Stack-chan 整机。** M5Stack/CoreS3 或单颗 ESP32-S3 资料只能回答其对应层级的问题，不能外推 Stack-chan 的麦克风、触摸、舵机、电源与整机时序。整机麦克风入口以官方 Stack-chan `Mic Test` 和本机实际源码/硬件清单建立 Golden；通用板资料仅作为待整机验证的辅助假设。

本轮只读调研确认可复用的官方观测能力：ESP-IDF 的 JTAG/GDB 用于取得真实任务栈和断点现场，core dump 用于离线 panic 回溯，heap failed-allocation hook 用于记录失败大小/caps/调用点，App Trace 用于低扰动连续事件与计数采集，`pytest-embedded` 用于把串口、复位和硬件断言固化为 HIL。Xiaozhi 的价值在于其分层架构：硬件 codec/I2S、采集服务、处理/编码、有界队列、会话 transport 与应用状态分别可观测和验收；不能把整条链压缩成一次试听。

当前开发低效的核心原因是：在故障层尚未定位时频繁做昂贵的端到端刷写/人工试听；混用整机与通用开发板结论；transport、波形和用户可懂度互相代替；缺少同源 Golden、层间落盘点和可重复 HIL，导致同一症状在 I2S、UDP、VB、播放与 Codex 之间反复猜测。

后续统一采用 `L0-L7` 门禁：

- `L0 对象/安全`：整机身份、硬件清单、分区、候选与回滚 hash、网络操作边界明确。
- `L1 离线合同`：单变量、源码审阅、合同测试、完整构建、镜像/分区检查和可重放 patch 全部通过。
- `L2 启动/资源`：空闲启动稳定；heap failed-allocation、任务栈、core dump、transition error 无异常。
- `L3 原始采集 Golden`：I2S 前后固定落盘点逐样本/频谱对照官方 Mic Test Golden，先证明选麦、slot、时钟和 packing。
- `L4 设备 transport`：设备发送计数与主机收包闭合，gaps/ENOMEM/reconnect 由 App Trace 或等价计数定位，不能只看平均帧率。
- `L5 PC 虚拟音频`：用同一个 L3 Golden 做 PC-only VB 输入/回录 A/B，验证格式转换、采样率与虚拟设备，不引入机器人网络。
- `L6 半双工输出`：真实语音 speaker、播放期 mic 阻断、Speaking→Listening 恢复及累计计数 delta 通过。
- `L7 产品场景`：用户真人可懂度、Codex Voice 实际对话、MCP 表情/动作和拔 USB 运行分别验收；低层技术指标不得替代本层。

**允许刷机合同：** 只有目标故障已定位到固件层、单变量假设无法再由只读/PC-only/HIL 证据回答，且 `L0-L1` 全绿，候选身份与完整回滚已验证，预先写明本次唯一变量、观测点、成功/失败信号和停止条件，才允许请求一次实机刷写。写后必须从对应最低层逐级验收；任一层失败立即停止上推，禁止直接进入试听或 Codex。当前暂停新功能候选与刷写，先把上述观测和 Golden/HIL 基础设施补齐。本轮未改产品代码、网络、计划或 Git，也不记录密码。

#### Task 71-74：VB 跨进程 buffer 合同定位

**Task 71（同一 PortAudio duplex stream）：** 以 Task 57 清晰源同时播放和回录，lag=`105.458 ms`、sample correlation=`0.999999336`、gain=`0.999413`、SNR=`58.77 dB`，活动区 exact-zero ratio 在源和回录中均约 `0.407%`。这证明同一双工流条件下 VB DSP 基本透明。产物与日志：`.claw/runtime/task71-vb-duplex-ab/task71-task57-vb-duplex-48k.wav`、`report.json`、`stdout.log`、`stderr.log`。

**Task 72（两个独立进程）：** capture 使用 high latency，报告 overflows=`0`，但活动区 exact-zero=`36.54%`、全段 exact-zero=`49.18%`、correlation=`0.0898`，稳定复现跨进程断流。证据目录 `.claw/runtime/task72-vb-two-process-ab/`，包含回录 WAV 及 player/capture 的 stdout/stderr。

**Task 73（只把 player 从 low 改为 high latency）：** 活动区 exact-zero 仍为 `34.95%`，与 Task 72 同类，否证“只是 PortAudio player low latency 配置导致断流”。证据目录 `.claw/runtime/task73-vb-high-latency-ab/`。

**Task 74（只读 VB-CABLE Control Panel 3.3.1.7）：** Internal SR、input 与 output 均为 `48 kHz`，resolution=`24 bit`，Max Latency=`7168 samples`，两端 DMA size 显示 `4096`，累计 `Pull loss=3502481`。官方 reference manual 说明 cable 连续流约需三个**最大应用 buffer**；后续 Task 82 已纠正：Control Panel 的 DMA size `4096` 不等于应用 callback 必为 `4096`，应用 buffer 应由统计栏 `b128/b256/b512/b1024...` 判断，而本轮截图中 `b1024=0`。因此不能仅凭 DMA=`4096` 推导“本机必须设置 12288”。截图：`.claw/runtime/task74-vbcable-config-readonly/vbcable-control-panel.png`、`vbcable-latency-menu.png`、`vbcable-options-menu.png`。官方资料：[VB-CABLE Reference Manual](https://vb-audio.com/Cable/VBCABLE_ReferenceManual.pdf)、[VB-Audio support discussion](https://forum.vb-audio.com/viewtopic.php?t=1430)。

结论：当前首个失败边界已定位到 **PC 侧 VB 跨进程 buffer 合同**，不是 VB 的采样 DSP。本轮没有修改 VB 设置，也没有重启、刷固件或改产品/网络/Git。下一步必须先取得用户当次授权，才可把 Max Latency 设为 `12288`、重启 PC 并用同源 Task 57 做完全相同的复测。标准 Dock 已恢复为 PID `31324`，并与机器人 TCP `Established`；这只说明环境恢复，不代表音频链通过。

#### Task 75：VB-CABLE latency 受保护配置入口

当时只读定位到配置镜像 `HKLM\SOFTWARE\VB-Audio\Cable`：`VBAudioCableWDM_SR=48000`、`VBAudioCableWDM_Latency=7168`，与 Task 74 Control Panel 显示一致；后续 Task 81-82 证明该键不能单独代表驱动运行态。

新增受保护脚本 `ops/bin/configure-vbcable-latency.ps1`：默认只执行 preflight，目标 latency=`12288`；校验 expected-current guard、设备 `ROOT\MEDIA\0000`、驱动版本 `3.3.1.7` 与 `48 kHz`。只有显式 `-Execute` 且具管理员权限时才允许变更；执行前生成 JSON 备份，写后回读，输出 rollback command，并且只声明 `reboot required`，脚本本身不重启电脑。

本轮 PowerShell parse 通过；preflight 显示 `before=7168 / after=7168`；用错误 expected-current 值验证 guard 会失败并保持不写。**本轮未执行 `-Execute`，未修改注册表、网络或固件，也未重启。**

#### Task 76：暂停前固化同源自动门禁

新增 `tools/wifi_audio_analysis/compare_known_loopback.py`，用于对已知源与 VB 回录执行自动同源门禁。第一次运行因 `numpy.bool_` 不能 JSON 序列化而失败；将输出显式转换为 Python `bool` 后重跑，工具可稳定给出退出码和客观指标。

- Task 71：`PASS / exit 0`，corr=`0.999999336`、gain=`0.999413`、SNR=`58.77 dB`、added-zero=`0`。
- Task 72：按预期 `FAIL / exit 1`，corr=`0.08984`、SNR=`-20.88 dB`、added-zero=`36.135%`。
- Task 73：按预期 `FAIL / exit 1`，corr=`0.06010`、SNR=`-24.40 dB`、added-zero=`34.541%`。

电脑重启后将复用完全相同的门禁验证 Max Latency 变化，不再以主观猜测代替同源数据。受保护配置脚本仍未 `-Execute`，注册表 latency 仍为 `7168`；未重启、未刷写、未改网络。当前 plan 已进入 `process.wait`，等待用户授权。

#### Task 77：VB-CABLE Max Latency 受保护变更

第一次从非管理员会话直接 `-Execute` 被脚本保护拒绝，注册表仍为 `7168`。第一次发起 UAC 后外层等待 `120 s` 超时，且没有生成 backup 或 elevated log；只读回查仍为 `7168`，因此该轮没有完成变更。

用户明确要求“再来一次”后，第二次 UAC 执行成功：`ElevatedExitCode=0 / Before=7168 / After=12288 / InternalSR=48000`。变更前 JSON 备份为 `.claw/runtime/task77-vbcable-latency-change/before-change.json`，提权执行日志为 `.claw/runtime/task77-vbcable-latency-change/elevated-output.log`；回滚命令由受保护脚本在输出中给出。

注册表已经回读为 `12288`，但 VB-CABLE 驱动运行态尚未经过 Windows 重启，因此不能写成配置已经生效或断流已修复。下一步只需重启 Windows，然后复用 Task 76 完全相同的自动同源门禁。本轮未修改网络或固件。

#### Task 78-80：重启反证、驱动配置层纠正与第二次写入

**Task 78：** Windows 于 `12:17:55` 完成重启；`HKLM\SOFTWARE\VB-Audio\Cable` 仍为 `12288`，PC 仍连接原有软路由 Wi-Fi。但复用 Task 72 完全相同的 PC-only 同源门禁仍为 `FAIL`：corr=`0.0630266`、gain=`0.049253`、SNR=`-23.948 dB`、added exact-zero=`30.4947%`；player/capture 均 `exit 0`，underflow/overflow 均 `0`。该窗口机器人 ping=`0`、Dock 未启动，但机器人与 Dock 本就不参与 PC-only A/B，因此不影响本轮结论。

**Task 79：** 只读 Control Panel 运行态截图显示 Max/Current Latency 仍为 `7168`，Internal/Input/Output 均为 `48 kHz / 24 bit`，双方 DMA=`4096`，Pull loss=`463`。注册表对照发现 `HKLM\SOFTWARE\VB-Audio\Cable=12288`，而第二个已知配置容器 `HKLM\SYSTEM\CurrentControlSet\Services\VB-Cable=7168`；当时曾误称后者为“真正驱动 service 层”，该表述已由 Task 82 的 PnP 证据纠正，实际绑定 service 是 `VBAudioVACMME`。

当时据此修正 `ops/bin/configure-vbcable-latency.ps1`：把 `Services\VB-Cable` 当作权威并同步 SOFTWARE 镜像；执行前同时备份两处，写后同时回读，任一失败则恢复两处。脚本 parse/preflight 通过且本节点没有写入。Task 82 后确认“service 键权威”本身也是错误假设；这段仅保留为历史过程。

**Task 80：** 用户明确授权后 UAC 执行成功：`Services\VB-Cable` 配置容器 `7168→12288`，SOFTWARE 保持 `12288`，两处最终回读均为 `12288`。备份和日志位于 `.claw/runtime/task80-vbcable-driver-latency-change/`。当时仍需第二次 Windows reboot 检验运行态；后续 Task 81-82 已证明两键回读不等于运行态生效。**本轮未修改固件或网络，不能宣称断流已修复。**

#### Task 81-82：官方菜单仍无法启用 12288，终止该路线

**Task 81 / 第二次 reboot 与官方菜单：** Windows boot time=`2026-08-09 12:52:54`，PC 仍连接原有软路由 Wi-Fi；SOFTWARE 与 `Services\VB-Cable` 两处均为 SR=`48000`、latency=`12288`，PnP VB 设备全部 OK，但管理员 Control Panel 运行态仍是 Max/Current=`7168`。这证明直接写两处注册表并重启没有让运行态采用 `12288`。随后再次通过 UAC 以管理员身份运行官方 `VBCABLE_ControlPanel.exe`，按已核实的 Options 菜单坐标点击 `Set Max Latency: 12288 smp (requires REBOOT)`；点击后界面仍显示 `7168` 属尚未重启的预期状态，两处注册表仍为 `12288`。该节点只表示官方菜单操作已完成，不表示生效。

**Task 82 / 第三次 reboot 最终反证：** boot time=`2026-08-09 13:33:38`，PC 仍连接原有软路由 Wi-Fi；两处历史配置键均为 `12288 / SR48000`、PnP 全部 OK，但 Control Panel 实际仍为 Max/Current=`7168`，Latency 菜单中的 `3×4096` 与 `3×8192` 项均禁用。用户现场明确确认“无法选择 12288”。

PnP 只读证据确认实际设备 `ROOT\MEDIA\0000` 绑定 service=`VBAudioVACMME`、INF=`oem96.inf`、版本=`3.3.1.7`。此前将 `HKLM\...\Services\VB-Cable` 称作“真正驱动 service 层”是错误；它和 SOFTWARE 键都是 control panel/driver 二进制引用的配置容器，实际 PnP service 是 `VBAudioVACMME`。只读字符串检查确认 driver sys 与 control panel 同时引用 `\Registry\Machine\Software\VB-Audio\Cable` 和 `\Registry\Machine\System\CurrentControlSet\Services\VB-Cable`，系统中也只发现这两处 Latency，且均已为 `12288`；但运行态仍固定 `7168`。

官方 manual/forum 将 `7168` 描述为默认分配的最大 latency memory，并说明某些 Windows 配置在启动时可能忽略更高值。结合三次重启与官方菜单实证，**不再继续重启或推进 12288 路线**。Task 74 的“DMA4096→必须12288”也正式作废：DMA size 不是应用 callback buffer，统计 `b128/b256/b512/b1024` 才描述应用 buffer，本轮 `b1024=0`。

新的 PC-only 单变量假设是：阻塞式 player 在跨进程向 VB 供数时产生空窗或时基不连续。下一步仅准备 callback+jitter-buffer player 做同源 A/B；不刷固件、不改网络，也不得写成问题已修复。

#### Task 83：预缓冲连续写线程假设被否证

PC-only 单变量把播放器改为 `100 ms` 预缓冲、独立连续 write 线程，并在断粮时补静音。离线门禁为 `py_compile` 通过、单测 `3/3`、diff-check 通过。

固定使用 Task 57 source，capture/player 均 `exit 0`；player `frames=1638 / underflows=0 / inserted_silence_chunks=0`，capture `20 s / overflows=0`。但自动同源 gate 仍为 `FAIL`：corr=`0.085546`、gain=`0.068465`、SNR=`-21.308 dB`、added exact-zero=`34.2149%`。

因此本轮明确否证“阻塞式读写耦合或未调用 write 造成的供数空窗是主要根因”；跨进程 VB 路径仍失败。该实验代码将回退，不保留无效复杂化，不能写成修复。证据目录 `.claw/runtime/task83-vb-buffered-player-ab/`。本轮未改网络、固件或机器人。

#### Task 84-85：PortAudio host API 分流

**Task 84 / WDM-KS：** 第一次命令因 `Start-Process` 把含空格参数拆开而无效。修正参数传递后，WDM-KS 播放器仍未进入音频阶段，PortAudio 明确返回 `Blocking API not supported yet (Pa -9999)`。该结果只证明现有 blocking player 与 KS API 不兼容，不是音质失败，也没有产生可用于比较的音频。

**Task 85 / MME：** 第一次用完整 MME 设备名时名称被 PortAudio 截断，resolve 失败，属于无效实验。改用唯一前缀 `CABLE Input` 后有效：player/capture 均 `exit 0`，player `frames=1638 / underflow=0`，capture `overflow=0`。

回录报告：source_start=`484.083 ms`、corr=`-0.0232868`、gain=`-0.022707`、SNR=`-32.626 dB`，自动门禁明确 `FAIL`；source exact-zero=`0.4074556%`、capture exact-zero=`0.4071847%`、added-zero≈`-0.0002709%`，source/capture peak 均为 `7448`。因此 MME 确实消除了 WASAPI 路径约 `34%` 的额外零样本，但没有保真传递音频。

用户试听后明确判定 **FAIL**：“低沉男声、完全听不清”。本轮输入正是用户已经批准清晰的 Task57 `+12 dB` WAV。源/回录名义时长为 `16.38 s / 20 s`（回录含前后静音）；活动包络最佳时间尺度仍约 `1.0`、lag 约 `490-500 ms`，但频谱映射最佳比例约 `0.51`。频谱重心 `1037.89→638.50 Hz`，中位能量频率 `855.47→468.75 Hz`；相邻样本完全相等率 `2.0677%→35.1131%`，回录偶/奇成对样本 corr=`0.99999885`、diff RMS=`0.795`。这些证据证明输出被近似成对复制，形成半频/样本排列失真，而不是普通时钟漂移。

结论：Task85 是 PC MME/VB 格式路径引入的确定性半频失真，MME 路线正式拒绝。输入正是用户批准清晰的 Task57 源，因此 corr/SNR/成对复制等客观同源门禁本身已经足以拒绝该路线，用户试听失败是独立确认。机器人未参与该 PC-only 实验，不能据此声称机器人麦克风回退。文件 `.claw/runtime/task85-vb-mme-output-ab-retry/task85-task57-vb-mme-output-48k.wav`；本轮未改代码、Git、系统、网络或硬件。

#### Task 86：WASAPI 原生双声道不是唯一根因

为验证端点 `2ch` 格式，临时给 player/capture 增加 `channels=2`：播放时把 mono 复制到 L/R，回录时只取 L；临时单测 `2/2`。隔离停止旧 Dock/player 后，以同一个用户批准的 Task57 source 运行独立 WASAPI 双进程 `20 s`。

player/capture 均 `exit 0`，underflow/overflow=`0`；但同源 gate 仍为 `FAIL`：source_start=`408.417 ms`、corr=`0.247346`、gain=`0.247096`、SNR=`-11.861 dB`、added-zero=`0.34379%`、source/capture peak=`7448/7447`。

双声道 corr 虽好于旧跨进程约 `0.06-0.09`，仍远低于 Task71 同流的约 `0.999 / 50+dB`，因此否证“单声道帧格式是唯一根因”。本轮不进入试听，也不能记作修复。临时代码已完整回退，player 单测恢复为 `1/1`，仍待后续复核。证据 `.claw/runtime/task86-vb-wasapi-stereo-ab/`。

标准非 MCP Dock 已恢复 PID `25668`、player PID `14612`，端口 `8765` 为 Listening；PID 仅是当时快照，后续可变化。本轮未改机器人固件、网络或驱动。

#### 新计划 Task 4：XiaoZhi Local Dock 离线集成候选

新增官方 profile 配置：`USB_UAC_MVP=n / WIFI_AUDIO_MVP=n / XIAOZHI_LOCAL_DOCK=y / USB_DEVICE_UAC_AS_PART=n`。

完整构建时间线严格区分产品失败与环境失败：

- 第一次未 export ESP-IDF，CMake 在 PATH 解析阶段失败；属于环境失败。
- 第一次进入产品编译后的真实失败为 TinyUSB 缺少 `tusb_config.h`，根因是旧 `USB_DEVICE_UAC_AS_PART=y` 仍占有配置；改为 `n`。
- 第二次产品失败是 `esp-ml307` 的 `web_socket.cc` 与 header 处于私有/官方混合状态；根因是重叠 patch 按同序撤销。修正为检测完整端点、按逆序撤销，任何混合态 fail closed。
- `ota.cc` 位于忽略目录且不可重放形成 P1；新增 `firmware/patches/xiaozhi-local-dock.patch`，由 CMake 验证/应用，并以 nested Git index 的 `git apply --cached --check` 证明可重放。
- 诊断关闭改为 main target 的 `AUDIO_SERVICE_DIAG_ENABLED=0`，`build.ninja` 已确认实际生效。
- 一次从仓库根运行 Python 模块触发 `ModuleNotFound`，属于 cwd 错误；正确 cwd 后 `6/6` 通过。

最终 ESP-IDF `5.5.5` 完整构建成功。候选 `stack-chan.bin` 长度 `5,155,248 bytes / 0x4EA9B0`，目标 `ota_0=0x4F0000`，仅余 `22,096 bytes / 0x5650`；SHA256=`27187B9F0E604EC84AD989520BF6E994037C746594BAA798B92794B128263EC5`。分区只余约 `22 KB` 是明确风险。

最终离线门禁：firmware 共 `93` 项，`83 pass / 10 legacy-private-patch scoped skip`；Dock `55/55` 加 syntax；Rust `7/7`；reference comparator `2/2`；diff-check clean。**该镜像仅是离线候选，尚未刷写、实机、用户试听或 Codex 验收。**

#### 新计划 Task 5：HIL 预检与完整回滚备份

旧 Dock PID `25668` 确认为 `wifi-audio-dock --port 8765`，已正常停止并释放端口。设备初始 `COM7 + MI_02` 在线，esptool 识别 `ESP32-S3 rev0.2`、MAC `44:1b:f6:e2:78:a8`。

使用 esptool `4.12.0`、`921600` 只读完整 `ota_0 @ 0x20000 / 0x4F0000` 成功。备份 `.claw/runtime/xiaozhi-hil-20260809/preflash-ota0.bin`，长度 `5,177,344`，SHA256=`00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`，sidecar 已生成。

备份后的 hard reset 完成后，后继 partition read 在打开 COM 前即 `FileNotFound`，因此没有发生写入。随后 `30 s` 轮询中 COM7 未恢复，PnP 三接口均 `Present=False`，`192.168.0.8` ping false、ARP incomplete。

**边界：新候选尚未写入，这不是刷写失败或候选失败。** HIL 暂停在需要设备重新枚举、实体电源键或 RST 的现场边界；未切换 PC 网络，也未记录任何密钥。

#### 新计划 Task 5/6：官方协议适配与统一 PC runtime 离线门禁

新增官方 XiaoZhi JSON-RPC 适配器 `tools/stackchan-dock/src/xiaozhi-dock.mjs`，并由 `tools/stackchan-dock/test/xiaozhi-dock.test.mjs` 覆盖。适配器将请求绑定到当前会话，对断线、会话替换、超时和迟到响应全部 fail closed。机器人 MCP 映射仅发布官方支持能力：`self.get_device_status`、`self.robot.set_led_color`、`self.robot.get_head_angles`、`self.robot.set_head_angles`、`self.robot.celebrate`；表情使用官方 `llm emotion`。官方路线明确不发布旧的、不受支持的 `set_audio`。

统一 runtime/CLI 文件为 `tools/stackchan-dock/src/xiaozhi-runtime.mjs` 与 `tools/stackchan-dock/bin/xiaozhi-dock.mjs`，测试为 `tools/stackchan-dock/test/xiaozhi-runtime.test.mjs`。它把 authenticated bootstrap（`src/xiaozhi-bootstrap-server.mjs`）、XiaoZhi WebSocket v1 Opus（`src/xiaozhi-websocket-server.mjs`）、native event-driven WASAPI broker（`src/xiaozhi-wasapi-bridge.mjs` 与 `native/process-loopback/src/bin/stackchan-wasapi-broker.rs`）、官方半双工 TTS 和 typed MCP 组合为一个进程。

启动入口 `tools/stackchan-dock/scripts/start-xiaozhi-mcp.ps1` 只把 DPAPI 取得的凭据放入子进程环境，不打印或记录值；现有路由仅只读推导 `advertiseHost`，并有明确禁止修改 PC 网络的静态门禁。

测试时间线：

- 适配器首轮 `16/17`，唯一失败是异步断言写法错误；修正测试后 Dock 全量 `60/60`。
- runtime 首轮全量 `60/62`，根因是 `EventEmitter` 派生类遗漏 `super()`；修正后 targeted `2/2`、全量 `62/62`。
- 增加官方路线隐藏 `set_audio` 后，全量 `63/63`，`npm check` 通过。
- PowerShell parser 与“禁止网络变更”静态门禁通过；跨层门禁 firmware 共 `94` 项（`84 pass / 10 scoped skip`）、Rust `7/7`、reference comparator `2/2`。

当前 PC 只读路由为 WLAN source=`192.168.0.11`、gateway/DNS=`192.168.0.2`，没有切网。当前硬件仍 ping false，COM/JTAG/USB interfaces 均为 `0`，`8765/8766` 均无 listener。**候选尚未写入，当前状态不能记录为 candidate 或 flash 失败。** 本节点没有修改产品固件、plan、Git、网络或硬件，也不记录任何 token/密码。

#### 新计划 Task 5：USB 远程恢复边界

历史 StackChan composite instance `USB\VID_303A&PID_1001\44:1B:F6:E2:78:A8` 当前 `Present=False`；历史位置为 root hub `USB\ROOT_HUB30\5&2f3a6991&0&0` 的 port `1`。`pnputil` 只读拓扑显示该 root hub 当前没有在线 children，而数位板、蓝牙和指纹设备位于其他 root hubs。

在这一精确边界下，只尝试了一次 `pnputil /restart-device` 指向该 StackChan instance。Windows 返回 `Failed to restart device ... Access is denied`，没有发生设备状态变化；随后轮询 `30 s`，USB interfaces=`0`、serial=`0`、ping=false。

本轮没有绕过 UAC、没有重启电脑、没有切换网络，也没有刷写。远程恢复路径到此停止，当前需要用户实体重新上电或重新插拔 USB；该状态仍不是候选或刷写失败。

#### 新计划 Task 5：离线 HIL 资产与 standalone 验证

新增/扩展的 HIL 入口：`tools/stackchan-dock/bin/xiaozhi-dock.mjs --standalone`、`tools/stackchan-dock/scripts/start-xiaozhi-dock.ps1`、`ops/bin/test-xiaozhi-audio-hil.ps1`。固定参考源为 `firmware/main/assets/dev_serial/celebration-short-16k-mono-s16.wav`。

**重要纠正：上一版“串口 `prompt_sample` HIL”不可达，正式推翻。** `firmware/main/hal/hal_dev_serial.cpp:357-367` 的 `start_dev_serial_wake_stop_task` 只记录 `intentionally disabled`，既不安装 USB Serial/JTAG driver，也不创建 task；编译宏和命令代码存在不等于运行入口可达。

上行 HIL 已改为候选真实可达的 Wi-Fi dev HTTP `POST /dev/inject_prompt`，调用现有 `tools/remote_control/remote_control.py`；凭据不出现在新 HIL 脚本命令行。默认仍注入 short 固定 WAV，再走官方 `AudioService → Opus → WebSocket → native WASAPI → CABLE Output`。`tools/wifi_audio_analysis/compare_reference_pcm.py` 使用 WAV source 做相对时间/幅度映射。

离线门禁：Dock `63/63` 与 `npm check` 通过；比较器 `4/4`；`start-xiaozhi-dock.ps1` 和已移除 COM 前提的 `test-xiaozhi-audio-hil.ps1` PowerShell 解析通过；“禁止网络变更”静态检查无命中。只读 HIL preflight 现在检查 WebSocket authenticated 与端口 `18080` reachable；当前两项均为 false，符合硬件离线现场，因此没有越过前置条件。

standalone 离线启停验证：PID `28380` 在 `192.168.0.11` 的 `8765/8766` 建立 listener；stderr 明确显示 bootstrap、WebSocket、standalone ready，以及 WASAPI capture=`24 kHz`、`CABLE Input` render=`16 kHz` ready。随后按精确 PID 及其子进程完成清理，端口 listener=`0`、Node 不再存活。

首次组合门禁命令最终 `exit 1` 仅因预期 `rg` 无匹配时遗留 `LASTEXITCODE=1`；各产品步骤实际成功，属于测试夹具/命令环境失败，不是 runtime 失败。README 中旧 raw-PCM 路线继续只保留为 rollback，不是当前官方实现方向。

当前仍无 WebSocket 认证且 `18080` 不可达，因此没有执行 HIL、没有刷写，也没有真实麦克风、喇叭、Codex 或用户听感结论。本节点未修改产品、plan、Git、系统或硬件，也不记录 token/密码。

#### 新计划 Task 5：输出侧离线 HIL 与 standalone 复核

新增 `tools/wifi_audio_analysis/extract_wave_pcm.py`、测试 `tools/wifi_audio_analysis/test_extract_wave_pcm.py`，以及 `ops/bin/test-xiaozhi-speaker-hil.ps1`。输出侧固定路径为：固定 `16 kHz` 人声 → 独立进程 `stackchan-wasapi-play` → production process-loopback broker → 官方 `24 kHz` Opus WebSocket → 机器人喇叭。

speaker HIL 脚本默认只做只读 preflight，只有显式 `-Execute` 才运行。自动完成条件要求 stderr 同时出现 `half_duplex_speaking=true` 和 `half_duplex_speaking=false`，且整个窗口无 runtime error 或 disconnect；即使自动条件满足，用户试听仍是必需验收，不能用日志替代。

离线结果：extract 测试 `1/1`、compare `4/4`；`start-xiaozhi-dock.ps1`、`test-xiaozhi-audio-hil.ps1`、`test-xiaozhi-speaker-hil.ps1` 三份 PowerShell 脚本解析通过；禁止网络变更静态门禁通过。speaker preflight 正确报告 ports available、`user_listening_required=true`。

standalone 第二次实测建立 `2` 个 listeners，正式 URL 纠正为 `ws://192.168.0.11:8765/xiaozhi/v1`。凭据不在命令行，也不在父进程环境；清理后两个端口均释放。

硬件复查仍为 USB interfaces=`0`、COM=`0`、ping=false，因此未执行 speaker HIL，也未刷写、用户试听或 Codex 验收。README 旧 raw-PCM 路线继续仅为 rollback。本节点不记录 token/密码，也未修改其他产品、plan、Git、系统、网络或硬件。

#### 新计划 Task 5：PC BLE provisioning 迁移与 Truth 同步

现有 `tools/stackchan-dock/scripts/ble-provision-wifi-audio.py` 原先只接受 `ws/wss`，与官方模式固件要求的 `http/https` OTA bootstrap 不兼容。本轮将允许 scheme 扩展为 `http/https/ws/wss`；新增 `--scan`，且只列出 StackChan 设备。真正 provision 必须收到 `wifiAudioConfigured` 通知才算成功，不能只以 GATT write 返回作为完成证据。

新增测试 `tools/stackchan-dock/test/test_ble_provision_wifi_audio.py`，结果 `3/3`。新增只读默认 wrapper `tools/stackchan-dock/scripts/provision-xiaozhi-dock.ps1`：根据现有到 `192.168.0.8` 的路由推导 `http://192.168.0.11:8766/xiaozhi/ota`；DPAPI 取得的 secret 只进入子进程环境、不进入命令行；保留机器人现有 Wi-Fi，不修改 PC 网络。

现场只读 `--scan` 没有发现正在广播的 StackChan；wrapper preflight 返回 `secret_present=true / write=false`。因此没有 BLE 写入，也不能把“未扫描到广播”外推成固件或 BLE 硬件失败。

离线门禁：Dock `63/63` + `npm check`、BLE `3/3`、分析器 `5/5`、PowerShell parse 与“无网络修改”静态门禁全部通过。现有 Truth `.claw/truth/features/wifi-codex-voice-product-architecture.md` 与 ADR `.claw/truth/adr/reuse-xiaozhi-audio-stack-with-local-pc-dock.md` 已同步串口入口 no-op、HTTP HIL、BLE 配置确认及当前实机边界。

本轮未 `-Execute` BLE、未刷写、未做实机、Codex 或听感验收，也不记录任何凭据。

#### 新计划 Task 5：用户重新上电后仍未进入枚举

用户实体重新上电后，只读检查仍显示：`VID_303A/PID_1001` 枚举为空，`Win32_PnPEntity` 中无目标，未发现 StackChan BLE 广播，`192.168.0.8` 不可达，也没有机器人 TCP 连接。

PC 侧所有 `USB ROOT_HUB30` 均为 `Status=OK / Problem=0`；历史目标 root hub 当前没有 Espressif children。因此没有证据支持把问题归因到 PC root-hub 故障。

**该阶段官方 XiaoZhi 候选尚未刷写。** 当时无法启动/枚举不能归因候选、音频代码或新协议实现；该阶段边界位于实体供电、整机启动或 USB 枚举之前。本节点只记录只读证据，未修改产品代码、计划、Git、系统、网络或硬件，也不记录密码。

用户进一步确认：按左侧电源键后设备只短暂闪一下，随即熄灭。结合当时 USB、BLE、网络均无任何上线迹象，该窗口的边界曾收敛为：**设备当时无法保持上电，尚未进入任何可观测的系统启动阶段**。后续恢复证据已证明这不是持续故障。

历史记录中也出现过“左侧电源键短暂闪屏”的相同表象（见本文件早期启动记录）；当时设备后来曾恢复运行，因此该表象本身仍不能定位具体电源、板级或固件根因。但本次官方 XiaoZhi 候选从未写入，明确不能把当前无法保持上电归因于该候选。

恢复结果：数据线已连接，用户再次操作后机器人正常启动。只读检查确认 `VID_303A/PID_1001` composite、`MI_02` JTAG、`COM7` 均为 `Status=OK / Problem=0`，`192.168.0.8` ping=`5/5`。用户随后明确进入下载模式。

因此“无法保持上电”只描述此前阶段性窗口，当前已解除。现在进入官方 XiaoZhi 候选的受保护、只读 preflight 阶段；**候选仍尚未刷写。**

#### 新计划 Task 5：官方 XiaoZhi 候选受保护写入与启动

受保护 preflight 确认目标为 `ESP32-S3 rev0.2`、MAC `44:1b:f6:e2:78:a8`，实时 `ota_0 @ 0x20000 / 5056K`；候选 SHA256=`27187B9F0E604EC84AD989520BF6E994037C746594BAA798B92794B128263EC5`，回滚备份 SHA256=`00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`，均与预期身份一致。

随后显式 Execute 只写 `ota_0`，镜像长度 `5,155,248 bytes`。写入工具内建 hash 校验通过，独立 verify digest matched，结果为 `FLASH AND VERIFY PASSED`；bootloader、partition table、NVS、assets 及其他分区均未写入。

hard reset 后，`VID_303A` composite、`MI_02` JTAG、`COM7` 均为 OK，`192.168.0.8` ping=`5/5`。这证明该候选已经启动并联网，但尚未完成 Dock 认证、HIL、用户听感或 Codex 验收。

一次联合 BLE 观察因外层 `30 s` timeout 没有产生汇总，属于无效工具窗口；不得把它解释为启动失败或 BLE 失败。

#### 新计划 Task 5：候选进入官方小智栈与本地配置边界

用户确认候选启动后自动进入小智界面，并已正确联网和登录。这是候选启动、已有 Wi-Fi 与登录态可复用的人工正证据。

镜像身份必须准确表述：它不是原厂官方包原封不动，而是基于官方 `Application / AudioService / Opus / WebSocket` 栈构建的本地 Dock 候选。只读配置证据显示 `sdkconfig.xiaozhi_dock` 中 `CONFIG_STACKCHAN_WIFI_AUDIO_MVP` 未启用、`CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK` 已启用；因此旧隔离 runtime 的“启动即 BLE”分支不会执行。此前要求用户打开 Setup 的判断撤回。

候选编译期 `CONFIG_OTA_URL=http://192.168.0.12:8080/ota`，但 `Ota::GetCheckVersionUrl` 会优先读取 NVS 的 `wifi/ota_url`；本地认证材料位于 `xiaozhi_local/token`。本文只记录非敏感地址与键名，不记录任何 token 或 URL 凭据。

设备端口 `18080` 已开放，只读 status 为版本 `2.0.45`、state=`idle`、heap=`7357755`、RSSI=`-69`。这说明可通过已有 Wi-Fi 管理面处理本地 Dock 配置，不需要先依赖 BLE Setup。

当时拟议方案是增加受现有 `18080` 鉴权保护的 PC 配置入口，只更新 `wifi/ota_url` 与 `xiaozhi_local/token` 两个 NVS 键，然后延迟重启，保留现有 Wi-Fi 与登录状态；用户随后明确同意，离线实现与门禁见下一节。

#### 新计划 Task 5：18080 鉴权配置入口离线候选

用户明确同意 LAN 配置方案。新增 `/dev/xiaozhi-local` 仅在 `CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK` 编译：未鉴权返回 `401`，body 上限 `512 bytes`；严格校验 OTA URL scheme 为 `http/https`、长度与非空白，token 必须为 `64` 位 hex。若设备已有 pairing token 且与请求不一致，则返回 `409`，防止接管。

写入顺序为 fail-closed transaction：先验证全部字段；先 commit `xiaozhi_local/token` namespace，再 commit `wifi/ota_url`；随后双读回校验。响应和日志均不回显 token。重启复用 MCP 的延迟重启机制，避免在 HTTP 响应完成前断开。

PC 侧 `tools/remote_control/remote_control.py` 从 `STACKCHAN_WIFI_PAIRING_KEY` 读取 secret；DPAPI wrapper 只把 secret 放进子进程环境，不进入命令行，也不修改 PC 网络或机器人 Wi-Fi。

真实鉴权检查为 no credential=`401`、valid=`200`、invalid=`401`。离线门禁：endpoint 合同 `10/10`；firmware 共 `97` 项（`87 pass / 10 scoped skip`）；Dock `63/63`；Python/PowerShell parse、network-mutation scan、dry-run bootstrap=`192.168.0.11:8766 / write=false` 与 mock request body 均通过。

ESP-IDF `5.5.5` 完整构建两次通过。最终 `firmware/build-xiaozhi-dock/stack-chan.bin` 长度 `5,158,080 / 0x4EB4C0`，ota_0 剩余 `19,264 / 0x4B40`；BIN SHA256=`B5FF9499C0996859E1F656B96C0584692C3CC9AA9066B88DEF039C58F0888AA5`，ELF SHA256=`7EF39E69C3E3B4ED1F3F440A6302A918CF4198AFF3355F7817884B8F525132FF`，image checksum=`d8`、validation hash=`cdc5d6c27fec22937f8482e58dea32fd794d6cbf52eebbbbfb49c9ef4c0499f2` 均有效；handler stack frame=`464 bytes`。

flash pin 已更新到该身份，rollback 仍为 `00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`。**该新候选尚未刷写，也未执行实机配置、HIL、用户听感或 Codex 验收。** 本记录不包含任何 token 或密码。

#### 新计划 Task 5：B5FF 候选受保护只读 preflight

进入 preflight 前机器人 ping=`3/3`；`COM7`、USB composite 与 `MI_02` 身份正常，MAC=`44:1b:f6:e2:78:a8`。本地 Dock PID `13372` 仍监听 `8765/8766`。

flash 脚本只读 preflight 确认实时 `ota_0=0x20000 / 5056 KiB`，候选 SHA256=`B5FF9499C0996859E1F656B96C0584692C3CC9AA9066B88DEF039C58F0888AA5`，rollback SHA256=`00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`，结果 `PREFLIGHT PASSED`。esptool 操作后设备停留在 bootloader。

**本节点尚未 `-Execute`，没有擦除或写入。** 当前 bootloader 状态不能当作应用离线或候选失败；本记录不包含凭据。

#### 新计划 Task 5：B5FF app-only 写入

执行 `flash-xiaozhi-dock-candidate.ps1 -Execute`，结果 `exit 0`。候选长度 `5,158,080 bytes`、SHA256=`B5FF9499C0996859E1F656B96C0584692C3CC9AA9066B88DEF039C58F0888AA5`；唯一写入目标为 `ota_0 @ 0x20000`。

镜像压缩后 `2,971,416 bytes`，写入耗时 `29.6 s`；esptool 内建 hash verified，随后独立 verify digest matched/OK，hard reset 完成，最终 `FLASH AND VERIFY PASSED`。

NVS、bootloader、partition table、assets 及其他分区均未写入；rollback `00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236` 仍有效。当前仅证明写入与 flash 内容一致，启动、LAN 配置、HIL、听感和 Codex 尚未验收；不记录凭据。

#### 新计划 Task 5：B5FF 启动与 LAN 配置

hard reset 后 `2 s` 启动门禁中 ping、`COM7`、`18080` 均为 true。`remote_control` status 返回版本 `2.0.45`、state=`idle`、free heap=`7433207`、RSSI=`-43`，证明新候选启动到现有 Wi-Fi 管理面。

`provision-xiaozhi-dock.ps1` dry-run 解析目标为 `http://192.168.0.11:8766/xiaozhi/ota`，明确 `write=false`，不切换 PC 网络、不修改机器人 Wi-Fi。随后使用同一脚本显式 `-Execute`，结果 `exit 0`；设备响应确认配置已写入，并安排延迟重启。

一次 `remote_control` 调用误用 `--host`，只得到 usage error；改用正确参数 `--ip` 后完成上述 status，属于 CLI 使用错误，不是设备失败。

本文不记录任何 token/secret。当前等待设备延迟重启并由本地 Dock 完成认证；HIL、听感与 Codex 尚未开始。

#### 新计划 Task 5：本地 Dock bootstrap 与 WebSocket 认证闭环

配置后的明确 reboot 请求被设备接受。复位后 ping=`3/3`；PC 观察到机器人到端口 `8766` 的连接回收态，证明设备已经读取并访问新的 bootstrap URL。

设备空闲时没有 `8765` 连接，经源码确认属于官方 WebSocket 仅在会话中通过 `OpenAudioChannel` 打开的生命周期，不是连接失败。随后通过 `18080` 发起 wake，约 `3 s` 后出现 `192.168.0.8 → PC:8765` 的 `Established` 连接。

Dock 日志记录 `StackChan XiaoZhi authenticated device=44:1b:f6:e2:78:a8`；设备 status=`listening / free7368083 / RSSI-70`。

至此，B5FF app-only 写入、LAN provisioning、bootstrap URL 读取、WebSocket 建连与设备认证均通过。尚未执行音频 HIL、用户听感或 Codex 验收；不记录凭据。

#### 新计划 Task 5：HIL preflight 与首轮注入端点失败

uplink dry-run 通过前置检查：`authenticated_connection_present=true`、`dev_http_reachable=true`，固定 source WAV、capture binary 与 device ready 均已确认。speaker dry-run 返回 `ports_available=false`，原因是当前 Dock 正在占用端口，因此按设计未执行。

uplink 显式 `-Execute` 后，在调用 `/dev/inject_prompt` 时立即收到 HTTP `500`，脚本在 line `98` 抛出并停止。该轮没有进入有效录音或后续音频比较，因此没有音质结论，也不能记作麦克风、Opus、WebSocket、WASAPI 或音频 HIL 失败。

当前只读定位 `/dev/inject_prompt` 的 endpoint 失败条件；不记录凭据。

#### 新计划 Task 5：注入任务内存根因与单变量离线候选

对相同 `/dev/inject_prompt` 请求复现后，设备返回精确 HTTP `500` body：`task_create_failed ret=-1 heap=13863 internal=13863`。这确认失败点是开发注入任务的内部栈分配，音频处理尚未开始；不能把该 500 记作音频质量或传输失败。

新增合同先得到预期红灯 `10/11`。单变量实现只修改注入任务的创建与配对退出：使用 `xTaskCreatePinnedToCoreWithCaps`，栈 `4096`，capabilities=`MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT`；三个任务退出点对应改为 `vTaskDeleteWithCaps`。官方 ESP-IDF 测试源码存在 `vTaskDeleteWithCaps(NULL)` 的同类配对用法。其余音频、协议、Dock 与硬件配置不在本轮变量范围内。

离线门禁结果：定向合同 `11/11`；全量 firmware `98` 项通过，其中 `10` 项为 profile scoped skips；`git diff --check` 通过。ESP-IDF `5.5.5` 完整 build/link/partition 用时 `166.6 s` 并成功。候选 `stack-chan.bin` 为 `5,158,112 B / 0x4EB4E0`，ota_0 剩余 `19,232 B / 0x4B20`；BIN SHA256=`E935...6204`，ELF SHA256=`F09C...C529`，image checksum=`0x84`、validation hash=`8372...6501` 均有效。注入任务 frame=`144 B`，HTTP handler frame=`256 B`；flash pin 已更新，rollback 身份不变。

本节只证明根因闭环与离线候选通过。新镜像尚未刷写，也未做实机 endpoint、HIL、听感或 Codex 验收；不得写成问题已经在设备上修复。不记录凭据。

#### 新计划 Task 5：E935 候选受保护 app-only 写入

写入前先通过 HTTP stop 正常停止现有应用流程。受保护 preflight 逐项核对芯片、MAC、实时 `ota_0`、候选 `E935...6204` 与既有 rollback 身份，结果 `PREFLIGHT PASSED`。

显式 Execute 结果 `exit 0`：唯一写入目标为 `ota_0 @ 0x20000`，镜像长度 `5,158,112 B`、压缩后 `2,971,392 B`，写入耗时 `29.6 s`。esptool 内建 hash verified，随后独立 `verify_flash` digest matched / OK；工具执行 hard reset，最终为 `FLASH AND VERIFY PASSED`。

bootloader、partition、NVS、assets 等其他分区均未写入，rollback 身份保持不变。本节只证明 E935 镜像已受保护写入并校验一致；启动、endpoint 修复、HIL、听感及 Codex 尚待验收。不记录凭据。

#### 新计划 Task 5：E935 启动与第二轮 uplink HIL

E935 启动后 ping=`3/3`，远程 status=`idle / free7446475`；wake 后机器人到 PC `8765` 的连接进入 `Established`，Dock 再次记录 authenticated。启动、联网、bootstrap 与认证均恢复。

`test-xiaozhi-audio-hil -Execute` 随后成功启动 Prompt 注入，证明注入任务迁移到 WithCaps 的单变量修复已在实机越过此前 `task_create_failed`。但真实参考映射门禁失败：source=`51840` samples、candidate=`160000`、aligned=`51062`、offset=`94271 samples / 5891.94 ms`、time_scale=`0.985`、envelope correlation=`0.5160149`、sample correlation=`0.0893074`、fitted gain=`0.0153717`、SNR=`-20.585 dB`，source/candidate peak=`20595/5086`；只有 zero-growth 与 adjacent-growth 两项检查通过。

证据目录为 `.claw/runtime/xiaozhi-hil-20260809-175850`。该轮不可进入试听，音频质量门禁明确为 FAIL；端点修复通过不能替代音频映射验收。当前仅只读检查 AudioService 的注入流是否与真实麦克风流并发交错，尚无根因定案；不记录凭据。

#### 新计划 Task 5：第二轮 HIL 的双源交错根因闭环

源码确认 Listening 状态下，真实麦克风 `AudioInputTask → processor OnOutput` 每 `60 ms` 执行一次 `PushTaskToEncodeQueue`；开发注入路径同时每 `60 ms` 执行一次 `InjectPcmFrameToSendQueue`。注入期间没有暂停真实麦克风，因此 HIL capture 中存在两路同节拍帧交错，而不是单一固定参考源。

对 `xiaozhi-hil-20260809-175850` 的失败 PCM 做只读、以 `960 samples` 为帧的搜索：保留全部帧时，最佳 envelope correlation=`0.5064`，start=`5870 ms`；每隔一帧抽取后，最佳 envelope correlation=`0.982833`，start=`31680 samples / 1980 ms`。隔帧抽取恢复高相关，直接闭合双源交错假设。

因此，第二轮整体 HIL 的低相关是测试源被真实麦克风帧交错污染，不能外推为产品真实麦克风、Wi-Fi 或 Opus 本身失真；此前 WithCaps endpoint 修复的实机有效结论保持成立。决定不再为这个注入测试夹具盲目刷写新固件，后续转入真实麦克风与喇叭验收。不记录凭据。

#### 新计划 Task 5：speaker HIL 准备与首轮夹具异常

PC-only 合同补充临时 Dock 启动后先通过 HTTP wake，再等待机器人认证的顺序；合同先红后绿为 `12/12`，全量 firmware `99` 项通过（含 `10` profile skips），PowerShell parse 通过。该修改只涉及 HIL 夹具，没有修改固件或网络。

执行前安全停止旧 Dock PID `13372` 及子进程 `28412/26936`，确认相关 ports free；Codex target PID `17572` 仍存活。speaker Execute 成功提取 `51,840` samples，并完成 wake；但约 `20.3 s` 后，脚本在播放结束后读取临时 `dock/stderr.log` 时因文件仍被占用而抛出 `ReadAllText` 异常。

这次失败发生在 PC 日志读取/共享阶段，不能记为 speaker transport、设备播放或用户听感通过，也不能据此判定音频链失败。下一步先在句柄释放后读取既有日志，并修正 PC 日志共享读取方式；本轮未修改固件或网络，不记录凭据。

#### 新计划 Task 5：speaker HIL 自动传输闭环

首轮句柄释放后回读日志确认：机器人认证成功，`half_duplex_speaking=true → false` 生命周期出现两次，fixture `submitted=expected=51840`。这些证据说明首轮实际流程已推进，但因执行期日志读取抛错，首轮仍严格保留为夹具异常，不追记为正式 PASS。

PC 脚本的唯一修正是把 `ReadAllText` 改为可共享读取的 `Get-Content -Raw`；定向合同 `12/12`、PowerShell parse 与 diff-check 均通过。没有修改固件、网络或音频参数。

第二轮执行 `test-xiaozhi-speaker-hil.ps1 -Execute`，结果 `exit 0`，总时长约 `20.3 s`；source=`51840` samples、wake 成功、`automated_transport_complete=true`。临时 Dock PID=`15156`、fixture PID=`12104`，证据目录 `.claw/runtime/xiaozhi-speaker-hil-20260809-180553`。

据此可判 speaker 自动传输及官方半双工 speaking 生命周期门禁 PASS。用户尚未试听，因此不能写为最终听感或 Codex Voice 通过；不记录凭据。

#### 2026-08-09 V1 产品级最终人工验收收口

在 USB 仍连接的真实 Codex Voice 会话中，用户通过机器人说话并收到 Codex 经机器人喇叭播放的回复，明确反馈“可以了，测试通过”。同期 local Dock 日志记录 authenticated 后多轮 `half_duplex_speaking=true → false`，会话结束后设备回到 listening 且 TCP 保持连接。因此，USB 连接窗口的机器人 Wi-Fi 麦克风上行与喇叭下行人工门禁 PASS。

扬声器还进行了独立真人语料验收：`.claw/runtime/xiaozhi-speaker-live-20260809-1925` 中固定真人语音 source=`51840 samples`、`automated_transport_complete=true`；用户明确反馈“听到了，声音没有问题”。该结论只覆盖机器人 speaker 下行听感，不单独外推其他链路。

随后用户物理断开 USB。PC 两次 PnP 及后续回读均为机器人 USB interfaces=`0`、COM7=`0`，而机器人 Wi-Fi ping 持续成功，HTTP status 正常。用户在该断 USB 窗口重新完成真实 Codex 语音对话；Dock 日志再次出现多轮半双工 `true → false`。验收后 USB 仍为 `0`、COM7=`0`，ping=`3/3`，status=`idle / heap7369183 / RSSI-43`。据此，正常使用不依赖 USB 的 Wi-Fi Voice 双向人工门禁 PASS。

断 USB 后再次通过真实 MCP stdio probe 发送 `happy`：`.claw/runtime/xiaozhi_mcp_expression_probe_20260809.json` 返回 `mcpConnected=true`、`ok=true`、`expression=happy`、`delivery=xiaozhi-websocket`；用户现场明确确认看到屏幕表情变化。因此 PC → MCP → local Dock → 官方 XiaoZhi WebSocket → 机器人屏幕表情的人工门禁 PASS。该结论不包含舵机动作。

用户直接观察并确认此前崩溃发生在“待机自动摇头”期间，它与音频链故障分开处理。V1 候选已禁用待机随机头部动作，约 30 秒最小稳定门禁中 ping=`6/6`、HTTP 可用；屏幕 IdleExpression 与显式 MCP 控制入口保留。显式轻微舵机命令虽返回成功，但用户未看到可靠动作，底层舵机问题没有修复。按用户明确决策，V1 不验收舵机，显式舵机动作保持默认 disabled 并延期。

最终判定：V1 的机器人 Wi-Fi 输入、Wi-Fi 输出、PC/MCP 屏幕表情控制，以及断 USB 后的电池供电正常使用均已完成产品级人工验收。剩余舵机问题属于 V1 范围外后续事项，不得把本结论写成舵机已修复。不记录任何密码、token 或密钥。

#### 2026-08-09 最终运维纠正：local Dock 必须保持运行

收口时曾误关闭 standalone Dock，造成 PC 的 `8766` OTA bootstrap 与 `8765` WebSocket 同时没有 listener。用户及时指出，这会使机器人无法按当前本地 Dock 架构正确进入系统；该停止动作属于运维错误，不是机器人或固件故障。

随后通过正式 `start-xiaozhi-dock.ps1` 恢复服务，进程 PID=`31688`，`8765/8766` 均重新监听；机器人 `192.168.0.8` ping=`3/3`。最终运行规则：local Dock/bootstrap 是产品运行期依赖，尤其机器人启动时不得关闭，收口后保持运行。不记录凭据。

## 是否需要另一只麦克风录相同内容

当前已有 RX-only TDM golden 作为直接设备基准，已经足以拒绝 standard-stereo 产品麦克风并推进单变量 RX 修复，因此不要求用户现在额外录制。若修复后仍需区分房间、距离或说话内容差异，再用另一只已知清晰的麦克风同位置、同距离、同一句话同步录制，作为时间对齐的声学参考；在此之前增加参考录音不会替代设备路径修复。
