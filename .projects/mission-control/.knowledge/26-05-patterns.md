# mission-control - 26-05 Patterns

### [KN-20260510-001] MC 完整架构

- **计数**: 1
- **标签**: architecture, backend, frontend, lifecycle, gateway
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
MC 后端架构为 FastAPI + SQLModel + Next.js。核心三角是 Board → Agent → Task。API 层包含 30+ 路由，Service 层包含 `openclaw/` 子目录下的 `provisioning_db`、`lifecycle_orchestrator`、`gateway_rpc`、`session_service`、`gateway_dispatch` 等模块。Agent 生命周期为 `create → provisioning → online ↔ offline`。Task 流转为 `inbox → in_progress → review → done`。通知通过 `GatewayDispatchService → chat.send`。MC 使用 `sessions.patch(ensure_session)` 创建 session，并自行拼接 session key（`agent:mc-{UUID}:main`），不向 Gateway 传 `agentId`。

#### 影响
后续维护 mission-control 架构、生命周期与 Gateway session 创建逻辑时，应以此作为项目级事实基线。

---

### [KN-20260510-002] MC Board Worker 创建流程

- **计数**: 1
- **标签**: board-worker, api, auth, session-key
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
创建 board worker 必须使用 board-lead 的 session key 作为认证 token，通过 `POST /api/v1/agent/workers` API 创建，并在 Header 中使用 `X-Agent-Token`。不能使用 admin Bearer token 直接调用普通 agent 创建 API，否则生成的 session key 格式会错误，可能生成 board-leader 格式而不是 board-worker 格式。

#### 影响
后续自动化创建 worker 或排查 worker session key 异常时，应优先检查认证 token 来源与 API 路径。

---

### [KN-20260510-004] Browser Agent 使用 browserOS MCP 工具

- **计数**: 1
- **标签**: browser-agent, browseros, mcp, ui-testing
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
browser-agent 使用 browserOS MCP 工具进行浏览器自动化测试，常用工具包括 `browseros__navigate_page`、`browseros__take_screenshot`、`browseros__click`、`browseros__fill`、`browseros__press_key`、`browseros__take_snapshot`、`browseros__get_page_content` 等。所有 UI 验证必须通过 browserOS MCP 工具完成，不能用 curl 替代。

#### 影响
后续 mission-control 的 UI 验证或浏览器自动化任务应走 browserOS MCP 工具链，避免用 HTTP 请求替代真实 UI 行为。
