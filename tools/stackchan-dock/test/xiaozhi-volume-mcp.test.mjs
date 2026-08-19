import assert from "node:assert/strict";
import test from "node:test";

import { getVerifiedSpeakerVolume, setVerifiedSpeakerVolume } from "../src/xiaozhi-local-admin.mjs";
import { clearRobotLedOverride, getRobotSpeakerVolume, setRobotLedColor, setRobotSpeakerVolume } from "../src/xiaozhi-volume-mcp.mjs";

test("verified speaker volume writes through the official tool then confirms the device value", async () => {
  const calls = [];
  const dock = {
    async getStatus() { return { device: { audio_speaker: { volume: calls.length ? 42 : 70 } } }; },
    async callTool(name, args) { calls.push({ name, args }); },
  };
  assert.equal(await getVerifiedSpeakerVolume(dock), 70);
  assert.equal(await setVerifiedSpeakerVolume(dock, 42), 42);
  assert.deepEqual(calls, [{ name: "self.audio_speaker.set_volume", args: { volume: 42 } }]);
});

test("verified speaker volume never reports success when the post-write device value differs", async () => {
  const dock = { getStatus: async () => ({ device: { audio_speaker: { volume: 70 } } }), callTool: async () => {} };
  await assert.rejects(() => setVerifiedSpeakerVolume(dock, 42), /verification failed/);
});

test("volume MCP facade is range-limited and returns success only with an exact Owner confirmation", async () => {
  const token = "0123456789abcdef".repeat(4);
  const requests = [];
  const request = async (value) => { requests.push(value); return { volume: 42 }; };
  assert.deepEqual(await getRobotSpeakerVolume({ token, request }), { volume: 42 });
  assert.deepEqual(await setRobotSpeakerVolume({ token, volume: 42, request }), { requested_volume: 42, volume: 42, verified: true });
  assert.deepEqual(requests, [
    { token, operation: "get-speaker-volume" },
    { token, operation: "set-speaker-volume", volume: 42 },
  ]);
  await assert.rejects(() => setRobotSpeakerVolume({ token, volume: 42, request: async () => ({ volume: 41 }) }), /not verified/);
  await assert.rejects(() => setRobotSpeakerVolume({ token, volume: 101, request }), /0 to 100/);
});

test("LED MCP facade is RGB-allowlisted, reports no physical read-back, and can clear its manual override", async () => {
  const token = "fedcba9876543210".repeat(4);
  const requests = [];
  const request = async (value) => {
    requests.push(value);
    if (value.operation === "clear-robot-led-override") return { cleared: true, automatic_control: "enabled" };
    return { accepted: true, color: { red: value.red, green: value.green, blue: value.blue }, device_readback: "unavailable" };
  };
  assert.deepEqual(await setRobotLedColor({ token, red: 120, green: 0, blue: 168, request }), {
    requested_color: { red: 120, green: 0, blue: 168 }, accepted: true, device_readback: "unavailable",
  });
  assert.deepEqual(await clearRobotLedOverride({ token, request }), { cleared: true, automatic_control: true });
  assert.deepEqual(requests, [
    { token, operation: "set-robot-led-color", red: 120, green: 0, blue: 168 },
    { token, operation: "clear-robot-led-override" },
  ]);
  await assert.rejects(() => setRobotLedColor({ token, red: 169, green: 0, blue: 0, request }), /0 to 168/);
});
