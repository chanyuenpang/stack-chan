# SkillForge Roadmap：从静态 MVP 到最终形态

> 本路线图用于指导 SkillForge 后续任务拆分。当前仓库目录仍为 `workflow-kit`，对外产品名优先使用 `SkillForge`。
>
> 重要边界：当前“静态 MVP 通过”只表示单 fixture 与静态 validator 在当前环境下验证通过；**不等于真实模型回放通过，不等于跨平台/跨模型兼容通过，也不等于完整产品 PASS**。

## 1. 当前状态概览

### 1.1 已完成能力

| 类别 | 状态 | 证据 |
|---|---|---|
| 文档设计闭环 | 已完成 | `docs/data-structure.md` 定义核心实体；`docs/workflow.md` 定义端到端流程；`docs/acceptance.md` 定义验收标准 |
| 10 轮优化分析 | 已完成 | `docs/optimization/round-10.md` 汇总 round-01 至 round-10，形成 Go/No-Go 与边界收敛 |
| 文档/设计验收 | 已完成，结论为 `PASS_WITH_RISK` | `docs/acceptance-result.md` |
| 单 fixture 静态 MVP | 已完成 | `fixtures/meeting-summary-assistant/**` 作为正例 fixture |
| JSON validator | 已完成最小静态校验器 | `pnpm --silent validate:fixture fixtures/meeting-summary-assistant --format json` 可输出稳定 JSON |
| 正例静态验证 | 通过 | `docs/static-mvp-validation-report.md` 记录 exit `0`、15 条规则全 pass、P0/P1/P2=`5/8/2` |
| 关键反例静态验证 | 已有证据 | 缺 description、secret/private path、伪 replay、缺 7 维 checklist 等反例均能失败并输出合法 JSON |

### 1.2 仍未完成 / PENDING

| 能力 | 当前状态 | 为什么不能宣称已完成 |
|---|---|---|
| 运行时模型回放 | PENDING | 目前只有静态 replay 诚实性检查，没有真实模型 transcript、observed 输出和人工/自动评分 |
| 跨平台兼容 | PENDING | 当前证据来自 Linux + 当前 Node/pnpm 环境，未覆盖 macOS/Windows 路径、shell、换行与权限差异 |
| 跨模型兼容 | PENDING | 未验证不同模型对同一 skill 的触发、边界遵循、输出稳定性 |
| 隐私 evidence 去重 | PENDING | 已能脱敏，但同文件同模式 evidence 可能重复，报告噪音仍需治理 |
| checklist 多来源聚合语义说明 | PENDING | 规则会从多个 YAML/Markdown 来源聚合七维 checklist，需在规则说明与诊断中明确 |
| 完整生成器 | PENDING | 还不能从任意 workflow 自动生成完整 skill 文件树 |
| UI | PENDING | 尚无可视化录入、审核、回放、发布界面 |
| CI | PENDING | validator 尚未接入 PR/发布门禁 |
| 自动化验收矩阵 | PENDING | 尚无多 fixture、多平台、多模型、多反例的系统矩阵 |

### 1.3 当前边界判定

- 可以说：SkillForge 已完成“文档设计闭环 + 单 fixture 静态 MVP + JSON validator + 正例静态验证”。
- 不可以说：SkillForge 已完成真实模型回放、完整生成器、完整产品验收、跨平台/跨模型兼容。
- 后续所有报告必须区分：`static_checked`、`runtime_replay_pending`、`cross_platform_pending`、`product_pending`。

## 2. 最终形态愿景

SkillForge 的最终形态是一个把 workflow、经验、对话、代码规则沉淀为可复用 AI skill 的系统，覆盖：

```text
workflow/经验输入
  -> 结构化抽取 WorkflowSource
  -> 规格化 SkillSpec
  -> 生成 SkillManifest + SKILL.md + 附属资源
  -> 静态验证 ValidationResult
  -> 真实模型回放与评估
  -> 人工/自动验收 AcceptanceRecord
  -> 发布到 registry / 团队空间
  -> 使用反馈与 10 轮/持续优化
  -> 新版本 skill
```

最终系统应具备：

1. **输入收集**：支持手写 workflow、对话摘要、项目规则、代码片段、历史 skill 样本。
2. **结构化规格化**：抽取目标、触发、输入输出、权限边界、隐私等级、成功标准。
3. **skill 生成**：生成 `SKILL.md`、frontmatter、清晰触发描述、正文流程、边界、检查清单和必要附属文件。
4. **静态验证**：检查结构、触发、边界、依赖、回放声明、隐私、兼容七维规则。
5. **真实模型回放**：用正例/反例驱动真实模型执行，记录 transcript、observed、评分和失败原因。
6. **验收与发布**：支持 PASS / FAIL / ACCEPT_WITH_RISKS，发布到本地、团队 registry 或其他分发渠道。
7. **持续优化**：基于使用日志、回放失败、人工反馈和版本 diff 进行持续改进。
8. **团队协作**：支持评审、权限、版本、所有者、变更记录、风险豁免和回滚。

## 3. 阶段路线

### Phase 0：文档闭环与静态 MVP（已完成）

**目标**

建立 SkillForge 的概念、数据结构、流程、验收标准、优化闭环，并完成一个可复现的单 fixture 静态 MVP。

**主要产物**

- `docs/data-structure.md`
- `docs/workflow.md`
- `docs/acceptance.md`
- `docs/acceptance-result.md`
- `docs/optimization/round-01.md` 至 `round-10.md`
- `fixtures/meeting-summary-assistant/**`
- JSON 静态 validator
- `docs/static-mvp-validation-report.md`

**任务列表**

- [x] 定义核心实体：`WorkflowSource`、`SkillSpec`、`SkillManifest`、`GenerationRun`、`ValidationResult`、`AcceptanceRecord`、`OptimizationRound`、`AnalysisDocument`、`SampleSkill`。
- [x] 定义端到端流程：收集、规格化、生成、验证、验收、优化、分析。
- [x] 定义 7 维验收：结构、触发、边界、依赖、回放、隐私、兼容。
- [x] 完成 10 轮优化分析。
- [x] 创建单个正例 fixture。
- [x] 实现最小静态 validator 与 JSON 输出。
- [x] 固化正例静态验证报告。

**验收标准**

- 文档闭环可解释从 workflow 到 skill 的完整链路。
- 单 fixture 静态校验 exit `0`。
- JSON report 包含版本、summary、checks、findings/evidence 等关键字段。
- 关键反例能以非 0 exit 和合法 JSON 报告失败。

**风险**

- 静态验证容易被误解为运行时验证。
- 单 fixture 可能导致规则过拟合。
- 文档与实现可能随迭代漂移。

**退出条件**

已满足。后续进入 Phase 1 时必须保持 Phase 0 证据可复现，不得把 pending 能力写成已完成。

---

### Phase 1：稳定静态 validator 与开发体验

**目标**

把当前最小 validator 从“能跑”稳定为“可维护、可诊断、适合开发者日常使用”的工具。

**主要产物**

- 稳定 CLI 参数与退出码约定。
- 规则清单与规则 ID 文档。
- 更清晰的 JSON report schema 草案。
- evidence 去重和诊断可读性优化。
- checklist 多来源聚合语义说明。
- 本地开发指南。

**任务列表**

1. 固化命令契约：输入 fixture 路径、`--format json`、exit code、stdout/stderr 责任。
2. 梳理规则注册表：每条规则包含 ID、dimension、severity、scope、失败条件、修复建议。
3. 明确 P0/P1/P2 策略：P0 阻断，P1 默认阻断或需明确豁免，P2 warning。
4. 实现 evidence 去重：同文件、同规则、同模式、同位置附近的 evidence 合并。
5. 明确 checklist 聚合语义：说明来自 manifest、validation、README、SKILL.md 等来源的聚合逻辑。
6. 优化错误信息：让失败报告能直接指导 fixture 作者修复。
7. 增加开发者文档：如何创建 fixture、如何运行校验、如何解释报告。
8. 防止规则过拟合：标注 generic 与 fixture-profile 规则，避免业务关键词硬编码。

**验收标准**

- 正例 fixture 继续通过。
- 已有反例矩阵继续失败，且 evidence 无明显重复噪音。
- 每个 `checks[].id` 都能在规则清单中找到定义。
- checklist 聚合逻辑在文档和报告诊断中一致。
- 重复运行同一命令，summary 与 checks 状态稳定。

**风险**

- 过早设计复杂 schema，拖慢后续 fixture 扩展。
- 为了美化报告弱化 P0/P1 阻断能力。
- 规则说明和代码实现继续漂移。

**退出条件**

- validator 输出契约稳定。
- 规则清单、报告字段、开发指南三者一致。
- 静态 MVP 的正例与关键反例可持续复现。

---

### Phase 2：多 fixture 与 schema/CI

**目标**

从单 fixture 扩展到多类型 fixture，用 schema 与 CI 把静态质量变成可持续门禁。

**主要产物**

- 多 fixture 集合：至少覆盖 simple、standard，后续准备 advanced。
- Fixture schema / report schema。
- CI workflow 或等价自动化入口。
- 自动化反例矩阵。
- 兼容性基础矩阵：Node/pnpm 版本、Linux 优先，预留 macOS/Windows。

**任务列表**

1. 新增至少 2 个非会议类 simple fixture，验证规则通用性。
2. 新增 1 个 standard fixture，包含必要附属目录，例如 `references/` 或 `tools/`。
3. 抽象 fixture schema：ID 链、entry、manifest、validation、replay cases、privacy 声明。
4. 抽象 report schema：版本、环境、summary、checks、findings、pending 项。
5. 建立 CI：PR 中运行全部正例 fixture 和反例矩阵。
6. 建立 snapshot 或 contract test：稳定 JSON 关键字段，避免报告随意变形。
7. 将静态验证报告生成纳入发布前步骤。
8. 按来源和复杂度标注 fixture，避免样本偏置。

**验收标准**

- 全部正例 fixture 静态验证通过。
- 反例矩阵在 CI 中稳定失败且输出合法 JSON。
- schema 能捕获结构性错误。
- CI 能阻断 P0/P1 失败。
- 报告明确区分静态通过与运行时 pending。

**风险**

- fixture 数量扩张导致维护成本上升。
- schema 过严导致真实 skill 难以接入；过松又失去质量门禁。
- CI 只覆盖 Linux，跨平台问题继续隐藏。

**退出条件**

- 多 fixture 证明规则非单样例过拟合。
- schema 与 validator 实现对齐。
- CI 成为静态质量基线。

---

### Phase 3：真实模型回放与评估

**目标**

把“静态 replay 声明”升级为“真实模型执行证据”，验证 skill 在不同正例/反例、模型和环境下是否真的有效。

**主要产物**

- Runtime replay runner。
- Replay transcript 记录格式。
- observed/passed 评分机制。
- 多模型/多平台评估矩阵。
- 人工复核与自动评分结合的验收报告。

**任务列表**

1. 定义 replay case 运行协议：输入、环境、工具权限、期望输出、禁止行为、观察字段。
2. 实现或接入真实模型回放 runner，记录完整 transcript。
3. 明确 observed 与 expected 的关系：未执行不得填 passed=true。
4. 设计评分 rubric：触发正确性、边界遵守、输出质量、隐私安全、稳定性。
5. 运行正例与反例：至少 2-3 个正例、1-2 个反例/fixture。
6. 引入多模型矩阵：至少覆盖当前主模型与一个对照模型。
7. 引入跨平台抽样：Linux 必跑，macOS/Windows 至少进入计划或抽样实测。
8. 将 runtime 结果回写为 `ValidationResult` / `AcceptanceRecord` 的证据。

**验收标准**

- 每个 runtime pass 都有 transcript、observed 输出和评分依据。
- 失败 case 能归因：触发失败、边界失败、输出质量失败、工具/平台失败等。
- 报告明确区分 static pass 与 runtime pass。
- 至少一个 fixture 完成真实模型回放闭环。
- 反例不应被模型误触发或越界执行。

**风险**

- 模型输出不稳定，导致测试 flaky。
- 回放过程可能涉及隐私或外发风险。
- 不同模型能力差异导致评分难统一。
- 工具调用与沙箱边界不清会放大安全风险。

**退出条件**

- 有可复现的 runtime replay 报告。
- 至少一个 fixture 从静态通过升级为静态 + 运行时双证据通过。
- 未通过项有明确修复建议或风险接受记录。

---

### Phase 4：Skill 生成器

**目标**

实现从 workflow/经验输入到 skill 文件树的生成器，让 SkillForge 不只是验证已有 fixture，而是能生产新 skill。

**主要产物**

- WorkflowSource 输入格式。
- SkillSpec 生成/编辑流程。
- SkillManifest 与 `SKILL.md` 生成器。
- 附属资源生成策略。
- 生成后自动静态验证与可选运行时回放。
- 生成质量报告。

**任务列表**

1. 定义最小输入：标题、原始 workflow、上下文、目标用户、触发场景、权限边界、隐私等级。
2. 生成 `SkillSpec`：目标、触发、输入输出、约束、成功标准、validationPlan。
3. 生成 `SkillManifest`：entry、files、dependencies、permissions、compatibility。
4. 生成 `SKILL.md`：frontmatter、description 触发描述、流程、边界、检查清单、输出格式。
5. 支持 simple skill 优先，standard/advanced 必须有资源计划后再生成。
6. 接入静态 validator：生成后自动校验，不通过则返回修复建议。
7. 接入可选 runtime replay：有 replay cases 时执行或标记 pending。
8. 保存 `GenerationRun`：输入摘要、模型/模板版本、产物路径、验证结果。
9. 设计人工确认点：外发、写文件、网络、隐私内容不得默认进入公开产物。

**验收标准**

- 给定一个新 workflow，能生成一个 simple skill 文件树。
- 生成产物静态 validator 通过。
- 生成报告能追踪输入、生成过程、产物和验证结果。
- 隐私与权限边界不会被默认放宽。
- 失败时能给出可操作的修复建议，而不是只输出“生成失败”。

**风险**

- 生成器可能幻觉不存在的工具、路径或权限。
- 输入材料中的私密信息可能被带入公开 skill。
- 过度自动化会绕过人工确认点。
- 生成器为通过 validator 而写空泛模板，实际不可用。

**退出条件**

- 至少 3 个从不同 workflow 生成的 simple skill 静态通过。
- 至少 1 个生成 skill 完成真实模型回放。
- GenerationRun、ValidationResult、AcceptanceRecord 链路可追踪。

---

### Phase 5：发布 / registry / 团队协作与 UI（远期）

**目标**

把 SkillForge 从本地工具扩展为可协作、可发布、可治理的 skill 生产与分发系统。

**主要产物**

- Skill registry：本地/团队/远程索引。
- 发布流程：版本、变更记录、验收证据、风险声明。
- UI：输入、生成、验证、回放、评审、发布、历史版本。
- 团队协作：owner、reviewer、approval、risk waiver、rollback。
- 使用反馈与持续优化闭环。

**任务列表**

1. 设计 registry 元数据：name、version、description、entry、owner、tags、compatibility、checksums。
2. 定义发布门禁：静态验证必过；运行时回放按风险等级要求；隐私 P0 零容忍。
3. 支持团队评审：diff、证据、风险、评论、批准记录。
4. 支持安装/更新/回滚：版本选择、依赖检查、兼容提醒。
5. 建设 UI：workflow 输入、生成预览、validator 报告、replay transcript、发布状态。
6. 建立使用反馈：触发成功率、用户修正、失败原因、模型差异。
7. 支持持续优化：自动创建优化建议，不自动越权修改发布产物。
8. 建立权限和审计：谁生成、谁批准、谁发布、何时回滚。

**验收标准**

- 一个 skill 可以从生成到发布完成全链路记录。
- registry 中每个版本都能追溯 manifest、校验报告和验收结果。
- UI 不隐藏 P0/P1 风险，不把 pending 展示为 pass。
- 团队协作流程支持 review、approval、rollback。
- 发布后反馈能进入下一轮优化。

**风险**

- 发布系统可能造成错误 skill 大范围传播。
- 团队权限和隐私治理不足会带来安全风险。
- UI 简化术语后可能掩盖真实边界。
- registry 与本地文件版本不一致导致使用混乱。

**退出条件**

- 有受控团队试点完成端到端发布。
- 发布门禁能阻断 P0/P1 风险。
- 每个已发布 skill 都具备可追溯、可回滚、可复验能力。

## 4. 能力缺口总表

| 能力缺口 | 当前缺什么 | 为什么重要 | 优先级 | 依赖 |
|---|---|---|---|---|
| Validator 契约稳定性 | 规则清单、report schema、退出码说明仍需固化 | 后续 CI、生成器、UI 都依赖稳定输出 | P0 | Phase 1 |
| evidence 去重 | 脱敏已有，重复 evidence 仍会制造噪音 | 降低误判和报告阅读成本 | P1 | Phase 1 |
| checklist 聚合语义说明 | 多来源聚合逻辑未充分文档化 | 避免测试和用户误解“删除单一来源为何不失败” | P1 | Phase 1 |
| 多 fixture 覆盖 | 当前只有单正例 fixture | 防止规则过拟合，验证 schema 通用性 | P0 | Phase 2 |
| Schema | fixture/report 缺正式机器可读约束 | CI、生成器、UI 需要共同契约 | P0 | Phase 2 |
| CI 门禁 | 还未自动在 PR/发布前运行 | 防止静态质量回退 | P0 | Phase 2 |
| 自动化反例矩阵 | 反例证据已有，但需持续自动跑 | 确保隐私、伪 replay、缺字段等高风险不回归 | P0 | Phase 2 |
| 运行时模型回放 | 缺 runner、transcript、observed、评分 | 证明 skill 真实可用，而非只满足静态格式 | P0 | Phase 3 |
| 跨模型评估 | 缺多模型对照 | skill 触发与边界遵循高度依赖模型行为 | P1 | Phase 3 |
| 跨平台评估 | 缺 macOS/Windows 实测 | 路径、shell、权限、换行可能导致失败 | P1 | Phase 2/3 |
| 生成器 | 缺从 workflow 到 skill 的生产能力 | SkillForge 核心价值不应停留在验证已有样例 | P0 | Phase 4，依赖 Phase 1-3 基线 |
| 隐私治理 | 缺生成前/发布前更完整的隐私策略 | 防止私密信息进入公开 skill 或 registry | P0 | Phase 1/2/4/5 |
| 发布/registry | 缺版本、索引、安装、回滚 | 团队复用和规模化分发所必需 | P2 | Phase 5 |
| UI | 缺可视化流程 | 降低非工程用户使用门槛 | P2 | Phase 4/5 |
| 持续优化反馈 | 缺真实使用反馈闭环 | 让 skill 随模型、场景和团队经验持续变好 | P2 | Phase 3/5 |

## 5. 风险边界

### 5.1 隐私风险

- token、secret、账号、私有路径、内部 IP、不可公开业务细节不得进入可发布产物。
- evidence 必须脱敏；后续还要去重，避免重复暴露上下文。
- 生成器阶段必须先做输入隐私分级，再生成公开内容。
- registry 发布前必须有 P0 隐私门禁。

### 5.2 外发与副作用风险

- 外部消息、邮件、API 调用、文件写入、删除、脚本执行必须显式声明权限和确认策略。
- fixture/回放默认应在无外发、无破坏性副作用的环境中运行。
- UI 不得用“自动优化”绕过人工确认。

### 5.3 模型不确定性风险

- 模型可能误触发、漏触发、忽略边界或生成看似正确但不可执行的流程。
- 静态 validator 只能检查结构与声明，不能证明模型行为。
- runtime replay 需要多次、多模型或人工复核来降低偶然性。

### 5.4 跨平台风险

- Linux 通过不代表 macOS/Windows 通过。
- 路径分隔符、shell 命令、权限、换行符、大小写敏感都可能影响 validator、fixture 和生成产物。
- 报告必须记录 OS、Node/pnpm、模型、命令、CWD。

### 5.5 文档实现漂移风险

- 文档、schema、validator、fixture、CI、UI 可能各说各话。
- 规则 ID、dimension、severity、report 字段必须有唯一来源或可对账机制。
- 每次规则变更应更新对应文档和验证报告。

## 6. 不做项 / 延后项

为避免下一步范围膨胀，以下事项不进入近期 Phase 1/2 主线，除非另立任务并明确验收：

1. 不做完整 UI。
2. 不做 registry / marketplace / 远程发布。
3. 不做自动修复并写回用户文件。
4. 不做真实外发消息、邮件、生产 API 调用。
5. 不做大规模批量扫描所有 skill。
6. 不做 advanced skill 的复杂脚本/资产生成，直到 simple/standard 稳定。
7. 不宣称跨平台/跨模型通过，除非已有实测报告。
8. 不把静态 replay pending 改写成 runtime pass。
9. 不为了演示效果降低 P0/P1 阻断规则。
10. 不在生成器稳定前承诺“任意 workflow 一键生成可发布 skill”。

## 7. 建议下一步 Top 5

1. **固化 validator 契约与规则清单**：把现有 15 条规则整理成可维护规则表，明确 ID、dimension、severity、scope、失败条件和修复建议。
2. **优化 evidence 与 checklist 诊断**：完成 evidence 去重，并文档化七维 checklist 多来源聚合语义。
3. **新增第二、第三个 simple fixture**：选择非会议场景，验证规则通用性，防止单 fixture 过拟合。
4. **引入 schema 与 CI 门禁**：先让所有正例 fixture 和关键反例矩阵在 CI 中稳定运行。
5. **设计 runtime replay 最小协议**：先不追求全自动平台，先定义 transcript、observed、passed、评分 rubric 和人工复核格式。

## 8. 里程碑判定摘要

| 里程碑 | 通过标志 | 当前状态 |
|---|---|---|
| M0 文档闭环 | 核心文档、验收、10 轮优化完成 | 已完成 |
| M1 静态 MVP | 单 fixture + JSON validator + 正例静态通过 | 已完成 |
| M2 稳定静态工具 | 规则清单、schema 草案、去重、诊断、开发指南 | 下一步 |
| M3 多 fixture + CI | 多 fixture、反例矩阵、CI 门禁 | 未开始 |
| M4 真实模型回放 | transcript + observed + 评分 + 验收记录 | 未开始 |
| M5 生成器 | workflow 输入生成 skill 并通过验证 | 未开始 |
| M6 发布协作 | registry、UI、团队评审、回滚、反馈优化 | 远期 |
