# ADR: 开发流程归档、验证与 bisect 统一约束

## Status

accepted

## Context

决定：stack-chan 的开发流程需要统一为“可追溯、可复现、可回退”的闭环，重点补齐固件归档回溯、OTA 发布与真机验证、回归 bisect 三类缺口。原因是最近一轮真实开发/回退/验证中，反复暴露出同一组效率问题：历史 candidate 缺少元数据，版本号被过早当成结论主键，`ready/idle` 被过早当成语音恢复证据，导致回退、验证和定位都不够稳定。

## Decision

后续开发与回归定位必须遵守以下统一约束：

1. **固件归档必须带可回溯主键**
   - candidate 固件要绑定 `commit SHA`、版本号、用途、验证结论等元数据。
   - 版本号只能用于定边界，`commit SHA` 才是 bisect 与回归结论主键。

2. **OTA 发布与真机验证必须形成标准闭环**
   - 发布前要有明确检查项。
   - 仅凭版本号命中或 `ready/idle` 不能过早判定语音恢复成立。
   - 必须同时观察 OTA 成功、真机可用态、以及独立的验证证据。

3. **回归定位必须按 bisect 方式推进**
   - 从用户反馈到提交级定位，优先按版本与代码态分离的方式推进。
   - 目标是用最少轮次把“版本变化”和“代码变化”区分清楚。

4. **回退和验证必须保留一致的证据模板**
   - 后续流程方案要把归档索引、验证结论、回退动作和 bisect 记录统一沉淀，便于复查和复现。

## Alternatives Considered

- 继续沿用只看版本号和 `ready/idle` 的简化判定：被拒绝。真实复盘证明这会过早收敛，掩盖设备尚未真正恢复的问题。
- 把回退、验证、定位拆成互不关联的临时步骤：被拒绝。这样无法形成统一的追溯主键和证据模板，后续仍会重复踩坑。
- 只补工具脚本，不补流程规范：被拒绝。单点工具修补不能解决“判定口径不统一”的根因。

## Related Code

| Path | Role |
| ---- | ---- |
| `ops/bin/stackchan-ota-release` | OTA 发布与回退入口，要求按统一闭环执行。 |
| `ops/bin/stackchan-doctor` | 发布后的一致性校验锚点。 |
| `ops/ota/active.json` | 发布元数据与回溯锚点。 |
| `exp-pkg/active-release` | 当前活跃发布入口。 |
| `plans/subplan-6-plan.json` | 本次流程重整的来源计划。 |

## Consequences

- 正向效果：后续 candidate 可以按 `commit SHA`、版本号、用途和验证结论快速回溯，回归定位更稳。
- 正向效果：OTA 发布、真机验收和回退判定不再依赖单一信号，能减少误判。
- 约束：历史 candidate 若缺少元数据，需要补录后才能完全发挥新规范价值。
- 风险：流程口径更严格，短期会增加记录和验证成本，但可以换来后续定位效率。
- 验证锚点：本次复盘明确了“无可追溯构建不进入验证；无 OTA+真机双通道验证不判定修复成立”。

## Search Terms

- `commit SHA`
- `candidate`
- `ops/bin/stackchan-ota-release`
- `ops/bin/stackchan-doctor`
- `ready/idle`
- `state=upgrading`
- `xiaozhi_ready=true`
- `bisect`
- `force=1`
- `force=0`
