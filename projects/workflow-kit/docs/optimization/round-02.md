# SkillForge 优化第 2 轮分析

## 1. 本轮目标

第 1 轮已经证明：SkillForge MVP 的文档闭环成立，且无 P0 阻断项。本轮在此基础上继续向前推进，重点不再重复论证“文档是否完整”，而是分析如何从 **文档闭环** 走向 **可执行样例/回放闭环**。

本轮目标具体分为四点：

1. 复盘第 1 轮结论，确认哪些优点必须保持，哪些风险仍未关闭。
2. 提出一个最小可执行样例的落地方案：`Example WorkflowSource -> SkillSpec -> SkillManifest -> ValidationResult`。
3. 将“真实生成器/回放案例尚未落地”的风险拆成可执行的后续动作，但本轮只做分析，不实现代码。
4. 判断是否允许进入第 3 轮，并给出第 3 轮应聚焦的方向。

本轮仍遵守当前任务边界：只产出 `docs/optimization/round-02.md`，不修改既有设计文档，不实现生成器，不提交代码。

## 2. 对第 1 轮结论的复盘

### 2.1 应保持的结论

| 第 1 轮结论 | 本轮判断 | 保持方式 |
|---|---|---|
| 主链路完整：`WorkflowSource -> SkillSpec -> SkillManifest -> ValidationResult -> AcceptanceRecord -> OptimizationRound -> AnalysisDocument` | 继续成立 | 第 2 轮设计最小样例时，必须沿用这条链路，不另造旁路格式 |
| 样本库只读参考，不直接复制 | 继续成立 | 最小样例可以参考样本规律，但不得复制私有路径、用户上下文或特定项目脚本 |
| 7 维验证是 MVP 质量底线 | 继续成立 | 最小回放样例必须覆盖结构、触发、边界、依赖、回放、去隐私、兼容七类检查，哪怕部分先用人工结果表示 |
| 当前无 P0 阻断项 | 继续成立 | 本轮未发现隐私泄漏、主链路断裂、权限默认放行等阻断条件 |
| 10 轮优化需要稳定模板 | 继续成立且更重要 | 本轮继续保留目标、复盘、优点、风险、动作、下一轮建议、结论结构 |

### 2.2 仍未关闭的风险

| 风险 | 第 1 轮状态 | 第 2 轮状态 | 未关闭原因 |
|---|---|---|---|
| 10 轮优化刚开始 | P1 | 仍未关闭 | 当前仅完成 round-01 和本轮分析，还没有形成 10 轮结果链 |
| 样本库局部统计标注不一致 | P2 | 仍未关闭 | 本任务限制只修改 round-02，不能直接修订 `docs/sample-skill-library.md` |
| 跨平台/模型兼容未实测 | P2 | 仍未关闭 | 本轮提出样例方案，但未在多 OS/多模型执行验证 |
| MVP 偏文档闭环，缺少真实生成器/回放案例 | P1 | 本轮重点推进但未关闭 | 需要后续真正补充样例文件、回放数据或生成器实现；本轮只写分析 |
| 验收 checklist 尚未机器化 | P2 | 仍未关闭 | 当前仍是文档级验收，需要后续 schema 或脚本设计 |

本轮的核心判断是：第 1 轮的“文档闭环”足以支撑继续优化，但不足以证明 SkillForge 已经能稳定生成可运行 skill。第 2 轮应把下一步落点从“补文档”收敛到“补最小样例和回放证据”。

## 3. 当前优点与保持/扩大方式

### 优点 1：实体链路已经足够承载最小样例

**表现**：`docs/data-structure.md` 已定义 `WorkflowSource`、`SkillSpec`、`SkillManifest`、`ValidationResult` 的字段和关系；`docs/workflow.md` 已定义从收集、规格化、生成到验证的阶段输入输出。

**如何保持/扩大**：
- 最小样例必须严格使用现有实体，不增加新的核心实体。
- 如果样例发现字段不够，先记录为后续优化问题，不在样例中私自发明不可追踪字段。
- 第 3 轮可把本轮提出的样例映射成可机读 fixture，验证字段是否真的够用。

### 优点 2：7 维验证提供了回放闭环的质量框架

**表现**：验证阶段明确包含结构、触发、边界、依赖、回放、去隐私、兼容。这个框架比单纯检查 `SKILL.md` 是否存在更可靠。

**如何保持/扩大**：
- 最小 `ValidationResult` 不应只写 `passed=true`，而要逐项记录七类检查的结果。
- 回放测试至少包含 2 个正例和 1 个反例，避免只验证 happy path。
- 兼容和去隐私即使暂未全自动，也要在样例中有明确检查项。

### 优点 3：样本库已经抽出可复用模式

**表现**：样本库总结了目录级 `SKILL.md` 入口、frontmatter 最低字段、触发描述、复杂度分层、权限边界和附属文件规律。

**如何保持/扩大**：
- 最小样例优先采用单文件 skill，降低附属文件复杂度。
- frontmatter 只强制 `name` 和 `description`，推荐但不强制 `version`、`metadata.openclaw`。
- description 必须承担触发职责，避免生成“看起来像说明书、实际不会触发”的 skill。

### 优点 4：安全边界已进入设计主流程

**表现**：验收结果和工作流都把隐私、权限、外部消息、文件写入、API 依赖列为重点风险。

**如何保持/扩大**：
- 最小样例默认选择“无外部消息、无网络、无破坏性命令”的场景，先验证基本链路。
- `SkillSpec.permissionBoundary` 和 `SkillManifest.permissions` 必须显式声明，即使是空权限也要写清。
- 回放验证要检查是否泄露私有路径、token、个人信息或项目内部规则。

### 优点 5：优化轮次开始形成固定节奏

**表现**：第 1 轮已经建立“目标、证据、优点、风险、P0/P1/P2、下一轮建议、结论”的结构。本轮继续沿用并针对第 2 轮目标扩展。

**如何保持/扩大**：
- 后续 round-03 到 round-10 不应每轮换结构，否则最终分析难以聚合。
- 每轮都要明确哪些风险关闭、哪些仍未关闭、下一轮具体做什么。
- 即便某轮只做分析，也要说明为什么不直接改代码或文档。

### 优点 6：当前无阻断项，适合小步推进

**表现**：`docs/acceptance-result.md` 结论为 `PASS_WITH_RISK`，且第 1 轮确认无 P0 阻断项。

**如何保持/扩大**：
- 继续用“小样例先行”的方式降低风险，而不是一次性实现完整生成器。
- 每次引入新能力前先定义验证证据，防止代码先行、验收滞后。
- 如果后续发现 P0，如隐私泄漏或权限默认放行，应暂停新增功能，先修安全底线。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：缺少真实最小样例，文档闭环未转化为执行证据

**级别**：P1  
**影响**：当前只能证明设计“可描述”，不能证明一条真实输入能被稳定转成 skill 规格、产物清单和验证结果。

**改善办法**：
- 第 3 轮优先产出一个 `Example WorkflowSource -> SkillSpec -> SkillManifest -> ValidationResult` fixture 或文档样例。
- 样例选择低风险场景：单文件 `SKILL.md`、无外部 API、无写文件副作用、中文触发描述。
- 样例必须包含正反例回放，而不只是静态字段展示。

**关闭条件**：仓库中出现可审查的最小样例，且能从同一份 `WorkflowSource` 追踪到对应 `SkillSpec`、`SkillManifest`、`ValidationResult`。

### 风险 2：真实生成器尚未落地，生成阶段仍靠人工想象

**级别**：P1  
**影响**：没有生成器时，`GenerationRun`、`SkillManifest.files`、验证输入等仍可能只是模板字段，无法发现生成过程中的路径、命名、frontmatter、依赖声明问题。

**改善办法**：
- 先不做完整生成器，先定义“手工生成样例”的输入输出边界。
- 后续再把手工样例中的确定规则提取为生成器需求，例如 slug 规则、entry 固定为 `SKILL.md`、manifest 对账规则。
- 生成器第一版只支持 simple tier，避免一开始处理 scripts/assets/templates 等复杂场景。

**关闭条件**：至少存在一个可运行的生成路径：手工 fixture + 校验脚本，或最小 CLI 能从 `SkillSpec` 生成 `SKILL.md` 和 manifest。

### 风险 3：回放用例未定义，触发质量无法验证

**级别**：P1  
**影响**：description 写得像触发描述，不等于模型真的会在合适场景调用 skill；没有反例时也无法判断误触发风险。

**改善办法**：
- 每个最小样例至少定义 3 条回放：2 条应该触发、1 条不应该触发。
- 回放结果记录为 `ValidationResult.testCases`，包含 input、expected、actual/observed、passed、notes。
- 将“触发准确”和“输出符合步骤”分开判断，避免一个总分掩盖问题。

**关闭条件**：最小样例的 `ValidationResult` 中有明确 test cases，且正例、反例结果均可复查。

### 风险 4：样本库统计标注不一致仍会影响证据可信度

**级别**：P2  
**影响**：虽然不阻断最小样例，但如果后续样例选择或权重策略引用了错误统计，可能造成样本代表性判断失真。

**改善办法**：
- 后续允许修改样本库时，校正“全局 Skills 37 个”与表格编号到 46 的不一致。
- 在统计中区分扫描总量、列出数量、去重数量、重复/构建副本数量。
- 对最小样例只引用稳定规律，不引用有争议的具体数量作为决策依据。

**关闭条件**：`docs/sample-skill-library.md` 中数量口径一致，并说明统计方式或脚本输出。

### 风险 5：跨平台/模型兼容仍停留在原则层

**级别**：P2  
**影响**：最小样例如果只在当前 Linux/OpenClaw 环境中设计，仍无法证明 macOS、Windows、不同 shell、不同模型遵循度下可用。

**改善办法**：
- 第 3 或第 4 轮补充兼容矩阵，至少列出 OS、路径分隔符、shell、OpenClaw 版本、模型假设、网络/命令权限。
- 最小样例强制使用相对路径和纯 Markdown skill，避免平台相关命令。
- 模型兼容先以“指令清晰度”和“触发正反例”做文档级验证，后续再实测。

**关闭条件**：存在一份兼容矩阵；至少完成当前 Linux 环境基线验证；无法实测的 OS/模型有明确待测项。

### 风险 6：验收仍偏人工，机器校验边界不清

**级别**：P2  
**影响**：人工 checklist 能保证设计质量，但不适合后续批量生成或回归测试，容易遗漏 entry、frontmatter、路径、隐私扫描等结构性问题。

**改善办法**：
- 把最小样例中的结构检查拆成机器可校验项：`SKILL.md` 存在、frontmatter 有 `name/description`、manifest entry 对账、无绝对私有路径。
- 把内容质量保留为人工判断：触发语义是否准确、步骤是否可执行、边界是否充分。
- 后续设计 `ValidationResult.checklist` 的标准键名，避免每个样例自由发挥。

**关闭条件**：形成自动检查项清单，或存在最小脚本/schema 能验证 P0/P1 结构规则。

### 风险 7：10 轮优化可能变成重复写报告

**级别**：P1  
**影响**：如果每轮只改标题和措辞，不持续关闭风险，就会违反“10 轮优化实际执行”的初衷。

**改善办法**：
- 从第 3 轮开始，每轮应至少推进一个具体产物或具体设计缺口，例如样例、兼容矩阵、schema、回放记录、最终分析框架。
- 每轮结论中记录风险状态变化：新增、缓解、关闭、仍未关闭。
- 后续 final analysis 应能追溯每轮真实贡献。

**关闭条件**：10 轮文档均有不同焦点，且至少若干关键风险被实际关闭，而不是全部延期。

## 5. 重点设计：最小可执行样例落地方案

本轮建议把第 3 轮的核心产物定义为一个最小样例。它不是完整生成器，也不是复杂 skill，而是一条可追踪、可回放、可验收的样例链。

### 5.1 样例选择原则

| 原则 | 说明 |
|---|---|
| 单文件优先 | 只生成 `SKILL.md`，不引入 `scripts/`、`assets/`、`templates/`，降低路径和依赖复杂度 |
| 无外部副作用 | 不发消息、不调 API、不删除/写入用户文件，避免 P0 风险 |
| 触发场景清晰 | 选择“把一段重复工作流整理成操作清单”这类低歧义任务 |
| 中英格式可兼容 | 正文中文，description 可包含清楚触发语义；后续可扩展英文 `Use when` |
| 可回放 | 有明确正例、反例和预期输出，能写入 `ValidationResult.testCases` |

### 5.2 建议的 Example WorkflowSource

```yaml
workflowSource:
  id: ws_example_meeting_summary_001
  title: 会议纪要整理工作流
  sourceType: manual_example
  language: zh-CN
  content: |
    当用户提供会议记录、讨论要点或飞书会议摘录时，助手需要整理为：
    1. 会议结论
    2. 待办事项
    3. 负责人
    4. 截止时间
    5. 风险或未决问题
    如果信息缺失，应明确标注“未提供”，不要编造。
  context:
    privacy: 示例数据，不含真实个人信息
    externalSideEffects: none
  tags: [meeting, summary, workflow-kit-example]
```

选择这个样例的原因：

1. 任务目标稳定，容易抽象成 skill。
2. 不需要外部 API、脚本或文件写入。
3. 可以设计正例和反例：会议记录应触发，普通闲聊不应触发。
4. 能验证“缺失信息不编造”的安全/质量边界。

### 5.3 建议的 SkillSpec

```yaml
skillSpec:
  id: spec_example_meeting_summary_001
  workflowSourceId: ws_example_meeting_summary_001
  displayName: 会议纪要整理助手
  slug: meeting-summary-assistant
  goal: 将会议记录整理为结论、待办、负责人、截止时间和风险列表
  triggers:
    positive:
      - 用户提供会议记录并要求整理纪要
      - 用户要求从讨论内容中提取 action items
    negative:
      - 用户只是询问日程安排
      - 用户要求发送会议邀请或外部消息
  inputs:
    - name: meetingText
      required: true
      description: 会议记录、讨论摘录或要点文本
  outputs:
    - name: summary
      description: 结构化会议纪要 Markdown
  constraints:
    - 不编造负责人和截止时间，缺失时标注未提供
    - 不发送外部消息
    - 不写入本地文件
  permissionBoundary:
    network: false
    fileWrite: false
    externalMessage: false
    destructiveCommand: false
  successCriteria:
    - 输出包含会议结论、待办事项、负责人、截止时间、风险/未决问题
    - 对缺失信息明确标注未提供
    - 对非会议场景不主动触发
  complexityTier: simple
  validationPlan:
    requiredDimensions: [structure, trigger, boundary, dependency, replay, privacy, compatibility]
```

### 5.4 建议的 SkillManifest

```yaml
skillManifest:
  id: manifest_example_meeting_summary_001
  skillSpecId: spec_example_meeting_summary_001
  name: meeting-summary-assistant
  displayName: 会议纪要整理助手
  version: 0.1.0
  description: 当用户提供会议记录、讨论摘录或要求整理会议纪要/行动项时使用；不用于发送会议邀请或写入文件。
  entry: SKILL.md
  entryFile: SKILL.md
  files:
    - path: SKILL.md
      type: skill_entry
      required: true
  resourceFiles: []
  dependencies:
    packages: []
    cli: []
    mcp: []
    network: false
  permissions:
    network: false
    fileWrite: false
    externalMessage: false
    destructiveCommand: false
  compatibility:
    pathStrategy: relative
    os: [linux, macos, windows]
    shellRequired: false
    modelAssumption: 能遵循 Markdown 结构化输出和正反例触发说明
  status: generated
```

对应 `SKILL.md` 的最小结构建议：

```markdown
---
name: meeting-summary-assistant
description: 当用户提供会议记录、讨论摘录或要求整理会议纪要/行动项时使用；不用于发送会议邀请或写入文件。
version: 0.1.0
---

# 会议纪要整理助手

## 触发场景

- 用户提供会议记录、讨论摘录、会议要点，并要求整理纪要。
- 用户要求提取 action items、负责人、截止时间或未决问题。

## 不应触发

- 用户只是询问日程安排。
- 用户要求发送会议邀请、发送飞书消息或写入本地文件。

## 工作流程

1. 读取用户提供的会议内容。
2. 提取会议结论。
3. 提取待办事项，并标注负责人和截止时间。
4. 列出风险或未决问题。
5. 缺失信息标注“未提供”，不要编造。

## 输出格式

- 会议结论：
- 待办事项：
- 负责人：
- 截止时间：
- 风险/未决问题：

## 边界

- 不发送外部消息。
- 不写入文件。
- 不调用网络 API。
```

### 5.5 建议的 ValidationResult

```yaml
validationResult:
  id: val_example_meeting_summary_001
  skillManifestId: manifest_example_meeting_summary_001
  method: manual_plus_static_check
  checklist:
    structure:
      passed: true
      evidence: 存在 SKILL.md；frontmatter 包含 name、description、version；manifest entry 指向 SKILL.md
    trigger:
      passed: true
      evidence: description 和正文均声明正向触发与不应触发场景
    boundary:
      passed: true
      evidence: 明确禁止外部消息、文件写入、网络 API
    dependency:
      passed: true
      evidence: 无 package、CLI、MCP、network 依赖
    replay:
      passed: partial
      evidence: 已设计 2 个正例和 1 个反例；尚未接入自动回放器
    privacy:
      passed: true
      evidence: 示例不含真实姓名、token、私有路径或项目内部规则
    compatibility:
      passed: partial
      evidence: 使用纯 Markdown 和相对路径；尚未跨 OS/多模型实测
  testCases:
    - id: tc_positive_001
      input: 请把下面会议记录整理成纪要：我们决定周五前完成登录页改版，小陈负责设计稿，接口风险待评估。
      expected: 应触发；输出会议结论、待办、负责人、截止时间、风险
      passed: true
    - id: tc_positive_002
      input: 从这段讨论里提取 action items：下周上线前要补验收文档，负责人未定，截止时间未提供。
      expected: 应触发；缺失负责人或截止时间时标注未提供
      passed: true
    - id: tc_negative_001
      input: 帮我明天下午三点发一个会议邀请给团队。
      expected: 不应触发；这是外部消息/日程发送任务
      passed: true
  score: 0.86
  passed: true
  issues:
    - level: warning
      message: 回放仍为人工记录，未接入自动执行器
    - level: warning
      message: 兼容性未完成跨 OS/多模型实测
```

### 5.6 本轮不实现的原因

本轮只写分析，不直接创建样例 fixture 或生成器，原因是：

1. 任务范围明确只要求产出 round-02 分析文档。
2. 最小样例需要先确认字段、回放标准和关闭条件，否则容易变成又一个不可执行模板。
3. 第 3 轮可以在本方案基础上落地样例，边写边验证，不必本轮越权修改其他文件。

## 6. 优化动作分类

### P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮未发现核心链路断裂、隐私泄漏、权限默认放行、破坏性操作、外部消息默认发送、核心文档缺失等 FAIL 条件。第 2 轮可以继续向可执行样例推进，不需要暂停或回滚第 1 轮结论。

### P1：高优先级动作

| 动作 | 目标 | 建议落点 | 关闭条件 |
|---|---|---|---|
| 落地最小样例链 | 关闭“文档闭环未转执行证据”风险 | round-03 或 `docs/examples/` 等后续允许位置 | 存在 `WorkflowSource -> SkillSpec -> SkillManifest -> ValidationResult` 可追踪样例 |
| 定义回放用例格式 | 验证触发与反触发质量 | 最小样例的 `ValidationResult.testCases` | 至少 2 个正例、1 个反例，且有 expected/passed/notes |
| 固定 round 模板 | 防止 10 轮优化流于形式 | 后续 round-03 到 round-10 | 每轮均包含目标、复盘/证据、优点、风险、动作、下一轮、结论 |
| 明确手工样例到生成器的过渡 | 避免一开始过度实现 | 后续生成器设计 | 先支持 simple tier，再扩展复杂 skill |
| 持续记录风险状态 | 让优化可收敛 | 每轮结论 | 风险能标记为新增/缓解/关闭/仍未关闭 |

### P2：中优先级动作

| 动作 | 目标 | 建议落点 | 关闭条件 |
|---|---|---|---|
| 修正样本库统计标注 | 提升证据可信度 | 后续允许修改 `docs/sample-skill-library.md` 时 | 标题数量、表格编号、去重数量口径一致 |
| 补充兼容矩阵 | 支撑跨平台/模型判断 | round-03/04 或验证设计文档 | 覆盖 OS、路径、shell、OpenClaw 版本、模型假设 |
| 设计机器校验项 | 为自动验证铺路 | 后续 schema/脚本设计 | 能检查 entry、frontmatter、manifest 对账、隐私路径等结构项 |
| 样本降权规则落地 | 避免过拟合当前环境 | 样本库修订或生成策略 | 明确重复样本、构建副本、文档 mirror 的权重 |
| 指标轻量化 | 让最终分析有对比 | 每轮 metrics 小节或结论 | 至少跟踪 P0/P1/P2 风险数量和样例/验证覆盖情况 |

## 7. 本轮指标与风险状态

| 指标 | 第 1 轮 | 第 2 轮 | 变化 |
|---|---:|---:|---|
| P0 阻断项 | 0 | 0 | 无新增阻断 |
| 已知 P1 风险 | 1 | 3 | 新增关注：最小样例缺失、回放未落地；10 轮未完成仍存在 |
| 已知 P2 风险 | 3+ | 4+ | 样本统计、兼容、机器校验、样本过拟合仍待处理 |
| 已完成优化轮次 | 1/10 | 2/10 | 轮次推进 |
| 可执行样例数量 | 0 | 0 | 本轮提出方案但未落地 |
| 回放用例数量 | 0 | 方案中 3 条 | 尚未成为实际 fixture |

说明：P1 风险数量上升不是质量退化，而是本轮把“文档闭环到执行闭环”的隐性缺口显性化。第 3 轮应通过落地最小样例来降低该风险。

## 8. 下一轮重点建议

第 3 轮建议聚焦 **“最小样例落地与回放基线”**，不要再只做宏观设计。

建议优先级如下：

1. **产出一个真实样例链**：将本轮设计的会议纪要样例或等价低风险样例，落成可审查的 `WorkflowSource`、`SkillSpec`、`SkillManifest`、`ValidationResult`。
2. **固定回放格式**：至少包含 2 个正例和 1 个反例，记录 expected、observed、passed、notes。
3. **做一次静态校验**：检查 `SKILL.md`、frontmatter、entry、manifest files、permissions、dependencies、隐私路径。
4. **记录未自动化部分**：明确哪些检查仍是人工判断，哪些未来可以脚本化。
5. **不要急于完整生成器**：第 3 轮先验证样例链是否跑通，再决定第 4 轮是否做 schema/脚本或兼容矩阵。

## 9. 本轮结论

**结论：允许继续第 3 轮优化。**

理由：

1. 本轮未发现 P0 阻断项，现有文档闭环仍然成立。
2. 第 1 轮保留的核心优点可以支撑最小样例落地，不需要推翻数据结构或 workflow。
3. 本轮已经把“真实生成器/回放案例尚未落地”的风险拆解为具体样例方案、回放格式和关闭条件。
4. 第 3 轮应从分析转向实际样例产出，以关闭“文档闭环未转执行证据”的 P1 风险。
