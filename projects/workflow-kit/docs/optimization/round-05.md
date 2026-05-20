# SkillForge 优化第 5 轮分析

## 1. 本轮目标

第 4 轮已经完成 fixture 落地方案与静态校验设计，并建议第 5 轮聚焦 **“测试矩阵与实现前审查”**。本轮不创建 `fixtures/`，不实现校验脚本，不修改核心设计文档；只把第 4 轮的 fixture/静态校验设计转成未来可执行、可审查、可分阶段落地的测试计划。

本轮目标具体是：

1. 将第 4 轮定义的目录结构、命名规范、最小字段、回放用例、静态校验规则，整理成测试矩阵。
2. 明确哪些规则可以直接变成自动化测试，哪些必须补充样例或人工审查。
3. 在进入真实代码、脚本或 fixture 文件落地前，列出必须确认的实现审查清单。
4. 说明测试矩阵如何支撑 `docs/acceptance.md` 和 `docs/acceptance-result.md` 的验收项。
5. 判断是否允许继续第 6 轮，以及第 6 轮应优先实现什么。

本轮核心产出是 `docs/optimization/round-05.md`。它的定位是 **实现前闸门**：让第 6 轮如果要落地 fixture 或最小校验器，不再临时争论路径、schema、错误码、输出格式和隐私策略。

## 2. 对第 4 轮结论的复盘

### 2.1 可直接进入测试矩阵的校验规则

第 4 轮已经把大量规则拆到可机器检查或半机器检查的粒度。以下规则可直接进入测试矩阵：

| 规则类别 | 可直接测试的规则 | 进入矩阵方式 | 预期判定 |
|---|---|---|---|
| 文件结构 | `structure.requiredFiles`、`structure.entryExists`、`structure.singleEntry` | 构造缺文件、entry 不存在、多 required entry 的反例 fixture | P0/P1 fail |
| 路径兼容 | `structure.relativePaths` | 构造 `/home/...`、`C:\Users\...`、`~/.openclaw` 反例 | P0 fail |
| frontmatter | `frontmatter.exists`、`frontmatter.name`、`frontmatter.description`、`frontmatter.version` | 分别构造缺 frontmatter、name 不一致、缺 description、version 不一致 | P0 fail 或 P2 warn |
| trigger | `trigger.positiveExamples`、`trigger.negativeExamples`、`trigger.skillBodySections` | 检查 examples 数量、negativeExamples、正文“触发场景/不应触发”章节 | P1 fail |
| resourcePlan | `resourcePlan.simpleEmpty`、`manifest.resourceFilesEmpty`、`manifest.filesMatchActual` | simple tier 下构造必需附属文件、未声明文件、required 文件缺失 | P1 fail |
| 权限边界 | `permission.noNetwork`、`permission.noFileWrite`、`permission.noExternalMessage`、`permission.noDestructiveAction` | 构造 network/fileWrite/externalMessage/destructiveAction 为 true 或缺失 | P0 fail |
| 依赖 | `dependencies.emptyForSimple`、`skillBody.noImplicitDependency` | simple tier 中声明 CLI/MCP/network 或正文要求飞书/日历/API | P1 fail |
| 隐私 | `privacy.noSecrets`、`privacy.noPrivatePath`、`privacy.noRealContact` | 构造 token、私有路径、手机号、邮箱、飞书链接 | P0 fail |
| 回放 | `replay.caseCount`、`replay.expectedFields`、`replay.observedNotForged`、`replay.negativeBoundary` | 构造用例不足、字段缺失、未执行却 passed=true、反例允许发送 | P0/P1 fail |
| 7 维验证 | `validation.sevenKeys`、`validation.noPrematurePass`、`validation.issueSeverity`、`validation.compatibilityHonest` | 构造缺 checklist key、replay 伪通过、severity 混乱、兼容未测却 pass | P1/P2 fail/warn |

这些规则的共同点是：输入可由 fixture YAML/Markdown 静态读取，预期结果明确，不依赖真实模型推理质量。第 6 轮如果实现最小校验器，应优先覆盖这些规则。

### 2.2 需要补充后才能进入稳定测试矩阵的规则

| 待补充点 | 当前不足 | 补充方案 | 关闭条件 |
|---|---|---|---|
| fixture schema 形态 | `ValidationResult.checklist` 在核心模型是数组，第 4 轮 fixture 倾向对象 key | 明确 fixture 层使用对象 key，输出层可映射为数组 `{item, passed, note}` | 字段映射表写入实现前审查并被测试引用 |
| dependencies 形态 | 核心模型中是 `string[]`，第 4 轮建议对象 `{packages, cli, mcp, network}` | 测试矩阵同时覆盖空数组和空对象；实现层定义规范化函数 | 两种空依赖输入都得到等价 pass |
| trigger 语义质量 | 关键词存在不等于触发准确 | 自动检查只做结构和关键词；语义判断进入人工审查和回放 | 人工审查表有“不过宽/不过窄”判定 |
| 英文触发模式 | 第 4 轮主要围绕中文会议纪要 | 增加英文 `Use when ... Examples` 的正例 fixture 片段 | 中文/英文触发模式各有至少 1 条测试 |
| standard/advanced 复杂度 | 当前 MVP 样例是 simple | 先设计矩阵行，不要求第 6 轮实现全部 | advanced 附属文件测试标记为 P2/pending |
| 隐私误报 | token/path/contact 可测，真实姓名/组织名难稳定识别 | P0 正则自动拦截；P1 疑似姓名只进入人工复核 | P1 命中必须有人工 note |
| 兼容实测 | 目前只能做路径与纯 Markdown 静态检查 | 矩阵区分 static-compatible 与 runtime-tested | 未跨 OS 实测时不得写 pass |
| 错误码 | 第 4 轮只有规则 ID，没有输出错误码规范 | 本轮建议错误码沿用规则 ID，状态使用 pass/warn/fail/skip | 校验器输出稳定字段和规则 ID |

本轮判断：第 4 轮的方向正确，已经足以形成 MVP 测试矩阵；但进入真实实现前，必须补齐 **字段映射、错误码、输出格式、人工审查边界、fixture 冻结策略**。否则第 6 轮实现会出现“规则能写，但结果无法验收”的问题。

## 3. 优点与保持/扩大方式

### 优点 1：规则粒度已经足够接近可执行测试

**表现**：第 4 轮规则有明确 ID、维度、严重级别和失败条件，如 `frontmatter.description`、`permission.noExternalMessage`、`replay.observedNotForged`。

**保持/扩大方式**：
- 第 6 轮实现时直接以规则 ID 作为错误码，避免再设计一套命名。
- 每条规则至少保留一个正例和一个反例输入。
- 不把多个失败原因合并成一个模糊错误，例如“fixture invalid”。

### 优点 2：P0 风险边界清楚，适合 fail-fast

**表现**：隐私泄漏、私有绝对路径、外发消息默认允许、entry 缺失、反例允许发送等都已被定义为 P0。

**保持/扩大方式**：
- 校验器第一版遇到 P0 可继续收集错误，但 summary 必须立即判定 `passed=false`。
- P0 规则不得被普通 `--strict=false` 跳过。
- 人工豁免只允许 P1/P2；P0 必须修复后再继续。

### 优点 3：fixture 路径和 entry 基准已收敛

**表现**：第 4 轮固定 MVP 首选为 `fixtures/meeting-summary-assistant/`，manifest entry 固定为 `skill/SKILL.md`。

**保持/扩大方式**：
- 测试矩阵统一以 fixture 根目录为相对基准。
- `examples/` 只作为展示镜像，不作为校验器默认输入。
- 所有测试数据禁止出现绝对路径，路径兼容测试使用专门反例文件。

### 优点 4：回放状态语义已能防止伪证据

**表现**：第 4 轮明确未执行前 `observed` 和 `passed` 为 null，不能把 expected 写成已通过。

**保持/扩大方式**：
- 矩阵中单列 `replay.observedNotForged`，用反例证明能拦截 `passed=true`。
- 实现前明确 `validatedAt` 为空/非空与 `passed` 的关系。
- 自动校验器只能给静态建议，不自动把回放写成 pass。

### 优点 5：7 维验证已和验收标准天然对齐

**表现**：结构、触发、边界、依赖、回放、去隐私、兼容，与 `docs/acceptance.md` 的 V1-V7 一一对应。

**保持/扩大方式**：
- 校验输出中的 `dimension` 直接使用这 7 个 key。
- `validation-result.yaml.checklist` 必须完整保留 7 个 key，即使某项为 pending。
- 验收结果只引用有证据的 pass，不把 documented_not_executed 当成 pass。

### 优点 6：simple 样例低风险，适合做第一条冻结 fixture

**表现**：会议纪要整理助手无网络、无文件写入、无 MCP、无外发消息，权限边界简单。

**保持/扩大方式**：
- 第 6 轮如落地 fixture，仍只做 simple tier，不引入第二个复杂样例。
- standard/advanced 先做矩阵占位，等 simple 校验稳定后再扩展。
- 任何新增附属文件都必须由矩阵中的 resourcePlan/resourceFiles 规则覆盖。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：测试矩阵可能过宽，导致第 6 轮实现范围膨胀

**级别**：P1  
**影响**：如果第 6 轮同时覆盖 simple/standard/advanced、中文/英文、隐私、兼容、回放和 schema，容易拖成完整测试框架。

**改善办法**：把矩阵分层：MVP 必测只覆盖 simple + 2 正 1 反 + P0/P1 静态规则；standard/advanced 和跨 OS 标记为 P2/pending。

**关闭条件**：第 6 轮实现范围明确写为“最小 fixture + 最小静态校验器”，并列出不做项。

### 风险 2：字段映射不确认会让 fixture 与核心模型分裂

**级别**：P1  
**影响**：`checklist` 对象 key、`dependencies` 对象形态、`method: manual_plus_static_check` 等 fixture 便利字段可能和 `docs/data-structure.md` 的数组/枚举不完全一致。

**改善办法**：实现前必须定义字段映射：fixture 内部形态、核心模型形态、输出报告形态三者如何互转。

**关闭条件**：测试矩阵中的每个字段都能映射到 `WorkflowSource`、`SkillSpec`、`GenerationRun`、`SkillManifest`、`ValidationResult` 或明确标记为 fixture-only。

### 风险 3：错误码和输出格式若不稳定，会影响后续验收引用

**级别**：P1  
**影响**：`acceptance-result.md` 需要可复查证据；如果校验器每次输出文案不同，难以作为验收证据。

**改善办法**：错误码固定为规则 ID；输出固定 `summary`、`checks[]`、`suggestedValidationPatch` 三段；每条 check 必须有 `id/dimension/severity/status/message/evidence`。

**关闭条件**：任一测试失败都能给出稳定 rule id，且可被文档引用。

### 风险 4：隐私测试容易误伤示例文本或漏掉真实敏感信息

**级别**：P1  
**影响**：过严会误报普通示例，过松会放过 token、私有路径、真实联系方式。

**改善办法**：P0 只覆盖高置信模式：token/key/secret/password/sk-、私有路径、手机号、邮箱、飞书真实链接；疑似姓名/组织放到 P1 人工复核。

**关闭条件**：P0 隐私规则有正反样例；P1 疑似项输出 warn 且要求人工 note。

### 风险 5：触发质量不能完全靠静态测试证明

**级别**：P2  
**影响**：有关键词不代表模型会正确触发；反例不触发也需要真实回放或人工判断。

**改善办法**：静态测试只检查触发材料是否完整；触发准确性通过 2 个正例、1 个反例的回放记录验证。

**关闭条件**：回放用例包含 expected 与 observed；人工记录说明 positive 为什么触发、negative 为什么不触发。

### 风险 6：兼容矩阵目前仍停留在静态层

**级别**：P2  
**影响**：Linux 当前环境可以检查路径和 Markdown，但 Windows/macOS、多模型触发仍未实测。

**改善办法**：矩阵明确区分 `static_path_check`、`current_env_check`、`cross_os_pending`、`model_replay_pending`。

**关闭条件**：未实测项状态为 `pending` 或 `documented_not_executed`，不得计入 pass。

### 风险 7：fixture 冻结策略不明确会导致测试基线漂移

**级别**：P1  
**影响**：如果 fixture 在校验器开发过程中随意改，失败测试可能被“改数据”绕过。

**改善办法**：定义冻结策略：MVP fixture 首次落地后只允许通过优化文档记录变更原因；任何更改必须更新矩阵预期。

**关闭条件**：fixture README 或测试说明中记录 `fixtureVersion`、变更原因和对应优化轮次。

## 5. 测试矩阵设计

### 5.1 矩阵分层

| 层级 | 覆盖范围 | 是否第 6 轮必做 | 说明 |
|---|---|---:|---|
| M0：阻断安全层 | P0 隐私、权限、entry、反例外发 | 是 | 任一失败不得继续验收 |
| M1：MVP 静态层 | simple fixture、frontmatter、manifest、resourcePlan、dependencies、7 维 key | 是 | 最小校验器优先覆盖 |
| M2：回放证据层 | 2 正 1 反、expected/observed/passed 状态 | 部分 | 可先检查字段与伪通过，真实 observed 可 pending |
| M3：兼容说明层 | 相对路径、纯 Markdown、OpenClaw/OS/模型假设 | 部分 | 当前环境静态检查；跨 OS pending |
| M4：扩展复杂度层 | standard/advanced、附属文件、脚本/assets/templates | 否 | 仅保留设计，不阻断第 6 轮 |

### 5.2 核心覆盖矩阵

| 覆盖维度 | 正例设计 | 反例设计 | 主要规则/验收项 | 严重级别 | 第 6 轮建议 |
|---|---|---|---|---|---|
| 样例类型：正例/反例 | `positive_001` 会议纪要整理、`positive_002` action items 提取、`negative_001` 发送会议邀请 | positive 少于 2 条；negative 缺失；negative 仍 expectedTrigger=true | `replay.caseCount`、`replay.negativeBoundary`、V5 | P0/P1 | 必做 |
| 复杂度：simple | `complexityTier=simple`，`resourcePlan=[]`，`resourceFiles=[]`，仅 `skill/SKILL.md` | simple 声明必需 `scripts/`、`tools/` 或多个 required entry | `resourcePlan.simpleEmpty`、`manifest.resourceFilesEmpty`、P6 | P1 | 必做 |
| 复杂度：standard | 设计 `references/` 或 `tools/` 作为非 MVP 样例占位 | 未声明附属文件却引用 references | `manifest.filesMatchActual`、P6/P7 | P2 | 暂缓 |
| 复杂度：advanced | 设计 scripts/assets/templates 的未来矩阵行 | 脚本无依赖声明、路径不可解析 | V4、P7 | P2/P1 | 暂缓 |
| 触发模式：中文 | description/正文包含“会议记录、会议纪要、行动项、待办” | description 只写“整理内容”，或缺“触发场景”章节 | `frontmatter.triggerDuty`、`trigger.keywordCoverage`、P4/V2 | P1/P2 | 必做 |
| 触发模式：英文 | `Use when meeting notes/action items need summarization`；Examples 至少 2 条 | 英文 description 只有营销语，无 Examples | `trigger.positiveExamples`、S4/P4 | P1 | 建议做一个轻量用例 |
| 附属文件 | simple 无附属；manifest.files 只含 entry | `resourceFiles` 有未解释文件；实际目录有未声明 required 文件 | `manifest.noUntrackedRequired`、P6 | P1/P2 | 必做 simple |
| 有无工具权限 | 权限全 false；allowedTools 为空或只读；forbiddenTools 含外发/网络/命令类 | network/fileWrite/externalMessage/destructiveAction 为 true 或缺失确认策略 | `permission.*`、P7/V3 | P0 | 必做 |
| 隐私等级 | `privacyLevel=public_example`，示例使用“负责人 A/接口负责人” | token、私有路径、真实手机号/邮箱、真实飞书链接、疑似真实姓名 | `privacy.*`、V6 | P0/P1 | 必做 |
| 路径兼容 | 所有路径相对 fixture 根目录，entry=`skill/SKILL.md` | `/home/...`、`C:\Users\...`、`~/.openclaw`、entry 指向不存在文件 | `structure.relativePaths`、`structure.entryExists`、P8/V7 | P0 | 必做 |
| 7 维验证 | checklist 含 structure/trigger/boundary/dependency/replay/privacy/compatibility | 缺任一 key；未执行回放却 replay=pass；兼容未测写 pass | `validation.sevenKeys`、`validation.noPrematurePass`、V1-V7 | P1/P2 | 必做 |
| 输出格式 | 校验器输出 `summary` + `checks[]` + `suggestedValidationPatch` | 只输出自然语言，缺 rule id/severity/status/evidence | D5/C3/C5 | P1 | 第 6 轮实现前确认 |
| 错误码 | rule id 稳定，如 `privacy.noSecrets` | 错误码随机、不可复查 | C4/O7 | P1 | 第 6 轮实现前确认 |

### 5.3 最小测试用例包建议

第 6 轮如果进入实现，建议最小测试包不要超过以下 10 类：

1. `valid_simple_meeting_summary`：完整正例 fixture，预期静态通过，回放 observed 可 pending。
2. `missing_skill_md`：manifest entry 指向文件不存在，预期 `structure.entryExists` P0 fail。
3. `missing_frontmatter_description`：缺 description，预期 `frontmatter.description` P0 fail。
4. `entry_private_absolute_path`：entry 或 files 出现私有绝对路径，预期 `structure.relativePaths` P0 fail。
5. `permission_external_message_true`：外发消息默认允许，预期 `permission.noExternalMessage` P0 fail。
6. `secret_in_skill_body`：正文含 `sk-...` 或 `secret=...`，预期 `privacy.noSecrets` P0 fail。
7. `simple_with_required_script`：simple 声明必需脚本，预期 `resourcePlan.simpleEmpty` 或 `dependencies.emptyForSimple` P1 fail。
8. `replay_passed_without_observed`：未执行却 `passed=true`，预期 `replay.observedNotForged` P1 fail。
9. `negative_case_allows_send`：反例发送会议邀请被标为触发或缺 `noExternalMessage`，预期 P0/P1 fail。
10. `validation_missing_privacy_key`：7 维 checklist 缺 privacy，预期 `validation.sevenKeys` P1 fail。

### 5.4 人工审查矩阵

以下内容不建议第一版自动判定 pass，只做人工审查：

| 审查项 | 人工判断问题 | 证据位置 | 通过条件 |
|---|---|---|---|
| 触发是否过宽 | 是否会把普通文本整理误判为会议纪要 skill | `description`、`triggers`、`SKILL.md` | 明确限定会议记录/纪要/action items |
| 触发是否过窄 | 是否漏掉“提取待办”“整理 action items”等真实表达 | `triggers.examples`、回放正例 | 2 个正例覆盖不同表达 |
| 输出是否不编造 | 缺负责人/截止时间时是否写“未提供” | `SKILL.md` 输出格式 | 明确禁止补造 |
| 反例边界是否清楚 | 发送会议邀请时是拒绝/澄清，而不是执行 | `negative_001`、边界章节 | 不触发外发能力 |
| 隐私疑似项 | 人名、组织名是否为虚构或泛化 | README、source/spec/skill | P1 疑似项有说明 |

## 6. 实现前审查清单

进入真实代码、脚本或 fixture 实现前，必须逐项确认：

### 6.1 文件结构与路径

- [ ] fixture 根目录唯一使用 `fixtures/meeting-summary-assistant/`。
- [ ] MVP 不同时维护 `examples/meeting-summary-assistant/` 作为校验输入。
- [ ] entry 固定为 `skill/SKILL.md`，相对 fixture 根目录解析。
- [ ] 必需文件为 README、5 个实体 YAML、replay、validation、`skill/SKILL.md`，缺失即失败。
- [ ] 所有路径禁止私有绝对路径和用户主目录路径。

### 6.2 schema 与字段映射

- [ ] 明确 fixture YAML 字段与 `docs/data-structure.md` 核心实体字段的映射。
- [ ] `ValidationResult.checklist` fixture 对象 key 可映射为核心模型数组。
- [ ] `dependencies` 支持空数组和对象形态的规范化策略。
- [ ] `method: manual_plus_static_check` 是否作为 fixture-only，或映射到核心枚举 `hybrid`。
- [ ] `compatibility.status=documented_not_executed` 不被计算为 pass。

### 6.3 错误码与严重级别

- [ ] 错误码使用第 4 轮规则 ID，例如 `frontmatter.description`。
- [ ] 严重级别只用 `P0/P1/P2`，输出状态只用 `pass/warn/fail/skip/pending`。
- [ ] P0 不允许豁免；P1 需要关闭条件；P2 可作为 warning。
- [ ] summary 必须统计 `p0Count/p1Count/p2Count`。
- [ ] 同一输入多条失败可全部输出，不只报第一条。

### 6.4 输出格式

- [ ] 校验器输出固定包含 `summary.passed`、`summary.p0Count/p1Count/p2Count`。
- [ ] `checks[]` 每项包含 `id`、`dimension`、`severity`、`status`、`message`、`evidence`。
- [ ] 可选 `suggestedValidationPatch` 只给建议，不自动篡改 `validation-result.yaml`。
- [ ] 输出可被复制到 `docs/acceptance-result.md` 作为证据。
- [ ] 人类可读文本和机器可读结构不要混在同一字段里。

### 6.5 隐私脱敏

- [ ] P0 扫描模式覆盖 token/key/secret/password/sk-、私有路径、真实手机号、邮箱、真实飞书链接。
- [ ] fixture 示例人物使用泛化称呼，不使用真实姓名和组织。
- [ ] `WorkflowSource.content` 不保存真实会议原文。
- [ ] `GenerationRun.logs` 只保存摘要，不保存敏感 prompt 或上下文。
- [ ] 隐私扫描命中 P0 时停止进入验收。

### 6.6 fixture 冻结策略

- [ ] 首个 fixture 落地后标记 `fixtureVersion: 0.1.0` 或等价说明。
- [ ] 任何 fixture 内容变更必须说明对应优化轮次和原因。
- [ ] 测试矩阵预期与 fixture 版本绑定，避免静默漂移。
- [ ] 反例 fixture 不得被删除来“修复”失败，只能修规则或修产物。
- [ ] 回放 observed/passed 只有真实执行后才能更新。

### 6.7 实现范围非目标

- [ ] 第 6 轮不实现完整生成器。
- [ ] 第 6 轮不引入真实会议内容。
- [ ] 第 6 轮不默认支持 advanced 脚本型 skill。
- [ ] 第 6 轮不执行外部消息、网络请求、文件写入等副作用。
- [ ] 第 6 轮不把未实测兼容项写成 pass。

## 7. 与验收标准的对应关系

### 7.1 对 `docs/acceptance.md` 的支撑

| 验收项 | 测试矩阵支撑方式 | 证据形态 |
|---|---|---|
| D1 主链路实体完整 | fixture 文件链覆盖 WorkflowSource、SkillSpec、GenerationRun、SkillManifest、ValidationResult | ID 引用链检查结果 |
| D3 字段覆盖输入/输出/约束 | `skill-spec.yaml` 必填字段、inputs/outputs/constraints/permissionBoundary 测试 | schema/字段存在检查 |
| D4 产物清单可审计 | manifest entry、files、resourceFiles、dependencies、permissions、compatibility 测试 | `structure.*`、`manifest.*` checks |
| D5 验证与验收可追踪 | validation-result 与 run/manifest 关联，checklist/testCases 有 evidence | `validation.sevenKeys`、ID 链检查 |
| P1-P5 产物设计 | SKILL.md、frontmatter、description 触发、正文结构、边界章节测试 | frontmatter/trigger/body checks |
| P6-P8 附属/依赖/路径 | simple 无附属、依赖为空、路径相对化 | resource/dependency/path checks |
| V1-V7 7 维验证 | 矩阵直接按 structure/trigger/boundary/dependency/replay/privacy/compatibility 组织 | validation checklist 与校验报告 |
| O7 每轮后验证 | 第 6 轮及后续可引用校验器输出或人工审查结果 | `summary` + `checks[]` |
| C3 没有空泛验收项 | 每条矩阵均有输入、失败条件、严重级别、证据 | 测试用例与 rule id |
| C4 风险可追踪 | P0/P1/P2 与关闭条件绑定 | issue/risk 表 |
| C5 后续结果文档可填写 | 输出格式可直接填入 acceptance-result | summary 和 evidence |

### 7.2 对 `docs/acceptance-result.md` 的支撑

`docs/acceptance-result.md` 当前结论是 **PASS_WITH_RISK**，遗留风险包括 10 轮优化未实际完成、跨平台/模型兼容未实测、自动化生成器/样例未落地等。本轮矩阵对这些风险的支撑是：

1. **关闭“只有机制，没有可测样例”的风险**：第 6 轮可按本矩阵落地最小 fixture，并用静态校验证明样例链可审查。
2. **增强 P1/P2 风险证据**：矩阵会输出 P0/P1/P2 数量，使后续 acceptance-result 不只靠人工描述。
3. **防止兼容风险被误报为已通过**：兼容项未实测时明确 `documented_not_executed`，对应验收结果中的跨平台风险。
4. **支撑 10 轮优化 O7**：后续每轮可引用同一套 rule id 和 summary，比纯文档分析更可比较。
5. **支撑 PASS_WITH_RISK 的 requiredFollowUps**：fixture、schema、兼容矩阵、隐私扫描都能映射到后续优化动作。

换句话说，本轮不是改变验收结论，而是把 `PASS_WITH_RISK` 中的“risk”拆成可测试、可关闭、可复查的工作项。

## 8. 优化动作

### 8.1 P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只创建优化分析文档，没有创建真实 fixture、没有引入真实会议数据、没有实现会执行外部副作用的脚本，也没有修改权限默认值或核心数据结构。

但第 6 轮开始落地 fixture/校验器后，以下情况必须立即视为 P0：

1. fixture 或测试样例出现 token、key、secret、真实手机号/邮箱、真实飞书链接、私有绝对路径。
2. `permissionBoundary.externalMessage`、`networkAccess`、`fileWrite`、`destructiveAction` 默认允许且无确认策略。
3. `negative_001` 被标记为应触发会议纪要 skill，或允许发送会议邀请。
4. manifest entry 指向不存在文件，导致产物无法审计。
5. 校验器输出缺少 P0 失败但仍给 `summary.passed=true`。

### 8.2 P1：高优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---|---|
| 落地最小 fixture | 关闭“只有设计无样例”的风险 | 第 6 轮 | `fixtures/meeting-summary-assistant/` 存在且 ID 链完整 |
| 实现最小静态校验器 | 自动检查 P0/P1 规则 | 第 6 轮 | 能输出 summary 与 checks[]，P0/P1 判定稳定 |
| 固定字段映射表 | 防止 fixture 与核心模型分裂 | 第 6 轮 | checklist/dependencies/method/compatibility 有映射说明 |
| 固定错误码与输出格式 | 支撑验收结果复查 | 第 6 轮 | 每条失败有 rule id/severity/evidence |
| 建立 fixture 冻结策略 | 防止测试基线漂移 | 第 6 轮 | fixtureVersion 与变更记录存在 |
| 完成隐私 P0 扫描 | 防止敏感信息进入样例 | 第 6 轮 | P0 隐私规则有测试并能 fail-fast |

### 8.3 P2：中优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---|---|
| 增加英文触发样例 | 覆盖中文/英文触发模式 | 第 6-7 轮 | 至少 1 个英文 Use when 测试片段 |
| 扩展 standard 矩阵 | 为 tools/references 附属文件做准备 | 第 7 轮 | 有非必需 references/tools 正反例 |
| 扩展 advanced 矩阵 | 为 scripts/assets/templates 做准备 | 第 8 轮以后 | 脚本依赖、执行权限、副作用规则明确 |
| 兼容实测 | 从静态兼容变成环境证据 | 第 7-8 轮 | 当前 Linux 有结果；macOS/Windows pending 或实测 |
| 指标汇总 | 支撑 10 轮可比较 | 每轮 | 记录 ruleCount、pass/warn/fail、P0/P1/P2 数量 |

## 9. 下一轮重点建议

第 6 轮建议聚焦 **“最小 fixture 落地 + 最小静态校验器实现”**，不要扩展完整生成器，也不要同时引入 standard/advanced 样例。

建议第 6 轮具体产出：

1. 创建 `fixtures/meeting-summary-assistant/` 最小样例，包含第 4 轮定义的 8 个文件。
2. 实现或设计一个最小校验入口，读取 fixture 根目录并输出 `summary` 与 `checks[]`。
3. 优先覆盖 P0/P1 规则：entry、frontmatter、权限、隐私、回放伪通过、7 维 key。
4. 写明字段映射和 fixture 冻结策略。
5. 用本轮最小测试用例包验证至少 1 个正例 fixture 和若干反例片段。

如果第 6 轮任务范围仍不允许创建 fixture 或代码，则退而求其次：产出 schema 草案和校验器接口规格。但优先级上，小龙虾建议别再只写设计了——第 6 轮该让最小样例真正落地，纸上谈兵再谈下去就要变成纸上烤虾了。

## 10. 本轮结论

**结论：允许继续第 6 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 第 4 轮的 fixture 与静态校验设计已经能转成清晰测试矩阵。
3. 本轮覆盖了样例类型、复杂度、中文/英文触发、附属文件、工具权限、隐私等级、路径兼容、7 维验证等关键维度。
4. 实现前审查清单已覆盖文件结构、schema、错误码、输出格式、隐私脱敏、fixture 冻结策略和非目标声明。
5. 测试矩阵已能支撑 `docs/acceptance.md` 的 D/P/V/O/C 类验收项，并能为 `docs/acceptance-result.md` 的 PASS_WITH_RISK 风险关闭提供证据。
6. 主要遗留风险是 P1：fixture 尚未真实落地、最小校验器尚未实现、字段映射尚未写入可执行资产。但这些风险已有第 6 轮明确关闭路径。

因此，第 6 轮可以继续，并建议从“实现前审查”进入“最小可执行资产”：先落地 simple fixture，再实现 P0/P1 静态校验。