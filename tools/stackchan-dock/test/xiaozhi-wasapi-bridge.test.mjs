import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import WebSocket from "ws";

import { XIAOZHI_UPLINK_AUDIO, XiaozhiWebSocketServer } from "../src/xiaozhi-websocket-server.mjs";
import {
  BrokerPacketParser,
  XiaozhiWasapiBridge,
  XiaozhiWasapiBroker,
  encodeBrokerPacket,
  parseLocalDockStartupPrebufferFrames,
  selectAudioPolicyTargetCandidate,
} from "../src/xiaozhi-wasapi-bridge.mjs";

const token = "0123456789abcdef".repeat(4);

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
  }

  kill() {
    this.exitCode = 0;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 0, null);
  }
}

function connect(address) {
  return new WebSocket(`ws://127.0.0.1:${address.port}${address.path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Protocol-Version": "1",
      "Device-Id": "aabbccddeeff",
      "Client-Id": "test-client",
    },
  });
}

async function authenticate(server, address) {
  const socket = connect(address);
  await once(socket, "open");
  const authenticated = once(server, "authenticated");
  const reply = once(socket, "message");
  socket.send(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    audio_params: { ...XIAOZHI_UPLINK_AUDIO },
  }));
  await authenticated;
  await reply;
  return socket;
}

test("broker framing survives fragmented and coalesced stream chunks", () => {
  const parser = new BrokerPacketParser();
  const wire = Buffer.concat([encodeBrokerPacket([1, 2, 3]), encodeBrokerPacket([]), encodeBrokerPacket([4])]);
  assert.deepEqual(parser.push(wire.subarray(0, 2)), []);
  assert.deepEqual(parser.push(wire.subarray(2, 9)).map(Buffer.from), [Buffer.from([1, 2, 3])]);
  assert.deepEqual(parser.push(wire.subarray(9)).map(Buffer.from), [Buffer.alloc(0), Buffer.from([4])]);
  parser.finish();
  assert.throws(() => encodeBrokerPacket(Buffer.alloc(1_501)), /exceeds/);
});

test("authenticated route retries are bounded, and first downlink reasserts the route", async (t) => {
  const server = new EventEmitter();
  server.connected = true;
  server.sendDownlinkOpus = () => {};
  server.sendTtsStart = () => {};
  const calls = [];
  const broker = new EventEmitter();
  broker.writeMicrophoneOpus = async () => {};
  broker.setCodexOutputRouted = async (routed) => { calls.push(routed); };
  const bridge = new XiaozhiWasapiBridge({ server, broker }).attach();
  t.after(() => bridge.detach());
  calls.length = 0;
  server.emit("authenticated");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(calls.filter(Boolean).length >= 2);
  const beforeFirstPacket = calls.filter(Boolean).length;
  broker.emit("downlinkOpus", Buffer.from([9]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.filter(Boolean).length, beforeFirstPacket + 1);
  server.emit("disconnected");
  const afterDisconnect = calls.filter(Boolean).length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(calls.filter(Boolean).length, afterDisconnect);
});

test("a stale broker root is replaced once after the replacement is ready", async (t) => {
  class ManualBroker extends EventEmitter {
    constructor(rootPid, events) { super(); this.rootPid = rootPid; this.events = events; this.running = true; }
    start() { this.events.push(`start:${this.rootPid}`); this.emit("ready", { pid: this.rootPid }); }
    async stop() { this.events.push(`stop:${this.rootPid}`); this.running = false; }
    async writeMicrophoneOpus() {}
    async setCodexOutputRouted(routed) { this.events.push(`route:${this.rootPid}:${routed}`); }
  }
  const server = new EventEmitter();
  server.connected = true;
  server.sendDownlinkOpus = () => {};
  server.sendTtsStart = () => {};
  const events = [];
  const oldBroker = new ManualBroker(33472, events);
  const replacements = [];
  const bridge = new XiaozhiWasapiBridge({
    server,
    broker: oldBroker,
    resolveRootPid: async () => 38168,
    brokerFactory: (pid) => { const broker = new ManualBroker(pid, events); replacements.push(broker); return broker; },
  }).attach();
  t.after(() => bridge.detach());

  const replaced = once(bridge, "brokerReplaced");
  server.emit("authenticated");
  assert.deepEqual(await replaced, [{ previousRootPid: 33472, rootPid: 38168, reason: "authenticated" }]);
  assert.equal(replacements.length, 1);
  assert.ok(events.indexOf("start:38168") < events.indexOf("stop:33472"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(events.includes("route:38168:true"));

  server.emit("authenticated");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(replacements.length, 1);
});

test("an exited broker is replaced for the same root while a robot is authenticated", async (t) => {
  class ManualBroker extends EventEmitter {
    constructor(rootPid, events) { super(); this.rootPid = rootPid; this.events = events; this.running = true; }
    start() { this.events.push(`start:${this.rootPid}`); this.running = true; this.emit("ready", { pid: this.rootPid }); }
    async stop() { this.events.push(`stop:${this.rootPid}`); this.running = false; }
    async writeMicrophoneOpus() {}
    async setCodexOutputRouted(routed) { this.events.push(`route:${this.rootPid}:${routed}`); }
  }
  const server = new EventEmitter();
  server.connected = true;
  server.sendDownlinkOpus = () => {};
  server.sendTtsStart = () => {};
  const events = [];
  const oldBroker = new ManualBroker(38168, events);
  const replacements = [];
  const bridge = new XiaozhiWasapiBridge({
    server,
    broker: oldBroker,
    resolveRootPid: async () => 38168,
    brokerFactory: (pid) => { const broker = new ManualBroker(pid, events); replacements.push(broker); return broker; },
  }).attach();
  t.after(() => bridge.detach());

  const replaced = once(bridge, "brokerReplaced");
  oldBroker.running = false;
  oldBroker.emit("exit", { code: 1, signal: null, stderr: "audio device reset" });
  assert.deepEqual(await replaced, [{ previousRootPid: 38168, rootPid: 38168, reason: "broker_exit" }]);
  assert.equal(replacements.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(events.includes("route:38168:true"));
});

test("an explicit broker health check replaces an exited broker without an authenticated robot", async (t) => {
  class ManualBroker extends EventEmitter {
    constructor(rootPid) { super(); this.rootPid = rootPid; this.running = false; }
    start() { this.running = true; this.emit("ready", { pid: this.rootPid }); }
    async stop() { this.running = false; }
    async writeMicrophoneOpus() {}
    async setCodexOutputRouted() {}
  }
  const server = new EventEmitter();
  server.connected = false;
  server.sendDownlinkOpus = () => {};
  server.sendTtsStart = () => {};
  const oldBroker = new ManualBroker(38168);
  const replacements = [];
  const bridge = new XiaozhiWasapiBridge({
    server,
    broker: oldBroker,
    resolveRootPid: async () => 38168,
    brokerFactory: (pid) => { const broker = new ManualBroker(pid); replacements.push(broker); return broker; },
  }).attach();
  t.after(() => bridge.detach());

  const broker = await bridge.ensureBroker();
  assert.equal(replacements.length, 1);
  assert.equal(broker, replacements[0]);
  assert.equal(broker.running, true);
});

test("disconnect restore is not overwritten by continuing Codex downlink", async (t) => {
  const server = new EventEmitter();
  server.connected = true;
  const sent = [];
  server.sendDownlinkOpus = (opus) => sent.push(opus);
  server.sendTtsStart = () => {};
  const calls = [];
  const broker = new EventEmitter();
  broker.writeMicrophoneOpus = async () => {};
  broker.setCodexOutputRouted = async (routed) => { calls.push(routed); };
  const bridge = new XiaozhiWasapiBridge({ server, broker }).attach();
  t.after(() => bridge.detach());

  server.emit("authenticated");
  calls.length = 0;
  server.connected = false;
  server.emit("disconnected");
  assert.deepEqual(calls, [false]);

  const dropped = once(bridge, "downlinkDropped");
  broker.emit("downlinkOpus", Buffer.from([7, 8]));
  assert.deepEqual(await dropped, [{ reason: "robot_not_authenticated", bytes: 2 }]);
  assert.deepEqual(calls, [false]);
  assert.deepEqual(sent, []);
});

test("route control failures remain nonfatal while the bridge continues audio", async (t) => {
  const server = new EventEmitter();
  server.connected = true;
  const sent = [];
  server.sendDownlinkOpus = (opus) => sent.push(opus);
  server.sendTtsStart = () => {};
  const broker = new EventEmitter();
  broker.writeMicrophoneOpus = async () => {};
  broker.setCodexOutputRouted = async (routed) => { if (routed) throw new Error("session not ready"); };
  const bridge = new XiaozhiWasapiBridge({ server, broker }).attach();
  bridge.on("error", () => {});
  t.after(() => bridge.detach());
  server.emit("authenticated");
  broker.emit("downlinkOpus", Buffer.from([7]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sent.length, 1);
});

test("AudioPolicy diagnostic selects only the configured root's Chromium AudioService child", () => {
  const result = selectAudioPolicyTargetCandidate(100, [
    { processId: 100, parentProcessId: 1, name: "ChatGPT.exe", commandLine: "ChatGPT.exe" },
    { processId: 101, parentProcessId: 100, name: "ChatGPT.exe", commandLine: "ChatGPT.exe --type=renderer" },
    { processId: 102, parentProcessId: 100, name: "ChatGPT.exe", commandLine: "ChatGPT.exe --type=utility --utility-sub-type=audio.mojom.AudioService" },
    { processId: 202, parentProcessId: 2, name: "ChatGPT.exe", commandLine: "ChatGPT.exe --type=utility --utility-sub-type=audio.mojom.AudioService" },
  ]);
  assert.deepEqual(result, {
    status: "selected",
    rootPid: 100,
    pid: 102,
    parentPid: 100,
    name: "ChatGPT.exe",
    selectionReason: "descendant Chromium AudioService command line",
    audioSessionEvidence: "process_role_only",
  });
});

test("AudioPolicy diagnostic fails closed without exactly one AudioService candidate", () => {
  assert.deepEqual(selectAudioPolicyTargetCandidate(100, [{ processId: 100, parentProcessId: 1, commandLine: "ChatGPT.exe" }]), {
    status: "not_found", rootPid: 100, candidates: [], audioSessionEvidence: "none",
  });
  const ambiguous = selectAudioPolicyTargetCandidate(100, [
    { processId: 100, parentProcessId: 1, commandLine: "ChatGPT.exe" },
    { processId: 101, parentProcessId: 100, commandLine: "--utility-sub-type=audio.mojom.AudioService" },
    { processId: 102, parentProcessId: 100, commandLine: "--utility-sub-type=audio.mojom.AudioService" },
  ]);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.audioSessionEvidence, "none");
});

test("native broker wrapper frames microphone Opus and parses speaker activity", async () => {
  const child = new FakeChild();
  let spawnArguments = null;
  const broker = new XiaozhiWasapiBroker({
    binaryPath: "fake.exe",
    pid: 42,
    outputGainPercent: 150,
    spawnImpl: (_binary, arguments_) => { spawnArguments = arguments_; return child; },
  });
  broker.on("error", () => {});
  broker.start();
  const written = once(child.stdin, "data");
  await broker.writeMicrophoneOpus(Buffer.from([7, 8, 9]));
  assert.deepEqual((await written)[0], encodeBrokerPacket([7, 8, 9]));
  assert.deepEqual(spawnArguments, ["--pid", "42", "--render-device", "CABLE Input", "--output-gain-percent", "150"]);
  const gainWire = once(child.stdin, "data");
  await broker.setOutputGainPercent(150);
  assert.deepEqual((await gainWire)[0], encodeBrokerPacket(Buffer.from("STACKCHAN:output_gain_percent=150")));
  await assert.rejects(() => broker.setOutputGainPercent(151), /100..150/);

  const speaker = once(broker, "downlinkOpus");
  const stopped = once(broker, "activityStop");
  child.stdout.write(Buffer.concat([encodeBrokerPacket([4, 5]), encodeBrokerPacket([])]));
  assert.deepEqual((await speaker)[0], Buffer.from([4, 5]));
  await stopped;
  child.kill();
});

test("bridge maps official robot uplink and Codex downlink without PCM reinterpretation", async (t) => {
  const server = new XiaozhiWebSocketServer({ token });
  server.on("protocolError", () => {});
  const address = await server.listen({ host: "127.0.0.1" });
  const child = new FakeChild();
  const broker = new XiaozhiWasapiBroker({ binaryPath: "fake.exe", pid: 42, spawnImpl: () => child });
  broker.on("error", () => {});
  broker.start();
  const bridge = new XiaozhiWasapiBridge({ server, broker });
  bridge.on("error", (error) => assert.fail(error));
  const initialRestore = once(child.stdin, "data");
  bridge.attach();
  t.after(async () => {
    bridge.detach();
    child.kill();
    await server.close();
  });

  assert.deepEqual((await initialRestore)[0], encodeBrokerPacket(Buffer.from("STACKCHAN:restore_route")));
  const routed = once(child.stdin, "data");
  const socket = await authenticate(server, address);
  assert.deepEqual((await routed)[0], encodeBrokerPacket(Buffer.from("STACKCHAN:route")));
  const microphoneWire = once(child.stdin, "data");
  socket.send(Buffer.from([1, 3, 5, 7]));
  assert.deepEqual((await microphoneWire)[0], encodeBrokerPacket([1, 3, 5, 7]));

  const messages = [];
  socket.on("message", (message, isBinary) => messages.push({ message: Buffer.from(message), isBinary }));
  child.stdout.write(Buffer.concat([encodeBrokerPacket([2, 4, 6]), encodeBrokerPacket([])]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(messages.map(({ isBinary }) => isBinary), [false, true, false]);
  assert.deepEqual(JSON.parse(messages[0].message).state, "start");
  assert.deepEqual(messages[1].message, Buffer.from([2, 4, 6]));
  assert.deepEqual(JSON.parse(messages[2].message).state, "stop");
  socket.close();
});

test("bridge forwards the first Opus packet without waiting for subtitles", async (t) => {
  const server = new XiaozhiWebSocketServer({ token });
  server.on("protocolError", () => {});
  const address = await server.listen({ host: "127.0.0.1" });
  const child = new FakeChild();
  const broker = new XiaozhiWasapiBroker({ binaryPath: "fake.exe", pid: 42, spawnImpl: () => child });
  broker.on("error", () => {});
  broker.start();
  const bridge = new XiaozhiWasapiBridge({ server, broker });
  bridge.attach();
  t.after(async () => { bridge.detach(); child.kill(); await server.close(); });
  const socket = await authenticate(server, address);
  const messages = [];
  socket.on("message", (message, isBinary) => messages.push({ message: Buffer.from(message), isBinary }));
  child.stdout.write(encodeBrokerPacket([9]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(messages.map(({ isBinary }) => isBinary), [false, true]);
  socket.close();
});

function createPrebufferHarness({
  startupPrebufferFrames = 0,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  autoCompleteSends = true,
} = {}) {
  const server = new EventEmitter();
  server.connected = true;
  server.downlinkBufferedAmount = 0;
  const sent = [];
  const sendCallbacks = [];
  server.sendTtsStart = () => sent.push({ type: "start" });
  server.sendDownlinkOpus = (opus, callback = undefined) => {
    sent.push({ type: "opus", value: Buffer.from(opus) });
    if (typeof callback !== "function") return;
    if (autoCompleteSends) callback();
    else sendCallbacks.push(callback);
  };
  server.sendTtsStop = () => sent.push({ type: "stop" });
  const broker = new EventEmitter();
  broker.rootPid = 42;
  broker.writeMicrophoneOpus = async () => {};
  broker.setCodexOutputRouted = async () => {};
  const bridge = new XiaozhiWasapiBridge({
    server, broker, startupPrebufferFrames, now, setTimeoutImpl, clearTimeoutImpl,
  }).attach();
  return { server, broker, bridge, sent, sendCallbacks };
}

function createManualClock(startAtMs) {
  let nowMs = startAtMs;
  let nextHandle = 1;
  const timers = new Map();
  return {
    now: () => nowMs,
    setTimeoutImpl(callback, delay) {
      const handle = nextHandle++;
      timers.set(handle, { at: nowMs + delay, callback });
      return handle;
    },
    clearTimeoutImpl(handle) { timers.delete(handle); },
    advance(deltaMs) {
      const target = nowMs + deltaMs;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        nowMs = due[1].at;
        due[1].callback();
      }
      nowMs = target;
    },
  };
}

test("startup prebuffer remains disabled by default and preserves immediate steady-state forwarding", (t) => {
  const { broker, bridge, sent } = createPrebufferHarness();
  t.after(() => bridge.detach());
  broker.emit("downlinkOpus", Buffer.from([1]));
  broker.emit("downlinkOpus", Buffer.from([2]));
  assert.deepEqual(sent, [
    { type: "start" },
    { type: "opus", value: Buffer.from([1]) },
    { type: "opus", value: Buffer.from([2]) },
  ]);
});

test("opt-in startup prebuffer releases one frame per 60ms send-completion cadence", (t) => {
  const clock = createManualClock(1_000);
  const { broker, bridge, sent, sendCallbacks } = createPrebufferHarness({
    startupPrebufferFrames: 3,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    autoCompleteSends: false,
  });
  t.after(() => bridge.detach());
  const telemetry = [];
  bridge.on("prebufferTiming", (event) => telemetry.push(event));

  broker.emit("downlinkOpus", Buffer.from([1]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([2]));
  assert.deepEqual(sent, []);
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([3]));
  assert.deepEqual(sent, [
    { type: "start" },
    { type: "opus", value: Buffer.from([1]) },
  ]);
  sendCallbacks.shift()();
  clock.advance(59);
  assert.equal(sent.length, 2);
  clock.advance(1);
  assert.deepEqual(sent.at(-1), { type: "opus", value: Buffer.from([2]) });
  sendCallbacks.shift()();
  clock.advance(60);
  assert.deepEqual(sent.at(-1), { type: "opus", value: Buffer.from([3]) });
  sendCallbacks.shift()();
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([4]));
  assert.deepEqual(sent.at(-1), { type: "opus", value: Buffer.from([4]) });
  assert.deepEqual(telemetry.map(({ event_code, buffered_frames, fill_elapsed_ms, added_latency_ms }) => ({
    event_code, buffered_frames, fill_elapsed_ms, added_latency_ms,
  })), [
    { event_code: 1, buffered_frames: 1, fill_elapsed_ms: 0, added_latency_ms: 0 },
    { event_code: 2, buffered_frames: 2, fill_elapsed_ms: 60, added_latency_ms: 0 },
    { event_code: 2, buffered_frames: 3, fill_elapsed_ms: 120, added_latency_ms: 0 },
    { event_code: 3, buffered_frames: 3, fill_elapsed_ms: 120, added_latency_ms: 120 },
  ]);
  for (const event of telemetry) {
    assert.deepEqual(Object.keys(event).sort(), [
      "added_latency_ms", "buffered_frames", "event_code", "fill_elapsed_ms", "first_frame_at_ms",
      "observed_at_ms", "release_reason_code", "segment_seq", "target_frames", "version",
    ]);
    assert.ok(Object.values(event).every(Number.isSafeInteger));
  }
});

test("activity stop drains a short segment before stop and new frames stay in the same paced segment", (t) => {
  const clock = createManualClock(2_000);
  const { broker, bridge, sent, sendCallbacks } = createPrebufferHarness({
    startupPrebufferFrames: 3,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    autoCompleteSends: false,
  });
  t.after(() => bridge.detach());
  const telemetry = [];
  bridge.on("prebufferTiming", (event) => telemetry.push(event));
  broker.emit("downlinkOpus", Buffer.from([5]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([6]));
  broker.emit("activityStop");
  assert.deepEqual(sent, [
    { type: "start" },
    { type: "opus", value: Buffer.from([5]) },
  ]);
  broker.emit("downlinkOpus", Buffer.from([7]));
  sendCallbacks.shift()();
  clock.advance(60);
  assert.deepEqual(sent.at(-1), { type: "opus", value: Buffer.from([6]) });
  assert.equal(sent.some(({ type }) => type === "stop"), false);
  broker.emit("activityStop");
  sendCallbacks.shift()();
  clock.advance(60);
  assert.deepEqual(sent.at(-1), { type: "opus", value: Buffer.from([7]) });
  sendCallbacks.shift()();
  clock.advance(60);
  assert.equal(sent.at(-1).type, "stop");
  assert.deepEqual(telemetry.at(-1), {
    version: 1, event_code: 3, segment_seq: 1, target_frames: 3, buffered_frames: 2,
    first_frame_at_ms: 2_000, observed_at_ms: 2_060, fill_elapsed_ms: 60,
    added_latency_ms: 60, release_reason_code: 2,
  });
});

test("disconnect clears an unreleased prebuffer and never replays it into the next session", (t) => {
  const clock = createManualClock(3_000);
  const { server, broker, bridge, sent } = createPrebufferHarness({
    startupPrebufferFrames: 3,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
  });
  t.after(() => bridge.detach());
  const telemetry = [];
  bridge.on("prebufferTiming", (event) => telemetry.push(event));
  broker.emit("downlinkOpus", Buffer.from([7]));
  server.connected = false;
  server.emit("disconnected");
  assert.deepEqual(sent, []);
  assert.equal(telemetry.at(-1).event_code, 4);
  assert.equal(telemetry.at(-1).buffered_frames, 1);
  assert.equal(telemetry.at(-1).release_reason_code, 3);

  server.connected = true;
  clock.advance(1_000);
  broker.emit("downlinkOpus", Buffer.from([8]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([9]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([10]));
  clock.advance(120);
  assert.deepEqual(sent.filter(({ type }) => type === "opus").map(({ value }) => value), [
    Buffer.from([8]), Buffer.from([9]), Buffer.from([10]),
  ]);
});

test("disconnect mid-drain cancels queued frames and stale send callbacks cannot resume them", (t) => {
  const clock = createManualClock(3_500);
  const { server, broker, bridge, sent, sendCallbacks } = createPrebufferHarness({
    startupPrebufferFrames: 3,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    autoCompleteSends: false,
  });
  t.after(() => bridge.detach());
  broker.emit("downlinkOpus", Buffer.from([1]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([2]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([3]));
  assert.deepEqual(sent.filter(({ type }) => type === "opus").map(({ value }) => value[0]), [1]);
  server.connected = false;
  server.emit("disconnected");
  sendCallbacks.shift()();
  clock.advance(600);
  assert.deepEqual(sent.filter(({ type }) => type === "opus").map(({ value }) => value[0]), [1]);
  server.connected = true;
  broker.emit("downlinkOpus", Buffer.from([4]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([5]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([6]));
  assert.deepEqual(sent.filter(({ type }) => type === "opus").map(({ value }) => value[0]), [1, 4]);
});

test("paced release waits while websocket bufferedAmount exceeds the bounded threshold", (t) => {
  const clock = createManualClock(3_800);
  const { server, broker, bridge, sent } = createPrebufferHarness({
    startupPrebufferFrames: 2,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
  });
  t.after(() => bridge.detach());
  server.downlinkBufferedAmount = 3_001;
  broker.emit("downlinkOpus", Buffer.from([1]));
  clock.advance(60);
  broker.emit("downlinkOpus", Buffer.from([2]));
  assert.deepEqual(sent, [{ type: "start" }]);
  clock.advance(60);
  assert.deepEqual(sent, [{ type: "start" }]);
  server.downlinkBufferedAmount = 0;
  clock.advance(60);
  assert.deepEqual(sent.at(-1), { type: "opus", value: Buffer.from([1]) });
});

test("startup prebuffer releases available frames at the one-second latency cap", (t) => {
  let nowMs = 4_000;
  let scheduled = null;
  let cancelled = false;
  const { broker, bridge, sent } = createPrebufferHarness({
    startupPrebufferFrames: 17,
    now: () => nowMs,
    setTimeoutImpl: (callback, delay) => { scheduled = { callback, delay }; return 99; },
    clearTimeoutImpl: (handle) => { assert.equal(handle, 99); cancelled = true; },
  });
  t.after(() => bridge.detach());
  const telemetry = [];
  bridge.on("prebufferTiming", (event) => telemetry.push(event));
  broker.emit("downlinkOpus", Buffer.from([11]));
  assert.equal(scheduled.delay, 1_000);
  nowMs += 1_000;
  scheduled.callback();
  assert.deepEqual(sent, [
    { type: "start" },
    { type: "opus", value: Buffer.from([11]) },
  ]);
  assert.equal(cancelled, false);
  assert.deepEqual(telemetry.at(-1), {
    version: 1, event_code: 3, segment_seq: 1, target_frames: 17, buffered_frames: 1,
    first_frame_at_ms: 4_000, observed_at_ms: 5_000, fill_elapsed_ms: 1_000,
    added_latency_ms: 1_000, release_reason_code: 5,
  });
});

test("startup prebuffer is bounded to the approved 17-frame latency envelope", () => {
  const { bridge } = createPrebufferHarness({ startupPrebufferFrames: 17 });
  bridge.detach();
  assert.throws(() => createPrebufferHarness({ startupPrebufferFrames: 18 }), /0\.\.17/);
  assert.throws(() => createPrebufferHarness({ startupPrebufferFrames: 1.5 }), /integer/);
});

test("startup prebuffer environment parsing is default-off and fail-closed", () => {
  assert.equal(parseLocalDockStartupPrebufferFrames(undefined), 0);
  assert.equal(parseLocalDockStartupPrebufferFrames(""), 0);
  assert.equal(parseLocalDockStartupPrebufferFrames("0"), 0);
  assert.equal(parseLocalDockStartupPrebufferFrames("17"), 17);
  for (const value of ["18", "01", "1.5", "-1", " 17", 17]) {
    assert.throws(() => parseLocalDockStartupPrebufferFrames(value), /string|0\.\.17/);
  }
});
