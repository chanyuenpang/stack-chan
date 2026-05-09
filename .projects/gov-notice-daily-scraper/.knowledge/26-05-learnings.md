# gov-notice-daily-scraper - 26-05 Learnings

### [KN-20260510-001] gov-notice 每日抓取流水线重构与 cron 手动触发

- **计数**: 1
- **标签**: pipeline, cron, storage, dedup
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
已完成 `run_daily` 存储重构：从按日目录改为按月目录 + 按站点文件（`output/YYYY-MM/{siteId}.json`）并按 URL 去重；新增阶段函数 `save_site_monthly`、`get_today_announcements`，并更新 phase1/phase2/phase3。

`openclaw cron` 手动触发 `daily-gov-notice-v2` 时应使用完整 UUID，不支持按 name。job id 为 `a5efcd08-372e-4fd6-b4bd-6e69fd238da0`。

触发命令：`openclaw cron run a5efcd08-372e-4fd6-b4bd-6e69fd238da0`。查看运行历史：`openclaw cron runs --id a5efcd08-372e-4fd6-b4bd-6e69fd238da0 --limit 5`。

#### 影响
后续运行、排障或手动补跑该项目定时任务时，应优先使用 UUID，避免因 name 不支持导致触发失败。

---

### [KN-20260510-002] GitHub Pages 日期原则不使用抓取日期

- **计数**: 1
- **标签**: github-pages, ux, date-policy
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确要求：当前 GitHub Pages 的日期原则不需要补充或暴露抓取日期，`sourceDate` / 抓取日期不应作为页面主要日期原则。页面日期体验应围绕公告发布日期和用户选择日期本身设计。

如需解决某日无内容，应通过每日数量标注、最近前后有数据日期提示等 UX 方式处理，避免把“抓取日期”混入用户可见逻辑。

#### 影响
后续改动页面日期逻辑时，不要把抓取日期作为用户可见筛选、展示或解释的主字段。

---

### [KN-20260510-003] Output 目录与页面日期原则

- **计数**: 1
- **标签**: output, github-pages, date-policy, data-layout
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确要求：
1. GitHub Pages 条目上不能显示抓取日期；
2. 日历条目统计不能以抓取日期为目标，必须以公告发布日期为统计 / 筛选原则；
3. `output` 文件夹的老记录需要迁移成新的格式；
4. `output` 需要区分 notice data 文件夹和 report 文件夹，不要混杂；notice data 当前按月区分，report 应按天区分。

#### 影响
迁移老 output 数据和调整 GitHub Pages 统计时，必须坚持公告发布日期原则，并保持 notice data 与 report 分层。

---

### [KN-20260510-004] 抓取规则文件可提交

- **计数**: 1
- **标签**: git, rules, config
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户确认：gov-notice-daily-scraper 项目的所有抓取规则文件都可以提交。规则在本地运行；远端主要用于代码同步和 GitHub Pages。因此后续不要把 `config/rules/*.json` 当作无关改动排除。

#### 影响
提交代码时，抓取规则更新应纳入版本管理，不应被默认忽略。

---

### [KN-20260510-005] daily output 忽略、monthly output 推送

- **计数**: 1
- **标签**: gitignore, output, github-pages, data-layout
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户确认：gov-notice-daily-scraper 中 daily output 的不必要内容应通过 `.gitignore` 忽略，而不是每次提交时人工审查；monthly output 仍需要推送，因为它是 GitHub Pages 的数据源。

实践上应保留 / 提交 `output/notices/{month}/` 等月度数据，忽略 `output/reports/{date}/`、`output/crawl-artifacts/{date}/` 等日级报告 / 中间产物，具体以项目目录协议为准。

#### 影响
后续维护 `.gitignore` 与提交数据时，按“月度 notice data 提交、日级 report/artifact 忽略”的原则执行。

---

### [KN-20260510-006] 思明区科技和工信局 URL 变更

- **计数**: 1
- **标签**: site-rule, siming_gov_cn, url-change, selector
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
`siteId: siming_gov_cn`。原始 URL `http://www.siming.gov.cn/gbmzl/kjhxxhj/` 已 404，正确路径为 `http://www.siming.gov.cn/zfxxgkzl/gbmxxgk/kjhxxhj/zfxxgkml/`。局名从“科技和信息化局”变更为“科技和工信局”。CSS 选择器：`div.list ul li > a[title] + span`。2026-05-03 补抓成功，规则已更新。

#### 影响
后续维护思明区相关抓取规则时，应使用新路径与新局名。

---

### [KN-20260510-007] 厦门市建设局域名失效

- **计数**: 1
- **标签**: site-rule, js_xm_gov_cn, domain-failure, nxdomain
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
`siteId: js_xm_gov_cn`。域名 `js.xm.gov.cn` DNS 解析失败（NXDOMAIN），网站已下线。测试了 6 个替代子域名均不可用。建议从定时抓取配置中移除或标注停用。确认时间：2026-05-04。

#### 影响
后续定时抓取配置应避免继续请求该失效域名，或显式标记该站点停用。

---

### [KN-20260510-008] 集美区科学技术局域名失效并迁移至主站

- **计数**: 1
- **标签**: site-rule, iqb_jimei_gov_cn, domain-failure, migration
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
`siteId: iqb_jimei_gov_cn`。原域名 `iqb.jimei.gov.cn` DNS 失效（NXDOMAIN），内容已迁移至主站 `http://www.jimei.gov.cn/zfxxgk/001/XM03103/XM03103/`（区科技和工信局 / 台商投资区）。规则已更新。确认时间：2026-05-04。

#### 影响
后续抓取集美区科学技术局 / 区科技和工信局信息时，应使用主站迁移后的路径。

---

### [KN-20260510-009] scraper-agent 输出格式不一致导致 Phase 3 失败

- **计数**: 1
- **标签**: scraper-agent, output-format, phase3, save_site_monthly
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
`scraper-agent` 有时会将站点 JSON 写成裸列表格式（`[...]`），而非标准字典格式（`{"siteId": "...", "announcements": [...]}`）。`stage2_results` 文件也可能写成裸列表，而非 `{"date": "...", "stage": 2, "results": [...]}`。

Phase 3 的 `save_site_monthly` 函数依赖 dict 格式，遇到 list 会报 `AttributeError: 'list' object has no attribute 'get'`。修复方法：在 Phase 3 执行前检查所有站点文件格式，或增强 `save_site_monthly` 兼容两种格式。

#### 影响
排查 Phase 3 保存失败时，应优先检查 scraper-agent 产物结构，并考虑兼容 list / dict 两类输入。
