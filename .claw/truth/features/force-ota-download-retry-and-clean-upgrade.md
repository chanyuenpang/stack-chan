# force OTA 下载重试与清洁升级

## 结论

当设备在 force OTA 回退/救援场景里反复重试、且下载总是重新开始时,长期优先级不是继续盯着"下载进度",而是先把发布语义收口到一次性的 `force=1`,尽量让设备进入一次干净的升级流程;真正需要长期记住的是:`force` 只适合短期救援,不应长期悬挂,否则会干扰后续正常 OTA 行为判断。

## 长期行为 / 规则

- `force=1` 应只作为救援式下发的临时开关，用完后要恢复到 `force=0`。
- 设备如果表现为"持续重试 OTA、下载总是从头开始"，说明当前链路可能被反复触发或恢复条件未收敛，此时应优先回到发布语义和闭环条件本身排查，而不是把一次性重试误判成稳定完成。
- force OTA 的完成判定仍应以升级闭环为准，不能只看"已开始下载"或"某次下载看似继续前进"。
- **OTA 下载成功（HTTP 200，完整 GET）不等于刷写成功**。设备可能完成下载后仍在刷写/验证阶段失败并自动回退到旧版本。诊断时需区分"下载阶段"与"刷写阶段"的成败。
- **固件大小显著差异是 OTA 刷写失败的关键诊断信号**。若目标固件大小（如 2.3MB）与当前运行固件（如 4.1MB）相差近一倍，说明可能是非完整构建、分区表不匹配或 flash layout 不同导致的刷写失败，而不只是下载或触发问题。
- **2.3MB 大小的 OTA bin 通常是子项目 `xiaozhi-esp32/` 的裸 app**（`firmware/xiaozhi-esp32/build/xiaozhi.bin`），缺少主项目的 `app_desc` 和 `PROJECT_VER`，不是合法的 OTA 固件。合法的完整 OTA 固件应为主项目 `idf.py build` 输出的 `firmware/build/stack-chan.bin`（~4.1MB）。

## 关联代码

| 路径 | 作用 |
| ---- | ---- |
| `ops/bin/stackchan-ota-release` | force OTA 的主入口,承载一次性 `force=1` 下发与恢复语义。 |
| `ops/ota/active.json` | 发布元数据锚点,记录当前 active/force 状态。 |
| `exp-pkg/active-release` | OTA 发布/切换时的 active 入口。 |
| `ops/bin/stackchan-doctor` | 发布后的一致性验收锚点。 |

## 真实调用链路

1. `ops/bin/stackchan-ota-release`:发布阶段可临时切到 `force=1`,用于旧固件回退或救援下发。
2. `ops/ota/active.json` / `exp-pkg/active-release`:记录当前发布切换状态。
3. 设备侧开始拉取 OTA;如果出现"下载反复重启",说明仍处于不稳定升级闭环。
4. `ops/bin/stackchan-doctor --json`:发布后做只读一致性校验,确认不是只完成了下载动作。

## 已知陷阱

- 不要把"下载重新开始"当成成功或失败的唯一信号；这类现象更像是闭环没收口或升级态未真正稳定。
- 不要让 `force=1` 长期保留，否则后续正常升级会被救援语义污染。
- 不要只盯下载行为，最终还是要回到设备状态与 `doctor` 一致性。
- **不要因为 HTTP OTA 端返回了 200 且固件完整下载就判定升级成功**。设备可能在下载完成后刷写/校验阶段失败并自动回退，这是完全不同的失败阶段。
- **不要忽略目标固件与当前固件的文件大小差异**。当大小差异悬殊时（例如 2.3MB vs 4.1MB），应优先怀疑构建是否完整、分区表是否兼容，而不是继续在 OTA 触发逻辑上反复调试。
- **不要将 force=1 场景下的下载成功作为结论性证据**，因为 force 语义可能掩盖了刷写阶段的真实根因（如不兼容的固件镜像结构）。
- **不要误把子项目 `xiaozhi-esp32/build/xiaozhi.bin` 当作 OTA 固件**。这个 bin 只有 ~2.3MB，是子项目裸 app，不含主项目完整镜像。当 OTA 后的固件大小与预期差异巨大时，优先检查发布时用的 bin 路径是否正确——应使用 `firmware/build/stack-chan.bin`。

## 验证标准

- `force=1` 只在救援下发期间短暂存在。
- 发布后 `force` 能恢复到 `force=0`。
- 设备不再反复进入"下载重启"循环，且能通过 `ops/bin/stackchan-doctor --json` 的一致性检查。
- 若新固件大小与旧固件大小显著不一致，应在发布前用 `esptool.py image_info --version 2` 确认镜像结构完整性（分区数、分段大小是否正常），确认不是不完整构建。
- OTA 成功后设备应脱离 `upgrading` 状态、稳定运行在新版本，且 `app_version` 到达目标版本。

## 关键检索词

- `force=1`
- `force=0`
- `ops/bin/stackchan-ota-release`
- `ops/bin/stackchan-doctor --json`
- `active.json`
- `exp-pkg/active-release`
- `下载重新开始`
- `OTA`
