# StackChan OTA 更新自定义 app.bin 可行性

更新时间：2026-05-15

## 1. 核心结论

通过 OTA 更新自定义 `app.bin` **技术上可行**，并且它确实有机会绕过初始化环节：

```text
只替换 app OTA 分区
保留 NVS
保留 Wi-Fi / 绑定 / websocket / mqtt 配置
```

但最大前提是：

```text
设备必须能把 NVS wifi.ota_url 指到自建 OTA 服务
```

否则设备默认访问官方 OTA：

```text
https://api.tenclass.net/xiaozhi/ota/
```

官方服务大概率只返回官方包/官方配置，不能让设备下载我们的自定义 `app.bin`。

## 2. OTA URL 来源

关键文件：

```text
firmware/xiaozhi-esp32/main/ota.cc
firmware/main/Kconfig.projbuild
```

`Ota::GetCheckVersionUrl()` 逻辑：

```text
先读 NVS namespace: wifi
key: ota_url
如果为空，使用 CONFIG_OTA_URL
```

默认值：

```text
CONFIG_OTA_URL = https://api.tenclass.net/xiaozhi/ota/
```

当前仓库只看到读取 `wifi.ota_url`，没有找到 App/UI/固件内置的写入入口。

因此当前最大阻塞是：

```text
如何合法、安全地写入 wifi.ota_url？
```

## 3. OTA response 形状

`Ota::CheckVersion()` 会解析类似 JSON：

```json
{
  "firmware": {
    "version": "1.4.2",
    "url": "https://your-server/stackchan-custom.bin",
    "force": 1
  },
  "mqtt": {
    "endpoint": "host:8883",
    "client_id": "...",
    "username": "...",
    "password": "...",
    "publish_topic": "...",
    "keepalive": 240
  },
  "websocket": {
    "url": "wss://...",
    "token": "...",
    "version": 3
  },
  "server_time": {
    "timestamp": 1710000000000,
    "timezone_offset": 480
  }
}
```

升级判断：

- `firmware.version` 和 `firmware.url` 都是 string 才判断升级；
- 版本按点分数字比较；
- `firmware.force = 1` 可强制升级。

如果目标是保留当前初始化/绑定，不应返回会触发重新激活的字段：

```text
activation.code
activation.challenge
```

也不应覆盖已有 mqtt/websocket 配置，除非明确需要。

## 4. OTA 写入流程

`Ota::Upgrade()` 使用 ESP-IDF OTA API：

```text
esp_ota_get_next_update_partition(NULL)
esp_ota_begin(...)
esp_ota_write(...)
esp_ota_end(...)
esp_ota_set_boot_partition(...)
```

它只写下一个 OTA app 分区，并更新启动分区选择。

分区事实：

```text
nvs      0x9000
otadata  0xd000
ota_0    app
ota_1    app
assets   data/spiffs, 4M
```

因此 OTA 固件本身：

```text
不会擦 NVS
不会写 assets
不会擦 Wi-Fi/绑定配置
```

但 `CheckAssetsVersion()` 另有 assets 下载逻辑，如果 NVS 里存在 `assets.download_url`，可能覆盖 assets 分区；自建 OTA response 不应引入这个行为。

## 5. Rollback / valid 标记

配置中启用：

```text
CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y
CONFIG_APP_ROLLBACK_ENABLE=y
```

有效标记逻辑：

- `Application::CheckNewVersion()` 在确认无新版本后调用 `MarkCurrentVersionValid()`；
- StackChan HAL 还有保护：运行约 20 秒后，如果当前分区是 `PENDING_VERIFY`，会 mark valid。

风险：

```text
新 app 若 20 秒内崩溃/重启，bootloader 会 rollback 到旧 app。
```

这是好事，能降低 OTA 失败后变砖风险。

## 6. 签名 / secure boot / flash encryption

源码配置显示：

```text
CONFIG_SECURE_BOOT is not set
CONFIG_FLASH_ENCRYPTION_ENABLED is not set
CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT is not set
CONFIG_APP_ANTI_ROLLBACK is not set
```

源码层面没有强制 app 签名校验、secure boot、flash encryption、anti-rollback。

但实机风险仍在：

```text
量产设备 eFuse 状态不能只凭源码判断。
```

如果实际设备启用了 secure boot / flash encryption，自定义 bin 可能无法启动或 OTA 校验失败。

## 7. 是否能绕过初始化

可以，前提是只替换 app 分区并保持兼容。

可保留：

```text
NVS
Wi-Fi
websocket/mqtt 凭据
设备绑定信息
Agent 关联
```

条件：

1. 自定义 app 使用相同或兼容分区表；
2. 不主动擦 NVS；
3. OTA response 不返回 activation challenge/code；
4. OTA response 不覆盖 mqtt/websocket 配置；
5. 自定义固件版本高于当前，或 response 带 `force: 1`；
6. `app.bin` 小于 app slot `0x4f0000`；
7. bootloader/IDF/image 格式兼容；
8. 新 app 继续兼容旧 NVS schema。

## 8. 对 celebrate 灯效的意义

新增真正的 celebrate 灯效属于 app 代码变更。

适合 OTA 带入：

```text
self.robot.celebrate
self.robot.set_led_effect
本地 LED effect 状态机
可选本地提示音常量
```

不需要改 assets/NVS，除非灯效依赖新增外部资源。

最小改造路径：

```text
hal_mcp.cpp 新增 MCP tool
neon_light.* 或 effect controller 新增本地动画
保持分区表/NVS/schema 不变
编译新的 stack-chan.bin
通过 OTA 更新 app slot
```

## 9. 阻塞点

1. 最大阻塞：未找到写入 `wifi.ota_url` 的公开入口。
2. 官方 OTA 服务是否允许自定义包：设备端不限制，但服务端大概率限制。
3. 实机 secure boot / flash encryption 状态未知。
4. 自定义 bin 必须严格匹配当前分区表、板型、IDF/bootloader 兼容性。
5. 自编译固件仍可能缺官方私有配置或破坏云端兼容。

## 10. 低风险验证顺序

仍不刷设备的阶段：

1. 静态确认 OTA 代码和分区表。
2. 查是否存在合法方式写入 NVS `wifi.ota_url`。
3. 搭建 OTA JSON mock，不含真实 token。
4. 用 curl 模拟设备 POST body，验证 response 结构。
5. 检查自定义 `app.bin` header、project/version、大小。
6. 静态检查自定义固件：
   - 不擦 NVS；
   - 不改分区表；
   - 不写 assets.download_url；
   - 不破坏 websocket/mqtt config；
7. 只有全部通过后，再考虑受控实机 OTA。

## 11. 当前判断

OTA 是“保留初始化/绑定状态并加入 celebrate 灯效”的最有希望路线。

但它不是无风险；真正开做前必须先解决：

```text
wifi.ota_url 如何设置
自定义 app.bin 是否能保持云端兼容
实机安全启动/加密状态
失败回滚路径
```
