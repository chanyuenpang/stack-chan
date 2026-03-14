---
name: qqbot-cron
version: 1.0.0
description: "QQ定时提醒 | 支持一次性和周期性提醒的创建、查询、取消。触发词：提醒、定时、闹钟。"
metadata: {"openclaw":{"emoji":"⏰","requires":{"config":["channels.qqbot"]}}}
---

# QQ Bot 智能提醒

让 AI 帮用户设置、管理定时提醒，支持私聊和群聊。

## ⛔ 最重要规则

> **调用 cron 工具时，payload.kind 必须是 `"agentTurn"`。绝对不能用 `"systemEvent"`！**

## 用户意图识别

| 用户说法 | 意图 | action |
|----------|------|--------|
| "5分钟后提醒我喝水" | 一次性提醒 | `add`（kind=at） |
| "每天8点提醒我打卡" | 周期提醒 | `add`（kind=cron） |
| "我有哪些提醒" | 查询 | `list` |
| "取消喝水提醒" | 删除 | `remove` |
| "提醒我" (无时间) | **需追问** | 询问具体时间 |

## 创建提醒参数模板

### 一次性提醒

```json
{
  "action": "add",
  "job": {
    "name": "{任务名}",
    "schedule": { "kind": "at", "atMs": {当前时间戳毫秒 + N分钟*60000} },
    "sessionTarget": "isolated",
    "wakeMode": "now",
    "deleteAfterRun": true,
    "payload": {
      "kind": "agentTurn",
      "message": "你是一个暖心的提醒助手。请用温暖、有趣的方式提醒用户：{提醒内容}。要求：(1) 不要回复HEARTBEAT_OK (2) 不要解释你是谁 (3) 直接输出一条暖心的提醒消息 (4) 可以加一句简短的鸡汤或关怀的话 (5) 控制在2-3句话以内 (6) 用emoji点缀",
      "deliver": true,
      "channel": "qqbot",
      "to": "{openid}"
    }
  }
}
```

### 周期提醒

```json
{
  "action": "add",
  "job": {
    "name": "{任务名}",
    "schedule": { "kind": "cron", "expr": "0 8 * * *", "tz": "Asia/Shanghai" },
    "sessionTarget": "isolated",
    "wakeMode": "now",
    "payload": {
      "kind": "agentTurn",
      "message": "你是一个暖心的提醒助手。请用温暖、有趣的方式提醒用户：{提醒内容}...",
      "deliver": true,
      "channel": "qqbot",
      "to": "{openid}"
    }
  }
}
```

## 必填字段说明

| 字段 | 说明 | 必须值 |
|------|------|--------|
| `payload.kind` | 消息类型 | `"agentTurn"` ❌不能用`"systemEvent"` |
| `payload.deliver` | 是否投递 | `true` |
| `payload.channel` | 通道 | `"qqbot"` |
| `payload.to` | 目标用户 | 用户 openid 或 `group:{group_openid}` |
| `sessionTarget` | 会话目标 | `"isolated"` |

## 时间格式

### 一次性提醒（kind = "at"）

| 用户说法 | 计算方式 |
|----------|----------|
| 5分钟后 | `Date.now() + 5 * 60 * 1000` |
| 半小时后 | `Date.now() + 30 * 60 * 1000` |
| 1小时后 | `Date.now() + 60 * 60 * 1000` |

### 周期提醒（kind = "cron"）

必须加 `"tz": "Asia/Shanghai"`

| 用户说法 | expr |
|----------|------|
| 每天早上8点 | `"0 8 * * *"` |
| 每天晚上10点 | `"0 22 * * *"` |
| 每个工作日早上9点 | `"0 9 * * 1-5"` |
| 每周一早上9点 | `"0 9 * * 1"` |
| 每周末上午10点 | `"0 10 * * 0,6"` |

## 用户反馈模板

**创建成功**：
- 一次性：`⏰ 好的，{时间}后提醒你{提醒内容}~`
- 周期性：`⏰ 收到，{周期描述}提醒你{提醒内容}~`

**查询结果**：
```
📋 你的提醒：
1. ⏰ {提醒名} - {时间}
2. 🔄 {提醒名} - {周期}
说"取消xx提醒"可删除~
```

**删除成功**：`✅ 已取消"{提醒名称}"`

## 查询和删除

- 查询：`{ "action": "list" }`
- 删除：`{ "action": "remove", "jobId": "{id}" }`

## 重要限制

| 限制 | 说明 |
|------|------|
| message_id 有效期 | 1 小时内有效 |
| 回复次数限制 | 同一 message_id 最多回复 4 次 |
| 主动消息限制 | 只能发给24小时内交互过的用户 |
