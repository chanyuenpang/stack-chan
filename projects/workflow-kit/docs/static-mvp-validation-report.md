# SkillForge 静态 MVP 验证报告

## 1. 验证范围

本报告固化 SkillForge 静态 MVP 的当前可复现证据，范围限定为：

- 正例 fixtures：`fixtures/meeting-summary-assistant/**` 与 `fixtures/study-card-assistant/**`
- 单 fixture 静态校验命令：`pnpm --silent validate:fixture <fixture-path> --format json`
- 多正例静态校验命令：`pnpm --silent validate:fixtures`
- 静态规则集：`skillforge-static-mvp-0.1.0`
- 验证维度：structure、trigger、boundary、dependency、replay、privacy、compatibility

边界说明：本报告只证明**静态 fixture 与静态校验器**当前通过；不证明模型运行时回放通过，不证明跨平台/跨模型兼容已完成，也不证明完整产品验收 PASS。

## 2. Baseline 正例证据（最新重新运行）

| 项 | 结果 |
|---|---|
| CWD | `/home/yankeeting/.openclaw/projects/workflow-kit` |
| 命令 | `pnpm --silent validate:fixture fixtures/meeting-summary-assistant --format json` |
| exit code | `0` |
| Node | `v24.15.0` |
| pnpm | `10.33.2` |
| reportVersion | `0.1.0` |
| ruleSetVersion | `skillforge-static-mvp-0.1.0` |
| fixture.path | `fixtures/meeting-summary-assistant` |
| fixture.id | `meeting-summary-assistant` |
| fixture.version | `0.1.0` |
| fixture.entry | `skill/SKILL.md` |
| status | `passed` |
| summary.passed | `true` |
| summary.total | `15` |
| summary.byStatus | `pass: 15` |
| summary.bySeverity | `P0: 5, P1: 8, P2: 2` |
| summary.blockingFailures | `0` |
| summary.warnings | `0` |
| summary.errors | `0` |
| checks 数量 | `15` |
| checks 严重级别分布 | `P0: 5, P1: 8, P2: 2` |
| findings | `[]` |
| generatedAt | `2026-05-21T05:28:55.940Z` |

可复现命令：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
node --version
pnpm --version
pnpm --silent validate:fixture fixtures/meeting-summary-assistant --format json
```

正例摘要：15 条规则全部通过，其中 P0 5 条、P1 8 条、P2 2 条；`blockingFailures=0`、`warnings=0`、`errors=0`。

## 2A. Phase 2A 多 fixture 静态证据（最新重新运行）

本节补充 Phase 2A 证据：第二个非会议类 simple fixture `study-card-assistant` 已通过静态验证，`validate:fixtures` 已作为最小多正例入口通过。该证据仍只代表 static validation。

| 命令 | exit code | 关键结果 |
|---|---:|---|
| `pnpm --silent validate:fixture fixtures/meeting-summary-assistant --format json` | `0` | `status=passed`，`summary.passed=true`，`summary.total=15`，`blockingFailures=0`，`warnings=0`，`errors=0` |
| `pnpm --silent validate:fixture fixtures/study-card-assistant --format json` | `0` | `status=passed`，`summary.passed=true`，`summary.total=15`，`blockingFailures=0`，`warnings=0`，`errors=0` |
| `pnpm --silent validate:fixtures` | `0` | `kind=multi-fixture-validation-report`，`status=passed`，`summary.totalFixtures=2`，`passedFixtures=2`，`failedFixtures=0`，`totalChecks=30`，`bySeverity=P0:10/P1:16/P2:4` |
| `pnpm --silent validate:fixtures fixtures/meeting-summary-assistant fixtures/study-card-assistant --format json` | `0` | 显式路径模式通过；输出顺序为 `meeting-summary-assistant`、`study-card-assistant`；`totalFixtures=2`，`passedFixtures=2`，`failedFixtures=0` |
| `pnpm --silent validate` | `0` | 仍只验证 baseline fixture `fixtures/meeting-summary-assistant`，输出单 fixture JSON artifact |
| `pnpm --silent validate:all` | `0` | 仍为本地正反例矩阵 gate，输出 `Fixture matrix passed: 6/6 cases.` |

最新复核环境：CWD `/home/yankeeting/.openclaw/projects/workflow-kit`，Node `v24.15.0`，pnpm `10.33.2`。本次 multi-fixture report 的 `generatedAt` 为运行时字段（示例：`2026-05-21T05:28:56.356Z`），不应 snapshot。

## 3. Phase 1 反例矩阵摘要

Phase 1 已新增 `pnpm --silent validate:fixture:matrix`，当前 package alias 为 `pnpm --silent validate:all`。该 alias 调用矩阵脚本，使用 `/tmp` 临时副本运行正例与代表性反例，并在退出前清理临时 fixture。矩阵断言 exit code、stdout JSON 可解析、目标规则 ID 命中；不 snapshot `generatedAt`。最新复核结果为 6/6 通过，exit `0`。

Artifact 语义区分：`pnpm --silent validate` 输出单个正例 fixture 的 JSON validation artifact；`pnpm --silent validate:all` 输出 human-readable matrix summary。后者会内部解析各 case 的 JSON stdout，但自身 stdout 不是 JSON artifact。

| 反例类别 | 修改点 | exit code | stdout JSON | summary.passed | 命中规则 ID | evidence 脱敏 |
|---|---|---:|---|---|---|---|
| 缺 description / trigger 不可用 | 删除 `skill/SKILL.md` frontmatter `description`，并泛化正文触发词 | `1` | 是 | `false` | `SF-P1-STRUCTURE-SKILL-FRONTMATTER-CORE-FIELDS`; `SF-P1-TRIGGER-DESCRIPTION-ACTIONABLE` | 是；仅显示 `missing description` |
| secret/token 高置信隐私 | `/tmp` 副本 `README.md` 追加 token/secret/password | `1` | 是 | `false` | `SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK` | 是；显示 `token: <redacted-secret>` |
| 私有路径 | `/tmp` 副本追加 `/home/example/.ssh/id_rsa` 与 `C:\Users\Example\.env` | `1` | 是 | `false` | `SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK` | 是；显示 `<redacted-path>` |
| replay 伪造 observed/passed=true | 将第一条 replay case 改为 `passed: true` 且 `observed` 保持 `null` | `1` | 是 | `false` | `SF-P0-REPLAY-PASSED-WITHOUT-OBSERVED-EVIDENCE` | 是；无敏感原文 |
| 缺 7 维 checklist | 从所有 checklist 来源删除 `compatibility` 维度 | `1` | 是 | `false` | `SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST` | 是；显示 `missing compatibility` |

Phase 1 结论：5 类反例均 exit 非 0，失败场景 stdout 均为合法 JSON，临时目录已清理，未联网、未外发、未 commit/push；正例 baseline 仍 exit 0。

## 4. 已关闭风险 / 未关闭风险

### 已关闭或静态 MVP 已关闭

- **真实 fixture 风险：静态 MVP 已关闭。** `fixtures/meeting-summary-assistant` 已作为真实正例 fixture 接入校验命令。
- **最小静态校验器风险：静态 MVP 已关闭。** 当前校验器可输出稳定 JSON 报告，并覆盖 15 条规则。
- **静态命令证据风险：静态 MVP 已关闭。** T6 已重新运行正例命令并记录 CWD、版本、report/ruleSet、fixture 与 summary。
- **反例失败 JSON 合同风险：静态 MVP 已关闭。** T5 5 类反例均输出合法 JSON 且 exit 非 0。
- **高置信隐私脱敏风险：静态 MVP 已关闭。** T5 证明 secret/token 与私有路径 evidence 会被替换为 `<redacted-secret>` / `<redacted-path>`。
- **隐私 evidence 重复噪音：Phase 1 已修复并验证。** 隐私扫描使用独立扫描 regex，避免脱敏逻辑扰动 `lastIndex`；同文件、同脱敏 detail、同 pattern kind 的 evidence 会去重，矩阵脚本覆盖 secret/token 与 private path 重复注入。
- **checklist 聚合语义：Phase 1 已文档化。** 规则说明与 README 均明确七维 checklist 是多来源聚合覆盖，不是单文件 exactly once。
- **Phase 2A 多正例入口：静态 MVP 已关闭最小范围。** `validate:fixtures` 当前默认扫描两个完整正例 fixture，`totalFixtures=2`、`passedFixtures=2`、`failedFixtures=0`；它不替代 runtime replay 或 CI。

### 未关闭 / 仍需后续跟踪

- **运行时模型回放：pending。** 静态 replay 规则只检查 fixture 声明与伪造 pass，不等价于真实模型执行回放。
- **跨平台兼容：pending。** 当前证据来自 Linux 环境，尚未覆盖 macOS/Windows 路径与 shell 差异。
- **跨模型兼容：pending。** 尚未验证不同模型对同一 Skill 的触发、边界遵循与输出稳定性。
- **完整产品验收：pending。** 本报告不是完整生成器/UI/发布流程的产品级 PASS。
- **10 轮优化实际执行质量：部分已有文档，仍需与静态/运行时证据持续对齐。**

## 5. evidence 脱敏说明

当前静态校验报告的 evidence 只保留必要定位信息与规则诊断信息；T5 反例验证中：

- token/secret/password 类内容以 `<redacted-secret>` 呈现；
- 私有绝对路径或用户目录路径以 `<redacted-path>` 呈现；
- replay 伪造类只显示用例 ID 与失败原因，不包含敏感原文；
- 正例报告未发现高置信 secret、私有路径或内部 IP。

## 6. 已知小风险

1. **模型回放仍是静态诚实性检查。** 当前只阻断伪造 `passed=true` 且无 observed/executed 证据，不等价于真实模型回放。
2. **跨平台证据仍不足。** 当前矩阵在本机 Linux/Node 环境运行，尚未覆盖 macOS/Windows 差异。
3. **checklist 聚合语义。** `SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST` 会从多个 YAML/Markdown 来源聚合七维 checklist；只删除单一来源中的 `compatibility` 不一定失败，必须从所有来源删除才触发缺维度。这是当前实现语义，文档、规则说明和矩阵测试已同步。

## 7. 结论

当前静态 MVP 与 Phase 2A 最小多 fixture 证据可复现：两个 simple 正例 fixture 在当前环境下均 exit 0、各 15 条静态规则全部通过；`validate:fixtures` 当前聚合 `totalFixtures=2`、`passedFixtures=2`、`failedFixtures=0`；T5 反例矩阵证明关键失败路径可被 JSON 化报告捕获，并具备基础脱敏能力。

结论限定为：**SkillForge 静态 MVP 与 Phase 2A 最小多正例静态入口验证通过，可作为后续 schema engine、runtime replay、CI、跨平台/跨模型兼容和完整产品验收的基础证据。**
