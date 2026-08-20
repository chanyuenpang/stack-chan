import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { XiaozhiLocalAdmin } from "../src/xiaozhi-local-admin.mjs";
import { requestXiaozhiLocalAdmin } from "../src/xiaozhi-local-admin-client.mjs";

const token = "a".repeat(64);
const speakerStatus = (volume) => ({ device: { audio_speaker: { volume } } });

test("local admin replies after the client half-closes and a status read is delayed", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-half-close-${process.pid}-${randomUUID()}`;
  let releaseStatus;
  let beganStatus;
  const statusBegun = new Promise((resolve) => { beganStatus = resolve; });
  const statusGate = new Promise((resolve) => { releaseStatus = resolve; });
  const admin = new XiaozhiLocalAdmin({
    token, pipePath,
    dock: {
      async getStatus() { beganStatus(); await statusGate; return speakerStatus(50); },
      async callTool() { throw new Error("not expected"); },
    },
  });
  await admin.start();
  try {
    const reply = requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", pipePath, timeoutMs: 2_000 });
    await statusBegun;
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseStatus();
    assert.deepEqual(await reply, { volume: 50 });
  } finally {
    await admin.stop();
  }
});

test("local admin absorbs a peer-close after the client times out during a delayed status read", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-peer-close-${process.pid}-${randomUUID()}`;
  let releaseStatus;
  let beganStatus;
  const statusBegun = new Promise((resolve) => { beganStatus = resolve; });
  const statusGate = new Promise((resolve) => { releaseStatus = resolve; });
  const admin = new XiaozhiLocalAdmin({
    token, pipePath,
    dock: {
      async getStatus() { beganStatus(); await statusGate; return speakerStatus(50); },
      async callTool() { throw new Error("not expected"); },
    },
  });
  await admin.start();
  try {
    const reply = requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", pipePath, timeoutMs: 20 });
    await statusBegun;
    await assert.rejects(reply, /request timed out/);
    releaseStatus();
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    await admin.stop();
  }
});

test("local admin serializes concurrent speaker reads before they reach the device", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-serial-${process.pid}-${randomUUID()}`;
  let active = 0;
  let maximumActive = 0;
  const admin = new XiaozhiLocalAdmin({
    token, pipePath,
    dock: {
      async getStatus() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return speakerStatus(50);
      },
      async callTool() { throw new Error("not expected"); },
    },
  });
  await admin.start();
  try {
    const replies = await Promise.all(Array.from({ length: 5 }, () =>
      requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", pipePath, timeoutMs: 2_000 })));
    assert.deepEqual(replies, Array.from({ length: 5 }, () => ({ volume: 50 })));
    assert.equal(maximumActive, 1);
  } finally {
    await admin.stop();
  }
});

test("local admin completes repeated independent get and verified-set transactions without pipe EOF replies", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-repeated-${process.pid}-${randomUUID()}`;
  let volume = 50;
  const admin = new XiaozhiLocalAdmin({
    token, pipePath,
    dock: {
      async getStatus() { await new Promise((resolve) => setTimeout(resolve, 5)); return speakerStatus(volume); },
      async callTool(name, args) { assert.equal(name, "self.audio_speaker.set_volume"); volume = args.volume; },
    },
  });
  await admin.start();
  try {
    for (let index = 0; index < 10; index += 1) {
      const before = await requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", pipePath, timeoutMs: 2_000 });
      const after = await requestXiaozhiLocalAdmin({ token, operation: "set-speaker-volume", volume: before.volume, pipePath, timeoutMs: 2_000 });
      assert.deepEqual(after, before);
    }
  } finally {
    await admin.stop();
  }
});

test("local admin exposes only the injected Owner LED arbiter with strict RGB requests", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-led-${process.pid}-${randomUUID()}`;
  const calls = [];
  const ledController = {
    async setManual(red, green, blue) { calls.push(["set", red, green, blue]); return { red, green, blue }; },
    async clearManual() { calls.push(["clear"]); return { cleared: true }; },
  };
  const admin = new XiaozhiLocalAdmin({
    token, pipePath, ledController,
    dock: { async getStatus() { return speakerStatus(50); }, async callTool() { throw new Error("not expected"); } },
  });
  await admin.start();
  try {
    const set = await requestXiaozhiLocalAdmin({ token, operation: "set-robot-led-color", red: 120, green: 0, blue: 168, pipePath });
    assert.deepEqual(set, { color: { red: 120, green: 0, blue: 168 }, accepted: true, device_readback: "unavailable" });
    assert.deepEqual(await requestXiaozhiLocalAdmin({ token, operation: "clear-robot-led-override", pipePath }), { cleared: true, automatic_control: "enabled" });
    assert.deepEqual(calls, [["set", 120, 0, 168], ["clear"]]);
    assert.throws(() => requestXiaozhiLocalAdmin({ token, operation: "set-robot-led-color", red: 169, green: 0, blue: 0, pipePath }), /0 to 168/);
  } finally {
    await admin.stop();
  }
});

test("local admin exposes the Owner's current subtitle as a token-protected read-only snapshot", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-subtitle-${process.pid}-${randomUUID()}`;
  const subtitle = { availability: "available", phase: "streaming", text: "已经提交给机器人", subtitleId: 7, updatedAt: "2026-08-17T00:00:00.000Z" };
  const admin = new XiaozhiLocalAdmin({
    token, pipePath, statusProvider: () => ({ subtitle }),
    dock: { async getStatus() { return speakerStatus(50); }, async callTool() { throw new Error("not expected"); } },
  });
  await admin.start();
  try {
    assert.deepEqual(await requestXiaozhiLocalAdmin({ token, operation: "get-subtitle", pipePath }), { subtitle });
  } finally {
    await admin.stop();
  }
});

test("local admin keeps head moves inside the same Owner safety envelope as the Dock UI", async () => {
  const pipePath = `\\\\.\\pipe\\stackchan-local-admin-head-${process.pid}-${randomUUID()}`;
  const calls = [];
  const admin = new XiaozhiLocalAdmin({
    token, pipePath,
    dock: {
      async getStatus() { return speakerStatus(50); },
      async callTool() { throw new Error("not expected"); },
      async getHead() { return { yaw: 1, pitch: 2 }; },
      async setHead(yaw, pitch, speed) { calls.push({ yaw, pitch, speed }); },
    },
  });
  await admin.start();
  try {
    assert.deepEqual(await requestXiaozhiLocalAdmin({ token, operation: "get-robot-head", pipePath }), { head: { yaw: 1, pitch: 2 } });
    assert.deepEqual(await requestXiaozhiLocalAdmin({ token, operation: "set-robot-head", yaw: 10, pitch: 20, speed: 180, pipePath }), {
      accepted: true, head: { yaw: 10, pitch: 20, speed: 180, source: "commanded" },
    });
    assert.deepEqual(calls, [{ yaw: 10, pitch: 20, speed: 180 }]);
    assert.throws(() => requestXiaozhiLocalAdmin({ token, operation: "set-robot-head", yaw: 46, pitch: 20, speed: 180, pipePath }), /safety envelope/);
  } finally {
    await admin.stop();
  }
});
