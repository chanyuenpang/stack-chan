# ADR-0009: SkillForge provider-less transcript evidence 保持 in-report draft-only，且不得暗示 provider execution

## Status

accepted

## Context

决定先行：在 ADR-0008 已经固定 `standalone runtime draft CLI` 与 `preflight→runtime skeleton orchestration`、并明确 `transcriptRef` 必须为 `null` 的前提下，Phase 3 下一子阶段改为补上最小 transcript execution evidence，但仍严格停留在 provider-less、draft-only、single-case 边界内。

来源计划“Phase 3 single-case execution evidence enrichment”已完成。计划中的 `done` 任务、review 与 retrospective 固定了以下事实：

- 已新增 `src/skillforge/runtime-transcript-contract.mjs`，定义 `buildRuntimeTranscriptArtifact(...)`，并把 transcript artifact 收紧为 `kind=runtime-transcript-artifact`、`artifactVersion=runtime-transcript-artifact-draft-1`、`scope=single-case`、`executionClass=provider-less-draft-only`；最小字段只覆盖 `fixture`、`case`、`executionMode`、`boundary`、`runnerMetadata`、`outcome`、`events`、`note`、`pendingCapabilities`。
- `runnerMetadata` 与 `outcome` 明确固定诚实信号：`providerCall=false`、`transcriptEngineUsed=false`、`transcriptCaptured=false`、`providerResponseCaptured=false`，避免把 orchestration evidence 误读为真实模型 transcript。
- 已在 `src/skillforge/runtime-runner.mjs` 中为 dry-run / null-runner / blocked 路径生成 provider-less single-case transcript stub；events 只记录 `fixture loaded`、`static validated`、`preflight passed/failed`、`case selected`、`boundary built`、`runner blocked/skipped/dry-run reserved` 等 orchestration evidence，不记录虚构模型对话。
- `src/skillforge/runtime-draft-orchestrator.mjs` 已暴露 `runtimeRun.transcriptArtifact`；`src/skillforge/runtime-replay-reporter.mjs` 允许 case 级别带出 `transcript` 字段，并新增 `normalizeTranscriptRef(...)`，不再把 `transcriptRef` 强行归零。
- 已完成 `cases[].transcriptRef` wiring：`src/skillforge/runtime-runner-contract.mjs` 中 `buildRuntimeTranscriptArtifactRef(...)` 现在基于 `artifactId` 生成稳定引用，并固定 `refScheme=in-report-draft-artifact-ref`、`providerTranscript=false`，`location` 指向当前 report 内的 `cases[0].transcript`。
- `scripts/test-runtime-contracts.mjs` 已新增 transcript honesty 合同测试，锁定 transcript artifact / transcriptRef / outcome / runnerMetadata / case status 边界；来源计划确认实际通过 `Runtime contract tests passed: 13/13 cases`。
- 文档已同步到 `docs/validator-contract.md`、`docs/runtime-replay-protocol-lightweight-design.md`、`docs/roadmap.md`、`docs/phase-3-runtime-draft-cli-plan.md`，并统一强调：当前只有 provider-less transcript evidence，不支持 provider transcript、transcript persistence、multi-case aggregate transcript，也不应宣称 provider-backed runtime replay 已完成。

该决策需要沉淀，因为它把 runtime draft 路线中的 transcript 语义从“完全没有 transcript”推进为“可被 report 引用的受限 transcript artifact”，同时又新增了一个必须长期遵守的约束：`transcriptRef` 的存在只能证明 orchestration evidence 已记录，不能被解释为 provider 执行、真实 transcript capture 或 runtime pass evidence。

## Decision

决定将 SkillForge 当前阶段的 transcript 能力固定为：只允许在 `runtime-replay-report` 内附带 provider-less、draft-only、single-case transcript artifact，并且 `transcriptRef` 只能引用该 in-report draft artifact，绝不能暗示任何 provider-backed execution 或真实 transcript capture。

当前阶段的具体规则如下：

- transcript artifact 必须由 `src/skillforge/runtime-transcript-contract.mjs` 统一定义，且固定为 `kind=runtime-transcript-artifact`、`artifactVersion=runtime-transcript-artifact-draft-1`、`scope=single-case`、`executionClass=provider-less-draft-only`。
- transcript 内容只允许记录 orchestration evidence；允许的事实锚点包括 `fixture loaded`、`static validated`、`preflight passed/failed`、`case selected`、`boundary built`、`runner blocked/skipped/dry-run reserved`，不得伪造模型对话、provider request/response、side effects 或任何 provider transcript 片段。
- `runnerMetadata` 与 `outcome` 必须继续把诚实边界写死：`providerCall=false`、`transcriptEngineUsed=false`、`transcriptCaptured=false`、`providerResponseCaptured=false`；即使 `transcriptRef` 存在，这些字段也不得翻转。
- provider adapter seam 的存在也不能改变 transcript 语义：`provider-backed` 即便作为 runner 内部 reserved slot 存在，当前也只能产出受限 error slot / reserved note，不能把 transcript artifact、`transcriptRef` 或 `executionMode=provider-backed` 解释成 provider transcript、provider persistence 或真实 provider execution。
- `cases[].transcriptRef` 不再允许恒为 `null`，但其语义必须固定为 `in-report draft transcript artifact ref`；引用对象必须携带 `artifactId`、`caseId`、`executionMode`、`available`、`location`、`providerTranscript`、`note`，并且 `providerTranscript=false`。
- `location` 只能指向当前 report 内的 transcript artifact（例如 `cases[0].transcript`），不得越级宣称外部 persistence、provider transcript store 或 multi-case aggregate transcript 已存在。
- transcript contract tests 必须作为 runtime contracts 的一部分长期存在，专门守住“有 transcriptRef ≠ 有 provider transcript”“有 transcript artifact ≠ case passed”的诚实边界。
- 当前 transcript 能力仍不得接入 provider transcript、transcript persistence、sandbox enforcement、scoring 或 multi-case orchestration；后续若扩展这些能力，必须以新决策显式放宽，而不是在现有 artifact/ref 语义里偷偷漂移。

## Alternatives Considered

- 继续保持 `transcriptRef=null`、不输出任何 transcript artifact：拒绝。来源计划已完成的目标是为 single-case runtime draft 增加最小 orchestration evidence，让 runtime report 不再只有 skeleton status，而能提供受限 transcript 证据。
- 直接把 transcript artifact 做成真实 provider transcript 或 transcript engine 输出：拒绝。来源计划明确当前仍是 provider-less、draft-only、single-case 边界，不接入真实 provider、transcript persistence 或 provider response capture。
- 让 `transcriptRef` 指向外部持久化地址或跨 report 聚合 transcript：拒绝。已完成 wiring 明确 `refScheme=in-report-draft-artifact-ref`，并把 `location` 限定在当前 report 内。
- 允许 transcript artifact 存在时把 case 状态解释为 `passed` 或执行成功证明：拒绝。已完成合同测试明确 `transcriptRef` 存在时，case status 仍只能是 `dry-run`、`not-executed` 或 `blocked`。
- 把 transcript tests 并入其他默认 validate 链路：拒绝。来源计划明确 transcript honesty tests 只是 runtime contracts 的受限护栏，不进入 `validate` / `validate:all` / `validate:contracts` / `validate:preflight` 默认链路。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-subplan-6-phase-3-transcript-evidence-enrichment.json` | 来源计划记录，提供 transcript contract、wiring、tests 与 retrospective 结论。 |
| `src/skillforge/runtime-transcript-contract.mjs` | provider-less transcript artifact contract 与 `buildRuntimeTranscriptArtifact(...)` 锚点。 |
| `src/skillforge/runtime-runner-contract.mjs` | `buildRuntimeTranscriptArtifactRef(...)`、status taxonomy 与 transcriptRef contract 锚点。 |
| `src/skillforge/runtime-provider-adapter-contract.mjs` | provider adapter seam 的 builtin keys / slot 定义；用于约束 transcript 不能被误读成 provider-backed execution 已实现。 |
| `src/skillforge/runtime-runner.mjs` | transcript stub emission、artifact/ref 生成、provider-backed reserved error slot 与 orchestration events 锚点。 |
| `src/skillforge/runtime-draft-orchestrator.mjs` | `runtimeRun.transcriptArtifact` 暴露锚点。 |
| `src/skillforge/runtime-replay-reporter.mjs` | case 级 transcript 输出与 `normalizeTranscriptRef(...)` 锚点。 |
| `scripts/test-runtime-contracts.mjs` | transcript honesty contract tests 与 `13/13` runtime contracts 验证锚点。 |
| `docs/validator-contract.md` | transcript contract 与 honesty 边界文档同步锚点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | transcript artifact / transcriptRef 协议边界同步锚点。 |
| `docs/roadmap.md` | Phase 3 transcript evidence 当前口径回写锚点。 |
| `docs/phase-3-runtime-draft-cli-plan.md` | 本轮 transcript evidence 子阶段与后续承接说明锚点。 |

## Consequences

- 正向：runtime draft report 不再只有 blocked/dry skeleton，而是具备可检索、可引用的最小 orchestration transcript evidence，后续调试与协议演进锚点更清晰。
- 正向：通过 `in-report draft artifact ref` 固定 transcriptRef 语义，report 消费方可以稳定引用 transcript artifact，而不会误把它当成 provider transcript 地址。
- 正向：把 `providerCall=false`、`transcriptCaptured=false`、`providerTranscript=false` 等信号同时写进 artifact、ref、provider adapter seam 与 tests，形成多层 honesty guardrail，减少后续语义漂移。
- 正向：独立 transcript contract + runtime contract tests 让后续扩展 provider、persistence、scoring 时必须显式修改合同，而不是在模糊字段上偷偷放宽。
- 取舍：当前 transcript 仍然不是模型对话记录，也不能证明真实执行发生；它只证明 runtime orchestration 走到了哪些受限步骤。
- 取舍：由于 `location` 固定在当前 report 内，当前阶段不能复用 transcript 作外部持久化、跨运行聚合或多 case 汇总分析。
- 取舍：后续一旦接入 provider transcript 或 transcript persistence，需要新一轮 ADR 明确如何升级 `executionClass`、`refScheme`、`providerTranscript` 与验证轨道，不能直接复用当前 draft-only 语义。
- 验证锚点：来源完成记录确认 `scripts/test-runtime-contracts.mjs` 已从 `13/13` 扩展到 `16/16 cases`；其中 transcript honesty tests 继续锁定 artifact kind/version/scope/executionClass、`transcriptRef.available/providerTranscript/location/note/artifactId` 对齐，以及“`transcriptRef` 存在但 case status 仍不是 `passed`”的边界；新增 provider seam / CLI visible-mode tests 进一步证明 `provider-backed` 仍未对外开放，且 transcript 不能被误读为 provider execution 证据。

## Search Terms

- `runtime-transcript-artifact`
- `runtime-transcript-artifact-draft-1`
- `provider-less-draft-only`
- `buildRuntimeTranscriptArtifact`
- `buildRuntimeTranscriptArtifactRef`
- `transcriptRef`
- `normalizeTranscriptRef`
- `in-report-draft-artifact-ref`
- `providerTranscript=false`
- `providerCall=false`
- `transcriptCaptured=false`
- `providerResponseCaptured=false`
- `runtimeRun.transcriptArtifact`
- `orchestration evidence`
- `single-case transcript stub`
- `docs/runtime-replay-protocol-lightweight-design.md`
- `docs/phase-3-runtime-draft-cli-plan.md`
