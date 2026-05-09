# gov-notice-daily-scraper - Project Memory

| 标题 | 内容摘要 | 计数 |
|------|---------|------|
| gov-notice 每日抓取流水线重构与 cron 手动触发结果 | 已完成 run_daily 存储重构：从按日目录改为按月目录+按站点文件 (`output/YYYY-MM/{siteId}.json`) 并按 URL 去重；新增阶段函数 path: `save_site_monthly`、`get_today_announcements`，并更新 phase1/phase2/phase3。`openclaw cron` 手动触发 `daily-gov-notice-v2` 时应使用完整 UUID，不支持按 name；job id 为 `a5efcd08-372e-4fd6-b4bd-6e69fd238da0`。触发命令：`openclaw cron run a5efcd08-372e-4fd6-b4bd-6e69fd238da0`（注意：必须用 UUID，不支持 job name） 查看运行历史：`openclaw cron runs --id a5efcd08-372e-4fd6-b4bd-6e69fd238da0 --limit 5` | 1 |
| 思明区科技和工信局 URL 变更 | siteId: siming_gov_cn。原始URL http://www.siming.gov.cn/gbmzl/kjhxxhj/ 已404，正确路径为 http://www.siming.gov.cn/zfxxgkzl/gbmxxgk/kjhxxhj/zfxxgkml/ 。局名从"科技和信息化局"变更为"科技和工信局"。CSS选择器: div.list ul li > a[title] + span。2026-05-03补抓成功，规则已更新。 | 1 |
| 厦门市建设局域名失效 | siteId: js_xm_gov_cn。域名 js.xm.gov.cn DNS解析失败(NXDOMAIN)，网站已下线。测试了6个替代子域名均不可用。建议从定时抓取配置中移除或标注停用。确认时间: 2026-05-04。 | 1 |
| 集美区科学技术局域名失效，迁移至主站 | siteId: iqb_jimei_gov_cn。原域名 iqb.jimei.gov.cn DNS失效(NXDOMAIN)，内容已迁移至主站 http://www.jimei.gov.cn/zfxxgk/001/XM03103/XM03103/（区科技和工信局/台商投资区）。规则已更新。确认时间: 2026-05-04。 | 1 |
| scraper-agent 输出格式不一致问题 | scraper-agent 有时会将站点 JSON 写成裸列表格式（`[...]`）而非标准字典格式（`{"siteId": "...", "announcements": [...]}`）。stage2_results 文件也可能写成裸列表而非 `{"date": "...", "stage": 2, "results": [...]}`。Phase 3 的 `save_site_monthly` 函数依赖 dict 格式，遇到 list 会报 `AttributeError: 'list' object has no attribute 'get'`。修复方法：在 Phase 3 执行前检查所有站点文件格式，或增强 `save_site_monthly` 兼容两种格式。 | 1 |
| GitHub Pages 日期原则不使用抓取日期 | 用户明确要求：当前 GitHub Pages 的日期原则不需要补充/暴露抓取日期（sourceDate/抓取日期不应作为页面主要日期原则）。页面日期体验应围绕公告发布日期/用户选择日期本身设计；如需解决某日无内容，应通过每日数量标注、最近前后有数据日期提示等 UX 方式处理，避免把“抓取日期”混入用户可见逻辑。 | 1 |
| Output 目录与页面日期原则 | 用户明确要求：1）GitHub Pages 条目上不能显示抓取日期；2）日历条目统计不能以抓取日期为目标，必须以公告发布日期为统计/筛选原则；3）output 文件夹的老记录需要迁移成新的格式；4）output 需要区分 notice data 文件夹和 report 文件夹，不要混杂；notice data 当前按月区分，report 应按天区分。 | 1 |
| 抓取规则文件可提交 | 用户确认：gov-notice-daily-scraper 项目的所有抓取规则文件都可以提交。规则在本地运行；远端主要用于代码同步和 GitHub Pages，因此后续不要把 config/rules/*.json 当作无关改动排除。 | 1 |
| daily output 忽略、monthly output 推送 | 用户确认：gov-notice-daily-scraper 中 daily output 的不必要内容应通过 .gitignore 忽略，而不是每次提交时人工审查；monthly output 仍需要推送，因为它是 GitHub Pages 的数据源。实践上应保留/提交 output/notices/{month}/ 等月度数据，忽略 output/reports/{date}/、output/crawl-artifacts/{date}/ 等日级报告/中间产物，具体以项目目录协议为准。 | 1 |
