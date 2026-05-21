# Phase 3 下一实施子阶段：Runtime replay report artifact + runner interface / sandbox boundary 最小组合实施草案

> 状态：设计草案（implementation subplan draft）  
> 目的：为 Phase 3 下一份实施型 subplan 提供可直接拆分的原子任务、文件边界、禁区与最小验收口径。  
> 重要边界：本文**不是实现交付**，不代表 runtime replay、runner、sandbox、transcript engine、provider integration、CI runtime gate 已实现。

## 1. 子阶段定位

Phase 3 的第一段最小 preflight 实现包已经完成并推送。基于当前文档与代码状态，下一份实施型 subplan 不应继续补 preflight，而应进入一个**更窄、更诚实的最小组合**：

```text
runtime replay report artifact skeleton
+ runner interface contract
+ sandbox boundary contract
```

这个组合的职责不是“把 runtime 跑起来”，而是先把后续 runtime 真正开工前最关键的三本账分开：

1. **执行结果怎么记账**：runtime replay report artifact 最小骨架；
2. **谁来执行、怎么接入**：runner interface 最小输入/输出合同；
3. **执行边界怎么声明**：sandbox boundary contract 最小声明面。

一句话版：

```text
先把 runtime 的账本、接口和护栏写清楚，
不要在这一步偷偷开跑真实 runtime。
```

## 2. 为什么下一步不是继续补 preflight

当前仓库已经具备以下 preflight 基线：

- 独立 `runtime-preflight-result` artifact/report skeleton；
- `normalize -> preflight` adapter；
- 独立 preflight checks catalog / evaluator；
- 独立 preflight CLI；
- 独立 preflight contract tests；
- `validate:preflight` 与 static validate 命令族隔离。

因此，继续在 preflight 上加料会出现两个问题：

1. **收益递减**：preflight 已经完成“runtime-ready gate”最小闭环，再补更多会开始挤占 runner/runtime report 的空间；
2. **边界变脏**：如果继续往 preflight 里塞 transcript、runner、sandbox 细节，很容易把 preflight 变成半个 runtime 执行器。

所以更合理的下一步，是沿着既有 roadmap 已经暗示的路径推进：

```text
artifact schema / report skeleton
  -> runner interface contract
  -> sandbox boundary contract
  -> single-case dry/null runner（后续实现任务）
```

## 3. 本子阶段目标

下一份实施型 subplan 应只交付以下最小组合：

1. **runtime replay report skeleton**
2. **runner interface contract**
3. **sandbox boundary contract**
4. **single-case dry/null runner 设计占位或最小接口接线**（仅接口级，不做真实 provider）
5. **runtime contract tests**（仅 contract 层，不做真实执行验证）
6. **文档回写与 roadmap 同步**

这里最重要的限制是：

- 不做真实模型 provider；
- 不做 transcript engine；
- 不做 CI runtime integration；
- 不做 multi-model / multi-platform matrix；
- 不把 runtime 接进 `validate:all`、`validate:contracts`、`validate:preflight` 默认链路。

## 4. 设计总原则

### 4.1 不污染 static / preflight baseline

本子阶段必须继续遵守两层隔离：

- **static validate 命令族不变**；
- **preflight contract 不回退、不混型**。

因此：

- runtime replay report 必须是独立 artifact；
- runner interface 必须独立于 static validator / preflight evaluator；
- sandbox boundary contract 只能消费 normalize / preflight 已有边界信息，不能反向改写 static 语义。

### 4.2 artifact、interface、boundary 分账

这三件事必须各自独立：

- `runtime-replay-report`：执行结果账本；
- runner interface：执行器输入/输出合同；
- sandbox boundary：执行约束合同。

不要把它们塞进一个胖对象里。那样现在看着省文件，后面会变成拆不动的铁板烧。

### 4.3 先 single-case，再谈批量编排

下一份实施子计划若涉及 runner，必须只面向：

- 单 fixture
- 单 case
- dry/null execution mode

禁止直接上：

- multi-fixture runtime aggregate；
- multi-case orchestration engine；
- parallel runner pool；
- transcript persistence pipeline。

### 4.4 sandbox 先冻结“声明合同”，不冻结“实现机制”

本阶段的 sandbox 只应该回答：

- runner 执行前需要知道哪些权限/边界字段；
- 哪些行为属于 allow/deny/blocked-by-default；
- 哪些字段来自 `normalizedFixture` / preflight；
- 真实沙箱实现留到后续。

## 5. 建议的实施型 subplan 结构

建议拆成 **5 个原子任务 + 1 个收尾任务**。

---

### Task 1：runtime replay report skeleton

**目标**

新增独立 `runtime-replay-report` artifact skeleton，冻结最小 report shape，但不接真实执行。

**当前实现状态（本轮）**

- 已新增 `src/skillforge/runtime-replay-reporter.mjs`；
- 当前只提供 skeleton report builder，不提供 runner、sandbox、provider、transcript 或 scoring 实现；
- 该 builder 的默认 `metadata.note` 与 `pendingCapabilities` 会显式提示：这不是 runtime replay 已完成的证据，只是执行账本骨架。

**建议修改文件**

- 新增：`src/skillforge/runtime-replay-reporter.mjs`
- 可小改：`src/skillforge/reporter.mjs`（仅在抽公共 helper 时允许，且不能改变 static contract）
- 新增文档：
  - `docs/phase-3-runtime-report-runner-plan.md`
- 可同步：
  - `docs/runtime-replay-protocol-lightweight-design.md`
  - `docs/roadmap.md`

**不要改的文件**

- `src/skillforge/reporter.mjs` 的 static report 语义
- `src/skillforge/preflight-reporter.mjs`
- `scripts/validate-fixture.mjs`
- `scripts/validate-preflight.mjs`
- 任意 fixture / package.json（本任务里先不要动）

**任务边界**

只冻结以下最小字段：

- `kind`
- `reportVersion`
- `protocolVersion`
- `fixture`
- `status`
- `summary`
- `cases`
- `checks`（可留空，仅 runner-level 诊断保留位）
- `errors`
- `metadata`

`cases[]` 最小候选字段建议为：

- `id`
- `type`
- `status`
- `expectedBehavior`
- `observed`
- `transcriptRef`
- `failureReason`

**最小验收口径**

- runtime report 与 static / preflight report **同风格不同型**；
- `cases[]` 是 runtime report 主体，不能伪装成 `checks[]`；
- 文档能明确 runtime report 与 preflight result 的差别；
- 不引入任何“已经执行”的假象字段默认填真值。
- skeleton 默认允许 `cases[].status` 落在 `not-executed` / `dry-run` / `blocked` 等非通过态，避免误读成真实 runtime pass。

---

### Task 2：runner interface contract ✅（最小生产者合同已落地）

**目标**

冻结 runner 的最小输入/输出面，让后续实现可以从 dry/null runner 起步，而不是重新设计一套执行合同。

**建议修改文件**

- 新增：`src/skillforge/runtime-runner-contract.mjs`
- 可新增：`src/skillforge/runtime-runner-types.mjs`（若选择分文件）
- 可同步文档：
  - `docs/runtime-replay-protocol-lightweight-design.md`
  - `docs/phase-3-runtime-report-runner-plan.md`

**不要改的文件**

- `src/skillforge/preflight-validator.mjs`
- `src/skillforge/validator.mjs`
- `scripts/validate-all.mjs`
- `scripts/test-validator-contracts.mjs`

**runner 输入建议冻结为**

```ts
{
  fixtureDir,
  loadedFixture,
  normalizedFixture,
  preflightReport,
  caseRecord,
  boundary: {
    permissions,
    toolBoundary,
  },
  options,
}
```

其中：

- `loadedFixture`：保留 loader 原始载荷，供后续 runner 在不重扫文件树的前提下读取必要原文；
- `normalizedFixture`：执行上游事实源；
- `preflightReport`：runtime-ready 证据；
- `caseRecord`：单 case 声明，沿用 `replay-cases.yaml` 的 case identity，不另发明第二套 case 语义；
- `boundary.permissions / boundary.toolBoundary`：runner 将消费的声明式边界摘要；
- `options`：只保留执行模式、诊断标签之类的实现占位，不代表真实 provider 参数已经接入。

**runner 输出建议冻结为**

```ts
{
  caseId,
  status,
  observed,
  transcriptRef,
  failureReason,
  runnerMetadata,
}
```

但本任务只冻结字段面，不需要真正产出完整实体。

**任务边界**

- 不接 provider；
- 不做模型调用；
- 不做并发调度；
- 不做多 case 聚合；
- 不做 transcript 落盘。

**当前实现状态（本轮）**

- 已新增 `src/skillforge/runtime-runner-contract.mjs`；
- 提供 `buildRuntimeRunnerInput()`、`buildRuntimeRunnerResult()`、`buildRuntimeRunnerContractContext()` 三个最小合同 helper，用于冻结 runner 生产者输入/输出对象；
- 输入面显式消费 `loadedFixture`、`normalizedFixture`、`preflightReport`、`caseRecord`、`boundary.{permissions,toolBoundary}` 与 `options`；
- 输出面显式冻结 `caseId`、`status`、`observed`、`transcriptRef`、`failureReason`、`runnerMetadata`；
- `status` 目前只允许 `passed | failed | blocked | error | dry-run | not-executed`，避免把 contract 默认值写成“已经真实跑通”；
- 当前模块是 **runner contract producer**，不是 runner implementation；不调用 provider、不生成 transcript、不执行 sandbox。

**最小验收口径**

- 单 case runner 输入/输出合同清晰；
- 与 preflight / runtime report 的字段关系明确；
- 不重新发明第二套 fixture identity / boundary / case identity 语义。

---

### Task 3：sandbox boundary contract ✅（声明式边界合同已落地）

**目标**

冻结 runner 侧实际会消费的 sandbox boundary 合同，明确哪些边界来自 normalize/preflight，哪些属于未来真实 sandbox implementation。

**建议修改文件**

- 新增：`src/skillforge/runtime-sandbox-contract.mjs`
- 可小改：`src/skillforge/preflight-adapter.mjs`（仅在需要补齐 boundary summary 字段时，且不能破坏既有 preflight contract）
- 可同步文档：
  - `docs/runtime-replay-protocol-lightweight-design.md`
  - `docs/phase-3-runtime-report-runner-plan.md`

**不要改的文件**

- `src/skillforge/normalize.mjs` 的既有返回字段语义
- `src/skillforge/preflight-rules.mjs`
- 任意 static fixtures

**建议冻结的 boundary 合同最小字段**

- `permissions.allowed`
- `permissions.denied`
- `permissions.conservativeDefault`
- `toolBoundary.allowedActions`
- `toolBoundary.deniedActions`
- `toolBoundary.bodyMentionsConservativeBoundary`
- `unsupportedCapabilities`（reserved）
- `sideEffectPolicy`（reserved）

**当前实现状态（本轮）**

- 已新增 `src/skillforge/runtime-sandbox-contract.mjs`；
- 提供 `buildRuntimeSandboxBoundary()` 与 `buildRuntimeSandboxBoundaryFromSources()` 两个 helper，用于冻结 runner 消费的最小 sandbox boundary 输入面；
- 输入面显式覆盖 `permissions`、`toolBoundary`、`sideEffectPolicy`、`sandboxMode`、`network`、`filesystem`、`externalMessaging`；
- 输出面显式冻结 `boundarySummary`、`reservedCapabilities`、`warnings`，并把 `sideEffectGuard` 作为 `boundarySummary` 的声明式摘要字段；
- `boundarySummary.declarationOnly=true` 与 `boundarySummary.enforcementImplemented=false` 会明确提示：这里交付的是边界合同，不是沙箱 enforcement。

**任务边界**

- 只定义合同，不实现真实沙箱；
- 不做命令执行 allowlist engine；
- 不做工具调用 adapter；
- 不做 OS-level 隔离。

**最小验收口径**

- 能说清 runner 执行前需要哪些 boundary 字段；
- 能区分 declared boundary 与 enforced sandbox；
- 不把“声明存在”误写成“已被强制执行”。

---

### Task 4：single-case dry/null runner skeleton ✅（最小 dry/null skeleton 已落地）

**目标**

在不接真实 provider 的前提下，增加一个仅用于合同闭环的单 case dry/null runner skeleton，证明 runner contract 可被接线，但不做真实 runtime。

**建议修改文件**

- 新增：`src/skillforge/runtime-runner.mjs`
- 可新增：`scripts/run-runtime-case.mjs` 或同类独立入口
- `package.json`（仅新增 runtime draft 相关 script；如觉得太冒进，也可以不加 script，仅保留模块）
- 可新增：`src/skillforge/runtime-case-selector.mjs`（若需要最小单 case selector）

**不要改的文件**

- `scripts/validate-fixture.mjs`
- `scripts/validate-preflight.mjs`
- `scripts/validate-all.mjs`
- `scripts/test-validator-contracts.mjs`
- `scripts/test-preflight-contracts.mjs`

**任务边界**

runner skeleton 只允许：

- 读取单 case；
- 返回 dry/null 状态；
- 生成 runtime report 所需的最小 case result shape；
- 可产出 `blocked` / `not-executed` / `dry-run` 之类状态。

不允许：

- 真实模型调用；
- 真实 transcript；
- 自动评分；
- 文件写入副作用；
- runtime aggregate。

**当前实现状态（本轮）**

- 已新增 `src/skillforge/runtime-runner.mjs`；
- 已新增 `src/skillforge/runtime-case-selector.mjs`；
- `runtime-case-selector` 目前只支持从 `normalizedFixture.replayCases.cases` 中选择 **单 fixture / 单 case**，支持 `caseId`、`caseIndex` 或默认首 case；
- `runtime-runner` 目前只提供 `runRuntimeCaseSkeleton()` 与 `buildRuntimeRunnerSkeletonInput()` 两个最小 helper：
  - 强制消费 `normalizedFixture`、`preflightReport`、`runnerContract`、`sandboxContract`（若未显式传入 contract，则会基于既有 contract builder 现场组装）；
  - 只允许 `dry-run` / `null-runner` 两种 mode；
  - case result 只会落在 `dry-run` / `blocked` / `not-executed`，不会产出 `passed`；
  - 会返回最小 `runtimeReport`，其 `cases[]` 结构与 `runtime-replay-report` skeleton 对齐；
  - `observed` 明确标记 `providerCall=false`、`transcriptCaptured=false`、`sideEffectsPerformed=false`，避免伪装成真实 runtime evidence。

**最小验收口径**

- runner skeleton 能围绕单 case 组织输入/输出对象；
- dry/null status 不会被误解为 passed runtime execution；
- 后续真实 provider 可沿用同一输入/输出 contract。

---

### Task 5：runtime contract tests ✅（standalone contract tests 已落地）

**目标**

新增一套独立 runtime contract tests，只验证 artifact / runner / boundary 的合同，不验证真实模型行为。

**建议修改文件**

- 新增：`scripts/test-runtime-contracts.mjs`
- `package.json`（仅新增 script）
- 可补充：
  - `docs/validator-contract.md`（增加 runtime draft CLI/contract 说明，若本阶段真的加了独立脚本入口）

**当前实现状态（本轮）**

- 已新增 `scripts/test-runtime-contracts.mjs`；
- 已新增独立脚本入口 `pnpm validate:runtime:contracts`，与 `validate:contracts` / `validate:preflight:contracts` 完全分离；
- 当前 runtime contract tests 只覆盖：
  - `runtime-replay-report` skeleton 顶层字段与 `kind`；
  - single-case selector 的默认首 case / `caseId` / `caseIndex` 稳定行为；
  - `dry-run` / `null-runner` 结果不会产出 `passed`；
  - case result / summary / blockedCases / warning 统计对齐；
  - `pendingCapabilities` 与 `metadata.note` / sandbox declaration-only 标记明确保留 provider、transcript、sandbox enforcement 未实现边界；
- 当前测试不调用 provider、不生成 transcript、不写 runtime artifact 文件、不修改 static / preflight contract baseline。

**不要改的文件**

- `scripts/test-validator-contracts.mjs`
- `scripts/test-preflight-contracts.mjs`
- `docs/static-mvp-validation-report.md`

**contract tests 最小覆盖建议**

1. runtime replay report 顶层字段存在；
2. `kind === runtime-replay-report`；
3. `summary` 与 `cases[]` 统计对齐；
4. dry/null runner 输出不会伪装成 runtime pass；
5. sandbox boundary summary 字段透传正常；
6. usage / unsupported mode 能稳定失败；
7. 不断言 `generatedAt` 精确值；
8. 不复用 static / preflight baseline 常量。

**任务边界**

- 不做真实 provider integration tests；
- 不做 CI gate；
- 不做 snapshot 全文绑定。

**最小验收口径**

- runtime contract tests 独立可运行；
- static / preflight contract tests 完全不受影响；
- 能覆盖“dry/null 不等于 runtime pass”这一核心诚实性边界。

---

### Task 6：文档回写与 roadmap 同步

**目标**

把 runtime report skeleton、runner interface、sandbox boundary 的已实现/未实现边界回写到文档，保证 roadmap、protocol、contract 三处口径一致。

**建议修改文件**

- `docs/phase-3-runtime-report-runner-plan.md`
- `docs/roadmap.md`
- `docs/runtime-replay-protocol-lightweight-design.md`
- 视实现入口决定是否补：`docs/validator-contract.md`

**不要改的文件**

- `docs/static-mvp-validation-report.md` 中现有 static baseline 数字与 static-only 结论
- `docs/phase-3-preflight-implementation-plan.md` 中已完成 preflight 事实（除非只是追加衔接说明）

**任务边界**

只写清这些事实：

- runtime report artifact skeleton 是否落地；
- runner interface / sandbox boundary contract 是否落地；
- single-case dry/null runner 是否仅属合同闭环；
- provider / transcript / sandbox implementation / CI runtime integration 仍未落地。

**最小验收口径**

- roadmap、protocol、plan 三处口径一致；
- 不把 dry/null runner 写成真实 runtime replay；
- 不把 runner interface 写成 provider integration 已完成。

## 6. 每个任务改哪些文件 / 不改哪些文件

## 6.1 建议改动文件清单

**新增文件候选**

- `src/skillforge/runtime-replay-reporter.mjs`
- `src/skillforge/runtime-runner-contract.mjs`
- `src/skillforge/runtime-sandbox-contract.mjs`
- `src/skillforge/runtime-runner.mjs`
- `src/skillforge/runtime-case-selector.mjs`（可选）
- `scripts/test-runtime-contracts.mjs`
- `scripts/run-runtime-case.mjs`（可选，若要独立 CLI）
- `docs/phase-3-runtime-report-runner-plan.md`

**可小改文件候选**

- `src/skillforge/preflight-adapter.mjs`（仅补充 runtime 消费所需的 boundary summary；不能破坏 preflight contract）
- `package.json`（仅新增 runtime draft scripts）
- `docs/roadmap.md`
- `docs/runtime-replay-protocol-lightweight-design.md`
- `docs/validator-contract.md`（仅当本阶段真的新增独立 runtime draft 入口）

## 6.2 明确禁改文件 / 区域

### A. Static contract 禁区

- `scripts/validate-fixture.mjs`
- `scripts/validate-fixtures.mjs`
- `scripts/validate-all.mjs`
- `scripts/test-validator-contracts.mjs`
- `src/skillforge/validator.mjs`
- `src/skillforge/reporter.mjs` 的 static report 语义
- `docs/static-mvp-validation-report.md` 中现有 static baseline 数字

### B. Preflight contract 禁区

- `scripts/validate-preflight.mjs` 的既有 exit 语义
- `scripts/test-preflight-contracts.mjs` 的既有基线意义
- `src/skillforge/preflight-reporter.mjs` 的 artifact kind / summary 语义
- `src/skillforge/preflight-validator.mjs` 里“preflight pass ≠ runtime pass”的边界

### C. Fixture / baseline data 禁区

- `fixtures/**`
- 任意 `replay-cases.yaml` baseline 内容
- 任意 `validation-result.yaml` baseline 内容
- 任意 package fixture 数据

## 7. 最小验收口径

下一份实施型 subplan 的最小验收，建议压缩到下面这几条。

### 7.1 子阶段总体验收

满足以下条件即可视为完成：

1. 存在独立 `runtime-replay-report` artifact skeleton；
2. runner interface contract 已冻结最小单 case 输入/输出边界；
3. sandbox boundary contract 已冻结 runner 消费字段；
4. 若实现 dry/null runner，则其状态不会伪装成 runtime pass；
5. 存在独立 runtime contract tests；
6. static / preflight baseline contract 不变；
7. 文档明确 runtime 仍未进入真实 provider / transcript / sandbox implementation 阶段。

### 7.2 不要求本阶段完成的内容

以下都不应纳入本阶段验收：

- 真实 provider 接入；
- transcript engine；
- observed execution artifact 落盘；
- 自动评分 rubric engine；
- CI runtime integration；
- cross-platform runtime matrix；
- cross-model runtime matrix；
- multi-case orchestration；
- multi-fixture runtime aggregate；
- 真实 sandbox implementation。

## 8. 哪些 static / preflight contract 仍是禁区

### 8.1 static validate 命令级禁区

不得改变以下命令的默认意义、输出契约或基线数字：

- `pnpm validate`
- `pnpm validate:fixture`
- `pnpm validate:fixtures`
- `pnpm validate:fixture:matrix`
- `pnpm validate:all`
- `pnpm validate:contracts`

### 8.2 preflight 命令级禁区

不得改变以下命令的默认定位：

- `pnpm validate:preflight`
- `pnpm validate:preflight:contracts`

尤其不能把：

- preflight CLI 接进 `validate:all`；
- runtime draft CLI 接进 `validate:preflight`；
- runtime contract tests 接进 `validate:contracts` 默认路径。

### 8.3 report contract 禁区

不得改变以下既有 artifact 的核心语义：

- static report：`checks[]` 表示 static rules；
- preflight report：`summary.totalChecks` 只统计 preflight checks；
- static/preflight `status=passed` 都**不代表 runtime replay passed**。

### 8.4 baseline 数字禁区

当前静态/预飞基线不得因本子阶段被动变化：

- static single fixture：`summary.total = 17`
- static multi-fixture：`summary.totalChecks = 51`
- static matrix：`6/6 cases`
- preflight baseline：保持既有 contract tests 语义，不因为 runtime draft 混入而变味

## 9. 留到后续子计划再做的内容

### 9.1 真实 runtime 执行层

- provider / model integration
- transcript engine
- observed output persistence
- scoring/rubric engine
- runtime failure taxonomy 完整扩展

### 9.2 sandbox 实现层

- OS-level sandbox
- tool execution adapter
- allowlist / denylist enforcement engine
- side-effect isolation implementation

### 9.3 扩展编排层

- multi-case batch runner
- multi-fixture runtime aggregate
- parallel runtime orchestration
- retry / flake handling

### 9.4 平台与 CI 层

- GitHub Actions runtime gate
- cross-platform runtime validation
- cross-model runtime comparison matrix
- persistent runtime artifacts in CI

### 9.5 产品化层

- workflow -> skill generator
- registry / publish
- UI
- acceptance automation

## 10. 风险与注意事项

### 10.1 最大风险：把 dry/null runner 误写成“已具备 runtime”

如果文档或 contract tests 不够谨慎，很容易让人误读为：

- 有 runner module = runtime 已实现；
- 有 runtime report = 已有真实 execution evidence。

必须反复锁死：

- dry/null runner 只是合同闭环；
- runtime report skeleton 只是账本骨架；
- 没有 provider / transcript / observed evidence 就不是 runtime pass。

### 10.2 最大结构风险：artifact 混型

如果把 runtime case 结果塞进 static 或 preflight `checks[]`，后面统计口径会直接炸开。

坚持三本账：

- static rules
- preflight checks
- runtime cases

### 10.3 最大边界风险：sandbox contract 写成 sandbox enforcement

本阶段只是“声明 runner 会读什么边界字段”，不是“已经强制执行了什么边界策略”。

如果这点写不清楚，会产生危险幻觉：看起来很安全，其实只是写得很安全。

### 10.4 package.json 只新增，不改既有默认链路

即使本阶段要加 runtime draft 入口，也只能：

- 新增独立 script；
- 不修改已有 `validate*` / `validate:preflight*` 的默认含义。

## 11. 可直接复用的实施子计划 task 列表草案

1. **T1 - runtime replay report skeleton**  
   新增独立 runtime replay report builder，冻结 `runtime-replay-report` shape。

2. **T2 - runner interface contract**  
   新增单 case runner 输入/输出合同，不接 provider。

3. **T3 - sandbox boundary contract**  
   冻结 runner 消费的 boundary 字段面，区分 declared vs enforced。

4. **T4 - single-case dry/null runner skeleton**  
   仅做合同闭环，不做真实执行。

5. **T5 - standalone runtime contract tests**  
   独立断言 runtime artifact / runner / boundary contract，不影响 static/preflight baseline。

6. **T6 - docs sync / roadmap write-back**  
   回写 roadmap、protocol、plan 文档，明确已实现与未实现边界。

## 12. 结论

Phase 3 下一实施子阶段，最合理的范围不是“继续补 preflight”，也不是“直接开写真实 runner”，而是中间这一小块最关键的桥：

```text
runtime replay report skeleton
+ runner interface contract
+ sandbox boundary contract
(+ optional single-case dry/null runner skeleton)
```

这套最小组合的价值很明确：

- 给后续真实 runtime 一套干净账本；
- 给 runner 实现一个稳定接缝；
- 给 sandbox 实现一个不夸大能力的边界合同；
- 同时不污染 static / preflight 的既有证据。

说白了，这一步不是让系统“跑起来”，而是先把跑之前必须写清楚的合同写清楚。这个顺序，稳。