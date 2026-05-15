# StackChan celebrate 开发指南：OTA 成功路线与最小补丁流程

时间：2026-05-16  
范围：在**保留官方小智固件能力**的前提下，复用已现场验证的自建 OTA 路线，下发后续 `self.robot.celebrate` 设备端 MCP tool。  
边界：本文是开发 runbook，不执行 OTA、不写 flash、不清理 NVS、不连接真实小智 API、不包含 token。

---

## 1. 一句话结论

已验证的安全主线是：

```text
USB 备份 full flash/NVS/otadata
→ 只 patch NVS wifi/ota_url 指向本地 /ota/
→ mock OTA no-upgrade/probe 验证 POST /ota/
→ upgrade server 返回更高版本 manifest
→ 用户在设备上手动 Check for Updates
→ 设备 GET /stack-chan.bin 并 OTA app 分区
→ OTA 后验收小智/App/MCP
→ 后置安全步骤：清理 Custom OTA URL（Task 34，暂不执行）
```

后续 celebrate 开发应沿用同一路线：只做官方小智固件的最小 app 补丁，新增 `self.robot.celebrate`，构建新的 `stack-chan.bin`，通过自建 OTA 下发，再用小智 MCP 验收。

---

## 2. 已验证 OTA 成功主线

### 2.1 备份先行

真实设备写入前已走过 USB 备份路线。后续任何 OTA/app.bin 实测前仍应确认备份存在并可定位：

```text
full flash backup
nvs.bin
otadata.bin
ota_0.bin
ota_1.bin
assets.bin
```

关键原则：

- 先备份，再写入。
- 不执行 `erase_flash`。
- 不 Factory Reset。
- 不擦 NVS。
- 不改 bootloader / partition table。

### 2.2 NVS patch 写 `wifi/ota_url`

源码确认 OTA URL 优先级：

```text
NVS namespace: wifi
key: ota_url
优先于 CONFIG_OTA_URL
```

现场路线已验证：只写 NVS 中 `wifi/ota_url`，让设备检查更新时访问本地 OTA server：

```text
http://192.168.0.12:8080/ota/
```

这个写入只用于 OTA 测试入口，不应触碰 websocket/mqtt token、App 绑定、board identity 或 assets。

### 2.3 mock OTA no-upgrade / probe 验证

先启动不触发下载的本地 server，确认链路命中：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
python3 tools/ota-mock-server/ota-mock-server.py --mode no-upgrade --port 8080
```

或 probe 模式：

```bash
python3 tools/ota-mock-server/ota-mock-server.py --mode probe --port 8080
```

用户在设备上手动点击：

```text
SETUP → Firmware → Check for Updates
```

预期 server 日志：

```text
POST /ota/
ua='m5stack-stack-chan/<current-version>'
```

说明：probe/no-upgrade 显示“当前就是最新版本”是预期，不代表 OTA URL 失败。

### 2.4 upgrade server 与真实下载

真实升级时才启动 upgrade server，manifest 指向本次 app.bin：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
python3 tools/ota-mock-server/ota-mock-server.py \
  --mode upgrade \
  --port 8080 \
  --firmware firmware/build/stack-chan.bin
```

用户仍需在设备上手动点击：

```text
SETUP → Firmware → Check for Updates
```

预期请求顺序：

```text
POST /ota/
GET /stack-chan.bin
下载完成
设备重启
```

### 2.5 OTA 后验收

OTA 成功后必须验收：

```text
设备能正常启动
小智自然对话/TTS 正常
App 设备管理/绑定正常
表情/屏幕显示正常
官方设备 MCP tools 正常
新增 self.robot.celebrate 可见并可调用
```

---

## 3. 成功关键点与现场经验

### 3.1 manifest 字段必须匹配设备解析逻辑

设备端 `Ota::CheckVersion()` 读取的是嵌套结构：

```json
{
  "firmware": {
    "version": "2.0.1",
    "url": "http://192.168.0.12:8080/stack-chan.bin",
    "force": 1
  }
}
```

关键点：

- `firmware.version` 必须高于设备当前版本，或 `firmware.force = 1`。
- `firmware.url` 必须是可下载的 bin URL。
- `firmware.force` 用数字 `1/0`，不要用 JSON boolean。
- 不返回 `activation`，避免重新激活。
- 不返回 `mqtt` / `websocket`，避免覆盖官方连接配置。

### 3.2 固件路径与大小

当前约定：

```text
firmware/build/stack-chan.bin
```

真实 OTA 前检查：

```bash
ls -lh firmware/build/stack-chan.bin
```

约束：

```text
bin size < OTA app slot 0x4f0000
```

### 3.3 Content-Length / 断流 / BrokenPipe 经验

现场曾遇到：

```text
POST /ota/ 成功
GET /stack-chan.bin 开始
server BrokenPipe
OTA 未完成
```

经验结论：

- BrokenPipe 是设备端中途关闭连接的表象，不一定是 Python server 首因。
- 首次失败最可疑因素包括：当前 app 处于 rollback pending verify、manifest 字段类型/版本不符合设备期望。
- 修正路线是先走 no-upgrade 让设备进入“无新版本”分支并 mark current app valid，再用正确 manifest 重试。
- server 应正确返回 `Content-Length`，不要边生成边传不确定长度的响应。

### 3.4 probe 与真实请求区分

区分方式：

```text
probe/no-upgrade:
  POST /ota/
  firmware.url = ""
  无 GET /stack-chan.bin

upgrade:
  POST /ota/
  firmware.url 非空
  随后 GET /stack-chan.bin
```

不要把 `curl /ota/` 的本机探测误认为设备请求；看日志中的 IP、UA、请求路径。

### 3.5 串口/日志观察点

有串口时重点看：

```text
Current version
CheckVersion URL
HTTP status code
HasNewVersion / firmware.version / firmware.url
MarkCurrentVersionValid
esp_https_ota begin/write/end
set boot partition
reboot
rollback / pending verify
```

无串口时至少看 OTA server：

```text
POST /ota/
GET /stack-chan.bin
传输字节数接近 bin size
设备是否重启
重启后 UI/App/小智是否正常
```

---

## 4. 安全边界与后置清理

### 4.1 只允许改动 app 分区

celebrate 路线只应替换下一个 OTA app 分区：

```text
ota_0 / ota_1 app partition
```

不改：

```text
bootloader
partition-table
otadata（除 bootloader/OTA API 正常更新）
nvs
phy_init
assets
coredump
```

### 4.2 NVS 与官方绑定保护

禁止：

```text
nvs_flash_erase()
esptool erase_flash
覆盖整片 NVS
Factory Reset
写 websocket/mqtt/activation/token 字段
```

只允许在明确授权任务中修改：

```text
wifi/ota_url
```

且最终应清理。

### 4.3 Task 34 是后置安全步骤，当前不执行

当前 plan 中 Task 34 是：清理 Custom OTA URL。本文只记录它是后置安全步骤，不执行清理。

推荐最终清理方式：

```text
优先：通过 Xiaozhi 配网页 Advanced 清空 Custom OTA URL
备选：基于备份做最小 NVS patch 清空 wifi/ota_url
禁止：Factory Reset / 擦 NVS
```

清理完成后的验收：

```text
设备 Check for Updates 不再访问 192.168.0.12:8080
小智/App 绑定保持正常
```

### 4.4 失败回滚入口

失败时按风险从低到高选择：

1. 重启设备，观察 OTA rollback 是否回到旧 app。
2. 启动 no-upgrade server，避免设备反复尝试错误 upgrade。
3. 用保留的旧 app.bin 通过同一路 OTA 回滚。
4. 最后才考虑 USB 恢复；仍不擦 NVS，优先回写 app 分区或备份分区。

---

## 5. 与 celebrate tool 开发的关系

### 5.1 后续最小补丁范围

推荐新增：

```text
self.robot.celebrate
```

最小代码范围优先：

```text
firmware/main/hal/hal_mcp.cpp
```

如果需要非阻塞状态机，再新增最小 modifier 文件，例如：

```text
firmware/main/stackchan/modifiers/celebrate.h
```

必须避免修改：

```text
firmware/xiaozhi-esp32/main/ota.cc
firmware/xiaozhi-esp32/main/application.cc
firmware/xiaozhi-esp32/main/mcp_server.cc
firmware/xiaozhi-esp32/main/protocols/*
firmware/partitions.csv
firmware/sdkconfig*
bootloader / partition table / NVS / assets
```

### 5.2 celebrate 行为建议

MVP：

```text
LED 暖色低亮度变化
小幅头部点头
可选复用内置提示音
总时长 2~3 秒
不循环
不高频闪烁
不读写 NVS
不发网络请求
```

### 5.3 下发与验收

开发完成后：

```text
build app.bin
→ 确认 version 高于当前设备
→ 确认 bin size < app slot
→ 启动 upgrade server
→ 用户手动 Check for Updates
→ OTA 后验收小智/App/MCP
→ 调用 self.robot.celebrate 验收
```

调用验收应通过小智/官方 MCP 链路，不应绕过或伪造私有 websocket/mqtt 凭据。

---

## 6. 最短 runbook

> 以下命令是模板。真实设备步骤均需用户在场手动操作；不要包含 token，不访问真实小智 API。

### 6.1 OTA 链路 no-upgrade 验证

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
python3 tools/ota-mock-server/ota-mock-server.py --mode no-upgrade --port 8080
```

用户手动：

```text
设备 SETUP → Firmware → Check for Updates
```

看日志：

```text
POST /ota/
无 GET /stack-chan.bin
```

### 6.2 celebrate app.bin 预检

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
ls -lh firmware/build/stack-chan.bin
```

确认：

```text
版本高于当前设备
bin 小于 0x4f0000
server manifest 指向该 bin
```

### 6.3 真实 upgrade

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
python3 tools/ota-mock-server/ota-mock-server.py \
  --mode upgrade \
  --port 8080 \
  --firmware firmware/build/stack-chan.bin
```

用户手动：

```text
设备 SETUP → Firmware → Check for Updates
```

预期日志：

```text
POST /ota/
GET /stack-chan.bin
```

### 6.4 OTA 后验收

```text
设备启动成功
小智能说话
App 仍在线/绑定正常
官方 MCP tools 仍可用
self.robot.celebrate 可被调用
```

### 6.5 后置清理（Task 34，另行执行）

```text
清空或恢复 Custom OTA URL
确认设备不再访问 192.168.0.12:8080
```

---

## 7. 引用

- `docs/research/stackchan-ota-live-success-runbook.md`
- `docs/research/stackchan-ota-custom-appbin-feasibility.md`
- `docs/research/stackchan-ota-mock-and-live-preflight.md`
- `docs/research/stackchan-ota-url-write-paths.md`
- `docs/design/celebrate-mcp-tool-design.md`
- `subagents/62.report.md`
- `subagents/66_task.md`
- `subagents/67_task.md`
- `subagents/68_task.md`

---

## 8. 当前状态与下一步

当前文档已覆盖 OTA 成功路线、BrokenPipe 经验、安全边界、Task 34 后置清理、以及 celebrate tool 通过同一路 OTA 下发的开发关系。

建议：Task 35 可标记 done。下一步继续 Task 36：实现 `self.robot.celebrate` 最小补丁；实现前仍应先保持 no-upgrade server 安全兜底，真实 OTA 前再切 upgrade。
