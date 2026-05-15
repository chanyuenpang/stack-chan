# StackChan / XiaoZhi MCP 资料整理

更新时间：2026-05-15

> 本文档整理当前 StackChan × XiaoZhi × OpenClaw 庆祝链路的本地研究结论、外部资料线索和操作入口。目标是在**不烧录固件**的前提下，让 OpenClaw 任务完成后，StackChan/小智能读取完成事件，并在 Chan 端发声/提示、灯光和动作庆祝。

## 1. 当前目标与边界

### 目标

- OpenClaw 任务/plan 完成后，StackChan/小智能读取完成事件。
- 小智/Chan 端发声或提示。
- 可选：LED、头部小幅动作。
- 期望音效是“胜利/庆祝”效果；若官方固件没有任意音频播放入口，则优先用小智自然 TTS 或内置提示音。

### 边界

- 用户明确边界：**不要烧录/擦除/OTA/切换固件**。
- 连接小智、真实联调、低风险设备验证是目标所需动作，可以主动推进。
- Plan 文件只能由主 Agent 使用 `plan_write` / `plan_edit` 修改，subagent 不碰 plan。
- 音效目标是 **小智/Chan 端发声或提示**，不是本机播放音效。

## 2. MCP endpoint：小智调用 OpenClaw 工具

### endpoint 形态

官方前端和实测确认，小智外部 MCP endpoint 形态为：

```text
wss://api.xiaozhi.me/mcp/?token=<MCP endpoint token>
```

用途：

```text
小智 / Agent → 调用 OpenClaw bridge 暴露的 MCP 工具
```

这不是 OpenClaw 主动调用设备工具的通道。

### 当前 bridge 工具

新版 bridge 暴露 5 个工具：

```text
ping
echo
get_time
get_plan_status
get_latest_completion_event
```

其中：

- `get_plan_status`：读取脱敏 plan 状态快照。
- `get_latest_completion_event`：读取最新完成事件，并计算 `should_celebrate`。

### 已验证结果

- WebSocket connected。
- `initialize` 成功。
- `tools/list` 成功，工具数为 5。
- `ping` 保活正常。
- 小智真实调用过：

```text
tools/call get_plan_status
```

bridge 返回 result，`isError=false`。

### 断线 / 3 工具问题根因

曾出现 App 只看到 3 个工具或连接混乱。诊断确认根因是旧 bridge 进程仍存活：

```text
旧 bridge：3 个工具
新 bridge：5 个工具
```

小智 MCP 服务器允许同 endpoint 多个 WebSocket 连接同时存在，不会自动踢掉旧连接。App/云端可能路由到旧进程，导致工具数量异常。

处理方式：

```bash
ps -ef | grep -E 'bridge.mjs|start-bridge-debug' | grep -v grep
kill <旧 bridge PID>
```

当前新 bridge 状态：

- 旧 PID `1722362` 已 kill。
- 新 bridge PID：`2111506`。
- 日志：`/tmp/xiaozhi-mcp-bridge.log`。
- tools/list=5。
- 无 `1006`。

启动方式：

```bash
source /home/yankeeting/.openclaw/.projects/stack-chan/secrets/xiaozhi-mcp-endpoint-token.env
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan/tools/xiaozhi-mcp-bridge
npm run start:debug
```

## 3. completed event / plan_status.json

bridge 只读脱敏状态快照：

```text
StackChan/tools/xiaozhi-mcp-bridge/state/plan_status.json
```

可通过脚本写入完成事件：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan/tools/xiaozhi-mcp-bridge

node scripts/record-completion-event.mjs \
  --plan /home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap-v2.json \
  --event-type task_completed \
  --task-id <done-task-id>
```

验证：

```bash
node bridge.mjs --local-call get_latest_completion_event '{}'
node bridge.mjs --local-call get_plan_status '{}'
```

快照只包含白名单字段：

- plan id/title/status
- task id/title/status
- 统计计数
- latest completion event
- `should_celebrate`
- TTL/age

不包含：

- token
- session id
- path
- task detail
- subagent 日志

## 4. messaging token：OpenClaw/网页调用设备工具

### 用途

messaging token 用于小智官方网页的设备 messaging API：

```text
POST https://xiaozhi.me/api/messaging/device/tools/list
POST https://xiaozhi.me/api/messaging/device/tools/call
Authorization: Bearer <messaging token>
```

用途：

```text
网页 / OpenClaw → 主动列出或调用 Chan 设备 MCP tools
```

这和 MCP endpoint token 不同。

### 已知获取路径与当前疑点

公开 xiaozhi.me 前端 JS 中确认过一条路径：

```text
登录 https://xiaozhi.me
→ 控制台 / Console
→ 智能体 / Agents
→ 管理设备 / Manage Devices
→ 设备页
→ 主题配置 / Theme Settings
→ 自定义 / Customize
→ 打开 https://xiaozhi.me/tools/assets-generator/?token=...
```

但用户澄清：自己没有注册 `xiaozhi.me`；StackChan 绑定后，小智能力像是由 M5Stack App 自动注册/内置，或者并非公开 xiaozhi.me 账号体系。用户只能从 StackChan App 设置性格、音色等。

因此，这条 `xiaozhi.me` 控制台路径**不能再假设适用于 M5Stack 版 StackChan App 绑定设备**。后续需要从以下入口重新确认：

- M5Stack StackChan App 的网络请求/页面入口；
- 官方 StackChan 文档；
- M5Stack 社区帖子；
- 设备固件/日志中的实际云端地址与账号体系；
- App 是否内嵌生成或持有类似 messaging token。

生成 token 的接口：

```http
POST https://xiaozhi.me/api/agents/generate-messaging-token
```

请求体：

```json
{
  "macAddress": "<device mac>"
}
```

assets-generator 页面会从 URL query 读取 `token`，作为 Bearer 调用：

```text
/api/messaging/device/tools/list
/api/messaging/device/tools/call
```

### 本地探测脚本

已实现：

```text
tools/xiaozhi-mcp-bridge/scripts/probe-device-messaging-tools.mjs
```

支持：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan/tools/xiaozhi-mcp-bridge

export XIAOZHI_MESSAGING_URL='https://xiaozhi.me/tools/assets-generator/?token=...'
npm run probe:messaging:list
```

或：

```bash
export XIAOZHI_MESSAGING_TOKEN='<assets-generator token>'
npm run probe:messaging:list
```

脚本会筛选候选发声工具：

```text
audio
tts
speak
play
sound
reminder
notification
broadcast
```

默认只 `tools/list`，不调用设备动作。

## 5. 小智/Chan 端发声能力

### 当前确认可行：自然对话 TTS

最稳路径：

```text
用户对 Chan 说话
→ 小智调用 OpenClaw MCP
→ get_latest_completion_event 返回 should_celebrate=true
→ 小智自然回复庆祝语
→ Chan 端 TTS 播放
```

示例话术：

```text
小智，调用 get_latest_completion_event 检查最新完成事件。
如果 should_celebrate 是 true，就用开心的语气说：任务完成啦，Yop 太强了，开香槟咯！
```

### 可作为提示音：create_reminder

设备 MCP 中有：

```text
self.robot.create_reminder
```

参数：

```json
{
  "duration_seconds": 1,
  "message": "任务完成啦，庆祝一下！",
  "repeat": false
}
```

源码显示 reminder 触发后：

- 显示 ReminderView。
- 播放 `OGG_NEW_NOTIFICATION`。

不保证朗读 message。

### 可调音量

设备通用工具中有：

```text
self.audio_speaker.set_volume
```

例如：

```json
{ "volume": 60 }
```

### 未发现：任意自定义音频播放工具

未发现官方设备 MCP 暴露：

```text
play_audio
play_sound
tts_say
music_play
assets_play
```

固件内部有：

```text
AudioService::PlaySound(ogg)
```

但这是固件内部调用，不是 MCP 工具。

因此，在不烧录固件前提下，目前没有确认的“播放任意 FF 原曲文件”的官方入口。

## 6. 主动让小智说话：公开 API 现状

联网搜索和本地源码均未找到公开稳定 API 可以直接：

```text
OpenClaw → POST 一段文本 → 小智/Chan 主动 TTS 说出来
```

未找到稳定公开接口：

```text
send message
conversation API
chat API
push notification
TTS broadcast
```

社区也有同样需求：

- 后台主动唤醒设备。
- 定时提醒后主动播报。
- 温度阈值自动提醒。
- 开机后主动播报。
- 传入一段文字让设备讲出来。

相关线索：

- `78/xiaozhi-esp32#1779`：现有协议缺少服务器主动唤醒设备能力。
- `78/xiaozhi-esp32#1939`：`speak_request / speak_ready` 主动唤醒协议 PR，仍是 Open。
- `xinnan-tech/xiaozhi-esp32-server` 相关 issue：主动推送/主动播报需求。

### speak_request 方向

最接近官方未来路线：

```text
服务器通过 MQTT 主动唤醒设备
→ 设备回复 speak_ready
→ 建立/复用 UDP 音频通道
→ 服务端推音频
```

限制：

- PR 仍 Open。
- 非当前稳定官方公共 API。
- 主要适配 MQTT+UDP。
- WebSocket 空闲断开场景不一定可用。

## 7. 设备动作/灯光工具

本地源码确认设备 MCP 注册了：

```text
self.robot.get_head_angles
self.robot.set_head_angles
self.robot.set_led_color
self.robot.create_reminder
self.robot.get_reminders
self.robot.stop_reminder
```

推荐低风险庆祝动作：

1. `get_head_angles` 记录原始角度。
2. `set_led_color` 柔和紫/蓝一次。
3. 小智自然 TTS 说庆祝语。
4. `set_head_angles` 小幅 pitch 点头一次。
5. 回原位。
6. `set_led_color` 关灯。

禁止：

- 高频闪烁。
- 连续舵机动作。
- 大幅 yaw/pitch。
- 长时间循环。
- 未确认的任意音频注入。

## 8. UIFlow2 StackChan 文档线索

用户提供链接：

```text
https://docs.m5stack.com/zh_CN/uiflow2/stackchan/program
```

初步判断：这是 M5Stack UIFlow2 的 StackChan 编程文档，可能涉及 UIFlow2 模式下的程序推送、动作、灯光、扬声器等能力。

需要进一步确认：

- 是否需要烧录/切换 UIFlow2 固件。
- 是否会替换当前官方小智固件并破坏 App 绑定。
- 是否支持 speaker/audio/play WAV/MP3/TTS。
- 是否支持 servo/head/LED。

在确认之前，不应将 UIFlow2 作为当前无刷固件主路线。

## 9. 参考项目：ha-mcp-for-xiaozhi

用户提供链接：

```text
https://github.com/c1pher-cn/ha-mcp-for-xiaozhi/blob/main/README.md
```

该项目定位：

```text
Home Assistant MCP server for 小智 AI，直连小智 AI 官方服务器。
```

它不是设备端发声 API，而是一个成熟的“小智外部 MCP endpoint”实现，和我们的 OpenClaw bridge 属于同一方向：

```text
小智 → MCP endpoint → 外部系统工具
```

### 对当前项目有用的点

1. 小智 MCP endpoint 确实可以接入第三方系统，并被小智调用。
2. 配置方式是填写“小智 MCP 接入点地址”，然后选择要公开的 MCP/tools。
3. 工具是否暴露，取决于外部系统给小智公开了哪些能力。
4. 调试时应优先看小智聊天记录，确认小智是否真的决定调用工具。
5. 小智接入点页面刷新后可查看 endpoint 状态。
6. README 明确提到：不同版本 Home Assistant 暴露工具差异明显；这说明“工具列表变化/缓存/版本差异”是正常排查点。
7. README 提到灯光控制、音乐控制可能与小智内置屏幕/音乐控制逻辑冲突；这对我们后续测试 Chan 设备工具时很重要。

### 对我们 MCP bridge 的启发

- 我们目前只暴露 5 个工具，是正常的；要有“正式工具”，必须在 bridge 里明确实现并通过 `tools/list` 暴露。
- 小智是否调用工具，不只看 App 是否显示工具，还要看聊天记录和 bridge debug 日志。
- 如果小智把用户意图路由给内置音乐/屏幕能力，而不是外部 MCP 工具，可能需要调整工具名称、description 或提示词。
- Home Assistant 项目可以作为“成熟 MCP 长连接实现”的参考，需要进一步看其代码如何处理：
  - WebSocket 重连；
  - ping/pong；
  - tools/list；
  - tools/call；
  - 日志与状态。

### 与当前目标的关系

这个项目不能直接让 Chan 主动播放胜利音效，但能证明：

```text
小智 → 外部 MCP → 控制/查询外部系统
```

这条链路是官方实际可用路线。

我们的 OpenClaw bridge 也应继续沿这个方向稳定化。

## 10. 当前下一步

当前 v2 计划已从 `assets-generator / messaging token` 路线收敛到 StackChan App 官方可用路径：

```text
StackChan App MCP endpoint
→ OpenClaw bridge
→ 小智调用 get_latest_completion_event
→ OpenClaw 返回 should_celebrate=true
→ 小智自然 TTS 庆祝
→ 小智调用内部硬件 MCP 做单次柔和灯光 / 可选 reminder / 可选小幅点头
```

当前已确认：

1. StackChan App 不要求用户注册/登录 `xiaozhi.me` 控制台；不要再要求用户去控制台找 `assets-generator / messaging token`。
2. 设备没有 `speak / tts / audio.play / play_sound` MCP tool；庆祝语走小智普通对话 TTS。
3. `create_reminder` 只触发固定通知音 + 屏幕提醒，不朗读 message。
4. LED 实测不适合闪光/跑马灯/连续快速变色；庆祝灯效应为单次柔和定色。
5. Arduino/BSP 能实现 WAV/灯光/舵机，但需要上传草图/替换固件，只作为 B 计划。

当前可执行工作：

1. 在 StackChan App 的 `Personality / Character Description` 与 `Memory` 中写入庆祝规则。
2. 通过 `record-completion-event.mjs` 写入 `should_celebrate=true` 测试事件。
3. 对 Chan 说：“小智，检查 OpenClaw 任务，如果完成了就轻轻庆祝一下。”
4. 观察 bridge 日志是否出现 `tools/call get_latest_completion_event`。
5. 观察 Chan 是否自然 TTS、单次柔和亮灯、可选提示音/小幅点头。
