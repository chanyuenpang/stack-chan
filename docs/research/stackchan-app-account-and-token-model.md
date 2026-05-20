# StackChan App / XiaoZhi 账号与 Token 模型

更新时间：2026-05-15

## 1. 核心结论

StackChan App **不是要求用户注册/登录 xiaozhi.me 个人账号**。

更准确的模型是：

```text
用户登录 M5Stack / StackChan App
→ StackChan 后端代管 XiaoZhi developer token
→ App/后端在 XiaoZhi 开发者体系下创建/绑定设备与 Agent
→ 用户在 StackChan App 里设置性格、音色、模型等
```

这与用户观察吻合：

```text
用户没有注册 xiaozhi.me
StackChan 绑定后小智能力自动可用
App 里主要能设置性格、音色等
```

因此，之前“让用户登录 xiaozhi.me 控制台找 assets-generator/messaging token”的路线，**不应继续作为 StackChan 官方 App 绑定设备的主路径**。

## 2. 账号体系

官方文档显示，StackChan World App 登录/注册的是 **M5Stack 账号**，并且与以下账号体系一致：

```text
UiFlow
M5Burner
M5Stack Forum
```

App 下载入口包括：

```text
iOS App Store: stackchan-world
Android Play Store: com.m5stack.stackchan
APK: https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/1205/StackChan_World_apk.zip
```

## 3. App 后端与 XiaoZhi API

### StackChan App 后端

源码：

```text
app/lib/network/urls.dart
```

App 先连 StackChan 后端：

```text
http://<server-ip>:<port>/stackChan/
ws://<server-ip>:<port>/stackChan/ws
```

公开源码里是占位：

```dart
static const String url = "00.000.000.000:0000/";
```

官方 APK 字符串中扫描到线上地址：

```text
http://47.113.125.164:12800/stackChan/
ws://47.113.125.164:12800/stackChan/ws
http://47.113.125.164:12800/file/music/stackchan_music.mp3
https://policies.m5stack.com/stack-chan-privacy-policy
https://community.m5stack.com/reset
```

说明官方 App 很可能直接连接 M5Stack 的 StackChan 后端，而不是只直接连接 xiaozhi.me。

### XiaoZhi developer token

源码：

```text
app/lib/util/XiaoZhi_util.dart
server/internal/xiaozhi/xiaozhi.go
```

App 内部使用 XiaoZhi API base URL：

```text
https://XiaoZhi.me/
```

后端用配置里的 secret key 换取 XiaoZhi developer token：

```go
baseUrl   = "https://xiaozhi.me/"
tokenPath = "api/developers/token"

POST https://xiaozhi.me/api/developers/token
body: { "secret_key": <server config xiaozhi.secret_key> }
```

这说明 XiaoZhi developer credential 在 M5Stack 后端，不是用户手动登录 xiaozhi.me 获取。

## 4. App 内 MCP 页面

源码：

```text
app/lib/view/home/mcp_page.dart
```

App 的 MCP 页面会：

1. 根据当前设备 MAC 查询 XiaoZhi 设备；
2. 获取设备绑定的 `agent_id`；
3. 调用 `generateMcpEndpointToken(agentId)`；
4. 展示并可复制 MCP endpoint：

```text
wss://api.XiaoZhi.me/mcp/?token=<endpointToken>
```

页面文案包括：

```text
MCP
Access Point Status
Access point address
Offline
Already copied
```

所以，StackChan App 内部确实有官方 MCP 接入点地址页面。这个地址就是 OpenClaw bridge 要连接的 WebSocket。

## 5. 工具列表展示

同一 MCP 页面会调用：

```text
https://api.XiaoZhi.me/mcp/endpoints/list
```

参数：

```text
endpoint_ids = agent_<agentId>
```

用于展示 MCP endpoint 的状态和 tools。

这解释了为什么 App 能显示 OpenClaw bridge 暴露的工具数量。

## 6. Agent 配置

App 中的 Agent 配置页面对应：

```text
AI Agent 名称
Assistant name
User name
LLM model
TTS voice
speech speed
pitch
language
character
memory
MCP endpoints / product MCP endpoints
```

这与用户说的“只能从 App 设置性格、音色等”一致。

## 7. messaging token / assets-generator 状态（不作为路线）

当前源码研究没有找到 StackChan App 中公开展示：

```text
https://xiaozhi.me/tools/assets-generator/?token=...
```

也没有找到等价于公开 xiaozhi.me 控制台的“主题配置 / 自定义”入口。

因此：

```text
不要继续要求用户去 xiaozhi.me 控制台找 assets-generator/messaging token
```

更可能的情况：

- StackChan App/后端封装了 XiaoZhi developer token；
- App 只公开 MCP endpoint 地址；
- messaging token 不作为用户可见入口暴露；
- 不要把 messaging token / assets-generator token 作为 StackChan 运维、设备控制、重启或 OTA 路线；设备侧入口以后只从 App/后端/固件源码作只读研究，不要求用户提供云端 token。

## 8. Token 分类

| Token | 来源 | 用途 | 是否建议用户提供 |
|---|---|---|---|
| StackChan 后端 JWT | App 登录 M5Stack 账号后返回 | 访问 StackChan 后端 | 否 |
| XiaoZhi developer bearer token | M5Stack 后端用 `xiaozhi.secret_key` 换取，App 缓存 | 管理 XiaoZhi devices/agents/MCP endpoint | 否，不建议导出 |
| MCP endpoint token | StackChan App 的 MCP 页面生成/显示 | 仅用于 OpenClaw bridge 联调，让小智调用 OpenClaw 只读工具；不是 StackChan 运维/设备控制/重启/OTA 凭据 | 可由用户现场复制用于 bridge 联调，不作为运维路线 |
| 设备 WebSocket/MQTT token | OTA/config 下发到设备 NVS | 设备连接云端音频/会话 | 否，真实设备凭据 |
| messaging token/assets-generator token | StackChan App 未发现公开入口 | 历史研究中对应网页 tools/list/call | 不可用，不作为任何运维/设备控制路线 |

## 9. 对当前方案的修正

### 放弃路径

```text
让用户登录 xiaozhi.me 控制台找 assets-generator token
```

这对 StackChan App 绑定设备不可靠。

### 可保留但降级为“bridge 联调”

```text
StackChan App MCP 页面
→ 复制 wss://api.XiaoZhi.me/mcp/?token=...
→ OpenClaw bridge 连接
→ 小智调用 OpenClaw 只读工具
```

这条只说明小智能调用 OpenClaw bridge；它不是 StackChan 运维、设备控制、设备重启或 OTA 路线。

### 下一步研究方向

1. 继续稳定 OpenClaw bridge。
2. 继续优化工具名称和 description，让小智更容易调用。
3. 只读追 App/后端是否有官方设备 tools/call 封装；不要要求用户提供 messaging token。
4. 追固件设备 MCP 消息链，确认 set_led_color / set_head_angles / create_reminder 是从哪个云端通道下发。
5. 若需要真实设备 NVS，只能做只读检查：不打印、不保存真实 token。

## 10. 用户可提供的最小信息

不需要用户提供密码。

如果继续排查 App 入口，用户可以提供：

1. StackChan App 首页/设备详情页截图。
2. MCP 页面截图：确认有无 `Access point address`。
3. AI Agent 编辑页面截图：确认是否有模型、音色、性格、MCP endpoint 配置。
4. App 版本号。

如果截图里有 token，建议先打码。
