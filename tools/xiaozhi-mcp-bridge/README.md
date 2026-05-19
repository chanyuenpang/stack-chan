# XiaoZhi MCP Bridge（最小安全验证版）

这个目录提供一个**最小、安全边界明确**的 XiaoZhi MCP bridge，用于验证 XiaoZhi MCP 侧能否发现并调用基础工具，并额外暴露两个低权限、只读的 OpenClaw plan 状态查询工具。

当前暴露 5 个工具：

- `ping`：测试 MCP / bridge 是否在线，返回 `pong`
- `echo`：原样返回 `arguments.text`，最大 1024 字符
- `get_time`：返回当前 `Asia/Shanghai` 时间
- `get_plan_status`：读取脱敏后的本地 plan 状态快照，只返回白名单字段
- `get_latest_completion_event`：读取脱敏后的最新完成事件，并按 TTL 计算当前是否应庆祝

> 这只是 ping / echo / get_time / plan 状态只读验证，不提供设备控制，也不修改 OpenClaw plan。

## 安全边界

本 bridge **不会**暴露以下能力：

- shell / 命令执行
- 文件泛读、目录扫描或路径参数读取
- 文件写入、ack、去重状态写入、plan 修改
- OpenClaw workspace 原始 plan / task 目录读取
- 记忆库访问
- 消息发送
- 设备控制
- OpenClaw 内部管理或高权限能力

Plan 状态工具只读取一个明确的、脱敏后的最小 JSON 状态文件：

- 默认：bridge 目录下 `state/plan_status.json`
- 可用环境变量覆盖：`XIAOZHI_PLAN_STATE_FILE=/absolute/path/to/file.json`

`XIAOZHI_PLAN_STATE_FILE` 安全限制：

- 必须是绝对路径
- 必须以 `.json` 结尾
- 必须指向具体文件
- 不能通过 `tools/call` 参数指定路径
- 文件最大 64KB

返回结果会做白名单投影，不返回 `detail`、token、session id、私密路径、subagent 日志等字段。

Token 只允许通过环境变量读取：

- `XIAOZHI_MCP_TOKEN`：真实连接时必填，XiaoZhi MCP token
- `XIAOZHI_MCP_BASE_URL`：可选，默认 `wss://api.XiaoZhi.me/mcp/`
- `XIAOZHI_MCP_DRY_RUN=1`：可选，只打印工具列表，不连接网络，不读取 token
- `XIAOZHI_MCP_DEBUG=1`：可选，打印脱敏 MCP 收发流程日志（也可用 `--debug`）
- `XIAOZHI_PLAN_STATE_FILE=/absolute/path/to/file.json`：可选，覆盖只读状态文件位置

日志会脱敏：

- 不打印 token 内容；只输出 set/unset 与长度
- 不打印带完整 query string 的 WebSocket URL
- debug 日志不打印完整 `params`；`tools/call` 只打印工具名，不打印参数全文
- WebSocket close reason 会做控制字符清理和长度限制

请不要把真实 token 写入源码、README、shell history、提交记录或截图里。

## 状态文件 schema 摘要

状态文件由 OpenClaw 侧其他流程生成；bridge 不修改。默认读取 `state/plan_status.json`。示例（只包含允许 bridge 返回的脱敏字段）：

```json
{
  "plan": {
    "plan_id": "stackchan-celebration-roadmap",
    "plan_title": "StackChan Celebration Roadmap",
    "plan_status": "in_progress",
    "total_tasks": 3,
    "completed_tasks": 1,
    "blocked_tasks": 0,
    "in_progress_tasks": 1,
    "progress_text": "1/3 completed",
    "tasks": [
      { "id": "task-1", "title": "Prepare", "status": "completed" },
      { "id": "task-2", "title": "Implement", "status": "in_progress" }
    ]
  },
  "latest_completion_event": {
    "event_id": "evt-001",
    "event_type": "task_completed",
    "plan_id": "stackchan-celebration-roadmap",
    "plan_title": "StackChan Celebration Roadmap",
    "task_id": "task-1",
    "task_title": "Prepare",
    "completed_at": "2026-05-15T04:00:00+08:00",
    "ttl_seconds": 300,
    "should_celebrate": true
  }
}
```

`get_plan_status` 的 `text` JSON 返回结构与实现一致：

```json
{
  "state": "ok",
  "plan": {
    "plan_id": "stackchan-celebration-roadmap",
    "plan_title": "StackChan Celebration Roadmap",
    "plan_status": "in_progress",
    "total_tasks": 3,
    "completed_tasks": 1,
    "blocked_tasks": 0,
    "in_progress_tasks": 1,
    "progress_text": "1/3 completed",
    "tasks": [
      { "id": "task-1", "title": "Prepare", "status": "completed" }
    ]
  }
}
```

`get_plan_status` 只返回：

- 顶层 `state`
- `plan.plan_id`
- `plan.plan_title`
- `plan.plan_status`
- `plan.total_tasks`
- `plan.completed_tasks`
- `plan.blocked_tasks`
- `plan.in_progress_tasks`
- `plan.progress_text`
- `plan.tasks[]` 中的 `id/title/status`

`get_latest_completion_event` 的 `text` JSON 返回结构与实现一致：

```json
{
  "state": "ok",
  "should_celebrate": true,
  "event_id": "evt-001",
  "event_type": "task_completed",
  "plan_id": "stackchan-celebration-roadmap",
  "plan_title": "StackChan Celebration Roadmap",
  "task_id": "task-1",
  "task_title": "Prepare",
  "completed_at": "2026-05-15T04:00:00+08:00",
  "ttl_seconds": 300,
  "age_seconds": 12,
  "expires_in_seconds": 288
}
```

`get_latest_completion_event` 只返回：

- `state`
- `should_celebrate`
- `event_id`
- `event_type`
- `plan_id`
- `plan_title`
- `task_id`
- `task_title`
- `completed_at`
- `ttl_seconds`
- `age_seconds`
- `expires_in_seconds`

`should_celebrate` 是 bridge 运行时根据 `completed_at` 与 `ttl_seconds` 重新计算的结果。以下情况会返回 `should_celebrate=false`：

```text
missing event_id
or completed_at missing / unparseable
or completed_at is in the future
or age_seconds >= ttl_seconds
```

状态文件不存在、非法 JSON、文件过大、非法 env 路径等情况会返回：

```json
{
  "state": "state_unavailable",
  "reason": "file_not_found"
}
```

不会崩溃，也不会尝试读取其他路径。

## 运行环境

- Node.js `>= 22`
- 零第三方依赖，使用 Node 内置 `WebSocket`

## 生成脱敏 plan 状态快照（不连接网络、不需要 token）

`scripts/generate-plan-state.mjs` 会读取一个明确指定的 plan JSON 文件，并写出 bridge 可读的脱敏快照到 `state/plan_status.json`。

```bash
node scripts/generate-plan-state.mjs \
  --plan /home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap.json

# 等价 npm script
npm run generate:state
```

可选参数：

- `--plan /absolute/path/to/plan.json`：输入 plan 文件；未传时默认使用当前本地 roadmap fixture。
- `--out /absolute/or/relative/path/to/plan_status.json`：输出文件；默认 `state/plan_status.json`。
- `--no-celebrate`：生成事件但将 `should_celebrate` 设为 `false`。

生成脚本只读取 `--plan` 指向的单个 JSON 文件，不扫描目录、不连接 XiaoZhi endpoint、不读取 `XIAOZHI_MCP_TOKEN`。输出仅包含：

- `plan.plan_id / plan_title / plan_status`
- `total_tasks / completed_tasks / blocked_tasks / in_progress_tasks / progress_text`
- `tasks[]` 中的 `id / title / status`
- `latest_completion_event` 的安全字段

不会输出 `task.detail`、token、session id、subagent 日志、私密路径或原始 OpenClaw 内部字段。

当前脚本会为本地测试生成一个短 TTL 事件：优先使用最后一个已完成任务生成 `event_type="task_completed"`，否则生成 `event_type="snapshot_generated"`；`ttl_seconds=300`。`should_celebrate=true` 仅用于本地 local-call 验证。生产接入时，庆祝事件应由 OpenClaw 的真实 completed 事件生成，而不是由这个快照 fixture 脚本代替。

生成后验证：

```bash
node bridge.mjs --local-call get_plan_status '{}'
node bridge.mjs --local-call get_latest_completion_event '{}'
```

## 写入 OpenClaw completion event（不连接网络、不需要 token）

`scripts/write-openclaw-completion-event.mjs` 是 Task 5 的本地 writer MVP：由 OpenClaw 侧在确认 `task_completed` 或 `plan_completed` 后调用。脚本只读取一个明确指定的 `--plan` JSON 文件，生成脱敏 plan summary，并以原子写入方式刷新 bridge 可读的状态文件。

```bash
# task completed：指定已完成 task id
node scripts/write-openclaw-completion-event.mjs \
  --event task_completed \
  --plan /home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap.json \
  --task-id 3

# 等价 npm script（本地 fixture，不含 token）
npm run write:event

# plan completed：仅当 plan.status 为 done/completed 时允许
node scripts/write-openclaw-completion-event.mjs \
  --event plan_completed \
  --plan /absolute/path/to/plan.json
```

参数与边界：

- `--event task_completed|plan_completed`：必填。
- `--plan /absolute/path/to/plan.json`：必填；必须是绝对路径、`.json`、存在且为普通文件；脚本只读取这一个文件。
- `--out /absolute/path/to/plan_status.json`：可选；未传时使用 `XIAOZHI_PLAN_STATE_FILE`，再退回默认 `state/plan_status.json`；必须是绝对 `.json` 路径。
- `--task-id <id>`：`task_completed` 必填；`plan_completed` 禁止传入。
- `--completed-at <ISO datetime>`：可选；默认当前时间 ISO。
- `--ttl-seconds <int>`：可选；默认 `300`。
- `--help`：打印用法。

输出状态 schema 严格匹配 bridge Task 3：

- 顶层只写 `{ "plan": ..., "latest_completion_event": ... }`
- `plan` 只含 `plan_id / plan_title / plan_status / total_tasks / completed_tasks / blocked_tasks / in_progress_tasks / progress_text / tasks[id,title,status]`
- `latest_completion_event` 只含 `event_id / event_type / plan_id / plan_title / task_id / task_title / completed_at / ttl_seconds / should_celebrate`
- 不写 `has_event`、`latest_event`、`celebration_key`

`event_id` 使用 `node:crypto` SHA-256 生成，格式：

- `oc:v1:task:<hash16>`
- `oc:v1:plan:<hash16>`

hash material 只包含事件类型、plan id/title、task id/title 等脱敏字段；不包含路径、session、token、detail。

去重语义：

- 如果旧状态文件中的 `latest_completion_event.event_id` 与新事件相同，writer 会更新 plan summary，但保留旧 `completed_at` 和 `ttl_seconds`，不延长 TTL。
- bridge 仍然只读，不写 ack、不写去重状态。

写入安全：

- 输出 JSON 必须 `<=64KB`
- 使用同目录临时文件 + `fsync` + `rename`
- 目标文件 mode `0600`
- 写入失败时尽量保留旧文件

脚本不会输出或写入 `detail`、`goal`、`keyDecisions`、`feishuTaskId`、source path、token、session id、memory、subagent 日志或绝对私密路径。stdout 成功时只打印安全摘要。

### `record-completion-event.mjs` strict validation

`record-completion-event.mjs` 是当前 OpenClaw completed 事件写入脚本，支持 `--dry-run`，适合在 orchestrator 确认任务或计划已完成后调用：

```bash
node scripts/record-completion-event.mjs \
  --plan /home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap.json \
  --event-type task_completed \
  --task-id 9 \
  --dry-run

# 等价 npm script（本地 fixture，不含 token）
npm run record:event
```

严格校验：

- `task_completed` 只允许目标 task 的 `status` 为 `done` 或 `completed`。
- `pending`、`in_progress`、`blocked`、`active`、`failed` 或任何其他状态都会拒绝，stderr 包含 `task_not_completed`，exit code 为 `1`。
- `task_id` 不存在时拒绝，stderr 包含 `task_not_found`。
- `plan_completed` 只允许 plan `status` 为 `done` 或 `completed`；当前 active plan 会拒绝，stderr 包含 `plan_not_completed`。
- 拒绝时不会写入或覆盖输出状态文件；`--dry-run` 成功时也不会落盘。

写入后验证：

```bash
node bridge.mjs --local-call get_plan_status '{}'
node bridge.mjs --local-call get_latest_completion_event '{}'
```

## 本机庆祝音效播放（不连接 XiaoZhi、不需要 token）

本目录包含一个原创占位胜利音效：

- `assets/audio/original-victory-fanfare.wav`

它是本地生成的短小 chiptune / fanfare 风格 WAV，用于验证庆祝链路；不是 Final Fantasy 原曲，也没有下载、包含或分发任何受版权保护的素材。

如果你想使用自己合法持有的 Final Fantasy 音频，请在本机提供文件路径。项目不会包含、下载或分发 FF 原曲：

```bash
# 参数方式：使用用户自备本地文件
node scripts/play-completion-audio.mjs --force --audio /absolute/path/to/user-owned-file.wav

# 环境变量方式
STACKCHAN_CELEBRATION_AUDIO=/absolute/path/to/user-owned-file.wav npm run play:audio
```

播放脚本安全边界：

- 默认读取 `state/plan_status.json`，只在 latest event `should_celebrate=true` 且未超过 `ttl_seconds` 时播放（`--once`）。
- `--force` 不读状态，直接播放，适合测试音量。
- `--dry-run` 只打印将使用的音频、播放器、TTL 判定等安全摘要，不播放。
- `--volume 0..100` 控制音量，默认 `35`。
- 自动选择 `paplay` / `aplay` / `ffplay` / `mpv` / `cvlc` 中 PATH 里可用的播放器；不会安装依赖。
- 音频路径必须是本地普通文件；拒绝 URL、目录和设备文件。
- 脚本不读取 `XIAOZHI_MCP_TOKEN`，不联网，不连接 XiaoZhi，不控制设备。

常用命令：

```bash
# 安全预览，不播放；即使系统没有播放器也应成功
npm run play:audio:dry-run

# 只在最新完成事件仍在 TTL 内时播放
npm run play:audio

# 强制播放默认原创占位音效，测试音量
node scripts/play-completion-audio.mjs --force --volume 35

# 使用用户自备音频强制播放
node scripts/play-completion-audio.mjs --force --audio /absolute/path/to/user-owned-file.wav --volume 35
```

## 本地验证（不连接真实 endpoint）

```bash
node --check bridge.mjs
node --check scripts/start-bridge-debug.mjs
node --check scripts/generate-plan-state.mjs
node --check scripts/record-completion-event.mjs
node --check scripts/write-openclaw-completion-event.mjs
node --check scripts/play-completion-audio.mjs
npm run check
npm run play:audio:dry-run
node bridge.mjs --dry-run
# 或
XIAOZHI_MCP_DRY_RUN=1 node bridge.mjs
XIAOZHI_MCP_DEBUG=1 node bridge.mjs --dry-run
```

`--dry-run` 只打印工具列表，不读取 token，也不会创建 WebSocket 连接。工具列表应包含：`ping`、`echo`、`get_time`、`get_plan_status`、`get_latest_completion_event`。

## 小智 messaging 设备工具探测与 Task 4/19 本地联调入口

`scripts/probe-messaging-tools.mjs` 是 Task 18/19 准备的安全探测脚本，用于用户在本地合法获得 XiaoZhi messaging token 后，列出设备 MCP 工具，并判断是否存在主动发声/提示能力。

已知官方公开前端入口：

- `POST /api/messaging/device/tools/list`
- `POST /api/messaging/device/tools/call`
- Header: `Authorization: Bearer <messaging token>`

这里使用的是设备页 `assets-generator` / `generate-messaging-token` 得到的 **messaging token**，不是 MCP endpoint token（`XIAOZHI_MCP_TOKEN`）。不要把真实 token 发给 agent、聊天窗口、截图、README、代码或提交记录。

安全默认值：

- 默认 `--dry-run` / list-only，不联网。
- token 只从 `XIAOZHI_MESSAGING_TOKEN` 或 `--token-from-stdin` 的 stdin 文本读取。
- 不支持命令行参数直接传 token，避免 shell history 泄漏。
- 不打印、不保存、不写入 token；输出只显示 `token_present` / `token_source` / `token_length`。
- 默认只调用 `tools/list`。
- 不自动调用 `tools/call`。
- 即使使用 `--call`，也只允许显式选择安全只读的 `get/list/read/status/info` 类工具。
- 默认拒绝动作/发声/设备控制类工具，例如 `set_led`、`head`、`reminder`、`audio`、`play`、`speak`、`tts`、`broadcast`。

Task 19：从浏览器 URL/文本通过 stdin 安全提取 token：

```bash
# 1) 无 token / 不联网自检
npm run probe:messaging:dry-run

# 2) 从 assets-generator / generate-messaging-token 页面复制 URL 或文本后，stdin dry-run
#    不联网，只显示 token_present 与 token_length，不打印 token
printf '%s' '<copied-assets-generator-url-or-token-text>' | \
  node scripts/probe-messaging-tools.mjs --token-from-stdin --dry-run

# 3) npm 内置 dummy URL dry-run，不联网、不含真实 token
npm run probe:messaging:url-dry-run
```

用户现场合法 token 探测工具列表（二选一）：

```bash
# 方式 A：env，兼容旧流程
export XIAOZHI_MESSAGING_TOKEN='<messaging-token-from-console>'
npm run probe:messaging:list

# 方式 B：stdin，一条命令解析 URL/text 后立即 tools/list
printf '%s' '<copied-assets-generator-url-or-token-text>' | \
  node scripts/probe-messaging-tools.mjs --token-from-stdin --live
```

输出会列出工具名、描述摘要、参数摘要，并标记候选关键词：

```text
speak, tts, audio, play, sound, speaker, reminder, notification, broadcast
```

判断分支：

- 若存在 `speak` / `tts` / `audio` / `play` / `sound` 相关工具：先不要调用；记录工具名、描述和 input summary，再人工评估是否属于安全只读或动作工具。
- 若存在 `reminder` / `notification` 相关工具：可作为提示音/通知候选，但仍不要自动调用动作工具。
- 若只存在只读状态工具，例如 `self.get_device_status` / `self.get_system_info` / `self.screen.get_info`：说明当前公开工具不能主动发声，Task 4 应降级到 LED/head/reminder（如官方 UI 或小智自然对话可触发）或外部音频旁路。
- 若没有命中候选关键词：按 Task 13/16 的外部音频旁路方案推进，同时保留小智自然对话 TTS 作为人工触发路径。

显式调用安全只读工具示例（不会自动调用动作类工具）：

```bash
XIAOZHI_MESSAGING_TOKEN='<messaging-token-from-console>'   node scripts/probe-messaging-tools.mjs --call self.get_device_status
```

常见错误处理：

- token 未设置：脚本输出 `no_token_dry_run`，不联网。
- `HTTP 401/403`：token 无效、过期，或误用了 MCP endpoint token。
- 非 JSON 响应：脚本只打印短预览。
- 网络异常：脚本失败退出，不重试、不执行动作工具。

> 注意：该脚本只是能力探测工具，不提供官方未公开的 send-message/TTS broadcast API，也不确认任何 speak/play_audio 工具一定存在；实际能力以用户本地 token 返回的工具列表为准。旧的 `probe-device-messaging-tools.mjs` 仅保留兼容，不再作为推荐入口。

## Local-call fixture 测试（不连接网络、不需要 token）

`--local-call <toolName> <jsonArgs>` 会在本地调用白名单工具并输出 JSON；不会读取 `XIAOZHI_MCP_TOKEN`，不会连接 XiaoZhi endpoint。

```bash
TMP_STATE="$(mktemp --suffix=.json)"
cat > "$TMP_STATE" <<'JSON'
{
  "plan": {
    "plan_id": "stackchan-celebration-roadmap",
    "plan_title": "StackChan Celebration Roadmap",
    "plan_status": "in_progress",
    "total_tasks": 2,
    "completed_tasks": 1,
    "blocked_tasks": 0,
    "in_progress_tasks": 1,
    "progress_text": "1/2 completed",
    "tasks": [
      { "id": "task-1", "title": "Prepare", "status": "completed", "detail": "not returned" },
      { "id": "task-2", "title": "Implement", "status": "in_progress" }
    ]
  },
  "latest_completion_event": {
    "event_id": "evt-001",
    "event_type": "task_completed",
    "plan_id": "stackchan-celebration-roadmap",
    "plan_title": "StackChan Celebration Roadmap",
    "task_id": "task-1",
    "task_title": "Prepare",
    "completed_at": "2099-01-01T00:00:00+08:00",
    "ttl_seconds": 300,
    "should_celebrate": true,
    "detail": "not returned"
  }
}
JSON

XIAOZHI_PLAN_STATE_FILE="$TMP_STATE" node bridge.mjs --local-call get_plan_status '{}'
XIAOZHI_PLAN_STATE_FILE="$TMP_STATE" node bridge.mjs --local-call get_latest_completion_event '{}'
```

边界测试示例：

```bash
# 状态文件不存在：安全返回 state="state_unavailable" + reason
XIAOZHI_PLAN_STATE_FILE=/tmp/not-exist-plan-status.json \
  node bridge.mjs --local-call get_plan_status '{}'

# 非绝对路径：安全返回 state="state_unavailable" + reason
XIAOZHI_PLAN_STATE_FILE=relative.json \
  node bridge.mjs --local-call get_latest_completion_event '{}'

# 非 .json：安全返回 state="state_unavailable" + reason
XIAOZHI_PLAN_STATE_FILE=/tmp/plan-status.txt \
  node bridge.mjs --local-call get_plan_status '{}'
```

## 真实连接方式（需要用户显式执行）

确认 token 安全后，由用户在**本地同一个终端**手动运行：

```bash
cd StackChan/tools/xiaozhi-mcp-bridge
export XIAOZHI_MCP_TOKEN='<new-test-token>'
npm run start:debug
```

也可以直接运行：

```bash
node scripts/start-bridge-debug.mjs
```

`start:debug` 会先做本地安全诊断：检查当前目录存在 `bridge.mjs`、只输出 `XIAOZHI_MCP_TOKEN` 的 set/unset 与长度、摘要检查 `get_latest_completion_event` 的 `should_celebrate/isError`。如果 token 未设置，会拒绝启动并提示在同一终端 `export`；如果 token 已设置，会以前台方式启动 `node bridge.mjs`，并在用户未设置时自动给子进程设置 `XIAOZHI_MCP_DEBUG=1`。

不要截图、发送、提交或保存真实 token；README 里的 `<new-test-token>` 只是占位符。脚本不会把 token 放进命令行参数，不会打印 token 内容，也不会保存 token。

## Debug 诊断（脱敏 MCP 流程）

如果 WebSocket 显示 connected，但 XiaoZhi App Access Point Status 仍是 Offline，优先使用：

```bash
npm run start:debug
```

观察日志里是否依次出现：

- `<- method=initialize` 与对应 `-> ... result`
- `<- method=notifications/initialized ... notification=true`
- `<- method=tools/list` 与 `-> ... result tools count=5`
- 云端可能发送顶层 JSON-RPC `<- method=ping` 用于保活；bridge 会响应对应 `-> id=... result`
- 如云端触发工具调用，应出现 `<- method=tools/call ... tool=<name>` 与对应 `-> ... result/error`

debug 只记录 method、id、notification 状态和工具名，不打印 token、完整 URL、完整 query 或完整参数。

如需指定测试环境地址：

```bash
XIAOZHI_MCP_BASE_URL='wss://example.invalid/mcp/' \
XIAOZHI_MCP_TOKEN='<your-token-here>' \
npm start
```

示例中的 `<your-token-here>` 是占位符，不是真实 token。

## 支持的 JSON-RPC 方法

### `initialize`

返回最小 MCP server 信息：

- `capabilities.tools`
- `serverInfo.name = xiaozhi-mcp-bridge`
- `serverInfo.version = 0.1.0`

### `ping`

云端可能把 `ping` 作为顶层 JSON-RPC request 发送用于保活。带 `id` 的 `ping` 会返回：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": { "ok": true, "message": "pong" }
}
```

无 `id` 的 `ping` notification 会被忽略或仅记录调试日志，不会返回 error。这个顶层 method 与 `tools/call` 中名为 `ping` 的工具是两回事。

### `tools/list`

返回 5 个工具的名称、自然语言调用描述和标准 `object/properties/required` 输入 schema。

### `tools/call`

请求示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_plan_status",
    "arguments": {}
  }
}
```

成功返回 MCP 标准 tool result，`content` 内 item 必须是 `type: "text"`，`text` 是 JSON 字符串（状态工具）或普通文本（`ping` / `echo`）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{\"state\":\"state_unavailable\",\"reason\":\"file_not_found\"}" }],
    "isError": false
  }
}
```

工具执行失败（例如 `echo` 的 `arguments.text` 不是字符串或超过长度限制）优先返回标准 tool error result：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "echo requires arguments.text to be a string" }],
    "isError": true
  }
}
```

未知 method / tool 仍返回 JSON-RPC error。通知类消息（无 `id`）会被记录并忽略，不会导致进程崩溃。

## 实验步骤建议

1. 先运行 `node --check bridge.mjs`。
2. 再运行 `node bridge.mjs --dry-run`，确认工具列表包含五个工具。
3. 用临时状态 JSON 和 `--local-call` 验证两个只读状态工具。
4. 确认没有真实 token 写入文件或日志。
5. 仅在需要联调时，由用户显式设置 `XIAOZHI_MCP_TOKEN` 并执行 `npm start`。
