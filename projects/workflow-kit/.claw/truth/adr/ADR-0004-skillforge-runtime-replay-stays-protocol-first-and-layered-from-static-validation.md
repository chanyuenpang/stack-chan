# ADR-0004: SkillForge runtime replay 先冻结协议，并与 static validation / preflight 分层推进

## Status

accepted

## Context

决定先行：SkillForge 的 `runtime replay` 路线在当前阶段不进入 `runner`、`sandbox`、`model` 或 `transcript` 实现，而是先冻结轻量协议文档，并把后续链路明确拆成 `static validation -> preflight -> runtime replay` 三层。

来源计划“SkillForge Milestone D runtime replay protocol and preflight”已完成。计划中的已完成任务先做只读侦察，确认当前仓库与 `runtime replay / preflight` 最接近的现有资产仍是静态 validator 体系与 `replay-cases.yaml`；真正的 `runtime runner`、`sandbox contract`、`preflight artifact`、`transcript schema` 尚未实现。随后负责人锁定方向：先写 `docs/runtime-replay-protocol-lightweight-design.md`，同步 `docs/roadmap.md`，冻结最小对象为 `replay-cases.yaml`、`preflight result`、`runtime replay report`，并明确本阶段不把 runtime 混进 `validate:all` 或 `validate:contracts`。

这个结论需要沉淀，因为它改变了后续实现约束：推进 `runtime replay` 时，必须先冻结协议文档、artifact schema 与 preflight contract，再决定是否进入最小执行原型；同时不能为了扩张 runtime 能力而破坏现有 static contract baseline，尤其不能直接把 `replay-cases.yaml` 的 `observed` 扩写成复杂对象。

## Decision

决定将 SkillForge 的 `runtime replay` 路线固定为“协议优先、分层推进、静态链路不受污染”的策略。

当前阶段的具体规则如下：

- 先完成 `docs/runtime-replay-protocol-lightweight-design.md` 这类协议冻结文档，再考虑任何执行原型。
- 后续链路必须按 `static validation -> preflight -> runtime replay` 顺序推进，不得跳过 `preflight` 直接建设 runtime 执行链路。
- 当前冻结的最小对象只有 `replay-cases.yaml`、`preflight result`、`runtime replay report`。
- 本阶段不实现 `runner`、`sandbox`、`model`、`transcript`，也不实现完整 `runtime runner` 或 `sandbox contract`。
- 不把 `runtime replay` 混入 `validate:all` 或 `validate:contracts`；现有 static gate 继续保持独立边界。
- `replay-cases.yaml` 作为第一优先 target object，但不能直接把 `observed` 扩写为复杂对象，以免破坏既有 schema / contract baseline。
- 是否进入最小执行原型，必须等 `artifact schema` 与 `preflight contract` 明确后再决策。

## Alternatives Considered

- 直接进入 `runner` / `sandbox` 实现：拒绝。来源计划明确认为当前协议、artifact 与 contract 仍未冻结，贸然实现会放大边界漂移风险。
- 把 `runtime replay` 直接混入 `validate:all` / `validate:contracts`：拒绝。计划已明确 static validation 与 runtime 链路需要分层，避免污染现有 static contract baseline。
- 直接扩写 `replay-cases.yaml` 的 `observed` 为复杂对象：拒绝。只读侦察已明确指出这会打破现有 schema / contract 基线。
- 仅冻结协议，不保留进入原型的接续点：暂不采用。计划已明确后续接续面应落在 `artifact schema` 与 `preflight contract`，为是否进入最小执行原型保留判断门。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-4-milestone-d-runtime-replay-protocol.json` | 来源计划记录，提供 Milestone D 完成态、边界冻结与 retrospective 结论。 |
| `docs/runtime-replay-protocol-lightweight-design.md` | `runtime replay` 协议冻结文档与边界锚点。 |
| `docs/roadmap.md` | 回写分层顺序与后续阶段接续点的路线锚点。 |
| `replay-cases.yaml` | 当前第一优先 target object，也是 static baseline 兼容性约束锚点。 |

## Consequences

- 正向：先冻结协议与对象边界，降低把未实现 runtime 误写成已落地能力的风险。
- 正向：把 `static validation`、`preflight`、`runtime replay` 分层后，后续 `artifact schema` 与 `preflight contract` 有了清晰接续面。
- 正向：保持 `validate:all`、`validate:contracts` 与当前 static validator 体系不受 runtime 试探性设计污染。
- 正向：将 `replay-cases.yaml` 保持为第一优先对象，有助于沿现有最稳定资产渐进扩展。
- 取舍：当前仍未进入 `runner`、`sandbox`、`model`、`transcript` 实现阶段，短期内不会获得真正的 runtime 执行能力。
- 取舍：后续若要进入最小执行原型，必须先补齐 `artifact schema` 与 `preflight contract`，推进速度会慢于直接编码实现。
- 验证锚点：来源完成记录已明确本轮只提交 `docs/runtime-replay-protocol-lightweight-design.md` 与 `docs/roadmap.md`，并说明“未误提 runtime 已落地；src/scripts/fixtures/package.json/.projects 等均未触碰”。

## Search Terms

- `runtime replay protocol lightweight design`
- `static validation -> preflight -> runtime replay`
- `replay-cases.yaml`
- `preflight result`
- `runtime replay report`
- `validate:all`
- `validate:contracts`
- `runner`
- `sandbox contract`
- `transcript schema`
- `observed`
