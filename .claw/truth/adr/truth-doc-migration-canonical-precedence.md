# ADR: Truth doc migration uses current .claw/truth canonical precedence

## Status

accepted

## Context

决定：历史 truth 文档迁移时必须以当前仓库 `.claw/truth` 为 canonical，旧 `.projects/stack-chan/truth` 只能作为补充或背景来源。

原因：已完成计划记录，目标目录已有 7 个较新的 canonical truth，旧来源有 27 个强 truth 候选；`PROJECT-TRUTH.md` / `SUMMARY.md` 存在同名冲突，OTA、Celebrate / 舵机主题存在重叠，而 Launcher / XiaoZhi、SCS / ReadPos、工具链等主题冲突较小。如果直接批量覆盖，会让旧结论覆盖当前 accepted 结论，破坏 truth 文档的权威性与可追溯性。

## Decision

迁移历史 truth 文档时采用“当前 `.claw/truth` 优先、旧 truth 补充、冲突隔离”的策略：

1. 当前仓库 `.claw/truth` 是 canonical truth 根目录。
2. 旧 `.projects/stack-chan/truth` 只作为补充或背景来源，不得覆盖当前 `.claw/truth` 中已有有效文档。
3. 非冲突主题可以直接迁入 canonical 目录。
4. OTA、Celebrate、舵机等与现有 canonical 重叠或可能冲突的主题必须进入 legacy / background 区域，并只作为追溯背景，不抢 canonical 优先级。
5. `PROJECT-TRUTH.md` 与 `SUMMARY.md` 不做旧文件覆盖，只允许补充索引、摘要或长期规则。
6. 迁移必须保留 `source -> target` 映射，作为后续追溯入口。
7. 迁移阶段不得删除来源文件，除非用户后续明确要求清理。
8. 如果检索系统会索引 legacy，必须确保 canonical 结论优先于 legacy 背景。

## Alternatives Considered

- 直接批量覆盖目标 `.claw/truth`：拒绝。计划盘点确认目标已有较新的 canonical truth，直接覆盖会让旧结论抢占当前事实。
- 完全跳过旧 truth：拒绝。计划盘点确认旧来源中有 27 个强 truth 候选，Launcher / XiaoZhi、SCS / ReadPos、工具链等低冲突主题具有长期补充价值。
- 将重叠主题直接合并进现有 canonical 文档：部分拒绝。OTA、Celebrate / 舵机主题与当前 canonical 重叠，计划选择将旧内容放入 legacy / background，并只用摘要补充，避免混淆 accepted 结论。

## Related Code

| Path | Role |
| ---- | ---- |
| `.claw/truth` | 当前 canonical truth 根目录。 |
| `.claw/truth/SUMMARY.md` | canonical truth 索引；迁移时只补充索引与摘要，不用旧索引覆盖。 |
| `.claw/truth/PROJECT-TRUTH.md` | 项目级 truth 总纲；迁移时只补充长期规则，不用旧总纲覆盖。 |
| `.claw/truth/MIGRATION-INDEX-2026-05-21.md` | 迁移 source -> target 映射与追溯锚点。 |
| `.claw/truth/legacy/2026-05-21-from-openclaw-projects/` | 旧 truth 中与 canonical 重叠或冲突内容的背景隔离区。 |

## Consequences

- 正向效果：历史 truth 得到迁移和可检索保留，同时不破坏当前 `.claw/truth` 的 canonical 优先级。
- 约束：后续处理旧 `.projects/stack-chan/truth` 或 legacy 内容时，必须先判断是否与当前 canonical 冲突；冲突内容只能作为背景，不能直接覆盖 accepted ADR / feature 结论。
- 取舍：legacy 背景会增加检索噪音，因此检索或人工阅读时必须显式区分 canonical 与 legacy。
- 验证锚点：完成计划记录迁移后目标原有 7 个文件仍存在且未被旧版覆盖；20 个 direct canonical、7 个 legacy、`MIGRATION-INDEX-2026-05-21.md` 均存在；总文件数 35；`SUMMARY.md` / `PROJECT-TRUTH.md` 有迁移区块。

## Search Terms

- `.claw/truth`
- `.projects/stack-chan/truth`
- `canonical truth`
- `legacy/background`
- `MIGRATION-INDEX-2026-05-21.md`
- `source -> target`
- `PROJECT-TRUTH.md`
- `SUMMARY.md`
- `OTA`
- `Celebrate`
- `SCS`
- `ReadPos`
