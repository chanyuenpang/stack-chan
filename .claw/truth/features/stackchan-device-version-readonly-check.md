# StackChan `stackchan-device-version` 只读版本检查工具

## 结论

`ops/bin/stackchan-device-version` 是 StackChan 当前设备运行版本、OTA server 广告版本与 active bin app desc 的只读核对入口。它不会触发设备动作、重启、刷机、NVS 写入或串口交互；HTTP 路径只读 `GET /dev/status`，OTA server 路径只读本机 `GET /ota/` 与 active bin app desc，USB 路径只检查 `/dev/ttyACM*` 和已有 `/tmp/stackchan-serial*.log`。

长期判读规则是：**新固件的 `/dev/status` 必须提供 `app_version` / `project_name` / `idf_version` 才能把设备当前运行版本可靠归入 `device_running_version`；旧固件只返回 legacy `version` 时，应输出 `unsupported_old_firmware`，不能把 legacy 字段当成新 app desc 口径。**

## 长期行为 / 规则

- CLI 入口：`ops/bin/stackchan-device-version [--json] [--http|--usb|--all] [--ip <ip>] [--port <port>] [--token <token>] [--usb-device <path>]`。
- 默认参数：`--ip 192.168.0.8`、`--port 18080`、`--token stackchan-dev`、默认模式 `--all`。
- HTTP 读取设备端本地 Dev HTTP：`GET /dev/status`，携带 `X-StackChan-Dev-Token`；该 endpoint 是只读状态，不应新增动作用途。
- 新固件在 `/dev/status` JSON 中暴露 `esp_app_get_description()` / `esp_app_desc_t` 的 `app_version`、`project_name`、`idf_version`。
- 旧固件若只返回 `version`（例如 `2.0.36`）而缺少 `app_version/project_name/idf_version`，工具应标记 `status=unsupported_old_firmware`，并把旧值放在 `legacy_version`；此时 `device_running_version=null` 是预期。
- OTA server 只读本机 `127.0.0.1:8080/ota/`，用于读取当前 manifest 口径的 `ota_server_version`，并解析 active bin 的 `active_bin_app_desc`；它说明“服务端当前广告/提供什么 bin”，不等于“设备已经运行该 bin”。
- 工具输出应明确区分三类版本口径：`device_running_version`（设备当前运行 app desc）、`ota_server_version`（OTA server manifest 广告版本）、`active_bin_app_desc`（active bin 内嵌 app desc）。
- USB 模式只做存在性与已有日志检索：检查 `/dev/ttyACM*` 和 `/tmp/stackchan-serial*.log`，不打开串口、不交互、不发送命令；找不到稳定 boot/app version 日志时应输出 `unsupported_no_version_log`。
- 只有 OTA 到包含本次 `/dev/status` app desc 字段的固件后，HTTP 设备运行版本读取才会进入可靠口径；旧固件即使 HTTP 200，也只能证明 dev status endpoint 可达。

## 关联代码

### 主锚点

- `ops/bin/stackchan-device-version`：只读 Python CLI，汇总 HTTP `/dev/status`、本机 OTA server / active bin app desc、USB 只读日志探测，并输出人类可读或 `--json` 结果。
- `firmware/main/hal/hal_dev_local_control.cpp`：本地 Dev HTTP `/dev/status` 实现位置；通过 `esp_app_get_description()` / `esp_app_desc_t` 增加 `app_version`、`project_name`、`idf_version` 字段。

### 关联锚点

| 路径 / 对象 | 作用 |
| ---- | ---- |
| `/dev/status` | 设备端只读状态 endpoint；新版本必须包含 app desc 字段，旧版本可能只有 legacy `version`。 |
| `esp_app_get_description()` / `esp_app_desc_t` | ESP-IDF 读取当前 app 描述的正确 API；字段来源包括 `version`、`project_name`、`idf_ver`。 |
| `127.0.0.1:8080/ota/` | 本机 OTA manifest endpoint；工具只读获取 `ota_server_version`。 |
| `exp-pkg/active-release/stack-chan.bin` | active release 固件包；工具解析 bin 内 app desc 得到 `active_bin_app_desc`。 |
| `/dev/ttyACM*` | USB 串口存在性探测；不能代表版本或健康状态。 |
| `/tmp/stackchan-serial*.log` | 已有串口日志检索源；工具不主动打开串口。 |

## 真实检查链路

| 步骤 | 入口 | 真实动作 | 长期含义 |
| ---- | ---- | ---- | ---- |
| 1 | HTTP 设备状态 | `GET http://<ip>:<port>/dev/status` + `X-StackChan-Dev-Token` | 读取设备当前运行固件暴露的只读状态。 |
| 2 | HTTP 字段判读 | 检查 `app_version` / `project_name` / `idf_version` | 三字段齐全才把 `app_version` 作为 `device_running_version`。 |
| 3 | 旧固件兼容 | 只有 legacy `version` 时输出 `unsupported_old_firmware` / `legacy_version` | 避免把旧 status 字段误当可靠 app desc。 |
| 4 | OTA server | `GET 127.0.0.1:8080/ota/` | 读取 server 当前 manifest 的 `ota_server_version` 与 `force` 等口径。 |
| 5 | active bin | 解析 active release bin app desc | 确认 OTA server 当前提供的 bin 内嵌 `app_version/project_name/idf_version`。 |
| 6 | USB | glob `/dev/ttyACM*` 与读取已有 `/tmp/stackchan-serial*.log` | 只做可见性和日志线索检查，不打开串口、不控制设备。 |

## 不要改错的位置

- 不要把 `stackchan-device-version` 做成触发 OTA、重启、刷机或 NVS 修补的工具；它只负责读版本事实。
- 不要在 USB 模式主动打开 `/dev/ttyACM0` 或发送串口命令；当前契约是检查设备文件和已有日志。
- 不要把 OTA server 的 `ota_server_version` 或 active bin 的 `active_bin_app_desc.app_version` 直接等同于设备当前运行版本；设备是否已经运行目标版本必须看 `/dev/status` 新字段、启动日志或其它运行态证据。
- 不要把旧 `/dev/status` 的 `version` 字段升级为 `device_running_version`；缺少 `app_version/project_name/idf_version` 时应保留 `unsupported_old_firmware` 语义。
- 不要新增动作端点来补版本读取；版本读取应复用只读 `/dev/status` 与 ESP-IDF app desc API。

## 验证标准

后续修改版本检查工具或 `/dev/status` 时，至少验证：

- `python3 -m py_compile ops/bin/stackchan-device-version ops/bin/stackchan-doctor` 通过。
- `ops/bin/stackchan-device-version --help` 可输出参数说明。
- `ops/bin/stackchan-device-version --json` 输出合法 JSON，并明确包含 `device_running_version`、`ota_server_version`、`active_bin_app_desc`。
- 当前设备仍是旧固件时，HTTP 200 但缺少 app desc 字段应输出 `status=unsupported_old_firmware`、`device_running_version=null`、`legacy_version=<旧 version>`。
- 新固件构建能通过 `hal_dev_local_control.cpp`，且 `/dev/status` 包含 `app_version`、`project_name`、`idf_version`。
- USB 模式不打开串口、不交互；无稳定版本日志时输出 `unsupported_no_version_log`。
- OTA server / active bin 检查只能证明服务端和发布产物口径，不作为设备运行版本验收的唯一证据。

## 关键检索词

- `ops/bin/stackchan-device-version`
- `--json`
- `--http`
- `--usb`
- `--all`
- `--usb-device`
- `/dev/status`
- `X-StackChan-Dev-Token`
- `app_version`
- `project_name`
- `idf_version`
- `esp_app_get_description()`
- `esp_app_desc_t`
- `device_running_version`
- `legacy_version`
- `unsupported_old_firmware`
- `ota_server_version`
- `active_bin_app_desc`
- `127.0.0.1:8080/ota/`
- `force=0`
- `/dev/ttyACM*`
- `/tmp/stackchan-serial*.log`
- `unsupported_no_version_log`
