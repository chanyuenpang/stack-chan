import test from "node:test";
import assert from "node:assert/strict";

import { SpeakerVolumeController } from "../src/speaker-volume-controller.mjs";

const token = "a".repeat(64);

function harness({ deviceVolume = 42, storedVolume = 42 } = {}) {
  const calls = [];
  const gains = [];
  let stored = storedVolume;
  return {
    calls, gains,
    controller: new SpeakerVolumeController({
      token,
      request: async (request) => {
        calls.push({ ...request });
        if (request.operation === "set-speaker-volume") deviceVolume = request.volume;
        return { volume: deviceVolume };
      },
      gain: { setOutputGainPercent: async (percent) => gains.push(percent) },
      state: { load: () => stored, save: (volume) => { stored = volume; } },
    }),
  };
}

test("unity and lower volume preserve the physical 0..100 contract", async () => {
  const { controller, calls, gains } = harness();
  assert.deepEqual(await controller.get(), { volume: 42, device_volume: 42, gain_percent: 100, verified: true });
  assert.deepEqual(await controller.set(50), {
    requested_volume: 50, volume: 50, device_volume: 50, gain_percent: 100, verified: true,
  });
  assert.deepEqual(gains, [100, 100]);
  assert.deepEqual(calls.map(({ operation, volume }) => ({ operation, volume })), [
    { operation: "get-speaker-volume", volume: undefined },
    { operation: "get-speaker-volume", volume: undefined },
    { operation: "set-speaker-volume", volume: 50 },
  ]);
  assert.throws(() => controller.set(151), /0 through 150/);
});

test("boost persists logical 101..150 while verifying physical unity and broker gain", async () => {
  const { controller, calls, gains } = harness({ deviceVolume: 70, storedVolume: 70 });
  assert.deepEqual(await controller.set(150), {
    requested_volume: 150, volume: 150, device_volume: 100, gain_percent: 150, verified: true,
  });
  assert.deepEqual(calls.map(({ operation, volume }) => ({ operation, volume })), [
    { operation: "get-speaker-volume", volume: undefined },
    { operation: "set-speaker-volume", volume: 100 },
  ]);
  assert.deepEqual(gains, [150]);
});

test("a device-side lower volume cancels a stale persisted boost instead of amplifying it", async () => {
  const { controller, gains } = harness({ deviceVolume: 60, storedVolume: 150 });
  assert.deepEqual(await controller.get(), { volume: 60, device_volume: 60, gain_percent: 100, verified: true });
  assert.deepEqual(gains, [100]);
});

test("speaker volume controller serializes writes", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const controller = new SpeakerVolumeController({
    token,
    request: async (request) => {
      calls.push(request.operation);
      if (calls.length === 1) await gate;
      return { volume: request.operation === "set-speaker-volume" ? request.volume : 100 };
    },
    gain: { setOutputGainPercent: async () => {} },
    state: { load: () => 100, save: () => {} },
  });
  const first = controller.set(120);
  const second = controller.set(130);
  await Promise.resolve();
  assert.deepEqual(calls, ["get-speaker-volume"]);
  release();
  await first;
  await second;
  assert.deepEqual(calls, ["get-speaker-volume", "get-speaker-volume"]);
});
