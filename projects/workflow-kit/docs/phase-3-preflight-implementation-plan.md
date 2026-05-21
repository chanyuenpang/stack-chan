# Phase 3 第一实施子阶段：Preflight 最小实现包实施计划草案

> 状态：设计草案（implementation subplan draft）  
> 目的：为下一份“实施型 subplan”提供可直接拆任务的边界、文件范围、禁区与最小验收口径。  
> 重要边界：本文**不是实现交付**，不代表 runtime replay、runner、sandbox、transcript engine、model integration 已实现。

## 1. 本子阶段目标

基于当前已冻结的侦察结论，Phase 3 第一实施子阶段应只交付一个**最小 preflight 实现包**，范围严格限定为以下 5 件事：

1. `runtime-preflight-result` artifact
2. `normalize -> preflight` adapter
3. preflight checks catalog
4. 独立 preflight CLI
5. 独立 contract tests

这五项的定位是：

```text
static validation
  -> preflight readiness gate
  -> runtime replay（后续，不在本子阶段）
```

换句话说，这一段只回答：

- 这个 fixture 是否已经满足“可尝试进入 runtime”的最小合同；
- preflight 的输入、输出和规则口径如何稳定；
- 如何在不污染现有 static baseline 的前提下，为后续 runner 留出干净接缝。

## 2. 设计总原则

### 2.1 不污染现有 static 基线

本子阶段必须遵守以下硬边界：

- **不得修改** `validate:fixture` 的现有 JSON report contract；
- **不得修改** `validate:fixtures` 的现有 multi-fixture contract；
- **不得修改** `validate:all` 的现有 aggregate summary 口径；
- **不得修改** `validate:contracts` 现有 static contract baseline；
- **不得让 preflight 混入 static validate 命令族的默认执行路径**。

因此，preflight 必须以**独立模块、独立 CLI、独立 contract tests** 存在。

### 2.2 不伪装成 runtime

本子阶段不实现 runner，因此：

- preflight pass ≠ runtime pass；
- preflight artifact ≠ runtime replay report；
- 不写 transcript；
- 不写 observed execution evidence；
- 不给模型输出质量评分。

### 2.3 复用 normalize 层，不重造解析链

preflight 应基于当前 `normalizeFixture()` 的输出构建，而不是再发明一套并行的 fixture 解析逻辑。否则 static / preflight / future runner 三套口径会很快互相打架。

### 2.4 contract-first，少量新增，低耦合接入

这次实施应优先保证：

- artifact shape 稳定；
- rule/check ID 稳定；
- CLI exit code 语义稳定；
- contract tests 与 static tests 相互隔离。

## 3. 建议的实施型 subplan 结构

建议把下一份实施型 subplan 拆成 **5 个原子任务 + 1 个收尾任务**。不要把它们揉成一个“大而全”任务，不然很容易把 static baseline 一起带翻车。

---

### Task 1：Preflight artifact/report 骨架 ✅（最小骨架已落地）

**目标**

实现独立的 `runtime-preflight-result` artifact builder，使 preflight 拥有和 static report 风格相近、但语义独立的输出对象。

**建议修改文件**

- `src/skillforge/reporter.mjs`（仅当选择抽取共享辅助函数时，必须谨慎小改）
- 或新增：`src/skillforge/preflight-reporter.mjs`
- 或新增：`src/skillforge/preflight-contract.mjs`
- 新增/补充文档：
  - `docs/phase-3-preflight-implementation-plan.md`
  - 如需同步边界：`docs/preflight-contract-and-artifacts-design.md`

**不要改的文件**

- `scripts/validate-fixture.mjs`
- `scripts/validate-fixtures.mjs`
- `scripts/validate-fixture-matrix.mjs`
- `scripts/test-validator-contracts.mjs`
- `package.json` 里现有 validate 相关 script 语义
- 任意 fixture 内容

**任务边界**

本任务只定义与产出 preflight report object，例如：

- `kind`
- `reportVersion`
- `protocolVersion`
- `fixture`
- `status`
- `summary`
- `checks`
- `errors`
- `metadata`
- `pendingCapabilities`

不在本任务中实现完整 preflight 规则判断逻辑；最多只允许先接入空 checks 或 mock wiring，前提是 contract shape 已稳定。

**最小验收口径**

- 能明确列出 preflight artifact 的稳定字段；
- report shape 与 static report 同风格但不同型；
- 不更改现有 static report 的 top-level 字段与 summary 语义；
- 文档能说明 `runtime-preflight-result` 与 `runtime-replay-report` 的差别。

**当前实现状态（本次原子实现）**

- 已新增 `src/skillforge/preflight-reporter.mjs`，提供独立 `runtime-preflight-result` report builder；
- 已冻结最小顶层字段：`kind / reportVersion / protocolVersion / ruleSetVersion / fixture / status / summary / checks / errors / metadata / pendingCapabilities`；
- 当前只实现 artifact skeleton，不包含 preflight checks catalog/evaluator，也不代表 runtime replay 已实现。

---

### Task 2：normalize -> preflight adapter ✅（最小 adapter 已落地）

**目标**

实现从 `normalizeFixture(loadedFixture)` 到 preflight 输入对象的适配层，冻结 preflight 使用的最小上游字段集。

**建议修改文件**

- 新增：`src/skillforge/preflight-adapter.mjs`
- 视实现方式，可能小改：`src/skillforge/normalize.mjs`（仅允许非破坏性导出辅助；不要改既有返回字段语义）
- 新增/补充文档：
  - `docs/phase-3-preflight-implementation-plan.md`

**不要改的文件**

- `src/skillforge/validator.mjs`
- `src/skillforge/reporter.mjs` 的现有 static summary 语义
- `scripts/validate-fixture.mjs`
- fixtures / package.json

**任务边界**

adapter 只做这几件事：

- 接收 `fixtureDir`、`loadedFixture`、`normalizedFixture`、可选 `staticReport`；
- 提炼 preflight 关心的字段：
  - fixture identity
  - profile
  - replay cases
  - permissions
  - tool boundary
  - checklist / dependency / method 摘要
- 不重算 static validator 全量规则；
- 不承担文件系统扫描主逻辑；
- 不在这里实现 runtime 执行。

**最小验收口径**

- 文档和实现都明确：preflight 主输入是 normalizedFixture；
- 没有复制出第二套 YAML/Markdown 原始解析规则；
- 不改变 `normalizeFixture()` 现有 consumer 的行为。

**当前实现状态（本次原子实现）**

- 已新增 `src/skillforge/preflight-adapter.mjs`；
- `buildPreflightInput()` 接收 `{ fixtureDir, loadedFixture, normalizedFixture?, staticReport? }`；
- 若未显式提供 `normalizedFixture`，adapter 仅通过调用 `normalizeFixture(loadedFixture)` 获取主输入，不重造解析链；
- 当前 adapter 只提炼 fixture identity、profile、replay cases、permissions、tool boundary、checklist / dependency / method 摘要，用于后续 preflight evaluator 接入。

---

### Task 3：Preflight checks catalog + evaluator ✅（最小 catalog/evaluator 已落地）

**目标**

落地最小 preflight checks catalog，并实现 preflight evaluator 的阻断逻辑。

**建议修改文件**

- 新增：`src/skillforge/preflight-rules.mjs`
- 新增：`src/skillforge/preflight-validator.mjs` 或 `src/skillforge/preflight.mjs`
- 可新增文档同步：
  - `docs/preflight-contract-and-artifacts-design.md`
  - `docs/phase-3-preflight-implementation-plan.md`

**不要改的文件**

- `src/skillforge/rules.mjs`（除非明确决定共享枚举/常量，且不改变 static rule registry）
- `src/skillforge/validator.mjs` 的现有 17-check static contract
- 任何 static matrix fixture 或 baseline report 文档数据

**建议最小 checks 集**

至少覆盖以下 5 类：

1. `RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED`
2. `RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL`
3. `RF-P1-PREFLIGHT-CASE-IDENTITY-STABLE`
4. `RF-P0-PREFLIGHT-FORGED-RUNTIME-RESULT`
5. `RF-P1-PREFLIGHT-BOUNDARY-DECLARED`

可选保留 warning：

6. `RF-P2-PREFLIGHT-RUNTIME-HINT-MISSING`
7. `RF-P2-PREFLIGHT-PROFILE-NOT-YET-TIERED`

**任务边界**

- 只做 runtime-ready gate；
- 不做 runtime case execution；
- 不做 transcript / scoring；
- 不做 multi-model / multi-platform。

**最小验收口径**

- preflight checks ID / severity / status / message / evidence 结构稳定；
- 至少能区分 blocking failure 与 warning；
- `forged runtime result` 仍为 P0；
- 不把 preflight checks 塞进 static validator 的 `checks[]`。

**当前实现状态（本次原子实现）**

- 已新增 `src/skillforge/preflight-rules.mjs`，冻结独立 preflight checks catalog 与 severity 分层；
- 已新增 `src/skillforge/preflight-validator.mjs`，消费 `buildPreflightInput()` 的 normalized/preflight 输入并产出 `checks / errors / status / summary`；
- evaluator 当前最小覆盖：`STATIC-BASELINE-PASSED`、`REPLAY-CASES-MINIMAL`、`CASE-IDENTITY-STABLE`、`FORGED-RUNTIME-RESULT`、`BOUNDARY-DECLARED`，以及两个非阻断 warning；
- 当前仍未实现 standalone preflight CLI、preflight contract tests、runner/transcript/runtime replay full implementation。

---

### Task 4：独立 preflight CLI ✅（最小 standalone CLI 已落地）

**目标**

提供独立命令入口，例如 `validate:preflight:fixture` 或等价命名，但必须与 static validate 命令族隔离。

**建议修改文件**

- 新增：`scripts/validate-preflight.mjs`
- `package.json`（**只允许新增 script，不允许改现有 script 语义**）
- 如需帮助文本/usage 文档，可更新：
  - `docs/validator-contract.md`
  - `docs/phase-3-preflight-implementation-plan.md`

**不要改的文件**

- `scripts/validate-fixture.mjs`
- `scripts/test-validator-contracts.mjs` 现有 static case 断言
- `scripts/validate-all.mjs`
- `scripts/validate-fixtures.mjs`

**CLI 合同建议**

建议与 static CLI 风格一致，但保持独立：

- 输入：单 fixture path
- 默认 stdout：一个 preflight JSON artifact
- exit `0`：preflight passed
- exit `1`：preflight failed / blocking failure / fallback preflight error report
- exit `2`：CLI usage errors

**任务边界**

- 只跑 preflight；
- 不调用 `validate:all`；
- 不被 `validate` / `validate:fixtures` / `validate:all` 自动触发；
- 不新增 multi-fixture preflight 聚合入口。

**最小验收口径**

- 新 CLI 可单独运行；
- JSON artifact 可解析；
- exit code 语义稳定；
- 不影响现有 static CLI stdout/stderr/exit code。

**当前实现状态（本次原子实现）**

- 已新增 `scripts/validate-preflight.mjs`，作为独立 standalone preflight CLI；
- CLI 通过 `loadFixture()` + `validateFixture()` + `validatePreflight()` 串联现有 loader / normalize / preflight validator 链路，不重造解析逻辑；
- 默认 stdout 仅输出单个 `runtime-preflight-result` JSON artifact，并支持 `--format json` / `--json`；
- exit code 已冻结为：`0`=preflight passed，`1`=preflight failed 或 fallback preflight error report，`2`=CLI usage error；
- `package.json` 仅新增 `validate:preflight` script，未接入 `validate` / `validate:all` / `validate:contracts` 默认路径。

---

### Task 5：独立 preflight contract tests ✅（最小 standalone contract tests 已落地）

**目标**

为 preflight CLI 与 artifact contract 新增一套独立 contract tests，但不能污染现有 static contract baseline。

**建议修改文件**

- 新增：`scripts/test-preflight-contracts.mjs`
- `package.json`（新增 script）
- 可补充：`docs/validator-contract.md` 或新增 preflight contract 说明段落

**当前实现状态（本次原子实现）**

- 已新增 `scripts/test-preflight-contracts.mjs`，作为独立 preflight contract tests 入口；
- `package.json` 已新增 `validate:preflight:contracts` script，且未接入 `validate:contracts` / `validate:all` 默认路径；
- contract tests 覆盖正例 fixture 的 JSON contract、top-level `kind`、fixture identity / profile / entry 透传、`summary/checks/errors/pendingCapabilities` 字段存在与统计对齐；
- contract tests 额外覆盖 CLI usage error（exit `2`）与临时目录负例变异导致的 blocking failure（exit `1`）；
- 负例通过临时复制 baseline fixture 后局部改写 `replay-cases.yaml` 构造，未污染仓库现有 fixtures baseline。

**不要改的文件**

- `scripts/test-validator-contracts.mjs` 现有 static baseline 常量
- `docs/static-mvp-validation-report.md` 中现有 validate/fixtures/all/contracts 的 static baseline 叙述
- 所有 fixture baseline 文件

**contract tests 应覆盖的最小点**

1. preflight JSON 顶层字段存在；
2. `kind === runtime-preflight-result`；
3. `summary` 统计口径与 checks 对齐；
4. `fixture.id/profile/entry` 等关键字段透传正常；
5. blocking failure 能返回 exit `1`；
6. usage error 返回 exit `2`；
7. 不断言 `generatedAt` 精确值；
8. 不复用 static `CURRENT_CHECK_BASELINE`、`CURRENT_TOTAL_CHECK_BASELINE`。

**任务边界**

- 允许重用 baseline fixture 作为 preflight 正例输入；
- 若需要负例，优先采用临时目录变异，不改仓库 fixture；
- 不要求接进 `validate:contracts`。

**最小验收口径**

- preflight contract tests 独立可运行；
- static contract tests 完全不受影响；
- 不通过 snapshot 全文绑定脆弱输出格式。

---

### Task 6：文档回写与边界同步

**目标**

把 preflight 最小实现包的“已实现边界”和“未实现边界”写回文档，避免后续误宣称。

**建议修改文件**

- `docs/roadmap.md`
- `docs/preflight-contract-and-artifacts-design.md`
- `docs/validator-contract.md`（如新增 CLI contract 说明）
- `docs/phase-3-preflight-implementation-plan.md`

**不要改的文件**

- `docs/static-mvp-validation-report.md` 中已固化的 static baseline 数字，除非只是追加说明且不篡改 static 事实

**任务边界**

只回写这些事实：

- preflight artifact / adapter / checks / CLI / preflight contract tests 是否已落地；
- runtime runner / transcript / sandbox / model integration 仍未落地；
- preflight 未接入 `validate:all` / `validate:contracts` 默认 static gate。

**最小验收口径**

- roadmap 与 preflight design 文档口径一致；
- 不把 preflight 写成 runtime replay 已完成；
- 不把独立 preflight gate 写成 static baseline 的一部分。

## 4. 每个任务建议改哪些文件 / 不改哪些文件

## 4.1 建议改动文件清单

**新增文件候选**

- `src/skillforge/preflight-adapter.mjs`
- `src/skillforge/preflight-rules.mjs`
- `src/skillforge/preflight-validator.mjs`
- `src/skillforge/preflight-reporter.mjs`
- `scripts/validate-preflight.mjs`
- `scripts/test-preflight-contracts.mjs`
- `docs/phase-3-preflight-implementation-plan.md`

**可小改文件候选**

- `src/skillforge/normalize.mjs`（仅非破坏性辅助导出/注释级结构整理）
- `package.json`（仅新增 preflight scripts）
- `docs/roadmap.md`
- `docs/preflight-contract-and-artifacts-design.md`
- `docs/validator-contract.md`

## 4.2 明确禁改文件/区域

以下属于本子阶段的高敏感禁区：

### A. Static baseline contract 禁区

- `scripts/validate-fixture.mjs`
- `scripts/validate-fixtures.mjs`
- `scripts/validate-all.mjs`
- `scripts/test-validator-contracts.mjs`
- `src/skillforge/validator.mjs` 中现有 static report / summary / exit contract 的既定行为
- `src/skillforge/reporter.mjs` 中现有 static report shape（除非抽共享函数且零语义变化）

### B. Static baseline data 禁区

- `fixtures/**`
- 任意 fixture 下的 `skill-manifest.yaml`
- 任意 fixture 下的 `replay-cases.yaml`
- 任意 fixture 下的 `validation-result.yaml`

### C. Static verification evidence 禁区

- `docs/static-mvp-validation-report.md` 中现有 baseline 数字与 static-only 结论
- `validate:contracts` 当前 17 checks / 51 totalChecks 基线
- `validate:fixture:matrix` 当前 6/6 case baseline

## 5. 最小验收口径

下一份实施型 subplan 的验收标准，建议压到“够用且不炸 baseline”为止。

### 5.1 子阶段总体验收

满足以下条件即可视为本子阶段完成：

1. 存在独立 `runtime-preflight-result` JSON artifact 输出；
2. preflight 逻辑明确消费 `normalizeFixture()` 的上游对象；
3. 存在最小 preflight checks catalog，并能产出 blocking / warning 区分；
4. 存在独立 preflight CLI，exit code 语义稳定；
5. 存在独立 preflight contract tests；
6. **现有** `validate:fixture / validate:fixtures / validate:all / validate:contracts` baseline contract 不变；
7. 文档明确说明 preflight 只是 runtime-ready gate，不是 runtime replay pass。

> 当前进度说明：artifact / adapter / checks / standalone CLI / 独立 preflight contract tests 已落地；runner / transcript / runtime replay 仍不在本子阶段交付范围内。

### 5.2 不要求本阶段完成的内容

以下都不应纳入本阶段验收：

- runtime runner
- runtime transcript
- observed execution evidence 持久化
- runtime replay report full implementation
- model/provider integration
- sandbox / tool execution adapter
- multi-fixture preflight aggregate
- CI 接入 preflight
- 跨平台 / 跨模型执行矩阵
- runner interface 的完整生产级抽象

## 6. 哪些静态 contract 是禁区

这是本次最重要的雷区清单。

### 6.1 命令级禁区

不得改变以下命令的默认意义、输出契约或基线数字：

- `pnpm validate`
- `pnpm validate:fixture`
- `pnpm validate:fixtures`
- `pnpm validate:fixture:matrix`
- `pnpm validate:all`
- `pnpm validate:contracts`

### 6.2 Report contract 禁区

不得改变以下 static report contract 语义：

- `reportVersion = 0.1.0` 的当前 static artifact shape
- `ruleSetVersion = skillforge-static-mvp-0.1.0`
- `summary.passed` 的 blocking 语义
- `checks[]` 作为 static rule results 的含义
- `findings` / `rules` / `generatedAt` 兼容别名口径

### 6.3 Baseline 数字禁区

当前文档中已固化的静态 baseline 不得因 preflight 实施而被动变化：

- 单 fixture `summary.total = 17`
- multi-fixture `summary.totalChecks = 51`
- matrix `6/6 cases`
- `validate:contracts` 中对应常量和 stdout markers

### 6.4 Fixture 语义禁区

不得为了让 preflight 更顺手而：

- 回填 `replay-cases.yaml` 的 `passed=true` / `observed` 假值；
- 修改 fixture profile 声明；
- 调整 validation-result baseline 文本；
- 在 fixture 中加入 runtime-specific 结果数据冒充 readiness evidence。

## 7. 留到后续子计划再做的内容

以下能力应明确延后，不要偷偷夹带进本子阶段：

### 7.1 Runner / 执行相关

- runtime runner
- runner orchestration
- case selector 的复杂批量执行策略
- transcript sink / artifact writer 完整实现

### 7.2 Model / sandbox 相关

- 真实模型 provider 接入
- sampling / provider 配置
- sandbox implementation
- tool execution adapter
- side-effect isolation runtime layer

### 7.3 Runtime report 完整化

- `runtime-replay-report` 的完整执行产物实现
- transcriptRef 实体化
- failureReason taxonomy 完整扩展
- observed output scoring rubric

### 7.4 平台/矩阵/CI 相关

- preflight 接入 `validate:all`
- preflight 接入 `validate:contracts`
- preflight GitHub Actions gate
- cross-platform runtime matrix
- cross-model runtime matrix

### 7.5 生成器/产品化相关

- workflow -> skill generator
- registry / publish
- UI
- acceptance automation

## 8. 风险与注意事项

### 8.1 最大风险：误伤 static baseline

如果为了“复用更多代码”直接改 `validator.mjs`、`scripts/validate-fixture.mjs`、`scripts/test-validator-contracts.mjs`，很容易把 Phase 1 / Phase 2 已固化的 static 证据一起带崩。建议策略：**prefight 另起文件，不与 static validator 共用状态机。**

### 8.2 最大语义风险：artifact 混型

如果把 preflight result 塞进现有 validator report：

- static `summary.total` 会串味；
- downstream contract test 会变脆；
- 用户会误以为 runtime 已经部分实现。

所以必须坚持：

- static report 还是 static report；
- preflight report 另立 `kind`；
- runtime replay report 未来再单独立型。

### 8.3 normalize 接缝必须稳定

preflight 若绕开 `normalizeFixture()`，后续会出现三套事实源：

- loader/raw YAML 一套；
- static validator 一套；
- preflight 自己再读一套。

这是典型的后期修到怀疑人生套餐，别点。

### 8.4 contract tests 要独立，不要共锅

preflight contract tests 最好新开脚本：

- 便于单独演进；
- 不污染 static baseline 常量；
- 失败时定位更直接。

### 8.5 package.json 只加脚本，不改旧脚本

如果实施子计划需要 package script：

- 可以新增 `validate:preflight` / `validate:preflight:contracts` 之类；
- 不要改现有 `validate:*` 的既有行为。

## 9. 建议给下一份实施型 subplan 的任务列表草案

下面这个列表可以直接作为下一份实施型 subplan 的骨架：

1. **T1 - preflight artifact/report skeleton**  
   新增 preflight report builder，冻结 `runtime-preflight-result` shape。

2. **T2 - normalize-to-preflight adapter**  
   新增 adapter，明确 preflight 依赖 `normalizeFixture()` 输出，不重造原始解析。

3. **T3 - preflight checks catalog + evaluator**  
   新增 preflight rules/evaluator，覆盖 static baseline、case identity、boundary、forged runtime result 等最小 gate。

4. **T4 - standalone preflight CLI**  
   新增独立 CLI 与 package script，只处理单 fixture preflight。

5. **T5 - standalone preflight contract tests**  
   新增独立 contract tests，断言 preflight artifact/CLI contract，不接入 static baseline test。

6. **T6 - docs sync / roadmap write-back**  
   回写 roadmap 与 preflight design 文档，只记录 preflight 已实现边界，不夸大成 runtime replay。

## 10. 结论

Phase 3 第一实施子阶段最合理的做法，不是直接上 runner，而是做一个**最小、独立、不污染 static baseline 的 preflight 实现包**。

建议的实施顺序是：

```text
artifact/report
  -> adapter
  -> checks/evaluator
  -> standalone CLI
  -> standalone contract tests
  -> docs write-back
```

这条路径的好处很朴素：

- static 证据不被污染；
- preflight 语义先稳定；
- 后续 runner 才有干净接缝；
- 若中途停在 preflight，也仍然是诚实、可交付、可继续演进的状态。
