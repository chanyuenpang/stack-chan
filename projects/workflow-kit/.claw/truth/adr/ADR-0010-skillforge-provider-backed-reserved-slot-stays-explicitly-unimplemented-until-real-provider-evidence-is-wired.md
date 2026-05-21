# ADR-0010: SkillForge provider-backed reserved slot 在真实 provider evidence 接通前保持显式未实现

## Status

accepted

## Context

决定先行：在 ADR-0008 已固定 `provider-backed` 只作为 runtime runner 内部的 reserved/unimplemented slot、ADR-0009 已固定 `transcriptRef` 只能表示 provider-less in-report draft transcript evidence 之后，Phase 3 下一子阶段继续收紧 provider-facing seam，但仍不接入真实 provider。

来源计划“Phase 3 provider-backed reserved slot contract tightening”已完成。计划中的 `done` 任务、review 与 retrospective 固定了以下事实：

- 已在 `runtime-provider-adapter-contract.mjs` 补上 provider-backed slot 当前的保留约束：当 `providerBacked!==true` 时，必须强制 `executed=false`、`providerCall=false`、`providerEvidenceAvailable=false`、`transcriptCaptured=false`、`transcriptPersistence=false`、`persistence=none`、`executionId=null`、`providerRunId=null`、`providerStatus=null`；若传入 transcript ref，还会被压回 `available=false`、`providerManaged=false`、`handle=null`、`location=null`。
- 已新增导出 `RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET` 与 `RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS`，把当前允许的受限状态集合，以及未来真实 provider 接入后必须补齐的关键字段，直接写进 contract 元数据。
- `runtime-runner-contract.mjs` 已收紧 provider adapter seam 默认结构与 `buildRuntimeRunnerResult(...)`：默认声明 `providerExecutionReserved`、`providerCall=false`、`transcriptCaptured=false`、`evidenceProduced=false`、`passedReserved=true`，并增加 `futureProviderRequiredFields`；若当前不是 provider-backed 却塞入 `providerTranscript=true` 的 `transcriptRef`，会直接抛错。
- `runtime-replay-reporter.mjs` 新增 `metadata.providerBackedContract`，对外明确 `currentState=reserved-unimplemented`、当前保留字段语义、以及未来必填字段清单；`runtime-runner.mjs` 也同步补上 `executionId`、`providerRunId`、`providerStatus`、`currentState` 等占位字段，使 contract shape 在 provider 未接通前先稳定。
- 预检失败的状态机已收口：`runtime-runner.mjs` 中当 `preflightReport.status!==passed` 时，builtin provider adapter 直接产出 `status=blocked`；`runtime-runner-contract.mjs` 新增 guard，若 `failureReason.code=RUNTIME_PREFLIGHT_BLOCKED` 则结果 `status` 必须为 `blocked`；`runtime-replay-reporter.mjs` 也把 `summary.blockedCases` 收紧为只统计 `blocked`。
- 已新增 `docs/phase-3-provider-backed-slot-contract-checklist.md`，按字段路径/当前状态/未来 provider-backed 必填要求/归属层整理 implementation checklist 与 reserved field matrix，明确当前仍是 `reserved-unimplemented`，只允许 `blocked|error|dry-run|not-executed`，不开放 `passed`，也不允许伪造 provider evidence / transcript / persistence。
- `scripts/test-runtime-contracts.mjs` 已新增 reserved slot honesty / preflight→blocked 合同测试，来源计划确认实际通过 `Runtime contract tests passed: 17/17 cases`。

该决策需要沉淀，因为它把“provider-backed seam 已存在”进一步推进为“provider-backed seam 的未实现边界、字段级 contract、未来接入义务、以及 preflight blocked 诚实语义都已被固定”。这已经不只是临时实现细节，而是后续所有真实 provider 接入都必须遵守的长期约束。

## Decision

决定将 SkillForge 当前阶段的 provider-backed 路线固定为：在真实 provider selection、raw response capture、observed mapping、transcript handle、persistence handle 与 execution evidence 全部接通之前，`provider-backed` 只能作为显式 `reserved-unimplemented` contract slot 存在，且必须把“未实现”编码进字段值、状态机与 report metadata，而不是留模糊占位。

当前阶段的具体规则如下：

- `provider-backed` 当前不得被视为可执行模式；它只允许作为 contract-first 的 reserved slot 存在，并且必须通过 `currentState=reserved-unimplemented` 对外明示。
- 当结果不是已实现的真实 provider-backed execution 时，provider execution 相关字段必须保持受限空值或保留值：`executed=false`、`providerCall=false`、`providerEvidenceAvailable=false`、`transcriptCaptured=false`、`transcriptPersistence=false`、`persistence=none`、`executionId=null`、`providerRunId=null`、`providerStatus=null`。
- `transcriptRef` 也必须遵守同样的诚实边界：当前如果没有真实 provider transcript，任何 provider-managed transcript 语义都必须被压回 `available=false`、`providerManaged=false`、`handle=null`、`location=null`；非 provider-backed 路径若伪造 `providerTranscript=true`，必须直接视为 contract 违规。
- provider-backed 当前允许的 case/result 状态只限于 `blocked`、`error`、`dry-run`、`not-executed` 这一受限集合；在真实 provider evidence、persistence 与 pass-path 没接通前，禁止开放 `passed`。
- preflight 未通过时，runtime 状态机必须直接收口为 `blocked`，不得再以 `dry-run + blocked reason` 之类半草稿语义伪装。若 `failureReason.code=RUNTIME_PREFLIGHT_BLOCKED`，对应结果状态必须是 `blocked`。
- contract 必须显式公开未来接入义务：后续真实 provider-backed 实现必须沿 `RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS` / `futureProviderRequiredFields` 所列字段补齐 provider selection、raw response、observed mapping、transcript handle、persistence handle、failure taxonomy 与 runtime pass path，而不是临时随意扩展。
- `runtime-replay-report` 必须持续暴露 `metadata.providerBackedContract`，让消费方看到当前是 `reserved-unimplemented`、哪些字段是受限保留位、以及未来哪些字段必须补齐。
- reserved slot honesty tests 必须长期留在 `scripts/test-runtime-contracts.mjs` 中，专门防止 provider-backed slot 被半实现、伪造 evidence、或在状态机上偷偷放宽。

## Alternatives Considered

- 继续保留宽松占位，让 provider-backed 字段先“看起来像已接上”再慢慢补真实实现：拒绝。来源计划的核心结论就是避免半实现半占位，必须先把 false/null/reserved contract 钉死。
- 在 preflight failed 时继续使用 `dry-run + blocked reason`：拒绝。已完成任务明确把这类情况收敛为真正的 `blocked`，让“被前置条件拦下”和普通 skeleton 草稿态分离。
- 允许当前阶段出现 `passed`、provider transcript、provider evidence 或 persistence handle 的表面占位：拒绝。来源计划与 checklist 都明确这些能力尚未接通，不能用伪值暗示已实现。
- 等真实 provider 接入时再整理字段级 contract 与 implementation checklist：拒绝。已完成任务已经把 future required fields 与 reserved field matrix 先行固定，目的就是避免后续反复猜 contract。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-subplan-8-phase-3-provider-backed-slot-contract-ti.json` | 来源计划记录，提供字段级 contract、状态机收口、checklist、tests 与 retrospective 结论。 |
| `src/skillforge/runtime-provider-adapter-contract.mjs` | provider-backed reserved slot 当前约束、`RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET` 与 `RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS` 锚点。 |
| `src/skillforge/runtime-runner-contract.mjs` | provider adapter seam 默认结构、`buildRuntimeRunnerResult(...)`、`futureProviderRequiredFields` 与 preflight-blocked guard 锚点。 |
| `src/skillforge/runtime-runner.mjs` | provider-backed reserved slot 占位字段、`pickStatusForMode()` 与 preflight failed → `blocked` 收口锚点。 |
| `src/skillforge/runtime-replay-reporter.mjs` | `metadata.providerBackedContract`、`summary.blockedCases` 与 report 顶层状态收口锚点。 |
| `scripts/test-runtime-contracts.mjs` | reserved slot honesty / preflight→blocked contract tests 锚点。 |
| `docs/phase-3-provider-backed-slot-contract-checklist.md` | implementation checklist 与 reserved field matrix 锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | provider-backed reserved slot 协议口径同步锚点。 |
| `docs/validator-contract.md` | provider-backed contract / runtime honesty 边界文档同步锚点。 |
| `docs/roadmap.md` | Phase 3 进度口径回写锚点。 |
| `docs/phase-3-runtime-draft-cli-plan.md` | 本轮 tightening 与后续真实 provider 承接边界说明锚点。 |

## Consequences

- 正向：provider-backed seam 的“未实现”状态从模糊约定变成字段级可验证合同，后续实现不会再一边保留一边暗示已接通。
- 正向：通过 `futureProviderRequiredFields` 与 checklist/matrix，后续真实 provider 接入拥有明确实现义务清单，减少 contract 漂移和重复猜测。
- 正向：`preflight failed -> blocked` 的状态机收口让 runtime taxonomy 更诚实，`blocked` 明确表示被前置条件拦下，不再和普通 `dry-run` 草稿态混用。
- 正向：report-level `metadata.providerBackedContract` 给下游消费方稳定可见的诚实信号，帮助避免把 draft/runtime skeleton 误读为 provider execution 已完成。
- 正向：独立 reserved slot honesty tests 持续把 provider evidence、transcript、persistence、status 放宽都锁进回归护栏。
- 取舍：当前依然不支持真实 provider selection、provider response capture、provider transcript、transcript persistence、runtime pass path、sandbox enforcement、scoring 或 multi-case orchestration；功能上仍只是 contract tightening + implementation prep。
- 取舍：后续若要开放真实 provider-backed 执行，必须先显式补齐 future required fields、pass-path 与 validators，不能直接在现有 reserved slot 上偷开 `passed` 或伪造 metadata。
- 验证锚点：来源完成记录确认 `scripts/test-runtime-contracts.mjs` 已通过 `17/17 cases`，其中包含 reserved slot honesty 与 preflight→blocked 合同测试；并同步记录当前文档口径仍明确 `provider-backed` 是 `reserved/unimplemented`、`summary.passed` 固定 `false`、runtime draft 仍不接入 `validate:all` / `validate:contracts` / `validate:preflight` 默认链路。

## Search Terms

- `provider-backed reserved slot`
- `reserved-unimplemented`
- `RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET`
- `RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS`
- `futureProviderRequiredFields`
- `metadata.providerBackedContract`
- `providerExecutionReserved`
- `providerEvidenceAvailable=false`
- `transcriptPersistence=false`
- `executionId=null`
- `providerRunId=null`
- `providerStatus=null`
- `providerTranscript=true`
- `RUNTIME_PREFLIGHT_BLOCKED`
- `preflight failed -> blocked`
- `docs/phase-3-provider-backed-slot-contract-checklist.md`
- `reserved field matrix`
- `reserved slot honesty`
