# ADR-0003: SkillForge schema engine 保持轻量，并以 P1 gate 方式扩展现有 validator

## Status

accepted

## Context

决定先行：SkillForge 的 schema 能力在当前阶段不建设完整 schema engine，也不重写现有 validator，而是以轻量结构门禁方式补强最稳定、最有价值的对象面。

来源计划“SkillForge Milestone C schema engine lightweight design”已完成。计划中的已完成任务先做了只读侦察，再完成设计说明与最小原型，明确当前已有 validator contract、report JSON shape、required files、frontmatter core fields、privacy/boundary/dependency/replay honesty、profile passthrough 与 multi-fixture report shape 已相对稳定；仍缺的主要是 `skill-manifest.yaml`、`replay-cases.yaml`、`validation-result.yaml` 及若干辅助 YAML 的结构校验。

在这一背景下，计划记录明确给出长期约束：Milestone C 的目标是“为后续结构门禁做准备”，但“不要引入完整 schema engine”，并且“在不重写 validator 的前提下”先锁定最小 contract/原型边界。这个结论需要沉淀，因为它改变了后续实现方式：SkillForge 的 schema 路线应优先作为 validator 的轻量补强层，而不是独立替换 validator 的大一统引擎。

## Decision

决定将 SkillForge 的 schema 路线固定为“轻量 schema gate + 现有 validator 扩展”模式。

当前阶段的具体规则如下：

- 不重写现有 `validator` 主体。
- 不引入完整 `schema engine` 作为新的主验证入口。
- 先实现最小非阻断 prototype，只覆盖 `skill-manifest.yaml` 与 `replay-cases.yaml` 两个高优先级 target。
- 通过新增 `src/skillforge/schema.mjs` 承载 schema 能力，并在 `validator/rules` 中接入两个最小 `P1 schema gate`。
- target objects 的优先级先按 `manifest > replay-cases > report fixture entry` 推进；`validation-result.yaml` 等对象先保留在设计优先级中，暂不进入当前实现。
- schema gate 必须继续服从现有 contract tests 与 multi-fixture static validation 的回归边界，不能破坏既有 `validate:contracts`、`validate:fixtures`、`validate:all` 与 matrix 验证链路。

## Alternatives Considered

- 直接建设完整 `schema engine`：拒绝。来源计划明确要求 Milestone C 只做轻量设计与最小原型，避免范围膨胀。
- 重写现有 `validator`：拒绝。来源计划已把“在不重写 validator 的前提下”列为明确约束。
- 暂不做任何 schema 补强：拒绝。只读侦察已经确认 `skill-manifest.yaml`、`replay-cases.yaml` 等对象存在稳定且高价值的结构校验缺口，适合先补最小 gate。
- 一次性把 `validation-result.yaml` 与全部辅助 YAML 全量纳入：暂不采用。计划复盘明确当前覆盖仍是最小集合，其余对象只做设计排位，不进入当前实现。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-3-milestone-c-schema-lightweight.json` | 来源计划记录，提供已完成任务、设计边界、原型范围与验证结论。 |
| `src/skillforge/schema.mjs` | 新增的轻量 schema 能力承载点。 |
| `validator/rules` | 两个最小 `P1 schema gate` 的接入位置。 |
| `docs/schema-engine-lightweight-design.md` | 设计说明文档，记录 target 优先级与边界约束。 |
| `docs/validator-contract.md` | schema gate 必须兼容的既有 contract 边界锚点。 |
| `docs/roadmap.md` | 后续 milestone 继续扩展 schema 覆盖面的路线锚点。 |

## Consequences

- 正向：在不推翻现有 validator 的前提下，为 `skill-manifest.yaml` 与 `replay-cases.yaml` 增加了可落地的结构门禁。
- 正向：把 schema 路线限定为轻量补强层，避免过早演化成高维护成本的完整引擎。
- 正向：通过 `src/skillforge/schema.mjs` 与 `validator/rules` 接入，后续可按优先级逐步扩展更多 target objects，而不必重构主验证链路。
- 正向：新增 gate 已保持既有 static contract 边界稳定；来源计划记录显示 contract baseline 从 15→17、总 checks 从 45→51，同时 `validate:all` 继续 exit 0、matrix 6/6 通过。
- 取舍：当前 schema 覆盖仍是最小集合，`validation-result.yaml` 等对象尚未进入实现。
- 取舍：未来若要扩大 schema 覆盖，必须继续遵守“先补稳定高价值对象、保持非阻断演进、不重写 validator”的路线。
- 验证锚点：来源完成记录给出 3 个正例 fixture 均 passed（17 checks）、`validate:fixtures totalChecks=51`、`validate:all exit 0`、matrix `6/6` 通过。

## Search Terms

- `schema engine lightweight design`
- `src/skillforge/schema.mjs`
- `P1 schema gate`
- `skill-manifest.yaml`
- `replay-cases.yaml`
- `validation-result.yaml`
- `validator/rules`
- `validate:contracts`
- `validate:fixtures`
- `validate:all`
- `matrix 6/6`
