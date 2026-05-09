# openclaw-dev - 26-05 Learnings

### [KN-20260510-001] math-explainer 特殊 memory 路径处理

- **计数**: 1
- **标签**: migration, memory, project-config
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户确认 `math-explainer` 的特殊 `memoryStore.path` 属于历史遗留。迁移时不保留特殊路径，直接统一到标准项目 memory 路径；旧特殊 memory 文件可删除，按统一流程处理。

---

### [KN-20260510-002] 飞书重复卡片问题已确认修复

- **计数**: 1
- **标签**: feishu, websocket, bugfix, lifecycle
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
2026-04-18 用户反馈：重复卡片/双卡片问题已彻底修复，现在线上已经完全不会出现。此前主因判断为 Feishu channel 生命周期管理问题（restart/异常重连时旧 WS 残留导致双连接并行处理同一消息），修复 startAccount 防御、stopAccount 显式清理、启动前清旧 state、WS cleanup 竞态保护后生效。

---

### [KN-20260510-003] truth-source current-truth 口径对齐

- **计数**: 1
- **标签**: truth-source, current-truth, query-semantics
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确要求：truth DB 可以保留决策链/lineage，但不应该存在过期的 truth 内容。Leader 工作模式下调查/编码真相主要来自 subagent report；新 report 产出的内容必须覆盖旧内容。默认 truth 视图/默认查询结果只应暴露当前有效 truth，superseded 仅属于内部链路、审计或诊断，不属于默认 truth 结果。后续文档、查询层和 agent 说明书都要按这个口径收敛。

---

### [KN-20260510-004] truth-source v4 MD-first 架构决策

- **计数**: 1
- **标签**: truth-source, architecture, md-first, sqlite
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
2026-04-24 重大架构决策：truth-source 从 DB-first 回退到 MD-first。原因：1) DB 中的过期 truth 内容有害无益（增加体积、降低效率、带来错误记忆）；2) SQLite 无法通过 Git 和其他合作者合并；3) 用户要的是 current-truth engine 而非 knowledge history engine。新方案：canonical truth source = frontmatter MD 文件（独立文件+多文件树+INDEX.md）；DB 降级为派生索引层（edges/rollups/chunks/vector 只做可重建的索引）；文档格式 = 每个 truth block 一个独立 .md 文件，YAML frontmatter + 可读 body；组织结构 = objects/ constraints/ decisions/ + lineage.json + INDEX.md；supersede = rm 旧文件 + append lineage entry；DB 不能决定真相，只能索引真相。

---

### [KN-20260510-005] truth-source 文档可见性配置要求

- **计数**: 1
- **标签**: truth-source, documentation, config, visibility
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户新增要求：项目配置里需要可勾选“隐藏文档”或“显示文档”。当选择显示文档时，truth/source 文档必须创建在项目文件夹内，默认目录名为 `claw-docs`。后续 MD-first truth-source 设计与实现必须纳入该配置项与路径策略。

---

### [KN-20260510-006] truth-source 文档目录统一为 claw-docs

- **计数**: 1
- **标签**: truth-source, documentation, path-strategy, claw-docs
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户进一步明确：无论 hidden 还是 visible，truth/source 文档都要放到 `claw-docs` 文件夹下，以免文档散乱。区别仅在于根位置不同：hidden 放在 `.projects/{projectId}/claw-docs/`，visible 放在 `{projectRoot}/claw-docs/`。后续路径解析、clawproject 配置与实现统一按此规则。

---

### [KN-20260510-007] offer_choices 独立交互卡发送闭环打通

- **计数**: 1
- **标签**: offer_choices, feishu, interaction-card, delivery-context
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
2026-04-25 已确认：offer_choices 改为基于当前 thread 的 deliveryContext(accountId/chatId/messageId) + replyToMessageId，走 reply 路径直接发送完整交互卡，飞书端用户已明确反馈“成功了”。结论：不要再走 append existing streaming card / lastStreamingCard 方案；正确方案是用真实 thread context 直接 reply 发独立卡。

---

### [KN-20260510-008] offer_choices 最终逐条验收基线文档

- **计数**: 1
- **标签**: offer_choices, verification, regression, baseline
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
2026-04-25 已建立关键计划文档 `offer-choices-final-verify-plan.json`，作为 offer_choices 后续逐条修复/验收基线。文档收录：1) 8 条规则当前代码状态；2) 已通过真实验收项；3) 代码正确但待重新验收项；4) 未通过真实验收项；5) 已推翻结论（如“首按钮默认高亮”）；6) 后续修复优先级。后续相关问题优先回看此文档再继续推进。

---

### [KN-20260510-009] offer_choices 卡片回归修复决策

- **计数**: 1
- **标签**: offer_choices, feishu, callback, patch-api
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
飞书 offer_choices 本次最终决策：长按钮/多按钮使用竖版长按钮，不渲染 content/body；点击后完成态必须用 PATCH API 更新原卡片为左对齐纯展示卡片（`✅ 已选择：<label>`），不能依赖 callback response body，因为 handler 固定 fireAndForget=true 会吞掉返回值。label 用于展示，value 用于回灌会话并驱动后续响应。已完成实机验证通过。

---

### [KN-20260510-010] truth v2 推进结论

- **计数**: 1
- **标签**: truth-source, truth-agent, architecture, conclusions
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
当前 truth 系统目标已明确：不是手工精修文档，而是长期自动沉淀高质量 truth。关键原则：以 report 为输入源，但不 1:1 抄 report；按知识主题归档、按长期价值筛选；truth-agent 采用最小增强规则（判断是否值得沉淀、按主题归档、优先更新已有文档、保留检索词、避免流水信息）。当前主链路已收敛到 truth-subagent-hook.ts + truth-agent-dispatch.ts + TRUTH-AGENT-SPEC.md，旧 extractor/synthesis/writer 链路已清理。后续关注点应放在沉淀命中率、主题聚合质量、检索有效性和长期抗退化。详细结论文档保存在 tasks/project-truth-source/truth-v2-conclusions.md。

---

### [KN-20260510-011] 旧 plan 归档到 truth 的新触发点

- **计数**: 1
- **标签**: truth-source, plan-lifecycle, adr, archival
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
新增 truth 来源想法：在每次 plan_write 创建新 todo/新 plan 时，把老 todo 对应的旧 plan 作为输入发送给 truth writer 做归档提取；完成归档后删除旧 plan。该方向的价值是让 plan 生命周期也能贡献长期 truth，不只依赖 subagent report。truth 输入源应定义为三源体系：1) subagent report（提取结果、根因、代码入口、已验证行为）；2) plan 生命周期（提取 spec、策略、scope 边界、放弃方案，触发时机为旧 plan 被新 plan 替换时）；3) ADR（提取架构决策、trade-off、约束、理由，ADR 天然结构化且与 truth 对齐度最高）。plan 归档设计时需确认：旧 plan 是否有沉淀价值（需判断成熟度而非无条件归档）、删除前需 truth 提取成功、失败时回滚保留旧 plan、归档内容偏向决策/约定而非计划步骤。

---

### [KN-20260510-012] truth 输入源扩展原则（plan / ADR）

- **计数**: 1
- **标签**: truth-source, plan-schema, adr, throughput
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户已明确新的系统方向：1) plan schema 只做最小增强，增加一个可选字段 `keyDecisions` 即可，不要把 plan 设计得过重；2) 当 plan 被新 todo / 新 plan 替换时，可将旧 plan 送入 truth 提取，且无论提取成功还是失败，都直接清理旧 plan，不做失败回滚，也不追溯历史 plan/report，系统依赖多次运行逐步沉淀；3) ADR 作为补充 truth 来源，有更好，没有也不强求，能提取则尽量提取，但优先级低于 report 与 plan；4) 整体原则是偏向高吞吐、持续迭代、接受少量失败，而不是为单次失败保留复杂补救机制。

---

### [KN-20260510-013] 真相文档触发入口

- **计数**: 1
- **标签**: truth-source, trigger, subagent, plan_write
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
1. Subagent 完成后：subagent-registry-lifecycle.ts:533 → truth-subagent-hook.ts 的 tryUpdateTruthOnSubagentEnded() → dispatchTruthAgent() 更新 canonical markdown。前提：truthSource.enabled === true + report 有效 + 非 executor/truth-agent。2. plan_write 覆盖旧计划时：plan-tool.ts:389 → fire-and-forget 调 dispatchTruthAgent()。仅当检测到旧 source plan 被替换时触发。

---

### [KN-20260510-014] openclaw-dev 项目定位

- **计数**: 1
- **标签**: project-context, source-root, openclaw
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户确认当前 openclaw-dev 项目目录就是 OpenClaw 源码所在位置。后续涉及“这里”“当前项目”“OpenClaw 源码”时，默认指向该项目上下文。
