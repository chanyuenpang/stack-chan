# SkillForge 优化第 6 轮分析

## 1. 本轮目标

第 5 轮已经把第 4 轮的 fixture 规格与静态校验规则整理成测试矩阵，并明确第 6 轮应聚焦 **“最小 fixture 落地 + 最小静态校验器实现”**。但本轮任务范围仍限定为分析文档：只产出 `docs/optimization/round-06.md`，不实际创建 `fixtures/`，不写校验器代码，不改核心设计文档。

因此，本轮目标是把第 5 轮测试矩阵推进到 **可实施的最小工程切片**：

1. 明确哪些矩阵项进入第一版最小 fixture，哪些延后到第 7 轮或更晚。
2. 定义第一版 fixture、schema/规则文件、命令入口和输出报告的建议结构。
3. 固定最小静态校验器的规则集合与错误码，优先覆盖 MVP 必需 P0/P1 风险。
4. 给出下一步真正写代码时的实施顺序，避免从“完整生成器”或“复杂样例”开刀。
5. 再次声明非目标，保证第 6 轮仍服务于 MVP 最小闭环，而不是膨胀成测试平台。

一句话：本轮不烤整桌虾，只把第一只虾怎么下锅、放哪口锅、几分钟捞起来说清楚。

## 2. 对第 5 轮结论的复盘

### 2.1 可进入最小工程切片的矩阵项

第 5 轮矩阵很完整，但第一版不应全量实现。以下内容可直接进入最小切片：

| 第 5 轮矩阵项 | 是否进入最小切片 | 理由 | 最小落点 |
|---|---:|---|---|
| `valid_simple_meeting_summary` 正例 fixture | 是 | 关闭“只有设计无样例”的 P1 风险 | `fixtures/meeting-summary-assistant/` |
| 2 正 1 反回放用例结构 | 是 | 支撑 V5 回放验证与触发边界 | `replay-cases.yaml` |
| manifest entry 对账 | 是 | 入口不存在是 P0/P1 基础结构风险 | `skill-manifest.yaml` + `skill/SKILL.md` |
| `SKILL.md` frontmatter | 是 | P1/P2/P4 验收项依赖 name/description | `frontmatter.*` 规则 |
| simple 复杂度无附属文件 | 是 | MVP 首个样例应保持低风险 | `resourcePlan.simpleEmpty`、`manifest.resourceFilesEmpty` |
| 权限边界全保守 | 是 | 外发、写文件、网络、破坏性操作是 P0 | `permission.*` 规则 |
| P0 隐私扫描 | 是 | 防止真实路径、token、联系方式进入样例 | `privacy.*` 规则 |
| 相对路径检查 | 是 | 路径兼容与隐私同时依赖 | `structure.relativePaths` |
| 7 维 checklist key | 是 | 对齐 `docs/acceptance.md` V1-V7 | `validation.sevenKeys` |
| 未执行回放不得伪通过 | 是 | 防止把 expected 当 observed | `replay.observedNotForged` |
| 输出 `summary + checks[]` | 是 | 后续可复制到验收结果 | 校验器 JSON/文本输出 |
| 错误码沿用规则 ID | 是 | 降低实现成本，便于文档引用 | `id=privacy.noSecrets` 等 |

这些项共同特点是：静态可判定、输入文件少、失败条件明确、能直接支撑验收证据。

### 2.2 应推迟的矩阵项

以下内容暂不进入第一个最小切片：

| 推迟项 | 推迟原因 | 建议进入轮次 | 关闭条件 |
|---|---|---:|---|
| standard/advanced fixture | 会引入 tools/references/scripts/assets 复杂度 | 第 7-8 轮 | simple fixture 与校验器稳定后再扩展 |
| 完整 schema 校验体系 | 第一版只需字段存在与枚举检查，不必写完整 JSON Schema | 第 7 轮 | 最小规则跑通后再抽 schema |
| 多 fixture 批量扫描 | 单 fixture 尚未冻结，批量会放大路径/报告设计复杂度 | 第 7 轮 | `validate fixtures/meeting-summary-assistant` 稳定 |
| 跨 OS 实测 | 当前任务只做分析，且不应伪造兼容通过 | 第 7-8 轮 | Linux 当前环境有记录，macOS/Windows pending 或实测 |
| 跨模型触发回放 | 需要真实模型或回放器，不属于静态校验器第一版 | 第 8 轮后 | 有回放执行器与模型版本记录 |
| 语义级触发评分 | 静态关键词不能证明模型选择质量 | 第 7 轮人工审查，之后再自动化 | 人工审查表可复用 |
| 隐私疑似姓名/组织自动判定 | 误报率高，不适合 P0 fail-fast | 第 7 轮 | 输出 warn + 人工 note |
| 自动修复 `validation-result.yaml` | 第一版只建议 patch，不能自动篡改证据 | 第 7 轮后 | 用户确认写回策略 |
| 完整生成器 | 会偏离 MVP fixture/校验闭环 | 非第 6 轮目标 | fixture + validator 稳定后再规划 |
| UI/交互式验收面板 | 不影响最小工程闭环 | 后续产品阶段 | CLI 报告格式稳定 |

本轮判断：第 5 轮矩阵已经足够，但第 6 轮必须切小。最小切片只围绕 **一个 simple fixture、一个校验入口、一组 P0/P1 静态规则、一份稳定输出**。

## 3. 优点与保持/扩大方式

### 优点 1：第 5 轮矩阵可直接转成最小实现边界

**表现**：测试矩阵已经列出正例、反例、规则 ID、严重级别和预期结果，不需要从零设计校验规则。

**保持/扩大方式**：
- 第一版校验器直接使用第 4/5 轮规则 ID 作为错误码。
- 不重新命名规则，不引入另一套 `E001`、`W001` 编号。
- 每新增规则必须能回指到矩阵项或验收项。

### 优点 2：simple fixture 风险低，适合作为第一条冻结基线

**表现**：会议纪要整理助手不需要网络、MCP、脚本、文件写入、外发消息，天然符合最小权限原则。

**保持/扩大方式**：
- `complexityTier` 固定为 `simple`。
- `resourcePlan`、`resourceFiles`、`dependencies` 第一版为空。
- 任何新增附属文件都必须推迟到 standard/advanced 扩展轮次。

### 优点 3：P0/P1 风险清晰，能支撑 fail-fast

**表现**：隐私泄漏、私有路径、外发消息默认允许、entry 不存在、伪造回放通过等均已定义为高优先级问题。

**保持/扩大方式**：
- 校验输出 summary 必须统计 P0/P1/P2 数量。
- `summary.passed` 的判定规则固定为 P0=0 且 P1=0。
- P0 不允许通过普通配置忽略；P1 若人工豁免必须有关闭条件。

### 优点 4：7 维验证与验收文档天然对齐

**表现**：结构、触发、边界、依赖、回放、去隐私、兼容能对应 `docs/acceptance.md` 的 V1-V7。

**保持/扩大方式**：
- 校验器 `checks[].dimension` 只使用 7 个固定 key。
- `validation-result.yaml.checklist` 即使未执行也必须保留 7 个维度。
- 未实测兼容项只能是 `pending` 或 `documented_not_executed`，不得写 pass。

### 优点 5：输出格式已有验收用途

**表现**：第 5 轮建议 `summary + checks[] + suggestedValidationPatch`，可直接粘贴或引用到 `acceptance-result.md`。

**保持/扩大方式**：
- 第一版报告同时支持机器可读 JSON 与人类可读摘要，字段保持一致。
- 每条 check 必须包含 `id/dimension/severity/status/message/evidence`。
- 文案可调整，但 `id/status/severity` 不能随意变。

### 优点 6：字段差异已提前暴露，便于实现时规范化

**表现**：`ValidationResult.checklist` 在核心模型中是数组，fixture 设计中更适合对象 key；`dependencies` 也有数组/对象差异。

**保持/扩大方式**：
- 在校验器内部设置规范化层：fixture 输入形态 → 核心模型形态 → 输出报告形态。
- fixture 文件可为了可读性使用对象 key，但输出报告不假装它就是最终数据库模型。
- 字段映射写入 README 或 validator 文档，避免后续争议。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：第 6 轮名义上是“落地方案”，实际仍未落地 fixture

**级别**：P1  
**影响**：只要没有真实 `fixtures/meeting-summary-assistant/`，仍无法证明路径、frontmatter、manifest 对账能跑通。

**改善办法**：下一步代码任务必须优先创建最小 fixture，而不是继续扩写分析文档。

**关闭条件**：fixture 目录存在，包含 8 个最小文件，且 `workflowSourceId -> skillSpecId -> generationRunId -> skillManifestId -> validationResultId` 链路可追踪。

### 风险 2：最小校验器容易滑向完整测试框架

**级别**：P1  
**影响**：如果第一版同时做 schema、批量扫描、跨 OS、自动修复、回放执行，会拖慢 MVP 闭环。

**改善办法**：实现范围锁定为单 fixture、静态文件读取、P0/P1 规则、结构化输出。

**关闭条件**：第一版命令只承诺 `validate <fixtureDir>`，不承诺生成、修复、发布、跨模型回放。

### 风险 3：fixture 字段与核心数据模型继续分裂

**级别**：P1  
**影响**：如果实现时直接把便利字段当核心字段，后续接入 `ValidationResult`、`SkillManifest` 会出现模型不一致。

**改善办法**：建立规范化规则：
- `checklist` 对象 key 映射为数组 `{item, passed, note}`。
- `method: manual_plus_static_check` 映射到核心枚举 `hybrid`，原值保留在 fixture-only metadata。
- `dependencies: []` 与 `{packages: [], cli: [], mcp: [], network: []}` 统一为空依赖。

**关闭条件**：校验器或 README 明确列出 fixture-only 字段与核心字段映射。

### 风险 4：隐私规则误报/漏报会影响 fixture 可用性

**级别**：P1  
**影响**：过严会阻断泛化示例，过松会放过 token、真实路径、联系方式。

**改善办法**：第一版只把高置信模式设为 P0：`sk-`、`token/key/secret/password`、`/home/`、`C:\Users`、邮箱、手机号、真实飞书链接。疑似姓名/组织只做 P1/P2 人工复核。

**关闭条件**：P0 隐私规则有至少一个正例通过和一个反例失败，并且误报项能被标记为 warn 而非 fail。

### 风险 5：触发质量被静态关键词误认为已验证

**级别**：P2  
**影响**：description 包含“会议纪要”不代表模型一定正确触发；反例是否误触发仍需回放或人工判断。

**改善办法**：第一版只检查触发材料完整性：description、触发章节、正/反例数量、关键词覆盖。语义质量进入人工审查。

**关闭条件**：报告中明确区分 `static_checked` 与 `runtime_replay_pending`，不把触发语义写成 pass。

### 风险 6：回放结果容易被提前填成通过

**级别**：P1  
**影响**：把 expected 写成 observed 会破坏 `acceptance-result.md` 的证据可信度。

**改善办法**：校验器必须检查：当 `validatedAt` 为空或 `observed.*` 为 null 时，`passed` 不得为 true；`replay` checklist 不得为 pass。

**关闭条件**：反例 `replay_passed_without_observed` 能稳定触发 `replay.observedNotForged`。

### 风险 7：输出格式不稳定会削弱后续验收引用

**级别**：P1  
**影响**：若报告只有自然语言，没有 rule id/evidence，无法被第 7 轮和验收结果复查。

**改善办法**：固定输出结构；自然语言摘要只能作为附加层，不能替代 `checks[]`。

**关闭条件**：任一失败都能定位到稳定 `id`、`severity`、`dimension`、`evidence.path` 或 `evidence.field`。

## 5. 最小工程切片设计

> 本节是下一步真正写代码时的建议结构。本轮不创建这些文件。

### 5.1 建议文件结构

```text
workflow-kit/
  fixtures/
    meeting-summary-assistant/
      README.md
      workflow-source.yaml
      skill-spec.yaml
      generation-run.yaml
      skill-manifest.yaml
      replay-cases.yaml
      validation-result.yaml
      skill/
        SKILL.md
  schemas/
    fixture-minimal.schema.json        # 可选，第一版可先不完整实现
    validation-report.schema.json      # 可选，先固化输出字段
  src/
    validator/
      index.ts                         # 命令入口或导出入口
      loadFixture.ts                   # 读取 YAML/Markdown
      normalize.ts                     # 字段规范化
      rules/
        structure.ts
        frontmatter.ts
        trigger.ts
        permissions.ts
        privacy.ts
        replay.ts
        validation.ts
      report.ts                        # summary/checks 输出
  package.json                         # 增加 validate 命令时才修改
```

如果仓库当前技术栈不是 TypeScript，也可以用 `scripts/validate-fixture.*`。关键不是语言，而是切片边界：**一个 fixture 根目录输入，一份结构化报告输出**。

### 5.2 最小 fixture 文件

第一版只覆盖 MVP 必需最小集：

| 文件 | 必须性 | 最小职责 |
|---|---:|---|
| `README.md` | 必须 | 说明 fixture 目标、版本、未实测项、字段映射摘要 |
| `workflow-source.yaml` | 必须 | 保存脱敏后的会议纪要 workflow 摘要 |
| `skill-spec.yaml` | 必须 | 保存目标、触发、输入输出、约束、权限边界、验证计划 |
| `generation-run.yaml` | 必须 | 记录手工 fixture 生成过程，不保存敏感日志 |
| `skill-manifest.yaml` | 必须 | 记录 entry、files、resourceFiles、dependencies、permissions、compatibility |
| `replay-cases.yaml` | 必须 | 2 个 positive、1 个 negative，observed/passed 初始为 null |
| `validation-result.yaml` | 必须 | 7 维 checklist，未执行项 pending 或 documented_not_executed |
| `skill/SKILL.md` | 必须 | 单文件 skill，含 frontmatter、触发、不应触发、流程、输出、边界 |

不进入第一版 fixture 的内容：`tools/`、`references/`、`scripts/`、`assets/`、真实会议内容、真实飞书链接、模型回放输出。

### 5.3 schema/校验规则文件

第一版不必写完整 schema，但建议至少有两层规则定义：

1. **硬编码 MVP 规则**：直接在校验器规则模块中实现，覆盖 P0/P1。
2. **规则元数据表**：集中记录 `id/dimension/severity/description`，避免散落在代码里。

建议规则元数据形态：

```yaml
- id: frontmatter.description
  dimension: structure
  severity: P0
  message: SKILL.md frontmatter must include description
- id: privacy.noSecrets
  dimension: privacy
  severity: P0
  message: Fixture must not contain token/key/secret patterns
```

完整 JSON Schema 可推迟到第 7 轮；第一版只要能稳定报错即可。

### 5.4 命令入口

建议最小命令：

```bash
skillforge validate fixtures/meeting-summary-assistant --format json
```

若暂无 CLI 框架，可先使用项目脚本：

```bash
pnpm validate:fixture fixtures/meeting-summary-assistant
```

命令只做四件事：

1. 读取 fixture 目录。
2. 解析 YAML 与 `skill/SKILL.md` frontmatter。
3. 执行最小静态规则。
4. 输出报告到 stdout，不默认写回文件。

### 5.5 输出格式

建议第一版输出：

```json
{
  "summary": {
    "passed": false,
    "fixture": "fixtures/meeting-summary-assistant",
    "ruleCount": 18,
    "passCount": 14,
    "warnCount": 1,
    "failCount": 3,
    "p0Count": 1,
    "p1Count": 2,
    "p2Count": 1
  },
  "checks": [
    {
      "id": "privacy.noSecrets",
      "dimension": "privacy",
      "severity": "P0",
      "status": "fail",
      "message": "疑似密钥模式命中",
      "evidence": {
        "path": "skill/SKILL.md",
        "field": "body",
        "excerpt": "sk-***"
      }
    }
  ],
  "suggestedValidationPatch": {
    "checklist": {
      "privacy": {
        "status": "fail",
        "evidence": "privacy.noSecrets failed"
      }
    }
  }
}
```

判定规则：

- `summary.passed=true` 仅当 P0=0 且 P1=0。
- P2 只影响 `warnCount`，不阻断静态通过。
- `suggestedValidationPatch` 只是建议，不自动修改 `validation-result.yaml`。

## 6. 最小静态校验器规则

第一版必须覆盖以下规则。错误码建议直接使用规则 ID。

### 6.1 SKILL.md / frontmatter

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `structure.entryExists` | structure | P0 | manifest entry 指向文件存在 | `skill/SKILL.md` 不存在或路径不一致 |
| `frontmatter.exists` | structure | P0 | `SKILL.md` 有 YAML frontmatter | 无 frontmatter |
| `frontmatter.name` | structure | P0 | frontmatter `name` 与 manifest `name` 一致 | 缺失或不一致 |
| `frontmatter.description` | trigger | P0 | frontmatter 含 `description` | 缺失 description |
| `frontmatter.version` | structure | P2 | 推荐版本与 manifest 一致 | 缺失或不一致，warn |
| `trigger.skillBodySections` | trigger | P1 | 正文含“触发场景/不应触发/边界/输出格式”等章节 | 关键章节缺失 |

### 6.2 description / trigger

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `frontmatter.triggerDuty` | trigger | P1 | description 承担触发职责 | 只写宣传语或过宽泛 |
| `trigger.positiveExamples` | trigger | P1 | `triggers.examples` 至少 2 条 | 少于 2 条 |
| `trigger.negativeExamples` | trigger | P1 | 有发送邀请/外发消息类反例 | 缺反例 |
| `trigger.keywordCoverage` | trigger | P2 | 覆盖会议记录、会议纪要、行动项/action items | 关键词不足 |

### 6.3 toolBoundary / permission

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `permission.noNetwork` | boundary | P0 | `networkAccess=false` | 允许网络且无确认策略 |
| `permission.noFileWrite` | boundary | P0 | `fileWrite=false` | 允许写文件且无确认策略 |
| `permission.noExternalMessage` | boundary | P0 | `externalMessage=false` | 允许外发消息或未声明 |
| `permission.noDestructiveAction` | boundary | P0 | `destructiveAction=false` | 允许破坏性操作或未声明 |
| `toolBoundary.noForbiddenTools` | boundary | P1 | forbiddenTools 或边界章节覆盖外发/网络/命令 | 默认开放高风险工具 |
| `skillBody.boundarySection` | boundary | P1 | 正文边界与 permissions 一致 | 正文说可发送/写入/联网 |

### 6.4 dependency / resource / fixtures

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `structure.requiredFiles` | structure | P1 | 8 个最小文件存在 | 缺核心 YAML/README/SKILL.md |
| `structure.relativePaths` | compatibility | P0 | 所有引用路径相对 fixture 根 | 出现 `/home/`、`C:\Users`、`~/.openclaw` |
| `structure.singleEntry` | structure | P1 | simple fixture 只有一个 required entry | 多个 required entry |
| `resourcePlan.simpleEmpty` | dependency | P1 | simple 的 resourcePlan 为空或无 required 附属 | 声明必需附属资源 |
| `manifest.resourceFilesEmpty` | dependency | P1 | simple 的 resourceFiles 为空 | 出现未解释附属文件 |
| `dependencies.emptyForSimple` | dependency | P1 | simple 无 packages/cli/mcp/network 依赖 | 声明依赖但未解释 |

### 6.5 privacy

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `privacy.noSecrets` | privacy | P0 | 扫描 token/key/secret/password/sk- | 命中疑似密钥 |
| `privacy.noPrivatePath` | privacy | P0 | 扫描私有绝对路径、`.ssh`、`.env` | 命中私有路径 |
| `privacy.noRealContact` | privacy | P0 | 扫描手机号、邮箱、真实飞书链接 | 命中真实联系方式/链接 |
| `privacy.publicExample` | privacy | P1 | source/spec/manifest 标注 public_example 或等价脱敏等级 | 隐私等级缺失 |
| `privacy.genericPeople` | privacy | P2 | 示例人物使用负责人 A、接口负责人等泛化称呼 | 疑似真实姓名，warn |

### 6.6 replay

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `replay.caseCount` | replay | P1 | 至少 2 positive + 1 negative | 用例不足 |
| `replay.expectedFields` | replay | P1 | 每条含 input、expectedTrigger、checks、observed、passed | 字段缺失 |
| `replay.observedNotForged` | replay | P1 | 未执行前 observed/passed 不得伪通过 | observed null 但 passed=true |
| `replay.negativeBoundary` | boundary | P0 | negative 包含 noExternalMessage/noCalendarCall/noFeishuSend | 反例允许发送邀请或缺边界 |

### 6.7 7 维映射

| 错误码 | 维度 | 严重级别 | 检查内容 | 失败条件 |
|---|---|---|---|---|
| `validation.sevenKeys` | structure | P1 | checklist 含 structure/trigger/boundary/dependency/replay/privacy/compatibility | 缺任一维度 |
| `validation.noPrematurePass` | replay | P1 | 未执行回放前 replay 不得 pass | 兼容/回放未测却写 pass |
| `validation.issueSeverity` | structure | P2 | issues 使用 P0/P1/P2 或稳定映射 | severity 混乱 |
| `validation.compatibilityHonest` | compatibility | P2 | 未跨 OS 实测时状态为 pending/documented_not_executed | 未实测却写 pass |

## 7. 实施顺序建议

如果下一步真正写代码，建议按以下顺序落地：

### Step 1：冻结最小 fixture 目录与文件名

先创建 `fixtures/meeting-summary-assistant/`，只放 8 个最小文件。不要同时创建 `examples/` 镜像，避免双源漂移。

优先验证：
- 文件名是否固定。
- entry 是否为 `skill/SKILL.md`。
- 所有路径是否相对 fixture 根。

### Step 2：写出正例 fixture，不写反例目录

第一版反例不必拆多个 fixture 目录，可先放在 `replay-cases.yaml` 与测试片段里。核心是有一条完整正例链路。

优先验证：
- ID 链不断裂。
- `SKILL.md` frontmatter 与 manifest 一致。
- permissions 全保守。

### Step 3：实现 fixture loader 与 YAML/frontmatter 解析

不要先写规则。先确保能稳定读取：
- YAML 文件。
- Markdown frontmatter。
- Markdown body。
- manifest entry 对应文件。

优先验证：
- 文件不存在时能返回结构化错误。
- YAML 解析错误能定位文件。

### Step 4：实现 P0 规则

先做最能防事故的规则：
- `structure.entryExists`
- `structure.relativePaths`
- `frontmatter.exists/name/description`
- `permission.noNetwork/noFileWrite/noExternalMessage/noDestructiveAction`
- `privacy.noSecrets/noPrivatePath/noRealContact`
- `replay.negativeBoundary`

优先验证：
- 任一 P0 fail 时 `summary.passed=false`。
- 多个 P0 能全部报告，不只报第一条。

### Step 5：实现 P1 MVP 完整性规则

再做：
- required files。
- trigger examples。
- simple dependency/resource 为空。
- replay case count 与 observedNotForged。
- validation.sevenKeys。

优先验证：
- 正例 fixture P0/P1 全通过。
- 构造小片段能触发各类 P1 fail。

### Step 6：固定报告输出

实现 `summary`、`checks[]`、`suggestedValidationPatch`。先支持 JSON，文本报告可后补。

优先验证：
- `checks[].id` 稳定。
- `severity/status/dimension` 枚举固定。
- 报告可粘贴到验收结果。

### Step 7：补充最小反例测试

只补第 5 轮建议的核心反例：
- 缺 `description`。
- 私有绝对路径。
- 外发消息允许。
- 密钥模式。
- 未执行却 `passed=true`。
- checklist 缺 privacy。

优先验证：每个反例至少命中一个预期错误码。

### Step 8：再考虑 schema、批量、跨平台

当单 fixture + 单校验命令稳定后，再进入第 7 轮扩展。

## 8. 非目标

第 6 轮明确不做以下事项：

1. **不做完整生成器**：不从任意 workflow 自动生成 skill，不做 prompt 编排。
2. **不做 UI**：不实现网页、桌面、交互式验收面板。
3. **不做跨模型实测**：不声称 Claude/GPT/其他模型触发质量已验证。
4. **不做跨 OS 实测**：Windows/macOS 仍为 pending 或 documented_not_executed。
5. **不做 standard/advanced fixture**：不引入 scripts、assets、templates、references、tools。
6. **不做自动修复写回**：校验器只输出建议，不自动改 `validation-result.yaml`。
7. **不接入真实外部服务**：不调用飞书、日历、邮件、网络 API。
8. **不使用真实会议内容**：所有示例必须是脱敏公开样例。
9. **不把静态检查包装成运行时通过**：静态 pass 不等于模型回放 pass。

## 9. 优化动作

### 9.1 P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只创建 `docs/optimization/round-06.md` 分析文档，不创建真实 fixture、不写校验器代码、不引入真实会议内容、不执行外部请求、不改变权限默认值。

但下一步实现时，以下情况必须立即视为 P0：

1. fixture 中出现 token、密钥、真实手机号/邮箱、真实飞书链接、私有绝对路径。
2. `externalMessage`、`networkAccess`、`fileWrite`、`destructiveAction` 默认为允许。
3. `negative_001` 允许发送会议邀请、日历邀请或飞书消息。
4. manifest entry 指向不存在文件且报告仍显示通过。
5. 校验器在 P0 fail 时输出 `summary.passed=true`。

### 9.2 P1：高优先级动作

| 动作 | 目标 | 建议下一步 | 关闭条件 |
|---|---|---|---|
| 落地最小 fixture | 关闭无样例风险 | 先创建 `fixtures/meeting-summary-assistant/` | 8 个文件存在，ID 链完整 |
| 实现最小 loader | 支撑规则执行 | 读取 YAML/frontmatter/body | 解析错误可定位文件和字段 |
| 实现 P0/P1 静态规则 | 关闭安全和结构风险 | 从 entry/frontmatter/privacy/permission 做起 | P0/P1 规则有稳定输出 |
| 固定输出格式 | 支撑验收引用 | JSON `summary + checks[]` | 报告可复制到 acceptance-result |
| 固定字段映射 | 避免模型分裂 | README 或 validator 文档记录 | checklist/dependencies/method 映射清楚 |
| 建立反例测试片段 | 防止规则空跑 | 至少覆盖 5 个核心失败场景 | 每个反例命中预期错误码 |

### 9.3 P2：中优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---:|---|
| 完整 schema 草案 | 从硬编码规则扩展到结构约束 | 第 7 轮 | 最小 fixture 字段可被 schema 表达 |
| 英文触发样例 | 覆盖 `Use when ... Examples` | 第 7 轮 | 至少 1 个英文触发片段 |
| 批量 fixture 校验 | 支撑多个样例 | 第 7-8 轮 | 单 fixture 校验稳定后支持 glob |
| standard fixture 设计 | 覆盖 tools/references | 第 7-8 轮 | 附属文件声明与依赖规则明确 |
| 兼容实测矩阵 | 从静态说明到环境证据 | 第 8 轮 | Linux 有结果，其他平台 pending 或实测 |
| 指标汇总 | 支撑 10 轮对比 | 每轮 | 记录 ruleCount、pass/warn/fail、P0/P1/P2 |

## 10. 下一轮重点建议

第 7 轮建议聚焦 **“真实最小 fixture 与最小静态校验器落地验证”**。

具体建议：

1. 创建 `fixtures/meeting-summary-assistant/`，写入 8 个最小文件。
2. 实现一个最小命令入口，能读取 fixture 并输出 JSON 报告。
3. 首先实现 P0 规则，再实现 P1 规则，不碰 P2 扩展。
4. 构造少量反例片段验证错误码稳定性。
5. 把一次校验输出摘录进第 7 轮分析文档，作为真实证据。
6. 若时间不足，优先保证正例 fixture + entry/frontmatter/privacy/permission 四类规则跑通。

第 7 轮不建议做完整生成器、UI、跨模型测试。先让最小闭环跑起来，小龙虾才好继续挑刺。

## 11. 本轮结论

**结论：允许继续第 7 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 第 5 轮测试矩阵已被收敛为一个可实施的最小工程切片。
3. 第一版 fixture 文件结构、命令入口、输出格式、规则集合和错误码已明确。
4. P0/P1 静态规则覆盖 SKILL.md/frontmatter/description trigger/toolBoundary/privacy/fixtures/7 维映射等 MVP 必需项。
5. 已明确哪些内容推迟：完整生成器、UI、跨模型实测、跨 OS 实测、standard/advanced 样例、自动修复写回。
6. 下一轮有清晰落地顺序：先 fixture，再 loader，再 P0 规则，再 P1 规则，最后报告和反例测试。

因此，第 7 轮可以从设计文档进入真实最小资产落地。别再绕圈了，再绕就不是优化，是虾跑步机。