# Celebrate MCP Tool — 代码补丁

## 文件列表

### 新增文件（需要复制到固件源码树）

| 源文件 | 目标路径 |
|---|---|
| `celebrate.h` | `firmware/main/apps/common/celebrate.h` |
| `celebrate.cpp` | `firmware/main/apps/common/celebrate.cpp` |

### 修改文件

| 补丁文件 | 目标文件 |
|---|---|
| `hal_mcp.cpp.patch` | 对 `firmware/main/hal/hal_mcp.cpp` 的修改 |

### 编译配置变更

- 在 `firmware/main/CMakeLists.txt` 的 `SRCS` 列表中添加 `apps/common/celebrate.cpp`
- 在 `firmware/main/CMakeLists.txt` 的 `INCLUDE_DIRS` 列表中添加 `apps/common`（如果还没有）

---

## 使用方式

### git apply 方式
```bash
# 1. 复制新文件
cp tools/celebrate-mcp-tool/celebrate.h firmware/main/apps/common/celebrate.h
cp tools/celebrate-mcp-tool/celebrate.cpp firmware/main/apps/common/celebrate.cpp

# 2. 应用补丁
cd firmware/main/hal
patch -p0 < ../../../tools/celebrate-mcp-tool/hal_mcp.cpp.patch

# 3. 更新 CMakeLists.txt（手动编辑）
```

---

## 测试方式（在真实设备上）

1. 编译并烧录固件
2. 通过串口确认 mcp_init 日志包含 `"add robot.celebrate tool"`
3. 在 AI prompt 中让 AI 调用 `self.robot.celebrate`（例如说"庆祝一下"）
4. 确认：
   - [ ] 播放提示音
   - [ ] 头部左右摇摆（Happy 跳舞动作）
   - [ ] LED 呼吸渐变（暖金 → 暖粉 → 关闭）
   - [ ] 约 4-5 秒后恢复待机状态
5. 确认 MCP 响应不阻塞：在庆祝过程中可以继续对话

---

## 依赖项

| 依赖 | 已有？ |
|---|---|
| `DanceModifier`（`dance.h`） | ✅ StackChan firmware |
| `neonLight` API | ✅ StackChan firmware |
| `app_play_sound`（`hal_bridge.h`） | ✅ StackChan firmware |
| `lv_timer` | ✅ ESP-IDF + LVGL |
| `mooncake_log` | ✅ StackChan firmware |
