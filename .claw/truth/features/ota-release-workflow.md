# StackChan OTA 发布与实机升级链路

## 结论

StackChan 固件 OTA 发布的长期可复用链路是:先在 `firmware/CMakeLists.txt` bump `PROJECT_VER`,用独立 release build 目录构建并用 `esptool.py image_info` 校验 `app_desc`,再通过 `ops/bin/stackchan-ota-release` 发布 candidate,最后用 `tools/remote_control/remote_control.py ... reboot --confirm` 触发设备拉取 OTA。实机升级期间短暂离线和二次重启是可接受现象,最终应回到 `state=idle/listening` 且 `app_version` 等于目标版本。

## 长期行为 / 规则

- `PROJECT_VER` 是 OTA 版本识别的主入口；发布前必须与目标 OTA 版本一致。
- release 构建产物需要用 `esptool.py --chip esp32s3 image_info --version 2 <bin>` 校验 `Project name` 和 `App version`，不要只相信构建目录名。
- `ops/bin/stackchan-ota-release <bin> --version <version>` 会执行 app_desc 版本校验，并更新 active/candidate release；发布后应验证 OTA HTTP 端点与 `HEAD /stack-chan.bin`。
- 设备重启触发 OTA 后，观测到 `activating(<old>) -> upgrading(<old>) -> 短暂离线/二次重启 -> idle/listening(<new>)` 属于正常升级轨迹。
- **OTA 下载成功（HTTP 200）不等于刷写/验证阶段成功**。设备可能在完整下载后仍在闪存写入或校验阶段失败，并自动回退到旧版本。验收时必须通过设备最终状态确认升级完成。
- **构建产物的大小差异是 OTA 兼容性的重要诊断信号**。若新固件大小与旧固件大小相差悬殊（例如 2.3MB vs 4.1MB），说明可能是非完整构建、分区表不匹配或 flash layout 改变导致的刷写失败，这类问题无法通过调整 OTA 触发逻辑解决。
- 验收目标不是"请求重启成功"，而是设备最终上报 `app_version=<target>`、`project_name=stack-chan`，并恢复 `idle` 或 `listening`。

## 关联代码

| 路径 | 作用 |
| ---- | ---- |
| `firmware/CMakeLists.txt` | `PROJECT_VER` 固件版本入口,影响 app_desc 与 OTA 版本识别。 |
| `ops/bin/stackchan-ota-release` | OTA 发布脚本,负责发布 candidate、校验 app_desc、更新 active release 与端点。 |
| `tools/remote_control/remote_control.py` | 远程控制工具,可通过 `reboot --confirm` 触发设备重启并进入 OTA 拉取流程。 |
| `ops/ota/active.json` | OTA active release 元数据位置;发布脚本会更新该状态。 |

## 真实发布 / 验收链路

1. `firmware/CMakeLists.txt`:修改 `PROJECT_VER`,使固件 app_desc 暴露目标版本。
2. `idf.py -B build-release-<version> build`:使用独立 release build 目录构建固件。
3. `esptool.py --chip esp32s3 image_info --version 2 build-release-<version>/stack-chan.bin`:确认 `Project name: stack-chan` 与 `App version: <version>`。
4. `ops/bin/stackchan-ota-release firmware/build-release-<version>/stack-chan.bin --version <version>`:发布 OTA candidate,并检查 HTTP OTA 端点。
5. `tools/remote_control/remote_control.py --ip <device-ip> --port 18080 --token <token> reboot --confirm`:请求设备重启,触发 OTA。
6. 轮询设备状态:允许升级阶段短暂离线;最终必须确认 `app_version=<version>` 且 `state=idle/listening`。

## 已知陷阱

- 不要把一次 `reboot` 请求成功当作 OTA 成功；OTA 完成通常还会出现短暂离线和二次重启。
- 不要只看本地 bin 文件存在；必须校验 app_desc 中的 `App version`。
- **不要因为 HTTP OTA 端点返回了 200 且固件完整下载就判定升级成功**。完整下载 + 刷写/校验失败 + 回退到旧版本是完全可能的失败模式。
- **不要忽略目标固件与当前固件的文件大小差异**。当大小差异悬殊时（如 2.3MB vs 4.1MB），应先确认构建是否完整、镜像结构是否包含全部分区和 app_desc，而不是继续调试 OTA 触发/重试参数。
- **不要拿子项目 `xiaozhi-esp32/` 的 app bin 作 OTA 固件**。`firmware/xiaozhi-esp32/build/xiaozhi.bin` 只有 ~2.3MB，是子项目的裸 app，不含主项目的 `app_desc`、`PROJECT_VER` 及完整分区。合法的 OTA 固件必须是主项目 `idf.py build` 输出的 `firmware/build/stack-chan.bin`（~4.1MB）。两者的 app_desc 差异会导致 OTA 版本校验失败或刷写不可逆。
- 不要在文档里长期保留单次发布的 SHA256、文件大小、探测编号或具体局域网 IP；这些是一次性证据，不是长期规则。
- **OTA 发布前必须确认 bin 来自主项目完整构建**，即 `firmware/CMakeLists.txt` 中的 `PROJECT_VER` 决定版本、`idf.py build` 在 `firmware/build/` 下输出 `stack-chan.bin`。不要用 `xiaozhi.bin`、`bootloader.bin`、`partition-table.bin` 等子产物替代。
- `build-release-<version>/` 是构建产物目录，不应作为长期源码锚点。

## 验证标准

- 构建返回码为 0，且 `idf.py` 完成所有目标。
- `image_info` 输出包含 `Project name: stack-chan` 和目标 `App version`。
- OTA 发布脚本完成 app_desc 版本校验，HTTP OTA 端点返回目标版本，`HEAD /stack-chan.bin` 为 200。
- 若构建产物大小与旧版本固件大小显著不一致，应额外通过 `esptool.py image_info --version 2` 确认镜像结构完整（分段数量、每个 segment 大小是否正常），排除不完整构建。
- 设备经过 OTA 后最终上报目标 `app_version`，状态恢复为 `idle` 或 `listening`。

## 关键检索词

- `PROJECT_VER`
- `stackchan-ota-release`
- `image_info --version 2`
- `App version`
- `remote_control.py`
- `reboot --confirm`
- `state=upgrading`
- `state=idle`
- `state=listening`
- `app_version`
