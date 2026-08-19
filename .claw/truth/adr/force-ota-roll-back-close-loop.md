# ADR: force OTA 回退闭环与完成判定收口

## Status

accepted

## Context

决定：`ops/bin/stackchan-ota-release` 在做旧固件 force 回退时，完成判定不能只看 `app_version` 命中，必须同时确认设备已脱离升级态并恢复可用状态。原因是本次回退验证中，真实设备在 `app_version` 先命中、但 `state` 仍处于 `upgrading` 时，若过早把 `force` 写回 `false`，会破坏回退闭环并掩盖设备尚未真正恢复的问题。

同时，设备状态接口需要走带 `X-StackChan-Dev-Token` 的 ` /dev/status` 访问，并且当前端口是 `18080`；脚本不能默认按 `80` 端口访问。`stackchan-doctor` 仍然是回退后的一致性校验锚点。

## Decision

`ops/bin/stackchan-ota-release` 的 force 回退闭环必须满足以下完成条件后，才能自动收口并恢复 `force=0`：

1. `app_version` 已命中目标旧固件版本。
2. 设备 `state` 已脱离 `upgrading`，回到可运行态。
3. `xiaozhi_ready=true`。
4. `ops/bin/stackchan-doctor --json` 校验一致。

只要上述条件未同时满足，就不能提前把 `force` 恢复为 `false`。若设备版本未命中、`doctor` 不一致，或设备长时间停留在 `upgrading` / `xiaozhi_ready=false`，应停止并保留当前 `force` 状态用于排查，不继续覆盖写回。

设备状态轮询必须显式访问带 `X-StackChan-Dev-Token` 的 `/dev/status`，并使用 `18080` 端口，而不是默认 HTTP 端口。

## Alternatives Considered

- 只以 `app_version` 命中作为完成条件：被拒绝。真实验证表明这会在设备仍处于 `upgrading` 时误判完成。
- 仅依赖 `stackchan-doctor` 作为唯一完成条件：被拒绝。它适合作为一致性锚点，但不能替代对设备运行态和 ready 状态的确认。
- 默认按 `80` 端口访问 `/dev/status`：被拒绝。真实设备状态接口实际在 `18080`，且需要 token。

## Related Code

| Path | Role |
| ---- | ---- |
| `ops/bin/stackchan-ota-release` | force 回退闭环与自动收口主入口。 |
| `ops/bin/stackchan-doctor` | 回退后的只读一致性校验锚点。 |
| `/dev/status` | 设备运行态与 ready 状态轮询入口。 |
| `X-StackChan-Dev-Token` | `/dev/status` 访问所需认证头。 |

## Consequences

- 正向效果：避免在设备尚未真正恢复时过早清理 `force`，让回退闭环更稳。
- 约束：回退成功判定必须比单纯版本命中更严格，后续脚本和验收都要按运行态一起判断。
- 风险：如果状态轮询缺少 token 或端口配置错误，闭环会中断；因此这些参数必须成为脚本显式配置的一部分。
- 验证锚点（已被推翻）：本次任务在 `2.0.46` 旧基线上验证到 `state=idle`、`xiaozhi_ready=true`，**但用户真实反馈表明 2.0.46 上仍无法正常与小智沟通**。结论：`state=idle + xiaozhi_ready=true` 不足以证明对话能力恢复。后续所有语音恢复结论必须以真实三轮对话或更直接的语音链路证据为准。详见 `features/dialog-state-machine-fix-surface.md`。

## Search Terms

- `ops/bin/stackchan-ota-release`
- `ops/bin/stackchan-doctor --json`
- `/dev/status`
- `X-StackChan-Dev-Token`
- `18080`
- `app_version`
- `state=upgrading`
- `xiaozhi_ready=true`
- `force=0`
- `force=1`
