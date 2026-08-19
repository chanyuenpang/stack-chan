# StackChan 对话状态机修复面：speaking/listening 脆弱性与注入闸门

## 结论

StackChan 与小智的对话问题不能仅通过 `state=idle` + `xiaozhi_ready=true` 判定恢复。真实对话失败可能源于三个独立层面的状态机脆弱性：`application.cc` 中 JSON 校验缺失导致 speaking/listening 状态切换异常、`hal_device_control.cpp` 中 inject 并发闸门释放时序竞态、以及 `application.cc` 中 `tts start` 起播条件过宽导致假 speaking。已落地三版最小补丁，分别针对这三层问题。

## 长期行为 / 规则

- **对话恢复判据**：`state=idle` + `xiaozhi_ready=true` 是设备运行态正常的前提条件，但**不能作为对话能力恢复的证明**。必须通过真实三轮对话（问→答→问→答→问→答）或等价的直接语音链路证据判定恢复。详见 `docs/bisect/2026-05-23-run-sheet-r1_2.0.46plus_dialog.md` 中的 GOOD/BAD 判定标准。
- **bisect 协议**：真实对话回归 bisect 使用固定 round_id 命名 `r<轮次>_2.0.46plus_dialog_bisect`、test_protocol_id `tp<编号>_real_dialog_3turn_ctx`。首轮候选提交顺序：`57337db^ -> 57337db -> 84bf29b -> 0f66193 -> HEAD`。

### 第一版补丁：JSON 防御与 tts stop 幂等（application.cc）

- `OnIncomingJson` 中 `type` 字段缺少 `cJSON_IsString` 校验，当收到非字符串 type（如数字、null）时可能导致非法转换后状态机异常。
- `tts` 分支中 `state` 字段同样缺少 `cJSON_IsString` 校验，异常 JSON 应仅告警并安全返回，不应让状态机拖死。
- `sentence_start` 等可选字段应保持宽松，不让缺失或异常类型阻塞说话状态推进。
- `tts stop` 收尾应做最小幂等增强：无论在 Speaking 或 Listening 态都执行收尾并回合理态。

### 第二版补丁：inject 并发闸门释放时序（hal_device_control.cpp）

- `g_inject_active` 占用导致的 409 和时序误判：当上一个 inject 任务仍在释放/收尾阶段，新请求可能因闸门未清除而返回 `inject_already_active`。
- 新增状态前置检查：在进入 inject 核心逻辑前先校验当前设备状态是否允许注入。
- busy 错误码增强：让 409 返回携带更具体的失败原因，便于诊断。
- `wait_for_listening` 失败后应立即释放闸门，不留下阻塞。

### 第三版补丁：TTS 起播时序与首包音频容错（application.cc/h）

- `tts.start` 条件过宽：状态进入 speaking 时无有效音频反馈，导致"假 speaking"（设备自认为在说话，但实际无音频输出）。
- 引入 `MarkTtsStartPending()` / `ClearTtsStartPending()`：在收到 `tts state=start` 但尚未收到首包音频时的暂态窗口，避免过早判定 speaking 成功。
- `IsSpeakingAudioAccepted()`：判断当前 speaking 阶段是否有有效音频被接收。
- `OnIncomingAudio` 接收条件增强：增加首包音频时序容错，减少因网络抖动或协议延迟导致的"speaking 无反馈"。

## 关联代码

### 主锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/xiaozhi-esp32/main/application.cc` | `OnIncomingJson`（JSON 防御+tts start/stop 状态切换）、`HandleStateChangedEvent`（listening 状态进入时序）、`InitializeProtocol`（协议初始化入口）、`OnIncomingAudio`（音频接收条件）、`MarkTtsStartPending`/`ClearTtsStartPending`/`IsSpeakingAudioAccepted`/`IsTtsStartPending`（第三版补丁新增函数） |
| `firmware/xiaozhi-esp32/main/application.h` | 声明锚点：`MarkTtsStartPending()`、`ClearTtsStartPending()`、`IsSpeakingAudioAccepted()`、`IsTtsStartPending()` |
| `firmware/main/hal/hal_device_control.cpp` | `handle_inject_prompt()`、`inject_prompt_task()`、`g_inject_active` 闸门变量；第二版补丁新增状态前置检查和释放时序修复 |

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/xiaozhi-esp32/main/protocols/protocol.cc` | `IsTimeout()`；默认 120s incoming timeout，不适合做 speaking watchdog |
| `firmware/xiaozhi-esp32/main/audio/audio_service.cc` | `InjectPcmFrameToSendQueue()`、音频注入链路 |
| `firmware/xiaozhi-esp32/main/device_state_machine.cc` | XiaoZhi 合法状态迁移边界 |
| `docs/bisect/2026-05-23-run-sheet-r1_2.0.46plus_dialog.md` | 首轮对话回归 bisect 执行单 |
| `docs/bisect/2026-05-23-artifact-map.md` | 候选产物映射表 |
| `docs/bisect/2026-05-23-preflight-r1_2.0.46plus_dialog.md` | bisect preflight 清单与 STOP 规则 |

## 已知陷阱

- **不要把 `state=idle` + `xiaozhi_ready=true` 当作对话恢复结论**。这是设备运行态正常的前提，不是证明。真实对话恢复必须看是否形成至少三轮自然问答（问→答→问）。
- **不要只改 `application.cc` 而忽略 `hal_device_control.cpp` 的 inject 闸门**。第一版 JSON 防御和第三版 TTS 时序补丁都在 application.cc，但第二版证明 inject 闸门释放时序也是一个独立的失败面。
- **不要在 inject 闸门释放前发送新请求**。`g_inject_active` 有释放时序窗口，前一次 inject 的收尾阶段仍会锁住新请求；应该在确认上一个 inject 完全收尾（状态回到 idle/listening）后再发起。
- **不要只读 `/dev/status` 替代真实对话验证**。设备可以返回正常状态但实际无法形成有效对话。`/dev/status` 只能确认设备活着、状态机未卡住，不能证明上游 TTS/ASR 链路正常。
- **不要默认 `speaking` 状态代表真正说话**。第三版补丁的引入正是为了解决"假 speaking"——设备状态机进了 speaking 但实际无音频输出。仅凭 `speaking` 出现不足以证明用户能听到回复。
- **不要混合补偿 speaking watchdog 与 JSON 防御**。speaking 长期卡住的根因可能是 tts stop 丢失、状态机不回落、或 JSON 解析异常。三版补丁各自解决不同问题，不应混为一谈。

## 真实调用链路

1. HTTP `/dev/inject_prompt` 或 XiaoZhi 上行音频触发 XiaoZhi listening → speaking 切换。
2. `application.cc::OnIncomingJson()` 解析服务端 JSON，处理 `type/state` 字段：
   - 第一版补丁：缺乏 `cJSON_IsString` 校验 → 异常 JSON 导致状态机异常。
   - 第三版补丁：`tts start` 条件过宽 → 首包音频未到即进入 speaking。
3. `application.cc::HandleStateChangedEvent()` 切换 listening/speaking，调用 `SendStartListening` + `EnableVoiceProcessing` 时序。
4. `application.cc::OnIncomingAudio()` 接收服务端音频：第三版补丁增强时序容错，减少首包丢失。
5. `hal_device_control.cpp::inject_prompt_task()`（当使用 inject 路径时）：
   - 第二版补丁：修复 `g_inject_active` 释放时序，避免 409/activating/idle 竞态。
6. `tts stop` JSON 触发 speaking 回落：第一版补丁增强幂等，确保 Speaking/Listening 态都能收尾回合理态。

## 验证标准

后续修改对话状态机时，至少验证：

- 用真实三轮对话验证，不接受仅凭 `/dev/status` + `ready/idle` 判定恢复。
- 全仓搜索 `application.cc` 中 `OnIncomingJson` 对 `type/state` 字段的所有引用，确认已使用 `cJSON_IsString` 做类型校验。
- `tts stop` 收尾路径覆盖 Speaking 和 Listening 两种态，不留下因状态不匹配而未执行的路径。
- `g_inject_active` 释放路径覆盖 `wait_for_listening` 失败、正常完成、超时三种退出场景，确保无不释放窗口。
- 第三版 `MarkTtsStartPending` / `ClearTtsStartPending` / `IsSpeakingAudioAccepted` 逻辑在正常 tts start→audio→stop 序列和缺少首包 audio 的两种场景下都行为正确。
- bisect 协议按执行单操作：双盲判定、ready/idle 禁用、每步记录 app_version 前保证 force 已生效、STOP 规则触发时仅记录中止不判 GOOD/BAD。

## 关键检索词

- `application.cc`
- `OnIncomingJson`
- `OnIncomingAudio`
- `HandleStateChangedEvent`
- `InitializeProtocol`
- `cJSON_IsString`
- `tts state=start`
- `tts state=stop`
- `MarkTtsStartPending`
- `ClearTtsStartPending`
- `IsSpeakingAudioAccepted`
- `IsTtsStartPending`
- `hal_device_control.cpp`
- `handle_inject_prompt`
- `inject_prompt_task`
- `g_inject_active`
- `inject_already_active`
- `wait_for_listening`
- `state=idle`
- `xiaozhi_ready=true`
- `ready/idle` 禁用红线
- `57337db`
- `84bf29b`
- `0f66193`
- `docs/bisect/2026-05-23-run-sheet-r1_2.0.46plus_dialog.md`
- `round_id = r1_2.0.46plus_dialog_bisect`
- `test_protocol_id = tp1_real_dialog_3turn_ctx`
- `force=0`
