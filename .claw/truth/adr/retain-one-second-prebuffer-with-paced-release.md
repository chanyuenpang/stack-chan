# ADR: 保留一秒语音预缓冲并以节奏化释放取代原始突发

## Context

Local-Dock 的 24 kHz 单声道 Opus 下行以 60 ms 为一帧。已验收的 **Stable Voice Baseline — Priority 2** 使用正常 XiaoZhi `Application + AudioService` 队列和任务优先级；其已部署稳定基线 app SHA-256 为 `EA079E26012B8FF11C613A3390A2E2D910221E258CDC85608CDA78E857F24699`，同源精确 true-off 回退候选为 `B7B29DEE692FC2ECEB83087F9D7E88D0DA3B296FB9297374A620EC1A329E49BF`。用户对该基线的长期评价是整体很好、很少卡顿，但偶发长回复会出现严重的中段卡顿，因此它继续承担回退和验收基线角色，而不是被描述为绝对无卡顿。

一秒启动预缓冲实验使用固件候选 `6462218EFB78438C6E5585661DC556F56114B22897CDAF62B487CDFE4C90528E`，并由唯一 PC Dock owner 的 `STACKCHAN_LOCAL_DOCK_STARTUP_PREBUFFER_FRAMES=17` 启用约 1020 ms 的 Host 侧 Opus 缓冲。固件候选本身不产生预缓冲；17 帧行为来自 `tools/stackchan-dock/src/xiaozhi-wasapi-bridge.mjs` 的 Host 配置。

用户 HIL 表明该实验显著减少卡顿，但声音略显机器人感；同时记录到三次自然崩溃相关事件，以及回复中段完全静音约 1–3 秒后恢复/追赶的 P1 症状。现有实现会在缓冲填满后于同一 JavaScript tick 连续发送全部 17 帧，并把每个 broker `activityStop` 都变成 `tts:stop` 和下一段重新填充。事件时间线支持“原始突发与设备失去响应相关”，但没有 panic/reset reason，不能把相关性写成已证明的崩溃根因。

## Decision

保留一秒预缓冲分支作为后续音频连续性工作的主分支，但当前 17 帧原始同 tick 突发候选状态为 **未接受 / 冻结用于稳定性修复**。

后续实现必须同时满足：

1. 仍在 Host 侧保持约一秒的压缩 Opus 余量，不改变设备 codec、Opus 帧长、route、会话所有权或 XiaoZhi 队列容量。
2. 以一帧约 60 ms 的节奏释放，等待 WebSocket send callback，并在 `bufferedAmount` 超过小而有界的阈值时暂停；禁止再次部署同 tick 的 17 帧突发。
3. `activityStop` 先标记 pending stop，待队列排空再发送 `tts:stop`；短暂活动空隙中如果新帧到达，继续同一播放段，避免重新填充导致 1–3 秒中段静音。
4. 断连、detach 或 session generation 变化必须取消计时器、清空旧队列且不重放；设备侧确认通道丢失时也必须清除旧 decode/playback 数据并回到可触摸恢复状态。
5. 屏幕触摸在 Speaking 期间是显式的用户取消/切换操作，不再由枚举状态 gate 吞掉。实现必须先停止并排空 live transport、清除 decode/playback 与 Host prebuffer/session，再切到可恢复状态；延迟的断连回调不得恢复旧音频或造成第二次有副作用的状态转换。
6. 用户听感是最终门禁：连续性改善不能以持续机器人感、崩溃、长静音或不可恢复的 Speaking 状态为代价。允许的额外语音延迟上限约为 1 秒，并需同时记录字幕相对偏移。
7. PCM 插值、Opus PLC 或 WSOLA/time-stretch 不是本阶段主修复。先修正 transport pacing、stop 边界和断连生命周期；只有遥测证明孤立的单帧丢失时，才允许单独评估 Opus PLC。

## Alternatives

### 回到无预缓冲基线并放弃该分支

不作为主方向。Priority 2 继续保留为稳定回退，但用户已确认约一秒缓冲有明显连续性收益，并明确要求优先修好这条分支。

### 保留 17 帧同 tick 原始突发

拒绝继续部署。设备 decode queue 高水位和三次自然崩溃相关时间线表明风险不可接受；现有 WebSocket 发送路径也没有 backpressure 门禁。

### 扩大设备队列或提高任务优先级

当前不选择。Priority 3 已被用户 HIL 判定为明显更卡，且现有证据没有证明队列容量是根因。扩大队列还会增加延迟并掩盖 Host pacing 问题。

### 用插值、PLC 或时伸缩掩盖静音

当前不选择。线性 PCM 插值不能恢复缺失语音；Opus PLC 只适合孤立短丢帧；WSOLA 可遮蔽很短抖动但会增加 CPU、内存和机器人感，不能合理填补 1–3 秒空洞。

## Consequences

- Priority 2 的 `EA079E...F24699` 是已部署稳定验收基线；`B7B29D...E49BF` 是与当前预缓冲周期对应的精确 true-off 回退资产。两者不得与当前运行固件身份混写。
- 预缓冲固件 `646221...0528E` 仍可能保留在设备上，但 Host 运行态已经受控设为 `prebuffer_frames=0`；在节奏化实现完成离线测试和部署审计前，不得重新启用原始 17 帧突发。
- 新 Host 实现需要确定性假时钟、send callback/backpressure、mid-drain disconnect、pending stop、session generation 与默认关闭路径的合同测试。
- P1-A 与 P1-B 必须分开验收。P1-A 要持久化 Owner/broker/WebSocket/device 的断线时间线与 close code/reason，不能把任何 mid-speech 断线视为正常；现有证据尚不能证明最新一次断线的唯一原因。P1-B 允许 Speaking 期间的屏幕触摸，但它是一个有序的 cancel/switch 事务，而不是只删除条件：先关闭通道、清 decode/playback 与 Host prebuffer/session，再进入可恢复状态，并保证无旧回调恢复、无双重副作用。
- CPU 关联诊断保持默认关闭。只有受控 Owner 重启并显式传入 `-CpuCorrelationDiagnostics` 时，Host 才每 5 秒采集系统/每核心及 ChatGPT root、Owner、WASAPI broker 的数值 CPU，并记录该窗口的 broker 下行帧数和 Node 实际 WS 发送数；不保存音频、Opus、字幕文本或转写。它用于检验“风扇变大”与卡顿是否相关，不能单独证明因果。
- 机器人感的机制尚未证明。由于 Opus 字节、顺序、采样率和 codec 未被预缓冲修改，第一假设是突发和分段边界造成的调度/队列时序；若节奏化后仍存在，再单变量调查解码恢复或时伸缩。
- 当前 app-only 现场事务已将默认关闭诊断的 paced/P1 候选 `E1A191DFEBD394EB840FE03601EB9692AC986807968C60B1A40AD1B51C9760C4`（4,954,848 B）写入 `ota_0` 的 `0x20000`，并完成一次写后分块读回及独立 flash digest 校验。该事实只证明 flash 内容，不证明固件已成功联网、会话恢复或听感合格：最终硬复位后设备尚未重新认证，故受控 Owner 重启、17 帧 paced Host 启用和 HIL 均未执行。事务保留原 `ota_0` 的 5,177,344 B 备份（SHA-256 `673FC96B4AFFF273CEE8972D81FA2FAE5859E9667A0F26EAA44B4DE214B40026`）于 `.claw/runtime/xiaozhi-paced-p1-off-deploy-20260815/`；回退只能在设备恢复认证后的独立受控 app-only 事务中考虑，绝不自动回退。

<!-- state: history -->
## Decision evolution

<!-- dated: 2026-08-15 -->
### 从原始启动突发转为节奏化持续余量

最初实验仅在段首收集 17 帧，然后一次性发送并恢复即时透传。它证明约一秒余量可能改善连续性，也暴露了同 tick 压力、频繁重启段、三次崩溃相关和中段静音。保留其 HIL 价值，但不保留其释放机制。
