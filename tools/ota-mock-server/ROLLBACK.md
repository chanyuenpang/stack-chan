# StackChan OTA 回滚指南

> 如果你通过 OTA 自建服务器升级了固件，设备出现**反复重启、无法启动、表情异常**等问题，按以下步骤恢复。

---

## 1. 快速判断

| 现象 | 原因 | 处理 |
|------|------|------|
| 反复重启（boot loop） | 应用分区不兼容 / 分区表不对 | 刷回官方固件 |
| 能启动但连不上 App | NVS Wi-Fi 配置丢失或 token 失效 | 重新配网 或 恢复 NVS |
| 表情/speak 异常 | 字体 / 音频数据不匹配 | 只刷 app 分区保留其他分区 |
| 完全变砖（无串口输出） | bootloader 或分区表损坏 | 擦除全片 + 烧录官方全量包 |

---

## 2. 刷回官方固件（推荐）

### 前提
- 设备通过 USB 连接到电脑（`/dev/ttyACM0` 或 `/dev/ttyUSB0`）
- 已安装 esptool（`pip install esptool` 或 M5Burner 自带）

### 步骤

```bash
# 1. 确认设备端口
ls /dev/ttyACM* /dev/ttyUSB*

# 2. 擦除之前 OTA 的应用分区（保留 NVS/bootloader/分区表）
#    不擦除全片，只擦 ota_0 和 ota_1
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_region 0x10000 0x1F0000   # ota_0
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_region 0x200000 0x1F0000  # ota_1

# 3. 烧录官方固件到 ota_0
esptool.py --chip esp32s3 --port /dev/ttyACM0 --baud 921600 \
  write_flash 0x10000 /path/to/StackChan_S3.bin

# 4. 如果设备仍无法启动，擦除 NVS 重配（会丢 Wi-Fi/Token）
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_region 0x9000 0x5000
```

### 全部擦除 + 全量烧录（终极方案）

```bash
# 擦除全片
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_flash

# 全量烧录（含 bootloader + 分区表 + 应用）
# 分区表地址 0x8000，bootloader 地址 0x0
esptool.py --chip esp32s3 --port /dev/ttyACM0 --baud 921600 \
  write_flash 0x0 /path/to/bootloader.bin \
  write_flash 0x8000 /path/to/partition-table.bin \
  write_flash 0x10000 /path/to/StackChan_S3.bin
```

当有官方 `.flash_args` 文件时，可直接使用：
```bash
esptool.py --chip esp32s3 --port /dev/ttyACM0 --baud 921600 \
  write_flash @flash_args
```

---

## 3. 使用 M5Burner 恢复（如果已缓存）

```bash
# M5Burner 缓存路径（Ubuntu 22.04）
ls ~/snap/m5burner-v3/common/.config/M5Burner/firmware/StackChan_S3/

# 找到 .bin 文件后，直接用 esptool 烧录
esptool.py --chip esp32s3 --port /dev/ttyACM0 --baud 921600 \
  write_flash 0x10000 ~/snap/m5burner-v3/common/.config/M5Burner/firmware/StackChan_S3/StackChan_S3*.bin

# 如果是完整包（merged bin），写 0x0
esptool.py --chip esp32s3 --port /dev/ttyACM0 --baud 921600 \
  write_flash 0x0 ~/snap/m5burner-v3/common/.config/M5Burner/firmware/StackChan_S3/StackChan_S3*.bin
```

---

## 4. 擦除用户数据（保留固件）

只擦 NVS（Wi-Fi 配置、Token、设备配置），不重刷固件：

```bash
# NVS 分区通常在 0x9000，大小 0x5000
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_region 0x9000 0x5000
```

重启后设备会进入配网模式（小智 AP），重新配网即可。

---

## 5. OTA 自编译固件兼容性检查清单

在决定 OTA 升级前检查以下事项：

- [ ] 分区表是否与官方一致？（`partitions.csv` 对比）
- [ ] NVS 分区是否被意外擦除？（CMakeLists.txt 中 nvs_flash 初始化不应格式化）
- [ ] 字体/音频资源大小是否在分区内？
- [ ] OTA 分区（ota_0 / ota_1）大小是否匹配？（通常各 2MB）
- [ ] 固件版本号是否大于当前版本？（否则不会触发升级）

---

## 6. 端口权限问题

如果 `esptool.py` 报告权限错误：

```bash
# 临时
sudo chmod 666 /dev/ttyACM0

# 永久（将用户加入 dialout 组）
sudo usermod -a -G dialout $USER
# 注销重新登录生效
```
