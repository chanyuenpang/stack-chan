# SkillForge 优化第 9 轮分析

## 1. 本轮目标

第 8 轮已经把“真实最小 fixture 与最小静态校验器”的验证路线写清楚，并允许继续第 9 轮。但本轮任务标题仍是“分析文档”，因此本轮**不创建 fixture、不实现校验器、不更新验收结果、不修改任何核心设计文档**，只产出 `docs/optimization/round-09.md`。

本轮目标聚焦 **“真实落地实施方案与验收前检查”**：把第 8 轮的验证计划压缩成下一步可以直接执行、可以分派、可以验收、可以回滚的工程任务包。

具体目标：

1. 复盘第 8 轮结论，区分可直接实施的路线与仍需确认的前置条件。
2. 将未来真实落地拆成原子任务包：fixture、schema/规则清单、loader、校验器、测试矩阵、结果更新。
3. 为第 10 轮或最终实现前建立验收前检查清单，避免“写了代码但证据不够”。
4. 映射 `PASS_WITH_RISK` 与第 1-8 轮累计风险，明确已关闭、待关闭、不在 MVP 范围。
5. 判断第 10 轮应该继续写最终收敛文档，还是进入真实实现。

一句话：第 8 轮说“虾怎么煮”；第 9 轮把采购单、火候表、验熟标准和谁洗锅都列出来，但本轮仍不下锅。

## 2. 对第 8 轮结论的复盘

### 2.1 可直接进入实施的验证路线

| 第 8 轮结论 | 本轮判断 | 直接实施方式 |
|---|---|---|
| 只落地 `fixtures/meeting-summary-assistant/` 一个 simple fixture | 可直接实施 | 下一步只创建该目录，不新增第二个公开 fixture |
| 8 个最小文件形成闭环 | 可直接实施 | `README.md`、5 个实体 YAML、`replay-cases.yaml`、`validation-result.yaml`、`skill/SKILL.md` |
| 2 正例 + 1 反例作为最小回放形态 | 可直接实施 | 写入 `replay-cases.yaml`，但 `observed/passed` 保持 null/pending |
| P0/P1 fail-fast | 可直接实施 | `summary.passed=true` 仅在 P0/P1 fail 为 0 时允许 |
| 错误码直接使用规则 ID | 可直接实施 | 报告与规则清单统一使用 `privacy.noSecrets` 等 ID |
| 静态检查与运行时回放分离 | 可直接实施 | 未回放时只写 `runtime_replay_pending`，不得写 pass |
| 输出 `summary + checks[] + suggestedValidationPatch` | 可直接实施 | 第一版输出 stdout JSON，不自动写回 fixture |
| 单 fixture 命令输入 | 可直接实施 | `pnpm validate:fixture fixtures/meeting-summary-assistant --format json` 或等价脚本 |
| evidence 脱敏 | 可直接实施 | 隐私命中只展示 `sk-***`、`138****0000` 等掩码 |
| normalize 层覆盖三类已知差异 | 可直接实施 | 处理 `checklist`、`dependencies`、`method` 的 fixture/core 差异 |

### 2.2 仍需前置确认的事项

| 前置确认 | 为什么不能跳过 | 确认方式 | 未确认时处理 |
|---|---|---|---|
| 项目脚本入口名称 | 第 8 轮同时给出 `pnpm validate:fixture` 与 `skillforge validate` 两种候选 | 实现前检查 `package.json` 与 CLI 现状 | 未冻结前只写项目脚本，不宣传正式 CLI |
| fixture YAML 字段最小形态 | 核心模型字段较多，手写 fixture 容易过度填充 | 对照 `docs/data-structure.md` 选最小必填字段 | 只补验证必需字段，其他写入 README 说明为非目标 |
| 规则清单存放位置 | 文档、代码、测试都要引用同一套 ID | 实现前决定放在代码元数据、YAML 或 Markdown 表 | 未确定前不得在多处复制不一致规则表 |
| 反例测试承载方式 | 第 8 轮建议临时副本/片段，不建议公开反例目录 | 先确认测试框架或脚本形态 | 不创建长期反例 fixture 目录 |
| `acceptance-result.md` 更新时机 | 本轮无真实输出，不能更新验收结果 | 等真实校验命令完成后再更新 | 本轮只给更新条件，不写验收结论 |
| 样本统计不一致是否顺手修 | acceptance-result 已记录 P2 风险，但本轮范围只改 round-09 | 单独任务或后续文档轮处理 | 本轮只列关闭条件，不修改样本库 |
| P2 warn 是否计入 passed | 若实现误算，会导致正例无法通过 | 在报告契约中固定 P0/P1 阻断、P2 不阻断 | 未实现前写入验收前检查 |

本轮复盘结论：第 8 轮的大方向可直接实施，但要先把“入口、字段、规则来源、反例承载、验收更新时机”冻结。否则一边写 fixture 一边写校验器，容易变成虾和锅互相修改，最后谁熟了都说不清。

## 3. 优点与保持/扩大方式

### 优点 1：实施边界已经足够小

当前落地范围被压缩为一个 simple fixture、一个静态校验入口、一组 P0/P1 规则和一份 JSON 报告。

**保持/扩大方式**：
- 下一步只围绕 `fixtures/meeting-summary-assistant/` 实施。
- 不新增 standard/advanced、批量扫描、自动修复、UI、真实回放器。
- 每个新增文件或规则必须说明关闭哪个 P0/P1 风险。

### 优点 2：规则 ID 与 7 维验收已经对齐

`structure`、`trigger`、`boundary`、`dependency`、`replay`、`privacy`、`compatibility` 七维可直接映射 `docs/acceptance.md` 的 V1-V7。

**保持/扩大方式**：
- `checks[].dimension` 固定使用七维 key。
- 错误码直接使用规则 ID，不另造 `E001`。
- 后续 `acceptance-result.md` 只引用真实报告中存在的 ID。

### 优点 3：高风险项可以静态 fail-fast

隐私泄漏、私有路径、外发消息、写文件、网络访问、破坏性操作、伪造回放通过，都不依赖模型即可检查。

**保持/扩大方式**：
- P0 规则先实现隐私、权限、entry、frontmatter、反例外发边界。
- P0 fail 不允许被配置降级。
- 隐私 evidence 必须脱敏，避免报告成为二次泄漏源。

### 优点 4：回放诚实性边界清楚

第 8 轮明确 expected 不等于 observed，未执行模型回放时不得写 `passed=true`。

**保持/扩大方式**：
- `replay-cases.yaml` 初始 `observed: null`、`passed: null`。
- `validation-result.yaml` 中 replay/compatibility 未实测项使用 `pending` 或 `documented_not_executed`。
- 静态报告只能证明 replay 字段合法，不能声称模型行为通过。

### 优点 5：fixture 与核心模型差异已提前暴露

`ValidationResult.checklist` 对象/数组差异、`dependencies` 空数组/对象差异、`method: manual_plus_static_check` 与核心 `hybrid` 的差异已被识别。

**保持/扩大方式**：
- loader 必须先 normalize，再执行规则。
- README 中列出 fixture-only 字段和核心模型映射。
- 报告输出使用规范化语义，不把便利字段当核心模型。

### 优点 6：可复现证据形态明确

第 8 轮已经要求 `fixtureVersion/reportVersion/ruleSetVersion`、命令、工作目录、summary、checks、evidence。

**保持/扩大方式**：
- 同一输入、同一规则集重复运行，P0/P1 结果必须一致。
- checks 按 ID 排序，降低快照噪音。
- 后续文档引用真实输出摘要，而不是只写自然语言结论。

### 优点 7：本轮继续只做分析，避免半吊子实现

任务范围明确禁止实际落地，能把工程任务拆清楚，避免写出一半 fixture、一半校验器、一堆未验证承诺。

**保持/扩大方式**：
- 本轮只创建 `round-09.md`。
- 把所有真实落地内容写为未来任务包和验收前检查。
- 第 10 轮必须基于本轮任务包做最终决策，不再无限扩写计划。

## 4. 缺点/风险、改善办法与关闭条件

### 风险 1：真实落地范围膨胀

**级别**：P1  
**表现**：实施者可能顺手增加批量校验、自动修复、HTML 报告、跨平台矩阵、第二个 fixture、真实模型回放，导致 MVP 延期。

**改善办法**：
- 第一版只支持单 fixture 根目录输入和 JSON stdout。
- 不实现 `--fix`、`--write`、watch、glob、HTML、UI、生成器。
- P2 扩展只写 backlog，不进入第一版完成标准。

**关闭条件**：
- 实际变更中只出现一个公开 fixture 和一个最小校验入口。
- 命令帮助或 README 不宣传未实现能力。
- 验收报告明确本次只关闭静态结构/安全/证据状态风险。

### 风险 2：fixture 与校验器并行改动冲突

**级别**：P1  
**表现**：fixture 为了通过规则临时改字段，校验器又为了适配 fixture 改规则，最终失去独立验收价值。

**改善办法**：
- 先冻结 fixture 最小字段草案，再实现 loader，再实现规则。
- 每次 fixture 调整必须记录原因、影响规则、是否改变预期结果。
- 校验器规则只依据规则清单，不依据临时文案。

**关闭条件**：
- fixture README 有 `fixtureVersion`、冻结范围、changelog。
- 校验器能指出 fixture 失败位置，而不是通过修改 fixture 掩盖规则缺陷。
- 至少一个临时反例能稳定触发预期规则。

### 风险 3：验收结果被主观解释

**级别**：P1  
**表现**：静态检查通过被写成“模型回放通过”或“MVP 完全无风险”，或者只用自然语言说“看起来没问题”。

**改善办法**：
- `acceptance-result.md` 只能基于真实命令、summary、checks、evidence 更新。
- replay/compatibility 未实测必须保持 pending。
- 每个风险关闭都要有关闭证据，不接受“人工觉得可以”。

**关闭条件**：
- 更新验收结果时包含命令、工作目录、版本、summary 和失败/通过 checks 摘要。
- 未执行项不出现 pass。
- `PASS_WITH_RISK` 风险表逐项标注关闭状态。

### 风险 4：样本统计不一致遗留

**级别**：P2  
**表现**：`docs/acceptance-result.md` 已记录样本库表头“37 个”与编号到 46 的统计口径不一致；若继续遗留，会削弱文档严谨性。

**改善办法**：
- 不在本轮修改 `sample-skill-library.md`，避免越界。
- 将统计修正列入后续 P2 文档动作，单独检查来源分布、去重口径、表头编号。
- 在风险关闭计划中保持“待关闭”，不得误判为已关闭。

**关闭条件**：
- 后续任务修正样本统计表头、编号和去重说明。
- `acceptance-result.md` 风险项更新为已关闭或降级。
- 相关文档不再出现互相矛盾的样本数量。

### 风险 5：最小 schema 不清导致实现随意

**级别**：P1  
**表现**：如果不先定义必需文件、顶层字段、枚举和版本字段，校验器可能只检查存在性，无法支撑复现。

**改善办法**：
- 第一版不写完整 JSON Schema，但必须有轻 schema：必需文件、必需字段、枚举、版本。
- 规则元数据至少包含 `id/dimension/severity/scope/description/关闭条件`。
- 新增必填字段必须升级 fixtureVersion 或写迁移说明。

**关闭条件**：
- 8 个必需文件和关键字段有清单。
- 报告包含 `fixtureVersion/reportVersion/ruleSetVersion`。
- 解析失败也能输出结构化错误。

### 风险 6：隐私扫描误报或漏报

**级别**：P1  
**表现**：过严会误伤公开示例，过松会放过 token、手机号、邮箱、真实飞书链接、私有路径。

**改善办法**：
- P0 只覆盖高置信模式：token/key/secret/password/sk-、私有绝对路径、邮箱、手机号、真实飞书链接。
- 疑似姓名/组织只作为 P2 warn 或人工 note。
- evidence 必须脱敏，不输出完整命中值。

**关闭条件**：
- `privacy.noSecrets`、`privacy.noPrivatePath`、`privacy.noRealContact` 都有反例验证。
- 报告 excerpt 不泄漏完整 secret/contact。
- 正例 fixture 不因虚构公开示例误报 P0。

### 风险 7：规则过拟合会议纪要场景

**级别**：P1  
**表现**：通用规则若写死“会议纪要/行动项”等关键词，未来 simple skill 会大量误报。

**改善办法**：
- 规则分为 `generic` 与 `fixture-profile`。
- 通用规则检查结构、安全、证据诚实性；业务触发词只用于当前 fixture profile。
- P0 不绑定业务关键词。

**关闭条件**：
- 每条规则标注 scope。
- 通用规则不包含会议专属文案。
- 业务关键词不足最多触发 P1/P2 或人工审查，不触发 P0。

### 风险 8：报告契约漂移

**级别**：P1  
**表现**：实现输出字段与文档约定不一致，后续验收无法引用，或 message 文案变化导致快照噪音。

**改善办法**：
- 固定最小报告字段：`summary`、`checks[]`、`id/dimension/severity/status/message/evidence`。
- `checks[]` 按 ID 排序。
- 只保证 ID/状态/严重级别/evidence 稳定，message 可轻微变化。

**关闭条件**：
- 示例报告与真实输出字段一致。
- 文档引用的每个规则 ID 都能在规则清单找到。
- 同一输入重复运行 summary 和 checks 状态一致。

## 5. 实施任务包

以下任务包供第 10 轮或真实实现任务直接执行。本轮不实施。

### T0：实施前冻结范围

| 项 | 内容 |
|---|---|
| 输入 | 第 8/9 轮文档、`docs/data-structure.md`、`docs/workflow.md`、`docs/acceptance.md`、当前仓库结构 |
| 输出 | 一页实施范围说明：只做单 fixture、单命令、P0/P1 静态规则、JSON stdout |
| 完成标准 | 非目标明确列出；无批量、自动修复、UI、真实回放、跨平台实测承诺 |
| 依赖关系 | 无；所有后续任务依赖 T0 |

### T1：fixture 创建

| 项 | 内容 |
|---|---|
| 输入 | 第 8 轮 Step 1 文件结构、核心数据模型最小字段、公开脱敏会议样例 |
| 输出 | `fixtures/meeting-summary-assistant/` 及 8 个最小文件 |
| 完成标准 | 文件齐全；ID 链完整；entry 为 `skill/SKILL.md`；权限全保守；无真实联系人/路径/token；`fixtureVersion: 0.1.0` |
| 依赖关系 | 依赖 T0；被 T2/T3/T5 使用 |

### T2：轻 schema 与规则清单定义

| 项 | 内容 |
|---|---|
| 输入 | 第 6-8 轮规则表、7 维验收标准、T1 fixture 字段草案 |
| 输出 | 最小规则清单或规则元数据，含 `id/dimension/severity/scope/description/evidence/关闭条件` |
| 完成标准 | P0/P1 规则不超过 MVP 范围；P2 标记为 warn/backlog；无孤儿 ID |
| 依赖关系 | 依赖 T0；建议与 T1 串行对齐，不与 T4 盲并行 |

### T3：loader 与 normalize 实现

| 项 | 内容 |
|---|---|
| 输入 | T1 fixture、T2 轻 schema、核心模型字段差异说明 |
| 输出 | 能读取 YAML、Markdown frontmatter、body，并输出规范化对象的 loader |
| 完成标准 | 文件缺失/YAML/frontmatter 解析失败均能结构化报告；`checklist/dependencies/method` 映射清楚 |
| 依赖关系 | 依赖 T1/T2；T4 依赖 T3 |

### T4：P0/P1 静态校验器实现

| 项 | 内容 |
|---|---|
| 输入 | T2 规则清单、T3 normalize 输出、P0/P1 规则优先级 |
| 输出 | 最小校验器规则集合与 JSON 报告生成 |
| 完成标准 | P0 覆盖 entry/frontmatter/权限/隐私/私有路径/反例外发；P1 覆盖 required files/simple 依赖/replay 伪通过/7 维 checklist；P0/P1 fail 时 `summary.passed=false` |
| 依赖关系 | 依赖 T2/T3；T5/T6 依赖 T4 |

### T5：测试矩阵执行

| 项 | 内容 |
|---|---|
| 输入 | T1 正例 fixture、T4 校验器、临时反例片段 |
| 输出 | 正例运行结果与反例命中结果 |
| 完成标准 | 正例 P0/P1 通过；缺 description、注入 secret、私有路径、伪回放、缺 checklist 等反例能命中预期规则 |
| 依赖关系 | 依赖 T1/T4；T6 依赖 T5 |

### T6：报告快照与证据固化

| 项 | 内容 |
|---|---|
| 输入 | T5 命令输出、工作目录、版本信息、git diff 摘要 |
| 输出 | 可复制到优化文档/验收结果的报告摘要 |
| 完成标准 | 包含命令、fixtureVersion/reportVersion/ruleSetVersion、summary、失败/通过 checks 摘要、evidence 脱敏说明 |
| 依赖关系 | 依赖 T5；T7 依赖 T6 |

### T7：`acceptance-result.md` 更新

| 项 | 内容 |
|---|---|
| 输入 | T6 真实报告摘要、`docs/acceptance-result.md` 当前 PASS_WITH_RISK 风险表 |
| 输出 | 更新后的验收结果风险状态与证据 |
| 完成标准 | 只关闭有真实证据的风险；replay/compatibility 未实测保持 pending；不把静态通过写成运行时通过 |
| 依赖关系 | 依赖 T6；本轮不执行 |

### T8：第 10 轮或最终收敛文档

| 项 | 内容 |
|---|---|
| 输入 | 第 1-9 轮文档、T0-T7 实施结果或未实施原因 |
| 输出 | `round-10.md` 或 `final-analysis.md` 的决策依据 |
| 完成标准 | 明确是进入实现、完成第 10 轮最终收敛，还是先补阻断项；风险状态完整 |
| 依赖关系 | 可在真实实现前作为最终计划收敛；若已实现，则引用 T6/T7 结果 |

## 6. 验收前检查清单

在第 10 轮或最终实现前，必须确认以下事项：

### 6.1 文件检查

- `docs/optimization/round-06.md`、`round-07.md`、`round-08.md`、`round-09.md` 均存在且结论连续。
- 未来实现时仅新增 `fixtures/meeting-summary-assistant/` 和校验器相关最小文件；不得无说明修改核心文档。
- fixture 必需 8 个文件齐全：
  - `README.md`
  - `workflow-source.yaml`
  - `skill-spec.yaml`
  - `generation-run.yaml`
  - `skill-manifest.yaml`
  - `replay-cases.yaml`
  - `validation-result.yaml`
  - `skill/SKILL.md`
- `skill-manifest.yaml.entry` 指向 `skill/SKILL.md`，且文件真实存在。
- 所有 fixture 路径为相对路径，不含 `/home/`、`C:\Users`、`~/.openclaw`、`.ssh`、`.env`。

### 6.2 命令检查

推荐命令需二选一并固定：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
pnpm validate:fixture fixtures/meeting-summary-assistant --format json
```

或：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
skillforge validate fixtures/meeting-summary-assistant --format json
```

检查项：

- 命令从项目根目录运行。
- 参数只接受单 fixture 目录。
- 默认只读，不写回 `validation-result.yaml`。
- 无网络调用、无外部消息、无真实模型回放副作用。
- 失败时仍输出结构化报告，不只抛堆栈。

### 6.3 结果检查

- 报告包含 `fixtureVersion/reportVersion/ruleSetVersion`。
- `summary.passed=true` 仅当 P0/P1 fail 为 0。
- `checks[]` 包含 `id/dimension/severity/status/message/evidence`。
- `checks[]` 按 `id` 排序。
- P2 warn 不阻断 passed。
- 隐私 evidence 脱敏。
- 未执行回放时 replay 只允许 pending，不允许 pass。
- 未跨平台实测时 compatibility 只允许 pending 或 documented_not_executed。

### 6.4 风险关闭证据检查

- “无真实 fixture/校验器”风险：必须有 fixture 目录、命令输出和 summary。
- “验收证据不足”风险：必须有 checks/evidence 和版本信息。
- “隐私权限 P0”风险：必须有 P0 规则通过摘要和反例命中摘要。
- “文档实现漂移”风险：必须能从规则清单找到报告中每个 ID。
- “样本统计不一致”风险：若未修样本库，必须继续保留为待关闭。

## 7. 风险关闭计划

### 7.1 `PASS_WITH_RISK` 风险映射

| 风险 | 来源 | 当前状态 | 关闭计划 | 关闭证据 |
|---|---|---|---|---|
| 10 轮优化尚未实际执行 | `acceptance-result.md` | 待关闭 | 完成 round-09、round-10 和 final analysis；或记录跳过原因 | round-10/final 文档存在，轮次无缺口 |
| 样本库局部数量标注不一致 | `acceptance-result.md` | 待关闭 | 单独修正 `sample-skill-library.md` 数量、编号、去重口径 | 文档统计一致，验收结果更新风险状态 |
| 跨平台/模型兼容尚未实测 | `acceptance-result.md` | 待关闭；不阻断静态 MVP | 第一版只记录 pending；后续跨 OS/模型实测再关闭 | compatibility 实测矩阵或明确 pending 原因 |
| 样本来源偏 OpenClaw 当前环境 | `acceptance-result.md` | 待关闭；不阻断单 fixture | 后续增加非 OpenClaw/非会议 simple fixture 或来源降权策略 | 第二个 fixture 或样本权重检查证据 |

### 7.2 第 1-8 轮累计风险映射

| 累计风险 | 状态 | 本轮判断 | 后续动作 |
|---|---|---|---|
| 只有设计、无真实样例 | 待关闭 | 本轮仍未实现，不能关闭 | T1/T5/T6 后关闭 |
| 无最小静态校验器 | 待关闭 | 本轮只拆任务，不能关闭 | T3/T4/T5 后关闭 |
| 验收证据不足 | 待关闭 | 报告契约已清楚，但无真实输出 | T6/T7 后关闭 |
| 隐私泄漏风险 | 待关闭 | P0 规则方案清楚，未实测 | T4/T5 反例通过后关闭 |
| 权限边界默认开放 | 待关闭 | fixture/规则都要求保守默认，未实测 | T1/T4 正例通过后关闭 |
| 回放伪通过 | 待关闭 | 规则和字段策略清楚，未实测 | `replay.observedNotForged` 反例命中后关闭 |
| fixture 字段与核心模型分裂 | 待关闭 | normalize 任务已拆出，未实现 | T3 + README 映射后关闭 |
| 错误码/文档漂移 | 待关闭 | 需要规则清单和真实输出对账 | T2/T6/T7 后关闭 |
| 输出格式不稳定 | 待关闭 | 报告契约明确，未运行 | 重复运行快照一致后关闭 |
| 真实落地范围膨胀 | 待关闭 | 本轮已设边界，实施中仍需检查 | T0 和验收 diff 检查后关闭 |
| 规则过拟合会议纪要 | 待关闭 | 可通过 scope 标注缓解 | T2 scope 完成，后续第二 fixture 再彻底关闭 |
| 完整生成器/UI/发布能力未实现 | 不在本 MVP 范围 | 不应作为本轮阻断 | 保持非目标 |
| 跨模型真实行为验证 | 不在静态校验器第一版范围 | 不关闭，但保持 pending | 后续模型回放器任务处理 |
| 自动修复/写回能力缺失 | 不在 MVP 第一版范围 | 不应实现 | 若后续需要，单独设计确认策略 |

## 8. 决策建议

**建议：第 10 轮应做最终收敛文档，而不是直接进入真实实现。**

理由：

1. MVP 机制要求 10 轮优化记录完整；当前已到第 9 轮，再缺第 10 轮会让优化链路不完整。
2. 本轮仍是分析文档，尚未真实写 fixture/校验器；如果第 10 轮突然实现，轮次职责会混乱。
3. 第 10 轮最有价值的动作是把第 1-9 轮的结论合并成最终执行指令、阻断项清单和 Go/No-Go 决策。
4. 真实实现应作为第 10 轮之后的独立工程任务执行，才能清楚验收 diff、命令输出和风险关闭证据。
5. 如果项目节奏要求“下一步必须写代码”，也应先用第 10 轮文档确认 T0-T8 任务包与验收口径，再开实现任务。

替代方案：若主计划明确第 10 轮必须实现，则应至少先完成 T0 范围冻结，并把 `round-10.md` 写成“实现前验收基线 + 真实运行摘要”。但这会压缩最终收敛文档价值，不是首选。

## 9. 优化动作

### 9.1 P0：阻断项

当前 **无 P0 阻断项**。

判断依据：本轮只创建 `docs/optimization/round-09.md`，不创建 fixture、不写代码、不运行外部服务、不修改权限默认值、不更新验收结果，因此不会引入隐私泄漏、外发消息、写文件、破坏性操作等阻断风险。

进入真实实现后，以下任一情况立即升级为 P0：

1. fixture 出现 token、key、secret、真实手机号/邮箱、真实飞书链接、私有绝对路径。
2. 网络、写文件、外发消息、破坏性操作默认为允许。
3. manifest entry 不存在但 `summary.passed=true`。
4. 未执行回放却写 `observed` 或 `passed=true`。
5. P0 fail 时 `summary.passed=true`。
6. 隐私 evidence 泄漏完整敏感值。
7. 校验器默认写回或修改 fixture。

### 9.2 P1：高优先级动作

| 动作 | 目标 | 完成标准 |
|---|---|---|
| 第 10 轮最终收敛文档 | 完整 10 轮优化链路，形成 Go/No-Go | `round-10.md` 明确是否进入实现、阻断项、任务包、验收证据要求 |
| 冻结真实实现范围 | 防止范围膨胀 | T0 完成，非目标写清楚 |
| 创建最小 fixture | 关闭无真实样例风险 | T1 完成，8 个文件、ID 链、权限、隐私通过 |
| 定义规则清单 | 防止错误码漂移 | T2 完成，每个 ID 有维度/严重级别/scope/关闭条件 |
| 实现 loader/normalize | 防止字段分裂 | T3 完成，解析错误结构化，三类差异映射清楚 |
| 实现 P0/P1 校验 | 关闭结构、安全、证据状态风险 | T4/T5 完成，正例通过、反例命中 |
| 固化报告证据 | 支撑验收更新 | T6 完成，summary/checks/evidence 可复查 |
| 谨慎更新验收结果 | 防止主观解释 | T7 完成，只关闭有真实证据的风险 |

### 9.3 P2：中优先级动作

| 动作 | 目标 | 建议时机 | 关闭条件 |
|---|---|---:|---|
| 修正样本统计不一致 | 提升文档严谨性 | 第 10 轮后或单独文档任务 | 样本数量、编号、去重口径一致 |
| 增加第二个 simple fixture | 验证规则不过拟合会议纪要 | 最小校验稳定后 | 非会议 simple 正例通过通用规则 |
| 完整 JSON Schema 草案 | 抽象轻 schema | 报告契约稳定后 | schema 能表达最小 fixture 和报告字段 |
| 文档/规则 ID 自动对账 | 降低漂移 | 真实规则清单稳定后 | 脚本能发现孤儿规则 ID |
| 跨平台静态运行记录 | 关闭兼容实测风险 | Linux 跑通后 | macOS/Windows 有实测或明确 pending |
| 模型回放执行器 | 从静态进入行为验证 | MVP 静态链路后 | observed/passed 来自真实回放 |
| 自动修复/写回策略 | 提高效率但有风险 | 后续产品化 | 必须显式 flag 和人工确认，不默认启用 |

## 10. 下一轮重点建议

第 10 轮建议聚焦 **“最终收敛与实现前 Go/No-Go 决策”**，不要继续泛化设计，也不要在没有收敛文档的情况下直接写大块代码。

第 10 轮应完成：

1. 汇总第 1-9 轮所有结论，确认优化轮次完整。
2. 将本轮 T0-T8 任务包转成最终执行顺序和验收门槛。
3. 列出真实实现前必须确认的文件、命令、报告字段、风险关闭证据。
4. 明确哪些风险在实现前仍然待关闭，哪些不在 MVP 范围。
5. 给出最终 Go/No-Go：是否启动真实 fixture + 校验器实现任务。
6. 若允许实现，指定第一批只做 T0-T6，T7 更新验收结果必须等待真实命令输出。

第 10 轮不建议再新增大范围规则、第二个 fixture、完整 schema、跨平台/模型回放。收敛就是收敛，别把最后一轮写成虾类百科。

## 11. 本轮结论

**结论：允许继续第 10 轮优化。**

理由：

1. 本轮未发现 P0 阻断项。
2. 已将第 8 轮验证计划压缩为 T0-T8 原子工程任务包。
3. 已明确哪些路线可直接实施，哪些需要前置确认。
4. 已列出至少 5 项优点及保持/扩大方式，覆盖边界、规则、隐私、回放、可复现等关键面。
5. 已列出真实落地范围膨胀、fixture 与校验器并行改动冲突、验收结果被主观解释、样本统计不一致遗留等核心风险，并给出改善办法和关闭条件。
6. 已建立验收前检查清单，覆盖文件、命令、结果、风险关闭证据。
7. 已映射 `PASS_WITH_RISK` 与第 1-8 轮累计风险，区分已关闭、待关闭、不在 MVP 范围。
8. 已给出决策建议：第 10 轮优先做最终收敛文档，再进入真实实现。

因此，第 10 轮可以继续推进。下一步应把小龙虾这张“下锅前检查单”变成最终作战令：确认 Go/No-Go，然后再真实落地 fixture 与最小静态校验器。