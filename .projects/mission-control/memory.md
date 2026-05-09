# mission-control - Project Memory

| 标题 | 内容摘要 | 计数 |
|------|---------|------|
| MC 完整架构 | MC 后端架构：FastAPI + SQLModel + Next.js。核心三角：Board → Agent → Task。API层30+路由，Service层含openclaw/子目录（provisioning_db, lifecycle_orchestrator, gateway_rpc, session_service, gateway_dispatch）。Agent生命周期：create→provisioning→online↔offline。Task流转：inbox→in_progress→review→done。通知通过GatewayDispatchService→chat.send。MC用sessions.patch(ensure_session)创建session，自己拼session key（agent:mc-{UUID}:main），不传agentId给Gateway。 | 1 |
| MC Board Worker 创建流程 | 创建 board worker 必须用 board-lead 的 session key 作为认证 token，通过 `POST /api/v1/agent/workers` API 创建，Header 用 `X-Agent-Token`。不能用 admin Bearer token 直接调普通 agent 创建 API，否则 session key 格式会错误（生成 board-leader 而非 board-worker 格式）。 | 1 |
| 规范化部署已打通但存在 gateway_restore 非阻塞异常 | 2026-04-25 mission-control 规范化部署最终验收通过：frontend/backend/db/redis 全部 Up，8000 healthz=200，3001 返回正常 Next.js 页面。遗留一个非阻塞 backend 启动期异常：`TypeError: ModelManager.all() takes 1 positional argument but 2 were given`，发生在 `app.lifecycle.gateway_restore` 恢复网关运行时状态阶段；未阻塞 `Application startup complete` 与健康检查。后续应单独开线修复。 | 1 |
| Browser Agent 使用 browserOS MCP 工具 | browser-agent 使用 browserOS MCP 工具（browseros__navigate_page、browseros__take_screenshot、browseros__click、browseros__fill、browseros__press_key、browseros__take_snapshot、browseros__get_page_content 等）进行浏览器自动化测试，不是 Playwright。所有 UI 验证必须通过 browserOS MCP 工具完成，不能用 curl 替代。 | 1 |
