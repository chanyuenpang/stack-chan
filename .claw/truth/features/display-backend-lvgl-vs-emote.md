# StackChan 显示后端：LVGL vs Emote

## 结论

StackChan 主固件使用 **LVGL** 作为显示后端，而非 Xiaozhi ESP32 原生的 **Emote** 表情动画显示系统。Emote 组件存在于子项目 `xiaozhi-esp32` 中但未被 StackChan 主构建使用。这是有意的架构选择，不是 bug 或配置遗漏。

## 长期行为 / 规则

- 主固件 `firmware/main/CMakeLists.txt` 中 `emote_display.cc` **被注释**（行 43: `# "display/emote_display.cc"`）。
- 子目录 `firmware/xiaozhi-esp32/main/CMakeLists.txt` 中 `emote_display.cc` **已启用**（行 20），但该路径是 xiaozhi-esp32 自身的构建，不是 StackChan 主固件的显示后端。
- StackChan 的 LVGL 显示方案独立于 Emote 事件系统；两者通过 Kconfig 做编译时选择。
- 默认情况下，StackChan 固件使用 LVGL 驱动 LCD panel，Emote 相关源文件不会被编译进 `stack-chan.bin`。
- 当前固件构建 `build-celebrate-fix`、`build-release-2.0.44` 均成功，不涉及 Emote 相关编译错误。

### 如果要启用 Emote 显示后端

如需从 LVGL 切换回 Emote 显示，需要同时做以下改动：

1. 启用 Kconfig 选项：`USE_EMOTE_MESSAGE_STYLE`（部分型号可能需要 `FLASH_EXPRESSION_ASSETS`）。
2. 取消注释 `firmware/main/CMakeLists.txt` 中的 `"display/emote_display.cc"`。
3. 确认 LCD panel 驱动与 Emote Display 类的绑定（`emote_display.cc` 中的 `EmoteDisplay` 实现）。
4. 注意 Emote 方案与 LVGL 方案在屏幕初始化、帧率控制和内存布局上的差异，编译前需做完整回归验证。

## Emote 事件系统（背景知识）

Xiaozhi ESP32 固件的 `esp_emote_expression` 组件通过事件驱动控制屏幕表情动画，事件类型（定义在 `emote_op.c:71-78`）：

| 事件常量 | 含义 |
| -------- | ---- |
| `EMOTE_MGR_EVT_IDLE` | 空闲 |
| `EMOTE_MGR_EVT_LISTEN` | 正在听 |
| `EMOTE_MGR_EVT_SPEAK` | 正在说 |
| `EMOTE_MGR_EVT_SYS` | 系统通知 |
| `EMOTE_MGR_EVT_BAT` | 电量状态 |
| `EMOTE_MGR_EVT_SET` | 设置/重置 |
| `EMOTE_MGR_EVT_QRCODE` | 二维码显示 |

通过 `emote_set_event_msg(handle, event_type, message)` 发送事件，驱动屏幕动画切换。

## 关联代码

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/CMakeLists.txt`（行 43） | `emote_display.cc` 被注释，决定 StackChan 主固件排除 Emote 显示后端 |
| `firmware/main/display/emote_display.cc` | EmoteDisplay 类实现，绑定 LCD panel + emote 引擎（未编译） |
| `firmware/xiaozhi-esp32/main/CMakeLists.txt`（行 20） | xiaozhi-esp32 自身构建中 `emote_display.cc` 已启用 |
| `firmware/main/Kconfig.projbuild` | Kconfig 配置 `USE_EMOTE_MESSAGE_STYLE` / `FLASH_EXPRESSION_ASSETS` |
| `xiaozhi-esp32/managed_components/espressif__esp_emote_expression/emote_op.c` | 事件处理核心，事件表路由 |
| `xiaozhi-esp32/managed_components/espressif__esp_emote_expression/emote_init.c` | emote 引擎初始化 |

## 已知陷阱

- **调查显示问题时不要先假设 Emote 已启用**：StackChan 默认使用 LVGL 显示，如果看到 `emote_display.cc` 或 `EMOTE_MGR_EVT_*` 相关代码，它可能只是 xiaozhi-esp32 子项目中的残留，不在 StackChan 主构建中生效。
- **`firmware/` 下有两个 CMakeLists.txt**：`firmware/main/CMakeLists.txt` 控制 StackChan 主固件，`firmware/xiaozhi-esp32/main/CMakeLists.txt` 控制 xiaozhi-esp32 独立构建。修改时不要混淆。
- **Emote 事件类型与 LVGL 显示逻辑无直接关联**：即使 LVGL 显示层监听了类似 event，其分发路径不经过 `emote_set_event_msg`。调试屏幕行为时应先确认当前使用哪个显示后端。

## 关键检索词

- `emote_display.cc`
- `LVGL`
- `EmoteDisplay`
- `esp_emote_expression`
- `EMOTE_MGR_EVT_IDLE`
- `EMOTE_MGR_EVT_LISTEN`
- `EMOTE_MGR_EVT_SPEAK`
- `EMOTE_MGR_EVT_SYS`
- `EMOTE_MGR_EVT_BAT`
- `EMOTE_MGR_EVT_SET`
- `EMOTE_MGR_EVT_QRCODE`
- `emote_set_event_msg`
- `USE_EMOTE_MESSAGE_STYLE`
- `FLASH_EXPRESSION_ASSETS`
- `firmware/main/CMakeLists.txt`
- `firmware/xiaozhi-esp32/main/CMakeLists.txt`
