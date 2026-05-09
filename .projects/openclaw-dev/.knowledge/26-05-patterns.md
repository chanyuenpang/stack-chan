# openclaw-dev - 26-05 Patterns

### [KN-20260510-015] 迁移任务不逐步确认

- **计数**: 1
- **标签**: workflow, migration, user-preference
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
project迁移任务：不需要逐步确认，如果没有问题就直接一步步做完，不要做一步等一步回应，浪费时间。遇到问题再汇报。

---

### [KN-20260510-016] 先做 plan 再执行

- **计数**: 1
- **标签**: workflow, planning, implementation
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确要求：先做 plan，再去执行。后续涉及实现类任务，先用 plan_write/plan_edit 建立计划，再启动执行。

---

### [KN-20260510-017] plan guard 以 user 身份注入指令

- **计数**: 1
- **标签**: plan-guard, reminder, instruction-routing
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确收敛 reminder 需求：plan guard 在无运行中 subagent 且仍有未完成 todo 时，需要从发送路径入手，以 user 的身份发出指令；也就是对 agent 视角而言，这条内容就是 user 指令，而不是普通 system reminder。

---

### [KN-20260510-018] 遇到可直接修的阻塞先修再汇报

- **计数**: 1
- **标签**: workflow, blocking, execution
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确反馈：遇到明显可直接处理的阻塞，不要停在汇报上；汇报不能替代推进。后续应先修复、继续跑通，再汇报结果；除非需要用户决策或权限。

---

### [KN-20260510-019] 代码方向排查优先 researcher

- **计数**: 1
- **标签**: workflow, code-research, researcher
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
用户明确要求：代码方向的探查优先交给 researcher（如 code-researcher），不要过度指望 openclaw-master 的探查能力。后续代码链路定位、源码阅读类排查优先用 researcher 路线。
