# StackChan wifi.ota_url 写入/替代方案

更新时间：2026-05-16

## 1. 核心结论

`wifi.ota_url` 源码中已有运行时写入口，不必优先重编固件或 patch NVS。

最推荐路径：

```text
进入 StackChan Wi-Fi 配网 AP
→ 打开配网页面高级配置
→ 写入 Custom OTA URL
→ 保存到 NVS wifi/ota_url
→ 设备后续 OTA 检查访问自建 OTA 服务
```

这条路线最小侵入：

```text
不擦 NVS
不改 app 分区
不改 bootloader/partition/assets
最符合保留小智登录/官方 MCP 的目标
```

## 2. 读取路径

关键文件：

```text
firmware/xiaozhi-esp32/main/ota.cc
firmware/main/Kconfig.projbuild
firmware/sdkconfig
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc
```

读取逻辑：

```text
Ota::GetCheckVersionUrl()
→ Settings("wifi", false)
→ 读取 key: ota_url
→ 若为空，使用 CONFIG_OTA_URL
```

默认值：

```text
CONFIG_OTA_URL="https://api.tenclass.net/xiaozhi/ota/"
```

配网 AP 高级配置页面也会读取 `wifi/ota_url` 用于回显。

## 3. 写入路径

关键文件：

```text
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc
firmware/managed_components/78__esp-wifi-connect/assets/wifi_configuration.html
```

写入逻辑：

```text
HTTP POST /advanced/submit
→ JSON 字段 ota_url
→ nvs_set_str(nvs, "ota_url", ...)
→ nvs_commit(nvs)
```

页面字段：

```text
Custom OTA URL
```

前端会提交：

```json
{
  "ota_url": "http://局域网IP:端口/ota/"
}
```

## 4. HTTP/HTTPS 结论

小智主 OTA 路线使用项目自带 `HttpClient`，不是另一路 `esp_https_ota` app-center 工具。

主 OTA 支持：

```text
http://...
https://...
```

因此自建 OTA mock 最稳妥写：

```text
http://局域网IP:端口/ota/
```

不建议 DNS 劫持官方域名：

```text
https://api.tenclass.net/xiaozhi/ota/
```

因为 HTTPS 会做证书链和主机名校验，本地 mock 没有 `api.tenclass.net` 有效证书，大概率失败。

## 5. 路径对比

| 路径 | 做法 | 推荐度 | 风险 |
|---|---|---:|---|
| 配网 AP 写 `wifi.ota_url` | 进入配网热点，高级配置写 OTA URL | 高 | 需要能进入配网 AP |
| HTTP POST `/advanced/submit` | 直接向配网 AP 提交 JSON | 高 | 需确认字段完整，避免覆盖默认配置 |
| 改 `CONFIG_OTA_URL` 重编 app | 修改默认 URL 后刷 app 分区 | 中 | 需要串口/烧录；若 NVS 已有 `ota_url`，默认值不生效 |
| patch NVS | 读出 NVS 后保留原 key 并新增 ota_url | 中 | NVS 格式复杂；错误会破坏 Wi-Fi/绑定 |
| DNS/HTTPS 劫持 | 劫持官方域名到本地 mock | 低 | HTTPS 证书校验卡住 |

## 6. 推荐测试顺序

### Step 1：优先进入配网 AP

目标：找到高级配置里的 `Custom OTA URL`。

填入：

```text
http://<本机局域网IP>:<端口>/ota/
```

保存后，设备会把它写入：

```text
NVS namespace: wifi
key: ota_url
```

### Step 2：如果页面可访问但不方便手动操作

可以直接 POST：

```http
POST /advanced/submit
Content-Type: application/json

{
  "ota_url": "http://<本机局域网IP>:<端口>/ota/"
}
```

注意：最好抓/参考页面实际提交字段，避免其它高级配置被默认值覆盖。

### Step 3：如果无法进入配网 AP

再考虑：

```text
修改 CONFIG_OTA_URL → 重编 app.bin → 只刷 app 分区
```

但该路线需要串口设备出现。

### Step 4：NVS patch 只作为备选

必须先备份完整 NVS，再 patch 原分区，不能生成只有 `ota_url` 的新 NVS 镜像直接覆盖。

## 7. 需要人工介入的点

下一步需要用户确认/操作：

```text
让 StackChan 进入 Wi-Fi 配网 AP
查看高级配置页面是否有 Custom OTA URL
```

这一步无法在当前机器自动完成，因为设备没有通过 USB 出现，也无法远程按键/连接其热点。

## 8. 当前判断

OTA 路线的最大阻塞已经从“是否有入口”变成：

```text
如何让设备进入配网 AP，并访问高级配置页面
```

一旦能写入 `wifi.ota_url`，后续可以继续：

```text
本地 OTA mock server
→ 返回最小 firmware response
→ 设备下载自定义 app.bin
→ OTA 到备用 app slot
→ 观察是否保留小智登录/官方 MCP
```
