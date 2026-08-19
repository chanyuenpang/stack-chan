# ADR: Avoid 64-bit printf in SCS logs

## Status

accepted

## Context

决定：SCS 舵机总线关键路径日志不能使用 nano printf 风险格式，尤其不能在 `ESP_LOG*` varargs 中直接输出 `%lld` / `long long` 毫秒值。

原因：已完成计划记录 2.0.34 庆祝后 bootloop 的根因是 `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp` 中 SCS 事务失败/慢事务日志使用 `%lld`，在 `CONFIG_LIBC_NEWLIB_NANO_FORMAT=1` 下触发 nano-vfprintf 参数消费错位，后续 `%s` 可能把垃圾值当指针解引用，表现为 `_printf_i` / `LoadProhibited` / `EXCVADDR=0x0000000a` 或 `0x00000014`。触发链路来自 `ReadPos` 失败：`ScsServo::getCurrentAngle` → `SCSCL::ReadPos` → `SCS::Read` → `SCS::endBusTransaction` 日志。

## Decision

决定：`SCS.cpp` 中 SCS 相关 `ESP_LOG*` 毫秒字段统一先通过 `clampLogMs(int64_t)` 收敛为安全 `int`，再使用 `%d` 输出；不得恢复 `duration_ms=%lld`、`waited_ms=%lld`、`owner_held_ms=%lld`，也不得在该关键路径恢复复杂业务 `%s` 日志来掩盖或重新引入 varargs 风险。

本次修复选择保留舵机与庆祝链路，不通过禁用舵机、no-op 庆祝或回退到“稳定但无庆祝”的方式规避问题。2.0.35 候选产物已基于该策略构建，并用于后续 OTA/恢复验证。

## Alternatives Considered

- 禁用舵机或 no-op 庆祝：拒绝。计划目标明确要求“不禁用舵机、不 no-op 庆祝”，因为这只会绕开触发点，不能修复 SCS 日志崩溃根因。
- 保留 `%lld` 并只调整日志内容：拒绝。计划完成事实确认风险来自 nano printf 对 64 位 varargs 的处理，必须移除关键路径 64 位 printf。
- 只依赖产物发布验证：拒绝。计划同时要求源码 grep 与 ELF strings 静态验证，确保风险格式未进入候选产物。

## Related Code

| Path | Role |
| ---- | ---- |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp` | SCS 事务日志、`clampLogMs(int64_t)`、`SCS::Read` / `SCS::endBusTransaction` 修复锚点。 |
| `firmware/CMakeLists.txt` | 2.0.35 候选构建相关变更锚点。 |
| `firmware/build-active-release-2.0.35/stack-chan.bin` | 2.0.35 候选 OTA bin 产物锚点，计划记录 sha256=`0065920b3591e8ba7139c4a36f8111749480f1fa3c0fc7a51f5a616908c02377`。 |
| `firmware/build-active-release-2.0.35/stack-chan.elf` | 静态验证 `strings` 锚点，计划记录 sha256=`180e1f98bf32cb8ed5d942f2c30defa0aff8c7eb59c5e7987f2da52da89aee0b`。 |

## Consequences

- 正向效果：`ReadPos` 失败、SCS 慢事务或总线异常仍可记录诊断日志，但不会因 `%lld` 在 nano printf 下触发 `_printf_i` / `LoadProhibited` bootloop。
- 约束：后续修改 `SCS.cpp` 事务日志时，毫秒/持续时间字段必须继续走安全整数转换与 `%d`，不得重新引入 `%lld` 或复杂指针型 varargs 组合。
- 取舍：日志毫秒值被 clamp 为 `int`，牺牲极端长时长的完整数值表达，换取启动与故障路径稳定性。
- 验证锚点：计划已完成 `grep -n "%lld" SCS.cpp` exit=1；`strings stack-chan.elf | grep 'duration_ms=%lld|waited_ms=%lld|owner_held_ms=%lld'` exit=1；ELF 包含 `2.0.35` / `V2.0.35`。
- 发布边界：2.0.35 作为 OTA candidate，`active.json` 指向 2.0.35 且 `force=0`；首次从 2.0.34 升级仍需走已有小智 OTA 检查/重启/手动触发路径，不能 USB 直刷。

## Search Terms

- `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp`
- `clampLogMs(int64_t)`
- `SCS::endBusTransaction`
- `SCS::Read`
- `ScsServo::getCurrentAngle`
- `SCSCL::ReadPos`
- `CONFIG_LIBC_NEWLIB_NANO_FORMAT`
- `nano-vfprintf`
- `_printf_i`
- `LoadProhibited`
- `EXCVADDR=0x0000000a`
- `EXCVADDR=0x00000014`
- `duration_ms=%lld`
- `waited_ms=%lld`
- `owner_held_ms=%lld`
- `2.0.35`
