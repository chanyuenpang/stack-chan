# Phase 2 Schema 与多 Fixture 前置设计

## 1. Purpose

本文档为 SkillForge Phase 2 的多 fixture、schema 与 CI 工作提供前置设计，目标是让后续子任务能在不扩大 MVP 声明边界的前提下拆分实施：

- 从当前单一正例 fixture 扩展到多个 fixture，验证规则通用性，降低单样本过拟合风险。
- 在实现 schema 引擎前，先收敛 fixture contract、schema 候选字段、目录约定与报告兼容边界。
- 为后续 CI / contract test / 反例矩阵接入定义最小可执行路径。
- 持续保持 Phase 1 的静态验证口径：静态通过不等于真实模型回放通过，也不等于跨平台或跨模型完成。

## 2. Scope / Non-goals

### Scope

Phase 2 入口阶段关注设计与拆分，不直接实现：

- 多 fixture 的组织方式与 profile 分层。
- fixture schema、report schema、SKILL.md frontmatter schema 的字段候选。
- 多 fixture runner 的命令行为、汇总输出与失败策略。
- 与 Phase 1 JSON report、规则 ID、静态验证语义的兼容边界。
- Phase 2 最小任务序列与验收标准。

### Non-goals

本阶段明确不做、也不应宣称完成以下能力：

- 不做真实模型回放；`replay` 仍只能表示静态用例设计与诚实性检查。
- 不做完整 skill 生成器；不能宣称能从任意 workflow 自动生成完整 skill 文件树。
- 不做 UI、registry、发布流、团队权限流或可视化审核。
- 不做重型 CI；Phase 2 初期只设计轻量 PR 门禁与本地等价入口。
- 不声明跨平台完成；Linux 优先，macOS / Windows 仅作为后续矩阵预留。
- 不声明跨模型完成；不同模型上的触发、边界遵循和输出稳定性仍是 pending。

## 3. Current MVP Fixture Contract

当前静态 MVP fixture 以 `fixtures/meeting-summary-assistant` 为正例基线。Phase 2 扩展多 fixture 时，除非 schema 任务明确迁移，否则应保留以下 required files：

```text
fixtures/<fixture-id>/
├── README.md
├── workflow-source.yaml
├── skill-spec.yaml
├── generation-run.yaml
├── skill-manifest.yaml
├── replay-cases.yaml
├── validation-result.yaml
└── skill/
    └── SKILL.md
```

Required files：

1. `README.md`：说明 fixture 目标、文件清单、隐私边界和 checklist 覆盖。
2. `workflow-source.yaml`：记录 workflow 来源、用户意图、输入输出背景与静态样例边界。
3. `skill-spec.yaml`：记录 skill 规格、触发、权限、依赖、隐私与兼容约束。
4. `generation-run.yaml`：记录静态生成运行元数据，不伪造完整生成器或模型执行结果。
5. `skill-manifest.yaml`：记录 `fixtureId`、`fixtureVersion`、skill ID、版本、入口、描述、标签和权限。
6. `replay-cases.yaml`：记录正例/反例 replay case 设计；当前 `observed` / `passed` 可为 `null`，不得伪造通过。
7. `validation-result.yaml`：记录静态验证或 pending 状态；不得把未执行模型回放写成 passed。
8. `skill/SKILL.md`：skill 入口文件，包含 frontmatter、触发说明、输入输出、权限边界和静态检查清单。

当前 validator 对 required files、`skill/SKILL.md` 入口、frontmatter 核心字段、触发描述、保守边界、依赖声明、replay 诚实性、隐私泄漏、七维 checklist 聚合和 JSON report contract 做静态检查。

## 4. Fixture Profiles

Phase 2 需要区分 fixture 复杂度，避免所有规则只围绕一个会议类样本生长。

### simple

适合验证通用静态规则的最小 fixture：

- 只包含 required files。
- `skill/SKILL.md` 为单文件技能，无附属资源目录。
- 输入输出简单，通常 1 个核心场景 + 1 个边界/拒绝场景即可表达。
- 依赖为无外部依赖，或仅声明平台内置能力但默认不执行副作用。
- replay cases 可以保持 pending，不包含真实 transcript。

### standard

适合验证较完整 skill 结构和 schema 表达力：

- 包含 required files。
- 可增加 `references/`、`examples/`、`templates/` 等非敏感公开附属材料。
- replay cases 覆盖多个正例、多个反例和边界输入。
- 依赖声明更细，但仍不得引用私有仓库、内部服务、密钥或私人路径。
- checklist、manifest、validation metadata 更接近后续真实发布前检查。

### advanced reserved

预留给 Phase 2 后期或 Phase 3+：

- 可包含工具适配、复杂输入、多阶段流程、运行时 transcript 或评估材料。
- 需要更严格隐私脱敏、schema 版本化和 CI 成本控制。
- 当前仅保留 profile 名称与设计空间，不作为 Phase 2 初始验收要求。

### 当前 fixture 建议归类

`fixtures/meeting-summary-assistant` 建议归为 `simple` profile：它只使用 required files，无附属目录，无外部依赖，replay cases 为静态设计，`observed` / `passed` 保持 pending/null，适合作为 simple 正例基线。

## 5. Directory Convention Options

### Option A：保守扁平方案

```text
fixtures/
├── meeting-summary-assistant/
├── <simple-fixture-id>/
└── <standard-fixture-id>/
```

优点：

- 与 Phase 1 当前路径完全兼容，`validate:fixture fixtures/<id>` 不需要路径迁移。
- 文档、README、现有报告引用成本最低。
- 对初期多 fixture runner 最简单，只需扫描 `fixtures/*` 下符合 contract 的目录。

缺点：

- profile 信息需要写在 manifest 或 README 中，目录层级无法直观看出复杂度。
- fixture 数量增加后，simple / standard / advanced 混在一起，人工浏览成本上升。

### Option B：分层 profile 方案

```text
fixtures/
├── simple/
│   ├── meeting-summary-assistant/
│   └── <simple-fixture-id>/
└── standard/
    └── <standard-fixture-id>/
```

优点：

- profile 通过目录层级天然表达，便于 runner 做 `--profile simple` 过滤。
- 后续 advanced 或 runtime replay 材料可以分层管理。

缺点：

- 需要迁移当前 fixture 路径，影响 README、报告、脚本、历史证据和用户命令。
- Phase 1 的稳定路径 `fixtures/meeting-summary-assistant` 会失效，容易制造不必要兼容成本。

### Phase 2 初始推荐

推荐 Phase 2 初始采用 **Option A：`fixtures/<fixture-id>/` 保守扁平方案**。

理由：Phase 2 初期核心风险是 schema 和多 fixture 规则通用性，不应先引入路径迁移。profile 建议作为 manifest / schema 字段候选保存，例如 `profile: simple | standard | advanced-reserved`，待 fixture 数量明显增加后再评估是否迁移到分层目录。

## 6. Schema Candidates

本节只列 schema 候选字段，不创建 schema 文件，不要求一次性实现全部校验。

### 6.1 Fixture root schema

候选字段：

- `fixtureId`：稳定唯一 ID，建议与目录名一致。
- `fixtureVersion`：fixture contract 版本或样本版本。
- `profile`：`simple`、`standard`、`advanced-reserved`。
- `kind`：文件类型或根对象类型。
- `entry`：入口路径，当前必须为 `skill/SKILL.md`。
- `requiredFiles`：required files 列表或由 validator 固定派生。
- `tags`：主题、语言、复杂度、样本来源标签。
- `sourceType`：`public`、`fictional`、`synthetic` 等，避免引入隐私样本。
- `privacyLevel`：公开/虚构/已脱敏等声明。
- `checklist`：七维 checklist 覆盖：`structure`、`trigger`、`boundary`、`dependency`、`replay`、`privacy`、`compatibility`。

### 6.2 `skill-manifest.yaml` schema

候选字段：

- `fixtureId`
- `fixtureVersion`
- `kind: skill-manifest`
- `profile`
- `skills[]`
  - `id`
  - `name`
  - `version`
  - `title`
  - `entry`
  - `description`
  - `tags[]`
  - `language`
  - `permissions`
- `permissions`
  - `network`
  - `externalSend`
  - `fileWrite`
  - `destructiveOperations`
  - `privatePathRead`
- `dependencies`
  - `noneDeclared` 或 `items[]`
  - `name`
  - `purpose`
  - `versionRange`
  - `source`
- `checklist`
- `schemaVersion`（预留）

### 6.3 `SKILL.md` frontmatter schema

候选字段：

- `name`
- `version`
- `description`
- `metadata.fixtureId`
- `metadata.fixtureVersion`
- `metadata.profile`
- `metadata.language`
- `metadata.tags[]`
- `metadata.permissions.network`
- `metadata.permissions.externalSend`
- `metadata.permissions.fileWrite`
- `metadata.permissions.destructiveOperations`
- `metadata.permissions.privatePathRead`
- `metadata.dependencies`
- `metadata.privacy`
- `metadata.compatibility`

正文候选章节：

- 使用场景 / When to use
- 输入要求
- 输出格式
- 权限边界
- 拒绝或降级策略
- 静态检查清单

### 6.4 Checklist schema

候选字段：

- `structure`
- `trigger`
- `boundary`
- `dependency`
- `replay`
- `privacy`
- `compatibility`
- `source`（可选：该 checklist 来自哪个文件）
- `status`（可选：`covered`、`pending`、`not-applicable`）
- `note` / `evidence`（可选，必须脱敏）

Phase 2 应继续保持 Phase 1 语义：七维 checklist 是多来源聚合，不要求单个文件 exactly once 覆盖全部维度。

### 6.5 Replay cases schema

候选字段：

- `fixtureId`
- `fixtureVersion`
- `kind: replay-cases`
- `cases[]`
  - `id`
  - `type`：`positive`、`negative`、`edge`
  - `intent`
  - `input`
  - `expectedBehavior[]`
  - `forbiddenBehavior[]`（可选）
  - `observed`：当前可为 `null`；若为对象需有真实执行来源。
  - `passed`：当前可为 `null`；不得在无 observed evidence 时为 `true`。
  - `privacyNotes`
  - `tags[]`
- `checklist`

### 6.6 Report schema

候选字段应兼容 Phase 1 JSON report：

- `reportVersion`
- `ruleSetVersion`
- `fixture`
  - `path`
  - `id`
  - `version`
  - `entry`
  - `profile`（可新增）
- `status`
- `summary`
  - `passed`
  - `total`
  - `byStatus`
  - `bySeverity`
  - `blockingFailures`
  - `warnings`
  - `errors`
- `checks[]`
  - `id`
  - `dimension`
  - `severity`
  - `status`
  - `message`
  - `evidence[]`
  - `closeCondition`
- `errors[]`
- `metadata`
  - `generatedAt`
  - `validator`
  - `format`
  - `contract`
  - `runtime`（可新增，注意不 snapshot 易变字段）
- `rules`（兼容别名）
- `findings`（兼容别名）
- `pendingCapabilities`（可新增，用于显式记录 runtime replay / cross-platform / cross-model pending）

## 7. Multi-fixture Runner Design

### Candidate command：`validate:fixtures`

候选行为：

- 默认扫描 `fixtures/*` 下符合 required files 的 fixture root。
- 支持传入一个或多个 fixture 路径，例如 `validate:fixtures fixtures/a fixtures/b`。
- 对每个 fixture 调用现有单 fixture validator，保留单 fixture JSON report contract。
- 输出一个汇总 JSON，包含全部 fixture 的摘要和失败详情。
- 适合作为 Phase 2 的多正例静态验证入口。

候选汇总输出：

```json
{
  "reportVersion": "0.1.0",
  "kind": "multi-fixture-validation-report",
  "summary": {
    "passed": true,
    "totalFixtures": 3,
    "passedFixtures": 3,
    "failedFixtures": 0,
    "blockingFailures": 0,
    "warnings": 0,
    "errors": 0
  },
  "fixtures": [
    {
      "path": "fixtures/meeting-summary-assistant",
      "id": "meeting-summary-assistant",
      "profile": "simple",
      "status": "passed",
      "summary": {}
    }
  ],
  "failures": [],
  "metadata": {
    "generatedAt": "<runtime timestamp; do not snapshot>",
    "validator": "skillforge-static-mvp"
  }
}
```

### Candidate command：`validate:all`

候选行为：

- 运行全部正例 fixture 静态验证。
- 运行本地反例矩阵（当前 `validate:fixture:matrix` 的 Phase 2 扩展版本）。
- 可选执行 schema contract test / snapshot-safe test，但不得 snapshot `generatedAt`。
- 作为 CI 的候选总入口。

建议初始职责：

```text
validate:all
  -> validate:fixtures
  -> validate:fixture:matrix
  -> schema contract checks（后续任务新增）
```

### Failure strategy

- 单 fixture validator 维持 Phase 1 退出码：通过 exit `0`，阻断规则失败 exit `1`，CLI usage error exit `2`。
- 多 fixture runner：只要任一 fixture 出现 P0/P1 `fail` / `error` 或 validator error，整体 exit `1`。
- CLI 参数错误、路径不存在、无法解析命令参数时 exit `2`。
- P2 warning 不应单独阻断，但必须计入 `warnings` 和 `findings`。
- 反例矩阵应验证“预期失败”；反例未失败、stdout 非合法 JSON、目标 rule ID 未命中都应使矩阵整体失败。
- 汇总输出必须保留每个 fixture 的失败 rule ID、severity、dimension 和脱敏 evidence，便于定位。

## 8. Compatibility / Migration Boundary

Phase 2 必须保护 Phase 1 的 report contract，不因扩展 schema 或多 fixture runner 破坏现有使用者。

约束：

- Phase 1 report fields 不删除、不重命名：`reportVersion`、`ruleSetVersion`、`fixture`、`status`、`summary`、`checks`、`errors`、`metadata`、`rules`、`findings`、`generatedAt` 继续保留。
- `checks[].id` 作为稳定 rule ID，不随意重命名；新增规则必须新增 ID，不复用旧 ID 表达新语义。
- `summary.passed`、`summary.blockingFailures` 等字段语义不变：P0/P1 fail/error 阻断；P2 warning 不单独阻断。
- `metadata.generatedAt` 和顶层兼容别名 `generatedAt` 是运行时字段，不做 snapshot；contract test 应忽略或模式匹配。
- 允许新增字段，例如 `fixture.profile`、`schemaVersion`、`pendingCapabilities`、`runner`、`matrix`，但新增字段不得改变旧字段含义。
- `fixture.path` 初期继续支持 `fixtures/meeting-summary-assistant`，不强制迁移到 `fixtures/simple/meeting-summary-assistant`。
- pending 能力不得写成完成：真实模型回放、跨平台、跨模型、完整生成器、UI、发布流都必须保持 pending 表述，除非已有独立证据。
- schema 校验失败应作为结构性失败呈现，不应吞掉原始 validator 的隐私、replay、边界等安全失败。

## 9. Phase 2 Task Breakdown

建议最小任务序列如下。

### T1：固化本设计并确认路径策略

产物：

- `docs/phase-2-schema-and-fixtures.md`
- 明确采用 `fixtures/<fixture-id>/` 扁平方案作为 Phase 2 初始目录约定。

验收标准：

- 文档覆盖 purpose、scope、fixture contract、profiles、schema candidates、runner、兼容边界、任务拆分和风险。
- 未修改代码、schemas、fixture、package 或 README。

### T2：新增 profile 元数据草案

产物：

- 在文档或 schema 草案中定义 `profile` 字段枚举：`simple`、`standard`、`advanced-reserved`。
- 明确当前 `meeting-summary-assistant` 建议 profile 为 `simple`。

验收标准：

- 不迁移目录。
- validator 旧命令仍可运行。
- pending 能力仍保持 pending。

### T3：设计 fixture schema 草案

产物：

- fixture root、manifest、frontmatter、checklist、replay cases 的 schema 草案文档或草案文件。

验收标准：

- 只定义字段、required/optional、类型和兼容策略。
- 不要求一次性实现完整 schema 引擎。
- schema 不把单一业务关键词硬编码为通用规则。

### T4：设计 report schema 草案与 contract test 策略

产物：

- report schema 草案。
- snapshot-safe contract test 策略，明确忽略 `generatedAt`。

验收标准：

- Phase 1 report fields 不删除、不重命名。
- 新增字段只做兼容扩展。
- 失败报告仍保留 rule ID、severity、dimension、message、evidence 和 closeCondition。

### T5：新增 simple fixture 样本

产物：

- 至少 2 个非会议类 simple fixture。

验收标准：

- 每个 fixture 包含 required files。
- 静态 validator 正例通过。
- 样本使用公开/虚构数据，不包含真实隐私、内部路径或凭证。
- 能证明规则没有只围绕会议类关键词过拟合。

### T6：新增 standard fixture 样本

产物：

- 至少 1 个 standard fixture，可包含公开 `references/`、`examples/` 或 `templates/`。

验收标准：

- required files 完整。
- 附属材料可被隐私扫描覆盖或显式纳入范围。
- validator 正例通过。
- 不引入私有依赖或真实外部服务要求。

### T7：实现多 fixture runner

产物：

- `validate:fixtures` 候选命令或等价脚本。

验收标准：

- 能扫描并验证全部正例 fixture。
- 汇总输出包含每个 fixture 的 status、summary、失败 rule ID 和脱敏 evidence。
- 任一 P0/P1 失败使整体 exit `1`。
- CLI usage error exit `2`。

### T8：扩展反例矩阵与 `validate:all`

产物：

- 多 fixture 反例矩阵。
- `validate:all` 候选总入口。

验收标准：

- 正例全部通过。
- 关键反例稳定失败且 stdout JSON 可解析。
- `generatedAt` 不参与 snapshot。
- 输出明确区分 static checked 与 runtime/cross-platform/cross-model pending。

### T9：接入轻量 CI

产物：

- PR 门禁或等价自动化入口，运行 `validate:all`。

验收标准：

- P0/P1 失败阻断。
- P2 warning 可见但不单独阻断。
- CI 不声明跨平台完成；Linux 优先，其它平台作为后续矩阵。

## 10. Risks

1. **Schema 过早过严**：如果 schema 在样本不足时锁死字段，会阻碍真实 skill 接入。缓解：先区分 required / optional / reserved，profile 逐步加严。
2. **单 fixture 过拟合**：当前 meeting fixture 的中文触发和业务结构可能影响规则泛化。缓解：新增非会议类 simple fixture 和至少一个 standard fixture。
3. **CI 误判**：CI 可能因 `generatedAt`、环境差异、路径差异、warning 策略而误红。缓解：不 snapshot 运行时字段，明确 exit code 和阻断等级。
4. **隐私样本风险**：新增 fixture 容易误带真实联系人、内部路径、token、私有链接或客户材料。缓解：只允许公开/虚构/脱敏样本，隐私扫描覆盖 fixture 全部文本材料。
5. **跨平台风险**：路径分隔符、换行、shell、权限、Node/pnpm 版本可能导致 Linux 以外表现不同。缓解：Phase 2 初期不宣称跨平台完成，先记录 pending，后续再建矩阵。
6. **跨模型风险**：不同模型对触发和边界遵循能力不同，静态通过不能证明模型执行效果。缓解：继续把 runtime replay 和 cross-model 标为 pending，留到 Phase 3+。
7. **报告兼容漂移**：schema 或 runner 改动可能删除/改名 Phase 1 字段，破坏下游脚本。缓解：report schema 与 contract test 明确旧字段只增不删不改名。
8. **反例矩阵维护成本上升**：多 fixture 后反例数量增长，可能拖慢本地和 CI。缓解：Phase 2 初期选择代表性 P0/P1 反例，按 profile 增量扩展。

## 11. Recommended Initial Acceptance Bar

Phase 2 初始完成不等于完整 Phase 2 完成。建议入口阶段验收口径为：

- 多 fixture 与 schema 设计已文档化。
- 当前 MVP required files 和 report compatibility 边界清晰。
- 目录策略选择保守扁平方案，不破坏 Phase 1 路径证据。
- 后续任务能按 T2-T9 拆分，不需要在第一个子任务中实现 schema 引擎或 CI。
- 文档持续强调静态验证边界，不把 runtime replay、cross-platform、cross-model、完整生成器或 UI 写成已完成。
