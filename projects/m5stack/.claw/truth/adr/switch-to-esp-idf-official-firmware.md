# ADR: 切换到 ESP-IDF 官方固件路线

## Status

accepted

## Context

当前 Stack-chan 固件运行在 Moddable SDK（XS 引擎 + JS）之上，通过 `celebration` MOD 和 `ai_stackchan_api` MOD 实现庆祝能力和 HTTP API。该方案存在以下约束：

- Moddable SDK 调试手段有限，崩溃诊断困难（如 XS 引擎启动立即崩溃问题）
- Moddable/JS 路线依赖 xs-dev CLI 和特定 ESP-IDF v6.0 工具链版本
- 固件体积较大，部分 M5Stack 设备（如 StickS3）资源受限

M5Stack 官方固件（[m5stack/StackChan](https://github.com/m5stack/StackChan)）基于纯 ESP-IDF（C 语言）构建，已内置完整的 AI Agent 能力：语音唤醒、ChatGPT 对话、TTS 和面部表情/舵机动画。核心思路是：**官方固件已有 90% 所需能力，无需从 Moddable/JS 生态重复开发**。

## Decision

### 1. 切换到 ESP-IDF 官方固件，放弃 Moddable/JS 路线

将项目基础固件从 Moddable SDK + XS 引擎迁移到 M5Stack 官方 ESP-IDF 固件，主分支基于 `idf.py` 构建工具链。

### 2. 复用官方现有 AI Agent 能力

M5Stack 官方固件的 AI Agent 已包含：
- 语音唤醒（Wake Word Detection）
- 流式 ChatGPT 对话
- TTS（Text-to-Speech）
- 面部表情与舵机动画系统

以上能力不再自行实现，直接复用官方实现。

### 3. 复用官方固件内置 HTTP 控制端点

官方固件**已内置**完整的 HTTP 控制接口，无需扩展或重写：
- 端点：`POST /api/celebrate`、`GET /api/health`
- 功能：接收外部请求，驱动官方固件的表情/动画引擎执行庆祝动作
- 同时自带 WiFi 配置向导（setup wizard），首次使用需在设备屏幕上设置
- 不依赖 WS Bridge 或 Moddable 的 `HttpServerService`

### 4. OTA 双分区固件更新策略

官方固件使用 OTA 双分区设计（app0 / app1），后续固件更新通过 OTA 进行，无需插 USB 线。烧录时 5 个 bin 均写入对应分区并经哈希校验。

### 5. Kconfig 静态 WiFi 配置（已实现）

原始官方固件仅支持通过屏幕 setup wizard 交互式配置 WiFi，不支持预置静态 WiFi 凭证。后通过在 `wifi_board.cc` 中添加 Kconfig 配置项读取逻辑实现：

- 新增 Kconfig 配置项：`CONFIG_WIFI_SSID` 和 `CONFIG_WIFI_PASSWORD`
- 修改文件：`components/*/wifi_board.cc`（具体组件路径依据固件版本）
- 行为变更：当 Kconfig 中存在静态 WiFi SSID/密码时，跳过 setup wizard 配网流程直接连接，设备启动后端口 8080 的 HTTP API 立即可用
- 验证结果：编译烧录成功，设备不依赖屏幕自动连 WiFi，HTTP 控制端点可用

此机制为无头部署场景提供了内置支持，无需额外 WiFi 引导方案。但 Kconfig 是编译期配置，如需运行时切换仍需持久化存储方案。

### 6. HTTP 控制服务前移到 Mooncake 桌面阶段

`http_control_start()` 不能只放在 xiaozhi 模式分支内。已将它移到 Mooncake 主循环前（`main.cpp:31`），让设备停留在 Mooncake 桌面阶段时也能持续响应 HTTP 控制请求。

同时，`httpd_start()` 依赖 lwIP TCP/IP 栈已初始化；因此在启动 HTTP 服务前必须先调用 `esp_netif_init()`。这条初始化顺序是回归防线：否则 HTTP server 启动会因 TCP/IP 栈未就绪而 crash。

验证结果：重编并烧录成功，`POST /api/celebrate` 返回 `{"success":true}`，`celebrate_rgb()` 彩虹灯效函数执行；HTTP API 在 `192.168.0.168:8080` 可用，且无需进入 xiaozhi 模式。

## Alternatives Considered

- **继续 Moddable/JS 路线 + WS Bridge 桥接**：当前运行方案。优势是庆祝 MOD 已有完整实现（星星粒子、3 级强度动画）；劣势是固件层问题多、调试困难、社区支持较弱。选择放弃。
- **在官方固件上叠加 Moddable 层**：既保留 AI Agent 又保留庆祝 MOD。架构复杂度高，混合运行时维护成本不可控。选择放弃。

## Related Code

| Path | Role |
| ---- | ---- |
| `stack-chan-firmware/` | 官方固件根目录（成功克隆并构建） |
| `firmware/` | 旧 Moddable 固件目录（逐步弃用） |
| `stack-chan-firmware/components/78/uart-uhci/` | 官方固件中 `uart-uhci` 组件，GDMA API 与新 IDF v6.0 不兼容 |
| `main.cpp:31` | `http_control_start()` 前移到 Mooncake 主循环前的初始化锚点 |
| `OTA app0/app1` | 双分区设计，idf.py 自动管理，闪存 27% 剩余空间（约 1.35MB） |

## 编译验证

### ESP-IDF 版本兼容性

实际编译验证（2026-05-13）发现官方固件**设计目标为 ESP-IDF 5.5.4**，与当前环境（ESP-IDF 6.0.0）存在以下兼容性问题：

### IDF v6.0 已移除的内置组件

| 组件 | 移除版本 | 替代方案 |
| ---- | -------- | -------- |
| `mqtt` | IDF v6.0 | 需要外部 wrapper 或依赖包（已创建 `components/mqtt` wrapper） |
| `json` | IDF v6.0 | 需要 wrapper 转发到 `cjson`（已创建 `components/json` wrapper） |

### GDMA API 不兼容（关键阻塞点）

`78/uart-uhci` 组件使用的 GDMA API 在 IDF v6.0 中发生破坏性变更：

1. `gdma_channel_alloc_config_t` 不再有 `direction` 字段
2. `gdma_new_ahb_channel()` 参数签名从 2 个改为 3 个

**影响**：编译可通过 cmake 配置阶段（约 100/1332 个编译目标完成），但在 `uart-uhci` 对象编译时因 GDMA API 签名不匹配而终止。

### `idf.py` CWD bug

在某些环境下 `idf.py` 会出现 "CWD cannot be established" 错误。绕过方式：**直接运行 `cmake` + `ninja`** 可成功执行编译。

### 结论与建议

- **优先路线（已验证通过）**：ESP-IDF 5.5.4，工具链 `xtensa-esp-elf-gcc 14.2.0`。使用该版本编译官方固件可避开 GDMA API 适配工作
- **构建产物**：`stack-chan.bin` 3.6MB（0x397530 bytes），bootloader 23KB。分区表 27% 剩余空间（约 1.35MB）
- **IDF 5.5.4 子模块注意**：`git submodule update --init --recursive` 时 `openthread` 可能失败，需手动跳过
- **备选路线**：在 IDF v6.0 下对 `78/uart-uhci` 做 GDMA API 适配（`gdma_channel_alloc_config_t` + `gdma_new_ahb_channel()`），非阻塞但无紧迫需求
- `mqtt` 和 `json` 组件差异较小，已有 wrapper 方案可复用

## Consequences

- **正向**：基于更成熟的 ESP-IDF 生态，社区支持更好、调试工具更丰富（GDB, OpenOCD）
- **正向**：官方固件 AI Agent 开箱即用，减少重复开发
- **正向**：固件体积更小，资源占用更低
- **风险**：现有 `celebration` MOD 的完整庆祝系统（星星粒子、LED 彩虹、3 级强度）需要重新在官方固件上实现
- **风险**：双路径触发（直接 + LLM）的庆祝逻辑需要适配官方固件的表情/动画 API
- **风险**：Moddable 固件的现有多设备 WS Bridge 架构不再适用，需评估是否需要替代方案
- **风险**：官方固件设计目标为 ESP-IDF 5.5.4，在 IDF v6.0 下存在 `78/uart-uhci` GDMA API 不兼容等编译阻塞问题
- **已实现**：Kconfig 静态 WiFi 配置，`wifi_board.cc` 支持编译期预设 SSID/密码，无头部署可直接使用
- **局限**：Kconfig 是编译期配置，运行时切换 WiFi 仍需持久化存储方案
- **已验证**：固件构建成功（3.6MB，27% 分区剩余），烧录 5 个 bin 全部通过哈希校验，设备正常启动进入 setup wizard
- **已验证**：`POST /api/celebrate` 和 `GET /api/health` 端点已内置，烧录即用
- **已验证**：`http_control_start()` 已前移到 Mooncake 主循环前；启动前调用 `esp_netif_init()` 后，HTTP API 在 Mooncake 桌面阶段全程可用

## Search Terms

- `ESP-IDF`
- `m5stack/StackChan`
- `idf.py build`
- `POST /api/celebrate`
- `Moddable`
- `XS Engine`
- `ai_stackchan_api`
- `GDMA`
- `gdma_channel_alloc_config_t`
- `gdma_new_ahb_channel`
- `78/uart-uhci`
- `ESP-IDF 5.5.4`
- `OTA 双分区`
- `setup wizard`
- `Kconfig WIFI_SSID`
- `wifi_board.cc`
- `静态 WiFi 预配置`
- `openthread`
- `idf.py CWD`
- `cmake` `ninja`
- `mqtt 组件移除`
- `json 组件移除`
- `http_control_start`
- `esp_netif_init`
- `httpd_start`
- `main.cpp:31`
- `Mooncake`
- `celebrate_rgb`
- `192.168.0.168:8080`
