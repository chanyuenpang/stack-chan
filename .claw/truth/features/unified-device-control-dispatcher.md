# 统一设备控制 Dispatcher

## 结论

StackChan 引入统一命令分发框架 `hal_device_control`，所有设备控制能力（HTTP、USB Serial、MCP）通过"命令名 → handler 函数"注册表走同一套实现，不再各通道各自手写分发逻辑。

## 长期行为 / 规则

### Python CLI transport 规则

- `StackChan/tools/remote_control/remote_control.py` 现在是统一设备控制 CLI 的用户侧黄金入口；同一套命令面通过 `--transport {auto,lan,usb}` 选择实际链路。
- 统一全局参数：`--transport`、`--device`，同时保留 LAN 兼容参数 `--ip`、`--port`、`--token`。
- 统一命令词：`status`、`wake`、`stop`、`toggle`、`reboot --confirm [--delay-ms N] [--reason ...]`、`prompt-sample [short|tts]`。
- 命令词与固件串口命令词允许存在轻微语义映射：CLI 用 `prompt-sample`，USB 底层发送的是现有 firmware 命令词 `prompt_sample`。

### transport 选择语义

- `lan`：强制走 HTTP `/dev/*`。
- `usb`：强制走 serial；**优先发送 JSON line 协议**，只有基础命令在 JSON 通道不可用时才回退 legacy 文本命令。
- `auto`：先走 LAN；仅当 LAN 失败且命令属于 USB 支持集合时，才 fallback 到 USB。
- `auto` **不会**对 LAN-only 命令做伪 fallback；也就是 LAN-only 命令在 `auto` 下 LAN 失败时仍然按 LAN 失败处理，而不是偷偷改走 USB。

### CLI 能力矩阵

支持 `usb` / `auto fallback`：

- `status`
- `wake`
- `stop`
- `toggle`
- `reboot`
- `prompt-sample`
- `mcp`
- `head`
- `led`
- `celebrate`
- `reminder`
- `reminders`
- `stop-reminder`
- `inject-prompt`
- `capabilities`

其中：

- 基础命令 `status` / `wake` / `stop` / `toggle` / `reboot` / `prompt-sample` 具备 legacy fallback。
- 扩展能力 `mcp` / `head` / `led` / `celebrate` / `reminder` / `reminders` / `stop-reminder` / `inject-prompt` / `capabilities` 依赖 USB JSON line + `mcp_call` 主干，不再额外维护一套 legacy if-else。

保持 `LAN only`，在 `--transport usb` 下应明确报 unsupported：

- `play-sound`

### Dispatcher API

- 统一结果结构：`struct DeviceControlResult { bool success; std::string result_json; std::string error_message; }`
- 统一分发接口：
  - `DeviceControlResult dispatch_device_control(const char* command, const char* args_json)`
  - `DeviceControlResult dispatch_device_control(const char* command, const cJSON* args)`
- 注册入口：`void register_default_device_control_handlers()`
- 设计模式：命令名字符串 → handler 函数指针的注册表

### 已注册能力清单

| 命令名 | 行为要点 |
| ------ | -------- |
| `status` | 设备状态查询 |
| `wake` | 唤醒 / StartListening |
| `stop` | 停止 / StopListening |
| `toggle` | 切换 XiaoZhi chat state |
| `reboot` | **强制要求 `confirm=true`**；延迟执行 |
| `inject_prompt` | 注入 prompt 到 XiaoZhi 上行音频 |
| `prompt_sample` | 复用 `inject_prompt` 能力，限制为 sample 场景 |
| `mcp_call` | 复用现有 `stackchan_mcp_dispatch_tool(...)` |
| `celebrate` | 触发庆祝动作 |
| `capabilities` | 声明当前统一控制面与 MCP 工具面 |

### HTTP 链路

- `hal_dev_local_control.cpp` 现在只负责：token 校验 → 读取 HTTP body → 调用 `dispatch_device_control(...)` → 映射 `DeviceControlResult` 为 HTTP JSON 响应
- 保留原有兼容路由：`/dev/status`、`/dev/wake`、`/dev/stop`、`/dev/celebrate`、`/dev/inject_prompt`、`/dev/mcp/call`
- 新增统一能力路由：`/dev/toggle`、`/dev/prompt_sample`、`/dev/reboot`
- 编译守卫：HTTP 只依赖 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`，不再依赖 `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`

### USB Serial 链路

- `start_dev_serial_wake_stop_task()` 已从 stub 恢复为真实创建任务（**此前是 intentionally disabled**）
- 串口层现在是 **JSON line + legacy fallback 双协议分流**：行首是 `{` 时按 JSON line 解析，否则走 legacy 文本命令兼容壳。
- JSON line 请求格式：`{"v":1,"id":"...","command":"...","args":{...}}`
- JSON line 响应格式：成功 `{"v":1,"id":"...","ok":true,"result":...}`；失败 `{"v":1,"id":"...","ok":false,"error":"..."}`
- 串口命令改成白名单解析，统一走 dispatcher
- JSON command 当前接入：`status`、`wake`、`stop`、`toggle`、`reboot`、`prompt_sample`、`inject_prompt`、`celebrate`、`mcp_call`、`capabilities`
- legacy fallback 只保留基础命令：`status`、`wake`、`stop`、`toggle`、`reboot confirm [delay_ms=N] [reason=...]`、`prompt_sample [short|tts]`
- 输出格式仍是一行一个结果；host 侧按 `id` 匹配响应，并忽略串口日志/非 JSON 行

### CMake / 编译开关

- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP OR STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` 任一开启都会带上 audio sample WAV 文件
- `esp_http_server` 仅随 HTTP 开关引入
- `esp_driver_usb_serial_jtag` 仅随 serial 开关引入
- 编译守卫已拆分，不再交叉依赖

### MCP 与 Dispatcher 的关系

- `hal_mcp.cpp` 的 reboot tool 改成复用 dispatcher 的 `reboot` 实现
- 避免 HTTP/MCP/USB 三处各写一套重启调度逻辑
- `mcp_call` handler 不再直接依赖 `hal_mcp.cpp` 内部匿名命名空间里的实现细节，而是通过统一控制层 helper `dispatch_stackchan_mcp_tool(...)` 调用 MCP tool 分发器。
- `dispatch_stackchan_mcp_tool(...)` 在统一控制层内负责两件事：
  - 调用 `stackchan_mcp_dispatch_tool(...)` 执行具体 MCP tool；
  - 把返回值统一归一成 `DeviceControlResult`，覆盖 `"ok"`、JSON 字符串、普通字符串三类结果。
- `mcp_call over USB` 已真正接入这条统一 dispatcher 主干，不再是 USB 专用分叉；`head`、`led`、`reminder` 等扩展能力通过 host 侧 `mcp_call` over USB 打通。
- `stackchan_mcp_dispatch_tool(...)` 现在是 `hal_mcp.cpp` 的显式可见符号，而不是匿名命名空间内部符号；这避免了 `hal_device_control` 去链接带 `GLOBAL__N_1` 的脆弱内部符号。

## 关联代码

### 主锚点

- `firmware/main/hal/hal_device_control.h`：`DeviceControlResult` 结构体、`dispatch_device_control()` 接口声明、`register_default_device_control_handlers()` 声明、`dispatch_stackchan_mcp_tool()` helper 对外声明
- `firmware/main/hal/hal_device_control.cpp`：注册表实现、所有默认 handler 注册、命令分发核心逻辑、`mcp_call` 结果归一化 helper

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/hal_dev_local_control.cpp` | HTTP 链路：token 校验、body 读取、调用 dispatcher、响应映射 |
| `firmware/main/hal/hal_dev_local_control.h` | HTTP 控制 server 启动函数声明 |
| `firmware/main/hal/hal_dev_serial.cpp` | USB Serial 链路：白名单解析、调用 dispatcher、JSON line 输出 |
| `firmware/main/hal/hal_mcp.cpp` | MCP 工具注册与 `stackchan_mcp_dispatch_tool()`；该分发器已从匿名命名空间内部依赖提升为可链接符号，供统一控制层正式复用；reboot 继续复用 dispatcher |
| `firmware/main/CMakeLists.txt` | 编译守卫拆分与依赖引入 |
| `StackChan/tools/remote_control/remote_control.py` | 统一 CLI transport 入口；负责 `auto/lan/usb` 路由、LAN-only 能力边界、USB 文本命令映射与 fallback 语义 |

## 真实调用链路

### HTTP 控制请求

1. HTTP server 收到 `/dev/*` 请求
2. `hal_dev_local_control.cpp`：token 校验 + body 解析
3. 调用 `dispatch_device_control(command, args_json)`
4. `hal_device_control.cpp`：按 command 查注册表 → 执行对应 handler
5. handler 返回 `DeviceControlResult`
6. HTTP 层将结果映射为 JSON 响应

### USB Serial 控制请求

1. USB Serial task 读取一行输入
2. `hal_dev_serial.cpp`：若行首是 `{` 则按 JSON line 解析 `v/id/command/args`；否则走 legacy 命令词解析
3. 调用 `dispatch_device_control(command, args)`
4. 同一注册表分发到 handler
5. JSON 模式按 `id` 回包；legacy 模式只保留基础兼容输出；host 侧忽略串口日志/非 JSON 行

### MCP call 收口链路

1. `dispatch_device_control("mcp_call", args)` 进入统一 dispatcher
2. `hal_device_control.cpp` 的 `handle_mcp_call()` 读取 `tool` 与 `arguments`
3. 调用 `dispatch_stackchan_mcp_tool(tool_name, arguments, &result)`
4. helper 内部调用 `hal_mcp.cpp` 的 `stackchan_mcp_dispatch_tool(...)`
5. helper 将 MCP tool 返回值统一包装成 `DeviceControlResult`
6. HTTP / USB / 其他统一控制入口只消费标准化结果，不再各自解释 MCP 返回值

### Reboot 三通道统一

- HTTP `/dev/reboot` → dispatcher `reboot` handler
- USB `reboot confirm ...` → dispatcher `reboot` handler
- MCP `self.system.reboot` → `hal_mcp.cpp` 复用 dispatcher `reboot` 实现
- CLI `remote_control.py reboot --confirm` 负责把用户命令路由到 HTTP 或 USB
- 三条设备侧链路最终走同一份 reboot 调度逻辑；CLI 只负责 transport 选择，不应再复制一份独立 reboot 业务语义

### CLI 路由链路

1. `StackChan/tools/remote_control/remote_control.py` 解析 `--transport`、`--device`、`--ip`、`--port`、`--token`
2. `UnifiedStackChanClient` 根据命令名选择 `_call_lan()`、`_call_usb()` 或 `_call_auto()`
3. `lan` 命令走 `StackChanHttpClient` 调用 `/dev/*`
4. `usb` 命令走 `StackChanUsbClient`，优先发送带 `v/id/command/args` 的 JSON line，请求侧按 `id` 匹配响应并忽略串口日志/非 JSON 行
5. 若 JSON 协议不可用，只有基础命令才允许回退 legacy 文本命令；扩展能力保持 JSON-only
6. `auto` 先尝试 LAN；只有 USB 支持集合中的命令才允许在 LAN 失败后回退到 USB

## 已知陷阱

- **CLI 命令词与串口命令词不同名**：用户侧命令是 `prompt-sample`，串口底层实际发送 `prompt_sample`；排障时不要误把 argparse 子命令名当作 firmware 原生命令词。
- **CLI 命令词与串口命令词不同名**：用户侧命令是 `prompt-sample`，串口底层实际发送 `prompt_sample`；排障时不要误把 argparse 子命令名当作 firmware 原生命令词。
- **`play-sound` 仍是当前唯一明确的 LAN-only 缺口**：这轮没有把它纳入统一 dispatcher / MCP tool；在 `--transport usb` 下必须诚实失败，不要为了“能力对齐”再补一套临时串口分支。
- **`prompt_sample` 语义差异**：串口侧已约束“只 short/tts 且 explicit_stop=true”，HTTP 侧更宽松；后续如需统一产品语义，应同步收紧。
- **不要链接匿名命名空间符号**：`hal_device_control` 这类统一层不能直接依赖 `hal_mcp.cpp` 内部匿名命名空间函数；一旦符号名带上 `GLOBAL__N_1`，链接关系就变成实现泄漏，后续重构极易再次炸掉。
- **MCP 结果协议不要散落在调用侧**：`"ok"`、JSON 字符串、普通字符串的解释应集中在统一控制层做归一化；如果让 `handle_mcp_call()` 或各通道各自拼响应，会再次出现返回协议分叉。
- **USB 扩展能力不要再补 legacy**：`head`、`led`、`reminder`、`inject_prompt` 这类能力已经走 `mcp_call` over USB；若 JSON 通道坏了，应暴露能力缺口，而不是复制第二套 legacy 控制语义污染总线。
- **`capabilities` 目前是声明面，不是全通道真实协商**：USB firmware 侧已有 `capabilities` command，但 LAN 侧目前仍可能是 host 本地近似声明，不能误写成 HTTP firmware 原生能力发现接口。
- **语法检查依赖 IDF 环境**：dispatcher 代码无法在脱离 ESP-IDF 环境下做 `g++ -fsyntax-only` 检查（缺少 `sdkconfig.h`、`lvgl.h`），本地语法自检需在真实 `idf.py build` 下进行。
- **USB Serial/JTAG driver 互斥**：`esp_driver_usb_serial_jtag` 与 monitor/日志输出可能争抢 driver，但当前已通过编译守卫隔离；启用 serial 开关时需确认无冲突。
- **USB 自检不等于真机在线**：`auto` 回退到 USB 并出现 `/dev/ttyACM0` readiness/read no data 之类错误时，只能证明 CLI 路由与 fallback 分支已触发，不能证明设备一定在线或串口可独占。
- **“build 通过”不等于“串口实机联通”**：这轮只证明协议落地、路由接通、CLI 切到 JSON-first、编译通过；没有真实 USB 串口联调记录时，不能把它写成已完成在线验收。

## 验证标准

- 在真实 `idf.py build` 下确认 `hal_device_control.cpp` 的 include 依赖齐全
- 确认 HTTP 和 USB Serial 都通过 dispatcher 走到同一套 handler。
- 确认 `reboot` 三条链路（HTTP/USB/MCP）最终都走同一份 reboot 实现。
- 确认 `mcp_call` 通过 `dispatch_stackchan_mcp_tool()` 收口，且不再出现 `handle_mcp_call -> stackchan_mcp_dispatch_tool` 的链接错误。
- 确认 `stackchan_mcp_dispatch_tool(...)` 对统一控制层是可见符号，而不是匿名命名空间内部实现。
- 确认 `mcp_call` 对 `"ok"` / JSON / 普通字符串三类 MCP 返回值都能稳定归一成 `DeviceControlResult`。
- 确认 CLI `remote_control.py` 的 `--help` / `prompt-sample --help` 正常展示统一 transport 命令面。
- 确认 host 侧 USB client 优先发送 JSON line，并按 `id` 匹配响应、忽略串口日志/非 JSON 行。
- 确认只有基础命令会在 JSON 通道不可用时回退 legacy；`mcp` / `head` / `led` / `reminder` / `inject-prompt` / `capabilities` 等扩展能力保持 JSON-only。
- 确认 `mcp_call` over USB 可触达统一 dispatcher，而不是另挂 USB 专用分支。
- 确认 `play-sound` 在 `--transport usb` 下明确报 unsupported，而不是静默尝试错误链路。
- 确认 `auto reboot --confirm ...` 在 LAN 失败时确实进入 USB fallback 分支。
- 确认编译守卫独立：开启 HTTP 不需要 serial 开关，反之亦然。
- 确认 `prompt_sample` 在串口侧的 short/tts 约束是否需要同步到 HTTP 侧。
- 若要宣称 USB 能力“已对齐”，必须补真实串口实机联调证据，而不只是 build 通过。

## 关键检索词

- `DeviceControlResult`
- `dispatch_device_control`
- `register_default_device_control_handlers`
- `dispatch_stackchan_mcp_tool`
- `stackchan_mcp_dispatch_tool`
- `handle_mcp_call`
- `hal_device_control.h`
- `hal_device_control.cpp`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP`
- `start_dev_serial_wake_stop_task`
- `confirm=true`
- `prompt_sample`
- `prompt-sample`
- `--transport`
- `--device`
- `UnifiedStackChanClient`
- `USB_SUPPORTED_COMMANDS`
- `LEGACY_USB_SUPPORTED_COMMANDS`
- `LAN_ONLY_COMMANDS`
- `capabilities`
- `jsonl`
- `legacy fallback`
- `request_id`
- `mcp_call over USB`
- `/dev/toggle`
- `/dev/reboot`
- `/dev/prompt_sample`
