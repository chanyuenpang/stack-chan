# Study Card Assistant Fixture

fixtureId: study-card-assistant
fixtureVersion: 0.1.0
profile: simple

这是一个公开、虚构、最小化的 SkillForge 静态 MVP fixture，用于描述“学习卡片整理助手”的生成与静态验证样例。它把公开、虚构或合成学习材料整理成问答学习卡片，帮助用户复习概念、定义、对比点和易错点。

## 目标

将公开/虚构/合成学习材料整理为结构化 Q&A 学习卡片，包含：

- 核心问题
- 简洁答案
- 复习提示
- 难度或顺序建议
- 易错点提醒

## 文件清单

- `README.md`：fixture 目标、profile、文件清单、隐私边界和 checklist 覆盖
- `workflow-source.yaml`：公开/虚构/合成学习材料的工作流源需求
- `skill-spec.yaml`：技能规格说明
- `generation-run.yaml`：静态生成运行记录
- `skill-manifest.yaml`：技能清单，入口指向 `skill/SKILL.md`
- `replay-cases.yaml`：回放用例设计，仅保留 pending 结果
- `validation-result.yaml`：静态验证 pending 结果
- `skill/SKILL.md`：技能正文与触发说明

## 材料来源声明

仅使用 public、fictional 或 synthetic 内容：公开百科式概念、虚构短文、合成学习材料、无真实身份的示例段落。不得包含真实学生、学校、教师、班级、账号、成绩、邮箱、手机号、私有课程链接、未授权教材全文、内部资料、访问令牌 或私人凭证。

## 权限边界

默认保守：不联网、不读取本地文件、不写文件、不外发、不调用外部服务、不做破坏性操作。用户必须直接提供可公开处理的材料；如果材料疑似包含个人学习记录或私有资料，应要求用户改为提供脱敏、公开或虚构内容。

## 静态验证与 replay 状态

本 fixture 只声明静态设计与待验证状态。`replay-cases.yaml` 中的 `observed` 与 `passed` 均保持 `null`，不表示真实模型回放已经执行或通过；跨平台与跨模型兼容也保持 pending。

## Checklist 覆盖

本 fixture 覆盖 7 维静态检查：structure、trigger、boundary、dependency、replay、privacy、compatibility。
