# Codex Voice 输入录音客观分析（2026-08-07）

## 样本与可复核资产

- 用户原始录音：`录音.m4a`，SHA-256 `8A6213980A84AFFB5410E7E922B0EDA0F0CCC1183157D91E062FD557FE8DB9C3`；未复制到仓库。
- 解码 PCM：`recording-current-48k-stereo.wav`，`48 kHz`、stereo、约 `9.643 s`。
- 波形与频谱指标：`analysis/waveform-analysis.json`。
- 诊断图：`analysis/recording-current-48k-stereo-ch0-diagnostic.png` 与 `analysis/recording-current-48k-stereo-ch1-diagnostic.png`。
- 与已确认清晰的 RX-only MIC1 对比：`continuity-comparison.json`。

原始 M4A 共 `452` 个 AAC packet，PTS 连续。因此容器时间线本身没有断裂；下述数字零已经存在于 Windows Recorder 收到的 PCM 中。解码后的两个声道逐样本完全一致，只代表 mono 数据被复制成 stereo，不代表双麦克风同时采集。

## 决定性结果

| 指标 | 当前 Codex Voice 录音 | 清晰 RX-only MIC1 基准 |
| --- | ---: | ---: |
| 时长 | `9.643 s` | `33.43 s` |
| 10 ms 数字静音块比例 | `54.77%` | `0.39%` |
| 内部数字零段数 | `106` | `8` |
| 内部数字零合计 | `5.26 s` | `0.13 s` |
| 最长内部数字零 | `200 ms` | `30 ms` |
| 相邻样本完全相同 | `64.51%` | `2.82%` |
| RMS / peak | `226 / 3518` | `1403 / 32768` |
| `300--3400 Hz` 功率占比 | `85.54%` | `87.0%` |
| `0--80 Hz` 功率占比 | `0.85%` | `0.88%` |

结论：这不是普通房间静音，而是 PCM 链路中的数字零填充。频谱的人声结构仍接近正确 MIC1 基准，所以证据不支持“再次选错物理麦克风”作为简单解释；正确麦克风内容存在，但超过一半的时间被后续数字零破坏。不同录音的说话内容、距离和时长不同，因此绝对 RMS/peak 不能作为校准后的麦克风灵敏度比较。

没有时间对齐的干净参考语音，不能合法计算 STOI/PESQ；本目录只证明波形连续性故障和频谱边界，不直接给出可懂度评分。

## 对第一版路线的影响

用户决定优先交付周期可控、可用的第一版。当前不再以高质量全双工或 AEC 为第一版目标，而采用可靠半双工：Listening 只开麦克风输入，Codex 回复开始后关闭输入并开启扬声器，回复结束且播放队列排空后再恢复麦克风。PC `24 kHz -> 48 kHz` 使用跨帧保持状态的流式线性插值，避免逐样本复制；该转换不负责补回已经丢失的 PCM。

截至记录时，半双工候选通过 Dock Node `39/39`、Dock Python `19/19`、固件契约 `45/45`、语法检查和 ESP-IDF `5.5.5` 完整构建。为避免回复结束控制消息丢失后永久停在 Speaking，最终候选还在连续 `3 s` 无扬声器 PCM 时进入 `400 ms` 尾窗并恢复 Listening。候选 `firmware/build-wifi-audio-short/stack-chan.bin` 为 `3,826,032 bytes`（`0x3A6170`），SHA-256 `1EE57BBC9AF1277C4A9DE9539E3DACDBD7CD9BBE0CA1D07166E94D2C0A5E1173`。该 app 已仅写入 `ota_0@0x20000`，写入 hash 和独立 verify 均通过；但工具 hard reset 后应用尚未重连，仍等待实体 RST 和物理联合验收，不能标记为生产可用。摸头/舵机相关整机掉电 Bug 也未修复。
