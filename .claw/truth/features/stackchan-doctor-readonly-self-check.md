# StackChan `stackchan-doctor` 只读自检入口

## 结论

`ops/bin/stackchan-doctor` 是 StackChan OTA 工具链的本地只读自检入口。它用于快速核对 OTA user service、HTTP manifest、active release bin、bin 内 `App version`、USB 串口与 Xiaozhi token 存在性；默认不会重启服务、重启设备、写 NVS、触发 OTA 或刷固件。

长期使用规则是：发布 / 排障前先跑 doctor 获取事实基线；如果只需要本地 OTA 工具链自检，用默认模式或 `--json`；只有明确需要读取设备状态时才加 `--check-device`，该参数也只会执行只读 `GET /dev/status`。

## 长期行为 / 规则

- CLI 路径为 `ops/bin/stackchan-doctor`，默认输出人类可读文本；`--json` 输出机器可读 JSON。
- 默认模式不访问设备动作端点，也不读 `/dev/status`；`device_status_readonly` 会标记为 `skipped`。只有显式传入 `--check-device` 才执行只读 `GET /dev/status`。
- `stackchan-ota.service` 的检查口径是 `systemctl --user is-active stackchan-ota.service`，不要改成 system systemd 口径。
- OTA manifest 自检同时请求本机 `GET /ota/` 与 `POST /ota/`，并比较顶层 `version` / `force` / `size` / `sha256` 与嵌套 `firmware.*` 字段一致性。
- `HEAD /stack-chan.bin` 用于确认 OTA server 当前可提供固件包，并读取 `Content-Length`。
- `ops/ota/active.json` 必须与 HTTP manifest 保持一致；`exp-pkg/active-release/stack-chan.bin` 的 size / sha256 必须与 manifest 保持一致。
- `esptool image-info` / `image_info` 用于读取 active bin 的 app desc `App version`，并与 manifest version 比对；不要只相信目录名、包名或 `active.json`。
- `/dev/ttyACM*` 只做存在性检查；它能提示 USB 串口是否可见，但不代表设备已完成 OTA 或小智态健康。
- `XIAOZHI_MCP_TOKEN` 与 `XIAOZHI_MESSAGING_TOKEN` 只检查是否存在，输出布尔值；不得输出 token 原文、片段、hash 或任何可复用凭据。
- 动作类能力统一归入 `destructive_actions`，状态为 `skipped_destructive`，包括 `service_restart`、`device_reboot`、`nvs_write`、`ota_trigger`、`firmware_flash`。
- overall 规则：任一 check 为 `error` 则 overall 为 `error`；无 error 但有 warning 则 overall 为 `warning`；否则为 `ok`。

## 关联代码

### 主锚点

- `ops/bin/stackchan-doctor`：只读 Python CLI，自检入口与所有 check 的实现位置。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `ops/ota/active.json` | 当前 OTA active manifest 元数据，doctor 会与 HTTP manifest 比对。 |
| `exp-pkg/active-release/stack-chan.bin` | 当前 active release 固件包，doctor 会计算 size / sha256 并读取 app desc version。 |
| `/ota/` | 本机 OTA manifest endpoint；doctor 同时检查 `GET` 与 `POST`。 |
| `/stack-chan.bin` | 本机 OTA 固件下载 endpoint；doctor 用 `HEAD` 做只读可用性检查。 |
| `/dev/status` | 设备只读状态 endpoint；默认跳过，只有 `--check-device` 才访问。 |

## 真实自检链路

| 步骤 | 检查名 | 真实动作 | 长期含义 |
| ---- | ------ | -------- | -------- |
| 1 | `user_service_stackchan_ota` | `systemctl --user is-active stackchan-ota.service` | 确认 OTA user service 是否 active。 |
| 2 | `active_json_read` | 读取 `ops/ota/active.json` | 获取当前发布元数据基线。 |
| 3 | `http_get_ota_manifest` / `http_post_ota_manifest` | 本机 `GET /ota/`、`POST /ota/` | 确认 OTA server 实际响应 manifest。 |
| 4 | `http_get_post_manifest_consistency` | 比较 GET / POST manifest | 避免两种请求返回不同版本、force、size 或 sha256。 |
| 5 | `http_head_stack_chan_bin` | `HEAD /stack-chan.bin` | 确认固件 bin endpoint 可达且有 content length。 |
| 6 | `active_json_http_manifest_consistency` | 比较 `active.json` 与 HTTP manifest | 避免 service 广告与 active 元数据错位。 |
| 7 | `active_release_bin_manifest_consistency` | 计算 active bin size / sha256 | 避免 symlink、manifest 与真实 bin 错位。 |
| 8 | `bin_app_desc_version_consistency` | `esptool image-info` 读取 `App version` | 避免 manifest version 与 bin 内版本错位。 |
| 9 | `device_status_readonly` | 默认 skipped；`--check-device` 才 `GET /dev/status` | 默认不碰设备端 endpoint；显式检查也只读。 |
| 10 | `usb_ttyacm_presence` | glob `/dev/ttyACM*` | 提示 USB 串口是否存在。 |
| 11 | `xiaozhi_token_presence` | 检查环境变量存在性 | 区分 token 是否配置，但不泄露凭据。 |
| 12 | `destructive_actions` | 不执行动作 | 明确重启、写 NVS、触发 OTA、刷固件均跳过。 |

## 不要改错的位置

- 不要把 doctor 做成“修复脚本”；它的默认契约是只读诊断，不应自动 restart service、reboot device、写 NVS、触发 OTA 或 flash。
- 不要为了“更完整”在默认模式访问设备动作端点；需要设备状态时也只能通过 `--check-device` 读取 `/dev/status`。
- 不要输出 `XIAOZHI_MCP_TOKEN` / `XIAOZHI_MESSAGING_TOKEN` 的原文、前后缀、hash 或派生值；存在性布尔值足够排查通道是否可用。
- 不要只检查 `active.json` 或 symlink；必须同时核对 HTTP manifest、active bin size/sha256 与 app desc version。
- 不要把 `warning` 误判为失败：例如 token 缺失会让 overall 为 `warning`，但 OTA/manifest/bin/app_desc 检查仍可能全部为 `ok`。
- 不要把 `/dev/ttyACM0` 存在当成 OTA 成功或设备健康；它只是 USB 串口存在性信号。

## 验证标准

后续修改 doctor 或 OTA 发布链路时至少验证：

- `ops/bin/stackchan-doctor` 默认模式可运行，且不会访问 `/dev/status` 或任何动作端点。
- `ops/bin/stackchan-doctor --json` 输出合法 JSON，包含 `tool`、`mode`、`overall`、`checks`。
- `destructive_actions` 始终以 `skipped_destructive` 表达默认跳过的动作类能力。
- token 检查只输出 `{ tokenName: true|false }`，不出现原文、片段或 hash。
- manifest、`active.json`、active bin size/sha256、app desc version 任何一项错位时，应给出明确 mismatch。
- user service 检查继续使用 `systemctl --user`。

## 关键检索词

- `ops/bin/stackchan-doctor`
- `--json`
- `--check-device`
- `user_service_stackchan_ota`
- `systemctl --user is-active stackchan-ota.service`
- `active_json_read`
- `http_get_ota_manifest`
- `http_post_ota_manifest`
- `http_get_post_manifest_consistency`
- `http_head_stack_chan_bin`
- `active_json_http_manifest_consistency`
- `active_release_bin_manifest_consistency`
- `bin_app_desc_version_consistency`
- `esptool image-info`
- `App version`
- `device_status_readonly`
- `/dev/status`
- `usb_ttyacm_presence`
- `/dev/ttyACM*`
- `XIAOZHI_MCP_TOKEN`
- `XIAOZHI_MESSAGING_TOKEN`
- `destructive_actions`
- `skipped_destructive`
