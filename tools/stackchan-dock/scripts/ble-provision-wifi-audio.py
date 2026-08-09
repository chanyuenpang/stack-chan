#!/usr/bin/env python3
"""Provision a StackChan Wi-Fi Audio Dock through its BLE config characteristic.

Requires: ``python -m pip install bleak``
The pairing key is accepted only as a command argument and is never logged.
"""

import argparse
import asyncio
import json
import os
import re

from bleak import BleakClient, BleakScanner


CONFIG_CHARACTERISTIC = "e2e5e5e3-1234-5678-1234-56789abcdef0"
SUPPORTED_ENDPOINT_SCHEMES = ("http://", "https://", "ws://", "wss://")


def validate_endpoint(endpoint: str) -> str:
    if not endpoint.startswith(SUPPORTED_ENDPOINT_SCHEMES):
        raise ValueError("endpoint must be an http(s) XiaoZhi bootstrap URL or a ws(s) legacy Dock URL")
    return endpoint


async def scan_stackchan() -> None:
    devices = await BleakScanner.discover(timeout=10)
    matches = [device for device in devices if (device.name or "").casefold().startswith("stackchan")]
    if not matches:
        print("No advertising StackChan BLE device was found")
        return
    for device in matches:
        print(f"StackChan BLE device: address={device.address} name={device.name}")


async def resolve_ble_device(address: str):
    """Resolve a Windows BLE address to the freshly-scanned Bleak device.

    WinRT cannot reliably connect using a bare address after the device's
    advertising cache expires. Passing the scan result preserves the native
    device reference required by the Windows backend.
    """
    normalized_address = address.casefold()
    devices = await BleakScanner.discover(timeout=10)
    for device in devices:
        if device.address.casefold() == normalized_address:
            return device
    raise RuntimeError(f"StackChan BLE device {address} was not found during a 10-second scan")


def notification_has_state(notifications: list[str], expected: str) -> bool:
    for notification in notifications:
        try:
            value = json.loads(notification)
        except json.JSONDecodeError:
            continue
        if value.get("cmd") == "notifyState" and value.get("data", {}).get("state") == expected:
            return True
    return False


async def provision(address: str, endpoint: str, pairing_key: str, wifi_ssid: str | None, wifi_password: str | None) -> None:
    notifications: list[str] = []

    def on_notification(_: int, data: bytearray) -> None:
        try:
            notifications.append(data.decode("utf-8"))
        except UnicodeDecodeError:
            notifications.append("<non-text notification>")

    payload = json.dumps(
        {"cmd": "setWifiAudio", "data": {"url": endpoint, "key": pairing_key}},
        separators=(",", ":"),
    ).encode("utf-8")
    device = await resolve_ble_device(address)
    async with BleakClient(device) as client:
        if not client.is_connected:
            raise RuntimeError("could not connect to StackChan")
        await client.start_notify(CONFIG_CHARACTERISTIC, on_notification)
        if wifi_ssid is not None:
            wifi_payload = json.dumps(
                {"cmd": "setWifi", "data": {"ssid": wifi_ssid, "password": wifi_password}},
                separators=(",", ":"),
            ).encode("utf-8")
            await client.write_gatt_char(CONFIG_CHARACTERISTIC, wifi_payload, response=True)
            # The device persists the network credentials before it attempts
            # the asynchronous association, so the Dock endpoint can follow.
            await asyncio.sleep(0.5)
        await client.write_gatt_char(CONFIG_CHARACTERISTIC, payload, response=True)
        await asyncio.sleep(1)
        try:
            await client.stop_notify(CONFIG_CHARACTERISTIC)
        except OSError:
            # WinRT can report an already-cancelled subscription when the
            # peripheral changes radio state after accepting a write.
            pass

    print(f"Provisioned PC Dock endpoint: {endpoint}")
    for notification in notifications:
        print(f"Device notification: {notification}")
    if not notification_has_state(notifications, "wifiAudioConfigured"):
        raise RuntimeError("StackChan did not confirm the PC Dock configuration")


async def configure_wifi(address: str, wifi_ssid: str, wifi_password: str) -> None:
    """Request Wi-Fi association without altering the PC Dock pairing."""
    notifications: list[str] = []

    def on_notification(_: int, data: bytearray) -> None:
        notifications.append(data.decode("utf-8", errors="replace"))

    device = await resolve_ble_device(address)
    payload = json.dumps(
        {"cmd": "setWifi", "data": {"ssid": wifi_ssid, "password": wifi_password}},
        separators=(",", ":"),
    ).encode("utf-8")
    async with BleakClient(device) as client:
        if not client.is_connected:
            raise RuntimeError("could not connect to StackChan")
        await client.start_notify(CONFIG_CHARACTERISTIC, on_notification)
        await client.write_gatt_char(CONFIG_CHARACTERISTIC, payload, response=True)
        await asyncio.sleep(1)
        try:
            await client.stop_notify(CONFIG_CHARACTERISTIC)
        except OSError:
            pass

    print("Requested StackChan Wi-Fi association")
    for notification in notifications:
        print(f"Device notification: {notification}")


async def get_wifi_status(address: str) -> None:
    notifications: list[str] = []

    def on_notification(_: int, data: bytearray) -> None:
        notifications.append(data.decode("utf-8", errors="replace"))

    device = await resolve_ble_device(address)
    async with BleakClient(device) as client:
        if not client.is_connected:
            raise RuntimeError("could not connect to StackChan")
        await client.start_notify(CONFIG_CHARACTERISTIC, on_notification)
        await client.write_gatt_char(
            CONFIG_CHARACTERISTIC,
            b'{"cmd":"getWifiStatus","data":{}}',
            response=True,
        )
        await asyncio.sleep(1)
        try:
            await client.stop_notify(CONFIG_CHARACTERISTIC)
        except OSError:
            pass
    if not notifications:
        raise RuntimeError("StackChan did not return a Wi-Fi status notification")
    for notification in notifications:
        print(f"Device notification: {notification}")


async def get_wifi_audio_status(address: str) -> None:
    """Read non-secret Wi-Fi Audio transport progress from the BLE config channel."""
    notifications: list[str] = []

    def on_notification(_: int, data: bytearray) -> None:
        notifications.append(data.decode("utf-8", errors="replace"))

    device = await resolve_ble_device(address)
    async with BleakClient(device) as client:
        if not client.is_connected:
            raise RuntimeError("could not connect to StackChan")
        await client.start_notify(CONFIG_CHARACTERISTIC, on_notification)
        await client.write_gatt_char(
            CONFIG_CHARACTERISTIC,
            b'{"cmd":"getWifiAudioStatus","data":{}}',
            response=True,
        )
        await asyncio.sleep(1)
        try:
            await client.stop_notify(CONFIG_CHARACTERISTIC)
        except OSError:
            pass
    if not notifications:
        raise RuntimeError("StackChan did not return a Wi-Fi Audio status notification")
    for notification in notifications:
        print(f"Device notification: {notification}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan", action="store_true", help="list advertising StackChan BLE devices without writing")
    parser.add_argument("--address", help="StackChan BLE address from the current Windows scan")
    parser.add_argument("--endpoint", help="http(s) XiaoZhi bootstrap URL or ws(s) legacy Dock endpoint")
    parser.add_argument(
        "--pairing-key",
        default=os.environ.get("STACKCHAN_WIFI_PAIRING_KEY"),
        help="64-character hexadecimal pairing key (or STACKCHAN_WIFI_PAIRING_KEY)",
    )
    parser.add_argument("--wifi-ssid", help="optional 2.4 GHz Wi-Fi network name")
    parser.add_argument("--wifi-password", help="password for --wifi-ssid")
    parser.add_argument("--set-wifi-only", action="store_true", help="request Wi-Fi association without changing Dock pairing")
    parser.add_argument("--get-wifi-status", action="store_true", help="query the current Wi-Fi association state")
    parser.add_argument("--get-wifi-audio-status", action="store_true", help="query non-secret Wi-Fi Audio transport progress")
    args = parser.parse_args()
    if args.scan:
        if any((args.address, args.endpoint, args.pairing_key, args.wifi_ssid, args.wifi_password,
                args.set_wifi_only, args.get_wifi_status, args.get_wifi_audio_status)):
            parser.error("--scan cannot be combined with provisioning or status options")
        asyncio.run(scan_stackchan())
        return
    if args.address is None:
        parser.error("--address is required unless --scan is used")
    if args.get_wifi_status:
        if args.get_wifi_audio_status or args.set_wifi_only or any((args.endpoint, args.pairing_key, args.wifi_ssid, args.wifi_password)):
            parser.error("--get-wifi-status cannot be combined with provisioning options")
        asyncio.run(get_wifi_status(args.address))
        return
    if args.get_wifi_audio_status:
        if args.set_wifi_only or any((args.endpoint, args.pairing_key, args.wifi_ssid, args.wifi_password)):
            parser.error("--get-wifi-audio-status cannot be combined with provisioning options")
        asyncio.run(get_wifi_audio_status(args.address))
        return
    if args.set_wifi_only:
        if args.endpoint is not None or args.pairing_key is not None:
            parser.error("--set-wifi-only cannot be combined with PC Dock options")
        if args.wifi_ssid is None or args.wifi_password is None:
            parser.error("--set-wifi-only requires --wifi-ssid and --wifi-password")
        asyncio.run(configure_wifi(args.address, args.wifi_ssid, args.wifi_password))
        return
    if args.endpoint is None or args.pairing_key is None:
        parser.error("--endpoint and a pairing key argument/environment value are required when provisioning")
    try:
        validate_endpoint(args.endpoint)
    except ValueError as error:
        parser.error(str(error))
    if not re.fullmatch(r"[0-9a-fA-F]{64}", args.pairing_key):
        parser.error("pairing key must be exactly 64 hexadecimal characters")
    if (args.wifi_ssid is None) != (args.wifi_password is None):
        parser.error("--wifi-ssid and --wifi-password must be supplied together")
    asyncio.run(provision(args.address, args.endpoint, args.pairing_key, args.wifi_ssid, args.wifi_password))


if __name__ == "__main__":
    main()
