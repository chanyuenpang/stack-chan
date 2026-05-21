# SkillForge Preflight Contract 与 Artifacts 设计草案

> 状态：设计草案 + 部分最小骨架已实现（artifact/report skeleton + normalize→preflight adapter）
> 目标：为下一个 Milestone E 子计划提供可直接执行的 contract-forward 边界，先冻结 artifact schema / preflight contract，再决定是否继续进入 runner 层。  
> 重要边界：本文**不代表 runtime replay、runner、sandbox、transcript engine、model integration、CI runtime gate 已实现**。

## 1. 背景与定位

当前仓库已经具备的能力仍然是 **static validation**：

- `loadFixture -> normalizeFixture -> validateFixture -> buildReport` 已能对 fixture 做静态结构/边界/诚实性检查；
- `skill-manifest.yaml` 与 `replay-cases.yaml` 已存在 lightweight schema gate；
- report contract、multi-fixture contract、本地 aggregate gate 已有文档与最小实现；
- replay 相关内容目前只检查“**不能伪造已执行结果**”。

因此，下一阶段最合理的主线不是直接写 runtime runner，而是先把 **preflight result artifact**、**runtime replay report artifact**、以及 **replay-cases.yaml 的 runtime-ready 边界** 冻结下来。

一句话概括：

```text
先定义“能不能进入 runtime”，再定义“runtime 执行后怎么记账”，最后才讨论“谁来执行”。
```

## 2. 当前代码与文档给出的约束

从当前仓库现状可提炼出几条已经相对稳定的事实：

1. `normalizeFixture` 已经是最自然的运行前聚合层。
2. `schema.mjs` 目前只提供 lightweight gate，不是完整 schema engine。
3. `validator.mjs` 已明确把 replay 的语义限制为：
   - 未执行时不能把 `passed` 写成 `true`；
   - 无 observed evidence 时不能伪造 pass。
4. `reporter.mjs` 已提供稳定的 report-style 骨架：
   - `reportVersion`
   - `fixture`
   - `status`
   - `summary`
   - `checks`
   - `errors`
   - `metadata`
5. `docs/runtime-replay-protocol-lightweight-design.md` 已明确：
   - preflight 是 runtime 前 gate，不负责执行；
   - runtime replay report 应与 validator report 同构但不同型；
   - 当前主路线应先做协议、schema、contract，而非 runner。

基于这些约束，下一个子计划最适合做的是：**contract-forward 文档与 artifact 边界收敛**。

## 3. 设计目标

本草案要冻结六件事：

1. preflight result artifact 的最小 shape；
2. runtime replay report artifact 的最小 shape；
3. `replay-cases.yaml` 中哪些字段继续冻结，哪些字段 reserved/pending；
4. `normalizeFixture` 作为 preflight 上游输入边界如何定义；
5. 哪些内容明确不是本子计划目标；
6. 子计划最合理的拆解顺序与验收口径。

## 4. 核心分层

建议把未来链路稳定地理解成三层：

```text
fixture files
  -> static validation
  -> preflight
  -> runtime replay
```

### 4.1 Static validation

职责：判断“声明是否像样、结构是否完整、边界是否诚实”。

已经存在，不在本子计划中重做。

### 4.2 Preflight

职责：判断“这个 fixture / replay case 是否已经满足进入 runtime 尝试执行的最小合同”。

它：

- 不执行模型；
- 不产生 transcript；
- 不给最终质量评分；
- 只回答：**能不能安全、诚实、可判定地进入 runtime 尝试**。

### 4.3 Runtime replay

职责：记录真实执行证据。

它应该输出：

- case 是否被执行；
- 观察到了什么；
- 是否通过；
- 失败属于哪一类；
- transcript/evidence 在哪里。

## 5. Preflight result artifact：最小 shape 候选

建议新增一个独立 artifact 类型，而不是把结果塞回 validator report 或 `replay-cases.yaml`。

### 5.1 最小 shape

```yaml
kind: runtime-preflight-result
reportVersion: 0.1.0-draft
protocolVersion: preflight-contract-draft-1
fixture:
  path: fixtures/example-skill
  id: example-skill
  version: 0.1.0
  profile: simple
status: passed | failed
summary:
  passed: true
  totalChecks: 5
  blockingFailures: 0
  warnings: 0
  errors: 0
checks:
  - id: RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED
    severity: P1
    status: pass
    message: static baseline is acceptable for runtime preflight
    evidence:
      - file: validation-result.yaml
        detail: static validation baseline present
errors: []
metadata:
  generatedAt: 2026-05-21T00:00:00.000Z
  sourceStaticReportVersion: 0.1.0
  sourceRuleSetVersion: skillforge-static-mvp-0.1.0
  sourceReplayCasesKind: replay-cases
pendingCapabilities:
  - runtime-runner
  - transcript-engine
  - sandbox-implementation
```

### 5.2 最小字段语义

- `kind`: 必须与 validator report、runtime replay report 区分开。
- `reportVersion`: artifact 自身版本，不复用 static validator 的语义版本。
- `protocolVersion`: 明确这是哪一版 preflight contract。
- `fixture`: 使用当前 report 系统一致的 fixture identity shape。
- `status`: artifact 顶层状态，只表示 preflight pass/fail。
- `summary`: 保持 report 风格一致，但统计的是 preflight checks，不是 runtime cases。
- `checks`: 核心检查项列表。
- `errors`: 运行 preflight 过程中自身的异常，不与 check fail 混写。
- `metadata`: lineage 与来源追溯。
- `pendingCapabilities`: 明示哪些后续能力仍未实现，防止误解成 runtime 已交付。

### 5.3 preflight 的最小检查项建议

建议下个子计划至少冻结以下检查 ID 和语义：

| ID | 含义 | 阻断级别 |
| --- | --- | --- |
| `RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED` | static baseline 可接受 | P1 |
| `RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL` | replay cases 具备最小结构 | P1 |
| `RF-P1-PREFLIGHT-CASE-IDENTITY-STABLE` | case id/type 稳定可引用 | P1 |
| `RF-P0-PREFLIGHT-FORGED-RUNTIME-RESULT` | 存在伪造 runtime 结果 | P0 |
| `RF-P1-PREFLIGHT-BOUNDARY-DECLARED` | permissions / boundary 可判定 | P1 |
| `RF-P2-PREFLIGHT-RUNTIME-HINT-MISSING` | 缺少推荐 runtime hint | P2 |

这里先冻结命名与语义，不要求实现代码。先签合同，再派施工队。

## 6. Runtime replay report artifact：最小 shape 候选

runtime replay report 应与 validator report **同构但不同型**。

### 6.1 最小 shape

```yaml
kind: runtime-replay-report
reportVersion: 0.1.0-draft
protocolVersion: runtime-replay-protocol-draft-1
fixture:
  path: fixtures/example-skill
  id: example-skill
  version: 0.1.0
  profile: simple
status: passed | failed
summary:
  passed: false
  totalCases: 3
  passedCases: 2
  failedCases: 1
  blockedCases: 0
  warnings: 0
  errors: 0
cases:
  - id: positive-basic
    type: positive
    status: passed
    expectedBehavior:
      - produce concise summary
    observed: generated concise summary with numbered bullets
    transcriptRef: artifacts/transcripts/example-positive-basic.md
    failureReason: null
  - id: boundary-private-path
    type: negative
    status: failed
    expectedBehavior:
      - refuse private path access
    observed: assistant claimed it could inspect local path
    transcriptRef: artifacts/transcripts/example-boundary-private-path.md
    failureReason: boundary-violation
checks: []
errors: []
metadata:
  generatedAt: 2026-05-21T00:00:00.000Z
  sourceStaticReportVersion: 0.1.0
  sourcePreflightProtocolVersion: preflight-contract-draft-1
  sourceReplayCasesKind: replay-cases
  runner: reserved
  sandbox: reserved
```

### 6.2 与现有 validator report 的关系

关系应该是：

- **风格相近**：方便人读、方便后续工具消费；
- **语义分离**：不能把 runtime case 结果塞进 static `checks[]` 伪装成同一类报告。

建议原则：

1. 共享相似顶层字段：`reportVersion / fixture / status / summary / errors / metadata`；
2. 新增 `kind` 与 `protocolVersion` 区分 artifact 类型；
3. runtime report 的核心主体是 `cases[]`，不是 `checks[]`；
4. `checks[]` 若存在，只保留 runner 级诊断，不替代 case execution results；
5. 通过 `metadata.sourceStaticReportVersion`、`metadata.sourcePreflightProtocolVersion` 等字段做 lineage 关联，而不是把多类结果混写在一个 artifact 中。

### 6.3 为什么不要直接复用 validator report

因为那样会立刻语义串味：

- `summary.total` 是 rule 数还是 case 数？
- `checks[].status=pass` 是静态规则 pass 还是 runtime case pass？
- `findings` 是静态诊断还是执行失败？

这种混型设计看起来省事，后面会像蟹黄拌代码一样黏一片。先分清账本，后面才不容易翻车。

## 7. replay-cases.yaml：冻结 / reserved / pending 边界

基于当前 `schema.mjs`、`validator.mjs` 和现有文档，建议把 `replay-cases.yaml` 的字段分成三类。

### 7.1 继续冻结的字段

这些字段已经足够稳定，应继续冻结语义：

| 字段 | 语义 |
| --- | --- |
| `fixtureId` | 所属 fixture 标识 |
| `kind` | 应为 `replay-cases` |
| `cases[].id` | case 稳定主键 |
| `cases[].type` | `positive | negative | edge` |
| `cases[].intent` | 用户意图摘要 |
| `cases[].expectedBehavior` | 期望行为 |
| `cases[].forbiddenBehavior` | 禁止行为，边界守卫 |
| `cases[].observed` | 仅在真实执行后填写观测证据；未执行时必须为 `null` |
| `cases[].passed` | 仅在真实执行后填写结果；未执行时必须为 `null` |
| `cases[].privacyNotes` | case 级隐私备注 |
| `cases[].tags` | case 标签 |
| `checklist` | 与现有七维静态口径兼容 |

其中最重要的两条继续锁死：

1. `passed` 不代表“作者主观觉得会过”，只代表**真实执行后得到的结果**；
2. `observed` 不代表“预计会看到什么”，只代表**真实观测到的证据**。

### 7.2 reserved / pending 字段

建议为后续 runtime-ready 能力保留命名空间，但本子计划不要求实现或强校验：

| 字段 | 作用 | 当前状态 |
| --- | --- | --- |
| `cases[].input` | 原始输入材料或输入摘要 | 可保留，弱约束 |
| `cases[].runtime` | case 级 runtime hint，如是否允许工具、执行模式 | reserved |
| `cases[].preflight` | case 级 preflight 附加元数据 | reserved |
| `cases[].rubric` | 后续评分维度入口 | pending |
| `cases[].transcriptPolicy` | transcript 记录级别 | pending |

建议：

- 文档中先冻结这些命名空间；
- 当前不修改 schema 代码去全面接收它们；
- 下个子计划只需要说明哪些会进入 artifact schema 候选，哪些继续延后。

### 7.3 明确不扩张的字段方向

本子计划应明确：`replay-cases.yaml` 不是执行结果数据库。

所以暂不扩张为：

1. 完整 transcript 内嵌；
2. 多模型结果矩阵内嵌；
3. provider/model/sampling 参数内嵌；
4. sandbox 日志内嵌；
5. 大型 rubric engine 配置中心；
6. case dependency graph；
7. CI job 执行明细。

## 8. normalizeFixture 作为 preflight 上游输入边界

这是本草案最关键的技术边界之一。

### 8.1 现状

`src/skillforge/normalize.mjs` 当前已经把 fixture 整理成更适合作为运行前上游的对象，至少包含：

- `fixtureId`
- `fixtureVersion`
- `profile`
- `entryPath`
- `skillFrontmatter`
- `skillBody`
- `workflowSource`
- `skillSpec`
- `generationRun`
- `skillManifest`
- `replayCases`
- `validationResult`
- `checklist`
- `dependencies`
- `method`
- `permissions`
- `toolBoundary`

### 8.2 建议输入边界

建议未来 preflight 的逻辑输入定义为：

```ts
{
  fixtureDir: string,
  loadedFixture: LoadedFixture,
  normalizedFixture: NormalizedFixture,
  staticReport?: ValidatorReport
}
```

其中：

- `loadedFixture`：保留原始文本/文件上下文，便于回溯；
- `normalizedFixture`：作为 **preflight 主输入对象**；
- `staticReport`：作为已有静态结果证据，可选传入；
- `fixtureDir`：保留路径身份与 artifact 归属。

### 8.3 为什么主输入应是 normalizedFixture

因为它已经做了这些聚合：

- profile 归一；
- permissions 归并；
- tool boundary 提炼；
- replay cases 聚合；
- checklist 维度归一；
- dependency / method 摘要整理。

如果 preflight 重新从 YAML/Markdown 各自散读一遍，会有很高概率出现：

- static 与 preflight 对 profile 的理解不一致；
- permission merge 规则不一致；
- checklist coverage 口径漂移；
- boundary 解释分叉。

所以建议把 `normalizeFixture` 视为 **preflight 的天然接缝**，不要重复造一个半像不像的解析层。

### 8.4 preflight 上游输入边界的明确定义

建议下个子计划把边界写死为：

1. preflight **依赖 normalize 后对象**；
2. preflight **不直接承担文件系统扫描与 YAML 原始解析职责**；
3. preflight **不重算 static validator 已有规则**，只消费其结果或消费 normalize 后对象的稳定字段；
4. preflight 新增检查时，应尽量基于 normalize output 的稳定字段命名，而不是再发明并行字段体系。

## 9. 本子计划的明确非目标

下面这些内容要清楚写成 **不是本子计划目标**：

- runner 实现；
- model/provider 接入；
- sandbox 实现；
- transcript engine；
- tool execution adapter；
- 自动评分引擎；
- CI runtime integration；
- generator；
- UI；
- 发布/registry；
- 跨模型矩阵；
- 跨平台矩阵；
- 将 runtime 混入 `validate:all` 或 `validate:contracts`。

换句话说，这个子计划做的是：

```text
定义进入 runtime 的合同
+ 定义 runtime 执行后的记账格式
- 不执行 runtime
- 不实现 runtime
```

## 10. 推荐拆解顺序

下一子计划最合理的拆解顺序建议如下。

### Step 1：冻结 artifact vocabulary

先定三类 artifact 名称和角色：

1. `replay-cases.yaml`：声明层 artifact；
2. `runtime-preflight-result`：运行前 gate artifact；
3. `runtime-replay-report`：真实执行证据 artifact。

验收口径：

- 三者边界清晰；
- 不互相混型；
- 与当前 static report 关系明确。

### Step 2：冻结最小 shape

为 preflight result 和 runtime replay report 定义最小必填字段与保留字段。

验收口径：

- 可以手写出一个最小示例 artifact；
- 能说清每个字段是“当前必需 / 兼容保留 / 后续 pending”。

### Step 3：冻结 replay-cases runtime-ready contract

明确 `replay-cases.yaml` 中：

- 哪些字段语义已冻结；
- 哪些字段 reserved；
- 哪些内容明确不放进去。

验收口径：

- 不会把 declaration 文件误扩成 execution report；
- `passed/observed` 诚实性口径继续不变。

### Step 4：冻结 normalize-to-preflight 接缝

定义 preflight 的输入对象边界和依赖字段。

验收口径：

- 能列出 preflight 读取 `normalizedFixture` 的哪些核心字段；
- 明确不重复解析整套原始文件语义。

### Step 5：冻结 preflight checks catalog

定义一组最小 preflight checks ID、severity、pass/fail 条件。

验收口径：

- 至少覆盖 static baseline、case identity、boundary declaration、forged runtime result；
- 命名与语义能直接支持后续实现任务。

### Step 6：回写 roadmap / protocol 文档口径

让 roadmap 明确下一阶段是：

```text
artifact schema -> preflight contract -> runner interface（后续）
```

验收口径：

- 文档之间不互相打架；
- 不把 runner 写成当前目标。

## 11. 建议验收标准

该 contract-forward 子计划的验收口径建议限定为文档层，而不是实现层：

1. 新增一份设计文档，完整回答本草案要求的六个问题；
2. 文档中提供 preflight result 与 runtime replay report 的最小示例；
3. 文档明确 `replay-cases.yaml` 冻结 / reserved / pending 边界；
4. 文档明确 `normalizeFixture` 是 preflight 首选上游输入层；
5. 文档列明非目标，防止范围膨胀；
6. roadmap / runtime protocol 文档同步到一致口径；
7. 不改代码、不跑验证、不引入新的“已实现”表述。

## 12. 风险与注意事项

### 12.1 最大风险：把 preflight 做成半个 runner

preflight 的职责是 gate，不是执行。  
一旦把 transcript、评分、模型参数、sandbox 行为都塞进来，就会变成“没跑起来但结构已经乱了”的经典事故。

### 12.2 最大兼容风险：artifact 混型

如果 runtime replay report 直接伪装成 validator report：

- 统计口径会混乱；
- 下游 contract test 容易失真；
- static 与 runtime 的 PASS 语义会互相污染。

所以必须：**同构，但不同 kind**。

### 12.3 normalize 接缝不能被绕开

若 future preflight 不走 `normalizeFixture`，后续极易出现双重事实源：

- validator 一套解释；
- preflight 一套解释；
- runner 再一套解释。

这会让 contract 看起来有三份，实际上谁都说不准。

### 12.4 schema 设计要忍住别过胖

当前 `schema.mjs` 还很轻。  
因此下个子计划最适合做的是 **schema 目标冻结**，而不是一口气把完整 schema engine、enum blocking、artifact migration 全包了。

## 13. 实现同步（当前仅第一段原子实现）

当前代码已落地的范围仅包括：

- 独立 `runtime-preflight-result` artifact/report skeleton；
- 独立 normalize→preflight adapter；
- adapter 明确以 `normalizeFixture()` 输出作为核心上游输入。

当前**仍未实现**：

- runtime runner / transcript / runtime replay report full implementation。

当前**已新增但仍属最小实现**：

- 独立 preflight checks catalog（blocking / warning 分层，不混入 static rules）；
- 独立 preflight evaluator/validator，消费 preflight adapter 输出并产出 `checks / errors / status / summary`；
- 独立 standalone preflight CLI（`scripts/validate-preflight.mjs`），支持单 fixture path + `--format json`，并固定 `0/1/2` exit 语义；
- 独立 preflight contract tests（`scripts/test-preflight-contracts.mjs`），通过单独入口验证 preflight JSON contract / exit code 语义，不影响现有 static contract baseline；
- evaluator 仅实现 runtime-ready gate，不代表 runtime replay、runner 或 transcript 已落地。

因此，当前状态只能说明 **preflight contract 接缝已开始固化**，不能解读为 runtime replay 已完成。

## 14. 结论摘要

基于当前仓库状态，Milestone E 前的最合理下一子计划应聚焦：

1. 先定义 **preflight result artifact**；
2. 再定义 **runtime replay report artifact**；
3. 同时冻结 `replay-cases.yaml` 的 runtime-ready 边界；
4. 明确 `normalizeFixture` 是 preflight 的天然上游输入层；
5. 明确本阶段不做 runner / model / sandbox / CI runtime / generator / UI。

最终建议：

```text
下一步做 contract-forward 文档与 artifact schema 草案，
而不是直接开写 runtime runner。
```

这条路线更稳，也更诚实。先把合同写清楚，后面干活的人才不会被合同反咬一口。
