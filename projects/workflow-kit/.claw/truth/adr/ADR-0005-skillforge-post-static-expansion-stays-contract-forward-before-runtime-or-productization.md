# ADR-0005: SkillForge post-static 扩张路线保持 contract-forward，先于 runtime runner 或产品化

## Status

accepted

## Context

决定先行：SkillForge 在完成 static foundation、最小 CI、schema lightweight 与 runtime replay 协议冻结后，post-static 的下一主路线不进入 `runtime runner`、`generator`、`UI` 或其他产品化扩张，而是收敛为 `contract-forward`，优先推进 `artifact schema` 与 `preflight contract`。

来源计划 “SkillForge Owner Master Plan v2” 已完成。计划中的已完成任务与 retrospective 已将以下事实固定下来：

- Milestone A 已固化 `validate:all`、profile passthrough、standard fixture、contract tests 的 static validation foundation。
- Milestone B 已把 `validate:all` 与 `validate:contracts` 接入最小 CI gate。
- Milestone C 已明确 schema engine 保持 lightweight，并新增面向 `manifest/replay-cases` 的最小 schema gate。
- Milestone D 已冻结 `static validation -> preflight -> runtime replay` 三层边界，并把最小对象收敛到 `replay-cases.yaml`、`preflight result`、`runtime replay report`。
- Milestone E 决策阶段进一步明确：后续主路线应优先承接 `artifact schema / preflight contract`，而不是直接做 runtime 执行器或 generator/UI 产品化。

这个结论需要沉淀，因为它改变了后续实现约束：当 static 主线已稳定、runtime 仍未实现时，项目应先把协议、artifact 与 preflight contract 做实，形成可以验证与演进的中间层，而不是直接跳进执行链路或面向终端用户的产品层，避免在边界未稳时把 scope 扩大到高维护成本区域。

## Decision

决定将 SkillForge 的 post-static expansion 主路线固定为 `contract-forward`。

当前阶段的具体规则如下：

- 下一阶段优先实现 `artifact schema` 与 `preflight contract` 的最小可验证版本。
- 在 `artifact schema` 与 `preflight contract` 未落地前，不进入 `runtime runner`、`sandbox`、`model execution` 等 runtime 执行实现。
- 在同样前提下，不把主路线切到 `generator`、`UI` 或其他产品化能力。
- `runtime replay` 相关推进仍应承接既有 `static validation -> preflight -> runtime replay` 分层顺序，其中 `preflight` 是必须先补齐的中间契约层。
- 后续若创建新的主计划或子计划，范围应聚焦 `artifact schema / preflight contract` 的最小实现与验证，而不是重新发散到 runtime 或产品化方向。

## Alternatives Considered

- 直接进入 `runtime runner`：拒绝。来源计划明确认为 runtime 边界尚停留在协议/对象冻结阶段，先补 `artifact schema` 与 `preflight contract` 更稳。
- 直接推进 `generator` / `UI` 产品化路线：拒绝。当前核心问题仍是 contract 与 artifact 边界未实现，过早产品化会扩大范围并掩盖基础契约空缺。
- 维持仅文档化、不继续收敛下一阶段入口：拒绝。来源计划 retrospective 已明确指出，如继续推进，应新建后续计划并聚焦 `artifact schema / preflight contract` 的最小实现与验证。

## Related Code

| Path | Role |
| ---- | ---- |
| `plan.json` | 来源主计划记录，提供 Milestone A-E 完成态、retrospective 与路线收敛结论。 |
| `docs/roadmap.md` | 当前 SkillForge 路线图与 post-static 阶段承接点。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | 已冻结的 runtime replay / preflight 分层边界锚点。 |
| `docs/preflight-contract-and-artifacts-design.md` | `artifact schema` 与 `preflight contract` 的设计草案锚点。 |

## Consequences

- 正向：把 post-static 路线收敛到 `artifact schema` 与 `preflight contract`，能沿既有协议冻结成果继续推进，而不是重开一条更重的 runtime 或产品化支线。
- 正向：先做 contract / artifact 中间层，有助于后续 runtime replay 是否进入最小执行原型时保持边界清晰、验证可持续。
- 正向：避免把尚未落地的 runtime 能力或 generator/UI 误写成下一阶段默认方向，降低 roadmap 漂移与范围失控风险。
- 取舍：短期内不会直接获得 `runtime runner`、`generator`、`UI` 等更显性的可见能力。
- 取舍：`contract-forward` 仍停留在设计承接点，后续必须通过新计划把 `artifact schema / preflight contract` 真正实现出来。
- 验证锚点：来源计划 retrospective 明确写出“最终主路线明确为 contract-forward，后续如继续推进，应从 artifact schema / preflight contract 实现阶段进入，而非直接做 runtime runner 或 generator/UI”；Milestone E review 同时记录“主路线收敛为 contract-forward，优先 artifact schema / preflight contract，而非 runtime runner 或 generator/UI”。

## Search Terms

- `contract-forward`
- `artifact schema`
- `preflight contract`
- `post-static expansion`
- `runtime runner`
- `generator`
- `UI`
- `static validation -> preflight -> runtime replay`
- `docs/preflight-contract-and-artifacts-design.md`
