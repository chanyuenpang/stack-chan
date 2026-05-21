# Meeting Summary Assistant Fixture

fixtureId: meeting-summary-assistant
fixtureVersion: 0.1.0

这是一个公开、虚构、最小化的 SkillForge 静态 MVP fixture，用于描述“会议纪要整理助手”的生成与静态验证样例。

## 目标

将公开/虚构的会议记录整理为结构化纪要，包含：

- 会议主题
- 关键结论
- 待办事项
- 风险与阻塞
- 后续跟进建议

## 文件清单

- `workflow-source.yaml`：虚构工作流源需求
- `skill-spec.yaml`：技能规格说明
- `generation-run.yaml`：静态生成运行记录
- `skill-manifest.yaml`：技能清单，入口指向 `skill/SKILL.md`
- `replay-cases.yaml`：回放用例设计，仅保留 pending 结果
- `validation-result.yaml`：静态验证 pending 结果
- `skill/SKILL.md`：技能正文与触发说明

## 权限边界

默认保守：不联网、不外发、不写文件、不做破坏性操作、不读取私有路径。输入材料必须是公开或虚构会议记录，不包含真实联系人、真实链接、密钥、内部路径或私人凭证。

## Checklist 覆盖

本 fixture 覆盖 7 维静态检查：structure、trigger、boundary、dependency、replay、privacy、compatibility。
