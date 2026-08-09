# StackChan Wi-Fi Audio 启动诊断记录

> 状态：进行中
> 最近更新：2026-08-06
> 关联设计：[Wi-Fi 麦克风 PoC 设计](stackchan-wifi-audio-poc-design.md)

## 记录目的与边界

本记录只沉淀本轮 Wi-Fi Audio 启动问题的可复核证据、已排除范围和下一步实验。它不记录 Wi-Fi 密码、PC Dock 配对密钥或任何可用于连接的机密参数；这类数据只能在受控的本地配置中提供给设备或工具。

本轮设备身份如下：

| 用途 | 地址 | 说明 |
| --- | --- | --- |
| Wi-Fi / eFuse factory MAC | `44:1B:F6:E2:78:A8` | 用于串口下载模式和镜像写入前的设备身份核验。 |
| BLE 广播地址 | `44:1B:F6:E2:78:AA` | 用于 Windows 上的 BLE 配网及状态查询。 |

## 现象：完整 transport 镜像的启动复位

完整 Wi-Fi Audio transport 版本曾在设备上连续重启。串口证据的稳定特征是：

1. PSRAM 初始化输出 `Reserving pool of 64K of internal memory for DMA/internal allocations` 后立即出现 `RTC_SW_CPU_RST`。
2. 在每轮复位前均未看到应用侧的 `BOOT-DIAG` 或 `WIFI-AUDIO` 日志；因此故障发生在这些应用诊断点之前。
3. 从 coredump 分区读取到的内容没有有效 dump，不能据此恢复 panic 栈。

这说明“完整 transport 可达依赖图”会影响启动。随后的一项架构修正已让完整传输层稳定运行（见下文），但**尚未把早期复位归因到唯一的底层实现点**。现有证据不足以断言是某个静态构造、链接布局、网络库、codec、WebSocket 或任务创建点；这些只能作为待验证假设，而不是结论。

## 分段二分与当前设备状态

为将“是否调用 transport”与“完整 transport 依赖图被链接进镜像”分开，固件定义了三档启动二分：

| 阶段 | 作用 | 实机状态 |
| --- | --- | --- |
| Stage 0 | 完整 Audio/Dock transport。 | 曾触发上述连续 `RTC_SW_CPU_RST`。 |
| Stage 1（transport link probe） | 保留 Wi-Fi 应用启动分支，但 `start_stackchan_wifi_audio_dock_mvp()` 仅返回 `ESP_OK`，不创建 transport task，使链接器可丢弃 transport 依赖图。 | 已验证稳定；镜像大小 `3,797,968 B`，独立 `verify_flash` 已通过。 |
| Stage 2（network-only） | 仅创建网络启动任务和私有构建 Wi-Fi 关联路径；Dock、codec、PCM 与 WebSocket transport 仍不纳入该阶段。 | 已以 `3,803,344 B` 刷入并独立 `verify_flash`。它同样连续 `RTC_SW_CPU_RST`，最后日志仍停在 PSRAM reserve 后；随后已回刷 Stage 1。 |
| Stage 3（credentials-only） | 创建 transport task 并仅写入私有构建 Wi-Fi 凭据，不调用 `GetHAL().startNetwork()`。 | 二分期间的稳定基线；镜像大小 `3,798,416 B`，独立 `verify_flash` 通过，设备稳定且重新出现在 BLE 扫描中。 |
| Stage 4（network only） | 创建 transport task 并仅使 `GetHAL().startNetwork()` 可达，不写入凭据。 | 已以 `3,802,912 B` 刷入并独立 `verify_flash`；未保持 BLE 广播，复现连续 `RTC_SW_CPU_RST`。随后已回刷 Stage 3。 |

Stage 1 的实机稳定信号包括：设备仍可 BLE 广播，并且通过配置特征写入 `getWifiStatus` 得到 `wifiDisconnected`。这只证明应用循环、BLE 配置服务和状态响应在 Stage 1 可用；它不证明 Wi-Fi 已关联，也不证明 PC Dock、音频或 Codex Voice 端到端可用。

## 完整 transport 的稳定化与当前实测

复发重启后，已移除 `app_main` 中与 BLE 配网服务重叠的网络启动边界。现在由 `WifiConfigServer` 持有的 `StackChanWifiStation` 负责实际关联；Wi-Fi Audio transport 不再重复启动网络，而是等待站点已关联后才创建 Dock 连接。

传输层同时收紧了连接生命周期：当前 WebSocket 由互斥锁保护的 `shared_ptr` 持有和替换，断连或创建失败后以 2 秒间隔重试。该改动避免旧连接回调与新连接争用同一 socket 所有权。它是已确认的稳定化设计，不应反推为早期 `RTC_SW_CPU_RST` 已被唯一、精确地归因。

当前完整 transport 镜像已只写入 `ota_0` 的 `0x20000` app 分区，大小为 `3,819,296 bytes`；写入后独立 `verify_flash` 通过。现场已不再连续重启，并取得以下实测证据：

| 链路 | 实测结果 | 可以得出的结论 |
| --- | --- | --- |
| BLE Wi-Fi 状态 | 自动状态为 `wifiConnected`。 | 设备已完成站点关联。 |
| 设备到 Dock | Dock 完成认证连接。 | 认证握手和实际 TCP 会话均已成立。 |
| Wi-Fi PCM | 至少收到 `1,501` 帧、`720,480 bytes`、`gaps=0`。 | 实际 24 kHz PCM 已连续到达 Dock；这不是仅有连接事件的假阳性。 |
| Windows 虚拟音频 | 原 DirectSound 24 kHz 路径产生静默；切换为 WASAPI 48 kHz 输出并作 2 倍重采样后，VB-CABLE 回环和真实 Wi-Fi PCM 均为非零：`144,000` samples、`96,497` nonzero、peak `683`、RMS `137.53`。 | 虚拟声卡链路能够接收真实 Wi-Fi 音频，且已排除该轮的“24 kHz DirectSound 静默”问题。 |

Windows 防火墙的 Public profile 不是当前阻塞点：已有实际设备到 Dock 的 TCP 会话。此结论只针对本机当前会话与监听配置，不等同于所有网络环境均无需防火墙规则。

## 2026-08-05：虚拟输入无声回归与 socket 回调修复

用户首先观察到 Windows 系统录音器没有输入。此时设备到 Dock 的历史接收计数仍为 `84,001` 帧、`40,320,480 bytes`、`gaps=0`，但直接采集 VB-CABLE 的 `CABLE Output` 得到 `144,000` samples 且全部为零。这个组合说明此前的 Wi-Fi 接收统计不能单独证明最终虚拟录音输入有声。

VB-CABLE 自带测试音回环成功；播放器以相同参数写入 `RawOutputStream` 的测试也成功。因此，故障范围从驱动安装或 48 kHz WASAPI 输出能力前移到 Dock 运行时的 PCM 会话/连接状态，而不是 VB-CABLE 本身。

重启 Dock 后，一度出现认证成功、`get_status` 成功和 `dock_connected`，但 PCM 计数为 `0`。代码检查确认旧 WebSocket 的 `OnConnected`、`OnData`、`OnDisconnected` 或 `OnError` 回调没有 socket 身份校验；旧连接的迟到回调可能在新连接已建立后清空全局 `s_ready`，从而阻止音频任务发送。

修复为：每个回调仅捕获 `weak_ptr<WebSocket>`，先锁定为当前对象，再经 `is_current_socket()` 确认它仍是全局活动 socket；旧连接的回调不再改变 `s_ready` 或传输状态。最新镜像大小 `3,820,800 bytes`，SHA-256 为 `2C928E035D936D53E1336DC6E049C3258562FA4040DB970DCD510349623F4866`；仅写入 `ota_0` 的 `0x20000` app 分区，刷写与独立 `verify_flash` 均通过。

修复后的同一链路证据如下：

| 层级 | 实测结果 | 结论 |
| --- | --- | --- |
| Wi-Fi 到 Dock | `1,001` 帧、`480,480 bytes`、`gaps=0`。 | 新连接的 PCM 流重新连续到达。 |
| Dock 播放器 | `1,000` 帧、`input_peak=32768`、`underflows=0`、`active=true`。 | 接收 PCM 实际进入 WASAPI 播放器，未因缺帧静默。 |
| `CABLE Output` | `144,000` samples、`90,063` nonzero、peak `2631`、RMS `282.379`。 | Windows 虚拟录音端已存在来自真实 Wi-Fi PCM 的非零音频。 |

这一轮将“Wi-Fi 到 Dock 有统计但系统录音器无声”的问题归因边界收窄到旧 socket 回调污染会话状态，并以端到端非零回环证据验证了修复。它不替代用户对系统录音器或 Codex 的实际交互确认。

## 2026-08-05：用户录音与音色失真假设

用户提供的系统录音 `D:/Users/chany/Documents/录音/录音.m4a` 已离线解码并分析：格式为 48 kHz、16-bit、双声道（两声道样本相同），时长 `17.28 s`。波形没有持续削波；按 10 ms 帧边界检查的导数异常假设不成立；基频候选主要约为 `90–110 Hz`。因此，这份录音不支持“采样率标签错误”或“整段音频被整体倍速/高音播放”的解释。

源码对照确认，USB 和 Wi-Fi 的设备端采集格式相同：24 kHz、16-bit、单声道、每 10 ms `240` samples。当前差异在 Windows 侧：Wi-Fi 的 `vb_cable_player.py` 通过零阶保持（每个样本复制两次）升采样至 48 kHz，而 USB 路径由 Windows 标准采样率转换器处理。零阶保持是当前首要的音色失真假设，但尚未通过对照实验验证，不能据此宣称它是已确认根因。

最小 A/B 实验应固定同一份原始 24 kHz PCM、VB-CABLE 端点、音量、录制路径和时长，只改变 24→48 kHz 的升采样算法：

1. 当前 duplicate（零阶保持）基线；
2. linear（线性插值）；
3. polyphase（带抗成像滤波的多相重采样）。

分别比较录音听感、频谱和同一帧/欠载统计，才能决定是否替换当前升采样实现。

## 2026-08-05：机器人停机的证据边界

机器人随后自动关闭不是主代理发起的操作。关闭后 COM7 与 BLE 均消失，Dock 只保留陈旧 TCP 状态；这符合设备实际停机或掉电，而非仅 Dock 进程断开的表现。现有证据尚不能区分设备崩溃与供电中断，后续若复现应优先保留电源、串口和 BLE 消失的先后证据。

## 已采取的工具修正

Windows BLE provisioning 脚本已改为：先扫描并解析到 `BLEDevice`，再将该扫描结果传给 `BleakClient` 连接。原因是 WinRT 后端在广告缓存过期后，使用裸 MAC 地址连接并不稳定；保留扫描返回的原生设备引用能避免这一路径。

这项修正现已具备端到端结果：设备的自动 BLE Wi-Fi 状态为 `wifiConnected`，并且后续 Dock 已完成认证连接和 PCM 接收。文档仍不记录 SSID、Wi-Fi 密码或配对密钥。

## 2026-08-05：官方开发资料与 CoreS3 音频硬件真值

此前把 Wi-Fi buffer 的 index 1 当作第二颗物理麦克风，是一次无效实验。官方原理图、ES7210 数据手册和 Espressif 驱动源码交叉核对后，CoreS3 的音频输入真值如下：

| ES7210 TDM slot | 芯片通道 | CoreS3 电气连接 | 诊断含义 |
| --- | --- | --- | --- |
| `slot0` | Channel 1 / MIC1 | 物理麦克风 1 | 第一颗真实麦克风 |
| `slot1` | Channel 3 / MIC3 | AW88298 扬声器输出的 `AEC_P/N` | 扬声器电气回声参考；不是物理麦克风 |
| `slot2` | Channel 2 / MIC2 | 物理麦克风 2 | 第二颗真实麦克风 |
| `slot3` | Channel 4 / MIC4 | 未连接 | 噪声底/空槽 |

ES7210 的 TDM 串行顺序是 `1, 3, 2, 4`，不能按自然编号 `1, 2, 3, 4` 解释。CoreS3 产品页所称的“双麦克风”对应 MIC1 和 MIC2；MIC3 是 ADC 第三路输入，但板上被用作扬声器参考。

### 官方资料索引

- [M5Stack CoreS3 产品页](https://docs.m5stack.com/en/core/CoreS3)：确认 ES7210 双麦输入和 2.4 GHz Wi-Fi。
- [CoreS3 v1.0 原理图](https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/docs/datasheet/core/K128%20CoreS3/Sch_M5_CoreS3_v1.0.pdf)：第 4 页给出 MIC1、MIC2、`AEC_P/N -> MIC3P/N` 及未使用 MIC4 的实际连接。
- [ES7210 数据手册](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/6/7563.ES7210.pdf)：TDM I2S 时序图给出 Channel `1, 3, 2, 4` 的发送顺序。
- [M5Unified CoreS3 初始化源码](https://github.com/m5stack/M5Unified/blob/master/src/M5Unified.cpp#L783-L839)：官方寄存器基线给 MIC1/MIC2 相同增益，关闭 MIC3/MIC4；CoreS3 mic 配置位于同文件的 CoreS3 audio 分支。
- [M5Unified Microphone 示例](https://github.com/m5stack/M5Unified/blob/master/examples/Basic/Microphone/Microphone.ino)：可用于 16 kHz 录音、波形和回放的硬件基线，但它不展示四槽拆分。
- [ESP-IDF ES7210 四通道 TDM 示例](https://github.com/espressif/esp-idf/tree/master/examples/peripherals/i2s/i2s_codec/i2s_es7210_tdm)：48 kHz、16-bit、四槽采集并写入四通道 WAV，是本项目四槽诊断的主要实现模板。
- [ESP-SR Audio Front-End](https://docs.espressif.com/projects/esp-sr/en/latest/esp32/audio_front_end/README.html)：规定 `M` 为麦克风、`R` 为播放参考、`N` 为未使用，双麦加参考示例格式为 `MMNR`，输入需按声明顺序交错。

### 可借鉴但不作为官方保证的社区资料

- [Moddable CoreS3 ES7210 PR #61](https://github.com/Moddable-OpenSource/moddable-jp/pull/61)：复刻 M5Unified 的 MIC1/MIC2 标准 I2S stereo 路线；PR 尚未合并。
- [stack-chan 双向 Realtime/AEC PR #634](https://github.com/stack-chan/stack-chan/pull/634)：给出 CoreS3 全双工 TX/RX 和以实际播放 PCM 作为软件 AEC reference 的真机路线；PR 尚未合并。
- [M5CoreS3 ESPHome Voice PR #37](https://github.com/m5stack/M5CoreS3-Esphome/pull/37)：可作为 16 kHz 单麦、引脚和增益基线，不是双麦实现，且已关闭未合并。
- [moddable-webrtc CoreS3 mic diagnostics PR #17](https://github.com/meganetaaan/moddable-webrtc/pull/17)：四槽诊断和原始 PCM A/B runbook 可供参考，但仍是 draft，不能当作已完成真机验收。

### 本地实现冲突与已纠正的诊断解释

本地 `cores3_audio_codec.cc` 选择了 `MIC1 | MIC2 | MIC3`，初始化 RX 时也配置了四槽；但 `EnableInput()` 随后以 `channel = 2`、`mask = slot0 | slot1` 打开输入。`esp_codec_dev` 会把 `total_slot` 直接重配为 `fs.channel`，因此形成“ES7210 三路输入/四槽 TDM，ESP32 RX 两槽”的时钟与帧结构冲突。

当前实验固件又把 Wi-Fi `kWifiMicrophoneChannel` 设为 `1`。即使先忽略两槽/四槽冲突，按 ES7210 的固定串行顺序，index 1 也是 MIC3/AEC reference，而不是 MIC2。该路在扬声器闲置时只有很小的电气噪声是符合预期的，不能用于判断第二颗物理麦是否故障。

这段曾提出“下一版使用稀疏 `slot0 | slot2`”的设想，已被 2026-08-06 的 RX-only golden diagnostic 取代：决定性采集必须完整保留 slot0--3，才能同时验证帧结构、真实映射和未连接控制槽。最终产品修复若只输出双物理麦，仍需在原始四槽证据成立后再决定压缩与重排方式。codec 的物理增益 mask 与 I2S slot mask 是两套不同编号，不能混用；送入 ESP-SR 时还应显式重排为 `M,M,N,R`。

## 2026-08-05：重采样 A/B 与错误声道实验结论

同一份原始 24 kHz PCM 已分别通过 duplicate、linear 和 polyphase 三种方式转换到 48 kHz。三版听感都只有相近的环境/电流声且没有可辨人声，因此零阶保持不是“无可辨语音”的主因；它可以影响音色，但不能解释三种重采样都缺少人声。

物理 MIC1 的旧样本 RMS 约 `395.3`、peak `12943`；当时所谓“MIC2”的样本 RMS 约 `4.60`、peak `74`。后者现已确认来自 MIC3/AEC reference，并且采集时扬声器闲置，所以接近静音不是第二颗物理麦失效证据。由于旧 MIC1 样本也处于四槽设备被两槽 RX 打开的冲突配置下，真实 MIC1/MIC2 A/B 必须在修正帧结构后全部重录。

## 2026-08-05：双物理麦诊断固件构建记录

同一份源码分别只切换 `CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC`，生成了两个 app-only 诊断镜像。其余 TDM 槽位、采样率、codec 增益、网络协议和 Windows 路径均保持一致：

| 物理麦 | 镜像 | 大小 | SHA-256 |
| --- | --- | ---: | --- |
| MIC1 | `tmp/stackchan-wifi-audio-physical-mic1-20260805.bin` | `3,820,448` | `5DEC487E5FE4C743313C05AB9905FCF46AB463F10B5211B881A7986C8E83E79F` |
| MIC2 | `tmp/stackchan-wifi-audio-physical-mic2-20260805.bin` | `3,820,464` | `8DA4C4C567C62B3C0F6946E0016B491859448F3C6C3DFC05533BA70C6ED66C76` |

两版均在 ESP-IDF 5.5.5 下完成链接和 app 分区尺寸检查；镜像约占最小 app 分区的 74%，仍有约 26% 空间。固件静态契约测试为 `30/30` 通过。

Windows 构建系统仍有两个与固件逻辑无关的生成问题：短路径 build 的 toolchain response file 可能自引用，且最终 `project_elf_src` 的 definitions/includes 会超过命令行长度。每次重新配置后，需要移除 response file 的自引用/重复 `nano.specs`，并让最终 C 编译规则把 definitions/includes 放入 rspfile。它们是 build 目录内的生成修正，不应提交为产品源码。

## 2026-08-05：真实 MIC1/MIC2 首轮同条件 A/B

MIC1 镜像写入 `ota_0` 后，`esptool` 报告写入数据 hash 校验成功，但其 `Hard resetting via RTS pin` 没有让本机 CoreS3 可靠退出下载状态，设备一度黑屏且未恢复 Wi-Fi。用户执行实体复位后，应用正常启动，并于 `23:38:16` 新建到 PC Dock 的连接。该现象说明本轮黑屏不能归因于 MIC1 应用崩溃；后续 app-only 刷写均以释放所有按键后的实体短按 RST 或断电重上电作为启动边界，不能仅信任 RTS 提示。

首轮 A/B 固定相同固件逻辑、四槽 TDM、`slot0 | slot2` 稀疏采集、Wi-Fi/Dock/VB-CABLE 链路、48 kHz 双声道 Windows 录制与 15 秒时长，只切换 `CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC`：

| 路由 | 录音 | peak | RMS | 300--3400 Hz 能量占比 | 主导频率 | 主观结果 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| MIC1 | `tmp/wifi-audio-physical-mic1-48k-20260805-233909.wav` | `2941` | `154.0` | `57.0%` | `233.3 Hz` | 能听到人声，但极度模糊、几乎不可辨，并有明显噪声 |
| MIC2 | `tmp/wifi-audio-physical-mic2-48k-20260805-234824.wav` | `3771` | `146.5` | `36.1%` | `42.3 Hz` | 主要是环境音，几乎没有有效人声；同样有明显雨噪/老电视调频式噪声 |

两路均取得大量非零样本，证明 PCM 能穿过 Wi-Fi、Dock 与 VB-CABLE，但两路总体电平接近，MIC2 的语音频带占比没有相对 MIC1 提升，且低频干扰更强。用户试听原始/等峰值放大样本后，确认 MIC1 含有人声但极度模糊，MIC2 则主要是环境音；两路都有明显雨噪/调频噪声，放大不能恢复可辨语音。该结果排除了“只是 Windows 播放音量太低”，但不能把两路简化为完全相同的故障：共同噪声优先指向共享的 codec/I2S/PCM 链路，MIC2 缺少有效人声还需单独核对声道映射、麦克风使能、增益与硬件方向性。下一步应先通过资料和离线证据收敛 ES7210 数字格式、有效位对齐、时钟及运行态寄存器，再决定唯一一次有判别力的真机实验。

## 可复用的诊断方法

- 每次写入前，以下载模式读取芯片身份，确认 factory MAC 为本文记录的 Wi-Fi MAC。
- 仅写入目标 app 分区；写入工具自身的 hash 成功信息之外，在不会打断当前运行态验收时再执行独立 flash 校验。若校验重新进入下载模式，必须实体复位后再采集应用证据。
- 每个阶段写入后，收集限定时长的串口日志，并同时观察设备是否保持应用循环、触摸表情和 BLE 广播。
- 需要查询网络状态时，通过 BLE 配置特征调用非机密的 `getWifiStatus`；日志只记录状态枚举，不记录 SSID、密码、端点中的机密部分或配对密钥。
- 在 Windows 上运行 provisioning 工具时，先执行 BLE 扫描并将扫描到的设备对象用于连接；命令参数中的 Wi-Fi 密码和配对密钥不应进入 shell 历史、日志或本文档。

## 2026-08-06：RX-only golden diagnostic 构建与测试

用户确认现场没有逻辑分析仪，因此采用唯一替代路线，不再为不同猜测分别刷写：固件只创建 RX I2S channel，按 24 kHz、16-bit Philips、四槽 TDM 完整读取 slot0--3；TX/扬声器在诊断模式中不可启用。每次 10 ms DMA 读取检查返回码、实际字节数和四槽 frame 对齐，失败时清零并返回失败，不能发送旧缓冲。

同一次读取继续向当前已认证 Dock WebSocket 发送目标物理麦的 mono 对照流，并将四槽原始 PCM 拆为两个 5 ms UDP 单播包。每包 `24-byte header + 960-byte PCM = 984 bytes`，避免超过现有 1024-byte 边界。PC 接收器保存原始 PCM、四声道 WAV、四个 mono WAV、ES7210 关键寄存器快照、sequence gap 和每槽 RMS/peak/near-zero 指标。slot3 对应未连接的 MIC4，只用作控制槽。

构建与验证结果：

| 项目 | 结果 |
| --- | --- |
| ESP-IDF | `5.5.5` 完整构建、ELF 链接、ESP32-S3 BIN 生成及 app 分区尺寸检查通过 |
| 诊断配置 | RX-only=`true`；UDP port=`8766`；mono 对照选择 MIC1 |
| 固件静态契约 | `35/35` 通过 |
| Dock Node 测试 | `30/30` 通过 |
| Dock Python 测试 | `10/10` 通过，其中 RX4 严格包解析新增 `4/4` |
| 镜像 | `tmp/stackchan-wifi-audio-rx4-golden-diagnostic-20260806.bin` |
| 大小 | `3,821,264 bytes`；最小 app 分区仍有约 `26%` 空间 |
| SHA-256 | `D0DF3EA06789733EDFCF24157BDAB6F4096F44C35199D552FCABDE8C14BAB581` |

候选的源码 HEAD、dirty 范围、配置摘要、文件哈希、精确验证命令和原始日志已固化到 `docs/research/evidence/rx4-golden-20260806/candidate-manifest.md`。本轮没有重启当前 Dock，也没有刷写设备。Windows 生成器仍需对最终占位 C 编译使用 response file，并移除短路径与绝对路径重复加载的 `nano.specs`；这些只修改 build 目录生成文件，不属于产品源码。下一步是唯一一次实机刷写、实体复位，然后采集同一时段的四槽原始 PCM、寄存器、read 完整性和 mono PC 对照。

## 2026-08-06：RX-only 决定性实机采集

候选 app-only 镜像已写入 `ota_0`：factory MAC 为 `44:1b:f6:e2:78:a8`，串口 `COM7`，写入范围从 `0x20000` 开始，镜像长度 `0x3A4ED0`。esptool `4.12.0` 报告写入数据 hash 验证成功；随后对同一范围执行独立 `verify_flash`，结果为 `digest matched`。实体 RST 后设备从 `192.168.0.8` 重新连接原 Dock PID `34744`，未重启 Dock。

40 秒接收窗口取得 `6,644` 个音频包、`802,320` 个四槽 frame（含显式缺包补零），约 `33.43 s` PCM。首末音频 sequence 为 `1/6686`；发生 `20` 次 gap、共 `42` 个 5 ms 包缺失并补零，另有 `42` 个迟到/乱序包被判无效，影响约 `0.63%` 的 sequence 空间。该网络不连续性应在产品 transport 中修复，但不足以解释此前贯穿录音的鸭声与雨噪。

七次 ES7210 快照从设备时间约 `6.12 s` 到 `38.18 s` 完全一致：`00=41, 01=20, 02=C1, 04=01, 05=00, 06=00, 07=20, 08=10, 11=60, 12=02, 40=42, 43..46=1A, 4B=00, 4C=00`。这证明采集期间 codec 运行态没有寄存器漂移。物理复位使预先打开的 Windows COM handle 失效，串口原始日志为零字节并记录 `ClearCommError`；因此本轮不能宣称串口侧已证明 `RX4-READ failure=0`，但寄存器证据已由独立 UDP snapshot 保存。

固定动作可从波形中分为：左侧敲击 `5–7 s`、右侧敲击 `9–12 s`、三次固定短句 `14–22 s`、安静基线 `22.5–29.5 s`。客观结果：

| 槽 | 电气含义 | 人声 RMS | 安静 RMS | 人声/安静 | 人声 300–3400 Hz | 人声谱平坦度 | 人声削波 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| slot0 | MIC1 | `1353.3` | `67.6` | `26.03 dB` | `84.19%` | `0.1025` | `0.0453%` |
| slot1 | MIC3/AEC | `14.6` | `14.8` | `-0.10 dB` | `3.76%` | `0.1351` | `0%` |
| slot2 | MIC2 | `1104.5` | `72.0` | `23.71 dB` | `82.31%` | `0.0859` | `0.0240%` |
| slot3 | 未连接 MIC4 | `5.32` | `5.44` | `-0.18 dB` | `41.17%`（低电平噪声占比，无声学响应） | `0.2853` | `0%` |

MIC1/MIC2 的人声段相关系数为 `0.853`，两路都呈现清晰的音节包络、谐波/共振结构和 20 dB 以上声学动态；AEC 与空槽保持固定低电平，没有跟随说话。这是“两颗物理麦、ES7210 使能、四槽映射和 RX-only DMA 能取得结构化语音”的正证据。敲击及少数强音节可到满幅，但人声削波低于 `0.05%`，不是旧录音整体不可辨的主因。

用户随后直接试听同一 run2 的 `slot0_mic1-24khz.wav` 与 `slot2_mic2-24khz.wav`，确认“两路声音很清晰”。因此这一轮不仅有波形、频谱和 SNR 的客观正证据，也完成了可辨识度的人工复核；该结论仅适用于 RX-only 原始采集，不提前外推到同时播放、VB-CABLE 或 Codex Desktop Voice。

因此，旧鸭声的根因边界已从麦克风硬件、Windows 采样率标签和重采样算法前移到 RX-only golden 与旧链路之间的差异：共享 I2S 上 TX STD/RX TDM mixed-mode、`esp_codec_dev` channel packing，或未传播实际 read 长度的读取路径。现有证据已排除“MIC1/MIC2 都损坏”，但单次 golden 采集同时改变了这三个变量，不能虚构为已精确定位到其中某一行。最小产品修复应以 golden RX 数据路径为基线，再选择与 CoreS3 共享时钟硬件一致的扬声器下行格式，并让采集与网络发送解耦。

官方实现进一步收敛了产品修复：M5Unified 在 CoreS3/StackChan 上让麦克风与扬声器共用 I2S1、GPIO34 BCLK 和 GPIO33 WS；麦克风只启用 MIC1/MIC2，使用 16-bit standard-I2S stereo，AW88298 也明确使用 `16*2` BCLK frame。本地 Espressif ES7210 驱动只有在选择至少三路麦克风时才切入 TDM。候选修复因此只选择 MIC1/MIC2，并让 TX/RX 都保持 24 kHz、Philips STD、2×16-bit；TX 设备也以双声道打开，现有 mono 输出在 `Write()` 中复制到 L/R，避免 codec data interface 再把 TX 扩成 2×32-bit 而破坏共享帧。产品麦克风读取继续要求 DMA 返回长度精确匹配，增益固定为已验证清晰的 30 dB。

原始证据位于 `docs/research/evidence/rx4-golden-20260806/run2/`：四槽 WAV、四个 mono WAV、原始 PCM、metadata、每个音频文件 SHA-256、完整波形 JSON 和 MIC1/MIC2 诊断图均已保留。

## 2026-08-06：扬声器“电报声”的独立声学诊断

matched-STD 产品候选已 app-only 写入并由独立 `verify_flash` 确认 digest matched。实体复位后，Dock 在 `192.168.0.11:8765` 接受机器人连接；麦克风上行持续超过两万帧且 `gaps=0`，VB-CABLE `underflows=0`。PC 通过本地命名管道发送 24 kHz、mono、s16le 的 660 Hz 测试音，用户最初描述为急促“电报声”，随后补充为前期卡顿、后段连续单音。

机器人自身麦克风回采可见停声，但其近场声学通路把能量主峰推到约 `1.26--1.40 kHz`，不能用来判断真实输出音高。随后改用电脑 Realtek 实体麦克风、44.1 kHz 单声道、靠近机器人扬声器独立录音，完全绕开机器人麦克风、Wi-Fi 上行和 VB-CABLE：

| 证据 | 结果 | 结论 |
| --- | --- | --- |
| 外部录音频谱 | 目标邻域主峰 `660.0 Hz` / `659.96 Hz` | 下行采样率、声道复制与实际音高正确，不存在频率翻倍。 |
| 首轮靠近录音 | tone span `5.70 s`，有效占空比约 `77.0%`，最长内部停声 `620 ms`，三段停声超过 `100 ms` | 用户听到的卡顿有独立声学波形正证据。 |
| 发送延迟插桩轮 | 500 帧回调最大 `0.591 ms`，`slow_sends=0`；同轮外部录音最长停声 `440 ms`，三段超过 `100 ms` | 停声不由 PC WebSocket 逐帧回调阻塞造成，边界位于设备接收、队列或 I2S TX。 |
| 同期上行 | 麦克风 sequence `gaps=0`，VB-CABLE `underflows=0` | 不是 Dock 整体网络会话或 Windows 音频播放器中断。 |

可复现基线保存在 `docs/research/evidence/matched-std-duplex-20260806/`。`speaker-external-realtek-close-analysis/tone-continuity.json` 和 `speaker-external-realtek-instrumented-analysis/tone-continuity.json` 由 `tools/wifi_audio_analysis/analyze_tone_continuity.py` 生成；它按精确目标频率的短时相关幅度识别有效 tone frame，忽略不足 100 ms 的孤立噪声 burst，并以内部停声不超过 100 ms 作为当前连续性门槛。

设备端原实现只有收到一帧才调用一次 `i2s_channel_write`，空闲时六个 10 ms DMA descriptor 会长期饿空；队列虽然有八帧容量，但没有起播预缓冲，消费者通常紧跟到达帧，不能吸收 Wi-Fi 抖动。最小后继候选因此保持 TX DMA 持续写静音，把队列扩为 12 帧，起播前积累 4 帧（40 ms），并公开 `received_frames`、`played_frames`、`silence_frames`、`underruns`、`queue_drops` 与 `sequence_gaps`。该候选已通过 39 项固件契约、32 项 Dock Node 和 10 项 Dock Python 测试，并完成 ESP-IDF 5.5.5 产品模式构建；其后已刷入实机，结果见下一节。

## 2026-08-06：jitter-buffered 候选烧录与失败复测

jitter-buffered app 镜像大小为 `3,821,472 bytes`（`0x3A4FA0`），SHA-256 为 `BC1D8FA87778330746150CAF91C04065311A2E1F8E278ACC5D10FEFA5F69B54F`。该哈希已从工作区现存镜像重新计算。镜像只写入 `ota_0` 的 `0x20000` 起始范围；写入 digest 检查通过，随后对 `0x20000 + 0x3A4FA0` 执行的独立 `verify_flash` 报告 `digest matched`。刷写原始 transcript 没有另存为 evidence 文件，因此这里只记录现场终端已回读的结果，不把它伪装成可单独下载的日志。

实体复位并回连后，第一次设备状态中的扬声器计数为：`received=0`、`played=0`、`silence=34`、`underruns=0`、`queue_drops=0`、`sequence_gaps=0`。同一日志窗口内，麦克风上行保持 `gaps=0`，VB-CABLE 播放器保持 `underflows=0`。这证明新固件可以启动、认证并进入初始双向链路，但初始零错误计数不能替代有 tone 负载时的长期稳定性验收。

第一轮 Realtek 录音命令因设备名参数被错误拆分而未启动，`capture-stderr.log` 明确报告 `unrecognized arguments: (Realtek(R) Audio) WASAPI`，因此该轮没有可用录音。tone 发送仍继续到第 `133` 帧，随后 Dock 记录 `write ECONNRESET`；这一事实只能确认 WebSocket 写侧连接被重置，不能从单条错误推导重置原因。

第二轮修正参数后生成了 8 秒、44.1 kHz 的外部 Realtek 录音 `speaker-external-realtek-660hz-run2.wav`。事后校正时间关系确认：该录音完成时机器人已经掉线。因此，虽然文件自身测得目标邻域主峰 `659.1707 Hz`、有效 tone 占空比约 `25.68%`、最长内部停声 `2,380 ms`，这些波形不能归因于机器人扬声器，也不能用来判断 jitter-buffered 候选的音高或连续性。此前把这份文件写成候选连续性失败证据的结论作废；当前 jitter-buffered 没有一份覆盖“机器人全程在线”的有效外部扬声器录音。

连接故障发生后，机器人在当时已知地址 `192.168.0.8` 上 ping 不通，同时 Windows 的 `COM7` 消失。这证明当时 Wi-Fi 与 USB 串口两个观测面都不可达，但没有串口 reset reason、panic 栈、有效 coredump 或电源测量，尚不能区分固件 panic、watchdog、反复复位、掉电/brownout 或其他运行态故障。第一轮 `ECONNRESET` 与后续完整离线也不能在缺少时间对齐诊断的情况下直接视为同一根因。

用户随后拔除 USB，让机器人仅靠自带电池启动。此时没有 COM7 是预期边界，而非故障信号；设备一度恢复 `192.168.0.8 ping=true`，并与 Dock `192.168.0.11:8765` 建立连接。`dock-stdout.log` 记录 fresh connect，PCM 计数从 `3001` 继续增长到 `4501`，各检查点 `gaps=0`。这是无 USB 条件下 Wi-Fi 关联、Dock 认证和麦克风 transport 短时工作的正证据，但持续时间不足以完成稳定性验收。

同一无 USB 窗口内，从 `CABLE Output` 录制的 8 秒文件被离线分析为全程数字静音：`digital_silence_frame_fraction=1.0`、最长数字静音 `8.0 s`、帧动态范围 `0 dB`。与此同时，旧 Dock 的 `vb_cable_player` 子进程仍存活，日志中的 `input_peak` 持续非零且 `underflows=0`。因此，Wi-Fi PCM 已到 Dock 且 player 仍在消费输入，但 Windows 录音端收到静音。

随后执行纯 PC 的 `CABLE Input -> CABLE Output` 660 Hz 闭环控制，测得主峰 `660.396 Hz`、有效占空比 `99.01%`、内部 gap=`0`、`continuity_pass=true`。这证明 VB-CABLE 驱动和端点本身当时可以由新建 PC 流正常传递音频；旧 Dock WASAPI 输出流失效是当前首要假设，但尚未确认具体机制。重启 Dock 以重建 WASAPI 流后，新 Dock 只到达监听状态，机器人没有回连，`192.168.0.8` 再次 `ping=false`，所以无法完成重建流的机器人 PCM 端到端复测。

用户明确报告“机器人崩溃之后，无法重启”：实体按下 RST 后只出现短暂闪屏，随即再次崩溃/离线，没有完成可用启动。这与 ping 再次失败和 Dock 无回连共同构成生产阻断；不能因为电池模式曾短暂恢复 Wi-Fi 麦克风，就把当前候选标记为可用。现有证据仍无法区分 panic、watchdog、brownout/掉电、电源锁死或其他运行态故障，也不能证明 WASAPI 流失效与机器人崩溃具有同一根因。

完整候选身份、日志边界、录音哈希和连续性 JSON 索引保存在 `docs/research/evidence/jitter-buffered-20260806/candidate-manifest.md`。

### 2026-08-06 19:34--19:37：摸头触发舵机动作后的整机离线复现

Dock 启动后，机器人完成连接，麦克风 PCM 上行持续增长并稳定到约 `frames=4001`。用户随后摸头，机器人产生了舵机动作；动作之后，网络连接、`COM7` 和 Windows 中整个 `VID_303A` USB 设备同时消失。串口采集窗口内没有出现 panic、WDT 或新的 boot 输出，因此本轮没有可用于归因的软件异常栈或 reset reason。

设备恢复行为与此前现场现象一致：单独按 RST 曾不足以恢复完整启动，而左侧电源键可以完成整机重新上电。本轮观察到的“重启”是用户手动按键触发，不是机器人自动重启；不得把手动恢复误记为设备自行 reboot。

该现象已按**已复现、未修复的生产阻断 Bug**记录。当前时间关联支持“摸头 -> 舵机动作 -> 网络与整条 USB 同时消失”，但证据边界必须保留：尚未证明 Dock 单独运行会导致崩溃，也未证明每一次或所有舵机动作都会触发崩溃。用户认为它类似底层 `2.0.42` 曾修复的舵机 Bug；在取得对应版本修复记录、代码差异或底层日志前，这只是有价值的根因线索，不是已确认归因。

为隔离变量，当前 Wi-Fi 功能测试暂时禁止摸头和主动舵机动作，只验证网络、Dock 与音频链路。该限制仅用于减少干扰变量，不构成修复，也不能作为整机稳定性验收通过的依据。

## 未完成验收与后续顺序

1. 按用户 2026-08-06 的阶段性决定，先在禁止摸头和主动舵机动作的隔离条件下继续 Wi-Fi Codex Voice 功能链；先验证 Dock、麦克风、VB-CABLE，再以低音量验证扬声器下行。
2. 在 Codex Desktop Voice 中明确选择对应录音输入，完成一次真实语音识别与回复链路；全过程回读设备在线状态和音频计数。
3. 舵机动作后整机掉电保留为独立的生产阻断 Bug，后续专项恢复 2.0.42 修复差异、串口/reset reason、电源遥测与舵机总线日志；未修复前不得宣称整机可投入生产。
4. 重录 660 Hz tone 时，必须证明机器人在整个录音窗口在线，并周期回读 `received/played/silence/underruns/queue_drops/sequence_gaps`，把每个声学停声与设备计数对齐。
5. 最终生产验收仍需物理拔除 USB 数据线并重新覆盖 Dock、麦克风、扬声器、触摸/表情、舵机与 Codex Desktop Voice；当前隔离验收不能替代该项。

## 2026-08-06：真实语音后半段严重卡顿与 Wi-Fi 省电根因证据

Windows 中文 TTS 通过 `Realtek Speakers -> Stereo Mix -> activity gate -> named pipe -> Dock WebSocket -> StackChan AW88298` 播放真实句子。主机采集侧没有 overflow、queue drop 或 clipping，活动段累计送出 `859` 个 10 ms 帧；但 Dock 向设备的 WebSocket 发送出现大量 `100--930.707 ms` 阻塞，有界队列为避免播放过期音频主动丢弃超过 `500` 帧。用户确认前半段尚可、后半段严重卡顿且几乎不可辨，因此真实语音联合验收失败。主机有界队列修复只限制了延迟累积，没有解决设备不能及时接收下行的根因。

在停止 Windows 输出桥接、保持 Dock 空闲连接的条件下，对机器人 `192.168.0.8` 与同一 WLAN 网关 `192.168.0.1` 做 15 次并行 Ping A/B：机器人 `0%` 丢包，但延迟为 `97--1384 ms`、平均 `741 ms`；网关同为 `0%` 丢包，延迟为 `1--23 ms`、平均 `3 ms`。这排除了 PC 或整个 WLAN 同期拥塞，并与真实语音测试中的 WebSocket 阻塞量级一致。

源码检查确认：Wi-Fi Audio 使用隔离启动分支，不运行 Xiaozhi `Application`，因此不会进入官方语音会话调用的 `PowerSaveLevel::PERFORMANCE`；其 `StackChanWifiStation::Start()` 也没有调用 `esp_wifi_set_ps`。ESP-IDF 5.x 的默认模式为 `WIFI_PS_MIN_MODEM`，该模式允许实时接收被 DTIM 周期延迟。设备 WebSocket 的 TCP 接收任务与上行发送任务相互独立，`SetReceiveBufferSize(1024)` 在当前组件中仅赋值、未参与接收逻辑，因而扩大该值没有证据基础。

下一候选坚持单变量：关联成功后先读取当前 power-save，显式设置 `WIFI_PS_NONE`，再回读确认并记录 RSSI、信道和前后模式；失败则不启动音频 transport，而是继续重试。暂不同时关闭 BLE、修改 WebSocket 缓冲区或调整任务优先级。刷写后先以空闲 Ping 验证延迟是否从数百毫秒降到局域网实时量级，再播放一条真实语音；这样可以明确判断该修复是否成立。

该候选随后通过固件契约 `21/21`、Dock Node `33/33` 和 ESP-IDF 5.5.5 完整构建。app 镜像为 `tmp/stackchan-wifi-audio-no-ps-20260806.bin`，大小 `3,821,920 bytes`（`0x3A5160`），SHA-256 `AAF073C47C570C723307EFCF8AB77F6769CDD7EA629F19C6685226F2641EEF81`；最小 app 分区仍有约 `26%` 空间。候选身份和刷写后验收顺序保存在 `docs/research/evidence/wifi-no-ps-20260806/candidate-manifest.md`。此时设备仍运行旧镜像，尚未刷写，因此不能把源码证据写成实机修复已生效。

随后在 `COM7` 确认 ESP32-S3 revision v0.2 与 factory MAC `44:1b:f6:e2:78:a8` 后，将该镜像 app-only 写入 `0x20000`。写入工具报告数据 hash 通过，独立 `verify_flash` 对同一地址和长度再次报告 `verify OK (digest matched)`。esptool 的 RTS hard reset 仍未让本机进入应用，`192.168.0.8` 保持不可达；因此此处只证明镜像落盘正确，尚未证明 `WIFI_PS_NONE` 已在运行态生效，需实体短按 RST 后继续。

实体 RST 后，静音网络 A/B 显示机器人 15 次 Ping 从旧基线平均 `741 ms`、最大 `1384 ms` 降至平均 `30 ms`、最大 `143 ms`，同期网关平均 `2 ms`，两者均 `0%` 丢包。随后通过 BLE 轮换只存在于旧进程环境中的 Dock 配对密钥，并以 Windows 当前用户 DPAPI 密文持久化；安全启动脚本经过一次真实 Dock 重启后，机器人只建立一个认证连接，麦克风继续 `gaps=0`。

同一句 Windows 中文 TTS 再次通过真实扬声器链路播放，主机活动门共送出 `856` 个 10 ms 帧，`overflow=0`、`queue_drop=0`、`clipping=0`。Dock WebSocket 最大发送延迟从失败轮的 `930.707 ms` 降至 `0.564 ms`，`slow_sends=0`，有界 speaker pipe 没有丢帧。同期机器人 20 次 Ping 平均 `39 ms`、最大 `141 ms`、`0%` 丢包，TCP 连接和麦克风 `gaps=0` 均保持。麦克风回采在播放窗口出现满幅峰值，证明机器人扬声器实际发声，也提示 Codex Desktop Voice 前仍需确认播放期间的回声隔离策略。用户尚未给出本轮清晰度与后半段连续性的最终听感，因此此轮不能只凭网络统计标记为完整语音验收通过。

## 2026-08-06：真实语音复播再次卡顿与 TCP 接收任务证据

用户要求复播同一句真实中文 TTS 后，明确报告“播放还是卡顿”。该轮 PC Stereo Mix 采集为 `overflows=0 / queue_drops=0 / clipped_samples=0`；但重启 Dock 并读取设备累计状态后，扬声器已经出现 `received=2667 / played=2341 / queue_drops=326 / sequence_gaps=326 / underruns=72`。随后一次带源 PCM 与机器人麦克风回采的复现中，Dock 发送阻塞从第 153 帧开始升至 `539--1029 ms`，有界 speaker pipe 丢弃超过 `600` 个过期帧；这证明用户听到的停顿是下行拥塞和设备丢帧，不是 TTS 源或 Windows 采集不连续。

同一故障现场的并行 Ping 把边界定位到机器人：机器人 `10` 包仅收到 `5` 包，成功包 `457--666 ms`、平均 `540 ms`；同一 PC 到网关 `10/10`、平均 `21 ms`。停止 Dock 后，机器人改善到 `9/10`、平均 `82 ms`。再以 `set_audio` 关闭麦克风上行后，空闲 Ping 为 `6/6`、平均 `35 ms`；但只保留扬声器下行播放时仍出现最高 `524 ms` 的 WebSocket 发送阻塞、本地队列丢帧和播放期 Ping 平均 `275 ms`。因此“只是全双工带宽不够”被否定；连续 10 ms 下行帧本身就足以使设备接收路径不能及时排空。

源码与上游对照显示，锁定的 `78/esp-ml307 3.6.5` 在 `EspTcp::Connect()` 中以优先级 `1` 创建 `tcp_receive`，当前官方 `3.6.6` 仍相同。我们的 `wifi_audio` 与 `wifi_speaker` 均为优先级 `4`，协议又以 10 ms 原始 PCM 运行；相比之下，官方小智通常发送较低包率的 60 ms Opus，并在非 realtime 的 Speaking 状态关闭普通 voice processing。现有证据支持：通用低优先级 TCP receiver 在本项目高包率原始 PCM 负载下不能及时搬运下行数据，接收窗口填满后 PC 发送侧进入数百毫秒 backpressure。

最小候选不修改上游 managed component：WebSocket 握手成功后，在隔离 Wi-Fi Audio runtime 内查找唯一的 `tcp_receive` 任务，将其优先级从 `1` 提升为 `5`，并记录实际前后值；这样源码改动可持久化且只作用于本模式。对应失败先行合同已由红转绿，固件合同 `22/22`、Dock Node `33/33` 和 ESP-IDF 5.5.5 完整构建均通过。候选 app 为 `tmp/stackchan-wifi-audio-rx-priority-20260806.bin`，大小 `3,822,496 bytes`（`0x3A53A0`），SHA-256 `0E233FA4A526A38DCE3456736A637CB2D15D14650CEB4A496D6E8138CC1B6272`；最小 app 分区仍有 `26%` 空间。该镜像随后由 esptool 自动进入 ROM loader，app-only 写入 `0x20000`；写入 hash 与独立 `verify_flash` 都通过。ROM `run` 和 RTS hard reset 后机器人仍未恢复网络，符合本机既有的 post-flash 行为，需实体短按 RST 后才能进行任务优先级 A/B；在此之前不能标记为已修复。

## 当前结论

- RX-only Wi-Fi transport、写入与独立 flash 校验、Wi-Fi 关联、认证 Dock 连接和连续原始四槽 PCM 已有实测证据；用户确认 MIC1/MIC2 原始录音都很清晰。matched-STD 双向产品模式已证明麦克风上行连续、扬声器音高正确，但下行存在最长 `620 ms` 的声学停声。jitter-buffered 候选完成了实机写入和独立校验，也曾在拔除 USB 后短时维持 `gaps=0` 的 Wi-Fi 麦克风上行；2026-08-06 19:34--19:37 又在 Dock 已连接且 PCM 上行约 `frames=4001` 后，复现摸头、舵机动作、网络与整个 `VID_303A` USB 同时消失。串口没有 panic/WDT/boot 输出，用户通过实体按键手动重新上电，并非设备自动重启。该问题仍是已复现、未修复的生产阻断 Bug；掉线后生成的 Realtek 录音不能作为其扬声器连续性证据。
- 已确认的修复边界是：单一 `StackChanWifiStation` 网络所有权、关联后再启动 transport、互斥 `shared_ptr` socket 生命周期和 2 秒重试；这解释当前稳定化路径，但不等同于已证明早期复位的唯一底层根因。
- Windows VB-CABLE 驱动本身通过了新建纯 PC 660 Hz 闭环，但旧 Dock WASAPI 输出流在进程仍存活、输入峰值非零且无 underflow 时向 CABLE Output 交付数字静音；其失效机制未定。决定性采集排除了麦克风损坏，matched-STD 已纠正共享 I2S 格式。按用户当前阶段性决定，Codex Desktop Voice 功能链可在禁止舵机动作的隔离条件下继续验证；但舵机掉电 Bug 未修复，长期无 USB 整机稳定性和生产验收仍不得通过。

## 2026-08-06：接收优先级实机通过与播放优先级后继候选

接收优先级候选经实体 RST 后建立新 Dock 会话，麦克风累计超过 `21001` 帧且 `gaps=0`，VB-CABLE `underflows=0`。直接送入 Dock 管道的真实中文语音共 `1045` 帧，PC 管道 `droppedFrames=0`，WebSocket 最大发送耗时 `0.658 ms`；同期机器人 Ping `12/12`、平均 `46 ms`、最大 `91 ms`。用户明确确认“这个版本相当清晰”，证明此前数百毫秒的 TCP backpressure 与严重后半段卡顿已被消除。

客观计数仍发现首轮设备新增 `queue_drops=27 / sequence_gaps=27`。第二轮将测试语音提高到 1.4 倍软件增益后，PC 仍完整送出 `1045` 帧，但设备又丢 `132` 帧。源码调度关系给出直接解释：新 `tcp_receive` 为优先级 5，而 `wifi_speaker` 仍是 4；网络突发可以压住 I2S 播放者并挤满 12 帧队列。后继候选只把 `wifi_speaker` 提升到 6，保持麦克风 4、TCP 5；固件合同 `42/42` 和完整构建通过。镜像 `tmp/stackchan-wifi-audio-speaker-priority-20260806.bin` 大小 `3,822,496` 字节，SHA-256 `4584F5A3B04959C0A8593330AAFCBE53D2F23BAE6208FDF421CDF4337F100496`，已 app-only 写入 `0x20000`，写入 hash 与独立 `verify_flash` 均通过，当前等待实体 RST 后复测。

同时固化 Dock 的单机器人规则：新认证连接会主动关闭旧连接，旧 socket 延迟到达的 close 事件不能误断替代连接。回归测试覆盖旧连接关闭与新连接继续下行，Node `34/34`、Python `19/19`、语法检查均通过。状态探针也改为只有 received-frame 计数连续三秒不变后才查询，避免在语音播放期间插入诊断请求。

## 2026-08-07：卡顿根因审计、双核失败与 TCP_NODELAY 候选

用户再次确认播放“十分卡顿”，并明确要求降低实机测试次数，先完成更深入的方案研究。本轮因此只做源码审计、离线合同和完整构建，没有写入机器人。

现场日志同时出现三件事：机器人麦克风上行仍持续且 `gaps=0`，Dock 的 `get_status` 在 1500 ms 后超时，随后 PC 下行 `send` 从亚毫秒升到 0.1--1.2 秒并丢弃数百个过期扬声器帧。底层 `WebSocket` 已用互斥锁防止两个帧的 TCP 字节交叉，因此“并发写坏 WebSocket 帧”被排除。真正的结构问题是：互斥锁包住了无发送超时的完整阻塞 `EspTcp::Send()`；Wi-Fi 命令又在唯一的 `tcp_receive` 回调里同步生成并发送回复。一旦麦克风发送短暂阻塞，接收任务会等待同一发送锁，期间停止读取 PC 的扬声器数据，接收窗口缩小后进一步放大 PC 下行阻塞，形成反馈环。

仓库内两个成熟路径支持同一修复方向：`hal_ws_avatar.cpp` 的接收回调只复制消息入队，业务处理在回调外完成；`usb_uac_mvp.cpp` 也将命令和发送分别交给独立队列与任务。ESP-IDF 官方文档同时说明，同一 socket 的多写需要应用自行串行化，并支持 `SO_SNDTIMEO`、非阻塞 socket 与 `TCP_NODELAY`；当前锁定版及上游最新版 `esp-ml307` 的 `EspTcp::Send()` 仍是没有超时的阻塞循环。

候选实现采用以下边界：

- `tcp_receive` 对控制命令只做有界复制入队，不处理业务、不发送回复；扬声器二进制帧仍只做校验和入播放队列。
- `wifi_audio_cmd` 在接收任务之外处理命令。
- `wifi_audio_tx` 是 Wi-Fi 应用唯一的 `WebSocket::Send` 调用者；控制回复/事件优先于麦克风。
- 麦克风发送队列长度固定为 1，拥塞时覆盖旧的 10 ms 帧，避免积累不可恢复的延迟；序号跳变仍能由 PC 客观统计。
- 每个命令与发送帧携带 socket generation，重连后旧队列项不能误发到新连接。
- 发送超过 20 ms 会写入串口诊断日志；底层 socket 发送上限为 200 ms，超时后废弃可能部分发送的 WebSocket 并重连，不再无限阻塞。
- 音频帧上限保持 496 bytes，控制帧独立放宽到 512 bytes；新连接会清空旧 generation 的命令/控制/麦克风队列，hello 必要时驱逐一个旧控制帧以保留握手槽位。
- 通用 `esp-ml307 3.6.5` 的局部修改已固化为可重放 patch：提供精确 receive-task handle、普通/TLS socket 发送超时、非致命 TLS 断开清理和原子 WebSocket 连接状态。修改后 patch 已在全新上游 commit `ab4de7c28c8b8f809eba2f56f38090d57fce984d` 副本上完成正向应用与反向校验，CMake 从仓库根目录用明确 `--directory` 应用，避免“全部 skipped 但返回成功”。
- 仍不强制绑核：当前固件确认启用 ESP32-S3 双核，lwIP TCP/IP task 为 no-affinity；接收任务优先级 5，TX/命令/采集/播放任务为 4，先让 FreeRTOS SMP 自动分布。`get_status` 同步记录 heap 当前/历史最低余量和四个 worker 的 stack high-water mark，下一次一次性实机验收用数据决定是否有绑核必要。

离线证据：新增失败先行合同已经由红转绿；固件 Python 合同 `60/60`、Dock Node 测试 `38/38` 通过；ESP-IDF 5.5.5 经 CMake 重配置后的完整构建通过，Windows 端使用 Ninja response file 避免全量构建命令行超限。最新候选 app 为 `firmware/build-wifi-audio-short/stack-chan.bin`，大小 `3,821,360 bytes`（`0x3A4F30`，应用分区余量 `26%`），SHA-256 `252FBA5734F91685B7BDF1151E532E1A020E9EE1DFD947E24A4DC614C321FD11`。

2026-08-07 实机写入门禁重新确认目标为 `COM7`、ESP32-S3 revision v0.2、factory MAC `44:1b:f6:e2:78:a8`；实时读取的分区表为 `ota_0@0x20000 size 5056K`（即 `0x4f0000`）。只把上述 app 写入 `0x20000`，esptool 实际擦除范围为 `0x20000..0x3c4fff`，完全位于 `ota_0`；内建 hash 校验通过，随后独立 `verify_flash` 对 `0x20000 + 0x3A4F30` 报告 `verify OK (digest matched)`。未写 bootloader、partition table、otadata、NVS、assets、Wi-Fi 凭据或配对数据。工具的 RTS reset 后 COM7 仍存在，Dock 仍显示刷写前旧 TCP 会话，不能视为新应用已启动；需实体短按 RST 后再建立新连接并开始运行态验收。

下一次实机只做一轮合并验收：写入并独立校验候选后，使用全新 Dock 会话；先确认初始 `get_status` 成功和麦克风 `gaps=0`，再只播放一次既有 1045 帧真实语音，同时采集串口 TX 阻塞日志、PC 最大发送耗时、pipe 丢帧和设备 speaker 计数。成功门槛为控制请求不超时、PC `slow_sends=0`、pipe `droppedFrames=0`、设备 queue drop/sequence gap 回到已确认清晰基线附近，并由用户一次确认连续性与清晰度。若失败，保留同一轮全部证据后回到架构分析，不连续刷多个猜测镜像。

第一候选实际没有进入听感阶段：实体 RST 后新 TCP 会话和首次 `get_status` 成功，但无任何扬声器下行时，新的 Dock 进程在 `501` 个麦克风帧处已经累计 `45` 个 sequence gap，在 `3,501` 帧处累计 `605` 个，随后约 `60,000` 个接收帧已超过 `6,000` 个 gap；VB-CABLE 始终 `underflows=0`。同一 Dock 还观察到三次机器人重新认证，符合设备侧 200 ms 发送失败后主动废弃 socket 并重连，而不是旧版无限阻塞。该门槛失败后没有播放真实语音，也没有让用户重复听感测试。

源码与精确版本配置给出新的确定性解释：每个麦克风块是 240 samples / 24 kHz，即 10 ms；`CONFIG_FREERTOS_HZ=100`，调度 tick 同样是 10 ms。第一候选让采集与 TX 都以优先级 4、无 core affinity 运行，并让单槽队列每次直接 overwrite。ESP-IDF 5.5.5 文档明确说明，无亲和的同优先级任务只获得 best-effort round robin，不能保证每 tick 严格交替；因此正常的一 tick 调度抖动就被编码成主动丢帧。串口侧两次安全采集都得到 0 bytes，因为当前控制台明确配置为 UART0，而不是 USB Serial/JTAG；后续指标必须通过 `get_status` 返回，不能再依赖不可见日志。

第二候选把用户提出的双核分工落实为确定亲和性：WebSocket TX 固定 Core 0、priority 5；麦克风 I2S 固定 Core 1、priority 4；扬声器 I2S 固定 Core 1、priority 6。麦克风队列改为四个 10 ms 槽，只有填满时才丢最旧帧并计数，额外时延上界为 40 ms。`get_status` 直接返回麦克风 captured/sent/drop/queued、TX max/slow/failure、heap 当前/最低、四任务 stack high-water 和 worker core；控制帧、Dock WebSocket 与协议解析统一为 1,024 bytes，所有计数取最大值时的完整响应实测为 812 bytes。离线合同为固件 `61/61`、Dock `38/38`，完整构建与分区检查通过。新 app 大小 `3,822,672 bytes`（`0x3A5450`，app 分区仍余 26%），SHA-256 `6CB9D1E374E72BDB83CD39E5F49D6198CB418A7AF7FBD2761BFA9B8F3D2C925B`。在该离线阶段它尚未刷入，因此当时不能把离线证据写成双核实机修复。

随后再次从 `COM7` 下载通道核对 ESP32-S3 revision v0.2、factory MAC `44:1b:f6:e2:78:a8` 和实时 `ota_0@0x20000 size 5056K`，仅把第二候选写入 `0x20000`。实际擦除范围 `0x20000..0x3c5fff` 完全位于 `ota_0`；写入内建 hash 与独立 `verify_flash 0x20000 + 0x3A5450` 均通过。没有改写 bootloader、partition table、otadata、NVS、assets、Wi-Fi 凭据或配对数据。

实体 RST 后，第二候选在没有任何扬声器下行时就失败。首次 typed status 已报告麦克风 `captured=27 / sent=22 / queue_drops=5`，TX `max_send_us=96392 / slow_sends=3 / failed_sends=0`；heap、worker stack 和 Core 0/Core 1 映射均正常。Dock 的 sequence gap 从 501 帧时 `377` 增长到 4,001 帧时 `1,325`。这直接证明双核和四槽队列没有解除当前瓶颈；可观测机制是一次成功的小包 TCP 发送也可能阻塞约 96 ms，从而压垮 40 ms 队列。因空闲门槛已经失败，本轮没有播放、听感或 Codex Voice 测试。

第三候选只改变一个变量：Wi-Fi 音频 WebSocket 在连接后为普通 TCP 和 TLS 的底层 socket 设置 `TCP_NODELAY`，Candidate B 的队列、绑核、优先级、超时、协议边界和遥测保持不变。ESP-IDF 5.5.5 文档明确建议以该标准 socket 选项禁用 Nagle，从而降低小包延迟；当前将其标记为高可信假设，而非已证实根因。失败先行合同已转绿，固件合同 `62/62`、Dock `38/38`、Dock 语法检查、managed-component patch 正反向检查和 ESP-IDF 5.5.5 完整构建均通过。候选 app 大小 `3,823,280 bytes`（`0x3A56B0`，app 分区仍余 26%），SHA-256 `B252FA733B737672D5E34C3CCCECCAAB6E131CF94345D696F46233EB04A52A90`。受保护预检再次确认目标身份与实时分区表后，仅将该 app 写入 `0x20000`；实际擦除范围 `0x20000..0x3c5fff` 完全位于 `ota_0`，内建 hash 与独立 `verify_flash` 均通过，未改写 bootloader、partition table、otadata、NVS、assets、Wi-Fi 凭据或配对数据。当前等待一次实体短按 RST；新会话仍先要求至少 5,000 个空闲麦克风帧且 sequence gap、queue drop 不增长，再进行一次真实双向语音测试。

写入后应用实际已由工具复位自动启动并连接到全新 Dock，无需再花一次实体 RST。第三候选的首个状态即为麦克风 `captured=398 / sent=39 / queue_drops=349`，TX `max_send_us=1855633 / slow_sends=11 / failed_sends=1`，随后出现连续重新认证和 `get_status` 超时。由此否定“主要由 Nagle 聚合造成”的假设，也再次证明播放时关麦不能解决问题，因为失败发生在没有任何扬声器数据的空闲上行阶段。Dock 已立即停止，本轮没有听音。

下一路线改用协议隔离而不是继续扩大 TCP 缓冲：认证、typed control 和扬声器下行保留 WebSocket；丢包可容忍的麦克风实时上行改用每帧独立、`MSG_DONTWAIT` 的 UDP。该选择已有同一硬件证据：RX4 诊断曾在约 33.43 秒内收到 `6,644` 个四通道、984-byte UDP 音频包，仅检测到 `42` 个缺包；其每秒负载约为生产 mono 方案的四倍。生产 UDP 包还必须绑定当前已认证 WebSocket 会话和源地址，并持续公开 sequence gap/drop 计数；在这些安全和可观测边界完成前不刷下一版。

第四候选已实现该协议隔离：认证、typed control 和扬声器继续使用 WebSocket；麦克风改为每个 10 ms 帧一个固定 `516-byte`、`MSG_DONTWAIT` UDP datagram。Dock 每次 WebSocket 认证后签发新的 16-byte session，只接受当前连接源 IP 与 session 匹配的数据，并拒绝旧会话、重复、乱序、无效及旧 WebSocket 麦克风帧。session 只用于隔离偶发或陈旧跨会话数据，不提供加密；当前 `ws://` 开发链路中的 UDP 麦克风 PCM 仍是可信局域网明文，生产保密性需要另行设计加密媒体传输。

Candidate D app 为 `firmware/build-wifi-audio-short/stack-chan.bin`，大小 `3,824,656 bytes`（`0x3A5C10`），SHA-256 `43A5AC09C522E650DBA4AAF8E0E00BD551987D7011C607739DCEF1D58E58D47D`。离线门禁为固件 `62/62`、Dock Node `39/39`、Dock Python `19/19`、Dock 语法检查及 ESP-IDF 5.5.5 完整构建/链接/分区检查通过。受保护预检再次确认 `COM7` 为 ESP32-S3 revision v0.2、factory MAC `44:1b:f6:e2:78:a8`，实时分区为 `ota_0@0x20000 size 5056K`。只把该 app 写入 `0x20000`，镜像 end-exclusive 为 `0x3C5C10`，sector-aligned erase range `0x20000..0x3c5fff` 完全位于 `ota_0`；内建 hash 与独立 `verify_flash 0x20000 + 0x3A5C10` 均通过，未改写 bootloader、partition table、otadata、NVS、assets、Wi-Fi 凭据或配对数据。

首轮新 Dock `wifi-audio-dock-20260807-023316` 完成了精确的空闲门禁：设备 `captured=5000 / sent=5000 / queue_drops=0 / queued=0 / udp_send_failures=0`，Dock `frames=5000 / udpFrames=5000 / websocketMicrophoneFrames=0`；sequence gap、duplicate、out-of-order、invalid、rejected datagram、reconnect 全为 `0`，device UDP `max_send_us=1565`，VB-CABLE `underflows=0`。该会话随后继续超过 9,000 个 UDP 帧仍保持 `gaps=0`。这证明麦克风已实际离开 WebSocket/TCP 发送路径，并通过初始 5,000 帧隔离验收。

主动重启 Dock 后，新会话 `wifi-audio-dock-20260807-023452` 再次以单一认证连接运行；其独立空闲门禁在 `5001` 帧时仍为 `gaps=0 / reconnects=0 / websocketMicrophoneFrames=0`。约 `6001` 帧时麦克风累计首次出现 `1` 个 gap，并在扬声器播放前保持为 `1`。随后 PC 只播放一次既有 `1045` 帧真实中文语音：PC pipe `received=1045 / sent=1045 / dropped=0 / maxPending=1`，WebSocket 最大发送延迟 `0.621 ms`、`slow_sends=0`；同期 Ping `12/12`、平均 `32 ms`、最大 `103 ms`。播放窗口内麦克风累计 gap 从 `1` 增至 `6`，即时检查仍无 duplicate/out-of-order/invalid；VB-CABLE `underflows=0`。

设备扬声器状态为 `received=1045 / played=1024 / queue_drops=21 / sequence_gaps=21 / underruns=7`。这证明 PC 发送路径和网络下行已完整、低延迟地交付 1045 帧，但设备在 I2S 播放前仍丢弃 21 帧，因此客观扬声器连续性门禁尚未通过。日志继续运行后麦克风达到 `gaps=8 / out_of_order=2`，该数值发生在扬声器状态检查之后，不并入 1045 帧播放窗口。用户随后明确确认本轮真实语音“播放比较清晰，没有卡顿中断”，因此本轮主观听感验收通过；状态灯是否正确仍待用户回复。Task 6、无 USB closeout 与总体目标均不得标记完成。首轮完整日志及第二轮本次状态检查所读取的 checkpoint snapshot 已保存到 `docs/research/evidence/wifi-audio-single-sender-20260807/`；原始 `023452` 日志在不干预运行进程的前提下仍继续追加，后续内容不倒灌进本次 1045 帧验收窗口。

Codex Voice 扬声器桥随后完成纯 PC 隔离修正。最初自写的 Windows application process-loopback 曾出现 heap corruption，另一些运行只采到静音，不能作为可用实现；现已替换为基于 `wasapi-rs 0.23.0` 的 application process-tree loopback。Rust 单元测试 `2/2` 与 release build 均通过；本机未安装 `rustfmt` 只表示缺少可选格式化工具，不是测试或构建失败。

替代实现的纯 PC 660 Hz 控制实验输出 `253,920 bytes`、24 kHz mono s16 PCM，peak `11,438`、dominant `659.750 Hz`，SHA-256 `40986B66538AD56F952F715C259C3E44AE029ADFA93F219397055D0F8BF0F824`，未检测到 discontinuity。该结果证明新 process-tree loopback 在不经过机器人时能够捕获并交付非静音、频率正确且连续的 PCM，但不能替代真实 Codex Voice 与机器人双向验收。

新启动入口为 `tools/stackchan-dock/scripts/start-codex-voice-speaker-bridge.ps1`。本次记录点上，bridge PID `27780` 已捕获以 PID `23240` 为根的 Codex process tree，并连接 StackChan speaker pipe。Task 6 仍等待用户手动打开 Codex Voice，将 `CABLE Output` 选为麦克风、Steam 虚拟扬声器选为静音输出，然后确认机器人语音进入 Codex、Codex 回复只到机器人扬声器、监听/说话状态灯正确且没有重复本地播放；在这些用户侧结果回收前，Task 6、无 USB closeout 与总体目标均不得标记完成。

当前完整离线回归结果为：firmware Wi-Fi Audio contracts `43/43`；Dock Node syntax validation 通过，Node tests `39/39`；Dock Python tests `19/19`；Rust process-loopback unit tests `2/2` 且 release build 通过；PowerShell bridge 启动脚本已通过解析，并完成一次成功真实启动。当前代码与离线合同覆盖全屏音量手势、头部滑动只切换麦克风路径、监听/说话/故障状态灯状态机以及 typed MCP 请求路由。

上述离线通过不能替代用户侧联合验收：真实 Codex Voice 的机器人到 Codex 与 Codex 到机器人双向音频、蓝灯切换、没有本地重复播放，以及无 USB 运行仍待用户实测。因此 Task 6 和 Task 7 均保持未完成，总体目标也保持开放。

随后为电脑端 process-loopback bridge 增加显式 ready 诊断，并只安全重启 bridge；Dock 与机器人均未重启。替代 bridge PID 为 `4448`，仍捕获以 PID `23240` 为根的 Codex process tree。日志报告 `ready ... sample_rate=24000 channels=1 bits=16 pipe=...`，证明捕获格式为预期的 24 kHz、mono、16-bit，且已连接配置的 speaker pipe；记录中不包含任何凭据。

新 bridge 随后处理 `1500` 帧空闲输入，计数为 `peak=1 / sent_frames=0 / gated_frames=1500 / discontinuities=0`。这证明 bridge 处于连接和连续运行状态，同时静音门正确地没有把空闲输入发送给机器人。该 ready/idle 证据仍不等同于真实 Codex Voice 双向验收，Task 6、Task 7 与总体目标继续保持未完成。

## 2026-08-07：Codex Voice 输入数字零证据与最小半双工决策

用户提供的 Windows 录音 `录音.m4a`（SHA-256 `8A6213980A84AFFB5410E7E922B0EDA0F0CCC1183157D91E062FD557FE8DB9C3`）约 `9.643 s`，为 AAC stereo `48 kHz`。其 `452` 个 AAC packet 的 PTS 连续，因此录音器容器时间线没有断裂；将其解码为 PCM 后，两个声道逐样本完全相同，说明这里的 stereo 只是同一 mono 数据的复制，不能据此推断双麦克风采集。

与用户已确认清晰的 RX-only MIC1 基准相比，当前 PCM 存在决定性的数字零：当前录音 `54.77%` 的 10 ms 块为数字静音，内部共有 `106` 段数字零、合计 `5.26 s`、最长 `200 ms`；清晰基准只占 `0.39%`，内部 `8` 段、合计 `0.13 s`、最长 `30 ms`。当前录音相邻样本完全相同比例为 `64.51%`，而清晰基准为 `2.82%`。当前 RMS 为 `226`、peak 为 `3518`，基准分别为 `1403` 和 `32768`；由于两次说话内容和距离不同，电平只作提示，不作校准灵敏度结论。

频谱仍保留了与正确 MIC1 路径相近的人声结构：当前 `300--3400 Hz` 功率占比为 `85.54%`，RX-only 基准为 `87.0%`；当前 `0--80 Hz` 为 `0.85%`，基准为 `0.88%`。因此“听起来像早期错误麦克风”是真实听感，但现有客观证据不支持简单归因为再次选错 MIC；更可信的直接故障是正确麦克风 PCM 在后续链路中有超过一半被数字零替代。完整数值保存在 `docs/research/evidence/codex-voice-input-20260807/`。

基于这一失败证据和用户“先要一版可用方案”的明确优先级，当前架构决定停止把高质量全双工作为第一版门槛，改为最小可靠半双工。该决定不是证明全双工不可实现，而是拒绝在没有可信证据时继续扩大实现周期；AEC、回声抵消、同时高质量采集与播放均退出第一版范围。

半双工状态边界固定如下：

- **Listening**：关闭输出 codec；只有逻辑麦克风开关为开时才开启输入 codec。头部滑动或 MCP 静音修改的是该逻辑偏好，回复结束后仍保持。
- Codex 助手回复开始的既有 `set_talking(true)` 回调立即进入 **Speaking**：先关闭输入 codec，再开启输出 codec；不是等音频积累后才停止麦克风。
- **Speaking** 期间麦克风始终不采集；回复中的短暂停顿仍保持 Speaking，避免输入/输出 codec 反复切换。
- `set_talking(false)` 只标记回复结束；已经进入扬声器队列的数据必须继续播放。只有队列排空后，才先关闭输出 codec，再按逻辑麦克风开关恢复输入 codec，回到 Listening。
- 若回调迟到或缺失，第一帧扬声器数据作为进入 Speaking 的兜底；它不是取代正常的回复开始/结束回调。

PC 侧同时把麦克风 `24 kHz -> 48 kHz` 转换从逐样本复制改为跨 10 ms 帧保持状态的流式线性插值。该改动的目标是消除 `x[n], x[n]` 重复带来的阶梯状波形；它不是声学增强，也不能修复上游已经丢失或被置零的数据。

为防止单次回复结束控制消息丢失后麦克风永久关闭，最终离线候选增加了有界故障回退：回复期间若连续 `3 s` 没有任何扬声器 PCM，则视为回复生命周期已丢失，进入相同的 `400 ms` 尾窗后恢复 Listening。该回退只处理控制消息丢失，不代替正常的 `set_talking(false)` 队列排空流程。

本轮只完成离线门禁：Dock Node `39/39`、Dock Python `19/19`、固件契约 `45/45`，Dock JavaScript 与 Python 语法检查通过；ESP-IDF `5.5.5` 完整 build/link/分区检查通过。当前候选为 `firmware/build-wifi-audio-short/stack-chan.bin`，大小 `3,826,032 bytes`（`0x3A6170`），SHA-256 `1EE57BBC9AF1277C4A9DE9539E3DACDBD7CD9BBE0CA1D07166E94D2C0A5E1173`。

上述结果只证明源码、合同和固件构建闭合。该候选尚未写入或进行物理联合验收，不能宣称已可投入生产，也不能宣称半双工已在实体上解决麦克风清晰度。后续只需一次合并实机验收：确认 Listening 麦克风达到已知清晰基准、Codex 回复开始后麦克风停止且扬声器连续、回复队列排空后麦克风恢复，并回读 `phase / microphone_active / speaker_active / voice_reply_active`。摸头触发舵机动作后的整机掉电 Bug 仍未修复，继续作为独立生产阻断项；本次半双工改动没有覆盖它。

受保护 app-only 烧录随后完成。预检确认 `COM7` 为 ESP32-S3 revision v0.2、factory MAC `44:1b:f6:e2:78:a8`，实时分区表仍为 `ota_0@0x20000 size 5056K`；待写候选长度与 SHA-256 分别为 `3,826,032 bytes` 和 `1EE57BBC9AF1277C4A9DE9539E3DACDBD7CD9BBE0CA1D07166E94D2C0A5E1173`。只写入 `0x20000`，sector-aligned erase range 为 `0x20000..0x3c6fff`，完全位于 `ota_0`；esptool 写入内建 hash 与独立 `verify_flash 0x20000 + 0x3A6170` 均通过，未改写 bootloader、partition table、otadata、NVS、assets、Wi-Fi 或配对信息。

写入工具执行 hard reset 后，`COM7` 仍存在，但机器人没有在 20 秒内重新连接已监听 TCP `8765` / UDP `8766` 的新版 Dock，`192.168.0.8` 也未响应两次 Ping。此时不能把“刷写和校验通过”外推为“应用已启动”；按 esptool 提示等待一次实体短按 RST，再继续唯一一次联合验收。

用户实体启动后，新固件从 `192.168.0.8` 连接唯一 Dock 会话。首次 typed status 为 `duplex_mode=half / phase=listening / microphone_enabled=true / microphone_active=true / speaker_enabled=true / speaker_active=false / voice_reply_active=false`；麦克风初始 `captured=16 / sent=16 / queue_drops=0 / udp_send_failures=0`，扬声器所有计数为零。随后精确空闲门禁达到 `captured=5002 / sent=5002`，Dock 同期 `frames=5002 / udpFrames=5002 / websocketMicrophoneFrames=0`，gap、duplicate、out-of-order、invalid、rejected datagram、reconnect 全为零，VB-CABLE underflow 为零；运行继续超过 11,500 帧仍保持 gap=0。

直接从 VB-CABLE WASAPI 输入采集 8 秒 listening 环境音得到 `384,000` 个 48 kHz mono samples。10 ms 数字静音占 `0.2503%`，仅 1 段、合计/最长均 `30 ms`；相较失败 M4A 的 `54.77%`、106 段、合计 `5.26 s`，决定性的数字零故障已消失。该环境音 peak `378`、RMS `49.65`，只能证明链路连续，不能替代真人语音可懂度验收。证据保存在 `docs/research/evidence/half-duplex-20260807/`。

新版 process-tree loopback bridge 已捕获当前 Codex app root PID `16116`，以 `24 kHz / mono / 16-bit` 连接同一 Dock speaker pipe；空闲超过 2500 帧时 peak=1、sent=0、discontinuities=0，证明不会把空闲渲染噪声发送给机器人。下一步只触发一次真实 Codex Voice 对话，回收 reply lifecycle、speaker stats、麦克风暂停/恢复和用户听感。

## 2026-08-07：半双工实录排除网络丢帧，standard-stereo 产品麦克风仍失败

用户在新版半双工 Listening 状态通过 Windows 录音器得到 `D:/Users/chany/Documents/录音/录音 (2).m4a`，并明确报告 Codex 仍无法听到，录音仍为“机器人质感”，不是此前确认清晰的版本。原始文件 SHA-256 为 `B4F79AEF9FEC742A76975C3BDDA5692E6D5D81417D42D46B03119819072392E1`；AAC `48 kHz` stereo、约 `6.3786 s`、共 `299` 个 packet，PTS 单调连续。原始 M4A 未复制进仓库，解码 WAV、客观指标和诊断图保存在 `docs/research/evidence/half-duplex-20260807/`。

这次录音的 10 ms 数字静音只占 `0.314%`，内部仅 `1` 段、合计/最长均为 `30 ms`。因此上一份 `录音.m4a` 中 `54.77%` 数字静音的连续性故障已经消失；但音质没有随之通过。新录音 RMS/peak 为 `648 / 11284`，`300--3400 Hz` 人声频带只占 `30.47%`，`0--80 Hz` 却占 `40.22%`，50/60 Hz 及谐波占 `6.69%`。用户确认清晰的 RX-only MIC1 对照分别为 `1403 / 32768`、`86.98%`、`0.88%`、`0.44%`。不同内容和距离意味着电平不作校准结论，但人声频带丢失与极低频/工频污染的数量级差异足以客观判定当前产品麦克风仍不可用。

同期 Dock 连续接收超过 `27,500` 个 UDP 麦克风帧，`gaps=0 / drops=0 / reconnect=0`。这次波形污染不是 Wi-Fi 丢帧、Dock 丢包或会话重连造成；Codex 仍听不到是端到端失败结果，不能反过来替代 PCM 根因证据。历史证据也必须更正为严格边界：用户唯一确认清晰的设备麦克风是 `docs/research/evidence/rx4-golden-20260806/run2/slot0_mic1-24khz.wav` 和同轮 MIC2，它们都是 RX-only four-slot TDM；`matched-std-duplex-20260806`、后续 `jitter-buffered-20260806` 与 `wifi-audio-single-sender-20260807` 解决或验证过扬声器、缓冲和 UDP transport，但 standard-stereo 产品麦克风从未通过清晰度验收。

代码证据收敛了下一步。仓库内小智官方 `firmware/xiaozhi-esp32/main/boards/m5stack-core-s3/cores3_audio_codec.cc` 使用 standard TX，同时选择 `MIC1 | MIC2 | MIC3` 让 ES7210 进入 four-slot TDM RX，并由 `esp_codec_dev_read` 进行输入 channel mapping；唯一通过试听的 RX-only golden 同样是 TDM。主线程因此只恢复官方麦克风 RX 路径，保留已验证的扬声器 TX、UDP、Dock 和半双工状态机不变。该候选先通过固件契约 `45/45`，并完成 ESP-IDF 完整构建、链接和分区检查；app 大小为 `3,827,296 bytes`，SHA-256 为 `4AD5DFCDDF4146CB2DF9D646121AC2D3DBEF88DE58E76B5CB11B70FFFDF98576`。这些是离线构建证据，不是硬件音质证据；离线门禁完成时尚未刷写，后续写入与启动结果见下方记录。

另一只麦克风录相同内容不是当前推进修复的前置条件：现有 TDM golden 已足够拒绝失败产品路径。若修复后仍需排除房间、距离和说话内容差异，再安排同位置、同距离、同一句话的同步参考录音。

### 2026-08-07：官方 TDM RX 候选写入、启动误判纠正与 transport gate

精确候选 app 大小 `3,827,296 bytes`、SHA-256 `4AD5DFCDDF4146CB2DF9D646121AC2D3DBEF88DE58E76B5CB11B70FFFDF98576`。受保护写入前确认目标为 ESP32-S3 revision `v0.2`、factory MAC `44:1b:f6:e2:78:a8`，实时 `ota_0` 位于 `0x20000`、大小 `5056K`。本轮只执行 app-only 写入 `ota_0`；写入工具 image hash 校验通过，对同一目标范围执行的独立 `verify_flash` 也通过。这证明候选与 flash 写入内容一致，不证明应用能够启动或音频质量正确。

工具 hard reset 后机器人最初没有回连当时的 Dock。用户短按 `RST` 无反应，随后按左侧电源键时观察到一次短暂闪屏；同期 PC 只读检查中 `COM7` 消失，Dock 没有设备连接。当时据此暂记为“未进入应用”，并保留早期 app 崩溃、板级电源状态或其他启动故障三种可能。该判断随后被更强的运行证据推翻，不能继续当作当前结论。

设备后来确认显示黄灯，全屏音量调节正常，且 `192.168.0.8` Ping 成功。Dock 启动后，用户确认状态灯变为绿灯，设备完成认证连接。黄灯是 waiting 状态，不是黑屏或崩溃；因此应用正常运行到 UI、Wi-Fi 与 Dock 认证阶段，“app 启动失败”结论作废。

随后进行官方 TDM RX transport gate：约 `65 s` 内 Dock 收到 `3,001` 个 UDP 麦克风帧，累计 `sequence gaps=4,430`；`duplicates=0 / out_of_order=0 / invalid=0`。TCP `status` request `2` 与 `talking` request `3` 均在 `1,500 ms` 超时；VB-CABLE `underflow=0`。大量 sequence gap 与控制请求超时使本轮没有进入音质实测，因而仍没有可用于验证官方 TDM RX 音质的实体录音或 Codex 识别结果。

该 transport gate 将当时的根因边界从启动路径转移到固件端音频读取、排队或任务时序；它不支持“设备没有启动”作为解释。后续 subplan 已通过代码和数据长度闭环在这个范围内进一步确认根因，见下一节。**不得把应用认证成功或 VB-CABLE underflow 为零外推为 TDM 麦克风音质通过。**

### 2026-08-07：four-slot TDM logical-2ch 长度错配根因与 raw4 离线候选

源码与数据长度闭环确认：Wi-Fi 产品已让 ES7210 输出 four-slot TDM，但输入设备仍按 logical `2ch` 打开，每 10 ms 只请求 `960 bytes`。当前 codec-dev 数据层不进行四槽到逻辑双声道的重排，也没有把底层实际 `bytes_read` 传播给产品调用方，因此产品读取边界与 ES7210 物理四槽帧不一致。这是本轮不可用麦克风的确认根因，而不是 UDP 丢包、VB-CABLE underflow 或应用启动失败。

subplan 的单变量修复只作用于 Wi-Fi 麦克风输入：raw4 使用 `channel=4 / channel_mask=0xF` 打开，每 10 ms 直接严格读取 `1,920 bytes`，实际长度不匹配即拒绝该帧；物理槽位固定 MIC1=`slot0`、MIC2=`slot2`。已验证的扬声器 TX、UDP、任务调度、Dock 和半双工状态机保持不变。

该离线候选通过固件合同 `64/64`；ESP-IDF `5.5.5` 完整构建、链接和分区检查通过。`stack-chan.bin` 大小 `3,827,488 bytes`（`0x3A6720`），SHA-256 `853EAF69CFAF86988E32E3D68B7F43651A1F421D021C7FDD4D2FD9C7F7AAE86A`。目标 `ota_0` 仍为 `0x20000 / 5056K`，app 末地址 `0x3C6720`，约 `26%` 空闲；受保护刷写脚本的 pin 与候选长度和哈希匹配。

**该离线候选形成时尚未刷写，尚未做 transport gate 或音质验证。上述根因确认来自代码与数据长度闭环；后续写入与 transport 结果见下一节。**

### 2026-08-07：raw4 候选写入后 transport gate 失败

raw4 候选随后 app-only 写入 `ota_0@0x20000`；写入工具 image hash 校验通过，对同一范围执行的独立 `verify_flash` 也通过。机器人实体 `RST` 后上线并完成 Dock 认证，initial `get_status` 成功。新一轮原始日志为 `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260807-202638.stdout.log` 与对应的 `wifi-audio-dock-20260807-202638.stderr.log`。

主机 receiver 到达 `5,001` 帧时，`gaps=634 / duplicate=0 / out_of_order=13 / invalid=0 / reconnect=0`。同期设备 status 为 `captured=5,634 / sent=5,013 / queue_drops=621 / udp_send_failures=621 / max_send_us=952`，VB-CABLE `underflows=0`。设备已启动、认证且控制面初始查询成功，但 sequence 连续性未通过门槛，因此本轮没有进入人工试听或 Codex 识别测试。

计数已把故障定位在设备发送侧：`634` 个 receiver gap 中，`621` 个可由设备明确记录的 `sendto` drop 直接解释，剩余 `13` 与 receiver 的 out-of-order 计数对齐；`duplicate=0 / invalid=0 / reconnect=0`。因此不能把本轮失败归因于麦克风短读、主机包解析或会话重连。

上一节确认并修复的根因只覆盖 four-slot TDM 与 logical-2ch 的 frame geometry 错配。当前新增剩余根因是 I2S capture task 在实时采集任务内直接通过 `MSG_DONTWAIT` 发送 UDP，瞬时不可发送便在设备侧丢帧。后续应将捕获与网络发送解耦：I2S 任务只写入有界队列，独立网络任务消费并负责发送。**在新 transport gate 达到连续性门槛且完成录音频谱、用户试听与 Codex 识别前，不得宣称 raw4 麦克风已可用。**

### 2026-08-07：capture/network 解耦离线候选

后继候选在 `firmware/main/hal/wifi_audio_dock_mvp.cpp` 新增容量 `16` 帧的 `MicrophoneFrame` 有界队列。core1 `audio_task` 现在只负责采集、选择 MIC1 `slot0` 或 MIC2 `slot2` 并 enqueue；core0 `wifi_tx_task` 每轮先清空 control 工作，再执行至多一个麦克风 UDP send。UDP socket 使用 `SO_SNDTIMEO=20 ms`，`sendto` 使用 `flags=0`，从结构上移除了 I2S 实时采集任务内的直接 `MSG_DONTWAIT` 网络发送。

计数口径也改为可判别：`queue_drops` 只在 queue full 时增加，`udp_send_failures` 只在真实 send failure 时增加，`queued_frames` 是实际队列深度；新增 `flushed_frames` 和 `last_errno`。`set_ready(false)`、进入 Speaking、以及关闭逻辑麦克风都会清空待发队列，防止过期 Listening PCM 跨连接或跨半双工阶段发送。

该候选通过固件完整合同 `64/64`。ESP-IDF `5.5.5` full build/link/partition 检查通过，随后第二次增量构建也通过。精确 app 为 `firmware/build-wifi-audio-short/stack-chan.bin`，大小 `3,828,144 bytes`（`0x3A69B0`），SHA-256 `04C629FBD2EAB9E48DA49E44DA93C09082CF8D8CD89CF21004481BF3B54AB23D`；image checksum 与 validation hash 有效。目标分区 `ota_0@0x20000`、大小 `0x4F0000`，app 末地址 `0x3C69B0`，剩余 `0x149650`、约 `26%`。受保护 flash script 已 pin 新 length/hash，脚本语法检查通过。

离线候选形成时，Windows `Win32_SerialPort` 查询没有 `COM7`，所以当时尚未执行目标身份/分区 preflight，也没有刷写、transport gate 或音质验证。后续受保护写入结果见下一节。**离线合同、构建和脚本 pin 不能证明设备侧丢帧已修复；只有新候选实机计数能验证 queue 与 UDP send 是否真正解耦。**

### 2026-08-07：capture/network 解耦候选受保护写入

随后 `COM7` 以 `VID_303A / PID_1001` 出现。受保护 preflight 确认 ESP32-S3 revision `v0.2`、factory MAC `44:1b:f6:e2:78:a8`，实时分区为 `ota_0@0x20000`、大小 `0x4F0000`。本轮只把精确候选 `3,828,144 bytes`（`0x3A69B0`）、SHA-256 `04C629FBD2EAB9E48DA49E44DA93C09082CF8D8CD89CF21004481BF3B54AB23D` 写入 `0x20000`；实际 sector erase 范围 `0x20000..0x3C6FFF`，没有超出 `ota_0`。

写入工具内建校验报告 `Hash verified`，随后对同一地址和长度执行的独立 `verify_flash` 报告 `digest matched`。bootloader、partition table、NVS 与 assets 均未写入。这些证据只确认目标身份、写入边界和 app 内容一致性，不证明应用启动或音频行为正确。

工具 hard reset 后的首个检查窗口没有 Dock listener，`192.168.0.8` 连续 `4` 次 Ping 超时，所以该时点尚无应用启动、transport 或音质证据。用户随后实体短按 `RST` 并执行唯一 transport gate，结果见下一节。**不得把 app-only 写入和独立校验成功记录为实机修复。**

### 2026-08-07：capture/network 解耦实体 gate 失败

实体 `RST` 后，`192.168.0.8` Ping `4/4` 成功，延迟为 `19 / 26 / 40 / 44 ms`，确认应用在线。TCP `8765` 与 UDP `8766` 均确认空闲后，通过 `start-wifi-audio-dock.ps1` 启动唯一 standalone Dock PID `14324`。原始 stdout/stderr 分别为 `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260807-205214.stdout.log` 与同目录 `wifi-audio-dock-20260807-205214.stderr.log`。

设备 `stackchan-441BF6E278A8` 完成认证。初始 status：`duplex_mode=half / phase=listening`，麦克风 enabled/active，扬声器 inactive；麦克风 `captured=12 / sent=12 / queue_drops=0 / flushed_frames=0 / udp_send_failures=0 / max_send_us=1687 / last_errno=0`；worker `tx=0 / mic=1 / speaker=1`，heap 与 stack 正常。

主机 receiver 的逐检查点 gaps 为：

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

自动 Idle gate 最终主机读数为 `receiver frames=5,006 / udp=5,006 / websocket=0 / bytes=2,402,880 / gaps=600 / duplicate=0 / out_of_order=0 / invalid=0 / rejected=0 / reconnect=0`。同期设备为 `captured=5,606 / sent=5,006 / queue_drops=0 / flushed_frames=0 / queued_frames=0 / udp_send_failures=600 / max_send_us=1698 / last_errno=0`，VB-CABLE `underflows=0`。

计数形成决定性闭合：`captured - sent = 600 = udp_send_failures = receiver gaps`。16 帧队列没有发生积压、满或 flush；失败已转移到独立 network task 的 blocking `sendto`。`max_send_us` 仅约 `1.7 ms`，因此这 `600` 次失败不是 `SO_SNDTIMEO=20 ms` 到期，而是 sendto 立即失败。没有证据支持继续盲目扩大队列。

本轮没有播放、人工试听、录音或 Codex Voice 验收，transport gate 明确失败。测试后精确停止 PID `14324`，TCP `8765` 与 UDP `8766` 均复查为 free。status 中的 `last_errno=0` 不能证明失败 errno 为 `0`：当前实现会在任意后续成功发送时清零，构成诊断盲点。下一步需保留 `last_failure_errno`，并研究 ESP-IDF/lwIP `sendto` 错误路径后再设计修复。

### 2026-08-07：官方音频上行、ESP-IDF UDP 语义与首版路线只读调研

仓内官方 Xiaozhi 音频上行的完整数据流是：`24 kHz` 输入重采样到 `16 kHz`，每 `10 ms` 喂入 processor，累计 `60 ms` PCM 后以 Opus DTX/VBR 编码；编码入口有 `2` 帧队列，压缩音频发送侧有 `40` 帧队列，最终经 WebSocket 或 MQTT/UDP 发送。当前 Wi-Fi 产品每 `10 ms` 发送 `480 bytes` raw PCM，即约 `100 packets/s`；官方生产粒度约为 `16.7 packets/s`。官方实践的关键是聚合/压缩、捕获与发送解耦及有界队列，而不是单独选择某一种 socket 协议。

ESP-IDF/lwIP 只读源码结论：UDP `sendto` 忽略调用方 `flags`；`SO_SNDTIMEO` 只在 TCP write path 中用于等待，不让 UDP 在 buffer 不足时阻塞。`wlanif` 把 Wi-Fi `ESP_ERR_NO_MEM / ESP_ERR_ESP_NETIF_TX_FAILED` 映射为 lwIP `ERR_MEM / ERR_BUF`，UDP 不自动重试；Kconfig 也明确警告 UDP 上层发送过快会耗尽 Wi-Fi TX buffers。当前 dynamic TX buffers=`32`，与本轮约 `100 packets/s` 小包上行的立即失败机制相符。由于成功发送会把当前 `last_errno` 清零，本轮仍未确认失败时的精确 errno，不得把 `ERR_MEM` 或 `ERR_BUF` 任一个提前写成唯一结果。

硬件/官方边界也需要保留：M5Stack 把 CoreS3 描述为双麦，M5Unified 只使能 MIC1/MIC2；仓内 Xiaozhi CoreS3 则选择 `MIC1 | MIC2 | MIC3`，其中第三路用于参考/AEC 并使 ES7210 进入 four-slot TDM。三套描述处于不同抽象和产品用途，不能未经 frame geometry、物理槽位和产品模式审核便直接照抄。首版继续使用已由 RX-only golden 验证的 raw4 MIC1=`slot0`。

下一版首选路线纠正为证据最强的官方结构：保留已验证 raw4 MIC1=`slot0` 入口，重采样到 `16 kHz`，每 `60 ms` 编码 Opus，经官方式有界队列和同一 WebSocket 单发送器上行；半双工与已验证扬声器保持不变。PC Dock 侧使用 Node 可用的 WASM Opus decoder（例如 `opus-decoder`）解码后送现有 VB-CABLE，但具体包版本、初始化、帧格式与错误 API 仍需离线验证。

`60 ms` raw PCM + WebSocket 只作为 fallback：它降低发送调用频率，却不降低 PCM 带宽；本项目历史 PCM/TCP 路径已有明显阻塞证据，可靠性依据弱于官方 Opus 结构。下一步先离线验证 Opus 端到端编解码、阻塞/背压、顺序、队列上限、控制优先级和断线清理，通过后只做一次合并实机 gate。

**上述内容仍是研究决策：尚未实现、构建、刷写或实机测试。**

### 2026-08-07 Task 9：Opus WebSocket 上行离线实现/测试记录

Task 9 的固定目标是：raw4 MIC1=`slot0` -> 重采样 `16 kHz` -> `60 ms` Opus -> 官方式有界队列/单一 WebSocket 发送器 -> Dock 解码 -> VB-CABLE。继续保留半双工、扬声器下行和已验证的 MIC1 物理槽位，不在本任务重新扩大到全双工或未验证 MIC3/AEC。

本轮只进行离线实现与测试，边界为：**不刷写、不启动实机，不执行实体 transport gate、试听、录音或 Codex Voice 验收。** 后续合同、编解码互通、阻塞/背压、队列上限、控制优先级、断线清理、依赖与固件构建结果按发生顺序追加；当前仅建立记录节，不宣称任何实现或门禁已经通过。

#### Task 9 红灯合同基线

先新增 Dock 协议/真实 Opus 解码合同与固件静态合同，再在未实现状态运行。Node 侧按预期以 `ERR_MODULE_NOT_FOUND` 失败，缺失目标模块 `wifi-audio-opus-decoder.mjs`。固件静态合同共 `46` 项，`41` 项通过、`5` 项失败；五项失败均对应 Task 9 尚未实现的目标：当前 hello 仍声明 UDP/PCM，上行没有 `60 ms` Opus 流水线、编码任务或 WebSocket 发送。

该结果是预期红灯，用于证明新增合同能够识别目标能力缺口；它不是对既有 41 项能力的回归判定。本轮未进行固件构建、刷写或实机启动。

#### Task 9 第一轮绿灯：定向离线互通

首轮实现后的固件静态合同为 `46/46`；Dock `npm check` 通过；targeted receiver/真实 Opus 测试 `8/8`。真实 Espressif `60 ms` Opus 向量由 `opus-decoder 0.7.11` 成功解码为 `24 kHz` mono、`2,880 bytes` PCM，且 `peak > 0`。这为固件编码格式与 PC 解码器互通提供了真实非静音向量证据。

本轮没有改变 raw4、MIC1/MIC2 槽位映射、speaker 或 half-duplex。新增 `24 kHz -> 16 kHz` 持久 resampler；每个 `960` samples PCM frame 进入容量 `2` 的有界队列，由独立 Opus 任务编码；encoded queue 容量为 `8`，唯一 socket sender 调用 `Send`。Dock 则在同一认证 WebSocket 上接收 Opus、解码，并送入既有 PCM/VB-CABLE 链路。

当前只是 targeted 离线绿灯，尚未执行全量 Dock 测试、ESP-IDF 构建或阻塞/背压压力测试；未刷写，也未启动实机。

#### Task 9 全量 Dock 门禁与 fixture 漂移

首次全量 `npm test` 超时。使用 `node --test --test-timeout=10000 --test-reporter=spec` 复跑并展开用例后，定位到唯一未更新 fixture：`wifi-audio-speaker-pipe.test` 仍发送旧 PCM hello，认证因此失败，测试继续等待 ready 并超时。

只把该测试 fixture 的 hello 改为 Opus 后，全量 Dock `40/40` 通过，`fail=0 / cancelled=0`，总耗时约 `1.13 s`。该失败归因于测试 fixture 的协议漂移，不是 speaker 实现故障；本轮没有修改扬声器产品路径。

全量 Dock 门禁现已通过；ESP-IDF 构建、阻塞/背压压力测试、刷写和实机验证仍未执行。

#### Task 9 完整离线门禁、依赖审计与构建候选

协议边界先完成对齐：Dock 单帧上限由 `1,275` 提升为 `1,500 bytes`，与固件一致。依赖审计初次报告 `ws 8.18.3` high、`hono 4.12.33` moderate；定向更新为 `ws 8.21.2`、`hono 4.13.1` 后，`npm audit` 为 `0`。Opus 解码依赖为 `opus-decoder 0.7.11` 与 `@wasm-audio-decoders/common 9.0.7`。

全量 Dock 测试现为 `41/41`，固件合同 `46/46`，`npm check` 与 diff check 通过。新增 `1,000` 帧 Opus WebSocket 压力门禁在控制请求持续闭环期间得到 `frames=1000 / gaps=0 / duplicate=0 / out_of_order=0 / invalid=0 / decodeErrors=0 / PCM bytes=2,880,000`，测试耗时约 `48 ms`。这证明离线同一认证 WebSocket 的音频顺序、解码与控制闭环在该负载下成立，但不模拟真实 WLAN 时延或设备调度。

ESP-IDF `5.5.5` 完整 build/link/image/partition 检查通过。精确候选 `stack-chan.bin` 为 `3,990,064 bytes`（`0x3CE230`），SHA-256 `210F0A75B83AAC4045C6872B91710EC86161D5363596A86318086FD0E0BC5649`；ESP32-S3 image checksum 与 validation hash 有效。目标 ota app 分区大小 `0x4F0000`，剩余 `0x121DD0`、约 `22.93%`。本轮 `sdkconfig.h` 哈希与旧候选相同，排除构建配置漂移。

**当前仍是离线候选：尚未刷写，没有实机 transport、音质录音或 Codex Voice 验收，不得记录为产品通过。**

#### Task 9 只读审阅、刷写前修复与最终候选

刷写前只读审阅识别出两项 P1：持久 resampler/encoder 的 `60 ms` 累积数据可能跨 flush/generation 形成旧新 PCM 混合包；Dock 并发认证共享同一 decoder，多个连接可能并发 reset 并争夺 active owner。另有两项 P2：编码期间 generation 切换的 stale 丢弃没有准确计入 flushed，形成计数盲点；resampler 启动失败后不重试，可能使当前进程后续连接持续不可用。

四项均在刷写前修复。固件 `OutboundFrame` 携带 mic generation；唯一 TX 在发送前复核 `ready / microphone enabled / not speaking / generation`，编码结束后若 generation 已过期则不发送并增加 `flushed_frames`。resampler 初始化失败执行 `Abort`，bootstrap 可在下一连接重建。Dock 引入 `authenticationBarrier`，串行执行 decoder reset 与 active owner 交接。

回归结果为 Dock `42/42`、固件合同 `47/47`；`npm check`、`npm audit=0`、diff check、PowerShell parse 全部通过。首次 ESP-IDF 构建在新 shell 中因为 `ccache` 缺失于 `PATH`，在编译器启动前失败，因此不属于代码编译失败。补充绝对 `PATH` 后，完整 compile/link/partition 检查通过。

最终 `stack-chan.bin` 大小 `3,990,384 bytes`（`0x3CE370`），SHA-256 `9DF00A654E4E0FCAE39F75E2D4EC662F9302394844EA002CF49A67EF3FEF86C3`；app 分区剩余 `0x121C90`（`1,186,960 bytes`，约 `22.93%`），ESP32-S3 image checksum 与 validation hash 有效。

**在该审阅结项节点，最终候选尚未刷写或实机验证，不能把离线审阅关闭、回归和构建结果记录为产品验收通过；后续写入见 Task 10。**

#### Task 9 并发认证 newest-wins 复核

最终复核又发现一项 Dock P2：原 `authenticationBarrier` 在认证 commit 前释放，旧 hello 仍可能在串行 decoder reset 后抢先 claim owner。修复采用 `authenticationGeneration` newest-wins；只有最新 hello 能在 reset 完成后 claim、ready、attach decoder 并 emit authenticated。stale socket 会先清除自身 `5 s` handshake timer，再关闭连接。

测试明确断言并发 hello 只产生 `1` 次 authenticated、`authenticatedConnections=1`，且最终 owner 音频可正常解码。首次全量虽然 `42/42`，但 stale timer 使 Node 进程总时长约 `5.7 s`；加入 timer 清理后，全量仍为 `42/42`、`fail=0 / cancelled=0`，总时长降至约 `1.125 s`。

该修复只涉及 Dock，固件 app 未变化，继续使用 SHA-256 `9DF00A654E4E0FCAE39F75E2D4EC662F9302394844EA002CF49A67EF3FEF86C3`；Task 9 离线结项时尚未刷写，后续受保护写入见 Task 10。

### 2026-08-07 Task 10：Opus 候选受保护写入

`COM7` 被识别为 `VID_303A / PID_1001` USB Serial/JTAG，factory MAC `44:1b:f6:e2:78:a8`。preflight 读取目标为 ESP32-S3 revision `v0.2`，实时分区为 `ota_0@0x20000 size 5056K`、`ota_1@0x510000`、`assets@0xA00000`。精确候选为 `3,990,384 bytes`（`0x3CE370`），SHA-256 `9DF00A654E4E0FCAE39F75E2D4EC662F9302394844EA002CF49A67EF3FEF86C3`，与受保护脚本 pin 一致。

本轮只把该 app 写入 `ota_0@0x20000`；实际 sector erase 范围 `0x20000..0x3EEFFF`，完全位于 `ota_0`。写入内建校验为 `Hash verified`，独立 `verify_flash` 对同一地址和长度报告 `digest matched`。bootloader、partition table、NVS 与 assets 均未写入。

**当前尚未实体 `RST` 启动新应用，也没有 Dock transport、录音、音质或 Codex Voice 验收；不得把 app-only 写入和双重校验记录为产品通过。**

#### 2026-08-07 Task 10：实体启动后重启循环

用户报告机器人不停重启。`20 s` 的 `COM7` 存在性采样中端口基本持续存在，但出现一次短暂消失。此前一次 Ping 被误判为 `192.168.0.8` 在线；复核原始输出后确认它是本机 `192.168.0.11` 返回 `Destination host unreachable`，不是设备应答，因此“Ping True/设备上线”结论作废。

默认 Python 环境没有 `pyserial`，首个串口命令在打开设备前失败，没有产生任何设备日志。随后使用 ESP-IDF Python，以只读 `DTR=false / RTS=false` 方式采集 `12 s`，有效原始日志保存在 `.claw/runtime/wifi-opus-reboot-com7-20260807-224040.log`。

日志完整重复 `4` 次完全相同的启动签名：`rst:0xc (RTC_SW_CPU_RST)`，`Saved PC:0x4038ac61`，末行均为 `PSRAM: Reserving pool of 64K of internal memory for DMA/internal allocations`；每轮都没有到达 `BOOT-DIAG` 或 `app_main`。对精确 ELF 执行 `addr2line` 后，`0x4038ac61` 映射为 `esp_restart_noos`，位置 `system_internal.c:164`。

这与本文件历史 Stage 0/2/4 的串口复位签名相同，但串口只有最后可见日志，不能证明重启发生在 `app_main` 之前。后续 JTAG 真实调用栈确认系统已经进入 `app_main`，并精确定位当前触发点，见下方记录。Task 10 音频 transport、录音、音质和 Codex Voice 验收在此阶段暂停。

#### 2026-08-07 Task 10：只读静态定位

新旧 app 的只读镜像审计均确认 ESP32-S3 image 合法，尺寸没有越出目标 app 分区。新旧 `init_fn` 与 `.ctors` 成员集合及执行顺序一致；`main_task` 和 `64 KiB` PSRAM DMA reserve 系统路径的机器码也一致。因此没有镜像越界、构造器排序漂移或该系统函数代码变化的证据。

此前把最后一条日志描述为更早的 PSRAM 初始化需要纠正：该日志实际来自 `main_task` 调用 `esp_psram_extram_reserve_dma_pool`，随后才应进入 `app_main`。Wi-Fi audio 构造器调用集合与旧候选相比只少一个 `pthread_mutex_init`，没有新增 Opus 启动构造器。静态证据因此不支持“新增 Opus 构造器在 app_main 前触发重启”，但也没有给出真正调用 `esp_restart_noos` 的上层函数。

下一步不刷写，改用 USB-JTAG 在 `esp_restart_noos` 设置断点，捕获真实调用栈后再决定修复方向。音频验收继续暂停。

#### 2026-08-07 Task 10：启动 footprint 候选与 JTAG 驱动边界

研究代理复核新旧 ELF 后确认 `build-wifi-audio-short` 已实际链接 Opus；唯一新增的 live 启动前 footprint 来自 `esp_ae_rate_cvt`。新候选的 `_iram_text_end` 增加 `0x100`，`_heap_start` 后移 `0x108`（`264 bytes`），而 `esp_psram_extram_reserve_dma_pool` 的 reserve 参数仍固定为 `65,536 bytes`。该差异当时形成内部内存阈值候选；后续 JTAG 真实调用栈已将其作为重启根因推翻，`64 KiB` 只代表串口最后可见的 reserve 日志。

USB-JTAG 只读动态定位分别尝试两个 OpenOCD 版本，均报告 `LIBUSB_ERROR_NOT_FOUND`。Windows 当前目标 `MI_02` 接口使用通用 Microsoft `winusb.inf`；Espressif 官方文档明确此错误需要安装 Espressif WinUSB/JTAG 驱动：[Configure ESP32-S3 built-in JTAG interface](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/jtag-debugging/configure-builtin-jtag.html)。

该检查节点未切换驱动、未刷写、未修改产品代码。用户随后授权切换 JTAG 驱动并取得真实栈，结果见下一节；`63 KiB` reserve 单变量实验不再是后续路线。

#### 2026-08-07 Task 10：USB-JTAG 定位 `wifi_audio_tx` 栈溢出

获得用户授权后，`MI_02` JTAG 接口驱动从 Microsoft `winusb.inf` 切换为已安装 `oem94.inf` / libwdi `6.1.7600.16386`；`MI_00` 的 `COM7` 保持正常。OpenOCD 随后成功识别 MAC `44:1B:F6:E2:78:A8` 与 ESP32-S3 双核。

JTAG halt cause 和 GDB thread `9` 明确报告：`***ERROR*** A stack overflow in task wifi_audio_tx has been detected.`。异常调用链为 `panic_abort -> esp_system_abort -> vApplicationStackOverflowHook -> vTaskSwitchContext`。同时回溯到主任务链 `main_task -> app_main (main.cpp:252) -> start_stackchan... -> xTaskCreatePinnedToCore(wifi_tx_task, stack=4096, core=0)`。

这构成当前重启根因的决定性证据：`wifi_audio_tx` 的 `4096` 字节任务栈溢出触发系统 abort/restart。此前“没有进入 app_main”和“64 KiB reserve / 264-byte footprint 阈值导致重启”两项候选正式作废；`PSRAM: Reserving 64K` 只是串口最后一条可见日志，不能再据此设计内存阈值修复。

原始日志为 `.claw/runtime/openocd-jtag-live.err.log` 与 `.claw/runtime/gdb-wifi-audio-stack-overflow-20260807.log`。本轮没有刷写固件。

#### 2026-08-07 Task 10：`wifi_audio_tx` 栈溢出单变量修复候选

精确反汇编确认当前 `wifi_tx_task` 函数栈帧为 `0x1220`（`4,640 bytes`），而旧 FreeRTOS 任务栈只有 `4,096 bytes`；函数自身最小栈帧已超过任务配置，和 JTAG stack overflow 完全闭合。产品单变量修复新增 `kWifiAudioTxTaskStackBytes = 12 * 1024`，仅将该任务栈扩为 `12 KiB`。协议、Opus、TDM/raw4、队列、任务 core affinity 及半双工状态机保持不变。

修复后的离线门禁为固件合同 `47/47`、Dock `42/42`，`npm check`、`npm audit=0`、diff-check 和 ESP-IDF 完整构建全部通过。新 `stack-chan.bin` 大小仍为 `3,990,384 bytes`，SHA-256 为 `809D4A27FB1B9EF071C8D37B8E9919633D43F9C35C4D7707BEB79F128AC531C0`。最终反汇编中的任务创建参数为 `0x3000`，证明二进制实际携带 `12 KiB` 栈配置。

**在该离线节点，候选尚未刷写、启动或完成实机 transport、音质和 Codex Voice 验收。当前只能宣称根因对应的单变量修改与离线证据闭合；后续受保护写入见下一节。**

#### 2026-08-07 Task 10：12 KiB TX 栈修复候选受保护写入

受保护 preflight 确认目标为 ESP32-S3、factory MAC `44:1b:f6:e2:78:a8`，实时 `ota_0@0x20000`、大小 `5056K`。本轮唯一写入是把精确 app `3,990,384 bytes`、SHA-256 `809D4A27FB1B9EF071C8D37B8E9919633D43F9C35C4D7707BEB79F128AC531C0` 写入 `ota_0@0x20000`。

esptool 内建 image hash 报告 `Hash verified`，随后对同一地址和长度运行的独立 `verify_flash` 报告 `digest matched`。bootloader、partition table、NVS 与 assets 均未改写。

**该写入检查点尚未执行实体 `RST`，当时没有启动稳定性、Dock、transport、音质或 Codex Voice 验收；后续实体合并门禁见下一节。**

#### 2026-08-08 Task 10：12 KiB 候选合并门禁与 peer-close 死等

实体 `RST` 后，`192.168.0.8` 四次 Ping 全部成功，延迟 `3--44 ms`，`COM7` 稳定存在。启动唯一 Dock PID `4952` 后，连接时间线出现一条认证中的主动关闭和随后第二条 TCP 连接；此后设备没有再次重连。

JTAG live 原始日志 `.claw/runtime/gdb-live-auth-state-20260808.log` 显示系统没有 panic，也没有 `wifi_audio_tx` stack overflow；`wifi_audio_tx` 正常阻塞，全部音频任务仍在。`wifi_audio_boot` 则停在 `EspTcp::DoDisconnect(wait_for_task=true)`，其下层为 `xEventGroupWaitBits(..., portMAX_DELAY)`。

源码闭环确认：WebSocket 处理 peer close opcode `0x8` 时只清除 connected 状态并调用 callback，不关闭底层 TCP。bootstrap 析构旧 socket 时进入等待接收任务退出的 Disconnect；接收任务没有收到 abort，因而可以无限等待。最小修复只在 close opcode 分支调用现有 `Abort()`，由 TCP 接收任务自身走非等待 Disconnect。TDM/raw4、Opus、speaker 与 half-duplex 保持不变。

JTAG 工具侧后续报告 memory protection 保护事件，但用户现场确认机器人没有重启，屏幕保持黄灯。黄灯表示应用运行、Dock 未连接，不能把工具事件外推为设备崩溃或离线。本节当时尚未完成 peer-close 生命周期复测。

#### 2026-08-08 Task 10：peer-close 最小修复离线门禁

managed source 和可重放 patch 均把 opcode `0x8` 分支改为直接 `Abort()`。`git apply --reverse --check` 通过，确认工作区 managed source 已应用该 patch；固件合同 `67/67` 通过。

首次完整构建因项目配置为 Python `3.14`、执行时却误用 Python `3.11` 而失败；这是明确的 ESP-IDF 环境错误，不是源码编译失败。改用 `idf5.5_py3.14` 后，第一次外层构建命令在 `60 s` 超时处被中断；随后继续使用同一正确环境完成增量构建，最终 compile/link/partition 检查全部通过。

bootloader 为 `0x5CD0`，剩余 `0x2330`。最终 app 为 `0x3CE350`（`3,990,352 bytes`），app 分区 `0x4F0000`，剩余 `0x121CB0`（约 `23%`）。SHA-256 为 `F98DB5DC41CC97C5B25FE33F4CE4C7C979913B3EF0CED0368B410D0B96F8AA06`；esptool checksum `32` 与 validation hash `098a…71fc` 有效。diff-check 通过，flash script 已 pin 新 length/hash。

**在该离线门禁节点，候选尚未刷写或完成认证、transport、音质和 Codex Voice 复测；后续当前运行边界见下一节。**

#### 2026-08-08 Task 10：运行状态与 coredump 边界纠正

用户现场确认机器人没有重启并持续显示黄灯；黄灯是“应用运行、Dock 未连接”状态，不是崩溃指示。随后只读读取 coredump 分区 `0xE00000 + 0x10000`，内容全为 `0xFF`，没有 coredump。这与 JTAG 中无 panic 的线程状态共同支持“没有设备运行崩溃”。esptool 在读取完成后执行 hard reset，该工具动作发生在取证之后，不能倒推为设备此前自行重启。

当前 F98 候选启动稳定。首个 TCP 连接曾达到 Established，随后静默关闭；Dock 没有记录 `protocolError`，设备回到黄灯/未认证。精确问题边界是 hello/认证没有完成，或连接在该阶段被静默关闭；不能再归因为整机启动、panic 或硬件故障。下一步需确定 hello 是否实际发送/接收，以及关闭由设备、Dock 还是底层 TCP 哪一侧发起。

#### 2026-08-08 Task 10：PC-only 认证诊断与 reconnect 边界

Opus decoder 的 PC-only 基准首次 ready 为 `5.87 ms`，连续 `10` 次 reset 为 `0.17--1.55 ms`，排除 decoder 初始化接近 `5 s` handshake timeout。新增 receiver 认证诊断完成 check 与定向测试 `10/10`。

逐连接时间线为：首连接 accepted 后 `3.138 ms` 以 code `1006` 关闭，没有 hello、没有认证；随后多条旧/竞争连接在 `0.7--1.1 ms` 内关闭。最终连接于 `76.487 ms` 记录 `hello_validated`，`77.516 ms` 记录 `authentication_claimed`，claim 耗时 `0.678 ms`，认证成功。

同窗 JTAG 只读设备内存为 `transport_state=3 (DockConnected) / ready=1 / tx_failed_sends=0 / tx_max_send_us=0x404 (1028 us) / socket_generation=17`。这证明 hello 已由设备成功发送且 transport 进入 ready。首个 request `1` 超时与 JTAG halt 同窗，不能据此判定控制请求实现失败。

用户随后观察到红灯，但空 coredump 与 Ping 支持设备未 panic/崩溃。停止受 JTAG 干扰的 Dock 并强制结束进程后，新 Dock 没有自动收到回连。当前待区分两项：Windows 强杀没有 graceful close、旧 TCP liveness 尚未被设备及时判死，或固件 reconnect 路径本身未恢复。本轮未进入 Opus transport、录音或听感验收。

#### 2026-08-08 Task 10：hello 过期根因与 plain TCP receive timeout 候选

新增认证时间线确认 hello 在 accepted 后 `5,229.239 ms` 才到达，超过 Dock 固定 `5,000 ms` handshake timeout。结合 JTAG 已见的 `Abort() -> EspTcp::DoDisconnect` 永久/长时间等待，根因收敛为：旧 receiver 清理占住唯一 `wifi_audio_tx`，新连接 hello 已排队但直到超时门槛之后才获发送机会。

最小修复在 `esp_tcp` connect 后设置 `SO_RCVTIMEO=250 ms`。`ReceiveTask` 对 `EAGAIN/EWOULDBLOCK` 的处理按连接状态分支：connected 时继续等待后续数据，disconnecting 时退出，让旧 receiver 清理具备时间上界。TDM/raw4、Opus 与 authentication 协议均不改变。

同时发现已有 `esp_tcp` 直接修改未被旧 patch 完整表达，因此新增 `firmware/patches/esp-ml307-wifi-audio-plain-tcp.patch`，相对官方 commit `ab4de7c28...`；CMake 改为循环应用两份 patch，使 managed component 改动可重放。

两份 patch reverse-check、diff-check 与固件合同 `68/68` 通过；ESP-IDF `5.5.5` 完整 build/link/partition 检查通过。候选 app 长度 `3,990,576 bytes`（`0x3CE430`），SHA-256 `BB346C4118ED4AC8C7A55A76A868FF7883BEC46B06FB1E83D08F96ACC958DDE6`；esptool image checksum `d6` 有效，validation hash `e88134b3...ece14` 有效。app 分区剩余 `0x121BD0`、约 `23%`。

#### 2026-08-08 Task 10：receive-timeout 候选受保护写入

写入前 `COM7` preflight 识别 `ESP32-S3 rev0.2`、MAC `44:1b:f6:e2:78:a8`，并读取实时 `ota_0@0x20000`、容量 `5056 KiB`。执行唯一 app-only 写入，将 `3,990,576 bytes` / SHA-256 `BB346C...8DDE6` 候选写入 `ota_0@0x20000`；esptool 内建 hash verified，独立 `verify_flash` digest matched。bootloader、partition table、NVS 与 assets 均未触碰。

**写入已通过完整性验证，但尚无启动稳定性、fresh Dock transport、音质或 Codex Voice 通过证据；写入成功不得写成产品修复完成。下一步为 fresh Dock 客观门禁。**

#### 2026-08-08 Task 10：第一轮 fresh Dock 启动与认证门禁

fresh Dock 日志 `wifi-audio-dock-20260808-005140.stdout.log` / `.stderr.log` 显示：设备 `192.168.0.8` ping `4/4`，TCP Established，机器人本轮未重启。第一条候选连接在 accepted 后 `1,616.054 ms` 以 code `1006` 关闭；第二条连接在 `82.978 ms` 记录 `hello_validated`，`84.167 ms` 记录 `authentication_claimed`，claim 耗时 `0.759 ms`，随后认证成功。另有一个未认证竞争连接在 `0.74 ms` 关闭。

与旧候选 hello `5,229.239 ms` 超过 `5,000 ms` timeout 相比，本轮约 `83 ms` 的 hello 已越过原生命周期门禁，构成 `SO_RCVTIMEO` 修复核心目标的实机通过证据；同时在线、Established、无重启也排除了本轮启动循环。

认证后 request `1` 仍在 `1,500 ms` 超时，且 Dock 没有收到 PCM/Opus 帧。因此当前只能判定旧 receiver 清理与 hello 时限问题已修复，**不能判定 control/transport/audio gate 通过**。下一步只做 PC Dock-only fresh reconnect，区分首连接残留与控制通道问题，不再次刷写。

#### 2026-08-08 Task 10：第二轮 Dock-only 复连与 1024-byte 控制上限

第二轮 Dock-only 日志 `wifi-audio-dock-20260808-005303.stdout.log` / `.stderr.log` 记录 hello `93.463 ms`、authentication claim `95.248 ms` / `0.732 ms`，认证稳定复现；request `1` 仍为 `1,500 ms` 超时，且未出现 PCM/Opus 音频帧。

源码与离线 JSON 序列化复核确认：`get_status` 完整响应在全部计数均为单数字 `0` 时已经是 `1,004 bytes`。真实设备 heap、task stacks 与 TX 计数为多位数时必然超过设备端与 Dock 现有 `1,024 bytes` 控制帧上限，足以确定解释 status 响应被丢弃以及 request `1` 超时。该闭环只覆盖控制响应，不能据此外推 Opus transport 正常或异常的根因。

本轮 JTAG direct init/halt 命令没有输出预期 `mdw`，只打印 reset cause 并短暂 halt 设备，因此属于无效采集；**不得用作 ready 值、任务状态、线程栈或运行路径证据，并停止继续使用这一采集方式。** 下一步为 PC-only bare receiver，只做认证和 ready、不发 `get_status`，从而把音频链与超长控制响应隔离；本阶段不刷写。

#### 2026-08-08 Task 10：bare receiver 隔离结果

首轮 bare receiver 时限仅 `12 s`，设备在 receiver 已关闭后才 accepted，统计为 `connections=0 / frames=0`。该轮未覆盖真实连接窗口，属于无效时窗，不能作为零帧证据。

第二轮 `25 s` 观测有效：连接 accepted，`hello_validated=200.705 ms`，authentication claim `202.159 ms`、claim 耗时 `1.287 ms`，认证成功；另一个竞争连接在 `1.442 ms` 关闭。最终 `connections=2 / authenticated=1 / frames=0 / encodedBytes=0 / decodeErrors=0 / gaps=0`。已认证 socket 于 `12,481.805 ms` 关闭，该关闭由测试进程结束触发。

这轮不发送 `get_status` 仍然收到零帧，因而把两个问题明确分开：`1,024 bytes` 上限确定解释控制响应丢弃/超时，但不是麦克风零帧根因；另有 ready 状态传播、音频任务或 Opus 发送路径问题仍待定位。下一步只读联合观察串口日志与 PC 连接状态，不刷写。

#### 2026-08-08 Task 10：官方完整代码 review 与零帧边界

本轮为只读源码 review；未修改代码，未构建、刷写或新增实机测试。以下严格区分确认事实、高可信候选与未知项。

**确认事实：**

1. 当前产品 ready 后路径为 `InputData -> 24 kHz/16 kHz resample -> 960 samples -> Opus -> WebSocket`（`firmware/main/hal/wifi_audio_dock_mvp.cpp:1453-1513`）。bare receiver 认证后零帧把故障边界确定在 `InputData`/采集/重采样上游，而不是 Dock 解码或超长 status 响应；但缺少同一轮 RX4/counters，无法锁定唯一断点。
2. golden 是单独 `i2s_new_channel(NULL, &rx)` 的 RX-only TDM、`total_slot=4`（`firmware/main/hal/board/cores3_audio_codec.cc:142-172`）；产品在构造时仍一次创建并 enable paired TX/RX（同文件 `:174-252`），仅复用 raw4 geometry/strict read（`:261-320`、`:353-379`）。所以产品拓扑并不等同于已通过的 golden 拓扑。
3. codec-dev 会把 `4ch x 16-bit` RX 对应的 STD TX 扩成 `2ch x 32-bit`，并在 RX 活跃时维持 TX clock（`firmware/managed_components/espressif__esp_codec_dev/platform/audio_codec_data_i2s.c:242-256`、`:409-428`、`:468-481`）；上游 paired STD/TDM 测试见 `firmware/managed_components/espressif__esp_codec_dev/test_apps/codec_dev_test/main/test_board.c:1095-1113`、`:1164-1189`。本地 ESP-IDF `i2s.rst:42-44`、`:908-933` 说明 paired channels 共享时序，`:999-1004` 说明 simplex 约束。因此不能把零帧简单归因于 TX/RX 格式天然不匹配。
4. 官方 Xiaozhi 实现由 `AudioService` 输入任务 priority `8` 配合事件门控、lazy input、失败后 `10 ms` 重试与独立 Opus 任务，在 RX 活跃时保留 TX clock（`firmware/xiaozhi-esp32/main/boards/m5stack-core-s3/cores3_audio_codec.cc:93-181`；`firmware/xiaozhi-esp32/main/audio/audio_service.cc:120-157`、`:183-224`、`:242-285`、`:288-343`、`:806-817`；`firmware/xiaozhi-esp32/main/application.cc:956-978`；`firmware/xiaozhi-esp32/main/audio/processors/no_audio_processor.cc:12-36`）。
5. 本项目的必要偏离是 raw4/MIC1/24 kHz->16 kHz/60 ms Opus/半双工。缺少证据支持的偏离是每次 speaking 都反复 `EnableInput/EnableOutput` 进行物理重配（`firmware/main/hal/wifi_audio_dock_mvp.cpp:511-537`）。

**高可信候选，尚未确认：** `esp_codec_dev_open()` 忽略 `data_if->set_fmt` 的返回值（`firmware/managed_components/espressif__esp_codec_dev/esp_codec_dev.c:176-183`）。format 应用失败可能伪装为 open 成功，随后 read 持续超时，与现象一致；但没有同次返回值与 RX/read counters，不能登记为已确认根因。

**共同未知与路线边界：** format 应用、I2S read、resampler 输入/初始化、ready 状态传播中究竟哪一环首先失败仍未知。两个同端口 simplex channel 常驻不纳入候选方案；若 paired 生命周期被后续证据否定，当前倾向由单一 I2S owner 在 RX-only TDM 与 TX-only STD 间销毁/重建。该倾向尚未实现、构建或实测。

#### 2026-08-08 Task 11：方案 A 单一 I2S owner 离线过程

用户确认方案 A 后，先增加单一 I2S owner 与 `1,500 bytes` 控制帧边界合同。实施前两个定向测试按预期失败，建立红灯基线；这两项失败只表示功能尚未实现，不构成既有功能回归证据。

实现严格限定为：Listening 使用唯一 owner 创建 RX-only TDM `4ch x 16-bit`；Speaking 时由同一 owner 切换为 TX-only STD `2ch x 16-bit`。同时在 codec open 前显式调用并检查 `data_if->set_fmt`，失败向上传播；控制帧上限调整为 `1,500 bytes`，最坏 `UINT32` status 序列化合同通过。

实现后的首轮定向门禁为 firmware contract `51/51`、Dock `10/10`。第一次直接执行增量 `ninja` 因新 shell 缺 ccache PATH、在编译器启动前失败，属于环境而非代码错误；补绝对 PATH 后连续两次增量链接成功。最终全量 firmware `71/71`，Dock `check` 通过、Dock 测试 `42/42`，`git diff --check` 通过。完整 `ninja all` 产出 `stack-chan.bin` 大小 `0x3CE9E0`，`ota_0` 剩余 `0x121620`、约 `23%`。

**当前状态仍是离线 code review：尚未固化镜像 SHA-256，尚未完成补丁重放验证，未刷写，也没有启动、Dock 认证、Opus transport、音质或 Codex Voice 实机证据。不得把 `71/71`、`42/42` 或完整构建外推为方案 A 已修复零帧。**

#### 2026-08-08 Task 11：最终 bounded review、离线门禁与候选身份

继续审阅发现 `3` 项 P1：状态转换失败可能恢复成伪采集、I2S channel 删除失败仍清空句柄、WebSocket 在分配前未先拒绝超长 payload；以及 `2` 项 P2：`active_mode` 跨任务数据竞争、codec-dev close 忽略底层 disable 错误。五项逐一修复，最终 bounded re-review 确认所有 P1 已关闭。反汇编复核为：`DestroyActivePath` stack frame `32 bytes`、symbol size `0x17F`；`CreateListeningPath` `192 bytes` / `0x1A1`；`CreateSpeakingPath` `192 bytes` / `0x193`；`SetWifiAudioMode` `48 bytes` / `0xA6`。未见新的任务栈风险。

最终回归为 firmware `75/75`；Dock `npm check`、全量 `42/42` 通过，测试覆盖真实 Espressif Opus 解码与 `1,000` 帧音频/控制并发压力；三份 managed patch 的 reverse-check 全部通过，`git diff --check` 通过。一次 CMake 因 shell 缺 `IDF_PATH` 失败、早期一次 ninja 因 ccache PATH 缺失失败，均发生在代码构建前的环境阶段；补齐环境后完整 build/link/image/partition 检查成功。

固化候选为 `firmware/build-wifi-audio-opus/stack-chan.bin`，长度 `3,993,152 bytes`（`0x3CEE40`），SHA-256 `36C294E5F4FFDF46B073957F13773E7CD24E13545DE61370923E44DDA57A7B00`。目标分区 `0x4F0000`，剩余 `0x1211C0`、约 `23%`；esptool checksum `54` 有效，validation hash `36c4d561a1b94ebef3175ccd8225d31f1cf9f247d543b52f1c353dcd505306a9` 有效。

flash 脚本已 pin 该镜像身份，并规定任何 `Execute` 前先完整备份当前 `ota_0@0x20000`、长度 `0x4F0000`，同时写出 SHA sidecar；`preflight-only` 明确不写 flash。

**当前仍未执行本轮硬件身份/分区 preflight、ota_0 备份、刷写、启动、Dock transport、录音音质或 Codex Voice 验收。上述审阅、合同、补丁重放、构建和脚本 pin 不得写成方案 A 已在实机通过。**

#### 2026-08-08 Task 12：硬件验收只读 preflight

`COM7` 枚举为 `VID_303A / PID_1001`。本轮候选身份为长度 `3,993,152 bytes`、SHA-256 `36C294E5F4FFDF46B073957F13773E7CD24E13545DE61370923E44DDA57A7B00`。

esptool `4.12.0` 只读识别 `ESP32-S3 QFN56 rev0.2`、`40 MHz`、`USB-Serial/JTAG`，MAC `44:1b:f6:e2:78:a8`。读取设备实时分区表得到 `ota_0@0x20000 / 5056 KiB (0x4F0000)`、`ota_1@0x510000 / 5056 KiB`、`assets@0xA00000 / 4 MiB`、`coredump@0xE00000 / 64 KiB`。候选完整位于实时 `ota_0`，身份与边界检查结果为 `PREFLIGHT PASSED`。

**此时间点没有执行备份、flash erase/write，也没有应用启动、Dock transport、音质或 Codex Voice 验证。预检通过仅授权后续受保护流程，不是实机验收通过。**

#### 2026-08-08 Task 12：第一次 `-Execute` 外层超时

同一候选、同一受保护脚本的第一次 `-Execute` 尝试被外层 shell 的 `120 s` 时限中断。最后一行处于 `Reading current ota_0 ...20260808-021433-ota_0-full.bin`；尚未输出 backup SHA，也未进入 `Writing only ota_0`、`write_flash` 或 verify。

随后只读确认没有残留 Python/esptool 进程，`20260808-021433-ota_0-full.bin` 未生成，`COM7` 仍存在。这不是备份失败或 flash 写入失败，也没有任何设备已刷写证据；仅说明完整读取 `5,056 KiB` ota_0 超过外层 `120 s` 时间预算。

后续保持候选身份、脚本和 app-only 范围不变，只延长外层时限重试。

#### 2026-08-08 Task 12：第二次 `-Execute` 300 秒外层超时

第二次执行仍使用同一候选、同一脚本及同一传输参数，仅将外层 shell 时限改为 `300 s`。日志仍停在完整 `ota_0` 读取起点，未出现 backup SHA、write 或 verify。按前序 `4,096 bytes` 读取实测 `86.5 kbit/s` 估算，`5,056 KiB` 完整分区约需 `8 min`，所以 `300 s` 不足属于可解释的时间预算问题。

中断后只读复查无 Python/esptool 残留进程，`20260808-021711-ota_0-full.bin` 不存在，`COM7` 仍在。流程仍在任何 flash 写入之前停止，不能归类为备份失败、写入失败或设备异常。

后续只把同一脚本外层时限延长至 `15 min`，候选版本、传输参数和 ota_0 app-only 写入范围均不变。

#### 2026-08-08 Task 12：第三次 `-Execute` 完成备份与 app-only 写入

第三次仍使用同一候选、脚本及传输参数，仅把外层时限延长为 `15 min`；全过程实际 `515.7 s`。写入前从 `0x20000` 完整读取旧 `ota_0`：`5,177,344 bytes`，耗时 `452.4 s`、`91.5 kbit/s`。备份文件为 `backups/wifi-audio-preflash/20260808-022602-ota_0-full.bin`；独立回读 Length `5,177,344`、SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED`，与 sidecar 完全一致。

脚本随后仅 erase/write `0x20000..0x3EEFFF`，写入候选 `3,993,152 bytes`；压缩传输量 `2,371,044 bytes`，`23.3 s / 1370.3 kbit/s`。esptool 内建校验为 `Hash verified`，独立 `verify_flash 0x20000 0x3CEE40` 报告 `digest matched`，最终输出 `FLASH AND VERIFY PASSED`。

bootloader、partition table、NVS 与 assets 均未写入。**当前尚未实体 RST、观察启动稳定性或执行 Dock transport、录音音质、Codex Voice 验收，不能把备份与双重校验成功写成方案 A 实机功能通过。**

#### 2026-08-08 Task 12：实体 RST 后重启与 Dock 单变量隔离

用户实体 RST 后，机器人进入系统显示黄灯，偶尔短暂转绿，约 `4-6 s` 后崩溃重启。PC 侧确认旧 standalone Dock PID `792` 仍监听 TCP `8765`；命令为 `node wifi-audio-dock.mjs --port 8765 --microphone-enabled true`，创建时间 `01:04:31`。首轮 ping `1/4` 成功、`3/4` 超时；`COM7` 仍枚举，系统可见多条与 `192.168.0.8` 的 Established TCP 连接。

Dock stdout 重复记录 `accepted -> hello_validated (约 11-312 ms) -> authentication_claimed -> connected -> code 1006 close`。stderr 的 request `1..20` 全部 `1,500 ms` 超时。多轮连接关闭发生在约 `5.0-5.9 s`，与用户观察到的重启时间序列一致。

`25 s` 只读串口日志从 `USB_UART_CHIP_RESET` 开始，包含多次固定 `rst:0xc / Saved PC:0x4038ac61`，末行仍为 `64K reserve`。该签名按历史 JTAG 结论只能证明最终 software reset；它不提供本轮首次故障调用栈，不能重新把 `64K reserve`、PSRAM 阈值或 `esp_restart_noos` 当成真实根因。

停止唯一 Dock PID `792` 并确认 `8765` 无 listener 后，执行 `35` 轮、约 `45 s` 只读隔离：设备 `192.168.0.8` ping `35/35`，`COM7` 存在 `35/35`；用户确认机器人不再重启。

这一单变量对照证明无 Dock 时基础启动、Wi-Fi 与电源稳定，把触发路径收敛到 Dock authentication 后的 Listening/I2S 模式切换或其后控制路径。**当前仍未通过 `5,000` 帧连续 transport gate，也没有录音音质或 Codex Voice 验收，禁止登记为实机通过。**

#### 2026-08-08 Task 13：只读栈根因 review

代码时序确认 Listening RX path 已在 Dock 启动前创建（`firmware/main/hal/wifi_audio_dock_mvp.cpp:1634-1655`）。ready 后再次执行 `SetWifiAudioMode(Listening)` 会因 active mode 已为 Listening 而直接返回，不触发 I2S 重建；`wifi_audio` task 只在 Dock 建连后创建。resampler 在 ready 前完成 open，ready 后才执行 `Read/InputData` 和 resample。因此“ready 导致第二次 I2S 创建”被排除。

最终 ELF 反汇编显示 `audio_task` prologue `0x1180`，静态 frame 为 `4,480 bytes`；该任务分配栈仅 `6,144 bytes`，剩余约 `1,664 bytes` 还要承载 rate_cvt、`InputData/Read/i2s` 调用链。源码局部 `mono[240]` 与 `pending[960]` 都在任务栈。官方 `AudioService` input task 虽为 `6,144 bytes`，但音频 buffers 使用 `std::vector` heap，不能直接照抄其栈尺寸。

本固件 stack canary 已开启，overflow hook 会 abort 并最终进入 software reset，与现场签名一致。结合代码路径和时间上界，锁环、I2S 最长 `1 s` 阻塞、`10 s` 非 panic task WDT 均不符合本轮约 `4-6 s` 的触发条件，予以排除。

`microphone_encode` 静态 frame `3,584 bytes` / task stack `6,144 bytes` 是后继风险；官方 codec task 为 `24,576 bytes`。当前没有证据证明它是第一次复位首因，不应与 `wifi_audio` 一起修改，否则会破坏单变量归因。

最小候选仅把 `wifi_audio` task stack 从 `6,144` 改为 `12 KiB`。首轮实机门禁应先持续 `45 s` 完成 authentication、`get_status` 和 read counters 观察；仅当首个 `60 ms` 音频周期后仍复位，才进一步单独验证 `wifi_opus`。

**本节是只读根因 review：尚未修改代码、构建、刷写或实机测试。现有栈证据为高可信候选，不能写成已确认首因或已修复。**

#### 2026-08-08 Task 13：`wifi_audio` 12 KiB 单变量实现与离线门禁

实现仅在 `wifi_audio_dock_mvp.cpp` 定义 `kWifiAudioCaptureTaskStackBytes = 12 * 1024`，替换 `audio_task` 原 `6,144 bytes` 参数，并在注释中固定 ELF frame `0x1180` 与扩栈原因。`wifi_opus` 保持 `6,144 bytes`，I2S、Opus 协议、控制协议与 PC Dock 均未改；合同同步锁定该边界。

定向固件合同 `56/56`。一次从 `tools/stackchan-dock` 错误 cwd 启动 firmware discovery，报告 start directory not importable；这是运行路径错误，不是测试失败，同窗 Dock `npm check` 与 `42/42` 均通过。回到仓库根目录后 firmware 全量 `75/75`。

首次 `ninja` 失败原因是 PATH 中引用不存在的 ccache `4.11.2`，且没有任何 C++ 编译诊断；本机实际 ccache 为 `4.12.1`。补入实际版本绝对路径后，完整 build/link/image/partition 检查成功。

最终 app 仍为 `3,993,152 bytes / 0x3CEE40`，partition `0x4F0000`、free `0x1211C0`、约 `23%`。新 SHA-256 `E215D6504753D792C70ED2512A32929287ECB36DD46B41E75286A649784E2EB6`；esptool checksum `e6`、validation hash `741b3107a81b9373e98e327f742d1d1430b3e8647c1973f191afb18c414338e7` 均有效。受保护 flash 脚本 pin 已更新到该 SHA，长度保持不变。

最终门禁再次确认 firmware `75/75`、三份 managed patch reverse-check、`git diff --check` 与 pin check，输出 `FINAL_OFFLINE_GATE_OK`；Dock `check + 42/42` 来自本轮前序验证。

**该哈希候选尚未刷写或做实体启动、`45 s` 稳定性、get_status/read counters、连续 transport、音质和 Codex Voice 验收。不能因镜像长度未变而沿用旧候选的实机结论。**

#### 2026-08-08 Task 14：JTAG 决定性根因与单变量纠正

旧失败镜像继续运行且本轮没有刷写。启动 OpenOCD PID `32696` 后确认双核、JTAG 与目标 MAC，再启动唯一诊断 Dock PID `35644` 触发一次。OpenOCD 日志保存在 `.claw/runtime/openocd-audio-stack-20260808-095230.err.log`。

halt cause 为原文 `***ERROR*** A stack overflow in task wifi_opus has been detected.`。GDB 线程 `5`（CPU0）调用链为 `panic_abort -> esp_system_abort -> vApplicationStackOverflowHook(task wifi_opus) -> vTaskSwitchContext -> _frxt_dispatch`。同一 halt 窗口中，线程 `10` 的 `wifi_audio` 正常停在 `i2s_channel_read(size=1920)`，command task 正常等待 `xQueueReceive`。这组并发线程证据确认实际溢出任务是 `wifi_opus`，而非 capture `wifi_audio` 或 I2S read。

取证结束后 monitor resume/detach，并停止 PID `35644` 与 `32696`；复查两进程均不存在，TCP `8765 / 3333` 无 listener，设备 ping `2/2`。

因此 Task 13 的 capture `12 KiB` 候选被正式推翻。该镜像从未刷写，代码已撤销 capture 扩栈并把 `wifi_audio` 恢复为 `6,144 bytes`；新的唯一变量是把 `wifi_opus` stack 改为 `24 KiB`，与官方 `AudioService` 的 Opus codec task 直接对齐。

**当前仅完成代码纠正；尚未重新执行合同、完整构建、候选哈希固化、刷写或实机 transport/音质/Codex Voice 验收。JTAG 根因已定案不等于修复已通过。**

#### 2026-08-08 Task 14：`wifi_opus` 24 KiB 最终离线候选

真实修复候选撤销 capture `12 KiB`：`wifi_audio` 恢复为 `6,144 bytes`；新增 `kWifiAudioOpusTaskStackBytes = 24 * 1024`，且只替换 `wifi_opus` 任务创建栈。理由是 JTAG 已直接命中 `wifi_opus` overflow，并与官方 `AudioService` codec task 的 `24 KiB` 配置对齐。合同同步更新以防变量漂移。

固件全量 `75/75`，ESP-IDF 完整 `ninja` build/link/image/partition 检查通过。Dock 代码没有变化，复用同一轮已通过的 `npm check + 42/42`。最终 ELF 反汇编显示 `wifi_opus` 创建参数由 `movi a12, 3` 与后续 `slli ... 13` 得到 `24,576 bytes`，二进制已精确携带新配置。

app 为 `3,993,152 bytes / 0x3CEE40`，partition `0x4F0000`、free `0x1211C0`、约 `23%`。SHA-256 `D6686B27E100A2940D45A3984320897E5BF886C966D59160D23358D30C9630AD`；esptool checksum `7d` 有效，validation hash `695fc3be67971b66edd2e750fa22f8bff5b7fc815085463b70bb9649ec47f8d0` 有效。flash 脚本 pin 已更新；最终 `75/75 + pin check + git diff --check` 输出 `OPUS_STACK_FINAL_GATE_OK`。

此前完整旧 `ota_0` 回滚备份 SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED` 仍有效。**该新哈希尚未刷写或实机验证；不得把离线构建、ELF 参数与 JTAG 根因闭环记录成启动、transport、音质或 Codex Voice 已通过。**

#### 2026-08-08 Task 14：既有 ota_0 备份复用门禁

受保护 flash 脚本新增可选 `-ExistingBackupPath`。默认路径保持不变，仍在 Execute 写入前完整 `read_flash` 当前 `ota_0`。复用路径则在任何 write 前强制检查：目标文件存在、Length 精确 `0x4F0000`、对应 SHA sidecar 存在、现场 `Get-FileHash` 与 sidecar 值一致；任一检查失败直接 throw。

保护合同加入后 firmware 全量 `76/76`，PowerShell 语法解析通过。现有 `backups/wifi-audio-preflash/20260808-022602-ota_0-full.bin` 实测长度 `0x4F0000`，现场 SHA 与 sidecar 匹配；D668 候选长度/哈希 pin 也匹配，离线复用门禁输出 `REUSE_BACKUP_GATE_OK`。

**本节尚未执行下载模式硬件 preflight，也未刷写 D668 候选。复用旧完整备份的资格检查通过不等于设备 flash 内容已变化或功能已验收。**

#### 2026-08-08 Task 15：OpenOCD JTAG app-only 写入与校验

无需实体进入 ROM 下载模式。执行前只读审查本机 OpenOCD `esp_common.cfg` 的 `program_esp` 实现：`flash write_image erase` 使用指定 binary/address，`esp verify_bank_hash` 直接读 flash 做 verify，之后 `reset run`；usage 要求 binary 与 address 同时传入。

实际命令为 `program_esp .../stack-chan.bin 0x20000 verify reset exit`。OpenOCD/JTAG 识别 serial/MAC `44:1B:F6:E2:78:A8`、双 TAP/双核、ESP32-S3 rev `0.2`。检测到 existing content mismatched 后，从 `0x20000` 开始只处理候选镜像范围：逻辑长度 `3,993,152 bytes`，扇区对齐实际擦写 `3,993,600 bytes`。erase `5,236.86 ms`；data `3,993,600 bytes / 35,582 ms`；write `35,827.9 ms`；总计 `44,174 ms`。

校验阶段输出 `Verify Started`，随后 `Flash verified 2241.45 ms` 与 `Verify OK`；接着 `Resetting Target`，OpenOCD shutdown，exit code `0`。候选身份为 SHA-256 `D6686B27E100A2940D45A3984320897E5BF886C966D59160D23358D30C9630AD`。bootloader、partition table、NVS、assets 均未写入；旧完整备份 SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED` 仍可用于回滚。

**当前只完成 app-only 写入和 flash verify。`reset run` 不等于启动稳定性门禁通过；尚无 Dock authentication、Opus transport、录音音质或 Codex Voice 验收。**

#### 2026-08-08 Task 15：无人值守启动与无效 JTAG 快照边界

D668 写入后 fresh Dock PID `24140` 于 `10:15:07` 监听 `8765`；设备 ping `3/3`、`COM7` 正常，但截至 `10:18` 没有 TCP，Dock stdout 只有四行启动内容、stderr 为空。`22 s` 只读串口成功打开但收到 `0` 设备字节。

约 `10:20` OpenOCD 在读取线程时发现 memory protection 并自动 soft reset，所以该快照不能代表复位前状态。快照内 `wifi_opus / wifi_audio_tx / cmd` 存在、`boot / capture` 尚无，只是 reset 早期状态。随后约 `17 s` ping `0/4`、`COM7` 仍在、Dock 无连接；由于 JTAG 已改变状态，不得推断为产品新崩溃。

`10:21` 先以 DTR/RTS=false 连接串口，再显式 OpenOCD `init; reset run; shutdown`。reset/capture exit 均为 `0`；原始日志 `.claw/runtime/wifi-audio-d668-controlled-reset-com7-20260808.log` 到 `RTC_SW_SYS_RST/JTAG`、D668 app 信息和 `esp_psram Reserving pool of 64K...`，之后 `28 s` 无串口数据。窗口后 ping `5/5`（`100 / 30 / 15 / 84 / 37 ms`）、`COM7` 正常，故最后一行不是“卡在 PSRAM”的证据；Dock 仍无 TCP。

直接 OpenOCD `mdw phys` 因命令不支持及 CPU1 examination 失败，属于无效采集；已 `reset run; shutdown` 恢复。源码显示 `transport_bootstrap` 在首次 codec/Listening 初始化失败时直接 `vTaskDelete`；线程中有 tx/opus/cmd/led、无 boot/capture 与该分支一致，但当时没有精确 `transition_error`，只标高可信未确认。

#### 2026-08-08 Task 16：bootstrap 自删确认与资源解释纠正

线程/源码闭环确认 bootstrap 首次 codec/Listening 失败后永久退出；`Connect` 位于失败分支之后，四 worker 存在而 boot/capture 缺失证明 boot 曾启动后自删。

一度把普通 `24 KiB` 栈误判为会按 `512 bytes` 阈值自动进入 PSRAM。查 ESP-IDF `freertos/heap_idf.c` 后纠正：`pvPortMalloc` 强制 `INTERNAL | 8BIT`，普通 `xTaskCreate` stack 始终使用内部 RAM。D668 相比旧 `6 KiB` 额外消耗约 `18 KiB` 内部 RAM，I2S DMA 也要求 `INTERNAL | DMA`。资源挤压为高可信解释，具体失败叶节点仍未知。

实现保留 `wifi_opus=24 KiB`，改 `xTaskCreatePinnedToCoreWithCaps(...MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)`，三处回滚同步 `vTaskDeleteWithCaps`；bootstrap 每次都 apply Listening，失败后 `1 s` continue，成功前不允许 `CreateWebSocket`。固件 `77/77`，完整 build/link/partition 通过；bin `3,993,200 / 0x3CEE70`，free `0x121190 / 23%`，SHA `520FD7B36CA94160BDE46FFDC630EE392E21992B25629916EC1D0A7418A64E47`，checksum `55`、validation hash `160f703707ed98f763bb05d7204600c7cb657fc6bac252169daca70c8c52514d` 有效；ELF caps create/delete、pin 与 `FINAL_OFFLINE_GATE_OK` 均通过。此节点尚未刷写。

#### 2026-08-08 Task 16：JTAG 写入恢复与首轮实机

preflight 匹配候选 `3,993,200 / 520F...A64E47`，既有回滚备份 `5,177,344 / 5708...C2ED` 与 sidecar 一致，Dock 已停、`8765` 无 listener。首轮 `40 MHz` JTAG 在擦除 `3,993,600 bytes` 后 algorithm stopped，`transferred=0 / write failed / exit=1`，形成 app 区中间态。立即以 `10 MHz`、同镜像恢复：erase `5,251.34 ms`、transfer `36,047.1 ms @ 108.192 KiB/s`、write `36,292.1 ms`、total `44,488 ms`、verify `2,245.62 ms`，`Verify OK`、reset、exit `0`。

fresh Dock PID `4008` / `wifi-audio-dock-20260808-103812.*` 在 hello `13.764 ms`、auth `15.602 ms` 后收到并解码首帧 Opus：`143 -> 2,880 bytes`，`decode_errors=0 / gaps=0 / peak=147 / rms=47.33`。`3.505 s` 后 code `1006`，request `1` 在 `1,500 ms` 超时；随后多次 accepted 后 auth 前 `1006`，最终无 TCP。设备 ping `8/8`、`COM7` 正常。bootstrap/零 TCP 已越过，PSRAM task stack 实际运行到首帧，但 transport 未通过。

#### 2026-08-08 Task 16：bare receiver 有效隔离

JTAG 在线触发窗口无 panic/reset，设备 ping `5/5`，所以 `1006` 不能记成已证实 reboot。第一次 bare receiver 在 reset 后约 `10 s` 才监听、零连接，是无效时窗。

有效测试先监听再 software reset：hello `82.099 ms`、auth `83.708 ms`；不发 `get_status` 时连续 `75` 帧，`encoded=10,928 bytes / PCM=216,000 bytes`，`decodeErrors/gaps/duplicate/out_of_order/invalid=0`。`7.273 s` close 是 receiver `50 s` 总时限收尾，不归因设备。第二个 status A/B 尝试 reset 后 `15 s` 仍零连接，为无效测试，不形成 status 结论。剩余边界高度收敛到控制发送或其与音频发送的并发。

#### 2026-08-08 Task 16：`WebSocket::Abort` 硬件断点定案

硬件断点命中 `WebSocket::Abort`，调用者为 `wifi_tx_task` transmit lambda（`wifi_audio_dock_mvp.cpp:1379`）。失败帧字段：`length=159 / binary=true / microphone=true / generation=3 / microphone_generation=6`。当时 `s_tx_failed_sends=1 / s_microphone_send_failures=1 / s_microphone_frames_sent=27 / s_microphone_frames_encoded=36 / s_microphone_frames_captured=48`。

因此设备在 Opus microphone binary frame 的 `socket->Send` 返回 false 后主动 Abort。它不是 `get_status` JSON，不是 Dock handshake timeout，也不是设备 panic/reboot。针对 `EspTcp::Send:146` errno 的第二次断点尚未命中，且 GDB/OpenOCD/Dock 有残留进程；当前只执行清理和恢复运行，**不得写出 errno 或更下层失败原因。**

#### 2026-08-08 Task 16：官方/ESP-IDF 发送语义 review

当前 PC Dock WebSocket 调用 `SetSendTimeout(200 ms)`。ESP-IDF/lwIP 路径确认：send buffer 暂时不可用或 `ERR_MEM` 时会按带超时的阻塞语义等待；超时且零字节提交返回 `ERR_WOULDBLOCK`，映射为 `EAGAIN`；部分写入按成功返回，`EspTcp` 再循环发送剩余数据。超时检查可能直到约 `1 s` TCP poll 才触发。

官方 Xiaozhi WebSocket 不设置 send timeout；`40` 个 `60 ms` Opus 包的发送队列满时阻塞等待，`SendAudio` 返回 false 只停止当次 drain，不主动 `Abort`。当前产品则在 microphone Send false 后立即 Abort，属于关键行为偏离。

现场 counters 精确闭合：`36 encoded - 27 sent - 1 failed = 8 queued`，等于 TX queue 容量。这说明一次 send 阻塞期间 encoder 填满 `8` 帧队列，随后 send 失败触发 Abort。失败帧 `159 bytes`，远小于 `5,760 bytes` sndbuf，不是单帧尺寸问题。最可能 errno 是 `EAGAIN`，但尚未实际取得，`ECONNRESET / ENOTCONN` 仍未排除。

两次地址断点不构成证据：第一次源行被优化、无可独立断点指令；第二次被启动期 memory protection/JTAG trap 干扰，未命中目标。不得从中推断 errno。

最小单变量候选仅删除 PC Dock WebSocket 的 `SetSendTimeout(200 ms)`，恢复官方阻塞 send；队列、Abort、reconnect、I2S、Opus 与 Dock 协议全部保持。**当前尚未实现、构建、刷写或实机验证该候选。**

#### 2026-08-08 Task 17：移除 send timeout 的离线候选

代码单变量仅删除 `wifi_audio_dock_mvp.cpp` 的 `kWifiAudioSendTimeoutMs=200` 和 PC Dock socket 的 `SetSendTimeout` 调用。通用 WebSocket/TCP timeout API、队列、Abort、重连、I2S、Opus 编码及音频参数保持不变。定向测试 `58/58`，全量 firmware `77/77`。

第一次普通 `firmware/build` 使用的是通用 `sdkconfig`，不是 Wi-Fi Audio 的 `sdkconfig.wifi_audio`。虽然完整构建已显示 `Project build complete`，镜像 `0x36E430` 因配置错误被拒绝刷写；外层 `181 s` timeout 出现在完成提示之后，不能记为代码构建失败，也不能使错误配置产物变成候选。

正确的 `build-wifi-audio-opus + sdkconfig.wifi_audio` 构建 exit `0`。app 长度 `3,993,168 / 0x3CEE50`，partition `0x4F0000`、free `0x1211B0 / 23%`；SHA-256 `7F9CD0101B5BF39C1A6F8C934368BC286147C533674F093FDBDAC23A6A6CBCED`，checksum `e0` 有效，validation hash `48e2...1bab0` 有效。flash script pin 已更新。

**该专用候选尚未写入或实机验证。普通 `0x36E430` 镜像明确禁止刷写；Task 17 只有 `7F9C...CBCED` 可进入下一步硬件门禁。**

#### 2026-08-08 Task 18：7F9C JTAG app-only 写入恢复

目标候选 SHA-256 `7F9CD0101B5BF39C1A6F8C934368BC286147C533674F093FDBDAC23A6A6CBCED`。第一次从运行态以 `10 MHz` 调用 `program_esp`：芯片识别和 existing mismatch 检查完成后，擦除对齐范围 `3,993,600 bytes / 57.435 ms`，随后 algorithm 意外停止，`Transferred=0 / write failed / exit=1`。该时点 app 区是不完整中间态。

保持镜像、地址和 JTAG 频率全部不变；目标停在 ROM 后第二次重试同一 `0x20000` app。erase `3,993,600 bytes / 5,235.45 ms`，transfer `35,665.8 ms @ 109.349 KiB/s`，write `35,915.7 ms`，total `43,935 ms`；verify `2,244.06 ms`，输出 `Verify OK`、reset、exit `0`。

只有 app `0x20000` 镜像范围被处理，其他分区未写；已有完整回滚备份保持有效。**第二次成功恢复了候选并通过 flash 校验，但尚无 transport、音质或 Codex Voice 实机通过证据。**

#### 2026-08-08 Task 18/19：无 timeout 候选实机反证

全 Dock 首次连接：hello `16.766 ms`、auth `19.034 ms`，同一 TCP 持续超过 `60 s`，ping `10/10`，旧约 `3.7 s` Abort 不再复现；但 Opus `0` 帧，request `1 (set_audio)` 仍在 `1,500 ms` 超时。

第一轮 `30 s` bare receiver 在 final 后才接受设备连接，标记无效。有效 `120 s` bare 窗口为 hello `89.291 ms`、auth `91.161 ms`，连接持续 `111,962.225 ms`，`reconnect/decodeErrors/gaps/duplicates/out_of_order/invalid=0`；但仅接收 `21` 帧、`3,003 encoded bytes / 60,480 PCM bytes`。按 `60 ms` 周期同期应约 `1,866` 帧，实际吞吐远未达到实时门槛。

这构成对“完全删除 send timeout”的实机反证：稳定连接和避免 Abort 的收益成立，但阻塞 send 使音频传输长期停滞，产品不可用。bare final 之后自动 MCP Dock PID `12032` 才抢占 `8765` 并出现多连接，不影响该有效窗口归因。

下一单变量尚未实现：恢复 `200 ms` timeout；Send false 后读取 `GetLastError`，`EAGAIN/EWOULDBLOCK` 只丢弃当前过期 mic frame、不 Abort，fatal errno 才 Abort。**目前无实现、离线门禁、刷写或实测结果。**

#### 2026-08-08 Task 20：EAGAIN 麦克风帧丢弃离线候选

Task 20 恢复 `SetSendTimeout(200 ms)`。任何 `Send=false` 都立即调用 `GetLastError`，保留原有 failed counters 并把 errno 写入日志。容错条件严格限定为 `frame.microphone && errno == EAGAIN`：仅丢弃当前过期 mic frame、继续连接；控制帧 EAGAIN 或任意其他 errno 继续 Abort/reconnect。

没有扩大 queue，没有重试过期帧，音频格式、帧长、Opus、I2S 与调度均不变。固件全量 `77/77`，正确专用构建 exit `0`。app `3,993,280 / 0x3CEEC0`，free `0x121140 / 23%`；SHA-256 `D81E317731E339C6585EFDA88D1641F3317A01E00EFC91F18E5D4DCD51220F72`，checksum `78`、validation hash `2cd809...99f1b` 有效；flash pin 已更新。

最终 ELF 中 `EspTcp::Send` 失败分支以 `s32i` 将 errno 存入 `this+52`，`GetLastError` 符号与调用均存在，二进制证据与源码一致。

**该候选尚未刷写或实机验证，不能从 `77/77`、构建和 ELF 闭环外推 transport、音质或 Codex Voice 已通过。**

#### 2026-08-08 Task 21：D81E JTAG app-only 写入

写前先停止占用 `8765` 的 MCP Dock 及其父启动脚本，复核候选 SHA-256 `D81E317731E339C6585EFDA88D1641F3317A01E00EFC91F18E5D4DCD51220F72`。单独 reset halt 使目标停在 ROM 后，以 `10 MHz` 执行 app-only program。

一次写入成功：erase `3,993,600 bytes / 5,250.63 ms`；transfer `35,539.7 ms @ 109.737 KiB/s`；write `35,791.5 ms`；total `43,827 ms`；verify `2,245.1 ms`，输出 `Verify OK`，随后 reset、exit `0`。

写入范围仅为 `ota_0` app 镜像，bootloader、partition table、NVS、assets 等未改，完整旧备份仍有效。**本节点只有写入/校验证据，尚未完成 transport、音质或 Codex Voice 实机验收。**

#### 2026-08-08 Task 21：D81E bare receiver 实机失败

有效日志 `.claw/runtime/bare-receiver-task21.out.log` 记录 hello `10.955 ms`、auth `12.874 ms`，同一连接稳定 `119,797 ms`，无 reconnect、decode error 或 gap；但仅 `5` 个 Opus frame、`715 encoded bytes / 14,400 decoded PCM bytes`。实时 `60 ms` 帧在该窗口应约 `2,000` 帧，因此 transport gate 明确失败，未进入试听/Codex。

一次 OpenOCD `mdw` 读取没有输出目标内存，并使设备短暂失联；reset halt/resume 后恢复。该采集无效，不形成 counters 证据。

#### 2026-08-08 Task 22：PC-only 逐帧停滞时间线

脚本 `.claw/runtime/bare_receiver_verbose_task22.mjs` syntax check 通过，日志 `.claw/runtime/bare-receiver-task22.out.log`。hello `9.599 ms`、claim `11.220 ms`；仅 seq `1..4`，每帧 `143 bytes`。sinceAuth `73.383 / 103.314 / 172.761 / 276.298 ms`，arrival delta `29.931 / 69.447 / 103.537 ms`，device capture delta `10.960 / 59.850 / 59.999 ms`。

之后 TCP 仍 Established，到测试收尾 `59,246.681 ms` 才关闭；final `frames=4 / decodeErrors=0 / gaps=0 / reconnect=0`。约前 `276 ms` 音频链正常，随后不是均匀低速而是完全停滞。PktMon 拒绝访问，故无 ACK/window 证据；本轮没有固件改动、构建或刷写。

随后 fresh status receiver 两次仅 accepted，在约 `1,465.551 / 1,556.397 ms` 后 code `1006`，没有 hello/auth/status。常驻 TX 路径在前一连接停滞后没有自动恢复，但没有 status counters 可进一步定位。

#### 2026-08-08 Task 22/23：partial-frame 风险与 raw observer

源码确认 WebSocket 先形成完整 frame，`EspTcp::Send` 循环底层 send；`SO_SNDTIMEO` 允许先部分写，再在零进展时 EAGAIN，而上层 false 不携带已写字节数。故 Send false 后 drop 逻辑帧、保留 TCP 在协议上确定不安全；官方无短 send timeout，不会在消息中间 drop。

Task 23 第一次 JTAG reset raw observer 因 cache error，`30 s` 零连接、ping `0/4`，无效；`reset halt; resume` 后首 ping timeout、后 `4/4`。第二次 JTAG reset + status 同样 cache error 无效，恢复后 ping `5/5`。这些采集均不得记成产品故障，且没有 flash 写入。

有效 raw observer 收到 hello `264 bytes` 和 `38` 个完整 WebSocket 音频帧；audio raw 约 `6,397 bytes`，total `6,661 bytes`。最后 payload 在 `2.264 s`，之后到 `28.5 s` 无新 TCP payload；final `38 frames / 0 gaps / 0 decode errors`。最后一帧完整、随后 raw 为零，未实证本窗口发生 partial 残帧。`TCP_SND_BUF_DEFAULT=5,760` 只是当前排队预算，ACK 可释放，不是累计上限；PktMon 无权限，缺 ACK/window 抓包。TCPIP priority `18` 高于相关任务 `5/4`，不能用任务优先级解释 ACK 永久不处理。

测试结束后 Node 留下两条设备侧 TCP Established，但均未 WS upgrade。代码确认 `WebSocket::Connect` 三个 handshake 失败出口不即时 Disconnect，资源至少保留到局部 `shared_ptr/unique_ptr` 析构；`EspTcp` 析构会 Disconnect。由于缺连接年龄与 owner 析构证据，不能登记为永久 socket 泄漏。恢复后的 valid status probe 只有 hello `264 bytes`，`19.25 s` 零音频，request `1` 超时。

**确认事实是 payload 在 `2.264 s` 后停止，以及 handshake 失败出口不即时 Disconnect；永久泄漏未确认。partial 后 drop 在协议上不安全，但该 raw 窗口未见残帧。首版最小修复建议：任意 Send 失败 Abort/reconnect；发握手 GET 前安装 callback/清 event；三个握手失败出口即时 Disconnect。本轮未实现、无固件写入、无音质/Codex 验收。**

#### 2026-08-08 Task 24：可恢复 WebSocket 生命周期离线候选

候选实施三项：`wifi_tx` 对任何 Send false 都 Abort/reconnect，删除 EAGAIN drop 后继续复用连接；`WebSocket::Connect` 在发送 GET 前先清 handshake 状态并注册 `OnStream/OnDisconnected`；handshake request send 失败、HTTP non-101 与 `10 s` timeout 三个出口均立即 Disconnect，析构只要 `tcp_` 非空也 Disconnect。

新增 `firmware/patches/esp-ml307-wifi-audio-websocket-lifecycle.patch`，CMake 纳入该 managed patch；reverse apply check 通过。第一次 `ninja` 因 shell 缺 `IDF_PATH` 在 CMake 阶段终止，属于环境失败。加载 ESP-IDF `5.5.5` 后，完整构建用时 `112.2 s` 并成功。

离线门禁为 firmware `78/78`、Dock `npm test 42/42`、`npm run check`、patch reverse-check 全部通过。app `3,993,280 / 0x3CEEC0`，partition `0x4F0000`、free `0x121140 / 23%`；SHA-256 `822F743B591FE7EE09A07583F2297D49100C9F8B11D47541BDFA57CD0521ED95`，checksum `04`，validation hash `1992b5071079504378533b60989a8a8b2ab25a6ccef1a264c0e2d487dfd209f8` 均有效；flash pin 已更新。

**当前尚未 preflight、刷写或实机验证。`78/78` 与构建只证明候选可重放和离线行为闭合，不能写成 transport、音质或 Codex Voice 已修复。**

#### 2026-08-08 Task 25：822F JTAG app-only 写入恢复

preflight 校验 candidate Length `3,993,280`、SHA pin `822F743B591FE7EE09A07583F2297D49100C9F8B11D47541BDFA57CD0521ED95`；rollback Length `5,177,344`、SHA `5708...C2ED` 与 sidecar 一致。`8765` 无 listener，MI_02 JTAG 正常。

首次运行态 `program_esp` 在识别 MAC/JTAG 后出现 cache error；existing mismatch 后擦除 `3,993,600 bytes / 57.619 ms`，algorithm stopped、transfer `0/3,993,600`、exit `1`，app 镜像范围处于中间态。

保持所有变量不变，在同一 OpenOCD 会话执行 `init; reset halt; sleep 500` 进入 ROM halt，再 program 同一镜像。第二次 flash `16 MiB`，erase `5,239.88 ms`，transfer `35,763.5 ms @ 109.05 KiB/s`，write `36,009.5 ms`，total `44,105 ms`；verify `2,245.74 ms`，输出 `Verify OK`、reset、exit `0`。

只写 app `0x20000` 镜像范围，其他分区未改，旧完整备份继续有效。**此节点尚无启动、transport、音质或 Codex Voice 功能验收。**

#### 2026-08-08 Task 25：启动通过、65 秒 transport 失败

写后 `8 s` 设备 ping `5/5`，USB 三接口正常，说明基础启动通过。日志 `.claw/runtime/bare-receiver-task25-transport.out.log` / `.err`。

第一次连接 hello `69.479 ms`、claim `72.787 ms`；seq `1..10` 连续，每帧 `143 bytes`，最后 sinceAuth `669.081 ms`。约 `5 s get_status` 窗口时，连接在 `5,153.926 ms` 以 `1006` 关闭，status 显示 Dock disconnected。Send-false Abort/reconnect 已替代旧的静默坏连接，但没有恢复 transport 吞吐。

后续六次 accepted 中，四次 app hello 为约 `5,309.719 / 5,293.285 / 5,211.363 / 5,294.039 ms`，超过 PC `5 s` handshake 时限后关闭；另两次约 `0.7 ms` 关闭。final `connections=7 / auth=1 / rejected=4 / frames=10 / encoded=1,430 / PCM=28,800 / decode=0 / gaps=0 / raw chunks=15 / bytes=2,990`。

65 秒目标约 `1,000` 帧，实际 `10` 帧，transport gate 明确失败，因此不试听、不进入 Codex Voice。**确认收益仅是生命周期可恢复；底层 send 停滞与重连 hello 约 `5.3 s` 延迟仍存在，候选不可用。**

#### 2026-08-08 Task 26：PC-only handshake timeout 与 ping 诊断

本轮无固件修改、构建或刷写。支持 `handshakeTimeoutMs` 的 raw receiver 在 `10 s` 配置下记录：accepted 后 app hello 于 `10,219.219 ms` 才出现，`10,226.467 ms` 连接关闭，未认证；日志 `.claw/runtime/bare-receiver-task26-counters.out.log`。hello 延迟与 PC timeout 同步从约 `5 s` 变为约 `10 s`。

开启每 `100 ms` WebSocket ping 的 `30 s` 测试记录在 `.claw/runtime/bare-receiver-task26-ping100.out.log`。final `connections=3 / auth=0`；第二连接约 `10,142.945 ms` 一次收到 `810 bytes` raw chunk，其中 app hello `264 bytes`，其余约 `546 bytes` 与约 `91` 个 masked pong 大小一致；此前没有 raw payload，随后连接超时关闭。

这些观察确认设备接收了 PC ping 并生成 pong，但 hello/pong 上行被约 `10 s` 聚合/延迟后一起到达。**不得据此宣称 `wifi_tx` 已死亡，也不能归因为纯 ACK 丢失。** `SetNoDelay(true)` 是正在对照的官方差异，当前只读研究，尚无候选实现、构建、刷写或实测。

#### 2026-08-08 Task 27：GDB 重连状态快照

raw receiver `30 s / handshake 20 s`，无 ping/status，日志 `.claw/runtime/bare-receiver-task27-jtag.out.log` / `.err.log`。accepted 后 raw hello `264 bytes` 在 `21,608.989 ms` 才到，`hello_validated elapsed=20,256.221 ms`，随后 `1006`；第二连接约 `5.33 s` 关闭，`auth=0 / audio=0`。

第一次 OpenOCD 参数解析失败，无效。第二次 OpenOCD PID `11152`，JTAG serial/MAC 正确；`.claw/runtime/gdb-task27.stdout.log` 显示 `wifi_audio_tx` 在 `wifi_tx_task:1400 -> ulTaskGenericNotifyTake(portMAX)`，`wifi_opus` 等队列，`wifi_audio` 阻塞 I2S，`wifi_audio_boot` 在 `WebSocket::Connect -> EspTcp::Connect -> lwip_connect -> netconn_connect`。快照时已重连，排除 TX 当时卡 Send/Abort，但不解释前一连接。

detach 后目标仍 halt，ping timeout 是调试副作用；telnet resume 无效。停止 PID `11152` 后 `reset halt -> resume -> shutdown`，ping `5/5`。该窗口不计产品稳定性；无新固件、构建、刷写、音质或 Codex。

#### 2026-08-08 Task 28：Send 入口与连续工作反证

`EspTcp::Send` 两次入口断点：`169 bytes / total0 / fd54` 来自 `WebSocket::Connect:188` HTTP upgrade；`264 bytes / total0 / fd54` 来自 `wifi_audio_tx -> WebSocket::Send` app hello。命令 `.claw/runtime/gdb_task28_first_two_sends.cmd`，日志 `.claw/runtime/gdb-task28.stdout.log` / `.stderr.log`。

`.claw/runtime/bare-receiver-task28.out.log` / `.err.log` 的 `30 s` 测试为 `auth1 / 474 frames / encoded69,417 / PCM1,365,120 / decode0 / gap0`，约 `28.4 s`，反证“822F 必然约 10 帧停”。`75 s` 混合日志 `bare-receiver-task28-75s.*` 为 `connections6/auth2/frames269/decode0/gap0/reconnect1`；`45 s` 日志 `bare-receiver-task28-disconnect.*` 为 `connections2/auth2/frames659/decode0/gap0/reconnect1`，第一连接 `18.561 s` 断开，raw 有批量补发，不能判稳定通过。外部 OpenOCD send-false 断点在已有 GDB 会话时未命中，无效。

#### 2026-08-08 Task 29：PC Close 触发本次 Disconnect

GDB 通过 `.claw/runtime/gdb_task29_first_disconnect.cmd` 自设 `DoDisconnect` 断点。首连接无 hello，PC `29.410 s` close；多核自动命令无效，但 CPU1 现场保留，清理实际子 GDB PID 后，以 `.claw/runtime/gdb_task29_snapshot.cmd` 完成 snapshot2。日志 `.claw/runtime/gdb-task29-snapshot2.stdout.log` / `.stderr.log`、`.claw/runtime/bare-receiver-task29.out.log` / `.err.log`。

调用链 `tcp_receive -> EspTcp::ReceiveTask:212 -> WebSocket::OnTcpData:446(opcode 0x8) -> WebSocket::Abort:289 -> EspTcp::Disconnect:97 -> DoDisconnect:100`；同期 `wifi_audio_tx` 在 `ulTaskNotifyTake` 空队列等待。本次确认是 PC hello-timeout Close frame，不是 Send failure/Wi-Fi 掉线。不能外推所有已认证 `18 s` 断连，仍需 PC close/end instrumentation。无效多核尝试不计，恢复仍待完成。

#### 2026-08-08 Task 30：PC Close 在前、ECONNRESET 在后

`.claw/runtime/bare_receiver_raw_task23.mjs` 仅做 PC 诊断 monkey patch：记录 socket close code/reason/stack/time 和 TCP end/error/close；`node --check` 通过。`60 s` 日志 `.claw/runtime/bare-receiver-task30.out.log` / `.err.log`。

accepted 后 `11,228 ms`，PC 从 `wifi-audio-receiver.mjs:303` 显式 `close(1008, "hello timeout")`；`20,468 ms` 才出现底层 `ECONNRESET / hadError=true`。close elapsed `19.247 s`，unauthenticated，`frames/raw=0`。DTR/RTS=false 的串口读取为空，无 reboot 证据。本次断开顺序确定为 PC timeout 清理在前，ECONNRESET 在后。

#### 2026-08-08 Task 31：同步 hello 与原子 ready 最终候选

新增合同先红灯。第一版 Connect 后 bootstrap direct send hello、`OnData` 直接 set_ready，达到 `59/59`；复审发现 P1 control/touch 可在 hello 期并发 Send，以及 P2 codec 后断连假 ready、audio task fail 后仍 ready，该中间镜像作废。

第二版加入 `s_dock_ready_generation`；OnData 只存 generation，wifi_tx 未 ready 不消费且 transmit 二次 gate，set_ready true notify，audio/speaker fail-closed，等待同代 ready `10 s`，JSON 逐字段 fail-closed，达到 `60/60`。复审关闭 P1，但发现复核与 set_ready 分离 TOCTOU P2，第二镜像作废。

最终 `commit_ready_for_socket` 在同一 `s_socket_mutex` 内原子检查 expected/current、socket generation、ready generation、`IsConnected` 并 set_ready true；最终 review 无 P0/P1/P2。

最终门禁 firmware `79/79`、Dock `42/42`、`npm check`、diff-check、ESP-IDF `5.5.5` 完整构建。首次 Python `3.11/3.14` 不匹配是环境失败，正确环境后通过。最终 bin `firmware/build-wifi-audio-opus/stack-chan.bin`，Length `3,993,520 / 0x3CEFB0`，partition `0x4F0000`、free `0x121050 / 23%`，SHA-256 `8A39AD6989315CAC2A7E64804672C16468AAE1B596B014671B13C24F9662D8D5`，checksum `33`、validation hash `b3e1c526913a087002479f835fae3774f5a2f1afafa33c231b0c89fa1c384f12` 有效。

Task 31 所有中间镜像身份未固化且已被覆盖，统一作废、禁止刷写。**最终候选尚未刷写或做实机 transport、音质、Codex Voice 验收。**

#### 2026-08-08 Task 32：8A39 app-only 写入

preflight：candidate `3,993,520 / SHA 8A39...D8D5`，rollback `5,177,344 / SHA 5708...C2ED` 与 sidecar 匹配，MI_02 JTAG OK，`8765` free。OpenOCD `20260424`、`10 MHz`，先 `reset halt; sleep 500`；目标 MAC `44:1B:F6:E2:78:A8`、rev `0.2`。

app-only `0x20000` 写入：erase `3,993,600 / 5,256.73 ms`，transfer `35,993.9 ms @ 108.352 KiB/s`，write `36,236.8 ms`，total `44,292 ms`，verify `2,243.54 ms`，`Verify OK`、reset、exit `0`。其他分区未写。

#### 2026-08-08 Task 32：启动门禁与 75 秒 transport 失败

一次 `35` 轮和一次并行基础采样都因 PC 枚举超时无汇总，属于无效观测。有效门禁 ping `10/10`、`9-88 ms`，USB composite/JTAG/COM7 当前正常，基础启动通过。

bare receiver hello `71.617 ms`、claim `72.374 ms / 0.693 ms`。首帧 sinceAuth `4,409.691 ms`，随后约 `125 ms` 突发 seq `1..34`，`decode0/gaps0`；TCP elapsed `4,605.511 ms` end、code `1006`。`5 s` status 失败，transport not open。

之后约每 `12 s` accepted，一律 `0.45-0.57 ms` tcpEnd、无 hello。final `connections6/auth1/frames34/encoded4,925/PCM97,920/decode0/gaps0/raw chunks5/raw bytes6,024`。门禁失败，不试听/Codex。下一步只读研究 `TCP_NODELAY` 实际生效时机和官方 socket 配置，不再刷写。

#### 2026-08-08 Task 33：UDP 协议隔离决策

TCP 路线的重复证据集中在约 `4*MSS / 5,760 bytes` 当前发送预算附近停滞、批量交付或超时重连；无 timeout 候选在长连接中也只有极低帧率，已反证永久阻塞 send。继续微调 timeout、queue 或 Nagle 不再是首版方向。

历史 Candidate D 在同一设备把认证/控制/扬声器保留 WebSocket、麦克风迁到 session-bound UDP，完成 `5,000` 帧零 gap/drop/reconnect，并持续超过 `9,000` 帧零 gap。该证据只验证 transport。官方 Xiaozhi 的 MQTT/UDP 压缩音频路径也支持用独立 UDP 承载当前 `60 ms` Opus 上行。

决策为：WebSocket 保持认证、控制和扬声器；Opus 麦克风走与当前认证会话绑定、可丢包的 UDP，同时实现鉴权和 ready proof。

#### 2026-08-08 Task 34：session-bound Opus UDP 离线过程

当前实现范围包括 Dock 会话绑定 UDP、HMAC、ready proof 和 `1,200 bytes` datagram 上限。Dock 定向 `11/11`，覆盖 `5,000` 帧音频与控制并行；固件合同 `60/60`。

第一次构建命令只产生环境/参数失败，不能得出镜像结论。随后显式使用 `sdkconfig.wifi_audio` 完整构建成功：app `0x3D0270`，partition free `0x11FD90 / 23%`。

**尚未独立 review、固化 SHA、刷写或执行实机 transport/音质/Codex Voice 验收；当前离线结果不是最终候选。**

#### 2026-08-08 Task 34：最终 review 与离线候选身份

独立 reviewer 对当前磁盘版本给出 `P0=0 / P1=0`。实现核对：hostname 在 bootstrap 内通过 `getaddrinfo(AF_INET)` 解析，generation/session 二次复核后才 commit；ready 要求 `protocol == 1`；半双工发送前后双检；wire sequence 只为实际发送包分配；Python/Node 共用 fixture。

唯一 P2 是 fixture 仅 `32` 字符，未覆盖真实 `64` 字符配网 pairing key。fixture 改为 `64` 字符并重新计算（不记录 key 本体）：session key `5f957120...981ec`、proof `cc30a9a4...e4fc`、packet final tag `dc4440...50d2e`。初次 Node `npm test 43/44` 只因旧常量未同步；更新后恢复全绿。

最终 gates：Dock `44/44`、`npm check`、firmware `82/82`、`git diff --check` 通过，包含 `5,000` UDP 帧与控制并发压力。

ESP-IDF `5.5.5` + `sdkconfig.wifi_audio` 完整 build/link/image/partition 成功。镜像 `D:/Users/chany/Documents/StackChan/firmware/build-wifi-audio-opus/stack-chan.bin`，Length `3,999,072 / 0x3D0560`，free `0x11FAA0 / 23%`；SHA-256 `1048475ED0F22FC36DCCEEC235A06ADBB607F9B88B99057C15FCBC0DB2F64153`，checksum `0x74`、validation hash `ebac462f931b78e79e23a69e939b86e08c9cb4ed542a436c95b23b7bb5641fea` 有效；ELF hash `cc11a4ba...a32b`。flash pin 仅更新 length/hash。

rollback `20260808-022602-ota_0-full.bin` Length `5,177,344`，SHA-256 `5708FF4C227270616C552303C63350DACCDABA5BF7DDE5B987F1F88FAE0BC2ED`，与 sidecar 一致。

**尚未刷写或做实机 transport、音质、Codex Voice 验收；该离线候选不得登记为已修复。**

#### 2026-08-08 Task 35：104847 JTAG app-only 写入

preflight 匹配 candidate `3,999,072 / SHA 104847...64153`，rollback `5,177,344 / SHA 5708...BC2ED` 与 sidecar 一致；`8765` free，MI_02 存在。

OpenOCD `20260424`、`10 MHz`，目标 serial/MAC `44:1B:F6:E2:78:A8`、rev `0.2`，先 `reset halt; sleep 500`。只执行 `program_esp stack-chan.bin 0x20000`；existing mismatch 后 erase `4,001,792 bytes / 5,115.37 ms`，transfer `35,929.8 ms @ 108.768 KiB/s`，write `36,189.7 ms`，total `44,117 ms`，verify `2,247.68 ms`，`Verify OK`、reset、exit `0`。

未写 bootloader、partition table、NVS 或 assets。**写入/verify 不是启动、transport、音质或 Codex Voice 通过证据。**

#### 2026-08-08 Task 35：UDP ENOMEM 硬件定案

clean hard reset + allowed Node 24 Dock：hello `96.751 ms`、auth `98.395 ms`，三次 status retry 全超时，UDP `0` 帧。

JTAG 快照显示 bootstrap 已过 DNS/ready commit；`wifi_audio` 在 `i2s_channel_read(1920)`，`wifi_opus` 编码中，`wifi_audio_tx` 正在计算 `SCAU` HMAC，排除 DNS、post-ready I2S 重配和 audio 6 KiB 栈假设。

counters：`ready1 / dockGen5 / socketGen5 / UDP fd55 / dst192.168.0.11:8765 / captured_chunks6431 / captured1071 / encoded1071 / sent0 / send_failures1071 / wire_seq1072 / max_send≈1864us`。`sendto` 硬件断点返回 `-1`，packet `195/199 bytes`、目的正确；从 `wifi_audio_tx` TCB `xTLSBlock._errno` 读取 errno `12 ENOMEM`。

IDF `sockets.c:1689-1693` 与 `LWIP_NETIF_TX_SINGLE_PBUF=1` 确认 `netbuf_alloc` 失败映射 `ERR_MEM/ENOMEM`。新增 Windows UDP 规则因 Access Denied 未发生；改用已有 UDP Public 放行 Node 24 仍失败，排除防火墙。GDB 直接调用 `__errno` 导致 memory protection，是无效调试动作，不计产品失败。

下一单变量只考虑 `CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y` 派生静态 Wi-Fi TX buffer；此节点未实现/构建/刷写。

#### 2026-08-08 Task 36：SPIRAM Wi-Fi/LwIP 单配置离线候选

只在 wifi_audio defaults 与最终 sdkconfig 新增 `CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y`，并增加合同。首次命令因 cwd 找不到 `idf.py` exit `2`，在 reconfigure 前失败，无代码/配置候选结论。使用绝对 IDF tools `idf.py` 后，reconfigure + `2,408` 步完整构建成功。

派生配置 `STATIC_TX_BUFFER=y / TYPE=0 / NUM=16 / CACHE=32`，dynamic TX disabled。firmware `83/83`，Dock `45/45`（含 `5,000` UDP+控制）与 `npm check` 通过。

bin `3,999,264 / 0x3D0620`，free `0x11F9E0 / 23%`；SHA `A2848B8D1FA357A6B252DA422820782531A9D128A314BB67ED105EBF6F5476FE`，checksum `0x46`，validation `fdd0434ead896c8424a84f42036f26200358ca0e1e29d8e9a2bd3ea11cfd5c2a`，ELF `69650EF...936E87F`，flash pin 已更新。

rollback `5,177,344 / SHA 5708FF...E0BC2ED` 与 sidecar 一致。**当前仍在独立 review，未刷写或做实机 transport/音质/Codex Voice 验收。**

#### 2026-08-08 Task 36：A284 写入与 initial Listening `ESP_ERR_NO_MEM`

四重 preflight 通过后执行 JTAG app-only 写入：erase `4,001,792 bytes / 5,116.16 ms`，transfer `36,096.3 ms @ 108.266 KiB/s`，write `36,363 ms`，total `44,279 ms`，verify `2,249.38 ms / Verify OK`，reset、exit `0`。仅改 `0x20000` app 镜像范围，其他分区未触碰。

启动检查中三项无效工具窗口必须排除：联合 shell 在执行前被安全层拒绝；伪 PowerShell 绝对路径失败；系统 Python 因无 `pyserial` 在打开设备前失败。更正此前状态判断：`Test-Connection` 对象数量曾被误读为 ping 成功，现由系统 ping/ARP 证明设备实际未联网，撤销该成功结论。Node 24 Dock 只有 listener、无 TCP；IDF pyserial 两轮只读均为 `0 bytes`。

JTAG 有效快照显示 main/Wi-Fi/lwIP 等任务运行，`wifi_audio_boot` 位于 `wifi_audio_dock_mvp.cpp:1917` 的 initial Listening 失败后 `1 s` retry。codec counters 为 `transition_failures=96 / last_transition_error=257 ESP_ERR_NO_MEM / mode=Idle`，RX/data/input handles 全为 null。A284 主开关直接针对旧 lwIP `ENOMEM`，但派生 `STATIC_TX_BUFFER=16`、约 `25.6 KiB` 的内存占用与新的初始 I2S 内存门禁强相关；因尚未进入 transport，不能宣称旧 UDP ENOMEM 已实机消失，具体底层 operation 与唯一因果均未确认。

GDB `tbreak` 因 internal assert 未返回 operation 字符串，OpenOCD breakpoint timeout 同样无有效现场；不得把具体 stage 写成 `create_rx_channel`。当前只读 review 后继中，不再刷写，尚无 transport、音质或 Codex Voice 验收。

#### 2026-08-08 Task 37：静态 TX buffer `16 -> 6` 离线收敛

独立 review 只保留静态 Wi-Fi TX buffer 数量作为可信单变量。`16 -> 8` 可释放约 `12.8 KiB`；官方 ESP32-S3 memory-saving 配置采用 `6`，所以该轮设置 `CONFIG_ESP_WIFI_STATIC_TX_BUFFER_NUM=6`，而 `CACHE=32`、I2S DMA `6 x 240`、internal reserve `64 KiB` 均不变。

一次在 `firmware` cwd 使用仓库根路径的测试命令触发 `ImportError`，发生在 reconfigure 前，判定为路径/环境错误。正确命令后定向 `64/64`、完整 `2,408` 步构建、firmware `83/83`、Dock `45/45` 与 `npm check` 通过。

候选 bin `3,999,264 / 0x3D0620`，free `0x11F9E0 / 23%`；SHA `A8360AFF5A8181E822B1B2D5AEC19B9D5BA8877DA644DC2143C4A7B6A1B4FB26`，checksum `0x8E`，validation `76e5adb751d5f283f60aa4178849454614b996756c40595936a8f413dd69e5f7`，ELF `E765A558...A46016`；flash pin 已更新。rollback `5708...BC2ED` 与 sidecar 一致。

**当前尚未刷写或验证 initial Listening、UDP transport、音质和 Codex Voice，不得将离线门禁记作实机修复。**

#### 2026-08-08 Task 37：A836 写入与 speaker worker 创建失败边界

preflight 校验 A836 candidate、完整 rollback 与 JTAG 目标后，app-only 写入成功：erase `4,001,792 / 5,120.84 ms`，transfer `36,024.3 ms @ 108.482 KiB/s`，write `36,279.4 ms`，total `44,199 ms`，verify `2,247.78 ms / Verify OK`，reset、exit `0`；其他分区未写。

有效 gate 为 Dock 先监听、设备再 hard reset；system ping 真实 `3/3`。initial Listening 成功越过，hello/auth 约 `6-110 ms`，但连接约每 `2 s` 一次，auth 后 `20-170 ms` code `1006`，音频 `0` 帧。

JTAG 有效快照：`wifi_audio_boot` 在 `wifi_audio_dock_mvp.cpp:2104` 的 `connection_tasks_ready=false` 分支；已有 capture/tx/cmd/opus 四类 worker，无 `wifi_speaker`。源码 `2097` 将 speaker queue 与 speaker task 创建合并，因此只能确认失败发生于这两个创建步骤之一，不能再细分。

20 秒 serial 为 `0 bytes`；Abort/stack/restart/line 等 GDB/OpenOCD 断点未命中、超时或 remote 异常，全部标为无效/扰动取证。attach 所见历史 reset cause `3` 不足以证明当前循环整机 reboot。当前仅做 speaker queue/task stack 迁 PSRAM 的只读 review，不再刷写；transport、音质、Codex Voice 仍未验收。

#### 2026-08-08 Task 38：speaker queue/task WithCaps 离线实现

先加入 speaker queue/task PSRAM WithCaps 合同，定向红灯确认旧实现仍为普通 API；随后两处分配改用 WithCaps，并明确外部 RAM 在 cache-disabled 时不可访问、释放必须使用配套专用删除 API。

首次全量 firmware `83` 项仅 `1` 项失败，原因是旧 speaker downlink 合同仍绑定普通 `xQueueCreate`。只更新该陈旧断言后，firmware `83/83`、Dock `45/45`（含 `5,000` 帧并发）及 `npm check` 全绿。

独立源码 review 为 `P0=0 / P1=0`，其中旧测试 P1 已由全量门禁关闭。**当前还没有完整 IDF 构建、镜像哈希、刷写或实机证据；WithCaps 源码与合同闭合不等于 speaker worker/transport 已通过。**

后续第一次 `ninja` 因 PATH 缺 ccache，在源码编译前失败；补入同一 IDF 自带 ccache 路径后原样构建 `9/9` 成功，bootloader free `0x2330`。

最终 app `3,999,216 / 0x3D05F0`，partition `0x4F0000`，free `0x11FA10 / 23%`。BIN SHA `A7CF1745519919F67B4AC04BD1F5E053FDF3C48E935C45F49261C87DD1B6EF52`，checksum `0x37` valid，validation `ffae3062cda9ae4ac7c235cb9df92eecfc3685fa3caee9c5513d9446a2b0e383` valid；ELF SHA `7A3EBFCC166DA2C9D360428E65B4343039918B3EF6A07A16F468C501E8D26DA5`。flash pin 只更新 length/hash。

**候选身份已固化，但尚未刷写或做 speaker worker、transport、音质、Codex Voice 实机验收。**

#### 2026-08-08 Task 39：A7CF 受保护 JTAG app-only 写入

preflight：candidate `3,999,216 / SHA A7CF...EF52`；rollback `5,177,344 / SHA 5708...BC2ED` 与 `.sha256.txt` 一致；USB JTAG/serial debug unit 唯一且正常；`8765`、Dock、OpenOCD、GDB 均无占用。

OpenOCD `10 MHz` 识别 serial/MAC `44:1B:F6:E2:78:A8`、rev `0.2`。仅写 app `0x20000`：erase `4,001,792 / 5,125.94 ms`，transfer `36,168.3 ms @ 108.05 KiB/s`，write `36,445.5 ms`，total `44,366 ms`，verify `2,249.16 ms / Verify OK`，reset、exit `0`。日志 `.claw/runtime/task38-flash.log`。

未写 bootloader、partition table、NVS、assets。**写入与 verify 不等于 transport、音质或 Codex Voice 已通过。**

#### 2026-08-08 Task 39：麦克风 transport 通过、控制面超时

Dock PID `31348` 接受 `192.168.0.8`：accepted `0.031 ms`、hello `76.822 ms`、claim `78.716 ms / 0.805 ms`。认证后单 TCP 持续；收到 PCM `5,001` 帧，encoded `732,614 bytes`、PCM `14,402,880 bytes`，`decodeErrors/gaps/duplicates/outOfOrder/invalid=0`，VB-CABLE underflows `0`，ping `2/2`。

前版 speaker 创建后的 `20-170 ms` code `1006` / 约 `2 s` 重连循环已消失，麦克风数据面 transport 通过。但连接初期 request `3` 与 `5,000` 帧后 request `4` 均 `1,500 ms` 超时，控制面失败，所以完整门禁未通过，不试听、不进入 Codex Voice。

结束时精确停止 PID `31348`，确认 `8765` 释放。日志 `.claw/runtime/task39-dock.stdout.log`、`.claw/runtime/task39-dock.stderr.log`。

#### 2026-08-08 Task 40：PC parser `1024` 上限根因与修复

首次因终端未继承密钥而在连接前退出，标无效；随后仅从 Windows DPAPI 加载且未打印/记录密钥。`.claw/runtime/task40-parser-limit-confirm.log`：hello `14.361 ms`、claim `15.120/0.657 ms`，明确 `frame exceeds 1024 bytes`，request `1` 在 `1,509.043 ms` 超时，同期 `92` mic 帧 clean。结合 JTAG 的真实 status `1,172 bytes`、enqueue 成功、`WebSocket::Send=true`，确认 PC shared parser `1024` 与 Wi-Fi control `1500` 不一致，不是设备发送失败。

红测覆盖默认 `1024/1025`、Wi-Fi `1172/1500/1501` 及 UTF-8 边界。实现只为 `parseFrame` 增加校验后的可选上限，且仅 Wi-Fi receive 传 `1500`；USB/CDC 与 encodeRequest 默认 `1024` 不变。定向 `2/2`、Dock `46/46`、npm check 通过。硬件 `.claw/runtime/task40-control-fixed-hardware.log` 中三次 status 为 `38.976/28.711/82.970 ms`，`81` mic 帧 clean，各类 failures/drops 为 `0`。独立 review `P0/P1/P2=0`；`mic stack_free_words=256` 仅是后继生产风险。本轮无固件刷写。

#### 2026-08-08 Task 41：半双工 speaker 失败与 TCP 任务恢复边界

R1 `.claw/runtime/task41-half-duplex-gate.log` 因脚本错误断言精简响应的 `speaker_active` 而在发送前退出，speaker `0` 帧，属无效测试。R2 `.claw/runtime/task41-half-duplex-gate-r2.log` 发送真实 `24 kHz mono s16` `501,576 bytes / 1,045` 帧；初始 mic clean，播放期 mic `12 -> 12`，半双工阻断成立；但设备 `received1045 / played1013 / drops32 / gaps32 / underruns7 / silence119`，speaker transport 失败。

false 请求返回 Speaking 不代表恢复失败：实际由队列空和 `400 ms` grace 后切回 Listening。`.claw/runtime/task41-post-failure-status.log` 只证明 ping `4/4`、TCP 可建但 `10 s` 无 hello，不可称崩溃或已恢复。

`.claw/runtime/task41-live-gdb.log` 显示 boot 卡于 `Connect -> Disconnect -> DoDisconnect(portMAX)`，无 `tcp_receive`；speaker 已非 Speaking、capture 在 Listening，排除 codec/speaker 锁死。源码忽略接收任务创建返回且 null handle 仍永久等，任务创建失败为最高可信近闭环，具体 ENOMEM 未确认。两轮单核对象 GDB 无效；`.claw/runtime/task41-recovery-reset-run.log` 无刷写 reset run 后 ping `4/4`。

#### 2026-08-08 Task 42/43：生命周期与 speaker generation 最终离线候选

首轮 review `P0/P1=0`，新增 P2 为阻塞 speaker sender 可在 reset 后重塞旧帧且 drop 误计。红灯后加入 frame/pipeline generation、reset 前失效、所有 producer 成功路径 post-check、consumer purge/取帧/OutputData 前复核，drop 只在 dequeue 成功计数，定向 `2/2`。

firmware `85/85`、Dock `46/46`、npm check、gate check 与四 patch reverse-check 通过；首次完整 IDF build `115.8 s`，app `0x3D08E0/free0x11F720`。后续发现 plain-tcp patch 遗漏 `esp_tcp.h` override header P1，补红灯与三项 hunk 后转绿。独立 lifecycle patch/CMake 顺序是旧快照，最终已折叠进 plain patch。

clean replay 前两次仅路径脚本错误；第三次全逆序/正序成功，CRLF/LF 归一化后五文件一致，`CLEAN_PATCH_REPLAY_OK`。最终 review `P0/P1/P2=0`，firmware `85/85`，增量完整构建 `50.2 s / exit0`。bin `3,999,968 / 0x3D08E0 / SHA 73A2DEBC4B1AEF05FC6C22E6C06FE1E076D65F73AA4FDB373790E238CBB5C0E2`，checksum `0x25`、validation `6d4e...e5a5`，ELF `70,729,640 / SHA 4E4179...72E5`，free `0x11F720`，pin 已更新；该时点未写入。

#### 2026-08-08 Task 44：写入、空闲启动与联合 gate 超时

清理孤儿诊断 GDB PID `20140` 后完成 candidate/rollback/USB/JTAG/端口进程 preflight。配置 `.claw/runtime/openocd_task44_flash.cfg`，日志 `.claw/runtime/task44-flash.log`；`10 MHz` app-only 写 `0x20000`，sector `4,001,792`，erase `5,121.1 ms`、transfer `36,399.1 ms @107.365 KiB/s`、write `36,670.6 ms`、total `44,585 ms`、verify `2,252.34 ms / Verify OK`、reset、exit `0`。8 秒空闲 gate USB 三接口正常、ping `10/10`。

`.claw/runtime/task44-half-duplex-gate.log`：accepted `0.030 ms`、hello `14.878 ms`、claim `15.788 ms`，初始 `11` mic 帧 clean；`360 s` 未到 `5,000` 帧而失败，speaker 阶段未执行，设备未重启。之后 ping `5/5`、USB 正常。

#### 2026-08-08 Task 45：5 秒状态诊断

`.claw/runtime/task45-post-gate-diagnostic.log`：累计 `read_success36084/read_failures0/captured6013/encoded6012/sent4982/send_failures1030`，queue/encode failures/drops `0`。新连接 `5 s` 收 `85` clean 帧，设备增至 `captured6097/encoded6096/sent5066`，`send_failures` 仍 `1030`，status 成功、设备在线。

因此长 gate 失败是间歇性设备 UDP 发送失败，不是 I2S、Opus、PC 解码或整机崩溃；本轮 errno 未确认。speaker 与 Codex Voice 均未验收，当前候选不可交付，不刷新版本。

#### 2026-08-08 Task 46：`ENOMEM` 两次有限重试候选

当前失败点确认在编码后的 UDP `sendto`，本轮 errno 未复现抓取；历史同路径曾确认 errno `12 ENOMEM`。实现只对 ENOMEM 将同一 packet/sequence/tag 最多额外发送 `2` 次、间隔 `1 tick`，每次前复核 session/socket/pipeline/ready/mic/speaking；其他错误不套用。

新增 `send_retries/retry_exhausted/last_send_error`。红灯合同后，review 指出的 retry 虚计数 P2 已修正，最终 review `P0/P1/P2=0`。

门禁 firmware `86/86`、Dock `46/46`、npm check、专用 ninja 完整链接 exit `0`。BIN `4,000,480 / 0x3D0AE0`，free `0x11F520`，SHA `9F07EE...FEC17`，checksum `0xD5`，validation `ba9b...c3f8`；ELF `70,733,156 / SHA E2D9...3C50`。

**尚未刷写或实机验证 UDP 重试、speaker、音质、Codex Voice；不得登记为修复通过。**

#### 2026-08-08 Task 47：9F07 JTAG app-only 写入与 idle gate

preflight：USB 三接口含 MI_02/`COM7`，MAC `44:1B:F6:E2:78:A8`，ping `3/3`，`8765` free；rollback `5,177,344 / SHA 5708...BC2ED` 与 sidecar 一致；candidate `4,000,480 / SHA 9F07...FEC17`。

OpenOCD `20260424 / 10 MHz`、rev `0.2`、reset halt；仅写 `0x20000` app，sector `4,001,792`，erase `5,131.68 ms`、transfer `36,238.6 ms @107.841 KiB/s`、write `36,484.7 ms`、total `44,419 ms`、verify `2,249.63 ms / Verify OK`、reset、exit `0`。其他分区未写。

启动后 USB 三接口正常，ping `10/10`（max `72 ms`），`8765` free。无独立 raw log 文件，本节数据来自本轮工具输出。**仅 idle gate 通过，transport、speaker、音质、Codex Voice 均未验收。**

#### 2026-08-08 Task 48：自动化联合实机门禁通过

本轮无独立 raw log，以下均来自工具输出。accept `0.030 ms`、hello `21.115 ms`、claim `22.172 ms`，单 TCP 持续 `312.341 s`。

Mic：device `captured/encoded/sent=5000/5000/5000`，`read30002/fail0`，`send_failures0/retries0/exhausted0/last_errno0`，queue/encode failures/drops 全 `0`；host `5000` frame/UDP，decode/gap/dup/OOO/invalid/reconnect 全 `0`。

Speaker：真实 speech WAV `501,576 PCM bytes / peak30703 / rms2011`；`1045 requested/received/played`，drop/gap `0`，binary max `0.8086 ms`、slow `0`。播放期间 mic `5001 -> 5001`，半双工阻断成立；`silence35/underrun4`，有效语音帧全播放。

最终恢复 Listening，mic `5015`、speaker inactive、transition/read failures `0`、connection `1/reconnect0`；TX/Opus core `0`，mic/speaker core `1`。**自动化 transport/半双工门禁通过，但未做用户听感或 Codex Voice；重试计数为零，只证明防护无回归，不证明 ENOMEM 实机触发恢复。**

#### 2026-08-08 Task 49：Codex Voice 验收准备

正式 Dock PID `14396` 监听 `8765` 且设备 TCP 已连接；VB-CABLE player PID `8608`。Codex root ChatGPT PID `34536`；process-loopback bridge PID `15784` 捕获该 root 并输出到 StackChan speaker pipe。

**进程拓扑和连接已就绪，但用户尚未启动或完成 Codex Voice 对话，本节点不能记为验收通过。**

#### 2026-08-08 Task 50：人工音质/Codex 最终失败，拒绝 9F07

用户文件 `D:/Users/chany/Documents/录音/录音 (3).m4a`，反馈“仍不清晰、机器人音 + 电流音”，并确认与昨晚版本表现相同、Codex 无响应、录音不通过。源文件 `179,798 bytes / 7.00 s / AAC 48 kHz stereo`。

分析产物 `.claw/runtime/task50-recording-3-48k-stereo.wav`、`.claw/runtime/task50-recording-3-analysis`。ch0 `RMS1057 / peak11337 / speech300-3400=89.756% / low0-80=0.612% / mains=2.166% / digital silence=0`；decode 链同期有大峰值，但 Codex 行为门禁失败。

相较 recording2，TDM/低频污染明显改善；但可懂度和 Codex 才是最终门禁，因此 9F07 正式拒绝。transport/频带指标不能替代人工可懂度。

后继只进入清晰 golden `24 kHz PCM -> lossless 20 ms / 960 bytes UDP` 的离线逐样本等价研究；尚未实现、构建或刷写。

#### 2026-08-08 Task 51：PCM 逐字节合同红灯

新增 Dock golden 逐字节 PCM 合同，因缺少 `WIFI_AUDIO_MICROPHONE_PCM_BYTES` 导出而预期失败。固件全量 `68` 项中只有新 PCM 合同失败，旧 `67` 项通过，属于新路线红灯而非回归。

独立研究建议 `20 ms / 960 bytes` PCM；唯一 P1 是静态 TX buffer `6` 条件下 `50 packets/s` 的网络余量。**尚未改产品、构建、刷写或实机验证。**

#### 2026-08-08 Task 52：RX4 slot0 lossless PCM 离线绿灯

实现改为 RX4 slot 0 原生 `24 kHz s16le`，两个 `10 ms` 聚合为 `20 ms / 960 bytes`、flag `2`，含 session HMAC 的 UDP packet 为 `1,012 bytes`。删除 24->16 重采样、Opus encode/decode、24 KiB task 与中间 PCM queue。

golden 从 RX4 interleaved 抽取 slot 0、聚合并通过 Dock 真实 parser，包含显式尾 `10 ms`；所有完整样本逐字节相等。

首轮独立 review `P1=1/P2=3`，修复后二审 `P0/P1/P2=0`。firmware `68/68`、Dock `47/47`、check、Task41 syntax、完整 IDF build 通过；app `0x3A8E10`、free `0x1471F0`。

**尚未固化 hash、刷写或做实机 transport、用户听感与 Codex Voice 验收。**

#### 2026-08-08 Task 53：FF74 PCM 写入与 ENOMEM burst

候选 BIN `3,837,456 / 0x3A8E10 / SHA FF74...DA45C`，checksum `0x2B`、validation `c303...2c94`，ELF `58D5...43B2`，flash pin 已更新。

preflight 确认 rollback `5708...BC2ED` 一致、MI_02 唯一并停旧 Dock。首个 OpenOCD 命令只因日志反斜杠解析失败，未连接/未写。第二次 `10 MHz` app-only `0x20000`，sector `3,837,952`，`Verify OK`、reset、exit `0`；日志 `.claw/runtime/task53-pcm-flash.log`。启动 USB 三接口、ping `10/10`。

约 `113 s` 自动 gate：host 收到 `5,000` 连续 PCM 包；device `captured5534/sent5017/failures517/retries1255/exhausted517/errno12/queue0/I2S0`，所以 transport 失败且不可交付，不试听。随后 `5 s / 259` 帧诊断中计数不增长，定位为间歇性 ENOMEM burst。日志 `.claw/runtime/task53-pcm-half-duplex-gate.log`、`.claw/runtime/task53-pcm-post-gate.log`。

**用户听感与 Codex Voice 尚未验收。**

#### 2026-08-08 Task 54：FF74 PCM 人工音质失败

用户重启并确认可录后，经实际 VB-CABLE 录制 `10 s`：`.claw/runtime/task54-pcm-user-listen-48k.wav`，`48 kHz mono s16`、`960,044 bytes`，peak 约 `2,162`、RMS `235`、无 clipping、digital silence 约 `0.2%`。另生成仅 `+18 dB`、无降噪的试听副本。

用户试听原始与仅 `+18 dB` 版本后确认二者都是机器人声、不是正常录音。人工音质失败，FF74 正式拒绝，不得写成 PCM 音质通过。

Task54 当时暂把 UDP 丢帧当作独立问题并暂停 `TX6 -> 8`，先反推 pre-VB 24 kHz。该阶段判断后由 Task57 A/B 和 gaps 时间线修正：Task55 主因最终确认为严重 UDP gaps。

#### 2026-08-08 Task 55：pre-VB 24 kHz 直接捕获准备

FF74 继续因 Task54 两版均为机器人声而拒绝。静态对照未发现名义 gain/slot/clock/packing 差异；P1 缺口为 pre-VB 原始 `24 kHz`。

停止旧 Dock `20884` / player `23012`，启动取证 Dock `24144` / player `13716`，与 `192.168.0.8` TCP Established。`STACKCHAN_WIFI_PCM_CAPTURE` 输出 `.claw/runtime/task55-direct-player-input-24k.pcm`，日志目录 `.claw/runtime/task55-dock-logs`；文件持续增长，首帧/第500帧 `input_peak=150/293`。

**当前只是环境音基线和取证准备；尚无人声、未分析、未刷写、未改产品代码。JTAG 只作为 direct 数据仍坏时的后继。**

用户说完后立即停止 Dock `24144` / player `13716`。pre-VB `.claw/runtime/task55-direct-player-input-24k.pcm` 为 `1,310,400 bytes / 27.3 s`；首/500/1000/1500/2000/2500 帧 peak `150/293/371/245/244/2231`，underflows `0`。

`0.1 s` RMS 定位语音主要在 `22.8-24.5 s`。截取 `22.5-25.5 s`：raw `.claw/runtime/task55-listen/task55-direct-pre-vb-24k-raw.wav`（`24k mono s16 / 3s / peak2231 / RMS147.61 / clip0`）；仅 x8/+18.06dB `.claw/runtime/task55-listen/task55-direct-pre-vb-24k-gain18db.wav`（`peak17848 / RMS1180.90 / clip0`）。

两者均绕过 VB，无重采样/降噪。用户试听 raw 与 x8 后反馈“无法听清”，Task55 当轮音质失败。

Task57 后续清晰 MIC1 A/B 推翻固定 I2S/错麦推断。Task55 stdout 为 frame1 gaps0、frame501 gaps2508、frame1001 gaps8023；说话约5-10s但落盘活动仅约1.5s，符合严重 UDP gaps/时间压缩。因此主因收敛为间歇性丢帧，固定 I2S 失真结论作废。

#### 2026-08-08 Task 56：raw4 slot 与麦克风通道只读取证

历史“错麦”精确为 raw index1 取到 ES7210 slot1/MIC3/AEC，却被误认为 MIC2；不是 slot0/MIC1。当前 `CONFIG_STACKCHAN_WIFI_AUDIO_CAPTURE_MIC=0`，映射 `0->slot0 / 1->slot2`，且 JTAG mono 逐样本等于 raw slot0，所以未重复同一错误。历史 golden 的 slot0 MIC1、slot2 MIC2 均有信号，但用户纠正 golden WAV 是敲击声，相关“人声刺激”轮次无效，不能用于通道结论。

有效 JTAG reset-halt + hardware breakpoint 在 `wifi_audio_dock_mvp.cpp:1698` 保存 `.claw/runtime/task56-raw4-one-frame.pcm`：raw4 `1920B`、slot0 mono `480B`，slot0 与 mono 逐样本一致，排除抽取/UDP前 copy 错误。状态 `24k/ch4/gain30/Listening/read_success1/fail0`。环境帧 slot0/1/2/3 peak 约 `136/28/104/14`，后续单帧也为 slot0/2 同量级、slot1/3 低。

受控 TTS `.claw/runtime/task56-reference-human-voice.wav` 为 Microsoft Huihui、`22.05k mono s16 / 49.655s`、固定句子。多帧 JTAG 因 FreeRTOS/GDB `thread exited` 仅存 `1` 帧，不得记为50帧；单帧 slot0/2 peak `141/146`、RMS `63.4/68.0`，仅弱证据。GDB 读 ES7210 寄存器因线程/内部错误无有效值，属于无效取证。

**无刷写、无产品代码改动；脚本/日志保留。仅确认 slot0 copy 正确，真实人声通道仍未定。**

#### 2026-08-08 Task 57：固定人声首次 Listening A

标准源 `.claw/runtime/task56-reference-human-voice.wav`：Microsoft Huihui Desktop、固定中文句 x5、`22050 Hz mono s16 / 49.6553 s / 2,189,846 bytes`，SHA-256 `E9701CC18A6E3D1A9B384A291F311153FCA4ABCF8B473515ACA3D73B728A4FD0`。

不刷固件；Dock `29184` / player `3240`，direct capture `.claw/runtime/task57-generated-voice-initial-listening-24k.pcm`。JTAG 后 reset-halt-resume，ping `2/2`、TCP Established。首次 Listening 且不进入 Speaking，播放 `15.865 s`；窗口 bytes `3276000..4062240`（`68.25..84.63 s`），`786240 bytes / 16.38 s`，日志 5000/5500/6000 等帧有响应，peak `1862`、RMS `136.56`、clip `0`。

试听 `.claw/runtime/task57-analysis/task57-initial-listening-generated-voice-capture-24k.wav` 与仅 x4/+12.04dB 版。JSON `.claw/runtime/task57-analysis/waveform/waveform-analysis.json`：`adjacent_equal2.0676%/silence0/speech80.119%/low2.251%/mains1.937%/flatness0.02278/highbyte16`。

用户试听 pre-VB MIC1 `+12.04dB` 后确认可以听清，并认为波形明显为高质量，首次 Listening A 人工通过。质量 JSON `.claw/runtime/task57-quality-comparison/waveform-analysis.json`：Task55 `speech32.5/low10.221/mains7.929/flat0.03225`，Task57 A `speech80.119/low2.251/mains1.937/flat0.02278`；内容/距离不同，不作为绝对阈值。

speaker pipe gain4 播放 `.claw/runtime/task57-analysis/task57-transition-speaker-voice-3s.wav`，device `received/played300`、drops/gaps/underruns0，完成 Speaking->Listening。B 窗口 `54119520..54905760 bytes / 1127.49..1143.87s`。

A/B JSON `.claw/runtime/task57-ab-comparison/waveform-analysis.json`：RMS `136.56/136.15`、speech `80.119/81.006`、low `2.251/2.289`、mains `1.937/1.909`、adj `2.068/2.198`、silence均0、flat `0.02278/0.02227`，客观等价，排除一次 mode transition 固定退化。

Task57 到 frame55001 仅 gaps2，说明 burst 间歇。结论：不是错麦/固定I2S失真，Task55主因是严重UDP gaps。该节点恢复 `TX6->8` 单变量，当时尚未实现/构建/刷写；后续见 Task58。

#### 2026-08-09 Task 58：固定 TTS 音质通过与 TX8 离线构建

用户正式确认 Task57 第二份 `+12dB` pre-VB MIC1 固定 TTS 可听清，且波形判断一致，固定 TTS 音质门禁 PASS。Task55 由 gaps `0->2508->8023` 与 `5-10s` 讲话仅约 `1.5s` 活动闭环为严重丢帧/时间压缩。

单变量仅 `CONFIG_ESP_WIFI_STATIC_TX_BUFFER_NUM=6->8`，同步 defaults/live sdkconfig 与合同；音频/TDM/PCM/半双工/Dock 不变。firmware unittest `87/87`；IDF `5.5.5` 完整 `2408` 步 build 成功，build sdkconfig 确认 TX8。

bin `3,837,472 / 0x3A8E20`，free `0x1471E0`；SHA `13AD1C62513A0931F3BF5F56FA211C5CA72F1BAC885A5ACF2B17AC72D7DC5F7E`，checksum `0x85` valid，validation `6b78e0a022de968651e9e7b913ad55d2d126ca2fe8dac35165e7cd28191fbfcd`；ELF SHA `7089C3070A85BD8DE83BFBDA35D2EA968FC852A0ECF08D62659CA0F0815E2C33`，flash pin 已更新。

**独立 review 已完成；仍未刷写、未做实机连续性、用户真人或 Codex Voice 验收，不能记丢帧已修复。**

独立只读 review 对已证缺陷为 `P0=0 / P1=0`。TX8 internal/DMA 余量只是待实机门禁，不是 P1。IDF `5.5.5` Kconfig 表明每个 static TX buffer 约 `1.6 KiB`，TX `6->8` 增加约 `3.2 KiB` 常驻 DMA/internal。历史 TX16 触发 initial Listening `ESP_ERR_NO_MEM`；TX8 比16少约 `12.8 KiB`，但离线不能证明 I2S/worker 重建余量。

配置锚点 `defaults:7 / sdkconfig:2061 / generated sdkconfig.h:830-833` 均为 `static/type0/8/cache32`；音频未动，RX-only TDM4x16、capture0->slot0 MIC1、20ms/960B PCM 保持。

对象时间序无陈旧混用：`sdkconfig.h 23:54:21 -> cores3 obj 23:56:46 -> wifi_audio obj 23:57:05 -> libmain 23:57:12 -> ELF/bin 23:57:58/59`。

允许一次实机候选，但先验 initial Listening 和 Speaking<->Listening 的 `transition_failures0/last_error0`，再判 UDP failure/gap。回滚 `20260808-022602-ota_0-full.bin` 重新回读为 `5,177,344 / SHA5708...C2ED`，与 sidecar 一致。

#### 2026-08-09 Task 59：13AD TX8 JTAG app-only 写入

candidate `3,837,472 / SHA13AD...C5F7E`；rollback `5,177,344 / SHA5708...C2ED` 与 sidecar 回读一致。MI_02 serial/MAC `44:1B:F6:E2:78:A8`、rev `0.2`，`10 MHz`。

唯一 `program_esp @0x20000`：existing mismatch 后 erase `3,837,952 B / 5.0055 s`，transfer `34.6495 s`，write `34.9137 s`，program `42.615 s`，verify `2.15884 s / Verify OK`，reset、exit `0`。初始 reset halt 曾 timeout/cache error，但 program_esp 内部重试后完整成功，不是写入失败。其他分区未写。

**当前只有写入证据；启动、内存、transport、音质、Codex Voice 尚未验收。**

#### 2026-08-09 Task 60：TX8 transport/半双工自动门禁

写后 ping `10/10`（`9-68 ms`），USB composite/JTAG/COM7 正常。旧 Task57 Dock 自动回连后，精确停止 PID `29184` 与 child `3240`，启动 fresh Dock `26236`。

hello `12.645 ms`、auth 约 `14 ms`；初始 Listening，`transition_failures0/last_error0`，send failures/retries/exhausted `0`。host `5003` 帧且 gaps/dup/OOO/invalid/reconnect `0`；device `captured12363/sent12363/queue_drops0/send_failures0/retries0/exhausted0/last_error0`；VB underflows `0`。

真实语音 `.claw/runtime/task57-analysis/task57-transition-speaker-voice-3s.wav` `300` 帧：pipe `300/300`，device `received300/played299/underruns0/sequence_gaps0`；播放后 mic 恢复，host 累计约 `7501` 仍 gaps0。自动 transport 与单次半双工门禁通过。

一次 TX8 TTS capture 误用无 numpy 的 IDF Python，生成0字节文件且已删除，属工具失败；没有新TX8试听文件。随后 Codex MCP Dock PID `31556` 自动占用8765并连接，但未进行 Voice 对话。

**间歇 burst 仅本窗口未复现；真人、新TX8人耳与Codex Voice仍未验收。**

#### 2026-08-09 产品目标修订与 Task 61 独立 verify

用户定义的产品完成目标改为：机器人经 Wi-Fi 作为 Codex Voice 麦克风和扬声器；PC 经 Dock/MCP 控制表情与动作；日常使用不依赖 USB。Opus/固定帧数不再是产品目标，PCM 与 counters 只是实现和内部 gate。

OpenOCD `verify_image` 首次返回 `not implemented`；未写并 resume。第二次 `flash verify_bank` 因 flash map/algorithm stop 读到伪0而失败，也未写并恢复；两者均不能说明镜像 mismatch。

官方 esptool `4.12.0` 经 COM7 识别 ESP32-S3 rev0.2/MAC `44:1b:f6:e2:78:a8`，只读 `verify_flash 0x20000 + 0x3A8E20 (3,837,472)`，与13AD镜像 digest matched、verify OK，hard reset、exit0。

复位后 ping `10/10`、USB三接口OK、MCP Dock `31556` 重新 Established。**Task61只关闭flash安全基线；Codex Voice、PC表情动作控制、拔USB仍待产品验收。**

#### 2026-08-09 Task 62：产品音频技术链证据

13AD/TX8 + MCP Dock 经 `PC显示器扬声器 -> 机器人MIC1 -> WiFi PCM -> Dock -> VB-CABLE` 录固定TTS。raw `.claw/runtime/task62-tx8-vb-generated-voice.wav`：`20s/48k mono s16/1,920,044 bytes/SHA1F44...E4FCE`；仅+12dB副本 `task62-tx8-vb-generated-voice-gain12db.wav`：同长度、SHA `5F13...49D30`、`960000` samples、clipped0。

raw 指标 `peak1972.32/RMS103.89/speech74.82%/low1.40%/mains2.34%/silence0/clipping0`；JSON/plot 在 `.claw/runtime/task62-tx8-analysis/`。

结合 Task60 speaker `300/300`、device played299、underrun/gap0、播放后mic恢复至约7501且gaps0，WiFi麦克风+喇叭技术链已打通。

用户后续试听 Task62 并判失败，故人工音质 FAIL。Task57 为 pre-VB 24k，Task62 为 post-VB 48k，不能直接等同；技术链连通不等于音质通过。Codex Voice、MCP表情、拔USB仍待。

#### 2026-08-09 Task 63：PC/MCP/Wi-Fi 表情命令链

停止旧 MCP `31556` / parent `23696` / player `34188`，以真实 MCP stdio client 启动同一 Dock。get_status 为 `connected=true/transport=wifi/device=stackchan-441BF6E278A8/phase=listening`；`stackchan_set_expression({happy})` 返回 `{expression:happy}`，再次 status 仍 connected/listening，probe 正常 close。

命令链 PC->MCP->Dock->WiFi->机器人已通过；**用户未现场确认视觉表情，故视觉效果尚未验收。**

#### 2026-08-09 Task 64：Wi-Fi 输入输出连续性 FAIL

标准 Dock PID `9976` fresh hello `10.177 ms`、auth `11.585 ms`。初始累计 device `captured27391/sent24863/send_failures2528/retry_exhausted2528/last_errno12 ENOMEM/queueDrops0`。fresh host gaps：frame501=`4`、1001=`4`、1501=`4`、2001=`22`，输入长期稳定性 FAIL；Task62 后续人工 FAIL，旧“清晰样本仍有效”措辞作废。

speaker 请求300帧，pipe `sent271/dropped29/maxPending12`；device `received=played271/underrun0/queueDrops0/seqGap0/backpressure206`，PC max latency `323.507 ms`。播放后mic恢复但gaps22，输出连续性也不得写PASS；用户听感待确认，客观验收FAIL。

日志 `C:/Users/chany/AppData/Local/StackChan/logs/wifi-audio-dock-20260809-004431.stdout.log` 及 stderr。**无代码/固件改动、无刷写，不继续Codex Voice。**

只读守恒：mic `27391-24863=2528=send_failures=retry_exhausted`，I2S/read/应用queue均0；损失发生于同包连续3次 `sendto ENOMEM`。errno12 尚不能区分 lwIP netbuf/pbuf 与 WiFi driver TX pool，后者仅高可信。

speaker `300-271=29=PC pipe dropped29`；device received=played271 且 queueDrop/gap/underrun0，故29帧丢在PC 12帧drop-oldest。WS stall `323.507ms > 120ms`，device backpressure206。

最高信息的无刷 JTAG 分流断点：`sockets.c:1691/1692`、`udp.c:774/778`、`wlanif.c:114/115`，在首个 ENOMEM 区分三层路径。**本轮无代码/构建/刷写，根因未最终确认。**

#### 2026-08-09 Task 65：TX8 pre-VB 样本与缺帧闭环

用户说明不要求绝对零丢帧，并判 Task62 试听 FAIL；Task57 是 pre-VB24k，Task62 是 post-VB48k，不可直接等同。

fresh Dock `2732`，capture `.claw/runtime/task65-current-tx8-pre-vb-24k.pcm`。20s同步窗 offset `131040..393120`，仅 `262080B=5.46s` 音频，即约 `72.7%` 墙钟缺失；host frame501 gaps3147。

提取 `task65-current-window-pre-vb-24k.wav` 与 +12dB。raw `peak2251/RMS137.89/clip0/speech81.37%/low3.20%/mains2.09%/flat0.02434`，保留样本本体接近Task57，但严重缺帧造成时间压缩/机器人声。

音频硬件/选麦未回退；Task57为clean窗口，ENOMEM burst未根治，TX6->8只降低未消除。Task62人工FAIL，旧清晰措辞作废。**无代码/构建/刷写。**

#### 2026-08-09 Task 66：JTAG ENOMEM 分流无效与复位恢复

`wlanif.c:114` 因优化无独立机器码，首次 no-flash 探针无效。随后按 ELF map 在 `0x420e4caf` 条件 `a2==0x101`，只产生大量双核 halt/switch，未出现 `TASK66_WLANIF_ENOMEM_HIT`；意外捕获独立已知 `headtouch` task stack overflow / panic_abort。本轮不能归因 ENOMEM。

停 OpenOCD 后 ping 不可达；用既有 reset-run 仅软件复位、无flash，恢复 ping5/5、USB三接口、Dock认证。首次 status `captured23/sent23/failures0/retries0/errno0`，证明复位清除先前持续 ENOMEM 状态。

仅重启PC Dock仍严重缺帧，因此设备侧随运行/连接累积的资源耗尽或泄漏为高可信方向，但具体层未知。日志 `.claw/runtime/task66-gdb-wlanif-enomem.log`、`task66-openocd.stderr.log`、`task66-recovery-reset-run.log`。**无代码/构建/刷写。**

#### 2026-08-09 Task 67：半双工 transition 单变量反证

无刷写，复位后按正确 setTalking 流程。初始 device `captured8638/sent8595/failures43/retries126/exhausted43/errno12`；speaker 前 host `500` 帧 gaps0，failures仍43。

真实语音 requested300，device `received300/played300/queueDrops0/backpressureWaits0/sequenceGaps0`；silence `63->114`、underruns3另列。speaker 后再收500帧 gaps0，final `captured9649/sent9606/failures43`。

本轮 transition 未新增 ENOMEM，否证每次speaker切换必触发；故障间歇/状态相关。脚本 `.claw/runtime/task67_speaker_enomem_repro.mjs`，日志 `.claw/runtime/task67-speaker-enomem-repro.log`。**无产品改动/构建/刷写，版本不可交付。**

#### 2026-08-09 Task 68：PC 切网实验作废与网络操作边界

此前 PC 切网尝试在约 `8 s` 后仍显示连接原有软路由 Wi-Fi，说明切换未成功。该轮标记为**无效实验**，不得用于支持任何网络或音频技术结论。

用户明确指出，切换 PC 网络会使软路由与 OpenAI 断连。因此，今后没有用户针对当次动作的明确授权，不得切换 PC 网络。

当前新研究仅允许机器人侧：先只读核实 `5 GHz Wi-Fi` 支持情况；若不支持，再评估机器人 gateway/DNS=`192.168.0.2`。本节点没有修改 PC 或机器人网络、产品代码、构建或刷写，也不记录 Wi-Fi 密码。

#### 2026-08-09 Task 69：PC-only VB 同源回录与证据口径纠正

首次尝试因 `ffmpeg` 不存在、raw 输入 `0 bytes`，仅生成空白 capture；该轮无效，不用于任何音质判断。

随后为现有 `vb_cable_player.py` 增加 `--wav`，以用户已确认清晰的 Task 57 `+12 dB / 24 kHz` WAV 作为唯一输入，完全排除机器人、Wi-Fi 和 Dock。player/capture 均 `exit 0`，产物 `.claw/runtime/task69-vb-loopback-ab/task69-task57-through-vb-cable-48k.wav`，时长 `18.5 s`、采样率 `48 kHz`。相关性计算当前异常，尚无音质结论，等待进一步定位或用户试听。

方法论纠正：目标设备是 Stack-chan 整机，不能把通用 M5Stack/CoreS3 当作等价硬件。ESP32-S3 `2.4 GHz` 频段结论有实机芯片身份支持，继续保留；音频、触摸、舵机、电源等必须以 Stack-chan 官方整机资料和本机源码为主要证据，通用 CoreS3 资料只作低等级辅助推断。

用户认为当前投入产出不成比例，因此暂停新固件和刷写，优先研究并建立分层观测、Golden 与 HIL 流程。本节点不记录密码，未改产品代码、网络、构建或刷写。

#### 2026-08-09 Task 70：官方 Stack-chan 整机分层诊断基线

证据对象统一纠正为**官方 Stack-chan 整机**。M5Stack/CoreS3 与 ESP32-S3 资料只在各自层级有效，不能替代整机的麦克风、触摸、舵机、电源和时序资料。音频 Golden 优先来自官方 Stack-chan `Mic Test` 加本机源码/硬件实证；通用 CoreS3 结论降级为待验证假设。

官方只读调研形成的工具箱为：ESP-IDF JTAG/GDB 抓真实任务现场，core dump 保存 panic 回溯，heap failed-allocation hook 捕获失败大小/caps/调用点，App Trace 连续记录低扰动事件与计数，`pytest-embedded` 固化串口、复位和硬件 HIL。Xiaozhi 仅作为分层架构参考：codec/I2S、采集服务、处理/编码、有界队列、会话 transport、应用状态逐层隔离和观测，而不是直接复制通用板实现。

历史低效来自故障层未确定时反复刷写和依赖用户试听、整机与通用板证据混用、transport/频谱/可懂度越层替代，以及缺少同源 Golden、层间落盘和可重复 HIL。

统一门禁：`L0` 整机身份/安全/回滚；`L1` 单变量离线合同、review、完整构建与镜像；`L2` 启动、heap/stack/core dump/transition；`L3` I2S 原始采集与官方 Mic Test Golden 逐样本/频谱对照；`L4` 设备计数与主机 transport 闭合并定位 gaps/ENOMEM；`L5` 同源 Golden 的 PC-only VB 回录；`L6` 真实语音 speaker、mic 阻断和 Speaking↔Listening 恢复；`L7` 用户真人、Codex Voice、MCP 表情动作和拔 USB 产品验收。任一低层失败不得进入更高层，也不得用低层指标代替 `L7`。

允许刷机的前置合同：问题已定位到固件层，且不能由只读、PC-only 或现有 HIL 回答；`L0-L1` 全绿；候选 hash/长度、完整回滚、唯一变量、观测点、成功/失败信号和停止条件均在写前固化。写后从最低受影响层逐级验收，首个失败即停止。当前暂停新功能候选和刷写，先补分层观测、Golden 与 HIL。本轮没有修改产品代码、网络、计划或 Git，不记录任何密码。

#### 2026-08-09 Task 71-74：PC VB 首个失败层定位

- **Task 71 / 单一 PortAudio 双工流：** Task 57 同源经 VB 后 lag `105.458 ms`、sample corr `0.999999336`、gain `0.999413`、SNR `58.77 dB`，活动区源/回录 exact-zero 均约 `0.407%`，证明 VB DSP 本身透明。日志和产物位于 `.claw/runtime/task71-vb-duplex-ab/`（`report.json`、stdout/stderr、`task71-task57-vb-duplex-48k.wav`）。
- **Task 72 / 两个独立进程：** capture high latency、overflows0，但活动区 exact-zero `36.54%`、全段 `49.18%`、corr `0.0898`，复现跨进程断流；证据 `.claw/runtime/task72-vb-two-process-ab/`。
- **Task 73 / 仅 player low→high latency：** 活动区 exact-zero 仍 `34.95%`，否证 PortAudio low-latency 单因假设；证据 `.claw/runtime/task73-vb-high-latency-ab/`。
- **Task 74 / 只读 Control Panel 3.3.1.7：** Internal/input/output SR 均 `48 kHz`、`24 bit`、Max Latency `7168`，input/output DMA size 均 `4096`，累计 Pull loss `3502481`。后续 Task82 已纠正：DMA size 不等于应用 callback buffer，应用 buffer 看 `b128/b256/b512/b1024...` 统计；本轮 `b1024=0`，不能由 DMA4096 直接推出必须12288。截图 `.claw/runtime/task74-vbcable-config-readonly/vbcable-control-panel.png`、`vbcable-latency-menu.png`、`vbcable-options-menu.png`。

官方 [VB-CABLE Reference Manual](https://vb-audio.com/Cable/VBCABLE_ReferenceManual.pdf) 给出 `Max Latency = 3 × Max App Buffer`；[support 讨论](https://forum.vb-audio.com/viewtopic.php?t=1430) 的 `12288` 前提是两个应用确实使用 `4096` buffer。本机现有统计不满足该已证前提，因此 Task74 的强推导已作废。

当前首个失败边界是 PC VB 的跨进程 buffer 合同，而非 VB DSP。下一步需用户当次明确授权后才设置 `12288` 并重启，再做同源复测。本轮未改设置、未重启、未刷固件，也未改产品、网络或 Git。Dock 已恢复 PID `31324` 且机器人 TCP Established，仅代表环境复位，不是验收通过；不记录任何密钥。

#### 2026-08-09 Task 75：VB-CABLE latency 配置保护脚本

当时只读定位到配置镜像 `HKLM\SOFTWARE\VB-Audio\Cable`，当前 `VBAudioCableWDM_SR=48000`、`VBAudioCableWDM_Latency=7168`，与 Control Panel 一致；Task81-82 后确认它不能单独代表运行态。

新增 `ops/bin/configure-vbcable-latency.ps1`：默认 preflight，目标 `12288`；检查 expected-current、设备 `ROOT\MEDIA\0000`、版本 `3.3.1.7` 与 `48 kHz`。`-Execute` 要求管理员权限，先保存 JSON 备份，写后回读并输出 rollback command；只报告需要 reboot，不自动重启。

验证：脚本 parse OK；preflight `before=7168 / after=7168`；传入错误 expected-current 时 guard 按预期失败且没有写入。**本轮未 Execute、未改注册表/网络/固件、未重启。**

#### 2026-08-09 Task 76：同源回录自动门禁基线

新增 `tools/wifi_audio_analysis/compare_known_loopback.py`。初次因 `numpy.bool_` 无法 JSON 序列化而失败；转换为原生 `bool` 后重跑成功。基线结果：Task71 `PASS exit0`（corr `0.999999336`、gain `0.999413`、SNR `58.77 dB`、added-zero `0`）；Task72 预期 `FAIL exit1`（corr `0.08984`、SNR `-20.88 dB`、added-zero `36.135%`）；Task73 预期 `FAIL exit1`（corr `0.06010`、SNR `-24.40 dB`、added-zero `34.541%`）。

重启后必须复用这组自动同源门禁，不再主观猜测。配置脚本仍未 Execute，注册表 latency=`7168`，未重启/刷写/改网络。plan 已进入 `process.wait` 等待授权。

#### 2026-08-09 Task 77：Max Latency 7168→12288 写入记录

首次非管理员 `-Execute` 被保护拒绝，值保持 `7168`。首次 UAC 等待 `120 s` 超时，未产生 backup/log，回读仍为 `7168`，不属于成功变更。

用户明确要求重试后，第二次 UAC 成功：`ElevatedExitCode0 / Before7168 / After12288 / InternalSR48000`。备份 `.claw/runtime/task77-vbcable-latency-change/before-change.json`，日志 `.claw/runtime/task77-vbcable-latency-change/elevated-output.log`，脚本同时输出了 rollback command。

当前仅确认注册表回读为 `12288`；驱动运行态尚未重启生效。下一步 Windows reboot 后复用 Task76 自动门禁，才能判断跨进程断流是否修复。本轮未改网络或固件。

#### 2026-08-09 Task 78-80：VB 驱动 service 配置层闭环

**Task78 / 第一次 reboot 反证：** boot `12:17:55`，SOFTWARE 键=`12288`、PC 仍连接原有软路由 Wi-Fi；同 Task72 的 PC-only 门禁仍 `FAIL`：corr `0.0630266`、gain `0.049253`、SNR `-23.948 dB`、added-zero `30.4947%`，player/capture exit0、underflow/overflow0。机器人 ping0、Dock 未启不参与该 PC-only 窗口，不能用来否定本轮 A/B。

**Task79 / 当时的配置层假设：** Control Panel 运行态仍为 Max/Current `7168`，Internal/Input/Output `48k/24bit`、DMA `4096`、Pull loss `463`。只读注册表对照为 `SOFTWARE\VB-Audio\Cable=12288`、`SYSTEM\CurrentControlSet\Services\VB-Cable=7168`。当时把后者误称“驱动 service 权威层”；Task82 已确认实际 PnP service 是 `VBAudioVACMME`，该旧称谓作废。

当时将 `ops/bin/configure-vbcable-latency.ps1` 修正为 `Services\VB-Cable` 键权威、同步 SOFTWARE 镜像，并对两处执行备份/写后回读/失败恢复。parse 与 preflight 通过，Task79 本身没有写入；Task82 随后证明“service键权威”是假设错误，这里只保留历史。

**Task80 / 授权写入：** UAC 成功，`Services\VB-Cable` 配置容器 `7168→12288`，SOFTWARE `12288` 保持，两处回读均 `12288`；备份/日志位于 `.claw/runtime/task80-vbcable-driver-latency-change/`。后续 Task81-82 证明两处回读不代表 Control Panel 运行态生效。本轮未改固件/网络，未证明修复。

#### 2026-08-09 Task 81-82：12288 运行态未生效并终止路线

Task81 第二次 reboot：boot `2026-08-09 12:52:54`，PC 仍连接原有软路由 Wi-Fi；SOFTWARE/`Services\VB-Cable` 均 `12288/SR48000`、PnP 全OK，但管理员 Control Panel 仍 Max/Current `7168`。再次UAC启动官方面板并点击 `Set Max Latency: 12288 smp (requires REBOOT)`；当场仍7168、两键仍12288，记录为等待重启的菜单操作，不能记生效。

Task82 第三次 reboot：boot `2026-08-09 13:33:38`，网络未切换、两键仍 `12288/SR48000`、PnP 全OK，但面板仍 Max/Current7168，Latency 菜单 `3x4096/3x8192` 禁用；用户确认无法选择12288。

PnP 证据：`ROOT\MEDIA\0000` 实际 service=`VBAudioVACMME`、INF=`oem96.inf`、driver=`3.3.1.7`。`Services\VB-Cable` 不是实际绑定 service，而是与 SOFTWARE 键一起被 sys/control-panel 二进制引用的配置容器；系统仅这两处 Latency 且均12288，运行态仍7168。官方资料说明7168是默认 max allocated memory，部分 Windows 配置可能忽略更高启动值。因此停止12288与继续重启路线。

同时撤销“DMA4096必需12288”：DMA size不等于app callback buffer，应用统计 `b128/b256/b512/b1024` 才有效，本轮 `b1024=0`。新假设转为阻塞式 player 的跨进程供数空窗/时基不连续；下一步PC-only callback+jitter-buffer单变量，不刷固件、不改网络，尚未修复。

#### 2026-08-09 Task 83：buffered player 单变量失败

播放器改为 `100 ms` 预缓冲、独立连续 write 线程、断粮补静音；`py_compile`、单测 `3/3`、diff-check 均通过。Task57 固定源下 capture/player exit0，player `frames1638/underflows0/inserted_silence_chunks0`，capture20s/overflows0。

同源 gate 仍 FAIL：corr `0.085546`、gain `0.068465`、SNR `-21.308 dB`、added-zero `34.2149%`。这否证阻塞式读写耦合或未调用write空窗为主要根因；跨进程VB路径未修复。实验代码将回退，不保留该复杂化。证据 `.claw/runtime/task83-vb-buffered-player-ab/`；未改网络/固件/机器人。

#### 2026-08-09 Task 84-85：KS 不兼容与 MME 零样本恢复

Task84 首次因 `Start-Process` 空格拆参无效；修正后 WDM-KS 在音频前返回 `Blocking API not supported yet (Pa -9999)`。只能判现有 blocking player 不兼容 KS，不能判音质失败。

Task85 首次完整 MME 名称被 PortAudio 截断导致 resolve 失败，无效；用唯一前缀 `CABLE Input` 后有效，player/capture exit0，frames1638、underflow0/overflow0。报告 `source_start484.083ms / corr -0.0232868 / gain -0.022707 / SNR -32.626dB`，自动 gate FAIL；source/capture zero=`0.4074556%/0.4071847%`、added-zero≈`-0.0002709%`、两端 peak=`7448`，说明 MME 只消除了 WASAPI 的约34%额外零，没有保真。

用户试听明确 FAIL：低沉男声、完全听不清。输入是已批准清晰的 Task57 +12dB WAV；源/回录 `16.38s/20s`（含静音），活动包络尺度≈1.0、lag≈490-500ms，但频谱映射比例≈0.51；重心 `1037.89→638.50Hz`，中位频率 `855.47→468.75Hz`。相邻相等率 `2.0677%→35.1131%`，偶/奇成对 corr `0.99999885`、diff RMS `0.795`，确认近似成对复制/半频失真，而非普通时漂。

MME/VB 格式路线正式拒绝。输入就是用户批准清晰的Task57源，故客观同源门禁已足以拒绝，试听失败为独立复核。机器人不参与该PC-only实验，不能外推机器人麦克风回退。文件 `.claw/runtime/task85-vb-mme-output-ab-retry/task85-task57-vb-mme-output-48k.wav`；未改代码/Git/系统/网络/硬件。

#### 2026-08-09 Task 86：WASAPI 2ch 单变量失败

临时把player/capture设为2ch，mono复制L/R、capture取L，单测2/2。停止旧Dock/player后，用同一批准Task57源运行独立WASAPI双进程20s：两进程exit0、underflow/overflow0；gate仍FAIL，`source_start408.417ms / corr0.247346 / gain0.247096 / SNR-11.861dB / added-zero0.34379% / peak7448→7447`。

2ch较旧跨进程corr约0.06-0.09改善，但远未达到同流0.999/50+dB，否证单声道帧格式为唯一根因；不试听、不记修复。临时代码已完整回退，player测试回到1/1待复核。证据 `.claw/runtime/task86-vb-wasapi-stereo-ab/`。

标准非MCP Dock恢复PID25668、player PID14612、8765 Listening（PID可变）。未改机器人固件、网络、驱动。

#### 2026-08-09 新计划 Task 4：XiaoZhi Local Dock 离线候选

官方 profile 为 `USB_UAC_MVP=n / WIFI_AUDIO_MVP=n / XIAOZHI_LOCAL_DOCK=y / USB_DEVICE_UAC_AS_PART=n`。首次未export IDF导致CMake PATH失败，属于环境；一次根目录运行Python模块导致ModuleNotFound，正确cwd后6/6，也属于路径错误。

产品构建先后关闭两项真实问题：TinyUSB `tusb_config.h` 缺失来自旧AS_PART配置所有权，改为n；`esp-ml307 web_socket.cc/header` 私有/官方混合来自重叠补丁同序撤销，改完整端点检测、逆序撤销、混合态fail closed。`ota.cc` 在忽略目录不可重放的P1通过新增 `firmware/patches/xiaozhi-local-dock.patch`、CMake验证应用及nested Git index `git apply --cached --check` 关闭。诊断开关迁到main target `AUDIO_SERVICE_DIAG_ENABLED=0`，build.ninja确认。

最终IDF5.5.5 full build成功：bin `5,155,248/0x4EA9B0`，ota_0 `0x4F0000`，free `22,096/0x5650`，SHA256 `27187B9F0E604EC84AD989520BF6E994037C746594BAA798B92794B128263EC5`。门禁：firmware93=`83 pass+10 legacy-private-patch scoped skip`，Dock55/55+syntax，Rust7/7，reference comparator2/2，diff-check clean。仅余22KB是风险；尚未刷写/实机/试听/Codex，不能记通过。

#### 2026-08-09 新计划 Task 5：HIL 备份后设备未枚举

旧Dock PID25668（`wifi-audio-dock --port8765`）已正常停止并释放端口。预检时COM7、MI_02在线，芯片ESP32-S3 rev0.2、MAC `44:1b:f6:e2:78:a8`。

esptool4.12.0@921600只读完整ota_0 `0x20000/0x4F0000`成功；备份 `.claw/runtime/xiaozhi-hil-20260809/preflash-ota0.bin`，length5177344、SHA256 `00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`，sidecar存在。

备份后hard reset；后继partition read在打开COM前FileNotFound，未写入。30s轮询COM7未恢复，PnP三接口Present=False，ping false/ARP incomplete。新候选尚未写入，因此不是刷写失败或候选失败；HIL暂停在设备重新枚举/实体电源或RST边界。未切PC网络，未记录密钥。

#### 2026-08-09 新计划 Task 5/6：官方适配器与统一 runtime 离线推进

`tools/stackchan-dock/src/xiaozhi-dock.mjs` 新增官方 XiaoZhi JSON-RPC 适配：会话绑定，断线/替换/超时/迟到响应 fail closed；typed MCP 仅映射 `self.get_device_status`、`self.robot.set_led_color/get_head_angles/set_head_angles/celebrate`，表情走官方 `llm emotion`，不发布不受支持的旧 `set_audio`。对应测试 `tools/stackchan-dock/test/xiaozhi-dock.test.mjs`。

统一单进程实现为 `src/xiaozhi-runtime.mjs` + CLI `bin/xiaozhi-dock.mjs`，组合 `xiaozhi-bootstrap-server.mjs`、`xiaozhi-websocket-server.mjs`、`xiaozhi-wasapi-bridge.mjs`、native `stackchan-wasapi-broker.rs`、官方半双工TTS和typed MCP。启动脚本 `tools/stackchan-dock/scripts/start-xiaozhi-mcp.ps1` 仅将DPAPI凭据置于子进程env；路由只读推导advertiseHost，禁止修改PC网络。

测试时间线：适配器首轮16/17仅因异步断言写法，修正后Dock60/60；runtime首轮60/62因EventEmitter派生类漏`super()`，修正后target2/2、全量62/62；隐藏set_audio后63/63+npm check。PowerShell parse/禁止网络变更门禁通过；firmware共94项（84 pass/10 scoped skip）、Rust7/7、reference comparator2/2。

只读路由为WLAN `192.168.0.11`、gateway/DNS `192.168.0.2`，未切网。当前ping false，COM/JTAG/USB接口数0，8765/8766无listener。候选尚未写入，不是candidate/flash失败。本节点未改产品/plan/Git/网络/硬件，未记录token或密码。

#### 2026-08-09 新计划 Task 5：USB 远程恢复未获权限

历史 composite `USB\VID_303A&PID_1001\44:1B:F6:E2:78:A8` 为Present=False，历史位置 `USB\ROOT_HUB30\5&2f3a6991&0&0` port1。pnputil只读拓扑显示该root hub无在线children；数位板/蓝牙/指纹位于其他root hubs。

一次精确 `pnputil /restart-device` 返回 `Failed to restart device ... Access is denied`，状态未变。后续30s仍USB interfaces0、serial0、ping false。没有UAC绕过、电脑重启、切网或刷写；需实体重新上电或重插USB，不能记候选/刷写失败。

#### 2026-08-09 新计划 Task 5：离线 HIL harness

资产：`tools/stackchan-dock/bin/xiaozhi-dock.mjs --standalone`、`tools/stackchan-dock/scripts/start-xiaozhi-dock.ps1`、`ops/bin/test-xiaozhi-audio-hil.ps1`；固定源 `firmware/main/assets/dev_serial/celebration-short-16k-mono-s16.wav`。

**纠正：串口prompt_sample链不可达。** `firmware/main/hal/hal_dev_serial.cpp:357-367` 的 `start_dev_serial_wake_stop_task` 只打印intentionally disabled，不安装USB Serial/JTAG driver、不创建task。宏/代码存在不能当运行入口证据。上行HIL改为真实可达Wi-Fi dev HTTP `/dev/inject_prompt`，调用现有 `tools/remote_control/remote_control.py`，新脚本命令行不携带凭据；链为固定WAV→官方AudioService→Opus→WS→native WASAPI→CABLE Output，比较器继续WAV相对映射。

门禁：Dock63/63+npm check、比较器4/4、PS parse和禁止网络变更静态检查通过。`test-xiaozhi-audio-hil.ps1` 已移除COM前提，preflight改查WS authenticated与18080 reachable；当前均false，符合硬件离线，未Execute HIL。

standalone PID28380在192.168.0.11监听8765/8766；stderr显示bootstrap/WS/standalone ready、WASAPI capture24k和CABLE Input render16k ready。随后按PID及子进程清理，端口0 listener、Node不存活。首次组合命令exit1仅因预期rg无匹配遗留LASTEXITCODE=1，产品步骤成功，属于夹具环境失败。

旧raw-PCM路线仅为rollback。当前无认证且18080不可达，未刷写、未实机HIL，无真实mic/speaker/Codex/听感结论；未改产品/plan/Git/系统/硬件，未记录token或密码。

#### 2026-08-09 新计划 Task 5：speaker 离线 HIL

新增 `tools/wifi_audio_analysis/extract_wave_pcm.py` + `test_extract_wave_pcm.py`、`ops/bin/test-xiaozhi-speaker-hil.ps1`。固定链：16k人声→独立`stackchan-wasapi-play`→production process-loopback broker→官方24k Opus WS→机器人speaker。

脚本默认只读preflight，`-Execute`才运行；自动完成必须stderr同时含`half_duplex_speaking=true/false`且无runtime error/disconnect，用户试听仍为必需门禁。离线：extract1/1、compare4/4、start/audio-HIL/speaker-HIL三PS parse、禁止网络变更静态检查均通过；speaker preflight为ports available、`user_listening_required=true`。

第二次standalone有2 listeners，正式URL纠正为 `ws://192.168.0.11:8765/xiaozhi/v1`；凭据不在命令行或父环境，清理后端口释放。硬件仍USB0/COM0/ping false，未Execute speaker HIL、未刷写/听感/Codex。raw-PCM仅rollback；未记录token/密码。

#### 2026-08-09 新计划 Task 5：BLE provisioning 官方模式迁移

`tools/stackchan-dock/scripts/ble-provision-wifi-audio.py` 从仅允许ws/wss扩为http/https/ws/wss，新增只列StackChan的`--scan`，且provision必须收到`wifiAudioConfigured`通知才成功。测试 `tools/stackchan-dock/test/test_ble_provision_wifi_audio.py` 为3/3。

新增默认只读 `tools/stackchan-dock/scripts/provision-xiaozhi-dock.ps1`：按现有到192.168.0.8路由推导 `http://192.168.0.11:8766/xiaozhi/ota`，DPAPI secret仅子进程env、不进命令行；保留机器人WiFi且禁止改PC网络。

只读scan无广播StackChan；wrapper preflight=`secret_present=true/write=false`，未执行BLE写入。门禁Dock63/63+npm check、BLE3/3、分析器5/5、PS parse/无网络修改均绿。

Truth `.claw/truth/features/wifi-codex-voice-product-architecture.md` 与 ADR `.claw/truth/adr/reuse-xiaozhi-audio-stack-with-local-pc-dock.md` 已同步串口no-op、HTTP HIL、BLE确认和当前实机边界。未Execute BLE、刷写、实机、Codex或听感；未记录凭据。

#### 2026-08-09 新计划 Task 5：重新上电后仍无系统枚举

用户重新上电后，`VID_303A/PID_1001` 与Win32_PnPEntity均无目标；无StackChan BLE广播，192.168.0.8不可达，无机器人TCP。USB ROOT_HUB30全部Status OK/Problem0，历史目标hub无Espressif children。

该阶段官方XiaoZhi候选尚未刷写，故当时故障不得归因候选或音频代码；该窗口边界在实体供电/启动/USB枚举之前。只读记录，未改产品/计划/Git/系统/网络/硬件，未记录密码。

用户现场补充：按左侧电源键仅短暂闪一下便熄灭。与当时USB/BLE/Wi-Fi/TCP均无上线证据合并后，该阶段窗口曾收敛为**当时无法保持上电，尚未进入可观测系统启动**；后续恢复证明它不是持续故障。

本文件 2026-08-07 受保护写入后的历史记录曾出现相同的左侧电源键短暂闪屏，且该历史实例后来恢复黄灯、Ping与Dock认证；所以闪屏表象不能单独给出根因。本次官方XiaoZhi候选从未刷写，仍禁止归因候选。

数据线连接后，用户再次操作使机器人正常启动。只读检查：VID303A/PID1001 composite、MI_02 JTAG、COM7均Status OK/Problem0，192.168.0.8 ping5/5。随后用户明确进入下载模式。

“无法保持上电”现仅保留为阶段性历史窗口。当前进入官方候选受保护只读preflight，尚未刷写。

#### 2026-08-09 新计划 Task 5：官方候选 app-only 写入与启动

preflight：ESP32-S3 rev0.2、MAC `44:1b:f6:e2:78:a8`，live ota_0=`0x20000/5056K`；candidate SHA `27187B9F0E604EC84AD989520BF6E994037C746594BAA798B92794B128263EC5`，rollback SHA `00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`。

Execute仅写ota_0，length5155248；内建hash verified、独立verify digest matched，`FLASH AND VERIFY PASSED`。未写bootloader/partition/NVS/assets或其他分区。

hard reset后VID303A composite、MI_02、COM7均OK，192.168.0.8 ping5/5，证明候选启动并联网。尚未Dock认证/HIL/听感/Codex。联合BLE观察因外层30s timeout无汇总，属于无效工具窗口，不得记启动或BLE失败。

#### 2026-08-09 新计划 Task 5：小智自动启动与配置入口边界

用户确认候选自动进入小智，联网及登录正确。镜像不是原厂官包原样，而是复用官方Application/AudioService/Opus/WebSocket栈的local Dock候选。

只读配置：`sdkconfig.xiaozhi_dock` 中WIFI_AUDIO_MVP未启用、XIAOZHI_LOCAL_DOCK启用，所以旧隔离runtime的启动即BLE分支不运行；撤回“需打开Setup”的判断。编译`CONFIG_OTA_URL=http://192.168.0.12:8080/ota`，但`Ota::GetCheckVersionUrl`优先NVS `wifi/ota_url`；本地认证键为`xiaozhi_local/token`，不记录其值或URL凭据。

18080开放，status=`2.0.45 / idle / heap7357755 / RSSI-69`，可从现有WiFi管理面配置。当时拟议入口受18080鉴权，仅写`wifi/ota_url`和`xiaozhi_local/token`并延迟重启；用户随后同意，见下一节。

#### 2026-08-09 新计划 Task 5：18080 本地配置离线实现

`/dev/xiaozhi-local`仅LOCAL_DOCK编译：401鉴权、body≤512B、http(s)/长度/空白检查、token=64hex；已有pairing token不一致返回409防接管。全部字段先验证，token namespace先commit、再ota_url commit并双读回校验；不回显/记录token，复用MCP延迟重启。

PC remote_control从`STACKCHAN_WIFI_PAIRING_KEY`取secret，DPAPI wrapper仅子进程env，不进命令行、不改PC网络/机器人WiFi。真实鉴权none401/valid200/invalid401。门禁contract10/10，firmware97=`87 pass+10 scoped skip`，Dock63/63，py/PS parse、network mutation scan、dry-run `192.168.0.11:8766/write=false`、mock body均通过。

IDF5.5.5两次full build通过。bin `5158080/0x4EB4C0`，free `19264/0x4B40`，SHA `B5FF9499C0996859E1F656B96C0584692C3CC9AA9066B88DEF039C58F0888AA5`；ELF SHA `7EF39E69C3E3B4ED1F3F440A6302A918CF4198AFF3355F7817884B8F525132FF`；checksum d8、validation `cdc5d6c27fec22937f8482e58dea32fd794d6cbf52eebbbbfb49c9ef4c0499f2` valid，handler frame464B。flash pin已更新，rollback仍`00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`。

新候选尚未刷写/实机配置/HIL/听感/Codex；不记录token或密码。

#### 2026-08-09 新计划 Task 5：B5FF 写前 preflight

preflight前ping3/3，COM7/USB composite/MI_02身份正常，MAC `44:1b:f6:e2:78:a8`；local Dock PID13372仍监听8765/8766。

只读flash preflight确认ota_0=`0x20000/5056KiB`、candidate `B5FF9499C0996859E1F656B96C0584692C3CC9AA9066B88DEF039C58F0888AA5`、rollback `00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236`，`PREFLIGHT PASSED`；esptool后目标停bootloader。

尚未Execute/擦除/写入；bootloader状态不是候选失败。不记录凭据。

#### 2026-08-09 新计划 Task 5：B5FF app-only 写入

`flash-xiaozhi-dock-candidate.ps1 -Execute` exit0。candidate 5158080B / SHA `B5FF9499C0996859E1F656B96C0584692C3CC9AA9066B88DEF039C58F0888AA5`，唯一写ota_0@0x20000；compressed2971416B，29.6s，内建hash verified，独立verify digest matched/OK，hard reset，`FLASH AND VERIFY PASSED`。

NVS/bootloader/partition/assets未写，rollback `00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236` 有效。启动/配置/HIL/听感/Codex尚未验收；不记录凭据。

#### 2026-08-09 新计划 Task 5：B5FF 启动与LAN配置

hard reset后2s门禁ping/COM7/18080均true；remote status=`v2.0.45 / idle / free7433207 / RSSI-43`。

provision dry-run解析 `http://192.168.0.11:8766/xiaozhi/ota`，write=false、不切PC网络、不改机器人WiFi；随后同脚本`-Execute` exit0，设备确认写入并延迟重启。一次remote_control误用`--host`为usage error，改`--ip`后成功，非设备失败。

不记录token/secret。当前等待重启与local Dock认证，HIL/听感/Codex未验收。

#### 2026-08-09 新计划 Task 5：local Dock认证通过

明确reboot请求被接受；复位后ping3/3，PC出现机器人到8766的连接回收态，证明新bootstrap URL已读取。空闲无8765经源码确认为官方WebSocket仅在会话`OpenAudioChannel`时连接，不是失败。

18080 wake后约3s出现 `192.168.0.8→PC:8765 Established`，Dock日志 `StackChan XiaoZhi authenticated device=44:1b:f6:e2:78:a8`；status=`listening/free7368083/RSSI-70`。

app-only、LAN provision、bootstrap、WS认证通过；音频HIL/听感/Codex仍未验收。不记录凭据。

#### 2026-08-09 新计划 Task 5：HIL首轮在HTTP注入前失败

uplink dry-run：authenticated_connection_present=true、dev_http_reachable=true、source WAV/capture binary/device ready均确认。speaker dry-run因当前Dock占用返回ports_available=false，未Execute。

uplink `-Execute` 在 `/dev/inject_prompt` 立即HTTP500，脚本line98抛出；未进入有效录音/比较，无音质结论，不算音频链失败。当前只读定位endpoint失败条件；不记录凭据。

#### 2026-08-09 新计划 Task 5：inject任务内部栈分配失败与离线修复

相同请求稳定返回HTTP500 body=`task_create_failed ret=-1 heap=13863 internal=13863`，确认 `/dev/inject_prompt` 在创建开发注入任务时因内部内存不足失败，尚未进入音频路径。

合同先红 `10/11`；唯一产品变量为注入任务改用 `xTaskCreatePinnedToCoreWithCaps(4096, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)`，三处退出对应 `vTaskDeleteWithCaps`。官方IDF测试源码可见 `vTaskDeleteWithCaps(NULL)` 配对。最终定向 `11/11`、firmware `98`项通过（含`10` profile skips）、diff-check通过；IDF5.5.5完整build/link/partition `166.6s`成功。

新bin=`5158112/0x4EB4E0`，ota余量=`19232/0x4B20`，SHA=`E935...6204`；ELF SHA=`F09C...C529`；checksum=`0x84`、validation=`8372...6501`有效；task/handler frame=`144/256B`，flash pin已更新且rollback不变。尚未刷写或实机HIL，不得记为设备已修复；不记录凭据。

#### 2026-08-09 新计划 Task 5：E935 受保护写入

HTTP stop先成功；preflight核对芯片/MAC/实时ota_0、candidate=`E935...6204`及rollback，结果PASSED。Execute exit0，仅写`ota_0@0x20000`：`5158112B`，压缩`2971392B`，`29.6s`；内建hash verified，独立verify digest matched/OK，hard reset，最终`FLASH AND VERIFY PASSED`。

其他分区与NVS未写，rollback不变。当前只完成写入与独立校验；启动、endpoint、HIL、听感和Codex仍未验收，不记录凭据。

#### 2026-08-09 新计划 Task 5：E935 启动及第二轮HIL失败

启动后ping3/3、status=`idle/free7446475`；wake后8765 Established且Dock再次authenticated。`test-xiaozhi-audio-hil -Execute` 成功启动Prompt注入，实机确认WithCaps修复越过原`task_create_failed`。

真实参考映射仍FAIL：source/candidate/aligned=`51840/160000/51062`，offset=`94271 samples / 5891.94ms`，time_scale=`0.985`，envelope/sample corr=`0.5160149/0.0893074`，gain=`0.0153717`，SNR=`-20.585dB`，peak=`20595/5086`；仅zero/adjacent growth通过。产物位于`.claw/runtime/xiaozhi-hil-20260809-175850`。

本轮不可试听，音质门禁失败；当前只读核对AudioService注入与真实mic是否并发交错，尚未定案，不记录凭据。

#### 2026-08-09 新计划 Task 5：HIL双源交错根因定案

源码确认Listening期间，真实mic的`AudioInputTask→processor OnOutput`每60ms `PushTaskToEncodeQueue`，inject路径也每60ms `InjectPcmFrameToSendQueue`，且注入没有暂停真实mic，因此capture按同节拍交错两路音频。

对175850失败PCM按960-sample帧只读搜索：全帧最佳envelope corr=`0.5064`（start=`5870ms`）；每隔一帧抽取最佳corr=`0.982833`（start=`31680 samples / 1980ms`）。该结果直接闭合交错假设。

故第二轮整体低相关属于测试源污染，不能外推为真实mic、Wi-Fi或Opus失真；WithCaps endpoint实机修复仍有效。停止为该测试夹具盲刷，转真实mic/喇叭验收，不记录凭据。

#### 2026-08-09 新计划 Task 5：speaker HIL首轮日志共享异常

PC-only合同新增临时Dock启动后HTTP wake并等待认证的正确顺序，红灯后通过`12/12`；全量firmware `99`项通过（`10` profile skips），PS parse通过。安全停止旧Dock PID13372及子进程28412/26936，确认ports free；Codex target17572仍alive。

speaker Execute提取`51840` samples并wake成功，但约`20.3s`后读取临时`dock/stderr.log`时因文件占用抛`ReadAllText`异常。当前只能判定PC日志共享夹具失败，不能写transport/播放/听感通过或音频链失败。先读取释放后日志并修PC共享读取；固件/网络未改，不记录凭据。

#### 2026-08-09 新计划 Task 5：speaker HIL自动门禁通过

释放后首轮日志确认auth成功、`half_duplex_speaking=true→false`两次、fixture `submitted=expected=51840`；但因执行期夹具异常，首轮仍不计PASS。PC脚本仅将`ReadAllText`改为`Get-Content -Raw`共享读取，定向`12/12`、PS parse与diff-check通过。

第二轮`test-xiaozhi-speaker-hil.ps1 -Execute`为exit0/约20.3s：source=`51840`、wake成功、`automated_transport_complete=true`；临时Dock PID15156、fixture PID12104，产物`.claw/runtime/xiaozhi-speaker-hil-20260809-180553`。

自动speaker transport及半双工生命周期PASS；用户听感与Codex Voice仍待，固件/网络未改，不记录凭据。

#### 2026-08-09 V1 最终产品验收结论

- USB连接窗口：用户在真实Codex Voice中通过机器人完成双向对话并明确“测试通过”；日志有authenticated及多轮`half_duplex_speaking=true→false`。Wi-Fi mic上行与speaker下行人工PASS。
- speaker独立听感：`.claw/runtime/xiaozhi-speaker-live-20260809-1925`，固定真人语音`51840 samples`、`automated_transport_complete=true`；用户确认“声音没有问题”。
- 物理断USB窗口：USB interfaces=`0`、COM7=`0`，Wi-Fi ping持续成功；用户再次完成Codex语音对话。结束后USB/COM仍为0，ping3/3，status=`idle/heap7369183/RSSI-43`。断USB Wi-Fi Voice双向人工PASS。
- 断USB MCP：`.claw/runtime/xiaozhi_mcp_expression_probe_20260809.json`返回`mcpConnected=true/ok=true/expression=happy/delivery=xiaozhi-websocket`，用户确认看到屏幕表情。PC→MCP→官方WS→屏幕表情人工PASS；不包含舵机。
- 舵机边界：用户直接确认此前崩溃发生在待机自动摇头。V1已禁用随机待机头动并通过约30秒ping6/6与HTTP最小稳定门禁；显式小幅舵机动作未获用户视觉确认，底层bug未修复，按用户决策延期且默认disabled。

最终判定：V1 Wi-Fi输入、Wi-Fi输出、PC屏幕表情控制和断USB正常使用全部满足产品级人工门禁。舵机不属于V1验收范围，不能写成已修复；不记录凭据。

#### 2026-08-09 最终运维纠正：local Dock不可停

收口时误停standalone Dock，导致`8766` OTA bootstrap与`8765` WS均无listener；用户指出这会阻断机器人按当前架构正确启动。该窗口是运维误操作，不是设备/固件失败。

使用正式`start-xiaozhi-dock.ps1`恢复后PID=`31688`，`8765/8766`均监听，`192.168.0.8` ping3/3。local Dock/bootstrap属于运行期依赖，尤其设备启动时不可关闭，最终保持运行；不记录凭据。

## 流程注记（2026-08-05）

本轮 `claw sync` 未能从当前 `CODEX_THREAD_ID` 找到 session-bound plan；已按恢复快照重建，并回到计划的 `3/4` 进度。该问题是本机任务会话绑定状态，不是机器人、Wi-Fi 或 Dock 的硬件诊断结论。

## 追加记录规则

每次实验都追加以下最小字段：阶段、镜像大小、写入分区范围、独立校验结果、串口最后关键日志、触摸/表情观察、BLE 广播与状态查询结果、以及相对上一轮只改变的一个变量。机密网络参数和配对材料一律省略或脱敏。
