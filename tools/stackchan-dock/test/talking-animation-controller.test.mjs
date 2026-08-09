import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { TalkingAnimationController } from "../src/talking-animation-controller.mjs";

class FakeDock extends EventEmitter {
  calls = [];
  state = { audio: { microphone_enabled: true, speaker_enabled: true } };
  connected = true;
  async setTalking(enabled) {
    if (!this.connected) throw new Error("Stack-chan is not connected");
    this.calls.push(enabled);
    return { enabled };
  }
}

test("assistant lifecycle starts and stops the typed talking animation", async (t) => {
  const dock = new FakeDock();
  const controller = new TalkingAnimationController(dock);
  t.after(() => controller.dispose());
  controller.start();
  await controller.idle();
  controller.stop();
  await controller.idle();
  assert.deepEqual(dock.calls, [true, false]);
});

test("microphone mute stays independent and reconnect fails safe to stopped", async (t) => {
  const dock = new FakeDock();
  const controller = new TalkingAnimationController(dock);
  t.after(() => controller.dispose());
  controller.start();
  await controller.idle();
  controller.handleDeviceState({ audio: { microphone_enabled: false } });
  await controller.idle();
  assert.deepEqual(dock.calls, [true]);

  dock.emit("lifecycle", { state: "disconnected" });
  dock.emit("connected", {});
  await controller.idle();
  assert.deepEqual(dock.calls, [true, false]);
});

test("speaker talking lifecycle remains independent while microphone is disabled", async (t) => {
  const dock = new FakeDock();
  dock.state.audio.microphone_enabled = false;
  const controller = new TalkingAnimationController(dock);
  t.after(() => controller.dispose());
  controller.start();
  await controller.idle();
  assert.deepEqual(dock.calls, [true]);
});
