# StackChan Wi-Fi Audio 数字链路真值矩阵

日期：2026-08-05

## 当前目标

在不继续盲目刷机的前提下，逐段核对 `ES7210 -> ESP32 I2S/DMA -> Wi-Fi -> Dock -> VB-CABLE`，区分静态上已确认的事实、运行态未知和候选根因。波形证据见 [波形量化分析](stackchan-wifi-audio-waveform-analysis.md)。

## 真值矩阵

| 检查项 | 官方/硬件真值 | 当前实现 | 结论 |
| --- | --- | --- | --- |
| ES7210 数据位宽 | M5Unified 写 `REG11=0x60`；Espressif 四麦示例使用 16-bit | ES7210 driver 在 16-bit 时写 `REG11[7:5]=0x60`；RX `data_bit_width=16` | 静态一致；“简单的 24/32→16 位截断”不是首要嫌疑 |
| 串行格式 | ES7210 官方驱动默认 Philips/I2S；TDM Philips 相对 WS 有一位延迟 | ES7210 `REG11[1:0]=00`，RX `bit_shift=true`、MSB-first、little-endian | 静态一致；仍需用总线采样确认实际相位 |
| TDM 帧 | 四槽、16 bit 时应为 64 BCLK/frame；WS 为 24 kHz、50% duty | RX 初始化为四槽 TDM、slot0--3、16 bit | 目标为 `BCLK=1.536 MHz`、`WS=24 kHz`、每半周期 32 BCLK；运行态未测 |
| MCLK | 256 × sample rate | sample rate 24 kHz、MCLK multiple 256 | 目标 `6.144 MHz`；运行态未测 |
| full-duplex 约束 | ESP-IDF 5.5.5 要求 full-duplex TX/RX 共享 BCLK/WS，并以相同配置构成 duplex | 单次 `i2s_new_channel(..., &tx, &rx)` 强制 full-duplex；TX 是 2-slot STD，RX 是 4-slot TDM | **高风险**：官方没有验证 mixed-mode duplex；只有最终帧长相同时才可能碰巧兼容 |
| TX/RX 帧长协调 | RX 四槽 16 bit 为 64 BCLK/frame | `esp_codec_dev` 尝试把 TX 从 2×16 扩展为 2×32，使 TX/RX 都为 64 BCLK/frame | 设计意图合理，但是否成功不可从静态代码确认 |
| 重配置错误传播 | 格式/clock 重配置失败应阻止设备打开 | `esp_codec_dev_open()` 调用 `data_if->set_fmt(...)` 后丢弃返回值 | **已确认缺陷**：TX 扩展或 RX TDM 重配置失败仍会继续运行，可能留下 32 BCLK/frame 或其他旧配置 |
| 初始化/打开顺序 | 官方 ES7210 TDM 示例只创建 RX，并在读取前一次性配置 | 本地构造函数先初始化并启用 STD TX + TDM RX；随后 `EnableInput`、`EnableOutput` 再分别 disable/reconfig/enable | **高风险**：共享 clock 在对侧运行或状态标志尚未同步时多次重配，运行态结果需要测量 |
| MIC1/MIC2 slot | ES7210 四槽顺序为 MIC1、MIC3/AEC、MIC2、MIC4 | Wi-Fi 模式用 `channel=4`、mask `slot0 | slot2`；ESP-IDF/codec-dev 按 active mask 打包 | API 语义上成立；若实际每帧只有 32 BCLK，则 slot2 根本不会到达 |
| MIC 使能/增益 | M5Unified 启用 MIC1/MIC2、关闭 MIC3/MIC4，增益约 33 dB；Espressif 示例 30 dB | 本地选择 MIC1/MIC2/MIC3，请求 60 dB、driver 钳位到 37.5 dB | 增益偏高约 4.5--7.5 dB，会放大底噪，但不足以单独解释机器人/鸭声；MIC3 额外启用不是官方最小基线 |
| I2S 读取结果 | 官方示例检查 `i2s_channel_read` 返回值，并只写入实际 `bytes_read` | data layer 不验证 `bytes_read == size`；`CoreS3AudioCodec::Read()` 无论 read 成败都返回请求样本数 | **已确认缺陷**：读失败/短读不会传到上层，可能发送旧数据、零数据或部分有效帧 |
| 10 ms Wi-Fi 帧 | 每帧 240 个 24 kHz mono s16le 样本，序号连续 | Dock 生命周期计数 `sequenceGaps=0`；录音中没有相邻 10 ms 块完全重复，但存在成段近数字静音 | 已降低 WebSocket 丢包优先级；近数字静音更可能在设备 PCM 形成阶段出现 |
| VB-CABLE 输出 | 正常连续写入时不应有 underrun | player 生命周期日志 `underflows=0`，Windows ch0/ch1 相关约 0.99999 | 已降低 VB-CABLE underrun 优先级；双声道只是 mono 复制 |
| 24→48 kHz | 会改变频谱图和相邻样本统计，但不应让三种算法都丢失人声 | duplicate/linear/polyphase 旧 A/B 均无可辨人声；本轮相邻样本相等约 26--30% | 重采样可能影响音色，不是共同雨噪/缺失人声的主要根因 |

## 代码锚点

- `firmware/main/hal/board/cores3_audio_codec.cc:93`：成对创建 full-duplex TX/RX。
- `firmware/main/hal/board/cores3_audio_codec.cc:109`：TX 为 standard 2-slot 16-bit。
- `firmware/main/hal/board/cores3_audio_codec.cc:142`：RX 为 TDM 4-slot 16-bit。
- `firmware/main/hal/board/cores3_audio_codec.cc:195`：Wi-Fi 模式以四槽 frame 打开 slot0/slot2。
- `firmware/main/hal/board/cores3_audio_codec.cc:256`：read 错误不影响返回样本数。
- `firmware/managed_components/espressif__esp_codec_dev/platform/audio_codec_data_i2s.c:432`：duplex frame-bit 兼容和 slot 扩展逻辑。
- `firmware/managed_components/espressif__esp_codec_dev/platform/audio_codec_data_i2s.c:693`：底层 read 未验证 `bytes_read`。
- `firmware/managed_components/espressif__esp_codec_dev/esp_codec_dev.c:178`：`data_if->set_fmt` 返回值被忽略。
- `firmware/managed_components/espressif__esp_codec_dev/device/es7210/es7210.c:238`：ES7210 I2S 格式寄存器。
- `firmware/managed_components/espressif__esp_codec_dev/device/es7210/es7210.c:271`：ES7210 输出位宽寄存器。
- `firmware/main/hal/wifi_audio_dock_mvp.cpp:211`：10 ms 采集、mono 抽取与发送。
- `tools/stackchan-dock/src/wifi-audio-receiver.mjs:221`：序号 gap 统计。

## 官方依据

- [ESP-IDF 5.5.5 I2S full-duplex](https://docs.espressif.com/projects/esp-idf/en/v5.5.5/esp32s3/api-reference/peripherals/i2s.html#full-duplex)：同一端口的 duplex 通道共享 BCLK/WS，官方示例要求两端使用相同配置。
- [ESP-IDF 5.5 ES7210 TDM 示例](https://github.com/espressif/esp-idf/blob/release/v5.5/examples/peripherals/i2s/i2s_codec/i2s_es7210_tdm/main/i2s_es7210_record_example.c)：RX-only、四槽、16-bit Philips TDM，并检查读取返回值和实际字节数。
- [M5Unified CoreS3 ES7210 初始化](https://github.com/m5stack/M5Unified/blob/master/src/M5Unified.cpp#L3576-L3684)：`REG11=0x60`，启用 MIC1/MIC2，关闭 MIC3/MIC4，增益寄存器为 `0x1B`。

## 根因排序

### 1. mixed-mode full-duplex 的实际 clock/frame 与预期不一致（高置信候选，尚未确认）

支持证据：官方要求 duplex 使用相同配置；本地是 STD TX + TDM RX；格式重配置返回值又被上层忽略。若 TX 扩展失败并保持 2×16，则 BCLK 约为 768 kHz、每帧只有 32 clocks，能够同时解释 MIC1 残留模糊人声、slot2/MIC2 缺失以及共同机器人/调频噪声。

反证/限制：`esp_codec_dev` 明确尝试把 TX 扩成 2×32；若成功，TX/RX 都是 64 clocks/frame，Philips WS 也同为 50%，mixed-mode 可能在物理时序上碰巧可用。必须测实际 BCLK/WS 才能定案。

### 2. I2S read 错误或短读被吞掉（确定存在，解释连续性问题的中高置信候选）

支持证据：源码无条件返回请求样本数，WAV 有 4--13% 的近数字静音帧；网络序号 gap 和播放器 underrun 均为 0。

反证/限制：相邻 10 ms WAV 块没有完全重复，所以不能声称已经捕获到旧缓冲复用；它也不能解释所有非静音区段的持续宽带/线谱噪声。

### 3. ES7210 模拟前端、电源/RF 或 MIC2 独立声学/硬件问题（中等候选）

支持证据：两路都有共同噪声，MIC2 额外缺少有效人声且低频/谱平坦度更高。

反证/限制：静态寄存器使能和 gain mask 覆盖 MIC2；如果实际帧只有 32 clocks，MIC2 的 slot2 根本没有被正确采到，当前不能先归咎硬件。

### 4. 单纯位宽、字节序、增益或 Windows 重采样错误（低优先级）

16-bit Philips 配置与两条官方路线一致；WAV 低字节使用完整、无削波；三种 Windows 重采样算法都无法恢复人声。它们仍可能影响噪声与音色，但不足以解释完整现象。

## 决策边界

下一步应直接观测共享时钟和 ES7210 原始数据，先把故障切分为“codec/模拟前端”“I2S/DMA”“Wi-Fi/PC”三段。任何只改一个寄存器或继续切换最终 mono 声道的刷机，信息增益都低于该测量。
