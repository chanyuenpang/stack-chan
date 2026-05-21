# ADR-0011: SkillForge observed mapping 必须先收口到单一 runtime truth channel，再进入真实 provider execution

## Status

accepted

## Context

决定先行：在 ADR-0010 已固定 `provider-backed` 在真实 provider evidence 接通前必须保持 `reserved-unimplemented` 之后，Phase 3 下一子阶段继续前移 runtime truth seam，但仍不接真实 provider、不开放 `passed`、不做 transcript persistence 或 scoring。

来源计划“Phase 3 observed mapping seam”已完成。计划中的 `done` 任务、review 与 retrospective 固定了以下事实：

- 已新增 `src/skillforge/runtime-observed-mapper.mjs`，提供 `mapProviderResultToObservedRuntime(...)` 这一独立 seam，输入 `adapterResult + providerSelection + caseContext`，统一输出 `observed`、`providerExecution`、`transcriptAvailability`，并固定 mapper contract 标识 `kind=runtime-observed-mapper-output`、`version=RUNTIME_OBSERVED_MAPPER_VERSION`。
- 已在 `runtime-provider-adapter-contract.mjs` 引入 `buildRuntimeProviderSelection()` 与 `RUNTIME_PROVIDER_SELECTION_VERSION`，把 provider selection 从 runner 内部散落字段提升为可复用的内部透传对象。
- `runtime-runner.mjs` 已删除内联 `buildObservedStub()` 路径，改为先拿 `adapterResult`，再统一调用 `mapProviderResultToObservedRuntime({ adapterResult, providerSelection, caseContext })`；`dry-run`、`null-runner`、`provider-backed-reserved`、`preflight-blocked` 四条路径都经过同一 seam。
- `runtime-replay-reporter.mjs` 已改为优先消费 mapper 输出，并保留/输出 `cases[].providerExecution`、`cases[].transcriptAvailability`，同时让 `metadata.providerExecution`、`metadata.transcriptAvailability`、`metadata.providerBackedContract.reservedFields`、`metadata.providerBackedContract.futureRequiredOutputs` 从同一 runtime fragment 派生。
- 当前 truth mapping 规则已被固定：`preflight-blocked -> observed evidence=preflight-blocked`，`provider-backed selection -> observed evidence=provider-slot-reserved`，`null-runner/dry-run -> observed evidence=not-executed`。
- `scripts/test-runtime-contracts.mjs` 已扩展 observed mapping seam contract tests，并确认 `Runtime contract tests passed: 19/19 cases`；新增断言锁住 `cases[0].providerExecution === metadata.providerExecution` 与 `cases[0].transcriptAvailability === metadata.transcriptAvailability` 的一致性。
- 文档同步已明确：这个 seam 只是 truth mapping channel，不代表真实 provider integration、provider transcript、transcript persistence、scoring 或正式 gate 已完成；runtime draft 仍保持 `summary.passed=false`、`provider-backed` 仍是 reserved/unimplemented、preflight 未通过时结果诚实收口为 `blocked`。

该决策需要沉淀，因为它把 runtime draft 从“runner/reporter 各自拼 observed stub”推进为“所有 runtime observed 事实都必须经由单一 mapper 通道沉淀”。这已经是后续真实 provider response capture、adapter output realization 与 runtime replay 演进必须遵守的长期结构约束，而不只是一次性重构。

## Decision

决定将 SkillForge 当前阶段的 runtime observed 语义固定为：在真实 provider execution 接通之前，`adapterResult -> observed/providerExecution/transcriptAvailability` 必须先通过单一 mapper seam 归一化，再由 runner、reporter 和后续 contract 消费；禁止继续在不同层各自手拼 observed 或 metadata fragment。

当前阶段的具体规则如下：

- `src/skillforge/runtime-observed-mapper.mjs` 中的 `mapProviderResultToObservedRuntime(...)` 是 provider result 到 runtime truth 的唯一映射通道；后续 runtime draft 若需要产出 `observed`、`providerExecution`、`transcriptAvailability`，都必须从这条 seam 派生。
- provider selection 不能再作为 runner 局部临时字段散拼；必须通过 `buildRuntimeProviderSelection()` 构造成内部透传对象，并以 `RUNTIME_PROVIDER_SELECTION_VERSION` 固定 shape，供 mapper 与后续真实 provider wiring 复用。
- `runtime-runner.mjs` 不再直接拼 `observed stub`；它只负责拿到 `adapterResult` 和 `providerSelection`，然后统一消费 `mapProviderResultToObservedRuntime(...)` 的输出。`dry-run`、`null-runner`、`provider-backed-reserved`、`preflight-blocked` 四类路径都必须走同一 seam。
- `runtime-replay-reporter.mjs` 对外暴露的 `cases[].observed`、`cases[].providerExecution`、`cases[].transcriptAvailability`，以及 `metadata.providerExecution`、`metadata.transcriptAvailability`、`metadata.providerBackedContract.*`，必须由同一 mapper 输出驱动，避免 case 级与 metadata 级语义分裂。
- 当前阶段的 observed evidence taxonomy 固定为：`preflight-blocked -> preflight-blocked`、`provider-backed selection -> provider-slot-reserved`、`dry-run/null-runner -> not-executed`；后续真实 provider 接入只能在这个单一 seam 内扩展，而不能在 runner/reporter 层私自改写。
- 该 seam 当前仍然是 provider-less / draft-only 的 truth channel：它不得被解读为真实 provider execution 已完成，也不得借此开放 `passed`、provider transcript、transcript persistence、scoring 或正式 gate 接入。
- `scripts/test-runtime-contracts.mjs` 中的 observed mapping seam tests 必须长期保留，专门锁住 mapper contract 版本、一致性约束，以及四类路径的 truth mapping 诚实性。

## Alternatives Considered

- 继续让 `runtime-runner.mjs` 内联拼 `observed stub`，再让 reporter 做二次修补：拒绝。来源计划已明确这会导致 `observed`、`providerExecution`、`transcriptAvailability` 在不同层各自散拼、语义分裂。
- 只统一 `observed`，但 `providerExecution` 与 `transcriptAvailability` 继续保留 reporter 侧硬编码保留字段：拒绝。已完成任务明确要求三者同源输出，作为同一 `adapterResult` 的三种视图。
- 在接通真实 provider 之前暂不抽 mapper，等真实 response capture 出现后再收口：拒绝。来源计划的结论就是先固定 truth mapping channel，避免未来 provider 接入时一边接线一边猜 contract。
- 把 observed mapping seam 误当成 provider integration 完成标志：拒绝。文档与 retrospective 都明确当前只是 mapper seam / truth channel，仍未实现真实 provider execution、transcript persistence、scoring 或正式 gate。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-subplan-9-phase-3-observed-mapping-seam.json` | 来源计划记录，提供 mapper seam、统一消费路径、report 派生规则、tests 与 retrospective 结论。 |
| `src/skillforge/runtime-observed-mapper.mjs` | `mapProviderResultToObservedRuntime(...)` 唯一 truth mapping seam 与 `RUNTIME_OBSERVED_MAPPER_VERSION` 锚点。 |
| `src/skillforge/runtime-provider-adapter-contract.mjs` | `buildRuntimeProviderSelection()` 与 `RUNTIME_PROVIDER_SELECTION_VERSION` 锚点。 |
| `src/skillforge/runtime-runner.mjs` | 删除内联 `buildObservedStub()`、统一消费 mapper 输出、四类路径共用 single seam 的锚点。 |
| `src/skillforge/runtime-runner-contract.mjs` | mapper 对齐使用的 runtime fragment/skeleton version 常量锚点。 |
| `src/skillforge/runtime-replay-reporter.mjs` | `normalizeProviderExecution(...)`、`normalizeTranscriptAvailability(...)`、case/metadata 同源输出锚点。 |
| `scripts/test-runtime-contracts.mjs` | observed mapping seam contract tests、一致性断言与 `19/19 cases` 验证锚点。 |
| `docs/validator-contract.md` | runtime honesty / mapping seam 边界文档同步锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | observed mapping truth channel 协议口径同步锚点。 |
| `docs/roadmap.md` | Phase 3 observed mapping seam 进度口径回写锚点。 |
| `docs/phase-3-runtime-draft-cli-plan.md` | runtime draft 仍是 provider-less / reserved-only 边界说明锚点。 |

## Consequences

- 正向：runtime observed 事实拥有单一归一化入口，后续真实 provider response capture 与 adapter output realization 可在固定 seam 上演进，而不是继续分散在 runner/report/metadata 多处。
- 正向：`cases[].observed`、`cases[].providerExecution`、`cases[].transcriptAvailability` 与对应 `metadata.*` 字段由同源 fragment 派生，减少 case 级与 report 顶层口径漂移。
- 正向：provider selection 先以 versioned 内部对象透传，给后续真实 provider wiring 留下稳定接口，而不必再次回退到临时散拼字段。
- 正向：四类路径共享同一 mapper 后，`preflight-blocked`、`provider-slot-reserved`、`not-executed` 的 evidence taxonomy 被锁进 contract tests，后续回归更容易发现“看起来跑了其实没跑”的虚假语义。
- 取舍：当前 seam 仍只提供 provider-less draft truth mapping，不支持真实 provider execution、provider transcript capture、transcript persistence、scoring、sandbox enforcement 或 multi-case orchestration。
- 取舍：后续任何想扩展 runtime observed 语义的工作，都必须优先修改 mapper seam 与其 contract tests，而不能在 runner/reporter 层局部绕过。
- 验证锚点：来源完成记录确认 `scripts/test-runtime-contracts.mjs` 已通过 `19/19 cases`，其中包含四类路径的 mapper contract 验证，以及 `cases[0].providerExecution` / `metadata.providerExecution`、`cases[0].transcriptAvailability` / `metadata.transcriptAvailability` 的一致性断言。

## Search Terms

- `runtime-observed-mapper`
- `mapProviderResultToObservedRuntime`
- `RUNTIME_OBSERVED_MAPPER_VERSION`
- `runtime-observed-mapper-output`
- `buildRuntimeProviderSelection`
- `RUNTIME_PROVIDER_SELECTION_VERSION`
- `providerSelection`
- `buildObservedStub`
- `provider-slot-reserved`
- `preflight-blocked`
- `not-executed`
- `providerExecution`
- `transcriptAvailability`
- `metadata.providerExecution`
- `metadata.transcriptAvailability`
- `futureRequiredFields`
- `futureRequiredOutputs`
- `Runtime contract tests passed: 19/19 cases`
