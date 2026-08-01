# ADR: force OTA 一次性下发并自动恢复

## Status

accepted

## Context

决定：`ops/bin/stackchan-ota-release` 需要支持把指定旧固件以一次性 `force` 模式下发到设备，并在确认设备升级成功后自动把 `force` 恢复为 `false`。原因是现有 OTA 发布链路已经把 `force=0` 作为正常升级边界，而本次任务的目标是借助 `force=1` 做旧固件回退 / 救援式下发，再用设备升级结果继续定位语音失效的回归基线；如果 `force` 继续长期保留为开启状态，会把后续正常发布和回归定位混在一起。

## Decision

`ops/bin/stackchan-ota-release` 的 `force` 语义必须是“一次性强制下发，成功后自动回收”：

1. 默认发布仍保持 `force=0`，作为正常升级口径。
2. 当显式选择旧固件回退 / 救援路径时，脚本可以临时使用 `force=1`，让设备接受指定版本。
3. 设备确认升级成功后，发布链路必须自动把 `force` 恢复为 `false`，避免后续任务误继承强制升级语义。
4. 该能力应继续建立在现有 `exp-pkg/active-release`、`ops/ota/active.json`、`GET /ota/` / `POST /ota/` 与 `ops/bin/stackchan-doctor --json` 一致性验收之上，不额外引入新的发布通道。

## Alternatives Considered

- 让 `force=1` 常驻：被拒绝。这样会把正常升级、旧固件回退和救援场景混在一起，破坏 OTA 发布的默认安全边界。
- 把回退能力拆成独立脚本：当前计划没有提供新的独立工具边界，继续复用 `ops/bin/stackchan-ota-release` 更符合现有发布入口。

## Related Code

| Path | Role |
| ---- | ---- |
| `ops/bin/stackchan-ota-release` | 一次性 `force` 发布与成功后自动恢复的主入口。 |
| `ops/ota/active.json` | `force` 取值的发布元数据锚点。 |
| `exp-pkg/active-release` | 发布切换与回退时的 active 入口。 |
| `ops/bin/stackchan-doctor` | 发布后的一致性验收锚点。 |
| `/ota/` | OTA manifest 验证锚点。 |
| `/stack-chan.bin` | 固件下载验收锚点。 |

## Consequences

- 正向效果：可以用同一套 OTA 发布入口完成旧固件回退 / 救援下发，并在成功后自动清掉 `force`，避免污染后续正常发布。
- 约束：`force=1` 必须显式出现且只短暂生效，不能演化成长期默认配置。
- 风险：如果自动恢复失败，后续 OTA 可能继续沿用强制语义；因此恢复动作必须纳入发布成功路径。
- 验证锚点：本次任务的目标是用该能力定位语音失效回归基线，因此后续验收应同时观察旧固件是否成功下发、设备是否升级成功、以及 `force` 是否已恢复。

## Search Terms

- `ops/bin/stackchan-ota-release`
- `force=1`
- `force=0`
- `force`
- `active.json`
- `exp-pkg/active-release`
- `GET /ota/`
- `POST /ota/`
- `ops/bin/stackchan-doctor --json`
- `stackchan-ota-release`
