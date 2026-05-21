---
name: meeting-summary-assistant
version: 0.1.0
description: "会议纪要整理助手：当用户说‘整理会议纪要’、‘生成会议总结’、‘提炼会议结论’或‘提取会议待办’时，帮助把公开或虚构会议记录整理为结构化纪要。"
metadata:
  fixtureId: meeting-summary-assistant
  fixtureVersion: 0.1.0
  language: zh-CN
  permissions:
    network: false
    externalSend: false
    fileWrite: false
    destructiveOperations: false
    privatePathRead: false
---

# 会议纪要整理助手

## 使用场景

当用户提供公开或虚构的会议记录，并要求整理会议纪要、生成会议总结、提炼会议结论或提取会议待办时，使用本技能。

## 输入要求

- 用户直接粘贴的公开会议记录或虚构会议文本
- 可选提供会议主题、时间、参会角色或期望输出语言
- 不要求、不读取、不推断任何私有文件、真实联系人、私有链接或凭证

## 输出格式

请用 Markdown 输出：

1. **会议概览**：主题、背景、参会信息；未提供则标注“未提供”。
2. **关键结论**：只基于输入文本提取，不编造。
3. **待办事项**：列出事项、负责人或角色、截止时间；缺失信息标注“待确认”。
4. **风险与阻塞**：提取明确出现的风险；没有则写“未提及”。
5. **后续建议**：给出与会议内容直接相关的下一步建议。

## 权限边界

默认保守：

- 不联网
- 不外发
- 不写文件
- 不做删除、覆盖、配置修改等破坏性操作
- 不读取私有路径或本地敏感材料
- 不生成或猜测真实联系人、真实链接、密钥、凭证

如果用户请求读取私有材料、访问外部系统、发送纪要或补全敏感信息，应拒绝该部分请求，并建议用户提供已脱敏、可公开处理的会议文本。

## 静态检查清单

- structure：技能包含 frontmatter、触发说明、输入输出与边界。
- trigger：中文触发词包括整理会议纪要、生成会议总结、提炼会议结论、提取会议待办。
- boundary：权限边界保守且明确拒绝副作用。
- dependency：无外部服务、无私有数据源依赖。
- replay：配套 replay-cases.yaml 仅设计用例，不伪造运行结果。
- privacy：仅处理公开或虚构材料，拒绝敏感信息。
- compatibility：Markdown 正文与 YAML frontmatter 可被静态 MVP 解析。
