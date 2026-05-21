# StackChan 运维 Runbook 与能力矩阵

更新时间：2026-05-20  
范围：`/home/yankeeting/.openclaw/projects/stack-chan/StackChan` 下当前可用的 OTA、只读诊断、Dev HTTP、remote_control.py、USB 只读日志、庆祝入口与安全边界。本文只记录流程与命令，不包含任何凭据。

## 0. 黄金入口速览

| 入口 | 真实路径/命令 | 默认安全级别 | 用途 |
|---|---|---:|---|
| 只读自检 | `StackChan/ops/bin/stackchan-doctor` | 只读 | 检查 OTA user service、本机 manifest、bin size/sha256/app_desc、USB 存在性 |
| 设备/发布版本核对 | `StackChan/ops/bin/stackchan-device-version` | 只读 | 汇总设备运行版本、OTA server 版本与 active bin app_desc；旧固件会标记 unsupported |
| USB 只读日志 | `StackChan/ops/bin/stackchan-usb-logs` | 只读 | 只 stat USB 设备节点并读取已有日志文件；默认不打开串口、不发送字节 |
| 庆祝失败日志诊断 | `StackChan/ops/bin/stackchan-celebrate-diagnose` | 只读 | 从已有日志诊断 bus_dead、LED、motion frame 等庆祝失败信号；不调用动作端点 |
| OTA 发布 | `StackChan/ops/bin/ota-publish <release-dir> --version <x.y.z> [--force 0|1]` | 写本地发布指针 | 切换 `exp-pkg/active-release` 与 `ops/ota/active.json` |
| OTA 状态 | `StackChan/ops/bin/ota-status` | 只读 | 查看 user service、8080、manifest、bin HEAD、日志 |
| OTA user service | `systemctl --user status|restart stackchan-ota.service` | restart 会影响本机 OTA server | 由 `StackChan/ops/systemd/stackchan-ota.service` 定义，启动 `remote/ota_server.py --metadata ops/ota/active.json` |
| 本地 Dev HTTP CLI | `python3 StackChan/tools/remote_control/remote_control.py --ip <DEVICE_IP> <command>` | 设备动作入口 | LAN 设备控制；不依赖小智或云端凭据 |
| 语音注入庆祝 E2E 验收 | `python3 StackChan/tools/remote_control/remote_control.py --ip <DEVICE_IP> inject-prompt` / HTTP `POST /dev/inject_prompt` | 设备动作入口 | 验证 XiaoZhi listening/speaking → `self.robot.celebrate` → `DanceModifier::Celebrate` 完整链路；详见 `docs/runbook/voice-injection-celebrate-e2e.md` |
| Celebrate 开发补丁 | `StackChan/tools/celebrate-mcp-tool/README.md` | 开发资料 | 记录 `self.robot.celebrate` 补丁文件与接入点 |

> 运行目录建议固定为：`cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan`。

## 0.1 P0 只读工具命令索引

以下 P0 工具只做本机/日志/只读 HTTP 诊断，不刷机、不写 NVS、不调用 `/dev/celebrate` / reboot / wake / stop 等动作端点。

### `stackchan-device-version`：设备/OTA/bin 版本核对

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan

# 默认 --all：检查 HTTP/OTA 与 USB 存在性/既有日志线索
ops/bin/stackchan-device-version

# 机器可读输出
ops/bin/stackchan-device-version --json

# 只检查设备 Dev HTTP /dev/status 与本机 OTA server
ops/bin/stackchan-device-version --http --json

# 只检查 USB 存在性与已有串口日志，不打开串口
ops/bin/stackchan-device-version --usb --json

# 指定要 stat 的 USB 设备节点；仍然不会 open 串口
ops/bin/stackchan-device-version --usb --usb-device /dev/ttyACM0 --json
```

输出字段口径：

- `device_running_version`：来自设备只读 `/dev/status` 的运行中固件版本；旧固件没有该字段时应视为 `unsupported_old_firmware`，不要误判为失败。
- `ota_server_version`：来自本机 OTA server manifest 的待发布版本。
- `active_bin_app_desc`：来自 `exp-pkg/active-release/stack-chan.bin` 的 app_desc `App version`。
- 三者用于定位“设备当前跑的版本 / OTA 正在发布的版本 / active bin 实际内嵌版本”是否一致；该工具不触发 OTA、不重启设备。

### `stackchan-usb-logs`：USB 只读日志索引

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan

# 人类可读输出；默认只 stat /dev/ttyACM* 并读取 /tmp/stackchan-serial*.log
ops/bin/stackchan-usb-logs

# 机器可读输出
ops/bin/stackchan-usb-logs --json

# 搜索关键词/正则
ops/bin/stackchan-usb-logs --grep 'bus_dead|LED|motion|celebrate' --json

# 限制尾部行数
ops/bin/stackchan-usb-logs --tail 300

# 指定 USB 设备节点；只 stat，不 open
ops/bin/stackchan-usb-logs --usb-device /dev/ttyACM0 --json
```

安全口径：默认不打开串口、不发送任何字节、不碰设备动作端点；它只检查 USB 设备节点是否存在，并读取已有日志文件。

### P1 后续候选（未实现 / follow-up）

以下仅记录为 P1 后续候选，不属于本次 P0 完成范围；当前不要按可用工具或已交付能力使用：

- `stackchan-ota-release --json`：未实现 / follow-up。
- `stackchan-ota-rollback` 显式回退工具：未实现 / follow-up。
- 统一 `stackchan-status` 前端：未实现 / follow-up。
- 统一 `stackchan-ota-check` 前端：未实现 / follow-up。

边界保持不变：这些候选若后续实现，也应延续本地运维入口口径，不依赖小智 token / 云端 token。

### `stackchan-celebrate-diagnose`：庆祝失败只读日志诊断

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan

# 分析默认串口日志 glob
ops/bin/stackchan-celebrate-diagnose

# 机器可读输出
ops/bin/stackchan-celebrate-diagnose --json

# 指定单个既有日志文件
ops/bin/stackchan-celebrate-diagnose --log /tmp/stackchan-serial.log --json

# 只看最近 N 分钟；时间戳可解析时生效
ops/bin/stackchan-celebrate-diagnose --since-min 30 --json

# 限制每个日志扫描尾部行数
ops/bin/stackchan-celebrate-diagnose --tail-lines 5000 --json
```

诊断用途：从已有日志中定位 `bus_dead`、LED、motion frame、庆祝流程异常等信号。安全口径：只读日志，不打开串口，不调用 `/dev/celebrate`，也不调用 reboot / wake / stop。

## 0.2 语音注入庆祝 E2E Runbook

语音注入完整链路验收使用 `tools/remote_control/remote_control.py inject-prompt` / HTTP `POST /dev/inject_prompt` 作为黄金入口；不要用 `/dev/celebrate`、`/dev/mcp/call` 或 `/dev/wake` 替代。标准命令、日志锚点、成功判定与失败处理见：[`docs/runbook/voice-injection-celebrate-e2e.md`](voice-injection-celebrate-e2e.md)。

## 1. `stackchan-doctor`：默认只读自检入口

真实路径：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
ops/bin/stackchan-doctor
```

常用模式：

```bash
# 人类可读输出；默认只读，不访问设备动作端点
ops/bin/stackchan-doctor

# 机器可读 JSON 输出
ops/bin/stackchan-doctor --json

# 额外只读 GET /dev/status；默认跳过，只有明确指定才访问设备状态
ops/bin/stackchan-doctor --check-device

# 预期扩展日志入口：默认不启用；仅显式指定时纳入对应 P0 子工具结果
# 集成完成后应分别调用：ops/bin/stackchan-usb-logs --json
# 集成完成后应分别调用：ops/bin/stackchan-celebrate-diagnose --json
ops/bin/stackchan-doctor --include-usb-logs --json
ops/bin/stackchan-doctor --include-celebrate-logs --json
```

`stackchan-doctor` 当前检查项来自 `StackChan/ops/bin/stackchan-doctor`：

- `systemctl --user is-active stackchan-ota.service`。
- 本机 `GET http://127.0.0.1:8080/ota/` 与 `POST http://127.0.0.1:8080/ota/`，解析 `version/force/size/sha256/firmware.version/firmware.force/firmware.size/firmware.sha256`。
- `HEAD http://127.0.0.1:8080/stack-chan.bin`。
- `StackChan/ops/ota/active.json` 与 HTTP manifest 一致性。
- `StackChan/exp-pkg/active-release/stack-chan.bin` 的 size/sha256 与 manifest 一致性。
- 尝试用 `esptool image-info` / `esptool image_info` 读取 app_desc `App version`，并比对 manifest version。
- `/dev/status` 默认 `skipped`；仅 `--check-device` 才只读访问。
- `/dev/ttyACM*` 存在性。
- P0 扩展日志入口预期参数：`--include-usb-logs`、`--include-celebrate-logs`。当前 doctor 默认只读且默认不包含扩展日志；集成完成后，只有显式指定才应在 JSON 中增加 `usb_logs` / `celebrate_diagnosis` 节点，并在人类输出中简要显示 summary/overall。
- 小智/云端 token 路线静态标记为 `cloud_token_route=not_used/skipped`；不检查 `XIAOZHI_MCP_TOKEN` / `XIAOZHI_MESSAGING_TOKEN` env，也不因 token 缺失告警。
- 动作类检查统一标记 `skipped_destructive`：不重启服务、不重启设备、不写 NVS、不触发 OTA、不刷固件；动作端点仍必须由操作者显式调用并带 `--confirm`/等价确认。

## 2. OTA 正式发布链路与 user systemd 口径

### 2.1 发布一个候选 release

发布脚本：`StackChan/ops/bin/ota-publish`。它会：

- 校验 release 目录存在 `stack-chan.bin`。
- 原子切换 `StackChan/exp-pkg/active-release` symlink。
- 写入 `StackChan/ops/ota/active.json`。
- `--force` 默认是 `0`，只接受 `0` 或 `1`。

命令模板：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
ops/bin/ota-publish exp-pkg/<release-dir> --version <x.y.z>
# 如确实需要强制升级，才显式加：--force 1
```

发布后脚本会提示：

```bash
systemctl --user restart stackchan-ota
```

这是本机 OTA server 的 user service 重启，不是设备重启。重启前应先确认 `active.json`、manifest 版本和 bin app_desc 一致。

### 2.2 OTA server 口径

systemd 文件：`StackChan/ops/systemd/stackchan-ota.service`。

关键配置：

```ini
WorkingDirectory=/home/yankeeting/.openclaw/projects/stack-chan/StackChan
ExecStart=/usr/bin/python3 -u remote/ota_server.py --metadata ops/ota/active.json
StandardOutput=append:%h/.local/state/stackchan-ota/ota-server.log
StandardError=append:%h/.local/state/stackchan-ota/ota-server.log
```

状态检查：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
ops/bin/ota-status
systemctl --user status stackchan-ota --no-pager
```

OTA server 实现：`StackChan/remote/ota_server.py`。它会根据 `ops/ota/active.json` 生成 `/ota/` manifest，并提供 `/stack-chan.bin` 下载。

## 3. Manifest / firmware.version / bin app_desc 一致性规则

正式发布前必须满足：

1. `GET/POST /ota/` 顶层 `version` 一致。
2. `GET/POST /ota/` 嵌套 `firmware.version` 一致。
3. 顶层 `version`、嵌套 `firmware.version`、`stack-chan.bin` app_desc `App version` 三者一致。
4. 顶层 `force` 与 `firmware.force` 一致，并且默认必须是数字 `0`。
5. 顶层和嵌套的 `size` / `sha256` 必须与 `exp-pkg/active-release/stack-chan.bin` 实际文件一致。

推荐验证：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
ops/bin/stackchan-doctor
ops/bin/stackchan-doctor --json
```

当前 metadata 文件示例位置：`StackChan/ops/ota/active.json`。注意该文件保存的是发布元数据，真正对设备返回的完整 manifest 由 `StackChan/remote/ota_server.py` 动态生成。

## 4. 本地 Dev HTTP 与 `remote_control.py`

CLI 路径：`StackChan/tools/remote_control/remote_control.py`。

默认端口：`18080`。CLI 会按固件 Dev HTTP 约定发送认证 Header；不要把任何凭据写入文档、命令记录或日志。该路线不依赖小智或云端凭据。

常用命令模板：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> status
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> wake
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> stop
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> celebrate --style cheer
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> mcp --tool get_head_angles
```

重启新入口：

```bash
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> reboot --confirm
```

要点：

- `reboot` 必须显式 `--confirm`；CLI 内部调用完整 MCP 工具名 `self.system.reboot`，参数包含 `confirm: true`、`delay_ms`、`reason`。
- Dev HTTP、`remote_control.py` 与 OTA user service 是本地运维入口，不依赖小智或云端凭据。
- Dev HTTP 是设备动作入口；除非任务明确要求，不要在文档整理/自检中调用动作端点。

对应固件入口：

- `StackChan/firmware/main/hal/hal_dev_local_control.cpp`
- `StackChan/firmware/main/hal/hal_dev_local_control.h`

## 5. 小智/云端凭据边界

不要依赖小智 token/云端 token，StackChan 运维以本地 Dev HTTP、`remote_control.py`、OTA user service、USB 只读日志为准。

## 6. USB 串口日志与 dev serial 控制禁用事实

只允许把 USB 串口作为只读日志观察入口，例如查看 `/dev/ttyACM*` 是否存在，或用串口监视日志。`stackchan-doctor` 只检查 `/dev/ttyACM*` 存在性。

当前 dev serial 控制相关源码：

- `StackChan/firmware/main/hal/hal_dev_serial.cpp`
- `StackChan/firmware/main/hal/hal_dev_serial.h`
- `StackChan/firmware/main/CMakeLists.txt`

当前事实：`hal_dev_serial.cpp` 中 `start_dev_serial_wake_stop_task()` 在编译开关开启时仍记录“intentionally disabled for experiment”，不会安装 USB Serial/JTAG RX driver，也不会创建 dev serial wake/stop task。也就是说，当前 dev serial 控制入口禁用；不要依赖 USB 串口发送 `wake/stop/reboot` 等控制命令。

硬边界：禁止通过 USB 直接刷固件作为日常发布路径；固件分发走 OTA 链路，USB 只读日志/救援/备份需要另行人工确认。

## 7. NVS / OTA URL 写入边界

参考文档：`StackChan/docs/research/stackchan-ota-url-write-paths.md`。

设备 OTA URL 读取路径：

```text
firmware/xiaozhi-esp32/main/ota.cc
Ota::GetCheckVersionUrl()
→ Settings("wifi", false)
→ 读取 NVS namespace wifi, key ota_url
→ 若为空，使用 CONFIG_OTA_URL
```

推荐写入边界：

- 优先通过设备 Wi-Fi 配网 AP 的高级配置页面写 `Custom OTA URL`。
- 可选通过配网 AP 的 `POST /advanced/submit` 写 JSON 字段 `ota_url`，但必须确认不会覆盖其它高级配置。
- URL 示例只写占位：`http://<LAN_IP>:8080/ota/`。

禁止/谨慎项：

- 禁止擦 NVS。
- 禁止 Factory Reset。
- 禁止改 bootloader / partition table / assets。
- NVS patch 仅作为备选：必须先备份完整 NVS，再 patch 原分区；不能生成只有 `ota_url` 的新 NVS 镜像直接覆盖。
- `CONFIG_OTA_URL` 重编 app 仅作为中低优先级备选；若 NVS 已有 `wifi/ota_url`，默认值不会生效。

## 8. Celebrate MCP / Dev HTTP 入口

Celebrate 开发资料：

- `StackChan/tools/celebrate-mcp-tool/README.md`
- `StackChan/tools/celebrate-mcp-tool/celebrate.h`
- `StackChan/tools/celebrate-mcp-tool/celebrate.cpp`
- `StackChan/tools/celebrate-mcp-tool/hal_mcp.cpp.patch`
- 目标固件入口：`StackChan/firmware/main/hal/hal_mcp.cpp`

Dev HTTP 已有直接庆祝入口：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> celebrate --style cheer --duration-ms 3200 --intensity 1
```

MCP dispatcher 入口：

```bash
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> mcp \
  --tool self.robot.celebrate \
  --args '{"style":"cheer","duration_ms":3200,"intensity":1,"sound":false}'
```

Dev HTTP endpoint 对照见 `StackChan/docs/research/stackchan-remote-celebration-runbook.md`，包括：

- `GET /dev/status`
- `POST /dev/wake`
- `POST /dev/stop`
- `POST /dev/mcp/call`
- `POST /dev/celebrate`
- `POST /dev/play_sound`
- `POST /dev/inject_prompt`

## 9. 禁止事项（红线）

- 禁止在本项目新增或更新 `Truth` / `ADR` 类文档作为事实源；本 runbook 作为当前运维口径。
- 遵守第 5 节的小智/云端凭据边界。
- 禁止把任何凭据写进文档、提交记录、日志、截图或 shell history。
- 禁止 USB 直接刷固件作为常规发布路径；不要执行 `idf.py flash`、`esptool.py write_flash`、`erase_flash` 等写 flash 动作，除非用户明确授权救援/恢复。
- 禁止在文档整理、自检或状态巡检中重启设备、触发 OTA、写 NVS、调用设备动作端点；动作端点仍必须由操作者显式调用，并在需要时提供 `--confirm`/等价确认。
- 禁止把 `force` 默认设为 `1`；正式发布默认必须为 `0`，强制升级只能在人工确认后显式设置。

## 10. 发布前最小检查清单

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
ops/bin/stackchan-doctor
ops/bin/stackchan-doctor --json
ops/bin/ota-status
```

人工核对：

- `ops/ota/active.json` 指向正确 release。
- `exp-pkg/active-release/stack-chan.bin` 是目标固件。
- manifest 顶层与 `firmware.*` 的 version/force/size/sha256 一致。
- bin app_desc `App version` 与 manifest version 一致。
- `force=0`，除非有明确强制升级理由。
- user service 只重启本机 OTA server，不代表设备升级；真实 OTA 仍需设备侧检查更新或既定触发流程。
