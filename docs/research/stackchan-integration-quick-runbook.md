# StackChan / XiaoZhi 快速联调 Runbook

更新时间：2026-05-15

## 当前主线

StackChan App 绑定设备不再走 `xiaozhi.me` 控制台 / assets-generator / messaging token 路径。

当前无刷主线是：

```text
StackChan App MCP 页面提供 endpoint
→ OpenClaw bridge 连接小智 MCP
→ 小智调用 get_latest_completion_event
→ OpenClaw 返回 should_celebrate=true
→ 小智自然 TTS 庆祝
→ 小智调用内部硬件 MCP 做单次柔和灯光 / 可选 reminder / 可选小幅点头
```

不要再要求用户登录 `xiaozhi.me` 控制台找 `assets-generator` 或 `messaging token`。

## 1. 启动 OpenClaw MCP bridge

确认没有旧进程：

```bash
ps -ef | grep -E 'bridge.mjs|start-bridge-debug' | grep -v grep
```

若看到旧版 3 工具 bridge，先杀掉旧 PID。

启动新版 bridge：

```bash
source /home/yankeeting/.openclaw/.projects/stack-chan/secrets/xiaozhi-mcp-endpoint-token.env
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan/tools/xiaozhi-mcp-bridge
npm run start:debug
```

预期：

```text
WebSocket connected
tools/list -> 5 tools
ping -> result
```

5 个 OpenClaw 工具应为：

```text
ping
echo
get_time
get_plan_status
get_latest_completion_event
```

## 2. 写入完成事件

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan/tools/xiaozhi-mcp-bridge

node scripts/record-completion-event.mjs \
  --plan /home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap-v2.json \
  --event-type task_completed \
  --task-id 4
```

本地验证：

```bash
node bridge.mjs --local-call get_latest_completion_event '{}'
node bridge.mjs --local-call get_plan_status '{}'
```

预期：

```text
should_celebrate=true
isError=false
```

## 3. 配置 StackChan Agent 提示词

在 StackChan App 的：

```text
Personality / Character Description
```

里写入庆祝规则。重点：

```text
当 OpenClaw MCP 返回 should_celebrate=true 时：
1. 先自然说一句短庆祝语；
2. 调用 self.robot.set_led_color，把 LED 单次设置为柔和蓝紫/青蓝色；
3. 可选调用 self.robot.create_reminder 创建 1 秒轻提示音；
4. 可选调用 self.robot.set_head_angles 做一次小幅点头；
5. 不要闪光、不要跑马灯、不要连续快速变色、不要大幅动作。
```

详细可复制文本见：

```text
docs/research/stackchan-agent-prompt-guidance.md
```

## 4. 让小智调用 OpenClaw 工具

对 Chan 说：

```text
小智，检查 OpenClaw 最新任务有没有完成。
```

或：

```text
小智，检查 OpenClaw 任务，如果完成了就轻轻庆祝一下。
```

bridge 日志应出现：

```text
tools/call get_latest_completion_event
```

或：

```text
tools/call get_plan_status
```

## 5. 预期庆祝效果

推荐最终效果：

```text
小智自然 TTS 说一句庆祝语
+ LED 单次柔和定色
+ 可选固定提示音 reminder
+ 可选一次小幅点头
```

推荐 LED 颜色：

```json
{"red": 40, "green": 20, "blue": 80}
```

或：

```json
{"red": 30, "green": 60, "blue": 100}
```

提醒：

```json
{"duration_seconds": 1, "message": "任务完成啦", "repeat": false}
```

轻微点头：

```json
{"yaw": 0, "pitch": 20, "speed": 150}
```

## 6. 已确认限制

设备 MCP 没有直接可调用的：

```text
speak
tts
audio.play
play_sound
sound
self.robot.speak
self.robot.tts
```

所以庆祝语走小智普通对话 TTS，不走设备 MCP tool。

`self.robot.create_reminder` 的行为是：

```text
显示 ReminderView 弹窗
+ 播放固定通知音 OGG_NEW_NOTIFICATION
```

它不会朗读 message，也不能播放任意音频。

LED 实测限制：

```text
调整灯光耗时较长；
一次只能设置一个颜色；
不适合闪光、跑马灯、多次快速变色。
```

因此不要设计“闪光灯效”。庆祝灯光应为单次柔和定色。

## 7. 常见问题

### App 只显示 3 个 OpenClaw 工具

最可能是旧 bridge 进程还活着。检查并 kill 旧进程。

### WebSocket 1006

历史根因之一是没有正确响应顶层 JSON-RPC `method=ping`。新版 bridge 已修复。

### tools/list=5 但没有 tools/call

需要明确对小智说：

```text
请调用 get_latest_completion_event 工具。
```

同时看小智聊天记录和 bridge debug 日志，确认小智是否真的决定调用工具。

### 小智没有调用内部硬件 MCP

尝试先单独验证：

```text
小智，把机器人自己的灯调成蓝色。
```

```text
小智，一秒后提醒我：任务完成啦。
```

```text
小智，轻轻点一下头。
```

如果单独都能调用，再测试 OpenClaw 完成状态联动。

## 8. 历史路线：messaging token / assets-generator

公开 `xiaozhi.me` 控制台里存在过 `assets-generator` / messaging token 线索，但 StackChan App 绑定设备不要求用户注册/登录 `xiaozhi.me`，App 也没有公开该入口。

因此该路线仅作为历史研究记录，不作为当前 StackChan 无刷主线。
