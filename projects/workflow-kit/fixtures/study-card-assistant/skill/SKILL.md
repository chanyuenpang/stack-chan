---
name: study-card-assistant
version: 0.1.0
description: "当用户要求把公开或虚构学习材料整理成问答学习卡片时，使用本技能提炼核心概念、问题、答案、提示和复习顺序，并保持无联网、无本地文件读取、无外发的安全边界。"
metadata:
  fixtureId: study-card-assistant
  fixtureVersion: 0.1.0
  profile: simple
  language: zh-CN
  tags:
    - study-card
    - qa
    - learning
  permissions:
    network: false
    externalSend: false
    fileRead: false
    fileWrite: false
    destructiveOperations: false
    privatePathRead: false
  dependencies:
    noneDeclared: true
    items: []
  privacy:
    sourceTypes:
      - public
      - fictional
      - synthetic
    realPersonalDataAllowed: false
  compatibility:
    staticValidatorOnly: true
    runtimeReplay: pending
    crossPlatform: pending
    crossModel: pending
---

# 学习卡片整理助手

## 使用场景

当用户提供公开、虚构或合成的学习材料，并要求整理学习卡片、生成问答卡片、制作复习卡、提炼概念问答或安排复习顺序时，使用本技能。

## 输入要求

- 用户直接粘贴的公开百科式概念、虚构短文、合成学习材料或已脱敏复习提纲
- 可选提供卡片数量、难度顺序、输出语言或重点关注方向
- 不要求、不读取、不推断任何本地文件、私有课程链接、真实学生资料、账号、访问令牌、密钥或私人凭证

## 输出格式

请用 Markdown 输出：

1. **材料范围**：说明仅基于用户提供的公开、虚构或合成材料整理。
2. **学习卡片列表**：每张卡片包含问题、答案、提示，可选包含难度和易错点。
3. **复习顺序建议**：按基础概念、关键关系、应用或用户指定难度排列。
4. **不确定项**：材料没有提供的信息标注“材料未提供”或“无法从材料判断”。

示例卡片结构：

```markdown
### 卡片 1｜easy
- 问题：……
- 答案：……
- 提示：……
- 易错点：……
```

## 权限边界

默认保守：

- 不联网
- 不读取本地文件
- 不写文件
- 不外发
- 不调用外部服务
- 不做删除、覆盖、配置修改等破坏性操作
- 不生成或猜测真实学生、学校、教师、账号、私有链接、密钥、凭证

如果用户请求读取本地材料、访问私有课程链接、处理账号凭证、保存文件、外发卡片，或提供疑似真实个人学习记录，应拒绝该部分请求，并建议用户提供已脱敏、公开或虚构的学习材料。

## 依赖声明

本技能无外部依赖；不需要网络、外部 API、私有包、本地文件系统访问或平台外工具。

## 静态检查清单

- structure：技能包含 frontmatter、profile、触发说明、输入输出与边界；simple profile 仅使用单个 `skill/SKILL.md`。
- trigger：中文触发语义覆盖学习材料到问答学习卡片的转换，避免会议类主题。
- boundary：权限边界保守且明确拒绝副作用。
- dependency：无外部服务、无私有数据源依赖。
- replay：配套 replay-cases.yaml 仅设计用例，不伪造运行结果。
- privacy：仅处理公开、虚构或合成材料，拒绝敏感信息。
- compatibility：Markdown 正文与 YAML frontmatter 可被静态 MVP 解析；runtime replay、跨平台、跨模型均 pending。
