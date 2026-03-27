# OpenClaw 技能创建指南

本文档详细说明如何在 OpenClaw 系统中创建、配置和管理技能（Skill）。

## 目录

- [概述](#概述)
- [技能目录结构](#技能目录结构)
- [SKILL.md 编写规范](#skillmd-编写规范)
- [技能元数据配置](#技能元数据配置)
- [工具定义（可选）](#工具定义可选)
- [技能配置流程](#技能配置流程)
- [技能激活机制](#技能激活机制)
- [技能生命周期](#技能生命周期)
- [最佳实践](#最佳实践)
- [示例](#示例)

---

## 概述

Skill 是 OpenClaw 中的原子执行单元，通过 `SKILL.md` 文件定义行为和能力。技能可以：

- 封装特定领域的知识和工作流程
- 提供可复用的工具和方法
- 与其他技能协作完成复杂任务
- 通过意图匹配自动激活

### 技能类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `skill` | 普通技能，提供特定功能 | multi-search-engine, playwright |
| `subagent` | 子代理，可独立执行任务 | executor, explorer-agent, plan-agent |

---

## 技能目录结构

```
workspace/skills/{skill-name}/
├── SKILL.md                    # 必需：技能定义文件
├── _meta.json                  # 可选：发布元数据
├── tools/                      # 可选：工具定义目录
│   ├── tool-name.md
│   └── ...
├── assets/                     # 可选：资源文件
│   ├── templates/
│   └── ...
├── scripts/                    # 可选：脚本文件
│   └── script.sh
├── references/                 # 可选：参考文档
│   └── reference.md
├── .learnings/                 # 可选：技能级学习记录
│   ├── LEARNINGS.md
│   ├── ERRORS.md
│   └── FEATURE_REQUESTS.md
└── .clawhub/                   # 可选：ClawHub 来源信息
    └── origin.json
```

### 必需文件

| 文件 | 说明 |
|------|------|
| `SKILL.md` | 技能的核心定义文件，包含元数据和提示内容 |

### 可选文件说明

| 文件/目录 | 用途 |
|-----------|------|
| `_meta.json` | 发布到 ClawHub 的元数据 |
| `tools/*.md` | 定义技能可用的工具 |
| `assets/` | 模板、配置文件等资源 |
| `scripts/` | 可执行的脚本 |
| `references/` | 技能使用的参考文档 |
| `.learnings/` | 技能级别的学习和错误记录 |

---

## SKILL.md 编写规范

### Frontmatter 格式

SKILL.md 文件必须以 YAML frontmatter 开头：

```yaml
---
name: skill-name                    # 必需：技能唯一标识（kebab-case）
version: 1.0.0                      # 必需：语义化版本号
description: "简短描述 | 详细说明。触发词：关键词1、关键词2。"  # 必需：技能描述
metadata:
  openclaw:
    emoji: "🔥"                     # 可选：表情符号
    priority: high                  # 可选：优先级（critical, high, medium, low）
    type: skill                     # 可选：类型（skill, subagent）
---
```

### Frontmatter 字段说明

| 字段 | 必需 | 类型 | 说明 |
|------|------|------|------|
| `name` | 是 | string | 技能唯一标识，使用 kebab-case 命名 |
| `version` | 是 | string | 语义化版本号（x.y.z） |
| `description` | 是 | string | 技能描述，包含触发关键词 |
| `metadata.openclaw.emoji` | 否 | string | 显示用的表情符号 |
| `metadata.openclaw.priority` | 否 | string | 优先级：critical, high, medium, low |
| `metadata.openclaw.type` | 否 | string | 类型：skill（默认）或 subagent |

### 描述格式建议

```yaml
description: "技能名称 | 简短说明技能功能。触发词：关键词1、关键词2、关键词3。"
```

**示例**：
```yaml
description: "多搜索引擎 | 集成17个搜索引擎，支持高级搜索、时间过滤、站内搜索。触发词：搜索、搜索引擎、多引擎。"
```

### 文档主体结构

Frontmatter 后是 Markdown 格式的技能内容：

```markdown
# 技能标题

简要概述技能的用途和功能。

## 核心功能/职责

- 功能1：说明
- 功能2：说明

## 工作流程

1. 步骤一
2. 步骤二
3. 步骤三

## 使用方法

### 基本用法

使用示例...

### 高级用法

高级示例...

## 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| param1 | string | - | 说明 |

## 最佳实践

1. 建议1
2. 建议2

## 相关技能

- `skill-a` - 关联说明
- `skill-b` - 关联说明

## 变更历史

- **v1.0.0** (2026-03-18): 初始版本
```

---

## 技能元数据配置

### _meta.json 格式

用于 ClawHub 发布和版本管理：

```json
{
  "ownerId": "用户ID",
  "slug": "skill-name",
  "version": "1.0.0",
  "publishedAt": 1708300000000
}
```

### .clawhub/origin.json

记录技能的来源信息：

```json
{
  "source": "clawhub",
  "installedAt": 1708300000000,
  "version": "1.0.0"
}
```

---

## 工具定义（可选）

在 `tools/` 目录下定义技能特有的工具：

### 工具文件格式

```markdown
# tool-name - 工具简短描述

工具的详细说明。

## 使用方法

### 基本用法

\`\`\`javascript
toolName({
  param1: "value1",
  param2: "value2"
});
\`\`\`

### 参数说明

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| param1 | string | 是 | 参数说明 |
| param2 | string | 否 | 参数说明 |

## 返回值

返回值说明...

## 示例

\`\`\`javascript
// 示例1
toolName({ param1: "test" });

// 示例2
toolName({ param1: "test", param2: "option" });
\`\`\`

## 最佳实践

1. 建议1
2. 建议2
```

### 工具目录示例

```
workspace/skills/knowledge-writer/tools/
├── record-learning.md      # 记录知识工具
├── promote-knowledge.md    # 提升知识工具
└── vector-search.md        # 向量搜索工具
```

---

## 技能配置流程

技能创建后，需要进行正确配置才能被系统识别和使用。完整的配置流程如下：

### 配置流程图

```
创建 SKILL.md → 配置 openclaw.json → 配置 Agent 关联 → 配置激活规则 → 重启生效
```

### Step 1: 创建技能文件

在 `workspace/skills/{skill-name}/` 目录下创建 `SKILL.md` 文件：

```bash
# 创建技能目录
mkdir -p ~/.openclaw/workspace/skills/my-skill

# 创建 SKILL.md
# （按上一章节的规范编写）
```

### Step 2: 配置 openclaw.json

在 `~/.openclaw/openclaw.json` 中配置技能：

#### 2.1 启用技能

在 `skills.entries` 中添加技能条目：

```json
{
  "skills": {
    "entries": {
      "my-skill": {
        "enabled": true
      },
      "another-skill": {
        "enabled": false
      }
    }
  }
}
```

#### 2.2 配置 Agent 关联技能

在 `agents.list` 中为 Agent 关联技能：

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "skills": [
          "task-status-tracker",
          "orchestrator-constraint",
          "my-skill"
        ],
        "tools": {
          "deny": ["Write", "Edit", "Delete"]
        }
      },
      {
        "id": "executor",
        "workspace": "/home/user/.openclaw/workspace",
        "skills": [
          "my-skill"
        ],
        "tools": {
          "allow": ["Read", "Write", "Edit", "Delete", "Bash"]
        }
      }
    ]
  }
}
```

#### 2.3 Subagent 配置示例

对于 Subagent 类型的技能，需要额外配置工具权限：

```json
{
  "agents": {
    "list": [
      {
        "id": "my-subagent",
        "workspace": "/home/user/.openclaw/workspace",
        "model": {
          "primary": "zhipu/glm-5"
        },
        "skills": [
          "my-skill"
        ],
        "tools": {
          "allow": [
            "Read",
            "Write",
            "Edit",
            "Bash"
          ]
        }
      }
    ]
  }
}
```

### Step 3: 配置 skill-activation.yaml（可选）

在 `workspace/config/skill-activation.yaml` 中配置激活规则：

#### 3.1 意图匹配

```yaml
intent_matching:
  - patterns:
      - "我的触发词"
      - "another keyword"
    skills:
      - "my-skill"
    reason: "匹配说明"
```

#### 3.2 检查点触发

```yaml
checkpoints:
  - trigger: "before_tool_use"
    tools:
      - "SomeTool"
    required_skills:
      - "my-skill"
    action: "activate_skill"
```

#### 3.3 技能优先级

```yaml
skill_priority:
  high:
    - "my-skill"
  normal:
    - "other-skill"
```

### Step 4: 配置生效

修改配置后需要重启服务：

```bash
# 方法1：重启 OpenClaw
openclaw restart

# 方法2：如果支持热重载
openclaw reload
```

### 完整配置示例

以下是一个完整的技能配置示例，展示 `my-search-skill` 从创建到激活的全过程：

#### 1) SKILL.md

```yaml
---
name: my-search-skill
version: 1.0.0
description: "自定义搜索 | 实现定制化的搜索功能。触发词：搜索、查找。"
metadata:
  openclaw:
    emoji: "🔎"
    priority: normal
    type: skill
---
# My Search Skill
...内容省略...
```

#### 2) openclaw.json

```json
{
  "skills": {
    "entries": {
      "my-search-skill": {
        "enabled": true
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "skills": [
          "my-search-skill"
        ]
      }
    ]
  }
}
```

#### 3) skill-activation.yaml

```yaml
intent_matching:
  - patterns:
      - "搜索"
      - "查找"
      - "找一下"
    skills:
      - "my-search-skill"
    reason: "搜索任务"
```

### 配置层级说明

OpenClaw 配置采用多层覆盖机制：

```
全局默认 (agents.defaults)
    ↓ 被覆盖
Agent 配置 (agents.list[].skills)
    ↓ 被覆盖
会话配置 (运行时)
```

| 层级 | 配置位置 | 作用范围 |
|------|----------|----------|
| 全局 | `agents.defaults.skills` | 所有 Agent |
| Agent 级 | `agents.list[].skills` | 特定 Agent |
| 会话级 | 运行时动态配置 | 当前会话 |

### 配置验证

创建技能后，验证配置是否正确：

```bash
# 查看已加载的技能
/skills

# 或询问
"有哪些可用的技能？"
```

---

## 技能激活机制

技能通过三层架构激活：

```
配置层 → Prompt 注入层 → Context 激活层
```

### 1. 意图匹配

在 `skill-activation.yaml` 中配置意图匹配规则：

```yaml
intent_matching:
  - patterns:
      - "搜索"
      - "查找"
      - "找一下"
    skills:
      - "multi-search-engine"
    reason: "搜索任务"

  - patterns:
      - "帮我修改"
      - "改一下"
      - "更新"
    skills:
      - "orchestrator-constraint"
    reason: "文件修改操作需要委派"
```

### 2. 检查点触发

在特定事件时检查技能：

```yaml
checkpoints:
  - trigger: "before_tool_use"
    tools:
      - "Write"
      - "Edit"
      - "Delete"
    required_skills:
      - "orchestrator-constraint"
    action: "remind_or_delegate"

  - trigger: "after_error"
    required_skills:
      - "knowledge-writer"
    action: "auto_log"
```

### 3. 智能推荐

```yaml
smart_recommendation:
  enabled: true
  confidence_threshold: 0.7
  max_recommendations: 3
  templates:
    single: "检测到这是一个{intent}任务，建议使用 {skill} 技能。"
    multiple: "检测到这是一个{intent}任务，推荐使用以下技能：{skills}"
```

### 4. 技能优先级

```yaml
skill_priority:
  critical:
    - "orchestrator-constraint"
    - "knowledge-writer"
  high:
    - "spec-kit"
    - "task-status-tracker"
  normal:
    - "multi-search-engine"
    - "summarize"
  low:
    - "playwright"
    - "feishu-doc"
```

---

## 技能生命周期

技能的完整生命周期包括六个阶段：

```
1. 发现阶段 → 2. 注入阶段 → 3. 决策阶段 → 4. 执行阶段 → 5. 反馈阶段 → 6. 学习阶段
```

| 阶段 | 说明 |
|------|------|
| **发现阶段** | 扫描 `workspace/skills/` 目录，识别所有可用技能 |
| **注入阶段** | 读取 SKILL.md 提示文本和元数据，注入到 Agent 上下文 |
| **决策阶段** | 判断是否委派给子代理或直接执行 |
| **执行阶段** | 直接工具调用或子代理执行 |
| **反馈阶段** | 结果回传给用户和主代理 |
| **学习阶段** | 记录错误、修正与特性请求到 `.learnings/` 或全局知识层 |

---

## 最佳实践

### 命名规范

1. **技能名称**：使用 kebab-case（如 `multi-search-engine`）
2. **描述**：清晰说明功能，包含触发关键词
3. **版本**：遵循语义化版本规范（MAJOR.MINOR.PATCH）

### 内容编写

1. **简洁明了**：描述要具体，避免模糊表述
2. **结构清晰**：使用标题和列表组织内容
3. **示例丰富**：提供具体的使用示例
4. **关联明确**：注明与其他技能的关系

### 触发词设计

1. **覆盖常用表达**：考虑用户可能使用的不同表达方式
2. **避免冲突**：与其他技能的触发词区分开
3. **包含中英文**：支持多语言环境

### 工具定义

1. **单一职责**：每个工具只做一件事
2. **参数清晰**：明确必需和可选参数
3. **示例完整**：提供完整的使用示例

### 版本管理

1. **记录变更**：在 SKILL.md 底部维护变更历史
2. **向后兼容**：避免破坏性变更
3. **及时更新**：修复 bug 后更新版本号

---

## 示例

### 完整的技能示例

```markdown
---
name: multi-search-engine
version: 1.0.0
description: "多搜索引擎 | 集成17个搜索引擎（8国内+9国际），支持高级搜索、时间过滤、站内搜索。触发词：搜索、搜索引擎、多引擎。"
metadata:
  openclaw:
    emoji: "🔍"
    priority: normal
    type: skill
---

# Multi Search Engine

使用 Playwright MCP 工具进行多引擎搜索，绕过反爬虫机制。

## 搜索引擎优先级

| 优先级 | 引擎 | 状态 |
|--------|------|------|
| 1 | Baidu | ✅ |
| 2 | Bing CN | ✅ |
| 3 | Bing INT | ✅ |
| 4 | Google HK | ✅ |

## 工作流程

```
输入关键词 → 取前3个可用引擎 → Playwright MCP 搜索 → 合并去重结果
```

## 搜索结果选择器

| 引擎 | 结果容器 | 标题 | 摘要 |
|------|----------|------|------|
| Baidu | `.result.c-container` | `h3` | `.c-abstract` |
| Bing | `.b_algo` | `h2` | `.b_caption p` |

## 高级搜索

| 操作符 | 示例 | 说明 |
|--------|------|------|
| `site:` | `site:github.com python` | 站内搜索 |
| `filetype:` | `filetype:pdf report` | 文件类型 |
| `""` | `"machine learning"` | 精确匹配 |

## 相关技能

- `playwright` - 网页抓取
- `knowledge-writer` - 知识记录

## 变更历史

- **v1.0.0** (2026-03-18): 初始版本
```

### Subagent 技能示例

```markdown
---
name: executor
version: 1.0.0
description: "执行型 Subagent | 执行耗时操作、文件修改、命令执行。触发词：执行、修改、运行、批量处理。"
metadata:
  openclaw:
    emoji: "🔧"
    priority: high
    type: subagent
---

# Executor Subagent

你是一个专门负责执行任务的 Subagent。

## 核心职责

1. **文件操作** - Read, Write, Edit, Delete
2. **命令执行** - Bash 运行各种命令
3. **网络请求** - WebFetch, WebSearch
4. **批量处理** - 处理多个文件或任务

## 工具权限

**可用工具**：
- ✅ Read - 读取文件
- ✅ Write - 写入文件
- ✅ Edit - 编辑文件
- ✅ Delete - 删除文件
- ✅ Bash - 执行命令

**禁止使用**：
- ❌ sessions_spawn - 不生成子 Agent

## 工作原则

- **完整执行** - 确保任务完整执行
- **错误处理** - 遇到错误时尝试解决或报告
- **结果反馈** - 清晰报告执行结果

## 调用方式

主 Agent 通过 `sessions_spawn` 调用：

```
sessions_spawn({
  task: "作为 Executor，执行以下任务：[任务描述]",
  agentId: "executor"
})
```
```

---

## 相关文档

- [Skill 关闭指南](./skill-shutdown.md)
- [Skill 激活配置](../workspace/config/skill-activation.yaml)
- [知识管理](../workspace/skills/knowledge-writer/SKILL.md)

---

## 常见问题

### Q: 如何调试技能？

1. 检查 SKILL.md 语法是否正确
2. 确认触发词是否配置
3. 查看日志了解激活情况
4. 使用 `.learnings/` 记录问题

### Q: 技能修改后如何生效？

修改 SKILL.md 后需要：
- 重启服务，或
- 刷新配置

### Q: 如何禁用技能？

参考 [Skill 关闭指南](./skill-shutdown.md)，可通过：
- 全局禁用（`openclaw.json`）
- 代理维度禁用（从 `agents.list[*].skills` 移除）

---

*最后更新：2026-03-18*
