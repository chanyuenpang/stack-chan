# SkillForge MVP 验收成功标准

> 本文定义 SkillForge MVP 的验收目标、范围、检查清单、判定规则和记录模板。验收对象是“把 workflow/经验生成可复用 AI skill 的完整设计闭环”，而不是完整商业化产品。

## 1. MVP 验收目标

确认 SkillForge 具备将 workflow、经验、对话或代码中的可复用做法，转化为 AI skill 的完整设计闭环：

```text
WorkflowSource
  -> SkillSpec
  -> GenerationRun
  -> SkillManifest + SKILL.md/附属文件设计
  -> ValidationResult（7 维验证）
  -> AcceptanceRecord（PASS / FAIL / 带风险通过）
  -> OptimizationRound × 10
  -> AnalysisDocument / acceptance-result.md
```

验收成功表示：

1. 数据结构能承载从原始 workflow 到 skill 产物、验证、验收、10 轮优化的全链路信息。
2. 流程能解释每一步输入、输出、人工确认点和失败回退。
3. 样本库分析已反哺设计，生成规则不是凭空假设。
4. 验收标准可执行、可记录、可复盘。
5. 后续可以基于这些文档实现真实 UI、CLI 或自动化生成器。

## 2. 验收范围与非范围

### 2.1 本阶段验收范围

| 范围项 | 必须验收的内容 |
|---|---|
| 文档设计 | `docs/data-structure.md`、`docs/workflow.md`、`docs/sample-skill-library.md`、`docs/acceptance.md` 是否形成闭环 |
| 数据结构 | `WorkflowSource`、`SkillSpec`、`SkillManifest`、`GenerationRun`、`ValidationResult`、`AcceptanceRecord`、`OptimizationRound`、`AnalysisDocument`、`SampleSkill` 是否覆盖 MVP 链路 |
| 样本驱动设计 | 是否基于真实 skill 样本抽取入口、frontmatter、触发模式、复杂度、附属文件、权限边界 |
| 端到端流程 | 是否定义收集、规格化、生成、验证、验收、10 轮优化、分析沉淀 |
| 产物设计 | 是否明确 `SKILL.md`、frontmatter、附属文件、manifest、兼容策略 |
| 验证机制 | 是否固定覆盖结构、触发、边界、依赖、回放、去隐私、兼容 7 维 |
| 验收记录 | 是否可填写 `AcceptanceRecord`、`ValidationResult`、`OptimizationRound` 和后续 `acceptance-result.md` |

### 2.2 本阶段非范围

本阶段不要求：

- 真实产品 UI 完全实现。
- 自动化 skill 生成器完全实现。
- 数据库存储或后台服务实现。
- 真实 skill 发布、安装、市场分发。
- 10 轮优化已经实际完成所有代码/文档改动；但必须定义可执行机制和记录格式。
- 将项目目录 `workflow-kit` 强制改名；展示名使用 `SkillForge`，路径可继续保留 `workflow-kit`。

## 3. 可执行验收 Checklist

填写建议：每项填 `PASS`、`FAIL` 或 `RISK`；证据必须引用文档章节、文件路径、检查结果或人工观察。

### 3.1 数据结构验收

| # | 检查项 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| D1 | 主链路实体完整 | 已定义 `WorkflowSource -> SkillSpec -> GenerationRun -> SkillManifest -> ValidationResult -> AcceptanceRecord -> OptimizationRound -> AnalysisDocument` |  |  |
| D2 | 样本实体存在 | 已定义 `SampleSkill`，且说明只读参考关系 |  |  |
| D3 | 字段覆盖输入/输出/约束 | `SkillSpec` 包含目标、触发、输入、输出、约束、权限、成功标准 |  |  |
| D4 | 产物清单可审计 | `SkillManifest` 包含入口、文件列表、附属文件、依赖、权限、兼容信息 |  |  |
| D5 | 验证与验收可追踪 | `ValidationResult` 与 `AcceptanceRecord` 可关联 run/manifest，并记录证据 |  |  |
| D6 | 10 轮优化可表达 | `OptimizationRound.roundNumber` 支持 1-10，包含优点、缺点、动作、指标、状态 |  |  |
| D7 | 状态流转清晰 | 已定义 spec/run/manifest/round/acceptance 的状态流转 |  |  |
| D8 | 兼容命名策略清楚 | 说明 `SkillForge` 展示名与 `workflow-kit` 路径兼容策略 |  |  |

### 3.2 样本库验收

| # | 检查项 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| S1 | 样本来源可追踪 | 记录扫描来源、命令、总量、去重估计 |  |  |
| S2 | 入口规律明确 | 确认真实样本均以目录级 `SKILL.md` 为入口 |  |  |
| S3 | frontmatter 规律明确 | 总结 `name + description`、`name + version + description + metadata` 等模式 |  |  |
| S4 | 触发模式明确 | 总结中文“触发词”和英文 `Use when ... Examples` 模式 |  |  |
| S5 | 复杂度分层明确 | 区分 simple / standard / advanced，包含附属目录类型 |  |  |
| S6 | 权限风险提取 | 总结外部消息、文件写入、API、脚本等边界风险 |  |  |
| S7 | 去重和过拟合风险处理 | 说明重复样本降权，样本只做模式参考不复制内容 |  |  |

### 3.3 流程验收

| # | 检查项 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| W1 | 端到端链路完整 | 覆盖收集、规格化、生成、验证、验收、优化、分析 |  |  |
| W2 | 每阶段输入输出明确 | 每阶段定义目标、输入、处理动作、输出 |  |  |
| W3 | 人工确认点明确 | 每阶段列出需要人工确认的关键问题 |  |  |
| W4 | 失败回退策略明确 | 每阶段提供失败场景和回退动作 |  |  |
| W5 | 样本库参与流程明确 | 说明样本如何参与规格化和生成，而非直接复制 |  |  |
| W6 | MVP 完成判定明确 | 定义一个流程实例完成所需条件 |  |  |

### 3.4 生成产物设计验收（SKILL.md / frontmatter / 附属文件）

| # | 检查项 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| P1 | 入口文件固定 | 产物必须包含 `SKILL.md`，manifest `entry=SKILL.md` |  |  |
| P2 | frontmatter 最低字段 | `SKILL.md` frontmatter 至少包含 `name`、`description` |  |  |
| P3 | frontmatter 推荐字段 | 推荐包含 `version`、`metadata.openclaw`；发布型可扩展 homepage/repository/license/tags |  |  |
| P4 | description 承担触发职责 | description 包含触发词或 `Use when`，不是纯宣传语 |  |  |
| P5 | 正文结构可执行 | 正文包含角色/目标、触发、流程、边界、检查清单、输出规范 |  |  |
| P6 | 附属文件必要且声明 | `tools/`、`references/`、`scripts/`、`assets/`、`examples/` 等只在必要时出现，并写入 manifest |  |  |
| P7 | 依赖与副作用声明 | 脚本、CLI、MCP、网络/API、外发消息、文件写入均有依赖和确认策略 |  |  |
| P8 | 路径相对化 | 附属文件使用相对路径；私有绝对路径不得进入可发布产物 |  |  |

### 3.5 7 维验证验收

| # | 维度 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| V1 | 结构 | 有 `SKILL.md`；frontmatter 合法；manifest 文件清单与实际文件一致 |  |  |
| V2 | 触发 | 正例能触发，反例不误触发；description/触发段落边界清晰 |  |  |
| V3 | 边界 | 外部操作、破坏性操作、写文件、网络/API、隐私边界有明确约束 |  |  |
| V4 | 依赖 | 脚本、包、CLI、模板、MCP、服务依赖已声明且路径可解析 |  |  |
| V5 | 回放 | 至少 2-3 个正例、1-2 个反例可用于样本回放 |  |  |
| V6 | 去隐私 | 不含 token、密钥、账号、私有绝对路径、不可公开业务细节 |  |  |
| V7 | 兼容 | 说明 OpenClaw 版本、OS/路径差异、模型假设、`workflow-kit` 路径兼容 |  |  |

### 3.6 10 轮优化机制验收

| # | 检查项 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| O1 | 固定 10 轮 | 机制要求 `roundNumber=1..10` 无缺口 |  |  |
| O2 | 每轮有目标 | 每轮必须填写 `objective` |  |  |
| O3 | 每轮找优点 | 每轮必须填写 `strengths` |  |  |
| O4 | 每轮找缺点 | 每轮必须填写 `weaknesses` |  |  |
| O5 | 每轮有动作 | 每轮必须填写 `keepOrExpandActions` 和 `improvementActions` |  |  |
| O6 | 每轮有结果 | 每轮记录 `changes`、`metricsBefore/After` 或跳过原因 |  |  |
| O7 | 每轮后验证 | 应生成或引用新的 `ValidationResult`；跳过轮次需说明无需重验的理由 |  |  |
| O8 | 最终分析 | 完成 `AnalysisDocument(scope=final)` 或等价 final analysis 文档 |  |  |

### 3.7 文档完整性验收

| # | 检查项 | 通过标准 | 结果 | 证据/备注 |
|---:|---|---|---|---|
| C1 | 核心文档存在 | `docs/data-structure.md`、`docs/workflow.md`、`docs/sample-skill-library.md`、`docs/acceptance.md` 均存在 |  |  |
| C2 | 文档互相引用一致 | 数据结构、流程、样本库、验收标准中的实体和术语一致 |  |  |
| C3 | 没有空泛验收项 | checklist 每项都有可观察证据或填写位置 |  |  |
| C4 | 风险可追踪 | 风险和阻断项能映射到验证维度或优化轮次 |  |  |
| C5 | 后续结果文档可填写 | 明确定义 `docs/acceptance-result.md` 的填写方式 |  |  |

## 4. PASS / FAIL / 带风险通过 判定规则

### 4.1 结果枚举

| 判定 | AcceptanceRecord.decision | accepted | 含义 |
|---|---|---:|---|
| PASS | `accept` | true | 已满足 MVP 验收目标，无 P0/P1 阻断风险 |
| FAIL | `reject` | false | 未满足核心目标，或存在阻断问题，必须回退修改 |
| 带风险通过 | `accept_with_risks` | true | 主链路可用，但存在可接受风险，必须记录后续处理 |

### 4.2 PASS 条件

同时满足以下条件才可判定 PASS：

1. 所有 P0/P1 检查项通过：数据结构主链路、流程主链路、7 维验证定义、验收记录模板、隐私与权限边界。
2. checklist 中关键项无 `FAIL`：D1-D6、S1-S7、W1-W6、P1-P5、V1-V7、O1-O5、C1-C5。
3. 不存在未处理的敏感信息、token、密钥、真实私有路径泄漏。
4. `workflow-kit` 路径兼容策略已明确，不影响 SkillForge 对外命名。
5. `docs/acceptance-result.md` 可按本文模板直接填写。

### 4.3 FAIL 条件

任一条件成立即判定 FAIL：

1. 缺少核心文档之一，或 `docs/acceptance.md` 不存在。
2. 数据结构无法表达 `ValidationResult`、`AcceptanceRecord` 或 10 轮 `OptimizationRound`。
3. 流程没有覆盖从 workflow 到 skill，再到验证、验收、优化的闭环。
4. 未定义 7 维验证，或缺少去隐私/权限边界验证。
5. 样本库没有证据支撑，无法说明设计来自真实 skill 规律。
6. 存在 P0 隐私泄漏、破坏性操作未确认、外部消息默认发送等不可接受风险。
7. 验收记录没有证据字段，无法复盘为什么通过或失败。

### 4.4 带风险通过条件

满足主链路和关键验收项，但存在以下可控风险时，可判定带风险通过：

1. 部分非关键 checklist 为 `RISK`，但有明确 `requiredFollowUps`。
2. 真实产品 UI 或自动化生成器尚未实现；本阶段本来不要求。
3. 10 轮优化尚未实际执行完，但机制、模板、判定规则已完整定义。
4. 样本覆盖仍可能偏向 OpenClaw 当前环境，但已记录过拟合风险和降权策略。
5. 某些兼容项需要后续实测，例如 Windows/macOS/Linux 差异、模型版本差异。

带风险通过必须写明：风险列表、影响范围、负责人/处理方式、预计在哪一轮优化或后续任务关闭。

## 5. 验收记录模板

下面模板用于后续 `docs/acceptance-result.md`，也可嵌入单次验收报告。

### 5.1 AcceptanceRecord 模板

```yaml
acceptanceRecord:
  id: acc_001
  skillManifestId: skm_001
  validationResultId: val_001
  accepted: true
  decision: accept | reject | accept_with_risks
  criteriaResults:
    - criterion: "数据结构支持完整设计闭环"
      passed: true
      evidence: "docs/data-structure.md 定义主链路实体与关系"
    - criterion: "流程覆盖收集到 10 轮优化"
      passed: true
      evidence: "docs/workflow.md 定义端到端流程和 MVP 完成判定"
    - criterion: "验收标准可执行"
      passed: true
      evidence: "docs/acceptance.md 提供 checklist、判定规则和记录模板"
  risks:
    - "示例：真实样本可能过拟合 OpenClaw 当前环境"
  requiredFollowUps:
    - "示例：在第 1-2 轮优化中增加跨来源样本权重检查"
  acceptedBy: "Yop / 验收 agent"
  acceptedAt: "YYYY-MM-DDTHH:mm:ss+08:00"
```

### 5.2 ValidationResult 模板

```yaml
validationResult:
  id: val_001
  generationRunId: gen_001
  skillManifestId: skm_001
  method: manual | automated | hybrid
  testCases:
    - name: "正例：从 workflow 生成 skill 设计"
      input: "给定一段可复用 workflow"
      expected: "能生成包含目标、触发、流程、验收、优化机制的 skill 设计"
      actual: "待填写"
      passed: true
    - name: "反例：一次性问答不应沉淀为 skill"
      input: "只问一道题答案，不要求复用流程"
      expected: "不触发 SkillForge 生成流程"
      actual: "待填写"
      passed: true
  checklist:
    - item: "结构"
      passed: true
      note: "SKILL.md/frontmatter/manifest 规则已定义"
    - item: "触发"
      passed: true
      note: "触发词、Use when、反触发已定义"
    - item: "边界"
      passed: true
      note: "权限和副作用边界已定义"
    - item: "依赖"
      passed: true
      note: "脚本、CLI、MCP、模板依赖需声明"
    - item: "回放"
      passed: true
      note: "要求 2-3 正例和 1-2 反例"
    - item: "去隐私"
      passed: true
      note: "要求扫描 token、绝对路径、私密业务信息"
    - item: "兼容"
      passed: true
      note: "说明 workflow-kit 路径与 SkillForge 命名兼容"
  score: 0
  passed: true
  issues:
    - severity: low | medium | high | critical
      title: "待填写"
      detail: "待填写"
      suggestion: "待填写"
  validatedBy: "验收 agent"
  validatedAt: "YYYY-MM-DDTHH:mm:ss+08:00"
```

### 5.3 OptimizationRound 模板

```yaml
optimizationRound:
  id: opt_001
  skillManifestId: skm_001
  validationResultId: val_001
  roundNumber: 1
  objective: "本轮优化目标"
  strengths:
    - "本轮识别出的优点 1"
    - "本轮识别出的优点 2"
  weaknesses:
    - "本轮识别出的缺点 1"
    - "本轮识别出的缺点 2"
  keepOrExpandActions:
    - "如何保持或扩大优点"
  improvementActions:
    - "如何改善缺点"
  changes:
    - file: "docs/xxx.md"
      summary: "改动摘要"
      reason: "改动原因"
  metricsBefore:
    score: 0
    passRate: 0
    issueCount: 0
  metricsAfter:
    score: 0
    passRate: 0
    issueCount: 0
  status: planned | applied | validated | skipped
  skippedReason: "仅当 status=skipped 时填写"
  createdAt: "YYYY-MM-DDTHH:mm:ss+08:00"
  completedAt: "YYYY-MM-DDTHH:mm:ss+08:00"
```

## 6. 后续 docs/acceptance-result.md 填写方式

`docs/acceptance-result.md` 是实际验收结果文档，不替代本文标准。建议结构如下：

```markdown
# SkillForge MVP 验收结果

## 1. 验收结论

- 结论：PASS / FAIL / 带风险通过
- 验收时间：YYYY-MM-DD HH:mm +08:00
- 验收人：
- 对应版本 / commit / 文档快照：

## 2. 验收对象

- docs/data-structure.md：摘要和版本
- docs/workflow.md：摘要和版本
- docs/sample-skill-library.md：摘要和版本
- docs/acceptance.md：摘要和版本

## 3. Checklist 结果汇总

| 分类 | PASS | FAIL | RISK | 结论 |
|---|---:|---:|---:|---|
| 数据结构 |  |  |  |  |
| 样本库 |  |  |  |  |
| 流程 |  |  |  |  |
| 生成产物设计 |  |  |  |  |
| 7 维验证 |  |  |  |  |
| 10 轮优化机制 |  |  |  |  |
| 文档完整性 |  |  |  |  |

## 4. 关键证据

- 数据结构证据：
- 样本库证据：
- 流程证据：
- 验证证据：
- 优化机制证据：

## 5. ValidationResult

粘贴或引用本文 5.2 模板的实际填写结果。

## 6. AcceptanceRecord

粘贴或引用本文 5.1 模板的实际填写结果。

## 7. OptimizationRound 计划或结果

- round-01：目标 / 状态 / 关键发现
- ...
- round-10：目标 / 状态 / 关键发现

## 8. 风险与后续动作

| 风险 | 严重级别 | 影响 | 后续动作 | 关闭条件 |
|---|---|---|---|---|
|  |  |  |  |  |
```

填写规则：

1. 不只写“通过”，必须给证据。
2. `FAIL` 项必须写回退动作。
3. `RISK` 项必须写 `requiredFollowUps` 和关闭条件。
4. 若判定带风险通过，必须说明为什么风险不阻断 MVP。
5. 若后续真实产物、验证结果或优化轮次发生变化，应更新 `acceptance-result.md`，不要改写本文标准。

## 7. 风险与阻断项

| 风险/阻断项 | 严重级别 | 类型 | 触发条件 | 处理要求 |
|---|---|---|---|---|
| 真实样本过拟合 | P1 | 风险 | 过度依赖 gitnexus/feishu/OpenClaw 当前环境重复样本 | 去重降权；按来源、领域、复杂度分层抽样；记录样本选择理由 |
| 私有上下文泄漏 | P0 | 阻断 | 文档或产物含 token、密钥、账号、用户私密路径、不可公开业务规则 | 立即 FAIL；脱敏后重新验证 |
| 路径名 `workflow-kit` 兼容问题 | P2 | 风险 | 外部展示名 SkillForge 与仓库路径 workflow-kit 混用导致命名混乱 | 文档中固定策略：展示名 SkillForge，路径可保留 workflow-kit，slug/package 优先 skillforge |
| 触发范围过宽 | P1 | 风险 | description 过泛，导致一次性问答也触发 SkillForge | 增加反触发样例；重写触发词和 Use when |
| 触发范围过窄 | P2 | 风险 | 只有特定措辞能触发，泛化不足 | 增加正例表达和同义触发词 |
| 附属文件过度设计 | P2 | 风险 | 简单 skill 生成大量 tools/scripts/assets | 按 complexityTier 控制；无必要不拆分 |
| 脚本依赖不可复现 | P1 | 风险 | scripts 未声明解释器、包、CLI、系统依赖 | 补充 dependencies 和兼容说明；必要时移除脚本 |
| 外部消息/写操作边界不清 | P0 | 阻断 | 飞书、邮件、Discord、文件写入、破坏性命令未要求确认 | 立即 FAIL；补充权限和确认策略 |
| 7 维验证缺项 | P1 | 阻断 | 结构、触发、边界、依赖、回放、去隐私、兼容任一维度未定义 | 补齐验证项后重新验收 |
| 10 轮优化流于形式 | P1 | 风险 | 每轮没有优点/缺点/动作/指标或跳过原因 | 强制使用 OptimizationRound 模板；缺项不得 PASS |
| 验收证据不足 | P1 | 阻断 | AcceptanceRecord 只有结论，没有 criteriaResults/evidence | 回到验证/验收阶段补证据 |
| 样本复制而非模式提炼 | P1 | 风险 | 直接复制项目 skill 的专有规则、路径、学习文件 | 改为抽象模式；`.learnings/`、`output/` 默认不进入公开产物 |

## 8. 最小验收结论模板

实际验收时可以用下面的短结论放在 `docs/acceptance-result.md` 顶部：

```markdown
## 验收结论

结论：PASS / FAIL / 带风险通过

理由：
1. 数据结构：PASS / FAIL / RISK，证据：...
2. 样本库：PASS / FAIL / RISK，证据：...
3. 流程：PASS / FAIL / RISK，证据：...
4. 产物设计：PASS / FAIL / RISK，证据：...
5. 7 维验证：PASS / FAIL / RISK，证据：...
6. 10 轮优化机制：PASS / FAIL / RISK，证据：...
7. 文档完整性：PASS / FAIL / RISK，证据：...

遗留风险：
- ...

必须后续动作：
- ...
```
