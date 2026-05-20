# Sample Skill Library Analysis

> 生成时间：2026-05-21；工作目录：`/home/yankeeting/.openclaw/projects/workflow-kit`。本次扫描为只读扫描；未复制样本，未修改源样本。

## 1. 样本来源和扫描命令

允许来源检查：

| 来源规则 | 实际状态 | 说明 |
|---|---:|---|
| `/home/yankeeting/.openclaw/projects/openclaw-dev/**/skills/**` | 存在，命中 67 个 skill 目录 | 包含核心 skills、extensions、`.agents/skills`、部分 `dist-runtime` 复制件 |
| `/home/yankeeting/.openclaw/skills/**` | 存在，命中 37 个 skill 目录 | 当前运行环境可加载的全局 skill 样本 |
| `/home/yankeeting/.openclaw/projects/*/**/skills/**` | 存在，命中 155 个 skill 目录 | 包含项目自定义 `.qoder/skills`、`.agents/skills`、文档样本等 |
| `/home/yankeeting/.openclaw/projects/*/.openclaw/**/skills/**` | 未单独命中 | 该模式被第三条递归扫描覆盖 |

扫描命令（核心逻辑）：

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
# Python os.walk 递归扫描三个 root：
#   - /home/yankeeting/.openclaw/projects/openclaw-dev
#   - /home/yankeeting/.openclaw/skills
#   - /home/yankeeting/.openclaw/projects
# prune: .git node_modules dist build coverage .cache cache __pycache__
# 收集所有含 SKILL.md 的 skills/ 路径下目录
```

初筛命令：

```bash
find /home/yankeeting/.openclaw/projects/openclaw-dev \
     /home/yankeeting/.openclaw/skills \
     /home/yankeeting/.openclaw/projects \
  \( -name .git -o -name node_modules -o -name dist -o -name build \
     -o -name coverage -o -name .cache -o -name __pycache__ \) -prune -o \
  -path '*/skills/*' -type f -print
```

**扫描摘要**：共发现 **259** 个含 `SKILL.md` 的 skill 目录。其中大量是同名 skill 在全局、dev、项目文档或插件目录中的重复/变体。去重后独立 skill 约 **75** 个。

## 2. 样本清单

### 2.1 全局 Skills（~/.openclaw/skills，37 个）

| # | skill 名 | 路径 | frontmatter 字段 | description/触发词摘要 | 附属文件 |
|---:|---|---|---|---|---|
| 1 | `task-planning` | `~/.openclaw/skills/task-planning` | name,version,description,metadata | 任务规划技能 - 指导复杂任务分解、调度与执行规划 | 1 文件 + .bak |
| 2 | `gitnexus-impact-analysis` | `~/.openclaw/skills/gitnexus-impact-analysis` | name,version,description,metadata | Use when ... what will break if they change something | 仅 SKILL.md |
| 3 | `feishu-perm` | `~/.openclaw/skills/feishu-perm` | name,version,description,metadata | 飞书权限管理。触发词：权限、分享、协作者 | 仅 SKILL.md |
| 4 | `gitnexus-pr-review` | `~/.openclaw/skills/gitnexus-pr-review` | name,version,description,metadata | Use when ... review a pull request | 仅 SKILL.md |
| 5 | `game-update-visualizer` | `~/.openclaw/skills/game-update-visualizer` | name,version,description,metadata | 游戏更新可视化。触发词：更新记录、周更、可视化、长图 | scripts/*.py, examples.md |
| 6 | `openclaw-master-workflow` | `~/.openclaw/skills/openclaw-master-workflow` | name,version,description,metadata | OpenClaw 系统配置管理。触发词：配置、模型、agent、技能 | 仅 SKILL.md |
| 7 | `browser-agent` | `~/.openclaw/skills/browser-agent-workflow` | name,version,description,metadata | 端到端UI验证的浏览器专家 | 仅 SKILL.md |
| 8 | `playwright` | `~/.openclaw/skills/playwright` | name,slug,version,homepage,description,metadata | 浏览器自动化。触发词：浏览器、自动化、截图、测试 | .clawhub/origin.json, _meta.json, scraping/testing/debugging/ci-cd/selectors.md |
| 9 | `code-reviewer-workflow` | `~/.openclaw/skills/code-reviewer-workflow` | name,version,description,metadata | 专职代码质量守门人，识别逻辑bug、安全漏洞、架构风险 | 仅 SKILL.md |
| 10 | `feishu-file-sender` | `~/.openclaw/skills/feishu-file-sender` | name,version,description,metadata | 飞书文件发送。触发词：发送文件、飞书文件 | 仅 SKILL.md |
| 11 | `task-status-tracker` | `~/.openclaw/skills/task-status-tracker` | name,version,description,metadata | 任务状态跟踪。触发词：进度、跟踪、状态 | tools/*.md(4), .learnings/(3), EVOLUTION.md |
| 12 | `coding-agent-workflow` | `~/.openclaw/skills/coding-agent-workflow` | name,version,description,metadata | 多专家协同中的核心执行者，需求转代码 | 仅 SKILL.md |
| 13 | `gitnexus-refactoring` | `~/.openclaw/skills/gitnexus-refactoring` | name,version,description,metadata | Use when ... rename, extract, split, move code safely | 仅 SKILL.md |
| 14 | `automation-workflows` | `~/.openclaw/skills/automation-workflows` | name,version,description,metadata | 自动化工作流。触发词：自动化、Zapier、Make、n8n | .clawhub/origin.json, _meta.json |
| 15 | `explorer` | `~/.openclaw/skills/explorer` | name,description,version,metadata | 探索型 Subagent。触发词：搜索、查找、探索 | 仅 SKILL.md |
| 16 | `memory-processor` | `~/.openclaw/skills/memory-processor-workflow` | name,version,description,metadata | 系统记忆处理。每日夜间配合 cron 记忆下沉/promote | scripts/*.sh, *.json, *.bak |
| 17 | `feishu-drive` | `~/.openclaw/skills/feishu-drive` | name,version,description,metadata | 飞书云盘工具。触发词：云盘、文件夹、drive | 仅 SKILL.md |
| 18 | `docx-converter-agent` | `~/.openclaw/skills/docx-converter-agent` | name,version,description,metadata | Markdown转Word专家。触发词：转成Word、导出docx | 仅 SKILL.md |
| 19 | `workspace-organizer` | `~/.openclaw/skills/workspace-organizer` | name,version,description,metadata | 工作空间整理。触发词：整理、workspace | 仅 SKILL.md |
| 20 | `knowledge-writer` | `~/.openclaw/skills/knowledge-writer` | name,version,description,metadata | 知识写入。仅由 main agent 的 cron 任务使用 | tools/*.md(3) |
| 21 | `feishu-doc` | `~/.openclaw/skills/feishu-doc` | name,version,description,metadata | 飞书文档工具。触发词：飞书、文档 | references/block-types.md |
| 22 | `code-researcher-workflow` | `~/.openclaw/skills/code-researcher-workflow` | name,version,description,metadata | 代码库深度调查、架构理解与依赖分析专家 | 仅 SKILL.md |
| 23 | `feishu-markdown-helper` | `~/.openclaw/skills/feishu-markdown-helper` | name,version,description,metadata | 飞书Markdown助手。触发词：Markdown、富文本 | 仅 SKILL.md |
| 24 | `scraper-agent-workflow` | `~/.openclaw/skills/scraper-agent-workflow` | name,version,description,metadata | 站点规则学习专家。分析 DOM 生成抓取规则 | 仅 SKILL.md |
| 25 | `vision-agent` | `~/.openclaw/skills/vision-agent` | name,version,description,metadata | 视觉识别。触发词：图片、截图、OCR、视觉 | _meta.json |
| 26 | `daily-diary` | `~/.openclaw/skills/daily-diary` | name,version,description,metadata | 日常日记。触发词：记一下、一个想法 | 仅 SKILL.md |
| 27 | `skill-self-evolution-enhancer` | `~/.openclaw/skills/skill-self-evolution-enhancer` | name,version,description,metadata | 技能自进化增强器。触发词：自进化、技能增强 | assets/(5 templates), references/(2), scripts/*.sh, .clawhub/, _meta.json |
| 28 | `mc-worker-dispatcher` | `~/.openclaw/skills/mc-worker-dispatcher` | name,version,description,metadata | MC Worker 调度器 | 仅 SKILL.md |
| 29 | `feishu-master` | `~/.openclaw/skills/feishu-master` | name,version,description,metadata | 飞书全能 Subagent。触发词：飞书、文档、云盘、知识库 | 仅 SKILL.md |
| 30 | `gitnexus-cli` | `~/.openclaw/skills/gitnexus-cli` | name,version,description,metadata | Use when ... run GitNexus CLI commands | 仅 SKILL.md |
| 31 | `adaptive-announcement-scraper` | `~/.openclaw/skills/adaptive-announcement-scraper` | name,version,description,metadata | 公告抓取。每天06:00自动运行或手动触发 | scripts/*.py/*.js, targets.json, .learnings/, output/(含 .docx/.html/.png) |
| 32 | `verify-agent-workflow` | `~/.openclaw/skills/verify-agent-workflow` | name,version,description,metadata | 多专家协同中的质量守门人，测试/lint/构建验证 | 仅 SKILL.md |
| 33 | `ppt-presenter` | `~/.openclaw/skills/ai-ppt-presenter` | name,version,description,metadata | PPT演讲生成器。触发词：PPT、演示、演讲 | assets/reveal-template.html, scripts/*.py, .clawhub/, _meta.json |
| 34 | `gitnexus-guide` | `~/.openclaw/skills/gitnexus-guide` | name,version,description,metadata | Use when ... asks about GitNexus itself | 仅 SKILL.md |
| 35 | `executor` | `~/.openclaw/skills/executor` | name,version,description,metadata | 执行型 Subagent。触发词：执行、修改、运行 | 仅 SKILL.md |
| 36 | `smart-home-control` | `~/.openclaw/skills/smart-home-control` | name,version,description,metadata | 智能家居控制。触发词：开灯、关灯、空调 | 仅 SKILL.md |
| 37 | `e2e-testing` | `~/.openclaw/skills/e2e-testing` | name,slug,version,description,metadata | E2E 端到端测试规范。触发词：e2e、端到端测试 | tools/*.md(3), _meta.json |
| 38 | `gitnexus-exploring` | `~/.openclaw/skills/gitnexus-exploring` | name,version,description,metadata | Use when ... how code works, architecture | 仅 SKILL.md |
| 39 | `crawler-optimizer` | `~/.openclaw/skills/crawler-optimizer` | name,version,description,metadata | 爬虫规则优化器 | 仅 SKILL.md |
| 40 | `gitnexus-debugging` | `~/.openclaw/skills/gitnexus-debugging` | name,version,description,metadata | Use when ... debugging a bug, tracing an error | 仅 SKILL.md |
| 41 | `multi-search-engine` | `~/.openclaw/skills/multi-search-engine` | name,version,description,metadata | 多搜索引擎，17引擎。触发词：搜索、多引擎 | config.json, references/, CHANGELOG.md, CHANNELLOG.md, metadata.json, .clawhub/ |
| 42 | `docx-cn` | `~/.openclaw/skills/docx-cn` | name,version,description,metadata | Word 文档处理。触发词：Word、docx | scripts/**/*.py(17), scripts/templates/*.xml(5), LICENSE.txt, .clawhub/ |
| 43 | `cn-web-search` | `~/.openclaw/skills/cn-web-search` | name,version,...,author,license,tags | 中文网页搜索，13+免费引擎 | package.json, README.md, .clawhub/, _meta.json |
| 44 | `git-discipline` | `~/.openclaw/skills/git-discipline` | name,version,description,metadata | Git 纪律管理。触发词：git、commit、回滚 | tools/*.md(7) |
| 45 | `feishu-wiki` | `~/.openclaw/skills/feishu-wiki` | name,version,description,metadata | 飞书知识库工具。触发词：知识库、wiki | 仅 SKILL.md |
| 46 | `session-cleanup` | `~/.openclaw/skills/session-cleanup` | name,version,description,metadata | 清理过期 Session 工作区 | session-observability.ts |

### 2.2 OpenClaw Dev Skills（projects/openclaw-dev，67 个，含 extensions 和 .agents）

这些是 openclaw-dev 仓库内的 skill。除了上表列出的全局 skill 在 dev 中有对应源文件外，还包括：

**extensions 类 skill（插件捆绑 skill）**：

| 名字 | 路径 | 说明 |
|---|---|---|
| `prose` | `extensions/open-prose/skills/prose` | OpenProse VM skill pack，87 个文件，含 alts/examples/guidance/lib/primitives/state |
| `acp-router` | `extensions/acpx/skills/acp-router` | 路由请求到不同 AI coding agent |
| `feishu-perm/drive/doc/wiki` | `extensions/feishu/skills/feishu-*` | 飞书扩展 skill 精简版（仅 name+description） |
| `diffs` | `extensions/diffs/skills/diffs` | 生成可分享的 diff |
| `tavily` | `extensions/tavily/skills/tavily` | Tavily 搜索/研究工具 |

**.agents 内置 skill（仓库级维护 workflow）**：

| 名字 | 说明 |
|---|---|
| `openclaw-parallels-smoke` | 跨平台 Parallels 烟雾测试 |
| `openclaw-release-maintainer` | 发布维护 workflow |
| `openclaw-ghsa-maintainer` | GitHub 安全公告维护 |
| `security-triage` | 安全漏洞分流 |
| `openclaw-pr-maintainer` | PR 维护 workflow |
| `openclaw-test-heap-leaks` | 内存泄漏调查 |
| `parallels-discord-roundtrip` | Discord 端到端验证 |
| `gitnexus-*` (7 个) | 在 .agents/skills/gitnexus/ 下的副本 |

### 2.3 项目自定义 Skills（projects 下其他项目，155 个）

**tiny-world 项目（.qoder/skills + .agents/skills，~22 个独立 skill）**：

| 名字 | 说明 | 特点 |
|---|---|---|
| `mortal-world-writing` | 凡人界创作规则约束 | 项目领域规则，高度定制 |
| `create-fate-content` | 机缘系统 ContentConfig 资源创建 | 流程模板 |
| `write-fate-dialog` | .dlg 对话文件编写 | 含格式/事件/条件说明 |
| `test-fate-chain` | 机缘链设计/测试/验证 | 含模板和流程 |
| `add-clue-type` | 新增 ClueType | 自动生成+多步操作 |
| `create-game-asset` | 游戏资产创建统一规范 | 带 `trigger` frontmatter |
| `mcp-runtime-test` | MCP 驱动运行时测试 | 平台特定 |
| `mcp-gameplay-test` | MCP 端到端玩家链路测试 | 平台特定 |
| `gitnexus-*` (6+7 个) | 代码分析套件，在 .qoder 和 .agents 各一套 | 大量重复 |

**TheClawGame 项目（3 个 skill）**：

| 名字 | 说明 |
|---|---|
| `mcp-runtime-test` | Godot 游戏 MCP 自动化测试 |
| `mcp-gameplay-test` | 交互流程端到端测试 |
| `the-claw-game` | 龙虾游戏规则 skill |

**GitNexus 项目（~18 个 skill）**：

分布在 `gitnexus-cursor-integration/skills/`、`.claude/skills/gitnexus/`、`gitnexus-claude-plugin/skills/` 中，内容是 gitnexus-* 套件的不同平台适配版本。部分含 `.json` 配置。

**mission-control 项目文档样本（~50 个 skill）**：

`docs/openclaw_docs/skills/` 下有大量 CLI 工具类 skill 样本，涵盖：apple-reminders, xurl, 1password, sherpa-onnx-tts, canvas, sag, camsnap, openhue, imsg, github, spotify-player, nano-pdf, wacli, himalaya, obsidian, openai-whisper, apple-notes, songsee, skill-creator, blucli, video-frames, weather, bluebubbles, healthcheck, tmux, coding-agent, mcporter, ordercli, slack, gemini, goplaces, node-connect, clawhub, discord, peekaboo, gog, summarize, session-logs, blogwatcher, bear-notes, gh-issues, sonoscli, notion, things-mac, oracle, eightctl, trello, model-usage, voice-call, openai-whisper-api, gifgrep 等。

这些 skill 的 frontmatter 通常包含 `name, description, homepage, metadata`，部分有 `allowed-tools`、`user-invocable`。多为单文件 SKILL.md，少量带 `scripts/`、`references/`。

## 3. 结构共性

1. **入口文档固定为 `SKILL.md`**：所有样本都以目录级 `SKILL.md` 作为唯一入口。简单 skill 只有这 1 个文件，复杂 skill 在同目录下补充附属资源。

2. **frontmatter 轻量但强约束**：
   - 最常见组合 A：`name + description`（项目 skill、extensions skill 常用）
   - 最常见组合 B：`name + version + description + metadata`（全局 skill、dev 核心常用）
   - 扩展字段：`slug`、`homepage`、`author`、`author_url`、`repository`、`license`、`tags`、`allowed-tools`、`user-invocable`、`trigger`

3. **description 承担检索和触发双重职责**：
   - 中文样本：`领域 | 能力描述。触发词：词1、词2、词3。`
   - 英文样本：`Use when ... Examples: "..."`，直接服务 skill 选择器匹配

4. **说明体例偏操作手册**：主体结构通常包含：
   - 角色定位/核心使命
   - 何时使用 / 触发条件
   - 工作流 / 步骤 / 阶段
   - 工具使用优先级
   - 边界 / 约束 / 禁止事项
   - 检查清单
   - 输出规范
   - 能力范围（能/不能）

5. **工具/权限边界常写在正文或 metadata**：涉及飞书、GitHub、Discord、邮件、浏览器、MCP、外部 API 的样本会明确标注"何时可调用""敏感操作需确认""不要泄露/不要破坏"等。

6. **复杂 skill 常带可执行或模板资产**：
   - `scripts/*.py|*.js|*.sh|*.mjs` — 可执行辅助脚本
   - `tools/*.md` — 子工具使用说明
   - `references/*.md` — API/block type/配置参考
   - `assets/*` — 模板文件（HTML/XML 等）
   - `examples/*.md|*.prose` — 用例/示例
   - `.learnings/` — 运行经验回写（ERRORS.md, LEARNINGS.md）
   - `.clawhub/origin.json` / `_meta.json` / `metadata.json` — 发布/市场元数据

## 4. 差异点

### 全局 skill vs 项目 skill

| 维度 | 全局 skill | 项目 skill |
|---|---|---|
| 位置 | `~/.openclaw/skills` | 项目内 `.qoder/skills`、`.agents/skills` |
| 偏好 | 通用能力/环境能力 | 项目领域规则/术语 |
| frontmatter | 更标准，含 `version` + `metadata.openclaw` | 可能缺 `version`，description 更依赖项目术语 |
| 复杂度 | 多为单文件或 tools/references | 可含项目特定脚本/配置 |
| 典型 | 飞书、GitNexus、浏览器、文档转换 | tiny-world 的 fate content、TheClawGame 规则 |

### 简单 skill vs 复杂 skill

| 层级 | 文件数 | 典型结构 | 典型用途 |
|---|---|---|---|
| 简单 | 1 | 仅 SKILL.md | 角色/触发条件/checklist/workflow |
| 中等 | 2-6 | + `references/` 或 `tools/` | API 参考、命令用法、测试模板拆分 |
| 复杂 | 7-87 | + `scripts/` + `assets/` + `examples/` + `.learnings/` | 自动化生成、文档转换、VM、自进化 |

### 脚本/模板/数据依赖分类

- **脚本依赖**：`.py`、`.js`、`.sh`、`.mjs` — 文档/图片/PPT/搜索/测试/转换
- **模板依赖**：`assets/*`、`scripts/templates/*`、`TASK_TEMPLATE.md` — 生成/校验
- **数据/元数据**：`_meta.json`、`.clawhub/origin.json`、`metadata.json`、`config.json`、`targets.json` — 发布/市场/配置
- **学习沉淀**：`.learnings/`、`EVOLUTION.md`、`LEARNINGS.md` — 运行后经验回写（易携带项目上下文）

## 5. 对 SkillForge 数据结构的启发

建议拆成三层：

### SkillSpec（生成前/抽象规格）

| 字段 | 说明 | 样本依据 |
|---|---|---|
| `intent` | 要沉淀的 workflow/经验目标 | 所有 skill 的核心使命段落 |
| `domain` | 领域/项目/工具类别 | feishu/gitnexus/testing/game/mcp/browser 等自然分类 |
| `triggers` | 触发词 + Use when + 反触发 | 中文"触发词：" + 英文 "Use when" 两种模式 |
| `audienceAgent` | main/subagent/coding/research/verify | 各 workflow skill 的角色定位 |
| `workflowSteps` | 阶段化步骤、检查清单、输入输出 | 操作手册体例 |
| `constraints` | 只读/可写/需确认/禁止项/隐私边界 | 正文中的边界约束段落 |
| `tools` | 允许或建议使用的工具/CLI/MCP/API | 工具优先级表格 |
| `examples` | 正例、反例、用户表达样例 | description 中的 Examples 列表 |
| `validation` | 生成后自检/最小验证命令/审核点 | 检查清单和输出规范 |

### SkillManifest（落盘/发布清单）

| 字段 | 说明 | 样本依据 |
|---|---|---|
| `name` / `slug` / `version` | 基础标识 | frontmatter 必需字段 |
| `description` | 含触发信息的检索描述 | 所有样本 |
| `metadata` | emoji/type/市场信息等 | `metadata.openclaw.emoji/type` |
| `homepage` / `repository` / `license` / `author` / `tags` | 发布元数据 | cn-web-search、docx-cn 等带完整字段 |
| `entrypoint` | 通常 `SKILL.md` | 固定约定 |
| `resourceFiles` | tools/references/scripts/assets/examples | 复杂 skill 的附属目录 |
| `permissions` / `allowedTools` | 工具/网络/文件写入/外部消息 | discord 的 `allowed-tools`、各 skill 的边界段 |
| `runtimeDependencies` | Python/Node/CLI/MCP | scripts/ 中的实际依赖 |
| `privacyLevel` | 项目专属/密钥/私密数据风险 | 项目 skill vs 全局 skill |
| `sourceProvenance` | 从哪类样本/会话生成 | 本次扫描的多来源分层 |

### SampleSkill（样本库索引）

| 字段 | 说明 |
|---|---|
| `sampleId` / `name` / `path` / `sourceType` | 唯一标识 + 来源（global/dev/project/docs/plugin/build-copy） |
| `hasSkillMd` / `frontmatterKeys` | 入口文件和元数据字段 |
| `descriptionSummary` / `triggerSummary` | 检索用摘要 |
| `structureType` | single-file / with-tools / with-scripts / with-assets / with-learning |
| `fileTypes` / `topLevelDirs` / `fileCount` | 附属资源统计 |
| `domainTags` / `riskTags` / `reusabilityScore` | 质量评估 |
| `duplicateGroup` | 同名/同内容/构建副本分组（去重用） |

## 6. 对 SkillForge 生成流程的启发

### 生成前需要输入

1. **技能目标**：要让 Agent 在什么情况下更会做什么
2. **触发边界**：哪些用户表达应该触发；哪些场景不该触发
3. **执行权限**：只读、可写、可运行命令、可外发消息、是否需要确认
4. **工具环境**：依赖 CLI、MCP、脚本、API、项目路径、运行平台
5. **经验材料**：成功案例、失败案例、现有 workflow、命令片段、模板
6. **输出规范**：最终答复、文档、代码变更、测试报告等格式
7. **隐私分级**：是否包含用户/公司/项目私有细节，能否发布到公共库

### 生成后如何验证

| 验证维度 | 方法 |
|---|---|
| **结构验证** | 目录有入口 `SKILL.md`；frontmatter 至少有 `name`、`description`；slug/name 合法；资源路径存在 |
| **触发验证** | description 是否包含明确 Use when/触发词；避免过宽泛导致误触发 |
| **边界验证** | 敏感外部操作是否写明确认策略；destructive/file write/network/API 是否可审计 |
| **依赖验证** | 脚本是否可执行、解释器/包依赖是否声明；模板/参考文件是否相对路径可解析 |
| **样本回放** | 用 2-3 个正例和 1-2 个反例检查 skill 选择和输出行为 |
| **去隐私验证** | 扫描绝对路径、token、个人信息、项目私密业务规则 |
| **兼容验证** | 路径使用相对路径；不同 OS/节点下命令是否有替代方案 |

## 7. 可复制/可复用候选

> 仅列路径和用途，不实际复制。

| 路径 | 用途 | 推荐理由 |
|---|---|---|
| `~/.openclaw/skills/task-planning` | 复杂任务拆解、subagent 调度样板 | 清晰的 workflow + checklist |
| `~/.openclaw/skills/code-researcher-workflow` | 调研型 subagent 样板 | 3 阶段搜索策略、报告格式 |
| `~/.openclaw/skills/coding-agent-workflow` | 编码执行型 workflow 样板 | 角色定位+约束+输出规范 |
| `~/.openclaw/skills/verify-agent-workflow` | 验证/测试型 workflow 样板 | 测试/lint/构建验证流程 |
| `~/.openclaw/skills/gitnexus-exploring` | "Use when + workflow + checklist" 样板 | 典型英文触发描述 |
| `~/.openclaw/skills/feishu-doc` | 外部 SaaS/API 工具样板 | references 拆分模式 |
| `~/.openclaw/skills/e2e-testing` | tools/*.md 辅助文档样板 | 子工具拆分方式 |
| `~/.openclaw/skills/docx-cn` | 复杂脚本/模板型样板 | scripts+templates+validators |
| `~/.openclaw/skills/skill-self-evolution-enhancer` | 生成型+assets+scripts 样板 | 最复杂的目录结构之一 |
| `~/.openclaw/skills/playwright` | 多文档参考型样板 | 多个 topic md 文件 |
| `~/.openclaw/skills/adaptive-announcement-scraper` | 自动化+输出+learnings 样板 | 含完整运行产物和经验沉淀 |
| `~/.openclaw/skills/cn-web-search` | 完整发布元数据样板 | author/license/tags/repository |
| `projects/tiny-world/.qoder/skills/create-game-asset` | 项目领域规则样板 | trigger frontmatter + 流程模板 |
| `projects/tiny-world/.qoder/skills/mcp-gameplay-test` | 项目内 MCP/E2E 测试样板 | 平台特定工具集成 |
| `projects/mission-control/docs/openclaw_docs/skills/skill-creator` | skill 创建/审计工具样板 | 含 scripts 和 templates |
| `projects/openclaw-dev/extensions/open-prose/skills/prose` | 大型 skill pack 样板 | 87 文件，VM 级组织方式 |

## 8. 风险与边界

1. **隐私风险**：项目 skill 可能含真实项目路径、业务设定、个人工具链、外部账号/服务说明；进入样本库前应脱敏处理（替换绝对路径为占位符，移除 token/密钥引用）。

2. **项目专属上下文**：tiny-world、TheClawGame、GitNexus 等样本高度依赖项目结构和术语。复用时应**提炼为模式**（如"游戏资产创建流程""MCP 测试框架"），不应原样泛化到不相关项目。

3. **过拟合样本**：同名 skill 在 global/dev/docs/plugin/build 副本中大量重复。如 gitnexus-* 系列在 6+ 个位置出现。若直接归纳会放大格式偏好。建议：去重后按 `sourceType` 降权处理副本。

4. **路径兼容**：样本中常出现绝对路径（`/home/yankeeting/...`）、macOS 特定 CLI（`memo`、`peekaboo`）、特定 MCP 服务名。生成 skill 应优先使用相对路径和可配置变量。

5. **权限边界**：消息发送（飞书/Discord/Slack/iMessage/WhatsApp）、邮件、社交平台、文件系统写入等操作必须显式要求确认/最小权限。脚本执行需声明依赖和副作用。

6. **构建/发布副本混入**：`dist-runtime` 中的 skill 是构建拷贝，`docs/openclaw_docs/` 是文档 mirror，plugin package 中的是发布件。不宜作为独立来源计算经验多样性。

7. **学习文件污染**：`.learnings/`、`output/`、运行结果文件可能含临时数据、真实抓取结果、个人偏好。默认不应复制进可发布 skill。

---

## 附：扫描统计

- **总 skill 目录数**：259
- **去重后独立 skill 估计**：~75
- **来源分布**：openclaw-dev 67 | global 37（与 dev 大量重叠）| projects 155（含大量副本）
- **frontmatter 组合 Top 3**：
  1. `name, version, description, metadata` — 最常见（全局+dev 核心）
  2. `name, description` — 项目 skill、extensions skill
  3. `name, description, homepage, metadata` — mission-control 文档样本
- **附属扩展名分布**：`.md` > `.json` > `.py` > `.js` > `.sh` > `.html` > `.prose` > `.ts` > `.xml` > `.mjs`
- **附属顶层目录分布**：`tools/` > `references/` > `scripts/` > `.clawhub/` > `assets/` > `.learnings/` > `examples/` > `output/`
- **同名重复最多**：gitnexus-impact-analysis (7), gitnexus-debugging (7), gitnexus-refactoring (7), gitnexus-cli (7), gitnexus-guide (7), gitnexus-exploring (7), feishu-perm (4), feishu-doc (4), prose (3)
