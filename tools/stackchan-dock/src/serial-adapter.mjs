import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CdcTransport } from "./transport.mjs";

const execFileAsync = promisify(execFile);

export const USB_IDENTITY = Object.freeze({ vendorId: "303A", productId: "8001", interfaceNumber: 3 });

function normalizedHex(value) {
  return String(value ?? "").replace(/^0x/i, "").toUpperCase().padStart(4, "0");
}

function interfaceNumber(port) {
  const match = String(port.pnpId ?? "").match(/&MI_([0-9A-F]{2})/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function normalizedSerial(value) {
  return String(value ?? "").replace(/[:-]/g, "").toUpperCase();
}

export async function resolveUsbParentIdentity(port, { run = execFileAsync } = {}) {
  if (process.platform !== "win32" || !String(port.pnpId ?? "").startsWith("USB\\")) return port;
  const command = [
    "$parent=(Get-PnpDeviceProperty -InstanceId $env:STACKCHAN_PNP_INSTANCE_ID",
    "-KeyName 'DEVPKEY_Device_Parent' -ErrorAction Stop).Data;",
    "[Console]::Out.Write($parent)",
  ].join(" ");
  const { stdout } = await run(
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { env: { ...process.env, STACKCHAN_PNP_INSTANCE_ID: port.pnpId }, windowsHide: true },
  );
  const parentId = String(stdout).trim();
  const match = parentId.match(/^USB\\VID_303A&PID_8001\\([^\\]+)$/i);
  if (!match) throw new Error(`unexpected Stack-chan USB parent identity: ${parentId}`);
  return { ...port, usbSerial: normalizedSerial(match[1]), usbParentId: parentId };
}

export function filterCompanionPorts(ports, { preferredSerial } = {}) {
  const matches = ports.filter((port) => {
    if (normalizedHex(port.vendorId) !== USB_IDENTITY.vendorId ||
        normalizedHex(port.productId) !== USB_IDENTITY.productId) return false;
    const detectedInterface = interfaceNumber(port);
    if (detectedInterface !== null && detectedInterface !== USB_IDENTITY.interfaceNumber) return false;
    const stableSerial = port.usbSerial ?? port.serialNumber;
    if (preferredSerial && normalizedSerial(stableSerial) !== normalizedSerial(preferredSerial)) return false;
    return true;
  });
  return matches.sort((left, right) => String(left.path).localeCompare(String(right.path)));
}

export class AmbiguousCompanionError extends Error {
  constructor(ports) {
    super(`multiple Stack-chan CDC interfaces matched: ${ports.map((port) => port.path).join(", ")}`);
    this.name = "AmbiguousCompanionError";
    this.ports = ports;
  }
}

export async function discoverCompanionPort({
  preferredSerial,
  serialPortClass,
  resolveIdentity = resolveUsbParentIdentity,
} = {}) {
  const SerialPortClass = serialPortClass ?? (await import("serialport")).SerialPort;
  const candidates = filterCompanionPorts(await SerialPortClass.list());
  const identified = await Promise.all(candidates.map((port) => resolveIdentity(port)));
  const matches = filterCompanionPorts(identified, { preferredSerial });
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new AmbiguousCompanionError(matches);
  return matches[0];
}

export async function openSerialTransport(device, options = {}) {
  const { SerialPort } = await import("serialport");
  const port = new SerialPort({ path: device.path, baudRate: 115200, autoOpen: false });
  return new CdcTransport(port, options);
}
