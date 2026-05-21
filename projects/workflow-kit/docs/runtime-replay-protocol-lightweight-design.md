# SkillForge Runtime Replay Protocol & Preflight 轻量设计草案

> 状态：设计草案（协议仍为 draft，仓库内已有受限的 Phase 3 runtime draft CLI / orchestrator 实施）
> 适用阶段：Milestone D 协议收敛前置文档
> 文档目的：为负责人判断“是否继续进入 runtime 相关子任务”提供边界清晰、与现有 static/schema 阶段兼容的协议草案。
> 重要声明：本文**不代表 provider-backed runtime replay 已实现**，也**不承诺 transcript engine / sandbox enforcement / model integration / multi-case runtime orchestration 已存在**。

## 1. 设计目标

当前 SkillForge 已具备的是 **static validation**：

- 读取 fixture 文件树；
- 经过 `loadFixture -> normalizeFixture -> validateFixture -> buildReport` 静态校验链路；
- 产出 single-fixture report、multi-fixture report 与本地 aggregate summary；
- 对 replay 相关内容只做**诚实性检查**，例如：
  - 不允许 `passed: true` 但没有 observed evidence；
  - 不允许把 runtime 未执行的结果伪装成 validation passed。

因此，Milestone D 的目标不是“补完整 runtime 实现”，而是先把**runtime replay protocol 和 preflight contract 冻结成轻量文档**，让后续实现有明确边界，且不反向污染当前 static MVP。

当前仓库内已经存在一个**独立 runtime draft CLI** 及其最小 orchestration 承载面，用于诚实地串起 `static validation -> preflight -> single-case dry/null runtime skeleton -> draft artifact`。这一步只代表 Phase 3 draft execution surface 已接通，不代表真实 runtime replay 已交付。

本文要回答的问题是：

1. static validation 与未来 runtime replay / preflight 如何分层；
2. 最小 target objects / artifacts 是什么；
3. `replay-cases.yaml` 到 runtime-ready 阶段哪些字段冻结、哪些保留、哪些不扩张；
4. preflight 的输入输出边界如何贴近 `normalize.mjs`；
5. runtime replay report 如何与现有 validator report 兼容；
6. runner / sandbox 在本阶段只冻结哪些接口；
7. 本阶段明确不做什么；
8. 后续最合理的推进顺序是什么。

---

## 2. 当前 static validation 与未来 runtime replay / preflight 的关系

## 2.1 分层关系

建议把后续链路理解为三层：

```text
fixture files
  -> static validation
  -> preflight
  -> runtime replay
```

三层职责分别是：

### A. Static validation（已存在）

职责：验证“声明是否像样、边界是否诚实、结构是否完整”。

它已经覆盖：

- required files 是否存在；
- manifest / replay-cases 的 lightweight schema gate；
- `SKILL.md` frontmatter 与 trigger wording；
- conservative boundary、privacy、dependency、compatibility、checklist 聚合；
- replay 诚实性：不能无 observed 就写 passed。

它**不能证明**：

- skill 在真实模型下会被正确触发；
- output 质量达标；
- tool/sandbox 行为真实可执行；
- transcript / observed / scoring 可复现。

### B. Preflight（未来新增，先定义协议）

职责：验证“这个 fixture 是否已经**足够 runtime-ready**，可以被 runner 尝试执行”。

preflight 不负责执行模型，不负责生成 transcript，不做最终评分；它更像 runtime 前的 gate：

- 输入对象是否合法；
- replay cases 是否满足 runtime-ready 最小字段；
- runner 所需接口声明是否齐备；
- 是否存在显式禁止进入 runtime 的条件。

### C. Runtime replay（当前仅有 draft orchestration，真实执行仍未实现）

职责：在明确输入、边界、工具权限和 case 语义的前提下，记录**真实执行证据**：

- case 是否被执行；
- transcript / observed output 是什么；
- 是否通过；
- 失败原因属于触发、边界、输出质量还是环境问题。

## 2.2 关系原则

建议冻结以下关系原则：

1. **Static pass 是 runtime 的前置条件，不是 runtime 的替代品。**
2. **Preflight pass 只表示“可尝试执行”，不表示“执行通过”。**
3. **Runtime replay report 只能建立在实际执行证据之上。**
4. **任何 runtime 结果都不回写为伪造的 static pass。**
5. **`validate:all` / `validate:contracts` 继续只代表 static validation，不混入 runtime。**

---

## 3. 最小 target objects / artifacts

Milestone D 建议只冻结 3 个最小对象，不再额外扩张：

1. `replay-cases.yaml`
2. runtime replay report
3. preflight result

## 3.1 replay-cases.yaml

定位：**case declaration artifact**。
它描述“将来应该如何 replay”，而不是“已经 replay 过什么”。

建议继续把它视为 fixture 的一部分，和 static validation 共存。

## 3.2 preflight result

定位：**runtime-readiness artifact**。
它描述“这批 replay case 是否已经满足 runtime 执行前的最小合同”。

它的职责是：

- 不执行模型；
- 不生成 transcript；
- 只给出可执行性判断与阻断原因。

## 3.3 runtime replay report

定位：**execution evidence artifact**。
它描述“哪些 case 被实际执行了，观察到了什么，结果如何”。

它与现有 validator report 平行，不替代 validator report。

## 3.4 三者关系

```text
replay-cases.yaml
  -> preflight result
      -> runtime replay report
```

含义：

- `replay-cases.yaml` 是声明源；
- preflight result 说明声明是否已达 runtime-ready；
- runtime replay report 记录真正执行的 evidence。

建议不要在 Milestone D 再引入第 4 类 artifact（例如 transcript registry、rubric bundle、sandbox snapshot），这些都可留到后续实现任务再拆。

---

## 4. replay-cases.yaml：runtime-ready 阶段的冻结边界

基于现有 `schema.mjs` 与 `validator.mjs`，当前 `replay-cases.yaml` 已有最小字段：

- `fixtureId`
- `kind`
- `cases[]`
  - `id`
  - `type`
  - `intent`
  - `expectedBehavior`
  - `observed`
  - `passed`

在 runtime-ready 阶段，建议把字段分成三类：**冻结字段**、**保留字段**、**明确不扩张字段**。

## 4.1 冻结字段

这些字段建议继续保留并冻结语义：

| 字段 | 语义 | 备注 |
| --- | --- | --- |
| `fixtureId` | 所属 fixture 标识 | 与现有 static fixture 身份一致 |
| `kind` | artifact kind | 继续使用 `replay-cases` |
| `cases[].id` | case 稳定标识 | 后续 report / transcript 关联主键 |
| `cases[].type` | `positive | negative | edge` | 不扩充更多类型枚举 |
| `cases[].intent` | 用户意图摘要 | 用于人读与 runner 输入组装 |
| `cases[].expectedBehavior` | 期望行为 | 允许 string 或 array，保持兼容现状 |
| `cases[].forbiddenBehavior` | 禁止行为 | 可选，但语义固定为 boundary guard |
| `cases[].passed` | 执行结果 | 未执行时必须为 `null` |
| `cases[].observed` | 观测结果占位 | 未执行时必须为 `null` |

其中最关键的是两条：

1. `passed` 仍然只能代表**实际执行后的结果**；
2. `observed` 仍然只能代表**实际观测到的证据**，不能拿推测值填充。

## 4.2 保留字段

这些字段可保留为 runtime-ready 所需的轻量补充，但不要求当前 static 阶段强制校验全部语义：

| 字段 | 用途 |
| --- | --- |
| `cases[].input` | 保留为原始输入材料或输入摘要 |
| `cases[].privacyNotes` | case 级隐私说明 |
| `cases[].tags` | case 分类标签 |
| `checklist` | 与现有静态七维口径兼容 |

建议新增但仅作为**保留位**的字段：

| 字段 | 用途 | 当前状态 |
| --- | --- | --- |
| `cases[].runtime` | case 级 runtime hint，例如执行模式、是否允许工具 | 保留，不要求实现 |
| `cases[].preflight` | case 级 runtime-ready 补充元数据 | 保留，不要求实现 |

注意：Milestone D 只建议在文档里保留命名空间，不要求现在修改 fixture 或 schema 代码去接受这些字段。

## 4.3 明确不扩张

本阶段建议明确不把 `replay-cases.yaml` 扩成以下东西：

1. **不内嵌完整 transcript**；
2. **不内嵌模型 provider / model name / sampling params**；
3. **不内嵌 sandbox 运行日志**；
4. **不内嵌评分 rubric 细节引擎**；
5. **不把 case 声明文件变成 execution report**；
6. **不引入复杂 case dependency graph**；
7. **不支持一条 case 绑定多模型多平台结果矩阵**。

换句话说，`replay-cases.yaml` 继续是**声明层 artifact**，不是结果数据库。

---

## 5. Preflight 输入输出边界

## 5.1 为什么要贴近 normalize 层

从代码结构看，`normalize.mjs` 已经把 loader 产物整理成了更自然的运行前对象：

- `fixtureId`
- `fixtureVersion`
- `profile`
- `entryPath`
- `skillFrontmatter`
- `skillBody`
- `workflowSource`
- `skillSpec`
- `skillManifest`
- `replayCases`
- `validationResult`
- `dependencies`
- `permissions`
- `toolBoundary`
- `checklist`

这说明 preflight 最自然的输入，不应该是“runner 自己重新解析一遍整个文件树”，而应该是：

- 原始 `loadedFixture`，以及/或者
- `normalizeFixture(loadedFixture)` 的结果。

## 5.2 建议输入边界

建议 preflight 的逻辑输入定义为：

```ts
{
  fixtureDir: string,
  loadedFixture: LoadedFixture,
  normalizedFixture: NormalizedFixture,
  staticReport?: ValidatorReport
}
```

其中最关键的是 `normalizedFixture`，因为它已经聚合了：

- profile
- permissions
- tool boundary
- dependency summary
- replay cases
- checklist coverage

这比让 preflight 从 YAML/Markdown 文本重新取值更稳，也更符合现有实现分层。

## 5.3 建议输出边界

preflight 的输出建议是一个独立 artifact：

```yaml
kind: runtime-preflight-result
reportVersion: 0.1.0-draft
fixture:
  id: ...
  version: ...
  profile: ...
status: passed | failed
summary:
  passed: true|false
  blockingFailures: number
  warnings: number
checks:
  - id: ...
    severity: P0|P1|P2
    status: pass|fail|warn|error
    message: ...
    evidence: []
pendingCapabilities:
  - transcript-engine
  - sandbox-implementation
metadata:
  sourceStaticReportVersion: ...
  generatedAt: ...
```

## 5.4 Preflight 只检查什么

建议只检查 runtime-ready 最小条件：

1. static report 是否已通过，或至少无 blocking failures；
2. `replay-cases.yaml` 是否存在且结构可用；
3. 每个拟执行 case 是否有稳定 `id/type/intent/expectedBehavior`；
4. `passed/observed` 是否仍保持诚实语义；
5. permissions / toolBoundary 是否足以说明执行边界；
6. profile 是否属于当前允许进入 runtime 的范围；
7. 是否声明了任何当前 runner 明确不支持的能力。

## 5.5 Preflight 明确不检查什么

preflight 不应承担以下职责：

- 不判断模型输出质量是否合格；
- 不生成 transcript；
- 不做多轮 agent orchestration；
- 不评估跨模型稳定性；
- 不模拟 sandbox 行为；
- 不替代 static validation。

---

## 6. Runtime replay report 与现有 validator report 的兼容策略

## 6.1 兼容目标

现有 validator report 已有稳定骨架：

- `reportVersion`
- `ruleSetVersion`
- `fixture`
- `status`
- `summary`
- `checks`
- `errors`
- `metadata`
- 兼容别名：`rules`、`findings`、`generatedAt`

建议 runtime replay report **借用同类骨架，但不伪装成 validator report**。

## 6.2 建议策略：同构但不同 kind

建议 runtime replay report 采用“同构字段 + 新 kind”的方式：

```yaml
kind: runtime-replay-report
reportVersion: 0.1.0-draft
protocolVersion: runtime-replay-protocol-draft-1
fixture:
  path: ...
  id: ...
  version: ...
  entry: ...
  profile: ...
status: draft | blocked
summary:
  passed: false
  totalCases: number
  passedCases: number
  failedCases: number
  blockedCases: number
  warnings: number
  errors: number
cases:
  - id: ...
    type: positive|negative|edge
    status: blocked|dry-run|not-executed
    expectedBehavior: ...
    observed: runtime-observed-stub
    transcriptRef: null
    failureReason: ...
checks: []
errors: []
metadata:
  generatedAt: ...
  runner: reserved
  sandbox: reserved
  lineage:
    static: ...
    preflight: ...
    replayCases: ...
  note: runtime draft artifact only; no provider execution, no transcript evidence, no scoring result, no runtime pass evidence
pendingCapabilities: []
```

当前 Phase 3 这一小步若已落代码，也应只落到 runtime replay report skeleton builder 为止；`blocked` / `dry-run` / `not-executed` / `pendingCapabilities` / `metadata.note` 这些位的存在，本身就是为了防止外界误读成“真实 runtime replay 已经跑通”。

进一步收敛后的 draft 合同建议是：

1. 顶层 `status` 在当前 draft mode 只诚实落在 `draft | blocked`，不再伪装成 `passed | failed` 执行结论；
2. `summary.passed` 固定为 `false`，直到真实 provider + transcript + scoring evidence 存在；
3. `cases[].status` 当前只允许 `blocked | dry-run | not-executed`；
4. `observed` 必须保持 stub，`transcriptRef` 必须默认为 `null`；
5. `metadata.note` 必须显式声明 no provider / no transcript / no scoring；
6. lineage 通过 `metadata.lineage.static` / `metadata.lineage.preflight` / `metadata.lineage.replayCases` 引用上游来源，而不是把 runtime draft 说成新证据源。

## 6.3 为什么不直接复用 validator report

因为两者语义不同：

- validator report 的 `checks[]` 是**规则检查结果**；
- runtime replay report 的核心单位应该是 **cases[] 执行结果**。

若强行复用同一 report 类型，会带来混淆：

- `summary.total` 到底是 rules 数还是 cases 数？
- `checks[].status=pass` 到底表示 rule pass 还是 case pass？
- `findings` 到底是静态诊断还是运行失败？

所以建议：

1. **保留熟悉的 report shape 风格**；
2. **新增 `kind` / `protocolVersion` 区分语义**；
3. **把 case 结果放在 `cases[]`，而不是硬塞进 `checks[]`**。

## 6.4 与 static report 的衔接方式

建议 runtime replay report 只通过引用与 static report 关联，不混写：

- `metadata.sourceStaticReportVersion`
- `metadata.sourceStaticRuleSetVersion`
- `metadata.sourceFixtureId`

必要时还可保留：

- `preflightRef`
- `replayCasesRef`

这样既能追溯 lineage，又不破坏现有 static artifact contract。

---

## 7. Runner / sandbox：本阶段只冻结接口，不实现能力

> 当前进度补充：Phase 3 已新增 `src/skillforge/runtime-runner-contract.mjs`，用于冻结 runner 的单 case 输入/输出生产者合同；并已新增 `src/skillforge/runtime-sandbox-contract.mjs`，用于冻结 runner 消费的 sandbox boundary summary；并已新增 `src/skillforge/runtime-runner.mjs` + `src/skillforge/runtime-case-selector.mjs`，用于形成 single-case dry/null runner skeleton 的最小合同闭环。它们仍然不是真实 runtime runner、sandbox implementation、provider integration、transcript engine 或 scoring engine 的交付。

## 7.1 本阶段建议冻结的接口层

Milestone D 最初只建议冻结**抽象接口层**、不实现 runner；当前 Phase 3 已落地的 `runtime-runner.mjs` 仅是 single-case dry/null skeleton，用来证明接口可接线，不代表真实 runner 已实现。

最小接口可分为 4 类：

### A. Replay case selector

职责：决定哪些 case 进入本次 replay。

建议接口意图：

- 输入：fixture / replay-cases / filter
- 输出：selected cases

### B. Preflight evaluator

职责：在执行前判定 runtime-ready。

建议接口意图：

- 输入：normalized fixture + static report
- 输出：preflight result

### C. Runtime runner

职责：执行单 case 或批量 case。

建议接口意图：

- 输入：selected case + execution context
- 输出：case execution result

当前已冻结的最小单 case contract 输入/输出面为：

```ts
input = {
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

output = {
  caseId,
  status,
  observed,
  transcriptRef,
  failureReason,
  runnerMetadata,
}
```

这里的关键点是：

- runner 读取的是 `normalize + preflight` 已经整理好的上游事实，而不是自己重造解析逻辑；
- `boundary` 目前只是声明式消费面，不等于真实 sandbox enforcement；
- `status` 可以是 `dry-run` / `not-executed` / `blocked`，因此 contract 本身不制造“已经执行成功”的幻觉。

### D. Transcript sink / artifact writer

职责：把 execution evidence 写成独立 artifact 引用。

建议接口意图：

- 输入：transcript / observed / summary
- 输出：artifact ref

## 7.1.1 Sandbox boundary contract（已冻结的最小声明面）

当前已冻结的 runtime sandbox boundary contract 输入/输出面为：

```ts
input = {
  permissions,
  toolBoundary,
  sideEffectPolicy,
  sandboxMode,
  network,
  filesystem,
  externalMessaging,
}

output = {
  boundarySummary,
  reservedCapabilities,
  warnings,
}
```

其中：

- `boundarySummary` 是 runner 后续唯一应消费的声明式边界摘要，不应再发明第二套边界字段；
- `reservedCapabilities` 只表达未来可能补齐的能力位，例如 network/filesystem/external messaging isolation，不代表这些能力已存在；
- `warnings` 默认应明确指出当前阶段只有 contract，没有 sandbox enforcement；
- `sideEffectPolicy` / `sideEffectGuard` / `sandboxMode` 目前都只是声明字段，不构成真实隔离执行证据。

## 7.2 本阶段冻结哪些“输入面”

建议只冻结以下输入面，而不是内部实现：

1. `normalizedFixture` 作为 preflight 的首选上游对象；
2. `replay-cases.yaml` 作为 case declaration source；
3. runtime replay report / preflight result 作为目标 artifact；
4. runner 必须接受明确的 permissions / boundary context；
5. transcript 必须是独立 evidence，而不是回填到 declaration 文件。

## 7.3 本阶段明确不实现的能力

Milestone D / 当前 Phase 3 虽然已经有独立 runtime draft CLI 与 preflight→single-case dry/null runtime skeleton orchestration，但仍明确不做：

- 不接真实模型 provider；
- 不做 transcript engine；
- 不做 sandbox implementation / sandbox enforcement；
- 不做 tool execution adapter；
- 不做 scoring engine；
- 不做多 case / 多 fixture orchestration；
- 不做多模型/多平台矩阵执行器；
- 不把 runtime 入口混进 `validate:all`、`validate:contracts`、`validate:preflight:contracts` 或其他 static/preflight 默认链路。

补充说明：当前仓库虽然已经存在 single-case dry/null runner skeleton 与独立 `pnpm validate:runtime:contracts` 测试入口，但它们只用于冻结 contract 与诚实性边界，不代表真实 runtime replay/provider/transcript/sandbox enforcement 已实现。

当前 draft artifact 也不应把 `passedCases > 0` 解读成 runtime 已通过；这些计数字段仅保留同构 shape，为后续 provider 子计划承接留接口。

---

## 8. 建议的 preflight 最小检查项

为了让后续任务有可落地的 contract，建议预先冻结一组轻量检查项，但仍然保持“文档先行”：

| 建议 ID | 含义 | 阻断级别 |
| --- | --- | --- |
| `RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED` | static baseline 已通过 | P1 |
| `RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL` | replay cases 结构完整 | P1 |
| `RF-P1-PREFLIGHT-CASE-IDENTITY-STABLE` | 每个 case 有稳定 id/type | P1 |
| `RF-P0-PREFLIGHT-FORGED-RUNTIME-RESULT` | 存在伪造 runtime 结果 | P0 |
| `RF-P1-PREFLIGHT-BOUNDARY-DECLARED` | permissions / boundary 可判定 | P1 |
| `RF-P2-PREFLIGHT-RUNTIME-HINT-MISSING` | 缺少推荐 runtime hint | P2 |
| `RF-P2-PREFLIGHT-PROFILE-NOT-YET-TIERED` | profile 尚未进入更细 runtime tier | P2 |

注意：这些只是**协议级建议 ID**，不是当前已实现规则，也不要求马上写进 `validator.mjs`。

---

## 9. 明确不做项

为防止范围膨胀，Milestone D 需要明确写死以下非目标：

1. **不把当前 draft orchestration 写成真实 runtime runner。**
2. **不接模型 provider / API。**
3. **不做 transcript engine。**
4. **不做 sandbox 执行器 / enforcement。**
5. **不做自动评分系统。**
6. **不把 runtime 混进 `validate:all`。**
7. **不把 runtime 混进 `validate:contracts`。**
8. **不把 `replay-cases.yaml` 改造成结果数据库。**
9. **不回填伪造 observed/passed。**
10. **不宣称 runtime-ready 就等于 runtime-pass。**

这是本文最重要的边界之一：**Milestone D 只是协议冻结，不是能力交付。**

---

## 10. 推荐推进顺序

建议负责人的后续顺序为：

```text
协议文档
  -> artifact schema
  -> preflight contract
  -> runner / sandbox 接口
  -> runner / sandbox 实现（若继续）
```

具体解释：

### 第一步：协议文档

先把对象、边界、语义定清楚，避免后续实现反复返工。

### 第二步：artifact schema

先定义：

- `replay-cases.yaml` runtime-ready 约束；
- preflight result artifact shape；
- runtime replay report artifact shape。

但此时仍可不写执行器。

### 第三步：preflight contract

preflight 是 runtime 的最小门槛，也是最不冒进的一步。它依赖 static + normalize 层，却不需要接模型。

### 第四步：runner / sandbox 接口

只冻结输入输出面，不急着做实现。这样负责人可以先判断：

- 是否值得继续做 runtime；
- 是先做 mock runner，还是直接接真实 provider；
- sandbox 是否单独立项。

### 第五步：实现阶段（可选，后续再定）

只有在前 4 步都清楚后，才建议进入真正实现。

---

## 11. 风险与注意事项

## 11.1 最大风险：把 static 体系污染成伪 runtime

当前系统最大的优点，是边界还算诚实：

- static 就说 static；
- replay 只检查诚实性；
- 没执行就不写 passed。

Milestone D 最需要避免的，就是为了“看起来接近 runtime”，把 declaration、preflight、execution result 混成一锅。

## 11.2 normalize 层是最自然的 preflight 接缝

如果后续 preflight 绕开 `normalizeFixture`，重新从 YAML 直接拼装 runtime 输入，很容易出现：

- profile 解析不一致；
- permissions 归并不一致；
- boundary 解释不一致；
- static 与 runtime 对同一 fixture 的理解分叉。

所以后续若继续，建议把 `normalizeFixture` 视为 preflight 的天然上游接口。

## 11.3 现有 schema 仍偏轻量

`schema.mjs` 现在只是 lightweight gate，不是完整 artifact schema engine。
因此本文的“协议冻结”要诚实：它只是给后续 schema 子任务提供目标，不是说当前 schema 已覆盖 runtime-ready 语义。

## 11.4 report 兼容要“同构，不混型”

runtime report 最好长得像现有 report，方便人读和下游接入；
但不能假装自己就是 validator report，否则统计口径会立刻乱掉。

---

## 12. 决策摘要

如果负责人要决定“是否继续进入下一子任务”，本文给出的建议结论是：

1. **可以继续进入下一步，但应先做协议后的 schema / contract 子任务，不应直接开写 runner。**
2. **最安全的下一步是：先定义 preflight result 与 runtime replay report 的 artifact schema。**
3. **`normalizeFixture` 已经提供了一个自然、低风险的 preflight 输入层，值得沿用。**
4. **现阶段不应把 runtime 接进 `validate:all` / `validate:contracts`，否则会破坏当前 static MVP 的证据口径。**
5. **若负责人希望保守推进，Milestone D 到“协议文档 + artifact schema 草案”即可停，先不承诺实现。**

最终建议：**继续，但只进入“协议 → schema → preflight contract”这一窄路径；暂不进入 runner 实现。**
