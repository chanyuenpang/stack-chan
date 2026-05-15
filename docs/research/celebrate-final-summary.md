# StackChan 庆祝链路续接 — 最终可行方案与限制

> 基于 stackchan-celebration-roadmap-v2 全部 14 个子任务调研产出。
> 日期：2026-05-16

---

## 1. 路径 A：零固件改动（推荐先走）

**原理**：MCP bridge 持续运行 → 小智获取 OpenClaw 任务完成事件 → 小智通过官方 messaging API 语音播报 + LED/动作。

**已验证**（任务 1-5）：
- ✅ MCP bridge 稳定运行（PID 2111506，5 tools，WS 无 1006）
- ✅ `get_plan_status` 被小智成功调用（`isError=false`）
- ✅ 官方 messaging 设备 tools 可触发 TTS/speak
- ✅ 低风险 LED/点头无问题

**能做什么**：
- 小智**语音播报**"恭喜完成任务！"
- 伴随设备**LED 闪烁**、**小幅点头**
- 完全不需要烧录固件

**限制**：
- 不能播放**自定义音频/音效**（assets 分区只读）
- 依赖 bridge 在线 + 网络可达
- 延迟取决于消息队列

---

## 2. 路径 B：固件最小补丁（后续可选）

**原理**：在原厂固件上只改 `hal_mcp.cpp`，新增 `self.robot.celebrate` tool，MCP 调用时触发本地灯效+动作+提示音。通过 OTA 下发自定义 `app.bin`。

**最小改造边界**（任务 9）：
- **只改一个文件**：`firmware/main/hal/hal_mcp.cpp`
- 注册 `self.robot.celebrate`，无参数
- callback 操作：`GetStackChan().motion()` / 灯效 / `app_play_sound()`
- 加 `LvglLockGuard`，不做网络请求，不读写 NVS
- **绝对不改**：ota.cc、application.cc、websocket/mqtt protocol、mcp_server.cc、settings、system_info、board.cc、CMakeLists、sdkconfig、分区表

**OTA 可行性**（任务 8/12/13/14）：
- ✅ 可写 `wifi.ota_url`：设备进配网 AP → POST `/advanced/submit` → `{"ota_url":"http://LAN_IP:8080/ota/"}`
- ✅ 设备端无签名校验（`# SECURE_BOOT is not set`，`# SECURE_SIGNED_APPS is not set`）
- ✅ OTA 只写 app slot，不擦 NVS（MQTT/WS 绑定保留）
- ✅ mock server 已就绪（`tools/ota-mock-server/`）
- ✅ 当前固件 `1.4.1`，mock version 设为 `1.4.2` 即可触发升级

**阻塞点**：
- 🔴 需要用户授权真机 OTA 测试
- 🔴 自定义 `app.bin` 必须匹配：分区表、`board type`、IDF version、flash size 16MB
- 🔴 若设备出厂 EFUSE 已开启 secure boot / flash encryption，则不可行（需串口确认）
- 🔴 新固件启动 20 秒内若崩溃，bootloader 会自动回滚

---

## 3. 路径 C：放弃固件侧能力

如果用户不接受任何刷写风险，只走路径 A。MCP bridge + TTS 已能满足"通知"这一核心需求，只是缺自定义灯效和音效。

---

## 4. 建议路线（风险升序）

```
Step 1 ─── 路径 A 验证（已完成）
           ├─ MCP bridge 稳定运行
           ├─ get_plan_status 调用成功
           └─ TTS 发声链路畅通

Step 2 ─── 实现庆祝逻辑
           ├─ OpenClaw 任务完成 → 通知小智
           ├─ 小智播报 + LED + 点头
           └─ 仅靠 messaging API 实现

Step 3 ─── 串口确认设备安全状态（如需 OTA）
           ├─ esptool.py flash_id 确认芯片
           ├─ 读取 eFuse 确认 secure boot / flash encryption
           └─ 读取当前分区表/nvs ota_url 状态

Step 4 ─── OTA 最小补丁（可选）
           ├─ 改 hal_mcp.cpp，编译 app.bin
           ├─ 启动 mock server
           ├─ 写 wifi.ota_url → mock server
           ├─ 触发设备 OTA 检查
           └─ 确认庆祝 tool 可用后，清空 ota_url
```

---

## 5. 硬限制（不能做的事）

| 事项 | 原因 |
|---|---|
| 播放自定义音频 | assets 分区只读，无自定义 OGG 嵌入路径 |
| 擦 NVS | 丢 MQTT/WS 绑定、WiFi 配置、board uuid |
| app.bin > 5 MB（0x4f0000） | ota slot 限制 |
| 改分区表 | OTA 后 bootloader 无法映射 |
| 改官方 OTA/activation/WS/MQTT 链路 | 服务端兼容性未知 |
| Arduino/UIFlow2/完全自研固件 | 无法复用官方登录/激活/协议 |
| 改 PROJECT_VER | 服务端可能按版本判断兼容性 |
| 关闭 `mcp: true` feature flag | 官方 MCP tools 不工作 |

---

## 6. 已交付的工具/脚本

| 工具 | 路径 | 用途 |
|---|---|---|
| OTA Mock Server | `tools/ota-mock-server/ota-mock-server.py` | 模拟 OTA 端点，本地验证设备连接 |
| 使用说明 | `tools/ota-mock-server/README.md` | 找 IP、启动、写 URL、观察日志、恢复 |
| ota_url 助手 | `tools/ota-mock-server/set-ota-url.sh` | 一键 `set/clear/official` |

本地验证通过：`/ota/` (GET/POST) → JSON manifest；`/stack-chan.bin` (GET/HEAD) → 3.6 MB 固件。
