# ADR-0006: SkillForge Phase 3 preflight 实现保持独立实现包，并对 static baseline 零污染

## Status

accepted

## Context

决定先行：在 ADR-0004 确立 `static validation -> preflight -> runtime replay` 分层、ADR-0005 确立 post-static expansion 继续走 `contract-forward` 之后，Phase 3 的第一段真实实现不直接进入 `runner`、`transcript` 或完整 `runtime replay report`，而是先把 `preflight` 落成一个最小、独立、可验证的实现包。

来源计划“SkillForge Phase 3 runtime replay implementation kickoff”已完成。计划中的已完成任务与 retrospective 固定了以下事实：

- 第一实施子阶段被锁定为“最小 preflight 实现包”，推荐顺序为 `artifact/report -> adapter -> checks/evaluator -> standalone CLI -> standalone contract tests -> docs sync`。
- 最佳接缝固定为 `loadFixture -> normalizeFixture -> preflight -> report`，其中 `normalizeFixture()` 是 preflight 的核心上游输入。
- `preflight report` 产出 `kind=runtime-preflight-result`，并通过 `src/skillforge/preflight-reporter.mjs`、`src/skillforge/preflight-adapter.mjs`、`src/skillforge/preflight-rules.mjs`、`src/skillforge/preflight-validator.mjs` 实现独立账本、adapter、rule set 与 validator。
- `validatePreflight()` 消费 `buildPreflightInput()` 输出，最小 checks 覆盖 `static baseline passed`、`replay cases minimal`、`case identity stable`、`forged runtime result`、`boundary declared`，并增加 `runtime hint/profile tiering` 两条 warning。
- `scripts/validate-preflight.mjs` 与 `package.json` 中的 `validate:preflight` 提供独立 CLI，exit code 语义固定为 `0=pass`、`1=blocking failure`、`2=usage error`。
- `scripts/test-preflight-contracts.mjs` 与 `validate:preflight:contracts` 提供独立 contract tests，覆盖正例 JSON contract、usage error `exit=2`、临时变异负例 `exit=1` 与 `RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL fail`。
- 整个实现过程中，明确禁止触碰 `validator.mjs`、`validate:fixture`、`validate:fixtures`、`validate:all`、`validate:contracts` 的既有 `stdout`、`exit code`、`report shape` 与 `17/51/6/6` static baseline；最终统一验证确认这些 baseline 未受污染。

这个结论需要沉淀，因为它把“如何从 contract-forward 进入第一段真实代码实现”变成了明确规则：`preflight` 必须先以独立实现包落地，继续复用 static 上游输入，但不得回写、污染或重塑既有 static validator 主线。

## Decision

决定将 SkillForge Phase 3 的首段实现策略固定为“独立 preflight 包 + static baseline 零污染”。

当前阶段的具体规则如下：

- `preflight` 必须先作为独立实现包推进，范围先收敛到 `runtime-preflight-result artifact/report`、adapter、rule set、validator、standalone CLI 与 standalone contract tests。
- 上游输入链路固定为 `loadFixture -> normalizeFixture -> preflight -> report`，其中 `normalizeFixture()` 是 preflight 的唯一核心接缝，不另起一套解析链。
- `preflight` 产物固定使用 `kind=runtime-preflight-result`，与既有 static report 保持“同风格但不同形”的独立 contract。
- `validate:preflight` 必须保持独立命令与独立 exit 语义，不接入 `validate:fixture`、`validate:fixtures`、`validate:all` 或 `validate:contracts` 的默认路径。
- `preflight` contract tests 必须独立存在，不修改 `test-validator-contracts.mjs` 或任何 static baseline fixtures / scripts。
- 在 `preflight` 最小包稳定前，不进入 `runner`、`transcript`、完整 `runtime replay report`、`sandbox boundary` 或真实 observed 执行链实现。
- 任何后续 runtime 推进都必须继续满足“不得污染 `17/51/6/6` static baseline、既有 validate:* contract 与 `stdout/report shape`”这一回归约束。

## Alternatives Considered

- 直接进入 `runner` 或真实 runtime 执行链：拒绝。来源计划侦察与 retrospective 都认为当前更稳的第一落点是 `preflight` 独立实现包，而不是越级进入执行层。
- 把 `preflight` 直接并入既有 `validator.mjs` 或 `validate:*` 主链：拒绝。计划明确要求 static 与 preflight 完全分轨，以避免污染既有 `17/51/6/6` baseline 与 contract。
- 为 `preflight` 重新发明输入解析链：拒绝。计划已将 `normalizeFixture()` 固定为核心上游输入边界，应复用现有 static 入口接缝。
- 只实现 artifact / adapter，不补独立 CLI 与 contract tests：暂不采用。来源计划完成态已将 standalone CLI 与 standalone contract tests 视为最小 preflight 包的组成部分。

## Related Code

| Path | Role |
| ---- | ---- |
| `plans/subplan-4-subplan-phase-3-runtime-replay-implementation-kickoff.json` | 来源计划记录，提供 Phase 3 kickoff 完成态、任务 review 与 retrospective 结论。 |
| `src/skillforge/preflight-reporter.mjs` | 产出 `runtime-preflight-result` artifact/report 的独立 reporter。 |
| `src/skillforge/preflight-adapter.mjs` | 复用 `normalizeFixture()` 输入并构建 preflight 输入账本的 adapter。 |
| `src/skillforge/preflight-rules.mjs` | 独立 preflight rule set 与版本锚点。 |
| `src/skillforge/preflight-validator.mjs` | `validatePreflight()` 与最小 checks / warnings 的 validator。 |
| `scripts/validate-preflight.mjs` | 独立 `validate:preflight` CLI 入口与 exit code contract。 |
| `scripts/test-preflight-contracts.mjs` | 独立 `validate:preflight:contracts` contract tests。 |
| `package.json` | `validate:preflight` 与 `validate:preflight:contracts` 命令入口锚点。 |

## Consequences

- 正向：SkillForge 正式从纯 `contract-forward` 文档阶段进入可执行的 `preflight` 代码实现阶段，但仍保持边界克制。
- 正向：通过独立 reporter/adapter/rules/validator/CLI/tests，`preflight` 获得了可演进的最小实现包，而不必把 runtime 逻辑塞进 static validator。
- 正向：固定 `normalizeFixture()` 作为上游输入，保持了 static 链路与 runtime 前置 gate 之间的连续性。
- 正向：独立 CLI 与 contract tests 使 `preflight` 可以单独验证，同时继续保护 `validate:fixture`、`validate:fixtures`、`validate:all`、`validate:contracts` 的稳定性。
- 取舍：当前仍只完成 runtime 前置 gate，尚未进入 `runtime replay report` full impl、`runner interface`、`sandbox boundary` 或真实 transcript/observed 执行链。
- 取舍：后续 runtime 层推进必须继续遵守分轨约束，短期内会比直接修改既有 validator 主线更慢，但回归风险更低。
- 验证锚点：来源完成记录确认 `validate:fixture` 单 fixture `17 checks`、`validate:fixtures totalChecks=51`、`validate:all matrix 6/6`、`validate:contracts passed`，同时 `validate:preflight` 对三个正例 fixture 返回 `kind=runtime-preflight-result` 且 `passed=true`，`validate:preflight:contracts passed`。

## Search Terms

- `runtime-preflight-result`
- `validate:preflight`
- `validate:preflight:contracts`
- `normalizeFixture`
- `validatePreflight`
- `buildPreflightInput`
- `preflight-reporter.mjs`
- `preflight-validator.mjs`
- `17/51/6/6 baseline`
- `static baseline zero pollution`
- `RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL`
