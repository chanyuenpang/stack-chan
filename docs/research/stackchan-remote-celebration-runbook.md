# StackChan 远程庆祝 Runbook

更新时间：2026-05-18

## 能力总览

当前实现支持：

- 非阻塞电机/灯效庆祝 executor：HTTP/MCP 调用后立即返回，动作在主循环 tick 中推进。
- 任意版本 OTA：mock server 返回 nested `firmware` schema，并用数字 `force: 1/0` 控制强制升级。
- 本地 LAN Dev HTTP：`/dev/status` `/dev/wake` `/dev/stop` `/dev/mcp/call` `/dev/celebrate` `/dev/play_sound` `/dev/inject_prompt`。
- `/dev/inject_prompt`：唤醒小智并注入内置 16k mono PCM WAV。
- `/dev/mcp/call`：本地调用设备内置 MCP dispatcher。

所有示例使用占位符：`<DEVICE_IP>`、`<DEV_TOKEN>`、`<LAN_IP>`，不要写真实 token。

## 关键源码位置

```text
firmware/main/hal/hal_dev_local_control.cpp   # 本地 Dev HTTP endpoint
firmware/main/hal/hal_mcp.cpp                 # MCP tools 与 celebrate executor
firmware/main/hal/hal_celebrate.h             # celebrate 对外接口
firmware/main/hal/hal.cpp                     # 主循环 tick 调用
firmware/main/hal/hal_ota.cpp                 # OTA 检查与升级
firmware/main/assets/dev_serial/              # inject_prompt 内置 WAV 资产
tools/ota-mock-server/ota-mock-server.py      # OTA mock manifest/server
tools/ota-mock-server/start-upgrade.sh        # upgrade 模式启动脚本
```

## 非阻塞电机机制

`self.robot.celebrate` / `/dev/celebrate` 调用 `start_celebrate_modifier()` 只排队任务；实际头部动作和灯效由 `stackchan_celebrate_tick()` 分帧执行。若已有庆祝在运行，会返回冲突/失败，避免重入。

## 任意版本 OTA 使用与边界

mock server upgrade 模式返回示例结构：

```json
{
  "mode": "upgrade",
  "version": "2.0.25",
  "force": 1,
  "url": "http://<LAN_IP>:8081/stack-chan.bin",
  "firmware": {
    "version": "2.0.25",
    "url": "http://<LAN_IP>:8081/stack-chan.bin",
    "force": 1
  }
}
```

要点：版本建议用纯数字版本号；强制升级用数字 `--force 1`，不要用 `--force true`。边界：只在确认固件和网络可用时开启 upgrade；probe/no-upgrade 模式不应广告固件 URL。

## 本地 HTTP endpoint 清单

默认端口：`18080`。鉴权 Header：`X-StackChan-Dev-Token: <DEV_TOKEN>`。

| Endpoint | 方法 | 用途 |
|---|---:|---|
| `/dev/status` | GET | 查看版本、IP、状态、堆、RSSI |
| `/dev/wake` | POST | 让小智进入监听 |
| `/dev/stop` | POST | 停止监听 |
| `/dev/mcp/call` | POST | 调用本地 MCP dispatcher |
| `/dev/celebrate` | POST | 直接触发庆祝 executor |
| `/dev/play_sound` | POST | 播放内置提示音 |
| `/dev/inject_prompt` | POST | 唤醒并注入内置语音提示 |

通用 Header：

```bash
-H 'X-StackChan-Dev-Token: <DEV_TOKEN>' -H 'Content-Type: application/json'
```

## /dev/mcp/call 工具列表与模板

当前本地 dispatcher 支持：

```text
self.robot.get_head_angles
self.robot.set_head_angles
self.robot.set_head_targets
self.robot.set_led_color
self.robot.celebrate
self.robot.create_reminder
self.robot.get_reminders
self.robot.stop_reminder
```

模板：

```bash
curl -s -X POST "http://<DEVICE_IP>:18080/dev/mcp/call" \
  -H 'X-StackChan-Dev-Token: <DEV_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"tool":"self.robot.celebrate","arguments":{"style":"cheer","duration_ms":8200,"intensity":2,"sound":false}}'
```

LED 示例：

```bash
curl -s -X POST "http://<DEVICE_IP>:18080/dev/mcp/call" \
  -H 'X-StackChan-Dev-Token: <DEV_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"tool":"self.robot.set_led_color","arguments":{"red":255,"green":80,"blue":0}}'
```

## 常用 endpoint 用法

```bash
# 状态
curl -s "http://<DEVICE_IP>:18080/dev/status" -H 'X-StackChan-Dev-Token: <DEV_TOKEN>'

# 唤醒/停止
curl -s -X POST "http://<DEVICE_IP>:18080/dev/wake" -H 'X-StackChan-Dev-Token: <DEV_TOKEN>'
curl -s -X POST "http://<DEVICE_IP>:18080/dev/stop" -H 'X-StackChan-Dev-Token: <DEV_TOKEN>'

# 注入内置语音 prompt
curl -s -X POST "http://<DEVICE_IP>:18080/dev/inject_prompt" -H 'X-StackChan-Dev-Token: <DEV_TOKEN>'

# 播放内置声音
curl -s -X POST "http://<DEVICE_IP>:18080/dev/play_sound" \
  -H 'X-StackChan-Dev-Token: <DEV_TOKEN>' -H 'Content-Type: application/json' \
  -d '{"sound":"success"}'

# 直接庆祝
curl -s -X POST "http://<DEVICE_IP>:18080/dev/celebrate" \
  -H 'X-StackChan-Dev-Token: <DEV_TOKEN>' -H 'Content-Type: application/json' \
  -d '{"style":"cheer","duration_ms":8200,"intensity":2,"sound":false}'
```

## 推荐庆祝调用顺序

1. `GET /dev/status` 确认在线且状态正常。
2. 可选：`POST /dev/play_sound` 播放短提示音。
3. `POST /dev/celebrate` 或 `/dev/mcp/call` 调 `self.robot.celebrate`。
4. 需要小智语音参与时，再使用 `POST /dev/inject_prompt`，避免与其他音频/监听动作重叠。

## 安全边界

- 仅限可信 LAN；token 不写入文档、日志或提交记录。
- 不要对真实设备做未知 OTA；upgrade 前确认固件路径、版本、URL。
- 不要并发触发庆祝、注入 prompt、监听控制。
- Dev HTTP 仅应在开发固件构建开关开启时使用。

## 常见失败点

- `401 unauthorized`：token 错或 Header 缺失。
- `409 not_ready`：小智应用尚未 ready。
- `409 celebrate_already_active` / `celebrate_failed`：庆祝 executor 正在运行或排队失败。
- `413 body_too_large`：请求体超过 endpoint 限制。
- OTA 不触发：版本格式、`force` 类型、manifest URL、设备网络或固件文件路径有误。
- `/dev/inject_prompt` 失败：内存不足、WAV 资产未打包、设备不在可监听状态。
