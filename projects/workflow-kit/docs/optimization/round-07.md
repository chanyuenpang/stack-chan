# SkillForge 优化第 7 轮分析

## 1. 本轮目标

第 6 轮已经把第 5 轮测试矩阵收敛成“一个 simple fixture + 一个最小静态校验器 + 一组 P0/P1 规则 + 稳定输出格式”的最小工程切片。本轮不实现代码、不创建 fixture、不修改核心设计文档，只对第 6 轮方案做 **实现风险预演与可维护性设计**。

本轮目标是提前回答五个问题：

1. 第 6 轮的最小工程切片在真实实现中会遇到哪些复杂度、维护成本和失败模式。
2. 哪些设计可以直接保留，哪些必须进一步加约束，避免实现时滑向完整测试平台。
3. fixture、schema、错误码、输出报告和文档之间如何同步，防止后续漂移。
4. 第一版到底必须做什么、可以不做什么、禁止顺手做什么。
5. 是否允许进入第 8 轮，以及第 8 轮应该聚焦真实落地还是继续补设计。

一句话：第 6 轮说了“锅、虾、火候”；第 7 轮专门检查这口锅会不会漏、虾会不会跑、厨子会不会顺手开满汉全席。

## 2. 对第 6 轮结论的复盘

### 2.1 可以保留的实现设计

| 第 6 轮设计 | 保留判断 | 保留理由 | 保持方式 |
|---|---|---|---|
| 单一 simple fixture：`fixtures/meeting-summary-assistant/` | 保留 | 最小样例低权限、低依赖、适合做第一条冻结基线 | 第 8 轮仍只落地这一条，不扩 standard/advanced |
| 8 个最小文件 | 保留 | 能覆盖 WorkflowSource、SkillSpec、GenerationRun、SkillManifest、ValidationResult、replay 与入口文件 | 文件名和职责冻结，新增文件必须走后续版本 |
| `skill/SKILL.md` 作为 entry | 保留 | 符合样本库规律，也便于 manifest 对账 | entry 只允许相对路径，第一版固定为该值 |
| P0/P1 静态规则优先 | 保留 | 能先关闭隐私、权限、结构、伪回放等阻断风险 | 第一版 `summary.passed` 只看 P0/P1，不把 P2 作为阻断 |
| 错误码沿用规则 ID | 保留 | 便于文档、测试、验收结果引用，避免再造编号体系 | 规则 ID 建集中清单，禁止随意改名 |
| 输出 `summary + checks[] + suggestedValidationPatch` | 保留 | 同时满足机器可读和验收引用 | 第一版只输出，不自动写回 `validation-result.yaml` |
| 区分静态检查与运行时回放 | 保留 | 防止把 expected 当 observed，保护证据可信度 | 报告字段必须明确 `static_checked` / `runtime_replay_pending` |
| 不做生成器、UI、跨模型、跨 OS 实测 | 保留 | 这些会把最小闭环拉大，影响 MVP 节奏 | 第 8 轮仍作为非目标 |

### 2.2 需要进一步约束的设计

| 需要约束点 | 第 6 轮现状 | 风险 | 本轮约束 |
|---|---|---|---|
| 错误码范围 | 列出了较多规则 ID | 实现中容易继续膨胀，最后错误码比代码还多 | 第一版只启用 P0/P1 MVP 子集；P2 只登记，不阻断 |
| fixture 字段形态 | 允许 fixture-only 便利字段 | 与 `docs/data-structure.md` 核心模型漂移 | 必须建立 normalize 层；禁止核心实体直接依赖 fixture-only 字段 |
| schema 策略 | 第 6 轮说完整 schema 可推迟 | 如果无版本策略，后续字段改动难追踪 | schema 从 `fixtureVersion` 与报告版本开始，不急着完整 JSON Schema |
| 反例测试 | 建议若干反例片段 | 反例可能变成目录级 fixture，维护成本上升 | 第一版反例优先作为内联测试片段或最小临时目录，不纳入公开 fixture 冻结基线 |
| 隐私扫描 | 高置信模式 P0 | 误报/漏报会影响落地信心 | P0 仅限高置信；疑似姓名组织默认 warn + 人工 note |
| 文档同步 | 报告可复制到验收结果 | 实现后文档可能落后于代码 | 每次新增/改规则必须同步规则清单、示例输出和 round 文档 |
| 命令入口 | `skillforge validate` 或 `pnpm validate:fixture` | CLI 名称过早固定会影响实现 | 第 8 轮可先用项目脚本，正式 CLI 名称延后冻结 |
| 批量校验 | 暂缓 | 实现者可能顺手做 glob | 第一版只接受单 fixture 根目录，批量作为 P2 后续动作 |

## 3. 优点与保持/扩大方式

### 优点 1：最小切片边界清晰

第 6 轮已经把范围压到一个 simple fixture、一个入口命令、一组静态规则和一份报告，避免从完整生成器开刀。

**保持/扩大方式**：
- 第 8 轮继续只落地 `meeting-summary-assistant`，不新增第二个 fixture。
- 不把 `schemas/`、批量扫描、自动修复、跨平台实测混入第一版。
- 所有新增需求先问：是否关闭 P0/P1？不能关闭就延后。

### 优点 2：P0/P1 风险能 fail-fast

隐私、权限、entry、frontmatter、反例外发、伪回放等都已有明确失败条件。

**保持/扩大方式**：
- `summary.passed=true` 的条件固定为 P0=0 且 P1=0。
- P0 不支持普通豁免；P1 若豁免，必须写关闭条件和人工责任。
- 报告必须一次性列出所有 P0/P1，不只报第一条错误。

### 优点 3：错误码直接使用规则 ID，便于追踪

`privacy.noSecrets`、`frontmatter.description`、`validation.sevenKeys` 这类 ID 可直接映射到测试、文档和验收结果。

**保持/扩大方式**：
- 建立规则注册表，至少包含 `id/dimension/severity/statusPolicy/description`。
- 文档和代码都引用同一套 ID，不另起 `E001/W001`。
- 改名视为破坏性变更，必须记录迁移映射。

### 优点 4：fixture 与核心数据模型已有映射意识

第 6 轮已经识别 `checklist`、`dependencies`、`method` 等字段存在 fixture 层与核心模型差异。

**保持/扩大方式**：
- 实现 normalize 层：fixture 输入 → 核心模型语义 → 报告输出。
- fixture-only 字段必须写入 README 或 validator 文档。
- 输出报告不假装 fixture 字段等同数据库/核心实体字段。

### 优点 5：验证维度与验收文档对齐

结构、触发、边界、依赖、回放、隐私、兼容 7 维可以直接支撑 `docs/acceptance.md` 的 V1-V7。

**保持/扩大方式**：
- `checks[].dimension` 只允许这 7 个 key：`structure/trigger/boundary/dependency/replay/privacy/compatibility`。
- 新规则必须归入一个维度，不能新增临时维度。
- `validation-result.yaml` 未实测项只能 pending 或 documented_not_executed。

### 优点 6：报告格式能服务后续验收证据

`summary + checks[] + suggestedValidationPatch` 可以复制到 `docs/acceptance-result.md`，避免验收只靠自然语言。

**保持/扩大方式**：
- `checks[]` 必须包含 `id/dimension/severity/status/message/evidence`。
- evidence 至少指向 path 或 field，避免“哪里错了”说不清。
- 人类可读摘要不能替代机器结构。

### 优点 7：非目标声明足够明确

第 6 轮明确不做完整生成器、UI、跨模型、跨 OS、真实外部服务、自动写回等。

**保持/扩大方式**：
- 第 8 轮任务描述中继续复制非目标，防止实现者“手痒”。
- 若出现顺手扩展，按 P1 范围风险处理，而不是奖励“多做”。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：错误码膨胀

**级别**：P1  
**表现**：第 6 轮规则清单已经较长，如果实现时继续给每个字段、每个细节、每个文案差异都加错误码，会导致维护成本上升、文档难同步、用户难理解。

**改善办法**：
- 第一版只启用 P0/P1 MVP 子集，P2 先作为 warn 或 backlog。
- 同类失败合并到稳定规则，例如路径类先统一到 `structure.relativePaths`，不要拆成十几个 OS 子码。
- 新增错误码必须满足：能映射验收项、能自动检测、有关闭条件。

**关闭条件**：
- 第一版启用错误码数量受控，建议不超过 25 个。
- 每个错误码都有 owner 文档位置、严重级别和至少一个触发样例。
- 无孤儿错误码：报告、规则注册表、文档三处一致。

### 风险 2：fixture 维护成本上升

**级别**：P1  
**表现**：8 个文件虽然最小，但字段链路多；后续一改 ID、版本、权限或 entry，就可能多文件同步，形成“修一个字段，改半个目录”的维护负担。

**改善办法**：
- 固定 `fixtureVersion`，建立变更记录。
- ID 链路集中说明，避免同一语义在多个文件重复写长文本。
- 反例优先用测试片段，不把每个反例都变成长期维护目录。

**关闭条件**：
- fixture README 有版本、冻结范围、变更流程。
- 校验器能检查 ID 链断裂并给出明确 evidence。
- 第一次落地后，任何 fixture 更新都有对应优化轮次或变更原因。

### 风险 3：规则过拟合

**级别**：P1  
**表现**：规则可能过度贴合会议纪要样例，例如只认“会议纪要/行动项”关键词，导致未来其它 simple skill 误报；或把当前目录结构当作永久架构。

**改善办法**：
- 区分通用规则与 fixture-specific 规则。
- 通用规则检查结构、安全、权限、证据；业务关键词检查只作为当前 fixture 的 trigger profile。
- 在规则元数据中增加 `scope: generic | fixture-profile`。

**关闭条件**：
- 所有规则标注 scope。
- 通用规则不包含会议纪要专属文案。
- 业务触发词不足只影响当前 fixture，不定义为全项目硬规则。

### 风险 4：文档与实现漂移

**级别**：P1  
**表现**：第 6/7 轮文档定义的规则、输出字段、错误码和实现中的实际行为可能不一致，后续验收引用会失真。

**改善办法**：
- 建立“规则清单是唯一来源”的同步机制，文档和测试都从同一清单派生或人工对账。
- 每次改规则都必须更新示例报告和优化文档变更记录。
- CI 或最小脚本检查文档中的规则 ID 是否存在于规则清单。

**关闭条件**：
- 实现后能导出规则列表，并与文档规则表一致。
- `round-08.md` 或后续文档引用真实校验输出，而不是只复述设计。
- 任一已删除/改名规则有迁移说明。

### 风险 5：schema 演进失控

**级别**：P1  
**表现**：如果第一版不写完整 schema，字段会靠代码约定；如果第一版写太完整，又会拖慢落地并固化错误抽象。

**改善办法**：
- 第一版只做轻 schema：版本、必需文件、必需顶层字段、枚举值。
- 完整 JSON Schema 延后，但必须记录字段兼容策略。
- 破坏性字段改动升级 fixture schema 版本。

**关闭条件**：
- 存在 `fixtureVersion` 与 `reportVersion`。
- 新增可选字段不破坏旧 fixture。
- 删除/改名字段必须提供迁移说明或兼容读取。

### 风险 6：隐私扫描误报/漏报

**级别**：P1  
**表现**：高置信正则能抓 token、私有路径、手机号、邮箱，但也可能误伤示例；疑似姓名/组织的自动识别更不稳定。

**改善办法**：
- P0 只覆盖高置信模式：token/key/secret/password/sk-、私有路径、真实联系方式、真实飞书链接。
- 疑似姓名/组织为 P2 warn，要求人工 note，不直接 fail。
- evidence 中 excerpt 必须脱敏，不能二次泄漏。

**关闭条件**：
- 每类 P0 隐私规则有正反样例。
- 报告中的 excerpt 不展示完整密钥或完整联系方式。
- 误报样例能通过人工说明降级为 warn，而非绕过 P0。

### 风险 7：输出格式过早固化

**级别**：P2  
**表现**：报告格式一旦被验收文档引用，后续改字段会变得困难；但不固化又无法复查。

**改善办法**：
- 固化最小字段，保留 `metadata` 扩展位。
- 报告版本号从第一版开始记录。
- 仅保证字段语义稳定，不保证 message 文案完全不变。

**关闭条件**：
- `reportVersion` 存在。
- 必填字段稳定：summary、checks、id、dimension、severity、status、message、evidence。
- 新字段只做兼容扩展。

### 风险 8：最小校验器被顺手做成框架

**级别**：P1  
**表现**：实现者可能顺手加批量扫描、自动修复、watch 模式、HTML 报告、跨 OS 矩阵，导致 MVP 最小闭环延期。

**改善办法**：
- 第一版只支持单 fixture 路径输入和 stdout JSON 输出。
- 自动修复、批量、HTML、跨平台 runner 全部列入禁止顺手做。
- 代码结构可以预留扩展点，但功能不可暴露承诺。

**关闭条件**：
- 第 8 轮产物只包含单 fixture 校验路径。
- README 或命令帮助不宣传未实现能力。
- PR/任务验收以 P0/P1 规则通过为准，不以“功能多”为准。

## 5. 可维护性设计

### 5.1 版本策略

| 对象 | 建议版本字段 | 第一版建议 | 何时升级 | 兼容要求 |
|---|---|---|---|---|
| fixture | `fixtureVersion` | `0.1.0` | 文件结构、必填字段、语义改变 | patch 可修文案；minor 可加可选字段；major 才允许破坏 |
| 校验报告 | `reportVersion` | `0.1.0` | 输出字段语义改变 | 必填字段保持兼容，新增字段可选 |
| 规则集 | `ruleSetVersion` | `0.1.0` | 新增/删除/改名规则或严重级别调整 | 改名必须提供 oldId -> newId 映射 |
| skill spec/manifest | `version` | 跟随核心模型 | 目标、权限、入口、产物结构变化 | 遵循 SemVer，文档记录影响 |
| 优化文档 | `round-XX.md` | 轮次即版本锚点 | 每轮新增分析 | 不回写历史结论，只追加后续修正 |

版本策略的关键是：**fixture 版本管样例形态，report 版本管输出契约，ruleSet 版本管规则语义**。不要用一个版本号包打天下，虾壳和虾肉得分开数。

### 5.2 schema 演进

第一版不追求完整 JSON Schema，但必须有最小 schema 纪律：

1. 必需文件列表固定：README、workflow-source、skill-spec、generation-run、skill-manifest、replay-cases、validation-result、skill/SKILL.md。
2. 必需顶层字段固定：各实体 id、关联 id、version/status/createdAt 类关键字段按最小要求校验。
3. 枚举集中管理：7 维 dimension、severity、status、complexityTier、method。
4. fixture-only 字段明确标注，不直接写入核心模型。
5. 新增字段默认可选；必填字段新增必须升级 minor 或 major，并给迁移说明。

### 5.3 fixture 冻结/更新流程

建议流程：

1. **创建阶段**：第 8 轮落地 `fixtureVersion: 0.1.0`，写明冻结文件、ID 链、未实测项。
2. **冻结阶段**：正例 fixture 一旦能通过 P0/P1，作为 baseline；不得为让测试通过而无记录修改。
3. **更新申请**：任何变更写入 README changelog 或对应优化文档，说明原因、影响规则、是否破坏兼容。
4. **更新校验**：修改后必须重新运行最小静态校验；报告摘要进入后续 round 文档。
5. **反例管理**：反例片段可更新，但公开正例 fixture 不随意吸收反例目录。

关闭漂移的关键动作：fixture 不是随便揉的面团，是验收砝码。砝码天天改，秤就废了。

### 5.4 错误码治理

错误码治理规则：

1. 错误码格式固定为 `<domain>.<camelCaseName>`，如 `privacy.noSecrets`。
2. domain 首选：`structure/frontmatter/trigger/permission/toolBoundary/resourcePlan/manifest/dependencies/privacy/replay/validation`。
3. 每个错误码必须有：dimension、severity、message 模板、evidence 类型、关闭条件。
4. 禁止仅因文案不同新增错误码；同语义失败复用同 ID。
5. 严重级别调整视为规则语义变更，必须记录在 ruleSet changelog。
6. 废弃错误码保留 alias 至少一个 minor 版本，避免历史报告不可读。

### 5.5 文档同步机制

建议同步链路：

```text
规则注册表 / 实现规则
  -> 示例校验报告
  -> docs/optimization/round-XX.md
  -> docs/acceptance-result.md 或后续验收证据
```

具体要求：

- 第 8 轮实现后，文档不再只写“建议输出”，必须引用一次真实命令输出摘要。
- 如果规则 ID、severity、dimension、报告字段变化，必须同时更新优化文档和验收引用。
- `docs/acceptance.md` 是标准，不应频繁改；实现细节沉淀在 optimization 文档和 validator 文档。
- 历史 round 文档不回写覆盖；后续轮次说明“第 N 轮修正第 M 轮假设”。

## 6. 失败模式预演

| # | 失败场景 | 真实可能原因 | 检测方式 | 恢复策略 | 是否阻断发布 |
|---:|---|---|---|---|---|
| 1 | fixture 缺少 `skill/SKILL.md` 或 manifest entry 指向不存在文件 | 手工创建目录时漏文件、entry 拼错 | `structure.entryExists`、`structure.requiredFiles` | 补齐文件或修正 entry；重新校验 | 是，P0/P1 阻断 |
| 2 | `SKILL.md` frontmatter 缺 `description` | 编写者只写正文，忘记触发字段 | `frontmatter.exists`、`frontmatter.description` | 补充承担触发职责的 description | 是，P0 阻断 |
| 3 | fixture 中出现 `/home/...`、`C:\Users\...`、`~/.openclaw` | 从本机路径复制示例 | `structure.relativePaths`、`privacy.noPrivatePath` | 改为相对路径或占位说明 | 是，P0 阻断 |
| 4 | 示例文本含 token、邮箱、手机号或真实飞书链接 | 脱敏不彻底 | `privacy.noSecrets`、`privacy.noRealContact` | 立即脱敏；报告 excerpt 脱敏；补反例测试 | 是，P0 阻断 |
| 5 | permissions 默认允许网络、写文件或外发消息 | 字段缺失被实现解释为允许 | `permission.noNetwork/noFileWrite/noExternalMessage/noDestructiveAction` | 默认改为 false/forbidden；缺失按 fail 处理 | 是，P0 阻断 |
| 6 | 未执行回放却 `passed=true` | 把 expected 当 observed，或模板默认 true | `replay.observedNotForged`、`validation.noPrematurePass` | 将 observed/passed 置 null/pending；真实执行后再更新 | 是，P1 阻断 |
| 7 | 7 维 checklist 缺 privacy 或 compatibility | validation-result 手写漏项 | `validation.sevenKeys` | 补齐维度，未测项写 pending/documented_not_executed | 是，P1 阻断 |
| 8 | 规则把会议纪要关键词写死，未来 simple fixture 大量误报 | 通用规则与样例 profile 混淆 | 规则元数据 scope 审查、非会议样例试跑 | 拆分 generic 与 fixture-profile；降低为样例专属规则 | 否，阻断扩展，不阻断当前 fixture |
| 9 | 文档列出的错误码与实现输出不一致 | 实现改名或漏实现，文档未同步 | 规则清单对账、示例报告检查 | 增加 alias 或更新文档；记录迁移 | 是，若影响验收证据 |
| 10 | YAML 解析失败但报告只有崩溃堆栈 | loader 未做结构化错误处理 | 构造坏 YAML 片段测试 | 捕获解析错误，输出 `structure.parseYaml` 或同类结构化 check | 是，若无法生成报告 |
| 11 | 校验器自动写回 `validation-result.yaml`，覆盖人工证据 | 实现了自动修复并默认开启 | 命令行为审查、git diff 检查 | 默认只 stdout；写回需显式 flag 且本轮禁止 | 是，P1 范围阻断 |
| 12 | 报告 evidence 泄漏完整 secret | 隐私扫描直接截取命中文本 | 隐私反例测试检查 excerpt | evidence 只显示脱敏片段，如 `sk-***` | 是，P0 阻断 |
| 13 | P2 warning 被误算进 fail，导致正例无法通过 | summary 统计策略混乱 | 用 P2-only fixture 试跑 | 固定 P0/P1 阻断，P2 只 warn | 否，除非影响 P0/P1 判定 |
| 14 | 单 fixture 校验尚未稳定就加入批量 glob | 顺手扩展功能 | 命令帮助、测试范围审查 | 移除或隐藏批量入口，退回单目录 | 否，但阻断第 8 轮验收范围 |

## 7. 最小实现边界

### 7.1 第一版必须做

1. 创建并校验一个 simple fixture：`fixtures/meeting-summary-assistant/`。
2. 包含 8 个最小文件，且 ID 链路可追踪。
3. 固定 entry 为 `skill/SKILL.md`，所有路径相对 fixture 根。
4. 能读取 YAML、Markdown frontmatter 和 Markdown body。
5. 实现 P0/P1 静态规则核心子集：entry、frontmatter、权限、隐私、回放伪通过、7 维 checklist、simple 无附属依赖。
6. 输出 JSON 报告：`summary + checks[]`，可选 `suggestedValidationPatch`。
7. 任一 P0/P1 fail 时 `summary.passed=false`。
8. 报告 evidence 能定位 path/field，且隐私命中内容脱敏。
9. 写明 `fixtureVersion/reportVersion/ruleSetVersion` 或等价版本信息。
10. 在第 8 轮文档中引用一次真实校验输出摘要。

### 7.2 第一版可以不做

1. 完整 JSON Schema。
2. 批量扫描多个 fixture。
3. 自动修复或写回 `validation-result.yaml`。
4. 文本/HTML 漂亮报告。
5. 跨 OS 实测。
6. 跨模型触发回放。
7. standard/advanced fixture。
8. 英文触发样例的完整覆盖。
9. UI、服务端、数据库。
10. 发布、安装、市场分发流程。

### 7.3 第一版禁止顺手做

1. 禁止接入飞书、日历、邮件、网络 API 等真实外部服务。
2. 禁止引入真实会议内容、真实联系人、真实链接、真实本机路径。
3. 禁止默认执行文件写入、自动修复、删除或格式化 fixture。
4. 禁止把未执行回放写成通过。
5. 禁止把 P0 隐私或权限问题做成可忽略 warning。
6. 禁止新增多个 fixture 来展示“能力丰富”。
7. 禁止把校验器做成完整生成器入口。
8. 禁止为了通过测试而无记录修改冻结 fixture。

## 8. 优化动作

### 8.1 P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只创建 `docs/optimization/round-07.md` 分析文档，不创建真实 fixture、不实现校验器、不引入真实数据、不执行外部服务、不改变权限默认值。

但第 8 轮真实落地时，以下任一情况必须立即视为 P0：

1. fixture 出现 token、密钥、真实手机号/邮箱、真实飞书链接、私有绝对路径。
2. 外发消息、网络访问、写文件、破坏性操作被默认允许。
3. manifest entry 不存在但报告通过。
4. 未执行回放却被写成 observed/pass。
5. P0 fail 时 `summary.passed=true`。
6. 报告 evidence 泄漏完整敏感值。

### 8.2 P1：高优先级动作

| 动作 | 目标 | 建议落点 | 关闭条件 |
|---|---|---|---|
| 建立规则注册表 | 控制错误码膨胀 | 第 8 轮实现前或实现中 | 每个规则有 id/dimension/severity/evidence/关闭条件 |
| 落地 fixture 版本与 changelog | 降低 fixture 维护成本 | `fixtures/meeting-summary-assistant/README.md` | 有 `fixtureVersion`、冻结范围、更新流程 |
| 实现 normalize 层 | 防止 fixture 与核心模型分裂 | validator loader/normalize | checklist/dependencies/method 映射清楚 |
| 固定报告最小契约 | 支撑验收引用 | validator report | 有 `reportVersion`、summary、checks[] 必填字段 |
| 区分 generic 与 fixture-profile 规则 | 防止规则过拟合 | 规则元数据 | 业务关键词规则不污染通用规则 |
| 建立文档同步检查 | 防止文档与实现漂移 | 后续脚本或人工清单 | 文档规则 ID 与实现规则 ID 可对账 |
| 隐私 evidence 脱敏 | 防止二次泄漏 | privacy rule/report | secret/contact 只显示掩码片段 |
| 控制第一版命令范围 | 防止滑向框架 | CLI/脚本入口 | 只支持单 fixture 输入和 JSON stdout |

### 8.3 P2：中优先级动作

| 动作 | 目标 | 建议轮次 | 关闭条件 |
|---|---|---:|---|
| 完整 JSON Schema 草案 | 增强结构约束 | 第 9 轮后 | 最小实现稳定后再抽象 schema |
| 批量 fixture 校验 | 支撑多样例 | 第 9-10 轮或后续 | 单 fixture 正例和反例稳定 |
| 文本/HTML 报告 | 提升可读性 | 后续产品化 | JSON 字段不变，只增加展示层 |
| 跨 OS 兼容实测 | 关闭兼容风险 | 第 9 轮后 | Linux 有真实结果，macOS/Windows pending 或实测 |
| 规则覆盖率指标 | 衡量规则质量 | 后续 | 反例命中率和误报样例可统计 |
| standard fixture 预研 | 扩展 tools/references | simple 稳定后 | 附属文件规则不再靠猜 |

## 9. 下一轮重点建议

第 8 轮建议聚焦 **“真实最小 fixture 与最小静态校验器落地验证”**，而不是继续扩写设计。

建议第 8 轮只做以下事情：

1. 创建 `fixtures/meeting-summary-assistant/` 的 8 个最小文件。
2. 实现最小 loader：读取 YAML、frontmatter、body，并能报告解析错误。
3. 实现 P0 核心规则：entry、frontmatter、权限、隐私、私有路径、反例外发。
4. 实现 P1 核心规则：required files、simple 无附属依赖、replay 未伪通过、7 维 checklist。
5. 输出 JSON 报告，并把一次真实运行摘要写入 `docs/optimization/round-08.md`。
6. 使用少量反例片段验证错误码稳定，不要建立大型反例 fixture 库。

第 8 轮不建议做：完整 schema、批量扫描、自动修复、UI、跨平台/跨模型实测、standard/advanced 样例。先让最小闭环真的跑起来。小龙虾友情提醒：能跑的虾，比画得漂亮的虾更有说服力。

## 10. 本轮结论

**结论：允许继续第 8 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 第 6 轮最小工程切片方向正确，可继续保留。
3. 本轮已补充实现风险预演，覆盖错误码膨胀、fixture 维护成本、规则过拟合、文档与实现漂移、schema 演进、隐私误报/漏报、输出契约和范围膨胀等关键风险。
4. 已给出可维护性设计：版本策略、schema 演进、fixture 冻结/更新流程、错误码治理、文档同步机制。
5. 已列出 14 个真实可能失败场景，并明确检测方式、恢复策略和是否阻断发布。
6. 已明确第一版必须做、可以不做、禁止顺手做的边界。
7. P0 当前无阻断；P1/P2 动作均有关闭条件。

因此，第 8 轮应从分析进入真实最小实现：落地 fixture、实现最小静态校验器、产出真实校验报告。再继续纸面优化就有点像给虾画跑鞋了，能看但不顶饿。
