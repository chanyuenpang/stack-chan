import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { StackchanConsoleController, CONSOLE_ACTION } from "../src/console-controller.mjs";

class Runtime extends EventEmitter {
  dock = {
    getStatus: async () => ({ device_id: "device-1", session_id: "session-1", device: { battery: { level: 73, charging: true } } }), getHead: async () => ({ yaw: 1, pitch: 2 }),
    setExpression: async (value) => { this.expression = value; }, setLed: async (...value) => { this.led = value; },
    setHead: async (...value) => { this.head = value; }, celebrate: async (value) => { this.celebrateValue = value; },
  };
  async start() {} async stop() {}
}

test("only allowlisted safe actions reach the Dock", async () => {
  const runtime = new Runtime(); const controller = new StackchanConsoleController({ runtime });
  await controller.dispatch(CONSOLE_ACTION.SET_EXPRESSION, { expression: "happy" });
  await controller.dispatch(CONSOLE_ACTION.SET_LED, { red: 1, green: 2, blue: 3 });
  await controller.dispatch(CONSOLE_ACTION.SET_HEAD, { yaw: 10, pitch: 20, speed: 180 });
  assert.equal(runtime.expression, "happy"); assert.deepEqual(runtime.led, [1, 2, 3]); assert.deepEqual(runtime.head, [10, 20, 180]);
  await assert.rejects(controller.dispatch("raw_command", {}));
  await assert.rejects(controller.dispatch(CONSOLE_ACTION.SET_HEAD, { yaw: 46, pitch: 20 }));
});

test("runtime events form a renderer-safe state model", async () => {
  const runtime = new Runtime(); const controller = new StackchanConsoleController({ runtime });
  runtime.emit("authenticated", { deviceId: "device-1", sessionId: "session-1" }); runtime.emit("speaking", true);
  const state = await controller.dispatch(CONSOLE_ACTION.REFRESH);
  assert.equal(state.connection.phase, "connected"); assert.equal(state.voice.phase, "speaking"); assert.deepEqual(state.robot.head, { yaw: 1, pitch: 2 });
  assert.equal(state.robot.battery.availability, "available"); assert.equal(state.robot.battery.level, 73); assert.equal(state.robot.battery.charging, true);
  assert.deepEqual(state.robot.led, { availability: "derived", phase: "playing", rgb: { red: 0, green: 0, blue: 48 }, source: "runtime_state" });
});

test("battery stays unavailable without a valid device read-back", async () => {
  const runtime = new Runtime(); runtime.dock.getStatus = async () => ({ device_id: "device-1", session_id: "session-1", device: { battery: { level: 101, charging: false } } });
  const controller = new StackchanConsoleController({ runtime });
  const state = await controller.dispatch(CONSOLE_ACTION.REFRESH);
  assert.equal(state.robot.battery.availability, "unavailable");
  assert.equal(state.robot.battery.level, null);
});

test("state events are immutable complete snapshots with monotonic revisions", async () => {
  const runtime = new Runtime();
  const snapshots = [];
  const controller = new StackchanConsoleController({ runtime });
  controller.on("state", (state) => snapshots.push(state));
  runtime.emit("runtimeError", new Error("old error"));
  runtime.emit("authenticated", { deviceId: "device-1", sessionId: "session-1" });
  await controller.dispatch(CONSOLE_ACTION.REFRESH);
  assert.ok(snapshots.every((state) => Number.isInteger(state.revision) && state.connection && state.health && state.robot && state.voice && state.speaker));
  assert.ok(snapshots.every((state, index) => index === 0 || state.revision > snapshots[index - 1].revision));
  assert.equal(controller.state.health.runtime, "running");
  assert.equal(controller.state.health.lastError, null);
  snapshots[0].health.runtime = "corrupted";
  assert.notEqual(controller.state.health.runtime, "corrupted");
});

test("voice, confirmed LED and speaker transactions update one snapshot source", async () => {
  const runtime = new Runtime();
  const voiceStatus = new EventEmitter();
  const ledArbiter = new EventEmitter();
  ledArbiter.manualOverride = null;
  const speakerVolume = new EventEmitter();
  const controller = new StackchanConsoleController({ runtime, voiceStatus, ledArbiter, speakerVolume });
  voiceStatus.emit("transition", { next: "waiting_response" });
  ledArbiter.emit("applied", { red: 120, green: 0, blue: 168, source: "automatic:voice_status" });
  speakerVolume.emit("state", { volume: 50, pending: false, verified: true, error: null });
  const state = controller.state;
  assert.equal(state.voice.phase, "waiting_response");
  assert.deepEqual(state.robot.led.rgb, { red: 120, green: 0, blue: 168 });
  assert.equal(state.robot.led.availability, "confirmed");
  assert.equal(state.speaker.volume, 50);
  assert.equal(state.speaker.verified, true);
});

test("published subtitles become renderer-safe state without changing the voice owner", () => {
  const runtime = new Runtime();
  const subtitles = new EventEmitter();
  subtitles.current = { availability: "available", phase: "idle", text: "", subtitleId: null, updatedAt: null };
  const controller = new StackchanConsoleController({ runtime, subtitlePublication: subtitles });
  subtitles.emit("update", { availability: "available", phase: "streaming", text: "已经提交给机器人", subtitleId: 3, updatedAt: "2026-08-17T00:00:00.000Z" });
  assert.deepEqual(controller.state.voice.subtitle, { availability: "available", phase: "streaming", text: "已经提交给机器人", subtitleId: 3, updatedAt: "2026-08-17T00:00:00.000Z" });
});
