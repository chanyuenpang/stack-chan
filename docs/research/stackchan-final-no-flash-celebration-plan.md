# StackChan 无刷庆祝方案：最终收敛版

更新时间：2026-05-15

## 1. 实测结论

用户现场测试确认：

```text
小智能调用内部硬件 MCP。
```

但 LED 有明显限制：

```text
调整灯光耗时较长；
一次只能调一个颜色；
不适合做闪光/跑马灯/多次快速变色效果。
```

因此，庆祝方案不再设计“闪光”效果。

## 2. 当前无刷可行庆祝组合

补充确认：设备 MCP 没有直接可调用的 `speak` / `tts` / `audio.play` / `play_sound` 工具；`create_reminder` 不朗读 message，只是固定通知音 + 屏幕提醒。

推荐方案：

```text
小智自然 TTS 说一句庆祝语
+ LED 单次柔和变色
+ 可选 reminder 固定提示音
+ 可选一次小幅点头
```

不要使用：

```text
高频闪烁
跑马灯
循环彩灯
连续快速调色
大幅头部动作
长时间提醒
```

## 3. 推荐庆祝流程

当 OpenClaw MCP 返回：

```text
should_celebrate=true
```

小智执行：

1. 自然说一句：

```text
太棒啦，任务完成！小龙虾给你轻轻庆祝一下～
```

2. 调用设备内置 LED tool，设置一次柔和颜色：

```text
self.robot.set_led_color
```

建议颜色：

```json
{
  "red": 40,
  "green": 20,
  "blue": 80
}
```

或：

```json
{
  "red": 30,
  "green": 60,
  "blue": 100
}
```

3. 可选：创建 1 秒提醒，触发固定提示音 + 屏幕提醒：

```text
self.robot.create_reminder
```

参数：

```json
{
  "duration_seconds": 1,
  "message": "任务完成啦",
  "repeat": false
}
```

4. 可选：轻微点头一次：

```text
self.robot.set_head_angles
```

参数建议：

```json
{
  "yaw": 0,
  "pitch": 20,
  "speed": 150
}
```

5. 不强制关灯。如果要关灯，应等待自然间隔后单次设置：

```json
{
  "red": 0,
  "green": 0,
  "blue": 0
}
```

## 4. Agent Personality 建议补充

在 StackChan App 的 Personality / Character Description 中补充：

```text
庆祝时不要做闪光、跑马灯或连续快速变色，因为机器人调整灯光需要时间。只需要把 LED 单次设置为柔和蓝紫色或青蓝色，并保持短暂稳定即可。庆祝重点是自然说一句短庆祝语；可选 1 秒提醒提示音；可选一次小幅点头。
```

Memory 中补充：

```text
庆祝灯效不要闪烁，只做一次柔和定色。灯光颜色建议蓝紫或青蓝，亮度适中。不要连续快速调用 LED 工具。
```

## 5. 当前最终判断

在不刷固件、不拿设备私有 token 的前提下，最稳方案是：

```text
OpenClaw bridge 提供完成状态
→ 小智调用 get_latest_completion_event
→ 小智自然 TTS 说庆祝语
→ 小智调用内部硬件 MCP 做单次柔和灯光 / 提醒 / 小幅点头
```

这比“闪光音效”更符合当前硬件 MCP 的实际延迟与能力边界。
