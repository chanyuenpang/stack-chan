# mission-control - 26-05 Learnings

### [KN-20260510-003] 规范化部署已打通但存在 gateway_restore 非阻塞异常

- **计数**: 1
- **标签**: deployment, gateway_restore, backend, non-blocking-error
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
2026-04-25 mission-control 规范化部署最终验收通过：frontend、backend、db、redis 全部 Up，8000 `/healthz` 返回 200，3001 返回正常 Next.js 页面。遗留一个非阻塞 backend 启动期异常：`TypeError: ModelManager.all() takes 1 positional argument but 2 were given`，发生在 `app.lifecycle.gateway_restore` 恢复网关运行时状态阶段；该异常未阻塞 `Application startup complete` 与健康检查。后续应单独开线修复。

#### 影响
后续排查启动日志时，不应将该异常误判为部署失败；但仍应作为独立技术债修复。
