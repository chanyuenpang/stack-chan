# ADR-0005: SkillForge post-static expansion 继续采用 contract-forward，先冻结 artifact / preflight 边界，再决定是否进入 runtime runner

## Status

accepted

## Context

决定先行：在 `static` 主线、`CI` 最小门禁、`schema lightweight` 与 `runtime replay protocol` 边界已冻结后，SkillForge 的 post-static expansion 下一步不直接进入 `runtime runner` 原型，也不提前转向 `generator/UI`，而是继续采用 `contract-forward` 路线，先冻结 `artifact schema` 与 `preflight contract`。

来源计划“SkillForge Milestone E post-static expansion decisions”已完成。计划中的已完成任务先做只读侦察，结论明确指出：当前仓库最自然的接缝仍是现有 `normalizeFixture`、schema gate、validator/report contract，以及已冻结的 `runtime replay` 协议草案；因此最合理的下一条主推进路线是更窄的 `artifact schema / preflight contract` 子计划，而不是直接做 `runtime runner`，也不是提前进入 `generator/UI`。

随后负责人锁定方向为 `contract-forward`，新增 `docs/preflight-contract-and-artifacts-design.md` 并同步 `docs/roadmap.md`，明确三类对象边界为 `replay-cases.yaml`、`runtime-preflight-result`、`runtime-replay-report`；同时冻结 `preflight result` 与 `runtime replay report` 的最小 shape 候选，并把 `normalizeFixture` 明确为 preflight 的上游输入边界。计划还明确写清本阶段不做 `runner`、`model`、`sandbox`、`transcript`、`CI runtime integration`、`generator`、`UI`。

这个结论需要沉淀，因为它进一步收紧了 ADR-0004 的后续实现约束：`runtime replay` 在协议优先之外，还必须先完成 artifact/preflight contract 的边界冻结，才能决定是否进入执行层；同时 post-static expansion 的首要目标不是扩张 capability，而是先把对象面与前置 contract 固化。

## Decision

决定将 SkillForge 的 post-static expansion 路线固定为“`contract-forward` 优先于 `capability-forward`”。

当前阶段的具体规则如下：

- 下一主推进方向固定为 `artifact schema / preflight contract`，而不是直接实现 `runtime runner`。
- 三类核心对象边界先按 `replay-cases.yaml`、`runtime-preflight-result`、`runtime-replay-report` 冻结。
- `preflight result` 与 `runtime replay report` 先冻结最小 shape 候选，再决定是否进入执行原型。
- `normalizeFixture` 被固定为 preflight 的上游输入边界，后续 preflight contract 需要围绕这条输入链路收敛，而不是绕开既有 static 入口另起一套输入面。
- 当前阶段明确不做 `runner`、`model`、`sandbox`、`transcript`、`CI runtime integration`、`generator`、`UI`。
- 是否进入最小 runtime 执行原型，必须等 `artifact schema` 与 `preflight contract` 进一步明确后再决策。

## Alternatives Considered

- 直接进入 `runtime runner`：拒绝。来源计划已明确当前最稳定的接缝仍是 `normalizeFixture`、schema gate 与 report contract，先做 runner 会把未冻结边界过早拉进执行层。
- 直接把 runtime 接入 `validate:all` / `CI`：拒绝。计划记录明确本阶段不做 `CI runtime integration`，避免污染现有 static-only gate。
- 提前进入 `generator/UI`：拒绝。来源计划明确这不是当前最合理的主推进方向，应等 contract 面稳定后再判断。
- 继续停留在纯文档冻结，不进入 artifact/preflight contract 子计划：暂不采用。计划复盘已给出清晰 follow-up，应以 `artifact schema / preflight contract` 作为下一接续面，而不只是维持抽象冻结状态。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-5-subplan-5-milestone-e-post-static-expansion.json` | 来源计划记录，提供 Milestone E 完成态、路线收敛与 retrospective 结论。 |
| `docs/preflight-contract-and-artifacts-design.md` | `contract-forward` 设计草案与三类对象边界锚点。 |
| `docs/roadmap.md` | 回写 post-static expansion 下一步顺序与后续子计划接续点。 |
| `replay-cases.yaml` | 当前已冻结的源对象边界之一。 |
| `normalizeFixture` | preflight 上游输入边界锚点。 |
| `runtime-preflight-result` | 待冻结最小 shape 的目标 artifact 名称。 |
| `runtime-replay-report` | 待冻结最小 shape 的目标 artifact 名称。 |

## Consequences

- 正向：把 post-static expansion 收敛到更小的 contract 面，避免在 `runtime replay` 尚未落稳时过早进入执行能力建设。
- 正向：三类对象边界被单独拆开后，后续 `artifact schema`、`preflight contract` 与最小原型的依赖关系更清晰。
- 正向：把 `normalizeFixture` 固定为 preflight 上游输入，有助于保持 static 链路与后续 runtime 入口之间的连续性。
- 正向：明确排除 `runner`、`model`、`sandbox`、`generator/UI` 与 `CI runtime integration`，降低路线漂移和文档夸大风险。
- 取舍：当前仍只有设计草案与 contract 边界冻结，尚未进入 `artifact schema / preflight contract` 的实现或验证阶段。
- 取舍：短期内不会获得真正的 runtime 执行能力，也不会推进面向使用者的 `generator/UI` 能力。
- 验证锚点：来源完成记录已明确本轮只提交 `docs/preflight-contract-and-artifacts-design.md` 与 `docs/roadmap.md`，并说明“仍是设计草案与 contract-forward 口径，未误提 preflight/runtime 已实现；src/scripts/fixtures/package.json/.projects 等均未触碰”。

## Search Terms

- `contract-forward`
- `artifact schema`
- `preflight contract`
- `replay-cases.yaml`
- `runtime-preflight-result`
- `runtime-replay-report`
- `normalizeFixture`
- `runtime runner`
- `CI runtime integration`
- `generator/UI`
