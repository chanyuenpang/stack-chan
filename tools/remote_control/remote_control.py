#!/usr/bin/env python3
"""StackChan Remote Control - 统一设备控制 CLI

通过统一 transport 入口远程控制 StackChan 设备：
  - 查询状态、唤醒/停止/切换小智
  - 支持 LAN(HTTP)、USB(serial)、AUTO(优先 LAN，失败后回退 USB)
  - USB 优先走 JSON line，旧固件自动回退 legacy 基础命令

用法:
  python3 remote_control.py status
  python3 remote_control.py --transport lan --ip 192.168.0.8 wake
  python3 remote_control.py --transport usb --device /dev/ttyACM0 stop
  python3 remote_control.py --transport auto reboot --confirm --reason maintenance
  python3 remote_control.py inject-prompt --prompt "把灯光设置成紫色"
"""

import argparse
import json
import sys
import time
import uuid
from typing import Optional

try:
    import requests
except ImportError:
    print("\033[31m错误: 缺少 requests 库，请运行: pip install requests\033[0m")
    sys.exit(1)

try:
    import serial
    from serial import SerialException
except ImportError:
    serial = None

    class SerialException(Exception):
        pass


DEFAULT_IP = "192.168.0.8"
PORT = 18080
TOKEN = "stackchan-dev"
TIMEOUT = 5
DEFAULT_DEVICE = "/dev/ttyACM0"
USB_BAUDRATE = 115200
USB_TIMEOUT = 5
USB_WRITE_TIMEOUT = 0.5
USB_DRAIN_WINDOW = 0.2
USB_POST_OPEN_SETTLE = 0.05
USB_INTER_WRITE_WAIT = 0.05
USB_SUPPORTED_COMMANDS = {"status", "wake", "stop", "toggle", "reboot", "mcp", "head", "led", "celebrate", "reminder", "reminders", "stop-reminder", "play-sound", "capabilities"}
LEGACY_USB_SUPPORTED_COMMANDS = {"status", "wake", "stop", "toggle", "reboot"}
LAN_ONLY_COMMANDS = {"inject-prompt"}


# ─── 彩色输出 ────────────────────────────────────────────────────────────────

def _supports_color():
    """检测终端是否支持彩色输出"""
    if sys.platform == "win32":
        return False
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


USE_COLOR = _supports_color()


def _c(text, code):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def green(text): return _c(text, "32")
def red(text): return _c(text, "31")
def yellow(text): return _c(text, "33")
def cyan(text): return _c(text, "36")
def bold(text): return _c(text, "1")


# ─── 异常/能力 ───────────────────────────────────────────────────────────────

class RemoteControlError(Exception):
    """统一控制错误"""


class UnsupportedCommandError(RemoteControlError):
    """当前 transport 不支持该命令"""


class LanTransportError(RemoteControlError):
    """LAN transport 错误"""


class UsbTransportError(RemoteControlError):
    """USB transport 错误"""


def command_supports_usb(command: str) -> bool:
    return command in USB_SUPPORTED_COMMANDS


# ─── 传输客户端 ──────────────────────────────────────────────────────────────

class StackChanHttpClient:
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
        return self._get("/dev/status")

    def wake(self):
        return self._post("/dev/wake")

    def stop(self):
        return self._post("/dev/stop")

    def toggle(self):
        return self._post("/dev/toggle")

    def mcp_call(self, tool, arguments):
        full_tool = tool if tool.startswith("self.") else f"self.robot.{tool}"
        body = {
            "tool": full_tool,
            "arguments": arguments,
        }
        return self._post("/dev/mcp/call", body)

    def set_head(self, yaw, pitch, speed=None):
        args = {"yaw": float(yaw), "pitch": float(pitch)}
        if speed is not None:
            args["speed"] = float(speed)
        return self.mcp_call("set_head_angles", args)

    def set_led(self, r, g, b):
        args = {"red": int(r), "green": int(g), "blue": int(b)}
        return self.mcp_call("set_led_color", args)

    def celebrate(self, style, duration_ms=None, intensity=None, sound=False):
        body = {"style": style, "sound": sound}
        if duration_ms is not None:
            body["duration_ms"] = int(duration_ms)
        if intensity is not None:
            body["intensity"] = int(intensity)
        return self._post("/dev/celebrate", body)

    def create_reminder(self, duration, message, repeat=False):
        args = {
            "duration_seconds": int(duration),
            "message": str(message),
            "repeat": bool(repeat),
        }
        return self.mcp_call("create_reminder", args)

    def get_reminders(self):
        return self.mcp_call("get_reminders", {})

    def stop_reminder(self, reminder_id):
        return self.mcp_call("stop_reminder", {"id": int(reminder_id)})

    def play_sound(self, name):
        return self._post("/dev/play_sound", {"sound": name})

    def inject_prompt(self, prompt):
        return self._post("/dev/inject_prompt", {"prompt": str(prompt)})

    def reboot(self, delay_ms=1500, reason="remote_control"):
        return self._post(
            "/dev/reboot",
            {"confirm": True, "delay_ms": int(delay_ms), "reason": str(reason)},
        )


class StackChanUsbClient:
    """StackChan USB serial 客户端"""

    def __init__(self, device=DEFAULT_DEVICE, baudrate=USB_BAUDRATE, timeout=USB_TIMEOUT):
        self.device = device
        self.baudrate = baudrate
        self.timeout = timeout
        self._json_protocol_available = None

    def _ensure_available(self):
        if serial is None:
            raise UsbTransportError("缺少 pyserial 库，请运行: pip install pyserial")

    def _open_serial(self):
        kwargs = dict(
            timeout=self.timeout,
            write_timeout=USB_WRITE_TIMEOUT,
            inter_byte_timeout=0.1,
            rtscts=False,
            dsrdtr=False,
            xonxoff=False,
        )
        try:
            ser = serial.Serial(self.device, self.baudrate, exclusive=True, **kwargs)
        except TypeError:
            ser = serial.Serial(self.device, self.baudrate, **kwargs)
        except SerialException as e:
            if "exclusive lock" not in str(e).lower():
                raise
            ser = serial.Serial(self.device, self.baudrate, **kwargs)
        try:
            ser.dtr = False
            ser.rts = False
        except Exception:
            pass
        time.sleep(USB_POST_OPEN_SETTLE)
        return ser

    def _drain_initial_noise(self, ser, window: float = USB_DRAIN_WINDOW):
        deadline = time.monotonic() + max(window, 0)
        last_data_at = None
        while time.monotonic() < deadline:
            waiting = getattr(ser, "in_waiting", 0)
            if waiting:
                ser.read(waiting)
                last_data_at = time.monotonic()
                deadline = max(deadline, last_data_at + 0.05)
            else:
                time.sleep(0.01)
        return last_data_at is not None

    def _read_json_response(self, ser, request_id: str):
        while True:
            raw = ser.readline()
            if not raw:
                raise UsbTransportError(f"USB 响应超时: {self.device}")
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if payload.get("id") != request_id:
                continue
            if payload.get("v") != 1:
                continue
            if payload.get("ok"):
                result = payload.get("result")
                if isinstance(result, dict):
                    return result
                if isinstance(result, list):
                    return {"ok": True, "result": result}
                if result is True or result is None:
                    return {"ok": True}
                return {"ok": True, "result": result}
            return {"ok": False, "error": payload.get("error", "unknown_error")}

    def _send_json_command(self, command: str, args=None):
        request_id = uuid.uuid4().hex
        payload = {"v": 1, "id": request_id, "command": command, "args": args or {}}
        try:
            with self._open_serial() as ser:
                self._drain_initial_noise(ser)
                time.sleep(USB_INTER_WRITE_WAIT)
                ser.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
                ser.flush()
                return self._read_json_response(ser, request_id)
        except SerialException as e:
            raise UsbTransportError(f"USB 连接失败: {self.device}: {e}") from e

    def _send_legacy_command(self, command_line: str):
        try:
            with self._open_serial() as ser:
                self._drain_initial_noise(ser)
                time.sleep(USB_INTER_WRITE_WAIT)
                ser.write((command_line + "\n").encode("utf-8"))
                ser.flush()

                while True:
                    raw = ser.readline()
                    if not raw:
                        raise UsbTransportError(f"USB 响应超时: {self.device}")
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        return json.loads(line)
                    except json.JSONDecodeError:
                        continue
        except SerialException as e:
            raise UsbTransportError(f"USB 连接失败: {self.device}: {e}") from e

    def _send_command(self, command: str, args=None, legacy_command_line: Optional[str] = None):
        self._ensure_available()
        if self._json_protocol_available is not False:
            try:
                response = self._send_json_command(command, args)
                self._json_protocol_available = True
                return response
            except UsbTransportError:
                raise
            except Exception:
                self._json_protocol_available = False
                if legacy_command_line is None:
                    raise UsbTransportError(f"USB JSON 协议不可用，且命令 {command} 无 legacy fallback")

        if legacy_command_line is None:
            raise UnsupportedCommandError(f"command '{command}' is unsupported for legacy usb transport")
        return self._send_legacy_command(legacy_command_line)

    def status(self):
        return self._send_command("status", {}, "status")

    def wake(self):
        return self._send_command("wake", {}, "wake")

    def stop(self):
        return self._send_command("stop", {}, "stop")

    def toggle(self):
        return self._send_command("toggle", {}, "toggle")

    def reboot(self, delay_ms=1500, reason="remote_control"):
        safe_reason = str(reason).replace(" ", "_")
        return self._send_command(
            "reboot",
            {"confirm": True, "delay_ms": int(delay_ms), "reason": str(reason)},
            f"reboot confirm delay_ms={int(delay_ms)} reason={safe_reason}",
        )

    def capabilities(self):
        return self._send_command("capabilities", {})

    def mcp_call(self, tool, arguments):
        full_tool = tool if tool.startswith("self.") else f"self.robot.{tool}"
        return self._send_command("mcp_call", {"tool": full_tool, "arguments": arguments or {}})

    def set_head(self, yaw, pitch, speed=None):
        args = {"yaw": float(yaw), "pitch": float(pitch)}
        if speed is not None:
            args["speed"] = float(speed)
        return self.mcp_call("set_head_angles", args)

    def set_led(self, r, g, b):
        return self.mcp_call("set_led_color", {"red": int(r), "green": int(g), "blue": int(b)})

    def celebrate(self, style, duration_ms=None, intensity=None, sound=False):
        body = {"style": style, "sound": bool(sound)}
        if duration_ms is not None:
            body["duration_ms"] = int(duration_ms)
        if intensity is not None:
            body["intensity"] = int(intensity)
        return self._send_command("celebrate", body)

    def create_reminder(self, duration, message, repeat=False):
        return self.mcp_call("create_reminder", {
            "duration_seconds": int(duration),
            "message": str(message),
            "repeat": bool(repeat),
        })

    def get_reminders(self):
        return self.mcp_call("get_reminders", {})

    def stop_reminder(self, reminder_id):
        return self.mcp_call("stop_reminder", {"id": int(reminder_id)})

    def play_sound(self, name):
        return self._send_command("play_sound", {"sound": str(name)})

    def inject_prompt(self, prompt):
        raise UnsupportedCommandError("command 'inject-prompt' is only supported for lan transport")


class UnifiedStackChanClient:
    """统一 transport 客户端"""

    def __init__(self, args):
        self.transport = args.transport
        self.http = StackChanHttpClient(ip=args.ip, port=args.port, token=args.token)
        self.usb = StackChanUsbClient(device=args.device)
        self.args = args

    def _call_lan(self, method_name: str, *call_args, **call_kwargs):
        try:
            method = getattr(self.http, method_name)
            return method(*call_args, **call_kwargs)
        except requests.exceptions.RequestException as e:
            raise LanTransportError(str(e)) from e

    def _call_usb(self, command_name: str, method_name: str, *call_args, **call_kwargs):
        if not command_supports_usb(command_name):
            raise UnsupportedCommandError(f"command '{command_name}' is unsupported for usb transport")
        method = getattr(self.usb, method_name)
        return method(*call_args, **call_kwargs)

    def _call_auto(self, command: str, lan_method: str, usb_method: Optional[str] = None, *call_args, **call_kwargs):
        usb_method = usb_method or lan_method
        try:
            return self._call_lan(lan_method, *call_args, **call_kwargs)
        except LanTransportError as lan_error:
            if not command_supports_usb(command):
                raise lan_error
            return self._call_usb(command, usb_method, *call_args, **call_kwargs)

    def status(self):
        if self.transport == "lan":
            return self._call_lan("status")
        if self.transport == "usb":
            return self._call_usb("status", "status")
        return self._call_auto("status", "status")

    def wake(self):
        if self.transport == "lan":
            return self._call_lan("wake")
        if self.transport == "usb":
            return self._call_usb("wake", "wake")
        return self._call_auto("wake", "wake")

    def stop(self):
        if self.transport == "lan":
            return self._call_lan("stop")
        if self.transport == "usb":
            return self._call_usb("stop", "stop")
        return self._call_auto("stop", "stop")

    def toggle(self):
        if self.transport == "lan":
            return self._call_lan("toggle")
        if self.transport == "usb":
            return self._call_usb("toggle", "toggle")
        return self._call_auto("toggle", "toggle")

    def reboot(self, delay_ms=1500, reason="remote_control"):
        if self.transport == "lan":
            return self._call_lan("reboot", delay_ms=delay_ms, reason=reason)
        if self.transport == "usb":
            return self._call_usb("reboot", "reboot", delay_ms=delay_ms, reason=reason)
        return self._call_auto("reboot", "reboot", delay_ms=delay_ms, reason=reason)

    def mcp_call(self, tool, arguments):
        if self.transport == "lan":
            return self._call_lan("mcp_call", tool, arguments)
        if self.transport == "usb":
            return self._call_usb("mcp", "mcp_call", tool, arguments)
        return self._call_auto("mcp", "mcp_call", "mcp_call", tool, arguments)

    def set_head(self, yaw, pitch, speed=None):
        if self.transport == "lan":
            return self._call_lan("set_head", yaw, pitch, speed)
        if self.transport == "usb":
            return self._call_usb("head", "set_head", yaw, pitch, speed)
        return self._call_auto("head", "set_head", "set_head", yaw, pitch, speed)

    def set_led(self, r, g, b):
        if self.transport == "lan":
            return self._call_lan("set_led", r, g, b)
        if self.transport == "usb":
            return self._call_usb("led", "set_led", r, g, b)
        return self._call_auto("led", "set_led", "set_led", r, g, b)

    def celebrate(self, style, duration_ms=None, intensity=None, sound=False):
        if self.transport == "lan":
            return self._call_lan("celebrate", style, duration_ms, intensity, sound)
        if self.transport == "usb":
            return self._call_usb("celebrate", "celebrate", style, duration_ms, intensity, sound)
        return self._call_auto("celebrate", "celebrate", "celebrate", style, duration_ms, intensity, sound)

    def create_reminder(self, duration, message, repeat=False):
        if self.transport == "lan":
            return self._call_lan("create_reminder", duration, message, repeat)
        if self.transport == "usb":
            return self._call_usb("reminder", "create_reminder", duration, message, repeat)
        return self._call_auto("reminder", "create_reminder", "create_reminder", duration, message, repeat)

    def get_reminders(self):
        if self.transport == "lan":
            return self._call_lan("get_reminders")
        if self.transport == "usb":
            return self._call_usb("reminders", "get_reminders")
        return self._call_auto("reminders", "get_reminders", "get_reminders")

    def stop_reminder(self, reminder_id):
        if self.transport == "lan":
            return self._call_lan("stop_reminder", reminder_id)
        if self.transport == "usb":
            return self._call_usb("stop-reminder", "stop_reminder", reminder_id)
        return self._call_auto("stop-reminder", "stop_reminder", "stop_reminder", reminder_id)

    def play_sound(self, name):
        if self.transport == "lan":
            return self._call_lan("play_sound", name)
        if self.transport == "usb":
            return self._call_usb("play-sound", "play_sound", name)
        return self._call_auto("play-sound", "play_sound", "play_sound", name)

    def inject_prompt(self, prompt):
        if self.transport == "lan":
            return self._call_lan("inject_prompt", prompt)
        if self.transport == "usb":
            raise UnsupportedCommandError("command 'inject-prompt' is only supported for lan transport")
        return self._call_lan("inject_prompt", prompt)

    def capabilities(self):
        if self.transport == "lan":
            return {"ok": True, "transport": "lan", "commands": sorted(USB_SUPPORTED_COMMANDS | {"play-sound"})}
        if self.transport == "usb":
            return self._call_usb("capabilities", "capabilities")
        try:
            return {"ok": True, "transport": "lan", "commands": sorted(USB_SUPPORTED_COMMANDS | {"play-sound"})}
        except LanTransportError:
            return self._call_usb("capabilities", "capabilities")


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


def cmd_toggle(client, args):
    resp = client.toggle()
    if resp.get("ok"):
        print(green("✓ 小智状态已切换"))
    else:
        print(red(f"✗ 切换失败: {resp.get('error', '未知错误')}"))


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
    prompt = getattr(args, "prompt", None)
    sample = getattr(args, "sample", None)

    if prompt and sample:
        print(red("✗ --prompt 与 --sample 不能同时使用"))
        sys.exit(1)
    if not prompt:
        print(red("✗ inject-prompt 需要指定 --prompt <文本>"))
        sys.exit(1)

    resp = client.inject_prompt(prompt)
    if resp.get("ok"):
        msg = resp.get("message", "started")
        print(green(f"✓ Prompt 注入已启动: {msg}"))
    else:
        print(red(f"✗ 注入失败: {resp.get('error', '未知错误')}"))


def cmd_capabilities(client, args):
    resp = client.capabilities()
    if resp.get("ok"):
        print(green("✓ 能力查询成功"))
    else:
        print(red(f"✗ 能力查询失败: {resp.get('error', '未知错误')}"))
    print(cyan(json.dumps(resp, indent=2, ensure_ascii=False)))


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


# ─── 主入口 ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="StackChan Remote Control - 统一 LAN/USB 设备控制工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""示例:
  %(prog)s status
  %(prog)s --transport lan --ip 192.168.0.8 wake
  %(prog)s --transport usb --device /dev/ttyACM0 stop
  %(prog)s --transport auto toggle
  %(prog)s inject-prompt --prompt "你好，请帮我数到三"
  %(prog)s reboot --confirm --delay-ms 2000 --reason maintenance
  %(prog)s head --yaw 45 --pitch 30
  %(prog)s mcp --tool get_head_angles
  %(prog)s capabilities --transport usb
""",
    )
    parser.add_argument(
        "--transport",
        choices=["auto", "lan", "usb"],
        default="auto",
        help="传输方式: auto=优先 LAN 失败后回退 USB；lan=强制 HTTP；usb=强制 serial",
    )
    parser.add_argument(
        "--ip", default=DEFAULT_IP,
        help=f"设备 IP 地址，仅 LAN/auto 使用 (默认: {DEFAULT_IP})",
    )
    parser.add_argument(
        "--port", type=int, default=PORT,
        help=f"设备端口，仅 LAN/auto 使用 (默认: {PORT})",
    )
    parser.add_argument(
        "--token", default=TOKEN,
        help="认证 Token，仅 LAN/auto 使用 (默认: stackchan-dev)",
    )
    parser.add_argument(
        "--device", default=DEFAULT_DEVICE,
        help=f"USB 串口设备，仅 usb/auto 使用 (默认: {DEFAULT_DEVICE})",
    )

    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    sub = subparsers.add_parser("status", help="查询设备状态 (lan/usb/auto)")
    sub.set_defaults(func=cmd_status)

    sub = subparsers.add_parser("wake", help="唤醒小智 (lan/usb/auto)")
    sub.set_defaults(func=cmd_wake)

    sub = subparsers.add_parser("stop", help="停止小智 (lan/usb/auto)")
    sub.set_defaults(func=cmd_stop)

    sub = subparsers.add_parser("toggle", help="切换小智状态 (lan/usb/auto)")
    sub.set_defaults(func=cmd_toggle)

    sub = subparsers.add_parser("head", help="控制头部角度 (lan/usb/auto)")
    sub.add_argument("--yaw", type=float, required=True, help="水平角度 (-128~128)")
    sub.add_argument("--pitch", type=float, required=True, help="俯仰角度 (0~90)")
    sub.add_argument("--speed", type=float, default=None, help="运动速度 (可选)")
    sub.set_defaults(func=cmd_head)

    sub = subparsers.add_parser("led", help="设置 LED 颜色 (lan/usb/auto)")
    sub.add_argument("--r", type=int, required=True, help="红色 (0-168)")
    sub.add_argument("--g", type=int, required=True, help="绿色 (0-168)")
    sub.add_argument("--b", type=int, required=True, help="蓝色 (0-168)")
    sub.set_defaults(func=cmd_led)

    sub = subparsers.add_parser("celebrate", help="触发庆祝动画 (lan/usb/auto)")
    sub.add_argument(
        "--style", required=True,
        choices=["cheer", "sparkle", "nod", "calm"],
        help="庆祝风格",
    )
    sub.add_argument("--duration-ms", type=int, default=None, help="持续时间 (3200-6000 ms)")
    sub.add_argument("--intensity", type=int, default=None, choices=[1, 2, 3], help="强度 (1-3)")
    sub.add_argument("--sound", action="store_true", help="是否播放声音")
    sub.set_defaults(func=cmd_celebrate)

    sub = subparsers.add_parser("mcp", help="通用 MCP 工具调用 (lan/usb/auto)")
    sub.add_argument("--tool", required=True, help="工具名称 (如 set_head_angles)")
    sub.add_argument("--args", default=None, help="JSON 参数 (如 '{\"yaw\": 45}')")
    sub.set_defaults(func=cmd_mcp)

    sub = subparsers.add_parser("reminder", help="创建提醒 (lan/usb/auto)")
    sub.add_argument("--duration", type=int, required=True, help="倒计时秒数")
    sub.add_argument("--message", required=True, help="提醒消息")
    sub.add_argument("--repeat", action="store_true", help="是否重复")
    sub.set_defaults(func=cmd_reminder)

    sub = subparsers.add_parser("reminders", help="获取提醒列表 (lan/usb/auto)")
    sub.set_defaults(func=cmd_reminders)

    sub = subparsers.add_parser("stop-reminder", help="停止提醒 (lan/usb/auto)")
    sub.add_argument("--id", type=int, required=True, help="提醒 ID")
    sub.set_defaults(func=cmd_stop_reminder)

    sub = subparsers.add_parser("play-sound", help="Play a built-in sound effect (lan/usb/auto)")
    sub.add_argument("name", help="Sound name: success, welcome, activation, exclamation, popup, vibration, upgrade, low_battery, err_pin, err_reg, wificonfig, camera_shutter, new_notification, 0-9")
    sub.set_defaults(func=cmd_play_sound)

    sub = subparsers.add_parser("inject-prompt", help="通过 LAN 注入任意 Prompt 文本")
    sub.add_argument("--prompt", help="要注入的任意文本")
    sub.add_argument("--sample", choices=["short", "tts"], help=argparse.SUPPRESS)
    sub.set_defaults(func=cmd_inject_prompt)

    sub = subparsers.add_parser("capabilities", help="查询当前 transport 的能力面")
    sub.set_defaults(func=cmd_capabilities)

    sub = subparsers.add_parser("reboot", help="Reboot device (lan/usb/auto; requires --confirm)")
    sub.add_argument("--confirm", action="store_true", required=True, help="required explicit confirmation")
    sub.add_argument("--delay-ms", type=int, default=1500, help="delay before reboot; firmware clamps to 500..10000 ms")
    sub.add_argument("--reason", default="remote_control", help="reboot reason passed to firmware; USB 会将空格替换为下划线")
    sub.set_defaults(func=cmd_reboot)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    client = UnifiedStackChanClient(args)

    try:
        args.func(client, args)
    except UnsupportedCommandError as e:
        print(red(f"✗ {e}"))
        sys.exit(2)
    except UsbTransportError as e:
        print(red(f"✗ {e}"))
        sys.exit(1)
    except LanTransportError as e:
        print(red(f"✗ LAN transport 失败: {e}"))
        if args.transport == "auto" and command_supports_usb(args.command):
            print(yellow("  auto 模式已尝试回退 USB，但也失败了或不可用"))
        sys.exit(1)
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
