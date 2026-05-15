# StackChan 设备端 MCP Tool 分发链路

更新时间：2026-05-15

## 1. 核心结论

设备端源码确认：StackChan 官方固件确实注册了设备 MCP tools，云端可通过设备已建立的 WebSocket/MQTT 会话下发 `type: "mcp"` 消息，让设备执行 LED、头部动作、提醒等工具。

但源码未发现直接可调用的设备 MCP tool：

```text
speak
tts
audio.play
play_sound
sound
self.robot.speak
self.robot.tts
```

因此：

- `create_reminder` 可以触发固定通知音 + 屏幕提醒；
- 不会朗读 message；
- 不会调用 TTS；
- 不是任意音频播放入口；
- 真正 TTS 发声仍走小智普通对话回复音频链路，不是 MCP tool。

## 2. 关键文件

```text
firmware/main/hal/hal.cpp
firmware/main/hal/hal_mcp.cpp
firmware/xiaozhi-esp32/main/application.cc
firmware/xiaozhi-esp32/main/mcp_server.cc
firmware/xiaozhi-esp32/main/protocols/protocol.cc
firmware/xiaozhi-esp32/main/protocols/mqtt_protocol.cc
firmware/xiaozhi-esp32/main/protocols/websocket_protocol.cc
firmware/main/apps/common/reminder/reminder.cpp
firmware/main/apps/common/reminder/reminder_view.hpp
```

## 3. 设备 tools 列表

StackChan 自定义 tools：

```text
self.robot.get_head_angles
self.robot.set_head_angles
self.robot.set_led_color
self.robot.create_reminder
self.robot.get_reminders
self.robot.stop_reminder
```

通用设备 tools：

```text
self.get_device_status
self.audio_speaker.set_volume
self.screen.set_brightness
self.screen.set_theme
self.camera.take_photo
```

其中 `self.audio_speaker.set_volume` 只设置音量，不播放音频。

## 4. MCP 消息分发链路

设备上线时 hello 声明：

```json
{
  "type": "hello",
  "features": {
    "mcp": true
  }
}
```

云端下发工具调用：

```json
{
  "type": "mcp",
  "payload": {
    "jsonrpc": "2.0",
    "id": 123,
    "method": "tools/call",
    "params": {
      "name": "self.robot.set_led_color",
      "arguments": {
        "red": 168,
        "green": 0,
        "blue": 0
      }
    }
  }
}
```

执行链路：

```text
MQTT/WebSocket 收到 JSON
→ Application::OnIncomingJson
→ type == "mcp"
→ McpServer::ParseMessage(payload)
→ tools/call
→ DoToolCall(id, name, arguments)
→ 参数校验
→ Application::Schedule() 主线程执行 handler
→ handler 控制 LED/舵机/reminder
→ ReplyResult()
→ Protocol::SendMcpMessage()
→ 回云端
```

## 5. LED tool

工具：

```text
self.robot.set_led_color
```

参数：

```json
{
  "red": 0,
  "green": 0,
  "blue": 168
}
```

范围：

```text
0-168
```

执行：

```cpp
GetStackChan().leftNeonLight().setColor(r, g, b);
GetStackChan().rightNeonLight().setColor(r, g, b);
```

低风险建议：

```json
{"red": 40, "green": 40, "blue": 40}
```

关灯：

```json
{"red": 0, "green": 0, "blue": 0}
```

## 6. Head / servo tool

工具：

```text
self.robot.set_head_angles
```

参数：

```json
{
  "yaw": 15,
  "pitch": 20,
  "speed": 150
}
```

范围：

```text
yaw: -128 到 128
pitch: 0 到 90
speed: 100 到 1000
```

源码建议：

- 自然交互尽量在 `±45°` 内；
- `speed=150` 较自然；
- 不要频繁大角度动作。

注意：`yaw` / `pitch` 默认 `-9999` 是“不动该轴”的 sentinel。

## 7. Reminder tool

工具：

```text
self.robot.create_reminder
```

参数：

```json
{
  "duration_seconds": 1,
  "message": "任务完成啦",
  "repeat": false
}
```

实际行为：

```text
创建计时器
→ 到期后显示 ReminderView 弹窗
→ 播放固定通知音 OGG_NEW_NOTIFICATION
```

结论：

- ✅ 会显示 message；
- ✅ 会播放固定通知音；
- ❌ 不会朗读 message；
- ❌ 不会调用 TTS；
- ❌ 不能播放任意音频。

## 8. 当前无刷可执行路径

由于 OpenClaw 没有设备云端会话 token，也没有 StackChan App 公开 messaging token，OpenClaw 不能直接伪造云端 `type:"mcp"` 消息推给设备。

当前无刷最现实路径是：

```text
小智自然对话
→ 小智云端 LLM 决策调用设备内置 tools
→ 设备执行 LED / reminder / head
```

建议下一步现场验证语句：

```text
小智，把机器人自己的灯调成蓝色。
```

```text
小智，一秒后提醒我：任务完成啦。
```

```text
小智，轻轻点一下头。
```

如果这些能触发设备 tools，后续就可以通过 Agent character / memory / prompt 引导它：当 OpenClaw MCP 返回 `should_celebrate=true` 时，调用设备 LED/reminder/head tools。

## 9. 与 OpenClaw 完成事件结合

理想无刷庆祝链路：

```text
用户问小智“检查 OpenClaw 任务”
→ 小智调用 OpenClaw MCP get_latest_completion_event
→ 返回 should_celebrate=true
→ 小智自然 TTS 回复庆祝语
→ 小智调用设备内置 set_led_color / create_reminder / set_head_angles
→ Chan 发声/提示/灯光/点头
```

限制：

- 这依赖小智云端 LLM 是否愿意同时调用外部 MCP 和设备内置 MCP tools；
- 可能需要在 App 的性格/记忆/Agent 配置中写清工具使用规则；
- 没有公开 messaging token 时，OpenClaw 不能主动直接调用设备 tools。
