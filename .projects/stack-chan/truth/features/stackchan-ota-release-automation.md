# StackChan `stackchan-ota-release` 一键 OTA 发布脚本

## 结论

`ops/bin/stackchan-ota-release` 是 StackChan 本地 OTA 工具链的发布入口：它把一个已构建固件 bin 打包成 candidate release，原子切换 `exp-pkg/active-release`，写入 `ops/ota/active.json`，重启 user `stackchan-ota` 服务，并用 HTTP endpoint 与 `stackchan-doctor --json` 做一致性验收。

长期规则是：**发布前先确认 bin 内 `app_desc` 版本与 `--version` 一致，发布时默认 `force=0`，失败时自动回退旧 active release 与旧 manifest；设备重启不是默认动作，必须显式 `--reboot-device --confirm`。**

这不是刷机脚本，也不是 NVS 修补工具。默认路径只操作本地发布目录、OTA manifest 与本机 user service；唯一会触及设备 IP 的路径是发布成功后的可选 `--reboot-device --confirm`，内部走 `remote_control.py reboot` / `self.system.reboot` 的确认语义。

## 长期行为 / 规则

- CLI 入口：`ops/bin/stackchan-ota-release <bin|release-dir> --version x.y.z [--desc 描述] [--force 0|1] [--dry-run] [--reboot-device --confirm]`。
- 输入可以是固件 bin，也可以是包含 `stack-chan.bin` 的 release 目录；相对路径按 StackChan 项目根目录解析。
- `--version` 必须是纯数字点分 `x.y.z`，例如 `2.0.35`；`v1.0` 一类带前缀格式应拒绝。
- 发布前必须从 bin 内提取 app desc version：优先 `esptool image-info` / `esptool.py image_info`，缺失时 fallback 到 `strings + grep`；提取结果必须与 `--version` 完全一致，否则拒绝发布。
- `--force` 只能是数字 `0` 或 `1`，默认 `0`；正常升级发布不应默认强制 OTA，同版本/回退/救援才显式 `--force 1`。
- `--desc` 未指定时会从固件 app desc 或默认 `release` 生成 candidate 目录名；candidate 目录形如 `exp-pkg/candidate-<desc>-<version>/`。
- 发布会计算 bin 的 `stat` size 与 `sha256sum`，并写入 active manifest；后续 HTTP `/ota/`、`active.json` 与 active bin 必须三者一致。
- active release 切换必须是原子软链接替换：先创建临时 symlink，再 `mv` 到 `exp-pkg/active-release`，避免服务端看到半更新状态。
- 写入 `active.json` 前要备份旧文件；切换 symlink 前要备份旧 active target。任一步失败必须恢复旧 symlink 与旧 `active.json`，并重启 OTA 服务让回退生效。
- 服务重启口径是 `systemctl --user restart stackchan-ota`，不是 system systemd；重启后要等待就绪再验收。
- 发布验收至少包含：`GET /ota/`、`POST /ota/`、`HEAD /stack-chan.bin`，以及 `ops/bin/stackchan-doctor --json` 一致性检查。
- `--dry-run` 只能模拟流程：不写文件、不替换 symlink、不重启服务、不重启设备。
- `--reboot-device` 必须同时带 `--confirm`；缺少确认时拒绝执行。该路径是唯一允许触及设备 IP 的发布后动作。
- 脚本不得输出 token 原文；token 相关仍应只做存在性 / doctor 级别检查。

## 关联代码

### 主锚点

- `ops/bin/stackchan-ota-release`：一键发布脚本主入口，包含参数校验、版本提取、candidate 打包、active symlink 原子切换、`active.json` 写入、服务重启、HTTP 验证、doctor 验收和失败回退。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `ops/bin/stackchan-doctor` | 发布后只读一致性验收；`--json` 用于机器判断 OTA service、HTTP manifest、active bin、app desc version 等是否一致。 |
| `ops/ota/active.json` | OTA server 当前 active manifest 元数据；`stackchan-ota-release` 发布时更新，失败时恢复旧文件。 |
| `exp-pkg/active-release` | 当前 active release 软链接；发布脚本通过临时 symlink + `mv` 原子替换。 |
| `exp-pkg/candidate-<desc>-<version>/stack-chan.bin` | 发布脚本创建的候选固件目录与 bin。 |
| `tools/remote_control/remote_control.py` | 可选设备重启路径；仅 `--reboot-device --confirm` 时调用确认重启，不属于默认发布流程。 |
| `/ota/` | 本机 OTA manifest endpoint；发布后必须验证 `GET` 与 `POST`。 |
| `/stack-chan.bin` | 本机固件下载 endpoint；发布后必须用 `HEAD` 验证可达与 content length。 |
| `stackchan-ota.service` | OTA user service；发布后通过 `systemctl --user restart stackchan-ota` 让 active release 生效。 |

## 真实发布链路

1. 解析参数，校验输入路径、`--version`、`--force`、`--reboot-device --confirm` 组合。
2. 定位固件 bin：若输入是目录，则使用 `<dir>/stack-chan.bin`。
3. 从 bin 提取 app desc version：优先 `esptool image-info` / `image_info`，失败时 fallback 到 `strings + grep`。
4. 对比 app desc version 与 `--version`；不一致直接退出，不进入写入阶段。
5. 计算 bin size 与 sha256。
6. 创建 `exp-pkg/candidate-<desc>-<version>/` 并复制 `stack-chan.bin`。
7. 备份旧 `exp-pkg/active-release` 指向与旧 `ops/ota/active.json`。
8. 用临时 symlink + `mv` 原子替换 `exp-pkg/active-release`。
9. 写入新的 `ops/ota/active.json`，包含 `version`、`force`、`size`、`sha256`、`firmware` 等 OTA manifest 所需字段。
10. `systemctl --user restart stackchan-ota`，等待服务就绪。
11. 验证本机 HTTP：`GET /ota/`、`POST /ota/`、`HEAD /stack-chan.bin`。
12. 运行 `ops/bin/stackchan-doctor --json`，确认 active JSON、HTTP manifest、active bin、bin app desc version 一致。
13. 若任一步失败，恢复旧 active symlink 与旧 `active.json`，重启 user service，再返回失败。
14. 若显式传入 `--reboot-device --confirm`，发布成功后才调用 `remote_control.py reboot` 触发受确认保护的设备重启。

## 不要改错的位置

- 不要把 `stackchan-ota-release` 变成刷机 / NVS 修改脚本；它的默认边界是本地 OTA 发布与服务验证。
- 不要跳过 bin 内 app desc version 校验；目录名、manifest 参数或脚本默认值都不能替代 bin 内真实版本。
- 不要把 `force=1` 做成默认发布口径；默认 `force=0` 是正常升级发布的安全边界。
- 不要只改 `active.json` 而不切换 `active-release`，也不要只换 symlink 不验证 HTTP manifest；两者必须和实际 bin 的 size / sha256 / app desc version 一致。
- 不要用 system systemd 口径重启 OTA 服务；当前服务检查与重启应使用 user systemd。
- 不要在失败后留下半更新状态；失败回退必须同时恢复旧 symlink、旧 `active.json` 并重启服务。
- 不要让 `--dry-run` 写任何文件或重启任何服务。
- 不要在没有 `--confirm` 时触发设备重启；也不要新增绕过 confirm 语义的独立 reboot 路径。

## 验证标准

后续修改 `stackchan-ota-release` 或 OTA 发布链路时，至少验证：

- `bash -n ops/bin/stackchan-ota-release` 通过。
- `ops/bin/stackchan-ota-release --help` 能输出参数与安全规则。
- `--dry-run` 覆盖完整流程，但不写文件、不替换 symlink、不重启服务。
- app desc version 与 `--version` 不一致时拒绝，退出码为失败类 `1`。
- `--force` 非 `0|1`、`--version` 非 `x.y.z`、`--reboot-device` 缺 `--confirm` 时拒绝，退出码为参数类 `2`。
- 输入文件不存在时拒绝，且不进入写入阶段。
- 发布后 `active.json`、HTTP `GET/POST /ota/`、`HEAD /stack-chan.bin`、active bin size / sha256、bin app desc version 全部一致。
- 模拟 HTTP 验收或 doctor 失败时，旧 active symlink 与旧 `active.json` 能自动恢复。
- `python3 -m py_compile ops/bin/stackchan-doctor` 与 `python3 -m py_compile tools/remote_control/remote_control.py` 通过。
- 默认发布过程不访问设备 IP；只有 `--reboot-device --confirm` 才触发设备重启路径。

## 关键检索词

- `ops/bin/stackchan-ota-release`
- `stackchan-ota-release <bin> --version x.y.z`
- `--force 0|1`
- `--dry-run`
- `--reboot-device --confirm`
- `esptool.py image_info`
- `esptool image-info`
- `App version`
- `strings+grep`
- `sha256sum`
- `stat`
- `exp-pkg/candidate-<desc>-<version>`
- `exp-pkg/active-release`
- `ops/ota/active.json`
- `systemctl --user restart stackchan-ota`
- `GET /ota/`
- `POST /ota/`
- `HEAD /stack-chan.bin`
- `ops/bin/stackchan-doctor --json`
- `remote_control.py reboot --confirm`
- `force=0`
- `force=1`
- `confirm_required`
