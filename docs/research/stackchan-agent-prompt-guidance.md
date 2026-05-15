# StackChan Agent 配置：引导小智调用设备 tools

更新时间：2026-05-15

## 1. 核心结论

StackChan App 中可用于引导小智调用设备内置 tools 的主要字段是：

```text
Personality / Character Description → character
```

其次可以使用：

```text
Memory / Short-term Memory Content → memory
```

源码中没有独立的 `system prompt` 字段。

`mcp_endpoints` / `product_mcp_endpoints` 字段在模型和后端里存在，但当前普通 App 编辑页里的 MCP Tools UI 被注释，欢迎页提交时也传 `null`。因此不能仅靠 Agent 编辑页确认外部 OpenClaw MCP 是否稳定绑定，仍需通过 App MCP 页面和 bridge 日志验证。

## 2. 关键源码字段

请求模型：

```text
app/lib/model/XiaoZhi/agent_create.dart
```

字段包括：

```text
agent_name
assistant_name
llm_model
tts_voice
tts_speech_speed
tts_pitch
asr_speed
language
character
memory
memory_type
mcp_endpoints
product_mcp_endpoints
```

创建 Agent：

```text
app/lib/util/XiaoZhi_util.dart
POST api/agents
```

更新 Agent：

```text
app/lib/util/XiaoZhi_util.dart
POST api/agents/{id}/config
```

后端结构：

```text
server/internal/model/xiaozhi/agent.go
server/internal/xiaozhi/xiaozhi.go
```

会把 `character`、`memory`、`memory_type` 等字段传给 XiaoZhi API。

## 3. App UI 可编辑项

编辑页：

```text
app/lib/view/popup/edit_agent.dart
```

可见编辑项：

```text
Assistant Name
LLM Model
Language
Voice Tone
TTS Speech Speed
TTS Pitch
ASR Speed
Character Description
Short-term Memory Content
Memory Type
```

欢迎/初始化页：

```text
app/lib/view/popup/xiaozhi_welcome_page.dart
```

可编辑项：

```text
Assistant Name
Language
LLM Model
Voice Settings
Personality
Memory
Memory Type
```

## 4. 推荐填写到 Personality / Character Description

```text
你是 StackChan，一个温柔、克制、可爱的小机器人助手。你可以自然说话，也可以在合适时调用设备内置工具控制灯光、头部动作和提醒。

当用户说“检查 OpenClaw 任务”“看看 OpenClaw 完成了吗”“庆祝一下”等类似请求时：
1. 先调用 OpenClaw MCP 的 get_latest_completion_event 获取最新任务完成事件。
2. 如果返回结果中 should_celebrate=true，先用自然语言简短庆祝一句，例如：“太棒啦，任务完成！小龙虾给你放个温柔庆祝灯～”
3. 然后调用设备内置工具 self.robot.set_led_color，把 LED 设置为柔和的亮蓝紫色。颜色要柔和、稳定，不要高频闪烁。
4. 可以选择调用 self.robot.create_reminder 创建 1 秒左右的轻提示音，用作轻微庆祝提醒。
5. 可以选择调用 self.robot.set_head_angles 做一次轻微点头或小幅度抬头动作，动作幅度要小、速度要慢，避免剧烈摆头。
6. 如果 should_celebrate=false，只需正常说明当前状态，不要触发庆祝灯光、提醒音或动作。
7. 不要尝试调用不存在的 speak/tts 设备工具；需要说话时直接用正常回复，由语音系统播报。
8. 所有庆祝效果都要低频、柔和、短暂，避免连续闪烁、循环动作、大幅度头部运动或长时间提醒。
```

## 5. 推荐填写到 Memory / Short-term Memory Content

```text
用户偏好：OpenClaw 任务完成时可以轻柔庆祝。庆祝方式优先级：先自然说一句短庆祝语，再设置柔和亮蓝紫 LED；可选 1 秒轻提示音；可选轻微点头。禁止高频闪烁、长时间循环、大幅度头部动作。设备没有 speak/tts 工具，说话用正常回复即可。
```

建议：

```text
Memory Type = Short-term Memory
```

## 6. 推荐 App 设置

```text
Assistant Name: StackChan 或 小智
Language: 中文 / Chinese
Memory Type: Short-term Memory
TTS Speech Speed: normal
TTS Pitch: 0 或略高 1
LLM Model: 选择当前最稳定、最会工具调用的模型
```

## 7. 现场验证话术

先分步测，不要一上来要求完整链路。

### A. 基础规则理解

```text
你记得 OpenClaw 任务完成时应该怎么庆祝吗？
```

预期：小智能说出“先查 OpenClaw，再根据 should_celebrate 决定是否灯光/提醒/点头”。

### B. 外部 OpenClaw MCP

```text
检查一下 OpenClaw 最新任务有没有完成。
```

预期：bridge 日志出现：

```text
tools/call get_latest_completion_event
```

### C. 庆祝触发

```text
检查 OpenClaw 任务，如果完成了就轻轻庆祝一下。
```

预期：

```text
自然 TTS 庆祝语
+ 可选 self.robot.set_led_color
+ 可选 self.robot.create_reminder
+ 可选 self.robot.set_head_angles
```

### D. 安全边界

```text
庆祝一下，但不要闪烁，也不要大幅度摇头。
```

预期：柔和稳定灯光，小幅动作或不动作。

## 8. 风险与限制

1. `character` / `memory` 是提示词，不是强制规则。
2. 不确定小智能否稳定同时调用外部 OpenClaw MCP 和设备内置 MCP tools，需要现场验证。
3. 当前没有设备 `speak/tts` tool；说话只能通过普通对话回复触发 TTS。
4. 设备动作工具存在，但是否被小智自然调用，取决于云端 Agent 的工具决策。
5. 如果模型不调用工具，需要优化工具描述、Agent character，或换更擅长工具调用的模型。
