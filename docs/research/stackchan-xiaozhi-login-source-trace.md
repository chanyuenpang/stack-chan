# StackChan / XiaoZhi login 源码追踪

更新时间：2026-05-15

## 1. 结论摘要

源码确认：StackChan 里至少有三套不同的“登录/凭据”链路，不能混为一谈。

| 链路 | 作用 | 凭据来源 | 是否是设备控制 token |
|---|---|---|---|
| App 用户登录 | App 登录 M5Stack/StackChan 后端 | 用户名/密码 → StackChan 后端 JWT | 否 |
| XiaoZhi developer token | App/后端管理 XiaoZhi agent/config/MCP endpoint | 后端 `xiaozhi.secret_key` → `https://xiaozhi.me/api/developers/token` | 否，偏管理 API |
| 设备接入 XiaoZhi 音频通道 | 设备连接云端 WebSocket/MQTT | OTA/config 响应写入 NVS 的 `websocket.token` 或 MQTT 凭据 | 是设备运行时接入凭据，但不是 App 登录 token |

这与用户观察吻合：用户并没有直接注册 `xiaozhi.me`，StackChan 绑定后，小智能力由 App/后端/设备激活流程自动配置；App 主要暴露性格、音色、模型等配置。

## 2. App 用户登录链路

关键文件：

```text
app/lib/view/popup/login_page.dart
app/lib/network/urls.dart
app/lib/network/http.dart
server/api/user/v2/user.go
server/internal/service/user.go
```

调用链：

```text
LoginPage.login()
→ Http.instance.post(Urls.login, data: {username, password})
→ /stackChan/v2/user/login
→ server/internal/service/user.go:Login()
→ callRemoteLogin()
→ m5stack.loginUrl
→ generateToken()
→ 返回 StackChan 后端 JWT 给 App
```

请求字段：

```text
username
password
```

请求头中会附加：

```text
authorization: RSA(mac|random|timestamp)
token: App 本地保存的 StackChan 后端 JWT
appVersion
```

注意：这个返回的 `token` 是 StackChan 后端自己的 JWT，不是设备 WebSocket token，也不是 messaging token。

## 3. XiaoZhi developer token 链路

关键文件：

```text
app/lib/util/XiaoZhi_util.dart
server/internal/controller/xiaozhi/xiaozhi_v1_get_xiao_zhi_token.go
server/internal/xiaozhi/xiaozhi.go
```

调用链：

```text
XiaoZhiUtil.getToken()
→ 先读 SharedPreferences: XiaoZhiToken
→ 若不存在，调用 getTokenFromServer()
→ StackChan 后端 /xiaozhi/token
→ server/internal/xiaozhi.refreshToken()
→ POST https://xiaozhi.me/api/developers/token
→ body: { secret_key: <server config xiaozhi.secret_key> }
→ 返回 data.token
→ App 缓存为 XiaoZhiToken
```

这个 token 用于 XiaoZhi 云开发者 API，例如：

```text
api/developers/devices
api/agents
api/agents/{id}/config
api/agents/{id}/devices
api/developers/mcp-endpoints
api/agents/{id}/generate-mcp-endpoint-token
api.XiaoZhi.me/mcp/endpoints/list
```

它解释了为什么 App 能管理：

```text
性格
音色
模型
assistant name
memory
MCP endpoint
```

但这仍然不是“直接控制设备播放音频”的 token。

## 4. 设备接入链路：OTA/config + 激活 + WebSocket/MQTT

关键文件：

```text
firmware/xiaozhi-esp32/main/Kconfig.projbuild
firmware/xiaozhi-esp32/main/ota.cc
firmware/xiaozhi-esp32/main/protocols/websocket_protocol.cc
firmware/xiaozhi-esp32/main/protocols/mqtt_protocol.cc
```

默认 OTA/config URL：

```text
https://api.tenclass.net/xiaozhi/ota/
```

也可从 NVS 覆盖：

```text
wifi.ota_url
```

设备启动时：

```text
Application 初始化
→ ota_->CheckVersion()
→ 请求 https://api.tenclass.net/xiaozhi/ota/
→ 带 MAC / UUID / serial / app / board / partition 等信息
→ 响应里可能包含 activation / mqtt / websocket / firmware
→ mqtt/websocket 字段写入 NVS
→ WebSocketProtocol 或 MqttProtocol 从 NVS 取凭据连接云端
```

### OTA/config 请求头

```text
Activation-Version
Device-Id: Wi-Fi MAC
Client-Id: Board UUID
Serial-Number: eFuse user data 中的序列号，如果存在
User-Agent: BOARD_NAME/app_version
Accept-Language
Content-Type: application/json
```

### OTA/config body 摘要

```text
version
language
flash_size
minimum_free_heap_size
mac_address
uuid
chip_model_name
chip_info
application
partition_table
ota
board
```

### OTA/config 响应解析

响应会解析：

```text
activation.message
activation.code
activation.challenge
activation.timeout_ms
mqtt: 任意字符串/数字字段写入 NVS websocket/mqtt 设置
websocket: 任意字符串/数字字段写入 NVS websocket 设置
server_time
firmware.version
firmware.url
```

### 设备激活

激活接口：

```text
<OTA_URL>/activate
```

body：

```json
{
  "algorithm": "hmac-sha256",
  "serial_number": "...",
  "challenge": "...",
  "hmac": "..."
}
```

其中 `hmac` 使用 ESP HMAC KEY0 对 challenge 计算。

这说明设备不是用普通账号密码登录，而是：

```text
硬件序列号 + eFuse/HMAC 证明 + OTA/config 下发凭据
```

## 5. 设备 WebSocket / MQTT 凭据

### WebSocket

来源：NVS `websocket` namespace。

```text
websocket.url
websocket.token
websocket.version
```

连接时 header：

```text
Authorization: Bearer <token>
Protocol-Version
Device-Id: MAC
Client-Id: UUID
```

client hello：

```json
{
  "type": "hello",
  "version": ...,
  "features": {
    "mcp": true
  },
  "transport": "websocket",
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": ...
  }
}
```

server hello：

```text
transport
session_id
audio_params.sample_rate
audio_params.frame_duration
```

### MQTT

来源：NVS `mqtt` namespace。

```text
mqtt.endpoint
mqtt.client_id
mqtt.username
mqtt.password
mqtt.publish_topic
```

hello 响应还可能带：

```text
session_id
udp.server
udp.port
udp.key
udp.nonce
audio_params
```

## 6. 账号体系判断

源码支持以下判断：

1. App 用户登录是 M5Stack/StackChan 后端账号，不是设备自己的 login。
2. App 登录 token 是 StackChan 后端 JWT。
3. XiaoZhi developer token 由 StackChan 后端通过 `xiaozhi.secret_key` 向 `xiaozhi.me` 换取。
4. 设备真正接入 XiaoZhi 服务的凭据来自 OTA/config 下发到 NVS 的 websocket/mqtt 配置。
5. 用户无需直接注册 `xiaozhi.me` 也能使用 XiaoZhi/Agent，因为 App/后端代管了 developer token 和 agent/device 配置流程。

这解释了用户现象：

```text
没有注册 xiaozhi.me
StackChan 绑定后小智自动可用
App 里只能设置性格、音色等
```

## 7. 对当前方案的影响（无小智 token 运维路线）

### 不能从 App 登录直接拿设备控制 token

`/v2/user/login` 返回的是 StackChan 后端 JWT，不包含：

```text
agentId
session
endpoint
tools
speech config
设备 websocket token
messaging token
```

### XiaoZhi 管理 API 有用，但不是直接设备控制

源码能确认这些管理 API：

```text
https://xiaozhi.me/api/developers/token
api/developers/devices
api/agents
api/agents/{id}/config
api/agents/{id}/devices
api/developers/mcp-endpoints
api/agents/{id}/generate-mcp-endpoint-token
https://api.XiaoZhi.me/mcp/endpoints/list
```

这解释了 bridge 联调为什么可行：小智能调用 OpenClaw 暴露的只读工具。

但 MCP endpoint token / developer token / App JWT 都不是 StackChan 运维、设备控制、设备重启或 OTA 凭据；源码没有证明这些 API 可直接让设备“主动说一句话”。

### 真正设备接入凭据在 NVS / OTA 响应

如果要追设备端主动控制，需要看：

```text
NVS websocket.url / websocket.token
NVS mqtt.endpoint / client_id / username / password / publish_topic
OTA/config 服务响应
```

但这些是真实设备凭据，不能随意输出或保存。

## 8. 下一步建议

### A. 继续无刷主线

继续验证：

```text
小智 → OpenClaw MCP → get_latest_completion_event → 小智自然 TTS 回复
```

这是当前已经跑通的官方路径。

### B. 只读追 App/后端管理 API（不索取 token）

可以继续查源码：

```text
app/lib/view/home/mcp_page.dart
XiaoZhiUtil
server/internal/xiaozhi/*
```

目标：确认是否存在官方封装的设备能力入口；不要把 `assets-generator` / messaging token 当作可用路线，也不要要求用户提供云端 token。

### C. 追固件设备 MCP 消息链

继续查：

```text
firmware/xiaozhi-esp32/main/mcp*
firmware/xiaozhi-esp32/main/protocols/*
```

目标：确认设备收到 JSON-RPC / MCP tool 调用后如何执行：

```text
set_led_color
set_head_angles
create_reminder
```

以及这些调用到底是从云端哪个通道下发。

### D. 需要真实设备时只读检查

如后续要看 NVS，必须遵守：

- 不打印 token；
- 不保存 token；
- 只输出字段是否存在、长度、域名；
- 不输出完整 credential。
