# StackChan OTA firmware update chain

## 结论

StackChan 的 OTA 检查 URL 优先从 NVS `wifi.ota_url` 读取，覆盖编译期 `CONFIG_OTA_URL`。只要通过配网 AP 高级配置把 `ota_url` 指向局域网 OTA server，设备检查更新时就会向本地 `/ota/` 请求 manifest；manifest 中嵌套字段 `firmware.force` 为数字 `1` 时，可绕过普通版本比较，把指定 app 固件当作新版本刷入 OTA app 分区。

这条链路可用于升级、回退、救援或实验固件，但它不是“随便刷”：固件必须匹配板型、分区表和 OTA slot，并且 manifest 不应携带会覆盖官方连接或激活状态的字段。

## 长期行为 / 规则

- OTA URL 来源优先级：`Settings("wifi", false).GetString("ota_url")` 优先；为空时才使用 `CONFIG_OTA_URL`。
- 默认官方 OTA URL 为 `https://api.tenclass.net/xiaozhi/ota/`，但本地调试可把 `wifi.ota_url` 改成 `http://<LAN_IP>:8080/ota/`；该值可通过配网 AP 写入，也可在确认分区表后只修补 NVS 分区写入。
- 恢复官方 OTA 有两种稳定路径：清空 `wifi/ota_url` 让固件回退到编译期 `CONFIG_OTA_URL`，或在 NVS 中显式写入 `wifi/ota_url = https://api.tenclass.net/xiaozhi/ota/`；后者会优先于 `CONFIG_OTA_URL` 被 `Ota::GetCheckVersionUrl()` 使用。
- 清空 `wifi/ota_url`（空字符串 / NVS str_len=0）等价于移除自定义 OTA 覆盖，固件会自动回退到编译期 `CONFIG_OTA_URL` 官方地址；这是恢复官方 OTA URL 的低侵入手段。
- 设备配网 AP 高级配置入口可写入或清空 OTA URL：`POST http://192.168.4.1/advanced/submit`，body 使用 `{ "ota_url": "..." }`。
- 如果配网 AP 的 GET 页面或 `/advanced/config` 可访问，但 `POST /advanced/submit`、`POST /submit`、`POST /exit` 全部返回 `501 Not Implemented`，应先判定为 AP Web server 的 POST handler 没有被真实匹配或注册链路异常；不要据此假设 `ota_url` 已经写入 NVS。
- `WifiConfigurationAp::StartWebServer()` 中 `/submit`、`/exit`、`/advanced/submit` 都有 POST handler；若运行时所有 POST 统一 501，优先排查 `httpd_register_uri_handler` 注册结果、`httpd_uri_match_wildcard` 匹配、captive portal `/generate_204*` 等 wildcard handler 的注册顺序/冲突，以及真实固件是否包含当前 component。
- OTA manifest 的稳定结构是嵌套 `firmware` 对象：`firmware.version`、`firmware.url`、`firmware.force`；顶层兼容字段不能作为设备端真实读取依据。
- `firmware.force` 必须是 JSON 数字 `1/0`，不是 boolean `true/false`；源码只在 `cJSON_IsNumber(force) && force->valueint == 1` 时强制更新。
- 普通版本比较使用点分数字字符串并调用 `std::stoi` 解析；建议使用 `2.0.23` 这类纯数字点分版本，不要依赖 `2.0.0-test` 等带后缀格式。
- `force = 1` 的含义是绕过 `IsNewVersionAvailable(current, newer)` 结果，让 `has_new_version_ = true`；可用于升级、回退或救援版本。
- OTA 写入只走 ESP-IDF app OTA 分区：`esp_ota_get_next_update_partition(NULL)`、`esp_ota_begin()`、`esp_ota_write()`、`esp_ota_end()`、`esp_ota_set_boot_partition()`；不会自动擦 NVS、Wi-Fi、绑定或 assets 分区。
- 真实设备验收中，进入 XiaoZhi 后由 `ActivationTask::CheckNewVersion()` 触发的 OTA 已观察到完整前半段闭环：`Ota: Current version: 2.0.29` → `Ota: New version available: 2.0.30` → `Writing to partition ota_1` → `Progress: 100%` → `Firmware upgrade successful` → `Application: Firmware upgrade successful, rebooting...` → ESP32 ROM reboot。该证据足以证明下载、写 OTA app 分区、设置 boot partition 和 reboot 前 `set_boot_autostart_once_for_ota()` 成功执行。
- OTA 成功日志和 reboot 日志仍不等于“reboot 后已确认运行目标版本”：USB 串口重连可能漏掉最早启动窗口，必须用完整启动日志中的 `Project name` / `App version` / `BOOT-MODE`、设备 UI 版本或只读分区状态确认目标 app。
- manifest 不应返回 `activation`、`mqtt`、`websocket`、`assets.download_url` 等非必要字段：`ota.cc` 会解析 `activation`，并会把 `mqtt` / `websocket` 对象写入对应 Settings，误返回可能改变激活或官方连接配置。
- 本地 `tools/ota-mock-server/` 的安全默认模式应是 `probe` / `no-upgrade` / `confirm`，只有明确准备刷写时才使用 `upgrade`。
- StackChan 当前固件存在两阶段启动边界：Phase 1 是 `mooncake Launcher` 图标网格，Phase 2 才是 `xiaozhi-esp32` App。OTA 有两条触发线：Launcher view ready 后的 `start_autonomous_ota_check_once()` 会自动创建一次 `launcher_ota` 后台检查；进入 XiaoZhi 后另有 `ActivationTask::CheckNewVersion()` / `ota_->CheckVersion()`。因此 server 无设备请求时，要分别判断 Launcher 自主 OTA 是否已创建/是否卡在网络初始化，以及 XiaoZhi 是否已经进入。
- 从 Launcher 进入 XiaoZhi 可由用户触摸点击 `AI Agent` 图标触发，也可由 boot mode auto-open 触发：`get_boot_mode_xiaozhi_auto_open_source()` → `requestAutoOpenAiAgent()` → `AppAiAgent::onOpen()` → `requestXiaozhiStart()` → `main.cpp` 检测 flag 退出 launcher loop → `startXiaozhi()`；不要把“server 无设备请求”误判成 manifest、`force` 或下载 URL 错。
- Launcher 阶段还有一条手动 OTA UI 路径：`SETUP` app 的 About/System Update 中 `SystemUpdateWorker` 调用 `GetHAL().updateFirmware(...)`，最终复用 `Hal::updateFirmware()` 与 XiaoZhi `Ota::CheckVersion()` / `Ota::Upgrade()`；这条路径不依赖 HTTP 18080 或 MCP，但需要用户在设备屏幕操作。
- 当前本地 HTTP 18080 控制面没有稳定的 `/dev/ota/check`、`/dev/ota/update` 之类 OTA trigger endpoint；`hal_dev_local_control.cpp` 主要覆盖 status、wake/stop、MCP dispatch、celebrate/reminder 等 dev 能力。若目标是设备停在 Launcher 也能远程触发 OTA，需要新增 Launcher 阶段最小控制面或把受鉴权的 OTA trigger 提前到 Launcher 阶段，而不是只依赖现有 XiaoZhi 后 HTTP/MCP。
- USB 串口不能稳定替代这次触摸入口：报告确认 `start_dev_serial_wake_stop_task()` 运行时为空函数，`STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL` 未启用时也没有本地 HTTP 控制入口；NVS warm_boot 只能滚动到图标位置，不会自动点击。
- OTA manifest 的 `firmware.version`、bin 内 `PROJECT_VER` / `FIRMWARE_VERSION`、实际提供的 `stack-chan.bin` 路径必须三者一致；不要只相信目录名或脚本默认 `VERSION`。
- OTA 发布目录、`active-release` symlink、manifest `/ota/` 响应和真实 bin 也必须一致：至少核对 `active.json` / `GET /ota/` 的 `version`、`force`、`sha256`、`size`，并用 `sha256sum` / `stat` 对比 `firmware/build/stack-chan.bin` 与发布目录中的 `stack-chan.bin`。
- `ops/bin/stackchan-ota-release` 是本地 OTA 发布入口：发布前校验 bin 内 app desc version 与 `--version` 一致，计算 size/sha256，创建 `exp-pkg/candidate-<desc>-<version>/`，原子替换 `exp-pkg/active-release`，写 `ops/ota/active.json`，重启 user `stackchan-ota`，验证 `GET/POST /ota/`、`HEAD /stack-chan.bin`，并运行 `stackchan-doctor --json`；失败必须自动恢复旧 symlink 与旧 `active.json`。
- 对正常升级发布，`force=0` 是预期；`force=1` 只用于同版本/回退/救援等明确强制 OTA 场景，不要把强制更新作为默认发布口径。
- 重新打包或回归“点击 App 崩溃”时，必须固定已验证 bin 的路径与 SHA256，再和重打包 bin 对比；当前长期风险不是 OTA slot 容量不足，而是版本、产物和 OTA 参数错位。

## 关联代码

### 主锚点

- `firmware/xiaozhi-esp32/main/ota.cc`：OTA URL 读取、manifest 解析、`force` 判断、版本比较、`activation` / `mqtt` / `websocket` 解析、ESP-IDF OTA 写入主链路。
- `tools/ota-mock-server/ota-mock-server.py`：本地 OTA manifest 与固件下载 mock server，支持 `probe`、`no-upgrade` / `confirm`、`upgrade` 模式。
- `ops/bin/stackchan-ota-release`：本地 OTA 一键发布脚本，负责校验 app desc version、打包 candidate、原子切换 `active-release`、写 `active.json`、重启 user service、HTTP / doctor 验收和失败回退。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `tools/ota-mock-server/README.md` | 本地 OTA server 使用说明，记录 nested `firmware` schema、数字 `force`、probe/no-upgrade/upgrade 模式和风险。 |
| `tools/ota-mock-server/start-upgrade.sh` | 本地 upgrade 快捷脚本；默认 `VERSION` 和默认 `FIRMWARE` 路径必须与真实 bin 内版本核对。 |
| `tools/ota-mock-server/set-ota-url.sh` | 通过配网 AP `advanced/submit` 一键设置、清空或恢复官方 `ota_url`。 |
| `firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc` | 配网 AP Web server 主入口；`WifiConfigurationAp::StartWebServer()` 注册 `/submit`、`/exit`、captive portal GET wildcard、`/advanced/config` 与 `/advanced/submit`。 |
| `firmware/managed_components/78__esp-wifi-connect/include/wifi_configuration_ap.h` | 配网 AP 类声明；排查 handler 是否被当前 component 编译进固件时的头文件锚点。 |
| `patch_nvs_ota_url.py`（路径待确认） | 临时 USB/NVS 修补脚本；用于把 NVS 中 `wifi/ota_url` patch 为空字符串、官方 URL 或本地 OTA URL，并重算 entry/data/page CRC。 |
| `firmware/CMakeLists.txt` | `PROJECT_VER` / `FIRMWARE_VERSION` 来源；排查重打包版本错位时先看这里。 |
| `firmware/main/CMakeLists.txt` | dev HTTP / serial 编译开关与 WAV 资源嵌入；排查 `/dev/inject_prompt` 或 HTTP 控制能力时需要联动查看。 |
| `firmware/partitions.csv` | OTA app slot 大小锚点；用于确认是否真是分区容量问题。 |
| `firmware/xiaozhi-esp32/main/application.cc` | 应用侧触发 OTA 检查 / 升级流程的上游入口，调查 UI 或系统工具触发 OTA 时需要联动查看。 |
| `firmware/main/hal/hal.cpp` | `Hal::startXiaozhi()` / XiaoZhi 启动锚点；只有进入 XiaoZhi 阶段后才会初始化网络、HTTP 与 OTA 检查链路。 |
| `AppAiAgent::onOpen()` / `requestXiaozhiStart()` / `main.cpp`（路径待确认） | Launcher 触摸 `AI Agent` 图标到退出 launcher loop、进入 `startXiaozhi()` 的关键检索词；报告只给出符号名，后续需在源码中定位精确文件。 |
| `firmware/main/hal/hal_dev_serial.cpp` | Dev serial wake/stop 编译入口；本次报告确认运行时 `start_dev_serial_wake_stop_task()` 为空时不能用 USB 串口触发进入 XiaoZhi 或 OTA。 |
| `firmware/main/CMakeLists.txt` | `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`、`STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP` 编译开关；未启用本地 HTTP 控制时不能依赖 `/dev/*` 触发 OTA。 |

## 真实调用链路

### Launcher 到 XiaoZhi 的 OTA 前置链路

1. 设备上电后可能先进入 `mooncake Launcher`，屏幕显示应用图标网格。
2. Launcher view ready 后会调用 `start_autonomous_ota_check_once()`，创建一次 `launcher_ota` 后台 OTA 检查；这条线会启动网络，若现场出现 `sys_evt` stack overflow，应先排查 Wi-Fi event task 栈。
3. 进入 XiaoZhi 可由用户触摸点击 `AI Agent` 图标触发，也可由 `boot/start_once` 或 `boot/default_mode=xiaozhi` 的 auto-open 触发。
4. `AppAiAgent::onOpen()` 调用 `requestXiaozhiStart()` 设置进入 XiaoZhi 的 flag。
5. `main.cpp` 的 launcher loop 检测到 flag 后退出，随后调用 `startXiaozhi()`。
6. 进入 `xiaozhi-esp32` 后，`Application::Initialize()` 也会初始化 Wi-Fi / HTTP / OTA 相关链路，并可能通过 `ActivationTask::CheckNewVersion()` 读取 NVS `ota_url`，再调用 `ota_->CheckVersion()` 请求 `http://<LAN_IP>:8080/ota/`。
7. 若 server manifest 中 `firmware.version` 高于当前版本（例如 `2.0.26 > 1.4.2`）或 `firmware.force == 1`，设备才会进入后续下载与写 OTA 分区流程。

### Launcher 设置页手动 OTA 链路

1. 用户在 MoonCake Launcher 中打开 `SETUP` app。
2. `AppSetup::onOpen()` 创建 About/System 相关 workers。
3. 用户点击 About/System Update 中的 `SystemUpdateWorker`。
4. `SystemUpdateWorker` 调用 `GetHAL().updateFirmware(...)`。
5. `Hal::updateFirmware()` 复用 `Ota::CheckVersion()` 获取 manifest，并通过 `Ota::StartUpgrade()` / `Ota::Upgrade()` 下载固件、写入 OTA app 分区、设置 boot partition。
6. 上层 HAL/UI 流程负责展示状态并触发后续重启。

### OTA URL / manifest / 写入链路

1. 用户或脚本连接设备配网 AP，调用 `POST http://192.168.4.1/advanced/submit` 写入 `wifi.ota_url`，例如 `http://<LAN_IP>:8080/ota/`。
2. 设备执行 OTA 检查时，`Ota::GetCheckVersionUrl()` 先读取 NVS namespace `wifi` 的 `ota_url`，为空才退回 `CONFIG_OTA_URL`。
3. `Ota::CheckVersion()` 构造 HTTP 请求，向 OTA URL 发送设备 system info，通常本地 server 会看到 `POST /ota/`。
4. 设备解析 manifest：先处理 `activation`、`mqtt`、`websocket`、`server_time`，再读取嵌套 `firmware`。
5. `firmware.version` 和 `firmware.url` 为字符串时，设备先用 `IsNewVersionAvailable(current_version_, firmware_version_)` 做普通版本比较。
6. 若 `firmware.force` 是数字 `1`，设备强制设置 `has_new_version_ = true`，即使目标版本低于当前版本也会进入可升级状态。
7. 用户确认升级后，`Ota::StartUpgrade()` 调用 `Upgrade(firmware_url_)`。
8. `Upgrade()` 通过 HTTP GET 下载 app bin，要求 `Content-Length` 非零，并校验镜像头。
9. 固件数据按 4KB buffer 顺序写入 `esp_ota_get_next_update_partition(NULL)` 返回的 OTA app 分区。
10. 写完后调用 `esp_ota_end()` 验证镜像，再调用 `esp_ota_set_boot_partition(update_partition)` 设置下次启动分区。
11. 新 app 启动后若处于 pending verify，应通过 `Ota::MarkCurrentVersionValid()` / `esp_ota_mark_app_valid_cancel_rollback()` 标记有效；否则 ESP-IDF rollback 机制可能回滚到旧 app。

## OTA manifest 速查

推荐最小升级 manifest：

```json
{
  "firmware": {
    "version": "2.0.23",
    "url": "http://<LAN_IP>:8080/stack-chan.bin",
    "force": 1
  }
}
```

安全探测 / 不升级 manifest：

```json
{
  "firmware": {
    "version": "0.0.0",
    "url": "",
    "force": 0
  }
}
```

字段约束：

| 字段 | 长期要求 |
| ---- | ---- |
| `firmware.version` | 字符串；建议纯数字点分格式，如 `2.0.23`。 |
| `firmware.url` | 字符串；升级模式指向可下载 app bin。 |
| `firmware.force` | 数字 `1/0`；`1` 表示绕过普通版本比较。 |
| `activation` | 本地 OTA manifest 不建议返回，避免触发激活流程变化。 |
| `mqtt` / `websocket` | 本地 OTA manifest 不建议返回，避免写入并覆盖官方连接配置。 |
| `assets.download_url` | 本地 app OTA 不建议返回，避免误导为 assets 分区更新。 |

## AP 配网 Web 写入 OTA URL 速查

`http://192.168.4.1` 配网 AP 的高级配置页面不是只读入口：源码中 `WifiConfigurationAp::StartWebServer()` 会注册 `POST /advanced/submit`，用于把 `ota_url`、`max_tx_power`、`remember_bssid`、`sleep_mode` 写入 NVS namespace `wifi` 并 `nvs_commit()`。

稳定判读规则：

| 现象 | 长期含义 | 下一步 |
| ---- | ---- | ---- |
| `GET /advanced/config` 正常返回 JSON | AP Web server 正常响应 GET，且能读取当前内存/NVS 配置 | 只能说明 GET handler 可用，不能证明 POST 写入链路可用。 |
| `POST /advanced/submit` 返回 `{"success":true}` | 高级配置 handler 已执行并提交 NVS | 再触发 OTA 检查，观察本地 server 是否出现设备 IP 的 `POST /ota/`。 |
| `POST /advanced/submit`、`POST /submit`、`POST /exit` 全部 `501 Not Implemented` | POST method 没有进入已注册 handler；当前不能通过 AP API 写入或确认 `ota_url` | 先排查 URI handler 注册/匹配/固件产物，或改用 USB 串口/NVS 读取确认。 |
| 本地 OTA server 只有 `127.0.0.1` / 服务器自身 IP 请求，没有设备 IP | 设备没有访问当前 OTA server | 不要把 manifest、`firmware.force` 或 bin 下载当主因；先确认设备实际 `ota_url` 和是否触发 `Check for Updates`。 |

排查 `501 Not Implemented` 的源码顺序：

1. **先看响应文本**：`"501 Method Not Implemented"` → 来自 esp_http_server；`"501 Not Implemented"` → 来自中间层。
2. `firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc`：确认 `WifiConfigurationAp::StartWebServer()` 中 `/advanced/submit`、`/submit`、`/exit` 的 `HTTP_POST` handler 是否存在。
3. build map / symbol：确认 `WifiConfigurationAp::StartWebServer` 与 `/advanced/submit` handler 已编译链接进实际 bin。
4. `httpd_config_t config`：当前使用 `config.uri_match_fn = httpd_uri_match_wildcard`，需要关注 wildcard 匹配语义。
5. captive portal handlers：`/generate_204*` 等 GET wildcard 在 `/exit` 之后、`/advanced/submit` 之前注册；若所有 POST 都 501，优先核对是否存在注册失败、method 匹配异常、handler 数量/顺序或固件产物错位，而不是只盯 `/advanced/submit` 业务逻辑。
6. 固件版本错位：managed component 无 git 历史，设备固件可能使用旧版组件，不含对应 POST handler。

## USB/NVS 修补 OTA URL

当配网 AP 或 HTTP 工具不可用时，可以只通过 USB 修补 NVS 分区设置 `wifi/ota_url`：既可把设备从局域网 mock server 恢复到官方 OTA URL，也可把官方 OTA URL 改成本地 OTA server（例如 `http://<LAN_IP>:8080/ota/`）。

长期规则：

- 只处理 NVS 分区，不全量擦机、不写 app 固件、不碰 OTA slot；已验证的 NVS 分区地址/长度口径是 `0x9000` / `0x4000`（16KB），但后续仍应以当前分区表或 `esptool` 现场输出核对。
- 安全流程是先 `esptool read_flash 0x9000 0x4000 nvs_original.bin` 备份，再 patch `wifi/ota_url`，最后 `esptool write_flash 0x9000 <patched-nvs.bin>` 仅写回 NVS 分区；写回后应重新 `read_flash` 读回复核。
- 恢复官方 URL 可以选择“清空覆盖”或“显式写入官方 URL”：清空会回退到 `CONFIG_OTA_URL`；显式写入 `https://api.tenclass.net/xiaozhi/ota/` 会让 NVS 覆盖值直接等于官方地址。两者都要求重算 NVS entry CRC / data CRC。
- NVS 旧 entry 可能仍保留在后续 page 中但已处于 `ERASED` / `INVALID` 状态；判断当前有效值时，应以 NVS 状态机解析出的有效 entry 为准，不要被 page 中残留字符串误导。
- 修补时必须保留其它 NVS key，例如 `wifi/ssid`、`wifi/password`、`mqtt/endpoint`、`mqtt/client_id`、`board/uuid`、`websocket/url`；不要为了恢复 OTA URL 擦除 Wi-Fi、MQTT/WebSocket 绑定或设备 UUID。
- 当目标是切到本地 OTA server 时，可在当前 `ACTIVE` page 追加新的 `wifi/ota_url` string entry，而不是改写旧 entry；已验证做法是在 Page 3 追加 `ota_url` header entry + data entry，更新 bitmap 与 page CRC，使新值覆盖旧 `https://api.tenclass.net/xiaozhi/ota/`。
- NVS patch 的最小正确性标准：所有 page CRC 通过，新增 entry 的 entry CRC / data CRC 正确，旧 URL 不再是当前有效值，其它 key bit-exact 保持不变；仅看到旧 page 残留字符串不代表当前有效值仍是旧 URL。
- 写回后必须重新 boot 并读回 NVS 分区复核：解析出的 `wifi/ota_url` 应等于目标 URL（例如 `http://<LAN_IP>:8080/ota/`），敏感 key 不变化，patched 文件与最终读回 dump 在 NVS 分区范围内 0 diff。
- 验证时只需要确认 `wifi/ota_url` 为空、等于官方 URL 或等于目标本地 OTA URL、其它关键 key 仍存在；不要把真实 Wi-Fi 密码、client id、uuid 或 MAC 写入文档或日志摘要。

已知临时产物 / 检索词：`patch_nvs_ota_url.py`、`nvs_original.bin`、`nvs_current.bin`、`nvs_current2.bin`、`nvs_patched.bin`、`nvs-patched-v2.bin`、`nvs_final.bin`、`nvs-final.bin`、`nvs_official.bin`、`nvs_verify.bin`、`esptool read_flash 0x9000 0x4000`、`esptool write_flash 0x9000 <nvs.bin>`、`wifi/ota_url`、`ota_url entry`、`ACTIVE page`、`Page 3`、`header entry`、`data entry`、`bitmap`、`page CRC`、`entry CRC`、`data CRC`、`str_len=0`、`ERASED`、`INVALID`。

## 本地工具使用边界

| 工具 / 命令 | 长期含义 |
| ---- | ---- |
| `python3 tools/ota-mock-server/ota-mock-server.py --mode probe --port 8080` | 安全探测设备是否访问 `/ota/`，不广告固件 URL。 |
| `--mode no-upgrade` / `--mode confirm` | 返回当前/低风险 manifest，可用于确认无升级分支或 mark valid 相关排查。 |
| `--mode upgrade --firmware ../../firmware/build/stack-chan.bin` | 广告真实固件下载 URL，可能触发刷写；只在现场确认后使用；不能假设该路径就是最新验证版本。 |
| `tools/ota-mock-server/start-upgrade.sh` | 快捷启动 upgrade server；使用前必须核对脚本默认 `VERSION`、默认 `FIRMWARE` 路径和 bin 内版本。 |
| `tools/ota-mock-server/set-ota-url.sh set <URL>` | 写入设备配网 AP 的 `ota_url`。 |
| `set-ota-url.sh clear` | 清空自定义 `ota_url`。 |
| `set-ota-url.sh official` | 恢复官方 OTA URL。 |

## 固件产物一致性检查

排查“重新打包后无法运行”、点击 App 崩溃回归或 OTA 版本异常时，先做产物一致性检查，不要直接假设是分区容量不够。长期应同时记录：

| 检查项 | 目的 |
| ---- | ---- |
| `firmware/CMakeLists.txt` 的 `PROJECT_VER` | 确认源码编译出的 `FIRMWARE_VERSION`，避免源码已回退但包名仍写新版本。 |
| `project_description.json` | 确认构建目录记录的 app 版本。 |
| `strings <build-dir>/stack-chan.bin` | 从二进制内核对实际版本字符串。 |
| `sha256sum <verified.bin> <repacked.bin>` | 固定已验证 bin 与重打包 bin 的差异，避免把不同产物当同一版本。 |
| `tools/ota-mock-server/start-upgrade.sh` 的 `VERSION` / `FIRMWARE` | 确认 manifest 广告版本与实际提供 bin 一致。 |
| `active.json` / `GET /ota/` 的 `version`、`force`、`sha256`、`size` | 确认 OTA server 真实响应与发布目录、bin 产物一致；正常发布默认 `force=0`，强制 OTA 才使用数字 `force=1`。 |
| `exp-pkg/active-release` symlink | 确认 active symlink 指向当前发布目录，避免服务端仍广告旧包或错包。 |
| `ops/bin/stackchan-ota-release <bin> --version x.y.z --dry-run` | 发布前模拟全流程；应验证 app desc version、size/sha256、candidate 路径、active manifest 预期变化，但不写文件、不重启服务。 |

已知高风险错位模式：

- 目录名类似 `build-active-release-2.0.25` 不等于 bin 内版本；必须以 `PROJECT_VER`、`project_description.json` 和 bin 内字符串交叉确认。
- `start-upgrade.sh` 可能默认广告一个版本，但实际提供 `firmware/build/stack-chan.bin`；如果 `firmware/build` 是旧版本，会形成 manifest 与 app desc 不一致。
- 目标功能依赖 `/dev/inject_prompt` 或本地 HTTP 控制时，必须确认目标 build 的 `compile_commands.json` 中存在 `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`，并确认 WAV 资源 `.wav.S` 被嵌入。

最小只读核对命令示例：

```bash
sha256sum <verified-v2.0.29.bin> <repacked.bin>
strings <repacked.bin> | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$'
grep -q STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL <build-dir>/compile_commands.json
grep -q celebration-tts-16k-mono-s16-approx3s.wav.S <build-dir>/compile_commands.json
```

## OTA slot 容量判断

当前已知 app slot 口径：`firmware/partitions.csv` 中 `ota_0` 与 `ota_1` 大小均为 `0x4f0000`（约 5,177,344 bytes）。如果 bin 大约 3.8–4.0 MB，使用率约 74%–77%，通常不像是 slot 放不下。

容量判断仍应以当前 `partitions.csv` 和实际 bin 大小为准；只有当 bin 接近或超过 OTA app slot 时，才把分区容量作为主因。

预期本地 server 请求序列：

```text
POST /ota/
HEAD /stack-chan.bin
GET  /stack-chan.bin
```

其中 `HEAD` / `GET` 只应在 upgrade manifest 广告了固件 URL 后出现；probe/no-upgrade 模式不应触发下载。

OTA 本地监控的稳定判读规则：

- 若本地 OTA server 端口正常监听、固件 bin 可读，但日志中完全没有设备 IP 的 `POST /ota/`，则 OTA 检查没有到达 server，升级流程尚未开始；此时不要把问题归因于 manifest、`firmware.force` 或 bin 下载失败。
- StackChan OTA 仍依赖设备端主动触发检查，例如用户在设备 UI 中进入 `SETUP -> Firmware -> Check for Updates`，或从 Launcher 点击 `AI Agent` 图标进入 XiaoZhi 后由 `ActivationTask::CheckNewVersion()` 自动检查；server 侧只提供 manifest 和固件下载，不会主动推送升级。
- 如果设备仍停在 `mooncake Launcher`，本地 OTA server 没有设备 IP 的 `POST /ota/` 是预期现象；此时应先完成触摸屏点击 `AI Agent` 的前置动作，而不是继续调整 manifest、`force`、SHA256 或 systemd server。
- 设备 `ping` 可达、串口仍有 `SERVO-MOVE prevent_disconnect` / `SystemInfo` 等活跃日志，只能说明设备未掉线或未 panic；不能证明设备已进入 XiaoZhi、网络已初始化、OTA UI 已打开，或 `/dev/*` 服务可用。
- 若 `POST /ota/` 缺失且设备 `80` / `8080` 等 HTTP 端口无响应，应优先区分两类问题：用户尚未触发系统更新，或设备端 HTTP/UI/Dev 控制组件未启动或不可达；这不是 OTA server 配置正确性的反证。
- 对真实设备 OTA，验收应拆成两个阶段记录：第一阶段看 OTA server manifest、`GET /stack-chan.bin`、串口 `Progress: 100%`、`Firmware upgrade successful`、`Application: Firmware upgrade successful, rebooting...`；第二阶段必须捕获 reboot 后完整启动日志或只读分区状态。若 reboot 后只看到 Launcher `SERVO-MOVE`、无 Wi-Fi 初始化、HTTP timeout、ping 不通、tcpdump 0 字节，应写成“重启后未观察到网络/自主 OTA/AI.AGENT 自动打开”，不能反推 OTA 下载写入失败。

## esp_http_server 501 源码级鉴别

`esp_http_server` 返回 501 的精确条件：

- **源码位置**：`esp-idf/components/esp_http_server/src/httpd_parse.c:71`，当 `parser->method < 0`（http-parser 无法识别 HTTP method）时设置 `HTTPD_501_METHOD_NOT_IMPLEMENTED`。
- **响应文本**：`esp-idf/components/esp_http_server/src/httpd_txrx.c:427-428`，返回的是 `"501 Method Not Implemented"`（**带 "Method"**）。
- **标准 HTTP 501** 文本通常是 `"501 Not Implemented"`（**不带 "Method"**）。

**鉴别规则**：

| 响应文本 | 来源 | 含义 |
| -------- | ---- | ---- |
| `501 Method Not Implemented` | esp_http_server | HTTP method 无法被 http-parser 解析（如非标准 method） |
| `501 Not Implemented` | **不是** esp_http_server | 来自中间层（OS captive portal、代理、浏览器安全策略等） |

- URI 找不到 → 404（`httpd_uri.c`）；URI 存在但 method 不匹配 → 405；method 无法解析 → 501。
- POST 作为标准 HTTP method 不应触发 esp_http_server 的 501；如果 POST 返回 501，优先怀疑中间层拦截或固件中未包含对应 handler。

## AP Web Handler 注册表速查

**源码**：`firmware/managed_components/78__esp-wifi-connect/wifi_configuration_ap.cc`
**组件**：`78/esp-wifi-connect` 3.1.2（`idf_component.yml`: `~3.1.1`）
**匹配模式**：`httpd_uri_match_wildcard`

| # | Method | URI | 功能 |
| - | ------ | --- | ---- |
| 1 | GET | `/` | 返回配网 HTML |
| 2 | GET | `/saved/list` | 已保存 WiFi 列表 JSON |
| 3 | GET | `/saved/set_default` | 设置默认 WiFi |
| 4 | GET | `/saved/delete` | 删除已保存 WiFi |
| 5 | GET | `/scan` | WiFi 扫描结果 JSON |
| 6 | **POST** | **`/submit`** | WiFi 连接提交（JSON: ssid/password） |
| 7 | GET | `/done.html` | 配网成功页 |
| 8 | **POST** | **`/exit`** | 退出配网模式 |
| 9-18 | GET | captive portal ×10 | 302 重定向到 `/`（含 `/generate_204*` 等） |
| 19 | GET | `/advanced/config` | 高级配置读取 JSON |
| 20 | **POST** | **`/advanced/submit`** | 高级配置写入 NVS（JSON: ota_url/max_tx_power/remember_bssid/sleep_mode） |

- 共 20 个 handler，`max_uri_handlers = 24`，不存在溢出问题。
- `/advanced/submit` 在组件 v2.4.0 才出现；`/submit` 和 `/exit` 在 v2.0.0+ 就存在。
- managed component 无 git 历史（从 registry 下载），无法追溯旧固件构建时使用的组件版本。

## 固件版本 vs 组件版本错位排查

设备固件版本与源码版本可能不一致：

- 设备 OTA UA 中显示的版本（如 `ua=m5stack-stack-chan/1.4.1`）可能不等于当前源码 `PROJECT_VER`（如 `1.4.2`）。
- `managed_components/` 下的组件从 ESP Component Registry 下载，无 git 历史；无法追溯旧固件构建时锁定的组件版本。
- 如果设备固件版本对应的组件不含某个 handler（如 1.4.1 对应的组件 < v2.4.0 不含 `/advanced/submit`），对应端点会返回 404 而非 501。

**判断设备实际固件支持能力的方法**：

| 方法 | 操作 | 判断标准 |
| ---- | ---- | ---- |
| `GET /advanced/config` | `curl http://192.168.4.1/advanced/config` | 返回 JSON → 组件 ≥ v2.4.0；404 → 旧版本 |
| `GET /` HTML | `curl http://192.168.4.1/` | 有 `switchTab('advanced')` → 含 advanced tab |
| OTA UA | 查看 mock server 日志 | `ua=m5stack-stack-chan/1.4.1` → 确认版本 |
| 串口日志 | 连接串口看启动日志 | `app_version=` 字段 |

## POST 501 渐进诊断流程

```bash
# Step 1: 确认 AP Web Server 是否在运行
#   → 返回 HTML = 正常；无响应 = 设备未在 AP 配网模式
curl -v http://192.168.4.1/

# Step 2: 确认 advanced 端点是否存在
#   → JSON = 组件 ≥ v2.4.0；404 = 旧固件不含此端点
curl -v http://192.168.4.1/advanced/config

# Step 3: 确认 GET scan 可用
curl -v http://192.168.4.1/scan

# Step 4: Verbose POST，观察原始响应头和响应体
#   → 重点看响应文本是 "501 Method Not Implemented" 还是 "501 Not Implemented"
curl -v -X POST http://192.168.4.1/advanced/submit \
  -H "Content-Type: application/json" \
  -d '{"ota_url":"http://192.168.0.12:8080/ota/"}'
```

**验收判读**：

| 观察结果 | 结论 |
| -------- | ---- |
| GET `/` 返回 HTML 且 GET `/advanced/config` 返回 JSON | AP 服务正常，问题在 POST 层 |
| GET `/advanced/config` 返回 404 | 设备固件版本不含 advanced 端点，需刷新固件 |
| 所有 GET 都是 501 | 设备未在 AP 配网模式，当前 HTTP server 可能是 dev local control |
| POST 响应含 `"Method Not Implemented"` | 501 来自 esp_http_server，method 未被 http-parser 识别 |
| POST 响应只有 `"Not Implemented"`（无 Method） | 501 来自中间层（OS/代理），不是 esp_http_server |

**POST 全部 501 的三重根因优先级**：

1. **设备固件版本使用的组件不含 POST handler**（置信度最高）— 需刷入新固件。
2. **501 来自 OS/浏览器中间层**（非 esp_http_server）— 用 `curl -v` 直连可绕过浏览器问题。
3. **设备未在 AP 配网模式** — 192.168.4.1 上运行的可能是 `hal_dev_local_control.cpp` 而非配网 AP。

## 已知陷阱

- 不要把 `force: true` 当成强制更新；源码要求数字 `1`。
- 不要返回扁平 manifest 后假设设备会读取；设备端真实读取嵌套 `firmware` 对象。
- 不要用带后缀版本号依赖普通比较；`ParseVersion()` 用 `std::stoi` 解析点分段，非纯数字后缀有兼容风险。
- 不要只看目录名、包名或 manifest `version` 判断固件版本；必须核对 bin 内 app desc / 字符串和 `PROJECT_VER`。
- 不要让 `start-upgrade.sh` 默认路径在不知情时推送 `firmware/build/stack-chan.bin`；该目录可能不是当前已验证版本。
- 不要把“重新打包后无法运行”优先归因为 slot 大小；先核对版本/产物/OTA 参数错位和 bin SHA256。
- 不要在本地 OTA manifest 中顺手复制官方响应里的 `mqtt` / `websocket` / `activation` 字段；这些字段会被设备端解析并可能改写状态。
- 不要把 app OTA 等同于擦机：ESP-IDF OTA 写入 app 分区，NVS、Wi-Fi 和绑定通常保留；除非新固件代码主动清理或分区表不兼容。
- 不要为了清除本地 OTA mock 地址而擦 NVS；优先清空 `wifi/ota_url`，并保留 Wi-Fi、MQTT/WebSocket、UUID 等关键 key。
- 不要把“server 没有 `POST /ota/`”误判成 `firmware.force`、manifest schema 或 bin 文件问题；没有 `POST /ota/` 表示设备侧没有发起 OTA 检查，排查应转向用户触发路径、设备 UI/HTTP 可达性和 OTA URL 配置是否实际生效。
- 不要把配网 AP 页面能打开等同于 `ota_url` 已写入；如果所有 POST endpoint 返回 `501 Not Implemented`，`/advanced/submit` handler 没有真实执行，NVS 中的 `wifi/ota_url` 仍未知。
- 不要在 AP Web POST 全面 501 时继续反复改 manifest；最小有效证据是设备 IP 访问本地 `/ota/`，或通过串口/NVS 直接读到 `Ota::GetCheckVersionUrl()` 实际返回本地 URL。
- `BrokenPipe`、下载中断或 server 关闭通常说明固件未完整下载；先核对 manifest schema、`Content-Length`、bin 可读性和网络稳定性。
- 新 app pending verify 阶段崩溃或重启会触发 bootloader rollback；这是保护机制，不应误判为设备变砖。
- `upgrade` server 监听局域网端口时，局域网其它机器也可访问；测试完应关闭 server，并按需清空或恢复 `ota_url`。

## 验证标准

后续修改 OTA 链路或本地 OTA 工具时，至少验证：

- `Ota::GetCheckVersionUrl()` 仍保持 `wifi.ota_url` 优先于 `CONFIG_OTA_URL`。
- mock server 输出仍包含 nested `firmware.version/url/force`，并确保 `force` 序列化为数字。
- `firmware.version`、`start-upgrade.sh VERSION`、实际 `stack-chan.bin` 内版本和已验证 bin SHA256 必须一致或差异有明确记录。
- probe/no-upgrade/confirm 模式不会广告可下载固件 URL，也不会触发设备访问 `/stack-chan.bin`。
- upgrade 模式的 `Content-Length` 正确，bin 文件可完整读取，server 日志能区分 `POST /ota/`、`HEAD /stack-chan.bin`、`GET /stack-chan.bin`。
- 如果监控窗口内没有 `POST /ota/`，结论应写成“设备未触发/未到达 OTA 检查”，而不是“升级失败”；后续必须先确认用户是否点击 `Check for Updates`、设备 `wifi.ota_url` 是否指向当前 server、设备端 UI/HTTP 服务是否可达。
- AP Web 写入路径应至少验证 `GET /advanced/config` 与 `POST /advanced/submit`；若 `/submit`、`/exit`、`/advanced/submit` 全部 `501 Not Implemented`，必须转入 handler 注册/匹配或 USB/NVS 读取排查，不能继续声称 URL 已改好。
- manifest 不携带会覆盖设备状态的 `activation`、`mqtt`、`websocket` 或 assets 更新字段。
- 新固件启动后能进入 mark valid 分支，避免 pending verify 自动回滚。
- 清空或恢复官方 `ota_url` 的路径仍可用，避免设备长期指向错误本地 OTA server。
- USB/NVS 修补路径应确认只写 `0x9000` / `0x4000` NVS 分区，`wifi/ota_url` 为空、等于官方 URL 或等于目标本地 OTA URL；新增/清空 entry、bitmap、page CRC、entry CRC、data CRC 正确，boot 后读回与 patched NVS 0 diff，且其它关键 NVS key 保留。

## 关键检索词

- `wifi.ota_url`
- `wifi/ota_url`
- `str_len=0`
- `CONFIG_OTA_URL`
- `https://api.tenclass.net/xiaozhi/ota/`
- `Ota::GetCheckVersionUrl()`
- `Ota::CheckVersion()`
- `Ota::StartUpgrade()`
- `Ota::Upgrade()`
- `Ota::MarkCurrentVersionValid()`
- `IsNewVersionAvailable()`
- `ParseVersion()`
- `firmware.version`
- `firmware.url`
- `firmware.force`
- `force: 1`
- `advanced/submit`
- `POST /advanced/submit`
- `POST /submit`
- `POST /exit`
- `501 Not Implemented`
- `WifiConfigurationAp::StartWebServer()`
- `httpd_register_uri_handler`
- `httpd_uri_match_wildcard`
- `/generate_204*`
- `tools/ota-mock-server/ota-mock-server.py`
- `tools/ota-mock-server/set-ota-url.sh`
- `patch_nvs_ota_url.py`
- `nvs_original.bin`
- `nvs_official.bin`
- `nvs-patched-v2.bin`
- `nvs-final.bin`
- `nvs_verify.bin`
- `esptool read_flash 0x9000 0x4000`
- `esptool write_flash 0x9000 <nvs.bin>`
- `ACTIVE page`
- `Page 3`
- `header entry`
- `data entry`
- `bitmap`
- `page CRC`
- `entry CRC`
- `data CRC`
- `ERASED`
- `INVALID`
- `esp_ota_get_next_update_partition`
- `esp_ota_begin`
- `esp_ota_write`
- `esp_ota_end`
- `esp_ota_set_boot_partition`
- `esp_ota_mark_app_valid_cancel_rollback`
- `ESP_OTA_IMG_PENDING_VERIFY`
- `PROJECT_VER`
- `FIRMWARE_VERSION`
- `project_description.json`
- `start-upgrade.sh`
- `firmware/build/stack-chan.bin`
- `exp-pkg/active-release`
- `active.json`
- `GET /ota/`
- `firmware.force`
- `force=0`
- `force=1`
- `compile_commands.json`
- `STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL`
- `celebration-tts-16k-mono-s16-approx3s.wav.S`
- `esp-idf/components/esp_http_server/src/httpd_parse.c`
- `esp-idf/components/esp_http_server/src/httpd_txrx.c`
- `esp-idf/components/esp_http_server/src/httpd_uri.c`
- `HTTPD_501_METHOD_NOT_IMPLEMENTED`
- `parser->method < 0`
- `501 Method Not Implemented`（esp_http_server 特有）
- `ua=m5stack-stack-chan/1.4.1`
- `app_version=`
- `switchTab('advanced')`
- `httpd_uri_match_wildcard`
- `max_uri_handlers`
- `partitions.csv`
- `ota_0`
- `ota_1`
- `sha256sum`
- `strings <bin>`
- `BrokenPipe`
