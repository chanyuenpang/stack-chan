import test from "node:test";
import assert from "node:assert/strict";
import { AttachedDockStatusController } from "../src/local-dock-status-client.mjs";

test("attached console displays a disconnected Dock without creating a runtime", async () => {
  const controller = new AttachedDockStatusController({ request: async () => ({
    protocol_version: 1,
    dock: { connected: false, device_id: null, session_id: null },
    voice: "idle", subtitle: "idle", runtime: "waiting_for_robot", last_error: null,
  }) });
  const state = await controller.refresh();
  assert.equal(state.connection.phase, "disconnected");
  assert.equal(state.health.runtime, "waiting_for_robot");
  controller.stop();
});

test("attached console reports an unavailable local interface explicitly", async () => {
  const controller = new AttachedDockStatusController({ request: async () => { throw new Error("pipe is unavailable"); } });
  const state = await controller.refresh();
  assert.equal(state.connection.phase, "unavailable");
  assert.equal(state.health.lastError, "pipe is unavailable");
  controller.stop();
});
