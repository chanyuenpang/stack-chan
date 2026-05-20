# StackChan v2.0.33 - 小智 OTA 主线候选 (xiaozhi-ota-route)

## Changes since v2.0.32

- **Launcher OTA 纠偏**: Launcher 不再默认 autonomous OTA / start_network；小智路线 auto-open AI.AGENT 优先，Launcher OTA disabled/skip 日志清楚
- **小智路线全自动**: OTA 成功后设置 `default_mode=xiaozhi`、`start_once=false`、`fail_count=0`，日志 `route=xiaozhi_ota`
- **重启循环防护**: `fail_count` ≥3 时 fallback launcher 并清零，消除 OTA 后因崩溃导致的无限重启环
- **sys_evt 栈 8192**: `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=8192`，解决 WiFi 连接阶段因栈溢出触发的重启环
- **版本**: 2.0.33
- **SHA256**: 9600bba097c160053df49f5eaf792be8ef74bd13e2597096a490ca124ec4b81e
- **大小**: 3,966,480 bytes
