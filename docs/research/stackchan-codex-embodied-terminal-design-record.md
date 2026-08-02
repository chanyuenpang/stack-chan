# Stack-chan × Codex 具身交互终端设计记录

**状态：Windows Dock + ESP-IDF Codex Companion MVP 已实现并完成真机验收**
**日期：2026-08-01 至 2026-08-02**

> 2026-08-02 更新：本轮产品方向已收束为 Windows Dock + ESP-IDF 原生固件。下文关于
> Moddable Host、MOD、字幕和相机的内容保留为历史研究证据，不再构成本轮 MVP 运行时或范围。

## 目标与当前结论

目标是把 Stack-chan 演进为桌面端唯一 Codex Voice 会话的具身交互终端：用户通过机器人说话和聆听，同时能从屏幕、头部动作、灯光和触摸反馈中感受到一个有性格的角色，而不是一副带屏幕的通用耳麦。

当前 MVP 已完成标准 USB 麦克风/扬声器、CDC 控制与事件面、Windows Dock 生命周期、SI12T 音频数据通路控制、
表情/LED/舵机白名单以及 Dock 上的 MCP 工具。摄像头、动态字幕和触摸控制 Codex Voice 生命周期明确不在本轮范围；
Codex Voice 仍是桌面端唯一会话所有者。

## 已确认的职责分层

1. **机器人固件**：驱动传感器、音频、摄像头、屏幕、舵机和灯光；执行硬件安全限制与必要的本地即时反馈。
2. **PC Companion Runtime**：作为完整机器人驱动/适配层，维护与机器人的认证连接，接收输入事件，暴露 Windows 设备或本地 API，协调状态与资源占用。
3. **Codex 插件**：安装并连接 Companion 提供的 MCP 工具与行为指导；不承担实时媒体传输。
4. **Codex Voice**：保持桌面端唯一语音会话，承载对话、语义和角色性格。

该分层已在本轮落地为 UAC2 + CDC-ACM、typed Dock API 与 stdio MCP；协议和失败方向见后续证据记录。

## 官方固件策略

复用 Stack-chan 官方硬件平台和现有驱动，在其上增加面向 Codex 的应用层；不模拟或兼容小智云协议。小智现有实现只作为硬件驱动、状态机和交互方式的参考。

## 第一步：硬件到 Windows 的接口盘点

| 能力 | 当前建议的 Windows 表示 | 当前代码事实与边界 |
| --- | --- | --- |
| 麦克风 / 扬声器 | Windows 标准音频输入/输出设备 | USB UAC2 MVP 已在 CoreS3 真机验证：Windows 使用系统驱动枚举出一个麦克风和一个扬声器，固件把双向 PCM 接入 ES7210/AW88298 codec。它仍只是实时 Voice 媒体面，不是完整机器人接口。 |
| 摄像头 | 首阶段优先 Companion 的 `camera.capture`/JPEG 接口；只有需要被任意 Windows 视频应用持续使用时，才评估 UVC/虚拟摄像头 | CoreS3 摄像头已初始化并支持 `Capture()`；上游 MCP 有 `self.camera.take_photo`。当前构建明确未启用 USB UVC（`CONFIG_ESP_VIDEO_ENABLE_USB_UVC_VIDEO_DEVICE` 未设置），因此目前不是 Windows 摄像头设备。 |
| 屏幕触摸 | Companion 事件流中的语义事件，不把机器人屏幕模拟成 Windows 触摸屏或鼠标 | FT6336 每 20 ms 轮询，现有点击只在机器人本地切换小智会话；没有 LAN/USB 上行事件。 |
| 头部抚摸传感器 | Companion 事件流中的 `press`、`release`、`swipe_forward`、`swipe_backward`，上层再归并为少量交互意图 | SI12T 每 50 ms 读取并产生上述内部事件；当前只由 `HeadPetModifier` 消费，尚未导出到 PC。 |
| 头部舵机 | Companion 命令 API / MCP，不模拟为 Windows 设备 | 已有读取角度、按角度或内部目标值转头的 MCP 工具，并包含角度、速度、非阻塞和总线安全限制。 |
| LED | Companion 命令 API / MCP，不模拟为灯光外设 | 已有 `self.robot.set_led_color`，控制机器人内部左右灯，参数有安全亮度范围。 |
| 显示 / 表情 | Companion 的语义显示 API / MCP，不模拟为第二显示器 | 固件头像支持表情、装饰和状态文字；当前小智状态机会直接设置 listening/speaking 等显示状态，但尚无面向 PC Companion 的完整统一接口。 |

建议的最小 Windows 集成边界是“两面结构”：

- **标准设备面**：仅承载确实需要被 Windows 应用直接消费的连续媒体，当前即麦克风和扬声器；摄像头是否加入取决于连续视频需求。
- **机器人控制面**：由本地 Companion 暴露一个稳定的命令接口和一个有序事件流。命令至少覆盖状态查询、转头、灯光、表情/显示和拍照；事件至少覆盖屏幕触摸、头部抚摸、连接状态和时间戳。

不建议把触摸、抚摸、舵机、LED 或表情模拟成键盘、鼠标、HID 或显示器。它们是机器人语义，不是通用 PC 外设语义；设备模拟会丢失来源、状态和安全边界。若未来确实需要触发 Windows 快捷键，可在 Companion 上增加可选适配器，但不作为规范接口。

## 已验证：USB UAC2 音频 MVP（2026-08-01）

本轮只验证标准音频设备面，不代表完整机器人方案已经选定或完成。

- 固件使用 `espressif/usb_device_uac 1.3.1` 与 `espressif/tinyusb 0.19.0~3`，通过 ESP32-S3 USB OTG 暴露 `VID_303A&PID_8000` 复合设备。
- Windows 使用系统音频栈枚举出 `麦克风 (usb uac)` 与 `扬声器 (usb uac)`，无需另装音频驱动。
- 设备原生格式为 24 kHz、16-bit、mono capture/render。WDM-KS 可见原生 24 kHz mono；WASAPI 共享模式把麦克风呈现为 48 kHz stereo，由 Windows Audio Engine 做重采样/通道转换，扬声器仍为 24 kHz mono。
- 60 秒双向并发实测通过：麦克风 60.200 秒、2,889,600 个共享模式帧，峰值 8694、RMS 308.66；扬声器 60.220 秒、1,445,280 帧；两端均无 overflow/underflow。
- 三次物理拔插后均恢复。Windows 记录的三次重新到达时间为 16:52:58、16:57:05、16:57:26；第三次恢复后的 3.2 秒双向复测再次通过，无 overflow/underflow。
- ESP32-S3 的 USB OTG 与 USB Serial/JTAG 共用 PHY。UAC 运行时 COM 口会消失；需要刷写恢复时，可让设备重新进入 USB 下载模式，再使用串口下载通道。

当前实现边界与遗留风险：

- 尚未验证 Codex Voice 对该端点的选择、会话生命周期或长期运行稳定性。
- 尚未验证声学回声消除、啸叫抑制、端到端延迟、音量/静音控制和不同 Windows 主机兼容性；MVP 的 UAC mute/volume callbacks 未接入 codec。
- UAC MVP 启用时会占用 codec，并抑制小智自动会话入口，避免两个实时音频所有者并发访问；这不是最终应用状态机。
- 麦克风/扬声器通过不等于产品完成。触摸、抚摸、摄像头、显示、灯光、头部运动和 Codex MCP/Companion 控制面仍属于后续工作。

## 已知输入事实

- 机器人没有可用的交互按钮，电源键不承担日常对话控制。
- 屏幕触摸硬件和本地点击回调存在，但事件目前没有跨 LAN/USB 输出。
- 头部抚摸传感器能够区分按下、释放和前后滑动，但事件目前只在固件内部使用。
- 最终对外输入应保持简单，可归并为少量幂等请求，例如启动/关闭 Codex Voice、打开/关闭麦克风；具体手势到请求的映射仍未决定。

## 候选架构方向（均未决定）

### A. Windows 标准音频设备 + 独立机器人控制通道

- 优点：Codex Voice 直接使用标准音频；媒体和行为控制解耦；最贴合现有音频映射。
- 代价：PC 需要把 Voice 活动与机器人表现进行额外协调；触摸/抚摸仍需新增上行事件通道。

### B. PC Companion 统一拥有音频、事件和行为控制

- 优点：状态仲裁、回声处理、资源占用和具身同步集中，产品边界清晰。
- 代价：Companion 更复杂，成为实时链路的关键故障点；仍需向 Windows 暴露标准音频端点。

### C. 机器人侧承担更多会话状态，PC 仅转接 Codex

- 优点：可保留更多离线即时反馈，网络短暂波动时更像独立角色。
- 代价：容易形成两个会话状态源，与“桌面端唯一 Codex Voice 会话”冲突；也更接近重建小智式协议，因此目前不是讨论起点。

当前讨论起点是 A/B 的分界，而不是在两者之间作最终选择。

## 第二步：具身同步（暂不展开）

音频 Windows 边界已经完成 MVP 验证。下一步仍需先收束其余硬件接口，再研究 Voice 生命周期、用户说话、Codex 思考/说话与屏幕、头部、LED 的同步。角色性格由 Codex Voice 呈现；Companion 把语义意图映射为动作；固件保留安全限制和低延迟本地反射。

## 当前可复用能力与缺口

可复用：CoreS3 音频与摄像头驱动、FT6336 触摸采样、SI12T 抚摸识别、头像渲染、舵机控制、内部灯光、状态查询、局域网开发 HTTP/MCP 调用以及 Avatar WebSocket 的头像/运动/摄像头控制类型。

主要缺口：触摸和抚摸事件没有可靠上行；PC 可调用的拍照和完整显示接口尚未统一；现有局域网开发 HTTP 是编译期开关、明文 HTTP，并带默认开发令牌；Avatar WebSocket 与小智应用生命周期分离，不能直接视为统一 Companion 协议。

## 开放问题

- 已验证 UAC 的基本双工与三次拔插恢复；其回声消除、端到端延迟、长期稳定性和 Codex Voice 实际会话表现能否满足产品要求？
- 摄像头的第一需求是按需拍照，还是 Windows 应用可见的连续视频设备？
- Companion 与固件使用一个认证的双向 LAN 通道，还是保留媒体与控制的独立通道？
- 屏幕点击和抚摸如何映射为四个简单会话/麦克风请求，怎样避免 toggle 歧义和重复触发？
- 显示/表情 API 应暴露低级绘制能力还是有限的语义状态集合？
- PC、Codex Voice 与固件发生状态冲突或断线时，谁拥有最终状态，怎样安全恢复？

## 证据入口

- `firmware/main/hal/board/stackchan.cc`：摄像头、触摸屏和音频硬件初始化。
- `firmware/main/hal/hal_head_touch.cpp`、`firmware/main/stackchan/modifiers/head_pet.h`：抚摸识别与本地反馈。
- `firmware/main/hal/board/stackchan_display.cc`：屏幕点击、本地头像和修饰器。
- `firmware/main/hal/hal_mcp.cpp`：头部、LED 和庆祝动作工具。
- `firmware/xiaozhi-esp32/main/mcp_server.cc`：现有拍照工具。
- `firmware/main/hal/hal_dev_local_control.cpp`、`firmware/main/hal/hal_ws_avatar.cpp`：现有 LAN 控制面及其边界。
- `firmware/main/hal/usb_uac_mvp.cpp`、`firmware/main/hal/usb_uac_mvp.h`：USB UAC 与 CoreS3 codec 的双向 PCM 桥接。
- `firmware/main/idf_component.yml`、`firmware/main/Kconfig.projbuild`、`firmware/sdkconfig.defaults`：UAC 组件、MVP 开关和 USB 音频描述符配置。
- `firmware/sdkconfig`：本地构建配置；USB UVC 与 HID 未启用。

## 2026-08-02：Codex Companion MVP 决定性证据检查

### 工作区与证据边界

- 当前分支为 `codex/research/codex-voice-integration`，检查时 HEAD 为
  `c46a2451bfc7b50a73ef470af171ca86910667e0`。
- 工作区在本轮开始前已非 clean。既有改动包括本文件、`firmware/main/CMakeLists.txt`、
  `firmware/main/Kconfig.projbuild`、`firmware/main/hal/audio.cpp`、
  `firmware/main/idf_component.yml`、`firmware/main/main.cpp`、
  `firmware/sdkconfig.defaults`，以及未跟踪的 `firmware/main/hal/usb_uac_mvp.*`、字幕调试日志和
  多批实验产物。本轮不得 reset、discard、覆盖或误提交这些既有内容。
- `docs/research/stackchan-codex-caption-debug-log.md` 证明 Moddable Host + Windows Dock 的实验曾经
  遇到字幕重绘反压、进程在设备重启后退出等问题。这些结果只作为“必须限流、必须自动重连”的研究证据；
  Moddable Host、MOD、Piu `SpeechBalloon`、字幕和 factory app `0x10000` 写入路径均不进入本轮产品架构。

### 可恢复的 ESP-IDF UAC 基线

- 当前 UAC 实现位于 `firmware/main/hal/usb_uac_mvp.cpp`：`uac_output_callback()` 把 Windows
  speaker 的 s16 PCM 送入 `AudioCodec::OutputData()`；`uac_input_callback()` 从
  `AudioCodec::InputData()` 取样并下混为 mono；`start_stackchan_usb_uac_mvp()` 启动 codec 后调用
  `uac_device_init()`。采样格式由 `firmware/sdkconfig` 固定为 24 kHz、16-bit、mono capture/render。
- 当前实现尚未接入 `set_mute_cb`/`set_volume_cb`，也没有公开 UAC `mic_active`/`spk_active`、机器人侧
  数据通路 enable 状态或查询 API。触摸启停必须在保持 USB 接口持续枚举的前提下门控 PCM：麦克风关闭时
  返回静音帧，扬声器关闭时消费并丢弃主机帧；不能通过反复注销 UAC 接口实现 toggle。
- `firmware/build/stack-chan.bin` 为 3,704,656 字节，ESP-IDF image checksum 与 validation hash 均有效；
  SHA-256 为 `0F337C50084C739EE44D77663506F9CC4236E01AD285DD097B1F2C56C180C07F`。当前 build 使用
  ESP-IDF 5.5.5。`firmware/build` 中的 bootloader、partition table、OTA data、assets 和 app 与
  `backups/stackchan-uac-20260801-180000/uac-build-images` 对应文件逐一 SHA-256 相同。
- 两份完整备份 `full-flash-read1.bin`、`full-flash-read2.bin` 均为 16,777,216 字节，重新计算的
  SHA-256 均为 `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`。

### 触摸输入能力

- 头部 SI12T 路径已经是可复用的语义事件源：`firmware/main/hal/hal_head_touch.cpp` 每 50 ms 读取
  三段强度，`GestureRecognizer` 产生 `Press`、`Release`、`SwipeForward`、`SwipeBackward`，并通过
  `GetHAL().onHeadPetGesture` 发出。`firmware/main/stackchan/modifiers/head_pet.h` 已证明订阅和断开该信号的
  生命周期模式可用。
- 屏幕 FT6336 在 `firmware/main/hal/board/stackchan.cc` 每 20 ms 更新触点；
  `firmware/main/hal/board/stackchan_display.cc` 当前只把 avatar click 绑定到小智本地会话 toggle。
  本轮“机器人触摸”优先使用头部 SI12T 的稳定语义手势，避免把屏幕点击继续绑定到已排除的小智会话语义。
- MVP 映射应是确定性状态设置而非含糊的会话 toggle：手势只改变机器人 `mic_data_enabled` 和
  `speaker_data_enabled`；Codex Voice 会话的启动、关闭、静音和结束不在固件事件语义中。确切手势映射和
  防抖/幂等协议在实现任务中固定并通过真实事件验收。

### 屏幕、LED 与舵机能力

- 屏幕/表情：`StackChanAvatarDisplay::SetEmotion()` 已有受限字符串到
  `Neutral/Happy/Angry/Sad/Sleepy/Doubt` 的映射，`SetStatus()` 可驱动头像、口型、文字和状态灯。
  Companion 应复用这些受锁保护的底层入口，只暴露有限枚举，不提供任意 LVGL 绘制或文本执行。
- LED：`self.robot.set_led_color` 已在 `firmware/main/hal/hal_mcp.cpp` 使用左右 `NeonLight::setColor()`，
  且参数限制为每通道 `0..168`。该安全范围可复用到 USB 白名单命令。
- 舵机：同文件已有 `get_head_angles`、`set_head_angles` 和 `set_head_targets`；自然交互建议 yaw/pitch
  在正负 45 度附近，绝对范围 yaw `-128..128`、pitch `0..90`，速度 `100..300`。MVP 对外只保留角度制
  的安全命令与查询，不暴露内部 target 或任意动作序列。
- 这些现有 MCP 工具属于小智/既有服务器路径；UAC MVP 在 `main.cpp` 中会抑制小智自动会话入口。
  因而应复用其底层能力和参数约束，而不是把现有 MCP server 当作 Dock 已可用的控制通道。

### USB 复合设备结论

**决定：MVP 使用 UAC2 + CDC-ACM 复合设备；vendor bulk 仅作 CDC 实测失败后的替代，HID 不进入首选实现。**

证据与取舍：

1. 当前 `usb_device_uac` 1.3.1 的 `CONFIG_USB_DEVICE_UAC_AS_PART` 是明确的复合集成入口：启用后组件
   不再注入独占 TinyUSB 描述符，并要求调用方提供 speaker/mic interface number；
   `uac_device_config_t::skip_tinyusb_init` 允许由统一复合设备层初始化 PHY、TinyUSB task 与描述符。
2. 现有独占 UAC 描述符使用 EP1 OUT（speaker）、EP1 IN（feedback）和 EP2 IN（microphone）。ESP32-S3
   官方 ESP-IDF 5.5 文档给出的上限是 5 个 IN/OUT 端点加 1 个额外 IN 端点，并明确支持 composite、CDC、
   HID 和 vendor-specific class。加入 CDC 的通知 IN 与 bulk IN/OUT 后仍在端点预算内。
3. CDC-ACM 使用 Windows inbox driver，Dock 可按 VID/PID、USB serial/interface identity 发现设备，不依赖固定
   `COM7`；拔插后 COM 号变化必须视为正常。vendor bulk 虽少用一个端点编号，但 Windows 侧还需 WinUSB/MS OS
   descriptor 或驱动绑定以及相应用户态依赖，会扩大 MVP。HID 也可免驱，但其 report/interrupt 模型没有给当前
   有序状态同步、事件和请求响应带来可证明的优势。
4. CDC 只承载带版本、长度、消息类型、request id 和校验/边界检查的协议帧。固件端采用固定白名单 dispatch；
   禁止 shell、任意命令名、任意内存/设备访问和透传。音频继续走 UAC，不经过 CDC。

官方端点与复合设备依据：
<https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/peripherals/usb_device.html>。

### 设备写入与恢复门禁

本节只是门禁记录，不代表当前设备身份已经在本任务中重新读取，也不授权写入。

1. 任何写设备动作前，将设备进入 download mode 后，先用 esptool 读取并核对芯片为 ESP32-S3 rev 0.2、
   factory MAC 为 `44:1b:f6:e2:78:a8`；`COM7` 只能作为候选端口，端口变化时必须按芯片身份确认。
2. 再次验证两份 16 MB full-flash backup 的大小与上述 SHA-256，并保证
   `backups/stackchan-uac-20260801-180000/RECOVERY.md` 可读。
3. 首轮固件实验只允许写新构建的 app artifact 到 `ota_0`：offset `0x20000`，分区范围
   `0x20000..0x50ffff`（size `0x4f0000`）。写前记录 artifact 的绝对路径、字节数、SHA-256 和
   `esptool image_info` 结果，写后执行 `verify_flash`。
4. 不使用 `erase-flash`；不写 bootloader `0x0`、partition table `0x8000`、NVS `0x9000`、OTA data
   `0xd000`、PHY `0xf000`、assets `0xa00000` 或其他分区。若后续代码证据确实要求改变分区或启动链，必须先
   单独更新本门禁和恢复方案，再说明并取得相应授权。
5. 可执行恢复分两级：优先将已验证的 UAC `stack-chan.bin` 写回 `0x20000`；若 app-only 恢复失败或设备状态
   被证明跨分区损坏，才按 `RECOVERY.md` 在重新核对身份后把完整备份写回 `0x0` 并 `verify_flash`。完整恢复会
   覆盖 NVS 等设备状态，因此不是常规回退手段。

### 当前风险与下一计划输入

- 复合描述符与 CDC 协议尚未实现/编译，UAC+CDC 的 Windows 枚举与并行压力仍需真机证明。
- 当前 UAC 的 `mic_active`/`spk_active` 是组件私有 USB alternate-setting 状态，不等同于机器人数据通路开关；
  需要单独、线程安全、可查询并能通过 CDC 同步的状态模型。
- Dock 必须按设备身份重新发现新 COM 接口并使用退避重连，不能在断连时退出；状态同步需要启动快照、带序号事件
  和重连后的重新同步，避免 toggle 漂移。
- 固件控制 dispatch、Dock API 与 MCP 必须共用同一份有限 schema/白名单语义；MCP 不能新增底层协议没有的
  任意入口。

## 2026-08-02：UAC2 + CDC-ACM 复合固件本地实现证据

本节完成正式 plan 任务 #4 的本地实现与构建验证；没有连接、识别或写入真实设备，Windows 枚举与并行音频表现仍留给真机验收。

### 复合描述符与 TinyUSB 所有权

- `usb_device_uac` 以 `CONFIG_USB_DEVICE_UAC_AS_PART=y` 构建，但仍由该组件通过
  `uac_device_init(skip_tinyusb_init=false)` 唯一初始化 USB PHY 和 TinyUSB task；应用只接管复合描述符回调，
  没有创建第二个 TinyUSB 实例。
- 新复合 VID/PID 为 `303A:8001`，避免 Windows 把新接口集合复用到旧 UAC-only `303A:8000` 的缓存身份；USB serial
  由 factory MAC 生成，不依赖固定 COM 号。
- 保留已验证的 UAC 接口 0/1/2 和端点：speaker `0x01` OUT、feedback `0x81` IN、microphone `0x82` IN；
  CDC control/data 使用接口 3/4，notification `0x83` IN、data `0x04` OUT、`0x84` IN。编译期
  `static_assert` 同时验证复合描述符总长度。
- 复合模式需要让 TinyUSB、UAC component 和应用目标看到同一份 `CFG_TUSB_MCU=OPT_MCU_ESP32S3`、
  `CFG_TUD_CDC=1` 和 CDC FIFO/endpoint 配置。最初仅给应用增加 `tusb.h` include 会因缺少 MCU 编译契约而导致
  `CFG_TUSB_MCU must be defined`，同时使 FreeRTOS include 前缀失效；最终在 `firmware/main/CMakeLists.txt`
  统一三个目标的配置后通过。这是后续升级 TinyUSB/UAC 组件时必须保留的构建契约。

### 有界协议、数据通路与安全入口

- CDC 使用 newline-delimited JSON v1，单帧上限 511 bytes。请求必须带正整数 `id`、`v: 1`、固定 `cmd` 和 object
  `args`；响应回显 `id`，异步事件带单调 `seq`。超长帧会一直丢弃到下一个 newline，再由命令 worker 返回
  `frame_too_large`，CDC RX callback 自身只做有界读取和入队。
- 固件白名单严格为 `get_status`、`set_audio`、`set_expression`、`set_led`、`get_head`、`set_head`；未知命令返回
  `unknown_command`，不存在 raw/shell/exec/passthrough 入口。表情只接受 `neutral/happy/angry/sad/doubtful`；LED
  每通道限制 `0..168`；头部限制 yaw `-128..128`、pitch `0..90`、speed `100..300`。
- LED 和舵机命令复用 `stackchan_mcp_dispatch_tool()` 的现有加锁与动作调度入口；显示只调用受限的
  `Display::SetEmotion()`，没有暴露任意 LVGL 或设备调用。
- `mic_data_enabled` 与 `speaker_data_enabled` 是独立 atomic 状态并带 revision。关闭麦克风时仍为每个 UAC 请求返回
  等长静音帧；关闭扬声器时仍消费主机帧但不送 codec，不改变 UAC 枚举。SI12T `SwipeForward` 确定性地启用两条
  机器人音频数据通路，`SwipeBackward` 确定性地停用两条通路；Press/Release/Swipe 事件均上报，且不控制 Codex
  Voice 会话生命周期。

### 本地构建、测试与 app-only artifact

- 环境：ESP-IDF 5.5.5，`espressif/usb_device_uac 1.3.1`，`espressif/tinyusb 0.19.0~3`。`idf.py build`
  成功；编译器实际编译 `usb_uac_mvp.cpp` 并通过描述符静态断言，最终 app 占用 `0x38c4e0`，小于 ota_0
  `0x4f0000`，剩余 `0x163b20`（28%）。
- `python -m unittest main.tests.test_usb_companion_contract -v`：10/10 通过，覆盖 UAC AS_PART、接口/端点预算、
  精确命令白名单、参数范围、帧版本/id/seq、两个 endpoint atomic 状态均无条件更新、麦克风静音帧、扬声器丢弃和
  SI12T 确定性状态映射。
- 紧接着第二次执行相同 `idf.py build` 只运行 4 个尺寸/bootloader 检查步骤，没有重新编译或链接；app SHA-256
  仍为下述值，证明当前输入下的增量重建可复现。
- app-only artifact：`D:\Users\chany\Documents\StackChan\firmware\build\stack-chan.bin`；size
  `3,720,480` bytes；SHA-256 `60972150B666D82E6FE78E06983672BDFF72C363820715148B88BB71515C66DF`。
- `esptool.py 4.12.0 image_info`：ESP32-S3 image v1，entry `0x40379718`，6 segments，checksum `0xf8`
  valid，validation hash `820b051ec856ecd4d81d784d79759d36ae01635455849586a5cf3f16a6e04993` valid。
- 未来任务 #7 只能在重新通过设备身份与备份门禁后，把上述 app 写到 `0x20000`；按当前 size，实际写入范围为
  `0x20000..0x3ac51f`，完全位于允许的 ota_0 `0x20000..0x50ffff`。本任务没有执行 flash、erase、verify_flash
  或任何其他设备写入。

## 2026-08-02：Windows Dock 设备生命周期与 typed API

### 产品实现

- 正式 Dock 位于 `tools/stackchan-dock`，使用 Node.js ESM 和已锁定的 `serialport 13.0.0`；不是
  `C:\stack-chan-dock` 实验目录的延续。`npm audit --omit=dev` 报告 0 vulnerabilities。
- 发现规则固定为 `VID 303A / PID 8001`，若 Windows PnP identity 暴露 composite interface，则只接受
  `MI_03`。首次握手后保存 USB serial，后续允许 COM path 改变但不允许设备身份漂移；多台候选设备且未指定 serial
  时拒绝猜测。
- 生命周期持续执行 discover → open → `get_status` handshake → connected → disconnect → bounded exponential backoff，
  拔插、设备重启、请求超时或传输错误不会让进程退出。可选环境变量 `STACKCHAN_USB_SERIAL` 只固定设备 serial，
  不固定 COM 号。
- 状态握手同时验证 `device=stackchan-codex-companion` 与 `protocol_version=1`。固件状态快照新增
  `event_sequence`；Dock 忽略旧/重复事件，在 sequence gap 时自动重新读取快照，并重放握手或重同步期间排队的事件。
- 导出的 `StackchanDock` 只有 `getStatus`、`setAudioEndpoints`、`setExpression`、`setLed`、`getHead`、`setHead`
  typed methods。协议层对字段、整数范围和表情枚举做 exact-key 检查；实例没有 public `request`，不存在 raw command、
  shell、exec 或 passthrough API。

### 本地验证与当前设备边界

- `npm run check` 通过；`npm test` 9/9 通过，覆盖 VID/PID/interface 过滤、未知命令与额外字段拒绝、版本握手拒绝、
  重复/乱序事件、sequence gap 重同步、握手期间事件重放、COM7 → COM11 自动重连、typed API 和 request timeout。
- `serialport` Windows native binding 已实际加载并成功执行只读 `SerialPort.list()`。当时 `COM7` 的真实 identity 是
  `USB\\VID_303A&PID_1001&MI_00`，属于仍在运行的实验固件；正式 Dock 正确返回无目标设备，不会因为端口名是 COM7
  而误连，也没有打开或写入该端口。
- 为支持可靠重连快照，固件只新增 `event_sequence` 状态字段，没有增加命令；重新执行 10/10 固件合同测试与
  ESP-IDF 5.5.5 build 均通过。上文 app artifact 元数据已更新为包含该字段的当前构建。

## 2026-08-02：Dock 上的 MCP 白名单层

- MCP stdio server 位于 `tools/stackchan-dock/src/mcp.mjs` 与 `src/mcp-cli.mjs`，使用锁定版本
  `@modelcontextprotocol/sdk 1.30.0` 和 `zod 4.4.3`。server 启动同一个 `StackchanDock` 生命周期实例；设备暂时
  断开时 MCP 进程仍保持运行，调用返回可见的 not-connected tool error，等待 Dock 后台重新发现设备。
- 工具表精确为 `stackchan_get_status`、`stackchan_set_audio`、`stackchan_set_expression`、
  `stackchan_set_led`、`stackchan_get_head`、`stackchan_set_head`。每个 handler 只调用对应的 Dock public typed
  method，MCP 层不能访问 transport 或私有 generic request；工具名和 schema 中不存在 raw command、shell、exec
  或 passthrough 入口。
- 所有 input schema 都是 strict object。音频至少要提供一个 boolean endpoint；表情只允许五个固件枚举；LED 与
  head 的整数范围和固件/Dock 完全一致。未知工具、额外字段、任意命令字符串、空音频更新和越界值会在 handler
  调用前被 MCP/Schema 拒绝。
- MCP 使用 SDK `InMemoryTransport` 做真实 client/server schema 与 dispatch 验证。Dock + MCP 总测试为 13/13：
  六个允许工具均到达唯一对应的 typed method，六类拒绝路径没有触发任何 Fake Dock 调用，断连错误保持为 tool
  error。`npm run check` 与 `npm audit --omit=dev` 均通过，后者报告 0 vulnerabilities。本阶段未打开串口或写设备。

## 2026-08-02：设备门禁、布局恢复与复合固件部署

### 写入前门禁与发现的布局冲突

- 写入前重新核对两份 `full-flash-read*.bin`：均为 16,777,216 bytes，SHA-256 均精确匹配
  `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`；`RECOVERY.md` 可读。
  esptool 在每个写入阶段都报告 ESP32-S3 rev 0.2、MAC `44:1b:f6:e2:78:a8`。
- 待部署 app 为 `firmware/build/stack-chan.bin`，3,720,480 bytes，SHA-256
  `60972150B666D82E6FE78E06983672BDFF72C363820715148B88BB71515C66DF`，image checksum/hash 有效；计划范围
  `0x20000..0x3ac51f` 小于 ota_0 末尾 `0x50ffff`。
- 首次 app-only 写入和独立 verify 均通过，但设备进入早期 reset loop。只读回读 `0x8000` 后发现原因：设备当时仍是
  Moddable 分区表，只有 `factory@0x10000 size 0xf90000`，而不是 UAC 的 ota_0 布局。写到 `0x20000` 实际改写了
  factory app 中段，bootloader 仍从 `0x10000` 启动。启动日志明确显示先进入 `SPI_FAST_FLASH_BOOT`，随后持续
  `RTC_SW_SYS_RST`；因此停止继续 app-only 尝试。

### 必要完整恢复与最终 app-only 部署

- 从 full backup 的 `0x8000` 解析确认目标布局为 `otadata@0xd000`、`ota_0@0x20000 size 0x4f0000`、
  `ota_1@0x510000`、`assets@0xa00000`。这是实验 Moddable 布局无法只靠 app 修复的决定性证据。
- 按已记录的“app-only 不成立时才完整恢复”路径，将已校验 `full-flash-read1.bin` 写回 `0x0..0xffffff`；esptool
  写后 hash 通过，随后独立 `verify_flash 0x0` 对全部 16MB 报 `verify OK (digest matched)`。恢复后再次回读分区表，
  SHA-256 `70860A23158EC0A1A26D5670F5FAC4E54657364F01013736E385647F14B87ADE` 与 backup 分区表一致。
- 在恢复后的 ota_0 布局上，仅把复合 app 写到 `0x20000`；sector erase 范围为
  `0x20000..0x3acfff`，仍完全位于 ota_0。写后 hash 和独立 `verify_flash 0x20000` 均通过；没有再改写其他分区。
- CoreS3 原生 USB-Serial/JTAG 上，esptool hard reset 可能因 DTR 保持而返回 download ROM。实测先把
  DTR=false/RTS=false 稳定 200ms，再在 DTR=false 时脉冲 RTS，可得到 `boot:0x2b (SPI_FAST_FLASH_BOOT)` 并
  进入 app。该启动信号顺序不发送串口数据、不写 flash，应保留在恢复 runbook 中。

### Windows、CDC 与基础音频验收

- Windows 枚举 USB composite `VID_303A&PID_8001`，parent serial `441BF6E278A8`；CDC 为 `MI_03 / COM8`，
  音频 function 为 `Stack-chan USB Audio`，麦克风和扬声器两个 AudioEndpoint 均为 OK。原 COM7/PID1001 在 app
  运行时消失，证明不能固定 COM 号。
- 真机暴露了另一个 Windows 细节：`serialport` 对 CDC child 的 `serialNumber` 返回临时 instance
  `7&230CF674&0&0003`，不是 parent serial。Dock 已改为在 VID/PID/MI_03 过滤后只读解析
  `DEVPKEY_Device_Parent`，并固定 parent serial；测试增加为 14/14。真机 Dock 随后在 COM8 握手成功，
  `get_status` 返回 `protocol_version=1`、`usb_mounted=true`、24 kHz、两条机器人音频数据通路 enabled。
- 3.2 秒 WASAPI 双向基础探针通过：speaker 24 kHz mono 与 microphone 48 kHz stereo 并发 active；采集
  152,640 frames（3.18 秒），peak `0.2647819`、RMS `0.0375348`、304,342 个非零 sample，status 列表为空，
  即无 PortAudio overflow/underflow。WDM-KS 的两个独立 PortAudio stream 首次组合返回 `Invalid device`，没有产生
  音频；改用既有记录中的 WASAPI shared 路线后通过，未更改系统默认音频设备。

## 2026-08-02：真机触摸、具身命令、MCP 与重连验收

### 已通过

- Dock typed API 在真实 COM8 上依次执行 `happy` 表情、LED `(0,40,80)`、头部目标 `(15,34)`；1.8 秒后
  `get_head` 实测 `(14,33)`，随后恢复头位 `(0,34)`、neutral 和 LED off。每个命令都有设备响应，头部查询证明
  舵机命令不仅是 host 侧接受。
- 真正的 stdio MCP 子进程由 SDK `StdioClientTransport` 启动，工具列表精确为六项白名单。MCP 查询真实状态并执行
  audio endpoints enabled、doubtful、LED `(10,20,30)`、头部 `(-10,34)`；查询实测完全到达 `(-10,34)`，随后
  通过 MCP 恢复到 yaw 0、neutral 和 LED off。首次验收脚本用过紧的连接轮询退出，诊断脚本在约 2 秒、第 5 次
  查询成功；改为明确 15 秒连接门限后全链通过。
- Windows composite child 的临时 serial 问题修复后，Dock+MCP 回归为 14/14，固件合同为 10/10，npm audit
  重试后为 0 vulnerabilities。

### 真实触摸与音频数据通路

- 第一个 120 秒窗口没有操作者确认且未收到事件，因此当时保留为未通过，没有误判为 HAL 故障。操作者随后明确配合
  后，Dock 收到连续 press/release、`swipe_forward` 和 `swipe_backward`。forward 先把 mic/speaker 从 disabled、
  revision 2 同时变为 enabled、revision 3；backward 再同时变为 disabled、revision 4，事件 sequence 连续推进到 15。
- 为把设备留在可用状态，操作者再次 forward；后续握手确认 mic/speaker enabled、revision 5，并收到 sequence
  26..31 的额外 press/swipe_forward/release。由于端点已经启用，重复 forward 按确定性 set 语义不再增加 revision，
  但仍完整上报 touch event。最终查询为 sequence 31、两端 enabled。
- 固件触摸 handler 只更新机器人自身的 UAC 数据通路 atomic state 和 CDC event；Dock/MCP 中没有启动、停止、静音或
  结束 Codex Voice 会话的调用。此次验收没有创建或改变 Codex Voice 会话，符合生命周期仍由桌面端负责的边界。

### 同进程物理拔插与设备重启恢复

- 物理拔插期间同一个 Dock 进程先在 COM8/sequence 31 连接，`2026-08-02T13:24:57.077Z` 检测 disconnected，
  按 bounded backoff 持续 discovering，并于 `13:25:05.511Z` 自动重连同一 parent serial `441BF6E278A8`。
  重连快照 sequence 32、revision 5、两端 enabled；无需人工重启进程，COM 号本次仍为 COM8。
- 保持 USB 连接并执行设备重启时，同一 Dock 进程从 sequence 32 状态在 `13:25:55.865Z` 检测断开，于
  `13:26:04.413Z` 自动重连。新快照 sequence 1、revision 1、两端 enabled；sequence/revision 重置证明这是设备
  真正重新启动，而不是普通拔插后的状态延续。两次恢复都重新执行协议握手与完整状态同步。

## 2026-08-02：并行音频压力、恢复核对与 MVP 收口

### 60 秒并行回归

- 在完成物理拔插和设备重启验收后的真实 PID8001 设备上，WASAPI speaker 以 24 kHz mono 连续播放低音量 440 Hz，
  microphone 以 48 kHz stereo 连续采集；同时同一 Dock 进程以约 250ms 周期查询状态，周期切换受限表情/低亮 LED，
  并在 yaw ±8 范围移动头部。
- 音频运行 60.03 秒，采集 2,879,040 frames（59.98 秒）；输入/输出在探针期间均 active，PortAudio status 列表为空，
  即没有 overflow/underflow。采集 peak `0.9902597`、RMS `0.0286945`、5,269,462 个非零 sample。507 个全零 block
  出现在操作者通过 backward 暂停机器人 mic 数据通路期间，是预期静音帧而不是 USB 断流。
- 压力期间真实 backward 在 sequence 3 把两端改为 disabled/revision 2，forward 在 sequence 9 恢复
  enabled/revision 3；touch/audio_state 事件连续到 sequence 11。音频 stream 没有被关闭，控制与事件继续工作。
- Dock 完成 225 轮状态/命令批次，0 errors；批次 latency p50 `4.92ms`、p95 `21.63ms`、max `95.01ms`。
  最终状态为 usb mounted、mic/speaker enabled、head yaw 0，表情 neutral、LED off。未观察到明显卡顿、音频回归、
  固件重启或 Dock 重连。

### 可执行恢复边界

- 两份 16MB full backup 在收口时再次计算，size 和 SHA-256 仍分别匹配
  `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`。本轮曾实际使用 read1 完整恢复并执行
  独立 16MB verify，证明完整恢复路线可执行。
- UAC-only app 基线 `backups/stackchan-uac-20260801-180000/uac-build-images/stack-chan.bin` 为
  3,704,656 bytes，SHA-256 `0F337C50084C739EE44D77663506F9CC4236E01AD285DD097B1F2C56C180C07F`，image checksum/hash
  valid；app-only 范围 `0x20000..0x3a874f` 位于 ota_0。因复合 MVP 验收通过，本轮没有执行回退。
- `RECOVERY.md` 已补充强制前置检查：只有 live partition table 已确认 `ota_0@0x20000 size 0x4f0000` 才能执行
  app-only UAC 回退；若设备仍是 Moddable `factory@0x10000`，必须先用已验证 full backup 恢复布局，避免从
  `0x20000` 改写 factory app 中段。

### 剩余风险

- 已完成 60 秒并行回归，但尚未覆盖数小时持续运行、更多 Windows 主机、系统睡眠/唤醒、声学回声消除与真实 Codex
  Voice 长会话；这些是后续产品化验证，不改变本轮最小闭环验收结论。
- MCP 当前是 stdio server，需要由实际 Codex 配置/插件安装路径启动；本轮验证了真实 SDK client/server 与设备调用，
  但没有把本仓库 Dock 注册为用户全局 MCP 配置，避免未经请求改变用户环境。

## 2026-08-02：待机 Avatar 与音频状态灯

### 根因与运行时所有权

- UAC 模式此前只禁止 Launcher 自动打开 AI agent，但仍安装并运行 Launcher；同时固件没有调用
  `Display::SetupUI()`。`StackChanAvatarDisplay` 的默认 Avatar 只在 `SetupUI()` 中创建，因此机器人显示空白，
  `set_expression` 虽返回成功也没有可见对象可更新。
- UAC Companion 现在是独立运行时：HAL 初始化和 OTA 有效性确认后，直接创建默认 Avatar、设置 neutral，并在
  LVGL 锁内持续调用 `GetStackChan().update()`。该分支不安装 Launcher、Avatar app，也不启动 WebSocket Avatar
  或 Xiaozhi，桌面端继续独占 Codex Voice 生命周期。

### 音频数据通路与 LED 状态机

- 冷启动默认将机器人自身的 microphone/speaker 数据通路同时设为 disabled；USB UAC 端点仍保持枚举和流式协议，
  麦克风返回完整静音帧、扬声器消费并丢弃帧，不用启停 USB stream 表达待机。
- 自动状态色固定为低亮度值：双通路 disabled 为白色 `(24,24,24)`；双通路 enabled 为绿色 `(0,48,0)`；
  仅一个通路 enabled 为黄色 `(48,32,0)`；启动时可检测的 codec 缺失、采样率不匹配或 UAC 初始化失败为红色
  `(48,0,0)`。
- SI12T `swipe_forward` 与 Dock/MCP `set_audio` 共用 `update_audio_paths()`，状态变化先同步自动 LED，再发
  `audio_state` 事件；`swipe_backward` 同路径恢复双 disabled/白色。灯光只表示机器人本地数据通路，不表示
  Codex Voice 会话状态。
- 白名单 `set_led` 保留为表现能力，但改为 1500ms 的有界临时效果，响应增加 `restore_after_ms=1500`；超时后
  恢复当时真实音频状态色。若临时效果期间音频状态变化，则立即取消效果并显示新状态。所有写入同时更新两侧
  NeonLight 的内部目标和硬件，避免主更新循环把状态色覆盖。

### 本地验证与部署 artifact

- 固件合同测试 15/15，覆盖默认 disabled、Neutral Avatar 独占 UAC 分支、四种颜色映射、临时恢复和启动故障入口。
- ESP-IDF 5.5.5 完整 build 通过；`firmware/build/stack-chan.bin` 为 2,482,864 bytes，SHA-256
  `21753E48932DCF0A032A6E929CC889305A9781E2F00E1FC8D10BD969BC8A0EC4`，image size `0x25e2b0`，位于
  `ota_0@0x20000 size 0x4f0000` 时仍有 52% 空间。
- Dock/MCP `npm run check`、14/14 tests 与 `npm audit --omit=dev`（0 vulnerabilities）通过。

### 安全部署与真机协议验收

- 写入前重新确认 COM7 为 ESP32-S3 rev 0.2、MAC `44:1b:f6:e2:78:a8`；两份 full backup 仍各为
  16,777,216 bytes、SHA-256 `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`。
  只读回读的 live partition table SHA-256 为
  `70860A23158EC0A1A26D5670F5FAC4E54657364F01013736E385647F14B87ADE`，明确包含
  `ota_0@0x20000 size 0x4f0000`。
- 仅将上述 app 写入 `0x20000`；esptool 实际擦除 `0x20000..0x27efff`，完全位于 ota_0。写入内建 hash
  验证和独立 `verify_flash 0x20000` 均通过，没有写 bootloader、partition table、otadata、NVS 或 assets。
- CoreS3 USB-Serial/JTAG 的 RTS 脉冲本次没有产生新复位。只读寄存器确认当前 GPIO0 已为高后，使用 esptool
  `--after watchdog_reset` 成功让 COM7/PID1001 消失，并以同一 parent serial `441BF6E278A8` 重新枚举为
  COM8/PID8001。Windows 在成功重枚举时由 pyserial 报设备消失属于预期断连，不是写入失败。
- 冷启动 Dock 握手返回 USB mounted、24 kHz、mic/speaker 双 disabled、revision 1。真实 Dock `set_led(0,0,80)`
  和 stdio MCP `stackchan_set_led(60,0,60)` 均返回 `restore_after_ms=1500`；两次均在等待 2 秒后保持真实音频状态，
  自动状态色所有权未被手动命令永久夺走。stdio MCP 工具列表仍精确为六项白名单。
- 操作者前滑后，后续 MCP 真机查询为 mic/speaker 双 enabled、revision 2、event sequence 12。随后同一 Dock
  进程收到 sequence 13 `press`、14 `audio_state`（双 disabled、revision 3、source
  `touch_swipe_backward`）、15 `swipe_backward`、16 `release`；最终状态为 USB mounted、双 disabled，设备按偏好
  留在待机状态。操作者随后明确确认当前屏幕表现正常、灯光正确，补齐了 Neutral 待机表情及白/绿/白实际颜色的
  目视验收证据。

## 2026-08-02：原生气泡与 Windows Dock 呈现边界

### 产品数据流决定

- Stack-chan 的 microphone/speaker 继续作为 Windows 标准 UAC 设备，由 Codex App 直接选择和使用。Dock 不进入
  音频数据流，不缓存、重采样、转发或播放语音，也不恢复旧 Moddable MOD / `AudioBridge` / `SPEAKER_TEXT`
  会话耦合。
- Dock 收到上层 Codex assistant 文本回调后，负责把 `begin / delta / done / clear` 映射到机器人原生 LVGL
  气泡。文本显示属于 Dock 的会话呈现能力，不是 agent 在回答过程中主动调用的 MCP 能力；MCP 工具表继续精确
  保持状态、音频端点、表情、LED 和头部控制六项。
- 后续完整交互为：机器人启动触摸事件 -> Dock 启动或唤起 Windows Codex App -> Codex App 直接使用 UAC
  microphone/speaker -> Dock 接收回复文本回调 -> CDC 白名单命令 -> 原生 `DefaultSpeechBubble`。Codex 启动与
  transcript source adapter 属于后续任务，本节没有恢复旧官方 MOD 的交互状态机。

### 当前实现与主机侧证据

- USB companion protocol 增加 `set_speech` 和 `clear_speech`；设置命令要求唯一 `text` 字段、非空合法 UTF-8、
  最多 320 bytes，同时继续受 511-byte 完整帧上限约束。固件调用现有
  `Display::SetChatMessage("assistant", text)` / `ClearChatMessages()`，渲染仍由原生 LVGL Avatar 持有。
- Windows `StackchanDock` 增加内部 typed `setSpeech()` / `clearSpeech()`；`SpeechBubblePresenter` 只处理文本
  回调、250ms 最新值合并、最终文本强制刷新、UTF-8 code-point 安全截尾和设备重连后的最新状态重放。该模块
  不依赖 Codex app-server、WebRTC、音频格式或 MCP。
- Dock `npm run check` 与 19/19 Node tests、固件 16/16 host contract tests 通过。ESP-IDF 5.5.5 完整 build
  成功生成 `firmware/build/stack-chan.bin`，大小 2,483,696 bytes（`0x25e5f0`），最小 app partition 仍有
  52% 空间。构建只有 TinyUSB 依赖既有的 enum bitwise deprecated warning。
- 本阶段随后按既有身份、备份和 ota_0 app-only 安全约束完成了实机部署与验收，结果见下一节。

## 2026-08-03：原生气泡实机安全验收

### 字体根因、构建与安全部署

- 首次真机设置 `Stack-chan` 可见，但中文为空白。检查生成字体确认既有 `font_puhui_basic_20_4` 已包含测试汉字，
  根因不是字形缺失，而是 UAC Companion 创建 Avatar 时仍使用默认 `lv_font_montserrat_16`。修复为
  `avatar->init(lv_screen_active(), &BUILTIN_TEXT_FONT)`，让气泡使用板级内置中文字体；没有引入 Dock 字体栅格化、
  图片字幕或旧 MOD/Piu 渲染链路。
- 固件合同测试更新后 17/17 通过，Dock `npm run check` 与 19/19 Node tests 通过。ESP-IDF 5.5.5 完整 build 生成
  `firmware/build/stack-chan.bin`，大小 2,483,696 bytes（`0x25e5f0`），SHA-256
  `257B01DC9F93A3430993664B66E85B1830E7E8A0230AB8CE3837211FE51CD86D`，ota_0 仍有 52% 空间。
- 写入前再次从下载模式确认设备为 ESP32-S3 rev 0.2、MAC `44:1b:f6:e2:78:a8`；两份 16MB full backup
  `full-flash-read1.bin` / `full-flash-read2.bin` 在验收收口时再次计算，SHA-256 均为
  `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`。只读分区表仍确认
  `ota_0@0x20000 size 0x4f0000`。
- 仅把上述 app 写到 `0x20000`；实际 sector erase 为 `0x20000..0x27efff`，完全位于 ota_0，写入内建 hash 与
  独立 `verify_flash 0x20000` 均通过。没有执行 erase-flash，也没有改写 bootloader、partition table、otadata、
  NVS 或 assets。

### 中文、滚动、清除与重连重放

- 修复部署后，真实短文本“你好”可见；长文本“你好，我是 Stack-chan。现在正在测试中文气泡长文本循环滚动显示。”
  为 89 UTF-8 bytes，机器人响应 `displayed=true`。操作者分别确认中文显示成功，以及长文本滚动效果很好。
- `clear_speech` 返回 `displayed=false`，操作者确认气泡已经消失。该结果证明清除的是机器人气泡状态，不涉及
  Codex Voice 会话生命周期或 UAC stream。
- 同进程物理拔插探针先在 COM8 显示“重连测试”，随后真实检测 `disconnected`，保持 bounded discovery，重新连接
  COM8 后由 `SpeechBubblePresenter` 自动重放同一文本；日志为 `connectionCount=2`、
  `reconnect_replay_complete`，进程以 exit code 0 正常退出，无需人工重启 Dock。
- 拔插后 Windows 只读枚举确认 `Stack-chan USB Audio` MEDIA function、麦克风 AudioEndpoint 和扬声器
  AudioEndpoint 状态均为 `OK`。

### 气泡与 UAC 并行回归

- 使用临时目录中的 `sounddevice 0.5.5` 直接打开指定 Stack-chan WASAPI 端点，不更改系统默认设备：speaker
  以 24 kHz mono 播放低音量 440 Hz，microphone 以 48 kHz stereo 采集；同期同一 Dock 进程每约 250ms
  更新原生中文气泡。
- 15.0001 秒内输入/输出启动时均为 active，采集 721,440 frames、1,441,942 个非零 sample，peak
  `0.0734959`、RMS `0.0076420`，PortAudio status 列表为空，即没有 overflow/underflow。Dock 同期成功呈现
  59 次气泡更新，`presentationErrors=0`；未观察到 CDC 命令阻塞、USB 断开、固件重启或音频回归。
- `scripts/reconnect-bubble-probe.mjs`、`scripts/bubble-parallel-probe.mjs` 与
  `scripts/wasapi-audio-probe.py` 保留为可重复的实机验收工具；Python 音频依赖只安装到系统临时目录，不成为
  Dock 产品运行时依赖。Dock 产品运行时仍只发送文本与白名单控制命令，不进入音频数据流。

## 2026-08-03：Codex 桌面 Voice 控制面调查与暂缓决定

### 当前桌面实现证据

- 本机 Codex 桌面包为 `OpenAI.Codex_26.727.6591.0_x64__2p2nqsd0c76g0`，App User Model ID 为
  `OpenAI.Codex_2p2nqsd0c76g0!App`；包注册了 `codex:` URI。桌面 App 的 child `codex.exe` 运行
  `app-server` 默认 stdio transport，没有 TCP listener。`127.0.0.1:48765` 属于另一个独立 CLI
  app-server 0.146.0，不是桌面 App 的观察端口。
- 当前 experimental protocol 提供 `thread/realtime/start|stop|append*|listVoices` 和 realtime notifications，
  但没有 `subscribe`、`observe`、`attach`、`pause` 或 `resume`。旧实验 bridge 自己创建 thread、
  `RTCPeerConnection`、SDP 和音频 track，再调用 `thread/realtime/start`；它是另一个 realtime owner，不能作为
  桌面已拥有 Voice session 的旁路 observer。产品实现不得恢复这条第二 WebRTC/音频链。
- 当前桌面包内置可配置的系统级 `realtimeVoice` hotkey；注册回调调用桌面自己的
  `requestRealtimeToggle`。因此如果后续恢复触摸控制，证据支持的最小路径是 Dock 将两组无 swipe 的
  `press/release` 合成为双击，先通过 `codex:` 唤起 App，再发送用户在 Codex Settings 中配置的同一 hotkey。
  inactive 时由桌面启动/恢复，active 时由桌面停止；没有证据支持“保持连接的 pause”，不得把 stop 或机器人
  音频数据通路静音称为 pause。
- 桌面维护 `~/.codex/realtime-voice-continuity.json`，schema v1 为
  `threads[threadId].items[] = { role, text }`。它只追加完整 item，没有 delta、item ID、timestamp 或 sequence；
  可作为明确标注的 assistant final-only 气泡兼容源，但不是受支持的 live transcript callback。当前没有证据支持
  Dock 通过公共接口取得桌面 Voice live delta。

### 本轮产品决定

- 用户在确认当前证据支持的 Voice 生命周期入口是全局 hotkey 后，决定本轮先不实现该方案。因此本轮不新增
  `windows-codex-app`、hotkey injection 或双击 Voice controller，不触发或停止 Codex Voice，也不追加相应
  生命周期实机任务。文字显示仍属于当前计划，并通过下述只读桌面日志 adapter 完成。
- 已完成的 Dock 气泡 presenter、CDC 白名单文本命令、中文字体、重连重放和 UAC 并行验收继续保留；MCP 仍精确
  为原六项白名单工具。未来若重新启动 Voice 控制工作，应从上述 hotkey 边界重新核对当前桌面版本，
  不得直接复用本次包内 byte offset 或假设私有 schema 不变。

## 2026-08-03：真实 Codex Voice 文字同步与完整中文字库收口

### 桌面文字源与运行时边界

- 本机 `~/.codex/logs_2.sqlite` 的 `codex_core::realtime_conversation` 目标在真实 Voice 回复过程中记录
  `OutputTranscriptDelta`，并以 `OutputTranscriptDone` 给出最终完整文本；现场样本在一个回复中记录 35 个 delta
  和一个 done。Dock 新增 `CodexVoiceTranscriptSource`，用 Node `node:sqlite` 从启动时的当前末尾开始只读轮询这些
  事件，首个 delta 建立回复、后续 delta 驱动 `SpeechBubblePresenter`、done 校准最终文本。
- `npm start` 组合只读 transcript source、自动重连 `StackchanDock` 与既有 250ms 最新值合并 presenter；不连接
  第二个 app-server、不创建 thread/WebRTC/音频 track、不管理 Voice 生命周期，也不把文字命令扩展为 MCP。
  该 adapter 依赖 Codex 桌面私有日志 schema，属于明确标注的版本敏感 MVP 接口；schema 缺列时启动失败并报告，
  不会退化为任意日志或命令透传。
- Companion 将真实设备状态 `microphone_enabled=false` 映射为立即清空气泡；该规则同样应用于重连握手，避免麦克风
  已关闭时重放旧回复。它只改变机器人显示状态，不停止、静音或结束 Codex Voice 会话。
- Dock `npm run check` 与 21/21 Node tests 通过；测试覆盖 Rust debug string 中的中文/转义解析、只消费启动后的新
  事件、delta/done 顺序、250ms 合并、UTF-8 安全截尾、清除和断线重放。MCP 回归继续确认只有六项 typed 工具。
- 真实 Codex Voice 目视验收中，操作者确认助手发音期间机器人同步显示回复文字，且标准 USB 语音输出不受影响、
  没有卡顿。该证据补齐了“上层回调 adapter”而非 agent 主动调用 MCP 的产品数据流。
- 麦克风关闭清理的真机回归中，Dock 先呈现非空 Voice 文本，随后收到 sequence 21 `audio_state`：mic/speaker
  双 disabled、revision 5、source `touch_swipe_backward`，紧接着下发 `speech_presented bytes=0`；操作者确认白灯
  与气泡消失表现正确。对应 Dock 回归增至 22/22，并覆盖重连时不重放旧气泡。

### 缺字根因与小智 common 字体复用

- 后续真实回复“好，我现在就关闭语音。”在屏幕上出现断字。Dock 最后一次下发字节数与完整文本一致，证明协议
  未截断；板级 `font_puhui_basic_20_4` 仅约 800 个码点，并确定缺少“就”“语”。仓库已有小智字体组件同时提供
  `puhui-common.ttf` / `font_puhui_20_4`，约 6658 个码点并覆盖整句，因此未下载、生成或引入另一套字体。
- Stack-chan 板级 `BUILTIN_TEXT_FONT` 从 basic 切换为现有 `font_puhui_20_4`。新增固件合同测试锁定该选择并检查
  代表句字形；修复前测试准确失败于 basic，修复后完整固件合同为 18/18。
- ESP-IDF 5.5.5 完整构建通过，新 `firmware/build/stack-chan.bin` 为 3,601,312 bytes（`0x36f3a0`），SHA-256
  `5C054D6414ACB2F6A328F812F47820CBC017468EB4F433330429A23828B87DC1`；image checksum 和 validation hash valid。
  `ota_0` 为 `0x4f0000`，仍有 `0x180c60`（30%）空间。
- 写入前从 COM7 下载模式重新确认 ESP32-S3 rev 0.2、MAC `44:1b:f6:e2:78:a8`；两份 16MB backup 的 SHA-256
  均再次确认为 `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`。仅写
  `0x20000..0x38f39f`，esptool 实际擦除 `0x20000..0x38ffff`，完全位于 `ota_0`；内建 hash 与独立
  `verify_flash 0x20000` 均通过。未执行 erase-flash，未写 assets、NVS、bootloader、分区表或其他分区。
- watchdog reset 后同一序列号 `441BF6E278A8` 重新枚举为 PID8001/COM8。真实 CDC 探针下发完整 33-byte
  `好，我现在就关闭语音。`，设备返回 `displayed=true`；操作者目视确认显示“完美”。

## 2026-08-03：Codex Voice 固定节奏说话表情证据检查

- 产品选择是固定节奏张嘴动画，不读取音频 PCM、振幅或端点 meter，也不把 Dock 放入 UAC 数据流。开始/结束由
  Codex 桌面现有 realtime 非音频事件驱动；Voice 生命周期仍由桌面端拥有。
- 固件已有 `SpeakingModifier`：默认每 180ms 切换嘴部开合权重，`enableMotion=false` 时不驱动舵机；小智现有
  `StackChanAvatarDisplay::SetStatus(SPEAKING)` 已实际复用该 modifier。完整 `SetStatus` 同时改变 LED、idle modifier
  和小智状态，因此 Companion 不能直接调用它，否则会破坏白/绿音频状态灯所有权。最小固件边界是只启停同一
  speaking modifier，并在停止时强制 `mouth().setWeight(0)`。
- 当前 CDC 只有 `set_expression` 静态表情，不具备 modifier 生命周期语义。证据支持新增内部 typed
  `set_talking({enabled:boolean})`，精确校验字段并返回真实 enabled 状态；它只操作嘴部 modifier，不进入 MCP，
  不提供 modifier ID、持续时间、频率或任意动画透传。
- 真实桌面日志在 assistant 回复期间提供 `OutputTranscriptDelta` 和 `OutputTranscriptDone`；wire 侧对应
  assistant `turn.created`/`turn.done`。样本中首个 assistant turn 与开头文字同步创建，done 位于完整回复末尾；
  因此固定节奏 MVP 以首个 output delta 启动、Output Done 停止，不需要音频信号。用户输入/打断、设备
  mic disabled、Dock 断连/退出均是额外的强制停止边界；重连只恢复 stopped，不重放旧 talking 状态。

### 实现与本地验证

- 固件新增内部 CDC 白名单命令 `set_talking({enabled:boolean})`。板级实现仅添加/移除
  `SpeakingModifier(0, 180, false)`；停止时强制嘴部 weight 为 0。该调用不经过 `SetStatus(SPEAKING)`，因此不改
  白/绿音频状态灯、不启用 idle modifier，也不产生舵机动作。
- Dock 新增 typed `setTalking(enabled)` 与串行化 `TalkingAnimationController`。Companion 在首个 assistant output
  delta 启动，在 output done、首个 user input delta、mic disabled、断连、source error 和 shutdown 时停止；设备重连
  总是先发送 stopped。连续 user delta 合并为一次打断，旧回复迟到的 done 不会被误判为新回复启动。
- 该命令保持为 Dock 内部呈现能力，MCP 仍精确暴露原六项 typed 工具，没有 raw transport、任意 modifier 或
  talking MCP 工具。动画 cadence 固定为 180ms，没有音频 PCM、振幅、meter 或 WebRTC 依赖。
- Dock `npm run check` 通过，26/26 Node tests 通过；固件合同 19/19 通过。ESP-IDF 5.5.5 完整构建生成
  `firmware/build/stack-chan.bin`，大小 3,601,984 bytes（`0x36f640`），SHA-256
  `5AB8B77A799C6989B316E91FB0D26456297D12D1EE64DD3A918310599B4CA208`；image checksum 与 validation hash valid。
  `ota_0@0x20000 size 0x4f0000` 仍余 `0x1809c0`（30%）。本阶段尚未写入设备，实机写入仍须重新核对芯片身份、
  两份 16MB backup 哈希、artifact/offset/sector erase 范围并仅写 ota_0。

### 实机安全部署与验收

- 写入前再次计算两份 16MB full backup，SHA-256 均为
  `CBB6527394A4B224F820CE4FD3D225D032D116B8F45046F9F3FD61D503A19137`；下载模式 COM7 只读确认目标为
  ESP32-S3 rev 0.2、MAC `44:1b:f6:e2:78:a8`。停止旧 Companion 后，仅把上述 app 写到 `0x20000`。
- esptool 实际擦除 `0x20000..0x38ffff`，完全位于 ota_0；写入内建 hash 和独立
  `verify_flash 0x20000 firmware/build/stack-chan.bin` 均通过。未执行 erase-flash，未写 bootloader、分区表、NVS、
  assets 或其他分区。watchdog reset 后同一序列号 `441BF6E278A8` 正常恢复 PID8001/COM8。
- 新 Companion 真实握手后先下发 `talking=false`。操作者通过 Codex Voice 目视确认：回复播放期间机器人以固定节奏
  张嘴，回复结束后闭嘴，且效果正常。运行日志记录多轮 `talking_animation enabled=true`、并行
  `speech_presented` 增量和对应 `enabled=false`，没有把动画接入音频流。
- 真实后滑产生 sequence 12 `audio_state`：mic/speaker 均 disabled、revision 3、source
  `touch_swipe_backward`；Companion 随即发送空气泡。随后同一进程经历 disconnected/discovering 并自动重连 COM8，
  握手状态保持 audio disabled，先发送 `talking=false` 和空文本，没有重放旧嘴部动画或气泡。
- 重连后 Windows 只读枚举确认 `Stack-chan USB Audio`、麦克风 AudioEndpoint、扬声器 AudioEndpoint、CDC COM8 和
  composite parent 状态均为 `OK`。真实 Codex Voice 已同时使用标准扬声器播放、CDC 增量气泡与固定嘴部动画，
  操作者确认结果正常，未观察到卡顿或音频回归。
