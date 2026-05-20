# StackChan v2.0.31 - Post-OTA 重启闭环修复

## Changes since v2.0.30

- **修复 OTA 后重启未闭环问题**：根因是 `create_launcher_view()` 中 `try_auto_open_ai_agent()` 在 `start_autonomous_ota_check_once()` 之前执行，若进入小智崩溃则未 mark valid → ESP-IDF rollback
- **早期 mark valid**：`app_main()` 在 HAL init 后立即调用 `Ota::MarkCurrentVersionValid()`，避免 Launcher-only 启动来不及确认新固件
- **新增持久默认路径**：OTA 成功后写入 `boot/default_mode=xiaozhi` + `boot/start_once=true` + `boot/fail_count=0`
- **fail_count 保护**：`default_mode=xiaozhi` 连续失败最多 3 次，避免永久重启环
- **日志增强**：增加 `BOOT-DIAG`（分区状态、OTA state）、`BOOT-MODE`（default_mode/start_once/fail_count）、`LAUNCHER-OTA`（任务创建、网络等待）详细日志
- **版本**: 2.0.31
- **SHA256**: b8c9e6f4a179a89c965e5d9ec1e060667b80dd2b9d64d3b63f8e842323bbe6c9
- **大小**: 3,967,472 bytes
