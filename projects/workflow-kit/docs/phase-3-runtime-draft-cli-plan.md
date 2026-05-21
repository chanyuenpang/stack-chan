# Phase 3 下一实施子计划草案：runtime draft CLI + preflight→runtime skeleton orchestration

> 状态：设计草案（implementation subplan draft，仓库内对应 runtime draft CLI 子计划已落到当前受限实现）  
> 目的：为下一份 Phase 3 实施型 subplan 提供可直接拆分的原子任务、文件边界、禁区、非目标与最小验收口径。  
> 重要边界：本文**不是完整 runtime 实现交付说明**；当前已落地的也只是独立 runtime draft CLI、provider adapter seam、受限 orchestration 与 provider-less transcript evidence 的草案级表达，不代表真实 runtime replay、provider integration、provider transcript、transcript engine / persistence、sandbox enforcement、multi-case orchestration、CI runtime gate 已实现。

## 1. 背景与定位

当前 Phase 3 已完成的基础包括：

- preflight artifact / adapter / validator / standalone CLI / contract tests；
- runtime replay report skeleton；
- runner contract；
- sandbox boundary contract；
- single-case selector；
- single-case dry/null runner skeleton；
- standalone runtime contract tests；
- 独立 runtime draft CLI；
- preflight→single-case dry/null runtime skeleton orchestration wiring；
- provider adapter seam 的 contract-first 接缝。

因此，下一份实施型 subplan 不应再重复做“contract skeleton 本身”，而应进入一个更窄的实施面；而当前仓库里已经完成的，也正是下面这条受限实施面：

```text
runtime draft CLI
+ preflight -> provider adapter seam -> runtime skeleton orchestration wiring
```

这一步的目标不是“让真实 runtime 跑起来”，而是把已经存在的 preflight / runtime skeleton / provider adapter seam 零件接成一个**独立、诚实、单 case、草案级**执行入口，并允许在 report 内有限表达 provider-less transcript evidence，作为后续 provider / transcript / sandbox enforcement 实装前的承载面。

当前还要额外钉死一个容易被误读的边界：observed mapping seam 只是 truth mapping 通道。它把单一 adapter result 归一化到 `cases[].observed`、`providerExecution`、`transcriptAvailability` 这三个同源槽位，但这不代表真实 provider execution、provider transcript、transcript persistence 或 scoring 已完成。

一句话版：

```text
先把 runtime 草案入口和 orchestration 接起来，
让系统能诚实地走通 preflight -> select case -> dry/null runtime skeleton -> draft report 这条链，
但绝不伪装成真实 runtime replay 已落地。
```

## 2. 本子计划要回答什么

下一份实施型 subplan 至少要稳定回答以下问题：

1. 怎样提供一个独立 `runtime draft CLI`，与 static / preflight CLI 家族隔离？
2. 怎样把 `validatePreflight()`、case selector、provider adapter seam、runner contract、sandbox contract、dry/null runner skeleton 串成单一 orchestration 路径？
3. 这个 orchestration 具体读哪些输入、产出哪些 artifact、如何表达 blocked / error / dry-run / not-executed，以及 provider-less transcript evidence？特别是：如何保证 provider-backed reserved slot 相关字段继续保持 `false/null/reserved`，并把 preflight 未通过更诚实地收口为 `blocked`？
4. 哪些 contract 是禁区，不能被顺手改坏？
5. 哪些内容继续明确延后，防止把“草案 CLI”写成“runtime 已实现”？

## 3. 子计划定位

本子计划是 **Phase 3 runtime execution kickoff** 的下一实施步，但范围必须压缩为：

```text
独立 runtime draft CLI
  -> load fixture
  -> static validate（只作为上游事实，不改 static contract）
  -> preflight
  -> select single case
  -> build provider adapter seam inputs
  -> build sandbox boundary contract
  -> run dry/null runtime skeleton
  -> print runtime draft report
```

它是 **orchestration wiring 子计划**，不是 provider-backed execution 子计划，也不是 transcript 子计划，更不是 sandbox enforcement 子计划。provider adapter seam 在这里也只是 contract-first 接缝，不代表 provider-backed mode 可用。

## 4. 建议的实施子计划结构

建议拆成 **5 个原子任务 + 1 个收尾任务**，不要揉成一个“大一统 runtime 实现”。

---

### Task 1：runtime draft CLI 入口

**目标**

新增独立脚本入口，例如：

- `scripts/run-runtime-draft.mjs`
- `package.json` 新增 `validate:runtime:draft`

该 CLI 负责承载整个 draft orchestration，但仍然只支持：

- 单 fixture
- 单 case
- dry/null mode
- JSON artifact 输出

**建议修改文件**

- 新增：`scripts/run-runtime-draft.mjs`
- 小改：`package.json`（只新增 script）
- 可补文档：`docs/validator-contract.md`

**不要改的文件**

- `scripts/validate-fixture.mjs`
- `scripts/validate-fixtures.mjs`
- `scripts/validate-all.mjs`
- `scripts/validate-preflight.mjs`
- `scripts/test-validator-contracts.mjs`
- `scripts/test-preflight-contracts.mjs`
- `scripts/test-runtime-contracts.mjs`（除非 Task 4 明确需要补充断言）

**CLI 最小合同建议**

输入：

- `<fixture-path>` 必填
- `--case-id <id>` 可选
- `--case-index <n>` 可选
- `--mode dry-run|null-runner`，默认 `dry-run`
- provider-backed mode 当前不暴露为 CLI flag；对应 slot 仅保留为 reserved/unimplemented
- `--format json`，当前唯一支持
- `--help` / `-h`

输出：

- stdout：一个 `runtime-replay-report` draft artifact
- stderr：仅 CLI usage error 或意外异常简讯

退出码建议：

- `0`：CLI 成功完成 orchestration，并生成 draft runtime artifact；**即使 summary.passed=false 也可保持 0，只要不是 CLI/脚本错误**
- 当前 case status 的诚实结果以 `blocked | dry-run | not-executed` 为主；若出现 `error`，也只表示 orchestration/runtime skeleton 错误位，不表示 provider execution
- `1`：runtime draft orchestration 自身异常或 fallback error artifact
- `2`：CLI usage error

> 这里建议特意不要复用 preflight 的 `summary.passed ? 0 : 1` 语义。因为 runtime draft 里 `blocked / dry-run / not-executed` 都是预期诚实结果，不应被等同为 CLI 失败。

**最小验收口径**

- 独立 CLI 存在；
- 只输出 runtime draft artifact，不串改 static/preflight 输出；
- 支持单 case 选择；
- exit code 语义与 static/preflight CLI 区分清楚；
- 文档明确“CLI 成功 ≠ runtime passed”。

---

### Task 2：preflight→runtime skeleton orchestration wiring

**目标**

新增一个 orchestration 层，把现有模块接成稳定顺序：

1. `loadFixture()`
2. `validateFixture()`
3. `validatePreflight()`
4. `selectRuntimeCase()`
5. `buildRuntimeSandboxBoundaryFromSources()`
6. `runRuntimeCaseSkeleton()`
7. 输出 `runtime-replay-report`

建议新增一个显式 orchestration 模块，而不是把脚本写成一坨。

**建议修改文件**

- 新增：`src/skillforge/runtime-draft-orchestrator.mjs`
- 可小改：
  - `src/skillforge/runtime-runner.mjs`
  - `src/skillforge/runtime-case-selector.mjs`
  - `src/skillforge/runtime-runner-contract.mjs`
  - `src/skillforge/runtime-sandbox-contract.mjs`

**不要改的文件**

- `src/skillforge/validator.mjs`
- `src/skillforge/preflight-validator.mjs` 的已有 pass/fail 语义
- `src/skillforge/preflight-reporter.mjs`
- `src/skillforge/reporter.mjs` 的 static report 语义

**任务边界**

只做 orchestration 接线：

- 允许把 preflight fail 映射为 runtime `blocked`；不要继续暴露带执行暗示的 `preflight-failed` 运行态标签；
- 允许 dry/null mode 产出 `dry-run` / `not-executed`；
- 允许保留 runtime skeleton/internal failure 的 `error` slot，但不能把它写成 provider execution；
- 允许把 preflight / static lineage 写入 runtime artifact metadata；
- 允许在 report 内表达 provider-less draft transcript evidence 或 transcriptRef；
- 允许 provider adapter seam 作为中间 contract 层接线；
- 不引入 provider call；
- 不暴露 provider-backed mode；
- 不做 transcript persistence；
- 不做 provider transcript；
- 不做多 case loop；
- 不做 artifact 落盘目录规范化。

**最小验收口径**

- orchestration 顺序清晰且模块化；
- blocked / dry-run / not-executed 三种语义不混淆；
- runtime artifact metadata 能追溯到 static/preflight；
- 没有复制第二套 fixture 解析链。

---

### Task 3：runtime draft artifact contract 收敛

**目标**

让 runtime draft CLI 产出的 artifact contract 稳定到“足够让后续 provider 子计划接着干”，但不扩成 full runtime report system。

**建议修改文件**

- 小改：`src/skillforge/runtime-replay-reporter.mjs`
- 可小改：`src/skillforge/runtime-runner.mjs`
- 可同步文档：
  - `docs/runtime-replay-protocol-lightweight-design.md`
  - `docs/validator-contract.md`

**建议收敛的重点字段**

顶层：

- `kind`
- `reportVersion`
- `protocolVersion`
- `fixture`
- `status`
- `summary`
- `cases`
- `checks`
- `errors`
- `metadata`
- `pendingCapabilities`

其中这一步最关键的是把以下语义说死：

- `summary.passed` 在 draft mode 下通常应为 `false`，在当前可达路径中应固定保持 `false`；
- `cases[].status` 当前合同只应落在 `blocked | error | dry-run | not-executed`；其中面向用户的正常诚实结果仍以 `blocked | dry-run | not-executed` 为主，`error` 只是 reserved runtime skeleton/orchestration error slot；preflight 未通过时应收口为 `blocked`；
- `observed` 是 skeleton stub-shaped truth mapping output，不是 provider transcript evidence，也不是 scoring result；
- `cases[].observed`、`providerExecution`、`transcriptAvailability` 必须明确是 observed mapping seam 的同源视图，共用一条 truth channel，不能各自夸大成独立 provider/runtime capability；
- `transcriptRef` 若出现，只能表示 in-report draft transcript artifact ref；
- `providerTranscript=false` 必须保持显式；
- provider-backed mode slot 必须继续保持 reserved/unimplemented，且 CLI 不暴露该模式；
- provider-backed reserved-slot 字段必须继续保持诚实占位：provider execution metadata、provider evidence flags、transcript handles、persistence state 等都不能提前写成已接通；
- `metadata.note` 必须继续明说“no provider call / no provider transcript / no transcript persistence / no scoring”。

**不要改的文件**

- static report / preflight report contract 文件及其语义

**最小验收口径**

- runtime draft artifact 能稳定表达 lineage、当前 mode 与 provider-less transcript evidence 边界；
- 不伪造 `passed`；
- 不伪造 provider transcript / persistence / observed execution evidence；
- 下游能分辨“CLI 成功生成 artifact”和“runtime 真实通过”是两回事。

---

### Task 4：runtime draft contract tests

**目标**

给 runtime draft CLI + orchestration 新增一套独立 contract tests，覆盖 CLI 合同和 orchestration 诚实性边界。

**建议修改文件**

- 小改或新增：`scripts/test-runtime-contracts.mjs`
- 小改：`package.json`（若要新增如 `validate:runtime:draft:contracts`，也只新增，不改旧 script）
- 可补：`docs/validator-contract.md`

**最小覆盖建议**

1. runtime draft CLI 正例：能输出 `runtime-replay-report`；
2. 默认 mode 为 `dry-run`；
3. preflight passed 时，case status 仍非 `passed`；
4. preflight failed 时，case status 为 `blocked`；
5. `--case-id` / `--case-index` 选择稳定；
6. CLI usage error 返回 `2`；
7. unsupported mode 返回 `2` 或稳定失败；
8. 不断言 `generatedAt`；
9. 不接入 `validate:contracts`、`validate:preflight:contracts` 默认链路。

**不要改的文件**

- `scripts/test-validator-contracts.mjs`
- `scripts/test-preflight-contracts.mjs`

**最小验收口径**

- runtime draft tests 独立可运行；
- static/preflight baseline 完全不受影响；
- 能锁住“dry/null/blocked 不等于 runtime pass”这条诚实边界。

---

### Task 5：文档回写与 contract 说明同步

**目标**

把 runtime draft CLI 与 orchestration 的已实现边界、禁区、非目标回写到文档。

**建议修改文件**

- `docs/validator-contract.md`
- `docs/runtime-replay-protocol-lightweight-design.md`
- `docs/roadmap.md`
- `docs/phase-3-runtime-report-runner-plan.md`
- 本文：`docs/phase-3-runtime-draft-cli-plan.md`

**任务边界**

只回写这些事实：

- runtime draft CLI 是独立草案入口；
- 其 orchestration 只覆盖 preflight→single-case selection→provider adapter seam→dry/null runtime skeleton，并允许有限的 provider-less transcript evidence 表达；
- provider adapter seam 当前只是 contract-first 接缝；CLI 仍不暴露 provider-backed mode；
- provider / provider transcript / transcript persistence / sandbox enforcement / multi-case aggregate 仍未实现；
- runtime draft 不接入 `validate:all` / `validate:contracts` / `validate:preflight` 默认路径。
- `cases[].observed` / `providerExecution` / `transcriptAvailability` 当前虽然同源，但只能回写为 truth mapping seam 已打通，不能回写成 provider integration / transcript persistence / scoring 已完成。
- `docs/phase-3-provider-backed-slot-contract-checklist.md` 只作为 implementation-prep checklist 引用，不得被写成 provider integration 已完成证据。

**最小验收口径**

- 文档口径一致；
- 不夸大为真实 runtime replay 已实现；
- 不把 draft CLI 写成正式 gate。

---

### Task 6：收尾任务（验证/提交留给后续子计划）

**目标**

这一任务不在本实施子计划内落地实现，只作为后续 planning 占位：

- 验证运行
- 基线更新
- 提交/合并

**原因**

当前这份子计划应专注 orchestration 接线本身，不把“实现 + 全验证 + 提交”混成一个复合任务。

## 5. 每个任务分别改哪些文件 / 不要改哪些文件

## 5.1 建议改动文件清单

**新增文件候选**

- `scripts/run-runtime-draft.mjs`
- `src/skillforge/runtime-draft-orchestrator.mjs`
- `projects/workflow-kit/docs/phase-3-runtime-draft-cli-plan.md`

**可小改文件候选**

- `src/skillforge/runtime-replay-reporter.mjs`
- `src/skillforge/runtime-runner.mjs`
- `src/skillforge/runtime-case-selector.mjs`
- `src/skillforge/runtime-runner-contract.mjs`
- `src/skillforge/runtime-sandbox-contract.mjs`
- `scripts/test-runtime-contracts.mjs`
- `package.json`（仅新增 script）
- `docs/roadmap.md`
- `docs/runtime-replay-protocol-lightweight-design.md`
- `docs/validator-contract.md`
- `docs/phase-3-runtime-report-runner-plan.md`

## 5.2 明确禁改文件 / 区域

### A. static contract 禁区

- `scripts/validate-fixture.mjs`
- `scripts/validate-fixtures.mjs`
- `scripts/validate-all.mjs`
- `scripts/test-validator-contracts.mjs`
- `src/skillforge/validator.mjs`
- `src/skillforge/reporter.mjs` 的 static report 语义
- `docs/static-mvp-validation-report.md` 现有 static baseline 数字

### B. preflight contract 禁区

- `scripts/validate-preflight.mjs` 既有 exit 语义
- `scripts/test-preflight-contracts.mjs` 既有 contract baseline
- `src/skillforge/preflight-reporter.mjs` 的 artifact kind / summary 语义
- `src/skillforge/preflight-validator.mjs` 中“preflight pass ≠ runtime pass”的边界

### C. runtime contract 当前禁区

- 不把 `validate:runtime:contracts` 混进 `validate:contracts`
- 不把 runtime draft CLI 混进 `validate:preflight`
- 不把 runtime draft 结果写回 fixture baseline 文件

### D. fixture / data 禁区

- `fixtures/**`
- 任意 `replay-cases.yaml`
- 任意 `validation-result.yaml`
- fixture profile / manifest baseline

## 6. 最小验收口径

下一份实施型 subplan 的最小验收，建议限定为：

1. 存在独立 runtime draft CLI；
2. 存在显式 preflight→runtime skeleton orchestration 模块或等价清晰分层；
3. 单 case 选择、sandbox contract 构建、runner skeleton 调用能走通同一条 draft 链路；
4. runtime draft artifact contract 稳定且诚实；
5. 存在独立 runtime draft contract tests；
6. static / preflight / current runtime contract baseline 不变；
7. 文档明确这仍然不是 provider-backed runtime replay。

## 7. 哪些 static / preflight / current runtime contract 还是禁区

### 7.1 static 禁区

不得改变以下命令的默认意义、输出契约或基线数字：

- `pnpm validate`
- `pnpm validate:fixture`
- `pnpm validate:fixtures`
- `pnpm validate:fixture:matrix`
- `pnpm validate:all`
- `pnpm validate:contracts`

不得改变以下 baseline 语义：

- static single fixture `summary.total = 17`
- static multi-fixture `summary.totalChecks = 51`
- matrix `6/6 cases`
- static `checks[]` 仍然只表示 static rules

### 7.2 preflight 禁区

不得改变：

- `pnpm validate:preflight`
- `pnpm validate:preflight:contracts`
- preflight `summary.totalChecks` 只统计 preflight checks
- preflight pass 只表示 runtime-ready gate passed

### 7.3 current runtime contract 禁区

不得改变当前 runtime skeleton 的诚实性边界：

- `dry-run` / `null-runner` 不得产出 `passed`
- `blocked` 不得伪装成执行失败 taxonomy 的最终形态
- `observed` 不得伪装成 transcript evidence
- `metadata.note` / `pendingCapabilities` 不得删掉尚未实现的提醒

## 8. 明确留到后续子计划再做的内容

以下内容必须继续延后：

### 8.1 真实 provider / transcript / scoring

- model/provider integration
- transcript capture / transcript sink / artifact writer
- observed output persistence
- scoring/rubric engine
- runtime failure taxonomy 完整扩展

### 8.2 sandbox enforcement

- sandbox implementation
- tool execution adapter
- OS-level isolation
- allowlist/denylist enforcement engine
- side-effect audit log

### 8.3 orchestration 扩展

- multi-case batch orchestration
- multi-fixture runtime aggregate
- parallel runner pool
- retry / flake handling
- runtime artifact 持久化目录布局

### 8.4 gate / CI / matrix

- 接入 `validate:all`
- 接入 `validate:contracts`
- 接入 `validate:preflight`
- GitHub Actions runtime gate
- cross-platform runtime matrix
- cross-model runtime matrix

### 8.5 产品化方向

- workflow -> skill generator
- registry / publish
- UI
- acceptance automation

## 9. 风险与注意事项

### 9.1 最大风险：把 draft CLI 写成“runtime 已有入口”

有了 CLI，人最容易脑补“那 runtime 应该差不多好了”。这正是要防的。

必须把边界钉死：

- 它是 draft CLI；
- 它只编排 skeleton；
- 它不调用 provider；
- 它不产生 transcript evidence；
- 它不证明 runtime pass。

### 9.2 最大结构风险：把 orchestration 逻辑塞进脚本

如果把全部 orchestration 都堆在 `scripts/run-runtime-draft.mjs`，后续 provider 子计划会很难复用。

建议脚本只做：

- 参数解析
- 调 orchestrator
- 打印 artifact
- 处理退出码

逻辑本体放进 `src/skillforge/runtime-draft-orchestrator.mjs`。

### 9.3 最大兼容风险：误伤三层 contract

这一步最怕的是顺手把：

- static contract
- preflight contract
- current runtime skeleton contract

三层之一带偏。

所以要坚持：**新增入口、复用既有合同、不要反向重写已有语义。**

### 9.4 exit code 语义要先写清楚

runtime draft CLI 如果沿用 preflight 的 pass/fail exit 语义，会制造误导：

- `dry-run` 不是脚本失败；
- `blocked` 也不是 CLI usage error；
- 这些都是诚实结果。

因此建议 runtime draft CLI 的退出码以“脚本是否成功完成 orchestration”为主，而不是以 `summary.passed` 为主。

## 10. 可直接复用的 task 列表草案

1. **T1 - runtime draft CLI**  
   新增独立 CLI 入口与 package script，支持单 fixture / 单 case / dry-null mode。

2. **T2 - preflight→runtime draft orchestrator**  
   新增 orchestration 模块，串联 static validate、preflight、case selector、sandbox contract、runner skeleton、runtime report。

3. **T3 - runtime draft artifact contract tightening**  
   收敛 runtime draft report 的字段与状态语义，明确 blocked/dry-run/not-executed 边界。

4. **T4 - runtime draft contract tests**  
   为 CLI 与 orchestration 新增独立 contract tests，不接入 static/preflight 默认 contract suite。

5. **T5 - docs sync / roadmap write-back**  
   同步 validator/runtime protocol/runtime runner plan/roadmap 文档口径。

6. **T6 - follow-up validation & commit planning（后续）**  
   验证与提交单独留给下一步，不混入本实施子计划。

## 11. 结论

Phase 3 这一份 runtime draft CLI 子计划目前已经把最小承载面铺出来了，但它的含义仍然必须被钉死：不是继续补 contract 之前的空白都没动，也不是已经直接接上 provider，而是只完成了下面这条受限草案链路：

```text
runtime draft CLI
+ preflight -> runtime skeleton orchestration wiring
```

这一步完成后，仓库得到的是一个诚实、独立、单 case、草案级的 runtime 承载面：

- 能把已有 preflight / runner skeleton 真正接起来；
- 只覆盖 preflight→single-case dry/null runtime skeleton；
- 能输出可分析的 runtime draft artifact；
- 不污染 static / preflight baseline；
- 也不给“runtime 已实现”制造幻觉。

仍然明确留给后续子计划的内容包括：provider、transcript、sandbox enforcement、multi-case orchestration、统一 validation family 接入、CI/runtime gate 与提交发布动作。

说白了，这一步是在铺轨，不是在发车。先把轨道接顺，后面真接 provider 时才不会翻车。