# m5stack — Truth Index

## Features

| 文档 | 主题 | 检索词 |
| ---- | ---- | ------ |
| [features/github-api-http2-download-constraints](features/github-api-http2-download-constraints) | GitHub API 下载时 HTTP/2 断流问题及 HTTP/1.1 降级方案 | `api.github.com`, `--http1.1`, `断流`, `续传` |
| [features/stackchan-celebration-mod](features/stackchan-celebration-mod) | Stack-chan 庆祝 MOD 模块结构、强度系统与 LLM 集成；ai_stackchan_api 内置庆祝端点；双构建配置；XS Modules.has() 注册陷阱 | `celebrate`, `mod.js`, `llm-celebrate.js`, `celebration-star`, `FF_VICTORY_*`, `intensity`, `ai_stackchan_api`, `HttpServerService`, `manifest_local.json`, `manifest_build_cores3.json`, `Modules.has()`, `onRobotCreated`, `复合mod.js`, `http-server-service`, `ai-mod`, `协作式调度`, `单线程阻塞` |
| [features/xs-dev-setup-and-build-toolchain](features/xs-dev-setup-and-build-toolchain) | xs-dev CLI、Moddable SDK 8.1.1 与 ESP-IDF 6.0 工具链安装位置与环境配置；USB 串口烧录波特率约束 | `xs-dev`, `MODDABLE`, `ESP-IDF`, `esp32`, `xtensa-esp-elf-gcc`, `xs-dev doctor`, `esptool`, `115200`, `flash_args` |
| [features/http-control-init-order](features/http-control-init-order) | HTTP 控制初始化顺序：`esp_netif_init()` 必须在 `httpd_start()` 前调用，否则触发 `assert(tcpip_send_msg_wait_sem)` | `http_control_start`, `httpd_start`, `esp_netif_init`, `tcpip_send_msg_wait_sem`, `main/http_control.cpp` |
| [features/xs-engine-boot-crash-diagnostics](features/xs-engine-boot-crash-diagnostics) | XS 引擎启动立即崩溃诊断：on-launch.js 顶层 Piu UI 代码陷阱、死亡序列特征、无效恢复尝试、修复策略 | `XS 引擎崩溃`, `modRunMachineSetup`, `on-launch.js`, `new Skin()`, `new Style()`, `module evaluation`, `m5stack_cores3`, `erase_flash` |

## Architecture Decision Records

| 文档 | 主题 | 检索词 |
| ---- | ---- | ------ |
| [adr/switch-to-esp-idf-official-firmware](adr/switch-to-esp-idf-official-firmware) | 切换到 ESP-IDF 官方固件路线（accepted），放弃 Moddable/JS；复用内置 http_control 端点和 OTA 双分区策略；ESP-IDF 5.5.4 构建验证通过；Kconfig 静态 WiFi 预配置已实现；`http_control_start()` 前移到 Mooncake 主循环前并要求先 `esp_netif_init()` | `ESP-IDF`, `m5stack/StackChan`, `idf.py build`, `POST /api/celebrate`, `Moddable`, `XS Engine`, `GDMA`, `78/uart-uhci`, `ESP-IDF 5.5.4`, `OTA 双分区`, `Kconfig WIFI_SSID`, `wifi_board.cc`, `http_control_start`, `esp_netif_init`, `main.cpp:31`, `Mooncake` |
| [adr/stackchan-openclaw-plancomplete-bridge](adr/stackchan-openclaw-plancomplete-bridge) | OpenClaw ↔ Stack-chan Plan Complete 庆祝桥接架构 + 双构建路径简化 | `ws-bridge-server.js`, `plan-watcher.sh`, `plan_celebrate`, `inotifywait`, `POST /api/celebrate`, `ai_stackchan_api`, `manifest_local.json`, `manifest_build_cores3.json` |
| [adr/stackchan-direct-plan-complete-watcher](adr/stackchan-direct-plan-complete-watcher) | Plan Complete 由 Linux watcher 直连 Stack-chan 官方 `POST /api/celebrate` 端点（proposed），`SOUL.md` 仅作为行为说明/兜底 | `Plan Complete`, `completed`, `todo.json`, `SOUL.md`, `ws-bridge.js`, `ws-bridge-server.js`, `POST /api/celebrate`, `192.168.0.168:8080` |
| [adr/stackchan-wifi-bootstrap-from-manifest](adr/stackchan-wifi-bootstrap-from-manifest) | WiFi 启动配置引导：从 Manifest 自动回写偏好到持久化存储 | `main.ts`, `manifest_local.json`, `Preferences`, `ssid`, `password`, `bootstrapping` |

## 项目简介

M5Stack StickS3 开发项目，PlatformIO / Arduino IDE，集成 Stack-chan 固件。
