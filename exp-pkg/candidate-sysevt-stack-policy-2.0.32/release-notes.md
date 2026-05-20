# StackChan v2.0.32 - sys_evt 栈溢出与重启循环策略修复

## Changes since v2.0.31

- **sys_evt 任务栈扩至 8192**：`CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=8192`，解决 WiFi 连接阶段因栈溢出触发的 sys_evt task watchdog → 内部 panic → esp_restart 重启环
- **重启循环策略修复**：`fail_count` 超过 3 次后自动清除 `default_mode=xiaozhi` 持久路径，不再无限制尝试进入小智 → 消除 OTA 后因崩溃导致的无限重启环
- **版本**: 2.0.32
- **SHA256**: 9538ea1cab54a8dd3b7607515c4a99fbf4ab7aec14b3b6b02ade8b89685cdb95
- **大小**: 3,967,728 bytes
