# SkillForge schema engine lightweight design

## Purpose

Milestone C 先补一层最小结构 gate，目标不是引入完整 schema engine，而是在现有 static validator 前后之间加一层轻量结构校验，尽早拦住明显 malformed 的 fixture 对象。

这层设计解决的是“结构像不像样”，不是“语义是否真实成立”。小龙虾版总结：先把门框装上，再谈精装修。

## Scope

当前 prototype 只覆盖两个 target object：

1. `skill-manifest.yaml`
2. `replay-cases.yaml`

不在本轮范围内：

- `workflow-source.yaml`
- `skill-spec.yaml`
- `generation-run.yaml`
- 完整 report entry schema
- 第三方 schema 库
- 独立 JSON Schema 文件
- 重写现有 validator / reporter / loader

## Target priority

当前优先级明确为：

1. `skill-manifest` >
2. `replay-cases` >
3. report fixture entry（仅保留为后续候选，不在本 prototype 实现）

原因：

- manifest 决定 fixture identity、entry、skills 清单和 permissions 基本形状；
- replay-cases 决定 replay honesty 相关输入能否被稳定解释；
- report fixture entry 已有稳定 contract，但比前两者更适合放在后续 schema 扩展阶段统一处理。

## Required / optional / reserved split

### `skill-manifest`

Required:

- `fixtureId`
- `fixtureVersion`
- `kind`
- `skills`（array，且至少 1 项）
- `skills[0].id`
- `skills[0].name`
- `skills[0].version`
- `skills[0].entry`
- `skills[0].description`

Optional:

- `profile`
- top-level `permissions`
- `skills[0].permissions`
- 其他业务字段如 `title`、`tags`、`language`、`resources`、`dependencies`、`checklist`

Reserved / compatibility-only:

- `profile` 当前只做兼容枚举检查：`simple | standard | advanced-reserved`
- profile 不合法时当前 prototype 不阻断，只作为后续扩展位

Permissions structure when present:

- `network`
- `externalSend`
- `fileRead`
- `fileWrite`
- `destructiveOperations`
- `privatePathRead`

若声明了 `permissions`，则以上字段都应为 boolean。

### `replay-cases`

Required:

- `fixtureId`
- `kind`
- `cases`（array，且至少 1 项）
- 对每个 case：
  - `id`
  - `type`
  - `intent`
  - `expectedBehavior`

Optional:

- `profile`
- `input`
- `forbiddenBehavior`
- `observed`
- `passed`
- `privacyNotes`
- `tags`
- `checklist`

Reserved / constrained:

- `type` 当前仅接受 `positive | negative | edge`
- `observed` 若存在，可为 `null`、boolean 或非空字符串
- `passed` 若存在，可为 `null` 或 boolean

## Relationship with the existing validator

这层 schema gate：

- **补结构**，不替代语义规则；
- **提前发现 malformed data**，但不改写已有 replay honesty、privacy、boundary、dependency 规则语义；
- **保持现有 rule-based report 模型**，只是在 validator 中多插入 2 条 P1 check。

换句话说：

- schema gate 回答“字段形状是否最小可用”；
- 现有规则继续回答“这个 skill 是否越界、伪造 replay、泄露隐私、缺少 checklist、报告是否兼容”。

## Prototype boundary

当前 prototype 明确只做：

- `src/skillforge/schema.mjs`
- `skill-manifest` minimal structure validation
- `replay-cases` minimal structure validation
- 集成到现有 validator，新增 2 条 P1 checks

当前 prototype 明确不做：

- schema DSL
- schema registry 自动发现
- recursive generic validator framework
- JSON Schema export/import
- AJV / joi / zod / valibot 等依赖
- profile blocking rule
- report schema full enforcement
- loader/parser 重写

## Non-goals / explicit not-do list

本轮明确不做清单：

- 不新增 JSON Schema 文件
- 不引入第三方依赖
- 不修改 fixtures 内容
- 不覆盖 `workflow-source.yaml` / `skill-spec.yaml` / `generation-run.yaml`
- 不把 profile enum 变成阻断失败
- 不把 schema gate 伪装成完整 schema engine
- 不改变现有 replay honesty 语义

## Why this is enough for Milestone C

Milestone C 的目标不是一次性把 schema 全做完，而是验证一个轻量方向：

- 规则系统继续保留；
- schema 只补最脆弱、最值得先守门的两个对象；
- 正例 fixtures 继续通过；
- contract baseline 可以稳定演进到 17 checks / fixture、51 total checks。

这给后续真正的 schema 扩展留出了干净接口，同时不会把当前 static MVP 一口气改成另一套系统。
