# StackChan Wi-Fi Audio 唯一高信息量实验

日期：2026-08-05（2026-08-06 确认无逻辑分析仪并选择替代路线）

## 决策

历史首选曾是一次**不刷机的四线数字总线采集**。2026-08-06 已确认现场没有逻辑分析仪，因此本节保留为将来具备设备时的参考；当前唯一执行路线是下文的 RX-only golden diagnostic。

| 信号 | CoreS3 GPIO | 作用 |
| --- | ---: | --- |
| MCLK | `GPIO0` | 验证 ES7210 主时钟 |
| BCLK | `GPIO34` | 验证每帧 bit clocks |
| WS/LRCK | `GPIO33` | 验证采样率、占空比和 slot 边界 |
| ES7210 DIN | `GPIO14` | 直接解码 codec 输出的四槽 PCM |

该实验不改变固件、codec、网络或 Windows 配置，是当前信息增益最高、因果污染最小的方案。

## 设备与安全边界

- 4 通道或更多、3.3 V 兼容的逻辑分析仪；推荐数字采样率至少 `50 MS/s`。低于该值时不能可靠验证 `6.144 MHz` MCLK 的边沿和占空比。
- 分析仪地线必须先与 CoreS3 GND 共地；探针只接数字信号，不向 GPIO 注入电压。
- GPIO 位于 CoreS3 内部音频连线，若没有可靠测试点或需要不可逆焊接，则停止，不以探针短路风险换取数据。
- 保持当前 MIC2 固件和当前 Dock 进程，不刷写、不重启 Dock、不改变 pairing/Wi-Fi 配置。

## 单次采集脚本

在一个连续采集中完成以下标记动作：

1. `0--1 s`：保持安静。
2. `1--2 s`：在 MIC1 对应开孔附近轻敲三次。
3. `2--3 s`：在 MIC2 对应开孔附近轻敲三次。
4. `3--5 s`：在相同距离说固定短句。

同时在 PC 录制 VB-CABLE 48 kHz WAV，用三次敲击对齐总线数据和最终 WAV。逻辑分析仪保存原始工程，并导出四线数字数据；不要只保存截图。

## 总线硬阈值

24 kHz、四槽、16-bit 的预期值：

| 指标 | 预期 | 失败信号 |
| --- | ---: | --- |
| WS/LRCK | `24.000 kHz` | 明显偏离或不稳定 |
| MCLK | `6.144 MHz` | 缺失、明显偏离或随 TX/RX 状态跳变 |
| BCLK | `1.536 MHz` | 约 `768 kHz` 表示只有 32 clocks/frame |
| BCLK / WS | `64` | 非 64 或随时间变化 |
| WS duty | `50%` | 每半帧不是 32 BCLK |
| Philips 数据相位 | WS 边沿后延迟 1 BCLK | 0-bit shift 或边界漂移 |

## PCM 解码与客观判定

按 16-bit signed、MSB-first、Philips 一位延迟解码每个 64-clock frame：

```text
slot0 = MIC1
slot1 = MIC3 / speaker AEC electrical reference
slot2 = MIC2
slot3 = unused
```

分别导出四个 24 kHz mono WAV，并使用 `tools/wifi_audio_analysis/analyze_wav.py` 计算同一套指标。

### 声道映射

- MIC1 三次敲击期间，slot0 的 20 ms RMS 相对安静基线至少提高 `10 dB`。
- MIC2 三次敲击期间，slot2 的 20 ms RMS 相对安静基线至少提高 `10 dB`。
- 若响应出现在其他 slot，则确认映射错误；若 slot2 无响应而 slot0 正常，才把 MIC2 模拟/声学硬件提升为主要嫌疑。

### 总线到 PC 一致性

- 对齐并按当前 24→48 kHz 算法转换总线目标 slot 后，与 VB-CABLE WAV 做归一化互相关。
- 在非静音有效区段，最大相关系数应至少 `0.95`；若总线 PCM 清晰而 PC 相关性低或出现额外静音段，问题位于 ESP32 DMA/Wi-Fi/Dock/Windows。
- Dock `sequenceGaps` 和 player `underflows` 必须保持 `0`；否则先解释传输连续性，不把静音段归因于 codec。

### 语音结构

- 不使用无干净参考的 STOI/PESQ。
- 以安静段为噪声基线；说话段的 20 ms RMS 中位数至少高 `10 dB`，且应呈现随音节变化的包络，而不是稳定噪声地毯。
- 300--3400 Hz 能量和谐波/共振峰结构应随说话时段明显增强；仅提高总 RMS、但谱平坦度不下降，不能判为恢复人声。
- 最终用户听感只用于确认机器指标恢复后的可用性。

## 一次采集的分支结论

| 观察 | 唯一结论方向 |
| --- | --- |
| BCLK 约 768 kHz、32 clocks/frame，或 WS/Philips 相位错误 | 确认 mixed-mode full-duplex clock/frame 为主因 |
| 时钟正确，但 GPIO14 解码的 slot0/slot2 已是雨噪 | 转向 ES7210 寄存器、MICBIAS、电源/RF、外壳和 MIC2 模拟通路 |
| GPIO14 的 slot0/slot2 清晰，PC WAV 失真/静音 | 转向 ESP32 DMA/read 错误传播、slot 打包、10 ms 帧和 PC 缓冲链 |
| slot0 响应 MIC1，slot2 不响应 MIC2，但其他 slot 响应 | 修正声道映射 |
| slot2 确实只响应环境/敲击很弱，其他数字条件正常 | MIC2 独立声学开孔、焊接或模拟通路成为主因 |

## 逻辑分析仪不可用时的唯一替代方案

不并行尝试多个固件。只构建一版“官方 RX-only golden diagnostic”镜像：

- 不创建、不启用 TX/扬声器 channel，彻底移除 mixed-mode full-duplex。
- 按 Espressif ES7210 示例创建 RX-only、四槽、16-bit Philips TDM。
- 不使用稀疏 mask；完整取得 slot0--3 原始 `int16_t`。
- 启动时读取并导出 ES7210 关键寄存器，但不输出任何 Wi-Fi/配对机密。
- 每次 I2S read 记录返回码和实际 `bytes_read`；短读/失败绝不发送旧缓冲。
- 一次录制同时保存四槽 24 kHz 原始 PCM 和最终 PC WAV，之后全部离线分析。

此替代方案需要一次刷写，但同一镜像同时验证 full-duplex、slot 映射、read 完整性和 ES7210 运行态寄存器，不再为每个猜测单独刷写。

### 已选实施方式

用户已确认没有逻辑分析仪，因此不再等待四线采集，进入这一条 RX-only 路线：

- 固件仍连接当前已认证的 Dock WebSocket，并继续输出同源的单声道 10 ms PCM，作为 PC 端链路对照。
- 四槽原始 PCM 使用临时、仅诊断固件启用的 UDP 单播发送到 Dock URL 中的 IPv4，端口默认 `8766`；不携带或记录 Wi-Fi 密码与 pairing key。
- 每次 I2S 读取为 10 ms、`240 frame × 4 slot × 2 byte = 1920 byte`；网络上拆成两个 5 ms 包。
- 每包为 24-byte `SC4D` 头加 `120 frame × 4 slot × 2 byte = 960 byte` 负载，总长 `984 byte`，低于现有 1024-byte 接收边界并避免 IP 分片。
- PC 接收器严格校验 magic、版本、类型、声道数、采样宽度、帧数和 payload 长度；记录 sequence gap，并将缺包显式补零，不能把缺包伪装成设备静音。
- 同一次采集输出四声道 WAV、slot0--3 四个 mono WAV、原始 PCM、ES7210 寄存器快照以及每槽 peak/RMS/near-zero 指标。

这里的 `slot3` 只作为完整帧和映射的控制槽；CoreS3 上对应 MIC4 未连接，不能当作第四个可用物理麦克风。

## 开始实验前的唯一外部条件

已完成确认：没有逻辑分析仪。当前外部条件改为：先在 PC 完成诊断固件构建、静态契约与 UDP 接收器测试；全部通过后才请求进入下载模式，并只刷写这一个镜像。
