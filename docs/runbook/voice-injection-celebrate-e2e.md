# Voice Injection → XiaoZhi Celebrate E2E Runbook

更新时间：2026-05-21  
适用范围：StackChan 2.0.45+，本地 Dev HTTP 控制面开启后，通过语音注入让小智实际调用 `self.robot.celebrate`，并进入官方 `DanceModifier::Celebrate` 庆祝动作。本文只记录验收入口、命令与诊断；不包含任何凭据。

## 1. 黄金入口与边界

### 1.1 唯一 E2E 黄金入口

语音注入验收必须从以下入口开始：

```bash
python3 tools/remote_control/remote_control.py --ip <DEVICE_IP> --port <PORT> --token '<DEV_TOKEN>' inject-prompt
```

该 CLI 对应设备端 HTTP endpoint：

```http
POST /dev/inject_prompt
Header: X-StackChan-Dev-Token: <DEV_TOKEN>
```

长期事实：`/dev/inject_prompt` 不是本地扬声器播放，也不需要现场人工对设备说话。它会把固件内嵌的 16 kHz mono s16 WAV prompt 注入 XiaoZhi 上行音频队列，等价于“伪造麦克风输入”，由 XiaoZhi ASR / 语义链路决定是否调用 `self.robot.celebrate`。

### 1.2 明确不要用这些入口做“语音注入完整链路”验收

| 入口 | 为什么不是本 Runbook 的黄金入口 |
|---|---|
| `POST /dev/celebrate` / `remote_control.py celebrate` | 直接进庆祝 executor，绕过 XiaoZhi listening / ASR / MCP 语义调用。只能验证动作，不是语音注入 E2E。 |
| `POST /dev/mcp/call` / `remote_control.py mcp --tool self.robot.celebrate` | 直接调 firmware MCP dispatcher，绕过 XiaoZhi 语义识别。只能验证 MCP dispatch + 动作，不是语音注入 E2E。 |
| `POST /dev/wake` / `remote_control.py wake` | 只让小智进入 listening，不注入 prompt，也不会自动触发庆祝。 |

验收目标链路必须是：

```text
remote_control.py inject-prompt
  -> POST /dev/inject_prompt
  -> XiaoZhi listening / speaking
  -> XiaoZhi 调用 self.robot.celebrate
  -> DanceModifier::Celebrate
  -> speaking -> listening（回到可继续对话状态）
```

## 2. 前置条件

执行前逐项确认：

1. **固件版本**：设备运行版本为 `2.0.45+`；`2.0.45` 已包含 `self.robot.celebrate`、`/dev/inject_prompt` 与官方 `DanceModifier::Celebrate` 链路。
2. **连接参数**：已知设备 `<DEVICE_IP>`、`<PORT>`（默认 `18080`）与 Dev HTTP token（Header 为 `X-StackChan-Dev-Token`）。文档和日志中不要泄露 token。
3. **HTTP Dev Control**：固件编译/运行时已启用本地 Dev HTTP 控制面，设备能访问 `GET /dev/status`。
4. **XiaoZhi ready**：设备已进入 XiaoZhi runtime，状态可为 `idle`、`connecting`、`listening` 或 `speaking`；`/dev/inject_prompt` 端应已通过 XiaoZhi ready 检查。
5. **无注入互斥**：没有正在进行的注入；否则会返回 `inject_already_active`。
6. **安全摆放**：设备放置稳定，头部运动区域无阻挡，电源稳定；庆祝动作会驱动 LED 与头部舵机。
7. **不需要人工说话**：本链路由内嵌 prompt 注入完成，不要求用户现场对设备说触发词或庆祝指令。

## 3. 标准执行命令

以下命令均在仓库根目录执行：

```bash
cd /home/yankeeting/.openclaw/projects/stack-chan/StackChan
```

### 3.1 查询执行前状态

```bash
python3 tools/remote_control/remote_control.py \
  --ip <DEVICE_IP> --port <PORT> --token '<DEV_TOKEN>' \
  status
```

期望：能返回版本、IP、状态、heap、RSSI。状态可接受 `idle`、`connecting`、`listening`、`speaking`；若设备不可达或 401，先按“常见失败处理”处理，不要改用其他动作入口冒充 E2E。

### 3.2 触发语音注入

```bash
python3 tools/remote_control/remote_control.py \
  --ip <DEVICE_IP> --port <PORT> --token '<DEV_TOKEN>' \
  inject-prompt
```

CLI 成功输出通常类似：

```text
✓ Prompt 注入已启动: started
```

该结果只表示 `/dev/inject_prompt` 接收并启动注入任务；最终成功还必须结合状态与日志判定。

### 3.3 触发后状态查询

注入后等待 XiaoZhi 完成 listening / speaking / 动作切换，再查询：

```bash
python3 tools/remote_control/remote_control.py \
  --ip <DEVICE_IP> --port <PORT> --token '<DEV_TOKEN>' \
  status
```

期望：状态能回到 `listening`（或短暂处于 `speaking` / `idle` / `connecting` 的可解释过渡态），不得长期卡死在 `speaking` 或异常红灯/重启。

## 4. 日志与诊断命令

> 下列命令用于验收取证和失败定位。除 `stackchan-serial-capture` 会只读打开串口采集日志外，其余诊断默认只读既有文件/状态；它们都不应触发 `/dev/celebrate`、OTA、reboot、刷机或 NVS 写入。

### 4.1 实时串口日志采集：`stackchan-serial-capture`

建议在触发 `inject-prompt` 前开一个终端采集：

```bash
ops/bin/stackchan-serial-capture \
  --usb-device /dev/ttyACM0 \
  --duration 60 \
  --output /tmp/stackchan-serial-voice-injection.log \
  --grep 'inject|self.robot.celebrate|DanceModifier|dance_modifier_celebrate|speaking|listening|Guru|panic|WDT|red|speed=260'
```

用途：捕获本次验收窗口内的实时日志，避免只看旧日志误判。

### 4.2 USB / 既有日志索引：`stackchan-usb-logs`

```bash
ops/bin/stackchan-usb-logs --tail 500
ops/bin/stackchan-usb-logs --grep 'inject|self.robot.celebrate|DanceModifier|dance_modifier_celebrate|speaking|listening|Guru|panic|WDT|red|speed=260' --json
```

用途：确认 USB 节点与 `/tmp/stackchan-serial*.log` 中是否有关键线索。

### 4.3 庆祝链路诊断：`stackchan-celebrate-diagnose`

```bash
ops/bin/stackchan-celebrate-diagnose \
  --log /tmp/stackchan-serial-voice-injection.log \
  --json

ops/bin/stackchan-celebrate-diagnose --since-min 30 --tail-lines 5000
```

用途：从日志中梳理庆祝动作是否 queued / started / finished，是否存在 `bus_dead`、LED、motion frame、force release 等异常。

### 4.4 版本核对：`stackchan-device-version`

```bash
ops/bin/stackchan-device-version --http --json
ops/bin/stackchan-device-version --all --json
```

用途：核对设备运行版本、OTA server 版本与 active bin app_desc，避免拿旧固件做 2.0.45+ 语音注入验收。

## 5. 成功判定

一次完整 PASS 至少需要同时满足：

1. `inject-prompt` 返回接收成功，例如 `ok=true` / `Prompt 注入已启动`，没有 401、`not_ready`、`inject_already_active`、`task_create_failed`。
2. 注入期间设备状态出现可解释的 `idle` / `connecting` / `listening` / `speaking` 转换；触发后能回到 `listening` 或其他可继续会话的稳定状态。
3. 日志看到 XiaoZhi 实际调用 `self.robot.celebrate`，而不是人工改走 `/dev/celebrate` 或 `/dev/mcp/call`。
4. 日志看到庆祝动作进入官方 `DanceModifier::Celebrate` / `dance_modifier_celebrate` 路径。
5. 动作参数锚点包含 `speed=260`（2.0.45 验收口径）。
6. 现场或日志确认 LED 参与庆祝，且头部动作符合 V 形左右庆祝序列。
7. XiaoZhi 会话状态完成 `speaking -> listening` 回落，不因庆祝动作主动关闭会话或卡住。
8. 验收窗口内无 `panic`、`Guru Meditation`、`WDT`、异常重启、长期红灯或不可恢复的 servo bus 错误。

注意：`/dev/inject_prompt` 的 `ok` 只代表注入任务启动成功，不等于完整链路成功；必须结合 `self.robot.celebrate`、`dance_modifier_celebrate`、状态回落和无崩溃共同判定。

## 6. 常见失败处理

| 现象 / 错误 | 判断 | 处理 |
|---|---|---|
| 401 / 403 | Dev HTTP token 错误或缺失 | 重新确认 `--token` 与设备端 `X-StackChan-Dev-Token`；不要在文档/聊天中贴 token 原文。 |
| 设备不可达 / timeout / connection refused | IP、端口、Wi-Fi、设备阶段或 Dev HTTP 未启动 | 先 ping/同网段确认，再用 `stackchan-device-version --http --json` 或 `status` 只读确认；确认设备已进入 XiaoZhi runtime 和 HTTP 18080。 |
| `not_ready` | XiaoZhi 尚未 ready，Dev HTTP 已启动但注入前置不满足 | 等待 XiaoZhi 完成初始化；重新查 `status`；不要改用 `/dev/wake` 伪造 E2E PASS。 |
| `inject_already_active` | 上一次注入任务未结束，防重入生效 | 等 10-30 秒后重试；若反复出现，采集串口日志看注入任务是否卡住。 |
| `task_create_failed` | 设备内存/任务资源不足 | 查 `status` 的 heap，采集日志；必要时人工重启设备后再验收，但不要在本 Runbook 流程里自动重启。 |
| 没有 `self.robot.celebrate` | 注入成功但 XiaoZhi 未将语义识别为庆祝调用，或 MCP 工具注册/云端语义链路异常 | 保留注入日志，确认设备 2.0.45+、小智在线、prompt 资源正确；不要用 `/dev/mcp/call` 补一次来冒充语音注入通过。 |
| 有 `self.robot.celebrate` 但无 `dance_modifier_celebrate` | MCP dispatcher 到动作层断链，或动作被 already_active / bus preflight 拦截 | 用 `stackchan-celebrate-diagnose` 分析 queued/started/finished、bus_dead、LED、motion frame；不要降低动作幅度掩盖问题。 |
| 卡在 `speaking` | XiaoZhi TTS / 状态机未回落 | 采集 `speaking|listening|StopListening|StartListening` 日志；2.0.45+ 应避免庆祝主动 toggle 会话，若复现应作为状态机问题处理。 |
| 卡在 `listening` 且没有庆祝 | 注入未被 ASR/VAD/语义消费，或 prompt 静音/格式/ready 时序异常 | 查 `inject_prompt_task`、PCM frame、VAD/ASR 相关日志；确认无需人工说话，不要要求现场用户补一句话。 |
| 红灯 / panic / Guru / WDT / 重启 | 稳定性失败 | 停止继续动作验收，保存串口日志，用 `stackchan-usb-logs` 与 `stackchan-celebrate-diagnose` 定位；不要发布 OTA 或刷机作为本 Runbook 的一部分。 |

## 7. 2.0.45 验收摘要（长期可复用事实）

- `2.0.45` 已验证语音注入完整链路 PASS：`remote_control.py inject-prompt` → `/dev/inject_prompt` → XiaoZhi `listening/speaking` → `self.robot.celebrate` → `DanceModifier::Celebrate` → 回到 `listening`。
- 本链路的验收入口是 `tools/remote_control/remote_control.py inject-prompt` / HTTP `POST /dev/inject_prompt`，不是 `/dev/celebrate`、不是 `/dev/mcp/call`、不是 `/dev/wake`。
- 本链路不需要用户现场人工说话；内嵌 prompt 注入即为验收输入。
- `self.robot.celebrate` 在 2.0.45 收敛到官方 `DanceModifier::Celebrate`，验收锚点包含 `dance_modifier_celebrate`、`speed=260`、LED、头部 V 形左右动作，以及 `speaking -> listening` 状态回落。
- `/dev/celebrate` 与 `/dev/mcp/call` 仍可用于动作或 dispatcher 分段诊断，但不能替代语音注入 E2E PASS 结论。

## 8. 最小验收清单

```text
[ ] stackchan-device-version 确认设备 2.0.45+
[ ] status 可读，IP/port/token 正确
[ ] XiaoZhi ready，无 inject_already_active
[ ] 已启动 stackchan-serial-capture 实时采集
[ ] 执行 remote_control.py inject-prompt
[ ] 触发后 status 可回到 listening / 可继续会话状态
[ ] 日志包含 self.robot.celebrate
[ ] 日志包含 DanceModifier::Celebrate / dance_modifier_celebrate
[ ] 日志包含 speed=260，LED 与头部动作可见/可追踪
[ ] 无 panic / Guru / WDT / reboot / 长期红灯
[ ] 未使用 /dev/celebrate、/dev/mcp/call、/dev/wake 冒充语音注入 E2E
[ ] 未要求用户现场人工说话
```
