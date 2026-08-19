# StackChan speaking 阶段 panic：优先排查 `strtof` 与 body 生命周期，不要先怪 celebrate

## 结论

当语音注入链路在 `listening -> speaking` 切换瞬间出现 `Guru Meditation Error (LoadProhibited)`、`EXCVADDR=0x00000000`、backtrace 命中 `strtof` 与 `hal_dev_local_control.cpp:read_body()` 时，长期优先排查方向不是 `celebrate` 动作层，也不是音频 DMA / I2S 本身，而是 **speaking 阶段某条状态文本 / HTTP body / 参数字符串解析路径吃到了 `NULL` 或悬空指针**。

`inject-prompt --sample tts` 的长期意义更接近“稳定复现 speaking 生命周期 bug 的触发器”，而不是 root cause 本身。

## 长期行为 / 规则

- 如果 panic 现场同时出现以下特征，应优先按“字符串解析 / 生命周期”方向调查：
  - 状态迁移为 `idle -> connecting -> listening -> speaking -> Guru Meditation Error -> reboot`
  - `EXCVADDR=0x00000000`
  - backtrace 包含 `strtof`
  - 同栈或邻近栈出现 `std::string` / `tlsf_realloc` / `read_body()`
- 这类栈形态更像 **`const char*` 输入为空、已释放或已损坏后进入浮点解析**，而不像音频 codec、I2S DMA、播放循环中段故障。
- `StackChanAvatarDisplay::SetStatus(SPEAKING)` 即使参与 speaking 切换，也不能仅因状态名命中就被判为首嫌。若显示层已经被硬化为静态 mouth pose，则排查优先级应回到上游状态文本 / 参数 / body 生命周期。
- `handle_inject_prompt()` / `inject_prompt_task()` 属于异步边界：凡是从 HTTP body、`cJSON->valuestring`、临时 `std::string`、局部 buffer 提取出来并在稍后 speaking 阶段继续使用的字段，都必须先复制到稳定存储，不能跨 task 保留裸指针。
- `read_body()` 命中 backtrace 时，不代表 `read_body()` 自己必然写坏内存；它更常表示 **请求 body 分配 / resize / 复制 / 后续引用** 与崩溃点距离很近，是生命周期排查主锚点。
- `inject-prompt --sample tts` 若比默认样本更稳定触发 panic，应优先理解为“更稳定命中 speaking / 文本解析 / 状态更新时序”，不是“`tts` 样本天然有害”。

## 根因优先级排序

### 1. speaking 阶段某个字符串解析路径把 `NULL` / 悬空指针传给 `strtof`

- 证据强度：最高。
- 典型形态：`EXCVADDR=0`、`A2=0`、`strtof` 直接在 backtrace 中出现。
- 高风险来源：
  - 状态文本附带数字参数
  - 表情 / 动作权重 / modifier 参数
  - JSON 字段存在但 `valuestring == NULL`
  - 空串、非法串未做 `endptr` 校验
- 修复原则：
  - 所有 `strtof` / `atof` / `sscanf("%f")` 输入都要先判空
  - `strtof` 必须配 `endptr` 校验，拒绝空串与非数字串

### 2. HTTP / 控制面 body 生命周期跨异步任务泄漏到 speaking 阶段

- 证据强度：中高。
- `read_body()`、`std::string::resize`、`tlsf_realloc` 与 panic 栈邻近时，应检查是否把临时 body 或 `cJSON` 内部字符串指针留给了后续 task。
- 长期规则：
  - 同步解析阶段拿到的文本，如果异步 task、callback、状态切换或 UI 更新稍后还要用，必须复制。
  - 不要跨 task 保存 `cJSON->valuestring`、body buffer 内部地址或 `std::string::c_str()` 的悬空引用。

### 3. speaking 状态切换并发暴露未初始化字段

- 证据强度：中。
- `inject_prompt_task` 与 listening / speaking 切换、UI avatar 更新、网络回调若在相近时序交叉，可能把原本低概率的未初始化字段或悬空引用放大成稳定 crash。
- 长期排查顺序：先确认字段来源与生命周期，再考虑加锁、串行化或改 task core 绑定。

### 4. celebrate / 音频播放链本身直接导致 panic

- 证据强度：较低。
- 只有当 backtrace 真正落到 `audio codec`、`i2s`、`opus`、播放 buffer 或 celebrate 动作执行主路径时，才应提升这条优先级。
- 在当前这类 `strtof + read_body + EXCVADDR=0` 栈形态下，先砍 celebrate 或先怀疑 DMA，通常是在改错位置。

## 关联代码

### 主锚点

- `StackChan/firmware/main/hal/hal_dev_local_control.cpp`：`read_body()` 与本地 dev HTTP 请求 body 读取；是 body 分配、复制、解析与生命周期排查的第一入口。
- `StackChan/firmware/main/hal/hal_device_control.cpp`：`handle_inject_prompt()`、`inject_prompt_task()`、`parse_sample_arg()`、`parse_explicit_stop_arg()`；是同步请求解析进入异步注入任务的主边界。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `StackChan/firmware/main/hal/board/stackchan_display.cc` | `StackChanAvatarDisplay::SetStatus()` 与 `SPEAKING` 分支；用于确认 display 层是否仍动态解析 speaking 参数，或已被硬化为静态 mouth pose。 |
| `StackChan/firmware/main/hal/board/stackchan_display.h` | `SetStatus(const char* status)` 声明锚点。 |
| `StackChan/firmware/main/hal/hal_dev_local_control.cpp` | `/dev/inject_prompt`、`/dev/prompt_sample` 等 HTTP 入口调用 `read_body()` 的位置。 |
| `StackChan/firmware/main/hal/hal_device_control.cpp` | `xTaskCreatePinnedToCore(..., 1)` 创建 `inject_prompt_task`；用于调查异步时序和生命周期边界。 |
| `StackChan/firmware/xiaozhi-esp32/main/application.cc` | speaking / listening 状态切换上游；若状态文本、TTS stop/start 或会话回落触发崩溃，需要沿这条链往上追。 |

## 真实调用链路

1. `tools/remote_control/remote_control.py inject-prompt` 或 `prompt-sample` 触发本地 dev HTTP。
2. `hal_dev_local_control.cpp` 读取请求 body，构造 `std::string`，再把参数交给 device-control 分发。
3. `hal_device_control.cpp::handle_inject_prompt()` 解析参数并创建 `inject_prompt_task()`。
4. `inject_prompt_task()` 启动 listening / 音频注入链路，随后 XiaoZhi 进入 `speaking`。
5. speaking 切换阶段如果还有状态文本、参数字符串、body 派生字段、UI 状态更新或 callback 继续消费旧指针，就会在此时暴露为 `strtof` / `LoadProhibited`。
6. 因此真正要追的是“**谁在 speaking 时还在读一个本该只活在 HTTP 解析阶段的字符串**”，而不是只盯着 `celebrate` 动作名。

## 不要改错的位置

- 不要仅因为问题出现在 `celebrate` 语义附近，就优先削弱 `DanceModifier::Celebrate`、禁用庆祝或回退动作幅度。
- 不要把 `SetStatus(SPEAKING)` 命中等同于显示层 root cause；先确认它是否真的解析外部字符串或数值。
- 不要只因为样本切成 `tts` 后更容易复现，就把 WAV 文件或音频格式认定为主因；它更可能只是改变时序与文本命中率。
- 不要跨异步任务保存 `cJSON` 内部指针、局部 body buffer、`std::string::c_str()`、临时 `const char*`。
- 不要继续使用无判空的 `strtof` / `atof` / `sscanf("%f")` 解析用户态 / 协议态字符串。
- 不要把 `read_body()` 出现在栈上简单翻译成“HTTP 层有问题”；更准确的含义通常是“HTTP body 生命周期与后续异步消费边界需要复查”。

## 验证标准

后续修 speaking panic 时，至少验证：

- 全仓搜索 `strtof`、`atof`、`sscanf("%f")`，逐一确认输入判空与非法串校验。
- `handle_inject_prompt()` 到 `inject_prompt_task()` 之间没有跨 task 保留临时 body / `cJSON->valuestring` 裸指针。
- speaking 相关状态更新、UI / avatar 状态更新、TTS 状态切换路径中，没有读取可能为空或已失效的字符串字段。
- 使用触发器样本（例如 `prompt-sample tts` 或等价稳定复现路径）重复验证，不再出现：
  - `idle -> connecting -> listening -> speaking -> Guru Meditation Error`
  - `EXCVADDR=0x00000000`
  - `strtof`
  - `LoadProhibited`
- 若修复后仍有 `speaking` 问题，但 backtrace 已不再落到字符串解析 / body 生命周期，应重新排序嫌疑，而不是沿用旧结论。

## 关键检索词

- `speaking`
- `Guru Meditation Error`
- `LoadProhibited`
- `EXCVADDR=0x00000000`
- `A2=0x00000000`
- `strtof`
- `__kernel_rem_pio2f`
- `__kernel_rem_pio2`
- `tlsf_realloc`
- `insert_free_block`
- `read_body`
- `handle_inject_prompt`
- `inject_prompt_task`
- `parse_sample_arg`
- `parse_explicit_stop_arg`
- `StackChanAvatarDisplay::SetStatus`
- `Lang::Strings::SPEAKING`
- `cJSON->valuestring`
- `std::string::c_str()`
- `xTaskCreatePinnedToCore`
- `prompt-sample tts`
- `inject-prompt`
