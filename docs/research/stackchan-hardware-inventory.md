# StackChan 硬件清单与 Wi-Fi Audio 崩溃诊断边界

更新时间：2026-08-06

## 适用对象

本文描述当前实机 M5Stack StackChan，而不是泛化的社区 Stack-chan 结构或任意 CoreS3 开发板。本机已通过 ROM bootloader 核验为 ESP32-S3 rev 0.2、16 MB Flash；工厂 MAC 与既有备份记录一致。机密网络与配对信息不进入本文。

官方整机资料：

- https://docs.m5stack.com/en/StackChan
- https://docs.m5stack.com/en/core/StackChan_Core
- https://github.com/m5stack/StackChan
- https://github.com/m5stack/StackChan-BSP

## 整机组成

| 区域 | 已确认硬件 | 当前用途 |
| --- | --- | --- |
| 主控 | ESP32-S3，双核 LX7 240 MHz，16 MB Flash，8 MB Quad PSRAM | 固件、Wi-Fi/BLE、显示、音频与机器人控制 |
| 显示/触摸 | ILI9342C 320x240 LCD、FT6336U 电容触摸 | 表情、状态、配置与触摸交互 |
| 摄像/传感 | GC0308、LTR-553ALS-WA、BMI270、BMM150、BM8563 RTC、microSD | 摄像、环境/姿态、时钟与存储 |
| 音频输入 | ES7210，两个物理麦克风 | 24 kHz PCM 采集 |
| 音频输出 | AW88298 16-bit I2S 功放、1 W 扬声器 | 24 kHz PCM 播放 |
| 核心电源 | AXP2101 PMIC | 核心电源、充电、背光和电量状态 |
| 核心 IO 扩展 | AW9523B | AW88298/LCD 复位等板级 IO |
| 机器人机身 | 550 mAh 电池、两只 SCS0009 反馈舵机、12 颗 WS2812C、Si12T 三段触摸、ST25R3916 NFC、IRM56384 IR、INA226、PY32L020 | 独立供电、头部运动、灯光、触摸、NFC 与 IR |

## 当前固件的总线和引脚

### 音频 I2S0

定义位于 `firmware/main/hal/board/config.h`，实现位于 `firmware/main/hal/board/cores3_audio_codec.cc`。

| 信号 | GPIO |
| --- | ---: |
| MCLK | 0 |
| WS/LRCK | 33 |
| BCLK | 34 |
| ES7210 -> ESP32 DIN | 14 |
| ESP32 -> AW88298 DOUT | 13 |

产品模式使用一对 full-duplex I2S0 channel，TX/RX 都是 24 kHz、16-bit、standard stereo，共享 MCLK/BCLK/WS。ES7210 选择 MIC1 与 MIC2；输出把 mono PCM 复制到左右两个物理 slot。

### 共享 I2C1

`firmware/main/hal/board/stackchan.cc` 在 GPIO12/SDA、GPIO11/SCL 上创建 I2C1。当前代码与官方资料可确认的设备包括：

| 设备 | 地址/说明 |
| --- | --- |
| AXP2101 | `0x34` |
| AW9523B | `0x58` |
| FT6336U | `0x38` |
| AW88298 / ES7210 | 使用各自 codec 默认地址 |
| 机身 INA226 | 官方资料 `0x41`；当前固件未见使用 |
| 机身 ST25R3916 | 官方资料 `0x50` |
| 机身 Si12T | `0x68` |
| 机身 PY32L020 | 默认 `0x6F`，可配置 `0x71` |

这意味着电源、音频控制、触屏和机身 I2C 外设共享一条物理总线。当前固件只用 AXP2101 报告电量，没有读取机身 INA226，因此无法直接观测机身电池/负载压降。

### 机器人机身

| 功能 | 接口 |
| --- | --- |
| 两轴舵机 | UART1，TX GPIO6、RX GPIO7，1 Mbps；yaw ID 1、pitch ID 2 |
| 红外发送/接收 | GPIO5 / GPIO10 |
| 机身 I2C | GPIO11 / GPIO12 |
| 舵机 VM 使能 | PY32L020 IO0 |
| 12 颗 RGB | PY32L020 IO13/内部 LED 接口 |

`firmware/main/hal/hal_io_expander.cpp` 在启动时初始化 PY32L020、打开舵机 VM，并初始化 12 颗 RGB。舵机链路位于 `firmware/main/hal/hal_servo.cpp`。

## 电源、USB 与复位边界

- 整机有两个 USB-C 入口；官方说明两者都支持供电与数据，下载时推荐使用底座端口以避免电机动作造成意外。
- 短按 RST 复位 ESP32；它不等价于把 AXP2101、AW88298、机身电池和舵机 VM 全部断电。
- 长按 RST 约 3 秒进入下载模式；绿灯出现后释放。
- 官方硬件排查建议分别测试两个 USB-C 口，并允许拆开 Core 与机身进行隔离测试。
- 当前板级初始化会配置 AXP2101、通过 AW9523B 复位 AW88298/LCD，并打开机身舵机 VM。

## 当前构建的保护与盲区

当前 jitter-buffered 镜像来自 `firmware/build-wifi-audio-short/stack-chan.bin`，其 SHA-256 与刷入候选一致。实际构建配置为：

- ESP system event task stack：8192 bytes；已不是历史上发生过溢出的 4096 bytes 配置。
- Task watchdog：10 秒。
- Brownout detector：启用，level 7，interrupt 模式。
- OTA rollback：启用，但主程序会在 HAL 初始化后较早把当前 app 标记为 valid。
- Coredump：关闭；当前崩溃没有 flash/UART coredump 可供回溯。

## 当前崩溃的事实边界

已验证：

1. jitter-buffered 镜像完整写入 `0x20000` 并由独立 `verify_flash` 匹配。
2. 新固件曾启动、连接 Dock，并持续上传无 sequence gap 的麦克风 PCM。
3. 首次非零扬声器流在发送到约第 133 帧时出现 WebSocket `ECONNRESET`，随后 Wi-Fi 与 USB 观测面消失。
4. 设备后来曾在无 USB、电池供电下短暂回连并继续上传麦克风，但再次离线。
5. 用户确认短按 RST 后仅短暂闪屏，随后再次崩溃，无法完成可用启动。

尚不能确认：

- panic、task watchdog、brownout/电源锁死或外设总线异常中的哪一项是根因；
- AW88298 是否报告 fault，AXP2101/机身 INA226 在崩溃瞬间的电压和电流；
- RST 后持续供电的外设状态是否参与下一次启动失败；
- 扬声器播放崩溃与后续启动崩溃是否为同一个底层原因。

## 最小诊断顺序

1. 停止 PC Dock 后短按 RST。当前代码只有 WebSocket `Connect()` 成功后才创建 `wifi_speaker` task；这个实验区分“连接后 continuous I2S TX”与更早的板级/codec/供电路径。
2. 若 Dock 关闭后仍崩溃，进入下载模式并 app-only 写入已知可启动的 RX-only/safe-boot 候选；保持可恢复镜像和当前候选不变。
3. safe-boot 必须记录 `esp_reset_reason()`、早期启动阶段、heap/stack，并让功放输出与舵机 VM 默认关闭；不要先运行 tone。
4. 恢复稳定后分阶段启用：Core-only -> Wi-Fi -> microphone RX -> AW88298 open/mute -> continuous silence TX -> 低幅 tone -> 正常幅度 tone。每次只改变一个变量。
5. 后续生产候选应启用可持久化崩溃证据或等价的串口捕获，并增加 AXP2101、AW88298 fault 与机身 INA226 观测；在根因修复前不得宣称生产可用。
