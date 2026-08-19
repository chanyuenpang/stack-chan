# OpenClaw plan completion hooks for StackChan celebration

## 结论

StackChan 如果要响应 OpenClaw 的 plan task done / plan completed，短期最稳的接入方式不是监听 `planEventListeners`，而是在插件 `after_tool_call` 中过滤成功的 `plan_edit` / `plan_write` 调用，并基于落盘 plan 文件确认最终状态。

`planEventListeners` 和 `emitPlanEvent()` 在源码里已经存在，但当前真实工具装配路径没有把 listener 传入 `createPlanWriteTool()` / `createPlanEditTool()`，运行时默认等价于空监听器。

## 长期行为 / 规则

- `subagent_ended` 只代表子 agent 结束，不代表 plan task 已经 `done`。
- `subagent_running` 的 plan task 需要主 agent review 后显式调用 `plan_edit({ taskId, status: "done", sessionKey, review })`，才进入 plan task done 流程。
- `plan_edit({ taskId, status: "done" })` 可能通过 `inferPlanStatus()` 自动把整个 plan 推断为 `completed`；单看 params 无法判断是否触发 plan completed。
- `plan_edit({ planStatus: "completed" })` 是显式完成 plan 的路径。
- `plan_write` 可以直接写入 `status: "completed"` 的 plan，但当前 core event 仍是 `plan_created`，不是 `plan_completed`；监听 completion 时必须额外处理这个边界。
- plan completed 后会执行 `clearActiveTaskBinding(...)`，hook 晚于该步骤读取 active task 可能拿不到任务上下文；项目和任务应优先从 `result.absolutePath` 或 plan 路径反推。

## 关联代码

### 主锚点

- `src/agents/tools/plan-tool.ts`：`createPlanWriteTool(...)` / `createPlanEditTool(...)` 是 plan 写入、编辑、状态推断、落盘、meta 更新和 `emitPlanEvent(...)` 的主路径。
- `src/agents/pi-embedded-subscribe.handlers.tools.ts`：`handleToolExecutionEnd(...)` 在工具调用结束后组装 `PluginHookAfterToolCallEvent` 并触发 `hookRunnerAfter.runAfterToolCall(...)`，是无需改 core 的真实运行钩子。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `src/agents/plan-events.ts` | 定义 `PlanEventType`、`PlanEventListener`、`emitPlanEvent(...)`；当前存在但真实装配未接线。 |
| `src/agents/openclaw-tools.ts` | 装配 `createPlanWriteTool(...)` / `createPlanEditTool(...)`；当前未传入 `planEventListeners`。 |
| `src/agents/project-context.ts` | `saveTaskMeta(...)`、`clearActiveTaskBinding(...)`、`recordTaskSubagentCompletion(...)` 等项目 task meta 写盘逻辑。 |
| `src/plugins/types.ts` | `PluginHookAfterToolCallEvent` 和 `PluginHookSubagentEndedEvent` 的 schema。 |
| `src/plugins/hooks.ts` | `runAfterToolCall(...)`、`runSubagentEnded(...)` 插件 hook 分发。 |
| `src/agents/subagent-registry-lifecycle.ts` | `completeSubagentRun(...)` 更新 task run、记录 subagent completion，并触发 truth / subagent ended hook。 |
| `src/agents/subagent-registry-completion.ts` | `emitSubagentEndedHookForRun(...)` 调用 `subagent_ended` 插件钩子。 |
| `src/tasks/task-registry.ts` | background task registry 状态、terminal 通知；不要和 plan JSON task 状态混淆。 |
| `src/tasks/task-registry.store.ts` | `TaskRegistryHooks.onEvent`、`configureTaskRegistryRuntime({ hooks })`；属于 background task registry hook。 |

## 真实调用链路

### plan task done

1. Agent 调用 `plan_edit`，通常包含 `filePath`、`taskId`、`status: "done"`。
2. `createPlanEditTool.execute(...)` 读取 plan 文件并定位 `plan.tasks[id]`。
3. 如果任务曾是 `subagent_running` 或传入了 `sessionKey` / `review` 字段，完成时必须有非空 `sessionKey` 和 `review`；否则返回 `missing_subagent_completion_review`。
4. 工具设置 `task.status = "done"`。
5. `inferPlanStatus(plan.tasks, plan.status)` 推断 plan 状态；全部 task done 时可能自动变成 `completed`。
6. `fs.writeFileSync(resolvedPath, formattedContent, "utf-8")` 写回 plan。
7. `taskMeta.status = taskMetaStatusForPlanStatus(plan.status)`，随后 `saveTaskMeta(...)` 写 meta。
8. terminal plan 会执行 `clearActiveTaskBinding(...)`。
9. 非 completed 变为 completed 时，会触发 `triggerPlanCompletionIndexRefresh(...)`、`dispatchPlanAdrDeposition(...)`、`emitPlanEvent(type: "plan_completed")`。
10. 如果只是单 task done 且 plan 没完成，会触发 `emitPlanEvent(type: "plan_task_completed")`。
11. 工具结束后，`handleToolExecutionEnd(...)` 触发插件 `after_tool_call`；StackChan writer 短期应在这里过滤 `plan_edit` 并读取落盘 plan 判断最终状态。

### subagent done 与 plan task done 的边界

1. 子 agent 结束后进入 `completeSubagentRun(...)`。
2. OpenClaw 更新 task registry run：`completeTaskRunByRunId(...)` 或 `failTaskRunByRunId(...)`。
3. `recordTaskSubagentCompletion(...)` 更新 `meta.subagents[].status` 并追加 `subagents/{idx}.md`。
4. `emitSubagentEndedHookForRun(...)` 触发插件 `subagent_ended`。
5. 这条链路不会自动把 plan task 从 `subagent_running` 改成 `done`；只有主 agent review 后再调用 `plan_edit`，才是 StackChan task done 的可靠信号。

## 推荐接入方式

### 短期：插件 `after_tool_call`

过滤条件建议：

- `toolName === "plan_edit" || toolName === "plan_write"`。
- 工具必须成功：`error` 为空，且 `result` 表示 success。
- 只处理 `stack-chan` 项目：优先用 `result.absolutePath` 是否位于 `.openclaw/.projects/stack-chan/tasks/` 下判断；不要依赖 completed 后可能已清空的 active task binding。
- 成功后读取 `result.absolutePath` 指向的 plan JSON，确认最终 `plan.status` 和目标 task 状态。
- 设计幂等 key，避免工具 retry 或重复 completed 造成重复庆祝事件。

事件判断建议：

| 工具调用 | 判断方式 | StackChan 事件 |
| ---- | ---- | ---- |
| `plan_edit` + `params.status === "done"` | 读取落盘 plan，确认目标 task 已 `done` | task done |
| `plan_edit` 最后一个 task done | 读取落盘 plan，发现 `plan.status === "completed"` | plan completed；是否同时发 task done 由 writer 策略决定 |
| `plan_edit` + `params.planStatus === "completed"` | 读取落盘 plan，确认 `completed` | plan completed |
| `plan_write` + `content.status === "completed"` | 解析 content 或读取落盘 plan | plan completed；注意 core 当前只发 `plan_created` |
| `subagent_ended` | 只作为“可 review”候选信号 | 不应直接发 task done |

### 中期：core plan event hook

更干净的 OpenClaw core 接入点在 `src/agents/tools/plan-tool.ts` 内，位置应在 plan 文件、task meta、active binding 和 ADR / index refresh 处理完成之后，返回工具结果之前。可以选择：

- 把已有 `planEventListeners?: PlanEventListener[]` 真正从 `src/agents/openclaw-tools.ts` 装配传入；或
- 新增正式插件 hook：`plan_event`，事件直接复用 `PlanEvent` schema；并补齐 `plan_write completed -> plan_completed`。

## 已知陷阱

- 不要假设 `emitPlanEvent(...)` 运行时会被外部收到；当前 `planEventListeners` 未接线。
- 不要把 `subagent_ended` 当作 plan task done；这是两阶段流程。
- 不要只看 `plan_edit` params 判断 plan completed；自动 completed 必须读取落盘 plan。
- 不要只监听 `plan_completed` core event；`plan_write` 直接写 completed plan 时当前发的是 `plan_created`。
- 不要依赖 active task binding 做 completed 后的项目识别；binding 可能已经被 `clearActiveTaskBinding(...)` 清掉。
- 如果 StackChan writer 调本地命令，必须固定命令路径并安全编码参数，不要把 plan 内容拼进 shell 字符串。
- background task registry 的 `TaskRegistryHooks.onEvent` 不是 plan JSON task 状态专用 hook，不能替代 plan 状态判断。

## 验证标准

后续实现 StackChan celebration writer 或 core `plan_event` 时，应覆盖：

1. `plan_edit taskId -> done` 且 plan 仍 active：只触发 task done。
2. 最后一个 task `done` 导致 plan 自动 completed：能识别 completed，是否同时发 task done 需按策略固定。
3. `plan_edit planStatus: "completed"`：触发 plan completed。
4. `plan_write` 新建 active plan：不触发 completion。
5. `plan_write` 新建 completed plan：触发 plan completed，即使 core event 是 `plan_created`。
6. `subagent_ended` 到达但 plan task 仍 `subagent_running`：不触发 task done。
7. subagent review 后主 agent 调 `plan_edit status done`：才触发 task done。
8. 非 `stack-chan` 项目：完全不触发 writer。
9. 失败工具调用：`error` 有值或 result 是 error 时不触发。
10. 重试或重复 completed：幂等去重，不重复写 StackChan event。

## 关键检索词

- `plan_edit`
- `plan_write`
- `after_tool_call`
- `PluginHookAfterToolCallEvent`
- `handleToolExecutionEnd`
- `runAfterToolCall`
- `planEventListeners`
- `emitPlanEvent`
- `PlanEventType`
- `plan_task_completed`
- `plan_completed`
- `subagent_ended`
- `missing_subagent_completion_review`
- `inferPlanStatus`
- `saveTaskMeta`
- `clearActiveTaskBinding`
- `triggerPlanCompletionIndexRefresh`
- `dispatchPlanAdrDeposition`
