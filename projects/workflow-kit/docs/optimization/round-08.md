# SkillForge 优化第 8 轮分析

## 1. 本轮目标

第 7 轮已经完成实现风险预演与可维护性设计，结论允许进入第 8 轮，并建议聚焦 **“真实最小 fixture 与最小静态校验器落地验证”**。

但本轮任务范围仍限定为分析文档：**只产出 `docs/optimization/round-08.md`，不创建 fixture、不实现校验器、不修改 `acceptance-result.md`，也不改任何核心设计文档**。因此，本轮目标不是把代码写出来，而是把第 7 轮的实现边界转成下一步可以照着执行、可以验收、可以复现的落地验证路线。

本轮重点回答 6 个问题：

1. 第 7 轮提出的风险治理策略，哪些必须保留，哪些应压缩到 MVP。
2. 第一个真实最小 fixture 应怎样创建，避免一上来就变成样例库工程。
3. 最小静态校验器第一版应验证哪些规则，如何避免过严或过松。
4. 第一批最小样例组合应覆盖哪些正例/反例，以及每个样例预期关闭什么风险。
5. 校验结果如何保证可复现，并如何作为 `docs/acceptance-result.md` 的后续更新依据。
6. 本轮方案能关闭 `PASS_WITH_RISK` 中哪些风险，哪些仍不能关闭。

一句话：第 7 轮把锅检查了一遍；第 8 轮先写清“第一只虾怎么下锅、怎么验熟、怎么证明不是闻着香就算熟”。

## 2. 对第 7 轮结论的复盘

### 2.1 应保留的风险治理策略

| 第 7 轮策略 | 本轮判断 | 保留方式 |
|---|---|---|
| 一个 simple fixture 起步 | 保留 | 第一批只冻结 `fixtures/meeting-summary-assistant/` 作为唯一公开正例目录；其他反例优先用临时副本或内联片段 |
| 8 个最小文件 | 保留 | `README.md`、5 个实体 YAML、`replay-cases.yaml`、`validation-result.yaml`、`skill/SKILL.md` 作为 fixture 最小闭环 |
| P0/P1 fail-fast | 保留 | `summary.passed=true` 只允许在 P0=0 且 P1=0 时出现；P2 不阻断 |
| 错误码沿用规则 ID | 保留 | 校验输出、文档和测试预期都使用 `privacy.noSecrets` 等规则 ID，不另造 `E001` |
| 静态检查与运行时回放分离 | 保留 | 未实际回放时只能标记 `runtime_replay_pending` 或 `observed=null`，不得写成 pass |
| 输出 `summary + checks[] + suggestedValidationPatch` | 保留 | 第一版只输出建议 patch，不自动改 `validation-result.yaml` |
| evidence 脱敏 | 保留 | 隐私命中只展示掩码片段，如 `sk-***`、`138****0000`，避免二次泄漏 |
| 单 fixture 命令输入 | 保留 | 第一版只支持一个 fixture 根目录；批量、watch、HTML、自动修复都延后 |
| 版本策略 | 保留 | fixture、report、ruleSet 分别记录版本，不用一个版本号包打天下 |
| 文档同步机制 | 保留 | 规则 ID、示例报告、验收结果必须人工或脚本对账，历史 round 不回写覆盖 |

### 2.2 需要压缩到 MVP 的策略

| 第 7 轮策略 | 压缩原因 | MVP 压缩方案 |
|---|---|---|
| 完整规则注册表 | 重要但不应阻断第一条校验链路 | 第一版只维护最小规则清单：`id/dimension/severity/statusPolicy/description`，不做复杂生命周期管理 |
| 完整 schema 演进 | 过早写 JSON Schema 会固化未验证抽象 | 先做轻 schema：必需文件、必需字段、枚举值、版本字段；完整 JSON Schema 放到后续轮次 |
| 多反例目录 | 目录级反例会提高维护成本 | 第一版只保留 1 个公开正例 fixture；反例通过临时复制正例再注入错误，或测试片段构造 |
| 文档自动同步检查 | 有价值但需要实现基础 | 第一版先人工对账规则 ID 与示例输出；脚本化同步作为 P1/P2 后续动作 |
| 隐私疑似姓名/组织识别 | 误报高，容易拖慢 MVP | P0 只覆盖高置信 token、路径、联系方式、真实链接；疑似姓名/组织为 P2 warn + 人工 note |
| 跨平台/跨模型验证 | 不是静态校验器第一版能力 | 当前只记录环境假设和路径兼容；macOS/Windows/模型回放保持 pending |
| CLI 名称冻结 | 过早固定命令会影响实现 | 第一版可使用项目脚本，如 `pnpm validate:fixture <fixtureDir>`；正式 `skillforge validate` 后续再冻结 |
| normalize 层完整映射 | 必须有，但不必覆盖所有未来字段 | 先覆盖 `checklist`、`dependencies`、`method` 三类已知差异 |

本轮复盘结论：第 7 轮的方向不需要推翻，但必须把“治理体系”压缩成“能让第一条真实验证跑起来的纪律”。MVP 不怕简陋，怕的是还没跑就开始装修监控大屏。

## 3. 优点与保持/扩大方式

### 优点 1：最小闭环边界已经足够清楚

第 5-7 轮已经把第一版收敛为：一个 simple fixture、一个静态校验入口、一组 P0/P1 规则、一份结构化报告。

**保持/扩大方式**：
- 下一步实现只允许围绕 `meeting-summary-assistant` 展开。
- 不同时引入 standard/advanced、批量扫描、自动修复、UI、跨平台矩阵。
- 所有新增能力必须回答“是否关闭当前 P0/P1 风险”；不能关闭就延后。

### 优点 2：规则 ID 与验收维度可直接复用

`structure.entryExists`、`frontmatter.description`、`privacy.noSecrets`、`validation.sevenKeys` 等 ID 已能映射到 7 维验证和验收风险。

**保持/扩大方式**：
- 第一版错误码直接使用规则 ID。
- `checks[].dimension` 固定为 `structure/trigger/boundary/dependency/replay/privacy/compatibility`。
- 每个失败结果必须带 `evidence.path` 或 `evidence.field`，方便更新验收结果。

### 优点 3：隐私和权限风险可静态 fail-fast

真实 token、私有路径、联系方式、真实飞书链接、外发消息默认允许、网络/写文件/破坏性操作默认开放等问题，都可以不依赖模型回放直接发现。

**保持/扩大方式**：
- P0 隐私规则只选高置信模式，保证误报少、阻断有理。
- 权限缺失默认视为不安全，而不是默认允许。
- 校验报告中 P0 失败必须让 `summary.passed=false`。

### 优点 4：回放证据诚实性已有保护方案

第 7 轮明确区分 expected 与 observed，避免“未执行回放却写已通过”。

**保持/扩大方式**：
- `replay-cases.yaml` 初始 `observed=null`、`passed=null`。
- `validation-result.yaml` 中 replay/compatibility 未实测项只能为 `pending` 或 `documented_not_executed`。
- 静态校验报告只证明文件与证据状态合法，不声称模型触发质量已实测通过。

### 优点 5：fixture 与核心数据模型差异已提前识别

`ValidationResult.checklist` 的对象/数组差异、`dependencies` 的空数组/对象差异、`method: manual_plus_static_check` 与核心枚举 `hybrid` 的差异都已暴露。

**保持/扩大方式**：
- 下一步 loader 必须有 normalize 层，而不是让规则直接依赖原始 YAML 形态。
- fixture README 记录 fixture-only 字段和核心模型映射。
- 报告输出使用规范化后的字段，避免把便利字段误当核心模型。

### 优点 6：可复现设计可以轻量落地

第 7 轮已经提出 `fixtureVersion/reportVersion/ruleSetVersion`，本轮可将它们转为验证路线中的固定输入和输出锚点。

**保持/扩大方式**：
- fixture 创建后冻结版本和文件清单。
- 每次运行输出 `reportVersion`、`ruleSetVersion`、命令、环境摘要。
- 示例报告摘要进入后续 `acceptance-result.md` 或优化文档，作为可复查证据。

### 优点 7：第 8 轮不实际实现，反而能避免盲写

本轮只做计划，能在动手前明确样例组合、关闭条件和不可复现风险，减少下一步实现返工。

**保持/扩大方式**：
- 把下一步实现步骤拆到最小，不让开发者临场决定规则范围。
- 明确 P0 无阻断时才能进入第 9 轮真实落地。
- 对所有“看起来顺手”的扩展提前标为非目标。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：真实 fixture 偏少

**级别**：P1  
**表现**：如果第一版只有 1 个正例 fixture，容易过拟合会议纪要场景；如果一口气加很多 fixture，又会拖垮 MVP。

**改善办法**：
- 第一批公开冻结只做 1 个正例 fixture：`meeting-summary-assistant`。
- 反例通过临时副本或测试片段构造，不进入长期 fixture 库。
- 在报告中明确“当前只验证 simple 单文件 skill，不代表所有 SkillForge 场景”。

**关闭条件**：
- `meeting-summary-assistant` 8 个最小文件存在且 P0/P1 静态通过。
- 至少 2 个正例 replay case + 1 个反例 replay case 存在。
- 第 9 轮或后续明确是否需要第二个非会议 simple fixture 来验证泛化。

### 风险 2：校验器规则过严

**级别**：P1  
**表现**：规则如果把会议纪要关键词、中文章节名或当前目录结构写死，未来其他 simple skill 会大量误报；P2 warn 若被算入 fail，也会导致正例过不了。

**改善办法**：
- 规则分为 `generic` 与 `fixture-profile` 两类。
- 通用规则只检查结构、安全、权限、证据诚实性。
- 会议纪要关键词只作为当前 fixture 的 trigger profile，不升级为全局硬规则。
- `summary.passed` 只看 P0/P1，P2 不阻断。

**关闭条件**：
- 每条启用规则标注 scope。
- 正例 fixture 不因 P2 warn 失败。
- 业务关键词不足不会触发 P0，只能触发 P1/P2 或人工审查。

### 风险 3：校验器规则过松

**级别**：P1  
**表现**：如果只检查文件存在，不检查权限、隐私、回放伪通过，就会出现“结构通过但安全不可用”。

**改善办法**：
- 第一版 P0 必须覆盖 entry、frontmatter、权限、隐私、私有路径、反例外发边界。
- 第一版 P1 必须覆盖 required files、simple 无附属依赖、replay 未伪通过、7 维 checklist。
- 反例至少覆盖一个 P0 和一个 P1 失败。

**关闭条件**：
- `missing_frontmatter_description` 能触发 P0/P1 中的预期错误码。
- `secret_or_private_path` 能触发 `privacy.noSecrets` 或 `privacy.noPrivatePath`。
- `replay_passed_without_observed` 能触发 `replay.observedNotForged`。

### 风险 4：错误码与文档不同步

**级别**：P1  
**表现**：文档写 `privacy.noSecrets`，实现输出 `privacy.secretFound`；或文档仍引用已删除规则，会导致验收证据不可复查。

**改善办法**：
- 第一版建立最小规则清单，文档和实现都引用同一组 ID。
- 新增/删除/改名规则必须同步示例报告和 round 文档。
- 不允许只因文案变化新增错误码。

**关闭条件**：
- 示例报告中的每个 `checks[].id` 都能在规则清单中找到。
- `docs/optimization/round-08.md` 后续引用真实输出时不出现孤儿 ID。
- 改名规则有迁移说明或 alias。

### 风险 5：验证结果不可复现

**级别**：P1  
**表现**：fixture 被修改但版本不变；命令、环境、规则集版本未记录；输出顺序不稳定；报告包含当前时间导致快照难比较。

**改善办法**：
- 输入冻结：fixture version、文件清单、关键字段和相对路径固定。
- 输出快照：报告包含 `reportVersion/ruleSetVersion/fixtureVersion`，checks 按 id 排序。
- 命令约定：记录完整命令和工作目录。
- 环境假设：记录 OS、Node/pnpm 或脚本运行环境，不声称跨平台通过。

**关闭条件**：
- 同一 fixture、同一规则集、同一命令重复运行，P0/P1 结果一致。
- 输出报告有稳定 summary 和 checks 顺序。
- 任一失败都能通过 evidence 定位到具体 path/field。

### 风险 6：fixture 字段与核心模型继续分裂

**级别**：P1  
**表现**：fixture 为了可读性使用对象 key 或便利枚举，后续接入核心模型时无法映射。

**改善办法**：
- README 中列出 fixture-only 字段。
- normalize 层处理 `checklist`、`dependencies`、`method`。
- 校验报告中保留规范化结果，不直接传播不稳定便利字段。

**关闭条件**：
- 三类已知差异均有映射说明。
- 校验器对空数组和空对象依赖形态给出等价判断。
- `method: manual_plus_static_check` 能映射为核心 `hybrid` 或明确标注 fixture-only。

### 风险 7：静态验证被误解为运行时通过

**级别**：P1  
**表现**：静态检查通过后，验收结果被写成“模型回放通过”或“跨平台兼容通过”。

**改善办法**：
- 报告字段区分 `static_checked`、`runtime_replay_pending`、`cross_os_pending`。
- `suggestedValidationPatch` 中对未执行项只建议 pending，不建议 pass。
- `acceptance-result.md` 更新时必须说明证据类型。

**关闭条件**：
- 未执行回放时 `replay` 不出现 pass。
- 未跨 OS 实测时 `compatibility` 不出现 pass。
- 文档明确静态通过只关闭结构/安全/证据状态风险，不关闭模型行为风险。

## 5. 落地验证路线

本节是下一步真实实现时的最小执行路线。本轮不执行这些步骤，只把路线固定下来。

### Step 0：确认非目标

在动手前先声明不做：

1. 不做完整生成器。
2. 不做 UI/服务端/数据库。
3. 不做批量 fixture 扫描。
4. 不做自动修复或默认写回。
5. 不做跨模型/跨 OS 实测。
6. 不创建 standard/advanced fixture。
7. 不接入飞书、日历、邮件、网络 API 或真实外部服务。
8. 不保存真实会议内容、真实联系人、真实链接、真实本机路径。

### Step 1：创建最小 fixture

目标目录：

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

创建要求：

- `fixtureVersion: 0.1.0`。
- entry 固定为 `skill/SKILL.md`。
- 仅包含公开、脱敏、虚构会议内容。
- 权限全保守：无网络、无写文件、无外发消息、无破坏性操作。
- replay case 初始 observed/passed 为 null 或 pending，不伪造运行结果。
- validation checklist 覆盖 7 维，未实测项写 pending/documented_not_executed。

### Step 2：冻结输入

冻结内容：

1. 必需文件列表。
2. ID 链：`WorkflowSource -> SkillSpec -> GenerationRun -> SkillManifest -> ValidationResult`。
3. `skill-manifest.yaml.entry` 与实际文件路径。
4. replay case 数量：至少 2 正例 + 1 反例。
5. 权限边界和隐私等级。
6. `fixtureVersion` 与 changelog。

冻结后不得无记录修改。若为了让校验通过而改 fixture，必须说明：改动原因、影响规则、是否改变预期结果。

### Step 3：实现最小 loader

loader 只负责读取和规范化，不先做复杂规则：

1. 读取 YAML 文件。
2. 读取 `skill/SKILL.md` frontmatter 和正文。
3. 对齐 manifest entry 与实际文件。
4. 捕获 YAML/frontmatter 解析错误，并输出结构化 check。
5. 规范化 `checklist/dependencies/method`。

解析失败时也应输出报告，而不是直接抛堆栈。

### Step 4：实现 P0 静态规则

优先规则：

| 规则 | 验证目的 |
|---|---|
| `structure.entryExists` | entry 指向文件必须存在 |
| `frontmatter.exists` | `SKILL.md` 必须有 frontmatter |
| `frontmatter.name` | name 与 manifest 一致 |
| `frontmatter.description` | description 必须存在并承担触发职责 |
| `permission.noNetwork` | 不允许默认联网 |
| `permission.noFileWrite` | 不允许默认写文件 |
| `permission.noExternalMessage` | 不允许默认外发消息 |
| `permission.noDestructiveAction` | 不允许默认破坏性操作 |
| `privacy.noSecrets` | 不允许 token/key/secret/password/sk- |
| `privacy.noPrivatePath` | 不允许 `/home/`、`C:\Users`、`~/.openclaw`、`.ssh`、`.env` |
| `privacy.noRealContact` | 不允许真实邮箱、手机号、真实飞书链接 |
| `replay.negativeBoundary` | 反例不得允许外发会议邀请/消息 |

### Step 5：实现 P1 MVP 规则

优先规则：

| 规则 | 验证目的 |
|---|---|
| `structure.requiredFiles` | 8 个最小文件齐全 |
| `structure.singleEntry` | simple fixture 只有一个 required entry |
| `trigger.positiveExamples` | 至少 2 个正例表达 |
| `trigger.negativeExamples` | 至少 1 个明确反例 |
| `resourcePlan.simpleEmpty` | simple 不要求附属资源 |
| `manifest.resourceFilesEmpty` | simple 不声明必需附属文件 |
| `dependencies.emptyForSimple` | simple 无 CLI/MCP/network/package 依赖 |
| `replay.caseCount` | replay 至少 2 正 + 1 反 |
| `replay.expectedFields` | replay 字段完整 |
| `replay.observedNotForged` | 未执行不得伪造 passed=true |
| `validation.sevenKeys` | checklist 覆盖 7 维 |
| `validation.noPrematurePass` | 未实测 replay/compatibility 不得 pass |

### Step 6：输出结构化报告

建议第一版输出到 stdout：

```json
{
  "reportVersion": "0.1.0",
  "ruleSetVersion": "0.1.0",
  "fixtureVersion": "0.1.0",
  "summary": {
    "passed": false,
    "fixture": "fixtures/meeting-summary-assistant",
    "ruleCount": 24,
    "passCount": 0,
    "warnCount": 0,
    "failCount": 0,
    "p0Count": 0,
    "p1Count": 0,
    "p2Count": 0
  },
  "checks": [
    {
      "id": "privacy.noSecrets",
      "dimension": "privacy",
      "severity": "P0",
      "status": "pass",
      "message": "未发现高置信密钥模式",
      "evidence": {
        "path": "skill/SKILL.md",
        "field": "body"
      }
    }
  ],
  "suggestedValidationPatch": {
    "checklist": {
      "privacy": {
        "status": "static_checked",
        "evidence": "privacy.* checks passed"
      },
      "replay": {
        "status": "runtime_replay_pending",
        "evidence": "static replay shape checked; observed remains null"
      }
    }
  }
}
```

要求：

- `summary.passed=true` 仅当 P0/P1 fail 为 0。
- `checks[]` 按 `id` 排序，降低快照噪音。
- evidence 指向 path/field，隐私 excerpt 必须脱敏。
- 不默认写入 `validation-result.yaml`。

### Step 7：运行最小静态校验

推荐命令二选一，取决于实现时项目脚本形态：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
pnpm validate:fixture fixtures/meeting-summary-assistant --format json
```

或：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
skillforge validate fixtures/meeting-summary-assistant --format json
```

第一版只承诺单 fixture 根目录输入，不承诺 glob、批量、自动修复、HTML 报告。

### Step 8：输出结果并保存证据摘要

下一步实现完成后，应保存或复制以下摘要到后续文档：

1. 命令与工作目录。
2. fixtureVersion/reportVersion/ruleSetVersion。
3. summary：passed、ruleCount、pass/warn/fail、P0/P1/P2。
4. 失败 checks 的 id、severity、evidence。
5. 对 `validation-result.yaml` 的建议 patch，但不自动写回。

### Step 9：更新 `docs/acceptance-result.md`

本轮不更新该文件。下一步真实运行后再更新：

- 若正例 fixture P0/P1 通过：把“样例/校验器未落地”风险降级或部分关闭。
- 若存在 P0：不得写 PASS，只记录失败证据和修复动作。
- 若只有 P2 warn：可记录为风险，不阻断静态通过。
- replay/compatibility 未实测时保持 pending，不得写 pass。

## 6. 最小验证样例组合

第一批建议覆盖 **2 个正例 + 1 个反例**。这里的“样例”可以先体现在 `replay-cases.yaml` 与临时反例片段中，不要求创建多个公开 fixture 目录。

| 样例 ID | 类型 | 内容摘要 | 验证目的 | 预期结果 |
|---|---|---|---|---|
| `positive_001_meeting_summary` | 正例 | 用户提供脱敏会议记录，要求整理会议纪要、结论、行动项 | 验证 description/正文触发边界、输入输出、无外部副作用、replay 正例结构 | 静态检查通过；`expectedTrigger=true`；`observed=null`；`passed=null` |
| `positive_002_action_items` | 正例 | 用户提供会议讨论摘要，要求提取负责人、截止时间、待办事项 | 验证同一 skill 对“行动项/action items/待办”表达的覆盖，不只认“会议纪要” | 静态检查通过；`expectedTrigger=true`；不要求真实模型回放 pass |
| `negative_001_send_invitation` | 反例 | 用户要求“根据会议记录发送飞书会议邀请/通知参会人” | 验证外发消息边界；skill 应拒绝或澄清，不执行发送动作 | `expectedTrigger=false` 或 `expectedBehavior=decline_external_message`；不得允许 `externalMessage=true` |

### 6.1 建议追加的最小反例片段

为了验证错误码稳定性，除 replay 的 1 个业务反例外，下一步实现时可构造临时变体，不作为长期 fixture：

| 临时反例 | 触发规则 | 预期 |
|---|---|---|
| 删除 frontmatter description | `frontmatter.description` | P0 fail，`summary.passed=false` |
| 注入 `sk-test-secret` | `privacy.noSecrets` | P0 fail，evidence excerpt 脱敏 |
| entry 写 `/home/user/skill/SKILL.md` | `structure.relativePaths` / `privacy.noPrivatePath` | P0 fail |
| `passed=true` 但 `observed=null` | `replay.observedNotForged` | P1 fail |
| checklist 缺 `privacy` | `validation.sevenKeys` | P1 fail |

这些反例的价值是证明规则不是摆设；小龙虾不信“看起来会报错”，只信它真的咬了一口坏虾。

## 7. 可复现性设计

### 7.1 输入冻结

输入冻结对象：

1. fixture 根目录：`fixtures/meeting-summary-assistant/`。
2. `fixtureVersion: 0.1.0`。
3. 必需文件列表和相对路径。
4. 关键 ID 链路：source/spec/run/manifest/validation。
5. replay case 列表和 expected 行为。
6. 权限边界和隐私等级。

冻结原则：

- 正例 fixture 通过 P0/P1 后作为 baseline。
- 修改 baseline 必须记录原因和影响规则。
- 反例优先临时构造，不污染 baseline。

### 7.2 输出快照

输出快照必须包含：

- `reportVersion`。
- `ruleSetVersion`。
- `fixtureVersion`。
- 命令和工作目录。
- summary 统计。
- checks 明细。
- suggestedValidationPatch。

稳定性要求：

- checks 按 id 排序。
- 同一输入下 message 可轻微变化，但 id/severity/status/dimension/evidence 不应漂移。
- 时间字段若存在，应放到 metadata，不影响核心快照对比。

### 7.3 命令约定

推荐命令：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
pnpm validate:fixture fixtures/meeting-summary-assistant --format json
```

命令约定：

- 必须从项目根目录运行。
- fixture 参数必须是单个目录。
- 默认只读，不写回。
- 如果后续增加 `--write` 或 `--fix`，不得在 MVP 第一版默认启用。

### 7.4 环境假设

第一版只记录当前环境假设，不声称跨平台通过：

| 项 | 假设 |
|---|---|
| OS | Linux 当前开发环境可运行；macOS/Windows pending |
| 路径 | 所有 fixture 引用使用 POSIX 风格相对路径；不得写私有绝对路径 |
| Node/pnpm | 若使用 TypeScript/Node，需记录 Node/pnpm 版本或 package 脚本 |
| 网络 | 校验器不需要网络 |
| 外部服务 | 不调用飞书、日历、邮件、浏览器、MCP 服务 |
| 模型 | 不执行真实模型触发回放；只检查回放字段和证据状态 |

### 7.5 失败诊断

失败诊断输出要求：

1. 解析失败要定位文件和大致字段，而不是抛原始堆栈。
2. 结构失败要说明缺少哪个文件或 entry 指向哪里。
3. 隐私失败要脱敏展示命中片段。
4. 权限失败要说明哪个字段默认允许或缺失。
5. replay 失败要说明 expected/observed/passed 哪个状态冲突。
6. validation 失败要说明缺少哪个 7 维 key。

## 8. 风险关闭映射

`docs/acceptance-result.md` 当前结论为 `PASS_WITH_RISK`。本轮方案对风险关闭关系如下：

| 原风险 | 本轮方案如何关闭/缓解 | 本轮后状态 |
|---|---|---|
| 10 轮优化尚未实际执行 | 本轮产出 round-08，继续补齐 10 轮优化链路；明确第 9 轮落地验证 | 部分缓解，仍未关闭，需 round-09/10 继续 |
| 样本库局部数量标注不一致 | 本轮不处理样本统计，只避免新方案依赖该数量 | 未关闭，仍是 P2 文档严谨性风险 |
| 跨平台/模型兼容尚未实测 | 本轮明确静态校验不声称跨平台/模型通过，要求 compatibility pending | 缓解误报风险，但未关闭实测风险 |
| 样本来源偏 OpenClaw 当前环境 | 本轮只做会议纪要 simple fixture，明确当前覆盖有限 | 未关闭，需后续增加非会议/非 OpenClaw 偏置样例 |
| 自动化生成器/样例未落地 | 本轮给出 fixture 与校验器落地路线、样例组合和输出格式 | 方案层面关闭，实际关闭需第 9 轮真实落地 |
| 验收证据不足 | 本轮定义报告快照、命令、summary、checks、evidence 和建议 patch | 方案层面关闭，实际关闭需真实校验输出 |
| 隐私与权限 P0 风险 | 本轮明确 P0 规则和反例验证要求 | 可在下一步实现中关闭；本轮未实际验证 |
| 文档与实现漂移 | 本轮要求规则 ID 清单、输出快照、文档对账 | 缓解，需实现后对账才能关闭 |
| 验证结果不可复现 | 本轮定义输入冻结、输出快照、命令约定、环境假设 | 方案层面关闭，实际关闭需重复运行验证 |

结论：本轮能关闭的是“路线不清、证据格式不清、可复现要求不清”的设计风险；不能关闭“真实 fixture 未创建、校验器未运行、跨平台/模型未实测、样本泛化不足”等实证风险。

## 9. 优化动作

### 9.1 P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只创建/修改 `docs/optimization/round-08.md` 分析文档，不创建真实 fixture、不写校验器、不引入真实会议数据、不执行外部请求、不修改权限默认值、不更新验收结果。

但进入第 9 轮真实落地后，以下任一情况必须立即视为 P0：

1. fixture 中出现 token、key、secret、真实手机号/邮箱、真实飞书链接、私有绝对路径。
2. `networkAccess`、`fileWrite`、`externalMessage`、`destructiveAction` 默认为允许。
3. manifest entry 指向不存在文件但报告显示通过。
4. 未执行回放却写 `observed` 或 `passed=true`。
5. P0 fail 时 `summary.passed=true`。
6. 隐私 evidence 泄漏完整敏感值。
7. 校验器默认写回或修改 fixture。

### 9.2 P1：高优先级动作

| 动作 | 目标 | 建议落点 | 关闭条件 |
|---|---|---|---|
| 创建最小 fixture baseline | 关闭“无真实样例”风险 | `fixtures/meeting-summary-assistant/` | 8 个文件存在，ID 链完整，P0/P1 静态通过 |
| 实现最小 loader | 支撑可复现静态校验 | validator loader | YAML/frontmatter/body 可读取；解析错误结构化输出 |
| 实现 P0 规则 | 关闭隐私、权限、entry、frontmatter 风险 | validator rules | 反例能稳定触发预期 P0，P0 fail 时 passed=false |
| 实现 P1 规则 | 关闭结构完整性、simple 依赖、replay 伪通过、7 维缺项风险 | validator rules | 正例 P1 全通过；关键反例命中规则 |
| 固定报告契约 | 支撑验收证据 | report output | `reportVersion/ruleSetVersion/summary/checks/evidence` 稳定 |
| 建立最小规则清单 | 防止错误码漂移 | docs 或代码元数据 | 报告中的每个 ID 都有 dimension/severity/description |
| 定义 fixture 字段映射 | 防止核心模型分裂 | fixture README 或 validator 文档 | checklist/dependencies/method 映射清楚 |
| 记录真实运行摘要 | 关闭“只有计划无结果”的风险 | round-09 或 acceptance-result | 有命令、summary、失败/通过 evidence |

### 9.3 P2：中优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---:|---|
| 增加第二个 simple fixture | 验证规则不过拟合会议纪要 | 第 10 轮或后续 | 非会议 simple 正例能通过通用规则 |
| 完整 JSON Schema 草案 | 从硬编码规则抽象结构约束 | 第 10 轮后 | 最小 fixture 和报告契约稳定后再抽象 |
| 文档/规则 ID 自动对账 | 降低文档漂移 | 后续 | 脚本能发现文档引用的孤儿规则 ID |
| 批量 fixture 校验 | 支撑样例库扩展 | 后续 | 单 fixture 校验稳定且报告契约冻结 |
| 跨平台静态运行记录 | 关闭兼容实测风险 | 后续 | Linux/macOS/Windows 至少记录命令结果或 pending 原因 |
| 模型回放执行器 | 从静态检查进入行为验证 | 后续 | observed/passed 来自真实回放，不再 pending |
| 样本统计修正 | 提升文档严谨性 | 后续文档优化 | `sample-skill-library.md` 数量口径一致 |

## 10. 下一轮重点建议

第 9 轮应聚焦 **“真实落地最小 fixture 与最小静态校验器，并记录一次真实校验输出”**。

建议第 9 轮只做以下事情：

1. 创建 `fixtures/meeting-summary-assistant/` 的 8 个最小文件。
2. 实现最小 loader：YAML、frontmatter、Markdown body、manifest entry 对账。
3. 实现 P0/P1 MVP 规则子集，不做 P2 扩展框架。
4. 输出 JSON 报告，包含 `reportVersion/ruleSetVersion/fixtureVersion/summary/checks/suggestedValidationPatch`。
5. 构造至少 2 正例 + 1 反例，外加少量临时错误片段验证错误码。
6. 把一次真实运行摘要写入 `docs/optimization/round-09.md`，必要时再更新 `docs/acceptance-result.md`。

第 9 轮不建议做：完整生成器、UI、批量扫描、自动修复、跨平台/跨模型实测、standard/advanced fixture、复杂 schema。先把第一只虾煮熟，别同时开海鲜自助。

## 11. 本轮结论

**结论：允许继续第 9 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 已将第 7 轮的实现边界压缩为可执行的最小落地路线。
3. 已明确哪些风险治理策略保留，哪些压缩到 MVP。
4. 已给出从创建 fixture、冻结输入、实现 loader、执行 P0/P1 规则、输出报告、更新验收结果的完整流程。
5. 已定义第一批最小验证样例组合：2 个正例 + 1 个反例，并补充关键临时反例片段。
6. 已补齐可复现性设计：输入冻结、输出快照、命令约定、环境假设、失败诊断。
7. 已映射 `PASS_WITH_RISK` 中风险的关闭状态，明确哪些仍不能关闭。
8. 已按 P0/P1/P2 分类列出后续优化动作。

因此，第 9 轮应从计划进入真实落地：创建 fixture、实现最小静态校验器、运行一次真实校验并记录结果。再继续纯设计，小龙虾就要举钳抗议了。