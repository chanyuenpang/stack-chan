# StackChan 控制台（Windows）

Electron 主进程是唯一的 StackChan Dock Owner：它启动 `XiaozhiDockRuntime`、WebSocket (8765)、机器人启动/更新检查 bootstrap (8766) 和 WASAPI broker。机器人在启动时访问 `http://<Dock IP>:8766/xiaozhi/ota`；该请求只返回本机 Dock 的认证 WebSocket 配置，不会从机器人侧下载或依赖独立的更新服务。

手动启动：`scripts\start-stackchan-console.ps1 -Owner`。脚本从当前用户 DPAPI 文件读取 token，仅传入 Electron 子进程环境，并在每次启动时自动发现唯一的 Codex/ChatGPT 根进程，因此不会复用失效 PID。

安装当前用户登录自启：`scripts\install-stackchan-dock-autostart.ps1`。它在 Windows 当前用户的“启动”文件夹创建 `StackChan Dock.lnk`，不需要管理员权限，也不保存 token。快捷方式最多等待 Codex/ChatGPT 120 秒就绪；语音捕获仍需要该桌面进程，但机器人启动配置与更新检查已经完全由 Dock 托管。
