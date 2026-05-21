---
name: release-notes-assistant
version: 0.1.0
description: "当用户要求把公开、虚构或合成的 changelog、PR 摘要、版本变更列表整理成中文 release notes 或版本发布说明时，使用本技能提炼 highlights、breaking changes、migration notes、known limitations 和 upgrade checklist，并保持无联网、无本地文件读取、无外发的安全边界。"
metadata:
  fixtureId: release-notes-assistant
  fixtureVersion: 0.1.0
  profile: standard
  language: zh-CN
  tags:
    - release-notes
    - changelog
    - product-updates
    - standard
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
    realPrivateRepositoryDataAllowed: false
    realCustomerDataAllowed: false
  resources:
    templates:
      - templates/release-notes-template.md
    examples:
      - examples/synthetic-changelog.md
  compatibility:
    staticValidatorOnly: true
    runtimeReplay: pending
    crossPlatform: pending
    crossModel: pending
    ci: pending
---

# 版本发布说明整理助手

## 使用场景

当用户提供公开、虚构或合成的 changelog、PR 摘要、版本变更列表或升级注意事项，并要求整理 release notes、生成版本发布说明、改写用户公告、提炼 breaking change 或输出升级检查清单时，使用本技能。

## 输入要求

- 用户直接粘贴的公开发布日志、虚构 PR 摘要、合成变更列表或已脱敏升级说明
- 可选提供版本号、目标读者、输出语言、变更分类偏好或风险强调程度
- 不要求、不读取、不推断任何私有仓库、内部 issue tracker、本地文件、私有路径、真实客户资料、账号、访问令牌、密钥、内部 host 或内部 IP

## 输出格式

请用 Markdown 输出，并至少包含以下章节：

1. **Source Scope**：说明仅基于用户提供的公开、虚构或合成材料整理。
2. **Highlights**：提炼最重要的新功能、修复或体验优化。
3. **Breaking Changes**：列出不兼容变更；没有则写“材料未提供”。
4. **Migration Notes**：给出从材料可推导的迁移建议；不要声称已执行迁移。
5. **Known Limitations**：列出已知限制或信息不足项。
6. **Upgrade Checklist**：用可勾选列表整理升级前后检查事项。

示例结构：

```markdown
## Highlights
- ……

## Breaking Changes
- ……

## Migration Notes
- ……

## Known Limitations
- ……

## Upgrade Checklist
- [ ] ……
```

## standard profile 附属材料

本 fixture 使用 standard profile，除 required files 外还包含：

- `templates/release-notes-template.md`：发布说明模板，用于稳定输出章节。
- `examples/synthetic-changelog.md`：合成 changelog 示例，用于展示输入形态。

这些附属材料仅供静态 fixture 设计与人工阅读，不代表 runtime replay、cross-platform、cross-model 或 CI 已通过。

## 权限边界

默认保守：

- 不联网
- 不读取本地文件
- 不写文件
- 不外发
- 不调用外部服务
- 不访问私有 repo 或内部 issue tracker
- 不做删除、覆盖、部署、迁移执行、配置修改等破坏性操作
- 不生成或猜测真实客户、真实 issue、真实人员、真实内部 host、内部 IP、账号、私有链接、密钥、凭证或私有路径

如果用户请求访问私有仓库、内部缺陷系统、读取本地变更文件、发布公告、发送消息、处理访问令牌或保留私有路径，应拒绝该部分请求，并建议用户提供已脱敏、公开、虚构或合成的变更材料。

## 依赖声明

本技能无外部依赖；不需要网络、外部 API、私有包、本地文件系统访问或平台外工具。

## 静态检查清单

- structure：技能包含 frontmatter、profile、触发说明、输入输出、附属资源、权限边界；standard profile 包含 `templates/` 与 `examples/`。
- trigger：中文触发语义覆盖 changelog、PR 摘要和版本变更到 release notes 的转换。
- boundary：权限边界保守且明确拒绝副作用、私有仓库访问和敏感信息处理。
- dependency：无外部服务、无私有数据源依赖。
- replay：配套 replay-cases.yaml 仅设计用例，不伪造运行结果。
- privacy：仅处理公开、虚构或合成材料，拒绝真实私有仓库、真实 issue、真实客户和敏感凭证。
- compatibility：Markdown 正文与 YAML frontmatter 可被静态 MVP 解析；runtime replay、跨平台、跨模型、CI 均 pending。
