#!/usr/bin/env python3
"""StackChan Remote Control - 局域网远程操控工具

通过 HTTP API 远程控制 StackChan 设备：
  - 查询状态、唤醒/停止小智
  - 控制头部舵机角度
  - 设置 LED 颜色
  - 触发庆祝动画
  - 管理提醒
  - 显式确认后重启设备

用法:
  python3 remote_control.py --ip 192.168.0.8 status
  python3 remote_control.py wake
  python3 remote_control.py head --yaw 45 --pitch 30
  python3 remote_control.py reboot --confirm
"""

import argparse
import json
import os
import sys

try:
    import requests
except ImportError:
    print("\033[31m错误: 缺少 requests 库，请运行: pip install requests\033[0m")
    sys.exit(1)

DEFAULT_IP = "192.168.0.8"
PORT = 18080
TOKEN = "stackchan-dev"
TIMEOUT = 5

# ─── 彩色输出 ────────────────────────────────────────────────────────────────

def _supports_color():
    """检测终端是否支持彩色输出"""
    if sys.platform == "win32":
        return False
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()

USE_COLOR = _supports_color()

def _c(text, code):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text

def green(text):  return _c(text, "32")
def red(text):    return _c(text, "31")
def yellow(text): return _c(text, "33")
def cyan(text):   return _c(text, "36")
def bold(text):   return _c(text, "1")


# ─── API 客户端 ──────────────────────────────────────────────────────────────

class StackChanClient:
    """StackChan HTTP API 客户端"""

    def __init__(self, ip, port=PORT, token=TOKEN):
        self.base_url = f"http://{ip}:{port}"
        self.headers = {
            "X-StackChan-Dev-Token": token,
            "Content-Type": "application/json",
        }

    def _get(self, path):
        url = f"{self.base_url}{path}"
        resp = requests.get(url, headers=self.headers, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def _post(self, path, body=None):
        url = f"{self.base_url}{path}"
        resp = requests.post(
            url,
            headers=self.headers,
            json=body,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    def status(self):
        """查询设备状态"""
        return self._get("/dev/status")

    def wake(self):
        """唤醒小智"""
        return self._post("/dev/wake")

    def stop(self):
        """停止小智"""
        return self._post("/dev/stop")

    def mcp_call(self, tool, arguments):
        """调用 MCP 工具；短名称默认走 self.robot.*，完整 self.* 名称原样传递。"""
        full_tool = tool if tool.startswith("self.") else f"self.robot.{tool}"
        body = {
            "tool": full_tool,
            "arguments": arguments,
        }
        return self._post("/dev/mcp/call", body)

    def set_head(self, yaw, pitch, speed=None):
        """设置头部角度"""
        args = {"yaw": float(yaw), "pitch": float(pitch)}
        if speed is not None:
            args["speed"] = float(speed)
        return self.mcp_call("set_head_angles", args)

    def set_head_targets(self, yaw_target, pitch_target, speed):
        """设置头部目标位置"""
        args = {
            "yaw_target": int(yaw_target),
            "pitch_target": int(pitch_target),
            "speed": int(speed),
        }
        return self.mcp_call("set_head_targets", args)

    def get_head_angles(self):
        """获取头部当前角度"""
        return self.mcp_call("get_head_angles", {})

    def set_led(self, r, g, b):
        """设置 LED 颜色"""
        args = {"red": int(r), "green": int(g), "blue": int(b)}
        return self.mcp_call("set_led_color", args)

    def celebrate(self, style, duration_ms=None, intensity=None, sound=False):
        """触发庆祝动画"""
        body = {"style": style, "sound": sound}
        if duration_ms is not None:
            body["duration_ms"] = int(duration_ms)
        if intensity is not None:
            body["intensity"] = int(intensity)
        return self._post("/dev/celebrate", body)

    def create_reminder(self, duration, message, repeat=False):
        """创建提醒"""
        args = {
            "duration_seconds": int(duration),
            "message": str(message),
            "repeat": bool(repeat),
        }
        return self.mcp_call("create_reminder", args)

    def get_reminders(self):
        """获取提醒列表"""
        return self.mcp_call("get_reminders", {})

    def stop_reminder(self, reminder_id):
        """停止提醒"""
        return self.mcp_call("stop_reminder", {"id": int(reminder_id)})

    def play_sound(self, name):
        """播放内置音效"""
        return self._post("/dev/play_sound", {"sound": name})

    def inject_prompt(self):
        """唤醒小智并注入嵌入式语音 prompt"""
        return self._post("/dev/inject_prompt")

    def configure_xiaozhi_local(self, bootstrap_url, pairing_token):
        """配置本地 XiaoZhi bootstrap；pairing token 仅存在于请求体。"""
        return self._post(
            "/dev/xiaozhi-local",
            {"url": str(bootstrap_url), "key": str(pairing_token)},
        )

    def reboot(self, delay_ms=1500, reason="remote_control"):
        """通过完整 MCP 工具名请求系统重启。"""
        return self.mcp_call(
            "self.system.reboot",
            {"confirm": True, "delay_ms": int(delay_ms), "reason": str(reason)},
        )


# ─── 命令处理 ────────────────────────────────────────────────────────────────

def cmd_status(client, args):
    data = client.status()
    print(bold("═══ StackChan 设备状态 ═══"))
    print(f"  版本:     {cyan(data.get('version', 'N/A'))}")
    print(f"  IP:       {data.get('ip', 'N/A')}")
    print(f"  状态:     {green(data.get('state', 'N/A'))}")
    print(f"  空闲内存: {data.get('heap_free', 'N/A')} bytes")
    print(f"  WiFi信号: {data.get('wifi_rssi', 'N/A')} dBm")


def cmd_wake(client, args):
    resp = client.wake()
    if resp.get("ok"):
        print(green("✓ 小智已唤醒"))
    else:
        print(red(f"✗ 唤醒失败: {resp.get('error', '未知错误')}"))


def cmd_stop(client, args):
    resp = client.stop()
    if resp.get("ok"):
        print(green("✓ 小智已停止"))
    else:
        print(red(f"✗ 停止失败: {resp.get('error', '未知错误')}"))


def cmd_head(client, args):
    resp = client.set_head(args.yaw, args.pitch, args.speed)
    if resp.get("ok"):
        speed_info = f", speed={args.speed}" if args.speed else ""
        print(green(f"✓ 头部已设置: yaw={args.yaw}, pitch={args.pitch}{speed_info}"))
    else:
        print(red(f"✗ 设置失败: {resp.get('error', '未知错误')}"))


def cmd_led(client, args):
    resp = client.set_led(args.r, args.g, args.b)
    if resp.get("ok"):
        print(green(f"✓ LED 已设置: R={args.r} G={args.g} B={args.b}"))
    else:
        print(red(f"✗ 设置失败: {resp.get('error', '未知错误')}"))


def cmd_celebrate(client, args):
    resp = client.celebrate(
        style=args.style,
        duration_ms=args.duration_ms,
        intensity=args.intensity,
        sound=args.sound,
    )
    if resp.get("ok"):
        print(green(f"✓ 庆祝动画已触发: style={args.style}"))
    else:
        print(red(f"✗ 触发失败: {resp.get('error', '未知错误')}"))


def cmd_mcp(client, args):
    try:
        arguments = json.loads(args.args) if args.args else {}
    except json.JSONDecodeError as e:
        print(red(f"✗ JSON 参数解析失败: {e}"))
        sys.exit(1)
    resp = client.mcp_call(args.tool, arguments)
    if resp.get("ok"):
        print(green(f"✓ MCP 调用成功: {args.tool}"))
    else:
        print(red(f"✗ MCP 调用失败: {resp.get('error', '未知错误')}"))
    # 打印完整返回
    print(cyan(json.dumps(resp, indent=2, ensure_ascii=False)))


def cmd_reminder(client, args):
    resp = client.create_reminder(args.duration, args.message, args.repeat)
    if resp.get("ok"):
        print(green(f"✓ 提醒已创建: {args.duration}秒后 \"{args.message}\""))
    else:
        print(red(f"✗ 创建失败: {resp.get('error', '未知错误')}"))


def cmd_reminders(client, args):
    resp = client.get_reminders()
    if resp.get("ok"):
        print(bold("═══ 提醒列表 ═══"))
        print(cyan(json.dumps(resp, indent=2, ensure_ascii=False)))
    else:
        print(red(f"✗ 获取失败: {resp.get('error', '未知错误')}"))


def cmd_stop_reminder(client, args):
    resp = client.stop_reminder(args.id)
    if resp.get("ok"):
        print(green(f"✓ 提醒 #{args.id} 已停止"))
    else:
        print(red(f"✗ 停止失败: {resp.get('error', '未知错误')}"))


def cmd_play_sound(client, args):
    resp = client.play_sound(args.name)
    if resp.get("ok"):
        print(green(f"✓ 音效已播放: {args.name}"))
    else:
        print(red(f"✗ 播放失败: {resp.get('error', '未知错误')}"))


def cmd_inject_prompt(client, args):
    resp = client.inject_prompt()
    if resp.get("ok"):
        msg = resp.get("message", "started")
        print(green(f"✓ Prompt 注入已启动: {msg}"))
    else:
        print(red(f"✗ 注入失败: {resp.get('error', '未知错误')}"))


def cmd_reboot(client, args):
    if not args.confirm:
        print(red("✗ 重启需要显式 --confirm"))
        sys.exit(1)
    resp = client.reboot(delay_ms=args.delay_ms, reason=args.reason)
    if resp.get("ok"):
        print(green("✓ 重启请求已接受"))
    else:
        print(red(f"✗ 重启请求失败: {resp.get('error', '未知错误')}"))
    print(cyan(json.dumps(resp, indent=2, ensure_ascii=False)))


def cmd_configure_xiaozhi_local(client, args):
    pairing_token = os.environ.get("STACKCHAN_WIFI_PAIRING_KEY", "")
    if len(pairing_token) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in pairing_token):
        print(red("✗ STACKCHAN_WIFI_PAIRING_KEY 必须是 64 位十六进制值"))
        sys.exit(1)
    if not (args.bootstrap_url.startswith("https://") or args.bootstrap_url.startswith("http://")):
        print(red("✗ bootstrap URL 必须使用 http:// 或 https://"))
        sys.exit(1)
    resp = client.configure_xiaozhi_local(args.bootstrap_url, pairing_token)
    if resp.get("ok") and resp.get("configured") and resp.get("restart_scheduled"):
        print(green("✓ 本地 XiaoZhi Dock 配置已写入，机器人将延迟重启"))
    else:
        print(red(f"✗ 本地 XiaoZhi Dock 配置失败: {resp.get('error', '未知错误')}"))
        sys.exit(1)


# ─── 主入口 ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="StackChan Remote Control - 局域网远程操控工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""示例:
  %(prog)s status                         查询设备状态
  %(prog)s wake                           唤醒小智
  %(prog)s head --yaw 45 --pitch 30       控制头部
  %(prog)s led --r 168 --g 0 --b 0        设置 LED 红色
  %(prog)s celebrate --style cheer        庆祝动画
  %(prog)s reboot --confirm               显式确认后重启设备
  %(prog)s mcp --tool get_head_angles     通用 MCP 调用
""",
    )
    parser.add_argument(
        "--ip", default=DEFAULT_IP,
        help=f"设备 IP 地址 (默认: {DEFAULT_IP})",
    )
    parser.add_argument(
        "--port", type=int, default=PORT,
        help=f"设备端口 (默认: {PORT})",
    )
    parser.add_argument(
        "--token", default=TOKEN,
        help="认证 Token (默认: stackchan-dev)",
    )

    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # status
    sub = subparsers.add_parser("status", help="查询设备状态")
    sub.set_defaults(func=cmd_status)

    # wake
    sub = subparsers.add_parser("wake", help="唤醒小智")
    sub.set_defaults(func=cmd_wake)

    # stop
    sub = subparsers.add_parser("stop", help="停止小智")
    sub.set_defaults(func=cmd_stop)

    # head
    sub = subparsers.add_parser("head", help="控制头部角度")
    sub.add_argument("--yaw", type=float, required=True, help="水平角度 (-128~128)")
    sub.add_argument("--pitch", type=float, required=True, help="俯仰角度 (0~90)")
    sub.add_argument("--speed", type=float, default=None, help="运动速度 (可选)")
    sub.set_defaults(func=cmd_head)

    # led
    sub = subparsers.add_parser("led", help="设置 LED 颜色")
    sub.add_argument("--r", type=int, required=True, help="红色 (0-168)")
    sub.add_argument("--g", type=int, required=True, help="绿色 (0-168)")
    sub.add_argument("--b", type=int, required=True, help="蓝色 (0-168)")
    sub.set_defaults(func=cmd_led)

    # celebrate
    sub = subparsers.add_parser("celebrate", help="触发庆祝动画")
    sub.add_argument(
        "--style", required=True,
        choices=["cheer", "sparkle", "nod", "calm"],
        help="庆祝风格",
    )
    sub.add_argument("--duration-ms", type=int, default=None, help="持续时间 (3200-6000 ms)")
    sub.add_argument("--intensity", type=int, default=None, choices=[1, 2, 3], help="强度 (1-3)")
    sub.add_argument("--sound", action="store_true", help="是否播放声音")
    sub.set_defaults(func=cmd_celebrate)

    # mcp (通用)
    sub = subparsers.add_parser("mcp", help="通用 MCP 工具调用")
    sub.add_argument("--tool", required=True, help="工具名称 (如 set_head_angles)")
    sub.add_argument("--args", default=None, help="JSON 参数 (如 '{\"yaw\": 45}')")
    sub.set_defaults(func=cmd_mcp)

    # reminder
    sub = subparsers.add_parser("reminder", help="创建提醒")
    sub.add_argument("--duration", type=int, required=True, help="倒计时秒数")
    sub.add_argument("--message", required=True, help="提醒消息")
    sub.add_argument("--repeat", action="store_true", help="是否重复")
    sub.set_defaults(func=cmd_reminder)

    # reminders
    sub = subparsers.add_parser("reminders", help="获取提醒列表")
    sub.set_defaults(func=cmd_reminders)

    # stop-reminder
    sub = subparsers.add_parser("stop-reminder", help="停止提醒")
    sub.add_argument("--id", type=int, required=True, help="提醒 ID")
    sub.set_defaults(func=cmd_stop_reminder)

    # play-sound
    sub = subparsers.add_parser("play-sound", help="Play a built-in sound effect")
    sub.add_argument("name", help="Sound name: success, welcome, activation, exclamation, popup, vibration, upgrade, low_battery, err_pin, err_reg, wificonfig, camera_shutter, new_notification, 0-9")
    sub.set_defaults(func=cmd_play_sound)

    # inject-prompt
    sub = subparsers.add_parser("inject-prompt", help="Wake XiaoZhi and inject embedded voice prompt")
    sub.set_defaults(func=cmd_inject_prompt)

    # configure-xiaozhi-local
    sub = subparsers.add_parser("configure-xiaozhi-local", help="Configure the authenticated local XiaoZhi Dock")
    sub.add_argument("--bootstrap-url", required=True, help="Local XiaoZhi HTTP(S) bootstrap URL")
    sub.set_defaults(func=cmd_configure_xiaozhi_local)

    # reboot
    sub = subparsers.add_parser("reboot", help="Reboot device via self.system.reboot MCP tool (requires --confirm)")
    sub.add_argument("--confirm", action="store_true", required=True, help="required explicit confirmation")
    sub.add_argument("--delay-ms", type=int, default=1500, help="delay before reboot; firmware clamps to 500..10000 ms")
    sub.add_argument("--reason", default="remote_control", help="reboot reason passed to firmware")
    sub.set_defaults(func=cmd_reboot)

    # 解析
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    # 创建客户端并执行
    client = StackChanClient(ip=args.ip, port=args.port, token=args.token)

    try:
        args.func(client, args)
    except requests.exceptions.ConnectTimeout:
        print(red(f"✗ 连接超时: 无法连接到 {args.ip}:{args.port}"))
        print(yellow("  请检查设备是否在线，IP 是否正确"))
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print(red(f"✗ 连接失败: 无法连接到 {args.ip}:{args.port}"))
        print(yellow("  请检查设备是否在线，网络是否可达"))
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response is not None else "N/A"
        if status_code == 401 or status_code == 403:
            print(red("✗ 认证失败: Token 无效或已过期"))
        else:
            print(red(f"✗ HTTP 错误 {status_code}: {e}"))
        sys.exit(1)
    except requests.exceptions.Timeout:
        print(red(f"✗ 请求超时 ({TIMEOUT}s)"))
        sys.exit(1)
    except KeyboardInterrupt:
        print(yellow("\n已取消"))
        sys.exit(0)


if __name__ == "__main__":
    main()
