# ADR-0013: SkillForge provider-backed selection lineage 冻结为 canonical builder 唯一来源

## Status

accepted

## Context

在 ADR-0012 已把 provider adapter result 收紧为 `selection` / `execution` / `evidence` / `rawResponse` 四分区单一 truth payload 之后，Phase 3 继续推进 selection identity 的内部收紧。

来源计划"Phase 3 provider-backed selection wiring tightening"已完成。计划中的 `done` 任务、review 与 retrospective 固定了以下事实：

- `runtime-provider-adapter-contract.mjs` 已引入 `BUILTIN_PROVIDER_SELECTION_PRESETS`，为 `dry-run` / `null-runner` / `provider-backed` 三种内部模式定义冻结的 canonical selection preset，固定 `adapterKey` / `providerKey` / `providerSlot` / `builtin` / `implemented` / `providerBacked` 及默认 `providerSlot`。
- `buildRuntimeProviderSelection(...)` 收紧为只接受 `mode` / `providerKey` 与 `providerSlot`，不再允许外部注入 `builtin` / `implemented` / `providerBacked` 等 identity 字段；新增 `resolveRuntimeProviderSelection(...)` 供 `buildRuntimeProviderAdapterResult(...)` 使用，即使调用方传普通 object 也会被折叠回 canonical builder 结果。
- `providerMetadata` 的 `providerBacked` / `providerKey` / `providerSlot` / `adapterKey` / `builtin` / `implemented` 现统一从 selection 回填，`providerMetadata` 不再是另一套 identity truth source。
- `runtime-runner.mjs` 已删除本地 `buildProviderSelection`，改为 `resolveRunnerProviderSelection(mode)` 内部调用 `buildRuntimeProviderSelection({ mode })`，使 runner 不再手搓 `adapterKey` / `providerSlot` / `providerBacked` / `implemented`。
- 构建 runner contract 时完整 selection 挂到 `providerAdapterSeam.selection`；构建 provider adapter contract 时同一 `providerSelection` 传入 `options.providerSelection`；调用 observed mapper 时也透传同一个 `providerSelection`。
- `runtime-observed-mapper.mjs` 中 `normalizeProviderSelection(...)` 保留 `kind` / `version` / `adapterKey` / `providerKey` / `providerSlot` / `builtin` / `implemented` / `providerBacked`；`buildProviderExecution(...)` 显式挂上 `selection`；`providerExecution` 的 identity 字段统一从归一化后的 `providerSelection` 派生。
- `runtime-replay-reporter.mjs` 中 `DEFAULT_PROVIDER_EXECUTION_FRAGMENT` 新增 `selection:null`，`normalizeProviderExecution(...)` 归一化 `providerExecution.selection` 并由标准化 selection 回填 identity 字段；`reportProviderExecution` 取值优先级改为 `runtime?.providerExecution ?? normalizedCases[0]?.providerExecution`，减少 fallback 顺序导致的 lineage 漂移。
- `scripts/test-runtime-contracts.mjs` 已扩展 selection wiring contract assertions，锁住固定字段集合、三种内部模式同源一致、以及 provider-backed 仍为 reserved-only（`executed` / `providerCall` / `evidence` / `transcript` 全部 false/null/none）；CLI `--mode provider-backed` 继续返回 usage error。通过 `Runtime contract tests passed: 24/24 cases`。
- 文档同步已明确：selection wiring 已收紧为 adapter → runner → observed mapper → report 单一路径；CLI 仍不开放 provider-backed mode；provider-backed 仍只是 internal reserved seam。

该决策需要沉淀，因为它把 selection identity 从"多处可构造"冻结为"单一 canonical builder + frozen presets"，并将 `providerMetadata` 降级为 selection 的派生层。这是后续真实 provider 接入时 selection identity 必须遵守的结构约束。

## Decision

决定将 SkillForge provider-backed selection identity 冻结为：selection object 只能通过 `buildRuntimeProviderSelection(...)` 构造，identity 字段由 frozen presets 固定，`providerMetadata` 不再独立持有 identity truth；adapter → runner → observed mapper → report 全链路必须透传同一 canonical selection object。

当前阶段的具体规则如下：

- `BUILTIN_PROVIDER_SELECTION_PRESETS` 是 `dry-run` / `null-runner` / `provider-backed` 三种内部模式的唯一 identity 定义；`adapterKey` / `providerKey` / `providerSlot` / `builtin` / `implemented` / `providerBacked` 不允许外部注入或修改。
- `buildRuntimeProviderSelection(...)` 只接受 `mode`（必填）、`providerKey`（可选）和 `providerSlot`（可选）；`resolveRuntimeProviderSelection(...)` 确保即使调用方传入普通 object 也会被折叠回 canonical 结果。
- `providerMetadata` 中的 `providerBacked` / `providerKey` / `providerSlot` / `adapterKey` / `builtin` / `implemented` 统一从 selection 回填，`providerMetadata` 不能成为独立的 identity truth source。
- `runtime-runner.mjs` 不再本地推导 selection 片段；runner contract 通过 `providerAdapterSeam.selection` 承载完整 selection；provider adapter contract 通过 `options.providerSelection` 接收同一个 selection。
- `runtime-observed-mapper.mjs` 与 `runtime-replay-reporter.mjs` 必须从归一化后的 `providerSelection` 派生 `providerExecution` 的 identity 字段，report 的取值优先级为 `runtime?.providerExecution ?? normalizedCases[0]?.providerExecution`，减少 fallback 漂移。
- provider-backed 内部模式仍为 reserved-only：`executed` / `providerCall` / `evidence` / `transcript` / `rawResponse` 全部保守；CLI `--mode provider-backed` 仍返回 usage error。
- 后续若要新增 provider 模式，必须先在 `BUILTIN_PROVIDER_SELECTION_PRESETS` 注册 preset 并更新 canonical builder，不能在 runner/mapper/report 层私自构造 selection identity。

## Alternatives Considered

- 继续允许 runner/mapper/reporter 各自从 `providerMetadata` 或本地推导 selection identity 片段：拒绝。来源计划已确认这导致 identity 字段散落在多层，truth lineage 不一致。
- 只统一 builder 但不引入 frozen presets：拒绝。frozen presets 确保 identity 字段不会被运行时参数覆盖，是 wiring tightening 的核心保障。
- 在 providerMetadata 与 selection 之间维持双源 identity：拒绝。来源计划已明确 `providerMetadata` 降级为 selection 的派生/回填层，避免两套 truth source 导致漂移。
- 借 wiring tightening 开放 CLI provider-backed mode 或 `passed` path：拒绝。来源计划与 retrospective 都明确 selection wiring 只是内部收紧，provider-backed 仍为 reserved seam，不接真实 provider。

## Related Code

| Path | Role |
| ---- | ---- |
| `src/skillforge/runtime-provider-adapter-contract.mjs` | `BUILTIN_PROVIDER_SELECTION_PRESETS`、`buildRuntimeProviderSelection()`、`resolveRuntimeProviderSelection()`、`buildRuntimeProviderAdapterResult()` selection 回填锚点。 |
| `src/skillforge/runtime-runner.mjs` | `resolveRunnerProviderSelection(mode)`、删除本地 `buildProviderSelection`、`providerAdapterSeam.selection` 透传锚点。 |
| `src/skillforge/runtime-runner-contract.mjs` | `DEFAULT_PROVIDER_ADAPTER_SEAM` 新增 `selection:null` 承载完整 selection object 的锚点。 |
| `src/skillforge/runtime-observed-mapper.mjs` | `normalizeProviderSelection(...)`、`buildProviderExecution(...)` 从 selection 派生 identity 锚点。 |
| `src/skillforge/runtime-replay-reporter.mjs` | `DEFAULT_PROVIDER_EXECUTION_FRAGMENT` selection 字段、`normalizeProviderExecution(...)` 归一化、取值优先级收口锚点。 |
| `scripts/test-runtime-contracts.mjs` | selection wiring contract assertions、provider-backed reserved-only 断言、CLI usage error 防回归、`24/24 cases` 验证锚点。 |
| `docs/phase-3-provider-backed-slot-contract-checklist.md` | selection wiring tightening 文档口径同步锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | selection lineage 单一路径协议口径锚点。 |
| `docs/validator-contract.md` | provider-backed selection 边界文档同步锚点。 |
| `docs/roadmap.md` | Phase 3 wiring tightening 进度口径回写锚点。 |

## Consequences

- 正向：selection identity 拥有唯一 frozen source，后续新增 provider 模式必须先注册 preset，杜绝 identity 字段在多层散落构造。
- 正向：`providerMetadata` 降级为 selection 的派生层，消除了两套 identity truth source 并存的漂移风险。
- 正向：adapter → runner → observed mapper → report 全链路透传同一 canonical selection object，case 级与 metadata 级的 lineage 一致性由 contract tests 锁住。
- 正向：runner 不再本地推导 selection 片段，降低了 runner/adapter/mapper 之间的耦合和重复逻辑。
- 取舍：当前 selection presets 仍只覆盖 `dry-run` / `null-runner` / `provider-backed` 三种内部保留模式；真实 provider 接入时必须扩展 preset 注册机制，不能绕过 canonical builder。
- 取舍：`resolveRuntimeProviderSelection(...)` 会折叠非 canonical object，这意味着未来如果 selection shape 需要演进，必须同步更新 builder 和 preset，而不是在调用方临时调整。
- 验证锚点：来源完成记录确认 `scripts/test-runtime-contracts.mjs` 已通过 `Runtime contract tests passed: 24/24 cases`，其中包含 selection 固定字段集合、三种模式同源一致、provider-backed reserved-only、CLI usage error 防回归等断言。

## Search Terms

- `BUILTIN_PROVIDER_SELECTION_PRESETS`
- `buildRuntimeProviderSelection`
- `resolveRuntimeProviderSelection`
- `resolveRunnerProviderSelection`
- `providerAdapterSeam.selection`
- `options.providerSelection`
- `normalizeProviderSelection`
- `normalizeProviderExecution`
- `providerMetadata`
- `providerBacked`
- `providerKey`
- `providerSlot`
- `adapterKey`
- `provider-backed reserved`
- `Runtime contract tests passed: 24/24 cases`