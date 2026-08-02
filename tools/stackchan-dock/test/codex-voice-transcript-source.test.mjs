import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CodexVoiceTranscriptSource,
  parseCodexVoiceTranscriptEvent,
} from "../src/codex-voice-transcript-source.mjs";

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

test("parses Codex realtime transcript delta and done events", () => {
  assert.deepEqual(
    parseCodexVoiceTranscriptEvent('received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "你好\\nStack-chan" })'),
    { type: "delta", text: "你好\nStack-chan" },
  );
  assert.deepEqual(
    parseCodexVoiceTranscriptEvent('received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "完成了" })'),
    { type: "done", text: "完成了" },
  );
  assert.equal(parseCodexVoiceTranscriptEvent("unrelated"), null);
  assert.deepEqual(
    parseCodexVoiceTranscriptEvent('received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "打断" })'),
    { type: "user_delta", text: "打断" },
  );
});

test("tails only new assistant transcript rows and emits incremental text", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec(`CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    feedback_log_body TEXT,
    process_uuid TEXT
  )`);
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "historic" })', "old");

  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5 });
  const events = [];
  source.on("assistantResponseStarted", () => events.push(["start"]));
  source.on("assistantTextDelta", ({ text }) => events.push(["delta", text]));
  source.on("assistantTextDone", ({ text }) => events.push(["done", text]));
  source.start();
  t.after(() => {
    source.stop();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  });

  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "你" })', "voice-process");
  insert.run("unrelated", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "ignored" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "好" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "你好" })', "voice-process");

  await waitFor(() => events.some(([type]) => type === "done"));
  assert.deepEqual(events, [["start"], ["delta", "你"], ["delta", "好"], ["done", "你好"]]);
});

test("user interruption stops the active response without restarting on its late done event", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec(`CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    feedback_log_body TEXT,
    process_uuid TEXT
  )`);
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5 });
  const events = [];
  source.on("assistantResponseStarted", () => events.push("start"));
  source.on("assistantTextDelta", () => events.push("delta"));
  source.on("assistantTextDone", () => events.push("done"));
  source.on("userSpeechStarted", () => events.push("user"));
  source.start();
  t.after(() => {
    source.stop();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  });

  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "旧回复" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "打断" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "继续说" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "旧回复" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "新回复" })', "voice-process");

  await waitFor(() => events.filter((event) => event === "start").length === 2);
  assert.deepEqual(events, ["start", "delta", "user", "done", "start", "delta"]);
});
