import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { StackchanDock } from "../src/dock.mjs";
import { COMMAND, encodeRequest, parseFrame, validateCommand } from "../src/protocol.mjs";
import { discoverCompanionPort, filterCompanionPorts } from "../src/serial-adapter.mjs";
import { DeviceStateStore } from "../src/state-store.mjs";
import { CdcTransport } from "../src/transport.mjs";

const baseStatus = (eventSequence = 0, enabled = true) => ({
  device: "stackchan-codex-companion",
  protocol_version: 1,
  event_sequence: eventSequence,
  usb_mounted: true,
  usb_suspended: false,
  sample_rate: 24000,
  audio: { microphone_enabled: enabled, speaker_enabled: enabled, revision: 1 },
  head: { yaw: 0, pitch: 20 },
});

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

function responseFrameOfBytes(targetBytes, { id = 1, prefix = "" } = {}) {
  const value = { v: 1, id, ok: true, result: { diagnostic: prefix } };
  const base = JSON.stringify(value);
  const remaining = targetBytes - Buffer.byteLength(base, "utf8");
  assert.ok(remaining >= 0);
  value.result.diagnostic += "x".repeat(remaining);
  const frame = JSON.stringify(value);
  assert.equal(Buffer.byteLength(frame, "utf8"), targetBytes);
  return frame;
}

class FakeTransport extends EventEmitter {
  constructor(statuses) {
    super();
    this.statuses = [...statuses];
    this.requests = [];
    this.opened = false;
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async request(command, args) {
    this.requests.push({ command, args });
    validateCommand(command, args);
    if (command === COMMAND.GET_STATUS) return structuredClone(this.statuses.shift() ?? baseStatus());
    if (command === COMMAND.SET_AUDIO) return { ...args, revision: 2 };
    return structuredClone(args);
  }
  disconnect() { this.emit("close", new Error("unplugged")); }
}

test("discovery filters VID/PID and CDC interface identity", () => {
  const ports = [
    { path: "COM7", vendorId: "303a", productId: "8001", serialNumber: "A", pnpId: "USB\\VID_303A&PID_8001&MI_03" },
    { path: "COM8", vendorId: "303A", productId: "8001", serialNumber: "A", pnpId: "USB\\VID_303A&PID_8001&MI_04" },
    { path: "COM9", vendorId: "303A", productId: "8000", serialNumber: "A", pnpId: "USB\\VID_303A&PID_8000&MI_03" },
  ];
  assert.deepEqual(filterCompanionPorts(ports, { preferredSerial: "A" }).map((port) => port.path), ["COM7"]);
});

test("discovery resolves and pins the stable composite parent USB serial", async () => {
  const serialPortClass = { list: async () => [{
    path: "COM8",
    vendorId: "303A",
    productId: "8001",
    serialNumber: "7&230CF674&0&0003",
    pnpId: "USB\\VID_303A&PID_8001&MI_03\\7&230CF674&0&0003",
  }] };
  const device = await discoverCompanionPort({
    preferredSerial: "44:1b:f6:e2:78:a8",
    serialPortClass,
    resolveIdentity: async (port) => ({ ...port, usbSerial: "441BF6E278A8" }),
  });
  assert.equal(device.path, "COM8");
  assert.equal(device.usbSerial, "441BF6E278A8");
});

test("protocol rejects arbitrary commands and unchecked fields", () => {
  assert.throws(() => validateCommand("exec", {}), /allowlist/);
  assert.throws(() => validateCommand(COMMAND.SET_LED, { red: 1, green: 2, blue: 3, raw: true }), /not allowed/);
  assert.throws(() => encodeRequest(1, COMMAND.SET_HEAD, { yaw: 0, pitch: 20, speed: 999 }), /100\.\.300/);
  assert.throws(() => encodeRequest(1, COMMAND.SET_SPEECH, { text: "" }), /non-empty/);
  assert.throws(() => encodeRequest(1, COMMAND.SET_SPEECH, { text: "\ud800" }), /well-formed/);
  assert.throws(() => encodeRequest(1, COMMAND.SET_SPEECH, { text: "你".repeat(107) }), /320 UTF-8 bytes/);
  assert.doesNotThrow(() => encodeRequest(1, COMMAND.SET_SPEECH, { text: "你好，Stack-chan" }));
  assert.doesNotThrow(() => encodeRequest(1, COMMAND.CLEAR_SPEECH, {}));
  assert.doesNotThrow(() => encodeRequest(1, COMMAND.SET_TALKING, { enabled: true }));
  assert.throws(() => encodeRequest(1, COMMAND.SET_TALKING, { enabled: 1 }), /boolean/);
  const parsed = parseFrame('{"v":1,"id":2,"ok":true,"result":{"yaw":0,"pitch":20}}');
  assert.equal(parsed.id, 2);
});

test("shared protocol parser preserves the 1024-byte USB frame boundary", () => {
  assert.doesNotThrow(() => parseFrame(responseFrameOfBytes(1024, { prefix: "你" })));
  assert.throws(() => parseFrame(responseFrameOfBytes(1025, { prefix: "你" })), /frame exceeds 1024 bytes/);
});

test("state store ignores duplicate events and detects a sequence gap", () => {
  const store = new DeviceStateStore();
  store.replaceFromStatus(baseStatus(10));
  assert.equal(store.applyEvent({ seq: 11, event: "touch", data: { gesture: "press" } }).applied, true);
  assert.equal(store.applyEvent({ seq: 11, event: "touch", data: { gesture: "press" } }).reason, "duplicate_or_old");
  assert.equal(store.applyEvent({ seq: 13, event: "audio_state", data: {} }).reason, "sequence_gap");
});

test("state store rejects an incompatible handshake", () => {
  const store = new DeviceStateStore();
  assert.throws(() => store.replaceFromStatus({ ...baseStatus(), protocol_version: 2 }), /incompatible/);
});

test("Dock survives unplug and reconnects on a changed COM path", async () => {
  const devices = [
    { path: "COM7", serialNumber: "441BF6E278A8" },
    { path: "COM11", serialNumber: "441BF6E278A8" },
  ];
  const transports = [new FakeTransport([baseStatus(0)]), new FakeTransport([baseStatus(0)])];
  let discoveryIndex = 0;
  let transportIndex = 0;
  const connected = [];
  const dock = new StackchanDock({
    discover: async () => devices[Math.min(discoveryIndex++, devices.length - 1)],
    openTransport: async () => transports[transportIndex++],
    sleep: async () => {},
    backoff: { initialMs: 1, maximumMs: 2, factor: 2 },
  });
  dock.on("connected", ({ device }) => connected.push(device.path));
  dock.start();
  await waitFor(() => connected.length === 1);
  transports[0].disconnect();
  await waitFor(() => connected.length === 2);
  assert.deepEqual(connected, ["COM7", "COM11"]);
  assert.equal(dock.running, true);
  await dock.stop();
});

test("Dock resynchronizes snapshot after an event sequence gap", async () => {
  const transport = new FakeTransport([baseStatus(10, true), baseStatus(13, false)]);
  const dock = new StackchanDock({
    discover: async () => ({ path: "COM7", serialNumber: "441BF6E278A8" }),
    openTransport: async () => transport,
    sleep: async () => {},
  });
  dock.start();
  await waitFor(() => dock.connected && dock.state?.event_sequence === 10);
  transport.emit("event", { type: "event", seq: 11, event: "touch", data: { gesture: "press" } });
  await waitFor(() => dock.state?.event_sequence === 11);
  transport.emit("event", { type: "event", seq: 13, event: "audio_state", data: { microphone_enabled: false } });
  await waitFor(() => dock.state?.event_sequence === 13 && dock.state.audio.microphone_enabled === false);
  assert.equal(transport.requests.filter(({ command }) => command === COMMAND.GET_STATUS).length, 2);
  await dock.stop();
});

test("Dock replays events that arrive during the handshake", async () => {
  class HandshakeEventTransport extends FakeTransport {
    async request(command, args) {
      if (command === COMMAND.GET_STATUS) {
        this.requests.push({ command, args });
        this.emit("event", { type: "event", seq: 11, event: "touch", data: { gesture: "release" } });
        return baseStatus(10);
      }
      return super.request(command, args);
    }
  }
  const transport = new HandshakeEventTransport([]);
  const dock = new StackchanDock({
    discover: async () => ({ path: "COM7", serialNumber: "441BF6E278A8" }),
    openTransport: async () => transport,
    sleep: async () => {},
  });
  dock.start();
  await waitFor(() => dock.state?.event_sequence === 11);
  assert.equal(dock.state.last_touch.gesture, "release");
  await dock.stop();
});

test("Dock exposes typed allowlist methods only", async () => {
  const transport = new FakeTransport([baseStatus(0)]);
  const dock = new StackchanDock({
    discover: async () => ({ path: "COM7", serialNumber: "441BF6E278A8" }),
    openTransport: async () => transport,
    sleep: async () => {},
  });
  dock.start();
  await waitFor(() => dock.connected && dock.state);
  await dock.setLed(1, 2, 3);
  await dock.setHead(10, 20, 180);
  await dock.setAudioEndpoints({ microphone_enabled: false });
  await dock.setTalking(true);
  await dock.setSpeech("你好，Stack-chan");
  await dock.clearSpeech();
  assert.equal(dock.request, undefined);
  assert.deepEqual(transport.requests.slice(-6).map(({ command }) => command), [
    "set_led", "set_head", "set_audio", "set_talking", "set_speech", "clear_speech",
  ]);
  await dock.stop();
});

class MockPort extends EventEmitter {
  isOpen = false;
  open(callback) { this.isOpen = true; callback(); }
  close(callback) { this.isOpen = false; callback(); this.emit("close"); }
  write(_frame, _encoding, callback) { callback(); }
}

test("transport times out a request without terminating the process", async () => {
  const transport = new CdcTransport(new MockPort(), { requestTimeoutMs: 5 });
  await transport.open();
  await assert.rejects(transport.request(COMMAND.GET_STATUS, {}), /timed out/);
  await transport.close();
});
