# SkillForge MVP 核心数据结构

> 项目展示名：SkillForge。仓库/目录可继续使用 `workflow-kit`，对外 slug、包名、命令命名优先使用 `skillforge`。

## 1. SkillForge MVP 数据模型总览

SkillForge MVP 的目标是把一段 workflow/经验沉淀为可复用 AI skill，并通过验收与 10 轮优化持续改进。

核心链路：
```text
WorkflowSource ─────────────────────────────┐
  -> SkillSpec                                │
  -> SkillManifest                            │
  -> GenerationRun                            │
  -> ValidationResult                         │
  -> AcceptanceRecord                         │
  -> OptimizationRound x 10                   │
  -> AnalysisDocument                         │
SampleSkill (样本库) ──参考──> GenerationRun ─┘
```

SkillForge 支持从真实 skill 样本中抽取结构信息，丰富生成时的参考素材。样本来源包括：OpenClaw dev 的 `skills/` 目录、各项目自定义 skill 目录等。


### 1.1 样本库启发（来自真实样本）

本轮修订依据 `docs/sample-skill-library.md` 的 75 个去重真实 skill 样本分析，新增字段和流程主要来自以下发现：

| 样本库发现 | 对数据结构的影响 | 落点 |
|---|---|---|
| 所有样本均以目录级 `SKILL.md` 为入口 | manifest 和 sample 必须显式记录入口文件，默认 `SKILL.md` | `SkillManifest.entry`、`SkillManifest.entryFile`、`SampleSkill.hasSkillMd` |
| frontmatter 核心字段稳定为 `name + description`，常见增强为 `version + metadata`，扩展含 `slug/homepage/allowed-tools/trigger` | 需要记录 frontmatter 字段集合和模式，避免只保存解析后的松散对象 | `SampleSkill.frontmatterKeys`、`SampleSkill.frontmatterPattern`、`SkillManifest.metadata` |
| 复杂度三层：单文件约 60%，`tools/references` 约 25%，`scripts/assets/templates/learnings` 约 15% | 生成前后都要记录复杂度等级和预期/实际附属文件类型 | `SkillSpec.complexityTier`、`SkillManifest.complexityLevel`、`SampleSkill.structureType` |
| 两套触发描述：中文“领域/能力。触发词：...”与英文“Use when ... Examples: ...” | 触发信息不能只用关键词数组，需要保留模式、正例和反例 | `SkillSpec.triggers`、`SampleSkill.triggerPattern`、`SampleSkill.triggerSummary` |
| 复杂 skill 常带 `tools/`、`references/`、`scripts/`、`assets/`、`examples/`、`.learnings/`、`.clawhub/`、`_meta.json` | 附属文件需要按类型、路径和发布策略分类 | `SkillSpec.resourcePlan`、`SkillManifest.resourceFiles`、`SampleSkill.attachedFiles` |
| 工具/权限边界常散落在正文或 metadata，外部 API、消息发送、文件写入需确认 | 规格层需要表达权限意图，manifest 层需要表达实际 allowed tools / runtime dependencies | `SkillSpec.toolBoundary`、`SkillSpec.permissionBoundary`、`SkillManifest.permissions` |
| 生成流程建议 7 类输入、7 维验证 | workflow 抽象、产物清单和验证结果应覆盖目标、触发、权限、工具、经验、输出、隐私，以及结构、触发、边界、依赖、回放、去隐私、兼容 | `SkillSpec.inputs`、`SkillSpec.validationPlan`、`ValidationResult.checklist` |

这些字段不是凭空设计，而是为了让 SkillForge 能从真实样本中复用“入口固定、frontmatter 轻量、触发描述承担选择职责、复杂 skill 通过附属目录扩展、权限边界必须可审计”的结构规律。

模型分层：

| 层级 | 实体 | 作用 |
|---|---|---|
| 样本层 | SampleSkill | 从真实 skill 抽取的结构化样本，作为生成参考 |
| 输入层 | WorkflowSource | 保存原始 workflow、经验、上下文和来源信息 |
| 规格层 | SkillSpec | 将 workflow 抽象成 skill 的目标、触发场景、输入输出和约束 |
| 产物层 | SkillManifest | 描述最终 skill 的元信息、文件结构、版本和运行入口 |
| 运行层 | GenerationRun | 记录从输入到 skill 产物的一次生成过程 |
| 验收层 | ValidationResult、AcceptanceRecord | 记录测试、人工验收、成功标准和结论 |
| 优化层 | OptimizationRound、AnalysisDocument | 记录 10 轮优缺点分析、改进动作和阶段报告 |

---

## 2. 核心实体

### 2.1 WorkflowSource

原始 workflow/经验输入，是 SkillForge 的源材料。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | workflow source 唯一 ID，例如 `wfs_001` |
| title | string | 是 | 输入材料标题 |
| sourceType | enum | 是 | 来源类型：`manual`、`chat`、`doc`、`code`、`mixed` |
| content | string | 是 | 原始 workflow、步骤、经验或对话摘要 |
| context | string | 否 | 业务背景、适用场景、用户意图 |
| owner | string | 否 | 提供者或维护人 |
| tags | string[] | 否 | 分类标签，例如 `math`、`feishu`、`coding` |
| language | string | 否 | 内容语言，默认 `zh-CN` |
| createdAt | string(datetime) | 是 | 创建时间，ISO 8601 |
| updatedAt | string(datetime) | 是 | 更新时间，ISO 8601 |

### 2.2 SkillSpec

从 WorkflowSource 抽象出的 skill 规格，描述“这个 skill 应该解决什么问题”。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | skill spec 唯一 ID，例如 `sks_001` |
| workflowSourceId | string | 是 | 关联的 WorkflowSource ID |
| displayName | string | 是 | 展示名，例如 `SkillForge 数学题工作流沉淀` |
| slug | string | 是 | 稳定标识，使用小写短横线，例如 `skillforge-math-workflow` |
| goal | string | 是 | skill 的目标结果 |
| triggerScenarios | string[] | 是 | 适用触发场景 |
| intent | string | 是 | 要沉淀的 workflow/经验目标，来自样本中的“核心使命/角色定位” |
| domain | string | 否 | 领域、项目或工具类别，例如 `feishu`、`gitnexus`、`math`、`mcp` |
| triggers | object | 是 | 结构化触发定义：pattern(`zh-keywords`/`en-use-when`/`mixed`)、keywords、useWhen、examples、negativeExamples |
| audienceAgent | enum | 否 | 目标执行者：`main`、`subagent`、`coding`、`research`、`verify`、`any` |
| complexityTier | enum | 是 | 预期复杂度：`simple`(仅 SKILL.md)、`standard`(+tools/references)、`advanced`(+scripts/assets/templates/learnings) |
| resourcePlan | object[] | 否 | 预期附属资源计划：type、pathPattern、required、publishable，例如 `tools/*.md`、`scripts/*.py` |
| inputs | object[] | 是 | 输入定义列表，包含名称、类型、说明、是否必填 |
| outputs | object[] | 是 | 输出定义列表，包含名称、类型、说明 |
| constraints | string[] | 否 | 边界、禁止事项、质量约束 |
| toolBoundary | object | 否 | 工具边界：allowedTools、recommendedTools、forbiddenTools、requiredConfirmationTools |
| permissionBoundary | object | 否 | 权限/副作用边界：fileWrite、commandExec、networkAccess、externalMessage、destructiveAction、privacyLevel |
| examples | object[] | 否 | 正例/反例/用户表达样例：type、input、expectedBehavior、note |
| validationPlan | object | 否 | 生成后验证计划，覆盖结构、触发、边界、依赖、样本回放、去隐私、兼容 |
| successCriteria | string[] | 是 | 成功标准，用于验收 |
| version | string | 是 | 规格版本，建议 SemVer，例如 `0.1.0` |
| status | enum | 是 | `draft`、`ready`、`deprecated` |
| createdAt | string(datetime) | 是 | 创建时间 |
| updatedAt | string(datetime) | 是 | 更新时间 |

### 2.3 SkillManifest

skill 产物清单，面向运行、发布和复用。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | manifest 唯一 ID，例如 `skm_001` |
| skillSpecId | string | 是 | 关联 SkillSpec ID |
| name | string | 是 | 包/目录名，使用 `skillforge-*` 格式 |
| displayName | string | 是 | 用户可见名称 |
| version | string | 是 | skill 版本，建议 SemVer |
| description | string | 是 | skill 简介，建议包含可检索触发描述 |
| complexityLevel | enum | 是 | 实际复杂度：`simple`、`standard`、`advanced`，与附属文件数量/类型对应 |
| entry | string | 是 | 入口文件或主说明文件，真实样本固定为 `SKILL.md` |
| entryFile | object | 是 | 入口文件详情：path、frontmatterKeys、checksum |
| files | object[] | 是 | 文件列表：path、purpose、required、fileType |
| resourceFiles | object[] | 否 | 附属文件清单：path、type(`tools`/`references`/`scripts`/`assets`/`templates`/`examples`/`learnings`/`metadata`/`output`)、required、publishable |
| dependencies | string[] | 否 | 运行依赖或外部工具 |
| permissions | object | 否 | 实际权限声明：allowedTools、requiredConfirmations、networkAccess、fileSystemScope、externalServices |
| metadata | object | 否 | frontmatter/publish metadata，如 `metadata.openclaw`、homepage、repository、license、tags |
| configSchema | object | 否 | 可配置项 schema |
| compatibility | object | 是 | 兼容信息，如 OpenClaw 版本、模型假设、路径策略 |
| status | enum | 是 | `generated`、`validated`、`accepted`、`archived` |
| createdAt | string(datetime) | 是 | 创建时间 |
| updatedAt | string(datetime) | 是 | 更新时间 |

### 2.4 GenerationRun

一次从 workflow 输入生成 skill 的执行记录，用于追踪和复现。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | run 唯一 ID，例如 `gen_001` |
| workflowSourceId | string | 是 | 关联 WorkflowSource ID |
| skillSpecId | string | 是 | 关联 SkillSpec ID |
| skillManifestId | string | 否 | 生成成功后关联 SkillManifest ID |
| sampleIds | string[] | 否 | 生成时参考的 SampleSkill ID 列表 |
| generator | string | 是 | 生成器名称或模型/agent 标识 |
| promptVersion | string | 否 | 生成提示词版本 |
| startedAt | string(datetime) | 是 | 开始时间 |
| finishedAt | string(datetime) | 否 | 结束时间 |
| status | enum | 是 | `running`、`succeeded`、`failed`、`cancelled` |
| artifacts | object[] | 否 | 生成产物列表：path、type、checksum |
| logs | string[] | 否 | 关键日志摘要，不保存敏感原文 |
| error | object | 否 | 失败信息：code、message、recoverable |

### 2.5 ValidationResult

对生成 skill 的验证结果，可以来自自动测试、样例测试或人工审查。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | validation 唯一 ID，例如 `val_001` |
| generationRunId | string | 是 | 关联 GenerationRun ID |
| skillManifestId | string | 是 | 被验证的 SkillManifest ID |
| method | enum | 是 | `automated`、`manual`、`hybrid` |
| testCases | object[] | 是 | 测试用例列表：name、input、expected、actual、passed |
| checklist | object[] | 否 | 验收清单：item、passed、note |
| score | number | 否 | 0-100 分质量评分 |
| passed | boolean | 是 | 是否通过验证 |
| issues | object[] | 否 | 问题列表：severity、title、detail、suggestion |
| validatedBy | string | 否 | 验证人、agent 或系统 |
| validatedAt | string(datetime) | 是 | 验证时间 |

### 2.6 OptimizationRound

一轮优化记录。MVP 固定规划 10 轮：`roundNumber` 从 1 到 10。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | optimization round 唯一 ID，例如 `opt_001` |
| skillManifestId | string | 是 | 关联 SkillManifest ID |
| validationResultId | string | 否 | 基于哪次验证结果优化 |
| roundNumber | number | 是 | 第几轮，范围 1-10 |
| objective | string | 是 | 本轮优化目标 |
| strengths | string[] | 是 | 本轮识别出的优点 |
| weaknesses | string[] | 是 | 本轮识别出的缺点 |
| keepOrExpandActions | string[] | 是 | 保持/扩大优点的动作 |
| improvementActions | string[] | 是 | 改善缺点的动作 |
| changes | object[] | 否 | 具体改动：file、summary、reason |
| metricsBefore | object | 否 | 优化前指标，如 score、passRate、latency |
| metricsAfter | object | 否 | 优化后指标 |
| status | enum | 是 | `planned`、`applied`、`validated`、`skipped` |
| createdAt | string(datetime) | 是 | 创建时间 |
| completedAt | string(datetime) | 否 | 完成时间 |

### 2.7 AnalysisDocument

分析文档记录，汇总单轮或多轮优化结论。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | analysis document 唯一 ID，例如 `ana_001` |
| title | string | 是 | 文档标题 |
| path | string | 是 | Markdown 文件路径，例如 `docs/optimization/round-01.md` |
| scope | enum | 是 | `round`、`final`、`acceptance` |
| relatedRoundIds | string[] | 否 | 关联的 OptimizationRound ID 列表 |
| relatedValidationIds | string[] | 否 | 关联的 ValidationResult ID 列表 |
| summary | string | 是 | 分析摘要 |
| keyFindings | string[] | 是 | 关键发现 |
| decisions | string[] | 否 | 本文档沉淀的决策 |
| nextActions | string[] | 否 | 下一步动作 |
| createdBy | string | 否 | 作者或 agent |
| createdAt | string(datetime) | 是 | 创建时间 |
| updatedAt | string(datetime) | 是 | 更新时间 |

### 2.8 AcceptanceRecord

最终或阶段性验收记录，判断 skill 是否达到可用标准。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | acceptance 唯一 ID，例如 `acc_001` |
| skillManifestId | string | 是 | 被验收的 SkillManifest ID |
| validationResultId | string | 是 | 关联 ValidationResult ID |
| accepted | boolean | 是 | 是否验收通过 |
| criteriaResults | object[] | 是 | 成功标准逐项结果：criterion、passed、evidence |
| decision | enum | 是 | `accept`、`reject`、`accept_with_risks` |
| risks | string[] | 否 | 遗留风险 |
| requiredFollowUps | string[] | 否 | 必须后续处理事项 |
| acceptedBy | string | 否 | 验收人或 agent |
| acceptedAt | string(datetime) | 是 | 验收时间 |

### 2.9 SampleSkill

从真实 skill 目录扫描抽取的结构化样本，作为 SkillForge 生成 skill 时的参考素材。

> **说明**：样本扫描已在 `docs/sample-skill-library.md` 完成只读分析。本节根据真实样本补充入口、frontmatter、触发模式、复杂度和附属文件清单字段。

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| id | string | 是 | sample 唯一 ID，例如 `sample_001` |
| originPath | string | 是 | 原始 skill 目录绝对路径，例如 `~/.openclaw/skills/coding-agent-workflow` |
| sourcePath | string | 是 | 样本来源入口文件路径，通常为 `${originPath}/SKILL.md` |
| sourceProject | string | 否 | 来源项目或模块名，例如 `openclaw-dev`、`workflow-kit` |
| sourceType | enum | 是 | `openclaw-official`、`project-custom`、`community`、`docs-mirror`、`plugin`、`build-copy` |
| displayName | string | 是 | skill 展示名 |
| slug | string | 否 | skill slug 标识 |
| directoryStructure | string | 是 | 目录树摘要（text 或 JSON），记录文件和子目录布局 |
| hasSkillMd | boolean | 是 | 是否存在入口 `SKILL.md`；真实样本均为 true |
| structureType | enum | 是 | 结构类型：`single-file`、`with-tools`、`with-references`、`with-scripts`、`with-assets`、`with-learning`、`skill-pack` |
| complexityLevel | enum | 是 | 样本复杂度：`simple`、`standard`、`advanced` |
| frontmatter | object | 否 | SKILL.md 的 YAML frontmatter 解析结果，包含 name、version、description 等字段 |
| frontmatterKeys | string[] | 是 | frontmatter 字段集合，例如 `name,version,description,metadata` |
| frontmatterPattern | enum | 是 | frontmatter 模式：`name-description`、`name-version-description-metadata`、`publish-metadata`、`custom` |
| description | string | 否 | skill 描述文本（从 frontmatter 或 SKILL.md 正文提取） |
| triggerKeywords | string[] | 否 | 触发词/关键短语，用于匹配用户意图 |
| triggerPattern | enum | 是 | 触发模式：`zh-keywords`、`en-use-when-examples`、`frontmatter-trigger`、`implicit`、`mixed` |
| triggerSummary | string | 否 | 触发描述摘要，保留中文“触发词”或英文 “Use when/Examples” 的原始语义 |
| dependencies | string[] | 否 | 运行依赖的工具、服务或其他 skill |
| toolBoundary | object | 否 | 工具边界描述：可用工具列表、禁止工具列表、权限级别 |
| projectSpecificDeltas | object | 否 | 与标准 skill 模板的项目级差异，记录特有字段、自定义逻辑、扩展点 |
| files | object[] | 否 | 文件清单：path、purpose、sizeBytes、lastModified、fileType |
| attachedFiles | object[] | 否 | 附属文件清单：path、type、topLevelDir、extension、sizeBytes、publishable、privacyRisk |
| topLevelDirs | string[] | 否 | 附属顶层目录，如 `tools`、`references`、`scripts`、`assets`、`.learnings` |
| fileTypes | string[] | 否 | 附属扩展名集合，如 `.md`、`.json`、`.py`、`.js`、`.sh`、`.html` |
| duplicateGroup | string | 否 | 同名/同内容/构建副本分组 ID，用于去重降权 |
| quality | object | 否 | 质量评估摘要：completeness(0-1)、hasExamples(boolean)、hasTests(boolean)、reusabilityScore(0-1) |
| tags | string[] | 否 | 分类标签 |
| scannedAt | string(datetime) | 是 | 扫描时间 |
| checksum | string | 否 | 整体校验和，用于判断是否需要重新扫描 |

### 3.1 实体关系

```text
SampleSkill    0..n ──参考──  GenerationRun
SampleSkill    0..n ──参考──  SkillSpec

WorkflowSource 1 ── 1..n SkillSpec
SkillSpec      1 ── 0..n GenerationRun
SkillSpec      1 ── 0..n SkillManifest
GenerationRun  1 ── 0..1 SkillManifest
GenerationRun  1 ── 0..n ValidationResult
SkillManifest  1 ── 0..n ValidationResult
ValidationResult 1 ── 0..n AcceptanceRecord
SkillManifest  1 ── 0..10 OptimizationRound
OptimizationRound 1 ── 0..n AnalysisDocument
ValidationResult 0..n ── 0..n AnalysisDocument
```

**SampleSkill 关系说明**：SampleSkill 是只读参考实体，不参与主链路状态流转。GenerationRun 和 SkillSpec 可引用 0..n 个 SampleSkill 作为生成时的模式参考。

### 3.2 生命周期

0. **样本采集**（可选）：扫描 OpenClaw skills 目录和项目自定义 skill 目录，生成 `SampleSkill` 记录；抽取 `SKILL.md` 入口、frontmatter 模式、触发模式、复杂度等级、附属文件清单和权限边界，作为后续生成的参考素材。
1. **采集输入**：创建 `WorkflowSource`，保存 workflow 原文、上下文、标签。
2. **抽象规格**：生成 `SkillSpec`，明确目标、触发场景、输入输出、约束和成功标准。
3. **生成产物**：创建 `GenerationRun`，产出 `SkillManifest` 和对应文件。
4. **验证质量**：创建 `ValidationResult`，执行样例测试、清单检查和人工审查。
5. **验收成功**：创建 `AcceptanceRecord`，确认是否达到 MVP 可用标准。
6. **十轮优化**：创建 `OptimizationRound` 1-10，每轮记录优点、缺点、保持/扩大动作、改进动作。
7. **分析沉淀**：每轮输出 `AnalysisDocument`，最终形成综合分析文档。
8. **版本演进**：如果优化导致行为或接口变化，更新 `SkillSpec.version` 和 `SkillManifest.version`。

### 3.3 状态流转建议

```text
SkillSpec: draft -> ready -> deprecated
GenerationRun: running -> succeeded | failed | cancelled
SkillManifest: generated -> validated -> accepted -> archived
OptimizationRound: planned -> applied -> validated | skipped
AcceptanceRecord: reject | accept_with_risks | accept
```

---

## 4. 示例 JSON

下面示例覆盖从 workflow 输入，到 skill 输出，再到 validation 和 optimization round 的完整链路。

```json
{
  "sampleSkill": {
    "id": "sample_001",
    "originPath": "~/.openclaw/skills/coding-agent-workflow",
    "sourcePath": "~/.openclaw/skills/coding-agent-workflow/SKILL.md",
    "sourceProject": "openclaw-dev",
    "sourceType": "openclaw-official",
    "displayName": "Coding Agent Workflow",
    "slug": "coding-agent-workflow",
    "directoryStructure": "SKILL.md",
    "hasSkillMd": true,
    "structureType": "single-file",
    "complexityLevel": "simple",
    "frontmatter": {
      "name": "coding-agent-workflow",
      "version": "1.0.0",
      "description": "多专家协同体系中的核心执行者，负责将抽象需求转化为可运行的代码实现"
    },
    "frontmatterKeys": ["name", "version", "description", "metadata"],
    "frontmatterPattern": "name-version-description-metadata",
    "description": "多专家协同体系中的核心执行者，负责将抽象需求转化为可运行的代码实现",
    "triggerKeywords": ["代码", "实现", "bug", "重构", "coding", "开发"],
    "triggerPattern": "implicit",
    "triggerSummary": "编码执行型 workflow；用户需要实现、修复 bug、重构或运行代码时参考。",
    "dependencies": [],
    "toolBoundary": {
      "allowedTools": ["read", "write", "edit", "exec", "glob", "grep"],
      "forbiddenTools": [],
      "permissionLevel": "standard"
    },
    "projectSpecificDeltas": null,
    "files": [
      {
        "path": "SKILL.md",
        "purpose": "skill 主说明",
        "sizeBytes": 4096,
        "lastModified": "2026-05-20T10:00:00+08:00",
        "fileType": "entry"
      }
    ],
    "attachedFiles": [],
    "topLevelDirs": [],
    "fileTypes": [".md"],
    "duplicateGroup": "coding-agent-workflow",
    "quality": {
      "completeness": 0.9,
      "hasExamples": true,
      "hasTests": false,
      "reusabilityScore": 0.85
    },
    "tags": ["coding", "agent", "workflow"],
    "scannedAt": "2026-05-21T03:00:00+08:00",
    "checksum": "sha256:sample_example"
  },
  "workflowSource": {
    "id": "wfs_001",
    "title": "将数学题解题经验转成可复用 Skill",
    "sourceType": "manual",
    "content": "输入一段数学题处理 workflow：先判断题型，提取条件，选择解法，写出步骤，最后检查答案和格式。",
    "context": "用于把稳定的解题协作流程沉淀为 AI skill，便于后续重复使用和优化。",
    "owner": "Yop",
    "tags": ["math", "skillforge", "workflow"],
    "language": "zh-CN",
    "createdAt": "2026-05-21T03:30:00+08:00",
    "updatedAt": "2026-05-21T03:30:00+08:00"
  },
  "skillSpec": {
    "id": "sks_001",
    "workflowSourceId": "wfs_001",
    "displayName": "SkillForge 数学题工作流沉淀",
    "slug": "skillforge-math-workflow",
    "goal": "把数学题处理 workflow 转换为结构化、可验收、可优化的 AI skill。",
    "triggerScenarios": [
      "用户提供稳定 workflow，希望复用为 skill",
      "需要对数学题处理流程进行验收和多轮优化"
    ],
    "intent": "将数学题处理经验沉淀为可触发、可执行、可验收的 AI skill。",
    "domain": "math-workflow",
    "triggers": {
      "pattern": "zh-keywords",
      "keywords": ["数学题", "解题流程", "沉淀 skill", "验收优化"],
      "useWhen": "用户希望把稳定的数学题处理 workflow 转成可复用 skill。",
      "examples": ["把这套解题流程做成 skill", "优化数学题处理 workflow"],
      "negativeExamples": ["只问一道题答案，不需要沉淀流程"]
    },
    "audienceAgent": "subagent",
    "complexityTier": "standard",
    "resourcePlan": [
      {
        "type": "examples",
        "pathPattern": "examples/*.md",
        "required": false,
        "publishable": true
      }
    ],
    "inputs": [
      {
        "name": "workflowText",
        "type": "string",
        "required": true,
        "description": "原始 workflow 文本"
      },
      {
        "name": "sampleTasks",
        "type": "array",
        "required": false,
        "description": "用于验证 skill 的样例任务"
      }
    ],
    "outputs": [
      {
        "name": "skillFiles",
        "type": "array",
        "description": "生成的 skill 文件列表"
      },
      {
        "name": "analysisReport",
        "type": "string",
        "description": "验收和优化分析摘要"
      }
    ],
    "constraints": [
      "不保存敏感原文到公开产物",
      "输出必须包含成功标准和验收方法",
      "优化固定执行 10 轮，每轮必须分析优点和缺点"
    ],
    "toolBoundary": {
      "allowedTools": ["read", "write", "edit"],
      "recommendedTools": ["read", "edit"],
      "forbiddenTools": ["external-message"],
      "requiredConfirmationTools": ["exec"]
    },
    "permissionBoundary": {
      "fileWrite": "workspace-only",
      "commandExec": "confirm-for-risky",
      "networkAccess": false,
      "externalMessage": "forbidden-by-default",
      "destructiveAction": "requires-explicit-confirmation",
      "privacyLevel": "project-private"
    },
    "examples": [
      {
        "type": "positive",
        "input": "把数学解题 SOP 变成一个 skill",
        "expectedBehavior": "生成带目标、触发、步骤、验收和优化计划的 SKILL.md",
        "note": "对应中文触发词模式"
      }
    ],
    "validationPlan": {
      "structure": "必须包含 SKILL.md 和合法 frontmatter",
      "trigger": "description 或触发段落需包含明确触发词",
      "boundary": "外部发送、破坏性操作和隐私边界需显式声明",
      "dependency": "附属文件路径必须存在且可相对解析",
      "sampleReplay": "至少 2 个正例和 1 个反例",
      "privacy": "不得输出敏感原文、绝对私有路径或 token",
      "compatibility": "入口固定为 SKILL.md，路径使用相对路径"
    },
    "successCriteria": [
      "能够从 workflow 生成可读的 SKILL.md",
      "至少一个样例任务验证通过",
      "完成 10 轮优化记录并产出分析文档"
    ],
    "version": "0.1.0",
    "status": "ready",
    "createdAt": "2026-05-21T03:35:00+08:00",
    "updatedAt": "2026-05-21T03:35:00+08:00"
  },
  "generationRun": {
    "id": "gen_001",
    "workflowSourceId": "wfs_001",
    "skillSpecId": "sks_001",
    "skillManifestId": "skm_001",
    "sampleIds": ["sample_001"],
    "generator": "skillforge-mvp-generator",
    "promptVersion": "0.1.0",
    "startedAt": "2026-05-21T03:40:00+08:00",
    "finishedAt": "2026-05-21T03:42:00+08:00",
    "status": "succeeded",
    "artifacts": [
      {
        "path": "skills/skillforge-math-workflow/SKILL.md",
        "type": "markdown",
        "checksum": "sha256:example"
      }
    ],
    "logs": ["生成 SkillSpec", "写入 SKILL.md", "生成 manifest"],
    "error": null
  },
  "skillManifest": {
    "id": "skm_001",
    "skillSpecId": "sks_001",
    "name": "skillforge-math-workflow",
    "displayName": "SkillForge 数学题工作流沉淀",
    "version": "0.1.0",
    "description": "数学题工作流沉淀。触发词：数学题、解题流程、沉淀 skill、验收优化。",
    "complexityLevel": "standard",
    "entry": "SKILL.md",
    "entryFile": {
      "path": "SKILL.md",
      "frontmatterKeys": ["name", "version", "description", "metadata"],
      "checksum": "sha256:entry_example"
    },
    "files": [
      {
        "path": "SKILL.md",
        "purpose": "skill 主说明和执行流程",
        "required": true,
        "fileType": "entry"
      },
      {
        "path": "examples/basic.md",
        "purpose": "基础样例",
        "required": false,
        "fileType": "examples"
      }
    ],
    "resourceFiles": [
      {
        "path": "examples/basic.md",
        "type": "examples",
        "required": false,
        "publishable": true
      }
    ],
    "dependencies": [],
    "permissions": {
      "allowedTools": ["read", "write", "edit"],
      "requiredConfirmations": ["commandExec", "destructiveAction", "externalMessage"],
      "networkAccess": false,
      "fileSystemScope": "skill-directory",
      "externalServices": []
    },
    "metadata": {
      "openclaw": {
        "emoji": "🧩",
        "type": "subagent"
      },
      "tags": ["math", "workflow", "skillforge"]
    },
    "configSchema": {
      "type": "object",
      "properties": {
        "language": {
          "type": "string",
          "default": "zh-CN"
        }
      }
    },
    "compatibility": {
      "displayName": "SkillForge",
      "repositoryPathMayRemain": "workflow-kit",
      "slugPrefix": "skillforge",
      "packagePrefix": "skillforge",
      "openClaw": ">=0.1.0"
    },
    "status": "validated",
    "createdAt": "2026-05-21T03:42:00+08:00",
    "updatedAt": "2026-05-21T03:50:00+08:00"
  },
  "validationResult": {
    "id": "val_001",
    "generationRunId": "gen_001",
    "skillManifestId": "skm_001",
    "method": "hybrid",
    "testCases": [
      {
        "name": "从数学 workflow 生成 skill",
        "input": {
          "workflowText": "判断题型 -> 提取条件 -> 选择解法 -> 写步骤 -> 检查答案"
        },
        "expected": "输出包含目标、触发场景、步骤、验收标准的 SKILL.md",
        "actual": "已生成结构完整的 SKILL.md",
        "passed": true
      }
    ],
    "checklist": [
      {
        "item": "包含成功标准",
        "passed": true,
        "note": "successCriteria 已覆盖"
      },
      {
        "item": "包含 10 轮优化计划",
        "passed": true,
        "note": "docs/optimization/round-01.md 至 round-10.md"
      }
    ],
    "score": 86,
    "passed": true,
    "issues": [
      {
        "severity": "medium",
        "title": "样例数量偏少",
        "detail": "当前只有一个验证样例，覆盖不足。",
        "suggestion": "后续优化轮增加更多题型样例。"
      }
    ],
    "validatedBy": "skillforge-validator",
    "validatedAt": "2026-05-21T03:50:00+08:00"
  },
  "acceptanceRecord": {
    "id": "acc_001",
    "skillManifestId": "skm_001",
    "validationResultId": "val_001",
    "accepted": true,
    "criteriaResults": [
      {
        "criterion": "能够从 workflow 生成可读的 SKILL.md",
        "passed": true,
        "evidence": "artifact 包含 SKILL.md"
      },
      {
        "criterion": "至少一个样例任务验证通过",
        "passed": true,
        "evidence": "testCases[0].passed = true"
      },
      {
        "criterion": "完成 10 轮优化记录并产出分析文档",
        "passed": false,
        "evidence": "当前只完成 round-01，需继续执行 round-02 至 round-10"
      }
    ],
    "decision": "accept_with_risks",
    "risks": ["优化轮次尚未全部完成"],
    "requiredFollowUps": ["补齐 round-02 至 round-10 分析文档"],
    "acceptedBy": "Yop",
    "acceptedAt": "2026-05-21T03:55:00+08:00"
  },
  "optimizationRound": {
    "id": "opt_001",
    "skillManifestId": "skm_001",
    "validationResultId": "val_001",
    "roundNumber": 1,
    "objective": "提升样例覆盖和验收可解释性",
    "strengths": [
      "主流程清晰，能从 workflow 追踪到 skill 产物",
      "成功标准明确，便于验收"
    ],
    "weaknesses": [
      "验证样例数量少",
      "优化动作尚未和指标充分绑定"
    ],
    "keepOrExpandActions": [
      "保留 WorkflowSource -> SkillSpec -> SkillManifest 的主链路",
      "扩展 successCriteria 到更多业务场景"
    ],
    "improvementActions": [
      "增加代数、几何、应用题三个样例",
      "为每轮优化增加 score、passRate 指标对比"
    ],
    "changes": [
      {
        "file": "docs/optimization/round-01.md",
        "summary": "补充第 1 轮优缺点分析和后续动作",
        "reason": "支撑 10 轮优化机制"
      }
    ],
    "metricsBefore": {
      "score": 86,
      "passRate": 1.0,
      "sampleCount": 1
    },
    "metricsAfter": {
      "score": 90,
      "passRate": 1.0,
      "sampleCount": 4
    },
    "status": "validated",
    "createdAt": "2026-05-21T04:00:00+08:00",
    "completedAt": "2026-05-21T04:20:00+08:00"
  },
  "analysisDocument": {
    "id": "ana_001",
    "title": "SkillForge 优化第 1 轮分析",
    "path": "docs/optimization/round-01.md",
    "scope": "round",
    "relatedRoundIds": ["opt_001"],
    "relatedValidationIds": ["val_001"],
    "summary": "第 1 轮确认主链路有效，重点补齐样例覆盖和指标对比。",
    "keyFindings": [
      "数据链路足够支撑 MVP",
      "验收通过不等于优化完成，需要显式追踪 10 轮进度"
    ],
    "decisions": ["保留 SkillForge 展示名", "slug 和 package 统一使用 skillforge 前缀"],
    "nextActions": ["执行 round-02", "补充更多验证样例"],
    "createdBy": "skillforge-optimizer",
    "createdAt": "2026-05-21T04:20:00+08:00",
    "updatedAt": "2026-05-21T04:20:00+08:00"
  }
}
```

---

## 5. Markdown 文件组织建议

建议用 Markdown 保存人可读产物，用 JSON/YAML 嵌入或旁挂保存机器可读索引。

```text
docs/
  data-structure.md                 # 本文档：核心数据结构
  sample-skill-library.md            # 样本库索引（后续任务产出）
  acceptance.md                      # 验收标准、验收记录摘要
  generation-runs/
    gen-001.md                       # 单次生成过程记录
  validation/
    val-001.md                       # 验证结果和测试用例
  optimization/
    round-01.md                      # 第 1 轮优化分析
    round-02.md                      # 第 2 轮优化分析
    round-03.md                      # 第 3 轮优化分析
    round-04.md                      # 第 4 轮优化分析
    round-05.md                      # 第 5 轮优化分析
    round-06.md                      # 第 6 轮优化分析
    round-07.md                      # 第 7 轮优化分析
    round-08.md                      # 第 8 轮优化分析
    round-09.md                      # 第 9 轮优化分析
    round-10.md                      # 第 10 轮优化分析
    final-analysis.md                # 10 轮后的综合分析
```

每个 `docs/optimization/round-XX.md` 建议结构：

```markdown
# SkillForge 优化第 XX 轮分析

## 本轮目标

## 优点

## 缺点

## 保持/扩大优点的动作

## 改善缺点的动作

## 指标对比

## 本轮结论

## 下一轮建议
```

---

## 6. 边界与兼容策略

### 6.1 命名边界

| 场景 | 策略 | 示例 |
|---|---|---|
| 项目展示名 | 使用 `SkillForge` | 文档标题、产品说明、用户可见名称 |
| 现有路径 | 可继续保留 `workflow-kit` | `/home/yankeeting/.openclaw/projects/workflow-kit` |
| slug | 使用 `skillforge` 前缀 | `skillforge-math-workflow` |
| package/name | 使用 `skillforge` 前缀 | `skillforge-core`、`skillforge-mvp-generator` |
| 历史引用 | 不强制批量迁移 | 老文档可写“workflow-kit，即 SkillForge 项目目录” |

### 6.2 数据兼容

1. **ID 稳定**：实体 ID 不随展示名变化而变化。
2. **路径兼容**：已有仓库路径 `workflow-kit` 不影响产物命名；manifest 中显式记录路径策略。
3. **版本兼容**：结构性字段变更升级 `SkillSpec.version`；运行产物变更升级 `SkillManifest.version`。
4. **字段扩展**：新增字段默认向后兼容；删除或改名字段必须提供迁移说明。
5. **敏感信息**：`logs`、`content`、`context` 允许保存摘要；公开文档中避免保存不可外传原文。
6. **10 轮优化约束**：MVP 以 10 轮为固定验收目标；如某轮跳过，仍需创建 `OptimizationRound`，状态设为 `skipped` 并说明原因。

### 6.3 样本库来源与边界

1. **OpenClaw 官方 skills**：从 `~/.openclaw/skills/` 扫描，sourceType 标记为 `openclaw-official`。
2. **项目自定义 skill**：从各项目目录（如 `.openclaw/skills/` 子目录或项目内 skill 目录）扫描，sourceType 标记为 `project-custom`。
3. **社区样本**：预留 `community` 类型，MVP 阶段不主动采集。
4. **只读原则**：SampleSkill 是只读参考，扫描过程不修改原始 skill 文件。
5. **增量扫描**：通过 checksum 判断是否需要重新扫描，避免重复工作。
6. **具体扫描和索引**：由后续 `docs/sample-skill-library.md` 任务完成，当前文档只定义结构。

### 6.4 MVP 不做的事

- 不要求建立数据库；Markdown + JSON/YAML 已足够支撑 MVP。
- 不要求一次性迁移目录名；`workflow-kit` 路径可以继续存在。
- 不要求自动发布 skill；先保证数据结构、流程、验收和 10 轮优化闭环。
- 不把所有中间对话原文写入文档；只保留必要摘要和可复现信息。
