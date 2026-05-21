# Release Notes Assistant Fixture

fixtureId: release-notes-assistant
fixtureVersion: 0.1.0
profile: standard

这是一个公开、虚构、合成的 SkillForge standard profile fixture，用于描述“版本发布说明整理助手 / Release Notes Assistant”的静态样例。它把用户直接提供的合成 changelog、虚构 PR 摘要或公开版本变更列表整理成面向用户的中文发布说明。

## 目标

将公开、虚构或合成的版本变更材料整理为结构化 release notes，输出包含：

- highlights
- breaking changes
- migration notes
- known limitations
- upgrade checklist
- 可选的用户可读变更说明与风险提醒

## 文件清单

- `README.md`：fixture 目标、profile、文件清单、隐私边界和 checklist 覆盖
- `workflow-source.yaml`：公开/虚构/合成发布材料的工作流源需求
- `skill-spec.yaml`：技能规格说明
- `generation-run.yaml`：静态生成运行记录
- `skill-manifest.yaml`：技能清单，入口指向 `skill/SKILL.md`
- `replay-cases.yaml`：回放用例设计，仅保留 pending 结果
- `validation-result.yaml`：静态验证 pending 结果
- `skill/SKILL.md`：技能正文与触发说明
- `templates/release-notes-template.md`：standard profile 附属发布说明模板
- `examples/synthetic-changelog.md`：standard profile 附属合成 changelog 示例

## 材料来源声明

仅使用 public、fictional 或 synthetic 内容：公开发布日志片段、虚构 PR 摘要、合成版本变更列表、无真实组织或客户身份的示例文本。不得包含真实私有 repo、真实 issue、真实客户、真实内部 host 或 IP、访问令牌、密钥、账号凭证、私有路径或未授权内部资料。

## 权限边界

默认保守：不联网、不读取本地文件、不写文件、不外发、不调用外部服务、不做破坏性操作。用户必须直接粘贴可公开处理且已脱敏的变更材料；如果请求访问私有仓库、内部缺陷系统或处理敏感凭证，应拒绝该部分并要求提供公开、虚构或合成材料。

## 静态验证与 replay 状态

本 fixture 只声明 static-only 设计与待验证状态。`replay-cases.yaml` 中每个 case 的 `observed` 与 `passed` 均保持 `null`，不表示真实模型回放已经执行或通过；也不代表 cross-platform、cross-model 或 CI 通过。

## Checklist 覆盖

本 fixture 覆盖 7 维静态检查：structure、trigger、boundary、dependency、replay、privacy、compatibility。standard profile 通过 `templates/` 与 `examples/` 展示比 simple 更丰富的附属材料，但仍保持无外部依赖与无副作用。