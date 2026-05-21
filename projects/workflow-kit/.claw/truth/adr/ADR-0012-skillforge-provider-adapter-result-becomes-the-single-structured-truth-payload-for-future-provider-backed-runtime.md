# ADR-0012: SkillForge provider adapter result 成为未来 provider-backed runtime 的单一结构化 truth payload

## Status

accepted

## Context

决定先行：在 ADR-0010 已固定 `provider-backed` slot 必须保持 `reserved-unimplemented`、ADR-0011 已固定 `observed` / `providerExecution` / `transcriptAvailability` 必须经由单一 mapper seam 产出之后，Phase 3 下一子阶段继续把 truth seam 前移到 provider adapter output 本身。

来源计划“Phase 3 provider adapter output realization”已完成。计划中的 `done` 任务、review 与 retrospective 固定了以下事实：

- `runtime-provider-adapter-contract.mjs` 已把 adapter output skeleton 收紧为四个结构化分区：`selection`、`execution`、`evidence`、`rawResponse`，并保留 `transcriptRef`；未来 provider-backed 最小真相载荷必须从这组字段单一产出，而不再从各层散落默认值拼装。
- `FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS` 已从偏 `providerMetadata.*` 的字段列表改成面向真实中间 payload 的结构化字段路径；`providerMetadata` 仍保留，但降级为兼容/镜像摘要层，由 `selection` / `execution` / `evidence` 归并得出保守值。
- `buildRuntimeProviderAdapterResult()` 现已支持直接接收 `selection` / `execution` / `evidence` / `rawResponse`，并在 provider-backed 仍未实现时强制把 `execution`、`evidence`、`rawResponse`、`transcriptRef` 的可用值压回保守状态，不误置真 `executed`、`providerCall`、`providerEvidenceAvailable`、`transcriptAvailable`，也不开放 `passed`。
- `runtime-observed-mapper.mjs` 已改为显式消费 `selection` / `execution` / `evidence` / `rawResponse` / `transcriptRef` / `providerMetadata`；`observed`、`providerExecution`、`transcriptAvailability` 三视图继续只是同一 `adapterResult` 的不同投影，且优先读结构化 skeleton，`providerMetadata` 只作 fallback/兼容。
- `runtime-runner.mjs` 与 `runtime-replay-reporter.mjs` 已收紧为优先透传 mapper 已产出的 `providerExecution`、`transcriptAvailability` 与 `futureRequiredFields`，不再各自发明 adapter truth 默认值；`runtime.providerAdapter` 也直接镜像 `providerExecution` 的同源字段。
- `scripts/test-runtime-contracts.mjs` 已新增并扩展针对 adapter output realization 的合同测试，锁住 provider-backed slot 仍不可执行，但 `selection` / `execution` / `evidence` / `rawResponse` skeleton 字段 shape 已稳定；来源计划确认通过 `Runtime contract tests passed: 21/21 cases`。
- 文档已同步明确：当前只是“更真实的中间 truth payload”，不代表真实 provider call、provider-backed runtime replay、provider transcript、transcript persistence、scoring 或正式 gate 已完成；`summary.passed` 仍固定 `false`，provider-backed slot 仍是 `reserved/unimplemented`，runtime draft 仍不接入 `validate:all`、`validate:contracts`、`validate:preflight` 默认链路。

该决策需要沉淀，因为它把 runtime draft 从“单一 observed truth channel”进一步推进为“单一 adapter result truth payload”。这会长期约束未来真实 provider 接入、response capture、transcript handle/persistence wiring、runner/report 透传方式，以及任何新增 provider truth 字段的落点。

## Decision

决定将 SkillForge 当前阶段的 provider-facing 中间层固定为：`provider adapter result` 必须成为未来 provider-backed runtime 的唯一结构化 truth payload，后续真实 provider selection、execution、evidence、raw response、transcript handle 与 persistence 语义都应先落到这个 payload，再由 mapper、runner、reporter 和 report 进行同源透传；禁止继续在下游各层补默认值或发明第二套 truth。

当前阶段的具体规则如下：

- adapter result 的最小稳定结构固定为 `selection`、`execution`、`evidence`、`rawResponse` 四个主分区，外加 `transcriptRef`；未来 provider-backed 真正接通时，相关字段必须优先在这些结构化分区中补齐。
- `providerMetadata` 不再是 truth 主载体；它只保留兼容/镜像摘要角色，且其保守值必须由 `selection`、`execution`、`evidence` 归并得出，不能再反过来驱动主要语义。
- `runtime-observed-mapper.mjs` 必须优先消费结构化 adapter result skeleton，并把 `observed`、`providerExecution`、`transcriptAvailability` 视为同一 payload 的不同视图；若已有 `providerMetadata`，也只能作为 fallback/兼容层使用。
- `runtime-runner.mjs`、`runtime-replay-reporter.mjs` 与 report metadata 必须透传 mapper 的同源产物，尤其是 `providerExecution`、`transcriptAvailability` 与 `futureRequiredFields`；不得再自行编造 dry-run/provider-backed truth 默认片段。
- 在真实 provider-backed 尚未实现时，adapter result 仍必须维持诚实保守边界：`executed`、`providerCall`、`providerEvidenceAvailable`、`transcriptAvailable`、`rawResponse.available` 等字段不得误置真，`summary.passed` 也不得开放。
- 后续若要新增 provider-backed 能力，必须优先修改 adapter result contract 与其 tests，让新能力先落到单一中间 payload，再允许 mapper/runner/reporter 消费；不能在 report 或 metadata 层直接加旁路字段。
- `scripts/test-runtime-contracts.mjs` 中关于 output realization、三视图同源、reserved/unimplemented honesty 的合同测试必须长期保留，作为 adapter truth payload 的回归护栏。

## Alternatives Considered

- 继续以 `providerMetadata` 为主要 truth 载体，再在各层补 `execution` / `evidence` / `rawResponse` 细节：拒绝。来源计划已把 `providerMetadata` 降级为兼容/镜像层，避免真实 provider 字段继续散落在摘要对象和下游默认值中。
- 只统一 `observed` mapper，不统一 adapter result 结构：拒绝。ADR-0011 只解决视图层同源问题；本轮计划明确要求把 source payload 本身收紧为结构化单一 truth。
- 让 runner/report 继续自行补默认 provider truth，等真实 provider 接入时再重构：拒绝。来源计划明确收紧 runner/report 透传口径，目的就是提前阻断 truth 漂移。
- 直接把当前结构化 skeleton 视为真实 provider execution 完成：拒绝。来源计划与文档同步都强调当前只是 output realization，不接真实 provider、不开放 `passed`、不做 transcript persistence 或 scoring。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-subplan-10-phase-3-provider-adapter-output-realiza.json` | 来源计划记录，提供 adapter output skeleton、mapper/runner/report 透传规则、tests、文档同步与 retrospective 结论。 |
| `src/skillforge/runtime-provider-adapter-contract.mjs` | `selection` / `execution` / `evidence` / `rawResponse` skeleton、`buildRuntimeProviderAdapterResult()` 与 `FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS` 锚点。 |
| `src/skillforge/runtime-observed-mapper.mjs` | 消费结构化 adapter result skeleton，并输出 `observed` / `providerExecution` / `transcriptAvailability` 同源视图的锚点。 |
| `src/skillforge/runtime-runner.mjs` | runner 侧透传 mapper 产物、`runtime.providerAdapter` 镜像同源字段的锚点。 |
| `src/skillforge/runtime-replay-reporter.mjs` | report 侧收紧 normalization、优先消费 case truth/runtime truth、透传 `providerExecution` / `transcriptAvailability` / raw response 字段的锚点。 |
| `scripts/test-runtime-contracts.mjs` | output realization honesty、三视图同源、reserved raw response slot 与 `21/21 cases` 验证锚点。 |
| `docs/validator-contract.md` | provider adapter result 已成为更真实中间 truth payload 的 contract 口径锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | adapter result / mapper / report 同源透传协议口径锚点。 |
| `docs/roadmap.md` | Phase 3 当前推进口径回写锚点。 |
| `docs/phase-3-runtime-draft-cli-plan.md` | runtime draft 仍不接真实 provider/default validation chain 的边界说明锚点。 |
| `docs/phase-3-runtime-report-runner-plan.md` | runner/report 透传一致化与中间 payload 承接边界说明锚点。 |
| `docs/phase-3-provider-backed-slot-contract-checklist.md` | provider-backed reserved/unimplemented 边界与 future required fields 对齐锚点。 |

## Consequences

- 正向：未来真实 provider-backed execution 的核心字段有了唯一承接层，`selection` / `execution` / `evidence` / `rawResponse` 不再需要在 adapter、mapper、runner、report 各层重复散拼。
- 正向：`observed`、`providerExecution`、`transcriptAvailability` 被明确降为同一 adapter payload 的不同视图，后续扩展时只需先收紧 source payload，再同步更新视图映射。
- 正向：`providerMetadata` 降级为兼容层后，历史消费方仍可获得保守摘要，但未来 truth 结构可以围绕更稳定的结构化字段演进。
- 正向：runner/report 不再发明默认 provider truth，降低 case 级 truth、runtime metadata、report 顶层之间口径漂移的风险。
- 正向：通过 output realization contract tests，未来若有人误把 reserved raw response、transcript availability、provider execution 状态置真，会被直接回归拦下。
- 取舍：当前仍不支持真实 provider call、provider-backed runtime replay、provider transcript、transcript persistence、sandbox enforcement、scoring 或 `passed` path；能力上依旧只是更真实的中间 payload，而不是完成态执行系统。
- 取舍：后续所有 provider-backed 真实现都必须优先遵守 adapter result contract，短期内会增加对结构化 payload 和同源透传的维护约束，但这是为了避免再次出现多处补默认值的 truth 漂移。
- 验证锚点：来源完成记录确认 `scripts/test-runtime-contracts.mjs` 已通过 `Runtime contract tests passed: 21/21 cases`，并明确锁住 provider-backed slot 仍 `reserved/unimplemented`、`summary.passed` 仍固定 `false`、raw response summary/handle 继续 reserved、`providerExecution.transcriptAvailable===transcriptAvailability.available` 等同源约束。

## Search Terms

- `provider adapter output realization`
- `buildRuntimeProviderAdapterResult`
- `selection`
- `execution`
- `evidence`
- `rawResponse`
- `transcriptRef`
- `FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS`
- `providerMetadata`
- `normalizeAdapterResult`
- `providerExecution`
- `transcriptAvailability`
- `runtime.providerAdapter`
- `rawResponseSummary`
- `rawResponseHandle`
- `provider-backed reserved`
- `summary.passed=false`
- `Runtime contract tests passed: 21/21 cases`
