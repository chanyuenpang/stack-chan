# Celebrate MCP Tool — 最小补丁设计文档

> 基于 `firmware/main/hal/hal_mcp.cpp` 和 StackChan 源码分析
> 日期：2026-05-16
> 前置任务：Task 1-3 (OTA 链路打通) ✅ — 设备已成功从 1.4.1 升级到 2.0.0

---

## 1. 概述

### 目标
在设备端注册 `self.robot.celebrate` MCP tool，当小智调用时执行柔和庆祝效果：
- LED 暖色呼吸渐变
- 头部小幅点头 (约 ±15°)
- 播放现有通知音效

### 设计原则
- **最小侵入**：只改一个文件 `hal_mcp.cpp`，新增约 50 行代码
- **零外部依赖**：不碰 OTA/分区表/NVS/协议层/CMakeLists
- **安全边界**：加 LvglLockGuard，不做网络请求，不阻塞主循环
- **离线可用**：全部效果在设备本地完成

### 交付形式
补丁通过 OTA（含补丁的 app.bin）下发。设备当前固件版本 2.0.0，mock server 设 version=2.0.1 触发升级。

---

## 2. MCP Tool 注册方案

### 注册调用

在 `hal_mcp.cpp` 的 `xiaozhi_mcp_init()` 末尾（`"self.robot.stop_reminder"` 注册块之后）添加新 tool：

```cpp
mclog::tagInfo(_tag, "add robot.celebrate tool");
mcp_server.AddTool(
    "self.robot.celebrate",
    "Perform a gentle celebration sequence: warm LED breathing, small head nod, and a soft chime.",
    std::vector<Property>{},  // 无参数
    [this](const PropertyList& properties) -> ReturnValue {
        mclog::tagInfo(_tag, "celebrate start");

        // 获取运动控制引用
        auto& motion = GetStackChan().motion();
        auto& left_led = GetStackChan().leftNeonLight();
        auto& right_led = GetStackChan().rightNeonLight();

        // T0: 暖黄 LED + 点头到 +15°
        {
            LvglLockGuard lock;
            left_led.setColor(120, 80, 0);   // 暖黄
            right_led.setColor(120, 80, 0);
            motion.pitchServo().moveWithSpeed(150, 150);  // 低头 15°
            motion.yawServo().moveWithSpeed(0, 150);
        }

        // T0+500ms: 灯光渐变白 + 点头回中
        vTaskDelay(pdMS_TO_TICKS(500));
        {
            LvglLockGuard lock;
            left_led.setColor(80, 80, 80);    // 柔和白
            right_led.setColor(80, 80, 80);
            motion.pitchServo().moveWithSpeed(0, 150);    // 回中
        }

        // T0+1000ms: 播放通知音
        vTaskDelay(pdMS_TO_TICKS(500));
        hal_bridge::app_play_sound(OGG_NEW_NOTIFICATION);

        // T0+1500ms: 暖黄 + 点头
        vTaskDelay(pdMS_TO_TICKS(500));
        {
            LvglLockGuard lock;
            left_led.setColor(120, 80, 0);
            right_led.setColor(120, 80, 0);
            motion.pitchServo().moveWithSpeed(150, 150);
        }

        // T0+2000ms: 回中 + 关灯
        vTaskDelay(pdMS_TO_TICKS(500));
        {
            LvglLockGuard lock;
            left_led.setColor(0, 0, 0);
            right_led.setColor(0, 0, 0);
            motion.pitchServo().moveWithSpeed(0, 150);
        }

        mclog::tagInfo(_tag, "celebrate done");
        return true;
    });
```

### 时序摘要

| 时间点 | LED | 头部 | 声音 |
|--------|-----|------|------|
| T0 | 暖黄 (120,80,0) | 低头 15° | — |
| T0+500ms | 柔和白 (80,80,80) | 回中 | — |
| T0+1000ms | 柔和白 | 回中 | `OGG_NEW_NOTIFICATION` |
| T0+1500ms | 暖黄 | 低头 15° | — |
| T0+2000ms | 关灯 | 回中 | — |

总时长 ≈ **2 秒**，非阻塞（使用 `vTaskDelay` + `moveWithSpeed` 异步）

---

## 3. 添加的头文件引用

在 `hal_mcp.cpp` 文件顶部的 include 段添加：

```cpp
#include <hal/board/hal_bridge.h>   // app_play_sound
#include <assets/assets.h>          // OGG_NEW_NOTIFICATION
#include <freertos/FreeRTOS.h>      // vTaskDelay
#include <freertos/task.h>          // pdMS_TO_TICKS
```

**说明**：
- `hal_bridge.h` 和 `assets.h` 可能已在工程间接包含路径中，显式 include 确保可用
- `FreeRTOS.h` + `task.h` 提供 `vTaskDelay`（栈上已有其他文件使用，同上）

---

## 4. 变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `firmware/main/hal/hal_mcp.cpp` | **修改** | 新增 `#include` + 注册 `self.robot.celebrate` tool |
| 其他文件 | **不改** | OTA/分区表/NVS/协议层/MCP server/board/CMakeLists/sdkconfig 均不动 |

### 绝对不改的文件

- `ota.cc` / `ota.h` — OTA 链路不动
- `application.cc` — 应用生命周期不动
- `mcp_server.cc` / `mcp_server.h` — 通用 MCP 框架不动
- `settings` / `system_info` — 配置/系统信息不动
- `board.cc` / `board.h` — 板级硬件不动
- `CMakeLists.txt` / `sdkconfig` / partitions.csv — 构建配置不动
- 任何 `hal_*.cc` / `drivers/` — 驱动层不动

---

## 5. 验证方法

### 5.1 编译验证

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan/firmware
. $HOME/esp/esp-idf/export.sh
idf.py build
```

确认编译通过，输出 `firmware/build/stack-chan.bin`。

### 5.2 OTA 下发验证

1. 确保 `stack-chan.bin` app version > 当前设备版本（设 PROJECT_VER=2.0.1）
2. 启动 mock server：
   ```bash
   cd tools/ota-mock-server
   python3 ota-mock-server.py --mode upgrade --port 8080 --firmware ../../firmware/build/stack-chan.bin
   ```
3. 在设备端 **Setup → Firmware → Check for Updates**
4. 确认 server 日志出现：`POST /ota/` → `GET /stack-chan.bin`
5. 设备重启后进入系统

### 5.3 功能验证

1. MCP bridge 侧发送：
   ```json
   {
     "type": "call_tool",
     "name": "self.robot.celebrate",
     "arguments": {}
   }
   ```
2. 观察设备：LED 暖黄 → 白渐变 + 点头 + 音效 → 关灯回中
3. 确认 `mcp_server` 日志无错误

---

## 6. 集成路径（Task 5 预览）

### 完整的庆祝链路

```
OpenClaw Plan Done
      ↓
OpenClaw Event (plan.completed)
      ↓
Webhook/MQTT → 小智云服务
      ↓
小智 Prompt 触发：
  "系统检测到任务完成，请说'恭喜完成任务！'
   并调用 self.robot.celebrate"
      ↓
小智 TTS 播报 + MCP 调用 celebrate
      ↓
设备端 LED 呼吸 + 点头 + 音效
```

### Task 5 设计要点（待完成）
- OpenClaw 端的 plan done webhook 发送到何处？
- 小智服务端如何接收并触发 prompt？
- Prompt 编写：包含 TTS 文本 + MCP tool call 指令
- 最小实现：直接通过 MCP bridge 的 `/invoke` 端点即可触发

---

## 7. 风险与限制

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `vTaskDelay` 阻塞 LVGL 主循环 | 短暂界面响应迟滞 | 总延迟 < 2s，允许，无需优化 |
| OTA 后设备 20s 内崩溃自动回滚 | celebrate tool 丢失 | 编译时确认 PROJECT_VER 正确递增 |
| 舵机 PWM 抖动/过载 | 点头幅度不准 | 幅度限制 ±15°，速度限制 150 |
| 官方 OTA URL 恢复覆盖自定义 URL | 补丁丢失 | OTA 成功后清空 `wifi.ota_url` |

---

## 8. 分步实施清单

- [ ] Step 1: 修改 `hal_mcp.cpp`，添加 celebrate tool（约 50 行）
- [ ] Step 2: `idf.py build` 编译验证
- [ ] Step 3: 启动 mock server upgrade 模式
- [ ] Step 4: 设备操作：Check for Updates → 等待 OTA → 重启
- [ ] Step 5: 小智调用 `self.robot.celebrate` 确认效果
- [ ] Step 6: 清空 `wifi.ota_url`，恢复官方 OTA 链路
- [ ] Step 7: 推进 Task 5（OpenClaw → 小智 prompt 链路设计）
