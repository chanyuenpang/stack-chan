# SCS `%lld` nano-vfprintf Guru Meditation 重启链路

## 结论

StackChan 2.0.34 的 Guru Meditation 无限重启根因是 `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp` 中 `SCS::endBusTransaction()` 的异常诊断日志使用了 `%lld`。在 `CONFIG_LIBC_NEWLIB_NANO_FORMAT=1` 的 nano-vfprintf 下，`%lld` 可能只按 4 字节消费参数，导致后续 `%s` 参数错位并把垃圾值当作 `char*` 解引用，最终在 `_printf_i` / ROM printf 路径触发 `LoadProhibited`。

该崩溃不是舵机硬件直接导致，也不是主任务栈溢出。舵机 UART 事务失败只是触发了失败日志路径；健康 boot 中没有 `SERVO-IO` 失败日志时不会触发该 crash。一旦首次 crash 后 UART 残留数据导致 boot 阶段 `ReadPos` 立即失败，就会再次进入同一日志路径，形成 boot loop。

## 长期行为 / 规则

- 在启用 `CONFIG_LIBC_NEWLIB_NANO_FORMAT=1` 的固件中，`ESP_LOG*` 格式串不要使用 `%lld` / 依赖 long long printf 支持，尤其不要在后面继续跟 `%s` 这类会解引用指针的参数。
- `SCS::beginBusTransaction()` / `SCS::endBusTransaction()` 是所有 SCS UART 事务失败、慢事务诊断的高频公共路径；这里的日志格式错误会把普通 bus failure 放大成系统 panic。
- 2.0.34 首次崩溃链路可由庆祝执行期间 `ScsServo::getCurrentAngle()` / `ReadPos` 失败触发；后续 boot loop 则在 `Servo::init()` / `Motion::init()` / `Hal::init()` 阶段的舵机初始化读位置中触发。
- 健康 boot 中如果舵机总线干净、`ReadPos` 成功，则不会进入 `endBusTransaction()` 的失败日志路径，因此 `%lld` bug 可能长期潜伏。
- 修复应优先把 `duration_ms` 等日志字段降为 `int` 并使用 `%d`，或彻底禁用 nano format；不要只增大 task stack 或只改庆祝 executor。
- boot 脱困可考虑上电断电清 UART 残留，但这只绕过触发条件；长期修复仍是移除 `%lld` 日志风险并在 servo init 前清理残留 UART 输入。

## 关联代码

### 主锚点

- `firmware/main/hal/drivers/FTServo_Arduino/src/SCS.cpp`：`SCS::beginBusTransaction()` / `SCS::endBusTransaction()` 的 `ESP_LOGW` 诊断日志；`duration_ms=%lld` 是 2.0.34 panic 主根因。
- `firmware/build/config/sdkconfig.h`：`CONFIG_LIBC_NEWLIB_NANO_FORMAT=1` 是 `%lld` 参数消费错位的前置条件。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `firmware/main/hal/drivers/FTServo_Arduino/src/SCSCL.cpp` | `SCSCL::ReadPos()` 上游，失败时经 `SCS::Read()` 进入 bus transaction 诊断日志。 |
| `firmware/main/hal/hal_servo.cpp` | `ScsServo::getCurrentAngle()`、`Servo::init()` / `servo_init()` 触发 `ReadPos` 的入口；报告中的崩溃链路包含 `getCurrentAngle()` 与 boot 阶段舵机初始化。 |
| `firmware/main/hal/hal.cpp` | `Hal::init()` boot 路径上游；boot loop 崩溃发生在进入 Wi-Fi / HTTP / OTA 之前。 |
| `firmware/main/stackchan/stackchan.h` | `_stackchan_update_task` 调用 `StackChan::update()`，首次庆祝期间崩溃链路的上游。 |

## 真实调用链路

### 首次崩溃：庆祝 / update task 触发

1. `_stackchan_update_task` 推进 `StackChan::update()` 或庆祝相关 motion。
2. 上游调用 `ScsServo::getCurrentAngle()`。
3. `ScsServo::getCurrentAngle()` 调用 `SCSCL::ReadPos()`。
4. `SCSCL::ReadPos()` 进入 `SCS::Read()` / `SCS::readWord()`。
5. 舵机 UART 事务失败，`SCS::endBusTransaction()` 打印 `SERVO-IO` WARN。
6. `ESP_LOGW(... "duration_ms=%lld ... task=%s ...", static_cast<long long>(duration_ms), taskName(self), ...)` 在 nano-vfprintf 下参数错位。
7. 后续 `%s` 从错位位置读取 `0x14` 之类垃圾指针，`_printf_i` 解引用后触发 `LoadProhibited`。

### 后续崩溃：boot 阶段循环

1. crash 后重启，舵机 UART 总线可能残留数据。
2. `app_main()` → `Hal::init()` → `Hal::servo_init()` → `Motion::init()` / `Servo::init()`。
3. 初始化读取当前位置，进入 `ScsServo::getCurrentAngle()` → `SCSCL::ReadPos()`。
4. 残留数据导致 `ReadPos` 立即失败。
5. 同一个 `SCS::endBusTransaction()` 失败日志再次触发 `%lld` / `%s` 参数错位。
6. `_printf_i` 解引用 `0x0a` 等垃圾指针，boot 还未进入 Wi-Fi / HTTP / OTA 就再次 panic。

## 不要改错的位置

- 不要把该类 Guru Meditation 直接归因于 `sys_evt` 栈溢出；本链路的崩溃点在 `SCS.cpp` 的日志格式串和 libc printf。
- 不要只看 `ESP_LOGW` 是“诊断日志”就降低优先级；在 nano-vfprintf 条件下，日志本身就是 panic 根因。
- 不要只修庆祝动作或只屏蔽 `self.robot.celebrate`；boot 阶段舵机初始化同样会走 `ReadPos` 失败路径并重启。
- 不要把上电断电恢复视为根治；它最多清掉 UART 残留、避免进入失败日志。
- 不要在 `CONFIG_LIBC_NEWLIB_NANO_FORMAT=1` 下新增 `%lld`、`%llu` 或复杂 printf 格式到 firmware 关键错误路径；若必须打印 64 位值，应确认 newlib 配置或拆成安全类型。

## 修复模式

- 最小修复：把 `SCS.cpp` 中 `duration_ms=%lld` 改为 `duration_ms=%d`，参数改为 `static_cast<int>(duration_ms)`；同样处理 `beginBusTransaction()` 和其它 `ESP_LOG*` 中的 `%lld`。
- 辅助脱困：在 `Hal::servo_init()` 初始化 UART 后调用等价的 `uart_flush_input(UART_NUM_1)` / `flushInput()` 清理 crash 前残留输入，降低 boot 后首次 `ReadPos` 因残留失败的概率。
- 根治选项：禁用 `CONFIG_LIBC_NEWLIB_NANO_FORMAT`，但需接受固件体积增加；对嵌入式固件更推荐先消除关键路径中的 64 位 printf。

## 验证标准

后续修改 SCS 事务日志、舵机初始化或庆祝链路时至少验证：

- `SCS.cpp` 中不再存在 `%lld` / `%llu` 的 `ESP_LOG*` 格式串；`duration_ms` 等字段使用 `%d` / `%u` 与实际参数类型匹配。
- 构建配置若仍为 `CONFIG_LIBC_NEWLIB_NANO_FORMAT=1`，必须额外审查关键错误路径 printf 格式串。
- 人为制造 `ReadPos` / SCS 事务失败时，串口只出现 `SERVO-IO` WARN 或可控错误，不出现 `_printf_i`、`LoadProhibited`、`EXCVADDR=0x0000000a/0x00000014`。
- boot 阶段 `servo_init()` 失败或 UART 残留时不会在 `Hal::init()` 前后形成 Guru Meditation 循环；若仍失败，应能继续进入可诊断日志而不是 printf panic。
- 健康 boot 仍应对比确认 `SERVO-IO` 失败日志为 0 或可解释；不能只用健康 boot 排除该 bug，因为健康路径不会触发失败日志。

## 关键检索词

- `SCS::endBusTransaction`
- `SCS::beginBusTransaction`
- `duration_ms=%lld`
- `CONFIG_LIBC_NEWLIB_NANO_FORMAT`
- `nano-vfprintf`
- `_vfprintf_r`
- `_printf_i`
- `LoadProhibited`
- `EXCVADDR=0x0000000a`
- `EXCVADDR=0x00000014`
- `SERVO-IO`
- `event=transaction_done`
- `task=%s`
- `ScsServo::getCurrentAngle`
- `SCSCL::ReadPos`
- `SCS::Read`
- `SCS::readWord`
- `Servo::init()`
- `Motion::init()`
- `Hal::servo_init()`
- `Hal::init()`
- `_stackchan_update_task`
- `StackChan::update()`
- `uart_flush_input`
