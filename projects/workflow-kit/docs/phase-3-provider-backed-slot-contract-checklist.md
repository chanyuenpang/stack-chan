# Phase 3 provider-backed reserved slot：implementation checklist + reserved field matrix

> 状态：implementation-prep draft  
> 目的：在真实 provider 子计划开始前，先把 provider-backed reserved slot 必须补齐的字段、路径、保留约束与接线顺序钉死。  
> 重要边界：本文不是 provider integration 实现说明；不代表真实 provider、transcript persistence、sandbox enforcement、passed path、tests、默认 validate 链路或文档全量同步已完成。
>
> 当前文档同步口径补充：provider adapter output 现在只是**更真实的中间 truth payload**，用于把单一 adapter result 同源透传到 runtime draft artifact 的 `cases[].observed`、`rawResponse`、`providerExecution`、`transcriptAvailability` 等槽位；这里的 `rawResponse` 也只是**最小 skeleton / truth payload slot**，不是完整 provider payload capture，不是 transcript，不是 persistence handle。这仍然只是 reserved/unimplemented 的 provider-backed contract 准备面，不代表真实 provider call、provider transcript、transcript persistence、scoring 或正式 gate 已完成。

## 1. 使用方式

这份清单只服务于后续 **真实 provider-backed runtime** 子计划，作用是三件事：

1. 明确当前哪些字段必须继续保持 `false/null/reserved`；
2. 明确接入 provider 后哪些字段必须被真实填充；
3. 明确这些字段分别应从哪一层进入、在哪一层透传、在哪一层最终落进 runtime artifact。

一句话：

```text
后续子计划不要再猜 contract，按这张表补就行。
```

## 2. 当前 contract 前提

当前仓库已经在 contract 层冻结了下面这些事实：

- `provider-backed` slot 仍是 `reserved-unimplemented`；
- 当前允许的 runtime/provider case status 仍限定在：
  - `blocked`
  - `error`
  - `dry-run`
  - `not-executed`
- 当前不允许开放真实 `passed` path；
- 当前不允许伪造 provider transcript、provider evidence、provider persistence；
- 当前不接真实 provider，不做真实 transcript persistence，不做 scoring。

因此，后续任何 provider-backed 实装，都必须先满足本文 checklist 与 matrix，再去碰真实 adapter/runner/provider 逻辑。

## 3. Implementation checklist

### 3.1 Provider selection

> 当前 Phase 3 已完成的只是 **selection wiring tightening**：provider-backed selection lineage 现在被收紧为内部单一路径 `adapter -> runner -> observed mapper -> report`。这表示 selection truth source 已统一，**不表示** provider-backed execution 已开放。
>
> 当前 CLI 仍只开放 `dry-run | null-runner`；provider-backed mode 仍是 internal reserved seam，默认 validate 链路也仍不接 runtime/provider 路线。

- [x] 明确 `providerMetadata.providerKey`
- [x] 明确 `providerMetadata.providerSlot`
- [x] 明确 runner/input 到 provider adapter 的 provider selection 传递路径
- [ ] 明确 builtin / external provider 的识别规则
- [ ] 保持 `providerBacked=true` 只在真实 provider call 接通后出现
- [x] 在 provider 未实际接通前，禁止把 selection placeholder 写成 executed/provider-backed success

**最低落地要求**

- provider 选择必须至少能稳定回答：
  - 选中了哪个 provider key
  - 落在哪个 reserved slot / implementation slot
  - 是 builtin adapter 还是后续外接 provider

---

### 3.2 Raw response capture

> 当前收紧后的口径：`rawResponse` 只是 runtime draft/report contract 中的**最小 skeleton / truth payload slot**，用于承载单一 adapter result 的同源最小真值位；它不是完整 provider payload dump，不是 transcript，也不是 persistence / retrieval handle。
>
> `rawResponse.summary` 若存在，也只应被解释为摘要位；不能把摘要位写成完整 provider payload capture 已存在。
>
> 同时，`rawResponse` 与 transcript handle 现在不再允许混源 fallback：不能再用 transcript ref 冒充 raw response handle，也不能用 raw response slot 冒充 transcript/persistence 句柄。

- [ ] 定义 provider 原始响应的最小捕获对象
- [ ] 明确原始响应是内存暂存、report 内最小 skeleton/summary，还是外部持久化句柄
- [ ] 明确 `providerMetadata.providerEvidenceAvailable` 的置真条件
- [ ] 未捕获 raw response 时，不得把 evidence 写成可用
- [ ] raw response capture 与 transcript capture 必须区分，不得混为同一字段
- [ ] 明确 `rawResponse.summary` 只是摘要位，不代表完整 provider payload
- [ ] 明确 raw response handle 不是 transcript/persistence handle，且不再与 transcript handle 混源 fallback

**最低落地要求**

- 至少要有一个稳定承载位能说明：
  - provider 返回过什么最小 skeleton / truth payload
  - 是否真的可追溯
  - 该证据只是摘要、还是可回捞实体
  - 它是否与 transcript / persistence 明确分槽而非共用句柄

---

### 3.3 Observed mapping

- [ ] 把 provider 原始响应映射到 `cases[].observed`
- [ ] 明确 observed 是 provider-normalized view，不是 raw payload 原样转储
- [ ] 明确 `observed.providerCall=true` 的置真条件
- [ ] 明确 `observed.providerEvidenceAvailable=true` 的置真条件
- [ ] 明确 observed 与 scoring/rubric 解耦，后续评分不要反向污染 observed 合同

**最低落地要求**

- observed 至少要稳定表达：
  - 是否真的调用了 provider
  - 归一化后的结果摘要
  - 是否存在可追溯 provider evidence

---

### 3.4 Provider transcript handle

> 当前文档边界要求：transcript handle 是 transcript 侧引用位，不是 raw response slot；raw response handle 也不是 transcript/persistence handle。二者当前不再允许混源 fallback。

- [ ] 明确 transcript handle 的生成时机
- [ ] 明确 `transcriptRef.available=true` 的置真条件
- [ ] 明确 `transcriptRef.providerManaged=true` / `providerTranscript=true` 的含义边界
- [ ] 明确 `transcriptRef.handle` 的稳定格式或最小 identity 规则
- [ ] 明确 transcript handle 与 raw response handle 是否允许复用；若复用必须显式声明
- [ ] 未有真实 transcript 时，不得保留 draft-only transcript ref 语义冒充 provider transcript
- [ ] 未有真实 transcript 时，不得把 rawResponse slot / handle fallback 成 transcript handle

**最低落地要求**

- transcript ref 必须至少让后续链路能回答：
  - transcript 在不在
  - 谁管理
  - 用哪个 handle 可追踪

---

### 3.5 Persistence handle

- [ ] 明确 transcript / raw response / observed evidence 各自的 persistence 策略
- [ ] 明确 `providerMetadata.transcriptPersistence` 的取值语义
- [ ] 明确 `providerMetadata.persistence` 与 `transcriptRef.persistence` 的关系
- [ ] 明确是否存在单独的 persistence handle / artifact id / location
- [ ] 未真正持久化前，禁止把 persistence 写成可恢复状态

**最低落地要求**

- 至少要能稳定区分：
  - `none`
  - in-report only
  - provider-managed / external persisted

---

### 3.6 Failure taxonomy

- [ ] 明确 provider selection failure
- [ ] 明确 provider request failure
- [ ] 明确 provider response parse / mapping failure
- [ ] 明确 transcript capture failure
- [ ] 明确 persistence failure
- [ ] 明确 sandbox / side-effect guard 阻断 failure
- [ ] 明确哪些 failure 只影响 metadata，哪些会落成 `cases[].status=error|blocked`

**最低落地要求**

- failure taxonomy 至少要能区分：
  - 没选中 provider
  - 选中了但没发出 call
  - call 发出但结果不可用
  - transcript / persistence 后处理失败

---

### 3.7 Runtime pass path

- [ ] 明确什么条件下才允许 `cases[].status=passed`
- [ ] 明确 `result.status=passed` 与 `summary.passed=true` 的联动条件
- [ ] 明确 passed path 是否必须同时要求：providerCall、providerEvidence、transcript、persistence 至少其中哪些为真
- [ ] 明确 preflight passed 与 runtime passed 仍然是两层语义
- [ ] 在正式打开 passed path 前，保留默认 reserved contract，不得半开状态

**最低落地要求**

- `passed` 只能在真实 provider-backed execution evidence 完整满足 contract 后解锁；
- 禁止因为 dry/null runner 或只打通 adapter seam 就提前开放 passed。

---

### 3.8 Runtime pass path / runner propagation

> 本轮已完成的真实范围：selection lineage 已被收紧为 `adapter -> runner -> observed mapper -> report` 的内部单一路径；adapter result 作为同源 truth payload 透传到 draft artifact 的 observed/providerExecution/transcriptAvailability/rawResponse 视图。这里的“同源透传”只是在收紧 contract，**不是**真实 provider execution、provider transcript、transcript persistence、scoring 或 passed path 已完成。

- [x] 明确 provider adapter result 到 runner result 的字段透传规则
- [x] 明确 runner metadata 中哪些字段与 provider metadata 一一对应
- [x] 明确 runtime replay report metadata 是否保留 execution lineage
- [x] 明确 report 顶层 status 与 case status 的映射规则
- [ ] 明确 blocked/error/dry-run/not-executed 到 provider-backed 实装后的兼容迁移规则

**最低落地要求**

- 后续 provider 子计划必须能从 adapter result 一路稳定落到 runtime report，不能在 runner 层重新发明字段。

---

### 3.9 Side-effects / sandbox interaction placeholder

- [ ] 明确 provider call 前需要读取哪些 sandbox / boundary summary 字段
- [ ] 明确哪些 side-effects 只是声明占位，哪些会阻断 provider call
- [ ] 明确 external messaging / network / filesystem 与 provider-backed execution 的关系
- [ ] 明确 side-effect guard 失败时是 `blocked` 还是 `error`
- [ ] 在真实 sandbox enforcement 未落地前，保持 declaration-only 语义，不得伪装成 enforced

**最低落地要求**

- provider 子计划至少要知道：
  - 执行前该看哪些 boundary 字段
  - 这些字段现在只是声明，还是已经 enforce

## 4. Reserved field matrix

| Area | Contract path | Current state | Future provider-backed requirement | Source / owner |
| --- | --- | --- | --- | --- |
| provider selection | `provider.providerKey` | may exist as selector input; not proof of execution | must resolve to actual selected provider identity | adapter input |
| provider selection | `provider.providerSlot` | reserved slot only | must point to concrete implementation slot used by execution | adapter input |
| provider selection | `providerMetadata.providerKey` | `null` unless true provider-backed execution | required | adapter result |
| provider selection | `providerMetadata.providerSlot` | `null` unless true provider-backed execution | required | adapter result |
| execution identity | `providerMetadata.executionId` | `null` | required stable execution identifier | adapter result |
| provider run identity | `providerMetadata.providerRunId` | `null` | required when provider exposes run/request identity | adapter result |
| provider state | `providerMetadata.providerStatus` | `null` | required normalized provider execution status | adapter result |
| provider-backed toggle | `providerMetadata.providerBacked` | `false` | must be `true` only after real provider-backed execution | adapter result |
| executed toggle | `providerMetadata.executed` | `false` | must be `true` for real provider execution | adapter result |
| provider call flag | `providerMetadata.providerCall` | `false` | must be `true` when provider request actually sent | adapter result |
| provider evidence flag | `providerMetadata.providerEvidenceAvailable` | `false` | must be `true` only when evidence can be traced | adapter result |
| transcript captured flag | `providerMetadata.transcriptCaptured` | `false` | must be `true` only when transcript exists | adapter result |
| transcript persistence flag | `providerMetadata.transcriptPersistence` | `false` | must express actual persistence availability/state | adapter result |
| persistence mode | `providerMetadata.persistence` | `"none"` | must declare real persistence mode | adapter result |
| raw response slot | `rawResponse` | same-source minimal skeleton/truth payload slot only; not full payload, transcript, or persistence handle | may expand only after true provider/raw payload capture contract lands | adapter/runner/report case |
| raw response summary | `rawResponse.summary` | summary-only when present | must remain summary-only unless explicit raw payload capture contract exists | adapter/runner/report case |
| raw response handle semantics | `rawResponse.handle` / equivalent raw-response identity slot | unavailable / reserved unless future contract adds one | must not be treated as transcript handle or persistence handle | adapter/runner/report case |
| transcript availability | `transcriptRef.available` | `false` unless draft non-provider transcript stub | provider-backed transcript requires `true` | adapter/report case |
| transcript ownership | `transcriptRef.providerManaged` | `false` | required `true` for provider-managed transcript handle | adapter/report case |
| transcript handle | `transcriptRef.handle` | `null` | required stable transcript handle; must not fallback from rawResponse slot | adapter/report case |
| transcript provider bit | `transcriptRef.providerTranscript` | `false` | required `true` only for real provider transcript | runner/report case |
| observed provider call | `cases[].observed.providerCall` | `false` | must be `true` only on real provider call | runtime report case |
| observed evidence flag | `cases[].observed.providerEvidenceAvailable` | reserved/implicit false today | must be explicit and truthful after mapping | runtime report case |
| runtime case status | `cases[].status` | only `blocked|error|dry-run|not-executed` | `passed` may open only after full provider-backed path | runtime report case |
| runner provider execution flag | `runnerMetadata.providerBacked` | default false | must match adapter/provider-backed truth | runner result |
| runner provider call flag | `runnerMetadata.providerCall` | false | must reflect actual provider call | runner result |
| runner transcript captured | `runnerMetadata.transcriptCaptured` | false | must reflect actual transcript capture | runner result |
| runner persistence | `runnerMetadata.transcriptPersistence` | `"none"` | must reflect actual persistence mode/state | runner result |
| runner evidence flag | `runnerMetadata.evidenceProduced` | false | must be true only with real execution evidence | runner result |
| runner pass reservation | `runnerMetadata.passedReserved` | `true` | may relax only when provider-backed pass path implemented | runner result |
| runner future-required list | `runnerMetadata.futureProviderRequiredFields` | reserved checklist field | should be reduced or versioned once real provider path lands | runner result |
| runtime metadata execution id | `metadata.providerExecution.executionId` | reserved/null or absent unless contract stub | required in final report metadata | runtime replay report |
| runtime metadata provider status | `metadata.providerExecution.providerStatus` | reserved/null or absent unless contract stub | required normalized execution status | runtime replay report |
| runtime metadata contract state | `metadata.providerBackedContract.currentState` | `reserved-unimplemented` | must move to implemented state only when end-to-end path is real | runtime replay report |
| side-effect boundary | `metadata.sandbox` / runner sandbox contract lineage | declaration-only | must document whether provider path is merely declared or enforced | runner/report metadata |

## 5. Recommended implementation order for the next provider-backed subplan

1. **selection wiring**  
   先把 provider key / slot / mode 的输入来源稳定下来。

2. **adapter result truthfulness**  
   再让 adapter result 真正产出 execution id / provider status / provider call truth。

3. **observed + transcript mapping**  
   然后补 observed normalized mapping 与 transcript handle。

4. **persistence handle**  
   再定义 persistence mode / handle / location。

5. **runner propagation**  
   再把 adapter truth 透传到 runner metadata / runtime report metadata。

6. **failure taxonomy**  
   最后补细粒度 failure codes 和 status 映射。

7. **passed path unlock**  
   全部前置就绪后，才讨论开放 `passed`。

## 6. 明确故意留给后续任务的内容

以下内容本次故意不做，留给后续子计划：

- 真实 provider integration
- 真实 provider execution / request dispatch
- provider transcript capture / persistence
- rawResponse persistence / evidence retrieval
- scoring / rubric
- passed path 解锁
- failure taxonomy 统一扩展
- 状态机小修
- tests / contract tests 扩展
- validate* 默认链路接入
- fixtures 变更
- 文档全量同步
- git 提交 / 推送
- 运行验证

## 7. 结论

当前 contract 层已经把 provider-backed slot 钉成了“先保留、后兑现”。下一步真实 provider 子计划不该再猜字段，而是应直接按上面的 checklist 和 matrix 补齐：

```text
selection
-> raw response
-> observed mapping
-> transcript handle
-> persistence handle
-> runner/report propagation
-> failure taxonomy
-> passed path
```

别抢跑，先把每个字段讲真话，后面接 provider 才不会一地龙虾壳。
