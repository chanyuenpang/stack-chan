# StackChan OTA Mock Server

本地 OTA 模拟服务器，用来验证设备是否访问 `/ota/`，以及在明确确认后模拟一次固件下载。

> 只用于局域网调试；不连接外网，不包含 token，不访问真实小智服务。默认 **probe** 模式安全，不广告固件 URL。

## 现场结论

本轮真实 OTA 已确认成功，设备当前版本已显示 `2.0.0`。因此本文档不再按“失败路线”推进；以下 mock server 修正主要用于后续复用时避免 schema/类型误导：nested `firmware` 字段、`force` 数字 `1/0`、以及纯数字版本号 `2.0.0`。

## 模式

设备源码读取的是 nested schema：`firmware.version` / `firmware.url` / `firmware.force`。本 mock server 会同时保留顶层兼容字段，但以 nested `firmware` 字段为准。

| 模式 | 启动参数 | nested `firmware.version` | nested `firmware.url` | nested `firmware.force` | 用途 |
|---|---|---:|---|---:|---|
| probe | `--mode probe`（默认） | `0.0.0` | `""` | `0` | 安全探测 `/ota/` 链路，不触发下载 |
| no-upgrade | `--mode no-upgrade` | `1.4.1` | `""` | `0` | 可选排查：走无新版本分支；可用于确认当前版本有效 |
| confirm | `--mode confirm` | `1.4.1` | `""` | `0` | `no-upgrade` 别名 |
| upgrade | `--mode upgrade` | `2.0.0` | `http://<LAN_IP>:8080/stack-chan.bin` | `1` | 显式 OTA 下载测试 |

关键点：

- `force` 是 JSON 数字 `1/0`，不是 boolean `true/false`。
- upgrade 默认版本是纯数字字符串 `2.0.0`，不是 `2.0.0-test`。
- probe / no-upgrade / confirm 不广告可下载 URL。
- `/stack-chan.bin` 端点只在 upgrade 模式返回固件；其它模式返回 404。

---

## 找本机局域网 IP

```bash
hostname -I
# 或
ip -4 addr show | grep inet | grep -v 127.0.0.1
```

记下类似 `192.168.x.x` 的地址，下文记作 `LAN_IP`。

---

## 安全探测：probe

```bash
cd tools/ota-mock-server
python3 ota-mock-server.py --mode probe --port 8080
```

预期 manifest：

```json
{
  "mode": "probe",
  "firmware": {
    "version": "0.0.0",
    "url": "",
    "force": 0
  }
}
```

只应观察到设备访问 `/ota/`，不应因为 manifest 自动访问 `/stack-chan.bin`。

---

## 可选排查：no-upgrade / confirm

真实 OTA 已成功时无需执行本步骤。如果后续需要专门观察设备的“无新版本”分支，可短暂启动：

```bash
python3 ota-mock-server.py --mode no-upgrade --port 8080
# 或：python3 ota-mock-server.py --mode confirm --port 8080
```

该模式返回当前版本 `1.4.1`、空 URL、`force: 0`。这只是可选排查手段，不是 upgrade 前的必做步骤。

---

## 显式 OTA 下载测试：upgrade

确认要做 OTA 下载测试时，停止其它模式 server，再启动 upgrade：

```bash
cd tools/ota-mock-server
python3 ota-mock-server.py \
  --mode upgrade \
  --port 8080 \
  --firmware ../../firmware/build/stack-chan.bin
```

upgrade manifest 会广告：

```json
{
  "mode": "upgrade",
  "firmware": {
    "version": "2.0.0",
    "url": "http://LAN_IP:8080/stack-chan.bin",
    "force": 1
  }
}
```

然后在设备端点击 **Check for Updates**。server 日志中应先看到 `/ota/`，随后看到 `/stack-chan.bin` 的 `HEAD` 或 `GET`：

```text
[03:20:10] ip=192.168.x.y method=POST path=/ota/ status=200 ua='ESP32HTTPClient' content_length=123
[03:20:11] ip=192.168.x.y method=HEAD path=/stack-chan.bin status=200 ua='ESP32HTTPClient' content_length=-
[03:20:12] ip=192.168.x.y method=GET path=/stack-chan.bin status=200 ua='ESP32HTTPClient' content_length=-
```

---

## 写入设备 Custom OTA URL

设备配网页 **Custom OTA URL** 填：

```text
http://LAN_IP:8080/ota/
```

或在已连接设备 AP 时：

```bash
curl -X POST http://192.168.4.1/advanced/submit \
  -H "Content-Type: application/json" \
  -d '{"ota_url":"http://LAN_IP:8080/ota/"}'
```

---

## 本地静态验证

```bash
python3 -m py_compile tools/ota-mock-server/ota-mock-server.py
python3 tools/ota-mock-server/ota-mock-server.py --help
```

> 本地 dry-run 可以短启 server + curl manifest，但不要让真实设备触发 OTA，测试完立即 `Ctrl+C` 关闭。

---

## 风险与回滚

- 🚫 不要在生产环境使用。
- ⚠️ `upgrade` 会让设备认为有新版本，可能触发真实 OTA 下载/刷写流程。
- 🔒 server 监听 `0.0.0.0`，局域网内其它机器也能访问；测试完请关闭。
- 🧯 清空自定义 OTA URL：

```bash
curl -X POST http://192.168.4.1/advanced/submit \
  -H "Content-Type: application/json" \
  -d '{"ota_url":""}'
```
