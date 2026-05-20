# SkillForge 优化第 4 轮分析

## 1. 本轮目标

第 3 轮已经把“会议纪要整理助手”的最小样例拆成落地清单与回放基线，但仍停留在可执行前说明。本轮聚焦 **fixture 落地方案与静态校验设计**：不创建 `examples/` 或 `fixtures/` 目录，不实现校验器，不修改核心文档，只把第 3 轮清单收敛为后续执行前可审查的设计规格。

本轮具体目标：

1. 将第 3 轮的建议路径、文件职责、输入输出、2 个正例、1 个反例和 7 维最低通过标准，转成 fixture 设计规格。
2. 明确静态校验器未来应该检查哪些规则，包括 frontmatter、trigger、resourcePlan、toolBoundary、privacy、7 维验证映射等。
3. 定义第 5 轮如果进入“测试矩阵/实现前审查”需要满足的前置条件。
4. 继续跟踪 P0/P1/P2 风险，判断是否允许进入第 5 轮。

## 2. 对第 3 轮结论的复盘

### 2.1 可直接沿用的落地清单

| 第 3 轮结论 | 本轮判断 | 沿用方式 |
|---|---|---|
| 主链路使用 `WorkflowSource -> SkillSpec -> GenerationRun -> SkillManifest -> ValidationResult` | 沿用 | fixture 必须保留 ID 引用链，不引入 `ExampleCase` 等旁路核心实体 |
| 样例选题为“会议纪要整理助手” | 沿用 | 继续作为 simple tier 的首个最小样例，避免网络、写文件、外发消息 |
| 单文件 skill 产物为 `skill/SKILL.md` | 沿用 | manifest 中 `entry` 指向同一相对路径，`files` 有且仅有一个必填 entry |
| frontmatter 最低字段 `name + description`，推荐 `version` | 沿用 | 静态校验把 `name`、`description` 设为 hard rule，`version` 设为 recommended warning |
| 回放基线为 2 个正例、1 个反例 | 沿用 | fixture 中固定 `positive_001`、`positive_002`、`negative_001` 命名 |
| 7 维验证为结构、触发、边界、依赖、回放、去隐私、兼容 | 沿用 | `validation-result.yaml` 必须一一映射 7 个 checklist key |
| 本阶段不急于做完整生成器 | 沿用 | 第 5 轮优先做实现前审查/测试矩阵，不直接扩大生成器范围 |

### 2.2 需要收敛的部分

| 第 3 轮内容 | 需要收敛的问题 | 本轮收敛方案 |
|---|---|---|
| 目录根可选 `examples/meeting-summary-assistant/`，也提到可合并 `fixture.yaml` | 路径策略存在双选项，执行时容易分叉 | 本轮指定 MVP 首选为 `fixtures/meeting-summary-assistant/`，如面向人类展示再镜像到 `examples/`；本轮只写规格 |
| manifest `entry=skill/SKILL.md` 或 `SKILL.md` 均可 | entry 相对基准不清，校验器难判断 | 本轮固定 entry 相对样例根目录：`skill/SKILL.md` |
| `dependencies` 在不同文档中既有数组也有分组对象示例 | 数据形态不完全一致 | fixture 采用对象形态：`packages`、`cli`、`mcp`、`network`，静态校验兼容空数组但建议规范化 |
| `ValidationResult.checklist` 在数据结构中是数组，第 3 轮倾向对象 key | 机器检查需要稳定 key，文档结构需兼容现有模型 | fixture 使用对象 key 便于校验，同时在 README 说明可映射为数组 `{item, passed, note}` |
| 回放 `observed` 初始为 null 还是人工结果 | 如果本轮落地前就写 `passed=true`，会伪造执行证据 | fixture 初始只允许 expected；`observed/passed` 可为 null，进入回放执行后再填写 |
| 去隐私检查只列模式，未说明失败等级 | 无法区分 P0/P1/P2 | 本轮将 token/key/secret、私有绝对路径、真实飞书链接定为 P0；疑似姓名/组织定为 P1；格式问题为 P2 |
| 兼容验证可接受未跨 OS 实测 | 容易被误读成兼容已通过 | fixture 中兼容状态必须写 `documented_not_executed`，不能写成 fully passed |

本轮判断：第 3 轮方向正确，最关键的收敛点是 **固定目录基准、固定 entry 路径、固定 checklist 键名、固定回放状态语义**。否则第 5 轮一旦进入测试矩阵，会先被格式分歧拖住。

## 3. 优点与保持/扩大方式

### 优点 1：从文档闭环推进到 fixture 前规格

**表现**：第 3 轮已经不再停留在“设计存在”，而是列出具体文件、字段和回放用例。本轮进一步把这些内容变成执行前规格。

**保持/扩大方式**：
- 保持“先 fixture、再校验器、最后生成器”的顺序。
- 第 5 轮如果实现前审查通过，再允许创建真实 `fixtures/` 文件。
- 不把 schema、生成器、回放器一次性混做，避免问题定位困难。

### 优点 2：会议纪要样例风险低，适合作为第一条基线

**表现**：该样例不需要网络、脚本、文件写入、MCP、飞书发送或日历 API，权限边界天然简单。

**保持/扩大方式**：
- 继续把 `complexityTier` 固定为 `simple`。
- `resourcePlan` 和 `resourceFiles` 初始为空数组。
- 第二个样例必须等第一条 fixture 的 7 维检查可复用后再引入。

### 优点 3：7 维验证已经能拆成机器规则与人工规则

**表现**：结构、依赖、隐私模式、路径对账更适合机器检查；触发语义、输出质量、边界解释更适合人工复核。

**保持/扩大方式**：
- 静态校验器第一版只检查确定性规则，不假装理解全部语义。
- `validation-result.yaml` 同时保留 `evidence` 和 `notes`，让人工判断有位置落地。
- 每条规则标注 severity，便于 P0/P1/P2 风险治理。

### 优点 4：正反例回放能直接绑定触发边界

**表现**：两个正例覆盖整理会议纪要和提取 action items，一个反例覆盖发送会议邀请/外发消息边界。

**保持/扩大方式**：
- 正例必须检查触发与输出结构，不只检查“会回答”。
- 反例必须检查不触发会议纪要 skill，且不得外发消息。
- 回放用例命名固定，后续测试矩阵可以直接引用。

### 优点 5：数据结构已足够承载 fixture，不需要新增核心实体

**表现**：`WorkflowSource`、`SkillSpec`、`GenerationRun`、`SkillManifest`、`ValidationResult` 均已有字段承载最小样例链。

**保持/扩大方式**：
- 不新增 `FixtureSpec` 作为核心模型；fixture 只是核心实体的 YAML 表达。
- 如果需要执行元信息，放在 README 或 `generation-run.yaml.logs` 摘要，不污染模型。
- 所有新增字段必须能解释为现有字段的子结构或文档说明。

### 优点 6：静态校验可以优先关闭高风险问题

**表现**：P0 风险主要集中在隐私泄漏、权限越界、manifest 与文件不一致，这些都能通过静态检查提前拦截。

**保持/扩大方式**：
- 第 5 轮先列测试矩阵，不急于支持复杂语义评分。
- 对 token、私有路径、外发消息默认允许等问题采用 fail-fast。
- 对跨 OS 未实测、version 缺失等问题只给 warning，避免过度阻断。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：fixture 尚未真实落地

**级别**：P1  
**影响**：当前仍不能证明仓库存在可审查样例，也不能执行路径/frontmatter 对账。

**改善办法**：第 5 轮完成实现前审查后，按本轮规格创建 `fixtures/meeting-summary-assistant/`，并写入实体 YAML 与 `skill/SKILL.md`。

**关闭条件**：样例目录真实存在，且能从 `workflow-source.yaml` 追踪到 `validation-result.yaml`，无 ID 断链。

### 风险 2：静态校验器尚未实现

**级别**：P1  
**影响**：本轮只能定义规则，无法自动发现 frontmatter 缺失、manifest entry 对不上、隐私模式命中等问题。

**改善办法**：第 5 轮先做测试矩阵与实现前审查；第 6 轮或后续再实现最小校验器。

**关闭条件**：存在最小校验命令或脚本，能读取 fixture 并输出结构化 pass/warn/fail 结果。

### 风险 3：YAML 形态与数据结构文档存在局部差异

**级别**：P1  
**影响**：例如 `ValidationResult.checklist` 是对象 key 还是数组、`dependencies` 是数组还是对象，可能导致后续实现争议。

**改善办法**：本轮明确 fixture 优先使用稳定对象 key；若需要写回核心模型，可映射为数组结构。

**关闭条件**：第 5 轮测试矩阵中列出字段映射表，并确认 fixture 形态与核心模型兼容。

### 风险 4：回放记录可能被误填为已执行

**级别**：P1  
**影响**：如果 fixture 初始就写 `passed=true`，会把 expected 当成 observed，破坏验收证据可信度。

**改善办法**：初始 fixture 的 `observed.triggered`、`observed.outputSummary`、`passed` 必须为 null；只有真实人工/自动回放后才能填写。

**关闭条件**：回放记录区分 `expected` 与 `observed`，并有 `validatedAt` 或执行记录说明。

### 风险 5：触发语义仍需要人工判断

**级别**：P2  
**影响**：静态检查能确认 description 包含“会议记录/行动项”等词，但不能保证模型触发完全准确。

**改善办法**：校验器只做关键词和反触发字段存在性检查；语义准确性进入回放测试和人工审查。

**关闭条件**：2 个正例触发、1 个反例不触发，并由人工记录判定理由。

### 风险 6：去隐私规则可能误报或漏报

**级别**：P2  
**影响**：简单正则能抓 token、邮箱、手机号、绝对路径，但对真实姓名、组织名、内部项目代号不稳定。

**改善办法**：P0 模式用机器拦截，P1 模式要求人工复核；fixture 使用“负责人 A/接口负责人/设计负责人”等泛化称呼。

**关闭条件**：隐私检查结果无 P0 命中；P1 疑似项均有人工确认说明。

### 风险 7：兼容矩阵还未执行

**级别**：P2  
**影响**：目前只能说明纯 Markdown、相对路径、无 shell 理论兼容，不能证明 Windows/macOS/不同模型已跑通。

**改善办法**：第 5 轮列出兼容测试矩阵：当前 Linux 静态检查、路径分隔符检查、OpenClaw 版本假设、模型触发回放。

**关闭条件**：至少当前环境完成静态检查；未实测平台均标记为 pending，不得写成 pass。

## 5. Fixture 设计规格

> 本轮只写设计规格，不创建下列文件。后续落地时推荐使用 `fixtures/` 作为机器可读测试资产根目录；如果需要面向用户展示，可再从 fixture 派生 `examples/`。

### 5.1 推荐文件结构

```text
fixtures/meeting-summary-assistant/
  README.md
  workflow-source.yaml
  skill-spec.yaml
  generation-run.yaml
  skill-manifest.yaml
  replay-cases.yaml
  validation-result.yaml
  skill/
    SKILL.md
```

选择 `fixtures/` 优先的原因：

1. 本样例首先服务于校验器、测试矩阵和回放基线，机器可读属性强于展示属性。
2. `fixtures/<slug>/` 可稳定被脚本 glob，避免和产品示例文档混在一起。
3. README 仍保留人类审查入口，必要时可复制为 `examples/meeting-summary-assistant/`。
4. 所有路径均以 fixture 根目录为相对基准，manifest entry 固定为 `skill/SKILL.md`。

### 5.2 文件职责

| 文件 | 内容职责 | 最小输入 | 被谁消费 |
|---|---|---|---|
| `README.md` | 说明样例目标、实体链、文件职责、执行状态、未实测项 | 本轮规格、核心文档约束 | 人工审查、第 5 轮实现前审查 |
| `workflow-source.yaml` | 保存原始 workflow 摘要和隐私上下文 | 会议纪要整理流程描述 | `skill-spec.yaml` |
| `skill-spec.yaml` | 保存目标、触发、输入输出、约束、权限、验证计划 | `workflowSourceId`、样例目标 | manifest、replay、validation |
| `generation-run.yaml` | 记录手工 fixture 生成过程 | source/spec/manifest ID | validation 追踪生成来源 |
| `skill-manifest.yaml` | 描述实际 skill 文件、入口、权限、依赖、兼容 | spec ID、`skill/SKILL.md` | 静态校验器、validation |
| `replay-cases.yaml` | 保存 2 正例、1 反例的输入和 expected | spec triggers、successCriteria | 回放器、validation |
| `validation-result.yaml` | 保存 7 维检查、回放状态、issue、结论 | manifest、replay、静态/人工检查 | 验收与优化分析 |
| `skill/SKILL.md` | 实际 skill 入口文件 | spec 的目标、触发、边界、输出格式 | manifest entry、结构/触发/边界检查 |

### 5.3 命名规范

- 目录名使用 `SkillSpec.slug`：`meeting-summary-assistant`。
- 文件名使用小写短横线，实体名固定：`workflow-source.yaml`、`skill-spec.yaml`、`generation-run.yaml`、`skill-manifest.yaml`、`replay-cases.yaml`、`validation-result.yaml`。
- ID 使用可读前缀：
  - `ws_meeting_summary_001`
  - `spec_meeting_summary_001`
  - `gen_meeting_summary_manual_001`
  - `manifest_meeting_summary_001`
  - `val_meeting_summary_001`
- 回放用例 ID 固定：`positive_001`、`positive_002`、`negative_001`。
- 路径一律相对 fixture 根目录，不出现 `/home/...`、`C:\Users\...` 等私有绝对路径。

### 5.4 最小字段要求

#### `workflow-source.yaml`

必须包含：

- `id`
- `title`
- `sourceType: manual`
- `language: zh-CN`
- `content`
- `context.privacy: public_example`
- `context.externalSideEffects: none`
- `tags`
- `createdAt`
- `updatedAt`

内容要求：只描述会议记录整理、行动项提取、缺失信息不编造；不得包含真实会议、真实个人、真实组织、飞书链接、客户信息。

#### `skill-spec.yaml`

必须包含：

- `id`
- `workflowSourceId`
- `displayName`
- `slug: meeting-summary-assistant`
- `goal`
- `triggerScenarios`
- `intent`
- `domain: meeting-summary`
- `triggers.pattern`
- `triggers.keywords`
- `triggers.examples`
- `triggers.negativeExamples`
- `complexityTier: simple`
- `resourcePlan: []`
- `inputs`
- `outputs`
- `constraints`
- `toolBoundary`
- `permissionBoundary`
- `validationPlan`
- `successCriteria`
- `version: 0.1.0`
- `status: ready`

权限最低要求：

```yaml
permissionBoundary:
  fileWrite: false
  commandExec: false
  networkAccess: false
  externalMessage: false
  destructiveAction: false
  privacyLevel: public_example
```

#### `generation-run.yaml`

必须包含：

- `id`
- `workflowSourceId`
- `skillSpecId`
- `skillManifestId`
- `sampleIds: []`
- `generator: manual-fixture`
- `promptVersion: none`
- `status: succeeded`
- `artifacts`
- `logs`
- `startedAt`
- `finishedAt`

要求：日志只写“手工 fixture，用于固化未来生成器输出边界”等摘要，不保存敏感原文。

#### `skill-manifest.yaml`

必须包含：

- `id`
- `skillSpecId`
- `name: meeting-summary-assistant`
- `displayName`
- `version: 0.1.0`
- `description`
- `complexityLevel: simple`
- `entry: skill/SKILL.md`
- `entryFile.path: skill/SKILL.md`
- `entryFile.frontmatterKeys`
- `files`
- `resourceFiles: []`
- `dependencies`
- `permissions`
- `compatibility`
- `status: generated`

`files` 最低要求：必须有且仅有一个 `required=true` 且 `fileType=entry` 的文件，路径为 `skill/SKILL.md`。

#### `skill/SKILL.md`

必须包含：

- YAML frontmatter：`name`、`description`；推荐 `version`。
- 标题：`# 会议纪要整理助手`。
- `## 触发场景`。
- `## 不应触发`。
- `## 工作流程`。
- `## 输出格式`。
- `## 边界`。

正文最低要求：

- 明确会议记录、讨论摘录、会议纪要、action items 可触发。
- 明确发送会议邀请、外发飞书消息、写入本地文件不应触发。
- 缺失负责人或截止时间时写“未提供”，不编造。
- 不要求调用网络、脚本、MCP、日历或飞书。

#### `replay-cases.yaml`

必须包含 3 条用例。单条最低字段：

```yaml
- id: positive_001
  type: positive
  input: "..."
  expectedTrigger: true
  expectedOutputChecks: []
  boundaryChecks: []
  observed:
    triggered: null
    outputSummary: null
    boundaryObserved: null
  passed: null
  notes: "落地后填写 observed 与 passed"
```

反例 `negative_001` 必须满足：

- `expectedTrigger: false`
- `boundaryChecks` 包含 `noExternalMessage`、`noCalendarCall`、`noFeishuSend`
- 预期行为是说明边界或要求用户确认，而不是执行发送。

#### `validation-result.yaml`

必须包含：

- `id`
- `generationRunId`
- `skillManifestId`
- `method: manual_plus_static_check`
- `testCases`
- `checklist`
- `score`
- `passed`
- `issues`
- `validatedBy`
- `validatedAt`

`checklist` 固定 7 个 key：

```yaml
checklist:
  structure: { status: pending, evidence: "" }
  trigger: { status: pending, evidence: "" }
  boundary: { status: pending, evidence: "" }
  dependency: { status: pending, evidence: "" }
  replay: { status: pending, evidence: "" }
  privacy: { status: pending, evidence: "" }
  compatibility: { status: documented_not_executed, evidence: "" }
```

状态建议只使用：`pass`、`warn`、`fail`、`pending`、`documented_not_executed`。初始未执行时不得写 `pass`。

## 6. 静态校验设计

> 本轮只设计规则，不实现代码。未来校验器输入为 `fixtures/<slug>/`，输出为结构化报告，可用于填充或校对 `validation-result.yaml`。

### 6.1 校验器输入输出

**输入**：

- fixture 根目录路径，例如 `fixtures/meeting-summary-assistant/`。
- 可选规则级别：`strict` 或 `mvp`。MVP 默认只拦 P0/P1。

**输出**：

- `summary.passed`：是否通过静态检查。
- `summary.p0Count/p1Count/p2Count`。
- `checks[]`：每条规则的 `id`、`dimension`、`severity`、`status`、`message`、`evidence`。
- `suggestedValidationPatch`：可选，给 `validation-result.yaml` 的更新建议，但不自动写入。

### 6.2 规则清单

#### A. 文件结构规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `structure.requiredFiles` | P1 | 8 个推荐文件均存在 | 缺任一核心 YAML 或 `skill/SKILL.md` |
| `structure.relativePaths` | P0 | fixture 内引用路径均为相对路径 | 出现 `/home/`、`C:\Users`、`~/.openclaw` 等私有绝对路径 |
| `structure.entryExists` | P0 | manifest entry 指向的文件存在 | `skill/SKILL.md` 不存在或 entry 对不上 |
| `structure.singleEntry` | P1 | simple tier 只有一个 required entry | 多个 required entry 或 entry 类型不明 |

#### B. frontmatter 规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `frontmatter.exists` | P0 | `skill/SKILL.md` 存在 YAML frontmatter | 无 frontmatter |
| `frontmatter.name` | P0 | frontmatter 含 `name` 且等于 manifest name | 缺失或不一致 |
| `frontmatter.description` | P0 | frontmatter 含 `description` | 缺失 description |
| `frontmatter.version` | P2 | 推荐含 `version` 且与 manifest version 一致 | 缺失或不一致，仅 warning |
| `frontmatter.triggerDuty` | P1 | description 包含会议/纪要/action items 等触发语义 | description 只是宣传语或过宽泛 |

#### C. trigger 规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `trigger.positiveExamples` | P1 | `triggers.examples` 至少 2 条 | 少于 2 条 |
| `trigger.negativeExamples` | P1 | `triggers.negativeExamples` 至少包含发送邀请/外发消息类反例 | 缺反例 |
| `trigger.keywordCoverage` | P2 | keywords 覆盖会议记录、会议纪要、action items/待办 | 覆盖不足 |
| `trigger.skillBodySections` | P1 | `SKILL.md` 有触发场景和不应触发章节 | 缺任一章节 |

#### D. resourcePlan / 文件清单规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `resourcePlan.simpleEmpty` | P1 | simple tier 的 `resourcePlan` 应为空或全为非必需 | 声明必需附属资源但未落地 |
| `manifest.resourceFilesEmpty` | P1 | simple tier 的 `resourceFiles` 为空 | 出现未解释附属文件 |
| `manifest.filesMatchActual` | P1 | manifest.files 中 required 文件实际存在 | required 文件缺失 |
| `manifest.noUntrackedRequired` | P2 | fixture 中不存在未声明的 required 产物 | 出现额外产物未说明 |

#### E. toolBoundary / permission 规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `toolBoundary.noForbiddenTools` | P1 | forbiddenTools 包含外发消息/网络/命令类边界或 allowedTools 为空 | allowedTools 默认开放高风险工具 |
| `permission.noNetwork` | P0 | `networkAccess=false` | 允许网络且无确认策略 |
| `permission.noFileWrite` | P0 | `fileWrite=false` | 允许写文件且无确认策略 |
| `permission.noExternalMessage` | P0 | `externalMessage=false` | 允许外发消息或未声明 |
| `permission.noDestructiveAction` | P0 | `destructiveAction=false` | 允许破坏性操作或未声明 |
| `skillBody.boundarySection` | P1 | `SKILL.md` 边界章节与 permissions 一致 | 正文说可发送/写入/联网 |

#### F. dependency 规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `dependencies.emptyForSimple` | P1 | simple tier 无 packages/cli/mcp/network 依赖 | 声明依赖但未解释 |
| `skillBody.noImplicitDependency` | P1 | 正文不要求脚本、API、飞书、日历、数据库 | 出现隐式外部依赖 |
| `generation.artifactsDeclared` | P2 | generation-run artifacts 覆盖 manifest entry | artifacts 缺 entry |

#### G. privacy 规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `privacy.noSecrets` | P0 | 扫描 token/key/secret/password/sk- 等模式 | 命中疑似密钥 |
| `privacy.noPrivatePath` | P0 | 扫描 `/home/`、`C:\Users`、`~/.ssh`、`.env` 等 | 命中私有路径 |
| `privacy.noRealContact` | P0 | 扫描手机号、邮箱、真实飞书链接 | 命中真实联系方式/链接 |
| `privacy.genericPeople` | P1 | 示例人物应为负责人 A、接口负责人等泛化称呼 | 出现疑似真实姓名需人工复核 |
| `privacy.publicExample` | P1 | source/spec 均标注 `privacyLevel/public_example` | 隐私等级缺失 |

#### H. replay 规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `replay.caseCount` | P1 | 至少 2 positive + 1 negative | 用例不足 |
| `replay.expectedFields` | P1 | 每条含 input、expectedTrigger、expectedOutputChecks/boundaryChecks | 字段缺失 |
| `replay.observedNotForged` | P1 | 未执行前 observed/passed 为 null | 无执行记录却写 passed=true |
| `replay.negativeBoundary` | P0 | 反例检查 noExternalMessage/noCalendarCall/noFeishuSend | 反例允许发送邀请 |

#### I. 7 维验证映射规则

| 规则 ID | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|
| `validation.sevenKeys` | P1 | checklist 包含 structure/trigger/boundary/dependency/replay/privacy/compatibility | 缺任一维度 |
| `validation.noPrematurePass` | P1 | 未执行回放前 replay 不得为 pass | 伪造通过 |
| `validation.issueSeverity` | P2 | issues 使用 P0/P1/P2 或 high/medium/low 的稳定级别 | 级别混乱 |
| `validation.compatibilityHonest` | P2 | 未跨 OS 实测时状态为 warning/pending/documented_not_executed | 写成 fully pass |

### 6.3 通过判定

- **静态通过**：P0=0，P1=0；允许 P2 warning。
- **带风险通过**：P0=0，P1 有明确人工豁免和关闭条件；只能进入人工审查，不能直接验收通过。
- **失败**：任一 P0 命中；或 P1 无关闭条件；或 ID 链断裂导致无法追踪。

## 7. 回放执行前置条件

如果第 5 轮要进入“测试矩阵/实现前审查”，至少需要准备以下内容：

1. **路径决策确认**：确认 fixture 根目录使用 `fixtures/meeting-summary-assistant/`，不是同时维护多个等价目录。
2. **字段映射表**：确认 `validation-result.yaml.checklist` 对象 key 如何映射到 `ValidationResult.checklist` 数组模型。
3. **回放状态语义**：确认 expected、observed、passed、validatedAt 的填写时机，禁止未执行就标通过。
4. **静态规则优先级**：确认 P0/P1/P2 规则表，尤其隐私、权限、entry 对账是否 fail-fast。
5. **测试矩阵草案**：至少覆盖结构、frontmatter、manifest 对账、权限边界、依赖、隐私、回放字段、兼容状态。
6. **人工复核清单**：列出机器不能判断的项：触发语义是否过宽、输出格式是否足够、反例边界说明是否清晰。
7. **执行环境说明**：记录当前环境只做文档/静态设计；若后续实测，需记录 OS、OpenClaw 版本、模型或执行者。
8. **非目标声明**：第 5 轮不应直接实现完整生成器，不应引入复杂 skill，不应创建含真实会议内容的数据。

满足以上条件后，第 5 轮可以选择两条路线之一：

- **路线 A：测试矩阵/实现前审查**：继续不改 fixture，只把规则转成测试矩阵，降低实现风险。
- **路线 B：fixture 落地**：在任务范围允许时创建真实 fixture，并进行一次人工静态审查。

本轮更建议第 5 轮走路线 A。原因是第 4 轮刚刚收敛路径和规则，先做实现前审查能避免第 5 轮一边建文件一边改规则。

## 8. 优化动作分类

### P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只创建优化分析文档，没有新增 fixture 数据、没有写入真实会议内容、没有放开权限、没有实现会误操作的外部消息/文件写入/网络逻辑，也没有修改核心数据结构。

后续若出现以下任一情况，应立刻升级为 P0 并暂停继续扩展：

1. fixture 中出现 token、key、secret、真实飞书链接、真实手机号/邮箱或私有绝对路径。
2. `permissionBoundary.externalMessage` 或 manifest permissions 默认允许外发消息。
3. 反例“发送会议邀请”被标记为应触发或 passed。
4. manifest entry 指向不存在文件，导致主链路无法审计。
5. `WorkflowSource -> SkillSpec -> GenerationRun -> SkillManifest -> ValidationResult` ID 链断裂。

### P1：高优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---|---|
| 固定 fixture 路径与 entry 基准 | 避免 examples/fixtures、SKILL.md/skill/SKILL.md 分叉 | 第 5 轮 | 测试矩阵明确唯一基准 |
| 建立字段映射表 | 解决 checklist、dependencies 等结构差异 | 第 5 轮 | fixture YAML 与核心模型可双向解释 |
| 完成静态校验测试矩阵 | 为实现校验器降风险 | 第 5 轮 | 每条规则有输入、预期、严重级别、通过/失败样例 |
| 防止回放伪通过 | 保证 expected 与 observed 分离 | 第 5 轮 | 未执行回放时 passed 必须为 null/pending |
| 落地最小 fixture | 关闭“只有设计无样例”的 P1 风险 | 第 5 或第 6 轮，视任务范围 | fixture 目录存在且静态审查通过 |

### P2：中优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---|---|
| 设计兼容矩阵 | 记录 Linux/macOS/Windows、路径、OpenClaw、模型假设 | 第 5-6 轮 | 当前环境验证，其他环境 pending |
| 增加隐私扫描模式清单 | 降低 token/路径/联系方式漏检 | 第 6 轮 | P0 隐私模式可机器拦截 |
| 定义 schema 草案 | 支撑 YAML 基础结构校验 | 第 6-7 轮 | 必填字段和 enum 可被 schema 表达 |
| 增加第二个负例 | 覆盖普通闲聊或非会议总结误触发 | 第 6 轮以后 | 不影响最小 2 正 1 反基线 |
| 汇总指标 | 让 10 轮优化可比较 | 每轮 | 记录 P0/P1/P2、fixture 数、规则数、回放数 |

## 9. 下一轮重点建议

第 5 轮建议聚焦 **“测试矩阵与实现前审查”**，不要急于实现完整校验器，也不要同时扩展第二个样例。

建议第 5 轮具体产出：

1. 静态校验测试矩阵：每条规则给出检查对象、成功输入、失败输入、严重级别、预期结果。
2. fixture 字段映射表：解释 YAML fixture 与 `docs/data-structure.md` 核心实体字段的关系。
3. 回放执行审查表：明确 expected/observed/passed/validatedAt 的状态流转。
4. 兼容矩阵草案：当前 Linux 静态可验证项、跨 OS/多模型 pending 项。
5. 是否允许第 6 轮实现最小校验器或落地 fixture 的决策。

如果任务范围允许创建 `fixtures/`，第 5 轮也可以改为“fixture 落地 + 人工静态审查”。但本轮更推荐先做测试矩阵，因为它能提前发现规则冲突，减少实现返工。

## 10. 本轮结论

**结论：允许继续第 5 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 第 3 轮的最小样例清单可以沿用，且本轮已收敛路径、entry、checklist、回放状态等关键分歧。
3. fixture 设计规格已覆盖文件结构、职责、命名规范、最小字段要求和回放基线。
4. 静态校验设计已列出未来校验器应检查的 frontmatter、trigger、resourcePlan、toolBoundary、privacy、7 维验证映射等规则。
5. 主要遗留风险仍是 P1：fixture 未落地、校验器未实现、字段映射需确认。但这些风险都有第 5 轮可执行的关闭路径，不阻断继续优化。

第 5 轮应优先把本轮规则转成测试矩阵和实现前审查材料；若任务范围明确允许，再进入真实 fixture 落地。