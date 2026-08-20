import assert from "node:assert/strict";
import test from "node:test";

import {
  STACKCHAN_UNIFIED_MCP_VERSION,
  clearStackchanLed,
  getStackchanHealth,
  getStackchanHead,
  getStackchanSpeakerVolume,
  getStackchanStatus,
  setStackchanHead,
  setStackchanLed,
  setStackchanSpeakerVolume,
} from "../src/xiaozhi-unified-mcp.mjs";

const token = "d".repeat(64);

test("unified MCP facade routes status, head, LED, and volume only through the Owner request contract", async () => {
  const requests = [];
  const request = async (value) => {
    requests.push(value);
    switch (value.operation) {
      case "get-console-status": return { contract_version: 1, owner: { state: "ready" }, dock: { connected: true, device_id: "robot", session_id: "session" } };
      case "get-robot-head": return { head: { yaw: 1, pitch: 2 } };
      case "set-robot-head": return { accepted: true, head: { yaw: value.yaw, pitch: value.pitch, speed: value.speed, source: "commanded" } };
      case "set-robot-led-color": return { accepted: true, color: { red: value.red, green: value.green, blue: value.blue } };
      case "clear-robot-led-override": return { cleared: true, automatic_control: "enabled" };
      case "get-speaker-volume": return { volume: 50 };
      case "set-speaker-volume": return { volume: value.volume };
      default: throw new Error(`unexpected ${value.operation}`);
    }
  };
  const context = { token, request };
  assert.equal((await getStackchanHealth(context)).mcp_version, STACKCHAN_UNIFIED_MCP_VERSION);
  assert.equal((await getStackchanHealth(context)).capabilities.camera.state, "deferred");
  assert.deepEqual(await getStackchanStatus(context), { contract_version: 1, owner: { state: "ready" }, dock: { connected: true, device_id: "robot", session_id: "session" } });
  assert.deepEqual(await getStackchanHead(context), { head: { yaw: 1, pitch: 2 } });
  assert.deepEqual(await setStackchanHead({ ...context, yaw: 10, pitch: 20, speed: 180 }), { accepted: true, head: { yaw: 10, pitch: 20, speed: 180, source: "commanded" } });
  assert.deepEqual(await setStackchanLed({ ...context, red: 1, green: 2, blue: 3 }), { accepted: true, color: { red: 1, green: 2, blue: 3 } });
  assert.deepEqual(await clearStackchanLed(context), { cleared: true, automatic_control: "enabled" });
  assert.deepEqual(await getStackchanSpeakerVolume(context), { volume: 50 });
  assert.deepEqual(await setStackchanSpeakerVolume({ ...context, volume: 70 }), { volume: 70 });
  assert.deepEqual(requests.map(({ operation }) => operation), [
    "get-console-status", "get-console-status", "get-console-status", "get-robot-head", "set-robot-head", "set-robot-led-color", "clear-robot-led-override", "get-speaker-volume", "set-speaker-volume",
  ]);
  assert.ok(requests.every((value) => value.token === token));
});

test("unified MCP facade retains an explicit Owner-unavailable failure instead of starting a runtime", async () => {
  await assert.rejects(
    () => getStackchanStatus({ token, request: async () => { const error = new Error("connect ENOENT \\\\.\\pipe\\stackchan-xiaozhi-admin"); error.code = "ENOENT"; throw error; } }),
    /OWNER_UNAVAILABLE/,
  );
});

test("unified MCP facade surfaces device authentication failure as DEVICE_OFFLINE", async () => {
  await assert.rejects(
    () => getStackchanHead({ token, request: async () => { throw new Error("XiaoZhi device is not authenticated"); } }),
    /DEVICE_OFFLINE/,
  );
});
