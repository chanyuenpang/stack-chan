# StackChan UIFlow2 控制模型

更新时间：2026-05-15

## 1. 核心结论

UIFlow2 不是“远程控制当前官方小智固件”的入口。

UIFlow2 的 StackChan 文档标题是：

```text
Flash Firmware & Run Code
```

它的控制链路是：

```text
M5Burner 烧录 StackChan UIFlow2 firmware
→ 设备运行 UIFlow2 MicroPython 固件
→ UIFlow2 Web IDE / Blockly / MicroPython
→ 通过 Wi-Fi 在线设备或 USB WebTerminal 推送/运行脚本
→ 脚本在设备本地控制硬件
```

因此它需要切换/烧录固件，会替换当前官方小智固件。

## 2. UIFlow2 控制链路

官方流程：

1. USB-C 连接 StackChan，进入下载模式。
2. 用 M5Burner 选择 StackChan 对应的 UIFlow2 firmware 烧录。
3. 烧录时配置 Wi-Fi、服务器、账号绑定、启动模式等。
4. 登录 UiFlow2 Web IDE，账号需与 M5Burner 一致。
5. 选择控制方式：
   - Wi-Fi 在线设备：设备连接 M5Stack 服务器，Web IDE 选择在线设备后推送/运行程序。
   - USB WebTerminal：浏览器 WebSerial 连接串口，进入编程界面。
6. 使用 Blockly / MicroPython 编写并运行程序。

## 3. 底层运行时

UIFlow2 底层是 MicroPython。

典型 API：

```python
from hardware.stackchan import StackChan
stackchan = StackChan(i2c=1, uart=1)
```

Blockly 是图形化层，最终对应 MicroPython API。

`RUN` 是把脚本推到 UIFlow2 固件上运行，不是控制官方小智固件。

## 4. 支持的硬件能力

### Servo

支持：

```text
set_servo_zero()
set_servo_power(True/False)
set_servo_torque()
set_servo_angle()
get_servo_angle()
set_servo_x_pwm()
```

范围：

```text
X / pan: 约 -135° ~ 135°
Y / tilt: 约 0° ~ 90°
```

### RGB LED

支持：

```text
set_rgb_color(color)
set_rgb_color(strip, color)
set_rgb_color(strip, index, color)
get_rgb_color(strip, index)
```

文档提到两条逻辑 RGB strip，每条 `0~5`。

### Speaker / WAV

支持：

```text
Speaker.begin()
Speaker.tone(freq, duration)
Speaker.setVolumePercentage()
Speaker.playWav()
Speaker.playWavFile(path)
```

### Display

支持 UI 和图像显示：

```text
M5.begin()
Widgets.setRotation()
Widgets.fillScreen()
M5.Lcd.show()
m5ui.M5Page
m5ui.M5Label
m5ui.M5Button
LVGL / m5ui
```

### 其他

还支持：

```text
Touch
Battery / power info
NFC
IR
Camera + DL 人脸检测追踪示例
```

## 5. 与 Arduino/BSP 的关系

| 方案 | 开发语言/环境 | 是否需要刷固件 | 运行模型 |
|---|---|---|---|
| Arduino/BSP | C++ / Arduino 或 ESP-IDF | 是 | 编译完整固件后烧录 |
| UIFlow2 | Blockly / MicroPython | 是，先刷 UIFlow2 MicroPython 固件 | 推送/运行 Python 脚本 |
| 官方小智固件 | StackChan App / 小智协议 | 已预装或官方 OTA | App 绑定、语音/AI、云端 MCP |

UIFlow2 的便利是：首次刷入 UIFlow2 固件后，可以反复推送 MicroPython 脚本，不必每次 C++ 编译烧录。

但它仍会替换当前小智固件。

## 6. 与当前小智 App 绑定的兼容性

未找到兼容证据。

原因：

1. UIFlow2 要烧录 M5Stack UIFlow2 MicroPython 固件。
2. 烧录后设备绑定到 M5Stack Community / UIFlow2 账号。
3. 小智 App 绑定依赖当前官方小智固件、初始化流程、云端/设备协议。
4. 官方文档没有说明 UIFlow2 可作为官方小智固件上的远程控制层。
5. 未发现官方小智固件内置 UIFlow2 MicroPython runtime。

因此若刷 UIFlow2，基本应视为：

```text
当前官方小智固件被替换；小智 App 绑定/初始化链路失效；需刷回小智固件才能恢复。
```

## 7. 对当前项目的定位

UIFlow2 不适合作为当前主线，因为当前目标是尽量保留官方小智固件和 App 绑定。

UIFlow2 适合：

- 硬件能力验证；
- 快速原型；
- 了解 M5Stack 官方如何抽象 servo / RGB / speaker / display；
- 如果未来允许牺牲小智 App 绑定，可用于快速 Demo。

UIFlow2 不适合：

- 不刷固件远程控制；
- 保留官方小智绑定同时控制硬件；
- 给当前小智固件增加 celebrate tool。

## 8. 当前建议

主线仍应优先研究：

```text
基于官方小智固件源码的小改
→ 新增 self.robot.celebrate / self.robot.set_led_effect
→ 通过 OTA 或 app 分区替换保留 NVS/绑定
```

UIFlow2 仅作为 B/C 计划，不作为保留小智绑定的方案。
