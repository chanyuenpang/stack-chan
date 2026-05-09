---
name: knowledge-writer
version: 3.2.1
description: "知识写入技能 | 支持项目级和全局知识存储。仅由 main agent 的 cron 任务使用。"
metadata:
  openclaw:
    emoji: "📚"
    priority: high
    type: skill
---

# Knowledge Writer v3 - 知识写入技能

## 定位

仅由 **main agent** 在 cron 记忆整理任务中使用。其他 agent 不需要此技能。

## 知识流

```
所有 Agent → 直接追加到 MEMORY.md 表格（零负担）
                        ↓
      MEMORY 作为临时暂存层 / Top30 高频投影层
                        ↓
main cron（每天4点）→ 读取 MEMORY.md 新条目
                        ↓
                 判断 scope（项目级 vs 全局）
                        ↓
                 memory_search 匹配已有知识
                        ↓
              匹配到 → 计数+1（对应知识库）
              未匹配 → 新建条目到对应知识库
                        ↓
 所有条目以下沉/合并到 knowledge 为准，knowledge 是全量主账本
                        ↓
 count=1 条目在夜间整理时移入 knowledge 并从 MEMORY 清除
                        ↓
 只有满足 promo 规则的 knowledge 条目才可进入 MEMORY：
   - MEMORY 未满 30 条：`count >= 2` 即可 promo
   - MEMORY 已满 30 条：新条目 `count` 必须严格大于当前第30位
                        ↓
      MEMORY 最终只保留 Top30，且保留项 `count >= 2`
                        ↓
         项目知识 → .projects/{project}/.knowledge/
         全局知识 → .knowledge/
```

## 目录结构

### 全局知识
```
workspace/.knowledge/                          # 全局知识
├── shared-learnings.md                        # 学习和最佳实践
├── shared-errors.md                           # 错误和修复
├── shared-patterns.md                         # 可复用模式
└── feature-requests.md                        # 功能请求
```

### 项目级知识
```
workspace/.projects/{projectId}/.knowledge/    # 项目级知识
├── YY-MM-learnings.md                         # 项目特定学习（含 errors，错误即经验）
└── YY-MM-patterns.md                          # 项目特定模式
```

`YY-MM` 使用条目更新时间所在月份，时区固定为 Asia/Shanghai。项目级不再使用 `learnings.md` / `patterns.md` / `errors.md` 扁平文件。

## 条目格式

### 全局知识条目格式（不变）

```markdown
### [KN-YYYYMMDD-NNN] 标题

- **计数**: 1
- **来源**: agent名称（如 feishu-engineer）
- **项目**: 项目名称（如无则为 -）
- **标签**: tag1, tag2
- **发现时间**: YYYY-MM-DD
- **更新时间**: YYYY-MM-DD

#### 内容
知识的完整描述。

#### 影响（可选）
对其他 agent 或项目的价值说明。
```

全局 knowledge 不变：仍写入 `workspace/.knowledge/shared-learnings.md`、`shared-patterns.md`、`shared-errors.md`，全局条目字段保持原格式。

### 项目级知识条目格式

项目级条目只保留以下字段，禁止写入 `来源`、`项目` 字段：

```markdown
### [KN-YYYYMMDD-NNN] 标题

- **计数**: 1
- **标签**: tag1, tag2
- **发现时间**: YYYY-MM-DD
- **更新时间**: YYYY-MM-DD

#### 内容
知识的完整描述。
```

## Scope 判断规则

知识写入前需判断存储范围：

| 条件 | 写入位置 |
|------|----------|
| `kind=project` | `.projects/{projectId}/.knowledge/` |
| `memory_path` 位于 `.projects/{projectId}/` 下 | `.projects/{projectId}/.knowledge/` |
| 知识明确关联某个项目（有项目标签、来自项目上下文） | `.projects/{projectId}/.knowledge/` |
| 知识是通用的（跨项目、通用模式、Agent 工作流等） | `.knowledge/` |
| 无法判断时（默认） | `.knowledge/` |

判断依据：
- **项目标签**：知识条目包含 `project` 字段
- **上下文来源**：来自项目相关 Agent 或任务
- **内容属性**：项目特定技术栈、业务逻辑写入项目级；通用模式写入全局
- **强制防误写**：只要 `kind=project` 或 `memory_path` 位于 `.projects/{projectId}/`，即使恢复/continue 后上下文丢失，也必须从路径反推项目并写入该项目 `.knowledge/`，禁止写入 workspace `.knowledge/`（防止 tiny-world 等项目记忆误写全局）

## 写入规则

1. **计数驱动**：匹配到已有条目时，只增加计数，不重复写入
2. **来源标签必填（全局）**：全局知识必须标注来源 agent；项目级知识不写 `来源` 字段
3. **项目标签（全局）**：全局知识如需标注项目，可保留 `项目` 字段；项目级知识不写 `项目` 字段
4. **Scope 分离**：项目知识和全局知识分开存储，便于检索；当 `memory_path` 位于 `.projects/{project}/` 时强制写入该项目 `.knowledge/`，禁止写入 `workspace/.knowledge/`
5. **项目级按月分桶**：项目级根据条目 `更新时间` 所属月份（Asia/Shanghai）的 `YY-MM` 选择 `.projects/{projectId}/.knowledge/YY-MM-learnings.md` 或 `YY-MM-patterns.md`；errors 归入 `YY-MM-learnings.md`（错误/踩坑也是经验），不再生成 `errors.md`
6. **项目级跨月去重**：项目级去重范围是同一项目 `.knowledge/` 下所有 `YY-MM-*.md` 文件，而不是仅当前月文件
7. **项目级 count/时间与迁移**：首次沉淀时 `发现时间=更新时间=当前日期`（Asia/Shanghai）；命中已有条目时 `计数 += MEMORY.count`、发现时间不变、更新时间=当前日期；若更新时间月份变化，必须把该条目从旧月文件移动到当前月文件
8. **不排序**：不需要手动排序，计数自然维护优先级
9. **不清理**：低频知识自然沉底，不删除
10. **不查重写入时**：写入时不查重，cron 整理时再匹配
11. **knowledge 主账本**：knowledge 是全量知识主账本，所有记忆最终以下沉/合并到 knowledge 为准
12. **MEMORY Top30 投影层**：MEMORY 不是全量保留层，而是 Top30 高频投影层
13. **低频下沉**：`count=1` 条目会在夜间整理时移入 knowledge 并从 MEMORY 清除
14. **Promo 受限**：knowledge 条目只有满足以下规则，才允许进入或重新 promo 回 MEMORY：
    - 当 MEMORY 未满 30 条时，只要 `count >= 2`
    - 当 MEMORY 已满 30 条时，新 promo 条目 `count` 必须严格大于当前第 30 位；等于不允许进入
15. **最终态约束**：MEMORY 最终只保留 Top30，且所有保留项 `count` 必须 `>= 2`

## MEMORY.md 表格格式

Agent 写入 MEMORY.md 时的格式：

```markdown
| 标题 | 内容 | 计数 |
|------|------|------|
| 新知识标题 | 简要描述 | 1 |
```

## 变更历史

- **v3.2.1** (2026-05-10): 项目级 knowledge 改为按 `YY-MM` 分桶；项目级条目去掉来源/项目字段；项目级跨月去重与按更新时间迁移
- **v3.2.0** (2026-04-25): 明确 knowledge 为全量主账本、MEMORY 为 Top30 高频投影层；写死 promo 规则：未满 30 条需 `count >= 2`，已满 30 条需严格大于第 30 位
- **v3.1.0** (2026-04-10): 支持项目级 scope 知识存储。项目知识写入 `.projects/{project}/.knowledge/`，全局知识保持写入 `.knowledge/`
- **v3.0.0** (2026-04-07): 完全重写。去掉生命周期管理、优先级、去重流程；简化为计数驱动；加入来源和项目标签；不再按月分目录
- **v2.1.0** (2026-03-25): 添加条目生命周期管理
- **v2.0.0** (2026-03-16): 合并 self-improving-agent 和 knowledge-synthesizer
- **v1.0.0**: 初始版本
