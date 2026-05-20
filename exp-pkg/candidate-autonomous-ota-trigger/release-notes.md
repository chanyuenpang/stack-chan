# StackChan v2.0.30 - Autonomous OTA Trigger

## Changes since v2.0.29

- **OTA 自动触发机制**：Launcher ready 后后台自动检查 OTA 版本，有新版本时自动下载升级
- **启动后自动进入小智**：OTA 升级成功后、reboot 前设置 `boot/start_once=true`、`boot/fail_count=0`，确保下次启动自动 open AI.AGENT
- **幂等保护**：同一启动周期只触发一次 OTA check，互斥锁防止重复 OTA 流程
- **安全失败**：无新版本 / 网络失败 / 下载失败时不重启，安全返回 Launcher
- **日志增强**：增加 `LAUNCHER-OTA` / `BOOT-MODE set_once source=ota_update` 日志便于调试
- **版本**: 2.0.30
- **SHA256**: 7a83eeb2db421af96a97d867cba55fcaeea7c83e506c5bc0ae971d8d978d9085
- **大小**: 3,963,984 bytes
