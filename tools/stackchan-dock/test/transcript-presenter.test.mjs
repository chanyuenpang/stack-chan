import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { SpeechBubblePresenter } from "../src/transcript-presenter.mjs";

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

class FakeDock extends EventEmitter {
  calls = [];
  connected = true;
  async setSpeech(text) {
    if (!this.connected) throw new Error("Stack-chan is not connected");
    this.calls.push(["setSpeech", text]);
  }
  async clearSpeech() {
    if (!this.connected) throw new Error("Stack-chan is not connected");
    this.calls.push(["clearSpeech"]);
  }
}

test("Dock presentation callbacks drive the speech bubble without MCP or audio", async (t) => {
  const dock = new FakeDock();
  const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: 10 });
  t.after(() => presenter.dispose());
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("你好，");
  presenter.appendAssistantText("我是 Stack-chan。");
  presenter.completeAssistantText("你好，我是 Stack-chan。");
  await presenter.idle();
  assert.deepEqual(dock.calls.at(-1), ["setSpeech", `你好，我是 Stack-chan。`]);
});

test("rapid deltas are coalesced and final text is forced", async (t) => {
  const dock = new FakeDock();
  const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: 25 });
  t.after(() => presenter.dispose());
  for (let index = 0; index < 40; index += 1) presenter.appendAssistantText(String(index % 10));
  presenter.completeAssistantText("0123456789".repeat(4));
  await presenter.idle();
  assert.ok(dock.calls.length <= 2);
  assert.equal(dock.calls.at(-1)[1], "0123456789".repeat(4));
});

test("long Unicode text is truncated on a code-point boundary", async (t) => {
  const dock = new FakeDock();
  const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: 0 });
  t.after(() => presenter.dispose());
  presenter.completeAssistantText(`prefix-${"界".repeat(200)}`);
  await presenter.idle();
  const text = dock.calls.at(-1)[1];
  assert.ok(Buffer.byteLength(text, "utf8") <= 320);
  assert.equal(text.isWellFormed(), true);
  assert.equal(text.endsWith("界".repeat(10)), true);
});

test("latest bubble state is replayed once after Dock reconnect", async (t) => {
  const dock = new FakeDock();
  dock.connected = false;
  const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: 0 });
  const errors = [];
  presenter.on("presentationError", (error) => errors.push(error));
  t.after(() => presenter.dispose());
  presenter.completeAssistantText("reconnect text");
  await presenter.idle();
  assert.equal(errors.length, 1);
  assert.deepEqual(dock.calls, []);
  dock.connected = true;
  dock.emit("connected", {});
  await waitFor(() => dock.calls.length === 1);
  assert.deepEqual(dock.calls[0], ["setSpeech", "reconnect text"]);
});

test("clear removes the previous bubble", async (t) => {
  const dock = new FakeDock();
  const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: 0 });
  t.after(() => presenter.dispose());
  presenter.completeAssistantText("previous");
  await presenter.idle();
  presenter.clear();
  await presenter.idle();
  assert.deepEqual(dock.calls.at(-1), ["clearSpeech"]);
});

test("disabled microphone state clears the bubble and prevents reconnect replay", async (t) => {
  const dock = new FakeDock();
  const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: 0 });
  t.after(() => presenter.dispose());
  presenter.completeAssistantText("voice reply");
  await presenter.idle();

  presenter.handleDeviceState({ audio: { microphone_enabled: false, speaker_enabled: false } });
  await presenter.idle();
  assert.deepEqual(dock.calls.at(-1), ["clearSpeech"]);

  dock.emit("connected", {});
  await presenter.idle();
  assert.deepEqual(dock.calls.at(-1), ["clearSpeech"]);
  assert.equal(dock.calls.some((call, index) => index > 1 && call[0] === "setSpeech"), false);
});
