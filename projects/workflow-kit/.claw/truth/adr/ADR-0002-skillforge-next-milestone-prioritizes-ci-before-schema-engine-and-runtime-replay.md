# ADR-0002: SkillForge 下一里程碑优先 CI 最小接入，再评估 schema engine 与 runtime replay

## Status

accepted

## Context

决定先行：SkillForge 在完成 static MVP 的 Phase 2B-2E 后，下一阶段不直接进入 `runtime replay` 或完整 `schema engine`，而是先做 `CI` 最小接入。

来源主计划“SkillForge Milestone Master Plan”已完成，随后子计划“SkillForge Milestone B CI minimal gate”也已完成。计划中的已完成任务记录了当前 static 能力边界已经形成闭环：`validate:all` 被提升为本地总入口，`fixture.profile` 已从 manifest/frontmatter 贯通到 normalize/report，新增了 `standard` profile 的最小 fixture 样本，并且 `validate:contracts` 已为 single/multi/profile/aggregate/matrix 建立最小 contract 回归入口。

在这一前提下，主计划中的“Runtime replay / CI 决策门”先明确给出下一阶段顺序：`1) CI最小接入 2) schema engine轻量设计 3) runtime replay前置调研`；而 Milestone B 完成记录进一步把这个顺序落成仓库级自动门禁：新增 `.github/workflows/ci-minimal-gate.yml`，在 `pull_request` 与 `push(main)` 触发，使用单个 `ubuntu-latest` job 运行 `validate:all` 与 `validate:contracts`。同一份完成记录还明确限制文档口径：CI 只能表述为 `static-only minimal gate`，不得误宣称 `runtime replay`、`schema engine`、`cross-platform` 或 `cross-model` 已完成。

这个结论值得沉淀，因为它不仅决定了下一阶段排序，还为今后的仓库级 CI 宣传和能力边界设下长期约束：后续里程碑应优先把现有 static gate 稳定挂到自动化入口，并持续保持“最小、静态、单 job”定位，避免过早扩张到更重的 schema 校验体系或 runtime 执行链路。

## Decision

决定将 SkillForge 下一 milestone 的优先级固定为：

1. 先做 `CI` 最小接入，且范围只覆盖 `static gate only`。
2. 之后再评估 `schema engine` 的轻量设计。
3. `runtime replay` 仅做前置调研，排在前两者之后。

同时明确以下实施约束：

- 仓库级自动门禁固定采用最小 GitHub Actions workflow：`.github/workflows/ci-minimal-gate.yml`，触发 `pull_request` 与 `push(main)`，在单个 `ubuntu-latest` job 中依次执行 checkout、`pnpm`、`node`、install、`validate:all`、`validate:contracts`。
- 下一阶段默认复用现有 static 验证入口，不把 `CI` 扩大为重型流水线，不在该里程碑纳入 `runtime replay`、`schema engine`、跨平台矩阵或 cross-model 验证。
- 对内对外文档口径必须始终表述为 `static-only minimal gate`，禁止把该 CI 门禁描述成更大范围能力已完成。
- `schema engine` 仍保持“轻量设计”定位，不因为已有 contract tests 或 CI 挂载就直接升级为完整 JSON Schema 引擎。
- `runtime replay` 在 static multi-fixture 与 schema contract 稳定之前，不进入正式实现阶段。
- 后续 roadmap 与 subplan 编排应遵循这一顺序，除非出现方向性重大变更或用户另行确认。

## Alternatives Considered

- 直接优先做 `runtime replay`：拒绝。来源计划明确认为其前置依赖更多、闭环更长，不适合作为当前 static MVP 后的第一优先级。
- 先做完整 `schema engine`：拒绝。当前计划只接受轻量设计，不支持一次性扩张为完整引擎。
- 继续只做本地验证，不接 `CI`：拒绝。计划复盘明确给出 `CI` 是“前置最少、闭环最短、收益最高”的下一步。

## Related Code

| Path | Role |
| ---- | ---- |
| `plan.json` | 来源 master plan，记录 Phase 2B-2E 完成态、决策门排序与 retrospective。 |
| `plans/subplan-2-milestone-b-ci-minimal-gate.json` | 来源子计划记录，提供 Milestone B 完成态、CI workflow 形态与边界约束。 |
| `.github/workflows/ci-minimal-gate.yml` | 仓库级最小 GitHub Actions static gate 入口。 |
| `docs/roadmap.md` | 该决策要求回写并约束后续 milestone 排期。 |
| `docs/validator-contract.md` | 当前 static gate 与 contract 边界的长期约束锚点。 |

## Consequences

- 正向：把下一阶段聚焦在已有 static gate 的自动化接入，能以最小前置成本提升回归稳定性。
- 正向：维持 `validate:all`、`validate:contracts`、fixture profiles 与 multi-fixture contract 的既有边界，避免路线突然膨胀。
- 正向：最小 CI 已经有明确且可复用的落点：`.github/workflows/ci-minimal-gate.yml` 在 `pull_request` 与 `push(main)` 触发，单个 `ubuntu-latest` job 运行 `validate:all` 与 `validate:contracts`。
- 正向：把“CI 已接入”与“能力边界仍然 static-only”一起固化，能减少后续 roadmap、README 或状态汇报把最小门禁误写成更大能力完成的回归风险。
- 正向：为后续是否需要 `schema engine` 或 `runtime replay` 提供更清晰的评估顺序。
- 取舍：短期内不会立即获得 runtime 级验证能力，也不会把 schema 约束提升到完整引擎级别。
- 取舍：当前 CI 只覆盖 Linux static gate，不应被误解为 runtime replay、cross-platform、cross-model 或 schema engine 已完成。
- 取舍：来源计划同时记录仓库尚无 lockfile 与 node version 文件，因此当前 CI 的可复现性仍弱于理想状态；这属于后续稳定性增强项，不改变本 ADR 的最小门禁决策。
- 验证锚点：来源完成记录已给出 `validate:all 45/45, 3/3 fixtures`、`validate:contracts` 全通过，以及 workflow 已新增并文档同步完成。

## Search Terms

- `CI最小接入`
- `static-only minimal gate`
- `schema engine轻量设计`
- `runtime replay前置调研`
- `validate:all`
- `validate:contracts`
- `.github/workflows/ci-minimal-gate.yml`
- `pull_request`
- `push(main)`
- `ubuntu-latest`
- `fixture.profile`
- `standard fixture`
