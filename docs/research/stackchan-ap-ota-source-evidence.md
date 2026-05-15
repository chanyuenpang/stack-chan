# StackChan AP / OTA 源码证据清单

更新时间：2026-05-16

## 1. 进入 Wi-Fi AP/config portal 的源码条件

### 启动网络

```text
firmware/xiaozhi-esp32/main/application.cc:158-159
board.StartNetwork();
```

StackChan board 继承 `WifiBoard`：

```text
firmware/main/hal/board/stackchan.cc:235
class M5StackCoreS3Board : public WifiBoard
```

### StartNetwork

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:52-87
```

关键逻辑：

```cpp
config.ssid_prefix = "Xiaozhi";
wifi_manager.Initialize(config);
TryWifiConnect();
```

### 无已保存 SSID 时进入 AP

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:89-103
WifiBoard::TryWifiConnect
```

逻辑：

```cpp
bool have_ssid = !ssid_manager.GetSsidList().empty();
if (!have_ssid) {
  // delay 1500ms
  StartWifiConfigMode();
}
```

### 有 SSID 但连接超时进入 AP

超时时间：

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:26-27
CONNECT_TIMEOUT_SEC = 60
```

启动连接与定时器：

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:93-97
esp_timer_start_once(connect_timer_, CONNECT_TIMEOUT_SEC * 1000000ULL);
WifiManager::GetInstance().StartStation();
```

超时回调：

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:151-157
WifiBoard::OnWifiConnectTimeout
```

逻辑：

```cpp
WifiManager::GetInstance().StopStation();
board->StartWifiConfigMode();
```

### StartWifiConfigMode

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:159-175
WifiBoard::StartWifiConfigMode
```

在 `CONFIG_USE_HOTSPOT_WIFI_PROVISIONING` 下：

```cpp
wifi_manager.StartConfigAp();
wifi_manager.GetApSsid();
wifi_manager.GetApWebUrl();
```

Hotspot 配网默认启用：

```text
firmware/main/Kconfig.projbuild:778-785
CONFIG_USE_HOTSPOT_WIFI_PROVISIONING default y
```

### 按钮入口

StackChan 当前源码中按钮进入配网被注释：

```text
firmware/main/hal/board/stackchan.cc:653-659
hal_bridge::toggle_xiaozhi_chat_state
```

关键逻辑：

```cpp
// EnterWifiConfigMode();
return;
```

结论：按钮/交互入口不能作为确定可用路径。

## 2. AP SSID / IP / Portal

### SSID 前缀

```text
firmware/xiaozhi-esp32/main/boards/common/wifi_board.cc:55-58
config.ssid_prefix = "Xiaozhi";
```

### SSID 生成

```text
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc:111-122
WifiConfigurationAp::GetSsid
```

逻辑：

```cpp
esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
snprintf(ssid, sizeof(ssid), "%s-%02X%02X", ssid_prefix_.c_str(), mac[4], mac[5]);
```

源码确定 SSID 形如：

```text
Xiaozhi-XXXX
```

`XXXX` 是 SoftAP MAC 最后两个字节。

### Portal URL

```text
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc:125-128
WifiConfigurationAp::GetWebServerUrl
```

返回：

```text
http://192.168.4.1
```

### AP IP / 网关 / DHCP

```text
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc:139-146
WifiConfigurationAp::StartAccessPoint
```

配置：

```text
IP: 192.168.4.1
GW: 192.168.4.1
Netmask: 255.255.255.0
DHCP server enabled
```

DNS captive portal：

```text
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc:148-150
dns_server_->Start(ip_info.gw);
```

## 3. `/advanced/config` 与 `/advanced/submit`

文件：

```text
firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc
```

### `/advanced/config`

路由：

```text
wifi_configuration_ap.cc:507-546
HTTP_GET /advanced/config
```

返回 JSON 字段：

```text
ota_url: 仅非空时返回
max_tx_power
remember_bssid
sleep_mode
```

### `/advanced/submit`

路由：

```text
wifi_configuration_ap.cc:548-665
HTTP_POST /advanced/submit
```

请求：

```text
Content-Type: application/json
body <= 1024 bytes
NVS namespace: wifi
```

`ota_url` 写入：

```text
wifi_configuration_ap.cc:598-606
nvs_set_str(nvs, "ota_url", this_->ota_url_.c_str());
```

字段均可选：

```text
ota_url: cJSON_IsString 时写入
max_tx_power: cJSON_IsNumber 时写入
remember_bssid: cJSON_IsBool 时写入
sleep_mode: cJSON_IsBool 时写入
```

提交：

```text
wifi_configuration_ap.cc:644-646
nvs_commit(nvs);
nvs_close(nvs);
```

成功响应：

```text
wifi_configuration_ap.cc:654-657
{"success":true}
```

### 前端页面证据

```text
firmware/managed_components/78__esp-wifi-connect/assets/wifi_configuration.html:267
<form action="/advanced/submit" ...>
```

```text
wifi_configuration.html:272-277
ota_url input
```

```text
wifi_configuration.html:1334-1348
JS POST fields: ota_url, max_tx_power, remember_bssid, sleep_mode
```

```text
wifi_configuration.html:1403-1407
fetch('/advanced/config')
```

## 4. OTA URL 读取顺序

文件：

```text
firmware/xiaozhi-esp32/main/ota.cc
```

函数：

```text
Ota::GetCheckVersionUrl
ota.cc:47-52
```

逻辑：

```cpp
Settings settings("wifi", false);
std::string url = settings.GetString("ota_url");
if (url.empty()) {
  url = CONFIG_OTA_URL;
}
```

源码确定优先级：

```text
1. NVS wifi/ota_url
2. CONFIG_OTA_URL
```

默认值：

```text
firmware/main/Kconfig.projbuild:3-5
CONFIG_OTA_URL default "https://api.tenclass.net/xiaozhi/ota/"
```

## 5. OTA response 判断逻辑

文件：

```text
firmware/xiaozhi-esp32/main/ota.cc
```

函数：

```text
Ota::CheckVersion
```

URL 与方法：

```text
ota.cc:85-97
std::string url = GetCheckVersionUrl();
std::string data = board.GetSystemInfoJson();
std::string method = data.length() > 0 ? "POST" : "GET";
```

响应解析：

```text
ota.cc:213-240
```

逻辑：

```text
root.firmware.version string → firmware_version_
root.firmware.url string → firmware_url_
version 和 url 都是 string → 判断 IsNewVersionAvailable
firmware.force number 且 == 1 → has_new_version_ = true
```

版本比较：

```text
ota.cc:406-418
Ota::IsNewVersionAvailable
```

按点分版本逐段 int 比较。

## 6. 源码确定 vs 现场待验证

### 源码确定

- 存在 Wi-Fi 失败/无 SSID 进入 AP 的代码路径。
- SSID 规则是 `Xiaozhi-XXXX`，后缀来自 SoftAP MAC 后两字节。
- AP URL 是 `http://192.168.4.1`。
- 源码存在 `/advanced/config` 和 `/advanced/submit`。
- `/advanced/submit` 可写 NVS `wifi/ota_url`。
- OTA URL 优先读 NVS `wifi/ota_url`，再 fallback `CONFIG_OTA_URL`。

### 必须现场验证

- 当前设备官方发布固件是否与此源码/配置一致。
- 当前设备是否真的进入 AP/config portal。
- AP 页面和 advanced route 是否在当前固件中实际可用。
- 扫描到的 AP 是否真是 Chan。

## 7. 现场判断标准

如果设备断网后出现 AP，必须同时满足：

1. SSID 形如：

```text
Xiaozhi-XXXX
```

2. AP BSSID/SoftAP MAC 后两字节应与 SSID 后缀一致。

3. 客户端连接后网关应是：

```text
192.168.4.1
```

4. `GET http://192.168.4.1/advanced/config` 应返回 JSON，而不是路由器 captive portal。

5. `POST http://192.168.4.1/advanced/submit` 成功时应返回：

```json
{"success":true}
```

否则不能认定为 Chan AP。

## 8. 降级说明

以下说法必须降级为“待验证”：

- 断网后当前设备一定会开 AP。
- 看到任意 `192.168.4.1` 就是 Chan。
- 任意隐藏 ESP32/疑似 BSSID 就是 Chan。
- 当前官方发布固件一定包含源码中的 advanced route。
- 按钮可以进入 Wi-Fi 配网。
