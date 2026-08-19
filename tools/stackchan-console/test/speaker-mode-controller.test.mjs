import test from "node:test";
import assert from "node:assert/strict";

import { SpeakerModeController } from "../src/speaker-mode-controller.mjs";

function harness({ connected = true, stored = false, result = true } = {}) {
  const calls = [];
  let persisted = stored;
  const dock = { connected, callTool: async (...args) => { calls.push(args); return result; } };
  const controller = new SpeakerModeController({ dock, state: { load: () => persisted, save: (enabled) => { persisted = enabled; } } });
  return { controller, calls, persisted: () => persisted };
}

test("speaker mode persists only after the active device acknowledges the MCP call", async () => {
  const { controller, calls, persisted } = harness();
  assert.deepEqual(await controller.set(true), { enabled: true, synchronized: true, pending: false, error: null, input_muted: null });
  assert.deepEqual(calls, [["self.stackchan.set_speaker_mode", { enabled: true }]]);
  assert.equal(persisted(), true);
});

test("speaker mode preserves the last acknowledged preference on offline or failed delivery", async () => {
  const offline = harness({ connected: false, stored: false });
  await assert.rejects(offline.controller.set(true), /尚未认证/);
  assert.equal(offline.persisted(), false);
  assert.equal(offline.controller.current.enabled, false);

  const rejected = harness({ result: false, stored: false });
  await assert.rejects(rejected.controller.set(true), /未确认/);
  assert.equal(rejected.persisted(), false);
  assert.equal(rejected.controller.current.enabled, false);
});

test("startup synchronization reapplies the Dock preference without rewriting it and accepts input mute status", async () => {
  const { controller, calls, persisted } = harness({ stored: true });
  assert.deepEqual(await controller.sync(), { enabled: true, synchronized: true, pending: false, error: null, input_muted: null });
  assert.deepEqual(calls, [["self.stackchan.set_speaker_mode", { enabled: true }]]);
  assert.equal(persisted(), true);
  controller.setInputMuted(true);
  assert.equal(controller.current.input_muted, true);
});
