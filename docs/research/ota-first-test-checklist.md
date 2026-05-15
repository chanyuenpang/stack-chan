# StackChan 首次 OTA 实测检查单

> ⚠️ 本检查单仅用于**用户授权后**的真机测试。
> 当前阶段：**已准备好所有工具和知识，等待用户决策。**

---

## 0. 前置条件（用户决策）

- [ ] 授权同意执行受控 OTA 测试
- [ ] 已通过串口确认设备**未开启** secure boot / flash encryption
- [ ] 已准备好官方固件恢复方案（`firmware/build/stack-chan.bin` + esptool 烧录命令）
- [ ] 可选：备份当前 flash（`esptool.py read_flash 0 0x1000000 flash_backup.bin`）

---

## 1. 人工步骤（用户在本地执行）

### 1.1 启动 mock OTA server

```bash
cd stack-chan/tools/ota-mock-server
python3 ota-mock-server.py
```

→ 确认日志显示 `Listen: http://0.0.0.0:8080`

### 1.2 找本机局域网 IP

```bash
hostname -I   # 或 ip -4 addr
```

记下 `LAN_IP`，例如 `192.168.1.100`。

### 1.3 让设备进入配网 AP 模式

- 短按复位键，或按住 Boot 键后再上电
- 确认 Wi-Fi 列表出现 `Xiaozhi-XX` AP
- 连接该 AP（无密码）

### 1.4 写入 mock OTA URL

```bash
curl -X POST http://192.168.4.1/advanced/submit \
  -H "Content-Type: application/json" \
  -d '{"ota_url":"http://LAN_IP:8080/ota/"}'
```

→ 预期返回 `{}` 或空 JSON

### 1.5 触发设备 OTA 检查

方式 A：设备重启后自动检查（OTA check 在启动流程中）
方式 B：通过小智控制台设备页手动触发升级

### 1.6 观察 mock server 日志

预期看到设备请求序列（按时间顺序）：

```
[xx:xx:xx] 192.168.x.x    GET  /ota/              → 200    # 版本检查
[xx:xx:xx] 192.168.x.x    HEAD /stack-chan.bin    → 200    # 检查文件大小
[xx:xx:xx] 192.168.x.x    GET  /stack-chan.bin    → 200    # 下载固件
[xx:xx:xx] 192.168.x.x    GET  /ota/              → 200    # 下载完成后再次检查
```

如果只有 GET /ota/ 没有下载请求：
- 版本比较条件不满足（mock 返回 `0.0.0.0-mock` < `1.4.1`）
- **解决**：修改 mock server 返回值，设 version 为 `1.4.2`

### 1.7 OTA 后观察设备行为

- [ ] 设备重启进入新固件
- [ ] 小智登录正常（不出现 `device configuration not found`）
- [ ] 表情正常工作
- [ ] 能和 App 正常绑定/通信
- [ ] 官方 MCP tools（`self.get_device_status` 等）仍可用
- [ ] 新增 `self.robot.celebrate` tool 可用（若已有）

### 1.8 测试后恢复

```bash
# 清空 ota_url，恢复官方 OTA 通道
curl -X POST http://192.168.4.1/advanced/submit \
  -H "Content-Type: application/json" \
  -d '{"ota_url":""}'
```

---

## 2. 助手自动步骤（助手可执行）

- [ ] 编译庆祝补丁固件（需先实现 `hal_mcp.cpp` 修改）
- [ ] 验证 app.bin 大小 < `0x4f0000` (5 MB)
- [ ] 验证 app.bin 分区表兼容
- [ ] 启动 mock server（已就绪）
- [ ] 如需要，修改 mock version 为 `1.4.2` 触发升级

---

## 3. 成功标准

所有项均为 ✅：

- [ ] 设备通过 OTA 下载自定义 app.bin
- [ ] 设备重启进入新固件
- [ ] 小智登录/表情/设备 MCP 全部正常
- [ ] NVS 保留（WiFi/MQTT/WS 配置未丢失）
- [ ] 新增功能（celebrate）可用
- [ ] 回滚方案有效（清 ota_url / 串口刷官方固件）

---

## 4. 失败处理

| 现象 | 处理 |
|---|---|
| 设备不请求 /ota/ | 确认 ota_url 写入成功；确认设备和 LAN 同网段 |
| 版本检查成功但不下载 | mock version 应 > 当前固件版本 |
| 下载成功但重启进旧固件 | rollback 触发；新固件 20s 内崩溃了 —— 检查自定义固件 |
| OTA 后 `device configuration not found` | 确认 board identity/version/sdkconfig 未变 |
| 小智无法登录 | NVS 可能被擦 —— 确认自定义固件无 `nvs_flash_erase()` |
| 设备变砖 | esptool 烧录官方 `firmware/build/stack-chan.bin` 恢复 |

**万能恢复**：

```bash
# 串口烧录官方固件
esptool.py --chip esp32s3 -p /dev/ttyACM0 write_flash 0x0 stack-chan.bin
```
