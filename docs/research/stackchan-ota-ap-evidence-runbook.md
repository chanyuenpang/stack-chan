# StackChan OTA / AP 操作路径 — 源码证据化 Runbook

> 基于本地项目源码 (`xiaozhi-esp32/main`, `78__esp-wifi-connect`) 的事实整理，不做推测。
> 最后更新: 2026-05-16

---

## 1. 设备何时进入 Wi-Fi AP / Config Portal？

### 源码确定的触发条件

**文件**: `xiaozhi-esp32/main/boards/common/wifi_board.cc`

| 条件 | 函数 | 触发时机 | 源码行证 |
|------|------|---------|---------|
| **无已保存 SSID** | `TryWifiConnect()` | 开机执行 StartNetwork() 后，SsidManager::GetSsidList() 为空 → 1.5s 后进 Wi-Fi 配置模式 | L91-99: `if (have_ssid) { ... } else { vTaskDelay(1500); StartWifiConfigMode(); }` |
| **连接超时** | `OnWifiConnectTimeout()` | 连接尝试超过 60 秒（`CONNECT_TIMEOUT_SEC`）→ StopStation → StartWifiConfigMode | L43: `static constexpr int CONNECT_TIMEOUT_SEC = 60;`; L132-136: timer callback |
| **外部调用** | `EnterWifiConfigMode()` | 可被 UI/按钮/语音调用，但当前 `board.h` 中 `EnterWifiConfigMode` 被注释（未暴露为公有接口） | L164-193: 函数实现存在，检查 State 并 ResetProtocol → StartWifiConfigMode |

### 真正执行 AP 启动的路径

`StartWifiConfigMode()` → 检查 `CONFIG_USE_HOTSPOT_WIFI_PROVISIONING` / `CONFIG_USE_ESP_BLUFI_WIFI_PROVISIONING` / `CONFIG_USE_ACOUSTIC_WIFI_PROVISIONING`

**现场待验证**: 当前固件编译时是否启用了 `CONFIG_USE_HOTSPOT_WIFI_PROVISIONING`。若未启用，Wi-Fi AP 页面不会启动。

---

## 2. AP SSID 命名规则

**文件**: `managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc` L121

```cpp
snprintf(ssid, sizeof(ssid), "%s-%02X%02X", ssid_prefix_.c_str(), mac[4], mac[5]);
```

- **前缀** = `"Xiaozhi"`（`wifi_board.cc` L57: `config.ssid_prefix = "Xiaozhi";`）
- **MAC 来源**: `esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP)` — SoftAP MAC
- **最终 SSID 格式**: `Xiaozhi-<MAC最后2字节大写HEX>`
  - 示例: SoftAP MAC 最后两字节 `78:A8` → SSID = `Xiaozhi-78A8`

**文件**: `wifi_configuration_ap.cc` L132

```cpp
std::string WifiConfigurationAp::GetWebServerUrl() {
    return "http://192.168.4.1";
}
```

Portal IP 为硬编码 **http://192.168.4.1**。

---

## 3. `/advanced/config` 和 `/advanced/submit` 端点

**文件**: `managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc`

### `/advanced/config` — GET

- 路由注册: L460-498
- 返回 JSON: `{ "ota_url": "...", "max_tx_power": 78, "remember_bssid": true, "sleep_mode": false }`
- 数据源: NVS namespace `"wifi"`，键 `ota_url` / `max_tx_power` / `remember_bssid` / `sleep_mode`
- NVS 打开模式: `NVS_READONLY`

### `/advanced/submit` — POST

- 路由注册: L501-612
- POST body JSON：可包含 `ota_url`, `max_tx_power`, `remember_bssid`, `sleep_mode`
- **每个字段都是可选的**（通过 `cJSON_GetObjectItem(json, "ota_url")` 单独检查）
- 写入: NVS namespace `"wifi"`，分别调用 `nvs_set_str(nvs, "ota_url", ...)`, `nvs_set_i8(...)`, `nvs_set_u8(...)`
- 提交: `nvs_commit(nvs)` ✅ 写入后立即持久化
- 成功响应: `{"success":true}`
- Body 上限: 1024 字节

---

## 4. OTA 检查 URL 读取顺序

**文件**: `xiaozhi-esp32/main/ota.cc` L55-61

```cpp
std::string Ota::GetCheckVersionUrl() {
    Settings settings("wifi", false);
    std::string url = settings.GetString("ota_url");       // 1️⃣ NVS "wifi/ota_url"
    if (url.empty()) {
        url = CONFIG_OTA_URL;                               // 2️⃣ Kconfig 编译常量
    }
    return url;
}
```

**顺序**: NVS `wifi/ota_url` > `CONFIG_OTA_URL`（Kconfig 编译时默认值）

---

## 5. OTA Response 版本判断逻辑

**文件**: `xiaozhi-esp32/main/ota.cc` L203-228

### CheckVersion() 流程

1. 获取当前版本: `esp_app_get_description()->version`
2. HTTP POST 到 GetCheckVersionUrl()，body 为设备信息 JSON
3. 解析响应 JSON: `{ "firmware": { "version": "1.0.0", "url": "http://...", "force": 0 } }`
4. 版本比较（语义版本）:
   - `IsNewVersionAvailable()` (L294-310): 按 `.` 分隔版本号，逐段比较数字
   - `force==1` 时强制覆盖为有新版本（L228: `if (force->valueint == 1) { has_new_version_ = true; }`）
5. `StartUpgrade()`: 调用 `Upgrade(firmware_url_, callback)`，从 firmware_url 下载并写入 OTA 分区

---

## 6. 源码确定 vs 现场待验证

### ✅ 源码确定 (不需要真机验证)

| 结论 | 证据 |
|------|------|
| AP SSID 格式为 `Xiaozhi-<MAC后4位>` | `wifi_configuration_ap.cc` L121 |
| Portal IP 是 `http://192.168.4.1` | `wifi_configuration_ap.cc` L132 |
| `/advanced/config` 和 `/advanced/submit` 存在并可读写 NVS `wifi/ota_url` | `wifi_configuration_ap.cc` L460-612 |
| OTA URL 优先读取 NVS `wifi/ota_url`，回退到 `CONFIG_OTA_URL` | `ota.cc` L55-61 |
| 无已保存 SSID 时自动进 AP 模式（延迟 1.5s） | `wifi_board.cc` L91-99 |
| 连接 60 秒超时自动进 AP 模式 | `wifi_board.cc` L43, L132-136 |
| `force: 1` 强制覆盖版本检查 | `ota.cc` L226-228 |
| 版本对比使用语义版本号（逐段数字比较） | `ota.cc` L294-310 |

### ⚠️ 现场待验证 (当前源码环境无法确认)

| 项目 | 为什么需要验证 |
|------|--------------|
| 当前固件是否启用 `CONFIG_USE_HOTSPOT_WIFI_PROVISIONING` | AP 模式入口被此编译开关控制；若未启用则不会启动 Wi-Fi 配置页面 |
| 当前固件是否启用了 BLE 配网而非 AP | 若 `CONFIG_USE_ESP_BLUFI_WIFI_PROVISIONING` 启用且未启用 Hotspot，AP 不会启动 |
| `EnterWifiConfigMode()` 是否真被 UI/按钮/语音入口触发 | 函数存在但 board.h 中该函数被注释 |
| 当前设备的 NVS `wifi/ota_url` 是否有值 | 可通过访问 /advanced/config 获取 |
| 当前设备 MAC 地址及对应的 Xiaozhi-XXXX SSID | SoftAP MAC 在设备内，OTA 分发时写入，无法从源码推导完整 |
| 当前设备是否连上过 Wi-Fi 且 NVS 中有已保存 SSID | 若有已保存 SSID 且超时前成功连接，不会进 AP 模式 |
| 设备断电再上电后是否仍会触发 AP | 取决于 NVS `wifi/sleep_mode` 和实际使用场景 |

---

## 7. 此前推测/需降级的说法

| 此前说法 | 实际源码事实 |
|---------|------------|
| "AP 页面默认开启" | 仅当 `CONFIG_USE_HOTSPOT_WIFI_PROVISIONING` 启用时才会启动 AP 网页 |
| "设备按钮可触发进入 AP" | `EnterWifiConfigMode()` 存在但 `board.h` 中该声明被注释；需现场验证实际是否连通 UI |
| "/advanced/submit 可只写 ota_url" | ✅ 源码确认每字段可选 |
| "Xiaozhi-XXXX 中的 XXXX 是设备 MAC" | 确认是 SoftAP MAC 最后 2 字节（4 hex 位），不是完整 MAC |
| "断网后设备一定会进入 AP" | 仅当无已保存 SSID 或连接超时才会触发；若有 NVS 中的旧 SSID 且在范围内，它会再次尝试连接 |
| "probe 模式 safe" | 当无 `firmware.url` 时设备 CheckVersion 会连接失败但不会升级；如果 `firmware.version` 不含 `.` 可能解析异常 |

---

## 8. 验证 AP 是否来自 Chan — 非推测判断标准

如果用户让设备断网后看到一个新 AP，判断是否是 StackChan：

| 判断项 | 标准 | 来源 |
|--------|------|------|
| SSID 名称 | 必须为 `Xiaozhi-XXXX`（前缀大小写敏感） | `wifi_board.cc` L57 |
| MAC 前 3 字节 | SoftAP 通常为 Espressif (如 34:85:18, 40:F5:20, etc.) | OUI 注册 |
| HTTP 端点 | `http://192.168.4.1/` 返回 HTML | 硬编码 |
| HTTP 端点 | `http://192.168.4.1/advanced/config` 返回 JSON 含 ota_url 等字段 | 源码确认路由注册 |
| HTTP POST | `http://192.168.4.1/advanced/submit` POST JSON → 返回 `{"success":true}` | 源码确认路由注册 |
| HTTP POST | `http://192.168.4.1/exit` POST → 退出配置模式 | 源码确认路由注册 |

**反面判断**: 若 AP 显示 `Huawei-S2CPCP_HiLink`、`TP-LINK_*` 等名称，或 BSSID OUI 不属于 Espressif → 非 StackChan。

---

## 9. 下一步操作建议

基于当前状态（AP 不可用、设备未上线）：

### 方案 A：继续等用户配网（Change Wi-Fi）
- 用户已尝试通过 App 给设备配入家庭 Wi-Fi
- 若成功，设备 MAC 44:1B:F6:E2:78:A8 会出现在局域网中
- 可监听 ARP 表确认

### 方案 B：放弃 AP 路线，走 app-only OTA URL
- 见 Task 7 设计的 app-only OTA URL 测试路线
- 需烧录（或通过其他方式写入）NVS `wifi/ota_url`
- 不依赖 AP 模式

### 方案 C：直接验证设备 MCP 庆祝能力
- 继续用 XiaoZhi MCP bridge 连接
- 通过 App 对话触发设备内置工具（set_led_color, set_head_angles 等）
- 不依赖 OTA
