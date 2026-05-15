# StackChan OTA Mock 与真机预检结果

更新时间：2026-05-16

## 1. OTA Mock 本地验证结论

本地 mock OTA response 结构验证通过。

推荐最小 response：

```json
{
  "firmware": {
    "version": "2.0.0",
    "url": "http://localhost:18080/stack-chan.bin",
    "force": 1
  },
  "server_time": {
    "timestamp": 1778860670643,
    "timezone_offset": 480
  }
}
```

说明：

- `firmware.version` / `firmware.url` 可触发版本检查；
- `force=1` 可强制升级；
- 不返回 `mqtt` / `websocket`，避免覆盖现有云端连接配置；
- 不返回 `activation`，避免触发重新激活；
- 不包含 token 或真实凭据。

## 2. stack-chan.bin 静态检查

构建产物：

```text
firmware/build/stack-chan.bin
```

检查结果：

```text
存在
大小：3,777,056 bytes，约 3.6 MB
App slot：0x4f0000，约 5.0 MB
结论：小于 app slot，可放入 OTA app 分区
芯片目标：ESP32-S3
Project name：stack-chan
App version：1.4.1
Flash：16MB, DIO, 80MHz
checksum/hash：valid
```

## 3. 分区与烧录布局

分区表：

```text
nvs       0x9000    0x4000
otadata   0xd000    0x2000
phy_init  0xf000    0x1000
ota_0     0x20000   0x4f0000
ota_1     auto      0x4f0000
assets    0xa00000  4M
coredump  auto      0x10000
```

flash_args：

```text
0x0       bootloader.bin
0x8000    partition-table.bin
0xd000    ota_data_initial.bin
0x20000   stack-chan.bin
0xA00000  generated_assets.bin
```

关键：

```text
OTA app 更新不会覆盖 assets，也不会擦 NVS。
```

## 4. 真机预检结果

当前机器未发现 StackChan 串口设备：

```text
/dev/ttyACM* 不存在
/dev/ttyUSB* 不存在
```

`esptool` 可用：

```text
esptool v5.2.0
路径：/home/yankeeting/.local/bin/esptool
```

`idf.py` 当前未激活/不可用。

由于没有串口设备，无法进行：

```text
chip_id
flash_id
efuse summary
read_flash 备份
写 NVS
真机 OTA 触发
```

## 5. 当前最大阻塞

```text
StackChan 没有通过 USB 出现在当前机器上。
```

可能原因：

- 设备未接到这台机器；
- USB 线只供电不传数据；
- 设备未进入下载/串口模式；
- 驱动/权限问题；
- 当前机器是远程环境，设备接在别处。

## 6. 真机 OTA 前建议顺序

1. 让设备通过 USB 出现在 `/dev/ttyACM*` 或 `/dev/ttyUSB*`。
2. 只读确认：

```bash
esptool --port <PORT> chip_id
esptool --port <PORT> flash_id
```

3. 备份完整 flash：

```bash
esptool --port <PORT> read_flash 0 0x1000000 backup_16MB.bin
```

4. 备份关键分区：

```bash
esptool --port <PORT> read_flash 0x9000 0x4000 nvs.bin
esptool --port <PORT> read_flash 0xd000 0x2000 otadata.bin
esptool --port <PORT> read_flash 0x20000 0x4f0000 ota_0.bin
```

5. 确认 secure boot / flash encryption 状态。
6. 找到合法写入 `wifi.ota_url` 的方式。
7. 搭建 OTA mock server。
8. 触发 OTA。
9. 若失败，使用全 flash backup 恢复。

## 7. 当前判断

OTA 本地 mock 与 app.bin 静态条件已通过。

下一阶段阻塞在真机接入和 `wifi.ota_url` 写入路径，而不是 OTA response 或 app.bin 大小。
