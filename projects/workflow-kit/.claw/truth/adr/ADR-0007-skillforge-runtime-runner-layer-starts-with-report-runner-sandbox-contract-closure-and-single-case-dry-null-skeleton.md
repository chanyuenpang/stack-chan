# ADR-0007: SkillForge runtime runner 层先完成 report / runner / sandbox 合同闭环，再进入真实执行

## Status

accepted

## Context

决定先行：在 ADR-0006 已把 `preflight` 独立落地且保持 `17/51/6/6` static baseline 零污染之后，Phase 3 的下一段实现不直接接入真实 provider，也不先做 transcript engine 或完整 sandbox enforcement，而是先把 runtime runner 层收敛为一个“合同闭环 skeleton”。

来源计划“SkillForge Phase 3 runtime report and runner interface”已完成。计划中的已完成任务与 retrospective 固定了以下事实：

- 负责人先锁定方向为最小组合，而不是只做单一 artifact 或单一接口；原子顺序固定为 `runtime replay report skeleton -> runner interface contract -> sandbox boundary contract -> single-case dry/null runner skeleton -> standalone runtime contract tests -> docs sync`。
- `src/skillforge/runtime-replay-reporter.mjs` 冻结 `kind=runtime-replay-report` 的最小 shape，包含 `fixture`、`status`、`summary`、`cases`、`checks`、`errors`、`metadata`、`pendingCapabilities`；其中缺失执行状态规范为 `not-executed`，`dry-run` / `not-executed` / `blocked` 都计入 `blockedCases`，并通过 `metadata.note` 与 `pendingCapabilities` 明确当前只是 skeleton-only artifact。
- `src/skillforge/runtime-runner-contract.mjs` 冻结单 case runner 的输入/输出合同：输入面包含 `fixtureDir`、`loadedFixture`、`normalizedFixture`、`preflightReport`、`caseRecord`、`boundary`、`options`，输出面包含 `caseId`、`status`、`observed`、`transcriptRef`、`failureReason`、`runnerMetadata`；`status` 仅允许 `passed|failed|blocked|error|dry-run|not-executed`。
- `src/skillforge/runtime-sandbox-contract.mjs` 将 sandbox boundary 独立冻结为 declaration-only contract，输入面覆盖 `permissions`、`toolBoundary`、`sideEffectPolicy`、`sandboxMode`、`network`、`filesystem`、`externalMessaging`，输出面为 `boundarySummary`、`reservedCapabilities`、`warnings`；并固定 `boundarySummary.declarationOnly=true`、`enforcementImplemented=false`。
- `src/skillforge/runtime-case-selector.mjs` 与 `src/skillforge/runtime-runner.mjs` 仅支持从 `normalizedFixture.replayCases.cases` 中选择单 case，当前 runner 只支持 `dry-run` / `null-runner` 两种 mode，结果状态只会产生 `dry-run` / `blocked` / `not-executed`，明确禁止产生 `passed`；`observed` 固定记录 `providerCall=false`、`transcriptCaptured=false`、`sideEffectsPerformed=false`。
- `scripts/test-runtime-contracts.mjs` 与 `package.json` 中的 `validate:runtime:contracts` 为 runtime 层提供独立 contract tests，覆盖 runtime report 顶层字段、single-case selector、dry/null runner 不产出 `passed`、`blocked` 统计对齐，以及 `pendingCapabilities` / `metadata.note` 明确未实现 provider / transcript / sandbox enforcement；统一验证确认 `validate:fixture` 仍为 `17 checks`、`validate:fixtures` 仍为 `51 totalChecks`、`validate:all` 仍为 `6/6`、`validate:contracts`、`validate:preflight`、`validate:preflight:contracts` 均未受污染。

这个结论需要沉淀，因为它把“Phase 3 如何从 preflight 进入 runtime 层”的实现策略固定下来：先冻结 artifact、producer contract 与 boundary contract，并用 single-case dry/null skeleton 打通最小 accounting 闭环，但禁止把 skeleton 伪装成真实 runtime replay 成功。

## Decision

决定将 SkillForge Phase 3 在 runtime runner 层的首段实现策略固定为“合同闭环优先于真实执行接入”。

当前阶段的具体规则如下：

- runtime 层必须先同时落地 `runtime-replay-report` artifact skeleton、`runner interface contract`、`sandbox boundary contract` 与 `single-case dry/null runner skeleton`，而不是只做其中一块。
- `runtime-replay-report` 必须作为独立 artifact 存在，最小 shape 固定为 `fixture`、`status`、`summary`、`cases`、`checks`、`errors`、`metadata`、`pendingCapabilities`，并把未执行态明确编码为 `not-executed` / `blocked` / `dry-run`，不得伪装为真实 success report。
- runner producer contract 的输入/输出面固定围绕 `normalizedFixture`、`preflightReport`、`caseRecord` 与 `boundary` 建立，`status` 只允许 `passed|failed|blocked|error|dry-run|not-executed` 这组枚举。
- sandbox 先冻结 declaration-only boundary contract，只声明 `permissions`、`toolBoundary`、`sideEffectPolicy` 等边界，不在本阶段实现 `sandbox enforcement`、`tool execution`、`filesystem isolation`、`network isolation` 或 `external messaging guard`。
- runtime skeleton 只允许单 fixture / 单 case，并且只允许 `dry-run` / `null-runner` 两种 mode；当前阶段不得产出 `passed`，也不得宣称已完成 provider 调用、transcript 捕获或 side effect 执行。
- runtime contract tests 必须独立于 static / preflight tests 存在，作为 runtime 层唯一默认回归锚点；新增 runtime 能力时，必须继续保持 `17/51/6/6` static baseline 与既有 `validate:preflight*` contract 零污染。
- 在上述合同闭环稳定前，不进入真实 provider integration、transcript engine、sandbox enforcement、scoring engine 或多 case runtime orchestration。

## Alternatives Considered

- 只实现 `runtime-replay-report` artifact，不冻结 runner / sandbox contract：拒绝。来源计划已明确最小可演进切口必须是 report 与 producer/boundary contract 的组合，否则 artifact 没有稳定生产者接口。
- 直接进入真实 provider / transcript / sandbox 执行链：拒绝。计划与 retrospective 都明确当前阶段只允许 skeleton，避免把未冻结边界过早拉进真实执行层。
- 让 runtime skeleton 直接产出 `passed` 证明接口可用：拒绝。来源计划明确要求 `dry-run` / `null-runner` 只能产生 `dry-run`、`blocked`、`not-executed`，不得伪装成真实执行成功。
- 把 runtime contract tests 并入 `validate:contracts` 或 static / preflight baseline：拒绝。计划已将 runtime tests 固定为独立验证轨道，以保护既有 baseline。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-phase-3-runtime-report-and-runner-interface.json` | 来源计划记录，提供本轮完成态、任务 review 与 retrospective 结论。 |
| `src/skillforge/runtime-replay-reporter.mjs` | `runtime-replay-report` artifact skeleton 与顶层 shape 锚点。 |
| `src/skillforge/runtime-runner-contract.mjs` | 单 case runner 输入/输出 producer contract。 |
| `src/skillforge/runtime-sandbox-contract.mjs` | declaration-only sandbox boundary contract。 |
| `src/skillforge/runtime-case-selector.mjs` | 单 case 选择规则与 `caseId` / `caseIndex` 入口锚点。 |
| `src/skillforge/runtime-runner.mjs` | `dry-run` / `null-runner` single-case skeleton。 |
| `scripts/test-runtime-contracts.mjs` | runtime contract 独立回归入口。 |
| `package.json` | `validate:runtime:contracts` 命令锚点。 |
| `docs/phase-3-runtime-report-runner-plan.md` | 本轮实现顺序与边界说明锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | runtime 分层路线的上游协议锚点。 |

## Consequences

- 正向：Phase 3 已从 `preflight` 前置 gate 进入 runtime 层，但仍以合同闭环而非真实执行为主，降低边界漂移风险。
- 正向：`runtime-replay-report`、runner contract、sandbox contract 与 single-case skeleton 形成了最小 execution accounting skeleton，后续真实执行有了稳定接缝。
- 正向：通过 declaration-only sandbox contract 与 `observed` 全 false 约束，明确区分“边界声明已冻结”与“执行能力已实现”。
- 正向：独立 `validate:runtime:contracts` 让 runtime 层获得可回归入口，同时继续保护 static / preflight baseline。
- 取舍：当前仍不支持真实 provider integration、transcript capture、sandbox enforcement、scoring 或多 case orchestration，功能上仍只是 skeleton。
- 取舍：后续进入真实 runtime execution 时，必须继续沿既定 contract 面扩展，不能绕开 `runtime-runner-contract` / `runtime-sandbox-contract` 另起接口。
- 验证锚点：来源完成记录确认 `validate:runtime:contracts` 实际通过 `5/5 cases`，同时 `validate:fixture` `17 checks`、`validate:fixtures` `51 totalChecks`、`validate:all` `6/6`、`validate:contracts`、`validate:preflight`、`validate:preflight:contracts` 全部保持通过。

## Search Terms

- `runtime-replay-report`
- `runtime-runner-contract`
- `runtime-sandbox-contract`
- `validate:runtime:contracts`
- `single-case dry-run`
- `null-runner`
- `not-executed`
- `blockedCases`
- `pendingCapabilities`
- `metadata.note`
- `providerCall=false`
- `transcriptCaptured=false`
- `sideEffectsPerformed=false`
- `17/51/6/6 baseline`
