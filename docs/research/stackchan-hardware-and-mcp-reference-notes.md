# StackChan 硬件开发与 XiaoZhi MCP 参考实现补充

更新时间：2026-05-15

本文档补充两类资料：

1. M5Stack StackChan-BSP / Arduino 文档：确认硬件能力，但属于自定义固件/草图路线。
2. `ha-mcp-for-xiaozhi`：成熟的小智外部 MCP endpoint 参考实现。

## 1. StackChan-BSP / Arduino 结论

参考：

```text
https://github.com/m5stack/StackChan-BSP
https://docs.m5stack.com/zh_CN/arduino/stackchan/program
```

### 定位

`StackChan-BSP` 是 StackChan 的 Arduino board support package / 驱动库。

它不是：

- 官方小智固件本体；
- 小智 App 绑定协议；
- 已运行固件上的远程 API；
- WebSocket / MQTT / HTTP 控制服务；
- OTA 服务端或客户端实现。

### 已确认硬件能力

| 能力 | 结论 |
|---|---|
| WAV 播放 | Arduino 文档确认，`M5.Speaker.playWav(...)`，通常从 microSD 读取 WAV |
| Speaker tone | `M5.Speaker.tone(...)`，可做提示音 |
| RGB LED | `M5StackChan.setRgbColor(...)` / `refreshRgb()` / `showRgbColor(...)`，12 个 RGB LED |
| 舵机 / 头部动作 | `M5StackChan.Motion`，支持回 home、移动、旋转、校准 |
| microSD | 可读写 FAT32，适合放 WAV/图片素材 |
| MP3 | 未作为已确认能力 |
| WebSocket / MQTT / HTTP 控制服务 | BSP/Arduino 文档未提供现成远程控制框架 |
| App / 小智绑定协议 | 未涉及 |

典型接口：

```cpp
M5StackChan.begin();
M5StackChan.setRgbColor(index, r, g, b);
M5StackChan.refreshRgb();
M5StackChan.showRgbColor(r, g, b);
M5StackChan.Motion.setCurrentPostionAsHome();
M5StackChan.Motion.goHome();
M5.Speaker.tone(...);
M5.Speaker.playWav(...);
```

### 与当前无刷路线的关系

结论：**不能作为当前“保留官方小智固件”的主线。**

原因：

1. Arduino 文档明确是“示例程序编译与烧录”。
2. 使用这些能力通常需要上传 Arduino sketch。
3. 上传 sketch 本质上会替换当前运行的官方小智应用固件。
4. 替换后，小智 App 绑定、云端会话、语音助手能力大概率会失效。
5. BSP 没有提供对当前小智固件的运行时远程控制 API。

### 作为 B 计划的价值

如果未来用户明确允许刷自定义固件，BSP/Arduino 资料很适合实现：

- microSD WAV 胜利音效；
- Speaker tone 提示音；
- RGB 彩灯；
- 点头/摇头/跳舞动作；
- 本地素材显示；
- Arduino 版“庆祝模式”。

但这是**替换固件路线**，当前不作为主线。

## 2. ha-mcp-for-xiaozhi 参考实现

参考：

```text
https://github.com/c1pher-cn/ha-mcp-for-xiaozhi
```

定位：

```text
Home Assistant MCP server for 小智 AI，直连小智 AI 官方服务器。
```

它和我们的 OpenClaw bridge 属于同一方向：

```text
小智 → 外部 MCP endpoint → 第三方系统工具
```

不是设备端主动发声 API。

### 关键文件

```text
custom_components/ws_mcp_server/websocket_transport.py
custom_components/ws_mcp_server/server.py
custom_components/ws_mcp_server/session.py
custom_components/ws_mcp_server/__init__.py
custom_components/ws_mcp_server/config_flow.py
```

### 协议处理模式

这个项目没有手写完整 JSON-RPC 路由，而是用 MCP Python SDK：

```python
server.run(read_stream, write_stream, options)
```

因此：

- `initialize` 由 MCP SDK 处理；
- `tools/list` 由 `@server.list_tools()` 提供；
- `tools/call` 由 `@server.call_tool()` 提供。

### WebSocket 连接与重连

连接逻辑：

- 使用 `aiohttp.ClientSession().ws_connect(endpoint)` 连接小智 MCP endpoint。
- 把 WebSocket reader/writer 转为 MCP SDK stream。
- 固定 20 秒重连。
- 每 50 秒发送 WebSocket ping。

局限：

- 没有指数退避；
- 没有 jitter；
- 没有认证失败/网络错误分类；
- token 在 endpoint URL 中，日志可能泄露完整 URL。

### 工具公开逻辑

工具来自 Home Assistant LLM API：

```python
llm_api.tools
```

即 README 所说：工具取决于 Home Assistant 语音助手公开了哪些实体/能力。

这个项目本身不逐个扫描实体，而是依赖 HA 的 LLM / Assist 层生成工具。

### 对 OpenClaw bridge 的启发

#### 稳定性

建议 OpenClaw bridge 增加连接状态机：

```text
configured
connecting
websocket_connected
mcp_initialized
tools_listed
ready
disconnected
reconnecting
auth_failed
endpoint_invalid
```

建议记录：

- 最近连接时间；
- 最近 initialize 时间；
- 最近 tools/list 数量；
- 最近 tools/call；
- 最近 ping/pong；
- reconnect 次数；
- last error category。

#### 重连

建议从固定重连升级为：

- 指数退避；
- jitter；
- 最大间隔；
- 认证失败不要无限快速重试；
- 网络错误持续重试。

#### 多连接与旧连接

建议每次连接分配 `connection_id` / generation：

- 日志带 connection id；
- 新连接建立后旧连接不能继续写；
- 防止旧 bridge 进程/旧 socket 串线。

这与我们已遇到的“旧 3 工具 bridge 仍在线”问题高度相关。

#### 日志与安全

必须坚持：

- endpoint token 永不原样打印；
- URL query 脱敏；
- tools/list 摘要只打印工具数和工具名；
- tools/call 默认只打印工具名和参数摘要；
- schema/full payload 仅 debug/trace，默认关闭。

#### 小智内置工具冲突

README 明确提到灯光/音乐控制可能与小智内置屏幕/音乐逻辑冲突。

对我们后续很重要：

- 如果工具名包含 `music`、`screen`、`light`、`volume`、`media`，小智可能优先走内置能力；
- 需要调整工具名、description 或提示词；
- 调试时应看小智聊天记录，确认是否真的调用外部 MCP。

## 3. 对当前项目的结论

- 当前主线仍是保留官方小智/StackChan 固件。
- BSP/Arduino 只能作为 B 计划，不能直接解决无刷主动发声。
- `ha-mcp-for-xiaozhi` 可作为 OpenClaw bridge 稳定性和调试能力参考。
- 下一步若要增强 bridge，应优先做：
  1. 状态机；
  2. reconnect/backoff；
  3. connection generation；
  4. debug dump；
  5. 工具冲突检测；
  6. token 脱敏保障。
