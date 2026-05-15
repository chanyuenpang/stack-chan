# StackChan OTA 现场打通经验记录

时间：2026-05-16  
范围：StackChan 官方小智固件保留路线下，自建 OTA URL 写入、probe 验证与 upgrade 前准备。

## 结论

本次现场已确认：

1. StackChan 可通过 Xiaozhi 配网 AP 的高级配置写入 `Custom OTA URL`。
2. 正确 OTA URL 为：

```text
http://192.168.0.12:8080/ota/
```

3. 设备与 OpenClaw 主机同网段后，点击：

```text
SETUP → Firmware → Check for Updates
```

会触发 OTA 检查。

4. 本地 server 已收到真实设备请求：

```text
ip=192.168.0.168
method=POST
path=/ota/
status=200
ua=m5stack-stack-chan/1.4.1
content_length=1212
```

5. 设备显示“当前就是最新版本”的原因是 probe 模式故意返回低版本和空固件 URL，而不是 OTA URL 失败。

## 成功路径

### 1. 准备本地 OTA server

probe 模式只验证链路，不触发下载：

```bash
python3 tools/ota-mock-server/ota-mock-server.py --mode probe --port 8080
```

probe 行为：

```text
firmware.version = 0.0.0-mock
firmware.url = ""
force = false
```

因此设备会认为没有新版本。

### 2. 进入 Xiaozhi 配网 AP

现场发现：点击 `Check for Updates` 后，如果设备未连上 Wi-Fi，会进入 Wi-Fi scanning，并出现 `Xiaozhi-xxxx` 配网热点。

连接该 AP 后进入配置页，确认/填写：

```text
SSID: 与 OpenClaw 主机同网段的 Wi-Fi
Password: 正常填写
Custom OTA URL: http://192.168.0.12:8080/ota/
Remember BSSID when connecting to wifi: 不勾选
```

不勾选 BSSID 的理由：减少 AP MAC 绑定导致的连不上/漫游失败变量。

### 3. 手动触发 OTA 检查

在设备 UI 中点击：

```text
SETUP → Firmware → Check for Updates
```

源码确认该入口调用链为：

```text
SystemUpdateWorker()
→ GetHAL().startNetwork()
→ GetHAL().updateFirmware()
→ Ota::CheckVersion()
```

OTA 请求实际为 POST：

```text
POST /ota/
```

不是 GET。

### 4. 观察日志

成功命中本地 OTA server 的关键日志：

```text
ip=192.168.0.168 method=POST path=/ota/ status=200 ua='m5stack-stack-chan/1.4.1' content_length=1212
```

如果 probe 模式正常，设备 UI 显示“当前就是最新版本”是预期行为。

## 源码证据

### OTA URL 读取优先级

文件：

```text
firmware/xiaozhi-esp32/main/ota.cc
```

函数：

```text
Ota::GetCheckVersionUrl()
```

结论：

```text
NVS wifi/ota_url > CONFIG_OTA_URL
```

### 检查更新入口

文件：

```text
firmware/main/apps/app_setup/workers/about.cpp
firmware/main/hal/hal_ota.cpp
```

链路：

```text
SETUP → Firmware → Check for Updates
→ SystemUpdateWorker()
→ Hal::updateFirmware()
→ Ota::CheckVersion()
```

### AI.AGENT 入口

文件：

```text
firmware/main/apps/app_ai_agent/app_ai_agent.cpp
firmware/main/hal/hal.cpp
firmware/xiaozhi-esp32/main/application.cc
```

链路：

```text
AI.AGENT
→ requestXiaozhiStart()
→ startXiaozhi()
→ Application::Initialize()
→ board.StartNetwork()
→ WiFi connected
→ ActivationTask()
→ CheckNewVersion()
→ Ota::CheckVersion()
```

注意：AI.AGENT 不是立即 OTA，要等 Xiaozhi 启动并 Wi-Fi connected。

## 关键经验

1. **不要只看设备 UI 的“最新版本”**  
   probe 模式返回低版本时，UI 显示最新版本是正常现象；必须看 server 日志是否有 `POST /ota/`。

2. **正确请求方法是 POST**  
   监控时不要只 grep `GET /ota/`。

3. **Wi-Fi 是 OTA 前置条件**  
   `Check for Updates` 会先 `startNetwork()`；未联网会进入扫描/配网流程，不会请求 `/ota/`。

4. **Custom OTA URL 路线比盲目 patch NVS 更可控**  
   现场最终通过 Xiaozhi AP 页面确认/修改 OTA URL，风险低于反复写 NVS。

5. **probe 与 upgrade 必须分开**  
   probe 只验证 `/ota/` 链路；upgrade 才返回 `/stack-chan.bin` 并触发真实下载。

## 真实 upgrade 前检查清单

在启动 upgrade 前确认：

```text
设备供电稳定，不断电
设备与 OpenClaw 同网段
OTA URL = http://192.168.0.12:8080/ota/
8080 无旧 server 占用
firmware/build/stack-chan.bin 存在
bin 小于 app slot 0x4f0000
manifest version 高于设备当前 1.4.1
```

已知固件信息：

```text
firmware/build/stack-chan.bin
size = 3,777,056 bytes
sha256 = 0ddc933088b9614bd1d34212bd3d60c9dff80916571b2b5f4248f953e2feb1bf
app slot = 5,177,344 bytes
```

upgrade 预期日志顺序：

```text
POST /ota/
HEAD /stack-chan.bin 或 GET /stack-chan.bin
下载 3,777,056 bytes
设备重启
UI 恢复
```

## 回滚材料

备份目录：

```text
backups/stackchan-20260516-011551/
```

关键备份：

```text
nvs.bin
otadata.bin
ota_0.bin
ota_1.bin
assets.bin
nvs-after-write.bin
nvs-with-ota-url.bin
```

如果只需要撤销自定义 OTA URL，可优先通过配网页清空/改回；必要时再基于备份回写 NVS。任何回写都必须单独确认。

## 当前状态

已确认：

```text
OTA URL 生效
设备真实 POST /ota/
probe 链路打通
```

真实 upgrade 需在明确批准下启动 `--mode upgrade`，并观察 `/stack-chan.bin` 下载与设备重启。
