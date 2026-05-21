# Phase 2 Schema 与多 Fixture 前置设计

> Phase 2A 状态：schema/profile 最小文档契约已固化，`fixtures/study-card-assistant` 已作为第二个 simple 正例 fixture 创建并通过静态验证，`validate:fixtures` 已实现为最小多正例静态验证入口；仍不创建 JSON Schema 文件，不实现 schema engine，不新增 blocking profile rule，不迁移现有 fixture 路径。

## 1. Purpose

本文档为 SkillForge Phase 2 的多 fixture、schema 与 CI 工作提供前置设计，目标是让后续子任务能在不扩大 MVP 声明边界的前提下拆分实施：

- 从当前单一正例 fixture 扩展到多个 fixture，验证规则通用性，降低单样本过拟合风险。
- 在实现 schema 引擎前，先收敛 Phase 2A 最小 profile 契约、fixture contract、schema 候选字段、目录约定与报告兼容边界。
- 为后续 CI / contract test / 反例矩阵接入定义最小可执行路径。
- 持续保持 Phase 1 的静态验证口径：静态通过不等于真实模型回放通过，也不等于跨平台或跨模型完成。

## 2. Scope / Non-goals

### Scope

Phase 2 入口阶段关注设计与拆分；Phase 2A 已落地最小多正例入口，但仍不实现 schema engine、profile blocking rule、runtime replay 或 CI。当前 scope 包括：

- Phase 2A 最小 profile 契约：`simple`、`standard`、`advanced-reserved`。
- 多 fixture 的组织方式与 profile 分层。
- fixture schema、report schema、SKILL.md frontmatter schema 的字段候选。
- 多 fixture runner 的命令行为、汇总输出与失败策略；当前 `validate:fixtures` 已落地为 Phase 2A 最小多正例入口。
- 与 Phase 1 JSON report、规则 ID、静态验证语义的兼容边界。
- Phase 2 最小任务序列与验收标准。

### Non-goals

本阶段明确不做、也不应宣称完成以下能力：

- 不做真实模型回放；`replay` 仍只能表示静态用例设计与诚实性检查。
- 不做完整 skill 生成器；不能宣称能从任意 workflow 自动生成完整 skill 文件树。
- 不做 UI、registry、发布流、团队权限流或可视化审核。
- 不做重型 CI；Phase 2 初期只设计轻量 PR 门禁与本地等价入口。
- 不创建 JSON Schema 文件，不实现 schema engine，不把 profile 变成新的阻断规则。
- 不声明跨平台完成；Linux 优先，macOS / Windows 仅作为后续矩阵预留。
- 不声明跨模型完成；不同模型上的触发、边界遵循和输出稳定性仍是 pending。

## 3. Current MVP Fixture Contract

当前静态 MVP fixture 以 `fixtures/meeting-summary-assistant` 为正例基线。Phase 2A 优先沿用 `fixtures/<fixture-id>/` 扁平目录；不迁移 `meeting-summary-assistant`，也不引入 `fixtures/simple/...` 之类的分层路径作为当前要求。Phase 2 扩展多 fixture 时，除非后续迁移任务另行实施，否则应保留以下 required files：

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

Phase 2A 最小 profile 契约固定为三档：`simple`、`standard`、`advanced-reserved`。当前契约只定义名称、适用范围和推荐声明位置；不要求现有代码读取、输出或校验 profile，也不新增 blocking profile rule。

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

`fixtures/meeting-summary-assistant` 归类为 `simple` profile：它只使用 required files，无附属目录，无外部依赖，replay cases 为静态设计，`observed` / `passed` 保持 pending/null，适合作为 simple 正例基线。

当前代码和 fixture 尚未强制声明或校验 profile，因此该归类是 Phase 2A 文档契约，不是已实现的 validator 行为。后续可通过 manifest / frontmatter metadata 声明 profile。

### Phase 2A 推荐声明位置

第一阶段推荐声明位置如下：

1. `skill-manifest.yaml` 顶层 `profile` 作为主声明，例如 `profile: simple`。
2. `skill/SKILL.md` frontmatter 的 `metadata.profile` 可作为冗余或兼容声明。
3. 如果 manifest 与 frontmatter 同时声明且发生冲突，冲突处理留到后续 schema/validator 实现任务；Phase 2A 文档契约不定义当前阻断行为。

## 4A. Simple Fixture：`study-card-assistant`

`fixtures/study-card-assistant/**` 已按本节边界创建为第二个非会议类 simple fixture，并已通过单 fixture 静态验证。它用于验证 trigger、边界、隐私、replay 等规则不只围绕会议纪要样本过拟合。该证据仍然只是静态验证，不代表真实模型回放、跨平台或跨模型通过。

### Identity / profile

- Fixture ID：`study-card-assistant`。
- Profile：`simple`。
- 目录策略：继续使用 `fixtures/study-card-assistant/` 扁平目录；不引入 `fixtures/simple/...` 分层路径。
- 主题：把公开、虚构或合成学习材料整理成问答学习卡片，帮助用户复习概念、定义、对比点和易错点。
- 设计目的：作为非会议类样本，验证 trigger、边界、隐私、replay 规则不会过拟合 `meeting-summary-assistant` 的会议纪要语境。

### Required files 内容边界

该 fixture 保持当前 8 个 required files；作为 `simple` profile，不增加附属目录、外部依赖或真实运行 transcript。

1. `README.md`
   - 应包含：fixture 目标、profile、8 个文件清单、公开/虚构/合成材料来源声明、权限与隐私边界、七维 checklist 覆盖摘要、静态验证与 replay pending 说明。
   - 不能包含：真实学生/学校/教师/账号信息、私有课程链接、本地路径、token、内部资料、已执行模型回放通过结论。
2. `workflow-source.yaml`
   - 应包含：公开或虚构学习材料的输入背景、用户意图、期望输出为 Q&A 学习卡片、示例材料的合成来源说明。
   - 不能包含：真实课堂笔记、真实作业、未授权教材全文、个人学习记录、私有网盘/校内系统链接。
3. `skill-spec.yaml`
   - 应包含：技能目标、非会议类 trigger、输入要求、输出格式、拒绝/降级策略、权限边界、依赖为 none、隐私声明、兼容性说明。
   - 不能包含：联网检索要求、读取本地文件要求、写文件要求、调用外部服务要求、对真实个人资料的处理承诺。
4. `generation-run.yaml`
   - 应包含：静态 fixture 生成/设计元数据、fixture/profile 标识、来源为 synthetic/public/fictional、未执行真实模型回放的状态说明。
   - 不能包含：伪造的模型执行 transcript、伪造的 runtime pass、真实 prompt 日志、机器私有路径或账号信息。
5. `skill-manifest.yaml`
   - 应包含：`fixtureId: study-card-assistant`、fixture version、`profile: simple`、skill ID/name/version/title、`entry: skill/SKILL.md`、description、tags、language、权限全关闭、依赖 none、checklist 覆盖。
   - 不能包含：外部 API、网络权限、文件写权限、私有路径读取权限、破坏性操作权限、私有依赖源。
6. `replay-cases.yaml`
   - 应包含：至少 2 个正向 intent 和 1 个拒绝/边界 intent；所有 case 的 `observed: null`、`passed: null`；expected/forbidden behavior 与隐私说明。
   - 不能包含：真实运行结果、`passed: true`、真实学生材料、可识别个人信息、私有链接。
7. `validation-result.yaml`
   - 应包含：静态验证计划或创建后的静态验证结果占位/结果、七维 checklist、runtime replay pending、cross-platform/cross-model pending。
   - 不能包含：未执行却声明 runtime replay passed、未执行却声明跨平台/跨模型通过、伪造 validation artifact。
8. `skill/SKILL.md`
   - 应包含：frontmatter `name`、`version`、非会议类通用 trigger description、`metadata.fixtureId`、`metadata.profile: simple`、权限/依赖/隐私/兼容 metadata，以及正文的使用场景、输入要求、输出格式、权限边界、拒绝策略、静态检查清单。
   - 不能包含：会议纪要专用 trigger、外部工具调用步骤、读取/写入文件步骤、真实个人/机构信息、私有资源引用。

### Trigger description 模板

`skill/SKILL.md` frontmatter 的 `description` 应使用通用触发语义，避免会议类关键词。例如：

```yaml
description: "当用户要求把公开或虚构学习材料整理成问答学习卡片时，使用本技能提炼核心概念、问题、答案、提示和复习顺序，并保持无联网、无本地文件读取、无外发的安全边界。"
```

该描述必须表达“当用户要求……”的触发条件，且主题应是学习材料到问答卡片的转换，不应复用会议总结、会议纪要、行动项等会议类表述。

### Privacy / permission boundary

- 只允许使用 `public` / `fictional` / `synthetic` 内容：公开百科式知识、虚构短文、合成概念材料、无真实身份的示例段落。
- 禁止真实学生、学校、教师、班级、账号、成绩、邮箱、手机号、内部路径、token、私有链接、未授权教材或课程资料。
- 默认权限全关闭：不联网、不读本地文件、不写文件、不外发、不调用外部服务、不执行破坏性操作。
- 如果用户输入疑似真实个人学习记录或私有资料，应拒绝处理细节，改为要求用户提供脱敏、公开或虚构材料。

### Replay cases 设计

`replay-cases.yaml` 至少包含以下 3 类 case，且全部保持 `observed: null`、`passed: null`，直到真实模型回放任务产生独立证据。

1. 正向 intent：用户给出一段公开或合成的科学概念说明，要求整理成 5 张问答学习卡片。
   - Expected：提炼概念、问题、答案、提示；不联网；不添加未经材料支持的私人信息。
2. 正向 intent：用户给出一段虚构历史背景材料，要求生成按难度排序的 Q&A 复习卡片。
   - Expected：输出卡片列表、覆盖关键事实与对比点、可标注 easy/medium/hard；保持材料来源为 fictional。
3. 拒绝/边界 intent：用户要求读取本地真实学生笔记路径、私有课程链接或包含账号/token 的材料并生成卡片。
   - Expected：拒绝读取或处理私有/敏感内容；提示提供脱敏、公开或虚构材料；不得声称已访问路径/链接。

### 七维 checklist 覆盖策略

- `structure`：8 个 required files 完整，入口固定为 `skill/SKILL.md`，simple profile 不增加附属目录。
- `trigger`：frontmatter description 与 spec 均使用非会议类“当用户要求把公开或虚构学习材料整理成问答学习卡片时……”语义。
- `boundary`：明确只做整理与改写，不替用户事实核查、不联网、不访问私有资源、不处理敏感个人资料。
- `dependency`：声明无外部依赖、无外部服务、无私有包或平台外工具要求。
- `replay`：正例/边界 case 完整，`observed` / `passed` 均为 `null`，不伪造通过。
- `privacy`：全文件只使用 public/fictional/synthetic 内容，扫描并排除真实身份、路径、token、私有链接。
- `compatibility`：保持 Linux 当前静态验证口径；runtime replay、cross-platform、cross-model 均继续 pending。

### Current acceptance commands

当前 `study-card-assistant` 已创建并已纳入 Phase 2A 静态验证证据。最新应记录/复核的命令包括：

```bash
pnpm --silent validate:fixture fixtures/study-card-assistant --format json
pnpm --silent validate:fixtures
pnpm --silent validate:fixtures fixtures/meeting-summary-assistant fixtures/study-card-assistant --format json
pnpm --silent validate
pnpm --silent validate:all
```

其中 `validate:fixtures` 默认扫描当前两个完整正例 fixture，并输出 `kind: "multi-fixture-validation-report"` 的 JSON 汇总。

### Risks specific to `study-card-assistant`

1. **Trigger 过拟合**：如果 description 仍依赖会议类词汇，会削弱非会议泛化验证价值。
2. **隐私误带**：学习材料容易混入真实学生、学校、账号、路径、私有课程链接或未授权教材内容。
3. **边界声明弱**：若未明确不联网/不读本地/不写文件/不外发，后续 validator 或人工审核难以判断安全边界。
4. **Replay 伪通过**：在没有真实模型执行证据时，不得把 `observed` 填成输出或把 `passed` 写成 `true`。

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

推荐 Phase 2A 初始采用 **Option A：`fixtures/<fixture-id>/` 保守扁平方案**。

理由：Phase 2A 初期核心风险是 schema/profile 契约和多 fixture 规则通用性，不应先引入路径迁移。profile 建议作为 manifest / frontmatter metadata / schema 字段候选保存，例如 `profile: simple | standard | advanced-reserved`，待 fixture 数量明显增加后再评估是否迁移到分层目录。

## 6. Schema Candidates

本节只固化 Phase 2A 第一阶段字段候选：fixture root、`skill-manifest.yaml`、`SKILL.md` frontmatter、checklist、replay cases、report schema 兼容字段。不创建 JSON Schema 文件，不实现 schema engine，不新增 profile blocking rule，也不要求一次性实现全部校验。

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

### Implemented command：`validate:fixtures`

Phase 2A 已实现 `validate:fixtures` 作为最小多正例静态验证入口：

- 默认扫描 `fixtures/*` 下符合 required files 的 fixture root，当前会包含 `fixtures/meeting-summary-assistant` 与 `fixtures/study-card-assistant`。
- 支持传入一个或多个 fixture 路径，例如 `validate:fixtures fixtures/a fixtures/b`，显式路径按用户传入顺序验证。
- 对每个 fixture 直接调用现有单 fixture validator，保留单 fixture JSON report contract。
- 输出一个汇总 JSON，包含全部 fixture 的摘要和失败/警告详情。
- 任一 fixture 静态失败使整体 exit `1`；CLI usage error exit `2`。

当前汇总输出形状：

```json
{
  "reportVersion": "0.1.0",
  "ruleSetVersion": "skillforge-static-mvp-0.1.0",
  "kind": "multi-fixture-validation-report",
  "status": "passed",
  "summary": {
    "passed": true,
    "totalFixtures": 2,
    "passedFixtures": 2,
    "failedFixtures": 0,
    "totalChecks": 30,
    "blockingFailures": 0,
    "warnings": 0,
    "errors": 0,
    "byStatus": { "pass": 30 },
    "bySeverity": { "P0": 10, "P1": 16, "P2": 4 }
  },
  "fixtures": [
    {
      "path": "fixtures/meeting-summary-assistant",
      "id": "meeting-summary-assistant",
      "version": "0.1.0",
      "entry": "skill/SKILL.md",
      "status": "passed",
      "summary": {},
      "findings": []
    }
  ],
  "failures": [],
  "metadata": {
    "generatedAt": "<runtime timestamp; do not snapshot>",
    "validator": "skillforge-static-mvp",
    "format": "json",
    "runner": "validate-fixtures"
  }
}
```

### Current command：`validate:all`

当前行为（本轮未改）：

- 运行本地反例矩阵（当前 `validate:fixture:matrix`）。
- 输出 human-readable matrix summary，不输出 multi-fixture JSON artifact。
- 当前 6/6 通过，可作为本地 matrix gate。
- 尚未运行全部正例 fixture、schema contract test 或 snapshot-safe test；尚不是 CI 总入口。

后续可考虑的目标职责仍是：

```text
validate:all
  -> validate:fixtures
  -> validate:fixture:matrix
  -> schema contract checks（后续任务新增）
```

但当前 `validate:all` 仍是 `validate:fixture:matrix` 的本地正反例矩阵 gate，最新结果为 6/6 通过；它尚未接入 schema contract checks，也未改成总入口。

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

### T1：固化 Phase 2A profile/schema 文档契约并确认路径策略

产物：

- `docs/phase-2-schema-and-fixtures.md`
- 明确采用 `fixtures/<fixture-id>/` 扁平方案作为 Phase 2 初始目录约定。

验收标准：

- 文档覆盖 purpose、scope、fixture contract、profiles、schema candidates、runner、兼容边界、任务拆分和风险。
- 未修改代码、schemas、fixture 或 package；README 仅在必要时同步少量说明。

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

- `validate:fixtures` 命令。

验收标准：

- 能扫描并验证当前两个正例 fixture。
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

Phase 2 初始完成不等于完整 Phase 2 完成。Phase 2A 当前可接受口径为：

- 多 fixture、schema 字段候选与最小 profile 契约已文档化。
- `study-card-assistant` 已作为第二个非会议类 simple fixture 静态通过。
- `validate:fixtures` 已实现为最小多正例入口，默认扫描当前两个完整正例 fixture；显式路径模式可复核两个 fixture。
- 当前 MVP required files 和 report compatibility 边界清晰。
- 目录策略选择保守扁平方案，不破坏 Phase 1 路径证据。
- 后续任务仍需按 T6-T9 继续推进，不应把 schema engine、profile blocking rule、runtime replay 或 CI 写成已完成。
- 文档持续强调静态验证边界，不把 runtime replay、cross-platform、cross-model、完整生成器或 UI 写成已完成。
