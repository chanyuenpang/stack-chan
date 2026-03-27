# 小艺智能体接入问题分析

## 一、配置信息

### 1.1 已完成的配置

**插件安装**：
```
openclaw plugins install @ynhcj/xiaoyi@latest
```
- 版本：2.5.7
- 安装路径：`/home/yankeeting/.openclaw/extensions/xiaoyi/`

**openclaw.json 配置**：
```json
{
  "channels": {
    "xiaoyi": {
      "enabled": true,
      "ak": "a2a87037bd114fb3a14376bf0247d06e",
      "sk": "123F996E8EEE986714F33E5A3F25883EB7B3757C08BB5692D377AA0500C20378",
      "agentId": "agent258db74e8ad648d9b02e41e3d8396e68",
      "apiId": "webhook3a1c566b1ce3432a852",
      "debug": true
    }
  },
  "bindings": [
    {
      "agentId": "xiaoyi",
      "match": {
        "channel": "xiaoyi"
      }
    }
  ],
  "messages": {
    "queue": {
      "mode": "steer"
    }
  }
}
```

**小艺 Agent 配置**：
- ID: `xiaoyi`
- 与飞书 agent 共享记忆和 workspace
- 排除了飞书专有技能（feishu-doc, feishu-drive, feishu-file-sender, feishu-markdown-helper, feishu-perm, feishu-wiki）

### 1.2 华为小艺开放平台信息

- **Webhook URL**: `https://hag.cloud.huawei.com/open-ability-agent/v1/agent-webhook`
- **apiId**: `webhook3a1c566b1ce3432a852`
- **参考文档**: https://developer.huawei.com/consumer/cn/doc/service/trigger-webhook-0000002525203283

---

## 二、发现的问题

### 2.1 核心问题：只能一问一答

**现象描述**：
- 用户发一条消息，agent 只能回复一条消息
- agent 派遣 subagent 后，主 agent 进入 `onIdle` 状态
- `onIdle` 发送 `final=true` 的 A2A 响应，结束对话
- subagent 完成后的报告内容，用户无法收到

**问题根因**：
`onIdle` 过早触发，在主 agent 派遣 subagent 后就发送了 `final=true`，导致会话提前结束。

### 2.2 缺少主动推送能力

**现象描述**：
- subagent 完成后，无法主动向用户推送消息
- 无法触发手机通知提醒

**期望行为**：
- subagent 完成后，通过 webhook 推送结果
- 同时触发手机通知

---

## 三、代码分析

### 3.1 消息发送机制

小艺插件有两种消息发送方式：

#### 方式一：WebSocket A2A 响应（当前主要使用）

**文件**: `extensions/xiaoyi/dist/xy-reply-dispatcher.js`

**流程**:
```
deliver() → 累积文本 + 发送 reasoningText（实时显示）
    ↓
onIdle() → 发送 A2A 响应 (final=true) → 结束对话
```

**关键代码** (`xy-reply-dispatcher.js:130-161`):
```javascript
onIdle: async () => {
    // ...
    if (hasSentResponse && !finalSent) {
        await sendStatusUpdate({ state: "completed" });
        await sendA2AResponse({
            text: accumulatedText,
            append: false,
            final: true,  // ← 这个会结束对话
        });
        finalSent = true;
    }
}
```

**问题**：`final=true` 表示任务完成，客户端会关闭会话，后续消息无法送达。

#### 方式二：Webhook 推送（需要激活）

**文件**: `extensions/xiaoyi/dist/push.js`

**触发条件**:
```javascript
isConfigured() {
    return Boolean(
        this.config.apiId?.trim() &&
        this.config.pushId?.trim() &&  // 从用户消息动态提取
        this.config.ak?.trim() &&
        this.config.sk?.trim()
    );
}
```

**推送方法**:
```javascript
async sendPush(text, pushText) {
    // text: 发送给客户端的内容
    // pushText: 手机通知的内容
    const payload = {
        jsonrpc: "2.0",
        id: messageId,
        result: {
            apiId: this.config.apiId,
            pushId: this.config.pushId,
            pushText: pushText,
            kind: "task",
            artifacts: [{ parts: [{ kind: "text", text }] }],
            status: { state: "completed" }
        }
    };
    // POST to https://hag.cloud.huawei.com/open-ability-agent/v1/agent-webhook
}
```

**pushId 获取机制**:
- `xy-bot.js:64-73`: 从用户消息中自动提取 `push_id`
- 存储在 `configManager` 中，按 sessionId 缓存
- 后续推送时使用缓存中的 pushId

### 3.2 消息流转完整路径

```
用户消息 → WebSocket → xy-bot.js:handleXYMessage()
                            ↓
                    提取 pushId → 缓存到 configManager
                            ↓
                    创建 ReplyDispatcher
                            ↓
                    dispatchReplyFromConfig() → agent 处理
                            ↓
                    deliver() → sendReasoningTextUpdate() [WebSocket]
                            ↓
                    onIdle() → sendA2AResponse(final=true) [WebSocket] ← 问题点
```

### 3.3 关键文件说明

| 文件 | 功能 |
|------|------|
| `channel.js` | OpenClaw Channel 插件定义，包含 outbound.sendText |
| `xy-bot.js` | 消息入口处理，提取 pushId |
| `xy-reply-dispatcher.js` | 响应分发器，处理 deliver/onIdle |
| `xy-formatter.js` | A2A 消息格式化 |
| `push.js` | Webhook 推送服务 |
| `websocket.js` | 双 WebSocket 连接管理 |
| `config-manager.js` | pushId 缓存管理 |

---

## 四、解决方案

### 4.1 方案一：修改 onIdle 逻辑（临时方案）

**修改点**: `extensions/xiaoyi/dist/xy-reply-dispatcher.js`

**思路**: 
- 不在 `onIdle` 中发送 `final=true`
- 改为发送 `final=false`，保持会话活跃
- 通过 webhook 推送最终结果

**风险**: 
- 插件更新后会被覆盖
- 需要测试对其他场景的影响

### 4.2 方案二：使用 OpenClaw 的 message 工具

**思路**:
- Agent 通过 `message` 工具发送消息
- 触发 `outbound.sendText` → 调用 webhook 推送
- 需要确认 OpenClaw 是否支持在 subagent 中调用

### 4.3 方案三：联系插件开发者

**建议**:
- 向 `@ynhcj/xiaoyi` 插件开发者反馈问题
- 请求支持异步推送和多轮对话场景

---

## 五、配置检查清单

### 5.1 必需配置项

| 配置项 | 说明 | 状态 |
|--------|------|------|
| `ak` | Access Key | ✅ 已配置 |
| `sk` | Secret Key | ✅ 已配置 |
| `agentId` | Agent ID | ✅ 已配置 |
| `apiId` | Webhook API ID | ✅ 已配置 |
| `pushId` | 从用户消息动态提取 | ✅ 自动 |

### 5.2 可选配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `wsUrl1` | 主 WebSocket 服务器 | `wss://hag.cloud.huawei.com/openclaw/v1/ws/link` |
| `wsUrl2` | 备用 WebSocket 服务器 | `wss://116.63.174.231/openclaw/v1/ws/link` |
| `debug` | 调试日志 | `false` |
| `taskTimeoutMs` | 任务超时时间 | `3600000` (1小时) |

---

## 六、调试方法

### 6.1 查看日志

```bash
# 查看 gateway 进程
ps aux | grep openclaw

# 查看内存索引日志
cat /home/yankeeting/.openclaw/logs/memory-index.log | tail -100

# 重启 gateway
openclaw gateway restart
```

### 6.2 关键日志标识

| 标识 | 含义 |
|------|------|
| `[BOT]` | 消息处理入口 |
| `[DELIVER]` | 消息投递 |
| `[ON_IDLE]` | 空闲状态触发 |
| `[PUSH]` | Webhook 推送 |
| `[A2A_RESPONSE]` | A2A 响应发送 |
| `[REASONING_TEXT]` | 推理文本更新 |
| `[PUSH_ID]` | pushId 提取/缓存 |

---

## 七、待解决问题

1. **onIdle 过早触发**: 需要修改插件逻辑，延迟发送 `final=true`
2. **subagent 结果推送**: 需要实现 webhook 推送机制
3. **手机通知**: 需要确认 webhook pushText 的正确格式

---

## 八、参考资料

- 华为小艺开放平台: https://developer.huawei.com/consumer/cn/service/harmonyos/developer/
- Webhook 事件文档: https://developer.huawei.com/consumer/cn/doc/service/trigger-webhook-0000002525203283
- PUSH 通知文档: https://developer.huawei.com/consumer/cn/doc/service/pushmessage-0000002505761436
- OpenClaw 文档: https://docs.openclaw.ai/

---

*文档创建时间: 2026-03-27*
*最后更新: 2026-03-27*
