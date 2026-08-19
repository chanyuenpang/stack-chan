import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CodexVoiceStatusIndicator, VOICE_STATUS } from "../src/codex-voice-status-indicator.mjs";

class FakeDock {
  connected = true;
  calls = [];
  async setLed(red, green, blue) { this.calls.push({ red, green, blue }); }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("uses only correlated user done and actual audio to drive the purple waiting and speaking LEDs", async () => {
  const transcripts = new EventEmitter();
  const runtime = new EventEmitter();
  const dock = new FakeDock();
  const trace = [];
  const indicator = new CodexVoiceStatusIndicator({ dock, transcripts, runtime, trace: (entry) => trace.push(entry) }).attach();

  transcripts.emit("userSpeechStarted");
  assert.equal(indicator.phase, VOICE_STATUS.IDLE, "a VAD/transcript-start style event must not create waiting");
  transcripts.emit("userTurnDone", { turnId: "user_1" });
  assert.equal(indicator.phase, VOICE_STATUS.WAITING_RESPONSE);
  transcripts.emit("assistantResponseStarted", { turnId: "assistant_1" });
  assert.equal(indicator.phase, VOICE_STATUS.RESPONSE_STARTED);
  runtime.emit("speaking", true);
  assert.equal(indicator.phase, VOICE_STATUS.SPEAKING);
  runtime.emit("speaking", false);
  assert.equal(indicator.phase, VOICE_STATUS.LISTENING);
  await flush(); await flush();

  assert.deepEqual(dock.calls, [
    { red: 120, green: 0, blue: 168 },
    { red: 120, green: 0, blue: 168 },
    { red: 0, green: 0, blue: 168 },
    { red: 0, green: 168, blue: 0 },
  ]);
  assert.deepEqual(trace.filter(({ event }) => event === "transition").map(({ next, reason }) => ({ next, reason })), [
    { next: VOICE_STATUS.WAITING_RESPONSE, reason: "matched_user_turn_done" },
    { next: VOICE_STATUS.RESPONSE_STARTED, reason: "assistant_turn_created" },
    { next: VOICE_STATUS.SPEAKING, reason: "first_downlink_opus" },
    { next: VOICE_STATUS.LISTENING, reason: "downlink_activity_stop" },
  ]);
  indicator.detach();
});

test("new user input and disconnect cancel purple without unauthenticated LED writes", async () => {
  const transcripts = new EventEmitter();
  const runtime = new EventEmitter();
  const dock = new FakeDock();
  const trace = [];
  const indicator = new CodexVoiceStatusIndicator({ dock, transcripts, runtime, trace: (entry) => trace.push(entry) }).attach();

  transcripts.emit("userTurnDone", { turnId: "user_1" });
  transcripts.emit("userTurnStarted", { turnId: "user_2" });
  dock.connected = false;
  runtime.emit("disconnected");
  runtime.emit("authenticated");
  await flush(); await flush();

  assert.equal(indicator.phase, VOICE_STATUS.LISTENING);
  assert.ok(trace.some(({ event, next, reason }) => event === "transition" && next === VOICE_STATUS.LISTENING && reason === "user_turn_created"));
  assert.ok(trace.some(({ event, next }) => event === "transition" && next === VOICE_STATUS.DISCONNECTED));
  assert.ok(trace.some(({ event, cause }) => event === "led_skipped" && cause === "dock_not_authenticated"));
  indicator.detach();
});
