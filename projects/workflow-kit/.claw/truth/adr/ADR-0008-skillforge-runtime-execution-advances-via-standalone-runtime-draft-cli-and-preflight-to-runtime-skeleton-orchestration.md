# ADR-0008: SkillForge runtime execution 先以 standalone runtime draft CLI + preflight→runtime skeleton orchestration 推进

## Status

accepted

## Context

决定先行：在 ADR-0007 已完成 `runtime-replay-report`、`runtime-runner-contract`、`runtime-sandbox-contract` 与 single-case `dry-run` / `null-runner` skeleton 的最小合同闭环之后，Phase 3 的下一段推进不继续优先补 `report enrichment`，也不接入真实 provider，而是先把最小 execution path 做成可落地的 `standalone runtime draft CLI` 与 `preflight→runtime skeleton orchestration`。

来源计划“Phase 3 runtime draft CLI + preflight→runtime skeleton orchestration”已完成。计划中的 `done` 任务与 retrospective 固定了以下事实：

- 已新增独立 `scripts/run-runtime-draft.mjs` 入口，并在 `package.json` 中新增 `validate:runtime:draft`；CLI 支持 `<fixture-path>`、`--case-id`、`--case-index`、`--mode dry-run|null-runner`、`--format json`、`--help/-h`，`stdout` 始终只输出单个 `runtime-replay-report` draft artifact，且退出码固定为 `0=成功生成 artifact`、`1=orchestration 异常/错误 artifact`、`2=usage error`，明确不复用 preflight 的 `summary.passed→exit` 语义。
- 已新增 `src/skillforge/runtime-draft-orchestrator.mjs`，并把 orchestration 顺序固定为 `loadFixture() → normalizeFixture() → validateFixture() → validatePreflight() → runRuntimeCaseSkeleton()`；该路径复用既有 loader / normalize / validate / preflight 栈，不重写 fixture 解析逻辑。
- 已把 static/preflight lineage 透传到 runtime artifact metadata，包括 `sourceStaticReportVersion`、`sourceStaticRuleSetVersion`、`sourceStaticStatus`、`sourcePreflightReportVersion`、`sourcePreflightProtocolVersion`、`sourcePreflightStatus`、`sourceReplayCasesKind`、`sourceFixtureProfile`、`sourceFixtureEntry`，以及 `sourceLineage.static|preflight|replayCases`。
- 已收紧 `runtime-replay-report` 的 draft contract：顶层 `status` 当前只会是 `blocked` 或 `draft`，`summary.passed` 固定为 `false`，`cases[].status` 收紧到 `blocked` / `dry-run` / `not-executed`，`transcriptRef` 强制为 `null`，`observed` 固定为 `kind=runtime-observed-stub` 且 `providerCall/transcriptCaptured/sideEffectsPerformed` 全为 `false`，`metadata.note` 明确 `no provider execution / no transcript evidence / no scoring result / no runtime pass evidence`。
- 已新增并运行 `scripts/test-runtime-contracts.mjs`，为 runtime draft CLI 与 orchestration 锁定合同；来源计划记录其实际通过 `Runtime contract tests passed: 10/10 cases`，同时 static / preflight baseline 仍保持 `17/51/6/6` 与既有 contract 轨道零污染。
- 文档已同步到 `docs/validator-contract.md`、`docs/runtime-replay-protocol-lightweight-design.md`、`docs/roadmap.md`、`docs/phase-3-runtime-draft-cli-plan.md`，并明确当前能力只是独立 runtime draft CLI + single-case dry/null skeleton orchestration，不是正式 gate，也不是 provider-backed runtime replay。

该决策需要沉淀，因为它把“runtime 层如何从合同闭环继续走向更真实 execution proof”的实现策略从规划态推进为已落地约束：现在不仅决定先做 draft-only、skeleton-only、no-provider 路径，而且已经把 CLI 语义、orchestration 接缝、artifact contract、lineage 透传与独立 contract tests 一并固定下来。
## Decision

决定将 SkillForge Phase 3 在 runtime execution 的这一段实现策略固定为：以独立 `standalone runtime draft CLI` 承载 `preflight→runtime skeleton orchestration`，并把这条路径定义为诚实的单 case draft execution 入口，而不是任何形式的真实 runtime pass 证明。

当前阶段的具体规则如下：

- `runtime draft CLI` 必须保持独立入口，不污染 `validate`、`validate:all`、`validate:contracts`、`validate:preflight`、`validate:preflight:contracts` 的既有语义；其命令锚点为 `validate:runtime:draft`。
- CLI 成功语义固定为“成功生成 draft artifact”，而不是“runtime passed”；退出码固定为 `0=artifact generated`、`1=orchestration error with error artifact`、`2=usage error`，不得绑定 `summary.passed`。
- `preflight→runtime` 串联必须通过 `src/skillforge/runtime-draft-orchestrator.mjs` 这一独立 orchestration 接缝完成，并复用既有 `loadFixture()`、`normalizeFixture()`、`validateFixture()`、`validatePreflight()`、`runRuntimeCaseSkeleton()` 栈，而不是重写解析或验证逻辑。
- 当前 runtime draft artifact 必须显式继承 static / preflight lineage；`metadata` 中要保留 source versions、source statuses、fixture/profile/entry 与 `sourceLineage.static|preflight|replayCases`，确保 runtime draft 始终可追溯回上游静态与 preflight 产物。
- draft contract 必须保持诚实边界：顶层 `status` 只允许 `blocked` 或 `draft`；`summary.passed` 固定为 `false`；`cases[].status` 只允许 `blocked` / `dry-run` / `not-executed`；`transcriptRef=null`；`observed` 只能是 stub，且 `providerCall`、`transcriptCaptured`、`sideEffectsPerformed` 全为 `false`。
- runtime draft contract tests 必须作为独立验证轨道存在，用于锁定 CLI、case selection、blocked/dry/null 语义与 artifact contract；同时继续保护 static / preflight baseline 零污染。
- 当前能力仍只允许 `single fixture`、`single case`、`dry/null`、`no-provider`、`no transcript`、`no scoring`、`no sandbox enforcement` 的 execution proof；不得把这条路径描述成正式 gate、provider-backed runtime replay 或多 case orchestration 已实现。

## Alternatives Considered

- 继续优先补 `report enrichment`：拒绝。来源计划与 retrospective 都明确，相比继续补报表字段，先打通最小 execution path 更能证明 Phase 3 runtime 方向成立。
- 直接接入真实 provider、transcript 或把 draft CLI 包装成真实 runtime replay：拒绝。已完成任务明确当前阶段仍是 `draft` / `skeleton` proof，不得越过 `no-provider`、`no transcript`、`no scoring` 边界。
- 把 runtime draft CLI 的成功语义直接绑定 `summary.passed`：拒绝。已完成 CLI 合同明确退出码只表达 orchestration 与 artifact 生成结果，不表达 runtime passed。
- 重写 loader / validator / preflight 栈，另外做一套 runtime fixture 解析逻辑：拒绝。已完成 orchestrator 明确复用既有 `loadFixture()` / `normalizeFixture()` / `validateFixture()` / `validatePreflight()` 栈。
- 把 runtime tests 并入既有 `validate:contracts` 或 `validate:preflight:contracts`：拒绝。来源计划已明确 runtime tests 必须保持独立，以继续保护 static / preflight baseline。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-subplan-5-phase-3-runtime-draft-cli-implementation.json` | 来源计划记录，提供已完成任务、review 与 retrospective 结论。 |
| `scripts/run-runtime-draft.mjs` | 独立 runtime draft CLI 入口与退出码/stdout contract 锚点。 |
| `src/skillforge/runtime-draft-orchestrator.mjs` | `preflight→runtime` 独立 orchestration 接缝。 |
| `src/skillforge/runtime-runner.mjs` | 被 orchestrator 调用的 single-case dry/null runtime skeleton。 |
| `src/skillforge/runtime-replay-reporter.mjs` | `runtime-replay-report` draft contract 与 metadata/summary/cases 锚点。 |
| `scripts/test-runtime-contracts.mjs` | runtime draft CLI 与 orchestration 的独立 contract tests。 |
| `package.json` | `validate:runtime:draft` 与 `validate:runtime:contracts` 命令锚点。 |
| `docs/validator-contract.md` | runtime draft CLI 合同说明同步锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | runtime draft artifact / protocol 边界同步锚点。 |
| `docs/roadmap.md` | Phase 3 路线口径回写锚点。 |
| `docs/phase-3-runtime-draft-cli-plan.md` | 本轮实施边界与后续承接说明锚点。 |

## Consequences

- 正向：Phase 3 已从“runtime skeleton 合同闭环”推进到“preflight 可被独立 CLI/orchestrator 驱动进入单 case runtime draft 路径”，形成更接近真实执行、但仍受控的 existence proof。
- 正向：以独立 `scripts/run-runtime-draft.mjs` 与 `src/skillforge/runtime-draft-orchestrator.mjs` 承载串联，保持 execution 路线与 static/preflight 默认验证族解耦，降低基线污染风险。
- 正向：通过固定 lineage metadata，后续 provider/transcript/scoring 扩展必须沿既有 static/preflight 来源链路演进，减少 report 语义漂移。
- 正向：通过把 CLI exit code 与 `summary.passed` 解耦，明确区分“artifact 已生成”和“runtime 真正通过”，避免把 draft 能力误当成正式 gate。
- 正向：独立 `scripts/test-runtime-contracts.mjs` 让 runtime draft CLI、case selection、blocked/dry/null contract 有稳定回归锚点；来源计划记录其已通过 `10/10 cases`。
- 取舍：当前仍不支持真实 provider integration、transcript capture、sandbox enforcement、多 case / multi-fixture orchestration 或 scoring，功能上依然只是诚实的 draft skeleton。
- 取舍：后续进入更真实 runtime execution 时，必须继续遵守已固定的 artifact contract、lineage 透传与独立 runtime 验证轨道，不能回退到模糊语义或混入 static/preflight 既有入口。
- 验证锚点：来源完成记录确认 `validate:fixture` 仍为 `17 checks`、`validate:fixtures` 仍为 `51 totalChecks`、`validate:all` 仍为 `6/6`、`validate:contracts` / `validate:preflight` / `validate:preflight:contracts` 通过、`validate:runtime:contracts` 通过 `10/10`，且 `validate:runtime:draft` 能稳定输出合法 draft artifact，`status=draft`、`passed=false`。

## Search Terms

- `runtime draft CLI`
- `preflight→runtime skeleton orchestration`
- `scripts/run-runtime-draft.mjs`
- `runtime-draft-orchestrator.mjs`
- `validate:runtime:draft`
- `validate:runtime:contracts`
- `summary.passed`
- `sourceLineage.static`
- `sourceLineage.preflight`
- `sourceLineage.replayCases`
- `single fixture`
- `single case`
- `dry/null`
- `no-provider`
- `transcriptRef`
- `runtime-observed-stub`
- `docs/phase-3-runtime-draft-cli-plan.md`
- `docs/roadmap.md`
