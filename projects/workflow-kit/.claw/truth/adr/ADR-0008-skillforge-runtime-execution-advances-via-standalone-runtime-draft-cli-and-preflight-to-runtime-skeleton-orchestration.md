# ADR-0008: SkillForge runtime execution 先以 standalone runtime draft CLI + preflight→runtime skeleton orchestration 推进

## Status

accepted

## Context

决定先行：在 ADR-0007 已完成 `runtime-replay-report`、`runtime-runner-contract`、`runtime-sandbox-contract` 与 single-case `dry-run` / `null-runner` skeleton 的最小合同闭环之后，Phase 3 的下一段推进不继续优先补 `report enrichment`，也不接入真实 provider，而是先把最小 execution path 做成可落地的 `standalone runtime draft CLI` 与 `preflight→runtime skeleton orchestration`。

来源计划“SkillForge Phase 3 runtime execution kickoff”已完成。计划中的已完成任务与 retrospective 固定了以下事实：

- 只读侦察结论明确：下一份实施型 subplan 最该先做的是 `preflight→runtime skeleton adapter/orchestration`，并以独立 `runtime draft CLI` 作为承载面；相比继续补 report enrichment，这一步更能证明 Phase 3 execution 方向是否成立，同时仍保持 `single fixture`、`single case`、`dry/null`、`无真实 provider`。
- 负责人已锁定下一实施方向为 `runtime draft CLI + preflight→runtime skeleton orchestration`，并形成 `docs/phase-3-runtime-draft-cli-plan.md` 与 `docs/roadmap.md` 中的实施草案。
- 草案要求新增 `runtime-draft-orchestrator.mjs`，并固定任务拆分顺序为：`runtime draft CLI`、`preflight→runtime draft orchestrator`、`runtime draft artifact contract tightening`、`runtime draft contract tests`、`docs sync/roadmap write-back`；验证与提交规划留后续单独子计划。
- 计划同时冻结禁区：不得污染 `static/preflight` 既有 contract 与 fixtures，不得伪造 runtime pass，也不得把 draft CLI 描述成真实 runtime replay 已实现；尤其 `draft CLI` 的 exit code 不应直接绑定 `summary.passed`。

该决策需要沉淀，因为它把“runtime 层如何从合同闭环继续走向更真实 execution proof”的实现策略固定下来：下一步先证明 orchestrated path 存在，但仍坚持 draft-only、skeleton-only、no-provider 的边界，而不是过早把 CLI 成功语义与真实 runtime pass 绑定。

## Decision

决定将 SkillForge Phase 3 在 runtime execution 的下一段推进策略固定为：先实现 `standalone runtime draft CLI`，并用它承载 `preflight→runtime skeleton orchestration` 的最小 existence proof。

当前阶段的具体规则如下：

- 下一份实施型 subplan 的最小执行对象固定为 `runtime draft CLI + preflight→runtime skeleton orchestration`，而不是继续优先做 `report enrichment` 或直接接入真实 provider。
- `runtime draft CLI` 必须作为独立承载面存在，用来暴露从 preflight 产物进入 runtime skeleton 的最小调用路径。
- orchestration 必须通过新增的 `runtime-draft-orchestrator.mjs` 一类独立接缝承接 `preflight→runtime` 串联，而不是把串联逻辑散落进既有 static/preflight contract 层。
- 本阶段仍只允许 `single fixture`、`single case`、`dry/null`、`无真实 provider` 的 execution proof；不得宣称已实现真实 `runtime replay`。
- `draft CLI` 的 exit code 不得直接绑定 `summary.passed`，避免把 draft 路径错误编码为真实执行成功语义。
- artifact contract tightening、runtime draft contract tests 与 docs/roadmap sync 必须作为同一路线的后续原子任务存在，但验证与提交规划应继续留在单独子计划中处理。
- `static/preflight` 既有 contract、fixtures 与 baseline 继续视为禁区；任何新增 execution 路线都不得通过伪造 runtime pass 或改写上游 contract 来“证明成功”。

## Alternatives Considered

- 继续优先补 `report enrichment`：拒绝。来源计划明确认为这一步不如先打通最小 execution path，更难证明 Phase 3 execution 方向是否成立。
- 直接接入真实 provider 或把 draft CLI 包装成真实 runtime replay：拒绝。计划已明确当前阶段仍是 `draft` / `skeleton` proof，不得越过 `no-provider` 边界。
- 把 runtime draft CLI 的成功语义直接绑定 `summary.passed`：拒绝。来源计划明确要求 exit code 不应直接绑定 `summary.passed`，以防把 draft 铺轨误写成真实执行成功。
- 把 orchestration 混入既有 static/preflight contract 改造中一起推进：拒绝。计划已明确禁区是 `static/preflight` 既有 contract 与 fixtures，应通过独立 orchestration 接缝推进。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-subplan-phase-3-runtime-execution-kickoff.json` | 来源计划记录，提供已完成任务、review 与 retrospective 结论。 |
| `docs/phase-3-runtime-draft-cli-plan.md` | 下一实施型 subplan 的实施草案锚点。 |
| `docs/roadmap.md` | 已同步的路线回写锚点。 |
| `runtime-draft-orchestrator.mjs` | 来源计划明确要求新增的 orchestration 接缝锚点。 |
| `runtime draft CLI` | 来源计划固定的独立承载面与最小 execution path 入口。 |

## Consequences

- 正向：Phase 3 的下一步从“runtime skeleton 已闭环”推进到“preflight 可被最小 orchestration 驱动进入 runtime skeleton”，形成更真实但仍受控的 existence proof。
- 正向：以独立 `draft CLI` 与 `runtime-draft-orchestrator.mjs` 承载串联，能把 execution 路线与 static/preflight 既有 contract 解耦，减少基线污染风险。
- 正向：通过禁止 exit code 直接绑定 `summary.passed`，明确区分 draft 铺轨与真实 runtime pass，避免后续语义回归。
- 取舍：当前仍不进入真实 provider、不支持多 case，也不把 draft CLI 视为生产级 runtime replay 入口。
- 取舍：artifact contract tightening、contract tests、docs sync 仍需后续实施型子计划逐步落地，当前 ADR 固定的是推进顺序与边界，不代表这些产物已全部实现。
- 验证锚点：来源完成记录确认本轮已完成侦察、方向锁定与实施型 subplan 草案产出，并明确下一步应进入真正实现型子计划，而不是继续停留在规划层。

## Search Terms

- `runtime draft CLI`
- `preflight→runtime skeleton orchestration`
- `runtime-draft-orchestrator.mjs`
- `summary.passed`
- `single fixture`
- `single case`
- `dry/null`
- `no-provider`
- `report enrichment`
- `docs/phase-3-runtime-draft-cli-plan.md`
- `docs/roadmap.md`
