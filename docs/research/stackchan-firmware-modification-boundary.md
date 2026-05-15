# StackChan 固件改造边界：必须保留小智与官方设备 MCP

更新时间：2026-05-15

## 1. 用户目标

即使后续考虑刷固件、OTA 或替换 `app.bin`，也必须保留：

```text
小智能力
官方设备 MCP
表情 / 设备管理 / 内部硬件 tools
StackChan App 绑定与 Agent 配置
```

目标不是把 StackChan 改成一个完全自研机器人，而是在官方小智固件基础上补充：

```text
self.robot.celebrate
self.robot.set_led_effect
本地灯效状态机
可选提示音能力
```

## 2. 当前完全自定义固件的核心卡点

用户已指出核心问题：

```text
刷自己的固件后，主要会卡死在进入小智之后；没有官方登录/激活流程，无法启动小智功能。
```

源码研究也支持这个判断：

```text
设备接入不是普通账号密码登录
而是 OTA/config + activation + NVS websocket/mqtt 凭据
```

关键链路：

```text
设备启动
→ 请求 https://api.tenclass.net/xiaozhi/ota/
→ 带 MAC / UUID / Serial / board / app info
→ 云端返回 activation / websocket / mqtt / firmware 配置
→ 设备写入 NVS
→ 用 websocket/mqtt 凭据进入小智音频/会话通道
```

如果自定义固件没有完整复刻这条链路，就会出现：

```text
无法登录小智
无法启动小智功能
App 设备配置缺失
官方设备 MCP 不可用
```

## 3. 路线优先级

### 首选：官方小智固件最小补丁

```text
基于官方小智固件源码
不重写登录/激活/云端协议
不改分区表
不擦 NVS
只新增 celebrate tool / LED effect
```

优势：

- 最大概率保留小智；
- 最大概率保留官方设备 MCP；
- 改动最小；
- 可通过 app 分区替换或 OTA 尝试保留绑定状态。

### 次选：OTA app.bin 替换

```text
已绑定官方固件
→ 保留 NVS
→ OTA 替换 app slot
→ 新 app 继承已有 websocket/mqtt 配置
```

前提：

- 能设置 `wifi.ota_url` 或控制 OTA 服务；
- 自定义 app 和原固件 NVS schema 兼容；
- 不触发重新 activation；
- 不破坏 rollback；
- 实机无 secure boot / flash encryption 阻碍。

### 不推荐作为当前目标：完全自研固件

```text
Arduino / UIFlow2 / ESP-IDF 自研
```

虽然硬件能力最自由，但会丢失：

```text
小智 App 绑定
小智 Agent
官方设备 MCP
云端语音/音频链路
设备管理
```

除非后续能完整攻克小智登录/激活/云端接入流程。

## 4. 若要考虑自刷固件，必须先攻克的问题

1. 如何完整保留或重建设备身份：
   - MAC；
   - board UUID；
   - serial number；
   - User-Agent / board name；
   - product / agent 绑定关系。

2. 如何通过 OTA/config：
   - `https://api.tenclass.net/xiaozhi/ota/` response；
   - activation code/challenge；
   - firmware/mqtt/websocket 字段。

3. 如何完成 activation：
   - serial number；
   - challenge；
   - ESP HMAC KEY0；
   - hmac-sha256。

4. 如何拿到/保留运行时云端凭据：
   - `websocket.url`；
   - `websocket.token`；
   - `mqtt.endpoint`；
   - `mqtt.client_id`；
   - `mqtt.username/password`；
   - `publish_topic`。

5. 如何保留官方设备 MCP：
   - `McpServer::AddCommonTools()`；
   - StackChan `hal_mcp.cpp` tools；
   - 表情/屏幕/设备管理相关 tools；
   - 云端 `type:"mcp"` 消息分发。

## 5. 当前建议

不要走“完全替换系统”的路线。

优先研究：

```text
官方小智固件最小 patch
+ app 分区替换 / OTA
+ NVS 保留
```

只有当“小智登录/激活/云端接入流程”被确认可复刻或可继承时，才考虑完整自刷固件路线。
