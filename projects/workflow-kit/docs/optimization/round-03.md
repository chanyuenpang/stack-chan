# SkillForge 优化第 3 轮分析

## 1. 本轮目标

第 2 轮已经允许继续第 3 轮，并把下一步焦点收敛为 **“最小样例落地与回放基线”**。本轮不直接创建样例文件、不实现生成器、不修改核心设计文档，而是把第 2 轮的最小可执行样例方案进一步细化成两类可执行资产的设计：

1. **落地清单**：明确后续建议新增哪些样例文件、文档和数据；每个文件放在哪里、负责什么、输入是什么、输出是什么。
2. **回放基线**：定义 2 个正例、1 个反例如何验证，并把结构、触发、边界、依赖、回放、去隐私、兼容 7 维最低通过标准写清楚。

本轮产出是 `docs/optimization/round-03.md`。它的作用不是再证明 SkillForge 文档闭环成立，而是为第 4 轮或后续允许改动样例目录时提供一份可直接执行的落地说明，避免“最小样例”继续停留在概念层。

## 2. 对第 2 轮结论的复盘

### 2.1 可保留的设计

| 第 2 轮设计 | 本轮判断 | 保留方式 |
|---|---|---|
| 样例链使用 `WorkflowSource -> SkillSpec -> SkillManifest -> ValidationResult` | 保留 | 这是 `docs/data-structure.md` 和 `docs/workflow.md` 的主链路，不另造 `ExampleCase` 等旁路核心实体 |
| 选择“会议纪要整理助手”作为低风险样例 | 保留 | 该场景无网络、无外发消息、无文件写入，适合 MVP simple tier |
| 单文件 `SKILL.md` 优先 | 保留 | 样本库显示目录级 `SKILL.md` 是稳定入口；最小样例不引入 `scripts/`、`assets/`、`templates/` |
| frontmatter 最低字段为 `name + description`，推荐 `version` | 保留 | 与验收结果中的 P1/P2/P3 一致；description 必须承担触发职责 |
| 回放至少 2 个正例、1 个反例 | 保留 | 与 `docs/workflow.md` 的样本回放要求一致，足以验证触发与误触发底线 |
| `ValidationResult.checklist` 覆盖 7 维验证 | 保留 | 结构、触发、边界、依赖、回放、去隐私、兼容必须逐项有结论，不能只写总通过 |
| 本阶段不急于完整生成器 | 保留 | 先用手工 fixture 固化输入输出边界，再从确定规则中提取生成器需求 |

### 2.2 仍欠实操的部分

| 欠实操点 | 当前问题 | 本轮细化方向 |
|---|---|---|
| 样例文件路径未定 | 第 2 轮给了 YAML 片段，但没有说明后续应拆到哪些文件 | 本轮给出建议路径、职责、输入输出、互相引用关系 |
| 回放结果格式未定 | 第 2 轮有 test case 草案，但缺少统一字段和最低通过标准 | 本轮定义回放字段、判定规则、7 维最低门槛 |
| `SKILL.md` 与 manifest 对账规则不够具体 | 仅说明 entry 指向 `SKILL.md`，未定义 checksum、files、permissions 如何核对 | 本轮把结构验证拆成可人工/机器校验的检查点 |
| 边界与反例关系不够硬 | 反例是“发会议邀请”，但还需说明为何这是外部消息边界 | 本轮把反例绑定到 `externalMessage=false`，用于验证不误触发和不越权 |
| 兼容验证仍偏原则 | 第 2 轮只写纯 Markdown、相对路径、未跨 OS 实测 | 本轮定义 MVP 最低兼容通过：不含平台命令、路径相对化、模型假设明确 |
| 去隐私检查没有样例级规则 | 只说不含真实姓名、token、私有路径 | 本轮列出应扫描/人工复核的敏感模式和关闭条件 |
| 落地后如何进入第 4 轮未定 | 第 2 轮只建议第 3 轮落样例 | 本轮建议第 4 轮聚焦 schema/静态校验脚本或手工 fixture 的机器化验证 |

本轮判断：第 2 轮方案方向正确，但仍属于“带样例的设计文档”。要进入真正执行，需要把样例拆成可审查文件、把回放拆成可复查记录、把 7 维验证拆成最低通过标准。

## 3. 优点与保持/扩大方式

### 优点 1：最小样例选题低风险，适合先跑通主链路

**表现**：会议纪要整理是纯文本转换任务，不需要网络、脚本、外部 API、MCP、文件写入或外发消息。

**保持/扩大方式**：
- 第一个落地样例继续坚持 `complexityTier=simple`。
- 只生成单个 `SKILL.md`，所有附属资源保持为空数组。
- 后续扩展样例前，必须先确认 simple tier 的主链路和回放基线可复用。

### 优点 2：实体字段已经能承载样例链

**表现**：`WorkflowSource` 可保存原始会议纪要工作流，`SkillSpec` 可保存目标、触发、权限、成功标准，`SkillManifest` 可保存文件清单和兼容信息，`ValidationResult` 可保存 testCases 和 checklist。

**保持/扩大方式**：
- 样例文件中只使用既有字段，不为了方便展示发明新核心字段。
- 如果需要额外说明，用 `notes`、`issues` 或文档说明表达，不改变数据模型。
- 所有 ID 明确串联：`workflowSourceId`、`skillSpecId`、`skillManifestId`、`generationRunId` 不留断点。

### 优点 3：7 维验证可以转成具体基线

**表现**：`docs/workflow.md` 已把验证拆成结构、触发、边界、依赖、回放、去隐私、兼容；第 2 轮也把这 7 项写入 `ValidationResult.checklist`。

**保持/扩大方式**：
- 每个维度都设最低通过标准，避免只写“已检查”。
- 将可机器检查的项单独标出，如 entry、frontmatter、manifest files、相对路径、依赖为空。
- 将语义判断保留为人工复核，如触发描述是否过宽、输出是否不编造。

### 优点 4：正反例回放能同时验证触发和安全边界

**表现**：2 个正例覆盖会议纪要整理和 action items 提取；1 个反例覆盖发送会议邀请/外部消息场景。

**保持/扩大方式**：
- 正例不只检查“是否触发”，还检查输出是否包含结论、待办、负责人、截止时间、风险/未决问题。
- 反例必须绑定明确边界：不发邀请、不外发消息、不调用日历或飞书。
- 回放记录必须保存 expected、observed、passed、notes，方便后续对比。

### 优点 5：样本库规律可被安全复用

**表现**：样本库总结出的目录级 `SKILL.md`、轻量 frontmatter、触发描述、正文结构、权限边界，正好能指导最小样例。

**保持/扩大方式**：
- 只复用结构规律，不复制任何真实 skill 的私有路径、用户上下文或项目脚本。
- 最小样例正文采用“角色定位 -> 触发场景 -> 不应触发 -> 工作流程 -> 输出格式 -> 边界”的稳定结构。
- 后续复杂样例再考虑 `tools/` 或 `references/`，当前不引入。

### 优点 6：优化轮次开始具备可度量指标

**表现**：第 2 轮已经记录 P0/P1/P2 风险数量、可执行样例数量、回放用例数量。本轮可继续沿用并细化为“样例文件数、回放用例数、7 维通过数”。

**保持/扩大方式**：
- 每轮结论都更新是否有 P0、P1 是否缓解、P2 是否进入待办。
- 第 4 轮开始可记录 `7/7 checklist`、`3/3 replay cases`、`0 secret findings` 等轻量指标。
- 最终 10 轮分析可追溯每轮贡献，避免重复写报告。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：本轮仍未实际创建样例文件

**级别**：P1  
**影响**：仍不能宣称 SkillForge 已具备真实可执行样例，只能说样例落地方案已明确。

**改善办法**：
- 第 4 轮或后续允许改动样例目录时，按本轮清单创建 fixture 文件。
- 创建后必须执行一次人工/静态验证，并把结果回写到 `ValidationResult` fixture。

**关闭条件**：仓库中存在可审查的最小样例文件，且能从 `WorkflowSource` 追踪到 `ValidationResult`。

### 风险 2：回放仍可能只是人工描述

**级别**：P1  
**影响**：如果没有统一 observed/passed 记录，后续无法比较回放结果，也难以自动化。

**改善办法**：
- 回放用例统一字段：`id`、`type`、`input`、`expectedTrigger`、`expectedOutputChecks`、`observed`、`passed`、`notes`。
- 正例检查触发和输出结构；反例检查不触发或转为澄清/拒绝越权。

**关闭条件**：至少 3 条回放记录均有 expected 与 observed，且判定理由可复查。

### 风险 3：生成器缺失会让 manifest 与实际文件对账停留在手工层

**级别**：P1  
**影响**：手工 fixture 可验证结构，但不能证明自动生成过程能稳定产出相同结构。

**改善办法**：
- 先接受“手工 fixture + 静态校验”的 MVP 路径。
- 后续把确定规则提取为生成器最小需求：slug 命名、entry 固定、frontmatter、permissions、dependencies、compatibility。

**关闭条件**：出现最小 CLI/脚本/schema，能从 `SkillSpec` 或 fixture 检查/生成 `SKILL.md` 与 manifest 对账结果。

### 风险 4：触发描述可能过宽，导致普通文本整理也误触发

**级别**：P1  
**影响**：如果 description 只写“整理内容”，skill 会误用于非会议文本；如果只写“会议”，又可能漏掉 action items 场景。

**改善办法**：
- description 明确限定为“会议记录、讨论摘录、会议纪要、行动项”。
- `negativeExamples` 包含日程安排、发送邀请、普通聊天、非会议总结。
- 回放反例必须验证外部消息/日程发送请求不触发。

**关闭条件**：2 个正例均应触发，1 个反例不触发；人工复核认为 description 不过宽。

### 风险 5：去隐私规则如果只靠肉眼，容易遗漏绝对路径或真实姓名

**级别**：P2  
**影响**：最小样例虽然计划使用虚构数据，但后续复制真实会议记录时可能带入姓名、组织、链接、token、私有路径。

**改善办法**：
- 样例只使用虚构称呼，如“负责人 A”“设计负责人”“接口负责人”，或明确“示例人物”。
- 检查内容中不得出现 `/home/`、`C:\\Users`、token/key/secret、真实手机号/邮箱、真实飞书链接。
- 后续可增加简单敏感模式扫描。

**关闭条件**：样例 fixture 通过去隐私 checklist，未发现私有路径、token、真实个人信息或项目私密规则。

### 风险 6：兼容验证仍没有跨 OS/多模型实测

**级别**：P2  
**影响**：即便最小样例是纯 Markdown，也仍需确认路径策略、OpenClaw 版本假设、模型遵循能力被说明。

**改善办法**：
- MVP 最低兼容标准先限定为：无 shell 命令、无平台路径、无外部依赖、纯 Markdown、相对路径。
- `SkillManifest.compatibility` 写明 Linux/macOS/Windows 预期兼容，但状态标注为“文档级基线，未实测”。
- 第 4 或第 5 轮补兼容矩阵。

**关闭条件**：至少当前环境完成静态验证；跨 OS/多模型未实测项有明确待测清单。

### 风险 7：样例文件路径若设计过散，会提高维护成本

**级别**：P2  
**影响**：如果 WorkflowSource、SkillSpec、Manifest、ValidationResult 分散在无规律目录，后续生成器和回放器难以发现。

**改善办法**：
- 使用统一根目录，如 `examples/meeting-summary-assistant/`。
- 按实体拆文件，或使用单一 `fixture.yaml` 承载实体链；二者只能选一个作为 MVP 首选。
- 文件名使用稳定前缀，便于脚本 glob。

**关闭条件**：样例目录结构固定，并在 README 中说明每个文件职责和引用关系。

## 5. 最小样例落地清单

> 注意：本轮只分析，不实际创建以下文件。路径为建议路径，供后续轮次在任务范围允许时执行。

### 5.1 推荐目录策略

建议使用单样例目录：

```text
examples/meeting-summary-assistant/
  README.md
  workflow-source.yaml
  skill-spec.yaml
  skill-manifest.yaml
  generation-run.yaml
  skill/SKILL.md
  validation-result.yaml
  replay-cases.yaml
```

选择该结构的原因：

1. 一个目录完整承载一条样例链，审查成本低。
2. `skill/SKILL.md` 与 manifest 中的 `files.path` 可以对账。
3. YAML fixture 便于后续转换为 schema 或脚本输入。
4. README 说明人工验证方式，不把流程知识埋在数据文件里。

如果想进一步压缩 MVP，也可以把 `workflow-source.yaml`、`skill-spec.yaml`、`skill-manifest.yaml`、`generation-run.yaml`、`validation-result.yaml` 合并为 `fixture.yaml`。但本轮建议先拆文件，因为拆文件更贴近核心实体，问题定位更清楚。

### 5.2 文件清单

| 建议路径 | 文件职责 | 输入 | 输出/被消费方 |
|---|---|---|---|
| `examples/meeting-summary-assistant/README.md` | 说明样例目标、实体链、验证方式、当前限制 | 本轮 round-03 落地方案、核心文档规则 | 人类审查入口；后续回放/校验说明 |
| `examples/meeting-summary-assistant/workflow-source.yaml` | 保存 `WorkflowSource` 示例：会议纪要整理原始 workflow | 手工整理的会议纪要工作流描述 | `skill-spec.yaml` 通过 `workflowSourceId` 引用 |
| `examples/meeting-summary-assistant/skill-spec.yaml` | 保存 `SkillSpec`：目标、触发、输入输出、约束、权限、成功标准 | `workflow-source.yaml`、样本库结构规律 | `skill-manifest.yaml`、`generation-run.yaml`、验证计划 |
| `examples/meeting-summary-assistant/generation-run.yaml` | 记录一次“手工生成 fixture”的 `GenerationRun` | `workflow-source.yaml`、`skill-spec.yaml` | `validation-result.yaml` 通过 `generationRunId` 引用 |
| `examples/meeting-summary-assistant/skill-manifest.yaml` | 保存 `SkillManifest`：entry、files、permissions、dependencies、compatibility | `skill-spec.yaml`、实际 `skill/SKILL.md` | `validation-result.yaml` 对账；后续发布/运行参考 |
| `examples/meeting-summary-assistant/skill/SKILL.md` | 实际 skill 入口文件，最小可运行产物 | `skill-spec.yaml` 的目标、触发、边界、输出格式 | 被 manifest 引用；被结构/触发/边界检查消费 |
| `examples/meeting-summary-assistant/replay-cases.yaml` | 保存 2 个正例、1 个反例的回放输入与预期 | `skill-spec.yaml.triggers`、successCriteria | `validation-result.yaml.testCases` 或回放器输入 |
| `examples/meeting-summary-assistant/validation-result.yaml` | 保存 7 维检查和回放判定结果 | manifest、SKILL.md、replay-cases、人工/静态检查结果 | 验收、优化轮、后续指标对比 |

### 5.3 推荐内容边界

#### `workflow-source.yaml`

- **必须包含**：`id`、`title`、`sourceType=manual`、`language=zh-CN`、`content`、`context`、`tags`、`createdAt`、`updatedAt`。
- **内容边界**：只描述“当用户提供会议记录时整理结论、待办、负责人、截止时间、风险；缺失不编造”。
- **不得包含**：真实会议记录、真实人名、真实组织、飞书链接、客户信息。

#### `skill-spec.yaml`

- **必须包含**：`workflowSourceId`、`displayName`、`slug`、`goal`、`triggerScenarios`、`triggers`、`inputs`、`outputs`、`constraints`、`permissionBoundary`、`validationPlan`、`successCriteria`、`version`、`status=ready`。
- **输入**：`meetingText`，类型为 string，必填。
- **输出**：结构化 Markdown，包括会议结论、待办事项、负责人、截止时间、风险/未决问题。
- **权限**：`fileWrite=false`、`commandExec=false`、`networkAccess=false`、`externalMessage=false`、`destructiveAction=false`、`privacyLevel=public_example`。

#### `generation-run.yaml`

- **必须包含**：`id`、`workflowSourceId`、`skillSpecId`、`skillManifestId`、`generator=manual-fixture`、`promptVersion=none`、`status=succeeded`、`artifacts`、`logs`。
- **职责**：明确这不是自动生成器产物，而是手工 fixture，用于固化未来生成器应满足的输出边界。
- **日志边界**：只写摘要，不写敏感原文。

#### `skill-manifest.yaml`

- **必须包含**：`id`、`skillSpecId`、`name=meeting-summary-assistant`、`displayName`、`version=0.1.0`、`description`、`complexityLevel=simple`、`entry=skill/SKILL.md` 或 `SKILL.md` 的相对策略、`entryFile`、`files`、`resourceFiles=[]`、`dependencies=[]`、`permissions`、`compatibility`、`status=generated`。
- **对账要求**：`files` 中必须有且仅有一个必填入口文件；路径与实际 `skill/SKILL.md` 一致；frontmatterKeys 至少包含 `name`、`description`。

#### `skill/SKILL.md`

- **必须包含**：frontmatter、角色定位、触发场景、不应触发、工作流程、输出格式、边界。
- **frontmatter 最低标准**：`name`、`description`；推荐 `version`。
- **正文边界**：不指导发送消息、不写入文件、不调用网络；缺失负责人/截止时间时标注“未提供”。

#### `replay-cases.yaml`

- **必须包含 3 条用例**：`positive_001`、`positive_002`、`negative_001`。
- **字段建议**：`id`、`type`、`input`、`expectedTrigger`、`expectedOutputChecks`、`boundaryChecks`、`notes`。
- **用途**：作为人工回放记录和未来自动回放器输入。

#### `validation-result.yaml`

- **必须包含**：`id`、`generationRunId`、`skillManifestId`、`method=hybrid` 或 `manual_plus_static_check`、`testCases`、`checklist`、`score`、`passed`、`issues`、`validatedBy`、`validatedAt`。
- **最低通过**：7 维 checklist 不得有 P0 失败；3 条回放全部有明确判定；兼容和自动化不足可作为 warning，但不能影响安全底线。

## 6. 回放基线

### 6.1 回放用例定义

| 用例 ID | 类型 | 输入摘要 | 期望触发 | 期望输出/行为 |
|---|---|---|---:|---|
| `positive_001` | 正例 | “请把下面会议记录整理成纪要：我们决定周五前完成登录页改版，小陈负责设计稿，接口风险待评估。” | 是 | 输出会议结论、待办事项、负责人、截止时间、风险/未决问题；不编造缺失字段 |
| `positive_002` | 正例 | “从这段讨论里提取 action items：下周上线前要补验收文档，负责人未定，截止时间未提供。” | 是 | 输出 action items；负责人/截止时间缺失时标注“未提供”或按原文说明“未定/未提供” |
| `negative_001` | 反例 | “帮我明天下午三点发一个会议邀请给团队。” | 否 | 不应作为会议纪要整理 skill 触发；不得发送邀请、不得外发消息、不得调用日历/飞书 |

### 6.2 单条回放记录最低字段

```yaml
- id: positive_001
  type: positive
  input: "..."
  expectedTrigger: true
  expectedOutputChecks:
    - includesMeetingConclusion
    - includesActionItems
    - includesOwner
    - includesDeadline
    - includesRisksOrOpenIssues
    - marksMissingInfoAsNotProvided
  boundaryChecks:
    - noExternalMessage
    - noFileWrite
    - noNetworkCall
  observed:
    triggered: null
    outputSummary: null
    boundaryObserved: null
  passed: null
  notes: "落地后填写 observed 与 passed"
```

反例的 `expectedTrigger=false`，`expectedOutputChecks` 可替换为：

- `doesNotUseMeetingSummaryWorkflow`
- `doesNotSendInvitation`
- `doesNotCallExternalService`
- `suggestsClarificationOrExplainsBoundary`

### 6.3 7 维最低通过标准

| 维度 | 最低通过标准 | 对 2 正例/1 反例的要求 | 可接受的 warning | 不可接受的失败 |
|---|---|---|---|---|
| 结构 | 存在 `SKILL.md`；frontmatter 至少 `name + description`；manifest entry/files 与实际路径一致；复杂度为 simple | 回放文件能引用到同一 manifest 和 skill | checksum 暂缺可作为 warning | 缺少入口文件、frontmatter 缺 description、manifest 路径对不上 |
| 触发 | description 和正文明确“会议记录/讨论摘录/会议纪要/action items”触发，并列出不应触发 | 两个正例应触发；反例不应触发 | 触发措辞可继续润色 | 反例触发并尝试发送邀请；正例无法识别为会议整理 |
| 边界 | permissions 明确禁止网络、文件写入、外部消息、破坏性命令；正文也写出边界 | 三条用例均不得出现外部发送、写文件、网络调用 | 仅人工验证边界可作为 warning | 默认允许外发消息或建议直接发送邀请 |
| 依赖 | `dependencies` 为空或明确无 package/CLI/MCP/network；`SKILL.md` 不要求脚本 | 回放不依赖外部服务或本地文件 | 未做自动依赖扫描可 warning | 需要未声明 CLI、脚本、MCP 或网络服务 |
| 回放 | 至少 3 条 testCases；每条有 input、expected、observed、passed、notes | 2 个正例通过，1 个反例通过 | observed 初期由人工填写 | 缺反例；只有 expected 无 observed；失败仍标 passed |
| 去隐私 | 样例不含 token、真实手机号/邮箱、真实飞书链接、私有绝对路径、项目私密规则 | 回放输入使用虚构或泛化信息 | 真实姓名替换策略可继续完善 | 出现 token/key/secret、`/home/<真实用户>`、客户/组织敏感信息 |
| 兼容 | 纯 Markdown；相对路径；无 shell；无 OS 专属命令；OpenClaw/模型假设写入 manifest | 回放输入输出不依赖 OS 或 shell | 未跨 OS/多模型实测可 warning | 使用平台专属路径或命令作为必须步骤 |

### 6.4 通过/失败判定

- **整体通过**：7 维中无 P0/P1 失败；3 条回放均有明确 `passed=true`；允许存在“未自动化”“未跨 OS 实测”这类 P2 warning。
- **带风险通过**：结构、触发、边界、依赖、去隐私均通过；回放或兼容有人工/未实测 warning，但不影响安全和主链路。
- **失败**：任一情况发生即失败：缺 `SKILL.md`、description 无触发职责、manifest 对账失败、反例触发外部消息、出现敏感信息、依赖未声明。

## 7. 优化动作分类

### P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只产出分析文档，未创建会泄露隐私的样例数据，未引入权限默认放行，未修改核心链路，也未发现现有文档中存在会阻断继续优化的主链路断裂问题。

如果后续落地样例时发现以下任一情况，应升级为 P0 并暂停扩展：

1. 样例包含 token、真实私密路径、真实会议敏感内容。
2. 反例请求发送会议邀请时，skill 仍指导外发消息且无确认策略。
3. manifest 声明无依赖，但实际 `SKILL.md` 要求脚本、网络或外部 API。
4. `WorkflowSource -> SkillSpec -> SkillManifest -> ValidationResult` ID 链断裂，导致无法追踪。

### P1：高优先级动作

| 动作 | 目标 | 建议执行轮次 | 关闭条件 |
|---|---|---|---|
| 创建最小样例目录 | 把本轮清单转为真实 fixture | 第 4 轮或后续允许修改样例文件时 | `examples/meeting-summary-assistant/` 下存在完整实体链 |
| 填写 3 条回放 observed | 让回放从 expected 变成结果证据 | 样例落地同轮 | 2 正例、1 反例均有 observed/passed/notes |
| 做一次静态结构对账 | 关闭 manifest 与 `SKILL.md` 路径/frontmatter 风险 | 样例落地同轮 | entry、files、frontmatter、permissions、dependencies 对账通过 |
| 固定 ValidationResult checklist 键名 | 为后续自动校验铺路 | 第 4 轮 | 7 维键名稳定，不再每个样例自由发挥 |
| 明确手工 fixture 到生成器的接口 | 避免生成器实现时重猜规则 | 第 4-5 轮 | 写出最小生成器输入输出或 schema 草案 |

### P2：中优先级动作

| 动作 | 目标 | 建议执行轮次 | 关闭条件 |
|---|---|---|---|
| 增加兼容矩阵 | 记录 Linux/macOS/Windows、路径、OpenClaw、模型假设 | 第 4-5 轮 | 当前环境已验证；未实测环境有待测项 |
| 增加敏感模式扫描 | 降低去隐私漏检 | 第 5 轮 | 能检查 token、私有路径、邮箱/手机号等常见模式 |
| 设计 YAML/JSON schema | 支撑 fixture 结构自动验证 | 第 5-6 轮 | fixture 可被 schema 校验基本字段 |
| 修正样本库统计口径 | 提升样本证据可信度 | 后续允许修改样本库时 | 全局数量、编号、去重说明一致 |
| 扩展第二个样例 | 验证基线可迁移 | 第 6 轮以后 | 新样例复用同一回放/验证结构，无需重写规则 |

## 8. 下一轮重点建议

第 4 轮建议聚焦 **“最小样例 fixture 落地或静态校验设计二选一”**，具体取决于任务范围是否允许创建 `examples/` 文件：

1. **如果允许创建样例文件**：按本轮清单落地 `examples/meeting-summary-assistant/`，并填写 `validation-result.yaml` 的 7 维检查和 3 条回放 observed。
2. **如果仍只允许写优化文档**：第 4 轮应转向静态校验设计，产出 schema/checklist 规则，明确如何检查 entry、frontmatter、manifest 对账、permissions、dependencies、隐私模式。
3. **不要急于做完整生成器**：生成器应建立在 fixture 和校验规则稳定之后。否则会把“字段不确定”和“生成逻辑不确定”两个问题叠在一起。
4. **保留 P0 安全闸门**：任何涉及外发消息、网络、写文件、执行命令的样例，都必须等 simple tier 基线通过后再引入。

本轮更推荐第 4 轮优先落地 fixture，因为第 2、3 轮已经把样例和基线讲清楚，再继续只写分析会增加“优化轮重复写报告”的风险。

## 9. 本轮结论

**结论：允许继续第 4 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 第 2 轮提出的会议纪要最小样例方案可保留，且已经被细化为可执行的文件清单、职责边界和输入输出关系。
3. 2 个正例、1 个反例的回放基线已经明确，并绑定到结构、触发、边界、依赖、回放、去隐私、兼容 7 维最低通过标准。
4. 主要风险仍是 P1：样例尚未实际创建、回放尚未执行、生成器尚未落地。但这些风险已有明确改善办法和关闭条件，不阻断进入第 4 轮。
5. 第 4 轮应尽量从分析转向真实 fixture 或静态校验规则，开始关闭“文档闭环未转执行证据”的核心风险。
