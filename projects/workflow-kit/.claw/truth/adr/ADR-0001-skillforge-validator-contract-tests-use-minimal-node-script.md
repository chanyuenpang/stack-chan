# ADR-0001: SkillForge validator contract tests 采用最小纯 Node 脚本方案

## Status

accepted

## Context

决定先行：SkillForge 的 schema contract 回归保护先采用最小纯 Node 脚本方案，不引入完整 schema engine、runtime replay 或重型 CI。

来源计划“SkillForge Phase 2E schema contract tests”已完成。计划记录表明，仓库当时不存在 `tests` / `node:test` / `vitest` / `jest` 基础设施，而 Phase 2E 的目标是先为现有 validator/report contract 建立前置最小回归保护，优先验证 contract 稳定性，而不是扩张测试框架或实现完整 schema 校验链路。

该决策需要沉淀，是因为它改变了后续实现约束：SkillForge 的 contract 回归入口应优先锁定稳定且高价值的输出面，只断言关键字段、关键摘要行和 profile passthrough 行为，避免把脆弱字段或全文 snapshot 变成长期维护负担。

## Decision

决定将 `validate:contracts` 作为 SkillForge Phase 2E 的最小 contract 回归入口，并采用纯 Node 脚本 `scripts/test-validator-contracts.mjs` 实现。

该回归入口只覆盖当前最有价值且最稳定的 contract 面：

- `single fixture` JSON report shape。
- `fixture.profile` 三值断言与 profile passthrough。
- `multi-fixture` report shape。
- `validate:all` human-readable aggregate 关键行。
- `validate:fixture:matrix` 的 6/6 case markers。

同时明确约束：

- 不引入大体量 snapshot。
- 不对 `generatedAt` 等脆弱字段做 hardcode。
- 不在此阶段引入 `schema engine`、`AJV`、`node:test`、`vitest`、`jest` 或重型 CI 扩张。
- 不在此 ADR 对应阶段纳入 `runtime replay` 路线。

## Alternatives Considered

- 引入完整 `schema engine` 或 `AJV`：拒绝。当前目标是最小回归保护，计划已明确不做完整 schema engine 扩张。
- 引入 `node:test`、`vitest` 或 `jest` 测试基础设施：拒绝。来源计划指出仓库当时没有现成基础设施，新增测试框架会扩大范围并增加维护成本。
- 使用大 snapshot 或全文输出对比：拒绝。计划明确要求只锁关键字段与关键行，避免 `generatedAt` 等字段造成脆弱回归。
- 直接推进 `runtime replay` 或重型 CI：暂不采用。计划将其列为后续主 milestone 的决策门，而非 Phase 2E 范围。

## Related Code

| Path                                | Role |
| ----------------------------------- | ---- |
| `plans/subplan-4-subplan-4-plan.json` | 来源计划记录，提供已完成任务、范围边界与决策依据。 |
| `scripts/test-validator-contracts.mjs` | 最小纯 Node contract tests 入口脚本。 |
| `package.json` | 新增 `validate:contracts` script 的挂载点。 |

## Consequences

- 正向：在不引入测试框架和 schema engine 的前提下，为现有 validator/report contract 建立了可执行的最小回归保护。
- 正向：只锁关键字段、关键摘要行和 profile passthrough，降低了因时间戳或全文输出波动导致的脆弱失败。
- 正向：`validate:contracts` 成为后续 SkillForge contract 回归的统一入口，便于在 static MVP 阶段持续复用。
- 取舍：当前断言依赖 `static MVP baseline`，当规则数量合法变化时，需要同步更新 contract tests。
- 后续影响：`runtime replay`、CI、schema engine 是否引入，被显式推迟到后续决策门单独判断。
- 验证锚点：计划记录中的完成态验证包括 `pnpm validate:contracts` 输出 `Validator contract checks passed.`，以及 `validate:fixtures 3/3、45/45`、`validate:all fixtures 3/3 + matrix 6/6`。

## Search Terms

- `validate:contracts`
- `scripts/test-validator-contracts.mjs`
- `fixture.profile`
- `validate:all`
- `validate:fixture:matrix`
- `Validator contract checks passed.`
- `generatedAt`
- `schema engine`
- `AJV`
- `runtime replay`
